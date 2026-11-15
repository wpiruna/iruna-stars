/** True in the single self-contained HTML build (no service worker, everything inlined). */
declare const __SINGLE_FILE__: boolean;
/** Build timestamp, shown in the debug layer and the data screen. */
declare const __BUILD_ID__: string;

declare module 'virtual:pwa-register' {
  export interface RegisterSWOptions {
    immediate?: boolean;
    onNeedRefresh?: () => void;
    onOfflineReady?: () => void;
    onRegisterError?: (error: unknown) => void;
  }
  export function registerSW(options?: RegisterSWOptions): (reloadPage?: boolean) => Promise<void>;
}
