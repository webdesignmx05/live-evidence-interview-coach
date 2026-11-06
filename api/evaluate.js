
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

const DAILY_OWNER_LIMIT = 200;
const MAX_REQUEST_BYTES = 8192;

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
    throw new Error('Redis configuration is missing.');
  }

  return new Redis({ url, token });
}

async function checkOwnerAllowance() {
  const redis = getRedis();
  const today = new Date().toISOString().slice(0, 10);
  const key = `interview-coach:owner-evaluations:${today}`;

  // Atomic increment and expiration.
  // Both operations execute together on the Redis server.
  const results = await redis.eval(
    `local count = redis.call('INCR', KEYS[1])
     if count == 1 then
       redis.call('EXPIRE', KEYS[1], 172800)
     end
     return count`,
    [key],
    []
  );

  const count = Number(results);

  if (!Number.isSafeInteger(count) || count < 1) {
    throw new Error('Invalid Redis counter result.');
  }

  return {
    allowed: count <= DAILY_OWNER_LIMIT,
    count,
    limit: DAILY_OWNER_LIMIT
  };
}

async function getCloudRunIdToken() {
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
    throw new Error(
      `Google STS exchange failed (${exchange.status}).`
    );
  }

  const tokenData = await exchange.json();

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
    throw new Error(
      `Cloud Run ID token generation failed (${identity.status}).`
    );
  }

  const identityData = await identity.json();

  if (!identityData.token) {
    throw new Error('Cloud Run ID token is missing.');
  }

  return identityData.token;
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'POST') {
    return res.status(405).json({
      success: false,
      error: 'Method not allowed.'
    });
  }

  // Owner authentication is required.
  if (!process.env.OWNER_API_KEY) {
    console.error('OWNER_API_KEY is not configured.');

    return res.status(503).json({
      success: false,
      error: 'Owner authentication is not configured.'
    });
  }

  if (
    !validOwnerKey(
      req.headers['x-owner-key'],
      process.env.OWNER_API_KEY
    )
  ) {
    return res.status(401).json({
      success: false,
      error: 'Unauthorized.'
    });
  }

  // Validate the incoming request before calling Redis or AI.
  const contentLength = Number(req.headers['content-length']);

  if (
    Number.isFinite(contentLength) &&
    contentLength > MAX_REQUEST_BYTES
  ) {
    return res.status(413).json({
      success: false,
      error: 'Request is too large.'
    });
  }

  const { question, answer } = req.body || {};

  if (
    typeof question !== 'string' ||
    typeof answer !== 'string' ||
    question.trim().length < 1 ||
    question.trim().length > 200 ||
    answer.trim().length < 1 ||
    answer.trim().length > 2000
  ) {
    return res.status(400).json({
      success: false,
      error:
        'Provide a question (1–200 characters) and answer (1–2000 characters).'
    });
  }

  if (
    Buffer.byteLength(
      JSON.stringify({ question, answer }),
      'utf8'
    ) > MAX_REQUEST_BYTES
  ) {
    return res.status(413).json({
      success: false,
      error: 'Request is too large.'
    });
  }

  // Fail closed if the shared usage counter is unavailable.
  let usage;

  try {
    usage = await checkOwnerAllowance();
  } catch (error) {
    console.error('Redis usage protection failed:', error);

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
      error: 'Daily owner evaluation allowance reached.',
      limit: usage.limit
    });
  }

  try {
    const idToken = await getCloudRunIdToken();

    const cloudRun = await fetch(CLOUD_RUN_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${idToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        question: question.trim(),
        answer: answer.trim()
      }),
      signal: AbortSignal.timeout(55000)
    });

    const result = await cloudRun.json().catch(() => null);

    if (!cloudRun.ok) {
      console.error('Cloud Run evaluation failed:', {
        status: cloudRun.status
      });

      return res.status(502).json({
        success: false,
        stage: 'cloud-run-evaluation',
        cloudRunStatus: cloudRun.status,
        error:
          result?.error || 'AI evaluation service returned an error.'
      });
    }

    if (
      result?.success !== true ||
      typeof result.totalScore !== 'number' ||
      !result.evaluation
    ) {
      console.error('Unexpected Cloud Run evaluation response.');

      return res.status(502).json({
        success: false,
        stage: 'evaluation-response',
        error: 'AI evaluation returned an unexpected response.'
      });
    }

    return res.status(200).json({
      ...result,
      usage: {
        count: usage.count,
        limit: usage.limit,
        remaining: Math.max(0, usage.limit - usage.count)
      }
    });

  } catch (error) {
    console.error('AI evaluation request failed:', error);

    return res.status(502).json({
      success: false,
      stage: 'evaluation-connection',
      error: 'Unable to complete the AI evaluation.'
    });
  }
}
