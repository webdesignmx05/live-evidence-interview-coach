export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'POST') {
    return res.status(405).json({
      error: 'Method not allowed'
    });
  }

  return res.status(503).json({
    success: false,
    error: 'AI evaluation is not publicly enabled yet.'
  });
}
