/* Draws a QR code to a <canvas> using QRCode.make() from qrcode.js.
   One flat colour (brand blue) on white. Round data dots, rounded corner
   finders, centre disc with the TaskTracker mark knocked out in white.
   Dark enough on white to scan in both themes. */
(function () {
  'use strict';

  var INK = '#2B5BC0', PAPER = '#FFFFFF';
  var QUIET = 4; // quiet zone, in modules
  var DOT = 0.86; // dot diameter as a share of one module

  function reader(q) {
    var m = q && (q.modules || q.matrix) || q;
    if (Array.isArray(m) && Array.isArray(m[0])) {
      return { n: m.length, dark: function (r, c) { return !!m[r][c]; } };
    }
    if (m && typeof m.get === 'function' && typeof m.size === 'number') {
      return { n: m.size, dark: function (r, c) { return !!m.get(r, c); } };
    }
    if (q && typeof q.isDark === 'function' && typeof q.getModuleCount === 'function') {
      return { n: q.getModuleCount(), dark: function (r, c) { return !!q.isDark(r, c); } };
    }
    throw new Error('Unsupported result from QRCode.make()');
  }

  function rr(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function finder(ctx, r0, c0, cell) {
    var x = (c0 + QUIET) * cell, y = (r0 + QUIET) * cell;
    ctx.fillStyle = INK;
    rr(ctx, x, y, 7 * cell, 7 * cell, 2 * cell);
    ctx.fill();
    ctx.fillStyle = PAPER;
    rr(ctx, x + cell, y + cell, 5 * cell, 5 * cell, 1.25 * cell);
    ctx.fill();
    ctx.fillStyle = INK;
    rr(ctx, x + 2 * cell, y + 2 * cell, 3 * cell, 3 * cell, 0.9 * cell);
    ctx.fill();
  }

  function draw(canvas, text, opts) {
    try {
      var lib = typeof QRCode !== 'undefined' ? QRCode : window.QRCode;
      if (!lib || typeof lib.make !== 'function') throw new Error('QRCode.make is not available');
      var m = reader(lib.make(text, { errorCorrectionLevel: 'H' }));
      var n = m.n, total = n + QUIET * 2;
      var css = (opts && opts.size) || 240;
      var dpr = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
      var cell = Math.max(2, Math.floor((css * dpr) / total));
      var px = cell * total;

      canvas.width = px;
      canvas.height = px;
      canvas.style.width = (px / dpr) + 'px';
      var ctx = canvas.getContext('2d');
      ctx.fillStyle = PAPER;
      ctx.fillRect(0, 0, px, px);

      // Centre clear area in modules, about 22% of the width
      var bm = Math.max(5, Math.round(n * 0.22));
      if ((n - bm) % 2) bm += 1;
      var b0 = (n - bm) / 2, b1 = b0 + bm;

      // Data dots (finder zones are drawn separately)
      ctx.fillStyle = INK;
      var rad = (cell * DOT) / 2, off = cell / 2;
      for (var r = 0; r < n; r++) {
        for (var c = 0; c < n; c++) {
          if ((r < 7 && c < 7) || (r < 7 && c >= n - 7) || (r >= n - 7 && c < 7)) continue;
          if (r >= b0 && r < b1 && c >= b0 && c < b1) continue;
          if (!m.dark(r, c)) continue;
          ctx.beginPath();
          ctx.arc((c + QUIET) * cell + off, (r + QUIET) * cell + off, rad, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      finder(ctx, 0, 0, cell);
      finder(ctx, 0, n - 7, cell);
      finder(ctx, n - 7, 0, cell);

      // Centre disc with a white ring of clear space around it
      var bx = (QUIET + b0) * cell, bs = bm * cell, mid = bx + bs / 2;
      ctx.fillStyle = INK;
      ctx.beginPath();
      ctx.arc(mid, mid, bs * 0.45, 0, Math.PI * 2);
      ctx.fill();

      // Logo knocked out in white; the mark spans x 4 to 21, y 3 to 21
      var s = (bs * 0.5) / 24;
      ctx.save();
      ctx.translate(mid - 12.5 * s, mid - 12 * s);
      ctx.scale(s, s);
      ctx.lineWidth = 2.25;
      ctx.lineCap = 'square';
      ctx.lineJoin = 'miter';
      ctx.strokeStyle = PAPER;
      ctx.stroke(new Path2D('M12 3H4v18h16v-8'));
      ctx.stroke(new Path2D('M8 11.5l4 4L21 5.5'));
      ctx.restore();
      return true;
    } catch (e) {
      console.warn('QR drawing failed:', e);
      return false;
    }
  }

  window.drawTransferQR = draw;
})();