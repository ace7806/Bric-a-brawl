# 8. Building on a 2-vCPU, 8 GB machine

This is the hardest constraint, so the plan is built around it, not adapted to it. Every figure marked *measured* was taken on a 2-vCPU, 7 GB, CPU-only Linux box on 25 November 2026 (`reference/poc/RESULTS.md`). Figures marked *estimate* must be replaced by the M0 report.

## 8.1 The four rules

1. **The game runs without a browser.** `sim/`, `net/` and `bots/` import nothing from the DOM or three.js. Bot matches, balance runs and network tests are plain Node processes.
2. **A network is one process.** `net/transport/loopback.ts` connects one host and seven clients inside a single Node process, with latency, jitter, loss, duplication and reordering as parameters. No sockets, no second machine, no browser.
3. **One real browser, rarely.** Headless Chromium is started for one smoke test, a handful of screenshots and one short clip. It never runs in parallel with anything.
4. **One heavy job at a time.** Enforced by a lock, not by good intentions (8.4).

## 8.2 What gets installed

| Tool | Why | Disk | Peak memory |
|---|---|---|---|
| Node 24 LTS | Everything | 0.3 GB *measured (Node 22)* | — |
| Project `node_modules`: vite, typescript, vitest, three, rapier, trystero, msgpackr, snapshot-interpolation, gltf-transform, playwright | Build, test, optimise | 0.35 GB *estimate; the research install with most of these was 0.24 GB* | Vite build 0.32 GB, 0.9 s *measured* |
| Playwright Chromium (headless shell and its ffmpeg) | Smoke test, screenshots, clip | 0.5 to 0.9 GB *estimate; a full Chrome for Testing was 0.86 GB* | 0.6 to 1.0 GB across processes *estimate; largest single process 0.19 GB measured* |
| Blender 5.3 as `pip install bpy` (Python 3.13) | Models, previews, matcap | 0.92 GB *measured* | Export a fighter 0.29 GB; render a 960x540 scene of 46k triangles 0.90 GB, 17 s *measured* |
| Mesa software GL (`libgl1-mesa-dri`, `libegl1`, LLVM) | Only needed if Workbench previews are wanted; Chromium brings its own renderer | 0.26 GB *measured* | — |
| ffmpeg | Encode the audio sprite (Opus), trim clips | 0.1 GB *estimate* | under 0.2 GB |
| SoX | Audio synthesis and checks | under 0.02 GB | negligible |
| Python packages: numpy, pillow | Audio synthesis, art lint | 0.1 GB | 0.2 GB |
| git | — | present | — |
| **Total installed** | | **about 2.9 to 3.3 GB** | |
| Repository, build output, caches, evidence | Keep clips under 20 MB each; clear the npm and pip caches after install | allow 2 GB | |

That is about 5 GB of a 19 GB disk. If the base image and the agent's own tooling take 6 GB, 8 GB remain free. **M0 acceptance:** `df -h` and `du -sh` of each row above, in a file, with at least 6 GB free.

Not installed: a second browser, Docker, an Android or desktop toolchain, any GPU package, EEVEE dependencies, a TURN server, a signalling server.

## 8.3 Memory plan

Assume the agent and its tooling hold 2.5 to 3 GB. That leaves about 5 GB. No single job above needs more than 1.1 GB. The danger is two at once, or a test runner that forks per core and loads Rapier in each.

- Vitest: `pool: "forks"`, `maxWorkers: 2`, and the sim-heavy suites in one file each so wasm loads twice at most. A Node process running Rapier matches peaks at 0.40 GB *measured*.
- Blender: one asset per process. Never batch a whole arena and four fighters into one session. Render tiles at 640x640 or smaller; the style frame at 1600x900 is the only large render and is produced once per milestone.
- Chromium: one page, 640x360, closed straight after.
- A watchdog script prints `free -m` before every heavy job and refuses to start below 1.5 GB available.

## 8.4 The heavy-job lock and the order of work

Every npm script that is heavy is wrapped: `flock /tmp/bb-heavy.lock <command>`. Heavy means: Blender, Chromium, the full test suite, the asset build. A second heavy job waits; it never overlaps. The dev server is never left running during any of them.

Order within one work session:

1. **Edit, then `npm run check`** (90 s). Repeat. No browser, no Blender.
2. **`npm run assets`** if art changed. Blender only.
3. **`npm run test:full`** before claiming a milestone (10 min).
4. **`npm run test:browser`** last (2 min), then screenshots and the clip.
5. **`npm run build`** and the size report.

Never: renders while tests run; the browser while Blender runs; two test runners; a dev server during any of it.

## 8.5 How long things take

