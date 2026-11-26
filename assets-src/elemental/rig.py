"""Canonical 24-bone Smash Humanoid Armature + secondary physics chains + AAA skinning helpers.

Coordinate convention (Blender Z-up, -Y forward -> glTF Y-up, +Z forward):
  - Character stands centered at X=0, soles at Z=0, facing -Y.
  - Left side of character is +X, Right side of character is -X (anatomical convention facing -Y).
  - Canonical bones (24 core + 5 secondary = 29 bones total, mobile WebGL safe <= 32):
      Root -> Hips -> Spine -> Chest -> Neck -> Head -> (Flame0 -> Flame1)
           -> Chest -> Shoulder.L/R -> UpperArm.L/R -> Forearm.L/R -> Hand.L/R -> Weapon.R
           -> Chest -> Scarf0 -> Scarf1 -> Scarf2
           -> Hips  -> Thigh.L/R -> Shin.L/R -> Foot.L/R -> Toe.L/R
"""
from __future__ import annotations

import math
import bpy
from mathutils import Vector

CANONICAL_CORE_BONES: tuple[str, ...] = (
    "Root",
    "Hips",
    "Spine",
    "Chest",
    "Neck",
    "Head",
    "Shoulder.L",
    "UpperArm.L",
    "Forearm.L",
    "Hand.L",
    "Shoulder.R",
    "UpperArm.R",
    "Forearm.R",
    "Hand.R",
    "Weapon.R",
    "Thigh.L",
    "Shin.L",
    "Foot.L",
    "Toe.L",
    "Thigh.R",
    "Shin.R",
    "Foot.R",
    "Toe.R",
)

SECONDARY_BONES: tuple[str, ...] = (
    "Flame.0",
    "Flame.1",
    "Scarf.0",
    "Scarf.1",
    "Scarf.2",
)


