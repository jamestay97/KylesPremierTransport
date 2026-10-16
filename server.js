var path = require('path');
var fs = require('fs');

// Local development: load DATABASE_URL etc. from .env.local / .env (written by `neon env pull`).
// On Render, set these as environment variables instead.
['.env.local', '.env'].forEach(function (f) {
  var p = path.join(__dirname, f);
  if (fs.existsSync(p) && typeof process.loadEnvFile === 'function') process.loadEnvFile(p);
});
var https = require('https');
var express = require('express');
var session = require('express-session');

var app = express();
var PORT = process.env.PORT || 3000;

var RESEND_API_KEY = process.env.RESEND_API_KEY;
var RESEND_FROM = (process.env.RESEND_FROM_EMAIL && process.env.RESEND_FROM_EMAIL.trim())
  ? (process.env.RESEND_FROM_EMAIL.trim().indexOf('<') !== -1 ? process.env.RESEND_FROM_EMAIL.trim() : 'Premier Transport <' + process.env.RESEND_FROM_EMAIL.trim() + '>')
  : 'Premier Transport <onboarding@resend.dev>';
var NOTIFY_EMAIL = process.env.NOTIFY_EMAIL;
var TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID;
var TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN;
var TWILIO_PHONE_NUMBER = process.env.TWILIO_PHONE_NUMBER;
var NOTIFY_PHONE = process.env.NOTIFY_PHONE;

var storage = require('./storage');
var ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@premiertransport.services';
var ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'changeme';

// Settings are loaded from storage once at startup and kept in memory;
// every save goes to storage (the database when DATABASE_URL is set).
var configCache = null;

function readConfig() {
  try {
    if (!configCache) throw new Error('no config');
    var c = JSON.parse(JSON.stringify(configCache));
    if (!c.addons || !Array.isArray(c.addons)) {
      c.addons = [{ id: 'car_seat', label: 'Car seat or booster', price: c.carSeatFee || 10, enabled: true }];
    }
    if (c.overnightSurchargeStart === undefined) c.overnightSurchargeStart = '22:00';
    if (c.overnightSurchargeEnd === undefined) c.overnightSurchargeEnd = '06:00';
    if (!Array.isArray(c.reviews)) c.reviews = [];
    if (!Array.isArray(c.notificationEmails)) c.notificationEmails = [];
    if (!Array.isArray(c.verifiedNotificationEmails)) c.verifiedNotificationEmails = [];
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
      verifiedNotificationEmails: [],
      destinations: [],
      routes: []
    };
  }
}

function publicConfigScript(config) {
  var publicConfig = Object.assign({}, config);
  delete publicConfig.notificationEmails;
  delete publicConfig.verifiedNotificationEmails;
  return 'window.PremierTransportConfig = ' + JSON.stringify(publicConfig) + ';\n';
}

function writeConfig(config) {
  configCache = config;
  // Keep the local JS copy in sync too (used when developing / static fallback).
  try {
    fs.writeFileSync(path.join(__dirname, 'js', 'destinations-config.js'), publicConfigScript(config), 'utf8');
  } catch (e) {
    console.warn('Could not write destinations-config.js:', e.message);
  }
  return storage.saveConfig(config);
}

function resendSendEmail(payload) {
  return new Promise(function (resolve, reject) {
    if (!RESEND_API_KEY) {
      reject(new Error('RESEND_API_KEY not set'));
      return;
    }
    var body = JSON.stringify(payload);
    var req = https.request({
      hostname: 'api.resend.com',
      path: '/emails',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + RESEND_API_KEY,
        'Content-Length': Buffer.byteLength(body, 'utf8')
      }
    }, function (res) {
      var chunks = [];
      res.on('data', function (chunk) { chunks.push(chunk); });
      res.on('end', function () {
        var raw = chunks.join('');
        var data = null;
        try { data = JSON.parse(raw); } catch (e) {}
        var ok = res.statusCode >= 200 && res.statusCode < 300;
        resolve({ ok: ok, status: res.statusCode, body: data });
      });
    });
    req.on('error', function (err) {
      reject(err);
    });
    req.write(body, 'utf8');
    req.end();
  });
}

function sendVerificationEmail(email, baseUrl) {
  if (!RESEND_API_KEY || !email || !baseUrl) {
    return Promise.reject(new Error('Email not configured. Set RESEND_API_KEY on the server.'));
  }
  var verifyUrl = baseUrl.replace(/\/$/, '') + '/email-verified?email=' + encodeURIComponent(email);
  var text = 'You were added to receive Premier Transport booking notifications.\n\nClick the link below to confirm this email is working:\n' + verifyUrl + '\n\nIf you didn\'t expect this, you can ignore this email.';
  return resendSendEmail({
    from: RESEND_FROM,
    to: [email],
    subject: 'Verify your Premier Transport booking notifications',
    text: text
  }).then(function (result) {
    if (!result.ok) {
      var msg = (result.body && result.body.message) ? result.body.message : ('Resend failed: ' + result.status);
      return Promise.reject(new Error(msg));
    }
    return result;
  });
}