| Command | Contents | Target on 2 vCPUs | Basis |
|---|---|---|---|
| `npm run check` | Type-check, unit tests, 12 bot matches of 20 game-seconds, 3 netsim profiles of 20 s, data schema check | **90 s** | A full 2-minute match costs 4.7 s of physics *measured*; assume 7 s with game logic, so 20 s of game is about 1.2 s |
| `npm run test:full` | 60 full bot matches (round-robin of fighters and arenas), 8 netsim profiles, golden replays, combo-loop search, bandwidth check | **10 min** | 60 x 7 s over 2 workers is 3.5 min; netsim is 8 x 8 clients' worth of prediction, about 4 min |
| `npm run test:browser` | Load the built site, join a loopback room with 7 bots, play 20 s at 640x360, assert, 6 screenshots | **2 min** | Software WebGL drew a comparable scene in 8.6 ms a frame *measured* |
| `npm run assets` (everything) | 4 fighters, 9 gadgets, 3 arenas and the lobby, props, lint, contact sheets | **10 min** | Fighter export 0.7 s, tile 6 s, sheet of 12 tiles 70 s *measured* |
| `npm run assets` (one changed asset) | | under 90 s | |
| `npm run build` | Vite production build and size report | 15 s | 0.9 s for the test bundle *measured* |
| Evidence clip | 10 s at 640x360 | 1 min | |

Fast feedback beats coverage. If `check` passes 90 seconds, move tests to `test:full`; do not make `check` slower.

## 8.6 How hard each system is for an autonomous agent

| System | Rating | Why | Fallback that does not change the design |
|---|---|---|---|
| M1 connection page | Medium | Little code, but depends on public relays and three browsers behaving | BitTorrent strategy; then PeerJS broker |
| Unreliable channel on Trystero's peer connection | **Risky** | Unknown U1. Cannot be tested on the VM at all | Everything on the reliable channel; state rate to 20 Hz |
| Sim core: tick, fighter state machine, movement | Medium | Well-trodden; fully testable headless | — |
| Frame data, hitboxes, launch model | Easy | It is a table and three formulas, with generated expected values in `data/` | — |
| Character controller on moving and breaking ground | Hard | Edge cases at chunk seams, kinematic platforms, ledges that appear mid-frame | Loose chunks do not carry fighters: standing on one counts as airborne after 6 frames |
| Fracture state machine | Medium | States and timers; no geometry | — |
| Gadgets, tier A and B | Medium | Each is small; interactions multiply | Ship tier A only |
| Gadgets, tier C (Hoover, Magnet) | Hard | Bagged-fighter state; many-body attraction | Cut them |
| Snapshots, interpolation | Medium | Library exists; netsim tests it | — |
| Prediction and reconciliation | Hard | Subtle; but measurable in the netsim as prediction error | Predict movement only, not attack start-up |
| Lag compensation and defender grace | **Risky** | Three interacting rules; bugs feel like "the game is unfair", which a bot cannot report | Rule 1 only (rewind), with hitboxes 15 percent larger |
| Host in a worker | Medium | Message plumbing | Main-thread sim with a worker metronome |
| Host hand-over between rounds | Medium | Roster is already replicated | Manual only: the host presses "pass host" |
| Bots | Medium | Need to be good enough to exercise systems, not to be fun | Scripted input tapes plus a random masher |
| Blender fighters | Hard | The agent cannot see charm | The four reference scripts are the fighters. Improve them; do not restart |
| Arenas from data | Medium | Reference script exists | Willow Plate only, in three colourways |
| Glaze shader and parity test | Medium | One formula, a numeric check | Three.js's built-in matcap material with vertex colours; lose cracks and gilt on the body, keep them on the HUD |
| Pose-table animation and the life layers | **Risky** | Quality is taste. Numbers can say a pose is on time, not that it is funny | Ship the eight archetypes with springs and squash only; no bespoke poses |
| VFX | Medium | All instanced solids; counts and lifetimes are specified | Chips and dust only |
| Audio synthesis | **Risky** | The agent cannot hear. Numbers can check loudness and length, not whether a clink sounds like china | A CC0 library for the 12 sounds that matter most (8.7); synthesis for the rest |
| DOM UI | Easy | The CSS exists in `concept_art/src/` | — |
| Performance on integrated GPUs | **Risky** | Cannot be measured on the VM | Low tier as the default until a human perf report says otherwise |
| Share: link, embed, photo | Easy | Static tags; one canvas capture | Download button only |

For every risky row, the milestone plan puts a human check or an early spike in front of it.

## 8.7 Things the VM cannot judge, and who does

| Question | Who answers | When |
|---|---|---|
| Do two real homes connect? | Ace and one friend, M1 page | M1 |
| Does it hold 60 fps on a real laptop? | Friends' perf reports | M3, M5 |
| Is a pose funny? Is a model charming? | Ace, from contact sheets and one clip | M4 |
| Does a clink sound like china? | Ace, from a 60-second audio reel | M5 |
| Is it fun? | The playtest script | M3, M5 |

The agent's job at each of these is to produce the artefact that makes the human check take five minutes.
