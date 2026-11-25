"""build_sheets.py - character sheets, gadget sheet, arena layout maps, palette, silhouette test, architecture diagram.
Everything is generated from data/*.json so the sheets cannot disagree with the design."""
import json, os, math

SRC = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.join(SRC, "..", "..")
D = lambda f: json.load(open(os.path.join(ROOT, "data", f)))
F, G, A, P = D("fighters.json"), D("gadgets.json"), D("arenas.json"), D("palette.json")
TRI = json.load(open(os.path.join(ROOT, "reference", "blender", "out", "tri_counts.json")))
PAGES = []

def page(name, w, h, body, css="", cls="paper"):
    doc = (f"<!doctype html><html><head><meta charset='utf-8'><title>{name}</title><link rel='stylesheet' href='base.css'>"
           f"<style>{css}</style></head><body class='{cls}' style='width:{w}px;height:{h}px'>{body}</body></html>")
    open(os.path.join(SRC, name + ".html"), "w").write(doc); PAGES.append({"name": name, "w": w, "h": h})

SHEET_CSS = """
.hd { position:absolute; left:48px; top:34px; right:48px; display:flex; justify-content:space-between; align-items:flex-end; }
.view { position:relative; width:300px; height:330px; border:1px solid rgba(43,38,35,.5); border-radius:8px; background: linear-gradient(#EFE6D6, #E7DCC8); overflow:hidden; }
.view img { position:absolute; left:-15px; top:0; width:330px; height:330px; } .view .lab { position:absolute; left:10px; top:8px; }
.view .g { position:absolute; left:0; right:0; border-top:1px dashed rgba(36,69,154,.45); } .view .g span { position:absolute; right:6px; top:-13px; font-family:var(--type); font-size:9.5px; color:var(--cobalt); }
.sil img { filter: brightness(0); } .sil { background:#F7F3EA; }
.note h4 { font-family: var(--type); font-size: 11px; text-transform: uppercase; letter-spacing: .12em; color: var(--cobalt); margin: 12px 0 3px; font-weight:700; } .note p, .note li { font-size: 13.5px; line-height: 1.38; } .note ul { margin-left: 16px; }
.kv { display:grid; grid-template-columns: auto auto; gap: 1px 16px; font-family: var(--type); font-size: 12.5px; } .kv b { text-align:right; }
"""
NOTES = {
 "earl": {"lot": 1, "read": "A circle with a spout. The spout is his nose and always points the way he faces; the handle is the back. Nothing else on the roster is round with a point.",
          "expr": ["Permanent scowl: the brows never move. Emotion is carried by the LID.", "Idle: lid rattles every 4 s. Annoyed (above 80%): rattles constantly, a wisp of steam.", "Piping stored: lid hovers 0.05 u and whistles.", "Hit: lid jumps 0.3 u and lands a beat late (secondary motion on a spring)."],
          "pose": ["Attacks lead with the spout or a glove; the body leans in after.", "Lid Pop: lid shoots 0.95 u up on a column of steam, gloves thrown up, body squashes to 0.85.", "Launched: tumbles spout over handle; the lid trails by 6 frames."],
          "parts": "body (with spout, handle, face), lid, 2 gloves, 2 feet", "livery": "Lid, shoulder band, foot ring, gloves, feet. Transferware came in every colour, so he is a red-and-white or green-and-white teapot as needed.", "posecap": "Lid Pop (up-special)"},
 "grog": {"lot": 2, "read": "A horizontal barrel with horns, on four floating hooves. The only quadruped and the only dark body: he reads as a black bar with a stripe of your colour.",
          "expr": ["Gilded brows, fixed. Emotion is carried by the HEAD angle and the nose ring.", "Idle: one front hoof scrapes twice, the ring swings.", "Charging: head drops 24 degrees, ring streams back.", "Hit: head snaps up, ring lags behind."],
          "pose": ["Strikes are head-first; heavies rear up on the back hooves.", "Stampede: body pitched 7 degrees down, hooves splayed in a gallop cycle, dust off the back pair.", "Carrying a fighter: the victim sits across the horns, facing the wrong way."],
          "parts": "body (with tail), head (with horns, ring, ears), 4 hooves", "livery": "Saddle blanket (the widest band on any fighter), front hooves. Body is always black basalt so every colour reads.", "posecap": "Stampede (side-special)"},
 "nesta": {"lot": 3, "read": "A bowling pin with no feet. She never walks: she rocks, slides and rolls. The number of bands round her base is how many of her are left.",
           "expr": ["Painted smile, fixed. Emotion is carried by the WOBBLE: slow and wide when calm, fast and tight when angry.", "Idle: rocks side to side like a weeble, 8 degrees, 1.1 s period.", "Small form: rocks at twice the rate and never quite settles.", "Guard broken: the shell splits at the seam with a pop."],
           "pose": ["Attacks are whole-body: bumps, bobs, spins. Mittens add reach.", "Shed: the old shell tips over, the smaller doll springs 2.2 u straight up, mittens overhead.", "Rolls on her side for Skittle: the face becomes a spinning blur."],
           "parts": "body (face and apron are part of it), 2 mittens. Three sizes are one mesh at scales 1.25 / 1.0 / 0.72", "livery": "Headscarf (the whole upper shell), base bands, mittens.", "posecap": "Shed (down-special): the big shell left behind"},
 "moss": {"lot": 4, "read": "A triangle. The hat is half his height, droops backward, and ends in a bell. The rod doubles his width on one side only.",
          "expr": ["No visible eyes most of the time: they sit under the brim. Emotion is carried by the HAT.", "Idle: checks the line, the hat tip nods.", "Surprised or hit: hat stands straight up for 10 frames.", "Fishing (down-special): sits, hat tips forward over his face."],
          "pose": ["Leans back before every cast, forward after it. The rod tip leads, the line follows on a delay.", "Cast: rod snaps from behind the hat to 42 degrees forward in 3 frames.", "Yank: rod whips overhead; the catch travels the arc of the line."],
          "parts": "body (beard and nose are part of it), hat, 2 mitts, 2 boots, rod (with line and float)", "livery": "Hat, mitts, float. Coat is raw terracotta, belt is ink.", "posecap": "Cast (neutral special)"},
}
GUIDES = {"earl": 1.6, "grog": 1.7, "nesta": 1.5, "moss": 2.07}
SCALE = {"earl": 2.9, "grog": 3.3, "nesta": 2.9, "moss": 3.3}; ZC = {"earl": 0.86, "grog": 0.95, "nesta": 0.78, "moss": 1.12}

