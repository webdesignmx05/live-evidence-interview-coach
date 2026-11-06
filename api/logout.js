
'use strict';

export default function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');

    return res.status(405).json({
      success: false,
      error: 'Method not allowed.'
    });
  }

  // Only accept logout requests from this website.
  const origin = req.headers.origin;
  const host = req.headers.host;

  if (
    typeof origin !== 'string' ||
    typeof host !== 'string' ||
    origin !== `https://${host}`
  ) {
    return res.status(403).json({
      success: false,
      error: 'Invalid request origin.'
    });
  }

  // Expire the same cookie created by api/login.js.
  res.setHeader(
    'Set-Cookie',
    'leic_session=; HttpOnly; Secure; SameSite=Strict; Path=/api; Max-Age=0'
  );

  return res.status(200).json({
    success: true,
    message: 'Signed out successfully.'
  });
}
