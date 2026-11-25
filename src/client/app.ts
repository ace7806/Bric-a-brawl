import { BotKind } from '@bots/enums';
import type { HostEngineConfig } from '@host/engine';
import { HostWorkerCmd, HostWorkerEvent, type HostWorkerInbound, type HostWorkerOutbound } from '@host/worker';
import {
  ChannelKind, ClientPredictor, ConnectionState, createInitialRoster, decodeInputPacket, decodeSnapshot, DEFAULT_ROOM_SETTINGS,
  encodeInputPacket, HostAction, HostClockEstimator, MAX_FIGHTER_SLOTS, NetMessageKind, peekUnreliableKind,
  RemoteInterpolator, RoomPhase, RoomSession, SlotStatus,
  type RoomRosterData, type RoomSlotData, type SnapshotData, type Transport,
} from '@net/index';
import { createTrysteroTransport } from '@net/transport/trystero';
import { assert, assertNever, InvariantError, requireKey } from '@sim/assert';
import { getArenaSpec, getFighterSpec, getGameData, parseArenaId } from '@sim/data';
import {
  ALL_ARENA_IDS, ArenaId, ChunkState, ErrorCode, FighterFlag, FighterId, FighterState,
  GadgetId, KoCause, MatchMode, MoveId, SimEventKind, TeamId, TimelineAction,
} from '@sim/enums';
import { createFighter } from '@sim/fighter';
import { polygonCentroid } from '@sim/geometry';
import type {
  ChunkRuntime, FighterRuntime, IslandState, PlatformRuntime,
  ProjectileRuntime, RoundResult, SimEvent, WorldGadgetRuntime,
} from '@sim/types';
import { initPhysics } from '@sim/world';
import * as THREE from 'three';
import { type AudioBusName, AudioEngine, fighterPitchScale } from './audio';
import { CameraController } from './camera';
import { CombatFeedbackTracker, computeHitContactPoint, triggerHitFeedback } from './combat-feel';
import { AuctioneerLineId, GlazeFinish, MusicPhase, QualityTier, ScreenId, SoundId, TouchControlsMode } from './enums';
import { ALL_KEY_ACTIONS, InputCollector, KeyPreset } from './input';
import { canvasToPngBlob, renderResultsPhotoCanvas, renderSessionCardCanvas } from './photo';
import {
  type AppraisalId, evaluateRoundProgression, generateAppraisalLine, generateCeramicRoomCode,
  loadPlayerProfile, type PlayerProfile, savePlayerProfile,
} from './progression';
import { QualityManager } from './quality';
import { type CombatShowcaseInput, GreyboxRenderer } from './renderer';
import { clampBubbleToViewport, GameUi, SELECTABLE_BOT_KINDS, type ResultsPlayerRow, type SettingsViewState } from './ui';

const DT = 1 / 60;
const PLATTER_R = 2.6;
const PLATTER_TICKS = 180;
const COUNTDOWN_TICKS = 180;
const MAX_BOTS = 3;
const TIER_MAP = new Map<string, QualityTier>([['low', QualityTier.Low], ['medium', QualityTier.Medium], ['high', QualityTier.High]]);

const GADGET_USE_SOUND = new Map<GadgetId, SoundId>([
  [GadgetId.Bellows, SoundId.Bellows],
  [GadgetId.Plunger, SoundId.PlungerFire],
  [GadgetId.Cork, SoundId.CorkPop],
  [GadgetId.Pepper, SoundId.PepperGrind],
  [GadgetId.Toaster, SoundId.ToasterDing],
  [GadgetId.Jam, SoundId.JamSplat],
  [GadgetId.Timer, SoundId.TimerRewind],
  [GadgetId.Hoover, SoundId.HooverSpit],
  [GadgetId.Magnet, SoundId.MagnetFire],
]);

export interface DebugApi {
  readonly ready: boolean;
  readonly firstLobbyFrameMs: number;
  readonly screen: ScreenId;
  readonly phase: RoomPhase;
  readonly tick: number;
  readonly peerCount: number;
  readonly snapshotsReceived: number;
  readonly maxSnapshotGapMs: number;
  readonly lastSnapshotArrivalMs: number;
  readonly frameStats: ReturnType<QualityManager['getFrameStats']>;
  readonly renderStats: ReturnType<GreyboxRenderer['getRenderStats']>;
  readonly vfxStats: ReturnType<GreyboxRenderer['vfx']['getStats']>;
  readonly impactCountInWindow: number;
  readonly qualityTier: QualityTier;
  readonly reduceFlashes: boolean;
  readonly audioState: AudioContextState | 'uninitialized';
  readonly lastInputMask: number;
  readonly localFighterState: {
    readonly state: FighterState;
    readonly activeMove: MoveId;
    readonly moveFrame: number;
    readonly hitstopFrames: number;
    readonly x: number;
    readonly y: number;
  } | null;
  resetSnapshotGap(): void;
  setReduceFlashes(reduce: boolean): void;
  startRoundNow(): void;
  setScreen(screen: ScreenId): void;
  renderStyleFrame(): void;
  renderShowcase(kind: 'fighter' | 'arena', id: number): void;
  renderCombatShowcase(opts: CombatShowcaseInput): void;
  showResultsDemo(): Promise<void>;
  showVersionMismatchDemo(): void;
  getPerfReportJson(): string;
}

declare global { interface Window { __bbDebug?: DebugApi; } }

function makePlaceholderIsland(arenaId: ArenaId): IslandState {
  const spec = getArenaSpec(arenaId);
  const chunks: ChunkRuntime[] = spec.chunks.map((c) => {
    const [cx, cy] = polygonCentroid(c.poly);
    return {
      index: c.index, id: c.id, maxHp: c.hp, oneWay: c.oneWay, half: c.half, hp: c.hp,
      state: ChunkState.Intact, stateTicks: 0, x: cx, y: cy,
      vx: 0, vy: 0, angle: 0, angVel: 0, resting: false, restSent: false, bodyHandle: -1, colliderHandle: -1,
    };
  });
  const platforms: PlatformRuntime[] = spec.platforms.map((p) => ({
    index: p.index, id: p.id, kind: p.kind, baseY: p.y, x0: p.x0, x1: p.x1, y: p.y, hp: p.hp,
    alive: true, falling: false, vy: 0, bodyHandle: -1, colliderHandle: -1,
  }));
  return {
    arenaId, chunks, platforms, rubble: [], timelineFired: [], playerCountTimeShiftTicks: 0,
    nextRubbleId: 1, lastCallActive: false, suddenDeathActive: false,
    pour: { active: false, telegraphing: false, ticksLeft: 0 }, bowl: { splitActive: false, gap: 0, tiltActive: false, tiltDeg: 0 },
    seesaw: { snapped: false, angleDeg: 0, angVelDeg: 0 }, ledges: [], crackTotals: { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0 }, halfGoneTick: -1,
  };
}

function setBoot(status: string, pct: number): void {
  const st = document.getElementById('boot-status');
  const fill = document.getElementById('boot-fill');
  if (st) st.textContent = status;
  if (fill) fill.style.width = `${pct}%`;
}

function parseShowcaseParam(raw: string | null): { kind: 'fighter' | 'arena'; id: number } | null {
  if (raw === null) return null;
  const m = /^(fighter|arena):(\d+)$/.exec(raw.trim().toLowerCase());
  if (!m) throw new InvariantError(ErrorCode.InvalidEnumValue, `Invalid showcase param: ${raw}`);
  const id = Number(m[2]);
  assert(Number.isInteger(id) && id >= 0 && id <= 3, ErrorCode.InvalidEnumValue, `Showcase id out of range [0..3]: ${id}`);
  return { kind: m[1] as 'fighter' | 'arena', id };
}

function parseUrlParams() {
  const q = new URLSearchParams(window.location.search);
  const tierRaw = q.get('tier');
  const arenaRaw = q.get('arena');
  const botsRaw = q.get('bots');
  const roleRaw = q.get('role');
  const frag = /^#r=([a-z0-9-]+)$/i.exec(window.location.hash);
  return {
    smoke: q.get('mode') === 'smoke',
    bots: botsRaw !== null ? Math.max(0, Math.min(7, Number(botsRaw))) : 0,
    tier: tierRaw !== null ? requireKey(TIER_MAP, tierRaw.toLowerCase(), 'query.tier') : null,
    arena: arenaRaw !== null ? parseArenaId(arenaRaw.toLowerCase()) : null,
    roomCode: q.get('room'),
    autojoin: q.get('autojoin') === '1',
    role: roleRaw === 'host' || roleRaw === 'client' ? (roleRaw as 'host' | 'client') : null,
    startRound: q.get('startRound') === '1',
    reduceFlashes: q.get('reduceFlashes') === '1',
    styleframe: q.get('styleframe') === '1',
    showcase: parseShowcaseParam(q.get('showcase')),
    fragmentRoom: frag ? frag[1]! : null,
  };
}

interface SlotTelemetry {
  kos: number;
  falls: number;
  dealt: number;
  damageTaken: number;
  peakDamage: number;
  attacksLanded: number;
  parriesLanded: number;
  exitCause: KoCause | null;
}

export class BricABrawlApp {
  private readonly canvas: HTMLCanvasElement;
  private readonly uiRoot: HTMLElement;
  private readonly renderer: GreyboxRenderer;
  private readonly camera = new CameraController();
  private readonly input = new InputCollector();
  private readonly audio = new AudioEngine();
  private readonly combatFeel = new CombatFeedbackTracker();
  private readonly quality: QualityManager;
  private readonly ui: GameUi;
  private readonly worker: Worker;
  private readonly projVec = new THREE.Vector3();

  private clock = new HostClockEstimator();
  private interp = new RemoteInterpolator(0);
  private clientPredictor: ClientPredictor | null = null;
  private transport: Transport | null = null;
  private session: RoomSession | null = null;
  private unsubPackets: (() => void) | null = null;

  private profile: PlayerProfile;
  private profileName: string;
  private profileFighter: FighterId;
  private profileColour: number;
  private equippedFinish: GlazeFinish;
  private roomCode = generateCeramicRoomCode();
  private localRoster: RoomRosterData;
  private botKinds = new Map<number, BotKind>();
  private keyPreset = KeyPreset.KeyboardA;
  private touchControlsMode = TouchControlsMode.Auto;
  private reduceFlashes: boolean;
  private colorBlindPatterns: boolean;
  private frameDataEnabled = false;
  private smokeBotsCount = 0;

