'use strict';
// POST /api/snapshot — save web + mobile canvas JPEGs to GitHub before each reset
// KV lock ensures only one client commits per reset cycle.
const { kv } = require('@vercel/kv');

const REPO  = 'studiospectroxia/shareandpaint';
const TOKEN = process.env.GITHUB_SNAPSHOT_TOKEN;

async function commitFile(filename, base64, message) {
  let sha;
  const check = await fetch(
    `https://api.github.com/repos/${REPO}/contents/${filename}`,
    { headers: { Authorization: `token ${TOKEN}`, 'User-Agent': 'shareandpaint' } }
  );
  if (check.ok) sha = (await check.json()).sha;

  const res = await fetch(
    `https://api.github.com/repos/${REPO}/contents/${filename}`,
    {
      method:  'PUT',
      headers: {
        Authorization:  `token ${TOKEN}`,
        'Content-Type': 'application/json',
        'User-Agent':   'shareandpaint',
      },
      body: JSON.stringify({ message, content: base64, ...(sha ? { sha } : {}) }),
    }
  );
  if (!res.ok) throw new Error(`GitHub ${res.status}: ${JSON.stringify(await res.json())}`);
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { dataUrlWeb, dataUrlMobile } = req.body || {};
  if (
    !dataUrlWeb    || !dataUrlWeb.startsWith('data:image/jpeg;base64,') ||
    !dataUrlMobile || !dataUrlMobile.startsWith('data:image/jpeg;base64,')
  ) {
    return res.status(400).json({ error: 'Invalid data' });
  }

  // Only one client wins the lock per reset cycle (5.5 hr expiry — just under the 6h cycle)
  const locked = await kv.set('snapshotLock', Date.now(), { nx: true, ex: 19800 });
  if (!locked) return res.json({ ok: true, skipped: true });

  const now     = new Date();
  const stamp   = now.toISOString().slice(0, 16).replace('T', '_').replace(':', '-');
  const message = `snapshot: ${now.toUTCString()}`;

  try {
    await Promise.all([
      commitFile(`snapshots/${stamp}_web.jpg`,    dataUrlWeb.replace('data:image/jpeg;base64,', ''),    message),
      commitFile(`snapshots/${stamp}_mobile.jpg`, dataUrlMobile.replace('data:image/jpeg;base64,', ''), message),
    ]);
    return res.json({ ok: true, stamp });
  } catch (e) {
    console.error('[snapshot]', e.message);
    return res.status(500).json({ error: 'Snapshot failed' });
  }
};
