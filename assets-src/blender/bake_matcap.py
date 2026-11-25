"""bake_matcap.py - bakes the ONE packed matcap the whole game uses (256x256 PNG, linear data).
   R = soft diffuse shading   G = sharp "window pane" highlight   B = broad sheen + rim
   Cycles, CPU, ~25 s total on 2 vCPUs. Re-run only if the lighting rig changes."""
import bpy, math, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import numpy as np
from ceramic import OUT

RES = 256
def setup():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    s = bpy.context.scene; s.render.engine = "CYCLES"; s.cycles.device = "CPU"; s.cycles.samples = 96; s.cycles.use_denoising = True
    s.render.resolution_x = s.render.resolution_y = RES; s.view_settings.view_transform = "Raw"
    s.render.image_settings.file_format = "PNG"; s.render.image_settings.color_mode = "RGB"; s.render.film_transparent = False
    w = bpy.data.worlds.new("w"); s.world = w
    try: w.use_nodes = True
    except Exception: pass
    w.node_tree.nodes["Background"].inputs[0].default_value = (0, 0, 0, 1)
    bpy.ops.mesh.primitive_uv_sphere_add(segments=96, ring_count=48, radius=1.0)
    sph = bpy.context.object
    for p in sph.data.polygons: p.use_smooth = True
    cam = bpy.data.cameras.new("c"); cam.type = "ORTHO"; cam.ortho_scale = 2.0
    co = bpy.data.objects.new("c", cam); s.collection.objects.link(co); co.location = (0, -6, 0); co.rotation_euler = (math.radians(90), 0, 0); s.camera = co
    return s, sph

def area(name, loc, size, energy, target=(0, 0, 0), size_y=None):
    from mathutils import Vector
    l = bpy.data.lights.new(name, "AREA"); l.energy = energy; l.size = size
    if size_y: l.shape = "RECTANGLE"; l.size_y = size_y
    o = bpy.data.objects.new(name, l); bpy.context.scene.collection.objects.link(o); o.location = loc
    o.rotation_euler = (Vector(target) - Vector(loc)).to_track_quat("-Z", "Y").to_euler()
    return o

def mat(kind):
    m = bpy.data.materials.new(kind)
    try: m.use_nodes = True
    except Exception: pass
    b = m.node_tree.nodes["Principled BSDF"]
    if kind == "diffuse":
        b.inputs["Base Color"].default_value = (0.8, 0.8, 0.8, 1); b.inputs["Roughness"].default_value = 1.0
        b.inputs["Specular IOR Level"].default_value = 0.0
    else:
        b.inputs["Base Color"].default_value = (0, 0, 0, 1); b.inputs["Specular IOR Level"].default_value = 1.0
        b.inputs["Roughness"].default_value = 0.06 if kind == "gloss" else 0.42
    return m

def shot(s, sph, kind, lights):
    for o in [o for o in s.objects if o.type == "LIGHT"]:
        bpy.data.objects.remove(o)
    lights()
    sph.data.materials.clear(); sph.data.materials.append(mat(kind))
    p = os.path.join(OUT, f"_matcap_{kind}.png"); s.render.filepath = p
    bpy.ops.render.render(write_still=True)
    img = bpy.data.images.load(p); a = np.array(img.pixels[:]).reshape(RES, RES, 4)[:, :, :3].mean(axis=2)
    bpy.data.images.remove(img)
    return a

def rig_diffuse():
    area("key", (-3.2, -4.0, 4.2), 5.0, 900)        # big soft key, upper left front
    area("fill", (4.5, -3.0, 0.5), 6.0, 170)        # low fill from the right
    area("bounce", (0.0, -1.0, -5.0), 8.0, 90)      # table bounce from below
def rig_gloss():
    # a four-pane window, upper left: reads as "an ornament near a window"
    for ix in (-1, 1):
        for iz in (-1, 1):
            area(f"pane{ix}{iz}", (-3.2 + ix * 0.95, -4.4, 3.4 + iz * 0.95), 1.55, 420, target=(0, 0, 0))
    area("strip", (4.8, -2.0, 1.0), 0.5, 60, size_y=4.0)  # thin vertical strip on the right edge
def rig_sheen():
    area("top", (0.0, 1.5, 5.5), 7.0, 500)          # broad top/back sheen
    area("rimL", (-5.5, 2.5, 0.5), 3.0, 260); area("rimR", (5.5, 2.5, 0.5), 3.0, 260)

s, sph = setup()
R = shot(s, sph, "diffuse", rig_diffuse)
G = shot(s, sph, "gloss", rig_gloss)
B = shot(s, sph, "sheen", rig_sheen)
R = np.clip(R / max(np.percentile(R, 99.5), 1e-6), 0, 1) ** 0.85     # normalise: brightest diffuse = 1
R = 0.30 + 0.70 * R                                                  # lift the floor: ceramics never go black
G = np.clip(G * 1.4, 0, 1); B = np.clip(B * 1.2, 0, 1)
packed = np.dstack([R, G, B, np.ones_like(R)]).astype(np.float32)
img = bpy.data.images.new("matcap_packed", RES, RES, alpha=False); img.colorspace_settings.name = "Non-Color"
img.pixels = packed.ravel().tolist(); img.filepath_raw = os.path.join(OUT, "matcap_packed.png"); img.file_format = "PNG"; img.save()
for k in ("diffuse", "gloss", "sheen"):
    os.remove(os.path.join(OUT, f"_matcap_{k}.png"))
print("matcap baked", os.path.getsize(os.path.join(OUT, "matcap_packed.png")), "bytes")
