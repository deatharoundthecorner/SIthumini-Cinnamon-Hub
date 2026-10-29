/**
 * Cloudflare Worker: WhatsApp Cloud API & Bot State Machine
 * Meta Graph API v26.0
 * Web Crypto HMAC-SHA256 signature verification & D1 durable queueing
 */

import {
  persistInboxEvent,
  claimInboxLock,
  completeInboxMessage,
  recordInboxFailure,
  getProducts,
  createOrderRequest,
  getOrderByRef,
  confirmDraftOrder,
  getConversation,
  saveConversation,
  recordOutboundMessage,
} from './db.js';
import { getNumericPrice, formatPrice } from '../utils/pricingCore.js';

export const DEFAULT_META_GRAPH_VERSION = 'v26.0';

export function getMetaGraphVersion(env = {}) {
  const version = env.META_GRAPH_API_VERSION;
  if (version && /^v\d+\.\d+$/.test(version)) {
    return version;
  }
  return DEFAULT_META_GRAPH_VERSION;
}

/**
 * Constant-time byte comparison using SubtleCrypto or timingSafeEqual
 */
function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let c = 0;
  for (let i = 0; i < a.length; i++) {
    c |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return c === 0;
}

function bufferToHex(buffer) {
  const bytes = new Uint8Array(buffer);
  let hex = '';
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i].toString(16).padStart(2, '0');
  }
  return hex;
}

export function safeMaskPhone(phone) {
  if (!phone || typeof phone !== 'string') return '[REDACTED]';
  const clean = phone.replace(/[^\d+]/g, '');
  if (clean.length <= 6) return '****';
  return `${clean.slice(0, 4)}****${clean.slice(-3)}`;
}

/**
 * Validates Meta X-Hub-Signature-256 header using Web Crypto HMAC-SHA256
 */
export async function verifyMetaSignature(request, rawBodyBuffer, appSecret, isProduction) {
  if (!appSecret) {
    if (isProduction) {
      console.error('[SECURITY FATAL] Webhook received in production without WHATSAPP_APP_SECRET.');
      return { valid: false, status: 500, error: 'Server configuration error: Webhook signature verification unavailable' };
    }
    return { valid: false, status: 401, error: 'WHATSAPP_APP_SECRET is not configured' };
  }

  const signatureHeader = request.headers.get('x-hub-signature-256') || request.headers.get('X-Hub-Signature-256');
  if (!signatureHeader) {
    return { valid: false, status: 401, error: 'Missing X-Hub-Signature-256 header' };
  }

  const parts = signatureHeader.split('=');
  if (parts.length !== 2 || parts[0] !== 'sha256') {
    return { valid: false, status: 401, error: 'Invalid signature format' };
  }

  const signature = parts[1];
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(appSecret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );

  const expectedSigBuffer = await crypto.subtle.sign('HMAC', key, rawBodyBuffer);
  const expectedSignature = bufferToHex(expectedSigBuffer);

  if (!timingSafeEqual(signature, expectedSignature)) {
    return { valid: false, status: 403, error: 'Invalid webhook signature' };
  }

  return { valid: true };
}

/**
 * Sends a WhatsApp text message via Meta Cloud API (v26.0 default, configurable)
 */
export async function sendWhatsAppMessage(to, bodyText, env, { inboxMessageId = null } = {}) {
  const isProd = env.NODE_ENV === 'production';
  const token = env.WHATSAPP_ACCESS_TOKEN;
  const phoneNumberId = env.WHATSAPP_PHONE_NUMBER_ID;

  if (isProd) {
    if (env.WHATSAPP_SIMULATION_MODE === 'true') {
      throw new Error('Simulation mode is strictly prohibited in production.');
    }
    if (!token || !phoneNumberId) {
      throw new Error('Meta WhatsApp credentials missing: WHATSAPP_ACCESS_TOKEN or WHATSAPP_PHONE_NUMBER_ID is not configured in production.');
    }
  } else if (!token || !phoneNumberId || env.WHATSAPP_SIMULATION_MODE === 'true' || (env.NODE_ENV === 'test' && !env.TEST_REAL_WHATSAPP_CALLS)) {
    console.info('[WhatsApp Simulation]', {
      to: safeMaskPhone(to),
      preview: bodyText.slice(0, 80) + '...',
    });
    return { ok: true, simulated: true };
  }

  const graphVersion = getMetaGraphVersion(env);
  const url = `https://graph.facebook.com/${graphVersion}/${phoneNumberId}/messages`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: to,
      type: 'text',
      text: { preview_url: false, body: bodyText },
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    console.error('[WhatsApp Meta API Error]', response.status, errText);
    throw new Error(`WhatsApp API delivery failed (${response.status}): ${errText}`);
  }

  const data = await response.json();

  // Record outgoing message in outbox table if D1 binding is available
  if (env.DB) {
    await recordOutboundMessage(env.DB, {
      inboxMessageId,
      recipientPhone: to,
      messageBody: bodyText,
    });
  }

  return { ok: true, messageId: data.messages?.[0]?.id };
}

