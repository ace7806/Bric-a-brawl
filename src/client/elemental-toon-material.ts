import * as THREE from 'three';
import { assertFinite, assertNever } from '@sim/assert';
import { getGameData } from '@sim/data';
import { GlazeFinish } from './enums';
import { hexToLinearVec3 } from './glaze-material';

export interface ElementalToonOptions {
  readonly albedoMap: THREE.Texture;
  readonly emissiveMap: THREE.Texture;
  readonly rimColor?: THREE.Vector3;
  readonly rimStrength?: number;
  readonly emissiveBoost?: number;
}

export interface ElementalToonUniforms {
  [uniform: string]: THREE.IUniform<unknown>;
  uAlbedoMap: THREE.IUniform<THREE.Texture>;
  uEmissiveMap: THREE.IUniform<THREE.Texture>;
  uLightDir: THREE.IUniform<THREE.Vector3>;
  uRimColor: THREE.IUniform<THREE.Vector3>;
  uRimStrength: THREE.IUniform<number>;
  uEmissiveBoost: THREE.IUniform<number>;
  uCrack: THREE.IUniform<number>;
  uKintsugi: THREE.IUniform<number>;
  uGilt: THREE.IUniform<number>;
  uFlash: THREE.IUniform<number>;
  uMatte: THREE.IUniform<number>;
  uLustre: THREE.IUniform<number>;
  uGlazeTint: THREE.IUniform<THREE.Vector3>;
}

let fallbackWhiteTex: THREE.DataTexture | null = null;
let fallbackBlackTex: THREE.DataTexture | null = null;

export function getFallbackWhiteTexture(): THREE.DataTexture {
  if (fallbackWhiteTex === null) {
    fallbackWhiteTex = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1, THREE.RGBAFormat);
    fallbackWhiteTex.colorSpace = THREE.NoColorSpace;
    fallbackWhiteTex.needsUpdate = true;
  }
  return fallbackWhiteTex;
}

export function getFallbackBlackTexture(): THREE.DataTexture {
  if (fallbackBlackTex === null) {
    fallbackBlackTex = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1, THREE.RGBAFormat);
    fallbackBlackTex.colorSpace = THREE.NoColorSpace;
    fallbackBlackTex.needsUpdate = true;
  }
  return fallbackBlackTex;
}

const TOON_VERT = /* glsl */ `
#include <skinning_pars_vertex>
varying vec2 vUv;
varying vec3 vWorldNormal;
varying vec3 vViewNormal;
varying vec3 vObjPos;

void main() {
  vUv = uv;
  vObjPos = position;
  vec3 objectNormal = normal;
  vec3 transformed = position;
  #include <skinbase_vertex>
  #include <skinnormal_vertex>
  #include <skinning_vertex>
  vWorldNormal = normalize(mat3(modelMatrix) * objectNormal);
  vViewNormal = normalize(normalMatrix * objectNormal);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(transformed, 1.0);
}
`;

