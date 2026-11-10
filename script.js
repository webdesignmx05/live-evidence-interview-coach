'use strict';

// Live Evidence Interview Coach — Question Library + existing practice features.
const question = document.getElementById('question');
const answer = document.getElementById('answer');
const notice = document.getElementById('notice');
const evaluateButton = document.getElementById('evaluate');
const suggestButton = document.getElementById('suggest-answer');
const hideSuggestionButton = document.getElementById('hide-suggestion');
const suggestionStatus = document.getElementById('suggestion-status');
const suggestionResult = document.getElementById('suggestion-result');
const suggestionText = document.getElementById('suggestion-text');
const suggestionPoints = document.getElementById('suggestion-points');
const suggestionCaution = document.getElementById('suggestion-caution');
let suggestionForQuestion = null;
let suggestionData = null;
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
let micState = 'idle';
let recognition = null;
let speechBase = '';
let timerStartedAt = null;
let timerInterval = null;
let elapsedMilliseconds = 0;
const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
const speechSupported = Boolean(SpeechRecognition);
const example = {
  questionType: 'Experience overview',
  scores: [['Clear claim',20],['Specific context',18],['Concrete action',17],['Evidence / verification',16],['Result / relevance',17]],
  strengths: ['Directly addresses the question with relevant experience.','Names concrete tools and responsibilities.'],
  improvements: ['Consider one short example illustrating how the tools were used.','Clarify your personal contribution without overstating ownership.'],
  summary: 'This example demonstrates how structured interview feedback appears in the dashboard.'
};

function updateButtons() {
  const micActive = micState !== 'idle';
  evaluateButton.disabled = !signedIn || busy || micActive;
  suggestButton.disabled = !signedIn || busy || micActive || !question.value.trim();
  loginButton.disabled = busy;
  logoutButton.disabled = busy || micActive;
  previewButton.disabled = busy || micActive;
  clearButton.disabled = busy || micActive;
  micStartButton.disabled = !speechSupported || busy || micActive;
  micStopButton.disabled = micState !== 'listening';
  updateLibraryButtons();
  updateAnalyzerButton();
}
function setAuthState(authenticated) {
  signedIn = authenticated;
  loginControls.hidden = authenticated;
  logoutControls.hidden = !authenticated;
  authStatus.textContent = authenticated ? 'Signed in' : 'Not signed in';
  appStatus.textContent = authenticated ? 'Owner session · AI connected' : 'Owner access · Sign in required';
  updateButtons();
  if (!authenticated) resetSuggestion();
}
function setBusy(value) { busy = value; updateButtons(); }
function updateCounters() {
  document.getElementById('question-count').textContent = `${question.value.length.toLocaleString()} / 200`;
  document.getElementById('answer-count').textContent = `${answer.value.length.toLocaleString()} / 2,000`;
}
function resetSuggestion() {
  suggestionForQuestion = null;
  suggestionData = null;
  suggestionResult.hidden = true;
  hideSuggestionButton.hidden = true;
  suggestButton.textContent = 'Show Suggested Answer';
  suggestionStatus.textContent = signedIn ? 'Request a reference answer when you are ready.' : 'Sign in to request a reference answer.';
  updateButtons();
}
function syncSuggestionToQuestion() {
  if (suggestionForQuestion !== null && question.value.trim() !== suggestionForQuestion) resetSuggestion();
  updateCounters();
  updateButtons();
}
question.addEventListener('input', syncSuggestionToQuestion);
answer.addEventListener('input', updateCounters);
updateCounters();

function formatDuration(milliseconds) {
  const totalSeconds = Math.floor(milliseconds / 1000);
  return `${String(Math.floor(totalSeconds / 60)).padStart(2,'0')}:${String(totalSeconds % 60).padStart(2,'0')}`;
}
function displayTimer() {
  const duration = timerStartedAt === null ? elapsedMilliseconds : elapsedMilliseconds + (performance.now() - timerStartedAt);
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
    elapsedMilliseconds += performance.now() - timerStartedAt;
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
    const safeScore = Number.isFinite(score) ? Math.max(0, Math.min(20, score)) : 0;
    const item = document.createElement('div'); item.className = 'dimension';
    const heading = document.createElement('div'); heading.className = 'dim-head';
    const label = document.createElement('span'); label.textContent = name;
    const number = document.createElement('span'); number.textContent = `${safeScore}/20`;
    heading.append(label, number);
    const track = document.createElement('div'); track.className = 'track';
    const fill = document.createElement('div'); fill.className = 'fill'; fill.style.width = `${safeScore * 5}%`;
    track.append(fill); item.append(heading, track); dimensions.append(item);
  }
}
function renderReport({mode, scoreLabel, total, category, scores, strengths, improvements, summary, disclaimer}) {
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
  document.getElementById('result-mode').textContent = 'Awaiting evaluation';
}
async function readResponse(response) {
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const error = new Error(data?.error || `Request failed (${response.status}).`);
    error.status = response.status;
    throw error;
  }
  return data;
}

