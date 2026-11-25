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

interface SlashArcParticle {
  x: number;
  y: number;
  radius: number;
  thickness: number;
  angle: number;
  sweepRad: number;
  flipY: number;
  age: number;
  maxAge: number;
  color: THREE.Color;
}

interface SparkNeedleParticle {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  angle: number;
  length: number;
  width: number;
  age: number;
  maxAge: number;
  drag: number;
  color: THREE.Color;
}

export interface SlashOptions {
  readonly x: number;
  readonly y: number;
  readonly radius: number;
  readonly angle: number;
  readonly sweepRad: number;
  readonly colorHex: string;
  readonly durationFrames?: number;
  readonly thickness?: number;
  readonly flipY?: boolean;
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

const MAX_RINGS = 20;
const MAX_SLASHES = 24;
const MAX_SPARKS = 80;
const IMPACT_MAX_PER_SECOND = 3;

/** Procedural sleek tapered crescent ribbon spanning [-68°, +68°] on XY plane with luminous leading edge. */
function createSlashArcGeometry(): THREE.BufferGeometry {
  const segs = 18;
  const startA = -Math.PI * 0.38;
  const endA = Math.PI * 0.38;
  const positions: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];

  for (let i = 0; i <= segs; i++) {
    const u = i / segs;
    const a = startA + (endA - startA) * u;
    // Sleek razor-tapered tail (u=0) flaring into bright leading tip (u~0.85)
    const widthProfile = Math.sin(u * Math.PI) * (0.35 + 0.85 * u);
    const rOuter = 1.0 + widthProfile * 0.12;
    const rInner = Math.max(0.64, 1.0 - widthProfile * 0.28);
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    positions.push(ca * rInner, sa * rInner, 0);
    positions.push(ca * rOuter, sa * rOuter, 0);
    // Subtle luminance gradient: soft trailing inner edge -> crisp white-hot leading outer rim
    const innerLum = 0.62 + 0.38 * u;
    const outerLum = 0.88 + 0.12 * u;
    colors.push(innerLum, innerLum, innerLum);
    colors.push(outerLum, outerLum, outerLum);
    if (i < segs) {
      const k = i * 2;
      indices.push(k, k + 1, k + 2, k + 1, k + 3, k + 2);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

/** Sharp elongated diamond needle along +X for directional Smash hit sparks & kill-spark starbursts. */
function createSparkNeedleGeometry(): THREE.BufferGeometry {
  const positions = new Float32Array([
    -0.35, 0, 0,
    0.05, 0.16, 0,
    1.0, 0, 0,
    0.05, -0.16, 0,
  ]);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setIndex([0, 1, 2, 0, 2, 3]);
  geo.computeVertexNormals();
  return geo;
}

export class VfxSystem {
  public readonly group = new THREE.Group();
  private readonly chipMesh: THREE.InstancedMesh;
  private readonly dustMesh: THREE.InstancedMesh;
  private readonly shadowMesh: THREE.InstancedMesh;
  private readonly ringMesh: THREE.InstancedMesh;
  private readonly slashMesh: THREE.InstancedMesh;
  private readonly sparkMesh: THREE.InstancedMesh;
  private readonly chips: Particle[] = [];
  private readonly dust: Particle[] = [];
  private readonly rings: RingParticle[] = [];
  private readonly slashes: SlashArcParticle[] = [];
  private readonly sparks: SparkNeedleParticle[] = [];
  private readonly ribbons = new Map<number, { line: THREE.Line; points: RibbonPoint[]; smokeTick: number }>();
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
    const dustMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.78, depthWrite: false });
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

    const ringGeo = new THREE.RingGeometry(0.78, 0.94, 24);
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.82,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    this.ringMesh = new THREE.InstancedMesh(ringGeo, ringMat, MAX_RINGS);
    this.ringMesh.count = 0;
    this.ringMesh.frustumCulled = false;

    const slashGeo = createSlashArcGeometry();
    const slashMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      vertexColors: true,
      transparent: true,
      opacity: 0.80,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    this.slashMesh = new THREE.InstancedMesh(slashGeo, slashMat, MAX_SLASHES);
    this.slashMesh.count = 0;
    this.slashMesh.frustumCulled = false;

    const sparkGeo = createSparkNeedleGeometry();
    const sparkMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.95,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    this.sparkMesh = new THREE.InstancedMesh(sparkGeo, sparkMat, MAX_SPARKS);
    this.sparkMesh.count = 0;
    this.sparkMesh.frustumCulled = false;

    this.group.add(this.chipMesh, this.dustMesh, this.shadowMesh, this.ringMesh, this.slashMesh, this.sparkMesh);

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

  public spawnChips(x: number, y: number, count: number, colorHex: string, speed = 10, dirX = 0, dirY = 0.2): void {
    const pal = getGameData().palette;
    const liveryCol = new THREE.Color(colorHex);
    const bisqueCol = new THREE.Color(pal.neutrals['bisque']);
    const boneCol = new THREE.Color(pal.neutrals['bone']);
    const dirLen = Math.hypot(dirX, dirY);
    const biasX = dirLen > 1e-3 ? (dirX / dirLen) * speed * 0.55 : 0;
    const biasY = dirLen > 1e-3 ? (dirY / dirLen) * speed * 0.45 : 0;
    for (let i = 0; i < count; i++) {
      if (this.chips.length >= this.maxChips) this.chips.shift();
      const angle = ((i + 0.5) / Math.max(1, count)) * Math.PI * 2;
      const spd = speed * (0.45 + ((i * 37) % 100) / 135);
      const chipCol = i % 3 === 0 ? liveryCol : i % 3 === 1 ? bisqueCol : boneCol;
      this.chips.push({
        x,
        y,
        z: (((i % 5) - 2) * 0.14),
        vx: Math.cos(angle) * spd + biasX,
        vy: Math.sin(angle) * spd + 2.8 + biasY,
        vz: (((i % 3) - 1) * 1.8),
        rotX: i * 0.7,
        rotY: i * 1.1,
        rotZ: i * 0.5,
        scale: 0.8 + (i % 4) * 0.24,
        age: 0,
        maxAge: 36,
        bounces: 1,
        color: chipCol,
      });
    }
  }

  public spawnDust(x: number, y: number, count: number, colorHex?: string, scaleBase = 0.26): void {
    const col = new THREE.Color(colorHex ?? getGameData().palette.neutrals['bisque']!);
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
        scale: scaleBase + (i % 3) * 0.15,
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

  public spawnSlash(opts: SlashOptions): void {
    if (this.slashes.length >= MAX_SLASHES) this.slashes.shift();
    this.slashes.push({
      x: opts.x,
      y: opts.y,
      radius: Math.max(0.35, opts.radius),
      thickness: opts.thickness ?? 1.0,
      angle: opts.angle,
      sweepRad: opts.sweepRad,
      flipY: opts.flipY ? -1 : 1,
      age: 0,
      maxAge: Math.max(4, opts.durationFrames ?? 9),
      color: new THREE.Color(opts.colorHex),
    });
  }

  /** Directional Smash impact starburst + high-speed streaks along the knockback vector. */
  public spawnHitSparks(
    x: number,
    y: number,
    dirX: number,
    dirY: number,
    count: number,
    coreHex: string,
    accentHex: string,
    speed = 14,
  ): void {
    const coreCol = new THREE.Color(coreHex);
    const accentCol = new THREE.Color(accentHex);
    const baseAngle = Math.atan2(dirY, dirX);
    for (let i = 0; i < count; i++) {
      if (this.sparks.length >= MAX_SPARKS) this.sparks.shift();
      // Half burst radially around contact, half streak sharply in the launch cone!
      const isLaunchCone = i < Math.ceil(count * 0.55);
      const frac = count > 1 ? i / (count - 1) - 0.5 : 0;
      const angle = isLaunchCone
        ? baseAngle + frac * 1.05
        : ((i * 2.39996) % (Math.PI * 2));
      const spd = speed * (isLaunchCone ? 0.9 + (i % 3) * 0.25 : 0.45 + (i % 4) * 0.15);
      this.sparks.push({
        x,
        y,
        z: 0.42 + (i % 3) * 0.04,
        vx: Math.cos(angle) * spd,
        vy: Math.sin(angle) * spd,
        angle,
        length: isLaunchCone ? 0.95 + (i % 3) * 0.32 : 0.65 + (i % 3) * 0.22,
        width: isLaunchCone ? 0.85 : 0.65,
        age: 0,
        maxAge: isLaunchCone ? 12 : 9,
        drag: 0.86,
        color: i % 2 === 0 ? coreCol : accentCol,
      });
    }
  }

  /** Dramatic Smash Ultimate crimson-and-gilt kill-spark starburst on heavy/lethal blows. */
  public spawnKillSpark(x: number, y: number, dirX: number, dirY: number): void {
    const pal = getGameData().palette;
    const redHex = pal.accents['stamp_red']!;
    const giltHex = pal.accents['gilt_hi'] ?? pal.accents['gilt']!;
    const boneHex = pal.neutrals['bone']!;
    const redCol = new THREE.Color(redHex);
    const giltCol = new THREE.Color(giltHex);
    const baseA = Math.atan2(dirY, dirX);

    // 4 giant crossed starburst spikes anchored right at impact!
    for (let i = 0; i < 4; i++) {
      if (this.sparks.length >= MAX_SPARKS) this.sparks.shift();
      const a = baseA + (i * Math.PI) / 2;
      this.sparks.push({
        x,
        y,
        z: 0.55,
        vx: Math.cos(a) * 3.5,
        vy: Math.sin(a) * 3.5,
        angle: a,
        length: i % 2 === 0 ? 2.65 : 1.85,
        width: i % 2 === 0 ? 1.55 : 1.15,
        age: 0,
        maxAge: 15,
        drag: 0.82,
        color: i % 2 === 0 ? redCol : giltCol,
      });
    }
    this.spawnHitSparks(x, y, dirX, dirY, 12, boneHex, redHex, 20);
    this.spawnRing(x, y, redHex, 3.1, 16);
    this.spawnRing(x, y, giltHex, 1.9, 11);
  }

  public spawnChargeSpark(x: number, y: number, colorHex: string): void {
    if (this.sparks.length >= MAX_SPARKS) this.sparks.shift();
    const angle = Math.PI * 0.5 + (((this.sparks.length * 73) % 100) / 100 - 0.5) * 1.4;
    this.sparks.push({
      x: x + Math.cos(angle) * 0.55,
      y: y + 0.45,
      z: 0.38,
      vx: Math.cos(angle) * 2.4,
      vy: 3.2,
      angle,
      length: 0.48,
      width: 0.55,
      age: 0,
      maxAge: 10,
      drag: 0.92,
      color: new THREE.Color(colorHex),
    });
  }

  /** Classic Smash 4-point bone-and-gilt twinkle confirming Fast-Fall engagement mid-air. */
  public spawnFastFallSpark(x: number, y: number): void {
    const pal = getGameData().palette;
    const boneCol = new THREE.Color(pal.neutrals['bone']!);
    const giltCol = new THREE.Color(pal.accents['gilt_hi'] ?? pal.accents['gilt']!);
    for (let i = 0; i < 4; i++) {
      if (this.sparks.length >= MAX_SPARKS) this.sparks.shift();
      const angle = (i * Math.PI) / 2;
      this.sparks.push({
        x,
        y,
        z: 0.52,
        vx: Math.cos(angle) * 2.2,
        vy: Math.sin(angle) * 2.2 - 1.2,
        angle,
        length: i % 2 === 0 ? 0.82 : 0.64,
        width: 0.52,
        age: 0,
        maxAge: 8,
        drag: 0.84,
        color: i % 2 === 0 ? boneCol : giltCol,
      });
    }
  }

  /** Crisp directional afterimage streak burst for Air-Dodge and Brawlhalla-style Chase-Dodge bursts. */
  public spawnChaseGlint(x: number, y: number, dirX: number, dirY: number, colorHex: string, strong = false): void {
    const col = new THREE.Color(colorHex);
    const len = Math.hypot(dirX, dirY);
    const nx = len > 1e-3 ? dirX / len : 1;
    const ny = len > 1e-3 ? dirY / len : 0;
    const baseAngle = Math.atan2(ny, nx);
    const count = strong ? 6 : 4;
    for (let i = 0; i < count; i++) {
      if (this.sparks.length >= MAX_SPARKS) this.sparks.shift();
      const spread = (i - (count - 1) / 2) * 0.22;
      const angle = baseAngle + spread;
      const spd = (strong ? 13 : 9) + (i % 2) * 2.5;
      this.sparks.push({
        x: x - nx * 0.25,
        y: y - ny * 0.25,
        z: 0.44,
        vx: -Math.cos(angle) * spd * 0.45,
        vy: -Math.sin(angle) * spd * 0.45,
        angle,
        length: strong ? 1.15 : 0.78,
        width: strong ? 0.78 : 0.55,
        age: 0,
        maxAge: strong ? 10 : 8,
        drag: 0.85,
        color: col,
      });
    }
    if (strong) this.spawnRing(x, y, colorHex, 1.35, 9);
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
      entry = { line, points: [], smokeTick: 0 };
      this.ribbons.set(slot, entry);
    }
    const mat = entry.line.material as THREE.LineBasicMaterial;
    mat.color.set(colorHex);

    const prevLen = entry.points.length;
    if (tumbling) {
      entry.points.push({ x, y, age: 0 });
      if (entry.points.length > 30) entry.points.shift();
      // Smash launch smoke trail puffs behind flying tumbling fighters
      entry.smokeTick++;
      if (entry.smokeTick % 2 === 0) {
        const pal = getGameData().palette;
        this.spawnDust(x, y, 1, entry.smokeTick % 4 === 0 ? colorHex : pal.neutrals['bone']!, 0.42);
      }
    } else {
      entry.smokeTick = 0;
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
    this.stepSlashes(dt);
    this.stepSparks(dt);
  }

  private stepSlashes(dt: number): void {
    if (this.slashes.length === 0) {
      this.slashMesh.count = 0;
      return;
    }
    const frameStep = Math.max(0, dt * 60);
    for (let i = this.slashes.length - 1; i >= 0; i--) {
      const s = this.slashes[i] as SlashArcParticle;
      s.age += frameStep;
      if (s.age >= s.maxAge) this.slashes.splice(i, 1);
    }
    for (let i = 0; i < this.slashes.length; i++) {
      const s = this.slashes[i] as SlashArcParticle;
      const t = Math.max(0, Math.min(1, s.age / s.maxAge));
      const invT = 1 - t;
      const easeOut = 1 - invT * invT * invT;
      const fade = t > 0.5 ? Math.max(0.02, (1 - t) / 0.5) : 1.0;
      const sc = s.radius * (0.76 + 0.30 * easeOut) * (0.85 + 0.15 * fade);

      this.dummy.position.set(s.x, s.y, 0.58);
      this.dummy.rotation.set(0, 0, s.angle + s.sweepRad * easeOut);
      this.dummy.scale.set(sc * s.thickness, sc * s.flipY * fade, 1);
      this.dummy.updateMatrix();
      this.slashMesh.setMatrixAt(i, this.dummy.matrix);
      this.slashMesh.setColorAt(i, s.color);
    }
    this.slashMesh.count = this.slashes.length;
    if (this.slashes.length > 0) {
      this.slashMesh.instanceMatrix.needsUpdate = true;
      if (this.slashMesh.instanceColor) this.slashMesh.instanceColor.needsUpdate = true;
    }
  }

  private stepSparks(dt: number): void {
    if (this.sparks.length === 0) {
      this.sparkMesh.count = 0;
      return;
    }
    const frameStep = Math.max(0, dt * 60);
    for (let i = this.sparks.length - 1; i >= 0; i--) {
      const sp = this.sparks[i] as SparkNeedleParticle;
      sp.age += frameStep;
      if (sp.age >= sp.maxAge) {
        this.sparks.splice(i, 1);
        continue;
      }
      sp.x += sp.vx * dt;
      sp.y += sp.vy * dt;
      const decay = Math.pow(sp.drag, frameStep);
      sp.vx *= decay;
      sp.vy *= decay;
    }
    for (let i = 0; i < this.sparks.length; i++) {
      const sp = this.sparks[i] as SparkNeedleParticle;
      const t = Math.max(0, Math.min(1, sp.age / sp.maxAge));
      const life = 1 - t * t;
      this.dummy.position.set(sp.x, sp.y, sp.z);
      this.dummy.rotation.set(0, 0, sp.angle);
      this.dummy.scale.set(Math.max(0.02, sp.length * (0.45 + 0.75 * life)), Math.max(0.02, sp.width * life), 1);
      this.dummy.updateMatrix();
      this.sparkMesh.setMatrixAt(i, this.dummy.matrix);
      this.sparkMesh.setColorAt(i, sp.color);
    }
    this.sparkMesh.count = this.sparks.length;
    if (this.sparks.length > 0) {
      this.sparkMesh.instanceMatrix.needsUpdate = true;
      if (this.sparkMesh.instanceColor) this.sparkMesh.instanceColor.needsUpdate = true;
    }
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
    this.slashes.length = 0;
    this.sparks.length = 0;
    this.chipMesh.count = 0;
    this.dustMesh.count = 0;
    this.shadowMesh.count = 0;
    this.ringMesh.count = 0;
    this.slashMesh.count = 0;
    this.sparkMesh.count = 0;
    for (const r of this.ribbons.values()) {
      r.points.length = 0;
      r.smokeTick = 0;
      r.line.geometry.setDrawRange(0, 0);
      r.line.visible = false;
    }
    this.impactFramesLeft = 0;
    this.impactOverlay.classList.remove('active');
  }

  public getStats(): { chips: number; dust: number; slashes: number; sparks: number; impactActive: boolean } {
    return {
      chips: this.chips.length,
      dust: this.dust.length,
      slashes: this.slashes.length,
      sparks: this.sparks.length,
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
    this.slashMesh.geometry.dispose();
    (this.slashMesh.material as THREE.Material).dispose();
    this.sparkMesh.geometry.dispose();
    (this.sparkMesh.material as THREE.Material).dispose();
    for (const r of this.ribbons.values()) {
      r.line.geometry.dispose();
      (r.line.material as THREE.Material).dispose();
    }
    this.ribbons.clear();
    this.impactOverlay.remove();
  }
}
