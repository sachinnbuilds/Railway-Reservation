import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { StatusBadge } from './BookingPage.jsx';

export default function Notifications() {
  const [list, setList] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    const load = () => api('/api/notifications').then((l) => { setList(l); setError(null); }).catch((e) => setError(e.message));
    load();
    const t = setInterval(load, 4000);
    return () => clearInterval(t);
  }, []);

  return (
    <section>
      <h2>Alerts</h2>
      <p className="muted">
        SMS-style messages produced by <code>notification-service</code> from Kafka events. It is not on the booking path:
        stop it and bookings still confirm; the messages appear here when it comes back.
      </p>
      {error && <div className="alert warn">Notifications are temporarily unavailable ({error}). Your bookings are not affected.</div>}
      {list && list.length === 0 && <div className="card empty">No alerts yet.</div>}
      <div className="list">
        {list?.map((n) => (
          <div key={n.id} className="card list-item">
            <div>
              <div>{n.message}</div>
              <div className="muted small">{new Date(n.createdAt).toLocaleString()} · {n.channel}</div>
            </div>
            <StatusBadge status={n.status} />
          </div>
        ))}
      </div>
    </section>
  );
}