const TOON_FRAG = /* glsl */ `
uniform sampler2D uAlbedoMap;
uniform sampler2D uEmissiveMap;
uniform vec3 uLightDir;
uniform vec3 uRimColor;
uniform float uRimStrength;
uniform float uEmissiveBoost;
uniform float uCrack;
uniform float uKintsugi;
uniform float uGilt;
uniform float uFlash;
uniform float uMatte;
uniform float uLustre;
uniform vec3 uGlazeTint;

varying vec2 vUv;
varying vec3 vWorldNormal;
varying vec3 vViewNormal;
varying vec3 vObjPos;

vec2 hash22(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.xx + p3.yz) * p3.zy);
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
  vec3 baseCol = texture2D(uAlbedoMap, vUv).rgb * uGlazeTint;
  vec3 emCol = texture2D(uEmissiveMap, vUv).rgb;
  float emLum = max(emCol.r, max(emCol.g, emCol.b));

  // Optional battle-scuff / appraisal crackle overlay (skipped on glowing flame/eye cores)
  if (uCrack > 0.05 && emLum < 0.25) {
    float edge = fastCrackEdge(vObjPos * 3.0);
    float lineMask = 1.0 - smoothstep(0.015 + 0.018 * uCrack, 0.028 + 0.022 * uCrack, edge);
    vec3 inkLin = vec3(0.03, 0.024, 0.028);
    vec3 goldLin = vec3(0.68, 0.44, 0.09);
    vec3 crackCol = mix(inkLin, goldLin, step(0.5, uKintsugi));
    baseCol = mix(baseCol, crackCol, lineMask * 0.72);
  }

  // Invulnerability / MatteBisque desaturation
  float lum = dot(baseCol, vec3(0.2126, 0.7152, 0.0722));
  baseCol = mix(baseCol, vec3(lum * 0.90 + 0.06), uMatte);

  // Crisp 2-band stylized anime/Smash cel shading (matches Blender Cycles Style B look)
  vec3 wn = normalize(vWorldNormal);
  vec3 vn = normalize(vViewNormal);
  float ndl = dot(wn, normalize(uLightDir));
  float celBand = smoothstep(0.08, 0.18, ndl);
  vec3 shadowCol = baseCol * vec3(0.56, 0.54, 0.67);
  vec3 litCol = baseCol * vec3(0.99, 0.98, 0.97);
  vec3 col = mix(shadowCol, litCol, celBand);

  // Crisp Fresnel rim light (tinted cleanly by player livery for instant mirror-match clarity)
  float fres = pow(1.0 - clamp(abs(vn.z), 0.0, 1.0), 2.6);
  float rimMask = smoothstep(0.32, 0.78, fres);
  col += uRimColor * rimMask * uRimStrength * (0.42 + 0.58 * celBand);

  // Self-illuminated elemental cores (flames, magma veins, aqua visor, falcon eyes)
  col = max(col, baseCol * clamp(emLum * 1.15, 0.0, 1.0));
  col += emCol * uEmissiveBoost;

  // Lustre iridescence & Golden Overdrive / Heavy-charge rim shimmer
  if (uLustre > 0.01) {
    vec3 pearl = 0.5 + 0.5 * cos(vec3(0.0, 2.1, 4.2) + vn.x * 2.6 + vn.y * 1.8);
    col += pearl * fres * 0.28 * uLustre;
  }
  if (uGilt > 0.01) {
    vec3 goldGlow = vec3(0.95, 0.70, 0.24);
    col += goldGlow * (0.18 + 0.82 * fres) * uGilt;
  }

  // Crisp Smash hitstop white-gold impact flash
  vec3 flashCol = vec3(0.96, 0.93, 0.88);
  col = mix(col, flashCol, clamp(uFlash, 0.0, 1.0));

  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}
`;

export class ElementalToonMaterial extends THREE.ShaderMaterial {
  declare public uniforms: ElementalToonUniforms;

  public constructor(opts: ElementalToonOptions) {
    const uniforms: ElementalToonUniforms = {
      uAlbedoMap: { value: opts.albedoMap },
      uEmissiveMap: { value: opts.emissiveMap },
      uLightDir: { value: new THREE.Vector3(0.46, 0.68, 0.56).normalize() },
      uRimColor: { value: opts.rimColor ? opts.rimColor.clone() : new THREE.Vector3(1.0, 0.95, 0.88) },
      uRimStrength: { value: assertFinite(opts.rimStrength ?? 0.25, 'rimStrength') },
      uEmissiveBoost: { value: assertFinite(opts.emissiveBoost ?? 0.45, 'emissiveBoost') },
      uCrack: { value: 0.0 },
      uKintsugi: { value: 0.0 },
      uGilt: { value: 0.0 },
      uFlash: { value: 0.0 },
      uMatte: { value: 0.0 },
      uLustre: { value: 0.0 },
      uGlazeTint: { value: new THREE.Vector3(1, 1, 1) },
    };

    super({
      uniforms,
      side: THREE.FrontSide,
      vertexShader: TOON_VERT,
      fragmentShader: TOON_FRAG,
    });
  }
}

export function createElementalToonMaterial(opts: ElementalToonOptions): ElementalToonMaterial {
  return new ElementalToonMaterial(opts);
}

