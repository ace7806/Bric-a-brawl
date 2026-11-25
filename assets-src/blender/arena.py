"""arena.py - builds arena meshes straight from data/arenas.json, so art can never drift from gameplay.
Each gameplay chunk polygon (x, height) is extruded in depth with an elliptical plan, then dressed.
Face slots: top = glazed surface, cut = raw bisque where a neighbour was, under = terracotta foot."""
import json, math, os, random
from mathutils import Vector
from ceramic import Builder, empty, PAL, HERE, engine_material, flat_material
import bpy

DATA = os.path.join(HERE, "..", "..", "data", "arenas.json")
def load(arena_id):
    return next(a for a in json.load(open(DATA)) if a["id"] == arena_id)

def plan_depth(x, half_w, dmax):
    return max(1.1, dmax * math.sqrt(max(0.02, 1 - (x / half_w) ** 2)))

def build_chunk(c, colours, half_w=14.0, dmax=3.4, state="intact", parent=None, seed=0, thin=False):
    rnd = random.Random(seed)
    poly = [Vector((p[0], 0, p[1])) for p in c["poly"]]
    front, back = [], []
    for i, p in enumerate(poly):
        d = plan_depth(p.x, half_w, dmax)
        j = (rnd.uniform(-0.12, 0.12) if i >= 2 else 0.0)              # ragged underside
        k = 0.82 if i >= 2 and not thin else 1.0                       # underside tucks in: a foot, not a slab
        front.append(Vector((p.x + j, -d * k, p.z))); back.append(Vector((p.x + j, d * k, p.z)))
    b = Builder(f"ARENA_{c['id']}", seed)
    n = len(poly); edges = ["top"] + ["cut"] + ["under"] * (n - 3) + ["cut"]
    b.poly_prism(front, back, {"edges": edges, "front": "side", "back": "side"})
    crack = 1.0 if state == "crazed" else 0.0
    me_cols = dict(colours); fin = {"cut": "bisque", "under": "bisque", "side": "bisque", "top": "glaze"}
    b_slots = list(b.slots)
    ob = b.finish(parent=parent, colours=me_cols, finishes=fin)
    if crack:
        for i, mslot in enumerate(b_slots):
            if mslot == "top":
                ob.data.materials[i] = engine_material(colours["top"], "glaze", crack=1.0)
    # the glazed lip: a rounded rail along the front and back top edges
    lip = Builder(f"ARENA_{c['id']}_lip", seed + 1)
    for outline, sgn in ((front, -1), (back, 1)):
        a, bb = outline[0], outline[1]
        lip.sweep([(a.x, a.y, a.z - 0.02), ((a.x + bb.x) / 2, (a.y + bb.y) / 2, (a.z + bb.z) / 2 - 0.02), (bb.x, bb.y, bb.z - 0.02)], 0.16, segs=8, sub=1, slot="lip", cap=True)
        lip.sweep([(a.x, a.y - sgn * 0.0, a.z - 0.30), ((a.x + bb.x) / 2, (a.y + bb.y) / 2, (a.z + bb.z) / 2 - 0.30), (bb.x, bb.y, bb.z - 0.30)], 0.10, segs=6, sub=1, slot="band", cap=True)
    lo = lip.finish(parent=ob, colours=colours, finishes={"lip": "glaze", "band": "glaze"})
    if crack:
        lo.data.materials[0] = engine_material(colours["lip"], "glaze", crack=1.0)
    return ob

def shard(parent, loc, size, colour_top, colour_raw, seed):
    rnd = random.Random(seed); b = Builder("FX_shard", seed)
    pts = [Vector((rnd.uniform(-1, 1) * size, rnd.uniform(-0.25, 0.25) * size, rnd.uniform(-1, 1) * size * 0.7)) for _ in range(4)]
    f = [p + Vector((0, -0.12 * size, 0)) for p in pts]; k = [p + Vector((0, 0.12 * size, 0)) for p in pts]
    c = sum(pts, Vector()) / 4
    order = sorted(range(4), key=lambda i: math.atan2(pts[i].z - c.z, pts[i].x - c.x))
    b.poly_prism([f[i] for i in order], [k[i] for i in order], {"edges": ["raw"] * 4, "front": "top", "back": "raw"})
    ob = b.finish(parent=parent, colours={"top": colour_top, "raw": colour_raw}, finishes={"raw": "bisque"})
    ob.location = loc; ob.rotation_euler = (rnd.uniform(0, 6), rnd.uniform(0, 6), rnd.uniform(0, 6))
    return ob

