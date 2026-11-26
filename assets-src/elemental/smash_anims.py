"""AI-First Pose-Space + Analytic 2-Bone IK + Sakurai Timing Smash Animation Compiler.

Compiles semantic martial-arts keyframes (world-space hip offsets, camera-cheat torso twists,
planted foot IK targets, striking hand/knee IK targets, Sakurai active limb scale pop, and
secondary flame/scarf whip) into frame-exact 60fps Blender Actions ready for glTF export.

Coordinate space (Blender Z-up, -Y forward):
  - Forward (toward opponent): -Y
  - Up: +Z
  - Anatomical Left: +X, Right: -X
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field
import bpy
from mathutils import Euler, Matrix, Quaternion, Vector


def _rot_mat(pitch_fwd_deg: float = 0.0, roll_left_deg: float = 0.0, yaw_left_deg: float = 0.0) -> Matrix:
    """Build intuitive 3x3 world rotation matrix for character facing -Y, Z-up, +X left."""
    rx = math.radians(pitch_fwd_deg)  # +X rotation pitches +Z forward toward -Y
    ry = math.radians(roll_left_deg)  # +Y rotation tilts +Z toward +X (left)
    rz = math.radians(yaw_left_deg)   # +Z rotation turns -Y toward +X (left)
    return (Euler((0.0, 0.0, rz), "XYZ").to_matrix() @
            Euler((rx, 0.0, 0.0), "XYZ").to_matrix() @
            Euler((0.0, ry, 0.0), "XYZ").to_matrix())


def _aim_matrix(origin: Vector, target: Vector, hint_dir: Vector) -> Matrix:
    """Build 4x4 bone world matrix whose +Y axis points origin->target and +Z aligns cleanly with hint_dir."""
    y_axis = target - origin
    if y_axis.length < 1e-6:
        y_axis = Vector((0.0, 0.0, 1.0))
    else:
        y_axis.normalize()
    z_proj = hint_dir - y_axis * hint_dir.dot(y_axis)
    if z_proj.length < 1e-5:
        alt = Vector((1.0, 0.0, 0.0)) if abs(y_axis.x) < 0.9 else Vector((0.0, 1.0, 0.0))
        z_proj = alt - y_axis * alt.dot(y_axis)
    z_axis = z_proj.normalized()
    x_axis = y_axis.cross(z_axis).normalized()
    z_axis = x_axis.cross(y_axis).normalized()
    m = Matrix((
        (x_axis.x, y_axis.x, z_axis.x, origin.x),
        (x_axis.y, y_axis.y, z_axis.y, origin.y),
        (x_axis.z, y_axis.z, z_axis.z, origin.z),
        (0.0, 0.0, 0.0, 1.0),
    ))
    return m


def solve_2bone_ik(
    root: Vector,
    target: Vector,
    l1: float,
    l2: float,
    pole: Vector,
) -> tuple[Vector, Vector]:
    """Exact analytic 2-bone IK returning (mid_joint_pos, clamped_end_pos) with zero backward joint flips."""
    to_t = target - root
    dist = to_t.length
    min_d = abs(l1 - l2) + 0.015
    max_d = (l1 + l2) * 0.996
    if dist < 1e-5:
        fwd = (pole - root).normalized()
        return root + fwd * l1, root + fwd * (l1 - l2)
    clamped = max(min_d, min(max_d, dist))
    dir_t = to_t / dist
    end_pos = root + dir_t * clamped

    # Law of cosines for angle at root
    cos_a = max(-1.0, min(1.0, (l1 * l1 + clamped * clamped - l2 * l2) / (2.0 * l1 * clamped)))
    sin_a = math.sqrt(max(0.0, 1.0 - cos_a * cos_a))

    # Bend plane defined strictly toward pole vector!
    pole_v = pole - root
    bend_dir = pole_v - dir_t * pole_v.dot(dir_t)
    if bend_dir.length < 1e-5:
        bend_dir = Vector((0.0, -1.0, 0.0)) - dir_t * (-dir_t.y)
        if bend_dir.length < 1e-5:
            bend_dir = Vector((1.0, 0.0, 0.0))
    bend_dir.normalize()

    mid_pos = root + dir_t * (l1 * cos_a) + bend_dir * (l1 * sin_a)
    return mid_pos, end_pos


@dataclass
class SemanticPose:
    """High-level martial-arts keyframe authored in normalized character units (H = fighter height)."""
    hip_off: tuple[float, float, float] = (0.0, 0.0, 0.0)      # (x_left, y_back, z_up) in H fractions
    hips_rot: tuple[float, float, float] = (0.0, 0.0, 0.0)     # (pitch_fwd, roll_left, yaw_left) deg
    spine_rot: tuple[float, float, float] = (0.0, 0.0, 0.0)
    chest_rot: tuple[float, float, float] = (0.0, 0.0, 0.0)
    head_rot: tuple[float, float, float] = (0.0, 0.0, 0.0)
    # Hand IK targets in character space (x_left, y_back, z_up) as fractions of H (None = rest)
    hand_l: tuple[float, float, float] | None = None
    hand_r: tuple[float, float, float] | None = None
    elbow_pole_l: tuple[float, float, float] = (0.45, 0.45, 0.55)
    elbow_pole_r: tuple[float, float, float] = (-0.45, 0.45, 0.55)
    # Foot IK targets in character space (z ~ 0.068 = flat planted on ground!)
    foot_l: tuple[float, float, float] | None = None
    foot_r: tuple[float, float, float] | None = None
    knee_pole_l: tuple[float, float, float] = (0.22, -0.65, 0.35)
    knee_pole_r: tuple[float, float, float] = (-0.22, -0.65, 0.35)
    # Sakurai active striking-limb scale exaggeration!
    scale_hand_l: float = 1.0
    scale_hand_r: float = 1.0
    scale_foot_l: float = 1.0
    scale_foot_r: float = 1.0
    # Secondary physics drag for flame crest & scarf tail (pitch_back_deg, yaw_deg)
    flame_drag: tuple[float, float] = (0.0, 0.0)
    scarf_drag: tuple[float, float] = (0.0, 0.0)
    # Optional weapon local orientation & active scale pop (e.g. Zephyr's twin-tip gale staff!)
    weapon_rot: tuple[float, float, float] = (0.0, 0.0, 0.0)
    scale_weapon: float = 1.0
    # Optional full-body tumble/spin pitch/roll around CoM
    root_rot: tuple[float, float, float] = (0.0, 0.0, 0.0)


@dataclass
class KeySpec:
    frame: int
    pose: SemanticPose
    interp: str = "BEZIER"  # 'SNAP' (2f explosive), 'HOLD' (CONSTANT), 'EASE_OUT', 'EASE_IN', 'LINEAR', 'BEZIER'


class SmashPoseCompiler:
    """Solves SemanticPose -> exact local bone transforms and bakes 60fps Actions on the canonical rig."""

    def __init__(self, arm_obj: bpy.types.Object, height: float) -> None:
        self.arm_obj = arm_obj
        self.arm = arm_obj.data
        self.H = height
        self.rest_world: dict[str, Matrix] = {}
        self.rest_local: dict[str, Matrix] = {}
        self.bone_len: dict[str, float] = {}
        self.parent_name: dict[str, str | None] = {}
        for b in self.arm.bones:
            self.rest_world[b.name] = b.matrix_local.copy()
            self.bone_len[b.name] = b.length
            self.parent_name[b.name] = b.parent.name if b.parent else None
            if b.parent:
                self.rest_local[b.name] = b.parent.matrix_local.inverted() @ b.matrix_local
            else:
                self.rest_local[b.name] = b.matrix_local.copy()

    def _rest_bone_rot_apply(self, bname: str, world_origin: Vector, delta_rot_3x3: Matrix) -> Matrix:
        """Rotate bone's rest orientation by a clean world delta_rot_3x3 and place at world_origin."""
        r_rest = self.rest_world[bname].to_3x3()
        r_new = delta_rot_3x3 @ r_rest
        m = r_new.to_4x4()
        m.translation = world_origin
        return m

    def solve_pose(self, p: SemanticPose) -> dict[str, tuple[Vector, Quaternion, Vector]]:
        """Compute local matrix_basis (loc, quat, scale) for every bone from a SemanticPose."""
        H = self.H
        solved_world: dict[str, Matrix] = {}
        scales: dict[str, Vector] = {}

        # 0) Root (usually identity; tilted for tumble/air-spin around CoM)
        if p.root_rot != (0.0, 0.0, 0.0):
            com = Vector((0.0, 0.0, 0.50 * H))
            rr = _rot_mat(*p.root_rot).to_4x4()
            m_root = Matrix.Translation(com) @ rr @ Matrix.Translation(-com) @ self.rest_world["Root"]
        else:
            m_root = self.rest_world["Root"].copy()
        solved_world["Root"] = m_root

        root_delta_3x3 = (m_root @ self.rest_world["Root"].inverted()).to_3x3()

        def xform_pt(v: Vector) -> Vector:
            if p.root_rot == (0.0, 0.0, 0.0):
                return v
            com = Vector((0.0, 0.0, 0.50 * H))
            return com + root_delta_3x3 @ (v - com)

        # 1) Spine chain: Hips -> Spine -> Chest -> Neck -> Head
        r_hips = root_delta_3x3 @ _rot_mat(*p.hips_rot)
        hips_pos = xform_pt(self.rest_world["Hips"].translation + Vector(p.hip_off) * H)
        solved_world["Hips"] = self._rest_bone_rot_apply("Hips", hips_pos, r_hips)

        r_spine = r_hips @ _rot_mat(*p.spine_rot)
        spine_pos = hips_pos + r_hips @ (self.rest_world["Spine"].translation - self.rest_world["Hips"].translation)
        solved_world["Spine"] = self._rest_bone_rot_apply("Spine", spine_pos, r_spine)

        r_chest = r_spine @ _rot_mat(*p.chest_rot)
        chest_pos = spine_pos + r_spine @ (self.rest_world["Chest"].translation - self.rest_world["Spine"].translation)
        solved_world["Chest"] = self._rest_bone_rot_apply("Chest", chest_pos, r_chest)

        r_neck = r_chest @ _rot_mat(p.head_rot[0] * 0.35, p.head_rot[1] * 0.35, p.head_rot[2] * 0.35)
        neck_pos = chest_pos + r_chest @ (self.rest_world["Neck"].translation - self.rest_world["Chest"].translation)
        solved_world["Neck"] = self._rest_bone_rot_apply("Neck", neck_pos, r_neck)

        r_head = r_chest @ _rot_mat(*p.head_rot)
        head_pos = neck_pos + r_neck @ (self.rest_world["Head"].translation - self.rest_world["Neck"].translation)
        solved_world["Head"] = self._rest_bone_rot_apply("Head", head_pos, r_head)

        # 2) Secondary Flame Crown chain (positive flame_drag whips flame crest BACKWARD toward +Y cleanly!)
        if "Flame.0" in self.rest_world:
            f_off = self.rest_world["Flame.0"].translation - self.rest_world["Head"].translation
            r_f0 = r_head @ _rot_mat(-p.flame_drag[0] * 0.35, 0.0, p.flame_drag[1] * 0.45)
            f0_pos = head_pos + r_head @ f_off
            solved_world["Flame.0"] = self._rest_bone_rot_apply("Flame.0", f0_pos, r_f0)
            if "Flame.1" in self.rest_world:
                f1_off = self.rest_world["Flame.1"].translation - self.rest_world["Flame.0"].translation
                r_f1 = r_f0 @ _rot_mat(-p.flame_drag[0] * 0.45, 0.0, p.flame_drag[1] * 0.55)
                f1_pos = f0_pos + r_f0 @ f1_off
                solved_world["Flame.1"] = self._rest_bone_rot_apply("Flame.1", f1_pos, r_f1)

        # 3) Secondary Billowing Scarf chain (positive scarf_drag lifts scarf tail up/back in wind!)
        if "Scarf.0" in self.rest_world:
            prev_n = "Chest"
            prev_r = r_chest
            prev_p = chest_pos
            for si, mult in enumerate((0.28, 0.36, 0.44)):
                sn = f"Scarf.{si}"
                if sn not in self.rest_world:
                    break
                off = self.rest_world[sn].translation - self.rest_world[prev_n].translation
                cur_p = prev_p + prev_r @ off
                cur_r = prev_r @ _rot_mat(-p.scarf_drag[0] * mult, 0.0, p.scarf_drag[1] * mult)
                solved_world[sn] = self._rest_bone_rot_apply(sn, cur_p, cur_r)
                prev_n, prev_r, prev_p = sn, cur_r, cur_p

        # 4) Arms via exact 2-Bone Analytic IK!
        for sfx, hand_tgt, pole_raw, h_scale in (
            ("L", p.hand_l, p.elbow_pole_l, p.scale_hand_l),
            ("R", p.hand_r, p.elbow_pole_r, p.scale_hand_r),
        ):
            clav_n = f"Shoulder.{sfx}"
            ua_n = f"UpperArm.{sfx}"
            fa_n = f"Forearm.{sfx}"
            hd_n = f"Hand.{sfx}"

            clav_pos = chest_pos + r_chest @ (self.rest_world[clav_n].translation - self.rest_world["Chest"].translation)
            # Slight natural shoulder protraction/elevation toward striking target
            r_clav = r_chest
            if hand_tgt is not None:
                tgt_w = xform_pt(Vector(hand_tgt) * H)
                sh_rest = clav_pos + r_chest @ (self.rest_world[ua_n].translation - self.rest_world[clav_n].translation)
                reach_v = tgt_w - sh_rest
                # Subtle organic clavicle shrug when punching overhead or far forward!
                shrug = max(-10.0, min(22.0, (reach_v.z / H) * 35.0))
                sign = 1.0 if sfx == "L" else -1.0
                r_clav = r_chest @ _rot_mat(0.0, -sign * shrug * 0.4, 0.0)
            solved_world[clav_n] = self._rest_bone_rot_apply(clav_n, clav_pos, r_clav)
            ua_pos = clav_pos + r_clav @ (self.rest_world[ua_n].translation - self.rest_world[clav_n].translation)

            if hand_tgt is None:
                solved_world[ua_n] = self._rest_bone_rot_apply(ua_n, ua_pos, r_clav)
                fa_pos = ua_pos + r_clav @ (self.rest_world[fa_n].translation - self.rest_world[ua_n].translation)
                solved_world[fa_n] = self._rest_bone_rot_apply(fa_n, fa_pos, r_clav)
                hd_pos = fa_pos + r_clav @ (self.rest_world[hd_n].translation - self.rest_world[fa_n].translation)
                solved_world[hd_n] = self._rest_bone_rot_apply(hd_n, hd_pos, r_clav)
            else:
                tgt_w = xform_pt(Vector(hand_tgt) * H)
                pole_w = xform_pt(Vector(pole_raw) * H)
                l1 = self.bone_len[ua_n]
                l2 = self.bone_len[fa_n]
                elbow_pos, wrist_pos = solve_2bone_ik(ua_pos, tgt_w, l1, l2, pole_w)

                # Aim UpperArm -> Elbow, Forearm -> Wrist, Hand -> continues cleanly along Forearm punch axis!
                pole_hint = (pole_w - ua_pos).normalized()
                solved_world[ua_n] = _aim_matrix(ua_pos, elbow_pos, pole_hint)
                solved_world[fa_n] = _aim_matrix(elbow_pos, wrist_pos, pole_hint)
                hand_dir = (wrist_pos - elbow_pos).normalized()
                solved_world[hd_n] = _aim_matrix(wrist_pos, wrist_pos + hand_dir * self.bone_len[hd_n], pole_hint)

            if abs(h_scale - 1.0) > 1e-3:
                scales[hd_n] = Vector((h_scale, h_scale, h_scale))

            if sfx == "R" and "Weapon.R" in self.rest_world:
                w_off = self.rest_world["Weapon.R"].translation - self.rest_world[hd_n].translation
                r_hd = (solved_world[hd_n] @ self.rest_world[hd_n].inverted()).to_3x3()
                r_wpn = r_hd @ _rot_mat(*p.weapon_rot) if p.weapon_rot != (0.0, 0.0, 0.0) else r_hd
                solved_world["Weapon.R"] = self._rest_bone_rot_apply(
                    "Weapon.R", solved_world[hd_n].translation + r_hd @ w_off, r_wpn
                )
                if abs(p.scale_weapon - 1.0) > 1e-3:
                    scales["Weapon.R"] = Vector((p.scale_weapon, p.scale_weapon, p.scale_weapon))

        # 5) Legs via exact 2-Bone Analytic IK (feet locked to ground Z=0, knees point forward toward pole!)
        for sfx, foot_tgt, kpole_raw, f_scale in (
            ("L", p.foot_l, p.knee_pole_l, p.scale_foot_l),
            ("R", p.foot_r, p.knee_pole_r, p.scale_foot_r),
        ):
            th_n = f"Thigh.{sfx}"
            sh_n = f"Shin.{sfx}"
            ft_n = f"Foot.{sfx}"
            to_n = f"Toe.{sfx}"

            hip_j = hips_pos + r_hips @ (self.rest_world[th_n].translation - self.rest_world["Hips"].translation)
            if foot_tgt is None:
                solved_world[th_n] = self._rest_bone_rot_apply(th_n, hip_j, r_hips)
                kn_j = hip_j + r_hips @ (self.rest_world[sh_n].translation - self.rest_world[th_n].translation)
                solved_world[sh_n] = self._rest_bone_rot_apply(sh_n, kn_j, r_hips)
                an_j = kn_j + r_hips @ (self.rest_world[ft_n].translation - self.rest_world[sh_n].translation)
                solved_world[ft_n] = self._rest_bone_rot_apply(ft_n, an_j, r_hips)
                to_j = an_j + r_hips @ (self.rest_world[to_n].translation - self.rest_world[ft_n].translation)
                solved_world[to_n] = self._rest_bone_rot_apply(to_n, to_j, r_hips)
            else:
                tgt_w = xform_pt(Vector(foot_tgt) * H)
                kpole_w = xform_pt(Vector(kpole_raw) * H)
                l1 = self.bone_len[th_n]
                l2 = self.bone_len[sh_n]
                knee_pos, ankle_pos = solve_2bone_ik(hip_j, tgt_w, l1, l2, kpole_w)

                knee_hint = (kpole_w - hip_j).normalized()
                solved_world[th_n] = _aim_matrix(hip_j, knee_pos, knee_hint)
                solved_world[sh_n] = _aim_matrix(knee_pos, ankle_pos, knee_hint)

                # Foot stays planted flat horizontally when near ground (Z <= 0.11*H), or aligns cleanly with shin in midair!
                if foot_tgt[2] <= 0.11 and p.root_rot == (0.0, 0.0, 0.0):
                    # Point toes naturally forward-outward from knee plane
                    foot_fwd = Vector((knee_hint.x * 0.28, -1.0, 0.0)).normalized()
                    toe_pos = ankle_pos + foot_fwd * self.bone_len[ft_n] + Vector((0.0, 0.0, -0.042 * H))
                    solved_world[ft_n] = _aim_matrix(ankle_pos, toe_pos, Vector((0.0, 0.0, 1.0)))
                    solved_world[to_n] = _aim_matrix(toe_pos, toe_pos + foot_fwd * self.bone_len[to_n], Vector((0.0, 0.0, 1.0)))
                else:
                    shin_dir = (ankle_pos - knee_pos).normalized()
                    foot_dir = (shin_dir * 0.55 + knee_hint * 0.45).normalized()
                    toe_pos = ankle_pos + foot_dir * self.bone_len[ft_n]
                    solved_world[ft_n] = _aim_matrix(ankle_pos, toe_pos, Vector((0.0, 0.0, 1.0)))
                    solved_world[to_n] = _aim_matrix(toe_pos, toe_pos + foot_dir * self.bone_len[to_n], Vector((0.0, 0.0, 1.0)))

            if abs(f_scale - 1.0) > 1e-3:
                scales[ft_n] = Vector((f_scale, f_scale, f_scale))

        # 6) Convert every bone's world matrix -> local matrix_basis (loc, quat, scale) cleanly!
        basis: dict[str, tuple[Vector, Quaternion, Vector]] = {}
        for b in self.arm.bones:
            bn = b.name
            if bn not in solved_world:
                basis[bn] = (Vector((0, 0, 0)), Quaternion(), Vector((1, 1, 1)))
                continue
            mw = solved_world[bn]
            pn = self.parent_name[bn]
            if pn is not None and pn in solved_world:
                m_local = solved_world[pn].inverted() @ mw
            else:
                m_local = mw
            m_basis = self.rest_local[bn].inverted() @ m_local
            loc, quat, _ = m_basis.decompose()
            # Keep connected child bones' local translation at zero so joints stay watertight
            if b.use_connect:
                loc = Vector((0.0, 0.0, 0.0))
            sc = scales.get(bn, Vector((1.0, 1.0, 1.0)))
            basis[bn] = (loc, quat.normalized(), sc)
        return basis

    def apply_pose_now(self, p: SemanticPose) -> None:
        """Apply a SemanticPose directly to the armature for instant preview/stress-test rendering."""
        basis = self.solve_pose(p)
        for pb in self.arm_obj.pose.bones:
            pb.rotation_mode = "QUATERNION"
            loc, quat, sc = basis[pb.name]
            pb.location = loc
            pb.rotation_quaternion = quat
            pb.scale = sc
        bpy.context.view_layer.update()

    def bake_clip(self, clip_name: str, keys: list[KeySpec], total_frames: int) -> bpy.types.Action:
        """Bake a SemanticPose keyframe sequence into a clean 60fps Blender Action + NLA strip."""
        act = bpy.data.actions.new(name=clip_name)
        if self.arm_obj.animation_data is None:
            self.arm_obj.animation_data_create()
        self.arm_obj.animation_data.action = act

        # Ensure quaternion continuity across keyframes (prevent 360-degree flip artifacts!)
        prev_quats: dict[str, Quaternion] = {}
        sorted_keys = sorted(keys, key=lambda k: k.frame)

        for k in sorted_keys:
            basis = self.solve_pose(k.pose)
            for pb in self.arm_obj.pose.bones:
                pb.rotation_mode = "QUATERNION"
                loc, quat, sc = basis[pb.name]
                if pb.name in prev_quats and prev_quats[pb.name].dot(quat) < 0.0:
                    quat = -quat
                prev_quats[pb.name] = quat.copy()
                pb.location = loc
                pb.rotation_quaternion = quat
                pb.scale = sc
                pb.keyframe_insert(data_path="location", frame=k.frame)
                pb.keyframe_insert(data_path="rotation_quaternion", frame=k.frame)
                pb.keyframe_insert(data_path="scale", frame=k.frame)

        # Apply Sakurai timing interpolation curves per keyframe segment!
        interp_by_frame = {k.frame: k.interp for k in sorted_keys}
        for fc in act.fcurves:
            for kp in fc.keyframe_points:
                fr = int(round(kp.co.x))
                mode = interp_by_frame.get(fr, "BEZIER")
                if mode == "HOLD":
                    kp.interpolation = "CONSTANT"
                elif mode == "LINEAR":
                    kp.interpolation = "LINEAR"
                elif mode == "SNAP":
                    kp.interpolation = "EXPO"
                    kp.easing = "EASE_IN"
                elif mode == "EASE_OUT":
                    kp.interpolation = "QUINT"
                    kp.easing = "EASE_OUT"
                elif mode == "EASE_IN":
                    kp.interpolation = "QUAD"
                    kp.easing = "EASE_IN"
                else:
                    kp.interpolation = "BEZIER"

        # Push onto NLA track so glTF exports EVERY named AnimationClip cleanly into the single .glb!
        track = self.arm_obj.animation_data.nla_tracks.new()
        track.name = clip_name
        strip = track.strips.new(clip_name, 0, act)
        strip.action_frame_start = 0
        strip.action_frame_end = max(1, total_frames)
        self.arm_obj.animation_data.action = None
        return act


