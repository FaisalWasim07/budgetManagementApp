// Turning a figure to dust.
//
// The number is rasterised onto a canvas, its pixels dealt out into a handful
// of layers, and each layer flown off on its own delay. Animating pixels
// individually in JavaScript would be tens of thousands of objects a frame on
// a dashboard full of figures; a layer is one composited element the GPU moves
// for nothing. Six of them, staggered, read as a crumble rather than a slide.

const LAYERS = 6;
const DURATION = 260;
const STEP = 24;

// The most figures allowed in the air at once. A dashboard can hold forty, and
// forty simultaneous rasterisations is a visible stall for an effect nobody
// asked to wait for. The rest swap over instantly, which is what they did
// before this existed.
const MAX_IN_FLIGHT = 14;

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
function deal({ canvas, width, height }) {
  const source = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height);
  const pixels = source.data;
  const w = canvas.width;

  const layers = [];
  for (let i = 0; i < LAYERS; i += 1) {
    layers.push(new ImageData(canvas.width, canvas.height));
  }

  for (let y = 0; y < canvas.height; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const i = (y * w + x) * 4;
      if (pixels[i + 3] === 0) continue;
      const fromRight = 1 - x / w;
      const pick = Math.min(
        LAYERS - 1,
        Math.floor(LAYERS * (fromRight * 0.7 + Math.random() * 0.32))
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

function fly(layer, index) {
  const drift = 9 + index * 5;
  const frames = [
    { transform: 'translate3d(0,0,0)', opacity: 1, filter: 'blur(0px)' },
    {
      transform: `translate3d(${drift}px, ${-drift * 0.85}px, 0) rotate(${
        (index % 2 ? 1 : -1) * 2.5
      }deg) scale(1.05)`,
      opacity: 0,
      filter: 'blur(1.6px)',
    },
  ];
  const options = {
    duration: DURATION,
    delay: index * STEP,
    easing: 'cubic-bezier(.2,.5,.3,1)',
    fill: 'forwards',
  };

  if (!layer.animate) return new Promise((done) => setTimeout(done, DURATION + index * STEP));
  const animation = layer.animate(frames, options);
  // .finished rejects if the animation is cancelled — which is exactly what
  // happens when the element unmounts mid-flight, and is not an error.
  return animation.finished.catch(() => {});
}

// Sends `el`'s current text off as dust, painting the layers into `host`.
// Resolves when the figure is gone and the caller may swap the text.
export function dust(el, host) {
  if (!el || !host) return Promise.resolve();

  const text = el.textContent;
  if (!text || reducedMotion() || !onScreen(el) || inFlight >= MAX_IN_FLIGHT) {
    return Promise.resolve();
  }

  let layers;
  try {
    const prepared = rasterise(el, text);
    if (!prepared) return Promise.resolve();
    layers = deal(prepared);
  } catch {
    // A canvas that won't rasterise (no 2d context, memory pressure) is not
    // worth failing a privacy toggle over.
    return Promise.resolve();
  }

  inFlight += 1;
  host.replaceChildren(...layers);
  el.classList.add('dusting');

  const settle = () => {
    inFlight = Math.max(0, inFlight - 1);
    host.replaceChildren();
    el.classList.remove('dusting');
  };

  return Promise.all(layers.map(fly)).then(settle, settle);
}
