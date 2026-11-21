import { useMemo, useRef, useState } from 'react';
import * as api from '../lib/api.js';
import { num, teamOf } from '../lib/format.js';
import { BusyButton, CardHead, Icon, Msg, PageHead, Search, Table, Tag } from './ui.jsx';

/** Mirrors the server rule: admins edit anyone; leads edit themselves and the sellers in their team. */
function canEdit(me, u) {
  if (me.role === 'admin') return true;
  if (me.role === 'lead') {
    const t = teamOf(me);
    return u.id === me.id || (!!t && teamOf(u) === t && u.role === 'seller' && u.type === 'Person');
  }
  return false;
}

export default function Users({ ctx }) {
  const { me, users, apply, toast } = ctx;
  const isAdmin = me.role === 'admin', isLead = me.role === 'lead';
  const [editing, setEditing] = useState(null);
  const [adding, setAdding] = useState(false);
  const formRef = useRef();
  const pending = users.filter((u) => !u.approved && canEdit(me, u));

  const startEdit = (u) => { setEditing(u); setTimeout(() => formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 0); };

  const approve = async (u) => {
    try { apply({ users: await api.call('saveUser', { id: u.id, approved: true }) }); toast(`${u.name} approved ✓` + (u.has_pin ? '' : ': set a PIN so they can log in')); }
    catch (e) { toast(e.message, true); }
  };
  const removeFromTeam = async (u) => {
    if (!(await ctx.confirm({ title: `Remove ${u.name} from your team?`, message: 'Their sales stay recorded.', confirmText: 'Remove' }))) return;
    try { apply({ users: await api.call('saveUser', { id: u.id, team_id: '' }) }); toast(`${u.name} removed from the team`); }
    catch (e) { toast(e.message, true); }
  };
  const del = async (u) => {
    const message = [u.sold ? `Their ${u.sold} sold copies (sales entries) will also be deleted.` : '', u.type === 'Team' ? 'Team members keep their accounts.' : '', 'This cannot be undone.'].filter(Boolean).join('\n');
    if (!(await ctx.confirm({ title: `Delete ${u.name}?`, message, confirmText: 'Delete', danger: true }))) return;
    try {
      const d = await api.call('deleteUser', { id: u.id });
      const books = d.deletedSales ? await api.call('listBooks') : undefined;
      apply({ users: d.users, books, sales: ctx.sales.filter((s) => s.user_id !== u.id) });
      if (editing && editing.id === u.id) setEditing(null);
      toast(`Deleted ${u.name}`);
    } catch (e) { toast(e.message, true); }
  };

  return (
    <>
      <PageHead title="Teams & users" sub={`${users.length} registered${pending.length ? ` · ${pending.length} waiting for approval` : ''}`}>
        {(isAdmin || isLead) && !editing && !adding && <button className="btn" onClick={() => setAdding(true)}><Icon name="plus" />{isAdmin ? 'Add person / team' : 'Add team member'}</button>}
      </PageHead>
      {pending.length > 0 && (isAdmin || isLead) && (
        <div className="card">
          <CardHead icon="userCheck" title={`Waiting for approval (${pending.length})`} />
          <Table head={['Name', 'Type', 'Phone', 'Registered', '']}
            rows={pending.map((u) => (
              <tr key={u.id}>
                <td>{u.name}{!u.has_pin && <> <Tag>added by sales upload</Tag></>}</td><td>{u.type}</td><td>{u.phone || '—'}</td><td>{String(u.created_at || '').slice(0, 10)}</td>
                <td>
                  <BusyButton className="btn g" busyText="…" onClick={() => approve(u)}>Approve</BusyButton>
                  {isAdmin && <BusyButton className="btn g danger" busyText="…" onClick={() => del(u)}>Delete</BusyButton>}
                </td>
              </tr>
            ))} />
          <p className="mu">Approved users can log in with their phone/name and PIN. Users without a PIN need one set (Edit → PIN) before they can log in; they can still be credited with sales.</p>
        </div>
      )}
      {(isAdmin || isLead) && (editing || adding) && <UserForm key={editing ? editing.id : 'new'} ctx={ctx} user={editing} formRef={formRef} onDone={() => { setEditing(null); setAdding(false); }} />}
      <UserList ctx={ctx} onEdit={startEdit} onRemove={removeFromTeam} onDelete={del} />
      {isAdmin && <Settings ctx={ctx} />}
    </>
  );
}

