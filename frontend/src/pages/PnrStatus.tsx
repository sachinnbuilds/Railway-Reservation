import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, fmtDate, AuthData } from '../api.ts';
import { StatusBadge } from './BookingPage.tsx';
import { FileText, Search, Train, UserCheck, AlertCircle, LogIn } from 'lucide-react';

interface PassengerItem {
  name: string;
  age: number;
  gender?: string;
}

interface PnrBooking {
  id: string;
  pnr: string;
  status: string;
  trainNumber: string;
  trainName: string;
  from: string;
  to: string;
  journeyDate: string;
  travelClass: string;
  passengers: PassengerItem[];
  seats: string[];
}

interface PnrStatusProps {
  auth: AuthData | null;
}

export default function PnrStatus({ auth }: PnrStatusProps) {
  const [pnr, setPnr] = useState('');
  const [b, setB] = useState<PnrBooking | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const check = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setB(null);
    setLoading(true);
    try {
      const data = await api<PnrBooking>(`/api/bookings/pnr/${pnr.trim()}`);
      setB(data);
    } catch (err: any) {
      setError(err.message || 'Unable to retrieve PNR details. Please verify the 10-digit PNR number.');
    } finally {
      setLoading(false);
    }
  };

  if (!auth) {
    return (
      <div className="max-w-md mx-auto py-12 px-4">
        <div className="bg-white rounded-lg border border-slate-200 p-8 text-center shadow-sm">
          <FileText className="w-12 h-12 text-[#1b3a6b] mx-auto mb-3" />
          <h2 className="text-xl font-bold text-slate-800 mb-2">PNR Status Inquiry</h2>
          <p className="text-slate-500 text-xs mb-6">
            Please log in with your registered account to query passenger current reservation and chart status.
          </p>
          <Link
            to="/login"
            state={{ from: '/pnr' }}
            className="inline-flex items-center gap-2 px-6 py-2.5 bg-[#e8711c] hover:bg-[#d06114] text-white font-bold text-xs uppercase tracking-wider rounded shadow transition"
          >
            <LogIn className="w-4 h-4" />
            <span>Log in to Check PNR</span>
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto py-8 px-4 sm:px-6">
      <div className="text-center mb-6">
        <div className="inline-flex items-center justify-center w-12 h-12 bg-sky-100 rounded-full text-[#1b3a6b] mb-2">
          <FileText className="w-6 h-6" />
        </div>
        <h1 className="text-2xl font-black text-[#1b3a6b] uppercase tracking-wide">
          PNR Current Status
        </h1>
        <p className="text-xs text-slate-500 mt-1">
          Enter your 10-digit Passenger Name Record (PNR) to view live reservation status and coach allocation.
        </p>
      </div>

      <div className="bg-white rounded-lg border border-slate-200 shadow-sm p-6 mb-6">
        <form onSubmit={check} className="flex flex-col sm:flex-row gap-3">
          <div className="flex-1 relative">
            <input
              type="text"
              placeholder="Enter 10-digit PNR (e.g. 8421093481)"
              value={pnr}
              onChange={(e) => setPnr(e.target.value)}
              pattern="\d{10}"
              required
              className="w-full px-4 py-2.5 text-base font-mono font-bold tracking-widest bg-slate-50 border border-slate-300 rounded focus:bg-white focus:ring-2 focus:ring-[#1b3a6b] outline-none"
            />
          </div>
          <button
            type="submit"
            disabled={loading}
            className="px-6 py-2.5 bg-[#e8711c] hover:bg-[#d06114] disabled:opacity-50 text-white font-bold text-xs uppercase tracking-wider rounded shadow transition flex items-center justify-center gap-1.5 shrink-0"
          >
            {loading ? <span className="spinner-icon" /> : <Search className="w-4 h-4" />}
            <span>{loading ? 'Checking…' : 'Check Status'}</span>
          </button>
        </form>

        <p className="text-[11px] text-slate-400 mt-2 text-center sm:text-left">
          Tip: You can find your 10-digit PNR at the top-left corner of your ticket or in My Trips.
        </p>
      </div>

      {error && (
        <div className="p-4 rounded-lg bg-red-50 border border-red-200 text-red-800 text-xs flex items-start gap-2.5 mb-6">
          <AlertCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
          <div>
            <p className="font-bold">Inquiry Notice</p>
            <p className="mt-0.5">{error}</p>
          </div>
        </div>
      )}

      {b && (
        <div className="bg-white rounded-lg border border-slate-200 shadow-sm overflow-hidden">
          <div className="bg-[#1b3a6b] px-5 py-3 text-white flex items-center justify-between">
            <div>
              <span className="text-[10px] text-sky-200 uppercase tracking-wider block">PNR NUMBER</span>
              <span className="text-xl font-mono font-bold tracking-widest">{b.pnr}</span>
            </div>
            <StatusBadge status={b.status} />
          </div>

          <div className="p-5">
            <div className="flex items-center gap-2 mb-2">
              <Train className="w-5 h-5 text-[#1b3a6b]" />
              <span className="font-extrabold text-base text-slate-900">
                {b.trainNumber} {b.trainName}
              </span>
            </div>

            <p className="text-xs text-slate-600 mb-4">
              {b.from} → {b.to} · {fmtDate(b.journeyDate)} · Class {b.travelClass}
            </p>

            <div className="overflow-x-auto">
              <table className="w-full text-xs text-left">
                <thead>
                  <tr className="border-b border-slate-200 text-slate-500 uppercase text-[10px]">
                    <th className="py-2 pr-2">Passenger</th>
                    <th className="py-2 pr-2">Age</th>
                    <th className="py-2 pr-2">Booking Status</th>
                    <th className="py-2 text-right">Current Status / Seat</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {(Array.isArray(b.passengers) ? b.passengers : []).map((p, idx) => (
                    <tr key={idx} className="font-medium text-slate-800">
                      <td className="py-2 font-bold text-[#1b3a6b]">{p.name}</td>
                      <td className="py-2">{p.age} yrs</td>
                      <td className="py-2">
                        <span className="font-bold text-slate-600">{b.status}</span>
                      </td>
                      <td className="py-2 text-right">
                        <span className="px-2 py-0.5 bg-slate-100 text-slate-900 font-mono font-bold rounded">
                          {b.status === 'CONFIRMED' ? ((Array.isArray(b.seats) && b.seats[idx]) || 'Confirmed') : '-'}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="mt-5 pt-3 border-t border-slate-200 flex justify-end">
              <Link 
                to={`/booking/${b.id}`} 
                className="text-xs font-bold text-[#1b3a6b] hover:underline"
              >
                View Full Saga Details & Actions →
              </Link>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
