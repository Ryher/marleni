/*
 * Yes/No unter der Frage. "No" läuft weg: Sobald Maus oder Finger ihn berühren,
 * springt er an eine zufällige freie Stelle im sichtbaren Bereich.
 * Auf dem Handy passiert das schon bei pointerdown/touchstart, also bevor ein Klick entsteht.
 * "Yes" springt dabei jedes Mal auf den alten Platz von "No".
 */
(function (root) {
  'use strict';

  const EDGE = 16;   // Mindestabstand zum Bildschirmrand
  const GAP = 12;    // Mindestabstand zu Frage und Yes

  const question = document.getElementById('question');
  const answers = document.getElementById('answers');
  const yes = document.getElementById('yes');
  const no = document.getElementById('no');

  let lastFlee = 0;

  function viewport() {
    let w = document.documentElement.clientWidth || window.innerWidth;
    let h = window.innerHeight;
    if (window.visualViewport) {
      w = Math.min(w, window.visualViewport.width);
      h = Math.min(h, window.visualViewport.height);
    }
    return { w, h };
  }

  const overlaps = (x, y, w, h, r) =>
    x < r.right + GAP && x + w > r.left - GAP && y < r.bottom + GAP && y + h > r.top - GAP;

  // Buttons direkt unter die Frage setzen (Höhe der Frage hängt von Breite und Schrift ab)
  function placeAnswers() {
    answers.style.top = `${Math.round(question.getBoundingClientRect().bottom + 18)}px`;
  }

  // "Yes" an eine Stelle setzen (Mittelpunkt cx/cy), im Viewport gehalten
  function placeYes(cx, cy) {
    const { w, h } = viewport();
    const bw = yes.offsetWidth, bh = yes.offsetHeight;
    const x = Math.min(Math.max(EDGE, cx - bw / 2), Math.max(EDGE, w - EDGE - bw));
    const t = Math.min(Math.max(EDGE, cy - bh / 2), Math.max(EDGE, h - EDGE - bh));
    yes.classList.add('moved');
    yes.style.left = `${Math.round(x)}px`;
    yes.style.top = `${Math.round(t)}px`;
  }

  // Neue Position für "No"; (px, py) ist die Stelle, an der Finger/Maus gerade ist.
  // "Yes" springt dabei auf den alten Platz von "No".
  function jump(px, py, moveYes = true) {
    const old = no.getBoundingClientRect();
    if (moveYes) placeYes(old.left + old.width / 2, old.top + old.height / 2);
    no.classList.add('fled');
    const bw = no.offsetWidth, bh = no.offsetHeight;
    const { w, h } = viewport();
    const q = question.getBoundingClientRect();
    const y = yes.getBoundingClientRect();
    const maxX = Math.max(EDGE, w - EDGE - bw);
    const maxY = Math.max(EDGE, h - EDGE - bh);
    const far = Math.max(bw, bh) + 40;
    const free = (x, t) => !overlaps(x, t, bw, bh, q) && !overlaps(x, t, bw, bh, y);
    const away = (x, t, cx, cy) => Math.hypot(x + bw / 2 - cx, t + bh / 2 - cy) > far;

    let pos = null, fallback = null;
    for (let i = 0; i < 80 && !pos; i++) {
      const x = EDGE + Math.random() * (maxX - EDGE);
      const t = EDGE + Math.random() * (maxY - EDGE);
      if (!free(x, t)) continue;
      fallback = fallback || [x, t];
      if (away(x, t, px, py) && away(x, t, old.left + old.width / 2, old.top + old.height / 2)) pos = [x, t];
    }
    // Notfall (winziger Viewport): unten links, notfalls auch überlappend
    pos = pos || fallback || [EDGE, maxY];
    no.style.left = `${Math.round(pos[0])}px`;
    no.style.top = `${Math.round(pos[1])}px`;
  }

  function pointOf(e) {
    const p = e.touches && e.touches[0] ? e.touches[0] : e;
    if (p.clientX || p.clientY) return [p.clientX, p.clientY];
    const r = no.getBoundingClientRect();   // z. B. Tastatur-Klick ohne Koordinaten
    return [r.left + r.width / 2, r.top + r.height / 2];
  }

  function flee(e) {
    if (e.cancelable) e.preventDefault();
    // pointerdown und touchstart kommen beim selben Antippen beide an: nur einmal springen
    const now = performance.now();
    if (now - lastFlee < 250) return;
    lastFlee = now;
    const [px, py] = pointOf(e);
    jump(px, py);
    no.blur();
  }

  no.addEventListener('pointerenter', (e) => {
    if (e.pointerType === 'mouse') flee(e);
  });
  no.addEventListener('pointerdown', (e) => {
    flee(e);
    // Touch fängt den Pointer implizit am Button ein, das würde sonst trotzdem einen Klick auslösen
    if (no.hasPointerCapture && no.hasPointerCapture(e.pointerId)) no.releasePointerCapture(e.pointerId);
  });
  no.addEventListener('touchstart', flee, { passive: false });
  no.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    lastFlee = 0;   // ein echter Klick soll immer einen Sprung auslösen
    flee(e);
  });

  // Bei Resize/Drehen im Viewport halten und nicht auf Frage oder Yes landen
  function refit() {
    placeAnswers();
    if (!no.classList.contains('fled')) return;
    if (yes.classList.contains('moved')) {
      const r = yes.getBoundingClientRect();
      placeYes(r.left + r.width / 2, r.top + r.height / 2);
    }
    const { w, h } = viewport();
    const bw = no.offsetWidth, bh = no.offsetHeight;
    const x = Math.min(Math.max(EDGE, parseFloat(no.style.left) || 0), Math.max(EDGE, w - EDGE - bw));
    const t = Math.min(Math.max(EDGE, parseFloat(no.style.top) || 0), Math.max(EDGE, h - EDGE - bh));
    no.style.left = `${x}px`;
    no.style.top = `${t}px`;
    if (overlaps(x, t, bw, bh, question.getBoundingClientRect()) || overlaps(x, t, bw, bh, yes.getBoundingClientRect())) {
      jump(-1e4, -1e4, false);
    }
  }

  window.addEventListener('resize', refit);
  window.addEventListener('orientationchange', refit);
  if (window.visualViewport) window.visualViewport.addEventListener('resize', refit);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(refit);

  function show() {
    placeAnswers();
    answers.classList.add('visible');
  }

  root.Question = { show };
})(window);
