'use strict';
// POST /api/reset — clear all strokes and notify all clients
const { kv } = require('@vercel/kv');
const Ably   = require('ably');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  try {
    await Promise.all([
      kv.del('strokes'),
      kv.set('resetDate', new Date().toISOString().slice(0, 10)),
    ]);

    // Broadcast clear to all Ably clients
    const ably = new Ably.Rest(process.env.ABLY_API_KEY);
    await ably.channels.get('canvas').publish('clear', {});

    res.json({ ok: true });
  } catch (e) {
    console.error('[reset]', e.message);
    res.status(500).json({ error: 'Reset failed' });
  }
};
