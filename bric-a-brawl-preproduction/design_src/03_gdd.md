# 3. Game design document

Every number in this chapter is generated from `tools/design_data.py` and is also in `data/*.json`. Load the JSON; do not retype numbers from these tables. Units: 1 u is about a metre, a mid-size fighter is 1.5 u tall, speeds are u/s, frame counts are at 60 Hz.

## 3.1 Core loop

**Second to second:** move, hit, get hit, hold on. Every exchange changes where somebody is standing.

**Round (about two minutes):** spawn on a full island, fight for gadgets, lose ground on a schedule, end on a fragment.

**Session (about fifteen minutes):** rounds repeat with automatic rematch until someone has three round wins. Then the lobby, with the scores still on the wall.

```
link -> lobby (playable) -> everyone on the platter 3 s -> "Lot one!" 3-2-1
     -> ROUND: full island (0:00) -> first losses (0:25) -> last call (1:45) -> sudden death (2:00) -> hard end (2:20)
     -> "Sold!" freeze + photo -> results 8 s -> next round (same players, next arena)
     -> someone reaches 3 wins -> session results -> lobby
```

Rules that keep the loop tight:

- The lobby is the game. You can move and attack on the lobby island before any peer has connected (P1).
- Ready-up is physical: stand on the big platter. When every player is on it for three seconds, the round starts. No ready button to forget.
- Round one is always The Willow Plate. After that the arena rotates without repeats; the host can pin one.
- Rematch starts by itself after 8 seconds unless the host presses "Back to lobby" (P5).
- Late joiners enter as spectating teaspoons and get a fighter next round.

## 3.2 Modes and win conditions

| Mode | Rules | Why it earns its place |
|---|---|---|
| **Free-for-all** (default) | Stocks: 3 each with 2 to 4 players, 2 each with 5 to 8. Last fighter with a stock wins the round. | The game. |
| **Teams** | Two teams, split evenly, team liveries from two colour families. Hits on team-mates launch but do no damage. A team wins when the other has no stocks. | Friend groups of 6 to 8 ask for it within a night. Friendly knockback without friendly damage is P3 in one rule: you cannot hurt your friend, you can only shove them off by accident. |
| **Fragile** (a toggle on either mode) | One stock, everyone starts at 60 percent, the island takes double crack damage. Rounds last 45 to 60 seconds. | Costs nothing to build. The "we have ten minutes" setting. |
| **Practice** (the lobby itself, alone or with friends) | No stocks, a dummy, optional bots, frame-data overlay. | Needed for P4 and for anyone waiting on friends. It is not a separate screen. |

Nothing else at launch. No items-off competitive rule set, no story, no ranked.

**Round end, in order of precedence:** last fighter or team with stocks; at 2:00, sudden death sets everyone to at least 150 percent; at 2:20 the last fragment sinks and the winner is whoever has most stocks, then least damage, then whoever fell last.

**Bots.** The host can add up to three bots to fill a room. They are the same bots QA uses, at three skill levels. They exist so two friends are not alone on a 26 u plate.

**Player-count scaling.** With four or fewer players the first timeline event has already happened when the round starts (the rim is gone), and every later event comes 10 seconds earlier. Two people do not need a tennis court.

**Eliminated players: the Teaspoon.** A fighter with no stocks becomes a floating teaspoon in their colour. It moves left and right along the top of the screen. Every 5 seconds it can tap the chunk below it for 15 crack damage, with a small "tink" everyone hears. It cannot touch fighters. This keeps the dead involved, gives them revenge, and makes rounds accelerate as people drop out, which is the pacing we want anyway.

## 3.3 Controls

Eight abstract buttons. Everything is rebindable; these are the defaults.

| Action | Keyboard A (default) | Keyboard B (arrows) | Gamepad (Xbox names) |
|---|---|---|---|
| Move / aim | W A S D | Arrow keys | Left stick or d-pad |
| Jump | Space | Space | A |
| Attack (A) | J | Z | X |
| Heavy (H) | K | C | Y, or flick the right stick |
| Special (S) | L | X | B |
| Guard (G) | Left Shift | A | RB or RT |
| Grab | Left Shift + J, or U | D | LB |
| Use gadget (U) | E | S | LT |
| Taunt | T | Q | Back |

