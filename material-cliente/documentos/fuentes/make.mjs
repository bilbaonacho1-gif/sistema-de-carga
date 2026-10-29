import { chromium } from 'playwright';
const [src, out] = process.argv.slice(2);
const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto('file://' + src, { waitUntil: 'load' });
await page.pdf({ path: out, format: 'A4', printBackground: true, preferCSSPageSize: true,
  displayHeaderFooter: true, headerTemplate: '<span></span>',
  footerTemplate: '<div style="width:100%;font-family:Inter,sans-serif;font-size:7.5pt;color:#8a949e;padding:0 18mm;display:flex;justify-content:space-between"><span>Diseñador 3D de depósitos · Sistemas de Carga S.A.</span><span><span class="pageNumber"></span> / <span class="totalPages"></span></span></div>' });
await browser.close();
