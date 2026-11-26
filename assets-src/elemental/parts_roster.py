"""Handcrafted sculpted Style B hero armor, garments, masks, hair crests, and weapons for Basalt, Tide & Zephyr.

Zero bare primitive body parts — every fighter starts from Blender Studio's official CC0 stylized anatomy
and layers custom lofted, beveled, and anatomically extracted stylized low-poly hero gear matching
the approved Style B Elemental Warriors visual direction.
"""
from __future__ import annotations

import math
import bpy
import bmesh
from mathutils import Euler, Matrix, Vector

from mesh_craft import loft_tube, make_beveled_block


def _join_objs(objs: list[bpy.types.Object], name: str) -> bpy.types.Object:
    bpy.ops.object.select_all(action="DESELECT")
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.join()
    res = bpy.context.active_object
    res.name = name
    return res


def _limb_basis(p_start: Vector, p_end: Vector, sign: float) -> tuple[Vector, Vector, Vector, Euler]:
    """Build consistent local orthonormal frame along limb (axis=start->end, outer=lateral, fwd=-Y)."""
    axis = (p_end - p_start).normalized()
    fwd_ref = Vector((0.0, -1.0, 0.0))
    outer = axis.cross(fwd_ref)
    if outer.length < 1e-4:
        outer = Vector((sign, 0.0, 0.0))
    outer.normalize()
    if outer.x * sign < 0:
        outer = -outer
    palm_fwd = outer.cross(axis).normalized()
    if palm_fwd.y > 0:
        palm_fwd = -palm_fwd
    R = Matrix((
        (outer.x, palm_fwd.x, axis.x, 0.0),
        (outer.y, palm_fwd.y, axis.y, 0.0),
        (outer.z, palm_fwd.z, axis.z, 0.0),
        (0.0, 0.0, 0.0, 1.0),
    ))
    return axis, outer, palm_fwd, R.to_euler("XYZ")


# ============================================================================
# 1. ROCK ELEMENTAL — BASALT (Obsidian & Magma Juggernaut)
# ============================================================================

def build_basalt_horned_helm(lm: dict[str, Vector]) -> tuple[bpy.types.Object, bpy.types.Object, bpy.types.Object]:
    """Build Basalt's faceted horned obsidian knight helm + recessed dark visor + glowing orange eyes."""
    H = lm["height"].z
    hc = lm["head"] + Vector((0.0, -0.004 * H, 0.032 * H))
    helm_parts: list[bpy.types.Object] = []

    # Sculpted angular cranium dome tapering to a bold crested brow
    dome_rings = [
        (hc + Vector((0.0, 0.008 * H, -0.048 * H)), Vector((0, 0, 1)), 0.056 * H, 0.062 * H, 0.06),
        (hc + Vector((0.0, 0.002 * H, -0.004 * H)), Vector((0, 0, 1)), 0.072 * H, 0.080 * H, 0.12),
        (hc + Vector((0.0, 0.000 * H, 0.044 * H)), Vector((0, 0, 1)), 0.076 * H, 0.084 * H, 0.14),
        (hc + Vector((0.0, 0.008 * H, 0.088 * H)), Vector((0, 0.08, 1)), 0.062 * H, 0.070 * H, 0.16),
        (hc + Vector((0.0, 0.016 * H, 0.118 * H)), Vector((0, 0.15, 1)), 0.034 * H, 0.042 * H, 0.18),
    ]
    helm_parts.append(loft_tube("Basalt_HelmDome", dome_rings, n_sides=8, sharp_creases=True))

    # Central forehead crown ridge & vertical nasal faceplate guard (iconic obsidian knight silhouette!)
    helm_parts.append(make_beveled_block(
        "Basalt_CrownRidge",
        (0.032 * H, 0.145 * H, 0.055 * H),
        hc + Vector((0.0, 0.006 * H, 0.095 * H)),
        bevel_width=0.007 * H,
        bevel_segs=1,
        taper_z=(1.15, 0.55),
    ))
    helm_parts.append(make_beveled_block(
        "Basalt_BrowGuard",
        (0.132 * H, 0.046 * H, 0.032 * H),
        hc + Vector((0.0, -0.072 * H, 0.042 * H)),
        rot_euler=(0.14, 0.0, 0.0),
        bevel_width=0.006 * H,
        bevel_segs=1,
    ))
    helm_parts.append(make_beveled_block(
        "Basalt_NoseGuard",
        (0.024 * H, 0.034 * H, 0.086 * H),
        hc + Vector((0.0, -0.082 * H, -0.008 * H)),
        bevel_width=0.004 * H,
        bevel_segs=1,
        taper_z=(0.70, 1.15),
    ))
    # Angular armored cheek/jaw plates framing a dark knightly faceplate slit
    for side in (-1.0, 1.0):
        helm_parts.append(make_beveled_block(
            f"Basalt_Cheek_{side}",
            (0.046 * H, 0.068 * H, 0.082 * H),
            hc + Vector((0.044 * H * side, -0.056 * H, -0.012 * H)),
            rot_euler=(0.06, 0.0, -0.28 * side),
            bevel_width=0.007 * H,
            bevel_segs=1,
            taper_z=(0.78, 1.08),
        ))

    # Iconic sweeping curved twin basalt bull/oni horns (curving wide outward then sharply skyward!)
    for side in (-1.0, 1.0):
        h_rings = []
        for si in range(7):
            t = si / 6.0
            px = (0.062 + 0.095 * math.sin(t * math.pi * 0.62) + 0.015 * t) * H * side
            py = (0.008 - 0.036 * math.sin(t * math.pi * 0.85)) * H
            pz = (0.052 + 0.022 * t + 0.112 * (t ** 2.1)) * H
            tang = Vector((side * max(0.05, math.cos(t * math.pi * 0.62)), -0.22 * math.cos(t * math.pi * 0.85), 0.25 + 2.2 * t))
            rad = (0.028 * (1.0 - 0.80 * (t ** 1.15)) + 0.004) * H
            h_rings.append((hc + Vector((px, py, pz)), tang, rad, rad * 0.92, 0.14))
        helm_parts.append(loft_tube(f"Basalt_Horn_{side}", h_rings, n_sides=6, sharp_creases=True))

    helm = _join_objs(helm_parts, "Basalt_Helm")

    # Recessed obsidian visor shadow plate & twin glowing molten-orange eyes
    visor = make_beveled_block(
        "Basalt_Visor",
        (0.104 * H, 0.022 * H, 0.034 * H),
        hc + Vector((0.0, -0.072 * H, 0.020 * H)),
        bevel_width=0.003 * H,
        bevel_segs=1,
    )
    eye_objs = []
    for side in (-1.0, 1.0):
        eye_objs.append(make_beveled_block(
            f"Basalt_Eye_{side}",
            (0.024 * H, 0.014 * H, 0.014 * H),
            hc + Vector((0.028 * H * side, -0.084 * H, 0.021 * H)),
            rot_euler=(0.0, 0.22 * side, -0.18 * side),
            bevel_width=0.002 * H,
            bevel_segs=1,
        ))
    eyes = _join_objs(eye_objs, "Basalt_Eyes")
    return helm, visor, eyes