def measure_landmarks(body_obj: bpy.types.Object) -> dict[str, Vector]:
    """Measure exact anatomical joint landmarks directly from a centered, Z=0 humanoid mesh."""
    vs = [body_obj.matrix_world @ v.co for v in body_obj.data.vertices]
    z_max = max(v.z for v in vs)
    # Normalize ratio lookups against real mesh height
    H = max(0.5, z_max)

    def band_avg(z_frac: float, x_min: float, x_max: float, tol: float = 0.032) -> Vector | None:
        z0 = z_frac * H
        pts = [v for v in vs if abs(v.z - z0) <= tol * H and x_min <= v.x <= x_max]
        if not pts:
            return None
        return sum(pts, Vector((0.0, 0.0, 0.0))) / len(pts)

    # Torso center line
    hips_z = 0.515 * H
    spine_z = 0.615 * H
    chest_z = 0.755 * H
    neck_z = 0.805 * H
    head_z = 0.865 * H
    crown_z = 0.995 * H

    # Arm landmarks (+X is anatomical Left when facing -Y)
    sh_l = band_avg(0.758, 0.14 * H, 0.30 * H, 0.028) or Vector((0.125 * H, 0.015 * H, 0.76 * H))
    el_l = band_avg(0.612, 0.14 * H, 0.36 * H, 0.030) or Vector((0.185 * H, 0.022 * H, 0.61 * H))
    wr_l = band_avg(0.492, 0.18 * H, 0.42 * H, 0.030) or Vector((0.232 * H, -0.008 * H, 0.49 * H))
    hd_l = band_avg(0.425, 0.18 * H, 0.44 * H, 0.032) or Vector((0.238 * H, -0.016 * H, 0.425 * H))

    # Keep upper-arm head nestled inside the actual deltoid socket
    upper_arm_l = Vector((max(0.095 * H, sh_l.x * 0.78), sh_l.y, 0.768 * H))
    elbow_l = Vector((el_l.x, max(el_l.y, 0.015 * H), el_l.z))
    wrist_l = Vector((wr_l.x, wr_l.y, wr_l.z))
    hand_tip_l = Vector((hd_l.x, hd_l.y, min(hd_l.z, wrist_l.z - 0.06 * H)))

    # Leg landmarks (+X anatomical Left)
    hip_l = band_avg(0.495, 0.015 * H, 0.16 * H, 0.030) or Vector((0.056 * H, -0.005 * H, 0.495 * H))
    knee_l = band_avg(0.282, 0.015 * H, 0.18 * H, 0.028) or Vector((0.058 * H, -0.014 * H, 0.282 * H))
    ankle_l = band_avg(0.068, 0.015 * H, 0.20 * H, 0.026) or Vector((0.062 * H, 0.004 * H, 0.068 * H))
    toe_l = Vector((ankle_l.x * 1.06, -0.105 * H, 0.018 * H))

    def mirror_x(v: Vector) -> Vector:
        return Vector((-v.x, v.y, v.z))

    return {
        "height": Vector((0.0, 0.0, H)),
        "root": Vector((0.0, 0.0, 0.0)),
        "hips": Vector((0.0, hip_l.y, hips_z)),
        "spine": Vector((0.0, 0.0, spine_z)),
        "chest": Vector((0.0, 0.005 * H, chest_z)),
        "neck": Vector((0.0, 0.005 * H, neck_z)),
        "head": Vector((0.0, -0.005 * H, head_z)),
        "crown": Vector((0.0, 0.005 * H, crown_z)),
        "clavicle_l": Vector((0.028 * H, 0.005 * H, 0.768 * H)),
        "upper_arm_l": upper_arm_l,
        "elbow_l": elbow_l,
        "wrist_l": wrist_l,
        "hand_tip_l": hand_tip_l,
        "clavicle_r": mirror_x(Vector((0.028 * H, 0.005 * H, 0.768 * H))),
        "upper_arm_r": mirror_x(upper_arm_l),
        "elbow_r": mirror_x(elbow_l),
        "wrist_r": mirror_x(wrist_l),
        "hand_tip_r": mirror_x(hand_tip_l),
        "hip_l": Vector((max(0.048 * H, hip_l.x), hip_l.y, 0.492 * H)),
        "knee_l": Vector((knee_l.x, min(knee_l.y, -0.008 * H), knee_l.z)),
        "ankle_l": ankle_l,
        "toe_l": toe_l,
        "hip_r": mirror_x(Vector((max(0.048 * H, hip_l.x), hip_l.y, 0.492 * H))),
        "knee_r": mirror_x(Vector((knee_l.x, min(knee_l.y, -0.008 * H), knee_l.z))),
        "ankle_r": mirror_x(ankle_l),
        "toe_r": mirror_x(toe_l),
    }


