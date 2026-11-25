import { assert, assertNever } from '@sim/assert';
import { getArenaSpec, getGameData, getMoveSpec } from '@sim/data';
import { ArenaId, ChunkState, ErrorCode, FighterId, FighterState, GadgetId, MatchMode, MoveId, NestaSize, TimelineAction } from '@sim/enums';
import type { CSSProperties } from 'preact';
import { memo } from 'preact/compat';
import { ScreenId } from '../enums';
import type { FrameDataOverlayState, HudRenderState } from '../ui';
import { playerColor } from './modals';

export enum TimerPhase { Normal = 0, LastCall = 1, SuddenDeath = 2, Practice = 3 }

export function formatClock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const rem = s % 60;
  return `${Math.floor(s / 60)}:${rem < 10 ? '0' : ''}${rem}`;
}

export function formatRoundTimer(
  elapsedTicks: number, tickRate: number, roundSeconds: number, lastCallSeconds: number, isPractice: boolean,
): { text: string; phase: TimerPhase } {
  if (isPractice) return { text: 'PRACTICE', phase: TimerPhase.Practice };
  const elapsedSec = Math.floor(Math.max(0, elapsedTicks) / tickRate);
  if (elapsedSec >= roundSeconds) return { text: 'SUDDEN DEATH', phase: TimerPhase.SuddenDeath };
  const rem = roundSeconds - elapsedSec;
  return elapsedSec >= lastCallSeconds
    ? { text: `LAST CALL · ${formatClock(rem)}`, phase: TimerPhase.LastCall }
    : { text: formatClock(rem), phase: TimerPhase.Normal };
}

function getLastCallSeconds(arenaId: ArenaId): number {
  const spec = getArenaSpec(arenaId);
  if (!spec.breakable) return getGameData().tuning.match.roundSeconds;
  const entry = spec.timeline.find((e) => e.action === TimelineAction.LastCall);
  assert(entry !== undefined, ErrorCode.MissingRequiredEntry, `Arena ${arenaId} missing LastCall timeline entry`);
  return entry.seconds;
}

const CHUNK_STATE_CLASS: Record<ChunkState, string> = {
  [ChunkState.Intact]: '', [ChunkState.Crazed]: 'crazed', [ChunkState.Loose]: 'loose', [ChunkState.Falling]: 'falling', [ChunkState.Gone]: 'gone',
};
const GADGET_LABEL: Record<GadgetId, string> = {
  [GadgetId.None]: '', [GadgetId.Bellows]: 'Bellows', [GadgetId.Plunger]: 'Plunger', [GadgetId.Cork]: 'Cork', [GadgetId.Pepper]: 'Pepper',
  [GadgetId.Toaster]: 'Toaster', [GadgetId.Jam]: 'Jam', [GadgetId.Timer]: 'Timer', [GadgetId.Hoover]: 'Hoover', [GadgetId.Magnet]: 'Magnet',
};
const FIGHTER_STATE_LABEL: Record<FighterState, string> = {
  [FighterState.Idle]: 'Idle', [FighterState.Walk]: 'Walk', [FighterState.Dash]: 'Dash', [FighterState.Run]: 'Run', [FighterState.Skid]: 'Skid',
  [FighterState.JumpSquat]: 'JumpSquat', [FighterState.Airborne]: 'Airborne', [FighterState.Attack]: 'Attack', [FighterState.Guard]: 'Guard',
  [FighterState.GuardRelease]: 'GuardRel', [FighterState.GuardStun]: 'GuardStun', [FighterState.GuardBreak]: 'GuardBreak', [FighterState.Parry]: 'Parry',
  [FighterState.ParryStun]: 'ParryStun', [FighterState.Roll]: 'Roll', [FighterState.SpotDodge]: 'SpotDodge', [FighterState.AirDodge]: 'AirDodge',
  [FighterState.Grabbing]: 'Grabbing', [FighterState.Held]: 'Held', [FighterState.Hitstun]: 'Hitstun', [FighterState.Tumble]: 'Tumble',
  [FighterState.LedgeHang]: 'LedgeHang', [FighterState.LedgeGetup]: 'LedgeGetup', [FighterState.Helpless]: 'Helpless', [FighterState.Respawn]: 'Respawn',
  [FighterState.Teaspoon]: 'Teaspoon', [FighterState.Eliminated]: 'Eliminated', [FighterState.LandingLag]: 'LandLag', [FighterState.ChargingHeavy]: 'Charge',
};
const nestaSizeLabel = (s: NestaSize): string =>
  s === NestaSize.Big ? 'Big' : s === NestaSize.Mid ? 'Mid' : s === NestaSize.Small ? 'Small' : assertNever(s, 'nestaSizeLabel');

