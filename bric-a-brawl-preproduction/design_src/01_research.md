# 1. Research

Everything in this chapter was checked on 25 November 2026. Library versions come from the npm and PyPI registries. Measurements were run on a 2-vCPU, 7 GB, CPU-only Linux box, which is the same class of machine as the build VM, so treat the numbers as what the team will see. Anything I could not confirm is listed in 1.4.

## 1.1 Competitive and genre analysis

| Game | Steal | Avoid | Why |
|---|---|---|---|
| **Super Smash Bros. (Ultimate, Melee)** | Percent damage; a launch formula built from base knockback, knockback growth and weight; blast zones; directional influence; ledge play; the off-screen bubble. | A fixed stage. Hidden frame data. Delay-based online play. | The percent system is the best spectator mechanic in fighting games: everyone can see who is in danger. Its online play is the genre's cautionary tale: Ultimate uses delay-based netcode with heavy input delay, and its developers looked at rollback and did not ship it. |
| **Rivals of Aether (1 and 2)** | The parry as a universal answer. Wavedash-style movement tech as a deliberate feature. Small, legible rosters. | Removing guard entirely (Rivals 1). Stacking every defensive option at once (a common complaint about Rivals 2). | Rivals 1 replaced shields and grabs with a timed parry and replaced ledges with wall jumps; Rivals 2 put shields, grabs and ledges back. The lesson is that a party audience needs a "hold this to be safe" button, and a competitive audience needs that button to lose to something. We keep guard, make it slide you off ledges, and make parry the reward for timing. |
| **Brawlhalla** | Weapon pickups that change your move set for a while. Free, instant, low-spec. Two attack buttons plus a dodge. | Characters that are only skins over shared weapon move lists. | Proof that a platform fighter with pickups can be both a party game and a ranked game. Its fighters blur together, which is the opposite of what we want from four ornaments. |
| **Street Fighter 6** | Modern controls: one-button specials at a cost. Readable frame data in training mode. Perfect parry as a slow-motion highlight. | Six-button layouts. Long combo trials. | SF6 shows the exact trade we want: assisted inputs do 80% damage, so the easy route is real but the hard route is better. Its perfect parry has a two-frame window; ours is five frames because we have latency and newcomers. |
| **Guilty Gear Strive** | The wall break: the stage itself gives way and the fight moves on. Burst as a once-per-round escape. Huge counter-hit freeze frames. | Screen-filling effects that hide the characters. | Strive made "the arena breaks" a celebrated moment rather than a hazard. Our island does it continuously. Burst becomes our Gilt Break. |
| **Stick Fight: The Game** | Rounds measured in seconds. Guns whose recoil is a movement tool. The level falling apart as the clock. Instant rematch with no menu. | No depth: a week later there is nothing left to learn. | The closest tonal match to our pitch. Players already throw weapons at each other and ride recoil. It runs out of game because there is no fighting system underneath. |
| **Gang Beasts** | Grabbing and throwing as the comedy. Hazards that kill by removing footing. | Fully physical, floppy characters. | Reviewers called it a slapstick facilitator rather than a fighting game, and that is accurate: when every character is a ragdoll, skill cannot express itself and netcode cannot hide latency. Our fighters are scripted and tight; only the world is physical. |
| **Nidhogg** | One-hit clarity. A tug-of-war that a spectator understands in two seconds. Parry-by-positioning. | Two players only. | Shows how much drama comes from a single readable exchange. Our parry freeze and final-KO freeze borrow its "everyone saw that" quality. |
| **TowerFall, Duck Game** | Eliminated players stay involved. Round-end replays that become the social object. | Local-only design. | Dead time kills a party. Our eliminated players become teaspoons that tap the island apart, and every round ends with a copyable photo. |
| **Fall Guys** | Toy-like bodies that read at tiny sizes with eight on screen. One colour per player. | Mini-game variety as the hook. | The proof that soft, rounded, saturated-on-pale characters survive a 720p stream. |

Design conclusions that every later chapter obeys:

1. Keep the percent system and show it on the body: ceramic cracks.
2. Guard exists, but pushes you toward the edge. Parry is guard pressed on time.
3. One-button specials for everyone; motion inputs give a stronger "clean" version.
4. Only the world is simulated physically. Fighters are scripted, with fixed frame data.
5. The arena is the round timer.
6. Nobody waits. Eliminated players act, rematch is automatic.

