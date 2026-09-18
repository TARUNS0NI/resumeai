// ── Globals ──
let currentSessionId  = null;
let currentAnalysis   = null;
let currentResumeText = null;
let currentJdText     = null;
let scoreChartInst    = null;
let jobChartInst      = null;

// ── Theme ──
function initTheme() {
  const saved = localStorage.getItem('theme') || 'light';
  applyTheme(saved);
}

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem('theme', theme);
  const btnL = document.getElementById('btnLight');
  const btnD = document.getElementById('btnDark');
  if (btnL) btnL.classList.toggle('active', theme === 'light');
  if (btnD) btnD.classList.toggle('active', theme === 'dark');
  if (currentAnalysis && document.getElementById('tab-chart') && !document.getElementById('tab-chart').classList.contains('hidden')) {
    setTimeout(() => renderCharts(currentAnalysis), 100);
  }
}

// ── File / Drop ──
const fileInput  = document.getElementById('resumeFile');
const dropZone   = document.getElementById('dropZone');
const analyzeBtn = document.getElementById('analyzeBtn');
const loader     = document.getElementById('loader');
const inputSec   = document.getElementById('inputSection');
const resultsSec = document.getElementById('results');

fileInput.addEventListener('change', () => {
  if (fileInput.files[0]) showFileName(fileInput.files[0].name);
});

function showFileName(name) {
  const el   = document.getElementById('fileName');
  const text = document.getElementById('fileNameText');
  text.textContent = name;
  el.style.display = 'flex';
}

dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('active'); });
dropZone.addEventListener('dragleave', () => dropZone.classList.remove('active'));
dropZone.addEventListener('drop', e => {
  e.preventDefault(); dropZone.classList.remove('active');
  const f = e.dataTransfer.files[0];
  if (f && f.name.toLowerCase().endsWith('.pdf')) {
    fileInput.files = e.dataTransfer.files;
    showFileName(f.name);
  } else {
    showError('errorBox', 'Invalid File', 'Please drop a PDF file only.');
  }
});
dropZone.addEventListener('click', () => fileInput.click());

// ── Loader messages ──
const msgs = ['Reading your document…', 'Extracting skills & experience…', 'Running ATS compatibility check…', 'Evaluating job fit…', 'Generating personalized feedback…', 'Almost ready…'];
let mIdx = 0, mTimer;
function startThinking() {
  const el = document.getElementById('thinkingText');
  if (el) el.textContent = msgs[0];
  mTimer = setInterval(() => { mIdx = (mIdx + 1) % msgs.length; if (el) el.textContent = msgs[mIdx]; }, 2000);
}
function stopThinking() { clearInterval(mTimer); mIdx = 0; }

// ── Error System ──
function showError(boxId, title, desc, showRetry) {
  const box = document.getElementById(boxId);
  if (!box) return;
  const titleEl = box.querySelector('.err-title');
  const descEl  = box.querySelector('.err-desc') || box.querySelector(`#${boxId}Desc`);
  const retryEl = box.querySelector('.err-retry');
  if (titleEl) titleEl.textContent = title || 'Something went wrong';
  if (descEl)  descEl.textContent  = desc  || 'Please try again.';
  if (retryEl) retryEl.style.display = showRetry === false ? 'none' : 'inline-flex';
  box.style.display = 'block';
}
function hideError(boxId) { const box = document.getElementById(boxId); if (box) box.style.display = 'none'; }

function parseServerError(msg) { return { title: 'Unable to Complete', desc: msg }; }