async function restoreSession() {
  authNotice.textContent = 'Checking existing owner session...';
  try {
    const response = await fetch('/api/session', {method:'GET',credentials:'same-origin',cache:'no-store'});
    const result = await readResponse(response);
    if (result.authenticated === true) {
      setAuthState(true);
      authNotice.textContent = 'Your existing owner session has been restored.';
      notice.textContent = 'Ready for real Gemini evaluation.';
    } else {
      setAuthState(false);
      authNotice.textContent = 'Sign in to enable live Gemini evaluations.';
    }
  } catch (error) {
    setAuthState(false);
    authNotice.textContent = `Unable to verify session: ${error.message}`;
  }
}
loginButton.addEventListener('click', async () => {
  const ownerKey = ownerKeyInput.value;
  if (!ownerKey.trim()) { authNotice.textContent = 'Enter your owner access key.'; return; }
  setBusy(true); authNotice.textContent = 'Signing in...';
  try {
    const response = await fetch('/api/login', {method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({ownerKey})});
    const result = await readResponse(response);
    if (result.success !== true) throw new Error('Login was not confirmed.');
    ownerKeyInput.value = '';
    setAuthState(true);
    authNotice.textContent = 'Signed in successfully. Your session lasts up to 8 hours.';
    notice.textContent = 'Ready for real Gemini evaluation.';
  } catch (error) {
    setAuthState(false); authNotice.textContent = error.message;
  } finally { setBusy(false); }
});
logoutButton.addEventListener('click', async () => {
  setBusy(true);
  try {
    const response = await fetch('/api/logout', {method:'POST',credentials:'same-origin'});
    await readResponse(response);
    setAuthState(false); resetReport();
    authNotice.textContent = 'Signed out successfully.';
    notice.textContent = 'Sign in to evaluate with Gemini.';
  } catch (error) {
    authNotice.textContent = `Could not sign out: ${error.message}`;
  } finally { setBusy(false); }
});

function setMicStatus(message) { micStatus.textContent = message; }
function stopMicrophone() {
  if (!recognition || (micState !== 'listening' && micState !== 'starting')) return;
  micState = 'stopping'; updateButtons();
  setMicStatus('Processing speech... Waiting for the final transcript.');
  try { recognition.stop(); }
  catch (error) {
    console.error('Microphone stop failed:', error);
    stopTimer(); micState = 'idle'; updateButtons();
    setMicStatus('Unable to stop normally. Review your transcript.');
  }
}
if (speechSupported) {
  recognition = new SpeechRecognition();
  recognition.lang = 'en-US'; recognition.continuous = true;
  recognition.interimResults = true; recognition.maxAlternatives = 1;
  recognition.onstart = () => {
    if (micState !== 'starting') return;
    micState = 'listening'; startTimer(); updateButtons();
    setMicStatus('Listening — speak now.');
  };
  recognition.onresult = (event) => {
    let finalText = '', interimText = '';
    for (let i = 0; i < event.results.length; i++) {
      const result = event.results[i]; const transcript = result[0]?.transcript || '';
      if (result.isFinal) finalText += transcript + ' ';
      else interimText += transcript + ' ';
    }
    const spokenText = `${finalText} ${interimText}`.trim();
    const combined = [speechBase,spokenText].filter(Boolean).join(' ').trim();
    if (combined.length > MAX_ANSWER) {
      answer.value = combined.slice(0,MAX_ANSWER); updateCounters();
      setMicStatus('The 2,000-character limit was reached. Recording stopped.');
      stopMicrophone(); return;
    }
    answer.value = combined; updateCounters();
  };
  recognition.onerror = (event) => {
    const messages = {
      'not-allowed':'Microphone permission was denied. Check Chrome site permissions.',
      'service-not-allowed':'Speech recognition is blocked by browser settings.',
      'no-speech':'No speech was detected. Try again when ready.',
      'audio-capture':'No working microphone was detected.',
      'network':'Speech recognition encountered a network error.',
      'aborted':'Speech recognition was interrupted.'
    };
    setMicStatus(messages[event.error] || `Speech recognition error: ${event.error}`);
  };
  recognition.onend = () => {
    stopTimer(); micState = 'idle'; updateButtons();
    if (micStatus.textContent.startsWith('Listening') || micStatus.textContent.startsWith('Processing')) {
      setMicStatus('Recording stopped. Duration: ' + formatDuration(elapsedMilliseconds) + '. Review and edit your transcript before evaluating.');
    }
  };
  micStartButton.addEventListener('click', () => {
    if (busy || micState !== 'idle') return;
    speechBase = answer.value.trim(); micState = 'starting'; resetTimer(); updateButtons();
    setMicStatus('Starting microphone... Please wait.');
    try { recognition.start(); }
    catch (error) {
      micState = 'idle'; updateButtons();
      setMicStatus(`Unable to start microphone: ${error.message}`);
    }
  });
  micStopButton.addEventListener('click', stopMicrophone);
  setMicStatus('Microphone available. Click Start microphone to dictate your answer.');
} else {
  setMicStatus('Speech recognition is not supported in this browser. Typed answers remain available.');
}