# ---------------------------------------------------------------------------
# Iconic Smash Bros. Move Blueprint Library (Style B Fire / Ignis — Mario + Captain Falcon + Roy)
# ---------------------------------------------------------------------------

def pose_idle_guard(breath: float = 0.0) -> SemanticPose:
    """Poised martial-arts brawler stance angled 24° toward camera (Mario/Ryu/Falcon vibe)."""
    b = breath * 0.018
    return SemanticPose(
        hip_off=(0.0, 0.02, -0.055 + b),
        hips_rot=(5.0, 0.0, -24.0),
        spine_rot=(4.0, 0.0, 6.0),
        chest_rot=(6.0, 0.0, 10.0),
        head_rot=(-8.0, 0.0, 12.0),
        hand_l=(0.14, -0.24, 0.62 + b * 1.4),
        hand_r=(-0.19, 0.06, 0.56 + b * 1.1),
        elbow_pole_l=(0.35, 0.25, 0.45),
        elbow_pole_r=(-0.38, 0.35, 0.44),
        foot_l=(0.13, -0.14, 0.068),
        foot_r=(-0.15, 0.16, 0.068),
        knee_pole_l=(0.18, -0.55, 0.30),
        knee_pole_r=(-0.18, -0.35, 0.30),
        flame_drag=(6.0 + breath * 8.0, 0.0),
        scarf_drag=(8.0 + breath * 10.0, 6.0),
    )


