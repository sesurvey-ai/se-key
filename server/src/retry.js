// Background retry loop — periodically re-attempts records with isurvey_sent=0
// that haven't exceeded RETRY_MAX_ATTEMPTS. Uses exponential backoff per row
// so a row that keeps failing doesn't hammer iSurvey.

import { db } from './db.js';
import { sendRecordToIsurvey } from './send-isurvey.js';
import { log } from './logger.js';

// Policy: iSurvey should only fire in direct response to the "ส่งงานใหม่"
// button + success popup. So retry defaults to OFF — opt in with
// RETRY_ENABLED=1 only if you explicitly want automatic re-attempts.
const ENABLED      = process.env.RETRY_ENABLED === '1';
const INTERVAL_MS  = Number(process.env.RETRY_INTERVAL_MS)  || 5 * 60 * 1000;
const BATCH_SIZE   = Number(process.env.RETRY_BATCH_SIZE)   || 20;
const MAX_ATTEMPTS = Number(process.env.RETRY_MAX_ATTEMPTS) || 10;

// 0 attempts → 60s, 1 → 120s, 2 → 240s, …, capped at 1h.
function backoffSeconds(retry_count) {
  return Math.min(60 * Math.pow(2, retry_count), 3600);
}

// Pull a superset in SQL; per-row backoff filter is cheap enough in JS.
const pickStmt = db.prepare(`
  SELECT id, retry_count, last_retry_at
  FROM records
  WHERE isurvey_sent = 0
    AND retry_count < ?
    AND work_type IN ('งานต้น','งานตาม','งานรวม')
  ORDER BY id ASC
  LIMIT ?
`);

// The local-time stamp like "2026-04-20 13:59:21.000000" isn't ISO, so
// `Date.parse` needs a tiny nudge before it accepts it.
function parseLocalStamp(s) {
  if (!s) return null;
  const t = Date.parse(s.replace(' ', 'T'));
  return Number.isFinite(t) ? t : null;
}

async function tick() {
  try {
    const candidates = pickStmt.all(MAX_ATTEMPTS, BATCH_SIZE * 5);
    let processed = 0, sent = 0, failed = 0, skipped = 0;

    for (const r of candidates) {
      if (processed >= BATCH_SIZE) break;

      const lastMs = parseLocalStamp(r.last_retry_at);
      if (lastMs != null) {
        const elapsed = (Date.now() - lastMs) / 1000;
        if (elapsed < backoffSeconds(r.retry_count)) { skipped++; continue; }
      }

      processed++;
      const result = await sendRecordToIsurvey(r.id);
      if (result.sent || result.skipped) sent++;
      else failed++;
    }

    if (processed > 0 || failed > 0) {
      log.info('retry.tick', { processed, sent, failed, backoff_skipped: skipped });
    }
  } catch (err) {
    log.error('retry.tick.error', { error: String(err.message || err) });
  }
}

export function startRetryLoop() {
  if (!ENABLED) {
    log.info('retry.disabled');
    return;
  }
  log.info('retry.start', {
    interval_ms:  INTERVAL_MS,
    batch_size:   BATCH_SIZE,
    max_attempts: MAX_ATTEMPTS,
  });
  // Short warmup before first tick so a crash-loop doesn't DDOS iSurvey.
  setTimeout(tick, 15_000);
  setInterval(tick, INTERVAL_MS);
}
