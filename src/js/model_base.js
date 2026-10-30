
/* ===========================================================
 * 手冲滤杯设计工坊 · 几何 + 渗流 + 时序 模型 (ES5)
 * ------------------------------------------------------------
 * 几何  内壁轮廓 r(z) -> 粉床几何 -> 滤孔布局
 * 渗流  Darcy 达西流(粉床) ⊕ 滤纸阻力 ⊕ 孔口堰流(Torricelli) 三段串联
 *       a·Q² + b·Q = ρ·g·H
 *       收敛段用当量面积 A = V(段)/L(段)
 * 时序  三阶段
 *       fill       润湿锋面自粉床顶面向下推进；锋面到底前无贯通水路（闷蒸几乎不外流）
 *       percolate  粉床饱和，自由水在粉床上方堆积；水头 = 液面到孔口的高差
 *       drain      注水结束，湿润区自上而下回落，水头随之下降，滴滤自然收尾
 * 萃取  接触时间驱动的产率模型 + TDS
 * =========================================================== */
var MODEL = (function () {
  'use strict';

  var G = 9.80665;
  var CD = 0.62;             // 孔口流量系数
  var K_PAPER = 3e-12;       // m^2 滤纸渗透率
  var PAPER_THICK = 0.0003;  // m
  var POROSITY = 0.65;       // 粉床孔隙率
  var TAU_ABS = 15;          // s 颗粒吸附水时间常数
  var TAU_FRONT = 22;        // s 润湿锋面推进时间常数
  var RHO_K = 6.0e-11;       // m^2 参考渗透率（研磨度 50 档）
  var MU_AIR = 1.8e-5;       // Pa·s 空气黏度
  var CONFORM_GAP = 0.09;    // mm 滤纸润湿贴壁后残留的褶皱缝隙高度（无导水槽时的泄压能力）
  var SEG_SHAPES = ['spiral', 'straight', 'none'];
  var SKIP_CF = false;   // 反事实对照时抑制递归

  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function fmtMm(v) { return Math.round(v * 10) / 10; }

  /* ---------------- 水性 ---------------- */
  function waterProps(T) {
    var mu = 1.79e-3 / (1 + 0.0337 * T + 0.000221 * T * T);
    var tbl = [[0,999.84],[4,999.97],[20,998.21],[30,995.65],[40,992.22],
               [50,988.04],[60,983.20],[70,977.76],[80,971.79],[90,965.31],[100,958.35]];
    var rho = tbl[0][1], i;
    if (T <= 0) rho = tbl[0][1];
    else if (T >= 100) rho = 958.35 - (T - 100) * 0.8;
    else {
      for (i = 0; i < tbl.length - 1; i++) {
        if (T >= tbl[i][0] && T <= tbl[i + 1][0]) {
          var f = (T - tbl[i][0]) / (tbl[i + 1][0] - tbl[i][0]);
          rho = tbl[i][1] + f * (tbl[i + 1][1] - tbl[i][1]);
          break;
        }
      }
    }
    return { mu: mu, rho: rho };
  }

  /* ---------------- 研磨度映射 ---------------- */
  // grind: 0 极细(意式) -> 50 中细(常规手冲) -> 100 极粗(法压)
  // 颗粒越细 -> 孔隙越小 -> 渗透率越低 -> 阻力越大 -> 流速越慢
  function permeability(grind) { return RHO_K * Math.pow(10, (grind - 50) / 45); }
  function bulkDensity(grind) { return 0.44 - 0.08 * (grind / 100); }   // g/cm3 粗粉更蓬松
  function grindFromPermeability(k) { return 50 + 45 * Math.log(k / RHO_K) / Math.LN10; }
  function grindLabel(g) {
    if (g < 12) return '极细（意式级）';
    if (g < 28) return '细（法压/爱乐压）';
    if (g < 42) return '中细（V60 常规）';
    if (g < 58) return '中等（Kalita/Origami）';
    if (g < 74) return '中粗（Chemex）';
    return '粗（法压壶）';
  }

  /* ---------------- 内壁轮廓 ---------------- */
  // 统一表示: r(z) = r0 + tan*(z - zFlat)；zFlat 之前是平底井
  function buildProfile(S) {
    var tan = 0, zFlat = 0, H = 0, r0 = S.r0, issues = [];

    if (S.shape === 'cone') {
      tan = Math.tan(S.coneAngle / 2 * Math.PI / 180);
      if (Math.abs(tan) < 1e-4) tan = 1e-4;
      zFlat = 0;
      // 锥尖被底孔截断：底区半径取孔口外缘
      var rHole = S.holeD / 2;
      if (S.holeLayout !== 'single') {
        rHole = Math.max(rHole, S.ringR + S.holeD / 2);
      }
      r0 = Math.max(r0, rHole);
      if (S.Dtop / 2 <= r0 + 0.5) {
        issues.push('上口直径过小：上口半径需大于底区半径');
        r0 = Math.max(1, S.Dtop / 2 - 1);
      }
      H = (S.Dtop / 2 - r0) / tan;
    } else if (S.shape === 'flat') {
      tan = Math.tan(S.wallTilt * Math.PI / 180);
      zFlat = S.flatDepth;
      if (tan < 0.02) {                       // 近直壁 -> 直筒
        tan = 0; r0 = S.Dtop / 2; H = zFlat + S.cylH;
      } else {
        if (S.Dtop / 2 <= r0) {
          issues.push('平底半径不得大于上口半径');
          r0 = S.Dtop / 2 - 1;
        }
        H = zFlat + (S.Dtop / 2 - r0) / tan;
      }
    } else {
      tan = 0; zFlat = 0; r0 = S.Dtop / 2; H = S.cylH;
    }
    return { r0: r0, tan: tan, zFlat: zFlat, H: H, shape: S.shape, issues: issues };
  }

  function radiusAt(P, z) {
    if (z <= P.zFlat) return P.r0;
    return P.r0 + P.tan * (z - P.zFlat);
  }

  function volumeBelow(P, z) {     // mm3
    if (z <= 0) return 0;
    var v = 0, zf = Math.min(z, P.zFlat);
    if (zf > 0) v += Math.PI * P.r0 * P.r0 * zf;
    if (z > P.zFlat) {
      var h = z - P.zFlat, r0 = P.r0, t = P.tan;
      v += Math.PI * (r0 * r0 * h + r0 * t * h * h + t * t * h * h * h / 3);
    }
    return v;
  }

  function zForVolume(P, V) {      // 反解高度 (mm)：牛顿迭代 + 二分兜底
    if (V <= 0) return 0;
    var lo = 0, hi = 50;
    while (volumeBelow(P, hi) < V && hi < 1e6) hi *= 2;
    var z = hi / 2, i;
    for (i = 0; i < 24; i++) {
      var f = volumeBelow(P, z) - V;
      if (Math.abs(f) < 1e-6) break;
      var dV = Math.PI * radiusAt(P, z) * radiusAt(P, z);
      var zNew = (dV > 1e-9) ? z - f / dV : (lo + hi) / 2;
      if (zNew <= lo || zNew >= hi || !isFinite(zNew)) zNew = (lo + hi) / 2;
      if (volumeBelow(P, zNew) < V) lo = zNew; else hi = zNew;
      z = zNew;
    }
    for (i = 0; i < 24; i++) {
      var mid = (lo + hi) / 2;
      if (volumeBelow(P, mid) < V) lo = mid; else hi = mid;
    }
    return (lo + hi) / 2;
  }

  /* ---------------- 材质 ---------------- */
  var MATERIALS = {
    pp:       { name: 'PP 塑料',    rho: 0.95 },
    pet:      { name: 'PET 塑料',   rho: 1.38 },
    glass:    { name: '耐热玻璃',   rho: 2.50 },
    ceramic:  { name: '陶瓷',       rho: 2.40 },
    steel:    { name: '304 不锈钢', rho: 7.93 },
    titanium: { name: '钛合金',     rho: 4.51 }
  };

  /* ---------------- 壁部导水槽（螺旋凸肋 / 径向铣槽） ----------------
   * 真实世界：Hario V60 02 的锥壁上有螺旋凸肋；Kalita Wave / Origami 一类
   * 平底滤杯的底面铣有径向导流槽。两者做的其实是同一件事，只是位置不同：
   *
   *   在滤纸与杯壁（或底面）之间腾出一条"沟"，
   *   让空气有路可走、让滤液有路可流。
   *
   * (1) 泄压排气（螺旋凸肋，锥形杯）
   *     锥形杯里滤纸是罩在锥壁上的。滤纸被水润湿后贴紧锥壁，滤纸与壁
   *     之间围出一个密闭的"袋腔"。粉床排水时袋腔里的空气进不来也出不去，
   *     形成负压：出口水头被负压额外抵消一部分，表现为流速上不去、
   *     滴滤段咕噜咕噜地断流。螺旋凸肋把滤纸撑离壁面，在肋间留下一条
   *     连续的螺旋通气道，负压得以泄放。
   *
   * (2) 导流旁路（径向铣槽，平底/直筒杯）
   *     平底滤杯的粉床底部渗出的水若只能挤过压实细粉层横向汇入底孔，
   *     阻力极大。铣槽让水沿槽直接流到底孔，相当于给横向汇流并联一条
   *     低阻通道。矩形槽的 Darcy 电导：
   *       G_groove = w*h^3 / (12*mu*L_ch)
   *     铣槽只覆盖底面的一部分，设覆盖率 f = N*w /(pi*r_mid)，
   *     则横向汇流的合成电导为
   *       G_eff = (1-f)/b_lat + f*eta*G_groove
   *
   * (3) 泄压通道的统一处理
   *     滤纸与壁面之间的贴合缝隙 h_c 本身就是一条通气道；凸肋 / 铣槽
   *     把它从 0.06mm 抬到毫米级。矩形窄缝的电导：
   *       G = w*h^3 /(12*mu*L)      ->   b_air = 1/G   (Pa*s/m^3)
   *     由于 dp = b_air*Q 与流量成正比，它恰好是串联方程里又一个线性阻力。
   *     负压 dp 直接抵消驱动水头，这是锥形杯"不装肋就咕噜"的根源。
   *
   * 矩形通道当量渗透率 k_ch = min(w,h)^2/12（Darcy 薄缝解）。
   */

  // 矩形窄缝的电导 m^3/(Pa*s)：宽 wM、高 hM、流动长度 LM（均为 m）
  function slotG(wM, hM, LM, muV) {
    if (!(wM > 0) || !(hM > 0) || !(LM > 0)) return 0;
    return wM * hM * hM * hM / (12 * muV * LM);
  }

  /* ---------------- 分段导水槽规格 ----------------
   * S.ribSegs 是一段规格数组（可选）。每段：
   *   { shape:'spiral'|'straight'|'none',
   *     z0, z1 : 该段在母线方向上的起止高度（mm，绝对高度坐标）
   *     count  : 条数
   *     width  : 肋宽 / 槽宽（mm）
   *     depth  : 肋高 / 槽深（mm）
   *     turns  : 螺旋段在该段内的圈数（straight 忽略）
   * 缺省（没有 ribSegs）时退化为单段整壁，行为与旧版完全一致。
   */
  function normalizeSegs(S, P) {
    var slant = P.H / Math.max(0.25, Math.cos(Math.atan(P.tan)));
    var list = null;
    if (S.ribSegMode === 'seg' && S.ribSegs && S.ribSegs.length) {
      list = [];
      for (var i = 0; i < S.ribSegs.length; i++) {
        var sg = S.ribSegs[i] || {};
        var shape = SEG_SHAPES.indexOf(sg.shape) >= 0 ? sg.shape : 'none';
        var z0 = Math.max(0, Math.min(P.H, isFinite(sg.z0) ? sg.z0 : 0));
        var z1 = Math.max(z0, Math.min(P.H, isFinite(sg.z1) ? sg.z1 : P.H));
        list.push({
          shape: shape,
          z0: z0, z1: z1,
          count: Math.max(0, Math.round(isFinite(sg.count) ? sg.count : 0)),
          width: Math.max(0, isFinite(sg.width) ? sg.width : 0),
          depth: Math.max(0, isFinite(sg.depth) ? sg.depth : 0),
          turns: Math.max(0.05, isFinite(sg.turns) ? sg.turns : 1)
        });
      }
      // 至少要有一段
      if (!list.length) list = null;
    }
    if (!list) {
      // 单段整壁：spiral 用旧参数，其余按 none 处理
      list = [{
        shape: (S.ribStyle === 'spiral') ? 'spiral' : 'none',
        z0: 0, z1: P.H,
        count: Math.max(0, Math.round(S.ribCount || 0)),
        width: Math.max(0, S.ribWidth || 0),
        depth: Math.max(0, S.ribDepth || 0),
        turns: Math.max(0.05, S.ribTurns || 1)
      }];
    }
    // 按 z0 排序
    list.sort(function (a, b) { return a.z0 - b.z0; });
    // 计算每段母线长度与中点半径
    var halfAng = Math.atan(P.tan);
    var k = 1 / Math.max(0.25, Math.cos(halfAng));
    for (var j = 0; j < list.length; j++) {
      var sg2 = list[j];
      sg2.dz = sg2.z1 - sg2.z0;
      sg2.slant = sg2.dz * k;                       // mm 该段母线长
      sg2.rMid = (radiusAt(P, sg2.z0) + radiusAt(P, sg2.z1)) / 2;
      sg2.perim = 2 * Math.PI * sg2.rMid;
      sg2.frac = P.H > 0 ? sg2.dz / P.H : 0;       // 占全高比例
    }
    return list;
  }

  function buildRibs(S, P, props, kEff) {
    var R = {
      style: S.ribStyle || 'none',          // none | spiral | radial
      count: Math.max(0, Math.round(S.ribCount || 0)),
      width: Math.max(0, S.ribWidth || 0),   // mm 槽宽 / 肋宽
      depth: Math.max(0, S.ribDepth || 0),   // mm 槽深 / 肋高
      turns: Math.max(0.25, S.ribTurns || 1),// 螺旋肋每条绕壁圈数
      standoff: 0,                          // mm 滤纸被撑离壁面的有效高度
      A_vent: 0,                            // mm^2 通气通道截面积
      L_vent: 0,                            // mm 通气路径长度
      G_vent: 0,                            // m^3/(Pa*s) 通气总电导
      G_rib: 0,                             // m^3/(Pa*s) 肋/槽自身的通气电导
      G_crev: 0,                            // m^3/(Pa*s) 贴合缝隙的通气电导
      b_air: 0,                             // Pa*s/m^3 泄压等效阻力
      ventShare: 0,                         // 泄压阻力占总阻力比例（诊断用）
      pVent: 0,                             // Pa 估算袋腔负压
      pVentRatio: 0,                        // % 负压对驱动水头的抵消比
      ventGain: 0,                          // % 导水槽带来的流速提升
      grooveGain: 0,                        // % 同上（别名，按形式取用）
      Qwork: 0,                             // g/s 典型工作点流速
      gainQwith: 0,                         // g/s 有导水槽时的工作点流速
      gainQwithout: 0,                      // g/s 无导水槽时的工作点流速
      G_groove: 0,                          // m^3/(Pa*s) 铣槽导流电导
      b_bypass: Infinity,                   // Pa*s/m^3 旁路折算阻力
      bypassGain: 0,                        // 铣槽降低横向汇流阻力的比例 %
      capture: 0,                           // 铣槽对底面的覆盖率 %
      vol: 0,                               // mm^3 材料体积变化（正=凸肋增重，负=铣槽减重）
      isGroove: false,
      rIn: 0, rOut: 0, L_ch: 0, rMidCh: 0,
      helixR: 0, helixL: 0, perim: 0, freeW: 0, slant: 0,
      applicable: true,                     // 该形式在当前杯型下是否有效
      mismatch: '',                         // 不匹配时的说明
      wallCover: 0,                         // % 肋占壁面周长的比例
      slotAreaMm2: 0                        // mm^2 铣槽面积
    };
    var mu = props.mu;
    var isCone = (S.shape === 'cone');
    // 螺旋凸肋靠的是"壁面 + 滤纸"形成的袋腔，只有锥形/直筒壁才有；
    // 径向铣槽铣在底面上，只有平底/直筒底才有。
    if (R.style === 'spiral' && isCone) R.applicable = true;
    else if (R.style === 'spiral') { R.applicable = false; R.mismatch = '螺旋凸肋需要在有锥壁的杯型上起作用，当前杯型的壁面不形成袋腔，凸肋无法泄压'; }
    else if (R.style === 'radial' && !isCone) R.applicable = true;
    else if (R.style === 'radial') { R.applicable = false; R.mismatch = '径向铣槽铣在底面上，当前是锥形杯底（收束成锥尖），铣槽无处可铣；锥形杯应改用螺旋凸肋'; }
    var halfAng = Math.atan(P.tan);
    var slant = P.H / Math.max(0.25, Math.cos(halfAng));   // mm 斜壁长度
    var rMid = (P.r0 + radiusAt(P, P.H)) / 2;               // mm 中部半径
    var perim = 2 * Math.PI * rMid;                        // mm 中部周长
    var hc = CONFORM_GAP / 1000;                           // m 贴合缝隙
    R.perim = perim; R.slant = slant; R.rMidCh = rMid;

    if (isCone) {
      /* ---------- 锥形：分段导水槽 -> 泄压排气 ----------
       * 沿母线把壁面切成若干段，每段可选不同形状：
       *   spiral  螺旋凸肋：沿该段盘旋上升，泄压路径长（阻力大）
       *   straight 纵向直肋：沿母线直上直下，泄压路径短（阻力小）
       *   none    光壁：无凸肋，滤纸贴壁，只有贴合缝隙可泄压
       *
       * 关键：泄压通道沿母线是**串联**的。粉床下方的负压要一路排到杯口，
       * 所以总泄压阻力 = 各段阻力之和；任何一段光壁都会成为瓶颈，
       * 把整条排气通路堵死。这就是"分段必须贯通"的物理含义。
       */
      var segs = normalizeSegs(S, P);
      R.segs = segs;
      R.isSeg = segs.length > 1;
      var bAir = 0, bTurn = 0;
      var GribSum = 0, GcrevSum = 0, AventSum = 0, volSum = 0, freeWSum = 0, LventSum = 0;
      var ribbedH = 0, wallH = 0, standoffMax = 0;
      var wallArea = 0, ribArea = 0;
      var segStats = [];
      var prev = null;
      for (var i = 0; i < segs.length; i++) {
        var sg = segs[i];
        var isRib = (sg.shape === 'spiral' || sg.shape === 'straight')
          && sg.count > 0 && sg.width > 0 && sg.depth > 0;
        var pathL = sg.slant;
        var Grib = 0, Gcrev = 0, bBand = 0, turnB = 0;
        if (isRib) {
          if (sg.shape === 'spiral') {
            var horiz = 2 * Math.PI * sg.rMid * sg.turns;   // 该段螺旋水平投影长
            pathL = Math.sqrt(horiz * horiz + sg.dz * sg.dz);
          }
          Grib = sg.count * slotG(sg.width / 1000, sg.depth / 1000, pathL / 1000, MU_AIR);
          ribbedH += sg.dz;
        }
        var freeW = isRib ? Math.max(0, sg.perim - sg.count * sg.width) : sg.perim;
        Gcrev = slotG(freeW / 1000, hc, sg.slant / 1000, MU_AIR);
        var gSum = Grib + Gcrev;
        bBand = gSum > 0 ? 1 / gSum : 1e30;
        // 段间转折局部损失：相邻两段形状不同，泄压通道要拐一次弯
        if (prev && prev.isRib && isRib && prev.shape !== sg.shape) {
          // 形状切换处泄压通道要拐一次弯，附加局部损失
          // 建模为：η_turn × 较小段的段阻力（η_turn = 0.25）
          var bMin = Math.min(prev.bBand, 1 / (Grib > 0 ? Grib : 1e30));
          turnB = 0.25 * bMin;
        }
        bAir += bBand + turnB;
        bTurn += turnB;
        GribSum += Grib; GcrevSum += Gcrev;
        AventSum += isRib ? sg.count * sg.width * sg.depth : sg.perim * CONFORM_GAP;
        volSum += isRib ? sg.count * sg.width * sg.depth * pathL : 0;
        freeWSum += freeW;
        LventSum += pathL;
        wallH += sg.dz;
        wallArea += sg.perim * sg.slant;
        if (isRib) ribArea += sg.count * sg.width * sg.slant;
        if (isRib && sg.depth > standoffMax) standoffMax = sg.depth;
        segStats.push({
          shape: sg.shape, z0: sg.z0, z1: sg.z1, frac: sg.frac,
          count: sg.count, width: sg.width, depth: sg.depth, turns: sg.turns,
          isRib: isRib, pathL: pathL, Grib: Grib, Gcrev: Gcrev,
          rMid: sg.rMid, dz: sg.dz, slant: sg.slant,
          bBand: bBand, bTurn: turnB, freeW: freeW, perim: sg.perim,
          A_vent: isRib ? sg.count * sg.width * sg.depth : sg.perim * CONFORM_GAP,
          standoff: isRib ? sg.depth : CONFORM_GAP
        });
        prev = { isRib: isRib, shape: sg.shape, Grib: Grib, bBand: bBand };
      }
      // 聚合量（保持与旧版字段同名，供诊断面板与绘图复用）
      R.G_rib = GribSum;
      R.G_crev = GcrevSum;
      R.b_air = bAir;
      R.G_vent = bAir > 0 ? 1 / bAir : 0;
      R.bTurn = bTurn;
      R.segStats = segStats;
      R.bottleneck = -1;
      var bMax = 0;
      for (var ib = 0; ib < segStats.length; ib++) {
        if (segStats[ib].bBand > bMax) { bMax = segStats[ib].bBand; R.bottleneck = ib; }
      }
      // 贯通性：从杯底起，连续带肋的高度
      var cont = 0, ordered = segStats.slice().sort(function (a, b) { return a.z0 - b.z0; });
      for (var ic = 0; ic < ordered.length; ic++) {
        if (ordered[ic].isRib && Math.abs(ordered[ic].z0 - cont) < 1e-6) {
          cont = ordered[ic].z1;
        } else if (ordered[ic].isRib && ordered[ic].z0 <= cont + 1e-6) {
          cont = Math.max(cont, ordered[ic].z1);
        } else {
          break;
        }
      }
      R.contiguousH = cont;
      R.ribbedH = ribbedH;
      R.wallH = wallH;
      R.ventFrac = wallH > 0 ? ribbedH / wallH * 100 : 0;
      R.throughVent = wallH > 0 ? (cont >= wallH - 1e-6) : false;
      R.freeW = freeWSum;
      R.standoff = standoffMax > 0 ? standoffMax : CONFORM_GAP;
      R.A_vent = AventSum;
      R.L_vent = LventSum;
      R.vol = volSum;
      // 壁面覆盖率：肋条在壁面上的投影面积 / 壁面总面积（面积口径）
      R.wallCover = wallArea > 0 ? ribArea / wallArea * 100 : 0;
      R.segMode = (S.ribSegMode === 'seg');
      R.segCount = segs.length;
      R.helixL = LventSum;
      R.helixR = rMid;
    } else {
      /* ---------- 平底 / 直筒：径向铣槽 -> 导流 + 泄压 ---------- */
      var rIn = (S.holeLayout === 'single')
        ? Math.max(0.5, S.holeD / 2)
        : Math.max(0.5, S.ringR - S.holeD / 2);
      var rOut = P.r0;
      if (rOut <= rIn) rOut = rIn + 0.5;
      R.rIn = rIn; R.rOut = rOut; R.L_ch = rOut - rIn;
      R.freeW = perim;      // 平底无壁面肋，留空避免诊断误判
      if (R.style === 'radial' && R.applicable && R.count > 0 && R.width > 0 && R.depth > 0) {
        R.isGroove = true;
        // 槽内沿径向流动的液相电导
        R.G_groove = slotG(R.width / 1000, R.depth / 1000, R.L_ch / 1000, mu);
        R.b_bypass = R.G_groove > 0 ? 1 / R.G_groove : Infinity;
        // 铣槽对底面的覆盖率：槽面积 / 底面圆盘面积
        // 只有落在槽正上方的水才能直接进槽，其余仍须横穿细粉层
        var areaBed = Math.PI * rOut * rOut;
        var areaSlot = R.count * R.width * R.L_ch;
        R.capture = areaBed > 0 ? Math.min(0.95, areaSlot / areaBed) : 0;
        R.vol -= R.count * R.width * R.depth * R.L_ch;      // 铣槽 = 减料
        R.slotAreaMm2 = R.count * R.width * R.L_ch;
        R.A_vent = R.count * R.width * R.depth;
        R.L_vent = R.L_ch;
        R.standoff = R.depth;
      } else {
        R.capture = 0;
        R.A_vent = 2 * Math.PI * rMid * CONFORM_GAP;
        R.L_vent = rMid;
      }
      // 底面贴合缝隙（滤纸贴底时几乎密闭）
      R.G_crev = slotG(2 * Math.PI * rMid / 1000, hc, rMid / 1000, MU_AIR);
      R.G_rib = R.isGroove
        ? R.count * slotG(R.width / 1000, R.depth / 1000, R.L_ch / 1000, MU_AIR)
        : 0;
      R.G_vent = R.G_rib + R.G_crev;
      // 平底 / 直筒杯没有"袋腔"：滤纸贴在平底上，水从纸下方的缝隙横向汇入底孔，
      // 这个窄缝效应已由底部横向汇流阻力 bLat 表达，铣槽正是用来降低它的。
      // 若在此再叠加一份袋腔负压，等于把同一效应算两遍，故 b_air = 0。
      R.b_air = 0;
    }
    return R;
  }

  /* ---------------- 几何总装 ---------------- */
  function buildGeometry(S) {
    var P = buildProfile(S);
    var props = waterProps(S.temp);
    var rhoB = bulkDensity(S.grind);
    var Vbed_mm3 = (S.dose / rhoB) * 1000;          // g -> cm3 -> mm3
    var Vbed_m3 = Vbed_mm3 * 1e-9;
    var zBed = zForVolume(P, Vbed_mm3);
    var rBedTop = radiusAt(P, zBed);
    var halfAng = Math.atan(P.tan);
    var Lpath = (P.tan > 0 ? zBed / Math.cos(halfAng) : zBed) / 1000;  // m 流路长度

    // 收敛段当量过流面积 A = V(段)/L(段)（圆柱段退化为 πr²）
    var Aeff = Vbed_m3 / Lpath;
    var ABed = Math.PI * rBedTop * rBedTop / 1e6;   // m^2 粉床顶面积（展示用）
    // 滤纸浸润面积：侧壁 + 底面（m^2）
    var slant = Lpath * (P.tan > 0 ? 1 / Math.cos(halfAng) : 1);
    var Apaper = Math.PI * ((rBedTop + P.r0) / 1000) * slant + Math.PI * P.r0 * P.r0 * 1e-6;

    var holeArea1 = Math.PI * Math.pow(S.holeD / 2, 2) / 1e6;
    var AHole = holeArea1 * S.holeCount;
    var kEff = permeability(S.grind);

    var bBed = props.mu * Lpath / (kEff * Aeff);
    var bPaper = props.mu * PAPER_THICK / (K_PAPER * Apaper);
    // 底部横向汇流阻力（线性 Darcy 项）：
    // 平底 / 截锥多孔设计里，粉床坐落在一张大平面上，水从整个底面渗出后，
    // 还必须沿底面下方那层压实细粉层横向汇聚到孔口才能流出。
    // 每个孔负责一个环形扇区，扇区之间并联，故总阻力与孔数无关：
    //   b_lat = mu * L_lat / (k_lat * 2*pi*r_mid * t_lat)
    // 单孔锥形（V60 类）底部天然收束成锥尖，不存在横向段，无需该项。
    var bLat = 0, Llat = 0, rMid = 0;
    var latOuter = 0, latInner = 0;
    if (S.shape === 'flat' || S.shape === 'cyl') {
      // 平底/直筒：整个底面都是一个扩散的圆盘
      latOuter = P.r0;
      latInner = (S.holeCount > 1) ? S.ringR : 0;
    } else if (S.holeCount > 1) {
      // 截锥多孔：底部被孔环截断，锥尖收束后仍需横向一小段
      latOuter = P.r0;
      latInner = S.ringR;
    }
    if (latOuter > latInner && latOuter > 0) {
      Llat = (latOuter - latInner) / 1000;              // m 横向路径长度
      rMid = (latOuter + latInner) / 2;                // mm 平均路径半径
      var tLat = Math.min(0.005, Math.max(0.0015, 0.3 * zBed / 1000));  // m 压实细粉层厚度
      var ALat = 2 * Math.PI * (rMid / 1000) * tLat;  // m^2 横向流动截面
      var kLat = kEff;                              // 横向流动的有效渗透率
      bLat = props.mu * Llat / (kLat * ALat);
    }

    /* ---- 壁部导水槽 ---- */
    var ribs = buildRibs(S, P, props, kEff);
    var eta = 0.85;                     // 槽口耦合效率：进水受粉床供给与入口效应限制
    var bLatEff = bLat;
    if (ribs.isGroove && ribs.G_groove > 0 && bLat > 0) {
      // 铣槽只覆盖底面的一部分：覆盖率 f 之外的水仍走压实细粉层，
      // 覆盖到的水走槽内低阻通道，两条通路按电导并联。
      var f = ribs.capture;
      var Geff = (1 - f) / bLat + f * eta * ribs.G_groove;
      bLatEff = Geff > 0 ? 1 / Geff : bLat;
      ribs.bypassGain = (bLat - bLatEff) / bLat * 100;
    }
    // 排气等效阻力（螺旋凸肋把粉床下方空腔连到大气）
    var b = bBed + bPaper + bLatEff + ribs.b_air;
    var a = AHole > 1e-12 ? props.rho / (2 * Math.pow(CD * AHole, 2)) : 0;

    /* ---- 导水槽带来的实际收益 ----
     * 反事实对照：把同一个设计的导水槽整个去掉，重算一遍几何与阻力，
     * 在同一水头下比较瞬时流量，得到"这条壁部导水槽到底值多少"。
     *   ventGain / grooveGain  = 流速提升百分比
     *   gainQwith / gainQwithout = 两条情形下的典型工作点流速 g/s
     */
    var Hwork = Math.max(0.005, zBed / 1000);     // m 典型工作水头
    var Qwith = solveFlow(props.rho, a, b, Hwork);
    ribs.Qwork = Qwith * 1e6;                     // g/s 典型工作点流速
    ribs.gainQwith = ribs.Qwork;
    ribs.gainQwithout = ribs.Qwork;
    ribs.ventGain = 0;
    ribs.grooveGain = 0;
    if (!SKIP_CF && ribs.style !== 'none') {
      var S2 = {};
      for (var kk in S) if (S.hasOwnProperty(kk)) S2[kk] = S[kk];
      S2.ribStyle = 'none';
      S2.ribSegMode = 'single';
      S2.ribSegs = null;
      SKIP_CF = true;
      var cf = buildGeometry(S2);
      SKIP_CF = false;
      var Qnone = solveFlow(cf.props.rho, cf.a, cf.b, Hwork) * 1e6;
      ribs.gainQwithout = Qnone;
      var g = Qnone > 0 ? (Qwith * 1e6 / Qnone - 1) * 100 : 0;
      ribs.ventGain = g;
      ribs.grooveGain = g;
    }

    var latArea = 0, steps = 80, dz = P.H / steps, i;
    for (i = 0; i < steps; i++) {
      var zm = (i + 0.5) * dz;
      var r = radiusAt(P, zm);
      latArea += 2 * Math.PI * r * Math.sqrt(1 + P.tan * P.tan) * dz;
    }
    var bottomArea = Math.PI * P.r0 * P.r0;
    var mat = MATERIALS[S.material] || MATERIALS.pp;
    var weightBase = (latArea + bottomArea) * S.wall / 1000 * mat.rho;
    var weightG = weightBase;
    // 导水槽的材料体积变化：凸肋增重、铣槽减重
    weightG += ribs.vol / 1000 * mat.rho;
    var Vtotal_cm3 = volumeBelow(P, P.H) / 1000;

    // 水量三分区：颗粒吸附水（永久） + 孔隙水（可动） + 杯中自由水
    // 吸附水按粉量计（咖啡颗粒吸水约 0.6-0.8 g/g），孔隙水按粉床体积与孔隙率计
    var adsorbCap = S.dose * S.retention * 0.65;       // g 颗粒吸附水上限（不可流出）
    var poreCap = POROSITY * (Vbed_mm3 / 1000);        // g 孔隙水容量（满饱和）
    var poreFinal = 0.55 * poreCap;                    // g 毛细残留，滴滤结束仍留在粉床

    var issues = P.issues.slice();
    // 孔口相对粉床底面积过大：底座几乎不限制流速，粉床形不成稳定水头
    var bedBottomArea_mm2 = Math.PI * P.r0 * P.r0;
    if (S.shape === 'flat') {
      // 平底：孔开在底平面上，总孔面积不应接近底面面积
      if (AHole * 1e6 > bedBottomArea_mm2 * 0.18) {
        issues.push('底孔总面积 ' + fmtMm(AHole * 1e6) + ' mm² 已达底面的 ' +
          Math.round(AHole * 1e6 / bedBottomArea_mm2 * 100) + '%，底座几乎不构成流速限制，水会「一泻千里」——建议减小孔径或增加孔数');
      }
    } else if (S.holeCount > 1) {
      // 锥形多孔：孔口总面积超过锥尖底面，说明锥尖已被完全掏空，收束作用失效
      var tipArea = Math.PI * P.r0 * P.r0;
      var holeRatio = (AHole * 1e6) / tipArea;
      if (holeRatio > 1.0) {
        issues.push('底孔总面积已达锥尖底面的 ' + Math.round(holeRatio * 100) +
          '%，锥尖已被掏空，锥形收束作用失效，流速会更难控制——建议减小孔径或缩小环半径');
      }
    }
    if (zBed < 8) {
      issues.push('粉床仅 ' + fmtMm(zBed) + ' mm 过薄，水会直接从底面大量涌出而无法形成稳定水头——增加粉量或选用更小的底面');
    }

    /* ---- 导水槽诊断 ---- */
    if (ribs.style !== 'none' && !ribs.applicable) {
      issues.push(ribs.mismatch);
    }
    ribs.ventShare = b > 0 ? ribs.b_air / b * 100 : 0;
    // 袋腔负压对驱动水头的抵消比：dp_vent = b_air * Q，与水头 rho*g*H 比较
    // 取典型工作点 Q = 2 g/s、H = 粉床顶面高度，估算负压占比
    var Qref = 2e-6, Href = Math.max(0.01, zBed / 1000);
    ribs.pVent = ribs.b_air * Qref;                                  // Pa
    ribs.pVentRatio = ribs.pVent / (props.rho * G * Href) * 100;      // %
    if (ribs.style === 'spiral' && ribs.applicable) {
      if (!ribs.segMode) {
        if (ribs.freeW <= 0.5) {
          issues.push(ribs.count + ' 条肋已占满整个周长（' + fmtMm(ribs.perim) + ' mm），肋间没有通气缝隙，负压无法泄放——减少肋数或减小肋宽');
        } else if (ribs.count * ribs.width > ribs.perim * 0.5) {
          issues.push('肋条占据了壁面周长的 ' + Math.round(ribs.count * ribs.width / ribs.perim * 100) +
            '%，有效通气缝隙仅剩 ' + fmtMm(ribs.freeW) + ' mm，滤纸容易被吸住');
        }
      }
      if (ribs.pVentRatio > 12) {
        issues.push('袋腔负压约 ' + fmtMm(ribs.pVent) + ' Pa，抵消了 ' +
          fmtMm(ribs.pVentRatio) + '% 的驱动水头，流速上不去、滴滤段易断流——加大肋高或增加肋数');
      }
      if (ribs.ventGain > 0 && ribs.ventGain < 8) {
        issues.push('这组螺旋肋只让流速快了 ' + fmtMm(ribs.ventGain) +
          '%，收益有限——增加肋高或肋数效果更明显');
      }
      if (ribs.segMode) {
        // 段内肋条占满周长
        for (var isg = 0; isg < ribs.segStats.length; isg++) {
          var ss = ribs.segStats[isg];
          if (ss.isRib && ss.freeW <= 0.5) {
            issues.push('第 ' + (isg + 1) + ' 段（' + fmtMm(ss.z0) + '–' + fmtMm(ss.z1) +
              ' mm）肋条已占满该段周长，肋间没有通气缝隙，负压无法泄放——减少条数或减小肋宽');
            break;
          }
        }
        // 贯通性：光壁段截断排气通路
        if (!ribs.throughVent) {
          var cut = null;
          for (var ic2 = 0; ic2 < ribs.segStats.length; ic2++) {
            var s2 = ribs.segStats[ic2];
            if (!s2.isRib && s2.z0 >= ribs.contiguousH - 1e-6 && cut === null) cut = s2;
          }
          issues.push('排气通路未贯通：自杯底起连续带肋高度仅 ' + fmtMm(ribs.contiguousH) +
            ' mm（占壁高 ' + fmtMm(ribs.ventFrac) + '%）' +
            (cut ? '，在 ' + fmtMm(cut.z0) + ' mm 处被光壁段截断' : '') +
            '。负压无法从粉床下方泄放到杯口，袋腔负压抵消 ' + fmtMm(ribs.pVentRatio) +
            '% 的驱动水头——请把光壁段改成带肋段');
        }
        if (ribs.bottleneck >= 0 && ribs.segStats.length > 1) {
          var bn = ribs.segStats[ribs.bottleneck];
          issues.push('第 ' + (ribs.bottleneck + 1) + ' 段是排气阻力瓶颈（占泄压总阻力 ' +
            fmtMm(ribs.segStats.length > 1 && ribs.b_air > 0 ? bn.bBand / ribs.b_air * 100 : 0) +
            '%），可加大该段肋高或改为纵向直肋缩短泄压路径');
        }
      }
    } else if (ribs.style === 'radial' && ribs.applicable) {
      if (ribs.L_ch < 1) {
        issues.push('径向槽长度不足 1 mm，导流槽形不成有效通道——底面半径需明显大于孔口半径');
      }
      if (ribs.L_ch > 2 && ribs.bypassGain < 6) {
        issues.push('铣槽导流贡献有限（仅降低横向汇流阻力 ' + fmtMm(ribs.bypassGain) +
          '%）——加宽槽宽或增加槽数，或改用更细的研磨度');
      }
      if (ribs.grooveGain > 0 && ribs.grooveGain < 8) {
        issues.push('这组铣槽只让流速快了 ' + fmtMm(ribs.grooveGain) +
          '%，收益有限——加宽槽宽或增加槽数效果更明显');
      }
    } else if (ribs.style === 'none' && S.shape === 'cone' && S.holeCount === 1) {
      issues.push('单孔锥形且未设导水槽：滤纸贴壁形成密闭袋腔，负压抵消约 ' +
        fmtMm(ribs.pVentRatio) + '% 的驱动水头，容易「咕噜」断流——建议加装螺旋排气肋');
    }
    if (S.holeCount > 1) {
      if (S.ringR + S.holeD / 2 > P.r0 + 0.01) {
        issues.push('滤孔超出底区半径：环半径上限 ' + Math.max(0, P.r0 - S.holeD / 2).toFixed(1) + ' mm');
      }
    } else if (S.holeD / 2 > P.r0 + 0.01) {
      issues.push('底孔直径超出底区半径，底座会被穿透');
    }

    return {
      P: P, props: props, rhoB: rhoB,
      zBed: zBed, rBedTop: rBedTop, ABed: ABed, Aeff: Aeff, Apaper: Apaper,
      Lpath: Lpath, halfAng: halfAng,
      AHole: AHole, holeArea1: holeArea1, kEff: kEff,
      bBed: bBed, bPaper: bPaper, bLat: bLat, bLatEff: bLatEff, b_air: ribs.b_air, b: b, a: a,
      bVent: ribs.b_air, bGroove: ribs.b_bypass,
      ribs: ribs,
      diag: (function () {
        var Q = 3e-6;
        var rho = props.rho;
        var dBed = bBed * Q, dPaper = bPaper * Q, dLat = bLatEff * Q, dAir = ribs.b_air * Q;
        var dOrifice = rho * Q * Q / (2 * Math.pow(CD * AHole, 2));
        var dTotal = dBed + dPaper + dLat + dAir + dOrifice;
        return {
          dBed: dBed, dPaper: dPaper, dLat: dLat, dAir: dAir, dOrifice: dOrifice, dTotal: dTotal,
          pBed: dBed / dTotal * 100, pPaper: dPaper / dTotal * 100,
          pLat: dLat / dTotal * 100, pAir: dAir / dTotal * 100,
          pOrifice: dOrifice / dTotal * 100
        };
      })(),
      Vbed_cm3: Vbed_mm3 / 1000, Vtotal_cm3: Vtotal_cm3, Vbed_mm3: Vbed_mm3,
      adsorbCap: adsorbCap, poreCap: poreCap, poreFinal: poreFinal,
      Atop: Math.PI * rBedTop * rBedTop,
      latArea_mm2: latArea, weightG: weightG, weightBase: weightBase, matName: mat.name,
      height: P.H, issues: issues
    };
  }

  /* ---------------- 瞬时流量 ---------------- */
  // a Q^2 + b Q = rho g H，稳定解 Q = 2c/(b+sqrt(b^2+4ac))
  function solveFlow(rho, a, b, H) {
    var c = rho * G * H;
    if (c <= 0 || H <= 0) return 0;
    if (a <= 0) return b > 0 ? c / b : 0;
    var disc = b * b + 4 * a * c;
    if (disc <= 0) return 0;
    return (2 * c) / (b + Math.sqrt(disc));
  }

  /* ---------------- 时间步进模拟 ----------------
   * 水量三分区（单位 g，1 g 水 ≈ 1 cm³）：
   *   adsorb  颗粒吸附水（永久留液，永不流出）
   *   pore    粉床孔隙中的可动水
   *   pond    粉床之上的自由存水
   *
   * 阶段：
   *   fill       润湿锋面自粉床顶面向下推进；锋面未到底前无贯通水路（闷蒸几乎不外流）
   *   percolate  粉床贯通，自由水在粉床上方堆积；水头 = 液面到孔口的高差
   *   drain      注水结束，湿润区自上而下回落，水头随之下降，滴滤自然收尾
   */
  function simulate(S) {
    var geo = buildGeometry(S);
    var P = geo.P;
    var totalWater = S.dose * S.ratio;
    var bloomWater = Math.min(totalWater, S.dose * S.bloomMult);
    var restWater = totalWater - bloomWater;
    var dt = 0.5;

    var t = 0, poured = 0, drained = 0;
    var adsorb = 0;                  // g 颗粒吸附水
    var pore = 0;                    // g 粉床孔隙可动水
    var pond = 0;                    // g 杯中自由水
    var phase = 'fill';
    var tFirstDrip = null, tLastDrip = null;
    var peak = 0, peakAt = 0;
    var maxPond = 0, maxPondAt = 0, maxSurfaceZ = geo.zBed;
    var bloomOut = 0;

    // 注水计划：脉冲式注水（真实手冲是"浇一圈"，水在短时间内集中倒入）
    var pourWindows = [];
    var pourStart = S.bloomTime, pourDur = Math.max(5, S.pourTime);
    var chunk = restWater / Math.max(1, S.pourCount);
    var win = pourDur / Math.max(1, S.pourCount);
    // 每段注水分成若干次小脉冲（真实手冲是绕圈分次浇注），脉冲之间留出渗流时间
    var PULSES = 4;                              // 每段的脉冲次数
    var BURST = 0.35;                            // 单次脉冲占该段时长的比例
    for (var i = 0; i < S.pourCount; i++) {
      var st = pourStart + i * win;
      var slot = win / PULSES;
      var perPulse = chunk / PULSES;
      for (var j2 = 0; j2 < PULSES; j2++) {
        var b0 = st + j2 * slot;
        pourWindows.push({
          t0: b0, t1: b0 + slot * BURST,
          rate: perPulse / (slot * BURST)
        });
      }
    }
    var tLastPour = S.pourCount > 0 ? pourStart + pourDur : S.bloomTime;

    var series = [], MAXT = 3600, guard = 0;

    while (t < MAXT && guard < 20000) {
      guard++;
      var inflow = 0;
      if (t < 2) inflow += (bloomWater / 2) * dt;           // 闷蒸：2s 内一次倒完
      for (var j = 0; j < pourWindows.length; j++) {
        var w = pourWindows[j];
        if (t >= w.t0 && t < w.t1) inflow += w.rate * dt;
      }
      poured += inflow;

      // --- 分配进水：颗粒吸附与孔隙填充并行，剩余成为自由水 ---
      var free = Math.max(0, poured - drained - adsorb - pore);
      var wantA = (geo.adsorbCap - adsorb) * (1 - Math.exp(-dt / TAU_ABS));
      var takeA = Math.min(wantA, free * 0.5);
      if (takeA < 0) takeA = 0;
      adsorb += takeA;
      var free2 = Math.max(0, free - takeA);
      var wantP = (geo.poreCap - pore) * (1 - Math.exp(-dt / TAU_FRONT));
      var takeP = Math.min(wantP, free2);
      if (takeP < 0) takeP = 0;
      pore += takeP;
      pond = Math.max(0, poured - drained - adsorb - pore);

      // --- 出流 ---
      var q = 0, zSurface = geo.zBed;

      if (phase === 'fill') {
        /* 润湿锋面未到底：无贯通水路，仅极缓慢渗出 */
        zSurface = geo.zBed;
        if (pore >= geo.poreCap * 0.88) phase = 'percolate';
      } else if (phase === 'percolate') {
        /* 饱和渗流：液面高度 = 粉床顶面 + 上方堆积的自由水 */
        var zTop = zForVolume(P, geo.Vbed_mm3 + pond * 1000);
        zSurface = zTop;
        var H = zTop / 1000;
        q = solveFlow(geo.props.rho, geo.a, geo.b, H);
        var maxQ = pond / dt;
        if (q > maxQ) q = maxQ;
        // 只有当自由水基本排空时才转入滴滤段
        if (pond < 0.05 && inflow <= 0) phase = 'drain';
      } else {
        /* 滴滤尾段
         * 注水结束后，粉床孔隙中的可动水在重力下继续渗出。
         * 真实粉床靠毛细作用把大部分孔隙水"挂"住，只有被挤压出去的部分才会流出；
         * 这里用「可动水比例」刻画：随孔隙水减少，能被驱动的比例迅速下降，
         * 尾段自然收尾，不会无限拖长。
         */
        var mobile = Math.max(0, pore - geo.poreFinal) + pond;
        var frac = geo.poreCap > 0 ? clamp(mobile / geo.poreCap, 0, 1) : 0;
        // 湿润区高度：孔隙中仍可动的水所占据的高度
        var zWet = zForVolume(P, mobile * 1000 / POROSITY);
        var Vwet = volumeBelow(P, zWet) * 1e-9;              // m^3 湿润段体积
        var Lw = Math.max((P.tan > 0 ? zWet / Math.cos(halfAngOf(P)) : zWet) / 1000, 1e-6);
        var Aw = Math.max(Vwet / Lw, 1e-9);
        var Apw = Math.max(geo.Apaper * (zWet / geo.zBed), 1e-9);
        // 滴滤尾段袋腔仍然密闭，负压依旧在抵消水头。
        // 尾段水量小、气多，负压已部分平衡，按 45% 计入。
        var bD = geo.props.mu * Lw / (geo.kEff * Aw) + geo.props.mu * PAPER_THICK / (K_PAPER * Apw)
               + geo.b_air * 0.45;
        // 毛细悬挂：可动比例越低，驱动力被毛细力抵消得越多
        var Hd = (zWet / 1000) * Math.pow(frac, 6);
        zSurface = zWet;
        q = solveFlow(geo.props.rho, geo.a, bD, Hd);
        var maxQ2 = mobile / dt;
        if (q > maxQ2) q = maxQ2;
      }

      var qG = q / 1e-6;                                     // m3/s -> g/s
      if (phase !== 'fill') {
        var outG = qG * dt;
        var fromPond = Math.min(outG, pond);
        pond -= fromPond;
        outG -= fromPond;
        if (phase === 'drain' && outG > 0) {
          // 滴滤段：杯中残水先于孔隙水被抽出
          var fromPond2 = Math.min(outG, pond);
          pond -= fromPond2;
          outG -= fromPond2;
        }
        if (outG > 0) {
          var mobileNow = Math.max(0, pore - geo.poreFinal);
          var fromBed = Math.min(outG, mobileNow);
          pore -= fromBed;
          outG -= fromBed;
        }
        drained += qG * dt;
        if (t < S.bloomTime) bloomOut += qG * dt;
      }

      if (zSurface > maxSurfaceZ) maxSurfaceZ = zSurface;
      if (pond > maxPond) { maxPond = pond; maxPondAt = t; }

      if (qG > 0.02) {
        if (tFirstDrip === null) tFirstDrip = t;
        tLastDrip = t;
      }
      if (qG > peak) { peak = qG; peakAt = t; }

      if (Math.abs(t % 2) < dt) {
        series.push({ t: t, q: qG, drained: drained, poured: poured, pool: pond });
      }

      t += dt;
      if (phase === 'drain' && Math.max(0, pore - geo.poreFinal) < 0.05) break;
      if (t > tLastPour + 600) break;
    }

    var totalTime = tLastDrip === null ? 0 : tLastDrip;
    var drawdown = Math.max(0, totalTime - tLastPour);
    var retention = Math.max(0, poured - drained);
    var liquid = Math.max(0, drained);
    var avgFlow = totalTime > 0 ? drained / totalTime : 0;

    /* ---------------- 萃取评估 ---------------- */
    var contact = totalTime;
    var tEff = contact * (1 + (50 - S.grind) * 0.010);
    var ey = 22.0 * (1 - Math.exp(-Math.max(tEff, 0) / 70));
    var fTemp = 1 + (S.temp - 93) * 0.0075;
    ey = clamp(ey * fTemp, 10, 26);
    var tds = liquid > 0 ? (S.dose * ey / 100) / liquid * 100 : 0;

    var verdict, tone, advice;
    if (peak > 5.0) { verdict = '流速过冲'; tone = 'bad'; advice = '出液峰值过高，粉饼被冲刷出通道，容易过萃且风味扁平。收窄底孔或调细研磨。'; }
    else if (ey < 16.0) { verdict = '萃取不足'; tone = 'bad'; advice = '可溶物没溶出来，表现为尖酸、寡淡。把研磨调粗 2–4 档，或延长闷蒸与总萃取时间。'; }
    else if (tds < 1.12) { verdict = '浓度偏淡'; tone = 'warn'; advice = '杯中浓度不足，甜感撑不起来。提高粉水比，或延长总时长让萃取率上到 20% 以上。'; }
    else if (tds > 1.62) { verdict = '偏浓过萃'; tone = 'bad'; advice = '杯中浓度过高、后段易发苦。调粗研磨、缩短闷蒸，或把粉水比降下来。'; }
    else if (contact < 100) { verdict = '时间偏短'; tone = 'warn'; advice = '整体萃取时间不足，细分与糖分来不及溶出。'; }
    else { verdict = '风味均衡'; tone = 'good'; advice = '流速、接触时间与浓度都落在甜感—酸质的平衡区间，可以直接照此参数出杯。'; }

    return {
      geo: geo, series: series,
      tBloomEnd: S.bloomTime, tPourEnd: tLastPour,
      maxSurfaceZ: maxSurfaceZ, maxWaterZ: maxSurfaceZ,
      maxPond: maxPond, maxPondAt: maxPondAt,
      totalWater: totalWater, poured: poured, drained: drained,
      adsorb: adsorb, pore: pore,
      retention: retention, liquid: liquid, bloomOut: bloomOut,
      tFirstDrip: tFirstDrip, tLastDrip: tLastDrip, totalTime: totalTime,
      drawdown: drawdown, tLastPour: tLastPour,
      peak: peak, peakAt: peakAt, avgFlow: avgFlow,
      contact: contact, ey: ey, tds: tds,
      verdict: verdict, tone: tone, advice: advice,
      exitVelocity: geo.AHole > 0 ? (peak * 1e-6) / geo.AHole : 0,
      flux: geo.ABed > 0 ? (peak * 1e-6) / geo.ABed : 0,
      brewRatioOut: S.dose > 0 ? liquid / S.dose : 0
    };
  }

  function halfAngOf(P) { return Math.atan(P.tan); }

  /* ---------------- 反解工具 ---------------- */
  // 给定目标流量与驱动水头，求所需总孔口面积
  function solveHoleArea(S, targetQ, headM) {
    var geo = buildGeometry(S);
    var rho = geo.props.rho;
    var Q = targetQ / 1e-6;
    if (Q <= 0 || headM <= 0) return null;
    var need = rho * G * headM - geo.b * Q;
    if (need <= 0) return { bedLimited: true, geo: geo };
    var a = need / (Q * Q);
    var area = Math.sqrt(rho / (2 * a)) / CD;
    return { bedLimited: false, area_m2: area, area_mm2: area * 1e6, geo: geo };
  }

  // 给定目标流量与驱动水头，反解渗透率 -> 研磨度
  function solveGrind(S, targetQ, headM) {
    var geo = buildGeometry(S);
    var rho = geo.props.rho, mu = geo.props.mu;
    var Q = targetQ / 1e-6;
    if (Q <= 0 || headM <= 0) return null;
    var rest = rho * G * headM - geo.a * Q * Q;
    if (rest <= 0) return { impossible: true, geo: geo };
    var bNeeded = rest / Q;
    var k = mu * geo.Lpath / (geo.Aeff * bNeeded);
    return { k: k, grind: grindFromPermeability(k), geo: geo };
  }

  /* ---------------- 预设 ---------------- */
  var PRESETS = [
    {
      id: 'v60', name: '经典锥形 60°', tag: 'V60 风格',
      S: { shape: 'cone', Dtop: 120, r0: 7.5, coneAngle: 60, flatDepth: 9, wallTilt: 12, cylH: 75,
           holeLayout: 'single', holeCount: 1, holeD: 15, ringR: 0, wall: 2.4, material: 'pp',
           ribStyle: 'spiral', ribCount: 12, ribWidth: 2.2, ribDepth: 1.1, ribTurns: 1.5,
           ribSegMode: 'single', ribSegs: null,
           dose: 15, grind: 50, ratio: 16.5, bloomMult: 3, bloomTime: 45, pourCount: 2, pourTime: 70,
           temp: 93, retention: 2.0 }
    },
    {
      id: 'flat3', name: '平底三孔', tag: '平底滤杯风格',
      S: { shape: 'flat', Dtop: 100, r0: 27, coneAngle: 60, flatDepth: 6, wallTilt: 20, cylH: 75,
           holeLayout: 'ring', holeCount: 3, holeD: 5, ringR: 13, wall: 3.0, material: 'ceramic',
           ribStyle: 'radial', ribCount: 3, ribWidth: 3.0, ribDepth: 1.6, ribTurns: 1,
           ribSegMode: 'single', ribSegs: null,
           dose: 20, grind: 52, ratio: 16, bloomMult: 3, bloomTime: 45, pourCount: 2, pourTime: 75,
           temp: 93, retention: 2.1 }
    },
    {
      id: 'bigflat', name: '大孔平底', tag: '分享壶风格',
      S: { shape: 'flat', Dtop: 116, r0: 34, coneAngle: 60, flatDepth: 6, wallTilt: 16, cylH: 75,
           holeLayout: 'ring', holeCount: 4, holeD: 5, ringR: 13, wall: 3.2, material: 'glass',
           ribStyle: 'radial', ribCount: 3, ribWidth: 2.5, ribDepth: 1.8, ribTurns: 1,
           ribSegMode: 'single', ribSegs: null,
           dose: 25, grind: 58, ratio: 16.5, bloomMult: 2.5, bloomTime: 40, pourCount: 2, pourTime: 75,
           temp: 93, retention: 2.0 }
    },
    {
      id: 'narrow', name: '细锥 45°', tag: '小杯手冲',
      S: { shape: 'cone', Dtop: 92, r0: 6, coneAngle: 45, flatDepth: 9, wallTilt: 12, cylH: 75,
           holeLayout: 'single', holeCount: 1, holeD: 10, ringR: 0, wall: 1.6, material: 'steel',
           ribStyle: 'spiral', ribCount: 10, ribWidth: 2.0, ribDepth: 1.0, ribTurns: 1.5,
           ribSegMode: 'single', ribSegs: null,
           dose: 12, grind: 48, ratio: 15, bloomMult: 3, bloomTime: 40, pourCount: 2, pourTime: 60,
           temp: 92, retention: 2.0 }
    },
    {
      id: 'wide', name: '宽口 70°', tag: '大分享壶',
      S: { shape: 'cone', Dtop: 145, r0: 22, coneAngle: 70, flatDepth: 9, wallTilt: 12, cylH: 75,
           holeLayout: 'ring', holeCount: 3, holeD: 8, ringR: 14, wall: 3.0, material: 'pp',
           ribStyle: 'spiral', ribCount: 14, ribWidth: 2.4, ribDepth: 1.2, ribTurns: 1.5,
           dose: 30, grind: 56, ratio: 14, bloomMult: 2.5, bloomTime: 40, pourCount: 3, pourTime: 90,
           temp: 93, retention: 2.0 }
    },
    {
      id: 'cyl', name: '直筒滤杯', tag: '圆柱段',
      S: { shape: 'cyl', Dtop: 76, r0: 38, coneAngle: 60, flatDepth: 9, wallTilt: 12, cylH: 78,
           holeLayout: 'ring', holeCount: 6, holeD: 4, ringR: 20, wall: 3.0, material: 'pp',
           ribStyle: 'radial', ribCount: 6, ribWidth: 2.6, ribDepth: 1.5, ribTurns: 1,
           dose: 22, grind: 51, ratio: 16, bloomMult: 3, bloomTime: 45, pourCount: 2, pourTime: 72,
           temp: 93, retention: 2.0 }
    }
  ];

  function defaultState() {
    var s = JSON.parse(JSON.stringify(PRESETS[0].S));
    if (!s.ribSegMode) s.ribSegMode = 'single';
    if (!s.ribSegs) s.ribSegs = null;
    return s;
  }

  return {
    G: G, CD: CD, MATERIALS: MATERIALS, PRESETS: PRESETS, defaultState: defaultState,
    waterProps: waterProps, permeability: permeability, bulkDensity: bulkDensity,
    grindFromPermeability: grindFromPermeability, grindLabel: grindLabel,
    buildGeometry: buildGeometry, buildRibs: buildRibs, simulate: simulate,
    solveHoleArea: solveHoleArea, solveGrind: solveGrind,
    volumeBelow: volumeBelow, radiusAt: radiusAt, zForVolume: zForVolume, clamp: clamp
  };
})();
if (typeof module !== 'undefined' && module.exports) module.exports = MODEL;

