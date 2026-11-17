// Tiny Chrome DevTools driver. Usage: node --experimental-websocket cdp.mjs <port> <url> <script.json>
// Script: array of steps: ["wait", ms] | ["down", code] | ["up", code] | ["shot", file] | ["eval", js] | ["size", w, h]
import fs from 'node:fs';
const [port, url, scriptFile] = process.argv.slice(2);
const steps = JSON.parse(fs.readFileSync(scriptFile, 'utf8'));
const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
const ws = new WebSocket(targets.find((t) => t.type === 'page').webSocketDebuggerUrl);
let id = 0;
const pending = new Map();
const logs = [];
ws.onmessage = (event) => {
  const m = JSON.parse(event.data);
  if (m.id && pending.has(m.id)) pending.get(m.id)(m.result ?? m.error);
  if (m.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(m.params.type)) logs.push(m.params.type + ': ' + m.params.args.map((a) => a.value ?? a.description).join(' '));
  if (m.method === 'Runtime.exceptionThrown') logs.push('EXCEPCIÓN: ' + (m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text));
};
const send = (method, params = {}) => new Promise((resolve) => { pending.set(++id, resolve); ws.send(JSON.stringify({ id, method, params })); });
await new Promise((r) => (ws.onopen = r));
await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable');
// Always test the build on disk, never a copy cached by the service worker.
await send('Network.setBypassServiceWorker', { bypass: true }); await send('Network.setCacheDisabled', { cacheDisabled: true });
const KEY = { KeyK: ['k', 75], KeyJ: ['j', 74], ArrowUp: ['ArrowUp', 38], ArrowDown: ['ArrowDown', 40], ArrowLeft: ['ArrowLeft', 37], ArrowRight: ['ArrowRight', 39], Escape: ['Escape', 27], F3: ['F3', 114], Enter: ['Enter', 13] };
const key = (type, code) => send('Input.dispatchKeyEvent', { type, code, key: KEY[code][0], windowsVirtualKeyCode: KEY[code][1] });
await send('Page.navigate', { url });
for (const step of steps) {
  const [op, a, b] = step;
  if (op === 'wait') await new Promise((r) => setTimeout(r, a));
  else if (op === 'down') await key('rawKeyDown', a);
  else if (op === 'up') await key('keyUp', a);
  else if (op === 'mobile') { await send('Emulation.setDeviceMetricsOverride', { width: a, height: b, deviceScaleFactor: 2, mobile: true }); await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 }); }
  else if (op === 'touch') await send('Input.dispatchTouchEvent', { type: a, touchPoints: b.map(([x, y, tid]) => ({ x, y, id: tid })) });
  else if (op === 'size') await send('Emulation.setDeviceMetricsOverride', { width: a, height: b, deviceScaleFactor: 1, mobile: false });
  else if (op === 'shot') { const r = await send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(a, Buffer.from(r.data, 'base64')); }
  else if (op === 'eval') { const r = await send('Runtime.evaluate', { expression: a, awaitPromise: true, returnByValue: true }); console.log('eval:', JSON.stringify(r.result?.value ?? r)); }
}
console.log(logs.length ? logs.join('\n') : 'consola limpia');
ws.close();
