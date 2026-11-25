// Proof-of-concept: Rapier2D headless in Node on a 2-vCPU box.
// Scene sized to the game's physics budget: 24 terrain chunks, 6 falling chunks,
// 16 rubble, 8 gadgets, 12 projectiles, 8 kinematic characters with a character controller.
import { createHash } from 'node:crypto';
const pkg = process.argv[2] || '@dimforge/rapier2d-compat';
const RAPIER = (await import(pkg)).default;
await RAPIER.init();
function mulberry32(a){return function(){a|=0;a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296}}
function build(seed){
  const rnd = mulberry32(seed);
  const world = new RAPIER.World({x:0,y:-53.6});
  world.timestep = 1/60;
  // 24 static terrain chunks as convex polygons along a 26u island
  for(let i=0;i<24;i++){
    const x=-13+ i*(26/24)+0.54, w=0.54, h=1.2+rnd()*0.8;
    const pts=new Float32Array([-w,0, w,0, w*0.8,-h, -w*0.7,-h*0.9]);
    const b=world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(x,0));
    world.createCollider(RAPIER.ColliderDesc.convexHull(pts).setFriction(0.8), b);
  }
  const dyn=[];
  for(let i=0;i<6;i++){ // falling chunks
    const b=world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(-10+i*4, 3+rnd()*4).setAngvel(rnd()*4-2));
    world.createCollider(RAPIER.ColliderDesc.convexHull(new Float32Array([-0.6,0.5, 0.6,0.5, 0.5,-0.7, -0.4,-0.6])).setDensity(2), b); dyn.push(b);
  }
  for(let i=0;i<16;i++){ // rubble
    const b=world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(-12+rnd()*24, 1+rnd()*6).setLinvel(rnd()*10-5, rnd()*5));
    world.createCollider(RAPIER.ColliderDesc.ball(0.18+rnd()*0.12).setRestitution(0.3), b); dyn.push(b);
  }
  for(let i=0;i<8;i++){ // gadgets
    const b=world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(-12+rnd()*24, 2+rnd()*6));
    world.createCollider(RAPIER.ColliderDesc.cuboid(0.3,0.15), b); dyn.push(b);
  }
  for(let i=0;i<12;i++){ // projectiles
    const b=world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(-12+rnd()*24, 1+rnd()*3).setLinvel(rnd()*30-15, rnd()*10).setGravityScale(0.2).setCcdEnabled(true));
    world.createCollider(RAPIER.ColliderDesc.ball(0.12), b); dyn.push(b);
  }
  const chars=[]; const kcc=world.createCharacterController(0.02);
  kcc.enableAutostep(0.3,0.1,true); kcc.enableSnapToGround(0.2); kcc.setApplyImpulsesToDynamicBodies(true);
  for(let i=0;i<8;i++){
    const b=world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(-10.5+i*3, 0.8));
    const c=world.createCollider(RAPIER.ColliderDesc.capsule(0.35,0.4), b);
    chars.push({b,c,vx:(i%2?1:-1)*8.5,vy:0});
  }
  return {world,dyn,chars,kcc,rnd};
}
function tick(s,t){
  const {world,chars,kcc}=s;
  for(const ch of chars){ // crude scripted movement through the character controller
    ch.vy-=53.6/60; if(t%47===ch.b.handle%47) ch.vy=19.6; if(t%120===0) ch.vx=-ch.vx;
    kcc.computeColliderMovement(ch.c,{x:ch.vx/60,y:ch.vy/60});
    const m=kcc.computedMovement(); if(kcc.computedGrounded()) ch.vy=0;
    const p=ch.b.translation(); let nx=p.x+m.x, ny=p.y+m.y; if(ny<-11){nx=0;ny=6;ch.vy=0;}
    ch.b.setNextKinematicTranslation({x:nx,y:ny});
  }
  for(const b of s.dyn){const p=b.translation(); if(p.y<-11){ b.setTranslation({x:-12+s.rnd()*24,y:8},true); b.setLinvel({x:0,y:0},true);} }
  world.step();
}
function hash(s){ const h=createHash('sha1'); for(const b of [...s.dyn,...s.chars.map(c=>c.b)]){const p=b.translation(); h.update(Float32Array.of(p.x,p.y,b.rotation()));} return h.digest('hex').slice(0,12); }
const N=7200; // one 2-minute match at 60 Hz
const s=build(7); const times=new Float64Array(N);
for(let t=0;t<N;t++){ const a=performance.now(); tick(s,t); times[t]=performance.now()-a; }
const sorted=Float64Array.from(times).sort(); const sum=times.reduce((a,b)=>a+b,0);
console.log(pkg);
console.log(' bodies',s.world.bodies.len(),'colliders',s.world.colliders.len());
console.log(' 7200 ticks (2-min match) total ms',sum.toFixed(0),'| mean',(sum/N).toFixed(3),'ms | p50',sorted[N>>1].toFixed(3),'| p99',sorted[Math.floor(N*0.99)].toFixed(3),'| max',sorted[N-1].toFixed(2));
const h1=hash(s);
const s2=build(7); for(let t=0;t<N;t++) tick(s2,t); const h2=hash(s2);
console.log(' determinism (same process, two runs):',h1===h2?'IDENTICAL':'DIFFERENT',h1,h2);
// snapshot cost (relevant to rollback evaluation)
let a=performance.now(); let snap; for(let i=0;i<200;i++) snap=s.world.takeSnapshot(); const tSnap=(performance.now()-a)/200;
a=performance.now(); for(let i=0;i<200;i++){ const w=RAPIER.World.restoreSnapshot(snap); w.free(); } const tRest=(performance.now()-a)/200;
console.log(' snapshot bytes',snap.length,'| take',tSnap.toFixed(3),'ms | restore',tRest.toFixed(3),'ms');
// rollback cost estimate: restore + resimulate 7 ticks every frame
console.log(' est. rollback frame (restore + 7 resim ticks + save):',(tRest+7*(sum/N)+tSnap).toFixed(2),'ms');