  private renderIsland: IslandState = makePlaceholderIsland(ArenaId.Saucer);
  private renderFighters: FighterRuntime[] = [];
  private renderGadgets: WorldGadgetRuntime[] = [];
  private renderProjectiles: ProjectileRuntime[] = [];
  private slotStats = new Map<number, SlotTelemetry>();
  private prevDamageBySlot = new Map<number, number>();
  private prevGiltFullBySlot = new Set<number>();
  private prevRubbleIds = new Set<number>();
  private prevBowlSplit = false;
  private prevLastCall = false;
  private prevSuddenDeath = false;
  private roundHadHit = false;
  private roundChunksShattered = 0;
  private roundSelfKoCork = false;
  private roundParriedParriedCork = false;
  private roundTeaspoonFinalTap = false;
  private roundNewlyUnlocked: readonly AppraisalId[] = [];
  private feedLines: string[] = [];
  private auctioneerBanner: string | null = null;
  private bannerExpiryMs = 0;
  private lastCountdownSec = -1;
  private lastGoingMs = 0;
  private hostStruggling = false;
  private lastSnapTick = 0;
  private platterHoldTicks = 0;
  private countdownAccumMs = 0;
  private roundNumber = 0;
  private roundStartMs = 0;
  private roundEndDurationSec = 0;
  private rematchEndsAtMs = 0;
  private lastRematch: { roundResult: RoundResult; arenaId: ArenaId; nextArenaId: ArenaId } | null = null;

  private ready = false;
  private staticModePaused = false;
  private firstLobbyFrameMs = 0;
  private snapshotsReceived = 0;
  private maxSnapshotGapMs = 0;
  private lastSnapshotArrivalMs = 0;
  private lastFrameMs = 0;
  private inputAccumMs = 0;
  private clientInputTick = 0;
  private lastInputMask = 0;
  private workerRunning = false;
  private workerMatchEpoch = 0;
  private rafId = 0;

  public constructor(canvas: HTMLCanvasElement, uiRoot: HTMLElement) {
    this.canvas = canvas;
    this.uiRoot = uiRoot;
    const cfg = parseUrlParams();
    this.profile = loadPlayerProfile();
    this.profileName = this.profile.lotName;
    this.profileFighter = this.profile.lastFighter;
    this.profileColour = this.profile.lastColorIndex;
    this.equippedFinish = this.profile.equippedFinish;
    this.reduceFlashes = cfg.reduceFlashes || this.profile.reduceFlashes;
    this.colorBlindPatterns = this.profile.colorBlindPatterns;

    for (const action of ALL_KEY_ACTIONS) {
      const bound = this.profile.keyBindings[action];
      if (bound !== undefined) this.input.rebind(action, bound);
    }

    this.camera.setShakeScale(this.profile.cameraShake);
    this.audio.setVolume(this.profile.volumeMaster);
    this.audio.setBusVolume('music', this.profile.volumeMusic);
    this.audio.setBusVolume('effects', this.profile.volumeEffects);
    this.audio.setBusVolume('auctioneer', this.profile.volumeAuctioneer);

    const initTier = cfg.tier ?? QualityTier.Medium;
    this.quality = new QualityManager(initTier);
    if (cfg.tier !== null) this.quality.setUserMaxTier(cfg.tier, true);
    this.renderer = new GreyboxRenderer(canvas, uiRoot, initTier);
    this.renderer.vfx.setReduceFlashes(this.reduceFlashes);
    this.renderer.setLocalGlazeFinish(0, this.equippedFinish);
    this.localRoster = createInitialRoster('local', { name: this.profileName, fighterId: this.profileFighter, colourIndex: this.profileColour }, DEFAULT_ROOM_SETTINGS, cfg.arena ?? ArenaId.Willow, 1);

    this.ui = new GameUi(uiRoot, this.getSettingsState(), {
      onOpenRoom: () => { this.audio.play(SoundId.UiPick); void this.openRoom(generateCeramicRoomCode()); },
      onJoinRoom: (code) => { this.audio.play(SoundId.UiPick); void this.joinRoom(code); },
      onSoloPractice: () => { this.audio.play(SoundId.UiPick); void this.startSoloPractice(); },
      onStartMatch: () => {
        if (this.isAuthHost() && this.roster().slots.length >= 2) {
          this.audio.play(SoundId.PlatterAll);
          this.startRoundNow();
        }
      },
      onCopyInvite: () => this.copyInviteLink(),
      onSelectFighter: (fid) => { this.audio.play(SoundId.UiPick); this.selectFighter(fid); },
      onSelectColour: (col) => { this.audio.play(SoundId.UiPick); this.selectColour(col); },
      onSelectGlazeFinish: (fin) => { this.audio.play(SoundId.UiPick); this.selectGlazeFinish(fin); },
      onSelectArena: (aid) => { if (this.isAuthHost()) { this.audio.play(SoundId.UiPick); this.commitHostRoster({ ...this.roster(), arenaId: aid }); } },
      onToggleFragile: (fragile) => { if (this.isAuthHost()) { this.audio.play(SoundId.UiPick); const r = this.roster(); this.commitHostRoster({ ...r, settings: { ...r.settings, fragile } }); } },
      onSelectMode: (mode) => { this.audio.play(SoundId.UiPick); this.selectMode(mode); },
      onAddBot: (kind) => { this.audio.play(SoundId.UiPick); this.addBot(kind); },
      onRemoveBot: () => { this.audio.play(SoundId.UiPick); this.removeBot(); },
      onToggleFrameData: (enabled) => { this.frameDataEnabled = enabled; this.syncLobbyUi(); },
      onAskPeerToHost: (peerId) => this.askPeerToHost(peerId),
      onRetryConnection: () => { void this.joinRoom(this.roomCode); },
      onPlayOfflinePractice: () => { void this.startSoloPractice(); },
      onHardRefresh: () => window.location.reload(),
      onBackToLobby: () => this.backToLobby(),
      onCaptureCanvasPhoto: () => this.capturePhoto(),
      onCaptureSessionCard: () => this.captureSessionCard(),
      onChangeQualityTier: (tier) => { this.quality.setUserMaxTier(tier, true); this.renderer.setQuality(tier, this.quality.getRenderScale()); },
      onChangeTouchControlsMode: (mode) => { this.touchControlsMode = mode; },
      onChangeShakeScale: (s) => { this.camera.setShakeScale(s); this.updateProfile({ cameraShake: s }); },
      onChangeReduceFlashes: (r) => { this.reduceFlashes = r; this.renderer.vfx.setReduceFlashes(r); this.updateProfile({ reduceFlashes: r }); },
      onChangeVolume: (v) => { this.audio.setVolume(v); this.updateProfile({ volumeMaster: v }); },
      onChangeBusVolume: (bus, v) => this.changeBusVolume(bus, v),
      onChangeMuted: (m) => this.audio.setMuted(m),
      onToggleColorBlind: (enabled) => { this.colorBlindPatterns = enabled; this.updateProfile({ colorBlindPatterns: enabled }); },
      onChangeKeyPreset: (p) => { this.keyPreset = p; this.input.setPreset(p); this.syncKeyBindingsProfile(); },
      onRebindKey: (action, code) => { this.input.rebind(action, code); this.syncKeyBindingsProfile(); },
      onBuildPerfReport: () => this.buildPerfReport(),
      onTouchStick: (dir, isTilt) => this.input.setTouchStick(dir, isTilt),
      onTouchBit: (bit, active) => this.input.setTouchBit(bit, active),
      onTouchClear: () => this.input.clearTouch(),
    });

    this.worker = new Worker(new URL('../host/worker.ts', import.meta.url), { type: 'module' });
    this.worker.onmessage = (ev: MessageEvent<HostWorkerOutbound>) => this.onWorkerMessage(ev.data);
    this.worker.onerror = (err) => { throw new InvariantError(ErrorCode.TransportError, err.message); };
    this.installDebugApi();
  }

  public async start(): Promise<void> {
    setBoot('Loading porcelain & physics...', 45);
    await Promise.all([initPhysics(), this.renderer.initAssets()]);
    setBoot('Preparing saucer...', 85);

    const cfg = parseUrlParams();
    if (cfg.styleframe || cfg.showcase !== null) {
      this.staticModePaused = true;
      document.getElementById('boot')?.classList.add('hidden');
      this.uiRoot.style.display = 'none';
      if (cfg.styleframe) this.renderer.renderStyleFrame();
      else if (cfg.showcase !== null) this.renderer.renderShowcase(cfg.showcase.kind, cfg.showcase.id);
      this.ready = true;
      this.firstLobbyFrameMs = performance.now();
      return;
    }

    this.input.attach();
    this.audio.attachUnlockListeners();
    this.audio.setMusicPhase(MusicPhase.Lobby);
    window.addEventListener('resize', () => this.renderer.resize(window.innerWidth, window.innerHeight));
    window.addEventListener('keydown', (e) => this.onGlobalKey(e));

    if (cfg.fragmentRoom !== null) this.ui.setTitleRoomCode(cfg.fragmentRoom);
    else if (cfg.roomCode !== null) this.ui.setTitleRoomCode(cfg.roomCode);

    this.ui.syncSettings(this.getSettingsState());
    this.ui.setScreen(ScreenId.Title);
    this.syncLobbyUi();

    this.lastFrameMs = performance.now();
    this.rafId = requestAnimationFrame((n) => this.frameLoop(n));

    if (cfg.smoke) {
      this.smokeBotsCount = Math.max(1, cfg.bots);
      this.startSmokeMode(cfg.arena !== null ? cfg.arena : ArenaId.Willow, this.smokeBotsCount);
    } else if (cfg.autojoin && cfg.roomCode !== null) {
      if (cfg.role === 'client') await this.joinRoom(cfg.roomCode);
      else {
        await this.openRoom(cfg.roomCode);
        for (let i = 0; i < cfg.bots; i++) this.addBot(SELECTABLE_BOT_KINDS[i % SELECTABLE_BOT_KINDS.length]!);
        if (cfg.startRound) this.startRoundNow();
      }
    } else if (cfg.fragmentRoom !== null) {
      await this.joinRoom(cfg.fragmentRoom);
    } else {
      // 10-second rule (P1): immediately boot live 3D Saucer Lobby before any peer connects
      this.addBotToRoster(BotKind.Chaser);
      this.startWorkerSaucer();
    }
  }