## 1.2 Technical research

### What has already been built with this stack

- **DISCBALL3D** (2026) is the closest precedent: a browser soccer game for up to 5v5 on three.js r181 and Rapier, where the host's browser is the server and the authoritative simulation runs in a Web Worker in the host's tab at 60 Hz. It sends snapshots at 30 Hz over an unordered, no-retransmit data channel, keeps a second reliable channel for events, reports about 220 bytes for a 4v4 snapshot, predicts on every client and blends corrections out, and picks a new host if the host leaves. That is our architecture, already shipped by someone else. Two differences: it uses a Socket.IO gateway for signalling and relay, which we may not operate, and it runs Rapier 3D.
- **mrdoob/trystero-test** is a small three.js sandbox using Trystero for peer-to-peer networking, by three.js's author. It shows the pairing is ordinary.
- **Phewland** is a host-authoritative peer-to-peer browser shooter on three.js with physics. Same pattern again.

### Trystero (signalling and rooms)

Verified from the package and its docs at version 0.27.0, published 11 November 2026, MIT.

- The default strategy is Nostr, connecting to five public relays in parallel. No keys, no account. BitTorrent and MQTT strategies are a one-line import change.
- Default ICE servers are Google and Cloudflare STUN. There is a first-class `turnConfig` option and a `peer-connect-failed` error that carries `turnConfigured: false`. That is our friendly failure hook and our TURN slot.
- `room.getPeers()` returns, per peer, the underlying `RTCPeerConnection`. This matters: Trystero's own actions travel on a reliable, ordered channel with a 36-byte header on every frame, which is wrong for 60 Hz inputs. Because we can reach the connection, we open our own negotiated, unordered, no-retransmit data channel on it for inputs and snapshots, and keep Trystero's actions for joins, events and chat.
- Built in and useful: `maxUsers`, room `password` (encrypts signalling), `room.ping()`, signed per-user state and room state with late-joiner sync, and a `roles()` plugin that gives one peer verified admin rights. We use room state for the lobby and scores, and roles for "who is host".
- Trystero's docs put direct connection success at roughly 85 to 90 percent, with the remainder needing TURN. With eight friends, expect one person in two or three sessions to hit this. The failure screen is not an edge case.
- Bundle: about 46 KB Brotli by its own table; 53 KB gzip measured in our test build.

### WebRTC data channels

- A channel created with `ordered: false, maxRetransmits: 0` behaves like UDP. `negotiated: true` with a fixed `id` lets both sides create the same channel without another round of signalling.
- Keep messages small. Without message interleaving, a large message on one channel delays every other channel on the connection. Our largest snapshot is 716 bytes, under one packet.
- `RTCDataChannel` can now be transferred to a dedicated worker in Chrome and Edge 130+, Firefox 144+, and Safari. We do not depend on it; it is a later optimisation.

### Background tabs

The host will alt-tab to Discord. In a hidden tab, `requestAnimationFrame` stops and main-thread timers are clamped to about once a second. Tabs with an open data channel are exempt from Chrome's harsher one-per-minute throttling, and audible tabs are exempt from timer throttling, but neither makes a main-thread 60 Hz loop safe. Worker timers are not throttled the same way today, and message events are never timer-throttled. So the simulation runs in a Web Worker and the main thread only relays. Firefox has an open bug about throttling worker timers in background tabs, so M1 measures this on real browsers.

### Rapier

- Version 0.21.0, published September 2026, Apache-2.0. Packages exist for 2D and 3D, each in standard, SIMD, deterministic and `-compat` (wasm embedded as base64) builds.
- Determinism: rapier.rs says the JavaScript build is fully cross-platform deterministic; the npm README says only the `-deterministic` packages guarantee that, and the others are deterministic on one machine. The two statements disagree. We use `@dimforge/rapier2d-deterministic-compat` and stop caring; it measured 10 percent slower.
- **We use Rapier 2D, not 3D.** Gameplay lives on a plane. The 3D is rendering only.
- Measured, 74 bodies (24 terrain chunks, 6 falling chunks, 16 rubble, 8 gadgets, 12 projectiles, 8 kinematic fighters through the character controller): a full two-minute match of 7,200 ticks took 4.7 s, mean 0.65 ms per tick, p99 2.4 ms. Two runs produced identical state hashes. A world snapshot is 95 KB, 0.07 ms to take, 0.3 ms to restore.

