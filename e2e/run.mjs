#!/usr/bin/env node
// Browser check with no extra dependencies: serves ./dist, starts a real Chrome in headless mode,
// and drives it over the DevTools protocol. Run `npm run build` first.
//
//   node e2e/run.mjs            (CHROME_PATH can point at the browser)
//
// It fails on any uncaught page error, any console error, any failed expectation, and on
// horizontal overflow at a phone-sized viewport. Screenshots go to e2e/out/.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist');
const OUT = path.join(ROOT, 'e2e', 'out');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css' };

if (!fs.existsSync(path.join(DIST, 'index.html'))) {
  console.error('dist/index.html is missing. Run `npm run build` first.');
  process.exit(2);
}
fs.mkdirSync(OUT, { recursive: true });

function findChrome() {
  const candidates = [
    process.env.CHROME_PATH,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium-browser',
    '/usr/bin/chromium',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ].filter(Boolean);
  const found = candidates.find((p) => fs.existsSync(p));
  if (!found) throw new Error('No Chrome found. Set CHROME_PATH.');
  return found;
}

const server = http.createServer((req, res) => {
  const name = decodeURIComponent((req.url ?? '/').split('?')[0]);
  const file = path.normalize(path.join(DIST, name === '/' ? 'index.html' : name));
  if (!file.startsWith(DIST) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404).end('not found');
    return;
  }
  res.writeHead(200, { 'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream' }).end(fs.readFileSync(file));
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const BASE = 'http://127.0.0.1:' + server.address().port + '/';

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'fwl-e2e-'));
const chrome = spawn(findChrome(), ['--headless=new', '--remote-debugging-port=0', '--user-data-dir=' + profile, '--no-first-run', '--no-default-browser-check', '--disable-gpu', 'about:blank'], {
  stdio: ['ignore', 'ignore', 'pipe'],
});
const debugUrl = await new Promise((resolve, reject) => {
  let seen = '';
  const timer = setTimeout(() => reject(new Error('Chrome did not report a debugging port:\n' + seen)), 30000);
  chrome.stderr.on('data', (chunk) => {
    seen += chunk;
    const m = seen.match(/DevTools listening on (ws:\/\/\S+)/);
    if (m) {
      clearTimeout(timer);
      resolve(m[1]);
    }
  });
});

let nextId = 1;
const waiting = new Map();
const pageErrors = [];
const socket = new WebSocket(debugUrl);
await new Promise((resolve, reject) => {
  socket.addEventListener('open', resolve, { once: true });
  socket.addEventListener('error', reject, { once: true });
});
socket.addEventListener('message', (event) => {
  const msg = JSON.parse(event.data);
  if (msg.id && waiting.has(msg.id)) {
    const { resolve, reject } = waiting.get(msg.id);
    waiting.delete(msg.id);
    if (msg.error) reject(new Error(msg.error.message));
    else resolve(msg.result);
    return;
  }
  if (msg.method === 'Runtime.exceptionThrown') pageErrors.push('uncaught: ' + (msg.params.exceptionDetails.exception?.description ?? msg.params.exceptionDetails.text));
  if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') pageErrors.push('console.error: ' + msg.params.args.map((a) => a.value ?? a.description).join(' '));
});
const send = (method, params = {}, sessionId) =>
  new Promise((resolve, reject) => {
    const id = nextId++;
    waiting.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
  });

