import { useCallback, useEffect, useRef, useState } from 'react';
import { addDays, api, runIdOf, todayIST, uuid } from '../api.js';

// Demo dashboard: every panel maps to one of the five problems the architecture addresses.

export default function ControlRoom() {
  return (
    <div className="control-room">
      <header className="cr-head">
        <h1>Control room</h1>
        <p className="muted">
          Live view of the distributed system. Use it to trigger a Tatkal rush, break the payment gateway, and check that the seat
          data stayed consistent.
        </p>
      </header>
      <Registry />
      <TatkalSimulator />
      <div className="grid-2">
        <PaymentChaos />
        <ReadPath />
      </div>
    </div>
  );
}

function usePoll(fn, ms, deps = []) {
  useEffect(() => {
    let alive = true;
    let t;
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
  const [apps, setApps] = useState(null);
  const [error, setError] = useState(null);

  usePoll(async (alive) => {
    try {
      const r = await api('/api/admin/registry');
      const list = (r.applications?.application || []).map((a) => ({
        name: a.name.toLowerCase(),
        instances: a.instance.map((i) => ({ id: i.instanceId, host: i.hostName, status: i.status })),
      }));
      list.sort((a, b) => a.name.localeCompare(b.name));
      if (alive()) {
        setApps(list);
        setError(null);
      }
    } catch (e) {
      if (alive()) setError(e.message);
    }
  }, 3000);

  return (
    <section className="card">
      <div className="row-between">
        <h3>Service registry (Eureka)</h3>
        <span className="muted small">Each service scales on its own; the gateway load-balances across the instances listed here.</span>
      </div>
      {error && <div className="alert warn">{error}</div>}
      <div className="registry">
        {apps?.map((a) => (
          <div key={a.name} className="svc">
            <div className="svc-name">{a.name}</div>
            <div className="svc-inst">
              {a.instances.map((i) => (
                <span key={i.id} className={`dot ${i.status === 'UP' ? 'up' : 'down'}`} title={`${i.id} (${i.status})`} />
              ))}
              <span className="muted small">×{a.instances.length}</span>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

// ------------------------------------------------------------------ Tatkal rush (problems 1 & 2)

const BOT_PASSWORD = 'tatkal-bot-123';

async function pool(items, limit, worker) {
  const results = [];
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

function percentile(values, p) {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => a - b);
  return Math.round(s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))]);
}

function TatkalSimulator() {
  const [cfg, setCfg] = useState({ date: addDays(todayIST(), 1), cls: 'SL', bots: 120, perBot: 1, autopay: true });
  const [phase, setPhase] = useState('idle');
  const [stats, setStats] = useState(null);
  const [outcomes, setOutcomes] = useState({});
  const [seatMap, setSeatMap] = useState(null);
  const [check, setCheck] = useState(null);
  const [fastReject, setFastReject] = useState(null);
  const [allocMode, setAllocMode] = useState(null);
  const [naiveRuns, setNaiveRuns] = useState([]);
  const [noFreshDate, setNoFreshDate] = useState(false);
  const bots = useRef({});
  const runId = runIdOf('22222', cfg.date);

  usePoll(async (alive) => {
    try {
      const m = await api(`/api/admin/inventory/runs/${runId}/seats`);
      if (alive()) setSeatMap(m);
    } catch {
      if (alive()) setSeatMap(null);
    }
  }, phase === 'idle' || phase === 'done' ? 4000 : 800, [runId, phase]);

  useEffect(() => {
    api('/api/admin/booking/stats').then((s) => setFastReject(s.fastRejectEnabled)).catch(() => {});
    api('/api/admin/inventory/allocation-mode').then((m) => { setAllocMode(m.mode); setNaiveRuns(m.naiveRuns); }).catch(() => {});
    pickFreshDate(cfg.cls);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Move to the first day whose coach of this class is completely untouched, so every rush starts clean. */
  const pickFreshDate = async (cls) => {
    for (let d = 1; d < 15; d++) {
      const date = addDays(todayIST(), d);
      try {
        const m = await api(`/api/admin/inventory/runs/${runIdOf('22222', date)}/seats`);
        const c = m.classes.find((x) => x.travelClass === cls);
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
    setNoFreshDate(true); // every date in the booking window has been used for this class
    return false;
  };

  const toggleFastReject = async () => {
    const r = await api(`/api/admin/booking/fast-reject?enabled=${!fastReject}`, { method: 'PUT' });
    setFastReject(r.fastRejectEnabled);
  };

  const toggleAllocMode = async () => {
    const next = allocMode === 'NAIVE' ? 'SAFE' : 'NAIVE';
    if (next === 'NAIVE' && !window.confirm('Switch to the deliberately broken NAIVE allocator? Use a fresh journey date: the run will be corrupted.')) return;
    const r = await api(`/api/admin/inventory/allocation-mode?mode=${next}`, { method: 'PUT' });
    setAllocMode(r.mode);
    setNaiveRuns(r.naiveRuns);
    // Never mix modes on one train run: start the new mode on an untouched date.
    await pickFreshDate(cfg.cls);
  };

  const ensureBots = async (n) => {
    const ids = Array.from({ length: n }, (_, i) => i);
    await pool(ids, 12, async (i) => {
      if (bots.current[i]) return;
      const email = `bot${i}@tatkal.sim`;
      let r = await api('/api/auth/login', { method: 'POST', body: { email, password: BOT_PASSWORD }, raw: true });
      if (r.status !== 200) {
        r = await api('/api/auth/register', { method: 'POST', body: { name: `Bot ${i}`, email, password: BOT_PASSWORD }, raw: true });
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
    const s = { sent: 0, accepted: 0, soldOut: 0, rateLimited: 0, unavailable: 0, other: 0, latencies: [], servedBy: {} };
    setStats({ ...s });
    const requests = tokens.flatMap((token) => Array.from({ length: cfg.perBot }, () => token));
    const accepted = [];
    const started = performance.now();
    // Fire everything at once, like a Tatkal window opening.
    await Promise.all(
      requests.map(async (token) => {
        const r = await api('/api/bookings', {
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
    const final = {};
    const pending = new Map(accepted.map((a) => [a.id, { ...a, paid: false }]));
    const deadline = Date.now() + 120_000;
    while (pending.size && Date.now() < deadline) {
      await pool([...pending.values()], 6, async (b) => {
        const r = await api(`/api/bookings/${b.id}`, { token: b.token, raw: true });
        const st = r.data?.status;
        if (!st) return;
        if (st === 'SEATS_HELD' && cfg.autopay && !b.paid) {
          b.paid = true;
          const pr = await api(`/api/bookings/${b.id}/pay`, { method: 'POST', token: b.token, raw: true });
          if (pr.status === 503 || pr.status === 429) b.paid = false; // nothing charged: retry next round
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
      const counts = {};
      Object.values(final).forEach((st) => (counts[st] = (counts[st] || 0) + 1));
      if (pending.size) counts.IN_FLIGHT = pending.size;
      setOutcomes(counts);
      if (pending.size) await new Promise((res) => setTimeout(res, 700));
    }
    setPhase('done');
    api('/api/admin/inventory/allocation-mode').then((m) => setNaiveRuns(m.naiveRuns)).catch(() => {});
    runCheck();
  };

  const runCheck = useCallback(async () => {
    try {
      const [inv, book, invariants, conflicts] = await Promise.all([
        api(`/api/admin/inventory/runs/${runId}/booked?travelClass=${cfg.cls}`),
        api(`/api/admin/booking/runs/${runId}/confirmed?travelClass=${cfg.cls}`),
        api('/api/admin/inventory/invariants'),
        api(`/api/admin/booking/runs/${runId}/seat-conflicts?travelClass=${cfg.cls}`),
      ]);
      const ids = new Set([...Object.keys(inv), ...Object.keys(book)]);
      const mismatches = [...ids].filter((id) => inv[id] !== book[id]);
      const seatsBooked = Object.values(inv).reduce((a, b) => a + b, 0);
      const ticketsSold = Object.values(book).reduce((a, b) => a + b, 0);
      setCheck({ mismatches, seatsBooked, ticketsSold, bookings: Object.keys(book).length, invariants, conflicts });
    } catch (e) {
      setCheck({ error: e.message });
    }
  }, [runId, cfg.cls]);

  const cls = seatMap?.classes?.find((c) => c.travelClass === cfg.cls);
  const busy = phase !== 'idle' && phase !== 'done';

  return (
    <section className="card">
      <div className="row-between">
        <div>
          <h3>Tatkal rush simulator <span className="tag">problems 1 &amp; 2</span></h3>
          <p className="muted small">
            Many users hit “Book” on train 22222 (NDLS → MMCT) at the same instant. Watch the gateway rate limiter, the Redis
            fast-reject and the per-train Kafka queue absorb the spike while every seat is sold exactly once.
          </p>
        </div>
      </div>
      <div className="sim-controls">
        <label>Journey date
          <input type="date" value={cfg.date} min={todayIST()} max={addDays(todayIST(), 14)} disabled={busy}
            onChange={(e) => setCfg({ ...cfg, date: e.target.value })} />
        </label>
        <label>Class
          <select value={cfg.cls} disabled={busy} onChange={(e) => { setCfg({ ...cfg, cls: e.target.value }); pickFreshDate(e.target.value); }}>
            <option value="SL">SL (72 seats)</option><option value="3A">3A (64 seats)</option>
          </select>
        </label>
        <label>Users
          <input type="number" min="1" max="400" value={cfg.bots} disabled={busy}
            onChange={(e) => setCfg({ ...cfg, bots: Math.max(1, Math.min(400, Number(e.target.value))) })} />
        </label>
        <label>Requests per user
          <input type="number" min="1" max="30" value={cfg.perBot} disabled={busy}
            onChange={(e) => setCfg({ ...cfg, perBot: Math.max(1, Math.min(30, Number(e.target.value))) })} />
        </label>
        <label className="check"><input type="checkbox" checked={cfg.autopay} disabled={busy}
          onChange={(e) => setCfg({ ...cfg, autopay: e.target.checked })} /> Auto-pay held seats</label>
        <button className="btn hot" disabled={busy} onClick={run}>
          {phase === 'bots' ? 'Logging users in…' : phase === 'firing' ? 'Firing…' : phase === 'settling' ? 'Settling…' : 'Open Tatkal window'}
        </button>
      </div>
      {noFreshDate && (
        <div className="alert error small">
          Every journey date of train 22222 in class {cfg.cls} has already been used, so the next rush would land on a train
          that is partly sold{naiveRuns.includes(runId) ? ' (and corrupted by the NAIVE demo)' : ''}. Try the other class, or
          reset the demo data with <code>scripts/reset-demo-data.sh</code>.
        </div>
      )}
      {naiveRuns.includes(runId) && (
        <div className="alert warn small">
          {runId} was used for the NAIVE demo, so its seats are already corrupted. Results for this date mix both modes.{' '}
          <button className="link" disabled={busy} onClick={() => pickFreshDate(cfg.cls)}>Switch to a fresh date</button>
        </div>
      )}
      <div className="row small muted">
        Fast-reject (Redis hint):
        <button className={`toggle ${fastReject ? 'on' : ''}`} onClick={toggleFastReject} disabled={busy || fastReject == null}>
          {fastReject ? 'ON' : 'OFF'}
        </button>
        <span className="seg-label">Seat allocator:</span>
        <span className="seg" role="group" aria-label="Seat allocator">
          <button className={allocMode !== 'NAIVE' ? 'active safe' : ''} disabled={busy || allocMode == null || allocMode !== 'NAIVE'}
            onClick={toggleAllocMode}>SAFE</button>
          <button className={allocMode === 'NAIVE' ? 'active naive' : ''} disabled={busy || allocMode == null || allocMode === 'NAIVE'}
            onClick={toggleAllocMode}
            title="Read free seats, then write them: no locks, no per-train ordering. Shows the double booking our design prevents.">
            NAIVE (broken)
          </button>
        </span>
        <span>Tip: set users = 1 and requests per user = 20 to watch the per-user rate limiter return 429s.</span>
      </div>

      <div className="sim-body">
        <div className="sim-stats">
          {stats && (
            <>
              <h4>Requests</h4>
              <Stat label="Sent" value={stats.sent} />
              <Stat label="Accepted (202, queued)" value={stats.accepted} tone="ok" />
              <Stat label="Sold out instantly (Redis fast-reject)" value={stats.soldOut} tone="info" />
              <Stat label="Rate limited (429 at gateway)" value={stats.rateLimited} tone="warn" />
              <Stat label="Unavailable / other errors" value={stats.unavailable + stats.other} tone={stats.unavailable + stats.other ? 'bad' : ''} />
              <Stat label="Latency p50 / p95" value={`${percentile(stats.latencies, 50)} / ${percentile(stats.latencies, 95)} ms`} />
              {stats.wallMs && <Stat label="All responses within" value={`${Math.round(stats.wallMs)} ms`} />}
              <div className="muted tiny">Answered by: {Object.entries(stats.servedBy).map(([k, v]) => `${k} ×${v}`).join(', ')}</div>
            </>
          )}
          {Object.keys(outcomes).length > 0 && (
            <>
              <h4>Booking outcomes</h4>
              {Object.entries(outcomes).map(([k, v]) => <Stat key={k} label={k.replaceAll('_', ' ')} value={v} tone={k === 'CONFIRMED' ? 'ok' : k === 'IN_FLIGHT' ? '' : 'info'} />)}
            </>
          )}
          {check && <ConsistencyResult check={check} capacity={cls?.total} travelClass={cfg.cls} naiveRun={naiveRuns.includes(runId)} />}
          <button className="btn ghost sm" onClick={runCheck}>Run consistency check</button>
        </div>
        <div className="sim-seats">
          <div className="row-between">
            <h4>Seat map · {runId} · {cfg.cls}</h4>
            {cls && <span className="small"><b>{cls.booked}</b> booked · <b>{cls.held}</b> held · <b>{cls.available}</b> free</span>}
          </div>
          <div className="seat-grid">
            {cls?.seats.map((s) => <span key={s.seatNo} className={`seat ${s.status}`} title={`${s.seatNo} ${s.status}`} />)}
          </div>
          <div className="legend small"><span className="seat AVAILABLE" /> free <span className="seat HELD" /> held <span className="seat BOOKED" /> booked</div>
        </div>
      </div>
    </section>
  );
}

function ConsistencyResult({ check, capacity, travelClass, naiveRun }) {
  if (check.error) return <div className="alert warn">Consistency check failed: {check.error}</div>;
  const inv = check.invariants;
  const ok = check.mismatches.length === 0 && check.conflicts.length === 0 && inv.seatsWithoutOwnerButTaken === 0
    && inv.bookingsSpanningRunsOrClasses === 0 && inv.bookingsMixingHeldAndBooked === 0;
  if (check.conflicts.length > 0) {
    return (
      <div className="alert error">
        <b>✗ DOUBLE BOOKING</b>: {check.ticketsSold} confirmed {travelClass} tickets for {capacity ?? '?'} {travelClass} seats.
        {' '}{check.conflicts.length} seats were sold to more than one passenger, for example:
        <ul className="tiny">
          {check.conflicts.slice(0, 5).map((c) => <li key={c.seat}>seat <b>{c.seat}</b> on PNRs {c.pnrs.join(', ')}</li>)}
        </ul>
        Inventory and booking also disagree on {check.mismatches.length} bookings.
        {naiveRun && <div><b>This date was allocated by the NAIVE allocator</b>: these conflicts come from that run. Check a SAFE run on a fresh date.</div>}
      </div>
    );
  }
  return (
    <div className={`alert ${ok ? 'ok' : 'error'}`}>
      <b>{ok ? '✓ Consistent' : '✗ Inconsistent'}</b>: {check.seatsBooked} of {capacity ?? '?'} {travelClass} seats booked in
      inventory, for {check.bookings} confirmed {travelClass} bookings in booking-service;
      {' '}{check.mismatches.length} mismatches across the two databases; no seat printed on two tickets (enforced by a single row per seat plus CHECK constraints).
      {check.mismatches.length > 0 && <div className="tiny">If a cancellation is still in flight, re-run in a few seconds.</div>}
    </div>
  );
}

function Stat({ label, value, tone = '' }) {
  return (
    <div className={`stat ${tone}`}>
      <span>{label}</span>
      <b>{value}</b>
    </div>
  );
}

// ------------------------------------------------------------------ payment chaos (problems 3 & 4)

function PaymentChaos() {
  const [chaos, setChaos] = useState(null);
  const [instances, setInstances] = useState({});
  const [error, setError] = useState(null);

  useEffect(() => {
    api('/api/admin/payment/chaos').then(setChaos).catch((e) => setError(e.message));
  }, []);

  usePoll(async (alive) => {
    // Successive calls land on different booking-service replicas; keep the latest view of each.
    try {
      const s = await api('/api/admin/booking/stats');
      if (alive()) setInstances((prev) => ({ ...prev, [s.servedBy]: { ...s, at: Date.now() } }));
    } catch {
      /* booking-service briefly unavailable */
    }
  }, 700);

  const save = async (next) => {
    setChaos(next);
    try {
      setChaos(await api('/api/admin/payment/chaos', { method: 'PUT', body: next }));
      setError(null);
    } catch (e) {
      setError(e.message);
    }
  };

  const fresh = Object.entries(instances).filter(([, s]) => Date.now() - s.at < 10_000);

  return (
    <section className="card">
      <h3>Payment gateway chaos <span className="tag">problems 3 &amp; 4</span></h3>
      <p className="muted small">
        Make the mock bank slow, flaky, or down, then pay for a booking. Slow calls trip each booking replica’s circuit breaker, so
        users get an instant “try again, no money taken” instead of a hung page, and search keeps working.
      </p>
      {error && <div className="alert error">{error}</div>}
      {chaos && (
        <div className="chaos">
          <label>Latency <b>{chaos.latencyMs} ms</b>
            <input type="range" min="0" max="8000" step="100" value={chaos.latencyMs}
              onChange={(e) => setChaos({ ...chaos, latencyMs: Number(e.target.value) })}
              onMouseUp={() => save(chaos)} onTouchEnd={() => save(chaos)} onKeyUp={() => save(chaos)} />
          </label>
          <label>Decline rate <b>{Math.round(chaos.failureRate * 100)}%</b>
            <input type="range" min="0" max="1" step="0.05" value={chaos.failureRate}
              onChange={(e) => setChaos({ ...chaos, failureRate: Number(e.target.value) })}
              onMouseUp={() => save(chaos)} onTouchEnd={() => save(chaos)} onKeyUp={() => save(chaos)} />
          </label>
          <label title="The charge succeeds but the response arrives after booking-service has given up waiting">
            Charged-but-timed-out rate <b>{Math.round(chaos.timeoutAfterChargeRate * 100)}%</b>
            <input type="range" min="0" max="1" step="0.05" value={chaos.timeoutAfterChargeRate}
              onChange={(e) => setChaos({ ...chaos, timeoutAfterChargeRate: Number(e.target.value) })}
              onMouseUp={() => save(chaos)} onTouchEnd={() => save(chaos)} onKeyUp={() => save(chaos)} />
          </label>
          <label className="check">
            <input type="checkbox" checked={chaos.down} onChange={(e) => save({ ...chaos, down: e.target.checked })} /> Gateway down (503)
          </label>
          <div className="row">
            <button className="btn ghost sm" onClick={() => save({ latencyMs: 300, failureRate: 0, timeoutAfterChargeRate: 0, down: false })}>Reset to healthy</button>
            <button className="btn ghost sm" onClick={() => save({ latencyMs: 4000, failureRate: 0, timeoutAfterChargeRate: 0, down: false })}>Slow bank</button>
            <button className="btn ghost sm" onClick={() => save({ latencyMs: 300, failureRate: 0, timeoutAfterChargeRate: 1, down: false })}>Money deducted, no reply</button>
          </div>
        </div>
      )}
      <h4>Circuit breaker per booking-service replica</h4>
      <div className="breakers">
        {fresh.length === 0 && <span className="muted small">Waiting for stats…</span>}
        {fresh.map(([name, s]) => {
          const cb = s.paymentCircuitBreaker;
          return (
            <div key={name} className={`breaker ${cb.state}`}>
              <div className="b-state">{cb.state.replaceAll('_', ' ')}</div>
              <div className="tiny">booking-service@{name}</div>
              <div className="tiny">failure {fmtRate(cb.failureRate)} · slow {fmtRate(cb.slowCallRate)} · rejected {cb.notPermittedCalls}</div>
              <div className="tiny">bulkhead {s.paymentBulkhead.available}/{s.paymentBulkhead.max} free · refunds pending {s.refundsPending}</div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

const fmtRate = (r) => (r < 0 ? '–' : `${Math.round(r)}%`);

// ------------------------------------------------------------------ read path (problem 5)

function ReadPath() {
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);

  const blast = async () => {
    setBusy(true);
    const date = addDays(todayIST(), 1);
    const n = 60;
    const res = await pool(Array.from({ length: n }), 8, () =>
      api(`/api/search?from=NDLS&to=BPL&date=${date}`, { raw: true }));
    const by = {};
    const lat = [];
    let limited = 0;
    res.forEach((r) => {
      lat.push(r.ms);
      if (r.status === 429) limited++;
      else if (r.servedBy) by[r.servedBy] = (by[r.servedBy] || 0) + 1;
    });
    setResult({ n, by, limited, p50: percentile(lat, 50), p95: percentile(lat, 95) });
    setBusy(false);
  };

  return (
    <section className="card">
      <h3>Read path isolation <span className="tag">problem 5</span></h3>
      <p className="muted small">
        Search runs on its own replicas with an in-memory catalog and a Redis availability projection fed by Kafka. It never queries
        the inventory or booking databases, and it has its own rate-limit bucket, so browsing cannot slow down booking.
      </p>
      <button className="btn ghost" onClick={blast} disabled={busy}>{busy ? 'Searching…' : 'Fire 60 searches'}</button>
      {result && (
        <div className="lb">
          <div className="small">p50 {result.p50} ms · p95 {result.p95} ms · rate-limited {result.limited}</div>
          {Object.entries(result.by).map(([k, v]) => (
            <div key={k} className="lb-row">
              <code className="tiny">{k}</code>
              <div className="bar"><span style={{ width: `${(v / result.n) * 100}%` }} /></div>
              <b className="small">{v}</b>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
