import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, fmtDate, rupees } from '../api.js';

const STEPS = [
  { key: 'PENDING', label: 'Queued' },
  { key: 'SEATS_HELD', label: 'Seats held' },
  { key: 'PAYMENT', label: 'Payment' },
  { key: 'CONFIRMED', label: 'Confirmed' },
];

function stepIndex(status) {
  switch (status) {
    case 'PENDING': return 0;
    case 'SEATS_HELD': return 1;
    case 'PAYMENT_PROCESSING': case 'PAYMENT_UNKNOWN': case 'CONFIRMING': return 2;
    case 'CONFIRMED': return 4;
    default: return -1;
  }
}

const FAILURE_COPY = {
  REJECTED: 'Sorry, the seats sold out before your request reached the front of the queue. No money was taken.',
  PAYMENT_FAILED: 'Payment failed. Your seats were released and no money was taken.',
  EXPIRED: 'Payment was not completed within the hold window, so the seats were released.',
  CANCELLED: 'This booking was cancelled.',
  FAILED: 'Your payment went through, but the seat hold had already expired. A full refund has been issued.',
};

export function StatusBadge({ status }) {
  return <span className={`badge b-${status}`}>{status.replaceAll('_', ' ')}</span>;
}

export default function BookingPage() {
  const { id } = useParams();
  const [b, setB] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    let alive = true;
    let timer;
    const poll = async () => {
      try {
        const data = await api(`/api/bookings/${id}`);
        if (!alive) return;
        setB(data);
        const stillMoving = !data.terminal || data.refundStatus === 'PENDING';
        timer = setTimeout(poll, stillMoving ? 1000 : 5000);
      } catch (e) {
        if (alive) {
          setError(e.message);
          timer = setTimeout(poll, 3000);
        }
      }
    };
    poll();
    const tick = setInterval(() => setNow(Date.now()), 500);
    return () => {
      alive = false;
      clearTimeout(timer);
      clearInterval(tick);
    };
  }, [id]);

  const act = async (fn) => {
    setBusy(true);
    setError(null);
    try {
      setB(await fn());
    } catch (e) {
      setError(e.message);
      // Show the real state right away (e.g. payment not attempted -> seats still held).
      api(`/api/bookings/${id}`).then(setB).catch(() => {});
    } finally {
      setBusy(false);
    }
  };

  if (!b) return <div className="card">{error ? <div className="alert error">{error}</div> : 'Loading booking…'}</div>;

  const idx = stepIndex(b.status);
  const holdLeft = b.holdExpiresAt ? Math.max(0, Math.round((new Date(b.holdExpiresAt) - now) / 1000)) : null;

  return (
    <div className="booking-page">
      <div className="card">
        <div className="row-between">
          <div>
            <div className="muted small">PNR</div>
            <div className="pnr">{b.pnr}</div>
          </div>
          <StatusBadge status={b.status} />
        </div>
        <h2>{b.trainNumber} {b.trainName}</h2>
        <p className="muted">
          {b.from} → {b.to} · departs {b.departureTime} · train starts {fmtDate(b.journeyDate)} · Class {b.travelClass} · {b.seatCount} passenger(s) · {rupees(b.totalFare)}
        </p>

        {idx >= 0 && (
          <ol className="stepper">
            {STEPS.map((s, i) => (
              <li key={s.key} className={i < idx ? 'done' : i === idx ? 'active' : ''}>{s.label}</li>
            ))}
          </ol>
        )}

        {b.status === 'PENDING' && (
          <div className="alert info">
            <span className="spinner" /> Your request is in the queue for this train. Seats are allocated strictly in arrival order.
          </div>
        )}

        {b.status === 'SEATS_HELD' && (
          <div className="alert ok">
            <div>
              Seats <b>{b.seats.join(', ')}</b> are held for you for <b className={holdLeft < 30 ? 'danger' : ''}>{Math.floor(holdLeft / 60)}:{String(holdLeft % 60).padStart(2, '0')}</b>. Complete payment to confirm.
            </div>
            <div className="row-end">
              <button className="btn ghost" disabled={busy} onClick={() => act(() => api(`/api/bookings/${id}`, { method: 'DELETE' }))}>Release seats</button>
              <button className="btn pay" disabled={busy || holdLeft === 0} onClick={() => act(() => api(`/api/bookings/${id}/pay`, { method: 'POST' }))}>
                {busy ? 'Contacting bank…' : `Pay ${rupees(b.totalFare)}`}
              </button>
            </div>
          </div>
        )}

        {(b.status === 'PAYMENT_PROCESSING' || b.status === 'CONFIRMING') && (
          <div className="alert info"><span className="spinner" /> {b.status === 'CONFIRMING' ? 'Payment received. Confirming your seats…' : 'Processing payment…'}</div>
        )}

        {b.status === 'PAYMENT_UNKNOWN' && (
          <div className="alert warn">
            <b>We are verifying your payment with the bank.</b> The bank did not answer in time, so we don’t yet know whether you were charged.
            Please <b>do not pay again</b>. This page updates automatically: if the charge went through, your ticket is confirmed; if not, nothing was taken.
          </div>
        )}

        {b.status === 'CONFIRMED' && (
          <div className="ticket">
            <div className="ticket-title">✓ Ticket confirmed</div>
            <table>
              <thead><tr><th>#</th><th>Passenger</th><th>Age</th><th>Seat</th></tr></thead>
              <tbody>
                {b.passengers.map((p, i) => (
                  <tr key={i}><td>{i + 1}</td><td>{p.name}</td><td>{p.age} {p.gender}</td><td><b>{b.seats[i] || '-'}</b></td></tr>
                ))}
              </tbody>
            </table>
            <div className="row-end">
              <button className="btn ghost danger" disabled={busy}
                onClick={() => window.confirm('Cancel this ticket? The fare will be refunded.') && act(() => api(`/api/bookings/${id}`, { method: 'DELETE' }))}>
                Cancel ticket
              </button>
            </div>
          </div>
        )}

        {FAILURE_COPY[b.status] && <div className={`alert ${b.status === 'CANCELLED' ? 'info' : 'error'}`}>{FAILURE_COPY[b.status]}</div>}
        {b.refundStatus === 'PENDING' && <div className="alert warn"><span className="spinner" /> Refund of {rupees(b.totalFare)} in progress…</div>}
        {b.refundStatus === 'DONE' && <div className="alert ok">Refund of {rupees(b.totalFare)} completed.</div>}
        {error && <div className="alert error">{error}</div>}
      </div>

      <div className="card">
        <h3>Saga timeline</h3>
        <p className="muted small">Every state change of this booking, as recorded by booking-service. Each step is driven by a Kafka event or the payment call.</p>
        <ul className="timeline">
          {b.history.map((h, i) => (
            <li key={i}>
              <span className="t">{new Date(h.at).toLocaleTimeString()}</span>
              <StatusBadge status={h.status} />
              <span>{h.note}</span>
            </li>
          ))}
        </ul>
        <Link to="/bookings" className="link">← All my trips</Link>
      </div>
    </div>
  );
}
