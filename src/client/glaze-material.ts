import * as THREE from 'three';
import { InvariantError, assert, assertFinite, assertNever } from '@sim/assert';
import { getGameData } from '@sim/data';
import { ErrorCode, FighterId } from '@sim/enums';
import { GlazeFinish } from './enums';

export interface GlazeMaterialOptions {
  readonly matcap: THREE.Texture;
  readonly usePaletteAttr: boolean;
  readonly palette?: readonly THREE.Vector3[];
  readonly baseColor?: THREE.Vector3;
  readonly gloss?: number;
  readonly sheen?: number;
  readonly metal?: number;
  readonly speckle?: number;
  readonly crack?: number;
  readonly kintsugi?: number;
  readonly gilt?: number;
  readonly flash?: number;
  readonly matte?: number;
  readonly alpha?: number;
  readonly glazeTint?: THREE.Vector3;
  readonly lustre?: number;
  readonly side?: THREE.Side;
}

export interface GlazeUniforms {
  [uniform: string]: THREE.IUniform<unknown>;
  uMatcap: THREE.IUniform<THREE.Texture>;
  uPalette: THREE.IUniform<THREE.Vector3[]>;
  uBaseColor: THREE.IUniform<THREE.Vector3>;
  uGloss: THREE.IUniform<number>;
  uSheen: THREE.IUniform<number>;
  uMetal: THREE.IUniform<number>;
  uSpeckle: THREE.IUniform<number>;
  uCrack: THREE.IUniform<number>;
  uKintsugi: THREE.IUniform<number>;
  uGilt: THREE.IUniform<number>;
  uFlash: THREE.IUniform<number>;
  uMatte: THREE.IUniform<number>;
  uAlpha: THREE.IUniform<number>;
  uGlazeTint: THREE.IUniform<THREE.Vector3>;
  uLustre: THREE.IUniform<number>;
}

export class GlazeMaterial extends THREE.ShaderMaterial {
  declare public uniforms: GlazeUniforms;
  public readonly usePaletteAttr: boolean;

  public constructor(opts: GlazeMaterialOptions) {
    const palette = opts.palette ? [...opts.palette] : defaultPaletteVecs();
    assert(palette.length === 16, ErrorCode.InvariantViolation, `GlazeMaterial requires 16 palette entries, got ${palette.length}`);
    const baseColor = opts.baseColor ? opts.baseColor.clone() : new THREE.Vector3(1, 1, 1);
    const glazeTint = opts.glazeTint ? opts.glazeTint.clone() : new THREE.Vector3(1, 1, 1);
    const alpha = assertFinite(opts.alpha ?? 1.0, 'alpha');

    const uniforms: GlazeUniforms = {
      uMatcap: { value: opts.matcap },
      uPalette: { value: palette },
      uBaseColor: { value: baseColor },
      uGloss: { value: assertFinite(opts.gloss ?? 1.0, 'gloss') },
      uSheen: { value: assertFinite(opts.sheen ?? 0.35, 'sheen') },
      uMetal: { value: assertFinite(opts.metal ?? 0.0, 'metal') },
      uSpeckle: { value: assertFinite(opts.speckle ?? 1.0, 'speckle') },
      uCrack: { value: assertFinite(opts.crack ?? 0.0, 'crack') },
      uKintsugi: { value: assertFinite(opts.kintsugi ?? 0.0, 'kintsugi') },
      uGilt: { value: assertFinite(opts.gilt ?? 0.0, 'gilt') },
      uFlash: { value: assertFinite(opts.flash ?? 0.0, 'flash') },
      uMatte: { value: assertFinite(opts.matte ?? 0.0, 'matte') },
      uAlpha: { value: alpha },
      uGlazeTint: { value: glazeTint },
      uLustre: { value: assertFinite(opts.lustre ?? 0.0, 'lustre') },
    };

    super({
      uniforms,
      defines: opts.usePaletteAttr ? { USE_PALETTE_ATTR: 1 } : {},
      vertexColors: opts.usePaletteAttr,
      transparent: alpha < 1.0,
      side: opts.side ?? THREE.FrontSide,
      vertexShader: VERTEX_SHADER,
      fragmentShader: FRAGMENT_SHADER,
    });
    this.usePaletteAttr = opts.usePaletteAttr;
  }
}

