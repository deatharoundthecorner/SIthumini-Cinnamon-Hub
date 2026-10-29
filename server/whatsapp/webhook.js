/**
 * Official Meta WhatsApp Cloud API Webhook Controller
 * Reliable Ingestion: Complete events are durably persisted to the inbox queue
 * BEFORE HTTP 200 acknowledgment.
 * Atomic inbox lock claiming, error tracking, and signature verification.
 */

import express from 'express';
import crypto from 'crypto';
import rateLimit from 'express-rate-limit';
import { handleIncomingMessage } from './botHandler.js';
import {
  persistWebhookEventToInbox,
  claimInboxLock,
  completeInboxMessage,
  recordInboxFailure,
} from '../db/supabaseClient.js';
import { isProduction, safeMaskPhone } from '../config.js';

const router = express.Router();

const webhookLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  message: { error: 'Too many requests' },
});

/**
 * Middleware: Validates Meta X-Hub-Signature-256 against WHATSAPP_APP_SECRET.
 * Strict Fail-Closed in production.
 */
export function verifyMetaSignature(req, res, next) {
  const appSecret = process.env.WHATSAPP_APP_SECRET;

  if (!appSecret) {
    if (isProduction) {
      console.error('[SECURITY FATAL] Webhook received in production without configured WHATSAPP_APP_SECRET. Rejected.');
      return res.status(500).json({ error: 'Server configuration error: Webhook signature verification unavailable' });
    }

    if (process.env.ALLOW_INSECURE_WEBHOOK_BYPASS === 'true') {
      console.warn('[SECURITY WARNING] Bypassing webhook signature verification because ALLOW_INSECURE_WEBHOOK_BYPASS=true in non-production.');
      return next();
    }

    return res.status(401).json({ error: 'WHATSAPP_APP_SECRET is not configured' });
  }

  const signatureHeader = req.headers['x-hub-signature-256'];
  if (!signatureHeader) {
    console.warn('[Webhook Auth] Missing X-Hub-Signature-256 header');
    return res.status(401).json({ error: 'Missing X-Hub-Signature-256 header' });
  }

  const parts = signatureHeader.split('=');
  if (parts.length !== 2 || parts[0] !== 'sha256') {
    console.warn('[Webhook Auth] Malformed signature format');
    return res.status(401).json({ error: 'Invalid signature format' });
  }

  const signature = parts[1];
  const rawBody = req.rawBody || Buffer.from(JSON.stringify(req.body || {}));
  const expectedSignature = crypto.createHmac('sha256', appSecret).update(rawBody).digest('hex');

  const sigBuffer = Buffer.from(signature, 'utf8');
  const expBuffer = Buffer.from(expectedSignature, 'utf8');

  if (sigBuffer.length !== expBuffer.length || !crypto.timingSafeEqual(sigBuffer, expBuffer)) {
    console.warn('[Webhook Auth] Signature verification mismatch');
    return res.status(403).json({ error: 'Invalid webhook signature' });
  }

  return next();
}

/**
 * GET /api/whatsapp/webhook
 * Meta Cloud API verification challenge endpoint.
 */
router.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  const VERIFY_TOKEN = process.env.WHATSAPP_VERIFY_TOKEN;

  if (mode && token) {
    if (mode === 'subscribe' && token === VERIFY_TOKEN) {
      console.info('[WhatsApp Webhook] Verification successful');
      return res.status(200).send(challenge);
    } else {
      console.warn('[WhatsApp Webhook] Verification token mismatch');
      return res.status(403).json({ error: 'Verify token mismatch' });
    }
  }

  return res.status(400).json({ error: 'Missing hub.mode or hub.verify_token' });
});

/**
 * Executes business logic for a single claimed inbox message.
 */
async function processInboxEvent(messageId, senderPhone, messageText) {
  const claimResult = await claimInboxLock(messageId);
  if (!claimResult.claimed) {
    console.info(`[Inbox Lock] Message ${messageId} skipped (${claimResult.reason})`);
    return;
  }

  try {
    await handleIncomingMessage(senderPhone, messageText);
    await completeInboxMessage(messageId);
  } catch (err) {
    console.error(`[Inbox Processing Error] Message ${messageId} failed:`, err.message);
    await recordInboxFailure(messageId, err.message);
  }
}

/**
 * POST /api/whatsapp/webhook
 * Ingests incoming messages durably into inbox queue BEFORE sending HTTP 200.
 */
router.post('/webhook', webhookLimiter, verifyMetaSignature, async (req, res) => {
  const body = req.body;

  if (!body || body.object !== 'whatsapp_business_account') {
    return res.status(200).send('IGNORED_NON_WHATSAPP');
  }

  const incomingEvents = [];
  const entries = body.entry || [];

  for (const entry of entries) {
    const changes = entry.changes || [];
    for (const change of changes) {
      const value = change.value;
      if (!value) continue;

      // Safely ignore delivery receipts/status updates
      if (value.statuses && Array.isArray(value.statuses)) {
        continue;
      }

      const messages = value.messages;
      if (!Array.isArray(messages) || messages.length === 0) {
        continue;
      }

      for (const message of messages) {
        const messageId = message.id;
        const senderPhone = message.from;
        let messageText = '';

        if (message.type === 'text' && message.text) {
          messageText = message.text.body;
        } else if (message.type === 'interactive' && message.interactive) {
          if (message.interactive.button_reply) {
            messageText = message.interactive.button_reply.id || message.interactive.button_reply.title;
          } else if (message.interactive.list_reply) {
            messageText = message.interactive.list_reply.id || message.interactive.list_reply.title;
          }
        } else {
          console.info(`[WhatsApp Bot] Ignored unsupported message type '${message.type}' from ${safeMaskPhone(senderPhone)}`);
          continue;
        }

        if (messageId && senderPhone && messageText) {
          incomingEvents.push({
            messageId,
            senderPhone,
            messageText,
            rawPayload: message,
          });
        }
      }
    }
  }

  // Acknowledge if nothing to process (e.g. status receipts)
  if (incomingEvents.length === 0) {
    return res.status(200).send('EVENT_RECEIVED');
  }

  // 1. Durably persist events to inbox BEFORE acknowledgment
  try {
    for (const ev of incomingEvents) {
      await persistWebhookEventToInbox(ev);
    }
  } catch (persistErr) {
    console.error('[CRITICAL] Webhook durable queueing failed:', persistErr.message);
    // Return HTTP 503 so Meta knows delivery failed and will automatically retry
    return res.status(503).json({ error: 'Storage unavailable: Ingestion pipeline offline' });
  }

  // 2. Only after events are durably persisted do we acknowledge HTTP 200
  res.status(200).send('EVENT_RECEIVED');

  // 3. Process inbox events with atomic locking and failure tracking
  for (const ev of incomingEvents) {
    processInboxEvent(ev.messageId, ev.senderPhone, ev.messageText).catch((err) => {
      console.error('[Unhandled Inbox Error]', err.message);
    });
  }
});

export default router;
