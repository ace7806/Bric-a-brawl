"""Build Style B Water Fighter ('TIDE') -> rigged GLB + 45 60fps Smash clips + Checkpoint 3 visual sheets.

Run via:
  PYTHONPATH=/usr/lib/python3/dist-packages blender --background --python assets-src/elemental/build_tide.py
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
    extract_surface_shell,
    load_cc0_stylized_body,
    reset_scene,
    sculpt_hero_proportions,
    set_smooth_and_weighted_normals,
    trim_body_regions,
)
from parts_roster import (
    build_tide_crop_top_and_sash,
    build_tide_waist_sash_ribbons,
    build_tide_water_sleeve,
    build_tide_wave_hair_and_visor,
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
from smash_anims import SmashPoseCompiler
from movesets_roster import build_tide_moveset, load_slot_move_frames
from eval_render import render_vertical_slice_sheets


def build_tide() -> None:
    out_dir = os.path.join(SCRIPT_DIR, "out", "tide")
    os.makedirs(out_dir, exist_ok=True)
    reset_scene()

    # 1. Load official CC0 stylized female humanoid & sculpt agile hydro-acrobat proportions (1.56m!)
    body = load_cc0_stylized_body("GEO-body_female_stylized", target_height=1.56, unsubdiv_iters=2)
    sculpt_hero_proportions(body, shoulder_w=1.02, waist_w=0.88, chest_depth=0.98, leg_musc=1.04, arm_musc=0.98)
    lm = measure_landmarks(body)
    H = lm["height"].z

    # 2. Build clean sculpted athletic hydro-martial garments (ZERO saw-tooth jagged edges!)
    # 2a) Clean custom-lofted seafoam halter crop top + diagonally draped wrapped hip sash!
    crop_top, waist_sash = build_tide_crop_top_and_sash(body, lm)
    # 2b) Gradient deep-ocean-to-mint fitted hydro-leggings (hip down to ankle, bare agile feet exposed!)
    leggings = extract_surface_shell(
        body,
        "Tide_Leggings",
        lambda c, n: (0.072 * H <= c.z <= 0.532 * H) and (abs(c.x) <= 0.165 * H),
        offset=0.008,
        thickness=0.007,
        crease_amp=0.0015,
    )

    # 3. Sculpt Tide's iconic Style B hydro features (wave hair, dive visor, water sleeves, sash ribbons!)
    wave_hair, visor_frame, visor_lens, breather = build_tide_wave_hair_and_visor(lm)
    sleeve_l = build_tide_water_sleeve("L", lm["upper_arm_l"], lm["elbow_l"], lm["wrist_l"], H)
    sleeve_r = build_tide_water_sleeve("R", lm["upper_arm_r"], lm["elbow_r"], lm["wrist_r"], H)
    sash_knot, sash_tails = build_tide_waist_sash_ribbons(lm)

    # 4. Assign Style B Water color palette & luminous aqua shimmer!
    assign_material_tag(body, "M_Skin", (0.96, 0.75, 0.62, 1.0), emissive=0.0)
    assign_material_tag(crop_top, "M_SeafoamTop", (0.36, 0.84, 0.78, 1.0), emissive=0.0)
    assign_material_tag(leggings, "M_Leggings", (0.14, 0.48, 0.66, 1.0), emissive=0.0)       # baked mint-to-ocean gradient!
    assign_material_tag(waist_sash, "M_WaveSash", (0.34, 0.88, 0.84, 1.0), emissive=0.10)
    assign_material_tag(sash_knot, "M_WaveSashKnot", (0.42, 0.90, 0.86, 1.0), emissive=0.10)
    assign_material_tag(sash_tails, "M_WaveSashTails", (0.28, 0.86, 0.92, 1.0), emissive=0.22)
    assign_material_tag(wave_hair, "M_WaveHair", (0.22, 0.88, 0.96, 1.0), emissive=0.35)     # baked azure-to-seafoam wave crest!
    assign_material_tag(visor_frame, "M_VisorFrame", (0.72, 0.94, 0.94, 1.0), emissive=0.0)
    assign_material_tag(visor_lens, "M_VisorLens", (0.34, 0.94, 0.98, 1.0), emissive=0.85)
    assign_material_tag(breather, "M_Breather", (0.48, 0.86, 0.86, 1.0), emissive=0.0)
    assign_material_tag(sleeve_l, "M_WaveSleeveL", (0.20, 0.86, 0.94, 1.0), emissive=0.35)
    assign_material_tag(sleeve_r, "M_WaveSleeveR", (0.20, 0.86, 0.94, 1.0), emissive=0.35)

    # 5. Build canonical Smash humanoid armature (with Flame.0/1 reused for dynamic wave-crest hair!)
    arm_obj = build_canonical_armature("tide", lm, include_flame_chain=True, include_scarf_chain=False)
    skin_body_automatic(body, arm_obj)

    transfer_skin_weights(body, crop_top, arm_obj, exclude_prefixes=("UpperArm.", "Forearm.", "Hand."), fallback_bone="Chest")
    transfer_skin_weights(body, waist_sash, arm_obj, exclude_prefixes=("UpperArm.", "Forearm.", "Hand.", "Thigh.", "Shin."), fallback_bone="Hips")
    transfer_skin_weights(body, leggings, arm_obj, exclude_prefixes=("UpperArm.", "Forearm.", "Hand."), fallback_bone="Hips")

    for leg_mesh in (body, leggings):
        clean_pelvis_and_leg_weights(leg_mesh, H)

    # Trim covered leg/chest interior faces ONLY (keep face, exposed midriff, arms, hands, bare feet 100% intact!)
    trim_body_regions(
        body,
        lambda c: (0.10 * H < c.z < 0.50 * H and abs(c.x) < 0.16 * H),
    )

    # Bind hair cap rigidly to Head & let upper breaking wave crest whip smoothly across Flame.0 -> Flame.1!
    bind_chain_graduated(
        wave_hair,
        arm_obj,
        ["Head", "Flame.0", "Flame.1"],
        lm["head"] + Vector((0.0, 0.0, 0.07 * H)),
        lm["crown"] + Vector((0.0, 0.02 * H, 0.18 * H)),
    )
    for head_gear in (visor_frame, visor_lens, breather):
        bind_rigid_to_bone(head_gear, arm_obj, "Head")
    for hip_gear in (sash_knot, sash_tails):
        bind_rigid_to_bone(hip_gear, arm_obj, "Hips")

    for slv, sfx, el, wr in (
        (sleeve_l, "L", lm["elbow_l"], lm["wrist_l"]),
        (sleeve_r, "R", lm["elbow_r"], lm["wrist_r"]),
    ):
        bind_chain_graduated(
            slv,
            arm_obj,
            [f"Forearm.{sfx}", f"Hand.{sfx}"],
            el,
            wr + (wr - el).normalized() * (0.04 * H),
        )

    # 6. Merge into ONE unified SkinnedMesh
    all_parts = [
        body, crop_top, leggings, waist_sash, sash_knot, sash_tails,
        wave_hair, visor_frame, visor_lens, breather, sleeve_l, sleeve_r,
    ]
    for p in all_parts:
        set_smooth_and_weighted_normals(p, angle_deg=44.0)

    bpy.ops.object.select_all(action="DESELECT")
    for p in all_parts:
        p.select_set(True)
    bpy.context.view_layer.objects.active = body
    bpy.ops.object.join()
    merged = bpy.context.active_object
    merged.name = "CHR_tide"
    merged.modifiers.clear()
    arm_mod = merged.modifiers.new("Armature", "ARMATURE")
    arm_mod.object = arm_obj
    merged.parent = arm_obj
    bpy.ops.object.vertex_group_limit_total(group_select_mode="ALL", limit=4)
    bpy.ops.object.vertex_group_normalize_all(group_select_mode="ALL", lock_active=False)

    tri_count = sum(len(p.vertices) - 2 for p in merged.data.polygons)
    print(f"[build_tide] Unified SkinnedMesh built: verts={len(merged.data.vertices)}, tris={tri_count}, bones={len(arm_obj.data.bones)}")

    # 7. Bake Cycles AO + Curvature + Cel Albedo & Emissive Atlas
    albedo_path, emissive_path = bake_stylized_cel_textures(merged, out_dir, "tide", tex_size=1024)
    apply_baked_material(merged, "tide", albedo_path, emissive_path)

    # 8. Bake all 45 60fps Smash animation clips synced 1:1 to slot-2 ('nesta') real frame data!
    compiler = SmashPoseCompiler(arm_obj, H)
    move_frames = load_slot_move_frames("nesta")
    clips = build_tide_moveset(compiler, move_frames)
    print(f"[build_tide] Baked {len(clips)} 60fps Smash clips synced to nesta slot")

    # 9. Automated Gate V2 Mesh-Stretch Audit
    for tr in arm_obj.animation_data.nla_tracks:
        tr.mute = True
    rest_edges = [
        (merged.data.vertices[e.vertices[1]].co - merged.data.vertices[e.vertices[0]].co).length
        for e in merged.data.edges
    ]
    max_ratio = 0.0
    worst_info = "none"
    ft_f = move_frames.get("Ftilt", (6, 3, 24))[0]
    us_f = move_frames.get("Uspec", (6, 8, 36))[0]
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
    print(f"[build_tide] Gate V2 Stretch Audit: max_spike_ratio={max_ratio:.2f}x ({worst_info})")
    assert max_ratio < 3.5, f"Gate V2 FAIL on tide: {max_ratio:.2f}x in {worst_info}"

    # 10. Export self-contained GLB
    glb_path = os.path.join(out_dir, "tide.glb")
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
    print(f"[build_tide] Exported {glb_path} ({os.path.getsize(glb_path) / 1024.0:.1f} KB)")

    # 11. Render Checkpoint-3 Visual Verification Sheets + 256px Portrait!
    fh_st = move_frames.get("Fheavy", (13, 3, 44))[0]
    j2_st = move_frames.get("Jab2", (3, 2, 15))[0]
    fa_st = move_frames.get("Fair", (7, 4, 30))[0]
    da_st = move_frames.get("Dair", (11, 4, 38))[0]
    sheets = render_vertical_slice_sheets(
        merged,
        arm_obj,
        compiler,
        albedo_path,
        emissive_path,
        out_dir,
        "tide",
        eval_cfg={
            "accent_rgb": (36, 198, 214),
            "fheavy_title": "FHEAVY HYDRO-WHIP TIDAL THRUST",
            "fheavy_frames": (0, 4, fh_st - 2, fh_st, fh_st + 6),
            "move_specs": [
                ("Jab2", j2_st, f"JAB 2 - HYDRO PALM CHOP (f{j2_st})", False),
                ("Fair", fa_st, f"FAIR - WAVE-WHIP SLASH KICK (f{fa_st})", False),
                ("Uspec", us_f, f"USPEC - DOLPHIN SPIRAL ASCENT (f{us_f})", True),
                ("Dair", da_st, f"DAIR - DIVING METEOR HEEL (f{da_st})", False),
            ],
            "ftilt_frame": ft_f,
            "back_label": "3. BACK 3/4 (WAVE CREST + SLEEVES)",
            "closeup_label": "4. CLOSE-UP VISOR + WAVE HAIR",
        },
    )
    meta = {
        "fighter": "tide",
        "triangles": tri_count,
        "bones": [b.name for b in arm_obj.data.bones],
        "clips": clips,
        "glbBytes": os.path.getsize(glb_path),
        "sheets": sheets,
    }
    with open(os.path.join(out_dir, "tide.meta.json"), "w", encoding="utf-8") as f:
        json.dump(meta, f, indent=2)
    print("[build_tide] DONE ->", json.dumps(meta, indent=2))


if __name__ == "__main__":
    build_tide()
