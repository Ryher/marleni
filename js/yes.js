/*
 * Erfolgsseite: ASCII-Sternenhimmel mit Schnee, dahinter ein Alpenpanorama aus drei
 * Bergketten mit Schneegipfeln, davor eine Wiese aus vielen kleinen, verschiedenen
 * 3D-ASCII-Blumen (gleiche Schattierung wie die große Ochsenzunge, aber ohne Drehung)
 * und ein paar Salven Konfetti in Lila, Violett und Weiß.
 *
 * Die Blumen erscheinen nacheinander und bleiben dann stehen. Jede Blume wird einmal in
 * einen statischen Z-Buffer gezeichnet; Sterne und Schnee laufen in den freien Zellen weiter.
 */
(function () {
  'use strict';

  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const pre = document.getElementById('art');

  const RAMP = '.,-~:;=!*#$@';
  const TILT = -0.45;               // leicht von oben
  const APPEAR_MS = 70;             // Abstand, in dem die Blumen nacheinander auftauchen
  const LIGHT = norm([-0.5, 0.8, -0.7]);
  const UP = [0, 1, 0];

  const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
  const mul = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  function norm(a) {
    const l = Math.hypot(a[0], a[1], a[2]) || 1;
    return [a[0] / l, a[1] / l, a[2] / l];
  }
  function frameFor(n) {
    const a = Math.abs(n[1]) < 0.9 ? UP : [1, 0, 0];
    const e1 = norm(cross(n, a));
    return [e1, cross(n, e1)];
  }

  let cols = 0, rows = 0, aspect = 0.6;
  let stars = [], snow = [];
  let depth, lum, mat;               // statischer Blumen-Puffer
  let bgCh, bgCls;                   // statischer Hintergrund: Berge und Wiese
  let flowers = [], shown = 0;

  const escape = (ch) => (ch === '<' ? '&lt;' : ch);

  // ---------- Blumen-Puffer ----------

  // Zeichnet einen Punkt einer Blume. f: Blume mit Position (bx, by), Größe s, Drehung yaw
  function plot(f, p, n, m) {
    const ca = Math.cos(f.yaw), sa = Math.sin(f.yaw);
    const ct = Math.cos(TILT), st = Math.sin(TILT);
    const x1 = p[0] * ca + p[2] * sa;
    const z1 = -p[0] * sa + p[2] * ca;
    const y2 = p[1] * ct - z1 * st;
    const z2 = p[1] * st + z1 * ct;
    const x = Math.floor(f.bx + (f.s * x1) / aspect);
    const y = Math.floor(f.by - f.s * y2);
    if (x < 0 || x >= cols || y < 0 || y >= rows) return;
    const i = y * cols + x;
    const d = f.by * 100 - z2 * f.s;        // weiter unten = näher; innerhalb der Blume: z
    if (d <= depth[i]) return;

    const nx = n[0] * ca + n[2] * sa;
    const nz1 = -n[0] * sa + n[2] * ca;
    const ny = n[1] * ct - nz1 * st;
    const nz = n[1] * st + nz1 * ct;
    const l = Math.abs(nx * LIGHT[0] + ny * LIGHT[1] + nz * LIGHT[2]);
    depth[i] = d;
    mat[i] = m;
    lum[i] = 0.15 + 0.85 * l;
  }

  // Punktabstand in lokalen Einheiten, damit keine Lücken entstehen
  const stepFor = (f) => (0.45 * aspect) / f.s;

  function stem(f, top, step) {
    const n = Math.ceil(1 / step);
    for (let i = 0; i <= n; i++) {
      const u = i / n;
      const p = [top[0] * u * u, top[1] * u, top[2] * u * u];
      plot(f, p, norm([0.4, 0.2, -1]), 'stem');
    }
  }

  function leaf(f, theta, len, step) {
    const d = [Math.cos(theta), 0, Math.sin(theta)];
    const side = norm(cross(d, UP));
    const nrm = norm(cross(side, d));
    const nu = Math.ceil(len / step);
    for (let i = 0; i <= nu; i++) {
      const u = i / nu;
      const spine = add(mul(d, u * len * 0.8), mul(UP, (0.5 * u - 0.3 * u * u) * len));
      const w = 0.06 * Math.sin(Math.PI * u);
      for (let v = -w; v <= w; v += step) plot(f, add(spine, mul(side, v)), nrm, 'leaf');
    }
  }

  function sphere(f, c, r, m, step) {
    const k = Math.max(4, Math.ceil(r / step) * 2);
    for (let i = 0; i <= k; i++) {
      const th = (i / k) * Math.PI;
      for (let j = 0; j < k * 2; j++) {
        const ph = (j / (k * 2)) * Math.PI * 2;
        const n = [Math.sin(th) * Math.cos(ph), Math.cos(th), Math.sin(th) * Math.sin(ph)];
        plot(f, add(c, mul(n, r)), n, m);
      }
    }
  }

  // Kranz aus Blütenblättern. shape(u) → halbe Breite, beta = Winkel über der Blütenebene
  function petals(f, c, n, count, len, shape, beta, m, phase, step) {
    const [e1, e2] = frameFor(n);
    for (let k = 0; k < count; k++) {
      const psi = phase + (k / count) * Math.PI * 2;
      const r = add(mul(e1, Math.cos(psi)), mul(e2, Math.sin(psi)));
      const t = add(mul(e1, -Math.sin(psi)), mul(e2, Math.cos(psi)));
      const pd = add(mul(r, Math.cos(beta)), mul(n, Math.sin(beta)));
      const nrm = norm(cross(pd, t));
      for (let u = 0; u <= 1; u += step / len) {
        const w = shape(u);
        const along = add(c, mul(pd, u * len));
        for (let v = -w; v <= w; v += step) plot(f, add(along, mul(t, v)), nrm, m);
      }
    }
  }

  const KINDS = {
    // Ochsenzunge: fünf runde, violette Blütenblätter, weiße Mitte
    anchusa(f, c, n, step) {
      petals(f, c, n, 5, 0.15, (u) => 0.07 * Math.sqrt(Math.max(0, Math.sin(Math.PI * Math.pow(u, 0.75)))),
        0.2, 'petal', f.phase, step);
      sphere(f, add(c, mul(n, 0.015)), 0.03, 'center', step);
    },
    // Margerite: viele schmale weiße Blütenblätter, gelbe Mitte
    daisy(f, c, n, step) {
      petals(f, c, n, 16, 0.17, (u) => 0.018 * Math.sin(Math.PI * Math.min(1, u * 1.1 + 0.05)),
        0.1, 'pw', f.phase, step);
      sphere(f, add(c, mul(n, 0.02)), 0.05, 'yel', step);
    },
    // Tulpe: sechs aufrechte Blütenblätter als Kelch
    tulip(f, c, n, step) {
      petals(f, add(c, mul(n, -0.04)), n, 6, 0.22, (u) => 0.075 * Math.sin(Math.PI * (0.15 + 0.8 * u)),
        1.2, f.tone, f.phase, step);
    },
    // Sternblume: sechs spitze Blütenblätter
    star(f, c, n, step) {
      petals(f, c, n, 6, 0.16, (u) => 0.05 * (1 - u) * Math.min(1, u * 4),
        0.25, f.tone, f.phase, step);
      sphere(f, add(c, mul(n, 0.012)), 0.022, 'yel', step);
    },
    // Glockenblume: hängende Glocke
    bell(f, c, n, step) {
      const axis = norm([n[0] * 0.6, -1, n[2] * 0.6]);
      const [e1, e2] = frameFor(axis);
      for (let u = 0; u <= 1; u += step / 0.2) {
        const r = 0.025 + 0.085 * Math.pow(u, 1.6);
        const ring = Math.max(8, Math.ceil((2 * Math.PI * r) / step));
        for (let k = 0; k < ring; k++) {
          const a = (k / ring) * Math.PI * 2;
          const radial = add(mul(e1, Math.cos(a)), mul(e2, Math.sin(a)));
          plot(f, add(add(c, mul(axis, u * 0.2)), mul(radial, r)), norm(add(radial, mul(axis, -0.4))), 'pb');
        }
      }
    },
  };

  function drawFlower(f) {
    const step = stepFor(f);
    const top = [f.bend, f.h, f.bend * 0.5];
    stem(f, top, step / f.h);
    leaf(f, f.yaw + 0.8, 0.28, step);
    if (f.h > 0.55) leaf(f, f.yaw + 3.6, 0.24, step);
    const n = norm([f.bend * 2, 1, -0.5]);
    KINDS[f.kind](f, top, n, step);
  }

  // ---------- Alpen ----------

  // deterministischer Pseudo-Zufall, damit die Berge bei jedem Laden gleich aussehen
  const hash = (a, b) => {
    const h = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
    return h - Math.floor(h);
  };

  // Gratlinie mit spitzen Gipfeln ("ridged noise"), Werte etwa 0..1
  function ridge(u, seed) {
    let v = 0, a = 0.6, f = 1, sum = 0;
    for (let o = 0; o < 4; o++) {
      v += a * Math.pow(1 - Math.abs(Math.sin(u * f + seed * (o + 1) * 1.7)), 1.6);
      sum += a;
      a *= 0.4;
      f *= 2.3;
    }
    return v / sum;
  }

  const LAYERS = [
    // hinten: hohe, blasse Gipfel mit viel Schnee
    { base: 0.56, amp: 0.36, scale: 0.03, seed: 1.3, cls: 'm0', snow: 0.1 },
    // Mitte: etwas dunkler, weniger Schnee
    { base: 0.6, amp: 0.22, scale: 0.045, seed: 4.1, cls: 'm1', snow: 0.06 },
    // vorne: grüne Vorberge, kein Schnee
    { base: 0.65, amp: 0.05, scale: 0.08, seed: 7.7, cls: 'm2', snow: 0 },
  ];

  function buildAlps() {
    bgCh = new Array(cols * rows).fill(null);
    bgCls = new Array(cols * rows).fill(null);
    const set = (x, y, ch, cls) => {
      const i = y * cols + x;
      bgCh[i] = ch;
      bgCls[i] = cls;
    };

    LAYERS.forEach((L) => {
      // Gratlinie in Zeilen; x wird in Zeilen-Einheiten gerechnet, damit die Form unabhängig von der Schrift ist
      const h = (x) => rows * (L.base - L.amp * ridge(x * aspect * L.scale, L.seed));
      for (let x = 0; x < cols; x++) {
        const top = h(x);
        const slope = h(x + 1) - h(x - 1);          // < 0: steigt nach rechts an → Hang zeigt zum Licht (links)
        const lit = slope < 0;
        const peak = h(x) <= h(x - 1) && h(x) <= h(x + 1);
        const height = (L.base * rows - top) / (L.amp * rows);   // 0 = Tal, 1 = höchster Gipfel
        // Schnee nur oberhalb der Schneegrenze, dicker je höher der Gipfel
        const capDepth = L.snow * rows * Math.max(0, height - 0.4) * 2.5;

        for (let y = Math.max(0, Math.floor(top)); y < rows; y++) {
          const d = y - top;
          const r = hash(x, y + L.seed * 100);
          if (d < 1) {
            set(x, y, peak ? '^' : slope < -0.5 ? '/' : slope > 0.5 ? '\\' : '-', `${L.cls}-r`);
          } else if (d < capDepth) {
            // Schneekuppe: Lichtseite hell und dicht, Schattenseite bläulich
            set(x, y, lit ? (r < 0.5 ? '#' : '%') : (r < 0.5 ? ':' : '.'), lit ? 'cap-1' : 'cap-0');
          } else if (L.cls === 'm2') {
            set(x, y, r < 0.35 ? '"' : r < 0.6 ? ',' : r < 0.75 ? "'" : ' ', r < 0.5 ? 'g1' : 'g0');
          } else {
            // Fels: Lichtseite mit etwas Struktur, Schattenseite fast leer
            const ch = lit ? (r < 0.3 ? ':' : r < 0.6 ? '.' : ' ') : (r < 0.15 ? '.' : ' ');
            set(x, y, ch, lit ? `${L.cls}-l` : `${L.cls}-s`);
          }
        }
      }
    });
  }

  // ---------- Fliegende Katzen ----------

  // Katze von der Seite (Kopf rechts, Schwanz links), Flügel oben bzw. unten;
  // je 22 Zeichen breit, Leerzeichen sind durchsichtig
  const CAT_FRAMES = [
    [
      '        __/\\__        ',
      '       /  /\\  \\ /\\_/\\ ',
      ' ~,.__/___\\/___(  o  >',
      '  (_ ___________ ,--\' ',
      '     \\_\\     \\_\\      ',
    ],
    [
      '                      ',
      '                /\\_/\\ ',
      ' ~,.___________(  o  >',
      '  (_ ___\\  /____ ,--\' ',
      '     \\_\\ \\/  \\_\\      ',
    ],
  ];
  const CAT_W = 22;
  const MIRROR = { '/': '\\', '\\': '/', '(': ')', ')': '(', '<': '>', '>': '<' };
  const mirror = (s) => [...s].reverse().map((c) => MIRROR[c] || c).join('');
  let cats = [];

  // Die Katzen sind eigene <pre>-Elemente mit größerer Schrift als das feine Wiesen-Raster,
  // damit man sie gut erkennt. Bewegt werden sie per transform (in Pixeln).
  function makeCats(fontSize, charW) {
    cats.forEach((c) => c.el.remove());
    const catFont = Math.max(9, fontSize * 1.9);
    const w = window.innerWidth, h = window.innerHeight;
    const catW = CAT_W * catFont * charW;
    cats = Array.from({ length: w > 900 ? 5 : 3 }, (_, i) => {
      const el = document.createElement('pre');
      el.className = `cat cat${i % 4}`;
      el.setAttribute('aria-hidden', 'true');
      el.style.fontSize = `${catFont}px`;
      document.body.insertBefore(el, document.getElementById('heart'));
      return {
        el,
        catW,
        y: h * (0.12 + 0.08 * i + 0.04 * Math.random()),
        speed: catW * (0.35 + Math.random() * 0.35),   // Pixel pro Sekunde
        offset: Math.random() * (w + 2 * catW),
        dir: i % 2 ? -1 : 1,
        bob: catFont * (0.8 + Math.random()),
        phase: Math.random() * Math.PI * 2,
        flap: 170 + Math.random() * 120,               // ms pro Flügelschlag
        frame: -1,
      };
    });
  }

  function drawCats(t) {
    const sec = t / 1000;
    const w = window.innerWidth;
    cats.forEach((c) => {
      let x = ((sec * c.speed + c.offset) % (w + 2 * c.catW)) - c.catW;
      if (c.dir < 0) x = w - c.catW - x;
      const y = c.y + Math.sin(sec * 1.6 + c.phase) * c.bob;
      const f = Math.floor(t / c.flap) % 2;
      if (f !== c.frame) {
        c.frame = f;
        c.el.textContent = CAT_FRAMES[f].map((line) => (c.dir < 0 ? mirror(line) : line)).join('\n');
      }
      c.el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
    });
  }

  // ---------- Layout ----------

  function layout() {
    const probe = document.createElement('span');
    probe.textContent = 'M'.repeat(20);
    probe.style.cssText = 'position:absolute;visibility:hidden;white-space:pre;font-size:100px';
    pre.textContent = '';
    pre.appendChild(probe);
    const charW = probe.getBoundingClientRect().width / 20 / 100;
    pre.removeChild(probe);

    const w = window.innerWidth, h = window.innerHeight;
    const size = Math.max(4, Math.min(10, w / (110 * charW), h / 120));
    pre.style.fontSize = `${size}px`;
    cols = Math.floor(w / (size * charW));
    rows = Math.floor(h / size);
    aspect = charW;

    stars = Array.from({ length: Math.floor(cols * rows * 0.008) }, () => {
      const heart = Math.random() < 0.06;
      return {
        x: Math.floor(Math.random() * (cols - 1)),
        y: Math.floor(Math.random() * rows * 0.7),
        ch: heart ? '<3' : Math.random() < 0.75 ? '.' : Math.random() < 0.5 ? '*' : "'",
        cls: heart ? 's2' : `s${Math.floor(Math.random() * 4)}`,
        speed: 0.8 + Math.random() * 2.2,
        phase: Math.random() * Math.PI * 2,
      };
    });
    snow = Array.from({ length: Math.max(25, Math.floor(cols * rows * 0.006)) }, () => ({
      x: Math.random() * cols,
      y: Math.random() * rows,
      speed: 1.2 + Math.random() * 1.8,
      sway: 0.6 + Math.random() * 1.4,
      phase: Math.random() * Math.PI * 2,
      ch: Math.random() < 0.5 ? '*' : Math.random() < 0.5 ? 'o' : '.',
    }));

    buildAlps();
    makeCats(size, charW);

    // Wiese: Blumen im unteren Teil, weiter unten = näher = größer
    depth = new Float32Array(cols * rows).fill(-Infinity);
    lum = new Float32Array(cols * rows);
    mat = new Array(cols * rows).fill(null);
    const kinds = Object.keys(KINDS);
    const tones = ['petal', 'pp', 'pb', 'pw'];
    const top = rows * 0.6, bottom = rows + 4;
    const count = Math.max(30, Math.min(80, Math.round(cols / 1.8)));
    flowers = Array.from({ length: count }, (_, i) => {
      const k = Math.random();
      const by = top + k * (bottom - top);
      return {
        kind: i < count * 0.3 ? 'anchusa' : kinds[Math.floor(Math.random() * kinds.length)],
        tone: tones[Math.floor(Math.random() * tones.length)],
        bx: 2 + Math.random() * (cols - 4),
        by,
        s: Math.min(rows, cols * aspect * 1.6) * (0.11 + 0.12 * k),   // Zeilen pro lokaler Einheit
        h: 0.4 + Math.random() * 0.35,
        bend: (Math.random() - 0.5) * 0.25,
        yaw: Math.random() * Math.PI * 2,
        phase: Math.random() * Math.PI,
      };
    }).sort((a, b) => a.by - b.by);          // von hinten nach vorne auftauchen
    shown = 0;
  }

  // ---------- Ausgabe ----------

  function draw(t) {
    // neue Blumen in den statischen Puffer zeichnen
    const due = reduced ? flowers.length : Math.min(flowers.length, Math.floor(t / APPEAR_MS));
    while (shown < due) drawFlower(flowers[shown++]);

    const sec = t / 1000;
    const sky = new Map();
    snow.forEach((f) => {
      const y = Math.floor((f.y + sec * f.speed) % rows);
      const x = Math.floor(f.x + Math.sin(sec * 0.8 + f.phase) * f.sway);
      if (x >= 0 && x < cols) sky.set(y * cols + x, [f.ch, 'snow']);
    });
    drawCats(t);
    stars.forEach((s) => {
      const tw = Math.sin(sec * s.speed + s.phase);
      if (tw < -0.3) return;
      const ch = s.ch === '<3' ? s.ch : tw > 0.9 ? '+' : s.ch;
      const i = s.y * cols + s.x;
      // Sterne nur im Himmel, nicht vor den Bergen
      for (let k = 0; k < ch.length; k++) if (sky.has(i + k) || bgCls[i + k]) return;
      const cls = tw < 0.3 ? `${s.cls} d` : s.cls;
      for (let k = 0; k < ch.length; k++) sky.set(i + k, [ch[k], cls]);
    });

    const lines = [];
    for (let y = 0; y < rows; y++) {
      let html = '';
      let open = null;
      for (let x = 0; x < cols; x++) {
        const i = y * cols + x;
        let ch = ' ', cls = null;
        if (mat[i]) {
          const l = lum[i];
          ch = RAMP[Math.min(RAMP.length - 1, Math.floor(l * RAMP.length))];
          cls = `${mat[i]}-${l < 0.4 ? 0 : l < 0.7 ? 1 : 2}`;
        } else if (sky.has(i)) {
          [ch, cls] = sky.get(i);
        } else if (bgCh[i] && bgCh[i] !== ' ') {
          ch = bgCh[i];
          cls = bgCls[i];
        }
        if (cls !== open) {
          if (open) html += '</span>';
          if (cls) html += `<span class="${cls}">`;
          open = cls;
        }
        html += escape(ch);
      }
      if (open) html += '</span>';
      lines.push(html);
    }
    pre.innerHTML = lines.join('\n');
  }

  let start = performance.now();
  layout();
  window.addEventListener('resize', () => {
    layout();
    start = performance.now() - flowers.length * APPEAR_MS;   // nach Resize alle sofort zeigen
    draw(performance.now() - start);
  });
  draw(0);
  if (!reduced) {
    let last = -Infinity;
    const frame = (now) => {
      if (now - last >= 1000 / 20) {
        last = now;
        draw(now - start);
      }
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }

  // ---------- Konfetti ----------

  if (!window.confetti) return;   // CDN nicht erreichbar: dann eben ohne
  const colors = ['#c39bf5', '#8f5fd6', '#5b3a99', '#a57ad8', '#ffffff'];
  const burst = (opts) => window.confetti({ colors, disableForReducedMotion: false, ...opts });

  if (reduced) {
    // nur eine kleine, kurze Salve
    burst({ particleCount: 40, spread: 70, startVelocity: 25, ticks: 120, origin: { y: 0.6 } });
    return;
  }

  burst({ particleCount: 140, spread: 90, startVelocity: 45, origin: { y: 0.65 } });
  setTimeout(() => {
    burst({ particleCount: 70, angle: 60, spread: 60, origin: { x: 0, y: 0.75 } });
    burst({ particleCount: 70, angle: 120, spread: 60, origin: { x: 1, y: 0.75 } });
  }, 700);
  setTimeout(() => burst({ particleCount: 120, spread: 120, startVelocity: 35, origin: { y: 0.55 } }), 1500);
  setTimeout(() => {
    burst({ particleCount: 60, angle: 60, spread: 70, origin: { x: 0, y: 0.6 } });
    burst({ particleCount: 60, angle: 120, spread: 70, origin: { x: 1, y: 0.6 } });
  }, 2400);
})();
