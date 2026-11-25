import { BotKind } from '@bots/enums';
import type { RoomRosterData } from '@net/codec';
import type { TransportDiagnostics } from '@net/transport';
import { ArenaId, ChunkState, FighterId, FighterState, GadgetId, MatchMode, MoveId, NestaSize, TeamId } from '@sim/enums';
import { h, render } from 'preact';
import type { AudioBusName } from './audio';
import { GlazeFinish, KeyAction, QualityTier, ScreenId } from './enums';
import type { KeyBindingMap, KeyPreset } from './input';
import { type AppraisalId, type FighterProvenance, generateCeramicRoomCode } from './progression';
import type { PerfReport } from './quality';
import { formatClock, formatRoundTimer, TimerPhase } from './ui/hud';
import { AppView } from './ui/screens';

export { formatClock, formatRoundTimer, generateCeramicRoomCode as generateRoomCode, TimerPhase };

export interface UiCallbacks {
  readonly onOpenRoom: () => void;
  readonly onJoinRoom: (roomCode: string) => void;
  readonly onSoloPractice: () => void;
  readonly onCopyInvite: () => Promise<boolean> | boolean;
  readonly onSelectFighter: (fighterId: FighterId) => void;
  readonly onSelectColour: (colourIndex: number) => void;
  readonly onSelectGlazeFinish: (finish: GlazeFinish) => void;
  readonly onSelectArena: (arenaId: ArenaId) => void;
  readonly onToggleFragile: (fragile: boolean) => void;
  readonly onSelectMode: (mode: MatchMode) => void;
  readonly onAddBot: (kind: BotKind) => void;
  readonly onRemoveBot: () => void;
  readonly onToggleFrameData: (enabled: boolean) => void;
  readonly onAskPeerToHost: (peerId: string) => void;
  readonly onRetryConnection: () => void;
  readonly onPlayOfflinePractice: () => void;
  readonly onHardRefresh: () => void;
  readonly onBackToLobby: () => void;
  readonly onCaptureCanvasPhoto: () => Promise<Blob | null> | Blob | null;
  readonly onCaptureSessionCard: () => Promise<Blob | null> | Blob | null;
  readonly onChangeQualityTier: (tier: QualityTier) => void;
  readonly onChangeShakeScale: (scale: number) => void;
  readonly onChangeReduceFlashes: (reduce: boolean) => void;
  readonly onChangeVolume: (volume: number) => void;
  readonly onChangeBusVolume: (bus: AudioBusName, volume: number) => void;
  readonly onChangeMuted: (muted: boolean) => void;
  readonly onToggleColorBlind: (enabled: boolean) => void;
  readonly onChangeKeyPreset: (preset: KeyPreset) => void;
  readonly onRebindKey: (action: KeyAction, code: string) => void;
  readonly onBuildPerfReport: () => PerfReport;
}

export interface FrameDataOverlayState {
  readonly visible: boolean; readonly fighterId: FighterId; readonly state: FighterState;
  readonly activeMove: MoveId; readonly moveFrame: number; readonly damage: number;
  readonly gilt: number; readonly piping: boolean; readonly nestaSize: NestaSize;
}

export interface HudFighterTagState {
  readonly slot: number; readonly name: string; readonly fighterId: FighterId;
  readonly colourIndex: number; readonly team: TeamId; readonly damage: number;
  readonly stocks: number; readonly maxStocks: number; readonly gilt: number;
  readonly heldGadget: GadgetId; readonly heldGadgetAmmo: number; readonly comboCount: number;
  readonly state: FighterState; readonly isLocal: boolean;
}

export interface HudChunkStripItem { readonly id: string; readonly state: ChunkState; readonly hpRatio: number; }
export interface OffscreenFighterBubble { readonly slot: number; readonly colourIndex: number; readonly damage: number; readonly edgeX: number; readonly edgeY: number; }

export interface HudRenderState {
  readonly arenaId: ArenaId; readonly matchMode: MatchMode; readonly elapsedTicks: number;
  readonly fighters: readonly HudFighterTagState[]; readonly chunks: readonly HudChunkStripItem[];
  readonly offscreenBubbles: readonly OffscreenFighterBubble[]; readonly feedLines: readonly string[];
  readonly auctioneerBanner: string | null; readonly teaspoonSlots: readonly number[];
  readonly frameData: FrameDataOverlayState | null; readonly hostStruggling: boolean;
  readonly highLatencyMs: number | null;
}

