// Records browser page — fetches from the LAN API directly (this page runs
// under chrome-extension:// so host_permissions cover it without mixed-content
// blocks, unlike content scripts on https eClaim3 pages).

const DEFAULT_SERVER = 'https://key.sesurvey.cloud';
// Temporarily disabled — set to true to re-enable manual "ส่ง iSurvey" per row.
const MANUAL_SEND_ENABLED = false;
let apiKey = '';

const $ = (id) => document.getElementById(id);
const els = {
  q:           $('q'),
  workType:    $('work-type'),
  status:      $('status'),
  pageSize:    $('page-size'),
  refresh:     $('refresh'),
  fromDate:    $('from-date'),
  toDate:      $('to-date'),
  dateClear:   $('date-clear'),
  exportBtn:   $('export-csv'),
  summary:     $('summary-text'),
  summaryBox:  document.querySelector('.summary'),
  tbody:       $('tbody'),
  prev:        $('prev'),
  next:        $('next'),
  pageInfo:    $('page-info'),
  connDot:     $('conn-dot'),
  serverUrl:   $('server-url'),
};

const state = {
  server:   DEFAULT_SERVER,
  page:     1,
  pageSize: 100,
  total:    0,
  q:        '',
  workType: '',
  status:   '',      // '', '0' (รอส่ง), '1' (ส่งแล้ว)
  fromDate: '',      // YYYY-MM-DD
  toDate:   '',
  loading:  false,
};

async function getConfig() {
  const { serverUrl, apiKey: ak } = await chrome.storage.local.get({
    serverUrl: DEFAULT_SERVER,
    apiKey:    '',
  });
  return {
    server: String(serverUrl || DEFAULT_SERVER).replace(/\/+$/, ''),
    apiKey: String(ak || ''),
  };
}

function setConn(kind, tooltip) {
  els.connDot.className = 'conn-dot' + (kind ? ` ${kind}` : '');
  els.connDot.title = tooltip
    || (kind === 'ok'  ? 'เชื่อม server ได้'
      : kind === 'err' ? 'เชื่อม server ไม่ได้'
      : 'ยังไม่ทราบสถานะ');
}

function fmtCount(n) { return Number(n).toLocaleString('en-US'); }

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[c]);
}

function renderRows(rows) {
  if (rows.length === 0) {
    els.tbody.innerHTML = `
      <tr><td colspan="9" style="padding:40px;text-align:center;color:#888">
        ไม่พบรายการ
      </td></tr>`;
    return;
  }
  els.tbody.innerHTML = rows.map((r) => {
    const statusCell = r.isurvey_sent
      ? `<td class="sent">ส่งแล้ว</td>`
      : `<td class="unsent">
           รอส่ง
           ${r.retry_error ? `<div class="retry-err" title="${esc(r.retry_error)}">❗ ${esc(r.retry_error.slice(0, 60))}</div>` : ''}
         </td>`;
    const actionCell = (r.isurvey_sent || !MANUAL_SEND_ENABLED)
      ? `<td class="action">—</td>`
      : `<td class="action">
           <button type="button" class="send-btn" data-id="${esc(r.id)}">ส่ง iSurvey</button>
         </td>`;
    return `
      <tr data-id="${esc(r.id)}">
        <td class="id">${esc(r.id)}</td>
        <td class="created">${esc(r.created_at)}</td>
        <td class="mono">${esc(r.claim_no)}</td>
        <td class="mono">${esc(r.survey_no)}</td>
        <td>${esc(r.keyer)}</td>
        <td class="work-type work-${esc(r.work_type)}">${esc(r.work_type) || '—'}</td>
        <td class="mono">${esc(r.invoice_mix) || '—'}</td>
        ${statusCell}
        ${actionCell}
      </tr>
    `;
  }).join('');
}