Rules:

- **Up does not jump** by default. Up is for up-attacks, up-specials and aiming. There is an option to turn tap-jump on.
- **Buffer.** Any press is remembered for 8 frames and fires on the first frame it is legal. This is the single most important beginner aid and it also hides network jitter.
- **Opposite directions.** Left plus right resolves to the most recent press. Up plus down is neutral.
- **Analogue.** The stick is read as 8 directions with a 0.35 dead zone, plus a "tilt versus full" bit at 0.75 for walking slowly. Keyboards always send "full".
- **One local player per browser** at launch. The input packet carries a slot number so couch play can be added later without a protocol change.

### The beginner layer (works by accident)

- **Mash Attack** for a jab chain that ends in a launcher.
- **Special plus a direction** for all four specials. No motions needed, ever.
- **Hold Guard** to be safe from hits. Tap it at the right moment and you parried, whether you meant to or not.
- **Press Use** next to a gadget to grab it, again to fire it. It is a separate button, so holding a gadget never takes away your attacks.
- **Up plus Special** always tries to get you back to the island.

### The advanced layer (found over a week)

| Technique | Input | Effect |
|---|---|---|
| Clean specials | 236, 623 or 214 then Special (quarter-circle forward, dragon punch, quarter-circle back), 12-frame window | Stronger version of side, up and down special: faster, more damage, or invulnerable. Same three motions for every fighter. |
| Short hop | Release Jump within 3 frames, or press Jump and Attack together | Low jump for fast aerials. |
| Fast fall | Tap down at or after the top of a jump | Fall at the fast-fall speed. |
| Chip-slide | Air dodge diagonally into the ground | Keeps 60 percent of the speed as a slide, 10 frames of landing lag. The game's wavedash. |
| Launch steering | Hold a direction when hit | Bends the launch angle by up to 15 degrees. |
| Tech | Guard within 12 frames before hitting ground or wall while tumbling | No bounce, no bounce damage, half the crack damage to the chunk. |
| Special cancel | Special during the cancel window of a light attack that hit or was blocked | Cuts the recovery into the special. |
| Charged heavy | Hold Heavy up to 60 frames | Damage and launch up to 1.4 times. |
| Gadget catch | Use as a thrown gadget reaches you | Catch it. |
| Gilt Break | Guard plus Special while being hit, at full Gilt | Combo breaker (3.5.9). |

## 3.4 Movement

{{TABLE:fighter_stats}}

Shared constants: gravity 53.6 u/s² times the fighter's gravity scale; jump squat 3 frames for everyone; one double jump, one air dodge and one wall jump per airtime, all restored on landing or grabbing a ledge.

| Move | Numbers | How it should feel |
|---|---|---|
| **Run** | Initial dash for 10 frames at dash speed, then run speed. Turnaround 4 frames. Hold a direction; there is no separate dash button. | A ceramic clatter. Little feet (or hooves, or a wobble) drumming. Starts instantly, stops with a short skid whose length is the traction stat: Moss slides, Grog plants. |
| **Jump** | 3 frames of squash, then the full-hop or short-hop height from the table. About 22 frames to the top for Earl. | Snappy up, heavy down. Gravity is deliberately strong so jumps are commitments measured in frames, not floats. |
| **Double jump** | Slightly lower than the first. Can reverse direction. | A hiccup. A puff of dust under nothing. |
| **Air dodge** | 8 directions or in place. 3 u over 14 frames, invulnerable frames 3 to 16, 28 total. Once per airtime. Ends helpless only if used after an up-special. | A blink. The fighter goes matte for the invulnerable frames (the glaze highlight switches off), which is how you read it at a glance. |
| **Roll and spot dodge** | Guard plus left or right: 4 u, 28 frames, invulnerable 4 to 14. Guard plus down: in place, 24 frames, invulnerable 3 to 16. | Roll is a literal roll: round fighters tip and trundle. |
| **Ledge grab** | Grabbed automatically when falling past an exposed top corner within 0.8 u, facing it. 30 frames of invulnerability on the first grab of an airtime, none on a re-grab. Options: climb (30 frames), jump, roll, attack, drop. Hang for 3 seconds at most. A second fighter grabbing the same ledge knocks the first one off. | Hanging by two floating hands with the body dangling. Ledges move: when a chunk drops, its neighbour's corner becomes the new ledge that instant. |
| **Wall jump** | Push away from a chunk's side face and press Jump. Once per airtime. | The way back from underneath a breaking island. |
| **Recovery** | Every fighter's up-special. Heights and behaviours differ and are a main axis of balance: Moss needs something to hook, Grog barely has one. | The last thing you try. Should fail often enough to be tense and succeed often enough to cheer. |