def build_canonical_armature(
    name: str,
    lm: dict[str, Vector],
    include_flame_chain: bool = True,
    include_scarf_chain: bool = True,
) -> bpy.types.Object:
    """Create the canonical 24-bone Smash humanoid armature + optional secondary physics chains."""
    H = lm["height"].z
    arm = bpy.data.armatures.new(f"ARM_{name}")
    arm_obj = bpy.data.objects.new(f"RIG_{name}", arm)
    bpy.context.scene.collection.objects.link(arm_obj)
    bpy.context.view_layer.objects.active = arm_obj
    bpy.ops.object.mode_set(mode="EDIT")

    def add_bone(
        bname: str,
        head: Vector,
        tail: Vector,
        parent_name: str | None,
        connected: bool = False,
        deform: bool = True,
        roll: float = 0.0,
    ) -> bpy.types.EditBone:
        b = arm.edit_bones.new(bname)
        b.head = head.copy()
        if (tail - head).length < 1e-4:
            tail = head + Vector((0.0, 0.0, 0.05))
        b.tail = tail.copy()
        b.use_deform = deform
        b.roll = roll
        if parent_name is not None:
            b.parent = arm.edit_bones[parent_name]
            b.use_connect = connected
        return b

    # Core spine hierarchy
    add_bone("Root", Vector((0, 0, 0)), Vector((0, -0.18 * H, 0)), None, False, deform=False)
    add_bone("Hips", lm["hips"], lm["spine"], "Root", False)
    add_bone("Spine", lm["spine"], lm["chest"], "Hips", True)
    add_bone("Chest", lm["chest"], lm["neck"], "Spine", True)
    add_bone("Neck", lm["neck"], lm["head"], "Chest", True)
    add_bone("Head", lm["head"], lm["crown"], "Neck", True)

    # Secondary flame/hair crown chain
    if include_flame_chain:
        f0_head = lm["crown"] + Vector((0.0, 0.015 * H, -0.02 * H))
        f0_tail = f0_head + Vector((0.0, 0.05 * H, 0.11 * H))
        f1_tail = f0_tail + Vector((0.0, 0.09 * H, 0.10 * H))
        add_bone("Flame.0", f0_head, f0_tail, "Head", False)
        add_bone("Flame.1", f0_tail, f1_tail, "Flame.0", True)

    # Secondary billowing scarf/cape chain (draping gracefully down-and-back +Y from upper back)
    if include_scarf_chain:
        s0 = lm["neck"] + Vector((0.02 * H, 0.075 * H, -0.015 * H))
        s1 = s0 + Vector((0.03 * H, 0.11 * H, 0.015 * H))
        s2 = s1 + Vector((0.02 * H, 0.12 * H, -0.065 * H))
        s3 = s2 + Vector((0.01 * H, 0.11 * H, -0.110 * H))
        add_bone("Scarf.0", s0, s1, "Chest", False)
        add_bone("Scarf.1", s1, s2, "Scarf.0", True)
        add_bone("Scarf.2", s2, s3, "Scarf.1", True)

    # Arms (L = +X, R = -X)
    for side, sfx in (("l", "L"), ("r", "R")):
        add_bone(f"Shoulder.{sfx}", lm[f"clavicle_{side}"], lm[f"upper_arm_{side}"], "Chest", False)
        add_bone(f"UpperArm.{sfx}", lm[f"upper_arm_{side}"], lm[f"elbow_{side}"], f"Shoulder.{sfx}", True)
        add_bone(f"Forearm.{sfx}", lm[f"elbow_{side}"], lm[f"wrist_{side}"], f"UpperArm.{sfx}", True)
        add_bone(f"Hand.{sfx}", lm[f"wrist_{side}"], lm[f"hand_tip_{side}"], f"Forearm.{sfx}", True)

    # Weapon socket on right hand (-X)
    wr_r = lm["wrist_r"]
    add_bone("Weapon.R", lm["hand_tip_r"], lm["hand_tip_r"] + Vector((0.0, -0.18 * H, 0.0)), "Hand.R", False, deform=True)

    # Legs (L = +X, R = -X)
    for side, sfx in (("l", "L"), ("r", "R")):
        add_bone(f"Thigh.{sfx}", lm[f"hip_{side}"], lm[f"knee_{side}"], "Hips", False)
        add_bone(f"Shin.{sfx}", lm[f"knee_{side}"], lm[f"ankle_{side}"], f"Thigh.{sfx}", True)
        add_bone(f"Foot.{sfx}", lm[f"ankle_{side}"], lm[f"toe_{side}"], f"Shin.{sfx}", True)
        toe_tip = lm[f"toe_{side}"] + Vector((0.0, -0.055 * H, 0.0))
        add_bone(f"Toe.{sfx}", lm[f"toe_{side}"], toe_tip, f"Foot.{sfx}", True)

    bpy.ops.object.mode_set(mode="OBJECT")
    arm_obj.show_in_front = True
    return arm_obj