export function applyElementalFinish(mat: ElementalToonMaterial, finish: GlazeFinish): void {
  const u = mat.uniforms;
  u.uCrack.value = 0;
  u.uKintsugi.value = 0;
  u.uLustre.value = 0;
  u.uMatte.value = 0;
  u.uGilt.value = 0;
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
      u.uGlazeTint.value.copy(hexToLinearVec3(getGameData().palette.world['celadon']!)).lerp(new THREE.Vector3(1, 1, 1), 0.42);
      break;
    case GlazeFinish.Tenmoku:
      u.uGlazeTint.value.set(0.68, 0.62, 0.58);
      u.uLustre.value = 0.35;
      break;
    case GlazeFinish.DelftInk:
      u.uGlazeTint.value.set(0.90, 0.94, 1.08);
      break;
    case GlazeFinish.OxbloodSheen:
      u.uGlazeTint.value.set(1.08, 0.86, 0.84);
      u.uLustre.value = 0.42;
      break;
    case GlazeFinish.SpeckledStone:
      u.uGlazeTint.value.set(0.96, 0.94, 0.90);
      break;
    case GlazeFinish.Kintsugi:
      u.uCrack.value = 0.95;
      u.uKintsugi.value = 1.0;
      break;
    case GlazeFinish.PearlOverglaze:
      u.uLustre.value = 1.1;
      u.uGlazeTint.value.set(1.04, 1.02, 1.06);
      break;
    case GlazeFinish.RoyalGilt:
      u.uGilt.value = 0.85;
      u.uLustre.value = 0.5;
      break;
    default:
      assertNever(finish, 'applyElementalFinish');
  }
}

const OUTLINE_VERT = /* glsl */ `
#include <skinning_pars_vertex>
attribute vec3 aSmoothNormal;
uniform float uOutlineWidth;

void main() {
  vec3 objectNormal = aSmoothNormal;
  vec3 transformed = position;
  #include <skinbase_vertex>
  #include <skinnormal_vertex>
  #include <skinning_vertex>
  transformed += normalize(objectNormal) * uOutlineWidth;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(transformed, 1.0);
}
`;

const OUTLINE_FRAG = /* glsl */ `
uniform vec3 uOutlineColor;

void main() {
  gl_FragColor = vec4(uOutlineColor, 1.0);
  #include <colorspace_fragment>
}
`;

/**
 * Computes position-averaged smooth vertex normals (Guilty Gear inverted-hull technique) so
 * hard-creased low-poly armor & diamond poncho corners extrude watertight with zero gaps.
 */
export function ensureSmoothOutlineNormals(geo: THREE.BufferGeometry): void {
  if (geo.getAttribute('aSmoothNormal')) return;
  const pos = geo.getAttribute('position') as THREE.BufferAttribute;
  const norm = geo.getAttribute('normal') as THREE.BufferAttribute;
  const count = pos.count;
  const keyToGroup = new Map<number, number>();
  const vertGroup = new Int32Array(count);
  const sumX = new Float32Array(count);
  const sumY = new Float32Array(count);
  const sumZ = new Float32Array(count);
  let numGroups = 0;

  for (let i = 0; i < count; i++) {
    const ix = (Math.round(pos.getX(i) * 2000) + 32768) & 0xffff;
    const iy = (Math.round(pos.getY(i) * 2000) + 32768) & 0xffff;
    const iz = (Math.round(pos.getZ(i) * 2000) + 32768) & 0xffff;
    // Fits cleanly inside 48 bits (< Number.MAX_SAFE_INTEGER = 2^53 - 1)
    const key = ix * 4294967296 + iy * 65536 + iz;
    let g = keyToGroup.get(key);
    if (g === undefined) {
      g = numGroups++;
      keyToGroup.set(key, g);
    }
    vertGroup[i] = g;
    sumX[g] = sumX[g]! + norm.getX(i);
    sumY[g] = sumY[g]! + norm.getY(i);
    sumZ[g] = sumZ[g]! + norm.getZ(i);
  }

  const out = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const g = vertGroup[i]!;
    const nx = sumX[g]!;
    const ny = sumY[g]!;
    const nz = sumZ[g]!;
    const len = Math.hypot(nx, ny, nz);
    const i3 = i * 3;
    if (len > 1e-5) {
      out[i3] = nx / len;
      out[i3 + 1] = ny / len;
      out[i3 + 2] = nz / len;
    } else {
      out[i3] = norm.getX(i);
      out[i3 + 1] = norm.getY(i);
      out[i3 + 2] = norm.getZ(i);
    }
  }
  geo.setAttribute('aSmoothNormal', new THREE.BufferAttribute(out, 3));
}

export function createElementalOutlineMaterial(width = 0.010): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uOutlineWidth: { value: assertFinite(width, 'outlineWidth') },
      uOutlineColor: { value: hexToLinearVec3('#171316') },
    },
    side: THREE.BackSide,
    vertexShader: OUTLINE_VERT,
    fragmentShader: OUTLINE_FRAG,
  });
}