export interface LobbyRenderState {
  readonly roomCode: string; readonly selfPeerId: string; readonly roster: RoomRosterData;
  readonly rttByPeerMs: ReadonlyMap<string, number>; readonly onPlatterSlots: ReadonlySet<number>;
  readonly frameDataEnabled: boolean;
  readonly equippedFinish: GlazeFinish;
  readonly unlockedAppraisals: readonly AppraisalId[];
  readonly provenance: Record<FighterId, FighterProvenance>;
}

export interface ConnectivityNode {
  readonly peerId: string; readonly slot: number; readonly name: string;
  readonly colourIndex: number; readonly isSelf: boolean; readonly isHost: boolean;
  readonly reachesAll: boolean;
}

export interface ConnectivityEdge { readonly fromPeerId: string; readonly toPeerId: string; readonly connected: boolean; }

export interface ConnectionErrorState {
  readonly roomCode: string; readonly localSlot: number; readonly diagnostics: TransportDiagnostics;
  readonly nodes: readonly ConnectivityNode[]; readonly edges: readonly ConnectivityEdge[];
}

export interface ResultsPlayerRow {
  readonly place: number; readonly slot: number; readonly name: string; readonly fighterId: FighterId;
  readonly colourIndex: number; readonly kos: number; readonly falls: number;
  readonly dealtDamage: number; readonly wins: number; readonly note: string;
  readonly appraisalLine: string;
}

export interface ResultsRenderState {
  readonly roundNumber: number; readonly arenaId: ArenaId; readonly nextArenaId: ArenaId;
  readonly endTick: number; readonly winnerName: string; readonly winnerColourIndex: number;
  readonly isHost: boolean; readonly rematchSecondsLeft: number;
  readonly sessionChampionName: string | null; readonly newlyUnlocked: readonly AppraisalId[];
  readonly rows: readonly ResultsPlayerRow[];
}

export interface SettingsViewState {
  readonly qualityTier: QualityTier; readonly shakeScale: number; readonly reduceFlashes: boolean;
  readonly volume: number; readonly volumeMusic: number; readonly volumeEffects: number; readonly volumeAuctioneer: number;
  readonly muted: boolean; readonly colorBlindPatterns: boolean;
  readonly keyPreset: KeyPreset; readonly keyBindings: KeyBindingMap;
}

export const SELECTABLE_BOT_KINDS: readonly BotKind[] = [BotKind.Chaser, BotKind.Brawler, BotKind.Sharp] as const;

export function clampBubbleToViewport(
  ndcX: number, ndcY: number, inFront: boolean, viewportW: number, viewportH: number, margin = 44,
): { edgeX: number; edgeY: number } | null {
  const sx = inFront ? ndcX : -ndcX;
  const sy = inFront ? ndcY : -ndcY;
  if (inFront && Math.abs(sx) <= 1 && Math.abs(sy) <= 1) return null;
  const halfW = Math.max(1, viewportW * 0.5 - margin);
  const halfH = Math.max(1, viewportH * 0.5 - margin);
  const dx = sx * halfW; const dy = -sy * halfH;
  const scale = Math.max(Math.abs(dx) / halfW, Math.abs(dy) / halfH, 1e-4);
  return { edgeX: Math.round(viewportW * 0.5 + dx / scale), edgeY: Math.round(viewportH * 0.5 + dy / scale) };
}

