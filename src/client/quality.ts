import { assert, assertFinite, assertNever } from '@sim/assert';
import { ErrorCode } from '@sim/enums';
import { QualityTier } from './enums';

export interface QualityPreset {
  readonly tier: QualityTier;
  readonly pixelRatio: number;
  readonly antialias: number;
  readonly maxDrawCalls: number;
  readonly maxTriangles: number;
  readonly maxShards: number;
  readonly maxDust: number;
  readonly finishPass: boolean;
}

export interface FrameStats {
  readonly count: number;
  readonly meanMs: number;
  readonly p50Ms: number;
  readonly p95Ms: number;
  readonly maxMs: number;
  readonly scriptMeanMs: number;
  readonly scriptP95Ms: number;
}

export interface PerfReport {
  readonly gpu: string;
  readonly tier: QualityTier;
  readonly tierLabel: string;
  readonly userMaxTier: QualityTier;
  readonly renderScale: number;
  readonly pendingTierDrop: boolean;
  readonly drawCalls: number;
  readonly triangles: number;
  readonly frameStats: FrameStats;
  readonly budgets: {
    readonly maxDrawCalls: number;
    readonly maxTriangles: number;
  };
}

const PRESETS: Record<QualityTier, QualityPreset> = {
  [QualityTier.Low]: {
    tier: QualityTier.Low,
    pixelRatio: 0.75,
    antialias: 0,
    maxDrawCalls: 60,
    maxTriangles: 70_000,
    maxShards: 100,
    maxDust: 80,
    finishPass: false,
  },
  [QualityTier.Medium]: {
    tier: QualityTier.Medium,
    pixelRatio: 1.0,
    antialias: 2,
    maxDrawCalls: 80,
    maxTriangles: 110_000,
    maxShards: 180,
    maxDust: 150,
    finishPass: true,
  },
  [QualityTier.High]: {
    tier: QualityTier.High,
    pixelRatio: 1.5,
    antialias: 4,
    maxDrawCalls: 90,
    maxTriangles: 110_000,
    maxShards: 300,
    maxDust: 250,
    finishPass: true,
  },
};

export const RENDER_SCALES: readonly number[] = [1.0, 0.85, 0.7];
const DOWNGRADE_P95_MS = 18.0;
const DOWNGRADE_HOLD_MS = 2000;
const UPGRADE_P95_MS = 12.0;
const UPGRADE_HOLD_MS = 10_000;
const BUFFER_CAP = 180;

export function getQualityPreset(tier: QualityTier): QualityPreset {
  switch (tier) {
    case QualityTier.Low:
      return PRESETS[QualityTier.Low];
    case QualityTier.Medium:
      return PRESETS[QualityTier.Medium];
    case QualityTier.High:
      return PRESETS[QualityTier.High];
    default:
      return assertNever(tier, 'getQualityPreset');
  }
}

export function qualityTierLabel(tier: QualityTier): string {
  switch (tier) {
    case QualityTier.Low:
      return 'Low';
    case QualityTier.Medium:
      return 'Medium';
    case QualityTier.High:
      return 'High';
    default:
      return assertNever(tier, 'qualityTierLabel');
  }
}

function computeStats(buf: Float32Array, count: number): { mean: number; p50: number; p95: number; max: number } {
  if (count === 0) return { mean: 0, p50: 0, p95: 0, max: 0 };
  const sorted = Array.from(buf.subarray(0, count)).sort((a, b) => a - b);
  let sum = 0;
  for (let i = 0; i < count; i++) sum += sorted[i]!;
  const p50 = sorted[Math.min(count - 1, Math.floor(count * 0.5))]!;
  const p95 = sorted[Math.min(count - 1, Math.floor(count * 0.95))]!;
  const max = sorted[count - 1]!;
  return { mean: sum / count, p50, p95, max };
}

export class QualityManager {
  private tier: QualityTier;
  private userMaxTier: QualityTier;
  private pinned = false;
  private scaleIndex = 0;
  private pendingTierDrop = false;

  private readonly frameRing = new Float32Array(BUFFER_CAP);
  private readonly scriptRing = new Float32Array(BUFFER_CAP);
  private cursor = 0;
  private count = 0;

  private overBudgetMs = 0;
  private underBudgetMs = 0;

  public constructor(initialTier: QualityTier = QualityTier.Medium) {
    this.tier = initialTier;
    this.userMaxTier = initialTier;
  }