function UserList({ ctx, onEdit, onRemove, onDelete }) {
  const { me, users } = ctx;
  const [q, setQ] = useState('');
  const isAdmin = me.role === 'admin', isLead = me.role === 'lead';
  const byId = useMemo(() => Object.fromEntries(users.map((u) => [u.id, u])), [users]);
  // Team total = the team's own sales + its members' sales.
  const teamTotal = useMemo(() => {
    const t = {};
    users.forEach((u) => { const k = teamOf(u); if (k) t[k] = (t[k] || 0) + (u.sold || 0); });
    return t;
  }, [users]);
  const list = users.filter((u) => `${u.name} ${u.type} ${u.role} ${u.phone || ''} ${u.members || ''}`.toLowerCase().includes(q.toLowerCase()));

  return (
    <div className="card">
      <CardHead icon="users" title={`Everyone (${users.length})`} />
      <Search placeholder="Search name, type, role or phone" value={q} onChange={setQ} />
      <Table head={['Name', 'Type', 'Role', 'Team', 'Phone', 'Members', '#Sold', '#Team total', '']}
        empty={users.length ? `Nobody matches “${q}”.` : 'Nobody registered yet.'}
        rows={list.map((u) => (
          <tr key={u.id} className={u.id === me.id ? 'me' : undefined}>
            <td>{u.name}{!u.approved && <> <Tag kind="warn">pending</Tag></>}{isAdmin && !u.has_pin && <> <Tag title="Cannot log in until a PIN is set">no PIN</Tag></>}</td>
            <td>{u.type}</td><td>{u.role}</td>
            <td>{u.type === 'Team' ? '—' : (byId[u.team_id] || {}).name || ''}</td>
            <td>{u.phone === undefined ? '•••' : u.phone}</td>
            <td>{u.members}</td>
            <td className="n">{num(u.sold)}</td>
            <td className="n">{u.type === 'Team' ? num(teamTotal[u.id] || 0) : ''}</td>
            <td>
              {canEdit(me, u) && <button className="btn g" onClick={() => onEdit(u)}>Edit</button>}
              {isLead && u.id !== me.id && canEdit(me, u) && <BusyButton className="btn g" busyText="…" onClick={() => onRemove(u)}>Remove from team</BusyButton>}
              {isAdmin && u.id !== me.id && <BusyButton className="btn g danger" busyText="…" onClick={() => onDelete(u)}>Delete</BusyButton>}
            </td>
          </tr>
        ))} />
      {!isAdmin && <p className="mu">Phone numbers are visible only to admins{isLead ? ' and to you for your own team' : ''}.</p>}
    </div>
  );
}

