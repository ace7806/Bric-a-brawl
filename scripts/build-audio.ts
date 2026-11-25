import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  AUDIO_RECIPE_META, computeLufs, synthesizeAuctioneer, synthesizeMusicStems, synthesizeSound,
  type AudioFamily,
} from '../src/client/audio-dsp';
import { AuctioneerLineId, SoundId } from '../src/client/enums';

const ROOT = resolve(import.meta.dirname, '..');
const OUT_DIR = resolve(ROOT, 'evidence/M5');
const SR = AUDIO_RECIPE_META.sampleRate;

interface CueCheckReport {
  readonly kind: 'sound' | 'auctioneer' | 'music';
  readonly id: number;
  readonly name: string;
  readonly family: AudioFamily;
  readonly durationMs: number;
  readonly targetMs: number;
  readonly peakDbfs: number;
  readonly lufs: number;
  readonly centroidHz: number;
  readonly silent: boolean;
  readonly clipped: boolean;
  readonly passed: boolean;
  readonly failures: readonly string[];
}

function measureStats(buf: Float32Array, sr: number) {
  let maxAbs = 0;
  let sumSq = 0;
  let clipped = false;
  for (let i = 0; i < buf.length; i++) {
    const v = buf[i]!;
    if (!Number.isFinite(v)) clipped = true;
    const av = Math.abs(v);
    if (av > maxAbs) maxAbs = av;
    if (av >= 0.999) clipped = true;
    sumSq += v * v;
  }
  const rms = Math.sqrt(sumSq / Math.max(1, buf.length));
  const peakDbfs = maxAbs > 1e-12 ? 20 * Math.log10(maxAbs) : -120;
  const lufs = computeLufs(buf, sr);

  // Energy-weighted DFT spectral centroid over top-energy window or full clip (1024-pt Hann DFT)
  const nFft = 1024;
  let bestStart = 0;
  let bestEnergy = -1;
  const step = Math.max(128, Math.floor((buf.length - nFft) / 8));
  if (buf.length > nFft) {
    for (let s = 0; s <= buf.length - nFft; s += step) {
      let e = 0;
      for (let i = 0; i < nFft; i++) e += buf[s + i]! * buf[s + i]!;
      if (e > bestEnergy) { bestEnergy = e; bestStart = s; }
    }
  }
  const win = new Float32Array(nFft);
  const avail = Math.min(nFft, buf.length - bestStart);
  for (let i = 0; i < avail; i++) {
    const w = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (avail - 1 || 1)));
    win[i] = buf[bestStart + i]! * w;
  }
  let num = 0;
  let den = 0;
  for (let k = 1; k < nFft / 2; k++) {
    let re = 0;
    let im = 0;
    const stepW = (2 * Math.PI * k) / nFft;
    for (let n = 0; n < nFft; n++) {
      const ang = stepW * n;
      re += win[n]! * Math.cos(ang);
      im -= win[n]! * Math.sin(ang);
    }
    const pow = re * re + im * im;
    const freq = (k * sr) / nFft;
    num += freq * pow;
    den += pow;
  }
  const centroidHz = den > 1e-12 ? num / den : 0;
  return {
    durationMs: (buf.length / sr) * 1000,
    peakDbfs,
    lufs,
    centroidHz,
    silent: rms < 1e-4,
    clipped,
  };
}

function pearsonCorrelation(a: Float32Array, b: Float32Array): number {
  let meanA = 0; let meanB = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) { meanA += a[i]!; meanB += b[i]!; }
  meanA /= n; meanB /= n;
  let num = 0; let denA = 0; let denB = 0;
  for (let i = 0; i < n; i++) {
    const da = a[i]! - meanA;
    const db = b[i]! - meanB;
    num += da * db;
    denA += da * da;
    denB += db * db;
  }
  return denA > 0 && denB > 0 ? num / Math.sqrt(denA * denB) : 0;
}

