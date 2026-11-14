// painted-window.js: a window painted stroke by stroke, after Szinyei Merse Pál's plein-air pictures (Léggömb, Majális).
// ochre stucco in afternoon sun with violet shadows, red louvered shutters in the balloon's red, a terracotta box of
// geraniums, and through the window the léggömb sky with the striped balloon. under it a majolica tile with the sign.
// how: a flat guide scene is drawn first, then repainted coarse to fine with short strokes that follow its edges
// (painterly rendering after hertzmann 1998). fine strokes only go where the picture still differs from the guide.
// seeded, so it paints the same picture every time.
//   <a href="workshop.html" data-painted-window>…</a>      link: shutters ajar, swing open on hover, click steps through
//   <div data-painted-window="open" data-sign="A|B"></div> picture only, shutters open, own sign ("|" = line break)
//   <a data-pw-target="#id">…</a>                           any other link that should step through the same window
(() => {
  const W = 400, H = 560, S = 2;                       // base units; canvas is painted at 2x
  const O = { x: 110, y: 76, w: 180, h: 270 };         // the window opening
  const P = {
    wallLit: [236, 205, 150], wallMid: [222, 178, 112], wallShade: [190, 140, 86],
    stone: [241, 230, 206], stoneMid: [222, 207, 178], stoneDark: [196, 178, 146],
    skyTop: [44, 86, 172], skyMid: [70, 118, 196], skyLow: [150, 178, 220], haze: [206, 214, 226],
    cloud: [246, 241, 228], cloudShade: [178, 182, 210],
    hill: [104, 132, 168], field: [118, 150, 84], fieldLit: [176, 178, 96],
    red: [184, 64, 42], redLit: [214, 98, 64], redDark: [122, 36, 24], cream: [240, 228, 200],
    leaf: [72, 120, 58], leafLit: [128, 164, 72], leafDark: [40, 76, 40],
    bloom: [212, 44, 44], bloomLit: [240, 92, 72], pink: [228, 130, 136],
    terra: [178, 88, 52], terraLit: [206, 122, 76], terraDark: [128, 58, 34],
    wood: [74, 48, 32], cobalt: [38, 70, 150], ochre: [204, 150, 52], tile: [242, 234, 212],
    violet: [96, 76, 132],
  };
  const css = (c, a = 1) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;
  const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);

  function rng(seed) { return () => { seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

  // ---------- the guide scene (flat shapes, no strokes yet) ----------
  function quad(g, pts) { g.beginPath(); g.moveTo(pts[0][0], pts[0][1]); for (const p of pts.slice(1)) g.lineTo(p[0], p[1]); g.closePath(); }
  const lerp = (p, q, t) => [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t];
  function seg(g, p, q, col, w) { g.strokeStyle = col; g.lineWidth = w; g.beginPath(); g.moveTo(p[0], p[1]); g.lineTo(q[0], q[1]); g.stroke(); }

  // a louvered shutter as a quad: a hinge-top, b hinge-bottom, c free-bottom, d free-top. lit = facing the sun
  function shutter(g, a, b, c, d, lit) {
    const base = lit ? mix(P.red, P.redLit, .45) : P.red;
    quad(g, [a, b, c, d]); g.fillStyle = css(base); g.fill();
    g.save(); quad(g, [a, b, c, d]); g.clip();
    for (let t = .06; t < .95; t += .031) {
      if (Math.abs(t - .5) < .03) continue;
      const l = lerp(a, b, t), r = lerp(d, c, t), l2 = lerp(l, r, .13), r2 = lerp(l, r, .87);
      seg(g, [l2[0], l2[1] + 1.6], [r2[0], r2[1] + 1.6], css(P.redDark), 2.4);
      seg(g, [l2[0], l2[1] - 1.1], [r2[0], r2[1] - 1.1], css(lit ? P.redLit : mix(P.red, P.redLit, .6)), 1.3);
    }
    const m1 = lerp(a, b, .5), m2 = lerp(d, c, .5);
    seg(g, m1, m2, css(P.redDark), 7); seg(g, [m1[0], m1[1] - 2.5], [m2[0], m2[1] - 2.5], css(P.redLit, .7), 1.5);
    g.restore();
    quad(g, [a, b, c, d]); g.strokeStyle = css(P.redDark); g.lineWidth = 5; g.stroke();
    for (const t of [.14, .86]) { const h = lerp(a, b, t), h2 = lerp(h, lerp(d, c, t), .3); seg(g, h, h2, 'rgba(40,24,18,.85)', 3); }
  }

  function guide(state) {
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const g = c.getContext('2d', { willReadFrequently: true });
    const r = rng(7);
    // wall, lit from the upper left
    const wall = g.createLinearGradient(0, 0, W * .9, H);
    wall.addColorStop(0, css(P.wallLit)); wall.addColorStop(.5, css(P.wallMid)); wall.addColorStop(1, css(P.wallShade));
    g.fillStyle = wall; g.fillRect(0, 0, W, H);
    for (let i = 0; i < 34; i++) { g.fillStyle = r() < .55 ? 'rgba(252,232,190,.35)' : 'rgba(176,112,62,.16)'; g.beginPath(); g.ellipse(r() * W, r() * H, 18 + r() * 60, 10 + r() * 32, r() * 3, 0, 7); g.fill(); }
    for (let i = 0; i < 5; i++) { g.fillStyle = 'rgba(206,150,96,.35)'; g.beginPath(); g.ellipse(r() * W, H * .6 + r() * H * .4, 16 + r() * 22, 8 + r() * 10, r() * 3, 0, 7); g.fill(); }   // bare patches where the plaster's gone
    // cornice over the window, and its violet shadow
    g.fillStyle = css(P.violet, .34); g.fillRect(86, 62, 236, 14);
    g.fillStyle = css(P.stone); g.fillRect(80, 40, 240, 16); g.fillStyle = css(P.stoneMid); g.fillRect(84, 56, 232, 8);
    // stone surround and its shadow
    g.fillStyle = css(P.violet, .32); g.fillRect(104, 72, 208, 296);
    g.fillStyle = css(P.stone); g.fillRect(96, 64, 208, 294);
    g.fillStyle = css(P.stoneMid); g.fillRect(286, 64, 18, 294);
    g.fillStyle = css(P.stoneMid); g.fillRect(96, 70, 208, 4);
    // the view: léggömb sky, a low cloud bank, hazy hills and fields, the balloon
    g.save(); g.beginPath(); g.rect(O.x, O.y, O.w, O.h); g.clip();
    const sky = g.createLinearGradient(0, O.y, 0, O.y + O.h);
    sky.addColorStop(0, css(P.skyTop)); sky.addColorStop(.45, css(P.skyMid)); sky.addColorStop(.78, css(P.skyLow)); sky.addColorStop(1, css(P.haze));
    g.fillStyle = sky; g.fillRect(O.x, O.y, O.w, O.h);
    // cumulus: puffs along a dome, violet-grey underneath, warm white where the sun hits, flat bottoms
    const cr = rng(19);
    for (const [cx, cy, sc] of [[134, 262, .9], [206, 252, 1.15], [272, 266, .85], [160, 290, 1.05], [244, 292, 1.1]]) {
      const puffs = [];
      for (let k = 0; k <= 8; k++) { const a = Math.PI * k / 8; puffs.push([cx - Math.cos(a) * 32 * sc + (cr() - .5) * 6, cy - Math.sin(a) * 13 * sc + (cr() - .5) * 5, (9 + cr() * 8) * sc]); }
      g.fillStyle = css(P.cloudShade); for (const [x, y, q] of puffs) { g.beginPath(); g.arc(x + 2, y + 4, q, 0, 7); g.fill(); }
      g.fillStyle = css(P.cloud); for (const [x, y, q] of puffs) { g.beginPath(); g.arc(x - 1.5, y - 2.5, q * .82, 0, 7); g.fill(); }
      g.fillStyle = css(mix(P.cloudShade, P.violet, .25)); g.beginPath(); g.ellipse(cx, cy + 9 * sc, 38 * sc, 5 * sc, 0, 0, 7); g.fill();
    }
    for (const [cx, cy, rx, ry] of [[136, 124, 30, 7], [262, 108, 26, 6], [224, 150, 18, 4]]) { g.fillStyle = css(P.cloud, .55); g.beginPath(); g.ellipse(cx, cy, rx, ry, -.1, 0, 7); g.fill(); }
    g.fillStyle = css(P.hill); g.beginPath(); g.moveTo(O.x, 312); g.quadraticCurveTo(160, 300, 200, 309); g.quadraticCurveTo(250, 302, O.x + O.w, 311); g.lineTo(O.x + O.w, 360); g.lineTo(O.x, 360); g.fill();
    g.fillStyle = css(P.field); g.fillRect(O.x, 318, O.w, 30);
    g.fillStyle = css(P.fieldLit); g.fillRect(O.x, 324, O.w, 5); g.fillStyle = css(mix(P.field, P.leafDark, .4)); g.fillRect(O.x, 334, O.w, 14);
    const bx = 204, by = 168, br = 22;
    g.fillStyle = css(P.redDark); g.beginPath(); g.ellipse(bx, by, br, br * 1.08, 0, 0, 7); g.fill();
    for (let i = -3; i <= 3; i++) { g.fillStyle = css(i % 2 ? P.cream : (i < 0 ? P.redLit : P.red)); g.beginPath(); g.ellipse(bx + i * br / 4.2, by, br / 8 + .5, br * 1.04 * Math.sqrt(1 - (i / 4.2) ** 2), 0, 0, 7); g.fill(); }
    g.fillStyle = 'rgba(255,240,220,.35)'; g.beginPath(); g.ellipse(bx - 8, by - 9, 6, 9, -.4, 0, 7); g.fill();
    seg(g, [bx - 9, by + br - 1], [bx - 4, by + br + 15], 'rgba(60,40,30,.8)', 1); seg(g, [bx + 9, by + br - 1], [bx + 4, by + br + 15], 'rgba(60,40,30,.8)', 1);
    g.fillStyle = css(P.wood); g.fillRect(bx - 5, by + br + 14, 10, 7);
    g.restore();
    // the reveal: lit stone on the left jamb, lintel shadow along the top; inner casements swung in at the sides
    g.fillStyle = css(P.stoneMid); g.fillRect(O.x, O.y, 9, O.h);
    g.fillStyle = css(mix(P.stoneDark, P.violet, .3)); g.fillRect(O.x, O.y, O.w, 9);
    g.fillStyle = css(mix(P.stoneDark, P.violet, .2)); g.fillRect(O.x + O.w - 9, O.y, 9, O.h);
    for (const x of [O.x + 9, O.x + O.w - 21]) {                       // glazed casements, cream frames, seen nearly edge-on
      g.fillStyle = css(mix(P.stone, P.stoneDark, .35)); g.fillRect(x, O.y + 9, 12, O.h - 9);
      g.fillStyle = css(mix(P.skyLow, P.cloud, .35)); for (let y = O.y + 15; y < O.y + O.h - 12; y += 86) g.fillRect(x + 3, y, 6, 80);
    }
    // shutters. open: flat on the wall each side. ajar: swung half across, the free edges nearer to us
    if (state === 'open') {
      g.fillStyle = css(P.violet, .34); g.fillRect(36, 76, 64, 282); g.fillRect(314, 76, 62, 282);
      shutter(g, [94, 70], [94, 350], [30, 350], [30, 70], true);
      shutter(g, [306, 70], [306, 350], [370, 350], [370, 70], false);
    } else {
      shutter(g, [O.x, O.y - 2], [O.x, O.y + O.h + 2], [O.x + 44, O.y + O.h + 22], [O.x + 44, O.y - 20], true);
      g.fillStyle = css(P.violet, .3); quad(g, [[O.x + O.w - 60, O.y], [O.x + O.w, O.y], [O.x + O.w, O.y + O.h], [O.x + O.w - 60, O.y + O.h]]); g.fill();
      shutter(g, [O.x + O.w, O.y - 2], [O.x + O.w, O.y + O.h + 2], [O.x + O.w - 44, O.y + O.h + 22], [O.x + O.w - 44, O.y - 20], false);
    }
    // sill, flower box, geraniums spilling over
    g.fillStyle = css(P.violet, .36); g.fillRect(94, 358, 226, 14);
    g.fillStyle = css(P.stone); g.fillRect(86, 344, 228, 10); g.fillStyle = css(P.stoneMid); g.fillRect(86, 354, 228, 6);
    g.fillStyle = css(P.violet, .34); g.fillRect(112, 368, 194, 34);
    g.fillStyle = css(P.terra); g.fillRect(104, 360, 192, 34);
    g.fillStyle = css(P.terraLit); g.fillRect(104, 360, 192, 6); g.fillStyle = css(P.terraDark); g.fillRect(104, 388, 192, 6);
    for (let x = 122; x < 290; x += 34) { g.fillStyle = css(P.terraDark, .6); g.fillRect(x, 372, 16, 3); }
    const fr = rng(11);
    for (let i = 0; i < 70; i++) { const x = 106 + fr() * 188, y = 334 + fr() * 30; g.fillStyle = css(fr() < .35 ? P.leafDark : fr() < .7 ? P.leaf : P.leafLit); g.beginPath(); g.ellipse(x, y, 6 + fr() * 6, 4 + fr() * 4, fr() * 3, 0, 7); g.fill(); }
    for (let i = 0; i < 9; i++) {                                         // ivy trailing over the box, uneven lengths
      const x = 112 + fr() * 176, len = 22 + fr() * 42, ex = x + (fr() - .5) * 16, y0 = 364;
      g.strokeStyle = css(P.leafDark); g.lineWidth = 1.6; g.beginPath(); g.moveTo(x, y0); g.quadraticCurveTo(x + (fr() - .5) * 10, y0 + len * .6, ex, y0 + len); g.stroke();
      for (let t = 6, s = 1; t < len; t += 6 + fr() * 3, s = -s) { const q = t / len; g.fillStyle = css(fr() < .5 ? P.leaf : P.leafLit); g.beginPath(); g.ellipse(x + (ex - x) * q + s * 3.5, y0 + t, 3.4, 4.6, s * .6, 0, 7); g.fill(); }
    }
    for (let i = 0; i < 18; i++) { const cx = 112 + fr() * 176, cy = 326 + fr() * 18; for (let j = 0; j < 7; j++) { g.fillStyle = css(j < 2 ? P.bloomLit : fr() < .2 ? P.pink : P.bloom); g.beginPath(); g.arc(cx + (fr() - .5) * 13, cy + (fr() - .5) * 11, 2.6 + fr() * 2.4, 0, 7); g.fill(); } }
    // the majolica tile: cream glaze, cobalt double border, ochre corners (the lettering goes on after the strokes)
    g.fillStyle = css(P.violet, .32); g.beginPath(); g.roundRect(78, 432, 256, 90, 8); g.fill();
    g.fillStyle = css(P.tile); g.beginPath(); g.roundRect(72, 426, 256, 90, 8); g.fill();
    g.strokeStyle = css(P.cobalt); g.lineWidth = 3.4; g.beginPath(); g.roundRect(79, 433, 242, 76, 5); g.stroke();
    g.lineWidth = 1.2; g.beginPath(); g.roundRect(84, 438, 232, 66, 3); g.stroke();
    for (const [x, y] of [[84, 438], [316, 438], [84, 504], [316, 504]]) { g.fillStyle = css(P.ochre); g.beginPath(); g.arc(x, y, 4.2, 0, 7); g.fill(); }
    return g.getImageData(0, 0, W, H);
  }

  // ---------- the painting ----------
  function paint(canvas, state, sign) {
    canvas.width = W * S; canvas.height = H * S;
    const g = canvas.getContext('2d', { willReadFrequently: true });
    g.setTransform(S, 0, 0, S, 0, 0);
    const ref = guide(state).data;
    const ix = (x, y) => ((Math.max(0, Math.min(H - 1, y | 0)) * W) + Math.max(0, Math.min(W - 1, x | 0))) * 4;
    const col = (x, y) => { const i = ix(x, y); return [ref[i], ref[i + 1], ref[i + 2]]; };
    const lum = (x, y) => { const i = ix(x, y); return .3 * ref[i] + .59 * ref[i + 1] + .11 * ref[i + 2]; };
    const far = (a, b) => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]);
    const r = rng(state === 'open' ? 42 : 17);
    g.fillStyle = css(P.wallMid); g.fillRect(0, 0, W, H);
    const layers = [[18, 0], [10, 30], [5.5, 30], [3, 36], [1.7, 44]];
    for (const [size, T] of layers) {
      const cur = T ? g.getImageData(0, 0, W * S, H * S).data : null;
      const now = (x, y) => { const xx = Math.max(0, Math.min(W * S - 1, (x * S) | 0)), yy = Math.max(0, Math.min(H * S - 1, (y * S) | 0)), i = (yy * W * S + xx) * 4; return [cur[i], cur[i + 1], cur[i + 2]]; };
      const step = size * .85, pts = [];
      for (let y = step / 2; y < H; y += step) for (let x = step / 2; x < W; x += step) {
        const px = x + (r() - .5) * step, py = y + (r() - .5) * step;
        if (cur) { const o = size / 3; const e = (far(now(px, py), col(px, py)) + far(now(px - o, py + o), col(px - o, py + o)) + far(now(px + o, py - o), col(px + o, py - o))) / 3; if (e < T) continue; }
        pts.push([px, py]);
      }
      for (let i = pts.length - 1; i > 0; i--) { const j = (r() * (i + 1)) | 0; [pts[i], pts[j]] = [pts[j], pts[i]]; }
      for (const [x, y] of pts) {
        const c0 = col(x, y);
        const gx = lum(x + 1.5, y) - lum(x - 1.5, y), gy = lum(x, y + 1.5) - lum(x, y - 1.5), mag = Math.hypot(gx, gy);
        const flow = .3 + .65 * Math.sin(x * .019 + y * .011) + .4 * Math.sin(y * .027 - x * .009);      // the hand's direction where nothing else decides
        const ang = (mag > 4 ? Math.atan2(gy, gx) + Math.PI / 2 : flow) + (r() - .5) * .45;
        const dx = Math.cos(ang), dy = Math.sin(ang), half = size * (.65 + r() * .8);
        // stop each end at a strong colour edge, so big strokes don't smear the shutters into the sky
        const reach = sgn => { let t = 0; while (t < half) { const n = t + size * .4; if (far(col(x + dx * n * sgn, y + dy * n * sgn), c0) > 70) break; t = n; } return Math.max(size * .25, Math.min(t, half)); };
        const t1 = reach(-1), t2 = reach(1);
        const j = (r() - .5) * (size > 6 ? 18 : 12), w = (r() - .5) * 8;
        const cc = [c0[0] + j + w, c0[1] + j, c0[2] + j - w].map(v => Math.round(Math.max(0, Math.min(255, v))));
        const lw = size * (.6 + r() * .3), bend = (r() - .5) * size * .5;
        const x1 = x - dx * t1, y1 = y - dy * t1, x2 = x + dx * t2, y2 = y + dy * t2, mx = x - dy * bend, my = y + dx * bend;
        g.lineCap = 'round'; g.lineWidth = lw; g.strokeStyle = css(cc, .82 + r() * .18);
        g.beginPath(); g.moveTo(x1, y1); g.quadraticCurveTo(mx, my, x2, y2); g.stroke();
        if (size >= 5 && r() < .45) {                                     // a ridge of paint catching the light, top-left side of the stroke
          const nx = -dy, ny = dx, s = (nx + ny < 0 ? 1 : -1) * lw * .22;
          g.lineWidth = lw * .28; g.strokeStyle = css(mix(cc, [255, 250, 236], .28), .3);
          g.beginPath(); g.moveTo(x1 + nx * s, y1 + ny * s); g.quadraticCurveTo(mx + nx * s, my + ny * s, x2 + nx * s, y2 + ny * s); g.stroke();
        }
      }
    }
    letter(g, sign);
    // a faint linen weave, then ragged painted edges so it sits on the page like a study, not a box
    const tr = rng(5); g.globalAlpha = .06;
    for (let i = 0; i < 2600; i++) { g.fillStyle = tr() < .5 ? '#fff8e8' : '#3a2a1a'; g.fillRect(tr() * W, tr() * H, 1 + tr() * 2.5, .6); }
    g.globalAlpha = 1;
    const m = document.createElement('canvas'); m.width = W * S; m.height = H * S;
    const mg = m.getContext('2d'); mg.setTransform(S, 0, 0, S, 0, 0); mg.fillStyle = '#000'; mg.strokeStyle = '#000'; mg.lineCap = 'round';
    mg.beginPath(); mg.roundRect(20, 20, W - 40, H - 40, 18); mg.fill();
    const er = rng(3);
    const edge = (x, y, nx, ny) => { const a = Math.atan2(ny, nx) + Math.PI / 2 + (er() - .5) * .9, l = 8 + er() * 16, lw = 6 + er() * 12, o = er() * lw * .5; mg.lineWidth = lw; mg.beginPath(); mg.moveTo(x + nx * o - Math.cos(a) * l, y + ny * o - Math.sin(a) * l); mg.lineTo(x + nx * o + Math.cos(a) * l, y + ny * o + Math.sin(a) * l); mg.stroke(); };
    for (let x = 20; x < W - 20; x += 7) { edge(x, 22, 0, -1); edge(x, H - 22, 0, 1); }
    for (let y = 20; y < H - 20; y += 7) { edge(22, y, -1, 0); edge(W - 22, y, 1, 0); }
    g.setTransform(1, 0, 0, 1, 0, 0); g.globalCompositeOperation = 'destination-in'; g.drawImage(m, 0, 0); g.globalCompositeOperation = 'source-over';
  }

  // hand-lettered cobalt on the tile: each letter a touch off its neighbours, a second thin pass for the brush
  function letter(g, sign) {
    const lines = String(sign || 'Come see my|creative world').split('|').slice(0, 2);
    const lr = rng(23), size = lines.length > 1 ? 27 : 30;
    g.font = `italic 400 ${size}px Newsreader, Georgia, serif`; g.textBaseline = 'alphabetic';
    const ys = lines.length > 1 ? [464, 497] : [482];
    lines.forEach((text, li) => {
      let w = g.measureText(text).width, k = 1;
      if (w > 224) { k = 224 / w; w = 224; }
      let x = 200 - w / 2;
      for (const ch of text) {
        const cw = g.measureText(ch).width * k, jy = (lr() - .5) * 1.4, rot = (lr() - .5) * .05;
        g.save(); g.translate(x, ys[li] + jy); g.rotate(rot); g.scale(k, 1);
        g.fillStyle = css(P.cobalt, .92); g.fillText(ch, 0, 0);
        g.fillStyle = css(mix(P.cobalt, [120, 150, 220], .5), .28); g.fillText(ch, .6, -.4);
        g.restore(); x += cw;
      }
    });
  }

  // ---------- on the page ----------
  const style = document.createElement('style');
  style.textContent = `
    .pw{ display:block; text-decoration:none; color:inherit; -webkit-tap-highlight-color:transparent; }
    .pw-frame{ position:relative; display:block; width:100%; aspect-ratio:${W} / ${H}; transform-origin:50% ${((O.y + O.h / 2) / H * 100).toFixed(1)}%;
      transition:transform .9s cubic-bezier(.55,0,.75,.2), opacity .45s ease .45s; }
    .pw-c{ position:absolute; inset:0; width:100%; height:100%; display:block; opacity:0; transition:opacity .7s ease; }
    .pw-a.pw-in{ opacity:1; }
    a.pw:hover .pw-b.pw-in, a.pw:focus-visible .pw-b.pw-in, .pw.pw-opening .pw-b.pw-in{ opacity:1; transition-duration:.45s; }
    .pw.pw-entering .pw-frame{ transform:scale(2.8); opacity:0; position:relative; z-index:60; }
    a.pw:focus-visible{ outline:2px solid #C1440E; outline-offset:4px; }
    @media (prefers-reduced-motion: reduce){ .pw-frame, .pw-c{ transition:none; } }`;
  document.head.appendChild(style);

  const fontReady = () => (document.fonts && document.fonts.load ? document.fonts.load('italic 400 28px Newsreader').catch(() => null) : Promise.resolve());
  const idle = fn => ('requestIdleCallback' in window ? requestIdleCallback(fn, { timeout: 600 }) : setTimeout(fn, 30));
  const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

  // an in-page link (href="#id") steps through the window into that part of the page: a sky-coloured veil
  // covers the jump, then lifts, and the window resets so it is still there if you scroll back up
  function arrive(el) {
    const href = el.getAttribute('href') || '';
    if (!href.startsWith('#')) { location.href = el.href; return; }
    const target = document.querySelector(href);
    const veil = document.createElement('div');
    veil.style.cssText = 'position:fixed;inset:0;z-index:90;pointer-events:none;opacity:0;transition:opacity .35s ease;background:radial-gradient(120% 90% at 50% 40%, #8aa6d6, #3f6dbd 70%)';
    document.body.append(veil);
    requestAnimationFrame(() => { veil.style.opacity = reduced() ? '0' : '1'; });
    setTimeout(() => {
      if (target) target.scrollIntoView({ block: 'start', behavior: 'auto' });
      history.replaceState(null, '', href);
      el.classList.remove('pw-opening', 'pw-entering');
      document.dispatchEvent(new CustomEvent('pw:arrived', { detail: { href } }));
      veil.style.transition = 'opacity .9s ease'; veil.style.opacity = '0';
      setTimeout(() => veil.remove(), 1000);
    }, reduced() ? 0 : 380);
  }
  function enter(el) {
    if (reduced()) { arrive(el); return; }
    const shut = !!el.querySelector('.pw-b');
    el.classList.add('pw-opening');
    setTimeout(() => el.classList.add('pw-entering'), shut ? 380 : 0);
    setTimeout(() => arrive(el), shut ? 1000 : 640);
  }
  const plain = e => e.defaultPrevented || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0;

  function mount(el) {
    const state = el.dataset.paintedWindow === 'open' ? 'open' : 'ajar', sign = el.dataset.sign;
    const link = el.tagName === 'A';
    el.classList.add('pw');
    const frame = document.createElement('span'); frame.className = 'pw-frame';
    const a = document.createElement('canvas'); a.className = 'pw-c pw-a'; a.setAttribute('aria-hidden', 'true'); frame.append(a);
    const b = link && state === 'ajar' ? document.createElement('canvas') : null;
    if (b) { b.className = 'pw-c pw-b'; b.setAttribute('aria-hidden', 'true'); frame.append(b); }
    el.prepend(frame);
    fontReady().then(() => idle(() => {
      paint(a, state, sign); a.classList.add('pw-in');
      if (b) idle(() => { paint(b, 'open', sign); b.classList.add('pw-in'); });
    }));
    if (link) el.addEventListener('click', e => { if (plain(e)) return; e.preventDefault(); enter(el); });
  }

  function start() {
    document.querySelectorAll('[data-painted-window]').forEach(mount);
    document.querySelectorAll('[data-pw-target]').forEach(t => t.addEventListener('click', e => {
      const el = document.querySelector(t.dataset.pwTarget); if (!el || plain(e)) return;
      e.preventDefault(); el.scrollIntoView({ block: 'center', behavior: reduced() ? 'auto' : 'smooth' }); setTimeout(() => enter(el), reduced() ? 0 : 350);
    }));
  }
  // coming back with the browser's back button restores the page mid-zoom; reset it
  addEventListener('pageshow', e => { if (e.persisted) document.querySelectorAll('.pw').forEach(el => el.classList.remove('pw-opening', 'pw-entering')); });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
