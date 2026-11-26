import { BotKind } from '@bots/enums';
import { BUILD_ID, PROTOCOL_VERSION } from '@net/config';
import { ConnectionState, RoomPhase, SlotStatus } from '@net/enums';
import { assertNever } from '@sim/assert';
import { getArenaSpec, getFighterSpec, getGameData } from '@sim/data';
import { ALL_ARENA_IDS, ALL_FIGHTER_IDS, FighterId, GadgetId, InputBit, InputDir, MatchMode } from '@sim/enums';
import { useState } from 'preact/hooks';
import { GlazeFinish, ScreenId } from '../enums';
import { getElementalFighter } from '../elemental-roster';
import { ALL_APPRAISAL_IDS, APPRAISAL_SPECS, type AppraisalId, type FighterProvenance } from '../progression';
import type { PerfReport } from '../quality';
import {
  SELECTABLE_BOT_KINDS,
  type ConnectionErrorState,
  type HudRenderState,
  type LobbyRenderState,
  type ResultsRenderState,
  type SettingsViewState,
  type UiCallbacks,
} from '../ui';
import { cbShapeForColour, Disc, formatClock, HudLayer } from './hud';
import { copyText, HowToPlayModal, playerColor, SettingsModal, SoundIcon } from './modals';
import { TouchControls } from './touch-controls';

const MAX_BOTS = 3;
const BOT_LABEL: Record<BotKind, string> = {
  [BotKind.Masher]: 'Masher', [BotKind.Tape]: 'Tape', [BotKind.Chaser]: 'Easy', [BotKind.Brawler]: 'Medium',
  [BotKind.Sharp]: 'Hard', [BotKind.ParryBot]: 'Parry', [BotKind.BlockBot]: 'Block', [BotKind.Runner]: 'Runner',
};

function diagCodeForState(s: ConnectionState): string {
  switch (s) {
    case ConnectionState.Idle: case ConnectionState.Signalling: case ConnectionState.Connected: return 'BB-NET-TIMEOUT';
    case ConnectionState.PeerFailed: return 'BB-ICE-FAILED';
    case ConnectionState.RelayFailed: return 'BB-RELAY-FAILED';
    case ConnectionState.VersionMismatch: return 'BB-VERSION-MISMATCH';
    default: return assertNever(s, 'diagCodeForState');
  }
}

function slotStatusLabel(s: SlotStatus, onPlatter: boolean): string {
  switch (s) {
    case SlotStatus.Loading: return 'joining';
    case SlotStatus.Ready: return 'ready';
    case SlotStatus.Connected: return onPlatter ? 'ready' : 'on saucer';
    case SlotStatus.Spectating: return 'watching';
    case SlotStatus.Bot: return 'bot';
    default: return assertNever(s, 'slotStatusLabel');
  }
}

const Pips = ({ count, total }: { readonly count: number; readonly total: number }) => (
  <>{Array.from({ length: total }, (_, i) => <i key={i} class={i < count ? 'on' : undefined} />)}</>
);

const BackstampSvg = () => (
  <svg class="backstamp" viewBox="0 0 200 200" width="76" height="76">
    <defs><path id="bb-arcT" d="M 26,100 a 74,74 0 0,1 148,0" /><path id="bb-arcB" d="M 20,100 a 80,80 0 0,0 160,0" /></defs>
    <circle cx="100" cy="100" r="96" fill="none" stroke="#24459A" strokeWidth="3" />
    <circle cx="100" cy="100" r="89" fill="none" stroke="#24459A" strokeWidth="1" />
    <circle cx="100" cy="100" r="55" fill="none" stroke="#24459A" strokeWidth="1.5" />
    <text fontFamily="Courier Prime" fontWeight="700" fontSize="15.5" letterSpacing="3.2" fill="#24459A"><textPath href="#bb-arcT" startOffset="50%" textAnchor="middle">THE MANTEL POTTERY</textPath></text>
    <text fontFamily="Courier Prime" fontWeight="700" fontSize="12.5" letterSpacing="2.4" fill="#24459A"><textPath href="#bb-arcB" startOffset="50%" textAnchor="middle">FINE BONE OF CONTENTION</textPath></text>
    <text x="100" y="122" textAnchor="middle" fontFamily="Fraunces" fontWeight="900" fontSize="50" fill="#24459A">B·B</text>
  </svg>
);

