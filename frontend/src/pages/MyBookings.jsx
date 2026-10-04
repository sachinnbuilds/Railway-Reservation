import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, fmtDate, rupees } from '../api.js';
import { StatusBadge } from './BookingPage.jsx';

export default function MyBookings() {
  const [list, setList] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    api('/api/bookings').then(setList).catch((e) => setError(e.message));
  }, []);

  if (error) return <div className="alert error">{error}</div>;
  if (!list) return <div className="card">Loading…</div>;

  return (
    <section>
      <h2>My trips</h2>
      {list.length === 0 && <div className="card empty">No bookings yet. <Link to="/">Search for a train</Link>.</div>}
      <div className="list">
        {list.map((b) => (
          <Link key={b.id} to={`/booking/${b.id}`} className="card list-item">
            <div>
              <b>{b.trainNumber} {b.trainName}</b>
              <div className="muted small">{b.from} → {b.to} · {fmtDate(b.journeyDate)} · {b.travelClass} · {b.seatCount} pax · PNR {b.pnr}</div>
            </div>
            <div className="right">
              <StatusBadge status={b.status} />
              <div className="muted small">{rupees(b.totalFare)}</div>
            </div>
          </Link>
        ))}
      </div>
    </section>
  );
}
