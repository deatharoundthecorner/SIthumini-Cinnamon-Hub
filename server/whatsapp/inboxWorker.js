/**
 * Sithumini Cinnamon Hub: Durable WhatsApp Inbox Processing Worker
 * Discovers and processes pending and retry-eligible messages from whatsapp_inbox.
 * Supports both on-demand execution (cron trigger) and persistent daemon mode.
 */

import {
  getPendingInboxMessages,
  claimInboxLock,
  completeInboxMessage,
  recordInboxFailure,
} from '../db/supabaseClient.js';
import { handleIncomingMessage } from './botHandler.js';

/**
 * Runs a single batch execution of pending and retry-eligible inbox messages.
 */
export async function processInboxQueue({ batchSize = 20 } = {}) {
  const pendingMessages = await getPendingInboxMessages(batchSize);

  const summary = {
    totalFound: pendingMessages.length,
    processed: 0,
    succeeded: 0,
    failed: 0,
    skipped: 0,
    errors: [],
  };

  for (const msg of pendingMessages) {
    const messageId = msg.message_id || msg.messageId;
    const senderPhone = msg.sender_phone || msg.senderPhone;
    const messageText = msg.message_text || msg.messageText;

    if (!messageId) continue;

    // Atomically claim the message using PostgreSQL FOR UPDATE lock
    let claimResult;
    try {
      claimResult = await claimInboxLock(messageId, { bypassBackoff: true });
    } catch (lockErr) {
      console.error(`[Inbox Worker] Failed to acquire lock for ${messageId}: ${lockErr.message}`);
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
      await handleIncomingMessage(senderPhone, messageText);
      await completeInboxMessage(messageId);
      summary.succeeded++;
    } catch (execErr) {
      console.error(`[Inbox Worker] Message ${messageId} execution failed: ${execErr.message}`);
      summary.failed++;
      summary.errors.push({ messageId, error: execErr.message });

      try {
        await recordInboxFailure(messageId, execErr.message);
      } catch (recErr) {
        console.error(`[Inbox Worker] Failed to record error state for ${messageId}: ${recErr.message}`);
      }
    }
  }

  return summary;
}

/**
 * Persistent Background Daemon Runner (for continuous environments)
 */
let daemonTimer = null;
let isDaemonRunning = false;

export function startInboxWorkerDaemon({ intervalMs = 15000, batchSize = 20 } = {}) {
  if (daemonTimer) return;

  console.info(`[Inbox Worker] Starting persistent background daemon (polling every ${intervalMs / 1000}s)`);

  const loop = async () => {
    if (isDaemonRunning) return;
    isDaemonRunning = true;

    try {
      const summary = await processInboxQueue({ batchSize });
      if (summary.processed > 0) {
        console.info(`[Inbox Worker] Batch completed: ${summary.succeeded} succeeded, ${summary.failed} failed of ${summary.processed} claimed.`);
      }
    } catch (err) {
      console.error('[Inbox Worker Daemon Error]', err.message);
    } finally {
      isDaemonRunning = false;
    }
  };

  daemonTimer = setInterval(loop, intervalMs);
  loop().catch(() => {});
}

export function stopInboxWorkerDaemon() {
  if (daemonTimer) {
    clearInterval(daemonTimer);
    daemonTimer = null;
    console.info('[Inbox Worker] Persistent background daemon stopped.');
  }
}
