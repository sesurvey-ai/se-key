// Background service worker — proxies API calls so content scripts on an
// HTTPS page (eClaim3) can reach the API without CORS/mixed-content issues.
// Content scripts talk to this via chrome.runtime.sendMessage.

const DEFAULT_SERVER = 'https://key.sesurvey.cloud';

async function getConfig() {
  const { serverUrl, apiKey } = await chrome.storage.local.get({
    serverUrl: DEFAULT_SERVER,
    apiKey:    '',
  });
  return {
    base:   String(serverUrl || DEFAULT_SERVER).replace(/\/+$/, ''),
    apiKey: String(apiKey || ''),
  };
}

function originPattern(url) {
  try { return `${new URL(url).origin}/*`; } catch { return null; }
}

function hasHostPermission(pattern) {
  return new Promise((resolve) => {
    chrome.permissions.contains({ origins: [pattern] }, (has) => resolve(!!has));
  });
}

async function apiFetch(path, init = {}) {
  const { base, apiKey } = await getConfig();
  const pattern = originPattern(base);
  if (!pattern) {
    return { ok: false, status: 0, body: { error: `LAN URL ไม่ถูกต้อง: ${base}` } };
  }
  if (!(await hasHostPermission(pattern))) {
    return {
      ok: false,
      status: 0,
      body: { error: `ไม่ได้รับ permission สำหรับ ${pattern} — ไปกรอก URL ใหม่ที่ popup แล้ว allow` },
    };
  }
  const headers = { ...(init.headers || {}) };
  if (apiKey) headers['X-API-Key'] = apiKey;
  const r = await fetch(`${base}${path}`, { ...init, headers });
  const text = await r.text();
  let body;
  try { body = JSON.parse(text); } catch { body = text; }
  return { ok: r.ok, status: r.status, body };
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg || typeof msg !== 'object') return;

  if (msg.kind === 'se-ui' && msg.op === 'open-records') {
    chrome.tabs.create({ url: chrome.runtime.getURL('records.html') });
    sendResponse({ ok: true });
    return;
  }

  if (msg.kind !== 'se-api') return;

  (async () => {
    try {
      let result;
      if (msg.op === 'check') {
        const qs = new URLSearchParams();
        if (msg.claim_no)  qs.set('claim_no',  msg.claim_no);
        if (msg.survey_no) qs.set('survey_no', msg.survey_no);
        qs.set('limit', '1');
        result = await apiFetch(`/api/records?${qs}`);
      } else if (msg.op === 'save') {
        result = await apiFetch('/api/records', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify(msg.payload),
        });
      } else if (msg.op === 'save-many-and-flush') {
        // "ส่งงานใหม่" flow. Save all caller-supplied payloads (upsert any
        // pending rows), then send iSurvey for *every* row of this claim that
        // is still sent=0 — regardless of whether the user ever clicked
        // "บันทึกราคา" first, or whether an earlier tab's sessionStorage is
        // gone. sendRecordToIsurvey is idempotent (alreadySent short-circuit)
        // so a second click is a safe no-op.
        const saved = [];
        for (const p of (msg.payloads || [])) {
          const r = await apiFetch('/api/records', {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify(p),
          });
          if (r.ok && r.body && r.body.record) saved.push(r.body.record.id);
        }
        const claim_no = msg.claim_no || '';
        const sent = [], failed = [];
        if (claim_no) {
          const qs = new URLSearchParams({
            claim_no, isurvey_sent: '0', limit: '1000',
          });
          const listRes = await apiFetch(`/api/records?${qs}`);
          const rows = (listRes.ok && listRes.body && Array.isArray(listRes.body.rows))
            ? listRes.body.rows : [];
          for (const row of rows) {
            const s = await apiFetch('/api/send-isurvey', {
              method:  'POST',
              headers: { 'Content-Type': 'application/json' },
              body:    JSON.stringify({ id: row.id }),
            });
            if (s.ok && s.body && (s.body.sent || s.body.skipped)) {
              sent.push({ id: row.id });
            } else {
              failed.push({ id: row.id, status: s.status, error: s.body && s.body.error });
            }
          }
        }
        result = { ok: true, body: { saved, sent, failed } };
      } else if (msg.op === 'save-and-send') {
        // Combined save + send-isurvey used by the content-script click
        // handler for the new-path (ส่งงานใหม่). Running both here lets the
        // send-isurvey step survive content-script teardown when eClaim3
        // navigates to frmMainpage immediately after submit.
        const saveRes = await apiFetch('/api/records', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify(msg.payload),
        });
        if (!saveRes.ok || !saveRes.body || !saveRes.body.record) {
          result = saveRes;
        } else {
          const sendRes = await apiFetch('/api/send-isurvey', {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ id: saveRes.body.record.id }),
          });
          result = {
            ok:     saveRes.ok && sendRes.ok,
            status: sendRes.status,
            body:   { save: saveRes.body, send: sendRes.body },
          };
        }
      } else if (msg.op === 'send-isurvey') {
        result = await apiFetch('/api/send-isurvey', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ id: msg.id }),
        });
      } else if (msg.op === 'health') {
        result = await apiFetch('/api/health');
      } else {
        throw new Error(`unknown op: ${msg.op}`);
      }
      sendResponse({ ok: true, ...result });
    } catch (err) {
      sendResponse({ ok: false, error: String(err.message || err) });
    }
  })();

  return true; // keep the message channel open for async sendResponse
});