/**
 * Formats catalog display for WhatsApp.
 */
function formatCatalogMessage(products, market) {
  const header = market === 'lk'
    ? '🌿 *Sithumini Cinnamon Catalog (Local Sri Lanka - LKR)*\n_Pure Ceylon Cinnamon direct from Southern Sri Lanka_\n'
    : '🌍 *Sithumini Cinnamon Catalog (International Export - USD)*\n_Pure Ceylon Cinnamon Export Grade_\n';

  const lines = products.map((p, idx) => {
    const priceDisplay = formatPrice(getNumericPrice(p, market), market);
    return `*${idx + 1}.* ${p.name}\n   Price: ${priceDisplay} | SKU: ${p.id}`;
  });

  return (
    `${header}\n` +
    lines.join('\n\n') +
    `\n\nTo place an order request, reply with the *product number* (e.g. *1*) or type *MENU* to return.`
  );
}

/**
 * Core Bot Conversation State Machine
 */
export async function handleIncomingMessage(senderPhone, messageText, env, { inboxMessageId = null } = {}) {
  const text = (messageText || '').trim();
  const lower = text.toLowerCase();

  let session = await getConversation(env.DB, senderPhone);
  if (!session) {
    session = {
      state: 'AWAITING_MARKET',
      data: { market: null, draftOrder: null },
    };
  }

  const market = session.data.market || 'lk';
  const currency = market === 'lk' ? 'LKR' : 'USD';

  // 0. Website-to-WhatsApp Structured Checkout Detection
  // Matches "Reference: SCH-..." or "Order Reference: SCH-..." from website cart checkout
  const webOrderRefMatch = text.match(/(?:Order\s+)?Reference:\s*(?:#)?(SCH-[A-Za-z0-9_-]+)/i);
  if (webOrderRefMatch) {
    if (!env.DB) {
      throw new Error('D1 database binding DB is not available: Cannot process web checkout.');
    }

    const orderRef = webOrderRefMatch[1].toUpperCase();
    const existingOrder = await getOrderByRef(env.DB, orderRef);

    if (existingOrder) {
      if (existingOrder.status === 'draft' || existingOrder.status === 'abandoned' || existingOrder.status === 'pending') {
        // Transition existing draft checkout to confirmed customer order!
        const { order } = await confirmDraftOrder(env.DB, orderRef, { customerPhone: senderPhone });

        // Reset conversation session to clean state
        session.state = 'MAIN_MENU';
        session.data.draftOrder = null;
        if (order.market) {
          session.data.market = order.market;
        }
        await saveConversation(env.DB, senderPhone, session.state, session.data);

        const itemsList = order.items && order.items.length > 0
          ? order.items.map(it => `• ${it.product_name} (Qty: ${it.quantity})`).join('\n')
          : 'Cinnamon Products';

        const customerGreeting = order.customer_name ? `Thank you, *${order.customer_name}*!` : 'Thank you!';
        const marketLabel = order.market === 'lk' ? 'Sri Lanka (LKR)' : 'International (USD)';

        await sendWhatsAppMessage(
          senderPhone,
          `🎉 *Order Request Confirmed!*\n\n` +
          `Order Reference: *#${orderRef}*\n` +
          `Market: *${marketLabel}*\n` +
          `Estimated Subtotal: *${formatPrice(order.subtotal, order.market)}*\n\n` +
          `*Requested Items:*\n${itemsList}\n\n` +
          `${customerGreeting} Our operations team has received your order request from the website. We will review stock availability and contact you on this number with exact delivery and payment instructions.\n\n` +
          `Type *MENU* anytime for options.`,
          env,
          { inboxMessageId }
        );

        if (env.OWNER_PHONE_NUMBER && env.OWNER_PHONE_NUMBER !== senderPhone) {
          await sendWhatsAppMessage(
            env.OWNER_PHONE_NUMBER,
            `[ALERT - Sithumini Cinnamon Hub]\n` +
            `🛒 WEBSITE ORDER CONFIRMED #${orderRef}\n` +
            `Customer: ${order.customer_name || 'Guest'} (${senderPhone})\n` +
            `Destination: ${order.delivery_city || order.destination_country || 'N/A'}\n` +
            `Subtotal: ${formatPrice(order.subtotal, order.market)}\n` +
            `Items:\n${itemsList}`,
            env,
            { inboxMessageId }
          );
        }
        return;
      } else if (existingOrder.status === 'confirmed' || existingOrder.status === 'processing' || existingOrder.status === 'completed') {
        // Idempotency: Duplicate WhatsApp delivery
        await sendWhatsAppMessage(
          senderPhone,
          `ℹ️ *Order Request Already Received*\n\n` +
          `Order Reference: *#${orderRef}*\n` +
          `Status: *Confirmed & In Review*\n\n` +
          `We already have your order request in our system and our operations team is currently reviewing it. We will message you shortly!\n\n` +
          `Type *MENU* for options.`,
          env,
          { inboxMessageId }
        );
        return;
      }
    }
  }

  if (lower === 'reset' || lower === 'start' || lower === 'restart') {
    session.state = 'AWAITING_MARKET';
    session.data = { market: null, draftOrder: null };
    await saveConversation(env.DB, senderPhone, session.state, session.data);

    await sendWhatsAppMessage(
      senderPhone,
      `🌿 *Welcome to Sithumini Cinnamon Hub!*\n\n` +
      `Are you shopping from Sri Lanka or internationally?\n\n` +
      `1️⃣ *Sri Lanka* (Local LKR Prices & Islandwide Delivery)\n` +
      `2️⃣ *International* (Export Grade USD Prices & Worldwide Shipping)\n\n` +
      `Please reply with *1* or *2*:`,
      env,
      { inboxMessageId }
    );
    return;
  }

  if (lower === 'menu' || lower === 'help' || lower === 'home') {
    session.state = 'MAIN_MENU';
    session.data.draftOrder = null;
    await saveConversation(env.DB, senderPhone, session.state, session.data);

    const marketLabel = market === 'lk' ? 'Sri Lanka - LKR' : 'International - USD';
    await sendWhatsAppMessage(
      senderPhone,
      `🌿 *Main Menu* (${marketLabel})\n\n` +
      `1️⃣ *Catalog* — Browse products & prices\n` +
      `2️⃣ *Order* — Place an order request\n` +
      `3️⃣ *Agent* — Chat with our operations manager\n` +
      `4️⃣ *Change Market* — Switch between LKR & USD\n\n` +
      `Reply with *1*, *2*, *3*, or *4*:`,
      env,
      { inboxMessageId }
    );
    return;
  }

  if (lower === '3' || lower === 'agent' || lower === 'human' || lower === 'support') {
    session.state = 'CONNECTED_AGENT';
    await saveConversation(env.DB, senderPhone, session.state, session.data);

    await sendWhatsAppMessage(
      senderPhone,
      `Connecting you to our operations team. A manager will message you shortly.\n\nType *MENU* anytime to return to the automated system.`,
      env,
      { inboxMessageId }
    );
    return;
  }

  switch (session.state) {
    case 'AWAITING_MARKET': {
      if (text === '1' || lower.includes('lanka') || lower.includes('lkr')) {
        session.data.market = 'lk';
        session.state = 'MAIN_MENU';
        await saveConversation(env.DB, senderPhone, session.state, session.data);

        await sendWhatsAppMessage(
          senderPhone,
          `🇱🇰 *Market set to Sri Lanka (LKR)*\n\n` +
          `What would you like to do?\n` +
          `1️⃣ *Catalog* — Browse products & prices\n` +
          `2️⃣ *Order* — Place an order request\n` +
          `3️⃣ *Agent* — Connect with a manager\n\n` +
          `Reply with *1*, *2*, or *3*:`,
          env,
          { inboxMessageId }
        );
        return;
      }

      if (text === '2' || lower.includes('intl') || lower.includes('export') || lower.includes('usd')) {
        session.data.market = 'intl';
        session.state = 'AWAITING_COUNTRY';
        await saveConversation(env.DB, senderPhone, session.state, session.data);

        await sendWhatsAppMessage(
          senderPhone,
          `🌍 *International Export Selected*\n\nPlease enter your *Destination Country* (e.g. USA, UK, Germany, Australia):`,
          env,
          { inboxMessageId }
        );
        return;
      }

      await sendWhatsAppMessage(
        senderPhone,
        `Please choose your market:\nReply *1* for Sri Lanka (LKR) or *2* for International (USD).`,
        env,
        { inboxMessageId }
      );
      return;
    }

    case 'AWAITING_COUNTRY': {
      if (!text || text.length < 2) {
        await sendWhatsAppMessage(senderPhone, `⚠️ Please enter a valid destination country name:`, env, { inboxMessageId });
        return;
      }

      session.data.destinationCountry = text.trim();
      session.state = 'MAIN_MENU';
      await saveConversation(env.DB, senderPhone, session.state, session.data);

      await sendWhatsAppMessage(
        senderPhone,
        `✈️ Destination set to *${session.data.destinationCountry}*.\n\n` +
        `1️⃣ *Catalog* — Browse export products\n` +
        `2️⃣ *Order* — Request an export order quote\n` +
        `3️⃣ *Agent* — Speak with our export manager\n\n` +
        `Reply with *1*, *2*, or *3*:`,
        env,
        { inboxMessageId }
      );
      return;
    }

    case 'MAIN_MENU': {
      if (text === '1' || lower === 'catalog' || lower === 'products') {
        const products = await getProducts(env.DB, { isProduction: env.NODE_ENV === 'production' });
        const catalogMsg = formatCatalogMessage(products, market);
        session.state = 'BROWSING_CATALOG';
        await saveConversation(env.DB, senderPhone, session.state, session.data);
        await sendWhatsAppMessage(senderPhone, catalogMsg, env, { inboxMessageId });
        return;
      }

      if (text === '2' || lower === 'order') {
        session.state = 'SELECTING_PRODUCT';
        await saveConversation(env.DB, senderPhone, session.state, session.data);

        const products = await getProducts(env.DB, { isProduction: env.NODE_ENV === 'production' });
        const productList = products.map((p, i) => `*${i + 1}* — ${p.name}`).join('\n');
        await sendWhatsAppMessage(
          senderPhone,
          `Please reply with the number of the product you wish to order:\n\n${productList}\n\nType *MENU* to cancel.`,
          env,
          { inboxMessageId }
        );
        return;
      }

      if (text === '4' || lower.includes('change')) {
        session.state = 'AWAITING_MARKET';
        await saveConversation(env.DB, senderPhone, session.state, session.data);
        await sendWhatsAppMessage(
          senderPhone,
          `Choose your market:\n1️⃣ Sri Lanka (LKR)\n2️⃣ International (USD)`,
          env,
          { inboxMessageId }
        );
        return;
      }

      await sendWhatsAppMessage(senderPhone, `Please reply with *1* for Catalog, *2* for Order, *3* for Agent, or *4* to Change Market.`, env, { inboxMessageId });
      return;
    }

    case 'BROWSING_CATALOG':
    case 'SELECTING_PRODUCT': {
      const products = await getProducts(env.DB, { isProduction: env.NODE_ENV === 'production' });
      const productIdx = parseInt(text, 10) - 1;

      if (isNaN(productIdx) || productIdx < 0 || productIdx >= products.length) {
        await sendWhatsAppMessage(
          senderPhone,
          `⚠️ Invalid product number. Please enter a number between *1* and *${products.length}*, or type *MENU* to go back.`,
          env,
          { inboxMessageId }
        );
        return;
      }

      const selected = products[productIdx];
      const numericPrice = getNumericPrice(selected, market);

      if (numericPrice === null) {
        await sendWhatsAppMessage(
          senderPhone,
          `📦 *${selected.name}*\n\n` +
          `Export pricing for this product requires a custom quote.\n` +
          `Please type *AGENT* to connect with our manager, or type *MENU* to view other products.`,
          env,
          { inboxMessageId }
        );
        return;
      }

      session.data.draftOrder = {
        productId: selected.id,
        productName: selected.name,
        unitPrice: numericPrice,
        quantity: 1,
      };

      session.state = 'AWAITING_QUANTITY';
      await saveConversation(env.DB, senderPhone, session.state, session.data);

      await sendWhatsAppMessage(
        senderPhone,
        `Selected: *${selected.name}*\n` +
        `Unit Price: *${formatPrice(numericPrice, market)}*\n\n` +
        `How many would you like to order? (Enter quantity as a number, e.g. *1*, *2*, *5*):`,
        env,
        { inboxMessageId }
      );
      return;
    }

    case 'AWAITING_QUANTITY': {
      const qty = parseInt(text, 10);
      if (isNaN(qty) || qty <= 0 || qty > 1000) {
        await sendWhatsAppMessage(
          senderPhone,
          `⚠️ Please enter a valid quantity between *1* and *1000*:`,
          env,
          { inboxMessageId }
        );
        return;
      }

      const draft = session.data.draftOrder;
      if (!draft) {
        session.state = 'MAIN_MENU';
        await saveConversation(env.DB, senderPhone, session.state, session.data);
        await sendWhatsAppMessage(senderPhone, 'Session timed out. Type *MENU* to start again.', env, { inboxMessageId });
        return;
      }

      draft.quantity = qty;
      const subtotal = Math.round(draft.unitPrice * qty * 100) / 100;
      draft.subtotal = subtotal;

      session.state = 'ORDER_CONFIRMATION';
      await saveConversation(env.DB, senderPhone, session.state, session.data);

      await sendWhatsAppMessage(
        senderPhone,
        `📋 *Order Request Summary*\n\n` +
        `• *Product:* ${draft.productName}\n` +
        `• *Quantity:* ${draft.quantity}\n` +
        `• *Unit Price:* ${formatPrice(draft.unitPrice, market)}\n` +
        `• *Subtotal:* ${formatPrice(subtotal, market)}\n` +
        `• *Destination:* ${session.data.destinationCountry || (market === 'lk' ? 'Sri Lanka' : 'Export')}\n\n` +
        `⚠️ *Important:* This creates an *Order Request*. It is not yet charged or final.\n\n` +
        `Reply *YES* to submit this order request, or *NO* to cancel.`,
        env,
        { inboxMessageId }
      );
      return;
    }

    case 'ORDER_CONFIRMATION': {
      if (lower === 'yes' || lower === 'confirm' || lower === 'y') {
        const draft = session.data.draftOrder;
        if (!draft) {
          session.state = 'MAIN_MENU';
          await saveConversation(env.DB, senderPhone, session.state, session.data);
          await sendWhatsAppMessage(senderPhone, 'No active draft order found. Type *MENU* to start.', env, { inboxMessageId });
          return;
        }

        // Idempotency: generate orderRef once and save in draft
        if (!draft.orderRef) {
          draft.orderRef = `SCH-${Date.now().toString(36).toUpperCase()}-${Math.floor(100 + Math.random() * 900)}`;
          await saveConversation(env.DB, senderPhone, session.state, session.data);
        }

        const orderRef = draft.orderRef;
        let subtotal = draft.subtotal;

        // Persist order only once
        if (!draft.orderPersisted) {
          const result = await createOrderRequest(env.DB, {
            orderRef,
            market,
            currency,
            destinationCountry: session.data.destinationCountry,
            customerPhone: senderPhone,
            items: [{
              productId: draft.productId,
              productName: draft.productName,
              quantity: draft.quantity,
            }],
            source: 'whatsapp_bot',
          });

          draft.orderPersisted = true;
          draft.subtotal = result.subtotal;
          subtotal = result.subtotal;
          await saveConversation(env.DB, senderPhone, session.state, session.data);
        }

        // Outbound delivery state tracking: prevents duplicate message on retry
        if (!draft.confirmationSent) {
          await sendWhatsAppMessage(
            senderPhone,
            `🎉 *Order Request Received!*\n\n` +
            `Order Reference: *#${orderRef}* \n` +
            `Item: ${draft.productName} (Qty: ${draft.quantity})\n` +
            `Subtotal: ${formatPrice(subtotal, market)}\n\n` +
            `Thank you! Our operations team has received your request. We will review stock availability and contact you on this number with exact shipping options and payment instructions.\n\n` +
            `Type *MENU* to return to the catalog.`,
            env,
            { inboxMessageId }
          );
          draft.confirmationSent = true;
          await saveConversation(env.DB, senderPhone, session.state, session.data);
        }

        session.state = 'MAIN_MENU';
        session.data.draftOrder = null;
        await saveConversation(env.DB, senderPhone, session.state, session.data);
        return;
      }

      if (lower === 'no' || lower === 'cancel' || lower === 'n') {
        session.state = 'MAIN_MENU';
        session.data.draftOrder = null;
        await saveConversation(env.DB, senderPhone, session.state, session.data);
        await sendWhatsAppMessage(senderPhone, `Order cancelled. Type *MENU* to return to the main menu.`, env, { inboxMessageId });
        return;
      }

      await sendWhatsAppMessage(senderPhone, `Please reply *YES* to confirm your order request, or *NO* to cancel.`, env, { inboxMessageId });
      return;
    }

    default: {
      session.state = 'MAIN_MENU';
      await saveConversation(env.DB, senderPhone, session.state, session.data);
      await sendWhatsAppMessage(senderPhone, `Type *MENU* to browse products or place an order.`, env, { inboxMessageId });
    }
  }
}

/**
 * Handles Meta Cloud API Webhook (GET challenge and POST ingestion)
 */
export async function handleWhatsAppWebhook(request, env) {
  const url = new URL(request.url);

  // GET: Webhook verification challenge
  if (request.method === 'GET') {
    const mode = url.searchParams.get('hub.mode');
    const token = url.searchParams.get('hub.verify_token');
    const challenge = url.searchParams.get('hub.challenge');

    const expectedToken = env.WHATSAPP_VERIFY_TOKEN;

    if (mode && token) {
      if (mode === 'subscribe' && token === expectedToken) {
        console.info('[WhatsApp Webhook] Verification challenge passed.');
        return new Response(challenge, { status: 200 });
      }
      return new Response(JSON.stringify({ error: 'Verify token mismatch' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ error: 'Missing hub.mode or hub.verify_token' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // POST: Incoming messages ingestion
  if (request.method === 'POST') {
    const rawBodyBuffer = await request.arrayBuffer();
    const appSecret = env.WHATSAPP_APP_SECRET;
    const isProd = env.NODE_ENV === 'production';

    const sigCheck = await verifyMetaSignature(request, rawBodyBuffer, appSecret, isProd);
    if (!sigCheck.valid) {
      return new Response(JSON.stringify({ error: sigCheck.error }), {
        status: sigCheck.status,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const textDecoder = new TextDecoder();
    let body;
    try {
      body = JSON.parse(textDecoder.decode(rawBodyBuffer));
    } catch (e) {
      return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (!body || body.object !== 'whatsapp_business_account') {
      return new Response('IGNORED_NON_WHATSAPP', { status: 200 });
    }

    const incomingEvents = [];
    const entries = body.entry || [];

    for (const entry of entries) {
      for (const change of entry.changes || []) {
        const val = change.value;
        if (!val) continue;

        // Ignore delivery receipts
        if (val.statuses && Array.isArray(val.statuses)) continue;

        const messages = val.messages;
        if (!Array.isArray(messages)) continue;

        for (const msg of messages) {
          const messageId = msg.id;
          const senderPhone = msg.from;
          let messageText = '';

          if (msg.type === 'text' && msg.text) {
            messageText = msg.text.body;
          } else if (msg.type === 'interactive' && msg.interactive) {
            if (msg.interactive.button_reply) {
              messageText = msg.interactive.button_reply.id || msg.interactive.button_reply.title;
            } else if (msg.interactive.list_reply) {
              messageText = msg.interactive.list_reply.id || msg.interactive.list_reply.title;
            }
          }

          if (messageId && senderPhone && messageText) {
            incomingEvents.push({
              messageId,
              senderPhone,
              messageText,
              rawPayload: msg,
            });
          }
        }
      }
    }

    if (incomingEvents.length === 0) {
      return new Response('EVENT_RECEIVED', { status: 200 });
    }

    // 1. Durably persist events to D1 BEFORE acknowledging HTTP 200
    try {
      for (const ev of incomingEvents) {
        await persistInboxEvent(env.DB, ev);
      }
    } catch (persistErr) {
      console.error('[CRITICAL] D1 durable queueing failed:', persistErr.message);
      // HTTP 503 so Meta knows delivery failed and will retry
      return new Response(JSON.stringify({ error: 'Storage unavailable: Ingestion pipeline offline' }), {
        status: 503,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // 2. Only after durable persistence succeeds do we acknowledge HTTP 200
    return new Response('EVENT_RECEIVED', { status: 200 });
  }

  return new Response('Method Not Allowed', { status: 405 });
}
