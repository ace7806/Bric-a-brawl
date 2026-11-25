"""ceramic.py - shared modelling + "engine-look" preview library for BRIC-A-BRAWL.

Runs in headless Blender (tested: bpy 5.3.0 from PyPI, CPU only, 2 vCPUs).
Everything here is pure bmesh + nodes. No add-ons, no downloaded assets.

House rules encoded in this file (see ART_BIBLE.md):
  * Every form is THROWN (a lathe profile) or PULLED (a swept tube). No raw primitives.
  * Every form wobbles 1-2% so nothing is CG-perfect ("the potter's thumb").
  * Faces carry a palette SLOT, not a colour. Colour is assigned at render/run time.
  * Preview renders use the same shading model as the game: packed matcap, no lights.

Axes (Blender, Z up):  +X = character forward / stage right,  +Z = up,
                       -Y = toward the gameplay camera.   1 unit = 1 game unit.
"""
import bpy, bmesh, math, os, random
from mathutils import Vector, Matrix

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "out")
os.makedirs(OUT, exist_ok=True)

# ---------------------------------------------------------------- palette
def hex2lin(h):
    h = h.lstrip("#")
    c = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    return tuple((v / 12.92) if v <= 0.04045 else ((v + 0.055) / 1.055) ** 2.4 for v in c)

PAL = {  # single source of truth is data/palette.json; mirrored here for standalone runs
    "bone": "#F2EEE6", "slip": "#EAE3D2", "bisque": "#D8B596", "terracotta": "#B5633F",
    "iron": "#5A2E22", "ash": "#8E8478", "ink": "#2B2623",
    "cobalt": "#24459A", "celadon": "#9DBFA6", "oxblood": "#A3312B", "mustard": "#E3A72F",
    "verdigris": "#2F8F7A", "tangerine": "#E36F36", "aubergine": "#6A3F78", "rose": "#DA7F98",
    "tenmoku": "#3A2A22", "basalt": "#3A322D", "celery": "#A9B544", "gilt": "#C8A24A", "cheek": "#E9A39A", "sky_top": "#A9C2BC",
    "sky_mid": "#E4D3B5", "sky_low": "#D9A886", "cloud": "#EFE7D8", "willow_blue": "#8C9FC6", "willow_line": "#5E78B0", "clay_foot": "#9C6B55",
    "celadon_dk": "#6E9A85", "grass": "#A8C29A", "stamp": "#B5432E", "tea_cream": "#EFE3C8", "tea_rose": "#D9A5A0", "bowl_tenmoku": "#4A372C", "bowl_inner": "#B9CDB8", "tea": "#C08A4E", "willow_glaze": "#EDEAE2", "delft_ink": "#1E3A8A",
}
PLAYER_COLOURS = ["cobalt", "oxblood", "mustard", "verdigris", "tangerine", "aubergine", "rose", "celery"]

# finish: (gloss, sheen, metal)  -> how the packed matcap channels are combined
FINISH = {"glaze": (1.0, 0.35, 0.0), "satin": (0.35, 0.5, 0.0), "bisque": (0.0, 0.12, 0.0), "gilt": (0.9, 0.6, 1.0), "flat": (0.0, 0.0, 0.0)}

# ---------------------------------------------------------------- scene helpers
_MATS = {}
_MATCAP = None
def reset():
    global _MATCAP
    bpy.ops.wm.read_factory_settings(use_empty=True)
    _MATS.clear(); _MATCAP = None
    s = bpy.context.scene
    s.render.engine = "CYCLES"
    s.cycles.device = "CPU"
    s.cycles.samples = 24
    s.cycles.use_denoising = True
    s.cycles.max_bounces = 2
    s.view_settings.view_transform = "Standard"
    s.view_settings.look = "None"
    s.render.image_settings.file_format = "PNG"
    return s

def link(ob, parent=None):
    bpy.context.scene.collection.objects.link(ob)
    if parent is not None:
        ob.parent = parent
    return ob

def empty(name, parent=None, loc=(0, 0, 0)):
    e = bpy.data.objects.new(name, None)
    e.location = loc
    return link(e, parent)

