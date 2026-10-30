/**
 * 扩展几何校验（16 个场景：分段导水槽 / 铣槽 / 极端杯型）
 *
 * 用法（在仓库根目录执行）：
 *     node tools/check_geometry.js
 *
 * 判据：每条无向边恰被 2 个三角形共用（开放边=0、非流形=0）；
 *       每条有向边恰出现 1 次（定向无冲突）；法向与绕序 100% 一致；无退化三角形。
 */
global.window = global;
require('../src/js/earcut.js');
global.MODEL = require('../src/js/model_base.js');
const PRINT = require('../src/js/print3.js');

function validate(mesh){
  const p=mesh.positions, ix=mesh.indices;
  const edges={}; let degen=0;
  for(let i=0;i<ix.length;i+=3){
    const a=ix[i],b=ix[i+1],c=ix[i+2];
    if(a===b||b===c||a===c){degen++;continue;}
    for(const q of [[a,b],[b,c],[c,a]]){const k=q[0]<q[1]?q[0]+'_'+q[1]:q[1]+'_'+q[0];edges[k]=(edges[k]||0)+1;}
  }
  let open=0,over=0;
  for(const k in edges){ if(edges[k]===1)open++; else if(edges[k]>2)over++; }
  // 有向边一致性：正确定向的闭合流形中，每条有向边恰出现 1 次
  const dir=new Map();
  for(let i=0;i<ix.length;i+=3){
    const t=[ix[i],ix[i+1],ix[i+2]];
    for(let q=0;q<3;q++){ const k=t[q]+'>'+t[(q+1)%3]; dir.set(k,(dir.get(k)||0)+1); }
  }
  let dconf=0; for(const v of dir.values()) if(v>1) dconf++;
  let vol=0;
  for(let i=0;i<ix.length;i+=3){
    const a=ix[i]*3,b=ix[i+1]*3,c=ix[i+2]*3;
    vol += (p[a]*(p[b+1]*p[c+2]-p[b+2]*p[c+1])-p[a+1]*(p[b]*p[c+2]-p[b+2]*p[c])+p[a+2]*(p[b]*p[c+1]-p[b+1]*p[c]))/6;
  }
  // 法向一致性
  let bad=0; const fn=mesh.faceNormals;
  for(let t=0;t<mesh.triCount;t++){
    const i=t*3,a=ix[i]*3,b=ix[i+1]*3,c=ix[i+2]*3;
    const u=[p[b]-p[a],p[b+1]-p[a+1],p[b+2]-p[a+2]];
    const v=[p[c]-p[a],p[c+1]-p[a+1],p[c+2]-p[a+2]];
    const g=[u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]];
    const L=Math.hypot(g[0],g[1],g[2]); if(L<1e-12)continue;
    if((g[0]*fn[i]+g[1]*fn[i+1]+g[2]*fn[i+2])/L<0)bad++;
  }
  return {open,over,degen,dconf,vol:vol/1000,bad,tri:mesh.triCount};
}

let fail=0;
console.log('case                     tris    open over degen dconf   vol(cm3) normalBad  grooves');
function run(name,S){
  const geo=MODEL.buildGeometry(S);
  const M=PRINT.buildMesh(S,geo);
  const v=validate(M);
  const ok=v.open===0&&v.over===0&&v.degen===0&&v.dconf===0&&v.vol>0&&v.bad===0;
  if(!ok)fail++;
  console.log((ok?'  OK  ':' FAIL ')+name.padEnd(22), String(v.tri).padStart(6),
    String(v.open).padStart(6), String(v.over).padStart(4), String(v.degen).padStart(5),
    String(v.dconf).padStart(5),
    v.vol.toFixed(1).padStart(9), String(v.bad).padStart(8), String(M.ribStats.grooveCount).padStart(7),
    ' style='+S.ribStyle);
}
const base=JSON.parse(JSON.stringify(MODEL.PRESETS[0].S));
run('锥形 默认', base);
run('锥形 无导水槽', Object.assign(JSON.parse(JSON.stringify(base)),{ribStyle:'none'}));
run('锥形 分段模式', Object.assign(JSON.parse(JSON.stringify(base)),{ribSegMode:'seg',ribSegs:[
 {shape:'spiral',z0:0,z1:45,count:6,width:2.2,depth:1.1,turns:1},
 {shape:'straight',z0:45,z1:90,count:5,width:2.2,depth:1.1,turns:1},
 {shape:'none',z0:90,z1:130,count:0,width:0,depth:0,turns:1}]}));
// 真实三段：螺旋(12) / 直肋(8，更宽更高) / 光壁 —— 条数与宽高都不同
run('锥形 三段真实', Object.assign(JSON.parse(JSON.stringify(base)),{ribSegMode:'seg',ribSegs:[
 {shape:'spiral',z0:0,z1:38,count:12,width:2.2,depth:1.1,turns:1.5},
 {shape:'straight',z0:38,z1:66,count:8,width:2.4,depth:1.4,turns:1},
 {shape:'none',z0:66,z1:90.9,count:0,width:0,depth:0,turns:1}]}));
// 两段同条数同角度：接缝处应无缝合并
run('锥形 两段同规格', Object.assign(JSON.parse(JSON.stringify(base)),{ribSegMode:'seg',ribSegs:[
 {shape:'spiral',z0:0,z1:40,count:12,width:2.2,depth:1.1,turns:0.5},
 {shape:'spiral',z0:40,z1:80,count:12,width:2.2,depth:1.1,turns:0.5}]}));
// 直肋接直肋，条数不同
run('锥形 直肋接直肋', Object.assign(JSON.parse(JSON.stringify(base)),{ribSegMode:'seg',ribSegs:[
 {shape:'straight',z0:0,z1:45,count:6,width:2.0,depth:1.0,turns:1},
 {shape:'straight',z0:45,z1:90,count:10,width:2.0,depth:1.0,turns:1}]}));
run('平底 径向铣槽', JSON.parse(JSON.stringify(MODEL.PRESETS[1].S)));
run('平底 铣槽 深槽', Object.assign(JSON.parse(JSON.stringify(MODEL.PRESETS[1].S)),{ribDepth:2.4,floorThk:4}));
run('直筒 铣槽', JSON.parse(JSON.stringify(MODEL.PRESETS[5].S)));
run('锥形 粗螺旋', Object.assign(JSON.parse(JSON.stringify(base)),{ribCount:20,ribWidth:2.5,ribDepth:1.4,ribTurns:2.5}));
run('锥形 细密', Object.assign(JSON.parse(JSON.stringify(base)),{ribCount:8,ribWidth:1.6,ribDepth:0.8,ribTurns:1}));
run('薄壁 锥形', Object.assign(JSON.parse(JSON.stringify(base)),{wall:1.2}));
run('大锥角', Object.assign(JSON.parse(JSON.stringify(base)),{coneAngle:80}));
run('小锥角', Object.assign(JSON.parse(JSON.stringify(base)),{coneAngle:25}));
run('中心大孔', Object.assign(JSON.parse(JSON.stringify(base)),{holeD:30,holeLayout:'single'}));
run('孔环密集', Object.assign(JSON.parse(JSON.stringify(base)),{holeLayout:'ring',holeCount:12,holeD:3,ringR:14}));
console.log(fail? fail+' FAILED':'ALL PASS');
