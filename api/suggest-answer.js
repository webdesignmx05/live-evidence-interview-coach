
import { getVercelOidcToken } from '@vercel/oidc';
import { Redis } from '@upstash/redis';
import { createHmac, timingSafeEqual } from 'node:crypto';

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
const MAX_REQUEST_BYTES = 28000;

const COOKIE_NAME = 'leic_session';

function safeEqual(provided, expected) {
  if (
    typeof provided !== 'string' ||
    typeof expected !== 'string' ||
    !expected
  ) {
    return false;
  }

  const a = Buffer.from(provided, 'utf8');
  const b = Buffer.from(expected, 'utf8');

  return a.length === b.length && timingSafeEqual(a, b);
}

function validOwnerKey(provided) {
  return safeEqual(provided, process.env.OWNER_API_KEY);
}

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
    expiresAt > now + 28800
  ) {
    return false;
  }

  const payload = `v1.${match[1]}`;

  const expectedSignature = createHmac('sha256', secret)
    .update(payload)
    .digest('base64url');

  return safeEqual(match[2], expectedSignature);
}

function validRequestOrigin(req) {
  const origin = req.headers.origin;
  const host = req.headers.host;

  if (
    typeof origin !== 'string' ||
    typeof host !== 'string'
  ) {
    return false;
  }

  return origin === `https://${host}`;
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
    res.setHeader('Allow', 'POST');

    return res.status(405).json({
      success: false,
      error: 'Method not allowed.'
    });
  }

  // Require the configured owner credential.
  if (!process.env.OWNER_API_KEY) {
    console.error('OWNER_API_KEY is not configured.');

    return res.status(503).json({
      success: false,
      error: 'Owner authentication is not configured.'
    });
  }

  // Existing PowerShell/API-key authentication.
  const authenticatedByKey = validOwnerKey(
    req.headers['x-owner-key']
  );

  // Browser authentication using the signed login cookie.
  const authenticatedBySession = validOwnerSession(req);

  if (!authenticatedByKey && !authenticatedBySession) {
    return res.status(401).json({
      success: false,
      error: 'Unauthorized.'
    });
  }

  // Require same-origin requests when using browser sessions.
  // API-key authentication remains available for PowerShell.
  if (
    !authenticatedByKey &&
    authenticatedBySession &&
    !validRequestOrigin(req)
  ) {
    return res.status(403).json({
      success: false,
      error: 'Invalid request origin.'
    });
  }

  // Validate the incoming request before Redis or Gemini.
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

  const { question } = req.body || {};

  if (typeof question !== 'string' || !question.trim() || question.length > 2000) {
    return res.status(400).json({success:false,error:'Provide an interview question (1–2,000 characters).'});
  }
  if (Buffer.byteLength(JSON.stringify({type:'suggest_answer',question}), 'utf8') > MAX_REQUEST_BYTES) {
    return res.status(413).json({success:false,error:'Request is too large.'});
  }

  // Redis enforces the shared daily evaluation allowance.
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
      error: 'Daily owner AI request allowance reached.',
      limit: usage.limit
    });
  }

  // Authenticate to private Cloud Run using Vercel OIDC.
  try {
    const idToken = await getCloudRunIdToken();

    const cloudRun = await fetch(CLOUD_RUN_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${idToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        type: 'suggest_answer',
        question: question.trim()
      }),
      signal: AbortSignal.timeout(55000)
    });

    const result = await cloudRun.json().catch(() => null);

    if (!cloudRun.ok) {
      console.error('Cloud Run suggested answer failed:', {
        status: cloudRun.status
      });

      return res.status(502).json({
        success: false,
        stage: 'cloud-run-suggested-answer',
        cloudRunStatus: cloudRun.status,
        error:
          result?.error ||
          'AI suggested answer service returned an error.'
      });
    }

    if (result?.success !== true ||
        typeof result.suggestion?.suggestedAnswer !== 'string' ||
        !Array.isArray(result.suggestion?.keyPoints) ||
        typeof result.suggestion?.caution !== 'string') {
      console.error('Unexpected Cloud Run suggested answer response.');
      return res.status(502).json({success:false,stage:'suggested-answer-response',error:'AI suggested answer returned an unexpected response.'});
    }

    return res.status(200).json({
      ...result,
      usage: {
        count: usage.count,
        limit: usage.limit,
        remaining: Math.max(
          0,
          usage.limit - usage.count
        )
      }
    });

  } catch (error) {
    console.error('AI suggested answer request failed:', error);

    return res.status(502).json({
      success: false,
      stage: 'suggested-answer-connection',
      error: 'Unable to generate a suggested answer.'
    });
  }
}
