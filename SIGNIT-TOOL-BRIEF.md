# Build brief: Sign It  — a browser-only handwritten signature tool

Build a small, dependency-light web tool that lets someone draw a handwritten
signature with a mouse, finger or stylus and export it as a clean SVG. It must
work as a standalone page **and** as an embeddable component on another site.

Everything runs in the browser. Nothing is uploaded anywhere, ever.

---

## 1. Hard constraints

These are not negotiable. Confirm each one is met before you call the work done.

1. **No backend.** No server, no API routes, no database, no third-party service.
2. **No network calls at runtime.** The page must work fully offline after first
   load. Do not load fonts, scripts or styles from a CDN at runtime — vendor
   anything you need into the repo.
3. **No build step.** Plain `.html`, `.css` and `.js` (ES modules) that a static
   host serves directly. No bundler, no transpiler, no `npm run build`. Someone
   must be able to clone the repo, open `index.html`, and have it work.
4. **No tracking.** No analytics, no telemetry, no cookies, no `localStorage` of
   signature data.
5. **MIT licensed.** Free for anyone to use, fork and ship.

The privacy property is the product's main selling point. State it on the page,
and make sure it is literally true rather than just claimed.

---

## 2. Stack

- Vanilla HTML, CSS and JavaScript (ES modules, `<script type="module">`).
- One vendored dependency: **[perfect-freehand](https://github.com/steveruizok/perfect-freehand)**
  (MIT, ~4KB). Download its ESM build to `vendor/perfect-freehand.js` and import
  it by relative path. Do not add `package.json` or `node_modules`.

**Why perfect-freehand:** it converts a list of input points into a closed
*outline polygon* that tapers with speed and pressure, which is what makes a
stroke read as ink instead of a wobbly polyline. Note the consequence for
rendering — see §5.2.

---

## 3. Architecture

The core is one ES module exporting a mount function. The standalone page is a
thin wrapper around it. This is what makes the tool embeddable.

```js
// src/signature-pad.js
export function mountSignaturePad(target, options = {}) { /* ... */ }
```

`target` is an element or a selector. `options` supports at minimum:

| Option | Type | Default | Meaning |
|---|---|---|---|
| `color` | string | `#111111` | Initial ink colour |
| `size` | number | `8` | Initial stroke size |
| `background` | string | `transparent` | Pad background |
| `showControls` | boolean | `true` | Render the built-in control bar |
| `onChange` | function | — | Called with the current SVG string on every change |

It returns a handle so a host page can drive it without the built-in UI:

```js
const pad = mountSignaturePad('#pad', { showControls: false });
pad.undo(); pad.clear(); pad.isEmpty();
pad.toSVG();       // string
pad.toDataURL();   // "data:image/svg+xml,..."
pad.toPNG(scale);  // Promise<Blob>
pad.destroy();
```

### File structure

```
index.html                  standalone demo + landing page
src/signature-pad.js        the component (all drawing + export logic)
src/signature-pad.css       component styles only, no page styles
src/app.js                  wires up the standalone page
styles.css                  page styles for the standalone demo
vendor/perfect-freehand.js  vendored dependency
README.md
LICENSE                     MIT
```

---

## 4. Drawing behaviour

1. The drawing surface is an **`<svg>` element**, not a `<canvas>`. Strokes are
   `<path>` children. This keeps the export lossless and avoids a raster step.
2. Use **Pointer Events** (`pointerdown` / `pointermove` / `pointerup` /
   `pointercancel`) so mouse, touch and stylus all work through one code path.
   Call `setPointerCapture` on `pointerdown` so a stroke survives the pointer
   leaving the element.
3. Set `touch-action: none` on the surface, or scrolling will hijack finger
   drawing on mobile.
4. Read `event.pressure` where available and pass it to perfect-freehand. Mice
   report a constant `0.5`; that is fine, perfect-freehand still tapers on
   velocity.
5. Use `getCoalescedEvents()` when present to capture the full input sample rate
   on high-refresh devices. Fall back to the plain event otherwise.
6. Render the in-progress stroke live, on every move, in its own `<path>`.
   Commit it to the stroke list on `pointerup`.
7. Each committed stroke stores its own colour and size, so changing the colour
   mid-signature does not restyle strokes already drawn.

---

## 5. The details that are easy to get wrong

Implement these deliberately. They are the difference between a demo and a tool.

### 5.1 Fit the viewBox to the ink

A naive export wraps the signature in the full pad dimensions, so it arrives
with enormous transparent margins and looks tiny wherever it is placed.

Compute the bounding box of all committed points, add a small padding
proportional to the largest stroke size, and set the exported `viewBox` to that
box. The exported SVG must have **no `width` or `height` attributes** — only a
`viewBox` — so it scales to whatever container it lands in.

### 5.2 perfect-freehand returns an outline, not a centre line

`getStroke()` gives you the points of a closed polygon describing the *edge* of
the stroke. Render it as a **filled** path:

```html
<path d="..." fill="currentColor" stroke="none" />
```

Do **not** set `stroke` and `stroke-width` on it — that produces a hollow
double-line outline, which is the most common bug when using this library.

### 5.3 `currentColor` for embedding

Offer an export toggle: **"Adapt to text colour"**. When on, the exported paths
use `fill="currentColor"` instead of a literal hex value. When that SVG is
inlined into a page, the signature then inherits the surrounding text colour and
automatically works in both light and dark themes.

This is the single most useful feature for the "signature in a website footer"
use case. Default it to on for the inline export, off for the file download.

### 5.4 Smoothing

Expose perfect-freehand's `streamline` and `thinning` as a single "Smoothing"
control if you expose them at all. Do not surface the raw option set — pick good
defaults (`thinning: 0.6`, `smoothing: 0.5`, `streamline: 0.5`, `simulatePressure: true`)
and keep the UI to what someone actually wants to change.

---

## 6. Features

### Must have

- Draw, with live rendering.
- **Undo** — removes the last stroke. Wire to `Cmd/Ctrl+Z` as well as a button.
- **Clear** — removes everything. Ask nothing; undo covers mistakes.
- **Colour** — a small set of presets plus a native `<input type="color">`.
- **Size** — a slider, roughly 2–20.
- **Empty state** — a "Draw your signature" hint inside the pad, hidden on first
  stroke. Export controls are disabled while the pad is empty.

### Export — four modes, each with one click to copy or save

| Mode | Output |
|---|---|
| Download SVG | `.svg` file via a `Blob` + `URL.createObjectURL` + `<a download>`. Revoke the object URL afterwards. |
| SVG code | The raw `<svg>…</svg>` markup, copied to clipboard |
| Data URL | `data:image/svg+xml,` + `encodeURIComponent(svg)`, copied to clipboard |
| Inline HTML | A ready-to-paste snippet using `currentColor`, copied to clipboard |

Also offer **Download PNG** at 1×/2×/3×, produced by drawing the SVG onto an
offscreen canvas. Keep the SVG path primary — PNG is the fallback for tools that
cannot take vectors.

Every copy action needs visible confirmation ("Copied") that reverts after ~2s.
Use `navigator.clipboard.writeText` with a `document.execCommand('copy')`
fallback for non-secure contexts.

### Nice to have, only after the above works

- Trim/crop preview showing the exported bounds.
- Aspect-ratio lock for the pad on resize.
- A "Try an example" button that plays back a sample stroke set.

---

## 7. Non-goals

Do not build these. If you think one is needed, stop and ask first.

- Accounts, login, or saving signatures anywhere.
- Sharing links to a signature.
- Server-side rendering or any API route.
- A signature *font* generator (typing a name and picking a script typeface).
  This tool is about real handwriting.
- Legally binding e-signature workflows, audit trails or document signing. Say
  plainly in the README that this produces an image, not a legal signature.

---

## 8. Accessibility

- Every control is a real `<button>` or labelled `<input>`, reachable by keyboard
  and with a visible `:focus-visible` ring.
- The drawing surface has `role="application"` and an `aria-label` explaining
  what it is, plus text nearby noting that drawing requires a pointer device.
- Live-announce state changes ("Signature cleared", "Copied") in an
  `aria-live="polite"` region.
- Honour `prefers-reduced-motion` — no non-essential transitions when set.
- Colour contrast of UI text at 4.5:1 minimum. The ink colour is the user's
  choice and is exempt.

---

## 9. Visual direction

Restrained and quiet. The signature is the only thing on the page with
personality; the interface around it should recede.

- One type size for almost everything, with hierarchy from colour rather than
  size or weight.
- System font stack. Do not load a web font.
- Define all colours as CSS custom properties on `:root`, redefine them under
  `@media (prefers-color-scheme: dark)` and under `:root[data-theme="dark"]`,
  and give `body` an explicit background.
- Use these token names so the component can drop into an existing site that
  already defines them: `--bg-primary`, `--bg-secondary`, `--text-primary`,
  `--text-strong`, `--text-secondary`, `--border-color`, `--radius`.
- Transitions: 150ms for colour and opacity, 220ms for size and position.
  Nothing longer on an interactive control.
- Must work at 360px wide with no horizontal scrolling.

---

## 10. Repository deliverables

- `README.md` with: one-line description, a screenshot or GIF, a live demo link,
  a "How it works" section (three sentences), embedding instructions with a code
  sample, the options table, and a short privacy statement.
- `LICENSE` — MIT.
- No CI, no issue templates, no contributing guide. Add them later if anyone
  actually turns up.
- Must deploy to GitHub Pages straight from the default branch root with no
  configuration. Verify `index.html` works when served from a subpath like
  `/signature/` — use relative paths everywhere, never absolute (`/src/...`).

---

## 11. Acceptance criteria

Verify each of these by actually running it, not by reading the code.

1. `index.html` opened directly from the filesystem (`file://`) draws and exports
   without errors.
2. With devtools Network throttled to **Offline** after first load, everything
   still works.
3. The Network tab shows **zero requests** during drawing and exporting.
4. A downloaded `.svg` opens in a browser and in a vector editor, is cropped
   tightly to the ink, and has a `viewBox` but no `width`/`height`.
5. Pasting the inline snippet into a page with `color: red` renders a red
   signature.
6. Drawing with a finger on a real phone does not scroll the page.
7. Undo removes exactly one stroke, and repeated undo empties the pad without
   throwing.
8. Changing colour mid-signature does not recolour earlier strokes.
9. Every control is reachable by Tab, and activates with Enter or Space.
10. The page has no horizontal scrollbar at 360px wide.

---

## 12. Working notes

- Build the drawing core first and get a single stroke looking genuinely good
  before adding any controls. Stroke quality is the whole product; if it looks
  like a polyline, nothing else matters.
- Commit in small steps with clear messages.
- If a requirement here turns out to be wrong or impossible, say so and explain
  why rather than silently doing something else.
