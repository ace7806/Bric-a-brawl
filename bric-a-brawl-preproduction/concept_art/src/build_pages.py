"""build_pages.py - writes the UI mock-ups, key art and link preview as plain HTML/CSS.
They are real markup on purpose: the implementation team can lift the CSS (base.css) directly.
Run: python3 build_pages.py && node shoot.mjs   (shoot.mjs screenshots every page to ../png)"""
import json, os

SRC = os.path.dirname(os.path.abspath(__file__))
PAGES = []

def page(name, w, h, body, css="", cls="paper"):
    doc = (f"<!doctype html><html><head><meta charset='utf-8'><title>{name}</title><link rel='stylesheet' href='base.css'>"
           f"<style>{css}</style></head><body class='{cls}' style='width:{w}px;height:{h}px'>{body}</body></html>")
    open(os.path.join(SRC, name + ".html"), "w").write(doc)
    PAGES.append({"name": name, "w": w, "h": h})

def backstamp(size=132, c="#24459A"):
    return f"""<svg class="backstamp" viewBox="0 0 200 200" width="{size}" height="{size}">
<defs><path id="arcT" d="M 26,100 a 74,74 0 0,1 148,0"/><path id="arcB" d="M 20,100 a 80,80 0 0,0 160,0"/></defs>
<circle cx="100" cy="100" r="96" fill="none" stroke="{c}" stroke-width="3"/><circle cx="100" cy="100" r="89" fill="none" stroke="{c}" stroke-width="1"/>
<circle cx="100" cy="100" r="55" fill="none" stroke="{c}" stroke-width="1.5"/>
<text font-family="Courier Prime" font-weight="700" font-size="15.5" letter-spacing="3.2" fill="{c}"><textPath href="#arcT" startOffset="50%" text-anchor="middle">THE MANTEL POTTERY</textPath></text>
<text font-family="Courier Prime" font-weight="700" font-size="12.5" letter-spacing="2.4" fill="{c}"><textPath href="#arcB" startOffset="50%" text-anchor="middle">FINE BONE OF CONTENTION</textPath></text>
<path d="M 72,82 q -16,-10 -12,-28 q 6,14 20,18 z M 128,82 q 16,-10 12,-28 q -6,14 -20,18 z" fill="{c}"/>
<text x="100" y="122" text-anchor="middle" font-family="Fraunces" font-weight="900" font-size="50" fill="{c}" style="font-variation-settings:'SOFT' 100,'WONK' 1,'opsz' 144">B·B</text>
</svg>"""

def tag(n, name, pct, stocks, lost, gilt, gadget=None, ammo=None, cls="", extra=""):
    pips = "".join(f"<i style='background:var(--p{n})' class='{'lost' if i >= stocks - lost else ''}'></i>" for i in range(stocks))
    gad = f"<div class='gad'><img src='img/gadget_{gadget}.png'><b>{ammo}</b></div>" if gadget else ""
    return (f"<div class='tag {cls}'><div class='who'><span class='disc' style='background:var(--p{n})'>{n}</span><span>{name}</span>{extra}</div>"
            f"<div class='pct'>{pct}<small>%</small></div><div class='side'>{gad}<div class='stocks'>{pips}</div></div>"
            f"<div class='gilt'><i style='width:{gilt}%'></i></div></div>")

# ------------------------------------------------------------------ key art + link preview
PLAQUE = """
.plaque { position:absolute; background: var(--paper); border: 2px solid var(--ink); border-radius: 10px; box-shadow: 0 6px 0 rgba(43,38,35,.85), 0 18px 40px rgba(43,38,35,.35); }
.plaque .inner { border: 1px solid rgba(43,38,35,.6); border-radius: 6px; margin: 7px; padding: 20px 26px 20px; display:flex; gap: 20px; align-items:center; }
.word { color: var(--cobalt); } .strap { font-family: var(--display); font-style: italic; font-variation-settings: "SOFT" 100, "opsz" 40; font-weight: 500; }
"""
page("key_art", 1600, 840, f"""
<img src="img/key_art_render.png" style="position:absolute;inset:0;width:1600px;height:840px">
<div class="plaque paper" style="right:40px;top:34px;width:548px"><div class="inner" style="padding:16px 20px;gap:16px">
  {backstamp(122)}
  <div><div class="caps" style="font-size:12px">Lots 1 to 4 &nbsp;·&nbsp; sold without reserve</div>
  <div class="display word" style="font-size:72px;margin:4px 0 6px">BRIC-A-<br>BRAWL</div>
  <div class="strap" style="font-size:20px">A party fighter for ornaments with grudges.</div></div>
</div></div>
<div class="plaque paper" style="left:40px;bottom:36px"><div class="inner" style="padding:10px 20px;gap:14px">
  <span class="type" style="font-size:17px;font-weight:700">2 to 8 players</span><span style="opacity:.4">|</span>
  <span class="type" style="font-size:17px;font-weight:700">one link</span><span style="opacity:.4">|</span>
  <span class="type" style="font-size:17px;font-weight:700">nothing to install</span></div></div>
""", PLAQUE, cls="")

