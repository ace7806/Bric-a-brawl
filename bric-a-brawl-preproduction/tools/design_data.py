"""design_data.py - the single source of truth for every number in the design.
Run:  python3 tools/design_data.py
Writes data/*.json (machine-readable, load these in the game) and design_src/_tables/*.md
(the tables embedded in MASTER_DESIGN.md). Edit numbers HERE, never in the generated files."""
import json, math, os
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "data"); TABLES = os.path.join(ROOT, "design_src", "_tables")
os.makedirs(DATA, exist_ok=True); os.makedirs(TABLES, exist_ok=True)

# ============================================================== GLOBAL TUNING
TUNING = {
  "units": "1 unit (u) = 1 metre-ish. A mid fighter is 1.5 u tall. All speeds are u/s, accelerations u/s^2, times are frames at 60 Hz unless marked ms/s.",
  "tickRate": 60,
  "net": {"snapshotHz": 30, "worldStateHz": 15, "inputHz": 60, "inputRedundancy": 4, "interpDelayMs": 66, "hostInputJitterBufferTicks": 2,
          "lagCompMaxTicks": 8, "defenderGraceMaxTicks": 3, "protocolVersion": 1, "maxPlayers": 8, "maxSpectators": 2},
  "input": {"actionBufferFrames": 8, "motionWindowFrames": 12, "tapJumpDefault": False, "smashChargeMaxFrames": 60, "smashChargeMaxMult": 1.4},
  "gravity": 53.6, "kbDecay": 28.0,
  "launch": {"formula": "L = (BKB + KBG * victimPercentAfterHit / 100) * 2 / (1 + weight)", "tumbleSpeed": 18.0, "diMaxDeg": 15, "bounceRetain": 0.7, "bounceMinSpeed": 16.0, "bounceDamage": 3.0},
  "hitstun": {"base": 6, "perSpeed": 1.25, "max": 80},
  "hitstop": {"base": 3, "perDamage": 0.5, "min": 4, "max": 14, "heavyBonus": 2, "finalKoFreeze": 24, "finalKoSlowmoFrames": 40, "finalKoSlowmoScale": 0.25},
  "guard": {"blockstunBase": 3, "blockstunPerDamage": 0.7, "guardDamageMult": 1.0, "heavyGuardDamageMult": 1.2, "drainPerSec": 8, "regenPerSec": 6, "regenDelayFrames": 30,
            "releaseLag": 8, "pushbackScale": 0.35, "breakStunFrames": 150, "breakStunMinFrames": 90, "breakPopSpeed": 14.0},
  "parry": {"windowFrames": 5, "cooldownFrames": 30, "attackerStunFrames": 30, "projectileReflectSpeedMult": 1.3, "giltGain": 15},
  "grab": {"techWindowFrames": 6, "holdBaseFrames": 40, "holdPerPercent": 0.5, "holdMaxFrames": 100, "regrabImmunityFrames": 60},
  "dodge": {"roll": {"distance": 4.0, "total": 28, "invuln": [4, 14]}, "spot": {"total": 24, "invuln": [3, 16]},
            "air": {"distance": 3.0, "travelFrames": 14, "total": 28, "invuln": [3, 16], "landingLag": 10, "slideRetain": 0.6, "perAirtime": 1}},
  "ledge": {"grabBox": [0.8, 1.0], "invulnFramesFirstGrab": 30, "maxHangSeconds": 3.0, "regrabNoInvuln": True, "getupFrames": 30, "trump": True},
  "wallJump": {"perAirtime": 1, "speed": [7.0, 15.0]},
  "gilt": {"max": 100, "gainPerPercentTaken": 1.0, "gainOnStockLost": 25, "gainOnParry": 15, "breakerCost": 100, "breakerInvulnFrames": 12, "breakerRadius": 3.0, "breakerPushSpeed": 16.0},
  "terrain": {"crackPerImpactSpeed": 1.0, "crackTechMult": 0.5, "crazeWarningSeconds": 6.0, "looseSinkSeconds": 2.5, "looseSinkSpeed": 0.8, "rubblePerChunk": [2, 4],
              "maxDynamicChunks": 6, "maxRubble": 16, "debrisHitMinSpeed": 9.0, "debrisDamagePerSpeed": 0.6, "debrisBkb": 10, "debrisKbg": 8},
  "match": {"roundSeconds": 120, "suddenDeathPercent": 150, "hardEndSeconds": 140, "stocks": {"2-4": 3, "5-8": 2}, "sessionWinsToTake": 3, "rematchAutoSeconds": 8,
            "respawnInvulnFrames": 120, "ghostTapCooldownSeconds": 5.0, "ghostTapCrack": 15},
  "blastZone": {"left": -25, "right": 25, "top": 19, "bottom": -12},
  "camera": {"fovDeg": 30, "pitchDeg": -7, "minWidth": 16, "maxWidth": 38, "margin": 2.5, "posOmega": 6.0, "zoomOmega": 3.5, "yawMaxDeg": 5, "launchLeanDeg": 2.5, "launchWiden": 0.08},
}