previewButton.addEventListener('click', () => {
  if (!question.value.trim() || !answer.value.trim()) {
    notice.textContent = 'Please enter both a question and an answer.'; return;
  }
  renderReport({
    mode:'Sample results only',scoreLabel:'ILLUSTRATIVE SCORE',
    total:example.scores.reduce((sum,[,score])=>sum+score,0),
    category:example.questionType,scores:example.scores,
    strengths:example.strengths,improvements:example.improvements,
    summary:example.summary,
    disclaimer:'Sample content only. These are not AI-generated scores for your answer.'
  });
  notice.textContent = 'Sample preview only. No Gemini request was made.';
});
evaluateButton.addEventListener('click', async () => {
  const questionText = question.value.trim();
  const answerText = answer.value.trim();
  if (!signedIn) { notice.textContent = 'Sign in before requesting AI evaluation.'; return; }
  if (micState !== 'idle') { notice.textContent = 'Stop the microphone and review your transcript first.'; return; }
  if (!questionText || !answerText || questionText.length > MAX_QUESTION || answerText.length > MAX_ANSWER) {
    notice.textContent = 'Enter a question (1–200 characters) and answer (1–2000 characters).'; return;
  }
  setBusy(true);
  notice.textContent = 'Gemini is evaluating your answer. Please wait...';
  try {
    const response = await fetch('/api/evaluate', {
      method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({question:questionText,answer:answerText})
    });
    const result = await readResponse(response);
    if (result.success !== true || !result.evaluation || typeof result.totalScore !== 'number') {
      throw new Error('The AI response was incomplete.');
    }
    const evaluation = result.evaluation;
    const dimensions = evaluation.scores || {};
    const scoreEntries = [
      ['Clear claim',dimensions.clearClaim?.score],
      ['Specific context',dimensions.specificContext?.score],
      ['Concrete action',dimensions.concreteAction?.score],
      ['Evidence / verification',dimensions.evidenceVerification?.score],
      ['Result / relevance',dimensions.resultRelevance?.score]
    ];
    const category = String(evaluation.questionType || 'Interview question').replaceAll('_',' ');
    renderReport({
      mode:'Live Gemini evaluation',scoreLabel:'AI EVALUATION SCORE',total:result.totalScore,
      category,scores:scoreEntries,
      strengths:Array.isArray(evaluation.strengths) ? evaluation.strengths : [],
      improvements:Array.isArray(evaluation.improvements) ? evaluation.improvements : [],
      summary:evaluation.summary || '',
      disclaimer:'AI-generated feedback is advisory. Scores are not guarantees of interview performance.'
    });
    const remaining = result.usage?.remaining;
    notice.textContent = `Evaluation complete. Score: ${result.totalScore}/100.` +
      (typeof remaining === 'number' ? ` Daily evaluations remaining: ${remaining}.` : '');
  } catch (error) {
    if (error.status === 401) {
      setAuthState(false);
      authNotice.textContent = 'Your session has expired. Please sign in again.';
    }
    notice.textContent = `Evaluation failed: ${error.message}`;
  } finally { setBusy(false); }
});
suggestButton.addEventListener('click', async () => {
  const currentQuestion = question.value.trim();
  if (!signedIn || busy || micState !== 'idle' || !currentQuestion) return;
  if (suggestionData && suggestionForQuestion === currentQuestion) {
    suggestionResult.hidden = false;
    hideSuggestionButton.hidden = false;
    suggestButton.textContent = 'Show Suggested Answer';
    suggestionStatus.textContent = 'Showing previously generated answer. No new AI request made.';
    return;
  }
  setBusy(true);
  suggestionStatus.textContent = 'Gemini is preparing a reference answer...';
  try {
    const response = await fetch('/api/suggest-answer', {
      method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({question:currentQuestion})
    });
    const result = await readResponse(response);
    const data = result.suggestion;
    if (result.success !== true || !data || typeof data.suggestedAnswer !== 'string' ||
        !Array.isArray(data.keyPoints)) throw new Error('The AI response was incomplete.');
    // Do not display a stale response if the question changed while waiting.
    if (question.value.trim() !== currentQuestion) {
      suggestionStatus.textContent = 'Question changed; previous suggestion discarded.';
      return;
    }
    suggestionForQuestion = currentQuestion;
    suggestionData = data;
    suggestionText.textContent = data.suggestedAnswer;
    suggestionPoints.replaceChildren();
    data.keyPoints.forEach(point => {
      const li = document.createElement('li');
      li.textContent = point;
      suggestionPoints.appendChild(li);
    });
    suggestionCaution.textContent = data.caution ? `Check before using: ${data.caution}` : '';
    suggestionCaution.hidden = !data.caution;
    suggestionResult.hidden = false;
    hideSuggestionButton.hidden = false;
    const remaining = result.usage?.remaining;
    suggestionStatus.textContent = 'Suggested answer ready.' +
      (typeof remaining === 'number' ? ` Shared daily AI requests remaining: ${remaining}.` : '');
  } catch (error) {
    if (error.status === 401) {
      setAuthState(false);
      authNotice.textContent = 'Your session has expired. Please sign in again.';
    }
    suggestionStatus.textContent = `Suggested answer failed: ${error.message}`;
  } finally { setBusy(false); }
});
hideSuggestionButton.addEventListener('click', () => {
  suggestionResult.hidden = true;
  hideSuggestionButton.hidden = true;
  suggestionStatus.textContent = 'Answer hidden. Show it again without another AI request.';
});

