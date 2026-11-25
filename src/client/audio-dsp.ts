import { assert, assertFinite, assertNever, InvariantError } from '@sim/assert';
import { ErrorCode } from '@sim/enums';
import recipesData from '../../assets-src/audio/recipes.json';
import { AuctioneerLineId, SoundId } from './enums';

export type AudioFamily = 'ceramic' | 'air' | 'wood' | 'fm' | 'auctioneer' | 'music';
export type AudioBusName = 'effects' | 'music' | 'auctioneer' | 'ui';
type MaterialKind = 'cup' | 'plate' | 'bowl' | 'bell' | 'wood';

interface ModalPartial { readonly ratio: number; readonly amp: number; readonly decaySec: number; }
interface AuctioneerNote { readonly startMs: number; readonly durMs: number; readonly f0: number; readonly f1: number; readonly wah0: number; readonly wah1: number; }

export interface SoundRecipeMeta {
  readonly id: SoundId;
  readonly name: string;
  readonly family: AudioFamily;
  readonly bus: AudioBusName;
  readonly targetMs: number;
}

export interface AuctioneerRecipeMeta {
  readonly id: AuctioneerLineId;
  readonly name: string;
  readonly family: 'auctioneer';
  readonly targetMs: number;
  readonly gavelCount: number;
}

interface RawSoundRecipe extends SoundRecipeMeta {
  readonly kind: 'modal' | 'doubleModal' | 'shatter' | 'air' | 'fm' | 'arpeggio';
  readonly material?: MaterialKind;
  readonly baseHz?: number;
  readonly baseHz2?: number;
  readonly gapMs?: number;
  readonly decayScale?: number;
  readonly clickHz?: number;
  readonly clickGain?: number;
  readonly subHz0?: number;
  readonly subHz1?: number;
  readonly subGain?: number;
  readonly pieces?: number;
  readonly spanMs?: number;
  readonly noiseHz0?: number;
  readonly noiseHz1?: number;
  readonly risePitch?: number;
  readonly freq0?: number;
  readonly freq1?: number;
  readonly q?: number;
  readonly whistle0?: number;
  readonly whistle1?: number;
  readonly vibHz?: number;
  readonly vibDepth?: number;
  readonly whistleGain?: number;
  readonly flutterHz?: number;
  readonly flutterDepth?: number;
  readonly f0?: number;
  readonly f1?: number;
  readonly modRatio?: number;
  readonly modIdx?: number;
  readonly airHz?: number;
  readonly airGain?: number;
  readonly modalHz?: number;
  readonly notesHz?: readonly number[];
  readonly stepMs?: number;
}

interface RawAuctioneerRecipe extends AuctioneerRecipeMeta {
  readonly gavelGapMs: number;
  readonly notes: readonly AuctioneerNote[];
}

const PARTIALS: Record<MaterialKind, readonly ModalPartial[]> = {
  cup: [
    { ratio: 1.0, amp: 0.32, decaySec: 0.055 }, { ratio: 2.31, amp: 0.34, decaySec: 0.048 },
    { ratio: 3.72, amp: 0.22, decaySec: 0.038 }, { ratio: 5.44, amp: 0.13, decaySec: 0.028 },
    { ratio: 7.18, amp: 0.07, decaySec: 0.02 },
  ],
  plate: [
    { ratio: 1.0, amp: 0.22, decaySec: 0.105 }, { ratio: 1.78, amp: 0.35, decaySec: 0.092 },
    { ratio: 2.89, amp: 0.27, decaySec: 0.076 }, { ratio: 4.25, amp: 0.17, decaySec: 0.055 },
    { ratio: 5.95, amp: 0.1, decaySec: 0.038 },
  ],
  bowl: [
    { ratio: 1.0, amp: 0.2, decaySec: 1.18 }, { ratio: 2.756, amp: 0.32, decaySec: 1.08 },
    { ratio: 2.771, amp: 0.24, decaySec: 1.0 }, { ratio: 5.404, amp: 0.19, decaySec: 0.82 },
    { ratio: 8.933, amp: 0.11, decaySec: 0.54 }, { ratio: 13.34, amp: 0.06, decaySec: 0.36 },
    { ratio: 18.64, amp: 0.035, decaySec: 0.22 }, { ratio: 24.8, amp: 0.02, decaySec: 0.15 },
  ],
  bell: [
    { ratio: 1.0, amp: 0.26, decaySec: 0.22 }, { ratio: 2.0, amp: 0.34, decaySec: 0.19 },
    { ratio: 3.01, amp: 0.24, decaySec: 0.15 }, { ratio: 4.16, amp: 0.14, decaySec: 0.11 },
    { ratio: 5.43, amp: 0.08, decaySec: 0.07 },
  ],
  wood: [
    { ratio: 1.0, amp: 0.54, decaySec: 0.082 }, { ratio: 1.48, amp: 0.28, decaySec: 0.056 },
    { ratio: 2.12, amp: 0.14, decaySec: 0.038 }, { ratio: 2.86, amp: 0.07, decaySec: 0.024 },
    { ratio: 3.72, amp: 0.03, decaySec: 0.014 },
  ],
};