// ── Tabs ──
function switchTab(name) {
  // Feature bar tabs
  document.querySelectorAll('.fbar-tab').forEach(t => t.classList.remove('active'));
  const fbarBtn = document.querySelector(`.fbar-tab[data-tab="${name}"]`);
  if (fbarBtn) fbarBtn.classList.add('active');

  // Sidebar nav items (analysis tools section)
  document.querySelectorAll('#featureSidebarNav .snav-item').forEach(t => t.classList.remove('active'));
  const sidebarBtn = document.querySelector(`#featureSidebarNav .snav-item[data-tab="${name}"]`);
  if (sidebarBtn) sidebarBtn.classList.add('active');

  // Panels
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.add('hidden'));
  const panel = document.getElementById('tab-' + name);
  if (panel) panel.classList.remove('hidden');

  // Update topbar breadcrumb
  const labels = { analysis: 'Analysis', chart: 'Score Charts', rewrite: 'Resume Rewriter', interview: 'Interview Prep', coverletter: 'Cover Letter', roadmap: 'Skill Roadmap', chat: 'AI Career Chat' };
  const bc = document.getElementById('topbarBreadcrumb');
  if (bc) bc.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg><span>${labels[name] || name}</span>`;

  if (name === 'chart' && currentAnalysis) renderCharts(currentAnalysis);
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// ── User Menu ──
function toggleUserMenu() {
  document.getElementById('sidebarUserMenu').classList.toggle('open');
}
document.addEventListener('click', (e) => {
  const menu = document.getElementById('sidebarUserMenu');
  const user = document.getElementById('sidebarUser');
  if (menu && user && !user.contains(e.target)) menu.classList.remove('open');
});

// ── Submit ──
async function submitForm() {
  hideError('errorBox');
  if (!fileInput.files[0]) {
    showError('errorBox', 'No File Selected', 'Please choose a PDF resume before clicking Analyze.', false);
    return;
  }
  analyzeBtn.disabled      = true;
  inputSec.style.display   = 'none';
  loader.style.display     = 'flex';
  resultsSec.style.display = 'none';
  document.getElementById('topbarResultActions').style.display = 'none';
  startThinking();

  currentJdText = document.getElementById('jdText').value;
  const fd = new FormData();
  fd.append('resume', fileInput.files[0]);
  fd.append('jd', currentJdText);

  try {
    const res  = await fetch('/analyze', { method: 'POST', body: fd });
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    stopThinking();
    currentSessionId  = data.session_id;
    currentAnalysis   = data;
    currentResumeText = data.resume_text || '';
    showResults(data);
  } catch (err) {
    stopThinking();
    loader.style.display   = 'none';
    inputSec.style.display = 'block';
    analyzeBtn.disabled    = false;
    const e = parseServerError(err.message || 'Unable to analyze resume. Please try again.');
    showError('errorBox', e.title, e.desc);
  }
}

// ── Helpers ──
function getGrade(s)      { return s >= 85 ? '🏆' : s >= 70 ? '⭐' : s >= 55 ? '📈' : '⚠️'; }
function getCaption(s)    { return s >= 85 ? 'Excellent — ready to apply!' : s >= 70 ? 'Good with room to improve' : s >= 55 ? 'Average — needs improvement' : 'Needs significant improvement'; }
function getAtsCaption(s) { return s >= 80 ? 'High ATS compatibility' : s >= 60 ? 'Moderate ATS compatibility' : 'Low ATS compatibility'; }
function getAtsBadge(s)   { return s >= 80 ? { label: 'ATS Friendly', cls: 'pass' } : s >= 60 ? { label: 'Needs Work', cls: 'warn' } : { label: 'ATS Risk', cls: 'fail' }; }

const ATS_LABELS = {
  has_contact_info: 'Contact Info Present', has_work_experience: 'Work Experience Section',
  has_education: 'Education Section', has_skills_section: 'Skills Section',
  has_measurable_achievements: 'Measurable Achievements', no_tables_or_graphics: 'No Tables / Graphics',
  proper_date_format: 'Standard Date Format', good_keyword_density: 'Good Keyword Density'
};

// ── Show Results ──
function showResults(data) {
  loader.style.display     = 'none';
  resultsSec.style.display = 'block';
  document.getElementById('topbarResultActions').style.display = 'flex';
  document.getElementById('featureSidebarSection').style.display = 'block';

  // Update topbar breadcrumb
  const bc = document.getElementById('topbarBreadcrumb');
  if (bc) bc.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg><span>Analysis</span>`;

  // Scores
  const score = data.overall_score ?? 0;
  document.getElementById('overallScore').textContent = score + '%';
  document.getElementById('scoreGrade').textContent   = getGrade(score);
  document.getElementById('scoreCaption').textContent = getCaption(score);
  setTimeout(() => { document.getElementById('overallBar').style.width = score + '%'; }, 120);

  const ats = data.ats_score ?? 0;
  document.getElementById('atsScore').textContent   = ats + '%';
  document.getElementById('atsCaption').textContent = getAtsCaption(ats);
  setTimeout(() => { document.getElementById('atsBar').style.width = ats + '%'; }, 120);
  const badge = getAtsBadge(ats);
  const badgeEl = document.getElementById('atsBadge');
  badgeEl.textContent = badge.label; badgeEl.className = 'ats-badge ' + badge.cls;

  const jdTile = document.getElementById('jdTile');
  if (data.jd_match_score !== null && data.jd_match_score !== undefined) {
    jdTile.style.opacity = '1';
    document.getElementById('jdScore').textContent = data.jd_match_score + '%';
    setTimeout(() => { document.getElementById('jdBar').style.width = data.jd_match_score + '%'; }, 120);
  } else {
    jdTile.style.opacity = '0.3';
    document.getElementById('jdScore').textContent = 'N/A';
  }

  // ATS checks
  const grid = document.getElementById('atsChecksGrid'); grid.innerHTML = '';
  const checks = data.ats_checks || {};
  Object.entries(ATS_LABELS).forEach(([key, label]) => {
    const ok = checks[key] === true;
    const d  = document.createElement('div');
    d.className = 'ats-check-item ' + (ok ? 'pass' : 'fail');
    d.innerHTML = `<div class="ats-check-icon ${ok ? 'pass' : 'fail'}">${ok ? '✓' : '✗'}</div><span class="ats-check-label">${label}</span>`;
    grid.appendChild(d);
  });
  if (data.ats_tips) { document.getElementById('atsTipsWrap').style.display = 'block'; setBullets('atsTipsList', data.ats_tips, 'orange'); }

  setPlain('summaryText', data.summary || '');
  setBullets('strengthsText',   data.strengths   || '', 'green');
  setBullets('weaknessText',    data.weaknesses  || '', 'red');
  setBullets('suggestionsText', data.suggestions || '', 'amber');

  const jdfBlock = document.getElementById('jdFeedbackBlock');
  if (data.jd_feedback) { jdfBlock.style.display = 'block'; setPlain('jdFeedbackText', data.jd_feedback); }
  else jdfBlock.style.display = 'none';

  const kw = document.getElementById('keywordTags'); kw.innerHTML = '';
  (data.ats_keywords || []).forEach(k => {
    const s = document.createElement('span'); s.className = 'kw-chip'; s.textContent = k; kw.appendChild(s);
  });

  const jml = document.getElementById('jobMatchList'); jml.innerHTML = '';
  const medals = ['🥇', '🥈', '🥉'];
  (data.job_matches || []).sort((a, b) => b.score - a.score).forEach((job, i) => {
    const d = document.createElement('div'); d.className = 'job-row';
    d.innerHTML = `<span class="job-medal">${medals[i] || (i + 1)}</span><div class="job-info"><div class="job-name">${job.role}</div><div class="job-why">${job.reason || ''}</div></div><div class="job-right"><div class="job-track"><div class="job-fill" data-w="${job.score}"></div></div><span class="job-pct">${job.score}%</span></div>`;
    jml.appendChild(d);
  });
  setTimeout(() => { document.querySelectorAll('.job-fill').forEach(b => b.style.width = b.dataset.w + '%'); }, 120);

  // Load history count for sidebar badge
  loadHistoryCount();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

