// Shared iSurvey sender — used by both POST /api/send-isurvey and the
// background retry loop. Returns a plain object describing the outcome;
// callers are responsible for mapping that to an HTTP response.

import { db } from './db.js';
import { buildIsurveyPayload, shouldSendToIsurvey } from './isurvey.js';
import { log } from './logger.js';

const selectByIdStmt = db.prepare('SELECT * FROM records WHERE id = ?');
const markSentStmt   = db.prepare(
  'UPDATE records SET isurvey_sent = 1, retry_error = NULL WHERE id = ?'
);
const markRetryStmt  = db.prepare(`
  UPDATE records
  SET retry_count   = retry_count + 1,
      last_retry_at = datetime('now','localtime'),
      retry_error   = ?
  WHERE id = ?
`);

const ISURVEY_URL            = process.env.ISURVEY_URL        || 'https://se.isurvey.mobi/service/srvEMCSrpt.php';
const ISURVEY_USER_ID        = process.env.ISURVEY_USER_ID    || 'sesurvey';
const ISURVEY_PASSWORD       = process.env.ISURVEY_PASSWORD   || 'pass1234';
const ISURVEY_TIMEOUT_MS     = Number(process.env.ISURVEY_TIMEOUT_MS)     || 30000;
// In-request retries for transient upstream issues (slow iSurvey, 5xx,
// network blips). 4xx is treated as final — retrying won't fix a bad
// payload. Total attempts = ISURVEY_RETRIES + 1.
const ISURVEY_RETRIES        = Number(process.env.ISURVEY_RETRIES)        || 2;
const ISURVEY_RETRY_DELAY_MS = Number(process.env.ISURVEY_RETRY_DELAY_MS) || 2000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Returns { ok, status?, body?, error?, attempts }.
// On ok=true, body contains iSurvey's text response. On ok=false, error
// describes the final failure. `attempts` is how many HTTP calls were made.
async function postToIsurveyWithRetry(payload) {
  let lastStatus = null;
  let lastBody   = '';
  let lastError  = null;

  for (let attempt = 1; attempt <= ISURVEY_RETRIES + 1; attempt++) {
    if (attempt > 1) {
      await sleep(ISURVEY_RETRY_DELAY_MS * Math.pow(2, attempt - 2));
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ISURVEY_TIMEOUT_MS);
    try {
      const resp = await fetch(ISURVEY_URL, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(payload),
        signal:  controller.signal,
      });
      const text = await resp.text();

      if (resp.ok) return { ok: true, body: text, attempts: attempt };

      lastStatus = resp.status;
      lastBody   = text;
      lastError  = `iSurvey ${resp.status}: ${text.slice(0, 200)}`;

      // 4xx → payload/auth problem, won't recover on retry.
      if (resp.status >= 400 && resp.status < 500) {
        return { ok: false, status: resp.status, body: text, error: lastError, attempts: attempt };
      }
      // 5xx → fall through to retry.
      log.warn('isurvey.attempt_5xx', { attempt, status: resp.status });
    } catch (err) {
      lastError = err.name === 'AbortError'
        ? 'iSurvey request timed out'
        : String(err.message || err);
      log.warn('isurvey.attempt_error', { attempt, error: lastError });
    } finally {
      clearTimeout(timer);
    }
  }

  return { ok: false, status: lastStatus, body: lastBody, error: lastError, attempts: ISURVEY_RETRIES + 1 };
}

export async function sendRecordToIsurvey(id, { force = false } = {}) {
  const row = selectByIdStmt.get(id);
  if (!row) return { notFound: true };

  if (row.isurvey_sent === 1 && !force) {
    return { sent: true, alreadySent: true, record: row };
  }

  // Manual resend of an already-sent row: skip retry bookkeeping on failure
  // since the retry loop only picks up pending (sent=0) rows, and a manual
  // resend shouldn't count against MAX_ATTEMPTS.
  const isForceResend = row.isurvey_sent === 1;

  // Unknown work_types: flip the flag locally so retry loop leaves them
  // alone, but don't call iSurvey.
  if (!shouldSendToIsurvey(row)) {
    markSentStmt.run(id);
    return {
      sent: false, skipped: true,
      reason: `work_type "${row.work_type}" is not forwarded to iSurvey`,
      record: selectByIdStmt.get(id),
    };
  }

  // SESV needs invoice_mix (the linked SEABI invoice) — SESV-xxx itself
  // isn't claimable. Refuse to send if missing; mark retry_error so it
  // shows up in admin and stays sent=0 (legacy/admin-broken rows). Doesn't
  // count against retry attempts since the issue isn't transient.
  if (row.work_type === 'SESV' && !row.invoice_mix) {
    const errMsg = 'SESV missing invoice_mix — refusing to send';
    if (!isForceResend) markRetryStmt.run(errMsg, id);
    log.warn('isurvey.refuse_sesv_no_invoice', { id, claim_no: row.claim_no });
    return {
      sent: false,
      refused: true,
      error: errMsg,
      attempts: 0,
    };
  }

  const payload = buildIsurveyPayload(row, {
    userId:   ISURVEY_USER_ID,
    password: ISURVEY_PASSWORD,
  });

  const result = await postToIsurveyWithRetry(payload);

  if (!result.ok) {
    if (!isForceResend) markRetryStmt.run(result.error, id);
    log.warn('isurvey.upstream_fail', {
      id, status: result.status, attempts: result.attempts,
      body: (result.body || '').slice(0, 500), resend: isForceResend,
    });
    return {
      sent: false,
      upstreamStatus: result.status,
      error: result.error,
      upstreamBody: (result.body || '').slice(0, 2000),
      attempts: result.attempts,
    };
  }

  markSentStmt.run(id);
  log.info('isurvey.sent', { id, resend: isForceResend, attempts: result.attempts });
  return {
    sent: true,
    resent: isForceResend,
    attempts: result.attempts,
    record: selectByIdStmt.get(id),
    upstreamBody: result.body.slice(0, 2000),
  };
}
