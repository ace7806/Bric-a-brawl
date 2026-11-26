"""Automated 2.5D Cel + Ink-Outline Visual Evaluation Renderer (Gates V1, V2, V3) in Blender 4.0.

Renders multi-angle 360° turntables, pure black-on-white silhouette checks, extreme joint-bend
deformation stress tests, and 5-panel Sakurai Smash timing filmstrips so EVERY character and
animation is visually inspected BEFORE wiring into the game or mass-producing the roster.
"""
from __future__ import annotations

import math
import os
import bpy
from mathutils import Vector
from PIL import Image, ImageDraw, ImageFont

from smash_anims import SemanticPose, SmashPoseCompiler


def _load_font(size: int):
    for p in (
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
        "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",
    ):
        if os.path.isfile(p):
            try:
                return ImageFont.truetype(p, size)
            except OSError:
                pass
    return ImageFont.load_default()


def _setup_cel_preview_material(mesh_obj: bpy.types.Object, albedo_path: str, emissive_path: str) -> None:
    """Apply a crisp 2-band Guilty-Gear / Wind-Waker cel shader + emissive glow for Blender Cycles evaluation renders."""
    mat = bpy.data.materials.new("EVAL_CEL")
    mat.use_nodes = True
    nt = mat.node_tree
    nt.nodes.clear()

    out_n = nt.nodes.new("ShaderNodeOutputMaterial")
    geom = nt.nodes.new("ShaderNodeNewGeometry")

    # Sun direction (front-top-left 3/4 fighting-game key light!)
    sun_vec = nt.nodes.new("ShaderNodeCombineXYZ")
    sun_vec.inputs["X"].default_value = -0.45
    sun_vec.inputs["Y"].default_value = -0.68
    sun_vec.inputs["Z"].default_value = 0.58

    dot_n = nt.nodes.new("ShaderNodeVectorMath")
    dot_n.operation = "DOT_PRODUCT"
    nt.links.new(geom.outputs["Normal"], dot_n.inputs[0])
    nt.links.new(sun_vec.outputs["Vector"], dot_n.inputs[1])

    # Crisp 2-band cel ramp (warm crisp lit band vs rich stylized violet-indigo shadow)
    ramp = nt.nodes.new("ShaderNodeValToRGB")
    ramp.color_ramp.interpolation = "CONSTANT"
    ramp.color_ramp.elements[0].position = 0.0
    ramp.color_ramp.elements[0].color = (0.56, 0.50, 0.64, 1.0)
    ramp.color_ramp.elements[1].position = 0.06
    ramp.color_ramp.elements[1].color = (1.0, 0.99, 0.96, 1.0)
    nt.links.new(dot_n.outputs["Value"], ramp.inputs["Fac"])

    # Crisp directional Fresnel rim light separating silhouette cleanly from backdrop
    lw = nt.nodes.new("ShaderNodeLayerWeight")
    lw.inputs["Blend"].default_value = 0.28
    rim_ramp = nt.nodes.new("ShaderNodeValToRGB")
    rim_ramp.color_ramp.interpolation = "CONSTANT"
    rim_ramp.color_ramp.elements[0].position = 0.0
    rim_ramp.color_ramp.elements[0].color = (0.0, 0.0, 0.0, 1.0)
    rim_ramp.color_ramp.elements[1].position = 0.76
    rim_ramp.color_ramp.elements[1].color = (0.28, 0.24, 0.19, 1.0)
    nt.links.new(lw.outputs["Facing"], rim_ramp.inputs["Fac"])

    alb_img = bpy.data.images.load(albedo_path, check_existing=True)
    alb_tex = nt.nodes.new("ShaderNodeTexImage")
    alb_tex.image = alb_img

    em_img = bpy.data.images.load(emissive_path, check_existing=True)
    em_tex = nt.nodes.new("ShaderNodeTexImage")
    em_tex.image = em_img

    mul = nt.nodes.new("ShaderNodeMix")
    mul.data_type = "RGBA"
    mul.blend_type = "MULTIPLY"
    mul.inputs["Factor"].default_value = 1.0
    nt.links.new(alb_tex.outputs["Color"], mul.inputs["A"])
    nt.links.new(ramp.outputs["Color"], mul.inputs["B"])

    add_rim = nt.nodes.new("ShaderNodeMix")
    add_rim.data_type = "RGBA"
    add_rim.blend_type = "ADD"
    add_rim.inputs["Factor"].default_value = 1.0
    nt.links.new(mul.outputs["Result"], add_rim.inputs["A"])
    nt.links.new(rim_ramp.outputs["Color"], add_rim.inputs["B"])

    # Blend emissive cleanly: where emissive is bright (flame head, lava cracks, eyes), override shadow so it GLOWS!
    em_lum = nt.nodes.new("ShaderNodeRGBToBW")
    nt.links.new(em_tex.outputs["Color"], em_lum.inputs["Color"])
    em_boost = nt.nodes.new("ShaderNodeMath")
    em_boost.operation = "MULTIPLY"
    em_boost.use_clamp = True
    em_boost.inputs[1].default_value = 1.6
    nt.links.new(em_lum.outputs["Val"], em_boost.inputs[0])

    mix_em = nt.nodes.new("ShaderNodeMix")
    mix_em.data_type = "RGBA"
    mix_em.blend_type = "MIX"
    nt.links.new(em_boost.outputs["Value"], mix_em.inputs["Factor"])
    nt.links.new(add_rim.outputs["Result"], mix_em.inputs["A"])
    nt.links.new(em_tex.outputs["Color"], mix_em.inputs["B"])

    em_out = nt.nodes.new("ShaderNodeEmission")
    em_out.inputs["Strength"].default_value = 1.0
    nt.links.new(mix_em.outputs["Result"], em_out.inputs["Color"])
    nt.links.new(em_out.outputs["Emission"], out_n.inputs["Surface"])

    mesh_obj.data.materials.clear()
    mesh_obj.data.materials.append(mat)


