import { useMemo, useRef, useState } from 'react';
import * as api from '../lib/api.js';
import { normalizeSalesRows } from '../lib/parse.js';
import { readSpreadsheetFile } from '../lib/readFile.js';
import { planSales, ranges } from '../lib/plan.js';
import { runChunks, stopMessage } from '../lib/upload.js';
import { downloadRows, saleRows } from '../lib/exportData.js';
import { num, rupees, today, teamOf, store, session } from '../lib/format.js';
import { BusyButton, ExportButtons, Msg, Table, Tag, UploadResult } from './ui.jsx';

/** Who the current user may record sales for (the server enforces the same rule). */
function sellerChoices(me, users) {
  if (me.role === 'admin') return users;
  if (me.role === 'lead') {
    const t = teamOf(me);
    return users.filter((u) => u.id === me.id || (t && teamOf(u) === t));
  }
  return users.filter((u) => u.id === me.id);
}

export default function Sales({ ctx }) {
  const { me } = ctx;
  const [editing, setEditing] = useState(null);
  return (
    <>
      <SaleForm key={editing ? editing.id : 'new'} ctx={ctx} sale={editing} onDone={() => setEditing(null)} />
      {me.role === 'admin' && <SalesUpload ctx={ctx} />}
      <SalesLog ctx={ctx} onEdit={(s) => { setEditing(s); window.scrollTo({ top: 0, behavior: 'smooth' }); }} editingId={editing && editing.id} onDeleted={(id) => editing && editing.id === id && setEditing(null)} />
    </>
  );
}

function SaleForm({ ctx, sale, onDone }) {
  const { me, books, users, areas, apply, go } = ctx;
  const choices = useMemo(() => sellerChoices(me, users), [me, users]);
  const [f, setF] = useState(() => {
    if (sale) return { book_id: sale.book_id, quantity: String(sale.quantity), user_id: sale.user_id, area: sale.area, sale_date: sale.sale_date };
    // Remembered from the previous entry: seller and area (this device), date (this browser session).
    const last = store.get('bm.last.' + me.id, {}) || {};
    const lastBook = store.get('bm.lastBook.' + me.id, '');
    const user = choices.some((u) => u.id === last.u) ? last.u : me.id;
    return { book_id: books.some((b) => b.id === lastBook) ? lastBook : (books[0] ? books[0].id : ''), quantity: '1', user_id: user, area: last.a || '', sale_date: session.get('bm.lastDate') || today() };
  });
  const [msg, setMsg] = useState(null);
  const qtyRef = useRef();
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  if (!books.length) {
    return (
      <div className="card"><h2>Record a sale</h2>
        <p className="mu">No books yet. {me.role === 'admin' ? <>Add books on the <button className="link" onClick={() => go('books')}>Books</button> tab first.</> : 'An admin needs to add the book list first.'}</p>
      </div>
    );
  }

  const leftFor = (b) => b.available + (sale && sale.book_id === b.id ? sale.quantity : 0);

  const save = async () => {
    const err = (text) => setMsg({ text, kind: 'err' });
    const bookId = f.book_id || books[0].id;
    const b = books.find((x) => x.id === bookId), q = Number(f.quantity);
    if (!b) return err('Choose a book.');
    if (!f.user_id) return err('Choose who sold the books.');
    if (!Number.isInteger(q) || q < 1) return err('Enter a valid quantity (a whole number, 1 or more).');
    const left = leftFor(b);
    if (q > left) return err(left > 0 ? `Not enough stock: only ${left} left of “${b.title}”.` : `“${b.title}” is out of stock.`);
    if (f.sale_date && f.sale_date > today()) return err('The date is in the future.');
    try {
      const d = await api.call(sale ? 'updateSale' : 'addSale', { ...f, book_id: bookId, id: sale ? sale.id : undefined, area: f.area.trim() });
      apply(d);
      if (sale) return onDone();
      store.set('bm.last.' + me.id, { u: f.user_id, a: f.area.trim() });
      store.set('bm.lastBook.' + me.id, bookId);
      session.set('bm.lastDate', f.sale_date);
      setF({ ...f, quantity: '1' });
      setMsg({ text: 'Sale recorded ✓ (seller, area and date are kept for your next entry)', kind: 'ok' });
      qtyRef.current?.focus();
    } catch (e) { err(e.message); }
  };

  return (
    <div className="card">
      <h2>{sale ? '✏️ Edit sale' : 'Record a sale'}</h2>
      <div className="row">
        <div><label htmlFor="sb">Book</label>
          <select id="sb" value={f.book_id || books[0].id} onChange={set('book_id')}>
            {books.map((b) => { const left = leftFor(b); return <option key={b.id} value={b.id}>{b.title} ({left > 0 ? `${left} left` : 'out of stock'})</option>; })}
          </select></div>
        <div><label htmlFor="sq">Quantity</label><input id="sq" ref={qtyRef} type="number" min="1" step="1" inputMode="numeric" value={f.quantity} onChange={set('quantity')} /></div>
        <div><label htmlFor="su">Sold by</label>
          {choices.length > 1
            ? <select id="su" value={f.user_id} onChange={set('user_id')}>{choices.map((u) => <option key={u.id} value={u.id}>{u.name} ({u.type}{u.approved ? '' : ', pending'})</option>)}</select>
            : <input id="su" value={me.name} disabled />}
        </div>
        <div><label htmlFor="sa">Area</label><input id="sa" list="areas" maxLength={100} placeholder="e.g. Banjara Hills" value={f.area} onChange={set('area')} />
          <datalist id="areas">{areas.map((a) => <option key={a} value={a} />)}</datalist></div>
        <div><label htmlFor="sd">Date</label><input id="sd" type="date" max={today()} value={f.sale_date} onChange={set('sale_date')} /></div>
        <div className="btns">
          <BusyButton onClick={save}>{sale ? 'Update sale' : 'Add sale'}</BusyButton>
          {sale && <button className="btn s" onClick={onDone}>Cancel</button>}
        </div>
      </div>
      <Msg msg={msg} />
    </div>
  );
}