  private updateProfile(patch: Partial<PlayerProfile>): void {
    this.profile = { ...this.profile, ...patch };
    savePlayerProfile(this.profile);
  }

  private syncKeyBindingsProfile(): void {
    this.updateProfile({ keyBindings: this.input.getBindings() });
    this.ui.syncSettings(this.getSettingsState());
  }

  private changeBusVolume(bus: AudioBusName, v: number): void {
    this.audio.setBusVolume(bus, v);
    if (bus === 'music') this.updateProfile({ volumeMusic: v });
    else if (bus === 'effects') this.updateProfile({ volumeEffects: v });
    else if (bus === 'auctioneer') this.updateProfile({ volumeAuctioneer: v });
  }

  private selectGlazeFinish(finish: GlazeFinish): void {
    this.equippedFinish = finish;
    const lSlot = this.localSlot();
    this.renderer.setLocalGlazeFinish(lSlot >= 0 ? lSlot : 0, finish);
    this.updateProfile({ equippedFinish: finish });
    this.syncLobbyUi();
  }

  private startSmokeMode(arenaId: ArenaId, botCount: number): void {
    this.botKinds.clear();
    const total = Math.min(MAX_FIGHTER_SLOTS, botCount + 1);
    const slots: RoomSlotData[] = Array.from({ length: total }, (_, i) => {
      this.botKinds.set(i, SELECTABLE_BOT_KINDS[i % SELECTABLE_BOT_KINDS.length]!);
      return { slot: i, peerId: `bot-${i}`, name: `Lot ${i + 1}`, fighterId: (i % 4) as FighterId, colourIndex: i, team: TeamId.None, wins: 0, status: SlotStatus.Bot };
    });
    this.localRoster = { ...this.localRoster, arenaId, slots };
    this.startRoundNow();
  }

  private roster(): RoomRosterData { return this.session ? this.session.roster : this.localRoster; }
  private selfPeerId(): string { return this.session ? this.session.transport.selfId : 'local'; }
  private isAuthHost(): boolean { return this.session === null || this.session.isHost; }
  private localSlot(): number {
    const entry = this.roster().slots.find((s) => s.peerId === this.selfPeerId());
    return entry !== undefined ? entry.slot : -1;
  }

  private commitHostRoster(next: RoomRosterData): void {
    if (this.session) {
      assert(this.session.isHost, ErrorCode.InvariantViolation, 'Only host mutates roster');
      this.session.roster = next;
      this.session.setPhase(next.phase, next.roundSeed, next.arenaId);
    } else {
      this.localRoster = next;
      this.syncLobbyUi();
    }
  }

  private async closeNetwork(): Promise<void> {
    this.unsubPackets?.();
    this.unsubPackets = null;
    this.session?.destroy();
    this.session = null;
    if (this.transport) { await this.transport.close(); this.transport = null; }
  }

  private async attachTransport(code: string, isHost: boolean): Promise<void> {
    await this.closeNetwork();
    this.roomCode = code;
    this.snapshotsReceived = 0;
    this.maxSnapshotGapMs = 0;
    this.lastSnapshotArrivalMs = 0;
    this.resetMatchTrackers(ArenaId.Saucer, []);

    const transport = await createTrysteroTransport({ roomCode: code });
    this.transport = transport;
    const profile = { name: this.profileName, fighterId: this.profileFighter, colourIndex: this.profileColour };
    const initRoster = isHost ? createInitialRoster(transport.selfId, profile, this.localRoster.settings, this.localRoster.arenaId, this.localRoster.roundSeed) : undefined;

    this.session = new RoomSession(transport, isHost, profile, {
      onRosterChange: (r) => this.onRosterChanged(r),
      onStateChange: (s) => { if (s >= ConnectionState.PeerFailed) void this.showConnectionError(); },
      onHostChanged: (newHostId) => {
        if (newHostId === transport.selfId) {
          for (const s of this.roster().slots) {
            if (s.status === SlotStatus.Bot && !this.botKinds.has(s.slot)) this.botKinds.set(s.slot, BotKind.Chaser);
          }
          this.startWorkerSaucer();
        }
      },
      onMessage: (_from, msg) => {
        if (msg.kind === NetMessageKind.Events && !this.isAuthHost()) {
          if (this.clientPredictor !== null) this.clientPredictor.applyReliableEvents(msg.events);
          this.processEvents(msg.events);
        }
      },
    }, initRoster);

    this.unsubPackets = transport.onPacket((peerId, ch, payload) => {
      if (ch !== ChannelKind.Unreliable) return;
      const kind = peekUnreliableKind(payload);
      if (kind === NetMessageKind.Input && this.isAuthHost()) {
        const slot = this.roster().slots.find((s) => s.peerId === peerId)?.slot;
        if (slot !== undefined && !this.botKinds.has(slot) && slot !== this.localSlot()) {
          this.postWorker({ cmd: HostWorkerCmd.ClientPacket, slot, packet: decodeInputPacket(payload) });
        }
      } else if (kind === NetMessageKind.Snapshot && !this.isAuthHost()) {
        this.ingestSnapshot(decodeSnapshot(payload), performance.now());
      }
    });

    if (window.location.hash !== `#r=${code}`) history.replaceState(null, '', `#r=${code}`);
  }

  private async openRoom(code: string): Promise<void> {
    await this.attachTransport(code, true);
    this.audio.setMusicPhase(MusicPhase.Lobby);
    this.ui.setScreen(ScreenId.Lobby);
    this.syncLobbyUi();
    this.startWorkerSaucer();
  }

  private async joinRoom(code: string): Promise<void> {
    this.workerMatchEpoch++;
    this.postWorker({ cmd: HostWorkerCmd.StopMatch });
    this.workerRunning = false;
    await this.attachTransport(code, false);
    this.audio.setMusicPhase(MusicPhase.Lobby);
    this.ui.setScreen(ScreenId.Lobby);
    this.syncLobbyUi();
  }

  private async startSoloPractice(): Promise<void> {
    await this.closeNetwork();
    this.localRoster = createInitialRoster('local', { name: this.profileName, fighterId: this.profileFighter, colourIndex: this.profileColour }, DEFAULT_ROOM_SETTINGS, this.localRoster.arenaId, 1);
    this.botKinds.clear();
    this.addBotToRoster(BotKind.Chaser);
    this.audio.setMusicPhase(MusicPhase.Lobby);
    this.ui.setScreen(ScreenId.Lobby);
    this.syncLobbyUi();
    this.startWorkerSaucer();
  }

  private onRosterChanged(roster: RoomRosterData): void {
    const lSlot = this.localSlot();
    if (lSlot >= 0) this.renderer.setLocalGlazeFinish(lSlot, this.equippedFinish);
    if (roster.slots.length > this.renderFighters.length && roster.phase === RoomPhase.Lobby) {
      this.audio.playAuctioneer(AuctioneerLineId.NewLot);
    }
    this.syncLobbyUi();
    if (this.isAuthHost()) {
      if (roster.phase === RoomPhase.Lobby && roster.slots.length !== this.renderFighters.length) this.startWorkerSaucer();
      return;
    }
    if (roster.phase === RoomPhase.Round && this.ui.getScreen() !== ScreenId.Hud) {
      this.resetMatchTrackers(roster.arenaId, roster.slots);
      this.audio.setMusicPhase(MusicPhase.RoundA);
      this.audio.playAuctioneer(AuctioneerLineId.DoIHearAFight);
      this.ui.setScreen(ScreenId.Hud);
    } else if (roster.phase === RoomPhase.Results && this.ui.getScreen() !== ScreenId.Results) {
      this.audio.setMusicPhase(MusicPhase.Results);
      this.rematchEndsAtMs = performance.now() + getGameData().tuning.match.rematchAutoSeconds * 1000;
      this.ui.setScreen(ScreenId.Results);
      this.updateResultsUi(this.rematchEndsAtMs - getGameData().tuning.match.rematchAutoSeconds * 1000);
      void this.ui.refreshResultsMedia();
    } else if ((roster.phase === RoomPhase.Lobby || roster.phase === RoomPhase.Countdown) && (this.ui.getScreen() === ScreenId.Hud || this.renderFighters.length !== roster.slots.length)) {
      this.resetMatchTrackers(ArenaId.Saucer, roster.slots);
      if (this.ui.getScreen() === ScreenId.Hud || this.ui.getScreen() === ScreenId.Results) {
        this.audio.setMusicPhase(MusicPhase.Lobby);
        this.ui.setScreen(ScreenId.Lobby);
      }
    }
  }

  private postWorker(cmd: HostWorkerInbound): void { this.worker.postMessage(cmd); }

  private startWorkerMatch(arenaId: ArenaId, mode: MatchMode): void {
    const r = this.roster();
    const active = r.slots.filter((s) => s.status !== SlotStatus.Spectating);
    const bots: Record<number, { kind: BotKind; reactionTicks: number }> = {};
    for (const s of active) {
      if (s.status === SlotStatus.Bot) {
        bots[s.slot] = { kind: requireKey(this.botKinds, s.slot, `botKinds[${s.slot}]`), reactionTicks: 10 };
      }
    }
    const lSlot = this.localSlot();
    this.renderer.setLocalGlazeFinish(lSlot >= 0 ? lSlot : 0, this.equippedFinish);
    const config: HostEngineConfig = {
      match: { arenaId, mode, fragile: r.settings.fragile, seed: r.roundSeed, fighters: active.map((s) => ({ slot: s.slot, id: s.fighterId, team: s.team })), enableTierB: r.settings.enableTierB, enableTierC: r.settings.enableTierC, stocksOverride: r.settings.stocks },
      localSlot: this.smokeBotsCount > 0 || lSlot < 0 ? null : lSlot,
      bots,
      emitLocalEveryTick: this.smokeBotsCount === 0 && lSlot >= 0,
    };
    this.resetMatchTrackers(arenaId, active);
    this.workerRunning = true;
    const epoch = ++this.workerMatchEpoch;
    this.postWorker({ cmd: HostWorkerCmd.StartMatch, config, epoch });
  }

  private startWorkerSaucer(): void {
    if (!this.isAuthHost()) return;
    this.platterHoldTicks = 0;
    this.startWorkerMatch(ArenaId.Saucer, MatchMode.Practice);
  }