page("discord_preview", 1200, 630, f"""
<img src="img/key_art_render.png" style="position:absolute;left:-190px;top:-60px;width:1420px">
<div class="plaque paper" style="right:30px;top:28px;width:500px"><div class="inner" style="padding:14px 18px;gap:14px">
  {backstamp(108)}
  <div><div class="display word" style="font-size:64px;margin:0 0 4px">BRIC-A-<br>BRAWL</div>
  <div class="strap" style="font-size:18px">A party fighter for ornaments with grudges.</div></div>
</div></div>
<div class="plaque paper" style="left:34px;bottom:30px"><div class="inner" style="padding:10px 18px;gap:12px">
  <span class="type" style="font-size:19px;font-weight:700">2 to 8 players</span><span style="opacity:.4">|</span>
  <span class="type" style="font-size:19px;font-weight:700">click to join</span><span style="opacity:.4">|</span>
  <span class="type" style="font-size:19px;font-weight:700">nothing to install</span></div></div>
""", PLAQUE, cls="")

page("discord_embed_mock", 900, 560, """
<div style="position:absolute;inset:0;background:#313338"></div>
<div style="position:absolute;left:28px;top:22px;right:28px;color:#dbdee1;font-family:var(--text)">
  <div style="display:flex;gap:14px;align-items:flex-start">
    <div style="width:40px;height:40px;border-radius:50%;background:#A3312B;flex:none"></div>
    <div><div style="font-weight:600;color:#f2f3f5;font-size:15px">Suspicious Tureen <span style="font-weight:400;color:#949ba4;font-size:12px;margin-left:6px">Today at 23:04</span></div>
    <div style="font-size:15px;margin:2px 0 8px">click this <span style="color:#00a8fc">https://example.github.io/bric-a-brawl/#r=chipped-gravy-boat</span></div>
    <div style="background:#2b2d31;border-left:4px solid #24459A;border-radius:4px;padding:12px 16px 16px;width:520px">
      <div style="font-size:12px;color:#b5bac1">bric-a-brawl</div>
      <div style="font-weight:600;color:#00a8fc;font-size:16px;margin:4px 0">BRIC-A-BRAWL</div>
      <div style="font-size:14px;line-height:1.35;color:#dbdee1">A party fighter for ornaments with grudges. 2 to 8 players, one link, nothing to install. Click to join.</div>
      <img src="../png/discord_preview.png" style="width:488px;border-radius:6px;margin-top:12px">
    </div></div>
  </div>
</div>
<div style="position:absolute;left:28px;bottom:10px;color:#949ba4;font-family:var(--type);font-size:11px">Mock of a generic chat unfurl, to check the card at real size. Not a Discord screenshot.</div>
""", cls="")