async function loadHistoryCount() {
  try {
    const res  = await fetch('/history');
    const data = await res.json();
    const badge = document.getElementById('sidebarHistoryCount');
    if (badge && data.length > 0) {
      badge.textContent    = data.length;
      badge.style.display  = 'inline';
    }
  } catch(e) {}
}

// ── Charts ──
function renderCharts(data) {
  const isDark     = document.documentElement.getAttribute('data-theme') === 'dark';
  const gridColor  = isDark ? '#252a3a' : '#f0f1f3';
  const tickColor  = isDark ? '#9aa0b8' : '#8b90a0';
  const labelColor = isDark ? '#edf0f8' : '#3d4154';

  const sCtx = document.getElementById('scoreChart').getContext('2d');
  if (scoreChartInst) scoreChartInst.destroy();
  const labels = ['Overall Score', 'ATS Score'];
  const values = [data.overall_score || 0, data.ats_score || 0];
  const colors = ['rgba(108,71,201,0.85)', 'rgba(224,90,26,0.85)'];
  if (data.jd_match_score !== null && data.jd_match_score !== undefined) {
    labels.push('JD Match'); values.push(data.jd_match_score); colors.push('rgba(13,138,128,0.85)');
  }
  scoreChartInst = new Chart(sCtx, {
    type: 'bar',
    data: { labels, datasets: [{ data: values, backgroundColor: colors, borderRadius: 10, borderSkipped: false }] },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        y: { min: 0, max: 100, grid: { color: gridColor }, ticks: { color: tickColor, font: { family: 'Plus Jakarta Sans' }, callback: v => v + '%' } },
        x: { grid: { display: false }, ticks: { color: labelColor, font: { family: 'Plus Jakarta Sans', weight: '700' } } }
      }
    }
  });

  const jCtx = document.getElementById('jobChart').getContext('2d');
  if (jobChartInst) jobChartInst.destroy();
  const jobs = (data.job_matches || []).sort((a, b) => b.score - a.score).slice(0, 5);
  jobChartInst = new Chart(jCtx, {
    type: 'doughnut',
    data: { labels: jobs.map(j => j.role), datasets: [{ data: jobs.map(j => j.score), backgroundColor: ['#6c47c9','#0d8a80','#e05a1a','#2563eb','#d08b1a'], borderWidth: 0, hoverOffset: 8 }] },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'right', labels: { font: { family: 'Plus Jakarta Sans', size: 11 }, color: labelColor, padding: 14 } } } }
  });
}

// ── Rewriter ──
async function rewriteResume() {
  hideError('rewriteError');
  if (!currentResumeText) { showError('rewriteError', 'No Resume Found', 'Please analyze your resume first.', false); return; }
  document.getElementById('rewriteLoader').style.display = 'block';
  document.getElementById('rewriteResult').style.display = 'none';
  try {
    const res  = await fetch('/rewrite', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ resume_text: currentResumeText, jd_text: currentJdText || '' }) });
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    renderRewrite(data);
  } catch (err) { showError('rewriteError', 'Unable to Complete', err.message, false); }
  document.getElementById('rewriteLoader').style.display = 'none';
}

