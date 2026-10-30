
(function () {
  'use strict';

  var S = MODEL.defaultState();
  var RESULT = null;
  var COMPARE = [];
  var SVGNS = 'http://www.w3.org/2000/svg';

  function $(id) { return document.getElementById(id); }
  function el(tag, attrs, parent) {
    var n = document.createElementNS(SVGNS, tag), k;
    if (attrs) for (k in attrs) if (attrs.hasOwnProperty(k)) n.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(n);
    return n;
  }
  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }
  function fmt(v, d) { return (v === null || v === undefined || !isFinite(v)) ? '—' : Number(v).toFixed(d); }
  function clock(sec) {
    if (!sec || !isFinite(sec)) return '—';
    var m = Math.floor(sec / 60), s = Math.round(sec % 60);
    if (s === 60) { m += 1; s = 0; }
    return m + ':' + (s < 10 ? '0' : '') + s;
  }

  /* ============ 参数定义 ============ */
  var GROUPS = [
    {
      title: '杯体几何', items: [
        { k: 'shape', label: '杯型', type: 'select', options: [
          ['cone', '锥形 · V60 / Origami 类'], ['flat', '平底 · Kalita / Chemex 类'], ['cyl', '直筒 · 圆柱段']
        ]},
        { k: 'Dtop', label: '上口直径', min: 60, max: 180, step: 1, unit: 'mm' },
        { k: 'coneAngle', label: '锥角（全角）', min: 20, max: 80, step: 1, unit: '°', when: function (s) { return s.shape === 'cone'; } },
        { k: 'r0', label: '底面半径', min: 3, max: 45, step: 0.5, unit: 'mm', when: function (s) { return s.shape !== 'cyl'; } },
        { k: 'flatDepth', label: '平底深度', min: 0, max: 30, step: 1, unit: 'mm', when: function (s) { return s.shape === 'flat'; } },
        { k: 'wallTilt', label: '侧壁倾角', min: 2, max: 35, step: 0.5, unit: '°', when: function (s) { return s.shape === 'flat'; } },
        { k: 'cylH', label: '直筒高度', min: 40, max: 150, step: 1, unit: 'mm', when: function (s) { return s.shape === 'cyl'; } },
        { k: 'wall', label: '壁厚', min: 0.5, max: 8, step: 0.1, unit: 'mm' },
        { k: 'material', label: '材质', type: 'select', options: [
          ['pp', 'PP 塑料（轻）'], ['pet', 'PET 塑料'], ['glass', '耐热玻璃'], ['ceramic', '陶瓷'], ['steel', '304 不锈钢'], ['titanium', '钛合金']
        ]}
      ]
    },
    {
      title: '滤孔布局', items: [
        { k: 'holeLayout', label: '布局', type: 'select', options: [
          ['single', '中心单孔'], ['ring', '环形均布'], ['cluster', '中心 + 环 复合']
        ]},
        { k: 'holeCount', label: '孔数', min: 1, max: 24, step: 1, unit: '孔' },
        { k: 'holeD', label: '单孔直径', min: 2, max: 40, step: 0.5, unit: 'mm' },
        { k: 'ringR', label: '环形半径', min: 0, max: 40, step: 0.5, unit: 'mm', when: function (s) { return s.holeLayout !== 'single'; } }
      ]
    },
    {
      title: '壁部导水槽', items: [
        { k: 'ribStyle', label: '导水槽形式', type: 'select', options: [
          ['none', '无 · 光壁光底'],
          ['spiral', '螺旋凸肋 · 壁面排气泄压（锥形杯）'],
          ['radial', '径向铣槽 · 底面导流汇流（平底/直筒杯）']
        ]},
        { k: 'ribSegMode', label: '分段模式', type: 'select', options: [
          ['single', '整壁统一 · 单一规格通体'],
          ['seg', '分段设计 · 每段可不同形状']
        ], when: function (s) { return s.ribStyle === 'spiral'; } },
        { k: 'ribCount', label: '肋 / 槽数量', min: 0, max: 24, step: 1, unit: ' 条',
          when: function (s) { return s.ribStyle !== 'none' && s.ribSegMode !== 'seg'; } },
        { k: 'ribWidth', label: '肋宽 / 槽宽', min: 0.5, max: 8, step: 0.1, unit: ' mm',
          when: function (s) { return s.ribStyle !== 'none' && s.ribSegMode !== 'seg'; } },
        { k: 'ribDepth', label: '肋高 / 槽深', min: 0.2, max: 4, step: 0.1, unit: ' mm',
          when: function (s) { return s.ribStyle !== 'none' && s.ribSegMode !== 'seg'; } },
        { k: 'ribTurns', label: '螺旋圈数', min: 0.5, max: 3, step: 0.25, unit: ' 圈',
          when: function (s) { return s.ribStyle === 'spiral' && s.ribSegMode !== 'seg'; } },
        { k: 'ribSegs', label: '分段结构', type: 'segEditor',
          when: function (s) { return s.ribStyle === 'spiral' && s.ribSegMode === 'seg'; } },
        { k: 'ribCoverage', label: '导水槽覆盖率', type: 'static',
          when: function (s) { return s.ribStyle !== 'none'; } }
      ]
    },
    {
      title: '咖啡与冲煮', items: [
        { k: 'dose', label: '粉量', min: 6, max: 40, step: 0.5, unit: 'g' },
        { k: 'grind', label: '研磨度', min: 0, max: 100, step: 1, unit: '', extra: function (s) { return MODEL.grindLabel(s.grind); } },
        { k: 'ratio', label: '粉水比', min: 8, max: 25, step: 0.5, unit: ' g/g' },
        { k: 'bloomMult', label: '闷蒸水量', min: 0, max: 6, step: 0.1, unit: '× 粉量' },
        { k: 'bloomTime', label: '闷蒸时长', min: 0, max: 120, step: 5, unit: 's' },
        { k: 'pourCount', label: '注水段数', min: 1, max: 6, step: 1, unit: '段' },
        { k: 'pourTime', label: '注水总时长', min: 10, max: 240, step: 5, unit: 's' },
        { k: 'temp', label: '水温', min: 80, max: 100, step: 1, unit: '°C' }
      ]
    }
  ];

  var INPUTS = {};

  function buildParams() {
    var host = $('params');
    clear(host);
    GROUPS.forEach(function (grp) {
      var g = document.createElement('div');
      g.className = 'grp';
      var h = document.createElement('h3');
      h.textContent = grp.title;
      g.appendChild(h);
      grp.items.forEach(function (item) {
        g.appendChild(buildField(item));
      });
      host.appendChild(g);
    });
  }

  function buildField(item) {
    var wrap = document.createElement('div');
    wrap.className = 'fld';
    wrap.setAttribute('data-k', item.k);

    var lab = document.createElement('div');
    lab.className = 'lab';
    var l = document.createElement('label');
    l.textContent = item.label;
    l.setAttribute('for', 'in_' + item.k);
    var val = document.createElement('span');
    val.className = 'val';
    val.id = 'val_' + item.k;
    lab.appendChild(l); lab.appendChild(val);
    wrap.appendChild(lab);

    var ctl = document.createElement('div');
    ctl.className = 'ctl';

    if (item.type === 'segEditor') {
      var sh = document.createElement('div');
      sh.id = 'segEditorHost';
      sh.className = 'seghost';
      wrap.appendChild(sh);
      INPUTS[item.k] = { type: 'segEditor', node: sh };
      val.style.display = 'none';
      return wrap;
    }
    if (item.type === 'static') {
      // 只读展示行：数值由 renderMetrics 回填
      var st = document.createElement('div');
      st.className = 'hint';
      st.id = 'static_' + item.k;
      st.style.margin = '-2px 0 10px';
      wrap.appendChild(st);
      INPUTS[item.k] = { type: 'static', node: st };
      return wrap;
    }
    if (item.type === 'select') {
      var sel = document.createElement('select');
      sel.id = 'in_' + item.k;
      item.options.forEach(function (op) {
        var o = document.createElement('option');
        o.value = op[0]; o.textContent = op[1];
        sel.appendChild(o);
      });
      sel.addEventListener('change', function () {
        S[item.k] = sel.value;
        if (item.k === 'holeLayout' && S.ringR === 0 && S.holeLayout !== 'single') S.ringR = 12;
        onChange(item.k);
      });
      ctl.appendChild(sel);
      INPUTS[item.k] = { type: 'select', node: sel };
      val.style.display = 'none';
    } else {
      var rg = document.createElement('input');
      rg.type = 'range'; rg.id = 'in_' + item.k;
      rg.min = item.min; rg.max = item.max; rg.step = item.step;
      rg.addEventListener('input', function () {
        S[item.k] = parseFloat(rg.value);
        onChange(item.k);
      });
      var nb = document.createElement('input');
      nb.type = 'number'; nb.id = 'num_' + item.k;
      nb.min = item.min; nb.max = item.max; nb.step = item.step;
      nb.addEventListener('input', function () {
        var v = parseFloat(nb.value);
        if (isNaN(v)) return;
        S[item.k] = MODEL.clamp(v, item.min, item.max);
        onChange(item.k);
      });
      ctl.appendChild(rg); ctl.appendChild(nb);
      INPUTS[item.k] = { type: 'range', range: rg, num: nb };
    }
    wrap.appendChild(ctl);
    return wrap;
  }

  function syncParams() {
    GROUPS.forEach(function (grp) {
      grp.items.forEach(function (item) {
        var rec = INPUTS[item.k];
        if (!rec) return;
        var row = document.querySelector('.fld[data-k="' + item.k + '"]');
        if (item.when && !item.when(S)) { if (row) row.classList.add('hide'); return; }
        if (row) row.classList.remove('hide');
        if (rec.type === 'static') {
          // 由 renderMetrics 填充
        } else if (rec.type === 'segEditor') {
          // 由 renderSegEditor 填充
        } else if (rec.type === 'select') {
          rec.node.value = S[item.k];
        } else {
          rec.range.value = S[item.k];
          if (document.activeElement !== rec.num) rec.num.value = S[item.k];
          var v = $('val_' + item.k);
          if (item.extra) v.textContent = item.extra(S);
          else v.textContent = S[item.k] + (item.unit || '');
        }
      });
    });
  }

  var pending = false;
  function onChange(key) {
    if (key === 'ribSegMode' && S.ribSegMode === 'seg') {
      if (!S.ribSegs || !S.ribSegs.length) {
        var H = (RESULT && RESULT.geo) ? RESULT.geo.height : 90;
        S.ribSegs = [{
          shape: 'spiral', z0: 0, z1: H,
          count: S.ribCount, width: S.ribWidth, depth: S.ribDepth, turns: S.ribTurns
        }];
      }
    }
    if (key === 'ribStyle' && S.ribStyle === 'spiral' && S.ribSegMode === 'seg') {
      if (!S.ribSegs || !S.ribSegs.length) {
        var H2 = (RESULT && RESULT.geo) ? RESULT.geo.height : 90;
        S.ribSegs = [{
          shape: 'spiral', z0: 0, z1: H2,
          count: S.ribCount, width: S.ribWidth, depth: S.ribDepth, turns: S.ribTurns
        }];
      }
    }
    syncParams();
    if (pending) return;
    pending = true;
    window.requestAnimationFrame(function () { pending = false; render(); });
  }

  /* ============ 预设 ============ */
  function buildChips() {
    var host = $('chips');
    clear(host);
    MODEL.PRESETS.forEach(function (p, i) {
      var b = document.createElement('button');
      b.className = 'chip' + (i === 0 ? ' on' : '');
      b.type = 'button';
      b.textContent = '';
      b.appendChild(document.createTextNode(p.name));
      var sm = document.createElement('small');
      sm.textContent = p.tag;
      b.appendChild(sm);
      b.addEventListener('click', function () {
        S = JSON.parse(JSON.stringify(p.S));
        Array.prototype.forEach.call(host.children, function (c) { c.classList.remove('on'); });
        b.classList.add('on');
        syncParams(); render();
      });
      host.appendChild(b);
    });
  }

  /* ============ 侧视图 ============ */
  var VB = { w: 460, h: 340 };
  function renderSide() {
    var svg = $('svgSide');
    clear(svg);
    var geo = RESULT.geo, P = geo.P;
    var padT = 26, padB = 34, padX = 46;
    var scale = RESULT.scale;
    var cx = VB.w / 2, baseY = VB.h - padB;

    function X(r) { return cx + r * scale; }
    function Y(z) { return baseY - z * scale; }

    var rTop = S.Dtop / 2;
    var off = S.wall / Math.max(0.15, Math.cos(Math.atan(P.tan)));   // 壁厚水平投影
    var halfAng = Math.atan(P.tan);
    var wallOffset = P.tan > 0.01 ? S.wall / Math.cos(halfAng) : S.wall;

    /* 背景网格 */
    for (var gx = 0; gx <= VB.w; gx += 40) el('line', { x1: gx, y1: 0, x2: gx, y2: VB.h, stroke: '#f0e8dc', 'stroke-width': 1 }, svg);
    for (var gy = 0; gy <= VB.h; gy += 40) el('line', { x1: 0, y1: gy, x2: VB.w, y2: gy, stroke: '#f0e8dc', 'stroke-width': 1 }, svg);

    /* 内壁轮廓采样 */
    var pts = [], N = 48, i;
    for (i = 0; i <= N; i++) {
      var z = P.H * i / N;
      pts.push({ z: z, r: MODEL.radiusAt(P, z) });
    }

    function innerPath(reverse) {
      var d = '', k;
      for (k = 0; k < pts.length; k++) {
        var p = pts[reverse ? pts.length - 1 - k : k];
        d += (k === 0 ? 'M' : 'L') + X(p.r).toFixed(2) + ' ' + Y(p.z).toFixed(2) + ' ';
      }
      return d;
    }

    /* 杯体 */
    var body = '';
    body += 'M' + X(-(P.r0 + wallOffset)).toFixed(2) + ' ' + Y(0).toFixed(2) + ' ';
    for (i = 0; i <= N; i++) { body += 'L' + X(-(pts[i].r + wallOffset)).toFixed(2) + ' ' + Y(pts[i].z).toFixed(2) + ' '; }
    body += 'L' + X(rTop + wallOffset).toFixed(2) + ' ' + Y(P.H).toFixed(2) + ' ';
    body += 'L' + X(-(rTop + wallOffset)).toFixed(2) + ' ' + Y(P.H).toFixed(2) + ' ';
    for (i = N; i >= 0; i--) { body += 'L' + X(-(pts[i].r + wallOffset)).toFixed(2) + ' ' + Y(pts[i].z).toFixed(2) + ' '; }
    body += 'Z';
    el('path', { d: body, fill: '#d9cdbc', stroke: '#b7a58c', 'stroke-width': 1 }, svg);

    /* 内腔（白） */
    var cavity = 'M' + X(P.r0).toFixed(2) + ' ' + Y(0).toFixed(2) + ' ';
    for (i = 0; i <= N; i++) { cavity += 'L' + X(pts[i].r).toFixed(2) + ' ' + Y(pts[i].z).toFixed(2) + ' '; }
    for (i = N; i >= 0; i--) { cavity += 'L' + X(-pts[i].r).toFixed(2) + ' ' + Y(pts[i].z).toFixed(2) + ' '; }
    cavity += 'Z';
    el('path', { d: cavity, fill: '#fffdf9' }, svg);

    /* 咖啡粉床 */
    var zB = geo.zBed, rB = geo.rBedTop;
    var bed = 'M' + X(P.r0).toFixed(2) + ' ' + Y(0).toFixed(2) + ' ';
    var bedPts = [], m;
    for (m = 0; m <= 24; m++) {
      var zb = zB * m / 24;
      bedPts.push({ z: zb, r: MODEL.radiusAt(P, zb) });
    }
    for (m = 0; m < bedPts.length; m++) bed += 'L' + X(bedPts[m].r).toFixed(2) + ' ' + Y(bedPts[m].z).toFixed(2) + ' ';
    for (m = bedPts.length - 1; m >= 0; m--) bed += 'L' + X(-bedPts[m].r).toFixed(2) + ' ' + Y(bedPts[m].z).toFixed(2) + ' ';
    bed += 'Z';
    el('path', { d: bed, fill: 'url(#bedGrad)', stroke: '#5a3720', 'stroke-width': 1 }, svg);

    /* 存水 */
    var zW = RESULT.maxWaterZ;
    if (zW && zW > zB + 0.4) {
      var rW = MODEL.radiusAt(P, zW);
      var water = 'M' + X(rB).toFixed(2) + ' ' + Y(zB).toFixed(2) + ' ';
      var wp = [], n;
      for (n = 0; n <= 24; n++) {
        var zw = zB + (zW - zB) * n / 24;
        wp.push({ z: zw, r: MODEL.radiusAt(P, zw) });
      }
      for (n = 0; n < wp.length; n++) water += 'L' + X(wp[n].r).toFixed(2) + ' ' + Y(wp[n].z).toFixed(2) + ' ';
      for (n = wp.length - 1; n >= 0; n--) water += 'L' + X(-wp[n].r).toFixed(2) + ' ' + Y(wp[n].z).toFixed(2) + ' ';
      water += 'Z';
      el('path', { d: water, fill: 'url(#waterGrad)', stroke: '#7ba7c9', 'stroke-width': 1 }, svg);
      el('line', { x1: X(-rW), y1: Y(zW), x2: X(rW), y2: Y(zW), stroke: '#5f93b8', 'stroke-width': 1.5, 'stroke-dasharray': '5 3' }, svg);
      el('text', { x: X(rW) + 6, y: Y(zW) + 4, fill: '#5f93b8', 'font-size': 10 }, svg).textContent = '最高水位';
    }

    /* 滤纸 */
    var paper = 'M' + X(P.r0 + 0.6).toFixed(2) + ' ' + Y(0).toFixed(2) + ' ';
    for (i = 0; i <= N; i++) paper += 'L' + X(pts[i].r + 0.6).toFixed(2) + ' ' + Y(pts[i].z).toFixed(2) + ' ';
    for (i = N; i >= 0; i--) paper += 'L' + X(-(pts[i].r + 0.6)).toFixed(2) + ' ' + Y(pts[i].z).toFixed(2) + ' ';
    paper += 'Z';
    el('path', { d: paper, fill: 'none', stroke: '#b9a893', 'stroke-width': 1, 'stroke-dasharray': '4 3' }, svg);

    /* 壁部导水槽（剖面） */
    drawRibsSide(svg, X, Y, geo, P, scale);

    /* 底部滤孔（剖面） */
    var holePos = holePositions();
    if (S.holeLayout === 'single') {
      var hd = S.holeD / 2;
      el('rect', { x: X(-hd), y: Y(0) - 1, width: Math.max(2, hd * 2 * scale), height: 8, fill: '#fffdf9', stroke: '#a9977f', 'stroke-width': 1 }, svg);
    } else {
      holePos.forEach(function (hp) {
        if (Math.abs(hp.x) < 0.8) {
          var h2 = S.holeD / 2;
          el('rect', { x: X(-h2), y: Y(0) - 1, width: Math.max(2, h2 * 2 * scale), height: 8, fill: '#fffdf9', stroke: '#a9977f', 'stroke-width': 1 }, svg);
        } else {
          el('ellipse', { cx: X(hp.x), cy: Y(0) - 3, rx: Math.max(1.5, S.holeD / 2 * scale), ry: 2.6, fill: '#fffdf9', stroke: '#a9977f', 'stroke-width': 1 }, svg);
        }
      });
    }

    /* 标注 */
    el('line', { x1: X(-rTop), y1: Y(P.H) - 16, x2: X(rTop), y2: Y(P.H) - 16, stroke: '#9b8b7c', 'stroke-width': 1, 'marker-start': 'url(#arw)', 'marker-end': 'url(#arw)' }, svg);
    var t1 = el('text', { x: cx, y: Y(P.H) - 21, fill: '#6b5a4c', 'font-size': 11, 'text-anchor': 'middle' }, svg);
    t1.textContent = '⌀ ' + fmt(S.Dtop, 0) + ' mm';

    el('line', { x1: X(rTop + wallOffset) + 12, y1: Y(0), x2: X(rTop + wallOffset) + 12, y2: Y(P.H), stroke: '#9b8b7c', 'stroke-width': 1 }, svg);
    var t2 = el('text', { x: X(rTop + wallOffset) + 17, y: Y(P.H / 2), fill: '#6b5a4c', 'font-size': 11 }, svg);
    t2.textContent = '高 ' + fmt(geo.height, 0) + ' mm';

    var t3 = el('text', { x: X(-P.r0) - 6, y: Y(zB) + 4, fill: '#5a3720', 'font-size': 10.5, 'text-anchor': 'end' }, svg);
    t3.textContent = '粉床 ' + fmt(zB, 0) + ' mm';
    el('line', { x1: X(-P.r0) - 2, y1: Y(zB), x2: X(-P.r0) - 62, y2: Y(zB), stroke: '#c9b89d', 'stroke-width': 1 }, svg);

    /* 控制点 */
    mkHandle(svg, X(rTop + wallOffset), Y(P.H), 'rim', '上口直径', function () { return S.Dtop + ' mm'; });
    if (P.tan > 0.01) {
      var hz = P.H * 0.45;
      mkHandle(svg, X(MODEL.radiusAt(P, hz)), Y(hz), 'angle',
        S.shape === 'cone' ? '锥角' : '侧壁倾角',
        function () { return (S.shape === 'cone' ? S.coneAngle : S.wallTilt) + '°'; });
    }
    if (S.shape !== 'cyl') mkHandle(svg, X(P.r0), Y(P.zFlat > 0 ? P.zFlat : 0), 'r0', '底面半径', function () { return S.r0 + ' mm'; });
    mkHandle(svg, X(0), Y(0) + 14, 'hole', '单孔直径', function () { return S.holeD + ' mm'; });

    /* 渐变定义 */
    var defs = el('defs', {}, svg);
    var g1 = el('linearGradient', { id: 'bedGrad', x1: 0, y1: 0, x2: 0, y2: 1 }, defs);
    el('stop', { offset: '0%', 'stop-color': '#a06a3c' }, g1);
    el('stop', { offset: '100%', 'stop-color': '#6a3d1c' }, g1);
    var g2 = el('linearGradient', { id: 'waterGrad', x1: 0, y1: 0, x2: 0, y2: 1 }, defs);
    el('stop', { offset: '0%', 'stop-color': '#bcd8ec' }, g2);
    el('stop', { offset: '100%', 'stop-color': '#7fb0d4' }, g2);
    var mk = el('marker', { id: 'arw', viewBox: '0 0 8 8', refX: 4, refY: 4, markerWidth: 7, markerHeight: 7, orient: 'auto-start-reverse' }, defs);
    el('path', { d: 'M0 0 L8 4 L0 8 z', fill: '#9b8b7c' }, mk);

    svg.appendChild(defs);
  }

  /* ============ 分段导水槽编辑器 ============ */
  var SEG_LABEL = { spiral: '螺旋凸肋', straight: '纵向直肋', none: '光壁（无凸肋）' };
  var SEG_SHORT = { spiral: '螺旋凸肋', straight: '纵向直肋', none: '光壁' };

  function segShapeColor(sh) {
    if (sh === 'spiral') return 'var(--rib)';
    if (sh === 'straight') return 'var(--seg2)';
    return 'var(--seg3)';
  }

  // 分段编辑器：渲染到「壁部导水槽」参数组的分段结构区
  function renderSegEditor(geo) {
    var host = $('segEditorHost');
    if (!host) return;
    clear(host);
    if (S.ribSegMode !== 'seg' || S.ribStyle !== 'spiral') return;
    var H = geo && geo.height ? geo.height : 90;
    if (!S.ribSegs || !S.ribSegs.length) {
      S.ribSegs = [{
        shape: 'spiral', z0: 0, z1: H,
        count: S.ribCount, width: S.ribWidth, depth: S.ribDepth, turns: S.ribTurns
      }];
    }
    var segs = S.ribSegs;

    var tip = document.createElement('div');
    tip.className = 'segtag';
    tip.style.marginBottom = '7px';
    tip.style.fontSize = '10.5px';
    tip.style.color = 'var(--muted)';
    tip.style.lineHeight = '1.55';
    tip.textContent = '沿母线高度方向把壁面切成若干段，每段可选不同形状。'
      + '泄压通道沿母线是串联的：任何一段光壁都会成为瓶颈，把整条排气通路堵死。';
    host.appendChild(tip);

    for (var i = 0; i < segs.length; i++) {
      (function (idx) {
        var sg = segs[idx];
        var row = document.createElement('div');
        row.className = 'segrow sh-' + sg.shape;

        var hd = document.createElement('div');
        hd.className = 'seghd';
        var no = document.createElement('span');
        no.className = 'segno';
        no.textContent = '第 ' + (idx + 1) + ' 段';
        hd.appendChild(no);

        var sel = document.createElement('select');
        var opts = [['spiral', '螺旋凸肋（盘旋）'], ['straight', '纵向直肋（直上）'], ['none', '光壁（无凸肋）']];
        opts.forEach(function (op) {
          var o = document.createElement('option');
          o.value = op[0]; o.textContent = op[1];
          if (sg.shape === op[0]) o.selected = true;
          sel.appendChild(o);
        });
        sel.addEventListener('change', function () {
          segs[idx].shape = sel.value;
          if (segs[idx].count === 0 && sel.value !== 'none') {
            segs[idx].count = S.ribCount || 12;
            segs[idx].width = S.ribWidth || 2.2;
            segs[idx].depth = S.ribDepth || 1.1;
            segs[idx].turns = S.ribTurns || 1.5;
          }
          onChange('ribSegs');
        });
        hd.appendChild(sel);

        var tag = document.createElement('span');
        tag.className = 'segtag';
        tag.textContent = SEG_LABEL[sg.shape] + ' · 高 ' + fmt(sg.z1 - sg.z0, 1) + ' mm';
        hd.appendChild(tag);

        var del = document.createElement('button');
        del.className = 'segbtn';
        del.type = 'button';
        del.textContent = '删除';
        del.addEventListener('click', function () {
          if (segs.length <= 1) { toast('至少保留一段'); return; }
          segs.splice(idx, 1);
          onChange('ribSegs');
        });
        hd.appendChild(del);
        row.appendChild(hd);

        var ctl = document.createElement('div');
        ctl.className = 'segctl';

        // 起止高度
        ctl.appendChild(segNum('起', sg.z0, 0, H, 0.5, 'z', function (v) {
          segs[idx].z0 = Math.min(v, segs[idx].z1);
          onChange('ribSegs');
        }));
        ctl.appendChild(segNum('止', sg.z1, 0, H, 0.5, 'z', function (v) {
          segs[idx].z1 = Math.max(v, segs[idx].z0);
          onChange('ribSegs');
        }));

        if (sg.shape !== 'none') {
          ctl.appendChild(segNum('条数', sg.count, 0, 24, 1, '', function (v) {
            segs[idx].count = Math.round(v); onChange('ribSegs');
          }));
          ctl.appendChild(segNum('肋宽', sg.width, 0.2, 8, 0.1, '', function (v) {
            segs[idx].width = v; onChange('ribSegs');
          }));
          ctl.appendChild(segNum('肋高', sg.depth, 0.1, 4, 0.1, '', function (v) {
            segs[idx].depth = v; onChange('ribSegs');
          }));
          if (sg.shape === 'spiral') {
            ctl.appendChild(segNum('圈数', sg.turns, 0.25, 3, 0.25, '', function (v) {
              segs[idx].turns = v; onChange('ribSegs');
            }));
          }
        }
        row.appendChild(ctl);
        host.appendChild(row);
      })(i);
    }

    // 添加分段
    var add = document.createElement('button');
    add.className = 'segbtn add';
    add.type = 'button';
    add.textContent = '+ 添加一段';
    add.addEventListener('click', function () {
      // 在当前最高段之上追加；没有段则铺满全壁
      var zTop = 0;
      for (var i = 0; i < segs.length; i++) zTop = Math.max(zTop, segs[i].z1);
      var z0 = Math.min(H, zTop);
      var z1 = Math.min(H, z0 + Math.max(5, (H - z0) / 2));
      if (z1 - z0 < 1) { toast('壁面高度已用尽，无法再加一段'); return; }
      segs.push({
        shape: 'straight', z0: z0, z1: z1,
        count: S.ribCount || 12, width: S.ribWidth || 2.2,
        depth: S.ribDepth || 1.1, turns: S.ribTurns || 1.5
      });
      onChange('ribSegs');
    });
    host.appendChild(add);

    // 快速模板
    var tpl = document.createElement('div');
    tpl.className = 'segctl';
    tpl.style.marginTop = '7px';
    tpl.appendChild(segBtn('下部螺旋 · 上部直肋', function () {
      var h = H / 2;
      S.ribSegs = [
        { shape: 'spiral', z0: 0, z1: h, count: S.ribCount || 12, width: S.ribWidth || 2.2, depth: S.ribDepth || 1.1, turns: S.ribTurns || 1.5 },
        { shape: 'straight', z0: h, z1: H, count: S.ribCount || 12, width: S.ribWidth || 2.2, depth: S.ribDepth || 1.1, turns: 1 }
      ];
      onChange('ribSegs');
    }));
    tpl.appendChild(segBtn('三段：光壁-螺旋-直肋', function () {
      var a = H / 3, b = 2 * H / 3;
      S.ribSegs = [
        { shape: 'none', z0: 0, z1: a, count: 0, width: 0, depth: 0, turns: 1 },
        { shape: 'spiral', z0: a, z1: b, count: S.ribCount || 12, width: S.ribWidth || 2.2, depth: S.ribDepth || 1.1, turns: S.ribTurns || 1.5 },
        { shape: 'straight', z0: b, z1: H, count: S.ribCount || 12, width: S.ribWidth || 2.2, depth: S.ribDepth || 1.1, turns: 1 }
      ];
      onChange('ribSegs');
    }));
    tpl.appendChild(segBtn('全部光壁', function () {
      S.ribSegs = [{ shape: 'none', z0: 0, z1: H, count: 0, width: 0, depth: 0, turns: 1 }];
      onChange('ribSegs');
    }));
    host.appendChild(tpl);
  }

  function segNum(label, val, min, max, step, cls, cb) {
    var lb = document.createElement('label');
    lb.textContent = label;
    var inp = document.createElement('input');
    inp.type = 'number';
    inp.className = cls;
    inp.min = min; inp.max = max; inp.step = step;
    inp.value = val;
    inp.addEventListener('input', function () {
      var v = parseFloat(inp.value);
      if (isNaN(v)) return;
      cb(MODEL.clamp(v, min, max));
    });
    lb.appendChild(inp);
    return lb;
  }

  function segBtn(text, cb) {
    var b = document.createElement('button');
    b.className = 'segbtn';
    b.type = 'button';
    b.textContent = text;
    b.addEventListener('click', cb);
    return b;
  }

  /* ============ 导水槽绘制 ============ */
  // 分段结构的文字描述（导出用）
  function segDescText(rb) {
    var segs = rb.segStats || [], out = [];
    for (var i = 0; i < segs.length; i++) {
      var sg = segs[i];
      if (sg.shape === 'none') {
        out.push('第' + (i + 1) + '段光壁 ' + fmt(sg.z0, 0) + '-' + fmt(sg.z1, 0) + 'mm');
      } else {
        out.push('第' + (i + 1) + '段' + SEG_SHORT[sg.shape] + ' ' + fmt(sg.z0, 0) + '-'
          + fmt(sg.z1, 0) + 'mm ×' + sg.count + '条');
      }
    }
    return out.join(' / ');
  }

  function segCountOf(rb, shape) {
    var n = 0, segs = rb.segStats || [];
    for (var i = 0; i < segs.length; i++) if (segs[i].shape === shape) n++;
    return n;
  }

  function ribStyleName(rb) {
    if (rb.style === 'spiral' && rb.segMode) return rb.segCount + ' 段分段排气肋';
    if (rb.style === 'spiral') return rb.count + ' 条螺旋凸肋';
    if (rb.style === 'radial') return rb.count + ' 条径向铣槽';
    return '无导水槽';
  }

  // 剖面图：锥形杯画壁面螺旋凸肋（剖面上表现为沿壁上升的锯齿带），
  //         平底/直筒杯画底面径向铣槽（底部的 V 形沟槽）
  function drawRibsSide(svg, X, Y, geo, P, scale) {
    var rb = geo.ribs;
    if (rb.style === 'none' || !rb.applicable) return;
    var i, k;

    if (rb.style === 'spiral' && rb.segMode && rb.segStats && rb.segStats.length) {
      /* 分段模式：逐段绘制，每段用不同颜色/纹理区分形状
       *   spiral  螺旋凸肋 —— 沿该段盘旋，剖面上表现为离散凸起小块
       *   straight 纵向直肋 —— 沿母线直通，剖面上表现为连续带状凸起
       *   none    光壁     —— 无凸起，仅用虚线标出该段范围
       */
      var segs = rb.segStats;
      for (var isg = 0; isg < segs.length; isg++) {
        var sg = segs[isg];
        var sz0 = sg.z0, sz1 = sg.z1;
        if (sz1 - sz0 < 0.4) continue;
        var col = segShapeColor(sg.shape);
        var r0s = MODEL.radiusAt(P, sz0), r1s = MODEL.radiusAt(P, sz1);
        var depthPx = sg.isRib ? Math.max(1.6, sg.depth * scale) : 0;

        // 段范围色带（沿壁面，右侧实、左侧浅）
        var NP = 14, ptsO = [], ptsI = [];
        for (var ip = 0; ip <= NP; ip++) {
          var zz = sz0 + (sz1 - sz0) * ip / NP;
          var rr = MODEL.radiusAt(P, zz);
          ptsO.push([X(rr), Y(zz)]);
          ptsI.push([X(rr) - depthPx, Y(zz)]);
        }
        var dPath = 'M' + ptsO.map(function (q) { return q[0].toFixed(2) + ' ' + q[1].toFixed(2); }).join(' L');
        var rev = ptsI.slice().reverse().map(function (q) { return q[0].toFixed(2) + ' ' + q[1].toFixed(2); }).join(' L');
        var gseg = el('g', {}, svg);
        if (sg.isRib) {
          el('path', {
            d: dPath + ' L' + rev + ' Z',
            fill: col, opacity: 0.28, stroke: col, 'stroke-width': 0.7
          }, gseg);
        } else {
          // 光壁段：虚线标出范围
          el('path', {
            d: dPath, fill: 'none', stroke: col, 'stroke-width': 1.1,
            'stroke-dasharray': '4 3', opacity: 0.85
          }, gseg);
        }
        // 左侧浅色示意
        el('path', {
          d: 'M' + ptsO.map(function (q) { return (-q[0]).toFixed(2) + ' ' + q[1].toFixed(2); }).join(' L'),
          fill: 'none', stroke: col, 'stroke-width': 0.6, 'stroke-dasharray': '2 3', opacity: 0.4
        }, gseg);

        // 肋的表示
        var wPx = Math.max(1.4, sg.width * scale);
        if (sg.shape === 'spiral' && sg.isRib) {
          // 螺旋：该段内沿母线盘旋，剖面上是离散凸起小块
          var m = Math.max(1, Math.round(sg.count * Math.max(1, sg.turns)));
          var step2 = (sz1 - sz0) / m;
          for (var ib = 0; ib < m; ib++) {
            var zc = sz1 - (ib + 0.5) * step2;
            if (zc < sz0 - 1e-6) break;
            var rc = MODEL.radiusAt(P, zc);
            var yc = Y(zc);
            el('rect', {
              x: (X(rc) - depthPx - wPx / 2).toFixed(2), y: (yc - Math.max(1, wPx * 0.45)).toFixed(2),
              width: wPx.toFixed(2), height: Math.max(2, wPx * 0.9).toFixed(2), rx: 1,
              fill: col, stroke: 'var(--ribline)', 'stroke-width': 0.4, opacity: 0.95
            }, gseg);
          }
        } else if (sg.shape === 'straight' && sg.isRib) {
          // 直肋：沿母线连续，用内缘平行细线表示条数
          for (var il = 0; il < sg.count; il++) {
            var frac2 = sg.count > 1 ? (il / (sg.count - 1)) : 0.5;
            var off = wPx * frac2 * 1.6;
            var pl = [];
            for (var ip2 = 0; ip2 <= NP; ip2++) {
              var zz2 = sz0 + (sz1 - sz0) * ip2 / NP;
              var rr2 = MODEL.radiusAt(P, zz2);
              pl.push((X(rr2) - depthPx - off).toFixed(2) + ' ' + Y(zz2).toFixed(2));
            }
            el('path', {
              d: 'M' + pl.join(' L'), fill: 'none', stroke: col,
              'stroke-width': Math.max(0.8, wPx * 0.42), opacity: 0.75
            }, gseg);
          }
        }
        // 段标注
        var zmid = (sz0 + sz1) / 2;
        var rmid = MODEL.radiusAt(P, zmid);
        var lab = el('text', {
          x: (X(rmid) + 6).toFixed(2), y: (Y(zmid) + 3).toFixed(2),
          fill: col, 'font-size': 9, 'font-weight': '600'
        }, svg);
        lab.textContent = '段' + (isg + 1) + ' ' + SEG_SHORT[sg.shape];
        // 分段界线
        if (isg > 0) {
          var rz = MODEL.radiusAt(P, sz0);
          el('line', {
            x1: X(rz).toFixed(2), y1: Y(sz0).toFixed(2),
            x2: (X(rz) + 16).toFixed(2), y2: (Y(sz0) - 6).toFixed(2),
            stroke: col, 'stroke-width': 0.9, 'stroke-dasharray': '2 2', opacity: 0.8
          }, svg);
        }
      }
      // 整体标注
      var zt2 = P.H, rt2 = MODEL.radiusAt(P, zt2);
      el('line', {
        x1: X(rt2).toFixed(2), y1: Y(zt2).toFixed(2),
        x2: (X(rt2) + 34).toFixed(2), y2: (Y(zt2) - 20).toFixed(2),
        stroke: 'var(--ribline)', 'stroke-width': 0.8, 'stroke-dasharray': '3 2'
      }, svg);
      var tl2 = el('text', {
        x: (X(rt2) + 36).toFixed(2), y: (Y(zt2) - 21).toFixed(2),
        fill: 'var(--ribline)', 'font-size': 9.5
      }, svg);
      tl2.textContent = '分段排气肋 ×' + segs.length + ' 段';
      return;
    }

    if (rb.style === 'spiral') {
      /* 螺旋凸肋：在剖面上，肋沿壁面盘旋上升，画成一串沿母线排列的凸起小块。
       * 只画靠观察者一侧（右壁）的肋，左壁用虚线示意，避免剖面被塞满。 */
      var zTop = P.H, zBot = 0;
      var nRib = Math.max(1, rb.count);
      // 每条肋在母线上的投影位置：turns 圈分布在整条母线
      var step = (zTop - zBot) / (nRib * rb.turns);
      var wPx = Math.max(2, rb.width * scale);
      var hPx = Math.max(2, rb.depth * scale);
      for (i = 0; i < nRib * rb.turns; i++) {
        var z = zTop - i * step;
        if (z < 1) break;
        var r = MODEL.radiusAt(P, z);
        var zr = z - step * 0.5;
        if (zr < 0) zr = 0;
        var rr = MODEL.radiusAt(P, zr);
        // 凸肋块：从内壁向内凸出 ribDepth
        var g = el('g', {}, svg);
        el('rect', {
          x: (X(r) - wPx / 2).toFixed(2), y: (Y(z) - hPx).toFixed(2),
          width: wPx.toFixed(2), height: hPx.toFixed(2), rx: 1.5,
          fill: 'var(--rib)', stroke: 'var(--ribline)', 'stroke-width': 0.6, opacity: 0.95
        }, g);
        // 左侧（背面）肋用浅色示意
        el('rect', {
          x: (X(-rr) - wPx / 2).toFixed(2), y: (Y(zr) - hPx).toFixed(2),
          width: wPx.toFixed(2), height: hPx.toFixed(2), rx: 1.5,
          fill: 'var(--rib2)', stroke: 'var(--ribline)', 'stroke-width': 0.5, opacity: 0.4
        }, g);
      }
      // 引出线标注
      var zl = zTop - step * 0.5;
      if (zl > 2) {
        var rl = MODEL.radiusAt(P, zl);
        el('line', {
          x1: X(rl).toFixed(2), y1: Y(zl).toFixed(2),
          x2: (X(rl) + 34).toFixed(2), y2: (Y(zl) - 20).toFixed(2),
          stroke: 'var(--ribline)', 'stroke-width': 0.8, 'stroke-dasharray': '3 2'
        }, svg);
        var tl = el('text', {
          x: (X(rl) + 36).toFixed(2), y: (Y(zl) - 21).toFixed(2),
          fill: 'var(--ribline)', 'font-size': 9.5
        }, svg);
        tl.textContent = '排气肋 ×' + rb.count + '（高 ' + fmt(rb.depth, 1) + 'mm）';
      }
      return;
    }

    if (rb.style === 'radial') {
      /* 径向铣槽：在平底杯的底面剖面上，表现为底板上的凹槽 */
      var zBase = 0;
      var yBase = Y(zBase);
      var xIn = X(rb.rIn), xOut = X(rb.rOut);
      var depthPx = Math.max(2.5, rb.depth * scale);
      var wPx2 = Math.max(2, rb.width * scale);
      // 底板厚度示意：画一条向下偏移的底板线
      var wallPx = Math.max(2, S.wall * scale);
      el('line', {
        x1: (X(-rb.rOut) - wallPx).toFixed(2), y1: (yBase + wallPx).toFixed(2),
        x2: (X(rb.rOut) + wallPx).toFixed(2), y2: (yBase + wallPx).toFixed(2),
        stroke: '#a9977f', 'stroke-width': 1
      }, svg);
      // 左右两侧各画一条槽（剖面穿过的那条）
      var g2 = el('g', {}, svg);
      el('path', {
        d: 'M' + xOut.toFixed(2) + ' ' + yBase.toFixed(2) +
           ' L' + (xOut - depthPx).toFixed(2) + ' ' + (yBase + depthPx).toFixed(2) +
           ' L' + xIn.toFixed(2) + ' ' + (yBase + depthPx).toFixed(2) +
           ' L' + xIn.toFixed(2) + ' ' + yBase.toFixed(2) + ' Z',
        fill: 'var(--rib)', stroke: 'var(--ribline)', 'stroke-width': 0.7
      }, g2);
      el('path', {
        d: 'M' + (-xIn).toFixed(2) + ' ' + yBase.toFixed(2) +
           ' L' + (-xIn).toFixed(2) + ' ' + (yBase + depthPx).toFixed(2) +
           ' L' + (-xOut + depthPx).toFixed(2) + ' ' + (yBase + depthPx).toFixed(2) +
           ' L' + (-xOut).toFixed(2) + ' ' + yBase.toFixed(2) + ' Z',
        fill: 'var(--rib)', stroke: 'var(--ribline)', 'stroke-width': 0.7
      }, g2);
      // 标注
      var tm = el('text', {
        x: ((xIn + xOut) / 2).toFixed(2), y: (yBase + depthPx + 11).toFixed(2),
        fill: 'var(--ribline)', 'font-size': 9.5, 'text-anchor': 'middle'
      }, svg);
      tm.textContent = '导流槽 ×' + rb.count + '（深 ' + fmt(rb.depth, 1) + 'mm）';
    }
  }

  // 俯视图：径向铣槽画成一圈从内向外的放射状沟槽
  function drawRibsTop(svg, c, scale, geo) {
    var rb = geo.ribs;
    if (rb.style === 'spiral' && rb.segMode && rb.segStats && rb.segStats.length) {
      // 分段模式俯视：每段在俯视投影上是一段同心弧，弧色对应形状
      var P2 = geo.P;
      for (var it = 0; it < rb.segStats.length; it++) {
        var st = rb.segStats[it];
        if (st.z1 - st.z0 < 0.4) continue;
        var col2 = segShapeColor(st.shape);
        var rMidPx = st.rMid * scale;
        if (st.isRib) {
          el('circle', {
            cx: c, cy: c, r: rMidPx.toFixed(2), fill: 'none',
            stroke: col2, 'stroke-width': Math.max(1, st.depth * scale).toFixed(2), opacity: 0.6
          }, svg);
        } else {
          el('circle', {
            cx: c, cy: c, r: rMidPx.toFixed(2), fill: 'none',
            stroke: col2, 'stroke-width': 1, 'stroke-dasharray': '3 3', opacity: 0.6
          }, svg);
        }
      }
      return;
    }
    if (rb.style !== 'radial' || !rb.applicable) return;
    var i;
    var wPx = Math.max(1.5, rb.width * scale);
    var rIn = rb.rIn * scale, rOut = rb.rOut * scale;
    for (i = 0; i < rb.count; i++) {
      var ang = i / rb.count * Math.PI * 2;
      var ca = Math.cos(ang), sa = Math.sin(ang);
      var g = el('g', {}, svg);
      // 以线段 + 端点方块表示一条径向槽
      el('line', {
        x1: (c + rIn * ca).toFixed(2), y1: (c + rIn * sa).toFixed(2),
        x2: (c + rOut * ca).toFixed(2), y2: (c + rOut * sa).toFixed(2),
        stroke: 'var(--rib)', 'stroke-width': wPx.toFixed(2), 'stroke-linecap': 'butt', opacity: 0.85
      }, g);
    }
    el('circle', {
      cx: c, cy: c, r: rOut,
      fill: 'none', stroke: 'var(--ribline)', 'stroke-width': 0.8, 'stroke-dasharray': '3 2', opacity: 0.55
    }, svg);
  }

  function holePositions() {
    var out = [], n = S.holeCount, i;
    if (S.holeLayout === 'single') return [{ x: 0, y: 0 }];
    if (S.holeLayout === 'cluster') {
      out.push({ x: 0, y: 0 });
      for (i = 1; i < n; i++) {
        var a = (i - 1) / Math.max(1, n - 1) * Math.PI * 2;
        out.push({ x: S.ringR * Math.cos(a), y: S.ringR * Math.sin(a) });
      }
      return out;
    }
    for (i = 0; i < n; i++) {
      var ang = i / n * Math.PI * 2;
      out.push({ x: S.ringR * Math.cos(ang), y: S.ringR * Math.sin(ang) });
    }
    return out;
  }

  function mkHandle(svg, x, y, id, label, valFn) {
    var g = el('g', { class: 'handle' }, svg);
    el('circle', { cx: x, cy: y, r: 9, fill: '#ffffff', stroke: '#8b5a2b', 'stroke-width': 2, opacity: 0.95 }, g);
    el('circle', { cx: x, cy: y, r: 3.2, fill: '#8b5a2b' }, g);
    var t = el('title', {}, g);
    t.textContent = label + '（拖拽调整）';
    g.setAttribute('data-handle', id);
    g.addEventListener('pointerdown', function (ev) { startDrag(ev, id, x, y); });
    return g;
  }

  /* ============ 拖拽 ============ */
  var drag = null;
  function startDrag(ev, id, ox, oy) {
    ev.preventDefault();
    var svg = $('svgSide');
    var ctm = svg.getScreenCTM();
    var pt = svg.createSVGPoint();
    pt.x = ev.clientX; pt.y = ev.clientY;
    var local = pt.matrixTransform(ctm.inverse());
    drag = { id: id, ctm: ctm, svg: svg, ox: local.x, oy: local.y, moved: false };
    svg.setPointerCapture(ev.pointerId);
    svg.addEventListener('pointermove', onDragMove);
    svg.addEventListener('pointerup', onDragEnd);
    svg.addEventListener('pointercancel', onDragEnd);
  }
  function onDragMove(ev) {
    if (!drag) return;
    var svg = drag.svg;
    var pt = svg.createSVGPoint();
    pt.x = ev.clientX; pt.y = ev.clientY;
    var local = pt.matrixTransform(drag.ctm.inverse());
    var dx = local.x - drag.ox, dy = local.y - drag.oy;
    drag.moved = true;
    var P = RESULT.geo.P;
    var scale = RESULT.scale, cx = VB.w / 2, baseY = VB.h - 34;

    if (drag.id === 'rim') {
      var r = Math.abs(local.x - cx) / scale;
      S.Dtop = MODEL.clamp(Math.round(r * 2), 60, 180);
    } else if (drag.id === 'r0') {
      var rr = Math.abs(local.x - cx) / scale;
      S.r0 = MODEL.clamp(Math.round(rr * 2) / 2, 3, 45);
    } else if (drag.id === 'hole') {
      var hd = Math.abs(local.x - cx) / scale * 2;
      S.holeD = MODEL.clamp(Math.round(hd * 2) / 2, 2, 40);
    } else if (drag.id === 'angle') {
      var z = (baseY - local.y) / scale;
      if (z > 1) {
        var rad = Math.abs(local.x - cx) / scale;
        var pivotZ = P.zFlat > 0 ? P.zFlat : 0;
        var dr = rad - P.r0, dz = z - pivotZ;
        if (dz > 0.5 && dr > 0.5) {
          var tan = dr / dz;
          if (S.shape === 'cone') {
            S.coneAngle = MODEL.clamp(Math.round(2 * Math.atan(tan) * 180 / Math.PI), 20, 80);
          } else {
            S.wallTilt = MODEL.clamp(Math.round(Math.atan(tan) * 180 / Math.PI * 2) / 2, 2, 35);
          }
        }
      }
    }
    onChange();
  }
  function onDragEnd(ev) {
    if (!drag) return;
    drag.svg.removeEventListener('pointermove', onDragMove);
    drag.svg.removeEventListener('pointerup', onDragEnd);
    drag.svg.removeEventListener('pointercancel', onDragEnd);
    drag = null;
  }

  /* ============ 俯视图 ============ */
  function renderTop() {
    var svg = $('svgTop');
    clear(svg);
    var geo = RESULT.geo, P = geo.P;
    var c = 150;
    var scale = 118 / (S.Dtop / 2);

    var defs = el('defs', {}, svg);
    var mk = el('marker', { id: 'arwT', viewBox: '0 0 8 8', refX: 4, refY: 4, markerWidth: 7, markerHeight: 7, orient: 'auto-start-reverse' }, defs);
    el('path', { d: 'M0 0 L8 4 L0 8 z', fill: '#9b8b7c' }, mk);

    el('circle', { cx: c, cy: c, r: S.Dtop / 2 * scale, fill: '#fffdf9', stroke: '#b7a58c', 'stroke-width': 2 }, svg);
    el('circle', { cx: c, cy: c, r: P.r0 * scale, fill: '#f3ece1', stroke: '#c9b89d', 'stroke-width': 1, 'stroke-dasharray': '3 2' }, svg);
    el('circle', { cx: c, cy: c, r: geo.rBedTop * scale, fill: '#a06a3c', opacity: 0.28, stroke: '#8f5c30', 'stroke-width': 1 }, svg);

    var pos = holePositions(), i;
    for (i = 0; i < pos.length; i++) {
      el('circle', {
        cx: c + pos[i].x * scale, cy: c + pos[i].y * scale,
        r: Math.max(1.6, S.holeD / 2 * scale), fill: '#fffdf9', stroke: '#8b5a2b', 'stroke-width': 1.4
      }, svg);
    }

    el('line', { x1: c - S.Dtop / 2 * scale, y1: c + 152, x2: c + S.Dtop / 2 * scale, y2: c + 152, stroke: '#9b8b7c', 'stroke-width': 1, 'marker-start': 'url(#arwT)', 'marker-end': 'url(#arwT)' }, svg);
    var t = el('text', { x: c, y: c + 168, fill: '#6b5a4c', 'font-size': 11, 'text-anchor': 'middle' }, svg);
    t.textContent = '⌀ ' + fmt(S.Dtop, 0) + ' mm';

    if (S.holeLayout !== 'single' && S.ringR > 0) {
      el('circle', { cx: c, cy: c, r: S.ringR * scale, fill: 'none', stroke: '#c2410c', 'stroke-width': 1, 'stroke-dasharray': '4 3' }, svg);
    }

    /* 壁部导水槽（俯视） */
    drawRibsTop(svg, c, scale, geo);

    $('topHint').textContent = S.holeCount + ' 孔 · 合计 ' + fmt(geo.AHole * 1e6, 0) + ' mm²' +
      (geo.ribs.style !== 'none' ? ' · ' + ribStyleName(geo.ribs) : '');

    /* 俯视图上的环半径控制点 */
    if (S.holeLayout !== 'single' && S.ringR > 0) {
      var g = el('g', { class: 'handle' }, svg);
      el('circle', { cx: c + S.ringR * scale, cy: c, r: 7, fill: '#fff', stroke: '#c2410c', 'stroke-width': 2 }, g);
      el('circle', { cx: c + S.ringR * scale, cy: c, r: 2.6, fill: '#c2410c' }, g);
      var ti = el('title', {}, g); ti.textContent = '环形半径（拖拽调整）';
      g.addEventListener('pointerdown', function (ev) { startTopDrag(ev); });
    }
  }

  var tdrag = null;
  function startTopDrag(ev) {
    ev.preventDefault();
    var svg = $('svgTop');
    tdrag = { ctm: svg.getScreenCTM(), svg: svg };
    svg.setPointerCapture(ev.pointerId);
    svg.addEventListener('pointermove', topDragMove);
    svg.addEventListener('pointerup', topDragEnd);
    svg.addEventListener('pointercancel', topDragEnd);
  }
  function topDragMove(ev) {
    if (!tdrag) return;
    var svg = tdrag.svg;
    var pt = svg.createSVGPoint(); pt.x = ev.clientX; pt.y = ev.clientY;
    var local = pt.matrixTransform(tdrag.ctm.inverse());
    var scale = 118 / (S.Dtop / 2);
    var rr = Math.abs(local.x - 150) / scale;
    S.ringR = MODEL.clamp(Math.round(rr * 2) / 2, 0, 40);
    onChange();
  }
  function topDragEnd() {
    if (!tdrag) return;
    tdrag.svg.removeEventListener('pointermove', topDragMove);
    tdrag.svg.removeEventListener('pointerup', topDragEnd);
    tdrag.svg.removeEventListener('pointercancel', topDragEnd);
    tdrag = null;
  }

  /* ============ 曲线 ============ */
  function renderChart() {
    var svg = $('svgChart');
    clear(svg);
    var W = 520, H = 260, L = 40, R = 14, T = 14, B = 30;
    var series = RESULT.series;
    var maxT = 1, maxQ = 0.1, i;
    for (i = 0; i < series.length; i++) {
      if (series[i].t > maxT) maxT = series[i].t;
      if (series[i].q > maxQ) maxQ = series[i].q;
    }
    maxT = Math.ceil(maxT / 30) * 30;
    maxQ = Math.ceil(maxQ * 1.15 * 2) / 2;
    function X(t) { return L + (W - L - R) * (t / maxT); }
    function Y(q) { return H - B - (H - T - B) * (q / maxQ); }

    /* 阶段底色 */
    el('rect', { x: X(0), y: T, width: X(RESULT.tBloomEnd) - X(0), height: H - T - B, fill: '#000000', opacity: 0.045 }, svg);
    el('rect', { x: X(RESULT.tBloomEnd), y: T, width: X(RESULT.tPourEnd) - X(RESULT.tBloomEnd), height: H - T - B, fill: '#c2410c', opacity: 0.055 }, svg);
    if (RESULT.tPourEnd < maxT) {
      el('rect', { x: X(RESULT.tPourEnd), y: T, width: X(maxT) - X(RESULT.tPourEnd), height: H - T - B, fill: '#b91c1c', opacity: 0.05 }, svg);
    }

    /* 网格与刻度 */
    for (i = 0; i <= 4; i++) {
      var qv = maxQ * i / 4;
      el('line', { x1: L, y1: Y(qv), x2: W - R, y2: Y(qv), stroke: '#eee4d6', 'stroke-width': 1 }, svg);
      var tl = el('text', { x: L - 6, y: Y(qv) + 3.5, fill: '#9b8b7c', 'font-size': 10, 'text-anchor': 'end' }, svg);
      tl.textContent = fmt(qv, 1);
    }
    for (i = 0; i <= 4; i++) {
      var tv = maxT * i / 4;
      var tl2 = el('text', { x: X(tv), y: H - B + 14, fill: '#9b8b7c', 'font-size': 10, 'text-anchor': 'middle' }, svg);
      tl2.textContent = fmt(tv, 0) + 's';
    }
    el('line', { x1: L, y1: H - B, x2: W - R, y2: H - B, stroke: '#d6c9b8', 'stroke-width': 1 }, svg);
    el('line', { x1: L, y1: T, x2: L, y2: H - B, stroke: '#d6c9b8', 'stroke-width': 1 }, svg);

    /* 曲线面积 */
    var d = 'M' + X(series[0].t).toFixed(1) + ' ' + Y(0).toFixed(1) + ' ';
    for (i = 0; i < series.length; i++) d += 'L' + X(series[i].t).toFixed(1) + ' ' + Y(series[i].q).toFixed(1) + ' ';
    d += 'L' + X(series[series.length - 1].t).toFixed(1) + ' ' + Y(0).toFixed(1) + ' Z';
    el('path', { d: d, fill: '#c2410c', opacity: 0.16 }, svg);
    var dl = '';
    for (i = 0; i < series.length; i++) dl += (i === 0 ? 'M' : 'L') + X(series[i].t).toFixed(1) + ' ' + Y(series[i].q).toFixed(1) + ' ';
    el('path', { d: dl, fill: 'none', stroke: '#c2410c', 'stroke-width': 2, 'stroke-linejoin': 'round' }, svg);

    /* 首滴 / 末滴标记 */
    if (RESULT.tFirstDrip !== null) {
      el('line', { x1: X(RESULT.tFirstDrip), y1: T, x2: X(RESULT.tFirstDrip), y2: H - B, stroke: '#15803d', 'stroke-width': 1, 'stroke-dasharray': '3 3' }, svg);
      var g1 = el('text', { x: X(RESULT.tFirstDrip) + 4, y: T + 11, fill: '#15803d', 'font-size': 10 }, svg);
      g1.textContent = '首滴 ' + clock(RESULT.tFirstDrip);
    }
    if (RESULT.tLastDrip !== null) {
      el('line', { x1: X(RESULT.tLastDrip), y1: T, x2: X(RESULT.tLastDrip), y2: H - B, stroke: '#b91c1c', 'stroke-width': 1, 'stroke-dasharray': '3 3' }, svg);
      var g2 = el('text', { x: X(RESULT.tLastDrip) - 4, y: T + 24, fill: '#b91c1c', 'font-size': 10, 'text-anchor': 'end' }, svg);
      g2.textContent = '末滴 ' + clock(RESULT.tLastDrip);
    }

    /* 峰值标记 */
    el('circle', { cx: X(RESULT.peakAt), cy: Y(RESULT.peak), r: 3.5, fill: '#fff', stroke: '#c2410c', 'stroke-width': 2 }, svg);
    var g3 = el('text', { x: X(RESULT.peakAt), y: Y(RESULT.peak) - 8, fill: '#c2410c', 'font-size': 10, 'text-anchor': 'middle' }, svg);
    g3.textContent = '峰值 ' + fmt(RESULT.peak, 2) + ' g/s';

    /* y 轴名 */
    var yl = el('text', { x: 12, y: T + 4, fill: '#9b8b7c', 'font-size': 10 }, svg);
    yl.textContent = 'g/s';

    /* 悬停读数 */
    var hit = el('rect', { x: L, y: T, width: W - L - R, height: H - T - B, fill: 'transparent' }, svg);
    hit.style.cursor = 'crosshair';
    var tip = $('tipChart');
    hit.addEventListener('mousemove', function (ev) {
      var box = svg.getBoundingClientRect();
      var rel = (ev.clientX - box.left) / box.width * W;
      var t = (rel - L) / (W - L - R) * maxT;
      var best = series[0], bd = 1e9;
      for (var k = 0; k < series.length; k++) {
        var dd = Math.abs(series[k].t - t);
        if (dd < bd) { bd = dd; best = series[k]; }
      }
      tip.textContent = 't=' + fmt(best.t, 0) + 's　' + fmt(best.q, 2) + ' g/s　已出 ' + fmt(best.drained, 0) + ' g';
      tip.style.left = (ev.clientX - box.left) + 'px';
      tip.style.top = (ev.clientY - box.top) + 'px';
      tip.classList.add('on');
    });
    hit.addEventListener('mouseleave', function () { tip.classList.remove('on'); });
  }

  /* ============ 指标 ============ */
  function renderMetrics() {
    var r = RESULT;
    $('mAvg').textContent = '';
    $('mAvg').appendChild(document.createTextNode(fmt(r.avgFlow, 2)));
    var sm = document.createElement('small'); sm.textContent = ' g/s';
    $('mAvg').appendChild(sm);
    $('mAvgSub').textContent = '总注水 ' + fmt(r.totalWater, 0) + ' g　出液 ' + fmt(r.liquid, 0) + ' g　留存 ' + fmt(r.retention, 0) + ' g';
    setMetric('mPeak', fmt(r.peak, 2), ' g/s');
    setMetric('mTime', clock(r.totalTime), '');
    setMetric('mEy', fmt(r.ey, 1), ' %');
    setMetric('mTds', fmt(r.tds, 2), ' %');
    setMetric('mOut', fmt(r.liquid, 0), ' g');
    setMetric('mDraw', clock(r.drawdown), '');

    var v = $('verdict');
    v.className = 'verdict ' + r.tone;
    v.textContent = '';
    var b = document.createElement('b'); b.textContent = r.verdict;
    var p = document.createElement('p'); p.textContent = r.advice;
    v.appendChild(b); v.appendChild(p);

    var geo = r.geo;
    var rows = [
      ['杯型', S.shape === 'cone' ? '锥形' : (S.shape === 'flat' ? '平底' : '直筒')],
      ['总高', fmt(geo.height, 1) + ' mm'],
      ['上口直径', fmt(S.Dtop, 0) + ' mm'],
      ['底面半径', fmt(geo.P.r0, 1) + ' mm'],
      ['杯体容积', fmt(geo.Vtotal_cm3, 0) + ' ml'],
      ['粉床厚度', fmt(geo.zBed, 1) + ' mm'],
      ['粉床顶直径', fmt(geo.rBedTop * 2, 1) + ' mm'],
      ['有效过流面积', fmt(geo.ABed * 1e6, 0) + ' mm²'],
      ['孔口总面积', fmt(geo.AHole * 1e6, 1) + ' mm²'],
      ['壁厚 / 材质', fmt(S.wall, 1) + ' mm · ' + geo.matName],
      ['壁部导水槽', ribStyleName(geo.ribs)],
      ['导水槽分段', geo.ribs.segMode
        ? geo.ribs.segCount + ' 段（螺旋 ' + segCountOf(geo.ribs, 'spiral') + ' / 直肋 '
          + segCountOf(geo.ribs, 'straight') + ' / 光壁 ' + segCountOf(geo.ribs, 'none') + '）'
        : '整壁统一'],
      ['通气截面积', fmt(geo.ribs.A_vent, 1) + ' mm²'],
      ['排气等效阻力 b_air', geo.ribs.b_air > 0 ? geo.ribs.b_air.toExponential(2) + ' Pa·s/m³' : '—'],
      ['排气贯通性', geo.ribs.segMode
        ? (geo.ribs.throughVent ? '全壁贯通' : '未贯通（连续带肋 '
          + fmt(geo.ribs.contiguousH, 1) + ' mm / ' + fmt(geo.ribs.ventFrac, 0) + '%）')
        : '—'],
      ['导水槽流速增益', (geo.ribs.ventGain >= 0 ? '+' : '') + fmt(geo.ribs.ventGain, 1) + '%'],
      ['预估重量', fmt(geo.weightG, 0) + ' g'],
      ['建议最大粉量', fmt(Math.max(1, (geo.Vtotal_cm3 * 0.55) / (S.dose / 1000) / 1), 0) + ' g']
    ];
    fillTable('geoTable', rows);

    var frows = [
      ['粉床渗透率 k', geo.kEff.toExponential(2) + ' m²'],
      ['研磨度', S.grind + ' · ' + MODEL.grindLabel(S.grind)],
      ['水黏度 μ', (r.geo.props.mu * 1000).toFixed(3) + ' mPa·s'],
      ['水密度 ρ', fmt(r.geo.props.rho, 1) + ' kg/m³'],
      ['流路长度', fmt(geo.Lpath * 1000, 1) + ' mm'],
      ['出口流速（峰值）', fmt(r.exitVelocity, 3) + ' m/s'],
      ['滤床表面通量', fmt(r.flux * 1000, 2) + ' mm/s'],
      ['首滴时间', r.tFirstDrip === null ? '—' : clock(r.tFirstDrip)],
      ['末滴时间', r.tLastDrip === null ? '—' : clock(r.tLastDrip)],
      ['实际粉水比', '1 : ' + fmt(r.brewRatioOut, 1)],
      ['导水槽覆盖率', geo.ribs.style === 'radial' ? fmt(geo.ribs.capture * 100, 1) + '%（底面）'
        : (geo.ribs.style === 'spiral' ? fmt(geo.ribs.wallCover, 1) + '%（壁面）' : '—')],
      ['袋腔负压 / 水头抵消', geo.ribs.b_air > 0
        ? fmt(geo.ribs.pVent, 1) + ' Pa · ' + fmt(geo.ribs.pVentRatio, 1) + '%' : '—'],
      ['泄压阻力 b_air / 段数', geo.ribs.b_air > 0
        ? geo.ribs.b_air.toExponential(2) + ' Pa·s/m³ · ' + (geo.ribs.segMode ? geo.ribs.segCount + ' 段串联' : '整壁')
        : '—'],
      ['接触时间', fmt(r.contact, 0) + ' s']
    ];
    fillTable('flowTable', frows);

    // 导水槽诊断面板（按两条物理通路分栏）
    renderRibPanel(geo);
    // 分段导水槽编辑器
    renderSegEditor(geo);

    // 回填只读展示字段：导水槽覆盖率
    var cov = geo.ribs.style === 'radial'
      ? fmt(geo.ribs.capture * 100, 1) + '%（底面面积口径）'
      : (geo.ribs.style === 'spiral'
        ? fmt(geo.ribs.wallCover, 1) + '%（壁面周长口径）'
        : '—');
    var covNode = $('static_ribCoverage');
    if (covNode) covNode.textContent = cov;

    // 顶部提示条标注当前导水槽形式
    var hint = $('ribHint');
    if (hint) hint.textContent = geo.ribs.style === 'none' ? '未启用' : ribStyleName(geo.ribs);
  }

  /* ============ 导水槽诊断 ============
   * 导水槽在真实产品里有两个彼此独立的物理通路：
   *   通路 A · 底部汇流旁路  —— 底面径向铣槽（Kalita / Origami）：给底部横向汇流加一条低阻旁路
   *   通路 B · 粉床下排气泄压 —— 壁面螺旋凸肋（V60 02）：把粉床下方密闭袋腔连到大气，破除负压
   * 下面按通路分别给出数据，不混成一栏。
   */
  function renderRibPanel(geo) {
    var host = $('ribPanel');
    clear(host);
    var rb = geo.ribs;

    // 顶部：形式与总体收益
    var head = document.createElement('div');
    head.style.marginBottom = '10px';
    var h1 = document.createElement('div');
    h1.style.fontSize = '13px';
    h1.style.fontWeight = '600';
    h1.style.color = 'var(--ink)';
    h1.textContent = '当前形式：' + ribStyleName(rb);
    head.appendChild(h1);
    var h2 = document.createElement('div');
    h2.style.fontSize = '11.5px';
    h2.style.color = 'var(--muted)';
    h2.style.marginTop = '3px';
    h2.style.lineHeight = '1.6';
    h2.textContent = rb.style === 'spiral'
      ? (rb.segMode
        ? '壁面分段排气肋（共 ' + rb.segCount + ' 段）—— 走「通路 B」，负责破除粉床下方负压'
        : '壁面螺旋凸肋 —— 走「通路 B」，负责破除粉床下方负压')
      : (rb.style === 'radial'
        ? '底面径向铣槽 —— 走「通路 A」，负责给底部汇流加低阻旁路'
        : '未设导水槽 —— 两条通路都处于关闭状态');
    head.appendChild(h2);
    host.appendChild(head);

    if (rb.style === 'none') {
      var warn = document.createElement('div');
      warn.className = 'ribnote bad';
      warn.textContent = '光壁光底设计：两条通路都处于关闭状态。锥形杯会形成密闭袋腔，'
        + '排水末期负压可抵消 ' + fmt(rb.pVentRatio, 0) + '% 的驱动水头，出现"咕噜"断流；'
        + '平底杯则缺少底部汇流旁路，底部细粉层横向阻力占主导。';
      host.appendChild(warn);
    }

    /* ---- 通路 A · 底部汇流旁路（径向铣槽） ---- */
    var aCard = ribCard('通路 A · 底部汇流旁路', '底面径向铣槽 · Kalita / Origami');
    if (rb.style === 'radial') {
      aCard.body.appendChild(ribLine([
        '形式：', rb.count + ' 条径向铣槽，槽宽 ', fmt(rb.width, 1) + ' mm，槽深 ',
        fmt(rb.depth, 1) + ' mm，槽长 ', fmt(rb.L_ch, 1) + ' mm'
      ]));
      aCard.body.appendChild(ribLine([
        '槽口总面积：', fmt(rb.slotAreaMm2, 1) + ' mm²　底面覆盖率：', fmt(rb.capture * 100, 1) + '%'
      ]));
      aCard.body.appendChild(ribLine([
        '槽内电导 G：', rb.G_groove.toExponential(2) + ' m³/(Pa·s)　（窄缝 Darcy：w·h³/12μL）'
      ]));
      aCard.body.appendChild(ribLine([
        '横向汇流阻力：', geo.bLat.toExponential(2), ' → ', geo.bLatEff.toExponential(2), ' Pa·s/m³'
      ]));
      aCard.body.appendChild(ribBar('降阻幅度', rb.bypassGain, 'bypassGain'));
      aCard.body.appendChild(ribLine([
        '作用：槽口覆盖范围内的水不必再穿过压实细粉层横向汇流，而是直接走槽内低阻通道流出'
      ]));
    } else {
      aCard.body.appendChild(ribNote(
        rb.style === 'none'
          ? '未采用 —— 本设计无底面铣槽，底部汇流全部依赖压实细粉层的横向渗透。'
          : (rb.applicable === false && rb.style === 'radial'
            ? '未采用 —— 径向铣槽与当前杯型不匹配。'
            : '未采用 —— 本设计走的是壁面排气通路，不产生底部汇流旁路。'),
        'warn'));
      if (rb.style !== 'none' && geo.bLat > 0) {
        aCard.body.appendChild(ribLine(['横向汇流阻力：', geo.bLat.toExponential(2), ' Pa·s/m³（无旁路可降）']));
      }
    }
    host.appendChild(aCard.node);

    /* ---- 通路 B · 粉床下排气泄压（螺旋凸肋） ---- */
    var bCard = ribCard('通路 B · 粉床下排气泄压', '壁面螺旋凸肋 · V60 02');
    if (rb.style === 'spiral') {
      if (rb.segMode) {
        var nSp = 0, nSt = 0, nNone = 0;
        for (var ic = 0; ic < (rb.segStats || []).length; ic++) {
          var shp = rb.segStats[ic].shape;
          if (shp === 'spiral') nSp++; else if (shp === 'straight') nSt++; else nNone++;
        }
        bCard.body.appendChild(ribLine([
          '形式：', rb.segCount + ' 段分段结构 —— 螺旋凸肋 ' + nSp + ' 段 / 纵向直肋 '
          + nSt + ' 段 / 光壁 ' + nNone + ' 段'
        ]));
      } else {
      bCard.body.appendChild(ribLine([
        '形式：', rb.count + ' 条螺旋凸肋，肋宽 ', fmt(rb.width, 1) + ' mm，肋高 ',
        fmt(rb.depth, 1) + ' mm，', fmt(rb.turns, 2) + ' 圈，单条展开长 ', fmt(rb.helixL, 0) + ' mm'
      ]));
      }
      bCard.body.appendChild(ribLine([
        '滤纸被撑离壁面：', fmt(rb.standoff, 2) + ' mm　壁面被肋覆盖：', fmt(rb.wallCover, 1) + '%'
      ]));
      bCard.body.appendChild(ribLine([
        '肋间仍贴合的缝隙：', fmt(rb.freeW, 1) + ' mm　通气截面积：', fmt(rb.A_vent, 1) + ' mm²'
      ]));
      bCard.body.appendChild(ribLine([
        '排气等效阻力 b_air：', rb.b_air.toExponential(2), ' Pa·s/m³　占总阻力：', fmt(rb.ventShare, 2) + '%'
      ]));
      bCard.body.appendChild(ribLine([
        '估算袋腔负压：', fmt(rb.pVent, 1), ' Pa　抵消驱动水头：', fmt(rb.pVentRatio, 1) + '%'
      ]));
      bCard.body.appendChild(ribBar('负压抵消比（越低越好）', rb.pVentRatio, 'pVentRatio'));
      bCard.body.appendChild(ribLine([
        '作用：凸肋把滤纸撑离锥壁，肋间留下连续通气道，粉床下方密闭袋腔得以向大气泄压，'
        + '排水末期不再出现负压反吸导致的断流'
      ]));
      if (rb.segMode) {
        bCard.body.appendChild(renderSegTable(rb));
        bCard.body.appendChild(renderVentStatus(rb));
      }
    } else {
      bCard.body.appendChild(ribNote(
        rb.style === 'none'
          ? '未采用 —— 本设计无壁面凸肋，滤纸贴壁形成密闭袋腔，排水末期负压抵消水头 '
            + fmt(rb.pVentRatio, 0) + '%。'
          : '未采用 —— 本设计走的是底部汇流旁路，不产生壁面排气通路。',
        'warn'));
      if (rb.style !== 'none') {
        bCard.body.appendChild(ribLine(['排气等效阻力 b_air：', rb.b_air.toExponential(2), ' Pa·s/m³']));
      }
    }
    host.appendChild(bCard.node);

    /* ---- 总体收益：反事实对照 ---- */
    var gain = document.createElement('div');
    gain.className = 'ribnote ' + (rb.ventGain >= 8 ? 'ok' : 'bad');
    gain.textContent = '反事实对照：同一个滤杯去掉全部导水槽后，'
      + '典型工作点流速由 ' + fmt(rb.gainQwithout, 2) + ' g/s 变为 '
      + fmt(rb.gainQwith, 2) + ' g/s（'
      + (rb.ventGain >= 0 ? '+' : '') + fmt(rb.ventGain, 1) + '%）。'
      + (rb.ventGain >= 8
        ? '这条导水槽是有效的。'
        : '收益有限 —— 导水槽并非当前设计的主要瓶颈。');
    host.appendChild(gain);

    /* ---- 材质增减 ---- */
    var wt = document.createElement('div');
    wt.className = 'ribnote';
    wt.textContent = '材料变化：'
      + (rb.style === 'spiral' ? '凸肋增料' : (rb.style === 'radial' ? '铣槽减料' : '无变化'))
      + '，相对无导水槽基线重量 ' + fmt(geo.weightBase, 0) + ' g，当前 ' + fmt(geo.weightG, 0) + ' g。';
    host.appendChild(wt);
  }

  // 分段明细表：段号 / 形状 / 高度范围 / 占全高 / 泄压路径 / 该段阻力 / 阻力占比
  function renderSegTable(rb) {
    var wrap = document.createElement('div');
    var t = document.createElement('table');
    t.className = 'segtable';
    var thead = document.createElement('thead');
    var tr = document.createElement('tr');
    ['段', '形状', '高度范围 (mm)', '占全高', '泄压路径 (mm)', '该段阻力', '占比'].forEach(function (h) {
      var th = document.createElement('th');
      th.textContent = h;
      tr.appendChild(th);
    });
    thead.appendChild(tr);
    t.appendChild(thead);
    var tbody = document.createElement('tbody');
    var segs = rb.segStats || [];
    for (var i = 0; i < segs.length; i++) {
      var sg = segs[i];
      var row = document.createElement('tr');
      function td(txt, bold) {
        var c = document.createElement('td');
        c.textContent = txt;
        if (bold) c.style.fontWeight = '600';
        return c;
      }
      row.appendChild(td(String(i + 1), true));
      var cShape = document.createElement('td');
      cShape.style.textAlign = 'right';
      var pill = document.createElement('span');
      pill.className = 'shpill';
      pill.style.background = segShapeColor(sg.shape);
      pill.textContent = SEG_SHORT[sg.shape];
      cShape.appendChild(pill);
      row.appendChild(cShape);
      row.appendChild(td(fmt(sg.z0, 1) + '–' + fmt(sg.z1, 1)));
      row.appendChild(td(fmt(sg.frac * 100, 0) + '%'));
      row.appendChild(td(fmt(sg.pathL, 1)));
      row.appendChild(td(sg.bBand > 1e20 ? '∞（堵死）' : sg.bBand.toExponential(2)));
      var share = rb.b_air > 0 ? sg.bBand / rb.b_air * 100 : 0;
      var cShare = td(fmt(share, 1) + '%', share > 50);
      if (share > 50) cShare.style.color = 'var(--bad)';
      row.appendChild(cShare);
      tbody.appendChild(row);
    }
    t.appendChild(tbody);
    wrap.appendChild(t);
    return wrap;
  }

  // 贯通性结论
  function renderVentStatus(rb) {
    var d = document.createElement('div');
    d.className = rb.throughVent ? 'segok' : 'segwarn';
    var txt = '排气贯通性：自杯底起连续带肋高度 ' + fmt(rb.contiguousH, 1) + ' mm，'
      + '带肋段占壁高 ' + fmt(rb.ventFrac, 1) + '%。'
      + (rb.throughVent
        ? '全壁贯通 —— 粉床下方负压可一路排到杯口。'
        : '未全高贯通 —— 存在光壁段，负压无法从粉床下方泄放到杯口，'
          + '袋腔负压抵消 ' + fmt(rb.pVentRatio, 1) + '% 的驱动水头。');
    d.textContent = txt;
    return d;
  }

  function ribCard(title, sub) {
    var node = document.createElement('div');
    node.className = 'ribcard';
    var h = document.createElement('div');
    h.className = 'rh';
    var t = document.createElement('span');
    t.textContent = title;
    var e = document.createElement('em');
    e.textContent = sub;
    h.appendChild(t);
    h.appendChild(e);
    node.appendChild(h);
    var body = document.createElement('div');
    body.className = 'rb';
    node.appendChild(body);
    return { node: node, body: body };
  }

  // 一行文本，parts 里奇数下标为需要加粗的关键值
  function ribLine(parts) {
    var d = document.createElement('div');
    parts.forEach(function (p, i) {
      if (i % 2 === 1) {
        var b = document.createElement('b');
        b.textContent = p;
        d.appendChild(b);
      } else {
        d.appendChild(document.createTextNode(p));
      }
    });
    return d;
  }

  function ribNote(text, kind) {
    var d = document.createElement('div');
    d.className = 'ribnote' + (kind ? ' ' + kind : '');
    d.textContent = text;
    return d;
  }

  // 进度条：label + 百分比
  function ribBar(label, val, key) {
    var wrap = document.createElement('div');
    var lb = document.createElement('div');
    lb.style.fontSize = '11px';
    lb.style.color = 'var(--muted)';
    lb.textContent = label + '：' + fmt(val, 1) + '%';
    wrap.appendChild(lb);
    var bar = document.createElement('div');
    bar.className = 'ribbar';
    var i = document.createElement('i');
    var pct = Math.max(0, Math.min(100, val));
    i.style.width = pct.toFixed(1) + '%';
    if (key === 'pVentRatio') {
      // 负压抵消比越低越好：低值用绿色，高值用红色
      i.style.background = val < 20 ? 'var(--ok)' : (val < 60 ? 'var(--rib)' : 'var(--bad)');
    } else {
      i.style.background = val >= 8 ? 'var(--ok)' : 'var(--rib)';
    }
    bar.appendChild(i);
    wrap.appendChild(bar);
    return wrap;
  }

  function setMetric(id, value, unit) {
    var node = $(id);
    node.textContent = '';
    node.appendChild(document.createTextNode(value));
    if (unit) {
      var s = document.createElement('small');
      s.textContent = unit;
      node.appendChild(s);
    }
  }

  function fillTable(id, rows) {
    var t = $(id);
    clear(t);
    rows.forEach(function (row) {
      var tr = document.createElement('tr');
      var a = document.createElement('td'); a.textContent = row[0];
      var b = document.createElement('td'); b.textContent = row[1];
      tr.appendChild(a); tr.appendChild(b);
      t.appendChild(tr);
    });
  }

  /* ============ 反解器 ============ */
  function renderSolver() {
    var tq = parseFloat($('tq').value) || 0;
    var th = parseFloat($('th').value) || 0;
    var out = $('solveOut');
    out.textContent = '';
    if (tq <= 0 || th <= 0) { out.textContent = '请输入目标流速与驱动水头'; return; }

    var sol = MODEL.solveHoleArea(S, tq, th / 1000);
    var g = MODEL.solveGrind(S, tq, th / 1000);

    var lines = [];
    if (sol && !sol.bedLimited) {
      var cur = RESULT.geo.AHole * 1e6;
      lines.push(['要达 ', fmt(tq, 2) + ' g/s', '，孔口总截面需 ', fmt(sol.area_mm2, 1) + ' mm²', '（当前 ' + fmt(cur, 1) + ' mm²）']);
      var d1 = 2 * Math.sqrt(sol.area_mm2 / Math.PI);
      lines.push(['→ 若仍是', '单孔', '，孔径约 ', fmt(d1, 1) + ' mm']);
      var n1 = Math.ceil(sol.area_mm2 / (Math.PI * Math.pow(S.holeD / 2, 2)));
      lines.push(['→ 若沿用 ', fmt(S.holeD, 1) + ' mm', ' 单孔，需 ', n1 + ' 个']);
    } else {
      lines.push(['该水头下', '粉床本身', '已能供给 ' + fmt(tq, 2) + ' g/s，孔口不是瓶颈 —— 瓶颈在研磨度与粉床厚度']);
    }
    if (g && !g.impossible) {
      lines.push(['达成该流速需要渗透率 ', g.k.toExponential(2) + ' m²', '，对应研磨度 ', fmt(g.grind, 0) + '（' + MODEL.grindLabel(g.grind) + '）']);
    } else if (g && g.impossible) {
      lines.push(['当前孔口与水头组合', '无法', '达到该流速，需加大水头或放大孔口']);
    }
    lines.forEach(function (parts) {
      var d = document.createElement('div');
      d.style.margin = '0 0 5px';
      parts.forEach(function (part, pi) {
        if (pi % 2 === 1) {
          var bb = document.createElement('b');
          bb.textContent = part;
          d.appendChild(bb);
        } else {
          d.appendChild(document.createTextNode(part));
        }
      });
      out.appendChild(d);
    });
  }

  /* ============ 对比表 ============ */
  function renderCompare() {
    var body = $('cmpBody');
    clear(body);
    if (!COMPARE.length) {
      var tr = document.createElement('tr');
      var td = document.createElement('td');
      td.colSpan = 6;
      td.style.color = '#9b8b7c';
      td.style.textAlign = 'center';
      td.style.padding = '14px 0';
      td.textContent = '还没有存入方案';
      tr.appendChild(td); body.appendChild(tr);
      return;
    }
    COMPARE.forEach(function (item, idx) {
      var tr = document.createElement('tr');
      var cells = [
        item.name, fmt(item.avgFlow, 2) + ' g/s', clock(item.totalTime),
        fmt(item.ey, 1) + '%', fmt(item.tds, 2) + '%'
      ];
      cells.forEach(function (c, ci) {
        var td = document.createElement('td');
        td.textContent = c;
        if (ci === 0) {
          td.addEventListener('click', function () {
            S = JSON.parse(JSON.stringify(item.S));
            syncParams(); render(); toast('已载入「' + item.name + '」');
          });
        }
        tr.appendChild(td);
      });
      var tdX = document.createElement('td');
      var b = document.createElement('button');
      b.className = 'x'; b.type = 'button'; b.textContent = '×';
      b.addEventListener('click', function () { COMPARE.splice(idx, 1); renderCompare(); });
      tdX.appendChild(b);
      tr.appendChild(tdX);
      body.appendChild(tr);
    });
  }

  /* ============ 导出 ============ */
  function schemeText() {
    var r = RESULT, geo = r.geo;
    var shapeName = S.shape === 'cone' ? '锥形 ' + fmt(S.coneAngle, 0) + '°' : (S.shape === 'flat' ? '平底' : '直筒');
    var holeName = S.holeLayout === 'single' ? '中心单孔 ⌀' + fmt(S.holeD, 1) :
      (S.holeLayout === 'ring' ? '环形 ' + S.holeCount + '×⌀' + fmt(S.holeD, 1) + 'mm（环半径 ' + fmt(S.ringR, 1) + '）' :
        '中心+环 ' + S.holeCount + '×⌀' + fmt(S.holeD, 1) + 'mm');
    return [
      '☕ 手冲滤杯设计工坊 · 冲煮方案',
      '────────────────────────',
      '滤杯：' + shapeName + '　上口 ⌀' + fmt(S.Dtop, 0) + 'mm　高 ' + fmt(geo.height, 0) + 'mm',
      '底孔：' + holeName + '　合计 ' + fmt(geo.AHole * 1e6, 0) + 'mm²',
      '材质：' + geo.matName + '（壁厚 ' + fmt(S.wall, 1) + 'mm，约 ' + fmt(geo.weightG, 0) + 'g）',
      '咖啡：' + fmt(S.dose, 1) + 'g　研磨度 ' + S.grind + '（' + MODEL.grindLabel(S.grind) + '）',
      '水温：' + fmt(S.temp, 0) + '°C　粉水比 1:' + fmt(S.ratio, 1),
      '闷蒸：' + fmt(S.dose * S.bloomMult, 0) + 'g / ' + fmt(S.bloomTime, 0) + 's',
      '壁部导水槽：' + (geo.ribs.style === 'none' ? '无（光壁光底）'
        : (geo.ribs.style === 'spiral'
          ? (geo.ribs.segMode
            ? geo.ribs.segCount + ' 段分段排气肋（' + segDescText(geo.ribs) + '）'
              + ' → 通路 B 排气泄压，袋腔负压抵消水头 ' + fmt(geo.ribs.pVentRatio, 1) + '%'
              + '，排气' + (geo.ribs.throughVent ? '全壁贯通' : '未贯通（连续带肋 '
                + fmt(geo.ribs.contiguousH, 1) + 'mm / ' + fmt(geo.ribs.ventFrac, 0) + '%）')
            : geo.ribs.count + ' 条螺旋凸肋（宽 ' + fmt(geo.ribs.width, 1) + 'mm / 高 '
              + fmt(geo.ribs.depth, 1) + 'mm / ' + fmt(geo.ribs.turns, 2) + ' 圈）'
              + ' → 通路 B 排气泄压，袋腔负压抵消水头 ' + fmt(geo.ribs.pVentRatio, 1) + '%')
          : geo.ribs.count + ' 条径向铣槽（宽 ' + fmt(geo.ribs.width, 1) + 'mm / 深 '
            + fmt(geo.ribs.depth, 1) + 'mm）'
            + ' → 通路 A 底部汇流旁路，横向汇流阻力降 ' + fmt(geo.ribs.bypassGain, 1) + '%'))
        + '，流速增益 ' + (geo.ribs.ventGain >= 0 ? '+' : '') + fmt(geo.ribs.ventGain, 1) + '%',
      '注水：' + S.pourCount + ' 段共 ' + fmt(S.pourTime, 0) + 's',
      '────────────────────────',
      '预计总时长 ' + clock(r.totalTime) + '　峰值流速 ' + fmt(r.peak, 2) + ' g/s　平均 ' + fmt(r.avgFlow, 2) + ' g/s',
      '出液 ' + fmt(r.liquid, 0) + 'g　萃取率 ' + fmt(r.ey, 1) + '%　TDS ' + fmt(r.tds, 2) + '%',
      '评价：' + r.verdict + ' —— ' + r.advice
    ].join('\n');
  }

  function toast(msg) {
    var t = $('toast');
    t.textContent = msg;
    t.classList.add('on');
    window.clearTimeout(t._tm);
    t._tm = window.setTimeout(function () { t.classList.remove('on'); }, 1900);
  }

  function copyText(txt) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(txt).then(function () { toast('冲煮方案已复制到剪贴板'); }, function () { fallbackCopy(txt); });
    } else fallbackCopy(txt);
  }
  function fallbackCopy(txt) {
    var ta = document.createElement('textarea');
    ta.value = txt;
    ta.style.position = 'fixed';
    ta.style.left = '-9999px';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); toast('冲煮方案已复制到剪贴板'); }
    catch (e) { toast('复制失败，请手动选择文本'); }
    document.body.removeChild(ta);
  }

  function randomDesign() {
    var rnd = function (a, b) { return a + Math.random() * (b - a); };
    // 随机化壁部导水槽：形式与规格（须在 defaultState 之后设置）
    var rs = Math.random();
    var ribStyle = rs < 0.34 ? 'none' : (rs < 0.68 ? 'spiral' : 'radial');
    var ribCount = 3 + Math.floor(Math.random() * 14);
    var ribWidth = Math.round((0.8 + Math.random() * 3.4) * 10) / 10;
    var ribDepth = Math.round((0.3 + Math.random() * 1.5) * 10) / 10;
    var ribTurns = Math.round((0.5 + Math.random() * 2) * 4) / 4;
    var shape = Math.random() < 0.5 ? 'cone' : (Math.random() < 0.6 ? 'flat' : 'cyl');
    S = MODEL.defaultState();
    S.shape = shape;
    S.Dtop = Math.round(rnd(78, 150));
    S.coneAngle = Math.round(rnd(38, 72));
    S.wallTilt = Math.round(rnd(6, 20) * 2) / 2;
    S.flatDepth = Math.round(rnd(4, 16));
    S.cylH = Math.round(rnd(50, 110));
    S.wall = Math.round(rnd(1.2, 4) * 10) / 10;
    S.dose = Math.round(rnd(10, 30) * 2) / 2;
    S.grind = Math.round(rnd(38, 66));
    S.ratio = Math.round(rnd(13, 19) * 2) / 2;
    S.temp = Math.round(rnd(88, 96));
    S.material = ['pp', 'glass', 'ceramic', 'steel'][Math.floor(Math.random() * 4)];
    if (shape === 'cone') {
      S.holeLayout = Math.random() < 0.6 ? 'single' : 'ring';
      S.r0 = 6;
      S.holeCount = S.holeLayout === 'single' ? 1 : Math.round(rnd(3, 8));
      S.holeD = Math.round(rnd(8, 20) * 2) / 2;
      S.ringR = S.holeLayout === 'single' ? 0 : Math.round(rnd(8, 18) * 2) / 2;
    } else {
      S.holeLayout = Math.random() < 0.5 ? 'single' : 'ring';
      S.r0 = Math.round(rnd(28, 46) * 2) / 2;
      S.holeCount = S.holeLayout === 'single' ? 1 : Math.round(rnd(3, 8));
      S.holeD = Math.round(rnd(6, 20) * 2) / 2;
      S.ringR = S.holeLayout === 'single' ? 0 : Math.round(rnd(12, 26) * 2) / 2;
    }
    S.ribStyle = ribStyle;
    S.ribCount = ribCount;
    S.ribWidth = ribWidth;
    S.ribDepth = ribDepth;
    S.ribTurns = ribTurns;
    // 分段模式与分段结构随机化（仅锥形杯才有壁面分段意义）
    S.ribSegMode = 'single';
    S.ribSegs = null;
    if (ribStyle === 'spiral') {
      var segModeRoll = Math.random();
      if (segModeRoll < 0.3) {
        S.ribSegMode = 'seg';
        var HH = (RESULT && RESULT.geo) ? RESULT.geo.height : 90;
        var nSeg = 2 + Math.floor(Math.random() * 3);   // 2~4 段
        var cuts = [0];
        for (var csg = 1; csg < nSeg; csg++) {
          cuts.push(Math.round(HH * (csg / nSeg + (Math.random() - 0.5) * 0.18)));
        }
        cuts.push(HH);
        S.ribSegs = [];
        for (var si = 0; si < nSeg; si++) {
          var z0 = Math.max(0, Math.min(HH, cuts[si]));
          var z1 = Math.max(z0, Math.min(HH, cuts[si + 1]));
          var shp = ['spiral', 'straight', 'none', 'spiral', 'straight'][Math.floor(Math.random() * 5)];
          S.ribSegs.push({
            shape: shp, z0: z0, z1: z1,
            count: shp === 'none' ? 0 : 3 + Math.floor(Math.random() * 12),
            width: ribWidth, depth: ribDepth, turns: ribTurns
          });
        }
      }
    }
    if (S.r0 * 2 < S.holeD) S.holeD = Math.max(2, Math.round(S.r0 * 1.6 * 2) / 2);
    if (S.holeLayout !== 'single' && S.ringR + S.holeD / 2 > S.r0) S.ringR = Math.max(0, Math.round((S.r0 - S.holeD / 2) * 2) / 2);
    syncParams();
    render();
    toast('已生成随机设计 —— 拖拽控制点继续微调');
  }

  /* ============ 主渲染 ============ */
  function render() {
    RESULT = MODEL.simulate(S);
    /* 侧视图缩放比例（供拖拽换算） */
    var geo = RESULT.geo;
    var scale = Math.min((VB.w - 92) / (S.Dtop + 26), (VB.h - 60) / (geo.height + 16));
    RESULT.scale = scale;

    renderSide();
    renderTop();
    renderChart();
    renderMetrics();
    renderSolver();
    renderCompare();
  }

  /* ============ 初始化 ============ */
  buildParams();
  buildChips();
  syncParams();
  render();

  $('btnCopy').addEventListener('click', function () { copyText(schemeText()); });
  $('btnRandom').addEventListener('click', randomDesign);
  $('btnSave').addEventListener('click', function () {
    if (COMPARE.length >= 4) { toast('最多存 4 个方案，请先删除'); return; }
    var name = (S.shape === 'cone' ? '锥形' : (S.shape === 'flat' ? '平底' : '直筒')) + ' ⌀' + fmt(S.Dtop, 0) + ' · ' + fmt(S.holeD, 1) + 'mm';
    COMPARE.push({
      name: name, S: JSON.parse(JSON.stringify(S)),
      avgFlow: RESULT.avgFlow, totalTime: RESULT.totalTime, ey: RESULT.ey, tds: RESULT.tds
    });
    renderCompare();
    toast('已存入对比列表');
  });
  $('btnClear').addEventListener('click', function () { COMPARE = []; renderCompare(); });
  $('tq').addEventListener('input', renderSolver);
  $('th').addEventListener('input', renderSolver);

  // 调试/自动化出口：供集成测试读取内部状态与导出文本
  window.__POUR = {
    schemeText: function () { return schemeText(); },
    getState: function () { return S; },
    setState: function (o) { Object.assign(S, o); onChange('debug'); }
  };
})();
