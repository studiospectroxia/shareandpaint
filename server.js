'use strict';

const http      = require('http');
const fs        = require('fs');
const path      = require('path');
const os        = require('os');
const WebSocket = require('ws');

const PORT        = process.env.PORT || 3000;
const CANVAS_FILE = path.join(__dirname, 'canvas.json');
const MAX_STROKES = 100_000;
const TRIM_COUNT  = Math.floor(MAX_STROKES * 0.2); // trim oldest 20%

// ── Mime types ────────────────────────────────────────────────────
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'application/javascript; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.ico':  'image/x-icon',
  '.png':  'image/png',
};

// ── Canvas state ──────────────────────────────────────────────────
function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function defaultState() {
  return { resetDate: todayStr(), strokes: [] };
}

function loadState() {
  try {
    const raw  = fs.readFileSync(CANVAS_FILE, 'utf8');
    const data = JSON.parse(raw);
    if (data && Array.isArray(data.strokes) && typeof data.resetDate === 'string') {
      return data;
    }
  } catch (_) { /* file missing or corrupt — start fresh */ }
  return defaultState();
}

function saveState() {
  try {
    fs.writeFileSync(CANVAS_FILE, JSON.stringify(state));
  } catch (e) {
    console.error('[canvas] Failed to save:', e.message);
  }
}

let state = loadState();

// Returns true if a daily reset was performed.
function checkReset() {
  if (state.resetDate !== todayStr()) {
    state = defaultState();
    saveState();
    return true;
  }
  return false;
}

// ── HTTP server (serves public/) ──────────────────────────────────
const PUBLIC = path.join(__dirname, 'public');

const server = http.createServer((req, res) => {
  const safeUrl  = req.url.split('?')[0];
  const relPath  = safeUrl === '/' ? '/index.html' : safeUrl;
  const absPath  = path.normalize(path.join(PUBLIC, relPath));

  // Block path-traversal attempts
  if (!absPath.startsWith(PUBLIC + path.sep) && absPath !== PUBLIC) {
    res.writeHead(403); res.end('Forbidden'); return;
  }

  fs.readFile(absPath, (err, data) => {
    if (err) { res.writeHead(404); res.end('Not found'); return; }
    const ext = path.extname(absPath).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  });
});

// ── WebSocket server ──────────────────────────────────────────────
const wss = new WebSocket.Server({ server });

function broadcast(msg, except = null) {
  const data = typeof msg === 'string' ? msg : JSON.stringify(msg);
  for (const client of wss.clients) {
    if (client !== except && client.readyState === WebSocket.OPEN) {
      client.send(data);
    }
  }
}

function isValidStroke(s) {
  return (
    s !== null &&
    typeof s === 'object' &&
    Number.isFinite(s.x0) && Number.isFinite(s.y0) &&
    Number.isFinite(s.x1) && Number.isFinite(s.y1) &&
    typeof s.color  === 'string' && /^#[0-9a-f]{6}$/i.test(s.color) &&
    Number.isFinite(s.size) && s.size > 0 && s.size <= 200 &&
    (s.shape === 'round' || s.shape === 'square')
  );
}

wss.on('connection', (ws) => {
  // Check daily reset; if it fired, clear everyone else first
  if (checkReset()) {
    broadcast({ type: 'clear' });
  }

  // Bring new client up to date
  ws.send(JSON.stringify({ type: 'init', strokes: state.strokes }));

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch (_) { return; }

    // Manual canvas reset — clears for all connected clients
    if (msg.type === 'reset') {
      state.strokes = [];
      saveState();
      broadcast({ type: 'clear' }); // send to ALL, including sender
      return;
    }

    if (msg.type !== 'stroke') return;

    const s = msg.stroke;
    if (!isValidStroke(s)) return;

    // Sanitise coordinates (round to 2 dp to save space)
    const stroke = {
      x0: Math.round(s.x0 * 100) / 100,
      y0: Math.round(s.y0 * 100) / 100,
      x1: Math.round(s.x1 * 100) / 100,
      y1: Math.round(s.y1 * 100) / 100,
      color: s.color,
      size:  s.size,
      shape: s.shape,
    };

    state.strokes.push(stroke);

    // Trim oldest 20% if cap exceeded
    if (state.strokes.length > MAX_STROKES) {
      state.strokes.splice(0, TRIM_COUNT);
    }

    saveState();
    broadcast({ type: 'stroke', stroke }, ws);
  });

  ws.on('error', () => { /* individual client errors are non-fatal */ });
});

// ── Startup ───────────────────────────────────────────────────────
checkReset(); // also enforce reset on server boot

function lanIP() {
  for (const nets of Object.values(os.networkInterfaces())) {
    for (const net of nets) {
      if (net.family === 'IPv4' && !net.internal) return net.address;
    }
  }
  return null;
}

server.listen(PORT, '0.0.0.0', () => {
  const ip = lanIP();
  console.log('\n  ╔══════════════════════════════╗');
  console.log('  ║       Share & Paint          ║');
  console.log('  ╚══════════════════════════════╝\n');
  console.log(`  Local  →  http://localhost:${PORT}`);
  if (ip) console.log(`  LAN   →  http://${ip}:${PORT}`);
  console.log('\n  Open the URL above to start painting!\n');
});
