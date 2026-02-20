var path = require('path');
var fs = require('fs');
var express = require('express');
var session = require('express-session');

var app = express();
var PORT = process.env.PORT || 3000;

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
      destinations: [],
      routes: []
    };
  }
}

function writeConfig(config) {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf8');
  var jsPath = path.join(__dirname, 'js', 'destinations-config.js');
  var js = 'window.PremierTransportConfig = ' + JSON.stringify(config) + ';\n';
  try {
    fs.writeFileSync(jsPath, 'window.PremierTransportConfig = ' + JSON.stringify(config) + ';\n', 'utf8');
  } catch (e) {
    console.warn('Could not write destinations-config.js:', e.message);
  }
}

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session({
  secret: process.env.SESSION_SECRET || 'premier-transport-secret-change-in-production',
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false, httpOnly: true, maxAge: 24 * 60 * 60 * 1000 }
}));

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
    roundTripPromo: typeof body.roundTripPromo === 'string' ? body.roundTripPromo : 'Round trips as low as $100',
    shuttlesMessage: typeof body.shuttlesMessage === 'string' ? body.shuttlesMessage : 'Shuttles available anytime!',
    destinations: body.destinations,
    routes: body.routes
  };
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
  res.status(201).json({ ok: true, id: id });
});

app.get('/api/bookings', requireAdmin, function (req, res) {
  res.json(readBookings());
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
