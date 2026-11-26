"""Stylized low-poly 2.5D character sculpting, garment extraction, UV baking & cel-texture painting toolkit.

Starts from Blender Studio's official CC0 Stylized Human Base Meshes (zero primitive blob bodies!),
sculpts character-specific anatomical proportions, extracts organic clothing directly off the
humanoid surface, builds faceted beveled hero gear (living-flame head, colossal brass/lava gauntlets,
billowing scarf, wraps & sandals), bakes real Cycles Ambient Occlusion + Pointiness curvature, and
composites crisp 2048x2048 Guilty-Gear-style cel albedo + inner-ink + emissive texture atlases.
"""
from __future__ import annotations

import math
import os
import urllib.request
import zipfile
import bpy
import bmesh
import numpy as np
from mathutils import Euler, Matrix, Vector
from PIL import Image, ImageFilter

ROOT_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
BASE_MESH_DIR = os.path.join(ROOT_DIR, "assets-src", "base-meshes")
BASE_MESH_BLEND = os.path.join(BASE_MESH_DIR, "human_base_meshes_bundle.blend")
BASE_MESH_URL = "https://download.blender.org/demo/bundles/bundles-3.6/human-base-meshes-bundle-v1.0.0.zip"


def ensure_base_meshes() -> str:
    """Download and extract Blender Studio's official CC0 Human Base Meshes if not cached locally."""
    if os.path.isfile(BASE_MESH_BLEND):
        return BASE_MESH_BLEND
    os.makedirs(BASE_MESH_DIR, exist_ok=True)
    zip_path = os.path.join(BASE_MESH_DIR, "human_base_meshes.zip")
    print(f"[mesh_craft] Downloading CC0 Human Base Meshes -> {zip_path}")
    urllib.request.urlretrieve(BASE_MESH_URL, zip_path)
    with zipfile.ZipFile(zip_path, "r") as zf:
        zf.extractall(BASE_MESH_DIR)
    os.remove(zip_path)
    return BASE_MESH_BLEND


def reset_scene() -> None:
    """Clear scene to a clean empty Blender state."""
    bpy.ops.wm.read_factory_settings(use_empty=True)


def set_smooth_and_weighted_normals(obj: bpy.types.Object, angle_deg: float = 42.0) -> None:
    """Apply crisp stylized shading: smooth across organic bends, sharp across armor bevels."""
    me = obj.data
    me.polygons.foreach_set("use_smooth", [True] * len(me.polygons))
    if hasattr(me, "use_auto_smooth"):
        me.use_auto_smooth = True
        me.auto_smooth_angle = math.radians(angle_deg)
    try:
        mod = obj.modifiers.new("WeightedNormal", "WEIGHTED_NORMAL")
        mod.keep_sharp = True
        bpy.ops.object.select_all(action="DESELECT")
        obj.select_set(True)
        bpy.context.view_layer.objects.active = obj
        bpy.ops.object.modifier_apply(modifier=mod.name)
    except RuntimeError:
        pass


def load_cc0_stylized_body(
    source_obj_name: str = "GEO-body_male_stylized",
    target_height: float = 1.65,
    unsubdiv_iters: int = 2,
) -> bpy.types.Object:
    """Append CC0 stylized humanoid, normalize to origin X=0/Z=0, unsubdivide to clean low-poly quads."""
    blend_path = ensure_base_meshes()
    with bpy.data.libraries.load(blend_path, link=False) as (data_from, data_to):
        assert source_obj_name in data_from.objects, f"Missing {source_obj_name} in CC0 bundle"
        data_to.objects = [source_obj_name]

    obj = data_to.objects[0]
    bpy.context.scene.collection.objects.link(obj)
    obj.name = "BodyBase"
    obj.modifiers.clear()
    obj.vertex_groups.clear()

    # Bake world transform, center X=0, soles Z=0, scale cleanly to target_height
    vs_w = [obj.matrix_world @ v.co for v in obj.data.vertices]
    cx = 0.5 * (min(v.x for v in vs_w) + max(v.x for v in vs_w))
    cy = 0.5 * (min(v.y for v in vs_w) + max(v.y for v in vs_w))
    mz = min(v.z for v in vs_w)
    cur_h = max(0.1, max(v.z for v in vs_w) - mz)
    s = target_height / cur_h
    for v in obj.data.vertices:
        w = obj.matrix_world @ v.co
        v.co = Vector(((w.x - cx) * s, (w.y - cy) * s, (w.z - mz) * s))
    obj.matrix_world.identity()

    if unsubdiv_iters > 0:
        mod = obj.modifiers.new("Unsub", "DECIMATE")
        mod.decimate_type = "UNSUBDIV"
        mod.iterations = unsubdiv_iters
        bpy.ops.object.select_all(action="DESELECT")
        obj.select_set(True)
        bpy.context.view_layer.objects.active = obj
        bpy.ops.object.modifier_apply(modifier=mod.name)

    return obj


def sculpt_hero_proportions(
    body_obj: bpy.types.Object,
    shoulder_w: float = 1.12,
    waist_w: float = 0.90,
    chest_depth: float = 1.08,
    leg_musc: float = 1.06,
    arm_musc: float = 1.10,
) -> None:
    """Apply smooth anatomical heroic-fighter proportion shaping while preserving continuous quad flow."""
    vs = [v.co for v in body_obj.data.vertices]
    H = max(v.z for v in vs)
    for v in body_obj.data.vertices:
        p = v.co
        zf = p.z / H
        # Heroic V-taper on torso (broad shoulders/chest, athletic waist)
        if 0.50 <= zf <= 0.82:
            # Bell weight centered around upper chest / shoulders (0.74)
            w_sh = math.exp(-((zf - 0.74) / 0.11) ** 2)
            # Bell weight centered around waist (0.58)
            w_wa = math.exp(-((zf - 0.58) / 0.065) ** 2)
            sx = 1.0 + (shoulder_w - 1.0) * w_sh + (waist_w - 1.0) * w_wa
            sy = 1.0 + (chest_depth - 1.0) * w_sh + (waist_w - 1.0) * 0.5 * w_wa
            # Keep arms slightly outside torso from over-widening horizontally
            if abs(p.x) < 0.19 * H:
                p.x *= sx
                p.y *= sy
            else:
                # Shift arms outward cleanly with broadened shoulders + add heroic bicep fullness
                p.x += math.copysign((shoulder_w - 1.0) * 0.12 * H * w_sh, p.x)
                p.y *= 1.0 + (arm_musc - 1.0) * 0.65
        elif zf < 0.50:
            # Slight martial-arts athletic leg fullness
            if abs(p.x) < 0.17 * H:
                p.y *= 1.0 + (leg_musc - 1.0) * math.sin(min(1.0, zf / 0.50) * math.pi)
    body_obj.data.update()


