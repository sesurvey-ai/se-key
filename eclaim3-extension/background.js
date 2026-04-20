// Background service worker — proxies LAN API calls so that content scripts
// on an HTTPS page (eClaim3) can reach an HTTP LAN server without hitting
// mixed-content blocks. Content scripts talk to this via chrome.runtime.sendMessage.

const DEFAULT_SERVER = 'http://localhost:3000';

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

async function apiFetch(path, init = {}) {
  const { base, apiKey } = await getConfig();
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
