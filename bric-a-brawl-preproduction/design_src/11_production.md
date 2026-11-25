# 11. Production plan

Five milestones, riskiest unknowns first. Each has a goal, what is in and out, acceptance criteria with ids, and the evidence to deliver. Criteria marked **H** need a human and may not be self-certified (10.5). Everything else is checked by a command.

Rough share of total effort: M1 5 percent, M2 30, M3 25, M4 20, M5 20. These are guesses.

## M1. The connection test page

**Goal:** find out, with two real homes, whether the network plan works, before any game exists.

**Build:** one static page on GitHub Pages, under 150 KB, no game code.

- Makes or joins a room by three-word code, with the code as the Trystero password.
- Shows relay sockets (how many of 5 are open), peers, and for each peer: direct or not, the ICE candidate types seen, and a NAT hint (compares the reflexive port reported by two STUN servers).
- Opens the unreliable channel on Trystero's peer connection and prints its negotiated properties.
- Runs a 60-second traffic test shaped like the game: 16-byte packets at 60 Hz one way, 400-byte packets at 30 Hz the other. Reports round trip (median, p95), jitter, loss and reordering.
- Runs the hidden-tab test: asks the user to switch tabs for 30 seconds, sends from a worker timer and from a main-thread timer, and reports the longest gap for each.
- Has a forced-failure mode (relay-only ICE with no relay configured) that shows the first version of the friendly error screen with diagnostics.
- A "Copy report" button that puts all of it on the clipboard as JSON.

Also in M1, before the page: the **environment report** (`evidence/M1/environment.md`): `df -h`, `free -m`, versions and sizes of every tool in 8.2, and the measured time of a trivial Blender render and a trivial headless Chromium screenshot.

| Id | Acceptance | |
|---|---|---|
| M1.1 | Environment report exists; at least 6 GB of disk free after installs | |
| M1.2 | Two browser contexts on the VM join the same room through the public relays and exchange data | |
| M1.3 | Median time from page load to first peer under 5 s over 10 trials on the VM | |
| M1.4 | The unreliable channel reports `ordered: false, maxRetransmits: 0` on both sides and carries the test traffic | |
| M1.5 | The forced-failure mode shows the error screen and a diagnostics line | |
| M1.6 | Page weight under 150 KB gzip | |
| M1.7 | Ace and one friend, in different homes, connect in Chrome and in Firefox and paste their reports. Safari if anyone has it | **H** |
| M1.8 | In those reports: loss under 2 percent, and the worker timer's longest gap in a hidden tab under 100 ms | **H** |

**Evidence:** the URL; the environment report; a screenshot of the page with two local peers; the VM's own test report; the pasted human reports.

**Decisions this milestone makes:** unreliable channel or fallback (U1); Nostr alone or with a second strategy (U2); worker or metronome (U3). Write each decision and its reason in `evidence/M1/decisions.md`. If M1.7 fails for a reason that is not NAT, stop and fix it before M2's network work.

## M2. The headless simulation with networked bots

**Goal:** the whole game as numbers, playable by bots, in Node, over a simulated bad network. No pixels.

**In:** the `sim/` package with movement, the launch model, hit-stop, guard, parry, grabs, throws, combo decay, Gilt, stocks, blast zones, the teaspoon; all four fighters as data, with capsule hitboxes; The Willow Plate with the fracture state machine and timeline; rubble; tier A gadgets; the `net/` package complete over the loopback transport, including prediction, reconciliation, interpolation, the three fairness rules and the bandwidth counter; bots Masher, Tape, Chaser, Brawler, ParryBot, BlockBot, ComboSearch, Runner; the report generators; golden replays; an SVG dump of any tick for debugging and for evidence.

**Out:** rendering, audio, Trystero, UI, the other arenas, tier B and C gadgets, the Sharp bot.

