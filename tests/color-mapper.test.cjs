const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createCanvas } = require('@napi-rs/canvas');
for (const file of ['music-format.js', 'vectorizer.js', 'color-mapper.js']) {
  vm.runInThisContext(fs.readFileSync(path.join(__dirname, '../dist', file), 'utf8'));
}
const F = MusicFormat, C = OutlineColors, V = OutlineVectorizer;
const palette = F.PALETTE;
function image(width = 240, height = 100) {
  const canvas = createCanvas(width, height), ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0,0,width,height);
  ctx.lineWidth = 7; ctx.lineCap = 'butt';
  return { canvas, ctx, data: () => ctx.getImageData(0,0,width,height) };
}
function line(ctx, color, x0, x1, y = 50) {
  ctx.strokeStyle = color; ctx.beginPath(); ctx.moveTo(x0,y); ctx.lineTo(x1,y); ctx.stroke();
}
function mapped(color) {
  const im = image(); line(im.ctx,color,10,230);
  return C.colorize([[[.05,.5],[.95,.5]]], im.data(),{palette}).paths;
}
function length(paths) {
  return paths.reduce((total,path) => total + path.points.slice(1).reduce((sum,p,i) => sum + Math.hypot(p[0]-path.points[i][0],p[1]-path.points[i][1]),0),0);
}
test('all exact custom palette colors map back to their original instruments', () => {
  for (const color of palette) assert.deepEqual([...new Set(mapped(color.color).map(p=>p.instrument))],[color.id],color.id);
});
test('saturated teal and blue preserve hue instead of preferring saturation of unrelated pastels', () => {
  assert.equal(mapped('#00B5B8')[0].instrument,'ELECTRONIC_BASS');
  assert(['CHIME','SAXOPHONE','FLUTE'].includes(mapped('#339FFF')[0].instrument));
  assert.equal(mapped('#FF505D')[0].instrument,'STRINGS');
  assert.equal(mapped('#FF8E21')[0].instrument,'WARM_SYNTH');
  assert.equal(mapped('#FFB80C')[0].instrument,'MARIMBA');
});
test('one simplified segment with three source colors splits without changing geometry', () => {
  const im=image();line(im.ctx,'#FF505D',10,80);line(im.ctx,'#00B5B8',80,160);line(im.ctx,'#7D64FF',160,230);
  const input=[{points:[[10/240,.5],[230/240,.5]],instrument:'MARIMBA',tool:'BRUSH'}];
  const result=C.colorize(input,im.data(),{palette});
  assert.equal(result.paths.length,3);
  assert.equal(result.paths[0].instrument,'STRINGS');
  assert.equal(result.paths[1].instrument,'ELECTRONIC_BASS');
  assert(Math.abs(length(input)-length(result.paths))<1e-10);
  for (let i=1;i<result.paths.length;i++) assert.deepEqual(result.paths[i-1].points.at(-1),result.paths[i].points[0]);
  assert.deepEqual(F.validateProject(F.makeProject(result.paths)).errors,[]);
});
test('bright yellow above grayscale threshold survives color-aware tracing', () => {
  const im=image();line(im.ctx,'#FFF0A8',10,230);
  const gray=V.vectorize(im.data(),{threshold:180,minPathLength:0});
  const color=V.vectorize(im.data(),{threshold:180,minPathLength:0,colorAware:true});
  assert.equal(gray.paths.length,0);assert(color.paths.length>0);
  const result=C.colorize(color.paths,im.data(),{palette});
  assert(result.paths.every(p=>p.instrument==='MARIMBA'));
});
test('short antialias-like color speckles do not fragment a long uniform run', () => {
  const im=image();line(im.ctx,'#339FFF',10,230);
  im.ctx.fillStyle='#FF505D';im.ctx.fillRect(100,46,2,8);
  const result=C.colorize([[[10/240,.5],[230/240,.5]]],im.data(),{palette,minRunLength:5});
  assert.equal(result.paths.length,1);
});
test('closed loop remains closed and neutral strokes disclose the palette limitation', () => {
  const im=image(120,120);im.ctx.strokeStyle='#00B5B8';im.ctx.beginPath();im.ctx.arc(60,60,36,0,Math.PI*2);im.ctx.stroke();
  const traced=V.vectorize(im.data(),{colorAware:true,simplify:.5,minPathLength:0});
  const result=C.colorize(traced.paths,im.data(),{palette});
  assert.equal(result.paths.length,1);assert.deepEqual(result.paths[0].points[0],result.paths[0].points.at(-1));
  const black=image();line(black.ctx,'#404040',10,230);
  const neutral=C.colorize([[[.05,.5],[.95,.5]]],black.data(),{palette});
  assert.equal(neutral.paths[0].instrument,'BASS');assert(neutral.warnings.some(w=>w.includes('đen/xám')));
});
test('blank and transparent images remain empty and malformed inputs fail boundedly', () => {
  const im=image();assert.equal(V.vectorize(im.data(),{colorAware:true}).paths.length,0);
  im.ctx.clearRect(0,0,240,100);assert.equal(V.vectorize(im.data(),{colorAware:true}).paths.length,0);
  assert.throws(()=>C.colorize([[[NaN,.5]]],im.data(),{palette}));
  assert.throws(()=>C.colorize([],im.data(),{palette:[{id:'X',color:'not a color'}]}));
});
