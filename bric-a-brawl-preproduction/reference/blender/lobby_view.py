"""lobby_view.py - The Saucer: the playable lobby. One unbreakable saucer, the ready platter, a dummy, the catalogue stand."""
import sys, os, math, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bpy
from ceramic import *
import characters as ch, arena as ar, props as pr
from stage import place, part, shadow, sky_clouds
reset(); sky_world()
s = Builder("ARENA_saucer", 40)
s.lathe([(0.0, -1.5, "u"), (2.2, -1.45, "u"), (2.6, -1.25, "u"), (5.6, -0.42, "u"), (7.3, -0.06, "band"), (7.45, 0.0, "lip"), (7.3, 0.05, "lip"), (6.2, 0.0, "top"), (2.4, 0.0, "top"), (0.0, 0.0, "top")], segs=40, sub=2, wobble=0.006, squash=(1.0, 0.42))
s.finish(colours={"u": "clay_foot", "band": "willow_line", "lip": "willow_glaze", "top": "willow_glaze"}, finishes={"u": "bisque"})
p = Builder("PROP_ready_platter", 41)
p.lathe([(0.0, 0.0, "c"), (1.7, 0.0, "c"), (2.25, 0.08, "b"), (2.45, 0.13, "g"), (2.4, 0.16, "g"), (1.7, 0.07, "c"), (0.0, 0.06, "c")], segs=28, sub=2, wobble=0.008, squash=(1.0, 0.5))
po = p.finish(colours={"c": "bone", "b": "willow_blue", "g": "gilt"}, finishes={"g": "gilt"}); po.location = (0.6, 0, 0.01)
d = Builder("PROP_dummy_vase", 42)
d.lathe([(0.0, 0.0, "a"), (0.3, 0.0, "a"), (0.34, 0.04, "a"), (0.5, 0.5, "a"), (0.46, 0.95, "b"), (0.2, 1.3, "a"), (0.17, 1.45, "a"), (0.26, 1.55, "b"), (0.0, 1.56, "b")], segs=20, sub=3, wobble=0.02)
do = d.finish(colours={"a": "celadon", "b": "celadon_dk"}); do.location = (-5.0, 0, 0.0)
c = Builder("PROP_catalogue_stand", 43)
c.sweep([(0, 0, 0), (0, 0, 1.15)], [0.09, 0.06], segs=8, sub=1, slot="w"); c.lathe([(0.0, 0.0, "w"), (0.34, 0.0, "w"), (0.3, 0.06, "w"), (0.0, 0.08, "w")], segs=14, sub=1, wobble=0.01)
c.blob((0.0, -0.05, 1.22), (0.42, 0.3, 0.035), "p", segs=10, rings=4, tilt=(math.radians(-28), 0, 0))
co = c.finish(colours={"w": "tenmoku", "p": "bone"}, finishes={"w": "satin", "p": "bisque"}); co.location = (5.3, 0.2, 0.0)
place(ch.earl, "cobalt", 0.0, 0.07); place(ch.grog, "oxblood", 1.9, 0.05, facing=-1); place(ch.nesta, "mustard", -2.6, 0.02, size="big"); shadow(-2.6, 0, 0.85)
place(ch.moss, "verdigris", 3.9, 0.02, facing=-1); shadow(3.9, 0, 0.6); place(ch.earl, "rose", -4.0, 1.5, lean=-12)
sky_clouds(((-13, 30, 8.0, 3.0), (15, 40, 9.5, 3.8), (21, 26, -1.0, 2.4)))
camera((0.0, -19.5, 4.6), (0.3, 0, 1.9), fov_deg=30); render(os.path.join(OUT, "lobby_saucer.png"), 1280, 720, samples=24)
print("lobby done")
