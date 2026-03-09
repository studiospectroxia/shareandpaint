'use strict';
// GET  /api/strokes  — return all stored strokes (checks daily reset)
// POST /api/strokes  — append a batch of new strokes
const { kv }  = require('@vercel/kv');
const Ably    = require('ably');

const MAX_STROKES = 100_000;
const TRIM_COUNT  = Math.floor(MAX_STROKES * 0.2);

function today() {
  return new Date().toISOString().slice(0, 10);
}

function isValid(s) {
  return (
    s && typeof s === 'object' &&
    Number.isFinite(s.x0) && Number.isFinite(s.y0) &&
    Number.isFinite(s.x1) && Number.isFinite(s.y1) &&
    typeof s.color === 'string' && /^#[0-9a-f]{6}$/i.test(s.color) &&
    Number.isFinite(s.size) && s.size > 0 && s.size <= 200 &&
    (s.shape === 'round' || s.shape === 'square')
  );
}

module.exports = async function handler(req, res) {
  // ── GET: return all strokes ────────────────────────────────────
  if (req.method === 'GET') {
    try {
      const [resetDate, strokes] = await Promise.all([
        kv.get('resetDate'),
        kv.lrange('strokes', 0, -1),
      ]);

      const t = today();
      if (resetDate !== t) {
        // New day — wipe canvas
        await Promise.all([kv.del('strokes'), kv.set('resetDate', t)]);
        // Tell any currently-connected Ably clients to clear
        try {
          const ably = new Ably.Rest(process.env.ABLY_API_KEY);
          await ably.channels.get('canvas').publish('clear', {});
        } catch (_) {}
        return res.json({ strokes: [] });
      }

      return res.json({ strokes: strokes || [] });
    } catch (e) {
      console.error('[strokes GET]', e.message);
      return res.json({ strokes: [] });
    }
  }

  // ── POST: append a batch of strokes ───────────────────────────
  if (req.method === 'POST') {
    const { strokes = [] } = req.body || {};

    const clean = strokes.filter(isValid).map(s => ({
      x0: Math.round(s.x0 * 100) / 100,
      y0: Math.round(s.y0 * 100) / 100,
      x1: Math.round(s.x1 * 100) / 100,
      y1: Math.round(s.y1 * 100) / 100,
      color: s.color,
      size:  s.size,
      shape: s.shape,
    }));

    if (clean.length > 0) {
      await kv.rpush('strokes', ...clean);
      const count = await kv.llen('strokes');
      if (count > MAX_STROKES) {
        // Trim oldest 20%
        await kv.ltrim('strokes', count - (MAX_STROKES - TRIM_COUNT), -1);
      }
    }

    return res.json({ ok: true });
  }

  res.status(405).end();
};