# ============================================================== FIGHTERS
def stats(**k): return k
FIGHTERS = {
 "earl": {
  "name": "EARL", "ornament": "Teapot, bone china", "role": "All-rounder", "difficulty": 1,
  "stats": stats(weight=1.00, height=1.6, width=0.9, run=8.5, dash=10.5, airSpeed=6.5, airAccel=28, groundAccel=60, traction=50, jumpSquat=3, fullHop=3.6, shortHop=1.7,
                 doubleJump=3.2, gravityScale=1.00, maxFall=14.0, fastFall=20.0, grabRange=1.2, guardHP=50, crackMult=1.0),
  "moves": [
   ("jab1","Spout Flick","A",4,2,16,2.5,4,0,75,{"cancel":"J","class":"light","note":"Set knockback. Chains to jab 2 on A."}),
   ("jab2","Glove Tap","A, A",4,2,18,2.5,4,0,75,{"cancel":"J","class":"light","note":"Chains to jab 3 on A."}),
   ("jab3","Spout Poke","A, A, A",6,3,30,5,12,10,40,{"cancel":"S","class":"light","note":"Auto-combo ender. Special-cancel on hit."}),
   ("ftilt","Spout Jab","side + A",7,3,27,8,10,12,35,{"cancel":"S","class":"light"}),
   ("utilt","Lid Tip","up + A",6,5,26,7,11,9,88,{"cancel":"S","class":"light","note":"Combo starter under 60%."}),
   ("dtilt","Saucer Sweep","down + A",5,3,22,6,8,6,70,{"cancel":"S","class":"light","note":"Hits low. Safe poke."}),
   ("dash","Trolley Dash","run + A",8,6,36,9,13,10,50,{"class":"light"}),
   ("fheavy","Lid Crash","side + H",14,3,46,15,16,21,38,{"class":"heavy","note":"Chargeable to x1.4. Claps the lid like a cymbal."}),
   ("uheavy","Whistle Blast","up + H",11,6,44,14,15,20,90,{"class":"heavy","note":"Steam geyser from the spout. Anti-air."}),
   ("dheavy","Spin Pour","down + H",9,4,42,12,14,17,25,{"class":"heavy","note":"Hits both sides (rear hit frame 14). Low angle: sets up edge-guards."}),
   ("nair","Tea Cosy","A (air)",5,12,34,7,9,8,45,{"class":"air","ll":8,"note":"Late hit 4%."}),
   ("fair","Spout Lunge","fwd + A (air)",8,4,36,10,12,14,40,{"class":"air","ll":11}),
   ("bair","Handle Hook","back + A (air)",7,3,33,11,13,15,140,{"class":"air","ll":10,"note":"His best aerial KO move."}),
   ("uair","Lid Flip","up + A (air)",6,5,30,8,11,11,85,{"class":"air","ll":8}),
   ("dair","Base Drop","down + A (air)",13,4,42,12,5,11,270,{"class":"air","ll":16,"note":"Spike on frames 13-14, then 60 deg."}),
   ("grab","Handle Grab","G + A",7,2,32,0,0,0,0,{"class":"grab"}),
   ("fthrow","Pour Out","grab, fwd",0,0,24,8,12,8,45,{"class":"throw"}),
   ("bthrow","Over the Handle","grab, back",0,0,28,10,14,12,135,{"class":"throw","note":"KO throw at the ledge."}),
   ("uthrow","Lid Launch","grab, up",0,0,24,7,12,7,90,{"class":"throw","note":"Combo throw."}),
   ("dthrow","Steep","grab, down",0,0,26,6,9,5,75,{"class":"throw","note":"Combo throw."}),
   ("nspec","Steam Puff","S",16,0,44,4,14,4,20,{"class":"special","note":"Ring projectile, 7 u/s, lives 70 f. Shoves more than it hurts. Piping: 3 hits x 3%, BKB 18."}),
   ("sspec","Spout Charge","side + S",12,10,48,11,14,13,42,{"class":"special","clean":"236 + S: 10 f startup, 12.5%","note":"Lunges 5 u. Piping: 7 u, armour f8-21 vs hits under 10%."}),
   ("uspec","Lid Pop","up + S",6,8,40,9,12,12,80,{"class":"special","clean":"623 + S: 5 f startup, invulnerable f3-6","note":"Rises 4.6 u, then helpless fall. Piping: 6.2 u, KBG 18."}),
   ("dspec","Steep","down + S (hold)",20,0,30,0,0,0,0,{"class":"special","clean":"214 + S: full charge in 35 f","note":"Hold 50 f to store one Piping charge (lid rattles, whistle). Lost if launched into tumble."}),
   ("ledge","Ledge Swipe","A (ledge)",20,3,50,6,10,6,45,{"class":"light"}),
   ("getup","Getup Swipe","A (floored)",18,4,48,5,10,5,50,{"class":"light","note":"Hits both sides."}),
  ]},
 "grog": {
  "name": "GROG", "ornament": "Bull, black basalt stoneware", "role": "Heavy bruiser / grappler", "difficulty": 2,
  "stats": stats(weight=1.25, height=1.7, width=1.9, run=7.6, dash=9.0, airSpeed=5.6, airAccel=22, groundAccel=45, traction=60, jumpSquat=3, fullHop=3.1, shortHop=1.5,
                 doubleJump=2.7, gravityScale=1.12, maxFall=16.0, fastFall=23.0, grabRange=1.5, guardHP=60, crackMult=2.0),
  "moves": [
   ("jab1","Horn Jab","A",6,2,20,4,5,0,70,{"cancel":"J","class":"light"}),
   ("jab2","Hoof Clop","A, A",7,3,32,6,13,10,45,{"cancel":"S","class":"light","note":"Two-hit jab. Special-cancel on hit."}),
   ("ftilt","Shoulder","side + A",9,4,32,11,13,12,35,{"cancel":"S","class":"light"}),
   ("utilt","Horn Toss","up + A",8,6,32,10,13,9,92,{"cancel":"S","class":"light"}),
   ("dtilt","Hoof Scrape","down + A",7,3,28,8,9,6,65,{"cancel":"S","class":"light","note":"Hits low. +5 crack."}),
   ("dash","Lowered Horns","run + A",10,8,44,12,15,11,45,{"class":"light","note":"Armour f8-17 vs hits under 8%."}),
   ("fheavy","Gore","side + H",18,4,54,20,18,22,38,{"class":"heavy","note":"Chargeable. The strongest single hit in the game."}),
   ("uheavy","Buck","up + H",14,6,50,17,17,20,88,{"class":"heavy"}),
   ("dheavy","Quake Stomp","down + H",16,3,52,16,16,16,75,{"class":"heavy","note":"Both sides. +30 crack to the chunk underfoot."}),
   ("nair","Belly Flop","A (air)",7,14,40,10,10,9,45,{"class":"air","ll":12,"note":"Late hit 6%. Landing adds +10 crack."}),
   ("fair","Double Hoof","fwd + A (air)",11,4,44,14,14,16,40,{"class":"air","ll":15}),
   ("bair","Back Kick","back + A (air)",9,3,38,15,15,17,140,{"class":"air","ll":12}),
   ("uair","Horn Sweep","up + A (air)",8,6,36,11,12,12,85,{"class":"air","ll":10}),
   ("dair","Anvil","down + A (air)",15,6,50,15,6,12,270,{"class":"air","ll":22,"note":"Spike. Landing adds +20 crack."}),
   ("grab","Horn Hook","G + A",8,3,36,0,0,0,0,{"class":"grab","note":"Longest standing grab (1.5 u)."}),
   ("fthrow","Horn Flick","grab, fwd",0,0,26,11,14,10,40,{"class":"throw"}),
   ("bthrow","Suplex","grab, back",0,0,34,13,15,13,135,{"class":"throw","note":"KO throw. +15 crack where they land."}),
   ("uthrow","Toss","grab, up",0,0,26,9,13,8,90,{"class":"throw"}),
   ("dthrow","Trample","grab, down",0,0,30,10,10,5,60,{"class":"throw","note":"+15 crack."}),
   ("nspec","Snort","S",12,6,38,1,17,3,15,{"class":"special","note":"Cone gust 3.5 u. Pure shove: also pushes projectiles, rubble and gadgets."}),
   ("sspec","Stampede","side + S (hold)",14,60,90,12,15,14,40,{"class":"special","clean":"236 + S: 12 f startup, armour threshold 13%","note":"Runs 11 u/s for up to 60 f, armour vs hits under 10%. First fighter touched is carried on the horns (unblockable) up to 40 f, then tossed (the listed hit). He does NOT stop at ledges."}),
   ("uspec","Rodeo","up + S",9,10,46,12,14,14,75,{"class":"special","clean":"623 + S: invulnerable f5-8, rises 4.0 u","note":"Bucking leap, 3.6 u at 60 deg. His only real recovery, and it is short."}),
   ("dspec","Stamp","down + S",20,4,56,14,13,8,85,{"class":"special","clean":"214 + S: 17 f startup","note":"Ground: shockwave 3 u each side pops grounded fighters; +45 crack underfoot. Air: dives at 26 u/s, spikes on the way down (BKB 6, KBG 12, 270 deg)."}),
   ("ledge","Ledge Gore","A (ledge)",22,4,54,8,11,7,45,{"class":"light"}),
   ("getup","Getup Buck","A (floored)",20,5,52,7,11,5,50,{"class":"light","note":"Hits both sides."}),
  ]},
 "nesta": {
  "name": "NESTA", "ornament": "Nesting doll, tin-glazed majolica", "role": "Stance trickster", "difficulty": 3,
  "stats": stats(weight=0.98, height=1.5, width=1.0, run=8.4, dash=10.5, airSpeed=6.6, airAccel=30, groundAccel=65, traction=45, jumpSquat=3, fullHop=3.7, shortHop=1.7,
                 doubleJump=3.3, gravityScale=0.97, maxFall=13.5, fastFall=19.5, grabRange=1.0, guardHP=50, crackMult=1.0),
  "sizes": {"big":   {"scale": 1.25, "weight": 1.12, "run": 6.6, "dash": 8.0, "airSpeed": 5.5, "fullHop": 3.3, "doubleJump": 2.9, "maxFall": 14.5, "damageMult": 1.15, "kbMult": 1.10, "startupAdd": 2, "grabRange": 1.3, "guardHP": 55, "crackMult": 1.3, "popsHeight": 3.8},
            "mid":   {"scale": 1.00, "weight": 0.98, "run": 8.4, "dash": 10.5, "airSpeed": 6.6, "fullHop": 3.7, "doubleJump": 3.3, "maxFall": 13.5, "damageMult": 1.00, "kbMult": 1.00, "startupAdd": 0, "grabRange": 1.0, "guardHP": 50, "crackMult": 1.0, "popsHeight": 4.6},
            "small": {"scale": 0.72, "weight": 0.82, "run": 10.4, "dash": 12.5, "airSpeed": 7.6, "fullHop": 4.0, "doubleJump": 3.6, "maxFall": 12.5, "damageMult": 0.80, "kbMult": 0.85, "startupAdd": -1, "grabRange": 0.8, "guardHP": 40, "crackMult": 0.6, "popsHeight": 5.4}},
  "moves": [
   ("jab1","Mitten Slap","A",3,2,14,2,4,0,75,{"cancel":"J","class":"light","note":"Fastest move in the game (Small: 2 f)."}),
   ("jab2","Other Mitten","A, A",3,2,15,2,4,0,75,{"cancel":"J","class":"light"}),
   ("jab3","Bob","A, A, A",5,3,26,4,11,9,45,{"cancel":"S","class":"light"}),
   ("ftilt","Rocking Bump","side + A",6,3,24,7,10,11,35,{"cancel":"S","class":"light"}),
   ("utilt","Bob Up","up + A",5,5,22,6,10,8,90,{"cancel":"S","class":"light"}),
   ("dtilt","Hem Tap","down + A",4,2,18,5,7,5,75,{"cancel":"S","class":"light","note":"Hits low. Her combo starter."}),
   ("dash","Topple","run + A",7,8,34,8,12,9,55,{"class":"light"}),
   ("fheavy","Wobble Whack","side + H",13,3,44,14,15,20,38,{"class":"heavy","note":"Chargeable."}),
   ("uheavy","Pop Top","up + H",10,5,40,13,15,19,90,{"class":"heavy","note":"Head springs up on a coil."}),
   ("dheavy","Spin Skirt","down + H",8,6,40,11,13,15,28,{"class":"heavy","note":"Both sides."}),
   ("nair","Whirl","A (air)",4,14,30,6,9,8,45,{"class":"air","ll":6,"note":"Late hit 3%."}),
   ("fair","Mitten Fan","fwd + A (air)",7,4,32,9,11,13,42,{"class":"air","ll":9}),
   ("bair","Bustle","back + A (air)",6,3,30,10,12,14,140,{"class":"air","ll":9}),
   ("uair","Kerchief Flick","up + A (air)",5,5,27,7,11,10,85,{"class":"air","ll":7}),
   ("dair","Corkscrew","down + A (air)",9,16,40,10.5,4,9,280,{"class":"air","ll":14,"note":"Drill: 5 hits of 1.5%, final hit 3% is a weak spike."}),
   ("grab","Mitten Grab","G + A",6,2,30,0,0,0,0,{"class":"grab","note":"Range by size: 1.3 / 1.0 / 0.8 u."}),
   ("fthrow","Shoo","grab, fwd",0,0,22,7,11,8,45,{"class":"throw"}),
   ("bthrow","Twirl","grab, back",0,0,26,9,13,11,135,{"class":"throw"}),
   ("uthrow","Hup","grab, up",0,0,22,6,11,6,90,{"class":"throw","note":"Combo throw."}),
   ("dthrow","Sit On","grab, down",0,0,24,5,8,4,75,{"class":"throw","note":"Combo throw. Big form: +10 crack."}),
   ("nspec","Whirligig","S",8,24,50,13,13,11,50,{"class":"special","note":"Spinning top: 6 hits of 1.5% then 4% launcher. Steerable at 5 u/s. Slides off ledges."}),
   ("sspec","Skittle","side + S",10,45,62,8,12,10,45,{"class":"special","clean":"236 + S: 10%, passes through instead of bouncing back","note":"Tips over and rolls at 12 u/s for up to 45 f. Jump-cancel from f12. Bounces back on hit."}),
   ("uspec","Up She Pops","up + S",7,10,42,7,11,10,85,{"class":"special","clean":"623 + S: invulnerable f3-7","note":"Rises 3.8 / 4.6 / 5.4 u by size. Helpless fall after."}),
   ("dspec","Shed","down + S",10,0,34,10,14,12,45,{"class":"special","clean":"214 + S: the empty shell is kicked forward at 14 u/s","note":"Pops out of her shell one size smaller, invulnerable f1-12, hop 2.2 u. The empty shell stays as a heavy prop for 6 s or 3 hits; struck, it becomes a projectile (the listed hit). Twice per stock. Guard break sheds a shell instead of stunning her."}),
   ("ledge","Ledge Bob","A (ledge)",18,3,46,5,10,6,45,{"class":"light"}),
   ("getup","Getup Whirl","A (floored)",16,4,44,5,10,5,50,{"class":"light","note":"Hits both sides."}),
  ]},
 "moss": {
  "name": "MOSS", "ornament": "Angler gnome, garden terracotta", "role": "Zoner / puller", "difficulty": 2,
  "stats": stats(weight=0.90, height=1.4, width=0.9, run=7.0, dash=8.5, airSpeed=6.8, airAccel=26, groundAccel=50, traction=38, jumpSquat=3, fullHop=3.9, shortHop=1.8,
                 doubleJump=3.6, gravityScale=0.82, maxFall=11.5, fastFall=17.0, grabRange=3.2, guardHP=45, crackMult=1.0),
  "moves": [
   ("jab1","Rod Tap","A",5,2,18,3,5,0,70,{"cancel":"J","class":"light","note":"Reach 1.8 u."}),
   ("jab2","Butt End","A, A",6,3,30,5,12,8,40,{"cancel":"S","class":"light"}),
   ("ftilt","Rod Swat","side + A",8,3,30,8,11,12,35,{"cancel":"S","class":"light","note":"Reach 2.4 u. Tip: 10%."}),
   ("utilt","Hat Poke","up + A",6,5,25,7,11,9,90,{"cancel":"S","class":"light"}),
   ("dtilt","Line Trip","down + A",6,3,24,5,6,4,80,{"cancel":"S","class":"light","note":"Hits low. Barely launches: sets up Cast."}),
   ("dash","Belly Slide","run + A",9,7,40,8,12,9,50,{"class":"light"}),
   ("fheavy","Big Cast","side + H",17,3,50,15,16,21,40,{"class":"heavy","note":"Chargeable. Reach 3.0 u. Tip: 18%."}),
   ("uheavy","Hat Spike","up + H",12,6,46,13,15,19,90,{"class":"heavy"}),
   ("dheavy","Tackle Box","down + H",11,4,44,12,14,16,30,{"class":"heavy","note":"Both sides."}),
   ("nair","Line Twirl","A (air)",6,12,36,6,9,8,45,{"class":"air","ll":9}),
   ("fair","Rod Whip","fwd + A (air)",10,3,40,10,12,14,40,{"class":"air","ll":13,"note":"Reach 2.6 u. Tip: 12%."}),
   ("bair","Boot","back + A (air)",7,3,32,9,12,13,140,{"class":"air","ll":10}),
   ("uair","Hat Bonk","up + A (air)",6,6,30,8,11,11,85,{"class":"air","ll":8}),
   ("dair","Sinker","down + A (air)",14,0,44,7,4,9,270,{"class":"air","ll":14,"note":"Drops a lead weight (16 u/s). Weak spike. One on screen."}),
   ("grab","Hook and Line","G + A",12,4,48,0,0,0,0,{"class":"grab","note":"Tether grab, reach 3.2 u. Slow, long recovery on whiff."}),
   ("fthrow","Flick","grab, fwd",0,0,24,7,11,8,45,{"class":"throw"}),
   ("bthrow","Back-cast","grab, back",0,0,28,9,14,13,135,{"class":"throw","note":"KO throw at the ledge."}),
   ("uthrow","Hoist","grab, up",0,0,24,6,11,6,90,{"class":"throw"}),
   ("dthrow","Stake","grab, down",0,0,24,5,8,4,75,{"class":"throw"}),
   ("nspec","Cast","S (aim with stick)",14,0,46,6,15,9,150,{"class":"special","note":"Hook flies 16 u/s in an arc, reach 8 u. Hooks the first fighter, rubble, gadget, parcel or chunk. Hold S: reel (13 u/s). Tap A: Yank, flinging the catch over his head (the listed hit). Any hit on the line cuts it."}),
   ("sspec","Bobber","side + S",15,0,40,5,13,6,60,{"class":"special","clean":"236 + S: bobber is thrown 40% further and pops for 7%","note":"Lobs a float that sits for 4 s and pops on touch. Two on screen. Anyone can hit it away."}),
   ("uspec","Tether Cast","up + S (aim)",10,9,44,6,10,6,90,{"class":"special","clean":"623 + S: reach 11 u, zip has a 5% hitbox","note":"Hook reaches 9 u at 45-135 deg. Latches terrain, ledges, loose chunks and rubble: zips there at 20 u/s. Latches a fighter: zips to them and bonks (the listed hit). Nothing to hook = nothing happens."}),
   ("dspec","Gone Fishin'","down + S (hold)",55,0,70,0,0,0,0,{"class":"special","clean":"214 + S: 40 f channel","note":"Sits and fishes off whatever he is standing on. Result: 60% rubble, 30% old boot (throw: 6%), 9% random gadget, 1% a fish that slaps him."}),
   ("ledge","Ledge Swat","A (ledge)",21,3,52,6,10,6,45,{"class":"light"}),
   ("getup","Getup Twirl","A (floored)",19,4,50,5,10,5,50,{"class":"light","note":"Hits both sides."}),
  ]},
}
ROSTER = ["earl", "grog", "nesta", "moss"]

