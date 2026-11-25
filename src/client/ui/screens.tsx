import { BotKind } from '@bots/enums';
import { BUILD_ID, PROTOCOL_VERSION } from '@net/config';
import { ConnectionState, RoomPhase, SlotStatus } from '@net/enums';
import { assertNever } from '@sim/assert';
import { getArenaSpec, getFighterSpec, getGameData } from '@sim/data';
import { ALL_ARENA_IDS, ALL_FIGHTER_IDS, FighterId, MatchMode } from '@sim/enums';
import { useState } from 'preact/hooks';
import { GlazeFinish, ScreenId } from '../enums';
import { ALL_APPRAISAL_IDS, APPRAISAL_SPECS, type AppraisalId, type FighterProvenance } from '../progression';
import type { PerfReport } from '../quality';
import { generateRoomCode, SELECTABLE_BOT_KINDS, type ConnectionErrorState, type HudRenderState, type LobbyRenderState, type ResultsRenderState, type SettingsViewState, type UiCallbacks } from '../ui';
import { cbShapeForColour, Disc, formatClock, HudLayer } from './hud';
import { copyText, playerColor, SettingsModal } from './modals';

const MAX_BOTS = 3;
const BOT_LABEL: Record<BotKind, string> = {
  [BotKind.Masher]: 'Masher', [BotKind.Tape]: 'Tape', [BotKind.Chaser]: 'Chaser', [BotKind.Brawler]: 'Brawler',
  [BotKind.Sharp]: 'Sharp', [BotKind.ParryBot]: 'Parry', [BotKind.BlockBot]: 'Block', [BotKind.Runner]: 'Runner',
};
const FIGHTER_TRICKS: Record<FighterId, string> = {
  [FighterId.Earl]: 'Piping: Special-cancel normals and spend 50% gilt on burst steam pressure.',
  [FighterId.Grog]: 'Stampede: Carries the first fighter he touches and does not stop at ledges.',
  [FighterId.Nesta]: 'Nesting Pop: Sheds down a shell (Big -> Mid -> Small) to escape pressure.',
  [FighterId.Moss]: 'Vine Snare: Long-range whip tethers foes and yanks rubble from afar.',
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
    case SlotStatus.Loading: return 'connecting';
    case SlotStatus.Ready: return 'on platter';
    case SlotStatus.Connected: return onPlatter ? 'on platter' : 'wandering';
    case SlotStatus.Spectating: return 'spectating';
    case SlotStatus.Bot: return 'bot';
    default: return assertNever(s, 'slotStatusLabel');
  }
}

const Pips = ({ count, total }: { readonly count: number; readonly total: number }) => (
  <>{Array.from({ length: total }, (_, i) => <i key={i} class={i < count ? 'on' : undefined} />)}</>
);

const BackstampSvg = () => (
  <svg class="backstamp" viewBox="0 0 200 200" width="88" height="88">
    <defs><path id="bb-arcT" d="M 26,100 a 74,74 0 0,1 148,0" /><path id="bb-arcB" d="M 20,100 a 80,80 0 0,0 160,0" /></defs>
    <circle cx="100" cy="100" r="96" fill="none" stroke="#24459A" strokeWidth="3" />
    <circle cx="100" cy="100" r="89" fill="none" stroke="#24459A" strokeWidth="1" />
    <circle cx="100" cy="100" r="55" fill="none" stroke="#24459A" strokeWidth="1.5" />
    <text fontFamily="Courier Prime" fontWeight="700" fontSize="15.5" letterSpacing="3.2" fill="#24459A"><textPath href="#bb-arcT" startOffset="50%" textAnchor="middle">THE MANTEL POTTERY</textPath></text>
    <text fontFamily="Courier Prime" fontWeight="700" fontSize="12.5" letterSpacing="2.4" fill="#24459A"><textPath href="#bb-arcB" startOffset="50%" textAnchor="middle">FINE BONE OF CONTENTION</textPath></text>
    <text x="100" y="122" textAnchor="middle" fontFamily="Fraunces" fontWeight="900" fontSize="50" fill="#24459A">B·B</text>
  </svg>
);

