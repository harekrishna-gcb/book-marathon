import { useEffect, useState } from 'react';
import * as api from '../lib/api.js';
import { downloadRows, leaderboardRows } from '../lib/exportData.js';
import { num, rupees } from '../lib/format.js';
import { ExportButtons, Loading } from './ui.jsx';

const MEDALS = ['🥇', '🥈', '🥉'];

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

  return (
    <>
      <div className="card">
        <h2>🏆 Leaderboard</h2>
        <div className="row">
          <div><label htmlFor="lbm">Rank by</label>
            <select id="lbm" value={by} onChange={(e) => setBy(e.target.value)}>
              <option value="books">Number of books</option><option value="rupees">Rupees (sales amount)</option>
            </select></div>
          <div><label htmlFor="lbt">Show</label>
            <select id="lbt" value={type} onChange={(e) => setType(e.target.value)}>
              <option value="all">Everyone</option><option value="Person">Persons only</option><option value="Team">Teams only</option>
            </select></div>
        </div>
      </div>
      {error && <div className="card"><p className="msg err">{error}</p></div>}
      {!data && !error && <Loading text="Ranking…" />}
      {data && (
        <div className="card">
          {rows.length ? rows.map((x, i) => {
            const main = by === 'books' ? `${num(x.books)} books` : rupees(x.rupees);
            const other = by === 'books' ? rupees(x.rupees) : `${num(x.books)} books`;
            return (
              <div key={x.id} className={'lbrow' + (x.me ? ' me' : '')}>
                <div className="lbhead">
                  <span>{MEDALS[i] || <b>{i + 1}.</b>} <b>{x.name}</b> <span className="mu">{x.type}{x.me ? ' · you' : ''}</span></span>
                  <span><b>{main}</b> <span className="mu">{other}</span></span>
                </div>
                <div className="bar"><div style={{ width: Math.max(2, Math.round((x[by] / max) * 100)) + '%' }} /></div>
              </div>
            );
          }) : <p className="mu">No sales yet. Record sales to see the ranking.</p>}
          <ExportButtons onExport={(t) => (rows.length ? downloadRows(leaderboardRows(rows), 'Leaderboard', ctx.config.campaign_name, t) : ctx.toast('Nothing to download yet.'))} />
        </div>
      )}
    </>
  );
}