# ------------------------------------------------------------------ title
page("ui_title", 1280, 720, f"""
<img src="img/lobby_saucer.png" style="position:absolute;left:300px;top:0;width:1280px;height:720px">
<div style="position:absolute;left:0;top:0;width:560px;height:720px;background:linear-gradient(90deg,var(--paper) 78%,rgba(243,237,226,0))" class="paper"></div>
<div style="position:absolute;left:56px;top:44px;width:440px">
  <div style="display:flex;align-items:center;gap:14px">{backstamp(96)}<div class="caps">The Mantel Auction Rooms<br>Catalogue of the evening sale</div></div>
  <div class="display" style="font-size:96px;color:var(--cobalt);margin:22px 0 8px">BRIC-A-<br>BRAWL</div>
  <div class="serif" style="font-style:italic;font-size:23px;margin-bottom:26px">A party fighter for ornaments with grudges.</div>
  <div style="display:flex;flex-direction:column;gap:16px;align-items:flex-start">
    <div class="btn primary">Open a room <span class="type" style="font-size:12px;opacity:.8;font-weight:400">copies the link for you</span></div>
    <div style="display:flex;gap:10px;align-items:center">
      <div class="btn">Join</div>
      <div class="type" style="border-bottom:2px solid var(--ink);font-size:20px;padding:6px 4px;width:270px;color:var(--ink-soft)">chipped-gravy-boat<span style="border-left:2px solid var(--cobalt);margin-left:2px">&nbsp;</span></div>
    </div>
  </div>
  <hr class="rule" style="margin:28px 0 12px">
  <div style="display:flex;gap:22px" class="type"><span><u>How to play</u></span><span><u>Settings</u></span><span><u>Credits and licences</u></span></div>
</div>
<div class="caps" style="position:absolute;left:56px;bottom:26px">2 to 8 players &nbsp;·&nbsp; one link &nbsp;·&nbsp; nothing to install &nbsp;·&nbsp; v0.1.0 &nbsp;·&nbsp; protocol 1</div>
<div style="position:absolute;right:30px;bottom:24px;background:var(--paper);border:1.5px solid var(--ink);border-radius:10px;padding:10px 14px;box-shadow:0 3px 0 var(--ink)" class="type">
  <div class="caps" style="margin-bottom:6px">You can already move</div>
  <span class="key">W</span><span class="key">A</span><span class="key">S</span><span class="key">D</span> move &nbsp; <span class="key">Space</span> jump &nbsp; <span class="key">J</span> hit &nbsp; <span class="key">L</span> special &nbsp; <span class="key">Shift</span> guard</div>
""", cls="")

# ------------------------------------------------------------------ lobby
LOBBY_CSS = """
.card { position:absolute; background: var(--paper); border: 1.5px solid var(--ink); border-radius: 10px; box-shadow: 0 3px 0 var(--ink), 0 12px 24px rgba(43,38,35,.22); }
.row { display:grid; grid-template-columns: 30px 1fr auto auto; gap: 10px; align-items:center; padding: 7px 0; border-top: 1px solid rgba(43,38,35,.25); }
.row:first-of-type { border-top: 0; } .row .nm { font-weight:600; } .row .sub { font-family: var(--type); font-size: 11px; color: var(--ink-soft); text-transform: uppercase; letter-spacing: .06em; }
.bars { display:inline-flex; gap:2px; align-items:flex-end; height:14px; } .bars i { width:4px; background: var(--ok); display:block; border-radius:1px; } .bars i.off { background: rgba(43,38,35,.2); } .bars.warn i:not(.off) { background: var(--warn); }
.chip { display:inline-block; font-family: var(--type); font-size: 12px; border: 1.5px solid var(--ink); border-radius: 999px; padding: 3px 12px 2px; background:#fff; }
.chip.on { background: var(--ink); color: #fff; }
"""
def lot_row(n, name, sub, ms, bars, status, warn=False):
    b = "".join(f"<i style='height:{4 + 3 * i}px' class='{'off' if i >= bars else ''}'></i>" for i in range(4))
    return (f"<div class='row'><span class='disc' style='background:var(--p{n})'>{n}</span><div><div class='nm'>{name}</div><div class='sub'>{sub}</div></div>"
            f"<div class='type' style='font-size:12px;color:var(--ink-soft)'>{ms}</div><div style='display:flex;gap:8px;align-items:center'><span class='bars {'warn' if warn else ''}'>{b}</span><span class='type' style='font-size:12px;width:78px'>{status}</span></div></div>")