# ============================================================== GADGETS
GADGETS = [
 {"id":"bellows","name":"The Bellows","verb":"push","tier":"A","weight":22,"ammo":6,
  "behaviour":"Cone gust, 6 u long, 50 deg wide, fires in the facing direction (aim up/down 45 deg). Instant. 18 f between puffs.",
  "numbers":{"push":16.0,"pushAirborneMult":1.6,"damage":1.0,"userRecoil":4.0,"cooldownFrames":18},
  "counterplay":"Guard halves the push and keeps your feet planted. Parry sends the gust back at 1.3x. Stay grounded: airborne fighters fly 1.6x further.",
  "beat":"Three people leaving the island like leaves off a lawn. Also the cheapest recovery in the game: puff downward to hop."},
 {"id":"plunger","name":"Plunger-on-a-String","verb":"pull","tier":"A","weight":16,"ammo":3,
  "behaviour":"Fires a plunger 9 u at 22 u/s. Sticks to the first fighter, chunk, rubble or gadget. Press Use again within 3 s to yank: light targets fly to you at 18 u/s; heavier or fixed targets pull YOU to them.",
  "numbers":{"range":9.0,"speed":22.0,"yankSpeed":18.0,"damage":3.0,"stickSeconds":3.0},
  "counterplay":"Parry it and it sticks to the shooter's face: you get the yank. Any hit on the string cuts it. Grog is too heavy to be yanked: he reels you in instead.",
  "beat":"Yank a friend toward you, sidestep, watch them sail past and off the far edge."},
 {"id":"cork","name":"The Vintage","verb":"launch","tier":"A","weight":10,"ammo":1,
  "behaviour":"Champagne bottle. Hold Use to shake (up to 45 f), release to fire the cork at 34 u/s. The recoil launches the shooter the other way.",
  "numbers":{"damage":9.0,"bkb":24,"kbg":20,"angle":35,"recoilMin":14.0,"recoilMax":24.0,"shakeFrames":45},
  "counterplay":"It is loud and slow: jump or parry (the cork comes back). The shooter is airborne and helpless for 20 f afterwards.",
  "beat":"The recoil kills the shooter as often as the target. Aim it at the floor to rocket-jump back from the dead."},
 {"id":"pepper","name":"Pepper Mill","verb":"reverse","tier":"B","weight":10,"ammo":2,
  "behaviour":"Grinds a pepper cloud 3 u wide, lasting 4 s. Anyone inside (the user too) for 40 f builds a sneeze, then sneezes: launched BACKWARDS from the way they face.",
  "numbers":{"cloudRadius":1.5,"cloudSeconds":4.0,"sneezeBuildFrames":40,"sneezeLaunch":18.0,"sneezeAngle":25,"damage":2.0},
  "counterplay":"Leave the cloud, or turn your back to the island centre so the sneeze throws you inward. Bellows and Snort blow the cloud around.",
  "beat":"Ah... ah... CHOO. An ornament rocketing backwards off the island with a tiny sneeze."},
 {"id":"toaster","name":"Pop-Up Toaster","verb":"launch","tier":"B","weight":10,"ammo":3,
  "behaviour":"Place it on the ground. 36 f after anyone (or anything) lands on it: DING, straight up at 26 u/s. Three pops, then it is a throwable brick.",
  "numbers":{"armFrames":36,"popSpeed":26.0,"damage":4.0,"uses":3},
  "counterplay":"It ticks for 36 f: step off. Hit it to knock it away. Jam on top of it stops it firing.",
  "beat":"The ding. Then somebody who was winning is above the camera."},
 {"id":"jam","name":"Jam Jar","verb":"stick","tier":"B","weight":10,"ammo":2,
  "behaviour":"Lob it: it splats into a puddle 3 u wide for 8 s. Fighters in it are rooted (can attack and guard, cannot walk or jump) until they press Jump 3 times or 90 f pass. Rubble and gadgets stick too.",
  "numbers":{"puddleWidth":3.0,"puddleSeconds":8.0,"rootMaxFrames":90,"mashToEscape":3,"damage":2.0},
  "counterplay":"Mash Jump. Guard still works while stuck. The puddle falls with its chunk.",
  "beat":"Being glued to a piece of island at the exact moment that piece stops being island."},
 {"id":"timer","name":"Egg Timer","verb":"reverse","tier":"B","weight":8,"ammo":2,
  "behaviour":"Press Use: you snap back to where you were 120 f ago, with the damage you have now. Leaves a ticking ghost where you will return to. Usable in hitstun.",
  "numbers":{"rewindFrames":120,"invulnFrames":10},
  "counterplay":"Everyone can see the ghost: stand on it with a heavy attack ready, or break the chunk under it.",
  "beat":"Launched, rewound, saved. Or: rewinding onto a chunk that fell off a second ago."},
 {"id":"hoover","name":"The Hoover","verb":"suck and spit","tier":"C","weight":8,"ammo":2,
  "behaviour":"Hold Use: suction cone 5 u, pulls fighters at 9 u/s, rubble and gadgets at 16 u/s. A fighter who reaches the nozzle is bagged for up to 90 f, then fired in the aim direction as a living projectile.",
  "numbers":{"cone":5.0,"pullFighter":9.0,"pullObject":16.0,"bagMaxFrames":90,"spitSpeed":28.0,"spitDamage":8.0,"spitBkb":16,"spitKbg":10,"hitByFlyingFriend":10.0},
  "counterplay":"Guard resists the pull. Mash inside the bag to cut it to 40 f. The user cannot guard while sucking. Grog cannot be bagged.",
  "beat":"Firing one friend at another friend."},
 {"id":"magnet","name":"Horseshoe Magnet","verb":"attract and repel","tier":"C","weight":6,"ammo":3,
  "behaviour":"Tap Use: for 60 f every loose object within 8 u (rubble, gadgets, shells, bobbers, corks) flies to the holder and orbits. Tap again: all of it fires outward in the aim direction as shrapnel. Fighters are ceramic and do not stick, but their held gadgets are ripped away.",
  "numbers":{"radius":8.0,"attractFrames":60,"shrapnelSpeed":24.0,"shrapnelDamageEach":4.0,"maxOrbit":8},
  "counterplay":"Useless on a clean stage: deny it rubble. Parry reflects each piece of shrapnel. Hold your gadget out of range or lose it.",
  "beat":"A cloud of crockery, a held breath, then all of it going one direction."},
]
GADGET_RULES = {"firstSpawnSeconds": 8, "spawnIntervalSeconds": [9, 12], "maxOnStage": {"2-4": 3, "5-8": 5}, "despawnSeconds": 20, "parcelDescentSeconds": 2.0,
                "trailingPlayerBias": 0.6, "holdLimit": 1, "dropOnTumble": True, "emptyThrowDamage": 4.0, "lastCallSpawnMult": 2.0}