def guides(k):
    px = 330 / SCALE[k]                                     # pixels per unit in a 330 px tile
    y0 = 165 + (ZC[k] + 0.03) * px                          # ground line (camera looks slightly down)
    out = f"<div class='g' style='top:{y0:.0f}px'><span>ground</span></div>"
    for u in (1.0, GUIDES[k]):
        out += f"<div class='g' style='top:{y0 - u * px:.0f}px'><span>{u:g} u</span></div>"
    return out

for k in ("earl", "grog", "nesta", "moss"):
    n = NOTES[k]; f = F[k]; s = f["stats"]
    views = "".join(f"<div class='view'><img src='img/{k}_{v}.png'>{guides(k)}<span class='caps lab'>{lab}</span></div>" for v, lab in (("front", "Front"), ("side", "Side (gameplay plane)"), ("game", "In game: 42° toward camera")))
    sils = "".join(f"<div class='view sil' style='width:150px;height:150px'><img src='img/{k}_{v}.png' style='left:-7px;width:165px;height:165px'></div>" for v in ("front", "side", "game"))
    tiny = "".join(f"<img src='img/{k}_{v}.png' style='width:56px;height:56px;filter:brightness(0)'>" for v in ("side", "game"))
    page(f"sheet_{k}", 1600, 1000, f"""
<div class="hd"><div><div class="caps">Lot {n['lot']} &nbsp;·&nbsp; {f['ornament']} &nbsp;·&nbsp; {f['role']}</div><div class="display" style="font-size:104px;color:var(--cobalt)">{f['name']}</div></div>
  <div class="kv"><span>weight</span><b>{s['weight']:g}</b><span>run</span><b>{s['run']:g} u/s</b><span>full hop</span><b>{s['fullHop']:g} u</b><span>triangles</span><b>{TRI[k]['tris']:,}</b><span>rigid parts</span><b>{TRI[k]['parts']}</b></div></div>
<hr class="rule2" style="position:absolute;left:48px;right:48px;top:176px">
<div style="position:absolute;left:48px;top:196px;display:flex;gap:14px">{views}</div>
<div style="position:absolute;left:48px;top:540px"><div class="caps" style="margin-bottom:6px">Silhouette test: must be nameable in black at 150 px and at 56 px</div>
  <div style="display:flex;gap:14px;align-items:flex-end">{sils}<div style="display:flex;gap:6px;align-items:flex-end;padding:0 0 4px 6px">{tiny}</div></div></div>
<div style="position:absolute;left:48px;top:738px;width:928px"><div class="caps" style="margin-bottom:4px">Livery test: all eight player colours</div>
  <img src="img/{k}_livery.png" style="width:928px;border:1px solid rgba(43,38,35,.5);border-radius:8px;background:linear-gradient(#EFE6D6,#E7DCC8)">
  <div class="type" style="font-size:12px;margin-top:6px"><b>Livery zone:</b> {n['livery']}</div></div>
<div class="note" style="position:absolute;left:1010px;top:186px;width:542px">
  <h4>How it reads</h4><p>{n['read']}</p>
  <h4>Expression</h4><ul>{''.join(f'<li>{x}</li>' for x in n['expr'])}</ul>
  <h4>Pose</h4><ul>{''.join(f'<li>{x}</li>' for x in n['pose'])}</ul>
  <h4>Parts (one rigid bone each, no skin weights)</h4><p>{n['parts']}</p>
  <div style="display:flex;gap:14px;align-items:flex-end;margin-top:14px"><div class="view" style="width:250px;height:250px"><img src="img/{k}_pose.png" style="left:0;width:250px;height:250px"><span class="caps lab">{n['posecap']}</span></div>
  {"<div class='view' style='width:270px;height:135px'><img src='img/nesta_sizes.png' style='left:0;top:0;width:270px;height:135px'><span class='caps lab'>Big, Mid, Small</span></div>" if k == "nesta" else ""}</div>
</div>
""", SHEET_CSS)

