
'use strict';

import { createHmac, timingSafeEqual } from 'node:crypto';

const COOKIE_NAME = 'leic_session';
const SESSION_SECONDS = 8 * 60 * 60;

function validOwnerSession(req) {
  const secret = process.env.SESSION_SECRET;

  if (typeof secret !== 'string' || !secret) {
    return false;
  }

  const cookieHeader = req.headers.cookie;

  if (typeof cookieHeader !== 'string') {
    return false;
  }

  const cookie = cookieHeader
    .split(';')
    .map(part => part.trim())
    .find(part => part.startsWith(`${COOKIE_NAME}=`));

  if (!cookie) {
    return false;
  }

  const session = cookie.slice(COOKIE_NAME.length + 1);

  const match = /^v1\.(\d+)\.([A-Za-z0-9_-]+)$/.exec(session);

  if (!match) {
    return false;
  }

  const expiresAt = Number(match[1]);
  const now = Math.floor(Date.now() / 1000);

  if (
    !Number.isSafeInteger(expiresAt) ||
    expiresAt <= now ||
    expiresAt > now + SESSION_SECONDS
  ) {
    return false;
  }

  const payload = `v1.${match[1]}`;

  const expectedSignature = createHmac('sha256', secret)
    .update(payload)
    .digest('base64url');

  const provided = Buffer.from(match[2], 'utf8');
  const expected = Buffer.from(expectedSignature, 'utf8');

  return (
    provided.length === expected.length &&
    timingSafeEqual(provided, expected)
  );
}

export default function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');

    return res.status(405).json({
      authenticated: false,
      error: 'Method not allowed.'
    });
  }

  if (!process.env.SESSION_SECRET) {
    return res.status(503).json({
      authenticated: false,
      error: 'Session verification is unavailable.'
    });
  }

  const authenticated = validOwnerSession(req);

  return res.status(200).json({
    authenticated
  });
}