const CB_SHAPES = ['◆', '●', '▲', '■', '★', '✚', '⬟', '✦'] as const;

export function cbShapeForColour(colourIndex: number): string {
  const idx = ((colourIndex % CB_SHAPES.length) + CB_SHAPES.length) % CB_SHAPES.length;
  return CB_SHAPES[idx]!;
}

export function Disc({ slot, colourIndex, style }: { readonly slot: number; readonly colourIndex: number; readonly style?: CSSProperties | undefined }) {
  return (
    <span class="disc" style={{ background: playerColor(colourIndex).hex, ...style }}>
      <span class="disc-num">{slot + 1}</span>
      <span class="disc-cb" aria-hidden="true">{cbShapeForColour(colourIndex)}</span>
    </span>
  );
}

function FrameDataPanel({ fd }: { readonly fd: FrameDataOverlayState }) {
  const m = fd.activeMove !== MoveId.None ? getMoveSpec(fd.fighterId, fd.activeMove) : null;
  const rows: readonly [string, string][] = [
    ['move', m ? m.name : '—'], ['frames', m ? `${m.startup} / ${m.active} / ${m.total}` : '— / — / —'],
    ['moveFrame', m ? String(fd.moveFrame) : '0'], ['onBlock', m && m.onBlock !== null ? `${m.onBlock > 0 ? '+' : ''}${m.onBlock}` : '—'],
    ['damage', `${fd.damage.toFixed(1)}%`], ['state', FIGHTER_STATE_LABEL[fd.state]],
    ['gilt', `${Math.round(fd.gilt)} / ${getGameData().tuning.gilt.max}`],
    ['special', fd.fighterId === FighterId.Nesta ? `Nesta: ${nestaSizeLabel(fd.nestaSize)}` : `Piping: ${fd.piping ? 'ON' : 'OFF'}`],
  ];
  return (
    <div class="card paper type frame-data-panel">
      <div class="caps">Practice frame data</div>
      {rows.map(([k, v]) => <div key={k} class="frame-data-row"><span class="caps">{k}</span><span>{v}</span></div>)}
    </div>
  );
}

