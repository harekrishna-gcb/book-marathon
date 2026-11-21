import { Children, cloneElement, isValidElement, useEffect, useRef, useState } from 'react';

/* ---------- Icons (inline SVG, no extra library) ---------- */
const P = (d) => <path d={d} />;
const ICONS = {
  home: <><rect x="3" y="3" width="7" height="9" rx="1.5" /><rect x="14" y="3" width="7" height="5" rx="1.5" /><rect x="14" y="12" width="7" height="9" rx="1.5" /><rect x="3" y="16" width="7" height="5" rx="1.5" /></>,
  book: <>{P('M2 4h6a4 4 0 0 1 4 4v12a3 3 0 0 0-3-3H2z')}{P('M22 4h-6a4 4 0 0 0-4 4v12a3 3 0 0 1 3-3h7z')}</>,
  bag: <>{P('M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z')}{P('M3 6h18')}{P('M16 10a4 4 0 0 1-8 0')}</>,
  trophy: <>{P('M6 9H4.5a2.5 2.5 0 0 1 0-5H6')}{P('M18 9h1.5a2.5 2.5 0 0 0 0-5H18')}{P('M4 22h16')}{P('M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22')}{P('M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22')}{P('M18 2H6v7a6 6 0 0 0 12 0V2Z')}</>,
  users: <>{P('M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2')}<circle cx="9" cy="7" r="4" />{P('M22 21v-2a4 4 0 0 0-3-3.87')}{P('M16 3.13a4 4 0 0 1 0 7.75')}</>,
  userCheck: <>{P('M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2')}<circle cx="9" cy="7" r="4" />{P('m16 11 2 2 4-4')}</>,
  refresh: <>{P('M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8')}{P('M21 3v5h-5')}{P('M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16')}{P('M8 16H3v5')}</>,
  key: <><circle cx="7.5" cy="15.5" r="5.5" />{P('m21 2-9.6 9.6')}{P('m15.5 7.5 3 3L22 7l-3-3')}</>,
  sun: <><circle cx="12" cy="12" r="4" />{P('M12 2v2')}{P('M12 20v2')}{P('m4.93 4.93 1.41 1.41')}{P('m17.66 17.66 1.41 1.41')}{P('M2 12h2')}{P('M20 12h2')}{P('m6.34 17.66-1.41 1.41')}{P('m19.07 4.93-1.41 1.41')}</>,
  moon: P('M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z'),
  monitor: <><rect x="2" y="3" width="20" height="14" rx="2" />{P('M8 21h8')}{P('M12 17v4')}</>,
  logout: <>{P('M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4')}{P('m16 17 5-5-5-5')}{P('M21 12H9')}</>,
  upload: <>{P('M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4')}{P('m17 8-5-5-5 5')}{P('M12 3v12')}</>,
  download: <>{P('M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4')}{P('m7 10 5 5 5-5')}{P('M12 15V3')}</>,
  plus: <>{P('M5 12h14')}{P('M12 5v14')}</>,
  search: <><circle cx="11" cy="11" r="8" />{P('m21 21-4.3-4.3')}</>,
  box: <>{P('M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z')}{P('M3.3 7 12 12l8.7-5')}{P('M12 22V12')}</>,
  rupee: <>{P('M6 3h12')}{P('M6 8h12')}{P('m6 13 8.5 8')}{P('M6 13h3')}{P('M9 13c6.667 0 6.667-10 0-10')}</>,
  check: <><circle cx="12" cy="12" r="10" />{P('m9 12 2 2 4-4')}</>,
  alert: <>{P('m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3')}{P('M12 9v4')}{P('M12 17h.01')}</>,
  tag: <>{P('M12.586 2.586A2 2 0 0 0 11.172 2H4a2 2 0 0 0-2 2v7.172a2 2 0 0 0 .586 1.414l8.704 8.704a2.426 2.426 0 0 0 3.42 0l6.58-6.58a2.426 2.426 0 0 0 0-3.42z')}<circle cx="7.5" cy="7.5" r="1" /></>,
  pin: <>{P('M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0')}<circle cx="12" cy="10" r="3" /></>,
  calendar: <><rect x="3" y="4" width="18" height="18" rx="2" />{P('M16 2v4')}{P('M8 2v4')}{P('M3 10h18')}</>,
  sliders: <>{P('M4 21v-7')}{P('M4 10V3')}{P('M12 21v-9')}{P('M12 8V3')}{P('M20 21v-5')}{P('M20 12V3')}{P('M2 14h4')}{P('M10 8h4')}{P('M18 16h4')}</>,
  chevron: P('m6 9 6 6 6-6'),
  list: <>{P('M8 6h13')}{P('M8 12h13')}{P('M8 18h13')}{P('M3 6h.01')}{P('M3 12h.01')}{P('M3 18h.01')}</>,
};

