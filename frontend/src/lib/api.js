/*
 * api.js — talks to the Apps Script Web App.
 *
 * Apps Script cannot answer CORS pre-flight (OPTIONS) requests, so we send a
 * "simple" POST: Content-Type text/plain with JSON in the body. Apps Script
 * replies with a redirect to googleusercontent.com, which fetch follows.
 *
 * The URL comes from public/config.js (editable after building) or, if that is
 * not filled in, from the VITE_API_URL build variable.
 */
const SESSION_KEY = 'bm.session';

export function apiUrl() {
  const fromFile = (window.BM_CONFIG && window.BM_CONFIG.API_URL) || '';
  const url = /^https:\/\//.test(fromFile) ? fromFile : (import.meta.env.VITE_API_URL || '');
  return url.trim();
}

export function isConfigured() {
  return /^https:\/\/script\.google(usercontent)?\.com\//.test(apiUrl());
}

/** Error carrying the server's code: AUTH, FORBIDDEN, VALIDATION, NOT_FOUND, BUSY, SERVER, NETWORK. */
export class ApiError extends Error {
  constructor(message, code) { super(message); this.code = code; }
}

function loadSession() {
  try {
    const s = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null');
    if (s && s.token && new Date(s.expiresAt) > new Date()) return s;
  } catch { /* storage blocked */ }
  return null;
}

let session = loadSession();
let onAuthLost = () => {};

export const hasSession = () => !!session;
export const setOnAuthLost = (fn) => { onAuthLost = fn; };

async function send(body) {
  let res;
  try {
    res = await fetch(apiUrl(), {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(body),
      redirect: 'follow',
    });
  } catch {
    throw new ApiError('Cannot reach the server. Check your internet connection and try again.', 'NETWORK');
  }
  if (!res.ok) throw new ApiError(`The server answered with an error (${res.status}). Please try again.`, 'NETWORK');
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new ApiError('The server sent an unexpected answer. Check that the Web App is deployed with access "Anyone".', 'NETWORK');
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** call('addSale', {...}) → data. Throws ApiError. Retries once when the server is busy. */
export async function call(action, payload = {}, retried = false) {
  const r = await send({ action, payload, token: session ? session.token : undefined });
  if (r.ok) return r.data;
  if (r.code === 'BUSY' && !retried) { await sleep(1500); return call(action, payload, true); }
  if (r.code === 'AUTH' && action !== 'login') {
    clearSession();
    onAuthLost(r.error);
  }
  throw new ApiError(r.error, r.code);
}

function clearSession() {
  session = null;
  try { localStorage.removeItem(SESSION_KEY); } catch { /* ignore */ }
}

export async function login(id, pin) {
  const d = await call('login', { id, pin });
  session = { token: d.token, expiresAt: d.expiresAt, me: d.me };
  try { localStorage.setItem(SESSION_KEY, JSON.stringify(session)); } catch { /* ignore */ }
  return d;
}

export function logout() {
  if (session) call('logout').catch(() => {});
  clearSession();
}
