(function () {
  var root = document.documentElement;
  var reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // Pointer position in viewport coordinates, shared by every effect
  var pointer = { x: -1e4, y: -1e4, active: false };
  window.addEventListener("pointermove", function (e) {
    pointer.type = e.pointerType;
    pointer.x = e.clientX; pointer.y = e.clientY; pointer.active = true;
  }, { passive: true });
  window.addEventListener("pointerdown", function (e) {
    pointer.x = e.clientX; pointer.y = e.clientY; pointer.active = true;
  }, { passive: true });
  window.addEventListener("pointerup", function (e) {
    if (e.pointerType !== "mouse") pointer.active = false;
  });
  document.addEventListener("mouseleave", function () { pointer.active = false; });

  function cssVar(name) { return getComputedStyle(root).getPropertyValue(name).trim(); }

  // Canvas colors as [r, g, b]. They ease toward the current theme's values, so
  // a day/night switch fades along with the page background instead of snapping.
  var palette = {}, target = {};
  function parseColor(v) {
    if (v.charAt(0) === "#") {
      if (v.length === 4) v = "#" + v[1] + v[1] + v[2] + v[2] + v[3] + v[3];
      var n = parseInt(v.slice(1), 16);
      return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    }
    return v.split(",").map(Number);
  }
  function readPalette(snap) {
    target.fg = parseColor(cssVar("--fg"));
    target.accent = parseColor(cssVar("--accent-rgb"));
    target.pulse = parseColor(cssVar("--pulse-rgb"));
    if (snap) for (var k in target) palette[k] = target[k].slice();
  }
  function stepPalette() {
    for (var k in target) {
      for (var i = 0; i < 3; i++) palette[k][i] += (target[k][i] - palette[k][i]) * 0.12;
    }
  }
  function rgba(c, a) {
    return "rgba(" + Math.round(c[0]) + "," + Math.round(c[1]) + "," + Math.round(c[2]) + "," + a + ")";
  }

  /* ------------------------------------------------------------------------
     Particle text: draws text offscreen, samples it into a few thousand
     particles that spring back to their place and scatter from the cursor.
  ------------------------------------------------------------------------ */
  function ParticleText(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.text = canvas.dataset.text || "";
    this.fit = parseFloat(canvas.dataset.fit) || 0.8;
    this.intro = canvas.dataset.intro === "true" && !reduceMotion;
    // Cursor behavior: "repel" (default) scatters particles, "attract" pulls them
    // in, "pulse" sends purple shockwaves out from the cursor every few seconds.
    this.mode = canvas.dataset.mode || "repel";
    // "flow": each particle drifts off in its own random direction and back
    this.flow = canvas.dataset.flow === "true" && !reduceMotion;
    // data-style="protein": cartoon (ribbon) protein chains that fold into the text
    // and unfold back into stretched-out chains on click
    this.protein = canvas.dataset.style === "protein";
    this.pulses = [];
    this.lastPulse = -1e9;
    this.visible = true;
    this.particles = [];
    this.build();
  }

  ParticleText.prototype.build = function () {
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    var rect = this.canvas.getBoundingClientRect();
    var w = Math.max(1, Math.round(rect.width));
    var h = Math.max(1, Math.round(rect.height));
    this.w = w; this.h = h; this.dpr = dpr;
    this.canvas.width = w * dpr;
    this.canvas.height = h * dpr;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // Size the text to fill `fit` of the width without overflowing the height
    var off = document.createElement("canvas");
    off.width = w; off.height = h;
    var o = off.getContext("2d");
    var font = function (px) { return "italic 400 " + px + "px 'Instrument Serif', Georgia, serif"; };
    o.font = font(100);
    var m = o.measureText(this.text);
    var inkH = (m.actualBoundingBoxAscent + m.actualBoundingBoxDescent) / 100;
    var size = Math.min((w * this.fit) / m.width * 100, (h * 0.9) / inkH);
    // Optionally match another field's type size (still never overflowing this canvas)
    if (this.matchSize) size = Math.min(size, this.matchSize);
    this.fontSize = size;
    o.font = font(size);
    m = o.measureText(this.text);
    var ascent = m.actualBoundingBoxAscent, descent = m.actualBoundingBoxDescent;
    o.fillStyle = "#fff";
    o.textBaseline = "alphabetic";
    o.fillText(this.text, (w - m.width) / 2, (h + ascent - descent) / 2);

    var data = o.getImageData(0, 0, w, h).data;
    var glyph = this.protein && window.PROTEIN_GLYPHS && window.PROTEIN_GLYPHS[this.text];
    if (glyph) { this.buildProtein(glyph, data, w, h); return; }
    this.protein = false;   // no protein data for this text: fall back to particles

    // Pick a grid step that gives roughly a fixed particle budget
    var ink = 0;
    for (var i = 3; i < data.length; i += 16) if (data[i] > 128) ink++;
    ink *= 4;
    var budget = w < 700 ? 1800 : 4200;
    var step = this.matchStep || Math.max(2, Math.min(9, Math.round(Math.sqrt(ink / budget))));
    this.step = step;
    this.size = Math.max(1.2, step * 0.42);

    var old = this.particles, ps = [];
    for (var y = 0; y < h; y += step) {
      for (var x = 0; x < w; x += step) {
        if (data[(y * w + x) * 4 + 3] > 128) {
          var p = old[ps.length] || {};
          p.hx = x; p.hy = y;
          if (p.x === undefined) {
            if (this.intro) {
              // Start scattered; the spring pulls everything into place
              var a = Math.random() * Math.PI * 2, r = (0.35 + Math.random()) * Math.max(w, h) * 0.6;
              p.x = w / 2 + Math.cos(a) * r; p.y = h / 2 + Math.sin(a) * r;
            } else { p.x = x; p.y = y; }
            p.vx = 0; p.vy = 0;
          }
          p.phase = Math.random() * Math.PI * 2;
          p.jitter = 0.5 + Math.random();
          // Flow: own speed, reach and starting direction per particle
          p.speed = 0.0008 + Math.random() * 0.0012;
          p.reach = (0.6 + Math.random()) * step * 2.4;
          p.angle = Math.random() * Math.PI * 2;
          p.cycle = -1;
          ps.push(p);
        }
      }
    }
    this.particles = ps;
    this.radius = Math.max(80, Math.min(w, h) * (this.mode === "attract" ? 0.42 : 0.26));
  };

  /* ------------------------------------------------------------------------
     Protein cartoon from real structures. assets/js/proteins.js holds C-alpha
     traces from the PDB (positions in glyph-relative units, depth and ribbon
     orientation in angstroms), each protein laid along one stroke of the text.
     Unfolded, every chain is stretched into a loose thread (3.8 A per residue).
  ------------------------------------------------------------------------ */
  ParticleText.prototype.buildProtein = function (glyph, data, w, h) {
    // Ink bounds of the rendered text; the structures are positioned relative to it
    var x0 = w, y0 = h, x1 = 0, y1 = 0;
    for (var y = 0; y < h; y++) {
      for (var x = 0; x < w; x++) {
        if (data[(y * w + x) * 4 + 3] > 128) {
          if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
        }
      }
    }
    var spx = (y1 - y0) / glyph.heightA;   // pixels per angstrom
    this.spx = spx;

    var ps = [], meta = [], segs = {};
    glyph.chains.forEach(function (c) {
      var start = ps.length, n = c.res.length;
      c.res.forEach(function (r, k) {
        ps.push({ grp: c.group, hx: x0 + r[0] * (x1 - x0), hy: y0 + r[1] * (y1 - y0), z: r[2],
          wx: r[3], wy: r[4], nz: r[5], ss: r[6], seg: r[7], cf: r[8], k: k });
      });
      // Strand ends (for arrowheads)
      for (var k = n - 1, end = -1; k >= 0; k--) {
        var q = ps[start + k];
        if (q.ss === 2) { if (end < 0 || ps[start + k + 1].seg !== q.seg) end = k; q.sEnd = end; }
        else end = -1;
      }
      // Loop residues travel with the helices/strands on either side of them
      var prev = -1;
      for (k = 0; k < n; k++) { var a = ps[start + k]; if (a.seg >= 0) prev = k; else a.prevK = prev; }
      var next = -1;
      for (k = n - 1; k >= 0; k--) { var b = ps[start + k]; if (b.seg >= 0) next = k; else b.nextK = next; }
      for (k = 0; k < n; k++) {
        var c2 = ps[start + k];
        if (c2.seg >= 0) continue;
        c2.prevSeg = c2.prevK >= 0 ? ps[start + c2.prevK].seg : -1;
        c2.nextSeg = c2.nextK >= 0 ? ps[start + c2.nextK].seg : -1;
        c2.wPrev = c2.prevK >= 0 ? 1 / (k - c2.prevK) : 0;
        c2.wNext = c2.nextK >= 0 ? 1 / (c2.nextK - k) : 0;
      }
      meta.push({ start: start, n: n, name: c.name, pdb: c.pdb, group: c.group, part: c.part });
    });
    ps.forEach(function (q) {
      if (q.seg < 0) return;
      var g = segs[q.seg] || (segs[q.seg] = { list: [] });
      g.list.push(q);
    });

    // Bond rest lengths in the native structure (as projected on screen)
    for (var i = 0; i < ps.length - 1; i++) ps[i].rest = Math.hypot(ps[i + 1].hx - ps[i].hx, ps[i + 1].hy - ps[i].hy);

    // Unfolded layout: one loose thread per chain, stacked across the canvas
    // Each assembly drifts as one rigid body once folded: slow, irregular
    // sway and a slight turn about its own center (sums of incommensurate sines)
    var floats = {};
    meta.forEach(function (m) {
      var f = floats[m.group] || (floats[m.group] = { cx: 0, cy: 0, n: 0, name: m.name, pdb: m.pdb,
        ph: [0, 1, 2, 3, 4, 5].map(function () { return Math.random() * 6.28; }),
        fr: [0, 1, 2, 3, 4, 5].map(function () { return 0.00045 + Math.random() * 0.0004; }) });
      for (var k = 0; k < m.n; k++) { f.cx += ps[m.start + k].hx; f.cy += ps[m.start + k].hy; f.n++; }
    });
    Object.keys(floats).forEach(function (k) { var f = floats[k]; f.cx /= f.n; f.cy /= f.n; f.dx = 0; f.dy = 0; f.a = 0; });
    this.floats = floats;
    this.hoverDim = 0; this.hoverGroup = -1; this.lastHover = -1;
    var ext = 3.8 * spx;
    this.ext = ext;
    var order = meta.map(function (m, idx) { return idx; }).sort(function () { return Math.random() - 0.5; });
    var nc = meta.length;
    var groups = [];
    meta.forEach(function (m) { if (groups.indexOf(m.group) < 0) groups.push(m.group); });
    groups.sort(function () { return Math.random() - 0.5; });
    meta.forEach(function (m, ci) {
      var slot = order.indexOf(ci);
      var ang = (Math.random() - 0.5) * 0.3;
      var cy = h * (0.1 + 0.8 * (slot + 0.5) / nc), cx = w * (0.5 + (Math.random() - 0.5) * 0.4);
      var w1 = Math.random() * 6.28, w2 = Math.random() * 6.28;
      var chainDelay = (groups.indexOf(m.group) / Math.max(1, groups.length - 1)) * 420 + m.part * 270;
      for (var k = 0; k < m.n; k++) {
        var p = ps[m.start + k], sAlong = (k - (m.n - 1) / 2) * ext;
        var wave = Math.sin(sAlong / (30 * spx) + w1) * 4 * spx + Math.sin(sAlong / (11 * spx) + w2) * 1.6 * spx;
        p.ix = cx + Math.cos(ang) * sAlong - Math.sin(ang) * wave;
        p.iy = cy + Math.sin(ang) * sAlong + Math.cos(ang) * wave;
        p.s = sAlong;
        // Fold: helices and strands nucleate first on the loose chain, then the
        // chain collapses into its native fold. Unfold reverses: the chain lets
        // go of its fold, then the secondary structure melts.
        p.delay = 780 + chainDelay + Math.random() * 300;           // loops settle
        p.udelay = chainDelay * 0.4 + Math.random() * 180;          // loops let go
        p.chainDelay = chainDelay;
      }
    });
    // Each helix/strand nucleates as a unit, at its own moment
    Object.keys(segs).forEach(function (id) {
      var g = segs[id], L = g.list, n = L.length;
      var cd = L[0].chainDelay;
      // Nucleate on the loose chain, then dock into the fold as one rigid piece
      var t0 = cd * 0.35 + Math.random() * 350;
      g.cStart = 650 + cd + Math.random() * 180;
      g.uStart = cd * 0.4 + Math.random() * 180;
      var melt = g.uStart + 600 + Math.random() * 300;
      g.cx = 0; g.cy = 0; g.tx = 0; g.ty = 0;
      L.forEach(function (q) { q.ndelay = t0; q.udelay = melt; q.melt = 0; g.cx += q.hx / n; g.cy += q.hy / n; g.tx += q.ix / n; g.ty += q.iy / n; });
      // While forming on the thread, the native piece is turned to lie along it
      var na = Math.atan2(L[n - 1].hy - L[0].hy, L[n - 1].hx - L[0].hx);
      var ta = Math.atan2(L[n - 1].iy - L[0].iy, L[n - 1].ix - L[0].ix);
      var th = ta - na;
      while (th > Math.PI) th -= 2 * Math.PI;
      while (th < -Math.PI) th += 2 * Math.PI;
      g.theta = th;
      g.c = 0; g.phi = th;
      g.sMid = (L[0].s + L[n - 1].s) / 2;
    });

    var folded = this.folded !== false;
    var instant = !this.intro;   // resize / reduced motion: no animation
    var zs = ps.map(function (q) { return q.z; });
    this.zMin = Math.min.apply(null, zs); this.zMax = Math.max.apply(null, zs);
    ps.forEach(function (q) {
      q.phase = Math.random() * Math.PI * 2;
      q.jitter = 0.5 + Math.random();
      q.speed = 0.0008 + Math.random() * 0.0012;
      q.reach = (0.4 + Math.random()) * spx * 0.35;   // thermal wobble
      q.angle = Math.random() * Math.PI * 2;
      q.cycle = -1;
      q.vx = 0; q.vy = 0;
      var home = instant && folded;
      q.home = home; q.ssOn = home && q.ss > 0; q.f = q.ssOn ? 1 : 0;
      if (q.seg >= 0) { segs[q.seg].c = home ? 1 : 0; segs[q.seg].phi = home ? 0 : segs[q.seg].theta; }
      q.x = home ? q.hx : q.ix; q.y = home ? q.hy : q.iy;
    });
    this.particles = ps;
    this.chains = meta;
    this.segs = segs;
    this.step = Math.max(2, Math.round(spx * 2));
    this.radius = 0;
    if (this.intro) { this.folded = false; this.transT0 = null; this.pendingFold = true; }
  };

  // Click: fold <-> unfold. Works mid-animation; residues pick up from where they are.
  ParticleText.prototype.toggleFold = function (t) {
    this.folded = !this.folded;
    this.transT0 = t;
  };

  // Queue a pulse at (x, y) in viewport coords, if that's over this canvas. The
  // next frame starts it on its own clock (event timestamps can run ahead of it).
  ParticleText.prototype.pulseAt = function (x, y) {
    if (this.mode !== "pulse") return;
    var rect = this.canvas.getBoundingClientRect();
    var px = x - rect.left, py = y - rect.top;
    if (px < 0 || py < 0 || px > this.w || py > this.h) return;
    this.queued = { x: px, y: py };
  };

  ParticleText.prototype.kick = function (dy) {
    // Scrolling nudges the particles, so the text shivers as the page moves
    var ps = this.particles;
    for (var i = 0; i < ps.length; i++) ps[i].vy += dy * 0.06 * ps[i].jitter;
  };

  var PULSE_EVERY = 4400;  // ms between pulses while the cursor is over the text
  var PULSE_SPEED = 0.42;  // px per ms
  var PULSE_LIFE = 2400;   // ms
  var PULSE_BAND = 40;     // thickness of the wavefront that pushes particles

  ParticleText.prototype.frame = function (t) {
    var ctx = this.ctx, ps = this.particles, w = this.w, h = this.h;
    var rect = this.canvas.getBoundingClientRect();
    var mx = pointer.x - rect.left, my = pointer.y - rect.top;
    var R = this.radius, R2 = R * R;
    var s = this.size;
    var near = pointer.active && mx > -R && my > -R && mx < w + R && my < h + R;
    var repel = near && this.mode === "repel";
    var attract = near && this.mode === "attract";

    // Pulses: emit from the cursor on a steady beat while it's over the text
    if (this.mode === "pulse") {
      // A click fires immediately and restarts the beat, so the automatic
      // pulse doesn't land right on top of it
      if (this.queued) {
        this.pulses.push({ x: this.queued.x, y: this.queued.y, t0: t });
        if (this.pulses.length > 8) this.pulses.shift();
        this.lastPulse = t;
        this.queued = null;
      }
      var inside = pointer.active && mx >= 0 && my >= 0 && mx <= w && my <= h;
      if (inside && t - this.lastPulse > PULSE_EVERY) {
        this.pulses.push({ x: mx, y: my, t0: t });
        this.lastPulse = t;
      }
      this.pulses = this.pulses.filter(function (q) { return t - q.t0 < PULSE_LIFE; });
    }
    var pulses = this.pulses;
    if (this.protein) {
      // First frame after load: start folding from the stretched-out state
      if (this.pendingFold) { this.pendingFold = false; this.intro = false; this.folded = true; this.transT0 = t + 300; }
      // Toggle on the frame clock (event timestamps can run ahead of it)
      if (this.queuedToggle) { this.queuedToggle = false; this.toggleFold(t); }
      var segs = this.segs, folded = this.folded, since0 = this.transT0 == null ? 1e9 : t - this.transT0;
      Object.keys(segs).forEach(function (id) {
        var g = segs[id], goal = g.c;
        if (folded && since0 > g.cStart) goal = 1;
        if (!folded && since0 > g.uStart) goal = 0;
        g.c += Math.max(-0.036, Math.min(0.036, goal - g.c));
        var e = g.c * g.c * (3 - 2 * g.c);            // smoothstep
        g.e = e; g.phi = g.theta * (1 - e);
      });
      var since = this.transT0 == null ? 1e9 : t - this.transT0;
      var spxF = this.spx, fl = this.floats;
      Object.keys(fl).forEach(function (k) {
        var f = fl[k], ph = f.ph, fr = f.fr;
        f.dx = (Math.sin(t * fr[0] + ph[0]) + 0.5 * Math.sin(t * fr[1] * 2.3 + ph[1])) * 1.4 * spxF;
        f.dy = (Math.sin(t * fr[2] + ph[2]) + 0.5 * Math.sin(t * fr[3] * 1.9 + ph[3])) * 1.4 * spxF;
        f.a = (Math.sin(t * fr[4] + ph[4]) + 0.4 * Math.sin(t * fr[5] * 2.7 + ph[5])) * 0.035;
        f.co = Math.cos(f.a); f.si = Math.sin(f.a);
      });
      this.hoverGroup = this.findHover(mx, my);
    }

    ctx.clearRect(0, 0, w, h);

    // Rings first, so particles draw on top of them
    for (var q = 0; q < pulses.length; q++) {
      var pu = pulses[q], age = t - pu.t0, life = 1 - age / PULSE_LIFE;
      ctx.beginPath();
      ctx.arc(pu.x, pu.y, Math.max(0, age * PULSE_SPEED), 0, Math.PI * 2);
      ctx.strokeStyle = rgba(palette.pulse, 0.8 * life * life);
      ctx.lineWidth = 2;
      ctx.stroke();
    }

    var calm = new Path2D(), hot = [];

    for (var i = 0; i < ps.length; i++) {
      var p = ps[i];
      var tx, ty;
      if (this.protein) {
        if (p.ss > 0) {
          var sg = this.segs[p.seg];
          if (this.folded && !p.ssOn && since > p.ndelay) p.ssOn = true;
          if (!this.folded && p.ssOn && sg.c <= 0 && since > p.udelay) p.ssOn = false;
          p.home = sg.c >= 1;
        } else {
          var wsum = p.wPrev + p.wNext, e = 0;
          if (wsum > 0) {
            if (p.prevSeg >= 0) e += this.segs[p.prevSeg].e * p.wPrev;
            if (p.nextSeg >= 0) e += this.segs[p.nextSeg].e * p.wNext;
            e /= wsum;
          } else {
            // A chain with no helices or strands: its own timer
            var goal = this.folded ? (since > p.delay ? 1 : 0) : (since > p.udelay ? 0 : 1);
            p.le = (p.le || 0) + Math.max(-0.036, Math.min(0.036, goal - (p.le || 0)));
            e = p.le * p.le * (3 - 2 * p.le);
          }
          p.le2 = e;
          p.home = e > 0.995;
        }
        p.f += ((p.ssOn ? 1 : 0) - p.f) * 0.11;   // ribbons widen/narrow as structure forms/melts
      }
      if (this.protein && !p.home) {
        var spx = this.spx;
        if (p.ssOn) {
          // A formed helix/strand is a rigid piece: its native shape, sliding and
          // turning from its spot on the thread into its place in the fold
          var g = this.segs[p.seg], lx = p.hx - g.cx, ly = p.hy - g.cy, e = g.e;
          var co = Math.cos(g.phi), si = Math.sin(g.phi);
          var ux = Math.sin(t * 0.0012 + g.sMid / (22 * spx)) * 1.2 * spx * (1 - e);
          var uy = Math.cos(t * 0.0015 + g.sMid / (17 * spx)) * 1.8 * spx * (1 - e);
          tx = g.tx + (g.cx - g.tx) * e + lx * co - ly * si + ux;
          ty = g.ty + (g.cy - g.ty) * e + lx * si + ly * co + uy;
        } else {
          // Loose chain: slow undulation along its length, drawn toward the fold
          // as the neighbouring helices/strands dock
          var el = p.ss > 0 ? 0 : (p.le2 || 0);
          tx = p.ix + Math.sin(t * 0.0012 + p.s / (22 * spx)) * 1.2 * spx;
          ty = p.iy + Math.cos(t * 0.0015 + p.s / (17 * spx)) * 1.8 * spx;
          tx += (p.hx - tx) * el; ty += (p.hy - ty) * el;
        }
      } else if (this.protein && p.ss > 0) {
        tx = p.hx; ty = p.hy;
      } else if (this.flow) {
        // Out along its own direction and back home; a new direction every trip
        var ph = t * p.speed + p.phase;
        var cycle = Math.floor(ph / (Math.PI * 2));
        if (cycle !== p.cycle) { p.cycle = cycle; p.angle = Math.random() * Math.PI * 2; }
        var out = (1 - Math.cos(ph)) * 0.5 * p.reach;
        tx = p.hx + Math.cos(p.angle) * out;
        ty = p.hy + Math.sin(p.angle) * out;
      } else {
        tx = p.hx + Math.sin(t * 0.0011 + p.phase) * 0.7;
        ty = p.hy + Math.cos(t * 0.0013 + p.phase) * 0.7;
      }
      if (this.protein) {
        // Folded part rides on its assembly's drift (weighted by how docked it is)
        var wF = p.home ? 1 : p.ss > 0 ? (p.ssOn ? this.segs[p.seg].e : 0) : (p.le2 || 0);
        if (wF > 0) {
          var fo = this.floats[p.grp], rx0 = p.hx - fo.cx, ry0 = p.hy - fo.cy;
          tx += (fo.cx + rx0 * fo.co - ry0 * fo.si + fo.dx - p.hx) * wF;
          ty += (fo.cy + rx0 * fo.si + ry0 * fo.co + fo.dy - p.hy) * wF;
        }
      }
      // Proteins: a soft pull toward the target; the chain constraints do the rest
      var kk = this.protein ? (p.home ? 0.045 : p.ssOn ? 0.09 : 0.02 + 0.07 * (p.le2 || 0)) : 0.045;
      p.vx += (tx - p.x) * kk;
      p.vy += (ty - p.y) * kk;

      // Heat marks particles the cursor or a pulse has touched; it fades on its
      // own, so other motion (scroll shiver, flow) never changes their color
      p.heat = (p.heat || 0) * 0.95;

      if (repel || attract) {
        var dx = p.x - mx, dy = p.y - my, d2 = dx * dx + dy * dy;
        if (d2 < R2) {
          var d = Math.sqrt(d2) || 1, f = 1 - d / R;
          if (attract) {
            // Pull toward the cursor, easing off up close so they swarm
            // around it instead of collapsing into a single point
            f = f * 2.4 * p.jitter * Math.min(1, d / 36);
            p.vx -= (dx / d) * f;
            p.vy -= (dy / d) * f;
            p.heat = Math.max(p.heat, Math.min(1, f / 1.2));
          } else {
            f = f * f * 7 * p.jitter;
            p.vx += (dx / d) * f;
            p.vy += (dy / d) * f;
            p.heat = Math.max(p.heat, Math.min(1, f / 2));
          }
        }
      }

      for (var k = 0; k < pulses.length; k++) {
        var pk = pulses[k], pa = t - pk.t0;
        var ex = p.x - pk.x, ey = p.y - pk.y;
        var ed = Math.sqrt(ex * ex + ey * ey) || 1;
        var off = Math.abs(ed - pa * PULSE_SPEED);
        if (off < PULSE_BAND) {
          var push = (1 - off / PULSE_BAND) * (1 - pa / PULSE_LIFE) * 2.8 * p.jitter;
          p.vx += (ex / ed) * push;
          p.vy += (ey / ed) * push;
          p.heat = Math.max(p.heat, Math.min(1, push / 1.2));
        }
      }

      p.vx *= 0.84; p.vy *= 0.84;
      p.x += p.vx; p.y += p.vy;

      if (this.protein) continue;
      if (p.heat > 0.06) hot.push(p.x, p.y, p.heat);
      else calm.rect(p.x, p.y, s, s);
    }

    if (this.protein) { this.constrainChains(); this.drawProtein(); return; }

    ctx.fillStyle = rgba(palette.fg, 1);
    ctx.fill(calm);
    var hotColor = this.mode === "pulse" ? palette.pulse : palette.accent;
    for (var n = 0; n < hot.length; n += 3) {
      ctx.fillStyle = rgba(hotColor, 0.35 + hot[n + 2] * 0.65);
      ctx.fillRect(hot[n], hot[n + 1], s, s);
    }
  };

  // Keep consecutive residues at bond length, so each chain moves as one
  // connected polymer: it drags, swings and collapses instead of tearing apart.
  // Native (folded or locally formed) bonds use their projected native length;
  // loose bonds use the full 3.8 A C-alpha spacing.
  ParticleText.prototype.constrainChains = function () {
    var ps = this.particles, ext = this.ext;
    for (var it = 0; it < 3; it++) {
      this.chains.forEach(function (ch) {
        for (var k = ch.start; k < ch.start + ch.n - 1; k++) {
          var a = ps[k], b = ps[k + 1];
          var na = a.home || (a.ssOn && a.seg >= 0 && a.seg === b.seg);
          var nb = b.home || (b.ssOn && b.seg >= 0 && b.seg === a.seg);
          var rest = na && nb ? a.rest : na || nb ? (a.rest + ext) / 2 : ext;
          var dx = b.x - a.x, dy = b.y - a.y, dist = Math.sqrt(dx * dx + dy * dy) || 1;
          var corr = (dist - rest) / dist * 0.3;
          var cx = dx * corr, cy = dy * corr;
          a.x += cx; a.y += cy; b.x -= cx; b.y -= cy;
          a.vx += cx * 0.3; a.vy += cy * 0.3; b.vx -= cx * 0.3; b.vy -= cy * 0.3;
        }
      });
    }
  };

  // Cartoon rendering in the style of NGL/PyMOL: a smooth spline through the
  // C-alpha trace; helices and strands are flat ribbons whose width runs along
  // each residue's real ribbon direction (so helix turns go edge-on at the sides),
  // strands end in arrowheads, loops are thin tubes. Shading uses the ribbon
  // normal against a light near the viewer; color runs blue -> red, N -> C.
  var HUE_BINS = 20, SHADES = 5, DEPTHS = 6;
  // Which assembly is under the cursor (nearest residue within a few angstroms)
  ParticleText.prototype.findHover = function (mx, my) {
    if (!pointer.active || pointer.type !== "mouse" || mx < 0 || my < 0 || mx > this.w || my > this.h) return -1;
    var ps = this.particles, best = -1, bd = Math.pow(4.5 * this.spx, 2);
    for (var i = 0; i < ps.length; i++) {
      var dx = ps[i].x - mx, dy = ps[i].y - my, d = dx * dx + dy * dy;
      if (d < bd) { bd = d; best = ps[i].grp; }
    }
    return best;
  };

  ParticleText.prototype.drawProtein = function () {
    var ctx = this.ctx, ps = this.particles, spx = this.spx;
    var night = (palette.fg[0] + palette.fg[1] + palette.fg[2]) / 3 > 128;
    var TUBE = 0.36 * spx, HELIX = 0.95 * spx, RIB = 1.3 * spx, HEAD = 2.2 * spx, THICK = 0.3 * spx;
    var zMin = this.zMin, zSpan = (this.zMax - this.zMin) || 1;
    var buckets = {};
    var L = [-0.3, -0.45, -0.84];   // light from the viewer's upper left

    var hov = this.hoverGroup == null ? -1 : this.hoverGroup;
    this.hoverDim += ((hov >= 0 ? 1 : 0) - (this.hoverDim || 0)) * 0.15;
    if (hov >= 0) this.lastHover = hov;
    var focus = this.lastHover == null ? -1 : this.lastHover, fl = this.floats;
    function bucket(depth, hue, shade, dim) {
      var key = depth + "|" + hue + "|" + shade + "|" + (dim ? 1 : 0);
      return buckets[key] || (buckets[key] = new Path2D());
    }
    function cr(a, b, c, e, u) {   // Catmull-Rom
      var u2 = u * u, u3 = u2 * u;
      return 0.5 * (2 * b + (-a + c) * u + (2 * a - 5 * b + 4 * c - e) * u2 + (-a + 3 * b - 3 * c + e) * u3);
    }

    var sub = Math.max(3, Math.ceil(3.8 * spx / 2));
    this.chains.forEach(function (ch) {
      var S = [];
      for (var k = 0; k < ch.n - 1; k++) {
        var p0 = ps[ch.start + Math.max(k - 1, 0)], p1 = ps[ch.start + k];
        var p2 = ps[ch.start + k + 1], p3 = ps[ch.start + Math.min(k + 2, ch.n - 1)];
        for (var j = 0; j < sub; j++) {
          var u = j / sub, r = u < 0.5 ? p1 : p2;
          S.push({ x: cr(p0.x, p1.x, p2.x, p3.x, u), y: cr(p0.y, p1.y, p2.y, p3.y, u), r: r, kk: k + u,
            wx: p1.wx + (p2.wx - p1.wx) * u, wy: p1.wy + (p2.wy - p1.wy) * u,
            nz: p1.nz + (p2.nz - p1.nz) * u, z: p1.z + (p2.z - p1.z) * u,
            f: p1.f + (p2.f - p1.f) * u, frac: p1.cf + (p2.cf - p1.cf) * u });
        }
      }
      var last = ps[ch.start + ch.n - 1];
      S.push({ x: last.x, y: last.y, r: last, kk: ch.n - 1, wx: last.wx, wy: last.wy, nz: last.nz, z: last.z, f: last.f, frac: last.cf });

      for (var m = 0; m < S.length; m++) {
        var sm = S[m], a = S[Math.max(m - 1, 0)], b = S[Math.min(m + 1, S.length - 1)];
        var tx = b.x - a.x, ty = b.y - a.y, tl = Math.hypot(tx, ty) || 1;
        var px = -ty / tl, py = tx / tl, res = sm.r;
        var f = res.ss > 0 ? sm.f : 0;
        // Ribbon direction: native for a folded residue, turned with the piece while it forms
        var wx = sm.wx, wy = sm.wy;
        if (res.ss > 0 && res.ssOn) {
          var g = this.segs[res.seg], ang = g.phi + fl[res.grp].a * g.e;
          var gc = Math.cos(ang), gs = Math.sin(ang);
          var rx = wx * gc - wy * gs; wy = wx * gs + wy * gc; wx = rx;
        }
        var hw = res.ss === 1 ? HELIX : RIB;
        if (res.ss === 2) {
          var left = res.sEnd - sm.kk;     // residues left before the strand ends
          hw = left > 1.3 ? RIB : HEAD * Math.max(0, left / 1.3);
        }
        var wl = Math.min(1, Math.hypot(wx, wy));
        var ox = wx * hw * f + px * (TUBE * (1 - f) + THICK * f * (1 - wl));
        var oy = wy * hw * f + py * (TUBE * (1 - f) + THICK * f * (1 - wl));
        sm.lx = sm.x + ox; sm.ly = sm.y + oy; sm.rx = sm.x - ox; sm.ry = sm.y - oy;
        // Shade: ribbons by their normal against the light, tubes flat
        var lit = 0.55;
        if (f > 0.3) {
          var nzv = sm.nz, nxy = Math.sqrt(Math.max(0, 1 - nzv * nzv));
          lit = Math.abs(-nxy * 0.35 + nzv * L[2]) * 0.85 + 0.15;
        }
        var zn = (sm.z - zMin) / zSpan;
        lit = lit * (1 - 0.35 * zn * f);
        sm.shade = Math.max(0, Math.min(SHADES - 1, Math.round(lit * (SHADES - 1))));
        sm.depth = Math.max(0, Math.min(DEPTHS - 1, Math.floor((1 - zn) * DEPTHS * f + (DEPTHS / 2) * (1 - f))));
      }
      for (m = 0; m < S.length - 1; m++) {
        var s0 = S[m], s1 = S[m + 1];
        var hue = Math.min(HUE_BINS - 1, Math.floor(s0.frac * HUE_BINS));
        var path = bucket(s0.depth, hue, s0.shade, focus >= 0 && s0.r.grp !== focus);
        // One consistent winding so overlapping quads never cancel
        if ((s1.lx - s0.lx) * (s1.ry - s0.ly) - (s1.ly - s0.ly) * (s1.rx - s0.lx) < 0) {
          path.moveTo(s0.lx, s0.ly); path.lineTo(s0.rx, s0.ry); path.lineTo(s1.rx, s1.ry); path.lineTo(s1.lx, s1.ly);
        } else {
          path.moveTo(s0.lx, s0.ly); path.lineTo(s1.lx, s1.ly); path.lineTo(s1.rx, s1.ry); path.lineTo(s0.rx, s0.ry);
        }
        path.closePath();
      }
    }, this);

    var lights = night ? [30, 42, 54, 64, 74] : [28, 37, 46, 54, 62];
    var sat = night ? 70 : 66;
    // Hovering a protein fades the others back
    var dimAlpha = 1 - 0.75 * (this.hoverDim || 0);
    var keys = Object.keys(buckets).sort(function (a, b) { return (+a.split("|")[0]) - (+b.split("|")[0]); });
    keys.forEach(function (key) {
      var parts = key.split("|"), hue = 240 - (+parts[1] / (HUE_BINS - 1)) * 240;
      ctx.globalAlpha = parts[3] === "1" ? dimAlpha : 1;
      ctx.fillStyle = "hsl(" + hue.toFixed(0) + "," + sat + "%," + lights[+parts[2]] + "%)";
      ctx.fill(buckets[key]);
    });
    ctx.globalAlpha = 1;
    if (this.onHover) this.onHover(hov >= 0 ? fl[hov] : null);
  };

  var fields = [];

  // A canvas with data-match="<selector>" uses that canvas's dot spacing and type size
  // (times data-match-scale, if set)
  function matchSizes() {
    fields.forEach(function (f) {
      var sel = f.canvas.dataset.match;
      if (!sel) return;
      var src = fields.filter(function (o) { return o.canvas.matches(sel); })[0];
      if (src) {
        f.matchSize = src.fontSize * (parseFloat(f.canvas.dataset.matchScale) || 1);
        f.matchStep = src.step;
        f.build();
      }
    });
  }

  function setupParticles() {
    readPalette(true);
    document.querySelectorAll("canvas.particles").forEach(function (c) {
      var f = new ParticleText(c);
      fields.push(f);
      if ("IntersectionObserver" in window) {
        new IntersectionObserver(function (entries) {
          f.visible = entries[0].isIntersecting;
        }).observe(c);
      }
    });
    matchSizes();
    listStructures();
    if (reduceMotion) { fields.forEach(function (f) { f.frame(0); }); return; }

    // Clicks and taps on a pulse field send out a pulse immediately
    // Clicks: pulse fields send out a pulse; protein fields fold/unfold
    window.addEventListener("pointerdown", function (e) {
      fields.forEach(function (f) {
        if (!f.visible) return;
        if (f.protein) {
          var r = f.canvas.getBoundingClientRect();
          if (e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom) f.queuedToggle = true;
        } else f.pulseAt(e.clientX, e.clientY);
      });
    }, { passive: true });

    var lastY = window.scrollY;
    window.addEventListener("scroll", function () {
      var dy = window.scrollY - lastY; lastY = window.scrollY;
      fields.forEach(function (f) { if (f.visible) f.kick(Math.max(-40, Math.min(40, dy))); });
    }, { passive: true });

    (function loop(t) {
      stepPalette();
      fields.forEach(function (f) { if (f.visible) f.frame(t); });
      requestAnimationFrame(loop);
    })(performance.now());
  }

  function recolor() {
    // With motion, the animation loop eases toward the new colors; without it,
    // snap and redraw the static frame once
    readPalette(reduceMotion);
    if (reduceMotion) fields.forEach(function (f) { f.frame(0); });
  }

  /* ------------------------------------------------------------------------
     Caption listing the real structures the protein name is folded from
  ------------------------------------------------------------------------ */
  function listStructures() {
    var cap = document.querySelector(".hero-structures");
    var hero = document.querySelector(".hero canvas.particles");
    var glyph = hero && window.PROTEIN_GLYPHS && window.PROTEIN_GLYPHS[hero.dataset.text];
    if (!cap || !glyph || hero.dataset.style !== "protein") return;
    var seen = {}, items = [];
    glyph.chains.forEach(function (c) {
      if (seen[c.pdb]) return;
      seen[c.pdb] = true;
      items.push('<span class="item" data-pdb="' + c.pdb + '"><span class="name">' + c.name.replace(/\s*\(.*\)$/, "") + ' </span>' +
        '<a href="https://www.rcsb.org/structure/' + c.pdb + '" target="_blank" rel="noopener">' + c.pdb + '</a></span>');
    });
    cap.innerHTML = '<span class="lead">Folded from</span>' + items.join(' <span class="sep">·</span> ') +
      '<span class="hint">Click the name to unfold and refold it</span>';
    cap.hidden = false;

    // Hover: label by the cursor + highlight the matching caption entry
    var tip = document.createElement("div");
    tip.className = "protein-tip";
    tip.setAttribute("aria-hidden", "true");
    document.body.appendChild(tip);
    var current = null;
    var field = fields.filter(function (f) { return f.canvas === hero; })[0];
    if (!field) return;
    field.onHover = function (info) {
      var key = info ? info.name : null;
      if (info) tip.style.transform = "translate(" + (pointer.x + 16) + "px," + (pointer.y + 18) + "px)";
      if (key === current) return;
      current = key;
      cap.querySelectorAll(".item").forEach(function (el) {
        el.classList.toggle("active", !!info && el.dataset.pdb === info.pdb);
      });
      if (info) tip.innerHTML = '<span class="tip-name">' + info.name + '</span><span class="tip-id">PDB ' + info.pdb + '</span>';
      tip.classList.toggle("show", !!info);
      hero.style.cursor = info ? "pointer" : "";
    };
  }

  /* ------------------------------------------------------------------------
     Day / night toggle (initial theme is set inline in <head>)
  ------------------------------------------------------------------------ */
  var toggle = document.querySelector(".theme-toggle");
  var label = toggle && toggle.querySelector(".theme-label");
  function syncLabel() {
    if (label) label.textContent = root.getAttribute("data-theme") === "light" ? "Day" : "Night";
  }
  syncLabel();
  if (toggle) {
    toggle.addEventListener("click", function () {
      var next = root.getAttribute("data-theme") === "light" ? "dark" : "light";
      root.setAttribute("data-theme", next);
      try { localStorage.setItem("theme", next); } catch (e) {}
      syncLabel();
      recolor();
    });
  }

  var resizeTimer;
  window.addEventListener("resize", function () {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function () {
      fields.forEach(function (f) { f.intro = false; f.matchSize = 0; f.matchStep = 0; f.build(); });
      matchSizes();
      if (reduceMotion) fields.forEach(function (f) { f.frame(0); });
    }, 150);
  });

  // Wait for the serif to load so the particles sample the right letterforms
  var fontReady = document.fonts && document.fonts.load
    ? Promise.race([
        document.fonts.load("italic 400 100px 'Instrument Serif'"),
        new Promise(function (r) { setTimeout(r, 2500); })
      ])
    : Promise.resolve();
  fontReady.then(function () {
    setupParticles();
    requestAnimationFrame(function () { root.classList.add("ready"); });
  });

  /* ------------------------------------------------------------------------
     Work list: an image preview trails the cursor with a little lag and tilt
  ------------------------------------------------------------------------ */
  var preview = document.querySelector(".preview");
  var rows = document.querySelectorAll("[data-preview]");
  if (preview && rows.length && window.matchMedia("(hover: hover)").matches) {
    var img = preview.querySelector("img");
    var pos = { x: 0, y: 0 }, running = false, shown = false;
    rows.forEach(function (row) {
      row.addEventListener("mouseenter", function () {
        img.src = row.dataset.preview;
        if (!shown) { pos.x = pointer.x; pos.y = pointer.y; }
        shown = true;
        preview.classList.add("show");
        if (!running) { running = true; requestAnimationFrame(follow); }
      });
      row.addEventListener("mouseleave", function () {
        shown = false;
        preview.classList.remove("show");
      });
    });
    var follow = function () {
      var px = pos.x;
      pos.x += (pointer.x - pos.x) * 0.14;
      pos.y += (pointer.y - pos.y) * 0.14;
      var tilt = Math.max(-12, Math.min(12, (pos.x - px) * 0.5));
      var pw = preview.offsetWidth, ph = preview.offsetHeight;
      preview.style.transform =
        "translate(" + (pos.x + 28) + "px," + (pos.y - ph / 2) + "px) rotate(" + tilt + "deg)";
      if (pos.x + 28 + pw > window.innerWidth) {
        preview.style.transform =
          "translate(" + (pos.x - pw - 28) + "px," + (pos.y - ph / 2) + "px) rotate(" + tilt + "deg)";
      }
      if (shown || Math.abs(pointer.x - pos.x) > 0.5) requestAnimationFrame(follow);
      else running = false;
    };
  }

  /* ------------------------------------------------------------------------
     Scroll reveals, staggered within each group
  ------------------------------------------------------------------------ */
  var reveals = document.querySelectorAll("[data-reveal]");
  if ("IntersectionObserver" in window && !reduceMotion) {
    var io = new IntersectionObserver(function (entries) {
      var i = 0;
      entries.forEach(function (e) {
        if (!e.isIntersecting) return;
        e.target.style.setProperty("--delay", (i++ * 0.08) + "s");
        e.target.classList.add("in");
        io.unobserve(e.target);
      });
    }, { rootMargin: "0px 0px -8% 0px" });
    reveals.forEach(function (el) { io.observe(el); });
  } else {
    reveals.forEach(function (el) { el.classList.add("in"); });
  }

  /* ------------------------------------------------------------------------
     Live local time
  ------------------------------------------------------------------------ */
  document.querySelectorAll(".clock").forEach(function (el) {
    var fmt;
    try {
      fmt = new Intl.DateTimeFormat("en-US", {
        timeZone: el.dataset.tz, hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false, timeZoneName: "short"
      });
    } catch (e) { el.parentNode.hidden = true; return; }
    var tick = function () { el.textContent = fmt.format(new Date()); };
    tick();
    setInterval(tick, 1000);
  });
})();