def cloud(parent, loc, scale, seed):
    rnd = random.Random(seed); b = Builder("ENV_cloud", seed)
    n = rnd.randint(4, 6); x = -n * 0.45
    for i in range(n):
        r = rnd.uniform(0.55, 1.0) * (1.0 - abs(i - (n - 1) / 2) / n)
        b.blob((x, rnd.uniform(-0.2, 0.2), r * 0.55), (r * 1.15, r * 0.8, r * 0.78), "cloud", segs=14, rings=7, wobble=0.03); x += r * 1.05
    ob = b.finish(parent=parent, colours={"cloud": "cloud"}, finishes={"cloud": "bisque"})
    ob.location = loc; ob.scale = (scale,) * 3
    return ob

# ---------------------------------------------------------------- arena-specific dressing
WILLOW_COLS = {"top": "willow_glaze", "cut": "bisque", "under": "clay_foot", "side": "clay_foot", "lip": "willow_glaze", "band": "willow_line"}

def willow_dressing(root, present):
    C = {"w": "willow_glaze", "b": "willow_blue", "g": "gilt", "t": "terracotta"}
    out = {}
    if present.get("eave", True):                                     # pagoda: square thrown roofs (4-segment lathe)
        p = Builder("ARENA_pagoda", 5)
        for i, (zb, rw, h) in enumerate(((0.0, 1.05, 3.2), (3.55, 0.8, 1.7), (5.55, 0.55, 1.2))):
            p.lathe([(0.0, zb, "w"), (rw, zb, "w"), (rw * 0.94, zb + h * 0.5, "w"), (rw * 0.9, zb + h, "w"), (0.0, zb + h, "w")], segs=4, sub=1, wobble=0.0, origin=(0, 0, 0))
            rr = rw * (2.25 if i == 0 else 1.9)
            p.lathe([(0.0, zb + h + 0.42, "b"), (rr * 0.35, zb + h + 0.30, "b"), (rr * 0.8, zb + h + 0.02, "b"), (rr, zb + h + 0.10, "b"), (rr * 0.98, zb + h - 0.06, "b"), (0.0, zb + h - 0.02, "b")], segs=4, sub=2, wobble=0.0)
        p.lathe([(0.0, 7.15, "g"), (0.14, 7.2, "g"), (0.06, 7.6, "g"), (0.0, 7.9, "g")], segs=8, sub=2, wobble=0.0)
        for zb, rw in ((0.0, 1.05), (3.55, 0.8), (5.55, 0.55)):
            p.lathe([(rw * 1.02, zb + 0.18, "b"), (rw * 1.04, zb + 0.26, "b"), (rw * 1.02, zb + 0.34, "b")], segs=4, sub=1, wobble=0.0)
            p.blob((rw * 0.7, -rw * 0.7, zb + 0.95), (0.05, 0.2, 0.42), "b", segs=8, rings=4, tilt=(0, 0, math.radians(-45)))
        ob = p.finish(parent=root, colours=C, finishes={"g": "gilt"}); ob.location = (-8.5, 1.35, 0.25); ob.rotation_euler = (0, 0, math.radians(45)); out["pagoda"] = ob
    if present.get("bridge", True):
        br = Builder("ARENA_bridge", 6)
        for y in (-0.75, 0.75):
            br.sweep([(-3.0, y, 2.50), (-1.5, y, 2.92), (0, y, 3.05), (1.5, y, 2.92), (3.0, y, 2.50)], 0.13, segs=8, slot="b")
            br.sweep([(-3.0, y, 3.05), (-1.5, y, 3.52), (0, y, 3.68), (1.5, y, 3.52), (3.0, y, 3.05)], 0.06, segs=6, slot="b")
            for x in (-3.0, -1.5, 0, 1.5, 3.0):
                z = 2.50 + 0.55 * (1 - (x / 3.0) ** 2)
                br.sweep([(x, y, z), (x, y, z + 0.62)], 0.045, segs=6, sub=1, slot="w")
        for i in range(13):
            x = -3.0 + i * 0.5; z = 2.44 + 0.55 * (1 - (x / 3.0) ** 2)
            br.sweep([(x, -0.78, z), (x, 0.78, z)], [0.12, 0.12], segs=6, sub=1, slot="w")
        for x in (-3.25, 3.25):
            br.lathe([(0.0, 0.0, "w"), (0.42, 0.0, "w"), (0.34, 1.3, "w"), (0.30, 2.45, "w"), (0.0, 2.5, "w")], segs=10, sub=1, origin=(x, 1.3, 0.05))
        out["bridge"] = br.finish(parent=root, colours=C)
    if present.get("bough", True):
        t = Builder("ARENA_willow", 7)
        t.sweep([(10.6, 1.5, 0.2), (10.3, 1.4, 2.0), (9.9, 1.0, 3.3), (10.3, 0.9, 4.6), (10.9, 1.0, 5.7)], [0.42, 0.34, 0.30, 0.22, 0.12], segs=10, slot="b")
        t.sweep([(10.0, 0.8, 3.1), (9.0, 0.1, 2.92), (7.8, 0.0, 2.95), (6.6, 0.0, 2.86)], [0.26, 0.22, 0.19, 0.12], segs=10, slot="b")      # the bough = soft platform at y 3.0
        rnd = random.Random(3)
        for (sx, sy, sz, ln) in ((10.9, 0.9, 5.7, 2.6), (10.4, 0.2, 5.0, 2.2), (9.2, -0.4, 2.85, 1.5), (8.2, 0.3, 2.9, 1.7), (7.2, -0.2, 2.9, 1.3), (11.4, 0.6, 5.2, 2.4), (9.8, 1.6, 4.9, 2.0)):
            ex = sx + rnd.uniform(-0.9, 0.5)
            t.sweep([(sx, sy, sz), ((sx + ex) / 2 - 0.2, sy - 0.1, sz + 0.25), (ex, sy - 0.2, sz - ln * 0.5), (ex + 0.1, sy - 0.2, sz - ln)], [0.035, 0.03, 0.025, 0.012], segs=5, slot="b")
            for k in range(5):
                f = 0.35 + 0.65 * k / 4
                t.blob((ex + 0.08 * math.sin(k), sy - 0.2, sz - ln * f), (0.07, 0.05, 0.17), "b", segs=8, rings=4)
        out["willow"] = t.finish(parent=root, colours=C)
    return out