clearButton.addEventListener('click', () => {
  question.value = ''; answer.value = '';
  resetSuggestion();
  updateCounters(); resetReport(); resetTimer();
  setMicStatus(speechSupported ?
    'Microphone available. Click Start microphone to dictate your answer.' :
    'Speech recognition is not supported in this browser.');
  notice.textContent = signedIn ? 'Ready for your next interview question.' : 'Sign in to enable live Gemini evaluations.';
});

// --------------------------------------------------
// Question Library — no owner login or AI request required
// --------------------------------------------------
const libraryPack = document.getElementById('library-pack');
const libraryCategory = document.getElementById('library-category');
const libraryCount = document.getElementById('library-count');
const libraryQuestionText = document.getElementById('library-question-text');
const libraryQuestionMeta = document.getElementById('library-question-meta');
const libraryStatus = document.getElementById('library-status');
const libraryRandom = document.getElementById('library-random');
const libraryNext = document.getElementById('library-next');
const libraryLoad = document.getElementById('library-load');
const libraryImportFile = document.getElementById('library-import-file');
const libraryImport = document.getElementById('library-import');
const libraryExport = document.getElementById('library-export');
const LIBRARY_STORAGE_KEY = 'leic-question-packs-v1';
const MAX_IMPORT_BYTES = 1024 * 1024;
const MAX_PACK_QUESTIONS = 500;
const MAX_SAVED_PACKS = 25;
const STARTER_PACK_ID = 'general-interview-starter-v1';
let packs = [];
let currentQuestionId = null;
let libraryReady = false;
let storageAvailable = true;

