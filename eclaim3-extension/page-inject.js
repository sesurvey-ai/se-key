// Runs in the PAGE's main world (see manifest content_scripts world:"MAIN").
// Wraps window.alert so the content script (isolated world) can be notified
// when eClaim3 shows its native success dialog (e.g. "บันทึกการแก้ไขเรียบร้อยแล้ว").
// alert() is synchronous and blocks; the "dismissed" event fires the moment
// the user clicks OK and alert() returns.
(function () {
  'use strict';
  if (window.__seAlertHooked) return;
  window.__seAlertHooked = true;

  const origAlert = window.alert;
  window.alert = function (msg) {
    const text = String(msg == null ? '' : msg);
    try {
      window.dispatchEvent(new CustomEvent('se-page-alert', {
        detail: { text, phase: 'shown' },
      }));
    } catch (_) { /* ignore */ }

    const r = origAlert.apply(this, arguments);

    try {
      window.dispatchEvent(new CustomEvent('se-page-alert', {
        detail: { text, phase: 'dismissed' },
      }));
    } catch (_) { /* ignore */ }
    return r;
  };
})();
