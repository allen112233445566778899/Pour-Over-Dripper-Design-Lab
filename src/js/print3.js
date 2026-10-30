/* ===========================================================
 * PRINT3 — 手冲滤杯「可打印实体」几何（v3：含壁部导水槽）
 * ------------------------------------------------------------
 * 坐标系：z 轴向上，底板底面 z = 0，杯口 z = H
 *
 * 实体构成
 *   ① 腔体母线 C：内壁 r(z)，取自 MODEL.buildGeometry 的轮廓
 *   ② 外壁母线 O：C 沿法向外扩 wall（斜段水平补偿 ⇒ 法向壁厚恒为 wall）
 *   ③ 底板：z ∈ [0, floorThk]，滤孔贯穿
 *   ④ 壁部导水槽（真实建出，不是贴图）：
 *      · spiral 螺旋凸肋 —— 沿壁面盘旋的凸起带，凸出于腔内壁 depth，
 *        宽 width，共 count 条，每条绕壁 turns 圈。
 *        做法：把肋当作「壁面上贴附的螺旋状凸条」，沿其中心线扫掠一个
 *        矩形截面（宽 × 高），生成肋的顶面、两侧面与端面。
 *      · radial  径向铣槽 —— 铣在底面上，从孔口径向外的方形凹槽，
 *        宽 width、深 depth、共 count 条。
 *
 * 拓扑：水密流形（每条边恰好被 2 个三角形共用）
 *   · 所有相邻面按坐标焊接共享顶点环
 *   · 三角形绕序由「目标法向」自动校正
 * =========================================================== */