## 3.5 Combat

### 3.5.1 Damage and launch

Damage is a percent that only goes up, shown on the lot tag and as cracks on the fighter. It does nothing by itself. It scales how far you fly.

```
launchSpeed L (u/s) = (BKB + KBG x percentAfterHit / 100) x 2 / (1 + weight)
```

- **BKB** is base knockback, **KBG** is knockback growth, both per move, both in u/s. Weight is 0.82 to 1.25.
- The victim leaves at angle θ (per move, 0 is forward, 90 is up, 270 is down), bent by up to 15 degrees of launch steering.
- Launch velocity decays at 28 u/s² along its own direction and is added to the fighter's normal falling. This is the Melee model, chosen because it is two lines of code and feels right.
- **Hitstun** is `6 + 1.25 x L` frames, capped at 80. During it you can only steer the launch, tech, or Gilt Break.
- **Tumble** begins at L of 18 or more: the fighter spins, drops their gadget, and will bounce off terrain unless they tech.
- **Terrain impact.** A tumbling fighter hitting ground or wall above 16 u/s bounces with 70 percent of their speed, takes 3 percent, and deals crack damage to that chunk equal to their impact speed times the attacker's crack multiplier. Teching halves the crack and cancels the rest. This is P2: the island is damaged by where people land.

There is no separate "kill power" stat, no rage, no stale-move penalty outside combos. Two numbers and an angle per move.

### 3.5.2 Hit-stop

On every hit both fighters freeze for `3 + 0.5 x damage` frames, minimum 4, maximum 14, plus 2 for heavies. The victim shakes; the attacker holds the pose at full extension. The final hit of a round freezes for 24 frames and then plays 40 frames at quarter speed. Hit-stop is also where the netcode hides its corrections (chapter 7).

### 3.5.3 Guard

Guard is a side plate. Holding Guard, the fighter raises a small plate in their own colour. It has a rim of gold and it cracks as it takes hits. When it shatters, that is a guard break. Everyone can read its state from across the screen.

- Guard HP is 40 to 60 by fighter. Blocked hits remove their damage from it (heavies 1.2 times). Holding it drains 8 per second. It regenerates 6 per second after half a second down.
- Blockstun is `3 + 0.7 x damage` frames. Lowering the plate takes 8 frames.
- **Blocked hits still push you**, at 35 percent of the normal launch speed along the ground. Guarding at the ledge slides you off it. Guard keeps your percent down; it does not keep you on the island (P3).
- No high or low blocking, no chip damage. The mix-up is strike, grab or wait, not left, right, high, low.
- **Guard break.** At 0 HP the plate shatters, the fighter pops up at 14 u/s and is stunned for 150 frames, reduced by mashing to no less than 90. Nesta loses a shell instead (3.6).
- Grabs ignore guard.

Nothing in the launch roster is positive on block. The safest move is −7. Guarding something always gives you the next move, which is the rule that makes guard worth teaching a newcomer (P4).

### 3.5.4 Parry

The first 5 frames of raising the plate are a parry.