def extract_surface_shell(
    source_obj: bpy.types.Object,
    name: str,
    face_predicate,
    offset: float = 0.012,
    thickness: float = 0.016,
    flare_fn=None,
    crease_amp: float = 0.0,
) -> bpy.types.Object:
    """Extract an organic garment shell directly off anatomical faces, then flare, fold, and solidify."""
    bm = bmesh.new()
    bm.from_mesh(source_obj.data)
    bm.faces.ensure_lookup_table()

    keep = [f for f in bm.faces if face_predicate(f.calc_center_median(), f.normal)]
    keep_set = set(keep)
    del_faces = [f for f in bm.faces if f not in keep_set]
    bmesh.ops.delete(bm, geom=del_faces, context="FACES")

    # Clean orphan edges/verts
    bm.verts.ensure_lookup_table()
    # Smoothly push vertices outward along normals + apply garment silhouette flare & cloth folds
    bm.normal_update()
    for v in bm.verts:
        orig_p = v.co.copy()
        p = orig_p.copy()
        n = v.normal.copy()
        p += n * offset
        if flare_fn is not None:
            p = flare_fn(p, n)
        if crease_amp > 0.0:
            ang = math.atan2(p.y, p.x)
            fold = math.sin(ang * 7.0 + p.z * 14.0) * crease_amp
            p += n * fold
        # Guard against inner-leg vertices cleanly below pelvis crotch inseam crossing X=0 even AFTER Solidify!
        safe_x = max(0.014, thickness + 0.006)
        if orig_p.z < 0.66 and abs(orig_p.x) > 0.003:
            if orig_p.x > 0.0 and p.x < safe_x:
                p.x = safe_x
            elif orig_p.x < 0.0 and p.x > -safe_x:
                p.x = -safe_x
        v.co = p

    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()

    obj = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(obj)

    if thickness > 0.0:
        mod = obj.modifiers.new("Solidify", "SOLIDIFY")
        mod.thickness = thickness
        mod.offset = 1.0
        mod.use_rim = True
        bpy.ops.object.select_all(action="DESELECT")
        obj.select_set(True)
        bpy.context.view_layer.objects.active = obj
        bpy.ops.object.modifier_apply(modifier=mod.name)

    return obj


def trim_body_regions(body_obj: bpy.types.Object, face_remove_predicate) -> None:
    """Trim hidden or replaced regions (e.g., human head under living flame, hands inside gauntlets)."""
    bm = bmesh.new()
    bm.from_mesh(body_obj.data)
    bm.faces.ensure_lookup_table()
    to_del = [f for f in bm.faces if face_remove_predicate(f.calc_center_median())]
    if to_del:
        bmesh.ops.delete(bm, geom=to_del, context="FACES")
    bm.to_mesh(body_obj.data)
    bm.free()
    body_obj.data.update()


def loft_tube(
    name: str,
    rings: list[tuple[Vector, Vector, float, float, float]],
    n_sides: int = 10,
    cap_start: bool = True,
    cap_end: bool = True,
    twist_per_ring: float = 0.0,
    sharp_creases: bool = False,
) -> bpy.types.Object:
    """Build a sculpted tapered loft mesh along arbitrary 3D cross-section rings (center, tangent, rx, ry, pinch).

    Unlike raw primitives, lofted organic ribbons/tongues/gauntlets follow authored 3D spine curves
    with elliptical/diamond/angular cross-sections and sharp stylized ridges.
    """
    bm = bmesh.new()
    ring_verts: list[list[bmesh.types.BMVert]] = []
    up_ref = Vector((0.0, 0.0, 1.0))

    for ri, (center, tangent, rx, ry, pinch) in enumerate(rings):
        t = tangent.normalized()
        ref = up_ref if abs(t.dot(up_ref)) < 0.92 else Vector((1.0, 0.0, 0.0))
        bx = t.cross(ref).normalized()
        by = bx.cross(t).normalized()
        verts_here: list[bmesh.types.BMVert] = []
        for si in range(n_sides):
            ang = (si / n_sides) * math.tau + ri * twist_per_ring
            ca = math.cos(ang)
            sa = math.sin(ang)
            # Pinch creates crisp anime flame/armor diamond ridges instead of circular pipes!
            ridge = 1.0 + pinch * math.cos(ang * 2.0)
            p = center + bx * (ca * rx * ridge) + by * (sa * ry)
            verts_here.append(bm.verts.new(p))
        ring_verts.append(verts_here)

    for ri in range(len(ring_verts) - 1):
        r0 = ring_verts[ri]
        r1 = ring_verts[ri + 1]
        for si in range(n_sides):
            sn = (si + 1) % n_sides
            f = bm.faces.new((r0[si], r0[sn], r1[sn], r1[si]))
            f.smooth = not sharp_creases

    if cap_start and len(ring_verts[0]) >= 3:
        c0 = bm.verts.new(rings[0][0])
        r0 = ring_verts[0]
        for si in range(n_sides):
            sn = (si + 1) % n_sides
            bm.faces.new((r0[sn], r0[si], c0))

    if cap_end and len(ring_verts[-1]) >= 3:
        c1 = bm.verts.new(rings[-1][0] + rings[-1][1].normalized() * (0.35 * max(rings[-1][2], rings[-1][3])))
        r1 = ring_verts[-1]
        for si in range(n_sides):
            sn = (si + 1) % n_sides
            bm.faces.new((r1[si], r1[sn], c1))

    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    obj = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(obj)
    return obj


def make_beveled_block(
    name: str,
    size: tuple[float, float, float],
    center: Vector,
    rot_euler: tuple[float, float, float] = (0.0, 0.0, 0.0),
    bevel_width: float = 0.012,
    bevel_segs: int = 2,
    taper_z: tuple[float, float] = (1.0, 1.0),
    taper_y: tuple[float, float] = (1.0, 1.0),
) -> bpy.types.Object:
    """Create a sculpted faceted beveled armor plate/knuckle block (not a bare cube!)."""
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    sx, sy, sz = size
    for v in bm.verts:
        tz = taper_z[1] if v.co.z > 0 else taper_z[0]
        ty = taper_y[1] if v.co.y > 0 else taper_y[0]
        v.co.x *= sx * tz * ty
        v.co.y *= sy * tz
        v.co.z *= sz
    if bevel_width > 0.0:
        bmesh.ops.bevel(
            bm,
            geom=list(bm.edges),
            offset=bevel_width,
            segments=bevel_segs,
            affect="EDGES",
            clamp_overlap=True,
        )
    M = Matrix.Translation(center) @ Euler(rot_euler, "XYZ").to_matrix().to_4x4()
    bmesh.ops.transform(bm, matrix=M, verts=bm.verts)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    obj = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(obj)
    return obj


