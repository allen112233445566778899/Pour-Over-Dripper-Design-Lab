/* ===========================================================
 * V3 EXT — 三维视图 / 几何剖面 / 3D 打印交付
 * 依赖：MODEL（含导水槽物理模型）、PRINT3（网格）、EXPORT、PRINTADVICE、VIEW3D
 * =========================================================== */
(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  var MESH = null, GEO = null, VAL = null, ADVICE = null;
  var pending = false;

  /* ---------------- 状态 ---------------- */
  function currentState() {
    var base = (window.__POUR && window.__POUR.getState)
      ? window.__POUR.getState()
      : MODEL.defaultState();
    var out = {};
    for (var k in base) if (Object.prototype.hasOwnProperty.call(base, k)) out[k] = base[k];
    out.floorThk = parseFloat(($('in_floorThk') || {}).value) || 3;
    return out;
  }

  /* ---------------- 底板厚度控件 ---------------- */
  function ensureFloorThk() {
    if ($('in_floorThk')) return;
    var wallRow = document.querySelector('.fld[data-k="wall"]');
    if (!wallRow) return;
    var grp = wallRow.parentNode;
    var row = document.createElement('div');
    row.className = 'fld';
    row.setAttribute('data-k', 'floorThk');
    var lab = document.createElement('div');
    lab.className = 'lab';
    var lb = document.createElement('label');
    lb.textContent = '底板厚度';
    lb.setAttribute('for', 'in_floorThk');
    var val = document.createElement('span');
    val.className = 'val';
    val.id = 'val_floorThk';
    lab.appendChild(lb); lab.appendChild(val);
    var ctl = document.createElement('div');
    ctl.className = 'ctl';
    var rg = document.createElement('input');
    rg.type = 'range'; rg.id = 'in_floorThk';
    rg.min = 1; rg.max = 10; rg.step = 0.1;
    var nb = document.createElement('input');
    nb.type = 'number'; nb.id = 'num_floorThk';
    nb.min = 1; nb.max = 10; nb.step = 0.1;
    rg.value = 3; nb.value = 3; val.textContent = '3mm';
    rg.addEventListener('input', function () {
      nb.value = rg.value; val.textContent = rg.value + 'mm';
      schedule();
    });
    nb.addEventListener('input', function () {
      var v = parseFloat(nb.value);
      if (isNaN(v)) return;
      v = Math.max(1, Math.min(10, v));
      rg.value = v; val.textContent = v + 'mm';
      schedule();
    });
    ctl.appendChild(rg); ctl.appendChild(nb);
    row.appendChild(lab); row.appendChild(ctl);
    grp.insertBefore(row, wallRow.nextSibling);
  }

  /* ---------------- 重建 ---------------- */
  function rebuild() {
    var S = currentState();
    var geo = MODEL.buildGeometry(S);
    try {
      GEO = PRINT3.solve(S, geo);
      MESH = PRINT3.buildMesh(S, geo);
      VAL = PRINTADVICE.validate(MESH);
      ADVICE = PRINTADVICE.advise(GEO, S, geo, MESH, VAL);
      VIEW3D.setMesh(MESH);
      VIEW3D.frameModel(MESH);
      renderPrintPanel(S);
      renderSection();
      syncGlNote();
    } catch (e) {
      console.error(e);
    }
  }

  /* ---------------- 内壁导水槽提示 ----------------
   * 壁部导水槽长在杯内侧，不剖切 / 不半透时从外面看不见，
   * 用户会以为「分段没建出来」。这里：
   *   ① 有壁部导水槽时显示一行提示；
   *   ② 分段模式首次启用时自动打开剖切，直接把分段效果露出来。 */
  var autoCutDone = false;
  function syncGlNote() {
    var note = $('glNote');
    var hasRib = !!(GEO && GEO.buildRibs);
    if (note) note.style.display = hasRib ? '' : 'none';
    if (!hasRib) { autoCutDone = false; return; }
    var segs = GEO.ribSegments;
    var isSeg = !!(segs && segs.length > 1);
    if (isSeg && !autoCutDone) {
      autoCutDone = true;
      if (!VIEW3D.getOption('section')) {
        VIEW3D.setOption('section', true);
        var b = $('btnSection');
        if (b) b.classList.add('on');
        var w = $('secRangeWrap');
        if (w) w.style.display = '';
      }
    }
  }

  function schedule() {
    if (pending) return;
    pending = true;
    requestAnimationFrame(function () { pending = false; rebuild(); });
  }

  /* ---------------- 状态变化监听 ----------------
   * 基线 UI 的「分段导水槽编辑器」（形状下拉、起止高度、条数…）、
   * 预设芯片、随机生成按钮都不在 #params 里，上面的 input/change 监听覆盖不到，
   * 会导致三维模型与左侧剖面不同步。
   * 这里监听整棵 DOM 的变化，用「状态签名」判断参数是否真的变了：
   * 只有状态变了才重建；重建本身不修改状态，因此不会自激。 */
  var lastSig = null;
  function stateSig() {
    try { return JSON.stringify(currentState()); } catch (e) { return ''; }
  }
  function watchState() {
    lastSig = stateSig();
    if (!window.MutationObserver) return;
    var mo = new MutationObserver(function () {
      if (pending) return;
      var s = stateSig();
      if (s === lastSig) return;
      lastSig = s;
      schedule();
    });
    mo.observe(document.body, { childList: true, subtree: true, characterData: true });
  }

  /* ---------------- 打印面板 ---------------- */
  function renderPrintPanel(S) {
    var dims = $('printDims');
    if (dims) {
      dims.innerHTML = '';
      var rows = [
        ['模型体积', (VAL.volume / 1000).toFixed(1) + ' cm³'],
        ['表面积', (VAL.area / 100).toFixed(1) + ' cm²'],
        ['包围盒', (VAL.bbox[3] - VAL.bbox[0]).toFixed(0) + ' × ' + (VAL.bbox[4] - VAL.bbox[1]).toFixed(0) + ' × ' + (VAL.bbox[5] - VAL.bbox[2]).toFixed(0) + ' mm'],
        ['三角面数', VAL.triCount.toLocaleString() + ' 面'],
        ['网格完整性', VAL.watertight ? '✓ 水密流形' : '✗ ' + VAL.openEdges + ' 条开放边']
      ];
      if (GEO.buildRibs) {
        /* 分段模式下各段条数可能不同，用实际建出的条数（MESH.ribStats.count）更准确 */
        var built = (MESH && MESH.ribStats) ? MESH.ribStats.count : GEO.ribCount;
        var segs = GEO.ribSegments;
        if (segs && segs.length) {
          var shapeTxt = [];
          var SH = { spiral: '螺旋', straight: '直肋', none: '光壁' };
          for (var si = 0; si < segs.length; si++) {
            var sg = segs[si];
            if (!(sg.count > 0 && sg.width > 0 && sg.depth > 0)) continue;
            shapeTxt.push((SH[sg.shape] || sg.shape) + '×' + sg.count);
          }
          rows.push(['壁部导水槽', built + ' 条（' + (shapeTxt.join(' + ') || '全光壁') + '）']);
        } else {
          rows.push(['螺旋凸肋', built + ' 条（已建出）']);
        }
      }
      if (GEO.buildGrooves) rows.push(['径向铣槽', GEO.ribCount + ' 条（已建出）']);
      rows.forEach(function (r) {
        var tr = document.createElement('tr');
        var a = document.createElement('td'); a.textContent = r[0];
        var b = document.createElement('td'); b.textContent = r[1];
        if (r[0] === '网格完整性') b.style.color = VAL.watertight ? '#15803d' : '#b91c1c';
        tr.appendChild(a); tr.appendChild(b);
        dims.appendChild(tr);
      });
    }
    var tips = $('printTips');
    if (tips) {
      tips.innerHTML = '';
      var all = [];
      ADVICE.adv.forEach(function (t) { all.push(['ok', t]); });
      ADVICE.warn.forEach(function (t) { all.push(['warn', t]); });
      GEO.notes.forEach(function (t) { all.push(['note', t]); });
      all.forEach(function (row) {
        var d = document.createElement('div');
        d.className = 'ptip ptip-' + row[0];
        d.textContent = row[1];
        tips.appendChild(d);
      });
    }
    var badge = $('printBadgeOk');
    if (badge) {
      badge.textContent = VAL.watertight ? '水密流形' : '网格异常';
      badge.className = 'badge' + (VAL.watertight ? '' : ' bad');
    }
  }

  /* ---------------- 几何剖面（可打印实体截面） ---------------- */
  function renderSection() {
    var svg = $('svgSection');
    if (!svg || !GEO) return;
    var G = GEO;
    var NS = 'http://www.w3.org/2000/svg';
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    function add(tag, attrs, parent) {
      var n = document.createElementNS(NS, tag), k;
      if (attrs) for (k in attrs) if (attrs.hasOwnProperty(k)) n.setAttribute(k, attrs[k]);
      (parent || svg).appendChild(n);
      return n;
    }
    function txt(x, y, s, fill, size, anchor) {
      var t = add('text', { x: x, y: y, fill: fill || '#6b5a4c', 'font-size': size || 10.5, 'text-anchor': anchor || 'start' });
      t.textContent = s;
      return t;
    }

    var W = 460, H = 330, padT = 26, padB = 40, padX = 46;
    var maxR = Math.max(G.rBottom, G.topOuter) * 1.06;
    var totalH = G.H;
    var scale = Math.min((W - padX * 2) / (maxR * 2), (H - padT - padB) / (totalH * 1.06));
    var cx = W / 2, baseY = H - padB;
    function X(r) { return cx + r * scale; }
    function Y(z) { return baseY - z * scale; }

    for (var gx = 0; gx <= W; gx += 40) add('line', { x1: gx, y1: 0, x2: gx, y2: H, stroke: '#f0e8dc', 'stroke-width': 1 });
    for (var gy = 0; gy <= H; gy += 40) add('line', { x1: 0, y1: gy, x2: W, y2: gy, stroke: '#f0e8dc', 'stroke-width': 1 });

    var i, d, c;

    /* 壁体：左下 → 左外壁上行 → 杯口 → 右外壁下行 → 右下 → 底面闭合 */
    d = 'M' + X(-G.rBottom).toFixed(2) + ' ' + Y(0).toFixed(2) + ' ';
    for (i = G.outer.length - 1; i >= 0; i--) {
      d += 'L' + X(-G.outer[i].r).toFixed(2) + ' ' + Y(G.outer[i].z).toFixed(2) + ' ';
    }
    d += 'L' + X(G.topInner).toFixed(2) + ' ' + Y(G.H).toFixed(2) + ' ';
    d += 'L' + X(G.topOuter).toFixed(2) + ' ' + Y(G.H).toFixed(2) + ' ';
    for (i = G.outer.length - 1; i >= 0; i--) {
      d += 'L' + X(G.outer[i].r).toFixed(2) + ' ' + Y(G.outer[i].z).toFixed(2) + ' ';
    }
    d += 'L' + X(G.rCavFloor).toFixed(2) + ' ' + Y(G.zFloor).toFixed(2) + ' ';
    d += 'L' + X(G.rCavFloor).toFixed(2) + ' ' + Y(0).toFixed(2) + ' ';
    d += 'L' + X(-G.rBottom).toFixed(2) + ' ' + Y(0).toFixed(2) + ' Z';
    add('path', { d: d, fill: '#d9cdbc', stroke: '#a89478', 'stroke-width': 1.2 });

    /* 内腔 */
    c = 'M' + X(-G.rCavFloor).toFixed(2) + ' ' + Y(G.zFloor).toFixed(2) + ' ';
    for (i = 0; i < G.cav.length; i++) {
      c += 'L' + X(-G.cav[i].r).toFixed(2) + ' ' + Y(G.cav[i].z).toFixed(2) + ' ';
    }
    c += 'L' + X(G.topInner).toFixed(2) + ' ' + Y(G.H).toFixed(2) + ' ';
    for (i = G.cav.length - 1; i >= 0; i--) {
      c += 'L' + X(G.cav[i].r).toFixed(2) + ' ' + Y(G.cav[i].z).toFixed(2) + ' ';
    }
    c += 'L' + X(G.rCavFloor).toFixed(2) + ' ' + Y(G.zFloor).toFixed(2) + ' Z';
    add('path', { d: c, fill: '#fffdf9' });

    /* 滤孔剖面（沿 x 轴切） */
    G.holes.forEach(function (h) {
      var rr = Math.sqrt(Math.max(0, h.r * h.r - h.y * h.y));
      if (rr <= 0.01) return;
      var x0 = h.x - rr, x1 = h.x + rr;
      if (Math.abs(x1) > G.rBottom) return;
      add('rect', {
        x: X(x0), y: Y(0), width: Math.max(1, (x1 - x0) * scale),
        height: Math.max(1, G.zFloor * scale),
        fill: '#fffdf9', stroke: '#a89478', 'stroke-width': 1
      });
    });

    /* 壁部导水槽（分段模式逐段按形状绘制）：
     *   spiral  螺旋凸肋 —— 剖面上是沿母线排列的离散凸起块
     *   straight 纵向直肋 —— 剖面切过每一条直肋，它们在剖面上重叠 ⇒ 表现为一条连续内凸带
     *   none    光壁 —— 不画
     */
    if (G.buildRibs) {
      var segs = G.ribSegments;
      var list = segs ? segs : [{
        shape: 'spiral', z0: G.cav[0].z, z1: G.cav[G.cav.length - 1].z,
        count: G.ribCount, width: G.ribWidth, depth: G.ribDepth, turns: G.ribTurns
      }];
      list.forEach(function (sg) {
        if (!(sg.count > 0 && sg.width > 0 && sg.depth > 0)) return;
        if (sg.shape !== 'spiral' && sg.shape !== 'straight') return;
        var wPx = Math.max(1.4, sg.width * scale);
        var dPx = Math.max(1.6, sg.depth * scale);
        if (sg.shape === 'straight') {
          /* 连续内凸带：沿 z0→z1 的母线内缘 */
          var pts = [];
          for (var ip = 0; ip <= 16; ip++) {
            var zs = sg.z0 + (sg.z1 - sg.z0) * ip / 16;
            var rs = cavRAt(G, zs);
            pts.push([X(rs) - dPx, Y(zs)]);
          }
          var band = pts.map(function (q) { return q[0].toFixed(2) + ' ' + q[1].toFixed(2); }).join(' L');
          add('path', {
            d: 'M' + band, fill: 'none', stroke: '#c2410c',
            'stroke-width': Math.max(2, wPx), 'stroke-linecap': 'butt', opacity: 0.8
          });
          return;
        }
        var m = Math.max(1, Math.round(sg.count * Math.max(1, sg.turns)));
        var step = (sg.z1 - sg.z0) / m;
        for (var ib = 0; ib < m; ib++) {
          var zc = sg.z1 - (ib + 0.5) * step;
          if (zc < sg.z0 - 1e-6) break;
          var rc = cavRAt(G, zc);
          add('rect', {
            x: (X(rc) - dPx - wPx / 2).toFixed(2),
            y: (Y(zc) - Math.max(1, wPx * 0.45)).toFixed(2),
            width: wPx.toFixed(2), height: Math.max(2, wPx * 0.9).toFixed(2),
            rx: 1, fill: '#c2410c', stroke: '#8b5a2b', 'stroke-width': 0.4, opacity: 0.85
          });
        }
      });
    }

    /* 尺寸标注 */
    add('line', { x1: X(-G.topOuter), y1: Y(G.H) - 16, x2: X(G.topOuter), y2: Y(G.H) - 16, stroke: '#9b8b7c', 'stroke-width': 1 });
    txt(cx, Y(G.H) - 21, '⌀ ' + (G.topOuter * 2).toFixed(0) + ' mm', '#6b5a4c', 11, 'middle');
    add('line', { x1: W - 14, y1: Y(0), x2: W - 14, y2: Y(G.H), stroke: '#9b8b7c', 'stroke-width': 1 });
    txt(W - 18, (Y(0) + Y(G.H)) / 2, 'H ' + G.H.toFixed(0), '#6b5a4c', 10.5, 'middle');
    add('line', { x1: X(-G.rBottom) - 24, y1: Y(0), x2: X(-G.rBottom) - 24, y2: Y(G.zFloor), stroke: '#9b8b7c', 'stroke-width': 1 });
    txt(X(-G.rBottom) - 28, (Y(0) + Y(G.zFloor)) / 2 + 3, '底 ' + G.floorThk.toFixed(1), '#6b5a4c', 10, 'middle');
    var mid = Math.floor(G.outer.length / 2);
    add('line', { x1: X(G.cav[mid].r), y1: Y(G.cav[mid].z), x2: X(G.outer[mid].r), y2: Y(G.outer[mid].z), stroke: '#c2410c', 'stroke-width': 1.2 });
    txt(X((G.cav[mid].r + G.outer[mid].r) / 2) + 6, Y((G.cav[mid].z + G.outer[mid].z) / 2) - 4, '壁厚 ' + G.wall.toFixed(1), '#c2410c', 10.5);
    txt(X(-G.rCavFloor) - 4, Y(G.zFloor) + 13, '腔底 ⌀' + (G.rCavFloor * 2).toFixed(0), '#5a3720', 10, 'end');
    if (G.holes.length) {
      var h0 = G.holes[0];
      var lbl = '⌀' + (h0.r * 2).toFixed(1) + (G.holes.length > 1 ? ' ×' + G.holes.length : '');
      txt(cx, Y(0) + 16, '滤孔 ' + lbl, '#8b5a2b', 10.5, 'middle');
    }
    if (G.buildRibs) {
      var builtN = (MESH && MESH.ribStats) ? MESH.ribStats.count : G.ribCount;
      var lbl2 = '螺旋凸肋 ×' + builtN + '（宽 ' + G.ribWidth.toFixed(1) + ' 高 ' + G.ribDepth.toFixed(1) + '）';
      if (G.ribSegments && G.ribSegments.length) {
        var sh2 = [], SH2 = { spiral: '螺旋', straight: '直肋', none: '光壁' };
        for (var sj = 0; sj < G.ribSegments.length; sj++) {
          var sgj = G.ribSegments[sj];
          sh2.push((SH2[sgj.shape] || sgj.shape) + '×' + sgj.count);
        }
        lbl2 = '壁部导水槽 ×' + builtN + '（' + sh2.join(' + ') + '）';
      }
      txt(cx, Y(0) + 30, lbl2, '#c2410c', 9.5, 'middle');
    }
  }

  /* 腔壁半径插值 */
  function cavRAt(G, z) {
    var c = G.cav;
    if (z <= c[0].z) return c[0].r;
    if (z >= c[c.length - 1].z) return c[c.length - 1].r;
    for (var i = 0; i < c.length - 1; i++) {
      if (z >= c[i].z && z <= c[i + 1].z) {
        var t = (z - c[i].z) / Math.max(1e-9, c[i + 1].z - c[i].z);
        return c[i].r + (c[i + 1].r - c[i].r) * t;
      }
    }
    return c[c.length - 1].r;
  }

  /* ---------------- 导出 ---------------- */
  function download(data, filename, mime) {
    var blob = new Blob([data], { type: mime || 'application/octet-stream' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
  }

  function fileBase(ext) {
    var S = currentState();
    var shape = S.shape === 'cone' ? '锥形' + (S.coneAngle | 0) + '度'
      : (S.shape === 'flat' ? '平底' : '直筒');
    var rib = S.ribStyle && S.ribStyle !== 'none' ? '_导水槽' + (S.ribStyle === 'spiral' ? '螺旋肋' : '铣槽') : '';
    return '手冲滤杯_' + shape + '_D' + (S.Dtop | 0) + rib + '_' + ext;
  }

  function exportSTL() {
    if (!MESH) return;
    var buf = EXPORT.toSTL(MESH, 'WorkBuddy Dripper Lab - mm - Z up');
    download(new Uint8Array(buf), fileBase('stl') + '.stl', 'model/stl');
    toast('已导出 STL（' + (buf.byteLength / 1024).toFixed(0) + ' KB）');
  }
  function export3MF() {
    if (!MESH) return;
    var S = currentState();
    var data = EXPORT.to3MF(MESH, { title: 'Pour-over Dripper D' + (S.Dtop | 0) + 'mm' });
    download(data, fileBase('3mf') + '.3mf', 'model/3mf');
    toast('已导出 3MF（' + (data.length / 1024).toFixed(0) + ' KB），可直接拖入拓竹 Bambu Studio');
  }
  function exportOBJ() {
    if (!MESH) return;
    var s = EXPORT.toOBJ(MESH, 'dripper');
    download(s, fileBase('obj') + '.obj', 'model/obj');
    toast('已导出 OBJ');
  }

  function toast(msg) {
    var t = $('toast');
    if (!t) return;
    t.textContent = msg;
    t.classList.add('on');
    clearTimeout(t._tm);
    t._tm = setTimeout(function () { t.classList.remove('on'); }, 2200);
  }

  /* ---------------- 视图切换 ---------------- */
  function switchTab(which) {
    var panes = document.querySelectorAll('[data-viewpane]');
    for (var i = 0; i < panes.length; i++) {
      panes[i].classList.toggle('on', panes[i].getAttribute('data-viewpane') === which);
    }
    var tabs = document.querySelectorAll('[data-tab]');
    for (var j = 0; j < tabs.length; j++) {
      tabs[j].classList.toggle('on', tabs[j].getAttribute('data-tab') === which);
    }
    if (which === '3d') { VIEW3D.resize(); VIEW3D.invalidate(); }
  }

  /* ---------------- 初始化 ---------------- */
  function init() {
    ensureFloorThk();

    var cv = $('cv3d');
    if (cv && VIEW3D.init(cv)) {
      VIEW3D.start();
      window.addEventListener('resize', function () { VIEW3D.resize(); });
    }

    var tabs = document.querySelectorAll('[data-tab]');
    for (var i = 0; i < tabs.length; i++) {
      (function (el) {
        el.addEventListener('click', function () { switchTab(el.getAttribute('data-tab')); });
      })(tabs[i]);
    }

    var bWire = $('btnWire'), bSec = $('btnSection'), bTrans = $('btnTrans'), bRot = $('btnRotate');
    if (bWire) bWire.addEventListener('click', function () {
      var v = !VIEW3D.getOption('wire');
      VIEW3D.setOption('wire', v); bWire.classList.toggle('on', v);
    });
    if (bSec) bSec.addEventListener('click', function () {
      var v = !VIEW3D.getOption('section');
      VIEW3D.setOption('section', v); bSec.classList.toggle('on', v);
      var w = $('secRangeWrap'); if (w) w.style.display = v ? '' : 'none';
    });
    if (bTrans) bTrans.addEventListener('click', function () {
      var v = !VIEW3D.getOption('transparent');
      VIEW3D.setOption('transparent', v); bTrans.classList.toggle('on', v);
    });
    if (bRot) bRot.addEventListener('click', function () {
      var v = !VIEW3D.getOption('autoRotate');
      VIEW3D.setOption('autoRotate', v); bRot.classList.toggle('on', v);
    });
    var sr = $('secRange');
    if (sr) sr.addEventListener('input', function () {
      VIEW3D.setOption('sectionOffset', parseFloat(sr.value) || 0);
    });

    var e1 = $('btnSTL'), e2 = $('btn3MFb') || $('btn3MF'), e3 = $('btnOBJ');
    if (e1) e1.addEventListener('click', exportSTL);
    if (e2) e2.addEventListener('click', export3MF);
    if (e3) e3.addEventListener('click', exportOBJ);

    /* 参数联动：基线 UI 的每次重绘都会同步 S，这里直接监听输入事件重建 */
    var host = $('params');
    if (host) {
      host.addEventListener('input', function (e) {
        var t = e.target;
        if (t && (t.id.indexOf('in_') === 0 || t.id.indexOf('num_') === 0)) schedule();
      }, true);
      host.addEventListener('change', function (e) {
        var t = e.target;
        if (t && t.id.indexOf('in_') === 0) schedule();
      }, true);
    }
    var chips = $('chips');
    if (chips) chips.addEventListener('click', function () { setTimeout(schedule, 0); });

    /* 全局状态监听：覆盖分段导水槽编辑器、预设、随机生成等非 #params 控件 */
    watchState();

    rebuild();
    switchTab('sec');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
