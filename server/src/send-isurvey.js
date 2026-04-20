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

const ISURVEY_URL        = process.env.ISURVEY_URL        || 'https://se.isurvey.mobi/service/srvEMCSrpt.php';
const ISURVEY_USER_ID    = process.env.ISURVEY_USER_ID    || 'sesurvey';
const ISURVEY_PASSWORD   = process.env.ISURVEY_PASSWORD   || 'pass1234';
const ISURVEY_TIMEOUT_MS = Number(process.env.ISURVEY_TIMEOUT_MS) || 15000;

export async function sendRecordToIsurvey(id) {
  const row = selectByIdStmt.get(id);
  if (!row) return { notFound: true };

  if (row.isurvey_sent === 1) {
    return { sent: true, alreadySent: true, record: row };
  }

  // SESV / unknown work_types: flip the flag locally so retry loop leaves
  // them alone, but don't call iSurvey.
  if (!shouldSendToIsurvey(row)) {
    markSentStmt.run(id);
    return {
      sent: false, skipped: true,
      reason: `work_type "${row.work_type}" is not forwarded to iSurvey`,
      record: selectByIdStmt.get(id),
    };
  }

  const payload = buildIsurveyPayload(row, {
    userId:   ISURVEY_USER_ID,
    password: ISURVEY_PASSWORD,
  });

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

    if (!resp.ok) {
      const errMsg = `iSurvey ${resp.status}: ${text.slice(0, 200)}`;
      markRetryStmt.run(errMsg, id);
      log.warn('isurvey.upstream_fail', { id, status: resp.status, body: text.slice(0, 500) });
      return {
        sent: false,
        upstreamStatus: resp.status,
        error: errMsg,
        upstreamBody: text.slice(0, 2000),
      };
    }

    markSentStmt.run(id);
    log.info('isurvey.sent', { id });
    return { sent: true, record: selectByIdStmt.get(id), upstreamBody: text.slice(0, 2000) };
  } catch (err) {
    const errMsg = err.name === 'AbortError'
      ? 'iSurvey request timed out'
      : String(err.message || err);
    markRetryStmt.run(errMsg, id);
    log.warn('isurvey.network_fail', { id, error: errMsg });
    return { sent: false, error: errMsg };
  } finally {
    clearTimeout(timer);
  }
}
