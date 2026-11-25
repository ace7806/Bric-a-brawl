import { requireAt } from '@sim/assert';
import { getGameData } from '@sim/data';
import { useEffect, useState } from 'preact/hooks';
import type { AudioBusName } from '../audio';
import { KeyAction, QualityTier } from '../enums';
import { ALL_KEY_ACTIONS, KeyPreset } from '../input';
import { qualityTierLabel, type PerfReport } from '../quality';
import type { SettingsViewState, UiCallbacks } from '../ui';

const QUALITY_TIERS: readonly QualityTier[] = [QualityTier.Low, QualityTier.Medium, QualityTier.High];
const KEY_PRESETS: readonly [KeyPreset, string][] = [
  [KeyPreset.KeyboardA, 'Preset A (WASD + JKL)'],
  [KeyPreset.KeyboardB, 'Preset B (Arrows + ZXC)'],
];
const KEY_ACTION_LABELS: Record<KeyAction, string> = {
  [KeyAction.Left]: 'Move Left',
  [KeyAction.Right]: 'Move Right',
  [KeyAction.Up]: 'Aim Up',
  [KeyAction.Down]: 'Aim Down',
  [KeyAction.Jump]: 'Jump',
  [KeyAction.Attack]: 'Attack',
  [KeyAction.Heavy]: 'Heavy',
  [KeyAction.Special]: 'Special',
  [KeyAction.Guard]: 'Guard / Parry',
  [KeyAction.Grab]: 'Grab',
  [KeyAction.Use]: 'Use Gadget',
  [KeyAction.Taunt]: 'Taunt',
};

export function playerColor(colourIndex: number): { readonly hex: string; readonly name: string } {
  const players = getGameData().palette.players;
  return requireAt(players, ((colourIndex % players.length) + players.length) % players.length, 'palette.players');
}

export async function copyText(text: string): Promise<{ ok: boolean; status: string }> {
  try {
    if (typeof navigator === 'undefined' || navigator.clipboard === undefined) return { ok: false, status: 'Clipboard unavailable.' };
    await navigator.clipboard.writeText(text);
    return { ok: true, status: 'Copied!' };
  } catch (err) {
    return { ok: false, status: `Copy failed: ${String(err)}` };
  }
}