var PRINT3 = (function () {
  'use strict';

  var TAU = Math.PI * 2;
  var SEG = 160;        // 回转分段
  var HOLE_SEG = 48;    // 滤孔圆周分段
  var RIB_SEG = 24;     // 肋沿长度分段

  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function r2(v) { return Math.round(v * 100) / 100; }

  /* ===========================================================
   * 几何求解：把物理模型的轮廓 + 导水槽规格翻译成可打印几何
   * =========================================================== */
  function solve(S, geo) {
    var notes = [];
    var P = geo.P || MODEL.buildProfile(S);
    var shape = P.shape;
    var wall = Math.max(0.4, S.wall);
    var floorThk = clamp(S.floorThk != null ? S.floorThk : 3, 1.0, 12);
    var halfTop = S.Dtop / 2;
    var tan = P.tan, zFlat = P.zFlat;
    var H = P.H;

    /* ---- 滤孔布局 ---- */
    var holes = holeLayout(S);
    var i, h;

    /* ---- 导水槽规格（取自物理模型算出的 ribs） ---- */
    var rb = geo.ribs || { style: 'none' };
    var ribStyle = (rb.style || 'none');
    var ribCount = Math.max(0, Math.round(rb.count || 0));
    var ribWidth = Math.max(0, rb.width || 0);
    var ribDepth = Math.max(0, rb.depth || 0);
    var ribTurns = Math.max(0.25, rb.turns || 1);
    var ribApplicable = rb.applicable !== false;
    var ribSegments = null;   // 分段模式：[{shape,z0,z1,count,width,depth,turns}]（z 为打印坐标）
    if (rb.segMode && rb.segStats && rb.segStats.length) {
      ribSegments = [];
      for (i = 0; i < rb.segStats.length; i++) {
        var ss = rb.segStats[i];
        /* 【坐标系换算】物理模型的 z 以「腔底」为 0（radiusAt(P,0)=P.r0，z 域 [0,P.H]），
           而打印坐标以「底板底面」为 0（腔底在 z = floorThk）。
           分段高度若直接照搬物理 z，肋会整体下沉一个底板厚度：
           下端扎进底板实体、上端又缺一段。这里统一换算成打印坐标。 */
        ribSegments.push({
          shape: ss.shape,
          z0: ss.z0 + floorThk,
          z1: ss.z1 + floorThk,
          count: Math.max(0, Math.round(ss.count || 0)),
          width: Math.max(0, ss.width || 0),
          depth: Math.max(0, ss.depth || 0),
          turns: Math.max(0.25, ss.turns || 1)
        });
      }
    }

    /* ---- 腔底半径：必须容得下所有滤孔 ---- */
    var holeExtent = 0;
    for (i = 0; i < holes.length; i++) {
      h = holes[i];
      holeExtent = Math.max(holeExtent, Math.sqrt(h.x * h.x + h.y * h.y) + h.r);
    }
    var rCavFloor = P.r0;
    var maxR = halfTop - 3;
    if (rCavFloor < holeExtent + 0.6) {
      rCavFloor = holeExtent + 0.6;
      if (rCavFloor > maxR) rCavFloor = Math.max(0.6, maxR);
      notes.push('腔底半径加宽至 ' + r2(rCavFloor) + ' mm 以容纳滤孔');
    }

    /* ---- 滤孔适配（落在腔底内） ---- */
    var fit = [], removed = 0;
    var lim = rCavFloor - 0.5;
    for (i = 0; i < holes.length; i++) {
      h = holes[i];
      var d = Math.sqrt(h.x * h.x + h.y * h.y);
      if (h.r * 2 > lim) {
        removed++;
        continue;
      }
      if (d + h.r > lim) {
        var k = Math.max(0, (lim - h.r) / Math.max(1e-6, d));
        h = { x: h.x * k, y: h.y * k, r: h.r };
        notes.push('滤孔超出底板，已自动收进');
      }
      fit.push(h);
    }
    if (removed) notes.push(removed + ' 个滤孔超出底板范围已移除');

    /* ---- 腔体母线（打印坐标） ---- */
    var cav = [], z, r, N;
    if (shape === 'cone') {
      /* 锥形：底面半径 rCavFloor，锥面到 Dtop/2 */
      var slope = Math.tan(S.coneAngle / 2 * Math.PI / 180);
      var zFlatD = floorThk;
      var rise = Math.max(4, (halfTop - rCavFloor) / Math.max(1e-4, slope));
      cav.push({ r: rCavFloor, z: zFloorBase(floorThk) });
      N = 28;
      for (i = 1; i <= N; i++) {
        z = zFloorBase(floorThk) + rise * i / N;
        cav.push({ r: rCavFloor + slope * (z - zFloorBase(floorThk)), z: z });
      }
    } else if (shape === 'flat') {
      var rF = Math.max(2, S.r0);
      var slopeF = Math.tan(S.wallTilt * Math.PI / 180);
      if (slopeF < 0.02) slopeF = 0;
      var zFlatD2 = Math.max(1.5, S.flatDepth);
      var riseF = slopeF > 0 ? Math.max(zFlatD2 + 2, (halfTop - rF) / slopeF)
        : Math.max(10, halfTop - rF);
      cav.push({ r: rF, z: zFloorBase(floorThk) });
      cav.push({ r: rF, z: zFloorBase(floorThk) + zFlatD2 });
      N = 24;
      for (i = 1; i <= N; i++) {
        z = zFloorBase(floorThk) + zFlatD2 + (riseF - zFlatD2) * i / N;
        cav.push({ r: rF + slopeF * (z - zFloorBase(floorThk) - zFlatD2), z: z });
      }
    } else {
      var rC = Math.max(3, halfTop);
      var zCyl = Math.max(10, S.cylH);
      cav.push({ r: rC, z: zFloorBase(floorThk) });
      N = 12;
      for (i = 1; i <= N; i++) cav.push({ r: rC, z: zFloorBase(floorThk) + zCyl * i / N });
    }

    /* ---- 外壁母线：沿法向外扩 wall ---- */
    var outer = offsetProfile(cav, wall);

    /* ---- 底板 ---- */
    var rBottom = outer[0].r;
    var zFloor = zFloorBase(floorThk);

    /* ---- 导水槽是否真的建出 ---- */
    var buildRibs = false, buildGrooves = false;
    if (ribApplicable) {
      if (ribStyle === 'spiral' && ribSegments) {
        for (i = 0; i < ribSegments.length; i++) {
          var sg = ribSegments[i];
          if ((sg.shape === 'spiral' || sg.shape === 'straight') && sg.count > 0 && sg.width > 0 && sg.depth > 0) { buildRibs = true; break; }
        }
      } else if (ribStyle === 'spiral' && ribCount > 0 && ribWidth > 0 && ribDepth > 0) {
        buildRibs = true;
      } else if (ribStyle === 'radial' && ribCount > 0 && ribWidth > 0 && ribDepth > 0) {
        buildGrooves = true;
      }
    }

    return {
      shape: shape, notes: notes,
      cav: cav, outer: outer, holes: fit,
      floorThk: floorThk, wall: wall,
      zFloor: zFloor, rCavFloor: rCavFloor, rBottom: rBottom,
      H: cav[cav.length - 1].z,
      topInner: cav[cav.length - 1].r,
      topOuter: outer[outer.length - 1].r,
      ribStyle: ribStyle, ribCount: ribCount, ribWidth: ribWidth, ribDepth: ribDepth,
      ribTurns: ribTurns, ribSegments: ribSegments, ribApplicable: ribApplicable,
      buildRibs: buildRibs, buildGrooves: buildGrooves,
      rb: rb
    };
  }

  function zFloorBase(floorThk) { return floorThk; }

  function holeLayout(S) {
    var out = [], i, a, n = Math.max(1, S.holeCount | 0), r = Math.max(0.3, S.holeD / 2);
    if (S.holeLayout === 'single') { out.push({ x: 0, y: 0, r: r }); return out; }
    if (S.holeLayout === 'cluster') {
      out.push({ x: 0, y: 0, r: r });
      for (i = 1; i < n; i++) {
        a = (i - 1) / Math.max(1, n - 1) * TAU;
        out.push({ x: S.ringR * Math.cos(a), y: S.ringR * Math.sin(a), r: r });
      }
      return out;
    }
    for (i = 0; i < n; i++) {
      a = i / n * TAU;
      out.push({ x: S.ringR * Math.cos(a), y: S.ringR * Math.sin(a), r: r });
    }
    return out;
  }

  /* 母线沿法向外扩（斜段用 1/cos 水平补偿 ⇒ 法向壁厚恒为 wall） */
  function offsetProfile(prof, w) {
    var n = prof.length, i;
    if (n < 2) return prof.slice();
    var segH = [], segT = [];
    for (i = 0; i < n - 1; i++) {
      var dr = prof[i + 1].r - prof[i].r, dz = prof[i + 1].z - prof[i].z;
      var t = Math.abs(dz) < 1e-9 ? 0 : dr / dz;
      segT.push(t);
      segH.push(w * Math.sqrt(1 + t * t));
    }
    var out = [];
    for (i = 0; i < n; i++) {
      if (i === 0) out.push({ r: prof[0].r + segH[0], z: prof[0].z });
      else if (i === n - 1) out.push({ r: prof[n - 1].r + segH[n - 2], z: prof[n - 1].z });
      else {
        var p0 = prof[i - 1], p1 = prof[i];
        var t0 = segT[i - 1], t1 = segT[i];
        var a0 = p0.r + segH[i - 1], a1 = p1.r + segH[i];
        var det = t0 - t1;
        if (Math.abs(det) < 1e-7) {
          out.push({ r: p1.r + Math.max(segH[i - 1], segH[i]), z: p1.z });
        } else {
          var zz = (a1 - a0 + t0 * p0.z - t1 * p1.z) / det;
          var rr = a0 + t0 * (zz - p0.z);
          var base = p1.r + Math.max(segH[i - 1], segH[i]);
          if (Math.abs(rr - base) > w * 4) rr = base;
          out.push({ r: rr, z: zz });
        }
      }
    }
    for (i = 1; i < out.length; i++) {
      if (out[i].z < out[i - 1].z) out[i].z = out[i - 1].z;
      if (out[i].r < out[i - 1].r - 1e-6) out[i].r = out[i - 1].r;
    }
    return out;
  }

  /* ===========================================================
   * 网格构建
   * =========================================================== */
  function buildMesh(S, geo) {
    var G = solve(S, geo);
    var pos = [], fnor = [], idx = [];
    var vmap = {};

    function V(x, y, z) {
      var k = (Math.round(x * 1e4) / 1e4) + '_' + (Math.round(y * 1e4) / 1e4) + '_' + (Math.round(z * 1e4) / 1e4);
      if (vmap[k] !== undefined) return vmap[k];
      var id = pos.length / 3;
      pos.push(x, y, z);
      vmap[k] = id;
      return id;
    }
    /* 绕序由目标法向自动校正 */
    function T(a, b, c, nx, ny, nz) {
      var ax = pos[a * 3], ay = pos[a * 3 + 1], az = pos[a * 3 + 2];
      var bx = pos[b * 3], by = pos[b * 3 + 1], bz = pos[b * 3 + 2];
      var cx = pos[c * 3], cy = pos[c * 3 + 1], cz = pos[c * 3 + 2];
      var ux = bx - ax, uy = by - ay, uz = bz - az;
      var vx = cx - ax, vy = cy - ay, vz = cz - az;
      var gx = uy * vz - uz * vy, gy = uz * vx - ux * vz, gz = ux * vy - uy * vx;
      if (gx * nx + gy * ny + gz * nz < 0) { var t = b; b = c; c = t; }
      idx.push(a, b, c);
      fnor.push(nx, ny, nz);
    }

    var seg = SEG;

    /* ---------- 内壁 / 外壁回转 ---------- */
    function revolve(prof, flip) {
      var rings = [], i, j;
      var segN = [];
      for (i = 0; i < prof.length - 1; i++) {
        var dr = prof[i + 1].r - prof[i].r, dz = prof[i + 1].z - prof[i].z;
        var L = Math.sqrt(dr * dr + dz * dz) || 1;
        segN.push({ nr: dz / L, nz: -dr / L });
      }
      for (i = 0; i < prof.length; i++) {
        var p = prof[i];
        var na = segN[Math.max(0, i - 1)], nb2 = segN[Math.min(segN.length - 1, i)];
        var nr = na.nr + nb2.nr, nz = na.nz + nb2.nz;
        var nl = Math.sqrt(nr * nr + nz * nz) || 1;
        nr /= nl; nz /= nl;
        if (flip) { nr = -nr; nz = -nz; }
        var ring = [];
        for (j = 0; j < seg; j++) {
          var a = j / seg * TAU, ca = Math.cos(a), sa = Math.sin(a);
          ring.push(V(p.r * ca, p.r * sa, p.z));
        }
        rings.push(ring);
      }
      for (i = 0; i < rings.length - 1; i++) {
        for (j = 0; j < seg; j++) {
          var jn = (j + 1) % seg;
          var a0 = rings[i][j], b0 = rings[i][jn], c0 = rings[i + 1][jn], d0 = rings[i + 1][j];
          var a3 = j / seg * TAU, b3 = (j + 1) / seg * TAU;
          var fnr2 = flip ? -nr : nr, fnz2 = flip ? -nz : nz;
          var n0 = [fnr2 * Math.cos(a3), fnr2 * Math.sin(a3), fnz2];
          var n1 = [fnr2 * Math.cos(b3), fnr2 * Math.sin(b3), fnz2];
          if (flip) { T(a0, c0, b0, n0, n0, n1); T(a0, d0, c0, n0, n1, n1); }
          else { T(a0, b0, c0, n0, n1, n1); T(a0, c0, d0, n0, n1, n0); }
        }
      }
      return rings;
    }

    var outerRings = revolve(G.outer, false);
    var innerRings = revolve(G.cav, true);

    /* ---------- 杯口环面 ---------- */
    var ot = G.outer[G.outer.length - 1], it = G.cav[G.cav.length - 1];
    var rim = [], i2, j2;
    for (j2 = 0; j2 < seg; j2++) {
      var a4 = j2 / seg * TAU, ca4 = Math.cos(a4), sa4 = Math.sin(a4);
      rim.push({
        in: V(it.r * ca4, it.r * sa4, it.z),
        out: V(ot.r * ca4, ot.r * sa4, ot.z)
      });
    }
    for (j2 = 0; j2 < seg; j2++) {
      var jn2 = (j2 + 1) % seg;
      T(rim[j2].in, rim[j2].out, rim[jn2].out, 0, 0, 1);
      T(rim[j2].in, rim[jn2].out, rim[jn2].in, 0, 0, 1);
    }

    /* ---------- 底板上下表面（带孔圆盘） ---------- */
    function plate(radius, z, up, holes) {
      var data = [], hidx = [], i, j;
      for (i = 0; i < seg; i++) {
        var a = i / seg * TAU;
        data.push(radius * Math.cos(a), radius * Math.sin(a));
      }
      for (i = 0; i < holes.length; i++) {
        hidx.push(data.length / 2);
        for (j = 0; j < HOLE_SEG; j++) {
          var b = j / HOLE_SEG * TAU;
          data.push(holes[i].x + holes[i].r * Math.cos(b), holes[i].y + holes[i].r * Math.sin(b));
        }
      }
      var tris = earcut(data, hidx, 2);
      var nz = up ? 1 : -1;
      var ring = [], holeRings = [];
      for (i = 0; i < seg; i++) {
        var a2 = i / seg * TAU;
        ring.push(V(radius * Math.cos(a2), radius * Math.sin(a2), z));
      }
      for (i = 0; i < holes.length; i++) {
        var hr = [];
        for (j = 0; j < HOLE_SEG; j++) {
          var b2 = j / HOLE_SEG * TAU;
          hr.push(V(holes[i].x + holes[i].r * Math.cos(b2), holes[i].y + holes[i].r * Math.sin(b2), z));
        }
        holeRings.push(hr);
      }
      for (i = 0; i < tris.length; i += 3) {
        var vids = [];
        for (var q = 0; q < 3; q++) {
          var vi = tris[i + q], vid;
          if (vi < seg) vid = ring[vi];
          else {
            var hi = Math.floor((vi - seg) / HOLE_SEG), hj = (vi - seg) % HOLE_SEG;
            vid = holeRings[hi][hj];
          }
          vids.push(vid);
        }
        if (up) T(vids[0], vids[1], vids[2], 0, 0, 1);
        else T(vids[0], vids[2], vids[1], 0, 0, -1);
      }
      return { ring: ring, holeRings: holeRings };
    }

    /* 有铣槽时，底面 / 腔底 / 孔壁由 buildRadialGrooves 统一建造（避免重复建面） */
    var hasGroove = G.buildGrooves;
    var bottomPlate = null, topPlate = null;
    if (!hasGroove) {
      bottomPlate = plate(G.rBottom, 0, false, G.holes);
      topPlate = plate(G.rCavFloor, G.zFloor, true, G.holes);
    }

    /* ---------- 底板外侧壁 ---------- */
    var sb = [], st = [];
    for (var j3 = 0; j3 < seg; j3++) {
      var a5 = j3 / seg * TAU, ca5 = Math.cos(a5), sa5 = Math.sin(a5);
      sb.push(V(G.rBottom * ca5, G.rBottom * sa5, 0));
      st.push(V(G.rBottom * ca5, G.rBottom * sa5, G.zFloor));
    }
    for (j3 = 0; j3 < seg; j3++) {
      var jn3 = (j3 + 1) % seg;
      var sa6 = j3 / seg * TAU, sb6 = (j3 + 1) / seg * TAU;
      var sn0 = [Math.cos(sa6), Math.sin(sa6), 0], sn1 = [Math.cos(sb6), Math.sin(sb6), 0];
      T(sb[j3], sb[jn3], st[jn3], sn0, sn1, sn1);
      T(sb[j3], st[jn3], st[j3], sn0, sn1, sn0);
    }

    /* ---------- 滤孔内壁（铣槽模式由 buildRadialGrooves 建造） ---------- */
    if (!hasGroove) {
    for (var hi2 = 0; hi2 < G.holes.length; hi2++) {
      var h = G.holes[hi2];
      var lo = [], hp = [];
      for (var hj = 0; hj < HOLE_SEG; hj++) {
        var ha = hj / HOLE_SEG * TAU, hc = Math.cos(ha), hs = Math.sin(ha);
        lo.push(V(h.x + h.r * hc, h.y + h.r * hs, 0));
        hp.push(V(h.x + h.r * hc, h.y + h.r * hs, G.zFloor));
      }
      for (hj = 0; hj < HOLE_SEG; hj++) {
        var hjn = (hj + 1) % HOLE_SEG;
        var hn0 = [-hc, -hs, 0];
        var hn1 = [-Math.cos((hj + 1) / HOLE_SEG * TAU), -Math.sin((hj + 1) / HOLE_SEG * TAU), 0];
        T(lo[hj], hp[hj], hp[hjn], hn0, hn0, hn1);
        T(lo[hj], hp[hjn], lo[hjn], hn0, hn1, hn1);
      }
    }
    }

    /* ---------- 导水槽（真实几何） ---------- */
    var ribStats = { built: false, count: 0, grooveCount: 0 };
    /* 网格写入器：V 加点、T 加三角形 */
    var W = { V: V, T: T };
    if (G.buildRibs) {
      ribStats = buildSpiralRibs(G, W);
    } else if (G.buildGrooves) {
      ribStats = buildRadialGrooves(G, W);
    }

    /* ---------- 面法向（由叉积计算）与顶点法向 ---------- */
    var vcount = pos.length / 3, tcount = idx.length / 3;
    var fn2 = new Float32Array(tcount * 3);
    var vn = new Float32Array(vcount * 3);
    var i, q;
    for (i = 0; i < tcount; i++) {
      var ia = idx[i * 3] * 3, ib = idx[i * 3 + 1] * 3, ic = idx[i * 3 + 2] * 3;
      var ux = pos[ib] - pos[ia], uy = pos[ib + 1] - pos[ia + 1], uz = pos[ib + 2] - pos[ia + 2];
      var vx = pos[ic] - pos[ia], vy = pos[ic + 1] - pos[ia + 1], vz = pos[ic + 2] - pos[ia + 2];
      var nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      var L = Math.sqrt(nx * nx + ny * ny + nz * nz);
      if (L > 1e-12) { nx /= L; ny /= L; nz /= L; } else { nx = 0; ny = 0; nz = 1; }
      fn2[i * 3] = nx; fn2[i * 3 + 1] = ny; fn2[i * 3 + 2] = nz;
      var vs = [ia, ib, ic];
      for (q = 0; q < 3; q++) {
        vn[vs[q]] += nx; vn[vs[q] + 1] += ny; vn[vs[q] + 2] += nz;
      }
    }
    for (i = 0; i < vcount; i++) {
      var Ln = Math.sqrt(vn[i * 3] * vn[i * 3] + vn[i * 3 + 1] * vn[i * 3 + 1] + vn[i * 3 + 2] * vn[i * 3 + 2]);
      if (Ln > 1e-9) { vn[i * 3] /= Ln; vn[i * 3 + 1] /= Ln; vn[i * 3 + 2] /= Ln; }
      else { vn[i * 3] = 0; vn[i * 3 + 1] = 0; vn[i * 3 + 2] = 1; }
    }

    return {
      positions: new Float32Array(pos),
      normals: vn,
      faceNormals: fn2,
      indices: new Uint32Array(idx),
      geom: G,
      ribStats: ribStats,
      triCount: tcount,
      vertCount: vcount
    };
  }

  /* ===========================================================
   * 壁部导水槽 · 螺旋凸肋（真实建出）
   * ------------------------------------------------------------
   * 一条肋 = 贴在腔内壁上的一条「螺旋贴带」：
   *   在高度 z 处占据一个「周向宽度 width」的角度区间，
   *   区间中心随 z 沿螺旋线旋转（spiral）或保持不动（straight）；
   *   肋从壁面沿壁法向凸入腔内 depth。
   *
   * 为什么用「等高度切片」而不是「沿路径扫掠矩形截面」：
   *   物理模型把 ribWidth 定义成周向占位（肋间自由缝隙
   *   freeW = 周长 − 条数×肋宽），材料体积也按
   *   Σ count×width×depth×路径长 计。
   *   等高度切片的实体体积正好等于这个口径；
   *   若沿路径扫掠一个垂直于路径的矩形截面，体积会少 1/cos(螺旋角) 倍，
   *   与物理模型对不上。
   *
   * 底边嵌入壁内 RIB_EMBED：
   *   底边若正好贴在壁面上会与壁面共面，切片时出 z-fighting 与接缝毛刺；
   *   往壁内嵌一点点，让两个壳体做体积相交，union 更干净。
   *
   * 分段模式（ribSegMode='seg'）：
   *   相邻两段的肋若在接缝处中心角相同 ⇒ 视为同一条肋的延续，
   *   不做中间封口；宽/高不同则在接缝处形成台阶。
   *   中心角不同 ⇒ 两条独立肋，各自封端（封端面角度不同，不会重叠）。
   * =========================================================== */
  var RIB_EMBED = 0.3;    // mm 肋底嵌入壁内深度
  var RIB_ZSTEP = 1.5;   // mm 肋的 z 向切片步长上限
  var RIB_ASTEP = 0.08;  // rad 相邻切片的中心角步长上限

  function buildSpiralRibs(G, W) {
    var stats = { built: false, count: 0, grooveCount: 0 };
    var cav = G.cav;
    var zLo = cav[0].z, zHi = cav[cav.length - 1].z;

    /* 腔壁母线：按 z 取腔半径与母线切向 */
    function cavAt(z) {
      var i;
      if (z <= cav[0].z) return { r: cav[0].r, tr: 0, tz: 1 };
      if (z >= cav[cav.length - 1].z) return { r: cav[cav.length - 1].r, tr: 0, tz: 1 };
      for (i = 0; i < cav.length - 1; i++) {
        if (z >= cav[i].z && z <= cav[i + 1].z) {
          var dz = cav[i + 1].z - cav[i].z;
          var dr = cav[i + 1].r - cav[i].r;
          var L = Math.sqrt(dr * dr + dz * dz) || 1;
          return { r: cav[i].r + dr * (z - cav[i].z) / (dz || 1), tr: dr / L, tz: dz / L };
        }
      }
      return { r: cav[cav.length - 1].r, tr: 0, tz: 1 };
    }

    function angNorm(a) { a = a % TAU; if (a < 0) a += TAU; return a; }
    function angDiff(a, b) {
      var d = angNorm(a) - angNorm(b);
      if (d > Math.PI) d -= TAU;
      if (d < -Math.PI) d += TAU;
      return d;
    }
    function cross3(a, b) {
      return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
    }
    function dot3(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }

    /* ---------- 1. 段规范化：裁进腔体高度、按 z0 排序、去掉 z 重叠 ---------- */
    var segs = [], i0;
    if (G.ribSegments && G.ribSegments.length) {
      for (i0 = 0; i0 < G.ribSegments.length; i0++) {
        var s0 = G.ribSegments[i0];
        segs.push({
          shape: s0.shape,
          z0: Math.max(zLo, s0.z0), z1: Math.min(zHi, s0.z1),
          count: s0.count, width: s0.width, depth: s0.depth, turns: s0.turns
        });
      }
    } else {
      segs.push({
        shape: 'spiral', z0: zLo, z1: zHi, count: G.ribCount,
        width: G.ribWidth, depth: G.ribDepth, turns: G.ribTurns
      });
    }
    segs.sort(function (a, b) { return a.z0 - b.z0; });
    for (i0 = 0; i0 + 1 < segs.length; i0++) {
      if (segs[i0].z1 > segs[i0 + 1].z0) segs[i0].z1 = segs[i0 + 1].z0;
    }

    /* ---------- 2. 每段生成肋条（每条 = 一段贴带） ---------- */
    var segBands = [], si;
    for (si = 0; si < segs.length; si++) {
      var sg = segs[si];
      if (sg.shape !== 'spiral' && sg.shape !== 'straight') continue;
      if (!(sg.count > 0 && sg.width > 0 && sg.depth > 0)) continue;
      if (sg.z1 - sg.z0 < 0.8) continue;
      var list = [];
      for (var k = 0; k < sg.count; k++) {
        list.push({
          pieces: [{
            shape: sg.shape, aStart: k / sg.count * TAU, turns: sg.turns,
            z0: sg.z0, z1: sg.z1, width: sg.width, depth: sg.depth
          }],
          absorbed: false
        });
      }
      segBands.push(list);
    }

    /* ---------- 3. 相邻段接缝合并（中心角相同 ⇒ 同一条肋延续） ---------- */
    function pieceStartAng(pc) { return pc.aStart; }
    function pieceEndAng(pc) {
      return pc.shape === 'straight' ? pc.aStart : pc.aStart + pc.turns * TAU;
    }
    var frontier = [], gi;
    for (gi = 0; gi < segBands.length; gi++) {
      var cur = segBands[gi], nextFrontier = [], ci;
      for (ci = 0; ci < cur.length; ci++) {
        var bb = cur[ci];
        if (bb.absorbed) continue;
        var host = null, oi;
        for (oi = 0; oi < frontier.length; oi++) {
          var ba = frontier[oi];
          if (ba.absorbed) continue;
          var pe = ba.pieces[ba.pieces.length - 1];
          if (Math.abs(pe.z1 - bb.pieces[0].z0) > 1e-6) continue;
          if (Math.abs(angDiff(pieceEndAng(pe), pieceStartAng(bb.pieces[0]))) > 1e-6) continue;
          host = ba; break;
        }
        if (host) {
          host.pieces.push(bb.pieces[0]);
          bb.absorbed = true;
          nextFrontier.push(host);
        } else {
          nextFrontier.push(bb);
        }
      }
      frontier = nextFrontier;
    }

    /* ---------- 4. 肋条 → z 切片 ---------- */
    function bandSlices(band) {
      var out = [], pi, j, n, z, t;
      for (pi = 0; pi < band.pieces.length; pi++) {
        var pc = band.pieces[pi];
        var dz = pc.z1 - pc.z0;
        n = Math.max(2, Math.ceil(dz / RIB_ZSTEP));
        if (pc.shape === 'spiral') {
          n = Math.max(n, Math.ceil(Math.abs(pc.turns) * TAU / RIB_ASTEP));
        }
        for (j = 0; j <= n; j++) {
          z = pc.z0 + dz * j / n;
          t = dz > 0 ? j / n : 0;
          var ang = pc.shape === 'spiral' ? (pc.aStart + pc.turns * TAU * t) : pc.aStart;
          var ca = cavAt(z);
          var last = out.length ? out[out.length - 1] : null;
          if (last && Math.abs(last.z - z) < 1e-7 &&
              Math.abs(last.w - pc.width) < 1e-9 && Math.abs(last.d - pc.depth) < 1e-9) {
            /* 接缝且宽高相同 ⇒ 无缝，沿用上一片 */
            last.ang = ang; last.r = ca.r; last.tr = ca.tr; last.tz = ca.tz;
            continue;
          }
          out.push({ z: z, ang: ang, r: ca.r, tr: ca.tr, tz: ca.tz, w: pc.width, d: pc.depth });
        }
      }
      return out;
    }

    /* ---------- 5. 切片 → 截面四边形（水平扇形：底边嵌入壁内 / 顶边凸出 depth） ----------
     * 截面必须取「水平」的：即同一层的 4 个点 z 相同、只有半径与角度不同。
     * 若把 4 个点沿壁法向排开（底边更低、顶边更高），端盖就会落在壁面切平面上，
     * 与顶面折成凹角 → 共用边被同向遍历 → 网格定向自相矛盾、体算虚高。
     * 凸出量按「垂直于壁面的高度 = depth」换算成径向偏移，
     * 这样无论锥角多斜，法向凸出高度都精确等于 depth。 */
    function sliceRing(s) {
      var nr = -s.tz, nz = s.tr;                      // 壁法向（指向腔心）
      var nl = Math.sqrt(nr * nr + nz * nz) || 1;
      var nAbs = Math.abs(nr) / nl;                   // 壁法向的径向分量占比
      var k = 1 / Math.max(0.25, nAbs);               // 径向 / 法向 换算系数
      var dRad = s.d * k;                             // 凸出 depth 的径向偏移
      var eRad = RIB_EMBED * k;                       // 嵌入壁内的径向偏移
      var rb = s.r + eRad, rt = s.r - dRad;
      var halfA = (s.w / 2) / Math.max(1e-6, s.r);    // 周向半角（弧长 → 弧度）
      var aL = s.ang - halfA, aR = s.ang + halfA;
      return [
        { x: rb * Math.cos(aL), y: rb * Math.sin(aL), z: s.z },  // 0 底左
        { x: rb * Math.cos(aR), y: rb * Math.sin(aR), z: s.z },  // 1 底右
        { x: rt * Math.cos(aR), y: rt * Math.sin(aR), z: s.z },  // 2 顶右
        { x: rt * Math.cos(aL), y: rt * Math.sin(aL), z: s.z }   // 3 顶左
      ];
    }

    function quadCenter(q) {
      return [(q[0].x + q[1].x + q[2].x + q[3].x) / 4,
              (q[0].y + q[1].y + q[2].y + q[3].y) / 4,
              (q[0].z + q[1].z + q[2].z + q[3].z) / 4];
    }

    /* 两条相邻切片之间的 4 条面带（绕序由「边×扫掠方向 + 外法向校正」决定）
     * 外法向校正必须以「当前环自身的中心」为基准：
     * 若用两个环中心的平均，两环沿扫掠方向错开半个切片，外法向向量会趋近于零，
     * 符号随机翻转 → 局部绕序反转 → 网格体积虚高。 */
    function strip(r0, r1) {
      var Dv = [0, 0, 1];
      var ctr = quadCenter(r0);
      for (var j = 0; j < 4; j++) {
        var jn = (j + 1) % 4;
        var A = r0[j], B = r0[jn], C = r1[jn], Dq = r1[j];
        var E = [B.x - A.x, B.y - A.y, B.z - A.z];
        var n = cross3(E, Dv);
        var mid = [(A.x + B.x) / 2, (A.y + B.y) / 2, (A.z + B.z) / 2];
        var outv = [mid[0] - ctr[0], mid[1] - ctr[1], mid[2] - ctr[2]];
        if (dot3(n, outv) < 0) n = [-n[0], -n[1], -n[2]];
        var va = W.V(A.x, A.y, A.z), vb = W.V(B.x, B.y, B.z);
        var vc = W.V(C.x, C.y, C.z), vd = W.V(Dq.x, Dq.y, Dq.z);
        W.T(va, vb, vc, n[0], n[1], n[2]);
        W.T(va, vc, vd, n[0], n[1], n[2]);
      }
    }

    /* 端面封口：水平扇形，法向就是 ±z（起点朝下、终点朝上） */
    function capRing(q, sign) {
      var n = [0, 0, sign];
      var c0 = W.V(q[0].x, q[0].y, q[0].z);
      var c1 = W.V(q[1].x, q[1].y, q[1].z);
      var c2 = W.V(q[2].x, q[2].y, q[2].z);
      var c3 = W.V(q[3].x, q[3].y, q[3].z);
      W.T(c0, c1, c2, n[0], n[1], n[2]);
      W.T(c0, c2, c3, n[0], n[1], n[2]);
    }

    /* ---------- 6. 生成几何 ---------- */
    var built = 0, bi, ci2;
    for (bi = 0; bi < segBands.length; bi++) {
      var lb = segBands[bi];
      for (ci2 = 0; ci2 < lb.length; ci2++) {
        if (lb[ci2].absorbed) continue;
        var sl = bandSlices(lb[ci2]);
        if (sl.length < 2) continue;
        var rings = [], i;
        for (i = 0; i < sl.length; i++) rings.push(sliceRing(sl[i]));
        for (i = 0; i + 1 < rings.length; i++) strip(rings[i], rings[i + 1]);
        /* 起点封口朝下、终点封口朝上 */
        capRing(rings[0], -1);
        capRing(rings[rings.length - 1], 1);
        built++;
      }
    }
    stats.built = built > 0;
    stats.count = built;
    stats.grooveCount = 0;
    return stats;
  }

  /* ===========================================================
   * 径向铣槽：铣在底板实体里的径向沟槽
   * ------------------------------------------------------------
   * 【构造】底板（z ∈ [0, floorThk]）被分成三层：
   *   · z ∈ [0, floorThk − depth]  完整实体（底面 + 外侧壁）
   *   · z ∈ [floorThk − depth, floorThk]  槽区被挖掉
   * 槽口多边形（底面 z=0 的那一圈）与底面的洞一致，
   * 槽侧壁自 z=0 拉到 z=floorThk−depth（槽底），
   * 槽底面在 z = floorThk − depth 覆盖槽口范围。
   *
   * 【为何这样一定闭合】
   *   底面 = earcut(外圆盘 − 孔圆环 − 槽口多边形)   ← 边界边都用同一批坐标
   *   槽壁上下缘分别落在「底面顶点」与「槽底顶点」上 ⇒ 逐边两用。
   * =========================================================== */
  function buildRadialGrooves(G, W) {
    var stats = { built: false, count: 0, grooveCount: 0 };
    var holes = G.holes, i, k;
    var count = G.ribCount, width = G.ribWidth, depth = G.ribDepth;
    if (!(count > 0 && width > 0 && depth > 0)) return stats;
    var zPit = G.floorThk - depth;          // 槽底高度（自底面向上）
    if (zPit < 0.6) return stats;         // 底板太薄，铣不动

    var seg = SEG;
    function segIndex(a) {
      var aa = ((a % TAU) + TAU) % TAU;
      return Math.round(aa / TAU * seg) % seg;
    }

    /* 槽的角度 */
    var slots = [], hasCenter = false;
    for (i = 0; i < holes.length; i++) {
      if (Math.hypot(holes[i].x, holes[i].y) < 0.8) { hasCenter = true; break; }
    }
    if (hasCenter) {
      for (i = 0; i < count; i++) slots.push(i / count * TAU);
    } else {
      for (i = 0; i < count; i++) slots.push(Math.atan2(holes[i % holes.length].y, holes[i % holes.length].x));
    }

    /* 槽的径向范围 */
    var rStart = 1e9;
    for (i = 0; i < holes.length; i++) {
      var dd = Math.hypot(holes[i].x, holes[i].y) - holes[i].r;
      if (dd < rStart) rStart = dd;
    }
    if (!(rStart < 1e8)) rStart = 0.5;
    for (i = 0; i < slots.length; i++) {
      for (k = 0; k < holes.length; k++) {
        var hk = holes[k];
        var dA = Math.abs(((Math.atan2(hk.y, hk.x) - slots[i] + Math.PI * 3) % TAU) - Math.PI);
        var dR = Math.hypot(hk.x, hk.y);
        if (dA * dR < hk.r + 0.6) {
          var need = dR + hk.r + 0.4;
          if (need > rStart) rStart = need;
        }
      }
    }
    var rEnd = G.rCavFloor - 0.4;
    if (rEnd <= rStart + 0.8) return stats;

    /* 槽口多边形：内端弧（rStart）+ 外端弧（rEnd），顶点取自等分角 */
    var grooveRings = [];
    for (i = 0; i < slots.length; i++) {
      var half = (width / 2) / Math.max(1, (rStart + rEnd) / 2);
      var iA = segIndex(slots[i] - half), iB = segIndex(slots[i] + half);
      if (iB <= iA) iB += seg;
      var ring = [];
      for (k = iA; k <= iB; k++) {
        var ak = (k % seg) / seg * TAU;
        ring.push({ r: rStart, c: Math.cos(ak), s: Math.sin(ak) });
      }
      var nIn = ring.length;
      for (k = iB; k >= iA; k--) {
        var ak2 = (k % seg) / seg * TAU;
        ring.push({ r: rEnd, c: Math.cos(ak2), s: Math.sin(ak2) });
      }
      grooveRings.push({ ring: ring, nIn: nIn });
    }

    /* ---- 底面多边形：外圆盘 − 孔圆环 − 槽口多边形 ---- */
    var poly = [], hidx = [];
    for (i = 0; i < seg; i++) {
      var a = i / seg * TAU;
      poly.push(G.rBottom * Math.cos(a), G.rBottom * Math.sin(a));
    }
    for (i = 0; i < holes.length; i++) {
      var h = holes[i];
      hidx.push(poly.length / 2);
      for (k = HOLE_SEG - 1; k >= 0; k--) {
        var hb = k / HOLE_SEG * TAU;
        poly.push(h.x + h.r * Math.cos(hb), h.y + h.r * Math.sin(hb));
      }
    }
    for (i = 0; i < grooveRings.length; i++) {
      var gr = grooveRings[i].ring;
      hidx.push(poly.length / 2);
      for (k = 0; k < gr.length; k++) poly.push(gr[k].r * gr[k].c, gr[k].r * gr[k].s);
    }
    var tris = earcut(poly, hidx, 2);
    var vidx = [];
    for (i = 0; i < poly.length / 2; i++) vidx.push(-1);
    function dv(ix2) {
      if (vidx[ix2] < 0) vidx[ix2] = W.V(poly[ix2 * 2], poly[ix2 * 2 + 1], 0);
      return vidx[ix2];
    }
    for (i = 0; i < tris.length; i += 3) {
      W.T(dv(tris[i]), dv(tris[i + 2]), dv(tris[i + 1]), 0, 0, -1);
    }

    /* ---- 腔底面（z = floorThk）：外圆盘 − 孔圆环 ---- */
    var poly2 = [], hidx2 = [];
    for (i = 0; i < seg; i++) {
      var a2 = i / seg * TAU;
      poly2.push(G.rCavFloor * Math.cos(a2), G.rCavFloor * Math.sin(a2));
    }
    for (i = 0; i < holes.length; i++) {
      var h2 = holes[i];
      hidx2.push(poly2.length / 2);
      for (k = HOLE_SEG - 1; k >= 0; k--) {
        var hb2 = k / HOLE_SEG * TAU;
        poly2.push(h2.x + h2.r * Math.cos(hb2), h2.y + h2.r * Math.sin(hb2));
      }
    }
    var tris2 = earcut(poly2, hidx2, 2);
    var vidx2 = [];
    for (i = 0; i < poly2.length / 2; i++) vidx2.push(-1);
    function dv2(ix2) {
      if (vidx2[ix2] < 0) vidx2[ix2] = W.V(poly2[ix2 * 2], poly2[ix2 * 2 + 1], G.zFloor);
      return vidx2[ix2];
    }
    for (i = 0; i < tris2.length; i += 3) {
      W.T(dv2(tris2[i]), dv2(tris2[i + 1]), dv2(tris2[i + 2]), 0, 0, 1);
    }

    /* ---- 孔壁（z = 0 → floorThk） ---- */
    for (i = 0; i < holes.length; i++) {
      var h3 = holes[i];
      var lo = [], hp = [];
      for (k = 0; k < HOLE_SEG; k++) {
        var ha = k / HOLE_SEG * TAU, hc = Math.cos(ha), hs = Math.sin(ha);
        lo.push(W.V(h3.x + h3.r * hc, h3.y + h3.r * hs, 0));
        hp.push(W.V(h3.x + h3.r * hc, h3.y + h3.r * hs, G.zFloor));
      }
      for (k = 0; k < HOLE_SEG; k++) {
        var hn = (k + 1) % HOLE_SEG;
        var n0 = [-hc, -hs, 0];
        var n1 = [-Math.cos((k + 1) / HOLE_SEG * TAU), -Math.sin((k + 1) / HOLE_SEG * TAU), 0];
        W.T(lo[k], hp[k], hp[hn], n0, n0, n1);
        W.T(lo[k], hp[hn], lo[hn], n0, n1, n1);
      }
    }

    /* ---- 槽：槽壁（z=0 → zPit）+ 槽底（z=zPit） ---- */
    for (i = 0; i < grooveRings.length; i++) {
      var gr2 = grooveRings[i].ring, nIn = grooveRings[i].nIn;
      for (k = 0; k < gr2.length; k++) {
        var q = gr2[k];
        q.vBot = W.V(q.r * q.c, q.r * q.s, 0);
        q.vPit = W.V(q.r * q.c, q.r * q.s, zPit);
      }
      /* 槽顶板（z=zPit）：用 earcut 三角化槽口多边形
       * 不用扇形三角化：槽口是「环形扇段」多边形（内弧 + 外弧），
       * 从一个顶点扇切出来的三角形朝向不一致（内弧侧与外弧侧相反），
       * 会让内部共用边被同向遍历。earcut 给出的三角化朝向自洽。
       * 槽是从底面 z=0 往上铣的凹坑（坑口朝下、坑顶在 zPit），
       * 实体在坑顶之上 ⇒ 该面外法向朝下（指向坑内）＝ −z。 */
      var gpoly = [];
      for (k = 0; k < gr2.length; k++) gpoly.push(gr2[k].r * gr2[k].c, gr2[k].r * gr2[k].s);
      var gtris = earcut(gpoly, null, 2);
      for (k = 0; k < gtris.length; k += 3) {
        W.T(gr2[gtris[k]].vPit, gr2[gtris[k + 1]].vPit, gr2[gtris[k + 2]].vPit, 0, 0, -1);
      }
      /* 槽壁：沿坑口多边形每条边竖直下拉
       * 绕序要同时满足两处共用边：
       *   · 下缘（z=0）必须与底面遍历方向相反
       *   · 上缘（z=zPit）必须与槽底面遍历方向相反
       * 因此取三角形 (A底, B底, B槽底) + (A底, B槽底, A槽底)：
       *   下缘走 A→B，上缘走 B槽底→A槽底。 */
      for (k = 0; k < gr2.length; k++) {
        var k2 = (k + 1) % gr2.length;
        var A = gr2[k], B = gr2[k2];
        var ex = B.r * B.c - A.r * A.c, ey = B.r * B.s - A.r * A.s;
        var el2 = Math.sqrt(ex * ex + ey * ey) || 1;
        var ne = [ey / el2, -ex / el2, 0];
        W.T(A.vBot, B.vBot, B.vPit, ne, ne, ne);
        W.T(A.vBot, B.vPit, A.vPit, ne, ne, ne);
      }
    }

    stats.built = true;
    stats.count = 0;
    stats.grooveCount = grooveRings.length;
    return stats;
  }

  return {
    solve: solve,
    buildMesh: buildMesh,
    holeLayout: holeLayout,
    offsetProfile: offsetProfile,
    SEG: SEG,
    HOLE_SEG: HOLE_SEG
  };
})();
if (typeof module !== 'undefined' && module.exports) module.exports = PRINT3;
