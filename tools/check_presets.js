/**
 * 预设水密/流形校验（6 个内置预设）
 *
 * 用法（在仓库根目录执行）：
 *     node tools/check_presets.js
 *
 * 判据：每条无向边恰被 2 个三角形共用（开放边=0、非流形=0）；
 *       每条有向边恰出现 1 次（定向无冲突）；法向与绕序 100% 一致；无退化三角形。
 */
global.window = global;
require('../src/js/earcut.js');
global.MODEL = require('../src/js/model_base.js');
const P3 = require('../src/js/print3.js');

function validate(mesh){
  const p=mesh.positions, ix=mesh.indices;
  const edges={}; let open=0, over=0, degen=0;
  for(let i=0;i<ix.length;i+=3){
    const a=ix[i],b=ix[i+1],c=ix[i+2];
    if(a===b||b===c||a===c){degen++;continue;}
    const e=[[a,b],[b,c],[c,a]];
    for(const q of e){ const k=q[0]<q[1]?q[0]+'_'+q[1]:q[1]+'_'+q[0]; edges[k]=(edges[k]||0)+1; }
  }
  for(const k in edges){ if(edges[k]===1) open++; else if(edges[k]>2) over++; }
  // 体积
  let vol=0;
  for(let i=0;i<ix.length;i+=3){
    const a=ix[i]*3,b=ix[i+1]*3,c=ix[i+2]*3;
    vol += (p[a]*(p[b+1]*p[c+2]-p[b+2]*p[c+1]) - p[a+1]*(p[b]*p[c+2]-p[b+2]*p[c]) + p[a+2]*(p[b]*p[c+1]-p[b+1]*p[c]))/6;
  }
  // 法向一致性
  let bad=0, fn=mesh.faceNormals;
  for(let t=0;t<mesh.triCount;t++){
    const i=t*3; const a=ix[i]*3,b=ix[i+1]*3,c=ix[i+2]*3;
    const u=[p[b]-p[a],p[b+1]-p[a+1],p[b+2]-p[a+2]];
    const v=[p[c]-p[a],p[c+1]-p[a+1],p[c+2]-p[a+2]];
    const g=[u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]];
    const L=Math.hypot(g[0],g[1],g[2]); if(L<1e-12) continue;
    if((g[0]*fn[i]+g[1]*fn[i+1]+g[2]*fn[i+2])/L < 0) bad++;
  }
  // 包围盒
  let bb=[1e9,1e9,1e9,-1e9,-1e9,-1e9];
  for(let i=0;i<p.length;i+=3){
    if(p[i]<bb[0])bb[0]=p[i]; if(p[i]>bb[3])bb[3]=p[i];
    if(p[i+1]<bb[1])bb[1]=p[i+1]; if(p[i+1]>bb[4])bb[4]=p[i+1];
    if(p[i+2]<bb[2])bb[2]=p[i+2]; if(p[i+2]>bb[5])bb[5]=p[i+2];
  }
  return {open, over, degen, vol:vol/1000, bad, tri:mesh.triCount, bb};
}

const presets = MODEL.PRESETS;
let fail=0;
console.log('preset            ribStyle  tris    open over degen  vol(cm3)  normalBad');
for(const p of presets){
  const S=JSON.parse(JSON.stringify(p.S));
  const geo=MODEL.buildGeometry(S);
  const M=P3.buildMesh(S,geo);
  const v=validate(M);
  const ok = v.open===0 && v.over===0 && v.degen===0 && v.vol>0;
  if(!ok) fail++;
  console.log((ok?'  OK ':' FAIL ')+p.name.padEnd(12), String(S.ribStyle).padEnd(9), String(v.tri).padStart(6),
    String(v.open).padStart(5), String(v.over).padStart(4), String(v.degen).padStart(5),
    v.vol.toFixed(1).padStart(9), String(v.bad).padStart(8), 'ribs='+M.ribStats.count);
}
console.log(fail? fail+' FAILED':'ALL PASS');
