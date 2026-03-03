/**
 * WebView <-> React Native message bridge.
 *
 * RN sends messages via `injectJavaScript('window.dispatchBridgeMessage(...)')`.
 * We send messages back via `window.ReactNativeWebView.postMessage(...)`.
 */

import { goBack } from './camera/cameraController';

export interface BridgeMessage {
  type: string;
  payload: Record<string, any>;
}

type BridgeHandler = (msg: BridgeMessage) => void;

let handler: BridgeHandler | null = null;

/** Register the single handler for incoming RN messages. */
export function onBridgeMessage(fn: BridgeHandler) {
  handler = fn;
}

/** Called from RN via injectJavaScript. Exposed on window. */
export function dispatchBridgeMessage(raw: string) {
  try {
    const msg: BridgeMessage = JSON.parse(raw);
    handler?.(msg);
  } catch {
    // ignore malformed
  }
}

/** Send a message from WebView → RN. */
export function sendToRN(msg: BridgeMessage) {
  const json = JSON.stringify(msg);

  // React Native WebView bridge (iOS / Android)
  if ((window as any).ReactNativeWebView?.postMessage) {
    (window as any).ReactNativeWebView.postMessage(json);
    return;
  }

  // Web (iframe) fallback — react-native-webview on web uses window.parent.postMessage
  if (window.parent && window.parent !== window) {
    window.parent.postMessage(json, '*');
    return;
  }

  // Standalone web — overlays are triggered by camera-arrived, not here
  console.log('[bridge → RN]', msg);
}

/** Map objectId → overlay element ID */
const OVERLAY_MAP: Record<string, string> = {
  book: 'bookOverlay',
  bookshelf: 'bookOverlay',
  old_chest: 'chestOverlay',
  alchemy_table: 'alchemyOverlay',
  alchemy_yield: 'alchemyOverlay',
};

const OVERLAY_IDS = ['bookOverlay', 'chestOverlay', 'alchemyOverlay'];

/** Show the overlay matching the objectId */
function showOverlay(objectId: string) {
  const overlayId = OVERLAY_MAP[objectId];
  if (!overlayId) return;
  const el = document.getElementById(overlayId);
  if (el) el.classList.add('visible');
}

/** Hide all overlays and return camera to viewpoint */
function closeAndGoBack() {
  for (const id of OVERLAY_IDS) {
    const el = document.getElementById(id);
    if (el) el.classList.remove('visible');
  }
  goBack();
}

// Listen for camera-arrived — show overlay + notify RN only after camera finishes moving
window.addEventListener('camera-arrived', ((e: CustomEvent) => {
  const objectId = e.detail?.objectId as string;
  if (!objectId) return;
  showOverlay(objectId);
  sendToRN({ type: 'objectTapped', payload: { objectId } });
}) as EventListener);

// Hide all overlays when camera zooms back (triggered by goBack)
window.addEventListener('camera-zoom-back', () => {
  for (const id of OVERLAY_IDS) {
    const el = document.getElementById(id);
    if (el) el.classList.remove('visible');
  }
});

// Wire up backdrop-close + buttons for all overlay panels
document.addEventListener('DOMContentLoaded', () => {
  // Backdrop click → close + return camera
  for (const id of OVERLAY_IDS) {
    const el = document.getElementById(id);
    if (el) {
      el.addEventListener('click', (e) => {
        if (e.target === el) closeAndGoBack();
      });
    }
  }

  // Book panel — close + start lesson buttons
  const bookCloseBtn = document.getElementById('bookCloseBtn');
  if (bookCloseBtn) {
    bookCloseBtn.addEventListener('click', () => closeAndGoBack());
  }

  const startBtn = document.getElementById('startLessonBtn');
  if (startBtn) {
    startBtn.addEventListener('click', () => {
      closeAndGoBack();
      console.log('[web] Start lesson clicked — navigate to Lesson screen in RN app');
    });
  }

  // Chest panel — close button
  const chestCloseBtn = document.getElementById('chestCloseBtn');
  if (chestCloseBtn) {
    chestCloseBtn.addEventListener('click', () => closeAndGoBack());
  }

  // Alchemy panel — close, deposit, withdraw buttons
  const alchemyCloseBtn = document.getElementById('alchemyCloseBtn');
  if (alchemyCloseBtn) {
    alchemyCloseBtn.addEventListener('click', () => closeAndGoBack());
  }

  // Brew mode card selection
  let selectedBrewMode = 'slow';
  const modeCards = document.querySelectorAll('.brew-mode-card');
  modeCards.forEach((card) => {
    card.addEventListener('click', () => {
      const mode = card.getAttribute('data-mode');
      if (!mode) return;
      selectedBrewMode = mode;
      modeCards.forEach((c) => c.classList.remove('selected'));
      card.classList.add('selected');
    });
  });

  // Confirm Brew button
  const confirmBrewBtn = document.getElementById('confirmBrewBtn');
  if (confirmBrewBtn) {
    confirmBrewBtn.addEventListener('click', () => {
      console.log('[web] Confirm brew clicked — mode:', selectedBrewMode);
      sendToRN({ type: 'brewConfirmed', payload: { modeId: selectedBrewMode } });
      closeAndGoBack();
    });
  }

  // Cancel Brew button
  const brewCancelBtn = document.getElementById('brewCancelBtn');
  if (brewCancelBtn) {
    brewCancelBtn.addEventListener('click', () => {
      console.log('[web] Cancel brew clicked');
      sendToRN({ type: 'brewCancelled', payload: {} });
      closeAndGoBack();
    });
  }
});

// Expose on window so RN can call it
(window as any).dispatchBridgeMessage = dispatchBridgeMessage;
