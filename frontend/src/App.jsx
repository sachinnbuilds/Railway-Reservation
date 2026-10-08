import { useEffect, useState } from 'react';
import { Navigate, Route, Routes, useNavigate } from 'react-router-dom';
import { getAuth, setAuth } from './api.ts';
import Header from './components/Header.tsx';
import Footer from './components/Footer.tsx';
import Login from './pages/Login.tsx';
import Search from './pages/Search.jsx';
import TrainResults from './pages/TrainResults.jsx';
import BookTrain from './pages/BookTrain.tsx';
import BookingPage from './pages/BookingPage.tsx';
import MyBookings from './pages/MyBookings.tsx';
import Notifications from './pages/Notifications.tsx';
import ControlRoom from './pages/ControlRoom.tsx';
import PnrStatus from './pages/PnrStatus.tsx';

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
    <div className="flex flex-col min-h-screen bg-[#eff2f6] text-slate-900 font-sans">
      {/* Official IRCTC Header (Two-tier with Indian Railways emblem, IRCTC Logo, Clock, Font Resizer, Language & Nav links) */}
      <Header auth={auth} onLogout={logout} />

      <main className="flex-1">
        <Routes>
          <Route path="/" element={<Search auth={auth} />} />
          <Route path="/trains" element={<TrainResults auth={auth} />} />
          <Route path="/book" element={requireAuth(<BookTrain auth={auth} />)} />
          <Route path="/login" element={auth ? <Navigate to="/" replace /> : <Login onLogin={onLogin} />} />
          <Route path="/pnr" element={<PnrStatus auth={auth} />} />
          <Route path="/booking/:id" element={requireAuth(<BookingPage />)} />
          <Route path="/bookings" element={requireAuth(<MyBookings />)} />
          <Route path="/notifications" element={requireAuth(<Notifications />)} />
          <Route path="/control-room" element={requireAuth(<ControlRoom />)} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>

      {/* Official IRCTC Footer */}
      <Footer />
    </div>
  );
}