def _add_inverted_hull_outline(mesh_obj: bpy.types.Object, thickness: float = 0.009) -> bpy.types.Object:
    """Create a clean BackSide skinned inverted-hull comic ink outline identical to Three.js THREE.BackSide!

    Pushes a single copy outward along averaged smooth vertex normals (NO Solidify double-shell overlap!)
    and uses MixShader(Fac=Backfacing, 1=Transparent, 2=Ink) so front faces are 100% invisible and only
    far silhouette rim faces render crisp dark comic ink!
    """
    out_obj = mesh_obj.copy()
    out_obj.data = mesh_obj.data.copy()
    out_obj.name = f"{mesh_obj.name}_Outline"
    bpy.context.scene.collection.objects.link(out_obj)

    # Push vertices directly outward along smooth vertex normals in rest space (stays 100% rigged to Armature!)
    me = out_obj.data
    me.update()
    for v in me.vertices:
        v.co = v.co + v.normal * thickness
    me.update()

    mat = bpy.data.materials.new("EVAL_INK_OUTLINE")
    mat.use_nodes = True
    nt = mat.node_tree
    nt.nodes.clear()
    out_n = nt.nodes.new("ShaderNodeOutputMaterial")
    geom = nt.nodes.new("ShaderNodeNewGeometry")
    trans = nt.nodes.new("ShaderNodeBsdfTransparent")
    ink = nt.nodes.new("ShaderNodeEmission")
    ink.inputs["Color"].default_value = (0.04, 0.03, 0.05, 1.0)
    mix = nt.nodes.new("ShaderNodeMixShader")
    # Outward normals: camera-facing front faces have Backfacing=0 -> Transparent; far silhouette rim has Backfacing=1 -> Ink!
    nt.links.new(geom.outputs["Backfacing"], mix.inputs["Fac"])
    nt.links.new(trans.outputs["BSDF"], mix.inputs[1])
    nt.links.new(ink.outputs["Emission"], mix.inputs[2])
    nt.links.new(mix.outputs["Shader"], out_n.inputs["Surface"])

    out_obj.data.materials.clear()
    out_obj.data.materials.append(mat)
    return out_obj


