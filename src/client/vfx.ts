import * as THREE from 'three';
import { getGameData } from '@sim/data';
import { QualityTier } from './enums';

interface Particle {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  rotX: number;
  rotY: number;
  rotZ: number;
  scale: number;
  age: number;
  maxAge: number;
  bounces: number;
  color: THREE.Color;
}

interface RibbonPoint {
  x: number;
  y: number;
  age: number;
}

interface RingParticle {
  x: number;
  y: number;
  age: number;
  maxAge: number;
  maxRadius: number;
  color: THREE.Color;
}

export interface VfxOptions {
  readonly tier: QualityTier;
  readonly reduceFlashes: boolean;
}

const MAX_CHIPS_BY_TIER: Record<QualityTier, number> = {
  [QualityTier.Low]: 100,
  [QualityTier.Medium]: 180,
  [QualityTier.High]: 300,
};

const MAX_DUST_BY_TIER: Record<QualityTier, number> = {
  [QualityTier.Low]: 80,
  [QualityTier.Medium]: 150,
  [QualityTier.High]: 250,
};

const MAX_RINGS = 16;
const IMPACT_MAX_PER_SECOND = 3;

export class VfxSystem {
  public readonly group = new THREE.Group();
  private readonly chipMesh: THREE.InstancedMesh;
  private readonly dustMesh: THREE.InstancedMesh;
  private readonly shadowMesh: THREE.InstancedMesh;
  private readonly ringMesh: THREE.InstancedMesh;
  private readonly chips: Particle[] = [];
  private readonly dust: Particle[] = [];
  private readonly rings: RingParticle[] = [];
  private readonly ribbons = new Map<number, { line: THREE.Line; points: RibbonPoint[] }>();
  private readonly dummy = new THREE.Object3D();
  private readonly impactOverlay: HTMLDivElement;
  private readonly impactTimestamps: number[] = [];
  private impactFramesLeft = 0;
  private maxChips: number;
  private maxDust: number;
  private reduceFlashes: boolean;

  public constructor(overlayRoot: HTMLElement, options: VfxOptions) {
    this.maxChips = MAX_CHIPS_BY_TIER[options.tier];
    this.maxDust = MAX_DUST_BY_TIER[options.tier];
    this.reduceFlashes = options.reduceFlashes;

    const palette = getGameData().palette;
    const chipGeo = new THREE.TetrahedronGeometry(0.11, 0);
    const chipMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    this.chipMesh = new THREE.InstancedMesh(chipGeo, chipMat, MAX_CHIPS_BY_TIER[QualityTier.High]);
    this.chipMesh.count = 0;
    this.chipMesh.frustumCulled = false;

    const dustGeo = new THREE.IcosahedronGeometry(0.24, 0);
    const dustMat = new THREE.MeshBasicMaterial({ color: palette.neutrals['bone'] });
    this.dustMesh = new THREE.InstancedMesh(dustGeo, dustMat, MAX_DUST_BY_TIER[QualityTier.High]);
    this.dustMesh.count = 0;
    this.dustMesh.frustumCulled = false;

    const shadowGeo = new THREE.CircleGeometry(0.55, 16);
    shadowGeo.rotateX(-Math.PI / 2);
    const shadowMat = new THREE.MeshBasicMaterial({
      color: palette.neutrals['ink'],
      transparent: true,
      opacity: 0.32,
      depthWrite: false,
    });
    this.shadowMesh = new THREE.InstancedMesh(shadowGeo, shadowMat, 16);
    this.shadowMesh.count = 0;
    this.shadowMesh.frustumCulled = false;

    const ringGeo = new THREE.RingGeometry(0.78, 0.92, 24);
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.72,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    this.ringMesh = new THREE.InstancedMesh(ringGeo, ringMat, MAX_RINGS);
    this.ringMesh.count = 0;
    this.ringMesh.frustumCulled = false;

    this.group.add(this.chipMesh, this.dustMesh, this.shadowMesh, this.ringMesh);

    this.impactOverlay = document.createElement('div');
    this.impactOverlay.className = 'impact-frame';
    overlayRoot.appendChild(this.impactOverlay);
  }

  public setTier(tier: QualityTier): void {
    this.maxChips = MAX_CHIPS_BY_TIER[tier];
    this.maxDust = MAX_DUST_BY_TIER[tier];
  }

  public setReduceFlashes(reduce: boolean): void {
    this.reduceFlashes = reduce;
  }

  public spawnChips(x: number, y: number, count: number, colorHex: string, speed = 10): void {
    const pal = getGameData().palette;
    const liveryCol = new THREE.Color(colorHex);
    const bisqueCol = new THREE.Color(pal.neutrals['bisque']);
    const boneCol = new THREE.Color(pal.neutrals['bone']);
    for (let i = 0; i < count; i++) {
      if (this.chips.length >= this.maxChips) this.chips.shift();
      const angle = ((i + 0.5) / Math.max(1, count)) * Math.PI * 2;
      const spd = speed * (0.5 + ((i * 37) % 100) / 140);
      const chipCol = i % 3 === 0 ? liveryCol : i % 3 === 1 ? bisqueCol : boneCol;
      this.chips.push({
        x,
        y,
        z: (((i % 5) - 2) * 0.14),
        vx: Math.cos(angle) * spd,
        vy: Math.sin(angle) * spd + 3.0,
        vz: (((i % 3) - 1) * 1.6),
        rotX: i * 0.7,
        rotY: i * 1.1,
        rotZ: i * 0.5,
        scale: 0.75 + (i % 4) * 0.22,
        age: 0,
        maxAge: 36,
        bounces: 1,
        color: chipCol,
      });
    }
  }

