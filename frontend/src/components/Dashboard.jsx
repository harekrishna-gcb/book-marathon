import { useEffect, useState } from 'react';
import * as api from '../lib/api.js';
import { num, rupees, today } from '../lib/format.js';
import { CardHead, EmptyState, Icon, Loading, Msg, PageHead, Table } from './ui.jsx';

function daysAgo(n) {
  const d = new Date(Date.now() - n * 864e5);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
const PRESETS = [
  { key: 'all', label: 'All time', range: () => ({ from: '', to: '' }) },
  { key: 'today', label: 'Today', range: () => ({ from: today(), to: today() }) },
  { key: '7', label: 'Last 7 days', range: () => ({ from: daysAgo(6), to: today() }) },
  { key: '30', label: 'Last 30 days', range: () => ({ from: daysAgo(29), to: today() }) },
  { key: 'custom', label: 'Custom…' },
];

/** Shown only before any book exists: one clear next step instead of a guide. */
function NoBooks({ ctx }) {
  const isAdmin = ctx.me.role === 'admin';
  return (
    <div className="card">
      <EmptyState emoji="📚" title={isAdmin ? 'Add your first book' : 'No books yet'}>
        {isAdmin ? <button className="btn" style={{ marginTop: 10 }} onClick={() => ctx.go('books')}><Icon name="plus" />Add books</button> : 'An admin will add the book list soon.'}
      </EmptyState>
    </div>
  );
}

export default function Dashboard({ ctx }) {
  const [preset, setPreset] = useState('all');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [range, setRange] = useState({ from: '', to: '' });
  const [d, setD] = useState(null);
  const [error, setError] = useState(null);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let live = true;
    setD(null); setError(null);
    api.call('dashboard', range).then((r) => live && setD(r), (e) => live && setError(e.message));
    return () => { live = false; };
  }, [range, ctx.version, reload]);

  const choose = (p) => {
    setPreset(p.key);
    if (p.range) setRange(p.range());
  };
  const applyCustom = () => {
    if (from && to && from > to) return setError('“From” date is after the “To” date.');
    setRange({ from, to });
  };
  const filtered = !!(range.from || range.to);

  return (
    <>
      <PageHead title="Dashboard" sub={filtered ? `${range.from || 'Start'} – ${range.to || 'today'}` : undefined}>
        <button className="btn" onClick={() => ctx.go('sales')}><Icon name="plus" />Record a sale</button>
      </PageHead>
      {!ctx.books.length && <NoBooks ctx={ctx} />}
      <div className="chips" role="group" aria-label="Date range">
        {PRESETS.map((p) => <button key={p.key} className={'chip' + (preset === p.key ? ' on' : '')} onClick={() => choose(p)}>{p.label}</button>)}
      </div>
      {preset === 'custom' && (
        <div className="card">
          <div className="row">
            <div className="field"><label htmlFor="df">From</label><input id="df" type="date" value={from} max={today()} onChange={(e) => setFrom(e.target.value)} /></div>
            <div className="field"><label htmlFor="dt">To</label><input id="dt" type="date" value={to} max={today()} onChange={(e) => setTo(e.target.value)} /></div>
            <button className="btn" onClick={applyCustom}>Apply dates</button>
          </div>
          {error && d && <Msg msg={{ text: error, kind: 'err' }} />}
        </div>
      )}
      {!d && !error && <Loading text="Calculating totals…" />}
      {!d && error && <div className="card"><p className="msg err">{error}</p><button className="btn" onClick={() => setReload((x) => x + 1)}><Icon name="refresh" />Try again</button></div>}
      {d && <Report d={d} filtered={filtered} go={ctx.go} />}
    </>
  );
}

function Stat({ icon, value, label, hero }) {
  return (
    <div className={'stat' + (hero ? ' hero' : '')}>
      <div className="stat-icon"><Icon name={icon} /></div>
      <b>{value}</b><span>{label}</span>
    </div>
  );
}

function Report({ d, filtered, go }) {
  const t = d.totals;
  const sel = filtered ? ' (selected dates)' : '';
  const low = d.byBook.filter((b) => b.low);
  return (
    <>
      <div className="stats">
        <Stat hero icon="rupee" value={rupees(t.amount)} label={'Sales amount' + sel} />
        <Stat icon="bag" value={num(t.sold)} label={'Copies sold' + sel} />
        <Stat icon="box" value={num(t.available)} label="Available now" />
        <Stat icon="book" value={num(t.titles)} label="Titles" />
        <Stat icon="download" value={num(t.stock)} label="Total stock received" />
      </div>
      {low.length > 0 && (
        <div className="alert" role="status">
          <Icon name="alert" />
          <div>
            <b>Running low:</b>{' '}
            {low.slice(0, 6).map((b) => `${b.title} (${b.available})`).join(', ')}{low.length > 6 ? ` and ${low.length - 6} more` : ''}.{' '}
            <button className="link" onClick={() => go('books')}>See books</button>
          </div>
        </div>
      )}
      <div className="card">
        <CardHead icon="box" title="Stock by book" />
        <Table head={['#', 'Book', 'Category', '#In stock', '#Sold', '#Available', ...(filtered ? ['#Sold (dates)'] : [])]} titleCol={1} empty="No books yet."
          rows={d.byBook.map((b, i) => (
            <tr key={b.id}><td>{i + 1}</td><td>{b.title}</td><td>{b.category}</td><td className="n">{num(b.quantity_received)}</td><td className="n">{num(b.sold)}</td>
              <td className={'n' + (b.low ? ' low' : '')}>{num(b.available)}</td>{filtered && <td className="n">{num(b.period_sold)}</td>}</tr>
          ))} />
      </div>
      <div className="grid-2">
        <div className="card">
          <CardHead icon="users" title="Sold by person / team" />
          <Table head={['Name', '#Copies', '#Amount']} empty="No sales yet."
            rows={d.bySeller.map((x) => <tr key={x.name}><td>{x.name}</td><td className="n">{num(x.copies)}</td><td className="n">{rupees(x.amount)}</td></tr>)} />
        </div>
        <div className="card">
          <CardHead icon="pin" title="Sold by area" />
          <Table head={['Area', '#Copies', '#Amount']} empty="No sales yet."
            rows={d.byArea.map((x) => <tr key={x.area}><td>{x.area}</td><td className="n">{num(x.copies)}</td><td className="n">{rupees(x.amount)}</td></tr>)} />
        </div>
      </div>
      <div className="card">
        <CardHead icon="tag" title="By category" />
        <Table head={['Category', '#Titles', '#Stock', '#Sold', '#Available', ...(filtered ? ['#Sold (dates)'] : [])]}
          rows={d.byCategory.map((c) => (
            <tr key={c.category}><td>{c.category}</td><td className="n">{c.titles}</td><td className="n">{num(c.stock)}</td><td className="n">{num(c.sold)}</td><td className="n">{num(c.available)}</td>{filtered && <td className="n">{num(c.period_sold)}</td>}</tr>
          ))} />
      </div>
    </>
  );
}