| Id | Acceptance |
|---|---|
| M2.1 | `npm run check` passes in 90 s or less on the VM |
| M2.2 | `npm run test:full` passes in 10 min or less |
| M2.3 | Generated tables match `data/*.json`: for each move, a Tape test reproduces the listed on-block frames and the KO percentages within ±3 points |
| M2.4 | 60 bot matches complete with no exception or NaN; a 2-minute match costs under 12 s of CPU; tick p99 under 4 ms |
| M2.5 | The bot report shows: median match 100 to 135 s; first KO between 0:20 and 0:50; half the island gone at 1:05 ± 15 s; self-destructs 10 to 25 percent of stock losses |
| M2.6 | Netsim profiles `lan`, `typical`, `far`, `limit`, `wifi`, `awful`, `stall` pass every assertion in 10.3 |
| M2.7 | `churn` passes N10 |
| M2.8 | Measured bandwidth within 15 percent of the table in 7.3.7 |
| M2.9 | ComboSearch finds no loop over 12 hits |
| M2.10 | Golden replays: 5 recorded matches reproduce their hashes |

**Evidence:** the bot playtest report; the netsim report with one table per profile; three SVG tick dumps (full island, mid-round, last fragment); a 10-second animated SVG or GIF made from dumps; timing logs.

## M3. The grey-box vertical slice

**Goal:** it is fun with capsules. If it is not, nothing later will fix it.

**In:** the browser client with three.js drawing capsules, hand spheres and flat-shaded chunks in the palette's greys and liveries; the host worker; the Trystero transport from M1; the lobby with the ready platter; the camera to spec; hit-stop, shake, a plain launch ribbon, a cheap impact frame, chips and dust as instanced tetrahedra; unstyled but complete HUD (lot tags, timer, island strip, off-screen bubbles); the functional error screen; quick rematch; all four move sets; tier A and B gadgets; the 22 priority-1 sounds; the practice frame-data overlay; quality tiers with the automatic fallback; the perf report button; the Sharp bot and bots in the lobby.

**Out:** final models, the glaze shader, pose animation beyond move timing, music, the Catalogue, the results photo, High Tea and The Mended Bowl.

| Id | Acceptance | |
|---|---|---|
| M3.1 | Every M2 gate still passes | |
| M3.2 | `npm run test:browser`: the built site loads, hosts a loopback room with 7 bots, plays 20 s; frame-time, draw-call and script-time gates pass | |
| M3.3 | First-playable payload 2.5 MB or less; first lobby frame within 4 s on localhost | |
| M3.4 | Two browser contexts on the VM play a 30 s match through real Trystero | |
| M3.5 | The host tab is hidden for 20 s mid-match in the smoke test; the client context sees no gap in snapshots longer than 150 ms | |
| M3.6 | Human playtest, 4 or more people, script 10.6. Median click-to-first-hit 15 s or less | **H** |
| M3.7 | In that session: someone says "one more"; "I blocked that" is said twice or fewer | **H** |
| M3.8 | Perf reports from at least two laptops with integrated graphics: p95 frame time 16.7 ms or less on Low with 6 or more fighters | **H** |
| M3.9 | Ace says the grey-box is fun | **H** |

**Evidence:** screenshots of lobby, mid-match and last call; a 10-second clip; the bot report and netsim report at this commit; the size report; the human session notes and perf reports.

**The gate that matters:** do not start M4 until M3.9. If the answer is no, spend the next iteration on the first six tuning knobs in 3.10 and on whichever question in 10.6 drew the worst answer. Art does not rescue a dull grey-box.

## M4. Art

**Goal:** it looks like the style frame.

**Order:** as in 9.9. Earl end to end first, to prove the pipeline: script, export, optimise, lint, shader, parity test, contact sheet, in game.

**In:** the asset pipeline and lint; the matcap and `GlazeMaterial` with speckle, cracks, gilt, flash and matte; the four fighters, built up from the reference scripts; pose tables for all moves from the eight archetypes, the four signature poses, the six life layers; The Willow Plate, High Tea, The Mended Bowl and The Saucer; tier A and B gadgets, parcel, guard plate, teaspoon; VFX to the art bible; blob shadows; sky; a first pass of styled UI from `base.css`.

