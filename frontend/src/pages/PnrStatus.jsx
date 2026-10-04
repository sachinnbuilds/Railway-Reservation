import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, fmtDate } from '../api.js';
import { StatusBadge } from './BookingPage.jsx';

export default function PnrStatus({ auth }) {
  const [pnr, setPnr] = useState('');
  const [b, setB] = useState(null);
  const [error, setError] = useState(null);

  const check = async (e) => {
    e.preventDefault();
    setError(null);
    setB(null);
    try {
      setB(await api(`/api/bookings/pnr/${pnr.trim()}`));
    } catch (err) {
      setError(err.message);
    }
  };

  if (!auth) {
    return <div className="card">Please <Link to="/login">log in</Link> to check PNR status.</div>;
  }

  return (
    <section className="narrow">
      <h2>PNR status</h2>
      <form className="card row" onSubmit={check}>
        <input placeholder="10-digit PNR" value={pnr} onChange={(e) => setPnr(e.target.value)} pattern="\d{10}" required />
        <button className="btn">Check</button>
      </form>
      {error && <div className="alert error">{error}</div>}
      {b && (
        <div className="card">
          <div className="row-between"><div className="pnr">{b.pnr}</div><StatusBadge status={b.status} /></div>
          <p><b>{b.trainNumber} {b.trainName}</b> · {b.from} → {b.to} · {fmtDate(b.journeyDate)} · {b.travelClass}</p>
          <table className="pax">
            <thead><tr><th>Passenger</th><th>Age</th><th>Seat</th></tr></thead>
            <tbody>{b.passengers.map((p, i) => <tr key={i}><td>{p.name}</td><td>{p.age}</td><td>{b.status === 'CONFIRMED' ? b.seats[i] : '-'}</td></tr>)}</tbody>
          </table>
        </div>
      )}
    </section>
  );
}