# ------------------------------------------------------------------ silhouettes of the cast together
page("sheet_silhouettes", 1600, 520, f"""
<div class="hd"><div><div class="caps">Art bible check</div><div class="display" style="font-size:52px">Four shapes: circle, bar, pin, triangle</div></div><div class="caps" style="text-align:right">Automated gate: pairwise overlap (IoU) of side silhouettes at 64 px must stay under 0.60</div></div>
<div style="position:absolute;left:48px;top:140px;display:flex;gap:30px;align-items:flex-end">
  {''.join(f"<div style='text-align:center'><img src='img/{k}_side.png' style='width:330px;height:330px;filter:brightness(0);margin:0 -20px'><div class='caps'>{F[k]['name']}</div></div>" for k in ("earl", "grog", "nesta", "moss"))}
  <div style="display:flex;gap:2px;align-items:flex-end;padding-bottom:22px">{''.join(f"<img src='img/{k}_game.png' style='width:64px;height:64px;filter:brightness(0)'>" for k in ("earl", "grog", "nesta", "moss"))}</div>
</div>""", SHEET_CSS)

# ------------------------------------------------------------------ gadgets
GAD_CSS = SHEET_CSS + """.g3 { position:absolute; left:48px; right:48px; top:176px; display:grid; grid-template-columns: repeat(3, 1fr); gap: 14px 18px; }
.gc { display:grid; grid-template-columns: 150px 1fr; gap: 12px; border:1px solid rgba(43,38,35,.5); border-radius:10px; padding:10px 14px 10px 6px; background: rgba(255,255,255,.45); height: 232px; }
.gc img { width:150px; height:150px; align-self:center; } .gc h3 { font-family: var(--display); font-weight:900; font-variation-settings: "SOFT" 100, "WONK" 1, "opsz" 60; font-size: 25px; line-height:1; } .gc p { font-size: 12.5px; line-height:1.3; margin-top:5px; }"""
def gcard(i, g):
    b = g["behaviour"].split(". ")[0] + "."
    return (f"<div class='gc'><img src='img/gadget_{g['id']}.png'><div><div class='caps'>{i}. {g['verb']} &nbsp;·&nbsp; {g['ammo']} use{'s' if g['ammo'] > 1 else ''} &nbsp;·&nbsp; tier {g['tier']}</div><h3>{g['name']}</h3>"
            f"<p>{b}</p><p><b>Counter:</b> {g['counterplay'].split('. ')[0].rstrip('.')}.</p><p class='serif' style='font-style:italic'>{g['beat'].split('. ')[0].rstrip('.')}.</p></div></div>")
page("sheet_gadgets", 1600, 1130, f"""
<div class="hd"><div><div class="caps">Things that fell behind the furniture</div><div class="display" style="font-size:84px;color:var(--cobalt)">Gadgets</div></div>
  <div class="type" style="font-size:13px;width:520px;text-align:right">Household junk at ornament scale. Each one moves somebody; none does more than 9%.<br>Gadgets may use saturated colour: they are the only world objects allowed to.</div></div>
<hr class="rule2" style="position:absolute;left:48px;right:48px;top:158px">
<div class="g3">{''.join(gcard(i, g) for i, g in enumerate(G['gadgets'], 1))}</div>
<div style="position:absolute;left:48px;right:48px;top:936px;display:grid;grid-template-columns:repeat(3,1fr);gap:18px">
  <div class="gc" style="height:160px;grid-template-columns:130px 1fr"><img src="img/prop_parcel.png" style="width:130px;height:130px"><div><div class="caps">Delivery</div><h3>Parcel on a doily</h3><p>Every gadget arrives like this: 2 s of descent, can be hit or hooked on the way down.</p></div></div>
  <div class="gc" style="height:160px;grid-template-columns:130px 1fr"><img src="img/prop_plate.png" style="width:130px;height:130px"><div><div class="caps">Guard</div><h3>The side plate</h3><p>Guard is a plate in your colour. It cracks as guard HP falls and shatters on a guard break.</p></div></div>
  <div class="gc" style="height:160px;grid-template-columns:130px 1fr"><img src="img/prop_spoon.png" style="width:130px;height:130px"><div><div class="caps">Eliminated players</div><h3>The Teaspoon</h3><p>Out of stocks, you become a spoon. Tap a chunk every 5 s for 15 crack damage.</p></div></div>
</div>""", GAD_CSS)

