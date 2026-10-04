import { useEffect, useState } from 'react';
import { NavLink, Navigate, Route, Routes, useNavigate } from 'react-router-dom';
import { getAuth, setAuth } from './api.js';
import Login from './pages/Login.jsx';
import Search from './pages/Search.jsx';
import BookingPage from './pages/BookingPage.jsx';
import MyBookings from './pages/MyBookings.jsx';
import Notifications from './pages/Notifications.jsx';
import ControlRoom from './pages/ControlRoom.jsx';
import PnrStatus from './pages/PnrStatus.jsx';

export default function App() {
  const [auth, setAuthState] = useState(getAuth());
  const navigate = useNavigate();

  useEffect(() => {
    const t = setInterval(() => {
      const a = getAuth();
      if (!a && auth) setAuthState(null); // token was rejected somewhere
    }, 2000);
    return () => clearInterval(t);
  }, [auth]);

  const onLogin = (a) => {
    setAuth(a);
    setAuthState(a);
  };
  const logout = () => {
    setAuth(null);
    setAuthState(null);
    navigate('/');
  };

  const requireAuth = (el) => (auth ? el : <Navigate to="/login" replace />);

  return (
    <div className="app">
      <header className="topbar">
        <NavLink to="/" className="brand">
          <span className="brand-mark">🚆</span>
          <span>
            Rail<b>Reserve</b>
          </span>
        </NavLink>
        <nav>
          <NavLink to="/" end>Book</NavLink>
          <NavLink to="/pnr">PNR status</NavLink>
          {auth && <NavLink to="/bookings">My trips</NavLink>}
          {auth && <NavLink to="/notifications">Alerts</NavLink>}
          <NavLink to="/control-room" className="nav-ops">Control room</NavLink>
        </nav>
        <div className="who">
          {auth ? (
            <>
              <span className="muted">Hi, {auth.user.name.split(' ')[0]}</span>
              <button className="btn ghost sm" onClick={logout}>Log out</button>
            </>
          ) : (
            <NavLink to="/login" className="btn sm">Log in</NavLink>
          )}
        </div>
      </header>
      <main>
        <Routes>
          <Route path="/" element={<Search auth={auth} />} />
          <Route path="/login" element={auth ? <Navigate to="/" replace /> : <Login onLogin={onLogin} />} />
          <Route path="/pnr" element={<PnrStatus auth={auth} />} />
          <Route path="/booking/:id" element={requireAuth(<BookingPage />)} />
          <Route path="/bookings" element={requireAuth(<MyBookings />)} />
          <Route path="/notifications" element={requireAuth(<Notifications />)} />
          <Route path="/control-room" element={requireAuth(<ControlRoom />)} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
      <footer className="footer muted">
        Distributed Systems capstone · Spring Boot microservices · Kafka saga · Redis · Postgres per service
      </footer>
    </div>
  );
}