def build_ignis_moveset(compiler: SmashPoseCompiler, move_frames: dict[str, tuple[int, int, int]]) -> list[str]:
    """Compile and bake Ignis's complete 60fps Smash animation library (locomotion + all combat moves)."""
    idle0 = pose_idle_guard(0.0)
    idle1 = pose_idle_guard(1.0)
    clips: list[str] = []

    def add(name: str, keys: list[KeySpec], total: int) -> None:
        compiler.bake_clip(name, keys, total)
        clips.append(name)

    # --- 1. LOCOMOTION & CORE STATES ---
    add("Idle", [
        KeySpec(0, idle0, "BEZIER"),
        KeySpec(24, idle1, "BEZIER"),
        KeySpec(48, idle0, "BEZIER"),
    ], 48)

    # Athletic forward sprint (Naruto/Falcon/Mario aggressive forward lean!)
    run_a = SemanticPose(
        hip_off=(0.0, -0.02, -0.10),
        hips_rot=(26.0, 0.0, -16.0),
        spine_rot=(12.0, 0.0, 10.0),
        chest_rot=(10.0, 0.0, 14.0),
        head_rot=(-34.0, 0.0, -6.0),
        hand_l=(0.18, 0.28, 0.56),
        hand_r=(-0.16, -0.26, 0.62),
        foot_l=(0.10, -0.32, 0.10),
        foot_r=(-0.10, 0.34, 0.22),
        knee_pole_l=(0.12, -0.75, 0.32),
        knee_pole_r=(-0.12, -0.10, 0.26),
        flame_drag=(36.0, 0.0),
        scarf_drag=(42.0, 0.0),
    )
    run_b = SemanticPose(
        hip_off=(0.0, -0.02, -0.05),
        hips_rot=(24.0, 0.0, 16.0),
        spine_rot=(12.0, 0.0, -10.0),
        chest_rot=(10.0, 0.0, -14.0),
        head_rot=(-32.0, 0.0, 6.0),
        hand_l=(0.16, -0.26, 0.62),
        hand_r=(-0.18, 0.28, 0.56),
        foot_l=(0.10, 0.34, 0.22),
        foot_r=(-0.10, -0.32, 0.10),
        knee_pole_l=(0.12, -0.10, 0.26),
        knee_pole_r=(-0.12, -0.75, 0.32),
        flame_drag=(40.0, 0.0),
        scarf_drag=(46.0, 0.0),
    )
    add("Run", [
        KeySpec(0, run_a, "BEZIER"),
        KeySpec(10, run_b, "BEZIER"),
        KeySpec(20, run_a, "BEZIER"),
    ], 20)

    add("Walk", [
        KeySpec(0, SemanticPose(
            hip_off=(0.0, 0.0, -0.04), hips_rot=(8.0, 0.0, -10.0), chest_rot=(4.0, 0.0, 12.0), head_rot=(-10.0, 0.0, 0.0),
            hand_l=(0.18, 0.12, 0.54), hand_r=(-0.18, -0.14, 0.56),
            foot_l=(0.10, -0.18, 0.072), foot_r=(-0.10, 0.18, 0.085),
            flame_drag=(14.0, 0.0), scarf_drag=(16.0, 0.0),
        ), "BEZIER"),
        KeySpec(15, SemanticPose(
            hip_off=(0.0, 0.0, -0.03), hips_rot=(8.0, 0.0, 10.0), chest_rot=(4.0, 0.0, -12.0), head_rot=(-10.0, 0.0, 0.0),
            hand_l=(0.18, -0.14, 0.56), hand_r=(-0.18, 0.12, 0.54),
            foot_l=(0.10, 0.18, 0.085), foot_r=(-0.10, -0.18, 0.072),
            flame_drag=(16.0, 0.0), scarf_drag=(18.0, 0.0),
        ), "BEZIER"),
        KeySpec(30, SemanticPose(
            hip_off=(0.0, 0.0, -0.04), hips_rot=(8.0, 0.0, -10.0), chest_rot=(4.0, 0.0, 12.0), head_rot=(-10.0, 0.0, 0.0),
            hand_l=(0.18, 0.12, 0.54), hand_r=(-0.18, -0.14, 0.56),
            foot_l=(0.10, -0.18, 0.072), foot_r=(-0.10, 0.18, 0.085),
            flame_drag=(14.0, 0.0), scarf_drag=(16.0, 0.0),
        ), "BEZIER"),
    ], 30)

    # Explosive initial Dash burst
    dash_pose = SemanticPose(
        hip_off=(0.0, -0.05, -0.15), hips_rot=(36.0, 0.0, -14.0), chest_rot=(12.0, 0.0, 10.0), head_rot=(-40.0, 0.0, 4.0),
        hand_l=(0.24, 0.34, 0.52), hand_r=(-0.22, 0.36, 0.50),
        foot_l=(0.12, -0.34, 0.08), foot_r=(-0.12, 0.38, 0.18),
        flame_drag=(52.0, 0.0), scarf_drag=(56.0, 0.0),
    )
    add("Dash", [KeySpec(0, dash_pose, "EASE_OUT"), KeySpec(10, run_a, "BEZIER")], 10)

    # Skid brake leaning backward with front boot digging in
    skid_pose = SemanticPose(
        hip_off=(0.0, 0.08, -0.12), hips_rot=(-18.0, 0.0, -24.0), chest_rot=(-8.0, 0.0, 12.0), head_rot=(20.0, 0.0, 10.0),
        hand_l=(0.22, -0.28, 0.64), hand_r=(-0.24, 0.18, 0.54),
        foot_l=(0.12, -0.32, 0.072), foot_r=(-0.12, 0.18, 0.070),
        flame_drag=(-18.0, 0.0), scarf_drag=(-22.0, 0.0),
    )
    add("Skid", [KeySpec(0, skid_pose, "HOLD"), KeySpec(8, skid_pose, "HOLD")], 8)

    # JumpSquat (coiled crouch ready to spring!)
    squat_pose = SemanticPose(
        hip_off=(0.0, 0.04, -0.22), hips_rot=(22.0, 0.0, -10.0), chest_rot=(10.0, 0.0, 6.0), head_rot=(-24.0, 0.0, 4.0),
        hand_l=(0.24, 0.22, 0.42), hand_r=(-0.24, 0.22, 0.42),
        foot_l=(0.14, -0.06, 0.068), foot_r=(-0.14, 0.08, 0.068),
        knee_pole_l=(0.20, -0.70, 0.30), knee_pole_r=(-0.20, -0.60, 0.30),
        flame_drag=(12.0, 0.0), scarf_drag=(15.0, 0.0),
    )
    add("JumpSquat", [KeySpec(0, squat_pose, "EASE_OUT"), KeySpec(4, squat_pose, "HOLD")], 4)

    # Rising Jump (athletic Mario/Falcon tucked knee rise!)
    jump_pose = SemanticPose(
        hip_off=(0.0, 0.0, 0.06), hips_rot=(-8.0, 0.0, -18.0), chest_rot=(6.0, 0.0, 14.0), head_rot=(4.0, 0.0, 6.0),
        hand_l=(0.20, -0.18, 0.92), hand_r=(-0.22, 0.16, 0.62),
        foot_l=(0.12, -0.22, 0.34), foot_r=(-0.12, 0.18, 0.10),
        knee_pole_l=(0.16, -0.75, 0.56), knee_pole_r=(-0.14, -0.35, 0.30),
        flame_drag=(-22.0, 0.0), scarf_drag=(-28.0, 0.0),
    )
    add("Jump", [KeySpec(0, jump_pose, "EASE_OUT"), KeySpec(16, jump_pose, "HOLD")], 16)

    # Airborne Fall (poised descending martial-arts readiness)
    fall_pose = SemanticPose(
        hip_off=(0.0, 0.0, 0.02), hips_rot=(10.0, 0.0, -20.0), chest_rot=(6.0, 0.0, 12.0), head_rot=(-10.0, 0.0, 8.0),
        hand_l=(0.26, -0.14, 0.78), hand_r=(-0.26, 0.10, 0.76),
        foot_l=(0.13, -0.18, 0.22), foot_r=(-0.13, 0.18, 0.16),
        knee_pole_l=(0.18, -0.65, 0.44), knee_pole_r=(-0.16, -0.45, 0.38),
        flame_drag=(26.0, 0.0), scarf_drag=(36.0, 0.0),
    )
    add("Fall", [KeySpec(0, fall_pose, "BEZIER"), KeySpec(16, fall_pose, "BEZIER")], 16)

    # Double Jump (tucked acrobatic front somersault!)
    add("DoubleJump", [
        KeySpec(0, SemanticPose(hip_off=(0, 0, 0), root_rot=(20, 0, 0), hand_l=(0.18, -0.22, 0.55), hand_r=(-0.18, -0.22, 0.55), foot_l=(0.12, 0.06, 0.34), foot_r=(-0.12, 0.06, 0.34)), "LINEAR"),
        KeySpec(7, SemanticPose(hip_off=(0, 0, 0), root_rot=(180, 0, 0), hand_l=(0.18, -0.22, 0.55), hand_r=(-0.18, -0.22, 0.55), foot_l=(0.12, 0.06, 0.34), foot_r=(-0.12, 0.06, 0.34)), "LINEAR"),
        KeySpec(14, jump_pose, "EASE_OUT"),
    ], 14)

    # Guard / Shield brace
    guard_pose = SemanticPose(
        hip_off=(0.0, 0.04, -0.12), hips_rot=(12.0, 0.0, -18.0), chest_rot=(8.0, 0.0, 8.0), head_rot=(-12.0, 0.0, 10.0),
        hand_l=(0.06, -0.28, 0.72), hand_r=(-0.08, -0.26, 0.66),
        elbow_pole_l=(0.24, -0.10, 0.50), elbow_pole_r=(-0.24, -0.10, 0.48),
        foot_l=(0.14, -0.14, 0.068), foot_r=(-0.14, 0.16, 0.068),
        flame_drag=(4.0, 0.0), scarf_drag=(6.0, 0.0),
    )
    add("Guard", [KeySpec(0, guard_pose, "HOLD"), KeySpec(12, guard_pose, "HOLD")], 12)

    # ChargingHeavy (tense coiled power stance, molten fist pulled way back!)
    charge_a = SemanticPose(
        hip_off=(0.0, 0.10, -0.16), hips_rot=(10.0, 0.0, -48.0), spine_rot=(6.0, 0.0, -12.0), chest_rot=(6.0, 0.0, -14.0), head_rot=(-10.0, 0.0, 56.0),
        hand_l=(0.16, -0.34, 0.64), hand_r=(-0.22, 0.32, 0.56),
        elbow_pole_r=(-0.48, 0.55, 0.56),
        foot_l=(0.14, -0.22, 0.068), foot_r=(-0.16, 0.24, 0.068),
        scale_hand_r=1.18,
        flame_drag=(22.0, 12.0), scarf_drag=(26.0, 14.0),
    )
    charge_b = SemanticPose(
        hip_off=(0.0, 0.12, -0.18), hips_rot=(12.0, 0.0, -52.0), spine_rot=(6.0, 0.0, -14.0), chest_rot=(6.0, 0.0, -16.0), head_rot=(-12.0, 0.0, 60.0),
        hand_l=(0.16, -0.35, 0.63), hand_r=(-0.24, 0.35, 0.55),
        elbow_pole_r=(-0.50, 0.58, 0.56),
        foot_l=(0.14, -0.22, 0.068), foot_r=(-0.16, 0.24, 0.068),
        scale_hand_r=1.24,
        flame_drag=(30.0, -10.0), scarf_drag=(32.0, -10.0),
    )
    add("ChargingHeavy", [KeySpec(0, charge_a, "LINEAR"), KeySpec(4, charge_b, "LINEAR"), KeySpec(8, charge_a, "LINEAR")], 8)

    # Hitstun & Tumble (dramatic Sakurai impact recoil & spinning launch!)
    hitstun_pose = SemanticPose(
        hip_off=(0.0, 0.10, 0.0), hips_rot=(-26.0, 0.0, 16.0), spine_rot=(-16.0, 0.0, 8.0), chest_rot=(-14.0, 0.0, 8.0), head_rot=(-22.0, 0.0, -10.0),
        hand_l=(0.30, -0.18, 0.72), hand_r=(-0.30, -0.14, 0.76),
        foot_l=(0.14, -0.20, 0.14), foot_r=(-0.14, 0.10, 0.08),
        flame_drag=(-30.0, 0.0), scarf_drag=(-35.0, 0.0),
    )
    add("Hitstun", [KeySpec(0, hitstun_pose, "HOLD"), KeySpec(12, hitstun_pose, "HOLD")], 12)
    add("Tumble", [
        KeySpec(0, SemanticPose(root_rot=(-40, 10, 0), hips_rot=(-24, 0, 15), hand_l=(0.34, -0.10, 0.78), hand_r=(-0.34, 0.10, 0.70), foot_l=(0.18, -0.24, 0.24), foot_r=(-0.16, 0.22, 0.18)), "LINEAR"),
        KeySpec(10, SemanticPose(root_rot=(-160, 10, 0), hips_rot=(-24, 0, 15), hand_l=(0.34, -0.10, 0.78), hand_r=(-0.34, 0.10, 0.70), foot_l=(0.18, -0.24, 0.24), foot_r=(-0.16, 0.22, 0.18)), "LINEAR"),
        KeySpec(20, SemanticPose(root_rot=(-320, 10, 0), hips_rot=(-24, 0, 15), hand_l=(0.34, -0.10, 0.78), hand_r=(-0.34, 0.10, 0.70), foot_l=(0.18, -0.24, 0.24), foot_r=(-0.16, 0.22, 0.18)), "LINEAR"),
    ], 20)

    # Dodges & Ledge
    add("Roll", [
        KeySpec(0, squat_pose, "LINEAR"),
        KeySpec(8, SemanticPose(hip_off=(0, 0, -0.18), root_rot=(180, 0, 0), hand_l=(0.16, -0.18, 0.50), hand_r=(-0.16, -0.18, 0.50), foot_l=(0.12, 0.0, 0.34), foot_r=(-0.12, 0.0, 0.34)), "LINEAR"),
        KeySpec(18, idle0, "EASE_OUT"),
    ], 18)
    add("SpotDodge", [
        KeySpec(0, SemanticPose(hip_off=(0, 0.10, -0.16), hips_rot=(8, 0, -55), chest_rot=(6, 0, -18), head_rot=(-8, 0, 58), hand_l=(0.18, -0.14, 0.62), hand_r=(-0.18, 0.22, 0.58), foot_l=(0.14, -0.14, 0.068), foot_r=(-0.14, 0.14, 0.068)), "EASE_OUT"),
        KeySpec(16, idle0, "EASE_OUT"),
    ], 16)
    add("AirDodge", [
        KeySpec(0, SemanticPose(hip_off=(0, 0, 0.04), hips_rot=(-12, 0, -35), chest_rot=(-6, 0, -15), hand_l=(0.16, -0.22, 0.68), hand_r=(-0.16, -0.22, 0.64), foot_l=(0.12, -0.10, 0.34), foot_r=(-0.12, 0.14, 0.26)), "EASE_OUT"),
        KeySpec(16, fall_pose, "EASE_OUT"),
    ], 16)
    add("ChaseDodge", [
        KeySpec(0, SemanticPose(hip_off=(0, -0.08, 0.02), hips_rot=(48, 0, -12), chest_rot=(14, 0, 8), head_rot=(-44, 0, 4), hand_l=(0.22, 0.34, 0.58), hand_r=(-0.18, -0.36, 0.64), foot_l=(0.10, 0.36, 0.28), foot_r=(-0.10, 0.44, 0.36), flame_drag=(56, 0), scarf_drag=(64, 0)), "EASE_OUT"),
        KeySpec(14, fall_pose, "EASE_OUT"),
    ], 14)
    add("LedgeHang", [
        KeySpec(0, SemanticPose(hip_off=(0, 0.16, -0.14), hips_rot=(-6, 0, 0), chest_rot=(-6, 0, 0), head_rot=(12, 0, 0), hand_l=(0.14, -0.16, 0.96), hand_r=(-0.14, -0.16, 0.96), foot_l=(0.10, 0.12, 0.04), foot_r=(-0.10, 0.16, 0.02)), "HOLD"),
        KeySpec(16, SemanticPose(hip_off=(0, 0.16, -0.12), hips_rot=(-6, 0, 0), chest_rot=(-6, 0, 0), head_rot=(12, 0, 0), hand_l=(0.14, -0.16, 0.96), hand_r=(-0.14, -0.16, 0.96), foot_l=(0.10, 0.12, 0.06), foot_r=(-0.10, 0.16, 0.04)), "HOLD"),
    ], 16)
    add("LedgeGetup", [KeySpec(0, squat_pose, "EASE_OUT"), KeySpec(14, idle0, "EASE_OUT")], 14)
    add("LandingLag", [KeySpec(0, squat_pose, "EASE_OUT"), KeySpec(10, idle0, "EASE_OUT")], 10)

    # --- 2. SMASH ATTACK MOVESET (1:1 synced to real frame data!) ---
    def mv(mname: str, fallback: tuple[int, int, int]) -> tuple[int, int, int]:
        return move_frames.get(mname, fallback)

    # JAB 1: Snappy left straight jab (Mario/Falcon 1-2-3 opener)
    st, act, tot = mv("Jab1", (4, 3, 18))
    add("Jab1", [
        KeySpec(0, idle0, "EASE_IN"),
        KeySpec(max(1, st - 1), SemanticPose(hip_off=(0, 0.04, -0.08), hips_rot=(8, 0, 12), chest_rot=(6, 0, 18), head_rot=(-10, 0, -18), hand_l=(0.22, 0.12, 0.62), hand_r=(-0.18, -0.14, 0.64), foot_l=(0.13, -0.16, 0.068), foot_r=(-0.15, 0.18, 0.068)), "SNAP"),
        KeySpec(st, SemanticPose(hip_off=(0, -0.06, -0.07), hips_rot=(12, 0, -28), chest_rot=(8, 0, -18), head_rot=(-14, 0, 34), hand_l=(0.04, -0.58, 0.66), hand_r=(-0.22, 0.14, 0.60), foot_l=(0.13, -0.22, 0.068), foot_r=(-0.15, 0.20, 0.068), scale_hand_l=1.34, flame_drag=(20, -8), scarf_drag=(22, -10)), "HOLD"),
        KeySpec(st + act, SemanticPose(hip_off=(0, -0.07, -0.07), hips_rot=(12, 0, -30), chest_rot=(8, 0, -20), head_rot=(-14, 0, 36), hand_l=(0.03, -0.60, 0.66), hand_r=(-0.22, 0.16, 0.60), foot_l=(0.13, -0.22, 0.068), foot_r=(-0.15, 0.20, 0.068), scale_hand_l=1.22, flame_drag=(14, -6), scarf_drag=(16, -8)), "EASE_OUT"),
        KeySpec(tot, idle0, "BEZIER"),
    ], tot)

    # JAB 2: Fierce right cross hook!
    st, act, tot = mv("Jab2", (4, 3, 20))
    add("Jab2", [
        KeySpec(0, SemanticPose(hip_off=(0, 0.02, -0.08), hips_rot=(10, 0, -34), chest_rot=(6, 0, -16), head_rot=(-10, 0, 36), hand_l=(0.14, -0.28, 0.64), hand_r=(-0.24, 0.22, 0.60), foot_l=(0.13, -0.20, 0.068), foot_r=(-0.15, 0.22, 0.068)), "SNAP"),
        KeySpec(st, SemanticPose(hip_off=(0, -0.09, -0.09), hips_rot=(16, 0, 36), chest_rot=(10, 0, 24), head_rot=(-18, 0, -40), hand_l=(0.24, 0.18, 0.58), hand_r=(-0.02, -0.64, 0.66), foot_l=(0.14, -0.24, 0.068), foot_r=(-0.16, 0.24, 0.068), scale_hand_r=1.38, flame_drag=(28, 12), scarf_drag=(30, 16)), "HOLD"),
        KeySpec(st + act, SemanticPose(hip_off=(0, -0.10, -0.09), hips_rot=(16, 0, 38), chest_rot=(10, 0, 26), head_rot=(-18, 0, -42), hand_l=(0.25, 0.20, 0.58), hand_r=(-0.01, -0.66, 0.66), foot_l=(0.14, -0.24, 0.068), foot_r=(-0.16, 0.24, 0.068), scale_hand_r=1.24, flame_drag=(20, 10), scarf_drag=(24, 12)), "EASE_OUT"),
        KeySpec(tot, idle0, "BEZIER"),
    ], tot)

    # JAB 3: Explosive blazing spinning kick / blazing uppercut finisher!
    st, act, tot = mv("Jab3", (6, 4, 26))
    add("Jab3", [
        KeySpec(0, charge_a, "EASE_IN"),
        KeySpec(max(1, st - 1), charge_b, "SNAP"),
        KeySpec(st, SemanticPose(hip_off=(0, -0.12, -0.04), hips_rot=(-14, 0, 42), spine_rot=(-8, 0, 16), chest_rot=(-6, 0, 18), head_rot=(16, 0, -52), hand_l=(0.26, 0.24, 0.52), hand_r=(-0.04, -0.54, 0.98), foot_l=(0.14, -0.26, 0.068), foot_r=(-0.14, 0.26, 0.068), scale_hand_r=1.45, flame_drag=(36, 20), scarf_drag=(42, 24)), "HOLD"),
        KeySpec(st + act + 2, SemanticPose(hip_off=(0, -0.14, -0.02), hips_rot=(-16, 0, 46), spine_rot=(-8, 0, 18), chest_rot=(-6, 0, 20), head_rot=(16, 0, -56), hand_l=(0.28, 0.26, 0.50), hand_r=(-0.06, -0.52, 1.02), foot_l=(0.14, -0.26, 0.068), foot_r=(-0.14, 0.26, 0.068), scale_hand_r=1.26, flame_drag=(28, 16), scarf_drag=(34, 20)), "EASE_OUT"),
        KeySpec(tot, idle0, "BEZIER"),
    ], tot)

    # FTILT: High martial-arts roundhouse ember kick!
    st, act, tot = mv("Ftilt", (7, 4, 24))
    add("Ftilt", [
        KeySpec(0, idle0, "EASE_IN"),
        KeySpec(max(1, st - 2), SemanticPose(hip_off=(0, 0.06, -0.08), hips_rot=(-6, 12, -26), chest_rot=(6, 0, 16), head_rot=(0, 0, 10), hand_l=(0.18, -0.20, 0.68), hand_r=(-0.22, 0.14, 0.62), foot_l=(0.06, -0.06, 0.068), foot_r=(-0.18, 0.22, 0.34), knee_pole_r=(-0.25, -0.50, 0.55)), "SNAP"),
        KeySpec(st, SemanticPose(hip_off=(0, -0.06, -0.04), hips_rot=(-18, 22, 34), spine_rot=(-8, 12, 12), chest_rot=(-4, 8, 14), head_rot=(18, -16, -42), hand_l=(0.24, 0.24, 0.64), hand_r=(-0.24, 0.28, 0.58), foot_l=(0.06, -0.04, 0.068), foot_r=(-0.02, -0.62, 0.62), knee_pole_r=(-0.18, -0.70, 0.68), scale_foot_r=1.36, flame_drag=(32, 16), scarf_drag=(38, 18)), "HOLD"),
        KeySpec(st + act + 1, SemanticPose(hip_off=(0, -0.06, -0.04), hips_rot=(-16, 20, 36), spine_rot=(-8, 10, 14), chest_rot=(-4, 8, 14), head_rot=(18, -14, -44), hand_l=(0.24, 0.26, 0.64), hand_r=(-0.24, 0.30, 0.58), foot_l=(0.06, -0.04, 0.068), foot_r=(-0.02, -0.64, 0.64), knee_pole_r=(-0.18, -0.70, 0.68), scale_foot_r=1.22, flame_drag=(22, 12), scarf_drag=(28, 14)), "EASE_OUT"),
        KeySpec(tot, idle0, "BEZIER"),
    ], tot)

    # UTILT: Rising Mario/Falcon sky-hook uppercut!
    st, act, tot = mv("Utilt", (6, 5, 26))
    add("Utilt", [
        KeySpec(0, squat_pose, "EASE_IN"),
        KeySpec(max(1, st - 1), SemanticPose(hip_off=(0, 0.04, -0.18), hips_rot=(20, 0, -28), chest_rot=(12, 0, -12), head_rot=(-22, 0, 30), hand_l=(0.18, -0.14, 0.44), hand_r=(-0.22, 0.14, 0.34), foot_l=(0.14, -0.16, 0.068), foot_r=(-0.14, 0.18, 0.068)), "SNAP"),
        KeySpec(st, SemanticPose(hip_off=(0, -0.05, 0.02), hips_rot=(-14, 0, 30), spine_rot=(-10, 0, 12), chest_rot=(-8, 0, 16), head_rot=(-14, 0, -34), hand_l=(0.24, 0.18, 0.48), hand_r=(-0.06, -0.26, 1.18), elbow_pole_r=(-0.34, -0.18, 0.85), foot_l=(0.12, -0.16, 0.068), foot_r=(-0.12, 0.18, 0.068), scale_hand_r=1.38, flame_drag=(-18, 12), scarf_drag=(24, 14)), "HOLD"),
        KeySpec(st + act, SemanticPose(hip_off=(0, -0.06, 0.03), hips_rot=(-16, 0, 34), spine_rot=(-10, 0, 14), chest_rot=(-8, 0, 16), head_rot=(-14, 0, -38), hand_l=(0.24, 0.20, 0.46), hand_r=(-0.06, -0.22, 1.22), elbow_pole_r=(-0.34, -0.14, 0.88), foot_l=(0.12, -0.16, 0.068), foot_r=(-0.12, 0.18, 0.068), scale_hand_r=1.24, flame_drag=(-10, 10), scarf_drag=(20, 10)), "EASE_OUT"),
        KeySpec(tot, idle0, "BEZIER"),
    ], tot)

    # DTILT: Low martial-arts crouching leg sweep!
    st, act, tot = mv("Dtilt", (5, 3, 22))
    add("Dtilt", [
        KeySpec(0, squat_pose, "SNAP"),
        KeySpec(st, SemanticPose(hip_off=(0, -0.06, -0.28), hips_rot=(24, 12, 34), chest_rot=(12, 0, 14), head_rot=(-26, 0, -36), hand_l=(0.26, 0.12, 0.24), hand_r=(-0.22, 0.20, 0.34), foot_l=(0.14, 0.14, 0.068), foot_r=(-0.04, -0.62, 0.10), knee_pole_r=(-0.18, -0.65, 0.22), scale_foot_r=1.34, flame_drag=(28, 16), scarf_drag=(36, 18)), "HOLD"),
        KeySpec(st + act + 2, SemanticPose(hip_off=(0, -0.06, -0.26), hips_rot=(22, 10, 36), chest_rot=(12, 0, 14), head_rot=(-24, 0, -38), hand_l=(0.26, 0.14, 0.26), hand_r=(-0.22, 0.22, 0.36), foot_l=(0.14, 0.14, 0.068), foot_r=(-0.04, -0.64, 0.10), knee_pole_r=(-0.18, -0.65, 0.22), scale_foot_r=1.18, flame_drag=(20, 12), scarf_drag=(28, 14)), "EASE_OUT"),
        KeySpec(tot, idle0, "BEZIER"),
    ], tot)

    # DASH ATTACK: Explosive flying flame shoulder/elbow tackle!
    st, act, tot = mv("Dash", (7, 5, 28))
    add("DashAtk", [
        KeySpec(0, dash_pose, "SNAP"),
        KeySpec(st, SemanticPose(hip_off=(0, -0.14, -0.10), hips_rot=(32, 0, 38), spine_rot=(14, 0, 14), chest_rot=(10, 0, 18), head_rot=(-34, 0, -52), hand_l=(0.26, 0.32, 0.56), hand_r=(-0.06, -0.58, 0.68), foot_l=(0.12, 0.34, 0.18), foot_r=(-0.12, -0.26, 0.14), scale_hand_r=1.40, flame_drag=(54, 18), scarf_drag=(62, 22)), "HOLD"),
        KeySpec(st + act + 2, SemanticPose(hip_off=(0, -0.16, -0.12), hips_rot=(30, 0, 42), spine_rot=(12, 0, 16), chest_rot=(8, 0, 18), head_rot=(-32, 0, -56), hand_l=(0.28, 0.34, 0.54), hand_r=(-0.06, -0.60, 0.66), foot_l=(0.12, 0.28, 0.10), foot_r=(-0.12, -0.28, 0.07), scale_hand_r=1.22, flame_drag=(40, 12), scarf_drag=(48, 16)), "EASE_OUT"),
        KeySpec(tot, idle0, "BEZIER"),
    ], tot)

    # FHEAVY: SIGNATURE BLAZING MOLTEN HAYMAKER (Mario/Falcon/Roy Smash Punch!)
    st, act, tot = mv("Fheavy", (13, 4, 38))
    coil_fh = SemanticPose(
        hip_off=(0.0, 0.16, -0.18),
        hips_rot=(12.0, 0.0, -56.0),
        spine_rot=(6.0, 0.0, -14.0),
        chest_rot=(6.0, 0.0, -16.0),
        head_rot=(-14.0, 0.0, 66.0),
        hand_l=(0.14, -0.38, 0.66),
        hand_r=(-0.26, 0.38, 0.54),
        elbow_pole_r=(-0.55, 0.62, 0.58),
        foot_l=(0.14, -0.24, 0.068),
        foot_r=(-0.16, 0.28, 0.068),
        knee_pole_l=(0.18, -0.68, 0.28),
        knee_pole_r=(-0.18, -0.22, 0.28),
        scale_hand_r=1.18,
        flame_drag=(28.0, -18.0),
        scarf_drag=(34.0, -22.0),
    )
    snap_fh = SemanticPose(
        hip_off=(0.0, -0.18, -0.11),
        hips_rot=(22.0, 0.0, 48.0),
        spine_rot=(10.0, 0.0, 20.0),
        chest_rot=(10.0, 0.0, 22.0),
        head_rot=(-28.0, 0.0, -68.0),
        hand_l=(0.28, 0.32, 0.56),
        hand_r=(-0.02, -0.78, 0.66),
        elbow_pole_r=(-0.38, 0.10, 0.68),
        foot_l=(0.14, -0.34, 0.068),
        foot_r=(-0.16, 0.32, 0.072),
        knee_pole_l=(0.18, -0.82, 0.30),
        knee_pole_r=(-0.18, -0.14, 0.28),
        scale_hand_r=1.52,  # Massive Sakurai Smash impact fist exaggeration!
        flame_drag=(54.0, 24.0),
        scarf_drag=(62.0, 28.0),
    )
    follow_fh = SemanticPose(
        hip_off=(0.0, -0.20, -0.12),
        hips_rot=(24.0, 0.0, 54.0),
        spine_rot=(10.0, 0.0, 22.0),
        chest_rot=(10.0, 0.0, 24.0),
        head_rot=(-30.0, 0.0, -72.0),
        hand_l=(0.30, 0.34, 0.54),
        hand_r=(0.04, -0.76, 0.64),
        elbow_pole_r=(-0.32, 0.14, 0.66),
        foot_l=(0.14, -0.34, 0.068),
        foot_r=(-0.16, 0.32, 0.072),
        scale_hand_r=1.32,
        flame_drag=(42.0, 20.0),
        scarf_drag=(52.0, 24.0),
    )
    add("Fheavy", [
        KeySpec(0, idle0, "EASE_IN"),
        KeySpec(4, coil_fh, "HOLD"),
        KeySpec(st - 2, coil_fh, "SNAP"),
        KeySpec(st, snap_fh, "HOLD"),
        KeySpec(st + act + 2, follow_fh, "EASE_OUT"),
        KeySpec(tot, idle0, "BEZIER"),
    ], tot)

    # UHEAVY: Two-fisted explosive Volcano Sky-Slam!
    st, act, tot = mv("Uheavy", (11, 5, 36))
    add("Uheavy", [
        KeySpec(0, squat_pose, "HOLD"),
        KeySpec(st - 2, SemanticPose(hip_off=(0, 0.06, -0.24), hips_rot=(28, 0, -14), chest_rot=(14, 0, 0), head_rot=(-32, 0, 12), hand_l=(0.24, -0.18, 0.30), hand_r=(-0.24, -0.18, 0.30), foot_l=(0.16, -0.14, 0.068), foot_r=(-0.16, 0.14, 0.068)), "SNAP"),
        KeySpec(st, SemanticPose(hip_off=(0, -0.06, 0.06), hips_rot=(-20, 0, 12), spine_rot=(-12, 0, 0), chest_rot=(-10, 0, 0), head_rot=(-12, 0, -10), hand_l=(0.14, -0.24, 1.24), hand_r=(-0.14, -0.24, 1.24), foot_l=(0.14, -0.12, 0.068), foot_r=(-0.14, 0.12, 0.068), scale_hand_l=1.40, scale_hand_r=1.40, flame_drag=(-28, 0), scarf_drag=(36, 0)), "HOLD"),
        KeySpec(st + act + 2, SemanticPose(hip_off=(0, -0.06, 0.05), hips_rot=(-22, 0, 14), spine_rot=(-12, 0, 0), chest_rot=(-10, 0, 0), head_rot=(-12, 0, -12), hand_l=(0.16, -0.18, 1.26), hand_r=(-0.16, -0.18, 1.26), foot_l=(0.14, -0.12, 0.068), foot_r=(-0.14, 0.12, 0.068), scale_hand_l=1.25, scale_hand_r=1.25, flame_drag=(-18, 0), scarf_drag=(28, 0)), "EASE_OUT"),
        KeySpec(tot, idle0, "BEZIER"),
    ], tot)

    # DHEAVY: Low split twin-gauntlet Magma Ground-Slam!
    st, act, tot = mv("Dheavy", (10, 5, 34))
    add("Dheavy", [
        KeySpec(0, SemanticPose(hip_off=(0, 0, 0.04), hips_rot=(-10, 0, 0), hand_l=(0.24, -0.08, 1.06), hand_r=(-0.24, -0.08, 1.06), foot_l=(0.14, -0.10, 0.068), foot_r=(-0.14, 0.10, 0.068)), "HOLD"),
        KeySpec(st - 2, SemanticPose(hip_off=(0, 0, 0.06), hips_rot=(-14, 0, 0), hand_l=(0.26, 0.04, 1.12), hand_r=(-0.26, 0.04, 1.12), foot_l=(0.14, -0.10, 0.068), foot_r=(-0.14, 0.10, 0.068)), "SNAP"),
        KeySpec(st, SemanticPose(hip_off=(0, -0.04, -0.28), hips_rot=(38, 0, 0), chest_rot=(18, 0, 0), head_rot=(-34, 0, 0), hand_l=(0.28, -0.34, 0.12), hand_r=(-0.28, 0.28, 0.12), foot_l=(0.20, -0.20, 0.068), foot_r=(-0.20, 0.20, 0.068), scale_hand_l=1.42, scale_hand_r=1.42, flame_drag=(42, 0), scarf_drag=(50, 0)), "HOLD"),
        KeySpec(st + act + 3, SemanticPose(hip_off=(0, -0.04, -0.26), hips_rot=(36, 0, 0), chest_rot=(16, 0, 0), head_rot=(-32, 0, 0), hand_l=(0.28, -0.34, 0.14), hand_r=(-0.28, 0.28, 0.14), foot_l=(0.20, -0.20, 0.068), foot_r=(-0.20, 0.20, 0.068), scale_hand_l=1.22, scale_hand_r=1.22, flame_drag=(28, 0), scarf_drag=(36, 0)), "EASE_OUT"),
        KeySpec(tot, idle0, "BEZIER"),
    ], tot)

    # NAIR: Crisp Mario/Link flying sex-kick!
    st, act, tot = mv("Nair", (5, 10, 28))
    add("Nair", [
        KeySpec(0, fall_pose, "SNAP"),
        KeySpec(st, SemanticPose(hip_off=(0, -0.04, 0.02), hips_rot=(-18, 10, -28), chest_rot=(8, 0, 18), head_rot=(10, 0, 10), hand_l=(0.26, 0.22, 0.72), hand_r=(-0.26, 0.18, 0.64), foot_l=(0.10, -0.54, 0.34), foot_r=(-0.14, 0.24, 0.30), knee_pole_l=(0.14, -0.78, 0.44), scale_foot_l=1.34, flame_drag=(26, 0), scarf_drag=(34, 0)), "HOLD"),
        KeySpec(st + act, SemanticPose(hip_off=(0, -0.04, 0.02), hips_rot=(-16, 8, -26), chest_rot=(8, 0, 16), head_rot=(10, 0, 10), hand_l=(0.26, 0.22, 0.72), hand_r=(-0.26, 0.18, 0.64), foot_l=(0.10, -0.50, 0.32), foot_r=(-0.14, 0.24, 0.30), knee_pole_l=(0.14, -0.74, 0.44), scale_foot_l=1.18), "EASE_OUT"),
        KeySpec(tot, fall_pose, "BEZIER"),
    ], tot)

    # FAIR: ICONIC CAPTAIN FALCON BLAZING KNEE OF JUSTICE!!
    st, act, tot = mv("Fair", (8, 4, 32))
    coil_fair = SemanticPose(
        hip_off=(0, 0.08, 0.04), hips_rot=(-14, 0, -26), chest_rot=(-8, 0, -10), head_rot=(12, 0, 26),
        hand_l=(0.20, -0.26, 0.76), hand_r=(-0.20, -0.24, 0.74),
        foot_l=(0.12, 0.22, 0.20), foot_r=(-0.14, 0.36, 0.34),
        knee_pole_r=(-0.16, 0.10, 0.30),
        flame_drag=(-14, 0), scarf_drag=(-18, 0),
    )
    knee_fair = SemanticPose(
        hip_off=(0, -0.10, 0.06),
        hips_rot=(24.0, 0.0, 22.0),
        spine_rot=(12.0, 0.0, 8.0),
        chest_rot=(10.0, 0.0, 10.0),
        head_rot=(-32.0, 0.0, -32.0),
        # Aerodynamic swept-back fists just like Captain Falcon's Knee!
        hand_l=(0.28, 0.40, 0.72),
        hand_r=(-0.28, 0.42, 0.70),
        elbow_pole_l=(0.45, 0.55, 0.85),
        elbow_pole_r=(-0.45, 0.55, 0.85),
        # Right knee spears straight forward (-Y) with shin tucked razor-tight!
        foot_r=(-0.08, 0.04, 0.42),
        knee_pole_r=(-0.08, -0.95, 0.62),
        foot_l=(0.14, 0.44, 0.18),
        knee_pole_l=(0.16, -0.05, 0.30),
        scale_foot_r=1.28,
        flame_drag=(56.0, 10.0),
        scarf_drag=(64.0, 12.0),
    )
    add("Fair", [
        KeySpec(0, fall_pose, "EASE_IN"),
        KeySpec(max(1, st - 2), coil_fair, "SNAP"),
        KeySpec(st, knee_fair, "HOLD"),
        KeySpec(st + act + 3, knee_fair, "EASE_OUT"),
        KeySpec(tot, fall_pose, "BEZIER"),
    ], tot)

    # BAIR: Explosive Captain Falcon / Mario reverse back-fist & mule kick behind (+Y)!
    st, act, tot = mv("Bair", (7, 4, 30))
    add("Bair", [
        KeySpec(0, fall_pose, "EASE_IN"),
        KeySpec(max(1, st - 2), SemanticPose(hip_off=(0, -0.06, 0.04), hips_rot=(16, 0, -24), chest_rot=(10, 0, -14), hand_l=(0.18, -0.26, 0.66), hand_r=(-0.18, -0.28, 0.66), foot_l=(0.12, -0.26, 0.28), foot_r=(-0.12, -0.20, 0.28)), "SNAP"),
        KeySpec(st, SemanticPose(hip_off=(0, 0.10, 0.04), hips_rot=(18, 0, -56), spine_rot=(10, 0, -18), chest_rot=(8, 0, -22), head_rot=(-18, 0, -58), hand_l=(0.24, -0.34, 0.66), hand_r=(-0.06, 0.72, 0.66), foot_l=(0.12, -0.32, 0.24), foot_r=(-0.06, 0.64, 0.46), knee_pole_r=(-0.16, 0.80, 0.56), scale_hand_r=1.46, scale_foot_r=1.34, flame_drag=(-44, -22), scarf_drag=(-52, -26)), "HOLD"),
        KeySpec(st + act + 2, SemanticPose(hip_off=(0, 0.10, 0.04), hips_rot=(16, 0, -58), spine_rot=(8, 0, -18), chest_rot=(8, 0, -22), head_rot=(-18, 0, -60), hand_l=(0.24, -0.34, 0.66), hand_r=(-0.06, 0.70, 0.66), foot_l=(0.12, -0.32, 0.24), foot_r=(-0.06, 0.60, 0.44), knee_pole_r=(-0.16, 0.76, 0.54), scale_hand_r=1.28), "EASE_OUT"),
        KeySpec(tot, fall_pose, "BEZIER"),
    ], tot)

    # UAIR: High acrobatic bicycle flip-kick overhead!
    st, act, tot = mv("Uair", (6, 5, 30))
    add("Uair", [
        KeySpec(0, fall_pose, "SNAP"),
        KeySpec(st, SemanticPose(hip_off=(0, 0, 0.06), root_rot=(-115, 0, 0), hips_rot=(-18, 0, 14), hand_l=(0.26, -0.22, 0.66), hand_r=(-0.26, -0.22, 0.66), foot_l=(0.12, -0.56, 0.52), foot_r=(-0.12, 0.26, 0.28), scale_foot_l=1.40, flame_drag=(-30, 0), scarf_drag=(-36, 0)), "HOLD"),
        KeySpec(st + act + 2, SemanticPose(hip_off=(0, 0, 0.04), root_rot=(-210, 0, 0), hips_rot=(-10, 0, 14), hand_l=(0.24, -0.18, 0.68), hand_r=(-0.24, -0.18, 0.68), foot_l=(0.12, -0.44, 0.40), foot_r=(-0.12, 0.20, 0.28), scale_foot_l=1.22), "EASE_OUT"),
        KeySpec(tot, fall_pose, "BEZIER"),
    ], tot)

    # DAIR: ICONIC CAPTAIN FALCON / GANONDORF DOUBLE-BOOT METEOR STOMP!!
    st, act, tot = mv("Dair", (10, 4, 34))
    add("Dair", [
        KeySpec(0, fall_pose, "EASE_IN"),
        KeySpec(max(1, st - 2), SemanticPose(hip_off=(0, 0, 0.14), hips_rot=(24, 0, -14), chest_rot=(12, 0, 8), head_rot=(-22, 0, 10), hand_l=(0.26, -0.14, 0.96), hand_r=(-0.26, -0.14, 0.96), foot_l=(0.14, -0.20, 0.44), foot_r=(-0.14, -0.16, 0.48), knee_pole_l=(0.20, -0.82, 0.64), knee_pole_r=(-0.20, -0.82, 0.64), flame_drag=(12, 0), scarf_drag=(18, 0)), "SNAP"),
        KeySpec(st, SemanticPose(hip_off=(0, -0.04, 0.04), hips_rot=(20, 0, -22), spine_rot=(10, 0, 8), chest_rot=(12, 0, 12), head_rot=(22, 0, 14), hand_l=(0.36, 0.28, 0.88), hand_r=(-0.36, 0.28, 0.88), elbow_pole_l=(0.52, 0.55, 0.98), elbow_pole_r=(-0.52, 0.55, 0.98), foot_l=(0.10, -0.22, -0.02), foot_r=(-0.10, 0.14, 0.14), knee_pole_l=(0.14, -0.82, 0.36), knee_pole_r=(-0.14, -0.62, 0.44), scale_foot_l=1.46, scale_foot_r=1.34, flame_drag=(32, 0), scarf_drag=(42, 0)), "HOLD"),
        KeySpec(st + act + 3, SemanticPose(hip_off=(0, -0.04, 0.02), hips_rot=(18, 0, -20), spine_rot=(8, 0, 8), chest_rot=(10, 0, 10), head_rot=(20, 0, 12), hand_l=(0.34, 0.26, 0.84), hand_r=(-0.34, 0.26, 0.84), foot_l=(0.10, -0.20, 0.0), foot_r=(-0.10, 0.12, 0.14), knee_pole_l=(0.14, -0.78, 0.36), knee_pole_r=(-0.14, -0.60, 0.44), scale_foot_l=1.26, scale_foot_r=1.20), "EASE_OUT"),
        KeySpec(tot, fall_pose, "BEZIER"),
    ], tot)

    # USPEC: ICONIC RISING SHORYUKEN / FALCON-UPPERCUT FLAME LAUNCH!!
    st, act, tot = mv("Uspec", (6, 12, 36))
    add("Uspec", [
        KeySpec(0, squat_pose, "SNAP"),
        KeySpec(st, SemanticPose(
            hip_off=(0, -0.04, 0.10),
            hips_rot=(-16.0, 0.0, 44.0),
            spine_rot=(-10.0, 0.0, 14.0),
            chest_rot=(-8.0, 0.0, 18.0),
            head_rot=(-18.0, 0.0, -54.0),
            hand_l=(0.24, 0.22, 0.56),
            hand_r=(-0.04, -0.22, 1.32),
            elbow_pole_r=(-0.32, -0.12, 0.92),
            foot_r=(-0.12, -0.24, 0.44),
            knee_pole_r=(-0.16, -0.82, 0.68),
            foot_l=(0.10, 0.10, 0.04),
            knee_pole_l=(0.12, -0.35, 0.26),
            scale_hand_r=1.48,
            flame_drag=(24.0, 16.0),
            scarf_drag=(28.0, 18.0),
        ), "HOLD"),
        KeySpec(st + act, SemanticPose(
            hip_off=(0, -0.04, 0.12),
            hips_rot=(-14.0, 0.0, 52.0),
            spine_rot=(-8.0, 0.0, 16.0),
            chest_rot=(-6.0, 0.0, 18.0),
            head_rot=(-14.0, 0.0, -60.0),
            hand_l=(0.24, 0.24, 0.56),
            hand_r=(-0.04, -0.20, 1.34),
            foot_r=(-0.12, -0.22, 0.42),
            knee_pole_r=(-0.16, -0.80, 0.66),
            foot_l=(0.10, 0.12, 0.06),
            scale_hand_r=1.32,
            flame_drag=(18.0, 14.0),
            scarf_drag=(22.0, 16.0),
        ), "EASE_OUT"),
        KeySpec(tot, fall_pose, "BEZIER"),
    ], tot)

    # NSPEC (Hadouken twin-palm ember blast!), SSPEC (Jet-flame lunge!), DSPEC (Volcano brace!), GRAB/THROWS
    st, act, tot = mv("Nspec", (10, 4, 30))
    add("Nspec", [
        KeySpec(0, charge_a, "SNAP"),
        KeySpec(st, SemanticPose(hip_off=(0, -0.08, -0.10), hips_rot=(18, 0, -10), chest_rot=(10, 0, 10), head_rot=(-20, 0, 0), hand_l=(0.08, -0.62, 0.64), hand_r=(-0.08, -0.62, 0.64), foot_l=(0.14, -0.24, 0.068), foot_r=(-0.14, 0.24, 0.068), scale_hand_l=1.32, scale_hand_r=1.32, flame_drag=(30, 0), scarf_drag=(36, 0)), "HOLD"),
        KeySpec(tot, idle0, "EASE_OUT"),
    ], tot)

    st, act, tot = mv("Sspec", (10, 12, 34))
    add("Sspec", [
        KeySpec(0, dash_pose, "SNAP"),
        KeySpec(st, SemanticPose(hip_off=(0, -0.16, -0.08), hips_rot=(42, 0, 34), chest_rot=(14, 0, 18), head_rot=(-44, 0, -48), hand_l=(0.28, 0.36, 0.56), hand_r=(-0.04, -0.74, 0.66), foot_l=(0.12, 0.36, 0.22), foot_r=(-0.12, 0.22, 0.16), scale_hand_r=1.44, flame_drag=(62, 18), scarf_drag=(68, 22)), "HOLD"),
        KeySpec(st + act, dash_pose, "EASE_OUT"),
        KeySpec(tot, idle0, "BEZIER"),
    ], tot)

    st, act, tot = mv("Dspec", (8, 8, 30))
    add("Dspec", [
        KeySpec(0, squat_pose, "SNAP"),
        KeySpec(st, SemanticPose(hip_off=(0, 0, -0.16), hips_rot=(-10, 0, 0), chest_rot=(-12, 0, 0), head_rot=(-14, 0, 0), hand_l=(0.38, -0.10, 0.72), hand_r=(-0.38, -0.10, 0.72), foot_l=(0.20, -0.12, 0.068), foot_r=(-0.20, 0.12, 0.068), scale_hand_l=1.34, scale_hand_r=1.34, flame_drag=(-22, 0), scarf_drag=(40, 0)), "HOLD"),
        KeySpec(tot, idle0, "EASE_OUT"),
    ], tot)

    add("Grab", [
        KeySpec(0, idle0, "SNAP"),
        KeySpec(6, SemanticPose(hip_off=(0, -0.10, -0.08), hips_rot=(18, 0, 0), chest_rot=(8, 0, 0), head_rot=(-18, 0, 0), hand_l=(0.14, -0.58, 0.66), hand_r=(-0.14, -0.58, 0.66), foot_l=(0.14, -0.22, 0.068), foot_r=(-0.14, 0.22, 0.068), scale_hand_l=1.22, scale_hand_r=1.22), "HOLD"),
        KeySpec(22, idle0, "EASE_OUT"),
    ], 22)
    add("Fthrow", [KeySpec(0, charge_a, "SNAP"), KeySpec(8, snap_fh, "HOLD"), KeySpec(22, idle0, "EASE_OUT")], 22)
    add("Bthrow", [KeySpec(0, snap_fh, "SNAP"), KeySpec(8, charge_a, "HOLD"), KeySpec(22, idle0, "EASE_OUT")], 22)
    add("Uthrow", [KeySpec(0, squat_pose, "SNAP"), KeySpec(8, jump_pose, "HOLD"), KeySpec(22, idle0, "EASE_OUT")], 22)
    add("Dthrow", [KeySpec(0, jump_pose, "SNAP"), KeySpec(8, squat_pose, "HOLD"), KeySpec(22, idle0, "EASE_OUT")], 22)
    add("LedgeAtk", [KeySpec(0, squat_pose, "SNAP"), KeySpec(8, snap_fh, "HOLD"), KeySpec(24, idle0, "EASE_OUT")], 24)

    return clips
