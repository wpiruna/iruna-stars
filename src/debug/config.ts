/**
 * The debug layer (GDD §20). Open it with F3 or the º key, with `?debug=1` in the address, or
 * by tapping the build label on the menu five times. Set to false for the final release.
 */
export const DEBUG_AVAILABLE = true;

export function debugRequestedByUrl(): boolean {
  try {
    return new URLSearchParams(window.location.search).has('debug');
  } catch {
    return false;
  }
}

/** `?pantalla=datos&pestana=equipo` opens a screen directly: handy for checks and screenshots. */
export function debugParam(name: string): string | null {
  if (!DEBUG_AVAILABLE) return null;
  try {
    return new URLSearchParams(window.location.search).get(name);
  } catch {
    return null;
  }
}