function validateCue(
  kind: 'sound' | 'auctioneer' | 'music', id: number, name: string, family: AudioFamily,
  targetMs: number, buf: Float32Array,
): CueCheckReport {
  const s = measureStats(buf, SR);
  const failures: string[] = [];
  if (s.silent) failures.push('silent');
  if (s.clipped) failures.push('clipped');
  if (s.peakDbfs >= -1.0) failures.push(`peak ${s.peakDbfs.toFixed(2)} >= -1.0 dBFS`);
  if (kind !== 'music' && s.durationMs > 2500) failures.push(`duration ${s.durationMs.toFixed(1)} ms > 2500 ms`);
  if (Math.abs(s.durationMs - targetMs) > targetMs * 0.2) {
    failures.push(`duration ${s.durationMs.toFixed(1)} ms outside +-20% of ${targetMs} ms`);
  }

  const lufsTarget = kind === 'music' ? -20 : kind === 'auctioneer' ? -14 : -16;
  if (s.lufs < lufsTarget - 2 || s.lufs > lufsTarget + 2) {
    failures.push(`lufs ${s.lufs.toFixed(2)} outside ${lufsTarget} +-2`);
  }
  if (family === 'ceramic' && (s.centroidHz < 2000 || s.centroidHz > 6000)) {
    failures.push(`ceramic centroid ${s.centroidHz.toFixed(0)} Hz outside 2000..6000`);
  }
  if (family === 'air' && (s.centroidHz < 800 || s.centroidHz > 3000)) {
    failures.push(`air centroid ${s.centroidHz.toFixed(0)} Hz outside 800..3000`);
  }
  if (family === 'wood' && (s.centroidHz < 400 || s.centroidHz > 1500)) {
    failures.push(`wood centroid ${s.centroidHz.toFixed(0)} Hz outside 400..1500`);
  }

  return {
    kind, id, name, family,
    durationMs: Number(s.durationMs.toFixed(2)),
    targetMs,
    peakDbfs: Number(s.peakDbfs.toFixed(2)),
    lufs: Number(s.lufs.toFixed(2)),
    centroidHz: Number(s.centroidHz.toFixed(1)),
    silent: s.silent,
    clipped: s.clipped,
    passed: failures.length === 0,
    failures,
  };
}

function encodeMonoWav16(samples: Float32Array, sr: number): Buffer {
  const dataBytes = samples.length * 2;
  const out = Buffer.allocUnsafe(44 + dataBytes);
  out.write('RIFF', 0, 4, 'ascii');
  out.writeUInt32LE(36 + dataBytes, 4);
  out.write('WAVE', 8, 4, 'ascii');
  out.write('fmt ', 12, 4, 'ascii');
  out.writeUInt32LE(16, 16);
  out.writeUInt16LE(1, 20);
  out.writeUInt16LE(1, 22);
  out.writeUInt32LE(sr, 24);
  out.writeUInt32LE(sr * 2, 28);
  out.writeUInt16LE(2, 32);
  out.writeUInt16LE(16, 34);
  out.write('data', 36, 4, 'ascii');
  out.writeUInt32LE(dataBytes, 40);
  for (let i = 0; i < samples.length; i++) {
    const v = Math.max(-1, Math.min(1, samples[i]!));
    out.writeInt16LE(Math.round(v * 32767), 44 + i * 2);
  }
  return out;
}

