# 9. Asset production plan

Every asset the game needs, with when it is needed and what it may cost. "Tris" is the triangle ceiling; "KB" is the shipped size after optimisation, before gzip. Milestones: M3 grey-box, M4 art, M5 polish. Reference versions marked ✔ exist in `reference/blender/` and set the bar: improve them, do not restart them.

## 9.1 Download budget

| Group | Contents | Budget (gzip) | Basis |
|---|---|---|---|
| Code | three 160, Rapier 1,300, Trystero 53, msgpackr 12, interpolation 2, the game 180 | 1.7 MB | Measured, except the game itself |
| Lobby pack | 4 fighters, saucer and props, matcap, 3 fonts, lobby sounds, 4 thumbnails | 0.6 MB | Fighters measured at about 50 KB gzip each |
| **First playable** | **Code plus lobby pack** | **2.5 MB ceiling** | |
| Arenas | 3 arenas with dressing | 0.4 MB | |
| Gadgets and props | 9 gadgets, parcel, plate, spoon, rubble, shards | 0.15 MB | |
| Audio | Sprite and music stems | 1.0 MB | |
| **Everything** | | **5 MB ceiling; 3.9 MB planned** | |

The build fails above either ceiling.

## 9.2 Fighters

| Asset | Count | Tris | KB | Needed | Reference | Notes |
|---|---|---|---|---|---|---|
| Grey-box fighter: a capsule with two spheres for hands | 1 | 300 | 5 | M3 | — | Coloured by livery. Good enough to be fun |
| EARL mesh | 1 | 6,500 | 95 | M4 | ✔ 5,468 tris, 84 KB | 6 rigid parts |
| GROG mesh | 1 | 6,500 | 95 | M4 | ✔ 6,220 tris, 96 KB | 6 rigid parts |
| NESTA mesh (one mesh, three scales) | 1 | 6,500 | 95 | M4 | ✔ 5,120 tris, 90 KB | 3 rigid parts |
| NESTA empty shell, top and bottom halves | 2 | 1,500 each | 30 | M4 | Partly: `shell_only` flag | Built from the same profile, open at the seam |
| MOSS mesh | 1 | 6,500 | 95 | M4 | ✔ 4,876 tris, 79 KB | 7 rigid parts including the rod |
| LOD1 of each fighter | 4 | 3,000 | 45 | M5 | Same scripts, fewer segments | Low tier only |
| Pose tables | 25 or 26 moves each, 102 in total | — | 15 total | M3 (timing), M4 (poses) | 4 signature poses on the sheets | Data in `data/poses/*.json`, built from the 8 archetypes |
| Movement cycles: idle, run, jump, fall, land, tumble, ledge hang, guard, stunned, taunt, win, lose | 4 x 12 | — | in the above | M3 (5 of them), M4 | — | |
| Catalogue thumbnails, 256 px and 512 px, engine-look render | 4 x 2 | — | 30 each | M4 | ✔ `*_game.png` | |
| Stock pip silhouettes, SVG | 4 | — | 1 each | M4 | From `*_side.png` | |

## 9.3 Gadgets and small props

| Asset | Tris | KB | Needed | Reference |
|---|---|---|---|---|
| Grey-box gadget: a labelled box | 12 | 1 | M3 | — |
| The Bellows | 800 | 12 | M4 | ✔ 652 |
| Plunger-on-a-String (head and handle; the string is a runtime line) | 800 | 12 | M4 | ✔ 420 |
| The Vintage (bottle; separate cork projectile, 100 tris) | 800 | 14 | M4 | ✔ 736 |
| Pepper Mill | 800 | 12 | M4 | ✔ 700 |
| Pop-Up Toaster (body; toast is a separate part that jumps) | 800 | 10 | M4 | ✔ 244 |
| Jam Jar (and a flat puddle mesh, 60 tris) | 800 | 12 | M4 | ✔ 608 |
| Egg Timer | 800 | 12 | M4 | ✔ 528 |
| The Hoover | 800 | 14 | M5 | ✔ 766 |
| Horseshoe Magnet | 800 | 8 | M5 | ✔ 228 |
| Parcel with doily | 500 | 10 | M3 (box), M4 | ✔ |
| Guard side plate, in 3 crack stages (shader, one mesh) | 500 | 8 | M3 (disc), M4 | ✔ |
| Teaspoon | 400 | 6 | M3 (stick), M4 | ✔ |
| Rubble, 3 shapes | 60 each | 3 | M3 | — |
| Cosmetic shards, 6 shapes | 16 each | 2 | M3 | ✔ generator |
| Moss's hook, bobber, sinker, old boot, the fish | 80 to 300 | 10 total | M4 | Bobber ✔ |
| Earl's steam ring; dust puffs, 3 shapes | 120 each | 5 total | M3 | ✔ cloud generator |
| Gadget HUD icons, 64 px renders | 9 | — | 3 each | M4 | ✔ `gadget_*.png` |

## 9.4 Arenas and environment

