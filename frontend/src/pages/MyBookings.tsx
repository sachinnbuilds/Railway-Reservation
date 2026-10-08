import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, fmtDate, rupees } from '../api.ts';
import { StatusBadge } from './BookingPage.tsx';
import { Train, Briefcase, Calendar, ChevronRight, AlertCircle } from 'lucide-react';

interface BookingItem {
  id: string;
  pnr: string;
  status: string;
  trainNumber: string;
  trainName: string;
  from: string;
  to: string;
  journeyDate: string;
  travelClass: string;
  seatCount: number;
  totalFare: number;
}

export default function MyBookings() {
  const [list, setList] = useState<BookingItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<BookingItem[]>('/api/bookings')
      .then(res => setList(Array.isArray(res) ? res : []))
      .catch((e) => setError(e.message));
  }, []);

  if (error) {
    return (
      <div className="max-w-4xl mx-auto py-10 px-4">
        <div className="p-4 rounded-lg bg-red-50 border border-red-200 text-red-800 text-sm flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
          <div>
            <p className="font-bold">Error loading trips</p>
            <p className="text-xs">{error}</p>
          </div>
        </div>
      </div>
    );
  }

  if (!list) {
    return (
      <div className="max-w-4xl mx-auto py-16 px-4 text-center">
        <span className="spinner-icon w-8 h-8 text-[#1b3a6b] mx-auto mb-2" />
        <p className="text-xs font-semibold text-slate-500">Loading your booked journeys…</p>
      </div>
    );
  }

  const safeList = Array.isArray(list) ? list : [];

  return (
    <div className="max-w-5xl mx-auto py-8 px-4 sm:px-6">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6 pb-3 border-b border-slate-200">
        <div>
          <h1 className="text-2xl font-black text-[#1b3a6b] tracking-tight">
            MY TRIPS & RESERVATIONS
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Review upcoming journeys, download tickets, track refund status, or cancel bookings.
          </p>
        </div>
        <Link
          to="/"
          className="px-4 py-2 bg-[#e8711c] hover:bg-[#d06114] text-white text-xs font-bold uppercase tracking-wider rounded shadow transition"
        >
          + Book New Train
        </Link>
      </div>

      {safeList.length === 0 ? (
        <div className="bg-white rounded-lg border border-slate-200 p-12 text-center shadow-sm">
          <Briefcase className="w-12 h-12 text-slate-300 mx-auto mb-3" />
          <h3 className="text-base font-bold text-slate-700 mb-1">No Bookings Yet</h3>
          <p className="text-xs text-slate-500 mb-6">
            You have not booked any train tickets yet. Search direct trains and confirm your seats.
          </p>
          <Link
            to="/"
            className="inline-flex items-center gap-2 px-5 py-2 bg-[#1b3a6b] hover:bg-[#122749] text-white text-xs font-bold rounded shadow transition"
          >
            Search Trains
          </Link>
        </div>
      ) : (
        <div className="space-y-3">
          {safeList.map((b) => (
            <Link
              key={b.id}
              to={`/booking/${b.id}`}
              className="block bg-white rounded-lg border border-slate-200 p-4 sm:p-5 shadow-sm hover:border-[#1b3a6b] hover:shadow-md transition group"
            >
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="font-mono font-bold text-sm text-[#e8711c]">
                      {b.trainNumber}
                    </span>
                    <span className="font-bold text-slate-900 group-hover:text-[#1b3a6b] transition">
                      {b.trainName}
                    </span>
                    <span className="text-slate-300">·</span>
                    <span className="text-xs font-mono font-semibold text-slate-500">
                      PNR: {b.pnr}
                    </span>
                  </div>

                  <p className="text-xs text-slate-600 flex flex-wrap items-center gap-2">
                    <span className="font-semibold text-slate-800">{b.from}</span>
                    <span>→</span>
                    <span className="font-semibold text-slate-800">{b.to}</span>
                    <span>·</span>
                    <span>{fmtDate(b.journeyDate)}</span>
                    <span>·</span>
                    <span>Class {b.travelClass}</span>
                    <span>·</span>
                    <span>{b.seatCount} Passenger(s)</span>
                  </p>
                </div>

                <div className="flex sm:flex-col items-center sm:items-end justify-between sm:justify-center gap-2 pt-2 sm:pt-0 border-t sm:border-t-0 border-slate-100">
                  <StatusBadge status={b.status} />
                  <div className="flex items-center gap-2">
                    <span className="text-base font-black text-slate-900 tabular">
                      {rupees(b.totalFare)}
                    </span>
                    <ChevronRight className="w-4 h-4 text-slate-400 group-hover:text-[#1b3a6b] transition" />
                  </div>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