export function SettingsModal({ open, state, perfReport, callbacks, onClose }: {
  readonly open: boolean;
  readonly state: SettingsViewState;
  readonly perfReport: PerfReport | null;
  readonly callbacks: UiCallbacks;
  readonly onClose: () => void;
}) {
  const [prevReport, setPrevReport] = useState<PerfReport | null>(null);
  const [perfJson, setPerfJson] = useState('');
  const [perfStatus, setPerfStatus] = useState({ ok: true, text: '' });
  const [listeningAction, setListeningAction] = useState<KeyAction | null>(null);

  if (perfReport !== prevReport) {
    setPrevReport(perfReport);
    setPerfJson(perfReport !== null ? JSON.stringify(perfReport, null, 2) : '');
    setPerfStatus({ ok: true, text: '' });
  }

  useEffect(() => {
    if (!open || listeningAction === null) return;
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.code !== 'Escape') {
        callbacks.onRebindKey(listeningAction, e.code);
      }
      setListeningAction(null);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open, listeningAction, callbacks]);

  if (!open) return null;

  const copyPerf = async () => {
    const json = JSON.stringify(callbacks.onBuildPerfReport(), null, 2);
    setPerfJson(json);
    const res = await copyText(json);
    setPerfStatus({ ok: res.ok, text: res.status });
  };

  const busRows: readonly [string, AudioBusName, number][] = [
    ['Music volume', 'music', state.volumeMusic],
    ['Effects volume', 'effects', state.volumeEffects],
    ['Auctioneer volume', 'auctioneer', state.volumeAuctioneer],
  ];

  return (
    <div class="modal-backdrop">
      <div class="card paper settings-modal">
        <div style="display:flex;justify-content:space-between;align-items:center;">
          <div class="display" style="font-size:30px">Settings & Perf</div>
          <button type="button" class="btn small" onClick={onClose}>Close</button>
        </div>
        <div class="settings-section">
          <div class="caps">Graphics & Accessibility</div>
          <div class="settings-grid">
            <span>Quality tier</span>
            <div style="display:flex;gap:6px;">
              {QUALITY_TIERS.map((tier) => (
                <button key={tier} type="button" data-tier={tier} class={`chip${tier === state.qualityTier ? ' on' : ''}`} onClick={() => callbacks.onChangeQualityTier(tier)}>
                  {qualityTierLabel(tier)}
                </button>
              ))}
            </div>
            <span>{`Camera shake (${Math.round(state.shakeScale * 100)}%)`}</span>
            <input type="range" min="0" max="1" step="0.05" value={state.shakeScale} onInput={(e) => callbacks.onChangeShakeScale(Number(e.currentTarget.value))} />
            <span>Reduce flashes</span>
            <input type="checkbox" checked={state.reduceFlashes} onChange={(e) => callbacks.onChangeReduceFlashes(e.currentTarget.checked)} />
            <span>Colour-blind patterns</span>
            <input type="checkbox" data-action="toggle-cb-patterns" checked={state.colorBlindPatterns} onChange={(e) => callbacks.onToggleColorBlind(e.currentTarget.checked)} />
          </div>
        </div>
        <div class="settings-section">
          <div class="caps">Audio & Controls</div>
          <div class="settings-grid">
            <span>Mute audio</span>
            <input type="checkbox" checked={state.muted} onChange={(e) => callbacks.onChangeMuted(e.currentTarget.checked)} />
            <span>{`Master volume (${Math.round(state.volume * 100)}%)`}</span>
            <input type="range" min="0" max="1" step="0.05" value={state.volume} onInput={(e) => callbacks.onChangeVolume(Number(e.currentTarget.value))} />
            {busRows.map(([label, bus, val]) => (
              <>
                <span key={`${bus}-l`}>{`${label} (${Math.round(val * 100)}%)`}</span>
                <input key={`${bus}-i`} type="range" min="0" max="1" step="0.05" value={val} onInput={(e) => callbacks.onChangeBusVolume(bus, Number(e.currentTarget.value))} />
              </>
            ))}
            <span>Keyboard preset</span>
            <div style="display:flex;gap:6px;flex-wrap:wrap;">
              {KEY_PRESETS.map(([preset, label]) => (
                <button key={preset} type="button" class={`chip${preset === state.keyPreset ? ' on' : ''}`} onClick={() => callbacks.onChangeKeyPreset(preset)}>{label}</button>
              ))}
            </div>
          </div>
          <div class="caps" style="margin-top:4px">Key bindings (click to rebind)</div>
          <div class="rebind-grid">
            {ALL_KEY_ACTIONS.map((action) => (
              <div key={action} class="rebind-row">
                <span>{KEY_ACTION_LABELS[action]}</span>
                <button type="button" class={`chip${listeningAction === action ? ' on' : ''}`} onClick={() => setListeningAction(action)}>
                  {listeningAction === action ? 'Press key…' : state.keyBindings[action]}
                </button>
              </div>
            ))}
          </div>
        </div>
        <div class="settings-section">
          <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;">
            <div class="caps">Performance Report</div>
            <div style="display:flex;gap:8px;align-items:center;">
              <span class="type" style={{ fontSize: '11px', color: perfStatus.ok ? 'var(--ok)' : 'var(--stamp)' }}>{perfStatus.text}</span>
              <button type="button" class="btn small primary" data-action="copy-perf-report" onClick={() => void copyPerf()}>Copy perf report</button>
            </div>
          </div>
          <pre class="perf-pre">{perfJson}</pre>
        </div>
      </div>
    </div>
  );
}
