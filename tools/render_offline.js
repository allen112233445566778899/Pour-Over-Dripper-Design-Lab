// 用简易正交投影 + 画家算法把网格渲染成 PNG（无 WebGL 依赖），用于离线目视检查
global.window = global;
require('../src/js/earcut.js');
global.MODEL = require('../src/js/model_base.js');
const P3 = require('../src/js/print3.js');
const fs = require('fs');
const zlib = require('zlib');

function renderPNG(mesh, W, H, file, yaw, pitch, opts){
  const p=mesh.positions, ix=mesh.indices, fn=mesh.faceNormals;
  const bb=[1e9,1e9,1e9,-1e9,-1e9,-1e9];
  for(let i=0;i<p.length;i+=3){
    if(p[i]<bb[0])bb[0]=p[i]; if(p[i]>bb[3])bb[3]=p[i];
    if(p[i+1]<bb[1])bb[1]=p[i+1]; if(p[i+1]>bb[4])bb[4]=p[i+1];
    if(p[i+2]<bb[2])bb[2]=p[i+2]; if(p[i+2]>bb[5])bb[5]=p[i+2];
  }
  const cx=(bb[0]+bb[3])/2, cy=(bb[1]+bb[4])/2, cz=(bb[2]+bb[5])/2;
  const size=Math.max(bb[3]-bb[0], bb[4]-bb[1], bb[5]-bb[2]);
  const scale=Math.min(W,H)*0.8/size;
  const cy1=Math.cos(yaw), sy1=Math.sin(yaw), cp=Math.cos(pitch), sp=Math.sin(pitch);
  function proj(x,y,z){
    const X=x-cx, Y=y-cy, Z=z-cz;
    // yaw 绕 Z，pitch 绕 X
    const rx = X*cy1 - Y*sy1, ry = X*sy1 + Y*cy1, rz = Z;
    const ry2 = ry*cp + rz*sp, rz2 = -ry*sp + rz*cp;
    return [W/2 + rx*scale, H/2 - ry2*scale, rz2];
  }
  const px = Buffer.alloc(W*H*3, 255);
  const zbuf = new Float64Array(W*H).fill(Infinity);
  const tris=[];
  for(let t=0;t<mesh.triCount;t++){
    const i=t*3;
    if(opts&&opts.cut){
      const ccy=(p[ix[i]*3+1]+p[ix[i+1]*3+1]+p[ix[i+2]*3+1])/3-cy;
      if(ccy>0) continue;   // 剖切：去掉近侧一半，露出内壁
    }
    const a=proj(p[ix[i]*3],p[ix[i]*3+1],p[ix[i]*3+2]);
    const b=proj(p[ix[i+1]*3],p[ix[i+1]*3+1],p[ix[i+1]*3+2]);
    const c=proj(p[ix[i+2]*3],p[ix[i+2]*3+1],p[ix[i+2]*3+2]);
    const depth=(a[2]+b[2]+c[2])/3;
    const nx=fn[i],ny=fn[i+1],nz=fn[i+2];
    // 变换到相机空间算光照
    const lx=nx*cy1-ny*sy1, ly=nx*sy1+ny*cy1, lz=nz;
    const ly2=ly*cp+lz*sp, lz2=-ly*sp+lz*cp;
    const L1=[0.5,0.6,0.62];
    const diff=Math.max(0, lx*L1[0]+ly2*L1[1]+lz2*L1[2]);
    const amb=0.34;
    const sh=Math.min(1, amb+0.72*diff);
    tris.push({a,b,c,depth,sh});
  }
  tris.sort((u,v)=>v.depth-u.depth);
  for(const t of tris){
    // 光栅化
    const {a,b,c}=t;
    const minX=Math.max(0,Math.floor(Math.min(a[0],b[0],c[0]))), maxX=Math.min(W-1,Math.ceil(Math.max(a[0],b[0],c[0])));
    const minY=Math.max(0,Math.floor(Math.min(a[1],b[1],c[1]))), maxY=Math.min(H-1,Math.ceil(Math.max(a[1],b[1],c[1])));
    const d=(b[1]-c[1])*(a[0]-c[0])+(c[0]-b[0])*(a[1]-c[1]);
    if(Math.abs(d)<1e-9) continue;
    for(let y=minY;y<=maxY;y++) for(let x=minX;x<=maxX;x++){
      const w0=((b[1]-c[1])*(x+0.5-c[0])+(c[0]-b[0])*(y+0.5-c[1]))/d;
      const w1=((c[1]-a[1])*(x+0.5-c[0])+(a[0]-c[0])*(y+0.5-c[1]))/d;
      const w2=1-w0-w1;
      if(w0<0||w1<0||w2<0) continue;
      const z=a[2]*w2+b[2]*w1+c[2]*w0;
      const idx=y*W+x;
      if(z>=zbuf[idx]) continue;
      zbuf[idx]=z;
      const v=Math.round(255*Math.min(1,Math.max(0,t.sh)));
      px[idx*3]=Math.round(v*0.93); px[idx*3+1]=Math.round(v*0.87); px[idx*3+2]=Math.round(v*0.78);
    }
  }
  // PNG 编码
  const raw=Buffer.alloc((W*3+1)*H);
  for(let y=0;y<H;y++){ raw[y*(W*3+1)]=0; px.copy(raw, y*(W*3+1)+1, y*W*3, (y+1)*W*3); }
  const idat=zlib.deflateSync(raw);
  function chunk(type,data){
    const len=Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td=Buffer.concat([Buffer.from(type,'ascii'),data]);
    const crc=Buffer.alloc(4); crc.writeUInt32BE(crc32buf(td)>>>0);
    return Buffer.concat([len,td,crc]);
  }
  let tbl=null;
  function crc32buf(buf){ if(!tbl){tbl=[];for(let n=0;n<256;n++){let c=n;for(let k=0;k<8;k++)c=c&1?0xEDB88320^(c>>>1):c>>>1;tbl[n]=c>>>0;}} let c=0xFFFFFFFF; for(const b of buf)c=tbl[(c^b)&0xFF]^(c>>>8); return (c^0xFFFFFFFF)>>>0; }
  const ihdr=Buffer.alloc(13); ihdr.writeUInt32BE(W,0); ihdr.writeUInt32BE(H,4); ihdr[8]=8; ihdr[9]=2;
  const png=Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk('IHDR',ihdr), chunk('IDAT',idat), chunk('IEND',Buffer.alloc(0))]);
  fs.writeFileSync(file,png);
}

const S=JSON.parse(JSON.stringify(MODEL.PRESETS[0].S));
const geo=MODEL.buildGeometry(S);
const M=P3.buildMesh(S,geo);
renderPNG(M,760,760,'../../build/render_top.png', 0.6, 1.15);
renderPNG(M,760,760,'../../build/render_side.png', 0.6, 0.35);
renderPNG(M,760,760,'../../build/render_cut1.png', 0.35, 0.55, {cut:true});
renderPNG(M,760,760,'../../build/render_cut2.png', 0.35, 1.05, {cut:true});
console.log('rendered, ribs=',M.ribStats.count);
