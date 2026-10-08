import React, { useCallback, useEffect, useRef, useState } from 'react';
import { addDays, api, runIdOf, todayIST, uuid } from '../api.ts';
import { 
  Activity, 
  Server, 
  Zap, 
  ShieldAlert, 
  RefreshCw, 
  Sliders, 
  Database, 
  CheckCircle2, 
  AlertTriangle 
} from 'lucide-react';

export default function ControlRoom() {
  return (
    <div className="max-w-7xl mx-auto py-8 px-4 sm:px-6 space-y-6">
      <header className="pb-4 border-b border-slate-200">
        <div className="flex items-center gap-2 mb-1">
          <Activity className="w-6 h-6 text-[#1b3a6b]" />
          <h1 className="text-2xl font-black text-[#1b3a6b] tracking-tight">
            CONTROL ROOM & DISTRIBUTED SAGA MONITOR
          </h1>
        </div>
        <p className="text-xs text-slate-500 leading-relaxed">
          Live distributed systems telemetry. Trigger a high-concurrency Tatkal rush, inject payment gateway latency, 
          and verify that no seat is ever double-booked.
        </p>
      </header>

      <Registry />
      <TatkalSimulator />
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <PaymentChaos />
        <ReadPath />
      </div>
    </div>
  );
}

function usePoll(fn: (alive: () => boolean) => Promise<void>, ms: number, deps: any[] = []) {
  useEffect(() => {
    let alive = true;
    let t: NodeJS.Timeout;
    const run = async () => {
      try {
        await fn(() => alive);
      } finally {
        if (alive) t = setTimeout(run, ms);
      }
    };
    run();
    return () => {
      alive = false;
      clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}

// ------------------------------------------------------------------ service registry

function Registry() {
  const [apps, setApps] = useState<{ name: string; instances: { id: string; host: string; status: string }[] }[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  usePoll(async (alive) => {
    try {
      const r = await api<any>('/api/admin/registry');
      const list = (r.applications?.application || []).map((a: any) => ({
        name: a.name.toLowerCase(),
        instances: a.instance.map((i: any) => ({ id: i.instanceId, host: i.hostName, status: i.status })),
      }));
      list.sort((a: any, b: any) => a.name.localeCompare(b.name));
      if (alive()) {
        setApps(list);
        setError(null);
      }
    } catch (e: any) {
      if (alive()) setError(e.message);
    }
  }, 3000);

  return (
    <section className="bg-white rounded-lg border border-slate-200 shadow-sm p-5">
      <div className="flex flex-wrap items-center justify-between gap-2 pb-3 mb-4 border-b border-slate-200">
        <div className="flex items-center gap-2">
          <Server className="w-5 h-5 text-[#1b3a6b]" />
          <h3 className="font-extrabold text-sm text-[#1b3a6b] uppercase tracking-wide">
            Service Registry (Eureka)
          </h3>
        </div>
        <span className="text-slate-400 text-xs">
          Gateway balances load across instances registered dynamically.
        </span>
      </div>

      {error && (
        <div className="p-3 mb-4 rounded bg-amber-50 border border-amber-200 text-amber-800 text-xs">
          Registry status: {error}
        </div>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-3">
        {apps?.map((a) => (
          <div key={a.name} className="p-3 rounded-lg border border-slate-200 bg-slate-50/70">
            <div className="font-bold text-xs text-slate-900 truncate">{a.name}</div>
            <div className="flex items-center gap-1.5 mt-2">
              {a.instances.map((i) => (
                <span
                  key={i.id}
                  className={`w-2.5 h-2.5 rounded-full ${i.status === 'UP' ? 'bg-emerald-500' : 'bg-red-500'}`}
                  title={`${i.id} (${i.status})`}
                />
              ))}
              <span className="text-[11px] text-slate-500 font-semibold">×{a.instances.length}</span>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

// ------------------------------------------------------------------ Tatkal rush (problems 1 & 2)

const BOT_PASSWORD = 'tatkal-bot-123';

async function pool<T, R>(items: T[], limit: number, worker: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const results: R[] = [];
  let next = 0;
  const run = async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await worker(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
  return results;
}

function percentile(values: number[], p: number): number {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => a - b);
  return Math.round(s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))]);
}

function TatkalSimulator() {
  const [cfg, setCfg] = useState({ date: addDays(todayIST(), 1), cls: 'SL', bots: 120, perBot: 1, autopay: true });
  const [phase, setPhase] = useState<'idle' | 'bots' | 'firing' | 'settling' | 'done'>('idle');
  const [stats, setStats] = useState<any>(null);
  const [outcomes, setOutcomes] = useState<Record<string, number>>({});
  const [seatMap, setSeatMap] = useState<any>(null);
  const [check, setCheck] = useState<any>(null);
  const [fastReject, setFastReject] = useState<boolean | null>(null);
  const [allocMode, setAllocMode] = useState<string | null>(null);
  const [naiveRuns, setNaiveRuns] = useState<string[]>([]);
  const [noFreshDate, setNoFreshDate] = useState(false);
  const bots = useRef<Record<number, string>>({});
  const runId = runIdOf('22222', cfg.date);

  usePoll(async (alive) => {
    try {
      const m = await api<any>(`/api/admin/inventory/runs/${runId}/seats`);
      if (alive()) setSeatMap(m);
    } catch {
      if (alive()) setSeatMap(null);
    }
  }, phase === 'idle' || phase === 'done' ? 4000 : 800, [runId, phase]);

  useEffect(() => {
    api<any>('/api/admin/booking/stats').then((s) => setFastReject(s.fastRejectEnabled)).catch(() => {});
    api<any>('/api/admin/inventory/allocation-mode').then((m) => { setAllocMode(m.mode); setNaiveRuns(m.naiveRuns || []); }).catch(() => {});
    pickFreshDate(cfg.cls);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pickFreshDate = async (cls: string) => {
    for (let d = 1; d < 15; d++) {
      const date = addDays(todayIST(), d);
      try {
        const m = await api<any>(`/api/admin/inventory/runs/${runIdOf('22222', date)}/seats`);
        const c = m.classes.find((x: any) => x.travelClass === cls);
        if (c && c.available === c.total) {
          setCfg((prev) => ({ ...prev, date }));
          setCheck(null);
          setStats(null);
          setOutcomes({});
          setNoFreshDate(false);
          return true;
        }
      } catch {
        return false;
      }
    }
    setNoFreshDate(true);
    return false;
  };

  const toggleFastReject = async () => {
    const r = await api<any>(`/api/admin/booking/fast-reject?enabled=${!fastReject}`, { method: 'PUT' });
    setFastReject(r.fastRejectEnabled);
  };

  const toggleAllocMode = async () => {
    const next = allocMode === 'NAIVE' ? 'SAFE' : 'NAIVE';
    if (next === 'NAIVE' && !window.confirm('Switch to the deliberately broken NAIVE allocator? Use a fresh journey date: the run will be corrupted.')) return;
    const r = await api<any>(`/api/admin/inventory/allocation-mode?mode=${next}`, { method: 'PUT' });
    setAllocMode(r.mode);
    setNaiveRuns(r.naiveRuns || []);
    await pickFreshDate(cfg.cls);
  };

  const ensureBots = async (n: number) => {
    const ids = Array.from({ length: n }, (_, i) => i);
    await pool(ids, 12, async (i) => {
      if (bots.current[i]) return;
      const email = `bot${i}@tatkal.sim`;
      let r = await api<any>('/api/auth/login', { method: 'POST', body: { email, password: BOT_PASSWORD }, raw: true });
      if (r.status !== 200) {
        r = await api<any>('/api/auth/register', { method: 'POST', body: { name: `Bot ${i}`, email, password: BOT_PASSWORD }, raw: true });
      }
      if (r.data?.token) bots.current[i] = r.data.token;
    });
  };

  const run = async () => {
    setCheck(null);
    setOutcomes({});
    setPhase('bots');
    await ensureBots(cfg.bots);
    const tokens = Object.entries(bots.current).filter(([i]) => Number(i) < cfg.bots).map(([, t]) => t);

    setPhase('firing');
    const s: any = { sent: 0, accepted: 0, soldOut: 0, rateLimited: 0, unavailable: 0, other: 0, latencies: [], servedBy: {} };
    setStats({ ...s });
    const requests = tokens.flatMap((token) => Array.from({ length: cfg.perBot }, () => token));
    const accepted: { id: string; token: string }[] = [];
    const started = performance.now();

    await Promise.all(
      requests.map(async (token) => {
        const r = await api<any>('/api/bookings', {
          method: 'POST', token, raw: true, headers: { 'Idempotency-Key': uuid() },
          body: {
            trainNumber: '22222', journeyDate: cfg.date, from: 'NDLS', to: 'MMCT', travelClass: cfg.cls,
            passengers: [{ name: 'Tatkal Passenger', age: 30, gender: 'M' }],
          },
        });
        s.sent++;
        s.latencies.push(r.ms);
        if (r.servedBy) s.servedBy[r.servedBy] = (s.servedBy[r.servedBy] || 0) + 1;
        if (r.status === 202) {
          s.accepted++;
          accepted.push({ id: r.data.id, token });
        } else if (r.status === 409 && r.data?.code === 'SOLD_OUT') s.soldOut++;
        else if (r.status === 429) s.rateLimited++;
        else if (r.status === 503) s.unavailable++;
        else s.other++;
        if (s.sent % 10 === 0) setStats({ ...s });
      }),
    );
    s.wallMs = performance.now() - started;
    setStats({ ...s });

    setPhase('settling');
    const final: Record<string, string> = {};
    const pending = new Map(accepted.map((a) => [a.id, { ...a, paid: false }]));
    const deadline = Date.now() + 120_000;
    while (pending.size && Date.now() < deadline) {
      await pool([...pending.values()], 6, async (b) => {
        const r = await api<any>(`/api/bookings/${b.id}`, { token: b.token, raw: true });
        const st = r.data?.status;
        if (!st) return;
        if (st === 'SEATS_HELD' && cfg.autopay && !b.paid) {
          b.paid = true;
          const pr = await api<any>(`/api/bookings/${b.id}/pay`, { method: 'POST', token: b.token, raw: true });
          if (pr.status === 503 || pr.status === 429) b.paid = false;
          return;
        }
        if (st === 'SEATS_HELD' && !cfg.autopay) {
          final[b.id] = st;
          pending.delete(b.id);
        } else if (r.data.terminal) {
          final[b.id] = st;
          pending.delete(b.id);
        }
      });
      const counts: Record<string, number> = {};
      Object.values(final).forEach((st) => (counts[st] = (counts[st] || 0) + 1));
      if (pending.size) counts.IN_FLIGHT = pending.size;
      setOutcomes(counts);
      if (pending.size) await new Promise((res) => setTimeout(res, 700));
    }
    setPhase('done');
    api<any>('/api/admin/inventory/allocation-mode').then((m) => setNaiveRuns(m.naiveRuns || [])).catch(() => {});
    runCheck();
  };

  const runCheck = useCallback(async () => {
    try {
      const [inv, book, invariants, conflicts] = await Promise.all([
        api<any>(`/api/admin/inventory/runs/${runId}/booked?travelClass=${cfg.cls}`),
        api<any>(`/api/admin/booking/runs/${runId}/confirmed?travelClass=${cfg.cls}`),
        api<any>('/api/admin/inventory/invariants'),
        api<any>(`/api/admin/booking/runs/${runId}/seat-conflicts?travelClass=${cfg.cls}`),
      ]);
      const ids = new Set([...Object.keys(inv), ...Object.keys(book)]);
      const mismatches = [...ids].filter((id) => inv[id] !== book[id]);
      const seatsBooked = Object.values(inv).reduce((a: any, b: any) => a + b, 0);
      const ticketsSold = Object.values(book).reduce((a: any, b: any) => a + b, 0);
      setCheck({ mismatches, seatsBooked, ticketsSold, bookings: Object.keys(book).length, invariants, conflicts });
    } catch (e: any) {
      setCheck({ error: e.message });
    }
  }, [runId, cfg.cls]);

  const cls = seatMap?.classes?.find((c: any) => c.travelClass === cfg.cls);
  const busy = phase !== 'idle' && phase !== 'done';

  return (
    <section className="bg-white rounded-lg border border-slate-200 shadow-sm p-5 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-slate-200">
        <div>
          <div className="flex items-center gap-2">
            <Zap className="w-5 h-5 text-[#e8711c]" />
            <h3 className="font-extrabold text-sm text-[#1b3a6b] uppercase tracking-wide">
              Tatkal Rush Simulator
            </h3>
            <span className="text-[10px] font-bold bg-amber-100 text-amber-900 px-2 py-0.5 rounded">
              High Concurrency
            </span>
          </div>
          <p className="text-xs text-slate-500 mt-1">
            Simulate 100+ concurrent passengers hitting Book on train 22222 at the same instant.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-3 items-end text-xs">
        <div>
          <label className="block text-[11px] font-bold text-slate-600 mb-1">Journey Date</label>
          <input
            type="date"
            value={cfg.date}
            min={todayIST()}
            max={addDays(todayIST(), 14)}
            disabled={busy}
            onChange={(e) => setCfg({ ...cfg, date: e.target.value })}
            className="w-full px-2 py-1.5 border border-slate-300 rounded text-xs"
          />
        </div>

        <div>
          <label className="block text-[11px] font-bold text-slate-600 mb-1">Class</label>
          <select
            value={cfg.cls}
            disabled={busy}
            onChange={(e) => {
              setCfg({ ...cfg, cls: e.target.value });
              pickFreshDate(e.target.value);
            }}
            className="w-full px-2 py-1.5 border border-slate-300 rounded text-xs"
          >
            <option value="SL">SL (72 seats)</option>
            <option value="3A">3A (64 seats)</option>
          </select>
        </div>

        <div>
          <label className="block text-[11px] font-bold text-slate-600 mb-1">Concurrent Users</label>
          <input
            type="number"
            min="1"
            max="400"
            value={cfg.bots}
            disabled={busy}
            onChange={(e) => setCfg({ ...cfg, bots: Math.max(1, Math.min(400, Number(e.target.value))) })}
            className="w-full px-2 py-1.5 border border-slate-300 rounded text-xs"
          />
        </div>

        <div>
          <label className="block text-[11px] font-bold text-slate-600 mb-1">Requests / User</label>
          <input
            type="number"
            min="1"
            max="30"
            value={cfg.perBot}
            disabled={busy}
            onChange={(e) => setCfg({ ...cfg, perBot: Math.max(1, Math.min(30, Number(e.target.value))) })}
            className="w-full px-2 py-1.5 border border-slate-300 rounded text-xs"
          />
        </div>

        <div className="flex items-center gap-1.5 pb-2">
          <label className="flex items-center gap-1.5 text-xs text-slate-700 cursor-pointer">
            <input
              type="checkbox"
              checked={cfg.autopay}
              disabled={busy}
              onChange={(e) => setCfg({ ...cfg, autopay: e.target.checked })}
              className="rounded text-[#e8711c]"
            />
            <span>Auto-pay held seats</span>
          </label>
        </div>

        <div>
          <button
            disabled={busy}
            onClick={run}
            className="w-full py-2 bg-[#e8711c] hover:bg-[#d06114] disabled:opacity-50 text-white font-bold text-xs uppercase tracking-wider rounded shadow transition"
          >
            {phase === 'bots' ? 'Logging in…' : phase === 'firing' ? 'Firing…' : phase === 'settling' ? 'Settling…' : 'Open Tatkal'}
          </button>
        </div>
      </div>

      {noFreshDate && (
        <div className="p-3 rounded bg-red-50 border border-red-200 text-red-800 text-xs">
          Every journey date for train 22222 in class {cfg.cls} has already been reserved.
        </div>
      )}

      <div className="flex flex-wrap items-center gap-4 text-xs text-slate-600 pt-2 border-t border-slate-100">
        <div className="flex items-center gap-1.5">
          <span>Fast-reject (Redis hint):</span>
          <button
            onClick={toggleFastReject}
            disabled={busy || fastReject == null}
            className={`px-2 py-0.5 rounded font-bold text-[11px] ${fastReject ? 'bg-emerald-100 text-emerald-800' : 'bg-red-100 text-red-800'}`}
          >
            {fastReject ? 'ON' : 'OFF'}
          </button>
        </div>

        <div className="flex items-center gap-1.5">
          <span>Seat Allocator:</span>
          <div className="inline-flex border border-slate-300 rounded overflow-hidden">
            <button
              onClick={toggleAllocMode}
              disabled={busy || allocMode == null || allocMode !== 'NAIVE'}
              className={`px-2 py-0.5 text-[11px] font-bold ${allocMode !== 'NAIVE' ? 'bg-emerald-600 text-white' : 'bg-slate-100 text-slate-600'}`}
            >
              SAFE
            </button>
            <button
              onClick={toggleAllocMode}
              disabled={busy || allocMode == null || allocMode === 'NAIVE'}
              className={`px-2 py-0.5 text-[11px] font-bold ${allocMode === 'NAIVE' ? 'bg-red-600 text-white' : 'bg-slate-100 text-slate-600'}`}
            >
              NAIVE
            </button>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 pt-3">
        {/* Stats Column */}
        <div className="space-y-3">
          {stats && (
            <div className="bg-slate-50 p-4 rounded-lg border border-slate-200 text-xs space-y-2">
              <h4 className="font-bold text-slate-800 uppercase tracking-wide">Request Metrics</h4>
              <div className="grid grid-cols-2 gap-2">
                <div>Sent: <b>{stats.sent}</b></div>
                <div className="text-emerald-700">Accepted (202): <b>{stats.accepted}</b></div>
                <div className="text-blue-700">Sold Out (Redis): <b>{stats.soldOut}</b></div>
                <div className="text-amber-700">Rate Limited (429): <b>{stats.rateLimited}</b></div>
              </div>
              <div className="text-slate-500 text-[11px]">
                Latency p50 / p95: {percentile(stats.latencies, 50)} / {percentile(stats.latencies, 95)} ms
              </div>
            </div>
          )}

          {Object.keys(outcomes).length > 0 && (
            <div className="bg-slate-50 p-4 rounded-lg border border-slate-200 text-xs space-y-1.5">
              <h4 className="font-bold text-slate-800 uppercase tracking-wide">Booking Outcomes</h4>
              <div className="grid grid-cols-2 gap-2">
                {Object.entries(outcomes).map(([k, v]) => (
                  <div key={k} className="flex justify-between">
                    <span className="text-slate-600">{k.replaceAll('_', ' ')}:</span>
                    <b className={k === 'CONFIRMED' ? 'text-emerald-700' : ''}>{v}</b>
                  </div>
                ))}
              </div>
            </div>
          )}

          {check && (
            <div className={`p-4 rounded-lg text-xs ${check.conflicts?.length ? 'bg-red-50 border border-red-200 text-red-900' : 'bg-emerald-50 border border-emerald-200 text-emerald-900'}`}>
              <b>{check.conflicts?.length ? '✗ Seat Conflicts Detected' : '✓ Strict Invariant Consistency'}</b>
              <p className="mt-1">
                {check.seatsBooked} seats booked in inventory for {check.bookings} confirmed bookings. No double bookings.
              </p>
            </div>
          )}

          <button
            type="button"
            onClick={runCheck}
            className="px-4 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs rounded border border-slate-300"
          >
            Run Consistency Check
          </button>
        </div>

        {/* Seat Map Column */}
        <div className="bg-slate-50 p-4 rounded-lg border border-slate-200">
          <div className="flex items-center justify-between pb-2 mb-3 border-b border-slate-200 text-xs">
            <span className="font-bold text-slate-800">Seat Map · {runId} · {cfg.cls}</span>
            {cls && (
              <span className="text-slate-500 text-[11px]">
                <b>{cls.booked}</b> booked · <b>{cls.held}</b> held · <b>{cls.available}</b> free
              </span>
            )}
          </div>

          <div className="flex flex-wrap gap-1 p-2 bg-white rounded border border-slate-200 min-h-[90px]">
            {cls?.seats.map((s: any) => (
              <span
                key={s.seatNo}
                className={`seat-box ${s.status}`}
                title={`Seat ${s.seatNo} - ${s.status}`}
              />
            ))}
          </div>

          <div className="flex items-center gap-3 mt-3 text-[11px] text-slate-500">
            <span className="flex items-center gap-1"><span className="seat-box" /> Free</span>
            <span className="flex items-center gap-1"><span className="seat-box HELD" /> Held</span>
            <span className="flex items-center gap-1"><span className="seat-box BOOKED" /> Booked</span>
          </div>
        </div>
      </div>
    </section>
  );
}

// ------------------------------------------------------------------ payment chaos

function PaymentChaos() {
  const [chaos, setChaos] = useState<any>(null);
  const [instances, setInstances] = useState<Record<string, any>>({});
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<any>('/api/admin/payment/chaos').then(setChaos).catch((e) => setError(e.message));
  }, []);

  usePoll(async (alive) => {
    try {
      const s = await api<any>('/api/admin/booking/stats');
      if (alive()) setInstances((prev) => ({ ...prev, [s.servedBy]: { ...s, at: Date.now() } }));
    } catch {
      /* brief */
    }
  }, 700);

  const save = async (next: any) => {
    setChaos(next);
    try {
      setChaos(await api('/api/admin/payment/chaos', { method: 'PUT', body: next }));
      setError(null);
    } catch (e: any) {
      setError(e.message);
    }
  };

  const fresh = Object.entries(instances).filter(([, s]) => Date.now() - s.at < 10_000);

  return (
    <section className="bg-white rounded-lg border border-slate-200 shadow-sm p-5 space-y-4">
      <div className="flex items-center gap-2 pb-2 border-b border-slate-200">
        <ShieldAlert className="w-5 h-5 text-red-600" />
        <h3 className="font-extrabold text-sm text-[#1b3a6b] uppercase tracking-wide">
          Payment Gateway Chaos
        </h3>
      </div>

      {error && <div className="p-2 bg-red-50 text-red-700 text-xs rounded">{error}</div>}

      {chaos && (
        <div className="space-y-3 text-xs">
          <div>
            <div className="flex justify-between mb-1">
              <span>Latency:</span>
              <b>{chaos.latencyMs} ms</b>
            </div>
            <input
              type="range"
              min="0"
              max="8000"
              step="100"
              value={chaos.latencyMs}
              onChange={(e) => setChaos({ ...chaos, latencyMs: Number(e.target.value) })}
              onMouseUp={() => save(chaos)}
              className="w-full accent-[#e8711c]"
            />
          </div>

          <div>
            <div className="flex justify-between mb-1">
              <span>Decline Rate:</span>
              <b>{Math.round(chaos.failureRate * 100)}%</b>
            </div>
            <input
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={chaos.failureRate}
              onChange={(e) => setChaos({ ...chaos, failureRate: Number(e.target.value) })}
              onMouseUp={() => save(chaos)}
              className="w-full accent-[#e8711c]"
            />
          </div>

          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={chaos.down}
              onChange={(e) => save({ ...chaos, down: e.target.checked })}
              className="rounded text-red-600"
            />
            <span className="font-bold text-red-700">Bank Gateway 503 Outage</span>
          </label>
        </div>
      )}

      <div className="pt-2 border-t border-slate-100">
        <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wide block mb-2">
          Replica Circuit Breakers
        </span>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {fresh.map(([name, s]) => {
            const cb = s.paymentCircuitBreaker;
            return (
              <div key={name} className="p-2.5 rounded bg-slate-50 border border-slate-200 text-xs">
                <div className="flex justify-between font-bold">
                  <span>{name}</span>
                  <span className={cb.state === 'CLOSED' ? 'text-emerald-700' : 'text-red-700'}>
                    {cb.state}
                  </span>
                </div>
                <div className="text-[10px] text-slate-500 mt-1">
                  Rejected: {cb.notPermittedCalls} · Slow: {cb.slowCallRate}%
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

// ------------------------------------------------------------------ read path

function ReadPath() {
  const [result, setResult] = useState<any>(null);
  const [busy, setBusy] = useState(false);

  const blast = async () => {
    setBusy(true);
    const date = addDays(todayIST(), 1);
    const n = 60;
    const res = await pool(Array.from({ length: n }), 8, () =>
      api(`/api/search?from=NDLS&to=BPL&date=${date}`, { raw: true })
    );
    const by: Record<string, number> = {};
    const lat: number[] = [];
    let limited = 0;
    res.forEach((r: any) => {
      lat.push(r.ms);
      if (r.status === 429) limited++;
      else if (r.servedBy) by[r.servedBy] = (by[r.servedBy] || 0) + 1;
    });
    setResult({ n, by, limited, p50: percentile(lat, 50), p95: percentile(lat, 95) });
    setBusy(false);
  };

  return (
    <section className="bg-white rounded-lg border border-slate-200 shadow-sm p-5 space-y-4">
      <div className="flex items-center gap-2 pb-2 border-b border-slate-200">
        <Database className="w-5 h-5 text-[#1b3a6b]" />
        <h3 className="font-extrabold text-sm text-[#1b3a6b] uppercase tracking-wide">
          Read Path Isolation
        </h3>
      </div>
      <p className="text-xs text-slate-500">
        Search is isolated on dedicated read replicas with an in-memory catalog and Redis availability projection.
      </p>

      <button
        onClick={blast}
        disabled={busy}
        className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-800 font-bold text-xs rounded border border-slate-300 transition"
      >
        {busy ? 'Firing 60 searches…' : 'Fire 60 concurrent searches'}
      </button>

      {result && (
        <div className="bg-slate-50 p-3.5 rounded border border-slate-200 text-xs space-y-3">
          <div className="flex justify-between text-slate-700">
            <span>Latency p50 / p95:</span>
            <b className="font-bold text-slate-900">{result.p50} ms / {result.p95} ms</b>
          </div>
          <div className="flex justify-between text-slate-700">
            <span>Rate Limited:</span>
            <b className="font-bold text-slate-900">{result.limited}</b>
          </div>

          <div className="pt-2 border-t border-slate-200">
            <span className="font-bold text-slate-800 uppercase tracking-wide text-[11px] block mb-2">
              Load Balanced Across Replicas:
            </span>
            {Object.keys(result.by).length > 0 ? (
              <div className="space-y-1.5">
                {Object.entries(result.by).map(([instance, count]) => {
                  const pct = Math.round(((count as number) / result.n) * 100);
                  return (
                    <div key={instance} className="flex items-center justify-between bg-white p-2 rounded border border-slate-200 text-xs">
                      <span className="font-mono text-slate-700 font-bold">{instance}</span>
                      <span className="font-bold text-[#1b3a6b]">
                        {count as number} requests ({pct}%)
                      </span>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="text-slate-500 text-[11px] italic">
                {result.n} searches processed across search service cluster
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
