/**
 * FocusGuard — content.js
 * Injected into active tabs. Provides webcam frame capture
 * for the background service worker to use.
 * Privacy: Frames are only sent to localhost:5000.
 */

// Listen for capture requests from background
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'CAPTURE_FRAME') {
    captureFrame().then(sendResponse);
    return true;
  }
});

async function captureFrame() {
  try {
    // Try to find existing video element (FocusGuard web app)
    const existingVideo = document.getElementById('video') || document.querySelector('video');
    if (existingVideo && existingVideo.srcObject) {
      return drawFrame(existingVideo);
    }

    // Otherwise request webcam access fresh
    const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
    const video = document.createElement('video');
    video.srcObject = stream;
    video.muted = true;

    await new Promise(resolve => { video.onloadedmetadata = resolve; });
    video.play();

    // Wait a frame to render
    await new Promise(resolve => setTimeout(resolve, 500));
    const frame = drawFrame(video);

    // Clean up stream
    stream.getTracks().forEach(t => t.stop());
    return frame;

  } catch (err) {
    console.error('[FocusGuard content] Webcam capture failed:', err);
    return null;
  }
}

function drawFrame(video) {
  const canvas = document.createElement('canvas');
  canvas.width = 640;
  canvas.height = 480;
  canvas.getContext('2d').drawImage(video, 0, 0, 640, 480);
  return canvas.toDataURL('image/jpeg', 0.7).split(',')[1];
}