# ============================================================== ARENAS
def chunk_poly(x0, x1, y0, y1, d0, d1, jag=0.0):
    """Convex-ish gameplay polygon for one chunk: flat-ish top from (x0,y0) to (x1,y1), tapered underside."""
    xm = (x0 + x1) / 2; w = x1 - x0
    return [[x0, y0], [x1, y1], [x1 - 0.08 * w, y1 - d1], [xm + jag * w, min(y0, y1) - max(d0, d1) * 1.12], [x0 + 0.08 * w, y0 - d0]]

def willow():
    n = 12; W = 26.0; cw = W / n; chunks = []
    for i in range(n):
        x0 = -13 + i * cw; x1 = x0 + cw
        def top(x): return 0.0 + 0.5 * max(0.0, (abs(x) - 10.5) / 2.5) ** 1.5      # dished rim
        def depth(x): return 1.3 + 2.1 * math.sqrt(max(0.0, 1 - (x / 13.4) ** 2))  # lens-shaped underside
        ring = min(i, n - 1 - i)
        chunks.append({"id": f"W{i+1}", "group": ["rim", "outer", "mid", "inner", "inner", "core"][ring], "hp": [60, 75, 90, 105, 105, 130][ring],
                       "poly": [[round(a, 3), round(b, 3)] for a, b in chunk_poly(x0, x1, top(x0), top(x1), depth(x0), depth(x1), jag=(0.1 if i % 2 else -0.1))]})
    return {"id": "willow", "name": "The Willow Plate", "blurb": "A blue-and-white platter the size of a tennis court. The starter arena: flat, wide, shrinks from the outside in.",
            "blastZone": {"left": -25, "right": 25, "top": 19, "bottom": -12}, "cameraBounds": {"minX": -21, "maxX": 21, "minY": -6, "maxY": 15},
            "spawns": [[-9, 0.6], [9, 0.6], [-5, 0.1], [5, 0.1], [-1.2, 0.1], [1.2, 0.1], [-7, 0.3], [7, 0.3]],
            "chunks": chunks,
            "platforms": [{"id": "bridge", "kind": "soft", "x0": -3.0, "x1": 3.0, "y": 2.6, "hp": 70, "support": ["W6", "W7"], "note": "Humpback bridge. Arched: 2.6 at the ends, 3.1 in the middle."},
                          {"id": "eave", "kind": "soft", "x0": -10.4, "x1": -6.6, "y": 3.4, "hp": 60, "support": ["W2", "W3"], "note": "Pagoda roof eave."},
                          {"id": "bough", "kind": "soft", "x0": 6.6, "x1": 10.4, "y": 3.0, "hp": 60, "support": ["W10", "W11"], "note": "Willow bough. Sways +-0.15 u, cosmetic only."}],
            "hazards": [],
            "timeline": [(25, "craze", ["W1", "W12"]), (31, "drop", ["W1", "W12"]), (45, "craze", ["W2", "W11"]), (52, "drop", ["W2", "W11"]),
                         (65, "craze", ["W3", "W10"]), (72, "drop", ["W3", "W10"]), (80, "drop", ["bridge"]), (90, "craze", ["W4", "W9"]), (97, "drop", ["W4", "W9"]),
                         (105, "last_call", ["W5", "W8"]), (112, "drop", ["W5", "W8"]), (120, "sudden_death", ["W6", "W7"]), (130, "sink_one", ["W6|W7"]), (140, "sink", ["W6", "W7"])]}

