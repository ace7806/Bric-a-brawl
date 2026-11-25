import { requireAt } from '@sim/assert';
import { getGameData } from '@sim/data';
import { useEffect, useState } from 'preact/hooks';
import type { AudioBusName } from '../audio';
import { KeyAction, QualityTier, TouchControlsMode } from '../enums';
import { ALL_KEY_ACTIONS, formatKeyCode, KeyPreset, type KeyBindingMap } from '../input';
import { qualityTierLabel, type PerfReport } from '../quality';
import type { SettingsViewState, UiCallbacks } from '../ui';

const QUALITY_TIERS: readonly QualityTier[] = [QualityTier.Low, QualityTier.Medium, QualityTier.High];
const TOUCH_MODES: readonly [TouchControlsMode, string][] = [
  [TouchControlsMode.Auto, 'Auto'],
  [TouchControlsMode.Always, 'On'],
  [TouchControlsMode.Off, 'Off'],
];
const KEY_PRESETS: readonly [KeyPreset, string][] = [
  [KeyPreset.KeyboardA, 'WASD + JKL'],
  [KeyPreset.KeyboardB, 'Arrows + ZXC'],
];
const KEY_ACTION_LABELS: Record<KeyAction, string> = {
  [KeyAction.Left]: 'Move Left',
  [KeyAction.Right]: 'Move Right',
  [KeyAction.Up]: 'Aim Up',
  [KeyAction.Down]: 'Aim Down',
  [KeyAction.Jump]: 'Jump',
  [KeyAction.Attack]: 'Light Hit',
  [KeyAction.Heavy]: 'Heavy Hit',
  [KeyAction.Special]: 'Special',
  [KeyAction.Guard]: 'Guard / Parry',
  [KeyAction.Grab]: 'Grab',
  [KeyAction.Use]: 'Use Gadget',
  [KeyAction.Taunt]: 'Taunt',
};

enum GuideTab {
  Keyboard = 0,
  Touch = 1,
  Gamepad = 2,
}

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

export function SoundIcon({ muted }: { readonly muted: boolean }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" fill="currentColor" />
      {muted ? (
        <>
          <line x1="22" y1="9" x2="16" y2="15" />
          <line x1="16" y1="9" x2="22" y2="15" />
        </>
      ) : (
        <>
          <path d="M15.5 8.5a5 5 0 0 1 0 7" />
          <path d="M19 5a9.5 9.5 0 0 1 0 14" />
        </>
      )}
    </svg>
  );
}

