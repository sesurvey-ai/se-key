// SE Survey read-only detail page — served at /detail. Same look as /admin
// minus add/edit/delete/resend buttons. API key is shared with /admin under
// the same localStorage key so users set it once.

const API_BASE = `${location.protocol}//${location.host}`;
const API_KEY_STORAGE = 'se-admin-api-key';

const $ = (id) => document.getElementById(id);
const els = {
  q:           $('q'),
  workType:    $('work-type'),
  status:      $('status'),
  pageSize:    $('page-size'),
  btnRefresh:  $('btn-refresh'),
  btnExport:   $('btn-export'),
  btnSettings: $('btn-settings'),
  fromDate:    $('from-date'),
  toDate:      $('to-date'),
  btnDateClear: $('btn-date-clear'),
  summary:     $('summary-text'),
  summaryBox:  document.querySelector('.summary'),
  tbody:       $('tbody'),
  rowsTotal:   $('rows-total'),
  prev:        $('prev'),
  next:        $('next'),
  pageInfo:    $('page-info'),
  connDot:     $('conn-dot'),

  settingsModal:     $('settings-modal'),
  fApikey:           $('f-apikey'),
  btnSettingsCancel: $('btn-settings-cancel'),
  btnSettingsSave:   $('btn-settings-save'),
};

const state = {
  page: 1,
  pageSize: 100,
  total: 0,
  q: '',
  workType: '',
  status: '',
  fromDate: '',
  toDate: '',
  loading: false,
  apiKey: localStorage.getItem(API_KEY_STORAGE) || '',
};

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[c]);
}
function fmtCount(n) { return Number(n).toLocaleString('en-US'); }
function setConn(kind) { els.connDot.className = 'conn-dot' + (kind ? ` ${kind}` : ''); }
function openModal(el) { el.classList.remove('hidden'); }
function closeModal(el) { el.classList.add('hidden'); }

async function api(pathname) {
  const headers = {};
  if (state.apiKey) headers['X-API-Key'] = state.apiKey;
  const r = await fetch(`${API_BASE}${pathname}`, { headers });
  if (r.status === 401) {
    openModal(els.settingsModal);
    throw new Error('API key ผิดหรือยังไม่ได้ตั้ง (401)');
  }
  if (!r.ok) {
    let msg = `${r.status} ${r.statusText}`;
    try { const b = await r.json(); if (b.error) msg = b.error; } catch {}
    throw new Error(msg);
  }
  return r;
}

function renderRows(rows) {
  if (rows.length === 0) {
    els.tbody.innerHTML = `
      <tr><td colspan="8" style="padding:40px;text-align:center;color:#888">
        ไม่พบรายการ
      </td></tr>`;
    return;
  }
  els.tbody.innerHTML = rows.map((r) => {
    const statusCell = r.isurvey_sent
      ? `<td><span class="badge badge-sent">ส่งแล้ว</span></td>`
      : `<td>
           <span class="badge badge-pending">รอส่ง</span>
           ${r.retry_error ? `<div class="retry-err" title="${esc(r.retry_error)}" style="margin-top:4px;font-size:11px;color:#c62828">❗ ${esc(r.retry_error.slice(0, 60))}</div>` : ''}
         </td>`;
    return `
      <tr data-id="${esc(r.id)}">
        <td class="id">${esc(r.id)}</td>
        <td class="created">${esc(r.created_at)}</td>
        <td class="mono">${esc(r.claim_no)}</td>
        <td class="mono">${esc(r.survey_no)}</td>
        <td>${esc(r.keyer)}</td>
        <td>${esc(r.work_type) || '—'}</td>
        <td class="mono">${esc(r.invoice_mix) || '—'}</td>
        ${statusCell}
      </tr>
    `;
  }).join('');
}

function renderSummary(ok, msg) {
  els.summary.textContent = msg;
  els.summaryBox.classList.toggle('err', !ok);
}

