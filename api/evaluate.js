
import { getVercelOidcToken } from '@vercel/oidc';
import { Redis } from '@upstash/redis';
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

const DAILY_TEST_LIMIT = 200;

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

function getRedis() {
  const url = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;

  if (!url || !token) {
    throw new Error('Redis environment variables are missing.');
  }

  return new Redis({ url, token });
}

async function checkDailyTestLimit() {
  const redis = getRedis();

  const today = new Date().toISOString().slice(0, 10);
  const key = `interview-coach:connection-test:${today}`;

  // Atomic increment and expiration.
  // Only authenticated requests reach this point.
  const count = await redis.incr(key);

  if (count === 1) {
    await redis.expire(key, 172800);
  }

  return {
    allowed: count <= DAILY_TEST_LIMIT,
    count,
    limit: DAILY_TEST_LIMIT
  };
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'POST') {
    return res.status(405).json({
      error: 'Method not allowed'
    });
  }

  // Reject unauthorized requests before Redis or Google Cloud.
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

  // Fail closed if Redis is unavailable.
  let usage;

  try {
    usage = await checkDailyTestLimit();
  } catch (error) {
    console.error('Redis usage counter failed:', error);

    return res.status(503).json({
      success: false,
      stage: 'usage-counter',
      error: 'Usage protection is temporarily unavailable.'
    });
  }

  if (!usage.allowed) {
    return res.status(429).json({
      success: false,
      stage: 'usage-limit',
      error: 'Daily connection-test limit reached.',
      limit: usage.limit
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

    // 5. Test private Cloud Run connectivity.
    // AI evaluation remains disabled.
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
      usage: {
        count: usage.count,
        limit: usage.limit
      },
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