page("ui_lobby", 1280, 720, f"""
<img src="img/lobby_saucer.png" style="position:absolute;inset:0;width:1280px;height:720px">
<div class="card paper" style="left:24px;top:22px;padding:12px 16px 14px;width:400px">
  <div class="caps">Room</div>
  <div class="display" style="font-size:34px;color:var(--cobalt);margin:2px 0 10px">chipped-gravy-boat</div>
  <div style="display:flex;gap:10px;align-items:center"><div class="btn small primary" style="white-space:nowrap">Copy invite</div><span class="type" style="font-size:12px;color:var(--ok);font-weight:700">Copied. Paste it in Discord.</span></div>
</div>
<div class="card paper" style="right:24px;top:22px;width:372px;padding:12px 16px 8px">
  <div style="display:flex;justify-content:space-between;align-items:baseline"><div class="caps">Lots in the room</div><div class="caps">5 of 8</div></div>
  <hr class="rule" style="margin:6px 0 2px">
  {lot_row(1, "Slightly Chipped Gravy Boat", "Earl &nbsp;·&nbsp; host", "you", 4, "on platter")}
  {lot_row(2, "Suspicious Tureen", "Grog", "31 ms", 4, "on platter")}
  {lot_row(3, "Unsigned Vase", "Nesta", "44 ms", 3, "on platter")}
  {lot_row(4, "Property of a Gentleman", "Moss", "118 ms", 2, "wandering", warn=True)}
  {lot_row(7, "Three Legs, One Repaired", "Earl", "...", 0, "connecting")}
  <div class="row" style="grid-template-columns:1fr auto"><span class="type" style="font-size:12px;color:var(--ink-soft)">Fewer than four? Add a bot.</span><span class="chip">+ bot</span></div>
</div>
<div class="card paper" style="left:50%;transform:translateX(-50%);bottom:26px;padding:12px 26px 14px;text-align:center;width:640px">
  <div class="display" style="font-size:30px">Everyone on the platter to start</div>
  <div style="display:flex;gap:8px;justify-content:center;margin-top:8px;align-items:center">
    <span class="disc" style="background:var(--p1)">1</span><span class="disc" style="background:var(--p2)">2</span><span class="disc" style="background:var(--p3)">3</span>
    <span class="disc" style="background:transparent;border:2px dashed var(--p4);color:var(--p4);box-shadow:none">4</span><span class="disc" style="background:transparent;border:2px dashed var(--p7);color:var(--p7);box-shadow:none">7</span>
    <span class="type" style="font-size:13px;margin-left:8px;color:var(--ink-soft)">3 of 5 &nbsp;·&nbsp; starts 3 s after the last one steps on</span></div>
</div>
<div style="position:absolute;left:24px;bottom:26px;display:flex;flex-direction:column;gap:6px;align-items:flex-start">
  <span class="chip on">Free-for-all</span><span class="chip">Teams</span><span class="chip">3 stocks</span><span class="chip">Fragile: off</span><span class="chip">First arena: The Willow Plate</span></div>
<div class="card paper type" style="right:24px;bottom:26px;padding:9px 12px;font-size:12px;line-height:1.9">
  <span class="key">E</span> at the stand: the Catalogue (change fighter)<br><span class="key">T</span> taunt &nbsp; <span class="key">Tab</span> frame data &nbsp; <span class="key">Esc</span> settings</div>
""", LOBBY_CSS, cls="")

# ------------------------------------------------------------------ character select
F = json.load(open(os.path.join(SRC, "..", "..", "data", "fighters.json")))
BARS = {"earl": (3, 3, 3, 3, 3), "grog": (5, 2, 3, 1, 5), "nesta": (2, 5, 2, 4, 2), "moss": (2, 2, 5, 3, 3)}
BLURB = {"earl": "Teapot, bone china, with lid. Missing nothing, as he will tell you.", "grog": "Bull, black basalt. Heavy. Souvenir of somewhere.",
         "nesta": "Nesting doll, set of three. Originally seven. Do not ask.", "moss": "Garden gnome, terracotta, weathered. Rod not original."}
TRICK = {"earl": "Steep: hold down + Special to store one Piping charge. Your next special is upgraded.", "grog": "Stampede: carries the first fighter he touches. He does not stop at ledges.",
         "nesta": "Shed: pop out one size smaller. The empty shell stays behind as a weapon.", "moss": "Cast: hooks fighters, gadgets and bits of island. Reel them in or yank them over your head."}