function libraryMessage(message) { libraryStatus.textContent = message; }
function normalizedQuestion(text) { return text.toLocaleLowerCase('en-US').replace(/\s+/g,' ').trim(); }
function validatePack(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('JSON must contain a question pack object.');
  if (value.schemaVersion !== 1) throw new Error('Unsupported schemaVersion. Expected 1.');
  if (typeof value.packId !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{2,99}$/.test(value.packId)) {
    throw new Error('packId must be 3–100 characters using letters, numbers, hyphens, or underscores.');
  }
  if (typeof value.title !== 'string' || !value.title.trim() || value.title.length > 120) throw new Error('Pack title must be 1–120 characters.');
  if (value.company != null && (typeof value.company !== 'string' || value.company.length > 120)) throw new Error('Invalid company.');
  if (value.jobTitle != null && (typeof value.jobTitle !== 'string' || value.jobTitle.length > 120)) throw new Error('Invalid jobTitle.');
  if (!Array.isArray(value.questions) || value.questions.length === 0 || value.questions.length > MAX_PACK_QUESTIONS) {
    throw new Error(`Pack must contain 1–${MAX_PACK_QUESTIONS} questions.`);
  }
  const ids = new Set(), texts = new Set(), cleanQuestions = [];
  for (let i = 0; i < value.questions.length; i++) {
    const q = value.questions[i];
    if (!q || typeof q !== 'object' || Array.isArray(q)) throw new Error(`Question ${i + 1} is invalid.`);
    if (typeof q.id !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,99}$/.test(q.id)) throw new Error(`Question ${i + 1} has an invalid id.`);
    if (typeof q.question !== 'string' || !q.question.trim() || q.question.length > MAX_QUESTION) throw new Error(`Question ${i + 1} must be 1–200 characters.`);
    if (typeof q.category !== 'string' || !q.category.trim() || q.category.length > 60) throw new Error(`Question ${i + 1} has an invalid category.`);
    if (q.difficulty != null && !['beginner','intermediate','advanced','stretch'].includes(q.difficulty)) throw new Error(`Question ${i + 1} has an invalid difficulty.`);
    if (q.focus != null && (typeof q.focus !== 'string' || q.focus.length > 300)) throw new Error(`Question ${i + 1} has an invalid focus.`);
    if (q.requirement != null && (typeof q.requirement !== 'string' || q.requirement.length > 300)) throw new Error(`Question ${i + 1} has an invalid requirement.`);
    const normalized = normalizedQuestion(q.question);
    if (ids.has(q.id) || texts.has(normalized)) throw new Error(`Question ${i + 1} duplicates an id or question within this pack.`);
    ids.add(q.id); texts.add(normalized);
    cleanQuestions.push({id:q.id,category:q.category.trim(),difficulty:q.difficulty || 'intermediate',question:q.question.trim(),
      ...(typeof q.focus === 'string' ? {focus:q.focus} : {}),
      ...(typeof q.requirement === 'string' ? {requirement:q.requirement} : {})});
  }
  return {schemaVersion:1,packId:value.packId,title:value.title.trim(),company:value.company || null,jobTitle:value.jobTitle || null,questions:cleanQuestions};
}
function readSavedPacks() {
  try {
    const raw = localStorage.getItem(LIBRARY_STORAGE_KEY);
    if (!raw) return [];
    const data = JSON.parse(raw);
    if (!Array.isArray(data)) throw new Error('Saved library format is invalid.');
    return data.slice(0,MAX_SAVED_PACKS).map(validatePack).filter(p=>p.packId !== STARTER_PACK_ID);
  } catch (error) {
    storageAvailable = false;
    libraryMessage('Saved packs could not be read. You can still use the starter bank and export packs.');
    console.warn('Question Library storage read failed:',error);
    return [];
  }
}
function saveImportedPacks() {
  try {
    localStorage.setItem(LIBRARY_STORAGE_KEY,JSON.stringify(packs.filter(p=>p.packId !== STARTER_PACK_ID)));
    storageAvailable = true;
    return true;
  } catch (error) {
    console.warn('Question Library storage write failed:',error);
    storageAvailable = false;
    return false;
  }
}
function currentPack() { return packs.find(p=>p.packId === libraryPack.value) || null; }
function filteredQuestions() {
  const pack = currentPack();
  if (!pack) return [];
  return pack.questions.filter(q=>libraryCategory.value === 'all' || q.category === libraryCategory.value);
}
function selectedQuestion() { return filteredQuestions().find(q=>q.id === currentQuestionId) || null; }
function updateLibraryButtons() {
  if (!libraryRandom) return;
  const hasQuestions = filteredQuestions().length > 0;
  const canInteract = libraryReady && !busy && micState === 'idle';
  libraryRandom.disabled = !canInteract || !hasQuestions;
  libraryNext.disabled = !canInteract || !hasQuestions;
  libraryLoad.disabled = !canInteract || !selectedQuestion();
  libraryImport.disabled = !canInteract || !libraryImportFile.files?.length;
  libraryExport.disabled = !libraryReady || !currentPack();
}
function refreshLibraryQuestion() {
  const list = filteredQuestions();
  const selected = selectedQuestion();
  libraryCount.textContent = `${list.length} question${list.length === 1 ? '' : 's'}`;
  libraryQuestionText.textContent = selected ? selected.question : (list.length ? 'Choose Surprise Me or Next Question to begin.' : 'No questions in this category.');
  libraryQuestionMeta.textContent = selected ? `${selected.category} · ${selected.difficulty}` : 'No question selected';
  updateLibraryButtons();
}
function refreshCategories() {
  const pack = currentPack();
  const previous = libraryCategory.value;
  const categories = pack ? [...new Set(pack.questions.map(q=>q.category))].sort((a,b)=>a.localeCompare(b)) : [];
  libraryCategory.replaceChildren(new Option('All categories','all'));
  for (const category of categories) libraryCategory.add(new Option(category,category));
  libraryCategory.value = categories.includes(previous) ? previous : 'all';
  currentQuestionId = null;
  refreshLibraryQuestion();
}
function refreshPackOptions(preferredId) {
  const current = preferredId || libraryPack.value;
  libraryPack.replaceChildren();
  for (const pack of packs) libraryPack.add(new Option(`${pack.title} (${pack.questions.length})`,pack.packId));
  if (packs.some(p=>p.packId === current)) libraryPack.value = current;
  else if (packs.length) libraryPack.value = packs[0].packId;
  refreshCategories();
}
function chooseQuestion(random) {
  const list = filteredQuestions();
  if (!list.length) return;
  const currentIndex = list.findIndex(q=>q.id === currentQuestionId);
  let nextIndex;
  if (random && list.length > 1) {
    const offset = 1 + Math.floor(Math.random() * (list.length - 1));
    nextIndex = currentIndex < 0 ? Math.floor(Math.random() * list.length) : (currentIndex + offset) % list.length;
  } else nextIndex = (currentIndex + 1) % list.length;
  currentQuestionId = list[nextIndex].id;
  refreshLibraryQuestion();
  libraryMessage(`Selected question ${nextIndex + 1} of ${list.length}. Click Load into Practice to use it.`);
}
libraryPack.addEventListener('change',()=>{ refreshCategories(); libraryMessage('Collection selected. Choose a question to practice.'); });
libraryCategory.addEventListener('change',()=>{ currentQuestionId = null; refreshLibraryQuestion(); libraryMessage('Category filter updated.'); });
libraryRandom.addEventListener('click',()=>chooseQuestion(true));
libraryNext.addEventListener('click',()=>chooseQuestion(false));
libraryLoad.addEventListener('click',()=>{
  const selected = selectedQuestion();
  if (!selected || busy || micState !== 'idle') return;
  const replacing = question.value.trim() !== '' || answer.value.trim() !== '';
  if (replacing && !window.confirm('Load this question? Your current practice question and answer will be cleared.')) return;
  question.value = selected.question;
  resetSuggestion();
  answer.value = '';
  updateCounters(); resetReport(); resetTimer();
  notice.textContent = signedIn ? 'Question loaded. Practice your answer, then evaluate with AI.' : 'Question loaded. Sign in when you are ready for a Gemini evaluation.';
  libraryMessage('Question loaded into Practice.');
  question.scrollIntoView({behavior:'smooth',block:'center'});
  answer.focus({preventScroll:true});
});
libraryImportFile.addEventListener('change',updateLibraryButtons);
libraryImport.addEventListener('click',async()=>{
  const file = libraryImportFile.files?.[0];
  if (!file || busy || micState !== 'idle') return;
  if (file.size > MAX_IMPORT_BYTES) { libraryMessage('File is too large. Maximum size: 1 MB.'); return; }
  try {
    const imported = validatePack(JSON.parse(await file.text()));
    if (imported.packId === STARTER_PACK_ID) throw new Error('The built-in starter collection cannot be replaced.');
    if (packs.some(p=>p.packId === imported.packId)) throw new Error('A collection with this packId already exists. Use a different packId.');
    if (packs.length - 1 >= MAX_SAVED_PACKS) throw new Error(`Maximum of ${MAX_SAVED_PACKS} imported packs reached.`);
    const knownTexts = new Set(packs.flatMap(p=>p.questions.map(q=>normalizedQuestion(q.question))));
    const unique = imported.questions.filter(q=>!knownTexts.has(normalizedQuestion(q.question)));
    const skipped = imported.questions.length - unique.length;
    if (!unique.length) throw new Error('Every question duplicates an existing question. Nothing was imported.');
    imported.questions = unique;
    packs.push(imported);
    const saved = saveImportedPacks();
    refreshPackOptions(imported.packId);
    libraryMessage(`Imported ${unique.length} questions; skipped ${skipped} duplicate${skipped === 1 ? '' : 's'}. ${saved ? 'Saved in this browser.' : 'Browser storage unavailable: export this pack now to keep it.'}`);
    libraryImportFile.value = '';
    updateLibraryButtons();
  } catch (error) { libraryMessage(`Import failed: ${error.message}`); }
});
libraryExport.addEventListener('click',()=>{
  const pack = currentPack(); if (!pack) return;
  const blob = new Blob([JSON.stringify(pack,null,2)],{type:'application/json'});
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `${pack.packId}.json`;
  document.body.append(anchor); anchor.click(); anchor.remove();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
  libraryMessage(`Export requested: ${anchor.download}. Check your browser downloads.`);
});
async function initializeLibrary() {
  libraryMessage('Loading starter questions...');
  try {
    const response = await fetch('./questions.json',{cache:'no-store'});
    if (!response.ok) throw new Error(`Starter question file unavailable (HTTP ${response.status}).`);
    const starter = validatePack(await response.json());
    if (starter.packId !== STARTER_PACK_ID) throw new Error('Unexpected starter pack ID.');
    packs = [starter,...readSavedPacks()];
    libraryReady = true;
    refreshPackOptions(STARTER_PACK_ID);
    libraryMessage(`Ready: ${starter.questions.length} starter questions in ${new Set(starter.questions.map(q=>q.category)).size} categories. Imported packs are stored in this browser only.`);
  } catch (error) {
    libraryReady = false;
    libraryCount.textContent = 'Unavailable';
    libraryPack.replaceChildren(new Option('Unable to load collections',''));
    libraryMessage(`Could not load Question Library: ${error.message}`);
    updateLibraryButtons();
  }
}