const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
const page = (method, params) => send(method, params, sessionId);
await page('Page.enable');
await page('Runtime.enable');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function evaluate(expression) {
  const r = await page('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error('evaluate failed: ' + (r.exceptionDetails.exception?.description ?? r.exceptionDetails.text));
  return r.result.value;
}
async function open(url) {
  await page('Page.navigate', { url });
  for (let i = 0; i < 100; i += 1) {
    if (await evaluate('document.readyState === "complete" && !!document.querySelector("main.app")').catch(() => false)) return;
    await sleep(50);
  }
  throw new Error('page did not render: ' + url);
}
const viewport = (width, height, mobile) => page('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: mobile ? 2 : 1, mobile });
async function shot(name, wholePage = false) {
  const { data } = await page('Page.captureScreenshot', { format: 'png', captureBeyondViewport: wholePage });
  fs.writeFileSync(path.join(OUT, name), Buffer.from(data, 'base64'));
}

// Small page-side helpers. Every action waits one frame so React has committed.
const HELPERS = `
  window.__t = {
    frame: () => new Promise((r) => requestAnimationFrame(() => r())),
    byLabel: (text) => [...document.querySelectorAll('[aria-label]')].find((e) => e.getAttribute('aria-label') === text),
    radio: (name) => [...document.querySelectorAll('fieldset label')].find((l) => l.textContent.trim().startsWith(name))?.querySelector('input'),
    button: (name, root = document) => [...root.querySelectorAll('button')].find((b) => b.textContent.trim() === name),
    card: (id) => document.querySelector('[data-testid="notice-' + id + '"]'),
    async click(el) { if (!el) throw new Error('element not found'); if (el.disabled) throw new Error('element is disabled'); el.click(); await this.frame(); },
    async type(el, value) {
      if (!el) throw new Error('input not found');
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, value);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      await this.frame();
    },
    text: () => document.querySelector('main.app').innerText,
    overflow: () => document.documentElement.scrollWidth - window.innerWidth,
    stickingOut: () => {
      const column = document.querySelector('main.app').getBoundingClientRect();
      const limit = column.right - parseFloat(getComputedStyle(document.querySelector('main.app')).paddingRight) + 0.5;
      return [...document.querySelectorAll('main.app input, main.app button, main.app article, main.app fieldset')]
        .filter((e) => e.getBoundingClientRect().right > limit)
        .map((e) => e.getAttribute('aria-label') ?? e.tagName.toLowerCase());
    },
  };
  true`;

let passed = 0;
const failures = [];
function expect(name, condition, detail = '') {
  if (condition) passed += 1;
  else failures.push(name + (detail ? ' — ' + detail : ''));
  console.log((condition ? 'PASS  ' : 'FAIL  ') + name + (condition || !detail ? '' : ' — ' + detail));
}

try {
  // 1. The whole flow, as three people, in a desktop-sized window
  await viewport(1280, 800, false);
  await open(BASE);
  await evaluate(HELPERS);
  expect('opens with no notices', (await evaluate('__t.text()')).includes('보이는 통보가 없습니다.'));
  expect('the draft button is disabled until something is picked', await evaluate('__t.button("고른 지적으로 통보 초안 만들기").disabled'));
  await evaluate('__t.click(__t.byLabel("f-1 고르기")).then(() => __t.click(__t.byLabel("f-2 고르기"))).then(() => __t.click(__t.button("고른 지적으로 통보 초안 만들기")))');
  expect('a draft appears', (await evaluate('__t.card("n-3")?.innerText ?? ""')).includes('초안'));
  await evaluate('__t.click(__t.button("발행", __t.card("n-3")))');
  expect('it becomes issued', (await evaluate('__t.card("n-3").innerText')).includes('발행됨'));
  expect('the recipient has one unread', await evaluate('!!__t.byLabel("읽지 않은 통보 1건")'));
  await shot('1-inspector-issued-1280.png');

  await evaluate('__t.click(__t.radio("알파 업체 담당"))');
  expect('the recipient sees the notice', await evaluate('!!__t.card("n-3")'));
  expect('the recipient is not offered "issue"', await evaluate('!__t.button("발행", __t.card("n-3"))'));
  expect('the recipient cannot pick findings', await evaluate('!__t.byLabel("f-1 고르기")'));
  await evaluate('__t.click(__t.button("열람 확인", __t.card("n-3")))');
  expect('unread is cleared', await evaluate('!__t.byLabel("읽지 않은 통보 1건")'));
  await evaluate('__t.type(__t.byLabel("n-3 회신 내용"), "치웠습니다").then(() => __t.click(__t.button("회신", __t.card("n-3"))))');
  const afterReply = await evaluate('__t.card("n-3").innerText');
  expect('the reply is shown', afterReply.includes('회신: 치웠습니다'));
  expect('the history is in order', afterReply.includes('발행(p-inspector) → 열람(p-alpha) → 회신(p-alpha)'), afterReply);
  await shot('2-partner-replied-1280.png');

  await evaluate('__t.click(__t.radio("베타 업체 담당"))');
  const beta = await evaluate('__t.text()');
  expect('another company does not see the card', await evaluate('!__t.card("n-3")'));
  expect('another company does not see the findings text', !beta.includes('통로에 자재가 쌓여 있음') && !beta.includes('소화기 앞이 막혀 있음'));
  expect('another company does not see the totals', beta.includes('발행됨 0 · 회신됨 0'));
  expect('another company sees its own finding', beta.includes('안전 표지가 떨어져 있음'));
  await shot('3-other-company-1280.png');

  // 2. Reload: the state comes back from storage
  await open(BASE);
  await evaluate(HELPERS);
  expect('after a reload the viewer and totals are the same', (await evaluate('__t.text()')).includes('발행됨 0 · 회신됨 0') && (await evaluate('__t.radio("베타 업체 담당").checked')));
  await evaluate('__t.click(__t.radio("점검 담당"))');
  expect('after a reload the reply is still there', (await evaluate('__t.card("n-3").innerText')).includes('회신: 치웠습니다'));

  // 3. Phone-sized viewport: nothing overflows sideways
  await viewport(390, 844, true);
  await open(BASE);
  await evaluate(HELPERS);
  const overflow = await evaluate('__t.overflow()');
  expect('no horizontal overflow at 390px', overflow <= 0, 'overflow ' + overflow + 'px');
  const sticking = await evaluate('__t.stickingOut()');
  expect('no field sticks out of the page column at 390px', sticking.length === 0, sticking.join(', '));
  // The same state, as three people see it
  await shot('4-inspector-390.png', true);
  await evaluate('__t.click(__t.radio("알파 업체 담당"))');
  await shot('5-recipient-390.png', true);
  await evaluate('__t.click(__t.radio("베타 업체 담당"))');
  await shot('6-other-company-390.png', true);
  await evaluate('__t.click(__t.radio("점검 담당"))');
  await viewport(1280, 800, false);

  // 4. A broken save in storage: the page opens from the seed and says why
  await evaluate('localStorage.setItem("frontend-workflow-lab.state", JSON.stringify({ version: 2, notices: [{ id: "n-1", events: [], snapshot: { issuedAt: 1 } }] })); true');
  await open(BASE);
  await evaluate(HELPERS);
  const broken = await evaluate('__t.text()');
  expect('a broken save does not crash the page', broken.includes('보이는 통보가 없습니다.'));
  expect('and the page says the save was not used', broken.includes('저장된 내용을 읽지 못해'));

  // 5. Storage that throws on read: the page still opens
  await page('Page.addScriptToEvaluateOnNewDocument', {
    source: 'Object.defineProperty(window, "localStorage", { get() { throw new DOMException("blocked", "SecurityError"); } });',
  });
  await open(BASE);
  await evaluate(HELPERS);
  expect('blocked storage does not stop the page', (await evaluate('__t.text()')).includes('통보 흐름 실습실'));
  await evaluate('__t.click(__t.byLabel("f-3 고르기")).then(() => __t.click(__t.button("고른 지적으로 통보 초안 만들기")))');
  expect('and it works from memory', await evaluate('!!__t.card("n-3")'));
} catch (error) {
  failures.push('the run stopped: ' + error.message);
  console.log('FAIL  the run stopped — ' + error.message);
}

// The blocked-storage step makes the app report its own handled failure, not a page error.
expect('no uncaught page errors or console errors', pageErrors.length === 0, pageErrors.join(' | '));

socket.close();
chrome.kill();
server.close();
await sleep(300);
fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5 });
console.log('\ne2e: ' + passed + ' passed, ' + failures.length + ' failed');
process.exit(failures.length === 0 ? 0 : 1);
