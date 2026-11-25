# BRIC-A-BRAWL: Art Bible

This is chapter 4 of the pre-production package, kept as its own file because the art team (an agent writing Blender scripts) should be able to read it alone. Chapter 5, the concept art and its critique, is in `concept_art/`.

The reference implementation of everything here is `reference/blender/`. Where this document and those scripts disagree, the scripts are wrong and should be fixed to match this document. Every image named below is in `concept_art/png/`.

---

## 4.1 Mood, themes and references

**One sentence:** small glazed ornaments having a very serious fight on crockery, photographed in a sunny room.

**Mood:** dry, tactile, slightly pompous. The comedy comes from dignity failing: a teapot with a monocle being fired off a plate. Nothing winks at the camera. Nothing glows.

**Themes:** things that break and get mended. Being knocked off a shelf. Value: every fighter is an auction lot and every result is a sale.

**References**

| Reference | What we take | What we leave |
|---|---|---|
| **Mingei**, the Japanese folk-craft movement: everyday pots made by hand, valued for use and for small irregularities. | Forms that are thrown, not built. A wobble in every circle. Honest materials: you can see what is glaze and what is clay. | Earnestness. We are a comedy. |
| **Blue-and-white transferware and kintsugi.** Printed plates in one ink on white; breaks repaired with gold. | The willow plate as an arena. One ink on white as the impact-frame treatment. Gold seams as the comeback meter. | Literal pattern reproduction. We paint bands and big shapes, not fine pattern. |
| **British stop-motion** (the plasticine-on-a-tabletop tradition). | Comic timing with held poses. Thumbprint imperfection. Idle animation "on twos". Small things in a big, softly lit room. | Clay's softness. Our things are hard and they clink. |

Games to look at for specific lessons: **Tearaway** for committing to one material everywhere; **Fall Guys** for eight readable players on pale worlds; **Guilty Gear Strive** for impact frames; **Smash** for the off-screen bubble and the launch trail.

---

## 4.2 Palette

Source of truth: `data/palette.json`. Sheet: `palette.png`.

### Player liveries (slot order is fixed)

| Slot | Name | Hex | Pattern (colour-blind cue) |
|---|---|---|---|
| P1 | Cobalt | `#24459A` | solid band |
| P2 | Oxblood | `#A3312B` | dots |
| P3 | Mustard | `#E3A72F` | stripes |
| P4 | Verdigris | `#2F8F7A` | checks |
| P5 | Tangerine | `#E36F36` | zigzag |
| P6 | Aubergine | `#6A3F78` | scallops |
| P7 | Rose | `#DA7F98` | florets |
| P8 | Celery | `#A9B544` | crosshatch |

### Neutrals (fighter bodies, clay, ink)

| Name | Hex | Used for |
|---|---|---|
| Bone | `#F2EEE6` | Earl, glazed white, faces |
| Slip | `#EAE3D2` | Nesta's body |
| Bisque | `#D8B596` | Raw fired clay: every fracture face |
| Terracotta | `#B5633F` | Moss's coat, garden clay |
| Clay foot | `#9C6B55` | Undersides of islands (terracotta at 29% saturation) |
| Basalt | `#3A322D` | Grog |
| Ash | `#8E8478` | Steel, stone |
| Ink | `#2B2623` | Eyes, brows, lines, all UI text |

### Accents

Gilt `#C8A24A` (highlight `#E7CF86`, shadow `#8A6A22`) · Cheek `#E9A39A` · Stamp red `#B5432E` · Delft ink `#1E3A8A` on Delft paper `#F4F1EA` (impact frames only).

### World

Sky top `#A9C2BC`, middle `#E4D3B5`, low `#D9A886` · Cloud `#EFE7D8` · Willow glaze `#EDEAE2`, willow wash `#8C9FC6`, willow line `#5E78B0` · Tea cream `#EFE3C8`, tea rose `#D9A5A0` · Bowl inner `#B9CDB8`, bowl tenmoku `#4A372C`.

### Colour rules (all testable)

