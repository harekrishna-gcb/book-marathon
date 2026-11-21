import { useEffect, useState } from 'react';
import * as api from '../lib/api.js';
import { num, rupees, store } from '../lib/format.js';
import { Loading, Msg, Table } from './ui.jsx';

function Guide({ ctx }) {
  const { me, books, go } = ctx;
  const [hidden, setHidden] = useState(() => store.get('bm.guide.' + me.id, false));
  if (hidden && books.length) return null;
  const steps = me.role === 'admin'
    ? [<><b>Books:</b> upload your book list (CSV or Excel) or add books one by one.</>,
       <><b>Teams &amp; users:</b> approve volunteers who registered, add teams, and make team leaders “lead”.</>,
       <><b>Sales:</b> record each sale, or upload a sales file.</>,
       <>Share this website link with volunteers so they can register and log in with their phone and PIN.</>]
    : me.role === 'lead'
      ? [<><b>Teams &amp; users:</b> add your team members (they can also register themselves).</>,
         <><b>Sales:</b> record sales for yourself and your team. Seller, area and date are remembered for the next entry.</>,
         <><b>🏆 Leaderboard:</b> see how everyone is doing.</>]
      : [<><b>Sales:</b> record each sale you make. Area and date are remembered for the next entry.</>,
         <><b>Books:</b> check how many copies are left.</>,
         <><b>🏆 Leaderboard:</b> see how everyone is doing.</>];
  return (
    <div className="card">
      <h2>👋 Welcome, {me.name}! Start here</h2>
      <ol>{steps.map((s, i) => <li key={i}>{s}</li>)}</ol>
      <div className="btns">
        {me.role === 'admin' && !books.length
          ? <button className="btn" onClick={() => go('books')}>Go to Books →</button>
          : <button className="btn" onClick={() => go('sales')}>Go to Sales →</button>}
        {books.length > 0 && <button className="btn s" onClick={() => { store.set('bm.guide.' + me.id, true); setHidden(true); }}>Got it, hide this</button>}
      </div>
      {!books.length && me.role !== 'admin' && <p className="mu">No books have been added yet. Please ask an admin to add the book list.</p>}
    </div>
  );
}

export default function Dashboard({ ctx }) {
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

  const apply = () => {
    if (from && to && from > to) return setError('“From” date is after the “To” date.');
    setRange({ from, to });
  };
  const filtered = !!(range.from || range.to);

  return (
    <>
      <Guide ctx={ctx} />
      <div className="card">
        <div className="row">
          <div><label htmlFor="df">From</label><input id="df" type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
          <div><label htmlFor="dt">To</label><input id="dt" type="date" value={to} onChange={(e) => setTo(e.target.value)} /></div>
          <div className="btns">
            <button className="btn" onClick={apply}>Apply dates</button>
            {filtered && <button className="btn s" onClick={() => { setFrom(''); setTo(''); setRange({ from: '', to: '' }); }}>All dates</button>}
          </div>
        </div>
        <div className="mu" style={{ marginTop: 6 }}>
          {filtered ? `Sold and amount are for ${range.from || 'the start'} to ${range.to || 'today'}. Stock and available are always current.` : 'Showing all dates.'}
        </div>
        {error && d && <Msg msg={{ text: error, kind: 'err' }} />}
      </div>
      {!d && !error && <Loading text="Calculating totals…" />}
      {!d && error && <div className="card"><p className="msg err">{error}</p><button className="btn" onClick={() => setReload((x) => x + 1)}>Try again</button></div>}
      {d && <Report d={d} filtered={filtered} />}
    </>
  );
}

function Report({ d, filtered }) {
  const t = d.totals;
  const sel = filtered ? ' (selected dates)' : '';
  return (
    <>
      <div className="stats">
        <div className="stat"><b>{num(t.titles)}</b><span>Titles</span></div>
        <div className="stat"><b>{num(t.stock)}</b><span>Total stock received</span></div>
        <div className="stat"><b>{num(t.sold)}</b><span>Sold{sel}</span></div>
        <div className="stat"><b>{rupees(t.amount)}</b><span>Sales amount{sel}</span></div>
        <div className="stat"><b>{num(t.available)}</b><span>Available</span></div>
      </div>
      <div className="card">
        <h2>Stock by book</h2>
        <Table head={['#', 'Book', 'Category', '#In stock', '#Sold', '#Available', ...(filtered ? ['#Sold (dates)'] : [])]} empty="No books yet."
          rows={d.byBook.map((b, i) => (
            <tr key={b.id}><td>{i + 1}</td><td>{b.title}</td><td>{b.category}</td><td className="n">{num(b.quantity_received)}</td><td className="n">{num(b.sold)}</td>
              <td className={'n' + (b.low ? ' low' : '')}><b>{num(b.available)}</b></td>{filtered && <td className="n">{num(b.period_sold)}</td>}</tr>
          ))} />
        <p className="mu">Red = {d.threshold} or fewer copies left.</p>
      </div>
      <div className="card">
        <h2>By category</h2>
        <Table head={['Category', '#Titles', '#Stock', '#Sold', '#Available', ...(filtered ? ['#Sold (dates)'] : [])]}
          rows={d.byCategory.map((c) => (
            <tr key={c.category}><td>{c.category}</td><td className="n">{c.titles}</td><td className="n">{num(c.stock)}</td><td className="n">{num(c.sold)}</td><td className="n">{num(c.available)}</td>{filtered && <td className="n">{num(c.period_sold)}</td>}</tr>
          ))} />
      </div>
      <div className="card">
        <h2>Sold by person / team</h2>
        <Table head={['Name', '#Copies sold', '#Amount']} empty="No sales yet."
          rows={d.bySeller.map((x) => <tr key={x.name}><td>{x.name}</td><td className="n">{num(x.copies)}</td><td className="n">{rupees(x.amount)}</td></tr>)} />
      </div>
      <div className="card">
        <h2>Sold by area</h2>
        <Table head={['Area', '#Copies sold', '#Amount']} empty="No sales yet."
          rows={d.byArea.map((x) => <tr key={x.area}><td>{x.area}</td><td className="n">{num(x.copies)}</td><td className="n">{rupees(x.amount)}</td></tr>)} />
      </div>
    </>
  );
}