function renderRewrite(data) {
  document.getElementById('rewriteResult').style.display = 'block';
  setPlain('rewriteOverall', data.overall_improvements || '');
  const pw = document.getElementById('rewritePowerWords'); pw.innerHTML = '';
  (data.power_words || []).forEach(w => { const s = document.createElement('span'); s.className = 'kw-chip'; s.textContent = '⚡ ' + w; pw.appendChild(s); });
  const container = document.getElementById('rewriteBullets'); container.innerHTML = '';
  (data.rewritten_bullets || []).forEach(b => {
    const d = document.createElement('div'); d.className = 'bullet-compare';
    d.innerHTML = `<div class="bullet-compare-label" style="color:var(--red)">Before</div><div class="bullet-original">${escHtml(b.original||'')}</div><div class="bullet-compare-label" style="color:var(--green);margin-top:.5rem;">After</div><div class="bullet-rewritten">${escHtml(b.rewritten||'')}</div>`;
    container.appendChild(d);
  });
}

// ── Interview ──
async function generateInterview() {
  const role = document.getElementById('interviewRole').value.trim();
  hideError('interviewError');
  if (!role) { showError('interviewError', 'Role Required', 'Please enter a target job role.', false); return; }
  if (!currentResumeText) { showError('interviewError', 'No Resume Found', 'Please analyze your resume first.', false); return; }
  document.getElementById('interviewLoader').style.display = 'block';
  document.getElementById('interviewResult').style.display = 'none';
  try {
    const res  = await fetch('/interview', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ resume_text: currentResumeText, jd_text: currentJdText || '', role }) });
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    renderInterview(data);
  } catch (err) { showError('interviewError', 'Unable to Complete', err.message, false); }
  document.getElementById('interviewLoader').style.display = 'none';
}

function renderInterview(data) {
  const result = document.getElementById('interviewResult'); result.style.display = 'block'; result.innerHTML = '';
  (data.questions || []).forEach((q, i) => {
    const catClass  = 'q-cat-'  + (q.category || 'Technical').replace(/\s+/g, '-');
    const diffClass = 'q-diff-' + (q.difficulty || 'Medium');
    const d = document.createElement('div'); d.className = 'question-card';
    d.innerHTML = `<div class="q-header"><span class="q-category ${catClass}">${q.category||'General'}</span><span class="q-difficulty ${diffClass}">${q.difficulty||'Medium'}</span></div><p class="q-text">Q${i+1}. ${escHtml(q.question||'')}</p><div class="q-tip"><span class="q-tip-label">💡 How to answer</span>${escHtml(q.tip||'')}</div>`;
    result.appendChild(d);
  });
}

// ── Cover Letter ──
async function generateCoverLetter() {
  const company = document.getElementById('clCompany').value.trim();
  const role    = document.getElementById('clRole').value.trim();
  hideError('clError');
  if (!company || !role) { showError('clError', 'Missing Details', 'Please enter both company name and role.', false); return; }
  if (!currentResumeText) { showError('clError', 'No Resume Found', 'Please analyze your resume first.', false); return; }
  document.getElementById('clLoader').style.display = 'block';
  document.getElementById('clResult').style.display = 'none';
  try {
    const res  = await fetch('/coverletter', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ resume_text: currentResumeText, jd_text: currentJdText || '', company, role }) });
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    renderCoverLetter(data);
  } catch (err) { showError('clError', 'Unable to Complete', err.message, false); }
  document.getElementById('clLoader').style.display = 'none';
}

function renderCoverLetter(data) {
  document.getElementById('clResult').style.display = 'block';
  document.getElementById('clSubject').textContent  = data.subject || 'Cover Letter';
  const hl = document.getElementById('clHighlights'); hl.innerHTML = '';
  (data.key_highlights || []).forEach(h => {
    const s = document.createElement('span'); s.className = 'kw-chip'; s.style.background = 'var(--teal-light)'; s.style.color = 'var(--teal)'; s.textContent = '✓ ' + h; hl.appendChild(s);
  });
  document.getElementById('clText').textContent = data.cover_letter || '';
}

function copyCoverLetter() {
  navigator.clipboard.writeText(document.getElementById('clText').textContent).then(() => {
    const btn = document.querySelector('.copy-btn'); btn.textContent = '✓ Copied!';
    setTimeout(() => { btn.textContent = '📋 Copy'; }, 2000);
  });
}

// ── Roadmap ──
async function generateRoadmap() {
  const role = document.getElementById('targetRole').value.trim();
  hideError('roadmapError');
  if (!role) { showError('roadmapError', 'Role Required', 'Please enter a target role.', false); return; }
  if (!currentAnalysis) { showError('roadmapError', 'No Analysis Found', 'Please analyze your resume first.', false); return; }
  document.getElementById('roadmapLoader').style.display = 'block';
  document.getElementById('roadmapResult').style.display = 'none';
  try {
    const res  = await fetch('/roadmap', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ resume_text: currentAnalysis.summary || '', missing_skills: (currentAnalysis.ats_keywords || []).slice(0, 5), target_role: role }) });
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    renderRoadmap(data);
  } catch (err) { showError('roadmapError', 'Unable to Complete', err.message, false); }
  document.getElementById('roadmapLoader').style.display = 'none';
}

