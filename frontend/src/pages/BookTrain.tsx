import React, { useState, useEffect } from 'react';
import { useLocation, useNavigate, Link } from 'react-router-dom';
import { api, fmtDate, rupees, uuid, AuthData } from '../api.ts';
import { 
  Train, 
  ArrowRight, 
  UserPlus, 
  Trash2, 
  ShieldCheck, 
  AlertCircle, 
  Clock, 
  CreditCard, 
  Calendar,
  CheckCircle2,
  Info
} from 'lucide-react';

interface Passenger {
  name: string;
  age: number;
  gender: string;
}

interface TrainSelection {
  train: {
    number: string;
    name: string;
    from: string;
    to: string;
    departure: string;
    arrival: string;
    journeyDate: string;
    boardingDate?: string;
    arrivalDate?: string;
    durationMinutes?: number;
    type?: string;
  };
  cls: {
    code: string;
    name: string;
    fare: number;
    status: string;
    available?: number;
  };
}

interface BookTrainProps {
  auth: AuthData | null;
}

const STORAGE_KEY = 'rr.selected_booking';

export default function BookTrain({ auth }: BookTrainProps) {
  const location = useLocation();
  const navigate = useNavigate();

  // Retrieve selected train and class from location state or sessionStorage
  const [selection, setSelection] = useState<TrainSelection | null>(() => {
    if (location.state?.train && location.state?.cls) {
      const data = { train: location.state.train, cls: location.state.cls };
      try {
        sessionStorage.setItem(STORAGE_KEY, JSON.stringify(data));
      } catch {
        /* storage safe */
      }
      return data;
    }
    try {
      const saved = sessionStorage.getItem(STORAGE_KEY);
      return saved ? JSON.parse(saved) : null;
    } catch {
      return null;
    }
  });

  const [passengers, setPassengers] = useState<Passenger[]>([
    { name: auth?.user?.name || '', age: 30, gender: 'M' }
  ]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [idempotencyKey] = useState<string>(uuid());

  // If not logged in, prompt to log in and preserve return path
  useEffect(() => {
    if (!auth) {
      navigate('/login', { 
        replace: true, 
        state: { from: '/book', train: selection?.train, cls: selection?.cls } 
      });
    }
  }, [auth, navigate, selection]);

  if (!selection) {
    return (
      <div className="max-w-4xl mx-auto py-12 px-4">
        <div className="bg-white rounded-lg border border-slate-200 p-8 text-center shadow-sm">
          <Train className="w-12 h-12 text-slate-400 mx-auto mb-3" />
          <h2 className="text-xl font-bold text-slate-800 mb-2">No Train Selected</h2>
          <p className="text-slate-500 text-sm mb-6">
            Please select a train and preferred travel class from the train search page.
          </p>
          <Link 
            to="/" 
            className="inline-flex items-center gap-2 px-6 py-2.5 bg-[#1b3a6b] hover:bg-[#122749] text-white font-semibold text-sm rounded shadow transition"
          >
            ← Back to Train Search
          </Link>
        </div>
      </div>
    );
  }

  const { train, cls } = selection;

  const updatePassenger = (index: number, field: keyof Passenger, value: string | number) => {
    setPassengers(prev =>
      prev.map((p, i) => (i === index ? { ...p, [field]: value } : p))
    );
  };

  const addPassenger = () => {
    if (passengers.length < 6) {
      setPassengers(prev => [...prev, { name: '', age: 30, gender: 'F' }]);
    }
  };

  const removePassenger = (index: number) => {
    if (passengers.length > 1) {
      setPassengers(prev => prev.filter((_, i) => i !== index));
    }
  };

  const submitBooking = async (e: React.FormEvent) => {
    e.preventDefault();
    if (passengers.some(p => !p.name.trim())) {
      setError('Please provide names for all passengers.');
      return;
    }

    setBusy(true);
    setError(null);

    try {
      const booking = await api<{ id: string }>('/api/bookings', {
        method: 'POST',
        headers: { 'Idempotency-Key': idempotencyKey },
        body: {
          trainNumber: train.number,
          journeyDate: train.journeyDate,
          from: train.from,
          to: train.to,
          travelClass: cls.code,
          passengers: passengers.map(p => ({
            name: p.name.trim(),
            age: Number(p.age),
            gender: p.gender,
          })),
        },
      });

      // Clear storage
      try {
        sessionStorage.removeItem(STORAGE_KEY);
      } catch {}

      // Navigate to the booking saga status & payment page
      navigate(`/booking/${booking.id}`);
    } catch (err: any) {
      const msg = err.code === 'SOLD_OUT'
        ? `${err.message || 'Sold out'}. (Rejected instantly by the Redis fast-reject - no database work was done.)`
        : err.message || 'Booking submission failed. Please try again.';
      setError(msg);
    } finally {
      setBusy(false);
    }
  };

  const totalFare = cls.fare * passengers.length;
  const irctcServiceCharge = 15; // standard nominal fee
  const grandTotal = totalFare + irctcServiceCharge;

  return (
    <div className="max-w-5xl mx-auto py-8 px-4 sm:px-6">
      {/* Page Breadcrumb / Navigation */}
      <div className="flex items-center justify-between mb-6 pb-3 border-b border-slate-200">
        <div>
          <h1 className="text-2xl font-black text-[#1b3a6b] tracking-tight">
            TRAIN RESERVATION
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Complete passenger details and review fare breakdown before seat reservation
          </p>
        </div>
        <Link 
          to="/" 
          className="text-xs font-bold text-[#1b3a6b] hover:text-[#e8711c] flex items-center gap-1 transition-colors"
        >
          ← Change Train
        </Link>
      </div>

      {/* Stepper Banner */}
      <div className="bg-white border border-slate-200 rounded-lg p-4 mb-6 shadow-sm">
        <div className="grid grid-cols-3 gap-2 text-center text-xs">
          <div className="flex flex-col items-center gap-1 text-[#1b3a6b] font-bold">
            <div className="w-7 h-7 rounded-full bg-emerald-600 text-white flex items-center justify-center font-bold">
              ✓
            </div>
            <span>1. Train Selected</span>
          </div>
          <div className="flex flex-col items-center gap-1 text-[#e8711c] font-bold">
            <div className="w-7 h-7 rounded-full bg-[#e8711c] text-white flex items-center justify-center font-bold">
              2
            </div>
            <span>2. Passenger Details</span>
          </div>
          <div className="flex flex-col items-center gap-1 text-slate-400 font-semibold">
            <div className="w-7 h-7 rounded-full bg-slate-200 text-slate-600 flex items-center justify-center font-bold">
              3
            </div>
            <span>3. Payment & Confirmation</span>
          </div>
        </div>
      </div>

      {error && (
        <div className="mb-6 p-4 rounded-lg bg-red-50 border border-red-200 flex items-start gap-3 text-red-800 text-sm">
          <AlertCircle className="w-5 h-5 shrink-0 text-red-600 mt-0.5" />
          <div className="flex-1">
            <h4 className="font-bold text-sm mb-1">Reservation Notice</h4>
            <p className="text-xs">{error}</p>
          </div>
        </div>
      )}

      <form onSubmit={submitBooking}>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left 2 Cols: Step 1 (Train info) & Step 2 (Passenger forms) */}
          <div className="lg:col-span-2 space-y-6">
            {/* Step 1: Selected Train Card */}
            <div className="bg-white rounded-lg border border-slate-200 shadow-sm overflow-hidden">
              <div className="bg-[#1b3a6b] px-4 py-3 text-white flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Train className="w-5 h-5 text-amber-300" />
                  <span className="font-mono font-bold tracking-wider">{train.number}</span>
                  <span className="font-bold text-sm">{train.name}</span>
                </div>
                <span className="bg-white/20 text-white text-xs font-semibold px-2.5 py-0.5 rounded">
                  Class: {cls.code}
                </span>
              </div>

              <div className="p-4 bg-slate-50/60 border-b border-slate-200">
                <div className="flex items-center justify-between text-sm">
                  <div>
                    <div className="text-xl font-black text-slate-900">{train.departure}</div>
                    <div className="font-semibold text-slate-700">{train.from}</div>
                    <div className="text-xs text-slate-500">{fmtDate(train.boardingDate || train.journeyDate)}</div>
                  </div>

                  <div className="flex flex-col items-center px-4">
                    <span className="text-[11px] text-slate-500 font-semibold mb-1">Direct Express</span>
                    <div className="w-28 sm:w-36 border-t-2 border-dashed border-slate-400 relative flex justify-center">
                      <Train className="w-4 h-4 text-[#1b3a6b] -mt-2.5 bg-slate-50 px-0.5" />
                    </div>
                  </div>

                  <div className="text-right">
                    <div className="text-xl font-black text-slate-900">{train.arrival}</div>
                    <div className="font-semibold text-slate-700">{train.to}</div>
                    <div className="text-xs text-slate-500">{fmtDate(train.arrivalDate || train.journeyDate)}</div>
                  </div>
                </div>
              </div>

              <div className="p-4 flex flex-wrap items-center justify-between gap-3 text-xs text-slate-600 bg-white">
                <div>
                  <span className="font-bold text-slate-800">Class Type:</span> {cls.name || cls.code}
                </div>
                <div>
                  <span className="font-bold text-slate-800">Base Fare:</span> {rupees(cls.fare)} / person
                </div>
                <div>
                  <span className="font-bold text-slate-800">Quota:</span> GENERAL
                </div>
              </div>
            </div>

            {/* Step 2: Passenger Details Card */}
            <div className="bg-white rounded-lg border border-slate-200 shadow-sm p-5">
              <div className="flex items-center justify-between pb-3 mb-4 border-b border-slate-200">
                <div>
                  <h3 className="font-bold text-base text-[#1b3a6b]">Passenger Details</h3>
                  <p className="text-xs text-slate-500">
                    Add passenger details as printed on government-issued photo ID (max 6 passengers).
                  </p>
                </div>
                <span className="text-xs font-bold text-slate-500 bg-slate-100 px-2 py-1 rounded">
                  {passengers.length} of 6 Added
                </span>
              </div>

              <div className="space-y-4">
                {passengers.map((p, idx) => (
                  <div 
                    key={idx} 
                    className="p-3.5 bg-slate-50 border border-slate-200 rounded-md relative group hover:border-slate-300 transition"
                  >
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs font-bold text-[#1b3a6b] uppercase tracking-wider">
                        Passenger {idx + 1}
                      </span>
                      {passengers.length > 1 && (
                        <button
                          type="button"
                          onClick={() => removePassenger(idx)}
                          className="text-red-600 hover:text-red-800 text-xs font-semibold flex items-center gap-1"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                          <span>Remove</span>
                        </button>
                      )}
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-6 gap-3">
                      {/* Name */}
                      <div className="sm:col-span-3">
                        <label className="block text-[11px] font-bold text-slate-600 mb-1">
                          Full Name *
                        </label>
                        <input
                          required
                          type="text"
                          value={p.name}
                          onChange={(e) => updatePassenger(idx, 'name', e.target.value)}
                          placeholder="e.g. Rahul Sharma"
                          className="w-full px-3 py-1.5 text-sm bg-white border border-slate-300 rounded focus:ring-1 focus:ring-[#1b3a6b] outline-none"
                        />
                      </div>

                      {/* Age */}
                      <div className="sm:col-span-1">
                        <label className="block text-[11px] font-bold text-slate-600 mb-1">
                          Age *
                        </label>
                        <input
                          required
                          type="number"
                          min="1"
                          max="120"
                          value={p.age}
                          onChange={(e) => updatePassenger(idx, 'age', e.target.value)}
                          className="w-full px-3 py-1.5 text-sm bg-white border border-slate-300 rounded focus:ring-1 focus:ring-[#1b3a6b] outline-none"
                        />
                      </div>

                      {/* Gender */}
                      <div className="sm:col-span-2">
                        <label className="block text-[11px] font-bold text-slate-600 mb-1">
                          Gender *
                        </label>
                        <select
                          value={p.gender}
                          onChange={(e) => updatePassenger(idx, 'gender', e.target.value)}
                          className="w-full px-3 py-1.5 text-sm bg-white border border-slate-300 rounded focus:ring-1 focus:ring-[#1b3a6b] outline-none"
                        >
                          <option value="M">Male (M)</option>
                          <option value="F">Female (F)</option>
                          <option value="O">Other (O)</option>
                        </select>
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              {passengers.length < 6 && (
                <div className="mt-4 pt-3 border-t border-slate-200">
                  <button
                    type="button"
                    onClick={addPassenger}
                    className="inline-flex items-center gap-1.5 text-xs font-bold text-[#1b3a6b] hover:text-[#e8711c] transition"
                  >
                    <UserPlus className="w-4 h-4" />
                    <span>+ Add Another Passenger</span>
                  </button>
                </div>
              )}
            </div>

            {/* Travel Guidelines Note */}
            <div className="p-4 bg-sky-50 border border-sky-200 rounded-lg text-xs text-sky-900 flex items-start gap-2.5">
              <Info className="w-4 h-4 text-sky-700 shrink-0 mt-0.5" />
              <div>
                <p className="font-bold">Indian Railways Boarding Advisory</p>
                <p className="mt-0.5 text-sky-800">
                  Senior citizen concessions and disability certificates must be carried in original during journey. 
                  Carrying an original Photo Identity Proof is compulsory for at least one passenger per ticket.
                </p>
              </div>
            </div>
          </div>

          {/* Right Col: Fare Summary & Confirmation */}
          <div className="space-y-6">
            <div className="bg-white rounded-lg border border-slate-200 shadow-sm p-5 sticky top-20">
              <h3 className="font-bold text-base text-[#1b3a6b] pb-2 border-b border-slate-200 mb-4">
                Fare Breakdown
              </h3>

              <div className="space-y-2.5 text-xs text-slate-700">
                <div className="flex justify-between">
                  <span>Base Ticket Fare ({passengers.length} pax)</span>
                  <span className="font-semibold tabular">{rupees(totalFare)}</span>
                </div>
                <div className="flex justify-between text-slate-500">
                  <span>IRCTC Convenience Fee</span>
                  <span className="font-semibold tabular">{rupees(irctcServiceCharge)}</span>
                </div>
                <div className="flex justify-between text-slate-500">
                  <span>GST & Safety Surcharge</span>
                  <span className="font-semibold text-emerald-700">Included</span>
                </div>

                <div className="pt-3 border-t border-slate-200 flex justify-between items-baseline">
                  <span className="text-sm font-bold text-slate-900">Total Payable</span>
                  <span className="text-2xl font-black text-[#e8711c] tabular">
                    {rupees(grandTotal)}
                  </span>
                </div>
              </div>

              {/* Booking Saga Information */}
              <div className="mt-4 p-3 bg-slate-50 rounded border border-slate-200 text-[11px] text-slate-600 space-y-1">
                <div className="flex items-center gap-1 font-bold text-[#1b3a6b]">
                  <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
                  <span>Distributed Saga Guarantee</span>
                </div>
                <p>
                  Upon clicking submit, your request joins the Kafka per-train queue. Seats are held strictly in arrival order.
                </p>
              </div>

              {/* Action Buttons */}
              <div className="mt-6 space-y-3">
                <button
                  type="submit"
                  disabled={busy || passengers.some(p => !p.name.trim())}
                  className="w-full py-3 px-4 bg-[#e8711c] hover:bg-[#d06114] disabled:opacity-50 text-white font-bold text-sm uppercase tracking-wider rounded shadow transition flex items-center justify-center gap-2"
                >
                  {busy ? (
                    <>
                      <span className="spinner-icon" />
                      <span>Allocating Seats…</span>
                    </>
                  ) : (
                    <>
                      <span>Hold Seats & Proceed</span>
                      <ArrowRight className="w-4 h-4" />
                    </>
                  )}
                </button>

                <Link
                  to="/"
                  className="block text-center w-full py-2 px-3 border border-slate-300 text-xs font-semibold text-slate-600 rounded hover:bg-slate-50 transition"
                >
                  Cancel
                </Link>
              </div>
            </div>
          </div>
        </div>
      </form>
    </div>
  );
}
