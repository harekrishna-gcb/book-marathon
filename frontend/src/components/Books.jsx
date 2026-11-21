import { useMemo, useRef, useState } from 'react';
import * as api from '../lib/api.js';
import { normalizeBookRows } from '../lib/parse.js';
import { readSpreadsheetFile } from '../lib/readFile.js';
import { planBooks, ranges, norm } from '../lib/plan.js';
import { runChunks, stopMessage } from '../lib/upload.js';
import { downloadRows, bookRows } from '../lib/exportData.js';
import { num, rupees } from '../lib/format.js';
import { BusyButton, CardHead, ExportButtons, Icon, Msg, PageHead, Search, Table, Tag, UploadResult } from './ui.jsx';

const blankForm = { title: '', category: '', price: '', quantity: '' };

export default function Books({ ctx }) {
  const { me, books, apply, toast, config } = ctx;
  const isAdmin = me.role === 'admin';
  const [q, setQ] = useState('');
  const list = useMemo(() => books.filter((b) => `${b.title} ${b.category}`.toLowerCase().includes(q.toLowerCase())), [books, q]);

  const del = async (b) => {
    const ok = await ctx.confirm({
      title: `Delete “${b.title}”?`,
      message: b.sold ? `Its ${b.sold} sold copies (sales entries) will also be deleted. This cannot be undone.` : 'This cannot be undone.',
      confirmText: 'Delete book', danger: true,
    });
    if (!ok) return;
    try {
      const d = await api.call('deleteBook', { id: b.id });
      apply({ books: d.books, sales: ctx.sales.filter((s) => s.book_id !== b.id) });
      toast(`Deleted “${b.title}”` + (d.deletedSales ? ` and ${d.deletedSales} sales` : ''));
    } catch (e) { toast(e.message, true); }
  };

  const [editing, setEditing] = useState(null);
  const [adding, setAdding] = useState(() => !books.length); // form starts open only when there are no books yet
  const [uploading, setUploading] = useState(false);
  const formRef = useRef();

  const available = books.reduce((a, b) => a + b.available, 0);
  return (
    <>
      <PageHead title="Books" sub={`${books.length} title${books.length === 1 ? '' : 's'} · ${num(available)} copies available`}>
        {isAdmin && !uploading && <button className="btn s" onClick={() => setUploading(true)}><Icon name="upload" />Upload list</button>}
        {isAdmin && !editing && !adding && <button className="btn" onClick={() => setAdding(true)}><Icon name="plus" />Add book</button>}
      </PageHead>
      {isAdmin && (editing || adding) && <BookForm key={editing ? editing.id : 'new'} ctx={ctx} book={editing} formRef={formRef} onDone={() => { setEditing(null); setAdding(false); }} />}
      {isAdmin && uploading && <BookUpload ctx={ctx} onClose={() => setUploading(false)} />}
      <div className="card">
        <CardHead icon="list" title={`All books (${books.length})`} />
        <Search placeholder="Search title or category" value={q} onChange={setQ} />
        <Table head={['Title', 'Category', '#Price', '#Stock', '#Sold', '#Available', ...(isAdmin ? [''] : [])]}
          empty={books.length ? `No book matches “${q}”.` : isAdmin ? 'No books yet. Upload a list or add one above.' : 'No books yet. An admin will add them.'}
          rows={list.map((b) => (
            <tr key={b.id}>
              <td>{b.title}</td><td>{b.category}</td><td className="n">{rupees(b.price)}</td><td className="n">{num(b.quantity_received)}</td><td className="n">{num(b.sold)}</td>
              <td className={'n' + (b.low ? ' low' : '')}>{num(b.available)}</td>
              {isAdmin && (
                <td>
                  <button className="btn g" onClick={() => { setEditing(b); setTimeout(() => formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 0); }}>Edit</button>
                  <BusyButton className="btn g danger" busyText="…" onClick={() => del(b)}>Delete</BusyButton>
                </td>
              )}
            </tr>
          ))} />
        <ExportButtons onExport={(type) => (books.length ? downloadRows(bookRows(books), 'Books', config.campaign_name, type) : toast('Nothing to download yet.'))} />
      </div>
    </>
  );
}

function BookForm({ ctx, book, formRef, onDone }) {
  const { books, apply } = ctx;
  const [f, setF] = useState(book ? { title: book.title, category: book.category, price: String(book.price), quantity: String(book.quantity_received) } : blankForm);
  const [msg, setMsg] = useState(null);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const categories = useMemo(() => [...new Map(books.filter((b) => b.category).map((b) => [norm(b.category), b.category])).values()], [books]);

  const save = async () => {
    const err = (text) => setMsg({ text, kind: 'err' });
    const title = f.title.trim();
    if (!title) return err('Title is required.');
    if (f.price !== '' && !(Number(f.price) >= 0)) return err('Price must be 0 or more.');
    if (f.quantity !== '' && !(Number(f.quantity) >= 0 && Number.isInteger(Number(f.quantity)))) return err('Quantity must be a whole number, 0 or more.');
    const existing = !book && books.find((b) => norm(b.title) === norm(title));
    try {
      const list = await api.call('saveBook', { id: book ? book.id : undefined, title, category: f.category.trim(), price: f.price, quantity: f.quantity });
      apply({ books: list });
      setF(blankForm);
      setMsg({ text: (existing ? 'Updated existing book “' : 'Saved “') + title + '” ✓', kind: 'ok' });
      if (book) onDone();
    } catch (e) { err(e.message); }
  };

  return (
    <div className="card" ref={formRef}>
      <CardHead icon={book ? 'book' : 'plus'} title={book ? `Edit “${book.title}”` : 'Add a book'} />
      <div className="row">
        <div className="field"><label htmlFor="bt">Title</label><input id="bt" maxLength={200} value={f.title} onChange={set('title')} autoFocus={!!book} /></div>
        <div className="field"><label htmlFor="bc">Category</label><input id="bc" list="cats" value={f.category} onChange={set('category')} />
          <datalist id="cats">{categories.map((c) => <option key={c} value={c} />)}</datalist></div>
        <div className="field"><label htmlFor="bp">Price (₹)</label><input id="bp" type="number" min="0" step="any" inputMode="decimal" value={f.price} onChange={set('price')} /></div>
        <div className="field"><label htmlFor="bq">Quantity received</label><input id="bq" type="number" min="0" step="1" inputMode="numeric" value={f.quantity} onChange={set('quantity')} /></div>
        <div className="btns">
          <BusyButton onClick={save}>{book ? 'Update book' : 'Save book'}</BusyButton>
          <button className="btn s" onClick={onDone}>{book ? 'Cancel' : 'Close'}</button>
        </div>
      </div>
      <Msg msg={msg} />
    </div>
  );
}