function buildRecipeMeta() {
  const rawSounds = recipesData.sounds as unknown as Record<string, Omit<RawSoundRecipe, 'id'>>;
  const rawAuc = recipesData.auctioneer as unknown as Record<string, Omit<RawAuctioneerRecipe, 'id'>>;
  const soundMap = new Map<SoundId, RawSoundRecipe>();
  const aucMap = new Map<AuctioneerLineId, RawAuctioneerRecipe>();

  for (let i = 0; i <= SoundId.ErrorKnock; i++) {
    const entry = rawSounds[String(i)];
    assert(entry !== undefined, ErrorCode.MissingRequiredEntry, `Missing audio recipe for SoundId.${i}`);
    assertFinite(entry.targetMs, `recipes.sounds[${i}].targetMs`);
    soundMap.set(i as SoundId, { ...entry, id: i as SoundId });
  }
  for (let i = 0; i <= AuctioneerLineId.NewLot; i++) {
    const entry = rawAuc[String(i)];
    assert(entry !== undefined, ErrorCode.MissingRequiredEntry, `Missing auctioneer recipe ${i}`);
    assertFinite(entry.targetMs, `recipes.auctioneer[${i}].targetMs`);
    aucMap.set(i as AuctioneerLineId, { ...entry, id: i as AuctioneerLineId });
  }
  return { soundMap, aucMap };
}

const RECIPE_DB = buildRecipeMeta();

export const AUDIO_RECIPE_META: {
  readonly sampleRate: number;
  readonly sounds: ReadonlyMap<SoundId, SoundRecipeMeta>;
  readonly auctioneer: ReadonlyMap<AuctioneerLineId, AuctioneerRecipeMeta>;
  readonly music: typeof recipesData.music;
} = {
  sampleRate: recipesData.sampleRate,
  sounds: RECIPE_DB.soundMap,
  auctioneer: RECIPE_DB.aucMap,
  music: recipesData.music,
};

function nextRand(state: { s: number }): number {
  state.s = (Math.imul(state.s, 1664525) + 1013904223) | 0;
  return ((state.s >>> 16) / 32768) - 1;
}