function UserForm({ ctx, user, formRef, onDone }) {
  const { me, users, apply } = ctx;
  const isAdmin = me.role === 'admin';
  const self = user && user.id === me.id;
  const [f, setF] = useState({
    name: user ? user.name : '', type: user ? user.type : 'Person', phone: user ? user.phone || '' : '',
    members: user ? user.members || '' : '', role: user ? user.role : 'seller', team_id: user ? user.team_id || '' : '',
    approved: user ? user.approved : true, pin: '',
  });
  const [msg, setMsg] = useState(null);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : k === 'pin' ? e.target.value.replace(/\D/g, '') : e.target.value });
  const teams = users.filter((u) => u.type === 'Team' && (!user || u.id !== user.id));

  if (me.role === 'lead' && !teamOf(me)) {
    return <div className="card"><CardHead icon="users" title="My team" /><p className="mu">You are not part of a team yet. Ask an admin to set your team.</p></div>;
  }

  const save = async () => {
    const err = (text) => setMsg({ text, kind: 'err' });
    if (!f.name.trim()) return err('Name is required.');
    if (f.phone && f.phone.replace(/\D/g, '').length < 10) return err('Phone number should have 10 digits.');
    if (f.pin && !/^\d{4,6}$/.test(f.pin)) return err('PIN must be 4 to 6 digits.');
    // Send only the fields this role is allowed to change; the server ignores or rejects the rest anyway.
    const p = { id: user ? user.id : undefined, name: f.name.trim(), phone: f.phone.trim() };
    if (isAdmin || (self && user.type === 'Team')) p.members = f.members;
    if (isAdmin) Object.assign(p, { type: f.type, role: f.role, team_id: f.type === 'Team' ? '' : f.team_id, approved: f.approved });
    if (f.pin && !self) p.pin = f.pin;
    try {
      apply({ users: await api.call('saveUser', p) });
      setMsg({ text: (user ? 'Saved changes for ' : 'Registered ') + p.name + ' ✓', kind: 'ok' });
      if (user) onDone();
      else setF({ ...f, name: '', phone: '', members: '', pin: '' });
    } catch (e) { err(e.message); }
  };

  const title = user ? `Edit ${user.name}` : isAdmin ? 'Register person / team' : 'Add a member to my team';
  return (
    <div className="card" ref={formRef}>
      <CardHead icon={user ? 'users' : 'plus'} title={title} />
      <div className="row">
        <div className="field"><label htmlFor="un">Name</label><input id="un" maxLength={100} value={f.name} onChange={set('name')} autoFocus={!!user} /></div>
        {isAdmin && <div className="field"><label htmlFor="ut">Type</label><select id="ut" value={f.type} onChange={set('type')}><option>Person</option><option>Team</option></select></div>}
        <div className="field"><label htmlFor="uc">Phone</label><input id="uc" type="tel" inputMode="tel" value={f.phone} onChange={set('phone')} /></div>
        {(isAdmin || (self && user.type === 'Team')) && <div className="field"><label htmlFor="um">Members (for teams)</label><input id="um" value={f.members} onChange={set('members')} /></div>}
        {isAdmin && (
          <>
            <div className="field"><label htmlFor="ur">Role</label>
              <select id="ur" value={f.role} onChange={set('role')}><option value="seller">Seller</option><option value="lead">Team lead</option><option value="admin">Admin</option></select></div>
            {f.type === 'Person' && (
              <div className="field"><label htmlFor="uteam">Team</label>
                <select id="uteam" value={f.team_id} onChange={set('team_id')}><option value="">None</option>{teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select></div>
            )}
          </>
        )}
        {!self && (
          <div className="field"><label htmlFor="upin">{user ? (user.has_pin ? 'New PIN (blank = keep)' : 'Set a PIN (4–6 digits)') : 'PIN (4–6 digits, optional)'}</label>
            <input id="upin" type="password" inputMode="numeric" maxLength={6} autoComplete="new-password" value={f.pin} onChange={set('pin')} /></div>
        )}
        {isAdmin && <div><label className="inline"><input type="checkbox" checked={f.approved} onChange={set('approved')} /> Approved (can log in)</label></div>}
        <div className="btns">
          <BusyButton onClick={save}>{user ? 'Save changes' : isAdmin ? 'Register' : 'Add to my team'}</BusyButton>
          <button className="btn s" onClick={onDone}>{user ? 'Cancel' : 'Close'}</button>
        </div>
      </div>
      {me.role === 'lead' && !user && <p className="mu">New members are added as approved sellers in your team. Give them a PIN so they can log in, or leave it blank and record sales for them yourself.</p>}
      {self && <p className="mu">Use “Change PIN” at the top to change your own PIN.</p>}
      <Msg msg={msg} />
    </div>
  );
}

function Settings({ ctx }) {
  const { config, setConfig, apply } = ctx;
  const [f, setF] = useState({ campaign_name: config.campaign_name, low_stock_threshold: String(config.low_stock_threshold) });
  const [msg, setMsg] = useState(null);

  const save = async () => {
    if (!f.campaign_name.trim()) return setMsg({ text: 'Campaign name cannot be empty.', kind: 'err' });
    try {
      setConfig(await api.call('setConfig', f));
      apply({ books: await api.call('listBooks') }); // low-stock flags depend on the threshold
      setMsg({ text: 'Settings saved ✓', kind: 'ok' });
    } catch (e) { setMsg({ text: e.message, kind: 'err' }); }
  };

  return (
    <div className="card">
      <CardHead icon="sliders" title="Campaign settings" />
      <div className="row">
        <div className="field"><label htmlFor="cn">Campaign name</label><input id="cn" maxLength={100} value={f.campaign_name} onChange={(e) => setF({ ...f, campaign_name: e.target.value })} /></div>
        <div className="field"><label htmlFor="ct">Low-stock warning at (copies left)</label><input id="ct" type="number" min="0" step="1" value={f.low_stock_threshold} onChange={(e) => setF({ ...f, low_stock_threshold: e.target.value })} /></div>
        <BusyButton onClick={save}>Save settings</BusyButton>
      </div>
      <Msg msg={msg} />
    </div>
  );
}
