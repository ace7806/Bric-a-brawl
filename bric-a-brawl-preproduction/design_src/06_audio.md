# 6. Audio direction

## 6.1 Direction

**The sound of a kitchen cupboard having a disagreement.** Everything is small, hard and close: clinks, clacks, pops, squeaks, a spoon on a cup. Dry, as if recorded on a table in a quiet room. No whooshes of energy, no synth zaps, no bass drops, no chiptune. If the art is glaze, the audio is the noise glaze makes when you set it down too hard.

Three signatures the game should be recognisable by with the screen off:

1. **The parry ring.** A struck bowl: a clean, long, slightly out-of-tune ring, 1.2 seconds. The only long sound in combat. Everyone in the call learns it in one evening.
2. **The auctioneer.** He does not speak words. He is a muted-trombone "wah" voice, the way adults sound in old cartoons, with the line on screen as text and a gavel knock at the end. Each line has its own rhythm and pitch shape, so "Going..." and "Gone." are distinguishable by ear. This needs no speech synthesis, no voice licence and no actor, and it is funnier.
3. **The smash.** A KO is a plate hitting a kitchen floor.

**Music** is a small band playing the tea service: tuned cups and bowls, a plucked bass, brushes, a music box. Light, a little smug, in swing time.

| Where | What plays |
|---|---|
| Lobby and menus | No music. A mantel clock ticking at 60 a minute, room tone, the occasional settle of the house. It is the Mantel; it should sound like one. |
| Round | "Tea Service", a 16-bar loop at 132 beats a minute, in D Dorian. Layer A (music box and bass) from the countdown; layer B (cup ostinato and brushes) from the first hit. |
| Last call | The clock chimes once. Layer C enters: the cup pattern in double time. |
| Sudden death | The whole mix speeds up to 1.12 times, pitch and all. |
| Results | Music stops on the freeze. Auction-room murmur, the gavel, then the clock again. |

## 6.2 How it is made

Everything is generated on the VM by scripts, deterministically, from recipes in `assets-src/audio/recipes.json`. There are no recordings in the default plan.

| Family | Method | Tools |
|---|---|---|
| Ceramic impacts (clink, clack, ring, tick) | **Modal synthesis:** a sum of 5 to 8 decaying sine partials at inharmonic ratios, plus a 3 ms noise click. A cup, a bowl, a plate and a tile are four ratio sets. Pitch, decay and brightness are parameters. | Python, numpy |
| Shatter and crumble | 12 to 40 small ceramic impacts scattered over 150 to 600 ms with random pitch, over a band-passed noise burst | numpy |
| Air (puff, snort, steam, whistle, gust) | Filtered noise with an envelope; whistles add a sine with vibrato | numpy, SoX filters |
| Rubber, cork, squeak, boing | Short FM tones with a pitch sweep | numpy |
| Plucked bass, music box | Karplus-Strong string; music box is modal with a bright strike | numpy |
| The auctioneer | Sawtooth through two moving band-pass filters (a "wah"), pitch contour from a per-line table, 90 to 160 Hz | numpy |
| Gavel, clock, toaster ding | Modal: wood block ratios; a small bell | numpy |
| Mix-down | Trim, normalise per family, concatenate into one sprite with a JSON map of offsets | SoX, ffmpeg |

Format: one sprite, shipped twice, Opus in WebM at 64 kbit/s and AAC in M4A at 96 kbit/s, chosen with `canPlayType`. About 45 seconds of sound effects and a 29-second music loop in three stems: 600 KB to 1 MB in total. Playback is Web Audio through three.js's `Audio`: one buffer, started at an offset.

**jsfxr-style generators are not used.** Their vocabulary is retro bleeps, which is the wrong material.

**The fallback, because the agent cannot hear.** If the human review at M5 rejects the synthesised ceramic, the twelve sounds marked ★ below may be replaced by CC0 recordings from OpenGameArt (CC0 only, downloaded without an account, each listed in `LICENSES.json` with URL and hash). Nothing else may come from a library, and nothing from any asset pack on the banned list.

**Checks a machine can make** (all in the build):

- Every sound in the list exists in the sprite map and is within 20 percent of its target length.
- Peak under −1 dBFS. Integrated loudness: effects −16 LUFS ± 2 per family, music −20, auctioneer −14.
- Spectral centroid inside the family's band (ceramic 2 to 6 kHz, air 0.8 to 3 kHz, wood 0.4 to 1.5 kHz). This catches a recipe that produced a hum.
- The music loop's first and last 50 ms correlate above 0.9 (no click at the seam).
- No sound is silent, clipped or longer than 2.5 s except the loop.

**What a person checks:** a 60-second reel, generated at M5, that plays every family in context. Five minutes of Ace's time.

## 6.3 Mix

- Four buses: effects, music, auctioneer, UI. Music ducks 6 dB under the auctioneer and 3 dB under any KO.
- At most 24 voices at once; at most 3 instances of the same sound; the quietest is stolen.
- Every play is detuned by up to ±4 percent and panned by screen position up to ±0.6.
- Each fighter's hits are pitched by weight: Grog a fourth lower, Small Nesta a fifth higher.
- A tiny synthetic room (a 250 ms noise-decay impulse) on the effects bus at 12 percent. No other reverb.
- Volume sliders for music, effects and auctioneer. Sound starts muted until the first key press, as browsers require; the clock tick is the first thing heard.