const VERTEX_SHADER = /* glsl */ `
#include <skinning_pars_vertex>
varying vec3 vViewNormal;
varying vec3 vObjPos;
#ifdef USE_PALETTE_ATTR
uniform vec3 uPalette[16];
varying vec3 vBaseCol;
varying float vGloss;
varying float vAo;
varying float vMetal;
#endif

void main() {
  #ifdef USE_PALETTE_ATTR
    int slotIdx = int(clamp(floor(color.r * 15.0 + 0.5), 0.0, 15.0));
    vBaseCol = uPalette[0];
    for (int i = 1; i < 16; i++) {
      if (i == slotIdx) vBaseCol = uPalette[i];
    }
    vGloss = color.g;
    vAo = mix(0.42, 1.0, color.b);
    vMetal = color.a;
  #endif
  vObjPos = position;
  vec3 objectNormal = normal;
  vec3 transformed = position;
  #include <skinbase_vertex>
  #include <skinnormal_vertex>
  #include <skinning_vertex>
  vViewNormal = normalize(normalMatrix * objectNormal);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(transformed, 1.0);
}
`;

const FRAGMENT_SHADER = /* glsl */ `
uniform sampler2D uMatcap;
uniform vec3 uBaseColor;
uniform float uGloss;
uniform float uSheen;
uniform float uMetal;
uniform float uSpeckle;
uniform float uCrack;
uniform float uKintsugi;
uniform float uGilt;
uniform float uFlash;
uniform float uMatte;
uniform float uAlpha;
uniform vec3 uGlazeTint;
uniform float uLustre;

varying vec3 vViewNormal;
varying vec3 vObjPos;
#ifdef USE_PALETTE_ATTR
varying vec3 vBaseCol;
varying float vGloss;
varying float vAo;
varying float vMetal;
#endif

float hash31(vec3 p) {
  p = fract(p * 0.1031);
  p += dot(p, p.yzx + 33.33);
  return fract((p.x + p.y) * p.z);
}

vec2 hash22(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.xx + p3.yz) * p3.zy);
}

vec3 hash33(vec3 p) {
  p = fract(p * vec3(0.1031, 0.1030, 0.0973));
  p += dot(p, p.yxz + 33.33);
  return fract((p.xxy + p.yxx) * p.zyx);
}

float fastSpeckle(vec3 x) {
  vec3 n = floor(x);
  vec3 f = fract(x);
  vec3 o = hash33(n) * 0.6 + 0.2;
  vec3 r = o - f;
  return dot(r, r);
}

float fastCrackEdge(vec3 x) {
  vec2 uv = x.xy + vec2(x.z * 0.67, -x.z * 0.53);
  vec2 n = floor(uv);
  vec2 f = fract(uv);
  float d1 = 8.0;
  float d2 = 8.0;
  for (int j = -1; j <= 1; j++) {
    for (int i = -1; i <= 1; i++) {
      vec2 g = vec2(float(i), float(j));
      vec2 o = hash22(n + g);
      vec2 r = g + o - f;
      float d = dot(r, r);
      if (d < d1) { d2 = d1; d1 = d; }
      else if (d < d2) { d2 = d; }
    }
  }
  return sqrt(d2) - sqrt(d1);
}

void main() {
  vec3 vn = normalize(vViewNormal);
  vec2 muv = clamp(vn.xy * 0.49 + 0.5, 0.002, 0.998);
  vec3 mc = texture2D(uMatcap, muv).rgb;

  vec3 baseCol = uBaseColor;
  float gloss = uGloss;
  float sheen = uSheen;
  float ao = 1.0;
  float metal = uMetal;

  #ifdef USE_PALETTE_ATTR
    baseCol = vBaseCol;
    gloss = vGloss;
    ao = vAo;
    metal = vMetal;
    sheen = mix(uSheen, 0.6, metal);
  #endif

  baseCol *= uGlazeTint;

  // Fast 1-cell inset stoneware iron speckle matching ceramic.py aesthetic
  if (uSpeckle > 0.01 && metal < 0.5) {
    float f1Sq = fastSpeckle(vObjPos * 12.0);
    float gate = hash31(floor(vObjPos * 3.1));
    float fleck = step(f1Sq, 0.022) * step(0.56, gate);
    vec3 ironLin = vec3(0.102, 0.027, 0.016);
    float amt = (gloss < 0.1 ? 0.35 : 0.55) * uSpeckle;
    baseCol = mix(baseCol, ironLin, fleck * amt);
  }

  // Fast 9-tap object-space crazing crack overlay (ink or kintsugi gold)
  if (uCrack > 0.01) {
    float edge = fastCrackEdge(vObjPos * 2.2);
    float lineMask = 1.0 - smoothstep(0.018 + 0.020 * uCrack, 0.032 + 0.024 * uCrack, edge);
    vec3 inkLin = vec3(0.024, 0.019, 0.017);
    vec3 goldLin = vec3(0.578, 0.356, 0.068);
    vec3 crackCol = mix(inkLin, goldLin, step(0.5, uKintsugi));
    baseCol = mix(baseCol, crackCol, lineMask);
    metal = max(metal, lineMask * step(0.5, uKintsugi));
  }

  // Matte bisque desaturation (invulnerability)
  float lum = dot(baseCol, vec3(0.2126, 0.7152, 0.0722));
  baseCol = mix(baseCol, vec3(lum * 0.92 + 0.05), uMatte);
  gloss *= (1.0 - 0.85 * uMatte);

  // Diffuse * (matcap.R * AO) + specular/sheen highlights
  float shade = mc.r * ao;
  vec3 diff = baseCol * shade;
  float hs = mc.g * gloss + mc.b * sheen * 0.45;
  vec3 giltTint = min(vec3(1.0), baseCol * 1.6 + 0.08);
  vec3 specTint = mix(vec3(1.0), giltTint, metal);
  vec3 col = diff + specTint * hs;

  // Lustre iridescence + full-gilt rim shimmer
  if (uLustre > 0.01) {
    float fres = pow(1.0 - abs(vn.z), 2.2);
    vec3 pearl = 0.5 + 0.5 * cos(vec3(0.0, 2.1, 4.2) + vn.x * 2.6 + vn.y * 1.8);
    col += pearl * fres * 0.28 * uLustre;
  }
  if (uGilt > 0.01) {
    float rim = pow(1.0 - clamp(abs(vn.z), 0.0, 1.0), 2.0);
    vec3 goldGlow = vec3(0.80, 0.60, 0.22);
    col += goldGlow * (0.25 + 0.75 * rim) * uGilt;
  }

  // Hit-flash toward warm bone white
  vec3 boneLin = vec3(0.888, 0.855, 0.791);
  col = mix(col, boneLin, clamp(uFlash, 0.0, 1.0));

  gl_FragColor = vec4(col, uAlpha);
  #include <colorspace_fragment>
}
`;