def build_basalt_torso_armor(lm: dict[str, Vector]) -> tuple[bpy.types.Object, bpy.types.Object]:
    """Build Basalt's faceted segmented basalt chest/ab plates & colossal angular shoulder pauldrons."""
    H = lm["height"].z
    torso_parts: list[bpy.types.Object] = []

    # 1) Split faceted chest pec boulders (deliberate 1.4cm glowing magma fissure down sternum & ribs!)
    for side in (-1.0, 1.0):
        torso_parts.append(make_beveled_block(
            f"Basalt_Pec_{side}",
            (0.118 * H, 0.125 * H, 0.098 * H),
            Vector((0.068 * H * side, -0.056 * H, 0.715 * H)),
            rot_euler=(-0.10, 0.06 * side, -0.20 * side),
            bevel_width=0.012 * H,
            bevel_segs=1,
            taper_z=(0.86, 1.08),
        ))
        # Heavy faceted upper back shoulder-blade stone slabs
        torso_parts.append(make_beveled_block(
            f"Basalt_BackPlate_{side}",
            (0.116 * H, 0.092 * H, 0.135 * H),
            Vector((0.064 * H * side, 0.068 * H, 0.710 * H)),
            rot_euler=(0.10, -0.05 * side, 0.16 * side),
            bevel_width=0.012 * H,
            bevel_segs=1,
            taper_z=(0.82, 1.08),
        ))
        # Lower lumbar back armor plates (leaves crisp narrow vertical magma spine fissure instead of wide orange back!)
        torso_parts.append(make_beveled_block(
            f"Basalt_LumbarBack_{side}",
            (0.098 * H, 0.068 * H, 0.118 * H),
            Vector((0.056 * H * side, 0.064 * H, 0.592 * H)),
            rot_euler=(0.06, -0.04 * side, 0.14 * side),
            bevel_width=0.010 * H,
            bevel_segs=1,
            taper_z=(0.86, 1.04),
        ))
        # Segmented 2-tier obsidian ab-armor blocks (leaving bright horizontal/vertical magma veins!)
        for row_i, (rz, rw, rh, ry) in enumerate(((0.630, 0.088, 0.050, -0.068), (0.570, 0.080, 0.048, -0.064))):
            torso_parts.append(make_beveled_block(
                f"Basalt_Ab_{side}_{row_i}",
                (rw * H, 0.064 * H, rh * H),
                Vector((0.049 * H * side, ry * H, rz * H)),
                rot_euler=(0.04, 0.0, -0.16 * side),
                bevel_width=0.009 * H,
                bevel_segs=1,
            ))
    # Armored trapezoidal belt buckle / codpiece slab & collar gorget
    torso_parts.append(make_beveled_block(
        "Basalt_BeltPelvis",
        (0.175 * H, 0.165 * H, 0.082 * H),
        Vector((0.0, -0.008 * H, 0.505 * H)),
        bevel_width=0.012 * H,
        bevel_segs=1,
        taper_z=(0.72, 1.06),
    ))
    torso_parts.append(make_beveled_block(
        "Basalt_CollarGorget",
        (0.168 * H, 0.145 * H, 0.042 * H),
        Vector((0.0, 0.010 * H, 0.785 * H)),
        bevel_width=0.009 * H,
        bevel_segs=1,
    ))
    chest_armor = _join_objs(torso_parts, "Basalt_TorsoArmor")

    # 2) Colossal faceted stacked stone pauldrons (bound cleanly to Shoulder.L / Shoulder.R!)
    pauldron_parts: list[bpy.types.Object] = []
    bicep_parts: list[bpy.types.Object] = []
    for side, sfx in ((1.0, "L"), (-1.0, "R")):
        sh = lm[f"upper_arm_{sfx.lower()}"]
        el = lm[f"elbow_{sfx.lower()}"]
        pauldron_parts.append(make_beveled_block(
            f"Basalt_PauldronMain_{sfx}",
            (0.142 * H, 0.162 * H, 0.132 * H),
            sh + Vector((0.032 * H * side, 0.004 * H, 0.032 * H)),
            rot_euler=(0.0, -0.22 * side, -0.12 * side),
            bevel_width=0.016 * H,
            bevel_segs=1,
            taper_z=(1.08, 0.78),
        ))
        pauldron_parts.append(make_beveled_block(
            f"Basalt_PauldronCap_{sfx}",
            (0.110 * H, 0.132 * H, 0.068 * H),
            sh + Vector((0.050 * H * side, 0.006 * H, -0.042 * H)),
            rot_euler=(0.0, -0.12 * side, -0.08 * side),
            bevel_width=0.012 * H,
            bevel_segs=1,
        ))
        # Armored faceted basalt bicep sleeve wrapping upper arm between pauldron & gauntlet!
        ua_ax = (el - sh).normalized()
        ua_len = (el - sh).length
        ua_rings = [
            (sh + ua_ax * (ua_len * 0.25), ua_ax, 0.054 * H, 0.054 * H, 0.12),
            (sh + ua_ax * (ua_len * 0.62), ua_ax, 0.058 * H, 0.056 * H, 0.14),
            (sh + ua_ax * (ua_len * 0.90), ua_ax, 0.052 * H, 0.050 * H, 0.12),
        ]
        bicep_parts.append(loft_tube(f"Basalt_Bicep_{sfx}", ua_rings, n_sides=7, sharp_creases=True))
    pauldrons = _join_objs(pauldron_parts, "Basalt_Pauldrons")
    biceps = _join_objs(bicep_parts, "Basalt_Biceps")
    return chest_armor, pauldrons, biceps


def build_basalt_colossal_fist(
    side_sfx: str,
    elbow: Vector,
    wrist: Vector,
    H: float,
) -> tuple[bpy.types.Object, bpy.types.Object]:
    """Build Basalt's enormous faceted obsidian boulder-fist & rune-carved stone forearm monolith."""
    sign = 1.0 if side_sfx == "L" else -1.0
    axis, outer, palm_fwd, rot_e = _limb_basis(elbow, wrist, sign)
    fa_len = (wrist - elbow).length
    cuff_mid = elbow + axis * (fa_len * 0.56)

    stone_parts: list[bpy.types.Object] = []
    rune_parts: list[bpy.types.Object] = []

    # 1) Massive angular faceted stone forearm slab flaring cleanly toward the giant boulder fist
    cuff_rings = [
        (elbow + axis * (fa_len * 0.16), axis, 0.056 * H, 0.052 * H, 0.14),
        (elbow + axis * (fa_len * 0.52), axis, 0.072 * H, 0.068 * H, 0.16),
        (elbow + axis * (fa_len * 0.90), axis, 0.088 * H, 0.082 * H, 0.16),
        (wrist + axis * (0.014 * H), axis, 0.092 * H, 0.086 * H, 0.14),
    ]
    stone_parts.append(loft_tube(f"Basalt_Vambrace_{side_sfx}", cuff_rings, n_sides=8, sharp_creases=True))

    # Heavy beveled outer granite shield plate along forearm
    stone_parts.append(make_beveled_block(
        f"Basalt_ArmSlab_{side_sfx}",
        (0.042 * H, 0.105 * H, 0.168 * H),
        cuff_mid + outer * (0.062 * H),
        rot_e,
        bevel_width=0.011 * H,
        bevel_segs=1,
        taper_z=(0.86, 1.12),
    ))

    # 2) Colossal boulder fist (palm monolith + heavy knuckle block + 4 carved stone fingers + thumb!)
    fist_c = wrist + axis * (0.086 * H)
    stone_parts.append(make_beveled_block(
        f"Basalt_FistCore_{side_sfx}",
        (0.132 * H, 0.144 * H, 0.132 * H),
        fist_c,
        rot_e,
        bevel_width=0.016 * H,
        bevel_segs=1,
        taper_z=(0.94, 1.06),
    ))
    stone_parts.append(make_beveled_block(
        f"Basalt_KnuckleRidge_{side_sfx}",
        (0.044 * H, 0.154 * H, 0.068 * H),
        fist_c + outer * (0.056 * H) + axis * (0.016 * H),
        rot_e,
        bevel_width=0.010 * H,
        bevel_segs=1,
    ))
    for fi in range(4):
        fy = (-0.050 + fi * 0.033) * H
        stone_parts.append(make_beveled_block(
            f"Basalt_Finger_{side_sfx}_{fi}",
            (0.096 * H, 0.031 * H, 0.054 * H),
            fist_c + axis * (0.068 * H) + palm_fwd * fy + outer * (0.010 * H),
            rot_e,
            bevel_width=0.007 * H,
            bevel_segs=1,
        ))
    stone_parts.append(make_beveled_block(
        f"Basalt_Thumb_{side_sfx}",
        (0.066 * H, 0.056 * H, 0.080 * H),
        fist_c + palm_fwd * (-0.066 * H) + outer * (-0.022 * H) + axis * (0.016 * H),
        rot_e,
        bevel_width=0.010 * H,
        bevel_segs=1,
    ))

    # 3) Glowing carved volcanic magma runes on outer forearm & glowing wrist-fissure ring!
    rune_parts.append(make_beveled_block(
        f"Basalt_WristMagma_{side_sfx}",
        (0.138 * H, 0.134 * H, 0.018 * H),
        wrist + axis * (0.012 * H),
        rot_e,
        bevel_width=0.003 * H,
        bevel_segs=1,
    ))
    # Angular Z-shaped glowing rune bar carved along outer stone forearm slab
    for ri, (ry, rz, rw, rh) in enumerate((
        (0.00, -0.040, 0.056, 0.013),
        (0.022, 0.000, 0.013, 0.088),
        (0.00, 0.042, 0.056, 0.013),
    )):
        rune_parts.append(make_beveled_block(
            f"Basalt_Rune_{side_sfx}_{ri}",
            (0.014 * H, rw * H, rh * H),
            cuff_mid + outer * (0.082 * H) + palm_fwd * (ry * H) + axis * (rz * H),
            rot_e,
            bevel_width=0.002 * H,
            bevel_segs=1,
        ))

    return (
        _join_objs(stone_parts, f"Basalt_Gauntlet_{side_sfx}"),
        _join_objs(rune_parts, f"Basalt_Runes_{side_sfx}"),
    )


