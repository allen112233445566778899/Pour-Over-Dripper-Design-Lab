#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""组装单文件成品：把 src/ 下的源码与基线页面合并成一个自包含的 index.html。

用法（在仓库根目录执行）：
    python3 tools/assemble.py                # 输出 ./index.html
    python3 tools/assemble.py -o dist/x.html # 指定输出

产物是纯离线单文件：双击即可用，无需服务器、无需联网、无任何外部依赖。
"""
import re, os, sys

BASE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(BASE)
SRC = os.path.join(ROOT, 'src')

def rd(*parts):
    return open(os.path.join(SRC, *parts), encoding='utf-8').read()

src = rd('baseline.html')

css_base = rd('style.css')
model_js = rd('js', 'model_base.js')
ui_js = rd('js', 'ui_base.js')
earcut_js = rd('js', 'earcut.js')
print3_js = rd('js', 'print3.js')
export_js = rd('js', 'export.js')
advice_js = rd('js', 'printadvice.js')
view3d_js = rd('js', 'view3d.js')
v3ext_js = rd('js', 'v3ext.js')

# ---------- 新增 CSS ----------
EXTRA_CSS = """
  /* ---------- v3：视图页签 ---------- */
  .viewtabs{display:flex;gap:6px;padding:0 14px 10px;border-bottom:1px solid var(--line);background:var(--panel2);flex-wrap:wrap}
  .vtab{
    border:1px solid var(--line2);background:var(--panel);color:var(--ink2);
    border-radius:999px;padding:5px 14px;font-size:12.5px;cursor:pointer;
    transition:.16s;font-family:inherit;
  }
  .vtab:hover{border-color:var(--brand2);color:var(--brand)}
  .vtab.on{background:var(--brand);border-color:var(--brand);color:#fff;box-shadow:0 2px 8px rgba(139,90,43,.24)}
  .viewpane{display:none}
  .viewpane.on{display:block}

  /* ---------- v3：三维视图 ---------- */
  .glwrap{position:relative;background:linear-gradient(180deg,#fdfbf7 0%,#f4ede2 100%);border-radius:10px;overflow:hidden}
  #cv3d{display:block;width:100%;height:440px;touch-action:none;cursor:grab}
  #cv3d:active{cursor:grabbing}
  .glbar{
    display:flex;gap:8px;align-items:center;flex-wrap:wrap;
    padding:9px 12px;border-top:1px solid var(--line);background:var(--panel2);
  }
  .glbar .gchip{
    border:1px solid var(--line2);background:var(--panel);color:var(--ink2);
    border-radius:8px;padding:4px 11px;font-size:12px;cursor:pointer;transition:.16s;font-family:inherit;
  }
  .glbar .gchip:hover{border-color:var(--brand2);color:var(--brand)}
  .glbar .gchip.on{background:var(--brand);border-color:var(--brand);color:#fff}
  .glbar label{font-size:12px;color:var(--muted);display:flex;align-items:center;gap:6px}
  .glbar input[type=range]{width:110px}
  .glhint{font-size:11.5px;color:var(--muted);margin-left:auto}
  .glnote{
    font-size:11.5px;color:var(--ink2);background:var(--panel2);
    border-top:1px solid var(--line);padding:8px 12px;line-height:1.6;
  }

  /* ---------- v3：打印交付 ---------- */
  .ptip{
    font-size:12px;line-height:1.6;padding:6px 9px;border-radius:7px;margin-bottom:5px;
    border-left:3px solid var(--line2);background:var(--panel2);color:var(--ink2);
  }
  .ptip-ok{border-left-color:var(--ok);background:#f3faf4}
  .ptip-warn{border-left-color:var(--warn);background:#fdf8f1}
  .ptip-note{border-left-color:var(--brand2);background:#faf5ef}
  .exportrow{display:flex;gap:8px;margin-top:10px;flex-wrap:wrap}
  .exportrow .btn{flex:1;min-width:100px}
  .badge{
    display:inline-block;font-size:10.5px;padding:2px 8px;border-radius:999px;
    background:#f3faf4;color:var(--ok);border:1px solid #bfe3c9;letter-spacing:.02em;
  }
  .badge.bad{background:#fdf5f4;color:var(--bad);border-color:#e8b9b4}
  .seclab{font-size:11px;letter-spacing:.14em;color:var(--brand);text-transform:uppercase;
    display:flex;align-items:center;gap:7px;margin:0 0 8px}
  .seclab:before{content:"";width:12px;height:2px;background:var(--brand2);border-radius:2px}
"""

# ---------- 中栏：把原来的剖面卡片升级为「视图工作台」 ----------
# 用标记定位：卡片起点 = 含 '剖面视图' 的 h2 所在 card 的开标签；
#              卡片终点 = 该 card 对应的收尾 </div>（用 div 深度配平求得）
def find_card_block(html, marker):
    mi = html.index(marker)
    start = html.rindex('<div', 0, mi)
    # 从 start 起做 div 深度配平
    depth = 0
    i = start
    while i < len(html):
        m = re.compile(r'<div\b|</div>').search(html, i)
        if not m: break
        if m.group(0) == '</div>':
            depth -= 1
            if depth == 0:
                return html[start:m.end()]
        else:
            depth += 1
        i = m.end()
    raise AssertionError('card not closed')

old_card_txt = find_card_block(src, '剖面视图')

# 提取原剖面卡片内的 cbody canvas 部分（svgSide + tooltip）
inner_m = re.search(r'(<div[^>]*class="cbody canvas"[^>]*>.*?</div>\s*</div>)', old_card_txt, re.S)
assert inner_m, '剖面画布未找到'
side_canvas = inner_m.group(1)

NEW_CARD = """<div class="card">
      <h2>
        <span>视图工作台</span>
        <em>剖面 · 三维 · 几何剖面，三者实时联动</em>
      </h2>
      <div class="viewtabs" id="viewTabs">
        <button class="vtab on" data-tab="sec" type="button">流道剖面</button>
        <button class="vtab" data-tab="3d" type="button">三维模型</button>
        <button class="vtab" data-tab="geo" type="button">几何剖面</button>
      </div>
      <div class="viewpane on" data-viewpane="sec">
      """ + side_canvas + """
      </div>
      <div class="viewpane" data-viewpane="3d">
        <div class="cbody canvas">
          <div class="glwrap">
            <canvas id="cv3d" aria-label="滤杯三维模型" role="img"></canvas>
          </div>
          <div class="glbar">
            <button class="gchip" id="btnSection" type="button">剖切</button>
            <button class="gchip" id="btnWire" type="button">线框</button>
            <button class="gchip" id="btnTrans" type="button">半透</button>
            <button class="gchip" id="btnRotate" type="button">自动旋转</button>
            <label id="secRangeWrap" style="display:none">剖切面
              <input type="range" id="secRange" min="-45" max="45" step="0.5" value="0">
            </label>
            <span class="glhint">拖拽旋转 · 滚轮缩放 · 右键平移</span>
          </div>
          <div class="glnote" id="glNote" style="display:none">
            壁部导水槽在杯内侧：点「剖切」切开杯身，或点「半透」透外壁，即可看清螺旋 / 直肋 / 光壁的分段。
          </div>
        </div>
      </div>
      <div class="viewpane" data-viewpane="geo">
        <div class="cbody canvas">
          <svg id="svgSection" aria-label="滤杯几何剖面图" role="img" viewBox="0 0 460 330"></svg>
        </div>
        <div class="legend">
          <span><i style="background:#d9cdbc"></i>可打印壁体</span>
          <span><i style="background:#fffdf9; border:1px solid #a89478"></i>内腔</span>
          <span><i style="background:#c2410c"></i>螺旋凸肋</span>
        </div>
      </div>
    </div>"""

src = src.replace(old_card_txt, NEW_CARD, 1)

# ---------- 右栏：追加「3D 打印 · 交付拓竹」面板 ----------
m = re.search(r'(<div[^>]*id="solveOut"[^>]*>.*?</div>\s*</div>\s*)(</div>\s*</div>\s*</main>)', src, re.S)
assert m, '右栏锚点未找到'
PRINT_PANEL = """
      <div class="panel">
        <h2>3D 打印 · 交付拓竹 <em><span class="badge" id="printBadgeOk">水密流形</span></em></h2>
        <div class="pbody">
          <div class="seclab">模型实算</div>
          <table class="kv" id="printDims"></table>
          <div class="seclab" style="margin-top:12px">切片建议</div>
          <div id="printTips"></div>
          <div class="exportrow">
            <button class="btn primary" id="btnSTL" type="button">⬇ STL</button>
            <button class="btn" id="btn3MFb" type="button">⬇ 3MF</button>
            <button class="btn" id="btnOBJ" type="button">⬇ OBJ</button>
          </div>
          <div class="hint" style="margin-top:9px">
            单位毫米、Z 轴向上、底面贴板。STL / 3MF 可直接拖入拓竹 <b>Bambu Studio</b> 切片；
            壁部导水槽（螺旋凸肋 / 径向铣槽）已按真实几何建出。
          </div>
        </div>
      </div>
"""
src = src[:m.end(1)] + PRINT_PANEL + src[m.end(1):]

# ---------- 脚本注入 ----------
blocks = re.findall(r'<script[^>]*>.*?</script>', src, re.S)
assert len(blocks) == 3, len(blocks)
new_scripts = (
    '<script>' + model_js + '</script>\n'
    '<script>' + earcut_js + '</script>\n'
    '<script>' + print3_js + '</script>\n'
    '<script>' + export_js + '</script>\n'
    '<script>' + advice_js + '</script>\n'
    '<script>' + view3d_js + '</script>\n'
    '<script>' + ui_js + '</script>\n'
    '<script>' + v3ext_js + '</script>'
)
src = src.replace(blocks[0], '').replace(blocks[1], '').replace(blocks[2], new_scripts, 1)

# ---------- CSS 合并 ----------
css = re.search(r'<style[^>]*>(.*?)</style>', src, re.S).group(1)
src = src.replace(css, css_base + EXTRA_CSS, 1)

# ---------- 标题 ----------
src = re.sub(r'<title[^>]*>.*?</title>',
             '<title>手冲滤杯设计工坊 · 导水槽三维建模与 3D 打印交付</title>', src, count=1, flags=re.S)

# ---------- 清理编辑期残留 ----------
src = re.sub(r'\s*data-page-node-id="[^"]*"', '', src)
src = re.sub(r'\s*data-pnid-children="[^"]*"', '', src)
src = re.sub(r'<!--pnid:[^>]*?-->', '', src)

# ---------- 输出 ----------
out = 'index.html'
if '-o' in sys.argv:
    i = sys.argv.index('-o')
    if i + 1 < len(sys.argv):
        out = sys.argv[i + 1]
dest = out if os.path.isabs(out) else os.path.join(ROOT, out)
os.makedirs(os.path.dirname(dest), exist_ok=True)
open(dest, 'w', encoding='utf-8').write(src)
print('written %s  (%d bytes)' % (dest, len(src.encode('utf-8'))))
