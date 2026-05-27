// SE Survey — per-keyer report.
// Auth model identical to admin.js: X-API-Key in localStorage,
// prompted on first load via the ⚙ button.

const API_BASE = `${location.protocol}//${location.host}`;
const API_KEY_STORAGE = 'se-admin-api-key';

const $ = (id) => document.getElementById(id);
const els = {
  fromDate:     $('from-date'),
  toDate:       $('to-date'),
  workType:     $('work-type'),
  btnDateClear: $('btn-date-clear'),
  btnRefresh:   $('btn-refresh'),
  btnSettings:  $('btn-settings'),
  summary:      $('summary-text'),
  summaryBox:   document.querySelector('.summary'),
  tbody:        $('tbody'),
  connDot:      $('conn-dot'),

  statKeyers:   $('stat-keyers'),
  statTotal:    $('stat-total'),
  statSent:     $('stat-sent'),
  statPending:  $('stat-pending'),

  chartSection: $('chart-section'),
  chartSvg:     $('chart-svg'),

  settingsModal:     $('settings-modal'),
  fApikey:           $('f-apikey'),
  btnSettingsCancel: $('btn-settings-cancel'),
  btnSettingsSave:   $('btn-settings-save'),
};

const state = {
  apiKey:   localStorage.getItem(API_KEY_STORAGE) || '',
  loading:  false,
  lastRows: [],   // stashed for chart re-render on window resize
};

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[c]);
}
function fmtCount(n) { return Number(n || 0).toLocaleString('en-US'); }

function setConn(kind) {
  els.connDot.className = 'conn-dot' + (kind ? ` ${kind}` : '');
}
function openModal(el)  { el.classList.remove('hidden'); }
function closeModal(el) { el.classList.add('hidden'); }

async function api(pathname) {
  const headers = {};
  if (state.apiKey) headers['X-API-Key'] = state.apiKey;
  const r = await fetch(API_BASE + pathname, { headers });
  const text = await r.text();
  let json = null; try { json = text ? JSON.parse(text) : null; } catch {}
  if (!r.ok) {
    const err = new Error(json?.error || `${r.status} ${r.statusText}`);
    err.status = r.status;
    throw err;
  }
  return json;
}

function renderSummary(ok, msg) {
  els.summary.textContent = msg;
  els.summaryBox.classList.toggle('err', !ok);
}

function renderStats(totals) {
  els.statKeyers.textContent  = fmtCount(totals?.keyer_count);
  els.statTotal.textContent   = fmtCount(totals?.grand_total);
  els.statSent.textContent    = fmtCount(totals?.grand_sent);
  els.statPending.textContent = fmtCount(totals?.grand_pending);
}

function renderRows(rows) {
  if (!rows.length) {
    els.tbody.innerHTML = '<tr><td colspan="10" style="padding:40px;text-align:center;color:#888">ไม่มีข้อมูลในช่วงที่เลือก</td></tr>';
    return;
  }
  els.tbody.innerHTML = rows.map((r, i) => `
    <tr>
      <td class="col-rank">${i + 1}</td>
      <td>${esc(r.keyer)}</td>
      <td class="col-num"><b>${fmtCount(r.total)}</b></td>
      <td class="col-num">${fmtCount(r.sent)}</td>
      <td class="col-num">${fmtCount(r.pending)}</td>
      <td class="col-num">${fmtCount(r.wt_ton)}</td>
      <td class="col-num">${fmtCount(r.wt_tam)}</td>
      <td class="col-num">${fmtCount(r.wt_ruam)}</td>
      <td class="col-num">${fmtCount(r.wt_sesv)}</td>
      <td class="created">${esc((r.last_keyed_at || '').slice(0, 19) || '—')}</td>
    </tr>`).join('');
}