export function hexToLinearVec3(hex: string): THREE.Vector3 {
  const clean = hex.startsWith('#') ? hex.slice(1) : hex;
  assert(clean.length === 6, ErrorCode.InvariantViolation, `Invalid hex color: ${hex}`);
  const r = parseInt(clean.slice(0, 2), 16) / 255;
  const g = parseInt(clean.slice(2, 4), 16) / 255;
  const b = parseInt(clean.slice(4, 6), 16) / 255;
  const toLin = (c: number): number => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
  return new THREE.Vector3(toLin(r), toLin(g), toLin(b));
}

function defaultPaletteVecs(): THREE.Vector3[] {
  const p = getGameData().palette;
  const bone = hexToLinearVec3(p.neutrals['bone']!);
  return Array.from({ length: 16 }, () => bone.clone());
}

export async function loadPackedMatcap(url = './assets/matcap_packed.png'): Promise<THREE.Texture> {
  const loader = new THREE.TextureLoader();
  const tex = await loader.loadAsync(url);
  tex.colorSpace = THREE.NoColorSpace;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
}

export function createGlazeMaterial(opts: GlazeMaterialOptions): GlazeMaterial {
  return new GlazeMaterial(opts);
}

export function applyGlazeFinish(mat: GlazeMaterial, finish: GlazeFinish): void {
  const u = mat.uniforms;
  u.uCrack.value = 0;
  u.uKintsugi.value = 0;
  u.uLustre.value = 0;
  u.uMatte.value = 0;
  u.uGilt.value = 0;
  u.uSpeckle.value = 1.0;
  u.uGlazeTint.value.set(1, 1, 1);

  switch (finish) {
    case GlazeFinish.Standard:
      break;
    case GlazeFinish.Crackle:
      u.uCrack.value = 0.85;
      break;
    case GlazeFinish.Lustre:
      u.uLustre.value = 0.85;
      break;
    case GlazeFinish.MatteBisque:
      u.uMatte.value = 0.85;
      break;
    case GlazeFinish.GoldRim:
      u.uGilt.value = 0.45;
      break;
    case GlazeFinish.CeladonWash:
      u.uGlazeTint.value.copy(hexToLinearVec3(getGameData().palette.world['celadon']!)).lerp(new THREE.Vector3(1, 1, 1), 0.35);
      break;
    case GlazeFinish.Tenmoku:
      u.uGlazeTint.value.set(0.45, 0.38, 0.32);
      u.uLustre.value = 0.3;
      break;
    case GlazeFinish.DelftInk:
      u.uGlazeTint.value.set(0.88, 0.92, 1.08);
      break;
    case GlazeFinish.OxbloodSheen:
      u.uGlazeTint.value.set(1.08, 0.84, 0.82);
      u.uLustre.value = 0.4;
      break;
    case GlazeFinish.SpeckledStone:
      u.uSpeckle.value = 1.6;
      break;
    case GlazeFinish.Kintsugi:
      u.uCrack.value = 0.95;
      u.uKintsugi.value = 1.0;
      break;
    case GlazeFinish.PearlOverglaze:
      u.uLustre.value = 1.1;
      u.uGlazeTint.value.set(1.04, 1.02, 1.05);
      break;
    case GlazeFinish.RoyalGilt:
      u.uGilt.value = 0.85;
      u.uLustre.value = 0.5;
      break;
    default:
      assertNever(finish, 'applyGlazeFinish');
  }
}

