'use strict';
// GET  /api/reset?key=ADMIN_RESET_KEY — admin browser reset
// POST /api/reset                     — internal use (kept for compatibility)
const { kv } = require('@vercel/kv');
const Ably   = require('ably');

async function doReset() {
  await Promise.all([
    kv.del('strokes'),
    kv.del('snapshotLock'),
    kv.set('resetDate', new Date().toISOString().slice(0, 10)),
  ]);
  const ably = new Ably.Rest(process.env.ABLY_API_KEY);
  await ably.channels.get('canvas').publish('clear', {});
}

module.exports = async function handler(req, res) {
  const adminKey = process.env.ADMIN_RESET_KEY;

  // GET with ?key= — admin browser reset
  if (req.method === 'GET') {
    if (!adminKey || req.query.key !== adminKey) {
      return res.status(401).send('Unauthorized');
    }
    try {
      await doReset();
      return res.send('Canvas cleared.');
    } catch (e) {
      console.error('[reset]', e.message);
      return res.status(500).send('Reset failed');
    }
  }

  // POST — internal (no key required, called from old reset btn flow)
  if (req.method === 'POST') {
    try {
      await doReset();
      return res.json({ ok: true });
    } catch (e) {
      console.error('[reset]', e.message);
      return res.status(500).json({ error: 'Reset failed' });
    }
  }

  res.status(405).end();
};