// Job Description Analyzer: owner-only Gemini job-fit assessment.
const analyzerCompany = document.getElementById('analyzer-company');
const analyzerRole = document.getElementById('analyzer-role');
const analyzerDescription = document.getElementById('analyzer-description');
const analyzerCount = document.getElementById('analyzer-count');
const analyzerClear = document.getElementById('analyzer-clear');
const analyzerRun = document.getElementById('analyzer-run');
const generatorRun = document.getElementById('generator-run');
const generatorResult = document.getElementById('generator-result');
const generatorStatus = document.getElementById('generator-status');
let generatedPack = null;
const analyzerStatus = document.getElementById('analyzer-status');
const analyzerResult = document.getElementById('analyzer-result');

function updateAnalyzerButton() {
  if (!analyzerRun) return;
  analyzerRun.disabled = !signedIn || busy || !analyzerDescription.value.trim();
  generatorRun.disabled = analyzerRun.disabled;
}
function updateAnalyzerCount() {
  analyzerCount.textContent = `${analyzerDescription.value.length.toLocaleString()} / 20,000`;
  updateAnalyzerButton();
}
function hideAnalyzerResult() { analyzerResult.hidden = true; }
function renderAnalyzerList(id, items) {
  const target = document.getElementById(id);
  target.replaceChildren();
  if (!Array.isArray(items) || items.length === 0) {
    const li = document.createElement('li'); li.textContent = 'None identified.'; target.append(li); return;
  }
  for (const item of items) {
    const li = document.createElement('li');
    li.textContent = String(item);
    target.append(li);
  }
}
function renderAnalyzerAssessment(data) {
  document.getElementById('analyzer-decision').textContent = data.decision;
  document.getElementById('analyzer-score').textContent = `${data.fitScore}/100`;
  document.getElementById('analyzer-summary').textContent = data.summary;
  document.getElementById('analyzer-reason').textContent = data.recommendationReason;
  renderAnalyzerList('analyzer-matches', data.matchingQualifications);
  renderAnalyzerList('analyzer-gaps', data.gaps);
  renderAnalyzerList('analyzer-unknowns', data.unknowns);
  renderAnalyzerList('analyzer-constraints', data.constraints);
  analyzerResult.hidden = false;
}
for (const field of [analyzerCompany, analyzerRole, analyzerDescription]) {
  field.addEventListener('input', () => {
    updateAnalyzerCount();
    hideAnalyzerResult();
    generatorResult.hidden = true; generatedPack = null;
    analyzerStatus.textContent = 'Draft updated. Run analysis when ready.';
  });
}
analyzerClear.addEventListener('click', () => {
  if (![analyzerCompany, analyzerRole, analyzerDescription].some(field => field.value.trim())) return;
  if (!window.confirm('Clear the company, job title, and job description? This draft is not saved.')) return;
  analyzerCompany.value = ''; analyzerRole.value = ''; analyzerDescription.value = '';
  hideAnalyzerResult(); generatorResult.hidden = true; generatedPack = null; updateAnalyzerCount();
  analyzerStatus.textContent = 'Job description draft cleared.';
});
analyzerRun.addEventListener('click', async () => {
  if (!signedIn) { analyzerStatus.textContent = 'Sign in to analyze a job.'; return; }
  const jobDescription = analyzerDescription.value.trim();
  if (!jobDescription || jobDescription.length > 20000) {
    analyzerStatus.textContent = 'Enter a job description (1–20,000 characters).'; return;
  }
  setBusy(true);
  hideAnalyzerResult();
  analyzerStatus.textContent = 'Gemini is comparing the job requirements with your skills profile. Please wait...';
  try {
    const response = await fetch('/api/analyze-job', {
      method: 'POST', credentials: 'same-origin',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({company: analyzerCompany.value.trim(), jobTitle: analyzerRole.value.trim(), jobDescription})
    });
    const result = await readResponse(response);
    const assessment = result.assessment;
    if (result.success !== true || !assessment ||
        !['GO','STRETCH','PASS'].includes(assessment.decision) ||
        !Number.isInteger(assessment.fitScore)) {
      throw new Error('The AI job assessment response was incomplete.');
    }
    renderAnalyzerAssessment(assessment);
    const remaining = result.usage?.remaining;
    analyzerStatus.textContent = `Job analysis complete: ${assessment.decision} (${assessment.fitScore}/100).` +
      (typeof remaining === 'number' ? ` Daily AI requests remaining: ${remaining}.` : '');
  } catch (error) {
    if (error.status === 401) {
      setAuthState(false);
      authNotice.textContent = 'Your session has expired. Please sign in again.';
    }
    analyzerStatus.textContent = `Job analysis failed: ${error.message}`;
  } finally { setBusy(false); }
});

