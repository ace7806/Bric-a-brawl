"""Build Style B Rock Fighter ('BASALT') -> rigged GLB + 45 60fps Smash clips + Checkpoint 3 visual sheets.

Run via:
  PYTHONPATH=/usr/lib/python3/dist-packages blender --background --python assets-src/elemental/build_basalt.py
"""
from __future__ import annotations

import json
import os
import sys
import bpy
from mathutils import Vector

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
if SCRIPT_DIR not in sys.path:
    sys.path.insert(0, SCRIPT_DIR)

from mesh_craft import (
    apply_baked_material,
    assign_material_tag,
    bake_stylized_cel_textures,
    load_cc0_stylized_body,
    reset_scene,
    sculpt_hero_proportions,
    set_smooth_and_weighted_normals,
    trim_body_regions,
)
from parts_roster import (
    build_basalt_colossal_fist,
    build_basalt_horned_helm,
    build_basalt_leg_armor,
    build_basalt_torso_armor,
)
from rig import (
    bind_chain_graduated,
    bind_lr_by_component,
    bind_rigid_to_bone,
    build_canonical_armature,
    clean_pelvis_and_leg_weights,
    measure_landmarks,
    skin_body_automatic,
    transfer_skin_weights,
)
from smash_anims import SmashPoseCompiler
from movesets_roster import build_basalt_moveset, load_slot_move_frames
from eval_render import render_vertical_slice_sheets