def assign_smooth_capsule_weights(
    mesh_obj: bpy.types.Object,
    arm_obj: bpy.types.Object,
    bone_names: list[str] | None = None,
    falloff: float = 4.2,
    max_influences: int = 4,
) -> None:
    """Deterministic distance-to-bone-segment smooth skinning (used as reliable fallback or accessory binder)."""
    arm = arm_obj.data
    bones = [b for b in arm.bones if b.use_deform and (bone_names is None or b.name in bone_names)]
    for b in bones:
        if b.name not in mesh_obj.vertex_groups:
            mesh_obj.vertex_groups.new(name=b.name)

    segs = [(b.name, arm_obj.matrix_world @ b.head_local, arm_obj.matrix_world @ b.tail_local) for b in bones]
    M = mesh_obj.matrix_world

    for v in mesh_obj.data.vertices:
        p = M @ v.co
        scored: list[tuple[float, str]] = []
        for bname, a, b in segs:
            ab = b - a
            ab_len2 = ab.length_squared
            t = 0.0 if ab_len2 < 1e-8 else max(0.0, min(1.0, (p - a).dot(ab) / ab_len2))
            closest = a + ab * t
            d = (p - closest).length
            # Side affinity guard so left arm/leg never pulls right arm/leg across X=0
            if bname.endswith(".L") and p.x < -0.015:
                d += 1.5
            elif bname.endswith(".R") and p.x > 0.015:
                d += 1.5
            # Separate arms from torso smoothly when near shoulder/hip
            w = 1.0 / (0.0025 + (d ** falloff))
            scored.append((w, bname))
        scored.sort(key=lambda x: x[0], reverse=True)
        top = scored[:max_influences]
        s = sum(w for w, _ in top)
        if s <= 1e-12:
            continue
        for w, bname in top:
            nw = w / s
            if nw >= 0.01:
                mesh_obj.vertex_groups[bname].add([v.index], nw, "REPLACE")


def skin_body_automatic(body_obj: bpy.types.Object, arm_obj: bpy.types.Object) -> None:
    """Bind anatomical body mesh to armature via Blender Heat-Diffusion Automatic Weights (with safe verification)."""
    bpy.ops.object.select_all(action="DESELECT")
    body_obj.select_set(True)
    arm_obj.select_set(True)
    bpy.context.view_layer.objects.active = arm_obj
    # Temporarily exclude secondary chains from body heat-weights so Scarf/Flame don't pull the torso!
    disabled: list[bpy.types.Bone] = []
    for b in arm_obj.data.bones:
        if b.name.startswith(("Scarf.", "Flame.", "Weapon.")):
            b.use_deform = False
            disabled.append(b)
    try:
        bpy.ops.object.parent_set(type="ARMATURE_AUTO")
    except RuntimeError:
        bpy.ops.object.parent_set(type="ARMATURE")
        assign_smooth_capsule_weights(body_obj, arm_obj, [b.name for b in arm_obj.data.bones if b.use_deform])
    finally:
        for b in disabled:
            b.use_deform = True

    # Verify every vertex received valid weights; patch any unweighted verts via nearest bone
    unweighted = [v.index for v in body_obj.data.vertices if len(v.groups) == 0]
    if unweighted:
        allowed = [b.name for b in arm_obj.data.bones if b.use_deform and not b.name.startswith(("Scarf.", "Flame.", "Weapon."))]
        assign_smooth_capsule_weights(body_obj, arm_obj, allowed)

    # Limit to 4 bone influences per vertex (glTF / WebGL hardware skinning standard) and normalize
    bpy.ops.object.select_all(action="DESELECT")
    body_obj.select_set(True)
    bpy.context.view_layer.objects.active = body_obj
    bpy.ops.object.vertex_group_limit_total(group_select_mode="ALL", limit=4)
    bpy.ops.object.vertex_group_normalize_all(group_select_mode="ALL", lock_active=False)