export function buildFighterPalette(fighterId: FighterId, liveryHex: string): THREE.Vector3[] {
  const pal = getGameData().palette;
  const neutrals = pal.neutrals as Record<string, string>;
  const accents = pal.accents as Record<string, string>;
  const world = pal.world as Record<string, string>;
  const n = (k: string): THREE.Vector3 => {
    const hex = neutrals[k] ?? accents[k] ?? world[k];
    if (hex === undefined) throw new InvariantError(ErrorCode.MissingRequiredEntry, `Missing palette key ${k}`);
    return hexToLinearVec3(hex);
  };
  const livery = hexToLinearVec3(liveryHex);
  const out = defaultPaletteVecs();

  // Shared fixed slots from export_gltf.py: 2=livery, 3=bone, 4=ink, 5=cheek, 6=gilt, 7=bisque
  out[2] = livery.clone();
  out[3] = n('bone');
  out[4] = n('ink');
  out[5] = n('cheek');
  out[6] = n('gilt');
  out[7] = n('bisque');

  switch (fighterId) {
    case FighterId.Earl:
      out[0] = livery.clone(); // trim
      out[1] = n('bone');      // body
      break;
    case FighterId.Grog:
      out[0] = n('basalt');    // body
      out[1] = hexToLinearVec3('#3A2A22'); // tenmoku hoof
      out[8] = n('bisque');    // muzzle
      break;
    case FighterId.Nesta:
      out[0] = livery.clone(); // trim
      out[1] = n('slip');      // body
      out[8] = hexToLinearVec3('#DA7F98'); // rose apron floral
      out[9] = n('celadon_dk'); // leaf
      break;
    case FighterId.Moss:
      out[0] = n('terracotta'); // coat
      out[1] = n('ink');        // belt
      out[8] = n('bisque');     // skin
      out[9] = n('cheek');      // nose
      out[10] = hexToLinearVec3('#3A2A22'); // tenmoku boot
      out[11] = hexToLinearVec3('#5A2E22'); // iron rod
      out[12] = livery.clone(); // float
      break;
    default:
      assertNever(fighterId, 'buildFighterPalette');
  }
  return out;
}