1. **Saturation belongs to players and gadgets.** No world surface larger than 2 percent of the screen may exceed 35 percent HSL saturation. Liveries are all above 50 percent.
2. **Bodies are neutral.** A fighter's body uses only the neutral table. Any saturated colour on a fighter is the player's livery. This is why any livery reads on any fighter (`sheet_*.png`, livery strips).
3. **Hands are always the player's colour.** Hands deal the hits, so "whose hand was that" is answered by colour.
4. **Livery covers at least 25 percent of the fighter's side silhouette** and includes its topmost or widest feature (Earl's lid, Grog's blanket, Nesta's headscarf, Moss's hat).
5. **Fighters own the top of the value range.** Sky sits at 60 to 75 percent value; clouds never exceed 88 percent; so bone-white fighters are the brightest things on screen. The first style frame failed this (white fighters on white clouds) and was redone.
6. **Gold means mended.** Gilt appears only on rims, seams, finials and the Gilt meter. It is never a body colour.
7. **Red means gone.** Stamp red is for the blast zone, danger percentages and the SOLD stamp. Nothing in the world is that red.
8. **Teams.** Team A uses slots 1, 4, 6, 8 (cool). Team B uses 2, 3, 5, 7 (warm).

---

## 4.3 Shape language

### The potter's rules

Every model obeys these. They are what makes a scripted mesh look made.

1. **Thrown or pulled.** Every form is a profile spun around an axis (a lathe) or a tube pulled along a path (a sweep). Boxes are four-sided lathes with soft profiles. There are no unmodified cubes, spheres, cylinders or cones anywhere in the repository.
2. **Foot, belly, shoulder, lip.** A thrown form has a narrow foot it stands on, a widest point, a turn inward, and a finished edge. Profiles with fewer than five control points are rejected.
3. **The wobble.** Every lathe ring is perturbed by 1 to 2.5 percent with a low-frequency sine, seeded per part. Nothing is a perfect circle.
4. **One pulled feature.** Each fighter has exactly one asymmetric feature that says which way it faces: spout, horns, face, hat tip.
5. **Bottom-heavy.** The widest point is in the lower half. Ornaments do not fall over.
6. **Glaze stops short.** Glaze never reaches the foot. Bases, breaks and undersides are raw clay.
7. **Breaks are flat.** Fracture faces are planar, unsmoothed and bisque-coloured. The contrast between a smooth glazed surface and a flat raw break is the entire fracture effect.

### Fighters

- **Proportions:** about 2 heads tall. A mid fighter is 1.5 to 1.6 u; Grog is 1.7 u tall and 1.9 u long; Moss is 1.4 u plus a 0.6 u hat.
- **Floating hands and feet.** No arms, no legs. Hands are about a third of the head's size and sit 0.6 to 0.9 u from the body centre. This is a production decision as much as a style one: it removes skinning, makes every attack a hand moving through space, and lets gadgets attach to a hand with one transform.
- **The four silhouettes** are four different primitives of the eye, never of the mesh: a circle with a point (Earl), a horizontal bar with horns (Grog), a tall pin (Nesta), a triangle (Moss). See `sheet_silhouettes.png`.
- **Faces are painted on,** in ink and cheek pink, slightly raised. Brows and mouths do not animate. Each fighter emotes with one part instead: Earl's lid, Grog's head and ring, Nesta's wobble, Moss's hat.
- **Facing.** Fighters turn 42 degrees toward the camera when facing left or right, so the face and the livery are always visible. Left-facing is a rotation, not a mirror.

### World

- **Islands** are extruded from the gameplay chunk polygons in `data/arenas.json` by `reference/blender/arena.py`. The art cannot drift from the collision because it is generated from it. Plan shape is an ellipse 6 to 7 u deep. Tops are glazed, cut faces are bisque, undersides are clay-foot. Each chunk has a rounded glazed lip and a painted band under it: the band is the visual ground line.
- **Dressing** (pagoda, bridge, tree, stem, cups) sits behind the gameplay plane between z = +0.8 and +2.5 u, except platforms, which cross it. Nothing in front of z = −1.2 u may be taller than 0.4 u.
- **Clouds** are clusters of matte thrown blobs. At most five. They never sit behind the middle third of the screen at fighter height.

### Silhouette tests (automated)

