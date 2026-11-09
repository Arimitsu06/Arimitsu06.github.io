(function () {
  var root = document.documentElement;
  var reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // Pointer position in viewport coordinates, shared by every effect
  var pointer = { x: -1e4, y: -1e4, active: false };
  window.addEventListener("pointermove", function (e) {
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

    // Pick a grid step that gives roughly a fixed particle budget
    var data = o.getImageData(0, 0, w, h).data;
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
      if (this.flow) {
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
      p.vx += (tx - p.x) * 0.045;
      p.vy += (ty - p.y) * 0.045;

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

      if (p.heat > 0.06) hot.push(p.x, p.y, p.heat);
      else calm.rect(p.x, p.y, s, s);
    }

    ctx.fillStyle = rgba(palette.fg, 1);
    ctx.fill(calm);
    var hotColor = this.mode === "pulse" ? palette.pulse : palette.accent;
    for (var n = 0; n < hot.length; n += 3) {
      ctx.fillStyle = rgba(hotColor, 0.35 + hot[n + 2] * 0.65);
      ctx.fillRect(hot[n], hot[n + 1], s, s);
    }
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
    if (reduceMotion) { fields.forEach(function (f) { f.frame(0); }); return; }

    // Clicks and taps on a pulse field send out a pulse immediately
    window.addEventListener("pointerdown", function (e) {
      fields.forEach(function (f) { if (f.visible) f.pulseAt(e.clientX, e.clientY); });
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
