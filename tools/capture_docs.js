/**
 * 生成文档配图（docs/ 目录）
 *
 * 用法（在仓库根目录执行）：
 *     node tools/capture_docs.js
 *
 * 需要 playwright。本地没装 Playwright 自带浏览器时会自动回退到系统 Chrome。
 * 产出：
 *   docs/overview.png       界面全景（三维模型页签）
 *   docs/geometry-section.png  几何剖面页签
 *   docs/segmented-3d.png   分段导水槽的三维剖切
 *   docs/rib-detail.png     螺旋凸肋特写（离线渲染，无 WebGL 依赖）
 */
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..');
const DOCS = path.join(ROOT, 'docs');
const HTML = path.join(ROOT, 'index.html');

if (!fs.existsSync(DOCS)) fs.mkdirSync(DOCS, { recursive: true });

function launchArgs() {
  const opts = { args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--allow-file-access-from-files'] };
  const sys = [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium'
  ];
  for (const p of sys) if (fs.existsSync(p)) { opts.executablePath = p; break; }
  return opts;
}

async function clipOf(page, sel) {
  return page.evaluate((s) => {
    const e = document.querySelector(s);
    const r = e.getBoundingClientRect();
    return { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) };
  }, sel);
}

(async () => {
  const browser = await chromium.launch(launchArgs());
  const ctx = await browser.newContext({ viewport: { width: 1680, height: 1050 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  await page.goto('file://' + HTML, { waitUntil: 'load' });
  await page.waitForTimeout(2600);

  /* ---------- 1. 界面全景：三维模型页签 ---------- */
  await page.evaluate(() => document.querySelector('[data-tab="3d"]').click());
  await page.waitForTimeout(1600);
  await page.evaluate(() => {
    const r = document.getElementById('btnRotate');
    if (r && r.classList.contains('on')) r.click();
  });
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(DOCS, 'overview.png') });
  console.log('  ✓ docs/overview.png');

  /* ---------- 2. 几何剖面页签 ---------- */
  await page.evaluate(() => document.querySelector('[data-tab="geo"]').click());
  await page.waitForTimeout(900);
  const geo = await clipOf(page, '#svgSection');
  await page.screenshot({ path: path.join(DOCS, 'geometry-section.png'), clip: geo });
  console.log('  ✓ docs/geometry-section.png');

  /* ---------- 3. 分段导水槽：三维 + 剖切 ---------- */
  await page.evaluate(() => {
    const S = window.__POUR.getState();
    S.ribSegMode = 'seg';
    S.ribSegs = [
      { shape: 'spiral', z0: 0, z1: 38, count: 12, width: 2.2, depth: 1.1, turns: 1.5 },
      { shape: 'straight', z0: 38, z1: 66, count: 8, width: 2.4, depth: 1.4, turns: 1 },
      { shape: 'none', z0: 66, z1: 90.9, count: 0, width: 0, depth: 0, turns: 1 }
    ];
    window.__POUR.setState(S);
  });
  await page.waitForTimeout(1600);
  await page.evaluate(() => document.querySelector('[data-tab="3d"]').click());
  await page.waitForTimeout(1600);
  const cv = await clipOf(page, '#cv3d');
  await page.screenshot({ path: path.join(DOCS, 'segmented-3d.png'), clip: cv });
  console.log('  ✓ docs/segmented-3d.png');

  /* ---------- 4. 几何剖面（分段模式） ---------- */
  await page.evaluate(() => document.querySelector('[data-tab="geo"]').click());
  await page.waitForTimeout(900);
  const geo2 = await clipOf(page, '#svgSection');
  await page.screenshot({ path: path.join(DOCS, 'segmented-section.png'), clip: geo2 });
  console.log('  ✓ docs/segmented-section.png');

  await browser.close();
  console.log('配图生成完毕 → docs/');
})();
