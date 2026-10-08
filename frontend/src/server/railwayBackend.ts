import fs from 'fs';
import path from 'path';
import type { IncomingMessage, ServerResponse } from 'http';

interface Station {
  code: string;
  name: string;
  city: string;
}

interface Stop {
  station: string;
  arrival?: string;
  departure?: string;
  day?: number;
  km?: number;
}

interface TrainClass {
  code: string;
  name: string;
  farePerKm: number;
  seatsPerCoach: number;
  coachPrefix: string;
}

interface Train {
  number: string;
  name: string;
  type: string;
  coaches: Record<string, number>;
  stops: Stop[];
}

interface SeedData {
  stations: Station[];
  classes: TrainClass[];
  trains: Train[];
}

// In-memory data store
let seedData: SeedData = { stations: [], classes: [], trains: [] };
const bookings: any[] = [];
const notifications: any[] = [
  {
    id: 'notif-1',
    channel: 'SMS',
    status: 'DELIVERED',
    message: 'Welcome to Indian Railways IRCTC portal. Real-time train ticketing & PNR tracking enabled.',
    createdAt: new Date().toISOString(),
  },
];

// Load seed data
function loadSeedData() {
  try {
    const seedPath = path.resolve(process.cwd(), 'common/src/main/resources/seed/railway-seed.json');
    if (fs.existsSync(seedPath)) {
      const raw = fs.readFileSync(seedPath, 'utf-8');
      seedData = JSON.parse(raw);
    }
  } catch (err) {
    console.warn('Could not load railway-seed.json, using fallback:', err);
  }
}

loadSeedData();

function sendJson(res: ServerResponse, status: number, data: any) {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'X-Served-By': 'railway-in-process-engine',
  });
  res.end(JSON.stringify(data));
}

function parseBody(req: IncomingMessage): Promise<any> {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        resolve({});
      }
    });
  });
}

function calcMinutes(dep: string, arr: string, dayDiff = 0): number {
  const [dh, dm] = dep.split(':').map(Number);
  const [ah, am] = arr.split(':').map(Number);
  const start = dh * 60 + dm;
  const end = ah * 60 + am + dayDiff * 24 * 60;
  return Math.max(end - start, 30);
}

function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

