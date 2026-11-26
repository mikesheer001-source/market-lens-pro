import { DEFAULT_SERVER_SCAN_CONFIG } from './server-scan.js';

const MAX_NOTIFICATIONS = 50;
const LOCK_MS = 3 * 60_000;

const json = (body, status = 200) => Response.json(body, {
  status,
  headers: { 'Cache-Control': 'no-store' }
});

export class ScanNotifications {
  constructor(state) {
    this.storage = state.storage;
    this.sql = this.storage.sql;
    this.sql.exec('CREATE TABLE IF NOT EXISTS scan_config (id INTEGER PRIMARY KEY CHECK (id = 1), value TEXT NOT NULL, profile_hash TEXT NOT NULL, updated_at TEXT NOT NULL)');
    this.sql.exec('CREATE TABLE IF NOT EXISTS scan_state (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
    this.sql.exec('CREATE TABLE IF NOT EXISTS scan_notifications (id TEXT PRIMARY KEY, run_id TEXT NOT NULL, created_at TEXT NOT NULL, scan_type TEXT NOT NULL, match_count INTEGER NOT NULL, symbols TEXT NOT NULL, bar_date TEXT, read_at TEXT)');
  }

  stateValue(key) {
    return this.sql.exec('SELECT value FROM scan_state WHERE key = ?', key).toArray()[0]?.value ?? null;
  }

  setState(key, value) {
    this.sql.exec('INSERT OR REPLACE INTO scan_state (key, value) VALUES (?, ?)', key, String(value));
  }

  currentConfig() {
    const row = this.sql.exec('SELECT value FROM scan_config WHERE id = 1').toArray()[0];
    return row ? JSON.parse(row.value) : JSON.parse(JSON.stringify(DEFAULT_SERVER_SCAN_CONFIG));
  }

  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === '/config' && request.method === 'GET') {
      return json(this.currentConfig());
    }
    if (url.pathname === '/config' && request.method === 'PUT') {
      let config;
      try { config = await request.json(); }
      catch { return json({ error: 'Invalid server scan settings.' }, 400); }
      const profileHash = JSON.stringify(config);
      this.storage.transactionSync(() => {
        const old = this.sql.exec('SELECT profile_hash FROM scan_config WHERE id = 1').toArray()[0]?.profile_hash;
        if (old !== profileHash) this.setState('matches', '[]');
        this.sql.exec('INSERT OR REPLACE INTO scan_config (id, value, profile_hash, updated_at) VALUES (1, ?, ?, ?)',
          JSON.stringify(config), profileHash, new Date().toISOString());
      });
      return json({ ok: true, config });
    }
    if (url.pathname === '/run/start' && request.method === 'POST') {
      let body;
      try { body = await request.json(); }
      catch { return json({ error: 'Invalid scan run.' }, 400); }
      if (!body?.runId || typeof body.runId !== 'string') return json({ error: 'A scan run ID is required.' }, 400);
      const accepted = this.storage.transactionSync(() => {
        const lockedUntil = Number(this.stateValue('locked_until') || 0);
        if (lockedUntil > Date.now()) return false;
        this.setState('locked_until', Date.now() + LOCK_MS);
        return true;
      });
      return accepted ? json({ ok: true }) : json({ error: 'A server scan is already running.' }, 409);
    }
    if (url.pathname === '/run/complete' && request.method === 'POST') {
      let body;
      try { body = await request.json(); }
      catch { return json({ error: 'Invalid scan result.' }, 400); }
      if (!body?.runId || typeof body.runId !== 'string') return json({ error: 'A scan run ID is required.' }, 400);
      const currentMatches = [...new Set((Array.isArray(body.matches) ? body.matches : [])
        .map(item => typeof item === 'string' ? item : item?.symbol)
        .filter(symbol => typeof symbol === 'string' && /^[A-Z][A-Z0-9.\-]{0,19}$/.test(symbol)))].sort();
      let result;
      this.storage.transactionSync(() => {
        const previousMatches = JSON.parse(this.stateValue('matches') || '[]');
        const newMatches = currentMatches.filter(symbol => !previousMatches.includes(symbol));
        const createdAt = body.scannedAt || new Date().toISOString();
        const notificationId = newMatches.length ? body.runId : null;
        if (notificationId) {
          this.sql.exec('INSERT OR IGNORE INTO scan_notifications (id, run_id, created_at, scan_type, match_count, symbols, bar_date, read_at) VALUES (?, ?, ?, ?, ?, ?, ?, NULL)',
            notificationId, body.runId, createdAt, body.scanType || 'scheduled',
            newMatches.length, JSON.stringify(newMatches), body.expectedBarDate || null);
        }
        this.setState('matches', JSON.stringify(currentMatches));
        result = {
          ok: true,
          notificationId,
          newMatches,
          newMatchCount: newMatches.length,
          lastRun: {
            runId: body.runId,
            scanType: body.scanType || 'scheduled',
            status: 'complete',
            scannedAt: createdAt,
            expectedBarDate: body.expectedBarDate || null,
            requested: Number(body.requested) || 0,
            returned: Number(body.returned) || 0,
            matchCount: currentMatches.length,
            newMatchCount: newMatches.length,
            feed: body.feed || 'iex',
            staleSymbols: Array.isArray(body.staleSymbols) ? body.staleSymbols : [],
            upstreamRequests: Number(body.upstreamRequests) || 0,
            scanDurationMs: Number(body.scanDurationMs) || 0
          }
        };
        this.setState('last_run', JSON.stringify(result.lastRun));
        this.setState('locked_until', 0);
        this.sql.exec('DELETE FROM scan_notifications WHERE id NOT IN (SELECT id FROM scan_notifications ORDER BY created_at DESC LIMIT ?)', MAX_NOTIFICATIONS);
      });
      return json(result);
    }
    if (url.pathname === '/run/fail' && request.method === 'POST') {
      let body;
      try { body = await request.json(); }
      catch { body = {}; }
      const lastRun = {
        runId: body.runId || null,
        scanType: body.scanType || 'scheduled',
        status: 'error',
        scannedAt: new Date().toISOString(),
        error: String(body.error || 'Server scan failed.').slice(0, 300)
      };
      this.storage.transactionSync(() => {
        this.setState('last_run', JSON.stringify(lastRun));
        this.setState('locked_until', 0);
      });
      return json({ ok: true, lastRun });
    }
    if (url.pathname === '/notifications' && request.method === 'GET') {
      const notifications = this.sql.exec('SELECT id, created_at, scan_type, match_count, symbols, bar_date, read_at FROM scan_notifications ORDER BY created_at DESC LIMIT ?', MAX_NOTIFICATIONS)
        .toArray().map(row => ({
          id: row.id,
          createdAt: row.created_at,
          scanType: row.scan_type,
          matchCount: row.match_count,
          symbols: JSON.parse(row.symbols),
          barDate: row.bar_date,
          readAt: row.read_at,
          unread: !row.read_at
        }));
      const rawLastRun = this.stateValue('last_run');
      return json({ notifications, lastRun: rawLastRun ? JSON.parse(rawLastRun) : null });
    }
    if (url.pathname === '/notifications/ack' && request.method === 'POST') {
      let body;
      try { body = await request.json(); }
      catch { return json({ error: 'Invalid notification acknowledgement.' }, 400); }
      if (typeof body?.id !== 'string' || !body.id || body.id.length > 100) {
        return json({ error: 'A notification ID is required.' }, 400);
      }
      const readAt = new Date().toISOString();
      this.sql.exec('UPDATE scan_notifications SET read_at = ? WHERE id = ?', readAt, body.id);
      return json({ ok: true, readAt });
    }
    return json({ error: 'Not found.' }, 404);
  }
}