function BookUpload({ ctx, onClose }) {
  const { books, apply } = ctx;
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
      const parsed = normalizeBookRows(await readSpreadsheetFile(file));
      if (!parsed.rows.length && !parsed.blank.length) return setMsg({ text: 'The file has no rows below the header.', kind: 'err' });
      if (parsed.missingColumns.includes('Title')) return setMsg({ text: 'Could not find a Title column. The first row must have headers: Title, Category, Price, Quantity.', kind: 'err' });
      setMsg(null);
      setPreview({ fileName: file.name, parsed, items: planBooks(parsed, books), missing: parsed.missingColumns });
    } catch (err) { setMsg({ text: err.message, kind: 'err' }); }
    finally { if (fileRef.current) fileRef.current.value = ''; }
  };

  const confirm = async () => {
    const res = { added: [], updated: [], skipped: preview.parsed.blank.map((row) => ({ row, reason: 'Title is missing' })) };
    setSaving(true);
    try {
      await runChunks('upsertBooks', preview.parsed.rows, (text) => setMsg({ text }), (d) => {
        res.added.push(...d.added); res.updated.push(...d.updated); res.skipped.push(...d.skipped);
        apply({ books: d.books });
      });
    } catch (e) { res.error = stopMessage(e); }
    const rowsNote = (rows) => (rows.length ? <span className="mu"> (rows {ranges(rows)})</span> : null);
    res.lines = [
      <><b>{res.added.length}</b> added{rowsNote(res.added)}</>,
      <><b>{res.updated.length}</b> updated{rowsNote(res.updated)}</>,
      <><b>{res.skipped.length}</b> skipped{rowsNote(res.skipped.map((s) => s.row))}</>,
    ];
    setSaving(false); setMsg(null); setPreview(null); setResult(res);
  };

  const counts = preview ? preview.items.reduce((c, i) => ({ ...c, [i.action]: c[i.action] + 1 }), { add: 0, update: 0, skip: 0 }) : null;
  const shown = preview ? preview.items.slice(0, 300) : [];

  return (
    <div className="card">
      <CardHead icon="upload" title="Upload book list"><button className="btn g" onClick={onClose} disabled={saving}>Close</button></CardHead>
      <p className="mu">CSV or Excel with columns: <b>Title, Category, Price, Quantity</b></p>
      <input type="file" ref={fileRef} accept=".csv,.xlsx,.xls" onChange={pick} disabled={saving} />
      <Msg msg={msg} />
      {preview && (
        <>
          <h3>Preview: {preview.fileName}</h3>
          {preview.missing.length > 0 && <p className="msg err">Column{preview.missing.length > 1 ? 's' : ''} not found: {preview.missing.join(', ')}. Blank values keep the current value for existing books (0 for new books).</p>}
          <p><Tag kind="good">{counts.add} to add</Tag> <Tag>{counts.update} to update</Tag> <Tag kind="warn">{counts.skip} will be skipped</Tag></p>
          <Table head={['Row', 'Title', 'Category', '#Price', '#Quantity', 'What happens']}
            rows={shown.map((i) => (
              <tr key={i.r.row}><td>{i.r.row}</td><td>{i.r.title}</td><td>{i.r.category}</td><td className="n">{String(i.r.price ?? '')}</td><td className="n">{String(i.r.quantity ?? '')}</td>
                <td>{i.action === 'add' ? <Tag kind="good">Add</Tag> : i.action === 'update' ? <><Tag>Update</Tag> <span className="mu">{i.note}</span></> : <><Tag kind="warn">Skip</Tag> <span className="mu">{i.reason}</span></>}</td></tr>
            ))} />
          {preview.items.length > shown.length && <p className="mu">…and {preview.items.length - shown.length} more rows.</p>}
          <div className="btns" style={{ marginTop: 10 }}>
            <button className="btn" onClick={confirm} disabled={saving || !(counts.add + counts.update)}>{saving ? 'Saving…' : `Confirm upload (${counts.add + counts.update} books)`}</button>
            <button className="btn s" onClick={() => setPreview(null)} disabled={saving}>Cancel</button>
          </div>
        </>
      )}
      <UploadResult res={result} onClose={() => setResult(null)} />
    </div>
  );
}