def high_tea():
    chunks = []
    def tier(prefix, y, x0, x1, n, depth, hp, soft):
        cw = (x1 - x0) / n
        for i in range(n):
            a = x0 + i * cw; b = a + cw
            chunks.append({"id": f"{prefix}{'abcdefgh'[i]}", "group": prefix, "hp": hp, "oneWay": soft,
                           "poly": [[round(p, 3), round(q, 3)] for p, q in chunk_poly(a, b, y, y, depth, depth, jag=0.0)]})
    tier("T1", 0.0, -10.0, 10.0, 8, 0.8, 80, False)
    tier("T2", 4.2, -6.5, 6.5, 6, 0.6, 70, True)
    tier("T3", 8.0, -3.5, 3.5, 2, 0.6, 110, True)
    return {"id": "high_tea", "name": "High Tea", "blurb": "A three-tier cake stand. Vertical, cramped, with a teapot that pours across the middle tier. Collapses from the bottom up, ends on a seesaw.",
            "blastZone": {"left": -24, "right": 24, "top": 24, "bottom": -12}, "cameraBounds": {"minX": -19, "maxX": 19, "minY": -6, "maxY": 19},
            "spawns": [[-8, 0.1], [8, 0.1], [-4.5, 4.3], [4.5, 4.3], [-2, 8.1], [2, 8.1], [-3, 0.1], [3, 0.1]],
            "chunks": chunks,
            "platforms": [{"id": "cupL", "kind": "solid_moving", "x0": -13.8, "x1": -11.2, "y": 2.8, "hp": 60, "bob": {"amp": 0.6, "periodSeconds": 6.0}, "note": "Teacup. You can stand inside it: the walls are 0.5 u cover."},
                          {"id": "cupR", "kind": "solid_moving", "x0": 11.2, "x1": 13.8, "y": 2.8, "hp": 60, "bob": {"amp": 0.6, "periodSeconds": 6.0, "phase": 0.5}, "note": "Teacup."}],
            "hazards": [{"id": "pour", "name": "The Pour", "atSeconds": [40, 80], "telegraphSeconds": 1.5, "durationSeconds": 4.0, "column": [2.0, 4.0],
                         "force": {"down": 30.0, "outward": 12.0}, "after": {"slipperySeconds": 6.0, "tractionMult": 0.3}, "damage": 0,
                         "note": "The background teapot whistles, tips and pours a column of tea from the top of the screen to tier 1. Shoves, never hurts."}],
            "timeline": [(25, "craze", ["T1a", "T1h"]), (31, "drop", ["T1a", "T1h"]), (40, "hazard", ["pour"]), (45, "craze", ["T1b", "T1g"]), (52, "drop", ["T1b", "T1g"]),
                         (60, "craze", ["cupL", "cupR"]), (66, "drop", ["cupL"]), (72, "drop", ["cupR"]), (70, "craze", ["T1c", "T1f"]), (77, "drop", ["T1c", "T1f"]),
                         (80, "hazard", ["pour"]), (85, "stem_snap", ["T3a", "T3b"]), (85, "craze", ["T2a", "T2f"]), (92, "drop", ["T2a", "T2f"]),
                         (100, "craze", ["T1d", "T1e"]), (107, "drop", ["T1d", "T1e"]), (105, "last_call", ["T2b", "T2e"]), (116, "drop", ["T2b", "T2e"]),
                         (120, "sudden_death", ["T2c", "T2d"]), (126, "drop", ["T2c", "T2d"]), (140, "sink", ["T3a", "T3b"])],
            "special": {"stemSnap": "At 1:25 tier 3 becomes a seesaw: it tilts toward the heavier side at up to 14 deg (torque = sum of fighter weight x distance from centre), 40 deg/s max."}}