function hudStateEqual(a: HudRenderState | null, b: HudRenderState): boolean {
  if (a === null) return false;
  if (a.arenaId !== b.arenaId || a.matchMode !== b.matchMode || a.elapsedTicks !== b.elapsedTicks ||
      a.auctioneerBanner !== b.auctioneerBanner || a.hostStruggling !== b.hostStruggling ||
      a.highLatencyMs !== b.highLatencyMs || a.fighters.length !== b.fighters.length ||
      a.chunks.length !== b.chunks.length || a.offscreenBubbles.length !== b.offscreenBubbles.length ||
      a.feedLines.length !== b.feedLines.length || a.teaspoonSlots.length !== b.teaspoonSlots.length) return false;
  for (let i = 0; i < b.feedLines.length; i++) if (a.feedLines[i] !== b.feedLines[i]) return false;
  for (let i = 0; i < b.teaspoonSlots.length; i++) if (a.teaspoonSlots[i] !== b.teaspoonSlots[i]) return false;
  for (let i = 0; i < b.chunks.length; i++) {
    const ca = a.chunks[i]!; const cb = b.chunks[i]!;
    if (ca.id !== cb.id || ca.state !== cb.state) return false;
  }
  for (let i = 0; i < b.fighters.length; i++) {
    const fa = a.fighters[i]!; const fb = b.fighters[i]!;
    if (fa.slot !== fb.slot || fa.name !== fb.name || fa.colourIndex !== fb.colourIndex ||
        Math.floor(fa.damage) !== Math.floor(fb.damage) || fa.stocks !== fb.stocks || fa.maxStocks !== fb.maxStocks ||
        Math.round(fa.gilt) !== Math.round(fb.gilt) || fa.heldGadget !== fb.heldGadget ||
        fa.heldGadgetAmmo !== fb.heldGadgetAmmo || fa.comboCount !== fb.comboCount ||
        fa.state !== fb.state || fa.isLocal !== fb.isLocal) return false;
  }
  for (let i = 0; i < b.offscreenBubbles.length; i++) {
    const ba = a.offscreenBubbles[i]!; const bb = b.offscreenBubbles[i]!;
    if (ba.slot !== bb.slot || ba.colourIndex !== bb.colourIndex || Math.floor(ba.damage) !== Math.floor(bb.damage) ||
        ba.edgeX !== bb.edgeX || ba.edgeY !== bb.edgeY) return false;
  }
  const fa = a.frameData; const fb = b.frameData;
  if ((fa === null) !== (fb === null)) return false;
  if (fa !== null && fb !== null && (
    fa.visible !== fb.visible || fa.fighterId !== fb.fighterId || fa.state !== fb.state ||
    fa.activeMove !== fb.activeMove || fa.moveFrame !== fb.moveFrame || fa.damage !== fb.damage ||
    fa.gilt !== fb.gilt || fa.piping !== fb.piping || fa.nestaSize !== fb.nestaSize
  )) return false;
  return true;
}

export class GameUi {
  private readonly rootEl: HTMLElement;
  private readonly hostEl: HTMLDivElement;
  private readonly callbacks: UiCallbacks;
  private currentScreen: ScreenId = ScreenId.Title;
  private titleRoomCode = generateCeramicRoomCode();
  private settingsOpen = false;
  private settingsState: SettingsViewState | null = null;
  private perfReport: PerfReport | null = null;
  private lobbyState: LobbyRenderState | null = null;
  private hudState: HudRenderState | null = null;
  private errorState: ConnectionErrorState | null = null;
  private resultsState: ResultsRenderState | null = null;
  private photoBlob: Blob | null = null;
  private photoUrl: string | null = null;
  private sessionCardBlob: Blob | null = null;
  private sessionCardUrl: string | null = null;

  public constructor(root: HTMLElement, initialSettings: SettingsViewState, callbacks: UiCallbacks) {
    this.rootEl = root;
    this.settingsState = initialSettings;
    this.rootEl.classList.toggle('cb-patterns', initialSettings.colorBlindPatterns);
    this.hostEl = document.createElement('div');
    root.appendChild(this.hostEl);
    this.callbacks = {
      ...callbacks,
      onChangeQualityTier: (tier) => { callbacks.onChangeQualityTier(tier); if (this.settingsState) this.syncSettings({ ...this.settingsState, qualityTier: tier }); },
      onChangeShakeScale: (scale) => { callbacks.onChangeShakeScale(scale); if (this.settingsState) this.syncSettings({ ...this.settingsState, shakeScale: scale }); },
      onChangeReduceFlashes: (reduce) => { callbacks.onChangeReduceFlashes(reduce); if (this.settingsState) this.syncSettings({ ...this.settingsState, reduceFlashes: reduce }); },
      onChangeVolume: (volume) => { callbacks.onChangeVolume(volume); if (this.settingsState) this.syncSettings({ ...this.settingsState, volume }); },
      onChangeBusVolume: (bus, volume) => {
        callbacks.onChangeBusVolume(bus, volume);
        if (!this.settingsState) return;
        if (bus === 'music') this.syncSettings({ ...this.settingsState, volumeMusic: volume });
        else if (bus === 'effects') this.syncSettings({ ...this.settingsState, volumeEffects: volume });
        else if (bus === 'auctioneer') this.syncSettings({ ...this.settingsState, volumeAuctioneer: volume });
      },
      onChangeMuted: (muted) => { callbacks.onChangeMuted(muted); if (this.settingsState) this.syncSettings({ ...this.settingsState, muted }); },
      onToggleColorBlind: (enabled) => { callbacks.onToggleColorBlind(enabled); if (this.settingsState) this.syncSettings({ ...this.settingsState, colorBlindPatterns: enabled }); },
    };
    this.flush();
  }