SEL_CSS = LOBBY_CSS + """
.spread { position:absolute; left:70px; top:54px; width:1140px; height:612px; background: var(--paper); border: 2px solid var(--ink); border-radius: 8px; box-shadow: 0 6px 0 var(--ink), 0 30px 60px rgba(43,38,35,.5); display:grid; grid-template-columns: 372px 1fr; }
.spread::after { content:""; position:absolute; left:372px; top:0; bottom:0; width:26px; background: linear-gradient(90deg, rgba(43,38,35,.16), rgba(43,38,35,0)); }
.lot { display:grid; grid-template-columns: 84px 1fr; gap: 10px; align-items:center; padding: 8px 10px; border: 1.5px solid transparent; border-radius: 8px; }
.lot.sel { border-color: var(--ink); background: #fff; box-shadow: 0 3px 0 var(--ink); }
.lot img { width: 84px; height: 84px; object-fit: contain; }
.bar { display:grid; grid-template-columns: 78px 1fr; gap: 10px; align-items:center; margin: 5px 0; } .bar .pips { display:flex; gap:4px; } .bar .pips i { width: 26px; height: 9px; border-radius: 5px; border: 1.5px solid var(--ink); display:block; } .bar .pips i.on { background: var(--ink); }
.sw { width: 30px; height: 30px; border-radius: 50%; box-shadow: inset 0 -4px 0 rgba(0,0,0,.2), inset 0 3px 0 rgba(255,255,255,.4); position:relative; } .sw.sel { outline: 3px solid var(--ink); outline-offset: 3px; } .sw.taken { opacity:.6; filter: saturate(.55); } .sw.taken::after { content: attr(data-n); position:absolute; inset:0; display:flex; align-items:center; justify-content:center; color:#fff; font-family:var(--type); font-weight:700; font-size:13px; }
"""
def lot_card(i, k, sel=False):
    d = F[k]; diff = "●" * d["difficulty"] + "○" * (3 - d["difficulty"])
    return (f"<div class='lot {'sel' if sel else ''}'><img src='img/{k}_game.png'><div><div class='caps'>Lot {i}</div><div class='display' style='font-size:30px'>{d['name']}</div>"
            f"<div class='type' style='font-size:11.5px;color:var(--ink-soft)'>{d['role']} &nbsp; {diff}</div></div></div>")
def bar(label, n):
    return f"<div class='bar'><span class='caps'>{label}</span><span class='pips'>{''.join(f'<i class={chr(34)}on{chr(34)}></i>' if i < n else '<i></i>' for i in range(5))}</span></div>"
k = "grog"; b = BARS[k]
page("ui_charselect", 1280, 720, f"""
<img src="img/lobby_saucer.png" style="position:absolute;inset:0;width:1280px;height:720px;filter:brightness(.55) saturate(.7)">
<div class="spread paper">
  <div style="padding:22px 20px 16px 26px">
    <div class="caps">The Catalogue</div><div class="display" style="font-size:40px;margin:2px 0 4px">Tonight's lots</div><hr class="rule2" style="margin:8px 0 10px">
    {lot_card(1, "earl")}{lot_card(2, "grog", True)}{lot_card(3, "nesta")}{lot_card(4, "moss")}
    <hr class="rule" style="margin:10px 0 8px"><div class="type" style="font-size:12px;line-height:1.9"><span class="key">W</span><span class="key">S</span> browse &nbsp; <span class="key">A</span><span class="key">D</span> glaze &nbsp; <span class="key">J</span> take this lot &nbsp; <span class="key">E</span> close</div>
  </div>
  <div style="padding:22px 30px 16px 44px;position:relative">
    <div class="caps">Lot 2 &nbsp;·&nbsp; {F[k]['ornament']}</div>
    <div class="display" style="font-size:112px;margin:0 0 2px">{F[k]['name']}</div>
    <div class="serif" style="font-style:italic;font-size:19px;width:360px">{BLURB[k]}</div>
    <img src="img/grog_game.png" style="position:absolute;right:6px;top:36px;width:380px;height:380px">
    <div style="margin-top:22px;width:330px">{bar("Weight", b[0])}{bar("Speed", b[1])}{bar("Reach", b[2])}{bar("Recovery", b[3])}{bar("Launch", b[4])}</div>
    <div style="margin-top:16px;border:1.5px solid var(--ink);border-radius:8px;padding:10px 14px;background:#fff;width:700px"><span class="caps">His trick</span><div style="font-size:16px;margin-top:2px">{TRICK[k]}</div></div>
    <div style="margin-top:16px"><div class="caps" style="margin-bottom:8px">Glaze (your colour) &nbsp;·&nbsp; numbers show who has taken it</div>
      <div style="display:flex;gap:14px;align-items:center">
        <div class="sw taken" data-n="1" style="background:var(--p1)"></div><div class="sw sel" style="background:var(--p2)"></div><div class="sw taken" data-n="3" style="background:var(--p3)"></div>
        <div class="sw taken" data-n="4" style="background:var(--p4)"></div><div class="sw" style="background:var(--p5)"></div><div class="sw" style="background:var(--p6)"></div><div class="sw taken" data-n="7" style="background:var(--p7)"></div><div class="sw" style="background:var(--p8)"></div>
        <span class="type" style="font-size:13px;margin-left:8px">Oxblood, dots</span></div></div>
    <div class="caps" style="position:absolute;right:30px;bottom:16px">The lobby keeps running behind this page</div>
  </div>
</div>
""", SEL_CSS, cls="")