function renderRoadmap(data) {
  document.getElementById('roadmapResult').style.display = 'block';
  document.getElementById('roadmapRole').textContent     = data.target_role    || '—';
  document.getElementById('roadmapDuration').textContent = data.total_duration || '—';
  const stepsEl = document.getElementById('roadmapSteps'); stepsEl.innerHTML = '';
  (data.roadmap || []).forEach(step => {
    const d = document.createElement('div'); d.className = 'roadmap-step';
    d.innerHTML = `<div class="step-num">${step.step}</div><div class="step-body"><div class="step-header"><span class="step-skill">${step.skill}</span><span class="step-duration">${step.duration}</span><span class="step-level ${step.level||'Beginner'}">${step.level||'Beginner'}</span></div><p class="step-why">${step.why||''}</p><div class="step-resources">${(step.resources||[]).map(r=>`<span class="step-res">${r}</span>`).join('')}</div></div>`;
    stepsEl.appendChild(d);
  });
  if (data.quick_wins?.length) { document.getElementById('roadmapQuickWins').style.display = 'block'; setBullets('quickWinsList', data.quick_wins.join('|'), 'green'); }
  if (data.final_tip) { document.getElementById('roadmapTipCard').style.display = 'block'; document.getElementById('roadmapFinalTip').textContent = data.final_tip; }
}

