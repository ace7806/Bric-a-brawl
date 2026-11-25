import { getArenaSpec } from '@sim/data';
import { ChunkState, FighterFlag, FighterId, FighterState, GadgetId, MoveId, NestaSize, TeamId, WorldGadgetState } from '@sim/enums';
import { chunkWorldTopBounds } from '@sim/geometry';
import type { FighterRuntime, IslandState, LedgePoint, ProjectileRuntime, WorldGadgetRuntime } from '@sim/types';

export interface BotFighterSummary {
  readonly slot: number;
  readonly id: FighterId;
  readonly team: TeamId;
  readonly x: number;
  readonly y: number;
  readonly vx: number;
  readonly vy: number;
  readonly state: FighterState;
  readonly stateFrame: number;
  readonly activeMove: MoveId;
  readonly moveFrame: number;
  readonly facingRight: boolean;
  readonly grounded: boolean;
  readonly doubleJumpsLeft: number;
  readonly damage: number;
  readonly guardHp: number;
  readonly gilt: number;
  readonly stocks: number;
  readonly heldGadget: GadgetId;
  readonly heldGadgetAmmo: number;
  readonly nestaSize: NestaSize;
  readonly pipingCharged: boolean;
}

export interface BotChunkSummary {
  readonly index: number;
  readonly state: ChunkState;
  readonly x0: number;
  readonly x1: number;
  readonly y: number;
  readonly hp: number;
}

export interface BotGadgetSummary {
  readonly id: number;
  readonly gadgetId: GadgetId;
  readonly state: WorldGadgetState;
  readonly x: number;
  readonly y: number;
}

export interface BotProjectileSummary {
  readonly id: number;
  readonly ownerSlot: number;
  readonly x: number;
  readonly y: number;
  readonly vx: number;
  readonly vy: number;
}

export interface BotView {
  readonly tick: number;
  readonly fighters: readonly BotFighterSummary[];
  readonly chunks: readonly BotChunkSummary[];
  readonly ledges: readonly LedgePoint[];
  readonly gadgets: readonly BotGadgetSummary[];
  readonly projectiles: readonly BotProjectileSummary[];
  readonly blastZone: { readonly left: number; readonly right: number; readonly top: number; readonly bottom: number };
}

export function buildBotView(
  tick: number,
  fighters: readonly FighterRuntime[],
  island: IslandState,
  worldGadgets: readonly WorldGadgetRuntime[],
  projectiles: readonly ProjectileRuntime[],
  blastZone: { readonly left: number; readonly right: number; readonly top: number; readonly bottom: number },
  _chunkBounds: readonly { readonly topX0: number; readonly topX1: number; readonly topY0: number; readonly topY1: number }[],
): BotView {
  const arenaChunks = getArenaSpec(island.arenaId).chunks;
  return {
    tick,
    fighters: fighters.map((f) => ({
      slot: f.slot,
      id: f.id,
      team: f.team,
      x: f.x,
      y: f.y,
      vx: f.vx,
      vy: f.vy,
      state: f.state,
      stateFrame: f.stateFrame,
      activeMove: f.activeMove,
      moveFrame: f.moveFrame,
      facingRight: (f.flags & FighterFlag.FacingRight) !== 0,
      grounded: (f.flags & FighterFlag.Grounded) !== 0,
      doubleJumpsLeft: f.doubleJumpsLeft,
      damage: f.damage,
      guardHp: f.guardHp,
      gilt: f.gilt,
      stocks: f.stocks,
      heldGadget: f.heldGadget,
      heldGadgetAmmo: f.heldGadgetAmmo,
      nestaSize: f.nestaSize,
      pipingCharged: f.pipingCharged,
    })),
    chunks: island.chunks.map((c, i) => {
      const b = chunkWorldTopBounds(arenaChunks[i]!, c.x, c.y);
      return { index: c.index, state: c.state, x0: b.x0, x1: b.x1, y: b.y, hp: c.hp };
    }),
    ledges: island.ledges,
    gadgets: worldGadgets.map((g) => ({
      id: g.id,
      gadgetId: g.gadgetId,
      state: g.state,
      x: g.x,
      y: g.y,
    })),
    projectiles: projectiles.map((p) => ({
      id: p.id,
      ownerSlot: p.ownerSlot,
      x: p.x,
      y: p.y,
      vx: p.vx,
      vy: p.vy,
    })),
    blastZone,
  };
}

/** Ring buffer that delays BotView by N ticks to model human reaction time (10.1). */
export class DelayedBotViewBuffer {
  private readonly queue: BotView[] = [];
  private readonly delayTicks: number;

  public constructor(delayTicks: number) {
    this.delayTicks = Math.max(0, delayTicks);
  }

  public pushAndRead(view: BotView): BotView {
    if (this.delayTicks === 0) return view;
    this.queue.push(view);
    if (this.queue.length <= this.delayTicks) return this.queue[0] as BotView;
    return this.queue.shift() as BotView;
  }
}
