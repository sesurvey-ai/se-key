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
        <span id="se-conn-dot" class="se-conn-dot" title="สถานะ server"></span>
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
      <div class="se-row">
        <label class="se-label">ผู้คีย์</label>
        <div id="se-keyer" class="se-value se-empty se-keyer">รอข้อมูล...</div>
      </div>
      <div id="se-submit-status" class="se-submit-status se-submit-idle">
        <span id="se-submit-icon">🔴</span>
        <span id="se-submit-text">ยังไม่ได้ส่งงานบนเว็บ</span>
      </div>
      <div id="se-status" class="se-status" hidden></div>
      <button type="button" id="se-open-records" class="se-open-records">
        📋 ดูรายการในฐานข้อมูล
      </button>
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
    connDot:     $('se-conn-dot'),
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
    canSend:     false,
    saving:      false,
    // Web-submit gate — panel auto-saves only after user clicks the eClaim3
    // submit button AND the success popup appears AND user clicks OK.
    //   source: 'new'    → #wuFlow1_cmdSendNew → save + send iSurvey
    //           'update' → #btnSurvey_Update   → save only (isurvey_sent=0, "รอส่ง")
    webClickedAt:    null,      // timestamp of last submit-button click
    webClickSource:  null,      // 'new' | 'update' | null
    webConfirmedAt:  null,      // timestamp when success popup appeared
    autoFiring:      false,     // guard against double auto-fire
    lastChecked: { claim: null, survey: null },
  };

  // If the server URL changes in settings, re-ping and re-run the dup check.
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.serverUrl) {
      healthPing();
      scheduleDupCheck(true);
    }
  });

  // ---------- Collapse/expand ----------
  let collapsed = false;
  els.header.addEventListener('click', () => {
    if (isDragging) return;
    collapsed = !collapsed;
    els.body.style.display = collapsed ? 'none' : 'block';
    els.toggle.textContent = collapsed ? '+' : '—';
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

  const saveRecord = (payload) =>
    callApi({ op: 'save', payload }).then((b) => b.record);

  const sendIsurvey = (id) =>
    callApi({ op: 'send-isurvey', id });

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

  // ---------- Save ----------
  //   skipIsurvey=true (update path): save row to DB, leave isurvey_sent=0
  //   ("รอส่ง") — no POST to /api/send-isurvey.
  async function triggerSave({ skipIsurvey = false } = {}) {
    if (state.saving || !state.canSend) return;
    state.saving = true;
    render();

    const base = {
      claim_no:  state.claimNo,
      survey_no: state.surveyNo,
      keyer:     state.keyer,
      work_type: state.workType,
    };

    try {
      if (state.workType === 'งานรวม') {
        await saveBatch(base, getFilledMixValues(), resetMixList, { skipIsurvey });
      } else if (state.workType === 'SESV') {
        await saveBatch(base, getFilledSesvValues(), resetSesvList, { skipIsurvey });
      } else {
        await saveOne({ ...base, invoice_mix: '' }, { skipIsurvey });
      }
    } catch (err) {
      setStatus(`ผิดพลาด: ${err.message}`, 'err');
    } finally {
      state.saving = false;
      state.lastChecked = { claim: null, survey: null };
      scheduleDupCheck(true);
      render();
    }
  }

  // --- Web-submit gate --------------------------------------------------
  // 1) listen for clicks on the eClaim3 "ส่งงานใหม่" button
  // 2) listen for SweetAlert success popup appearing
  // 3) when user dismisses popup (clicks OK), auto-fire panel save
  const WEB_CLICK_TTL_MS = 60_000;  // popup must appear within this window after click

  // Two save entry points on eClaim3:
  //   - #wuFlow1_cmdSendNew  → "ส่งงานใหม่" → SweetAlert success popup → save + iSurvey
  //   - #btnSurvey_Update    → "บันทึกราคา" → native window.alert      → save only, รอส่ง
  document.addEventListener('click', (e) => {
    if (!e.target.closest) return;
    const newBtn    = e.target.closest('#wuFlow1_cmdSendNew');
    const updateBtn = e.target.closest('#btnSurvey_Update');
    if (!newBtn && !updateBtn) return;
    state.webClickSource = newBtn ? 'new' : 'update';
    state.webClickedAt = Date.now();
    state.webConfirmedAt = null;
    render();
  }, true);

  // Watch for .swal-modal appearing with a success icon
  const swalObserver = new MutationObserver((mutations) => {
    for (const m of mutations) {
      for (const n of m.addedNodes) {
        if (!n || n.nodeType !== 1) continue;
        const modal = n.matches?.('.swal-modal') ? n : n.querySelector?.('.swal-modal');
        if (!modal) continue;
        if (!modal.querySelector('.swal-icon--success')) continue;

        // Ignore popups that aren't tied to our submit click
        if (!state.webClickedAt
            || Date.now() - state.webClickedAt > WEB_CLICK_TTL_MS) continue;

        state.webConfirmedAt = Date.now();
        render();

        const okBtn = modal.querySelector('.swal-button--confirm');
        if (okBtn) okBtn.addEventListener('click', onSuccessDismissed, { once: true });
      }
    }
  });
  swalObserver.observe(document.body, { childList: true, subtree: true });

  // Native alert path: page-inject.js wraps window.alert and dispatches this
  // event from the page world. 'dismissed' fires when the user clicks OK —
  // equivalent to the swal OK-button click above, so we auto-fire the save.
  const ALERT_SUCCESS_RE = /บันทึก.*เรียบร้อย/;
  window.addEventListener('se-page-alert', (e) => {
    const detail = e.detail || {};
    if (!ALERT_SUCCESS_RE.test(detail.text || '')) return;
    if (!state.webClickedAt
        || Date.now() - state.webClickedAt > WEB_CLICK_TTL_MS) return;

    if (detail.phase === 'shown') {
      state.webConfirmedAt = Date.now();
      render();
    } else if (detail.phase === 'dismissed') {
      onSuccessDismissed();
    }
  });

  async function onSuccessDismissed() {
    if (state.autoFiring) return;
    if (!state.webConfirmedAt) return;
    const skipIsurvey = state.webClickSource === 'update';
    if (!state.canSend) {
      setStatus('ข้อมูลใน panel ไม่ครบ — ไม่ได้ auto save', 'warn');
      return;
    }
    state.autoFiring = true;
    try {
      await triggerSave({ skipIsurvey });
    } finally {
      state.autoFiring = false;
      // Consume the web-submit gate — additional panel saves on the same claim
      // require another web submit to avoid committing rows that weren't sent.
      state.webClickedAt = null;
      state.webConfirmedAt = null;
      state.webClickSource = null;
      render();
    }
  }

  async function saveOne(payload, { skipIsurvey = false } = {}) {
    setStatus('กำลังบันทึก...', 'busy');
    // Update path: tell the server to update the existing pending row for
    // this (claim, survey) instead of piling on a new one every edit.
    const record = await saveRecord({ ...payload, upsert_pending: skipIsurvey });
    if (skipIsurvey) {
      setStatus(`บันทึกแก้ไข id=${record.id} ✓ (รอส่ง iSurvey)`, 'ok');
      return;
    }
    setStatus(`บันทึกแล้ว (id=${record.id}) — กำลังส่ง iSurvey...`, 'busy');
    const result = await sendIsurvey(record.id);
    if (result.skipped) {
      setStatus(`บันทึก id=${record.id} ✓ (${state.workType} ไม่ส่ง iSurvey)`, 'ok');
    } else if (result.sent) {
      setStatus(`ส่งสำเร็จ id=${record.id} ✓`, 'ok');
    } else {
      setStatus(`บันทึก id=${record.id} แต่สถานะ iSurvey ไม่ชัด`, 'warn');
    }
  }

  // batch: เดินวนทีละ invoice, ข้ามช่องว่าง, ไม่หยุดเมื่อ iSurvey fail —
  // record ที่ iSurvey fail จะมี isurvey_sent=0 ให้ retry ได้ทีหลัง
  //
  // DB column mapping for งานรวม/SESV:
  //   survey_no   = value user typed (ส่งไป iSurvey)
  //   invoice_mix = เลขเซอร์เวย์จาก DOM (เก็บเป็น reference)
  async function saveBatch(base, values, resetFn, { skipIsurvey = false } = {}) {
    const total = values.length;
    const results = { ok: 0, failed: [] };
    for (let i = 0; i < total; i++) {
      const typed = values[i];
      const payload = {
        claim_no:    base.claim_no,
        survey_no:   typed,
        keyer:       base.keyer,
        work_type:   base.work_type,
        invoice_mix: base.survey_no,
        // Same upsert semantics as saveOne for the update path.
        upsert_pending: skipIsurvey,
      };
      setStatus(`กำลังบันทึก ${i + 1}/${total} — ${typed} ...`, 'busy');
      let record;
      try {
        record = await saveRecord(payload);
      } catch (err) {
        results.failed.push({ index: i + 1, typed, where: 'save', reason: err.message });
        continue;
      }
      if (skipIsurvey) { results.ok++; continue; }
      try {
        const r = await sendIsurvey(record.id);
        if (r.sent || r.skipped) results.ok++;
        else results.failed.push({ index: i + 1, typed, where: 'isurvey', reason: 'ไม่แน่ใจสถานะ' });
      } catch (err) {
        results.failed.push({ index: i + 1, typed, where: 'isurvey', reason: err.message });
      }
    }

    if (results.failed.length === 0) {
      const suffix = skipIsurvey ? ' (รอส่ง iSurvey)' : '';
      setStatus(`สำเร็จทั้งหมด ${results.ok}/${total} ✓${suffix}`, 'ok');
      if (resetFn) resetFn();
    } else {
      const failList = results.failed.map((f) => `${f.typed}(${f.where})`).join(', ');
      setStatus(`สำเร็จ ${results.ok}/${total}, พัง ${results.failed.length}: ${failList}`, 'err');
      // keep failed rows in the list? we already saved to DB for the iSurvey-failed
      // ones (isurvey_sent=0), so the user can retry from the server side later.
      // For simplicity clear the list; retries will be handled via server logs.
    }
  }

  function setStatus(text, kind) {
    els.status.textContent = text || '';
    els.status.className = 'se-status' + (kind ? ` se-status-${kind}` : '');
    els.status.hidden = !text;
  }

  // Connection indicator dot in the header.
  //   kind: 'ok' (green) | 'err' (red) | null (gray)
  function setConn(kind, tooltip) {
    els.connDot.className = 'se-conn-dot' + (kind ? ` se-conn-${kind}` : '');
    els.connDot.title = tooltip
      || (kind === 'ok'  ? 'เชื่อม server ได้'
        : kind === 'err' ? 'เชื่อม server ไม่ได้'
        : 'ยังไม่ทราบสถานะ');
  }

  // ---------- Render ----------
  function render() {
    // Claim field — red if dup has any "ส่งแล้ว", orange if dup is all "รอส่ง".
    if (state.claimNo) {
      els.claim.textContent = state.claimNo;
      if (state.claimDup && state.claimSent) {
        els.claimLabel.textContent = 'มีเลขเคลมนี้แล้ว (ส่งแล้ว)';
        els.claim.className = 'se-value se-dup';
      } else if (state.claimDup) {
        els.claimLabel.textContent = 'มีเลขเคลมนี้แล้ว (รอส่ง)';
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
        els.surveyLabel.textContent = 'เลขเซอร์เวย์ซ้ำ (ส่งแล้ว) — เลือก SESV/งานรวม';
        els.survey.className = 'se-value se-dup';
      } else if (state.surveyDup) {
        els.surveyLabel.textContent = 'เลขเซอร์เวย์ซ้ำ (รอส่ง)';
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

    // Keyer
    if (state.keyer) {
      els.keyer.textContent = state.keyer;
      els.keyer.className = 'se-value se-found se-keyer';
    } else {
      els.keyer.textContent = 'ไม่พบข้อมูลผู้ใช้';
      els.keyer.className = 'se-value se-empty se-keyer';
    }

    // Work-type rows
    els.mixRow.hidden  = state.workType !== 'งานรวม';
    els.sesvRow.hidden = state.workType !== 'SESV';

    // Can we send?
    const hasCore  = state.claimNo && state.surveyNo && state.keyer;
    const noDup    = !state.claimDup && !state.surveyDup;
    const mixOk    = state.workType !== 'งานรวม' || getFilledMixValues().length > 0;
    const sesvOk   = state.workType !== 'SESV'    || getFilledSesvValues().length > 0;
    // For งานรวม/SESV the user explicitly overrides dup — we only require
    // dup-free for งานต้น/งานตาม (the tk.py rule).
    // Update path (#btnSurvey_Update) also bypasses dup: the original row is
    // already in DB by definition, so claim/survey will always look duplicate.
    const isUpdate = state.webClickSource === 'update';
    const dupOk    = isUpdate || state.workType === 'งานรวม' || state.workType === 'SESV' || noDup;
    state.canSend  = !state.saving && hasCore && mixOk && sesvOk && dupOk;

    renderSubmitStatus();
  }

  // Submit-gate status area (replaces the manual save button).
  function renderSubmitStatus() {
    const el = els.submitStatus;
    const isUpdate = state.webClickSource === 'update';
    const verb = isUpdate ? 'บันทึกแก้ไข' : 'ส่งงาน';
    let icon, text, cls;

    if (state.saving || state.autoFiring) {
      icon = '⏳'; text = 'กำลังบันทึก...'; cls = 'se-submit-busy';
    } else if (state.webConfirmedAt) {
      icon = '🟢';
      text = `${verb}บนเว็บสำเร็จ — กด OK บน popup เพื่อ auto save`;
      cls = 'se-submit-confirmed';
    } else if (state.webClickedAt) {
      icon = '🟡'; text = 'รอ popup ยืนยันจาก server...'; cls = 'se-submit-pending';
    } else {
      icon = '🔴'; text = 'ยังไม่ได้ส่งงานบนเว็บ'; cls = 'se-submit-idle';
    }

    els.submitIcon.textContent = icon;
    els.submitText.textContent = text;
    el.className = `se-submit-status ${cls}`;
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

    const claimChanged = v.claimNo && v.claimNo !== state.lastAutoClaim;
    const addNoChanged = v.addNo !== lastRead.addNo;

    lastRead = v;
    state.claimNo  = v.claimNo;
    state.surveyNo = v.surveyNo;
    state.keyer    = v.keyer;
    state.addNo    = v.addNo;

    // Auto-pick base type from ddlAdd_No.
    //   - On new claim: always re-apply and clear batch mode.
    //   - On same claim but addNo changed: update base type only if not in batch mode
    //     (don't yank radio selection out from under a disabled state).
    if (claimChanged) {
      state.lastAutoClaim = v.claimNo;
      setBatchMode(null);
      resetMixList();
      resetSesvList();
      setBaseType(baseTypeFromAddNo(v.addNo));
      // Reset web-submit gate: new claim requires a fresh web submit
      state.webClickedAt = null;
      state.webConfirmedAt = null;
      state.webClickSource = null;
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
