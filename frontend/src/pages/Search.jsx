import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { addDays, api, todayIST } from '../api.ts';
import { 
  Train, 
  ArrowRightLeft, 
  Calendar, 
  MapPin, 
  Briefcase, 
  Plane, 
  Hotel, 
  Utensils, 
  Bus, 
  ShieldCheck, 
  Clock, 
  Award,
  Sparkles,
  HelpCircle,
  FileText
} from 'lucide-react';

const DEFAULT_STATIONS = [
  { code: 'MAS', name: 'MGR Chennai Central', city: 'Chennai' },
  { code: 'SA', name: 'Salem Junction', city: 'Salem' },
  { code: 'CBE', name: 'Coimbatore Junction', city: 'Coimbatore' },
  { code: 'ED', name: 'Erode Junction', city: 'Erode' },
  { code: 'TPJ', name: 'Tiruchirappalli Junction', city: 'Tiruchirappalli' },
  { code: 'MDU', name: 'Madurai Junction', city: 'Madurai' },
  { code: 'TBM', name: 'Tambaram', city: 'Chennai' },
  { code: 'MS', name: 'Chennai Egmore', city: 'Chennai' },
  { code: 'KPD', name: 'Katpadi Junction', city: 'Vellore' },
  { code: 'JTJ', name: 'Jolarpettai Junction', city: 'Jolarpettai' },
  { code: 'NCJ', name: 'Nagercoil Junction', city: 'Nagercoil' },
  { code: 'TVC', name: 'Trivandrum Central', city: 'Thiruvananthapuram' },
  { code: 'ERS', name: 'Ernakulam Junction', city: 'Kochi' },
  { code: 'CLT', name: 'Kozhikode', city: 'Kozhikode' },
  { code: 'PGT', name: 'Palakkad Junction', city: 'Palakkad' },
  { code: 'ALLP', name: 'Alappuzha', city: 'Alappuzha' },
  { code: 'SBC', name: 'KSR Bengaluru', city: 'Bengaluru' },
  { code: 'MAQ', name: 'Mangaluru Central', city: 'Mangaluru' },
  { code: 'SC', name: 'Secunderabad Junction', city: 'Hyderabad' },
  { code: 'HYB', name: 'Hyderabad Deccan', city: 'Hyderabad' },
  { code: 'TPTY', name: 'Tirupati', city: 'Tirupati' },
  { code: 'BZA', name: 'Vijayawada Junction', city: 'Vijayawada' },
  { code: 'NDLS', name: 'New Delhi', city: 'Delhi' },
  { code: 'NZM', name: 'Hazrat Nizamuddin', city: 'Delhi' },
  { code: 'MMCT', name: 'Mumbai Central', city: 'Mumbai' },
  { code: 'PUNE', name: 'Pune Junction', city: 'Pune' },
  { code: 'ADI', name: 'Ahmedabad Junction', city: 'Ahmedabad' },
  { code: 'ST', name: 'Surat', city: 'Surat' },
  { code: 'JP', name: 'Jaipur Junction', city: 'Jaipur' },
  { code: 'LKO', name: 'Lucknow Charbagh', city: 'Lucknow' },
  { code: 'CNB', name: 'Kanpur Central', city: 'Kanpur' },
  { code: 'AGC', name: 'Agra Cantt', city: 'Agra' },
  { code: 'BPL', name: 'Bhopal Junction', city: 'Bhopal' },
  { code: 'NGP', name: 'Nagpur Junction', city: 'Nagpur' },
  { code: 'HWH', name: 'Howrah Junction', city: 'Kolkata' },
  { code: 'PNBE', name: 'Patna Junction', city: 'Patna' },
  { code: 'DHN', name: 'Dhanbad Junction', city: 'Dhanbad' },
  { code: 'TATA', name: 'Tatanagar Junction', city: 'Jamshedpur' },
  { code: 'GHY', name: 'Guwahati', city: 'Guwahati' },
];

