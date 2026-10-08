import React, { useEffect, useState } from 'react';
import { api } from '../api.ts';
import { StatusBadge } from './BookingPage.tsx';
import { Bell, AlertTriangle, MessageSquare, Clock } from 'lucide-react';

interface NotificationItem {
  id: string;
  message: string;
  createdAt: string | number;
  channel: string;
  status: string;
}

export default function Notifications() {
  const [list, setList] = useState<NotificationItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const load = () =>
      api<NotificationItem[]>('/api/notifications')
        .then((l) => {
          setList(Array.isArray(l) ? l : []);
          setError(null);
        })
        .catch((e) => setError(e.message));

    load();
    const t = setInterval(load, 4000);
    return () => clearInterval(t);
  }, []);

  const safeList = Array.isArray(list) ? list : [];

  return (
    <div className="max-w-4xl mx-auto py-8 px-4 sm:px-6">
      <div className="mb-6 pb-3 border-b border-slate-200">
        <div className="flex items-center gap-2 mb-1">
          <Bell className="w-6 h-6 text-[#1b3a6b]" />
          <h1 className="text-2xl font-black text-[#1b3a6b] tracking-tight">
            BOOKING ALERTS & NOTIFICATIONS
          </h1>
        </div>
        <p className="text-xs text-slate-500 leading-relaxed">
          Real-time SMS & email notifications produced asynchronously by <code>notification-service</code> from Kafka saga events.
        </p>
      </div>

      {error && (
        <div className="mb-6 p-4 rounded-lg bg-amber-50 border border-amber-200 text-amber-900 text-xs flex items-start gap-2.5">
          <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
          <div>
            <p className="font-bold">Notification Gateway Notice</p>
            <p className="mt-0.5">
              Notifications service is temporarily disconnected ({error}). Bookings and tickets are unaffected.
            </p>
          </div>
        </div>
      )}

      {list && safeList.length === 0 && (
        <div className="bg-white rounded-lg border border-slate-200 p-12 text-center text-slate-500 shadow-sm">
          <MessageSquare className="w-10 h-10 text-slate-300 mx-auto mb-2" />
          <p className="font-bold text-sm text-slate-700">No Alerts Recorded</p>
          <p className="text-xs text-slate-400 mt-1">
            Kafka events from your ticket reservations and payments will stream here.
          </p>
        </div>
      )}

      <div className="space-y-3">
        {safeList.map((n) => (
          <div
            key={n.id}
            className="bg-white rounded-lg border border-slate-200 p-4 shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-3"
          >
            <div className="space-y-1">
              <p className="text-xs font-semibold text-slate-800">{n.message}</p>
              <div className="flex items-center gap-2 text-[11px] text-slate-400">
                <Clock className="w-3 h-3" />
                <span>{new Date(n.createdAt).toLocaleString()}</span>
                <span>·</span>
                <span className="uppercase font-semibold text-slate-500">Channel: {n.channel}</span>
              </div>
            </div>

            <div className="shrink-0">
              <StatusBadge status={n.status} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
