/*
 * App.jsx — the shell: login state, data loaded from the API, navigation.
 * Phones: top bar + bottom tab bar. Desktop (≥900px): left sidebar.
 * Same screens as the prototype (Dashboard, Books, Sales, Leaderboard, Teams & users).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import * as api from './lib/api.js';
import { ConfirmDialog, Icon, Loading } from './components/ui.jsx';
import { Login, Register, NotConfigured, ChangePin } from './components/Auth.jsx';
import Dashboard from './components/Dashboard.jsx';
import Books from './components/Books.jsx';
import Sales from './components/Sales.jsx';
import Leaderboard from './components/Leaderboard.jsx';
import Users from './components/Users.jsx';

const TABS = [
  { key: 'dash', label: 'Dashboard', short: 'Home', icon: 'home', View: Dashboard },
  { key: 'sales', label: 'Sales', short: 'Sales', icon: 'bag', View: Sales },
  { key: 'books', label: 'Books', short: 'Books', icon: 'book', View: Books },
  { key: 'lb', label: 'Leaderboard', short: 'Ranks', icon: 'trophy', View: Leaderboard },
  { key: 'users', label: 'Teams & users', short: 'People', icon: 'users', View: Users },
];
const tabFromHash = () => { const h = window.location.hash.slice(1); return TABS.some((t) => t.key === h) ? h : 'dash'; };
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
  const info = theme === 'dark' ? { icon: 'moon', label: 'Dark theme' } : theme === 'light' ? { icon: 'sun', label: 'Light theme' } : { icon: 'monitor', label: 'Theme: auto' };
  return [info, cycle];
}

function Toast({ toast }) {
  if (!toast) return null;
  return (
    <div className={'toast' + (toast.err ? ' err' : '')} role="status" aria-live="polite">
      <Icon name={toast.err ? 'alert' : 'check'} />{toast.text}
    </div>
  );
}

function Brand({ name }) {
  return (
    <div className="brand">
      <div className="brand-logo" aria-hidden="true">📚</div>
      <div className="brand-text">
        <div className="brand-name">{name}</div>
        <div className="brand-sub">Srila Prabhupada’s books</div>
      </div>
    </div>
  );
}

const initials = (name) => String(name || '?').trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase();

function AccountMenu({ me, theme, onTheme, onRefresh, onPin, onLogout }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const ref = useRef();
  useEffect(() => {
    if (!open) return undefined;
    const close = (e) => { if (!ref.current?.contains(e.target)) setOpen(false); };
    const esc = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('pointerdown', close); document.removeEventListener('keydown', esc); };
  }, [open]);
  const pick = (fn) => () => { setOpen(false); fn(); };
  return (
    <div className="menu-wrap" ref={ref}>
      <button className="avatar-btn" onClick={() => setOpen((o) => !o)} aria-haspopup="menu" aria-expanded={open}>
        <span className="avatar">{initials(me.name)}</span>
        <span className="who-name">{me.name}</span>
        <Icon name="chevron" className="svg" />
      </button>
      {open && (
        <div className="menu" role="menu">
          <div className="menu-head"><b>{me.name}</b><div className="mu">{me.type} · {me.role}</div></div>
          <button className="menu-item" role="menuitem" disabled={busy}
            onClick={async () => { setBusy(true); try { await onRefresh(); } finally { setBusy(false); setOpen(false); } }}>
            <Icon name="refresh" />{busy ? 'Refreshing…' : 'Refresh data'}
          </button>
          <button className="menu-item" role="menuitem" onClick={pick(onPin)}><Icon name="key" />Change PIN</button>
          <button className="menu-item" role="menuitem" onClick={onTheme}><Icon name={theme.icon} />{theme.label}</button>
          <button className="menu-item danger" role="menuitem" onClick={pick(onLogout)}><Icon name="logout" />Log out</button>
        </div>
      )}
    </div>
  );
}

export default function App() {
  const configured = api.isConfigured();
  const [me, setMe] = useState(null);
  const [config, setConfig] = useState(DEFAULT_CONFIG);
  const [data, setData] = useState(EMPTY);
  const [booting, setBooting] = useState(configured && api.hasSession());
  const [loadError, setLoadError] = useState('');
  const [tab, setTab] = useState(tabFromHash);
  const [authView, setAuthView] = useState('login');
  const [authMsg, setAuthMsg] = useState(null);
  const [showPin, setShowPin] = useState(false);
  const [version, setVersion] = useState(0); // bumps after every change, so reports reload
  const [toast, setToastState] = useState(null);
  const [confirmReq, setConfirmReq] = useState(null);
  const [theme, cycleTheme] = useTheme();
  const loadedAt = useRef(0);
  const toastTimer = useRef();

  const showToast = useCallback((text, err = false) => {
    setToastState({ text, err });
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToastState(null), err ? 6000 : 3000);
  }, []);

  /** ctx.confirm({title, message, confirmText, danger}) → Promise<boolean> */
  const confirm = useCallback((req) => new Promise((resolve) => setConfirmReq({ ...req, resolve })), []);
  const answer = useCallback((ok) => { setConfirmReq((r) => { if (r) r.resolve(ok); return null; }); }, []);

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
      apply(await api.call('bootstrap'));
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

  // Each tab has its own #link, so the phone's Back button and bookmarks work.
  useEffect(() => {
    const onHash = () => setTab(tabFromHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const go = (t) => {
    if (window.location.hash !== '#' + t) window.history.pushState(null, '', '#' + t);
    setTab(t); setShowPin(false);
    window.scrollTo(0, 0);
    if (Date.now() - loadedAt.current > 60000) bootstrap(true); // quietly pick up other people's changes
  };

  const onLoggedIn = (d) => { setMe(d.me); setAuthMsg(null); setTab(tabFromHash()); setBooting(true); bootstrap(false); };
  const logout = () => { api.logout(); setMe(null); setData(EMPTY); setAuthView('login'); setAuthMsg(null); };
  const refresh = async () => { await bootstrap(true); showToast('Up to date'); };

  const name = config.campaign_name || 'Book Marathon';
  const ctx = { me, config, setConfig, ...data, apply, toast: showToast, confirm, version, go };
  const overlays = <><Toast toast={toast} /><ConfirmDialog req={confirmReq} onAnswer={answer} /></>;

  // ---- Not logged in: centred auth screens ----
  if (!configured || (!me && !booting)) {
    return (
      <>
        <button className="icon-btn auth-theme" onClick={cycleTheme} title={theme.label} aria-label={theme.label}><Icon name={theme.icon} /></button>
        <div className="auth-wrap">
          <div className="auth-card">
            <div className="auth-brand">
              <div className="brand-logo" aria-hidden="true">📚</div>
              <h1>{name}</h1>
            </div>
            {!configured ? <NotConfigured />
              : authView === 'register'
                ? <Register onDone={(text) => { setAuthView('login'); setAuthMsg({ text, kind: 'ok' }); }} onBack={() => { setAuthView('login'); setAuthMsg(null); }} />
                : <Login msg={authMsg} onLoggedIn={onLoggedIn} onRegister={() => { setAuthView('register'); setAuthMsg(null); }} />}
          </div>
        </div>
        {overlays}
      </>
    );
  }

  const ready = me && me.id && !booting && !loadError;
  // Badge: registrations waiting for approval, plus (admins) accounts locked by wrong PINs.
  const pending = data.users.filter((u) => !u.approved || u.locked).length;
  const showBadge = me && (me.role === 'admin' || me.role === 'lead') && pending > 0;
  const current = TABS.find((t) => t.key === tab);

  let body;
  if (booting || !me) body = <Loading />;
  else if (loadError) {
    body = (
      <div className="card"><h2>Could not load data</h2><p className="msg err">{loadError}</p>
        <button className="btn" onClick={() => { setBooting(true); bootstrap(false); }}><Icon name="refresh" />Try again</button></div>
    );
  } else {
    body = <>{showPin && <ChangePin onClose={() => setShowPin(false)} toast={showToast} />}<current.View ctx={ctx} /></>;
  }

  return (
    <div className={'shell' + (ready ? ' with-nav' : '')}>
      {ready && (
        <aside className="sidebar" aria-label="Main">
          <Brand name={name} />
          {TABS.map((t) => (
            <button key={t.key} className={'side-link' + (t.key === tab ? ' on' : '')} onClick={() => go(t.key)} aria-current={t.key === tab ? 'page' : undefined}>
              <Icon name={t.icon} />{t.label}{t.key === 'users' && showBadge && <span className="badge">{pending}</span>}
            </button>
          ))}
        </aside>
      )}
      <div>
        <header className="topbar">
          <Brand name={name} />
          {me && me.id && <AccountMenu me={me} theme={theme} onTheme={cycleTheme} onRefresh={refresh} onPin={() => { setShowPin(true); window.scrollTo(0, 0); }} onLogout={logout} />}
        </header>
        <main className={'content' + (ready ? '' : ' no-nav')}>{body}</main>
      </div>
      {ready && (
        <nav className="bottom-nav" aria-label="Main">
          {TABS.map((t) => (
            <button key={t.key} className={t.key === tab ? 'on' : ''} onClick={() => go(t.key)} aria-current={t.key === tab ? 'page' : undefined}>
              <Icon name={t.icon} />{t.short}{t.key === 'users' && showBadge && <span className="badge">{pending}</span>}
            </button>
          ))}
        </nav>
      )}
      {overlays}
    </div>
  );
}
