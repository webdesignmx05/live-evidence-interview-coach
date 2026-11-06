
import { getVercelOidcToken } from '@vercel/oidc';
import { timingSafeEqual } from 'node:crypto';

const PROJECT_NUMBER = '796597994750';
const POOL_ID = 'vercel-interview-coach';
const PROVIDER_ID = 'vercel';

const SERVICE_ACCOUNT =
  'vercel-interview-coach-invoker@live-evidence-interview-coach.iam.gserviceaccount.com';

const CLOUD_RUN_URL =
  'https://interview-coach-api-796597994750.us-east1.run.app';

const AUDIENCE =
  `//iam.googleapis.com/projects/${PROJECT_NUMBER}` +
  `/locations/global/workloadIdentityPools/${POOL_ID}` +
  `/providers/${PROVIDER_ID}`;

function validOwnerKey(provided, expected) {
  if (
    typeof provided !== 'string' ||
    typeof expected !== 'string' ||
    !expected
  ) {
    return false;
  }

  const a = Buffer.from(provided);
  const b = Buffer.from(expected);

  return a.length === b.length && timingSafeEqual(a, b);
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'POST') {
    return res.status(405).json({
      error: 'Method not allowed'
    });
  }

  // Reject unauthorized requests before contacting Google Cloud.
  const ownerKey = req.headers['x-owner-key'];

  if (!process.env.OWNER_API_KEY) {
    console.error('OWNER_API_KEY is not configured.');

    return res.status(503).json({
      success: false,
      error: 'Owner authentication is not configured.'
    });
  }

  if (!validOwnerKey(ownerKey, process.env.OWNER_API_KEY)) {
    return res.status(401).json({
      success: false,
      error: 'Unauthorized.'
    });
  }

  try {
    // 1. Obtain Vercel's OIDC identity token.
    const oidcToken = await getVercelOidcToken();

    // 2. Exchange the Vercel token with Google STS.
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
        error: details.error || 'Google Cloud authentication failed.',
        description:
          details.error_description || 'No additional details provided.'
      });
    }

    const tokenData = await exchange.json();

    // 3. Verify service account impersonation.
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
          details.error?.message || 'Service account impersonation failed.'
      });
    }

    // 4. Generate a Google-signed ID token for private Cloud Run.
    const identity = await fetch(
      `https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/${SERVICE_ACCOUNT}:generateIdToken`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${tokenData.access_token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          audience: CLOUD_RUN_URL,
          includeEmail: true
        })
      }
    );

    if (!identity.ok) {
      const details = await identity.json().catch(() => ({}));
      console.error('Cloud Run ID token generation failed:', details);

      return res.status(502).json({
        success: false,
        stage: 'cloud-run-id-token',
        error:
          details.error?.message || 'Cloud Run ID token generation failed.'
      });
    }

    const identityData = await identity.json();

    // 5. Test the authenticated private Cloud Run connection.
    // GET is intentional; AI evaluation remains disabled.
    const cloudRun = await fetch(CLOUD_RUN_URL, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${identityData.token}`
      }
    });

    const responseText = await cloudRun.text();

    if (cloudRun.status === 401 || cloudRun.status === 403) {
      return res.status(502).json({
        success: false,
        stage: 'cloud-run-invocation',
        cloudRunStatus: cloudRun.status,
        error: 'Private Cloud Run rejected the authenticated request.'
      });
    }

    console.log('Cloud Run connection test:', {
      status: cloudRun.status,
      responseLength: responseText.length
    });

    return res.status(503).json({
      success: false,
      stage: 'cloud-run-connection-test',
      authenticated: true,
      cloudRunStatus: cloudRun.status,
      message:
        'Private Cloud Run connection test completed. Public AI evaluation remains disabled.'
    });

  } catch (error) {
    console.error('Authentication or Cloud Run connection error:', error);

    return res.status(502).json({
      success: false,
      error: 'Backend connection test failed.'
    });
  }
}