- Each fighter's side view, rendered black at 64 px, must have pairwise overlap (intersection over union) below 0.60 with every other fighter.
- Each fighter must be recognisable at 56 px in black; this one is judged by a person, on the sheet.
- A gadget's silhouette at 48 px must differ from every other gadget's by the same 0.60 rule.

### Polygon budgets

| Asset | Triangles | Bones | Draw calls | Reference build |
|---|---|---|---|---|
| Fighter | 6,500 max | 12 max, one per rigid part | 1 | Earl 5,468 · Grog 6,220 · Nesta 5,120 · Moss 4,876 |
| Fighter LOD1 (Low tier) | 3,000 max | same | 1 | Same script, lathe segments 24 to 14, blobs 12 to 8 |
| Gadget | 800 max | 0 to 2 | 1 | 228 to 766 |
| Island chunk with lip | 300 max | 0 | 1 | about 150 |
| Arena dressing, total | 12,000 max | 0 | 8 max | Willow about 9,000 |
| Cloud | 400 max | 0 | instanced | about 300 |
| Shard (cosmetic) | 16 max | 0 | instanced, 6 shapes | 12 |
| Guard plate, parcel, teaspoon | 500 each | 0 | 1 | 300 to 450 |

The whole style frame is 46,500 triangles with six fighters. The on-screen ceiling is 110,000 on High and 70,000 on Low.

---

## 4.4 Materials, shading, lighting

### One material, one texture

There is one shader, `GlazeMaterial`, and one texture: a 256 by 256 packed matcap (`reference/blender/out/matcap_packed.png`, 51 KB). There are no lights in the scene. A controlled camera means the lighting can live in the texture.

The matcap is baked once by `bake_matcap.py` with Cycles (16 seconds on the VM):

| Channel | Contents | Rig |
|---|---|---|
| R | Soft diffuse shading, floor lifted to 0.30 so nothing goes black | Large key upper-left-front, low fill right, table bounce from below |
| G | Sharp highlight: a four-pane window reflection upper left, a thin strip on the right edge | Four small area lights in a 2 by 2 grid; one vertical strip |
| B | Broad sheen and rim | Top-back panel and two side rims |

The window reflection is the signature. It is what makes a blob read as a glazed thing in a room.

### Vertex data

Each mesh has one colour attribute, `COLOR_0`, RGBA 8-bit, written per face corner so slot boundaries are hard:

| Channel | Meaning |
|---|---|
| R | Palette slot, 0 to 15, stored as slot / 15 and passed to the fragment shader with `flat` interpolation |
| G | Gloss: 1.0 glaze, 0.35 satin, 0.0 bisque |
| B | Baked ambient occlusion, 0.42 to 1.0 remapped to 0 to 1 |
| A | Metal flag: 1 for gilt, else 0 |

Fighters carry a 16-entry palette uniform. Slot 2 is always the livery, so recolouring a fighter is one uniform write. Slots: 0 body, 1 body-2, 2 livery, 3 bone, 4 ink, 5 cheek, 6 gilt, 7 bisque, 8 to 15 fighter-specific.

### The shader, in full

```glsl
vec3  m     = texture(uMatcap, normalize(vViewNormal).xy * 0.49 + 0.5).rgb;
vec3  base  = uPalette[int(vColor.r * 15.0 + 0.5)];
base        = mix(base, IRON, speckle(vObjPos) * 0.55 * (1.0 - vColor.a));       // stoneware flecks
float crack = crackLines(vObjPos.xy, uCrack);                                     // 0..1 from damage
base        = mix(base, mix(INK, GILT, uGilt), crack);                            // cracks fill with gold
vec3  diff  = base * m.r * mix(0.42, 1.0, vColor.b);
float gloss = vColor.g * (1.0 - uInvuln);                                         // invulnerable = matte
float sheen = mix(0.12, 0.5, vColor.g) * 0.45;
vec3  tint  = mix(vec3(1.0), min(base * 1.6 + 0.08, vec3(1.0)), vColor.a);        // gilt tints its highlights
vec3  col   = diff + tint * (m.g * gloss + m.b * sheen);
col         = mix(col, vec3(1.0), uFlash);                                        // 2-frame hit flash
```