def mended_bowl():
    def wall(x):  # bowl cross-section: flat floor to |x|=7, wall rising to 3.0 at |x|=12, flat lip to 13.5
        ax = abs(x)
        if ax <= 7: return 0.0
        if ax <= 12: return 3.0 * ((ax - 7) / 5) ** 1.25
        return 3.0
    spans = [(-13.5, -10.0, "lip"), (-10.0, -7.0, "wall"), (-7.0, -3.5, "floor"), (-3.5, 0.0, "core"), (0.0, 3.5, "core"), (3.5, 7.0, "floor"), (7.0, 10.0, "wall"), (10.0, 13.5, "lip")]
    hp = {"lip": 70, "wall": 90, "floor": 105, "core": 130}; chunks = []
    for i, (a, b, g) in enumerate(spans):
        da = 1.2 + 1.6 * math.sqrt(max(0, 1 - (a / 14) ** 2)); db = 1.2 + 1.6 * math.sqrt(max(0, 1 - (b / 14) ** 2))
        chunks.append({"id": f"B{i+1}", "group": g, "hp": hp[g], "half": "L" if b <= 0 else "R",
                       "poly": [[round(p, 3), round(q, 3)] for p, q in chunk_poly(a, b, wall(a), wall(b), da, db, jag=0.0)]})
    return {"id": "mended_bowl", "name": "The Mended Bowl", "blurb": "A bowl that was broken once and put back together with gold. The seams show exactly where it will break again. It splits down the middle and a kiln updraft rises through the gap.",
            "blastZone": {"left": -26, "right": 26, "top": 20, "bottom": -12}, "cameraBounds": {"minX": -22, "maxX": 22, "minY": -6, "maxY": 16},
            "spawns": [[-11.5, 3.1], [11.5, 3.1], [-5, 0.1], [5, 0.1], [-1.5, 0.1], [1.5, 0.1], [-8, 0.5], [8, 0.5]],
            "chunks": chunks,
            "platforms": [{"id": "shardL", "kind": "soft", "x0": -6.5, "x1": -3.5, "y": 4.6, "hp": 60, "attach": "L", "note": "A gold-rimmed shard that never fell. Moves with the left half."},
                          {"id": "shardR", "kind": "soft", "x0": 3.5, "x1": 6.5, "y": 4.6, "hp": 60, "attach": "R", "note": "Moves with the right half."},
                          {"id": "shardTop", "kind": "soft", "x0": -1.75, "x1": 1.75, "y": 7.2, "hp": 60, "attach": None, "note": "Hangs over the seam. Falls when the bowl splits."}],
            "hazards": [{"id": "updraft", "name": "Kiln Updraft", "activeWhen": "gap >= 2 u", "column": "the gap between the halves", "gravityMult": 0.45, "maxFallMult": 0.5, "launchedLift": 6.0, "damage": 0,
                         "note": "Hot air from the kiln far below. Fighters and objects fall at half speed inside the gap; launched fighters are carried upward. It makes the chasm a place to fight, and the ceiling a place to die."}],
            "timeline": [(35, "split", ["B4|B5"]), (36, "drop", ["shardTop"]), (55, "craze", ["B1", "B8"]), (62, "drop", ["B1", "B8"]), (75, "tilt", ["L", "R"]),
                         (90, "craze", ["B2", "B7"]), (97, "drop", ["B2", "B7"]), (105, "last_call", ["B3", "B6"]), (112, "drop", ["B3", "B6", "shardL", "shardR"]),
                         (120, "sudden_death", ["B4", "B5"]), (130, "sink_one", ["B4|B5"]), (140, "sink", ["B4", "B5"])],
            "special": {"split": "At 0:35 the centre seam fails. Each half becomes one kinematic body and drifts outward at 0.14 u/s until the gap is 8 u (about 0:64).",
                        "tilt": "At 1:15 each half rotates outward about its inner bottom corner at 0.5 deg/s to 12 deg. Loose objects roll off; footing still holds."}}

ARENAS = [willow(), high_tea(), mended_bowl()]

