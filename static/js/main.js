/**
 * FocusGuard — main.js
 * Handles webcam access, random-interval frame capture,
 * Gemma 4 analysis requests, and UI updates.
 * Privacy: Images are captured locally and sent only to localhost Flask.
 */

const video = document.getElementById('video');
const canvas = document.getElementById('canvas');
const btnStart = document.getElementById('btn-start');
const btnCheck = document.getElementById('btn-check');
const btnClear = document.getElementById('btn-clear');
const intervalSelect = document.getElementById('interval-select');
const statusBadge = document.getElementById('status-badge');
const scanOverlay = document.getElementById('scan-overlay');

// Insight elements
const insightEmpty = document.getElementById('insight-empty');
const insightResult = document.getElementById('insight-result');
const fatigueChip = document.getElementById('fatigue-chip');
const ringFill = document.getElementById('ring-fill');
const postureVal = document.getElementById('posture-score-val');
const observationsEl = document.getElementById('observations');
const tipsList = document.getElementById('tips-list');
const breakBody = document.getElementById('break-body');
const affirmationEl = document.getElementById('affirmation');

// Stats
const totalChecksEl = document.getElementById('total-checks');
const avgPostureEl = document.getElementById('avg-posture');
const sessionDurationEl = document.getElementById('session-duration');

let stream = null;
let monitoring = false;
let autoCheckTimer = null;
let sessionTimer = null;
let sessionSeconds = 0;

// ─── Webcam ──────────────────────────────────────────────────────────────────

async function startCamera() {
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
    video.srcObject = stream;
    return true;
  } catch (err) {
    showToast('Camera Error', 'Could not access webcam. Please allow camera permissions.', 'error');
    return false;
  }
}

function stopCamera() {
  if (stream) {
    stream.getTracks().forEach(t => t.stop());
    stream = null;
    video.srcObject = null;
  }
}

function captureFrame() {
  const ctx = canvas.getContext('2d');
  canvas.width = 640;
  canvas.height = 480;
  ctx.drawImage(video, 0, 0, 640, 480);
  // Return base64 JPEG, quality 0.7 to keep size small
  return canvas.toDataURL('image/jpeg', 0.7);
}

// ─── Analysis ────────────────────────────────────────────────────────────────

async function runAnalysis() {
  if (!stream) return;

  setStatus('Analyzing…', true);
  scanOverlay.classList.add('active');
  btnCheck.disabled = true;

  const imageDataUrl = captureFrame();

  try {
    const res = await fetch('/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image: imageDataUrl })
    });

    const data = await res.json();

    if (!data.success) {
      throw new Error(data.error || 'Analysis failed.');
    }

    renderInsight(data.analysis);
    updateStats();
    showToast(
      'Wellness Check Complete',
      `Fatigue: ${data.analysis.fatigue_level} · Posture: ${data.analysis.posture_score}/10`,
      data.analysis.fatigue_level === 'high' ? 'warning' : 'success'
    );
  } catch (err) {
    showToast('Analysis Error', err.message, 'error');
    setStatus('Error', false);
  } finally {
    scanOverlay.classList.remove('active');
    setStatus('Monitoring', false);
    if (monitoring) btnCheck.disabled = false;
  }
}

// ─── Render ──────────────────────────────────────────────────────────────────

function renderInsight(analysis) {
  insightEmpty.classList.add('hidden');
  insightResult.classList.remove('hidden');

  // Force re-animation
  insightResult.style.animation = 'none';
  requestAnimationFrame(() => { insightResult.style.animation = ''; });

  // Fatigue chip
  const level = analysis.fatigue_level || 'low';
  fatigueChip.textContent = level.charAt(0).toUpperCase() + level.slice(1) + ' Fatigue';
  fatigueChip.className = `fatigue-chip ${level}`;

  // Posture ring (circumference = 2π × 24 ≈ 150.8)
  const score = analysis.posture_score || 5;
  const circ = 150.8;
  const offset = circ - (score / 10) * circ;
  ringFill.style.strokeDashoffset = offset;
  postureVal.textContent = score;

  // Observations
  const obs = analysis.observations || [];
  observationsEl.innerHTML = obs.map(o => `<div>${o}</div>`).join('');

  // Tips
  tipsList.innerHTML = (analysis.tips || [])
    .map(tip => `<li>${tip}</li>`)
    .join('');

  // Break
  breakBody.textContent = analysis.break_suggestion || 'Take a 5-minute walk.';

  // Affirmation
  affirmationEl.textContent = analysis.affirmation || 'You are doing great.';
}

// ─── Stats ───────────────────────────────────────────────────────────────────