def _setup_studio_scene(width: int = 520, height: int = 520, bg_rgb=(0.89, 0.84, 0.76)) -> bpy.types.Object:
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.cycles.device = "CPU"
    scene.cycles.samples = 16
    scene.cycles.use_denoising = False
    scene.cycles.max_bounces = 2
    scene.cycles.transparent_max_bounces = 8
    scene.render.resolution_x = width
    scene.render.resolution_y = height
    scene.render.image_settings.file_format = "PNG"
    scene.view_settings.view_transform = "Standard"

    world = bpy.data.worlds.new("EvalWorld")
    scene.world = world
    world.use_nodes = True
    bg = world.node_tree.nodes.get("Background")
    if bg:
        bg.inputs["Color"].default_value = (bg_rgb[0], bg_rgb[1], bg_rgb[2], 1.0)
        bg.inputs["Strength"].default_value = 1.0

    # Clean warm sandstone plinth disk matching Style B concept art presentation
    bpy.ops.mesh.primitive_cylinder_add(vertices=32, radius=1.25, depth=0.04, location=(0, 0, -0.02))
    floor = bpy.context.active_object
    floor.name = "EvalFloor"
    fmat = bpy.data.materials.new("EvalFloorMat")
    fmat.use_nodes = True
    nt = fmat.node_tree
    nt.nodes.clear()
    out_n = nt.nodes.new("ShaderNodeOutputMaterial")
    em = nt.nodes.new("ShaderNodeEmission")
    em.inputs["Color"].default_value = (0.76, 0.70, 0.61, 1.0)
    nt.links.new(em.outputs["Emission"], out_n.inputs["Surface"])
    floor.data.materials.append(fmat)

    cam_data = bpy.data.cameras.new("EvalCam")
    cam_data.lens = 52.0
    cam_obj = bpy.data.objects.new("EvalCam", cam_data)
    bpy.context.scene.collection.objects.link(cam_obj)
    scene.camera = cam_obj
    return cam_obj


def _aim_camera(cam_obj: bpy.types.Object, pos: Vector, target: Vector, lens: float = 52.0) -> None:
    cam_obj.data.lens = lens
    cam_obj.location = pos
    direction = (target - pos).normalized()
    cam_obj.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()


def _compose_strip(
    panel_paths: list[tuple[str, str]],
    title: str,
    out_path: str,
    accent_rgb: tuple[int, int, int] = (238, 128, 30),
) -> None:
    """Stitch rendered panels horizontally with crisp typography header & per-panel labels."""
    imgs = [Image.open(p).convert("RGB") for p, _ in panel_paths]
    pw, ph = imgs[0].size
    header_h = 48
    footer_h = 38
    pad = 10
    total_w = len(imgs) * pw + (len(imgs) + 1) * pad
    total_h = header_h + ph + footer_h + pad
    canvas = Image.new("RGB", (total_w, total_h), (26, 26, 30))
    draw = ImageDraw.Draw(canvas)
    font_title = _load_font(18)
    font_label = _load_font(15)
    draw.rectangle([(0, 0), (total_w, header_h - 4)], fill=(18, 20, 25))
    draw.rectangle([(0, header_h - 4), (total_w, header_h)], fill=accent_rgb)
    draw.text((16, 12), title, fill=(248, 244, 236), font=font_title)

    for i, (im, (_, label)) in enumerate(zip(imgs, panel_paths)):
        x0 = pad + i * (pw + pad)
        y0 = header_h
        canvas.paste(im, (x0, y0))
        draw.rectangle([(x0, y0 + ph), (x0 + pw, y0 + ph + footer_h)], fill=(34, 36, 42))
        draw.text((x0 + 12, y0 + ph + 10), label, fill=(242, 238, 230), font=font_label)

    canvas.save(out_path, optimize=True)