# ============================================================== PALETTE
PALETTE = {
 "neutrals": {"bone": "#F2EEE6", "slip": "#EAE3D2", "bisque": "#D8B596", "terracotta": "#B5633F", "basalt": "#3A322D", "ash": "#8E8478", "ink": "#2B2623"},
 "players": [{"slot": 1, "name": "Cobalt", "hex": "#24459A", "pattern": "solid band"}, {"slot": 2, "name": "Oxblood", "hex": "#A3312B", "pattern": "dots"},
             {"slot": 3, "name": "Mustard", "hex": "#E3A72F", "pattern": "stripes"}, {"slot": 4, "name": "Verdigris", "hex": "#2F8F7A", "pattern": "checks"},
             {"slot": 5, "name": "Tangerine", "hex": "#E36F36", "pattern": "zigzag"}, {"slot": 6, "name": "Aubergine", "hex": "#6A3F78", "pattern": "scallops"},
             {"slot": 7, "name": "Rose", "hex": "#DA7F98", "pattern": "florets"}, {"slot": 8, "name": "Celery", "hex": "#A9B544", "pattern": "crosshatch"}],
 "accents": {"gilt": "#C8A24A", "gilt_hi": "#E7CF86", "gilt_lo": "#8A6A22", "cheek": "#E9A39A", "stamp_red": "#B5432E", "delft_ink": "#1E3A8A", "delft_paper": "#F4F1EA"},
 "world": {"sky_top": "#A9C2BC", "sky_mid": "#E4D3B5", "sky_low": "#D9A886", "cloud": "#EFE7D8", "fog": "#E4D3B5", "clay_foot": "#9C6B55",
           "willow_glaze": "#EDEAE2", "willow_wash": "#8C9FC6", "willow_line": "#5E78B0", "celadon": "#9DBFA6", "celadon_dk": "#6E9A85",
           "tea_cream": "#EFE3C8", "tea_rose": "#D9A5A0", "tea": "#C08A4E", "bowl_tenmoku": "#4A372C", "bowl_inner": "#B9CDB8"},
 "ui": {"paper": "#F3EDE2", "paper_shade": "#E6DCCB", "ink": "#2B2623", "ink_soft": "#6B625A", "cobalt": "#24459A", "stamp": "#B5432E", "gilt": "#C8A24A", "tag": "#E9D9B8", "ok": "#2F8F7A", "warn": "#E3A72F"},
 "rules": {"worldMaxSaturationHSL": 0.35, "liveryMinSaturationHSL": 0.5, "note": "Saturation belongs to players and gadgets. Fighter bodies use neutrals only, so any livery reads on any fighter."},
}

# ============================================================== DERIVED NUMBERS
def launch(bkb, kbg, pct, w): return (bkb + kbg * pct / 100.0) * 2.0 / (1.0 + w)
def hitstun(L): return min(TUNING["hitstun"]["max"], round(TUNING["hitstun"]["base"] + TUNING["hitstun"]["perSpeed"] * L))
def hitstop(d, heavy=False):
    h = TUNING["hitstop"]; return int(max(h["min"], min(h["max"], round(h["base"] + h["perDamage"] * d))) + (h["heavyBonus"] if heavy else 0))
def blockstun(d): return round(TUNING["guard"]["blockstunBase"] + TUNING["guard"]["blockstunPerDamage"] * d)

def ko_sim(bkb, kbg, angle, dmg, pct_before, start_x, victim="earl", offstage=False):
    """True if a hit at pct_before KOs a victim (default: Earl, weight 1.0) with no DI.
    start_x: 0 = centre, 12 = one unit inside the ledge of a 26 u stage. offstage=True starts at x=14.2 in the air (for spikes)."""
    st = FIGHTERS[victim]["stats"]; bz = TUNING["blastZone"]; g = TUNING["gravity"] * st["gravityScale"]; dec = TUNING["kbDecay"]; dt = 1 / 60
    pct = pct_before + dmg; L = launch(bkb, kbg, pct, st["weight"]); H = hitstun(L)
    a = math.radians(angle); ux, uy = abs(math.cos(a)), math.sin(a)       # always launch toward the nearer side zone
    x, y = (14.2 if offstage else start_x), 0.8; kb = L; vy = 0.0; vx = 0.0; f = 0
    while kb > 0 or f < H:
        x += (kb * ux + vx) * dt; y += (kb * uy + vy) * dt
        kb = max(0.0, kb - dec * dt); vy = max(-st["maxFall"], vy - g * dt); f += 1
        if f > H: vx = max(-st["airSpeed"], vx - st["airAccel"] * dt)       # after hitstun the victim drifts back
        if x >= bz["right"] or y >= bz["top"] or y <= bz["bottom"]: return True
        if y <= 0.8 and x <= 13.0 and (kb * uy + vy) <= 0 and f > 2: return False   # landed on stage
        if f > 400: break
    if x > 13.0:   # ended offstage: recoverable if double jump + up special can reach the ledge
        reach_y = st["doubleJump"] + 4.6 - 0.8; reach_x = st["airSpeed"] * 1.3
        if y < -reach_y or (x - 13.0) > reach_x + 6.0: return True
    return False

def ko_percent(m, start_x, offstage=False):
    _id, _n, _i, su, ac, tot, dmg, bkb, kbg, ang, ex = m
    if kbg == 0 or dmg == 0: return None
    for p in range(0, 301):
        if ko_sim(bkb, kbg, ang, dmg, p, start_x, offstage=offstage): return p
    return None

def move_row(m):
    _id, name, inp, su, ac, tot, dmg, bkb, kbg, ang, ex = m
    cls = ex.get("class", "light"); heavy = cls == "heavy"
    row = {"id": _id, "name": name, "input": inp, "startup": su, "active": ac, "total": tot, "damage": dmg, "bkb": bkb, "kbg": kbg, "angle": ang, "class": cls,
           "cancel": ex.get("cancel", ""), "landingLag": ex.get("ll"), "clean": ex.get("clean"), "note": ex.get("note", "")}
    if cls in ("light", "heavy", "air", "special") and dmg > 0 and su > 0:
        row["hitstop"] = hitstop(dmg, heavy); row["blockstun"] = blockstun(dmg)
        row["onBlock"] = row["blockstun"] - (tot - su)
        L0 = launch(bkb, kbg, dmg, 1.0); L100 = launch(bkb, kbg, 100 + dmg, 1.0)
        row["onHit0"] = hitstun(L0) - (tot - su); row["launch0"] = round(L0, 1); row["launch100"] = round(L100, 1)
    spike = 255 <= ang <= 285
    if cls != "grab":
        row["koCentre"] = None if spike else ko_percent(m, 0.0)
        row["koLedge"] = ko_percent(m, 12.0, offstage=spike)
    return row

def fmt(v): return "-" if v is None or v == "" else (f"{v:g}" if isinstance(v, float) else str(v))
def sgn(v): return "-" if v is None else (f"+{v}" if v > 0 else str(v))