def build_living_flame_head(lm: dict[str, Vector]) -> tuple[bpy.types.Object, bpy.types.Object]:
    """Build Style B Ignis's iconic sculpted living-flame head + fierce recessed glowing eyes."""
    H = lm["height"].z
    head_base = lm["head"] + Vector((0.0, -0.008 * H, -0.012 * H))

    # 1) Sculpted angular jawed head core tapering seamlessly into a sweeping central flame crest
    core_rings: list[tuple[Vector, Vector, float, float, float]] = [
        (head_base + Vector((0.0, 0.005 * H, -0.015 * H)), Vector((0.0, 0.0, 1.0)), 0.048 * H, 0.052 * H, 0.02),
        (head_base + Vector((0.0, -0.014 * H, 0.028 * H)), Vector((0.0, -0.05, 1.0)), 0.072 * H, 0.078 * H, 0.06),
        (head_base + Vector((0.0, -0.012 * H, 0.078 * H)), Vector((0.0, 0.06, 1.0)), 0.088 * H, 0.090 * H, 0.08),
        (head_base + Vector((0.0, 0.004 * H, 0.128 * H)), Vector((0.0, 0.22, 1.0)), 0.080 * H, 0.084 * H, 0.14),
        (head_base + Vector((0.0, 0.032 * H, 0.180 * H)), Vector((0.0, 0.42, 0.92)), 0.058 * H, 0.064 * H, 0.20),
        (head_base + Vector((0.0, 0.074 * H, 0.236 * H)), Vector((0.0, 0.56, 0.82)), 0.032 * H, 0.040 * H, 0.25),
        (head_base + Vector((0.0, 0.122 * H, 0.285 * H)), Vector((0.0, 0.72, 0.68)), 0.010 * H, 0.014 * H, 0.28),
    ]
    flame_parts = [loft_tube("FlameCore", core_rings, n_sides=12, cap_start=True, cap_end=True)]

    # 2) Sculpted layered sweeping side & brow flame licks (gives iconic blazing silhouette from BOTH front & side!)
    lick_specs = [
        # (x_off, y_off, z_off, x_sweep, y_sweep, z_height, rad)
        (0.058, 0.004, 0.098, 0.042, 0.078, 0.125, 0.036),   # Left upper lick
        (-0.058, 0.004, 0.098, -0.042, 0.078, 0.125, 0.036), # Right upper lick
        (0.042, -0.025, 0.118, 0.025, 0.055, 0.110, 0.028),  # Left brow horn lick
        (-0.042, -0.025, 0.118, -0.025, 0.055, 0.110, 0.028),# Right brow horn lick
        (0.000, 0.052, 0.092, 0.000, 0.105, 0.105, 0.034),   # Back mane lick
        (0.048, 0.038, 0.068, 0.040, 0.075, 0.088, 0.024),   # Left cheek lick
        (-0.048, 0.038, 0.068, -0.040, 0.075, 0.088, 0.024), # Right cheek lick
    ]
    for idx, (xo, yo, zo, xs, ys, zh, rad) in enumerate(lick_specs):
        p0 = head_base + Vector((xo * H, yo * H, zo * H))
        rings = []
        for s_i in range(6):
            t = s_i / 5.0
            # S-curve whip silhouette
            curve_y = ys * H * (t ** 1.35) + 0.012 * H * math.sin(t * math.pi)
            curve_x = xs * H * (t ** 1.1)
            curve_z = zh * H * (t ** 0.85)
            pos = p0 + Vector((curve_x, curve_y, curve_z))
            tang = Vector((xs * 0.8, ys * 1.4 * max(0.25, t), zh * 0.9))
            r_cur = rad * H * ((1.0 - t) ** 0.78 + 0.06)
            rings.append((pos, tang, r_cur * 0.72, r_cur * 1.15, 0.28))
        flame_parts.append(loft_tube(f"FlameLick_{idx}", rings, n_sides=8, cap_start=True, cap_end=True))

    # Merge flame parts cleanly into single LivingFlameHead object
    bpy.ops.object.select_all(action="DESELECT")
    for p in flame_parts:
        p.select_set(True)
    bpy.context.view_layer.objects.active = flame_parts[0]
    bpy.ops.object.join()
    flame_head = bpy.context.active_object
    flame_head.name = "Ignis_FlameHead"

    # 3) Fierce angled triangular hero eyes + crisp dark comic eye-frame bezels sitting cleanly on the front flame face!
    eye_objs = []
    frame_objs = []
    for side in (-1.0, 1.0):
        # White glowing eye inner shape curved gently around front flame cheek (front surface at y ≈ -0.102*H)
        pts_2d = [
            Vector((0.011 * H * side, -0.005 * H, -0.003 * H)),  # inner corner (closest to camera)
            Vector((0.058 * H * side, 0.018 * H, 0.022 * H)),    # fierce slanted outer top tip
            Vector((0.050 * H * side, 0.014 * H, -0.006 * H)),   # outer lower
            Vector((0.014 * H * side, -0.006 * H, -0.014 * H)),  # inner bottom
        ]
        # Bold dark ink eye border framing the white eye cleanly (sits 3mm behind white eye, 4mm proud of flame face!)
        frame_2d = [
            Vector((0.006 * H * side, -0.001 * H, 0.003 * H)),
            Vector((0.066 * H * side, 0.024 * H, 0.029 * H)),
            Vector((0.057 * H * side, 0.019 * H, -0.012 * H)),
            Vector((0.010 * H * side, -0.001 * H, -0.020 * H)),
        ]
        for pts, target_list, prefix_n, depth in (
            (pts_2d, eye_objs, "Eye", 0.014 * H),
            (frame_2d, frame_objs, "EyeFrame", 0.018 * H),
        ):
            bm = bmesh.new()
            p_copy = list(pts)
            if side < 0:
                p_copy.reverse()
            vs_front = [bm.verts.new(p) for p in p_copy]
            f = bm.faces.new(vs_front)
            ret = bmesh.ops.extrude_face_region(bm, geom=[f])
            extruded_verts = [g for g in ret["geom"] if isinstance(g, bmesh.types.BMVert)]
            bmesh.ops.translate(bm, verts=extruded_verts, vec=Vector((0.0, depth, 0.0)))
            eye_center = head_base + Vector((0.0, -0.105 * H, 0.066 * H))
            bmesh.ops.transform(bm, matrix=Matrix.Translation(eye_center), verts=bm.verts)
            bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
            me = bpy.data.meshes.new(f"{prefix_n}_{side}")
            bm.to_mesh(me)
            bm.free()
            eo = bpy.data.objects.new(f"{prefix_n}_{side}", me)
            bpy.context.scene.collection.objects.link(eo)
            target_list.append(eo)

    def _join_pair(objs: list[bpy.types.Object], out_n: str) -> bpy.types.Object:
        bpy.ops.object.select_all(action="DESELECT")
        for eo in objs:
            eo.select_set(True)
        bpy.context.view_layer.objects.active = objs[0]
        bpy.ops.object.join()
        res = bpy.context.active_object
        res.name = out_n
        return res

    eyes = _join_pair(eye_objs, "Ignis_Eyes")
    eye_frames = _join_pair(frame_objs, "Ignis_EyeFrames")

    return flame_head, eyes, eye_frames


