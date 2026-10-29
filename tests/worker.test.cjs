const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {createCanvas}=require('@napi-rs/canvas');
const dist=path.join(__dirname,'../dist');
test('real Worker entry loads its dependencies and returns colored JSON-ready paths',()=>{
  const replies=[],context=vm.createContext({postMessage:reply=>replies.push(reply)});
  context.self=context;
  context.importScripts=(...names)=>names.forEach(name=>vm.runInContext(fs.readFileSync(path.join(dist,name),'utf8'),context));
  vm.runInContext(fs.readFileSync(path.join(dist,'music-format.js'),'utf8'),context);
  vm.runInContext(fs.readFileSync(path.join(dist,'worker.js'),'utf8'),context);
  const canvas=createCanvas(160,80),ctx=canvas.getContext('2d');
  ctx.fillStyle='#fff';ctx.fillRect(0,0,160,80);ctx.lineWidth=6;
  for(const [y,color] of [[20,'#00B5B8'],[60,'#FFF0A8']]){ctx.strokeStyle=color;ctx.beginPath();ctx.moveTo(10,y);ctx.lineTo(150,y);ctx.stroke();}
  const imageData=ctx.getImageData(0,0,160,80);
  context.onmessage({data:{id:12,imageData,options:{colorAware:true,autoColors:true,palette:context.MusicFormat.PALETTE,minPathLength:0}}});
  assert.equal(replies[0].id,12);assert(!replies[0].error);
  const paths=replies[0].result.coloredPaths;
  assert(paths.some(p=>p.instrument==='ELECTRONIC_BASS'));
  assert(paths.some(p=>p.instrument==='MARIMBA'));
  context.onmessage({data:{id:13,imageData:{width:0,height:1,data:[]},options:{}}});
  assert.equal(replies[1].id,13);assert.equal(typeof replies[1].error,'string');
});
