"""Build Style B Fire Fighter ('IGNIS') Vertical Slice -> rigged GLB + 60fps Smash clips + Checkpoint 2 visual sheets.

Run via:
  blender --background --python assets-src/elemental/build_ignis.py
"""
from __future__ import annotations

import json
import math
import os
import sys
import bpy
from mathutils import Vector

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
ROOT_DIR = os.path.abspath(os.path.join(SCRIPT_DIR, "..", ".."))
if SCRIPT_DIR not in sys.path:
    sys.path.insert(0, SCRIPT_DIR)

from mesh_craft import (
    apply_baked_material,
    assign_material_tag,
    bake_stylized_cel_textures,
    build_combat_sandals,
    build_ember_scarf,
    build_living_flame_head,
    build_molten_gauntlet,
    extract_surface_shell,
    load_cc0_stylized_body,
    make_beveled_block,
    reset_scene,
    sculpt_hero_proportions,
    set_smooth_and_weighted_normals,
    trim_body_regions,
)
from rig import (
    bind_chain_graduated,
    bind_rigid_to_bone,
    build_canonical_armature,
    clean_pelvis_and_leg_weights,
    measure_landmarks,
    skin_body_automatic,
    transfer_skin_weights,
)
from smash_anims import SmashPoseCompiler, build_ignis_moveset
from eval_render import render_vertical_slice_sheets


def load_earl_move_frames() -> dict[str, tuple[int, int, int]]:
    """Read slot-0 fighter's real startup/active/total frame counts from data/fighters.json so clips sync 1:1."""
    path = os.path.join(ROOT_DIR, "data", "fighters.json")
    if not os.path.isfile(path):
        return {}
    raw = json.load(open(path, "r", encoding="utf-8"))
    earl = raw.get("earl")
    if not isinstance(earl, dict):
        return {}
    out: dict[str, tuple[int, int, int]] = {}
    for m in earl.get("moves", []):
        mid = str(m.get("id", ""))
        key = mid[0].upper() + mid[1:] if mid else ""
        out[key] = (int(m.get("startup", 6)), int(m.get("active", 4)), int(m.get("total", 24)))
    return out


