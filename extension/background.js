/**
 * FocusGuard — background.js (Service Worker)
 * Manages periodic wellness checks via Chrome Alarms API.
 * Sends OS-level Chrome notifications — visible even when browser is minimized.
 * Privacy: All image data sent only to localhost:5000 (your local Gemma 4 instance).
 */

const FLASK_URL = 'http://localhost:5000';
const ALARM_NAME = 'focusguard-check';
const DEFAULT_INTERVAL_MINUTES = 10;

// ─── Alarm Setup ─────────────────────────────────────────────────────────────

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.set({
    intervalMinutes: DEFAULT_INTERVAL_MINUTES,
    monitoring: false,
    totalChecks: 0,
    lastAnalysis: null
  });
  console.log('[FocusGuard] Installed. Ready to monitor.');
});

// ─── Message Handler (from popup) ────────────────────────────────────────────

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'START_MONITORING') {
    startMonitoring(msg.intervalMinutes || DEFAULT_INTERVAL_MINUTES);
    sendResponse({ success: true });
  }

  if (msg.type === 'STOP_MONITORING') {
    stopMonitoring();
    sendResponse({ success: true });
  }

  if (msg.type === 'CHECK_NOW') {
    triggerCheck().then(result => sendResponse({ success: true, result }));
    return true; // keep channel open for async
  }

  if (msg.type === 'GET_STATUS') {
    chrome.storage.local.get(['monitoring', 'totalChecks', 'lastAnalysis', 'intervalMinutes'], data => {
      sendResponse(data);
    });
    return true;
  }
});

// ─── Alarm Listener ──────────────────────────────────────────────────────────

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_NAME) {
    triggerCheck();
  }
});

// ─── Core Functions ──────────────────────────────────────────────────────────

function startMonitoring(intervalMinutes) {
  chrome.storage.local.set({ monitoring: true, intervalMinutes });
  chrome.alarms.create(ALARM_NAME, {
    delayInMinutes: intervalMinutes,
    periodInMinutes: intervalMinutes
  });
  console.log(`[FocusGuard] Monitoring started. Interval: ${intervalMinutes}min`);
}

function stopMonitoring() {
  chrome.alarms.clear(ALARM_NAME);
  chrome.storage.local.set({ monitoring: false });
  console.log('[FocusGuard] Monitoring stopped.');
}

async function triggerCheck() {
  console.log('[FocusGuard] Triggering wellness check...');

  // Ask content script to capture webcam frame
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tabs.length) return;

  let imageB64 = null;
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId: tabs[0].id },
      func: captureWebcamFrame
    });
    imageB64 = results?.[0]?.result;
  } catch (err) {
    console.error('[FocusGuard] Frame capture failed:', err);
    showNotification('error', 'Could not capture webcam. Is the tab allowing camera access?');
    return;
  }

  if (!imageB64) {
    showNotification('error', 'Webcam not available on this page. Open localhost:5000 for full monitoring.');
    return;
  }

  // Send to local Flask/Gemma backend
  try {
    const res = await fetch(`${FLASK_URL}/analyze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image: imageB64 })
    });

    const data = await res.json();
    if (!data.success) throw new Error(data.error);

    const analysis = data.analysis;

    // Update storage
    const stored = await chrome.storage.local.get(['totalChecks']);
    chrome.storage.local.set({
      totalChecks: (stored.totalChecks || 0) + 1,
      lastAnalysis: { ...analysis, timestamp: new Date().toISOString() }
    });

    // Fire OS notification
    showWellnessNotification(analysis);
    return analysis;

  } catch (err) {
    console.error('[FocusGuard] Analysis failed:', err);
    showNotification('error', 'Could not reach FocusGuard server. Is Flask running on localhost:5000?');
  }
}

// ─── Notifications ───────────────────────────────────────────────────────────

function showWellnessNotification(analysis) {
  const level = analysis.fatigue_level || 'low';
  const emoji = level === 'high' ? '🔴' : level === 'medium' ? '🟡' : '🟢';
  const tip = analysis.tips?.[0] || 'Take a short break.';
  const breakSuggestion = analysis.break_suggestion || '';

  const urgency = level === 'high' ? '⚠️ Action needed: ' : '';

  chrome.notifications.create(`focusguard-${Date.now()}`, {
    type: 'basic',
    iconUrl: 'icons/icon128.png',
    title: `${emoji} FocusGuard — ${level.charAt(0).toUpperCase() + level.slice(1)} Fatigue · Posture ${analysis.posture_score}/10`,
    message: `${urgency}${tip}`,
    contextMessage: breakSuggestion,
    priority: level === 'high' ? 2 : 1,
    requireInteraction: level === 'high' // stays until dismissed if high fatigue
  });
}

function showNotification(type, message) {
  chrome.notifications.create(`focusguard-err-${Date.now()}`, {
    type: 'basic',
    iconUrl: 'icons/icon128.png',
    title: 'FocusGuard',
    message,
    priority: 0
  });
}

// ─── Injected into page to capture webcam ────────────────────────────────────
// This function runs IN the tab context (not service worker)

function captureWebcamFrame() {
  return new Promise((resolve) => {
    const video = document.getElementById('video') || document.querySelector('video');
    if (!video || !video.srcObject) {
      resolve(null);
      return;
    }
    const canvas = document.createElement('canvas');
    canvas.width = 640;
    canvas.height = 480;
    canvas.getContext('2d').drawImage(video, 0, 0, 640, 480);
    resolve(canvas.toDataURL('image/jpeg', 0.7).split(',')[1]);
  });
}
