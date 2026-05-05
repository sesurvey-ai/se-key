// Build tag — read from manifest so it stays in sync automatically.
const BUILD = `v${chrome.runtime.getManifest().version}`;
const DEFAULT_SERVER = 'http://localhost:3000';

console.log('[popup] popup.js loaded', BUILD);

const verEl      = document.getElementById('ver');
const connDot    = document.getElementById('popup-conn-dot');
const urlInput   = document.getElementById('serverUrl');
const keyInput   = document.getElementById('apiKey');
const statusEl   = document.getElementById('status');
const testBtn    = document.getElementById('test');
const saveBtn    = document.getElementById('save');
const recordsBtn = document.getElementById('records');

if (verEl) verEl.textContent = BUILD;

function setConnDot(kind) {
  if (!connDot) return;
  connDot.classList.remove('ok', 'err');
  if (kind === 'ok')  connDot.classList.add('ok');
  if (kind === 'err') connDot.classList.add('err');
}

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
    pingHealth();
  }
);

async function pingHealth() {
  try {
    const resp = await sendToBackground({ kind: 'se-api', op: 'health' });
    setConnDot(resp && resp.ok ? 'ok' : 'err');
  } catch { setConnDot('err'); }
}

const normalize = (s) => String(s || '').trim().replace(/\/+$/, '');

function originPattern(url) {
  try { return `${new URL(url).origin}/*`; } catch { return null; }
}

function ensureHostPermission(url) {
  const pattern = originPattern(url);
  if (!pattern) return Promise.resolve({ ok: false, error: 'URL ไม่ถูกต้อง' });
  return new Promise((resolve) => {
    chrome.permissions.contains({ origins: [pattern] }, (has) => {
      if (has) return resolve({ ok: true });
      chrome.permissions.request({ origins: [pattern] }, (granted) => {
        if (chrome.runtime.lastError) {
          return resolve({ ok: false, error: chrome.runtime.lastError.message });
        }
        resolve(granted ? { ok: true } : { ok: false, error: 'user ปฏิเสธ permission' });
      });
    });
  });
}

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

  const perm = await ensureHostPermission(url);
  if (!perm.ok) { setConnDot('err'); return setStatus(`ขอ permission ไม่ได้: ${perm.error}`, 'err'); }

  try {
    // Save URL+key so background uses them for the health ping.
    await new Promise((r) => chrome.storage.local.set({ serverUrl: url, apiKey }, r));

    const resp = await sendToBackground({ kind: 'se-api', op: 'health' });
    if (!resp)      { setConnDot('err'); return setStatus('ไม่มี response จาก background', 'err'); }
    if (!resp.ok) {
      setConnDot('err');
      if (resp.status === 401) return setStatus('API key ผิด (HTTP 401)', 'err');
      return setStatus(`เชื่อมไม่ได้: ${resp.error || resp.status}`, 'err');
    }
    const rows = (resp.body && resp.body.rows != null) ? resp.body.rows : '?';
    setConnDot('ok');
    setStatus(`เชื่อมได้ ✓ (rows = ${rows})`, 'ok');
  } catch (err) {
    setConnDot('err');
    setStatus(`error: ${err.message}`, 'err');
  }
});

saveBtn.addEventListener('click', async () => {
  setStatus('คลิกบันทึกแล้ว...', 'busy');
  const url = normalize(urlInput.value);
  const apiKey = keyInput.value.trim();
  if (!url) return setStatus('กรอก URL ก่อน', 'err');

  const perm = await ensureHostPermission(url);
  if (!perm.ok) return setStatus(`ขอ permission ไม่ได้: ${perm.error}`, 'err');

  chrome.storage.local.set({ serverUrl: url, apiKey }, () => {
    setStatus(`บันทึกแล้ว ✓ → ${url} ${apiKey ? '+ key' : '(ไม่มี key)'}`, 'ok');
  });
});

recordsBtn.addEventListener('click', () => {
  chrome.tabs.create({ url: chrome.runtime.getURL('records.html') });
  window.close();
});