### Rollback and lockstep libraries

| Library | Status | Fit |
|---|---|---|
| **NetplayJS** 0.4.1 | Last published April 2023. Its rollback implementation describes itself as for two-player games; its netcode package is marked work in progress. Corrects drift by having the host send authoritative state. | No. Two players, stale. |
| **rollback-netcode** 0.0.6 | Published February 2026. Claims N-player rollback over WebRTC with desync detection. Its README says APIs may change. | No for launch. Version 0.0.x, and see below. |
| **@geckos.io/snapshot-interpolation** 1.1.1 | Published February 2025, BSD-3. Transport-agnostic snapshot vault and interpolation, 2.2 KB gzip. | Yes, for remote entities. Small enough to vendor if it stalls. |

Rollback is the right answer for a two-player fighter and the wrong one here, for four reasons that are specific to this game:

1. **Connectivity.** Rollback and lockstep need every pair of players connected: 28 links for eight players. With no TURN and a 10 to 15 percent failure rate per link, a full mesh of eight almost never forms. A host star needs seven links, and we can choose the host everyone can reach.
2. **Cost on the weakest machine.** Every client would restore and re-simulate the whole physics world several ticks per frame. Measured: restore plus seven re-simulated ticks is about 5 ms of physics alone on the build-class machine, before game logic and before rendering, on every client, and with seven remote players a misprediction happens nearly every frame.
3. **Eight inputs.** Rollback windows are set by the worst link among all players. One friend on hotel wifi degrades everyone.
4. **Join and leave.** Friends drop in and out. Host authority absorbs that; synchronised simulation fights it.

Decision: host-authoritative, as briefed. What would change my mind: a 1v1 ranked mode. That mode alone could use rollback, because the sim is already deterministic and snapshot-able.

### Three.js

Version 0.187.0. The project now recommends `WebGPURenderer` with automatic WebGL 2 fallback, and guides call WebGL the fallback path. We use the classic `WebGLRenderer` anyway: our look is one small GLSL shader; the forum has a 2026 report of the WebGPU renderer costing about twice the CPU of the WebGL one on many-mesh scenes; the WebGL build is the smaller import; and headless Chrome on the VM renders WebGL in software reliably. What would change my mind: `WebGLRenderer` being deprecated, or a real need for compute shaders.

### GitHub Pages

Static only: 1 GB site limit, 100 GB a month soft bandwidth, no custom response headers. No custom headers means no cross-origin isolation, so no `SharedArrayBuffer` and no wasm threads without a service-worker hack. We need neither. Our 3 MB first load gives roughly 30,000 visits a month before the soft limit.

### Discord link previews

Discord builds the embed from Open Graph tags in the HTML it fetches. It does not run JavaScript, images must be HTTPS, and the fetch must finish in ten seconds. Since the room code lives in the URL fragment, which is never sent to a server, every room shares one static preview. That is fine and is the only option on static hosting. Use a 1200 by 630 image.

### Headless Blender on a CPU

Tested with `bpy` 5.3.0 from PyPI on Python 3.13, 918 MB installed, 450 MB resident for a small scene.

| Job | Result on 2 vCPUs |
|---|---|
| Cycles, 640x360, 16 samples, denoised | 4.9 s |
| Cycles, 640x360, 64 samples, denoised | 11.7 s |
| Workbench, 640x360 | 1.3 s, worked through Mesa software GL after Vulkan failed to initialise and EGL logged errors |
| EEVEE | Hung. Never use it on the VM. |
| glTF export of a vertex-coloured mesh | 0.2 s. The exporter has meshopt compression built in. |
| Packed matcap bake, three 256x256 Cycles renders | 16 s |
| Engine-look preview, 640x640 character tile, 20 samples | about 6 s |
| Engine-look style frame, 1600x900, 46k triangles, 28 samples | 46 s |

Conclusions: Cycles on CPU is dependable and needs no GL at all, so it is the default. Workbench is a bonus that depends on Mesa being installed. Scripted modelling from lathe profiles and swept tubes produced four distinct fighters at 4,900 to 6,200 triangles each in one sitting of iteration, which is the evidence that the art direction is achievable.