# ------------------------------------------------------------------ in-match HUD (over the style frame)
HUD_CSS = """
.timer { position:absolute; left:50%; top:14px; transform:translateX(-50%); background: var(--paper); border: 1.5px solid var(--ink); border-radius: 12px; padding: 4px 18px 8px; text-align:center; box-shadow: 0 3px 0 var(--ink), 0 10px 20px rgba(43,38,35,.2); }
.strip { display:flex; gap:3px; justify-content:center; margin-top:4px; } .strip i { width: 13px; height: 8px; border-radius: 2px; border: 1.2px solid var(--ink); background: #fff; display:block; } .strip i.gone { background: transparent; border-style: dashed; opacity:.45; } .strip i.crazed { background: var(--warn); } .strip i.falling { background: var(--stamp); }
.feed { position:absolute; right:16px; top:14px; display:flex; flex-direction:column; gap:6px; align-items:flex-end; } .feed div { background: rgba(243,237,226,.92); border: 1.2px solid var(--ink); border-radius: 8px; padding: 3px 10px 2px; font-family: var(--type); font-size: 12px; }
.tags { position:absolute; left:0; right:0; bottom:14px; display:flex; gap:14px; justify-content:center; }
.bubble { position:absolute; width:74px; height:74px; border-radius:50%; background: var(--paper); border: 3px solid var(--p1); box-shadow: 0 3px 0 rgba(43,38,35,.7); overflow:hidden; } .bubble img { width: 96px; height: 96px; margin: -10px 0 0 -12px; }
"""
page("ui_hud", 1280, 720, f"""
<img src="img/style_frame_willow.png" style="position:absolute;inset:0;width:1280px;height:720px">
<div class="timer paper"><div class="caps">Lot 7 &nbsp;·&nbsp; The Willow Plate</div><div class="display" style="font-size:44px">1:14</div>
  <div class="strip"><i class="gone"></i><i class="crazed"></i><i></i><i></i><i class="crazed"></i><i></i><i></i><i></i><i></i><i></i><i class="crazed"></i><i class="falling"></i></div></div>
<div class="feed"><div><b style="color:var(--p8)">Lot 8</b> gone &nbsp;·&nbsp; Bellows (Lot 3)</div><div><b style="color:var(--p7)">Lot 7</b> gone &nbsp;·&nbsp; fell with the rim</div></div>
<div style="position:absolute;left:16px;top:14px;background:rgba(243,237,226,.92);border:1.2px solid var(--ink);border-radius:8px;padding:3px 10px 2px" class="type"><span style="font-size:12px">Teaspoons: <b style="color:var(--p7)">7</b> <b style="color:var(--p8)">8</b> &nbsp; tap in 3 s</span></div>
<div class="tags">
  {tag(1, "Gravy Boat", 87, 3, 1, 87, cls="danger hot")}
  {tag(2, "Sus. Tureen", 34, 3, 0, 34)}
  {tag(3, "Unsigned Vase", 112, 3, 1, 100, gadget="bellows", ammo=4, cls="danger")}
  {tag(4, "Gentleman", 61, 3, 1, 76)}
  {tag(5, "Three Legs", 23, 3, 0, 23)}
  {tag(6, "After Meissen", 45, 3, 2, 60)}
</div>
""", HUD_CSS, cls="")