def build_ember_scarf(lm: dict[str, Vector]) -> tuple[bpy.types.Object, bpy.types.Object]:
    """Build Style B Ignis's thick wrapped crimson neck collar + sleek billowing anime scarf ribbon."""
    H = lm["height"].z
    neck = lm["neck"] + Vector((0.0, 0.005 * H, -0.015 * H))

    # 1) Chunky layered neck wrap collar (sculpted wavy cloth torus, NOT a bare primitive ring)
    n_u, n_v = 18, 8
    bm = bmesh.new()
    verts_grid = []
    for iu in range(n_u):
        u = (iu / n_u) * math.tau
        cu, su = math.cos(u), math.sin(u)
        # Slight dip at front throat (-Y), raised protective back collar (+Y), organic cloth bunching
        maj_rx = 0.084 * H * (1.0 + 0.06 * math.sin(u * 3.0))
        maj_ry = 0.086 * H * (1.0 + 0.05 * math.cos(u * 2.0))
        z_wave = -0.018 * H * (-su) + 0.012 * H * math.sin(u * 5.0)
        c = neck + Vector((cu * maj_rx, su * maj_ry, z_wave))
        radial = Vector((cu, su, 0.0)).normalized()
        up = Vector((0.0, 0.0, 1.0))
        row = []
        for iv in range(n_v):
            v = (iv / n_v) * math.tau
            rad_x = 0.028 * H * (1.0 + 0.14 * math.sin(v * 2.0))
            rad_z = 0.042 * H
            p = c + radial * (math.cos(v) * rad_x) + up * (math.sin(v) * rad_z)
            row.append(bm.verts.new(p))
        verts_grid.append(row)

    for iu in range(n_u):
        in_ = (iu + 1) % n_u
        for iv in range(n_v):
            ivn = (iv + 1) % n_v
            f = bm.faces.new((verts_grid[iu][iv], verts_grid[in_][iv], verts_grid[in_][ivn], verts_grid[iu][ivn]))
            f.smooth = True
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    me_c = bpy.data.meshes.new("Ignis_ScarfCollar")
    bm.to_mesh(me_c)
    bm.free()
    collar = bpy.data.objects.new("Ignis_ScarfCollar", me_c)
    bpy.context.scene.collection.objects.link(collar)

    # 2) Sleek billowing anime scarf ribbon (graceful fluttering S-curve tail matching Style B concept art!)
    s0 = lm["neck"] + Vector((0.02 * H, 0.075 * H, -0.012 * H))
    tail_rings: list[tuple[Vector, Vector, float, float, float]] = []
    n_seg = 9
    for i in range(n_seg):
        t = i / (n_seg - 1)
        pos = s0 + Vector((
            0.032 * H * math.sin(t * math.pi * 1.2) + 0.028 * H * t,
            0.36 * H * (t ** 0.92),
            0.048 * H * math.sin(t * math.pi * 1.4) - 0.145 * H * (t ** 1.3),
        ))
        tang = Vector((0.06, 0.85, 0.16 * math.cos(t * math.pi * 1.4) - 0.42 * (t ** 0.3)))
        width = (0.034 + 0.022 * math.sin(t * math.pi * 0.85)) * H * (1.0 - 0.56 * (t ** 2.2))
        thick = 0.008 * H * (1.0 - 0.35 * t)
        tail_rings.append((pos, tang, width, thick, 0.04))
    tail = loft_tube("Ignis_ScarfTail", tail_rings, n_sides=8, cap_start=True, cap_end=True)

    return collar, tail