function buildReviewReel(
  sounds: ReadonlyMap<SoundId, Float32Array>,
  auctioneer: ReadonlyMap<AuctioneerLineId, Float32Array>,
  stems: { layerA: Float32Array; layerB: Float32Array; layerC: Float32Array },
): Float32Array {
  const reelSec = 60.0;
  const reel = new Float32Array(Math.round(reelSec * SR));
  const mix = (clip: Float32Array, atSec: number, gain = 1.0, rate = 1.0): void => {
    const start = Math.round(atSec * SR);
    const outLen = Math.floor(clip.length / rate);
    for (let i = 0; i < outLen && start + i < reel.length; i++) {
      const pos = i * rate;
      const i0 = Math.floor(pos);
      const frac = pos - i0;
      const s = clip[i0]! * (1 - frac) + (clip[Math.min(clip.length - 1, i0 + 1)]!) * frac;
      reel[start + i] = reel[start + i]! + s * gain;
    }
  };
  const playSfx = (id: SoundId, atSec: number, gain = 0.85, rate = 1.0) => mix(sounds.get(id)!, atSec, gain, rate);
  const playAuc = (id: AuctioneerLineId, atSec: number, gain = 0.95) => mix(auctioneer.get(id)!, atSec, gain, 1.0);

  // 0..4s: Lobby Mantel Clock + UI confirm
  for (let t = 0; t < 4; t++) playSfx(SoundId.ClockTick, 0.25 + t * 1.0, 0.7);
  playSfx(SoundId.PlatterOn, 2.5, 0.8);
  playSfx(SoundId.PlatterAll, 3.2, 0.85);

  // 4..12s: Round countdown, Auctioneer Lot + DoIHearAFight, Ceramic Movement & Combat hits + Parry Bowl!
  playSfx(SoundId.CountTick, 4.0, 0.75);
  playSfx(SoundId.CountTick, 4.6, 0.75);
  playSfx(SoundId.CountGo, 5.2, 0.85);
  playAuc(AuctioneerLineId.LotNumber, 5.6);
  playAuc(AuctioneerLineId.DoIHearAFight, 6.7);
  playSfx(SoundId.StepChina, 7.8, 0.75);
  playSfx(SoundId.StepChina, 8.05, 0.75);
  playSfx(SoundId.Jump, 8.3, 0.8);
  playSfx(SoundId.HitLight, 8.6, 0.85);
  playSfx(SoundId.HitMid, 9.0, 0.9);
  playSfx(SoundId.HitHeavy, 9.5, 0.95);
  playSfx(SoundId.Guard, 10.1, 0.85);
  playSfx(SoundId.Parry, 10.5, 0.95);

  // 12..20s: Fighter Signatures (Earl, Grog, Nesta, Moss) + Gadgets
  playSfx(SoundId.EarlPuff, 12.1, 0.85);
  playSfx(SoundId.EarlPop, 12.6, 0.85);
  playSfx(SoundId.GrogSnort, 13.2, 0.85);
  playSfx(SoundId.GrogStamp, 13.7, 0.9, 0.75);
  playSfx(SoundId.NestaPop, 14.4, 0.85, 1.5);
  playSfx(SoundId.MossCast, 15.0, 0.85);
  playSfx(SoundId.Bellows, 15.6, 0.85);
  playSfx(SoundId.PlungerFire, 16.2, 0.85);
  playSfx(SoundId.CorkPop, 16.7, 0.9);
  playSfx(SoundId.PepperGrind, 17.2, 0.85);
  playSfx(SoundId.Sneeze, 17.8, 0.85);
  playSfx(SoundId.ToasterDing, 18.4, 0.9);
  playSfx(SoundId.JamSplat, 19.1, 0.85);
  playSfx(SoundId.TimerRewind, 19.5, 0.85);

  // 20..28s: Island fracture + Launch + KO Smash + Auctioneer Going/Gone/Withdrawn
  playSfx(SoundId.Craze, 20.1, 0.85);
  playSfx(SoundId.ChunkBreak, 21.6, 0.9);
  playSfx(SoundId.SpoonTink, 22.3, 0.9);
  playSfx(SoundId.LaunchWhistle, 22.9, 0.85);
  playAuc(AuctioneerLineId.Going, 23.0);
  playSfx(SoundId.KoSmash, 24.1, 1.0);
  playAuc(AuctioneerLineId.Gone, 25.0);
  playSfx(SoundId.PourWhistle, 25.9, 0.75);
  playSfx(SoundId.BowlSplit, 27.0, 0.85);

  // 28..55s: Tea Service Music Progression: Layer A -> A+B -> ClockChime + A+B+C -> Sudden Death (1.12x)
  const musicStart = Math.round(28.5 * SR);
  const loopLen = stems.layerA.length;
  const musicDurSamples = Math.round(26.5 * SR);
  for (let i = 0; i < musicDurSamples && musicStart + i < reel.length; i++) {
    const t = i / SR;
    const rate = t >= 20.0 ? 1.12 : 1.0;
    const srcIdx = Math.floor(i * rate) % loopLen;
    const gainB = t >= 6.0 ? Math.min(1, (t - 6.0) / 0.5) : 0;
    const gainC = t >= 13.0 ? Math.min(1, (t - 13.0) / 0.5) : 0;
    const duck = (t >= 12.8 && t <= 14.5) || (t >= 19.8 && t <= 21.2) ? 0.5 : 1.0;
    const sample = stems.layerA[srcIdx]! + stems.layerB[srcIdx]! * gainB + stems.layerC[srcIdx]! * gainC;
    reel[musicStart + i] = reel[musicStart + i]! + sample * 0.52 * duck;
  }
  playSfx(SoundId.ClockChime, 41.4, 0.85);
  playAuc(AuctioneerLineId.LastCall, 42.1);
  playAuc(AuctioneerLineId.FairWarning, 48.5);
  playSfx(SoundId.KoSmash, 52.0, 0.95);
  playAuc(AuctioneerLineId.Pair, 53.0);

  // 55..60s: Results: music stops -> Sold! -> HammerFalls -> Mantel Clock
  playAuc(AuctioneerLineId.Sold, 55.2);
  playAuc(AuctioneerLineId.HammerFalls, 56.6);
  playSfx(SoundId.ClockTick, 58.9, 0.7);

  // Soft limiter on final reel so peak < -1.0 dBFS
  for (let i = 0; i < reel.length; i++) {
    reel[i] = Math.tanh(reel[i]! * 0.85) * 0.88;
  }
  return reel;
}