app.use(express.json({ limit: '2mb' }));
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

app.get('/api/email-status', function (req, res) {
  res.json({ resendConfigured: !!RESEND_API_KEY, notifyConfigured: !!(NOTIFY_EMAIL && NOTIFY_EMAIL.trim()) });
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
  config.verifiedNotificationEmails = (current.verifiedNotificationEmails || []).filter(function (e) {
    return (config.notificationEmails || []).indexOf(e) !== -1;
  });
  var seen = {};
  var baseUrl = (req.protocol || 'https') + '://' + (req.get('host') || '');
  newEmails.forEach(function (email) {
    if (email && !seen[email]) {
      seen[email] = true;
      sendVerificationEmail(email, baseUrl).catch(function (err) { console.warn('Verification email failed:', err.message); });
    }
  });
  writeConfig(config).then(function () {
    res.json({ ok: true });
  }).catch(function (err) {
    console.error('Saving settings failed:', err.message);
    res.status(500).json({ error: 'Could not save settings. Please try again.' });
  });
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

function googleMapsUrl(address) {
  if (!address || !String(address).trim()) return null;
  return 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(String(address).trim());
}

function googleMapsDirectionsUrl(origin, destination) {
  if (!origin || !String(origin).trim() || !destination || !String(destination).trim()) return null;
  return 'https://www.google.com/maps/dir/?api=1&travelmode=driving&origin=' + encodeURIComponent(String(origin).trim()) + '&destination=' + encodeURIComponent(String(destination).trim());
}

function getDropoffAddressForRecord(record) {
  var other = (record.dropoff_other_address || '').trim();
  if (other) return other;
  var id = (record.dropoff_dest || '').trim();
  if (!id) return null;
  try {
    var config = readConfig();
    var dest = (config.destinations || []).find(function (d) { return d.id === id; });
    return (dest && dest.address) ? dest.address.trim() : id;
  } catch (e) { return id; }
}

function buildConfirmationEmailHtml(record) {
  var primary = '#0d3b5c';
  var accent = '#e8a735';
  var bg = '#f0f4f8';
  var cardBg = '#ffffff';
  var textColor = '#2c3e50';
  var muted = '#5a6c7d';
  var radius = '10px';
  var logoUrl = 'https://premiertransport.services/images/logo.png';
  var pickupAddr = (record.pickup_address || '').trim() || '—';
  var dropoffAddress = getDropoffAddressForRecord(record);
  var dropoffDisplay = (record.dropoff_other_address || '').trim() || dropoffAddress || (record.dropoff_dest || '—');
  var pickupMaps = googleMapsUrl(record.pickup_address);
  var dropoffMaps = googleMapsUrl(dropoffAddress || record.dropoff_dest);
  var routeUrl = googleMapsDirectionsUrl(record.pickup_address, dropoffAddress || record.dropoff_dest);
  var specialRequests = (record.special_requests || '').trim();
  var name = record.name || 'there';
  var dateTime = (record.pickup_date || '') + (record.pickup_time ? ' at ' + record.pickup_time : '');
  var passengers = record.passengers != null ? record.passengers : 1;
  var roundTrip = record.round_trip && (record.return_date || record.return_time);
  var returnDateTime = (record.return_date || '') + (record.return_time ? ' at ' + record.return_time : '');
  var hasCarSeat = !!record.addon_car_seat;
  var esc = function (s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); };
  var mapBtn = ' style="display:inline-block;background:' + accent + ';color:#1a1a1a;padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:600;font-size:14px;margin-top:8px;"';
  var pickupBlock = pickupMaps
    ? '<div style="font-size:16px;line-height:1.5;color:' + textColor + ';">' + esc(pickupAddr) + '</div><a href="' + esc(pickupMaps) + '"' + mapBtn + '>View on Google Maps</a>'
    : '<div style="font-size:16px;color:' + textColor + ';">' + esc(pickupAddr) + '</div>';
  var dropoffBlock = dropoffMaps
    ? '<div style="font-size:16px;line-height:1.5;color:' + textColor + ';">' + esc(dropoffDisplay) + '</div><a href="' + esc(dropoffMaps) + '"' + mapBtn + '>View on Google Maps</a>'
    : '<div style="font-size:16px;color:' + textColor + ';">' + esc(dropoffDisplay) + '</div>';
  var routeBlock = routeUrl
    ? '<p style="margin:16px 0 0;font-size:15px;"><a href="' + esc(routeUrl) + '"' + mapBtn + '>View full route (directions)</a></p>'
    : '';
  var fareBlock = '<table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:20px;background:#f8fafc;border-radius:' + radius + ';border:1px solid #e5e9ee;"><tr><td style="padding:18px 22px;"><span style="font-size:11px;text-transform:uppercase;letter-spacing:0.6px;color:' + muted + ';font-weight:600;">Fare</span><p style="margin:8px 0 0;font-size:15px;color:' + textColor + ';">We\'ll confirm your exact fare when we confirm your ride. Pricing is based on your route and any add-ons.</p>' + (hasCarSeat ? '<p style="margin:10px 0 0;font-size:14px;color:' + primary + ';"><strong>Car seat / booster requested</strong> (+$10)</p>' : '') + '</td></tr></table>';
  var notesBubble = specialRequests
    ? '<table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:24px;"><tr><td style="background:#fff9f0;border-left:4px solid ' + accent + ';padding:18px 20px;border-radius:' + radius + ';font-size:15px;line-height:1.6;color:' + textColor + ';"><strong style="color:' + primary + ';font-size:13px;text-transform:uppercase;letter-spacing:0.5px;">Special requests</strong><br><span style="margin-top:6px;display:block;">' + esc(specialRequests) + '</span></td></tr></table>'
    : '';
  return (
    '<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Booking confirmation</title></head>' +
    '<body style="margin:0;padding:0;font-family:\'Segoe UI\',Roboto,-apple-system,BlinkMacSystemFont,sans-serif;font-size:16px;line-height:1.6;color:' + textColor + ';background:' + bg + ';">' +
    '<table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:' + bg + ';"><tr><td style="padding:40px 20px;">' +
    '<table width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;margin:0 auto;background:' + cardBg + ';border-radius:14px;box-shadow:0 8px 32px rgba(13,59,92,0.12);overflow:hidden;">' +
    '<tr><td style="background:' + primary + ';color:#fff;padding:24px 28px;text-align:center;">' +
    '<img src="' + logoUrl + '" alt="Premier Transport" width="180" height="48" style="display:block;margin:0 auto;max-width:180px;height:auto;">' +
    '<div style="margin-top:10px;font-size:20px;font-weight:700;letter-spacing:-0.02em;">Premier Transport</div>' +
    '</td></tr>' +
    '<tr><td style="padding:32px 28px;">' +
    '<p style="margin:0 0 8px;font-size:19px;font-weight:600;color:' + primary + ';">Hi ' + esc(name) + ',</p>' +
    '<p style="margin:0 0 24px;font-size:16px;color:' + muted + ';">Your booking request is confirmed. Here’s your trip breakdown:</p>' +
    '<table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:8px;"><tr><td style="padding:0 0 12px;"><span style="font-size:12px;text-transform:uppercase;letter-spacing:0.6px;color:' + muted + ';font-weight:600;">Your trip</span></td></tr></table>' +
    '<table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:' + bg + ';border-radius:' + radius + ';margin-bottom:20px;border:1px solid #e5e9ee;">' +
    '<tr><td style="padding:20px 22px 12px;"><span style="font-size:11px;text-transform:uppercase;letter-spacing:0.6px;color:' + muted + ';font-weight:600;">Pickup</span></td></tr><tr><td style="padding:0 22px 20px;">' + pickupBlock + '</td></tr>' +
    '<tr><td style="padding:0 22px 12px;"><div style="border-left:2px dashed ' + muted + ';height:24px;margin-left:10px;opacity:0.6;"></div></td></tr>' +
    '<tr><td style="padding:0 22px 12px;"><span style="font-size:11px;text-transform:uppercase;letter-spacing:0.6px;color:' + muted + ';font-weight:600;">Drop-off</span></td></tr><tr><td style="padding:0 22px 20px;">' + dropoffBlock + '</td></tr>' +
    '</table>' + routeBlock +
    '<table width="100%" cellpadding="0" cellspacing="0" border="0" style="font-size:15px;">' +
    '<tr><td style="padding:14px 0;border-bottom:1px solid #e8ecf0;"><span style="color:' + muted + ';">Date & time</span></td><td style="padding:14px 0;border-bottom:1px solid #e8ecf0;text-align:right;font-weight:600;color:' + textColor + ';">' + esc(dateTime) + '</td></tr>' +
    '<tr><td style="padding:14px 0;border-bottom:1px solid #e8ecf0;"><span style="color:' + muted + ';">Passengers</span></td><td style="padding:14px 0;border-bottom:1px solid #e8ecf0;text-align:right;">' + esc(passengers) + '</td></tr>' +
    (roundTrip ? '<tr><td style="padding:14px 0;border-bottom:1px solid #e8ecf0;"><span style="color:' + muted + ';">Round trip return</span></td><td style="padding:14px 0;border-bottom:1px solid #e8ecf0;text-align:right;font-weight:600;">' + esc(returnDateTime) + '</td></tr>' : '') +
    '</table>' +
    fareBlock +
    notesBubble +
    '<table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:28px;"><tr><td style="padding-top:24px;border-top:1px solid #e8ecf0;font-size:15px;color:' + muted + ';">We\'ll confirm your ride by phone or email. Questions? Call or text <a href="tel:+17279994999" style="color:' + primary + ';text-decoration:underline;font-weight:600;">(727) 999-4999</a>.</td></tr><tr><td style="padding-top:16px;font-size:14px;color:' + muted + ';">— Premier Transport</td></tr></table>' +
    '</td></tr></table></td></tr></table></body></html>'
  );
}

function sendBookingConfirmationToCustomer(record) {
  try {
    var to = (record.email || '').trim().toLowerCase();
    if (!to || !RESEND_API_KEY) {
      return;
    }
    var lines = [
    'Hi ' + (record.name || 'there') + ',',
    '',
    'We received your booking request with Premier Transport. Here are your details:',
    '',
    'Pickup: ' + (record.pickup_address || '—'),
    'Drop-off: ' + (record.dropoff_dest || record.dropoff_other_address || '—'),
    'Date & time: ' + record.pickup_date + ' ' + (record.pickup_time || ''),
    'Passengers: ' + (record.passengers || 1)
  ];
  if (record.round_trip) {
    lines.push('Round trip return: ' + record.return_date + ' ' + (record.return_time || ''));
  }
  if (record.special_requests) {
    lines.push('');
    lines.push('Notes: ' + record.special_requests);
  }
  lines.push('');
  lines.push('We\'ll confirm your ride by phone or email. If you don\'t hear from us within 24 hours, call or text (727) 999-4999.');
  lines.push('');
  lines.push('— Premier Transport');
  var text = lines.join('\n');
  var html = null;
  try {
    html = buildConfirmationEmailHtml(record);
  } catch (err) {
    console.warn('Booking confirmation HTML build failed, sending text only:', err.message);
  }
  var payload = {
    from: RESEND_FROM,
    to: [to],
    subject: 'Booking request received – ' + record.pickup_date + ' ' + (record.pickup_time || ''),
    text: text
  };
  if (html) payload.html = html;
  console.log('[Email] Sending customer confirmation to', to);
  resendSendEmail(payload)
    .then(function (result) {
      if (!result.ok) {
        console.warn('[Email] Resend rejection:', result.status, result.body && result.body.message ? result.body.message : result.body);
        return;
      }
      console.log('[Email] Customer confirmation sent to', to);
    })
    .catch(function (err) {
      console.warn('[Email] Resend failed:', err.message);
    });
  } catch (err) {
    console.warn('sendBookingConfirmationToCustomer error:', err.message);
  }
}

function buildAdminNotificationEmailHtml(record) {
  var primary = '#0d3b5c';
  var accent = '#e8a735';
  var bg = '#f0f4f8';
  var cardBg = '#ffffff';
  var textColor = '#2c3e50';
  var muted = '#5a6c7d';
  var radius = '10px';
  var logoUrl = 'https://premiertransport.services/images/logo.png';
  var esc = function (s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); };
  var dropoffAddressAdmin = getDropoffAddressForRecord(record);
  var pickupAddr = (record.pickup_address || '').trim() || '—';
  var dropoffDisplay = (record.dropoff_other_address || '').trim() || dropoffAddressAdmin || (record.dropoff_dest || '—');
  var pickupMaps = googleMapsUrl(record.pickup_address);
  var dropoffMaps = googleMapsUrl(dropoffAddressAdmin || record.dropoff_dest);
  var routeUrl = googleMapsDirectionsUrl(record.pickup_address, dropoffAddressAdmin || record.dropoff_dest);
  var mapBtn = ' style="display:inline-block;background:' + accent + ';color:#1a1a1a;padding:8px 14px;border-radius:8px;text-decoration:none;font-weight:600;font-size:13px;margin-top:6px;"';
  var pickupBlock = pickupMaps ? '<div style="font-size:15px;color:' + textColor + ';">' + esc(pickupAddr) + '</div><a href="' + esc(pickupMaps) + '"' + mapBtn + '>View on Google Maps</a>' : '<div style="font-size:15px;color:' + textColor + ';">' + esc(pickupAddr) + '</div>';
  var dropoffBlock = dropoffMaps ? '<div style="font-size:15px;color:' + textColor + ';">' + esc(dropoffDisplay) + '</div><a href="' + esc(dropoffMaps) + '"' + mapBtn + '>View on Google Maps</a>' : '<div style="font-size:15px;color:' + textColor + ';">' + esc(dropoffDisplay) + '</div>';
  var routeBlock = routeUrl ? '<p style="margin:16px 0 0;font-size:15px;"><a href="' + esc(routeUrl) + '"' + mapBtn + '>View full route (directions)</a></p>' : '';
  var dateTime = (record.pickup_date || '') + (record.pickup_time ? ' at ' + record.pickup_time : '');
  var specialRequests = (record.special_requests || '').trim();
  var notesBubble = specialRequests
    ? '<table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:20px;"><tr><td style="background:#fff9f0;border-left:4px solid ' + accent + ';padding:18px 20px;border-radius:' + radius + ';font-size:15px;line-height:1.6;color:' + textColor + ';"><strong style="color:' + primary + ';font-size:13px;text-transform:uppercase;letter-spacing:0.5px;">Special requests</strong><br><span style="margin-top:6px;display:block;">' + esc(specialRequests) + '</span></td></tr></table>'
    : '';
  var addonNote = record.addon_car_seat ? '<tr><td style="padding:10px 0;border-bottom:1px solid #e8ecf0;color:' + muted + ';">Add-ons</td><td style="padding:10px 0;border-bottom:1px solid #e8ecf0;text-align:right;color:' + primary + ';">Car seat / booster (+$10)</td></tr>' : '';
  return (
    '<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>' +
    '<body style="margin:0;padding:0;font-family:\'Segoe UI\',Roboto,sans-serif;font-size:15px;line-height:1.5;color:' + textColor + ';background:' + bg + ';">' +
    '<table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:' + bg + ';"><tr><td style="padding:32px 20px;">' +
    '<table width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;margin:0 auto;background:' + cardBg + ';border-radius:14px;box-shadow:0 8px 32px rgba(13,59,92,0.12);overflow:hidden;">' +
    '<tr><td style="background:' + primary + ';color:#fff;padding:24px 28px;text-align:center;">' +
    '<img src="' + logoUrl + '" alt="Premier Transport" width="180" height="48" style="display:block;margin:0 auto;max-width:180px;height:auto;">' +
    '<div style="margin-top:10px;font-size:18px;font-weight:700;letter-spacing:-0.02em;">New booking</div>' +
    '</td></tr>' +
    '<tr><td style="padding:26px 28px;">' +
    '<p style="margin:0 0 20px;font-size:17px;font-weight:600;color:' + primary + ';">' + esc(record.name || 'Booking') + ' · ' + esc(record.pickup_date) + '</p>' +
    '<table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:8px;"><tr><td style="padding:0 0 12px;"><span style="font-size:12px;text-transform:uppercase;letter-spacing:0.6px;color:' + muted + ';font-weight:600;">Trip</span></td></tr></table>' +
    '<table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:' + bg + ';border-radius:' + radius + ';border:1px solid #e5e9ee;margin-bottom:20px;">' +
    '<tr><td style="padding:18px 22px 10px;"><span style="font-size:11px;text-transform:uppercase;letter-spacing:0.5px;color:' + muted + ';">Pickup</span></td></tr><tr><td style="padding:0 22px 18px;">' + pickupBlock + '</td></tr>' +
    '<tr><td style="padding:0 22px 10px;"><div style="border-left:2px dashed ' + muted + ';height:18px;margin-left:8px;opacity:0.6;"></div></td></tr>' +
    '<tr><td style="padding:0 22px 10px;"><span style="font-size:11px;text-transform:uppercase;letter-spacing:0.5px;color:' + muted + ';">Drop-off</span></td></tr><tr><td style="padding:0 22px 18px;">' + dropoffBlock + '</td></tr>' +
    '</table>' + routeBlock +
    '<table width="100%" cellpadding="0" cellspacing="0" border="0" style="font-size:14px;">' +
    '<tr><td style="padding:10px 0;border-bottom:1px solid #e8ecf0;color:' + muted + ';">Contact</td><td style="padding:10px 0;border-bottom:1px solid #e8ecf0;text-align:right;"><a href="tel:' + esc((record.phone || '').replace(/\D/g, '')) + '" style="color:' + primary + ';">' + esc(record.phone || '—') + '</a> · <a href="mailto:' + esc(record.email || '') + '" style="color:' + primary + ';">' + esc(record.email || '—') + '</a></td></tr>' +
    '<tr><td style="padding:10px 0;border-bottom:1px solid #e8ecf0;color:' + muted + ';">Date & time</td><td style="padding:10px 0;border-bottom:1px solid #e8ecf0;text-align:right;font-weight:600;">' + esc(dateTime) + '</td></tr>' +
    '<tr><td style="padding:10px 0;border-bottom:1px solid #e8ecf0;color:' + muted + ';">Passengers</td><td style="padding:10px 0;border-bottom:1px solid #e8ecf0;text-align:right;">' + esc(record.passengers || 1) + '</td></tr>' +
    (record.round_trip ? '<tr><td style="padding:10px 0;border-bottom:1px solid #e8ecf0;color:' + muted + ';">Round trip return</td><td style="padding:10px 0;border-bottom:1px solid #e8ecf0;text-align:right;">' + esc((record.return_date || '') + (record.return_time ? ' at ' + record.return_time : '')) + '</td></tr>' : '') +
    addonNote +
    '</table>' +
    notesBubble +
    '</td></tr></table></td></tr></table></body></html>'
  );
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
  var fromConfig = (config.notificationEmails && config.notificationEmails.length) ? config.notificationEmails : [];
  var fromEnv = NOTIFY_EMAIL ? NOTIFY_EMAIL.split(/[,\n]+/).map(function (e) { return e.trim().toLowerCase(); }).filter(Boolean) : [];
  var seen = {};
  var toList = [];
  fromConfig.concat(fromEnv).forEach(function (e) {
    if (e && !seen[e]) { seen[e] = true; toList.push(e); }
  });
  if (!toList.length) {
    console.warn('Booking notification skipped: no notification emails configured. Add emails in Admin or set NOTIFY_EMAIL on the server.');
  }
  if (!RESEND_API_KEY && toList.length) {
    console.warn('Booking notification skipped: RESEND_API_KEY not set on the server.');
  }
  if (RESEND_API_KEY && toList.length) {
    var subject = 'New booking: ' + (record.name || 'Booking') + ' – ' + record.pickup_date;
    var adminHtml = null;
    try { adminHtml = buildAdminNotificationEmailHtml(record); } catch (e) { console.warn('[Email] Admin HTML build failed:', e.message); }
    var adminPayload = { from: RESEND_FROM, to: [], subject: subject, text: details };
    if (adminHtml) adminPayload.html = adminHtml;
    var RESEND_RATE_MS = 600;
    function sendAdminToOne(index) {
      if (index >= toList.length) return;
      var toEmail = toList[index];
      console.log('[Email] Sending admin notification to:', toEmail);
      resendSendEmail({ from: adminPayload.from, to: [toEmail], subject: adminPayload.subject, text: adminPayload.text, html: adminPayload.html })
        .then(function (result) {
          if (!result.ok) {
            var msg = result.body && result.body.message ? result.body.message : result.body;
            console.warn('[Email] Resend admin notification rejected for', toEmail, ':', result.status, msg);
            if (result.status === 403 && msg && String(msg).indexOf('verify a domain') !== -1) {
              console.warn('[Email] To send to multiple recipients: verify your domain at https://resend.com/domains and set RESEND_FROM_EMAIL.');
            }
          } else {
            console.log('[Email] Admin notification sent to', toEmail);
          }
          if (index + 1 < toList.length) setTimeout(function () { sendAdminToOne(index + 1); }, RESEND_RATE_MS);
        })
        .catch(function (err) {
          console.warn('[Email] Resend admin notification failed for', toEmail, ':', err.message);
          if (index + 1 < toList.length) setTimeout(function () { sendAdminToOne(index + 1); }, RESEND_RATE_MS);
        });
    }
    sendAdminToOne(0);
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

function isDuplicateBooking(bookings, record, windowMinutes) {
  var cutoff = Date.now() - (windowMinutes || 10) * 60 * 1000;
  var email = (record.email || '').toLowerCase();
  var phone = (record.phone || '').trim();
  var date = (record.pickup_date || '').trim();
  var time = (record.pickup_time || '').trim();
  var address = (record.pickup_address || '').trim();
  for (var i = 0; i < bookings.length; i++) {
    var b = bookings[i];
    var created = new Date(b.createdAt).getTime();
    if (created < cutoff) continue;
    var sameContact = (b.email && email && b.email.toLowerCase() === email) || (b.phone && phone && b.phone.trim() === phone);
    var sameTrip = (b.pickup_date || '').trim() === date && (b.pickup_time || '').trim() === time && (b.pickup_address || '').trim() === address;
    if (sameContact && sameTrip) return true;
  }
  return false;
}

app.post('/api/bookings', function (req, res) {
  var body = req.body || {};
  if (!isPickupAtLeast24hFromNow(body.pickup_date, body.pickup_time)) {
    return res.status(400).json({
      error: 'Appointments made within 24 hours may not be confirmed. Call to confirm at (727) 999-4999.',
      code: 'PICKUP_TOO_SOON'
    });
  }
  var id = newBookingId();
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
    addon_car_seat: !!body.addon_car_seat,
    status: 'requested',
    fare: '',
    admin_notes: '',
    source: 'website'
  };
  storage.listBookings().then(function (bookings) {
    if (isDuplicateBooking(bookings, record, 10)) {
      res.status(201).json({ ok: true, id: id, duplicate: true });
      return;
    }
    return storage.addBooking(record).then(function () {
      sendBookingConfirmationToCustomer(record);
      setTimeout(function () { notifyNewBooking(record); }, 600);
      res.status(201).json({ ok: true, id: id });
    });
  }).catch(function (err) {
    console.error('Saving booking failed:', err.message);
    res.status(500).json({ error: 'We could not save your booking. Please call or text (727) 999-4999.' });
  });
});

function newBookingId() {
  return 'b' + Date.now() + '-' + Math.random().toString(36).slice(2, 9);
}

var BOOKING_STATUSES = ['requested', 'confirmed', 'completed', 'cancelled'];
var EDITABLE_TEXT_FIELDS = ['pickup_address', 'dropoff_dest', 'dropoff_other_address', 'pickup_date', 'pickup_time',
  'return_date', 'return_time', 'return_dropoff_address', 'airline', 'flight_number', 'name', 'phone',
  'special_requests', 'fare', 'admin_notes'];

// Apply admin-editable fields from a request body onto a booking record.
function applyAdminFields(record, body) {
  EDITABLE_TEXT_FIELDS.forEach(function (f) {
    if (body[f] !== undefined) record[f] = String(body[f] == null ? '' : body[f]).trim();
  });
  if (body.email !== undefined) record.email = String(body.email || '').trim().toLowerCase();
  if (body.passengers !== undefined) record.passengers = parseInt(body.passengers, 10) || 1;
  if (body.round_trip !== undefined) record.round_trip = !!body.round_trip;
  if (body.addon_car_seat !== undefined) record.addon_car_seat = !!body.addon_car_seat;
  if (body.status !== undefined && BOOKING_STATUSES.indexOf(body.status) !== -1) record.status = body.status;
  return record;
}

app.get('/api/bookings', requireAdmin, function (req, res) {
  storage.listBookings().then(function (list) {
    res.json(list);
  }).catch(function (err) {
    console.error('Loading bookings failed:', err.message);
    res.status(500).json({ error: 'Could not load bookings.' });
  });
});

// Admin: add a trip by hand (e.g. phone bookings or re-entering past customers). No emails are sent.
app.post('/api/admin/bookings', requireAdmin, function (req, res) {
  var body = req.body || {};
  if (!String(body.name || '').trim() && !String(body.phone || '').trim() && !String(body.email || '').trim()) {
    return res.status(400).json({ error: 'Enter at least a name, phone, or email.' });
  }
  var record = applyAdminFields({
    id: newBookingId(),
    createdAt: new Date().toISOString(),
    pickup_address: '', dropoff_dest: '', dropoff_other_address: '', pickup_date: '', pickup_time: '',
    round_trip: false, return_date: '', return_time: '', return_dropoff_address: '', passengers: 1,
    airline: '', flight_number: '', name: '', phone: '', email: '', special_requests: '',
    addon_car_seat: false, status: 'confirmed', fare: '', admin_notes: '', source: 'manual'
  }, body);
  storage.addBooking(record).then(function () {
    res.status(201).json({ ok: true, booking: record });
  }).catch(function (err) {
    console.error('Adding booking failed:', err.message);
    res.status(500).json({ error: 'Could not save. Please try again.' });
  });
});

// Admin: import many trips at once (from a Resend email export or a CRM backup CSV, parsed in the
// browser). Trips whose id already exists are skipped, so importing the same file twice is safe.
app.post('/api/admin/bookings/import', requireAdmin, function (req, res) {
  var incoming = (req.body && Array.isArray(req.body.bookings)) ? req.body.bookings : null;
  if (!incoming || !incoming.length) return res.status(400).json({ error: 'No trips to import.' });
  if (incoming.length > 2000) return res.status(400).json({ error: 'Too many trips in one import (max 2000).' });
  storage.listBookings().then(function (existing) {
    var seen = {};
    existing.forEach(function (b) { seen[b.id] = true; });
    var toAdd = [];
    var skipped = 0;
    incoming.forEach(function (raw) {
      if (!raw || typeof raw !== 'object') { skipped++; return; }
      var id = (typeof raw.id === 'string' && /^[A-Za-z0-9_-]{1,80}$/.test(raw.id)) ? raw.id : newBookingId();
      if (seen[id]) { skipped++; return; }
      var created = raw.createdAt && !isNaN(new Date(raw.createdAt).getTime()) ? new Date(raw.createdAt).toISOString() : new Date().toISOString();
      var record = applyAdminFields({
        id: id,
        createdAt: created,
        pickup_address: '', dropoff_dest: '', dropoff_other_address: '', pickup_date: '', pickup_time: '',
        round_trip: false, return_date: '', return_time: '', return_dropoff_address: '', passengers: 1,
        airline: '', flight_number: '', name: '', phone: '', email: '', special_requests: '',
        addon_car_seat: false, status: 'requested', fare: '', admin_notes: '',
        source: (typeof raw.source === 'string' && /^[a-z-]{1,30}$/.test(raw.source)) ? raw.source : 'import'
      }, raw);
      if (!record.name && !record.phone && !record.email) { skipped++; return; }
      seen[id] = true;
      toAdd.push(record);
    });
    // Add one at a time so file storage (local dev) never loses a write.
    return toAdd.reduce(function (p, r) {
      return p.then(function () { return storage.addBooking(r); });
    }, Promise.resolve()).then(function () {
      res.json({ ok: true, added: toAdd.length, skipped: skipped });
    });
  }).catch(function (err) {
    console.error('Import failed:', err.message);
    res.status(500).json({ error: 'Import failed. Nothing may have been saved; please try again.' });
  });
});

app.put('/api/admin/bookings/:id', requireAdmin, function (req, res) {
  var id = req.params.id;
  storage.getBooking(id).then(function (existing) {
    if (!existing) return res.status(404).json({ error: 'Booking not found.' });
    var record = applyAdminFields(Object.assign({}, existing), req.body || {});
    record.updatedAt = new Date().toISOString();
    return storage.updateBooking(id, record).then(function () {
      res.json({ ok: true, booking: record });
    });
  }).catch(function (err) {
    console.error('Updating booking failed:', err.message);
    res.status(500).json({ error: 'Could not save. Please try again.' });
  });
});

app.delete('/api/admin/bookings/:id', requireAdmin, function (req, res) {
  storage.deleteBooking(req.params.id).then(function (deleted) {
    if (!deleted) return res.status(404).json({ error: 'Booking not found.' });
    res.json({ ok: true });
  }).catch(function (err) {
    console.error('Deleting booking failed:', err.message);
    res.status(500).json({ error: 'Could not delete. Please try again.' });
  });
});

// Admin: download every booking as a spreadsheet (CSV) for backup.
app.get('/api/admin/bookings.csv', requireAdmin, function (req, res) {
  var cols = ['createdAt', 'status', 'source', 'name', 'phone', 'email', 'pickup_date', 'pickup_time', 'pickup_address',
    'dropoff_dest', 'dropoff_other_address', 'round_trip', 'return_date', 'return_time', 'return_dropoff_address',
    'passengers', 'airline', 'flight_number', 'addon_car_seat', 'fare', 'special_requests', 'admin_notes', 'id'];
  function cell(v) {
    var s = v == null ? '' : String(v);
    if (/^[=+\-@]/.test(s)) s = "'" + s; // stop spreadsheet formula injection
    return '"' + s.replace(/"/g, '""') + '"';
  }
  storage.listBookings().then(function (list) {
    var rows = [cols.join(',')].concat(list.map(function (b) {
      return cols.map(function (c) { return cell(b[c]); }).join(',');
    }));
    var stamp = new Date().toISOString().slice(0, 10);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="premier-transport-bookings-' + stamp + '.csv"');
    res.send('﻿' + rows.join('\r\n'));
  }).catch(function (err) {
    console.error('Export failed:', err.message);
    res.status(500).send('Export failed.');
  });
});

app.get('/api/storage-status', requireAdmin, function (req, res) {
  res.json({ database: storage.usingDatabase() });
});

app.get('/email-verified', function (req, res) {
  var email = (req.query && req.query.email) ? decodeURIComponent(String(req.query.email)).trim().toLowerCase() : '';
  if (email) {
    var config = readConfig();
    var list = config.notificationEmails || [];
    var verified = config.verifiedNotificationEmails || [];
    if (list.indexOf(email) !== -1 && verified.indexOf(email) === -1) {
      verified.push(email);
      config.verifiedNotificationEmails = verified;
      writeConfig(config).catch(function (err) { console.error('Saving verified email failed:', err.message); });
    }
  }
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
    res.status(500).json({ error: err.message || 'Failed to send verification email.' });
  });
});

