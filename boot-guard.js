// Boot guard, shared by every page that loads supabase-js from the CDN.
// Each page's <script type="module"> sets window.__supabaseLoaded = true on the line after its import.
// If that import is blocked (factory network, CDN outage) the module never runs at all: the loading
// spinner would turn forever and buttons wired up by the module would do nothing.
// This classic script runs first and does not depend on anything else loading.
(function () {
  var TIMEOUT_MS = 15000;

  function reason() {
    if (!navigator.onLine) return 'อุปกรณ์นี้ไม่ได้เชื่อมต่ออินเทอร์เน็ต';
    if (!window.__supabaseLoaded) {
      return 'โหลดส่วนประกอบของระบบ (cdn.jsdelivr.net) ไม่ได้ เครือข่ายอาจบล็อกอยู่ ' +
             'ลองสลับไปใช้ 4G หรือแจ้งผู้ดูแลระบบ';
    }
    return 'ฐานข้อมูลตอบช้าหรือไม่ตอบกลับ ตรวจสัญญาณ Wi-Fi แล้วลองใหม่';
  }

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    e.className = cls;
    if (text) e.textContent = text;   // textContent, never innerHTML: the last step may hold a server error message
    return e;
  }

  function panel(lastStep) {
    var box = el('div', 'boot-fail');
    box.setAttribute('role', 'alert');
    box.appendChild(el('div', 'boot-fail-title', 'เชื่อมต่อไม่สำเร็จ'));
    box.appendChild(el('div', 'boot-fail-detail', reason()));
    if (lastStep) box.appendChild(el('div', 'boot-fail-step', 'ขั้นตอนล่าสุด: ' + lastStep));
    var retry = el('button', 'boot-fail-retry', 'ลองใหม่');
    retry.type = 'button';
    retry.onclick = function () { location.reload(); };
    box.appendChild(retry);
    return box;
  }

  window.bootGuard = { reason: reason };

  // Pages with a full-screen #loadingOverlay (store, pr, print-qr): replace the spinner once, at boot only.
  // The store reuses the same overlay later for imports; the guard has stopped watching by then.
  var start = Date.now();
  var timer = setInterval(function () {
    var o = document.getElementById('loadingOverlay');
    if (!o) {
      if (document.readyState !== 'loading') clearInterval(timer);   // this page has no overlay
      return;
    }
    if (getComputedStyle(o).display === 'none') { clearInterval(timer); return; }   // booted
    if (Date.now() - start < TIMEOUT_MS) return;
    clearInterval(timer);
    var stepEl = o.querySelector('.loading-text');
    var lastStep = stepEl ? stepEl.textContent.trim() : '';
    o.textContent = '';
    o.appendChild(panel(lastStep));
  }, 500);
})();
