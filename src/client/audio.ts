import { assert, assertFinite, assertNever, requireKey } from '@sim/assert';
import { ErrorCode, FighterId, NestaSize } from '@sim/enums';
import {
  AUDIO_RECIPE_META, synthesizeAuctioneer, synthesizeMusicStems, synthesizeRoomImpulse, synthesizeSound,
  type AudioBusName,
} from './audio-dsp';
import { AuctioneerLineId, MusicPhase, SoundId } from './enums';

const MAX_VOICES = 24;
const MAX_SAME_SOUND = 3;
const SAMPLE_RATE = AUDIO_RECIPE_META.sampleRate;
const ROOM_WET_MIX = 0.12;

export type { AudioBusName };

export interface PlaySoundOptions {
  readonly pan?: number;
  readonly pitchScale?: number;
  readonly gainScale?: number;
}

export function fighterPitchScale(id: FighterId, nestaSize?: NestaSize): number {
  switch (id) {
    case FighterId.Earl: return 1.0;
    case FighterId.Grog: return 0.75; // a fourth lower
    case FighterId.Moss: return 1.04;
    case FighterId.Nesta: {
      if (nestaSize === NestaSize.Small) return 1.5; // a fifth higher
      if (nestaSize === NestaSize.Mid) return 1.25;
      return 1.0;
    }
    default: return assertNever(id, 'fighterPitchScale');
  }
}

function toAudioBuffer(ctx: AudioContext, samples: Float32Array, sr: number): AudioBuffer {
  const buf = ctx.createBuffer(1, samples.length, sr);
  buf.getChannelData(0).set(samples);
  return buf;
}

