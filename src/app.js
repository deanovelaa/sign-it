import { mountSignaturePad } from './signature-pad.js';

const live = document.querySelector('#live');
const adapt = document.querySelector('#adapt');
const exportButtons = [...document.querySelectorAll('[data-export], [data-png]')];

const pad = mountSignaturePad('#pad', { background: '#ffffff', onChange: syncExportState });

function syncExportState() {
  const empty = pad.isEmpty();
  for (const b of exportButtons) b.disabled = empty;
}

function announce(msg) {
  live.textContent = msg;
}

/** Shows "Copied" on the button itself, then puts the label back. */
function confirmOn(button, label = 'Copied') {
  const original = button.dataset.label ?? button.textContent;
  button.dataset.label = original;
  button.textContent = label;
  clearTimeout(Number(button.dataset.timer));
  button.dataset.timer = String(
    setTimeout(() => {
      button.textContent = button.dataset.label;
    }, 2000),
  );
}

async function copy(text) {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through to the legacy path below */
  }
  // file:// and other non-secure contexts have no async clipboard.
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.setAttribute('readonly', '');
  ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0';
  document.body.appendChild(ta);
  ta.select();
  let ok = false;
  try {
    ok = document.execCommand('copy');
  } catch {
    ok = false;
  }
  ta.remove();
  return ok;
}

function download(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

const stamp = () => new Date().toISOString().slice(0, 10);

async function handleCopy(button, text, label) {
  if (await copy(text)) {
    confirmOn(button);
    announce(`${label} copied to clipboard`);
  } else {
    announce(`Could not copy the ${label.toLowerCase()} — your browser blocked clipboard access`);
  }
}

document.addEventListener('click', async (e) => {
  const button = e.target.closest('[data-export], [data-png]');
  if (!button || button.disabled) return;

  const inline = adapt.checked;

  switch (button.dataset.export) {
    case 'download-svg':
      // A downloaded file has no surrounding text to inherit from, so it keeps literal colours.
      download(
        new Blob([pad.toSVG({ currentColor: false })], { type: 'image/svg+xml' }),
        `signature-${stamp()}.svg`,
      );
      announce('SVG downloaded');
      return;
    case 'copy-svg':
      return handleCopy(button, pad.toSVG({ currentColor: inline }), 'SVG code');
    case 'copy-dataurl':
      return handleCopy(button, pad.toDataURL({ currentColor: inline }), 'Data URL');
    case 'copy-inline':
      return handleCopy(button, pad.toSVG({ currentColor: true }), 'Inline snippet');
  }

  const scale = Number(button.dataset.png);
  if (scale) {
    const blob = await pad.toPNG(scale);
    if (blob) {
      download(blob, `signature-${stamp()}@${scale}x.png`);
      announce(`PNG downloaded at ${scale} times size`);
    }
  }
});

syncExportState();
