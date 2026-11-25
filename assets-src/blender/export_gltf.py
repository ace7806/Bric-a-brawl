"""export_gltf.py - reference export: one fighter -> one .glb the game can load.
  * all rigid parts merged into ONE mesh, ONE material slot (the game supplies GlazeMaterial)
  * ONE bone per part, every vertex weighted 1.0 to its part's bone (no weight painting, ever)
  * COLOR_0 per face corner:  R = palette slot / 15,  G = gloss,  B = AO,  A = metal
  * sidecar <name>.json: palette (slot -> colour name), parts, triangles, bounding box
Run: python3 export_gltf.py earl"""
import sys, os, json, math
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bpy, bmesh
from mathutils import Vector
from ceramic import reset, OUT, tri_count
import characters as ch

GLOSS = {"glaze": 1.0, "satin": 0.35, "bisque": 0.0, "gilt": 0.9, "flat": 0.0}
FIXED = {"livery": 2, "bone": 3, "ink": 4, "cheek": 5, "gilt": 6, "bisque": 7}     # slots every fighter shares

def export_fighter(name, livery="cobalt"):
    reset(); root = ch.BUILDERS[name](livery)
    parts = [o for o in root.children_recursive if o.type == "MESH"]
    bpy.context.view_layer.update()
    palette = {}; nxt = [0, 1] + list(range(8, 16))
    def slot_index(slot):
        if slot in FIXED: palette[slot] = FIXED[slot]
        elif slot not in palette: palette[slot] = nxt.pop(0)
        return palette[slot]
    bm = bmesh.new(); col = bm.loops.layers.float_color.new("Col"); dv = bm.verts.layers.deform.new()
    me_out = bpy.data.meshes.new(f"CHR_{name}"); ob = bpy.data.objects.new(f"CHR_{name}", me_out); bpy.context.scene.collection.objects.link(ob)
    bones = []
    for gi, p in enumerate(parts):
        meta = json.loads(p.data["bb_slots"]); M = p.matrix_world; N = M.to_3x3().inverted().transposed()
        ob.vertex_groups.new(name=p.name); bones.append((p.name, M.translation.copy()))
        vmap = {}
        for v in p.data.vertices:
            nv = bm.verts.new(M @ v.co); nv[dv][gi] = 1.0; vmap[v.index] = nv
        for poly in p.data.polygons:
            try:
                f = bm.faces.new([vmap[i] for i in poly.vertices])
            except ValueError:
                continue
            f.smooth = poly.use_smooth; slot, colour, fin = meta[poly.material_index]
            n = (N @ poly.normal).normalized(); ao = 0.55 + 0.45 * max(0.0, min(1.0, 0.5 + 0.5 * n.z))   # cheap hemisphere AO; replace with a Cycles vertex bake when proven
            for l in f.loops:
                l[col] = (slot_index(slot) / 15.0, GLOSS[fin], ao, 1.0 if fin == "gilt" else 0.0)
    bm.to_mesh(me_out); bm.free()
    arm = bpy.data.armatures.new(f"RIG_{name}"); ao_ = bpy.data.objects.new(f"RIG_{name}", arm); bpy.context.scene.collection.objects.link(ao_)
    bpy.context.view_layer.objects.active = ao_; bpy.ops.object.mode_set(mode="EDIT")
    for bn, head in bones:
        b = arm.edit_bones.new(bn); b.head = head; b.tail = head + Vector((0, 0, 0.2))
    bpy.ops.object.mode_set(mode="OBJECT")
    ob.parent = ao_; mod = ob.modifiers.new("Armature", "ARMATURE"); mod.object = ao_
    for o in parts + [root]:
        bpy.data.objects.remove(o)
    for o in bpy.context.scene.objects: o.select_set(o in (ob, ao_))
    path = os.path.join(OUT, f"{name}.glb")
    bpy.ops.export_scene.gltf(filepath=path, export_format="GLB", use_selection=True, export_yup=True, export_materials="NONE", export_vertex_color="ACTIVE",
                              export_all_vertex_colors=True, export_active_vertex_color_when_no_material=True, export_skins=True, export_animations=False,
                              export_meshopt_compression_enable=True)
    bb = [list(map(lambda x: round(x, 3), v)) for v in (Vector(min(c) for c in zip(*[ob.matrix_world @ Vector(b) for b in ob.bound_box])), Vector(max(c) for c in zip(*[ob.matrix_world @ Vector(b) for b in ob.bound_box])))]
    side = {"asset": f"CHR_{name}", "generator": "reference/blender/characters.py", "triangles": tri_count([ob]), "bones": [b[0] for b in bones],
            "palette": {str(v): k for k, v in sorted(palette.items(), key=lambda kv: kv[1])}, "bbox": bb, "bytes": os.path.getsize(path)}
    json.dump(side, open(os.path.join(OUT, f"{name}.json"), "w"), indent=1)
    return side

if __name__ == "__main__":
    for n in ([a for a in sys.argv[1:] if a in ch.BUILDERS] or list(ch.BUILDERS)):
        print("EXPORT", json.dumps(export_fighter(n)))