  public getTier(): QualityTier {
    return this.tier;
  }

  public getUserMaxTier(): QualityTier {
    return this.userMaxTier;
  }

  public getRenderScale(): number {
    return RENDER_SCALES[this.scaleIndex]!;
  }

  public getPreset(): QualityPreset {
    return getQualityPreset(this.tier);
  }

  public hasPendingTierDrop(): boolean {
    return this.pendingTierDrop;
  }

  public setUserMaxTier(tier: QualityTier, pinned = false): void {
    getQualityPreset(tier);
    this.userMaxTier = tier;
    this.tier = tier;
    this.pinned = pinned;
    this.scaleIndex = 0;
    this.pendingTierDrop = false;
    this.overBudgetMs = 0;
    this.underBudgetMs = 0;
  }

  public isPinned(): boolean {
    return this.pinned;
  }

  public applyPendingTierDrop(): QualityTier {
    if (this.pendingTierDrop && this.tier > QualityTier.Low) {
      this.tier = (this.tier - 1) as QualityTier;
      this.scaleIndex = 0;
    }
    this.pendingTierDrop = false;
    this.overBudgetMs = 0;
    this.underBudgetMs = 0;
    return this.tier;
  }

  /** Record one frame's total delta and main-thread script time in ms; returns true if renderScale changed. */
  public recordFrame(frameMs: number, scriptMs: number): boolean {
    assertFinite(frameMs, 'quality.frameMs');
    assertFinite(scriptMs, 'quality.scriptMs');
    assert(frameMs >= 0 && scriptMs >= 0, ErrorCode.InvariantViolation, 'Frame/script ms must be >= 0');

    this.frameRing[this.cursor] = frameMs;
    this.scriptRing[this.cursor] = scriptMs;
    this.cursor = (this.cursor + 1) % BUFFER_CAP;
    if (this.count < BUFFER_CAP) this.count++;

    if (this.pinned || this.count < 30) return false;

    const p95 = computeStats(this.frameRing, this.count).p95;
    if (p95 > DOWNGRADE_P95_MS) {
      this.overBudgetMs += frameMs;
      this.underBudgetMs = 0;
      if (this.overBudgetMs >= DOWNGRADE_HOLD_MS) {
        this.overBudgetMs = 0;
        if (this.scaleIndex < RENDER_SCALES.length - 1) {
          this.scaleIndex++;
          return true;
        }
        if (this.tier > QualityTier.Low) {
          this.pendingTierDrop = true;
        }
      }
    } else if (p95 < UPGRADE_P95_MS) {
      this.underBudgetMs += frameMs;
      this.overBudgetMs = 0;
      if (this.underBudgetMs >= UPGRADE_HOLD_MS) {
        this.underBudgetMs = 0;
        if (this.scaleIndex > 0) {
          this.scaleIndex--;
          return true;
        }
        if (this.tier < this.userMaxTier) {
          this.tier = (this.tier + 1) as QualityTier;
          return true;
        }
      }
    } else {
      this.overBudgetMs = 0;
      this.underBudgetMs = 0;
    }
    return false;
  }

  public getFrameStats(): FrameStats {
    const f = computeStats(this.frameRing, this.count);
    const s = computeStats(this.scriptRing, this.count);
    return {
      count: this.count,
      meanMs: Number(f.mean.toFixed(2)),
      p50Ms: Number(f.p50.toFixed(2)),
      p95Ms: Number(f.p95.toFixed(2)),
      maxMs: Number(f.max.toFixed(2)),
      scriptMeanMs: Number(s.mean.toFixed(2)),
      scriptP95Ms: Number(s.p95.toFixed(2)),
    };
  }

  public buildPerfReport(gpuString: string, drawCalls: number, triangles: number): PerfReport {
    const preset = this.getPreset();
    return {
      gpu: gpuString,
      tier: this.tier,
      tierLabel: qualityTierLabel(this.tier),
      userMaxTier: this.userMaxTier,
      renderScale: this.getRenderScale(),
      pendingTierDrop: this.pendingTierDrop,
      drawCalls,
      triangles,
      frameStats: this.getFrameStats(),
      budgets: {
        maxDrawCalls: preset.maxDrawCalls,
        maxTriangles: preset.maxTriangles,
      },
    };
  }
}
