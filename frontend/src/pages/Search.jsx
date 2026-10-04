import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { addDays, api, fmtDate, rupees, todayIST, uuid } from '../api.js';

const STATUS_LABEL = {
  AVAILABLE: (c) => `AVL ${c.available}`,
  SOLD_OUT: () => 'SOLD OUT',
  CHECK_AT_BOOKING: () => 'Check at booking',
  NOT_OPEN: () => 'Not open',
};

function duration(min) {
  return `${Math.floor(min / 60)}h ${String(min % 60).padStart(2, '0')}m`;
}

export default function Search({ auth }) {
  const today = todayIST();
  const [stations, setStations] = useState([]);
  const [q, setQ] = useState({ from: 'NDLS', to: 'BPL', date: addDays(today, 1) });
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState(null); // { train, cls }

  useEffect(() => {
    api('/api/stations').then(setStations).catch((e) => setError(e.message));
  }, []);

  const search = async (e) => {
    e?.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams(q);
      setResult(await api(`/api/search?${params}`));
    } catch (err) {
      setError(err.message);
      setResult(null);
    } finally {
      setLoading(false);
    }
  };

  const swap = () => setQ({ ...q, from: q.to, to: q.from });

  return (
    <>
      <section className="hero">
        <h1>Book train tickets</h1>
        <p>Search is served by a cached, horizontally scaled read path. Booking goes through a separate, strictly consistent saga.</p>
        <form className="search-bar card" onSubmit={search}>
          <label>From
            <select value={q.from} onChange={(e) => setQ({ ...q, from: e.target.value })}>
              {stations.map((s) => <option key={s.code} value={s.code}>{s.city} – {s.name} ({s.code})</option>)}
            </select>
          </label>
          <button type="button" className="swap" onClick={swap} aria-label="Swap stations">⇄</button>
          <label>To
            <select value={q.to} onChange={(e) => setQ({ ...q, to: e.target.value })}>
              {stations.map((s) => <option key={s.code} value={s.code}>{s.city} – {s.name} ({s.code})</option>)}
            </select>
          </label>
          <label>Date
            <input type="date" value={q.date} min={today} max={addDays(today, 14)}
              onChange={(e) => setQ({ ...q, date: e.target.value })} />
          </label>
          <button className="btn" disabled={loading}>{loading ? 'Searching…' : 'Search trains'}</button>
        </form>
        <div className="quick">
          Try:
          <button className="chip" onClick={() => setQ({ from: 'NDLS', to: 'MAS', date: q.date })}>Delhi → Chennai</button>
          <button className="chip" onClick={() => setQ({ from: 'MMCT', to: 'NDLS', date: q.date })}>Mumbai → Delhi</button>
          <button className="chip" onClick={() => setQ({ from: 'NDLS', to: 'SC', date: q.date })}>Delhi → Hyderabad</button>
          <button className="chip hot" onClick={() => setQ({ from: 'NDLS', to: 'MMCT', date: q.date })}>Tatkal demo train</button>
        </div>
      </section>

      {error && <div className="alert error">{error}</div>}

      {result && (
        <section>
          <div className="result-head">
            <h2>{result.trains.length} trains · {result.from} → {result.to} · {fmtDate(result.date)}</h2>
            <span className={`pill ${result.availabilityLive ? 'ok' : 'warn'}`} title={result.note}>
              {result.availabilityLive ? 'Live availability' : 'Degraded: availability offline'}
            </span>
            <span className="muted small">served by <code>{result.servedBy}</code></span>
          </div>
          <p className="muted small">{result.note}</p>
          {result.trains.length === 0 && <div className="card empty">No direct trains on this route.</div>}
          {result.trains.map((t) => (
            <article key={t.number} className="card train">
              <div className="train-head">
                <div>
                  <span className="train-no">{t.number}</span> <b>{t.name}</b>
                  <span className="tag">{t.type}</span>
                </div>
                <span className="muted small">{t.distanceKm} km</span>
              </div>
              <div className="timing">
                <div><b>{t.departure}</b><span className="muted">{t.from} · {fmtDate(t.boardingDate)}</span></div>
                <div className="line"><span>{duration(t.durationMinutes)}</span></div>
                <div className="right"><b>{t.arrival}</b><span className="muted">{t.to} · {fmtDate(t.arrivalDate)}</span></div>
              </div>
              <div className="classes">
                {t.classes.map((c) => (
                  <button key={c.code}
                    className={`class-tile s-${c.status}`}
                    disabled={c.status === 'NOT_OPEN'}
                    onClick={() => setSelected({ train: t, cls: c })}>
                    <div className="class-top"><b>{c.code}</b><span>{rupees(c.fare)}</span></div>
                    <div className="class-name muted small">{c.name}</div>
                    <div className="class-status">{STATUS_LABEL[c.status](c)}</div>
                    {c.ageSeconds != null && <div className="muted tiny">as of {c.ageSeconds}s ago</div>}
                  </button>
                ))}
              </div>
            </article>
          ))}
        </section>
      )}

      {selected && <BookDialog auth={auth} selection={selected} onClose={() => setSelected(null)} />}
    </>
  );
}