# ------------------------------------------------------------------ arena layout maps
GROUP_FILL = {"rim": "#F6F1E6", "outer": "#EFE7D6", "mid": "#E6DCC6", "inner": "#DDD1B8", "core": "#D2C4A6", "lip": "#F6F1E6", "wall": "#EADFCB", "floor": "#DDD1B8", "T1": "#EDE5D2", "T2": "#E3D8C0", "T3": "#D6C9AC"}
def arena_svg(a, S=19.0):
    bz = a["blastZone"]; W = (bz["right"] - bz["left"] + 4) * S; H = (bz["top"] - bz["bottom"] + 4) * S
    X = lambda x: (x - bz["left"] + 2) * S; Y = lambda y: (bz["top"] + 2 - y) * S
    o = [f"<svg width='{W:.0f}' height='{H:.0f}' viewBox='0 0 {W:.0f} {H:.0f}' font-family='Courier Prime' font-size='10'>"]
    for gx in range(int(bz["left"]) - 1, int(bz["right"]) + 2):
        if gx % 5 == 0:
            o.append(f"<line x1='{X(gx):.1f}' y1='0' x2='{X(gx):.1f}' y2='{H:.0f}' stroke='#2B2623' stroke-width='{1 if gx == 0 else .5}' opacity='{.5 if gx == 0 else .16}'/><text x='{X(gx) + 3:.1f}' y='{H - 5:.0f}' fill='#6B625A'>{gx}</text>")
    for gy in range(int(bz["bottom"]) - 1, int(bz["top"]) + 2):
        if gy % 5 == 0:
            o.append(f"<line x1='0' y1='{Y(gy):.1f}' x2='{W:.0f}' y2='{Y(gy):.1f}' stroke='#2B2623' stroke-width='{1 if gy == 0 else .5}' opacity='{.5 if gy == 0 else .16}'/><text x='4' y='{Y(gy) - 3:.1f}' fill='#6B625A'>{gy}</text>")
    o.append(f"<rect x='{X(bz['left']):.1f}' y='{Y(bz['top']):.1f}' width='{(bz['right'] - bz['left']) * S:.1f}' height='{(bz['top'] - bz['bottom']) * S:.1f}' fill='none' stroke='#B5432E' stroke-width='2' stroke-dasharray='8 6'/>")
    o.append(f"<text x='{X(bz['left']) + 6:.1f}' y='{Y(bz['top']) + 14:.1f}' fill='#B5432E' font-weight='700'>BLAST ZONE  x {bz['left']} to {bz['right']},  y {bz['bottom']} to {bz['top']}</text>")
    cb = a["cameraBounds"]
    o.append(f"<rect x='{X(cb['minX']):.1f}' y='{Y(cb['maxY']):.1f}' width='{(cb['maxX'] - cb['minX']) * S:.1f}' height='{(cb['maxY'] - cb['minY']) * S:.1f}' fill='none' stroke='#24459A' stroke-width='1.2' stroke-dasharray='2 5'/>")
    o.append(f"<text x='{X(cb['minX']) + 6:.1f}' y='{Y(cb['minY']) - 6:.1f}' fill='#24459A'>camera never looks outside this box</text>")
    for h in a.get("hazards", []):
        if isinstance(h.get("column"), list):
            o.append(f"<rect x='{X(h['column'][0]):.1f}' y='{Y(bz['top']):.1f}' width='{(h['column'][1] - h['column'][0]) * S:.1f}' height='{(bz['top']) * S:.1f}' fill='#C08A4E' opacity='.28'/><text x='{X(h['column'][1]) + 4:.1f}' y='{Y(bz['top'] - 3):.1f}' fill='#8a5a22' font-weight='700'>{h['name'].upper()}</text>")
        elif h["id"] == "updraft":
            o.append(f"<rect x='{X(-4):.1f}' y='{Y(bz['top']):.1f}' width='{8 * S:.1f}' height='{(bz['top'] - bz['bottom']) * S:.1f}' fill='#E3A72F' opacity='.14'/><text x='{X(-3.8):.1f}' y='{Y(11):.1f}' fill='#8a5a22' font-weight='700'>KILN UPDRAFT (after the split; gap grows to 8 u)</text>")
    for c in a["chunks"]:
        pts = " ".join(f"{X(p[0]):.1f},{Y(p[1]):.1f}" for p in c["poly"])
        o.append(f"<polygon points='{pts}' fill='{GROUP_FILL.get(c['group'], '#E6DCC6')}' stroke='#2B2623' stroke-width='1.3' stroke-linejoin='round'/>")
        mx = (c["poly"][0][0] + c["poly"][1][0]) / 2; my = (c["poly"][0][1] + c["poly"][1][1]) / 2
        o.append(f"<text x='{X(mx):.1f}' y='{Y(my) + 13:.1f}' text-anchor='middle' font-weight='700' fill='#2B2623'>{c['id']}</text><text x='{X(mx):.1f}' y='{Y(my) + 24:.1f}' text-anchor='middle' fill='#6B625A' font-size='9'>{c['hp']}</text>")
        o.append(f"<line x1='{X(c['poly'][0][0]):.1f}' y1='{Y(c['poly'][0][1]):.1f}' x2='{X(c['poly'][1][0]):.1f}' y2='{Y(c['poly'][1][1]):.1f}' stroke='#24459A' stroke-width='3'/>")
    for p in a["platforms"]:
        dash = "" if p["kind"] != "soft" else "stroke-dasharray='7 3'"
        o.append(f"<line x1='{X(p['x0']):.1f}' y1='{Y(p['y']):.1f}' x2='{X(p['x1']):.1f}' y2='{Y(p['y']):.1f}' stroke='#2F8F7A' stroke-width='4' {dash} stroke-linecap='round'/><text x='{X((p['x0'] + p['x1']) / 2):.1f}' y='{Y(p['y']) - 7:.1f}' text-anchor='middle' fill='#1f6a5a' font-weight='700'>{p['id']}  y {p['y']:g}</text>")
    for i, sp in enumerate(a["spawns"], 1):
        o.append(f"<circle cx='{X(sp[0]):.1f}' cy='{Y(sp[1] + 0.8):.1f}' r='8' fill='#fff' stroke='#2B2623' stroke-width='1.2'/><text x='{X(sp[0]):.1f}' y='{Y(sp[1] + 0.8) + 3.5:.1f}' text-anchor='middle' font-weight='700'>{i}</text>")
    o.append("</svg>"); return "".join(o), W, H