async function updateStats() {
  try {
    const res = await fetch('/stats');
    const data = await res.json();

    totalChecksEl.textContent = data.total_checks;
    avgPostureEl.textContent = data.avg_posture_score ?? '—';

    // Fatigue bars
    const dist = data.fatigue_distribution || {};
    const total = data.total_checks || 1;
    document.querySelector('.fbar.low').style.height = `${((dist.low || 0) / total) * 100}%`;
    document.querySelector('.fbar.med').style.height = `${((dist.medium || 0) / total) * 100}%`;
    document.querySelector('.fbar.high').style.height = `${((dist.high || 0) / total) * 100}%`;
  } catch (_) { /* stats are non-critical */ }
}

// ─── Timer ───────────────────────────────────────────────────────────────────

function startSessionTimer() {
  sessionSeconds = 0;
  sessionTimer = setInterval(() => {
    sessionSeconds++;
    const mins = Math.floor(sessionSeconds / 60);
    const secs = sessionSeconds % 60;
    sessionDurationEl.textContent = mins > 0
      ? `${mins}m ${secs}s`
      : `${secs}s`;
  }, 1000);
}

function stopSessionTimer() {
  clearInterval(sessionTimer);
}

// ─── Auto-check scheduler ────────────────────────────────────────────────────

function scheduleNextCheck() {
  const base = parseInt(intervalSelect.value, 10);
  // Add ±20% jitter for more natural random feel
  const jitter = base * 0.2;
  const delay = base + (Math.random() * jitter * 2 - jitter);
  autoCheckTimer = setTimeout(() => {
    if (monitoring) {
      runAnalysis().then(() => scheduleNextCheck());
    }
  }, delay);
}

// ─── Controls ────────────────────────────────────────────────────────────────

btnStart.addEventListener('click', async () => {
  if (!monitoring) {
    if ('Notification' in window && Notification.permission === 'default') {
      await Notification.requestPermission();
    }
    const ok = await startCamera();
    if (!ok) return;
    monitoring = true;
    btnStart.textContent = 'Stop Monitoring';
    btnStart.classList.add('stop');
    btnCheck.disabled = false;
    setStatus('Monitoring', false);
    startSessionTimer();
    // Immediate visual feedback + push notification test
    showToast('FocusGuard Active', 'Mental wellness monitoring started.', 'success');
    // Run first check after 3s
    setTimeout(() => { if (monitoring) runAnalysis().then(() => scheduleNextCheck()); }, 3000);
  } else {
    monitoring = false;
    clearTimeout(autoCheckTimer);
    stopCamera();
    stopSessionTimer();
    btnStart.textContent = 'Start Monitoring';
    btnStart.classList.remove('stop');
    btnCheck.disabled = true;
    setStatus('Idle', false);
  }
});

btnCheck.addEventListener('click', () => {
  if (monitoring) runAnalysis();
});

btnClear.addEventListener('click', async () => {
  await fetch('/clear', { method: 'POST' });
  totalChecksEl.textContent = '0';
  avgPostureEl.textContent = '—';
  sessionDurationEl.textContent = '0m';
  document.querySelectorAll('.fbar').forEach(b => b.style.height = '0%');
  insightEmpty.classList.remove('hidden');
  insightResult.classList.add('hidden');
  showToast('Session Cleared', 'All local data has been reset.', 'success');
});

// ─── Utilities ───────────────────────────────────────────────────────────────

function setStatus(text, analyzing) {
  statusBadge.textContent = text;
  statusBadge.className = analyzing ? 'camera-badge analyzing' : 'camera-badge';
}

function showToast(title, body, type = 'success') {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.setAttribute('role', 'alert');
  toast.innerHTML = `<div class="toast-title">${title}</div><div class="toast-body">${body}</div>`;
  container.appendChild(toast);

  // Native desktop push notification
  showDesktopNotification(title, body);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transition = 'opacity 0.4s';
    setTimeout(() => toast.remove(), 400);
  }, 5000);
}

function showDesktopNotification(title, body) {
  if ('Notification' in window && Notification.permission === 'granted') {
    try {
      new Notification(title, { body: body });
    } catch (e) {
      console.warn('Native notification failed:', e);
    }
  }
}

// Request notification permission immediately on load to make it highly visible
if ('Notification' in window) {
  if (Notification.permission === 'default') {
    Notification.requestPermission().then(permission => {
      if (permission === 'granted') {
        showToast('Notifications Enabled', 'You will receive wellness alerts directly on your desktop!', 'success');
      }
    });
  } else if (Notification.permission === 'granted') {
    console.log('FocusGuard desktop notifications are enabled.');
  }
}