export function createDelftPatternTexture(width = 512, height = 256): THREE.CanvasTexture {
  const pal = getGameData().palette;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (ctx === null) throw new InvariantError(ErrorCode.InvariantViolation, '2D canvas context unavailable');

  ctx.fillStyle = pal.world['willow_glaze']!;
  ctx.fillRect(0, 0, width, height);

  // Delft border bands
  ctx.strokeStyle = pal.world['willow_line']!;
  ctx.lineWidth = Math.max(2, height * 0.025);
  ctx.strokeRect(width * 0.02, height * 0.06, width * 0.96, height * 0.88);
  ctx.strokeStyle = pal.accents['delft_ink']!;
  ctx.lineWidth = Math.max(1.5, height * 0.012);
  ctx.strokeRect(width * 0.035, height * 0.1, width * 0.93, height * 0.8);

  // Scalloped fretwork ring
  ctx.fillStyle = pal.world['willow_wash']!;
  const scallops = 24;
  for (let i = 0; i < scallops; i++) {
    const x = ((i + 0.5) / scallops) * width;
    ctx.beginPath();
    ctx.arc(x, height * 0.14, width / (scallops * 2.2), 0, Math.PI);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(x, height * 0.86, width / (scallops * 2.2), Math.PI, Math.PI * 2);
    ctx.fill();
  }

  // Painted arched bridge & willow motif in center
  ctx.strokeStyle = pal.accents['delft_ink']!;
  ctx.lineWidth = Math.max(2, height * 0.018);
  ctx.beginPath();
  ctx.moveTo(width * 0.34, height * 0.62);
  ctx.quadraticCurveTo(width * 0.5, height * 0.36, width * 0.66, height * 0.62);
  ctx.stroke();

  // Pagoda silhouette left, weeping willow fronds right
  ctx.fillStyle = pal.world['willow_line']!;
  for (let tier = 0; tier < 3; tier++) {
    const ty = height * (0.58 - tier * 0.1);
    const tw = width * (0.09 - tier * 0.02);
    ctx.beginPath();
    ctx.moveTo(width * 0.22 - tw, ty);
    ctx.lineTo(width * 0.22, ty - height * 0.08);
    ctx.lineTo(width * 0.22 + tw, ty);
    ctx.closePath();
    ctx.fill();
  }
  ctx.strokeStyle = pal.world['willow_line']!;
  for (let b = 0; b < 5; b++) {
    const bx = width * (0.72 + b * 0.025);
    ctx.beginPath();
    ctx.moveTo(width * 0.78, height * 0.34);
    ctx.quadraticCurveTo(bx, height * 0.48, bx - width * 0.01, height * 0.66);
    ctx.stroke();
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.needsUpdate = true;
  return tex;
}

export function createSkyGradientTexture(): THREE.CanvasTexture {
  const pal = getGameData().palette;
  const canvas = document.createElement('canvas');
  canvas.width = 4;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  if (ctx === null) throw new InvariantError(ErrorCode.InvariantViolation, '2D canvas context unavailable');
  const grad = ctx.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0.0, pal.world['sky_top']!);
  grad.addColorStop(0.5, pal.world['sky_mid']!);
  grad.addColorStop(1.0, pal.world['sky_low']!);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 4, 256);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}