export const HudLayer = memo(({ visible, state }: { readonly visible: boolean; readonly state: HudRenderState | null }) => {
  const hiddenStyle = visible ? undefined : { display: 'none' };
  if (state === null) {
    return (
      <div class="hud-layer" data-screen={ScreenId.Hud} style={hiddenStyle}>
        <div class="hud-timer paper"><div class="caps" /><div class="display hud-timer-clock">2:00</div><div class="island-strip" /></div>
        <div class="hud-feed" /><div class="hud-tags" />
      </div>
    );
  }
  const tuning = getGameData().tuning;
  const isPractice = state.matchMode === MatchMode.Practice;
  const timer = formatRoundTimer(state.elapsedTicks, tuning.tickRate, tuning.match.roundSeconds, getLastCallSeconds(state.arenaId), isPractice);
  const meta = `${getArenaSpec(state.arenaId).name} · ${state.matchMode === MatchMode.Teams ? 'Teams' : isPractice ? 'Practice' : 'Free-for-all'}`;
  const clockColor = timer.phase === TimerPhase.SuddenDeath ? 'var(--stamp)' : timer.phase === TimerPhase.LastCall ? 'var(--cobalt)' : 'var(--ink)';
  const netText = state.hostStruggling ? 'Host is struggling' : state.highLatencyMs !== null ? `High latency · ${Math.round(state.highLatencyMs)} ms` : '';
  return (
    <div class="hud-layer" data-screen={ScreenId.Hud} style={hiddenStyle}>
      {state.offscreenBubbles.map((ob) => {
        const pct = Math.floor(ob.damage);
        return (
          <div key={ob.slot} class="offscreen-bubble" style={{ left: `${ob.edgeX}px`, top: `${ob.edgeY}px`, borderColor: playerColor(ob.colourIndex).hex }}>
            <div class="b-slot">{`Lot ${ob.slot + 1}`}<span class="cb-badge" aria-hidden="true">{` ${cbShapeForColour(ob.colourIndex)}`}</span></div>
            <div class="b-pct" style={{ color: pct >= 100 ? 'var(--stamp)' : 'var(--ink)' }}>{`${pct}%`}</div>
          </div>
        );
      })}
      <div class="hud-timer paper">
        <div class="caps">{meta}</div>
        <div class="display hud-timer-clock" style={{ color: clockColor }}>{timer.text}</div>
        <div class="island-strip">{state.chunks.map((c) => <i key={c.id} class={CHUNK_STATE_CLASS[c.state]} />)}</div>
      </div>
      {state.teaspoonSlots.length > 0 && (
        <div class="hud-teaspoons type">{`Teaspoons: ${state.teaspoonSlots.map((s) => `#${s + 1}`).join(' ')} · tap to crack`}</div>
      )}
      <div class="hud-feed">{state.feedLines.map((line, i) => <div key={`${i}-${line}`} class="hud-feed-item">{line}</div>)}</div>
      {state.auctioneerBanner !== null && state.auctioneerBanner.length > 0 && <div class="serif hud-auctioneer">{state.auctioneerBanner}</div>}
      {netText.length > 0 && (
        <div class="type" style="position:fixed;left:50%;top:114px;transform:translateX(-50%);background:rgba(243,237,226,.92);border:1.2px solid var(--warn);color:var(--ink);border-radius:999px;padding:2px 10px;font-size:11px;">
          {netText}
        </div>
      )}
      <div class={`hud-tags${state.fighters.length > 4 ? ' compact' : ''}`}>
        {state.fighters.map((f) => {
          const hex = playerColor(f.colourIndex).hex;
          const cls = `tag${f.damage >= 100 ? ' danger' : ''}${f.comboCount >= 2 ? ' hot' : ''}${f.state === FighterState.Eliminated ? ' eliminated' : ''}`;
          return (
            <div key={f.slot} class={cls}>
              <div class="who"><Disc slot={f.slot} colourIndex={f.colourIndex} /><span>{f.isLocal ? `${f.name} ★` : f.name}</span><span class="cb-badge" aria-hidden="true">{cbShapeForColour(f.colourIndex)}</span></div>
              <div class="pct">{Math.floor(f.damage)}<small>%</small></div>
              <div class="side">
                {f.heldGadget !== GadgetId.None && <div class="gad">{GADGET_LABEL[f.heldGadget]}<b>{f.heldGadgetAmmo}</b></div>}
                <div class="stocks">{Array.from({ length: f.maxStocks }, (_, i) => <i key={i} class={i >= f.stocks ? 'lost' : undefined} style={{ background: hex }} />)}</div>
              </div>
              <div class="gilt"><i style={{ width: `${Math.min(100, Math.max(0, Math.round(f.gilt)))}%` }} /></div>
              {f.comboCount >= 2 && <span style="position:absolute;left:10px;top:-14px;background:var(--stamp);color:#fff;font-family:var(--type);font-size:10px;font-weight:700;border-radius:6px;padding:1px 6px;border:1.2px solid var(--ink);">{`${f.comboCount} HIT`}</span>}
            </div>
          );
        })}
      </div>
      {state.frameData !== null && state.frameData.visible && <FrameDataPanel fd={state.frameData} />}
    </div>
  );
});