def build_molten_gauntlet(
    side_sfx: str,
    elbow: Vector,
    wrist: Vector,
    hand_tip: Vector,
    H: float,
) -> tuple[bpy.types.Object, bpy.types.Object]:
    """Build Style B colossal faceted brass-and-lava punching gauntlet (armored cuff + glowing lava cores)."""
    sign = 1.0 if side_sfx == "L" else -1.0
    # Compute local orthonormal basis along forearm axis (elbow -> wrist)
    axis = (wrist - elbow).normalized()
    fwd = Vector((0.0, -1.0, 0.0))
    outer = (axis.cross(fwd)).normalized()
    if outer.x * sign < 0:
        outer = -outer
    palm_fwd = outer.cross(axis).normalized()
    if palm_fwd.y > 0:
        palm_fwd = -palm_fwd

    # Rotation matrix mapping local (+Z = along forearm->fist, +X = outer/knuckle back, +Y = palm forward) to world
    R = Matrix((
        (outer.x, palm_fwd.x, axis.x, 0.0),
        (outer.y, palm_fwd.y, axis.y, 0.0),
        (outer.z, palm_fwd.z, axis.z, 0.0),
        (0.0, 0.0, 0.0, 1.0),
    ))
    rot_e = R.to_euler("XYZ")

    armor_parts: list[bpy.types.Object] = []
    lava_parts: list[bpy.types.Object] = []

    forearm_len = (wrist - elbow).length
    cuff_mid = elbow + axis * (forearm_len * 0.62)

    # 1) Sleek beveled octagonal forearm vambrace cuff flaring cleanly into the armored fist
    cuff_rings: list[tuple[Vector, Vector, float, float, float]] = [
        (elbow + axis * (forearm_len * 0.28), axis, 0.038 * H, 0.036 * H, 0.08),
        (elbow + axis * (forearm_len * 0.55), axis, 0.048 * H, 0.045 * H, 0.10),
        (elbow + axis * (forearm_len * 0.88), axis, 0.062 * H, 0.056 * H, 0.12),
        (wrist + axis * (0.012 * H), axis, 0.066 * H, 0.062 * H, 0.10),
    ]
    armor_parts.append(loft_tube(f"GauntletCuff_{side_sfx}", cuff_rings, n_sides=8, sharp_creases=True))

    # 2) Raised outer brass guard ridge & wrist collar trim
    armor_parts.append(make_beveled_block(
        f"GauntletPlate_{side_sfx}",
        (0.028 * H, 0.068 * H, 0.118 * H),
        cuff_mid + outer * (0.046 * H),
        rot_e,
        bevel_width=0.007 * H,
        taper_z=(0.82, 1.12),
    ))
    armor_parts.append(make_beveled_block(
        f"GauntletRim_{side_sfx}",
        (0.108 * H, 0.102 * H, 0.026 * H),
        elbow + axis * (forearm_len * 0.30),
        rot_e,
        bevel_width=0.006 * H,
    ))

    # 3) Heroic clenched fist core + raised beveled knuckle bridge + 4 sculpted finger blocks + thumb!
    fist_center = wrist + axis * (0.064 * H)
    armor_parts.append(make_beveled_block(
        f"GauntletPalm_{side_sfx}",
        (0.098 * H, 0.108 * H, 0.098 * H),
        fist_center,
        rot_e,
        bevel_width=0.012 * H,
        taper_z=(0.92, 1.05),
    ))
    # Prominent faceted knuckle ridge across back of fist
    knuckle_pos = fist_center + outer * (0.046 * H) + axis * (0.012 * H)
    armor_parts.append(make_beveled_block(
        f"GauntletKnuckleBar_{side_sfx}",
        (0.036 * H, 0.118 * H, 0.054 * H),
        knuckle_pos,
        rot_e,
        bevel_width=0.009 * H,
    ))
    # 4 distinct chunky curled finger armor blocks
    for fi in range(4):
        fy = (-0.037 + fi * 0.025) * H
        fpos = fist_center + axis * (0.049 * H) + palm_fwd * fy + outer * (0.008 * H)
        armor_parts.append(make_beveled_block(
            f"GauntletFinger_{side_sfx}_{fi}",
            (0.072 * H, 0.023 * H, 0.042 * H),
            fpos,
            rot_e,
            bevel_width=0.005 * H,
        ))
    # Heavy sculpted armored thumb curled across front of fist
    thumb_pos = fist_center + palm_fwd * (-0.050 * H) + outer * (-0.018 * H) + axis * (0.014 * H)
    armor_parts.append(make_beveled_block(
        f"GauntletThumb_{side_sfx}",
        (0.050 * H, 0.042 * H, 0.062 * H),
        thumb_pos,
        rot_e,
        bevel_width=0.008 * H,
    ))

    # 4) Recessed glowing molten lava vents (emissive magma slots along forearm & knuckles!)
    for vi in range(3):
        vz = (-0.032 + vi * 0.030) * H
        vpos = cuff_mid + outer * (0.060 * H) + axis * vz
        lava_parts.append(make_beveled_block(
            f"LavaVent_{side_sfx}_{vi}",
            (0.014 * H, 0.036 * H, 0.014 * H),
            vpos,
            rot_e,
            bevel_width=0.003 * H,
        ))
    # Glowing magma core plate on back of giant fist
    lava_parts.append(make_beveled_block(
        f"LavaFistCore_{side_sfx}",
        (0.018 * H, 0.076 * H, 0.034 * H),
        knuckle_pos + outer * (0.016 * H),
        rot_e,
        bevel_width=0.003 * H,
    ))

    def join_list(objs: list[bpy.types.Object], out_name: str) -> bpy.types.Object:
        bpy.ops.object.select_all(action="DESELECT")
        for o in objs:
            o.select_set(True)
        bpy.context.view_layer.objects.active = objs[0]
        bpy.ops.object.join()
        res = bpy.context.active_object
        res.name = out_name
        return res

    return join_list(armor_parts, f"Ignis_Gauntlet_{side_sfx}"), join_list(lava_parts, f"Ignis_GauntletLava_{side_sfx}")


def build_combat_sandals(lm: dict[str, Vector]) -> bpy.types.Object:
    """Build chunky stylized martial-arts sandals with beveled soles and crossed straps."""
    H = lm["height"].z
    parts = []
    for side, sfx in (("l", "L"), ("r", "R")):
        ankle = lm[f"ankle_{side}"]
        toe = lm[f"toe_{side}"]
        mid_y = 0.5 * (ankle.y + toe.y) - 0.008 * H
        sole_c = Vector((ankle.x, mid_y, 0.016 * H))
        parts.append(make_beveled_block(
            f"Sole_{sfx}",
            (0.088 * H, 0.168 * H, 0.030 * H),
            sole_c,
            bevel_width=0.006 * H,
            taper_y=(0.86, 1.06),
        ))
        # Crossed sandal bridge strap
        parts.append(make_beveled_block(
            f"Strap_{sfx}",
            (0.092 * H, 0.042 * H, 0.044 * H),
            Vector((ankle.x, mid_y - 0.012 * H, 0.044 * H)),
            (0.28, 0.0, 0.0),
            bevel_width=0.005 * H,
        ))
    bpy.ops.object.select_all(action="DESELECT")
    for p in parts:
        p.select_set(True)
    bpy.context.view_layer.objects.active = parts[0]
    bpy.ops.object.join()
    res = bpy.context.active_object
    res.name = "Ignis_Sandals"
    return res


def assign_material_tag(obj: bpy.types.Object, mat_name: str, base_rgba: tuple[float, float, float, float], emissive: float = 0.0, metallic: float = 0.0) -> bpy.types.Material:
    """Create or reuse a named Blender Principled material storing stylized cel color & emission metadata."""
    mat = bpy.data.materials.get(mat_name)
    if mat is None:
        mat = bpy.data.materials.new(mat_name)
        mat.use_nodes = True
        nt = mat.node_tree
        bsdf = nt.nodes.get("Principled BSDF")
        bsdf.inputs["Base Color"].default_value = base_rgba
        bsdf.inputs["Metallic"].default_value = metallic
        bsdf.inputs["Roughness"].default_value = 0.65 if metallic < 0.5 else 0.32
        if emissive > 0.0 and "Emission Color" in bsdf.inputs:
            bsdf.inputs["Emission Color"].default_value = base_rgba
            bsdf.inputs["Emission Strength"].default_value = emissive
        mat["bb_emissive"] = emissive
        mat["bb_metallic"] = metallic
        mat["bb_color"] = list(base_rgba[:3])
    obj.data.materials.clear()
    obj.data.materials.append(mat)
    return mat