- `speckle` is 3D cellular noise at scale 26 thresholded at 0.055, gated by low-frequency noise so flecks cluster. Low tier: off.
- `crackLines` is 2D cellular distance-to-edge noise at scale 1.05 in the fighter's front-facing plane, thresholded at `0.010 + 0.012 x uCrack`. `uCrack` is damage percent / 150, clamped. Three visible stages: hairlines at 50 percent, a web at 100, heavy at 150. Low tier: a single pre-baked crack mask in COLOR_1 instead.
- `uGilt` is the Gilt meter, 0 to 1.
- Renderer settings: `outputColorSpace = SRGBColorSpace`, `toneMapping = NoToneMapping`. The matcap is loaded as linear data. Palette colours are converted from sRGB to linear once.
- **Parity test.** `ceramic.py: engine_material()` is the same formula as a Blender node tree. The build renders one test sphere in Blender and one in the game and fails if the mean absolute difference exceeds 6 of 255. This is how an agent with no eye knows the shader is right.

### Shadows

Blob shadows only: a soft ink disc at 28 percent opacity under each grounded fighter, scaled down with height and gone above 3 u. Static contact shading is the baked AO channel. There is no shadow map in version 1. One is on the cut list as "only if M4 finishes early".

### Sky, atmosphere, fog

- A gradient dome with three stops from the world table. No sun disc, no stars.
- Linear fog to the sky's middle colour, starting at 40 u and complete at 140 u.
- Dust motes: at most 40 slow, tiny, matte specks drifting in the mid-ground. They are what sells "a sunny room" and they cost one instanced draw.
- Below the island: the sky's low colour, warming toward the bottom. In The Mended Bowl the bottom is 15 percent warmer for the kiln.

### Post-processing

One full-screen pass, called Finish. Nothing else.

| Step | Value | Tier |
|---|---|---|
| Anti-aliasing | 4x MSAA target (High), 2x (Medium), none (Low) | by tier |
| Vignette | 12 percent darkening at the corners | High, Medium |
| Paper grain | 2 percent luminance noise, static per frame | High |
| Impact frame | Luminance threshold at 0.5 to two colours, Delft ink and Delft paper, with a 3 px ink edge from a second threshold at 0.35 | all tiers; Low uses a CSS overlay instead |

**No bloom, no chromatic aberration, no depth of field, no motion blur, no lens flare, no colour LUT.** Bloom in particular is banned: it is the first step toward the look this project forbids.

---

## 4.5 Camera

Numbers are in `data/tuning.json` under `camera`.

- **Lens.** 30 degrees vertical field of view, pitched 7 degrees down, 23 to 33 u back. A long lens flattens the scene like a product photograph and keeps fighters the same size across the island.
- **Framing.** Fit a box around all living fighters plus 2.5 u of margin on every side. Never show less than 16 u of width or more than 38. Never look outside the arena's camera bounds. Position follows with a critically damped spring at 6 rad/s; zoom at 3.5 rad/s, so zoom lags position and never pumps.
- **Depth.** The camera yaws up to 5 degrees toward the centre of the action, so dressing slides behind the plane and the scene reads as three-dimensional. It never rolls in normal play.
- **Launch.** When any fighter is launched faster than 20 u/s: widen by 8 percent over 4 frames, lean 2.5 degrees of yaw toward the launch, hold while they fly, return over 20 frames. The camera does not chase a launched fighter out of bounds.
- **Off-screen.** A fighter outside the frame but inside the blast zone gets a bubble at the nearest screen edge: a 74 px porthole rimmed in their colour showing them at fixed size.
- **KO.** Six-frame freeze, shake with trauma 0.9, no zoom.
- **Final KO.** After the 24-frame freeze, a 40-frame push of 12 percent toward the midpoint of winner and loser at quarter speed, with 1.5 degrees of roll. This is the only time the camera rolls.
- **Because the camera is controlled,** models are only ever seen from in front and above. Backs and undersides of dressing may be left open. Fighters are complete, because they tumble.

---

## 4.6 VFX and game feel

No particle glows, no additive blending, no trails of light. Every effect is a small solid thing: a chip, a puff, a brushstroke, a crack.

