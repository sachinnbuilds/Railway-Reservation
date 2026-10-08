import React from 'react';
import { Link } from 'react-router-dom';
import { ShieldCheck, Clock, Award, HelpCircle } from 'lucide-react';

export default function Footer() {
  return (
    <footer className="mt-auto bg-[#102445] text-slate-300 text-xs">
      {/* 3 Pillars strip matching Image 1: "Safety | Security | Punctuality" */}
      <div className="border-b border-slate-700/60 bg-[#0c1a33] py-4 px-4 sm:px-6">
        <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-around gap-4 text-center">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-emerald-400" />
            <span className="font-bold text-white uppercase tracking-wider text-sm">Safety</span>
            <span className="text-slate-400 text-xs">— Highest passenger safety standards</span>
          </div>
          <div className="flex items-center gap-2">
            <Award className="w-5 h-5 text-amber-400" />
            <span className="font-bold text-white uppercase tracking-wider text-sm">Security</span>
            <span className="text-slate-400 text-xs">— 24/7 CCTV & RPF monitoring</span>
          </div>
          <div className="flex items-center gap-2">
            <Clock className="w-5 h-5 text-sky-400" />
            <span className="font-bold text-white uppercase tracking-wider text-sm">Punctuality</span>
            <span className="text-slate-400 text-xs">— Real-time tracking & on-time operations</span>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
          <div>
            <h4 className="text-white font-bold text-sm mb-3 uppercase tracking-wider">RailReserve Services</h4>
            <ul className="space-y-1.5 text-slate-300">
              <li><Link to="/" className="hover:text-white transition-colors">Train Ticket Booking</Link></li>
              <li><Link to="/pnr" className="hover:text-white transition-colors">PNR Current Status</Link></li>
              <li><Link to="/bookings" className="hover:text-white transition-colors">My Trips & Cancellations</Link></li>
              <li><Link to="/control-room" className="hover:text-white transition-colors">Architecture Control Room</Link></li>
            </ul>
          </div>
          <div>
            <h4 className="text-white font-bold text-sm mb-3 uppercase tracking-wider">Special Quotas & Trains</h4>
            <ul className="space-y-1.5 text-slate-300">
              <li><span>General Quota (GN)</span></li>
              <li><span>Tatkal Quota (CK)</span></li>
              <li><span>Ladies Quota (LD)</span></li>
              <li><span>Vande Bharat / Rajdhani / Shatabdi</span></li>
            </ul>
          </div>
          <div>
            <h4 className="text-white font-bold text-sm mb-3 uppercase tracking-wider">Passenger Support</h4>
            <ul className="space-y-1.5 text-slate-300">
              <li><span>Railway Helpline: 139</span></li>
              <li><span>Security Helpline: 182</span></li>
              <li><span>Refund Rules & Cancellation Policy</span></li>
              <li><span>Visually Impaired Assistance</span></li>
            </ul>
          </div>
          <div>
            <h4 className="text-white font-bold text-sm mb-3 uppercase tracking-wider">IRCTC Mobile & Security</h4>
            <p className="text-slate-400 leading-relaxed text-[11px]">
              Book tickets on the go with IRCTC Rail Connect official app. 256-bit SSL bank-grade encrypted payments and 24x7 verified e-ticketing platform.
            </p>
          </div>
        </div>

        <div className="mt-8 pt-4 border-t border-slate-800 flex flex-col sm:flex-row items-center justify-between gap-2 text-slate-400 text-[11px]">
          <p>© 2026 Centre for Railway Information Systems (CRIS) / IRCTC / RailReserve. All Rights Reserved.</p>
          <div className="flex gap-4">
            <span>Privacy Policy</span>
            <span>·</span>
            <span>Terms of Service</span>
            <span>·</span>
            <span>NTES National Train Inquiry</span>
          </div>
        </div>
      </div>
    </footer>
  );
}