| Asset | Tris | KB | Needed | Reference |
|---|---|---|---|---|
| Grey-box arena: chunk polygons extruded flat, three greys by state | per data | 5 | M2 (colliders), M3 | — |
| The Willow Plate: 12 chunks with lips and bands | 300 each | 60 | M4 | ✔ generated from data |
| Willow dressing: pagoda, bridge, willow | 9,000 | 70 | M4 | ✔ |
| Willow top-surface pattern: a painted ring of bands and three motifs as geometry-thin decals | 1,500 | 12 | M5 | Missing; see critique |
| High Tea: 16 chunks | 300 each | 60 | M4 | ✔ |
| High Tea dressing: stem, 2 cups, background teapot, pour stream | 8,000 | 60 | M4 | ✔ (stream is weak) |
| The Mended Bowl: 8 chunks, gold seams | 300 each, seams 1,200 | 50 | M4 | ✔ |
| Mended Bowl dressing: 3 floating shards, updraft wisps | 1,500 | 15 | M4 | ✔ (wisps are weak) |
| The Saucer (lobby): saucer, ready platter, dummy vase, catalogue stand | 5,000 | 40 | M3 (flat), M4 | ✔ |
| Clouds, 3 shapes | 400 each | 8 | M4 | ✔ generator |
| Sky dome | 2 tris, shader | — | M3 | ✔ gradient values |
| Dust motes | instanced quads | — | M5 | — |
| Packed matcap, 256 px | — | 51 | M3 | ✔ |

## 9.5 VFX (no files: code and shaders)

| Effect | Needed | Budget |
|---|---|---|
| Glaze shader with speckle, cracks, gilt, flash, invulnerable-matte | M3 (flat colour), M4 | One program, two variants |
| Blob shadows | M3 | 1 instanced draw |
| Chips, shards, dust puffs | M3 | 300 and 250 instances on High |
| Brushstroke launch trail | M3 (plain ribbon), M4 | 8 ribbons of 16 segments |
| Impact frame | M3 | In the finish pass |
| Hit-stop shake, camera kick and shake | M3 | — |
| KO burst and screen-edge cracks with gold fill | M4 | 2D canvas overlay, 40 line segments |
| Gust puffs, steam, pepper cloud, jam puddle | M4 | Reuse puffs |
| Chunk crack escalation, chunk drop wobble | M3 (colour change), M4 | Shader uniform per chunk |
| Parcel descent, doily sway | M4 | — |
| Egg Timer ghost (the fighter mesh, matte, 30 percent) | M4 | 1 extra draw per timer |
| Updraft wisps, pour stream, seesaw | M4 | — |
| Off-screen bubbles | M3 | DOM, 8 at most |

## 9.6 UI

| Asset | Needed | Notes |
|---|---|---|
| `base.css` and the six screens | M3 (unstyled), M5 | ✔ real markup in `concept_art/src/` |
| Fonts: Fraunces, Instrument Sans, Courier Prime (woff2, Latin subset) | M3 | ✔ in `concept_art/src/fonts/`, OFL 1.1 |
| Backstamp logo, SVG; favicon from it | M5 | ✔ inline SVG in the mock-ups |
| Lot tag, plaque, button, chip, key cap, stamp | M3 (tag), M5 | ✔ CSS |
| Gamepad glyphs: A, B, X, Y, bumpers, triggers, sticks, d-pad, back | M5 | Draw as 12 simple SVGs in the key-cap style. Do not use a glyph pack |
| Connectivity map | M5 | Generated SVG, as in the mock-up |
| Link preview `og.png`, 1200 by 630 | M5 | ✔ `discord_preview.png` (replace the render when art improves) |
| KO photo template: frame, caption, stamp | M5 | ✔ layout in `ui_results` |
| Frame-data overlay for practice | M3 | A table from `data/fighters.json`, Courier Prime |
| Word lists: 3 x 64 for room codes, 64 lot names, 8 quick phrases | M1 (codes), M5 | To write. Ceramic and auction vocabulary; nothing that reads badly in any combination |

## 9.7 Audio

All from 6.4. Counts: movement 11, hits and defence 15, fighters 13, gadgets 21, island 10, interface 13, auctioneer 12 lines, music 3 stems, clock 2. About 100 entries, 45 seconds of effects.

| Batch | Needed | Contents |
|---|---|---|
| Grey-box set | M3 | The 22 priority-1 sounds. Placeholder synthesis is acceptable |
| Full set | M5 | Everything, the three music stems, the auctioneer |
| Audio reel for review | M5 | 60 seconds, generated |

## 9.8 Data

| File | Status |
|---|---|
| `data/tuning.json`, `fighters.json`, `gadgets.json`, `arenas.json`, `palette.json` | ✔ generated by `tools/design_data.py` |
| `data/poses/*.json` | To make (M3 timing, M4 poses) |
| `data/hitboxes/*.json`: capsules per move per active frame, in fighter space | To make (M2). Derive reach from the notes in the move tables; a jab is one capsule on the hand |
| `data/strings.json` | To make (M5). All player-facing text in one file |
| `assets.manifest.json`, `LICENSES.json` | Generated by the asset build |

## 9.9 Order of production

1. Matcap, shader, one fighter (Earl) end to end, with parity test and contact sheet. This proves the pipeline.
2. The other three fighters.
3. The Willow Plate with dressing.
4. Tier A and B gadgets, parcel, plate, spoon.
5. High Tea, The Mended Bowl, the lobby.
6. Tier C gadgets, LOD1, the Willow pattern, motes.

Stop after any step and the game still looks finished up to that point.
