/// <reference types="vitest/config" />
import preact from '@preact/preset-vite';
import { defineConfig, type Plugin } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
import { viteSingleFile } from 'vite-plugin-singlefile';

const GAME_NAME = 'Waterpolo Iruña Stars 26-27';
const SHORT_NAME = 'Iruña Stars';

/** The single-file build has no service worker: `virtual:pwa-register` resolves to a no-op. */
function pwaStub(): Plugin {
  const id = 'virtual:pwa-register';
  return {
    name: 'wis-pwa-stub',
    resolveId: (source) => (source === id ? `\0${id}` : null),
    load: (resolved) => (resolved === `\0${id}` ? 'export function registerSW() { return async () => {}; }' : null),
    // No public/ folder in this build: drop the icon links so nothing points to a missing file.
    transformIndexHtml: (html) => html.replace(/\s*<link rel="(?:icon|apple-touch-icon)"[^>]*>/g, ''),
  };
}

/**
 * One config, two outputs (GDD §2):
 *  - default mode → installable web version for GitHub Pages, in dist/
 *  - `--mode single` → one self-contained HTML (code, data and images inlined), in dist-single/
 */
export default defineConfig(({ mode, command }) => {
  const single = mode === 'single';
  // Dev server at the root; the published site lives under the repository name.
  const base = single ? './' : command === 'serve' && mode !== 'production' ? '/' : (process.env.BASE_PATH ?? '/iruna-stars/');

  return {
    base,
    publicDir: single ? false : 'public',
    define: {
      __SINGLE_FILE__: JSON.stringify(single),
      __BUILD_ID__: JSON.stringify(new Date().toISOString().slice(0, 16).replace('T', ' ')),
    },
    plugins: [
      preact(),
      ...(single ? [pwaStub(), viteSingleFile({ removeViteModuleLoader: true })] : []),
      !single &&
        VitePWA({
            registerType: 'prompt',
            injectRegister: false,
            includeAssets: ['icons/*.png'],
            workbox: {
              globPatterns: ['**/*.{js,css,html,webp,png,woff2,json}'],
              globIgnores: ['waterpolo.html'],
              cleanupOutdatedCaches: true,
              navigateFallback: 'index.html',
            },
            manifest: {
              name: GAME_NAME,
              short_name: SHORT_NAME,
              description: 'Waterpolo arcade del Waterpolo Iruña 98 02.',
              lang: 'es',
              dir: 'ltr',
              display: 'fullscreen',
              display_override: ['fullscreen', 'standalone'],
              orientation: 'landscape',
              background_color: '#061a3a',
              theme_color: '#061a3a',
              start_url: '.',
              scope: '.',
              icons: [
                { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
                { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
                { src: 'icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
              ],
            },
          }),
    ],
    build: {
      outDir: single ? 'dist-single' : 'dist',
      emptyOutDir: true,
      target: 'es2020',
      assetsInlineLimit: single ? 100_000_000 : 4096,
      chunkSizeWarningLimit: 1500,
    },
    server: { host: true },
    test: {
      environment: 'node',
      include: ['tests/**/*.test.ts'],
      globalSetup: ['tests/setup.ts'],
    },
  };
});
