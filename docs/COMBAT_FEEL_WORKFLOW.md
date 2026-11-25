# Combat Feel Evaluation & Iteration Workflow

A repeatable engineering + visual evaluation process to verify and tune Super Smash Bros.-grade attack responsiveness, animation readability, and hit impact across all four ceramic fighters (**Earl**, **Grog**, **Nesta**, **Moss**).

---

## The 5-Step Iteration Loop

1. **Quantify & Gate (`npm run eval:combat`)**
   Runs both the deterministic combat-feel unit/sim gates ([`tests/unit/combat-feel.test.ts`](../tests/unit/combat-feel.test.ts)) and the real Chromium WebGL visual evaluator ([`tests/browser/combat-feel.spec.ts`](../tests/browser/combat-feel.spec.ts)) against the production build.
2. **Inspect the 4-Phase Visual Filmstrips (`evidence/combat-feel/*.png`)**
   Open each generated 4-panel contact sheet (`Windup -> Active Swing + Slash Arc -> Impact Hitstop + Flash + Sparks -> Launch Tumble + Smoke`):
   - `evidence/combat-feel/filmstrip-earl-fheavy.png`
   - `evidence/combat-feel/filmstrip-grog-fheavy.png`
   - `evidence/combat-feel/filmstrip-nesta-jab3.png`
   - `evidence/combat-feel/filmstrip-moss-ftilt.png`
3. **Score Against the 6 Smash Feel Criteria (Human Visual Rubric)**
   - **Silhouette Commitment**: Does the whole body coil backward on Windup and lunge explosively forward on Active with zero detached limbs?
   - **Limb Readability**: Does the striking fist/horn/rod/foot pop visibly into the opponent's space (exaggerated active scale + clear slash crescent matching the hitbox)?
   - **Contact Accuracy**: Do sparks, glaze chips, and rings burst directly off the struck defender (never behind the attacker)?
   - **Impact Crunch**: Does hitstop visibly freeze + flash the defender bone-white + rattle them before launch, with Crimson/Gilt Kill-Sparks on heavy/lethal blows?
   - **Launch Spectacle**: Does the launched fighter tumble around their center-of-mass trailing smoke puffs and livery ribbon?
   - **Audio Punch**: Do every melee swing whoosh and every hit tier (`HitLight` / `HitMid` / `HitHeavy`) feel distinct and grounded?
4. **Tune in One Single Source of Truth**
   - **Input & combat responsiveness**: [`src/sim/fighter.ts`](../src/sim/fighter.ts), [`src/sim/combat.ts`](../src/sim/combat.ts), [`src/client/input.ts`](../src/client/input.ts), [`src/host/engine.ts`](../src/host/engine.ts)
   - **Bone parenting & model rigs**: [`src/client/models.ts`](../src/client/models.ts)
   - **3-phase attack choreography & hitlag rattle**: [`src/client/poses.ts`](../src/client/poses.ts)
   - **Slash arcs, directional sparks, kill-sparks, tumble smoke**: [`src/client/vfx.ts`](../src/client/vfx.ts), [`src/client/combat-feel.ts`](../src/client/combat-feel.ts)
   - **Directional camera punch & zoom kick**: [`src/client/camera.ts`](../src/client/camera.ts)
   - **Swing whooshes & sub-bass hit punch**: [`assets-src/audio/recipes.json`](../assets-src/audio/recipes.json), [`src/client/audio-dsp.ts`](../src/client/audio-dsp.ts)
5. **Re-Verify All Budgets & Zero Regressions**
   Run `npm run check && npm run audio:build && npm run build && npm run eval:combat && npm run test:browser` so frame-data (`onBlock <= -7`, KO%), netsim profiles, audio loudness/centroid, bundle size, and draw-call budgets (`<= 90` High / `<= 60` Medium) stay 100% green.

---

## Automated Quality Gates (F1–F7)

| Gate | What It Verifies | Where It Runs |
|---|---|---|
| **F1 — Local Input Latency** | Zero-delay local host (`interpDelayMs = 0`, 60 Hz local snapshots) enters `Attack` immediately on press | `combat-feel.test.ts` & `combat-feel.spec.ts` |
| **F2 — Zero Dropped Taps** | Sub-frame keyboard/touch press+release latches through `InputCollector` and `HostSimulation` local queue | `combat-feel.test.ts` |
| **F3 — Unified Rig & Hitstop Sync** | Child bones parented under `body.bone`; `hitstopFrames` propagated through `RemoteInterpolator` with pose frozen during hitstop | `models.ts`, `combat-feel.test.ts` |
| **F4 — Pose Readability & Limb Pop** | Windup coil -> active lunge delta (`> 0.8 u`), striking limb scale (`>= 1.25x`), distinct `Jab1/2/3`, `ChargingHeavy` shiver, victim rattle (`>= 0.14 u` span) | `combat-feel.test.ts` |
| **F5 — Smash Combat Mechanics** | Mashing `Jab1 -> Jab2 -> Jab3` lands all 3 hits; airborne `Heavy` -> directional aerials; buffered short-hop aerials; diagonal turnaround; sliding grounded attacks; close-range `Utilt` | `combat-feel.test.ts` |
| **F6 — Contact Accuracy & VFX/SFX** | Hit sparks/chips spawn on defender; all melee moves emit hitbox-aligned 3D slash arcs + swing whooshes; heavy launches trigger Kill-Spark | `combat-feel.test.ts` & `combat-feel.spec.ts` |
| **F7 — Audio & Render Budgets** | All 51 SFX + 13 auctioneer + 3 stems pass LUFS/peak/centroid; High draw calls `<= 90`, tris `<= 110k`, 0 console/page errors | `audio:build`, `m4-m5.spec.ts`, `combat-feel.spec.ts` |