function BookDialog({ auth, selection, onClose }) {
  const { train, cls } = selection;
  const navigate = useNavigate();
  const [passengers, setPassengers] = useState([{ name: auth?.user?.name || '', age: 30, gender: 'M' }]);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  // One key per dialog: double-clicks and retries after a timeout return the same booking.
  const [idempotencyKey] = useState(uuid());

  if (!auth) {
    return (
      <Modal onClose={onClose}>
        <h3>Log in to book</h3>
        <p className="muted">You need an account to book {train.number} in {cls.code}.</p>
        <button className="btn" onClick={() => navigate('/login', { state: { from: '/' } })}>Log in</button>
      </Modal>
    );
  }

  const update = (i, k, v) => setPassengers(passengers.map((p, j) => (j === i ? { ...p, [k]: v } : p)));

  const book = async () => {
    setBusy(true);
    setError(null);
    try {
      const b = await api('/api/bookings', {
        method: 'POST',
        headers: { 'Idempotency-Key': idempotencyKey },
        body: {
          trainNumber: train.number, journeyDate: train.journeyDate, from: train.from, to: train.to,
          travelClass: cls.code, passengers: passengers.map((p) => ({ ...p, age: Number(p.age) })),
        },
      });
      navigate(`/booking/${b.id}`);
    } catch (err) {
      setError(err.code === 'SOLD_OUT' ? `${err.message}. (Rejected instantly by the Redis fast-reject - no database work was done.)` : err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal onClose={onClose}>
      <h3>{train.number} {train.name}</h3>
      <p className="muted">
        {train.from} {train.departure} → {train.to} {train.arrival} · {fmtDate(train.boardingDate)} · Class <b>{cls.code}</b> · {rupees(cls.fare)} / passenger
      </p>
      <table className="pax">
        <thead><tr><th>Passenger</th><th>Age</th><th>Gender</th><th /></tr></thead>
        <tbody>
          {passengers.map((p, i) => (
            <tr key={i}>
              <td><input value={p.name} placeholder="Full name" onChange={(e) => update(i, 'name', e.target.value)} /></td>
              <td><input type="number" min="1" max="120" value={p.age} onChange={(e) => update(i, 'age', e.target.value)} /></td>
              <td>
                <select value={p.gender} onChange={(e) => update(i, 'gender', e.target.value)}>
                  <option value="M">Male</option><option value="F">Female</option><option value="O">Other</option>
                </select>
              </td>
              <td>{passengers.length > 1 && <button className="link" onClick={() => setPassengers(passengers.filter((_, j) => j !== i))}>remove</button>}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {passengers.length < 6 && (
        <button className="link" onClick={() => setPassengers([...passengers, { name: '', age: 30, gender: 'F' }])}>+ Add passenger</button>
      )}
      <div className="total">Total <b>{rupees(cls.fare * passengers.length)}</b></div>
      {error && <div className="alert error">{error}</div>}
      <div className="row-end">
        <button className="btn ghost" onClick={onClose}>Cancel</button>
        <button className="btn" disabled={busy || passengers.some((p) => !p.name.trim())} onClick={book}>
          {busy ? 'Submitting…' : 'Book now'}
        </button>
      </div>
    </Modal>
  );
}

export function Modal({ children, onClose }) {
  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal card" onClick={(e) => e.stopPropagation()}>
        <button className="close" onClick={onClose} aria-label="Close">×</button>
        {children}
      </div>
    </div>
  );
}
