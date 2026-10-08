// Thin fetch wrapper: adds the JWT, parses the structured error body, exposes X-Served-By.

const TOKEN_KEY = 'rr.auth';

export interface AuthData {
  token: string;
  user: {
    id?: string;
    name: string;
    email: string;
  };
}

export function getAuth(): AuthData | null {
  try {
    const raw = localStorage.getItem(TOKEN_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function setAuth(auth: AuthData | null): void {
  try {
    if (auth) localStorage.setItem(TOKEN_KEY, JSON.stringify(auth));
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* storage unavailable: session-only login */
  }
}

export class ApiError extends Error {
  status: number;
  code: string;
  servedBy: string | null;

  constructor(status: number, code: string, message: string, servedBy: string | null) {
    super(message);
    this.status = status;
    this.code = code;
    this.servedBy = servedBy;
  }
}

export interface ApiOptions {
  method?: string;
  body?: unknown;
  token?: string;
  headers?: Record<string, string>;
  raw?: boolean;
}

export interface RawApiResponse<T = any> {
  status: number;
  data: T | null;
  servedBy: string | null;
  ms: number;
}

/**
 * @param path e.g. '/api/search?...'
 * @param opts { method, body, token, headers, raw }
 */
export async function api<T = any>(
  path: string,
  { method = 'GET', body, token, headers = {}, raw = false }: ApiOptions = {}
): Promise<T> {
  const jwt = token ?? getAuth()?.token;
  const started = performance.now();
  let res: Response;
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
  } catch {
    if (raw) return { status: 0, data: null, servedBy: null, ms: performance.now() - started } as unknown as T;
    throw new ApiError(0, 'NETWORK', 'Cannot reach the server', null);
  }

  const ms = performance.now() - started;
  const servedBy = res.headers.get('X-Served-By');
  let data: any = null;
  const text = await res.text();
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { message: text };
    }
  }

  if (raw) return { status: res.status, data, servedBy, ms } as unknown as T;

  if (!res.ok) {
    if (res.status === 401 && !token) {
      setAuth(null);
    }
    const code = data?.code || (res.status === 429 ? 'RATE_LIMITED' : `HTTP_${res.status}`);
    const message =
      data?.message || (res.status === 429 ? 'Too many requests - slow down and retry in a moment' : res.statusText);
    throw new ApiError(res.status, code, message, servedBy);
  }
  return data as T;
}

export const uuid = (): string =>
  typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;

export function todayIST(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
}

export function addDays(isoDate: string, n: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function fmtDate(isoDate?: string): string {
  if (!isoDate) return '';
  return new Date(`${isoDate}T00:00:00Z`).toLocaleDateString('en-IN', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  });
}

export const runIdOf = (train: string, isoDate: string): string =>
  `${train}-${isoDate.replaceAll('-', '')}`;

export const rupees = (n: number | string): string => `₹${Number(n).toLocaleString('en-IN')}`;
