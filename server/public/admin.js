// SE Survey admin UI — served by express from server/public at /admin.
// API key is kept in localStorage; prompted on first load.

const API_BASE = `${location.protocol}//${location.host}`;
const API_KEY_STORAGE = 'se-admin-api-key';

const $ = (id) => document.getElementById(id);
const els = {
  q:           $('q'),
  workType:    $('work-type'),
  status:      $('status'),
  pageSize:    $('page-size'),
  btnRefresh:  $('btn-refresh'),
  btnAdd:      $('btn-add'),
  btnSettings: $('btn-settings'),
  summary:     $('summary-text'),
  summaryBox:  document.querySelector('.summary'),
  tbody:       $('tbody'),
  rowsTotal:   $('rows-total'),
  prev:        $('prev'),
  next:        $('next'),
  pageInfo:    $('page-info'),
  connDot:     $('conn-dot'),

  checkAll:        $('check-all'),
  bulkBar:         $('bulk-bar'),
  bulkCount:       $('bulk-count'),
  btnBulkDelete:   $('btn-bulk-delete'),
  btnBulkClear:    $('btn-bulk-clear'),

  modal:       $('modal'),
  modalTitle:  $('modal-title'),
  form:        $('record-form'),
  fId:         $('f-id'),
  fClaim:      $('f-claim'),
  fSurvey:     $('f-survey'),
  fKeyer:      $('f-keyer'),
  fWorkType:   $('f-worktype'),
  fInvoice:    $('f-invoice'),
  fSent:       $('f-sent'),
  btnCancel:   $('btn-cancel'),
  formErr:     $('form-err'),
  batchSection: $('batch-section'),
  editSection:  $('edit-section'),
  baseRadios:   document.getElementsByName('f-basetype'),
  checkMix:     $('f-check-mix'),
  checkSesv:    $('f-check-sesv'),
  mixRow:       $('f-mix-row'),
  sesvRow:      $('f-sesv-row'),
  mixList:      $('f-mix-list'),
  sesvList:     $('f-sesv-list'),
  mixAddBtn:    $('f-mix-add'),
  sesvAddBtn:   $('f-sesv-add'),

  delModal:       $('del-modal'),
  delInfo:        $('del-info'),
  btnDelCancel:   $('btn-del-cancel'),
  btnDelConfirm:  $('btn-del-confirm'),

  settingsModal:       $('settings-modal'),
  fApikey:             $('f-apikey'),
  btnSettingsCancel:   $('btn-settings-cancel'),
  btnSettingsSave:     $('btn-settings-save'),
};

const state = {
  page: 1,
  pageSize: 100,
  total: 0,
  q: '',
  workType: '',
  status: '',
  loading: false,
  apiKey: localStorage.getItem(API_KEY_STORAGE) || '',
  // deleteTarget shape: { ids: number[], label: string } — works for both
  // single-row delete (ids.length === 1) and bulk delete.
  deleteTarget: null,
  // Set of currently-selected row ids. Cleared on every load() (filter/page
  // change) so "selected" always means "visible right now".
  selected: new Set(),
};

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[c]);
}
function fmtCount(n) { return Number(n).toLocaleString('en-US'); }

function setConn(kind) {
  els.connDot.className = 'conn-dot' + (kind ? ` ${kind}` : '');
}

function openModal(el) { el.classList.remove('hidden'); }
function closeModal(el) { el.classList.add('hidden'); }

