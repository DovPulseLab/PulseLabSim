/* =====================================================================
   Minimal canvas charting (no external libraries, works offline).
   Charts.line(canvas, cfg)  — line chart with axes, legend, shading,
   markers, brackets and a hover crosshair readout.
   ===================================================================== */
(function (global) {
  'use strict';

  const css = name => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const col = c => (c && c.startsWith('--')) ? css(c) : c;

  function niceStep(range, target) {
    const raw = range / Math.max(1, target);
    const mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const n = raw / mag;
    return (n < 1.5 ? 1 : n < 3 ? 2 : n < 7 ? 5 : 10) * mag;
  }
  function ticks(lo, hi, target) {
    const s = niceStep(hi - lo, target), out = [];
    for (let v = Math.ceil(lo / s) * s; v <= hi + 1e-9; v += s) out.push(+v.toFixed(10));
    return { list: out, step: s };
  }
  function fmt(v, step) {
    const dec = step >= 1 ? 0 : Math.min(3, Math.ceil(-Math.log10(step)));
    return v.toFixed(dec);
  }

  function setup(canvas) {
    const dpr = window.devicePixelRatio || 1;
    const r = canvas.getBoundingClientRect();
    const w = Math.max(50, r.width), h = Math.max(50, r.height);
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
    }
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { ctx, w, h };
  }

  function line(canvas, cfg) {
    canvas._cfg = cfg;
    if (!canvas._hoverBound && cfg.hover !== false) bindHover(canvas);
    draw(canvas);
  }

  function draw(canvas, hoverX) {
    const cfg = canvas._cfg; if (!cfg) return;
    const { ctx, w, h } = setup(canvas);
    const fs = parseFloat(getComputedStyle(document.body).fontSize) || 14;
    const small = Math.round(fs * 0.8);
    const font = s => `${s}px -apple-system, BlinkMacSystemFont, "Helvetica Neue", Arial, sans-serif`;
    ctx.clearRect(0, 0, w, h);

    const legendH = cfg.legend === false ? 0 : small + 10;
    const pad = { l: small * 3.6 + (cfg.yLabel ? small + 4 : 0), r: cfg.y2 ? small * 3.8 : 14, t: 10 + legendH, b: small * 2.2 + (cfg.xLabel ? small + 4 : 0) };
    const pw = w - pad.l - pad.r, ph = h - pad.t - pad.b;

    // ----- extents -----
    const all = cfg.series.filter(s => !s.y2 && !s.hidden);
    let xMin = cfg.xMin, xMax = cfg.xMax, yMin = cfg.yMin, yMax = cfg.yMax;
    if (xMin == null) xMin = Math.min(...all.map(s => Math.min(...s.x)));
    if (xMax == null) xMax = Math.max(...all.map(s => Math.max(...s.x)));
    if (yMin == null || yMax == null) {
      let lo = Infinity, hi = -Infinity;
      all.forEach(s => s.y.forEach(v => { if (isFinite(v)) { lo = Math.min(lo, v); hi = Math.max(hi, v); } }));
      (cfg.hlines || []).forEach(l => { lo = Math.min(lo, l.y); hi = Math.max(hi, l.y); });
      if (!isFinite(lo)) { lo = 0; hi = 1; }
      const span = (hi - lo) || 1;
      if (yMin == null) yMin = lo - span * 0.08;
      if (yMax == null) yMax = hi + span * (cfg.headroom != null ? cfg.headroom : 0.14);
    }
    const X = v => pad.l + (v - xMin) / (xMax - xMin) * pw;
    const Y = v => pad.t + (1 - (v - yMin) / (yMax - yMin)) * ph;
    let Y2 = null, y2Min, y2Max;
    if (cfg.y2) {
      const s2 = cfg.series.filter(s => s.y2 && !s.hidden);
      let lo = Infinity, hi = -Infinity; s2.forEach(s => s.y.forEach(v => { if (isFinite(v)) { lo = Math.min(lo, v); hi = Math.max(hi, v); } }));
      if (!isFinite(lo)) { lo = 0; hi = 1; }
      const sp = (hi - lo) || 1; y2Min = cfg.y2.min != null ? cfg.y2.min : lo - sp * 0.08; y2Max = cfg.y2.max != null ? cfg.y2.max : hi + sp * 0.14;
      Y2 = v => pad.t + (1 - (v - y2Min) / (y2Max - y2Min)) * ph;
    }
    canvas._map = { X, Y, xMin, xMax, pad, pw, ph };

    // ----- shading -----
    (cfg.shades || []).forEach(s => {
      ctx.fillStyle = col(s.color || '--shade');
      const x0 = X(Math.max(xMin, s.x0)), x1 = X(Math.min(xMax, s.x1));
      ctx.fillRect(x0, pad.t, x1 - x0, ph);
      if (s.label) { ctx.fillStyle = col('--ink-3'); ctx.font = font(small); ctx.textAlign = 'center'; ctx.fillText(s.label, (x0 + x1) / 2, pad.t + small + 2); }
    });

    (cfg.notes || []).forEach(n => {
      ctx.fillStyle = col('--ink-3'); ctx.font = font(small); ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
      ctx.fillText(n.text, X(n.x), pad.t + ph - 4);
    });

    // ----- grid & axes -----
    ctx.font = font(small); ctx.lineWidth = 1;
    const yt = ticks(yMin, yMax, Math.max(3, Math.round(ph / 48)));
    ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    yt.list.forEach(v => {
      const y = Math.round(Y(v)) + 0.5;
      ctx.strokeStyle = col('--line-2'); ctx.beginPath(); ctx.moveTo(pad.l, y); ctx.lineTo(pad.l + pw, y); ctx.stroke();
      ctx.fillStyle = col('--ink-3'); ctx.fillText(fmt(v, yt.step), pad.l - 6, y);
    });
    const xt = ticks(xMin, xMax, Math.max(3, Math.round(pw / 80)));
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    xt.list.forEach(v => {
      const x = Math.round(X(v)) + 0.5;
      ctx.strokeStyle = col('--line-2'); ctx.beginPath(); ctx.moveTo(x, pad.t); ctx.lineTo(x, pad.t + ph); ctx.stroke();
      ctx.fillStyle = col('--ink-3'); ctx.fillText(cfg.xFmt ? cfg.xFmt(v) : fmt(v, xt.step), x, pad.t + ph + 5);
    });
    ctx.strokeStyle = col('--line'); ctx.strokeRect(pad.l + 0.5, pad.t + 0.5, pw, ph);
    if (cfg.y2) {
      const t2 = ticks(y2Min, y2Max, Math.max(3, Math.round(ph / 48)));
      ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
      t2.list.forEach(v => { ctx.fillStyle = col(cfg.y2.color || '--ink-3'); ctx.fillText(fmt(v, t2.step), pad.l + pw + 6, Y2(v)); });
    }
    if (cfg.xLabel) { ctx.fillStyle = col('--ink-2'); ctx.textAlign = 'center'; ctx.textBaseline = 'bottom'; ctx.fillText(cfg.xLabel, pad.l + pw / 2, h - 2); }
    if (cfg.yLabel) { ctx.save(); ctx.translate(small * 0.9, pad.t + ph / 2); ctx.rotate(-Math.PI / 2); ctx.fillStyle = col('--ink-2'); ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(cfg.yLabel, 0, 0); ctx.restore(); }
    if (cfg.y2 && cfg.y2.label) { ctx.save(); ctx.translate(w - small * 0.7, pad.t + ph / 2); ctx.rotate(Math.PI / 2); ctx.fillStyle = col(cfg.y2.color || '--ink-2'); ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(cfg.y2.label, 0, 0); ctx.restore(); }

    // ----- reference lines -----
    const dashLine = (x0, y0, x1, y1, c, dash) => { ctx.save(); ctx.strokeStyle = col(c); ctx.setLineDash(dash || [4, 4]); ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke(); ctx.restore(); };
    (cfg.hlines || []).forEach(l => {
      const y = Y(l.y); dashLine(pad.l, y, pad.l + pw, y, l.color || '--ink-3', l.dash);
      if (l.label) { ctx.fillStyle = col(l.color || '--ink-3'); ctx.font = font(small); ctx.textAlign = 'right'; ctx.textBaseline = 'bottom'; ctx.fillText(l.label, pad.l + pw - 4, y - 2); }
    });
    (cfg.vlines || []).forEach(l => {
      if (l.x < xMin || l.x > xMax) return;
      const x = X(l.x); dashLine(x, pad.t, x, pad.t + ph, l.color || '--ink-3', l.dash);
      if (l.label) { ctx.fillStyle = col(l.color || '--ink-3'); ctx.font = font(small); ctx.textAlign = l.align || 'left'; ctx.textBaseline = 'top'; ctx.fillText(l.label, x + (l.align === 'right' ? -4 : 4), pad.t + (l.dy || 4)); }
    });

    // ----- series -----
    cfg.series.forEach(s => {
      if (s.hidden) return;
      const YY = s.y2 ? Y2 : Y;
      ctx.save();
      ctx.globalAlpha = s.alpha != null ? s.alpha : 1;
      ctx.strokeStyle = col(s.color); ctx.lineWidth = s.width || 2; ctx.setLineDash(s.dash || []); ctx.lineJoin = 'round';
      if (s.fill) {
        ctx.beginPath(); ctx.moveTo(X(s.x[0]), YY(s.fillBase != null ? s.fillBase : yMin));
        for (let i = 0; i < s.x.length; i++) ctx.lineTo(X(s.x[i]), YY(s.y[i]));
        ctx.lineTo(X(s.x[s.x.length - 1]), YY(s.fillBase != null ? s.fillBase : yMin)); ctx.closePath();
        ctx.fillStyle = col(s.fill); ctx.fill();
      }
      if (s.points) {
        ctx.fillStyle = col(s.color);
        for (let i = 0; i < s.x.length; i++) { ctx.beginPath(); ctx.arc(X(s.x[i]), YY(s.y[i]), s.r || 3, 0, Math.PI * 2); ctx.fill(); }
      }
      if (!s.pointsOnly) {
        ctx.beginPath();
        let started = false;
        for (let i = 0; i < s.x.length; i++) {
          if (!isFinite(s.y[i])) { started = false; continue; }
          const px = X(s.x[i]), py = YY(s.y[i]);
          if (!started) { ctx.moveTo(px, py); started = true; } else ctx.lineTo(px, py);
        }
        ctx.stroke();
      }
      ctx.restore();
    });

    // ----- brackets (e.g. AP, PP) -----
    (cfg.brackets || []).forEach(b => {
      const x = X(b.x), y0 = Y(b.y0), y1 = Y(b.y1), c = col(b.color || '--ink-2');
      ctx.save(); ctx.strokeStyle = c; ctx.lineWidth = 1.4;
      ctx.beginPath(); ctx.moveTo(x - 4, y0); ctx.lineTo(x, y0); ctx.lineTo(x, y1); ctx.lineTo(x - 4, y1); ctx.stroke();
      ctx.fillStyle = c; ctx.font = font(small); ctx.textAlign = b.align || 'left'; ctx.textBaseline = 'middle';
      ctx.fillText(b.label, x + (b.align === 'right' ? -7 : 6), (y0 + y1) / 2);
      ctx.restore();
    });

    // ----- point markers -----
    (cfg.marks || []).forEach(m => {
      const x = X(m.x), y = Y(m.y), c = col(m.color || '--ink');
      ctx.save(); ctx.fillStyle = col('--panel'); ctx.strokeStyle = c; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(x, y, 4, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      if (m.label) {
        ctx.font = `600 ${small}px -apple-system, BlinkMacSystemFont, Arial, sans-serif`; ctx.fillStyle = c;
        const pos = m.pos || 'above';
        ctx.textAlign = pos === 'right' ? 'left' : pos === 'left' ? 'right' : 'center';
        ctx.textBaseline = pos === 'below' ? 'top' : pos === 'above' ? 'bottom' : 'middle';
        const dx = pos === 'right' ? 8 : pos === 'left' ? -8 : 0, dy = pos === 'above' ? -7 : pos === 'below' ? 7 : 0;
        ctx.fillText(m.label, x + dx, y + dy);
      }
      ctx.restore();
    });

    // ----- legend -----
    if (cfg.legend !== false) {
      ctx.font = font(small); ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
      let lx = pad.l; const ly = 4 + small / 2 + 2;
      cfg.series.filter(s => s.label && !s.hidden).forEach(s => {
        ctx.save(); ctx.strokeStyle = col(s.color); ctx.lineWidth = Math.max(2, s.width || 2); ctx.setLineDash(s.dash || []); ctx.globalAlpha = s.alpha != null ? Math.max(0.6, s.alpha) : 1;
        ctx.beginPath(); ctx.moveTo(lx, ly); ctx.lineTo(lx + 18, ly); ctx.stroke(); ctx.restore();
        ctx.fillStyle = col('--ink-2'); ctx.fillText(s.label, lx + 23, ly);
        lx += 23 + ctx.measureText(s.label).width + 16;
      });
    }

    // ----- hover crosshair -----
    if (hoverX != null && hoverX >= xMin && hoverX <= xMax) {
      const x = X(hoverX);
      ctx.save(); ctx.strokeStyle = col('--ink-3'); ctx.setLineDash([2, 3]); ctx.beginPath(); ctx.moveTo(x, pad.t); ctx.lineTo(x, pad.t + ph); ctx.stroke(); ctx.restore();
      const rows = [];
      cfg.series.forEach(s => {
        if (s.hidden || !s.label || s.noHover) return;
        let best = 0, bd = Infinity;
        for (let i = 0; i < s.x.length; i++) { const dd = Math.abs(s.x[i] - hoverX); if (dd < bd) { bd = dd; best = i; } }
        const YY = s.y2 ? Y2 : Y;
        ctx.fillStyle = col(s.color); ctx.beginPath(); ctx.arc(X(s.x[best]), YY(s.y[best]), 3.5, 0, Math.PI * 2); ctx.fill();
        rows.push([s.label, s.y[best], s.color]);
      });
      if (rows.length) {
        ctx.font = font(small);
        const head = (cfg.hoverX ? cfg.hoverX(hoverX) : hoverX.toFixed(2));
        const lines = [head].concat(rows.map(r => `${r[0]}: ${(cfg.hoverFmt ? cfg.hoverFmt(r[1]) : r[1].toFixed(1))}`));
        const bw = Math.max(...lines.map(l => ctx.measureText(l).width)) + 18, bh = lines.length * (small + 5) + 8;
        let bx = x + 12; if (bx + bw > pad.l + pw) bx = x - 12 - bw;
        const by = pad.t + 6;
        ctx.fillStyle = col('--panel'); ctx.strokeStyle = col('--line'); ctx.globalAlpha = 0.96;
        ctx.beginPath(); ctx.roundRect ? ctx.roundRect(bx, by, bw, bh, 6) : ctx.rect(bx, by, bw, bh); ctx.fill(); ctx.stroke(); ctx.globalAlpha = 1;
        ctx.textAlign = 'left'; ctx.textBaseline = 'top';
        lines.forEach((l, i) => { ctx.fillStyle = i === 0 ? col('--ink') : col(rows[i - 1][2]); ctx.fillText(l, bx + 9, by + 5 + i * (small + 5)); });
      }
    }
  }

  function bindHover(canvas) {
    canvas._hoverBound = true;
    canvas.addEventListener('mousemove', e => {
      const m = canvas._map; if (!m) return;
      const r = canvas.getBoundingClientRect();
      const px = e.clientX - r.left;
      if (px < m.pad.l || px > m.pad.l + m.pw) { draw(canvas); return; }
      const xv = m.xMin + (px - m.pad.l) / m.pw * (m.xMax - m.xMin);
      draw(canvas, xv);
    });
    canvas.addEventListener('mouseleave', () => draw(canvas));
  }

  function redrawAll() { document.querySelectorAll('canvas').forEach(c => { if (c._cfg && c.offsetParent) draw(c); }); }

  global.Charts = { line, redrawAll, css, col };
})(window);
