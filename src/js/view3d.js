/* ===========================================================
 * VIEW3D — 手冲滤杯三维视图（原生 WebGL，无第三方依赖）
 * ------------------------------------------------------------
 * · 轨道相机（拖拽旋转 / 滚轮缩放 / 右键平移）
 * · PBR 近似着色：兰伯特 + 高光 + 边缘光
 * · 剖切平面：可在 X/Y 方向切开模型，实时看内腔结构
 * · 线框叠加 / 半透模式
 * · 自适应分辨率与像素比
 * =========================================================== */
var VIEW3D = (function () {
  'use strict';

  var canvas = null, gl = null, prog = null, progWire = null;
  var buf = { pos: null, nor: null, idx: null, wire: null };
  var idxCount = 0, idxType = 0, wireCount = 0, flatCount = 0;
  var vao = null;

  var cam = {
    yaw: -0.62, pitch: 0.42, dist: 260,
    tx: 0, ty: 0, tz: 40
  };
  var target = { yaw: -0.62, pitch: 0.42, dist: 260, tx: 0, ty: 0, tz: 40 };

  var opts = {
    wire: false, section: false, sectionOffset: 0,
    transparent: false, autoRotate: false, matColor: [0.86, 0.80, 0.72], matRough: 0.55
  };

  var rot = 0, lastFrame = 0, running = false, needsDraw = true;
  var modelR = 80;   // 模型外接半径，用于动态裁剪深度范围

  /* ---------- 矩阵 ---------- */
  function mat4() { return new Float32Array(16); }
  function perspective(out, fovy, aspect, near, far) {
    var f = 1 / Math.tan(fovy / 2), nf = 1 / (near - far);
    out[0] = f / aspect; out[1] = 0; out[2] = 0; out[3] = 0;
    out[4] = 0; out[5] = f; out[6] = 0; out[7] = 0;
    out[8] = 0; out[9] = 0; out[10] = (far + near) * nf; out[11] = -1;
    out[12] = 0; out[13] = 0; out[14] = 2 * far * near * nf; out[15] = 0;
    return out;
  }
  function lookAt(out, eye, center, up) {
    var z0 = eye[0] - center[0], z1 = eye[1] - center[1], z2 = eye[2] - center[2];
    var len = Math.sqrt(z0 * z0 + z1 * z1 + z2 * z2) || 1;
    z0 /= len; z1 /= len; z2 /= len;
    var x0 = up[1] * z2 - up[2] * z1, x1 = up[2] * z0 - up[0] * z2, x2 = up[0] * z1 - up[1] * z0;
    len = Math.sqrt(x0 * x0 + x1 * x1 + x2 * x2);
    if (!len) { x0 = 1; x1 = 0; x2 = 0; } else { x0 /= len; x1 /= len; x2 /= len; }
    var y0 = z1 * x2 - z2 * x1, y1 = z2 * x0 - z0 * x2, y2 = z0 * x1 - z1 * x0;
    out[0] = x0; out[1] = y0; out[2] = z0; out[3] = 0;
    out[4] = x1; out[5] = y1; out[6] = z1; out[7] = 0;
    out[8] = x2; out[9] = y2; out[10] = z2; out[11] = 0;
    out[12] = -(x0 * eye[0] + x1 * eye[1] + x2 * eye[2]);
    out[13] = -(y0 * eye[0] + y1 * eye[1] + y2 * eye[2]);
    out[14] = -(z0 * eye[0] + z1 * eye[1] + z2 * eye[2]);
    out[15] = 1;
    return out;
  }
  function mul(out, a, b) {
    for (var i = 0; i < 4; i++) {
      var b0 = b[i * 4], b1 = b[i * 4 + 1], b2 = b[i * 4 + 2], b3 = b[i * 4 + 3];
      out[i * 4] = b0 * a[0] + b1 * a[4] + b2 * a[8] + b3 * a[12];
      out[i * 4 + 1] = b0 * a[1] + b1 * a[5] + b2 * a[9] + b3 * a[13];
      out[i * 4 + 2] = b0 * a[2] + b1 * a[6] + b2 * a[10] + b3 * a[14];
      out[i * 4 + 3] = b0 * a[3] + b1 * a[7] + b2 * a[11] + b3 * a[15];
    }
    return out;
  }

  /* ---------- 着色器 ---------- */
  var VS = [
    'attribute vec3 aPos;',
    'attribute vec3 aNor;',
    'uniform mat4 uMVP;',
    'uniform mat4 uModel;',
    'varying vec3 vNor;',
    'varying vec3 vPos;',
    'void main(){',
    '  vec4 wp = uModel * vec4(aPos,1.0);',
    '  vPos = wp.xyz;',
    '  vNor = aNor;',
    '  gl_Position = uMVP * vec4(aPos,1.0);',
    '}'
  ].join('\n');

  var FS = [
    'precision mediump float;',
    'varying vec3 vNor;',
    'varying vec3 vPos;',
    'uniform vec3 uColor;',
    'uniform vec3 uEye;',
    'uniform float uAlpha;',
    'uniform float uRough;',
    'uniform float uCut;',
    'uniform vec3 uCutNormal;',
    'uniform float uCutPos;',
    'void main(){',
    '  vec3 n = normalize(vNor);',
    '  if (uCut > 0.5) {',
    '    float d = dot(vPos, uCutNormal) - uCutPos;',
    '    if (d > 0.0) discard;',
    '    if (d > -0.6) { gl_FragColor = vec4(0.93,0.52,0.26,1.0); return; }',
    '  }',
    '  vec3 L1 = normalize(vec3(0.55, 0.72, 0.92));',
    '  vec3 L2 = normalize(vec3(-0.6, 0.25, 0.35));',
    '  vec3 V = normalize(uEye - vPos);',
    '  float diff = max(dot(n,L1),0.0)*0.72 + max(dot(n,L2),0.0)*0.26;',
    '  vec3 H = normalize(L1+V);',
    '  float spec = pow(max(dot(n,H),0.0), mix(90.0,14.0,uRough)) * mix(0.42,0.10,uRough);',
    '  float rim = pow(1.0 - max(dot(n,V),0.0), 3.0) * 0.30;',
    '  float amb = 0.30 + 0.16*n.y;',
    '  vec3 col = uColor * (amb + diff) + vec3(spec) + vec3(0.55,0.62,0.72)*rim;',
    '  gl_FragColor = vec4(col, uAlpha);',
    '}'
  ].join('\n');

  var VS_WIRE = [
    'attribute vec3 aPos;',
    'uniform mat4 uMVP;',
    'uniform mat4 uModel;',
    'void main(){ gl_Position = uMVP * vec4(aPos,1.0); }'
  ].join('\n');
  var FS_WIRE = [
    'precision mediump float;',
    'uniform vec4 uColor;',
    'void main(){ gl_FragColor = uColor; }'
  ].join('\n');

  function compile(type, src) {
    var s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      console.error('shader: ' + gl.getShaderInfoLog(s));
      return null;
    }
    return s;
  }
  function program(vs, fs, attribs) {
    var v = compile(gl.VERTEX_SHADER, vs), f = compile(gl.FRAGMENT_SHADER, fs);
    if (!v || !f) return null;
    var p = gl.createProgram();
    gl.attachShader(p, v); gl.attachShader(p, f);
    /* 固定属性槽位，使主着色器与线框着色器可共用同一 VAO */
    if (attribs) for (var i = 0; i < attribs.length; i++) gl.bindAttribLocation(p, i, attribs[i]);
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
      console.error('link: ' + gl.getProgramInfoLog(p));
      return null;
    }
    return p;
  }

  /* ---------- 初始化 ---------- */
  function init(cv) {
    canvas = cv;
    var opts2 = { antialias: true, alpha: false, preserveDrawingBuffer: true };
    gl = canvas.getContext('webgl', opts2) || canvas.getContext('experimental-webgl', opts2);
    if (!gl) return false;
    prog = program(VS, FS, ['aPos', 'aNor']);
    progWire = program(VS_WIRE, FS_WIRE, ['aPos']);
    if (!prog || !progWire) return false;

    buf.pos = gl.createBuffer();
    buf.nor = gl.createBuffer();
    buf.idx = gl.createBuffer();
    buf.wire = gl.createBuffer();
    vao = gl.createVertexArray ? gl.createVertexArray() : null;

    gl.enable(gl.DEPTH_TEST);
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.BACK);
    gl.clearColor(0.957, 0.941, 0.914, 1);

    bindEvents();
    resize();
    return true;
  }

  /* ---------- 网格上传 ---------- */
  function setMesh(mesh) {
    if (!gl) return;
    if (vao) gl.bindVertexArray(vao);

    gl.bindBuffer(gl.ARRAY_BUFFER, buf.pos);
    gl.bufferData(gl.ARRAY_BUFFER, mesh.positions, gl.STATIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, buf.nor);
    gl.bufferData(gl.ARRAY_BUFFER, mesh.normals, gl.STATIC_DRAW);

    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, buf.idx);
    var big = mesh.indices.length > 65535;
    if (big && !gl.getExtension('OES_element_index_uint')) {
      idxCount = 0; needsDraw = true; return;
    }
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, mesh.indices, gl.STATIC_DRAW);
    idxType = big ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT;
    idxCount = mesh.indices.length;

    /* 线框索引：去重后的唯一边 */
    var seen = {}, edges = [];
    for (var i = 0; i < mesh.indices.length; i += 3) {
      var t = [mesh.indices[i], mesh.indices[i + 1], mesh.indices[i + 2]];
      for (var q = 0; q < 3; q++) {
        var a = t[q], b = t[(q + 1) % 3];
        var key = a < b ? a + '_' + b : b + '_' + a;
        if (!seen[key]) { seen[key] = 1; edges.push(a, b); }
      }
    }
    var wireArr = big ? new Uint32Array(edges) : new Uint16Array(edges);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, buf.wire);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, wireArr, gl.STATIC_DRAW);
    wireCount = edges.length;

    /* 渲染用 flat 展开缓冲：每个三角形 3 顶点各持面法向
       ⇒ 硬边（杯口环 vs 内外壁）不会互相污染法向，边缘干净 */
    var tri = mesh.triCount;
    var fp = new Float32Array(tri * 9), fn = new Float32Array(tri * 9);
    var ix = mesh.indices, P = mesh.positions, FN = mesh.faceNormals;
    for (var t = 0; t < tri; t++) {
      for (var q = 0; q < 3; q++) {
        var vi = ix[t * 3 + q] * 3, o = (t * 3 + q) * 3;
        fp[o] = P[vi]; fp[o + 1] = P[vi + 1]; fp[o + 2] = P[vi + 2];
        fn[o] = FN[t * 3]; fn[o + 1] = FN[t * 3 + 1]; fn[o + 2] = FN[t * 3 + 2];
      }
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, buf.pos);
    gl.bufferData(gl.ARRAY_BUFFER, fp, gl.STATIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, buf.nor);
    gl.bufferData(gl.ARRAY_BUFFER, fn, gl.STATIC_DRAW);

    /* 顶点属性绑定 */
    gl.bindBuffer(gl.ARRAY_BUFFER, buf.pos);
    var aPos = gl.getAttribLocation(prog, 'aPos');
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 3, gl.FLOAT, false, 0, 0);
    var aNor = gl.getAttribLocation(prog, 'aNor');
    gl.bindBuffer(gl.ARRAY_BUFFER, buf.nor);
    gl.enableVertexAttribArray(aNor);
    gl.vertexAttribPointer(aNor, 3, gl.FLOAT, false, 0, 0);

    if (vao) gl.bindVertexArray(null);
    flatCount = tri * 3;
    needsDraw = true;
  }

  /* ---------- 相机交互 ---------- */
  var drag = null;
  function bindEvents() {
    canvas.addEventListener('pointerdown', function (e) {
      canvas.setPointerCapture(e.pointerId);
      drag = { x: e.clientX, y: e.clientY, btn: e.button, shift: e.shiftKey };
      opts.autoRotate = false;
    });
    canvas.addEventListener('pointermove', function (e) {
      if (!drag) return;
      var dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      drag.x = e.clientX; drag.y = e.clientY;
      if (drag.btn === 2 || drag.shift) {
        var s = cam.dist * 0.0016;
        cam.tx -= dx * s * Math.cos(cam.yaw);
        cam.ty += dx * s * Math.sin(cam.yaw);
        cam.tz += dy * s;
      } else {
        cam.yaw += dx * 0.008;
        cam.pitch = Math.max(-1.45, Math.min(1.45, cam.pitch + dy * 0.008));
      }
      needsDraw = true;
    });
    function endDrag(e) {
      drag = null;
      if (e && e.pointerId != null && canvas.hasPointerCapture && canvas.hasPointerCapture(e.pointerId)) {
        canvas.releasePointerCapture(e.pointerId);
      }
    }
    canvas.addEventListener('pointerup', endDrag);
    canvas.addEventListener('pointercancel', endDrag);
    canvas.addEventListener('contextmenu', function (e) { e.preventDefault(); });
    canvas.addEventListener('wheel', function (e) {
      e.preventDefault();
      cam.dist = Math.max(60, Math.min(900, cam.dist * (e.deltaY > 0 ? 1.09 : 0.917)));
      needsDraw = true;
    }, { passive: false });
  }

  function resize() {
    if (!canvas || !gl) return;
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    var w = canvas.clientWidth || 480, h = canvas.clientHeight || 360;
    var W = Math.max(1, Math.round(w * dpr)), H = Math.max(1, Math.round(h * dpr));
    if (canvas.width !== W || canvas.height !== H) {
      canvas.width = W; canvas.height = H;
    }
    gl.viewport(0, 0, W, H);
    needsDraw = true;
  }

  /* ---------- 绘制 ---------- */
  var mProj = mat4(), mView = mat4(), mModel = mat4(), mVP = mat4();
  var mNormal = new Float32Array(9);

  function draw(now) {
    if (!gl) return;
    var t = now || 0;
    if (opts.autoRotate) {
      var dt = lastFrame ? (t - lastFrame) / 1000 : 0;
      lastFrame = t;
      cam.yaw += dt * 0.55;
      needsDraw = true;
    } else lastFrame = 0;

    if (!needsDraw && !opts.autoRotate) return;
    needsDraw = false;

    var W = canvas.width, H = canvas.height;
    gl.viewport(0, 0, W, H);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    if (!idxCount) return;

    var aspect = W / H;
    /* 动态 near/far：范围紧贴模型，避免大深度比导致 Z-fighting（表面撕裂） */
    var near = Math.max(0.5, cam.dist - modelR * 2.6);
    var far = cam.dist + modelR * 3.2;
    perspective(mProj, 0.62, aspect, near, far);
    var cp = Math.cos(cam.pitch), sp = Math.sin(cam.pitch);
    var eye = [
      cam.tx + cam.dist * cp * Math.sin(cam.yaw),
      cam.ty + cam.dist * cp * Math.cos(cam.yaw),
      cam.tz + cam.dist * sp
    ];
    lookAt(mView, eye, [cam.tx, cam.ty, cam.tz], [0, 0, 1]);
    /* 模型矩阵：单位阵（几何已居中于自身坐标系） */
    mModel[0] = 1; mModel[1] = 0; mModel[2] = 0; mModel[3] = 0;
    mModel[4] = 0; mModel[5] = 1; mModel[6] = 0; mModel[7] = 0;
    mModel[8] = 0; mModel[9] = 0; mModel[10] = 1; mModel[11] = 0;
    mModel[12] = 0; mModel[13] = 0; mModel[14] = 0; mModel[15] = 1;
    /* MVP = P · V · M */
    var mPV = mat4();
    mul(mPV, mProj, mView);
    mul(mVP, mPV, mModel);
    mNormal[0] = 1; mNormal[1] = 0; mNormal[2] = 0;
    mNormal[3] = 0; mNormal[4] = 1; mNormal[5] = 0;
    mNormal[6] = 0; mNormal[7] = 0; mNormal[8] = 1;

    gl.useProgram(prog);
    gl.uniformMatrix4fv(gl.getUniformLocation(prog, 'uMVP'), false, mVP);
    gl.uniformMatrix4fv(gl.getUniformLocation(prog, 'uModel'), false, mModel);
    gl.uniform3f(gl.getUniformLocation(prog, 'uColor'),
      opts.matColor[0], opts.matColor[1], opts.matColor[2]);
    gl.uniform3f(gl.getUniformLocation(prog, 'uEye'), eye[0], eye[1], eye[2]);
    gl.uniform1f(gl.getUniformLocation(prog, 'uAlpha'), opts.transparent ? 0.42 : 1.0);
    gl.uniform1f(gl.getUniformLocation(prog, 'uRough'), opts.matRough);
    gl.uniform1f(gl.getUniformLocation(prog, 'uCut'), opts.section ? 1 : 0);
    /* 剖切面始终垂直于视线方向，随相机旋转；offset=0 时过回转轴 */
    var cn = [Math.sin(cam.yaw), Math.cos(cam.yaw), 0];
    gl.uniform3f(gl.getUniformLocation(prog, 'uCutNormal'), cn[0], cn[1], cn[2]);
    gl.uniform1f(gl.getUniformLocation(prog, 'uCutPos'),
      cam.tx * cn[0] + cam.ty * cn[1] + opts.sectionOffset);

    if (opts.transparent) { gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); gl.depthMask(false); }
    else { gl.disable(gl.BLEND); gl.depthMask(true); }

    if (vao) gl.bindVertexArray(vao);
    else {
      gl.bindBuffer(gl.ARRAY_BUFFER, buf.pos);
      var aPos = gl.getAttribLocation(prog, 'aPos');
      gl.enableVertexAttribArray(aPos);
      gl.vertexAttribPointer(aPos, 3, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, buf.nor);
      var aNor = gl.getAttribLocation(prog, 'aNor');
      gl.enableVertexAttribArray(aNor);
      gl.vertexAttribPointer(aNor, 3, gl.FLOAT, false, 0, 0);
    }
    gl.drawArrays(gl.TRIANGLES, 0, flatCount);

    if (opts.wire && wireCount) {
      gl.useProgram(progWire);
      gl.uniformMatrix4fv(gl.getUniformLocation(progWire, 'uMVP'), false, mVP);
      gl.uniformMatrix4fv(gl.getUniformLocation(progWire, 'uModel'), false, mModel);
      gl.uniform4f(gl.getUniformLocation(progWire, 'uColor'), 0.28, 0.19, 0.12, 0.30);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.depthMask(false);
      if (vao) gl.bindVertexArray(vao);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, buf.wire);
      gl.drawElements(gl.LINES, wireCount, idxType, 0);
      gl.depthMask(true);
      gl.disable(gl.BLEND);
    }

    if (vao) gl.bindVertexArray(null);
    gl.depthMask(true);
  }

  function loop(now) {
    draw(now);
    running = true;
    requestAnimationFrame(loop);
  }

  function start() {
    if (running) return;
    running = true;
    requestAnimationFrame(loop);
  }

  /* ---------- 对外接口 ---------- */
  function setOption(k, v) {
    if (k === 'autoRotate') opts.autoRotate = v;
    else opts[k] = v;
    needsDraw = true;
  }
  function getOption(k) { return opts[k]; }

  function frameModel(mesh) {
    if (!mesh) return;
    var bb = [1e9, 1e9, 1e9, -1e9, -1e9, -1e9];
    var p = mesh.positions;
    for (var i = 0; i < p.length; i += 3) {
      if (p[i] < bb[0]) bb[0] = p[i]; if (p[i] > bb[3]) bb[3] = p[i];
      if (p[i + 1] < bb[1]) bb[1] = p[i + 1]; if (p[i + 1] > bb[4]) bb[4] = p[i + 1];
      if (p[i + 2] < bb[2]) bb[2] = p[i + 2]; if (p[i + 2] > bb[5]) bb[5] = p[i + 2];
    }
    cam.tx = (bb[0] + bb[3]) / 2;
    cam.ty = (bb[1] + bb[4]) / 2;
    cam.tz = (bb[2] + bb[5]) / 2;
    /* 依包围盒与视场角求合适距离，让模型占画面约 78% */
    var sizeH = bb[5] - bb[2], sizeR = Math.max(bb[3] - bb[0], bb[4] - bb[1]) / 2;
    var aspect = (canvas.clientWidth || 640) / (canvas.clientHeight || 420);
    var fov = 0.62;
    var distV = (sizeH / 2) / Math.tan(fov / 2);
    var distH = (sizeR * 1.3) / (Math.tan(fov / 2) * Math.max(0.55, aspect));
    cam.dist = Math.max(60, Math.max(distV, distH) * 1.28);
    modelR = Math.max(sizeH / 2, sizeR) * 1.15 + 10;
    opts.sectionPos = 0;
    needsDraw = true;
  }

  return {
    init: init,
    setMesh: setMesh,
    frameModel: frameModel,
    start: start,
    resize: resize,
    setOption: setOption,
    getOption: getOption,
    invalidate: function () { needsDraw = true; },
    getCamera: function () { return cam; }
  };
})();
if (typeof module !== 'undefined' && module.exports) module.exports = VIEW3D;