## 6.4 Sound list

Priority: 1 ships with the grey-box (M3), 2 with art (M4), 3 with polish (M5). Lengths are targets.

### Movement

| Id | Trigger | Feel | Recipe | Len | Pri |
|---|---|---|---|---|---|
| `step_china` ★ | Earl, Nesta footfalls and wobbles | A cup set on a saucer, quietly | Cup modal, high, short | 60 ms | 1 |
| `step_stone` | Grog hooves | Duller, lower clop | Tile modal, low | 80 ms | 1 |
| `step_clay` | Moss boots | Soft terracotta tap | Tile modal, damped | 70 ms | 2 |
| `jump` | Jump squat release | A small upward "pip" | FM blip rising a fifth | 90 ms | 1 |
| `double_jump` | Second jump | The same, thinner, with a puff | Blip plus noise | 110 ms | 1 |
| `land` | Landing | Clack with weight; scaled by fall speed | Plate modal plus thud | 120 ms | 1 |
| `dash` | Initial dash | A quick scuff | Noise sweep | 100 ms | 2 |
| `roll` | Roll, Nesta's Skittle | Ceramic trundling on a table | Looped cup rattle | 300 ms loop | 2 |
| `airdodge` | Air dodge | A dry "fft" | Noise, band-passed | 90 ms | 2 |
| `ledge_grab` | Ledge grab | Two taps: hands on a rim | Two cup ticks | 120 ms | 2 |
| `walljump` | Wall jump | Tap and pip | Tick plus blip | 100 ms | 3 |

### Hits and defence

| Id | Trigger | Feel | Recipe | Len | Pri |
|---|---|---|---|---|---|
| `hit_light` ★ | Under 6% | Tick: a spoon on a cup | Cup modal | 70 ms | 1 |
| `hit_mid` ★ | 6 to 12% | Clack: two plates meeting | Plate modal, 2 strikes 8 ms apart | 110 ms | 1 |
| `hit_heavy` ★ | Above 12% | Crack: something chipped | Plate modal plus short shatter | 220 ms | 1 |
| `guard` ★ | Blocked hit | A dull knock on a plate held in the hand | Plate modal, heavily damped | 90 ms | 1 |
| `guard_crack` | Guard HP under a third | The same with a hairline creak | Add a 40 ms creak | 140 ms | 2 |
| `guard_break` ★ | Guard break | A side plate snapping in two | Shatter, 12 pieces, 200 ms | 350 ms | 1 |
| `parry` ★ | Parry | The struck bowl. Clean, long, proud | Bowl modal, 8 partials, slow decay | 1.2 s | 1 |
| `grab` | Grab connects | A firm ceramic clasp | Two damped clacks | 100 ms | 2 |
| `throw` | Throw release | Short effortful swish | Noise sweep | 150 ms | 2 |
| `launch_whistle` | Launch above 20 u/s | A rising slide whistle, pitch set by speed, cut off at KO or landing | Sine with vibrato, pitch glide | up to 1.5 s | 1 |
| `bounce` | Tumble hits terrain | Clonk and a rattle | Plate modal plus 3 ticks | 200 ms | 2 |
| `tech` | Successful tech | A neat single tap | Cup tick, high | 60 ms | 3 |
| `gilt_full` | Gilt reaches 100 | A small bright chime | Bell modal | 400 ms | 2 |
| `gilt_break` | Gilt Break | Bowl ring with a burst of air | Bowl plus noise | 600 ms | 2 |
| `ko_smash` ★ | Fighter crosses the blast zone | A plate hitting a kitchen floor | Shatter, 40 pieces, 600 ms, wide | 900 ms | 1 |

### Fighters

| Id | Trigger | Feel | Len | Pri |
|---|---|---|---|---|
| `earl_lid` | Idle tic, annoyed, hit reaction | Lid rattling on a pot: 3 to 6 quick ticks | 250 ms | 2 |
| `earl_puff` | Steam Puff | A soft "pfff" | 300 ms | 1 |
| `earl_whistle` | Piping stored, Whistle Blast | A kettle coming to the boil | 700 ms | 2 |
| `earl_pop` | Lid Pop | Pressure release and a lid clink | 250 ms | 1 |
| `grog_snort` | Snort, idle | A short nasal blast | 250 ms | 1 |
| `grog_charge` | Stampede, looped | Four hooves on stone, accelerating | loop | 1 |
| `grog_stamp` | Stamp, Quake Stomp | A heavy stone thud with rubble | 400 ms | 1 |
| `nesta_pop` | Shed, Pop Top | A cork-like "pok" and a hollow knock | 200 ms | 1 |
| `nesta_spin` | Whirligig, looped | A top spinning on a table | loop | 2 |
| `nesta_shell` | Shell struck | A hollow wooden-ceramic bonk | 150 ms | 2 |
| `moss_cast` | Cast, Tether Cast | A rod whip and line hiss | 250 ms | 1 |
| `moss_reel` | Reeling, looped | A small ratchet | loop | 1 |
| `moss_plop` | Bobber lands, Gone Fishin' catch | A drip in a cup | 150 ms | 2 |

