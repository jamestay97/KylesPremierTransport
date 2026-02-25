var path = require('path');
var fs = require('fs');
var express = require('express');
var session = require('express-session');

var app = express();
var PORT = process.env.PORT || 3000;

var RESEND_API_KEY = process.env.RESEND_API_KEY;
var NOTIFY_EMAIL = process.env.NOTIFY_EMAIL;
var TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID;
var TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN;
var TWILIO_PHONE_NUMBER = process.env.TWILIO_PHONE_NUMBER;
var NOTIFY_PHONE = process.env.NOTIFY_PHONE;

var CONFIG_PATH = path.join(__dirname, 'data', 'config.json');
var BOOKINGS_PATH = path.join(__dirname, 'data', 'bookings.json');
var ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@premiertransport.services';
var ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'changeme';

function readBookings() {
  try {
    var data = fs.readFileSync(BOOKINGS_PATH, 'utf8');
    var list = JSON.parse(data);
    return Array.isArray(list) ? list : [];
  } catch (e) {
    return [];
  }
}

function writeBookings(bookings) {
  try {
    var dir = path.dirname(BOOKINGS_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(BOOKINGS_PATH, JSON.stringify(bookings, null, 2), 'utf8');
  } catch (e) {
    console.warn('Could not write bookings:', e.message);
  }
}

function readConfig() {
  try {
    var data = fs.readFileSync(CONFIG_PATH, 'utf8');
    var c = JSON.parse(data);
    if (!c.addons || !Array.isArray(c.addons)) {
      c.addons = [{ id: 'car_seat', label: 'Car seat or booster', price: c.carSeatFee || 10, enabled: true }];
    }
    if (c.overnightSurchargeStart === undefined) c.overnightSurchargeStart = '22:00';
    if (c.overnightSurchargeEnd === undefined) c.overnightSurchargeEnd = '06:00';
    if (!Array.isArray(c.reviews)) c.reviews = [];
    if (!Array.isArray(c.notificationEmails)) c.notificationEmails = [];
    if (c.roundTripPromo === undefined) c.roundTripPromo = 'Round trips as low as $100';
    if (c.shuttlesMessage === undefined) c.shuttlesMessage = 'Shuttles available anytime!';
    return c;
  } catch (e) {
    return {
      overnightSurcharge: 10,
      overnightSurchargeStart: '22:00',
      overnightSurchargeEnd: '06:00',
      carSeatFee: 10,
      roundTripPromo: 'Round trips as low as $100',
      shuttlesMessage: 'Shuttles available anytime!',
      addons: [{ id: 'car_seat', label: 'Car seat or booster', price: 10, enabled: true }],
      notificationEmails: [],
      destinations: [],
      routes: []
    };
  }
}

function writeConfig(config) {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf8');
  var jsPath = path.join(__dirname, 'js', 'destinations-config.js');
  var publicConfig = Object.assign({}, config);
  delete publicConfig.notificationEmails;
  try {
    fs.writeFileSync(jsPath, 'window.PremierTransportConfig = ' + JSON.stringify(publicConfig) + ';\n', 'utf8');
  } catch (e) {
    console.warn('Could not write destinations-config.js:', e.message);
  }
}

function sendVerificationEmail(email, baseUrl) {
  if (!RESEND_API_KEY || !email || !baseUrl) return Promise.resolve();
  var verifyUrl = baseUrl.replace(/\/$/, '') + '/email-verified';
  var text = 'You were added to receive Premier Transport booking notifications.\n\nClick the link below to confirm this email is working:\n' + verifyUrl + '\n\nIf you didn\'t expect this, you can ignore this email.';
  return fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + RESEND_API_KEY
    },
    body: JSON.stringify({
      from: 'Premier Transport <onboarding@resend.dev>',
      to: [email],
      subject: 'Verify your Premier Transport booking notifications',
      text: text
    })
  }).then(function (res) {
    if (!res.ok) return Promise.reject(new Error('Resend failed: ' + res.status));
    return res;
  });
}

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session({
  secret: process.env.SESSION_SECRET || 'premier-transport-secret-change-in-production',
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false, httpOnly: true, maxAge: 24 * 60 * 60 * 1000 }
}));

