/**
 * Cloudflare Worker: Durable WhatsApp Inbox Processing Engine
 * Executed via Cloudflare Cron Triggers or secure on-demand admin invocation.
 * Bounded batch size, lease recovery, and dead-letter queue.
 */

import {
  getPendingInboxMessages,
  claimInboxLock,
  completeInboxMessage,
  recordInboxFailure,
} from './db.js';
import { handleIncomingMessage } from './whatsapp.js';

export async function processD1InboxQueue(env, { batchSize = 10 } = {}) {
  if (!env.DB) {
    return { error: 'D1 database binding DB is not available', processed: 0, succeeded: 0, failed: 0 };
  }

  const pending = await getPendingInboxMessages(env.DB, batchSize);

  const summary = {
    totalFound: pending.length,
    processed: 0,
    succeeded: 0,
    failed: 0,
    skipped: 0,
    errors: [],
  };

  for (const msg of pending) {
    const messageId = msg.message_id;
    const senderPhone = msg.sender_phone;
    const messageText = msg.message_text;

    if (!messageId) continue;

    // Atomically claim lock using conditional D1 update
    let claimResult;
    try {
      claimResult = await claimInboxLock(env.DB, messageId, { bypassBackoff: true });
    } catch (lockErr) {
      console.error(`[D1 Inbox Worker] Lock error for ${messageId}:`, lockErr.message);
      summary.errors.push({ messageId, error: lockErr.message });
      summary.failed++;
      continue;
    }

    if (!claimResult.claimed) {
      summary.skipped++;
      continue;
    }

    summary.processed++;

    try {
      await handleIncomingMessage(senderPhone, messageText, env, { inboxMessageId: messageId });
      await completeInboxMessage(env.DB, messageId);
      summary.succeeded++;
    } catch (execErr) {
      console.error(`[D1 Inbox Worker] Message ${messageId} processing failed:`, execErr.message);
      summary.failed++;
      summary.errors.push({ messageId, error: execErr.message });

      try {
        await recordInboxFailure(env.DB, messageId, execErr.message);
      } catch (recErr) {
        console.error(`[D1 Inbox Worker] Failed recording failure for ${messageId}:`, recErr.message);
      }
    }
  }

  return summary;
}
