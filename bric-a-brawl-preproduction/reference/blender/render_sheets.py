"""render_sheets.py - transparent tiles for the character sheets, livery tests and the gadget sheet.
~3 s per tile on 2 vCPUs. Outputs to out/sheets/."""
import sys, os, math, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bpy
from mathutils import Vector
from ceramic import *
import characters as ch, props as pr, arena as ar
S = os.path.join(OUT, "sheets"); os.makedirs(S, exist_ok=True)
DEFAULT = {"earl": "cobalt", "grog": "oxblood", "nesta": "mustard", "moss": "verdigris"}
FRAME = {"earl": (2.9, 0.86), "grog": (3.3, 0.95), "nesta": (2.9, 0.78), "moss": (3.3, 1.12)}   # ortho scale, look-at height
VIEWS = {"front": -90, "side": 0, "game": -42}

def part(root, suffix):
    return next(o for o in root.children_recursive if o.name.split(".")[0].endswith(suffix))

def shot(name, w=640, h=640, scale=2.9, zc=0.85, samples=20):
    camera((0, -12, zc + 0.6), (0, 0, zc), ortho=scale)
    render(os.path.join(S, name + ".png"), w, h, samples=samples, transparent=True)

def pose(name, root):
    if name == "earl":      # Lid Pop
        lid = part(root, "earl_lid"); lid.location.z += 0.95; lid.rotation_euler = (0.15, -0.3, 0)
        part(root, "handF").location += Vector((0.1, 0, 0.75)); part(root, "handB").location += Vector((0.1, 0, 0.75))
        for i, (dx, dz, sc) in enumerate(((0.0, 1.55, 0.16), (-0.22, 1.72, 0.12), (0.2, 1.8, 0.1))):
            c = ar.cloud(root, (dx, 0, dz), sc, 70 + i); c.data.materials[0] = flat_material("bone", alpha=0.85)
    elif name == "grog":    # Stampede
        root.rotation_euler = (0, math.radians(7), 0)
        h = part(root, "grog_head"); h.location += Vector((0.12, 0, -0.22)); h.rotation_euler = (0, math.radians(24), 0)
        for n, dx in (("hoofFL", 0.38), ("hoofFR", 0.1), ("hoofBL", -0.34), ("hoofBR", -0.08)):
            p = part(root, n); p.location.x += dx; p.location.z += 0.1 if "L" in n else 0.0; p.rotation_euler = (0, math.radians(-30 if dx > 0 else 30), 0)
        for i, (dx, sc) in enumerate(((-1.5, 0.2), (-1.95, 0.14))):
            c = ar.cloud(root, (dx, 0, 0.12), sc, 80 + i); c.data.materials[0] = flat_material("bisque", alpha=0.8)
    elif name == "moss":    # Cast
        root.rotation_euler = (0, math.radians(-10), 0)
        r = part(root, "moss_rod"); r.rotation_euler = (0, math.radians(42), 0); r.location += Vector((0.15, 0, 0.3))
        part(root, "handF").location += Vector((0.15, 0, 0.3)); part(root, "moss_hat").rotation_euler = (0, math.radians(12), 0)

t0 = time.time(); n = 0
only = [a for a in sys.argv if a in ("chars", "livery", "gadgets", "poses", "sizes")]
if not only or "chars" in only:
    for name in ("earl", "grog", "nesta", "moss"):
        for view, yaw in VIEWS.items():
            reset(); outer = empty("facing"); outer.rotation_euler = (0, 0, math.radians(yaw))
            r = ch.BUILDERS[name](DEFAULT[name]); r.parent = outer
            shot(f"{name}_{view}", scale=FRAME[name][0], zc=FRAME[name][1]); n += 1
