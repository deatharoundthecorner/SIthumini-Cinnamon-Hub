/**
 * Sithumini Cinnamon Hub: WhatsApp Business Automation State Engine
 * Official Meta WhatsApp Cloud API (Graph API v26.0+)
 */

import { isProduction, safeMaskPhone } from '../config.js';
import {
  getProducts,
  createOrderRequest,
  saveCustomerReview,
  getConversationSession,
  saveConversationSession,
} from '../db/supabaseClient.js';
import { getNumericPrice, formatPrice } from '../../utils/pricingCore.js';

/**
 * Sends a WhatsApp text message via Meta Cloud API.
 * Uses Meta Test Number during development without touching live business numbers.
 */
export async function sendWhatsAppMessage(to, bodyText) {
  const isProd = process.env.NODE_ENV === 'production';
  const token = process.env.WHATSAPP_ACCESS_TOKEN;
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;

  if (isProd) {
    if (process.env.WHATSAPP_SIMULATION_MODE === 'true') {
      throw new Error('Simulation mode is strictly prohibited in production.');
    }
    if (!token || !phoneNumberId) {
      throw new Error('Meta WhatsApp credentials missing: WHATSAPP_ACCESS_TOKEN or WHATSAPP_PHONE_NUMBER_ID is not configured in production.');
    }
  } else if (!token || !phoneNumberId || process.env.WHATSAPP_SIMULATION_MODE === 'true' || (process.env.NODE_ENV === 'test' && !process.env.TEST_REAL_WHATSAPP_CALLS)) {
    console.info('[WhatsApp Simulation]', {
      to: safeMaskPhone(to),
      preview: bodyText.slice(0, 80) + '...',
    });
    return { ok: true, simulated: true };
  }

  const graphVersion = process.env.META_GRAPH_API_VERSION || 'v26.0';
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
  return { ok: true, data };
}

async function notifyOwner(summaryText) {
  const ownerPhone = process.env.OWNER_PHONE_NUMBER;
  if (!ownerPhone) return;

  try {
    await sendWhatsAppMessage(ownerPhone, `[ALERT - Sithumini Cinnamon Hub]\n${summaryText}`);
  } catch (e) {
    console.warn('[Owner Notification Error]', e.message);
  }
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

  return `${header}\n${lines.join('\n\n')}\n\nType *ORDER* to request an item, or *AGENT* to speak with our manager.`;
}

/**
 * Main incoming message dispatcher and conversation state engine.
 */