  public getScreen(): ScreenId { return this.currentScreen; }
  public setScreen(screen: ScreenId): void {
    if (this.currentScreen === screen) return;
    this.currentScreen = screen;
    this.flush();
    if (screen === ScreenId.Results) void this.refreshPhoto();
  }
  public setTitleRoomCode(code: string): void { this.titleRoomCode = code; this.flush(); }
  public openSettings(state?: SettingsViewState): void {
    if (state !== undefined) this.settingsState = state;
    this.perfReport = this.callbacks.onBuildPerfReport();
    this.settingsOpen = true;
    this.flush();
  }
  public closeSettings(): void { if (!this.settingsOpen) return; this.settingsOpen = false; this.flush(); }
  public isSettingsOpen(): boolean { return this.settingsOpen; }
  public toggleSettings(state?: SettingsViewState): void { if (this.settingsOpen) this.closeSettings(); else this.openSettings(state); }
  public syncSettings(state: SettingsViewState): void {
    this.settingsState = state;
    this.rootEl.classList.toggle('cb-patterns', state.colorBlindPatterns);
    this.flush();
  }
  public updateLobby(state: LobbyRenderState): void { this.lobbyState = state; if (this.currentScreen === ScreenId.Lobby || this.currentScreen === ScreenId.CharSelect) this.flush(); }
  public updateHud(state: HudRenderState): void {
    if (hudStateEqual(this.hudState, state)) return;
    this.hudState = state;
    if (this.currentScreen === ScreenId.Hud) this.flush();
  }
  public updateConnectionError(state: ConnectionErrorState): void { this.errorState = state; if (this.currentScreen === ScreenId.ConnectionError) this.flush(); }
  public updateResults(state: ResultsRenderState): void {
    this.resultsState = state;
    if (this.currentScreen === ScreenId.Results) {
      this.flush();
      if (state.sessionChampionName !== null && this.sessionCardBlob === null) void this.refreshSessionCard();
    }
  }
  public async refreshResultsMedia(): Promise<void> {
    await this.refreshPhoto();
    if (this.resultsState?.sessionChampionName !== null) await this.refreshSessionCard();
  }
  public destroy(): void {
    render(null, this.hostEl);
    this.hostEl.remove();
    if (this.photoUrl !== null) { URL.revokeObjectURL(this.photoUrl); this.photoUrl = null; }
    if (this.sessionCardUrl !== null) { URL.revokeObjectURL(this.sessionCardUrl); this.sessionCardUrl = null; }
  }

  private async refreshPhoto(): Promise<void> {
    const blob = await this.callbacks.onCaptureCanvasPhoto();
    if (this.photoUrl !== null) { URL.revokeObjectURL(this.photoUrl); this.photoUrl = null; }
    this.photoBlob = blob;
    if (blob !== null) this.photoUrl = URL.createObjectURL(blob);
    this.flush();
  }

  private async refreshSessionCard(): Promise<void> {
    const blob = await this.callbacks.onCaptureSessionCard();
    if (this.sessionCardUrl !== null) { URL.revokeObjectURL(this.sessionCardUrl); this.sessionCardUrl = null; }
    this.sessionCardBlob = blob;
    if (blob !== null) this.sessionCardUrl = URL.createObjectURL(blob);
    this.flush();
  }

  private flush(): void {
    if (this.settingsState === null) return;
    render(h(AppView, {
      screen: this.currentScreen, titleRoomCode: this.titleRoomCode, settingsOpen: this.settingsOpen,
      settingsState: this.settingsState, perfReport: this.perfReport, lobbyState: this.lobbyState,
      hudState: this.hudState, errorState: this.errorState, resultsState: this.resultsState,
      photoUrl: this.photoUrl, photoBlob: this.photoBlob,
      sessionCardUrl: this.sessionCardUrl, sessionCardBlob: this.sessionCardBlob,
      callbacks: this.callbacks,
      onOpenSettings: () => this.openSettings(), onCloseSettings: () => this.closeSettings(),
      onSetScreen: (next) => this.setScreen(next),
    }), this.hostEl);
  }
}
