"""measure.py - writes out/tri_counts.json (fighters and gadgets). The character and gadget sheets read it."""
import sys, os, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from ceramic import reset, OUT
import characters as ch, props as pr
out = {}
for nm in ch.BUILDERS:
    reset(); r = ch.BUILDERS[nm]("cobalt"); objs = [o for o in r.children_recursive if o.type == "MESH"]
    out[nm] = {"tris": sum(len(p.vertices) - 2 for o in objs for p in o.data.polygons), "parts": len(objs)}
for gid, fn in pr.GADGETS:
    reset(); g = fn(None); out["gadget_" + gid] = {"tris": sum(len(p.vertices) - 2 for p in g.data.polygons)}
json.dump(out, open(os.path.join(OUT, "tri_counts.json"), "w"), indent=1); print("TRIS", out)