export async function handleIncomingMessage(senderPhone, messageText) {
  if (!senderPhone || !messageText) return;

  const text = messageText.trim();
  const lower = text.toLowerCase();

  const session = await getConversationSession(senderPhone);
  const market = session.data.market || 'lk';
  const currency = session.data.currency || (market === 'lk' ? 'LKR' : 'USD');

  // Global command: Reset
  if (lower === 'hi' || lower === 'hello' || lower === 'start' || lower === 'reset') {
    session.state = 'AWAITING_MARKET';
    session.data = {};
    await saveConversationSession(senderPhone, session.state, session.data);

    await sendWhatsAppMessage(
      senderPhone,
      `🌿 *Welcome to Sithumini Cinnamon Hub!*\n` +
      `Authentic Ceylon Cinnamon direct from our gardens in Southern Sri Lanka.\n\n` +
      `Please select your delivery location:\n` +
      `1️⃣ *Sri Lanka* (Local LKR Prices)\n` +
      `2️⃣ *International Export* (USD Prices)\n\n` +
      `_Reply with 1 or 2_`
    );
    return;
  }

  // Global command: Agent escalation (no invented fake phone numbers or fake emails)
  if (lower === 'agent' || lower === 'manager' || lower === 'help' || lower === 'contact') {
    const ownerContact = process.env.OWNER_PHONE_NUMBER ? ` (+${process.env.OWNER_PHONE_NUMBER})` : '';
    await sendWhatsAppMessage(
      senderPhone,
      `📞 *Connecting with Management*\n\n` +
      `Our operations manager${ownerContact} has been notified and will respond directly to this WhatsApp chat.\n\n` +
      `Type *MENU* to return to the catalog.`
    );

    await notifyOwner(
      `Customer at ${safeMaskPhone(senderPhone)} requested manager assistance.\nLast message: "${text}"`
    );
    return;
  }

  // Global command: Menu
  if (lower === 'menu') {
    session.state = 'MAIN_MENU';
    await saveConversationSession(senderPhone, session.state, session.data);

    await sendWhatsAppMessage(
      senderPhone,
      `🌿 *Main Menu* (${market === 'lk' ? 'Sri Lanka - LKR' : `International - USD | Dest: ${session.data.destinationCountry || 'Unspecified'}`})\n\n` +
      `1️⃣ *Catalog* — Browse products & prices\n` +
      `2️⃣ *Order* — Place an order request\n` +
      `3️⃣ *Review* — Submit customer feedback\n` +
      `4️⃣ *Change Market* — Switch between local & export\n` +
      `💬 *Agent* — Connect with our manager\n\n` +
      `_Reply with 1, 2, 3, or 4_`
    );
    return;
  }

  switch (session.state) {
    case 'AWAITING_MARKET': {
      if (lower === '1' || lower.includes('sri lanka') || lower.includes('local') || lower.includes('lkr')) {
        session.data.market = 'lk';
        session.data.currency = 'LKR';
        session.data.destinationCountry = 'Sri Lanka';
        session.state = 'MAIN_MENU';
        await saveConversationSession(senderPhone, session.state, session.data);

        await sendWhatsAppMessage(
          senderPhone,
          `🇱🇰 *Market set to Sri Lanka (LKR)*\n\n` +
          `What would you like to do?\n` +
          `1️⃣ *Catalog* — View local prices\n` +
          `2️⃣ *Order* — Submit order request\n` +
          `3️⃣ *Review* — Leave a review\n\n` +
          `_Reply with 1, 2, or 3_`
        );
        return;
      }

      if (lower === '2' || lower.includes('international') || lower.includes('export') || lower.includes('usd')) {
        session.data.market = 'intl';
        session.data.currency = 'USD';
        session.state = 'AWAITING_DESTINATION_COUNTRY';
        await saveConversationSession(senderPhone, session.state, session.data);

        await sendWhatsAppMessage(
          senderPhone,
          `🌍 *International Export Selected*\n\n` +
          `Please reply with your *destination country* (e.g. United Kingdom, United States, UAE, Australia, Germany):`
        );
        return;
      }

      await sendWhatsAppMessage(
        senderPhone,
        `⚠️ Please reply with *1* for Sri Lanka (LKR) or *2* for International Export (USD).`
      );
      return;
    }

    case 'AWAITING_DESTINATION_COUNTRY': {
      if (text.length < 2) {
        await sendWhatsAppMessage(senderPhone, `⚠️ Please enter a valid destination country name:`);
        return;
      }

      session.data.destinationCountry = text;
      session.state = 'MAIN_MENU';
      await saveConversationSession(senderPhone, session.state, session.data);

      await sendWhatsAppMessage(
        senderPhone,
        `🌍 *Destination Country:* ${text}\n` +
        `Currency: USD (Export rates)\n\n` +
        `What would you like to do?\n` +
        `1️⃣ *Catalog* — View export pricing\n` +
        `2️⃣ *Order* — Request an export quote/order\n` +
        `3️⃣ *Review* — Leave customer feedback\n\n` +
        `_Reply with 1, 2, or 3_`
      );
      return;
    }

    case 'MAIN_MENU': {
      if (lower === '1' || lower === 'catalog' || lower.includes('product')) {
        const products = await getProducts();
        const catalogMsg = formatCatalogMessage(products, market);
        await sendWhatsAppMessage(senderPhone, catalogMsg);
        return;
      }

      if (lower === '2' || lower === 'order') {
        session.state = 'ORDER_SELECT_PRODUCT';
        await saveConversationSession(senderPhone, session.state, session.data);

        const products = await getProducts();
        const catalogMsg = formatCatalogMessage(products, market);

        await sendWhatsAppMessage(
          senderPhone,
          `${catalogMsg}\n\n` +
          `📝 *Please enter the Product Number (1-${products.length}) or SKU to order:*`
        );
        return;
      }

      if (lower === '3' || lower === 'review') {
        session.state = 'AWAITING_REVIEW';
        await saveConversationSession(senderPhone, session.state, session.data);

        await sendWhatsAppMessage(
          senderPhone,
          `⭐ *Customer Feedback & Reviews*\n\n` +
          `We value your experience! Please reply with your rating from 1 to 5 stars and your comments.\n\n` +
          `_Example: 5 Excellent pure cinnamon, very fragrant and fresh._`
        );
        return;
      }

      if (lower === '4' || lower.includes('change') || lower.includes('market')) {
        session.state = 'AWAITING_MARKET';
        await saveConversationSession(senderPhone, session.state, session.data);

        await sendWhatsAppMessage(
          senderPhone,
          `Select your ordering location:\n` +
          `1️⃣ Sri Lanka (LKR)\n` +
          `2️⃣ International Export (USD)`
        );
        return;
      }

      await sendWhatsAppMessage(
        senderPhone,
        `Type *1* for Catalog, *2* for Order, *3* for Review, or *AGENT* for manager assistance.`
      );
      return;
    }

    case 'ORDER_SELECT_PRODUCT': {
      const products = await getProducts();
      const num = parseInt(text, 10);
      let selectedProduct = null;

      if (!isNaN(num) && num >= 1 && num <= products.length) {
        selectedProduct = products[num - 1];
      } else {
        selectedProduct = products.find(
          (p) => String(p.id) === text || p.name.toLowerCase().includes(lower)
        );
      }

      if (!selectedProduct) {
        await sendWhatsAppMessage(
          senderPhone,
          `⚠️ Product not found. Please enter a valid number (1-${products.length}) or type *MENU* to cancel.`
        );
        return;
      }

      const numericPrice = getNumericPrice(selectedProduct, market);

      // Unconfigured international price triggers custom quote
      if (market === 'intl' && numericPrice === null) {
        session.state = 'MAIN_MENU';
        await saveConversationSession(senderPhone, session.state, session.data);

        await sendWhatsAppMessage(
          senderPhone,
          `📦 *Export Quotation Request: ${selectedProduct.name}*\n\n` +
          `Export pricing for this item is provided by custom quote depending on batch quantity and destination (${session.data.destinationCountry || 'International'}).\n\n` +
          `Our export manager has been alerted to provide a freight and product quote. We will message you shortly!\n\n` +
          `Type *MENU* to browse other items.`
        );

        await notifyOwner(
          `Export Quote Request from ${safeMaskPhone(senderPhone)}\n` +
          `Product: ${selectedProduct.name} (ID: ${selectedProduct.id})\n` +
          `Destination: ${session.data.destinationCountry || 'Unspecified'}`
        );
        return;
      }

      session.data.selectedProductId = selectedProduct.id;
      session.data.selectedProductName = selectedProduct.name;
      session.data.selectedUnitPrice = numericPrice;
      session.state = 'ORDER_ENTER_QUANTITY';
      await saveConversationSession(senderPhone, session.state, session.data);

      const priceFormatted = formatPrice(numericPrice, market);

      await sendWhatsAppMessage(
        senderPhone,
        `✅ *Selected:* ${selectedProduct.name}\n` +
        `Unit Price: ${priceFormatted}\n\n` +
        `How many packs/units would you like to order?\n` +
        `_Please reply with a positive whole number (e.g. 1, 2, 5):_`
      );
      return;
    }

    case 'ORDER_ENTER_QUANTITY': {
      const qty = parseInt(text, 10);

      // Strict validation
      if (isNaN(qty) || qty <= 0 || !Number.isInteger(Number(text)) || qty > 1000) {
        await sendWhatsAppMessage(
          senderPhone,
          `⚠️ *Invalid quantity.* Please enter a whole number from 1 to 1000.\n_Or type MENU to cancel._`
        );
        return;
      }

      const unitPrice = session.data.selectedUnitPrice || 0;
      const subtotal = qty * unitPrice;
      const subtotalFormatted = formatPrice(subtotal, market);

      session.data.draftOrder = {
        productId: session.data.selectedProductId,
        productName: session.data.selectedProductName,
        quantity: qty,
        unitPrice: unitPrice,
        subtotal: subtotal,
      };

      session.state = 'ORDER_CONFIRMATION';
      await saveConversationSession(senderPhone, session.state, session.data);

      await sendWhatsAppMessage(
        senderPhone,
        `📋 *Order Request Summary*\n` +
        `────────────────────────\n` +
        `• Product: *${session.data.selectedProductName}*\n` +
        `• Quantity: *${qty}*\n` +
        `• Merchandise Subtotal: *${subtotalFormatted}*\n` +
        `• Destination: *${session.data.destinationCountry || (market === 'lk' ? 'Sri Lanka' : 'Export')}*\n` +
        `• Shipping Fee: _Calculated separately upon courier/freight quotation._\n` +
        `────────────────────────\n` +
        `⚠️ *Important:* This creates an *Order Request*. It is not yet charged or final.\n\n` +
        `Reply *YES* to submit this order request, or *NO* to cancel.`
      );
      return;
    }

    case 'ORDER_CONFIRMATION': {
      if (lower === 'yes' || lower === 'confirm' || lower === 'y') {
        const draft = session.data.draftOrder;
        if (!draft) {
          session.state = 'MAIN_MENU';
          await saveConversationSession(senderPhone, session.state, session.data);
          await sendWhatsAppMessage(senderPhone, 'No active draft order found. Type *MENU* to start.');
          return;
        }

        if (!draft.orderRef) {
          draft.orderRef = `SCH-${Date.now().toString(36).toUpperCase()}-${Math.floor(100 + Math.random() * 900)}`;
          await saveConversationSession(senderPhone, session.state, session.data);
        }

        const orderRef = draft.orderRef;
        let subtotal = draft.subtotal;

        if (!draft.orderPersisted) {
          const result = await createOrderRequest({
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

          if (!result.persisted && process.env.NODE_ENV === 'production') {
            throw new Error('Database persistence failed: Order could not be saved in production.');
          }

          draft.orderPersisted = true;
          draft.subtotal = result.subtotal;
          subtotal = result.subtotal;
          await saveConversationSession(senderPhone, session.state, session.data);
        }

        if (!draft.confirmationSent) {
          await sendWhatsAppMessage(
            senderPhone,
            `🎉 *Order Request Received!*\n\n` +
            `Order Reference: *#${orderRef}* \n` +
            `Item: ${draft.productName} (Qty: ${draft.quantity})\n` +
            `Subtotal: ${formatPrice(subtotal, market)}\n\n` +
            `Thank you! Our operations team has received your request. We will review stock availability and contact you on this number with exact shipping options and payment instructions.\n\n` +
            `Type *MENU* to return to the catalog.`
          );
          draft.confirmationSent = true;
          await saveConversationSession(senderPhone, session.state, session.data);
        }

        await notifyOwner(
          `🛒 NEW ORDER REQUEST #${orderRef}\n` +
          `Customer: ${safeMaskPhone(senderPhone)}\n` +
          `Item: ${draft.productName} x ${draft.quantity}\n` +
          `Subtotal: ${formatPrice(subtotal, market)}\n` +
          `Dest: ${session.data.destinationCountry || (market === 'lk' ? 'Sri Lanka' : 'Export')}`
        );

        session.state = 'MAIN_MENU';
        session.data.draftOrder = null;
        await saveConversationSession(senderPhone, session.state, session.data);
        return;
      }

      if (lower === 'no' || lower === 'cancel' || lower === 'n') {
        session.state = 'MAIN_MENU';
        session.data.draftOrder = null;
        await saveConversationSession(senderPhone, session.state, session.data);

        await sendWhatsAppMessage(senderPhone, `Order cancelled. Type *MENU* to return to the main menu.`);
        return;
      }

      await sendWhatsAppMessage(senderPhone, `Please reply *YES* to confirm your order request, or *NO* to cancel.`);
      return;
    }

    case 'AWAITING_REVIEW': {
      const starMatch = text.match(/[1-5]/);
      const rating = starMatch ? parseInt(starMatch[0], 10) : 5;

      try {
        const revResult = await saveCustomerReview({
          customerPhone: senderPhone,
          rating,
          comment: text,
          source: 'whatsapp_bot',
        });

        if (!revResult.persisted && isProduction) {
          await sendWhatsAppMessage(
            senderPhone,
            `⚠️ Feedback storage is temporarily undergoing maintenance. Please try submitting again later.`
          );
          return;
        }

        session.state = 'MAIN_MENU';
        await saveConversationSession(senderPhone, session.state, session.data);

        await sendWhatsAppMessage(
          senderPhone,
          `🙏 *Thank You for Your Feedback!*\n\n` +
          `Your rating (${rating}/5 stars) has been submitted to our moderation queue. Once verified by our team, it will appear on our website.\n\n` +
          `Type *MENU* to return to the catalog.`
        );
      } catch (revErr) {
        console.error('[Review DB Error]', revErr.message);
        await sendWhatsAppMessage(
          senderPhone,
          `⚠️ We could not save your review at this moment. Please type *MENU* to return.`
        );
      }
      return;
    }

    default:
      session.state = 'AWAITING_MARKET';
      await saveConversationSession(senderPhone, session.state, session.data);
      await sendWhatsAppMessage(
        senderPhone,
        `Welcome to Sithumini Cinnamon Hub! Type *HI* to begin.`
      );
  }
}
