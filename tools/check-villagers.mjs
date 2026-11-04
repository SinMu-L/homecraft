// Villager standability diagnosis.
// Starts the headless browser, waits for __home, then runs the §5.1 check
// against the villagers currently declared in world/layout.js.
// Usage: node tools/check-villagers.mjs <url>
import { readFileSync } from 'node:fs';

const url = process.argv[2] || '';
if (!url) {
  console.log('Pass the served URL: node tools/check-villagers.mjs http://127.0.0.1:PORT/');
  process.exit(1);
}
if (!(await fetch(url).catch(() => null))) {
  console.log(`Nothing answers at ${url}: start the site first (python3 tools/serve.py).`);
  process.exit(1);
}

// Read the villagers straight from layout.js so the check always matches source.
const layout = readFileSync(new URL('../world/layout.js', import.meta.url), 'utf8');
const m = layout.match(/villagers:\s*\[([\s\S]*?)\]/);
if (!m) { console.log('Could not find MOBS.villagers in world/layout.js'); process.exit(1); }
// Extract each {...} entry.
const entries = [...m[1].matchAll(/\{([^{}]*)\}/g)].map(x => x[1].trim());
if (!entries.length) { console.log('No villager entries found.'); process.exit(1); }

const { chromium } = await import('playwright').catch(() => {
  console.log('Playwright is not installed: run npm install once.');
  process.exit(1);
});
// The sandbox blocks named pipes, so Playwright's default remote-debugging-pipe
// launch fails with EPERM. Spawn Chrome ourselves with stdio:'ignore' and a TCP
// debugging port, then connect over CDP — no named pipe involved.
const { spawn } = await import('node:child_process');
const gpu = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
const execPath = chromium.executablePath();
const debugPort = 9222 + Math.floor(Math.random() * 1000);
const proc = spawn(execPath, [
  '--headless', '--hide-scrollbars', '--mute-audio', '--no-sandbox',
  `--remote-debugging-port=${debugPort}`,
  ...gpu,
], { stdio: 'ignore' });
// Wait for the CDP endpoint to answer.
const wait = ms => new Promise(r => setTimeout(r, ms));
let browser = null;
for (let i = 0; i < 40; i++) {
  await wait(250);
  try { browser = await chromium.connectOverCDP(`http://127.0.0.1:${debugPort}`); break; }
  catch { /* retry */ }
}
if (!browser) { try { proc.kill() } catch {}; console.log('Could not connect to Chrome CDP.'); process.exit(1); }

const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', e => errors.push(e.message));
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });

await page.goto(url, { waitUntil: 'load' });
await page.waitForFunction(() => window.__home?.player || window.__homeStartupError, null, { timeout: 60000 });
const startup = await page.evaluate(() => window.__homeStartupError || null);
if (startup) {
  console.log(`3D did not start (${startup.phase}: ${startup.message})`);
  await browser.close(); process.exit(1);
}
// Let nav finish building.
await page.waitForTimeout(3000);

// Hand the parsed entries to the page and evaluate.
const diag = await page.evaluate(async (entries) => {
  const parse = s => Object.fromEntries(s.split(',').map(p => {
    const [k, ...v] = p.trim().split(/[:\s]+/);
    const val = v.join(' ').trim();
    const n = Number(val);
    return [k, isNaN(n) ? val.replace(/['"]/g, '') : n];
  }));
  const villagers = entries.map(parse);
  const nav = window.__home.nav;
  return villagers.map(v => ({
    ...v,
    canStand: nav.canStand(v.x, v.z),
    floor: nav.heightAt(v.x, v.z),
  }));
}, entries);

console.log('Villager diagnosis:');
for (const v of diag) {
  const tag = v.canStand ? 'OK' : 'FAIL';
  console.log(`  [${tag}] x=${v.x} z=${v.z} yaw=${v.yaw} station=${v.station} work=${v.work}  floor=${v.floor}`);
}
const allOk = diag.every(v => v.canStand);
console.log(allOk ? 'All villagers can stand.' : 'Some villagers cannot stand — see FAIL above.');
if (errors.length) console.log('Console errors:\n' + errors.map(e => '  ' + e).join('\n'));

await browser.close();
try { proc.kill() } catch {}
process.exit(allOk ? 0 : 1);