function SalesLog({ ctx, onEdit, onDeleted }) {
  const { me, sales, apply, toast, config } = ctx;
  const [q, setQ] = useState('');
  const [show, setShow] = useState(200);
  const list = useMemo(() => sales.filter((s) => `${s.book_title} ${s.user_name} ${s.area} ${s.sale_date}`.toLowerCase().includes(q.toLowerCase())), [sales, q]);
  const copies = list.reduce((a, s) => a + s.quantity, 0), amount = list.reduce((a, s) => a + s.amount, 0);

  const del = async (s) => {
    if (!window.confirm(`Delete this sale?\n\n${s.sale_date} · ${s.quantity} × ${s.book_title} · ${s.user_name}`)) return;
    try { apply(await api.call('deleteSale', { id: s.id })); onDeleted(s.id); toast('Sale deleted'); } catch (e) { toast(e.message, true); }
  };

  const scope = me.role === 'admin' ? '' : me.role === 'lead' ? ' — your team' : ' — your sales';
  return (
    <div className="card">
      <h2>Sales log{scope}</h2>
      <input placeholder="🔍 Search book, seller, area or date" value={q} onChange={(e) => { setQ(e.target.value); setShow(200); }} style={{ marginBottom: 6 }} />
      <p className="mu">{num(list.length)} entr{list.length === 1 ? 'y' : 'ies'} · {num(copies)} copies · {rupees(amount)}</p>
      <Table head={['Date', 'Book', '#Qty', '#Amount', 'Sold by', 'Area', '']}
        empty={sales.length ? `No sale matches “${q}”.` : 'No sales recorded yet. Add your first sale above.'}
        rows={list.slice(0, show).map((s) => (
          <tr key={s.id}>
            <td style={{ whiteSpace: 'nowrap' }}>{s.sale_date}</td><td>{s.book_title}</td><td className="n">{s.quantity}</td><td className="n">{rupees(s.amount)}</td><td>{s.user_name}</td><td>{s.area}</td>
            <td style={{ whiteSpace: 'nowrap' }}>
              <button className="btn g" onClick={() => onEdit(s)}>Edit</button>{' '}
              <BusyButton className="btn g danger" busyText="…" onClick={() => del(s)}>Delete</BusyButton>
            </td>
          </tr>
        ))} />
      {list.length > show && <div className="btns" style={{ marginTop: 8 }}><button className="btn s" onClick={() => setShow(show + 500)}>Show more ({list.length - show} left)</button></div>}
      <ExportButtons onExport={(type) => (sales.length ? downloadRows(saleRows(sales), 'Sales', config.campaign_name, type) : toast('Nothing to download yet.'))} />
    </div>
  );
}