export function Icon({ name, className = 'svg', title }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden={title ? undefined : true} role={title ? 'img' : undefined}>
      {title && <title>{title}</title>}
      {ICONS[name]}
    </svg>
  );
}

/**
 * Table that turns into stacked cards on phones.
 * `head` items are strings; prefix "#" for a right-aligned number column ("#Price"); "" = actions column.
 * `rows` is an array of <tr> elements; each <td> automatically gets its column label for the phone view.
 * `titleCol` is the column shown as the card's heading on phones.
 */
export function Table({ head, rows, empty = 'Nothing yet.', titleCol = 0 }) {
  const isNum = head.map((h) => h.length > 1 && h[0] === '#');
  const labels = head.map((h, i) => (isNum[i] ? h.slice(1) : h));
  const decorate = (tr) => {
    if (!isValidElement(tr)) return tr;
    const tds = Children.toArray(tr.props.children).filter(isValidElement);
    return cloneElement(tr, undefined, tds.map((td, i) => cloneElement(td, {
      'data-label': labels[i] ?? '',
      className: [td.props.className, i === titleCol ? 'title' : '', labels[i] === '' ? 'actions' : ''].filter(Boolean).join(' ') || undefined,
    })));
  };
  return (
    <div className="sc rt">
      <table>
        <thead><tr>{labels.map((h, i) => <th key={i} className={isNum[i] ? 'n' : undefined}>{h}</th>)}</tr></thead>
        <tbody>{rows.length ? rows.map(decorate) : <tr><td colSpan={head.length} className="empty">{empty}</td></tr>}</tbody>
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
  return (
    <div className="card">
      <div className="loading"><div className="spin" />{text}</div>
      <div className="skeleton" style={{ width: '80%' }} /><div className="skeleton" style={{ width: '60%' }} /><div className="skeleton" style={{ width: '70%' }} />
    </div>
  );
}

/** Button that disables itself and shows `busyText` while its async onClick runs. */
export function BusyButton({ onClick, children, busyText = 'Saving…', className = 'btn', disabled, ...rest }) {
  const [busy, setBusy] = useState(false);
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);
  return (
    <button {...rest} className={className} disabled={busy || disabled}
      onClick={async (e) => { setBusy(true); try { await onClick(e); } finally { if (alive.current) setBusy(false); } }}>
      {busy ? <><span className="spin" style={{ width: 16, height: 16, borderWidth: 2 }} />{busyText}</> : children}
    </button>
  );
}

export function ExportButtons({ onExport }) {
  return (
    <div className="btns" style={{ marginTop: 14 }}>
      <span className="mu">Download:</span>
      <button className="btn g" onClick={() => onExport('xlsx')}><Icon name="download" /> Excel</button>
      <button className="btn g" onClick={() => onExport('csv')}><Icon name="download" /> CSV</button>
    </div>
  );
}