def build_basalt_leg_armor(lm: dict[str, Vector]) -> tuple[bpy.types.Object, bpy.types.Object, bpy.types.Object]:
    """Build Basalt's faceted obsidian thigh plates, heavy shin greaves, and colossal stone stomp boots."""
    H = lm["height"].z
    thigh_parts: list[bpy.types.Object] = []
    shin_parts: list[bpy.types.Object] = []
    boot_parts: list[bpy.types.Object] = []

    for side, sfx in (("l", "L"), ("r", "R")):
        sign = 1.0 if sfx == "L" else -1.0
        hip = lm[f"hip_{side}"]
        knee = lm[f"knee_{side}"]
        ankle = lm[f"ankle_{side}"]
        toe = lm[f"toe_{side}"]

        # Thigh armor sleeve (leaves magma glow visible at hip & knee joints!)
        th_ax = (knee - hip).normalized()
        th_len = (knee - hip).length
        th_rings = [
            (hip + th_ax * (th_len * 0.16), th_ax, 0.072 * H, 0.076 * H, 0.12),
            (hip + th_ax * (th_len * 0.54), th_ax, 0.074 * H, 0.078 * H, 0.14),
            (hip + th_ax * (th_len * 0.86), th_ax, 0.064 * H, 0.068 * H, 0.14),
        ]
        thigh_parts.append(loft_tube(f"Basalt_Thigh_{sfx}", th_rings, n_sides=7, sharp_creases=True))

        # Heavy shin greave + hexagonal knee guard block
        sh_ax = (ankle - knee).normalized()
        sh_len = (ankle - knee).length
        sh_rings = [
            (knee + sh_ax * (sh_len * 0.14), sh_ax, 0.062 * H, 0.066 * H, 0.14),
            (knee + sh_ax * (sh_len * 0.56), sh_ax, 0.068 * H, 0.072 * H, 0.16),
            (knee + sh_ax * (sh_len * 0.88), sh_ax, 0.060 * H, 0.064 * H, 0.14),
        ]
        shin_parts.append(loft_tube(f"Basalt_Shin_{sfx}", sh_rings, n_sides=7, sharp_creases=True))
        shin_parts.append(make_beveled_block(
            f"Basalt_KneeCap_{sfx}",
            (0.068 * H, 0.056 * H, 0.064 * H),
            knee + Vector((0.008 * H * sign, -0.056 * H, 0.006 * H)),
            bevel_width=0.010 * H,
            bevel_segs=1,
            taper_z=(0.76, 1.06),
        ))

        # Massive angular stone stomp boots (shifted cleanly outward so L & R boots stay strictly separate across X=0!)
        mid_y = 0.5 * (ankle.y + toe.y) - 0.012 * H
        boot_x = ankle.x + 0.016 * H * sign
        boot_parts.append(make_beveled_block(
            f"Basalt_Boot_{sfx}",
            (0.098 * H, 0.195 * H, 0.068 * H),
            Vector((boot_x, mid_y, 0.036 * H)),
            bevel_width=0.012 * H,
            bevel_segs=1,
            taper_z=(1.08, 0.82),
        ))

    return (
        _join_objs(thigh_parts, "Basalt_Thighs"),
        _join_objs(shin_parts, "Basalt_Shins"),
        _join_objs(boot_parts, "Basalt_Boots"),
    )


# ============================================================================
# 2. WATER ELEMENTAL — TIDE (Hydro-Acrobat with Wave Hair & Water Sleeves)
# ============================================================================

def _measure_torso_slice(
    body: bpy.types.Object,
    z_center: float,
    half_band: float,
    x_limit: float,
) -> tuple[float, float, float]:
    """Measure actual anatomical (rx, ry, cy) cross-section of body at height z_center."""
    xs = []
    ys = []
    for v in body.data.vertices:
        if abs(v.co.z - z_center) <= half_band and abs(v.co.x) <= x_limit:
            xs.append(abs(v.co.x))
            ys.append(v.co.y)
    if not xs:
        return 0.09, 0.065, 0.0
    rx = max(xs)
    ymin, ymax = min(ys), max(ys)
    return rx, 0.5 * (ymax - ymin), 0.5 * (ymin + ymax)


