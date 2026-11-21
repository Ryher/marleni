/*
 * Detailreiche Version (v2): feines Raster, behaarte Stängel, Blütenstände mit Nebenblüten
 * und eingerollten Knospen-Wickeln, weiße Schlundschuppen. Gesicherte Stände in versions/.
 *
 * Rotierende 3D-Ochsenzunge als ASCII-Art vor funkelndem Sternenhimmel.
 *
 * Die Pflanze besteht aus Flächen (Stängel als Röhren, Blätter, Blütenblätter, Kugeln),
 * die jeden Frame dicht mit Punkten abgetastet, gedreht, perspektivisch projiziert und
 * mit einem Z-Buffer in ein Zeichenraster geschrieben werden. Die Helligkeit (Licht auf
 * die Flächennormale) bestimmt das Zeichen, das Material die Farbe.
 * Das Raster füllt den ganzen Bildschirm; in leeren Zellen funkeln Sterne.
 *
 * Wachstum: Zeit 0..GROW_MS steuert, wie weit Stängel, Seitentriebe und Blätter gewachsen
 * und wie weit die Blüten offen sind. Die Drehung läuft danach endlos weiter.
 */
(function (root) {
  'use strict';

  const RAMP = '.,-~:;=!*#$@';
  const MATERIALS = ['stem', 'leaf', 'petal', 'center', 'bud'];
  const STEM = 0, LEAF = 1, PETAL = 2, CENTER = 3, BUD = 4;

  const GROW_MS = 7000;       // bis alles aufgeblüht ist
  const SPIN = 0.6;           // Drehung in rad pro Sekunde
  const TILT = -0.35;         // Kamera schaut leicht von oben
  const DIST = 4.2;
  const FPS = 30;
  const D = 0.004;            // Abtastabstand der Flächen in Welteinheiten
  const TARGET_COLS = 110;    // Zeichen pro Zeile auf dem Handy

  const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const mul = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  function norm(a) {
    const l = Math.hypot(a[0], a[1], a[2]) || 1;
    return [a[0] / l, a[1] / l, a[2] / l];
  }
  const clamp01 = (x) => Math.max(0, Math.min(1, x));
  const smooth = (x) => x * x * (3 - 2 * x);
  const lerp = (a, b, k) => a + (b - a) * k;

  const UP = [0, 1, 0];
  const LIGHT = norm([-0.5, 0.8, -0.7]);   // Richtung zum Licht, im Kameraraum

  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // ---------- Pflanze ----------

  const mainStem = {
    at: (s) => [0.06 * Math.sin(2.5 * s), -1.1 + 2.0 * s, 0.05 * Math.sin(1.7 * s + 1)],
    radius: (s) => 0.03 * (1 - 0.45 * s),
    length: 2.0,
  };

  function bezier(a, b, c, u) {
    const k = 1 - u;
    return add(add(mul(a, k * k), mul(b, 2 * u * k)), mul(c, u * u));
  }

  const BRANCHES = [
    { s0: 0.42, theta: 0.4, len: 0.66 },
    { s0: 0.50, theta: 2.8, len: 0.60 },
    { s0: 0.58, theta: 5.2, len: 0.55 },
    { s0: 0.66, theta: 1.6, len: 0.48 },
    { s0: 0.73, theta: 4.0, len: 0.42 },
    { s0: 0.80, theta: 0.0, len: 0.36 },
    { s0: 0.87, theta: 2.4, len: 0.30 },
  ].map((b) => {
    const base = mainStem.at(b.s0);
    const d = [Math.cos(b.theta), 0, Math.sin(b.theta)];
    const ctrl = add(base, add(mul(d, b.len * 0.6), mul(UP, b.len * 0.15)));
    const end = add(base, add(mul(d, b.len * 0.8), mul(UP, b.len * 0.8)));
    return Object.assign({}, b, {
      at: (u) => bezier(base, ctrl, end, u),
      radius: () => 0.018,
      length: b.len * 1.2,
    });
  });

  // Grundblätter (lang, flach abstehend) und Stängelblätter, die nach oben kleiner werden
  const LEAVES = [
    ...Array.from({ length: 4 }, (_, i) => ({
      s: 0.01, theta: i * 1.57 + 0.3, len: 0.75, width: 0.11, rise: 0.25,
    })),
    ...Array.from({ length: 10 }, (_, i) => ({
      s: 0.07 + i * 0.05,
      theta: i * 2.4 + 0.8,
      len: 0.6 - i * 0.04,
      width: 0.095 - i * 0.006,
      rise: 0.55,
    })),
  ];

  // deterministischer Pseudo-Zufall aus Ganzzahlen (für die Härchen)
  const hash = (a, b) => {
    const h = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
    return h - Math.floor(h);
  };

  function tangent(curve, s) {
    const e = 1e-3;
    return norm(sub(curve.at(Math.min(1, s + e)), curve.at(Math.max(0, s - e))));
  }

  // ---------- Zeichenfläche mit Z-Buffer ----------

  function makeCanvas() {
    const ct = Math.cos(TILT), st = Math.sin(TILT);
    let ca = 1, sa = 0;
    const cv = { cols: 0, rows: 0, aspect: 0.6, scale: 1, depth: null, lum: null, mat: null, stars: [], snow: [] };

    cv.resize = function (cols, rows, aspect) {
      const n = cols * rows;
      cv.cols = cols;
      cv.rows = rows;
      cv.aspect = aspect;
      // Zeilen pro Welteinheit bei Abstand DIST: Pflanze passt in Höhe und Breite.
      // Obergrenze, damit die Abtastdichte der Formen reicht.
      cv.scale = DIST * Math.min(rows * 0.27, cols * aspect * 0.54, 48);
      cv.depth = new Float32Array(n);
      cv.lum = new Float32Array(n);
      cv.mat = new Int8Array(n);
      cv.stars = makeStars(cols, rows);
      cv.snow = makeSnow(cols, rows);
    };

    cv.reset = function (angle) {
      cv.depth.fill(0);
      cv.mat.fill(-1);
      ca = Math.cos(angle);
      sa = Math.sin(angle);
    };

    cv.plot = function (p, nrm, m, twoSided) {
      const x1 = p[0] * ca + p[2] * sa;
      const z1 = -p[0] * sa + p[2] * ca;
      const y2 = p[1] * ct - z1 * st;
      const z2 = p[1] * st + z1 * ct;
      const ooz = 1 / (z2 + DIST);
      const xp = Math.floor(cv.cols / 2 + (cv.scale * x1 * ooz) / cv.aspect);
      const yp = Math.floor(cv.rows * 0.6 - cv.scale * y2 * ooz);
      if (xp < 0 || xp >= cv.cols || yp < 0 || yp >= cv.rows) return;
      const i = yp * cv.cols + xp;
      if (ooz <= cv.depth[i]) return;

      const nx = nrm[0] * ca + nrm[2] * sa;
      const nz1 = -nrm[0] * sa + nrm[2] * ca;
      const ny = nrm[1] * ct - nz1 * st;
      const nz = nrm[1] * st + nz1 * ct;
      let l = nx * LIGHT[0] + ny * LIGHT[1] + nz * LIGHT[2];
      if (twoSided) l = Math.abs(l);
      cv.depth[i] = ooz;
      cv.mat[i] = m;
      cv.lum[i] = 0.12 + 0.88 * Math.max(0, l);
    };

    return cv;
  }

  function makeStars(cols, rows) {
    const rand = mulberry32(5);
    const count = Math.floor(cols * rows * 0.012);
    return Array.from({ length: count }, () => {
      const heart = rand() < 0.04;
      return {
        x: Math.floor(rand() * (cols - 1)),
        y: Math.floor(rand() * rows),
        ch: heart ? '<3' : rand() < 0.75 ? '.' : rand() < 0.5 ? '*' : "'",
        cls: heart ? 's2' : `s${Math.floor(rand() * 4)}`,
        speed: 0.8 + rand() * 2.2,
        phase: rand() * Math.PI * 2,
      };
    });
  }

  // Flocken, die langsam fallen und leicht hin und her schaukeln
  function makeSnow(cols, rows) {
    const rand = mulberry32(9);
    const count = Math.max(25, Math.floor(cols * rows * 0.01));
    return Array.from({ length: count }, () => ({
      x: rand() * cols,
      y: rand() * rows,
      speed: 1.2 + rand() * 1.8,          // Zeilen pro Sekunde
      sway: 0.6 + rand() * 1.4,
      phase: rand() * Math.PI * 2,
      ch: rand() < 0.5 ? '*' : rand() < 0.5 ? 'o' : '.',
    }));
  }

  // ---------- Formen ----------

  function frameFor(t) {
    const a = Math.abs(t[1]) < 0.9 ? UP : [1, 0, 0];
    const n = norm(cross(t, a));
    return [n, cross(t, n)];
  }

  // Röhre entlang einer Kurve. hairy: kurze abstehende Borsten, wie bei der echten Ochsenzunge
  function drawTube(cv, curve, s1, hairy = true) {
    if (s1 <= 0.002) return;
    const steps = Math.ceil((s1 * curve.length) / D);
    const ring = 14;
    for (let i = 0; i <= steps; i++) {
      const s = (i / steps) * s1;
      const p = curve.at(s);
      const [n, b] = frameFor(tangent(curve, s));
      const r = curve.radius(s);
      for (let k = 0; k < ring; k++) {
        const phi = (k / ring) * Math.PI * 2;
        const nrm = add(mul(n, Math.cos(phi)), mul(b, Math.sin(phi)));
        cv.plot(add(p, mul(nrm, r)), nrm, STEM, false);
        if (hairy && i % 4 === 0 && hash(i, k + curve.length * 10) < 0.12) {
          cv.plot(add(p, mul(nrm, r * 2.1)), nrm, STEM, false);
        }
      }
    }
  }

  function drawSphere(cv, c, r, m) {
    const steps = Math.max(6, Math.ceil(r / D));
    for (let i = 0; i <= steps; i++) {
      const th = (i / steps) * Math.PI;
      for (let j = 0; j < steps * 2; j++) {
        const ph = (j / (steps * 2)) * Math.PI * 2;
        const nrm = [Math.sin(th) * Math.cos(ph), Math.cos(th), Math.sin(th) * Math.sin(ph)];
        cv.plot(add(c, mul(nrm, r)), nrm, m, false);
      }
    }
  }

  // Lanzettliches Blatt: steigt schräg aus dem Stängel und hängt am Ende leicht über
  function drawLeaf(cv, leaf, grow) {
    if (grow <= 0) return;
    const base = mainStem.at(leaf.s);
    const d = [Math.cos(leaf.theta), 0, Math.sin(leaf.theta)];
    const side = norm(cross(d, UP));
    const L = leaf.len * grow;
    const W = leaf.width * grow;
    const rise = leaf.rise;
    for (let i = 0; i <= 90; i++) {
      const u = i / 90;
      const spine = add(base, mul(add(mul(d, 0.85 * u), mul(UP, rise * u - 0.35 * u * u)), L));
      const dir = norm(add(mul(d, 0.85), mul(UP, rise - 0.7 * u)));
      const n = norm(cross(dir, side));
      const w = W * Math.pow(Math.sin(Math.PI * u), 0.8);
      for (let j = -12; j <= 12; j++) {
        const v = j / 12;
        // leicht nach oben gewölbt, wie eine Rinne entlang der Mittelrippe
        const p = add(add(spine, mul(side, v * w)), mul(n, 0.25 * w * v * v));
        cv.plot(p, norm(add(n, mul(side, -0.6 * v))), LEAF, true);
      }
    }
  }

  // Fünf runde Blütenblätter um eine helle Mitte. open: 0 = geschlossene Knospe, 1 = offen
  // size: Gesamtgröße (Nebenblüten sind kleiner)
  function drawFlower(cv, tip, dir, open, phase, size = 1) {
    const n = norm(add(dir, [0, 0.4, 0]));
    const [e1, e2] = frameFor(n);
    const sc = (0.45 + 0.55 * open) * size;
    const c = add(tip, mul(n, 0.02 * size));
    const beta = lerp(1.35, 0.18, open);
    const Lp = 0.17 * sc;
    const Wp = 0.08 * sc;

    // grüner Kelch mit fünf spitzen Zipfeln
    drawSphere(cv, tip, 0.026 * size, STEM);
    for (let k = 0; k < 5; k++) {
      const psi = phase + ((k + 0.5) / 5) * Math.PI * 2;
      const r = add(mul(e1, Math.cos(psi)), mul(e2, Math.sin(psi)));
      for (let i = 0; i <= 8; i++) {
        const u = i / 8;
        const pd = norm(add(mul(r, 0.5), n));
        cv.plot(add(tip, mul(pd, 0.02 * size + u * 0.05 * size)), norm(cross(pd, cross(n, r))), STEM, true);
      }
    }

    for (let k = 0; k < 5; k++) {
      const psi = phase + (k / 5) * Math.PI * 2;
      const r = add(mul(e1, Math.cos(psi)), mul(e2, Math.sin(psi)));
      const t = add(mul(e1, -Math.sin(psi)), mul(e2, Math.cos(psi)));
      for (let i = 0; i <= 28; i++) {
        const u = i / 28;
        // Blütenblatt wölbt sich zur Spitze hin leicht nach oben
        const b = beta + 0.35 * u * open;
        const pd = add(mul(r, Math.cos(b)), mul(n, Math.sin(b)));
        const nrm = norm(cross(pd, t));
        // verkehrt-eiförmig: schmal an der Basis, breit und rund an der Spitze
        const w = Wp * Math.sqrt(Math.max(0, Math.sin(Math.PI * Math.pow(u, 0.75))));
        const along = add(c, mul(pd, 0.012 * size + u * Lp));
        for (let j = -11; j <= 11; j++) {
          const v = j / 11;
          // feine Mittelader: leicht eingesenkt, dadurch eigene Schattierung
          const dip = Math.abs(v) < 0.12 ? -0.004 * size : 0;
          cv.plot(add(add(along, mul(t, v * w)), mul(nrm, dip)), nrm, PETAL, true);
        }
      }
    }

    if (open > 0.15) {
      drawSphere(cv, add(c, mul(n, 0.012 * size)), 0.026 * sc, CENTER);
      // weiße Schlundschuppen zwischen den Blütenblättern
      for (let k = 0; k < 5; k++) {
        const psi = phase + ((k + 0.5) / 5) * Math.PI * 2;
        const r = add(mul(e1, Math.cos(psi)), mul(e2, Math.sin(psi)));
        drawSphere(cv, add(add(c, mul(r, 0.035 * sc)), mul(n, 0.012 * size)), 0.011 * sc, CENTER);
      }
    }
  }

  // Blütenstand an einer Triebspitze: Hauptblüte, zwei Nebenblüten an kurzen Stielen
  // und ein eingerollter Wickel aus Knospen (typisch für Raublattgewächse)
  function drawCyme(cv, tip, dir, open, phase) {
    drawFlower(cv, tip, dir, open, phase, 1);
    if (open <= 0.02) return;
    const [e1, e2] = frameFor(dir);

    [[0.9, 0.75, 0.1], [3.6, 0.65, 0.25]].forEach(([a, size, delay]) => {
      const side = add(mul(e1, Math.cos(a + phase)), mul(e2, Math.sin(a + phase)));
      const d2 = norm(add(mul(dir, 0.5), side));
      const len = 0.13 * Math.min(1, open * 1.5);
      const stalk = { at: (u) => add(tip, mul(d2, u * len)), radius: () => 0.007, length: len };
      drawTube(cv, stalk, 1, false);
      drawFlower(cv, stalk.at(1), d2, clamp01((open - delay) / (1 - delay)), phase + a, size);
    });

    // Wickel: Bogen, der sich einrollt, mit kleiner werdenden Knospen
    const a = 2.3 + phase;
    const side = add(mul(e1, Math.cos(a)), mul(e2, Math.sin(a)));
    const R = 0.07;
    const grow = Math.min(1, open * 1.4);
    const curl = {
      at: (u) => {
        const ph = u * 3.6 * grow;
        return add(add(tip, mul(side, R * (1 - Math.cos(ph)))), mul(dir, R * Math.sin(ph) * 0.9));
      },
      radius: () => 0.006,
      length: R * 3.6,
    };
    drawTube(cv, curl, 1, false);
    for (let j = 0; j < 5; j++) {
      drawSphere(cv, curl.at(0.25 + j * 0.18), (0.022 - j * 0.003) * grow, BUD);
    }
  }

  function drawPlant(cv, p) {
    const q = p / 0.62;                  // Wachstum des Hauptstängels
    const sMain = clamp01(q);

    drawTube(cv, mainStem, sMain);
    LEAVES.forEach((leaf) => drawLeaf(cv, leaf, smooth(clamp01((q - leaf.s) / 0.3))));

    if (sMain > 0.03) {
      const open = smooth(clamp01((p - 0.62) / 0.22));
      drawCyme(cv, mainStem.at(sMain), tangent(mainStem, sMain), open, 0.3);
    }

    BRANCHES.forEach((b, i) => {
      const bp = clamp01((q - b.s0) / 0.35);
      if (bp <= 0) return;
      drawTube(cv, b, bp);
      if (bp > 0.08) {
        const open = smooth(clamp01((p - 0.62 * (b.s0 + 0.35)) / 0.22));
        drawCyme(cv, b.at(bp), tangent(b, bp), open, i * 1.3);
      }
    });
  }

  // ---------- Ausgabe ----------

  const escape = (ch) => (ch === '<' ? '&lt;' : ch === '>' ? '&gt;' : ch === '&' ? '&amp;' : ch);

  // Sterne und Schnee in leeren Zellen; gibt eine Map Zellindex → [Zeichen, Klasse] zurück
  function skyCells(cv, t) {
    const cells = new Map();
    const sec = t / 1000;
    cv.snow.forEach((f) => {
      const y = Math.floor((f.y + sec * f.speed) % cv.rows);
      const x = Math.floor(f.x + Math.sin(sec * 0.8 + f.phase) * f.sway);
      if (x < 0 || x >= cv.cols) return;
      const i = y * cv.cols + x;
      if (cv.mat[i] < 0) cells.set(i, [f.ch, 'snow']);
    });
    cv.stars.forEach((s) => {
      const tw = Math.sin((t / 1000) * s.speed + s.phase);
      if (tw < -0.3) return;
      const ch = s.ch === '<3' ? s.ch : tw > 0.9 ? '+' : s.ch;
      const i = s.y * cv.cols + s.x;
      for (let k = 0; k < ch.length; k++) {
        if (cv.mat[i + k] >= 0 || cells.has(i + k)) return;
      }
      const cls = tw < 0.3 ? `${s.cls} d` : s.cls;
      for (let k = 0; k < ch.length; k++) cells.set(i + k, [ch[k], cls]);
    });
    return cells;
  }

  function render(pre, cv, t) {
    const stars = skyCells(cv, t);
    const rows = [];
    for (let y = 0; y < cv.rows; y++) {
      let html = '';
      let open = null;
      for (let x = 0; x < cv.cols; x++) {
        const i = y * cv.cols + x;
        const m = cv.mat[i];
        let ch = ' ';
        let cls = null;
        if (m >= 0) {
          const l = cv.lum[i];
          ch = RAMP[Math.min(RAMP.length - 1, Math.floor(l * RAMP.length))];
          cls = `${MATERIALS[m]}-${l < 0.4 ? 0 : l < 0.7 ? 1 : 2}`;
        } else if (stars.has(i)) {
          [ch, cls] = stars.get(i);
        }
        if (cls !== open) {
          if (open) html += '</span>';
          if (cls) html += `<span class="${cls}">`;
          open = cls;
        }
        html += escape(ch);
      }
      if (open) html += '</span>';
      rows.push(html);
    }
    pre.innerHTML = rows.join('\n');
  }

  // Schrift- und Rastergröße so wählen, dass das Raster den ganzen Bildschirm füllt
  function layout(pre, cv) {
    const probe = document.createElement('span');
    probe.textContent = 'M'.repeat(20);
    probe.style.cssText = 'position:absolute;visibility:hidden;white-space:pre;font-size:100px';
    pre.textContent = '';
    pre.appendChild(probe);
    const charW = probe.getBoundingClientRect().width / 20 / 100;   // Zeichenbreite pro px Schriftgröße
    pre.removeChild(probe);

    const w = window.innerWidth, h = window.innerHeight;
    // mindestens TARGET_COLS Spalten und 120 Zeilen, damit es auch auf großen Bildschirmen fein bleibt
    const size = Math.max(4, Math.min(10, w / (TARGET_COLS * charW), h / 120));
    pre.style.fontSize = `${size}px`;
    cv.resize(Math.floor(w / (size * charW)), Math.floor(h / size), charW);
  }

  // at: optionaler Zeitpunkt in ms. Zeigt diesen Zustand als Standbild (zum Debuggen)
  function play(pre, { at = null, onComplete } = {}) {
    const cv = makeCanvas();
    let current = 0;
    const draw = (t) => {
      current = t;
      cv.reset(0.6 + (SPIN * t) / 1000);
      drawPlant(cv, clamp01(t / GROW_MS));
      render(pre, cv, t);
    };

    layout(pre, cv);
    window.addEventListener('resize', () => {
      layout(pre, cv);
      draw(current);
    });
    const finish = () => onComplete && onComplete();

    if (at !== null || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      draw(at !== null ? at : GROW_MS);
      finish();
      return;
    }

    let start = null;
    let last = -Infinity;
    let done = false;
    function frame(now) {
      if (start === null) start = now;
      const t = now - start;
      if (now - last >= 1000 / FPS) {
        last = now;
        draw(t);
      }
      if (!done && t >= GROW_MS + 400) {
        done = true;
        finish();
      }
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  }

  root.Bloom = { GROW_MS, play };
})(window);