function TitleScreen({
  roomCode, muted, callbacks, onOpenGuide, onOpenSettings,
}: {
  readonly roomCode: string;
  readonly muted: boolean;
  readonly callbacks: UiCallbacks;
  readonly onOpenGuide: () => void;
  readonly onOpenSettings: () => void;
}) {
  const [inputCode, setInputCode] = useState(roomCode);
  const [prevCode, setPrevCode] = useState(roomCode);
  const [error, setError] = useState('');
  if (roomCode !== prevCode) { setPrevCode(roomCode); setInputCode(roomCode); }

  const submitJoin = () => {
    const code = inputCode.trim();
    if (code.length === 0) { setError('Paste or type a room code to join.'); return; }
    setError('');
    callbacks.onJoinRoom(code);
  };

  return (
    <div class="title-screen" data-screen={ScreenId.Title}>
      <div class="title-panel">
        <div class="title-brand">
          <BackstampSvg />
          <div class="caps">The Mantel Auction Rooms<br />2 to 8 players · one link</div>
        </div>
        <h1 class="display title-logo">BRIC-A-<br />BRAWL</h1>
        <p class="serif title-sub">Four elemental fighters · destructible arenas · Smash-style brawls.</p>
        <hr class="rule" />
        <div class="title-actions">
          <div class="title-primary-row">
            <button type="button" class="btn primary" data-action="open-room" onClick={() => callbacks.onOpenRoom()}>Open room</button>
            <button type="button" class="btn" data-action="solo-practice" onClick={() => callbacks.onSoloPractice()}>Play solo</button>
          </div>
          <div class="title-join-row">
            <input
              type="text"
              class="input-line"
              placeholder="Enter room code…"
              aria-label="Room code"
              value={inputCode}
              onInput={(e) => { setInputCode(e.currentTarget.value); if (error) setError(''); }}
              onKeyDown={(e) => { if (e.key === 'Enter') submitJoin(); }}
            />
            <button type="button" class="btn small" data-action="join-room" onClick={submitJoin}>Join</button>
          </div>
          {error.length > 0 && <div class="type title-error">{error}</div>}
        </div>
        <hr class="rule" />
        <div class="title-links">
          <button type="button" class="link-btn" data-action="open-guide" onClick={onOpenGuide}>How to play</button>
          <button type="button" class="link-btn" data-action="open-settings" onClick={onOpenSettings}>Settings</button>
          <button
            type="button"
            class="link-btn title-sound-btn"
            data-action="toggle-mute"
            onClick={() => callbacks.onChangeMuted(!muted)}
          >
            <SoundIcon muted={muted} />
            <span>{muted ? 'Sound off' : 'Sound on'}</span>
          </button>
        </div>
      </div>
    </div>
  );
}

