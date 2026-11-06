export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');

  if (req.method !== 'POST') {
    return res.status(405).json({
      error: 'Method not allowed'
    });
  }

  return res.status(503).json({
    success: false,
    status: 'connection-test',
    error: 'AI evaluation is not enabled yet.'
  });
}
