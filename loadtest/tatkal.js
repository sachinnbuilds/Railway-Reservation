// Tatkal rush: USERS people press "Book" on the same small train at the same moment, while
// BROWSE_RPS searches per second keep hitting the read path. Every user who gets seats pays.
//
//   scripts/loadtest.sh                         (defaults)
//   USERS=1000 BROWSE_RPS=300 scripts/loadtest.sh
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Counter, Trend } from 'k6/metrics';
import exec from 'k6/execution';

const BASE = __ENV.BASE || 'http://api-gateway:8080';
const USERS = Number(__ENV.USERS || 500);
const BROWSE_RPS = Number(__ENV.BROWSE_RPS || 100);
const TRAIN = __ENV.TRAIN || '22222';
const CLASS = __ENV.CLASS || 'SL';
const DATE = __ENV.DATE; // train start date, yyyy-mm-dd (required)
const RUN = __ENV.RUN_TAG || `${Date.now()}`;

const accepted = new Counter('book_accepted');
const soldOut = new Counter('book_sold_out_fast');
const rateLimited = new Counter('book_rate_limited');
const bookErrors = new Counter('book_errors');
const confirmed = new Counter('saga_confirmed');
const rejected = new Counter('saga_rejected');
const otherFinal = new Counter('saga_other_final');
const ackTime = new Trend('book_ack_ms', true);
const toFinal = new Trend('time_to_final_state_ms', true);
const searchTime = new Trend('search_ms', true);
const searches = new Counter('searches');

export const options = {
  setupTimeout: '300s',
  scenarios: {
    browse: {
      executor: 'constant-arrival-rate',
      exec: 'browse',
      rate: BROWSE_RPS,
      timeUnit: '1s',
      duration: '50s',
      preAllocatedVUs: 50,
      maxVUs: 200,
    },
    tatkal: {
      // Every VU fires exactly one booking, all at the same instant 10s into the run.
      executor: 'per-vu-iterations',
      exec: 'tatkal',
      vus: USERS,
      iterations: 1,
      startTime: '10s',
      maxDuration: '120s',
    },
  },
  thresholds: {
    book_errors: ['count==0'],               // no 5xx / timeouts: only clean accept or reject
    book_ack_ms: ['p(95)<2000'],
    'search_ms': ['p(95)<500'],
  },
};

const json = { headers: { 'Content-Type': 'application/json' } };

export function setup() {
  if (!DATE) throw new Error('DATE env var (train start date) is required');
  const tokens = [];
  for (let start = 0; start < USERS; start += 50) {
    const reqs = [];
    for (let i = start; i < Math.min(USERS, start + 50); i++) {
      reqs.push(['POST', `${BASE}/api/auth/register`,
        JSON.stringify({ name: `Load ${i}`, email: `load-${RUN}-${i}@k6.test`, password: 'k6-password' }), json]);
    }
    for (const r of http.batch(reqs)) {
      tokens.push(r.json('token'));
    }
  }
  return { tokens };
}

export function browse(data) {
  const token = data.tokens[Math.floor(Math.random() * data.tokens.length)];
  const routes = [['NDLS', 'BPL'], ['NDLS', 'MAS'], ['MMCT', 'NDLS'], ['NDLS', 'SC'], ['HWH', 'NDLS'], ['NDLS', 'MMCT']];
  const [from, to] = routes[Math.floor(Math.random() * routes.length)];
  const r = http.get(`${BASE}/api/search?from=${from}&to=${to}&date=${DATE}`,
    { headers: { Authorization: `Bearer ${token}` }, tags: { endpoint: 'search' } });
  searchTime.add(r.timings.duration);
  searches.add(1);
  check(r, { 'search 200': (x) => x.status === 200 });
}

export function tatkal(data) {
  const me = exec.scenario.iterationInTest; // 0..USERS-1, unique per tatkal user
  const token = data.tokens[me % data.tokens.length];
  const auth = { headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`,
    'Idempotency-Key': `${RUN}-${me}` }, tags: { endpoint: 'book' } };
  const t0 = Date.now();
  const r = http.post(`${BASE}/api/bookings`, JSON.stringify({
    trainNumber: TRAIN, journeyDate: DATE, from: 'NDLS', to: 'MMCT', travelClass: CLASS,
    passengers: [{ name: 'Tatkal Passenger', age: 30, gender: 'M' }],
  }), auth);
  ackTime.add(r.timings.duration);

  if (r.status === 409) { soldOut.add(1); return; }
  if (r.status === 429) { rateLimited.add(1); return; }
  if (r.status !== 202 && r.status !== 200) { bookErrors.add(1); return; }
  accepted.add(1);

  const id = r.json('id');
  const get = { headers: { Authorization: `Bearer ${token}` }, tags: { endpoint: 'status' } };
  let paid = false;
  for (let i = 0; i < 200; i++) {
    const s = http.get(`${BASE}/api/bookings/${id}`, get);
    if (s.status !== 200) { sleep(0.5); continue; }
    const st = s.json('status');
    if (st === 'SEATS_HELD' && !paid) {
      const p = http.post(`${BASE}/api/bookings/${id}/pay`, null,
        { headers: { Authorization: `Bearer ${token}` }, tags: { endpoint: 'pay' } });
      paid = p.status === 200;
    } else if (s.json('terminal')) {
      toFinal.add(Date.now() - t0);
      if (st === 'CONFIRMED') confirmed.add(1);
      else if (st === 'REJECTED') rejected.add(1);
      else otherFinal.add(1);
      return;
    }
    sleep(0.5);
  }
}

export function handleSummary(data) {
  const v = (name, stat = 'count') => (data.metrics[name] ? data.metrics[name].values[stat] : 0);
  const lines = [
    '',
    '================ TATKAL RUSH SUMMARY ================',
    `users pressing "book" at once : ${USERS}   (train ${TRAIN} ${CLASS} on ${DATE})`,
    `accepted into queue (202)     : ${v('book_accepted')}`,
    `sold out instantly (Redis)    : ${v('book_sold_out_fast')}`,
    `rate limited (429)            : ${v('book_rate_limited')}`,
    `errors (5xx/timeouts)         : ${v('book_errors')}`,
    `booking ack p50 / p95 / max   : ${Math.round(v('book_ack_ms', 'med'))} / ${Math.round(v('book_ack_ms', 'p(95)'))} / ${Math.round(v('book_ack_ms', 'max'))} ms`,
    `saga final: confirmed         : ${v('saga_confirmed')}`,
    `saga final: rejected (no seat): ${v('saga_rejected')}`,
    `saga final: other             : ${v('saga_other_final')}`,
    `time to final state p50 / p95 : ${Math.round(v('time_to_final_state_ms', 'med'))} / ${Math.round(v('time_to_final_state_ms', 'p(95)'))} ms`,
    `search during spike p50 / p95 : ${Math.round(v('search_ms', 'med'))} / ${Math.round(v('search_ms', 'p(95)'))} ms  (${v('searches')} searches)`,
    '=====================================================',
    '',
  ];
  return { stdout: lines.join('\n') };
}
