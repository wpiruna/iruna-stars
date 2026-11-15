/** Browser and device capabilities: full screen, orientation, install, wake lock. */

export type InputDevice = 'touch' | 'keyboard' | 'gamepad';

export const isTouchDevice = (): boolean =>
  typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;

export const isIos = (): boolean =>
  /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

/** True when launched from the home screen (installed app). */
export const isStandalone = (): boolean =>
  (typeof matchMedia === 'function' &&
    (matchMedia('(display-mode: fullscreen)').matches || matchMedia('(display-mode: standalone)').matches)) ||
  (navigator as Navigator & { standalone?: boolean }).standalone === true;

type LockableOrientation = ScreenOrientation & { lock?: (orientation: string) => Promise<void> };

/**
 * Asks for full screen and landscape. Must run inside a user gesture. Android allows it from
 * the browser; iPhone only goes full screen when opened from the home screen, so there it is
 * a no-op and the "rotate your phone" screen covers portrait.
 */
export async function enterImmersive(): Promise<void> {
  if (!isTouchDevice() || isIos()) return;
  try {
    if (!document.fullscreenElement && !isStandalone()) {
      await document.documentElement.requestFullscreen({ navigationUI: 'hide' });
    }
  } catch {
    // Refused (no gesture, embedded browser…): the game still works windowed.
  }
  try {
    await (screen.orientation as LockableOrientation).lock?.('landscape');
  } catch {
    // Not supported outside full screen on some browsers.
  }
}

let wakeLock: { release(): Promise<void> } | null = null;
/** Keeps the screen on while playing. Silently unavailable on older browsers. */
export async function keepAwake(enabled: boolean): Promise<void> {
  const api = (navigator as Navigator & { wakeLock?: { request(type: 'screen'): Promise<{ release(): Promise<void> }> } }).wakeLock;
  try {
    if (enabled && !wakeLock && api) wakeLock = await api.request('screen');
    if (!enabled && wakeLock) {
      await wakeLock.release();
      wakeLock = null;
    }
  } catch {
    wakeLock = null;
  }
}

export function vibrate(pattern: number | number[]): void {
  try {
    navigator.vibrate?.(pattern);
  } catch {
    // iPhone has no vibration from the browser.
  }
}

interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
}
let installEvent: InstallPromptEvent | null = null;

/** Android/desktop Chrome offer an install prompt; we keep it to trigger it from our button. */
export function watchInstallPrompt(onChange: (available: boolean) => void): void {
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    installEvent = event as InstallPromptEvent;
    onChange(true);
  });
  window.addEventListener('appinstalled', () => {
    installEvent = null;
    onChange(false);
  });
}

export async function promptInstall(): Promise<void> {
  await installEvent?.prompt();
  installEvent = null;
}

/** Tracks which device the player used last, so help texts can show the right controls. */
export function watchInputDevice(onChange: (device: InputDevice) => void): void {
  let current: InputDevice | null = null;
  const set = (device: InputDevice): void => {
    if (device !== current) {
      current = device;
      onChange(device);
    }
  };
  window.addEventListener('pointerdown', (event) => set(event.pointerType === 'touch' ? 'touch' : 'keyboard'), { passive: true });
  window.addEventListener('keydown', () => set('keyboard'));
  window.addEventListener('gamepadconnected', () => set('gamepad'));
  set(isTouchDevice() ? 'touch' : 'keyboard');
}

/** Stops the browser gestures that would get in the way of a game (zoom, callout, context menu). */
export function blockBrowserGestures(): void {
  const stop = (event: Event): void => event.preventDefault();
  document.addEventListener('gesturestart', stop);
  document.addEventListener('contextmenu', stop);
  document.addEventListener('dblclick', stop);
}
