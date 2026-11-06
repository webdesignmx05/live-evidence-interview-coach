'use strict';
const question = document.getElementById('question');
const answer = document.getElementById('answer');
const notice = document.getElementById('notice');
for (const [el, count, max] of [[question, 'question-count', 2000], [answer, 'answer-count', 12000]]) {
  const update = () => { document.getElementById(count).textContent = `${el.value.length.toLocaleString()} / ${max.toLocaleString()}`; };
  el.addEventListener('input', update);
  update();
}
const example = {
  questionType: 'Experience overview',
  scores: [
    ['Clear claim', 20],
    ['Specific context', 18],
    ['Concrete action', 17],
    ['Evidence / verification', 16],
    ['Result / relevance', 17]
  ],
  strengths: ['Directly addresses the question with relevant experience.', 'Names concrete tools and responsibilities.'],
  improvements: ['Consider one short example illustrating how the tools were used.', 'Clarify your personal contribution without overstating ownership.'],
  summary: 'This example shows how a concise, technically relevant experience overview might be presented in the results dashboard.'
};
document.getElementById('preview').addEventListener('click', () => {
  if (!question.value.trim() || !answer.value.trim()) {
    notice.textContent = 'Please enter both a question and an answer to preview the results layout.';
    return;
  }
  document.getElementById('empty').hidden = true;
  document.getElementById('report').hidden = false;
  document.getElementById('result-mode').textContent = 'Sample results only';
  document.getElementById('category').textContent = example.questionType;
  document.getElementById('total').textContent = example.scores.reduce((sum, [, score]) => sum + score, 0);
  const dims = document.getElementById('dimensions');
  dims.replaceChildren();
  for (const [name, score] of example.scores) {
    const item = document.createElement('div'); item.className = 'dimension';
    const heading = document.createElement('div'); heading.className = 'dim-head';
    const label = document.createElement('span'); label.textContent = name;
    const number = document.createElement('span'); number.textContent = `${score}/20`;
    heading.append(label, number);
    const track = document.createElement('div'); track.className = 'track';
    const fill = document.createElement('div'); fill.className = 'fill'; fill.style.width = `${score * 5}%`;
    track.append(fill); item.append(heading, track); dims.append(item);
  }
  for (const [id, items] of [['strengths', example.strengths], ['improvements', example.improvements]]) {
    const list = document.getElementById(id); list.replaceChildren();
    for (const content of items) { const li = document.createElement('li'); li.textContent = content; list.append(li); }
  }
  document.getElementById('summary').textContent = example.summary;
  notice.textContent = 'This is a layout preview only. Your answer has NOT been analyzed or sent anywhere.';
});
document.getElementById('clear').addEventListener('click', () => {
  question.value = ''; answer.value = '';
  question.dispatchEvent(new Event('input')); answer.dispatchEvent(new Event('input'));
  document.getElementById('empty').hidden = false;
  document.getElementById('report').hidden = true;
  document.getElementById('result-mode').textContent = 'Awaiting preview';
  notice.textContent = 'Preview mode: this page does not send answers to Gemini or any server. Scores shown are illustrative.';
});
