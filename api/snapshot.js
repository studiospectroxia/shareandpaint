'use strict';
// POST /api/snapshot — save a canvas JPEG to GitHub before each reset
// KV lock ensures only one client commits per reset cycle.
const { kv } = require('@vercel/kv');

const REPO  = 'studiospectroxia/shareandpaint';
const TOKEN = process.env.GITHUB_SNAPSHOT_TOKEN;

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { dataUrl } = req.body || {};
  if (!dataUrl || !dataUrl.startsWith('data:image/jpeg;base64,')) {
    return res.status(400).json({ error: 'Invalid data' });
  }

  // Only one client wins the lock per reset cycle (23 hr expiry)
  const locked = await kv.set('snapshotLock', Date.now(), { nx: true, ex: 82800 });
  if (!locked) return res.json({ ok: true, skipped: true });

  const base64   = dataUrl.replace('data:image/jpeg;base64,', '');
  const now      = new Date();
  const stamp    = now.toISOString().slice(0, 16).replace('T', '_').replace(':', '-');
  const filename = `snapshots/${stamp}.jpg`;

  try {
    // Check if file already exists (need SHA to overwrite)
    let sha;
    const check = await fetch(
      `https://api.github.com/repos/${REPO}/contents/${filename}`,
      { headers: { Authorization: `token ${TOKEN}`, 'User-Agent': 'shareandpaint' } }
    );
    if (check.ok) sha = (await check.json()).sha;

    const body = {
      message: `snapshot: ${now.toUTCString()}`,
      content: base64,
      ...(sha ? { sha } : {}),
    };

    const put = await fetch(
      `https://api.github.com/repos/${REPO}/contents/${filename}`,
      {
        method:  'PUT',
        headers: {
          Authorization:  `token ${TOKEN}`,
          'Content-Type': 'application/json',
          'User-Agent':   'shareandpaint',
        },
        body: JSON.stringify(body),
      }
    );

    if (!put.ok) {
      console.error('[snapshot] GitHub error:', await put.json());
      return res.status(500).json({ error: 'GitHub commit failed' });
    }

    return res.json({ ok: true, file: filename });
  } catch (e) {
    console.error('[snapshot]', e.message);
    return res.status(500).json({ error: 'Snapshot failed' });
  }
};