function TitleScreen({ roomCode, callbacks, onOpenSettings }: { readonly roomCode: string; readonly callbacks: UiCallbacks; readonly onOpenSettings: () => void }) {
  const [inputCode, setInputCode] = useState(roomCode);
  const [prevCode, setPrevCode] = useState(roomCode);
  const [error, setError] = useState('');
  if (roomCode !== prevCode) { setPrevCode(roomCode); setInputCode(roomCode); }
  const submitJoin = () => {
    const code = inputCode.trim();
    if (code.length === 0) { setError('Enter a room code to join.'); return; }
    setError(''); callbacks.onJoinRoom(code);
  };
  return (
    <div class="title-screen" data-screen={ScreenId.Title}>
      <div class="title-panel">
        <div class="title-brand"><BackstampSvg /><div class="caps">The Mantel Auction Rooms<br />Catalogue of the evening sale</div></div>
        <div class="display title-logo">BRIC-A-<br />BRAWL</div>
        <div class="serif title-sub">A party fighter for ornaments with grudges.</div>
        <hr class="rule" />
        <div class="title-actions">
          <button type="button" class="btn primary" data-action="open-room" onClick={() => callbacks.onOpenRoom()}>Open room</button>
          <div class="title-join-row">
            <button type="button" class="btn" data-action="join-room" onClick={submitJoin}>Join room</button>
            <input type="text" class="input-line" placeholder="chipped-gravy-boat" aria-label="Room code" value={inputCode} onInput={(e) => setInputCode(e.currentTarget.value)} />
            <button type="button" class="chip" title="New room code" onClick={() => { setInputCode(generateRoomCode()); setError(''); }}>↻</button>
          </div>
          <button type="button" class="btn small" data-action="solo-practice" onClick={() => callbacks.onSoloPractice()}>Solo practice</button>
          <div class="type" style="color:var(--stamp);font-size:12px;min-height:16px;">{error}</div>
        </div>
        <hr class="rule" />
        <div class="title-links"><button type="button" class="link-btn" onClick={onOpenSettings}>Settings & Perf</button></div>
      </div>
      <div class="caps title-foot">{`2 to 8 players · one link · nothing to install · v${BUILD_ID} · protocol ${PROTOCOL_VERSION}`}</div>
      <div class="card paper type title-hint">
        <div class="caps" style="margin-bottom:4px">Live saucer behind you</div>
        <span class="key">WASD</span>move &nbsp;<span class="key">Space</span>jump &nbsp;<span class="key">J</span>hit &nbsp;<span class="key">L</span>special &nbsp;<span class="key">Shift</span>guard
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
  const prov = provenance[fighterId];
  const unlockedSet = new Set(unlockedAppraisals);
  const pip = (v: number) => Math.min(5, Math.max(1, Math.round(v)));
  const bars: readonly [string, number][] = [
    ['Weight', pip(s.weight * 2.8)], ['Speed', pip((s.run - 5) / 1.1)], ['Reach', pip(s.grabRange * 2.2)],
    ['Recovery', pip(s.doubleJump + s.airSpeed * 0.3 - 1.5)], ['Launch', pip(s.crackMult * 2.5)],
  ];
  return (
    <div class="catalogue-backdrop" data-screen={ScreenId.CharSelect}>
      <div class="catalogue-spread paper">
        <div class="catalogue-list">
          <div class="caps">The Catalogue</div><div class="display" style="font-size:34px">Tonight's lots</div><hr class="rule2" />
          {ALL_FIGHTER_IDS.map((fid, i) => {
            const fs = getFighterSpec(fid);
            return (
              <div key={fid} class={`lot-item${fid === fighterId ? ' sel' : ''}`} onClick={() => callbacks.onSelectFighter(fid)}>
                <div class="caps">{`Lot ${i + 1}`}</div><div class="display" style="font-size:26px">{fs.name}</div>
                <div class="type" style="font-size:11.5px;color:var(--ink-soft);">{`${fs.role} · diff ${fs.difficulty}/3`}</div>
              </div>
            );
          })}
          <button type="button" class="btn small primary" style="margin-top:12px" onClick={onBack}>Back to lobby</button>
        </div>
        <div class="catalogue-detail">
          <div class="caps">{`Lot ${ALL_FIGHTER_IDS.indexOf(fighterId) + 1} · ${spec.ornament}`}</div>
          <div class="display" style="font-size:58px">{spec.name}</div>
          <div class="serif" style="font-style:italic;font-size:17px;margin-bottom:8px;">{`${spec.role} · Difficulty ${spec.difficulty}/3`}</div>
          <div class="provenance-line type">
            {`Provenance: ${prov.roundsPlayed} rounds · ${prov.wins} wins · ${prov.kos} KOs · Last exit: ${prov.mostEmbarrassingExit}`}
          </div>
          <div>{bars.map(([label, n]) => <div key={label} class="stat-bar"><span class="caps">{label}</span><span class="stat-pips"><Pips count={n} total={5} /></span></div>)}</div>
          <div style="margin-top:12px;border:1.5px solid var(--ink);border-radius:8px;padding:8px 12px;background:#fff;"><div class="caps">Signature trick</div><div>{FIGHTER_TRICKS[fighterId]}</div></div>
          <div style="margin-top:14px">
            <div class="caps">Glaze (your colour) · numbers show taken slots</div>
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
              <span class="type" style="font-size:13px">{playerColor(colourIndex).name}</span>
            </div>
          </div>
          <div style="margin-top:14px">
            <div class="caps">{`Glaze finish (${unlockedAppraisals.length}/12 appraisals unlocked)`}</div>
            <div class="finish-chips">
              <button type="button" class={`chip${equippedFinish === GlazeFinish.Standard ? ' on' : ''}`} onClick={() => callbacks.onSelectGlazeFinish(GlazeFinish.Standard)}>
                Standard
              </button>
              {ALL_APPRAISAL_IDS.map((aid) => {
                const aspec = APPRAISAL_SPECS[aid];
                const unlocked = unlockedSet.has(aid);
                return (
                  <button key={aid} type="button" disabled={!unlocked}
                    title={unlocked ? `${aspec.title}: ${aspec.criteria}` : `Locked — ${aspec.title}: ${aspec.criteria}`}
                    class={`chip${equippedFinish === aspec.reward ? ' on' : ''}`}
                    onClick={() => callbacks.onSelectGlazeFinish(aspec.reward)}>
                    {unlocked ? aspec.rewardLabel : `🔒 ${aspec.rewardLabel}`}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function LobbyScreen({ state, showCatalogue, callbacks, onSetScreen, onOpenSettings }: {
  readonly state: LobbyRenderState; readonly showCatalogue: boolean; readonly callbacks: UiCallbacks; readonly onSetScreen: (s: ScreenId) => void; readonly onOpenSettings: () => void;
}) {
  const [botKind, setBotKind] = useState<BotKind>(BotKind.Chaser);
  const [copyStatus, setCopyStatus] = useState({ ok: true, text: '' });
  const { roster, selfPeerId, rttByPeerMs, onPlatterSlots } = state;
  const isHost = roster.hostId === selfPeerId;
  const maxPlayers = getGameData().tuning.net.maxPlayers;
  const botCount = roster.slots.filter((s) => s.status === SlotStatus.Bot).length;
  const selfSlot = roster.slots.find((s) => s.peerId === selfPeerId);
  const selfFighter = selfSlot !== undefined ? selfSlot.fighterId : FighterId.Earl;
  const selfColour = selfSlot !== undefined ? selfSlot.colourIndex : 0;
  const takenBySlot = new Map(roster.slots.map((s) => [s.colourIndex, s.slot + 1]));
  const active = roster.slots.filter((s) => s.status !== SlotStatus.Spectating);
  const isReady = (s: typeof active[number]) => s.status === SlotStatus.Bot || s.status === SlotStatus.Ready || onPlatterSlots.has(s.slot);
  return (
    <>
      <div class="lobby-screen" data-screen={ScreenId.Lobby}>
        <div class="card paper lobby-room">
          <div class="caps">Room</div><div class="display lobby-room-code">{state.roomCode}</div>
          <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;">
            <button type="button" class="btn small primary" data-action="copy-invite" onClick={() => void Promise.resolve(callbacks.onCopyInvite()).then((ok) => setCopyStatus({ ok, text: ok ? 'Copied invite link.' : 'Copy failed (clipboard blocked).' }))}>Copy invite</button>
            <span class="type" style={{ fontSize: '12px', fontWeight: 700, color: copyStatus.ok ? 'var(--ok)' : 'var(--stamp)' }}>{copyStatus.text}</span>
          </div>
        </div>
        <div class="card paper lobby-roster">
          <div style="display:flex;justify-content:space-between;align-items:baseline;"><div class="caps">Lots in the room</div><span class="caps">{`${roster.slots.length} of ${maxPlayers}`}</span></div>
          <hr class="rule" />
          <div>{roster.slots.map((s) => {
            const rttMs = rttByPeerMs.get(s.peerId);
            const rttLabel = s.peerId === selfPeerId ? 'you' : s.status === SlotStatus.Bot ? 'CPU' : rttMs !== undefined ? `${Math.round(rttMs)} ms` : '...';
            const barCount = s.status === SlotStatus.Loading ? 0 : rttMs === undefined || rttMs <= 45 ? 4 : rttMs <= 90 ? 3 : rttMs <= 150 ? 2 : 1;
            return (
              <div key={s.slot} class="lobby-row">
                <Disc slot={s.slot} colourIndex={s.colourIndex} />
                <div><div class="nm">{s.name}</div><div class="sub">{`${getFighterSpec(s.fighterId).name}${s.peerId === roster.hostId ? ' · host' : ''}`}</div></div>
                <div class="type" style="font-size:12px;color:var(--ink-soft);">{rttLabel}</div>
                <div style="display:flex;gap:8px;align-items:center;">
                  <span class={rttMs !== undefined && rttMs > 100 ? 'bars warn' : 'bars'}>{Array.from({ length: 4 }, (_, i) => <i key={i} class={i >= barCount ? 'off' : undefined} style={{ height: `${4 + i * 3}px` }} />)}</span>
                  <span class="type" style="font-size:12px;width:78px;">{slotStatusLabel(s.status, onPlatterSlots.has(s.slot))}</span>
                </div>
              </div>
            );
          })}</div>
          <div style="display:flex;gap:6px;align-items:center;justify-content:space-between;padding-top:8px;border-top:1px solid rgba(43,38,35,.25);margin-top:6px;flex-wrap:wrap;">
            <span class="caps">Bots (max 3)</span>
            <div style="display:flex;gap:6px;align-items:center;">
              <select class="chip" disabled={!isHost} value={botKind} onChange={(e) => setBotKind(Number(e.currentTarget.value) as BotKind)}>
                {SELECTABLE_BOT_KINDS.map((bk) => <option key={bk} value={bk}>{BOT_LABEL[bk]}</option>)}
              </select>
              <button type="button" class="chip" data-action="add-bot" disabled={!isHost || botCount >= MAX_BOTS || roster.slots.length >= maxPlayers} onClick={() => callbacks.onAddBot(botKind)}>+ Bot</button>
              <button type="button" class="chip" data-action="remove-bot" disabled={!isHost || botCount === 0} onClick={() => callbacks.onRemoveBot()}>- Bot</button>
            </div>
          </div>
        </div>
        <div class="card paper lobby-platter">
          <div class="display" style="font-size:24px">{roster.phase === RoomPhase.Countdown ? `Starting in ${Math.max(1, Math.ceil(roster.countdownTicks / getGameData().tuning.tickRate))}…` : 'Stand on the gold platter for 3s to start'}</div>
          <div style="display:flex;gap:8px;justify-content:center;margin-top:8px;align-items:center;flex-wrap:wrap;">
            {active.map((s) => { const hex = playerColor(s.colourIndex).hex; return <Disc key={s.slot} slot={s.slot} colourIndex={s.colourIndex} style={isReady(s) ? undefined : { background: 'transparent', border: `2px dashed ${hex}`, color: hex, boxShadow: 'none' }} />; })}
          </div>
          <div class="type" style="font-size:12px;color:var(--ink-soft);margin-top:6px;">{`${active.filter(isReady).length} of ${active.length} ready · ${getArenaSpec(roster.arenaId).name}`}</div>
        </div>
        <div class="lobby-settings">
          <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;">
            <button type="button" class="btn small primary" data-action="open-catalogue" onClick={() => onSetScreen(ScreenId.CharSelect)}>Catalogue</button>
            {ALL_FIGHTER_IDS.map((fid) => <button key={fid} type="button" data-fighter={fid} class={`chip${fid === selfFighter ? ' on' : ''}`} onClick={() => callbacks.onSelectFighter(fid)}>{getFighterSpec(fid).name}</button>)}
          </div>
          <div style="display:flex;gap:6px;flex-wrap:wrap;">
            {ALL_ARENA_IDS.map((aid) => <button key={aid} type="button" data-arena={aid} disabled={!isHost} class={`chip${aid === roster.arenaId ? ' on' : ''}`} onClick={() => callbacks.onSelectArena(aid)}>{getArenaSpec(aid).name}</button>)}
          </div>
          <div style="display:flex;gap:6px;flex-wrap:wrap;">
            {[MatchMode.FreeForAll, MatchMode.Teams].map((m) => <button key={m} type="button" disabled={!isHost} class={`chip${m === roster.settings.mode ? ' on' : ''}`} onClick={() => callbacks.onSelectMode(m)}>{m === MatchMode.FreeForAll ? 'Free-for-all' : 'Teams'}</button>)}
            <button type="button" disabled={!isHost} class={`chip${roster.settings.fragile ? ' on' : ''}`} onClick={() => callbacks.onToggleFragile(!roster.settings.fragile)}>{`Fragile: ${roster.settings.fragile ? 'On' : 'Off'}`}</button>
          </div>
          <div style="display:flex;gap:6px;flex-wrap:wrap;">
            <button type="button" class="chip" data-action="open-settings" onClick={onOpenSettings}>Settings & Perf</button>
            <button type="button" class={`chip${state.frameDataEnabled ? ' on' : ''}`} onClick={() => callbacks.onToggleFrameData(!state.frameDataEnabled)}>{`Frame data: ${state.frameDataEnabled ? 'On' : 'Off'}`}</button>
          </div>
        </div>
        <div class="card paper type lobby-controls"><span class="key">E</span>Catalogue &nbsp;<span class="key">T</span>taunt &nbsp;<span class="key">Tab</span>frame data &nbsp;<span class="key">Esc</span>settings</div>
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
        <div class="display error-headline">{headline}</div><div style="font-size:18px;line-height:1.45;">{body}</div>
        {cand !== undefined && (
          <div class="error-fix-box">
            <div class="caps" style="color:var(--ok)">Quickest fix</div>
            <div style="font-size:17px;margin:4px 0 12px;">{`${cand.name} can reach everyone in the room, including you. If they host, you’re in.`}</div>
            <button type="button" class="btn primary small" onClick={() => callbacks.onAskPeerToHost(cand.peerId)}>{`Ask ${cand.name} to host`}</button>
          </div>
        )}
        <div style="display:flex;gap:10px;margin-top:16px;flex-wrap:wrap;">
          {isMismatch ? <button type="button" class="btn primary small" data-action="refresh-build" onClick={() => callbacks.onHardRefresh()}>Refresh build</button> : <button type="button" class="btn small" onClick={() => callbacks.onRetryConnection()}>Try again</button>}
          <button type="button" class="btn small" onClick={() => callbacks.onPlayOfflinePractice()}>Play offline practice</button>
        </div>
        <div class="error-tips"><div class="caps">If that doesn’t work, from most to least likely</div><ol>{tips.map((t) => <li key={t}>{t}</li>)}</ol></div>
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
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
            <div class="caps">For whoever is helping you</div>
            <span class="type" style={{ fontSize: '11px', color: copyStatus.ok ? 'var(--ok)' : 'var(--stamp)' }}>{copyStatus.text}</span>
            <button type="button" class="chip" onClick={() => void copyText(lines.join('\n')).then((res) => setCopyStatus({ ok: res.ok, text: res.status }))}>Copy diagnostics</button>
          </div>
          <div>{lines.map((line, i) => <span key={i}>{i > 0 && <br />}{line}</span>)}</div>
        </div>
      </div>
      <div class="caps error-foot">Roughly one connection in eight fails like this without a relay. Adding one later is a single config entry.</div>
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
        <div class="caps">{`Lot ${state.roundNumber} · ${getArenaSpec(state.arenaId).name} · hammer fell at ${formatClock(Math.round(state.endTick / tuning.tickRate))}`}</div>
        <div class="display results-title" style={{ color: playerColor(state.winnerColourIndex).hex }}>{`Sold to ${state.winnerName}`}</div>
        {state.newlyUnlocked.length > 0 && (
          <div class="unlock-banner type">
            {`Appraisal unlocked: ${state.newlyUnlocked.map((id) => `${APPRAISAL_SPECS[id].title} (${APPRAISAL_SPECS[id].rewardLabel})`).join(' · ')}`}
          </div>
        )}
      </div>
      <div class="results-photo-wrap">
        <div class="results-photo">
          <div class="delft-frame"><img alt={showSessionCard ? 'Session summary card' : 'Match capture'} src={activeUrl !== null ? activeUrl : undefined} /></div>
          <div style="display:flex;justify-content:space-between;align-items:flex-end;margin-top:10px;gap:8px;flex-wrap:wrap;">
            <div class="type" style="font-size:12.5px">{`bric-a-brawl · ${roomCode !== null ? roomCode : 'session'}`}</div>
            <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
              <span class="type" style="font-size:11px">{photoStatus}</span>
              {state.sessionChampionName !== null && (
                <button type="button" class={`btn small${showSessionCard ? ' primary' : ''}`} data-action="session-card" onClick={() => setShowSessionCard((v) => !v)}>
                  Session card
                </button>
              )}
              <button type="button" class="btn small primary" data-action="copy-photo" onClick={() => void copyPhoto()}>Copy photo</button>
              <button type="button" class="btn small" data-action="save-photo" onClick={savePhoto}>Save photo</button>
            </div>
          </div>
        </div>
        <div class="stamp results-stamp">Sold</div>
      </div>
      <div>
        <table class="results-table">
          <thead><tr><th></th><th></th><th>Lot</th><th style="text-align:right">KOs</th><th style="text-align:right">Falls</th><th style="text-align:right">Dealt</th><th>Wins</th></tr></thead>
          <tbody>{state.rows.map((row) => (
            <tr key={row.slot}>
              <td class="n">{ord(row.place)}</td><td><Disc slot={row.slot} colourIndex={row.colourIndex} /></td>
              <td><b>{row.name}</b><div class="sub">{`${getFighterSpec(row.fighterId).name} · ${row.note}`}</div><div class="sub">{row.appraisalLine}</div></td>
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
  readonly screen: ScreenId; readonly titleRoomCode: string; readonly settingsOpen: boolean; readonly settingsState: SettingsViewState;
  readonly perfReport: PerfReport | null; readonly lobbyState: LobbyRenderState | null; readonly hudState: HudRenderState | null;
  readonly errorState: ConnectionErrorState | null; readonly resultsState: ResultsRenderState | null;
  readonly photoUrl: string | null; readonly photoBlob: Blob | null;
  readonly sessionCardUrl: string | null; readonly sessionCardBlob: Blob | null;
  readonly callbacks: UiCallbacks;
  readonly onOpenSettings: () => void; readonly onCloseSettings: () => void; readonly onSetScreen: (s: ScreenId) => void;
}

export function AppView(p: AppViewProps) {
  const s = p.screen;
  return (
    <>
      {s === ScreenId.Title && <TitleScreen roomCode={p.titleRoomCode} callbacks={p.callbacks} onOpenSettings={p.onOpenSettings} />}
      {(s === ScreenId.Lobby || s === ScreenId.CharSelect) && p.lobbyState !== null && <LobbyScreen state={p.lobbyState} showCatalogue={s === ScreenId.CharSelect} callbacks={p.callbacks} onSetScreen={p.onSetScreen} onOpenSettings={p.onOpenSettings} />}
      <HudLayer visible={s === ScreenId.Hud} state={p.hudState} />
      {s === ScreenId.ConnectionError && p.errorState !== null && <ConnectionErrorScreen state={p.errorState} callbacks={p.callbacks} />}
      {s === ScreenId.Results && p.resultsState !== null && (
        <ResultsScreen state={p.resultsState} roomCode={p.lobbyState !== null ? p.lobbyState.roomCode : null}
          photoUrl={p.photoUrl} photoBlob={p.photoBlob} sessionCardUrl={p.sessionCardUrl} sessionCardBlob={p.sessionCardBlob}
          callbacks={p.callbacks} />
      )}
      <SettingsModal open={p.settingsOpen} state={p.settingsState} perfReport={p.perfReport} callbacks={p.callbacks} onClose={p.onCloseSettings} />
    </>
  );
}
