/* ===========================================================
 * EXPORT — STL（二进制）/ 3MF / OBJ 导出
 * 单位毫米、Z 轴向上、底面贴板（z=0）
 * =========================================================== */
var EXPORT = (function () {
  'use strict';

  /* ---------------- 导出：STL（二进制） ---------------- */
  function toSTL(mesh, header) {
    var p = mesh.positions, ix = mesh.indices, i;
    var buf = new ArrayBuffer(84 + ix.length / 3 * 50);
    var dv = new DataView(buf), u8 = new Uint8Array(buf);
    var head = (header || 'WorkBuddy Dripper Lab');
    for (i = 0; i < 80; i++) u8[i] = i < head.length ? head.charCodeAt(i) & 0x7f : 0x20;
    dv.setUint32(80, ix.length / 3, true);
    var off = 84;
    for (i = 0; i < ix.length; i += 3) {
      var a = ix[i] * 3, b = ix[i + 1] * 3, c = ix[i + 2] * 3;
      var ax = p[a], ay = p[a + 1], az = p[a + 2];
      var bx = p[b], by = p[b + 1], bz = p[b + 2];
      var cx = p[c], cy = p[c + 1], cz = p[c + 2];
      var ux = bx - ax, uy = by - ay, uz = bz - az;
      var vx = cx - ax, vy = cy - ay, vz = cz - az;
      var nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      var L = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
      dv.setFloat32(off, nx / L, true); dv.setFloat32(off + 4, ny / L, true); dv.setFloat32(off + 8, nz / L, true);
      dv.setFloat32(off + 12, ax, true); dv.setFloat32(off + 16, ay, true); dv.setFloat32(off + 20, az, true);
      dv.setFloat32(off + 24, bx, true); dv.setFloat32(off + 28, by, true); dv.setFloat32(off + 32, bz, true);
      dv.setFloat32(off + 36, cx, true); dv.setFloat32(off + 40, cy, true); dv.setFloat32(off + 44, cz, true);
      dv.setUint16(off + 48, 0, true);
      off += 50;
    }
    return buf;
  }

  /* ---------------- 导出：OBJ ---------------- */
  function toOBJ(mesh, name) {
    var p = mesh.positions, ix = mesh.indices, i;
    var s = '# ' + (name || 'dripper') + ' (mm, Z-up)\n';
    s += '# vertices ' + mesh.vertCount + '  faces ' + mesh.triCount + '\n';
    for (i = 0; i < p.length; i += 3) {
      s += 'v ' + p[i].toFixed(4) + ' ' + p[i + 1].toFixed(4) + ' ' + p[i + 2].toFixed(4) + '\n';
    }
    for (i = 0; i < ix.length; i += 3) {
      s += 'f ' + (ix[i] + 1) + ' ' + (ix[i + 1] + 1) + ' ' + (ix[i + 2] + 1) + '\n';
    }
    return s;
  }

  /* ---------------- ZIP（store）+ 3MF ---------------- */
  var CRC_TABLE = (function () {
    var t = new Uint32Array(256), c, n, k;
    for (n = 0; n < 256; n++) {
      c = n;
      for (k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      t[n] = c >>> 0;
    }
    return t;
  })();
  function crc32(u8) {
    var c = 0xFFFFFFFF;
    for (var i = 0; i < u8.length; i++) c = CRC_TABLE[(c ^ u8[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }
  function utf8(str) { return new TextEncoder().encode(str); }

  function zipStore(files) {
    var parts = [], central = [], offset = 0, i;
    var d = new Date();
    var dosTime = ((d.getHours() & 31) << 11) | ((d.getMinutes() & 63) << 5) | ((d.getSeconds() / 2) & 31);
    var dosDate = (((d.getFullYear() - 1980) & 127) << 9) | (((d.getMonth() + 1) & 15) << 5) | (d.getDate() & 31);
    for (i = 0; i < files.length; i++) {
      var name = utf8(files[i].name), data = files[i].data;
      var crc = crc32(data);
      var lh = new Uint8Array(30 + name.length);
      var dv = new DataView(lh.buffer);
      dv.setUint32(0, 0x04034b50, true);
      dv.setUint16(4, 20, true);
      dv.setUint16(6, 0x0800, true);
      dv.setUint16(8, 0, true);
      dv.setUint16(10, dosTime, true);
      dv.setUint16(12, dosDate, true);
      dv.setUint32(14, crc, true);
      dv.setUint32(18, data.length, true);
      dv.setUint32(22, data.length, true);
      dv.setUint16(26, name.length, true);
      dv.setUint16(28, 0, true);
      lh.set(name, 30);
      parts.push(lh, data);

      var ch = new Uint8Array(46 + name.length);
      var cv = new DataView(ch.buffer);
      cv.setUint32(0, 0x02014b50, true);
      cv.setUint16(4, 20, true);
      cv.setUint16(6, 20, true);
      cv.setUint16(8, 0x0800, true);
      cv.setUint16(10, 0, true);
      cv.setUint16(12, dosTime, true);
      cv.setUint16(14, dosDate, true);
      cv.setUint32(16, crc, true);
      cv.setUint32(20, data.length, true);
      cv.setUint32(24, data.length, true);
      cv.setUint16(28, name.length, true);
      cv.setUint32(42, offset, true);
      ch.set(name, 46);
      central.push(ch);
      offset += lh.length + data.length;
    }
    var cdSize = 0;
    for (i = 0; i < central.length; i++) cdSize += central[i].length;
    var eo = new Uint8Array(22);
    var ev = new DataView(eo.buffer);
    ev.setUint32(0, 0x06054b50, true);
    ev.setUint16(8, files.length, true);
    ev.setUint16(10, files.length, true);
    ev.setUint32(12, cdSize, true);
    ev.setUint32(16, offset, true);
    var out = new Uint8Array(offset + cdSize + 22);
    var o = 0;
    for (i = 0; i < parts.length; i++) { out.set(parts[i], o); o += parts[i].length; }
    for (i = 0; i < central.length; i++) { out.set(central[i], o); o += central[i].length; }
    out.set(eo, o);
    return out;
  }

  function to3MF(mesh, meta) {
    meta = meta || {};
    var p = mesh.positions, ix = mesh.indices, i;
    var s = '<?xml version="1.0" encoding="UTF-8"?>\n';
    s += '<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">\n';
    s += ' <metadata name="Application">WorkBuddy 手冲滤杯设计工坊</metadata>\n';
    s += ' <metadata name="Title">' + (meta.title || 'Pour-over Dripper') + '</metadata>\n';
    s += ' <resources>\n  <object id="1" type="model">\n   <mesh>\n    <vertices>\n';
    for (i = 0; i < p.length; i += 3) {
      s += '     <vertex x="' + p[i].toFixed(4) + '" y="' + p[i + 1].toFixed(4) + '" z="' + p[i + 2].toFixed(4) + '"/>\n';
    }
    s += '    </vertices>\n    <triangles>\n';
    for (i = 0; i < ix.length; i += 3) {
      s += '     <triangle v1="' + ix[i] + '" v2="' + ix[i + 1] + '" v3="' + ix[i + 2] + '"/>\n';
    }
    s += '    </triangles>\n   </mesh>\n  </object>\n </resources>\n';
    s += ' <build><item objectid="1" transform="1 0 0 0 1 0 0 0 1 0 0 0"/></build>\n';
    s += '</model>\n';

    var ct = '<?xml version="1.0" encoding="UTF-8"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">\n'
      + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>\n'
      + '<Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>\n'
      + '</Types>\n';
    var rels = '<?xml version="1.0" encoding="UTF-8"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">\n'
      + '<Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>\n'
      + '</Relationships>\n';

    return zipStore([
      { name: '[Content_Types].xml', data: utf8(ct) },
      { name: '_rels/.rels', data: utf8(rels) },
      { name: '3D/3dmodel.model', data: utf8(s) }
    ]);
  }


  return {
    toSTL: toSTL,
    toOBJ: toOBJ,
    to3MF: to3MF
  };
})();
if (typeof module !== 'undefined' && module.exports) module.exports = EXPORT;
