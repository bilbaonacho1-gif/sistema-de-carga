import { chromium } from 'playwright';
import http from 'http'; import fs from 'fs'; import path from 'path';
const root = path.dirname(new URL(import.meta.url).pathname);
const srv = http.createServer((q, r) => { const f = path.join(root, decodeURIComponent(q.url.split('?')[0])); fs.readFile(f, (e, d) => { if (e) { r.writeHead(404); r.end(); return; } r.writeHead(200, { 'content-type': f.endsWith('.html') ? 'text/html' : 'text/javascript' }); r.end(d); }); }).listen(8766);
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
await page.goto('http://localhost:8766/scene.html');
await page.waitForFunction('window.ready === true');
await page.addStyleTag({ content: '.ov{display:none!important}' });
for (const t of process.argv.slice(2)) { await page.evaluate(t => window.renderAt(t), Number(t)); await page.screenshot({ path: path.join(root, `hero_${t}.jpg`), type: 'jpeg', quality: 90 }); }
await browser.close(); srv.close();
