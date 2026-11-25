# 5. Concept art and mock-ups: index and critique

Every piece is in `concept_art/png/`. Sources (real HTML and CSS, and the renders they use) are in `concept_art/src/`. The 3D pieces are rendered by the scripts in `reference/blender/` with the engine-look material: packed matcap, no lights, CPU only. They are what the game can actually look like, not paintings of what it might.

Each piece is judged against the art bible. Verdicts: **Pass** (meets the bar; match it), **Pass with notes** (direction is right; the notes are work for M4 or M5), **Below bar** (kept as direction only; do not copy the flaw).

## What was thrown away

| Piece | What was wrong | Rule it broke | What changed |
|---|---|---|---|
| Style frame, version 1 | Bone-white fighters disappeared against bright white clouds. A solid cobalt willow tree and cobalt pagoda roofs competed with the cobalt player. Crazing looked like a dark mosaic over the whole chunk, sides included. Clouds were large, glossy and directly behind the fight. The underside of the island was a third of the screen in saturated orange. | Colour rules 1 and 5 | Sky lowered to 60 to 75 percent value. Clouds made matte, smaller, fewer, and moved out of the middle. World blue became a 32 percent wash. Crazing thinned, enlarged, and limited to glazed tops. Underside changed to a 29 percent saturation clay. |
| Style frame, version 2 | The launch trail crossed the willow tree; the two fights overlapped on the bridge. Grog pitched nose-up and appeared to float. A celadon far island read as a flying saucer. | Readability | Restaged so each exchange has clear sky behind it. Far island removed. Camera raised so less underside shows. |
| Fighter palette, version 1 | Grog's body was iron red, so an oxblood livery vanished on him. Earl and Nesta had fixed cobalt trim under any livery. Moss had a fixed green belt and a red float. | Colour rule 2 | Bodies restricted to neutrals. Grog became black basalt. All trim follows the livery. Belt is ink. |
| Grog, version 1 | Ink eyes on a black head: no face. | Readability | Bone eye-whites, gilded brows. |
| Nesta, versions 1 and 2 | Failed the silhouette gate against Earl: overlap 0.63, then 0.60, against a limit of 0.60. She was a blob beside a blob, and had no pulled feature. | Shape rule 4, silhouette test | Slimmer pin, narrower waist, pointed kerchief, a knot with two tails behind her head. Overlap now 0.54. |
| The Bellows, version 1 | Seen side-on it was a red disc with sticks. | Silhouette | Rebuilt as a sideways V: two boards hinged at the nozzle, pleats between. |
| Key art, version 1 | Grog hovered 0.6 u above the chunk he was supposed to be charging off. The title plaque covered Nesta and Moss. | — | Grog planted on the tilting chunk, Earl on his horns. Plaque moved to the empty sky at the right. |
| Fighter meshes, version 1 | 7,100 to 8,800 triangles. | Budget | Lathe segments and subdivisions reduced: 4,900 to 6,200. |
| Architecture diagram, version 1 | Text overflowed two boxes; arrow labels sat on top of boxes. | — | Re-laid with a wider channel between host and client. |

## Silhouette gate, measured

Side views, each scaled to 64 px tall and centred; overlap is intersection over union. Limit 0.60. Numbers in `reference/blender/out/silhouette_iou.json`.

| Pair | Overlap | |
|---|---|---|
| Earl and Grog | 0.58 | Passes, narrowly. Do not make Earl wider or Grog rounder |
| Earl and Nesta | 0.54 | Passes after the redesign (was 0.63) |
| Grog and Nesta | 0.45 | |
| Earl and Moss | 0.26 | |
| Grog and Moss | 0.26 | |
| Nesta and Moss | 0.15 | |

At the in-game 42 degree angle the first two pairs are closer than this. Livery placement and motion have to carry the difference there; the cure if it proves a problem in play is to give Earl a taller lid finial.

## The pieces

### Key art: `key_art.png` (clean render: `key_art_render_clean.png`)
**Pass with notes.** It sells the game: a bull charging off a breaking plate with a teapot on his horns, a gnome fishing above it as if nothing were happening. The catalogue plaque and backstamp establish the identity in one glance.
- Earl is facing away and upside down, so the joke that he is not enjoying this is lost. He should face the camera.
- Moss's line ends in nothing. The design says he has caught a boot. Model the boot.
- The bridge is cropped to a meaningless white post at the left edge.
- Willow strands are stiff tubes with beads. They need a second curve and uneven lengths.
- Only about 35 shards. A break this size wants 60, with three or four large ones.

### Link preview: `discord_preview.png`, shown at real size in `discord_embed_mock.png`
**Pass with notes.** At 1200 px it works. At the 488 px a chat client shows, the wordmark holds but the tagline and the "2 to 8 players" strip are too small to read.
- For M5: wordmark 25 percent larger, drop the tagline from the image (it is already in the description text), and make the strip two words: "Click to join".

### Character sheets: `sheet_earl.png`, `sheet_grog.png`, `sheet_nesta.png`, `sheet_moss.png`
**Earl: Pass.** The strongest of the four. Reads as a teapot and as a person at once; the spout-as-nose solves facing. The monocle is the right amount of detail.

**Grog: Pass.** Black basalt with a livery blanket is the best colour read on the roster. Note: in the Stampede pose the hooves look scattered, not galloping. Front and back pairs need to be visibly out of phase.

