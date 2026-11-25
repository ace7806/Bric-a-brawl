"""key_art.py - the key art render: the last chunk goes, and Grog is still charging."""
import sys, os, math, time, random
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bpy
from mathutils import Vector
from ceramic import *
import characters as ch, arena as ar, props as pr
from stage import place, part, shadow, sky_clouds
t0 = time.time(); reset(); sky_world(); rnd = random.Random(8)
states = {"W1": "gone", "W2": "gone", "W12": "gone", "W11": ("fall", 0.35, -0.55, 11), "W10": "crazed", "W9": "crazed"}
ar.build_arena("willow", states)
# Grog mid-Stampede on the chunk that is already leaving, Earl riding the horns and not enjoying it
piv = empty("ride", None, (9.75, 0, -0.42)); piv.rotation_euler = (0, math.radians(11), 0)
o, g = place(ch.grog, "oxblood", 0.15, 0.02, facing=1, lean=4); o.parent = piv
h = part(g, "grog_head"); h.location += Vector((0.1, 0, -0.16)); h.rotation_euler = (0, math.radians(16), 0)
for n, dx, dz in (("hoofFL", 0.42, 0.22), ("hoofFR", 0.05, 0.0), ("hoofBL", -0.36, 0.0), ("hoofBR", -0.05, 0.28)):
    p = part(g, n); p.location.x += dx; p.location.z += dz; p.rotation_euler = (0, math.radians(-28 if dx > 0 else 28), 0)
o, e = place(ch.earl, "cobalt", 11.75, 1.02, facing=1, lean=-38)
lid = part(e, "earl_lid"); lid.location += Vector((-0.35, 0, 0.75)); lid.rotation_euler = (0.2, -0.7, 0.1)
part(e, "handF").location += Vector((0.2, 0, 0.6)); part(e, "handB").location += Vector((-0.1, 0, 0.75))
part(e, "footF").location += Vector((0.3, 0, -0.05)); part(e, "footB").location += Vector((-0.25, 0, -0.1))
for i, (dx, dz, sc) in enumerate(((-1.9, 0.25, 0.3), (-2.6, 0.2, 0.22), (-3.2, 0.3, 0.15))):          # dust off the hooves
    c = ar.cloud(None, (9.6 + dx, -0.5, dz - 0.25), sc, 90 + i); c.data.materials[0] = flat_material("bisque", alpha=0.8)
# Nesta: just shed, popping up out of the big shell
o, n = place(ch.nesta, "mustard", 6.1, 2.25, facing=1, lean=-8, size="mid")
part(n, "handF").location += Vector((0.05, 0, 0.55)); part(n, "handB").location += Vector((0.05, 0, 0.55))
sh_o = empty("shell", None, (5.6, 0.2, 0.02)); sh_o.rotation_euler = (0, math.radians(-16), math.radians(-42))
sh = ch.nesta("mustard", size="big", shell_only=True); sh.parent = sh_o; shadow(5.7, 0.0, 0.9)
# Moss: sitting on the willow bough above it all, fishing. He has caught a boot.
o, m = place(ch.moss, "verdigris", 8.15, 3.02, facing=1, lean=4)
rod = part(m, "moss_rod"); rod.rotation_euler = (0, math.radians(26), 0)
part(m, "footF").location += Vector((0.3, 0, 0.0)); part(m, "footB").location += Vector((0.34, 0, 0.02))
# shards: the rim coming apart
for i in range(26):
    ar.shard(None, (12.2 + rnd.uniform(-1.6, 3.4), rnd.uniform(-1.6, 1.4), rnd.uniform(-2.6, 2.2)), rnd.uniform(0.14, 0.42), "willow_glaze", rnd.choice(["bisque", "clay_foot"]), 500 + i)
for i in range(9):
    ar.shard(None, (12.5 + rnd.uniform(-0.6, 1.4), rnd.uniform(-0.9, -0.2), 1.4 + rnd.uniform(-0.6, 1.6)), rnd.uniform(0.06, 0.13), rnd.choice(["bone", "cobalt"]), "bisque", 600 + i)
p = pr.parcel(None); p.location = (14.4, 1.2, 4.6); p.rotation_euler = (0.05, -0.2, 0.4); p.scale = (0.8,) * 3
sky_clouds(((26, 40, 12.0, 4.0), (30, 24, -1.0, 2.6), (15, 50, 3.5, 3.4)))
cam = camera((7.7, -12.6, 1.15), (9.55, 0, 2.05), fov_deg=35)
cam.rotation_euler.rotate_axis("Z", math.radians(-3.5))
w, hh = (int(sys.argv[-2]), int(sys.argv[-1])) if sys.argv[-1].isdigit() else (1600, 840)
render(os.path.join(OUT, "key_art_render.png"), w, hh, samples=32)
print("key art", tri_count(), "tris", round(time.time() - t0, 1), "s")
