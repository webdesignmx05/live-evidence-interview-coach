
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
    // Step 1: Obtain the Vercel OIDC identity token.
    const oidcToken = await getVercelOidcToken();

    // Step 2: Exchange the Vercel token for a Google access token.
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
      const details = await exchange.json().catch(() => ({}));

      console.error('Google STS exchange failed:', details);

      return res.status(502).json({
        success: false,
        stage: 'google-token-exchange',
        error:
          details.error || 'Google Cloud authentication failed.',
        description:
          details.error_description ||
          'No additional details provided.'
      });
    }

    const tokenData = await exchange.json();

    // Step 3: Test impersonation of the dedicated service account.
    const impersonation = await fetch(
      `https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/${SERVICE_ACCOUNT}:generateAccessToken`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${tokenData.access_token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          scope: [
            'https://www.googleapis.com/auth/cloud-platform'
          ],
          lifetime: '600s'
        })
      }
    );

    if (!impersonation.ok) {
      const details = await impersonation.json().catch(() => ({}));

      console.error('Service account impersonation failed:', details);

      return res.status(502).json({
        success: false,
        stage: 'service-account-impersonation',
        error:
          details.error?.message ||
          'Service account impersonation failed.'
      });
    }

    // Impersonation succeeded, but AI evaluation stays disabled.
    return res.status(503).json({
      success: false,
      stage: 'service-account-impersonation',
      authenticated: true,
      message:
        'Service account impersonation succeeded. AI evaluation remains disabled.'
    });

  } catch (error) {
    console.error('Authentication error:', error.message);

    return res.status(502).json({
      success: false,
      error: 'Authentication setup failed.'
    });
  }
}
