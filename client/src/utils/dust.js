// Turning a figure to dust.
//
// The number is rasterised onto a canvas, its pixels dealt out into a handful
// of layers, and each layer flown off on its own delay. Animating pixels
// individually in JavaScript would be tens of thousands of objects a frame on
// a dashboard full of figures; a layer is one composited element the GPU moves
// for nothing. Eight of them, staggered, read as a crumble rather than a slide.
//
// The timings are the whole effect. Too quick and it is a blink you cannot see;
// the first version ran in under 400ms and read as the figure simply vanishing.
// A layer needs long enough in the air to be watched, and the gap between one
// layer and the next is what makes the number come apart from its end rather
// than all at once. Together: 520 + 7 × 60 ≈ 940ms, start to settled.
const LAYERS = 8;
const DURATION = 520;
const STEP = 60;

// The most figures allowed in the air at once. This used to be 14, which is
// fewer than any screen in the app actually shows — Recurring puts 29 in view —
// so the first fourteen crumbled and the rest blinked, in the same glance. An
// effect that only some of the numbers get looks like a bug in the effect, and
// it was reported as one.
//
// The cap stays, because it is a real guard against a screen full of figures
// stalling on a toggle nobody asked to wait for. It is just set above what a
// screen holds now, and the cost per figure is what gives instead: past
// BUSY_AT the dust is dealt into fewer layers, which is the expensive part.
// Four layers still crumbles; it simply has a coarser grain nobody can see
// while thirty of them are moving at once.
const MAX_IN_FLIGHT = 48;
const BUSY_AT = 12;
const BUSY_LAYERS = 4;

let inFlight = 0;

const reducedMotion = () =>
  typeof window !== 'undefined' &&
  window.matchMedia &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// Off-screen figures are skipped rather than queued: nobody is looking at them,
// and by the time they scroll into view the swap has long since happened.
function onScreen(el) {
  const rect = el.getBoundingClientRect();
  if (rect.width < 2 || rect.height < 2) return false;
  const height = window.innerHeight || document.documentElement.clientHeight;
  return rect.bottom > -80 && rect.top < height + 80;
}

// getComputedStyle().font is empty in Firefox often enough that the shorthand
// is worth assembling by hand. Line height is left out deliberately — the
// baseline is worked out below from the element's own box.
function fontOf(style) {
  return `${style.fontStyle} ${style.fontWeight} ${style.fontSize} / normal ${style.fontFamily}`;
}

function rasterise(el, text) {
  const width = el.offsetWidth;
  const height = el.offsetHeight;
  if (!width || !height) return null;

  const style = getComputedStyle(el);
  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(width * ratio);
  canvas.height = Math.ceil(height * ratio);

  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  ctx.scale(ratio, ratio);
  ctx.font = fontOf(style);
  ctx.fillStyle = style.color;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  if ('letterSpacing' in ctx && style.letterSpacing !== 'normal') {
    ctx.letterSpacing = style.letterSpacing;
  }

  // Centre the em box in the element's line box, which is what the browser
  // itself did when it laid the text out. A pixel or two either way would show
  // as a jolt at the moment the canvas takes over from the text.
  const metrics = ctx.measureText(text);
  const size = parseFloat(style.fontSize) || 16;
  const ascent = metrics.fontBoundingBoxAscent || metrics.actualBoundingBoxAscent || size * 0.8;
  const descent = metrics.fontBoundingBoxDescent || metrics.actualBoundingBoxDescent || size * 0.2;
  ctx.fillText(text, 0, (height - (ascent + descent)) / 2 + ascent);

  return { canvas, width, height };
}

// Every opaque pixel is dealt to one layer. The deal is biased by how far right
// the pixel sits, so the number crumbles from its end, and mixed with enough
// randomness that the boundary between one layer and the next is never a line.
function deal({ canvas, width, height }, count) {
  const source = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height);
  const pixels = source.data;
  const w = canvas.width;

  const layers = [];
  for (let i = 0; i < count; i += 1) {
    layers.push(new ImageData(canvas.width, canvas.height));
  }

  for (let y = 0; y < canvas.height; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const i = (y * w + x) * 4;
      if (pixels[i + 3] === 0) continue;
      const fromRight = 1 - x / w;
      const pick = Math.min(
        count - 1,
        Math.floor(count * (fromRight * 0.7 + Math.random() * 0.32))
      );
      const target = layers[pick].data;
      target[i] = pixels[i];
      target[i + 1] = pixels[i + 1];
      target[i + 2] = pixels[i + 2];
      target[i + 3] = pixels[i + 3];
    }
  }

  return layers.map((image) => {
    const layer = document.createElement('canvas');
    layer.width = canvas.width;
    layer.height = canvas.height;
    layer.className = 'dust';
    layer.style.width = `${width}px`;
    layer.style.height = `${height}px`;
    layer.getContext('2d').putImageData(image, 0, 0);
    return layer;
  });
}