  public spawnDust(x: number, y: number, count: number): void {
    const col = new THREE.Color(getGameData().palette.neutrals['bisque']);
    for (let i = 0; i < count; i++) {
      if (this.dust.length >= this.maxDust) this.dust.shift();
      const spread = (i - (count - 1) / 2) * 0.6;
      this.dust.push({
        x: x + spread * 0.25,
        y,
        z: 0.1,
        vx: spread * 2.1,
        vy: 1.4 + (i % 3) * 0.6,
        vz: 0,
        rotX: 0,
        rotY: 0,
        rotZ: i,
        scale: 0.25 + (i % 3) * 0.15,
        age: 0,
        maxAge: 24,
        bounces: 0,
        color: col,
      });
    }
  }

  public spawnRing(x: number, y: number, colorHex: string, maxRadius = 1.6, durationFrames = 14): void {
    if (this.rings.length >= MAX_RINGS) this.rings.shift();
    this.rings.push({
      x,
      y,
      age: 0,
      maxAge: Math.max(1, durationFrames),
      maxRadius: Math.max(0.25, maxRadius),
      color: new THREE.Color(colorHex),
    });
  }

  /** Rate-limited Delft two-tone impact frame (<= 3 per second; border pulse when reduceFlashes is on). */
  public triggerImpactFrame(durationFrames: number, nowMs: number): boolean {
    const cutoff = nowMs - 1000;
    while (this.impactTimestamps.length > 0 && (this.impactTimestamps[0] as number) < cutoff) {
      this.impactTimestamps.shift();
    }
    if (this.impactTimestamps.length >= IMPACT_MAX_PER_SECOND) return false;
    this.impactTimestamps.push(nowMs);
    this.impactFramesLeft = Math.max(this.impactFramesLeft, Math.min(durationFrames, 24));
    this.impactOverlay.classList.toggle('border-only', this.reduceFlashes);
    this.impactOverlay.classList.add('active');
    return true;
  }

  public getImpactCountInLastSecond(nowMs = performance.now()): number {
    const cutoff = nowMs - 1000;
    while (this.impactTimestamps.length > 0 && (this.impactTimestamps[0] as number) < cutoff) {
      this.impactTimestamps.shift();
    }
    return this.impactTimestamps.length;
  }

  public updateRibbon(slot: number, x: number, y: number, tumbling: boolean, colorHex: string): void {
    let entry = this.ribbons.get(slot);
    if (!entry) {
      const geo = new THREE.BufferGeometry();
      const coords = new Float32Array(30 * 3);
      const attr = new THREE.BufferAttribute(coords, 3);
      attr.setUsage(THREE.DynamicDrawUsage);
      geo.setAttribute('position', attr);
      geo.setDrawRange(0, 0);
      const mat = new THREE.LineBasicMaterial({ color: colorHex });
      const line = new THREE.Line(geo, mat);
      line.visible = false;
      line.frustumCulled = false;
      this.group.add(line);
      entry = { line, points: [] };
      this.ribbons.set(slot, entry);
    }
    const mat = entry.line.material as THREE.LineBasicMaterial;
    mat.color.set(colorHex);

    const prevLen = entry.points.length;
    if (tumbling) {
      entry.points.push({ x, y, age: 0 });
      if (entry.points.length > 30) entry.points.shift();
    }
    for (let i = entry.points.length - 1; i >= 0; i--) {
      const pt = entry.points[i] as RibbonPoint;
      pt.age++;
      if (pt.age > 30) entry.points.splice(i, 1);
    }
    const len = entry.points.length;
    if (len >= 2) {
      const attr = entry.line.geometry.getAttribute('position') as THREE.BufferAttribute;
      const coords = attr.array as Float32Array;
      for (let i = 0; i < len; i++) {
        const pt = entry.points[i] as RibbonPoint;
        coords[i * 3] = pt.x;
        coords[i * 3 + 1] = pt.y;
        coords[i * 3 + 2] = -0.15;
      }
      entry.line.geometry.setDrawRange(0, len);
      attr.needsUpdate = true;
      entry.line.visible = true;
    } else if (prevLen > 0) {
      entry.line.geometry.setDrawRange(0, 0);
      entry.line.visible = false;
    }
  }