### Gadgets

| Id | Trigger | Feel | Len | Pri |
|---|---|---|---|---|
| `bellows` ★ | Fire | A leathery wheeze out | 300 ms | 1 |
| `plunger_fire`, `plunger_stick`, `plunger_yank` | Fire, hit, yank | Thwip; a wet "thop"; a stretch and snap | 150, 120, 300 ms | 1 |
| `cork_shake`, `cork_pop` ★ | Charging, fire | Fizz rising in pitch; the pop | loop, 250 ms | 1 |
| `pepper_grind`, `sneeze_build`, `sneeze` | Use, in the cloud, launch | A mill turning; "ah... ah..." as two rising squeaks; a tiny explosive "choo" | 400, 600, 200 ms | 2 |
| `toaster_tick`, `toaster_ding` | Armed, pop | A clockwork tick for 36 frames; a bright ding and a spring | loop, 500 ms | 2 |
| `jam_splat`, `jam_step` | Lands, fighter moves in it | A thick splat; a sticky pull | 250, 150 ms | 2 |
| `timer_tick`, `timer_rewind` | Ghost present, use | A fast kitchen-timer tick; a ratchet zip and a ding | loop, 350 ms | 2 |
| `hoover_on`, `hoover_bag`, `hoover_spit` | Hold, capture, fire | A small motor whine; a muffled thump; "thoomp" | loop, 150, 250 ms | 3 |
| `magnet_hum`, `magnet_fire` | Attract, repel | A low hum with clattering crockery; all of it leaving at once | loop, 400 ms | 3 |
| `parcel_land`, `gadget_take`, `gadget_empty` | Parcel lands, pickup, out of uses | A paper thump; a neat click; a hollow click | 150, 80, 80 ms | 1 |

### The island

| Id | Trigger | Feel | Len | Pri |
|---|---|---|---|---|
| `craze` | Chunk becomes crazed | Ice-on-a-pond creaking, rising | 1.5 s | 1 |
| `craze_tick` | While crazed | An occasional tiny tick | 40 ms | 2 |
| `chunk_break` ★ | Chunk goes loose | A deep, single crack | 400 ms | 1 |
| `chunk_fall` | Chunk falling | A descending air sound, then nothing | 800 ms | 2 |
| `rubble` | Rubble impact | A pebble on a plate | 80 ms | 1 |
| `spoon_tink` ★ | Teaspoon tap | One clear tap on the rim of a cup. Everyone hears it | 200 ms | 1 |
| `pour_whistle`, `pour` | High Tea hazard warning, active | A kettle whistle; liquid falling into china | 1.5 s, loop | 2 |
| `split` | The Mended Bowl splits | A long tearing crack and a low boom | 1.5 s | 2 |
| `updraft` | In the gap, looped | Warm air, a low breath | loop | 3 |

### Interface

| Id | Trigger | Feel | Len | Pri |
|---|---|---|---|---|
| `ui_move`, `ui_pick`, `ui_back` | Focus, confirm, cancel | A page corner; a rubber stamp; a page turned back | 40, 120, 80 ms | 2 |
| `ui_copy` | Link or photo copied | A shop bell | 300 ms | 2 |
| `platter_on`, `platter_all` | A player steps on; everyone is on | A soft plate tone; a three-note rise | 150, 500 ms | 1 |
| `count_tick`, `count_go` | 3, 2, 1; start | Clock ticks; a gavel | 80, 250 ms | 1 |
| `join`, `leave` | Peer joins, leaves | A cup set down; a cup picked up | 150 ms | 2 |
| `error` | Connection failure | A single muffled knock. Not an alarm | 200 ms | 2 |
| `clock_tick`, `clock_chime` | Lobby ambience; last call | A mantel clock | loop, 1.5 s | 1 |

### The auctioneer

Each line is on screen as text. The sound is the "wah" voice with the line's rhythm, then the gavel where marked.

| Line | When | Shape | Gavel |
|---|---|---|---|
| "Lot seven." | Round start (the round number) | Two notes, level then down | one |
| "Do I hear a fight?" | After the countdown | Five quick notes rising | — |
| "Going..." | A launch fast enough to kill | One long rising note | — |
| "Gone." | KO | One short low note | one |
| "Withdrawn." | They recovered after "Going..." | Three flat, bored notes | — |
| "A pair." "Three." | Double and triple KOs within 2 s | Rising pairs | — |
| "Last call." | 1:45 | Two notes, the second held | — |
| "Fair warning." | Sudden death | Three falling notes | — |
| "Sold!" | Round won | Up, then a firm down | three |
| "No sale." | Nobody survives the last sink | A long falling slide | one |
| "The hammer falls." | Session won | A six-note flourish | three, slow |
| "New lot." | A player joins | Two quick notes | — |