function renderPager() {
  const lastPage = Math.max(1, Math.ceil(state.total / state.pageSize));
  const startIdx = state.total === 0 ? 0 : (state.page - 1) * state.pageSize + 1;
  const endIdx   = Math.min(state.page * state.pageSize, state.total);
  els.pageInfo.textContent = state.total === 0
    ? 'ไม่มีรายการ'
    : `${fmtCount(startIdx)}–${fmtCount(endIdx)} จาก ${fmtCount(state.total)} (หน้า ${state.page}/${lastPage})`;
  els.prev.disabled = state.page <= 1 || state.loading;
  els.next.disabled = state.page >= lastPage || state.loading;
}

function buildQuery() {
  const qs = new URLSearchParams();
  qs.set('limit',  String(state.pageSize));
  qs.set('offset', String((state.page - 1) * state.pageSize));
  if (state.q)        qs.set('q', state.q);
  if (state.workType) qs.set('work_type', state.workType);
  if (state.status === '0' || state.status === '1') qs.set('isurvey_sent', state.status);
  if (state.fromDate) qs.set('from_date', state.fromDate);
  if (state.toDate)   qs.set('to_date',   state.toDate);
  return qs;
}

async function load() {
  if (state.loading) return;
  state.loading = true;
  renderPager();
  renderSummary(true, 'กำลังโหลด...');

  try {
    const r = await api(`/api/records?${buildQuery()}`);
    const body = await r.json();
    state.total = body.total ?? (body.rows ? body.rows.length : 0);
    renderRows(body.rows || []);
    setConn('ok');
    els.rowsTotal.textContent = `${fmtCount(state.total)} รายการ`;
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
    setConn('err');
    renderSummary(false, err.message);
    els.tbody.innerHTML = '';
    state.total = 0;
    els.rowsTotal.textContent = '—';
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
els.workType.addEventListener('change', (e) => { state.workType = e.target.value; state.page = 1; load(); });
els.status  .addEventListener('change', (e) => { state.status   = e.target.value; state.page = 1; load(); });
els.fromDate.addEventListener('change', (e) => { state.fromDate = e.target.value; state.page = 1; load(); });
els.toDate  .addEventListener('change', (e) => { state.toDate   = e.target.value; state.page = 1; load(); });
els.btnDateClear.addEventListener('click', () => {
  state.fromDate = ''; state.toDate = '';
  els.fromDate.value = ''; els.toDate.value = '';
  state.page = 1; load();
});
els.pageSize.addEventListener('change', (e) => {
  state.pageSize = Number(e.target.value) || 100;
  state.page = 1; load();
});
els.btnRefresh.addEventListener('click', () => load());
els.prev.addEventListener('click', () => { if (state.page > 1) { state.page--; load(); } });
els.next.addEventListener('click', () => {
  const lastPage = Math.max(1, Math.ceil(state.total / state.pageSize));
  if (state.page < lastPage) { state.page++; load(); }
});

els.btnExport.addEventListener('click', async () => {
  const orig = els.btnExport.textContent;
  els.btnExport.disabled = true;
  els.btnExport.textContent = 'กำลังสร้างไฟล์...';
  try {
    const qs = new URLSearchParams();
    if (state.q)        qs.set('q', state.q);
    if (state.workType) qs.set('work_type', state.workType);
    if (state.status === '0' || state.status === '1') qs.set('isurvey_sent', state.status);
    if (state.fromDate) qs.set('from_date', state.fromDate);
    if (state.toDate)   qs.set('to_date',   state.toDate);
    const r = await api(`/api/records/export?${qs}`);
    const blob = await r.blob();
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
    els.btnExport.disabled = false;
    els.btnExport.textContent = orig;
  }
});

// Settings modal
els.btnSettings.addEventListener('click', () => {
  els.fApikey.value = state.apiKey;
  openModal(els.settingsModal);
  els.fApikey.focus();
});
els.btnSettingsCancel.addEventListener('click', () => closeModal(els.settingsModal));
els.btnSettingsSave.addEventListener('click', () => {
  state.apiKey = els.fApikey.value.trim();
  localStorage.setItem(API_KEY_STORAGE, state.apiKey);
  closeModal(els.settingsModal);
  load();
});

// --- init ---
state.pageSize = Number(els.pageSize.value) || 100;
if (!state.apiKey) openModal(els.settingsModal);
else load();