// CORS: allow static site (and localhost) to POST to /api/bookings when using split hosting
var allowedOrigins = ['https://premiertransport.services', 'https://www.premiertransport.services'];
app.use(function (req, res, next) {
  var origin = req.headers.origin;
  if (origin && (allowedOrigins.indexOf(origin) !== -1 || /^http:\/\/localhost(:\d+)?$/.test(origin))) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

app.get('/api/config', function (req, res) {
  res.json(readConfig());
});

app.post('/api/login', function (req, res) {
  var email = (req.body.email || '').trim().toLowerCase();
  var password = req.body.password || '';
  if (email === ADMIN_EMAIL && password === ADMIN_PASSWORD) {
    req.session.admin = true;
    return res.json({ ok: true });
  }
  res.status(401).json({ ok: false, error: 'Invalid email or password' });
});

app.post('/api/logout', function (req, res) {
  req.session.destroy(function () {
    res.json({ ok: true });
  });
});

function requireAdmin(req, res, next) {
  if (req.session && req.session.admin) return next();
  res.status(401).json({ error: 'Login required' });
}

app.post('/api/config', requireAdmin, function (req, res) {
  var body = req.body;
  if (!body.destinations || !Array.isArray(body.destinations) || !body.routes || !Array.isArray(body.routes)) {
    return res.status(400).json({ error: 'destinations and routes required' });
  }
  var config = {
    overnightSurcharge: Number(body.overnightSurcharge) || 10,
    overnightSurchargeStart: body.overnightSurchargeStart || '22:00',
    overnightSurchargeEnd: body.overnightSurchargeEnd || '06:00',
    addons: Array.isArray(body.addons) ? body.addons : (body.addons ? [] : [{ id: 'car_seat', label: 'Car seat or booster', price: 10, enabled: true }]),
    googleReviewUrl: body.googleReviewUrl || '',
    googleMapsApiKey: body.googleMapsApiKey || '',
    reviews: Array.isArray(body.reviews) ? body.reviews : [],
    notificationEmails: Array.isArray(body.notificationEmails) ? body.notificationEmails.filter(function (e) { return typeof e === 'string' && e.trim(); }).map(function (e) { return e.trim().toLowerCase(); }) : [],
    roundTripPromo: typeof body.roundTripPromo === 'string' ? body.roundTripPromo : 'Round trips as low as $100',
    shuttlesMessage: typeof body.shuttlesMessage === 'string' ? body.shuttlesMessage : 'Shuttles available anytime!',
    destinations: body.destinations,
    routes: body.routes
  };
  var current = readConfig();
  var currentEmails = current.notificationEmails || [];
  var newEmails = (config.notificationEmails || []).filter(function (e) { return currentEmails.indexOf(e) === -1; });
  var seen = {};
  var baseUrl = (req.protocol || 'https') + '://' + (req.get('host') || '');
  newEmails.forEach(function (email) {
    if (email && !seen[email]) {
      seen[email] = true;
      sendVerificationEmail(email, baseUrl).catch(function (err) { console.warn('Verification email failed:', err.message); });
    }
  });
  writeConfig(config);
  res.json({ ok: true });
});

app.get('/api/me', function (req, res) {
  res.json({ loggedIn: !!(req.session && req.session.admin) });
});

function isPickupAtLeast24hFromNow(pickupDate, pickupTime) {
  if (!pickupDate || !pickupTime) return false;
  var dateStr = (pickupDate || '').trim();
  var timeStr = (pickupTime || '').trim();
  if (!dateStr || !timeStr) return false;
  var pickup = new Date(dateStr + 'T' + timeStr + ':00');
  if (isNaN(pickup.getTime())) return false;
  var min = new Date(Date.now() + 24 * 60 * 60 * 1000);
  return pickup.getTime() >= min.getTime();
}

function formatBookingSummary(r) {
  var parts = [(r.name || '—') + ' • ' + (r.phone || '—'), r.pickup_date + ' ' + (r.pickup_time || ''), (r.pickup_address || '').substring(0, 40) + (r.pickup_address && r.pickup_address.length > 40 ? '…' : ''), (r.dropoff_dest || r.dropoff_other_address || '—')];
  return parts.join(' | ');
}

function notifyNewBooking(record) {
  var summary = formatBookingSummary(record);
  var details = [
    'Name: ' + (record.name || '—'),
    'Phone: ' + (record.phone || '—'),
    'Email: ' + (record.email || '—'),
    'Pickup: ' + (record.pickup_address || '—'),
    'Drop-off: ' + (record.dropoff_dest || record.dropoff_other_address || '—'),
    'Date: ' + record.pickup_date + ' ' + (record.pickup_time || ''),
    'Passengers: ' + (record.passengers || 1),
    record.round_trip ? 'Round trip: ' + record.return_date + ' ' + (record.return_time || '') : '',
    record.special_requests ? 'Notes: ' + record.special_requests : ''
  ].filter(Boolean).join('\n');

  var config = readConfig();
  var toList = (config.notificationEmails && config.notificationEmails.length) ? config.notificationEmails : (NOTIFY_EMAIL ? NOTIFY_EMAIL.split(',').map(function (e) { return e.trim(); }).filter(Boolean) : []);
  if (RESEND_API_KEY && toList.length) {
      fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + RESEND_API_KEY
        },
        body: JSON.stringify({
          from: 'Premier Transport <onboarding@resend.dev>',
          to: toList,
          subject: 'New booking: ' + (record.name || 'Booking') + ' – ' + record.pickup_date,
          text: details
        })
      }).catch(function (err) { console.warn('Resend email failed:', err.message); });
  }

  if (TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN && TWILIO_PHONE_NUMBER && NOTIFY_PHONE) {
    try {
      var twilio = require('twilio');
      var client = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);
      var smsBody = 'New booking: ' + summary.substring(0, 140);
      if (smsBody.length < summary.length) smsBody += '…';
      client.messages.create({
        from: TWILIO_PHONE_NUMBER,
        to: NOTIFY_PHONE,
        body: smsBody
      }).catch(function (err) { console.warn('Twilio SMS failed:', err.message); });
    } catch (e) {
      console.warn('Twilio SMS skipped:', e.message);
    }
  }
}

