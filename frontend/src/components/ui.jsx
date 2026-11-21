import { useEffect, useRef, useState } from 'react';

/**
 * Table. `head` items are strings; prefix "#" for a right-aligned number column ("#Price").
 * `rows` is an array of <tr> elements.
 */
export function Table({ head, rows, empty = 'Nothing yet.' }) {
  return (
    <div className="sc">
      <table>
        <thead>
          <tr>
            {head.map((h, i) => {
              const n = h.length > 1 && h[0] === '#';
              return <th key={i} className={n ? 'n' : undefined}>{n ? h.slice(1) : h}</th>;
            })}
          </tr>
        </thead>
        <tbody>
          {rows.length ? rows : <tr><td colSpan={head.length} className="mu">{empty}</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

/** Inline message under a form. msg = {text, kind: 'ok'|'err'|undefined} */
export function Msg({ msg }) {
  if (!msg || !msg.text) return null;
  return <div className={'msg' + (msg.kind ? ' ' + msg.kind : '')} role={msg.kind === 'err' ? 'alert' : 'status'}>{msg.text}</div>;
}

export function Loading({ text = 'Loading…' }) {
  return <div className="card loading"><div className="spin" />{text}</div>;
}

/** Button that disables itself and shows `busyText` while its async onClick runs. */
export function BusyButton({ onClick, children, busyText = 'Saving…', className = 'btn', disabled, ...rest }) {
  const [busy, setBusy] = useState(false);
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);
  return (
    <button
      {...rest}
      className={className}
      disabled={busy || disabled}
      onClick={async (e) => {
        setBusy(true);
        try { await onClick(e); } finally { if (alive.current) setBusy(false); }
      }}
    >
      {busy ? busyText : children}
    </button>
  );
}

export function ExportButtons({ onExport }) {
  return (
    <div className="btns" style={{ marginTop: 10 }}>
      <span className="mu">Download:</span>
      <button className="btn g" onClick={() => onExport('xlsx')}>Excel</button>
      <button className="btn g" onClick={() => onExport('csv')}>CSV</button>
    </div>
  );
}

/** Summary after an upload: lines (JSX), skipped rows with reasons, optional error. */
export function UploadResult({ res, onClose }) {
  if (!res) return null;
  const skipped = [...res.skipped].sort((a, b) => a.row - b.row);
  return (
    <>
      <h3>{res.error ? '⚠️ Upload stopped' : '✅ Upload finished'}</h3>
      {res.error && <p className="msg err">{res.error}</p>}
      <ul>{res.lines.map((l, i) => <li key={i}>{l}</li>)}</ul>
      {skipped.length > 0 && (
        <details open={skipped.length <= 10}>
          <summary>{skipped.length} skipped row{skipped.length > 1 ? 's' : ''}: why</summary>
          <Table head={['Row', 'Reason']} rows={skipped.map((s, i) => <tr key={i}><td>{s.row}</td><td>{s.reason}</td></tr>)} />
        </details>
      )}
      <button className="btn g" onClick={onClose}>Close</button>
    </>
  );
}

export function Tag({ kind, children, title }) {
  return <span className={'tag' + (kind ? ' ' + kind : '')} title={title}>{children}</span>;
}
