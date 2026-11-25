"""stage.py - helpers shared by scene scripts: placing fighters, finding parts, blob shadows, clouds."""
import math
from ceramic import Builder, empty, flat_material
import arena as ar

def place(builder, livery, x, z, facing=1, lean=0.0, y=0.0, **kw):
    outer = empty("facing", None, (x, y, z)); outer.rotation_euler = (0, 0, math.radians(-42 if facing > 0 else 222))
    root = builder(livery, **kw); root.parent = outer; root.rotation_euler = (0, math.radians(lean), 0)
    return outer, root

def part(root, suffix):
    return next(o for o in root.children_recursive if o.name.split(".")[0].endswith(suffix))

def shadow(x, z, r=0.75, y=0.0):
    b = Builder("FX_blob_shadow", 1); b.lathe([(0.0, 0.0, "s"), (r, 0.0, "s")], segs=18, sub=1, wobble=0.0, squash=(1.0, 0.8))
    ob = b.finish(colours={"s": "ink"}); ob.location = (x, y, z + 0.015); ob.data.materials[0] = flat_material("ink", alpha=0.28)
    return ob

def sky_clouds(spec):
    for i, (cx, cy, cz, cs) in enumerate(spec):
        ar.cloud(None, (cx, cy, cz), cs, 60 + i)