| Effect | Spec |
|---|---|
| **Chips** | 12-triangle ceramic flakes, instanced, in the victim's glaze and bisque. 8 to 14 per hit, 26 for a KO. Ballistic with spin, 40 to 70 frames, bounce once on the island. |
| **Dust puffs** | Matte thrown blobs in bisque or bone at 80 percent opacity. Scale 0.15 to 0.6 u, grow 40 percent and fade over 24 frames. Footsteps 1, landings 3, dashes 3, launches off the ground 5. |
| **Brushstroke trail** | A flat ribbon behind any fighter above tumble speed, in the **victim's** livery, 92 percent opaque: one loaded stroke 0.4 u wide and two dry bristle streaks beside it, tapering to nothing over 30 frames. It looks painted on the air. |
| **Cracks on chunks** | The same crack function as on fighters, driven by chunk HP. A crazed chunk also sheds a chip every 20 frames. |
| **Guard plate** | Cracks in three stages with guard HP. Blocked hits knock chips off it. A guard break shatters it into 12 chips and a ring of dust. |
| **Parry** | The attacker turns matte and vibrates 0.04 u at 30 Hz for the 30 stun frames. One ring of 6 chips. Impact frame. |
| **Hit flash** | The victim is solid white for 2 frames (`uFlash`). |
| **Impact frame** | The Delft two-tone treatment, 2 frames on any hit of 10 percent or more, 3 frames on a parry, 24 on the final KO. Never more than three in any second. A "reduce flashes" setting replaces it with a 6 px ink border pulse. |
| **Gust** | Bellows and Snort: 3 to 4 matte puffs that grow along the cone. No lines, no streaks. |
| **KO burst** | 26 chips flying inward from the point on the screen edge where the fighter left, in their colour, plus hairline cracks spreading 30 percent into the screen from that point over 6 frames, filling with gold over 20, fading over 40. Drawn in screen space. |
| **Parcel** | A brown paper box under a lace doily, 2 seconds of descent with a 6 degree sway. |

### The juice of a big launch, frame by frame

| Frame | What happens |
|---|---|
| 0 | Hit connects. Both fighters freeze for the hit-stop (10 to 16 frames for a heavy). The attacker's striking part is held at full extension, stretched 1.3 times. |
| 0 to 1 | Impact frame: the whole screen in Delft blue and white. |
| 0 to 1 | Victim flashes white. |
| 0 | 12 chips leave along the launch direction. A dust ring on the ground. A crack star on the chunk if they were grounded. |
| 0 | Camera kicks 0.15 u away from the launch and shakes with trauma 0.5. |
| during the freeze | Victim shakes 0.06 u at 30 Hz. Their lot tag tilts 3 degrees and the percent ticks up in red. |
| release | Victim leaves stretched 1.6 times along their velocity for 4 frames, then tumbles at 720 degrees a second. Brushstroke trail starts. Their gadget flies off separately. |
| release + 4 | Camera widens 8 percent and leans. A rising whistle starts, pitched by launch speed. |
| in flight | The auctioneer says "Going..." if the launch is fast enough to be lethal. |
| at the blast zone | Six-frame freeze. KO burst. Screen-edge cracks. Shake at trauma 0.9. A plate smashes. "Gone." The lot tag swings on its string and drops a stock pip, which shatters. |
| if they recover instead | The auctioneer says, flatly, "Withdrawn." |

---

## 4.7 Animation

There is no skeleton in the usual sense and no animation is authored in Blender. Each fighter is 3 to 7 rigid parts. Animation is a table of poses in code, played by a small runtime that adds the life.

### Pose tables

A move is five key poses: rest, anticipation, strike, hold, recover. A pose is a transform (position, rotation, non-uniform scale) per part, relative to rest. Timing comes from the frame data, so animation can never disagree with gameplay:

| Segment | Frames | Easing |
|---|---|---|
| Rest to anticipation | 0 to startup − 2 | Ease out. The part pulls back opposite to the strike, at least 30 percent of the strike distance. |
| Anticipation to strike | the last 2 startup frames | Linear, with smear: the striking part is stretched up to 1.8 times along its path for those 2 frames. |
| Strike, held | the active frames, plus hit-stop if it lands | No motion. |
| Strike to recover | the remaining frames | Spring: overshoot 15 percent past rest, settle at 6 Hz with damping 0.45. |