// One fixed, viewport-sized layer for every figure's dust, rather than each
// figure hosting its own inside itself.
//
// Two reasons, both of which were real bugs. A layer flies up and to the right,
// so dust from the amount nearest the right edge of the page reached past it
// and grew the document — which put a horizontal scrollbar on screen for the
// length of the animation, and then a vertical one, because the horizontal bar
// eats the height a page that exactly fitted no longer had. And dust hosted
// inside a row was clipped by the card around it: .txn-list, .latest and the
// ledger cells all set overflow: hidden, which is most of the rows on screen.
//
// Fixed rather than absolute is the load-bearing part: a fixed element and its
// descendants do not contribute to the document's scrollable area at all, so
// nothing here can move a scrollbar again.
let overlay = null;

function dustLayer() {
  if (overlay && overlay.isConnected) return overlay;
  overlay = document.createElement('div');
  overlay.className = 'dust-layer';
  overlay.setAttribute('aria-hidden', 'true');
  document.body.appendChild(overlay);
  return overlay;
}

function fly(layer, index) {
  // Further out for the later layers, so the cloud spreads as it goes instead
  // of every layer travelling the same distance in convoy. The middle keyframe
  // holds most of the opacity: the dust should be visible for most of its
  // flight and only give out at the end.
  const drift = 14 + index * 7;
  const frames = [
    { offset: 0, transform: 'translate3d(0,0,0)', opacity: 1, filter: 'blur(0px)' },
    {
      offset: 0.45,
      transform: `translate3d(${drift * 0.45}px, ${-drift * 0.5}px, 0) rotate(${
        (index % 2 ? 1 : -1) * 1.4
      }deg) scale(1.02)`,
      opacity: 0.72,
      filter: 'blur(0.7px)',
    },
    {
      offset: 1,
      transform: `translate3d(${drift}px, ${-drift * 0.95}px, 0) rotate(${
        (index % 2 ? 1 : -1) * 3.5
      }deg) scale(1.06)`,
      opacity: 0,
      filter: 'blur(2.4px)',
    },
  ];
  const options = {
    duration: DURATION,
    delay: index * STEP,
    easing: 'cubic-bezier(.25,.4,.35,1)',
    fill: 'forwards',
  };

  if (!layer.animate) return new Promise((done) => setTimeout(done, DURATION + index * STEP));
  const animation = layer.animate(frames, options);
  // .finished rejects if the animation is cancelled — which is exactly what
  // happens when the element unmounts mid-flight, and is not an error.
  return animation.finished.catch(() => {});
}

// Sends `el`'s current text off as dust. Resolves when the figure is gone and
// the caller may swap the text.
export function dust(el) {
  if (!el) return Promise.resolve();

  const text = el.textContent;
  if (!text || reducedMotion() || !onScreen(el) || inFlight >= MAX_IN_FLIGHT) {
    return Promise.resolve();
  }

  let layers;
  try {
    const prepared = rasterise(el, text);
    if (!prepared) return Promise.resolve();
    layers = deal(prepared, inFlight >= BUSY_AT ? BUSY_LAYERS : LAYERS);
  } catch {
    // A canvas that won't rasterise (no 2d context, memory pressure) is not
    // worth failing a privacy toggle over.
    return Promise.resolve();
  }

  // Placed where the figure is, in viewport coordinates, because the layer
  // they go into is fixed to the viewport rather than to the row.
  const at = el.getBoundingClientRect();
  for (const layer of layers) {
    layer.style.left = `${at.left}px`;
    layer.style.top = `${at.top}px`;
  }

  inFlight += 1;
  dustLayer().append(...layers);
  el.classList.add('dusting');

  // The canvases go, but `dusting` stays: the element is left blank, and it is
  // the caller's job to clear the class in the same commit that puts the new
  // text in. Clearing it here would uncover the old figure for however long it
  // takes React to render — one frame, which is exactly long enough to look
  // like a glitch.
  // Only this figure's own layers are taken away — the overlay is shared, and
  // thirty other figures may still be mid-flight in it.
  const settle = () => {
    inFlight = Math.max(0, inFlight - 1);
    for (const layer of layers) layer.remove();
  };

  return Promise.all(layers.map(fly)).then(settle, settle);
}