def build_tide_crop_top_and_sash(
    body: bpy.types.Object,
    lm: dict[str, Vector],
) -> tuple[bpy.types.Object, bpy.types.Object]:
    """Build Tide's form-fitted athletic halter crop top + sleek diagonally wrapped hip sash (ZERO saw-tooth or boxy edges!)."""
    H = lm["height"].z
    # 1) Snug form-fitted athletic halter crop top measured strictly inside ribcage (excluding arm vertices!)
    top_parts: list[bpy.types.Object] = []
    bm = bmesh.new()
    n_ang = 20
    # (z_frac, x_limit_frac, x_cap_frac) -> strictly avoids grabbing upper-arm vertices near armpit!
    ring_specs = (
        (0.636, 0.088, 0.078),  # snug athletic waist hem
        (0.674, 0.094, 0.084),  # lower ribcage
        (0.712, 0.100, 0.092),  # bust contour
        (0.748, 0.096, 0.086),  # upper chest tapering smoothly in from armpits!
        (0.774, 0.082, 0.072),  # sleek halter neckline
    )
    grid = []
    for zi, (zf, xlim, xcap) in enumerate(ring_specs):
        zc = zf * H
        rx, ry, cy = _measure_torso_slice(body, zc, 0.020 * H, xlim * H)
        rx = min(rx, xcap * H) + 0.005 * H
        ry = ry + 0.0055 * H
        row = []
        for ai in range(n_ang):
            ang = (ai / n_ang) * math.tau
            ca, sa = math.cos(ang), math.sin(ang)
            z_mod = zc
            if zi == len(ring_specs) - 1:
                z_mod += (-0.008 * H * max(0.0, -sa)) - (0.012 * H * max(0.0, sa))
            p = Vector((ca * rx, cy + sa * ry, z_mod))
            row.append(bm.verts.new(p))
        grid.append(row)
    for ri in range(len(grid) - 1):
        for ai in range(n_ang):
            an = (ai + 1) % n_ang
            f = bm.faces.new((grid[ri][ai], grid[ri][an], grid[ri + 1][an], grid[ri + 1][ai]))
            f.smooth = True
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    me_ct = bpy.data.meshes.new("Tide_CropBodice")
    bm.to_mesh(me_ct)
    bm.free()
    bodice = bpy.data.objects.new("Tide_CropBodice", me_ct)
    bpy.context.scene.collection.objects.link(bodice)
    sol = bodice.modifiers.new("Solidify", "SOLIDIFY")
    sol.thickness = 0.005 * H
    sol.offset = 1.0
    sol.use_rim = True
    bpy.ops.object.select_all(action="DESELECT")
    bodice.select_set(True)
    bpy.context.view_layer.objects.active = bodice
    bpy.ops.object.modifier_apply(modifier=sol.name)
    top_parts.append(bodice)

    # Sleek twin halter straps curving smoothly from front bust up around her neck!
    rx_u, ry_u, cy_u = _measure_torso_slice(body, 0.768 * H, 0.020 * H, 0.085 * H)
    nk = lm["neck"]
    for side in (-1.0, 1.0):
        s_rings = [
            (Vector((0.036 * H * side, cy_u - (ry_u + 0.005 * H) * 0.88, 0.762 * H)), Vector((0.0, 0.25, 1.0)), 0.010 * H, 0.004 * H, 0.05),
            (Vector((0.032 * H * side, nk.y - 0.035 * H, 0.806 * H)), Vector((0.0, 0.55, 0.85)), 0.009 * H, 0.004 * H, 0.05),
            (Vector((0.030 * H * side, nk.y + 0.020 * H, 0.818 * H)), Vector((-0.3 * side, 0.85, -0.1)), 0.009 * H, 0.004 * H, 0.05),
            (Vector((0.000, nk.y + 0.044 * H, 0.814 * H)), Vector((-side, 0.1, 0.0)), 0.008 * H, 0.004 * H, 0.05),
        ]
        top_parts.append(loft_tube(f"Tide_HalterStrap_{side}", s_rings, n_sides=6))
    crop_top = _join_objs(top_parts, "Tide_CropTop")

    # 2) Sleek snug diagonally wrapped seafoam hip obi sash (hugs hips cleanly — NOT a stiff hula hoop!)
    bm_s = bmesh.new()
    s_fracs = (0.490, 0.508, 0.526, 0.542)
    s_grid = []
    for si, zf in enumerate(s_fracs):
        zc = zf * H
        rx, ry, cy = _measure_torso_slice(body, zc, 0.020 * H, 0.125 * H)
        pad = 0.0065 * H + (0.002 * H if si in (1, 2) else 0.0)
        rx += pad
        ry += pad
        row = []
        for ai in range(n_ang):
            ang = (ai / n_ang) * math.tau
            ca, sa = math.cos(ang), math.sin(ang)
            slant = -0.009 * H * ca - 0.004 * H * (-sa)
            p = Vector((ca * rx, cy + sa * ry, zc + slant))
            row.append(bm_s.verts.new(p))
        s_grid.append(row)
    for ri in range(len(s_grid) - 1):
        for ai in range(n_ang):
            an = (ai + 1) % n_ang
            f = bm_s.faces.new((s_grid[ri][ai], s_grid[ri][an], s_grid[ri + 1][an], s_grid[ri + 1][ai]))
            f.smooth = True
    bmesh.ops.recalc_face_normals(bm_s, faces=bm_s.faces)
    me_s = bpy.data.meshes.new("Tide_WaistSash")
    bm_s.to_mesh(me_s)
    bm_s.free()
    waist_sash = bpy.data.objects.new("Tide_WaistSash", me_s)
    bpy.context.scene.collection.objects.link(waist_sash)
    sol_s = waist_sash.modifiers.new("Solidify", "SOLIDIFY")
    sol_s.thickness = 0.0055 * H
    sol_s.offset = 1.0
    sol_s.use_rim = True
    bpy.ops.object.select_all(action="DESELECT")
    waist_sash.select_set(True)
    bpy.context.view_layer.objects.active = waist_sash
    bpy.ops.object.modifier_apply(modifier=sol_s.name)

    return crop_top, waist_sash