async function api(pathname, { method = 'GET', body } = {}) {
  const headers = {};
  if (body) headers['Content-Type'] = 'application/json';
  if (state.apiKey) headers['X-API-Key'] = state.apiKey;
  const r = await fetch(API_BASE + pathname, {
    method, headers, body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  let json = null; try { json = text ? JSON.parse(text) : null; } catch {}
  if (!r.ok) {
    const err = new Error(json?.error || `${r.status} ${r.statusText}`);
    err.status = r.status;
    throw err;
  }
  return json;
}

function renderRows(rows) {
  if (!rows.length) {
    els.tbody.innerHTML = '<tr><td colspan="10" style="padding:40px;text-align:center;color:#888">ไม่พบรายการ</td></tr>';
    syncCheckAll();
    return;
  }
  els.tbody.innerHTML = rows.map((r) => {
    const checked = state.selected.has(r.id) ? 'checked' : '';
    return `
    <tr data-id="${esc(r.id)}">
      <td class="col-check"><input type="checkbox" class="row-check" data-id="${esc(r.id)}" ${checked}></td>
      <td>${esc(r.id)}</td>
      <td class="created">${esc(r.created_at)}</td>
      <td class="mono">${esc(r.claim_no)}</td>
      <td class="mono">${esc(r.survey_no)}</td>
      <td>${esc(r.keyer)}</td>
      <td>${esc(r.work_type) || '—'}</td>
      <td class="mono">${esc(r.invoice_mix) || '—'}</td>
      <td>
        <span class="badge ${r.isurvey_sent ? 'badge-sent' : 'badge-pending'}">
          ${r.isurvey_sent ? 'ส่งแล้ว' : 'รอส่ง'}
        </span>
      </td>
      <td>
        <div class="row-actions">
          <button type="button" class="btn" data-act="edit" data-id="${esc(r.id)}">แก้ไข</button>
          <button type="button" class="btn btn-danger" data-act="delete" data-id="${esc(r.id)}">ลบ</button>
          <button type="button" class="btn btn-isurvey" data-act="isurvey" data-id="${esc(r.id)}"
                  title="${r.isurvey_sent ? 'ส่ง iSurvey อีกครั้ง' : 'ส่งงานไปที่ iSurvey'}">
            ${r.isurvey_sent ? 'ส่งซ้ำ' : 'iSurvey'}
          </button>
        </div>
      </td>
    </tr>`;
  }).join('');
  syncCheckAll();
}

// --- Selection helpers (multi-row delete) ---
function updateBulkBar() {
  const n = state.selected.size;
  els.bulkCount.textContent = String(n);
  els.bulkBar.classList.toggle('hidden', n === 0);
}
function syncCheckAll() {
  const visible = els.tbody.querySelectorAll('.row-check');
  if (!visible.length) {
    els.checkAll.checked = false;
    els.checkAll.indeterminate = false;
    return;
  }
  let checked = 0;
  for (const cb of visible) if (cb.checked) checked++;
  els.checkAll.checked       = checked === visible.length;
  els.checkAll.indeterminate = checked > 0 && checked < visible.length;
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

async function load() {
  if (state.loading) return;
  state.loading = true;
  // Selection is scoped to the current view — clear it so we never delete
  // a row the user can't currently see (different filter/page).
  state.selected.clear();
  updateBulkBar();
  renderPager();
  renderSummary(true, 'กำลังโหลด...');

  const qs = new URLSearchParams();
  qs.set('limit', String(state.pageSize));
  qs.set('offset', String((state.page - 1) * state.pageSize));
  if (state.q) qs.set('q', state.q);
  if (state.workType) qs.set('work_type', state.workType);
  if (state.status === '0' || state.status === '1') qs.set('isurvey_sent', state.status);

  try {
    const body = await api(`/api/records?${qs}`);
    state.total = body.total ?? (body.rows ? body.rows.length : 0);
    renderRows(body.rows || []);
    setConn('ok');
    els.rowsTotal.textContent = `${fmtCount(state.total)} rows`;
    renderSummary(true, `พบ ${fmtCount(state.total)} รายการ`
      + (state.q ? ` — ค้น "${state.q}"` : '')
      + (state.workType ? ` — ${state.workType}` : '')
      + (state.status === '0' ? ' — รอส่ง' : state.status === '1' ? ' — ส่งแล้ว' : ''));
  } catch (err) {
    setConn('err');
    renderSummary(false, err.status === 401
      ? 'API key ผิด — กดปุ่ม ⚙ เพื่อตั้งค่า'
      : `โหลดไม่สำเร็จ: ${err.message}`);
    els.tbody.innerHTML = '';
    state.total = 0;
  } finally {
    state.loading = false;
    renderPager();
  }
}

// --- CRUD actions ---

// Show/hide batch vs single-row edit sections.
//   Add mode  → batch visible, edit hidden (mirrors panel: baseType + งานรวม/SESV dynamic lists)
//   Edit mode → batch hidden, edit visible (single-row work_type + invoice_mix fields)
function setFormMode(mode) {
  const isAdd = mode === 'add';
  els.batchSection.hidden = !isAdd;
  els.editSection.hidden  =  isAdd;
}

// ---------- Dynamic list helpers (mirror panel งานรวม/SESV) ----------
function resetMixList() {
  els.mixList.innerHTML = `
    <div class="batch-item">
      <input type="text" class="batch-input-mix" placeholder="เลข invoice">
    </div>`;
}
function resetSesvList() {
  els.sesvList.innerHTML = `
    <div class="batch-item">
      <input type="text" class="batch-input-sesv" placeholder="เลขเซอร์เวย์ SESV">
    </div>`;
}
function getFilledMixValues() {
  return [...els.mixList.querySelectorAll('.batch-input-mix')]
    .map((i) => i.value.trim()).filter(Boolean);
}
function getFilledSesvValues() {
  return [...els.sesvList.querySelectorAll('.batch-input-sesv')]
    .map((i) => i.value.trim()).filter(Boolean);
}
function getBaseType() {
  for (const r of els.baseRadios) if (r.checked) return r.value;
  return 'งานต้น';
}
function setBaseType(type) {
  for (const r of els.baseRadios) r.checked = (r.value === type);
}
// งานรวม / SESV are mutually exclusive (same as panel).
function setBatchMode(mode) {
  els.checkMix.checked  = mode === 'งานรวม';
  els.checkSesv.checked = mode === 'SESV';
  els.mixRow.hidden     = mode !== 'งานรวม';
  els.sesvRow.hidden    = mode !== 'SESV';
}

els.checkMix.addEventListener('change', () => {
  if (els.checkMix.checked) setBatchMode('งานรวม');
  else { setBatchMode(null); resetMixList(); }
});
els.checkSesv.addEventListener('change', () => {
  if (els.checkSesv.checked) setBatchMode('SESV');
  else { setBatchMode(null); resetSesvList(); }
});

els.mixAddBtn.addEventListener('click', () => {
  const item = document.createElement('div');
  item.className = 'batch-item';
  item.innerHTML = `
    <input type="text" class="batch-input-mix" placeholder="เลข invoice">
    <button type="button" class="batch-remove" title="ลบช่องนี้">×</button>`;
  els.mixList.appendChild(item);
  item.querySelector('input').focus();
});
els.sesvAddBtn.addEventListener('click', () => {
  const item = document.createElement('div');
  item.className = 'batch-item';
  item.innerHTML = `
    <input type="text" class="batch-input-sesv" placeholder="เลขเซอร์เวย์ SESV">
    <button type="button" class="batch-remove" title="ลบช่องนี้">×</button>`;
  els.sesvList.appendChild(item);
  item.querySelector('input').focus();
});

// Event delegation for × remove buttons on both lists.
for (const list of [els.mixList, els.sesvList]) {
  list.addEventListener('click', (e) => {
    const btn = e.target.closest('.batch-remove');
    if (!btn) return;
    const item = btn.closest('.batch-item');
    if (item && list.children.length > 1) item.remove();
  });
}

function openAddModal() {
  els.modalTitle.textContent = 'เพิ่ม record';
  setFormMode('add');
  els.fId.value = '';
  els.fClaim.value = '';
  els.fSurvey.value = '';
  els.fKeyer.value = '';
  els.fWorkType.value = '';
  els.fInvoice.value = '';
  els.fSent.value = '0';
  setBaseType('งานต้น');
  setBatchMode(null);
  resetMixList();
  resetSesvList();
  els.formErr.classList.add('hidden');
  openModal(els.modal);
  els.fClaim.focus();
}

async function openEditModal(id) {
  els.modalTitle.textContent = `แก้ไข record #${id}`;
  setFormMode('edit');
  els.formErr.classList.add('hidden');
  try {
    const body = await api(`/api/records/${id}`);
    const row = body.record;
    if (!row) { alert('ไม่พบ record'); return; }
    els.fId.value = row.id;
    els.fClaim.value = row.claim_no || '';
    els.fSurvey.value = row.survey_no || '';
    els.fKeyer.value = row.keyer || '';
    els.fWorkType.value = row.work_type || '';
    els.fInvoice.value = row.invoice_mix || '';
    els.fSent.value = row.isurvey_sent ? '1' : '0';
    openModal(els.modal);
    els.fClaim.focus();
  } catch (err) {
    alert(`โหลดไม่สำเร็จ: ${err.message}`);
  }
}

els.form.addEventListener('submit', async (e) => {
  e.preventDefault();
  els.formErr.classList.add('hidden');

  const id = els.fId.value.trim();
  const claim_no  = els.fClaim.value.trim();
  const survey_no = els.fSurvey.value.trim();
  const keyer     = els.fKeyer.value.trim();
  const sent      = Number(els.fSent.value) || 0;

  if (!claim_no) {
    els.formErr.textContent = 'เลขเคลม ห้ามว่าง';
    els.formErr.classList.remove('hidden');
    return;
  }

  let sendFailures = 0;
  let firstSendFailure = null;

  try {
    if (id) {
      // Edit mode — single-row PATCH using the edit-section fields.
      await api(`/api/records/${id}`, { method: 'PATCH', body: {
        claim_no, survey_no, keyer,
        work_type:   els.fWorkType.value,
        invoice_mix: els.fInvoice.value.trim(),
        isurvey_sent: sent,
      }});
    } else {
      // Add mode — mirror panel batch flow.
      //   No batch:  single row, work_type = baseType (งานต้น/งานตาม)
      //   งานรวม:    1 primary (baseType + survey_no) + N followups (งานตาม + invoice_value, invoice_mix = survey_no)
      //   SESV:      same as งานรวม but using SESV list
      const baseType = getBaseType();
      const batchMode = els.checkMix.checked ? 'งานรวม' : els.checkSesv.checked ? 'SESV' : null;
      const payloads = [];

      if (batchMode) {
        const values = batchMode === 'งานรวม' ? getFilledMixValues() : getFilledSesvValues();
        if (!values.length) {
          els.formErr.textContent = `เปิด ${batchMode} แล้วต้องมีอย่างน้อย 1 เลข — กรอกช่องแรกก่อน`;
          els.formErr.classList.remove('hidden');
          return;
        }
        payloads.push({ claim_no, survey_no, keyer, work_type: baseType, invoice_mix: '' });
        for (const v of values) {
          payloads.push({
            claim_no, survey_no: v, keyer,
            work_type:   'งานตาม',
            invoice_mix: survey_no,
          });
        }
      } else {
        payloads.push({ claim_no, survey_no, keyer, work_type: baseType, invoice_mix: '' });
      }

      // POST each record. Insert errors abort the whole flow (outer catch).
      const createdIds = [];
      for (const p of payloads) {
        const res = await api('/api/records', { method: 'POST', body: p });
        if (res?.record?.id) createdIds.push(res.record.id);
      }
      // "ส่งแล้ว" → actually ship each new record to iSurvey. Send failures
      // are captured per-row: the record is already saved in DB, so we close
      // the modal, reload, and warn the user that they can retry via the
      // "ส่งซ้ำ" button on the failed rows.
      if (sent === 1) {
        for (const cid of createdIds) {
          try {
            await api('/api/send-isurvey', { method: 'POST', body: { id: cid } });
          } catch (e) {
            sendFailures++;
            if (!firstSendFailure) firstSendFailure = { id: cid, error: e.message };
          }
        }
      }
    }
    closeModal(els.modal);
    load();
    if (sendFailures) {
      alert(
        `ส่ง iSurvey ไม่สำเร็จ ${sendFailures} รายการ (record ถูกบันทึกไว้แล้ว)\n` +
        `ตัวอย่าง id=${firstSendFailure.id}: ${firstSendFailure.error}\n` +
        `กดปุ่ม "ส่งซ้ำ" ที่แถวนั้นเพื่อลองใหม่`
      );
    }
  } catch (err) {
    els.formErr.textContent = `บันทึกไม่สำเร็จ: ${err.message}`;
    els.formErr.classList.remove('hidden');
  }
});

els.tbody.addEventListener('click', async (e) => {
  const btn = e.target.closest('button[data-act]');
  if (!btn) return;
  const id = btn.dataset.id;
  const act = btn.dataset.act;

  if (act === 'edit') return openEditModal(id);

  if (act === 'delete') {
    const row = btn.closest('tr');
    // Column indices shifted by +1 when checkbox column was added at pos 0:
    // 0=check, 1=id, 2=created, 3=claim, 4=survey, ...
    const claim  = row?.children[3]?.textContent?.trim() || '';
    const survey = row?.children[4]?.textContent?.trim() || '';
    const label  = `id=${id}` + (claim ? ` (${claim}${survey ? ' / ' + survey : ''})` : '');
    state.deleteTarget = { ids: [Number(id)], label };
    els.delInfo.textContent = label;
    openModal(els.delModal);
    return;
  }

  if (act === 'isurvey') {
    const orig = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'กำลังส่ง...';
    try {
      // force: true — admin click bypasses the already-sent short-circuit
      // so "ส่งซ้ำ" actually re-ships the payload to iSurvey instead of
      // returning the cached alreadySent result.
      const body = await api('/api/send-isurvey', { method: 'POST', body: { id: Number(id), force: true } });
      if (body?.skipped) {
        btn.textContent = 'ข้ามแล้ว';
      } else if (body?.sent && body?.resent) {
        btn.textContent = 'ส่งซ้ำสำเร็จ ✓';
      } else if (body?.sent) {
        btn.textContent = 'ส่งสำเร็จ ✓';
      } else {
        btn.textContent = 'ไม่แน่ใจ';
      }
      setTimeout(load, 800);
    } catch (err) {
      btn.textContent = orig;
      btn.disabled = false;
      alert(`ส่ง iSurvey ไม่สำเร็จ: ${err.message}`);
    }
    return;
  }
});

els.btnDelConfirm.addEventListener('click', async () => {
  if (!state.deleteTarget) return;
  const { ids } = state.deleteTarget;
  els.btnDelConfirm.disabled = true;
  try {
    if (ids.length === 1) {
      await api(`/api/records/${ids[0]}`, { method: 'DELETE' });
    } else {
      const res = await api('/api/records/bulk-delete', { method: 'POST', body: { ids } });
      if (res && res.deleted < res.requested) {
        // Some ids didn't match (e.g. deleted by someone else in the meantime)
        // — surface it but don't treat as error.
        console.warn('bulk-delete partial:', res);
      }
    }
    closeModal(els.delModal);
    state.deleteTarget = null;
    load();  // load() clears state.selected and reloads the list
  } catch (err) {
    alert(`ลบไม่สำเร็จ: ${err.message}`);
  } finally {
    els.btnDelConfirm.disabled = false;
  }
});

// --- event wiring ---

els.btnAdd.addEventListener('click', openAddModal);
els.btnCancel.addEventListener('click', () => closeModal(els.modal));
els.btnDelCancel.addEventListener('click', () => { closeModal(els.delModal); state.deleteTarget = null; });

// --- Selection wiring (multi-row delete) ---
// Per-row checkbox toggles via event delegation on tbody (change event).
els.tbody.addEventListener('change', (e) => {
  const cb = e.target.closest('.row-check');
  if (!cb) return;
  const id = Number(cb.dataset.id);
  if (cb.checked) state.selected.add(id);
  else            state.selected.delete(id);
  updateBulkBar();
  syncCheckAll();
});

// Header "select all" toggles every currently-visible row checkbox.
els.checkAll.addEventListener('change', () => {
  const want = els.checkAll.checked;
  for (const cb of els.tbody.querySelectorAll('.row-check')) {
    cb.checked = want;
    const id = Number(cb.dataset.id);
    if (want) state.selected.add(id);
    else      state.selected.delete(id);
  }
  updateBulkBar();
});

els.btnBulkClear.addEventListener('click', () => {
  state.selected.clear();
  for (const cb of els.tbody.querySelectorAll('.row-check')) cb.checked = false;
  updateBulkBar();
  syncCheckAll();
});

els.btnBulkDelete.addEventListener('click', () => {
  if (state.selected.size === 0) return;
  const ids = [...state.selected];
  const label = `${ids.length} รายการที่เลือก`;
  state.deleteTarget = { ids, label };
  els.delInfo.textContent = label;
  openModal(els.delModal);
});

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

// Close modal when clicking outside card
for (const m of [els.modal, els.delModal, els.settingsModal]) {
  m.addEventListener('click', (e) => {
    if (e.target === m) closeModal(m);
  });
}

let searchTimer = null;
els.q.addEventListener('input', (e) => {
  state.q = e.target.value.trim();
  state.page = 1;
  clearTimeout(searchTimer);
  searchTimer = setTimeout(load, 250);
});
els.workType.addEventListener('change', (e) => { state.workType = e.target.value; state.page = 1; load(); });
els.status.addEventListener('change',   (e) => { state.status   = e.target.value; state.page = 1; load(); });
els.pageSize.addEventListener('change', (e) => { state.pageSize = Number(e.target.value) || 100; state.page = 1; load(); });
els.btnRefresh.addEventListener('click', () => load());
els.prev.addEventListener('click', () => { if (state.page > 1) { state.page--; load(); } });
els.next.addEventListener('click', () => {
  const lastPage = Math.max(1, Math.ceil(state.total / state.pageSize));
  if (state.page < lastPage) { state.page++; load(); }
});

// --- init ---
(() => {
  state.pageSize = Number(els.pageSize.value) || 100;
  if (!state.apiKey) {
    // Prompt for API key on first load
    els.btnSettings.click();
  } else {
    load();
  }
})();