// ── Chat ──
async function sendChat() {
  const input = document.getElementById('chatInput');
  const msg   = input.value.trim();
  if (!msg) return;
  if (!currentSessionId) { appendBotMsg('⚠️ Please analyze a resume first.'); return; }
  input.value = '';
  document.getElementById('chatSuggestions').style.display = 'none';
  appendUserMsg(msg);
  const typing = appendTyping();
  try {
    const res  = await fetch('/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ session_id: currentSessionId, message: msg }) });
    const data = await res.json();
    typing.remove();
    appendBotMsg(data.error ? '⚠️ ' + data.error : data.reply);
  } catch { typing.remove(); appendBotMsg('⚠️ Connection issue. Please try again.'); }
}

function sendSuggestion(btn) { document.getElementById('chatInput').value = btn.textContent; sendChat(); }
function appendUserMsg(text) { const el = document.createElement('div'); el.className = 'chat-msg user'; el.innerHTML = `<div class="msg-bubble">${escHtml(text)}</div>`; chatBox().appendChild(el); scrollChat(); }
function appendBotMsg(text)  { const el = document.createElement('div'); el.className = 'chat-msg bot';  el.innerHTML = `<div class="msg-bubble">${escHtml(text)}</div>`; chatBox().appendChild(el); scrollChat(); }
function appendTyping()      { const el = document.createElement('div'); el.className = 'chat-msg bot typing'; el.innerHTML = '<div class="msg-bubble"><div class="typing-dots"><span></span><span></span><span></span></div></div>'; chatBox().appendChild(el); scrollChat(); return el; }
function chatBox()   { return document.getElementById('chatMessages'); }
function scrollChat(){ const b = chatBox(); b.scrollTop = b.scrollHeight; }

// ── PDF Export ──
function exportPDF() {
  if (!currentAnalysis) return;
  const d = currentAnalysis;
  const w = window.open('', '_blank');
  w.document.write(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Resume Score Card — ResumeAI</title>
  <style>body{font-family:'Segoe UI',sans-serif;max-width:750px;margin:0 auto;padding:2rem;color:#111;}
  h1{font-size:1.8rem;font-weight:800;margin-bottom:.25rem;color:#6c47c9;}
  .subtitle{color:#7c8098;font-size:.88rem;margin-bottom:2rem;border-bottom:2px solid #6c47c9;padding-bottom:1rem;}
  .score-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:1rem;margin-bottom:2rem;}
  .score-box{border:1px solid #e4e6ea;border-radius:12px;padding:1.25rem;text-align:center;background:#f7f8fa;}
  .score-label{font-size:.62rem;font-weight:800;text-transform:uppercase;letter-spacing:.1em;color:#7c8098;margin-bottom:.4rem;}
  .score-val{font-size:2rem;font-weight:800;}.s-p{color:#6c47c9;}.s-o{color:#e05a1a;}.s-t{color:#0d8a80;}
  .section{margin-bottom:1.5rem;}.section h3{font-size:.72rem;font-weight:800;text-transform:uppercase;letter-spacing:.1em;color:#6c47c9;margin-bottom:.6rem;padding-bottom:.4rem;border-bottom:1px solid #e4e6ea;}
  p,li{font-size:.88rem;color:#3d4154;line-height:1.7;}ul{padding-left:1.2rem;}
  .ats-grid{display:grid;grid-template-columns:1fr 1fr;gap:6px;}
  .ats-item{font-size:.8rem;padding:.4rem .6rem;border-radius:6px;}
  .pass{background:#d6f5e8;color:#14a870;}.fail{background:#fde8e8;color:#e03f3f;}
  .kw-wrap{display:flex;flex-wrap:wrap;gap:6px;}.kw{font-size:.74rem;padding:3px 10px;border-radius:20px;background:#ede8fb;color:#6c47c9;}
  .footer{margin-top:2rem;padding-top:1rem;border-top:1px solid #e4e6ea;font-size:.72rem;color:#7c8098;text-align:center;}
  @media print{body{padding:1rem;}}</style></head><body>
  <h1>Resume Score Card</h1>
  <p class="subtitle">ResumeAI · Generated on ${new Date().toLocaleDateString('en-IN',{day:'numeric',month:'long',year:'numeric'})}</p>
  <div class="score-grid">
    <div class="score-box"><div class="score-label">Overall Score</div><div class="score-val s-p">${d.overall_score||0}%</div></div>
    <div class="score-box"><div class="score-label">ATS Score</div><div class="score-val s-o">${d.ats_score||0}%</div></div>
    <div class="score-box"><div class="score-label">JD Match</div><div class="score-val s-t">${d.jd_match_score!=null?d.jd_match_score+'%':'N/A'}</div></div>
  </div>
  <div class="section"><h3>Summary</h3><p>${d.summary||'—'}</p></div>
  <div class="section"><h3>Strengths</h3><ul>${(d.strengths||'').split('|').filter(Boolean).map(s=>`<li>${s.trim()}</li>`).join('')}</ul></div>
  <div class="section"><h3>Weaknesses</h3><ul>${(d.weaknesses||'').split('|').filter(Boolean).map(s=>`<li>${s.trim()}</li>`).join('')}</ul></div>
  <div class="section"><h3>Suggestions</h3><ul>${(d.suggestions||'').split('|').filter(Boolean).map(s=>`<li>${s.trim()}</li>`).join('')}</ul></div>
  <div class="section"><h3>ATS Checks</h3><div class="ats-grid">${Object.entries({has_contact_info:'Contact Info',has_work_experience:'Work Experience',has_education:'Education',has_skills_section:'Skills Section',has_measurable_achievements:'Achievements',no_tables_or_graphics:'No Tables',proper_date_format:'Date Format',good_keyword_density:'Keywords'}).map(([k,l])=>`<div class="ats-item ${(d.ats_checks||{})[k]?'pass':'fail'}">${(d.ats_checks||{})[k]?'✓':'✗'} ${l}</div>`).join('')}</div></div>
  <div class="section"><h3>Keywords to Add</h3><div class="kw-wrap">${(d.ats_keywords||[]).map(k=>`<span class="kw">${k}</span>`).join('')}</div></div>
  <div class="section"><h3>Job Matches</h3><ul>${(d.job_matches||[]).sort((a,b)=>b.score-a.score).map((j,i)=>`<li>${['🥇','🥈','🥉'][i]||'•'} ${j.role} — ${j.score}% · ${j.reason||''}</li>`).join('')}</ul></div>
  <div class="footer">Generated by ResumeAI · For personal use only</div></body></html>`);
  w.document.close();
  setTimeout(() => w.print(), 500);
}

// ── Util ──
function setPlain(id, text) { const el = document.getElementById(id); if (el) el.textContent = text; }

function setBullets(id, text, color) {
  const el = document.getElementById(id); if (!el) return; el.innerHTML = '';
  let lines = text.split('|').map(s => s.trim()).filter(Boolean);
  if (lines.length <= 1) lines = text.split('\n').map(s => s.replace(/^[\d\.\-\•\*]+\s*/, '').trim()).filter(Boolean);
  lines.forEach(line => {
    const d = document.createElement('div'); d.className = 'b-item';
    const dc = { red:'red', amber:'amber', orange:'orange', green:'green' }[color] || '';
    d.innerHTML = `<span class="b-dot ${dc}"></span><span>${line}</span>`;
    el.appendChild(d);
  });
}

function escHtml(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\n/g,'<br>'); }

function resetAll() {
  resultsSec.style.display = 'none';
  inputSec.style.display   = 'block';
  analyzeBtn.disabled      = false;
  fileInput.value          = '';
  document.getElementById('fileName').style.display = 'none';
  document.getElementById('jdText').value = '';
  ['overallBar','atsBar','jdBar'].forEach(id => { const el = document.getElementById(id); if (el) el.style.width = '0%'; });
  document.getElementById('jdTile').style.opacity   = '0.3';
  document.getElementById('topbarResultActions').style.display = 'none';
  document.getElementById('featureSidebarSection').style.display = 'none';
  const bc = document.getElementById('topbarBreadcrumb');
  if (bc) bc.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg><span>Dashboard</span>`;
  currentSessionId = null; currentAnalysis = null; currentResumeText = null; currentJdText = null;
  if (scoreChartInst) { scoreChartInst.destroy(); scoreChartInst = null; }
  if (jobChartInst)   { jobChartInst.destroy();   jobChartInst   = null; }
  hideError('errorBox');
  window.scrollTo({ top: 0, behavior: 'smooth' });
  switchTab('analysis');
}

// ── Init ──
initTheme();
loadHistoryCount();

// ── OVERLAY PANELS ──
let pTrendChartInst = null;

function openPanel(name) {
  document.getElementById('overlayBackdrop').style.display = 'block';
  document.getElementById('historyPanel').style.display  = name === 'history' ? 'flex' : 'none';
  document.getElementById('comparePanel').style.display  = name === 'compare' ? 'flex' : 'none';
  document.body.style.overflow = 'hidden';

  // Mark active in sidebar
  document.querySelectorAll('.sidebar-section:first-of-type .snav-item').forEach(i => i.classList.remove('active'));
  const btns = document.querySelectorAll(`.snav-item[onclick="openPanel('${name}')"]`);
  btns.forEach(b => b.classList.add('active'));

  if (name === 'history') loadPanelHistory();
}

function closePanel() {
  document.getElementById('overlayBackdrop').style.display = 'none';
  document.getElementById('historyPanel').style.display    = 'none';
  document.getElementById('comparePanel').style.display    = 'none';
  document.body.style.overflow = '';

  // Restore dashboard active
  document.querySelectorAll('.sidebar-section:first-of-type .snav-item').forEach(i => i.classList.remove('active'));
  const dash = document.querySelector('.snav-item[href="/"]');
  if (dash) dash.classList.add('active');
}

async function loadPanelHistory() {
  try {
    const res  = await fetch('/history');
    const data = await res.json();

    if (!data.length) {
      document.getElementById('pHistoryEmpty').style.display  = 'block';
      document.getElementById('pHistoryTable').style.display  = 'none';
      ['pStatTotal','pStatOverall','pStatAts','pStatBest'].forEach(id => document.getElementById(id).textContent = '0');
      return;
    }

    const avgOverall = Math.round(data.reduce((s,r) => s + (r.overall_score||0), 0) / data.length);
    const avgAts     = Math.round(data.reduce((s,r) => s + (r.ats_score||0), 0) / data.length);
    const best       = Math.max(...data.map(r => r.overall_score||0));

    document.getElementById('pStatTotal').textContent   = data.length;
    document.getElementById('pStatOverall').textContent = avgOverall + '%';
    document.getElementById('pStatAts').textContent     = avgAts + '%';
    document.getElementById('pStatBest').textContent    = best + '%';

    // Trend chart
    if (data.length >= 2) {
      document.getElementById('pTrendCard').style.display = 'block';
      if (pTrendChartInst) { pTrendChartInst.destroy(); pTrendChartInst = null; }
      const isDark     = document.documentElement.getAttribute('data-theme') === 'dark';
      const gridColor  = isDark ? '#252a3a' : '#f0f1f3';
      const tickColor  = isDark ? '#9aa0b8' : '#7c8098';
      const labelColor = isDark ? '#edf0f8' : '#3d4154';
      const labels  = data.slice().reverse().map(r => r.filename.replace('.pdf','').slice(0, 14));
      const overall = data.slice().reverse().map(r => r.overall_score||0);
      const ats     = data.slice().reverse().map(r => r.ats_score||0);
      pTrendChartInst = new Chart(document.getElementById('pTrendChart'), {
        type: 'line',
        data: { labels, datasets: [
          { label:'Overall', data:overall, borderColor:'#6c47c9', backgroundColor:'rgba(108,71,201,0.07)', tension:.4, fill:true, pointBackgroundColor:'#6c47c9', pointRadius:4 },
          { label:'ATS',     data:ats,     borderColor:'#e05a1a', backgroundColor:'rgba(224,90,26,0.05)',  tension:.4, fill:true, pointBackgroundColor:'#e05a1a', pointRadius:4 }
        ]},
        options: { responsive:true, plugins:{ legend:{ labels:{ font:{ family:'Plus Jakarta Sans', size:11 }, color:labelColor } } }, scales:{ y:{ min:0, max:100, grid:{ color:gridColor }, ticks:{ color:tickColor, font:{ family:'Plus Jakarta Sans' }, callback: v => v+'%' } }, x:{ grid:{ display:false }, ticks:{ color:tickColor, font:{ family:'Plus Jakarta Sans' } } } } }
      });
    }

    // Table
    document.getElementById('pHistoryTable').style.display = 'table';
    document.getElementById('pHistoryEmpty').style.display = 'none';
    document.getElementById('pHistoryBody').innerHTML = data.map((r, i) => {
      const sc = r.overall_score>=80?'green':r.overall_score>=60?'purple':'red';
      const ac = r.ats_score>=80?'green':r.ats_score>=60?'orange':'red';
      const jd = (r.jd_score && r.jd_score!=='None' && r.jd_score!=='N/A') ? r.jd_score+'%' : '—';
      const dt = new Date(r.created_at).toLocaleDateString('en-IN',{day:'numeric',month:'short',year:'numeric'});
      return `<tr>
        <td style="color:var(--muted);font-size:.78rem">${i+1}</td>
        <td class="file-cell" title="${r.filename}" style="max-width:130px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${r.filename.slice(0,20)}${r.filename.length>20?'…':''}</td>
        <td><span class="score-pill ${sc}">${r.overall_score||0}%</span></td>
        <td><span class="score-pill ${ac}">${r.ats_score||0}%</span></td>
        <td style="font-size:.8rem;color:var(--text2)">${jd}</td>
        <td style="font-size:.78rem;color:var(--text2);max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${r.best_match||'—'}</td>
        <td style="font-size:.73rem;color:var(--muted)">${dt}</td>
      </tr>`;
    }).join('');

    // Update sidebar badge
    const badge = document.getElementById('sidebarHistoryCount');
    if (badge) { badge.textContent = data.length; badge.style.display = 'inline'; }

  } catch(e) { console.error('History load error:', e); }
}

// ── COMPARE inside panel ──
document.addEventListener('DOMContentLoaded', () => {
  const cf = document.getElementById('compareFiles');
  if (cf) {
    cf.addEventListener('change', () => {
      const list = document.getElementById('compareFileList');
      list.innerHTML = '';
      Array.from(cf.files).forEach(f => {
        const s = document.createElement('span');
        s.className = 'kw-chip'; s.textContent = '📄 ' + f.name;
        list.appendChild(s);
      });
    });
  }
});

async function compareResumes() {
  const files  = document.getElementById('compareFiles').files;
  const errBox = document.getElementById('compareError');
  const errDesc= document.getElementById('compareErrorDesc');
  errBox.style.display = 'none';
  if (files.length < 2) { errDesc.textContent='Please select at least 2 PDF resumes.'; errBox.style.display='block'; return; }
  if (files.length > 4) { errDesc.textContent='Maximum 4 resumes allowed.'; errBox.style.display='block'; return; }
  document.getElementById('compareBtn').disabled    = true;
  document.getElementById('compareLoader').style.display  = 'block';
  document.getElementById('compareResult').style.display  = 'none';
  const fd = new FormData();
  Array.from(files).forEach(f => fd.append('resumes', f));
  try {
    const res  = await fetch('/compare', { method:'POST', body:fd });
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    renderCompare(data);
  } catch(err) { errDesc.textContent = err.message; errBox.style.display = 'block'; }
  document.getElementById('compareLoader').style.display = 'none';
  document.getElementById('compareBtn').disabled = false;
}

function renderCompare(data) {
  const result = document.getElementById('compareResult');
  result.style.display = 'block'; result.innerHTML = '';

  const winCard = document.createElement('div'); winCard.className = 'rc';
  winCard.style.background = 'linear-gradient(135deg,var(--purple-soft),var(--surface))';
  winCard.innerHTML = `<div class="rc-hd"><div class="rc-icon bg-purple"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg></div><h3>🏆 Winner</h3></div><p style="font-size:1rem;font-weight:800;color:var(--text);margin-bottom:.4rem;">🏆 ${data.winner||'—'}</p><p class="rc-body">${data.winner_reason||''}</p>`;
  result.appendChild(winCard);

  if (data.common_gaps) {
    const gapCard = document.createElement('div'); gapCard.className = 'rc';
    gapCard.innerHTML = `<div class="rc-hd"><div class="rc-icon bg-red"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5"><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/></svg></div><h3>Common Gaps</h3></div><p class="rc-body">${data.common_gaps}</p>`;
    result.appendChild(gapCard);
  }

  const medals   = ['🥇','🥈','🥉','4️⃣'];
  const rankBg   = ['bg-green','bg-blue','bg-amber','bg-red'];
  (data.comparison||[]).sort((a,b) => a.rank-b.rank).forEach((r,i) => {
    const d = document.createElement('div'); d.className = 'rc';
    d.innerHTML = `
      <div class="compare-card-hd">
        <div class="rc-icon ${rankBg[i]||'bg-purple'}" style="font-size:.9rem;width:30px;height:30px;">${medals[i]||i+1}</div>
        <div style="flex:1;"><p style="font-weight:700;font-size:.9rem;color:var(--text)">${r.name||'Resume '+(i+1)}</p><p style="font-size:.7rem;color:var(--muted)">Rank #${r.rank}</p></div>
        <div style="display:flex;gap:6px;">
          <span class="score-pill ${r.overall_score>=70?'green':'purple'}">${r.overall_score||0}% Overall</span>
          <span class="score-pill ${r.ats_score>=70?'green':'orange'}">${r.ats_score||0}% ATS</span>
        </div>
      </div>
      <div class="compare-card-body">
        <div class="compare-col"><p class="compare-col-label green-text">✓ Strengths</p><p class="compare-col-text">${r.strengths||'—'}</p></div>
        <div class="compare-col"><p class="compare-col-label red-text">✗ Weaknesses</p><p class="compare-col-text">${r.weaknesses||'—'}</p></div>
      </div>
      <div class="compare-verdict">${r.verdict||''}</div>`;
    result.appendChild(d);
  });
}

// Close panel on Escape key
document.addEventListener('keydown', e => { if (e.key === 'Escape') closePanel(); });

// ── Dashboard button — stays on page, just shows upload section ──
function goToDashboard() {
  closePanel();
  // Update sidebar active state
  document.querySelectorAll('.sidebar-section .snav-item').forEach(i => i.classList.remove('active'));
  const dashBtn = document.getElementById('dashboardBtn');
  if (dashBtn) dashBtn.classList.add('active');
  // If results showing, keep them — just scroll to top
  // If input showing, keep it — just scroll to top
  window.scrollTo({ top: 0, behavior: 'smooth' });
}