export default function Search({ auth }) {
  const today = todayIST();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const [stations, setStations] = useState(DEFAULT_STATIONS);
  const [q, setQ] = useState({
    from: searchParams.get('from') || 'MAS',
    to: searchParams.get('to') || 'SA',
    date: searchParams.get('date') || addDays(today, 1),
    quota: 'GENERAL',
    travelClass: 'ALL',
  });

  // Checkbox concessions (IRCTC standard)
  const [disabilityConcession, setDisabilityConcession] = useState(false);
  const [flexibleDate, setFlexibleDate] = useState(false);
  const [availableBerthOnly, setAvailableBerthOnly] = useState(false);
  const [passConcession, setPassConcession] = useState(false);

  const [error, setError] = useState(null);

  useEffect(() => {
    api('/api/stations')
      .then((data) => {
        if (Array.isArray(data) && data.length > 0) {
          // Merge stations avoiding duplicates
          const codes = new Set(data.map((s) => s.code));
          const merged = [...data];
          DEFAULT_STATIONS.forEach((s) => {
            if (!codes.has(s.code)) merged.push(s);
          });
          setStations(merged);
        }
      })
      .catch((e) => {
        // Safe fallback to default stations
        console.warn('Backend station fetch fallback:', e.message);
      });
  }, []);

  const search = (e) => {
    e?.preventDefault();
    navigate(`/trains?from=${q.from}&to=${q.to}&date=${q.date}`);
  };

  const swap = () => setQ({ ...q, from: q.to, to: q.from });

  const safeStations = Array.isArray(stations) && stations.length > 0 ? stations : DEFAULT_STATIONS;

  return (
    <div className="w-full">
      {/* =====================================================================
          AUTHENTIC IRCTC HERO SECTION (Matching Official IRCTC eTicketing)
          ===================================================================== */}
      <section className="relative w-full min-h-[540px] bg-gradient-to-r from-[#d9ebfb] via-[#e5f1fc] to-[#cae4fa] overflow-hidden py-8 px-4 sm:px-6 lg:px-8 border-b border-slate-300">
        {/* Subtle Railway track & train background illustration */}
        <div className="absolute right-0 top-0 bottom-0 w-full lg:w-3/5 pointer-events-none opacity-25 lg:opacity-90 flex items-center justify-end z-0">
          <svg className="w-full h-full max-h-[500px]" viewBox="0 0 800 450" fill="none" xmlns="http://www.w3.org/2000/svg">
            <defs>
              <linearGradient id="skyGrad" x1="0%" y1="0%" x2="0%" y2="100%">
                <stop offset="0%" stopColor="#bfdbfe" stopOpacity="0.4" />
                <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
              </linearGradient>
              <linearGradient id="trainNavy" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" stopColor="#1b3a6b" />
                <stop offset="100%" stopColor="#0d244a" />
              </linearGradient>
            </defs>

            {/* Distant Hills & Track lines */}
            <path d="M100 340 C 300 310, 500 320, 800 340 L 800 450 L 0 450 Z" fill="#93c5fd" fillOpacity="0.15" />
            <path d="M0 380 L 800 380" stroke="#94a3b8" strokeWidth="2" strokeDasharray="12 8" />
            <path d="M0 405 L 800 405" stroke="#64748b" strokeWidth="3" />
            <path d="M0 435 L 800 435" stroke="#475569" strokeWidth="4" />

            {/* Aerodynamic Vande Bharat Express Style Train Nose */}
            <g transform="translate(180, 210)">
              {/* Train Body */}
              <path d="M50 170 C 140 170, 260 165, 340 150 C 440 130, 530 90, 580 40 C 585 35, 575 10, 550 5 C 480 -5, 300 0, 50 0 Z" fill="#ffffff" stroke="#cbd5e1" strokeWidth="2" />
              {/* Blue Aerodynamic Stripe */}
              <path d="M50 85 C 220 85, 360 80, 450 65 C 500 55, 540 38, 560 22 C 550 15, 520 18, 460 25 C 380 35, 200 40, 50 40 Z" fill="url(#trainNavy)" />
              {/* Orange Accent Speed Line */}
              <path d="M50 95 C 240 95, 380 90, 470 73 C 510 65, 535 52, 545 42 C 538 38, 510 45, 470 55 C 380 72, 220 75, 50 75 Z" fill="#e8711c" />
              {/* Pilot Windshield Glass */}
              <path d="M440 28 C 475 22, 520 15, 535 12 C 540 10, 535 30, 515 40 C 475 48, 440 45, 440 28 Z" fill="#1e293b" />
              {/* LED Headlights */}
              <circle cx="550" cy="30" r="5" fill="#fef08a" />
              <circle cx="550" cy="30" r="10" fill="#fef08a" fillOpacity="0.3" />
            </g>
          </svg>
        </div>

        <div className="max-w-7xl mx-auto relative z-10 flex flex-col lg:flex-row items-center justify-between gap-8">
          
          {/* =====================================================================
              LEFT: AUTHENTIC IRCTC "BOOK TICKET" CARD
              ===================================================================== */}
          <div className="w-full max-w-[520px] bg-white rounded-lg shadow-xl border border-slate-200 overflow-hidden">
            {/* Top Tabs */}
            <div className="flex bg-[#1b3a6b] text-white">
              <div className="flex-1 py-3 px-4 flex items-center justify-center gap-2 font-bold text-xs uppercase tracking-wider bg-[#0f244a] border-b-2 border-orange-500">
                <Train className="w-4 h-4 text-orange-400" />
                <span>Book Ticket</span>
              </div>
              <Link 
                to="/pnr" 
                className="flex-1 py-3 px-4 flex items-center justify-center gap-2 font-semibold text-xs uppercase tracking-wider text-slate-200 hover:bg-[#142d54] transition-colors border-l border-white/10"
              >
                <FileText className="w-4 h-4 text-sky-300" />
                <span>PNR Status</span>
              </Link>
            </div>

            {/* Search Form Body */}
            <div className="p-5 sm:p-6">
              <h2 className="text-xl font-extrabold text-[#1b3a6b] uppercase tracking-wide text-center mb-5 flex items-center justify-center gap-2">
                <span>Book Train Journey</span>
              </h2>

              <form onSubmit={search} className="space-y-4">
                {/* Station Selection Row with Swap Button */}
                <div className="grid grid-cols-[1fr,auto,1fr] gap-2 items-center">
                  {/* From Station */}
                  <div>
                    <label className="block text-[11px] font-bold text-slate-600 uppercase mb-1">
                      From Station
                    </label>
                    <div className="relative">
                      <select
                        value={q.from}
                        onChange={(e) => setQ({ ...q, from: e.target.value })}
                        className="w-full h-11 pl-3 pr-2 border border-slate-300 rounded font-semibold text-slate-800 text-xs sm:text-sm focus:border-[#1b3a6b] focus:ring-1 focus:ring-[#1b3a6b] outline-none bg-white"
                      >
                        {safeStations.map((s) => (
                          <option key={`from-${s.code}`} value={s.code}>
                            {s.code} - {s.name} ({s.city})
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  {/* Swap Button */}
                  <div className="pt-5">
                    <button
                      type="button"
                      onClick={swap}
                      className="w-9 h-9 rounded-full border border-slate-300 bg-slate-50 hover:bg-slate-100 text-[#1b3a6b] flex items-center justify-center transition hover:rotate-180 duration-200 shadow-sm"
                      title="Swap From and To stations"
                      aria-label="Swap stations"
                    >
                      <ArrowRightLeft className="w-4 h-4" />
                    </button>
                  </div>

                  {/* To Station */}
                  <div>
                    <label className="block text-[11px] font-bold text-slate-600 uppercase mb-1">
                      To Station
                    </label>
                    <div className="relative">
                      <select
                        value={q.to}
                        onChange={(e) => setQ({ ...q, to: e.target.value })}
                        className="w-full h-11 pl-3 pr-2 border border-slate-300 rounded font-semibold text-slate-800 text-xs sm:text-sm focus:border-[#1b3a6b] focus:ring-1 focus:ring-[#1b3a6b] outline-none bg-white"
                      >
                        {safeStations.map((s) => (
                          <option key={`to-${s.code}`} value={s.code}>
                            {s.code} - {s.name} ({s.city})
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                </div>

                {/* Date & Quota Row */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {/* Journey Date */}
                  <div>
                    <label className="block text-[11px] font-bold text-slate-600 uppercase mb-1">
                      Journey Date
                    </label>
                    <div className="relative">
                      <input
                        type="date"
                        value={q.date}
                        min={today}
                        max={addDays(today, 120)}
                        onChange={(e) => setQ({ ...q, date: e.target.value })}
                        className="w-full h-11 px-3 border border-slate-300 rounded font-semibold text-slate-800 text-xs sm:text-sm focus:border-[#1b3a6b] focus:ring-1 focus:ring-[#1b3a6b] outline-none bg-white"
                      />
                    </div>
                  </div>

                  {/* Quota */}
                  <div>
                    <label className="block text-[11px] font-bold text-slate-600 uppercase mb-1">
                      Quota
                    </label>
                    <select
                      value={q.quota}
                      onChange={(e) => setQ({ ...q, quota: e.target.value })}
                      className="w-full h-11 px-3 border border-slate-300 rounded font-semibold text-slate-800 text-xs sm:text-sm focus:border-[#1b3a6b] focus:ring-1 focus:ring-[#1b3a6b] outline-none bg-white"
                    >
                      <option value="GENERAL">GENERAL</option>
                      <option value="TATKAL">TATKAL</option>
                      <option value="LADIES">LADIES</option>
                      <option value="SR_CITIZEN">LOWER BERTH / SR.CITIZEN</option>
                      <option value="DIVYANGJAN">PERSON WITH DISABILITY</option>
                    </select>
                  </div>
                </div>

                {/* Travel Class Selection */}
                <div>
                  <label className="block text-[11px] font-bold text-slate-600 uppercase mb-1">
                    Class
                  </label>
                  <select
                    value={q.travelClass}
                    onChange={(e) => setQ({ ...q, travelClass: e.target.value })}
                    className="w-full h-11 px-3 border border-slate-300 rounded font-semibold text-slate-800 text-xs sm:text-sm focus:border-[#1b3a6b] focus:ring-1 focus:ring-[#1b3a6b] outline-none bg-white"
                  >
                    <option value="ALL">All Classes</option>
                    <option value="1A">AC First Class (1A)</option>
                    <option value="2A">AC 2 Tier (2A)</option>
                    <option value="3A">AC 3 Tier (3A)</option>
                    <option value="3E">AC 3 Economy (3E)</option>
                    <option value="EC">Exec. Chair Car (EC)</option>
                    <option value="CC">AC Chair Car (CC)</option>
                    <option value="SL">Sleeper (SL)</option>
                    <option value="2S">Second Sitting (2S)</option>
                  </select>
                </div>

                {/* IRCTC Official Concession Checkboxes */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1 text-xs text-slate-700">
                  <label className="flex items-center gap-2 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={disabilityConcession}
                      onChange={(e) => setDisabilityConcession(e.target.checked)}
                      className="rounded text-[#1b3a6b] focus:ring-0 w-4 h-4 cursor-pointer"
                    />
                    <span>Person With Disability</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={flexibleDate}
                      onChange={(e) => setFlexibleDate(e.target.checked)}
                      className="rounded text-[#1b3a6b] focus:ring-0 w-4 h-4 cursor-pointer"
                    />
                    <span>Flexible With Date</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={availableBerthOnly}
                      onChange={(e) => setAvailableBerthOnly(e.target.checked)}
                      className="rounded text-[#1b3a6b] focus:ring-0 w-4 h-4 cursor-pointer"
                    />
                    <span>Train with Available Berth</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={passConcession}
                      onChange={(e) => setPassConcession(e.target.checked)}
                      className="rounded text-[#1b3a6b] focus:ring-0 w-4 h-4 cursor-pointer"
                    />
                    <span>Railway Pass Concession</span>
                  </label>
                </div>

                {/* Primary Orange Search CTA */}
                <button
                  type="submit"
                  className="w-full h-12 bg-[#e8711c] hover:bg-[#d06114] text-white font-extrabold text-sm uppercase tracking-wider rounded shadow-md hover:shadow-lg transition-all flex items-center justify-center gap-2 cursor-pointer mt-2"
                >
                  <Train className="w-5 h-5" />
                  <span>Search Trains</span>
                </button>
              </form>

              {/* Popular Quick Route Chips */}
              <div className="mt-4 pt-3 border-t border-slate-100">
                <span className="text-[11px] font-bold text-slate-500 uppercase mr-1">Popular:</span>
                <div className="inline-flex flex-wrap gap-1.5 mt-1">
                  {[
                    { label: 'Chennai → Salem', from: 'MAS', to: 'SA' },
                    { label: 'Delhi → Mumbai', from: 'NDLS', to: 'MMCT' },
                    { label: 'Chennai → Coimbatore', from: 'MAS', to: 'CBE' },
                    { label: 'Delhi → Bhopal', from: 'NDLS', to: 'BPL' },
                    { label: 'Bengaluru → Chennai', from: 'SBC', to: 'MAS' },
                    { label: 'Kolkata → Patna', from: 'HWH', to: 'PNBE' },
                  ].map((route) => (
                    <button
                      key={route.label}
                      type="button"
                      onClick={() => {
                        setQ({ ...q, from: route.from, to: route.to });
                        navigate(`/trains?from=${route.from}&to=${route.to}&date=${q.date}`);
                      }}
                      className="text-[11px] font-medium bg-slate-100 hover:bg-slate-200 text-slate-700 px-2 py-0.5 rounded transition"
                    >
                      {route.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* =====================================================================
              RIGHT: OFFICIAL INDIAN RAILWAYS MOTTO & BRANDING (No Capstone Junk)
              ===================================================================== */}
          <div className="flex-1 text-center lg:text-right space-y-4">
            <div>
              <span className="inline-block bg-[#1b3a6b]/10 text-[#1b3a6b] font-bold text-xs px-3 py-1 rounded-full uppercase tracking-wider mb-2">
                Government of India · Ministry of Railways
              </span>
              <h1 className="text-3xl sm:text-5xl font-black text-[#1b3a6b] tracking-tight leading-none uppercase">
                INDIAN RAILWAYS
              </h1>
              <p className="text-base sm:text-lg font-bold text-[#e8711c] mt-2 tracking-wide uppercase">
                Safety · Security · Punctuality
              </p>
            </div>

            <p className="text-sm text-slate-600 max-w-lg lg:ml-auto leading-relaxed">
              Official Indian Railways e-Ticketing platform. Book confirmed passenger train tickets, Tatkal quota, Vande Bharat Express, and check real-time PNR status across India.
            </p>

            <div className="flex flex-wrap justify-center lg:justify-end gap-3 pt-2">
              <Link 
                to="/pnr"
                className="inline-flex items-center gap-2 px-4 py-2 bg-white/80 hover:bg-white text-[#1b3a6b] font-bold text-xs rounded border border-slate-300 shadow-sm transition"
              >
                <FileText className="w-4 h-4 text-[#1b3a6b]" />
                <span>Check PNR Status</span>
              </Link>
              <Link 
                to="/login"
                className="inline-flex items-center gap-2 px-4 py-2 bg-[#1b3a6b] hover:bg-[#0d244a] text-white font-bold text-xs rounded shadow transition"
              >
                <span>IRCTC User Login</span>
              </Link>
            </div>
          </div>

        </div>
      </section>

      {/* =====================================================================
          IRCTC OFFICIAL SERVICES QUICK BAR (Flights, Hotels, E-Catering, etc.)
          ===================================================================== */}
      <section className="bg-white border-b border-slate-200 py-6 px-4 sm:px-6">
        <div className="max-w-7xl mx-auto">
          <div className="text-center mb-6">
            <h3 className="text-base font-extrabold text-[#1b3a6b] uppercase tracking-wider">
              Have you not found the right train? Explore other IRCTC Services
            </h3>
            <p className="text-xs text-slate-500 mt-1">
              Complete travel solutions provided by Indian Railway Catering and Tourism Corporation
            </p>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3 text-center">
            {[
              { icon: Train, label: 'Trains', desc: 'Book Tickets', to: '/' },
              { icon: Plane, label: 'Flights', desc: 'Lowest Fares', to: '/' },
              { icon: Hotel, label: 'Hotels', desc: 'Affordable Stays', to: '/' },
              { icon: Utensils, label: 'E-Catering', desc: 'Food on Track', to: '/' },
              { icon: Bus, label: 'Bus Tickets', desc: 'State & Private', to: '/' },
              { icon: Sparkles, label: 'Holidays', desc: 'Tour Packages', to: '/' },
              { icon: Briefcase, label: 'Charter Train', desc: 'Group Booking', to: '/' },
              { icon: HelpCircle, label: 'Help 139', desc: '24x7 Rail Support', to: '/' },
            ].map((s, idx) => (
              <div 
                key={idx}
                className="p-3 bg-slate-50 hover:bg-[#eef4fc] rounded-lg border border-slate-200 transition-all hover:-translate-y-0.5 cursor-pointer group"
                onClick={() => {
                  if (s.to === '/') {
                    window.scrollTo({ top: 0, behavior: 'smooth' });
                  }
                }}
              >
                <div className="w-10 h-10 mx-auto rounded-full bg-white shadow-sm flex items-center justify-center text-[#1b3a6b] group-hover:bg-[#1b3a6b] group-hover:text-white transition-colors mb-2">
                  <s.icon className="w-5 h-5" />
                </div>
                <div className="font-bold text-xs text-slate-800 group-hover:text-[#1b3a6b]">{s.label}</div>
                <div className="text-[10px] text-slate-500">{s.desc}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* =====================================================================
          SAFETY · SECURITY · PUNCTUALITY STRIP (Official CRIS & Railways)
          ===================================================================== */}
      <section className="bg-[#f8fafc] border-b border-slate-200 py-6 px-4 sm:px-6">
        <div className="max-w-7xl mx-auto grid grid-cols-1 md:grid-cols-3 gap-6 text-center sm:text-left">
          <div className="flex items-center gap-3 p-3 bg-white rounded border border-slate-200">
            <div className="w-10 h-10 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center shrink-0">
              <ShieldCheck className="w-6 h-6" />
            </div>
            <div>
              <div className="font-bold text-slate-900 text-xs uppercase tracking-wider">Passenger Safety</div>
              <div className="text-xs text-slate-500">Highest safety standards & anti-collision systems</div>
            </div>
          </div>

          <div className="flex items-center gap-3 p-3 bg-white rounded border border-slate-200">
            <div className="w-10 h-10 rounded-full bg-amber-100 text-amber-700 flex items-center justify-center shrink-0">
              <Award className="w-6 h-6" />
            </div>
            <div>
              <div className="font-bold text-slate-900 text-xs uppercase tracking-wider">24x7 Security</div>
              <div className="text-xs text-slate-500">RPF monitoring & all-India emergency helpline 182</div>
            </div>
          </div>

          <div className="flex items-center gap-3 p-3 bg-white rounded border border-slate-200">
            <div className="w-10 h-10 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center shrink-0">
              <Clock className="w-6 h-6" />
            </div>
            <div>
              <div className="font-bold text-slate-900 text-xs uppercase tracking-wider">Punctuality Focus</div>
              <div className="text-xs text-slate-500">Real-time GPS train status via NTES inquiry</div>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