// Event delegation — one handler for any current/future send button.
els.tbody.addEventListener('click', async (e) => {
  const btn = e.target.closest('.send-btn');
  if (!btn) return;
  const id = Number(btn.dataset.id);
  if (!id) return;

  btn.disabled = true;
  const origText = btn.textContent;
  btn.textContent = 'กำลังส่ง...';

  try {
    const headers = { 'Content-Type': 'application/json' };
    if (apiKey) headers['X-API-Key'] = apiKey;
    const r = await fetch(`${state.server}/api/send-isurvey`, {
      method: 'POST', headers, body: JSON.stringify({ id }),
    });
    const body = await r.json().catch(() => ({}));

    if (r.status === 401) throw new Error('API key ผิด (401)');
    if (!r.ok) {
      // Server returns 502 for upstream errors with { error, status, upstreamBody }
      const msg = body.error || `${r.status} ${r.statusText}`;
      throw new Error(msg);
    }

    if (body.sent && body.alreadySent) {
      btn.textContent = 'ส่งแล้ว (เดิม)';
    } else if (body.skipped) {
      btn.textContent = `ข้ามแล้ว`;
    } else if (body.sent) {
      btn.textContent = 'ส่งสำเร็จ ✓';
    } else {
      btn.textContent = 'ไม่แน่ใจ';
    }
    setTimeout(load, 600);  // reload to reflect new status
  } catch (err) {
    btn.disabled = false;
    btn.textContent = origText;
    // Inline error next to the button
    const cell = btn.closest('td');
    let errEl = cell.querySelector('.send-err');
    if (!errEl) {
      errEl = document.createElement('div');
      errEl.className = 'send-err';
      cell.appendChild(errEl);
    }
    errEl.textContent = err.message;
    errEl.title = err.message;
    setTimeout(() => errEl.remove(), 6000);
  }
});

function renderSummary(ok, msg) {
  els.summary.textContent = msg;
  els.summaryBox.classList.toggle('err', !ok);
}

function renderPager() {
  const lastPage = Math.max(1, Math.ceil(state.total / state.pageSize));
  const startIdx = state.total === 0 ? 0 : (state.page - 1) * state.pageSize + 1;
  const endIdx   = Math.min(state.page * state.pageSize, state.total);
  els.pageInfo.textContent = state.total === 0
    ? `ไม่มีรายการ`
    : `${fmtCount(startIdx)}–${fmtCount(endIdx)} จาก ${fmtCount(state.total)} (หน้า ${state.page}/${lastPage})`;
  els.prev.disabled = state.page <= 1 || state.loading;
  els.next.disabled = state.page >= lastPage || state.loading;
}

async function load() {
  if (state.loading) return;
  state.loading = true;
  renderPager();
  renderSummary(true, 'กำลังโหลด...');

  const qs = new URLSearchParams();
  qs.set('limit', String(state.pageSize));
  qs.set('offset', String((state.page - 1) * state.pageSize));
  if (state.q) qs.set('q', state.q);
  if (state.workType) qs.set('work_type', state.workType);
  if (state.status === '0' || state.status === '1') qs.set('isurvey_sent', state.status);
  if (state.fromDate) qs.set('from_date', state.fromDate);
  if (state.toDate)   qs.set('to_date',   state.toDate);

  try {
    const headers = apiKey ? { 'X-API-Key': apiKey } : {};
    const r = await fetch(`${state.server}/api/records?${qs}`, { headers });
    if (!r.ok) {
      if (r.status === 401) throw new Error('API key ผิดหรือไม่ได้ตั้ง (401)');
      throw new Error(`${r.status} ${r.statusText}`);
    }
    const body = await r.json();
    state.total = body.total ?? body.rows.length;
    renderRows(body.rows || []);
    setConn('ok');
    const statusLabel = state.status === '0' ? 'รอส่ง' : state.status === '1' ? 'ส่งแล้ว' : '';
    const dateLabel = (state.fromDate || state.toDate)
      ? ` — วันที่ ${state.fromDate || '…'} ถึง ${state.toDate || '…'}`
      : '';
    renderSummary(true, `พบ ${fmtCount(state.total)} รายการ`
      + (state.q ? ` — ค้น "${state.q}"` : '')
      + (state.workType ? ` — ประเภท "${state.workType}"` : '')
      + (statusLabel ? ` — สถานะ "${statusLabel}"` : '')
      + dateLabel);
  } catch (err) {
    setConn('err', `เชื่อม server ไม่ได้: ${err.message}`);
    renderSummary(false, `เชื่อม server ไม่ได้: ${err.message} — ตรวจ URL ใน settings`);
    els.tbody.innerHTML = '';
    state.total = 0;
  } finally {
    state.loading = false;
    renderPager();
  }
}