- **Parrying a strike:** the attacker rings like a struck bowl and is stuck for 30 frames. The defender is free at once. The screen flashes the blue-and-white impact frame.
- **Parrying a projectile, gust, cork or plunger:** it is sent back at 1.3 times the speed and now belongs to the defender.
- A parry costs no guard HP and earns 15 Gilt.
- The window only exists if Guard was not held in the previous 30 frames. Flickering the button gives you guard, not parries.
- Over the network the window is widened by the defender's one-way latency, up to 3 more frames (7.3.5).

Five frames is generous on purpose. SF6's perfect parry is two; ours has to survive latency and people on trackpads.

### 3.5.5 Grabs and throws

Grab is Guard plus Attack, or its own button. It beats guard and parry, loses to any attack that is already active, and is avoided by jumping or dodging.

- Startup 6 to 12 frames by fighter; a whiff has 30 or more frames of recovery.
- A held fighter can be thrown forward, back, up or down. If the grabber does nothing they are released after `40 + 0.5 x victim percent` frames, at most 100. Mashing shortens it.
- Two grabs within 6 frames of each other cancel and push both fighters apart.
- After a throw, the victim cannot be grabbed again for 60 frames. No chain grabs.
- Back throws are each fighter's ledge finisher. Up and down throws start combos.

### 3.5.6 Combos

- **Chains.** Jabs chain into each other on Attack.
- **Special cancels.** Any light ground attack marked in the tables can be cancelled into a special if it hit or was blocked, from the hit frame until 12 frames later.
- **Juggles.** Up tilts, up throws and down throws launch at low speed and high angle below about 60 percent.
- **Aerial strings.** Landing lag per aerial decides what links.
- **Combo decay.** Each hit after the first in one combo has 6 percent less hitstun than the last, to a floor of half. The same move a second time in one combo has half hitstun. This is the anti-infinite rule; the QA bots search for loops and the build fails if they find one longer than 12 hits.
- A combo counter shows on the attacker's lot tag from the second hit.

### 3.5.7 Invulnerability

| Source | Frames |
|---|---|
| Respawn | 120, or until you attack |
| First ledge grab of an airtime | 30 |
| Roll | 4 to 14 |
| Spot dodge | 3 to 16 |
| Air dodge | 3 to 16 |
| Gilt Break | 1 to 12 |
| Clean up-specials | As listed per fighter |
| Egg Timer rewind | 10 on arrival |

Invulnerable fighters are drawn matte: the glaze highlight is switched off for those frames.

### 3.5.8 Gadgets in hand

One at a time. Picked up and fired with Use. A fighter knocked into tumble drops theirs, and it flies off in the direction of the hit: it can be caught. An empty gadget can be thrown with Use for 4 percent.

### 3.5.9 Gilt and the Gilt Break

Gilt is the one meter. It is drawn on the fighter: as it fills, their cracks fill with gold. Full Gilt means every crack is a gold seam.

- Gain 1 per percent of damage taken, 15 per parry, 25 on losing a stock. Maximum 100. It carries over between stocks, not between rounds.
- **Gilt Break.** At 100, press Guard plus Special while in hitstun or while held. The fighter is invulnerable for 12 frames, everything within 3 u is pushed away at 16 u/s with no damage, and they are free. Costs all of it.

That is the combo breaker. It arrives about once per stock, it is visible on the body before it is used, and a clever attacker baits it. One meter, one use.