  public updateBlobShadows(positions: readonly { x: number; y: number; scale: number }[]): void {
    const count = Math.min(positions.length, 16);
    for (let i = 0; i < count; i++) {
      const p = positions[i] as { x: number; y: number; scale: number };
      this.dummy.position.set(p.x, p.y + 0.03, 0);
      this.dummy.rotation.set(0, 0, 0);
      this.dummy.scale.set(p.scale, 1, p.scale * 0.55);
      this.dummy.updateMatrix();
      this.shadowMesh.setMatrixAt(i, this.dummy.matrix);
    }
    this.shadowMesh.count = count;
    if (count > 0) this.shadowMesh.instanceMatrix.needsUpdate = true;
  }

  public step(dt: number): void {
    if (this.impactFramesLeft > 0) {
      this.impactFramesLeft--;
      if (this.impactFramesLeft === 0) this.impactOverlay.classList.remove('active');
    }
    this.stepParticles(this.chips, this.chipMesh, dt, 26.0);
    this.stepParticles(this.dust, this.dustMesh, dt, -1.2);
    this.stepRings(dt);
  }

  private stepRings(dt: number): void {
    if (this.rings.length === 0) {
      this.ringMesh.count = 0;
      return;
    }
    const frameStep = Math.max(0, dt * 60);
    for (let i = this.rings.length - 1; i >= 0; i--) {
      const r = this.rings[i] as RingParticle;
      r.age += frameStep;
      if (r.age >= r.maxAge) {
        this.rings.splice(i, 1);
      }
    }

    for (let i = 0; i < this.rings.length; i++) {
      const r = this.rings[i] as RingParticle;
      const t = Math.max(0, Math.min(1, r.age / r.maxAge));
      const invT = 1 - t;
      const easeOut = 1 - invT * invT * invT;
      const radius = 0.25 + (r.maxRadius - 0.25) * easeOut;
      const tailFade = t > 0.65 ? Math.max(0.01, (1 - t) / 0.35) : 1.0;
      const s = Math.max(0.01, radius * tailFade);

      this.dummy.position.set(r.x, r.y, 0.25);
      this.dummy.rotation.set(0, 0, 0);
      this.dummy.scale.set(s, s, 1);
      this.dummy.updateMatrix();
      this.ringMesh.setMatrixAt(i, this.dummy.matrix);
      this.ringMesh.setColorAt(i, r.color);
    }
    this.ringMesh.count = this.rings.length;
    if (this.rings.length > 0) {
      this.ringMesh.instanceMatrix.needsUpdate = true;
      if (this.ringMesh.instanceColor) this.ringMesh.instanceColor.needsUpdate = true;
    }
  }

  private stepParticles(list: Particle[], mesh: THREE.InstancedMesh, dt: number, gravity: number): void {
    if (list.length === 0) {
      mesh.count = 0;
      return;
    }
    for (let i = list.length - 1; i >= 0; i--) {
      const p = list[i] as Particle;
      p.age++;
      if (p.age >= p.maxAge) {
        list.splice(i, 1);
        continue;
      }
      p.vy -= gravity * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      if (p.bounces > 0 && p.y < 0.05 && p.vy < 0) {
        p.y = 0.05;
        p.vy = -p.vy * 0.45;
        p.vx *= 0.7;
        p.bounces--;
      }
      p.rotX += 7 * dt;
      p.rotY += 9 * dt;
    }

    for (let i = 0; i < list.length; i++) {
      const p = list[i] as Particle;
      const life = 1 - p.age / p.maxAge;
      this.dummy.position.set(p.x, p.y, p.z);
      this.dummy.rotation.set(p.rotX, p.rotY, p.rotZ);
      this.dummy.scale.setScalar(Math.max(0.01, p.scale * life));
      this.dummy.updateMatrix();
      mesh.setMatrixAt(i, this.dummy.matrix);
      mesh.setColorAt(i, p.color);
    }
    mesh.count = list.length;
    if (list.length > 0) {
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
  }

  public clear(): void {
    this.chips.length = 0;
    this.dust.length = 0;
    this.rings.length = 0;
    this.chipMesh.count = 0;
    this.dustMesh.count = 0;
    this.shadowMesh.count = 0;
    this.ringMesh.count = 0;
    for (const r of this.ribbons.values()) {
      r.points.length = 0;
      r.line.geometry.setDrawRange(0, 0);
      r.line.visible = false;
    }
    this.impactFramesLeft = 0;
    this.impactOverlay.classList.remove('active');
  }

  public getStats(): { chips: number; dust: number; impactActive: boolean } {
    return {
      chips: this.chips.length,
      dust: this.dust.length,
      impactActive: this.impactFramesLeft > 0,
    };
  }

  public dispose(): void {
    this.chipMesh.geometry.dispose();
    (this.chipMesh.material as THREE.Material).dispose();
    this.dustMesh.geometry.dispose();
    (this.dustMesh.material as THREE.Material).dispose();
    this.shadowMesh.geometry.dispose();
    (this.shadowMesh.material as THREE.Material).dispose();
    this.ringMesh.geometry.dispose();
    (this.ringMesh.material as THREE.Material).dispose();
    for (const r of this.ribbons.values()) {
      r.line.geometry.dispose();
      (r.line.material as THREE.Material).dispose();
    }
    this.ribbons.clear();
    this.impactOverlay.remove();
  }
}
