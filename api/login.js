
'use strict';

import { createHmac, timingSafeEqual } from 'node:crypto';
import { Redis } from '@upstash/redis';

const redis = new Redis({
  url: process.env.KV_REST_API_URL,
  token: process.env.KV_REST_API_TOKEN
});

const COOKIE_NAME = 'leic_session';
const SESSION_SECONDS = 8 * 60 * 60;
const MAX_ATTEMPTS = 5;
const WINDOW_SECONDS = 15 * 60;

function matchesSecret(provided, expected) {
  if (typeof provided !== 'string' || !expected) return false;

  const a = Buffer.from(provided);
  const b = Buffer.from(expected);

  return a.length === b.length && timingSafeEqual(a, b);
}

function sign(value, secret) {
  return createHmac('sha256', secret)
    .update(value)
    .digest('base64url');
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const expectedOrigin = `https://${req.headers.host}`;
  if (req.headers.origin !== expectedOrigin) {
    return res.status(403).json({ error: 'Invalid origin' });
  }

  if (!process.env.OWNER_API_KEY || !process.env.SESSION_SECRET) {
    return res.status(503).json({ error: 'Authentication unavailable' });
  }

  const ownerKey = req.body?.ownerKey;

  if (typeof ownerKey !== 'string' || ownerKey.length > 256) {
    return res.status(400).json({ error: 'Invalid request' });
  }

  try {
    // Shared rate limit across Vercel instances.
    // Limits attempts globally, not per browser.
    const bucket = Math.floor(Date.now() / (WINDOW_SECONDS * 1000));
    const limitKey = `interview-coach:login-attempts:${bucket}`;

    const attempts = Number(await redis.eval(
      `local n = redis.call('INCR', KEYS[1])
       if n == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end
       return n`,
      [limitKey],
      [WINDOW_SECONDS * 2]
    ));

    if (attempts > MAX_ATTEMPTS) {
      return res.status(429).json({
        error: 'Too many login attempts. Try again later.'
      });
    }

    if (!matchesSecret(ownerKey, process.env.OWNER_API_KEY)) {
      return res.status(401).json({ error: 'Invalid owner key' });
    }

    const expiresAt = Math.floor(Date.now() / 1000) + SESSION_SECONDS;
    const payload = `v1.${expiresAt}`;
    const signature = sign(payload, process.env.SESSION_SECRET);
    const session = `${payload}.${signature}`;

    res.setHeader(
      'Set-Cookie',
      `${COOKIE_NAME}=${session}; HttpOnly; Secure; SameSite=Strict; Path=/api; Max-Age=${SESSION_SECONDS}`
    );

    return res.status(200).json({
      success: true,
      message: 'Owner session established',
      expiresInSeconds: SESSION_SECONDS
    });
  } catch (error) {
    console.error('Owner login failed:', error.message);
    return res.status(503).json({
      error: 'Authentication temporarily unavailable'
    });
  }
}