TEA_COLS = {"top": "tea_cream", "cut": "bisque", "under": "slip", "side": "slip", "lip": "tea_cream", "band": "tea_rose"}
BOWL_COLS = {"top": "bowl_inner", "cut": "bisque", "under": "bowl_tenmoku", "side": "bowl_tenmoku", "lip": "bowl_inner", "band": "gilt"}

def tea_dressing(root, states):
    C = {"c": "tea_cream", "r": "tea_rose", "g": "gilt", "t": "tea"}
    st = Builder("ARENA_stem", 12)
    st.lathe([(0.0, -2.2, "c"), (1.5, -2.1, "c"), (1.7, -1.8, "r"), (0.7, -1.2, "c"), (0.45, -0.6, "c"), (0.55, 1.2, "c"), (0.9, 2.2, "r"), (0.5, 3.0, "c"), (0.42, 5.4, "c"), (0.75, 6.2, "r"),
              (0.4, 6.9, "c"), (0.34, 8.6, "c"), (0.5, 8.9, "g"), (0.2, 9.3, "g"), (0.34, 9.75, "g"), (0.0, 10.2, "g")], segs=16, sub=2, wobble=0.01, origin=(0, 1.5, 0))
    st.finish(parent=root, colours=C, finishes={"g": "gilt"})
    for sx, cid in ((-1, "cupL"), (1, "cupR")):
        if states.get(cid) == "gone": continue
        cup = Builder(f"ARENA_{cid}", 13 + sx)
        cup.lathe([(0.0, 2.50, "c"), (0.62, 2.50, "c"), (0.70, 2.56, "c"), (0.66, 2.66, "c"), (1.02, 2.95, "c"), (1.30, 3.40, "r"), (1.34, 3.52, "g"), (1.26, 3.50, "g"), (1.02, 3.10, "c"), (0.6, 2.82, "c"), (0.0, 2.80, "c")],
                  segs=18, sub=2, wobble=0.012, origin=(sx * 12.5, 0, 0))
        cup.lathe([(0.0, 2.34, "c"), (1.2, 2.36, "c"), (1.75, 2.50, "r"), (1.80, 2.56, "g"), (1.2, 2.46, "c"), (0.0, 2.44, "c")], segs=18, sub=2, wobble=0.012, origin=(sx * 12.5, 0, 0))
        cup.sweep([(sx * 13.7, 0, 3.32), (sx * 14.35, 0, 3.30), (sx * 14.45, 0, 2.92), (sx * 13.55, 0, 2.86)], 0.085, segs=8, slot="r")
        cup.finish(parent=root, colours=C, finishes={"g": "gilt"})
    pot = Builder("ENV_teapot", 15)                                     # the background teapot that pours
    pot.lathe([(0.0, 0.0, "c"), (1.2, 0.0, "c"), (1.45, 0.2, "r"), (2.3, 1.4, "c"), (2.45, 2.4, "c"), (2.1, 3.4, "c"), (1.45, 3.9, "r"), (1.3, 4.05, "g"), (0.9, 4.3, "c"), (0.3, 4.5, "c"), (0.4, 4.85, "g"), (0.0, 5.0, "g")], segs=20, sub=2, wobble=0.012)
    pot.sweep([(-2.1, 0, 1.6), (-3.2, 0, 2.0), (-3.9, 0, 3.0), (-4.25, 0, 3.75)], [0.6, 0.42, 0.3, 0.3], segs=10, slot="c")
    pot.sweep([(2.2, 0, 3.2), (3.3, 0, 3.4), (3.7, 0, 2.3), (3.1, 0, 1.3), (2.3, 0, 1.2)], 0.2, segs=8, slot="r")
    po = pot.finish(parent=root, colours=C, finishes={"g": "gilt", "c": "satin", "r": "satin"}); po.location = (8.9, 7.0, 10.2); po.rotation_euler = (0, math.radians(-38), 0)
    tea = Builder("FX_pour", 16)
    tea.sweep([(4.7, 6.6, 10.6), (3.6, 4.2, 9.6), (3.1, 1.5, 7.0), (3.0, 0.2, 4.35)], [0.16, 0.2, 0.26, 0.34], segs=8, slot="t")
    to = tea.finish(parent=root, colours=C); to.data.materials[0] = engine_material("tea", "glaze", alpha=0.8)