def transfer_skin_weights(
    source_body: bpy.types.Object,
    garment_obj: bpy.types.Object,
    arm_obj: bpy.types.Object,
    exclude_prefixes: tuple[str, ...] = (),
    fallback_bone: str = "Chest",
) -> None:
    """Transfer clean anatomical weights from rigged body onto sculpted garments via Nearest-Face interpolation."""
    garment_obj.vertex_groups.clear()
    for vg in source_body.vertex_groups:
        garment_obj.vertex_groups.new(name=vg.name)

    mod = garment_obj.modifiers.new("WeightTransfer", "DATA_TRANSFER")
    mod.object = source_body
    mod.use_vert_data = True
    mod.data_types_verts = {"VGROUP_WEIGHTS"}
    mod.vert_mapping = "POLYINTERP_NEAREST"

    bpy.ops.object.select_all(action="DESELECT")
    garment_obj.select_set(True)
    bpy.context.view_layer.objects.active = garment_obj
    bpy.ops.object.modifier_apply(modifier=mod.name)

    if exclude_prefixes:
        bad_vgs = [vg for vg in garment_obj.vertex_groups if vg.name.startswith(exclude_prefixes)]
        all_idx = [v.index for v in garment_obj.data.vertices]
        for bvg in bad_vgs:
            bvg.remove(all_idx)
        fb = garment_obj.vertex_groups.get(fallback_bone)
        if fb is not None:
            for v in garment_obj.data.vertices:
                if sum(g.weight for g in v.groups) < 1e-4:
                    fb.add([v.index], 1.0, "REPLACE")

    bpy.ops.object.vertex_group_limit_total(group_select_mode="ALL", limit=4)
    bpy.ops.object.vertex_group_normalize_all(group_select_mode="ALL", lock_active=False)

    garment_obj.parent = arm_obj
    arm_mod = garment_obj.modifiers.new("Armature", "ARMATURE")
    arm_mod.object = arm_obj


def bind_rigid_to_bone(mesh_obj: bpy.types.Object, arm_obj: bpy.types.Object, bone_name: str) -> None:
    """Bind a sculpted rigid accessory (e.g. armored gauntlet or helm) 100% cleanly to a single bone."""
    mesh_obj.vertex_groups.clear()
    vg = mesh_obj.vertex_groups.new(name=bone_name)
    vg.add([v.index for v in mesh_obj.data.vertices], 1.0, "REPLACE")
    mesh_obj.parent = arm_obj
    arm_mod = mesh_obj.modifiers.new("Armature", "ARMATURE")
    arm_mod.object = arm_obj


def bind_chain_graduated(
    mesh_obj: bpy.types.Object,
    arm_obj: bpy.types.Object,
    chain_bones: list[str],
    axis_start: Vector,
    axis_end: Vector,
) -> None:
    """Smoothly blend skin weights along a secondary bone chain (scarf tail, flame hair crest, water ribbon)."""
    mesh_obj.vertex_groups.clear()
    vgs = [mesh_obj.vertex_groups.new(name=bn) for bn in chain_bones]
    span = axis_end - axis_start
    span_len2 = max(1e-6, span.length_squared)
    n = len(chain_bones)
    M = mesh_obj.matrix_world
    for v in mesh_obj.data.vertices:
        p = M @ v.co
        t = max(0.0, min(1.0, (p - axis_start).dot(span) / span_len2))
        pos = t * (n - 1)
        i0 = min(n - 1, int(math.floor(pos)))
        i1 = min(n - 1, i0 + 1)
        f = pos - i0
        if i0 == i1:
            vgs[i0].add([v.index], 1.0, "REPLACE")
        else:
            vgs[i0].add([v.index], 1.0 - f, "REPLACE")
            vgs[i1].add([v.index], f, "REPLACE")
    mesh_obj.parent = arm_obj
    arm_mod = mesh_obj.modifiers.new("Armature", "ARMATURE")
    arm_mod.object = arm_obj


