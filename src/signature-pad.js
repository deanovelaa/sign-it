import { getStroke } from '../vendor/perfect-freehand.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

// Tuned once, not exposed. Raw perfect-freehand options are not a user-facing concern.
const INK = { thinning: 0.6, smoothing: 0.5, streamline: 0.5 };

const DEFAULTS = {
  color: '#111111',
  size: 8,
  background: 'transparent',
  showControls: true,
  onChange: null,
};

const PRESETS = ['#111111', '#1f3a93', '#9b1c1c', '#1d6f42'];

const r2 = (n) => Math.round(n * 100) / 100;

/** perfect-freehand returns a closed outline polygon; this turns it into a fillable `d`. */
function outlineToPath(pts) {
  if (!pts.length) return '';
  const d = [`M${r2(pts[0][0])},${r2(pts[0][1])}Q`];
  for (let i = 0; i < pts.length; i++) {
    const [x0, y0] = pts[i];
    const [x1, y1] = pts[(i + 1) % pts.length];
    d.push(`${r2(x0)},${r2(y0)} ${r2((x0 + x1) / 2)},${r2((y0 + y1) / 2)}`);
  }
  d.push('Z');
  return d.join(' ');
}

function boundsOf(pts) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of pts) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  return { minX, minY, maxX, maxY };
}

function buildStroke({ points, color, size }) {
  // A stylus reports many distinct pressures; a mouse reports one. Only simulate when we must.
  const distinct = new Set(points.map((p) => p[2])).size;
  const outline = getStroke(points, {
    ...INK,
    size,
    simulatePressure: distinct <= 2,
    last: true,
  });
  return { d: outlineToPath(outline), color, size, bounds: boundsOf(outline) };
}

const controlsHTML = () => `
<div class="sp-controls">
  <div class="sp-group" role="group" aria-label="Ink colour">
    ${PRESETS.map((c, i) => `<button type="button" class="sp-swatch" data-color="${c}" style="--swatch:${c}"
      aria-label="Ink colour ${i + 1}" aria-pressed="false"></button>`).join('')}
    <label class="sp-custom">
      <span class="sp-sr">Custom ink colour</span>
      <input type="color" class="sp-color">
    </label>
  </div>
  <label class="sp-group sp-size">
    <span>Size</span>
    <input type="range" class="sp-range" min="2" max="20" step="1">
  </label>
  <div class="sp-group sp-actions">
    <button type="button" class="sp-undo">Undo</button>
    <button type="button" class="sp-clear">Clear</button>
  </div>
</div>`;