def build_tide_wave_hair_and_visor(
    lm: dict[str, Vector],
) -> tuple[bpy.types.Object, bpy.types.Object, bpy.types.Object, bpy.types.Object]:
    """Build Tide's iconic sculpted turquoise Hokusai wave-crest hair (zero scalp gaps!), sleek ski-goggle visor & compact breather."""
    H = lm["height"].z
    hc = lm["head"] + Vector((0.0, 0.002 * H, 0.028 * H))

    hair_parts: list[bpy.types.Object] = []

    # 1a) Lush full sculpted turquoise hair cap completely enveloping crown, temples & back of skull (ZERO bald patches!)
    cap_rings = [
        (hc + Vector((0.0, 0.020 * H, -0.032 * H)), Vector((0.0, 0.05, 1.0)), 0.062 * H, 0.068 * H, 0.04),
        (hc + Vector((0.0, 0.015 * H, 0.014 * H)), Vector((0.0, 0.03, 1.0)), 0.079 * H, 0.084 * H, 0.06),
        (hc + Vector((0.0, 0.010 * H, 0.058 * H)), Vector((0.0, 0.02, 1.0)), 0.080 * H, 0.085 * H, 0.08),
        (hc + Vector((0.0, 0.012 * H, 0.094 * H)), Vector((0.0, 0.04, 1.0)), 0.066 * H, 0.070 * H, 0.10),
    ]
    hair_parts.append(loft_tube("Tide_HairCap", cap_rings, n_sides=12, cap_start=True, cap_end=True))

    # 1b) Seamless unified Hokusai ocean breaking-wave curl arching smoothly over to +X (thick root fused cleanly to crown!)
    crest_rings = [
        (hc + Vector((-0.012 * H, 0.012 * H, 0.060 * H)), Vector((-0.18, 0.04, 0.98)), 0.074 * H, 0.074 * H, 0.08),
        (hc + Vector((-0.020 * H, 0.012 * H, 0.102 * H)), Vector((0.18, 0.02, 0.98)), 0.068 * H, 0.068 * H, 0.12),
        (hc + Vector((0.004 * H, 0.008 * H, 0.146 * H)), Vector((0.72, -0.05, 0.68)), 0.056 * H, 0.058 * H, 0.16),
        (hc + Vector((0.044 * H, -0.002 * H, 0.160 * H)), Vector((0.96, -0.08, -0.22)), 0.038 * H, 0.042 * H, 0.18),
        (hc + Vector((0.068 * H, -0.008 * H, 0.136 * H)), Vector((0.25, -0.06, -0.96)), 0.022 * H, 0.026 * H, 0.22),
        (hc + Vector((0.050 * H, -0.010 * H, 0.114 * H)), Vector((-0.88, -0.04, -0.45)), 0.009 * H, 0.011 * H, 0.24),
    ]
    hair_parts.append(loft_tube("Tide_WaveCrest", crest_rings, n_sides=10, cap_start=True, cap_end=True))

    # 1c) Layered sweeping wave bangs & splash spikes hugging temples, sides, and nape cleanly!
    lock_specs = [
        # (xo, yo, zo, xs, ys, zs, rad)
        (-0.048, -0.004, 0.062, -0.056, 0.020, 0.064, 0.032),  # Right bold wave crest spike
        (0.048, -0.004, 0.058, 0.052, 0.022, 0.052, 0.030),    # Left splash spike
        (-0.056, -0.012, 0.040, -0.038, -0.008, 0.036, 0.026), # Right temple curl
        (0.056, -0.012, 0.040, 0.038, -0.008, 0.036, 0.026),   # Left temple curl
        (-0.024, -0.036, 0.064, -0.028, -0.028, 0.048, 0.026), # Forehead wave bang R
        (0.024, -0.036, 0.064, 0.034, -0.026, 0.042, 0.026),   # Forehead wave bang L
        (0.000, 0.052, 0.044, 0.000, 0.054, 0.062, 0.042),     # Back upper wave crest
        (0.038, 0.052, 0.008, 0.032, 0.036, -0.044, 0.028),    # Left nape lock
        (-0.038, 0.052, 0.008, -0.032, 0.036, -0.044, 0.028),  # Right nape lock
        (0.000, 0.054, 0.000, 0.000, 0.036, -0.048, 0.032),    # Center nape lock
    ]
    for idx, (xo, yo, zo, xs, ys, zs, rad) in enumerate(lock_specs):
        p0 = hc + Vector((xo * H, yo * H, zo * H))
        l_rings = []
        for s_i in range(5):
            t = s_i / 4.0
            pos = p0 + Vector((xs * H * (t ** 1.1), ys * H * (t ** 1.15), zs * H * (t ** 0.92)))
            tang = Vector((xs, ys, zs if abs(zs) > 0.01 else 0.05))
            r_cur = rad * H * ((1.0 - t) ** 0.78 + 0.08)
            l_rings.append((pos, tang, r_cur * 0.78, r_cur * 1.08, 0.20))
        hair_parts.append(loft_tube(f"Tide_Lock_{idx}", l_rings, n_sides=8, cap_start=True, cap_end=True))

    wave_hair = _join_objs(hair_parts, "Tide_WaveHair")

    # 2) Sleek wide contoured dive-goggle visor rim + curved luminous cyan lens!
    frame_parts = [
        make_beveled_block(
            "Tide_GoggleRim",
            (0.104 * H, 0.028 * H, 0.042 * H),
            hc + Vector((0.0, -0.056 * H, 0.026 * H)),
            rot_euler=(0.06, 0.0, 0.0),
            bevel_width=0.011 * H,
            bevel_segs=2,
        ),
        make_beveled_block(
            "Tide_GoggleStrap",
            (0.122 * H, 0.102 * H, 0.015 * H),
            hc + Vector((0.0, 0.004 * H, 0.028 * H)),
            bevel_width=0.004 * H,
            bevel_segs=1,
        ),
    ]
    visor_frame = _join_objs(frame_parts, "Tide_VisorFrame")

    visor_lens = make_beveled_block(
        "Tide_VisorLens",
        (0.088 * H, 0.014 * H, 0.030 * H),
        hc + Vector((0.0, -0.067 * H, 0.026 * H)),
        rot_euler=(0.06, 0.0, 0.0),
        bevel_width=0.006 * H,
        bevel_segs=1,
    )

    # 3) Sleek compact contoured aqua dive breather tucked cleanly below her nose on her jaw
    breather_parts = [
        make_beveled_block(
            "Tide_ChinMask",
            (0.046 * H, 0.032 * H, 0.020 * H),
            hc + Vector((0.0, -0.045 * H, -0.030 * H)),
            rot_euler=(-0.18, 0.0, 0.0),
            bevel_width=0.007 * H,
            bevel_segs=1,
        ),
        make_beveled_block(
            "Tide_RebreatherPodL",
            (0.013 * H, 0.015 * H, 0.013 * H),
            hc + Vector((0.024 * H, -0.047 * H, -0.030 * H)),
            bevel_width=0.004 * H,
            bevel_segs=1,
        ),
        make_beveled_block(
            "Tide_RebreatherPodR",
            (0.013 * H, 0.015 * H, 0.013 * H),
            hc + Vector((-0.024 * H, -0.047 * H, -0.030 * H)),
            bevel_width=0.004 * H,
            bevel_segs=1,
        ),
    ]
    breather = _join_objs(breather_parts, "Tide_Breather")
    return wave_hair, visor_frame, visor_lens, breather


def build_tide_water_sleeve(
    side_sfx: str,
    shoulder: Vector,
    elbow: Vector,
    wrist: Vector,
    H: float,
) -> bpy.types.Object:
    """Build Tide's iconic flowing curved teardrop kimono water-sleeve hanging gracefully off her elbow & forearm!

    Uses a lush, rounded liquid-silk teardrop drape along the ulnar (+Y) axis (which tracks elbow_pole
    straight downward in martial-arts poses!) instead of a sharp rigid triangle fin.
    """
    sign = 1.0 if side_sfx == "L" else -1.0
    axis, outer, palm_fwd, _ = _limb_basis(elbow, wrist, sign)
    fa_len = (wrist - elbow).length
    ulnar = -palm_fwd

    parts: list[bpy.types.Object] = []
    # 1) Sleek fitted aqua forearm & upper-elbow silk cuff leaving graceful hands completely free!
    wrap_rings = [
        (elbow + axis * (-0.035 * H), axis, 0.029 * H, 0.028 * H, 0.04),
        (elbow + axis * (fa_len * 0.25), axis, 0.028 * H, 0.027 * H, 0.05),
        (elbow + axis * (fa_len * 0.65), axis, 0.026 * H, 0.025 * H, 0.05),
        (wrist + axis * (-0.008 * H), axis, 0.024 * H, 0.023 * H, 0.05),
    ]
    parts.append(loft_tube(f"Tide_ArmWrap_{side_sfx}", wrap_rings, n_sides=10))

    # 2) Lush curved kimono teardrop bell-sleeve (smooth rounded hanging wave lobe, zero stiff sharp triangle!)
    bm = bmesh.new()
    n_u = 11  # from upper elbow (u=0) smoothly along forearm to wrist (u=1)
    n_v = 7   # hanging smoothly downward along ulnar edge
    grid = []
    for iu in range(n_u):
        u = iu / (n_u - 1)
        anchor = elbow + axis * (-0.025 * H + (fa_len + 0.015 * H) * u)
        # Smooth rounded kimono teardrop envelope (deepest lush drop at u=0.34, gently tapering toward wrist!)
        env = math.sin(u * math.pi) ** 0.68
        drape_len = (0.018 + 0.165 * env * (1.12 - 0.35 * u)) * H
        row = []
        for iv in range(n_v):
            v = iv / (n_v - 1)
            # Graceful curved silk cup bowing slightly outward around forearm then curling softly at the water edge
            out_bow = (0.024 * math.sin(v * math.pi * 0.85) + 0.014 * math.sin(u * math.pi * 2.0) * v) * H
            # Soft flowing S-sweep trailing slightly back toward the elbow tip
            axis_flow = (-0.032 * (v ** 1.35) + 0.012 * math.sin(v * math.pi)) * H
            p = anchor + ulnar * (0.014 * H + drape_len * (v ** 0.92)) + outer * out_bow + axis * axis_flow
            row.append(bm.verts.new(p))
        grid.append(row)
    for iu in range(n_u - 1):
        for iv in range(n_v - 1):
            f = bm.faces.new((grid[iu][iv], grid[iu + 1][iv], grid[iu + 1][iv + 1], grid[iu][iv + 1]))
            f.smooth = True
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    me_d = bpy.data.meshes.new(f"Tide_SleeveBell_{side_sfx}")
    bm.to_mesh(me_d)
    bm.free()
    bell = bpy.data.objects.new(f"Tide_SleeveBell_{side_sfx}", me_d)
    bpy.context.scene.collection.objects.link(bell)
    sol = bell.modifiers.new("Solidify", "SOLIDIFY")
    sol.thickness = 0.007 * H
    sol.offset = 0.0
    sol.use_rim = True
    bpy.ops.object.select_all(action="DESELECT")
    bell.select_set(True)
    bpy.context.view_layer.objects.active = bell
    bpy.ops.object.modifier_apply(modifier=sol.name)
    parts.append(bell)

    return _join_objs(parts, f"Tide_WaterSleeve_{side_sfx}")


