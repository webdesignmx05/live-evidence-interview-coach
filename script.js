'use strict';

const question = document.getElementById('question');
const answer = document.getElementById('answer');
const notice = document.getElementById('notice');

const evaluateButton = document.getElementById('evaluate');
const previewButton = document.getElementById('preview');
const clearButton = document.getElementById('clear');

const loginButton = document.getElementById('login');
const logoutButton = document.getElementById('logout');
const ownerKeyInput = document.getElementById('owner-key');

const authStatus = document.getElementById('auth-status');
const authNotice = document.getElementById('auth-notice');
const loginControls = document.getElementById('login-controls');
const logoutControls = document.getElementById('logout-controls');
const appStatus = document.getElementById('app-status');

let signedIn = false;
let busy = false;

const example = {
  questionType: 'Experience overview',
  scores: [
    ['Clear claim', 20],
    ['Specific context', 18],
    ['Concrete action', 17],
    ['Evidence / verification', 16],
    ['Result / relevance', 17]
  ],
  strengths: [
    'Directly addresses the question with relevant experience.',
    'Names concrete tools and responsibilities.'
  ],
  improvements: [
    'Consider one short example illustrating how the tools were used.',
    'Clarify your personal contribution without overstating ownership.'
  ],
  summary:
    'This example demonstrates how structured interview feedback appears in the dashboard.'
};

function setAuthState(authenticated) {
  signedIn = authenticated;

  loginControls.hidden = authenticated;
  logoutControls.hidden = !authenticated;

  authStatus.textContent = authenticated
    ? 'Signed in'
    : 'Not signed in';

  appStatus.textContent = authenticated
    ? 'Owner session · AI connected'
    : 'Owner access · Sign in required';

  evaluateButton.disabled = !authenticated || busy;
}

function setBusy(value) {
  busy = value;

  evaluateButton.disabled = !signedIn || value;
  loginButton.disabled = value;
  logoutButton.disabled = value;
  previewButton.disabled = value;
  clearButton.disabled = value;
}

function updateCounters() {
  document.getElementById('question-count').textContent =
    `${question.value.length.toLocaleString()} / 200`;

  document.getElementById('answer-count').textContent =
    `${answer.value.length.toLocaleString()} / 2,000`;
}

question.addEventListener('input', updateCounters);
answer.addEventListener('input', updateCounters);
updateCounters();

function renderList(id, items) {
  const list = document.getElementById(id);
  list.replaceChildren();

  for (const content of items) {
    const li = document.createElement('li');
    li.textContent = String(content);
    list.append(li);
  }
}

function renderScores(scores) {
  const dimensions = document.getElementById('dimensions');
  dimensions.replaceChildren();

  for (const [name, rawScore] of scores) {
    const score = Number(rawScore);

    const safeScore = Number.isFinite(score)
      ? Math.max(0, Math.min(20, score))
      : 0;

    const item = document.createElement('div');
    item.className = 'dimension';

    const heading = document.createElement('div');
    heading.className = 'dim-head';

    const label = document.createElement('span');
    label.textContent = name;

    const number = document.createElement('span');
    number.textContent = `${safeScore}/20`;

    heading.append(label, number);

    const track = document.createElement('div');
    track.className = 'track';

    const fill = document.createElement('div');
    fill.className = 'fill';
    fill.style.width = `${safeScore * 5}%`;

    track.append(fill);
    item.append(heading, track);
    dimensions.append(item);
  }
}

function renderReport({
  mode,
  scoreLabel,
  total,
  category,
  scores,
  strengths,
  improvements,
  summary,
  disclaimer
}) {
  document.getElementById('empty').hidden = true;
  document.getElementById('report').hidden = false;

  document.getElementById('result-mode').textContent = mode;
  document.getElementById('score-label').textContent = scoreLabel;
  document.getElementById('total').textContent = total;
  document.getElementById('category').textContent = category;

  renderScores(scores);
  renderList('strengths', strengths);
  renderList('improvements', improvements);

  document.getElementById('summary').textContent = summary;
  document.getElementById('disclaimer').textContent = disclaimer;
}

function resetReport() {
  document.getElementById('empty').hidden = false;
  document.getElementById('report').hidden = true;

  document.getElementById('result-mode').textContent =
    'Awaiting evaluation';
}

async function readResponse(response) {
  const data = await response.json().catch(() => null);

  if (!response.ok) {
    const error = new Error(
      data?.error || `Request failed (${response.status}).`
    );

    error.status = response.status;
    throw error;
  }

  return data;
}

// Check for an existing owner session when the page loads.
async function restoreSession() {
  authNotice.textContent = 'Checking existing owner session...';

  try {
    const response = await fetch('/api/session', {
      method: 'GET',
      credentials: 'same-origin',
      cache: 'no-store'
    });

    const result = await readResponse(response);

    if (result.authenticated === true) {
      setAuthState(true);

      authNotice.textContent =
        'Your existing owner session has been restored.';

      notice.textContent =
        'Ready for real Gemini evaluation.';
    } else {
      setAuthState(false);

      authNotice.textContent =
        'Sign in to enable live Gemini evaluations.';
    }
  } catch (error) {
    setAuthState(false);

    authNotice.textContent =
      `Unable to verify session: ${error.message}`;
  }
}