function CatalogueModal({ fighterId, colourIndex, equippedFinish, unlockedAppraisals, provenance, takenBySlot, callbacks, onBack }: {
  readonly fighterId: FighterId; readonly colourIndex: number; readonly equippedFinish: GlazeFinish;
  readonly unlockedAppraisals: readonly AppraisalId[]; readonly provenance: Record<FighterId, FighterProvenance>;
  readonly takenBySlot: ReadonlyMap<number, number>; readonly callbacks: UiCallbacks; readonly onBack: () => void;
}) {
  const spec = getFighterSpec(fighterId); const s = spec.stats;
  const elem = getElementalFighter(fighterId);
  const prov = provenance[fighterId];
  const unlockedSet = new Set(unlockedAppraisals);
  const pip = (v: number) => Math.min(5, Math.max(1, Math.round(v)));
  const bars: readonly [string, number][] = [
    ['Weight', pip(s.weight * 2.8)], ['Speed', pip((s.run - 5) / 1.1)], ['Reach', pip(s.grabRange * 2.2)],
    ['Recovery', pip(s.doubleJump + s.airSpeed * 0.3 - 1.5)], ['Launch', pip(s.crackMult * 2.5)],
  ];
  const unlockedFinishes = ALL_APPRAISAL_IDS.filter((aid) => unlockedSet.has(aid));
  const lockedFinishes = ALL_APPRAISAL_IDS.filter((aid) => !unlockedSet.has(aid));

  return (
    <div class="catalogue-backdrop" data-screen={ScreenId.CharSelect} onClick={(e) => { if (e.target === e.currentTarget) onBack(); }}>
      <div class="catalogue-spread paper">
        <div class="catalogue-list">
          <div class="catalogue-list-head">
            <div>
              <div class="caps">Elemental Roster</div>
              <div class="display" style="font-size:28px">Choose Fighter</div>
            </div>
            <button type="button" class="btn small primary" onClick={onBack}>Done</button>
          </div>
          <hr class="rule2" />
          <div class="catalogue-lots">
            {ALL_FIGHTER_IDS.map((fid, i) => {
              const el = getElementalFighter(fid);
              return (
                <button key={fid} type="button" data-fighter={fid} class={`lot-item${fid === fighterId ? ' sel' : ''}`} onClick={() => callbacks.onSelectFighter(fid)}>
                  <img class="lot-portrait" src={el.portraitUrl} alt={el.name} style={{ borderColor: el.accentHex }} />
                  <div class="lot-info">
                    <div class="lot-meta">
                      <span class="caps">{`Lot ${i + 1}`}</span>
                      <span class="elem-badge" style={{ background: el.accentHex }}>{el.element}</span>
                    </div>
                    <div class="display lot-title">{el.name}</div>
                    <div class="type lot-role">{el.title}</div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
        <div class="catalogue-detail">
          <div class="catalogue-hero">
            <img class="catalogue-hero-portrait" src={elem.portraitUrl} alt={elem.name} style={{ borderColor: elem.accentHex }} />
            <div class="catalogue-hero-meta">
              <div class="lot-meta">
                <span class="caps">{`Lot ${ALL_FIGHTER_IDS.indexOf(fighterId) + 1} · ${elem.title}`}</span>
                <span class="elem-badge" style={{ background: elem.accentHex }}>{elem.element}</span>
              </div>
              <div class="display catalogue-name">{elem.name}</div>
              <div class="serif" style="font-style:italic;font-size:16px;">{`${elem.role} · Difficulty ${spec.difficulty}/3`}</div>
            </div>
          </div>
          {prov.roundsPlayed > 0 && (
            <div class="provenance-line type">
              {`${prov.roundsPlayed} rounds · ${prov.wins} wins · ${prov.kos} KOs · Last exit: ${prov.mostEmbarrassingExit}`}
            </div>
          )}
          <div class="catalogue-trick">
            <div class="caps">Signature Move</div>
            <div>{elem.trick}</div>
          </div>
          <div style="margin-top:10px">{bars.map(([label, n]) => <div key={label} class="stat-bar"><span class="caps">{label}</span><span class="stat-pips"><Pips count={n} total={5} /></span></div>)}</div>
          <div style="margin-top:14px">
            <div class="caps">Player colour</div>
            <div class="swatch-row" style="margin-top:8px">
              {getGameData().palette.players.map((p, i) => {
                const owner = takenBySlot.get(i); const taken = owner !== undefined && i !== colourIndex;
                return (
                  <button key={p.name} type="button" title={p.name} class={`sw${i === colourIndex ? ' sel' : ''}${taken ? ' taken' : ''}`}
                    style={{ background: p.hex, color: '#fff', fontFamily: 'var(--type)', fontWeight: 700, fontSize: '12px' }} onClick={() => callbacks.onSelectColour(i)}>
                    {taken ? String(owner) : <span class="cb-badge">{cbShapeForColour(i)}</span>}
                  </button>
                );
              })}
              <span class="type" style="font-size:12.5px">{playerColor(colourIndex).name}</span>
            </div>
          </div>
          <div style="margin-top:14px">
            <div class="caps">{`Battle finish (${unlockedFinishes.length}/${ALL_APPRAISAL_IDS.length} unlocked)`}</div>
            <div class="finish-chips">
              <button type="button" class={`chip${equippedFinish === GlazeFinish.Standard ? ' on' : ''}`} onClick={() => callbacks.onSelectGlazeFinish(GlazeFinish.Standard)}>
                Standard
              </button>
              {unlockedFinishes.map((aid) => {
                const aspec = APPRAISAL_SPECS[aid];
                return (
                  <button key={aid} type="button" title={`${aspec.title}: ${aspec.criteria}`}
                    class={`chip${equippedFinish === aspec.reward ? ' on' : ''}`}
                    onClick={() => callbacks.onSelectGlazeFinish(aspec.reward)}>
                    {aspec.rewardLabel}
                  </button>
                );
              })}
            </div>
            {lockedFinishes.length > 0 && (
              <details class="settings-details" style="margin-top:8px">
                <summary class="caps">{`Locked finishes (${lockedFinishes.length})`}</summary>
                <div class="finish-chips" style="margin-top:8px">
                  {lockedFinishes.map((aid) => {
                    const aspec = APPRAISAL_SPECS[aid];
                    return (
                      <span key={aid} class="chip locked-chip" title={`${aspec.title}: ${aspec.criteria}`}>
                        {`${aspec.rewardLabel} — ${aspec.criteria}`}
                      </span>
                    );
                  })}
                </div>
              </details>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function LobbyScreen({
  state, showCatalogue, muted, touchActive, callbacks, onSetScreen, onOpenGuide, onOpenSettings,
}: {
  readonly state: LobbyRenderState;
  readonly showCatalogue: boolean;
  readonly muted: boolean;
  readonly touchActive: boolean;
  readonly callbacks: UiCallbacks;
  readonly onSetScreen: (s: ScreenId) => void;
  readonly onOpenGuide: () => void;
  readonly onOpenSettings: () => void;
}) {
  const [botKind, setBotKind] = useState<BotKind>(BotKind.Chaser);
  const [copyStatus, setCopyStatus] = useState({ ok: true, text: '' });
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [rosterOpenMobile, setRosterOpenMobile] = useState(false);

  const { roster, selfPeerId, rttByPeerMs, onPlatterSlots } = state;
  const isHost = roster.hostId === selfPeerId;
  const maxPlayers = getGameData().tuning.net.maxPlayers;
  const botCount = roster.slots.filter((s) => s.status === SlotStatus.Bot).length;
  const selfSlot = roster.slots.find((s) => s.peerId === selfPeerId);
  const selfFighter = selfSlot !== undefined ? selfSlot.fighterId : FighterId.Earl;
  const selfElem = getElementalFighter(selfFighter);
  const selfColour = selfSlot !== undefined ? selfSlot.colourIndex : 0;
  const takenBySlot = new Map(roster.slots.map((s) => [s.colourIndex, s.slot + 1]));
  const active = roster.slots.filter((s) => s.status !== SlotStatus.Spectating);
  const isReady = (s: typeof active[number]) => s.status === SlotStatus.Bot || s.status === SlotStatus.Ready || onPlatterSlots.has(s.slot);
  const canStart = isHost && active.length >= 2 && roster.phase === RoomPhase.Lobby;
  const isSoloLocal = selfPeerId === 'local';

  return (
    <>
      <div class={`lobby-screen${touchActive ? ' with-touch' : ''}`} data-screen={ScreenId.Lobby}>
        {/* Top-left compact room & utility bar */}
        <div class="card paper lobby-room">
          <div class="lobby-room-top">
            <div class="lobby-room-meta">
              <div class="caps">{isSoloLocal ? 'Solo Saucer' : 'Room'}</div>
              <div class="display lobby-room-code">{isSoloLocal ? 'Practice' : state.roomCode}</div>
            </div>
            <div class="lobby-icon-group">
              <button type="button" class="icon-pill" title={muted ? 'Unmute audio' : 'Mute audio'} aria-label={muted ? 'Unmute audio' : 'Mute audio'} data-action="toggle-mute" onClick={() => callbacks.onChangeMuted(!muted)}>
                <SoundIcon muted={muted} />
              </button>
              <button type="button" class="icon-pill" title="How to play" aria-label="How to play" data-action="open-guide" onClick={onOpenGuide}>?</button>
              <button type="button" class="icon-pill" title="Settings" aria-label="Settings" data-action="open-settings" onClick={onOpenSettings}>☰</button>
            </div>
          </div>
          {!isSoloLocal && (
            <div class="lobby-invite-row">
              <button
                type="button"
                class="btn small primary"
                data-action="copy-invite"
                onClick={() => void Promise.resolve(callbacks.onCopyInvite()).then((ok) => setCopyStatus({ ok, text: ok ? 'Copied invite link.' : 'Copy failed.' }))}
              >
                Copy invite
              </button>
              {copyStatus.text.length > 0 && (
                <span class="type" style={{ fontSize: '11.5px', fontWeight: 700, color: copyStatus.ok ? 'var(--ok)' : 'var(--stamp)' }}>
                  {copyStatus.text}
                </span>
              )}
            </div>
          )}
        </div>

        {/* Top-right roster card (collapsible drawer on narrow mobile screens) */}
        <div class={`lobby-roster-wrap${rosterOpenMobile ? ' open' : ''}`}>
          <button type="button" class="card paper lobby-roster-toggle type" onClick={() => setRosterOpenMobile((v) => !v)}>
            <span>{`Lots (${roster.slots.length}/${maxPlayers})`}</span>
            <span>{rosterOpenMobile ? '▴' : '▾'}</span>
          </button>
          <div class="card paper lobby-roster">
            <div class="lobby-roster-head">
              <div class="caps">Lots in room</div>
              <span class="caps">{`${roster.slots.length} / ${maxPlayers}`}</span>
            </div>
            <hr class="rule" />
            <div>{roster.slots.map((s) => {
              const rttMs = rttByPeerMs.get(s.peerId);
              const rttLabel = s.peerId === selfPeerId ? 'you' : s.status === SlotStatus.Bot ? 'CPU' : rttMs !== undefined ? `${Math.round(rttMs)}ms` : '…';
              const barCount = s.status === SlotStatus.Loading ? 0 : rttMs === undefined || rttMs <= 45 ? 4 : rttMs <= 90 ? 3 : rttMs <= 150 ? 2 : 1;
              return (
                <div key={s.slot} class="lobby-row">
                  <Disc slot={s.slot} colourIndex={s.colourIndex} />
                  <div class="lobby-row-name">
                    <div class="nm">{s.name}</div>
                    <div class="sub">{`${getElementalFighter(s.fighterId).name}${s.peerId === roster.hostId ? ' · host' : ''}`}</div>
                  </div>
                  <div class="type" style="font-size:11px;color:var(--ink-soft);">{rttLabel}</div>
                  <div class="lobby-row-state">
                    <span class={rttMs !== undefined && rttMs > 100 ? 'bars warn' : 'bars'}>
                      {Array.from({ length: 4 }, (_, i) => <i key={i} class={i >= barCount ? 'off' : undefined} style={{ height: `${4 + i * 3}px` }} />)}
                    </span>
                    <span class="type" style="font-size:11px;">{slotStatusLabel(s.status, onPlatterSlots.has(s.slot))}</span>
                  </div>
                </div>
              );
            })}</div>
            {isHost && (
              <div class="lobby-bots-row">
                <select class="chip" aria-label="Bot difficulty" value={botKind} onChange={(e) => setBotKind(Number(e.currentTarget.value) as BotKind)}>
                  {SELECTABLE_BOT_KINDS.map((bk) => <option key={bk} value={bk}>{`${BOT_LABEL[bk]} Bot`}</option>)}
                </select>
                <div style="display:flex;gap:5px;">
                  <button type="button" class="chip" data-action="add-bot" disabled={botCount >= MAX_BOTS || roster.slots.length >= maxPlayers} onClick={() => callbacks.onAddBot(botKind)}>+ Bot</button>
                  <button type="button" class="chip" data-action="remove-bot" disabled={botCount === 0} onClick={() => callbacks.onRemoveBot()}>− Bot</button>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Single clean centered bottom dock (no overlapping corner piles!) */}
        <div class="lobby-dock">
          {optionsOpen && (
            <div class="card paper lobby-options-pop">
              <div class="lobby-opt-group">
                <div class="caps">Arena</div>
                <div class="lobby-opt-chips">
                  {ALL_ARENA_IDS.map((aid) => (
                    <button key={aid} type="button" data-arena={aid} disabled={!isHost} class={`chip${aid === roster.arenaId ? ' on' : ''}`} onClick={() => callbacks.onSelectArena(aid)}>
                      {getArenaSpec(aid).name}
                    </button>
                  ))}
                </div>
              </div>
              <div class="lobby-opt-group">
                <div class="caps">Rules</div>
                <div class="lobby-opt-chips">
                  {[MatchMode.FreeForAll, MatchMode.Teams].map((m) => (
                    <button key={m} type="button" disabled={!isHost} class={`chip${m === roster.settings.mode ? ' on' : ''}`} onClick={() => callbacks.onSelectMode(m)}>
                      {m === MatchMode.FreeForAll ? 'Free-for-all' : 'Teams'}
                    </button>
                  ))}
                  <button type="button" disabled={!isHost} class={`chip${roster.settings.fragile ? ' on' : ''}`} onClick={() => callbacks.onToggleFragile(!roster.settings.fragile)}>
                    {`Fragile: ${roster.settings.fragile ? 'On' : 'Off'}`}
                  </button>
                </div>
              </div>
            </div>
          )}

          <div class="card paper lobby-dock-bar">
            <div class="lobby-dock-left">
              <button type="button" class="btn small" data-action="open-catalogue" onClick={() => { setOptionsOpen(false); onSetScreen(ScreenId.CharSelect); }}>
                <img class="dock-portrait" src={selfElem.portraitUrl} alt={selfElem.name} style={{ borderColor: playerColor(selfColour).hex }} />
                <span>{selfElem.name}</span>
              </button>
              <button
                type="button"
                class={`btn small${optionsOpen ? ' active-opt' : ''}`}
                data-action="toggle-match-options"
                onClick={() => setOptionsOpen((v) => !v)}
              >
                {`${getArenaSpec(roster.arenaId).name}${roster.settings.fragile ? ' · Fragile' : ''} ${optionsOpen ? '▾' : '▴'}`}
              </button>
            </div>

            <div class="lobby-dock-right">
              <div class="lobby-ready-pips" aria-label="Ready status">
                {active.map((s) => {
                  const hex = playerColor(s.colourIndex).hex;
                  return (
                    <Disc
                      key={s.slot}
                      slot={s.slot}
                      colourIndex={s.colourIndex}
                      style={isReady(s) ? undefined : { background: 'transparent', border: `2px dashed ${hex}`, color: hex, boxShadow: 'none' }}
                    />
                  );
                })}
              </div>
              {roster.phase === RoomPhase.Countdown ? (
                <span class="display lobby-countdown">
                  {`Starting in ${Math.max(1, Math.ceil(roster.countdownTicks / getGameData().tuning.tickRate))}…`}
                </span>
              ) : canStart ? (
                <button type="button" class="btn small primary" data-action="start-match" onClick={() => { setOptionsOpen(false); callbacks.onStartMatch(); }}>
                  Start round
                </button>
              ) : isHost ? (
                <button type="button" class="btn small primary" onClick={() => callbacks.onAddBot(botKind)}>
                  + Add bot to start
                </button>
              ) : (
                <span class="type" style="font-size:11.5px;color:var(--ink-soft);">Stand on gold ring</span>
              )}
            </div>
          </div>
          {canStart && <div class="lobby-platter-hint type">Or stand on the gold ring for 3s · press C for Catalogue</div>}
        </div>
      </div>
      {showCatalogue && (
        <CatalogueModal fighterId={selfFighter} colourIndex={selfColour} equippedFinish={state.equippedFinish}
          unlockedAppraisals={state.unlockedAppraisals} provenance={state.provenance}
          takenBySlot={takenBySlot} callbacks={callbacks} onBack={() => onSetScreen(ScreenId.Lobby)} />
      )}
    </>
  );
}

function ConnectionErrorScreen({ state, callbacks }: { readonly state: ConnectionErrorState; readonly callbacks: UiCallbacks }) {
  const [copyStatus, setCopyStatus] = useState({ ok: true, text: '' });
  const d = state.diagnostics; const isMismatch = d.state === ConnectionState.VersionMismatch;
  const [headline, body] = isMismatch
    ? ['This room is on a newer build. Refresh.', `Your browser loaded build ${BUILD_ID} (protocol ${PROTOCOL_VERSION}), which does not match this room.`]
    : d.state === ConnectionState.RelayFailed
      ? ['Can’t reach the meeting room.', 'Signalling relays did not respond in time, so peers could not discover each other.']
      : ['You and the host can’t shake hands.', 'Your network and the host’s network both refuse direct connections, so the two of you can’t reach each other. Nobody did anything wrong, and this game has no relay server to go through.'];
  const cand = !isMismatch ? state.nodes.find((n) => !n.isSelf && !n.isHost && n.reachesAll) : undefined;
  const candTypes = new Set(d.peers.flatMap((p) => p.iceCandidateTypes));
  const lines = [
    `${diagCodeForState(d.state)} · build ${BUILD_ID} · protocol ${PROTOCOL_VERSION}`,
    `relays ${d.relaysOpen} of ${d.relaysTotal} reached · ${d.stunAnswered ? 'STUN answered' : 'STUN silent'} · candidates: ${candTypes.size > 0 ? [...candTypes].join(', ') : 'none'} · nat: ${d.natHint}`,
    `peers ${d.peers.filter((p) => p.direct).length} of ${d.peers.length} direct · turnConfigured: ${d.turnConfigured}`,
    ...(d.errorDetail.length > 0 ? [`detail: ${d.errorDetail}`] : []),
  ];
  const [w, h] = [460, 330]; const [cx, cy, r] = [w * 0.5, h * 0.5, Math.min(w, h) * 0.36];
  const pos = new Map(state.nodes.map((n, i) => { const ang = -Math.PI * 0.5 + (i / Math.max(1, state.nodes.length)) * Math.PI * 2; return [n.peerId, { x: cx + Math.cos(ang) * r, y: cy + Math.sin(ang) * r }] as const; }));
  const tips = ['Turn off your VPN and reload.', 'Office, university and hotel wifi usually block this. Try your phone’s hotspot.', 'Ask someone on home broadband to open the room.'];
  return (
    <div class="error-screen paper" data-screen={ScreenId.ConnectionError}>
      <div>
        <div class="caps">{`Room ${state.roomCode} · you are Lot ${state.localSlot + 1}`}</div>
        <div class="display error-headline">{headline}</div><div style="font-size:17px;line-height:1.45;">{body}</div>
        {cand !== undefined && (
          <div class="error-fix-box">
            <div class="caps" style="color:var(--ok)">Quickest fix</div>
            <div style="font-size:16px;margin:4px 0 12px;">{`${cand.name} can reach everyone in the room, including you. If they host, you’re in.`}</div>
            <button type="button" class="btn primary small" onClick={() => callbacks.onAskPeerToHost(cand.peerId)}>{`Ask ${cand.name} to host`}</button>
          </div>
        )}
        <div style="display:flex;gap:10px;margin-top:16px;flex-wrap:wrap;">
          {isMismatch ? <button type="button" class="btn primary small" data-action="refresh-build" onClick={() => callbacks.onHardRefresh()}>Refresh build</button> : <button type="button" class="btn small" onClick={() => callbacks.onRetryConnection()}>Try again</button>}
          <button type="button" class="btn small" onClick={() => callbacks.onPlayOfflinePractice()}>Play solo instead</button>
        </div>
        <div class="error-tips"><div class="caps">Try in order</div><ol>{tips.map((t) => <li key={t}>{t}</li>)}</ol></div>
      </div>
      <div class="error-right">
        <div class="card paper">
          <div style="display:flex;justify-content:space-between;"><div class="caps">Who can reach whom</div><div class="caps"><span style="color:var(--stamp)">· · ·</span> blocked</div></div>
          <div class="error-mesh">
            <svg viewBox={`0 0 ${w} ${h}`}>{state.edges.map((edge, i) => {
              const a = pos.get(edge.fromPeerId); const b = pos.get(edge.toPeerId);
              if (a === undefined || b === undefined) return null;
              return edge.connected ? <line key={i} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="#2B2623" strokeWidth="1.6" opacity="0.45" /> : <line key={i} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="#B5432E" strokeWidth="3" strokeDasharray="3 8" />;
            })}</svg>
            {state.nodes.map((n) => { const p = pos.get(n.peerId); return p === undefined ? null : <div key={n.peerId} class="mesh-node" style={{ left: `${(p.x / w) * 100}%`, top: `${(p.y / h) * 100}%` }}><Disc slot={n.slot} colourIndex={n.colourIndex} /><span class="l">{`${n.isSelf ? 'You' : n.name}${n.isHost ? ' (host)' : ''}`}</span></div>; })}
          </div>
        </div>
        <div class="card paper type" style="font-size:12px;line-height:1.6;">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;gap:8px;flex-wrap:wrap;">
            <div class="caps">Diagnostics</div>
            <span class="type" style={{ fontSize: '11px', color: copyStatus.ok ? 'var(--ok)' : 'var(--stamp)' }}>{copyStatus.text}</span>
            <button type="button" class="chip" onClick={() => void copyText(lines.join('\n')).then((res) => setCopyStatus({ ok: res.ok, text: res.status }))}>Copy diagnostics</button>
          </div>
          <div>{lines.map((line, i) => <span key={i}>{i > 0 && <br />}{line}</span>)}</div>
        </div>
      </div>
    </div>
  );
}

function ResultsScreen({ state, roomCode, photoUrl, photoBlob, sessionCardUrl, sessionCardBlob, callbacks }: {
  readonly state: ResultsRenderState; readonly roomCode: string | null;
  readonly photoUrl: string | null; readonly photoBlob: Blob | null;
  readonly sessionCardUrl: string | null; readonly sessionCardBlob: Blob | null;
  readonly callbacks: UiCallbacks;
}) {
  const [prevPhotoUrl, setPrevPhotoUrl] = useState(photoUrl);
  const [photoStatus, setPhotoStatus] = useState('');
  const [showSessionCard, setShowSessionCard] = useState(false);
  if (photoUrl !== prevPhotoUrl) { setPrevPhotoUrl(photoUrl); setPhotoStatus(''); setShowSessionCard(false); }
  const activeUrl = showSessionCard && sessionCardUrl !== null ? sessionCardUrl : photoUrl;
  const activeBlob = showSessionCard && sessionCardBlob !== null ? sessionCardBlob : photoBlob;

  const copyPhoto = async () => {
    if (activeBlob === null) { setPhotoStatus('No photo captured.'); return; }
    try {
      if (typeof navigator === 'undefined' || navigator.clipboard === undefined || typeof ClipboardItem === 'undefined') { setPhotoStatus('Clipboard image API unavailable.'); return; }
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': activeBlob })]); setPhotoStatus('Copied!');
    } catch (err) { setPhotoStatus(`Copy failed: ${String(err)}`); }
  };
  const savePhoto = () => {
    if (activeUrl === null) { setPhotoStatus('No photo captured.'); return; }
    const suffix = showSessionCard ? 'session' : 'lot';
    const a = document.createElement('a'); a.href = activeUrl; a.download = `bric-a-brawl-${roomCode !== null ? roomCode : suffix}.png`; a.click(); setPhotoStatus('Saved.');
  };
  const tuning = getGameData().tuning; const ord = (n: number) => `${n}${n === 1 ? 'st' : n === 2 ? 'nd' : n === 3 ? 'rd' : 'th'}`;
  const winsGoal = tuning.match.sessionWinsToTake; const totalAuto = tuning.match.rematchAutoSeconds;
  const rem = Math.max(0, Math.min(totalAuto, state.rematchSecondsLeft));
  return (
    <div class="results-screen paper" data-screen={ScreenId.Results}>
      <div class="results-head">
        <div class="caps">{`Lot ${state.roundNumber} · ${getArenaSpec(state.arenaId).name} · ${formatClock(Math.round(state.endTick / tuning.tickRate))}`}</div>
        <div class="display results-title" style={{ color: playerColor(state.winnerColourIndex).hex }}>{`Sold to ${state.winnerName}`}</div>
        {state.newlyUnlocked.length > 0 && (
          <div class="unlock-banner type">
            {`Unlocked: ${state.newlyUnlocked.map((id) => `${APPRAISAL_SPECS[id].title} (${APPRAISAL_SPECS[id].rewardLabel})`).join(' · ')}`}
          </div>
        )}
      </div>
      <div class="results-photo-wrap">
        <div class="results-photo">
          <div class="delft-frame"><img alt={showSessionCard ? 'Session summary card' : 'Match capture'} src={activeUrl !== null ? activeUrl : undefined} /></div>
          <div style="display:flex;justify-content:space-between;align-items:flex-end;margin-top:10px;gap:8px;flex-wrap:wrap;">
            <div class="type" style="font-size:12px;color:var(--ink-soft);">{`bric-a-brawl · ${roomCode !== null ? roomCode : 'session'}`}</div>
            <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
              {photoStatus.length > 0 && <span class="type" style="font-size:11px;font-weight:700;color:var(--ok);">{photoStatus}</span>}
              {state.sessionChampionName !== null && (
                <button type="button" class={`btn small${showSessionCard ? ' primary' : ''}`} data-action="session-card" onClick={() => setShowSessionCard((v) => !v)}>
                  Session card
                </button>
              )}
              <button type="button" class="btn small primary" data-action="copy-photo" onClick={() => void copyPhoto()}>Copy photo</button>
              <button type="button" class="btn small" data-action="save-photo" onClick={savePhoto}>Save</button>
            </div>
          </div>
        </div>
      </div>
      <div>
        <table class="results-table">
          <thead><tr><th></th><th></th><th>Lot</th><th style="text-align:right">KOs</th><th style="text-align:right">Falls</th><th style="text-align:right">Dealt</th><th>Wins</th></tr></thead>
          <tbody>{state.rows.map((row) => (
            <tr key={row.slot}>
              <td class="n">{ord(row.place)}</td><td><Disc slot={row.slot} colourIndex={row.colourIndex} /></td>
              <td><b>{row.name}</b><div class="sub">{`${getElementalFighter(row.fighterId).name} · ${row.note}`}</div></td>
              <td class="n">{row.kos}</td><td class="n">{row.falls}</td><td class="n">{`${Math.round(row.dealtDamage)}%`}</td>
              <td class="wins-pips"><Pips count={row.wins} total={winsGoal} /></td>
            </tr>
          ))}</tbody>
        </table>
        <div style="display:flex;justify-content:space-between;align-items:center;margin-top:20px;gap:12px;flex-wrap:wrap;">
          <div>
            <div class="caps">Next lot</div><div class="display" style="font-size:26px">{`${getArenaSpec(state.nextArenaId).name} in ${Math.ceil(rem)}s`}</div>
            <div class="rematch-bar"><i style={{ width: `${Math.round(((totalAuto - rem) / totalAuto) * 100)}%` }} /></div>
          </div>
          <button type="button" class="btn small" disabled={!state.isHost} title={state.isHost ? 'Return everyone to lobby' : 'Host controls return to lobby'} onClick={() => callbacks.onBackToLobby()}>Back to lobby</button>
        </div>
        <div class="caps" style="margin-top:12px">{state.sessionChampionName !== null ? `${state.sessionChampionName} takes the sale! (${winsGoal} wins)` : `First to ${winsGoal} wins takes the sale`}</div>
      </div>
    </div>
  );
}

export interface AppViewProps {
  readonly screen: ScreenId;
  readonly titleRoomCode: string;
  readonly settingsOpen: boolean;
  readonly guideOpen: boolean;
  readonly touchControlsActive: boolean;
  readonly isTouchDevice: boolean;
  readonly settingsState: SettingsViewState;
  readonly perfReport: PerfReport | null;
  readonly lobbyState: LobbyRenderState | null;
  readonly hudState: HudRenderState | null;
  readonly errorState: ConnectionErrorState | null;
  readonly resultsState: ResultsRenderState | null;
  readonly photoUrl: string | null;
  readonly photoBlob: Blob | null;
  readonly sessionCardUrl: string | null;
  readonly sessionCardBlob: Blob | null;
  readonly callbacks: UiCallbacks;
  readonly onOpenSettings: () => void;
  readonly onCloseSettings: () => void;
  readonly onOpenGuide: () => void;
  readonly onCloseGuide: () => void;
  readonly onSetScreen: (s: ScreenId) => void;
  readonly onTouchStick: (dir: InputDir, isTilt: boolean) => void;
  readonly onTouchBit: (bit: InputBit, active: boolean) => void;
  readonly onTouchClear: () => void;
}

export function AppView(p: AppViewProps) {
  const s = p.screen;
  const isPlayableScreen = s === ScreenId.Lobby || s === ScreenId.Hud;
  const showTouch = p.touchControlsActive && isPlayableScreen && !p.settingsOpen && !p.guideOpen;
  const localHudFighter = p.hudState?.fighters.find((f) => f.isLocal);
  const hasGadget = localHudFighter !== undefined && localHudFighter.heldGadget !== GadgetId.None;
  const isHost = p.lobbyState === null || p.lobbyState.roster.hostId === p.lobbyState.selfPeerId;

  return (
    <>
      {s === ScreenId.Title && (
        <TitleScreen
          roomCode={p.titleRoomCode}
          muted={p.settingsState.muted}
          callbacks={p.callbacks}
          onOpenGuide={p.onOpenGuide}
          onOpenSettings={p.onOpenSettings}
        />
      )}
      {(s === ScreenId.Lobby || s === ScreenId.CharSelect) && p.lobbyState !== null && (
        <LobbyScreen
          state={p.lobbyState}
          showCatalogue={s === ScreenId.CharSelect}
          muted={p.settingsState.muted}
          touchActive={showTouch}
          callbacks={p.callbacks}
          onSetScreen={p.onSetScreen}
          onOpenGuide={p.onOpenGuide}
          onOpenSettings={p.onOpenSettings}
        />
      )}
      <HudLayer
        visible={s === ScreenId.Hud}
        state={p.hudState}
        muted={p.settingsState.muted}
        touchActive={showTouch}
        onToggleMute={() => p.callbacks.onChangeMuted(!p.settingsState.muted)}
        onOpenGuide={p.onOpenGuide}
        onOpenSettings={p.onOpenSettings}
      />
      {s === ScreenId.ConnectionError && p.errorState !== null && <ConnectionErrorScreen state={p.errorState} callbacks={p.callbacks} />}
      {s === ScreenId.Results && p.resultsState !== null && (
        <ResultsScreen
          state={p.resultsState}
          roomCode={p.lobbyState !== null ? p.lobbyState.roomCode : null}
          photoUrl={p.photoUrl}
          photoBlob={p.photoBlob}
          sessionCardUrl={p.sessionCardUrl}
          sessionCardBlob={p.sessionCardBlob}
          callbacks={p.callbacks}
        />
      )}
      <TouchControls
        visible={showTouch}
        hasGadget={hasGadget}
        onStick={p.onTouchStick}
        onBit={p.onTouchBit}
        onClear={p.onTouchClear}
      />
      <HowToPlayModal
        open={p.guideOpen}
        isTouchDevice={p.isTouchDevice}
        keyBindings={p.settingsState.keyBindings}
        onClose={p.onCloseGuide}
      />
      <SettingsModal
        open={p.settingsOpen}
        inMatch={s === ScreenId.Hud}
        isHost={isHost}
        state={p.settingsState}
        perfReport={p.perfReport}
        callbacks={p.callbacks}
        onOpenGuide={p.onOpenGuide}
        onClose={p.onCloseSettings}
      />
    </>
  );
}