def bowl_dressing(root, a, states, shift):
    C = {"g": "gilt", "i": "bowl_inner", "t": "bowl_tenmoku"}
    seams = Builder("ARENA_seams", 17)
    for c in a["chunks"]:
        if states.get(c["id"]) == "gone": continue
        dx = -shift if c["half"] == "L" else shift
        x1, y1 = c["poly"][1]; xb, yb = c["poly"][2]
        if abs(x1) < 0.01 and shift > 0: continue
        d = plan_depth(x1, 14.5, 3.6)
        seams.sweep([(x1 + dx, -d - 0.03, y1 + 0.06), (x1 + dx - 0.08, -d * 0.9 - 0.03, (y1 + yb) / 2), (xb + dx, -d * 0.82 - 0.03, yb)], [0.07, 0.085, 0.06], segs=6, slot="g")
        seams.sweep([(x1 + dx, -d, y1 + 0.03), (x1 + dx + 0.06, 0, y1 + 0.05), (x1 + dx, d, y1 + 0.03)], 0.07, segs=6, slot="g")
    seams.finish(parent=root, colours=C, finishes={"g": "gilt"})
    for p in a["platforms"]:
        if states.get(p["id"]) == "gone": continue
        dx = {"L": -shift, "R": shift}.get(p.get("attach"), 0.0)
        sh = Builder(f"ARENA_{p['id']}", 18)
        xs = [p["x0"] + dx, (p["x0"] + p["x1"]) / 2 + dx, p["x1"] + dx]
        sh.poly_prism([Vector((xs[0], -0.7, p["y"])), Vector((xs[2], -0.7, p["y"])), Vector((xs[2] - 0.5, -0.5, p["y"] - 0.55)), Vector((xs[1] + 0.2, -0.4, p["y"] - 0.8)), Vector((xs[0] + 0.3, -0.5, p["y"] - 0.4))],
                      [Vector((xs[0], 0.7, p["y"])), Vector((xs[2], 0.7, p["y"])), Vector((xs[2] - 0.5, 0.5, p["y"] - 0.55)), Vector((xs[1] + 0.2, 0.4, p["y"] - 0.8)), Vector((xs[0] + 0.3, 0.5, p["y"] - 0.4))],
                      {"edges": ["i", "t", "t", "t", "t"], "front": "t", "back": "t"})
        sh.sweep([(xs[0], -0.72, p["y"]), (xs[1], -0.72, p["y"]), (xs[2], -0.72, p["y"])], 0.07, segs=6, sub=1, slot="g")
        sh.finish(parent=root, colours=C, finishes={"g": "gilt", "t": "satin"})
    if shift > 0.5:                                                     # kiln updraft: pale wisps rising through the gap
        w = Builder("FX_updraft", 19); rnd = random.Random(5)
        for i in range(7):
            x = rnd.uniform(-shift * 0.7, shift * 0.7); z = rnd.uniform(-6, 5)
            w.sweep([(x, 0.2, z), (x + 0.25, 0.2, z + 1.2), (x - 0.2, 0.2, z + 2.4), (x + 0.1, 0.2, z + 3.6)], [0.01, 0.08, 0.1, 0.01], segs=5, slot="i", squash=0.3)
        wo = w.finish(parent=root, colours=C); wo.data.materials[0] = flat_material("sky_mid", alpha=0.55)