// --- event wiring ---
let searchTimer = null;
els.q.addEventListener('input', (e) => {
  state.q = e.target.value.trim();
  state.page = 1;
  clearTimeout(searchTimer);
  searchTimer = setTimeout(load, 250);
});

els.workType.addEventListener('change', (e) => {
  state.workType = e.target.value;
  state.page = 1;
  load();
});

els.status.addEventListener('change', (e) => {
  state.status = e.target.value;
  state.page = 1;
  load();
});

els.fromDate.addEventListener('change', (e) => {
  state.fromDate = e.target.value;
  state.page = 1;
  load();
});
els.toDate.addEventListener('change', (e) => {
  state.toDate = e.target.value;
  state.page = 1;
  load();
});
els.dateClear.addEventListener('click', () => {
  state.fromDate = '';
  state.toDate = '';
  els.fromDate.value = '';
  els.toDate.value = '';
  state.page = 1;
  load();
});

els.exportBtn.addEventListener('click', async () => {
  const orig = els.exportBtn.textContent;
  els.exportBtn.disabled = true;
  els.exportBtn.textContent = 'กำลังสร้างไฟล์...';

  try {
    const qs = new URLSearchParams();
    if (state.q) qs.set('q', state.q);
    if (state.workType) qs.set('work_type', state.workType);
    if (state.status === '0' || state.status === '1') qs.set('isurvey_sent', state.status);
    if (state.fromDate) qs.set('from_date', state.fromDate);
    if (state.toDate)   qs.set('to_date',   state.toDate);

    const headers = apiKey ? { 'X-API-Key': apiKey } : {};
    const r = await fetch(`${state.server}/api/records/export?${qs}`, { headers });
    if (!r.ok) {
      if (r.status === 401) throw new Error('API key ผิด (401)');
      throw new Error(`${r.status} ${r.statusText}`);
    }

    const blob = await r.blob();
    // Prefer server-provided filename from Content-Disposition if present.
    const cd = r.headers.get('Content-Disposition') || '';
    const m = cd.match(/filename="?([^";]+)"?/);
    const filename = m ? m[1] : 'se-records.xlsx';

    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(a.href);
  } catch (err) {
    renderSummary(false, `Export ไม่สำเร็จ: ${err.message}`);
  } finally {
    els.exportBtn.disabled = false;
    els.exportBtn.textContent = orig;
  }
});

els.pageSize.addEventListener('change', (e) => {
  state.pageSize = Number(e.target.value) || 100;
  state.page = 1;
  load();
});

els.refresh.addEventListener('click', () => load());

els.prev.addEventListener('click', () => {
  if (state.page > 1) { state.page--; load(); }
});
els.next.addEventListener('click', () => {
  const lastPage = Math.max(1, Math.ceil(state.total / state.pageSize));
  if (state.page < lastPage) { state.page++; load(); }
});

// React to server URL / API key changes from popup settings in real time.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (changes.serverUrl) {
    state.server = String(changes.serverUrl.newValue || DEFAULT_SERVER).replace(/\/+$/, '');
    els.serverUrl.textContent = state.server;
  }
  if (changes.apiKey) apiKey = String(changes.apiKey.newValue || '');
  if (changes.serverUrl || changes.apiKey) load();
});

// --- init ---
(async () => {
  const cfg = await getConfig();
  state.server = cfg.server;
  apiKey       = cfg.apiKey;
  els.serverUrl.textContent = state.server;
  state.pageSize = Number(els.pageSize.value) || 100;
  load();
})();