def bake_stylized_cel_textures(
    merged_obj: bpy.types.Object,
    out_dir: str,
    prefix: str,
    tex_size: int = 1024,
) -> tuple[str, str]:
    """Unwrap merged fighter cleanly, bake Cycles AO + Curvature, and composite stylized Albedo + Emissive PNGs."""
    os.makedirs(out_dir, exist_ok=True)
    bpy.ops.object.select_all(action="DESELECT")
    merged_obj.select_set(True)
    bpy.context.view_layer.objects.active = merged_obj

    # Clean non-overlapping Smart UV Pack with high texel density (avoids fragmented dot-islands!)
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.smart_project(angle_limit=math.radians(78.0), island_margin=0.0025, area_weight=0.0, scale_to_bounds=True)
    bpy.ops.object.mode_set(mode="OBJECT")

    # Configure Cycles CPU bake (MUST disable denoising on Ubuntu Blender builds without OpenImageDenoiser!)
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.cycles.device = "CPU"
    scene.cycles.samples = 16
    scene.cycles.use_denoising = False
    scene.cycles.use_adaptive_sampling = False
    scene.render.bake.margin = 6
    scene.render.bake.use_clear = True

    def bake_pass(img_name: str, bake_type: str, mat_builder) -> np.ndarray:
        img = bpy.data.images.new(img_name, tex_size, tex_size, alpha=False)
        img.colorspace_settings.name = "Non-Color"
        orig_mats = list(merged_obj.data.materials)
        temp_mats = []
        for idx, om in enumerate(orig_mats):
            tm = bpy.data.materials.new(f"BAKE_{img_name}_{idx}")
            tm.use_nodes = True
            nt = tm.node_tree
            nt.nodes.clear()
            out_n = nt.nodes.new("ShaderNodeOutputMaterial")
            mat_builder(nt, out_n, om)
            tex_n = nt.nodes.new("ShaderNodeTexImage")
            tex_n.image = img
            nt.nodes.active = tex_n
            temp_mats.append(tm)
            merged_obj.data.materials[idx] = tm

        bpy.ops.object.select_all(action="DESELECT")
        merged_obj.select_set(True)
        bpy.context.view_layer.objects.active = merged_obj
        bpy.ops.object.bake(type=bake_type)

        arr = np.array(img.pixels[:], dtype=np.float32).reshape((tex_size, tex_size, 4))
        arr = np.flipud(arr)  # Blender image origin is bottom-left; PIL is top-left

        for idx, om in enumerate(orig_mats):
            merged_obj.data.materials[idx] = om
        for tm in temp_mats:
            bpy.data.materials.remove(tm)
        bpy.data.images.remove(img)
        return arr

    # 1) Base stylized albedo (with elemental procedural vertical gradients for Flame, Wave, Wind, Basalt!)
    def build_albedo_shader(nt, out_n, om):
        em = nt.nodes.new("ShaderNodeEmission")
        col = list(om.get("bb_color", [0.8, 0.8, 0.8]))
        if "Flame" in om.name:
            # Vibrant vertical flame gradient: yellow-white face core -> blazing orange -> crimson tips!
            geom = nt.nodes.new("ShaderNodeNewGeometry")
            sep = nt.nodes.new("ShaderNodeSeparateXYZ")
            mr = nt.nodes.new("ShaderNodeMapRange")
            mr.inputs["From Min"].default_value = 1.38
            mr.inputs["From Max"].default_value = 1.92
            ramp = nt.nodes.new("ShaderNodeValToRGB")
            ramp.color_ramp.elements[0].position = 0.08
            ramp.color_ramp.elements[0].color = (1.0, 0.90, 0.22, 1.0)
            e1 = ramp.color_ramp.elements.new(0.45)
            e1.color = (1.0, 0.44, 0.05, 1.0)
            ramp.color_ramp.elements[1].position = 0.92
            ramp.color_ramp.elements[1].color = (0.88, 0.11, 0.03, 1.0)
            nt.links.new(geom.outputs["Position"], sep.inputs["Vector"])
            nt.links.new(sep.outputs["Z"], mr.inputs["Value"])
            nt.links.new(mr.outputs["Result"], ramp.inputs["Fac"])
            nt.links.new(ramp.outputs["Color"], em.inputs["Color"])
        elif "Wave" in om.name:
            # Luminous ocean wave gradient: deep azure base -> vibrant turquoise -> glowing seafoam crest!
            geom = nt.nodes.new("ShaderNodeNewGeometry")
            sep = nt.nodes.new("ShaderNodeSeparateXYZ")
            mr = nt.nodes.new("ShaderNodeMapRange")
            mr.clamp = True
            mr.inputs["From Min"].default_value = 0.42 if "Sleeve" in om.name or "Sash" in om.name else 1.24
            mr.inputs["From Max"].default_value = 1.15 if "Sleeve" in om.name or "Sash" in om.name else 1.72
            ramp = nt.nodes.new("ShaderNodeValToRGB")
            ramp.color_ramp.elements[0].position = 0.04
            ramp.color_ramp.elements[0].color = (0.08, 0.54, 0.78, 1.0)
            ramp.color_ramp.elements[1].position = 0.96
            ramp.color_ramp.elements[1].color = (0.48, 0.96, 0.92, 1.0)
            e1 = ramp.color_ramp.elements.new(0.50)
            e1.color = (0.18, 0.82, 0.90, 1.0)
            nt.links.new(geom.outputs["Position"], sep.inputs["Vector"])
            nt.links.new(sep.outputs["Z"], mr.inputs["Value"])
            nt.links.new(mr.outputs["Result"], ramp.inputs["Fac"])
            nt.links.new(ramp.outputs["Color"], em.inputs["Color"])
        elif "Leggings" in om.name:
            # Tide's signature gradient hydro-leggings: bright aqua-mint ankles rising smoothly to deep ocean blue hips!
            geom = nt.nodes.new("ShaderNodeNewGeometry")
            sep = nt.nodes.new("ShaderNodeSeparateXYZ")
            mr = nt.nodes.new("ShaderNodeMapRange")
            mr.clamp = True
            mr.inputs["From Min"].default_value = 0.14
            mr.inputs["From Max"].default_value = 0.82
            ramp = nt.nodes.new("ShaderNodeValToRGB")
            ramp.color_ramp.elements[0].position = 0.04
            ramp.color_ramp.elements[0].color = (0.34, 0.90, 0.80, 1.0)
            ramp.color_ramp.elements[1].position = 0.96
            ramp.color_ramp.elements[1].color = (0.10, 0.36, 0.54, 1.0)
            e1 = ramp.color_ramp.elements.new(0.42)
            e1.color = (0.14, 0.58, 0.72, 1.0)
            nt.links.new(geom.outputs["Position"], sep.inputs["Vector"])
            nt.links.new(sep.outputs["Z"], mr.inputs["Value"])
            nt.links.new(mr.outputs["Result"], ramp.inputs["Fac"])
            nt.links.new(ramp.outputs["Color"], em.inputs["Color"])
        elif "IvoryPoncho" in om.name:
            # Razor-crisp Style B Air-Monk geometric mint-jade V-chevron + shoulder wing motif baked at 1024px!
            # (Zero jagged mesh stair-stepping — straight vector-clean triangular bands matching concept art!)
            geom = nt.nodes.new("ShaderNodeNewGeometry")
            sep = nt.nodes.new("ShaderNodeSeparateXYZ")
            nt.links.new(geom.outputs["Position"], sep.inputs["Vector"])

            # |X|
            abs_x = nt.nodes.new("ShaderNodeMath")
            abs_x.operation = "ABSOLUTE"
            nt.links.new(sep.outputs["X"], abs_x.inputs[0])

            # V-band centerline: z_v = 0.86 + 0.82 * |X| (sharp V pointing down toward front/back diamond tips!)
            mul_x = nt.nodes.new("ShaderNodeMath")
            mul_x.operation = "MULTIPLY"
            mul_x.inputs[1].default_value = 0.82
            nt.links.new(abs_x.outputs["Value"], mul_x.inputs[0])

            add_v = nt.nodes.new("ShaderNodeMath")
            add_v.operation = "ADD"
            add_v.inputs[1].default_value = 0.86
            nt.links.new(mul_x.outputs["Value"], add_v.inputs[0])

            # dist_v = |Z - z_v|
            sub_v = nt.nodes.new("ShaderNodeMath")
            sub_v.operation = "SUBTRACT"
            nt.links.new(sep.outputs["Z"], sub_v.inputs[0])
            nt.links.new(add_v.outputs["Value"], sub_v.inputs[1])

            abs_v = nt.nodes.new("ShaderNodeMath")
            abs_v.operation = "ABSOLUTE"
            nt.links.new(sub_v.outputs["Value"], abs_v.inputs[0])

            # band_mask = 1.0 where dist_v < 0.048 (crisp V-chevron stripe)
            in_v = nt.nodes.new("ShaderNodeMath")
            in_v.operation = "LESS_THAN"
            in_v.inputs[1].default_value = 0.048
            nt.links.new(abs_v.outputs["Value"], in_v.inputs[0])

            # wing_mask = 1.0 on outer shoulder triangles (|X| > 0.215 and Z < 1.16)
            gt_x = nt.nodes.new("ShaderNodeMath")
            gt_x.operation = "GREATER_THAN"
            gt_x.inputs[1].default_value = 0.215
            nt.links.new(abs_x.outputs["Value"], gt_x.inputs[0])

            lt_z = nt.nodes.new("ShaderNodeMath")
            lt_z.operation = "LESS_THAN"
            lt_z.inputs[1].default_value = 1.16
            nt.links.new(sep.outputs["Z"], lt_z.inputs[0])

            wing_m = nt.nodes.new("ShaderNodeMath")
            wing_m.operation = "MULTIPLY"
            nt.links.new(gt_x.outputs["Value"], wing_m.inputs[0])
            nt.links.new(lt_z.outputs["Value"], wing_m.inputs[1])

            # Combine chevron + shoulder wing tips into 0..1 mask -> crisp ColorRamp (warm sky-ivory vs jade-mint!)
            comb_m = nt.nodes.new("ShaderNodeMath")
            comb_m.operation = "MAXIMUM"
            nt.links.new(in_v.outputs["Value"], comb_m.inputs[0])
            nt.links.new(wing_m.outputs["Value"], comb_m.inputs[1])

            pramp = nt.nodes.new("ShaderNodeValToRGB")
            pramp.color_ramp.interpolation = "LINEAR"
            pramp.color_ramp.elements[0].position = 0.05
            pramp.color_ramp.elements[0].color = (0.94, 0.96, 0.91, 1.0)  # Clean warm sky-ivory
            pramp.color_ramp.elements[1].position = 0.95
            pramp.color_ramp.elements[1].color = (0.48, 0.90, 0.76, 1.0)  # Crisp jade-mint geometric accent
            nt.links.new(comb_m.outputs["Value"], pramp.inputs["Fac"])
            nt.links.new(pramp.outputs["Color"], em.inputs["Color"])
        elif "BasaltStone" in om.name:
            # Carved volcanic basalt vertical tonal richness: darker charcoal greaves -> warm slate chest/pauldrons!
            geom = nt.nodes.new("ShaderNodeNewGeometry")
            sep = nt.nodes.new("ShaderNodeSeparateXYZ")
            mr = nt.nodes.new("ShaderNodeMapRange")
            mr.clamp = True
            mr.inputs["From Min"].default_value = 0.0
            mr.inputs["From Max"].default_value = 1.85
            ramp = nt.nodes.new("ShaderNodeValToRGB")
            ramp.color_ramp.elements[0].position = 0.05
            ramp.color_ramp.elements[0].color = (0.21, 0.21, 0.24, 1.0)
            ramp.color_ramp.elements[1].position = 0.95
            ramp.color_ramp.elements[1].color = (0.35, 0.34, 0.37, 1.0)
            nt.links.new(geom.outputs["Position"], sep.inputs["Vector"])
            nt.links.new(sep.outputs["Z"], mr.inputs["Value"])
            nt.links.new(mr.outputs["Result"], ramp.inputs["Fac"])
            nt.links.new(ramp.outputs["Color"], em.inputs["Color"])
        else:
            em.inputs["Color"].default_value = (col[0], col[1], col[2], 1.0)
        nt.links.new(em.outputs["Emission"], out_n.inputs["Surface"])

    # 2) Emissive mask pass
    def build_emissive_shader(nt, out_n, om):
        em = nt.nodes.new("ShaderNodeEmission")
        strength = float(om.get("bb_emissive", 0.0))
        if strength <= 0.01:
            em.inputs["Color"].default_value = (0.0, 0.0, 0.0, 1.0)
        elif "Flame" in om.name:
            geom = nt.nodes.new("ShaderNodeNewGeometry")
            sep = nt.nodes.new("ShaderNodeSeparateXYZ")
            mr = nt.nodes.new("ShaderNodeMapRange")
            mr.inputs["From Min"].default_value = 1.38
            mr.inputs["From Max"].default_value = 1.92
            ramp = nt.nodes.new("ShaderNodeValToRGB")
            ramp.color_ramp.elements[0].position = 0.08
            ramp.color_ramp.elements[0].color = (1.0, 0.92, 0.28, 1.0)
            e1 = ramp.color_ramp.elements.new(0.46)
            e1.color = (1.0, 0.46, 0.06, 1.0)
            ramp.color_ramp.elements[1].position = 0.92
            ramp.color_ramp.elements[1].color = (0.90, 0.14, 0.03, 1.0)
            nt.links.new(geom.outputs["Position"], sep.inputs["Vector"])
            nt.links.new(sep.outputs["Z"], mr.inputs["Value"])
            nt.links.new(mr.outputs["Result"], ramp.inputs["Fac"])
            nt.links.new(ramp.outputs["Color"], em.inputs["Color"])
        else:
            col = list(om.get("bb_color", [1.0, 1.0, 1.0]))
            scale = min(1.0, strength)
            em.inputs["Color"].default_value = (col[0] * scale, col[1] * scale, col[2] * scale, 1.0)
        nt.links.new(em.outputs["Emission"], out_n.inputs["Surface"])

    # 3) Cycles Ambient Occlusion + Pointiness Curvature (for crisp Guilty-Gear inner ink lines & edge highlights!)
    def build_ao_curv_shader(nt, out_n, om):
        em = nt.nodes.new("ShaderNodeEmission")
        ao_n = nt.nodes.new("ShaderNodeAmbientOcclusion")
        ao_n.samples = 16
        ao_n.inputs["Distance"].default_value = 0.28
        geom = nt.nodes.new("ShaderNodeNewGeometry")
        comb = nt.nodes.new("ShaderNodeCombineColor")
        nt.links.new(ao_n.outputs["AO"], comb.inputs["Red"])
        nt.links.new(geom.outputs["Pointiness"], comb.inputs["Green"])
        comb.inputs["Blue"].default_value = 1.0 if float(om.get("bb_emissive", 0.0)) > 0.1 else 0.0
        nt.links.new(comb.outputs["Color"], em.inputs["Color"])
        nt.links.new(em.outputs["Emission"], out_n.inputs["Surface"])

    albedo_raw = bake_pass("BakeAlbedo", "EMIT", build_albedo_shader)
    emissive_raw = bake_pass("BakeEmissive", "EMIT", build_emissive_shader)
    aoc_raw = bake_pass("BakeAOCurv", "EMIT", build_ao_curv_shader)

    assert float(albedo_raw[:, :, :3].max()) > 0.1, "Cycles bake produced empty black albedo!"
    print(f"[mesh_craft] Baked cel atlas: albedo_mean={albedo_raw[:,:,:3].mean():.3f}, ao_mean={aoc_raw[:,:,0].mean():.3f}, em_max={emissive_raw[:,:,:3].max():.3f}")

    # Composite crisp stylized hand-painted cel look:
    # - Warm-dark indigo/umber shadow tint in crevices (AO)
    # - Crisp comic inner-ink crevice lines where curvature dips (pointiness < 0.48)
    # - Clean specular bevel edge-pop highlights where curvature peaks (pointiness > 0.52)
    ao = np.clip(aoc_raw[:, :, 0], 0.0, 1.0)
    curv = np.clip(aoc_raw[:, :, 1], 0.0, 1.0)
    is_em = aoc_raw[:, :, 2] > 0.5

    rgb = np.clip(albedo_raw[:, :, :3], 0.0, 1.0)
    # Apply rich cel-friendly AO shadow tint (skipping pure glowing emissive parts)
    non_em = (~is_em).astype(np.float32)[:, :, None]
    ao_factor = np.clip((ao - 0.15) / 0.85, 0.0, 1.0)[:, :, None]
    shadow_tint = np.array([0.22, 0.14, 0.26], dtype=np.float32)[None, None, :]
    shaded = rgb * (0.64 + 0.36 * ao_factor) + rgb * shadow_tint * 0.14 * (1.0 - ao_factor)

    # Crisp inner comic ink line in tight concave creases (Guilty Gear ILM trick!)
    crease_ink = np.clip((0.476 - curv) / 0.032, 0.0, 1.0)[:, :, None] * non_em
    ink_col = np.array([0.07, 0.05, 0.08], dtype=np.float32)[None, None, :]
    shaded = shaded * (1.0 - 0.68 * crease_ink) + ink_col * (0.68 * crease_ink)

    # Subtle crisp edge highlight on convex beveled ridges (brass gauntlets, gi folds, straps)
    edge_hi = np.clip((curv - 0.522) / 0.048, 0.0, 1.0)[:, :, None] * non_em
    shaded = np.clip(shaded + edge_hi * 0.16, 0.0, 1.0)

    final_rgb = np.where(is_em[:, :, None], rgb, shaded)

    albedo_path = os.path.join(out_dir, f"{prefix}_albedo.png")
    emissive_path = os.path.join(out_dir, f"{prefix}_emissive.png")

    Image.fromarray((np.clip(final_rgb, 0.0, 1.0) * 255).astype(np.uint8), mode="RGB").save(albedo_path, optimize=True)
    em_img = Image.fromarray((np.clip(emissive_raw[:, :, :3], 0.0, 1.0) * 255).astype(np.uint8), mode="RGB")
    em_img.save(emissive_path, optimize=True)

    return albedo_path, emissive_path


