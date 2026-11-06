'use strict';

// Live Evidence Interview Coach
// Owner authentication, Gemini evaluation, and voice practice.

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

const micStartButton = document.getElementById('mic-start');
const micStopButton = document.getElementById('mic-stop');
const micStatus = document.getElementById('mic-status');
const micTimer = document.getElementById('mic-timer');

const MAX_QUESTION = 200;
const MAX_ANSWER = 2000;

let signedIn = false;
let busy = false;

// Microphone states:
// idle, starting, listening, stopping
let micState = 'idle';
let recognition = null;
let speechBase = '';

let timerStartedAt = null;
let timerInterval = null;
let elapsedMilliseconds = 0;

const SpeechRecognition =
  window.SpeechRecognition ||
  window.webkitSpeechRecognition;

const speechSupported = Boolean(SpeechRecognition);

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

// --------------------------------------------------
// Interface state
// --------------------------------------------------

function updateButtons() {
  const micActive = micState !== 'idle';

  evaluateButton.disabled =
    !signedIn || busy || micActive;

  loginButton.disabled = busy;
  logoutButton.disabled = busy || micActive;

  previewButton.disabled = busy || micActive;
  clearButton.disabled = busy || micActive;

  micStartButton.disabled =
    !speechSupported || busy || micActive;

  micStopButton.disabled =
    micState !== 'listening';
}

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

  updateButtons();
}

function setBusy(value) {
  busy = value;
  updateButtons();
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

// --------------------------------------------------
// Stopwatch
// --------------------------------------------------

function formatDuration(milliseconds) {
  const totalSeconds = Math.floor(milliseconds / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  return (
    String(minutes).padStart(2, '0') +
    ':' +
    String(seconds).padStart(2, '0')
  );
}

function displayTimer() {
  const duration = timerStartedAt === null
    ? elapsedMilliseconds
    : elapsedMilliseconds +
      (performance.now() - timerStartedAt);

  micTimer.textContent = formatDuration(duration);
}

function startTimer() {
  clearInterval(timerInterval);

  elapsedMilliseconds = 0;
  timerStartedAt = performance.now();

  displayTimer();

  timerInterval = setInterval(displayTimer, 250);
}

function stopTimer() {
  if (timerStartedAt !== null) {
    elapsedMilliseconds +=
      performance.now() - timerStartedAt;

    timerStartedAt = null;
  }

  clearInterval(timerInterval);
  timerInterval = null;

  displayTimer();
}

function resetTimer() {
  clearInterval(timerInterval);
  timerInterval = null;

  timerStartedAt = null;
  elapsedMilliseconds = 0;

  displayTimer();
}

// --------------------------------------------------
// Evaluation dashboard
// --------------------------------------------------

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

// --------------------------------------------------
// Owner session restoration
// --------------------------------------------------

async function restoreSession() {
  authNotice.textContent =
    'Checking existing owner session...';

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

// --------------------------------------------------
// Owner login
// --------------------------------------------------

loginButton.addEventListener('click', async () => {
  const ownerKey = ownerKeyInput.value;

  if (!ownerKey.trim()) {
    authNotice.textContent =
      'Enter your owner access key.';
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
      'Ready for real Gemini evaluation.';
  } catch (error) {
    setAuthState(false);
    authNotice.textContent = error.message;
  } finally {
    setBusy(false);
  }
});

// --------------------------------------------------
// Owner logout
// --------------------------------------------------

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

    authNotice.textContent =
      'Signed out successfully.';

    notice.textContent =
      'Sign in to evaluate with Gemini.';
  } catch (error) {
    authNotice.textContent =
      `Could not sign out: ${error.message}`;
  } finally {
    setBusy(false);
  }
});

// --------------------------------------------------
// Microphone transcription
// --------------------------------------------------

function setMicStatus(message) {
  micStatus.textContent = message;
}

function stopMicrophone() {
  if (
    !recognition ||
    (micState !== 'listening' &&
     micState !== 'starting')
  ) {
    return;
  }

  micState = 'stopping';
  updateButtons();

  setMicStatus(
    'Processing speech... Waiting for the final transcript.'
  );

  try {
    recognition.stop();
  } catch (error) {
    console.error('Microphone stop failed:', error);

    stopTimer();
    micState = 'idle';
    updateButtons();

    setMicStatus(
      'Unable to stop normally. Review your transcript.'
    );
  }
}

