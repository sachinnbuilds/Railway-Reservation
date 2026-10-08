import { useEffect, useState, useMemo } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { addDays, api, todayIST } from '../api.ts';
import { 
  Send, 
  MapPin, 
  ArrowRightLeft, 
  Calendar, 
  Briefcase, 
  RotateCw, 
  ChevronUp, 
  ChevronDown 
} from 'lucide-react';

const STATION_NAMES = {
  MAS: 'MGR CHENNAI CTL',
  SA: 'SALEM JN.',
  CBE: 'COIMBATORE JN.',
  ED: 'ERODE JN.',
  TPJ: 'TIRUCHCHIRAPPALLI',
  MDU: 'MADURAI JN.',
  TBM: 'TAMBARAM',
  MS: 'CHENNAI EGMORE',
  KPD: 'KATPADI JN.',
  JTJ: 'JOLARPETTAI',
  NCJ: 'NAGERCOIL JN.',
  TVC: 'TRIVANDRUM CENTRAL',
  ERS: 'ERNAKULAM JN.',
  CLT: 'KOZHIKODE',
  PGT: 'PALAKKAD JN.',
  ALLP: 'ALAPPUZHA',
  SBC: 'KSR BENGALURU',
  MAQ: 'MANGALURU CENTRAL',
  SC: 'SECUNDERABAD JN.',
  HYB: 'HYDERABAD DECCAN',
  TPTY: 'TIRUPATI',
  BZA: 'VIJAYAWADA JN.',
  NDLS: 'NEW DELHI',
  NZM: 'HAZRAT NIZAMUDDIN',
  MMCT: 'MUMBAI CENTRAL',
  PUNE: 'PUNE JN.',
  ADI: 'AHMEDABAD JN.',
  ST: 'SURAT',
  JP: 'JAIPUR JN.',
  LKO: 'LUCKNOW CHARBAGH',
  CNB: 'KANPUR CENTRAL',
  AGC: 'AGRA CANTT',
  BPL: 'BHOPAL JN.',
  NGP: 'NAGPUR JN.',
  HWH: 'HOWRAH JN.',
  PNBE: 'PATNA JN.',
  DHN: 'DHANBAD JN.',
  TATA: 'TATANAGAR JN.',
  GHY: 'GUWAHATI',
};

const CLASS_FULL_NAMES = {
  '1A': 'AC First Class (1A)',
  '2A': 'AC 2 Tier (2A)',
  '3A': 'AC 3 Tier (3A)',
  '3E': 'AC 3 Economy (3E)',
  'CC': 'AC Chair car (CC)',
  'EC': 'Exec. Chair Car (EC)',
  'SL': 'Sleeper (SL)',
  '2S': 'Second Sitting (2S)',
};

function formatFullDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  return new Intl.DateTimeFormat('en-GB', {
    weekday: 'short',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(d);
}

function formatShortDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  return new Intl.DateTimeFormat('en-GB', {
    weekday: 'short',
    day: '2-digit',
    month: 'short',
  }).format(d);
}

