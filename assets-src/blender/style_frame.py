"""style_frame.py - the in-game style frame: The Willow Plate, 0:46 elapsed, six fighters.
Rendered with the engine-look material (packed matcap, no lights) from the gameplay camera.
HUD is composited afterwards in concept_art/src/hud.html."""
import sys, os, math, time, random
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bpy
from mathutils import Vector
from ceramic import *
import characters as ch, arena as ar, props as pr

def place(builder, livery, x, z, facing=1, lean=0.0, y=0.0, **kw):
    """facing +1 right / -1 left. 42 deg cheat toward the camera. lean>0 = forward."""
    outer = empty("facing", None, (x, y, z)); outer.rotation_euler = (0, 0, math.radians(-42 if facing > 0 else 222))
    root = builder(livery, **kw); root.parent = outer; root.rotation_euler = (0, math.radians(lean), 0)
    return outer, root

def part(root, suffix):
    return next(o for o in root.children_recursive if o.name.split(".")[0].endswith(suffix))

def shadow(x, z, r=0.75, y=0.0):
    b = Builder("FX_blob_shadow", 1); b.lathe([(0.0, 0.0, "s"), (r, 0.0, "s")], segs=18, sub=1, wobble=0.0, squash=(1.0, 0.8))
    ob = b.finish(); ob.location = (x, y, z + 0.015); ob.data.materials[0] = flat_material("ink", alpha=0.28)
    return ob

t0 = time.time(); reset(); sky_world()
states = {"W1": "gone", "W12": ("fall", 0.5, -1.5, -17), "W2": "crazed", "W11": "crazed", "W5": "crazed"}
root, objs, A = ar.build_arena("willow", states)

# --- P2 GROG: Horn Toss, the hit that just launched Earl
o, g = place(ch.grog, "oxblood", 5.9, 0.0, facing=1, lean=0)
h = part(g, "grog_head"); h.location.z += 0.36; h.location.x += 0.05; h.rotation_euler = (0, math.radians(-38), 0)
for n in ("hoofFL", "hoofFR"):
    p = part(g, n); p.location.z += 0.42; p.location.x += 0.22; p.rotation_euler = (0, math.radians(-25), 0)
shadow(5.9, 0.0, 1.05)

# --- P1 EARL: launched up and out over the falling rim, tumbling, lid coming off
o, e = place(ch.earl, "cobalt", 8.35, 6.75, facing=1, lean=128)
lid = part(e, "earl_lid"); lid.location += Vector((0.1, 0.0, 0.6)); lid.rotation_euler = (0.3, 0.9, 0.2)
part(e, "handF").location += Vector((0.25, 0, 0.35)); part(e, "handB").location += Vector((-0.3, 0, 0.3))
# the brushstroke trail: one loaded stroke plus two dry bristle streaks, in the VICTIM's colour
tr = Builder("FX_trail", 2)
path = [(6.9, -0.6, 2.0), (7.2, -0.6, 3.3), (7.5, -0.6, 4.6), (7.8, -0.6, 5.6), (7.95, -0.6, 6.1)]
tr.sweep(path, [0.03, 0.24, 0.36, 0.42, 0.28], segs=8, slot="t", squash=0.10)
tr.sweep([(p[0] + 0.42, -0.6, p[2] - 0.12) for p in path], [0.01, 0.05, 0.075, 0.065, 0.02], segs=6, slot="t", squash=0.2)
tr.sweep([(p[0] - 0.40, -0.6, p[2] + 0.12) for p in path], [0.01, 0.04, 0.065, 0.055, 0.02], segs=6, slot="t", squash=0.2)
tob = tr.finish(colours={"t": "cobalt"}); tob.data.materials[0] = flat_material("cobalt", alpha=0.92)
rnd = random.Random(4)
for i in range(11):                                                     # chip burst at the point of impact
    a = rnd.uniform(0.3, 1.7); r = rnd.uniform(0.5, 1.8)
    ar.shard(None, (6.9 + r * math.cos(a), rnd.uniform(-0.9, -0.2), 1.9 + r * math.sin(a)), rnd.uniform(0.07, 0.15), rnd.choice(["bone", "bone", "cobalt"]), "bisque", 100 + i)

