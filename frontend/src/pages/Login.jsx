import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { api } from '../api.js';

export default function Login({ onLogin }) {
  const [mode, setMode] = useState('login');
  const [form, setForm] = useState({ name: '', email: '', password: '' });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const body = mode === 'login' ? { email: form.email, password: form.password } : form;
      const res = await api(`/api/auth/${mode}`, { method: 'POST', body });
      onLogin({ token: res.token, user: res.user });
      navigate(location.state?.from || '/');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  return (
    <div className="auth-wrap">
      <form className="card auth" onSubmit={submit}>
        <h2>{mode === 'login' ? 'Welcome back' : 'Create your account'}</h2>
        <p className="muted">Log in to book tickets and use the control room.</p>
        {mode === 'register' && (
          <label>Full name<input required value={form.name} onChange={set('name')} autoComplete="name" /></label>
        )}
        <label>Email<input required type="email" value={form.email} onChange={set('email')} autoComplete="email" /></label>
        <label>
          Password
          <input required type="password" minLength={6} value={form.password} onChange={set('password')}
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'} />
        </label>
        {error && <div className="alert error">{error}</div>}
        <button className="btn block" disabled={busy}>{busy ? 'Please wait…' : mode === 'login' ? 'Log in' : 'Sign up'}</button>
        <button type="button" className="link" onClick={() => setMode(mode === 'login' ? 'register' : 'login')}>
          {mode === 'login' ? "New here? Create an account" : 'Already registered? Log in'}
        </button>
      </form>
    </div>
  );
}