function formatDuration(minutes) {
  if (!minutes) return '04:00';
  const hrs = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${String(hrs).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
}

export default function TrainResults({ auth }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();

  const from = (searchParams.get('from') || 'MAS').toUpperCase();
  const to = (searchParams.get('to') || 'SA').toUpperCase();
  const date = searchParams.get('date') || todayIST();

  // Search input state for the top modify bar
  const [inputFrom, setInputFrom] = useState(from);
  const [inputTo, setInputTo] = useState(to);
  const [inputDate, setInputDate] = useState(date);
  const [inputClass, setInputClass] = useState('ALL');
  const [inputQuota, setInputQuota] = useState('GENERAL');

  // Concession Checkboxes
  const [flexibleWithDate, setFlexibleWithDate] = useState(false);
  const [disabilityConcession, setDisabilityConcession] = useState(false);
  const [railwayPassConcession, setRailwayPassConcession] = useState(false);

  // Results State
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  // Selected Class per Train: { [trainNumber]: classObject }
  const [selectedClasses, setSelectedClasses] = useState({});

  // Filter States
  const [filterClasses, setFilterClasses] = useState({
    '1A': true,
    '2A': true,
    '2S': true,
    '3A': true,
    '3E': true,
    'CC': true,
    'EC': true,
    'SL': true,
  });

  const [filterTrainType, setFilterTrainType] = useState({
    OTHER: true,
    SHATABDI: true,
    VANDE_BHARAT: true,
  });

  const [filterTime, setFilterTime] = useState('ALL'); // ALL, EARLY, MORNING, MIDDAY, NIGHT

  // Collapsible sidebar sections
  const [openSections, setOpenSections] = useState({
    class: true,
    type: true,
    time: true,
  });

  // Keep input values synced when URL changes
  useEffect(() => {
    setInputFrom(from);
    setInputTo(to);
    setInputDate(date);
  }, [from, to, date]);

  // Fetch search results
  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);

    const params = new URLSearchParams({ from, to, date });
    api(`/api/search?${params}`)
      .then((data) => {
        if (!alive) return;
        setResult(data && typeof data === 'object' ? data : null);

        // Pre-select first available class for each train
        if (data && Array.isArray(data.trains)) {
          const initialSelected = {};
          data.trains.forEach((t) => {
            if (t.classes && t.classes.length > 0) {
              const best = t.classes.find((c) => c.status === 'AVAILABLE') || t.classes[0];
              initialSelected[t.number] = best;
            }
          });
          setSelectedClasses(initialSelected);
        }
      })
      .catch((err) => {
        if (!alive) return;
        setError(err.message || 'Unable to fetch trains');
      })
      .finally(() => {
        if (alive) setLoading(false);
      });

    return () => {
      alive = false;
    };
  }, [from, to, date]);

  const handleModifySearch = (e) => {
    e?.preventDefault();
    setSearchParams({ from: inputFrom, to: inputTo, date: inputDate });
  };

  const handleSwap = () => {
    const temp = inputFrom;
    setInputFrom(inputTo);
    setInputTo(temp);
  };

  const handlePrevDay = () => {
    const today = todayIST();
    const prevDate = addDays(date, -1);
    if (prevDate >= today) {
      setSearchParams({ from, to, date: prevDate });
    }
  };

  const handleNextDay = () => {
    const nextDate = addDays(date, 1);
    setSearchParams({ from, to, date: nextDate });
  };

  const handleResetFilters = () => {
    const allCls = {};
    Object.keys(filterClasses).forEach((k) => (allCls[k] = true));
    setFilterClasses(allCls);
    setFilterTrainType({ OTHER: true, SHATABDI: true, VANDE_BHARAT: true });
    setFilterTime('ALL');
  };

  const handleSelectAllClasses = () => {
    const allChecked = Object.values(filterClasses).every(Boolean);
    const next = {};
    Object.keys(filterClasses).forEach((k) => (next[k] = !allChecked));
    setFilterClasses(next);
  };

  const handleSelectAllTypes = () => {
    const allChecked = Object.values(filterTrainType).every(Boolean);
    const next = {};
    Object.keys(filterTrainType).forEach((k) => (next[k] = !allChecked));
    setFilterTrainType(next);
  };

  // Filtered Trains computation
  const filteredTrains = useMemo(() => {
    if (!result || !Array.isArray(result.trains)) return [];

    return result.trains.filter((t) => {
      // 1. Journey Class filter
      const classes = Array.isArray(t.classes) ? t.classes : [];
      const hasMatchingClass = classes.some((c) => filterClasses[c.code] ?? true);
      if (!hasMatchingClass) return false;

      // 2. Train Type filter
      const type = (t.type || 'OTHER').toUpperCase();
      if (type.includes('SHATABDI') && !filterTrainType.SHATABDI) return false;
      if (type.includes('VANDE') && !filterTrainType.VANDE_BHARAT) return false;
      if (!type.includes('SHATABDI') && !type.includes('VANDE') && !filterTrainType.OTHER) return false;

      // 3. Departure Time filter
      if (filterTime !== 'ALL' && t.departure) {
        const hour = parseInt(t.departure.split(':')[0], 10);
        if (filterTime === 'EARLY' && (hour < 0 || hour >= 6)) return false;
        if (filterTime === 'MORNING' && (hour < 6 || hour >= 12)) return false;
        if (filterTime === 'MIDDAY' && (hour < 12 || hour >= 18)) return false;
        if (filterTime === 'NIGHT' && (hour < 18 || hour >= 24)) return false;
      }

      return true;
    });
  }, [result, filterClasses, filterTrainType, filterTime]);

  const fromName = STATION_NAMES[from] || from;
  const toName = STATION_NAMES[to] || to;
  const dateFormatted = formatFullDate(date);

  return (
    <div className="w-full bg-[#f4f6fa] min-h-[calc(100vh-140px)] pb-12">
      {/* =====================================================================
          TOP SEARCH & MODIFY BAR (Matching Screenshot 2026-10-05 212852.png)
          ===================================================================== */}
      <section className="w-full bg-[#1b3a6b] py-3.5 px-4 sm:px-6 shadow-md">
        <div className="max-w-[1400px] mx-auto">
          <form onSubmit={handleModifySearch}>
            {/* Input Row */}
            <div className="flex flex-wrap items-center gap-2 text-xs">
              {/* From Station Input */}
              <div className="flex-1 min-w-[200px] bg-white rounded flex items-center px-3 h-10 border border-slate-300">
                <Send className="w-3.5 h-3.5 text-slate-500 mr-2 shrink-0 rotate-45" />
                <input
                  type="text"
                  value={inputFrom}
                  onChange={(e) => setInputFrom(e.target.value.toUpperCase())}
                  className="w-full font-bold text-slate-800 uppercase outline-none text-xs sm:text-sm"
                  placeholder="From Station Code (e.g. MAS)"
                />
              </div>

              {/* Station Swap Button */}
              <button
                type="button"
                onClick={handleSwap}
                className="w-8 h-8 rounded-full bg-white text-[#1b3a6b] flex items-center justify-center hover:bg-slate-100 transition shadow-sm shrink-0"
                title="Swap stations"
              >
                <ArrowRightLeft className="w-4 h-4" />
              </button>

              {/* To Station Input */}
              <div className="flex-1 min-w-[200px] bg-white rounded flex items-center px-3 h-10 border border-slate-300">
                <MapPin className="w-3.5 h-3.5 text-slate-500 mr-2 shrink-0" />
                <input
                  type="text"
                  value={inputTo}
                  onChange={(e) => setInputTo(e.target.value.toUpperCase())}
                  className="w-full font-bold text-slate-800 uppercase outline-none text-xs sm:text-sm"
                  placeholder="To Station Code (e.g. SA)"
                />
              </div>

              {/* Date Input */}
              <div className="w-[150px] bg-white rounded flex items-center px-3 h-10 border border-slate-300">
                <Calendar className="w-3.5 h-3.5 text-slate-500 mr-2 shrink-0" />
                <input
                  type="date"
                  value={inputDate}
                  min={todayIST()}
                  onChange={(e) => setInputDate(e.target.value)}
                  className="w-full font-bold text-slate-800 outline-none text-xs"
                />
              </div>

              {/* All Classes Dropdown */}
              <div className="w-[140px] bg-white rounded flex items-center px-2 h-10 border border-slate-300">
                <Briefcase className="w-3.5 h-3.5 text-slate-500 mr-1.5 shrink-0" />
                <select
                  value={inputClass}
                  onChange={(e) => setInputClass(e.target.value)}
                  className="w-full font-bold text-slate-800 outline-none bg-white text-xs cursor-pointer"
                >
                  <option value="ALL">All Classes</option>
                  <option value="1A">AC First Class (1A)</option>
                  <option value="2A">AC 2 Tier (2A)</option>
                  <option value="3A">AC 3 Tier (3A)</option>
                  <option value="3E">AC 3 Economy (3E)</option>
                  <option value="CC">AC Chair car (CC)</option>
                  <option value="EC">Exec. Chair Car (EC)</option>
                  <option value="SL">Sleeper (SL)</option>
                  <option value="2S">Second Sitting (2S)</option>
                </select>
              </div>

              {/* Quota Dropdown */}
              <div className="w-[130px] bg-white rounded flex items-center px-2 h-10 border border-slate-300">
                <select
                  value={inputQuota}
                  onChange={(e) => setInputQuota(e.target.value)}
                  className="w-full font-bold text-slate-800 outline-none bg-white text-xs cursor-pointer"
                >
                  <option value="GENERAL">GENERAL</option>
                  <option value="TATKAL">TATKAL</option>
                  <option value="LADIES">LADIES</option>
                  <option value="SR_CITIZEN">LOWER BERTH</option>
                  <option value="DIVYANGJAN">DIVYANGJAN</option>
                </select>
              </div>

              {/* Primary Orange Modify Search Button */}
              <button
                type="submit"
                className="h-10 px-6 bg-[#e8711c] hover:bg-[#d06012] text-white font-extrabold uppercase text-xs tracking-wider rounded shadow transition cursor-pointer shrink-0"
              >
                Modify Search
              </button>
            </div>

            {/* Concession Checkbox Row */}
            <div className="flex flex-wrap items-center gap-6 mt-2.5 text-[11px] font-medium text-white/90">
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={flexibleWithDate}
                  onChange={(e) => setFlexibleWithDate(e.target.checked)}
                  className="accent-[#e8711c] w-3.5 h-3.5"
                />
                <span>Flexible With Date</span>
              </label>

              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={disabilityConcession}
                  onChange={(e) => setDisabilityConcession(e.target.checked)}
                  className="accent-[#e8711c] w-3.5 h-3.5"
                />
                <span>Person With Disability Concession</span>
              </label>

              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={railwayPassConcession}
                  onChange={(e) => setRailwayPassConcession(e.target.checked)}
                  className="accent-[#e8711c] w-3.5 h-3.5"
                />
                <span>Railway Pass Concession</span>
              </label>
            </div>
          </form>
        </div>
      </section>

      {/* =====================================================================
          MAIN 2-COLUMN LAYOUT (Refine Results Sidebar + Right Train Results)
          ===================================================================== */}
      <div className="max-w-[1400px] mx-auto px-4 sm:px-6 pt-5">
        <div className="grid grid-cols-1 lg:grid-cols-[260px_1fr] gap-5 items-start">
          
          {/* =====================================================================
              LEFT SIDEBAR: REFINE RESULTS
              ===================================================================== */}
          <aside className="bg-white rounded border border-[#cbd5e1] shadow-sm overflow-hidden">
            {/* Sidebar Top Header */}
            <div className="px-4 py-2.5 flex items-center justify-between border-b border-slate-200 bg-white">
              <span className="font-extrabold text-sm text-slate-800">Refine Results</span>
              <button
                type="button"
                onClick={handleResetFilters}
                className="text-xs font-bold text-red-600 hover:text-red-800 transition"
              >
                Remove Filter
              </button>
            </div>

            {/* Section 1: JOURNEY CLASS */}
            <div className="border-b border-slate-200 p-3.5">
              <div className="flex items-center justify-between text-xs font-bold text-slate-700 uppercase tracking-wide mb-2.5">
                <span>JOURNEY CLASS</span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={handleSelectAllClasses}
                    className="text-[11px] text-blue-600 font-semibold hover:underline"
                  >
                    Select All
                  </button>
                  <button
                    type="button"
                    onClick={() => setOpenSections((s) => ({ ...s, class: !s.class }))}
                    className="text-slate-400 hover:text-slate-600"
                  >
                    {openSections.class ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                  </button>
                </div>
              </div>

              {openSections.class && (
                <div className="grid grid-cols-2 gap-x-2 gap-y-2 text-xs text-slate-800">
                  {['1A', '2A', '2S', '3A', '3E', 'CC', 'EC', 'SL'].map((code) => (
                    <label key={code} className="flex items-center gap-1.5 cursor-pointer select-none text-[11px]">
                      <input
                        type="checkbox"
                        checked={filterClasses[code] ?? true}
                        onChange={(e) =>
                          setFilterClasses({ ...filterClasses, [code]: e.target.checked })
                        }
                        className="rounded accent-[#1b3a6b] w-3.5 h-3.5"
                      />
                      <span className="truncate">{CLASS_FULL_NAMES[code] || code}</span>
                    </label>
                  ))}
                </div>
              )}
            </div>

            {/* Section 2: TRAIN TYPE */}
            <div className="border-b border-slate-200 p-3.5">
              <div className="flex items-center justify-between text-xs font-bold text-slate-700 uppercase tracking-wide mb-2.5">
                <span>TRAIN TYPE</span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={handleSelectAllTypes}
                    className="text-[11px] text-blue-600 font-semibold hover:underline"
                  >
                    Select All
                  </button>
                  <button
                    type="button"
                    onClick={() => setOpenSections((s) => ({ ...s, type: !s.type }))}
                    className="text-slate-400 hover:text-slate-600"
                  >
                    {openSections.type ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                  </button>
                </div>
              </div>

              {openSections.type && (
                <div className="space-y-2 text-xs text-slate-800">
                  <label className="flex items-center gap-2 cursor-pointer select-none text-[12px]">
                    <input
                      type="checkbox"
                      checked={filterTrainType.OTHER}
                      onChange={(e) =>
                        setFilterTrainType({ ...filterTrainType, OTHER: e.target.checked })
                      }
                      className="rounded accent-[#1b3a6b] w-3.5 h-3.5"
                    />
                    <span>OTHER</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer select-none text-[12px]">
                    <input
                      type="checkbox"
                      checked={filterTrainType.SHATABDI}
                      onChange={(e) =>
                        setFilterTrainType({ ...filterTrainType, SHATABDI: e.target.checked })
                      }
                      className="rounded accent-[#1b3a6b] w-3.5 h-3.5"
                    />
                    <span>SHATABDI</span>
                  </label>
                </div>
              )}
            </div>

            {/* Section 3: DEPARTURE TIME (2x2 Grid of Navy Buttons) */}
            <div className="p-3.5">
              <div className="flex items-center justify-between text-xs font-bold text-slate-700 uppercase tracking-wide mb-2.5">
                <span>DEPARTURE TIME</span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setFilterTime('ALL')}
                    className="text-[11px] text-blue-600 font-semibold hover:underline"
                  >
                    Select All
                  </button>
                  <button
                    type="button"
                    onClick={() => setOpenSections((s) => ({ ...s, time: !s.time }))}
                    className="text-slate-400 hover:text-slate-600"
                  >
                    {openSections.time ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                  </button>
                </div>
              </div>

              {openSections.time && (
                <div className="grid grid-cols-2 gap-2 text-center">
                  <button
                    type="button"
                    onClick={() => setFilterTime(filterTime === 'EARLY' ? 'ALL' : 'EARLY')}
                    className={`py-2 px-1 rounded text-white font-bold transition ${
                      filterTime === 'EARLY'
                        ? 'bg-[#0a1b36] ring-2 ring-orange-500'
                        : 'bg-[#1b3a6b] hover:bg-[#152e55]'
                    }`}
                  >
                    <div className="text-xs">00:00 - 06:00</div>
                    <div className="text-[10px] font-medium text-slate-300">Early Morning</div>
                  </button>

                  <button
                    type="button"
                    onClick={() => setFilterTime(filterTime === 'MORNING' ? 'ALL' : 'MORNING')}
                    className={`py-2 px-1 rounded text-white font-bold transition ${
                      filterTime === 'MORNING'
                        ? 'bg-[#0a1b36] ring-2 ring-orange-500'
                        : 'bg-[#1b3a6b] hover:bg-[#152e55]'
                    }`}
                  >
                    <div className="text-xs">06:00 - 12:00</div>
                    <div className="text-[10px] font-medium text-slate-300">Morning</div>
                  </button>

                  <button
                    type="button"
                    onClick={() => setFilterTime(filterTime === 'MIDDAY' ? 'ALL' : 'MIDDAY')}
                    className={`py-2 px-1 rounded text-white font-bold transition ${
                      filterTime === 'MIDDAY'
                        ? 'bg-[#0a1b36] ring-2 ring-orange-500'
                        : 'bg-[#1b3a6b] hover:bg-[#152e55]'
                    }`}
                  >
                    <div className="text-xs">12:00 - 18:00</div>
                    <div className="text-[10px] font-medium text-slate-300">Mid Day</div>
                  </button>

                  <button
                    type="button"
                    onClick={() => setFilterTime(filterTime === 'NIGHT' ? 'ALL' : 'NIGHT')}
                    className={`py-2 px-1 rounded text-white font-bold transition ${
                      filterTime === 'NIGHT'
                        ? 'bg-[#0a1b36] ring-2 ring-orange-500'
                        : 'bg-[#1b3a6b] hover:bg-[#152e55]'
                    }`}
                  >
                    <div className="text-xs">18:00 - 24:00</div>
                    <div className="text-[10px] font-medium text-slate-300">Night</div>
                  </button>
                </div>
              )}
            </div>
          </aside>

          {/* =====================================================================
              RIGHT SIDE: TRAIN CARDS LISTING
              ===================================================================== */}
          <main className="space-y-4">
            {/* Header Summary Strip matching Screenshot 2026-10-05 212852.png */}
            <div className="bg-white rounded border border-[#cbd5e1] p-3 shadow-sm">
              <div className="text-sm font-bold text-slate-800 pb-2 border-b border-slate-200">
                <span>{filteredTrains.length} Results for </span>
                <span className="font-extrabold uppercase">{fromName} ➔ {toName}</span>
                <span> | {dateFormatted} For Quota | {inputQuota}</span>
              </div>

              <div className="flex items-center justify-between pt-2.5">
                {/* Sort By Departure Button */}
                <button
                  type="button"
                  className="bg-[#1b3a6b] text-white px-3 py-1.5 rounded text-xs font-bold uppercase tracking-wider"
                >
                  Sort By | Departure
                </button>

                {/* Day Navigation Buttons */}
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={handlePrevDay}
                    disabled={date <= todayIST()}
                    className="border border-[#cbd5e1] bg-white hover:bg-slate-50 disabled:opacity-40 text-slate-800 px-3 py-1 rounded text-xs font-bold transition"
                  >
                    ‹ Previous Day
                  </button>
                  <button
                    type="button"
                    onClick={handleNextDay}
                    className="border border-[#cbd5e1] bg-white hover:bg-slate-50 text-slate-800 px-3 py-1 rounded text-xs font-bold transition"
                  >
                    Next Day ›
                  </button>
                </div>
              </div>
            </div>

            {/* Loading Indicator */}
            {loading && (
              <div className="bg-white rounded border border-[#cbd5e1] p-8 text-center text-slate-600 font-medium">
                <RotateCw className="w-6 h-6 animate-spin mx-auto text-[#1b3a6b] mb-2" />
                <span>Searching trains between {fromName} and {toName}…</span>
              </div>
            )}

            {/* Error Message */}
            {error && (
              <div className="bg-red-50 border border-red-200 rounded p-4 text-xs text-red-700">
                {error}
              </div>
            )}

            {/* No Trains Found */}
            {!loading && !error && filteredTrains.length === 0 && (
              <div className="bg-white rounded border border-[#cbd5e1] p-8 text-center text-slate-600">
                <p className="font-bold text-base text-slate-800 mb-1">No trains match your filters</p>
                <p className="text-xs text-slate-500">
                  Try clicking "Remove Filter" or selecting another travel date.
                </p>
              </div>
            )}

            {/* List of Train Cards matching Screenshot 2026-10-05 212852.png */}
            {!loading &&
              filteredTrains.map((train) => {
                const selectedCls = selectedClasses[train.number] || train.classes?.[0];

                return (
                  <article
                    key={train.number}
                    className="bg-white rounded border border-[#d4dde8] p-4 shadow-sm relative transition hover:shadow-md"
                  >
                    {/* Blue Accent Bar on Left edge */}
                    <div className="absolute left-0 top-0 bottom-0 w-1 bg-[#2563eb] rounded-l" />

                    {/* Row 1: Train Header */}
                    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-2.5">
                      <div className="flex items-center gap-2">
                        <span className="font-black text-base text-slate-900 uppercase tracking-wide">
                          {train.name} ({train.number})
                        </span>
                      </div>

                      <div className="flex items-center gap-4 text-xs">
                        <span className="text-slate-600 font-medium">
                          Runs On: <b className="tracking-widest text-slate-800">M T W T F S S</b>
                        </span>
                        <a
                          href="#schedule"
                          onClick={(e) => e.preventDefault()}
                          className="text-blue-600 hover:underline font-semibold"
                        >
                          Train Schedule
                        </a>
                      </div>
                    </div>

                    {/* Row 2: Timing Schedule */}
                    <div className="flex flex-wrap items-center justify-between gap-4 my-3 text-slate-800">
                      {/* Departure */}
                      <div className="flex items-baseline gap-2">
                        <span className="text-2xl font-black text-slate-900">{train.departure}</span>
                        <span className="text-xs font-semibold text-slate-600">
                          | {fromName} | {formatShortDate(train.boardingDate)}
                        </span>
                      </div>

                      {/* Duration Line */}
                      <div className="flex items-center gap-2 text-xs font-semibold text-slate-500">
                        <span className="w-12 h-px bg-slate-300" />
                        <span>{formatDuration(train.durationMinutes)}</span>
                        <span className="w-12 h-px bg-slate-300" />
                      </div>

                      {/* Arrival */}
                      <div className="flex items-baseline gap-2">
                        <span className="text-2xl font-black text-slate-900">{train.arrival}</span>
                        <span className="text-xs font-semibold text-slate-600">
                          | {toName} | {formatShortDate(train.arrivalDate)}
                        </span>
                      </div>
                    </div>

                    {/* Row 3: Horizontal Class Availability Cards */}
                    <div className="flex flex-wrap gap-2.5 my-3">
                      {Array.isArray(train.classes) &&
                        train.classes.map((cls) => {
                          const isSelected = selectedCls?.code === cls.code;

                          return (
                            <div
                              key={cls.code}
                              onClick={() =>
                                setSelectedClasses((prev) => ({
                                  ...prev,
                                  [train.number]: cls,
                                }))
                              }
                              className={`rounded border px-3 py-2 min-w-[130px] cursor-pointer transition select-none ${
                                isSelected
                                  ? 'border-[#1b3a6b] bg-[#eff6ff] ring-1 ring-[#1b3a6b]'
                                  : 'border-[#cbd5e1] bg-[#f8fafc] hover:bg-white hover:border-[#1b3a6b]'
                              }`}
                            >
                              <div className="text-xs font-extrabold text-slate-800">
                                {CLASS_FULL_NAMES[cls.code] || cls.code}
                              </div>
                              <div className="flex items-center justify-between mt-1 text-xs">
                                <span className="font-bold text-slate-900">
                                  ₹ {cls.fare}
                                </span>
                                <span className="font-extrabold text-emerald-700 text-[11px]">
                                  {cls.status === 'AVAILABLE' ? `AVL ${cls.available || 50}` : cls.status}
                                </span>
                              </div>
                            </div>
                          );
                        })}
                    </div>

                    {/* Row 4: NTES Notice & Book Now Actions */}
                    <div className="pt-2 border-t border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
                      <span className="text-slate-500 text-[11px]">
                        Please check <a href="#ntes" className="text-blue-600 font-semibold hover:underline">NTES website</a> or <a href="#ntesapp" className="text-blue-600 font-semibold hover:underline">NTES app</a> for actual time before boarding
                      </span>

                      <div className="flex items-center gap-2">
                        {/* Book Now Button */}
                        <button
                          type="button"
                          onClick={() => {
                            if (selectedCls) {
                              navigate('/book', {
                                state: { train, cls: selectedCls },
                              });
                            }
                          }}
                          className="px-5 py-2 bg-[#e8711c] hover:bg-[#d06012] text-white font-extrabold uppercase rounded shadow transition cursor-pointer text-xs"
                        >
                          Book Now
                        </button>

                        {/* Other Dates Button */}
                        <button
                          type="button"
                          onClick={() => {
                            // Cycle to next day
                            handleNextDay();
                          }}
                          className="px-4 py-2 bg-white border border-[#cbd5e1] hover:bg-slate-50 text-slate-700 font-bold uppercase rounded transition cursor-pointer text-xs"
                        >
                          OTHER DATES
                        </button>
                      </div>
                    </div>
                  </article>
                );
              })}
          </main>
        </div>
      </div>
    </div>
  );
}