# --- P3 NESTA (small): on the bridge with the Bellows
o, n = place(ch.nesta, "mustard", -1.35, 3.03, facing=1, lean=4, size="small")
hf = part(n, "handF"); hf.location += Vector((0.42, 0.1, 0.1))
bel = pr.bellows(None); bel.location = (-0.32, -0.38, 3.58); bel.scale = (0.95,) * 3
for i, (gx, gs) in enumerate(((0.75, 0.20), (1.5, 0.28), (2.35, 0.38))):   # the gust: matte puffs, growing
    c = ar.cloud(None, (gx, -0.3, 3.60 + 0.12 * i), gs, 40 + i); c.data.materials[0] = flat_material("bone", alpha=0.8)

# --- P4 MOSS: blown off the bridge, casting for the willow bough to save himself
o, m = place(ch.moss, "verdigris", 3.55, 4.05, facing=1, lean=-26)
part(m, "moss_hat").rotation_euler = (0, math.radians(14), 0)
rod = part(m, "moss_rod"); rod.rotation_euler = (0, math.radians(-12), 0)
part(m, "footF").location += Vector((0.2, 0, 0.12)); part(m, "footB").location += Vector((-0.12, 0, 0.2))

# --- P5 NESTA (big): guarding with her side plate.  P6 EARL: Spout Charge into the guard
o, nb = place(ch.nesta, "tangerine", -6.0, 0.02, facing=1, lean=-5, size="big"); shadow(-6.0, 0.0, 0.85)
pl = pr.side_plate(None, "tangerine", 0.66); pl.location = (-4.93, -0.45, 1.05); pl.rotation_euler = (0, math.radians(84), math.radians(-25))
part(nb, "handF").location += Vector((0.5, 0.0, 0.18))
o, e2 = place(ch.earl, "aubergine", -3.35, 0.03, facing=-1, lean=17); shadow(-3.35, 0.0, 0.75)
part(e2, "handF").location += Vector((-0.5, 0, 0.1)); part(e2, "handB").location += Vector((-0.45, 0, 0.25))
for i in range(4):                                                      # guard chips off the plate
    ar.shard(None, (-4.7 + 0.2 * i, -0.6, 1.25 + 0.28 * i * (1 if i % 2 else -0.6)), 0.07, "tangerine", "bisque", 200 + i)

# --- the next gadget arriving by doily
p = pr.parcel(None); p.location = (2.2, 0.3, 7.7); p.rotation_euler = (0.08, -0.12, 0.3)

# --- debris from the falling rim chunk, rubble on the crazed chunk
for i in range(14):
    ar.shard(None, (11.3 + rnd.uniform(-1.4, 1.6), rnd.uniform(-1.2, 1.2), rnd.uniform(-4.2, 0.6)), rnd.uniform(0.10, 0.30), "willow_glaze", rnd.choice(["bisque", "terracotta"]), 300 + i)
for i in range(5):
    ar.shard(None, (-3.9 + rnd.uniform(-0.9, 1.4), rnd.uniform(-0.9, 0.9), 0.1), rnd.uniform(0.08, 0.16), "willow_glaze", "bisque", 400 + i)

# --- sky dressing: porcelain clouds, a far island
for i, (cx, cy, cz, cs) in enumerate(((-12, 30, 12.5, 3.0), (17, 40, 14.0, 4.0), (24, 26, 1.5, 2.6), (-20, 34, 0.5, 3.2))):
    ar.cloud(None, (cx, cy, cz), cs, 60 + i)
camera((0.55, -23.4, 6.75), (1.75, 0, 3.85), fov_deg=30)
w, hh = (int(sys.argv[-2]), int(sys.argv[-1])) if sys.argv[-1].isdigit() else (1280, 720)
render(os.path.join(OUT, "style_frame_willow.png"), w, hh, samples=28)
print("tris", tri_count(), "objects", len(bpy.context.scene.objects), "time", round(time.time() - t0, 1))