def render_vertical_slice_sheets(
    mesh_obj: bpy.types.Object,
    arm_obj: bpy.types.Object,
    compiler: SmashPoseCompiler,
    albedo_path: str,
    emissive_path: str,
    out_dir: str,
    fighter_label: str,
    eval_cfg: dict | None = None,
) -> dict[str, str]:
    """Render all visual verification sheets (Turntable, Silhouette+Stress, Fheavy Strip, Core Moves, Portrait)."""
    os.makedirs(out_dir, exist_ok=True)
    tmp_dir = os.path.join(out_dir, "_panels")
    os.makedirs(tmp_dir, exist_ok=True)

    cfg = eval_cfg or {}
    accent_rgb = cfg.get("accent_rgb", (238, 128, 30))
    fh_title = cfg.get("fheavy_title", "FHEAVY BLAZING HAYMAKER")
    fh_frames = cfg.get("fheavy_frames", (0, 6, 12, 14, 20))
    mv_specs = cfg.get(
        "move_specs",
        [
            ("Jab2", 4, "JAB 2 - RIGHT CROSS HOOK (f4)", False),
            ("Fair", 8, "FAIR - BLAZING FALCON KNEE (f8)", False),
            ("Uspec", 6, "USPEC - SHORYUKEN UPPERCUT (f6)", True),
            ("Dair", 13, "DAIR - METEOR STOMP (f13)", False),
        ],
    )
    ftilt_f = int(cfg.get("ftilt_frame", 7))
    back_label = cfg.get("back_label", "3. BACK 3/4 (SCARF + FLAME)")
    closeup_label = cfg.get("closeup_label", "4. CLOSE-UP HEAD + GEAR")

    # Detach NLA so we can pose cleanly frame-by-frame
    if arm_obj.animation_data:
        for tr in arm_obj.animation_data.nla_tracks:
            tr.mute = True
        arm_obj.animation_data.action = None

    _setup_cel_preview_material(mesh_obj, albedo_path, emissive_path)
    outline_obj = _add_inverted_hull_outline(mesh_obj, thickness=0.0085)
    cam = _setup_studio_scene(520, 520)
    scene = bpy.context.scene
    H = compiler.H
    cam_scale = max(0.95, H / 1.64)

    def snap_action(action_name: str, frame: int, cam_pos: Vector, cam_tgt: Vector, fname: str, lens: float = 52.0) -> str:
        act = bpy.data.actions[action_name]
        arm_obj.animation_data.action = act
        scene.frame_set(frame)
        bpy.context.view_layer.update()
        _aim_camera(cam, cam_pos, cam_tgt, lens=lens)
        path = os.path.join(tmp_dir, fname)
        scene.render.filepath = path
        bpy.ops.render.render(write_still=True)
        arm_obj.animation_data.action = None
        return path

    # Gameplay 2.5D side-3/4 camera from -X angled toward -Y so attacks read cleanly LEFT -> RIGHT!
    side_cam = Vector((-3.85 * cam_scale, -1.45 * cam_scale, 1.05 * cam_scale))
    side_tgt = Vector((0.0, -0.18, 0.54 * H))

    # --- SHEET 1: 4-Angle 360 Turntable (Gate V2) ---
    close_path = snap_action(
        "Idle", 0,
        Vector((-0.88 * cam_scale, -2.02 * cam_scale, 0.80 * H)),
        Vector((0.0, -0.02, 0.74 * H)),
        "tt_closeup.png",
        lens=56.0,
    )
    turntable_panels = [
        (snap_action("Idle", 0, Vector((-1.65 * cam_scale, -3.35 * cam_scale, 0.65 * H)), Vector((0.0, 0.0, 0.55 * H)), "tt_front34.png"), "1. FRONT 3/4 HERO"),
        (snap_action("Idle", 0, side_cam, side_tgt, "tt_side.png"), "2. GAMEPLAY 2.5D SIDE"),
        (snap_action("Idle", 0, Vector((2.10 * cam_scale, 3.15 * cam_scale, 0.70 * H)), Vector((0.0, 0.0, 0.55 * H)), "tt_back34.png"), back_label),
        (close_path, closeup_label),
    ]
    sheet_tt = os.path.join(out_dir, f"{fighter_label}_turntable.png")
    _compose_strip(turntable_panels, f"GATE V2 - {fighter_label.upper()} 360° STYLIZED LOW-POLY TURNTABLE (CC0 ANATOMY + CEL + INK OUTLINE)", sheet_tt, accent_rgb)

    # Save crisp 256x256 portrait directly from the close-up hero render!
    portrait_path = os.path.join(out_dir, f"{fighter_label}_portrait.png")
    Image.open(close_path).convert("RGB").resize((256, 256), Image.Resampling.LANCZOS).save(portrait_path, optimize=True)

    # --- SHEET 2: 5-Panel Sakurai Smash Timing Strip (Gate V3) ---
    f0, f1, f2, f3, f4 = fh_frames
    fheavy_panels = [
        (snap_action("Fheavy", f0, side_cam, side_tgt, "fh_0.png"), f"1. IDLE STANCE (f{f0})"),
        (snap_action("Fheavy", f1, side_cam, side_tgt, "fh_1.png"), f"2. EXTREME COIL (f{f1})"),
        (snap_action("Fheavy", f2, side_cam, side_tgt, "fh_2.png"), f"3. PRE-SNAP HOLD (f{f2})"),
        (snap_action("Fheavy", f3, side_cam, side_tgt, "fh_3.png"), f"4. ACTIVE IMPACT + POP (f{f3})"),
        (snap_action("Fheavy", f4, side_cam, side_tgt, "fh_4.png"), f"5. OVERSHOOT FOLLOW-THROUGH (f{f4})"),
    ]
    sheet_fh = os.path.join(out_dir, f"{fighter_label}_strip_fheavy.png")
    _compose_strip(fheavy_panels, f"GATE V3 - {fighter_label.upper()} {fh_title} (SAKURAI TIMING + 2-BONE IK FOOT LOCK)", sheet_fh, accent_rgb)

    # --- SHEET 3: 4-Panel Signature Smash Moves Showcase (Gate V3) ---
    moves_panels = []
    for idx, (aname, afrm, alabel, tall_cam) in enumerate(mv_specs):
        cpos = Vector((-3.65 * cam_scale, -1.25 * cam_scale, 0.72 * H)) if tall_cam else side_cam
        ctgt = Vector((0.0, -0.05, 0.64 * H)) if tall_cam else side_tgt
        moves_panels.append((snap_action(aname, afrm, cpos, ctgt, f"mv_{idx}.png"), alabel))
    sheet_mv = os.path.join(out_dir, f"{fighter_label}_signature_moves.png")
    _compose_strip(moves_panels, f"GATE V3 - {fighter_label.upper()} SIGNATURE SMASH MOVESET SHOWCASE", sheet_mv, accent_rgb)

    # --- SHEET 4: Gate V1 Pure Black Silhouette + Gate V2 Joint-Bend Deformation Stress Audit ---
    stress_panels = [
        (snap_action("JumpSquat", 2, Vector((-2.6 * cam_scale, -2.1 * cam_scale, 0.56 * H)), Vector((0, 0, 0.44 * H)), "st_squat.png"), "STRESS 1: DEEP SQUAT (KNEES)"),
        (snap_action("Ftilt", ftilt_f, side_cam, side_tgt, "st_kick.png"), f"STRESS 2: FTILT EXTENSION (f{ftilt_f})"),
        (snap_action("Tumble", 6, side_cam, side_tgt, "st_tumble.png"), "STRESS 3: LAUNCH TUMBLE (SPINE)"),
    ]
    orig_mat = mesh_obj.data.materials[0]
    sil_mat = bpy.data.materials.new("EVAL_SILHOUETTE")
    sil_mat.use_nodes = True
    snt = sil_mat.node_tree
    snt.nodes.clear()
    sout = snt.nodes.new("ShaderNodeOutputMaterial")
    sem = snt.nodes.new("ShaderNodeEmission")
    sem.inputs["Color"].default_value = (0.0, 0.0, 0.0, 1.0)
    snt.links.new(sem.outputs["Emission"], sout.inputs["Surface"])
    mesh_obj.data.materials[0] = sil_mat
    outline_obj.hide_render = True
    bpy.data.objects["EvalFloor"].hide_render = True
    scene.world.node_tree.nodes["Background"].inputs["Color"].default_value = (1.0, 1.0, 1.0, 1.0)
    sil_path = snap_action("Fheavy", f3, Vector((-4.6 * cam_scale, -1.35 * cam_scale, 0.64 * H)), Vector((0.0, -0.15, 0.56 * H)), "sil_fheavy.png")
    stress_panels.insert(0, (sil_path, "GATE V1: GAMEPLAY SILHOUETTE"))

    # Restore preview state
    mesh_obj.data.materials[0] = orig_mat
    outline_obj.hide_render = False
    bpy.data.objects["EvalFloor"].hide_render = False

    sheet_st = os.path.join(out_dir, f"{fighter_label}_silhouette_stress.png")
    _compose_strip(stress_panels, f"GATES V1 & V2 - {fighter_label.upper()} SILHOUETTE READABILITY & EXTREME JOINT-DEFORMATION STRESS AUDIT", sheet_st, accent_rgb)

    # Cleanup eval outline helper
    bpy.data.objects.remove(outline_obj, do_unlink=True)
    if arm_obj.animation_data:
        for tr in arm_obj.animation_data.nla_tracks:
            tr.mute = False

    return {
        "turntable": sheet_tt,
        "fheavy_strip": sheet_fh,
        "signature_moves": sheet_mv,
        "silhouette_stress": sheet_st,
        "portrait": portrait_path,
    }