if (speechSupported) {
  recognition = new SpeechRecognition();

  recognition.lang = 'en-US';
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.maxAlternatives = 1;

  recognition.onstart = () => {
    if (micState !== 'starting') {
      return;
    }

    micState = 'listening';
    startTimer();
    updateButtons();

    setMicStatus('Listening — speak now.');
  };

  recognition.onresult = (event) => {
    let finalText = '';
    let interimText = '';

    for (let i = 0; i < event.results.length; i++) {
      const result = event.results[i];
      const transcript = result[0]?.transcript || '';

      if (result.isFinal) {
        finalText += transcript + ' ';
      } else {
        interimText += transcript + ' ';
      }
    }

    const spokenText =
      `${finalText} ${interimText}`.trim();

    const combined =
      [speechBase, spokenText]
        .filter(Boolean)
        .join(' ')
        .trim();

    if (combined.length > MAX_ANSWER) {
      answer.value = combined.slice(0, MAX_ANSWER);
      updateCounters();

      setMicStatus(
        'The 2,000-character limit was reached. Recording stopped.'
      );

      stopMicrophone();
      return;
    }

    answer.value = combined;
    updateCounters();
  };

  recognition.onerror = (event) => {
    const messages = {
      'not-allowed':
        'Microphone permission was denied. Check Chrome site permissions.',
      'service-not-allowed':
        'Speech recognition is blocked by browser settings.',
      'no-speech':
        'No speech was detected. Try again when ready.',
      'audio-capture':
        'No working microphone was detected.',
      'network':
        'Speech recognition encountered a network error.',
      'aborted':
        'Speech recognition was interrupted.'
    };

    setMicStatus(
      messages[event.error] ||
      `Speech recognition error: ${event.error}`
    );
  };

  recognition.onend = () => {
    stopTimer();

    micState = 'idle';
    updateButtons();

    if (
      micStatus.textContent.startsWith('Listening') ||
      micStatus.textContent.startsWith('Processing')
    ) {
      setMicStatus(
        'Recording stopped. Duration: ' +
        formatDuration(elapsedMilliseconds) +
        '. Review and edit your transcript before evaluating.'
      );
    }
  };

  micStartButton.addEventListener('click', () => {
    if (busy || micState !== 'idle') {
      return;
    }

    speechBase = answer.value.trim();

    micState = 'starting';
    resetTimer();
    updateButtons();

    setMicStatus('Starting microphone... Please wait.');

    try {
      recognition.start();
    } catch (error) {
      micState = 'idle';
      updateButtons();

      setMicStatus(
        `Unable to start microphone: ${error.message}`
      );
    }
  });

  micStopButton.addEventListener('click', () => {
    stopMicrophone();
  });

  setMicStatus(
    'Microphone available. Click Start microphone to dictate your answer.'
  );
} else {
  setMicStatus(
    'Speech recognition is not supported in this browser. Typed answers remain available.'
  );
}

// --------------------------------------------------
// Sample preview (no Gemini usage)
// --------------------------------------------------

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

// --------------------------------------------------
// Live Gemini evaluation
// --------------------------------------------------

evaluateButton.addEventListener('click', async () => {
  const questionText = question.value.trim();
  const answerText = answer.value.trim();

  if (!signedIn) {
    notice.textContent =
      'Sign in before requesting AI evaluation.';
    return;
  }

  if (micState !== 'idle') {
    notice.textContent =
      'Stop the microphone and review your transcript first.';
    return;
  }

  if (
    !questionText ||
    !answerText ||
    questionText.length > MAX_QUESTION ||
    answerText.length > MAX_ANSWER
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
      [
        'Evidence / verification',
        dimensions.evidenceVerification?.score
      ],
      [
        'Result / relevance',
        dimensions.resultRelevance?.score
      ]
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

    notice.textContent =
      `Evaluation failed: ${error.message}`;
  } finally {
    setBusy(false);
  }
});

// --------------------------------------------------
// Clear practice
// --------------------------------------------------

clearButton.addEventListener('click', () => {
  question.value = '';
  answer.value = '';

  updateCounters();
  resetReport();
  resetTimer();

  setMicStatus(
    speechSupported
      ? 'Microphone available. Click Start microphone to dictate your answer.'
      : 'Speech recognition is not supported in this browser.'
  );

  notice.textContent = signedIn
    ? 'Ready for your next interview question.'
    : 'Sign in to enable live Gemini evaluations.';
});

// --------------------------------------------------
// Startup
// --------------------------------------------------

resetTimer();
setAuthState(false);
resetReport();
restoreSession();