export function mountSignaturePad(target, options = {}) {
  const host = typeof target === 'string' ? document.querySelector(target) : target;
  if (!host) throw new Error('mountSignaturePad: target not found');

  const opts = { ...DEFAULTS, ...options };
  const state = { color: opts.color, size: opts.size };
  const strokes = [];
  let live = null;

  host.classList.add('signature-pad');
  host.innerHTML = `
<div class="sp-stage" style="background:${opts.background}">
  <svg class="sp-surface" role="application" tabindex="0"
       aria-label="Signature pad. Draw your signature here using a mouse, finger or stylus.">
    <g class="sp-committed"></g>
    <path class="sp-live" stroke="none"></path>
  </svg>
  <p class="sp-hint" aria-hidden="true">Draw your signature</p>
</div>
<p class="sp-note">Drawing requires a pointer device — a mouse, trackpad, touchscreen or stylus.</p>
${opts.showControls ? controlsHTML() : ''}
<p class="sp-status" role="status" aria-live="polite"></p>`;

  const $ = (sel) => host.querySelector(sel);
  const surface = $('.sp-surface');
  const committed = $('.sp-committed');
  const livePath = $('.sp-live');
  const hint = $('.sp-hint');
  const status = $('.sp-status');

  const isEmpty = () => strokes.length === 0;
  const announce = (msg) => { status.textContent = msg; };

  function paintCommitted() {
    committed.textContent = '';
    for (const s of strokes) {
      const p = document.createElementNS(SVG_NS, 'path');
      p.setAttribute('d', s.d);
      p.setAttribute('fill', s.color);
      p.setAttribute('stroke', 'none');
      committed.appendChild(p);
    }
    hint.hidden = !isEmpty();
    host.classList.toggle('sp-is-empty', isEmpty());
  }

  function changed() {
    paintCommitted();
    if (typeof opts.onChange === 'function') opts.onChange(toSVG());
  }

  function pointFrom(e) {
    const r = surface.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top, e.pressure];
  }

  function paintLive() {
    livePath.setAttribute('d', live ? buildStroke(live).d : '');
    livePath.setAttribute('fill', live ? live.color : 'none');
  }

  function onPointerDown(e) {
    if (!e.isPrimary || (e.pointerType === 'mouse' && e.button !== 0)) return;
    try { surface.setPointerCapture(e.pointerId); } catch { /* stale pointer id; drawing still works */ }
    live = { points: [pointFrom(e)], color: state.color, size: state.size };
    hint.hidden = true;
    paintLive();
  }

  function onPointerMove(e) {
    if (!live) return;
    const coalesced = e.getCoalescedEvents ? e.getCoalescedEvents() : [];
    for (const ev of coalesced.length ? coalesced : [e]) live.points.push(pointFrom(ev));
    paintLive();
  }

  function onPointerEnd() {
    if (!live) return;
    const finished = live;
    live = null;
    livePath.setAttribute('d', '');
    strokes.push(buildStroke(finished));
    changed();
  }

  function onKeyDown(e) {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z' && !e.shiftKey) {
      const t = e.target;
      if (t instanceof HTMLElement && t.closest('input, textarea, [contenteditable]')) return;
      if (isEmpty()) return;
      e.preventDefault();
      undo();
    }
  }

  surface.addEventListener('pointerdown', onPointerDown);
  surface.addEventListener('pointermove', onPointerMove);
  surface.addEventListener('pointerup', onPointerEnd);
  surface.addEventListener('pointercancel', onPointerEnd);
  document.addEventListener('keydown', onKeyDown);

  function undo() {
    if (isEmpty()) return;
    strokes.pop();
    changed();
    announce('Last stroke removed');
  }

  function clear() {
    if (isEmpty()) return;
    strokes.length = 0;
    changed();
    announce('Signature cleared');
  }

  function setColor(c) {
    state.color = c;
    if (opts.showControls) {
      $('.sp-color').value = c;
      for (const b of host.querySelectorAll('.sp-swatch')) {
        b.setAttribute('aria-pressed', String(b.dataset.color === c));
      }
    }
  }

  function setSize(n) {
    state.size = Number(n);
    if (opts.showControls) $('.sp-range').value = String(state.size);
  }

  /** Bounding box of the rendered ink, padded a little so nothing clips. */
  function inkBox() {
    if (isEmpty()) return null;
    const b = strokes.reduce((a, s) => ({
      minX: Math.min(a.minX, s.bounds.minX),
      minY: Math.min(a.minY, s.bounds.minY),
      maxX: Math.max(a.maxX, s.bounds.maxX),
      maxY: Math.max(a.maxY, s.bounds.maxY),
    }), strokes[0].bounds);
    const pad = Math.max(1, Math.max(...strokes.map((s) => s.size)) * 0.15);
    return {
      x: r2(b.minX - pad),
      y: r2(b.minY - pad),
      w: r2(b.maxX - b.minX + pad * 2),
      h: r2(b.maxY - b.minY + pad * 2),
    };
  }

  function buildSVG({ currentColor = false, scale = 0 } = {}) {
    const box = inkBox();
    if (!box) return '';
    // No width/height by default: a viewBox-only SVG scales to whatever container it lands in.
    const dims = scale ? ` width="${Math.ceil(box.w * scale)}" height="${Math.ceil(box.h * scale)}"` : '';
    const paths = strokes
      .map((s) => `<path d="${s.d}" fill="${currentColor ? 'currentColor' : s.color}"/>`)
      .join('');
    return `<svg xmlns="${SVG_NS}" viewBox="${box.x} ${box.y} ${box.w} ${box.h}"${dims}>${paths}</svg>`;
  }

  function toSVG(o) { return buildSVG(o); }
  function toDataURL(o) {
    const svg = buildSVG(o);
    return svg ? `data:image/svg+xml,${encodeURIComponent(svg)}` : '';
  }

  function toPNG(scale = 1) {
    // currentColor has no meaning in a standalone raster, so PNG always bakes literal colours.
    const box = inkBox();
    const svg = buildSVG({ currentColor: false, scale });
    if (!svg) return Promise.resolve(null);
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = Math.ceil(box.w * scale);
        canvas.height = Math.ceil(box.h * scale);
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
        canvas.toBlob(resolve, 'image/png');
      };
      img.onerror = () => reject(new Error('Could not rasterise the signature'));
      img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
    });
  }

  function destroy() {
    surface.removeEventListener('pointerdown', onPointerDown);
    surface.removeEventListener('pointermove', onPointerMove);
    surface.removeEventListener('pointerup', onPointerEnd);
    surface.removeEventListener('pointercancel', onPointerEnd);
    document.removeEventListener('keydown', onKeyDown);
    host.classList.remove('signature-pad', 'sp-is-empty');
    host.textContent = '';
  }

  if (opts.showControls) {
    $('.sp-undo').addEventListener('click', undo);
    $('.sp-clear').addEventListener('click', clear);
    $('.sp-color').addEventListener('input', (e) => setColor(e.target.value));
    $('.sp-range').addEventListener('input', (e) => setSize(e.target.value));
    for (const b of host.querySelectorAll('.sp-swatch')) {
      b.addEventListener('click', () => setColor(b.dataset.color));
    }
  }

  setColor(state.color);
  setSize(state.size);
  paintCommitted();

  return {
    undo, clear, isEmpty, toSVG, toDataURL, toPNG, destroy,
    setColor, setSize,
    get strokeCount() { return strokes.length; },
  };
}