def top_svg(a, S=19.0):
    """Plan view. Gameplay only ever happens on the z = 0 line; everything else is set dressing depth."""
    bz = a["blastZone"]; W = (bz["right"] - bz["left"] + 4) * S; Hh = 11 * S
    X = lambda x: (x - bz["left"] + 2) * S; Z = lambda z: (5.5 - z) * S           # +z = away from camera = up the page
    xs = [p[0] for c in a["chunks"] for p in c["poly"][:2]]; x0, x1 = min(xs), max(xs); hw = (x1 - x0) / 2 + 0.6; cx = (x0 + x1) / 2
    o = [f"<svg width='{W:.0f}' height='{Hh:.0f}' viewBox='0 0 {W:.0f} {Hh:.0f}' font-family='Courier Prime' font-size='10'>"]
    o.append(f"<ellipse cx='{X(cx):.1f}' cy='{Z(0):.1f}' rx='{hw * S:.1f}' ry='{3.4 * S:.1f}' fill='#EFE7D6' stroke='#2B2623' stroke-width='1.3'/>")
    for c in a["chunks"]:
        for xe in (c["poly"][0][0], c["poly"][1][0]):
            d = 3.4 * math.sqrt(max(0.0, 1 - ((xe - cx) / hw) ** 2))
            o.append(f"<line x1='{X(xe):.1f}' y1='{Z(d):.1f}' x2='{X(xe):.1f}' y2='{Z(-d):.1f}' stroke='#2B2623' stroke-width='.8' opacity='.55'/>")
    o.append(f"<line x1='{X(bz['left']):.1f}' y1='{Z(0):.1f}' x2='{X(bz['right']):.1f}' y2='{Z(0):.1f}' stroke='#24459A' stroke-width='2.5'/><text x='{X(bz['left']) + 4:.1f}' y='{Z(0) - 5:.1f}' fill='#24459A' font-weight='700'>GAMEPLAY PLANE  z = 0</text>")
    dress = {"willow": [("pagoda", -8.5, 1.35, 1.5, "rect"), ("bridge", 0, 0, 3.0, "bar"), ("willow trunk", 10.6, 1.4, 0.5, "circ"), ("bough", 8.5, 0.2, 1.9, "bar")],
             "high_tea": [("stem", 0, 1.5, 0.6, "circ"), ("cup", -12.5, 0, 1.3, "circ"), ("cup", 12.5, 0, 1.3, "circ"), ("teapot (far: z = 7)", 8.9, 4.6, 1.6, "circ")],
             "mended_bowl": [("shard L", -5, 0, 1.5, "bar"), ("shard R", 5, 0, 1.5, "bar"), ("shard top", 0, 0, 1.75, "bar")]}[a["id"]]
    for (lab, dx, dz, r, kind) in dress:
        if kind == "circ": o.append(f"<circle cx='{X(dx):.1f}' cy='{Z(dz):.1f}' r='{r * S:.1f}' fill='#C9D4EA' stroke='#24459A' stroke-width='1'/>")
        elif kind == "rect": o.append(f"<rect x='{X(dx - r):.1f}' y='{Z(dz + r):.1f}' width='{2 * r * S:.1f}' height='{2 * r * S:.1f}' fill='#C9D4EA' stroke='#24459A' stroke-width='1' transform='rotate(45 {X(dx):.1f} {Z(dz):.1f})'/>")
        else: o.append(f"<rect x='{X(dx - r):.1f}' y='{Z(dz + 0.75):.1f}' width='{2 * r * S:.1f}' height='{1.5 * S:.1f}' rx='5' fill='#BFE0D6' stroke='#2F8F7A' stroke-width='1'/>")
        o.append(f"<text x='{X(dx):.1f}' y='{Z(dz + (r if kind != 'bar' else 0.75)) - 4:.1f}' text-anchor='middle' fill='#2B2623'>{lab}</text>")
    o.append(f"<text x='{X(cx):.1f}' y='{Hh - 6:.0f}' text-anchor='middle' fill='#6B625A'>CAMERA is down here, 23 to 33 u back, pitched 7° down. Nothing in front of z = -1.2 may be taller than 0.4 u.</text>")
    o.append("</svg>"); return "".join(o)