def build_tide_waist_sash_ribbons(lm: dict[str, Vector]) -> tuple[bpy.types.Object, bpy.types.Object]:
    """Build Tide's neat side-tied seafoam sash knot + twin graceful downward-draping ocean sash ribbons."""
    H = lm["height"].z
    knot = make_beveled_block(
        "Tide_SashKnot",
        (0.042 * H, 0.034 * H, 0.038 * H),
        Vector((0.068 * H, -0.072 * H, 0.506 * H)),
        rot_euler=(0.0, 0.0, -0.42),
        bevel_width=0.009 * H,
        bevel_segs=1,
    )
    tail_parts: list[bpy.types.Object] = []
    # Two graceful curved tapered water-silk sash ribbons flowing down her front-left & outer-left hip
    for idx, (x_start, y_start, x_dir, y_dir, z_drop, w_base) in enumerate((
        (0.060, -0.078, 0.038, -0.042, -0.26, 0.034),
        (0.094, -0.034, 0.056, 0.022, -0.22, 0.028),
    )):
        s0 = Vector((x_start * H, y_start * H, 0.498 * H))
        rings = []
        for i in range(8):
            t = i / 7.0
            pos = s0 + Vector((
                (x_dir * t + 0.020 * math.sin(t * math.pi * 1.4)) * H,
                (y_dir * t + 0.012 * math.sin(t * math.pi * 1.2)) * H,
                z_drop * H * (t ** 0.94),
            ))
            tang = Vector((x_dir, y_dir, z_drop))
            w = (w_base + 0.014 * math.sin(t * math.pi * 0.78)) * H * (1.0 - 0.68 * (t ** 2.0))
            rings.append((pos, tang, w, 0.005 * H, 0.10))
        tail_parts.append(loft_tube(f"Tide_SashTail_{idx}", rings, n_sides=8, cap_start=True, cap_end=True))

    return knot, _join_objs(tail_parts, "Tide_SashTails")


# ============================================================================
# 3. AIR ELEMENTAL — ZEPHYR (Sky-Monk with Avian Mask, Diamond Poncho, Wing Boots & Gale Staff)
# ============================================================================

def build_zephyr_hood_and_avian_mask(
    lm: dict[str, Vector],
) -> tuple[bpy.types.Object, bpy.types.Object, bpy.types.Object, bpy.types.Object]:
    """Build Zephyr's iconic SHARP TRIANGULAR POINTED HAWK HOOD seamless into poncho collar + sculpted avian falcon mask."""
    H = lm["height"].z
    hc = lm["head"] + Vector((0.0, 0.002 * H, 0.034 * H))

    # 1) Sculpted faceted avian falcon mask (pale-mint angular visor with crisp sculpted beak!)
    mask_parts: list[bpy.types.Object] = []
    face_rings = [
        (hc + Vector((0.0, -0.008 * H, -0.042 * H)), Vector((0, 0, 1)), 0.040 * H, 0.050 * H, 0.14),
        (hc + Vector((0.0, -0.014 * H, 0.006 * H)), Vector((0, 0, 1)), 0.058 * H, 0.068 * H, 0.16),
        (hc + Vector((0.0, -0.010 * H, 0.054 * H)), Vector((0, 0, 1)), 0.060 * H, 0.068 * H, 0.16),
        (hc + Vector((0.0, 0.004 * H, 0.090 * H)), Vector((0, 0.10, 1)), 0.040 * H, 0.048 * H, 0.14),
    ]
    mask_parts.append(loft_tube("Zephyr_MaskCore", face_rings, n_sides=8, sharp_creases=True))
    beak_rings = [
        (hc + Vector((0.0, -0.060 * H, 0.026 * H)), Vector((0.0, -0.82, -0.58)), 0.020 * H, 0.025 * H, 0.28),
        (hc + Vector((0.0, -0.086 * H, 0.004 * H)), Vector((0.0, -0.60, -0.80)), 0.013 * H, 0.017 * H, 0.34),
        (hc + Vector((0.0, -0.094 * H, -0.026 * H)), Vector((0.0, -0.22, -0.97)), 0.003 * H, 0.005 * H, 0.36),
    ]
    mask_parts.append(loft_tube("Zephyr_Beak", beak_rings, n_sides=6, sharp_creases=True))
    avian_mask = _join_objs(mask_parts, "Zephyr_AvianMask")

    # Fierce glowing cyan avian eyes + dark shadowed eye-sockets & inner cowl shadow liner!
    eye_objs: list[bpy.types.Object] = []
    socket_objs: list[bpy.types.Object] = []
    for side in (-1.0, 1.0):
        pts_e = [
            Vector((0.011 * H * side, -0.004 * H, -0.001 * H)),
            Vector((0.046 * H * side, 0.016 * H, 0.017 * H)),
            Vector((0.040 * H * side, 0.014 * H, -0.005 * H)),
            Vector((0.013 * H * side, -0.005 * H, -0.010 * H)),
        ]
        pts_s = [
            Vector((0.006 * H * side, 0.000 * H, 0.004 * H)),
            Vector((0.054 * H * side, 0.022 * H, 0.023 * H)),
            Vector((0.047 * H * side, 0.019 * H, -0.011 * H)),
            Vector((0.009 * H * side, 0.000 * H, -0.015 * H)),
        ]
        for pts, tlist, pfx, dep in ((pts_e, eye_objs, "ZEye", 0.012 * H), (pts_s, socket_objs, "ZSock", 0.016 * H)):
            bm = bmesh.new()
            pc = list(pts)
            if side < 0:
                pc.reverse()
            f = bm.faces.new([bm.verts.new(p) for p in pc])
            ret = bmesh.ops.extrude_face_region(bm, geom=[f])
            ev = [g for g in ret["geom"] if isinstance(g, bmesh.types.BMVert)]
            bmesh.ops.translate(bm, verts=ev, vec=Vector((0.0, dep, 0.0)))
            bmesh.ops.transform(bm, matrix=Matrix.Translation(hc + Vector((0.0, -0.079 * H, 0.026 * H))), verts=bm.verts)
            bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
            me = bpy.data.meshes.new(f"{pfx}_{side}")
            bm.to_mesh(me)
            bm.free()
            eo = bpy.data.objects.new(f"{pfx}_{side}", me)
            bpy.context.scene.collection.objects.link(eo)
            tlist.append(eo)
    socket_objs.append(make_beveled_block(
        "Zephyr_HoodShadowLiner",
        (0.112 * H, 0.088 * H, 0.132 * H),
        hc + Vector((0.0, 0.004 * H, 0.002 * H)),
        bevel_width=0.018 * H,
        bevel_segs=1,
    ))
    avian_eyes = _join_objs(eye_objs, "Zephyr_Eyes")
    avian_sockets = _join_objs(socket_objs, "Zephyr_EyeSockets")

    # 2) SHARP ANGULAR POINTED GOTHIC/HAWK RANGER HOOD (crisp ^ triangle brow peak, NOT an oval egg dome!)
    bm = bmesh.new()
    # Odd count so middle vertex (ai == 4) forms a RAZOR-SHARP Gothic peak gable along X=0!
    n_arc = 9
    mid_i = n_arc // 2
    u_specs = [
        # (y_off, z_center, half_w, peak_h, chin_drop)
        (-0.088, 0.022, 0.082, 0.128, -0.090),  # Sharp angular ^ front brow peak & flared cheek collar!
        (-0.036, 0.030, 0.094, 0.136, -0.088),
        (0.024, 0.036, 0.088, 0.128, -0.082),
        (0.084, 0.048, 0.056, 0.092, -0.055),
        (0.138, 0.072, 0.018, 0.032, -0.016),
    ]
    grid = []
    for uy, uz, hw, ph, cdrop in u_specs:
        row = []
        for ai in range(n_arc):
            # s in [-1, 1]; s == 0 is the sharp top gable peak, |s| == 1 is the lower collar edge!
            s = (ai - mid_i) / mid_i
            a = abs(s)
            # Crisp faceted triangular hawk-hood arch: sharp straight diagonal cheeks -> tucked collar!
            if a <= 0.55:
                # Upper triangular gable peak (^): straight angular roof slopes!
                t = a / 0.55
                px = math.copysign(hw * (0.94 * t), s)
                pz = uz + ph * (1.0 - 0.85 * t)
            else:
                # Lower angled cheek drape tucking smoothly down onto the poncho collar!
                t = (a - 0.55) / 0.45
                px = math.copysign(hw * (0.94 + 0.10 * t), s)
                pz = uz + ph * 0.15 + (cdrop - ph * 0.15) * t
            row.append(bm.verts.new(hc + Vector((px * H, uy * H, pz * H))))
        grid.append(row)
    for ui in range(len(grid) - 1):
        for ai in range(n_arc - 1):
            f = bm.faces.new((grid[ui][ai], grid[ui][ai + 1], grid[ui + 1][ai + 1], grid[ui + 1][ai]))
            f.smooth = False  # Keep crisp angular Style B low-poly hood planes!
    tip = bm.verts.new(hc + Vector((0.0, 0.168 * H, 0.092 * H)))
    for ai in range(n_arc - 1):
        f = bm.faces.new((grid[-1][ai], grid[-1][ai + 1], tip))
        f.smooth = False
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    me_h = bpy.data.meshes.new("Zephyr_Hood")
    bm.to_mesh(me_h)
    bm.free()
    hood = bpy.data.objects.new("Zephyr_Hood", me_h)
    bpy.context.scene.collection.objects.link(hood)
    sol = hood.modifiers.new("Solidify", "SOLIDIFY")
    sol.thickness = 0.011 * H
    sol.offset = 1.0
    sol.use_rim = True
    bpy.ops.object.select_all(action="DESELECT")
    hood.select_set(True)
    bpy.context.view_layer.objects.active = hood
    bpy.ops.object.modifier_apply(modifier=sol.name)

    return hood, avian_mask, avian_eyes, avian_sockets