// Always serve the live settings (from the database) instead of the file on disk.
app.get('/js/destinations-config.js', function (req, res) {
  res.setHeader('Cache-Control', 'no-cache');
  res.type('application/javascript').send(publicConfigScript(readConfig()));
});

// Don't expose server internals or raw data files as static files.
app.use(function (req, res, next) {
  if (/^\/(data|node_modules)\//.test(req.path) || /^\/(server|storage)\.js$/.test(req.path) || /^\/package(-lock)?\.json$/.test(req.path) || /^\/\.git/.test(req.path)) {
    return res.status(404).send('Not found');
  }
  next();
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

function start() {
  return storage.init().then(function () {
    return storage.loadConfig();
  }).then(function (c) {
    configCache = c;
    app.listen(PORT, onListening);
  });
}

start().catch(function (err) {
  console.error('[Startup] Could not connect to storage:', err.message);
  process.exit(1);
});

function onListening() {
  console.log('Premier Transport server at http://localhost:' + PORT);
  console.log('Admin: http://localhost:' + PORT + '/admin');
  console.log('Set ADMIN_EMAIL and ADMIN_PASSWORD in environment to secure login.');
  console.log('[Email] Resend:', RESEND_API_KEY ? 'API key set' : 'RESEND_API_KEY not set — no emails will be sent');
  if (RESEND_API_KEY && RESEND_FROM.indexOf('onboarding@resend.dev') !== -1) {
    console.log('[Email] Using default sender — set RESEND_FROM_EMAIL to your verified domain (e.g. noreply@premiertransport.services) so admin notifications reach all NOTIFY_EMAIL addresses.');
  }
}