export function HowToPlayModal({ open, isTouchDevice, keyBindings, onClose }: {
  readonly open: boolean;
  readonly isTouchDevice: boolean;
  readonly keyBindings: KeyBindingMap;
  readonly onClose: () => void;
}) {
  const [tab, setTab] = useState<GuideTab>(isTouchDevice ? GuideTab.Touch : GuideTab.Keyboard);
  if (!open) return null;

  const k = (a: KeyAction) => formatKeyCode(keyBindings[a]);
  const moveKeys = `${k(KeyAction.Left)} / ${k(KeyAction.Right)} / ${k(KeyAction.Up)} / ${k(KeyAction.Down)}`;

  return (
    <div class="modal-backdrop" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div class="card paper guide-modal" data-modal="how-to-play">
        <div class="modal-head">
          <div>
            <div class="caps">Quick Guide</div>
            <div class="display" style="font-size:30px">How to Play</div>
          </div>
          <button type="button" class="btn small" onClick={onClose}>Got it</button>
        </div>

        <div class="guide-steps">
          <div class="guide-step">
            <span class="guide-num">1</span>
            <div>
              <strong>Crack &amp; Launch</strong>
              <p>Land hits to raise rivals' <b>%</b>. Higher % sends them flying farther off the plate.</p>
            </div>
          </div>
          <div class="guide-step">
            <span class="guide-num">2</span>
            <div>
              <strong>Mind the Cracking Plate</strong>
              <p>The porcelain breaks apart over 2 minutes. Stay off shaking shards—or knock rivals onto them.</p>
            </div>
          </div>
          <div class="guide-step">
            <span class="guide-num">3</span>
            <div>
              <strong>Parry &amp; Grab Parcels</strong>
              <p>Tap <b>Guard</b> right before a hit for a ringing <b>Parry</b>. Open falling parcels for wild gadgets.</p>
            </div>
          </div>
        </div>

        <div class="guide-controls">
          <div class="guide-tabs">
            <button type="button" class={`chip${tab === GuideTab.Keyboard ? ' on' : ''}`} onClick={() => setTab(GuideTab.Keyboard)}>Keyboard</button>
            <button type="button" class={`chip${tab === GuideTab.Touch ? ' on' : ''}`} onClick={() => setTab(GuideTab.Touch)}>Touch</button>
            <button type="button" class={`chip${tab === GuideTab.Gamepad ? ' on' : ''}`} onClick={() => setTab(GuideTab.Gamepad)}>Gamepad</button>
          </div>

          {tab === GuideTab.Keyboard && (
            <div class="guide-grid type">
              <div><span class="key">{moveKeys}</span> Move &amp; aim</div>
              <div><span class="key">{k(KeyAction.Jump)}</span> Jump (double jump in air)</div>
              <div><span class="key">{k(KeyAction.Attack)}</span> Light hit &nbsp;<span class="key">{k(KeyAction.Heavy)}</span> Heavy</div>
              <div><span class="key">{k(KeyAction.Special)}</span> Special (combine with direction)</div>
              <div><span class="key">{k(KeyAction.Guard)}</span> Guard (tap to Parry)</div>
              <div><span class="key">{k(KeyAction.Grab)}</span> Grab &nbsp;<span class="key">{k(KeyAction.Use)}</span> Use gadget</div>
            </div>
          )}

          {tab === GuideTab.Touch && (
            <div class="guide-grid type">
              <div><b>Left thumb</b> Slide the stick to walk, dash, or aim specials</div>
              <div><b>Hit / Heavy / Spec</b> Light strikes, launchers &amp; signature moves</div>
              <div><b>Jump</b> Tap twice to double-jump back to the plate</div>
              <div><b>Guard / Grab / Item</b> Tap Guard to parry; tap Item when holding a gadget</div>
            </div>
          )}

          {tab === GuideTab.Gamepad && (
            <div class="guide-grid type">
              <div><b>Left Stick / D-Pad</b> Move &amp; aim</div>
              <div><b>A</b> Jump &nbsp;·&nbsp; <b>X</b> Light &nbsp;·&nbsp; <b>Y</b> Heavy &nbsp;·&nbsp; <b>B</b> Special</div>
              <div><b>RB / RT</b> Guard &amp; Parry &nbsp;·&nbsp; <b>LB</b> Grab</div>
              <div><b>LT</b> Use gadget &nbsp;·&nbsp; <b>Right Stick</b> Quick Heavy</div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export function SettingsModal({ open, inMatch, isHost, state, perfReport, callbacks, onOpenGuide, onClose }: {
  readonly open: boolean;
  readonly inMatch: boolean;
  readonly isHost: boolean;
  readonly state: SettingsViewState;
  readonly perfReport: PerfReport | null;
  readonly callbacks: UiCallbacks;
  readonly onOpenGuide: () => void;
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
    ['Music', 'music', state.volumeMusic],
    ['Effects', 'effects', state.volumeEffects],
    ['Auctioneer', 'auctioneer', state.volumeAuctioneer],
  ];

  return (
    <div class="modal-backdrop" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div class="card paper settings-modal">
        <div class="modal-head">
          <div class="display" style="font-size:30px">Settings</div>
          <div style="display:flex;gap:8px;align-items:center;">
            <button type="button" class="btn small" onClick={() => { onClose(); onOpenGuide(); }}>How to play</button>
            <button type="button" class="btn small primary" onClick={onClose}>Done</button>
          </div>
        </div>

        {inMatch && (
          <div class="settings-match-bar">
            <span class="type" style="font-size:12px;color:var(--ink-soft);">Match in progress</span>
            <button
              type="button"
              class="btn small"
              disabled={!isHost}
              title={isHost ? 'Return everyone to the saucer lobby' : 'Only the host can end the round'}
              onClick={() => { onClose(); callbacks.onBackToLobby(); }}
            >
              Return to lobby
            </button>
          </div>
        )}

        <div class="settings-section">
          <div class="caps">Audio</div>
          <div class="settings-grid">
            <span>Mute all audio</span>
            <input type="checkbox" checked={state.muted} onChange={(e) => callbacks.onChangeMuted(e.currentTarget.checked)} />
            <span>{`Master (${Math.round(state.volume * 100)}%)`}</span>
            <input type="range" min="0" max="1" step="0.05" value={state.volume} onInput={(e) => callbacks.onChangeVolume(Number(e.currentTarget.value))} />
            {busRows.map(([label, bus, val]) => (
              <>
                <span key={`${bus}-l`}>{`${label} (${Math.round(val * 100)}%)`}</span>
                <input key={`${bus}-i`} type="range" min="0" max="1" step="0.05" value={val} onInput={(e) => callbacks.onChangeBusVolume(bus, Number(e.currentTarget.value))} />
              </>
            ))}
          </div>
        </div>

        <div class="settings-section">
          <div class="caps">Graphics &amp; Accessibility</div>
          <div class="settings-grid">
            <span>Quality</span>
            <div style="display:flex;gap:6px;flex-wrap:wrap;">
              {QUALITY_TIERS.map((tier) => (
                <button key={tier} type="button" data-tier={tier} class={`chip${tier === state.qualityTier ? ' on' : ''}`} onClick={() => callbacks.onChangeQualityTier(tier)}>
                  {qualityTierLabel(tier)}
                </button>
              ))}
            </div>
            <span>Touch controls</span>
            <div style="display:flex;gap:6px;flex-wrap:wrap;">
              {TOUCH_MODES.map(([mode, label]) => (
                <button key={mode} type="button" class={`chip${mode === state.touchControlsMode ? ' on' : ''}`} onClick={() => callbacks.onChangeTouchControlsMode(mode)}>
                  {label}
                </button>
              ))}
            </div>
            <span>{`Camera shake (${Math.round(state.shakeScale * 100)}%)`}</span>
            <input type="range" min="0" max="1" step="0.05" value={state.shakeScale} onInput={(e) => callbacks.onChangeShakeScale(Number(e.currentTarget.value))} />
            <span>Reduce flashes</span>
            <input type="checkbox" checked={state.reduceFlashes} onChange={(e) => callbacks.onChangeReduceFlashes(e.currentTarget.checked)} />
            <span>Colour-blind symbols</span>
            <input type="checkbox" data-action="toggle-cb-patterns" checked={state.colorBlindPatterns} onChange={(e) => callbacks.onToggleColorBlind(e.currentTarget.checked)} />
          </div>
        </div>

        <details class="settings-details">
          <summary class="caps">Keyboard Bindings</summary>
          <div class="settings-grid" style="margin-top:10px">
            <span>Preset</span>
            <div style="display:flex;gap:6px;flex-wrap:wrap;">
              {KEY_PRESETS.map(([preset, label]) => (
                <button key={preset} type="button" class={`chip${preset === state.keyPreset ? ' on' : ''}`} onClick={() => callbacks.onChangeKeyPreset(preset)}>{label}</button>
              ))}
            </div>
          </div>
          <div class="rebind-grid" style="margin-top:8px">
            {ALL_KEY_ACTIONS.map((action) => (
              <div key={action} class="rebind-row">
                <span>{KEY_ACTION_LABELS[action]}</span>
                <button type="button" class={`chip${listeningAction === action ? ' on' : ''}`} onClick={() => setListeningAction(action)}>
                  {listeningAction === action ? 'Press key…' : formatKeyCode(state.keyBindings[action])}
                </button>
              </div>
            ))}
          </div>
        </details>

        <details class="settings-details">
          <summary class="caps">Practice &amp; Diagnostics</summary>
          <div class="settings-grid" style="margin-top:10px">
            <span>Frame data overlay</span>
            <input type="checkbox" checked={state.frameDataEnabled} onChange={(e) => callbacks.onToggleFrameData(e.currentTarget.checked)} />
          </div>
          <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;margin-top:10px;">
            <span class="type" style={{ fontSize: '11px', color: perfStatus.ok ? 'var(--ok)' : 'var(--stamp)' }}>{perfStatus.text || 'Performance snapshot'}</span>
            <button type="button" class="btn small" data-action="copy-perf-report" onClick={() => void copyPerf()}>Copy perf report</button>
          </div>
          <pre class="perf-pre" style="margin-top:8px">{perfJson}</pre>
        </details>
      </div>
    </div>
  );
}