MAP_CSS = SHEET_CSS + """table { border-collapse: collapse; width:100%; } td, th { font-family: var(--type); font-size: 11.5px; padding: 3px 6px; border-bottom: 1px solid rgba(43,38,35,.22); text-align:left; } th { color: var(--ink-soft); font-weight:400; text-transform: uppercase; letter-spacing:.08em; font-size:10px; }
.lg i { display:inline-block; width:22px; height:0; border-top:3px solid; vertical-align:middle; margin-right:6px; }"""
for a in A:
    side, W, H = arena_svg(a); top = top_svg(a)
    rows = "".join(f"<tr><td>{e['t'] // 60}:{e['t'] % 60:02d}</td><td>{e['event'].replace('_', ' ')}</td><td>{', '.join(e['ids'])}</td></tr>" for e in a["timeline"])
    hz = "".join(f"<p style='font-size:12.5px;margin-top:6px'><b>{h['name']}.</b> {h['note']}</p>" for h in a.get("hazards", [])) or "<p style='font-size:12.5px;margin-top:6px'>None. This is the teaching arena.</p>"
    sp = "".join(f"<p style='font-size:12.5px;margin-top:6px'>{v}</p>" for v in a.get("special", {}).values())
    PH = int(H + 11 * 19 + 240)
    page(f"map_{a['id']}", 1600, PH, f"""
<div class="hd"><div><div class="caps">Arena layout &nbsp;·&nbsp; 1 square = 5 u &nbsp;·&nbsp; generated from data/arenas.json</div><div class="display" style="font-size:66px;color:var(--cobalt)">{a['name']}</div></div>
  <div class="type" style="font-size:13px;width:560px;text-align:right">{a['blurb']}</div></div>
<hr class="rule2" style="position:absolute;left:48px;right:48px;top:140px">
<div style="position:absolute;left:48px;top:158px"><div class="caps" style="margin-bottom:4px">Side view: the gameplay plane (x, y)</div><div style="border:1px solid rgba(43,38,35,.5);border-radius:6px;background:#FAF6EC;width:{W:.0f}px">{side}</div>
  <div class="caps" style="margin:14px 0 4px">Top view: depth (x, z). Dressing only; nothing here collides</div><div style="border:1px solid rgba(43,38,35,.5);border-radius:6px;background:#FAF6EC;width:{W:.0f}px">{top}</div></div>
<div style="position:absolute;left:{48 + W + 26:.0f}px;top:158px;right:48px" class="note">
  <h4 style="margin-top:0">Legend</h4>
  <div class="lg type" style="font-size:12px;line-height:1.9"><i style="border-color:#24459A"></i>walkable top of a chunk (id, HP below)<br><i style="border-color:#2F8F7A;border-top-style:dashed"></i>soft platform (drop through with down)<br><i style="border-color:#B5432E;border-top-style:dashed"></i>blast zone: cross it and you are gone<br><i style="border-color:#24459A;border-top-style:dotted;border-top-width:2px"></i>camera bounds<br>① spawn points, used in order</div>
  <h4>Timeline (latest each piece can go)</h4><table><tr><th>Time</th><th>Event</th><th>Pieces</th></tr>{rows}</table>
  <h4>Hazards</h4>{hz}{('<h4>Special rules</h4>' + sp) if sp else ''}
</div>""", MAP_CSS)

# ------------------------------------------------------------------ palette
def sw(name, hx, w=118, note=""):
    r, g, b = (int(hx[i:i + 2], 16) for i in (1, 3, 5)); dark = (0.299 * r + 0.587 * g + 0.114 * b) < 140
    return (f"<div style='width:{w}px'><div style='height:74px;border-radius:10px;background:{hx};border:1px solid rgba(43,38,35,.45);box-shadow:inset 0 -8px 0 rgba(0,0,0,.10), inset 0 6px 0 rgba(255,255,255,.28);display:flex;align-items:flex-end;padding:6px 8px;color:{'#fff' if dark else '#2B2623'}' class='type'><b style='font-size:12px'>{hx.upper()}</b></div>"
            f"<div class='type' style='font-size:12px;margin-top:4px;font-weight:700'>{name}</div><div class='type' style='font-size:10.5px;color:var(--ink-soft)'>{note}</div></div>")