def apply_baked_material(merged_obj: bpy.types.Object, name: str, albedo_path: str, emissive_path: str) -> bpy.types.Material:
    """Replace multi-slot preview materials with a single unified glTF-ready PBR/Toon texture material (1 draw call!)."""
    mat = bpy.data.materials.new(f"MAT_{name}")
    mat.use_nodes = True
    nt = mat.node_tree
    nt.nodes.clear()
    out_n = nt.nodes.new("ShaderNodeOutputMaterial")
    bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
    bsdf.inputs["Roughness"].default_value = 0.78
    bsdf.inputs["Metallic"].default_value = 0.05

    alb_img = bpy.data.images.load(albedo_path, check_existing=True)
    alb_img.pack()
    alb_tex = nt.nodes.new("ShaderNodeTexImage")
    alb_tex.image = alb_img

    em_img = bpy.data.images.load(emissive_path, check_existing=True)
    em_img.pack()
    em_tex = nt.nodes.new("ShaderNodeTexImage")
    em_tex.image = em_img

    nt.links.new(alb_tex.outputs["Color"], bsdf.inputs["Base Color"])
    if "Emission Color" in bsdf.inputs:
        nt.links.new(em_tex.outputs["Color"], bsdf.inputs["Emission Color"])
        bsdf.inputs["Emission Strength"].default_value = 1.15
    nt.links.new(bsdf.outputs["BSDF"], out_n.inputs["Surface"])

    merged_obj.data.materials.clear()
    merged_obj.data.materials.append(mat)
    return mat
