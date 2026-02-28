var path = require('path');
var fs = require('fs');
var https = require('https');
var express = require('express');
var session = require('express-session');

// #region agent log
var DEBUG_LOG_PATH = path.join(__dirname, 'debug-ea39b2.log');
function debugLog(message, data, hypothesisId) {
  var line = JSON.stringify({
    sessionId: 'ea39b2',
    timestamp: Date.now(),
    location: 'server.js',
    message: message,
    data: data || {},
    hypothesisId: hypothesisId || ''
  }) + '\n';
  try { fs.appendFileSync(DEBUG_LOG_PATH, line, 'utf8'); } catch (e) {}
}
// #endregion

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

function writeConfig(config) {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf8');
  var jsPath = path.join(__dirname, 'js', 'destinations-config.js');
  var publicConfig = Object.assign({}, config);
  delete publicConfig.notificationEmails;
  delete publicConfig.verifiedNotificationEmails;
  try {
    fs.writeFileSync(jsPath, 'window.PremierTransportConfig = ' + JSON.stringify(publicConfig) + ';\n', 'utf8');
  } catch (e) {
    console.warn('Could not write destinations-config.js:', e.message);
  }
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
        resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode, body: data });
      });
    });
    req.on('error', reject);
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
    from: 'Premier Transport <onboarding@resend.dev>',
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

function googleMapsUrl(address) {
  if (!address || !String(address).trim()) return null;
  return 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(String(address).trim());
}

function buildConfirmationEmailHtml(record) {
  var primary = '#0d3b5c';
  var accent = '#e8a735';
  var bg = '#f8f9fa';
  var textColor = '#2c3e50';
  var muted = '#5a6c7d';
  var white = '#ffffff';
  var radius = '8px';
  var pickupAddr = (record.pickup_address || '').trim() || '—';
  var dropoffDisplay = (record.dropoff_dest || record.dropoff_other_address || '').trim() || '—';
  var pickupMaps = googleMapsUrl(record.pickup_address);
  var dropoffMaps = googleMapsUrl(record.dropoff_other_address || record.dropoff_dest);
  var specialRequests = (record.special_requests || '').trim();
  var name = record.name || 'there';
  var dateTime = (record.pickup_date || '') + (record.pickup_time ? ' at ' + record.pickup_time : '');
  var passengers = record.passengers != null ? record.passengers : 1;
  var roundTrip = record.round_trip && (record.return_date || record.return_time);
  var returnDateTime = (record.return_date || '') + (record.return_time ? ' at ' + record.return_time : '');
  var esc = function (s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); };
  var pickupLink = pickupMaps
    ? '<a href="' + esc(pickupMaps) + '" style="color:' + primary + ';text-decoration:underline;">' + esc(pickupAddr) + '</a> &nbsp;<a href="' + esc(pickupMaps) + '" style="display:inline-block;background:' + accent + ';color:#1a1a1a;padding:6px 12px;border-radius:6px;text-decoration:none;font-weight:600;font-size:13px;">View on Google Maps</a>'
    : esc(pickupAddr);
  var dropoffLink = dropoffMaps
    ? '<a href="' + esc(dropoffMaps) + '" style="color:' + primary + ';text-decoration:underline;">' + esc(dropoffDisplay) + '</a> &nbsp;<a href="' + esc(dropoffMaps) + '" style="display:inline-block;background:' + accent + ';color:#1a1a1a;padding:6px 12px;border-radius:6px;text-decoration:none;font-weight:600;font-size:13px;">View on Google Maps</a>'
    : esc(dropoffDisplay);
  var notesBubble = specialRequests
    ? '<table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:16px;"><tr><td style="background:#fff8e8;border-left:4px solid ' + accent + ';padding:14px 16px;border-radius:' + radius + ';font-size:14px;line-height:1.5;color:' + textColor + ';"><strong style="color:' + primary + ';">Notes / special requests</strong><br>' + esc(specialRequests) + '</td></tr></table>'
    : '';
  return (
    '<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;padding:0;font-family:\'Segoe UI\',Roboto,-apple-system,BlinkMacSystemFont,sans-serif;font-size:15px;line-height:1.5;color:' + textColor + ';background:' + bg + ';">' +
    '<table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:' + bg + ';"><tr><td style="padding:24px 16px;">' +
    '<table width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;margin:0 auto;background:' + white + ';border-radius:12px;box-shadow:0 4px 20px rgba(0,0,0,0.08);overflow:hidden;">' +
    '<tr><td style="background:' + primary + ';color:' + white + ';padding:20px 24px;font-size:20px;font-weight:700;">Premier Transport</td></tr>' +
    '<tr><td style="padding:24px;">' +
    '<p style="margin:0 0 20px;font-size:16px;">Hi ' + esc(name) + ',</p>' +
    '<p style="margin:0 0 20px;font-size:15px;">We received your booking request. Here are your trip details:</p>' +
    '<table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:' + bg + ';border-radius:' + radius + ';margin-bottom:16px;">' +
    '<tr><td style="padding:16px 20px;">' +
    '<table width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td style="font-size:11px;text-transform:uppercase;letter-spacing:0.5px;color:' + muted + ';padding-bottom:6px;">Pickup</td></tr><tr><td style="font-size:15px;">' + pickupLink + '</td></tr></table>' +
    '</td></tr><tr><td style="padding:0 20px 8px;"><div style="border-left:2px dashed ' + muted + ';height:20px;margin-left:8px;"></div></td></tr><tr><td style="padding:0 20px 16px;">' +
    '<table width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td style="font-size:11px;text-transform:uppercase;letter-spacing:0.5px;color:' + muted + ';padding-bottom:6px;">Drop-off</td></tr><tr><td style="font-size:15px;">' + dropoffLink + '</td></tr></table>' +
    '</td></tr></table>' +
    '<table width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td style="padding:8px 0;border-bottom:1px solid #eee;"><span style="color:' + muted + ';">Date & time</span></td><td style="padding:8px 0;border-bottom:1px solid #eee;text-align:right;font-weight:600;">' + esc(dateTime) + '</td></tr>' +
    '<tr><td style="padding:8px 0;border-bottom:1px solid #eee;"><span style="color:' + muted + ';">Passengers</span></td><td style="padding:8px 0;border-bottom:1px solid #eee;text-align:right;">' + esc(passengers) + '</td></tr>' +
    (roundTrip ? '<tr><td style="padding:8px 0;border-bottom:1px solid #eee;"><span style="color:' + muted + ';">Round trip return</span></td><td style="padding:8px 0;border-bottom:1px solid #eee;text-align:right;">' + esc(returnDateTime) + '</td></tr>' : '') +
    '</table>' +
    notesBubble +
    '<p style="margin:24px 0 0;font-size:14px;color:' + muted + ';">We\'ll confirm your ride by phone or email. If you don\'t hear from us within 24 hours, call or text <a href="tel:+17279994999" style="color:' + primary + ';text-decoration:underline;">(727) 999-4999</a>.</p>' +
    '<p style="margin:12px 0 0;font-size:14px;color:' + muted + ';">— Premier Transport</p>' +
    '</td></tr></table></td></tr></table></body></html>'
  );
}