generatorRun.addEventListener('click', async () => {
  if (!signedIn || busy) return;
  const jobDescription = analyzerDescription.value.trim();
  if (!jobDescription || jobDescription.length > 20000) {
    analyzerStatus.textContent = 'Enter a job description (1–20,000 characters).';
    return;
  }
  generatedPack = null;
  generatorResult.hidden = true;
  setBusy(true);
  analyzerStatus.textContent = 'Gemini is generating 10 tailored questions. Please wait...';
  try {
    const response = await fetch('/api/generate-questions', {
      method: 'POST', credentials: 'same-origin',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({company:analyzerCompany.value.trim(),jobTitle:analyzerRole.value.trim(),jobDescription})
    });
    const result = await readResponse(response);
    if (result.success !== true) throw new Error('Question generation did not succeed.');
    generatedPack = validatePack(result.pack);
    if (generatedPack.questions.length !== 10) throw new Error('Expected exactly 10 questions.');
    document.getElementById('generator-title').textContent = generatedPack.title;
    const list = document.getElementById('generator-questions');
    list.replaceChildren();
    for (const item of generatedPack.questions) {
      const li = document.createElement('li');
      li.textContent = `${item.question} (${item.category} · ${item.difficulty})`;
      list.append(li);
    }
    generatorStatus.textContent = 'Review the questions, then add them to your library or download a JSON backup.';
    generatorResult.hidden = false;
    const remaining = result.usage?.remaining;
    analyzerStatus.textContent = 'Generated 10 interview questions.' +
      (typeof remaining === 'number' ? ` Daily AI requests remaining: ${remaining}.` : '');
  } catch (error) {
    if (error.status === 401) {
      setAuthState(false);
      authNotice.textContent = 'Your session has expired. Please sign in again.';
    }
    analyzerStatus.textContent = `Question generation failed: ${error.message}`;
  } finally { setBusy(false); }
});
document.getElementById('generator-add').addEventListener('click', () => {
  if (!generatedPack || !libraryReady) {
    generatorStatus.textContent = 'Question Library is not ready.';
    return;
  }
  if (packs.length - 1 >= MAX_SAVED_PACKS) {
    generatorStatus.textContent = 'Maximum imported collections reached. Download JSON instead.';
    return;
  }
  const existingTexts = new Set(packs.flatMap(p => p.questions.map(q => normalizedQuestion(q.question))));
  const unique = generatedPack.questions.filter(q => !existingTexts.has(normalizedQuestion(q.question)));
  if (!unique.length) {
    generatorStatus.textContent = 'These questions are already in the library.';
    return;
  }
  const pack = {...generatedPack, questions:unique};
  let suffix = 2;
  const baseId = pack.packId.slice(0, 90);
  while (packs.some(p => p.packId === pack.packId)) pack.packId = `${baseId}-${suffix++}`;
  packs.push(pack);
  const saved = saveImportedPacks();
  refreshPackOptions(pack.packId);
  generatorStatus.textContent = `Added ${unique.length} questions to "${pack.title}". ` +
    (saved ? 'Saved in this browser.' : 'Browser storage unavailable: download JSON now.');
  libraryMessage(`Selected "${pack.title}". Choose Next Question to begin.`);
});
document.getElementById('generator-download').addEventListener('click', () => {
  if (!generatedPack) return;
  const blob = new Blob([JSON.stringify(generatedPack,null,2)],{type:'application/json'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `${generatedPack.packId}.json`;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url),1000);
  generatorStatus.textContent = 'JSON download requested. Check your browser downloads.';
});

updateAnalyzerCount();

// Startup
resetTimer();
setAuthState(false);
resetReport();
restoreSession();
initializeLibrary();