function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  const cues: CueCheckReport[] = [];
  const renderedSounds = new Map<SoundId, Float32Array>();
  const renderedAuc = new Map<AuctioneerLineId, Float32Array>();

  for (const [id, meta] of AUDIO_RECIPE_META.sounds) {
    const buf = synthesizeSound(id, SR);
    renderedSounds.set(id, buf);
    cues.push(validateCue('sound', id, meta.name, meta.family, meta.targetMs, buf));
  }
  for (const [line, meta] of AUDIO_RECIPE_META.auctioneer) {
    const buf = synthesizeAuctioneer(line, SR);
    renderedAuc.set(line, buf);
    cues.push(validateCue('auctioneer', line, meta.name, meta.family, meta.targetMs, buf));
  }

  const stems = synthesizeMusicStems(SR);
  const seamSamples = Math.floor((AUDIO_RECIPE_META.music.seamMs / 1000) * SR);
  const seamCorrelations: Record<string, number> = {};
  const stemEntries = [
    ['TeaService_LayerA', stems.layerA, 100],
    ['TeaService_LayerB', stems.layerB, 101],
    ['TeaService_LayerC', stems.layerC, 102],
  ] as const;

  let seamPassed = true;
  for (const [name, buf, id] of stemEntries) {
    cues.push(validateCue('music', id, name, 'music', AUDIO_RECIPE_META.music.targetMs, buf));
    const head = buf.subarray(0, seamSamples);
    const tail = buf.subarray(buf.length - seamSamples);
    const corr = pearsonCorrelation(head, tail);
    seamCorrelations[name] = Number(corr.toFixed(4));
    if (corr <= 0.9) seamPassed = false;
  }

  const reel = buildReviewReel(renderedSounds, renderedAuc, stems);
  const wavBuf = encodeMonoWav16(reel, SR);
  const wavPath = resolve(OUT_DIR, 'audio-reel.wav');
  writeFileSync(wavPath, wavBuf);

  const failingCues = cues.filter((c) => !c.passed);
  const allPassed = failingCues.length === 0 && seamPassed;
  const report = {
    sampleRate: SR,
    totalCues: cues.length,
    soundCount: AUDIO_RECIPE_META.sounds.size,
    auctioneerCount: AUDIO_RECIPE_META.auctioneer.size,
    musicStemCount: stemEntries.length,
    seamCorrelations,
    seamPassed,
    reelDurationSec: Number((reel.length / SR).toFixed(2)),
    reelBytes: wavBuf.length,
    allPassed,
    failingCueCount: failingCues.length,
    cues,
  };
  const reportPath = resolve(OUT_DIR, 'audio-report.json');
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

  if (!allPassed) {
    console.error(`[build-audio] FAILED (${failingCues.length} failing cues, seamPassed=${seamPassed})`);
    for (const c of failingCues) console.error(`  - [${c.kind}:${c.id}] ${c.name}: ${c.failures.join('; ')}`);
    if (!seamPassed) console.error(`  - seamCorrelations: ${JSON.stringify(seamCorrelations)}`);
    process.exit(1);
  }
  console.log(
    `[build-audio] PASS: ${cues.length} cues (${AUDIO_RECIPE_META.sounds.size} SFX, ${AUDIO_RECIPE_META.auctioneer.size} auctioneer, 3 stems), seam=${JSON.stringify(seamCorrelations)}, reel=${report.reelDurationSec}s (${(wavBuf.length / 1024).toFixed(0)} KB)`,
  );
}

main();
