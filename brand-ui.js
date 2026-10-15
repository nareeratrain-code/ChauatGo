/* Tiny galaxy canvas for splash and login screens. No libraries. */
(function () {
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function hostOf(canvas) {
    return canvas.closest('.cg-galaxy') || canvas.parentElement;
  }

  function hidden(host) {
    if (!host || !host.isConnected) return true;
    if (host.classList.contains('hidden')) return true;
    var style = window.getComputedStyle(host);
    return style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0';
  }

  function paint(canvas) {
    var ctx = canvas.getContext('2d');
    if (!ctx) return;
    var host = hostOf(canvas);
    var stars = [];
    var shoots = [];
    var raf = 0;
    var running = false;
    var w = 0;
    var h = 0;

    function resize() {
      var rect = host.getBoundingClientRect();
      w = Math.max(1, Math.round(rect.width || window.innerWidth));
      h = Math.max(1, Math.round(rect.height || window.innerHeight));
      var dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      canvas.style.width = w + 'px';
      canvas.style.height = h + 'px';
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (!stars.length) {
        var count = Math.min(90, Math.round((w * h) / 7000));
        for (var i = 0; i < count; i++) {
          stars.push({
            x: Math.random() * w,
            y: Math.random() * h,
            r: Math.random() * 1.3 + 0.35,
            p: Math.random() * Math.PI * 2,
            s: 0.6 + Math.random() * 1.4
          });
        }
      }
    }

    function drawStars(twinkle) {
      ctx.clearRect(0, 0, w, h);
      for (var i = 0; i < stars.length; i++) {
        var st = stars[i];
        var alpha = twinkle ? (0.28 + Math.abs(Math.sin(st.p)) * 0.72) : 0.8;
        ctx.fillStyle = 'rgba(255,255,255,' + alpha.toFixed(3) + ')';
        ctx.beginPath();
        ctx.arc(st.x, st.y, st.r, 0, Math.PI * 2);
        ctx.fill();
        if (twinkle) st.p += 0.02 * st.s;
      }
    }

    function frame() {
      if (!running) return;
      if (hidden(host)) {
        stop();
        return;
      }
      drawStars(true);
      if (Math.random() < 0.012 && shoots.length < 2) {
        shoots.push({
          x: Math.random() * w * 0.8,
          y: Math.random() * h * 0.45,
          vx: 3.2 + Math.random() * 2.4,
          vy: 1.1 + Math.random() * 0.8,
          life: 1
        });
      }
      for (var j = shoots.length - 1; j >= 0; j--) {
        var sh = shoots[j];
        sh.x += sh.vx;
        sh.y += sh.vy;
        sh.life -= 0.018;
        ctx.strokeStyle = 'rgba(255,255,255,' + Math.max(sh.life, 0).toFixed(3) + ')';
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.moveTo(sh.x, sh.y);
        ctx.lineTo(sh.x - sh.vx * 7, sh.y - sh.vy * 7);
        ctx.stroke();
        if (sh.life <= 0 || sh.x > w + 20) shoots.splice(j, 1);
      }
      raf = window.requestAnimationFrame(frame);
    }

    function start() {
      if (running || hidden(host)) return;
      running = true;
      raf = window.requestAnimationFrame(frame);
    }

    function stop() {
      running = false;
      if (raf) window.cancelAnimationFrame(raf);
      raf = 0;
    }

    resize();
    if (reduce) {
      drawStars(false);
    } else {
      start();
    }

    window.addEventListener('resize', function () {
      resize();
      if (reduce) drawStars(false);
    });

    if (window.MutationObserver && host) {
      var obs = new MutationObserver(function () {
        if (hidden(host)) stop();
        else if (!reduce) start();
      });
      obs.observe(host, { attributes: true, attributeFilter: ['class', 'style'] });
    }
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) stop();
      else if (!reduce && !hidden(host)) start();
    });
  }

  function boot() {
    var canvases = document.querySelectorAll('.cg-galaxy canvas.cg-stars');
    for (var i = 0; i < canvases.length; i++) paint(canvases[i]);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