### Headless browser on a CPU

Chrome 153 headless, software WebGL (ANGLE over llvmpipe), 44k triangles, 29 draw calls, matcap material:

| Canvas | Mean frame | p95 |
|---|---|---|
| 960x540 | 12.0 ms | 15.5 ms |
| 640x360 | 8.6 ms | 10.8 ms |
| 480x270 | 7.1 ms | 9.0 ms |

So one browser smoke test at 640x360 can hold a real frame-time gate on the VM. It says nothing about a real integrated GPU; that is what the human playtest perf report is for.

### Sizes measured in a real Vite build

| Chunk | Raw | Gzip |
|---|---|---|
| Rapier 2D deterministic, compat build | 3,446 KB | 1,300 KB |
| three (tree-shaken: renderer, skinned and instanced meshes, glTF loader, audio) | 651 KB | 160 KB |
| Trystero (Nostr) | 150 KB | 53 KB |
| msgpackr | 32 KB | 11.5 KB |
| snapshot-interpolation | 5.5 KB | 2.2 KB |

Rapier is 85 percent of the JavaScript. The separate `.wasm` build is 919 KB gzip if the host compresses wasm, which I could not confirm for GitHub Pages; start with compat, measure, and switch if the load-time gate needs it. The Vite 8 production build took 0.4 s.

## 1.3 Art research

The constraint is unusual: every model is written as a Python script by an agent with no eye, rendered on a CPU, and has to look deliberate at 60 fps on integrated graphics. That rules out anything whose quality lives in sculpted detail or painted textures, and rewards styles whose quality lives in a rule.

| Candidate | For | Against | Verdict |
|---|---|---|---|
| Flat-shaded low-poly | Trivial to script. | The default look of every game jam and every free asset pack. Banned in spirit. | Rejected |
| Toon shading with outlines | Readable. Shader-driven. | First thing anyone thinks of. Outlines double draw calls. Needs good silhouettes to carry it, which is the hard part. | Rejected |
| Papercraft | Material-committed, charming, scriptable as folds. | Paper tears and floats; it does not shatter or launch. Wrong physics for a game about ejection. | Rejected |
| Risograph print (halftone, two inks, misregistration) | Striking in screenshots. All in the shader. | Fights readability with eight players; halftone shimmers in motion. | Kept as the impact-frame treatment only |
| Painted wooden toys | Lathe-friendly, warm. | Wood splinters; nothing about it says fracture. | Rejected |
| **Glazed ceramic ornaments** | Pottery is literally made on a lathe, so the modelling method and the subject are the same thing. Ceramic breaks into flat-faced shards with a different colour inside, which is exactly what low-poly fracture looks like. Glaze is a matcap, the cheapest material there is. Cracks are a damage meter. Gold repair is a comeback meter. | Risk of twee. Needs a strict palette to avoid looking like a gift shop. | **Chosen** |

Why it beats the others: it is the only option where the production constraint, the game's verb and the look are one idea. Thrown forms are what the scripts are good at. Shattering is what the game is about. A glossy thing with a window reflected in it is what a matcap is. And nobody has made this game.

It is anchored by three references, detailed in the art bible: the **Mingei** folk-craft movement (useful, handmade, slightly wrong on purpose), **blue-and-white transferware and kintsugi** (the decoration and the repair), and **British stop-motion** (the comic timing and the thumbprint).

## 1.4 Flags and unknowns