# ------------------------------------------------------------------ results
RES_CSS = LOBBY_CSS + """
.photo { position:absolute; left:44px; top:96px; width:596px; background:#fff; padding: 12px 12px 14px; border: 1.5px solid var(--ink); box-shadow: 0 5px 0 rgba(43,38,35,.8), 0 20px 40px rgba(43,38,35,.3); transform: rotate(-1.6deg); }
.delft { position:relative; width:572px; height:300px; overflow:hidden; background:#F4F1EA; } .delft img { width: 600px; margin: -8px 0 0 -20px; filter: grayscale(1) contrast(1.9) brightness(1.08); } .delft::after { content:""; position:absolute; inset:0; background:#1E3A8A; mix-blend-mode: screen; }
table { border-collapse: collapse; width: 100%; } th { text-align:left; font-family: var(--type); font-size: 10.5px; text-transform: uppercase; letter-spacing: .1em; color: var(--ink-soft); font-weight: 400; padding: 4px 6px; border-bottom: 1px solid var(--ink); }
td { padding: 9px 6px; border-bottom: 1px solid rgba(43,38,35,.22); font-size: 14.5px; vertical-align: middle; } td.n { font-family: var(--type); text-align:right; } td .sub { font-family: var(--type); font-size: 11px; color: var(--ink-soft); }
.wins i { display:inline-block; width: 11px; height: 11px; border-radius: 50%; border: 1.5px solid var(--ink); margin-right: 3px; } .wins i.on { background: var(--gilt); }
"""
def res_row(place, n, name, fighter, kos, falls, dmg, note, wins):
    w = "".join(f"<i class='{'on' if i < wins else ''}'></i>" for i in range(3))
    return (f"<tr><td class='n'>{place}</td><td><span class='disc' style='background:var(--p{n})'>{n}</span></td><td><b>{name}</b><div class='sub'>{fighter}</div></td>"
            f"<td class='n'>{kos}</td><td class='n'>{falls}</td><td class='n'>{dmg}%</td><td style='font-size:13px;font-style:italic' class='serif'>{note}</td><td class='wins'>{w}</td></tr>")
page("ui_results", 1280, 720, f"""
<div style="position:absolute;left:44px;top:26px"><div class="caps">Lot 7 &nbsp;·&nbsp; The Willow Plate &nbsp;·&nbsp; hammer fell at 1:52</div><div class="display" style="font-size:52px">Sold to Suspicious Tureen</div></div>
<div class="photo"><div class="delft"><img src="img/key_art_render.png"></div>
  <div style="display:flex;justify-content:space-between;align-items:flex-end;margin-top:10px"><div><div class="type" style="font-size:13px;font-weight:700">Lot 1, Slightly Chipped Gravy Boat. Gone: Stampede.</div><div class="caps" style="margin-top:2px">bric-a-brawl &nbsp;·&nbsp; chipped-gravy-boat</div></div>
  <div style="display:flex;gap:8px"><div class="btn small primary">Copy photo</div><div class="btn small">Save</div></div></div></div>
<div class="stamp" style="position:absolute;left:452px;top:84px;font-size:58px">Sold</div>
<div style="position:absolute;left:44px;bottom:30px;width:596px" class="type"><div class="caps">Appraisal earned tonight</div><div style="font-size:14px;margin-top:3px"><b>"Buyer's remorse"</b>: left the island with the lot you were carrying. Unlocks the <b>crackle</b> glaze.</div></div>
<div style="position:absolute;left:690px;top:104px;width:548px">
  <table><tr><th></th><th></th><th>Lot</th><th style="text-align:right">KOs</th><th style="text-align:right">Falls</th><th style="text-align:right">Dealt</th><th>For the record</th><th>Wins</th></tr>
  {res_row("1st", 2, "Suspicious Tureen", "Grog", 4, 2, 212, "left the island twice, on purpose", 2)}
  {res_row("2nd", 1, "Slightly Chipped Gravy Boat", "Earl", 2, 3, 176, "rode the horns to the end", 1)}
  {res_row("3rd", 3, "Unsigned Vase", "Nesta", 3, 3, 143, "blew three lots off with one puff", 2)}
  {res_row("4th", 4, "Property of a Gentleman", "Moss", 1, 3, 98, "caught a boot. Kept it.", 0)}
  {res_row("5th", 7, "Three Legs, One Repaired", "Earl", 0, 2, 41, "tapped the last chunk as a teaspoon", 0)}
  {res_row("6th", 8, "After Meissen", "Nesta", 0, 2, 37, "sneezed herself off the rim", 0)}
  </table>
  <div style="display:flex;justify-content:space-between;align-items:center;margin-top:22px">
    <div><div class="caps">Next lot</div><div class="display" style="font-size:30px">High Tea &nbsp;<span style="color:var(--cobalt)">in 6</span></div>
      <div style="width:260px;height:6px;border-radius:3px;background:rgba(43,38,35,.16);margin-top:6px"><div style="width:25%;height:100%;background:var(--cobalt);border-radius:3px"></div></div></div>
    <div style="display:flex;gap:10px"><div class="btn small">Back to lobby</div><div class="btn small">Catalogue</div></div></div>
  <div class="caps" style="margin-top:14px">First to three wins takes the sale</div>
</div>
""", RES_CSS)