export function Search({ value, onChange, placeholder }) {
  return (
    <div className="search">
      <Icon name="search" />
      <input type="search" placeholder={placeholder} value={value} onChange={(e) => onChange(e.target.value)} aria-label={placeholder} />
    </div>
  );
}

export function PageHead({ title, sub, children }) {
  return (
    <div className="page-head">
      <div><h1>{title}</h1>{sub && <p>{sub}</p>}</div>
      {children && <div className="btns">{children}</div>}
    </div>
  );
}

export function CardHead({ icon, title, children }) {
  return (
    <div className="card-head">
      <h2>{icon && <Icon name={icon} />}{title}</h2>
      {children}
    </div>
  );
}

export function EmptyState({ emoji = '📭', title, children }) {
  return <div className="empty-state"><div className="big">{emoji}</div><b>{title}</b>{children && <div style={{ marginTop: 6 }}>{children}</div>}</div>;
}

/** Summary after an upload: lines (JSX), skipped rows with reasons, optional error. */
export function UploadResult({ res, onClose }) {
  if (!res) return null;
  const skipped = [...res.skipped].sort((a, b) => a.row - b.row);
  return (
    <div className={'msg' + (res.error ? ' err' : ' ok')} style={{ whiteSpace: 'normal' }}>
      <b>{res.error ? '⚠️ Upload stopped' : '✅ Upload finished'}</b>
      {res.error && <p style={{ margin: '6px 0' }}>{res.error}</p>}
      <ul style={{ margin: '8px 0', color: 'var(--tx)', fontWeight: 400 }}>{res.lines.map((l, i) => <li key={i}>{l}</li>)}</ul>
      {skipped.length > 0 && (
        <details open={skipped.length <= 10}>
          <summary>{skipped.length} skipped row{skipped.length > 1 ? 's' : ''}: why</summary>
          <Table head={['Row', 'Reason']} rows={skipped.map((s, i) => <tr key={i}><td>Row {s.row}</td><td>{s.reason}</td></tr>)} />
        </details>
      )}
      <button className="btn g" onClick={onClose} style={{ marginTop: 8 }}>Close</button>
    </div>
  );
}

export function Tag({ kind, children, title }) {
  return <span className={'tag' + (kind ? ' ' + kind : '')} title={title}>{children}</span>;
}

/** Quantity input with − / + buttons, easier to tap on phones. */
export function Stepper({ id, value, onChange, min = 1 }) {
  const n = Number(value) || 0;
  return (
    <div className="stepper">
      <button type="button" aria-label="Decrease" onClick={() => onChange(String(Math.max(min, n - 1)))}>−</button>
      <input id={id} type="number" min={min} step="1" inputMode="numeric" value={value} onChange={(e) => onChange(e.target.value)} />
      <button type="button" aria-label="Increase" onClick={() => onChange(String(Math.max(min, n + 1)))}>+</button>
    </div>
  );
}

/** Styled confirm dialog. Opened by App's ctx.confirm(); resolves true/false. */
export function ConfirmDialog({ req, onAnswer }) {
  const okRef = useRef();
  useEffect(() => {
    if (!req) return undefined;
    okRef.current?.focus();
    const onKey = (e) => { if (e.key === 'Escape') onAnswer(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [req, onAnswer]);
  if (!req) return null;
  return (
    <div className="overlay" onClick={(e) => e.target === e.currentTarget && onAnswer(false)}>
      <div className="dialog" role="alertdialog" aria-modal="true" aria-labelledby="dlg-t">
        <h2 id="dlg-t">{req.title}</h2>
        {req.message && <p>{req.message}</p>}
        <div className="btns">
          <button className="btn s" onClick={() => onAnswer(false)}>Cancel</button>
          <button ref={okRef} className={'btn' + (req.danger ? ' solid-danger' : '')} onClick={() => onAnswer(true)}>{req.confirmText || 'OK'}</button>
        </div>
      </div>
    </div>
  );
}