// Stacked horizontal bar chart, plain SVG (no chart lib — keeps zero deps).
// Width follows container; row count is min(rows, TOP_N).
function renderChart(rows) {
  if (!rows.length) {
    els.chartSection.hidden = true;
    return;
  }
  els.chartSection.hidden = false;

  const TOP_N = 15;
  const data = rows.slice(0, TOP_N);
  const max = Math.max(...data.map((d) => d.total), 1);

  const BAR_H = 22;
  const GAP   = 6;
  const LEFT_PAD  = 140;
  const RIGHT_PAD = 70;
  const TOP_PAD   = 4;

  // SVG fills the .chart-wrap which has 20px L/R padding via CSS.
  const containerWidth = Math.max(els.chartSvg.parentElement.clientWidth, 320);
  const chartWidth = Math.max(containerWidth - LEFT_PAD - RIGHT_PAD, 200);
  const totalHeight = TOP_PAD + data.length * (BAR_H + GAP);

  els.chartSvg.setAttribute('height', String(totalHeight));
  els.chartSvg.setAttribute('viewBox', `0 0 ${containerWidth} ${totalHeight}`);

  const parts = data.map((d, i) => {
    const y = TOP_PAD + i * (BAR_H + GAP);
    const sentW    = (d.sent    / max) * chartWidth;
    const pendingW = (d.pending / max) * chartWidth;
    // Truncate long names so the chart doesn't break on weird keyer values.
    const labelText = d.keyer.length > 22 ? d.keyer.slice(0, 20) + '…' : d.keyer;
    return `
      <text class="chart-label" x="${LEFT_PAD - 8}" y="${y + BAR_H / 2 + 4}" text-anchor="end">${esc(labelText)}</text>
      <rect class="chart-bar chart-bar-sent"    x="${LEFT_PAD}"            y="${y}" width="${sentW}"    height="${BAR_H}"></rect>
      <rect class="chart-bar chart-bar-pending" x="${LEFT_PAD + sentW}"    y="${y}" width="${pendingW}" height="${BAR_H}"></rect>
      <text class="chart-value" x="${LEFT_PAD + sentW + pendingW + 6}" y="${y + BAR_H / 2 + 4}">${fmtCount(d.total)}</text>`;
  }).join('');

  els.chartSvg.innerHTML = parts;
}

async function load() {
  if (state.loading) return;
  state.loading = true;
  els.btnRefresh.disabled = true;
  renderSummary(true, 'กำลังโหลด...');

  const qs = new URLSearchParams();
  if (els.fromDate.value) qs.set('from_date', els.fromDate.value);
  if (els.toDate.value)   qs.set('to_date',   els.toDate.value);
  if (els.workType.value) qs.set('work_type', els.workType.value);

  try {
    const body = await api(`/api/reports/by-keyer?${qs}`);
    setConn('ok');
    state.lastRows = body.rows || [];
    renderStats(body.totals);
    renderRows(state.lastRows);
    renderChart(state.lastRows);

    const parts = [];
    parts.push(`พบ ${fmtCount(body.totals?.keyer_count)} ผู้คีย์ / ${fmtCount(body.totals?.grand_total)} รายการ`);
    if (els.fromDate.value || els.toDate.value) {
      parts.push(`ช่วง ${els.fromDate.value || '…'} ถึง ${els.toDate.value || '…'}`);
    }
    if (els.workType.value) parts.push(els.workType.value);
    renderSummary(true, parts.join(' — '));
  } catch (err) {
    setConn('err');
    renderSummary(false, err.status === 401
      ? 'API key ผิด — กดปุ่ม ⚙ เพื่อตั้งค่า'
      : `โหลดไม่สำเร็จ: ${err.message}`);
    els.tbody.innerHTML = '';
    state.lastRows = [];
    renderStats({});
    els.chartSection.hidden = true;
  } finally {
    state.loading = false;
    els.btnRefresh.disabled = false;
  }
}

// --- Event bindings ---
els.btnRefresh.addEventListener('click', load);
els.fromDate.addEventListener('change', load);
els.toDate.addEventListener('change', load);
els.workType.addEventListener('change', load);
els.btnDateClear.addEventListener('click', () => {
  els.fromDate.value = '';
  els.toDate.value   = '';
  load();
});

// Settings modal — same pattern as admin.js.
els.btnSettings.addEventListener('click', () => {
  els.fApikey.value = state.apiKey;
  openModal(els.settingsModal);
});
els.btnSettingsCancel.addEventListener('click', () => closeModal(els.settingsModal));
els.btnSettingsSave.addEventListener('click', () => {
  state.apiKey = els.fApikey.value.trim();
  localStorage.setItem(API_KEY_STORAGE, state.apiKey);
  closeModal(els.settingsModal);
  load();
});

// Re-render chart when window resizes — bars are sized off container width
// so we need to redraw to keep them proportional. Debounced.
let resizeTimer;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    if (state.lastRows.length) renderChart(state.lastRows);
  }, 150);
});

// Default the date range to today on every page load — the report is
// primarily a "what happened today" view. Users who want a different window
// can change the date inputs or hit "ล้างวันที่" to widen to all-time.
function todayYMD() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
const today = todayYMD();
els.fromDate.value = today;
els.toDate.value   = today;

// First load — if no API key yet, open settings modal first.
if (!state.apiKey) {
  openModal(els.settingsModal);
  renderSummary(true, 'กรุณาตั้งค่า API key ก่อนใช้งาน');
} else {
  load();
}