if not only or "poses" in only:
    for name in ("earl", "grog", "moss"):
        reset(); outer = empty("facing"); outer.rotation_euler = (0, 0, math.radians(-42))
        r = ch.BUILDERS[name](DEFAULT[name]); r.parent = outer; pose(name, r)
        shot(f"{name}_pose", scale=FRAME[name][0] * 1.25, zc=FRAME[name][1] + 0.3); n += 1
    reset()                                                             # Nesta: Shed
    o1 = empty("f1", None, (-0.75, 0, 0)); o1.rotation_euler = (0, math.radians(-24), math.radians(-42))
    sh = ch.nesta("mustard", size="big", shell_only=True); sh.parent = o1
    o2 = empty("f2", None, (0.55, 0, 1.0)); o2.rotation_euler = (0, 0, math.radians(-42))
    nm = ch.nesta("mustard", size="mid"); nm.parent = o2
    part(nm, "handF").location += Vector((0.05, 0, 0.5)); part(nm, "handB").location += Vector((0.05, 0, 0.5))
    shot("nesta_pose", scale=4.4, zc=1.3); n += 1
if not only or "sizes" in only:
    reset()
    for x, size in ((-1.45, "big"), (0.15, "mid"), (1.4, "small")):
        o = empty("f", None, (x, 0, 0)); o.rotation_euler = (0, 0, math.radians(-42)); r = ch.nesta("mustard", size=size); r.parent = o
    camera((0, -12, 1.6), (0, 0, 1.0), ortho=4.6); render(os.path.join(S, "nesta_sizes.png"), 960, 480, samples=20, transparent=True); n += 1
if not only or "livery" in only:
    for name in ("earl", "grog", "nesta", "moss"):
        reset()
        for i, liv in enumerate(PLAYER_COLOURS):
            o = empty("f", None, ((i - 3.5) * (2.5 if name == "grog" else 1.9), 0, 0)); o.rotation_euler = (0, 0, math.radians(-42))
            r = ch.BUILDERS[name](liv); r.parent = o
        wdt = 8 * (2.5 if name == "grog" else 1.9)
        camera((0, -20, FRAME[name][1] + 0.9), (0, 0, FRAME[name][1]), ortho=wdt + 0.6); render(os.path.join(S, f"{name}_livery.png"), 1600, 300 if name != "moss" else 330, samples=16, transparent=True); n += 1
if not only or "gadgets" in only:
    for gid, fn in pr.GADGETS:
        reset(); o = empty("f"); o.rotation_euler = (0, 0, math.radians(-30)); g = fn(o)
        camera((0, -8, 0.9), (0, 0, 0.45 if gid not in ("bellows", "hoover") else 0.05), ortho=1.9 if gid != "bellows" else 1.7); render(os.path.join(S, f"gadget_{gid}.png"), 400, 400, samples=20, transparent=True); n += 1
    reset(); o = empty("f"); o.rotation_euler = (0, 0, math.radians(-30)); p = pr.parcel(o)
    camera((0, -8, 1.6), (0, 0, 1.0), ortho=3.2); render(os.path.join(S, "prop_parcel.png"), 400, 400, samples=20, transparent=True)
    reset(); o = empty("f"); o.rotation_euler = (0, 0, math.radians(-30)); p = pr.spoon(o, "rose"); p.rotation_euler = (0, math.radians(160), 0); p.location = (0, 0, 1.3)
    camera((0, -8, 0.9), (0, 0, 0.65), ortho=2.0); render(os.path.join(S, "prop_spoon.png"), 400, 400, samples=20, transparent=True)
    reset(); o = empty("f"); o.rotation_euler = (0, 0, math.radians(-30)); p = pr.side_plate(o, "cobalt"); p.rotation_euler = (0, math.radians(70), 0); p.location = (0, 0, 0.7)
    camera((0, -8, 0.9), (0, 0, 0.7), ortho=2.0); render(os.path.join(S, "prop_plate.png"), 400, 400, samples=20, transparent=True); n += 3
print("tiles", n, "seconds", round(time.time() - t0, 1), "avg", round((time.time() - t0) / max(n, 1), 1))
