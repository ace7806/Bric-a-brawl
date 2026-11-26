"""Render the 4-Fighter Style B 3D Roster Lineup (Ignis, Basalt, Tide, Zephyr) + Gate V1 Silhouette Comparison & IoU.

Loads all 4 exported GLBs side-by-side on a sculpted stone plinth in their signature Idle combat stances,
renders a full-color 2-band cel + comic ink outline hero lineup, AND computes pairwise Gate V1 Silhouette IoU!

Run via:
  PYTHONPATH=/usr/lib/python3/dist-packages blender --background --python assets-src/elemental/render_lineup.py
"""
from __future__ import annotations

import json
import math
import os
import sys
import bpy
import numpy as np
from mathutils import Vector
from PIL import Image, ImageDraw

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
if SCRIPT_DIR not in sys.path:
    sys.path.insert(0, SCRIPT_DIR)

from eval_render import (
    _add_inverted_hull_outline,
    _aim_camera,
    _load_font,
    _setup_cel_preview_material,
    _setup_studio_scene,
)


def _import_fighter(name: str, x_pos: float, yaw_deg: float) -> tuple[bpy.types.Object, bpy.types.Object]:
    out_dir = os.path.join(SCRIPT_DIR, "out", name)
    glb_path = os.path.join(out_dir, f"{name}.glb")
    albedo_path = os.path.join(out_dir, f"{name}_albedo.png")
    emissive_path = os.path.join(out_dir, f"{name}_emissive.png")

    before = set(bpy.data.objects)
    before_acts = set(bpy.data.actions)
    bpy.ops.import_scene.gltf(filepath=glb_path)
    added = [o for o in bpy.data.objects if o not in before]
    added_acts = [a for a in bpy.data.actions if a not in before_acts]

    arm = next(o for o in added if o.type == "ARMATURE")
    mesh = next(o for o in added if o.type == "MESH" and name in o.name.lower())

    # Remove glTF Icosphere bone shape helper if present
    for o in added:
        if o.type == "MESH" and o is not mesh:
            bpy.data.objects.remove(o, do_unlink=True)

    # Pose cleanly in frame 0 of THIS fighter's own Idle action!
    idle_act = next((a for a in added_acts if a.name.startswith("Idle")), None)
    if idle_act is None:
        idle_act = next((a for a in added_acts if "Idle" in a.name), None)
    if idle_act is not None:
        if arm.animation_data is None:
            arm.animation_data_create()
        for tr in arm.animation_data.nla_tracks:
            tr.mute = True
        arm.animation_data.action = idle_act

    arm.location = Vector((x_pos, 0.0, 0.0))
    arm.rotation_euler = (0.0, 0.0, math.radians(yaw_deg))
    bpy.context.scene.frame_set(0)
    bpy.context.view_layer.update()

    _setup_cel_preview_material(mesh, albedo_path, emissive_path)
    return arm, mesh