def build_zephyr_poncho_and_wind_ribbons(
    lm: dict[str, Vector],
) -> tuple[bpy.types.Object, bpy.types.Object]:
    """Build Zephyr's iconic TRUE 4-CORNER ORIGAMI DIAMOND PONCHO (sharp front V-tip, crisp shoulder wings — ZERO dome/lampshade!) + swirling wind ribbons.

    Geometric mint V-chevron & wing-tip accents are baked razor-crisp onto M_IvoryPoncho at 1024px in mesh_craft.py!
    """
    H = lm["height"].z
    # 4 exact razor-sharp diamond poncho corners matching Style B concept art:
    # Front V-tip drops cleanly past waist; Left/Right wing corners flare crisply above elbows!
    c_front = Vector((0.0, -0.155 * H, 0.440 * H))
    c_left = Vector((0.258 * H, 0.005 * H, 0.628 * H))
    c_back = Vector((0.0, 0.162 * H, 0.460 * H))
    c_right = Vector((-0.258 * H, 0.005 * H, 0.628 * H))
    corners = [c_front, c_left, c_back, c_right]

    # Snug collar & contoured shoulder rings matching the same 4-quadrant topology!
    n_seg = 6  # subdivisions along each straight diamond edge (24 verts per ring)
    n_ring = 4 * n_seg
    collar_pts: list[Vector] = []
    shoulder_pts: list[Vector] = []
    hem_pts: list[Vector] = []

    for qi in range(4):
        p_a = corners[qi]
        p_b = corners[(qi + 1) % 4]
        for si in range(n_seg):
            t = si / n_seg
            # Exact straight diagonal diamond hem line between corners!
            hp = p_a.lerp(p_b, t)
            # Subtle 4mm organic cloth bow outward at mid-edge (keeps razor diamond silhouette crisp!)
            bow = 0.006 * H * math.sin(t * math.pi)
            h_dir = Vector((hp.x, hp.y, 0.0))
            if h_dir.length > 1e-4:
                hp = hp + h_dir.normalized() * bow
            hem_pts.append(hp)

            # Matching angle around collar & shoulder shelf
            ang = math.atan2(hp.y, hp.x)
            ca, sa = math.cos(ang), math.sin(ang)
            collar_pts.append(Vector((ca * 0.060 * H, sa * 0.056 * H, 0.818 * H)))
            shoulder_pts.append(Vector((ca * 0.146 * H, sa * 0.098 * H, 0.766 * H)))

    bm = bmesh.new()
    # 6 profile rings: collar -> shoulder crest -> 4 crisp straight diamond cape drop bands!
    grid = []
    for ring_idx in range(6):
        row = []
        for vi in range(n_ring):
            if ring_idx == 0:
                p = collar_pts[vi]
            elif ring_idx == 1:
                p = collar_pts[vi].lerp(shoulder_pts[vi], 0.55) + Vector((0, 0, 0.006 * H))
            elif ring_idx == 2:
                p = shoulder_pts[vi]
            else:
                u = (ring_idx - 2) / 3.0
                p = shoulder_pts[vi].lerp(hem_pts[vi], u)
                # Keep front/back chest clearing cleanly forward of ribcage while remaining razor-flat!
                p = p + Vector((0.0, 0.005 * H * math.sin(u * math.pi) * (-1.0 if p.y < 0 else 1.0), 0.0))
            row.append(bm.verts.new(p))
        grid.append(row)

    for ri in range(len(grid) - 1):
        for vi in range(n_ring):
            vn = (vi + 1) % n_ring
            f = bm.faces.new((grid[ri][vi], grid[ri][vn], grid[ri + 1][vn], grid[ri + 1][vi]))
            # Crisp faceted stylized low-poly origami planes on lower cape, smooth over collar/shoulders!
            f.smooth = ri < 2
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    me_p = bpy.data.meshes.new("Zephyr_Poncho")
    bm.to_mesh(me_p)
    bm.free()
    poncho = bpy.data.objects.new("Zephyr_Poncho", me_p)
    bpy.context.scene.collection.objects.link(poncho)
    sol = poncho.modifiers.new("Solidify", "SOLIDIFY")
    sol.thickness = 0.009 * H
    sol.offset = 1.0
    sol.use_rim = True
    bpy.ops.object.select_all(action="DESELECT")
    poncho.select_set(True)
    bpy.context.view_layer.objects.active = poncho
    bpy.ops.object.modifier_apply(modifier=sol.name)

    # Swirling twin wind-scarf ribbons streaming cleanly off the back hood collar (Scarf.0 -> Scarf.1 -> Scarf.2!)
    rib_parts: list[bpy.types.Object] = []
    for idx, (x_s, z_s, l_y) in enumerate(((0.032, 0.010, 0.34), (-0.026, -0.014, 0.28))):
        s0 = lm["neck"] + Vector((x_s * H, 0.068 * H, z_s * H))
        rings = []
        for i in range(8):
            t = i / 7.0
            pos = s0 + Vector((
                (0.055 * math.sin(t * math.pi * 1.6) + x_s * 0.8 * t) * H,
                l_y * H * (t ** 0.90),
                (0.048 * math.sin(t * math.pi * 1.4) - 0.095 * (t ** 1.3)) * H,
            ))
            tang = Vector((0.20 * math.cos(t * math.pi * 1.6), 0.90, 0.15 * math.cos(t * math.pi * 1.4) - 0.25))
            w = (0.018 + 0.010 * math.sin(t * math.pi)) * H * (1.0 - 0.65 * (t ** 2.0))
            rings.append((pos, tang, w, 0.005 * H, 0.14))
        rib_parts.append(loft_tube(f"Zephyr_WindRib_{idx}", rings, n_sides=6, cap_start=True, cap_end=True))
    wind_ribbons = _join_objs(rib_parts, "Zephyr_WindRibbons")
    return poncho, wind_ribbons


