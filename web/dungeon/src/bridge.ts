/**
 * WebView <-> React Native message bridge.
 *
 * RN sends messages via `injectJavaScript('window.dispatchBridgeMessage(...)')`.
 * We send messages back via `window.ReactNativeWebView.postMessage(...)`.
 */

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

/** Show the overlay matching the objectId */
function showOverlay(objectId: string) {
  const overlayId = OVERLAY_MAP[objectId];
  if (!overlayId) return;
  const el = document.getElementById(overlayId);
  if (el) el.classList.add('visible');
}

/** Hide an overlay element */
function hideOverlay(el: HTMLElement) {
  el.classList.remove('visible');
}

// Listen for camera-arrived — show overlay only after camera finishes moving
window.addEventListener('camera-arrived', ((e: CustomEvent) => {
  const objectId = e.detail?.objectId as string;
  if (objectId) showOverlay(objectId);
}) as EventListener);

// Wire up backdrop-close + buttons for all overlay panels
document.addEventListener('DOMContentLoaded', () => {
  // Generic backdrop click to close
  const overlayIds = ['bookOverlay', 'chestOverlay', 'alchemyOverlay'];
  for (const id of overlayIds) {
    const el = document.getElementById(id);
    if (el) {
      el.addEventListener('click', (e) => {
        if (e.target === el) hideOverlay(el);
      });
    }
  }

  // Book panel — start lesson button
  const startBtn = document.getElementById('startLessonBtn');
  if (startBtn) {
    startBtn.addEventListener('click', () => {
      const overlay = document.getElementById('bookOverlay');
      if (overlay) hideOverlay(overlay);
      console.log('[web] Start lesson clicked — navigate to Lesson screen in RN app');
    });
  }

  // Chest panel — close button
  const chestCloseBtn = document.getElementById('chestCloseBtn');
  if (chestCloseBtn) {
    chestCloseBtn.addEventListener('click', () => {
      const overlay = document.getElementById('chestOverlay');
      if (overlay) hideOverlay(overlay);
    });
  }

  // Alchemy panel — close, deposit, withdraw buttons
  const alchemyCloseBtn = document.getElementById('alchemyCloseBtn');
  if (alchemyCloseBtn) {
    alchemyCloseBtn.addEventListener('click', () => {
      const overlay = document.getElementById('alchemyOverlay');
      if (overlay) hideOverlay(overlay);
    });
  }

  const alchemyDepositBtn = document.getElementById('alchemyDepositBtn');
  if (alchemyDepositBtn) {
    alchemyDepositBtn.addEventListener('click', () => {
      console.log('[web] Deposit clicked — connect wallet / deposit flow');
      sendToRN({ type: 'depositClicked', payload: {} });
    });
  }

  const alchemyWithdrawBtn = document.getElementById('alchemyWithdrawBtn');
  if (alchemyWithdrawBtn) {
    alchemyWithdrawBtn.addEventListener('click', () => {
      console.log('[web] Withdraw clicked — withdraw flow');
      sendToRN({ type: 'withdrawClicked', payload: {} });
    });
  }

  // Hide all overlays when camera zooms back
  window.addEventListener('camera-zoom-back', () => {
    for (const id of overlayIds) {
      const el = document.getElementById(id);
      if (el) hideOverlay(el);
    }
  });
});

// Expose on window so RN can call it
(window as any).dispatchBridgeMessage = dispatchBridgeMessage;
