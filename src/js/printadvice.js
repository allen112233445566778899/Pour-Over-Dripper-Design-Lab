/* ===========================================================
 * PRINTADVICE — 打印工艺评估（v3：含壁部导水槽）
 * ------------------------------------------------------------
 * 依据真实几何给出：摆放方向、支撑需求、层高壁圈、耗材估算、
 * 以及与导水槽相关的可打印性提醒。
 * =========================================================== */
var PRINTADVICE = (function () {
  'use strict';

  var MATERIALS = {
    pla: { name: 'PLA', rho: 1.24, maxT: 55, hot: '耐温低，90 ℃ 热水不建议' },
    petg: { name: 'PETG', rho: 1.27, maxT: 80, hot: '耐温良好，热水场景推荐' },
    abs: { name: 'ABS', rho: 1.04, maxT: 95, hot: '耐温好，需封闭仓防翘曲' },
    pp: { name: 'PP', rho: 0.90, maxT: 100, hot: '耐热最佳，手冲热水首选' },
    pa: { name: 'PA/尼龙', rho: 1.10, maxT: 100, hot: '强度高，需烘干' }
  };

  function r2(v) { return Math.round(v * 100) / 100; }

  /* 网格自检：水密流形 / 体积 / 表面积 / 包围盒 */
  function validate(mesh) {
    var p = mesh.positions, ix = mesh.indices, i;
    var edges = {}, open = 0, over = 0, degen = 0;
    var vol = 0, area = 0;
    var bb = [1e9, 1e9, 1e9, -1e9, -1e9, -1e9];
    for (i = 0; i < p.length; i += 3) {
      if (p[i] < bb[0]) bb[0] = p[i]; if (p[i] > bb[3]) bb[3] = p[i];
      if (p[i + 1] < bb[1]) bb[1] = p[i + 1]; if (p[i + 1] > bb[4]) bb[4] = p[i + 1];
      if (p[i + 2] < bb[2]) bb[2] = p[i + 2]; if (p[i + 2] > bb[5]) bb[5] = p[i + 2];
    }
    for (i = 0; i < ix.length; i += 3) {
      var a = ix[i], b = ix[i + 1], c = ix[i + 2];
      if (a === b || b === c || a === c) { degen++; continue; }
      var ax = p[a * 3], ay = p[a * 3 + 1], az = p[a * 3 + 2];
      var bx = p[b * 3], by = p[b * 3 + 1], bz = p[b * 3 + 2];
      var cx = p[c * 3], cy = p[c * 3 + 1], cz = p[c * 3 + 2];
      vol += (ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx)) / 6;
      var ux = bx - ax, uy = by - ay, uz = bz - az;
      var vx = cx - ax, vy = cy - ay, vz = cz - az;
      var nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      area += Math.sqrt(nx * nx + ny * ny + nz * nz) / 2;
      var e = [[a, b], [b, c], [c, a]];
      for (var q = 0; q < 3; q++) {
        var k = e[q][0] < e[q][1] ? e[q][0] + '_' + e[q][1] : e[q][1] + '_' + e[q][0];
        edges[k] = (edges[k] || 0) + 1;
      }
    }
    for (var k2 in edges) {
      if (edges[k2] === 1) open++;
      else if (edges[k2] > 2) over++;
    }
    return {
      watertight: open === 0 && over === 0,
      openEdges: open, nonManifold: over, degenerate: degen,
      volume: vol, area: area, bbox: bb,
      triCount: mesh.triCount, vertCount: mesh.vertCount
    };
  }

  /* 耗材估算：体积 → 长度 → 重量 */
  function filament(volumeCm3, rho) {
    var area = Math.PI * 0.875 * 0.875;          // mm²
    var lenMm = volumeCm3 * 1000 / area;
    return { lengthM: lenMm / 1000, grams: volumeCm3 * rho };
  }

  /* 工艺评估 */
  function advise(G, S, geo, mesh, val) {
    var adv = [], warn = [];
    var nozzle = 0.4;

    /* --- 壁厚 / 孔径 --- */
    if (G.wall < 3 * nozzle) {
      warn.push('壁厚 ' + r2(G.wall) + ' mm < 3×喷嘴，建议加到 ' + (3 * nozzle) + ' mm 以上');
    }
    var minHole = 1e9;
    for (var i = 0; i < G.holes.length; i++) minHole = Math.min(minHole, G.holes[i].r * 2);
    if (minHole < 2.5 * nozzle) {
      warn.push('最小孔径 ' + r2(minHole) + ' mm 过小，0.4 喷嘴难以成形，建议 ≥ ' + r2(2.5 * nozzle) + ' mm');
    }
    if (G.floorThk < 2 * nozzle) {
      warn.push('底板厚 ' + r2(G.floorThk) + ' mm 偏薄，建议 ≥ ' + r2(2 * nozzle) + ' mm');
    }

    /* --- 悬垂：壁面与竖直方向的最大偏离 --- */
    var minDev = 90;
    for (i = 1; i < G.outer.length; i++) {
      var dr = Math.abs(G.outer[i].r - G.outer[i - 1].r);
      var dz = G.outer[i].z - G.outer[i - 1].z;
      if (dz < 1e-6) continue;
      var dev = Math.atan2(dr, dz) * 180 / Math.PI;
      if (dev < minDev) minDev = dev;
    }
    var overhang = minDev > 45;
    if (overhang) {
      warn.push('壁面最大偏离竖直 ' + r2(minDev) + '°，超过 45° 自稳极限，建议开启支撑或加大锥角');
    }

    /* --- 摆放方向 --- */
    var orient = G.shape === 'cone'
      ? '杯口朝上（锥尖朝下）'
      : '杯口朝上（平底贴板）';
    adv.push('摆放：' + orient + '，底面贴板 z=0');
    adv.push('支撑：' + (overhang ? '需要（最大偏离竖直 ' + r2(minDev) + '°）' : '不需要（最大偏离竖直 ' + r2(minDev) + '°，在 45° 自稳范围内）'));

    /* --- 导水槽相关 --- */
    var rb = geo && geo.ribs ? geo.ribs : null;
    if (rb && rb.style !== 'none') {
      if (!rb.applicable) {
        warn.push('导水槽形式与杯型不匹配：' + (rb.mismatch || '当前组合无法生效'));
      } else {
        if (G.buildRibs) {
          /* 分段模式：逐段报形状与条数；整壁模式：报单段规格 */
          var segs = G.ribSegments;
          if (segs && segs.length) {
            var SH = { spiral: '螺旋凸肋', straight: '纵向直肋', none: '光壁' };
            var parts = [], minD = 1e9, minFreeW = 1e9;
            for (var si = 0; si < segs.length; si++) {
              var sg = segs[si];
              if (sg.shape === 'none' || !(sg.count > 0 && sg.width > 0 && sg.depth > 0)) {
                parts.push('z' + sg.z0.toFixed(0) + '–' + sg.z1.toFixed(0) + ' 光壁');
                continue;
              }
              parts.push('z' + sg.z0.toFixed(0) + '–' + sg.z1.toFixed(0) + ' ' +
                (SH[sg.shape] || sg.shape) + '×' + sg.count);
              if (sg.depth < minD) minD = sg.depth;
            }
            adv.push('壁部导水槽（分段）：共 ' + (mesh && mesh.ribStats ? mesh.ribStats.count : G.ribCount) +
              ' 条 —— ' + parts.join('；'));
            if (minD < 0.8) warn.push('最低肋高 ' + r2(minD) + ' mm 偏矮，滤纸可能压贴失去泄压作用');
          } else {
            adv.push('壁部导水槽：已建出 ' + (mesh && mesh.ribStats ? mesh.ribStats.count : G.ribCount) +
              ' 条螺旋凸肋（宽 ' + r2(G.ribWidth) + ' mm、高 ' + r2(G.ribDepth) +
              ' mm、每条绕壁 ' + r2(G.ribTurns) + ' 圈）');
            if (G.ribDepth < 0.8) warn.push('螺旋肋高 ' + r2(G.ribDepth) + ' mm 偏矮，滤纸可能压贴滤纸失去泄压作用');
          }
          if (rb.freeW !== undefined && rb.freeW < 0.5) {
            warn.push('肋间通气缝隙仅 ' + r2(rb.freeW) + ' mm，滤纸易被吸住，建议减少肋数或减小肋宽');
          }
        } else if (G.buildGrooves) {
          adv.push('底面导流槽：已建出 ' + G.ribCount + ' 条径向铣槽（宽 ' + r2(G.ribWidth) + ' mm、深 ' + r2(G.ribDepth) + ' mm）');
        }
        if (rb.ventGain > 0) {
          adv.push('该导水槽使工作点流速提升 ' + r2(rb.ventGain) + '%（无导水槽时 ' +
            r2(rb.gainQwithout) + ' → ' + r2(rb.gainQwith) + ' g/s）');
        }
      }
    } else if (G.shape === 'cone' && S.holeCount === 1) {
      warn.push('单孔锥形且未设导水槽：滤纸贴壁形成密闭袋腔，容易「咕噜」断流，建议加装螺旋排气肋');
    }

    /* --- 层高 / 壁圈 / 材料 --- */
    adv.push('层高 0.16–0.20 mm，壁圈数 ≥ 3（对应本模型壁厚 ' + r2(G.wall) + ' mm）');
    adv.push('材料：PP（耐热 100 ℃）或 PETG；PLA 不适合 90 ℃ 以上热水');

    /* --- 耗材估算 --- */
    var mat = MATERIALS[S.material] || MATERIALS.pp;
    var fl = filament(val.volume / 1000, mat.rho);
    adv.push('耗材估算：' + r2(fl.lengthM) + ' m 丝（' + r2(fl.grams) + ' g ' + mat.name + '，100% 实心，未计填充率）');

    return {
      adv: adv, warn: warn, overhang: overhang, minDev: minDev,
      minHole: minHole, mat: mat, filament: fl
    };
  }

  return {
    validate: validate,
    advise: advise,
    filament: filament,
    MATERIALS: MATERIALS
  };
})();
if (typeof module !== 'undefined' && module.exports) module.exports = PRINTADVICE;