Moves are built from eight archetypes with parameters (jab, swipe, upper, sweep, stomp, spin, lunge, throw) so a new move is a line of data, not a new animation. Signature moves get bespoke poses; the four on the character sheets are the references.

### The layers that make it feel hand-made

Applied every frame on top of the pose, in this order:

1. **Squash and stretch on the whole fighter.** Volume preserved: if height scales by s, width and depth scale by 1/√s. Jump squat 0.8, take-off 1.25, landing 0.75 recovering over 4 frames. Never more than 1.35 on a body or 1.8 on a hand.
2. **Springs on the expressive part.** Earl's lid, Grog's head and ring, Nesta's whole body about her base, Moss's hat tip, and every hand: each follows its target on a spring at 7 Hz, damping 0.5. This is the cheap secondary motion that reads as weight.
3. **Idle life.** A breathing bob of 0.03 u at 0.7 Hz, plus the fighter's tic from the character sheet.
4. **Look.** The expressive part turns up to 10 degrees toward the nearest opponent.
5. **Boil.** Twelve times a second, every part gets a seeded jitter of ±0.4 degrees and ±0.3 percent scale. Only in idle, taunts, the lobby and menus, never during startup or active frames. It is the stop-motion thumbprint.
6. **Twos.** Taunts, victory poses, the results screen and the title screen update poses 12 times a second, not 60. Gameplay motion is always 60.

### Rules

- Startup must be readable as anticipation: a move with 4 startup frames still shows 2 frames of pull-back.
- Nothing moves during active frames except smear decay. The pose a hitbox is active in is the pose on screen.
- Recovery is where the comedy lives: overshoot, wobble, the lid landing late.
- Movement cycles: floating feet travel in circles; Nesta rocks; Grog gallops with front and back pairs out of phase. Each cycle hits a contact pose on the frame a footstep sound plays.

---

## 4.8 UI and typography

**Style:** an auction catalogue. Paper, ink, one blue, one red stamp, a little gold. Every panel could be printed. The CSS is real and is in `concept_art/src/base.css`: use it.

### Type

| Face | Licence | Use | Settings |
|---|---|---|---|
| **Fraunces** (variable) | OFL 1.1 | Titles, names, damage numbers, buttons | Weight 900, `SOFT 100`, `WONK 1`, optical size 144 for display; weight 700, optical size 30 for buttons |
| **Instrument Sans** (variable) | OFL 1.1 | Body text, table text | 400 and 600 |
| **Courier Prime** | OFL 1.1 | Labels, lot numbers, key hints, frame data, diagnostics | 400 and 700; labels are upper case, 11 px, tracked 0.12 em |

Self-host the three woff2 files. Total about 130 KB. No font CDN.

Fraunces is soft and slightly wonky, which is the glaze. Courier Prime is the typed lot ticket. Instrument Sans stays out of the way.

### Components

- **Lot tag** (the HUD unit): a manila tag with a punched hole, 168 by 76 px at 720p. Lot disc in the player's colour, short name in typewriter capitals, percent in Fraunces 900 at 36 px, stock pips shaped like little figures, a gold seam along the bottom edge for Gilt. The held gadget is a token clipped to the top-right corner with uses left. Above 100 percent the number turns stamp red. The tag of a fighter being launched tilts.
- **Plaque:** paper card with a double rule, hard drop shadow, for titles over the 3D scene.
- **Button:** a pill with a 2 px ink border and a hard 3 px shadow. Primary is cobalt. No gradients.
- **Chip:** small pill for settings. Filled ink when on.
- **Key cap:** white, ink border, thicker bottom edge.
- **Stamp:** stamp red, 5 px border, rotated −9 degrees, multiply blend. Used once per screen at most.
- **Backstamp:** the logo. A round maker's mark in cobalt: "THE MANTEL POTTERY" above, "FINE BONE OF CONTENTION" below, horns and B·B in the middle.

### HUD layout (`ui_hud.png`)