def clean_pelvis_and_leg_weights(mesh_obj: bpy.types.Object, H: float) -> None:
    """Enforce AAA fighting-game pelvis/leg skinning: smooth Hips crotch saddle + topological weight blur + strict leg split."""
    hips_vg = mesh_obj.vertex_groups.get("Hips")
    for v in mesh_obj.data.vertices:
        z = v.co.z
        ax = abs(v.co.x)
        # 1) Crotch saddle zone (0.35*H..0.55*H near X=0): covers BOTH male (0.42*H) & female (0.48*H) pelvis inseams!
        if 0.35 * H <= z <= 0.55 * H and ax < 0.072 * H and hips_vg is not None:
            tx = 1.0 - (ax / (0.072 * H))
            tz = math.sin(min(1.0, max(0.0, (z - 0.35 * H) / (0.20 * H))) * math.pi)
            hips_w = 5.5 * (tx * tx) * max(0.30, tz)
            hips_vg.add([v.index], hips_w, "ADD")
        # 2) Strictly below crotch saddle (z < 0.35*H): left and right legs are separate tubes -> zero cross-leg influence!
        if z < 0.35 * H:
            wrong_sfx = ".R" if v.co.x >= 0.0 else ".L"
            right_sfx = "L" if v.co.x >= 0.0 else "R"
            for vg in mesh_obj.vertex_groups:
                if vg.name.endswith(wrong_sfx):
                    vg.remove([v.index])
            if sum(g.weight for g in v.groups) < 1e-4:
                fallback = f"Shin.{right_sfx}" if z < 0.28 * H else f"Thigh.{right_sfx}"
                if fallback in mesh_obj.vertex_groups:
                    mesh_obj.vertex_groups[fallback].add([v.index], 1.0, "REPLACE")
    # Deterministic headless Laplacian weight smooth across connected mesh edges (eliminates sharp crotch/hip cliffs!)
    n_verts = len(mesh_obj.data.vertices)
    adj: list[list[int]] = [[] for _ in range(n_verts)]
    for e in mesh_obj.data.edges:
        a, b = e.vertices[0], e.vertices[1]
        adj[a].append(b)
        adj[b].append(a)
    vg_names = [vg.name for vg in mesh_obj.vertex_groups]
    weights: list[dict[str, float]] = [
        {vg_names[g.group]: g.weight for g in v.groups if g.weight > 1e-5}
        for v in mesh_obj.data.vertices
    ]
    for _ in range(3):
        nxt: list[dict[str, float]] = []
        for vi in range(n_verts):
            nbrs = adj[vi]
            if not nbrs:
                nxt.append(weights[vi])
                continue
            acc: dict[str, float] = {k: val * 0.5 for k, val in weights[vi].items()}
            inv_n = 0.5 / len(nbrs)
            for ni in nbrs:
                for k, val in weights[ni].items():
                    acc[k] = acc.get(k, 0.0) + val * inv_n
            nxt.append(acc)
        weights = nxt
    for vg in mesh_obj.vertex_groups:
        vg.remove(list(range(n_verts)))
    for vi, wmap in enumerate(weights):
        v_co = mesh_obj.data.vertices[vi].co
        wrong_sfx = (".R" if v_co.x >= 0.0 else ".L") if v_co.z < 0.34 * H else ""
        items = [(k, w) for k, w in wmap.items() if w > 1e-4 and (not wrong_sfx or not k.endswith(wrong_sfx))]
        items.sort(key=lambda kv: kv[1], reverse=True)
        items = items[:4]
        tot = sum(w for _, w in items)
        if tot > 1e-5:
            for k, w in items:
                mesh_obj.vertex_groups[k].add([vi], w / tot, "REPLACE")


def bind_lr_by_component(mesh_obj: bpy.types.Object, arm_obj: bpy.types.Object, bone_l: str, bone_r: str) -> None:
    """Bind symmetric L/R rigid armor pieces atomically per connected mesh island (impossible to split across X=0!)."""
    n_verts = len(mesh_obj.data.vertices)
    adj: list[list[int]] = [[] for _ in range(n_verts)]
    for e in mesh_obj.data.edges:
        a, b = e.vertices[0], e.vertices[1]
        adj[a].append(b)
        adj[b].append(a)
    mesh_obj.vertex_groups.clear()
    vgl = mesh_obj.vertex_groups.new(name=bone_l)
    vgr = mesh_obj.vertex_groups.new(name=bone_r)
    visited = [False] * n_verts
    for start in range(n_verts):
        if visited[start]:
            continue
        comp: list[int] = []
        stack = [start]
        visited[start] = True
        while stack:
            cur = stack.pop()
            comp.append(cur)
            for nb in adj[cur]:
                if not visited[nb]:
                    visited[nb] = True
                    stack.append(nb)
        avg_x = sum(mesh_obj.data.vertices[vi].co.x for vi in comp) / max(1, len(comp))
        (vgl if avg_x >= 0.0 else vgr).add(comp, 1.0, "REPLACE")
    mesh_obj.parent = arm_obj
    mod = mesh_obj.modifiers.new("Armature", "ARMATURE")
    mod.object = arm_obj
