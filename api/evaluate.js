
import { getVercelOidcToken } from '@vercel/oidc';

const PROJECT_NUMBER = '796597994750';
const POOL_ID = 'vercel-interview-coach';
const PROVIDER_ID = 'vercel';

const SERVICE_ACCOUNT =
  'vercel-interview-coach-invoker@live-evidence-interview-coach.iam.gserviceaccount.com';

const AUDIENCE =
  `//iam.googleapis.com/projects/${PROJECT_NUMBER}` +
  `/locations/global/workloadIdentityPools/${POOL_ID}` +
  `/providers/${PROVIDER_ID}`;

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'POST') {
    return res.status(405).json({
      error: 'Method not allowed'
    });
  }

  try {
    const oidcToken = await getVercelOidcToken();

    const exchange = await fetch(
      'https://sts.googleapis.com/v1/token',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          audience: AUDIENCE,
          grantType:
            'urn:ietf:params:oauth:grant-type:token-exchange',
          requestedTokenType:
            'urn:ietf:params:oauth:token-type:access_token',
          subjectTokenType:
            'urn:ietf:params:oauth:token-type:jwt',
          subjectToken: oidcToken,
          scope:
            'https://www.googleapis.com/auth/cloud-platform'
        })
      }
    );

    if (!exchange.ok) {
      return res.status(502).json({
        success: false,
        stage: 'google-token-exchange',
        error: 'Google Cloud authentication failed.'
      });
    }

    return res.status(503).json({
      success: false,
      stage: 'google-token-exchange',
      authenticated: true,
      message:
        'Google token exchange succeeded. AI evaluation remains disabled.'
    });

  } catch (error) {
    console.error('Authentication error:', error.message);

    return res.status(502).json({
      success: false,
      error: 'Authentication setup failed.'
    });
  }
}