Designed but not in scope unless the M3 playtest asks for more depth: Gilt Cancel (spend 50 to cancel a landed light attack's recovery). It needs no new art.

## 3.6 The fighters

Four at launch. They are the four classic archetypes on purpose, so that two fighting-game people recognise their job at once, and each has one mechanic nobody has seen before, so that the other six have something to find.

All four share: floating hands in the player's colour, a neutral-coloured body, a 42-degree turn toward the camera when facing left or right, and the same inputs.

### EARL

- **Ornament:** teapot, bone china. **Role:** all-rounder. **Difficulty:** 1 of 3.
- **Silhouette:** a circle with a spout and a handle. Facing is unmistakable: the spout is his nose and it points where he is going.
- **Personality:** pompous, short-fused. The lid rattles when he is annoyed. He believes someone will be along shortly to collect him.
- **Playstyle:** the honest one. A pushing projectile, a lunging charge, an uppercut that doubles as recovery, and good buttons at every range. His one trick is **Steep**: hold down-special for 50 frames to store a single "Piping" charge, which upgrades his next special. He loses it if he is launched into a tumble. Deciding when you can afford 50 frames is his whole skill curve.
- **Strengths:** no bad matchups, the best anti-air, a real invulnerable reversal with the clean input.
- **Weaknesses:** nothing extreme. Average recovery. Needs Piping to finish early.
- **Gadgets:** baseline. His Steam Puff pushes pepper clouds and jam jars around.
- **The island:** a Piping Lid Pop from underneath breaks through a crazed chunk and brings him up through the floor.
- **Lore:** *Lot 1. Teapot, bone china, with lid. Missing nothing, as he will tell you.* Earl spent forty years on the top shelf being too good to use, until a cat disagreed. He has not poured for anyone since and does not intend to start now. He regards the Mantel as a clerical error.

{{TABLE:moves_earl}}

### GROG

- **Ornament:** bull, black basalt stoneware. **Role:** heavy bruiser and grappler. **Difficulty:** 2 of 3.
- **Silhouette:** a horizontal barrel on four floating hooves, with horns. The only quadruped. Twice as wide as anyone else.
- **Personality:** not angry, just committed. He does not hold grudges; he holds momentum.
- **Playstyle:** the bull in the china shop. Slow buttons, enormous launch. **Stampede** is a charge with armour that picks up the first fighter it touches and carries them on his horns. He does not stop at ledges. Running someone off the island and going with them is a legitimate, frequently correct, always funny play.
- **Strengths:** heaviest, longest grab, strongest single hit (Gore: KO from the centre at 96 percent), armour on his dash attack and charge.
- **Weaknesses:** the biggest target, a jab that starts on frame 6, a recovery of 3.6 u. If he leaves the island he usually stays left.
- **Gadgets:** recoil barely moves him, so the Cork and Bellows cannot save him. Too heavy to be yanked by the Plunger or bagged by the Hoover: the Plunger pulls its user to him instead.
- **The island:** he deals double crack damage with everything, and his stomps add more. Grog shortens rounds. A Grog player chooses between breaking the floor under an opponent and keeping a floor to stand on.
- **Lore:** *Lot 2. Bull, black basalt. Heavy. Souvenir of somewhere.* Grog was bought as a joke and kept as a doorstop. He has been inside exactly one china shop and maintains that the door was too narrow.

{{TABLE:moves_grog}}

### NESTA

- **Ornament:** nesting doll, tin-glazed. **Role:** stance trickster. **Difficulty:** 3 of 3.
- **Silhouette:** a tall bowling pin with no feet and two mittens. She rocks and slides rather than walks. The bands around her base count how many of her are left.
- **Personality:** cheerful on the outside. Each one inside is younger, faster and more furious.
- **Playstyle:** three fighters in one stock. She starts Big: slow, heavy, long reach, 1.15 times damage. **Shed** (down-special) pops her out of her shell one size smaller with 12 invulnerable frames. The empty shell stays behind as a heavy prop that anyone can knock around, and a struck shell is a projectile. Small Nesta is the fastest thing in the game, has the fastest jab (2 frames), the highest recovery, and dies to a stiff breeze. Two sheds per stock. A guard break costs her a shell instead of stunning her.
- **Strengths:** adapts mid-stock; Shed is an escape, a trap and a projectile; Small form's hurtbox is tiny.
- **Weaknesses:** every shed makes her lighter for the rest of that stock, and she cannot go back. Small form does 0.8 times damage and launches at 0.85.
- **Gadgets:** Small Nesta flies furthest from a gust and rocket-jumps best with the Bellows. The Magnet picks up her empty shells.
- **The island:** Big Nesta cracks at 1.3 times, Small at 0.6. Small Nesta fits through gaps one chunk wide that nobody else can.
- **Lore:** *Lot 3. Nesting doll, set of three. Originally seven. Do not ask.* Nesta was a wedding present and has opinions about every one of the four that went missing. She is looking for them. She is not looking very carefully at who is in the way.

{{TABLE:moves_nesta}}

The table is for the Mid form. Big adds 2 frames of startup and multiplies damage by 1.15 and launch by 1.10. Small removes 1 frame and multiplies damage by 0.80 and launch by 0.85.

### MOSS

- **Ornament:** angler gnome, garden terracotta. **Role:** zoner and puller. **Difficulty:** 2 of 3.
- **Silhouette:** a triangle. The hat is half his height and is not part of his hurtbox above the brim. The rod makes him the widest fighter in reach and the narrowest in body.
- **Personality:** patient to the point of rudeness. Sits down in the middle of fights.
- **Playstyle:** he fishes. **Cast** hooks the first thing it touches at up to 8 u: a fighter, a gadget, a parcel still on its doily, a lump of rubble, a piece of island. He can reel it in or **yank** it over his head and behind him. Standing with his back to the edge, that is a kill throw from across the screen. **Tether Cast** is his recovery and needs something to hook. **Gone Fishin'** has him sit down and pull up rubble, a boot, occasionally a gadget.
- **Strengths:** the longest reach by far, controls gadgets before anyone touches them, makes his own ammunition, floaty with a high double jump.
- **Weaknesses:** light, slow on the ground, slow grab, weak up close. When the island is nearly gone there is nothing to tether to, and he knows it.
- **Gadgets:** he can hook a parcel out of the air and a gadget out of a fighter's reach. Anything he yanks becomes a thrown object.
- **The island:** he can hook a falling chunk and ride it, or yank rubble as a projectile. He is the only fighter who gets weaker as the island shrinks, which balances how strong he is while it is whole.
- **Lore:** *Lot 4. Garden gnome, terracotta, weathered. Rod not original.* Moss stood by a pond for thirty winters without a bite. A football ended that. He considers the Mantel an improvement: far more things fall past.

{{TABLE:moves_moss}}

### Finishers at a glance

Simulated with the launch model above against Earl, no launch steering, on a 26 u stage. "Ledge" means one unit inside the edge; spikes are measured just off it.

{{TABLE:ko_summary}}

{{TABLE:sanity}}

## 3.7 Gadgets

Household junk that fell behind the furniture, at ornament scale. They arrive on doilies. They move people; they barely hurt them.

{{TABLE:gadgets_summary}}

**Spawn rules.** The first parcel appears 8 seconds in, then one every 9 to 12 seconds. At most 3 on the island with up to four players, 5 with more. A parcel floats down for 2 seconds on a doily to a random standing chunk, with a 60 percent bias toward the half of the island where the player with fewest stocks is. It can be hit or hooked on the way down. Unclaimed gadgets vanish after 20 seconds. During last call, parcels arrive twice as often. Build tier A ships with the grey-box; B with art; C only if M3 is on time.

{{TABLE:gadgets_detail}}

## 3.8 The island

The island is made of chunks. Each chunk is one convex polygon in the gameplay plane with hit points. This is the only destruction model: no runtime slicing, no voxels.

**States.**

| State | What it is | Collides as |
|---|---|---|
| Intact | Glazed, whole. | Fixed body |
| Crazed | Below 40 percent HP, or warned by the timeline. Hairline cracks all over, a rising ceramic creak. Lasts at least 6 seconds on the timeline path. | Fixed body |
| Loose | HP 0 or its timeline time is up. Sinks at 0.8 u/s for 2.5 seconds, wobbling. You can still stand on it. | Kinematic body |
| Falling | Gravity takes it. It tumbles, can hit fighters, and can be hooked or hit. | Dynamic body |
| Gone | Below the blast zone. | Removed |

**What cracks a chunk.**

| Source | Crack damage |
|---|---|
| A tumbling fighter bouncing on it | Impact speed, times the attacker's crack multiplier, halved if they tech |
| Specific moves | As listed (Grog's Stamp: 45) |
| The Teaspoon | 15 per tap |
| A falling chunk landing on it | 25 |
| The timeline | Sets it to crazed, then loose, at fixed times regardless of HP |

So the schedule is the latest a chunk can go. Players make it go earlier. Chunk HP is 60 to 130; a typical heavy slam at 100 percent does 30 to 45.

**What a chunk leaves behind.** When a chunk goes loose it sheds 2 to 4 lumps of **rubble**: small dynamic bodies that roll, can be hit, thrown, hooked and magnetised, and hurt on impact above 9 u/s (0.6 percent per u/s). At most 16 on the island. Everything smaller than rubble is cosmetic and local to each player's machine.

**Platforms** are thin one-way pieces attached to named chunks. A platform falls when all its supports are gone, or when its own HP runs out.

**Ledges** are computed, not authored: any exposed top corner of an intact or crazed chunk is a ledge.

## 3.9 Arenas

Three, plus the lobby. All share the blast-zone logic and a two-minute shape:

| Phase | Time | Purpose |
|---|---|---|
| Full plate | 0:00 to 0:25 | Learn the layout, race for the first gadget. Launches are long; almost nobody dies. |
| First losses | 0:25 to 1:05 | The outside goes. Ledges move inward. First eliminations. |
| Middle | 1:05 to 1:45 | Platforms and structure go. The arena's own gimmick peaks. |
| Last call | 1:45 to 2:00 | Announced. Parcels double. A third of the starting ground left. |
| Sudden death | 2:00 to 2:20 | Everyone at 150 percent or more on one or two fragments. Then they sink. |

Layout maps (side and top) are in `concept_art/png/map_*.png`; chunk polygons are in `data/arenas.json`.

### The Willow Plate

A blue-and-white platter. Flat, wide and readable: the teaching arena. A humpback bridge in the middle, a pagoda eave on the left and a willow bough on the right as soft platforms. It shrinks evenly from both ends, so the fight is always pushed toward the centre and there is always a ledge on each side. No hazards.

{{TABLE:timeline_willow}}

### High Tea

A three-tier cake stand with a teacup floating either side. Vertical and cramped: three short floors instead of one long one. You can stand inside a teacup and its wall covers you from the side. **The Pour:** twice a round the teapot in the background whistles for 1.5 seconds, tips, and pours a column of tea through the right side of the stand for 4 seconds. It shoves down and outward, does no damage, and leaves what it hits slippery for 6 seconds. The stand collapses from the bottom up. At 1:25 the stem snaps and the top tier becomes a seesaw that tilts toward whoever is heavier. The round ends on that seesaw.

{{TABLE:timeline_high_tea}}

### The Mended Bowl

A bowl that was broken once and repaired with gold. The gold seams are the fracture lines, drawn on the arena from the first second: this is the arena that shows its plan (P4). At 0:35 the centre seam fails and the bowl splits into two halves that drift apart to an 8 u gap. **Kiln updraft:** hot air rises through the gap. Inside it everything falls at half speed and launched fighters are carried upward, so the chasm is a place to fight and the ceiling above it is a place to die. Later each half tilts outward. The round ends as a duel between two small plates across a column of rising air.

{{TABLE:timeline_mended_bowl}}

### The Saucer (lobby)

One unbreakable saucer 14 u wide, a training dummy, the ready platter, and a catalogue stand that opens character select. It reuses Willow Plate parts.

## 3.10 Balance philosophy

**Tune ejection, not damage.** If something feels too strong, look at where it sends people before how much it hurts.

Principles:

1. **Every fighter must be able to lose to a pair of bellows.** Gadgets are the equaliser and stay strong.
2. **Nothing is safe on block.** Pressure comes from spacing and grabs.
3. **Strength is paid for in recovery, speed or size.** Grog hits hardest and comes back worst.
4. **The island is the comeback mechanic.** As it shrinks, the percent needed to die drops for everyone, and the leader has the most stocks to lose on a fragment.
5. **Tune by data, confirm by laughter.** Bots catch broken numbers. Only people can say whether it is fun.

**Tune first, in this order.** These ten numbers decide how the game feels; touch them before any single move.

| # | Knob | Start | Target it controls |
|---|---|---|---|
| 1 | Global launch scale (multiplies every L) | 1.0 | First KO of a round lands between 0:25 and 0:45 |
| 2 | Blast zone distances | ±25, +19, −12 | Centre-stage KOs happen above 95 percent |
| 3 | Chunk HP scale and timeline offsets | 1.0, 0 s | Half the island gone at 1:05 ± 10 s in bot matches |
| 4 | Parcel interval | 9 to 12 s | A gadget is involved in 30 to 45 percent of KOs |
| 5 | Hitstun per launch speed | 1.25 | True combos average 2.5 to 4 hits below 60 percent, none above 12 |
| 6 | Parry window | 5 frames | Skilled testers parry 1 in 3 attempts online |
| 7 | Guard HP and pushback | 40 to 60, 0.35 | Guard breaks happen about once per two rounds |
| 8 | Gravity and fall speeds | 53.6 | Recoveries succeed 55 to 70 percent of the time |
| 9 | Weights | 0.82 to 1.25 | Lightest dies about 25 percent earlier than heaviest |
| 10 | Sudden-death percent | 150 | Rounds end by 2:15 in 95 percent of bot matches |

**Acceptance bands for fighters** (bot round-robin, equal skill): each fighter wins 40 to 60 percent of mirror-free matches, no move accounts for more than 30 percent of a fighter's KOs, self-destructs are 10 to 25 percent of all stock losses. Self-destructs below 10 percent means the island is too safe.

## 3.11 Progression

There are no accounts, so there is no progression that matters, and that is correct for a game played for a week by one friend group. Anything that gates a fighter or a gadget behind play time would break P1 for whoever joins on night three.

What there is, stored in the browser's local storage:

- **Your lot.** Name, last fighter, last colour, key bindings, volume.
- **Provenance.** A small card per fighter with rounds played, KOs, and "most embarrassing exit".
- **Twelve appraisals.** One-off silly feats, each unlocking a cosmetic glaze finish for all fighters (crackle, lustre, matte, gold rim and so on). Examples: win a round without attacking; KO yourself with the Cork; parry a parried cork; end a round as the Teaspoon who tapped the last chunk. They are conversation pieces ("how did you get the gold rim?"), which is a discovery mechanic that costs one shader parameter each.

Appraisals are the first thing on the cut list.

## 3.12 Shareability

| Feature | Design |
|---|---|
| **Room codes** | Three words from ceramic and auction word lists, 64 each: `chipped-gravy-boat`. Sayable on a call. About 262,000 combinations; the code is also the Trystero room password, so signalling is encrypted against anyone who does not have it. |
| **Invite link** | `https://<user>.github.io/bric-a-brawl/#r=chipped-gravy-boat`. Creating a room copies it to the clipboard and says so. A "Copy invite" button is always on screen in the lobby. |
| **Discord preview** | Static Open Graph tags in `index.html`. Title: "BRIC-A-BRAWL". Description: "A party fighter for ornaments with grudges. 2 to 8 players, one link, nothing to install. Click to join." Image: `og.png`, 1200x630, the key art. Site name: "bric-a-brawl". Theme colour: cobalt `#24459A`. The room code is in the fragment, so every room shows the same card. |
| **Default names** | Auction lots: "Slightly Chipped Gravy Boat", "Suspicious Tureen", "Unsigned Vase". Editable. Nobody has to type before playing. |
| **Quick rematch** | Automatic after 8 seconds. |
| **Spectating** | Eliminated players and late joiners are Teaspoons. Up to 2 extra spectators beyond 8 players. |
| **Joining mid-session** | Always allowed. You arrive as a Teaspoon in the current round and get a fighter next round, with zero wins. |
| **The photo** | Every round's final hit is captured as a 1200x630 PNG in the blue-and-white treatment, with names and cause. "Copy photo" writes it to the clipboard. "Save" downloads it. |
| **Session card** | At three wins, a second image: the lots in finishing order with one line each. Same buttons. |
| **Host tools** | Pin arena, add or remove bots, kick, pass host. The game suggests a better host between rounds if someone else reaches more peers or runs the simulation faster (7.3.8). |
