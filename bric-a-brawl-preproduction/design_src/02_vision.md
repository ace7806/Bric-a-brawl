# 2. Vision

## 2.1 The title

**BRIC-A-BRAWL.** Bric-a-brac is the word for the small ornaments on a mantelpiece. These ones fight.

"Fracture" stays as nothing: the repository, the Trystero app id and the page title all use `bric-a-brawl`. I dropped three better-sounding names first because each is a multiplayer game on Steam right now (see 1.4, U8).

## 2.2 Elevator pitch

Paste one link in Discord. Ten seconds later, eight ornaments are punching each other off a floating dinner plate that is cracking under their feet. A teapot with a monocle, a basalt bull, a nesting doll that gets smaller and angrier, and a gnome who would rather be fishing. Bellows, plungers and champagne corks fall from the sky on doilies. Two minutes a round. Nobody installs anything.

## 2.3 Vision statement

Somewhere above every house is the place where things go when they fall behind the furniture. The ornaments call it the Mantel. It is made of every plate that was ever dropped: drifting islands of glazed earthenware, held together by habit and gold glue. Ornaments that get knocked off shelves arrive here chipped and furious, and settle it the only way bric-a-brac can, by knocking each other off again. An unseen auctioneer calls the lots. Losers are "gone". The winner is "sold".

That fiction exists to make four production facts feel like choices.

**The world is ceramic because ceramic is what we can make.** A pot is a profile spun around an axis. So is every model a script can write well. Glaze is a single reflected window, which is the cheapest material a browser can draw. And ceramic breaks into flat-sided shards with raw clay inside, which is exactly what a low-polygon fracture looks like. Nothing in this game pretends to be something the pipeline cannot build.

**The island breaks because the round needs a clock.** A two-minute party round cannot depend on eight strangers to fighting games landing kill moves. The island leaves on a schedule and leaves faster when people are slammed into it. The space shrinks, launches get shorter, and the round ends on time with everybody shouting.

**The weapons shove because shoving is funny and damage is not.** Every gadget moves somebody: pushes, pulls, launches, sticks, reverses. They do almost no damage. A newcomer with a pair of bellows is dangerous in ten seconds. A veteran who parries the gust back is dangerous for a week.

**The fighters are tight because the world is loose.** The ornaments have real frame data: startup, active, recovery, cancel windows, a five-frame parry. They are never ragdolls. All the physical chaos is in the ground and the junk, so skill has something solid to stand on and the netcode has something predictable to send.

What it is not: a ranked game, a live service, a ragdoll toy, a Smash clone with the names changed. It is a thing a friend group opens at 11pm instead of arguing about what to play.

## 2.4 Pillars

Every later decision names the pillar it serves. If a feature serves none, it is cut.

| # | Pillar | Meaning | A decision it forces |
|---|---|---|---|
| P1 | **The ten-second rule** | From clicking the link to hitting a friend: ten seconds. From never having played a fighter to doing something that makes the call laugh: ten more. | You spawn into a playable lobby before the network has finished connecting. Mashing Attack produces a three-hit string that launches. |
| P2 | **Everything chips** | The world keeps score in cracks. Fighters crack as they take damage. The island cracks where people land. Nothing resets to pristine. | Damage percent is drawn on the body. Slamming someone into the floor damages the floor. The arena is the timer. |
| P3 | **Shove, don't stab** | Position is the only health bar. Every tool exists to move someone. | Gadgets do 1 to 9 percent. Guard does not stop you sliding off the edge. The strongest moves are the ones with the best launch, not the most damage. |
| P4 | **Honest frames** | The depth is real and it is written down. Same input, same result, every time, at any ping we support. | Frame data ships in the game. Nothing is plus on block. Latency is handled by rules the player can learn, not by luck. |
| P5 | **One link** | No install, no account, no server, no second step. Sharing the game is playing the game. | Static hosting, peer-to-peer, room codes you can say out loud, a result screen that is one click from a Discord post. |

There is a sixth rule that is not a pillar because players never see it: **small machine, small game**. Everything must be built, tested and rendered on two CPU cores. That is why there are four fighters and not eight, three arenas and not six, and no feature whose correctness can only be judged by eye or ear without a number attached.

## 2.5 Target player and target moment

**The player** is one of five to eight friends in their twenties and thirties who are already in a voice call. Two of them have a main in some fighting game. Three of them have not touched one since a console at a friend's house. One is on a work laptop with integrated graphics and a trackpad, and will plug in a mouse but not a controller. Nobody will read a tutorial.

**The moment** is 11pm on a weeknight. Someone pastes a link and says "click this". The design target is what happens in the next ninety seconds:

| Time | What they do | What the game has to do |
|---|---|---|
| 0:00 | Click the link in Discord. | The embed already told them it is a party fighter for 2 to 8 and that nothing installs. |
| 0:04 | Page is up. They are a teapot on a saucer. | No menu. Movement works. Friends pop in as they connect. |
| 0:10 | Press a key. The teapot hits someone. Crockery noise. | First laugh on the call. |
| 0:25 | Everyone stands on the platter. | Round one starts. Nobody chose a character on purpose yet, and that is fine. |
| 0:40 | Somebody is blown off the island by a pair of bellows. | The auctioneer says "Gone." The victim is now a teaspoon and can tap the island. |
| 2:30 | Round ends on a plate the size of a dinner table. | Freeze, slow motion, the last hit in blue and white. "Sold!" A photo of it is one click from the clipboard. |
| 2:38 | Rematch has already started. | "One more round" was never a decision. |

Sessions are a best-of sequence to three round wins, about fifteen minutes. The game is designed to be closed after forty-five minutes and reopened three nights later with someone saying "I found a thing Nesta can do."

## 2.6 The screenshot moment

**"Sold."** The last hit of a round, frozen for 24 frames and rendered in two colours: cobalt ink on white, like a transfer-printed plate. One ornament is mid-launch with a brushstroke behind it. What is left of the island is splitting under the winner's feet. Shards hang in the air. A red auction stamp lands across the corner, and the loser's lot tag swings off the bottom of the screen.

Three things make it shareable rather than merely pretty:

1. **It is automatic.** The game captures that frame every round. Nobody has to be fast with a screenshot key.
2. **It is one click.** The results screen has a "Copy photo" button that puts a PNG on the clipboard, with both names and the cause on it ("Lot 3, Slightly Chipped Gravy Boat. Gone: Bellows."). Paste into Discord.
3. **It contains the pitch.** A still of a teapot being launched off a breaking plate by a bull explains the game to someone who was not in the call, and the link is in the caption.

The moving version is the same five seconds: the hit, the freeze, the blue-and-white frame, the launch, "Gone." If a clip of this game exists anywhere, it is that.