const UNLOCK_EVENTS = ['pointerdown', 'touchstart', 'touchend', 'click', 'keydown'] as const;

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private effectsGain: GainNode | null = null;
  private musicGain: GainNode | null = null;
  private musicDuckGain: GainNode | null = null;
  private auctioneerGain: GainNode | null = null;
  private uiGain: GainNode | null = null;

  private readonly soundBuffers = new Map<SoundId, AudioBuffer>();
  private readonly auctioneerBuffers = new Map<AuctioneerLineId, AudioBuffer>();
  private musicStems: { layerA: AudioBuffer; layerB: AudioBuffer; layerC: AudioBuffer } | null = null;
  private activeMusicSources: Array<{ src: AudioBufferSourceNode; gain: GainNode }> = [];
  private musicPhase: MusicPhase = MusicPhase.Silent;
  private clockTimer: number | null = null;

  private volume = 0.7;
  private readonly busVolumes: Record<AudioBusName, number> = { effects: 1.0, music: 0.75, auctioneer: 0.9, ui: 0.85 };
  private muted = false;
  private unlocked = false;
  private onUnlockChange: ((unlocked: boolean) => void) | null = null;
  private pendingSound: { readonly id: SoundId; readonly opts: PlaySoundOptions } | null = null;
  private activeVoices = 0;
  private readonly perSoundActive = new Map<SoundId, number>();
  private detuneStep = 0;

  private readonly onGesture = (): void => {
    this.unlock();
  };

  public attachUnlockListeners(): void {
    if (typeof window === 'undefined') return;
    for (const ev of UNLOCK_EVENTS) {
      window.addEventListener(ev, this.onGesture, { capture: true, passive: true });
    }
  }

  public detachUnlockListeners(): void {
    if (typeof window === 'undefined') return;
    for (const ev of UNLOCK_EVENTS) {
      window.removeEventListener(ev, this.onGesture, { capture: true });
    }
  }

  public setOnUnlockChange(cb: ((unlocked: boolean) => void) | null): void {
    this.onUnlockChange = cb;
  }

  public getAudioContextState(): AudioContextState | 'uninitialized' {
    return this.ctx ? this.ctx.state : 'uninitialized';
  }

  public unlock(): void {
    if (typeof window === 'undefined') return;
    if (this.ctx === null) {
      const Ctor = window.AudioContext;
      if (!Ctor) return;
      const ctx = new Ctor();
      this.ctx = ctx;

      this.masterGain = ctx.createGain();
      this.masterGain.gain.value = this.muted ? 0 : this.volume;
      this.masterGain.connect(ctx.destination);

      this.effectsGain = ctx.createGain();
      this.effectsGain.gain.value = this.busVolumes.effects;
      const dryEffects = ctx.createGain();
      dryEffects.gain.value = 1 - ROOM_WET_MIX;
      const wetEffects = ctx.createGain();
      wetEffects.gain.value = ROOM_WET_MIX;
      const convolver = ctx.createConvolver();
      convolver.buffer = toAudioBuffer(ctx, synthesizeRoomImpulse(ctx.sampleRate), ctx.sampleRate);
      this.effectsGain.connect(dryEffects);
      this.effectsGain.connect(convolver);
      convolver.connect(wetEffects);
      dryEffects.connect(this.masterGain);
      wetEffects.connect(this.masterGain);

      this.musicDuckGain = ctx.createGain();
      this.musicDuckGain.gain.value = 1.0;
      this.musicGain = ctx.createGain();
      this.musicGain.gain.value = this.busVolumes.music;
      this.musicGain.connect(this.musicDuckGain);
      this.musicDuckGain.connect(this.masterGain);

      this.auctioneerGain = ctx.createGain();
      this.auctioneerGain.gain.value = this.busVolumes.auctioneer;
      this.auctioneerGain.connect(this.masterGain);

      this.uiGain = ctx.createGain();
      this.uiGain.gain.value = this.busVolumes.ui;
      this.uiGain.connect(this.masterGain);
    }

    if (!this.unlocked) {
      const silent = this.ctx.createBuffer(1, 1, this.ctx.sampleRate);
      const src = this.ctx.createBufferSource();
      src.buffer = silent;
      src.connect(this.ctx.destination);
      src.start(0);
    }

    if (this.ctx.state === 'suspended') {
      void this.ctx.resume().then(() => this.onContextRunning(), () => undefined);
    } else if (this.ctx.state === 'running') {
      this.onContextRunning();
    }
  }

  private onContextRunning(): void {
    if (this.ctx === null) return;
    const wasUnlocked = this.unlocked;
    this.unlocked = true;
    this.detachUnlockListeners();
    if (!wasUnlocked) {
      this.onUnlockChange?.(true);
    }

    const pending = this.pendingSound;
    this.pendingSound = null;
    if (pending !== null && this.ctx.state !== 'suspended') {
      this.play(pending.id, pending.opts);
    }

    if (this.musicPhase !== MusicPhase.Silent && this.activeMusicSources.length === 0 && this.clockTimer === null) {
      if (!wasUnlocked || this.musicPhase !== MusicPhase.Results) {
        this.applyMusicPhase(this.musicPhase);
      }
    }

    if (!wasUnlocked && this.musicStems === null) {
      setTimeout(() => {
        if (this.ctx) this.getOrSynthMusicStems(this.ctx);
      }, 120);
    }
  }

  private getOrSynthSound(ctx: AudioContext, id: SoundId): AudioBuffer {
    const cached = this.soundBuffers.get(id);
    if (cached !== undefined) return cached;
    requireKey(AUDIO_RECIPE_META.sounds, id, 'AUDIO_RECIPE_META.sounds');
    const buf = toAudioBuffer(ctx, synthesizeSound(id, SAMPLE_RATE), SAMPLE_RATE);
    this.soundBuffers.set(id, buf);
    return buf;
  }

  private getOrSynthAuctioneer(ctx: AudioContext, line: AuctioneerLineId): AudioBuffer {
    const cached = this.auctioneerBuffers.get(line);
    if (cached !== undefined) return cached;
    requireKey(AUDIO_RECIPE_META.auctioneer, line, 'AUDIO_RECIPE_META.auctioneer');
    const buf = toAudioBuffer(ctx, synthesizeAuctioneer(line, SAMPLE_RATE), SAMPLE_RATE);
    this.auctioneerBuffers.set(line, buf);
    return buf;
  }

  private getOrSynthMusicStems(ctx: AudioContext): { layerA: AudioBuffer; layerB: AudioBuffer; layerC: AudioBuffer } {
    if (this.musicStems !== null) return this.musicStems;
    const stems = synthesizeMusicStems(SAMPLE_RATE);
    this.musicStems = {
      layerA: toAudioBuffer(ctx, stems.layerA, SAMPLE_RATE),
      layerB: toAudioBuffer(ctx, stems.layerB, SAMPLE_RATE),
      layerC: toAudioBuffer(ctx, stems.layerC, SAMPLE_RATE),
    };
    return this.musicStems;
  }

  public isUnlocked(): boolean {
    return this.unlocked;
  }

  public setVolume(v: number): void {
    assertFinite(v, 'audio.volume');
    assert(v >= 0 && v <= 1, ErrorCode.InvariantViolation, `Volume must be in [0, 1], got ${v}`);
    this.volume = v;
    if (this.masterGain && this.ctx) {
      this.masterGain.gain.setTargetAtTime(this.muted ? 0 : this.volume, this.ctx.currentTime, 0.015);
    }
  }

  public getVolume(): number {
    return this.volume;
  }

  public setBusVolume(bus: AudioBusName, v: number): void {
    assertFinite(v, `audio.bus.${bus}`);
    assert(v >= 0 && v <= 1, ErrorCode.InvariantViolation, `Bus volume must be in [0, 1], got ${v}`);
    this.busVolumes[bus] = v;
    const node = this.getBusNode(bus);
    if (node && this.ctx) node.gain.setTargetAtTime(v, this.ctx.currentTime, 0.015);
  }

  public getBusVolume(bus: AudioBusName): number {
    return this.busVolumes[bus];
  }

  public setMuted(muted: boolean): void {
    this.muted = muted;
    if (this.masterGain && this.ctx) {
      this.masterGain.gain.setTargetAtTime(muted ? 0 : this.volume, this.ctx.currentTime, 0.015);
    }
  }

  public isMuted(): boolean {
    return this.muted;
  }

  private getBusNode(bus: AudioBusName): GainNode | null {
    switch (bus) {
      case 'effects': return this.effectsGain;
      case 'music': return this.musicGain;
      case 'auctioneer': return this.auctioneerGain;
      case 'ui': return this.uiGain;
      default: return assertNever(bus, 'AudioEngine.getBusNode');
    }
  }

  private duckMusic(db: number, holdSec: number): void {
    if (!this.ctx || !this.musicDuckGain) return;
    const t0 = this.ctx.currentTime;
    const duckGain = Math.pow(10, db / 20);
    this.musicDuckGain.gain.cancelScheduledValues(t0);
    this.musicDuckGain.gain.setTargetAtTime(duckGain, t0, 0.025);
    this.musicDuckGain.gain.setTargetAtTime(1.0, t0 + holdSec, 0.14);
  }

  public play(id: SoundId, opts: PlaySoundOptions = {}): void {
    if (this.muted || this.ctx === null) return;
    if (this.ctx.state === 'suspended') {
      this.pendingSound = { id, opts };
      void this.ctx.resume().then(() => this.onContextRunning(), () => undefined);
      return;
    }
    if (this.activeVoices >= MAX_VOICES) return;
    const same = this.perSoundActive.get(id) ?? 0;
    if (same >= MAX_SAME_SOUND) return;

    const meta = requireKey(AUDIO_RECIPE_META.sounds, id, 'AUDIO_RECIPE_META.sounds');
    const buf = this.getOrSynthSound(this.ctx, id);
    const busNode = this.getBusNode(meta.bus);
    if (!busNode) return;

    const panVal = Math.max(-0.6, Math.min(0.6, opts.pan ?? 0));
    const jitter = (((this.detuneStep++ % 9) - 4) * 0.01); // deterministic +-4%
    const pitch = Math.max(0.25, Math.min(3.0, (opts.pitchScale ?? 1) * (1 + jitter)));
    const gainScale = opts.gainScale ?? 1;

    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = pitch;
    const voiceGain = this.ctx.createGain();
    voiceGain.gain.value = gainScale;
    const panner = this.ctx.createStereoPanner();
    panner.pan.value = panVal;

    src.connect(voiceGain);
    voiceGain.connect(panner);
    panner.connect(busNode);
    src.start(this.ctx.currentTime);

    const durSec = buf.duration / pitch;
    if (id === SoundId.KoSmash) this.duckMusic(-3, 0.65);
    this.trackVoice(id, durSec);
  }

  public playAuctioneer(line: AuctioneerLineId): void {
    if (this.muted || this.ctx === null || this.auctioneerGain === null || this.ctx.state === 'suspended') return;
    const buf = this.getOrSynthAuctioneer(this.ctx, line);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.connect(this.auctioneerGain);
    src.start(this.ctx.currentTime);
    this.duckMusic(-6, buf.duration);
  }

  public setMusicPhase(phase: MusicPhase): void {
    if (this.musicPhase === phase && (this.activeMusicSources.length > 0 || this.clockTimer !== null || phase === MusicPhase.Silent)) {
      return;
    }
    this.musicPhase = phase;
    if (this.ctx === null || this.ctx.state === 'suspended') return;
    this.applyMusicPhase(phase);
  }

  public getMusicPhase(): MusicPhase {
    return this.musicPhase;
  }

  private stopMusicNodes(): void {
    for (const item of this.activeMusicSources) {
      item.src.stop();
      item.src.disconnect();
      item.gain.disconnect();
    }
    this.activeMusicSources = [];
    if (this.clockTimer !== null && typeof window !== 'undefined') {
      window.clearInterval(this.clockTimer);
      this.clockTimer = null;
    }
  }

  private startMusicLoops(gains: readonly [number, number, number], rate: number): void {
    if (!this.ctx || !this.musicGain) return;
    const stems = this.getOrSynthMusicStems(this.ctx);
    const t0 = this.ctx.currentTime + 0.02;
    if (this.activeMusicSources.length === 3) {
      for (let i = 0; i < 3; i++) {
        const entry = this.activeMusicSources[i]!;
        entry.gain.gain.setTargetAtTime(gains[i]!, t0, 0.12);
        entry.src.playbackRate.setTargetAtTime(rate, t0, 0.08);
      }
      return;
    }
    this.stopMusicNodes();
    const bufs = [stems.layerA, stems.layerB, stems.layerC] as const;
    for (let i = 0; i < 3; i++) {
      const src = this.ctx.createBufferSource();
      src.buffer = bufs[i]!;
      src.loop = true;
      src.playbackRate.value = rate;
      const g = this.ctx.createGain();
      g.gain.value = gains[i]!;
      src.connect(g);
      g.connect(this.musicGain);
      src.start(t0);
      this.activeMusicSources.push({ src, gain: g });
    }
  }

  private startLobbyClock(): void {
    this.stopMusicNodes();
    if (typeof window === 'undefined') return;
    this.play(SoundId.ClockTick, { gainScale: 0.55 });
    this.clockTimer = window.setInterval(() => {
      this.play(SoundId.ClockTick, { gainScale: 0.55 });
    }, 1000);
  }

  private applyMusicPhase(phase: MusicPhase): void {
    switch (phase) {
      case MusicPhase.Silent:
        this.stopMusicNodes();
        break;
      case MusicPhase.Lobby:
        this.startLobbyClock();
        break;
      case MusicPhase.RoundA:
        this.startMusicLoops([1, 0, 0], 1.0);
        break;
      case MusicPhase.RoundAB:
        this.startMusicLoops([1, 1, 0], 1.0);
        break;
      case MusicPhase.LastCall:
        this.play(SoundId.ClockChime);
        this.startMusicLoops([1, 1, 1], 1.0);
        break;
      case MusicPhase.SuddenDeath:
        this.startMusicLoops([1, 1, 1], 1.12);
        break;
      case MusicPhase.Results:
        this.stopMusicNodes();
        this.play(SoundId.CountGo);
        this.play(SoundId.ClockTick, { gainScale: 0.55 });
        break;
      default:
        assertNever(phase, 'AudioEngine.applyMusicPhase');
    }
  }

  private trackVoice(id: SoundId, durationSec: number): void {
    this.activeVoices++;
    this.perSoundActive.set(id, (this.perSoundActive.get(id) ?? 0) + 1);
    window.setTimeout(() => {
      this.activeVoices = Math.max(0, this.activeVoices - 1);
      const cur = this.perSoundActive.get(id) ?? 1;
      if (cur <= 1) this.perSoundActive.delete(id);
      else this.perSoundActive.set(id, cur - 1);
    }, Math.ceil(durationSec * 1000) + 25);
  }
}