function midiToHz(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

class Biquad {
  private x1 = 0; private x2 = 0; private y1 = 0; private y2 = 0;
  private b0 = 1; private b1 = 0; private b2 = 0; private a1 = 0; private a2 = 0;

  public setBandpass(fc: number, q: number, sr: number): void {
    const w0 = (2 * Math.PI * Math.max(30, Math.min(sr * 0.45, fc))) / sr;
    const alpha = Math.sin(w0) / (2 * Math.max(0.2, q));
    const a0 = 1 + alpha;
    this.b0 = alpha / a0; this.b1 = 0; this.b2 = -alpha / a0;
    this.a1 = (-2 * Math.cos(w0)) / a0; this.a2 = (1 - alpha) / a0;
  }

  public setCoeffs(b0: number, b1: number, b2: number, a1: number, a2: number): void {
    this.b0 = b0; this.b1 = b1; this.b2 = b2; this.a1 = a1; this.a2 = a2;
  }

  public step(x: number): number {
    const y = this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2;
    this.x2 = this.x1; this.x1 = x; this.y2 = this.y1; this.y1 = y;
    return y;
  }
}

function makeKWeightFilters(sr: number): readonly [Biquad, Biquad] {
  // ITU-R BS.1770-4 Stage 1 high-shelf (+4 dB) + Stage 2 RLB high-pass (38 Hz)
  const db = 3.999843853973347;
  const f0 = 1681.974450955533;
  const q1 = 0.7071752369554196;
  const k1 = Math.tan((Math.PI * f0) / sr);
  const vh = Math.pow(10, db / 20);
  const vb = Math.pow(vh, 0.4996667741545416);
  const a0 = 1 + k1 / q1 + k1 * k1;
  const s1 = new Biquad();
  s1.setCoeffs(
    (vh + (vb * k1) / q1 + k1 * k1) / a0,
    (2 * (k1 * k1 - vh)) / a0,
    (vh - (vb * k1) / q1 + k1 * k1) / a0,
    (2 * (k1 * k1 - 1)) / a0,
    (1 - k1 / q1 + k1 * k1) / a0,
  );
  const s2 = new Biquad();
  const k2 = Math.tan((Math.PI * 38.13547087602444) / sr);
  const q2 = 0.5003270373238773;
  const d2 = 1 + k2 / q2 + k2 * k2;
  s2.setCoeffs(1 / d2, -2 / d2, 1 / d2, (2 * (k2 * k2 - 1)) / d2, (1 - k2 / q2 + k2 * k2) / d2);
  return [s1, s2];
}

export function computeLufs(buf: Float32Array, sr: number): number {
  const [s1, s2] = makeKWeightFilters(sr);
  let sumSq = 0;
  for (let i = 0; i < buf.length; i++) {
    const y = s2.step(s1.step(buf[i]!));
    sumSq += y * y;
  }
  const meanSq = sumSq / Math.max(1, buf.length);
  return meanSq > 1e-12 ? -0.691 + 10 * Math.log10(meanSq) : -120;
}

function normalizeToTarget(buf: Float32Array, sr: number, targetLufs: number): Float32Array {
  const peakCap = Math.pow(10, recipesData.loudnessTargets.peakCapDbfs / 20);
  for (let pass = 0; pass < 3; pass++) {
    const lufs = computeLufs(buf, sr);
    const gain = Math.pow(10, (targetLufs - lufs) / 20);
    for (let i = 0; i < buf.length; i++) buf[i] = buf[i]! * gain;
    let maxAbs = 0;
    for (let i = 0; i < buf.length; i++) {
      const a = Math.abs(buf[i]!);
      if (a > maxAbs) maxAbs = a;
    }
    if (maxAbs <= peakCap) break;
    const knee = peakCap * 0.72;
    const head = peakCap - knee;
    for (let i = 0; i < buf.length; i++) {
      const v = buf[i]!;
      const av = Math.abs(v);
      if (av > knee) buf[i] = Math.sign(v) * (knee + head * Math.tanh((av - knee) / (maxAbs - knee + 1e-6)));
    }
  }
  // Enforce tiny 2 ms fade-out at tail so zero boundary clicks occur
  const fade = Math.min(Math.floor(sr * 0.002), Math.floor(buf.length / 4));
  for (let i = 0; i < fade; i++) {
    const k = buf.length - 1 - i;
    buf[k] = buf[k]! * (i / fade);
  }
  return buf;
}

function addModal(
  buf: Float32Array, sr: number, startIdx: number, baseHz: number,
  partials: readonly ModalPartial[], gain: number, decayScale: number, wrap = false,
): void {
  const maxHz = sr * 0.44;
  for (const p of partials) {
    const freq = baseHz * p.ratio;
    if (freq > maxHz) continue;
    const dec = p.decaySec * decayScale;
    const len = Math.ceil(dec * 4.2 * sr);
    const atk = Math.max(1, Math.floor(0.0015 * sr));
    const w = (2 * Math.PI * freq) / sr;
    const amp = gain * p.amp;
    for (let i = 0; i < len; i++) {
      const idx = startIdx + i;
      if (!wrap && idx >= buf.length) break;
      const pos = wrap ? ((idx % buf.length) + buf.length) % buf.length : idx;
      if (pos < 0) continue;
      const env = (i < atk ? i / atk : 1) * Math.exp(-i / (dec * sr));
      buf[pos] = buf[pos]! + Math.sin(w * i) * amp * env;
    }
  }
}

function addFilteredNoise(
  buf: Float32Array, sr: number, startIdx: number, durSec: number,
  f0: number, f1: number, q: number, gain: number, rng: { s: number },
  flutterHz = 0, flutterDepth = 0, wrap = false,
): void {
  const len = Math.max(16, Math.floor(durSec * sr));
  const atk = Math.max(1, Math.floor(0.004 * sr));
  const bp = new Biquad();
  for (let i = 0; i < len; i++) {
    const idx = startIdx + i;
    if (!wrap && idx >= buf.length) break;
    const pos = wrap ? ((idx % buf.length) + buf.length) % buf.length : idx;
    if (pos < 0) continue;
    const u = i / len;
    if ((i & 7) === 0) bp.setBandpass(f0 * Math.pow(Math.max(40, f1) / Math.max(40, f0), u), q, sr);
    const env = (i < atk ? i / atk : 1) * Math.exp(-3.2 * u);
    const flt = flutterHz > 0 ? 1 - flutterDepth * 0.5 * (1 - Math.cos(2 * Math.PI * flutterHz * (i / sr))) : 1;
    buf[pos] = buf[pos]! + bp.step(nextRand(rng)) * gain * env * flt;
  }
}

function addSubSweep(buf: Float32Array, sr: number, f0: number, f1: number, durSec: number, gain: number): void {
  const len = Math.min(buf.length, Math.floor(durSec * sr));
  let phase = 0;
  for (let i = 0; i < len; i++) {
    const u = i / len;
    const f = f0 * Math.pow(f1 / f0, u);
    phase += (2 * Math.PI * f) / sr;
    buf[i] = buf[i]! + Math.sin(phase) * gain * Math.exp(-3.8 * u);
  }
}

function renderSound(r: RawSoundRecipe, sr: number): Float32Array {
  const len = Math.max(64, Math.round((r.targetMs / 1000) * sr));
  const buf = new Float32Array(len);
  const rng = { s: 0x1a2b3c4d + r.id * 977 };
  const durSec = len / sr;

  switch (r.kind) {
    case 'modal': {
      const mat = r.material ?? 'cup';
      addFilteredNoise(buf, sr, 0, 0.004, r.clickHz ?? 3200, r.clickHz ?? 3200, 1.8, r.clickGain ?? 0.25, rng);
      addModal(buf, sr, 0, r.baseHz ?? 1000, PARTIALS[mat], 0.85, r.decayScale ?? 1.0);
      if (r.subHz0 && r.subHz1 && r.subGain) addSubSweep(buf, sr, r.subHz0, r.subHz1, durSec * 0.65, r.subGain);
      break;
    }
    case 'doubleModal': {
      const mat = r.material ?? 'plate';
      const gap = Math.floor(((r.gapMs ?? 8) / 1000) * sr);
      addFilteredNoise(buf, sr, 0, 0.004, r.clickHz ?? 3200, r.clickHz ?? 3200, 1.8, r.clickGain ?? 0.25, rng);
      addModal(buf, sr, 0, r.baseHz ?? 1200, PARTIALS[mat], 0.75, r.decayScale ?? 1.0);
      addModal(buf, sr, gap, r.baseHz2 ?? 1400, PARTIALS[mat], 0.65, (r.decayScale ?? 1.0) * 0.9);
      break;
    }
    case 'shatter': {
      const mat = r.material ?? 'plate';
      const pieces = r.pieces ?? 12;
      const span = Math.floor(((r.spanMs ?? r.targetMs * 0.85) / 1000) * sr);
      addFilteredNoise(buf, sr, 0, durSec * 0.72, r.noiseHz0 ?? 3400, r.noiseHz1 ?? 2000, 1.4, 0.36, rng);
      for (let i = 0; i < pieces; i++) {
        const offset = Math.floor((i / pieces) * span * 0.82);
        const jitter = 0.82 + ((i * 53 + r.id * 17) % 100) / 190;
        const slope = r.risePitch ? 0.78 + 0.45 * (i / pieces) : 1.0;
        addModal(buf, sr, offset, (r.baseHz ?? 1200) * jitter * slope, PARTIALS[mat], 0.34, 0.58);
      }
      if (r.subHz0 && r.subHz1 && r.subGain) addSubSweep(buf, sr, r.subHz0, r.subHz1, durSec * 0.35, r.subGain);
      break;
    }
    case 'air': {
      addFilteredNoise(
        buf, sr, 0, durSec * 0.96, r.freq0 ?? 1600, r.freq1 ?? 1000, r.q ?? 2.0,
        0.75, rng, r.flutterHz ?? 0, r.flutterDepth ?? 0,
      );
      if (r.whistle0 && r.whistle1 && r.whistleGain) {
        let ph = 0;
        const vibHz = r.vibHz ?? 0;
        const vibDepth = r.vibDepth ?? 0;
        for (let i = 0; i < len; i++) {
          const u = i / len;
          const vib = vibHz > 0 ? 1 + vibDepth * Math.sin(2 * Math.PI * vibHz * (i / sr)) : 1;
          const f = r.whistle0 * Math.pow(r.whistle1 / r.whistle0, u) * vib;
          ph += (2 * Math.PI * f) / sr;
          const env = Math.sin(Math.min(1, u * 12) * Math.PI * 0.5) * Math.exp(-1.6 * u);
          buf[i] = buf[i]! + Math.sin(ph) * r.whistleGain * env;
        }
      }
      break;
    }
    case 'fm': {
      const f0 = r.f0 ?? 320;
      const f1 = r.f1 ?? 580;
      const modRatio = r.modRatio ?? 1.5;
      const modIdx = r.modIdx ?? 1.5;
      let cPh = 0; let mPh = 0;
      for (let i = 0; i < len; i++) {
        const u = i / len;
        const f = f0 * Math.pow(f1 / f0, u);
        cPh += (2 * Math.PI * f) / sr;
        mPh += (2 * Math.PI * f * modRatio) / sr;
        const env = Math.sin(Math.min(1, u * 16) * Math.PI * 0.5) * Math.exp(-3.4 * u);
        buf[i] = buf[i]! + Math.sin(cPh + modIdx * Math.exp(-4 * u) * Math.sin(mPh)) * 0.7 * env;
      }
      if (r.airHz && r.airGain) addFilteredNoise(buf, sr, 0, durSec * 0.6, r.airHz, r.airHz * 0.65, 1.8, r.airGain, rng);
      if (r.modalHz) addModal(buf, sr, Math.floor(0.025 * sr), r.modalHz, PARTIALS.wood, 0.5, 0.75);
      break;
    }
    case 'arpeggio': {
      const notes = r.notesHz ?? [1174.66, 1396.91, 1760];
      const step = Math.floor(((r.stepMs ?? 110) / 1000) * sr);
      for (let i = 0; i < notes.length; i++) {
        addModal(buf, sr, i * step, notes[i]!, PARTIALS[r.material ?? 'cup'], 0.65, r.decayScale ?? 1.5);
      }
      break;
    }
    default:
      return assertNever(r.kind, 'audio-dsp.renderSound');
  }
  return normalizeToTarget(buf, sr, recipesData.loudnessTargets.effectsLufs);
}

export function synthesizeSound(id: SoundId, sampleRate: number): Float32Array {
  assertFinite(sampleRate, 'synthesizeSound.sampleRate');
  const recipe = RECIPE_DB.soundMap.get(id);
  if (recipe === undefined) throw new InvariantError(ErrorCode.InvalidEnumValue, `Invalid SoundId: ${String(id)}`);
  return renderSound(recipe, sampleRate);
}

export function synthesizeAuctioneer(line: AuctioneerLineId, sampleRate: number): Float32Array {
  assertFinite(sampleRate, 'synthesizeAuctioneer.sampleRate');
  const recipe = RECIPE_DB.aucMap.get(line);
  if (recipe === undefined) throw new InvariantError(ErrorCode.InvalidEnumValue, `Invalid AuctioneerLineId: ${String(line)}`);
  const len = Math.max(64, Math.round((recipe.targetMs / 1000) * sampleRate));
  const buf = new Float32Array(len);
  const f1 = new Biquad();
  const f2 = new Biquad();

  let lastNoteEnd = 0;
  for (const note of recipe.notes) {
    const start = Math.floor((note.startMs / 1000) * sampleRate);
    const nLen = Math.max(16, Math.floor((note.durMs / 1000) * sampleRate));
    if (start + nLen > lastNoteEnd) lastNoteEnd = start + nLen;
    let ph = 0;
    for (let i = 0; i < nLen && start + i < len; i++) {
      const u = i / nLen;
      const pitch = note.f0 + (note.f1 - note.f0) * u;
      ph += pitch / sampleRate;
      ph -= Math.floor(ph);
      const saw = 2 * ph - 1;
      const wah = note.wah0 + (note.wah1 - note.wah0) * Math.sin(u * Math.PI * 0.85);
      if ((i & 3) === 0) {
        f1.setBandpass(wah, 4.2, sampleRate);
        f2.setBandpass(wah * 1.95, 5.0, sampleRate);
      }
      const env = Math.min(1, (i / sampleRate) / 0.015) * Math.min(1, ((nLen - i) / sampleRate) / 0.025);
      const sig = f1.step(saw) * 0.72 + f2.step(saw) * 0.45;
      buf[start + i] = buf[start + i]! + sig * env;
    }
  }
  const rng = { s: 0x77b01 + line * 31 };
  const gavelStart = lastNoteEnd + Math.floor(0.045 * sampleRate);
  const gavelGap = Math.floor((recipe.gavelGapMs / 1000) * sampleRate);
  for (let g = 0; g < recipe.gavelCount; g++) {
    const idx = Math.min(len - 64, gavelStart + g * gavelGap);
    addFilteredNoise(buf, sampleRate, idx, 0.008, 950, 700, 2.0, 0.35, rng);
    addModal(buf, sampleRate, idx, 520, PARTIALS.wood, 0.72, 0.75);
  }
  return normalizeToTarget(buf, sampleRate, recipesData.loudnessTargets.auctioneerLufs);
}

function addKarplusPluck(buf: Float32Array, sr: number, startIdx: number, hz: number, durSec: number, gain: number, rng: { s: number }): void {
  const delayLen = Math.max(8, Math.round(sr / hz));
  const ring = new Float32Array(delayLen);
  for (let i = 0; i < delayLen; i++) ring[i] = nextRand(rng) * 0.85;
  const n = Math.floor(durSec * sr);
  let ptr = 0;
  let prev = 0;
  for (let i = 0; i < n; i++) {
    const cur = ring[ptr]!;
    const filt = 0.497 * (cur + prev);
    prev = cur;
    ring[ptr] = filt;
    ptr = (ptr + 1) % delayLen;
    const pos = (startIdx + i) % buf.length;
    const env = Math.min(1, i / 48) * Math.exp(-1.9 * (i / n));
    buf[pos] = buf[pos]! + cur * gain * env;
  }
}

export function synthesizeMusicStems(sampleRate: number): { layerA: Float32Array; layerB: Float32Array; layerC: Float32Array } {
  assertFinite(sampleRate, 'synthesizeMusicStems.sampleRate');
  const m = recipesData.music;
  const totalSec = (m.bars * m.beatsPerBar * 60) / m.bpm;
  const totalSamples = Math.round(totalSec * sampleRate);
  const layerA = new Float32Array(totalSamples);
  const layerB = new Float32Array(totalSamples);
  const layerC = new Float32Array(totalSamples);
  const beatSamples = (60 / m.bpm) * sampleRate;
  const rng = { s: 0x4242cafe };

  for (let bar = 0; bar < m.bars; bar++) {
    const rootMidi = m.chordsRootMidi[bar]!;
    const melody = m.melodyNotesMidi[bar]!;
    for (let beat = 0; beat < m.beatsPerBar; beat++) {
      const bIdx = Math.round((bar * m.beatsPerBar + beat) * beatSamples);
      const bassHz = midiToHz(rootMidi + m.bassOffsets[beat]!);
      addKarplusPluck(layerA, sampleRate, bIdx, bassHz, 0.42, 0.46, rng);

      // Swing eighth notes: on-beat + swung off-beat
      const m0 = midiToHz(melody[beat * 2]!);
      const m1 = midiToHz(melody[beat * 2 + 1]!);
      const offIdx = bIdx + Math.round(beatSamples * m.swingRatio);
      addModal(layerA, sampleRate, bIdx, m0, PARTIALS.cup, 0.24, 2.2, true);
      addModal(layerA, sampleRate, offIdx, m1, PARTIALS.cup, 0.19, 1.9, true);

      // Layer B: tuned ceramic cup ostinato + brushed snare on beats 2 & 4
      const ost0 = midiToHz(m.cupOstinatoMidi[(beat * 2) % m.cupOstinatoMidi.length]!);
      const ost1 = midiToHz(m.cupOstinatoMidi[(beat * 2 + 1) % m.cupOstinatoMidi.length]!);
      addModal(layerB, sampleRate, bIdx, ost0, PARTIALS.cup, 0.24, 1.1, true);
      addModal(layerB, sampleRate, offIdx, ost1, PARTIALS.cup, 0.18, 1.0, true);
      if (beat === 1 || beat === 3) {
        addFilteredNoise(layerB, sampleRate, bIdx, 0.095, 2400, 1400, 1.3, 0.28, rng, 0, 0, true);
      } else {
        addFilteredNoise(layerB, sampleRate, offIdx, 0.055, 3100, 2200, 1.6, 0.14, rng, 0, 0, true);
      }

      // Layer C: double-time cup ostinato + excited rim clicks for Last Call
      for (let sub = 0; sub < 4; sub++) {
        const sIdx = bIdx + Math.round((sub / 4) * beatSamples);
        const cMidi = m.cupOstinatoMidi[(beat * 4 + sub) % m.cupOstinatoMidi.length]!;
        addModal(layerC, sampleRate, sIdx, midiToHz(cMidi), PARTIALS.cup, sub === 0 ? 0.26 : 0.18, 0.85, true);
        if (sub === 0 || sub === 2) addModal(layerC, sampleRate, sIdx, 920, PARTIALS.wood, 0.16, 0.45, true);
      }
    }
  }

  // Smooth edge taper on discrete transients so first/last 50 ms share exact loop-periodic A3/A4/E5 tea-room resonance
  // 220/440/660 Hz divide BOTH the 320/11s loop (6400/12800/19200 cycles) AND 50 ms (11/22/33 cycles)
  const taperSamples = Math.floor(0.095 * sampleRate);
  const wA = (2 * Math.PI * 220) / sampleRate;
  for (const stem of [layerA, layerB, layerC]) {
    for (let i = 0; i < taperSamples; i++) {
      const k = i / taperSamples;
      const fadeIn = Math.pow(Math.sin(k * Math.PI * 0.5), 2);
      const fadeOut = Math.pow(Math.cos(k * Math.PI * 0.5), 2);
      stem[i] = stem[i]! * fadeIn;
      const tail = totalSamples - taperSamples + i;
      stem[tail] = stem[tail]! * fadeOut;
    }
    for (let i = 0; i < totalSamples; i++) {
      const drone = 0.16 * Math.sin(wA * i) + 0.08 * Math.sin(2 * wA * i) + 0.04 * Math.sin(3 * wA * i);
      stem[i] = stem[i]! + drone;
    }
    normalizeToTarget(stem, sampleRate, recipesData.loudnessTargets.musicLufs);
  }
  return { layerA, layerB, layerC };
}

export function synthesizeRoomImpulse(sampleRate: number): Float32Array {
  assertFinite(sampleRate, 'synthesizeRoomImpulse.sampleRate');
  const ri = recipesData.roomImpulse;
  const len = Math.max(32, Math.round((ri.durationMs / 1000) * sampleRate));
  const buf = new Float32Array(len);
  const rng = { s: ri.seed };
  const decaySamples = (ri.decayMs / 1000) * sampleRate;
  const bp = new Biquad();
  bp.setBandpass(1800, 0.7, sampleRate);
  for (let i = 0; i < len; i++) {
    const env = Math.exp(-i / decaySamples);
    buf[i] = bp.step(nextRand(rng)) * env * 0.45;
  }
  buf[0] = 0.65;
  const tap1 = Math.min(len - 1, Math.round(0.011 * sampleRate));
  const tap2 = Math.min(len - 1, Math.round(0.023 * sampleRate));
  buf[tap1] = buf[tap1]! + 0.3;
  buf[tap2] = buf[tap2]! + 0.18;
  return buf;
}
