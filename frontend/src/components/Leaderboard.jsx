import { useEffect, useState } from 'react';
import * as api from '../lib/api.js';
import { downloadRows, leaderboardRows } from '../lib/exportData.js';
import { num, rupees } from '../lib/format.js';
import { EmptyState, ExportButtons, Loading, PageHead } from './ui.jsx';

const MEDALS = ['🥇', '🥈', '🥉'];

function Seg({ value, options, onChange, label }) {
  return (
    <div className="seg" role="group" aria-label={label}>
      {options.map(([v, text]) => <button key={v} className={value === v ? 'on' : ''} aria-pressed={value === v} onClick={() => onChange(v)}>{text}</button>)}
    </div>
  );
}

export default function Leaderboard({ ctx }) {
  const [by, setBy] = useState('books');
  const [type, setType] = useState('all');
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let live = true;
    setData(null); setError('');
    api.call('leaderboard', { by, type }).then((d) => live && setData(d), (e) => live && setError(e.message));
    return () => { live = false; };
  }, [by, type, ctx.version]);

  const rows = data ? data.rows : [];
  const max = rows.length ? rows[0][by] || 1 : 1;
  const main = (x) => (by === 'books' ? `${num(x.books)} books` : rupees(x.rupees));
  const other = (x) => (by === 'books' ? rupees(x.rupees) : `${num(x.books)} books`);
  const top = rows.slice(0, 3);
  // Podium order: 2nd, 1st, 3rd
  const podium = top.length === 3 ? [top[1], top[0], top[2]] : top;

  return (
    <>
      <PageHead title="Leaderboard" sub="Who has distributed the most books" />
      <div className="btns" style={{ marginBottom: 16 }}>
        <Seg label="Rank by" value={by} onChange={setBy} options={[['books', 'Books'], ['rupees', 'Rupees']]} />
        <Seg label="Show" value={type} onChange={setType} options={[['all', 'Everyone'], ['Person', 'Persons'], ['Team', 'Teams']]} />
      </div>
      {error && <div className="card"><p className="msg err">{error}</p></div>}
      {!data && !error && <Loading text="Ranking…" />}
      {data && (
        <div className="card">
          {!rows.length && <EmptyState emoji="🏆" title="No sales yet">Record sales to see the ranking.</EmptyState>}
          {top.length === 3 && (
            <div className="podium">
              {podium.map((x) => {
                const place = rows.indexOf(x);
                return (
                  <div key={x.id} className={'pod p' + (place + 1)}>
                    <div className="medal">{MEDALS[place]}</div>
                    <div className="pname" title={x.name}>{x.name}{x.me ? ' (you)' : ''}</div>
                    <div className="pval">{main(x)}</div>
                    <div className="pother">{other(x)}</div>
                  </div>
                );
              })}
            </div>
          )}
          {rows.map((x, i) => (
            <div key={x.id} className={'lbrow' + (x.me ? ' me' : '')}>
              <div className="rank">{i < 3 ? MEDALS[i] : i + 1}</div>
              <div className="lbmain">
                <div className="lbhead">
                  <span><b>{x.name}</b> <span className="mu">{x.type}{x.me ? ' · you' : ''}</span></span>
                  <span><b>{main(x)}</b> <span className="mu">{other(x)}</span></span>
                </div>
                <div className="bar"><div style={{ width: Math.max(2, Math.round((x[by] / max) * 100)) + '%' }} /></div>
              </div>
            </div>
          ))}
          {rows.length > 0 && <ExportButtons onExport={(t) => downloadRows(leaderboardRows(rows), 'Leaderboard', ctx.config.campaign_name, t)} />}
        </div>
      )}
    </>
  );
}