  public startRoundNow(): void {
    if (!this.isAuthHost()) return;
    const r = this.roster();
    this.roundNumber++;
    this.commitHostRoster({ ...r, phase: RoomPhase.Round, countdownTicks: 0, roundSeed: (r.roundSeed + 1) | 0 });
    this.audio.setMusicPhase(MusicPhase.RoundA);
    this.audio.play(SoundId.CountGo);
    this.audio.playAuctioneer(AuctioneerLineId.LotNumber);
    this.audio.playAuctioneer(AuctioneerLineId.DoIHearAFight);
    this.ui.setScreen(ScreenId.Hud);
    this.startWorkerMatch(r.arenaId, r.settings.mode);
  }

  private backToLobby(): void {
    if (!this.isAuthHost()) return;
    this.commitHostRoster({ ...this.roster(), phase: RoomPhase.Lobby, countdownTicks: 0 });
    this.audio.setMusicPhase(MusicPhase.Lobby);
    this.ui.setScreen(ScreenId.Lobby);
    this.startWorkerSaucer();
  }

  private resetMatchTrackers(arenaId: ArenaId, slots: readonly RoomSlotData[]): void {
    this.clock = new HostClockEstimator();
    // Local host has 0ms RTT to its own worker: skip the 66ms remote interpolation buffer for crisp Smash responsiveness!
    this.interp = new RemoteInterpolator(this.isAuthHost() ? 0 : undefined);
    this.combatFeel.reset();
    if (this.clientPredictor !== null) {
      this.clientPredictor.dispose();
      this.clientPredictor = null;
    }
    this.snapshotsReceived = 0;
    this.lastSnapTick = 0;
    this.clientInputTick = 0;
    this.slotStats.clear();
    this.prevDamageBySlot.clear();
    this.prevGiltFullBySlot.clear();
    this.prevRubbleIds.clear();
    this.prevBowlSplit = false;
    this.prevLastCall = false;
    this.prevSuddenDeath = false;
    this.roundHadHit = false;
    this.roundChunksShattered = 0;
    this.roundSelfKoCork = false;
    this.roundParriedParriedCork = false;
    this.roundTeaspoonFinalTap = false;
    this.roundNewlyUnlocked = [];
    this.roundStartMs = performance.now();
    this.roundEndDurationSec = 0;
    this.feedLines = [];
    this.auctioneerBanner = null;
    this.lastCountdownSec = -1;
    this.renderIsland = makePlaceholderIsland(arenaId);
    const arena = getArenaSpec(arenaId);
    const active = slots.filter((s) => s.status !== SlotStatus.Spectating);
    this.renderFighters = active.map((s, i) => {
      const sp = arena.spawns[i % arena.spawns.length]!;
      this.slotStats.set(s.slot, { kos: 0, falls: 0, dealt: 0, damageTaken: 0, peakDamage: 0, attacksLanded: 0, parriesLanded: 0, exitCause: null });
      return createFighter(s.slot, s.fighterId, s.team, sp[0], sp[1], 3, 0);
    });
    if (!this.isAuthHost()) {
      const selfEntry = active.find((s) => s.peerId === this.selfPeerId());
      if (selfEntry !== undefined) {
        const r = this.roster();
        this.clientPredictor = new ClientPredictor({
          arenaId,
          mode: r.phase === RoomPhase.Round ? r.settings.mode : MatchMode.Practice,
          fragile: r.settings.fragile,
          seed: r.roundSeed,
          fighters: active.map((s) => ({ slot: s.slot, id: s.fighterId, team: s.team })),
          enableTierB: r.settings.enableTierB,
          enableTierC: r.settings.enableTierC,
          stocksOverride: r.settings.stocks,
        }, selfEntry.slot);
      }
    }
    this.renderGadgets = [];
    this.renderProjectiles = [];
    this.camera.reset(arenaId);
  }

  private onWorkerMessage(msg: HostWorkerOutbound): void {
    switch (msg.event) {
      case HostWorkerEvent.Ready: break;
      case HostWorkerEvent.Tick:
        if (msg.epoch !== this.workerMatchEpoch) break;
        this.hostStruggling = msg.struggling;
        if (msg.events.length > 0) {
          if (this.session?.isHost) this.session.broadcastReliable({ kind: NetMessageKind.Events, events: msg.events });
          this.processEvents(msg.events);
        }
        if (msg.snapshotBytes !== null) {
          if (this.session?.isHost) this.session.transport.broadcast(ChannelKind.Unreliable, msg.snapshotBytes);
          this.ingestSnapshot(decodeSnapshot(msg.snapshotBytes), performance.now());
        } else if (msg.localSnapshotBytes !== null) {
          this.ingestSnapshot(decodeSnapshot(msg.localSnapshotBytes), performance.now());
        }
        if (msg.roundResult !== null) this.handleRoundFinished(msg.roundResult);
        break;
      case HostWorkerEvent.BenchmarkResult: if (this.session) this.session.benchScore = msg.ticksPerSec; break;
      case HostWorkerEvent.Error: throw new InvariantError(msg.code, msg.message);
      default: assertNever(msg, 'onWorkerMessage');
    }
  }

  private ingestSnapshot(snap: SnapshotData, nowMs: number): void {
    if (this.lastSnapshotArrivalMs > 0) this.maxSnapshotGapMs = Math.max(this.maxSnapshotGapMs, nowMs - this.lastSnapshotArrivalMs);
    this.lastSnapshotArrivalMs = nowMs;
    this.snapshotsReceived++;
    this.lastSnapTick = snap.tick;
    const oneWayMs = this.clientPredictor !== null ? this.clientPredictor.observeAckOneWayMs(snap, nowMs) : 0;
    this.clock.onSnapshot(snap.tick, nowMs, oneWayMs);
    this.interp.pushSnapshot(snap, nowMs);
    if (!this.isAuthHost()) {
      this.interp.setInterpDelayMs(this.clock.getInterpDelayMs());
    }

    if (this.clientPredictor !== null) {
      this.clientPredictor.reconcileSnapshot(snap);
    }
  }