grp = lambda title, items, note="": f"<div style='margin-bottom:20px'><div class='caps' style='margin-bottom:8px;color:var(--cobalt);font-weight:700'>{title}</div><div style='display:flex;gap:12px;flex-wrap:wrap'>{items}</div><div class='type' style='font-size:12px;margin-top:8px;max-width:1480px'>{note}</div></div>"
page("palette", 1600, 1010, f"""
<div class="hd"><div><div class="caps">Art bible &nbsp;·&nbsp; generated from data/palette.json</div><div class="display" style="font-size:66px;color:var(--cobalt)">Palette</div></div>
  <div class="type" style="font-size:13px;width:620px;text-align:right">Saturation belongs to players and gadgets. The world stays under 35% saturation; liveries stay over 50%. Fighter bodies are neutrals only, so any livery reads on any fighter.</div></div>
<hr class="rule2" style="position:absolute;left:48px;right:48px;top:140px">
<div style="position:absolute;left:48px;top:162px;right:48px">
{grp("Player liveries (slot order is fixed; each has a pattern for colour-blind play)", "".join(sw(f"P{p['slot']} {p['name']}", p['hex'], 150, p['pattern']) for p in P['players']), "Teams: team A takes slots 1, 4, 6, 8 (cool); team B takes 2, 3, 5, 7 (warm).")}
{grp("Neutrals: fighter bodies, clay, ink", "".join(sw(k.title(), v, 150, {'bone': 'Earl, glaze white', 'slip': 'Nesta', 'bisque': 'fracture faces', 'terracotta': 'Moss, raw clay', 'basalt': 'Grog', 'ash': 'steel, stone', 'ink': 'eyes, lines, UI'}[k]) for k, v in P['neutrals'].items()))}
{grp("Accents", "".join(sw(k.replace('_', ' ').title(), v, 150, {'gilt': 'seams, rims, Gilt meter', 'gilt_hi': 'gilt highlight', 'gilt_lo': 'gilt shadow', 'cheek': 'cheeks, noses', 'stamp_red': 'SOLD, danger, blast zone', 'delft_ink': 'impact frame dark', 'delft_paper': 'impact frame light'}[k]) for k, v in P['accents'].items()))}
{grp("World", "".join(sw(k.replace('_', ' ').title(), v, 118) for k, v in P['world'].items()), "Value rule: the sky sits at 60 to 75% value and clouds never exceed 88%, so bone-white fighters are the brightest things on screen.")}
</div>""", SHEET_CSS)

# ------------------------------------------------------------------ architecture diagram
def box(x, y, w, h, title, lines, fill="#fff", stroke="#2B2623"):
    t = "".join(f"<text x='{x + 12}' y='{y + 40 + 16 * i}' font-family='Courier Prime' font-size='11.5' fill='#2B2623'>{l}</text>" for i, l in enumerate(lines))
    return f"<rect x='{x}' y='{y}' width='{w}' height='{h}' rx='10' fill='{fill}' stroke='{stroke}' stroke-width='1.6'/><text x='{x + 12}' y='{y + 22}' font-family='Fraunces' font-weight='800' font-size='17' fill='{stroke}'>{title}</text>{t}"
def arrow(x1, y1, x2, y2, lab="", c="#2B2623", dash="", dy=-6):
    return (f"<line x1='{x1}' y1='{y1}' x2='{x2}' y2='{y2}' stroke='{c}' stroke-width='2' {('stroke-dasharray=' + chr(39) + dash + chr(39)) if dash else ''} marker-end='url(#ah)'/>"
            f"<text x='{(x1 + x2) / 2}' y='{(y1 + y2) / 2 + dy}' text-anchor='middle' font-family='Courier Prime' font-size='11' fill='{c}' font-weight='700'>{lab}</text>")