| # | Unknown | Why it matters | Where it gets resolved |
|---|---|---|---|
| U1 | Whether a negotiated unreliable data channel opened on Trystero's `RTCPeerConnection` works in Chrome, Firefox and Safari without disturbing Trystero. | It is the whole fast path. | M1, first thing. Fallback: send everything on Trystero actions and accept stalls under loss. Second fallback: PeerJS 1.5.5 with its public broker, which supports unreliable connections but has a single point of failure. |
| U2 | Reliability of the public Nostr relays on a given night. | No relays, no room. | M1 logs time-to-first-peer over repeated trials. Fallback: also join via the BitTorrent strategy. |
| U3 | Worker timer behaviour when the host tab is hidden, per browser. | A frozen host freezes eight people. | M1 has a "hide this tab for 60 s" test. |
| U4 | Whether GitHub Pages compresses `.wasm`. | 400 KB of load time. | M3 load-time gate. |
| U5 | Real frame rate on real integrated GPUs. | The VM cannot measure it. | Human playtest perf report at M3 and M5. |
| U6 | The exact disk and memory of each tool on Antigravity's image. | I measured on a similar box, not theirs. | M0 `du` and `free` report. |
| U7 | Licences of individual text-to-speech voices. The maintained Piper engine is now GPL-3.0 and each voice carries its dataset's licence. | Announcer lines. | Audio chapter: announcer is text and foley by default; voice is optional and gated on a licence check. |
| U8 | The title. A web search found no game called Bric-a-Brawl; it did find current games called Smithereens, Crackpots and Knockoff, which is why those were dropped. This was a search, not a trademark check. | Renaming later costs an afternoon. | Ace decides before the link goes anywhere public. |

## 1.5 Sources

Libraries and platforms: [Trystero repository and docs](https://github.com/dmotz/trystero) · [Rapier JavaScript determinism](https://rapier.rs/docs/user_guides/javascript/determinism) · [Rapier npm package notes](https://www.npmjs.com/package/@dimforge/rapier3d) · [NetplayJS](https://www.npmjs.com/package/netplayjs) · [rollback-netcode](https://www.pkgstats.com/pkg:rollback-netcode) · [three.js WebGPURenderer manual](https://threejs.org/manual/en/webgpurenderer) · [three.js forum, renderer tag](https://discourse.threejs.org/tag/webgpu-renderer/1686) · [MDN: using data channels](https://developer.mozilla.org/en-US/docs/Web/API/WebRTC_API/Using_data_channels) · [MDN: createDataChannel](https://developer.mozilla.org/docs/Web/API/RTCPeerConnection/createDataChannel) · [RTCDataChannel transferable support](https://caniuse.com/mdn-api_rtcdatachannel_transferable) · [Chrome: timer throttling in Chrome 88](https://developer.chrome.com/blog/timer-throttling-in-chrome-88) · [Chrome: background tabs](https://developer.chrome.com/blog/background_tabs) · [Firefox bug 1818463](https://bugzilla.mozilla.org/show_bug.cgi?id=1818463) · [GitHub Pages limits](https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits) · [GitHub Pages COOP/COEP discussion](https://github.com/orgs/community/discussions/13309) · [Discord link previews](https://docs.discord.com/developers/link-previews/overview) · [web.dev: async clipboard](https://web.dev/articles/async-clipboard) · [Blender devtalk: headless rendering](https://devtalk.blender.org/t/blender-2-8-unable-to-open-a-display-by-the-rendering-on-the-background-eevee/1436) · [Piper licence change](https://www.assemblyai.com/blog/free-open-source-text-to-speech)

Precedents: [DISCBALL3D write-up](https://discourse.threejs.org/t/discball3d-multiplayer-soccer/95207) · [Phewland](https://github.com/grep-many/phewland) · [Trystero with three.js](https://dev.to/bandinopla/effortless-serverless-multiplayer-in-threejs-with-trystero-3551)

Genre: [SmashWiki: knockback](https://www.ssbwiki.com/KB) · [Rivals of Aether system notes](https://wiki.gbl.gg/w/Rivals_of_Aether/System) · [Rivals of Aether II review, AV Club](https://www.avclub.com/rivals-of-aether-ii-review) · [Street Fighter 6 game information, Liquipedia](https://liquipedia.net/fighters/Street_Fighter_6/Game_Information) · [Smash Ultimate and rollback, Shacknews](https://shacknews.com/article/127238/digital-eclipse-on-rollback-netcode-smash-ultimate-online-issues) · [Fighting-game netcode explained, Infil](https://ki.infil.net/w02-netcode-p5.html) · [Gang Beasts review, PC Gamer](https://pcgamer.com/gang-beasts-review)

Name checks: [Smithereens on Steam](https://store.steampowered.com/app/5251660) · [The Amazing Crackpots Club on Steam](https://store.steampowered.com/app/2474020) · [KNOCKOFF on Steam](https://store.steampowered.com/app/3269810)

Measurements: scripts and raw output are in `reference/poc/`.