  private processEvents(events: readonly SimEvent[]): void {
    const nowMs = performance.now();
    const pal = getGameData().palette;
    const lSlot = this.localSlot();
    const screen = this.ui.getScreen();
    const isTitleScreen = screen === ScreenId.Title;
    const isRoundScreen = screen === ScreenId.Hud;
    const playFx = (id: SoundId, opts?: { pan?: number; pitchScale?: number; gainScale?: number }) => {
      if (!isTitleScreen) this.audio.play(id, opts);
    };

    // Correlate same-tick Launch speeds with Hit events so heavy/lethal hits fire Kill-Spark & strong camera punch
    const launchSpeedByPair = new Map<number, number>();
    for (const ev of events) {
      if (ev.kind === SimEventKind.Launch) {
        launchSpeedByPair.set(ev.a * 16 + ev.b, ev.c / 8);
      }
    }

    for (const ev of events) {
      const f = this.renderFighters.find((x) => x.slot === ev.a);
      const fb = this.renderFighters.find((x) => x.slot === ev.b);
      const fx = f ? f.x : 0;
      const fy = f ? f.y : 0;
      const pan = Math.max(-0.6, Math.min(0.6, fx / 12));
      const col = pal.players[Math.abs(ev.a) % pal.players.length]!.hex;
      const defCol = pal.players[Math.abs(ev.b) % pal.players.length]!.hex;
      const pitchScale = f ? fighterPitchScale(f.id, f.nestaSize) : 1.0;
      switch (ev.kind) {
        case SimEventKind.Hit: {
          const dmg = ev.c / 10;
          const st = this.slotStats.get(ev.a);
          if (st) { st.dealt += dmg; st.attacksLanded++; }
          const def = this.slotStats.get(ev.b);
          if (def) def.damageTaken += dmg;
          if (!this.roundHadHit && isRoundScreen) {
            this.roundHadHit = true;
            if (!this.prevLastCall && !this.prevSuddenDeath) this.audio.setMusicPhase(MusicPhase.RoundAB);
          }
          const launchSpeed = launchSpeedByPair.get(ev.a * 16 + ev.b) ?? 0;
          triggerHitFeedback(
            {
              attacker: f,
              defender: fb,
              damage: dmg,
              moveId: ev.d as MoveId,
              launchSpeed,
              defenderColorHex: defCol,
              allowLoudFx: !isTitleScreen,
              nowMs,
            },
            this.renderer.vfx,
            this.camera,
            this.audio,
          );
          break;
        }
        case SimEventKind.Block: {
          const contact = computeHitContactPoint(f, fb, ev.d as MoveId);
          playFx(SoundId.Guard, { pan: Math.max(-0.6, Math.min(0.6, contact.x / 12)) });
          this.renderer.vfx.spawnHitSparks(contact.x, contact.y, contact.dirX, contact.dirY, 5, pal.neutrals['bone']!, pal.accents['gilt']!, 9);
          this.renderer.vfx.spawnDust(contact.x, contact.y - 0.15, 3);
          this.renderer.vfx.spawnRing(contact.x, contact.y, pal.neutrals['bone']!, 1.1, 8);
          if (!isTitleScreen) this.camera.kick(contact.dirX, 0, 0.14, 0);
          break;
        }
        case SimEventKind.Parry: {
          const pst = this.slotStats.get(ev.a);
          if (pst) pst.parriesLanded++;
          if (ev.a === lSlot && this.renderProjectiles.some((p) => p.reflected)) {
            this.roundParriedParriedCork = true;
          }
          playFx(SoundId.Parry, { pan, pitchScale });
          this.renderer.vfx.spawnHitSparks(fx, fy + 0.8, 0, 1, 10, pal.neutrals['bone']!, pal.accents['gilt_hi'] ?? pal.accents['gilt']!, 14);
          this.renderer.vfx.spawnRing(fx, fy + 0.8, pal.accents['gilt']!, 2.6, 18);
          if (!isTitleScreen) {
            this.renderer.vfx.triggerImpactFrame(3, nowMs);
            this.camera.addTrauma(0.24);
            this.camera.kick(0, 0.6, 0.36, 0.35);
          }
          break;
        }
        case SimEventKind.GuardBreak:
          playFx(SoundId.GuardBreak, { pan, pitchScale });
          this.renderer.vfx.spawnHitSparks(fx, fy + 0.8, 0, 1, 12, pal.neutrals['bone']!, pal.accents['stamp_red']!, 15);
          this.renderer.vfx.spawnChips(fx, fy + 0.7, 14, pal.neutrals['bone']!, 13);
          this.renderer.vfx.spawnRing(fx, fy + 0.8, pal.accents['stamp_red']!, 2.6, 16);
          if (!isTitleScreen) {
            this.camera.addTrauma(0.42);
            this.camera.kick(0, 1, 0.45, 0.4);
          }
          break;
        case SimEventKind.Grab: playFx(SoundId.HitLight, { pan, pitchScale }); break;
        case SimEventKind.Throw: playFx(SoundId.HitMid, { pan, pitchScale }); break;
        case SimEventKind.Launch:
          if (ev.c >= 160) {
            playFx(SoundId.LaunchWhistle, { pan });
            if (!isTitleScreen) this.camera.addTrauma(0.22);
            if (isRoundScreen && nowMs - this.lastGoingMs > 1500) {
              this.lastGoingMs = nowMs;
              this.audio.playAuctioneer(AuctioneerLineId.Going);
            }
          }
          break;
        case SimEventKind.Ko: {
          const vs = this.slotStats.get(ev.a);
          if (vs) {
            vs.falls++;
            vs.exitCause = ev.c as KoCause;
          }
          const ks = this.slotStats.get(ev.b);
          if (ks && ev.b !== ev.a) ks.kos++;
          if (ev.a === lSlot && ev.b === lSlot && ev.c === KoCause.Gadget) this.roundSelfKoCork = true;
          playFx(SoundId.KoSmash, { pan });
          if (isRoundScreen) this.audio.playAuctioneer(AuctioneerLineId.Gone);
          this.renderer.vfx.spawnChips(fx, fy, 16, col, 14);
          this.renderer.vfx.spawnRing(fx, fy, pal.accents['stamp_red']!, 3.4, 20);
          if (!isTitleScreen) {
            this.renderer.vfx.triggerImpactFrame(ev.d === 0 ? 10 : 5, nowMs);
            this.camera.addTrauma(0.6);
          }
          this.feedLines = [ev.b >= 0 ? `Lot ${ev.b + 1} chipped Lot ${ev.a + 1}` : `Lot ${ev.a + 1} chipped out`, ...this.feedLines].slice(0, 4);
          break;
        }
        case SimEventKind.Respawn: this.audio.play(SoundId.CorkPop, { pan }); this.renderer.vfx.spawnDust(fx, fy, 4); break;
        case SimEventKind.Shed: this.audio.play(SoundId.NestaPop, { pan, pitchScale }); this.renderer.vfx.spawnChips(fx, fy + 0.6, 8, pal.neutrals['slip']!, 9); break;
        case SimEventKind.ChunkState:
          if (ev.b === ChunkState.Crazed) {
            const ch = this.renderIsland.chunks[ev.a];
            this.audio.play(SoundId.Craze, { pan: ch ? Math.max(-0.6, Math.min(0.6, ch.x / 12)) : 0 });
          } else if (ev.b === ChunkState.Loose || ev.b === ChunkState.Falling) {
            const ch = this.renderIsland.chunks[ev.a];
            this.roundChunksShattered++;
            this.audio.play(SoundId.ChunkBreak, { pan: ch ? Math.max(-0.6, Math.min(0.6, ch.x / 12)) : 0 });
            this.renderer.vfx.spawnChips(ch ? ch.x : 0, ch ? ch.y : 0, 10, pal.neutrals['ash']!, 10);
            this.camera.addTrauma(0.28);
          }
          break;
        case SimEventKind.PlatformState: this.audio.play(SoundId.ChunkBreak); this.renderer.vfx.spawnDust(0, 3, 5); break;
        case SimEventKind.Hazard:
          if (ev.b === 0) {
            this.audio.play(SoundId.PourWhistle);
            this.setBanner('Tea pour incoming!', nowMs);
          } else if (ev.b === 1) {
            this.audio.play(SoundId.EarlPuff);
          }
          break;
        case SimEventKind.GadgetSpawn: this.audio.play(SoundId.ParcelLand); break;
        case SimEventKind.GadgetTake: this.audio.play(SoundId.GadgetTake, { pan }); break;
        case SimEventKind.GadgetUse:
          this.audio.play(GADGET_USE_SOUND.get(ev.b as GadgetId) ?? SoundId.SpoonTink, { pan });
          break;
        case SimEventKind.GadgetGone: break;
        case SimEventKind.Timeline:
          this.audio.play(SoundId.ClockTick);
          if (ev.a === TimelineAction.LastCall) {
            this.prevLastCall = true;
            this.setBanner('Last call — island breaking!', nowMs);
            if (isRoundScreen) {
              this.audio.setMusicPhase(MusicPhase.LastCall);
              this.audio.playAuctioneer(AuctioneerLineId.LastCall);
            }
          } else if (ev.a === TimelineAction.Split && !this.prevBowlSplit) {
            this.prevBowlSplit = true;
            this.audio.play(SoundId.BowlSplit);
          }
          break;
        case SimEventKind.SuddenDeath:
          this.prevSuddenDeath = true;
          this.audio.play(SoundId.ClockChime);
          this.audio.play(SoundId.Parry);
          if (isRoundScreen) {
            this.audio.setMusicPhase(MusicPhase.SuddenDeath);
            this.audio.playAuctioneer(AuctioneerLineId.FairWarning);
          }
          this.renderer.vfx.triggerImpactFrame(6, nowMs);
          this.camera.addTrauma(0.5);
          this.setBanner('SUDDEN DEATH!', nowMs);
          break;
        case SimEventKind.RoundEnd: {
          if (ev.a >= 0 && this.renderFighters.some((rf) => rf.slot === lSlot && rf.state === FighterState.Teaspoon)) {
            this.roundTeaspoonFinalTap = true;
          }
          this.audio.play(SoundId.KoSmash);
          this.setBanner('SOLD!', nowMs);
          break;
        }
        case SimEventKind.GiltBreak:
          this.audio.play(SoundId.GiltBreak, { pan, pitchScale });
          this.renderer.vfx.spawnChips(fx, fy + 0.6, 12, pal.accents['gilt']!, 12);
          this.camera.addTrauma(0.35);
          break;
        case SimEventKind.Bounce: this.audio.play(SoundId.Land, { pan }); this.renderer.vfx.spawnDust(fx, fy, 5); this.camera.addTrauma(0.18); break;
        case SimEventKind.Tech: this.audio.play(SoundId.SpoonTink, { pan }); this.renderer.vfx.spawnChips(fx, fy, 5, pal.accents['gilt']!, 7); break;
        case SimEventKind.TeaspoonTap:
          this.audio.play(SoundId.SpoonTink, { pan: Math.max(-0.6, Math.min(0.6, (ev.c / 64) / 12)) });
          this.renderer.vfx.spawnChips(ev.c / 64, 1, 4, pal.accents['gilt']!, 6);
          break;
        case SimEventKind.Sneeze: this.audio.play(SoundId.Sneeze, { pan }); this.renderer.vfx.spawnDust(fx, fy + 0.6, 6); break;
        case SimEventKind.Rewind: this.audio.play(SoundId.TimerRewind, { pan }); break;
        default: assertNever(ev.kind, 'processEvents');
      }
    }
  }

  private setBanner(text: string, nowMs: number): void { this.auctioneerBanner = text; this.bannerExpiryMs = nowMs + 3000; }

  private handleRoundFinished(result: RoundResult): void {
    const r = this.roster();
    const winsGoal = getGameData().tuning.match.sessionWinsToTake;
    const nextArenaId = ALL_ARENA_IDS[(ALL_ARENA_IDS.indexOf(r.arenaId) + 1) % ALL_ARENA_IDS.length]!;
    const updatedSlots = r.slots.map((s) => (s.slot === result.winnerSlot ? { ...s, wins: s.wins + 1 } : s));
    this.commitHostRoster({ ...r, phase: RoomPhase.Results, slots: updatedSlots });

    const nowMs = performance.now();
    this.roundEndDurationSec = Math.max(0, (nowMs - this.roundStartMs) / 1000);
    this.rematchEndsAtMs = nowMs + getGameData().tuning.match.rematchAutoSeconds * 1000;
    this.lastRematch = { roundResult: result, arenaId: r.arenaId, nextArenaId };

    const lSlot = this.localSlot();
    const localSlotData = updatedSlots.find((s) => s.slot === lSlot);
    if (localSlotData !== undefined) {
      const lst = this.slotStats.get(lSlot);
      const chunksRemaining = this.renderIsland.chunks.filter((c) => c.state !== ChunkState.Gone && c.state !== ChunkState.Falling).length;
      const evalRes = evaluateRoundProgression(this.profile, {
        fighterId: localSlotData.fighterId,
        won: result.winnerSlot === lSlot,
        kos: lst?.kos ?? 0,
        damageTaken: lst?.damageTaken ?? 0,
        peakDamage: lst?.peakDamage ?? 0,
        attacksLanded: lst?.attacksLanded ?? 0,
        parriesLanded: lst?.parriesLanded ?? 0,
        chunksShattered: this.roundChunksShattered,
        chunksRemaining,
        fighterCount: r.slots.filter((s) => s.status !== SlotStatus.Spectating).length,
        fragileMode: r.settings.fragile,
        sessionWon: localSlotData.wins >= winsGoal,
        selfKoByCork: this.roundSelfKoCork,
        parriedParriedCork: this.roundParriedParriedCork,
        teaspoonFinalTap: this.roundTeaspoonFinalTap,
        exitCause: lst?.exitCause ?? null,
      });
      this.profile = evalRes.profile;
      savePlayerProfile(this.profile);
      this.roundNewlyUnlocked = evalRes.newlyUnlocked;
    }

    const hasChamp = updatedSlots.some((s) => s.wins >= winsGoal);
    this.audio.setMusicPhase(MusicPhase.Results);
    if (hasChamp) this.audio.playAuctioneer(AuctioneerLineId.HammerFalls);
    else if (result.winnerSlot >= 0) this.audio.playAuctioneer(AuctioneerLineId.Sold);
    else this.audio.playAuctioneer(AuctioneerLineId.NoSale);

    this.ui.setScreen(ScreenId.Results);
    this.updateResultsUi(nowMs);
    void this.ui.refreshResultsMedia();
  }