def render_roster_lineup() -> None:
    out_root = os.path.join(SCRIPT_DIR, "out")
    os.makedirs(out_root, exist_ok=True)
    bpy.ops.wm.read_factory_settings(use_empty=True)

    cam = _setup_studio_scene(width=1600, height=760, bg_rgb=(0.88, 0.82, 0.72))
    scene = bpy.context.scene

    # Replace small plinth disk with a wide sculpted stone arena ledge matching Style B lineup art!
    old_floor = bpy.data.objects.get("EvalFloor")
    if old_floor:
        bpy.data.objects.remove(old_floor, do_unlink=True)
    bpy.ops.mesh.primitive_cube_add(size=1.0, location=(0.0, 0.12, -0.18))
    ledge = bpy.context.active_object
    ledge.name = "RosterLedge"
    ledge.scale = (6.8, 1.5, 0.36)
    lmat = bpy.data.materials.new("LedgeMat")
    lmat.use_nodes = True
    lnt = lmat.node_tree
    lnt.nodes.clear()
    lout = lnt.nodes.new("ShaderNodeOutputMaterial")
    lem = lnt.nodes.new("ShaderNodeEmission")
    lem.inputs["Color"].default_value = (0.64, 0.56, 0.45, 1.0)
    lnt.links.new(lem.outputs["Emission"], lout.inputs["Surface"])
    ledge.data.materials.append(lmat)

    specs = [
        ("ignis", -1.90, 14.0),
        ("basalt", -0.60, 6.0),
        ("tide", 0.72, -8.0),
        ("zephyr", 1.90, -14.0),
    ]
    rigs: list[tuple[str, bpy.types.Object, bpy.types.Object, bpy.types.Object]] = []
    for name, xp, yaw in specs:
        arm, mesh = _import_fighter(name, xp, yaw)
        outline = _add_inverted_hull_outline(mesh, thickness=0.0085)
        rigs.append((name, arm, mesh, outline))

    scene.frame_set(0)
    bpy.context.view_layer.update()

    # 1. Full-Color Cel-Shaded 4-Fighter Style B Lineup Render (generous margins on both sides!)
    _aim_camera(cam, Vector((0.0, -8.55, 1.24)), Vector((0.0, 0.0, 0.94)), lens=48.0)
    raw_lineup = os.path.join(out_root, "_lineup_raw.png")
    scene.render.filepath = raw_lineup
    bpy.ops.render.render(write_still=True)

    # Compose crisp framed header + character labels
    im = Image.open(raw_lineup).convert("RGB")
    header_h = 54
    footer_h = 46
    canvas = Image.new("RGB", (im.width, header_h + im.height + footer_h), (24, 24, 28))
    draw = ImageDraw.Draw(canvas)
    f_title = _load_font(20)
    f_lbl = _load_font(16)
    draw.rectangle([(0, 0), (im.width, header_h - 4)], fill=(18, 20, 25))
    draw.rectangle([(0, header_h - 4), (im.width, header_h)], fill=(238, 128, 30))
    draw.text((20, 14), "CHECKPOINT 3 - STYLE B ELEMENTAL WARRIORS 3D ROSTER LINEUP (REAL BLENDER GLBs AT TRUE SCALE)", fill=(248, 244, 236), font=f_title)
    canvas.paste(im, (0, header_h))

    draw.rectangle([(0, header_h + im.height), (im.width, header_h + im.height + footer_h)], fill=(32, 34, 40))
    labels = [
        ("FIRE - IGNIS (1.64m)", (255, 138, 56), 0.175),
        ("ROCK - BASALT (1.82m)", (230, 165, 92), 0.400),
        ("WATER - TIDE (1.56m)", (76, 224, 234), 0.625),
        ("AIR - ZEPHYR (1.54m)", (128, 234, 198), 0.840),
    ]
    for txt, col, xf in labels:
        draw.text((int(im.width * xf) - 96, header_h + im.height + 13), txt, fill=col, font=f_lbl)
    lineup_path = os.path.join(out_root, "roster_lineup_3d.png")
    canvas.save(lineup_path, optimize=True)

    # 2. Gate V1 Pure Black-on-White Silhouette Lineup + Pairwise Silhouette IoU!
    sil_mat = bpy.data.materials.new("LINEUP_SIL")
    sil_mat.use_nodes = True
    snt = sil_mat.node_tree
    snt.nodes.clear()
    sout = snt.nodes.new("ShaderNodeOutputMaterial")
    sem = snt.nodes.new("ShaderNodeEmission")
    sem.inputs["Color"].default_value = (0.0, 0.0, 0.0, 1.0)
    snt.links.new(sem.outputs["Emission"], sout.inputs["Surface"])

    ledge.hide_render = True
    scene.world.node_tree.nodes["Background"].inputs["Color"].default_value = (1.0, 1.0, 1.0, 1.0)
    for _, _, mesh, outline in rigs:
        mesh.data.materials[0] = sil_mat
        outline.hide_render = True

    raw_sil = os.path.join(out_root, "_lineup_sil_raw.png")
    scene.render.filepath = raw_sil
    bpy.ops.render.render(write_still=True)

    sil_im = Image.open(raw_sil).convert("RGB")
    sil_canvas = Image.new("RGB", (sil_im.width, header_h + sil_im.height + footer_h), (24, 24, 28))
    sdraw = ImageDraw.Draw(sil_canvas)
    sdraw.rectangle([(0, 0), (sil_im.width, header_h - 4)], fill=(18, 20, 25))
    sdraw.rectangle([(0, header_h - 4), (sil_im.width, header_h)], fill=(96, 206, 170))
    sdraw.text((20, 14), "GATE V1 - 4-FIGHTER SILHOUETTE READABILITY AUDIT (PURE BLACK-ON-WHITE AT GAMEPLAY DISTANCE)", fill=(248, 244, 236), font=f_title)
    sil_canvas.paste(sil_im, (0, header_h))
    sdraw.rectangle([(0, header_h + sil_im.height), (sil_im.width, header_h + sil_im.height + footer_h)], fill=(32, 34, 40))
    for txt, col, xf in labels:
        sdraw.text((int(sil_im.width * xf) - 105, header_h + sil_im.height + 13), txt, fill=col, font=f_lbl)
    sil_path = os.path.join(out_root, "roster_silhouettes_3d.png")
    sil_canvas.save(sil_path, optimize=True)

    # Compute true centered pairwise silhouette IoU (each fighter centered at X=0 in 384x384!)
    scene.render.resolution_x = 384
    scene.render.resolution_y = 384
    _aim_camera(cam, Vector((-3.6, -1.35, 1.0)), Vector((0.0, 0.0, 0.92)), lens=52.0)
    masks: dict[str, np.ndarray] = {}
    for name, arm, mesh, _ in rigs:
        for _, o_arm, o_mesh, _ in rigs:
            o_mesh.hide_render = o_mesh is not mesh
        old_loc = arm.location.copy()
        arm.location = Vector((0.0, 0.0, 0.0))
        bpy.context.view_layer.update()
        p = os.path.join(out_root, f"_iou_{name}.png")
        scene.render.filepath = p
        bpy.ops.render.render(write_still=True)
        arr = np.array(Image.open(p).convert("L")) < 128
        masks[name] = arr
        arm.location = old_loc

    names = [s[0] for s in specs]
    ious: dict[str, float] = {}
    for i in range(len(names)):
        for j in range(i + 1, len(names)):
            a, b = masks[names[i]], masks[names[j]]
            inter = float(np.logical_and(a, b).sum())
            union = float(np.logical_or(a, b).sum())
            ious[f"{names[i]}_vs_{names[j]}"] = round(inter / max(1.0, union), 3)

    iou_out = os.path.join(out_root, "roster_silhouette_iou.json")
    with open(iou_out, "w", encoding="utf-8") as f:
        json.dump({"pairwiseIoU": ious, "maxIoU": max(ious.values())}, f, indent=2)
    print(f"[render_lineup] DONE -> lineup={lineup_path}, sil={sil_path}, pairwiseIoU={ious}")


if __name__ == "__main__":
    render_roster_lineup()