| Id | Acceptance | |
|---|---|---|
| M4.1 | Every asset passes the art lint (ART_BIBLE 4.9), including silhouette distinctness and the shader parity test | |
| M4.2 | A contact sheet exists for every fighter, gadget and arena | |
| M4.3 | Scene budgets hold in the smoke test with 8 fighters on High: 90 draw calls, 110,000 triangles | |
| M4.4 | Total download 5 MB or less; first playable 2.5 MB or less | |
| M4.5 | `npm run assets` from clean in 10 min or less; one changed asset in 90 s or less | |
| M4.6 | The game reproduces the style frame: a scripted scene places the same six fighters in the same poses on The Willow Plate, and an in-engine screenshot is delivered beside `style_frame_ingame_clean.png` | |
| M4.7 | Every M2 and M3 automatic gate still passes | |
| M4.8 | Ace approves the contact sheets and the side-by-side | **H** |
| M4.9 | A second round of perf reports: p95 16.7 ms or less on Medium on integrated graphics, or the default tier is lowered and that is recorded | **H** |

**Evidence:** all contact sheets; the side-by-side; six screenshots (one per arena, one per fighter close-up); a 15-second clip of a full launch-to-KO on each arena; lint output; size report.

## M5. Polish, audio, menus, sharing

**Goal:** a stranger to the project can be sent the link.

**In:** all audio, the auctioneer, music and the review reel; the six screens styled; the Catalogue; results with the photo and Copy; static Open Graph tags and `og.png`; room-code word lists and lot names; host suggestion and hand-over; teams and Fragile; accessibility (rebinding, colour-blind patterns, shake slider, "reduce flashes", which replaces impact frames with a border pulse; impact frames are rate-limited to three a second for everyone); the Low tier's LOD meshes; tier C gadgets and appraisals if on time.

| Id | Acceptance | |
|---|---|---|
| M5.1 | Every earlier automatic gate passes | |
| M5.2 | All audio checks in 6.2 pass; the reel exists | |
| M5.3 | The served `index.html` contains the Open Graph tags from 3.12 without running scripts; `og.png` is 1200x630 and under 300 KB | |
| M5.4 | In headless Chromium with clipboard permission: "Copy photo" puts a PNG on the clipboard; "Copy invite" puts the link | |
| M5.5 | A version-mismatch test: an old build and a new build in one room produce the refresh message, not a broken match | |
| M5.6 | With "reduce flashes" on, no full-screen luminance change above 10 percent occurs between consecutive frames in the smoke test; with it off, never more than three impact frames in any second | |
| M5.7 | The link pasted in Discord shows the card as in `discord_embed_mock.png` | **H** |
| M5.8 | Ace approves the audio reel | **H** |
| M5.9 | Full playtest, 6 to 8 people, script 10.6: median click-to-first-hit 10 s or less; nobody permanently locked out without the error screen offering a route; most answer yes to question 12 | **H** |

**Evidence:** screenshots of all six screens in the game; the Discord screenshot; a 30-second clip of one whole final minute; the reel; the bot and netsim reports at the release commit; the human session notes.

## 11.6 Risk register