  private buildResultsRows(r: RoomRosterData, winnerSlot: number): ResultsPlayerRow[] {
    const sorted = [...r.slots].sort((a, b) => ((b.slot === winnerSlot ? 1 : 0) - (a.slot === winnerSlot ? 1 : 0)) || ((this.slotStats.get(b.slot)?.kos ?? 0) - (this.slotStats.get(a.slot)?.kos ?? 0)));
    return sorted.map((s, idx) => {
      const st = this.slotStats.get(s.slot);
      const kos = st?.kos ?? 0;
      const falls = st?.falls ?? 0;
      const dealtDamage = st?.dealt ?? 0;
      const dmgTaken = st?.damageTaken ?? 0;
      const won = s.slot === winnerSlot;
      const appraisalLine = generateAppraisalLine(s.fighterId, kos, dmgTaken, won, st?.exitCause ?? null);
      return {
        place: idx + 1, slot: s.slot, name: s.name, fighterId: s.fighterId, colourIndex: s.colourIndex,
        kos, falls, dealtDamage, wins: s.wins, note: won ? 'Lot winner' : `${kos} KOs`, appraisalLine,
      };
    });
  }

  private updateResultsUi(nowMs: number): void {
    const r = this.roster();
    const winsGoal = getGameData().tuning.match.sessionWinsToTake;
    const arenaId = this.lastRematch?.arenaId ?? r.arenaId;
    const nextArenaId = this.lastRematch?.nextArenaId ?? ALL_ARENA_IDS[(ALL_ARENA_IDS.indexOf(arenaId) + 1) % ALL_ARENA_IDS.length]!;
    const winnerSlot = this.lastRematch?.roundResult.winnerSlot ?? r.slots[0]?.slot ?? 0;
    const winner = r.slots.find((s) => s.slot === winnerSlot) ?? r.slots[0];
    const rows = this.buildResultsRows(r, winnerSlot);
    const champ = r.slots.find((s) => s.wins >= winsGoal) ?? null;
    this.ui.updateResults({
      roundNumber: Math.max(1, this.roundNumber), arenaId, nextArenaId,
      endTick: this.lastRematch?.roundResult.endTick ?? this.lastSnapTick,
      winnerName: winner ? winner.name : 'Lot 1', winnerColourIndex: winner ? winner.colourIndex : 0,
      isHost: this.isAuthHost(), rematchSecondsLeft: Math.max(0, (this.rematchEndsAtMs - nowMs) / 1000),
      sessionChampionName: champ ? champ.name : null, newlyUnlocked: this.roundNewlyUnlocked, rows,
    });
  }

  private frameLoop(nowMs: number): void {
    if (this.staticModePaused) return;
    const rawDtMs = Math.max(0.5, nowMs - this.lastFrameMs);
    const dtMs = Math.min(50, rawDtMs);
    this.lastFrameMs = nowMs;
    const scriptStart = performance.now();
    const roster = this.roster();
    const screen = this.ui.getScreen();
    const allowInput = !this.ui.isOverlayOpen() && (screen === ScreenId.Lobby || screen === ScreenId.Hud);
    this.inputAccumMs += dtMs;
    for (let steps = 0; this.inputAccumMs >= DT * 1000 && steps < 4; steps++) {
      this.inputAccumMs -= DT * 1000;
      const mask = allowInput ? this.input.pollMask() : 0;
      this.lastInputMask = mask;
      const tick = this.clientInputTick++;
      if (this.session && !this.session.isHost) {
        if (this.clientPredictor !== null) {
          const pkt = this.clientPredictor.predictTick(tick, mask, nowMs);
          this.session.transport.send(this.session.roster.hostId, ChannelKind.Unreliable, encodeInputPacket(pkt));
        }
      } else if (this.workerRunning && this.smokeBotsCount === 0) {
        const lSlot = this.localSlot();
        if (lSlot >= 0) this.postWorker({ cmd: HostWorkerCmd.LocalInput, slot: lSlot, mask });
      }
    }

    const sampled = this.interp.sample(nowMs, this.clock.isInitialized() ? this.clock.estimateHostTick(nowMs) : 0);
    this.syncRenderState(sampled);

    if (this.isAuthHost()) {
      if (roster.phase === RoomPhase.Lobby && screen === ScreenId.Lobby) this.stepLobbyPlatter(roster, dtMs);
      else if (roster.phase === RoomPhase.Countdown) this.stepCountdown(roster, dtMs);
      else if (roster.phase === RoomPhase.Results && screen === ScreenId.Results) {
        this.updateResultsUi(nowMs);
        if (nowMs >= this.rematchEndsAtMs) {
          if (roster.slots.some((s) => s.wins >= getGameData().tuning.match.sessionWinsToTake)) {
            this.commitHostRoster({ ...roster, phase: RoomPhase.Lobby, slots: roster.slots.map((s) => ({ ...s, wins: 0 })) });
            this.backToLobby();
          } else {
            assert(this.lastRematch !== null, ErrorCode.InvariantViolation, 'Host rematch requires completed RoundResult');
            this.commitHostRoster({ ...roster, arenaId: this.lastRematch.nextArenaId });
            this.startRoundNow();
          }
        }
      }
    } else if (screen === ScreenId.Results) {
      this.updateResultsUi(nowMs);
    }

    if (this.auctioneerBanner !== null && nowMs >= this.bannerExpiryMs) this.auctioneerBanner = null;
    const aspect = Math.max(0.35, this.canvas.clientWidth / Math.max(1, this.canvas.clientHeight));
    this.camera.update(this.renderer.camera, this.renderFighters, this.renderIsland.arenaId, dtMs / 1000, aspect);
    const isLobby = roster.phase === RoomPhase.Lobby || roster.phase === RoomPhase.Countdown;
    const finishBySlot = new Map<number, GlazeFinish>();
    const lSlot = this.localSlot();
    if (lSlot >= 0) finishBySlot.set(lSlot, this.equippedFinish);
    const showSelfMarker = lSlot >= 0 && this.smokeBotsCount === 0 && (screen === ScreenId.Lobby || screen === ScreenId.Hud);
    this.renderer.render({
      fighters: this.renderFighters, island: this.renderIsland, worldGadgets: this.renderGadgets,
      projectiles: this.renderProjectiles,
      isLobby, readyPlatterActive: isLobby && this.platterHoldTicks > 0, finishBySlot,
      ...(showSelfMarker ? { localSlot: lSlot } : {}),
    }, dtMs / 1000);

    if (!this.ready) {
      this.ready = true;
      this.firstLobbyFrameMs = performance.now();
      document.getElementById('boot')?.classList.add('hidden');
    }
    if (screen === ScreenId.Hud) this.updateHudUi(sampled.tick);
    if (this.quality.recordFrame(rawDtMs, performance.now() - scriptStart)) this.renderer.setQuality(this.quality.getTier(), this.quality.getRenderScale());
    if (this.quality.hasPendingTierDrop() && isLobby) this.renderer.setQuality(this.quality.applyPendingTierDrop(), this.quality.getRenderScale());
    this.rafId = requestAnimationFrame((n) => this.frameLoop(n));
  }

  private stepLobbyPlatter(roster: RoomRosterData, dtMs: number): void {
    const humans = roster.slots.filter((s) => s.status !== SlotStatus.Bot && s.status !== SlotStatus.Spectating);
    const onPlatter = new Set<number>();
    for (const s of humans) {
      const f = this.renderFighters.find((rf) => rf.slot === s.slot);
      if (f && Math.abs(f.x) <= PLATTER_R) onPlatter.add(s.slot);
    }
    const prevReady = this.platterHoldTicks > 0;
    const allReady = humans.length > 0 && onPlatter.size === humans.length && roster.slots.length >= 2;
    this.platterHoldTicks = allReady ? this.platterHoldTicks + Math.max(1, Math.round(dtMs / (DT * 1000))) : 0;
    if (!prevReady && this.platterHoldTicks > 0) this.audio.play(SoundId.PlatterOn);
    if (this.platterHoldTicks >= PLATTER_TICKS) {
      this.platterHoldTicks = 0;
      this.countdownAccumMs = 0;
      this.lastCountdownSec = -1;
      this.audio.play(SoundId.PlatterAll);
      this.commitHostRoster({ ...roster, phase: RoomPhase.Countdown, countdownTicks: COUNTDOWN_TICKS });
    }
    this.syncLobbyUi(onPlatter);
  }

  private stepCountdown(roster: RoomRosterData, dtMs: number): void {
    this.countdownAccumMs += dtMs;
    if (this.countdownAccumMs < DT * 1000) return;
    const dec = Math.floor(this.countdownAccumMs / (DT * 1000));
    this.countdownAccumMs -= dec * DT * 1000;
    const left = Math.max(0, roster.countdownTicks - dec);
    if (left === 0) { this.startRoundNow(); return; }
    const secLeft = Math.ceil(left / 60);
    if (secLeft !== this.lastCountdownSec) {
      this.lastCountdownSec = secLeft;
      this.audio.play(SoundId.CountTick);
      this.commitHostRoster({ ...roster, countdownTicks: left });
    } else if (this.session) this.session.roster = { ...roster, countdownTicks: left };
    else this.localRoster = { ...roster, countdownTicks: left };
    this.syncLobbyUi();
  }

