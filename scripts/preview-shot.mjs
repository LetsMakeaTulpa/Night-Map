#!/usr/bin/env node
/** Local visual smoke check: desktop + phone screenshots and console errors. */
import { chromium, devices } from '@playwright/test';
import { mkdir } from 'node:fs/promises';

const url = process.env.URL ?? 'http://localhost:3000';
await mkdir('artifacts', { recursive: true });
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });

const errors = [];
async function shot(name, viewport, isMobile = false) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: 1, isMobile, hasTouch: isMobile });
  const page = await context.newPage();
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(`${name}: ${msg.text()}`);
  });
  page.on('pageerror', (err) => errors.push(`${name} pageerror: ${err.message}`));
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.waitForTimeout(3500);
  await page.screenshot({ path: `artifacts/${name}.png`, fullPage: false });
  const info = await page.evaluate(() => ({
    markers: document.querySelectorAll('.nearby-row').length,
    canvas: Boolean(document.querySelector('canvas.maplibregl-canvas')),
    title: document.querySelector('.nearby-head h2')?.textContent ?? null,
    mapError: document.querySelector('.map-failed')?.textContent ?? null,
    body: document.body.innerText.slice(0, 400),
  }));
  console.log(name, JSON.stringify(info));
  await context.close();
}

await shot('desktop', { width: 1440, height: 900 });
await shot('mobile', devices['Pixel 7'].viewport, true);
await browser.close();
console.log('console errors:', errors.length ? JSON.stringify(errors, null, 2) : 'none');