def write_tables():
    out = {}
    # ---- fighter stats
    keys = [("weight", "Weight"), ("height", "Height (u)"), ("run", "Run (u/s)"), ("dash", "Initial dash (u/s)"), ("airSpeed", "Air speed (u/s)"), ("fullHop", "Full hop (u)"), ("shortHop", "Short hop (u)"),
            ("doubleJump", "Double jump (u)"), ("gravityScale", "Gravity scale"), ("maxFall", "Max fall (u/s)"), ("fastFall", "Fast fall (u/s)"), ("traction", "Traction (u/s^2)"),
            ("grabRange", "Grab range (u)"), ("guardHP", "Guard HP"), ("crackMult", "Crack multiplier")]
    L = ["| Stat | EARL | GROG | NESTA (Big / Mid / Small) | MOSS |", "|---|---|---|---|---|"]
    nz = FIGHTERS["nesta"]["sizes"]
    for k, label in keys:
        def nv(k):
            if k in nz["big"]: return f"{nz['big'][k]:g} / {nz['mid'][k]:g} / {nz['small'][k]:g}"
            if k == "height": return "1.9 / 1.5 / 1.1"
            return f"{FIGHTERS['nesta']['stats'][k]:g}"
        L.append(f"| {label} | {FIGHTERS['earl']['stats'][k]:g} | {FIGHTERS['grog']['stats'][k]:g} | {nv(k)} | {FIGHTERS['moss']['stats'][k]:g} |")
    # derived jump physics for the baseline
    g = TUNING["gravity"]
    L.append(f"| Jump velocity, full hop (u/s) | " + " | ".join(f"{math.sqrt(2*g*FIGHTERS[c]['stats']['gravityScale']*FIGHTERS[c]['stats']['fullHop']):.1f}" for c in ROSTER) + " |")
    L.append(f"| Frames to apex, full hop | " + " | ".join(f"{round(60*math.sqrt(2*FIGHTERS[c]['stats']['fullHop']/(g*FIGHTERS[c]['stats']['gravityScale'])))}" for c in ROSTER) + " |")
    out["fighter_stats"] = "\n".join(L)
    # ---- move tables
    chars_json = {}
    for c in ROSTER:
        rows = [move_row(m) for m in FIGHTERS[c]["moves"]]
        chars_json[c] = {k: v for k, v in FIGHTERS[c].items() if k != "moves"}; chars_json[c]["moves"] = rows
        T = ["| Move | Input | Startup | Active | Total | Dmg % | BKB | KBG | Angle | On block | KO% centre | KO% ledge | Notes |", "|---|---|---|---|---|---|---|---|---|---|---|---|---|"]
        for r in rows:
            note = r["note"]
            if r.get("landingLag"): note = f"Landing lag {r['landingLag']}. " + note
            if r.get("clean"): note = (note + " " if note else "") + f"**Clean** ({r['clean']})."
            if r["cancel"] == "J": note = (note + " " if note else "") + "Chain."
            T.append(f"| {r['name']} | {r['input']} | {fmt(r['startup']) if r['startup'] else '-'} | {fmt(r['active']) if r['active'] else '-'} | {r['total']} | {fmt(r['damage']) if r['damage'] else '-'} | "
                     f"{fmt(r['bkb']) if r['damage'] else '-'} | {fmt(r['kbg']) if r['damage'] else '-'} | {fmt(r['angle']) if r['damage'] else '-'} | {sgn(r.get('onBlock'))} | {fmt(r.get('koCentre'))} | {fmt(r.get('koLedge'))} | {note.strip()} |")
        out[f"moves_{c}"] = "\n".join(T)
    # ---- KO summary: strongest finishers
    S = ["| Fighter | Move | KO% from centre | KO% at ledge |", "|---|---|---|---|"]
    for c in ROSTER:
        rows = [r for r in chars_json[c]["moves"] if r.get("koLedge") is not None]
        for r in sorted(rows, key=lambda r: r["koLedge"])[:4]:
            S.append(f"| {FIGHTERS[c]['name']} | {r['name']} | {fmt(r.get('koCentre'))} | {r['koLedge']} |")
    out["ko_summary"] = "\n".join(S)
    # ---- sanity stats used in the balance section
    allrows = [r for c in ROSTER for r in chars_json[c]["moves"]]
    fast = min(r["startup"] for r in allrows if r["startup"] and r["class"] in ("light", "heavy", "air", "special") and r["damage"])
    safest = max((r for r in allrows if r.get("onBlock") is not None), key=lambda r: r["onBlock"])
    out["sanity"] = (f"- Fastest hit: {fast} frames. Fastest grab: {min(r['startup'] for r in allrows if r['class']=='grab')} frames.\n"
                     f"- Safest move on block: {safest['name']} at {sgn(safest['onBlock'])}. Nothing is plus on block: guard always returns the turn.\n"
                     f"- Earliest ledge KO: {min(r['koLedge'] for r in allrows if r.get('koLedge') is not None)}%. Earliest centre KO: {min(r['koCentre'] for r in allrows if r.get('koCentre') is not None)}%.\n"
                     f"- Moves in the launch roster: {len(allrows)}.")
    # ---- gadgets
    G = ["| # | Gadget | Verb | Uses | Spawn weight | Build tier |", "|---|---|---|---|---|---|"]
    tw = sum(x["weight"] for x in GADGETS)
    for i, x in enumerate(GADGETS, 1):
        G.append(f"| {i} | {x['name']} | {x['verb']} | {x['ammo']} | {x['weight']} ({100*x['weight']/tw:.0f}%) | {x['tier']} |")
    out["gadgets_summary"] = "\n".join(G)
    D = []
    for i, x in enumerate(GADGETS, 1):
        nums = ", ".join(f"{k} {v:g}" if isinstance(v, (int, float)) else f"{k} {v}" for k, v in x["numbers"].items())
        D.append(f"#### {i}. {x['name']} ({x['verb']}; {x['ammo']} use{'s' if x['ammo']>1 else ''}; tier {x['tier']})\n\n- **Behaviour.** {x['behaviour']}\n- **Numbers.** {nums}.\n- **Counterplay.** {x['counterplay']}\n- **The beat.** {x['beat']}\n")
    out["gadgets_detail"] = "\n".join(D)
    # ---- arenas
    for a in ARENAS:
        T = ["| Time | Event | Pieces |", "|---|---|---|"]
        for (t, ev, ids) in sorted(a["timeline"], key=lambda e: e[0]):
            T.append(f"| {t//60}:{t%60:02d} | {ev.replace('_', ' ')} | {', '.join(ids)} |")
        out[f"timeline_{a['id']}"] = "\n".join(T)
        C = ["| Chunk | Group | HP | Top span x | Top y |", "|---|---|---|---|---|"]
        for c in a["chunks"]:
            C.append(f"| {c['id']} | {c['group']} | {c['hp']} | {c['poly'][0][0]:g} to {c['poly'][1][0]:g} | {c['poly'][0][1]:g} to {c['poly'][1][1]:g} |")
        out[f"chunks_{a['id']}"] = "\n".join(C)
    for k, v in out.items():
        open(os.path.join(TABLES, k + ".md"), "w").write(v + "\n")
    # ---- JSON
    json.dump(TUNING, open(os.path.join(DATA, "tuning.json"), "w"), indent=1)
    json.dump(chars_json, open(os.path.join(DATA, "fighters.json"), "w"), indent=1)
    json.dump({"rules": GADGET_RULES, "gadgets": GADGETS}, open(os.path.join(DATA, "gadgets.json"), "w"), indent=1)
    json.dump([{**a, "timeline": [{"t": t, "event": e, "ids": i} for (t, e, i) in sorted(a["timeline"], key=lambda e: e[0])]} for a in ARENAS], open(os.path.join(DATA, "arenas.json"), "w"), indent=1)
    json.dump(PALETTE, open(os.path.join(DATA, "palette.json"), "w"), indent=1)
    return out, chars_json

if __name__ == "__main__":
    out, cj = write_tables()
    print(out["ko_summary"]); print(); print(out["sanity"]); print()
    print(out["moves_earl"])