| # | Risk | Likelihood | Impact | Mitigation | Trigger for the fallback |
|---|---|---|---|---|---|
| R1 | The unreliable channel cannot be opened on Trystero's connection in some browser | Medium | High | M1 tests it first. Fallback: reliable only at 20 Hz; then PeerJS | M1.4 fails in any major browser |
| R2 | Public relays slow or down on the night | Medium | High | Five in parallel by default; show relay status; second strategy behind a flag | M1.3 median above 5 s |
| R3 | One of eight friends cannot connect (no TURN) | High | Medium | Connectivity map, "ask them to host", TURN slot | Always present |
| R4 | The host's tab is hidden and the match freezes | Medium | High | Worker sim; M1 and M3.5 test it; metronome fallback | M1.8 or M3.5 fails |
| R5 | The host's machine is weak | Medium | Medium | Lobby benchmark, adaptive rates, hand-over between rounds | Host tick above 12 ms for 2 s |
| R6 | Hits feel unfair at real latency | Medium | High | Three explicit rules; netsim metrics N6 and N7; local soft-confirm as the first experiment | "I blocked that" more than twice in a session |
| R7 | 60 fps not reached on integrated graphics | Medium | High | No lights, no shadows, one texture, three tiers; perf reports at M3 before any art | M3.8 fails: default to Low, cut MSAA |
| R8 | Agent-made models lack charm | High | Medium | Reference scripts as the floor; lint; human gate M4.8 | Gate fails: ship the references with fixes only |
| R9 | Animation reads as robotic | High | Medium | Archetypes plus six life layers; clip review | Gate fails: springs and squash only |
| R10 | Synthesised sound is wrong and the agent cannot tell | High | Medium | Numeric checks; human reel; CC0 fallback for 12 sounds | M5.8 fails |
| R11 | The VM runs out of memory or disk | Medium | Medium | Heavy-job lock; one asset per process; watchdog; environment report | Any job killed by the OS |
| R12 | Scope outruns time | High | Medium | The cut list; M3 gate before art | A milestone at twice its share |
| R13 | Fighters jitter or fall through at chunk seams and on moving ground | Medium | Medium | Tape tests per seam and platform; fallback rule in 8.6 | More than 1 stuck or fallen fighter per 100 bot matches |
| R14 | A dominant strategy (a gadget, a loop, a camping spot) | Medium | Medium | Bands in 3.10; ComboSearch; all numbers in JSON for same-day tuning | A band out of range after M3 |
| R15 | Rapier's 1.3 MB hurts time-to-play | Low | Medium | Load in parallel with signalling; separate wasm; planck.js fallback | M3.3 fails |
| R16 | Safari differences (data channels, Opus, clipboard) | Medium | Low | Two audio formats; Copy falls back to Save; tested when a Mac is available | Any Safari tester blocked |
| R17 | Flashing impact frames harm someone | Low | High | Three a second at most; "reduce flashes"; no full-white frames longer than 2 | — |
| R18 | A dependency changes under us (Trystero is 0.x; TypeScript 7 is new) | Medium | Low | Exact versions pinned; lockfile committed; upgrades only between milestones | A broken install |
| R19 | A stale cached build joins a new room | Medium | Low | Hashed file names; protocol check in `hello`; refresh prompt | — |
| R20 | The title collides with something | Low | Low | Search done; Ace decides before going public | — |

## 11.7 Cut list

Cut from the top. Each tier is ordered.

**First: nobody will notice.**
1. Appraisals and the provenance card.
2. Tier C gadgets: The Hoover, the Horseshoe Magnet.
3. The Willow Plate's painted top pattern; dust motes.
4. Gamepad glyphs (use words); the session card; quick phrases.
5. LOD meshes, if Low already holds 60 without them.

**Second: noticeable, the game is intact.**
6. Music layers B and C (one loop), then music altogether (the clock stays).
7. The Mended Bowl. Ship two arenas.
8. Host suggestion (hand-over becomes a manual button).
9. Bespoke signature poses; fighter-body cracks on Medium and Low (the HUD still shows percent).
10. Teams mode. Fragile.
11. Chip-slide and wall jump.

**Third: changes the pitch. Only if the VM or the calendar forces it.**
12. High Tea. One arena in three colourways.
13. Nesta's three sizes: one size, with Shed as a plain escape.
14. Tier B gadgets: ship Bellows, Plunger and Cork.
15. Copy photo (Save only).
16. Six players at most.

**Never cut:** the M1 page and the friendly failure screen; the breaking island; parry; joining from one link; the headless tests; the evidence rule.