**Nesta: Pass with notes.** After the redesign she is a pin with a knot. Her face is still small at the in-game angle, and at 56 px she is the least nameable of the four. The three sizes read well side by side. If M3 testers lose track of her, enlarge the face disc by 15 percent before anything else.

**Moss: Pass with notes.** The hat does all the work, as intended. Notes: the rod and line are too thin to survive 56 px (thicken the rod by half, give the float a white cap); the terracotta coat sits close to the tangerine livery, so shift the coat 10 percent toward ash.

All four: the faces are painted on and do not animate, by design. That is only acceptable if the expressive part (lid, head, wobble, hat) moves as the sheets describe. Nothing in this package proves that yet.

### Silhouettes: `sheet_silhouettes.png`
**Pass.** Circle, bar, pin, triangle. See the measured table above.

### Gadgets: `sheet_gadgets.png`
**Pass with notes.** The Vintage, the Magnet, the Plunger and the Jam Jar read instantly. 
- The Hoover reads as a jug. It needs a ribbed hose and a visibly cloth bag.
- The Pepper Mill is one dark mass; make the body mid-brown with a steel band so the waist shows.
- The Toaster is acceptable but is the most primitive-looking object in the set: soften the profile and add a lever slot.
- Nothing here has been checked for size in a fighter's hand.

### Arena views: `arena_view_willow.png`, `arena_view_high_tea.png`, `arena_view_mended_bowl.png`, `arena_view_lobby_saucer.png`
**The Willow Plate: Pass with notes.** The platter with its lip and band is exactly right and comes straight from the gameplay data. The top surface is blank white: a willow plate needs its pattern. Add a painted ring and two or three motifs as thin decals (M5; on the cut list). The pagoda is plain.

**High Tea: Below bar in two places.** The stand, cups and background teapot are right, and the silhouette of the arena is the best of the three. But the pour is a brown stick: it needs to be translucent, to widen as it falls, and to splash. And the tiers are so thin that crazing and seams will not show: thicken them to 0.9 u at the rim.

**The Mended Bowl: Below bar in one place.** Dark outside, pale inside, gold seams where it will break: the idea reads immediately and the seams are the best single detail in the package. The updraft wisps read as scratches on the lens. Replace them with rising matte puffs and a few embers of bisque dust.

**The Saucer: Pass.** Plain, as a lobby should be.

### Layout maps: `map_willow.png`, `map_high_tea.png`, `map_mended_bowl.png`
**Pass.** Generated from `data/arenas.json`, so they are correct by construction. Spawn markers overlap platform labels in places.

### In-game style frame: `ui_hud.png` (without HUD: `style_frame_ingame_clean.png`)
**Pass with notes.** This is the bar for M4. Six fighters in six colours are each findable in under a second; the launched fighter and his trail read first; the cracked rim reads as "that is about to go".
- The launch trail is a stiff ribbon. The bible asks for a dry brushstroke: taper, broken edges, two bristle streaks that separate.
- Crazing is too regular: the cells are nearly hexagonal. Jitter the cell points and vary line weight.
- Only blob shadows ground the fighters. Baked contact darkening on the chunk tops is missing from the reference.
- Grog's raised front hooves read as tucked under him.
- No dust motes, no chips in flight near the guard clash. The frame is cleaner than the game should be.

### HUD: in `ui_hud.png`
**Pass with notes.** Lot tags read as objects from the same world. The island strip under the timer is the most useful small idea in the UI.
- Names truncate at 12 characters. Either shorten lot names or scroll them.
- Eight tags at 168 px do not fit 1280 px. The 148 px variant is specified but not drawn.
- The off-screen bubble is specified and styled but does not appear in this frame.

### Title, lobby, character select, results, connection error: `ui_*.png`
**Title: Pass.** One button, the game already visible behind it.

**Lobby: Pass with notes.** Five panels are on screen at once. Fold the mode chips into the room card.

**Character select: Pass.** The catalogue spread is the identity at its clearest. Taken colours need a stronger mark than fading.

**Results: Pass.** The blue-and-white photo with the red stamp is the screenshot moment and it works. The "for the record" column is where the game's voice lives; it needs 40 or so lines written.

**Connection error: Pass.** The map of who reaches whom turns a dead end into one button. The "You" label collides with a line.

### Palette: `palette.png`. Architecture: `architecture.png`
**Pass.** Both generated; both match the data.

## What this package does not prove

Said plainly, so nobody assumes otherwise:

1. **Nothing here moves.** Pose timing, springs, squash, boil, the trail in motion, the impact frame at speed: all specified, none demonstrated. Animation is the largest untested risk in the art direction.
2. **Nothing here makes a sound.**
3. **The engine-look renders are Blender evaluating the game's shading formula, not the game.** The GLSL does not exist yet. The parity test in the art bible exists to close that gap.
4. **Ambient occlusion in the renders is ray-traced at preview time.** In the game it must be baked to vertices or approximated. Expect contact areas to look flatter until that is solved.
5. **No painted pattern.** Bands and large shapes only. If the game needs florals or willow pattern, that is new work.
6. **The reference fighters are a floor, not a ceiling.** They were made in one sitting by script. A second pass by the team should beat them.
