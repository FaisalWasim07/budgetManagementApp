import { useRef, useState } from 'react';
import Modal from './Modal';
import { readPdf, PdfPasswordError, WRONG_PASSWORD } from '../utils/pdfText';

// Reading a statement, and nothing more than reading it. Nothing here is saved:
// no row, no file, no table. Close the dialog and the statement is gone, which
// is the whole arrangement — this looks at money without ever being able to
// change the record of it.
//
// The file is opened in this browser rather than posted anywhere, so a
// password-protected statement never has to hand over its password to be read.

const isPdf = (file) => file.type === 'application/pdf' || /\.pdf$/i.test(file.name);

export default function StatementScanner({ onClose }) {
  const [file, setFile] = useState(null);
  const [bytes, setBytes] = useState(null);
  const [password, setPassword] = useState('');
  // Set when the file turned out to be locked. Holds the reason, so a first
  // ask and a refused attempt do not read the same.
  const [locked, setLocked] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);
  const passwordRef = useRef(null);

  function reset() {
    setFile(null);
    setBytes(null);
    setPassword('');
    setLocked(null);
    setError(null);
    setResult(null);
  }

  async function read(chosen, raw, tryPassword) {
    setBusy(true);
    setError(null);
    try {
      if (isPdf(chosen)) {
        setResult(await readPdf(raw, tryPassword || undefined));
      } else {
        // CSV and anything else with a text body needs none of the above.
        const text = new TextDecoder().decode(raw).trim();
        setResult({ text, pageCount: null, hasText: text.length > 0 });
      }
      setLocked(null);
    } catch (err) {
      if (err instanceof PdfPasswordError) {
        setLocked(err.kind);
        setResult(null);
        // Focus the box rather than leaving it to be found: at this point the
        // only thing to do is type a password.
        setTimeout(() => passwordRef.current?.focus(), 0);
      } else {
        setError(err.message || 'That file could not be read.');
      }
    }
    setBusy(false);
  }

  async function pick(e) {
    const chosen = e.target.files?.[0];
    if (!chosen) return;
    reset();
    setFile(chosen);
    const raw = new Uint8Array(await chosen.arrayBuffer());
    setBytes(raw);
    await read(chosen, raw, '');
  }

  function unlock(e) {
    e.preventDefault();
    if (file && bytes) read(file, bytes, password);
  }

  return (
    <Modal title="Scan a statement" onClose={onClose} className="scanner">
      <div className="stack-sm">
        <span className="muted" style={{ fontSize: '0.85rem' }}>
          Read here in your browser. The file is not uploaded and nothing is saved — close
          this and it is gone.
        </span>
      </div>

      <label className="field">
        Statement
        <input type="file" accept=".pdf,.csv,application/pdf,text/csv" onChange={pick} />
      </label>

      {locked && (
        <form className="stack-sm" onSubmit={unlock}>
          <label className="field">
            Password
            <input
              type="password"
              ref={passwordRef}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="off"
              required
            />
            <span className="muted">
              {locked === WRONG_PASSWORD
                ? 'That one did not open it. Banks often use a date of birth with part of a card number.'
                : 'This statement is locked. The password stays in this browser — it is not sent anywhere.'}
            </span>
          </label>
          <button type="submit" className="primary" disabled={busy || !password}>
            {busy ? 'Opening…' : 'Open it'}
          </button>
        </form>
      )}

      {busy && !locked && <span className="muted">Reading…</span>}

      {error && <div className="error-text">{error}</div>}

      {result && !result.hasText && (
        <div className="warn-banner">
          Opened it, but there is no text in it — these pages are pictures rather than
          words. Reading those needs a different approach.
        </div>
      )}

      {result && result.hasText && (
        <div className="stack-sm">
          <span className="muted" style={{ fontSize: '0.85rem' }}>
            {file?.name}
            {result.pageCount ? ` · ${result.pageCount} page${result.pageCount === 1 ? '' : 's'}` : ''}
            {` · ${result.text.split('\n').length} lines`}
          </span>
          <pre className="scan-preview">{result.text}</pre>
        </div>
      )}
    </Modal>
  );
}
