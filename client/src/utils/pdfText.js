// The legacy build, deliberately. The modern one calls
// Map.prototype.getOrInsertComputed — a 2025 addition that browsers only a
// version or two old do not have, and it is reached while decrypting, so a
// password-protected statement fails on a phone that opens every other PDF
// fine. The legacy build ships a polyfill for it. This file is loaded on
// demand, so its extra weight is paid only by someone actually scanning.
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';

// The whole point of doing this in the browser: a bank statement and the
// password that opens it are the two most sensitive things in this app, and
// neither has any reason to cross the network. The file is opened here, the
// text is pulled out here, and only that text is ever sent anywhere.
pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

// pdf.js reads a page's text by iterating a ReadableStream with `for await`,
// and Safari only learned to do that in 17.4. On an older iPhone the stream has
// no async iterator, so the loop calls undefined and the read dies with
// "undefined is not a function" the moment a PDF is picked — on a phone that
// opens every other page in the app perfectly.
//
// The reader underneath already has the shape an async iterator needs: read()
// resolves to {value, done}. So this is a handful of lines rather than a
// dependency, and it installs only where it is missing.
if (typeof ReadableStream !== 'undefined' && !ReadableStream.prototype[Symbol.asyncIterator]) {
  ReadableStream.prototype[Symbol.asyncIterator] = function asyncIterator() {
    const reader = this.getReader();
    return {
      next: () => reader.read(),
      // Called when the loop is left early — by a break, or by something
      // throwing further in. Without it the reader stays locked and the stream
      // can never be read again.
      return(value) {
        reader.releaseLock();
        return Promise.resolve({ done: true, value });
      },
      [Symbol.asyncIterator]() {
        return this;
      },
    };
  };
}

// pdf.js reports "you need a password" and "that password is wrong" as the same
// exception with different codes. They are different questions to the person
// holding the file, so they are different answers here.
export const NEEDS_PASSWORD = 'needs-password';
export const WRONG_PASSWORD = 'wrong-password';

export class PdfPasswordError extends Error {
  constructor(kind) {
    super(kind === WRONG_PASSWORD ? 'That password did not open it.' : 'This PDF needs a password.');
    this.kind = kind;
  }
}

// Items on a line share a y, near enough. Bank statements set rows a few units
// apart, so the tolerance has to be small enough not to weld two rows together
// and large enough to survive a font that sits fractionally off the baseline.
const SAME_LINE = 2;

// A gap this wide between two items was a column, not a word space. Preserving
// it keeps a date, a description and an amount from reading as one sentence.
const COLUMN_GAP = 8;

// pdf.js hands back positioned fragments, not lines — a statement arrives as a
// few hundred pieces in no useful order. Reading order has to be rebuilt from
// the coordinates, or the text is soup: every date in one run, every amount in
// another, nothing beside the row it belongs to.
function linesFromItems(items) {
  const rows = [];

  for (const item of items) {
    const text = item.str;
    if (!text || !text.trim()) continue;
    // transform is [a, b, c, d, x, y]; the last two are where it sits.
    const x = item.transform[4];
    const y = item.transform[5];

    const row = rows.find((r) => Math.abs(r.y - y) <= SAME_LINE);
    if (row) row.items.push({ x, text, width: item.width ?? 0 });
    else rows.push({ y, items: [{ x, text, width: item.width ?? 0 }] });
  }

  // PDF coordinates start at the bottom of the page, so descending y is top to
  // bottom — the order a person reads in.
  rows.sort((a, b) => b.y - a.y);

  return rows.map((row) => {
    row.items.sort((a, b) => a.x - b.x);
    let line = '';
    let cursor = null;
    for (const item of row.items) {
      if (cursor !== null) line += item.x - cursor > COLUMN_GAP ? '   ' : ' ';
      line += item.text;
      cursor = item.x + item.width;
    }
    return line.trim();
  });
}

// Every attempt gets its own copy of the bytes. pdf.js takes ownership of the
// buffer it is given and detaches it, so retrying with a password against the
// same array reads as an empty file — which looks exactly like a corrupt PDF
// and is nothing of the sort.
const copyOf = (bytes) => bytes.slice(0);

// Returns the loading task rather than the document: closing the file down
// afterwards is the task's job, not the document's — the document proxy has no
// destroy of its own, and calling one on it fails at the very end, after all
// the work, which is the worst place to find out.
async function open(bytes, password) {
  const task = pdfjs.getDocument({ data: copyOf(bytes), password });
  try {
    const doc = await task.promise;
    return { task, doc };
  } catch (err) {
    await task.destroy().catch(() => {});
    if (err?.name === 'PasswordException') {
      throw new PdfPasswordError(
        err.code === pdfjs.PasswordResponses.INCORRECT_PASSWORD ? WRONG_PASSWORD : NEEDS_PASSWORD
      );
    }
    throw err;
  }
}

// Rendered pages are sized by width rather than by a fixed zoom, so a statement
// printed on A4 and one printed on Letter come out the same size — and neither
// can produce an image far larger than it needs to be.
const IMAGE_WIDTH = 1400;

// Enough for any statement, and a floor under how much a mistaken upload can
// cost: rendering a 300-page document to images would take the tab down.
const MAX_RENDERED = 20;

async function renderPage(page) {
  const unscaled = page.getViewport({ scale: 1 });
  const viewport = page.getViewport({ scale: Math.min(IMAGE_WIDTH / unscaled.width, 3) });

  const canvas = document.createElement('canvas');
  canvas.width = Math.floor(viewport.width);
  canvas.height = Math.floor(viewport.height);
  const canvasContext = canvas.getContext('2d');
  // White behind it: a scanned page is usually white, and a PDF that declares
  // no background renders onto transparency, which becomes black in a JPEG.
  canvasContext.fillStyle = '#ffffff';
  canvasContext.fillRect(0, 0, canvas.width, canvas.height);

  await page.render({ canvas, canvasContext, viewport }).promise;
  // JPEG rather than PNG: a photographed page is a photograph, and the PNG of
  // one is several times the size for nothing a reader or a model would notice.
  return canvas.toDataURL('image/jpeg', 0.85);
}

// `bytes` is a Uint8Array of the whole file.
//
// Text and pictures are decided per page, not per document. A statement is
// quite often both — a covering page laid out as text, the transactions
// themselves scanned in — and treating the whole file as one or the other
// throws away half of what it has.
//
// A page with no text is rendered to an image instead, which is what will be
// read later. It is shown as a picture rather than hidden, so a page that
// cannot be turned into words is at least visibly there.
export async function readPdf(bytes, password) {
  const { task, doc } = await open(bytes, password);
  const pageCount = doc.numPages;
  const pages = [];

  try {
    for (let n = 1; n <= pageCount; n += 1) {
      const page = await doc.getPage(n);
      const content = await page.getTextContent();
      const text = linesFromItems(content.items).join('\n').trim();

      const picture = !text && pages.filter((p) => p.image).length < MAX_RENDERED;
      pages.push({ n, text, image: picture ? await renderPage(page) : null });

      // Released as it goes rather than at the end, so a long statement does
      // not hold every page's rendering in memory at once.
      page.cleanup();
    }
  } finally {
    // Even if a page throws: the worker and the bytes behind it should not
    // outlive the read, and this is the only thing holding the statement.
    await task.destroy().catch(() => {});
  }

  const text = pages
    .map((p) => p.text)
    .filter(Boolean)
    .join('\n\n')
    .trim();

  return {
    pageCount,
    pages,
    text,
    hasText: text.length > 0,
    imageCount: pages.filter((p) => p.image).length,
  };
}