# ---------------------------------------------------------------- curves
def catmull(points, sub=4):
    """Catmull-Rom through control points. points: list of tuples (any length >= 2 floats)."""
    if sub <= 1 or len(points) < 3:
        return list(points)
    n = len(points[0]); out = []
    P = [points[0]] + list(points) + [points[-1]]
    for i in range(1, len(P) - 2):
        p0, p1, p2, p3 = P[i - 1], P[i], P[i + 1], P[i + 2]
        for s in range(sub):
            t = s / sub; t2 = t * t; t3 = t2 * t
            out.append(tuple(0.5 * ((2 * p1[k]) + (-p0[k] + p2[k]) * t + (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * t2 + (-p0[k] + 3 * p1[k] - 3 * p2[k] + p3[k]) * t3) for k in range(n)))
    out.append(tuple(points[-1]))
    return out

# ---------------------------------------------------------------- mesh builders
class Builder:
    """Accumulates geometry for ONE rigid part. Faces are tagged with material slot names."""
    def __init__(self, name, seed=0):
        self.name = name; self.bm = bmesh.new(); self.slots = []; self.rnd = random.Random(seed)

    def _slot(self, slot):
        if slot not in self.slots:
            self.slots.append(slot)
        return self.slots.index(slot)

    def lathe(self, profile, segs=24, sub=3, wobble=0.015, axis="Z", origin=(0, 0, 0), squash=(1, 1), bend=None, lobes=3):
        """profile: [(radius, height, slot), ...] bottom to top. Smoothed with Catmull-Rom.
        squash=(sx, sy) flattens the cross-section. bend=fn(h)->(dx,dy) offsets ring centres (curved cones).
        axis 'Z' spins around +Z; 'X' spins around +X (height runs along +X)."""
        ctrl = [(p[0], p[1]) for p in profile]
        pts = catmull(ctrl, sub)
        slots = []
        for i in range(len(profile) - 1):
            slots += [profile[i + 1][2] if len(profile[i + 1]) > 2 else "body"] * sub
        ph = self.rnd.uniform(0, 6.28); rings = []
        for (r, h) in pts:
            r = max(r, 0.0)
            if r < 1e-4:
                rings.append(None); continue
            ring = []
            for i in range(segs):
                a = 2 * math.pi * i / segs
                w = 1 + wobble * math.sin(lobes * a + ph + h * 2.3) + wobble * 0.5 * math.sin(2 * a - ph * 1.7 + h * 5.1)
                ring.append((r * w * math.cos(a) * squash[0], r * w * math.sin(a) * squash[1]))
            rings.append(ring)
        verts = []
        for (r, h), ring in zip(pts, rings):
            dx, dy = bend(h) if bend else (0, 0)
            def place(u, v):
                if axis == "Z":
                    return self.bm.verts.new((origin[0] + u + dx, origin[1] + v + dy, origin[2] + h))
                return self.bm.verts.new((origin[0] + h, origin[1] + u + dx, origin[2] + v + dy))
            if ring is None:
                verts.append([place(0, 0)])
            else:
                verts.append([place(u, v) for (u, v) in ring])
        for k in range(len(verts) - 1):
            a, b = verts[k], verts[k + 1]
            mi = self._slot(slots[min(k, len(slots) - 1)])
            if len(a) == 1 and len(b) == 1:
                continue
            for i in range(segs):
                j = (i + 1) % segs
                try:
                    if len(a) == 1:
                        f = self.bm.faces.new((a[0], b[j], b[i]))
                    elif len(b) == 1:
                        f = self.bm.faces.new((a[i], a[j], b[0]))
                    else:
                        f = self.bm.faces.new((a[i], a[j], b[j], b[i]))
                    f.material_index = mi; f.smooth = True
                except ValueError:
                    pass
        return self

    def sweep(self, path, radii, segs=10, sub=3, slot="body", squash=1.0, cap=True):
        """Tube pulled along a path. path: [(x,y,z)...]; radii: one per control point (or a single float)."""
        if isinstance(radii, (int, float)):
            radii = [radii] * len(path)
        ctrl = [tuple(p) + (r,) for p, r in zip(path, radii)]
        pts = catmull(ctrl, sub)
        mi = self._slot(slot); rings = []
        up = Vector((0, 0, 1)); prev_n = None
        for i, p in enumerate(pts):
            c = Vector(p[:3]); r = max(p[3], 1e-4)
            t = (Vector(pts[min(i + 1, len(pts) - 1)][:3]) - Vector(pts[max(i - 1, 0)][:3])).normalized()
            n = (prev_n - t * prev_n.dot(t)) if prev_n is not None else (up - t * up.dot(t))
            if n.length < 1e-5:
                n = Vector((1, 0, 0)) - t * t.x
            n.normalize(); b = t.cross(n); prev_n = n
            rings.append([self.bm.verts.new(c + (n * math.cos(2 * math.pi * k / segs) + b * math.sin(2 * math.pi * k / segs) * squash) * r) for k in range(segs)])
        for a, b in zip(rings[:-1], rings[1:]):
            for i in range(segs):
                j = (i + 1) % segs
                f = self.bm.faces.new((a[i], a[j], b[j], b[i])); f.material_index = mi; f.smooth = True
        if cap:
            for ring, flip in ((rings[0], True), (rings[-1], False)):
                try:
                    f = self.bm.faces.new(ring[::-1] if flip else ring); f.material_index = mi; f.smooth = True
                except ValueError:
                    pass
        return self

    def blob(self, centre, radii, slot="body", segs=12, rings=6, wobble=0.02, tilt=(0, 0, 0)):
        """A thrown ball: lathe of a semicircle, squashed. Used for hands, feet, cheeks, eyes."""
        sub = Builder("tmp", self.rnd.randint(0, 9999))
        prof = [(math.sin(math.pi * i / rings) * 1.0, -math.cos(math.pi * i / rings) * 1.0, slot) for i in range(rings + 1)]
        prof[0] = (0.0, -1.0, slot); prof[-1] = (0.0, 1.0, slot)
        sub.lathe(prof, segs=segs, sub=1, wobble=wobble)
        M = Matrix.Translation(Vector(centre)) @ (Matrix.Rotation(tilt[2], 4, "Z") @ Matrix.Rotation(tilt[1], 4, "Y") @ Matrix.Rotation(tilt[0], 4, "X")) @ Matrix.Diagonal(Vector((radii[0], radii[1], radii[2], 1)))
        vmap = {}
        for v in sub.bm.verts:
            vmap[v] = self.bm.verts.new(M @ v.co)
        mi = self._slot(slot)
        for f in sub.bm.faces:
            try:
                nf = self.bm.faces.new([vmap[v] for v in f.verts]); nf.material_index = mi; nf.smooth = True
            except ValueError:
                pass
        sub.bm.free()
        return self

    def poly_prism(self, outline_front, outline_back, slots):
        """Low-level: two matching outlines (lists of Vector) joined by side quads. slots: per-edge slot name,
        plus slots['front'] / slots['back'] for the caps. Used for island chunks."""
        n = len(outline_front)
        fv = [self.bm.verts.new(p) for p in outline_front]; bv = [self.bm.verts.new(p) for p in outline_back]
        for i in range(n):
            j = (i + 1) % n
            f = self.bm.faces.new((fv[i], fv[j], bv[j], bv[i])); f.material_index = self._slot(slots["edges"][i])
        f = self.bm.faces.new(fv[::-1]); f.material_index = self._slot(slots["front"])
        f = self.bm.faces.new(bv); f.material_index = self._slot(slots["back"])
        return self

    def finish(self, parent=None, loc=(0, 0, 0), colours=None, finishes=None, auto_smooth=True, tris=False):
        bmesh.ops.remove_doubles(self.bm, verts=self.bm.verts, dist=1e-5)
        bmesh.ops.recalc_face_normals(self.bm, faces=self.bm.faces)
        if tris:
            bmesh.ops.triangulate(self.bm, faces=self.bm.faces)
        me = bpy.data.meshes.new(self.name); self.bm.to_mesh(me); self.bm.free()
        ob = bpy.data.objects.new(self.name, me); ob.location = loc
        meta = []
        for s in self.slots:
            col = (colours or {}).get(s, s); fin = (finishes or {}).get(s, "glaze")
            me.materials.append(engine_material(col, fin)); meta.append([s, col, fin])
        me["bb_slots"] = __import__("json").dumps(meta)      # slot name, colour, finish per material index: read by export_gltf.py
        return link(ob, parent)

# ---------------------------------------------------------------- engine-look material
def matcap_image():
    global _MATCAP
    if _MATCAP is None:
        p = os.path.join(OUT, "matcap_packed.png")
        if not os.path.exists(p):
            raise RuntimeError("run bake_matcap.py first")
        _MATCAP = bpy.data.images.load(p); _MATCAP.colorspace_settings.name = "Non-Color"
    return _MATCAP

def engine_material(colour, finish="glaze", alpha=1.0, crack=0.0, speckle=True):
    """Emission-only material that reproduces the in-game shader:
         rgb = palette * (matcap.R * ao) + matcap.G * gloss + matcap.B * sheen   (gilt tints the highlights)
       matcap.R = soft diffuse shading, .G = sharp window-pane highlight, .B = broad sheen/rim."""
    key = (colour, finish, alpha, crack, speckle)
    if key in _MATS:
        return _MATS[key]
    gloss, sheen, metal = FINISH[finish]
    rgb = hex2lin(PAL.get(colour, colour if str(colour).startswith("#") else PAL["ink"]))
    m = bpy.data.materials.new(f"M_{colour}_{finish}")
    try:
        m.use_nodes = True
    except Exception:
        pass
    nt = m.node_tree; nt.nodes.clear(); N = nt.nodes.new; L = nt.links.new
    out = N("ShaderNodeOutputMaterial"); em = N("ShaderNodeEmission")
    geo = N("ShaderNodeNewGeometry"); vt = N("ShaderNodeVectorTransform")
    vt.vector_type = "NORMAL"; vt.convert_from = "WORLD"; vt.convert_to = "CAMERA"
    L(geo.outputs["Normal"], vt.inputs["Vector"])
    mp = N("ShaderNodeMapping"); mp.vector_type = "POINT"
    mp.inputs["Scale"].default_value = (0.49, 0.49, 1); mp.inputs["Location"].default_value = (0.5, 0.5, 0)
    L(vt.outputs["Vector"], mp.inputs["Vector"])
    tex = N("ShaderNodeTexImage"); tex.image = matcap_image(); tex.extension = "EXTEND"; tex.interpolation = "Cubic"
    L(mp.outputs["Vector"], tex.inputs["Vector"])
    sep = N("ShaderNodeSeparateColor"); L(tex.outputs["Color"], sep.inputs["Color"])
    ao = N("ShaderNodeAmbientOcclusion"); ao.samples = 8; ao.inputs["Distance"].default_value = 0.7
    aom = N("ShaderNodeMapRange"); aom.inputs["From Min"].default_value = 0.0; aom.inputs["From Max"].default_value = 1.0
    aom.inputs["To Min"].default_value = 0.42; aom.inputs["To Max"].default_value = 1.0
    L(ao.outputs["AO"], aom.inputs["Value"])
    shade = N("ShaderNodeMath"); shade.operation = "MULTIPLY"
    L(sep.outputs["Red"], shade.inputs[0]); L(aom.outputs["Result"], shade.inputs[1])
    base = N("ShaderNodeRGB"); base.outputs[0].default_value = (*rgb, 1)
    base_out = base.outputs[0]
    if speckle and finish in ("glaze", "satin", "bisque"):
        # stoneware speckle: sparse dark iron flecks, object space so it sticks to the part
        tc = N("ShaderNodeTexCoord"); vor = N("ShaderNodeTexVoronoi"); vor.feature = "F1"; vor.inputs["Scale"].default_value = 26.0
        L(tc.outputs["Object"], vor.inputs["Vector"])
        thr = N("ShaderNodeMath"); thr.operation = "LESS_THAN"; thr.inputs[1].default_value = 0.055
        L(vor.outputs["Distance"], thr.inputs[0])
        nz = N("ShaderNodeTexNoise"); nz.inputs["Scale"].default_value = 3.1; L(tc.outputs["Object"], nz.inputs["Vector"])
        gate = N("ShaderNodeMath"); gate.operation = "GREATER_THAN"; gate.inputs[1].default_value = 0.56; L(nz.outputs["Fac"], gate.inputs[0])
        both = N("ShaderNodeMath"); both.operation = "MULTIPLY"; L(thr.outputs[0], both.inputs[0]); L(gate.outputs[0], both.inputs[1])
        amt = N("ShaderNodeMath"); amt.operation = "MULTIPLY"; amt.inputs[1].default_value = 0.55 if finish != "bisque" else 0.35
        L(both.outputs[0], amt.inputs[0])
        mix = N("ShaderNodeMix"); mix.data_type = "RGBA"; mix.inputs["B"].default_value = (*hex2lin(PAL["iron"]), 1)
        L(amt.outputs[0], mix.inputs["Factor"]); L(base_out, mix.inputs["A"]); base_out = mix.outputs["Result"]
    if crack > 0:
        tc2 = N("ShaderNodeTexCoord"); v2 = N("ShaderNodeTexVoronoi"); v2.feature = "DISTANCE_TO_EDGE"; v2.inputs["Scale"].default_value = 1.05
        L(tc2.outputs["Object"], v2.inputs["Vector"])
        ln = N("ShaderNodeMath"); ln.operation = "LESS_THAN"; ln.inputs[1].default_value = 0.010 + 0.012 * crack; L(v2.outputs["Distance"], ln.inputs[0])
        mixc = N("ShaderNodeMix"); mixc.data_type = "RGBA"; mixc.inputs["B"].default_value = (*hex2lin(PAL["ink"]), 1)
        L(ln.outputs[0], mixc.inputs["Factor"]); L(base_out, mixc.inputs["A"]); base_out = mixc.outputs["Result"]
    diff = N("ShaderNodeMix"); diff.data_type = "RGBA"; diff.blend_type = "MULTIPLY"; diff.inputs["Factor"].default_value = 1.0
    L(base_out, diff.inputs["A"]); L(shade.outputs[0], diff.inputs["B"])
    # highlights: white for glazes, tinted for gilt
    hi = N("ShaderNodeMath"); hi.operation = "MULTIPLY"; hi.inputs[1].default_value = gloss; L(sep.outputs["Green"], hi.inputs[0])
    sh = N("ShaderNodeMath"); sh.operation = "MULTIPLY"; sh.inputs[1].default_value = sheen * 0.45; L(sep.outputs["Blue"], sh.inputs[0])
    hs = N("ShaderNodeMath"); hs.operation = "ADD"; L(hi.outputs[0], hs.inputs[0]); L(sh.outputs[0], hs.inputs[1])
    tint = N("ShaderNodeMix"); tint.data_type = "RGBA"; tint.inputs["Factor"].default_value = metal
    tint.inputs["A"].default_value = (1, 1, 1, 1); tint.inputs["B"].default_value = (*[min(1, c * 1.6 + 0.08) for c in rgb], 1)
    spec = N("ShaderNodeMix"); spec.data_type = "RGBA"; spec.blend_type = "MULTIPLY"; spec.inputs["Factor"].default_value = 1.0
    L(tint.outputs["Result"], spec.inputs["A"]); L(hs.outputs[0], spec.inputs["B"])
    add = N("ShaderNodeMix"); add.data_type = "RGBA"; add.blend_type = "ADD"; add.inputs["Factor"].default_value = 1.0
    L(diff.outputs["Result"], add.inputs["A"]); L(spec.outputs["Result"], add.inputs["B"])
    L(add.outputs["Result"], em.inputs["Color"])
    if alpha < 1.0:
        tr = N("ShaderNodeBsdfTransparent"); ms = N("ShaderNodeMixShader"); ms.inputs[0].default_value = alpha
        L(tr.outputs[0], ms.inputs[1]); L(em.outputs[0], ms.inputs[2]); L(ms.outputs[0], out.inputs["Surface"])
    else:
        L(em.outputs[0], out.inputs["Surface"])
    _MATS[key] = m
    return m

def flat_material(colour, alpha=1.0):
    return engine_material(colour, "flat", alpha=alpha, speckle=False)

# ---------------------------------------------------------------- camera / world / render
def sky_world(top="sky_top", mid="sky_mid", low="sky_low"):
    w = bpy.data.worlds.new("sky"); bpy.context.scene.world = w
    try:
        w.use_nodes = True
    except Exception:
        pass
    nt = w.node_tree; nt.nodes.clear(); N = nt.nodes.new; L = nt.links.new
    out = N("ShaderNodeOutputWorld"); bg = N("ShaderNodeBackground")
    tc = N("ShaderNodeTexCoord"); sx = N("ShaderNodeSeparateXYZ"); L(tc.outputs["Window"], sx.inputs[0])
    ramp = N("ShaderNodeValToRGB"); cr = ramp.color_ramp
    cr.elements[0].position = 0.0; cr.elements[0].color = (*hex2lin(PAL[low]), 1)
    cr.elements[1].position = 1.0; cr.elements[1].color = (*hex2lin(PAL[top]), 1)
    e = cr.elements.new(0.5); e.color = (*hex2lin(PAL[mid]), 1)
    L(sx.outputs["Y"], ramp.inputs["Fac"]); L(ramp.outputs["Color"], bg.inputs["Color"]); L(bg.outputs[0], out.inputs["Surface"])
    return w

def camera(loc, look_at, fov_deg=30, ortho=None):
    cam = bpy.data.cameras.new("cam"); ob = link(bpy.data.objects.new("cam", cam))
    ob.location = loc
    d = Vector(look_at) - Vector(loc)
    ob.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()
    if ortho:
        cam.type = "ORTHO"; cam.ortho_scale = ortho
    else:
        cam.sensor_fit = "VERTICAL"; cam.angle_y = math.radians(fov_deg)
    bpy.context.scene.camera = ob
    return ob

def render(path, w=960, h=540, samples=24, transparent=False):
    s = bpy.context.scene
    s.render.resolution_x = w; s.render.resolution_y = h; s.render.resolution_percentage = 100
    s.cycles.samples = samples; s.render.film_transparent = transparent
    s.render.filepath = path
    bpy.ops.render.render(write_still=True)
    return path

def tri_count(objs=None):
    n = 0
    for ob in (objs or bpy.context.scene.objects):
        if ob.type == "MESH":
            n += sum(len(p.vertices) - 2 for p in ob.data.polygons)
    return n
