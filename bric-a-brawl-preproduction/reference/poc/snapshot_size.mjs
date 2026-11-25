// Proof-of-concept: real msgpackr sizes for quantized snapshots and input packets.
import { Packr } from 'msgpackr';
const packr = new Packr({ useRecords: false, variableMapSize: true });
function mulberry32(a){return function(){a|=0;a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296}}
const rnd=mulberry32(11);
const q=(v,s)=>Math.round(v*s);
const POS=64, VEL=8, ROT=256/ (2*Math.PI); // 1/64 u, 1/8 u/s, 1/256 turn
function player(){ return [ q(rnd()*40-20,POS), q(rnd()*20-6,POS), q(rnd()*40-20,VEL), q(rnd()*40-20,VEL),
  Math.floor(rnd()*48), Math.floor(rnd()*60), Math.floor(rnd()*256), q(rnd()*180,10), Math.floor(rnd()*50), Math.floor(rnd()*100), Math.floor(rnd()*4)*16+Math.floor(rnd()*10), Math.floor(rnd()*8) ]; }
// fields: x,y,vx,vy,state,stateFrame,flags,damage(0.1%),guard,gilt,stocks<<4|item,charSpecific
const chunk =()=>[Math.floor(rnd()*24), q(rnd()*30-15,POS), q(rnd()*16-10,POS), q(rnd()*6.28,ROT)&255, q(rnd()*20-10,VEL), q(rnd()*30-25,VEL), q(rnd()*8-4,16)];
const rubble=()=>[Math.floor(rnd()*64), q(rnd()*30-15,POS), q(rnd()*16-10,POS), q(rnd()*6.28,ROT)&255, q(rnd()*30-15,VEL), q(rnd()*30-20,VEL)];
const gadget=()=>[Math.floor(rnd()*32), Math.floor(rnd()*9), q(rnd()*30-15,POS), q(rnd()*16-6,POS), q(rnd()*6.28,ROT)&255, q(rnd()*20-10,VEL), q(rnd()*20-10,VEL), Math.floor(rnd()*7)];
const proj  =()=>[Math.floor(rnd()*255), Math.floor(rnd()*12), q(rnd()*40-20,POS), q(rnd()*20-6,POS), q(rnd()*60-30,VEL), q(rnd()*40-20,VEL)];
const rep=(n,f)=>Array.from({length:n},f);
function snap(nP,nC,nR,nG,nJ,withWorld){ const s=[ 43210, rep(nP,()=>43200+Math.floor(rnd()*8)), rep(nP,player), rep(nJ,proj) ];
  if(withWorld) s.push(rep(nC,chunk), rep(nR,rubble), rep(nG,gadget)); return s; }
function avg(f,n=400){let t=0;for(let i=0;i<n;i++)t+=packr.pack(f()).length;return t/n;}
const OVERHEAD=85; // bytes/packet estimate: IPv4 20 + UDP 8 + DTLS ~29 + SCTP 12 + DATA chunk 16
const cases={
  'players-only snapshot (8 players, 4 projectiles)':()=>snap(8,0,0,0,4,false),
  'typical full snapshot (8p, 2 chunks, 6 rubble, 3 gadgets, 4 proj)':()=>snap(8,2,6,3,4,true),
  'worst-case full snapshot (8p, 6 chunks, 16 rubble, 8 gadgets, 12 proj)':()=>snap(8,6,16,8,12,true),
  'worst-case players-only (8p, 12 proj)':()=>snap(8,0,0,0,12,false),
};
const R={}; for(const [k,f] of Object.entries(cases)){ R[k]=avg(f); console.log(k.padEnd(72), R[k].toFixed(0),'B'); }
const inp=()=>[43210&0xffff, Math.floor(rnd()*65536), Math.floor(rnd()*65536), Math.floor(rnd()*65536), Math.floor(rnd()*65536)];
const inB=avg(inp); console.log('input packet (tick16 + 4 redundant 16-bit masks)'.padEnd(72), inB.toFixed(0),'B');
// Budget: 30 Hz snapshots; world state rides on every other snapshot (15 Hz).
function down(pOnly,full){ const payload=15*pOnly+15*full; return {payload, wire:payload+30*OVERHEAD}; }
const typ=down(R['players-only snapshot (8 players, 4 projectiles)'],R['typical full snapshot (8p, 2 chunks, 6 rubble, 3 gadgets, 4 proj)']);
const wor=down(R['worst-case players-only (8p, 12 proj)'],R['worst-case full snapshot (8p, 6 chunks, 16 rubble, 8 gadgets, 12 proj)']);
const up={payload:60*inB, wire:60*(inB+OVERHEAD)};
const kb=b=>(b/1000).toFixed(1)+' kB/s ('+(b*8/1000).toFixed(0)+' kbit/s)';
console.log('\nPER CLIENT download typical :',kb(typ.wire),' payload only',kb(typ.payload));
console.log('PER CLIENT download worst   :',kb(wor.wire),' payload only',kb(wor.payload));
console.log('PER CLIENT upload (60 Hz)   :',kb(up.wire),' payload only',kb(up.payload));
console.log('HOST upload, 7 clients typ  :',kb(7*typ.wire),'| worst',kb(7*wor.wire));
console.log('HOST download, 7 clients    :',kb(7*up.wire));
// encode cost
const big=snap(8,6,16,8,12,true); let a=performance.now(); for(let i=0;i<20000;i++) packr.pack(big); const enc=(performance.now()-a)/20000;
const buf=packr.pack(big); a=performance.now(); for(let i=0;i<20000;i++) packr.unpack(buf); const dec=(performance.now()-a)/20000;
console.log('\nencode worst-case snapshot',(enc*1000).toFixed(1),'µs | decode',(dec*1000).toFixed(1),'µs');
