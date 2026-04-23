// ============================================================
// eClaim3 Survey Helper — Content Script (v0.2.8)
// Reads claim/survey/keyer from eClaim3 DOM, checks duplicates against
// the LAN API server, and posts new records.
// ============================================================

(function () {
  'use strict';

  // API calls go through the background service worker to bypass mixed-content
  // blocking (HTTPS eClaim3 page ↔ HTTP LAN server).
  function callApi(msg) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({ kind: 'se-api', ...msg }, (resp) => {
        if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
        if (!resp) return reject(new Error('no response from background'));
        if (!resp.ok) return reject(new Error(resp.error || `server returned ${resp.status}`));
        resolve(resp.body);
      });
    });
  }

  // ---------- Build panel ----------
  const panel = document.createElement('div');
  panel.id = 'se-panel';
  panel.innerHTML = `
    <div id="se-panel-header">
      <span id="se-panel-title">SE SURVEY</span>
      <span class="se-header-right">
        <button id="se-panel-clear" type="button" title="ล้างค่าฟอร์ม eClaim3">🧹</button>
        <span id="se-submit-dot" class="se-submit-dot se-submit-idle" title="สถานะส่งงาน"></span>
        <span id="se-panel-toggle">—</span>
      </span>
    </div>
    <div id="se-panel-body">
      <div class="se-row">
        <label class="se-label" id="se-claim-label">เลขเคลม</label>
        <div id="se-claim" class="se-value se-empty">รอข้อมูล...</div>
      </div>
      <div class="se-row">
        <label class="se-label" id="se-survey-label">เลขเซอร์เวย์</label>
        <div id="se-survey" class="se-value se-empty">รอข้อมูล...</div>
      </div>
      <div class="se-row se-radio-row">
        <label class="se-radio"><input type="radio" name="se-work" value="งานต้น" checked> งานต้น</label>
        <label class="se-radio"><input type="radio" name="se-work" value="งานตาม"> งานตาม</label>
      </div>
      <div class="se-row se-check-row">
        <label class="se-check"><input type="checkbox" id="se-check-mix"  value="งานรวม"> งานรวม</label>
        <label class="se-check"><input type="checkbox" id="se-check-sesv" value="SESV"> SESV</label>
      </div>
      <div class="se-row" id="se-mix-row" hidden>
        <label class="se-label">เลข invoice (งานรวม)</label>
        <div id="se-mix-list">
          <div class="se-mix-item">
            <input type="text" class="se-input se-mix-input">
          </div>
        </div>
        <button type="button" id="se-mix-add" class="se-mix-add">+ เพิ่มอีกเลข</button>
      </div>
      <div class="se-row" id="se-sesv-row" hidden>
        <label class="se-label">เลขเซอร์เวย์</label>
        <div id="se-sesv-list">
          <div class="se-sesv-item">
            <input type="text" class="se-input se-sesv-input">
          </div>
        </div>
        <button type="button" id="se-sesv-add" class="se-sesv-add">+ เพิ่มอีกเลข</button>
      </div>
      <div class="se-row se-keyer-row">
        <span class="se-keyer-label">ผู้คีย์:</span>
        <span id="se-keyer" class="se-keyer-name se-empty">รอข้อมูล...</span>
      </div>
      <div class="se-submit-row">
        <div id="se-submit-status" class="se-submit-status se-submit-idle">
          <span id="se-submit-icon">🔴</span>
          <span id="se-submit-text">ยังไม่ได้ส่ง</span>
        </div>
        <button type="button" id="se-open-records" class="se-open-records"
                title="ดูรายการในฐานข้อมูล">📋</button>
      </div>
      <div id="se-status" class="se-status" hidden></div>
    </div>
  `;
  document.body.appendChild(panel);
  // Start hidden; unhide once we see the entry-form fields on this page.
  // (List/cancel/report pages under /esurvey/ don't have them — no reason to
  // show the panel there.)
  panel.style.display = 'none';

  const $ = (id) => document.getElementById(id);
  const els = {
    panel,
    header:      $('se-panel-header'),
    body:        $('se-panel-body'),
    toggle:      $('se-panel-toggle'),
    claimLabel:  $('se-claim-label'),
    claim:       $('se-claim'),
    surveyLabel: $('se-survey-label'),
    survey:      $('se-survey'),
    radios:      panel.querySelectorAll('input[name="se-work"]'),
    mixCheck:    $('se-check-mix'),
    sesvCheck:   $('se-check-sesv'),
    mixRow:      $('se-mix-row'),
    mixList:     $('se-mix-list'),
    mixAddBtn:   $('se-mix-add'),
    sesvRow:     $('se-sesv-row'),
    sesvList:    $('se-sesv-list'),
    sesvAddBtn:  $('se-sesv-add'),
    keyer:       $('se-keyer'),
    submitStatus: $('se-submit-status'),
    submitIcon:   $('se-submit-icon'),
    submitText:   $('se-submit-text'),
    submitDot:    $('se-submit-dot'),
    clearBtn:     $('se-panel-clear'),
    status:      $('se-status'),
    openRecords: $('se-open-records'),
  };

  els.openRecords.addEventListener('click', () => {
    chrome.runtime.sendMessage({ kind: 'se-ui', op: 'open-records' });
  });

  // ---------- State ----------
  //
  // workType (effective, used for save) = batchMode || baseType
  //   baseType  — chosen via radio (auto-detected from ddlAdd_No on new claim):
  //               'งานต้น' when ddlAdd_No === '1' or missing, else 'งานตาม'.
  //   batchMode — chosen via checkbox: 'งานรวม' | 'SESV' | null.
  //               When set, radios are disabled and workType = batchMode.
  const state = {
    claimNo:     '',
    surveyNo:    '',
    keyer:       '',
    addNo:       '',            // ddlAdd_No value from page
    baseType:    'งานต้น',     // radio selection
    batchMode:   null,          // 'งานรวม' | 'SESV' | null
    workType:    'งานต้น',     // effective = batchMode || baseType
    lastAutoClaim: null,        // claim for which we last reset batchMode
    claimDup:    false,
    claimSent:   false,         // true if any existing claim_no match is isurvey_sent=1
    surveyDup:   false,
    surveySent:  false,         // same for survey_no
    lastSavedAt:     null,      // timestamp of last click-fire on current claim
    lastSavedSrc:    null,      // 'new' | 'update' — which button produced the save
    lastSavedClaim:  null,      // claim_no for which lastSaved applies
    lastChecked: { claim: null, survey: null },
  };

  // --- Last-saved UI feedback, persisted across ASP.NET postback reloads ---
  // Click handler paints 🟠/🟢 in the submit status on click; we persist so
  // the color survives the chain of postback reloads that follow. Cleared
  // when the user navigates to a different claim.
  const SE_LAST_SAVED_KEY = 'se-last-saved';
  const LAST_SAVED_TTL_MS = 5 * 60_000;

  function persistLastSaved(src, claim_no) {
    try {
      sessionStorage.setItem(SE_LAST_SAVED_KEY, JSON.stringify({
        at: Date.now(), src, claim_no,
      }));
    } catch (_) { /* ignore */ }
  }

  (function restoreLastSavedOnLoad() {
    try {
      const raw = sessionStorage.getItem(SE_LAST_SAVED_KEY);
      if (!raw) return;
      const ls = JSON.parse(raw);
      if (!ls || !ls.at || Date.now() - ls.at > LAST_SAVED_TTL_MS) {
        sessionStorage.removeItem(SE_LAST_SAVED_KEY);
        return;
      }
      state.lastSavedAt    = ls.at;
      state.lastSavedSrc   = ls.src;
      state.lastSavedClaim = ls.claim_no;
    } catch (_) { /* ignore */ }
  })();

  // If the server URL changes in settings, re-ping and re-run the dup check.
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.serverUrl) {
      healthPing();
      scheduleDupCheck(true);
    }
  });

  // ---------- Collapse/expand ----------
  // Default collapsed — panel starts as a compact header with connection dot.
  // User clicks header to expand.
  let collapsed = true;
  function setCollapsed(c) {
    collapsed = c;
    els.body.style.display = c ? 'none' : 'block';
    els.toggle.textContent = c ? '+' : '—';
  }
  setCollapsed(true);
  els.header.addEventListener('click', () => {
    if (isDragging) return;
    setCollapsed(!collapsed);
  });

  // ---------- Clear form (broom icon) ----------
  // Clears the eClaim3 estimate/insurance fields. Dispatches input+change so
  // ASP.NET onchange / calc handlers that recompute totals see the update.
  const CLEAR_FIELD_IDS = [
    'txtNum_Investigate', 'txtNum_Transport', 'txtNum_Photo', 'txtOther_Desc',
    'txtInvestigate_UnitPrice', 'txtTransport_UnitPrice', 'txtPhoto_UnitPrice',
    'txtSur_Tel', 'txtSur_Insure', 'txtSur_Claim', 'txtSur_Percent_Claim',
    'txtSur_Daily', 'txtOther_UnitPrice',
    'txtInvest_Price', 'txtTransport_Price', 'txtPhoto_Price',
    'txtSur_Tel_Price', 'txtSur_Insure_Price', 'txtSur_Claim_Price',
    'txtSur_Daily_Price', 'txtOther_Price',
    'txtIns_Invest', 'txtIns_Trans', 'txtIns_Photo', 'txtIns_Tel',
    'txtIns_Insure', 'txtIns_Claim', 'txtIns_Daily', 'txtIns_Other',
  ];
  els.clearBtn.addEventListener('click', (e) => {
    e.stopPropagation(); // don't collapse/expand the panel
    let cleared = 0;
    for (const id of CLEAR_FIELD_IDS) {
      const el = document.getElementById(id);
      if (!el) continue;
      if (el.value !== '') {
        el.value = '';
        el.dispatchEvent(new Event('input',  { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      }
      cleared++;
    }
    setStatus(`ล้างค่าแล้ว ${cleared}/${CLEAR_FIELD_IDS.length} ช่อง`, 'ok');
    setTimeout(() => setStatus(''), 2000);
  });

  // ---------- Drag ----------
  let isDragging = false;
  let dx = 0, dy = 0;
  els.header.addEventListener('mousedown', (e) => {
    isDragging = false;
    dx = e.clientX - panel.offsetLeft;
    dy = e.clientY - panel.offsetTop;
    const onMove = (ev) => {
      isDragging = true;
      panel.style.left = (ev.clientX - dx) + 'px';
      panel.style.top  = (ev.clientY - dy) + 'px';
      panel.style.right = 'auto';
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      setTimeout(() => { isDragging = false; }, 50);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });

  // ---------- Read DOM ----------
  function readFromPage() {
    const claimEl  = document.getElementById('lblRef_Claim_No');
    const surveyEl = document.getElementById('txtBill_No');
    const keyerEl  = document.getElementById('wuHeadUser1_lblUser_Name');
    const addNoEl  = document.getElementById('ddlAdd_No');

    const claimNo  = claimEl  ? claimEl.textContent.trim() : '';
    const surveyNo = surveyEl ? (surveyEl.value || surveyEl.textContent || '').trim() : '';
    const keyer    = keyerEl  ? keyerEl.textContent.trim() : '';
    const addNo    = addNoEl  ? String(addNoEl.value || '').trim() : '';
    return { claimNo, surveyNo, keyer, addNo };
  }

  // ddlAdd_No === '1' (or missing) → งานต้น; anything else → งานตาม.
  function baseTypeFromAddNo(addNo) {
    return (addNo && addNo !== '1') ? 'งานตาม' : 'งานต้น';
  }

  // ---------- API (routed through background) ----------
  const checkDuplicates = (claim_no, survey_no) =>
    callApi({ op: 'check', claim_no, survey_no });

  const pingHealth = () => callApi({ op: 'health' });

  // Keep the header dot reflecting server reachability at all times, even when
  // the page has no claim/survey loaded yet (dup-check won't fire in that case).
  async function healthPing() {
    try {
      await pingHealth();
      setConn('ok');
    } catch (err) {
      setConn('err', `เชื่อม server ไม่ได้: ${err.message}`);
    }
  }

  // ---------- Duplicate check (debounced) ----------
  let dupTimer = null;
  function scheduleDupCheck(force = false) {
    if (dupTimer) clearTimeout(dupTimer);
    dupTimer = setTimeout(() => runDupCheck(force), 200);
  }

  async function runDupCheck(force) {
    const { claimNo, surveyNo } = state;
    if (!force
        && claimNo === state.lastChecked.claim
        && surveyNo === state.lastChecked.survey) return;
    state.lastChecked = { claim: claimNo, survey: surveyNo };

    if (!claimNo && !surveyNo) {
      state.claimDup = false;
      state.claimSent = false;
      state.surveyDup = false;
      state.surveySent = false;
      render();
      return;
    }

    try {
      const r = await checkDuplicates(claimNo, surveyNo);
      state.claimDup   = (r.claim_count  ?? 0) > 0;
      state.surveyDup  = (r.survey_count ?? 0) > 0;
      // If the server doesn't return *_sent_count (older build), fall back to
      // the old behavior: treat any dup as "ส่งแล้ว" (red). Safer than
      // silently dropping to orange and suggesting a pending edit exists.
      state.claimSent  = r.claim_sent_count  == null ? state.claimDup  : r.claim_sent_count  > 0;
      state.surveySent = r.survey_sent_count == null ? state.surveyDup : r.survey_sent_count > 0;
      setConn('ok');
      setStatus('', null);
    } catch (err) {
      state.claimDup   = false;
      state.claimSent  = false;
      state.surveyDup  = false;
      state.surveySent = false;
      setConn('err', `เชื่อม server ไม่ได้: ${err.message}`);
      setStatus(`เชื่อม server ไม่ได้: ${err.message}`, 'err');
    }
    render();
  }

  // ---------- Work-type radios ----------
  // ---------- Work type controls ----------
  function recomputeWorkType() {
    state.workType = state.batchMode || state.baseType;
  }

  function setBaseType(type) {
    state.baseType = type;
    for (const r of els.radios) r.checked = (r.value === type);
    recomputeWorkType();
  }

  // mode: 'งานรวม' | 'SESV' | null
  function setBatchMode(mode) {
    state.batchMode = mode;
    els.mixCheck.checked  = mode === 'งานรวม';
    els.sesvCheck.checked = mode === 'SESV';
    for (const r of els.radios) r.disabled = Boolean(mode);
    recomputeWorkType();
    // Entering batch mode means the user needs to see + fill the invoice list
    // — expand the panel automatically.
    if (mode) setCollapsed(false);
  }

  els.radios.forEach((r) => r.addEventListener('change', () => {
    if (r.checked) {
      state.baseType = r.value;
      recomputeWorkType();
      render();
    }
  }));

  els.mixCheck.addEventListener('change', () => {
    if (els.mixCheck.checked) {
      setBatchMode('งานรวม');
    } else {
      setBatchMode(null);
      resetMixList();
    }
    render();
  });

  els.sesvCheck.addEventListener('change', () => {
    if (els.sesvCheck.checked) {
      setBatchMode('SESV');
    } else {
      setBatchMode(null);
      resetSesvList();
    }
    render();
  });

  // ---------- งานรวม: dynamic list of invoice_mix inputs ----------
  // Event delegation so dynamically added inputs get the listeners.
  els.mixList.addEventListener('input', render);
  els.mixList.addEventListener('click', (e) => {
    const btn = e.target.closest('.se-mix-remove');
    if (!btn) return;
    const item = btn.closest('.se-mix-item');
    if (item && els.mixList.children.length > 1) {
      item.remove();
      render();
    }
  });
  els.mixAddBtn.addEventListener('click', () => {
    const item = document.createElement('div');
    item.className = 'se-mix-item';
    item.innerHTML = `
      <input type="text" class="se-input se-mix-input">
      <button type="button" class="se-mix-remove" title="ลบช่องนี้">×</button>
    `;
    els.mixList.appendChild(item);
    item.querySelector('input').focus();
    render();
  });

  function getFilledMixValues() {
    return [...els.mixList.querySelectorAll('.se-mix-input')]
      .map((i) => i.value.trim())
      .filter(Boolean);
  }

  function resetMixList() {
    els.mixList.innerHTML = `
      <div class="se-mix-item">
        <input type="text" class="se-input se-mix-input">
      </div>
    `;
  }

  // ---------- SESV: same dynamic list pattern as งานรวม ----------
  els.sesvList.addEventListener('input', render);
  els.sesvList.addEventListener('click', (e) => {
    const btn = e.target.closest('.se-sesv-remove');
    if (!btn) return;
    const item = btn.closest('.se-sesv-item');
    if (item && els.sesvList.children.length > 1) {
      item.remove();
      render();
    }
  });
  els.sesvAddBtn.addEventListener('click', () => {
    const item = document.createElement('div');
    item.className = 'se-sesv-item';
    item.innerHTML = `
      <input type="text" class="se-input se-sesv-input">
      <button type="button" class="se-sesv-remove" title="ลบช่องนี้">×</button>
    `;
    els.sesvList.appendChild(item);
    item.querySelector('input').focus();
    render();
  });

  function getFilledSesvValues() {
    return [...els.sesvList.querySelectorAll('.se-sesv-input')]
      .map((i) => i.value.trim())
      .filter(Boolean);
  }

  function resetSesvList() {
    els.sesvList.innerHTML = `
      <div class="se-sesv-item">
        <input type="text" class="se-input se-sesv-input">
      </div>
    `;
  }

  // In batch mode (งานรวม / SESV) every visible input row must be filled.
  // User can either type a value in each row or click × to remove the row —
  // empty rows are never accepted. Returns { ok, error, focus } where focus
  // is the first empty input so we can highlight it.
  function validateBatchInputs() {
    if (state.batchMode === 'งานรวม') {
      const inputs = [...els.mixList.querySelectorAll('.se-mix-input')];
      for (const inp of inputs) {
        if (!inp.value.trim()) {
          return { ok: false, error: 'กรอกเลข invoice ให้ครบทุกช่อง หรือลบช่องว่างออก (×)', focus: inp };
        }
      }
    } else if (state.batchMode === 'SESV') {
      const inputs = [...els.sesvList.querySelectorAll('.se-sesv-input')];
      for (const inp of inputs) {
        if (!inp.value.trim()) {
          return { ok: false, error: 'กรอกเลขเซอร์เวย์ให้ครบทุกช่อง หรือลบช่องว่างออก (×)', focus: inp };
        }
      }
    }
    return { ok: true };
  }

  // --- Submit buttons --------------------------------------------------
  // Capture-phase click handler fires the save via the background worker at
  // click time, before eClaim3 postback navigates the page. We no longer wait
  // for the native alert / SweetAlert to confirm — the button click itself is
  // the signal (any iSurvey submit is idempotent via upsert_pending + server
  // short-circuit on isurvey_sent=1).
  //   - #wuFlow1_cmdSendNew    → "ส่งงานใหม่"       → save + flush iSurvey
  //   - #wuFlow1_cmdSendFollow → "ส่งผลงานต่อเนื่อง" → save + flush iSurvey (same as above)
  //   - #btnSurvey_Update      → "บันทึกราคา"       → save only (upsert pending rows)
  document.addEventListener('click', (e) => {
    if (!e.target.closest) return;
    const newBtn    = e.target.closest('#wuFlow1_cmdSendNew, #wuFlow1_cmdSendFollow');
    const updateBtn = e.target.closest('#btnSurvey_Update');
    if (!newBtn && !updateBtn) return;

    const src = newBtn ? 'new' : 'update';

    // Batch-mode gate — block the click if any invoice row is empty. Both
    // eClaim3's own handler and our save fire are stopped so the user has
    // to fix the input first.
    if (state.batchMode) {
      const v = validateBatchInputs();
      if (!v.ok) {
        e.preventDefault();
        e.stopImmediatePropagation();
        setCollapsed(false);
        setStatus(v.error, 'err');
        if (v.focus) v.focus.focus();
        return;
      }
    }

    if (state.claimNo && state.keyer) {
      // Optimistically paint 🟠/🟢 in the submit status row.
      state.lastSavedAt    = Date.now();
      state.lastSavedSrc   = src;
      state.lastSavedClaim = state.claimNo;
      persistLastSaved(src, state.claimNo);

      // Build the set of rows to save.
      //   งานต้น/งานตาม (no batch) → single row from the page.
      //   งานรวม / SESV (batch)    → one "primary" row from the page (using
      //     state.baseType — งานต้น/งานตาม as determined by ddlAdd_No) plus
      //     one "งานตาม" row per invoice/sesv input, with invoice_mix set to
      //     the page's survey_no so the batch rows link back to the origin.
      const payloads = [];
      if (state.workType === 'งานรวม' || state.workType === 'SESV') {
        payloads.push({
          claim_no:    state.claimNo,
          survey_no:   state.surveyNo,
          keyer:       state.keyer,
          work_type:   state.baseType,
          invoice_mix: '',
        });
        const values = state.workType === 'งานรวม'
          ? getFilledMixValues()
          : getFilledSesvValues();
        for (const v of values) {
          payloads.push({
            claim_no:    state.claimNo,
            survey_no:   v,
            keyer:       state.keyer,
            work_type:   'งานตาม',
            invoice_mix: state.surveyNo,
          });
        }
      } else {
        payloads.push({
          claim_no:    state.claimNo,
          survey_no:   state.surveyNo,
          keyer:       state.keyer,
          work_type:   state.workType,
          invoice_mix: '',
        });
      }

      // For "ส่งงานใหม่" we send *one* message with the whole payload set
      // and let background.js save everything then flush iSurvey for every
      // row of this claim that is still sent=0 — regardless of whether the
      // user ever clicked "บันทึกราคา" first. Handled entirely in background
      // so it survives content-script teardown when eClaim3 navigates to
      // frmMainpage immediately after submit.
      //
      // For "บันทึกราคา" we just save each row without touching iSurvey.
      if (src === 'new') {
        try {
          chrome.runtime.sendMessage({
            kind: 'se-api', op: 'save-many-and-flush',
            claim_no: state.claimNo,
            payloads: payloads.map((p) => ({ ...p, upsert_pending: true })),
          });
        } catch (_) { /* ignore */ }
      } else {
        for (const payload of payloads) {
          try {
            chrome.runtime.sendMessage({
              kind: 'se-api', op: 'save',
              payload: { ...payload, upsert_pending: true },
            });
          } catch (_) { /* ignore */ }
        }
      }
    }

    render();
  }, true);

  function setStatus(text, kind) {
    els.status.textContent = text || '';
    els.status.className = 'se-status' + (kind ? ` se-status-${kind}` : '');
    els.status.hidden = !text;
  }

  // Connection indicator was removed from the panel header in v0.3.26 —
  // server status now lives in the popup only. Keep a no-op so existing
  // call sites don't need to change.
  function setConn(_kind, _tooltip) { /* no-op */ }

  // ---------- Render ----------
  function render() {
    // Claim field — red if dup has any "ส่งแล้ว", orange if dup is all "รอส่ง".
    if (state.claimNo) {
      els.claim.textContent = state.claimNo;
      if (state.claimDup && state.claimSent) {
        els.claimLabel.textContent = 'เลขเคลม (ส่งแล้ว)';
        els.claim.className = 'se-value se-dup';
      } else if (state.claimDup) {
        els.claimLabel.textContent = 'เลขเคลม (รอส่ง)';
        els.claim.className = 'se-value se-pending';
      } else {
        els.claimLabel.textContent = 'เลขเคลม';
        els.claim.className = 'se-value se-found';
      }
    } else {
      els.claim.textContent = 'ไม่พบข้อมูล';
      els.claim.className = 'se-value se-empty';
      els.claimLabel.textContent = 'เลขเคลม';
    }

    // Survey field — same 3-state coloring.
    if (state.surveyNo) {
      els.survey.textContent = state.surveyNo;
      if (state.surveyDup && state.surveySent) {
        els.surveyLabel.textContent = 'เลขเซอร์เวย์ (ส่งแล้ว)';
        els.survey.className = 'se-value se-dup';
      } else if (state.surveyDup) {
        els.surveyLabel.textContent = 'เลขเซอร์เวย์ (รอส่ง)';
        els.survey.className = 'se-value se-pending';
      } else {
        els.surveyLabel.textContent = 'เลขเซอร์เวย์';
        els.survey.className = 'se-value se-found';
      }
    } else {
      els.survey.textContent = 'ไม่พบข้อมูล';
      els.survey.className = 'se-value se-empty';
      els.surveyLabel.textContent = 'เลขเซอร์เวย์';
    }

    // Keyer — inline next to the "ผู้คีย์:" label.
    if (state.keyer) {
      els.keyer.textContent = state.keyer;
      els.keyer.className = 'se-keyer-name';
    } else {
      els.keyer.textContent = 'ไม่พบข้อมูลผู้ใช้';
      els.keyer.className = 'se-keyer-name se-empty';
    }

    // Work-type rows
    els.mixRow.hidden  = state.workType !== 'งานรวม';
    els.sesvRow.hidden = state.workType !== 'SESV';

    renderSubmitStatus();
  }

  // Submit-gate status — reflects the most recent click on eClaim3's submit
  // buttons (🟠 "บันทึกราคา" → รอส่งงาน, 🟢 "ส่งงานใหม่" → ส่งงานแล้ว).
  // 🔴 until the first click; lastSavedAt expires after LAST_SAVED_TTL_MS.
  function renderSubmitStatus() {
    const el = els.submitStatus;
    let icon, text, cls;

    const lastSavedFresh = state.lastSavedClaim
      && state.lastSavedClaim === state.claimNo
      && state.lastSavedAt
      && (Date.now() - state.lastSavedAt) < LAST_SAVED_TTL_MS;

    if (lastSavedFresh) {
      if (state.lastSavedSrc === 'update') {
        icon = '🟠'; text = 'รอส่งงาน'; cls = 'se-submit-saved-pending';
      } else {
        icon = '🟢'; text = 'ส่งงานแล้ว'; cls = 'se-submit-confirmed';
      }
    } else {
      icon = '🔴'; text = 'ยังไม่ได้ส่ง'; cls = 'se-submit-idle';
    }

    els.submitIcon.textContent = icon;
    els.submitText.textContent = text;
    el.className = `se-submit-status ${cls}`;
    if (els.submitDot) {
      els.submitDot.className = `se-submit-dot ${cls}`;
      els.submitDot.title = `สถานะส่งงาน: ${text}`;
    }
  }

  // ---------- DOM watching ----------
  // Show the panel only when this page actually has the entry-form fields.
  // List/cancel/report pages (e.g. frmToday_Cancel.aspx) don't have them
  // and shouldn't display the panel.
  function panelShouldShow() {
    return !!(document.getElementById('lblRef_Claim_No')
           || document.getElementById('txtBill_No'));
  }
  function syncPanelVisibility() {
    const show = panelShouldShow();
    panel.style.display = show ? '' : 'none';
    return show;
  }

  let lastRead = { claimNo: null, surveyNo: null, keyer: null, addNo: null };
  function refreshFromPage() {
    if (!syncPanelVisibility()) return;

    const v = readFromPage();
    if (v.claimNo === lastRead.claimNo
        && v.surveyNo === lastRead.surveyNo
        && v.keyer === lastRead.keyer
        && v.addNo === lastRead.addNo) return;

    const claimChanged  = v.claimNo && v.claimNo !== state.lastAutoClaim;
    const addNoChanged  = v.addNo !== lastRead.addNo;
    const surveyChanged = v.surveyNo !== lastRead.surveyNo;
    const isSesvSurvey  = v.surveyNo && v.surveyNo.startsWith('SESV');

    lastRead = v;
    state.claimNo  = v.claimNo;
    state.surveyNo = v.surveyNo;
    state.keyer    = v.keyer;
    state.addNo    = v.addNo;

    // Auto-pick base type from ddlAdd_No + batch mode from survey prefix.
    //   - On new claim: always re-apply. Batch mode auto-ticks SESV when
    //     survey_no starts with "SESV" (eClaim3 SESV sub-form), otherwise off.
    //   - On same claim but survey changed to a SESV-prefixed one: auto-tick SESV.
    //   - On same claim, addNo changed: update base type only if not in batch
    //     mode (don't yank radio selection out from under a disabled state).
    if (claimChanged) {
      state.lastAutoClaim = v.claimNo;
      setBatchMode(isSesvSurvey ? 'SESV' : null);
      resetMixList();
      resetSesvList();
      setBaseType(baseTypeFromAddNo(v.addNo));
      // Drop the "บันทึกแล้ว รอส่งงาน" feedback when the user moves to a
      // different claim — it only applies to the one we just saved.
      if (state.lastSavedClaim && state.lastSavedClaim !== v.claimNo) {
        state.lastSavedAt    = null;
        state.lastSavedSrc   = null;
        state.lastSavedClaim = null;
        try { sessionStorage.removeItem(SE_LAST_SAVED_KEY); } catch (_) { /* ignore */ }
      }
    } else if (surveyChanged && isSesvSurvey && state.batchMode !== 'SESV') {
      // Same claim, user navigated to a SESV sub-form — flip to SESV mode.
      setBatchMode('SESV');
    } else if (addNoChanged && !state.batchMode) {
      setBaseType(baseTypeFromAddNo(v.addNo));
    }

    render();
    scheduleDupCheck();
  }

  const observer = new MutationObserver((mutations) => {
    for (const m of mutations) {
      if (panel.contains(m.target)) continue;
      refreshFromPage();
      return;
    }
  });
  observer.observe(document.body, {
    childList: true,
    subtree: true,
    characterData: true,
    attributes: true,
    attributeFilter: ['value'],
  });

  refreshFromPage();
  // Fallback poll (for input.value = 'x' which doesn't fire mutation)
  setInterval(refreshFromPage, 2000);

  // Server reachability ping — updates the header dot on its own cadence so it
  // stays green whenever the LAN server is up, independent of dup-check.
  healthPing();
  setInterval(healthPing, 10_000);

  console.log(`[SE Survey Helper] v${chrome.runtime.getManifest().version} loaded`);
})();