def build_ignis() -> None:
    out_dir = os.path.join(SCRIPT_DIR, "out", "ignis")
    os.makedirs(out_dir, exist_ok=True)

    reset_scene()

    # 1. Load Blender Studio official CC0 Stylized Male Humanoid (zero primitives!)
    body = load_cc0_stylized_body("GEO-body_male_stylized", target_height=1.64, unsubdiv_iters=2)
    sculpt_hero_proportions(body, shoulder_w=1.14, waist_w=0.88, chest_depth=1.08, leg_musc=1.08, arm_musc=1.12)
    lm = measure_landmarks(body)
    H = lm["height"].z

    # 2. Extract sculpted martial-arts garments directly off the real anatomical CC0 body surface!
    def _vneck_half_w(z: float) -> float:
        # Crisp martial-arts V-neck widening diagonally from obi belt (0.57*H) up to collarbone (0.80*H)
        return (0.008 + 0.29 * max(0.0, (z - 0.575 * H) / H)) * H

    # 2a) Sleeveless charcoal fighting gi tunic (clean sleeveless armholes at abs(x) <= 0.132*H, V-neck cut out, tucked cleanly at waist!)
    gi_top = extract_surface_shell(
        body,
        "Ignis_GiTop",
        lambda c, n: (0.535 * H <= c.z <= 0.802 * H)
        and (abs(c.x) <= 0.132 * H)
        and not (c.y < -0.01 * H and abs(c.x) < _vneck_half_w(c.z)),
        offset=0.015,
        thickness=0.014,
        crease_amp=0.003,
    )
    # 2b) Crisp diagonal flame-orange gi lapel V-neck collar trim framing the V-opening right down to the obi belt!
    gi_trim = extract_surface_shell(
        body,
        "Ignis_GiTrim",
        lambda c, n: (0.565 * H <= c.z <= 0.798 * H)
        and (c.y < -0.01 * H)
        and (_vneck_half_w(c.z) - 0.008 * H <= abs(c.x) <= _vneck_half_w(c.z) + 0.024 * H)
        and (abs(c.x) <= 0.125 * H),
        offset=0.029,
        thickness=0.009,
    )
    # 2c) Baggy martial-arts gi trousers (tucked cleanly under obi belt down to mid-calf, zero hip overlap with gi_top!)
    gi_pants = extract_surface_shell(
        body,
        "Ignis_GiPants",
        lambda c, n: (0.195 * H <= c.z <= 0.558 * H) and (abs(c.x) <= 0.175 * H),
        offset=0.018,
        thickness=0.014,
        flare_fn=lambda p, n: Vector((
            p.x + math.copysign(0.016 * H * math.sin(min(1.0, max(0.0, (p.z - 0.195 * H) / (0.34 * H))) * math.pi), p.x)
            if abs(p.x) > 0.025 * H else p.x,
            p.y * 1.10,
            p.z,
        )),
        crease_amp=0.004,
    )
    # 2d) Bandaged shin wraps (ankle to mid-calf!)
    shin_wraps = extract_surface_shell(
        body,
        "Ignis_ShinWraps",
        lambda c, n: (0.055 * H <= c.z <= 0.215 * H) and (abs(c.x) <= 0.175 * H),
        offset=0.011,
        thickness=0.010,
        crease_amp=0.003,
    )
    # 2e) Tied crimson-black martial-arts obi waist sash belt + knot + twin hanging sash tails
    obi_belt = extract_surface_shell(
        body,
        "Ignis_ObiBelt",
        lambda c, n: (0.525 * H <= c.z <= 0.592 * H) and (abs(c.x) <= 0.155 * H),
        offset=0.032,
        thickness=0.016,
    )
    belt_knot = make_beveled_block(
        "Ignis_BeltKnot",
        (0.070 * H, 0.048 * H, 0.058 * H),
        Vector((0.0, -0.106 * H, 0.552 * H)),
        bevel_width=0.009 * H,
        bevel_segs=1,
    )
    belt_tail_l = make_beveled_block(
        "Ignis_BeltTailL",
        (0.032 * H, 0.014 * H, 0.155 * H),
        Vector((0.042 * H, -0.118 * H, 0.468 * H)),
        rot_euler=(0.12, -0.24, 0.0),
        bevel_width=0.003 * H,
        bevel_segs=1,
        taper_z=(1.15, 0.72),
    )
    belt_tail_r = make_beveled_block(
        "Ignis_BeltTailR",
        (0.030 * H, 0.014 * H, 0.132 * H),
        Vector((-0.034 * H, -0.120 * H, 0.478 * H)),
        rot_euler=(0.10, 0.18, 0.0),
        bevel_width=0.003 * H,
        bevel_segs=1,
        taper_z=(1.12, 0.75),
    )

    # 3. Build iconic Style B sculpted hero features!
    flame_head, eyes, eye_frames = build_living_flame_head(lm)
    scarf_collar, scarf_tail = build_ember_scarf(lm)
    gauntlet_l, lava_l = build_molten_gauntlet("L", lm["elbow_l"], lm["wrist_l"], lm["hand_tip_l"], H)
    gauntlet_r, lava_r = build_molten_gauntlet("R", lm["elbow_r"], lm["wrist_r"], lm["hand_tip_r"], H)
    sandals = build_combat_sandals(lm)

    # 4. Assign stylized Style B Fire color palette & emissive markers for Cycles texture baking
    assign_material_tag(body, "M_Skin", (0.98, 0.56, 0.18, 1.0), emissive=0.0)         # warm sunlit ember-tanned arms/chest
    assign_material_tag(gi_top, "M_GiCharcoal", (0.26, 0.25, 0.29, 1.0), emissive=0.0) # rich charcoal fighting gi (shows cel bands!)
    assign_material_tag(gi_pants, "M_GiPants", (0.27, 0.26, 0.30, 1.0), emissive=0.0)
    assign_material_tag(gi_trim, "M_GiOrange", (0.98, 0.44, 0.06, 1.0), emissive=0.0)  # vibrant flame-orange V-neck lapel trim
    assign_material_tag(obi_belt, "M_Belt", (0.16, 0.14, 0.18, 1.0), emissive=0.0)
    assign_material_tag(belt_knot, "M_BeltKnot", (0.16, 0.14, 0.18, 1.0), emissive=0.0)
    assign_material_tag(belt_tail_l, "M_BeltTailL", (0.17, 0.15, 0.19, 1.0), emissive=0.0)
    assign_material_tag(belt_tail_r, "M_BeltTailR", (0.96, 0.43, 0.06, 1.0), emissive=0.0)
    assign_material_tag(shin_wraps, "M_Wraps", (0.68, 0.62, 0.54, 1.0), emissive=0.0)  # warm ash-linen shin wraps
    assign_material_tag(sandals, "M_Sandals", (0.36, 0.22, 0.15, 1.0), emissive=0.0)
    assign_material_tag(scarf_collar, "M_Scarf", (0.84, 0.20, 0.10, 1.0), emissive=0.0)# crimson martial-arts scarf
    assign_material_tag(scarf_tail, "M_ScarfTail", (0.84, 0.20, 0.10, 1.0), emissive=0.0)
    assign_material_tag(flame_head, "M_FlameHead", (1.00, 0.62, 0.10, 1.0), emissive=1.3)
    assign_material_tag(eyes, "M_Eyes", (1.00, 1.00, 0.96, 1.0), emissive=2.0)         # fierce incandescent white eyes!
    assign_material_tag(eye_frames, "M_EyeFrames", (0.05, 0.03, 0.05, 1.0), emissive=0.0)
    assign_material_tag(gauntlet_l, "M_BronzeL", (0.62, 0.36, 0.16, 1.0), emissive=0.0, metallic=0.65)
    assign_material_tag(gauntlet_r, "M_BronzeR", (0.62, 0.36, 0.16, 1.0), emissive=0.0, metallic=0.65)
    assign_material_tag(lava_l, "M_LavaL", (1.00, 0.64, 0.08, 1.0), emissive=1.8)      # molten glowing gauntlet cores!
    assign_material_tag(lava_r, "M_LavaR", (1.00, 0.64, 0.08, 1.0), emissive=1.8)

    # 5. Build canonical 28-bone Smash humanoid armature & apply AAA skinning on COMPLETE untrimmed anatomy FIRST!
    arm_obj = build_canonical_armature("ignis", lm, include_flame_chain=True, include_scarf_chain=True)
    skin_body_automatic(body, arm_obj)

    # Transfer complete anatomical weights onto sculpted garments via DATA_TRANSFER BEFORE trimming hidden body faces!
    for garment in (gi_top, gi_trim, obi_belt, belt_knot, scarf_collar):
        transfer_skin_weights(body, garment, arm_obj, exclude_prefixes=("UpperArm.", "Forearm.", "Hand."), fallback_bone="Chest")
    for garment in (gi_pants, shin_wraps):
        transfer_skin_weights(body, garment, arm_obj, exclude_prefixes=("UpperArm.", "Forearm.", "Hand."), fallback_bone="Hips")
    for bt in (belt_tail_l, belt_tail_r):
        bind_rigid_to_bone(bt, arm_obj, "Hips")
    # Bind sandals strictly to Foot.L / Foot.R so wooden soles stay crisp & rigid at extreme ankle flex!
    sandals.vertex_groups.clear()
    vg_fl = sandals.vertex_groups.new(name="Foot.L")
    vg_fr = sandals.vertex_groups.new(name="Foot.R")
    for v in sandals.data.vertices:
        (vg_fl if v.co.x >= 0.0 else vg_fr).add([v.index], 1.0, "REPLACE")
    sandals.parent = arm_obj
    s_mod = sandals.modifiers.new("Armature", "ARMATURE")
    s_mod.object = arm_obj

    # Enforce AAA pelvis crotch anchoring + strict L/R leg weight isolation below crotch!
    for leg_garment in (body, gi_pants, shin_wraps):
        clean_pelvis_and_leg_weights(leg_garment, H)

    # Now safely trim hidden body faces (human head, hands inside gauntlets, thighs inside gi trousers)
    trim_body_regions(
        body,
        lambda c: (c.z > 0.818 * H)
        or (abs(c.x) > 0.185 * H and c.z < 0.56 * H)
        or (0.205 * H < c.z < 0.525 * H and abs(c.x) < 0.175 * H),
    )

    # Bind flame head across Head -> Flame.0 -> Flame.1 so crest whips dynamically!
    bind_chain_graduated(
        flame_head,
        arm_obj,
        ["Head", "Flame.0", "Flame.1"],
        lm["head"] + Vector((0.0, 0.0, 0.04 * H)),
        lm["crown"] + Vector((0.0, 0.10 * H, 0.18 * H)),
    )
    bind_rigid_to_bone(eyes, arm_obj, "Head")
    bind_rigid_to_bone(eye_frames, arm_obj, "Head")

    # Bind scarf tail smoothly across Scarf.0 -> Scarf.1 -> Scarf.2!
    bind_chain_graduated(
        scarf_tail,
        arm_obj,
        ["Scarf.0", "Scarf.1", "Scarf.2"],
        lm["neck"] + Vector((0.02 * H, 0.075 * H, -0.015 * H)),
        lm["neck"] + Vector((0.06 * H, 0.42 * H, -0.18 * H)),
    )

    # Bind colossal gauntlets cleanly across Forearm -> Hand transition so wrists pivot & fists scale-pop cleanly!
    for g_armor, g_lava, sfx, el, wr in (
        (gauntlet_l, lava_l, "L", lm["elbow_l"], lm["wrist_l"]),
        (gauntlet_r, lava_r, "R", lm["elbow_r"], lm["wrist_r"]),
    ):
        for g_part in (g_armor, g_lava):
            bind_chain_graduated(
                g_part,
                arm_obj,
                [f"Forearm.{sfx}", f"Hand.{sfx}"],
                el + (wr - el) * 0.48,
                wr + (wr - el).normalized() * (0.04 * H),
            )

    # 7. Merge all skinned parts into ONE unified SkinnedMesh (single draw call in Three.js!)
    all_parts = [
        body, gi_top, gi_trim, gi_pants, shin_wraps, obi_belt, belt_knot, belt_tail_l, belt_tail_r, sandals,
        scarf_collar, scarf_tail, flame_head, eyes, eye_frames, gauntlet_l, lava_l, gauntlet_r, lava_r,
    ]
    for p in all_parts:
        set_smooth_and_weighted_normals(p, angle_deg=44.0)

    bpy.ops.object.select_all(action="DESELECT")
    for p in all_parts:
        p.select_set(True)
    bpy.context.view_layer.objects.active = body
    bpy.ops.object.join()
    merged = bpy.context.active_object
    merged.name = "CHR_ignis"
    # Ensure single clean Armature modifier & limit 4 bone weights per vertex
    merged.modifiers.clear()
    arm_mod = merged.modifiers.new("Armature", "ARMATURE")
    arm_mod.object = arm_obj
    merged.parent = arm_obj
    bpy.ops.object.vertex_group_limit_total(group_select_mode="ALL", limit=4)
    bpy.ops.object.vertex_group_normalize_all(group_select_mode="ALL", lock_active=False)

    tri_count = sum(len(p.vertices) - 2 for p in merged.data.polygons)
    print(f"[build_ignis] Unified SkinnedMesh built: verts={len(merged.data.vertices)}, tris={tri_count}, bones={len(arm_obj.data.bones)}")

    # 8. Bake Cycles AO + Curvature + Stylized Cel Albedo & Emissive Atlas!
    albedo_path, emissive_path = bake_stylized_cel_textures(merged, out_dir, "ignis", tex_size=1024)
    apply_baked_material(merged, "ignis", albedo_path, emissive_path)

    # 9. Compile & bake ALL 60fps Smash AnimationClips via Analytic 2-Bone IK + Sakurai Timing!
    compiler = SmashPoseCompiler(arm_obj, H)
    move_frames = load_earl_move_frames()
    clips = build_ignis_moveset(compiler, move_frames)
    print(f"[build_ignis] Baked {len(clips)} 60fps Smash animation clips: {', '.join(clips[:10])}...")

    # 9b. Automated Gate V2 Mesh-Stretch Audit (catches bone-mismatch spikes > 0.24m with > 3.5x stretch!)
    for tr in arm_obj.animation_data.nla_tracks:
        tr.mute = True
    rest_edges = [
        (merged.data.vertices[e.vertices[1]].co - merged.data.vertices[e.vertices[0]].co).length
        for e in merged.data.edges
    ]
    max_ratio = 0.0
    worst_info = "none"
    for act_name, frm in (("Idle", 0), ("Ftilt", 7), ("Uspec", 6), ("JumpSquat", 2)):
        arm_obj.animation_data.action = bpy.data.actions[act_name]
        bpy.context.scene.frame_set(frm)
        bpy.context.view_layer.update()
        deps = bpy.context.evaluated_depsgraph_get()
        ev_me = merged.evaluated_get(deps).to_mesh()
        for ei, e in enumerate(ev_me.edges):
            rl = rest_edges[ei]
            if rl < 0.012:
                continue
            L = (ev_me.vertices[e.vertices[1]].co - ev_me.vertices[e.vertices[0]].co).length
            ratio = L / rl
            if L > 0.24 and ratio > max_ratio:
                max_ratio = ratio
                r0 = tuple(round(x, 3) for x in merged.data.vertices[e.vertices[0]].co)
                r1 = tuple(round(x, 3) for x in merged.data.vertices[e.vertices[1]].co)
                g0 = [(merged.vertex_groups[g.group].name, round(g.weight, 2)) for g in merged.data.vertices[e.vertices[0]].groups]
                g1 = [(merged.vertex_groups[g.group].name, round(g.weight, 2)) for g in merged.data.vertices[e.vertices[1]].groups]
                worst_info = f"{act_name}@{frm} L={L:.3f}m rest={rl:.3f}m r0={r0} {g0} <-> r1={r1} {g1}"
        merged.evaluated_get(deps).to_mesh_clear()
    arm_obj.animation_data.action = None
    for tr in arm_obj.animation_data.nla_tracks:
        tr.mute = False
    print(f"[build_ignis] Gate V2 Stretch Audit: max_spike_ratio={max_ratio:.2f}x ({worst_info})")
    assert max_ratio < 3.5, f"Gate V2 FAIL: stretched edge {max_ratio:.2f}x in {worst_info}!"

    # 10. Export single self-contained Meshopt-compressed GLB with embedded textures & ALL animation clips!
    glb_path = os.path.join(out_dir, "ignis.glb")
    bpy.ops.object.select_all(action="DESELECT")
    arm_obj.select_set(True)
    merged.select_set(True)
    bpy.context.scene.render.fps = 60
    bpy.context.view_layer.objects.active = arm_obj
    bpy.ops.export_scene.gltf(
        filepath=glb_path,
        export_format="GLB",
        use_selection=True,
        export_yup=True,
        export_materials="EXPORT",
        export_image_format="AUTO",
        export_texcoords=True,
        export_normals=True,
        export_skins=True,
        export_animations=True,
        export_nla_strips=True,
        export_nla_strips_merged_animation_name="",
        export_optimize_animation_size=True,
        export_def_bones=False,
        export_frame_step=1,
    )
    glb_kb = os.path.getsize(glb_path) / 1024.0
    print(f"[build_ignis] Exported {glb_path} ({glb_kb:.1f} KB)")

    # 11. Render Checkpoint-2 Visual Verification Sheets (Gates V1, V2, V3)!
    sheets = render_vertical_slice_sheets(merged, arm_obj, compiler, albedo_path, emissive_path, out_dir, "ignis")
    meta = {
        "fighter": "ignis",
        "triangles": tri_count,
        "bones": [b.name for b in arm_obj.data.bones],
        "clips": clips,
        "glbBytes": os.path.getsize(glb_path),
        "sheets": sheets,
    }
    with open(os.path.join(out_dir, "ignis.meta.json"), "w", encoding="utf-8") as f:
        json.dump(meta, f, indent=2)
    print("[build_ignis] DONE ->", json.dumps(meta, indent=2))


if __name__ == "__main__":
    build_ignis()