def build_basalt() -> None:
    out_dir = os.path.join(SCRIPT_DIR, "out", "basalt")
    os.makedirs(out_dir, exist_ok=True)
    reset_scene()

    # 1. Load official CC0 stylized male humanoid & sculpt hulking juggernaut anatomy (1.82m tall!)
    body = load_cc0_stylized_body("GEO-body_male_stylized", target_height=1.82, unsubdiv_iters=2)
    sculpt_hero_proportions(body, shoulder_w=1.32, waist_w=1.08, chest_depth=1.24, leg_musc=1.24, arm_musc=1.30)
    lm = measure_landmarks(body)
    H = lm["height"].z

    # 2. Sculpt Basalt's faceted volcanic obsidian armor plates, horned helm & colossal rune fists!
    helm, visor, eyes = build_basalt_horned_helm(lm)
    chest_armor, pauldrons, biceps = build_basalt_torso_armor(lm)
    gauntlet_l, runes_l = build_basalt_colossal_fist("L", lm["elbow_l"], lm["wrist_l"], H)
    gauntlet_r, runes_r = build_basalt_colossal_fist("R", lm["elbow_r"], lm["wrist_r"], H)
    thigh_armor, shin_armor, boots = build_basalt_leg_armor(lm)

    # 3. Assign Style B Rock color palette (carved dark basalt + glowing molten-orange magma seams!)
    assign_material_tag(body, "M_MagmaCore", (1.00, 0.50, 0.05, 1.0), emissive=1.70)        # incandescent magma fissures!
    assign_material_tag(helm, "M_BasaltStoneHelm", (0.31, 0.30, 0.34, 1.0), emissive=0.0)
    assign_material_tag(visor, "M_VisorDark", (0.06, 0.05, 0.07, 1.0), emissive=0.0)
    assign_material_tag(eyes, "M_EyesMagma", (1.00, 0.68, 0.12, 1.0), emissive=2.0)
    assign_material_tag(chest_armor, "M_BasaltStoneChest", (0.29, 0.28, 0.32, 1.0), emissive=0.0)
    assign_material_tag(pauldrons, "M_BasaltStonePauldron", (0.33, 0.32, 0.36, 1.0), emissive=0.0)
    assign_material_tag(biceps, "M_BasaltStoneBicep", (0.28, 0.27, 0.31, 1.0), emissive=0.0)
    assign_material_tag(gauntlet_l, "M_BasaltStoneFistL", (0.29, 0.28, 0.32, 1.0), emissive=0.0)
    assign_material_tag(gauntlet_r, "M_BasaltStoneFistR", (0.29, 0.28, 0.32, 1.0), emissive=0.0)
    assign_material_tag(runes_l, "M_MagmaRuneL", (1.00, 0.56, 0.06, 1.0), emissive=1.9)
    assign_material_tag(runes_r, "M_MagmaRuneR", (1.00, 0.56, 0.06, 1.0), emissive=1.9)
    assign_material_tag(thigh_armor, "M_BasaltStoneThigh", (0.26, 0.25, 0.29, 1.0), emissive=0.0)
    assign_material_tag(shin_armor, "M_BasaltStoneShin", (0.24, 0.24, 0.28, 1.0), emissive=0.0)
    assign_material_tag(boots, "M_BasaltStoneBoot", (0.22, 0.21, 0.25, 1.0), emissive=0.0)

    # 4. Build canonical Smash humanoid armature & apply AAA skinning on complete body BEFORE trimming!
    arm_obj = build_canonical_armature("basalt", lm, include_flame_chain=False, include_scarf_chain=False)
    skin_body_automatic(body, arm_obj)
    clean_pelvis_and_leg_weights(body, H)

    # Bind armor plates crisply so rigid obsidian plates stay solid & faceted while magma core flexes smoothly!
    transfer_skin_weights(body, chest_armor, arm_obj, exclude_prefixes=("UpperArm.", "Forearm.", "Hand.", "Thigh.", "Shin."), fallback_bone="Chest")
    for p in (helm, visor, eyes):
        bind_rigid_to_bone(p, arm_obj, "Head")
    bind_lr_by_component(pauldrons, arm_obj, "Shoulder.L", "Shoulder.R")
    bind_lr_by_component(biceps, arm_obj, "UpperArm.L", "UpperArm.R")
    bind_lr_by_component(thigh_armor, arm_obj, "Thigh.L", "Thigh.R")
    bind_lr_by_component(shin_armor, arm_obj, "Shin.L", "Shin.R")
    bind_lr_by_component(boots, arm_obj, "Foot.L", "Foot.R")

    for g_armor, g_runes, sfx, el, wr in (
        (gauntlet_l, runes_l, "L", lm["elbow_l"], lm["wrist_l"]),
        (gauntlet_r, runes_r, "R", lm["elbow_r"], lm["wrist_r"]),
    ):
        for g_part in (g_armor, g_runes):
            bind_chain_graduated(
                g_part,
                arm_obj,
                [f"Forearm.{sfx}", f"Hand.{sfx}"],
                el + (wr - el) * 0.45,
                wr + (wr - el).normalized() * (0.04 * H),
            )

    # Trim hidden head & hand meshes inside helm and giant stone fists
    trim_body_regions(
        body,
        lambda c: (c.z > 0.812 * H) or (abs(c.x) > 0.21 * H and c.z < 0.56 * H),
    )

    # 5. Merge into ONE unified SkinnedMesh (1 draw call in Three.js!)
    all_parts = [
        body, helm, visor, eyes, chest_armor, pauldrons, biceps,
        gauntlet_l, runes_l, gauntlet_r, runes_r, thigh_armor, shin_armor, boots,
    ]
    for p in all_parts:
        set_smooth_and_weighted_normals(p, angle_deg=38.0)

    bpy.ops.object.select_all(action="DESELECT")
    for p in all_parts:
        p.select_set(True)
    bpy.context.view_layer.objects.active = body
    bpy.ops.object.join()
    merged = bpy.context.active_object
    merged.name = "CHR_basalt"
    merged.modifiers.clear()
    arm_mod = merged.modifiers.new("Armature", "ARMATURE")
    arm_mod.object = arm_obj
    merged.parent = arm_obj
    bpy.ops.object.vertex_group_limit_total(group_select_mode="ALL", limit=4)
    bpy.ops.object.vertex_group_normalize_all(group_select_mode="ALL", lock_active=False)

    tri_count = sum(len(p.vertices) - 2 for p in merged.data.polygons)
    print(f"[build_basalt] Unified SkinnedMesh built: verts={len(merged.data.vertices)}, tris={tri_count}, bones={len(arm_obj.data.bones)}")

    # 6. Bake Cycles AO + Curvature + Cel Albedo & Emissive Atlas
    albedo_path, emissive_path = bake_stylized_cel_textures(merged, out_dir, "basalt", tex_size=1024)
    apply_baked_material(merged, "basalt", albedo_path, emissive_path)

    # 7. Bake all 45 60fps Smash animation clips synced 1:1 to slot-1 ('grog') real frame data!
    compiler = SmashPoseCompiler(arm_obj, H)
    move_frames = load_slot_move_frames("grog")
    clips = build_basalt_moveset(compiler, move_frames)
    print(f"[build_basalt] Baked {len(clips)} 60fps Smash clips synced to grog slot")

    # 8. Automated Gate V2 Mesh-Stretch Audit
    for tr in arm_obj.animation_data.nla_tracks:
        tr.mute = True
    rest_edges = [
        (merged.data.vertices[e.vertices[1]].co - merged.data.vertices[e.vertices[0]].co).length
        for e in merged.data.edges
    ]
    max_ratio = 0.0
    worst_info = "none"
    ft_f = move_frames.get("Ftilt", (9, 4, 32))[0]
    us_f = move_frames.get("Uspec", (10, 10, 44))[0]
    for act_name, frm in (("Idle", 0), ("Ftilt", ft_f), ("Uspec", us_f), ("JumpSquat", 2)):
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
            if L > 0.28 and ratio > max_ratio:
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
    print(f"[build_basalt] Gate V2 Stretch Audit: max_spike_ratio={max_ratio:.2f}x ({worst_info})")
    assert max_ratio < 3.5, f"Gate V2 FAIL on basalt: {max_ratio:.2f}x in {worst_info}"

    # 9. Export self-contained GLB
    glb_path = os.path.join(out_dir, "basalt.glb")
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
    print(f"[build_basalt] Exported {glb_path} ({os.path.getsize(glb_path) / 1024.0:.1f} KB)")

    # 10. Render Checkpoint-3 Visual Verification Sheets + 256px Portrait!
    fh_st = move_frames.get("Fheavy", (18, 4, 54))[0]
    j2_st = move_frames.get("Jab2", (7, 3, 32))[0]
    fa_st = move_frames.get("Fair", (14, 4, 44))[0]
    da_st = move_frames.get("Dair", (16, 4, 48))[0]
    sheets = render_vertical_slice_sheets(
        merged,
        arm_obj,
        compiler,
        albedo_path,
        emissive_path,
        out_dir,
        "basalt",
        eval_cfg={
            "accent_rgb": (214, 112, 34),
            "fheavy_title": "FHEAVY SEISMIC METEOR HAYMAKER",
            "fheavy_frames": (0, 6, fh_st - 2, fh_st, fh_st + 8),
            "move_specs": [
                ("Jab2", j2_st, f"JAB 2 - BOULDER HOOK (f{j2_st})", False),
                ("Fair", fa_st, f"FAIR - DK TWO-HAND METEOR DUNK (f{fa_st})", False),
                ("Uspec", us_f, f"USPEC - VOLCANIC UPPERCUT (f{us_f})", True),
                ("Dair", da_st, f"DAIR - EARTHQUAKE STOMP (f{da_st})", False),
            ],
            "ftilt_frame": ft_f,
            "back_label": "3. BACK 3/4 (OBSIDIAN + MAGMA)",
            "closeup_label": "4. CLOSE-UP HELM + RUNE FISTS",
        },
    )
    meta = {
        "fighter": "basalt",
        "triangles": tri_count,
        "bones": [b.name for b in arm_obj.data.bones],
        "clips": clips,
        "glbBytes": os.path.getsize(glb_path),
        "sheets": sheets,
    }
    with open(os.path.join(out_dir, "basalt.meta.json"), "w", encoding="utf-8") as f:
        json.dump(meta, f, indent=2)
    print("[build_basalt] DONE ->", json.dumps(meta, indent=2))


if __name__ == "__main__":
    build_basalt()