def build_zephyr_winged_boots(lm: dict[str, Vector]) -> tuple[bpy.types.Object, bpy.types.Object]:
    """Build Zephyr's sleek tapered ninja sky-runner boots (cleanly enveloping feet, ZERO skin poke-through!) + 3-feather Hermes wings."""
    H = lm["height"].z
    boot_parts: list[bpy.types.Object] = []
    wing_parts: list[bpy.types.Object] = []

    for side, sfx in (("l", "L"), ("r", "R")):
        sign = 1.0 if sfx == "L" else -1.0
        ankle = lm[f"ankle_{side}"]
        toe = lm[f"toe_{side}"]
        # Sleek sculpted lofted tapered sky-runner boot cleanly enclosing foot instep & toe!
        b_rings = [
            (Vector((ankle.x, ankle.y + 0.028 * H, 0.036 * H)), Vector((0.0, -1.0, -0.05)), 0.036 * H, 0.034 * H, 0.10),
            (Vector((ankle.x, 0.5 * (ankle.y + toe.y), 0.031 * H)), Vector((0.0, -1.0, -0.06)), 0.038 * H, 0.032 * H, 0.12),
            (Vector((ankle.x, toe.y - 0.014 * H, 0.023 * H)), Vector((0.0, -1.0, -0.05)), 0.028 * H, 0.022 * H, 0.18),
            (Vector((ankle.x, toe.y - 0.042 * H, 0.018 * H)), Vector((0.0, -1.0, 0.0)), 0.011 * H, 0.010 * H, 0.22),
        ]
        boot_parts.append(loft_tube(f"Zephyr_BootFoot_{sfx}", b_rings, n_sides=8, sharp_creases=True))
        # Snug angled ankle boot collar
        c_rings = [
            (ankle + Vector((0.0, 0.002 * H, -0.014 * H)), Vector((0.0, 0.0, 1.0)), 0.040 * H, 0.044 * H, 0.08),
            (ankle + Vector((0.0, 0.004 * H, 0.050 * H)), Vector((0.0, 0.0, 1.0)), 0.042 * H, 0.046 * H, 0.12),
        ]
        boot_parts.append(loft_tube(f"Zephyr_BootCuff_{sfx}", c_rings, n_sides=8, sharp_creases=True))

        # Bold sculpted 3-feather swept-up Hermes-style ivory/mint wings flaring off outer ankle!
        for fi, (fz, flen, fang) in enumerate(((0.044, 0.115, 0.68), (0.026, 0.092, 0.44), (0.010, 0.068, 0.22))):
            w_root = ankle + Vector((0.038 * H * sign, 0.014 * H, fz * H))
            w_rings = [
                (w_root, Vector((0.28 * sign, 0.78, fang)), 0.005 * H, 0.015 * H, 0.22),
                (w_root + Vector((0.026 * H * sign, flen * 0.55 * H, fang * flen * 0.58 * H)), Vector((0.32 * sign, 0.75, fang + 0.14)), 0.004 * H, 0.022 * H, 0.28),
                (w_root + Vector((0.048 * H * sign, flen * H, fang * flen * 1.08 * H)), Vector((0.38 * sign, 0.70, fang + 0.28)), 0.002 * H, 0.004 * H, 0.34),
            ]
            wing_parts.append(loft_tube(f"Zephyr_Wing_{sfx}_{fi}", w_rings, n_sides=6, sharp_creases=True))

    return _join_objs(boot_parts, "Zephyr_Boots"), _join_objs(wing_parts, "Zephyr_AnkleWings")


def build_zephyr_gale_staff(lm: dict[str, Vector]) -> tuple[bpy.types.Object, bpy.types.Object]:
    """Build Zephyr's iconic twin-tipped silver-mint Gale Staff aligned along Hand.R forearm thrust axis!

    Shifted slightly toward the upper (-axis) spearhead so BOTH blades frame her diagonal silhouette cleanly
    in Idle (matching Style B art) while thrusting razor-straight forward in Fheavy/Ftilt!
    """
    H = lm["height"].z
    axis = Vector((0.04, -0.14, -0.99)).normalized()
    grip = lm["hand_tip_r"] - axis * (0.14 * H)
    half_len = 0.56 * H

    shaft_parts: list[bpy.types.Object] = []
    blade_parts: list[bpy.types.Object] = []

    shaft_rings = [
        (grip - axis * half_len, axis, 0.010 * H, 0.010 * H, 0.05),
        (grip - axis * (half_len * 0.45), axis, 0.012 * H, 0.012 * H, 0.04),
        (grip + axis * (half_len * 0.45), axis, 0.012 * H, 0.012 * H, 0.04),
        (grip + axis * half_len, axis, 0.010 * H, 0.010 * H, 0.05),
    ]
    shaft_parts.append(loft_tube("Zephyr_StaffShaft", shaft_rings, n_sides=8, sharp_creases=True))

    for end_sign in (-1.0, 1.0):
        d = axis * end_sign
        base = grip + d * half_len
        collar_r = [
            (base - d * (0.024 * H), d, 0.019 * H, 0.019 * H, 0.14),
            (base + d * (0.010 * H), d, 0.022 * H, 0.015 * H, 0.22),
        ]
        shaft_parts.append(loft_tube(f"Zephyr_StaffCollar_{end_sign}", collar_r, n_sides=6, sharp_creases=True))
        blade_r = [
            (base + d * (0.008 * H), d, 0.018 * H, 0.010 * H, 0.26),
            (base + d * (0.056 * H), d, 0.040 * H, 0.013 * H, 0.34),
            (base + d * (0.140 * H), d, 0.020 * H, 0.008 * H, 0.36),
            (base + d * (0.208 * H), d, 0.003 * H, 0.002 * H, 0.38),
        ]
        blade_parts.append(loft_tube(f"Zephyr_StaffBlade_{end_sign}", blade_r, n_sides=6, sharp_creases=True))

    return _join_objs(shaft_parts, "Zephyr_StaffShaft"), _join_objs(blade_parts, "Zephyr_StaffBlades")