app.post('/api/bookings', function (req, res) {
  var body = req.body || {};
  if (!isPickupAtLeast24hFromNow(body.pickup_date, body.pickup_time)) {
    return res.status(400).json({
      error: 'Appointments made within 24 hours may not be confirmed. Call to confirm at (727) 999-4999.',
      code: 'PICKUP_TOO_SOON'
    });
  }
  var bookings = readBookings();
  var id = 'b' + Date.now() + '-' + Math.random().toString(36).slice(2, 9);
  var record = {
    id: id,
    createdAt: new Date().toISOString(),
    pickup_address: (body.pickup_address || '').trim(),
    dropoff_dest: (body.dropoff_dest || '').trim(),
    dropoff_other_address: (body.dropoff_other_address || '').trim(),
    pickup_date: (body.pickup_date || '').trim(),
    pickup_time: (body.pickup_time || '').trim(),
    round_trip: !!body.round_trip,
    return_date: (body.return_date || '').trim(),
    return_time: (body.return_time || '').trim(),
    return_dropoff_address: (body.return_dropoff_address || '').trim(),
    passengers: parseInt(body.passengers, 10) || 1,
    airline: (body.airline || '').trim(),
    flight_number: (body.flight_number || '').trim(),
    name: (body.name || '').trim(),
    phone: (body.phone || '').trim(),
    email: (body.email || '').trim().toLowerCase(),
    special_requests: (body.special_requests || '').trim(),
    addon_car_seat: !!body.addon_car_seat
  };
  bookings.push(record);
  writeBookings(bookings);
  notifyNewBooking(record);
  res.status(201).json({ ok: true, id: id });
});

app.get('/api/bookings', requireAdmin, function (req, res) {
  res.json(readBookings());
});

app.get('/email-verified', function (req, res) {
  res.type('html').send('<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Email verified</title></head><body style="font-family:sans-serif;max-width:480px;margin:2rem auto;padding:0 1rem;"><h1 style="color:#0d3b5c;">You\'re all set</h1><p>This email address is set up to receive Premier Transport booking notifications.</p></body></html>');
});

app.post('/api/verify-notification-email', requireAdmin, function (req, res) {
  var email = (req.body && req.body.email) ? req.body.email.trim().toLowerCase() : '';
  if (!email) return res.status(400).json({ error: 'Email is required.' });
  var config = readConfig();
  var list = config.notificationEmails || [];
  if (list.indexOf(email) === -1) return res.status(400).json({ error: 'Email not in notification list. Save the config first.' });
  var baseUrl = (req.protocol || 'https') + '://' + (req.get('host') || '');
  sendVerificationEmail(email, baseUrl).then(function () {
    res.json({ ok: true });
  }).catch(function (err) {
    console.warn('Verify notification email failed:', err.message);
    res.status(500).json({ error: 'Failed to send verification email.' });
  });
});

app.use(express.static(__dirname, { index: false }));

app.get('/', function (req, res) {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/admin', function (req, res) {
  res.sendFile(path.join(__dirname, 'admin.html'));
});

app.get('/book.html', function (req, res) {
  res.sendFile(path.join(__dirname, 'book.html'));
});

app.listen(PORT, function () {
  console.log('Premier Transport server at http://localhost:' + PORT);
  console.log('Admin: http://localhost:' + PORT + '/admin');
  console.log('Set ADMIN_EMAIL and ADMIN_PASSWORD in environment to secure login.');
});