function SalesUpload({ ctx }) {
  const { books, users, apply } = ctx;
  const [msg, setMsg] = useState(null);
  const [preview, setPreview] = useState(null);
  const [result, setResult] = useState(null);
  const [saving, setSaving] = useState(false);
  const fileRef = useRef();

  const pick = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setResult(null); setPreview(null);
    setMsg({ text: `Reading ${file.name}…` });
    try {
      const parsed = normalizeSalesRows(await readSpreadsheetFile(file));
      if (!parsed.rows.length && !parsed.invalid.length) return setMsg({ text: 'The file has no rows below the header.', kind: 'err' });
      const plan = planSales(parsed, books, users);
      setMsg(null);
      setPreview({ fileName: file.name, parsed, items: plan.items, newSellers: plan.newSellers, missing: parsed.missingColumns });
    } catch (err) { setMsg({ text: err.message, kind: 'err' }); }
    finally { if (fileRef.current) fileRef.current.value = ''; }
  };

  const confirm = async () => {
    const res = { imported: [], skipped: [...preview.parsed.invalid], newSellers: [] };
    setSaving(true);
    try {
      // Every parsed row is sent: the server re-checks books, sellers and stock and reports what it skips.
      await runChunks('uploadSales', preview.parsed.rows, (text) => setMsg({ text }), (d) => {
        res.imported.push(...d.imported); res.skipped.push(...d.skipped); res.newSellers.push(...d.newSellers);
        apply(d);
      });
      if (res.newSellers.length) apply({ users: await api.call('listUsers') });
    } catch (e) { res.error = stopMessage(e); }
    const total = preview.parsed.rows.length + preview.parsed.invalid.length;
    const rowsNote = (rows) => (rows.length ? <span className="mu"> (rows {ranges(rows)})</span> : null);
    res.lines = [
      <>Imported <b>{res.imported.length}</b> of {total} rows{rowsNote(res.imported)}</>,
      <><b>{res.skipped.length}</b> skipped{rowsNote(res.skipped.map((s) => s.row))}</>,
    ];
    if (res.newSellers.length) res.lines.push(<><b>{res.newSellers.length}</b> new seller{res.newSellers.length > 1 ? 's' : ''} added as pending: {res.newSellers.join(', ')}</>);
    setSaving(false); setMsg(null); setPreview(null); setResult(res);
  };

  const good = preview ? preview.items.filter((i) => i.ok).length : 0;
  const shown = preview ? preview.items.slice(0, 300) : [];

  return (
    <div className="card">
      <h2>Upload sales (CSV or Excel)</h2>
      <p className="mu">Columns: <b>Book</b> (title), <b>Quantity</b>, <b>Sold By</b> (person/team name), <b>Area</b>, <b>Date</b>. Books must already be in the list. Unknown sellers are added as pending persons. Rows with an unknown book, a bad quantity or date, a missing seller, or not enough stock are skipped and listed. Text dates are read day-first (05/11/2026 = 5 Nov); a blank date means today.</p>
      <input type="file" ref={fileRef} accept=".csv,.xlsx,.xls" onChange={pick} disabled={saving} />
      <Msg msg={msg} />
      {preview && (
        <>
          <h3>Preview: {preview.fileName}</h3>
          {preview.missing.length > 0 && <p className="msg err">Column{preview.missing.length > 1 ? 's' : ''} not found: {preview.missing.join(', ')}. Check the header row of your file.</p>}
          <p><Tag kind="good">{good} to import</Tag> <Tag kind="warn">{preview.items.length - good} will be skipped</Tag>{preview.newSellers > 0 && <> <Tag>{preview.newSellers} new seller{preview.newSellers > 1 ? 's' : ''}</Tag></>}</p>
          <Table head={['Row', 'Date', 'Book', '#Qty', 'Sold by', 'Area', 'What happens']}
            rows={shown.map((i) => (
              <tr key={i.r.row}><td>{i.r.row}</td><td>{i.r.date || (i.ok ? 'today' : '')}</td><td>{i.title}</td><td className="n">{String(i.r.quantity ?? '')}</td><td>{i.r.soldBy}</td><td>{i.r.area}</td>
                <td>{i.ok ? <><Tag kind="good">Import</Tag> <span className="mu">{i.note}</span></> : <><Tag kind="warn">Skip</Tag> <span className="mu">{i.reason}</span></>}</td></tr>
            ))} />
          {preview.items.length > shown.length && <p className="mu">…and {preview.items.length - shown.length} more rows.</p>}
          <p className="mu">Stock is checked again when saving, in case someone else records a sale meanwhile.</p>
          <div className="btns">
            <button className="btn" onClick={confirm} disabled={saving || !good}>{saving ? 'Saving…' : `Confirm upload (${good} sales)`}</button>
            <button className="btn s" onClick={() => setPreview(null)} disabled={saving}>Cancel</button>
          </div>
        </>
      )}
      <UploadResult res={result} onClose={() => setResult(null)} />
    </div>
  );
}