function sendBookingConfirmationToCustomer(record) {
  try {
    var to = (record.email || '').trim().toLowerCase();
    // #region agent log
    debugLog('sendBookingConfirmationToCustomer', { hasTo: !!to, hasResendKey: !!RESEND_API_KEY }, 'customer-confirm');
    // #endregion
    if (!to || !RESEND_API_KEY) return;
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
    from: 'Premier Transport <onboarding@resend.dev>',
    to: [to],
    subject: 'Booking request received – ' + record.pickup_date + ' ' + (record.pickup_time || ''),
    text: text
  };
  if (html) payload.html = html;
  console.log('[Email] Sending customer confirmation to', to);
  resendSendEmail(payload)
    .then(function (result) {
      // #region agent log
      debugLog('Resend confirmation response', { ok: result.ok, status: result.status }, 'customer-confirm');
      // #endregion
      if (!result.ok) {
        console.warn('[Email] Resend rejection:', result.status, result.body && result.body.message ? result.body.message : result.body);
        return;
      }
      console.log('[Email] Customer confirmation sent to', to);
    })
    .catch(function (err) {
      // #region agent log
      debugLog('Resend confirmation error', { message: (err && err.message) || String(err) }, 'customer-confirm');
      // #endregion
      console.warn('[Email] Resend failed:', err.message);
    });
  } catch (err) {
    console.warn('sendBookingConfirmationToCustomer error:', err.message);
  }
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
  // #region agent log
  debugLog('notifyNewBooking', { toListLength: toList.length, hasResendKey: !!RESEND_API_KEY, toListCount: toList.length }, 'H1');
  debugLog('notifyNewBooking RESEND_API_KEY check', { hasKey: !!RESEND_API_KEY }, 'H2');
  // #endregion
  if (!toList.length) {
    console.warn('Booking notification skipped: no notification emails configured. Add emails in Admin or set NOTIFY_EMAIL on the server.');
  }
  if (!RESEND_API_KEY && toList.length) {
    console.warn('Booking notification skipped: RESEND_API_KEY not set on the server.');
  }
  if (RESEND_API_KEY && toList.length) {
    console.log('[Email] Sending admin notification to:', toList.join(', '));
    // #region agent log
    debugLog('Resend fetch starting', {}, 'H4');
    // #endregion
    resendSendEmail({
      from: 'Premier Transport <onboarding@resend.dev>',
      to: toList,
      subject: 'New booking: ' + (record.name || 'Booking') + ' – ' + record.pickup_date,
      text: details
    })
      .then(function (result) {
        // #region agent log
        debugLog('Resend fetch response', { ok: result.ok, status: result.status }, 'H4');
        // #endregion
        if (!result.ok) {
          console.warn('[Email] Resend admin notification rejected:', result.status, result.body && result.body.message ? result.body.message : result.body);
          return;
        }
        console.log('[Email] Admin notification sent.');
      })
      .catch(function (err) {
        // #region agent log
        debugLog('Resend fetch error', { message: (err && err.message) || String(err) }, 'H5');
        // #endregion
        console.warn('[Email] Resend admin notification failed:', err.message);
      });
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
  // #region agent log
  debugLog('POST /api/bookings received', { hasBody: !!(req.body && Object.keys(req.body || {}).length) }, 'H8');
  // #endregion
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
  var isDup = isDuplicateBooking(bookings, record, 10);
  // #region agent log
  debugLog('duplicate check', { isDuplicate: isDup }, 'H3');
  // #endregion
  if (isDup) {
    res.status(201).json({ ok: true, id: id, duplicate: true });
    return;
  }
  bookings.push(record);
  writeBookings(bookings);
  sendBookingConfirmationToCustomer(record);
  notifyNewBooking(record);
  // #region agent log
  debugLog('booking saved, notifyNewBooking called', {}, 'H3');
  // #endregion
  res.status(201).json({ ok: true, id: id });
});

app.get('/api/bookings', requireAdmin, function (req, res) {
  res.json(readBookings());
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
      writeConfig(config);
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
  console.log('[Email] Resend:', RESEND_API_KEY ? 'API key set' : 'RESEND_API_KEY not set — no emails will be sent');
});