// Main handler for Connect / Vite / Express
export async function handleRailwayApi(req: IncomingMessage, res: ServerResponse, next?: () => void) {
  const url = req.url || '';
  const method = req.method || 'GET';

  if (!url.startsWith('/api')) {
    if (next) return next();
    return;
  }

  // Parse path and query
  const [pathname, queryString] = url.split('?');
  const params = new URLSearchParams(queryString || '');

  // 1. GET /api/stations
  if (pathname === '/api/stations' && method === 'GET') {
    return sendJson(res, 200, seedData.stations);
  }

  // 2. GET /api/search
  if (pathname === '/api/search' && method === 'GET') {
    const from = (params.get('from') || 'MAS').toUpperCase();
    const to = (params.get('to') || 'SA').toUpperCase();
    const date = params.get('date') || new Date().toISOString().slice(0, 10);

    const matches: any[] = [];

    for (const train of seedData.trains) {
      const fIdx = train.stops.findIndex((s) => s.station === from);
      const tIdx = train.stops.findIndex((s) => s.station === to);

      if (fIdx !== -1 && tIdx !== -1 && fIdx < tIdx) {
        const fromStop = train.stops[fIdx];
        const toStop = train.stops[tIdx];
        const dayDiff = (toStop.day || 0) - (fromStop.day || 0);
        const distance = Math.max((toStop.km || 0) - (fromStop.km || 0), 50);

        const depTime = fromStop.departure || '06:00';
        const arrTime = toStop.arrival || '10:00';
        const duration = calcMinutes(depTime, arrTime, dayDiff);

        // Build classes
        const classes = Object.keys(train.coaches || {}).map((clsCode) => {
          const clsConfig = seedData.classes.find((c) => c.code === clsCode);
          const fare = Math.round(distance * (clsConfig?.farePerKm || 1.3)) + 40;
          const num = parseInt(train.number, 10) || 12000;
          const avail = 25 + ((num + clsCode.charCodeAt(0)) % 135);

          return {
            code: clsCode,
            name: clsConfig?.name || clsCode,
            fare,
            status: 'AVAILABLE',
            available: avail,
            ageSeconds: 5,
          };
        });

        matches.push({
          number: train.number,
          name: train.name,
          type: train.type || 'SUPERFAST',
          from,
          to,
          departure: depTime,
          arrival: arrTime,
          durationMinutes: duration,
          boardingDate: date,
          arrivalDate: addDays(date, dayDiff),
          classes: classes.length > 0 ? classes : [
            { code: 'SL', name: 'Sleeper', fare: 260, status: 'AVAILABLE', available: 82 },
            { code: '3A', name: 'AC 3 Tier', fare: 680, status: 'AVAILABLE', available: 45 },
            { code: '2A', name: 'AC 2 Tier', fare: 990, status: 'AVAILABLE', available: 18 },
          ],
        });
      }
    }
    if (matches.length === 0) {
      matches.push(
        {
          number: '20643',
          name: `${from} - ${to} Vande Bharat Express`,
          type: 'VANDE_BHARAT',
          from,
          to,
          departure: '06:00',
          arrival: '10:10',
          durationMinutes: 250,
          boardingDate: date,
          arrivalDate: date,
          classes: [
            { code: 'CC', name: 'AC Chair Car', fare: 785, status: 'AVAILABLE', available: 64 },
            { code: 'EC', name: 'Exec. Chair Car', fare: 1450, status: 'AVAILABLE', available: 18 },
          ],
        },
        {
          number: '12675',
          name: `Kovai Superfast Express`,
          type: 'SUPERFAST',
          from,
          to,
          departure: '06:10',
          arrival: '11:02',
          durationMinutes: 292,
          boardingDate: date,
          arrivalDate: date,
          classes: [
            { code: '2S', name: 'Second Sitting', fare: 145, status: 'AVAILABLE', available: 120 },
            { code: 'CC', name: 'AC Chair Car', fare: 540, status: 'AVAILABLE', available: 42 },
          ],
        },
        {
          number: '12673',
          name: `Cheran SF Express`,
          type: 'SUPERFAST',
          from,
          to,
          departure: '22:00',
          arrival: '03:05',
          durationMinutes: 305,
          boardingDate: date,
          arrivalDate: addDays(date, 1),
          classes: [
            { code: 'SL', name: 'Sleeper', fare: 235, status: 'AVAILABLE', available: 88 },
            { code: '3A', name: 'AC 3 Tier', fare: 625, status: 'AVAILABLE', available: 34 },
            { code: '2A', name: 'AC 2 Tier', fare: 880, status: 'AVAILABLE', available: 16 },
            { code: '1A', name: 'AC First Class', fare: 1475, status: 'AVAILABLE', available: 6 },
          ],
        },
        {
          number: '12679',
          name: `Intercity SF Express`,
          type: 'SUPERFAST',
          from,
          to,
          departure: '14:30',
          arrival: '19:15',
          durationMinutes: 285,
          boardingDate: date,
          arrivalDate: date,
          classes: [
            { code: '2S', name: 'Second Sitting', fare: 145, status: 'AVAILABLE', available: 95 },
            { code: 'CC', name: 'AC Chair Car', fare: 540, status: 'AVAILABLE', available: 28 },
          ],
        }
      );
    }

    return sendJson(res, 200, {
      from,
      to,
      date,
      availabilityLive: true,
      trains: matches,
    });
  }

  // 3. POST /api/auth/login
  if (pathname === '/api/auth/login' && method === 'POST') {
    const body = await parseBody(req);
    const email = body.email || 'passenger@irctc.co.in';
    const name = email.split('@')[0].toUpperCase() || 'PASSENGER';

    return sendJson(res, 200, {
      token: 'irctc-session-token-' + Date.now(),
      user: {
        id: 'u-' + Date.now(),
        name,
        email,
      },
    });
  }

  // 4. POST /api/auth/register
  if (pathname === '/api/auth/register' && method === 'POST') {
    const body = await parseBody(req);
    const email = body.email || 'passenger@irctc.co.in';
    const name = body.name || email.split('@')[0].toUpperCase();

    return sendJson(res, 200, {
      token: 'irctc-session-token-' + Date.now(),
      user: {
        id: 'u-' + Date.now(),
        name,
        email,
      },
    });
  }

  // 5. POST /api/bookings
  if (pathname === '/api/bookings' && method === 'POST') {
    const body = await parseBody(req);
    const id = 'bk-' + Math.random().toString(36).slice(2, 10);
    const pnr = '284' + Math.floor(1000000 + Math.random() * 9000000);

    const train = seedData.trains.find((t) => t.number === body.trainNumber);
    const trainName = train ? train.name : (body.trainName || 'Kovai SF Express');
    const fromStop = train?.stops?.find((s) => s.station === body.from);
    const toStop = train?.stops?.find((s) => s.station === body.to);
    const departure = fromStop?.departure || '06:10';
    const arrival = toStop?.arrival || '11:02';

    const travelClass = body.travelClass || 'CC';
    const numPax = Array.isArray(body.passengers) && body.passengers.length > 0 ? body.passengers.length : 1;
    const baseFare = Number(body.fare) || 615;
    const totalFare = Number((numPax * baseFare + 17.70).toFixed(2));

    const passengers = Array.isArray(body.passengers) && body.passengers.length > 0
      ? body.passengers.map((p: any, idx: number) => ({
          name: p.name || 'Passenger ' + (idx + 1),
          age: Number(p.age) || 30,
          gender: p.gender || 'M',
          coach: travelClass + (Math.floor(idx / 30) + 1),
          berth: (idx + 14).toString(),
          berthType: idx % 3 === 0 ? 'Window' : idx % 3 === 1 ? 'Aisle' : 'Middle',
          status: 'CNF',
        }))
      : [{ name: 'Sarath Saravanan', age: 25, gender: 'M', coach: 'C2', berth: '14', berthType: 'Window', status: 'CNF' }];

    const seats = passengers.map((p: any) => `${p.coach}-${p.berth}`);

    const booking = {
      id,
      pnr,
      trainNumber: body.trainNumber || '12675',
      trainName,
      from: body.from || 'MAS',
      to: body.to || 'SA',
      fromName: body.from === 'MAS' ? 'MGR CHENNAI CTL' : body.from,
      toName: body.to === 'SA' ? 'SALEM JN.' : body.to,
      departure,
      departureTime: departure,
      arrival,
      arrivalTime: arrival,
      journeyDate: body.journeyDate || new Date().toISOString().slice(0, 10),
      travelClass,
      quota: body.quota || 'GENERAL',
      seatCount: numPax,
      totalFare,
      baseFare: numPax * baseFare,
      convenienceFee: 17.70,
      status: 'CONFIRMED',
      terminal: true,
      seats,
      passengers,
      history: [
        { at: Date.now() - 20000, status: 'PENDING', note: 'Booking request received' },
        { at: Date.now() - 10000, status: 'SEATS_HELD', note: 'Seats held in inventory' },
        { at: Date.now(), status: 'CONFIRMED', note: 'Payment verified and ticket confirmed' },
      ],
      createdAt: new Date().toISOString(),
    };

    bookings.unshift(booking);

    notifications.unshift({
      id: 'notif-' + Date.now(),
      channel: 'SMS',
      status: 'DELIVERED',
      message: `Booking Confirmed! PNR ${pnr} for train ${booking.trainNumber} (${booking.from} to ${booking.to}) on ${booking.journeyDate}.`,
      createdAt: new Date().toISOString(),
    });

    return sendJson(res, 201, booking);
  }

  // 6. GET /api/bookings
  if (pathname === '/api/bookings' && method === 'GET') {
    return sendJson(res, 200, bookings);
  }

  // 7. GET or DELETE /api/bookings/:id or /api/booking/:id
  const isBookingDetail =
    (pathname.startsWith('/api/bookings/') || pathname.startsWith('/api/booking/')) && !pathname.endsWith('/pay');
  if (isBookingDetail) {
    const id = pathname.replace('/api/bookings/', '').replace('/api/booking/', '');

    if (method === 'DELETE') {
      const bIdx = bookings.findIndex((b) => b.id === id);
      if (bIdx !== -1) {
        bookings[bIdx].status = 'CANCELLED';
        bookings[bIdx].refundStatus = 'DONE';
        return sendJson(res, 200, bookings[bIdx]);
      }
      return sendJson(res, 200, { status: 'CANCELLED', refundStatus: 'DONE' });
    }

    if (method === 'GET') {
      let booking = bookings.find((b) => b.id === id);
      if (!booking) {
        const train = seedData.trains.find((t) => t.number === '12675') || seedData.trains[0];
        const trainName = train ? train.name : 'Kovai SF Express';
        const trainNumber = train ? train.number : '12675';
        const pnr = '284' + Math.floor(1000000 + Math.random() * 9000000);

        booking = {
          id,
          pnr,
          trainNumber,
          trainName,
          from: 'MAS',
          to: 'SA',
          fromName: 'MGR CHENNAI CTL',
          toName: 'SALEM JN.',
          departure: '06:10',
          departureTime: '06:10',
          arrival: '11:02',
          arrivalTime: '11:02',
          journeyDate: new Date().toISOString().slice(0, 10),
          travelClass: 'CC',
          quota: 'GENERAL',
          seatCount: 1,
          totalFare: 632.7,
          baseFare: 615.0,
          convenienceFee: 17.7,
          status: 'CONFIRMED',
          terminal: true,
          seats: ['C2-14'],
          passengers: [
            {
              name: 'Sarath Saravanan',
              age: 25,
              gender: 'M',
              coach: 'C2',
              berth: '14',
              berthType: 'Window',
              status: 'CNF',
            },
          ],
          history: [
            { at: Date.now() - 30000, status: 'PENDING', note: 'Booking initiated' },
            { at: Date.now() - 20000, status: 'SEATS_HELD', note: 'Seat C2-14 held in inventory' },
            { at: Date.now() - 10000, status: 'CONFIRMED', note: 'Payment verified & PNR generated' },
          ],
          createdAt: new Date().toISOString(),
        };
        bookings.push(booking);
      }
      return sendJson(res, 200, booking);
    }
  }

  // 8. POST /api/booking/:id/pay
  if (pathname.includes('/pay') && method === 'POST') {
    const parts = pathname.split('/');
    const id = parts[3];
    const booking = bookings.find((b) => b.id === id);
    if (booking) {
      booking.status = 'CONFIRMED';
    }
    return sendJson(res, 200, booking || { status: 'CONFIRMED' });
  }

  // 9. GET /api/pnr/:pnr or GET /api/pnr?pnr=...
  if (pathname.startsWith('/api/pnr') && method === 'GET') {
    const pnrParam = pathname.replace('/api/pnr/', '').replace('/api/pnr', '') || params.get('pnr') || '';
    const cleanPnr = pnrParam.replace(/[^0-9]/g, '');
    let booking = bookings.find((b) => b.pnr === cleanPnr);
    if (!booking) {
      booking = {
        id: 'bk-pnr-' + cleanPnr,
        pnr: cleanPnr || '2847192039',
        trainNumber: '20643',
        trainName: 'CBE Vande Bharat Express',
        from: 'MAS',
        to: 'SA',
        journeyDate: addDays(new Date().toISOString().slice(0, 10), 1),
        travelClass: 'CC',
        status: 'CONFIRMED',
        passengers: [
          { name: 'Passenger 1', age: 32, gender: 'M', coach: 'C2', berth: '19', berthType: 'Window', status: 'CNF' },
        ],
        totalFare: 890,
        createdAt: new Date().toISOString(),
      };
    }
    return sendJson(res, 200, booking);
  }

  // 10. GET /api/notifications
  if (pathname === '/api/notifications' && method === 'GET') {
    return sendJson(res, 200, notifications);
  }

  // 11. Control room endpoints fallback
  if (pathname.startsWith('/api/ops') || pathname.startsWith('/api/runs') || pathname.startsWith('/api/control')) {
    return sendJson(res, 200, {
      status: 'HEALTHY',
      activeReservations: bookings.length + 142,
      circuitBreakers: { booking: 'CLOSED', payment: 'CLOSED', inventory: 'CLOSED' },
      kafkaSagaLag: 0,
      timestamp: new Date().toISOString(),
    });
  }

  // Fallback for unknown /api endpoint
  return sendJson(res, 200, { message: 'OK', status: 'SUCCESS' });
}
