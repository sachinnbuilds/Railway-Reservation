import React, { useEffect, useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { AuthData } from '../api.ts';
import { Home } from 'lucide-react';

interface HeaderProps {
  auth: AuthData | null;
  onLogout: () => void;
}

export default function Header({ auth, onLogout }: HeaderProps) {
  const [timeString, setTimeString] = useState('');
  const [fontSizeLevel, setFontSizeLevel] = useState<number>(1); // 0 = A-, 1 = A, 2 = A+
  const [lang, setLang] = useState<'EN' | 'HI'>('HI');
  const navigate = useNavigate();

  useEffect(() => {
    const updateTime = () => {
      const now = new Date();
      // Format: DD-Mon-YYYY [HH:mm:ss] IST
      const datePart = new Intl.DateTimeFormat('en-GB', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        timeZone: 'Asia/Kolkata',
      }).format(now).replace(/ /g, '-');

      const timePart = new Intl.DateTimeFormat('en-GB', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
        timeZone: 'Asia/Kolkata',
      }).format(now);

      setTimeString(`${datePart} [${timePart}]`);
    };

    updateTime();
    const interval = setInterval(updateTime, 1000);
    return () => clearInterval(interval);
  }, []);

  const handleFontChange = (level: number) => {
    setFontSizeLevel(level);
    const htmlEl = document.documentElement;
    if (level === 0) {
      htmlEl.style.fontSize = '13.5px';
    } else if (level === 1) {
      htmlEl.style.fontSize = '14px';
    } else {
      htmlEl.style.fontSize = '15.5px';
    }
  };

  const userName = auth?.user?.name || 'Sarath Saravanan (PraSar2002)';

  return (
    <header className="w-full bg-white border-b border-slate-200 select-none shadow-sm sticky top-0 z-50">
      {/* Top Utility Bar matching Screenshot 2026-10-05 212852.png */}
      <div className="max-w-[1400px] mx-auto px-4 py-2 flex items-center justify-between gap-4">
        {/* Left: Indian Railways Crest Logo */}
        <NavLink to="/" className="flex items-center gap-3 text-decoration-none">
          <svg
            className="w-12 h-12 shrink-0 text-[#1b3a6b]"
            viewBox="0 0 100 100"
            fill="currentColor"
            aria-label="Indian Railways Emblem"
          >
            <circle cx="50" cy="50" r="46" fill="#1b3a6b" stroke="#0b1b36" strokeWidth="2" />
            <circle cx="50" cy="50" r="41" fill="none" stroke="#f6c86a" strokeWidth="1.5" strokeDasharray="3 2" />
            <circle cx="50" cy="50" r="32" fill="#ffffff" />
            {/* Ashoka Wheel Center */}
            <circle cx="50" cy="50" r="16" fill="none" stroke="#1b3a6b" strokeWidth="2.5" />
            <circle cx="50" cy="50" r="3" fill="#1b3a6b" />
            {Array.from({ length: 24 }).map((_, i) => {
              const angle = (i * 360) / 24;
              return (
                <line
                  key={i}
                  x1="50"
                  y1="50"
                  x2={50 + 15 * Math.cos((angle * Math.PI) / 180)}
                  y2={50 + 15 * Math.sin((angle * Math.PI) / 180)}
                  stroke="#1b3a6b"
                  strokeWidth="1.2"
                />
              );
            })}
            {/* Train silhouette base */}
            <path d="M38 72 L62 72 L66 82 L34 82 Z" fill="#f6c86a" stroke="#1b3a6b" strokeWidth="1" />
            <circle cx="43" cy="78" r="2" fill="#1b3a6b" />
            <circle cx="57" cy="78" r="2" fill="#1b3a6b" />
          </svg>
        </NavLink>

        {/* Center & Right Utility Info */}
        <div className="flex items-center gap-3 sm:gap-4 text-xs font-semibold text-slate-700 flex-wrap justify-end">
          {/* User Welcome */}
          <div className="flex items-center gap-1.5 text-slate-800">
            <span>Welcome</span>
            <span className="font-bold text-[#1b3a6b]">{userName}</span>
            <span className="text-emerald-600 font-bold">✔</span>
            <span className="text-slate-300 ml-1">|</span>
          </div>

          {/* Clock */}
          <div className="font-mono text-slate-700">
            {timeString || '05-Oct-2026 [21:28:56]'}
            <span className="text-slate-300 ml-2">|</span>
          </div>

          {/* Font Resizer */}
          <div className="flex items-center gap-2 text-slate-600">
            <button
              onClick={() => handleFontChange(0)}
              className={`hover:text-[#1b3a6b] ${fontSizeLevel === 0 ? 'font-bold text-[#1b3a6b]' : ''}`}
            >
              A-
            </button>
            <span className="text-slate-300">|</span>
            <button
              onClick={() => handleFontChange(1)}
              className={`hover:text-[#1b3a6b] ${fontSizeLevel === 1 ? 'font-bold text-[#1b3a6b]' : ''}`}
            >
              A
            </button>
            <span className="text-slate-300">|</span>
            <button
              onClick={() => handleFontChange(2)}
              className={`hover:text-[#1b3a6b] ${fontSizeLevel === 2 ? 'font-bold text-[#1b3a6b]' : ''}`}
            >
              A+
            </button>
            <span className="text-slate-300 ml-1">|</span>
          </div>

          {/* Language Toggle */}
          <button
            onClick={() => setLang((l) => (l === 'EN' ? 'HI' : 'EN'))}
            className="font-bold text-[#1b3a6b] hover:underline"
          >
            {lang === 'HI' ? 'हिंदी' : 'English'}
          </button>

          {/* Logout if logged in */}
          {auth && (
            <button
              onClick={onLogout}
              className="text-xs text-red-600 hover:text-red-800 font-bold ml-2"
            >
              [Logout]
            </button>
          )}

          {/* IRCTC Official Logo */}
          <div className="flex items-center pl-2">
            <svg className="w-12 h-12" viewBox="0 0 100 100" fill="none">
              <circle cx="50" cy="50" r="44" fill="#0d2b59" />
              <path d="M28 32 H52 C62 32 68 38 68 46 C68 54 62 60 52 60 H40 V72 H28 Z" fill="#ffffff" />
              <path d="M40 42 H50 C54 42 56 44 56 46 C56 48 54 50 50 50 H40 Z" fill="#0d2b59" />
              <path d="M54 56 L72 74 H58 L46 62 Z" fill="#e8711c" />
              <circle cx="70" cy="34" r="5" fill="#f6c86a" />
            </svg>
          </div>
        </div>
      </div>

      {/* Sub-Header Navigation Links (Matching Screenshot 2026-10-05 212852.png) */}
      <div className="bg-white border-t border-slate-100 px-4 py-1.5">
        <div className="max-w-[1400px] mx-auto flex items-center gap-6 text-[12px] font-bold uppercase tracking-wide text-slate-700 overflow-x-auto">
          <NavLink to="/" className="text-slate-700 hover:text-[#1b3a6b] flex items-center">
            <Home className="w-4 h-4 text-slate-600" />
          </NavLink>

          <NavLink to="/bookings" className="text-slate-700 hover:text-[#1b3a6b] whitespace-nowrap">
            MY ACCOUNT
          </NavLink>

          <NavLink to="/" className="text-red-600 font-extrabold whitespace-nowrap">
            TRAINS
          </NavLink>

          <span className="text-slate-600 cursor-pointer hover:text-[#1b3a6b] whitespace-nowrap">
            MEALS
          </span>

          <span className="bg-[#1b3a6b] text-white px-3 py-1 rounded text-[11px] font-extrabold tracking-wider whitespace-nowrap cursor-pointer">
            LOYALTY
          </span>

          <span className="text-slate-600 cursor-pointer hover:text-[#1b3a6b] whitespace-nowrap">
            E-WALLET
          </span>

          <NavLink to="/notifications" className="text-slate-600 hover:text-[#1b3a6b] whitespace-nowrap">
            ALERTS
          </NavLink>

          <span className="text-slate-600 cursor-pointer hover:text-[#1b3a6b] whitespace-nowrap">
            OTHER SERVICES
          </span>

          <span className="text-slate-600 cursor-pointer hover:text-[#1b3a6b] whitespace-nowrap">
            CONTACT US
          </span>
        </div>
      </div>
    </header>
  );
}
