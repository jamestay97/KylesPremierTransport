// Storage layer for settings (config) and bookings.
//
// If DATABASE_URL is set (e.g. a free Neon Postgres database), everything is
// saved in the database and survives Render restarts and redeploys.
// If it is not set (local development), data is kept in data/*.json files.

var fs = require('fs');
var path = require('path');

var CONFIG_PATH = path.join(__dirname, 'data', 'config.json');
var BOOKINGS_PATH = path.join(__dirname, 'data', 'bookings.json');

var pool = null;

function usingDatabase() {
  return !!pool;
}

function readJsonFile(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    return fallback;
  }
}

function writeJsonFile(file, value) {
  var dir = path.dirname(file);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2), 'utf8');
}

function init() {
  var url = process.env.DATABASE_URL;
  if (!url) {
    console.warn('[Storage] DATABASE_URL not set — using data/*.json files. On Render these are WIPED on every restart; set DATABASE_URL to keep bookings.');
    return Promise.resolve();
  }
  var pg = require('pg');
  function sslFor(u) {
    // Neon requires TLS; a local test database does not.
    return /@(localhost|127\.0\.0\.1)[:/]/.test(u) ? false : { rejectUnauthorized: true };
  }
  // App traffic uses the pooled connection string (DATABASE_URL, "-pooler" host on Neon).
  pool = new pg.Pool({ connectionString: url, ssl: sslFor(url), max: 5, idleTimeoutMillis: 30000 });
  pool.on('error', function (err) { console.warn('[Storage] Idle database connection error:', err.message); });

  // Schema setup uses the direct connection when available (Neon best practice for DDL).
  var directUrl = process.env.DATABASE_URL_UNPOOLED || url;
  var setup = new pg.Client({ connectionString: directUrl, ssl: sslFor(directUrl) });
  return setup.connect().then(function () {
    return setup.query(
      'CREATE TABLE IF NOT EXISTS app_settings (key TEXT PRIMARY KEY, value JSONB NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT now());' +
      'CREATE TABLE IF NOT EXISTS bookings (id TEXT PRIMARY KEY, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), data JSONB NOT NULL);'
    );
  }).then(function () {
    return setup.end();
  }, function (err) {
    return setup.end().catch(function () {}).then(function () { throw err; });
  }).then(function () {
    // First run: copy the existing JSON files into the database.
    return pool.query("SELECT 1 FROM app_settings WHERE key = 'config'");
  }).then(function (r) {
    if (r.rowCount) return;
    var fileConfig = readJsonFile(CONFIG_PATH, null);
    if (!fileConfig) return;
    console.log('[Storage] Seeding settings from data/config.json');
    return pool.query("INSERT INTO app_settings (key, value) VALUES ('config', $1) ON CONFLICT (key) DO NOTHING", [JSON.stringify(fileConfig)]);
  }).then(function () {
    return pool.query('SELECT COUNT(*)::int AS n FROM bookings');
  }).then(function (r) {
    if (r.rows[0].n > 0) return;
    var fileBookings = readJsonFile(BOOKINGS_PATH, []);
    if (!Array.isArray(fileBookings) || !fileBookings.length) return;
    console.log('[Storage] Seeding ' + fileBookings.length + ' booking(s) from data/bookings.json');
    return Promise.all(fileBookings.map(function (b) { return insertBooking(b); }));
  }).then(function () {
    console.log('[Storage] Connected to Postgres — bookings and settings are saved permanently.');
  });
}

// ---------- Settings ----------

function loadConfig() {
  if (!pool) return Promise.resolve(readJsonFile(CONFIG_PATH, null));
  return pool.query("SELECT value FROM app_settings WHERE key = 'config'").then(function (r) {
    return r.rowCount ? r.rows[0].value : null;
  });
}

function saveConfig(config) {
  if (!pool) {
    writeJsonFile(CONFIG_PATH, config);
    return Promise.resolve();
  }
  return pool.query(
    "INSERT INTO app_settings (key, value, updated_at) VALUES ('config', $1, now()) " +
    'ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()',
    [JSON.stringify(config)]
  );
}

// ---------- Bookings ----------

function listBookings() {
  if (!pool) {
    var list = readJsonFile(BOOKINGS_PATH, []);
    return Promise.resolve(Array.isArray(list) ? list : []);
  }
  return pool.query('SELECT data FROM bookings ORDER BY created_at ASC').then(function (r) {
    return r.rows.map(function (row) { return row.data; });
  });
}

function insertBooking(record) {
  return pool.query(
    'INSERT INTO bookings (id, created_at, data) VALUES ($1, $2, $3) ON CONFLICT (id) DO NOTHING',
    [record.id, record.createdAt || new Date().toISOString(), JSON.stringify(record)]
  );
}

function addBooking(record) {
  if (!pool) {
    return listBookings().then(function (list) {
      list.push(record);
      writeJsonFile(BOOKINGS_PATH, list);
    });
  }
  return insertBooking(record);
}

function getBooking(id) {
  return listBookingsById(id);
}

function listBookingsById(id) {
  if (!pool) {
    return listBookings().then(function (list) {
      return list.find(function (b) { return b.id === id; }) || null;
    });
  }
  return pool.query('SELECT data FROM bookings WHERE id = $1', [id]).then(function (r) {
    return r.rowCount ? r.rows[0].data : null;
  });
}

function updateBooking(id, record) {
  if (!pool) {
    return listBookings().then(function (list) {
      var i = list.findIndex(function (b) { return b.id === id; });
      if (i === -1) return false;
      list[i] = record;
      writeJsonFile(BOOKINGS_PATH, list);
      return true;
    });
  }
  return pool.query('UPDATE bookings SET data = $2 WHERE id = $1', [id, JSON.stringify(record)]).then(function (r) {
    return r.rowCount > 0;
  });
}

function deleteBooking(id) {
  if (!pool) {
    return listBookings().then(function (list) {
      var next = list.filter(function (b) { return b.id !== id; });
      if (next.length === list.length) return false;
      writeJsonFile(BOOKINGS_PATH, next);
      return true;
    });
  }
  return pool.query('DELETE FROM bookings WHERE id = $1', [id]).then(function (r) {
    return r.rowCount > 0;
  });
}

module.exports = {
  init: init,
  usingDatabase: usingDatabase,
  loadConfig: loadConfig,
  saveConfig: saveConfig,
  listBookings: listBookings,
  addBooking: addBooking,
  getBooking: getBooking,
  updateBooking: updateBooking,
  deleteBooking: deleteBooking
};
