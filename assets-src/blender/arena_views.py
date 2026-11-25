"""arena_views.py - concept views of the three arenas from the gameplay camera, with fighters for scale."""
import sys, os, math, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bpy
from mathutils import Vector
from ceramic import *
import characters as ch, arena as ar, props as pr
from stage import place, part, shadow, sky_clouds
t0 = time.time()
which = [a for a in sys.argv if a in ("willow", "high_tea", "mended_bowl")] or ["willow", "high_tea", "mended_bowl"]
if "willow" in which:
    reset(); sky_world(); ar.build_arena("willow", {})
    place(ch.earl, "cobalt", -4.5, 0.02); shadow(-4.5, 0); place(ch.grog, "oxblood", 4.2, 0.0, facing=-1); shadow(4.2, 0, 1.05)
    place(ch.nesta, "mustard", 0.0, 3.1, size="mid"); place(ch.moss, "verdigris", 8.4, 3.12, facing=-1)
    sky_clouds(((-15, 30, 13.0, 3.0), (18, 40, 15.0, 4.0), (26, 26, 1.0, 2.6), (-24, 34, 0.0, 3.2)))
    camera((0.0, -30.5, 7.6), (0.0, 0, 3.4), fov_deg=30); render(os.path.join(OUT, "arena_willow.png"), 1280, 720, samples=24)
if "high_tea" in which:
    reset(); sky_world(top="sky_top", mid="sky_mid", low="sky_low"); ar.build_arena("high_tea", {})
    place(ch.earl, "cobalt", -7.0, 0.02); shadow(-7.0, 0); place(ch.grog, "oxblood", 6.0, 0.0, facing=-1); shadow(6.0, 0, 1.05)
    place(ch.nesta, "mustard", -3.6, 4.22, size="mid"); place(ch.moss, "verdigris", 1.6, 8.02, facing=-1)
    place(ch.nesta, "rose", 12.4, 2.82, facing=-1, size="small")
    sky_clouds(((-18, 34, 16.0, 3.4), (-26, 28, 2.0, 2.8), (22, 44, 4.0, 4.0)))
    camera((0.0, -33.0, 9.6), (0.0, 0, 5.3), fov_deg=30); render(os.path.join(OUT, "arena_high_tea.png"), 1280, 720, samples=24)
if "mended_bowl" in which:
    reset(); sky_world(); ar.build_arena("mended_bowl", {"shardTop": "gone"}, shift=2.3)
    place(ch.earl, "cobalt", -6.2, 0.02); shadow(-6.2, 0); place(ch.grog, "oxblood", 6.9, 0.0, facing=-1); shadow(6.9, 0, 1.05)
    place(ch.nesta, "mustard", -0.4, 3.2, size="small", lean=-12); place(ch.moss, "verdigris", 0.9, 5.3, facing=-1, lean=14)
    place(ch.earl, "celery", 13.9, 3.02, facing=-1)
    sky_clouds(((-17, 30, 13.5, 3.0), (20, 40, 15.0, 4.0), (-27, 30, 1.0, 3.0)))
    camera((0.0, -31.5, 7.6), (0.0, 0, 3.3), fov_deg=30); render(os.path.join(OUT, "arena_mended_bowl.png"), 1280, 720, samples=24)
print("arena views done", round(time.time() - t0, 1))
