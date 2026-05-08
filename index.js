'use strict';
require('dotenv').config();

const express = require('express');
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const PORT = process.env.PORT || 3012;
const DB_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR, { recursive: true });

const db = new Database(path.join(DB_DIR, 'status.db'));
db.pragma('journal_mode = WAL');
db.exec(`
    CREATE TABLE IF NOT EXISTS checks (
        id        INTEGER PRIMARY KEY AUTOINCREMENT,
        service   TEXT NOT NULL,
        ts        INTEGER NOT NULL,
        up        INTEGER NOT NULL,
        latency   INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_checks_service_ts ON checks(service, ts);
`);

// ── Services config ───────────────────────────────────────────────────────────
const SERVICES = [
    { id: 'fahrstuhl',     name: 'Fahrstuhl Bot',   icon: '🚀', url: process.env.FAHRSTUHL_HEALTH_URL    || 'http://localhost:3002/health' },
    { id: 'eseltokens',    name: 'EselTokens',       icon: '🪙', url: process.env.ESELTOKENS_HEALTH_URL   || 'http://localhost:3000/' },
    { id: 'linkshortener', name: 'Link-Shortener',   icon: '🔗', url: process.env.LINKSHORTENER_HEALTH_URL|| 'http://localhost:3010/health' },
    { id: 'filehoster',    name: 'File-Hoster',      icon: '📁', url: process.env.FILEHOSTER_HEALTH_URL   || 'http://localhost:3011/health' },
    { id: 'eselmusic',     name: 'EselMusic Bot',    icon: '🎵', url: process.env.ESELMUSIC_HEALTH_URL    || null },
    { id: 'team',          name: 'Team-Seite',       icon: '👥', url: process.env.TEAM_HEALTH_URL          || 'http://localhost:3014/health' },
    { id: 'zitatboard',    name: 'Zitat-Board',      icon: '💬', url: process.env.ZITATBOARD_HEALTH_URL    || 'http://localhost:3013/health' },
    { id: 'statuspage',    name: 'Status-Page',      icon: '📡', url: process.env.STATUSPAGE_HEALTH_URL    || 'http://localhost:3012/health' },
    { id: 'esel',          name: 'Esel-Seite',       icon: '🫏', url: process.env.ESEL_HEALTH_URL           || 'http://localhost:3015/health' },
];

// ── Check logic ───────────────────────────────────────────────────────────────
const INSERT = db.prepare('INSERT INTO checks (service, ts, up, latency) VALUES (?, ?, ?, ?)');

async function checkService(svc) {
    if (!svc.url) return;
    const start = Date.now();
    try {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 5000);
        const res = await fetch(svc.url, { signal: ctrl.signal });
        clearTimeout(timer);
        const latency = Date.now() - start;
        const up = res.ok ? 1 : 0;
        INSERT.run(svc.id, Date.now(), up, latency);
    } catch {
        INSERT.run(svc.id, Date.now(), 0, null);
    }
}

async function checkAll() {
    await Promise.all(SERVICES.map(checkService));
    // Prune checks older than 90 days
    db.prepare('DELETE FROM checks WHERE ts < ?').run(Date.now() - 90 * 24 * 60 * 60 * 1000);
}

checkAll();
setInterval(checkAll, 60_000);

// ── Uptime helper ─────────────────────────────────────────────────────────────
function uptimePct(serviceId, sinceMs) {
    const rows = db.prepare('SELECT up FROM checks WHERE service = ? AND ts >= ?').all(serviceId, Date.now() - sinceMs);
    if (!rows.length) return null;
    return Math.round((rows.filter(r => r.up).length / rows.length) * 1000) / 10;
}

function recentChecks(serviceId, limit = 30) {
    return db.prepare('SELECT up, latency FROM checks WHERE service = ? ORDER BY ts DESC LIMIT ?').all(serviceId, limit).reverse();
}

// ── App ───────────────────────────────────────────────────────────────────────
const app = express();
app.use(express.static(path.join(__dirname, 'public')));

app.get('/health', (req, res) => res.json({ status: 'ok', service: 'statuspage', uptime: process.uptime() }));

app.get('/api/status', (req, res) => {
    const data = SERVICES.map(svc => {
        if (!svc.url) {
            return { id: svc.id, name: svc.name, icon: svc.icon, configured: false, status: 'unknown', latency: null, uptime24h: null, uptime7d: null, history: [] };
        }
        const latest = db.prepare('SELECT up, latency, ts FROM checks WHERE service = ? ORDER BY ts DESC LIMIT 1').get(svc.id);
        const status = !latest ? 'unknown' : latest.up ? 'up' : 'down';
        return {
            id: svc.id,
            name: svc.name,
            icon: svc.icon,
            configured: true,
            status,
            latency: latest?.latency ?? null,
            lastCheck: latest?.ts ?? null,
            uptime24h: uptimePct(svc.id, 24 * 60 * 60 * 1000),
            uptime7d:  uptimePct(svc.id, 7  * 24 * 60 * 60 * 1000),
            history: recentChecks(svc.id, 30),
        };
    });
    res.json(data);
});

app.listen(PORT, () => console.log(`[status.eselbande.com] Running on port ${PORT}`));