  private syncRenderState(sampled: ReturnType<RemoteInterpolator['sample']>): void {
    const pred = this.session && !this.session.isHost ? this.clientPredictor : null;
    const visOff = pred !== null ? pred.getVisualOffset() : { x: 0, y: 0 };
    const giltMax = getGameData().tuning.gilt.max;
    const allowMotionSfx = this.ui.getScreen() === ScreenId.Lobby || this.ui.getScreen() === ScreenId.Hud;
    const pal = getGameData().palette;
    for (const sf of sampled.fighters) {
      const t = this.renderFighters.find((f) => f.slot === sf.slot);
      if (!t) continue;
      if (pred !== null && sf.slot === pred.localSlot) {
        const pf = pred.fighter;
        Object.assign(t, {
          x: pf.x + visOff.x, y: pf.y + visOff.y, vx: pf.vx + pf.kbVx, vy: pf.vy + pf.kbVy,
          state: pf.state, stateFrame: pf.stateFrame, activeMove: pf.activeMove, moveFrame: pf.moveFrame,
          flags: pf.flags, damage: pf.damage, guardHp: pf.guardHp, gilt: pf.gilt, stocks: pf.stocks,
          heldGadget: pf.heldGadget, heldGadgetAmmo: pf.heldGadgetAmmo, nestaSize: pf.nestaSize,
          hitstopFrames: pf.hitstopFrames,
          invulnFrames: (pf.flags & FighterFlag.Invuln) !== 0 ? 1 : 0, teaspoonX: pf.x,
        });
      } else {
        Object.assign(t, {
          x: sf.x, y: sf.y, vx: sf.vx, vy: sf.vy, state: sf.state, stateFrame: sf.stateFrame,
          activeMove: sf.activeMove, moveFrame: sf.moveFrame, flags: sf.flags, damage: sf.damage,
          guardHp: sf.guardHp, gilt: sf.gilt, stocks: sf.stocks, heldGadget: sf.heldGadget,
          heldGadgetAmmo: sf.heldGadgetAmmo, nestaSize: sf.nestaSize,
          hitstopFrames: sf.hitstopFrames,
          invulnFrames: (sf.flags & FighterFlag.Invuln) !== 0 ? 1 : 0, teaspoonX: sf.x,
        });
      }
      const st = this.slotStats.get(t.slot);
      if (st) {
        const prevD = this.prevDamageBySlot.get(t.slot) ?? 0;
        if (t.damage > prevD) st.damageTaken += t.damage - prevD;
        st.peakDamage = Math.max(st.peakDamage, t.damage);
      }
      this.prevDamageBySlot.set(t.slot, t.damage);

      const liveryHex = pal.players[t.slot % pal.players.length]!.hex;
      this.combatFeel.updateFighter(t, liveryHex, allowMotionSfx, this.renderer.vfx, this.audio);

      const pan = Math.max(-0.6, Math.min(0.6, t.x / 12));
      if (t.gilt >= giltMax && !this.prevGiltFullBySlot.has(t.slot)) {
        this.prevGiltFullBySlot.add(t.slot);
        if (allowMotionSfx) this.audio.play(SoundId.GiltFull, { pan });
      } else if (t.gilt < giltMax) {
        this.prevGiltFullBySlot.delete(t.slot);
      }
    }
    for (const sc of sampled.chunks) {
      const t = this.renderIsland.chunks[sc.index];
      if (t) Object.assign(t, { x: sc.x, y: sc.y, angle: sc.angle, vx: sc.vx, vy: sc.vy, state: sc.state, resting: sc.resting });
    }
    const nextRubbleIds = new Set<number>();
    for (const sr of sampled.rubble) {
      nextRubbleIds.add(sr.id);
      if (!this.prevRubbleIds.has(sr.id)) {
        this.audio.play(SoundId.Rubble, { pan: Math.max(-0.6, Math.min(0.6, sr.x / 12)) });
      }
    }
    this.prevRubbleIds = nextRubbleIds;

    this.renderGadgets = sampled.gadgets.map((g) => ({
      id: g.id, gadgetId: g.gadgetId, ammo: g.ammo, state: g.state, x: g.x, y: g.y, vx: g.vx, vy: g.vy,
      angle: g.angle, ttlTicks: 60, armTicks: 0, ownerSlot: -1, stuckChunkIndex: -1, bodyHandle: -1, colliderHandle: -1,
    }));
    this.renderProjectiles = sampled.projectiles.map((p) => ({
      id: p.id, kind: p.kind, ownerSlot: -1, x: p.x, y: p.y, vx: p.vx, vy: p.vy, radius: 0.25, damage: 0,
      bkb: 0, kbg: 0, angle: 0, ttlTicks: 60, gravityScale: 0, reflected: false, stuckFighterSlot: -1,
      stuckChunkIndex: -1, stuckTicks: 0, gadgetId: GadgetId.None, pipingMultiHits: 0,
    }));
  }

  private updateHudUi(tick: number): void {
    const r = this.roster();
    const lSlot = this.localSlot();
    const offscreenBubbles = [];
    for (const f of this.renderFighters) {
      if (f.stocks <= 0) continue;
      this.projVec.set(f.x, f.y + 0.7, 0).project(this.renderer.camera);
      const c = clampBubbleToViewport(this.projVec.x, this.projVec.y, this.projVec.z < 1, this.canvas.clientWidth, this.canvas.clientHeight);
      if (c) offscreenBubbles.push({ slot: f.slot, colourIndex: r.slots.find((s) => s.slot === f.slot)?.colourIndex ?? f.slot, damage: f.damage, edgeX: c.edgeX, edgeY: c.edgeY });
    }
    const lf = this.renderFighters.find((f) => f.slot === lSlot);
    const jitterMs = this.clock.getJitterMs();
    this.ui.updateHud({
      arenaId: this.renderIsland.arenaId, matchMode: r.settings.mode, elapsedTicks: tick,
      fighters: this.renderFighters.map((f) => {
        const sl = r.slots.find((s) => s.slot === f.slot);
        return { slot: f.slot, name: sl ? sl.name : `Lot ${f.slot + 1}`, fighterId: f.id, colourIndex: sl ? sl.colourIndex : f.slot, team: f.team, damage: f.damage, stocks: f.stocks, maxStocks: r.settings.stocks, gilt: f.gilt, heldGadget: f.heldGadget, heldGadgetAmmo: f.heldGadgetAmmo, comboCount: f.comboCount, state: f.state, isLocal: f.slot === lSlot };
      }),
      chunks: this.renderIsland.chunks.map((c) => ({ id: c.id, state: c.state, hpRatio: c.state === ChunkState.Intact ? 1 : c.state === ChunkState.Crazed ? 0.35 : c.state === ChunkState.Loose ? 0.1 : 0 })),
      offscreenBubbles, feedLines: this.feedLines, auctioneerBanner: this.auctioneerBanner,
      teaspoonSlots: this.renderFighters.filter((f) => f.stocks === 0 && f.state === FighterState.Teaspoon).map((f) => f.slot),
      frameData: this.frameDataEnabled && lf ? { visible: true, fighterId: lf.id, state: lf.state, activeMove: lf.activeMove, moveFrame: lf.moveFrame, damage: lf.damage, gilt: lf.gilt, piping: (lf.flags & FighterFlag.Piping) !== 0, nestaSize: lf.nestaSize } : null,
      hostStruggling: this.hostStruggling, highLatencyMs: !this.isAuthHost() && jitterMs > 60 ? jitterMs * 2 : null,
    });
  }

  private syncLobbyUi(onPlatterSlots: ReadonlySet<number> = new Set()): void {
    this.ui.updateLobby({
      roomCode: this.roomCode, selfPeerId: this.selfPeerId(), roster: this.roster(),
      rttByPeerMs: new Map(), onPlatterSlots, frameDataEnabled: this.frameDataEnabled,
      equippedFinish: this.equippedFinish, unlockedAppraisals: this.profile.unlockedAppraisals,
      provenance: this.profile.provenance,
    });
  }

  private selectFighter(fighterId: FighterId): void {
    this.profileFighter = fighterId;
    this.updateProfile({ lastFighter: fighterId });
    if (!this.isAuthHost()) return;
    const r = this.roster();
    this.commitHostRoster({ ...r, slots: r.slots.map((s) => (s.peerId === this.selfPeerId() ? { ...s, fighterId } : s)) });
    if (r.phase === RoomPhase.Lobby) this.startWorkerSaucer();
  }

  private selectColour(colourIndex: number): void {
    this.profileColour = colourIndex;
    this.updateProfile({ lastColorIndex: colourIndex });
    if (!this.isAuthHost()) return;
    const r = this.roster();
    this.commitHostRoster({ ...r, slots: r.slots.map((s) => (s.peerId === this.selfPeerId() ? { ...s, colourIndex } : s)) });
  }

  private selectMode(mode: MatchMode): void {
    if (!this.isAuthHost()) return;
    const r = this.roster();
    this.commitHostRoster({ ...r, settings: { ...r.settings, mode }, slots: r.slots.map((s) => ({ ...s, team: mode === MatchMode.Teams ? (s.slot % 2 === 0 ? TeamId.Cobalt : TeamId.Oxblood) : TeamId.None })) });
  }

  private addBotToRoster(kind: BotKind): void {
    const r = this.roster();
    if (r.slots.filter((s) => s.status === SlotStatus.Bot).length >= MAX_BOTS || r.slots.length >= MAX_FIGHTER_SLOTS) return;
    const used = new Set(r.slots.map((s) => s.slot));
    let free = -1;
    for (let i = 0; i < MAX_FIGHTER_SLOTS; i++) if (!used.has(i)) { free = i; break; }
    if (free < 0) return;
    this.botKinds.set(free, kind);
    const bot: RoomSlotData = { slot: free, peerId: `bot-${free}`, name: `Bot ${free + 1}`, fighterId: (free % 4) as FighterId, colourIndex: free, team: r.settings.mode === MatchMode.Teams ? (free % 2 === 0 ? TeamId.Cobalt : TeamId.Oxblood) : TeamId.None, wins: 0, status: SlotStatus.Bot };
    const next = { ...r, slots: [...r.slots, bot].sort((a, b) => a.slot - b.slot) };
    if (this.session) this.session.roster = next; else this.localRoster = next;
  }

  private addBot(kind: BotKind): void {
    if (!this.isAuthHost()) return;
    this.addBotToRoster(kind);
    this.commitHostRoster(this.roster());
    if (this.roster().phase === RoomPhase.Lobby) this.startWorkerSaucer();
  }

  private removeBot(): void {
    if (!this.isAuthHost()) return;
    const r = this.roster();
    const bots = r.slots.filter((s) => s.status === SlotStatus.Bot);
    const last = bots[bots.length - 1];
    if (!last) return;
    this.botKinds.delete(last.slot);
    this.commitHostRoster({ ...r, slots: r.slots.filter((s) => s.slot !== last.slot) });
    if (r.phase === RoomPhase.Lobby) this.startWorkerSaucer();
  }

  private askPeerToHost(peerId: string): void {
    if (!this.session) return;
    if (this.session.isHost) this.session.transferHost(peerId);
    else this.session.broadcastReliable({ kind: NetMessageKind.Host, action: HostAction.RequestHost, fromPeerId: this.session.transport.selfId, targetPeerId: peerId, directPeersReached: 0, benchScore: this.session.benchScore, medianRttMs: 0 });
  }

