"""Build Style B Air Fighter ('ZEPHYR') -> rigged GLB + 45 60fps Smash clips + Checkpoint 3 visual sheets.

Run via:
  PYTHONPATH=/usr/lib/python3/dist-packages blender --background --python assets-src/elemental/build_zephyr.py
"""
from __future__ import annotations

import json
import math
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
    extract_surface_shell,
    load_cc0_stylized_body,
    reset_scene,
    sculpt_hero_proportions,
    set_smooth_and_weighted_normals,
    trim_body_regions,
)
from parts_roster import (
    build_zephyr_gale_staff,
    build_zephyr_hood_and_avian_mask,
    build_zephyr_poncho_and_wind_ribbons,
    build_zephyr_winged_boots,
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
from movesets_roster import build_zephyr_moveset, load_slot_move_frames
from eval_render import render_vertical_slice_sheets


def build_zephyr() -> None:
    out_dir = os.path.join(SCRIPT_DIR, "out", "zephyr")
    os.makedirs(out_dir, exist_ok=True)
    reset_scene()

    # 1. Load official CC0 stylized female humanoid & sculpt nimble sky-monk proportions (1.54m!)
    body = load_cc0_stylized_body("GEO-body_female_stylized", target_height=1.54, unsubdiv_iters=2)
    sculpt_hero_proportions(body, shoulder_w=1.04, waist_w=0.90, chest_depth=1.00, leg_musc=1.02, arm_musc=1.00)
    lm = measure_landmarks(body)
    H = lm["height"].z

    # 2. Extract sculpted sky-monk garments off real CC0 anatomy!
    # 2a) Bandaged ivory forearm cloth wraps
    arm_wraps = extract_surface_shell(
        body,
        "Zephyr_ArmWraps",
        lambda c, n: (0.485 * H <= c.z <= 0.655 * H) and (abs(c.x) >= 0.145 * H),
        offset=0.008,
        thickness=0.008,
        crease_amp=0.003,
    )
    # 2b) Tapered sage-slate sky-runner trousers
    wind_pants = extract_surface_shell(
        body,
        "Zephyr_WindPants",
        lambda c, n: (0.195 * H <= c.z <= 0.555 * H) and (abs(c.x) <= 0.170 * H),
        offset=0.017,
        thickness=0.013,
        flare_fn=lambda p, n: Vector((
            p.x + math.copysign(0.016 * H * math.sin(min(1.0, max(0.0, (p.z - 0.195 * H) / (0.34 * H))) * math.pi), p.x)
            if abs(p.x) > 0.024 * H else p.x,
            p.y * 1.10,
            p.z,
        )),
        crease_amp=0.004,
    )
    # 2c) Dark slate shin gaiters leading into winged boots
    shin_gaiters = extract_surface_shell(
        body,
        "Zephyr_ShinGaiters",
        lambda c, n: (0.055 * H <= c.z <= 0.215 * H) and (abs(c.x) <= 0.170 * H),
        offset=0.009,
        thickness=0.008,
    )

    # 3. Build Zephyr's iconic Style B sky-monk gear (sharp hawk hood, avian mask, 4-corner origami diamond poncho, wind ribbons, winged boots, gale staff!)
    hood, avian_mask, avian_eyes, avian_sockets = build_zephyr_hood_and_avian_mask(lm)
    poncho, wind_ribbons = build_zephyr_poncho_and_wind_ribbons(lm)
    boots, ankle_wings = build_zephyr_winged_boots(lm)
    staff_shaft, staff_blades = build_zephyr_gale_staff(lm)

    # 4. Assign Style B Air color palette (ivory + razor-crisp procedural mint-jade geometric chevrons + cool sage-slate + glowing cyan falcon eyes!)
    assign_material_tag(body, "M_GlovesUndersuit", (0.20, 0.23, 0.26, 1.0), emissive=0.0)   # sleek dark sky-runner gloves/undersuit
    assign_material_tag(arm_wraps, "M_IvoryWraps", (0.91, 0.91, 0.86, 1.0), emissive=0.0)
    assign_material_tag(wind_pants, "M_SagePants", (0.34, 0.46, 0.44, 1.0), emissive=0.0)
    assign_material_tag(shin_gaiters, "M_DarkGaiters", (0.18, 0.21, 0.23, 1.0), emissive=0.0)
    assign_material_tag(hood, "M_IvoryHood", (0.94, 0.96, 0.91, 1.0), emissive=0.0)
    assign_material_tag(avian_mask, "M_AvianMask", (0.68, 0.84, 0.82, 1.0), emissive=0.0)
    assign_material_tag(avian_sockets, "M_AvianSockets", (0.08, 0.10, 0.12, 1.0), emissive=0.0)
    assign_material_tag(avian_eyes, "M_AvianEyes", (0.50, 0.99, 0.96, 1.0), emissive=1.8)   # glowing cyan falcon eyes!
    assign_material_tag(poncho, "M_IvoryPoncho", (0.94, 0.96, 0.91, 1.0), emissive=0.0)     # baked procedural razor-crisp mint V-chevron + wing motif!
    assign_material_tag(wind_ribbons, "M_WindRibbons", (0.70, 0.96, 0.92, 1.0), emissive=0.30)
    assign_material_tag(boots, "M_MintBoots", (0.48, 0.86, 0.76, 1.0), emissive=0.0)
    assign_material_tag(ankle_wings, "M_AnkleWings", (0.94, 0.97, 0.94, 1.0), emissive=0.15)
    assign_material_tag(staff_shaft, "M_StaffShaft", (0.32, 0.39, 0.42, 1.0), emissive=0.0, metallic=0.6)
    assign_material_tag(staff_blades, "M_StaffBlades", (0.76, 0.94, 0.92, 1.0), emissive=0.25, metallic=0.5)

    # 5. Build canonical Smash humanoid armature (with Scarf.0/1/2 for swirling wind ribbons & Weapon.R for Gale Staff!)
    arm_obj = build_canonical_armature("zephyr", lm, include_flame_chain=False, include_scarf_chain=True)
    skin_body_automatic(body, arm_obj)

    transfer_skin_weights(body, arm_wraps, arm_obj)
    for g in (wind_pants, shin_gaiters):
        transfer_skin_weights(body, g, arm_obj, exclude_prefixes=("UpperArm.", "Forearm.", "Hand."), fallback_bone="Hips")
    # Bind diamond poncho smoothly across Chest -> Spine so cape drapes gracefully with ZERO Hips/Chest cliffs!
    bind_chain_graduated(
        poncho,
        arm_obj,
        ["Chest", "Spine"],
        Vector((0.0, 0.0, 0.78 * H)),
        Vector((0.0, 0.0, 0.44 * H)),
    )

    for leg_mesh in (body, wind_pants, shin_gaiters):
        clean_pelvis_and_leg_weights(leg_mesh, H)

    # Trim hidden human head, thighs & lower feet inside boots AFTER weight transfers!
    trim_body_regions(
        body,
        lambda c: (c.z > 0.812 * H) or (0.20 * H < c.z < 0.52 * H and abs(c.x) < 0.165 * H) or (c.z < 0.048 * H),
    )

    for head_gear in (hood, avian_mask, avian_eyes, avian_sockets):
        bind_rigid_to_bone(head_gear, arm_obj, "Head")
    bind_chain_graduated(
        wind_ribbons,
        arm_obj,
        ["Scarf.0", "Scarf.1", "Scarf.2"],
        lm["neck"] + Vector((0.0, 0.070 * H, 0.0)),
        lm["neck"] + Vector((0.04 * H, 0.40 * H, -0.10 * H)),
    )
    bind_lr_by_component(boots, arm_obj, "Foot.L", "Foot.R")
    bind_lr_by_component(ankle_wings, arm_obj, "Foot.L", "Foot.R")
    for w_part in (staff_shaft, staff_blades):
        bind_rigid_to_bone(w_part, arm_obj, "Weapon.R")

    # 6. Merge into ONE unified SkinnedMesh
    all_parts = [
        body, arm_wraps, wind_pants, shin_gaiters, hood, avian_mask, avian_eyes, avian_sockets,
        poncho, wind_ribbons, boots, ankle_wings, staff_shaft, staff_blades,
    ]
    for p in all_parts:
        set_smooth_and_weighted_normals(p, angle_deg=34.0 if p in (hood, poncho) else 42.0)

    bpy.ops.object.select_all(action="DESELECT")
    for p in all_parts:
        p.select_set(True)
    bpy.context.view_layer.objects.active = body
    bpy.ops.object.join()
    merged = bpy.context.active_object
    merged.name = "CHR_zephyr"
    merged.modifiers.clear()
    arm_mod = merged.modifiers.new("Armature", "ARMATURE")
    arm_mod.object = arm_obj
    merged.parent = arm_obj
    bpy.ops.object.vertex_group_limit_total(group_select_mode="ALL", limit=4)
    bpy.ops.object.vertex_group_normalize_all(group_select_mode="ALL", lock_active=False)

    tri_count = sum(len(p.vertices) - 2 for p in merged.data.polygons)
    print(f"[build_zephyr] Unified SkinnedMesh built: verts={len(merged.data.vertices)}, tris={tri_count}, bones={len(arm_obj.data.bones)}")

    # 7. Bake Cycles AO + Curvature + Cel Albedo & Emissive Atlas
    albedo_path, emissive_path = bake_stylized_cel_textures(merged, out_dir, "zephyr", tex_size=1024)
    apply_baked_material(merged, "zephyr", albedo_path, emissive_path)

    # 8. Bake all 45 60fps Smash animation clips synced 1:1 to slot-3 ('moss') real frame data!
    compiler = SmashPoseCompiler(arm_obj, H)
    move_frames = load_slot_move_frames("moss")
    clips = build_zephyr_moveset(compiler, move_frames)
    print(f"[build_zephyr] Baked {len(clips)} 60fps Smash clips synced to moss slot")

    # 9. Automated Gate V2 Mesh-Stretch Audit
    for tr in arm_obj.animation_data.nla_tracks:
        tr.mute = True
    rest_edges = [
        (merged.data.vertices[e.vertices[1]].co - merged.data.vertices[e.vertices[0]].co).length
        for e in merged.data.edges
    ]
    max_ratio = 0.0
    worst_info = "none"
    ft_f = move_frames.get("Ftilt", (8, 3, 30))[0]
    us_f = move_frames.get("Uspec", (7, 9, 38))[0]
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
    print(f"[build_zephyr] Gate V2 Stretch Audit: max_spike_ratio={max_ratio:.2f}x ({worst_info})")
    assert max_ratio < 3.5, f"Gate V2 FAIL on zephyr: {max_ratio:.2f}x in {worst_info}"

    # 10. Export self-contained GLB
    glb_path = os.path.join(out_dir, "zephyr.glb")
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
    print(f"[build_zephyr] Exported {glb_path} ({os.path.getsize(glb_path) / 1024.0:.1f} KB)")

    # 11. Render Checkpoint-3 Visual Verification Sheets + 256px Portrait!
    fh_st = move_frames.get("Fheavy", (17, 3, 50))[0]
    j2_st = move_frames.get("Jab2", (6, 3, 30))[0]
    fa_st = move_frames.get("Fair", (9, 4, 34))[0]
    da_st = move_frames.get("Dair", (12, 4, 42))[0]
    sheets = render_vertical_slice_sheets(
        merged,
        arm_obj,
        compiler,
        albedo_path,
        emissive_path,
        out_dir,
        "zephyr",
        eval_cfg={
            "accent_rgb": (96, 206, 170),
            "fheavy_title": "FHEAVY TEMPEST GALE-LANCE THRUST",
            "fheavy_frames": (0, 5, fh_st - 2, fh_st, fh_st + 8),
            "move_specs": [
                ("Jab2", j2_st, f"JAB 2 - GALE STAFF SLASH (f{j2_st})", False),
                ("Fair", fa_st, f"FAIR - CRESCENT GALE SWEEP (f{fa_st})", False),
                ("Uspec", us_f, f"USPEC - TORNADO SKY-VAULT (f{us_f})", True),
                ("Dair", da_st, f"DAIR - PLUNGING SPEAR DIVE (f{da_st})", False),
            ],
            "ftilt_frame": ft_f,
            "back_label": "3. BACK 3/4 (HOOD + WIND RIBBONS)",
            "closeup_label": "4. CLOSE-UP AVIAN MASK + STAFF",
        },
    )
    meta = {
        "fighter": "zephyr",
        "triangles": tri_count,
        "bones": [b.name for b in arm_obj.data.bones],
        "clips": clips,
        "glbBytes": os.path.getsize(glb_path),
        "sheets": sheets,
    }
    with open(os.path.join(out_dir, "zephyr.meta.json"), "w", encoding="utf-8") as f:
        json.dump(meta, f, indent=2)
    print("[build_zephyr] DONE ->", json.dumps(meta, indent=2))


if __name__ == "__main__":
    build_zephyr()