svg = f"""<svg width='1504' height='830' viewBox='0 0 1504 830'><defs><marker id='ah' markerWidth='9' markerHeight='9' refX='8' refY='4.5' orient='auto'><path d='M0,0 L9,4.5 L0,9 z' fill='context-stroke'/></marker></defs>
<rect x='0' y='0' width='676' height='600' rx='14' fill='#FAF6EC' stroke='#24459A' stroke-width='2' stroke-dasharray='6 5'/><text x='16' y='26' font-family='Courier Prime' font-size='12' font-weight='700' fill='#24459A'>HOST BROWSER TAB</text>
<rect x='848' y='0' width='656' height='600' rx='14' fill='#FAF6EC' stroke='#2F8F7A' stroke-width='2' stroke-dasharray='6 5'/><text x='864' y='26' font-family='Courier Prime' font-size='12' font-weight='700' fill='#2F8F7A'>EVERY OTHER PLAYER'S TAB (x7)</text>
{box(20, 44, 304, 200, "Sim worker (authoritative)", ["sim/ : fixed 60 Hz tick, no DOM", "Rapier 2D deterministic (wasm)", "fighters, combat, gadgets, island", "input jitter buffer (2 ticks)", "12-tick hurtbox history (lag comp)", "out: snapshot 30 Hz, world 15 Hz,", "     events (hit, parry, ko, chunk)"], "#E9EEF9", "#24459A")}
{box(352, 44, 304, 200, "Main thread", ["input: keyboard + Gamepad API", "net relay: worker <-> channels", "render: three.js WebGLRenderer", "  interpolates between sim states", "vfx + audio driven by sim events", "ui: DOM overlay (base.css)", "the host is also its own client"])}
{box(20, 284, 304, 130, "Shared sim code", ["one TypeScript package, 3 homes:", "host worker, client prediction,", "headless Node (bots, netsim, tests)", "seeded PRNG, integer ticks, no Date"], "#FFF7E3", "#8a6a22")}
{box(352, 284, 304, 130, "Assets", ["glTF (meshopt) from Blender scripts", "1 packed matcap PNG, 3 woff2 fonts", "1 Opus audio sprite + JSON map", "lobby pack first, arenas on demand"])}
{box(20, 456, 636, 120, "Trystero room (reliable, ordered)", ["hello (protocol, build) / roster + scores as room state", "match events / chat / host hand-over", "host role verified with roles(); room code = signalling password"], "#F3EDE2")}
{box(868, 44, 304, 200, "Main thread", ["input -> 16-byte packet at 60 Hz", "  (tick + this and last 3 masks)", "prediction: own fighter only,", "  same sim code; reconcile on", "  every snapshot", "remote fighters and objects:", "  interpolated 66 ms behind"])}
{box(1184, 44, 300, 200, "Local-only simulation", ["cosmetic shards, dust, chips,", "trails. Never networked, never", "affects rules. Seeded from", "event ids so everyone sees", "roughly the same mess.", "budget (High): 300 shards,", "250 puffs"])}
{box(868, 284, 616, 150, "What a client is allowed to decide", ["Its own inputs, and how its own fighter LOOKS for a few frames. Nothing else.", "Hits, blocks, parries, grabs, launches, KOs, chunk states, spawns: host only.", "A hit is tested against where the attacker SAW the target", "  (rewound up to 8 ticks).", "Guard and parry are tested against what the defender is doing NOW,", "  widened by their latency (up to 3 ticks)."], "#FFF7E3", "#8a6a22")}
{box(868, 456, 616, 120, "Trystero room (reliable, ordered)", ["same room, same actions. The mesh already exists, so any peer", "can take over hosting between rounds.", "peer-connect-failed -> the friendly error screen + connectivity map"], "#F3EDE2")}
{arrow(324, 110, 352, 110, "", "#24459A")}{arrow(352, 160, 324, 160, "", "#24459A")}
{arrow(868, 100, 660, 100, "inputs, 60 Hz", "#B5432E")}<text x='764' y='116' text-anchor='middle' font-family='Courier Prime' font-size='10.5' fill='#B5432E'>unreliable, unordered</text>
{arrow(660, 180, 868, 180, "snapshots, 30 Hz", "#B5432E")}<text x='764' y='196' text-anchor='middle' font-family='Courier Prime' font-size='10.5' fill='#B5432E'>unreliable, unordered</text>
{arrow(660, 500, 868, 500, "events, roster, chat", "#2B2623")}{arrow(868, 530, 660, 530, "", "#2B2623")}<text x='764' y='548' text-anchor='middle' font-family='Courier Prime' font-size='10.5' fill='#2B2623'>reliable, ordered</text>
<rect x='0' y='640' width='1504' height='190' rx='14' fill='#FAF6EC' stroke='#8a6a22' stroke-width='2' stroke-dasharray='6 5'/><text x='16' y='666' font-family='Courier Prime' font-size='12' font-weight='700' fill='#8a6a22'>BUILD VM: HEADLESS NODE, NO BROWSER, NO RENDERING</text>
{box(24, 684, 340, 124, "Bot matches", ["8 bots, same sim package, same inputs", "a 2-minute match in about 5 s of CPU", "report: KOs by cause, lengths, loops"], "#fff", "#8a6a22")}
{box(396, 684, 340, 124, "Network in one process", ["host + 7 clients, loopback transport", "latency, jitter, loss, reorder dialled in", "gates: prediction error, bandwidth, hash"], "#fff", "#8a6a22")}
{box(768, 684, 340, 124, "Balance + regression", ["KO% tables, combo-loop search", "golden replays: same inputs, same hash", "data/*.json schema check"], "#fff", "#8a6a22")}
{box(1140, 684, 340, 124, "One real browser, last", ["Chrome headless, software WebGL", "one smoke test, a few screenshots,", "one 10 s clip. Never in parallel."], "#fff", "#8a6a22")}
<polyline points='20,350 9,350 9,746 24,746' fill='none' stroke='#8a6a22' stroke-width='2' stroke-dasharray='5 4' marker-end='url(#ah)'/><text x='16' y='628' font-family='Courier Prime' font-size='11' font-weight='700' fill='#8a6a22'>same code runs headless</text>
</svg>"""
page("architecture", 1600, 1000, f"""
<div class="hd"><div><div class="caps">Technical direction</div><div class="display" style="font-size:58px;color:var(--cobalt)">Who runs what, and what crosses the wire</div></div></div>
<hr class="rule2" style="position:absolute;left:48px;right:48px;top:122px"><div style="position:absolute;left:48px;top:144px">{svg}</div>""", SHEET_CSS)

json.dump(PAGES, open(os.path.join(SRC, "pages_sheets.json"), "w"))
print(len(PAGES), "sheet pages written")