  private async showConnectionError(): Promise<void> {
    if (!this.transport) return;
    this.audio.play(SoundId.ErrorKnock);
    const diag = await this.transport.getDiagnostics();
    const peerIds = new Set(this.transport.getPeerIds());
    const nodes = this.roster().slots.filter((s) => s.status !== SlotStatus.Bot).map((s) => ({
      peerId: s.peerId, slot: s.slot, name: s.name, colourIndex: s.colourIndex,
      isSelf: s.peerId === this.transport!.selfId, isHost: s.peerId === this.roster().hostId,
      reachesAll: s.peerId === this.transport!.selfId || peerIds.has(s.peerId),
    }));
    const edges = [];
    for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++) {
      const a = nodes[i]!; const b = nodes[j]!;
      edges.push({ fromPeerId: a.peerId, toPeerId: b.peerId, connected: a.isSelf ? peerIds.has(b.peerId) : b.isSelf ? peerIds.has(a.peerId) : true });
    }
    this.ui.updateConnectionError({ roomCode: this.roomCode, localSlot: this.localSlot(), diagnostics: diag, nodes, edges });
    this.ui.setScreen(ScreenId.ConnectionError);
  }

  private async copyInviteLink(): Promise<boolean> {
    if (typeof navigator === 'undefined' || navigator.clipboard === undefined) return false;
    await navigator.clipboard.writeText(`${window.location.origin}${window.location.pathname}#r=${this.roomCode}`);
    this.audio.play(SoundId.UiCopy);
    return true;
  }

  private async capturePhoto(): Promise<Blob | null> {
    this.renderer.renderer.render(this.renderer.scene, this.renderer.camera);
    const r = this.roster();
    const arenaId = this.lastRematch?.arenaId ?? r.arenaId;
    const winnerSlot = this.lastRematch?.roundResult.winnerSlot ?? r.slots[0]?.slot ?? 0;
    const winner = r.slots.find((s) => s.slot === winnerSlot) ?? r.slots[0];
    const rows = this.buildResultsRows(r, winnerSlot);
    const photoCanvas = renderResultsPhotoCanvas({
      sourceCanvas: this.canvas,
      winnerName: winner ? winner.name : 'Lot 1',
      winnerFighter: winner ? winner.fighterId : this.profileFighter,
      arenaName: getArenaSpec(arenaId).name,
      roundNumber: Math.max(1, this.roundNumber),
      causeLine: rows[0]?.appraisalLine ?? 'Provenance intact; hammer fell cleanly.',
      durationSec: this.roundEndDurationSec,
      rows: rows.map((row) => ({
        name: row.name,
        fighterLabel: getFighterSpec(row.fighterId).name,
        score: row.kos,
        statusLine: row.appraisalLine,
      })),
    });
    return canvasToPngBlob(photoCanvas);
  }

  private async captureSessionCard(): Promise<Blob | null> {
    const r = this.roster();
    const winsGoal = getGameData().tuning.match.sessionWinsToTake;
    const champ = r.slots.find((s) => s.wins >= winsGoal) ?? r.slots[0];
    if (!champ) return null;
    const winnerSlot = this.lastRematch?.roundResult.winnerSlot ?? champ.slot;
    const rows = this.buildResultsRows(r, winnerSlot).map((row) => ({
      rank: row.place,
      name: row.name,
      fighterLabel: getFighterSpec(row.fighterId).name,
      wins: row.wins,
      appraisalLine: row.appraisalLine,
    }));
    const cardCanvas = renderSessionCardCanvas(champ.name, rows);
    return canvasToPngBlob(cardCanvas);
  }

  private async showResultsDemo(): Promise<void> {
    const r = this.roster();
    const winnerSlot = r.slots[0]?.slot ?? 0;
    const nextArenaId = ALL_ARENA_IDS[(ALL_ARENA_IDS.indexOf(r.arenaId) + 1) % ALL_ARENA_IDS.length]!;
    this.roundNumber = Math.max(1, this.roundNumber);
    this.roundEndDurationSec = 42;
    this.lastRematch = {
      roundResult: { winnerSlot, winnerTeam: TeamId.None, endTick: 2520, endedBySuddenDeath: false, endedByHardEnd: false, koOrder: [] },
      arenaId: r.arenaId,
      nextArenaId,
    };
    this.rematchEndsAtMs = performance.now() + getGameData().tuning.match.rematchAutoSeconds * 1000;
    this.ui.setScreen(ScreenId.Results);
    this.updateResultsUi(performance.now());
    await this.ui.refreshResultsMedia();
  }

  private showVersionMismatchDemo(): void {
    const r = this.roster();
    this.ui.updateConnectionError({
      roomCode: this.roomCode,
      localSlot: Math.max(0, this.localSlot()),
      diagnostics: {
        state: ConnectionState.VersionMismatch,
        relaysOpen: 3,
        relaysTotal: 3,
        turnConfigured: false,
        stunAnswered: true,
        natHint: 'cone',
        peers: [],
        errorDetail: 'Protocol version mismatch with room host',
      },
      nodes: r.slots.filter((s) => s.status !== SlotStatus.Bot).map((s) => ({
        peerId: s.peerId, slot: s.slot, name: s.name, colourIndex: s.colourIndex,
        isSelf: s.peerId === this.selfPeerId(), isHost: s.peerId === r.hostId, reachesAll: true,
      })),
      edges: [],
    });
    this.ui.setScreen(ScreenId.ConnectionError);
  }

  private onGlobalKey(e: KeyboardEvent): void {
    const target = e.target as HTMLElement | null;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;
    if (e.code === 'Escape') {
      if (this.ui.getScreen() === ScreenId.CharSelect) this.ui.setScreen(ScreenId.Lobby);
      else if (this.ui.isOverlayOpen() && !this.ui.isSettingsOpen()) this.ui.closeGuide();
      else this.ui.toggleSettings(this.getSettingsState());
    } else if (e.code === 'Tab') {
      e.preventDefault();
      this.frameDataEnabled = !this.frameDataEnabled;
      this.ui.syncSettings(this.getSettingsState());
      this.syncLobbyUi();
    } else if (e.code === 'KeyC' && !this.ui.isOverlayOpen()) {
      const s = this.ui.getScreen();
      if (s === ScreenId.Lobby) this.ui.setScreen(ScreenId.CharSelect);
      else if (s === ScreenId.CharSelect) this.ui.setScreen(ScreenId.Lobby);
    }
  }

  private getSettingsState(): SettingsViewState {
    return {
      qualityTier: this.quality.getTier(),
      touchControlsMode: this.touchControlsMode,
      frameDataEnabled: this.frameDataEnabled,
      shakeScale: this.camera.getShakeScale(),
      reduceFlashes: this.reduceFlashes,
      volume: this.audio.getVolume(),
      volumeMusic: this.audio.getBusVolume('music'),
      volumeEffects: this.audio.getBusVolume('effects'),
      volumeAuctioneer: this.audio.getBusVolume('auctioneer'),
      muted: this.audio.isMuted(),
      colorBlindPatterns: this.colorBlindPatterns,
      keyPreset: this.keyPreset,
      keyBindings: this.input.getBindings(),
    };
  }

  private buildPerfReport() {
    const rs = this.renderer.getRenderStats();
    return this.quality.buildPerfReport(rs.gpu, rs.drawCalls, rs.triangles);
  }

  public dispose(): void {
    cancelAnimationFrame(this.rafId);
    this.input.detach();
    this.audio.detachUnlockListeners();
    this.worker.terminate();
    if (this.clientPredictor !== null) {
      this.clientPredictor.dispose();
      this.clientPredictor = null;
    }
    this.renderer.dispose();
    this.ui.destroy();
    void this.closeNetwork();
  }

  private installDebugApi(): void {
    const app = this;
    window.__bbDebug = {
      get ready() { return app.ready; },
      get firstLobbyFrameMs() { return app.firstLobbyFrameMs; },
      get screen() { return app.ui.getScreen(); },
      get phase() { return app.roster().phase; },
      get tick() { return app.lastSnapTick; },
      get peerCount() { return app.transport ? app.transport.getPeerIds().length : 0; },
      get snapshotsReceived() { return app.snapshotsReceived; },
      get maxSnapshotGapMs() { return app.maxSnapshotGapMs; },
      get lastSnapshotArrivalMs() { return app.lastSnapshotArrivalMs; },
      get frameStats() { return app.quality.getFrameStats(); },
      get renderStats() { return app.renderer.getRenderStats(); },
      get vfxStats() { return app.renderer.vfx.getStats(); },
      get impactCountInWindow() { return app.renderer.vfx.getImpactCountInLastSecond(performance.now()); },
      get qualityTier() { return app.quality.getTier(); },
      get reduceFlashes() { return app.reduceFlashes; },
      get audioState() { return app.audio.getAudioContextState(); },
      get lastInputMask() { return app.lastInputMask; },
      get localFighterState() {
        const lf = app.renderFighters.find((f) => f.slot === app.localSlot());
        if (!lf) return null;
        return {
          state: lf.state,
          activeMove: lf.activeMove,
          moveFrame: lf.moveFrame,
          hitstopFrames: lf.hitstopFrames,
          x: lf.x,
          y: lf.y,
        };
      },
      resetSnapshotGap: () => { app.maxSnapshotGapMs = 0; app.lastSnapshotArrivalMs = performance.now(); },
      setReduceFlashes: (r: boolean) => { app.reduceFlashes = r; app.renderer.vfx.setReduceFlashes(r); },
      startRoundNow: () => app.startRoundNow(),
      setScreen: (s: ScreenId) => app.ui.setScreen(s),
      renderStyleFrame: () => app.renderer.renderStyleFrame(),
      renderShowcase: (kind: 'fighter' | 'arena', id: number) => app.renderer.renderShowcase(kind, id),
      renderCombatShowcase: (opts: CombatShowcaseInput) => {
        app.staticModePaused = true;
        app.uiRoot.style.display = 'none';
        app.renderer.renderCombatShowcase(opts);
      },
      showResultsDemo: () => app.showResultsDemo(),
      showVersionMismatchDemo: () => app.showVersionMismatchDemo(),
      getPerfReportJson: () => JSON.stringify(app.buildPerfReport()),
    };
  }
}
