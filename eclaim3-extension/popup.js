// Build tag — read from manifest so it stays in sync automatically.
const BUILD = `v${chrome.runtime.getManifest().version}`;
const DEFAULT_SERVER = 'http://localhost:3000';

console.log('[popup] popup.js loaded', BUILD);

const verEl     = document.getElementById('ver');
const urlInput  = document.getElementById('serverUrl');
const keyInput  = document.getElementById('apiKey');
const statusEl  = document.getElementById('status');
const testBtn   = document.getElementById('test');
const saveBtn   = document.getElementById('save');

if (verEl) verEl.textContent = BUILD;

function setStatus(text, kind) {
  statusEl.textContent = text;
  statusEl.className = kind || '';
  console.log('[popup]', kind || '-', text);
}

setStatus(`โหลด popup.js ${BUILD} แล้ว`, 'busy');

chrome.storage.local.get(
  { serverUrl: DEFAULT_SERVER, apiKey: '' },
  ({ serverUrl, apiKey }) => {
    urlInput.value = serverUrl;
    keyInput.value = apiKey;
    setStatus(`URL: ${serverUrl} — key: ${apiKey ? '(ตั้งไว้)' : '(ไม่มี)'}`, 'busy');
  }
);

const normalize = (s) => String(s || '').trim().replace(/\/+$/, '');

function sendToBackground(msg) {
  return new Promise((resolve, reject) => {
    try {
      chrome.runtime.sendMessage(msg, (resp) => {
        if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
        resolve(resp);
      });
    } catch (err) { reject(err); }
  });
}

testBtn.addEventListener('click', async () => {
  setStatus('คลิกทดสอบแล้ว — กำลังส่ง...', 'busy');

  const url = normalize(urlInput.value);
  const apiKey = keyInput.value.trim();
  if (!url) return setStatus('กรอก URL ก่อน', 'err');

  try {
    // Save URL+key so background uses them for the health ping.
    await new Promise((r) => chrome.storage.local.set({ serverUrl: url, apiKey }, r));

    const resp = await sendToBackground({ kind: 'se-api', op: 'health' });
    if (!resp)      return setStatus('ไม่มี response จาก background', 'err');
    if (!resp.ok) {
      if (resp.status === 401) return setStatus('API key ผิด (HTTP 401)', 'err');
      return setStatus(`เชื่อมไม่ได้: ${resp.error || resp.status}`, 'err');
    }
    const rows = (resp.body && resp.body.rows != null) ? resp.body.rows : '?';
    setStatus(`เชื่อมได้ ✓ (rows = ${rows})`, 'ok');
  } catch (err) {
    setStatus(`error: ${err.message}`, 'err');
  }
});

saveBtn.addEventListener('click', () => {
  setStatus('คลิกบันทึกแล้ว...', 'busy');
  const url = normalize(urlInput.value);
  const apiKey = keyInput.value.trim();
  if (!url) return setStatus('กรอก URL ก่อน', 'err');
  chrome.storage.local.set({ serverUrl: url, apiKey }, () => {
    setStatus(`บันทึกแล้ว ✓ → ${url} ${apiKey ? '+ key' : '(ไม่มี key)'}`, 'ok');
  });
});
