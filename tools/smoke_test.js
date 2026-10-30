/**
 * 浏览器端冒烟测试（Playwright）
 *
 * 用法（需先 npm install --no-save playwright && npx playwright install chromium）：
 *     python3 tools/assemble.py
 *     node tools/smoke_test.js
 *
 * 检查项：
 *   1. 页面加载零控制台错误
 *   2. 三个视图页签都能切换，三维画布真的渲染出了内容（非背景像素足够多）
 *   3. 几何剖面 SVG 有标注文字
 *   4. 打印面板有数据且徽章显示「水密流形」
 *   5. 导水槽分段模式切换后三维模型确实重建（三角面数变化）
 *   6. STL / 3MF / OBJ 三个导出都能真的下载到文件
 */
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const os = require('os');

const ROOT = path.resolve(__dirname, '..');
const HTML = path.join(ROOT, 'index.html');

/* 优先用 Playwright 自带的 chromium；本地没装时回退到系统 Chrome */
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

let failed = 0;
function check(name, ok, detail) {
  console.log((ok ? '  ✓ ' : '  ✗ ') + name + (detail ? '  — ' + detail : ''));
  if (!ok) failed++;
}

(async () => {
  const browser = await chromium.launch(launchArgs());
  const ctx = await browser.newContext({
    viewport: { width: 1600, height: 1000 },
    acceptDownloads: true
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  page.on('console', m => {
    if (m.type() === 'error') errors.push('CONSOLE: ' + m.text());
  });

  await page.goto('file://' + HTML, { waitUntil: 'load' });
  await page.waitForTimeout(2500);

  console.log('\n[1] 页面加载');
  check('零控制台错误', errors.length === 0, errors.join(' | ') || '无');

  console.log('\n[2] 三维渲染');
  await page.evaluate(() => document.querySelector('[data-tab="3d"]').click());
  await page.waitForTimeout(1500);
  const gl = await page.evaluate(() => {
    const cv = document.getElementById('cv3d');
    const g = cv.getContext('webgl');
    const px = new Uint8Array(cv.width * cv.height * 4);
    g.readPixels(0, 0, cv.width, cv.height, g.RGBA, g.UNSIGNED_BYTE, px);
    let nonBg = 0;
    for (let i = 0; i < px.length; i += 4 * 37) {
      if (Math.abs(px[i] - 244) > 8 || Math.abs(px[i + 1] - 237) > 8 || Math.abs(px[i + 2] - 226) > 8) nonBg++;
    }
    return { nonBg: nonBg, w: cv.width, h: cv.height };
  });
  check('画布尺寸正常', gl.w > 100 && gl.h > 100, gl.w + '×' + gl.h);
  check('渲染出了模型（非纯背景）', gl.nonBg > 200, gl.nonBg + ' 个非背景采样点');

  console.log('\n[3] 几何剖面');
  await page.evaluate(() => document.querySelector('[data-tab="geo"]').click());
  await page.waitForTimeout(800);
  const geo = await page.evaluate(() => {
    const s = document.getElementById('svgSection');
    return { children: s.children.length, texts: Array.from(s.querySelectorAll('text')).map(t => t.textContent) };
  });
  check('剖面 SVG 有内容', geo.children > 10, geo.children + ' 个节点');
  check('有尺寸标注', geo.texts.length >= 4, geo.texts.join(' / '));

  console.log('\n[4] 打印面板');
  const pn = await page.evaluate(() => ({
    rows: document.getElementById('printDims') ? document.getElementById('printDims').children.length : -1,
    text: document.getElementById('printDims') ? document.getElementById('printDims').innerText.replace(/\n+/g, ' | ') : '',
    badge: document.getElementById('printBadgeOk') ? document.getElementById('printBadgeOk').innerText : ''
  }));
  check('面板有数据行', pn.rows >= 5, pn.rows + ' 行');
  check('徽章显示水密流形', pn.badge.indexOf('水密') >= 0, pn.badge);

  console.log('\n[5] 分段导水槽联动');
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
  await page.waitForTimeout(1500);
  const seg = await page.evaluate(() => ({
    print: document.getElementById('printDims').innerText.replace(/\n+/g, ' | '),
    badge: document.getElementById('printBadgeOk').innerText,
    cut: document.getElementById('btnSection').classList.contains('on')
  }));
  const m = seg.print.match(/三角面数\t([\d,]+) 面/);
  const tri = m ? parseInt(m[1].replace(/,/g, ''), 10) : 0;
  check('分段后模型已重建（面数变化）', tri > 0 && tri !== 30252, tri + ' 面');
  check('分段后仍是水密流形', seg.badge.indexOf('水密') >= 0, seg.badge);
  check('分段模式自动打开剖切', seg.cut === true);
  check('面板按段报告形状', seg.print.indexOf('螺旋') >= 0 && seg.print.indexOf('直肋') >= 0, seg.print.split('|').pop().trim());

  console.log('\n[6] 导出');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dripper-smoke-'));
  const targets = [['#btnSTL', 'stl'], ['#btn3MFb', '3mf'], ['#btnOBJ', 'obj']];
  for (const [sel, label] of targets) {
    const [dl] = await Promise.all([
      page.waitForEvent('download', { timeout: 15000 }).catch(() => null),
      page.evaluate(s => document.querySelector(s).click(), sel)
    ]);
    if (!dl) { check(label + ' 导出', false, '未触发下载'); continue; }
    const dest = path.join(tmp, 'out.' + label);
    await dl.saveAs(dest);
    const size = fs.statSync(dest).size;
    check(label + ' 导出', size > 1000, size + ' bytes');
  }

  console.log('\n[7] 全程控制台');
  check('零控制台错误', errors.length === 0, errors.join(' | ') || '无');

  await browser.close();
  console.log('\n' + (failed ? failed + ' 项失败' : '全部通过 ✓'));
  process.exit(failed ? 1 : 0);
})();