loginButton.addEventListener('click', async () => {
  const ownerKey = ownerKeyInput.value;

  if (!ownerKey.trim()) {
    authNotice.textContent = 'Enter your owner access key.';
    return;
  }

  setBusy(true);
  authNotice.textContent = 'Signing in...';

  try {
    const response = await fetch('/api/login', {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ ownerKey })
    });

    const result = await readResponse(response);

    if (result.success !== true) {
      throw new Error('Login was not confirmed.');
    }

    ownerKeyInput.value = '';
    setAuthState(true);

    authNotice.textContent =
      'Signed in successfully. Your session lasts up to 8 hours.';

    notice.textContent =
      'Ready for real Gemini evaluation. Enter your question and answer.';
  } catch (error) {
    setAuthState(false);
    authNotice.textContent = error.message;
  } finally {
    setBusy(false);
  }
});

logoutButton.addEventListener('click', async () => {
  setBusy(true);

  try {
    const response = await fetch('/api/logout', {
      method: 'POST',
      credentials: 'same-origin'
    });

    await readResponse(response);

    setAuthState(false);
    resetReport();

    authNotice.textContent = 'Signed out successfully.';
    notice.textContent = 'Sign in to evaluate with Gemini.';
  } catch (error) {
    authNotice.textContent =
      `Could not sign out: ${error.message}`;
  } finally {
    setBusy(false);
  }
});

previewButton.addEventListener('click', () => {
  if (!question.value.trim() || !answer.value.trim()) {
    notice.textContent =
      'Please enter both a question and an answer.';
    return;
  }

  renderReport({
    mode: 'Sample results only',
    scoreLabel: 'ILLUSTRATIVE SCORE',
    total: example.scores.reduce(
      (sum, [, score]) => sum + score,
      0
    ),
    category: example.questionType,
    scores: example.scores,
    strengths: example.strengths,
    improvements: example.improvements,
    summary: example.summary,
    disclaimer:
      'Sample content only. These are not AI-generated scores for your answer.'
  });

  notice.textContent =
    'Sample preview only. No Gemini request was made.';
});

evaluateButton.addEventListener('click', async () => {
  const questionText = question.value.trim();
  const answerText = answer.value.trim();

  if (!signedIn) {
    notice.textContent =
      'Sign in before requesting AI evaluation.';
    return;
  }

  if (
    !questionText ||
    !answerText ||
    questionText.length > 200 ||
    answerText.length > 2000
  ) {
    notice.textContent =
      'Enter a question (1–200 characters) and answer (1–2000 characters).';
    return;
  }

  setBusy(true);
  notice.textContent =
    'Gemini is evaluating your answer. Please wait...';

  try {
    const response = await fetch('/api/evaluate', {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        question: questionText,
        answer: answerText
      })
    });

    const result = await readResponse(response);

    if (
      result.success !== true ||
      !result.evaluation ||
      typeof result.totalScore !== 'number'
    ) {
      throw new Error('The AI response was incomplete.');
    }

    const evaluation = result.evaluation;
    const dimensions = evaluation.scores || {};

    const scoreEntries = [
      ['Clear claim', dimensions.clearClaim?.score],
      ['Specific context', dimensions.specificContext?.score],
      ['Concrete action', dimensions.concreteAction?.score],
      ['Evidence / verification',
        dimensions.evidenceVerification?.score],
      ['Result / relevance',
        dimensions.resultRelevance?.score]
    ];

    const category = String(
      evaluation.questionType || 'Interview question'
    ).replaceAll('_', ' ');

    renderReport({
      mode: 'Live Gemini evaluation',
      scoreLabel: 'AI EVALUATION SCORE',
      total: result.totalScore,
      category,
      scores: scoreEntries,
      strengths: Array.isArray(evaluation.strengths)
        ? evaluation.strengths
        : [],
      improvements: Array.isArray(evaluation.improvements)
        ? evaluation.improvements
        : [],
      summary: evaluation.summary || '',
      disclaimer:
        'AI-generated feedback is advisory. Scores are not guarantees of interview performance.'
    });

    const remaining = result.usage?.remaining;

    notice.textContent =
      `Evaluation complete. Score: ${result.totalScore}/100.` +
      (typeof remaining === 'number'
        ? ` Daily evaluations remaining: ${remaining}.`
        : '');

  } catch (error) {
    if (error.status === 401) {
      setAuthState(false);

      authNotice.textContent =
        'Your session has expired. Please sign in again.';
    }

    notice.textContent = `Evaluation failed: ${error.message}`;
  } finally {
    setBusy(false);
  }
});

clearButton.addEventListener('click', () => {
  question.value = '';
  answer.value = '';

  updateCounters();
  resetReport();

  notice.textContent = signedIn
    ? 'Ready for your next interview question.'
    : 'Sign in to enable live Gemini evaluations.';
});

// Start with evaluation disabled until authentication is checked.
setAuthState(false);
resetReport();
restoreSession();
