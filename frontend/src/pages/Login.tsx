import React, { useState } from 'react';
import { useLocation, useNavigate, Link } from 'react-router-dom';
import { api, AuthData } from '../api.ts';
import { Eye, EyeOff, Lock, Mail, User, ShieldCheck, AlertCircle } from 'lucide-react';

interface LoginProps {
  onLogin: (auth: AuthData) => void;
}

export default function Login({ onLogin }: LoginProps) {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [form, setForm] = useState({ name: '', email: '', password: '' });
  const [showPassword, setShowPassword] = useState(false);
  const [visuallyImpairedOtp, setVisuallyImpairedOtp] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  
  const navigate = useNavigate();
  const location = useLocation();

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const body = mode === 'login' ? { email: form.email, password: form.password } : form;
      const res = await api<{ token: string; user: { name: string; email: string; id?: string } }>(
        `/api/auth/${mode}`, 
        { method: 'POST', body }
      );
      onLogin({ token: res.token, user: res.user });
      
      // Preserve any search / booking redirect state
      const redirectState = location.state as { from?: string; train?: unknown; cls?: unknown } | null;
      if (redirectState?.from) {
        navigate(redirectState.from, { state: redirectState });
      } else {
        navigate('/');
      }
    } catch (err: any) {
      setError(err.message || 'Login failed. Please verify your credentials.');
    } finally {
      setBusy(false);
    }
  };

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => {
    setForm({ ...form, [k]: e.target.value });
  };

  return (
    <div className="min-h-[calc(100vh-210px)] py-12 px-4 flex items-center justify-center relative bg-gradient-to-b from-[#eaf0f8] via-[#f4f7fb] to-[#ffffff]">
      {/* Subtle railway track line background decoration */}
      <div className="absolute inset-0 opacity-10 pointer-events-none overflow-hidden">
        <svg className="w-full h-full" xmlns="http://www.w3.org/2000/svg">
          <pattern id="track-pattern" width="100" height="40" patternUnits="userSpaceOnUse">
            <line x1="0" y1="10" x2="100" y2="10" stroke="#1b3a6b" strokeWidth="2" />
            <line x1="0" y1="30" x2="100" y2="30" stroke="#1b3a6b" strokeWidth="2" />
            {Array.from({ length: 5 }).map((_, i) => (
              <line key={i} x1={i * 20 + 10} y1="6" x2={i * 20 + 10} y2="34" stroke="#1b3a6b" strokeWidth="3" />
            ))}
          </pattern>
          <rect width="100%" height="100%" fill="url(#track-pattern)" />
        </svg>
      </div>

      {/* Main Login Card matching Reference Image 3 */}
      <div className="relative w-full max-w-md bg-white rounded-lg shadow-xl border border-slate-200 overflow-hidden z-10">
        {/* Top Decorative Header */}
        <div className="bg-[#1b3a6b] px-6 py-4 text-white text-center">
          <div className="flex items-center justify-center gap-2 mb-1">
            <svg className="w-7 h-7 text-[#f6c86a]" viewBox="0 0 100 100" fill="currentColor">
              <circle cx="50" cy="50" r="44" fill="#0d2b59" />
              <path d="M28 32 H52 C62 32 68 38 68 46 C68 54 62 60 52 60 H40 V72 H28 Z" fill="#ffffff" />
              <path d="M40 42 H50 C54 42 56 44 56 46 C56 48 54 50 50 50 H40 Z" fill="#0d2b59" />
              <path d="M54 56 L72 74 H58 L46 62 Z" fill="#e8711c" />
            </svg>
            <span className="text-xl font-black tracking-wide">IRCTC / RailReserve</span>
          </div>
          <p className="text-xs text-sky-200">Official Indian Railways Ticketing System</p>
        </div>

        <div className="p-6 sm:p-8">
          {/* Centered Title with blue underline from Reference Image 3 */}
          <div className="text-center mb-6">
            <h2 className="text-2xl font-black text-[#1b3a6b] uppercase tracking-wide inline-block pb-1 relative">
              {mode === 'login' ? 'LOGIN' : 'CREATE ACCOUNT'}
              <span className="absolute bottom-0 left-1/4 right-1/4 h-1 bg-[#1b3a6b] rounded-full"></span>
            </h2>
            <p className="text-xs text-slate-500 mt-2">
              {mode === 'login' 
                ? 'Sign in to access your bookings, hold seats, and confirm tickets.' 
                : 'Register a new account for instant train reservations.'}
            </p>
          </div>

          {error && (
            <div className="mb-5 p-3 rounded-md bg-red-50 border border-red-200 flex items-start gap-2.5 text-xs text-red-700">
              <AlertCircle className="w-4 h-4 shrink-0 text-red-600 mt-0.5" />
              <div>
                <p className="font-bold">Authentication Notice</p>
                <p>{error}</p>
              </div>
            </div>
          )}

          <form onSubmit={submit} className="space-y-4">
            {mode === 'register' && (
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Full Name *
                </label>
                <div className="relative">
                  <User className="absolute left-3 top-2.5 w-4 h-4 text-slate-400" />
                  <input
                    required
                    type="text"
                    value={form.name}
                    onChange={set('name')}
                    placeholder="Enter your full name"
                    autoComplete="name"
                    className="w-full pl-9 pr-3 py-2 text-sm border border-slate-300 rounded focus:ring-2 focus:ring-[#1b3a6b] focus:border-transparent outline-none transition"
                  />
                </div>
              </div>
            )}

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                {mode === 'login' ? 'User Name / Email *' : 'Email Address *'}
              </label>
              <div className="relative">
                <Mail className="absolute left-3 top-2.5 w-4 h-4 text-slate-400" />
                <input
                  required
                  type="email"
                  value={form.email}
                  onChange={set('email')}
                  placeholder="name@example.com"
                  autoComplete="email"
                  className="w-full pl-9 pr-3 py-2 text-sm border border-slate-300 rounded focus:ring-2 focus:ring-[#1b3a6b] focus:border-transparent outline-none transition"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Password *
              </label>
              <div className="relative">
                <Lock className="absolute left-3 top-2.5 w-4 h-4 text-slate-400" />
                <input
                  required
                  type={showPassword ? 'text' : 'password'}
                  minLength={6}
                  value={form.password}
                  onChange={set('password')}
                  placeholder="Enter password (min 6 characters)"
                  autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                  className="w-full pl-9 pr-10 py-2 text-sm border border-slate-300 rounded focus:ring-2 focus:ring-[#1b3a6b] focus:border-transparent outline-none transition"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-2.5 text-slate-400 hover:text-slate-600"
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {mode === 'login' && (
              <div className="flex items-center justify-between text-xs pt-1">
                <button
                  type="button"
                  onClick={() => alert('For this demo, you can log in with any existing registered account or use register mode.')}
                  className="font-bold text-[#1b3a6b] hover:underline"
                >
                  FORGOT ACCOUNT DETAILS?
                </button>
              </div>
            )}

            {/* Accessibility Checkbox matching Reference Image 3 */}
            <div className="pt-1">
              <label className="flex items-start gap-2 text-[11px] text-slate-600 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={visuallyImpairedOtp}
                  onChange={(e) => setVisuallyImpairedOtp(e.target.checked)}
                  className="mt-0.5 rounded text-[#e8711c] focus:ring-[#e8711c]"
                />
                <span>
                  Visually impaired users may select this option to receive OTP verification instead of CAPTCHA.
                </span>
              </label>
            </div>

            {/* Primary Action Button (Warm Orange #e8711c from reference) */}
            <button
              type="submit"
              disabled={busy}
              className="w-full py-2.5 px-4 bg-[#e8711c] hover:bg-[#d06114] disabled:opacity-50 text-white font-bold text-sm uppercase tracking-wider rounded shadow transition flex items-center justify-center gap-2 mt-4"
            >
              {busy && <span className="spinner-icon" />}
              <span>{busy ? 'Verifying Credentials…' : mode === 'login' ? 'SIGN IN' : 'REGISTER & PROCEED'}</span>
            </button>

            {/* Secondary Action Row matching Reference Image 3 */}
            <div className="grid grid-cols-2 gap-3 pt-3">
              <button
                type="button"
                onClick={() => {
                  setError(null);
                  setMode(mode === 'login' ? 'register' : 'login');
                }}
                className="w-full py-2 px-3 bg-[#1b3a6b] hover:bg-[#122749] text-white text-xs font-bold uppercase tracking-wider rounded text-center transition"
              >
                {mode === 'login' ? 'REGISTER' : 'SIGN IN'}
              </button>
              
              <button
                type="button"
                onClick={() => {
                  // Pre-fill demo credentials for quick agent/user evaluation
                  setForm({ name: 'Tatkal Passenger', email: 'passenger@indianrail.gov.in', password: 'password123' });
                  setMode('login');
                }}
                className="w-full py-2 px-3 bg-[#24406e] hover:bg-[#1b3a6b] text-white text-xs font-bold uppercase tracking-wider rounded text-center transition"
              >
                DEMO LOGIN
              </button>
            </div>
          </form>

          <div className="mt-6 pt-4 border-t border-slate-200 text-center">
            <Link to="/" className="text-xs font-semibold text-[#1b3a6b] hover:underline">
              ← Return to Train Search
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
