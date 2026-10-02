/* ============================================================
   theme.js — automatic seasonal themes
   ------------------------------------------------------------
   Include in <head> of every page (before body renders so there
   is no flash of the wrong colours):
     <link rel="stylesheet" href="../css/themes.css">
     <script src="../js/theme.js"></script>

   Themes (edit SEASONS to change dates):
     christmas   1 Dec – 26 Dec
     newyear    27 Dec –  3 Jan
     valentines 10 Feb – 14 Feb
     default    every other day

   Preview / override (remembered in this browser):
     any page + ?theme=christmas   force a theme
     any page + ?theme=default     force the normal look
     any page + ?theme=auto        go back to date-based
   Or in the console:  JinoTheme.set('christmas')
   ============================================================ */
(function () {
  'use strict';

  // [name, startMonth, startDay, endMonth, endDay]  (months 1-12, inclusive)
  var SEASONS = [
    ['christmas',   12,  1, 12, 26],
    ['newyear',     12, 27,  1,  3],   // wraps over the year end
    ['valentines',   2, 10,  2, 14]
  ];
  var KEY = 'jino-theme-override';

  function inRange(d, sm, sd, em, ed) {
    var v = (d.getMonth() + 1) * 100 + d.getDate();
    var s = sm * 100 + sd, e = em * 100 + ed;
    return s <= e ? (v >= s && v <= e) : (v >= s || v <= e);
  }
  function byDate() {
    var now = new Date();
    for (var i = 0; i < SEASONS.length; i++) {
      var s = SEASONS[i];
      if (inRange(now, s[1], s[2], s[3], s[4])) return s[0];
    }
    return 'default';
  }
  function store(v) { try { v ? localStorage.setItem(KEY, v) : localStorage.removeItem(KEY); } catch (e) {} }
  function stored() { try { return localStorage.getItem(KEY); } catch (e) { return null; } }

  function pick() {
    var m = /[?&]theme=([a-z]+)/i.exec(location.search);
    if (m) {
      var q = m[1].toLowerCase();
      if (q === 'auto') store(null); else store(q);
    }
    return stored() || byDate();
  }

  var theme = pick();
  document.documentElement.setAttribute('data-theme', theme);

  /* ---- Wrap standalone <img class="brand-logo"> so the hat can attach ---- */
  function decorateLogos() {
    var imgs = document.querySelectorAll('img.brand-logo');
    for (var i = 0; i < imgs.length; i++) {
      var img = imgs[i];
      if (img.parentNode.classList.contains('logo-deco')) continue;
      var w = document.createElement('span');
      w.className = 'logo-deco';
      img.parentNode.insertBefore(w, img);
      w.appendChild(img);
    }
  }

  /* ---- Gentle snowfall (Christmas only; skipped for reduced motion) ---- */
  function snow() {
    if (window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    var c = document.createElement('canvas');
    c.id = 'jino-snow';
    document.body.appendChild(c);
    var ctx = c.getContext('2d'), W, H, flakes = [];
    function size() { W = c.width = innerWidth; H = c.height = innerHeight; }
    size(); addEventListener('resize', size);
    var n = Math.min(46, Math.round(innerWidth / 30));
    for (var i = 0; i < n; i++) flakes.push({
      x: Math.random() * W, y: Math.random() * H,
      r: Math.random() * 2 + 0.8, v: Math.random() * 0.5 + 0.25, d: Math.random() * Math.PI * 2
    });
    (function frame() {
      ctx.clearRect(0, 0, W, H);
      ctx.fillStyle = 'rgba(150,190,220,.55)';
      for (var i = 0; i < flakes.length; i++) {
        var f = flakes[i];
        f.y += f.v; f.d += 0.01; f.x += Math.sin(f.d) * 0.35;
        if (f.y > H + 5) { f.y = -5; f.x = Math.random() * W; }
        ctx.beginPath(); ctx.arc(f.x, f.y, f.r, 0, 6.283); ctx.fill();
      }
      if (!document.hidden) requestAnimationFrame(frame); else setTimeout(frame, 500);
    })();
  }

  document.addEventListener('DOMContentLoaded', function () {
    decorateLogos();
    if (theme === 'christmas') snow();
  });

  window.JinoTheme = {
    current: function () { return theme; },
    set: function (t) { store(t === 'auto' ? null : t); location.reload(); }
  };
})();
