import { useState } from 'react';
import * as api from '../lib/api.js';
import { CardHead, Msg } from './ui.jsx';

export function NotConfigured() {
  return (
    <div className="card">
      <h2>⚙️ Almost there</h2>
      <p>This website is not connected to its Google Sheet yet.</p>
      <ol>
        <li>Open <b>config.js</b> in the website files (<code>public/config.js</code> before building, <code>dist/config.js</code> after).</li>
        <li>Paste your Apps Script <b>Web App URL</b> in place of <code>PASTE_YOUR_WEB_APP_URL_HERE</code>.</li>
        <li>Upload the site again and reload this page.</li>
      </ol>
      <p className="mu">See README.md, step 5.</p>
    </div>
  );
}

export function Login({ msg: initialMsg, onLoggedIn, onRegister }) {
  const [id, setId] = useState('');
  const [pin, setPin] = useState('');
  const [msg, setMsg] = useState(initialMsg);
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    if (!id.trim() || !pin) return setMsg({ text: 'Enter your phone number (or name) and PIN.', kind: 'err' });
    if (!/^\d{4,6}$/.test(pin)) return setMsg({ text: 'PIN is 4 to 6 digits.', kind: 'err' });
    setBusy(true);
    try {
      onLoggedIn(await api.login(id.trim(), pin));
    } catch (err) {
      setMsg({ text: err.message, kind: 'err' });
      setBusy(false);
    }
  };

  return (
    <form className="card stack" onSubmit={submit}>
      <h2>🙏 Hare Krishna!</h2>
      <div><label htmlFor="lid">Phone number or name</label>
        <input id="lid" autoComplete="username" value={id} onChange={(e) => setId(e.target.value)} autoFocus /></div>
      <div><label htmlFor="lpin">PIN</label>
        <input id="lpin" type="password" inputMode="numeric" maxLength={6} autoComplete="current-password" value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))} /></div>
      <button className="btn block" type="submit" disabled={busy}>{busy ? 'Logging in…' : 'Log in'}</button>
      <Msg msg={msg} />
      <p className="mu">New volunteer or team? <button type="button" className="link" onClick={onRegister}>Register</button></p>
    </form>
  );
}

export function Register({ onDone, onBack }) {
  const [f, setF] = useState({ name: '', type: 'Person', members: '', phone: '', pin: '', pin2: '' });
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: k.startsWith('pin') ? e.target.value.replace(/\D/g, '') : e.target.value });

  const submit = async (e) => {
    e.preventDefault();
    const err = (text) => setMsg({ text, kind: 'err' });
    if (!f.name.trim()) return err('Please enter your name.');
    if (f.phone.replace(/\D/g, '').length < 10) return err('Please enter a 10-digit phone number.');
    if (!/^\d{4,6}$/.test(f.pin)) return err('PIN must be 4 to 6 digits.');
    if (f.pin !== f.pin2) return err('The two PINs do not match.');
    setBusy(true);
    try {
      const d = await api.call('register', { name: f.name, type: f.type, members: f.members, phone: f.phone, pin: f.pin });
      onDone(d.message);
    } catch (ex) {
      err(ex.message);
      setBusy(false);
    }
  };

  return (
    <form className="card stack" onSubmit={submit}>
      <h2>Register as a volunteer</h2>
      <div><label htmlFor="rn">Your name (or team name)</label><input id="rn" maxLength={100} value={f.name} onChange={set('name')} autoFocus /></div>
      <div><label htmlFor="rt">Registering as</label>
        <select id="rt" value={f.type} onChange={set('type')}><option>Person</option><option>Team</option></select></div>
      {f.type === 'Team' && <div><label htmlFor="rm">Team members (names, comma separated)</label><input id="rm" value={f.members} onChange={set('members')} /></div>}
      <div><label htmlFor="rp">Phone number (used to log in)</label><input id="rp" type="tel" inputMode="tel" value={f.phone} onChange={set('phone')} /></div>
      <div className="row">
        <div><label htmlFor="rpin">Choose a 4–6 digit PIN</label><input id="rpin" type="password" inputMode="numeric" maxLength={6} value={f.pin} onChange={set('pin')} /></div>
        <div><label htmlFor="rpin2">Repeat PIN</label><input id="rpin2" type="password" inputMode="numeric" maxLength={6} value={f.pin2} onChange={set('pin2')} /></div>
      </div>
      <button className="btn block" type="submit" disabled={busy}>{busy ? 'Registering…' : 'Register'}</button>
      <Msg msg={msg} />
      <p className="mu"><button type="button" className="link" onClick={onBack}>← Back to log in</button></p>
    </form>
  );
}

export function ChangePin({ onClose, toast }) {
  const [f, setF] = useState({ old: '', pin: '', pin2: '' });
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value.replace(/\D/g, '') });

  const save = async () => {
    if (!/^\d{4,6}$/.test(f.pin)) return setMsg({ text: 'New PIN must be 4 to 6 digits.', kind: 'err' });
    if (f.pin !== f.pin2) return setMsg({ text: 'The new PINs do not match.', kind: 'err' });
    setBusy(true);
    try {
      await api.call('changePin', { oldPin: f.old, newPin: f.pin });
      toast('PIN changed ✓');
      onClose();
    } catch (e) {
      setMsg({ text: e.message, kind: 'err' });
      setBusy(false);
    }
  };

  return (
    <div className="card">
      <CardHead icon="key" title="Change my PIN" />
      <div className="row">
        <div><label htmlFor="op">Current PIN</label><input id="op" type="password" inputMode="numeric" maxLength={6} value={f.old} onChange={set('old')} autoFocus /></div>
        <div><label htmlFor="np">New PIN (4–6 digits)</label><input id="np" type="password" inputMode="numeric" maxLength={6} value={f.pin} onChange={set('pin')} /></div>
        <div><label htmlFor="np2">Repeat new PIN</label><input id="np2" type="password" inputMode="numeric" maxLength={6} value={f.pin2} onChange={set('pin2')} /></div>
        <div className="btns">
          <button className="btn" onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save PIN'}</button>
          <button className="btn s" onClick={onClose}>Cancel</button>
        </div>
      </div>
      <Msg msg={msg} />
    </div>
  );
}