def build_arena(arena_id, states=None, dressing=True, half_w=14.0, dmax=3.4, shift=0.0):
    """states: {chunk_or_platform_id: 'intact'|'crazed'|'gone'|('fall', dx, dz, rot_deg)}"""
    a = load(arena_id); states = states or {}; root = empty(f"ARENA_{arena_id}")
    cols = {"willow": WILLOW_COLS, "high_tea": TEA_COLS, "mended_bowl": BOWL_COLS}[arena_id]; objs = {}
    for i, c in enumerate(a["chunks"]):
        st = states.get(c["id"], "intact")
        if st == "gone": continue
        hw, dm = half_w, dmax
        if arena_id == "high_tea": hw, dm = {"T1": (10.6, 3.0), "T2": (7.0, 2.3), "T3": (3.9, 1.7)}[c["group"]]
        if arena_id == "mended_bowl": hw, dm = 14.5, 3.6
        ob = build_chunk(c, cols, half_w=hw, dmax=dm, state=st if isinstance(st, str) else "crazed", parent=root, seed=i + 1, thin=arena_id == "high_tea")
        if arena_id == "mended_bowl" and shift:
            ob.location.x += (-shift if c["half"] == "L" else shift)
        if isinstance(st, tuple):
            cx = (c["poly"][0][0] + c["poly"][1][0]) / 2
            piv = empty(f"piv_{c['id']}", root, (cx + st[1], 0, st[2])); ob.parent = piv; ob.location = (-cx, 0, 0); piv.rotation_euler = (0, math.radians(st[3]), 0)
        objs[c["id"]] = ob
    if dressing and arena_id == "willow":
        present = {p["id"]: states.get(p["id"], "intact") != "gone" for p in a["platforms"]}
        objs.update(willow_dressing(root, present))
    if dressing and arena_id == "high_tea": tea_dressing(root, states)
    if dressing and arena_id == "mended_bowl": bowl_dressing(root, a, states, shift)
    return root, objs, a