# ------------------------------------------------------------------ connection error
ERR_CSS = LOBBY_CSS + """.node { position:absolute; display:flex; flex-direction:column; align-items:center; gap:3px; width:120px; margin-left:-60px; margin-top:-16px; text-align:center; } .node .disc { width:34px; height:34px; font-size:17px; } .node span.l { font-family: var(--type); font-size: 10.5px; line-height:1.15; }"""
import math
nodes = [(1, "You", 0), (2, "Suspicious Tureen<br>(host)", 1), (3, "Unsigned Vase", 2), (4, "Gentleman", 3), (7, "Three Legs", 4)]
cx, cy, R = 250, 190, 138
pos = {n: (cx + R * math.sin(2 * math.pi * i / 5), cy - R * math.cos(2 * math.pi * i / 5)) for n, _, i in nodes}
lines = ""
for a in pos:
    for b2 in pos:
        if a < b2:
            bad = (a, b2) in ((1, 2), (1, 4))
            lines += f"<line x1='{pos[a][0]:.0f}' y1='{pos[a][1]:.0f}' x2='{pos[b2][0]:.0f}' y2='{pos[b2][1]:.0f}' stroke='{'#B5432E' if bad else '#2B2623'}' stroke-width='{3 if bad else 1.6}' {'stroke-dasharray=\"3 8\"' if bad else 'opacity=\"0.45\"'}/>"
nd = "".join(f"<div class='node' style='left:{pos[n][0]:.0f}px;top:{pos[n][1]:.0f}px'><span class='disc' style='background:var(--p{n})'>{n}</span><span class='l'>{lab}</span></div>" for n, lab, _ in nodes)
page("ui_connection_error", 1280, 720, f"""
<div style="position:absolute;left:64px;top:46px;width:600px">
  <div class="caps">Room chipped-gravy-boat &nbsp;·&nbsp; you are Lot 1</div>
  <div class="display" style="font-size:62px;margin:6px 0 14px">You and the host can't shake hands.</div>
  <div style="font-size:18px;line-height:1.45">Your network and the host's network both refuse direct connections, so the two of you can't reach each other. Nobody did anything wrong, and this game has no relay server to go through.</div>
  <div style="margin-top:24px;border:2px solid var(--ink);border-radius:12px;padding:16px 18px;background:#fff;box-shadow:0 4px 0 var(--ink)">
    <div class="caps" style="color:var(--ok)">Quickest fix</div>
    <div style="font-size:18px;margin:4px 0 12px"><b>Unsigned Vase</b> can reach everyone in the room, including you. If they host, you're in.</div>
    <div style="display:flex;gap:12px"><div class="btn primary">Ask Unsigned Vase to host</div><div class="btn">Try again</div></div></div>
  <div style="margin-top:22px"><div class="caps">If that doesn't work, from most to least likely</div>
    <ol style="margin:6px 0 0 20px;font-size:15px;line-height:1.6"><li>Turn off your VPN and reload.</li><li>Office, university and hotel wifi usually block this. Try your phone's hotspot.</li><li>Ask someone on home broadband to open the room.</li></ol></div>
</div>
<div class="card paper" style="right:56px;top:60px;width:500px;height:400px;padding:14px 16px">
  <div style="display:flex;justify-content:space-between"><div class="caps">Who can reach whom</div><div class="caps"><span style="color:var(--stamp)">· · ·</span> blocked</div></div>
  <div style="position:relative;width:500px;height:360px"><svg width="500" height="360" style="position:absolute;left:0;top:0">{lines}</svg>{nd}</div>
</div>
<div class="card paper type" style="right:56px;top:482px;width:500px;padding:12px 16px;font-size:12px;line-height:1.6">
  <div style="display:flex;justify-content:space-between;align-items:center"><div class="caps">For whoever is helping you</div><span class="chip">Copy diagnostics</span></div>
  BB-ICE-FAILED &nbsp;·&nbsp; build 0.1.0 &nbsp;·&nbsp; protocol 1<br>relays 4 of 5 reached &nbsp;·&nbsp; STUN answered &nbsp;·&nbsp; candidates: host, srflx (no relay)<br>peers 3 of 4 direct &nbsp;·&nbsp; turnConfigured: false</div>
<div class="caps" style="position:absolute;left:64px;bottom:28px">Roughly one connection in eight fails like this without a relay. Adding one later is a single config entry.</div>
""", ERR_CSS)

json.dump(PAGES, open(os.path.join(SRC, "pages_ui.json"), "w"))
print(len(PAGES), "ui pages written")
