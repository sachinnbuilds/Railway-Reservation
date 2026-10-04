// Thin fetch wrapper: adds the JWT, parses the structured error body, exposes X-Served-By.

const TOKEN_KEY = 'rr.auth';

export function getAuth() {
  try {
    return JSON.parse(localStorage.getItem(TOKEN_KEY)) || null;
  } catch {
    return null;
  }
}

export function setAuth(auth) {
  try {
    if (auth) localStorage.setItem(TOKEN_KEY, JSON.stringify(auth));
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* storage unavailable: session-only login */
  }
}

export class ApiError extends Error {
  constructor(status, code, message, servedBy) {
    super(message);
    this.status = status;
    this.code = code;
    this.servedBy = servedBy;
  }
}

/**
 * @param {string} path  e.g. '/api/search?...'
 * @param {object} opts  { method, body, token, headers, raw }
 *   token: explicit JWT (simulator bots); defaults to the logged-in user's.
 *   raw:   resolve with { status, data, servedBy, ms } instead of throwing on HTTP errors.
 */
export async function api(path, { method = 'GET', body, token, headers = {}, raw = false } = {}) {
  const jwt = token ?? getAuth()?.token;
  const started = performance.now();
  let res;
  try {
    res = await fetch(path, {
      method,
      headers: {
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(jwt ? { Authorization: `Bearer ${jwt}` } : {}),
        ...headers,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch (e) {
    if (raw) return { status: 0, data: null, servedBy: null, ms: performance.now() - started };
    throw new ApiError(0, 'NETWORK', 'Cannot reach the server');
  }
  const ms = performance.now() - started;
  const servedBy = res.headers.get('X-Served-By');
  let data = null;
  const text = await res.text();
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { message: text };
    }
  }
  if (raw) return { status: res.status, data, servedBy, ms };
  if (!res.ok) {
    if (res.status === 401 && !token) {
      setAuth(null);
    }
    const code = data?.code || (res.status === 429 ? 'RATE_LIMITED' : `HTTP_${res.status}`);
    const message =
      data?.message || (res.status === 429 ? 'Too many requests - slow down and retry in a moment' : res.statusText);
    throw new ApiError(res.status, code, message, servedBy);
  }
  return data;
}

export const uuid = () =>
  crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;

export function todayIST() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
}

export function addDays(isoDate, n) {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function fmtDate(isoDate) {
  if (!isoDate) return '';
  return new Date(`${isoDate}T00:00:00Z`).toLocaleDateString('en-IN', {
    weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC',
  });
}

export const runIdOf = (train, isoDate) => `${train}-${isoDate.replaceAll('-', '')}`;

export const rupees = (n) => `₹${Number(n).toLocaleString('en-IN')}`;