| Region | Contents |
|---|---|
| Bottom centre | Lot tags in slot order, 14 px apart. With 7 or 8 players they shrink to 148 px. Eliminated tags grey out and drop 12 px. |
| Top centre | Timer in a plaque with the arena name, and under it the island strip: one pip per chunk, white intact, mustard crazed, red falling, dashed gone. It is the round's progress bar. |
| Top right | The last two exits: "Lot 8 gone · Bellows (Lot 3)". Fades after 5 seconds. |
| Top left | Teaspoons present and the next tap. Only when someone is out. |
| Centre | Auctioneer lines, Fraunces italic, 2 seconds: "Lot seven.", "Going...", "Gone.", "Withdrawn.", "Last call.", "Sold!" |
| Edges | Off-screen bubbles. |

Nothing is drawn over the middle 60 percent of the screen except auctioneer lines. No health bars over heads. A small lot number floats above a fighter only for the first 3 seconds of a round and after a respawn.

### Screens

`ui_title.png`, `ui_lobby.png`, `ui_charselect.png`, `ui_results.png`, `ui_connection_error.png`, `discord_preview.png`. Rules they share: the 3D scene is always live behind the UI; one primary button per screen; every screen can be left with Escape; no screen has more than two levels.

---

## 4.9 Asset rules and the review loop

### Naming

`CHR_<fighter>_<part>` · `GAD_<id>` · `ARENA_<arena>_<chunkId>` · `PROP_<name>` · `ENV_<name>` · `FX_<name>`. Files: `assets/chr/earl.glb`, `assets/gad/bellows.glb`, `assets/arena/willow.glb`. One glTF per fighter, gadget and arena.

### Export

Blender's glTF exporter, binary `.glb`, +Y up, apply modifiers, meshopt compression on, no materials (the game supplies the one material), `COLOR_0` as described, one joint per rigid part with weight 1.0. A sidecar `<asset>.json` records triangle count, bounding box, palette slots used, generator script and its git hash.

### The art lint (runs on every asset, fails the build)

| # | Check | Threshold |
|---|---|---|
| 1 | Triangle and bone budgets | Table in 4.3 |
| 2 | Palette | Every slot used is declared for that asset in `palette.json` |
| 3 | Materials and textures | Exactly one material; no textures; no emissive |
| 4 | Thrown test | Under 8 percent of faces are axis-aligned coplanar quads; no mesh whose vertex count matches an unmodified Blender primitive |
| 5 | Wobble present | Radial variance of each lathe ring above 0.5 percent |
| 6 | Silhouette distinctness | Pairwise overlap under 0.60 at 64 px |
| 7 | Neon check on the preview render | Under 0.5 percent of pixels with saturation above 0.85 and value above 0.9 |
| 8 | World saturation | World assets: mean saturation of the preview under 0.35 |
| 9 | Value | Fighter preview on the mid-sky colour: mean luminance at least 0.18 away from the background |
| 10 | Provenance | A generator script exists for the file; the glTF generator string is Blender's; no file name or string matches the banned pack list |
| 11 | Shader parity | Test sphere difference under 6 of 255 |

### The review loop

1. The script builds the asset and exports it.
2. The lint runs. A failure stops here.
3. The script renders a contact sheet with the engine-look material: front, side, in-game angle, black silhouette, and all eight liveries for fighters. About 30 seconds.
4. The contact sheet is compared against the matching sheet in `concept_art/png/`. For fighters and gadgets, the reference sheets in this package are the bar: the asset must be at least that good.
5. The contact sheets are attached to the milestone evidence. A person looks at them at the M4 gate. An agent cannot judge charm; this is the one place a human is in the loop for art.

### Banned, with the test that catches it

| Banned | Caught by |
|---|---|
| Neon, glow, synthwave, cyberpunk | Lint 3 (no emissive), lint 7, no bloom in the post stack |
| Voxels, blocks, cube-and-primitive geometry | Lint 4, lint 5 |
| Kenney, Quaternius, KayKit, Synty, Mixamo, chibi packs and look-alikes | Lint 10; every asset must have a generator script in the repository |
| Generic game-jam look | The potter's rules, the palette rules, and the human gate |
