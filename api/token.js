'use strict';
// Returns an Ably token request so the client can connect without
// exposing the full API key in the browser.
const Ably = require('ably');

module.exports = async function handler(req, res) {
  try {
    const client       = new Ably.Rest(process.env.ABLY_API_KEY);
    const tokenRequest = await client.auth.createTokenRequest({
      capability: { canvas: ['subscribe', 'publish'] },
    });
    res.json(tokenRequest);
  } catch (e) {
    console.error('[token]', e.message);
    res.status(500).json({ error: 'Token generation failed' });
  }
};
