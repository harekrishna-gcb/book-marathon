/*
 * App.jsx — the shell: login state, data loaded from the API, header, tabs.
 * Same screens as the prototype (Dashboard, Books, Sales, Leaderboard, Teams & users),
 * now backed by the Apps Script API with logins and roles.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import * as api from './lib/api.js';
import { Loading } from './components/ui.jsx';
import { Login, Register, NotConfigured, ChangePin } from './components/Auth.jsx';
import Dashboard from './components/Dashboard.jsx';
import Books from './components/Books.jsx';
import Sales from './components/Sales.jsx';
import Leaderboard from './components/Leaderboard.jsx';
import Users from './components/Users.jsx';

const TABS = { dash: 'Dashboard', books: 'Books', sales: 'Sales', lb: '🏆 Leaderboard', users: 'Teams & users' };
const DEFAULT_CONFIG = { campaign_name: 'Book Marathon', low_stock_threshold: 5 };
const EMPTY = { books: [], users: [], sales: [], areas: [] };

function useTheme() {
  const [theme, setTheme] = useState(() => document.documentElement.getAttribute('data-theme') || 'auto');
  const cycle = () => {
    const next = theme === 'light' ? 'dark' : theme === 'dark' ? 'auto' : 'light';
    if (next === 'auto') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', next);
    try { if (next === 'auto') localStorage.removeItem('bm.theme'); else localStorage.setItem('bm.theme', next); } catch { /* ignore */ }
    setTheme(next);
  };
  return [theme === 'dark' ? '🌙 Dark' : theme === 'light' ? '☀️ Light' : '🌓 Auto', cycle];
}

function Toast({ toast }) {
  if (!toast) return null;
  return <div className={'toast' + (toast.err ? ' err' : '')} role="status" aria-live="polite">{toast.text}</div>;
}

export default function App() {
  const configured = api.isConfigured();
  const [me, setMe] = useState(null);
  const [config, setConfig] = useState(DEFAULT_CONFIG);
  const [data, setData] = useState(EMPTY);
  const [booting, setBooting] = useState(configured && api.hasSession());
  const [loadError, setLoadError] = useState('');
  const [tab, setTab] = useState('dash');
  const [authView, setAuthView] = useState('login');
  const [authMsg, setAuthMsg] = useState(null);
  const [showPin, setShowPin] = useState(false);
  const [version, setVersion] = useState(0); // bumps after every change, so reports reload
  const [toast, setToastState] = useState(null);
  const [themeLabel, cycleTheme] = useTheme();
  const loadedAt = useRef(0);
  const toastTimer = useRef();

  const showToast = useCallback((text, err = false) => {
    setToastState({ text, err });
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToastState(null), err ? 6000 : 3000);
  }, []);

  /** Merges whatever lists an API response contains into state. */
  const apply = useCallback((d) => {
    if (!d) return;
    if (d.me) setMe(d.me);
    if (d.config) setConfig(d.config);
    setData((cur) => ({
      books: d.books || cur.books, users: d.users || cur.users,
      sales: d.sales || cur.sales, areas: d.areas || cur.areas,
    }));
    setVersion((v) => v + 1);
  }, []);

  const bootstrap = useCallback(async (silent) => {
    try {
      const d = await api.call('bootstrap');
      apply(d);
      loadedAt.current = Date.now();
      setLoadError('');
    } catch (e) {
      if (e.code === 'AUTH') return; // the login screen is already showing
      if (silent) showToast(e.message, true); else setLoadError(e.message);
    } finally {
      setBooting(false);
    }
  }, [apply, showToast]);

  useEffect(() => {
    api.setOnAuthLost((message) => {
      setMe(null); setData(EMPTY); setAuthView('login');
      setAuthMsg({ text: message || 'Please log in again.', kind: 'err' });
    });
    if (!configured) return;
    api.call('getConfig').then(setConfig, () => {});
    if (api.hasSession()) bootstrap(false);
  }, [configured, bootstrap]);

  useEffect(() => { document.title = config.campaign_name || 'Book Marathon'; }, [config.campaign_name]);

  const go = (t) => {
    setTab(t); setShowPin(false);
    window.scrollTo(0, 0);
    if (Date.now() - loadedAt.current > 60000) bootstrap(true); // quietly pick up other people's changes
  };

  const onLoggedIn = (d) => { setMe(d.me); setAuthMsg(null); setTab('dash'); setBooting(true); bootstrap(false); };
  const logout = () => { api.logout(); setMe(null); setData(EMPTY); setAuthView('login'); setAuthMsg(null); };
  const refresh = async () => { await bootstrap(true); showToast('Up to date ✓'); };

  const loggedIn = !!me || booting;
  const pending = data.users.filter((u) => !u.approved).length;
  const canSeePending = me && (me.role === 'admin' || me.role === 'lead');
  const ctx = { me, config, setConfig, ...data, apply, toast: showToast, version, go };

  let body;
  if (!configured) body = <NotConfigured />;
  else if (!loggedIn) {
    body = authView === 'register'
      ? <Register onDone={(text) => { setAuthView('login'); setAuthMsg({ text, kind: 'ok' }); }} onBack={() => { setAuthView('login'); setAuthMsg(null); }} />
      : <Login msg={authMsg} onLoggedIn={onLoggedIn} onRegister={() => { setAuthView('register'); setAuthMsg(null); }} />;
  } else if (booting || !me) body = <Loading />;
  else if (loadError) {
    body = (
      <div className="card"><h2>Could not load data</h2><p className="msg err">{loadError}</p>
        <button className="btn" onClick={() => { setBooting(true); bootstrap(false); }}>Try again</button></div>
    );
  } else {
    const View = { dash: Dashboard, books: Books, sales: Sales, lb: Leaderboard, users: Users }[tab];
    body = <>{showPin && <ChangePin onClose={() => setShowPin(false)} toast={showToast} />}<View ctx={ctx} /></>;
  }

  return (
    <>
      <header>
        <div>
          <h1>📚 {config.campaign_name || 'Book Marathon'}</h1>
          <div className="mu">Srila Prabhupada’s books · stock, sales and team tracker</div>
        </div>
        <div className="who">
          {me && me.id && (
            <>
              <span>👤 <b>{me.name}</b> <span className="tag">{me.role}</span></span>
              <RefreshButton onClick={refresh} />
              <button className="btn g" onClick={() => { setShowPin((s) => !s); window.scrollTo(0, 0); }}>Change PIN</button>
            </>
          )}
          <button className="btn g" onClick={cycleTheme}>{themeLabel}</button>
          {me && me.id && <button className="btn g" onClick={logout}>Log out</button>}
        </div>
      </header>
      {me && me.id && !booting && (
        <nav>
          {Object.entries(TABS).map(([k, label]) => (
            <button key={k} className={k === tab ? 'on' : ''} onClick={() => go(k)}>
              {label}{k === 'users' && canSeePending && pending > 0 && <> <span className="tag warn">{pending}</span></>}
            </button>
          ))}
        </nav>
      )}
      <main>{body}</main>
      <Toast toast={toast} />
    </>
  );
}

function RefreshButton({ onClick }) {
  const [busy, setBusy] = useState(false);
  return (
    <button className="btn g" disabled={busy} title="Load the latest data"
      onClick={async () => { setBusy(true); try { await onClick(); } finally { setBusy(false); } }}>
      {busy ? '↻ …' : '↻ Refresh'}
    </button>
  );
}
