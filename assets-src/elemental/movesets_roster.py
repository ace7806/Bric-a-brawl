"""Character-specific 45-clip 60fps Smash animation movesets for Basalt (Rock), Tide (Water), and Zephyr (Air).

Each moveset builds on SmashPoseCompiler (Analytic 2-Bone IK + Sakurai Timing) and syncs 1:1 with
its real simulation slot frame counts in data/fighters.json (grog -> basalt, nesta -> tide, moss -> zephyr).
"""
from __future__ import annotations

import json
import os
from smash_anims import KeySpec, SemanticPose, SmashPoseCompiler, build_ignis_moveset

ROOT_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))


def load_slot_move_frames(slot_key: str) -> dict[str, tuple[int, int, int]]:
    """Read real startup/active/total frame counts for a fighter slot ('earl'|'grog'|'nesta'|'moss') from data/fighters.json."""
    path = os.path.join(ROOT_DIR, "data", "fighters.json")
    if not os.path.isfile(path):
        return {}
    raw = json.load(open(path, "r", encoding="utf-8"))
    entry = raw.get(slot_key)
    if not isinstance(entry, dict):
        return {}
    out: dict[str, tuple[int, int, int]] = {}
    for m in entry.get("moves", []):
        mid = str(m.get("id", ""))
        key = mid[0].upper() + mid[1:] if mid else ""
        out[key] = (int(m.get("startup", 6)), int(m.get("active", 4)), int(m.get("total", 24)))
    return out


def _replace_clip(compiler: SmashPoseCompiler, name: str, keys: list[KeySpec], total: int) -> None:
    """Safely replace an existing baked Action & NLA strip with a bespoke character-specific animation."""
    arm_obj = compiler.arm_obj
    if arm_obj.animation_data:
        for tr in list(arm_obj.animation_data.nla_tracks):
            if tr.name == name:
                arm_obj.animation_data.nla_tracks.remove(tr)
    old = bpy_action_get(name)
    if old is not None:
        import bpy
        bpy.data.actions.remove(old)
    compiler.bake_clip(name, keys, total)


def bpy_action_get(name: str):
    import bpy
    return bpy.data.actions.get(name)


def build_basalt_moveset(
    compiler: SmashPoseCompiler,
    move_frames: dict[str, tuple[int, int, int]],
) -> list[str]:
    """Build Rock ('BASALT') 45-clip heavyweight juggernaut moveset (Donkey Kong / Ganondorf / Bowser blueprint)."""
    # Start from full canonical 45-clip base synced to grog's real frame table, then override signature moves & idle!
    clips = build_ignis_moveset(compiler, move_frames)

    def mv(key: str, default: tuple[int, int, int]) -> tuple[int, int, int]:
        return move_frames.get(key, default)

    # Heavy volcanic colossus idle: wide planted boulder stance, heavy fists poised low & menacing!
    idle0 = SemanticPose(
        hip_off=(0.0, 0.0, -0.10),
        hips_rot=(10.0, 0.0, -24.0),
        spine_rot=(8.0, 0.0, 6.0),
        chest_rot=(6.0, 0.0, 10.0),
        head_rot=(-18.0, 0.0, 12.0),
        hand_l=(0.24, -0.26, 0.56),
        hand_r=(-0.28, 0.04, 0.44),
        elbow_pole_l=(0.48, 0.25, 0.54),
        elbow_pole_r=(-0.50, 0.35, 0.52),
        foot_l=(0.18, -0.16, 0.068),
        foot_r=(-0.18, 0.18, 0.068),
        knee_pole_l=(0.24, -0.68, 0.30),
        knee_pole_r=(-0.24, -0.35, 0.30),
    )
    idle1 = SemanticPose(
        hip_off=(0.0, 0.0, -0.13),
        hips_rot=(12.0, 0.0, -24.0),
        spine_rot=(9.0, 0.0, 6.0),
        chest_rot=(7.0, 0.0, 10.0),
        head_rot=(-20.0, 0.0, 12.0),
        hand_l=(0.25, -0.28, 0.53),
        hand_r=(-0.29, 0.05, 0.41),
        elbow_pole_l=(0.48, 0.25, 0.52),
        elbow_pole_r=(-0.50, 0.35, 0.50),
        foot_l=(0.18, -0.16, 0.068),
        foot_r=(-0.18, 0.18, 0.068),
        knee_pole_l=(0.24, -0.68, 0.29),
        knee_pole_r=(-0.24, -0.35, 0.29),
    )
    _replace_clip(compiler, "Idle", [KeySpec(0, idle0), KeySpec(20, idle1), KeySpec(40, idle0)], 40)

    # JAB 2: Crushing heavyweight sweeping stone backhand/claw hook!
    st, act, tot = mv("Jab2", (7, 3, 32))
    _replace_clip(compiler, "Jab2", [
        KeySpec(0, idle0, "EASE_IN"),
        KeySpec(max(1, st - 2), SemanticPose(hip_off=(0, 0.08, -0.14), hips_rot=(10, 0, -48), chest_rot=(6, 0, -14), head_rot=(-14, 0, 50), hand_l=(0.22, -0.24, 0.60), hand_r=(-0.34, 0.28, 0.54), foot_l=(0.18, -0.20, 0.068), foot_r=(-0.18, 0.22, 0.068)), "SNAP"),
        KeySpec(st, SemanticPose(hip_off=(0, -0.12, -0.10), hips_rot=(18, 0, 40), spine_rot=(8, 0, 16), chest_rot=(8, 0, 20), head_rot=(-22, 0, -56), hand_l=(0.30, 0.24, 0.54), hand_r=(0.04, -0.70, 0.68), elbow_pole_r=(-0.42, 0.06, 0.64), foot_l=(0.18, -0.26, 0.068), foot_r=(-0.18, 0.24, 0.068), scale_hand_r=1.44), "HOLD"),
        KeySpec(st + act + 2, SemanticPose(hip_off=(0, -0.14, -0.12), hips_rot=(20, 0, 44), chest_rot=(8, 0, 22), head_rot=(-24, 0, -60), hand_l=(0.30, 0.26, 0.52), hand_r=(0.08, -0.68, 0.64), foot_l=(0.18, -0.26, 0.068), foot_r=(-0.18, 0.24, 0.068), scale_hand_r=1.24), "EASE_OUT"),
        KeySpec(tot, idle0, "BEZIER"),
    ], tot)

    # FTILT: Heavy tectonic double-handed boulder shove!
    st, act, tot = mv("Ftilt", (9, 4, 32))
    _replace_clip(compiler, "Ftilt", [
        KeySpec(0, idle0, "EASE_IN"),
        KeySpec(max(1, st - 2), SemanticPose(hip_off=(0, 0.12, -0.16), hips_rot=(12, 0, -24), chest_rot=(8, 0, -10), head_rot=(-14, 0, 28), hand_l=(0.24, 0.18, 0.56), hand_r=(-0.24, 0.18, 0.56), foot_l=(0.18, -0.20, 0.068), foot_r=(-0.18, 0.24, 0.068)), "SNAP"),
        KeySpec(st, SemanticPose(hip_off=(0, -0.16, -0.12), hips_rot=(24, 0, 12), spine_rot=(12, 0, 6), chest_rot=(10, 0, 8), head_rot=(-30, 0, -18), hand_l=(0.14, -0.72, 0.64), hand_r=(-0.14, -0.72, 0.64), foot_l=(0.18, -0.32, 0.068), foot_r=(-0.18, 0.26, 0.068), scale_hand_l=1.38, scale_hand_r=1.38), "HOLD"),
        KeySpec(st + act + 2, SemanticPose(hip_off=(0, -0.16, -0.12), hips_rot=(22, 0, 14), chest_rot=(8, 0, 8), head_rot=(-28, 0, -18), hand_l=(0.14, -0.70, 0.62), hand_r=(-0.14, -0.70, 0.62), foot_l=(0.18, -0.32, 0.068), foot_r=(-0.18, 0.26, 0.068), scale_hand_l=1.20, scale_hand_r=1.20), "EASE_OUT"),
        KeySpec(tot, idle0, "BEZIER"),
    ], tot)

    # FHEAVY: GANONDORF / DK COLOSSAL SEISMIC METEOR HAYMAKER!
    st, act, tot = mv("Fheavy", (18, 4, 54))
    coil_b = SemanticPose(
        hip_off=(0.0, 0.18, -0.20),
        hips_rot=(14.0, 0.0, -62.0),
        spine_rot=(8.0, 0.0, -16.0),
        chest_rot=(6.0, 0.0, -18.0),
        head_rot=(-16.0, 0.0, 74.0),
        hand_l=(0.18, -0.40, 0.64),
        hand_r=(-0.34, 0.44, 0.56),
        elbow_pole_r=(-0.60, 0.65, 0.60),
        foot_l=(0.18, -0.26, 0.068),
        foot_r=(-0.18, 0.30, 0.068),
        knee_pole_l=(0.22, -0.72, 0.28),
        knee_pole_r=(-0.22, -0.22, 0.28),
        scale_hand_r=1.22,
    )
    snap_b = SemanticPose(
        hip_off=(0.0, -0.20, -0.14),
        hips_rot=(26.0, 0.0, 50.0),
        spine_rot=(12.0, 0.0, 20.0),
        chest_rot=(10.0, 0.0, 24.0),
        head_rot=(-32.0, 0.0, -70.0),
        hand_l=(0.34, 0.34, 0.56),
        hand_r=(-0.02, -0.82, 0.64),
        elbow_pole_r=(-0.44, 0.10, 0.68),
        foot_l=(0.18, -0.36, 0.068),
        foot_r=(-0.18, 0.34, 0.070),
        knee_pole_l=(0.22, -0.84, 0.28),
        knee_pole_r=(-0.22, -0.14, 0.28),
        scale_hand_r=1.56,
    )
    follow_b = SemanticPose(
        hip_off=(0.0, -0.22, -0.16),
        hips_rot=(28.0, 0.0, 56.0),
        spine_rot=(12.0, 0.0, 22.0),
        chest_rot=(10.0, 0.0, 26.0),
        head_rot=(-34.0, 0.0, -76.0),
        hand_l=(0.36, 0.36, 0.52),
        hand_r=(0.06, -0.76, 0.56),
        foot_l=(0.18, -0.36, 0.068),
        foot_r=(-0.18, 0.34, 0.070),
        scale_hand_r=1.34,
    )
    _replace_clip(compiler, "Fheavy", [
        KeySpec(0, idle0, "EASE_IN"),
        KeySpec(6, coil_b, "HOLD"),
        KeySpec(st - 2, coil_b, "SNAP"),
        KeySpec(st, snap_b, "HOLD"),
        KeySpec(st + act + 4, follow_b, "EASE_OUT"),
        KeySpec(tot, idle0, "BEZIER"),
    ], tot)

    # FAIR: ICONIC DONKEY KONG OVERHEAD TWO-HANDED METEOR DUNK!!
    st, act, tot = mv("Fair", (14, 4, 44))
    fall_b = SemanticPose(hip_off=(0, 0, 0.04), hips_rot=(10, 0, -14), hand_l=(0.28, -0.16, 0.72), hand_r=(-0.28, -0.16, 0.72), foot_l=(0.16, -0.10, 0.16), foot_r=(-0.16, 0.16, 0.20))
    _replace_clip(compiler, "Fair", [
        KeySpec(0, fall_b, "EASE_IN"),
        KeySpec(max(2, st - 3), SemanticPose(hip_off=(0, 0.06, 0.10), hips_rot=(-26, 0, -12), spine_rot=(-14, 0, 0), chest_rot=(-14, 0, 0), head_rot=(16, 0, 10), hand_l=(0.10, 0.12, 1.24), hand_r=(-0.10, 0.12, 1.24), elbow_pole_l=(0.36, 0.10, 1.05), elbow_pole_r=(-0.36, 0.10, 1.05), foot_l=(0.16, 0.14, 0.22), foot_r=(-0.16, 0.24, 0.28)), "SNAP"),
        KeySpec(st, SemanticPose(hip_off=(0, -0.12, 0.02), hips_rot=(36, 0, 10), spine_rot=(16, 0, 0), chest_rot=(14, 0, 0), head_rot=(-24, 0, -10), hand_l=(0.08, -0.72, 0.30), hand_r=(-0.08, -0.72, 0.30), elbow_pole_l=(0.34, -0.25, 0.62), elbow_pole_r=(-0.34, -0.25, 0.62), foot_l=(0.16, 0.26, 0.28), foot_r=(-0.16, 0.34, 0.34), scale_hand_l=1.46, scale_hand_r=1.46), "HOLD"),
        KeySpec(st + act + 4, SemanticPose(hip_off=(0, -0.10, 0.0), hips_rot=(32, 0, 10), chest_rot=(12, 0, 0), hand_l=(0.10, -0.64, 0.26), hand_r=(-0.10, -0.64, 0.26), foot_l=(0.16, 0.22, 0.24), foot_r=(-0.16, 0.28, 0.28), scale_hand_l=1.24, scale_hand_r=1.24), "EASE_OUT"),
        KeySpec(tot, fall_b, "BEZIER"),
    ], tot)

    # USPEC: VOLCANIC MEGATON RISING UPPERCUT!
    st, act, tot = mv("Uspec", (10, 10, 44))
    _replace_clip(compiler, "Uspec", [
        KeySpec(0, SemanticPose(hip_off=(0, 0, -0.24), hips_rot=(24, 0, -34), hand_l=(0.24, -0.16, 0.40), hand_r=(-0.26, 0.24, 0.32), foot_l=(0.18, -0.18, 0.068), foot_r=(-0.18, 0.20, 0.068)), "SNAP"),
        KeySpec(st, SemanticPose(hip_off=(0, -0.06, 0.10), hips_rot=(-18, 0, 46), spine_rot=(-10, 0, 16), chest_rot=(-8, 0, 20), head_rot=(-14, 0, -56), hand_l=(0.28, 0.26, 0.56), hand_r=(-0.04, -0.24, 1.32), elbow_pole_r=(-0.38, -0.10, 0.90), foot_r=(-0.16, -0.26, 0.44), knee_pole_r=(-0.20, -0.82, 0.66), foot_l=(0.14, 0.14, 0.06), scale_hand_r=1.52), "HOLD"),
        KeySpec(tot, fall_b, "EASE_OUT"),
    ], tot)

    # DAIR: GANONDORF / BOWSER EARTHQUAKE DOUBLE-HEEL STOMP!
    st, act, tot = mv("Dair", (16, 4, 48))
    _replace_clip(compiler, "Dair", [
        KeySpec(0, fall_b, "EASE_IN"),
        KeySpec(max(2, st - 3), SemanticPose(hip_off=(0, 0, 0.16), hips_rot=(28, 0, -14), chest_rot=(14, 0, 8), hand_l=(0.28, -0.14, 0.98), hand_r=(-0.28, -0.14, 0.98), foot_l=(0.18, -0.22, 0.46), foot_r=(-0.18, -0.18, 0.50), knee_pole_l=(0.24, -0.84, 0.66), knee_pole_r=(-0.24, -0.84, 0.66)), "SNAP"),
        KeySpec(st, SemanticPose(hip_off=(0, -0.04, 0.02), hips_rot=(24, 0, -18), spine_rot=(12, 0, 8), chest_rot=(14, 0, 12), head_rot=(24, 0, 12), hand_l=(0.42, 0.30, 0.92), hand_r=(-0.42, 0.30, 0.92), foot_l=(0.14, -0.20, -0.04), foot_r=(-0.14, 0.12, 0.10), knee_pole_l=(0.18, -0.80, 0.36), knee_pole_r=(-0.18, -0.60, 0.42), scale_foot_l=1.48, scale_foot_r=1.42), "HOLD"),
        KeySpec(tot, fall_b, "EASE_OUT"),
    ], tot)

    # SSPEC: RHINO SHOULDER STAMPEDE!
    st, act, tot = mv("Sspec", (12, 14, 42))
    _replace_clip(compiler, "Sspec", [
        KeySpec(0, idle0, "SNAP"),
        KeySpec(st, SemanticPose(hip_off=(0, -0.18, -0.14), hips_rot=(42, 0, -46), spine_rot=(16, 0, -10), chest_rot=(12, 0, -12), head_rot=(-34, 0, 56), hand_l=(0.24, -0.22, 0.54), hand_r=(-0.34, 0.40, 0.58), foot_l=(0.16, 0.34, 0.16), foot_r=(-0.16, -0.28, 0.08), scale_hand_l=1.36), "HOLD"),
        KeySpec(tot, idle0, "EASE_OUT"),
    ], tot)

    return clips


def build_tide_moveset(
    compiler: SmashPoseCompiler,
    move_frames: dict[str, tuple[int, int, int]],
) -> list[str]:
    """Build Water ('TIDE') 45-clip acrobatic hydro-ninja moveset (Greninja / Sheik / Inkling blueprint)."""
    clips = build_ignis_moveset(compiler, move_frames)

    def mv(key: str, default: tuple[int, int, int]) -> tuple[int, int, int]:
        return move_frames.get(key, default)

    # Iconic Style B martial-arts crane/water-bender guard (poised right hand near chest, flowing left arm out, downward elbow poles so silk water sleeves drape gracefully downward!)
    idle0 = SemanticPose(
        hip_off=(0.0, 0.0, -0.03),
        hips_rot=(5.0, 0.0, -24.0),
        spine_rot=(3.0, 0.0, 8.0),
        chest_rot=(3.0, 0.0, 12.0),
        head_rot=(-6.0, 0.0, 12.0),
        hand_l=(0.34, -0.14, 0.64),
        hand_r=(-0.06, -0.18, 0.72),
        elbow_pole_l=(0.30, 0.16, 0.28),
        elbow_pole_r=(-0.38, 0.06, 0.34),
        foot_l=(0.12, -0.16, 0.068),
        foot_r=(-0.13, 0.16, 0.068),
        knee_pole_l=(0.16, -0.66, 0.32),
        knee_pole_r=(-0.18, -0.34, 0.32),
        flame_drag=(6.0, 4.0),
        scarf_drag=(8.0, 4.0),
    )
    idle1 = SemanticPose(
        hip_off=(0.0, 0.0, -0.055),
        hips_rot=(7.0, 0.0, -22.0),
        spine_rot=(4.0, 0.0, 8.0),
        chest_rot=(4.0, 0.0, 12.0),
        head_rot=(-8.0, 0.0, 11.0),
        hand_l=(0.36, -0.12, 0.62),
        hand_r=(-0.05, -0.20, 0.70),
        elbow_pole_l=(0.30, 0.16, 0.26),
        elbow_pole_r=(-0.38, 0.06, 0.32),
        foot_l=(0.12, -0.16, 0.068),
        foot_r=(-0.13, 0.16, 0.068),
        flame_drag=(10.0, -4.0),
        scarf_drag=(12.0, -5.0),
    )
    _replace_clip(compiler, "Idle", [KeySpec(0, idle0), KeySpec(18, idle1), KeySpec(36, idle0)], 36)

    # JAB 2: Lightning-fast Sheik/Greninja water-palm chop!
    st, act, tot = mv("Jab2", (3, 2, 15))
    _replace_clip(compiler, "Jab2", [
        KeySpec(0, idle0, "SNAP"),
        KeySpec(st, SemanticPose(hip_off=(0, -0.10, -0.06), hips_rot=(14, 0, 38), chest_rot=(8, 0, 24), head_rot=(-14, 0, -44), hand_l=(0.24, 0.24, 0.62), hand_r=(-0.02, -0.68, 0.74), elbow_pole_l=(0.34, 0.32, 0.24), elbow_pole_r=(-0.22, 0.12, 0.24), foot_l=(0.12, -0.24, 0.068), foot_r=(-0.14, 0.24, 0.068), scale_hand_r=1.34, flame_drag=(24, 10), scarf_drag=(30, 14)), "HOLD"),
        KeySpec(tot, idle0, "EASE_OUT"),
    ], tot)

    # FHEAVY: FLUID HYDRO-WHIP TWIN-PALM TIDAL THRUST!
    st, act, tot = mv("Fheavy", (13, 3, 44))
    coil_t = SemanticPose(
        hip_off=(0.0, 0.14, -0.14),
        hips_rot=(12.0, 0.0, -54.0),
        spine_rot=(6.0, 0.0, -14.0),
        chest_rot=(6.0, 0.0, -16.0),
        head_rot=(-14.0, 0.0, 62.0),
        hand_l=(0.20, 0.24, 0.68),
        hand_r=(-0.22, 0.34, 0.56),
        elbow_pole_l=(0.36, 0.36, 0.28),
        elbow_pole_r=(-0.44, 0.44, 0.24),
        foot_l=(0.12, -0.24, 0.068),
        foot_r=(-0.14, 0.26, 0.068),
        flame_drag=(20.0, -14.0),
        scarf_drag=(26.0, -16.0),
    )
    snap_t = SemanticPose(
        hip_off=(0.0, -0.18, -0.09),
        hips_rot=(20.0, 0.0, 44.0),
        spine_rot=(10.0, 0.0, 18.0),
        chest_rot=(8.0, 0.0, 22.0),
        head_rot=(-24.0, 0.0, -64.0),
        hand_l=(0.14, -0.64, 0.74),
        hand_r=(-0.06, -0.78, 0.66),
        elbow_pole_l=(0.30, 0.06, 0.22),
        elbow_pole_r=(-0.26, 0.06, 0.18),
        foot_l=(0.12, -0.34, 0.068),
        foot_r=(-0.14, 0.32, 0.070),
        scale_hand_l=1.30,
        scale_hand_r=1.46,
        flame_drag=(38.0, 16.0),
        scarf_drag=(46.0, 20.0),
    )
    follow_t = SemanticPose(
        hip_off=(0.0, -0.20, -0.10),
        hips_rot=(22.0, 0.0, 50.0),
        chest_rot=(8.0, 0.0, 24.0),
        head_rot=(-26.0, 0.0, -68.0),
        hand_l=(0.18, -0.60, 0.76),
        hand_r=(0.02, -0.74, 0.62),
        elbow_pole_l=(0.32, 0.06, 0.22),
        elbow_pole_r=(-0.24, 0.08, 0.18),
        foot_l=(0.12, -0.34, 0.068),
        foot_r=(-0.14, 0.32, 0.070),
        scale_hand_r=1.24,
        flame_drag=(30.0, 14.0),
        scarf_drag=(38.0, 16.0),
    )
    _replace_clip(compiler, "Fheavy", [
        KeySpec(0, idle0, "EASE_IN"),
        KeySpec(4, coil_t, "HOLD"),
        KeySpec(st - 2, coil_t, "SNAP"),
        KeySpec(st, snap_t, "HOLD"),
        KeySpec(st + act + 3, follow_t, "EASE_OUT"),
        KeySpec(tot, idle0, "BEZIER"),
    ], tot)

    # FAIR: ICONIC SHEIK / GRENINJA HYDRO-WHIP SLASH KICK!
    st, act, tot = mv("Fair", (7, 4, 30))
    fall_t = SemanticPose(hip_off=(0, 0, 0.05), hips_rot=(8, 0, -18), hand_l=(0.24, -0.18, 0.74), hand_r=(-0.24, -0.18, 0.74), elbow_pole_l=(0.36, 0.14, 0.28), elbow_pole_r=(-0.36, 0.14, 0.28), foot_l=(0.12, -0.12, 0.18), foot_r=(-0.12, 0.18, 0.24))
    _replace_clip(compiler, "Fair", [
        KeySpec(0, fall_t, "EASE_IN"),
        KeySpec(max(1, st - 2), SemanticPose(hip_off=(0, 0.06, 0.06), hips_rot=(-14, 16, -24), hand_l=(0.22, -0.24, 0.78), hand_r=(-0.26, 0.14, 0.66), elbow_pole_l=(0.36, 0.14, 0.30), elbow_pole_r=(-0.36, 0.20, 0.28), foot_l=(0.10, 0.14, 0.24), foot_r=(-0.12, 0.26, 0.42)), "SNAP"),
        KeySpec(st, SemanticPose(hip_off=(0, -0.10, 0.06), hips_rot=(-22, 24, 34), spine_rot=(-8, 12, 14), chest_rot=(-6, 10, 16), head_rot=(18, -16, -44), hand_l=(0.30, 0.30, 0.72), hand_r=(-0.28, -0.44, 0.74), elbow_pole_l=(0.38, 0.34, 0.26), elbow_pole_r=(-0.38, 0.06, 0.26), foot_l=(0.12, 0.34, 0.22), foot_r=(-0.02, -0.66, 0.56), knee_pole_r=(-0.14, -0.82, 0.66), scale_foot_r=1.42, scale_hand_r=1.28, flame_drag=(36, 14), scarf_drag=(46, 18)), "HOLD"),
        KeySpec(tot, fall_t, "EASE_OUT"),
    ], tot)

    # USPEC: DOLPHIN CORKSCREW HYDRO-SPIRAL ASCENT!
    st, act, tot = mv("Uspec", (6, 8, 36))
    _replace_clip(compiler, "Uspec", [
        KeySpec(0, SemanticPose(hip_off=(0, 0, -0.18), hips_rot=(20, 0, -28), hand_l=(0.22, -0.16, 0.48), hand_r=(-0.22, -0.16, 0.48), foot_l=(0.12, -0.14, 0.068), foot_r=(-0.12, 0.16, 0.068)), "SNAP"),
        KeySpec(st, SemanticPose(hip_off=(0, -0.04, 0.12), hips_rot=(-22, 16, 48), spine_rot=(-10, 8, 16), chest_rot=(-8, 8, 20), head_rot=(-12, -10, -56), hand_l=(0.24, 0.24, 0.88), hand_r=(-0.12, -0.26, 1.24), elbow_pole_l=(0.40, 0.34, 0.46), elbow_pole_r=(-0.36, 0.10, 0.72), foot_r=(-0.08, -0.34, 0.58), knee_pole_r=(-0.14, -0.84, 0.76), foot_l=(0.12, 0.22, 0.08), scale_hand_r=1.34, scale_foot_r=1.36, flame_drag=(24, 14), scarf_drag=(32, 16)), "HOLD"),
        KeySpec(tot, fall_t, "EASE_OUT"),
    ], tot)

    # DAIR: GRENINJA / SHEIK DIVING DIAGONAL METEOR HEEL-SPIKE!
    st, act, tot = mv("Dair", (11, 4, 38))
    _replace_clip(compiler, "Dair", [
        KeySpec(0, fall_t, "EASE_IN"),
        KeySpec(max(2, st - 2), SemanticPose(hip_off=(0, 0, 0.12), hips_rot=(26, 0, -18), hand_l=(0.24, -0.14, 0.90), hand_r=(-0.24, -0.14, 0.90), foot_l=(0.12, -0.18, 0.44), foot_r=(-0.12, -0.12, 0.48)), "SNAP"),
        KeySpec(st, SemanticPose(hip_off=(0, -0.08, 0.04), hips_rot=(32, 0, -26), spine_rot=(14, 0, 10), chest_rot=(12, 0, 14), head_rot=(16, 0, 16), hand_l=(0.36, 0.34, 0.88), hand_r=(-0.36, 0.32, 0.88), elbow_pole_l=(0.44, 0.36, 0.44), elbow_pole_r=(-0.44, 0.36, 0.44), foot_l=(0.06, -0.36, -0.02), foot_r=(-0.12, 0.26, 0.26), knee_pole_l=(0.10, -0.82, 0.34), knee_pole_r=(-0.16, -0.36, 0.46), scale_foot_l=1.48, flame_drag=(34, 0), scarf_drag=(42, 0)), "HOLD"),
        KeySpec(tot, fall_t, "EASE_OUT"),
    ], tot)

    return clips


def build_zephyr_moveset(
    compiler: SmashPoseCompiler,
    move_frames: dict[str, tuple[int, int, int]],
) -> list[str]:
    """Build Air ('ZEPHYR') 45-clip sky-acrobat Gale-Staff moveset (Joker / Sora / Fox / Palutena blueprint)."""
    clips = build_ignis_moveset(compiler, move_frames)

    def mv(key: str, default: tuple[int, int, int]) -> tuple[int, int, int]:
        return move_frames.get(key, default)

    # Poised windswept sky-monk idle holding twin-tip Gale Staff diagonally across her silhouette (matches Style B art!)
    idle0 = SemanticPose(
        hip_off=(0.0, 0.0, -0.01),
        hips_rot=(5.0, 0.0, -24.0),
        spine_rot=(3.0, 0.0, 8.0),
        chest_rot=(3.0, 0.0, 12.0),
        head_rot=(-6.0, 0.0, 12.0),
        hand_l=(0.24, -0.14, 0.56),
        hand_r=(-0.24, 0.02, 0.50),
        elbow_pole_l=(0.42, 0.20, 0.56),
        elbow_pole_r=(-0.44, 0.26, 0.56),
        foot_l=(0.12, -0.16, 0.068),
        foot_r=(-0.14, 0.16, 0.068),
        knee_pole_l=(0.16, -0.64, 0.32),
        knee_pole_r=(-0.18, -0.32, 0.32),
        weapon_rot=(10.0, 48.0, 0.0),
        scarf_drag=(14.0, 6.0),
    )
    idle1 = SemanticPose(
        hip_off=(0.0, 0.0, 0.02),
        hips_rot=(4.0, 0.0, -22.0),
        spine_rot=(2.0, 0.0, 8.0),
        chest_rot=(2.0, 0.0, 12.0),
        head_rot=(-5.0, 0.0, 11.0),
        hand_l=(0.25, -0.16, 0.58),
        hand_r=(-0.25, 0.03, 0.52),
        elbow_pole_l=(0.42, 0.20, 0.58),
        elbow_pole_r=(-0.44, 0.26, 0.58),
        foot_l=(0.12, -0.16, 0.068),
        foot_r=(-0.14, 0.16, 0.068),
        weapon_rot=(12.0, 50.0, 0.0),
        scarf_drag=(22.0, -6.0),
    )
    _replace_clip(compiler, "Idle", [KeySpec(0, idle0), KeySpec(18, idle1), KeySpec(36, idle0)], 36)

    # JAB 2: Swift Gale-Staff diagonal cross-slash!
    st, act, tot = mv("Jab2", (6, 3, 30))
    _replace_clip(compiler, "Jab2", [
        KeySpec(0, idle0, "EASE_IN"),
        KeySpec(max(1, st - 2), SemanticPose(hip_off=(0, 0.08, -0.06), hips_rot=(8, 0, -44), chest_rot=(6, 0, -14), head_rot=(-10, 0, 44), hand_l=(0.22, -0.24, 0.64), hand_r=(-0.28, 0.22, 0.64), foot_l=(0.12, -0.20, 0.068), foot_r=(-0.14, 0.22, 0.068), weapon_rot=(-16, 48, 0)), "SNAP"),
        KeySpec(st, SemanticPose(hip_off=(0, -0.12, -0.05), hips_rot=(16, 0, 42), spine_rot=(8, 0, 14), chest_rot=(8, 0, 18), head_rot=(-18, 0, -52), hand_l=(0.28, 0.22, 0.58), hand_r=(0.04, -0.68, 0.68), foot_l=(0.12, -0.26, 0.068), foot_r=(-0.14, 0.24, 0.068), weapon_rot=(10, -42, 0), scale_weapon=1.22, scarf_drag=(38, 18)), "HOLD"),
        KeySpec(tot, idle0, "EASE_OUT"),
    ], tot)

    # FTILT: Long-reach razor-straight horizontal Gale-Lance spear poke!
    st, act, tot = mv("Ftilt", (8, 3, 30))
    _replace_clip(compiler, "Ftilt", [
        KeySpec(0, idle0, "EASE_IN"),
        KeySpec(max(1, st - 2), SemanticPose(hip_off=(0, 0.10, -0.08), hips_rot=(10, 0, -40), hand_l=(0.18, -0.26, 0.62), hand_r=(-0.26, 0.26, 0.56), foot_l=(0.12, -0.20, 0.068), foot_r=(-0.14, 0.22, 0.068), weapon_rot=(6, 12, 0)), "SNAP"),
        KeySpec(st, SemanticPose(hip_off=(0, -0.14, -0.08), hips_rot=(20, 0, 44), chest_rot=(8, 0, 20), head_rot=(-22, 0, -54), hand_l=(0.26, 0.24, 0.56), hand_r=(-0.04, -0.72, 0.64), foot_l=(0.12, -0.28, 0.068), foot_r=(-0.14, 0.26, 0.068), weapon_rot=(0, 0, 0), scale_weapon=1.26, scarf_drag=(42, 16)), "HOLD"),
        KeySpec(tot, idle0, "EASE_OUT"),
    ], tot)

    # FHEAVY: TEMPEST GALE-LANCE RAZOR-HORIZONTAL SPEAR THRUST!
    st, act, tot = mv("Fheavy", (17, 3, 50))
    coil_z = SemanticPose(
        hip_off=(0.0, 0.16, -0.14),
        hips_rot=(12.0, 0.0, -58.0),
        spine_rot=(6.0, 0.0, -14.0),
        chest_rot=(6.0, 0.0, -16.0),
        head_rot=(-14.0, 0.0, 66.0),
        hand_l=(0.16, -0.36, 0.66),
        hand_r=(-0.28, 0.40, 0.58),
        elbow_pole_r=(-0.54, 0.62, 0.60),
        foot_l=(0.14, -0.24, 0.068),
        foot_r=(-0.16, 0.28, 0.068),
        weapon_rot=(12.0, 18.0, 0.0),
        scarf_drag=(30.0, -20.0),
    )
    snap_z = SemanticPose(
        hip_off=(0.0, -0.20, -0.10),
        hips_rot=(22.0, 0.0, 48.0),
        spine_rot=(10.0, 0.0, 18.0),
        chest_rot=(10.0, 0.0, 22.0),
        head_rot=(-28.0, 0.0, -68.0),
        hand_l=(0.30, 0.34, 0.58),
        hand_r=(-0.02, -0.78, 0.66),
        elbow_pole_r=(-0.38, 0.12, 0.68),
        foot_l=(0.14, -0.34, 0.068),
        foot_r=(-0.16, 0.34, 0.070),
        weapon_rot=(0.0, 0.0, 0.0),
        scale_hand_r=1.30,
        scale_weapon=1.30,
        scarf_drag=(64.0, 26.0),
    )
    follow_z = SemanticPose(
        hip_off=(0.0, -0.22, -0.11),
        hips_rot=(24.0, 0.0, 54.0),
        chest_rot=(10.0, 0.0, 24.0),
        head_rot=(-30.0, 0.0, -72.0),
        hand_l=(0.32, 0.36, 0.56),
        hand_r=(0.04, -0.74, 0.64),
        foot_l=(0.14, -0.34, 0.068),
        foot_r=(-0.16, 0.34, 0.070),
        weapon_rot=(4.0, -4.0, 0.0),
        scale_weapon=1.18,
        scarf_drag=(50.0, 20.0),
    )
    _replace_clip(compiler, "Fheavy", [
        KeySpec(0, idle0, "EASE_IN"),
        KeySpec(5, coil_z, "HOLD"),
        KeySpec(st - 2, coil_z, "SNAP"),
        KeySpec(st, snap_z, "HOLD"),
        KeySpec(st + act + 4, follow_z, "EASE_OUT"),
        KeySpec(tot, idle0, "BEZIER"),
    ], tot)

    # FAIR: SORA / JOKER SWEEPING CRESCENT GALE-STAFF SLASH!
    st, act, tot = mv("Fair", (9, 4, 34))
    fall_z = SemanticPose(hip_off=(0, 0, 0.06), hips_rot=(8, 0, -18), hand_l=(0.24, -0.16, 0.72), hand_r=(-0.24, -0.10, 0.60), foot_l=(0.12, -0.10, 0.18), foot_r=(-0.12, 0.22, 0.24), weapon_rot=(10, 44, 0), scarf_drag=(22, 0))
    _replace_clip(compiler, "Fair", [
        KeySpec(0, fall_z, "EASE_IN"),
        KeySpec(max(2, st - 2), SemanticPose(hip_off=(0, 0.08, 0.08), hips_rot=(-14, 0, -34), hand_l=(0.22, -0.22, 0.76), hand_r=(-0.26, 0.26, 0.92), foot_l=(0.12, 0.10, 0.20), foot_r=(-0.12, 0.28, 0.28), weapon_rot=(-14, 42, 0)), "SNAP"),
        KeySpec(st, SemanticPose(hip_off=(0, -0.12, 0.06), hips_rot=(20, 0, 44), spine_rot=(10, 0, 16), chest_rot=(10, 0, 20), head_rot=(-24, 0, -56), hand_l=(0.30, 0.34, 0.68), hand_r=(-0.02, -0.74, 0.68), foot_l=(0.10, -0.24, 0.26), foot_r=(-0.14, 0.34, 0.16), weapon_rot=(8, -36, 0), scale_weapon=1.28, scarf_drag=(58, 22)), "HOLD"),
        KeySpec(tot, fall_z, "EASE_OUT"),
    ], tot)

    # USPEC: SOARING TORNADO SKY-VAULT SPEAR THRUST (razor-straight skyward!)
    st, act, tot = mv("Uspec", (7, 9, 38))
    _replace_clip(compiler, "Uspec", [
        KeySpec(0, SemanticPose(hip_off=(0, 0, -0.16), hips_rot=(18, 0, -28), hand_l=(0.22, -0.16, 0.48), hand_r=(-0.22, 0.14, 0.44), foot_l=(0.12, -0.14, 0.068), foot_r=(-0.12, 0.16, 0.068), weapon_rot=(10, 32, 0)), "SNAP"),
        KeySpec(st, SemanticPose(hip_off=(0, -0.04, 0.14), hips_rot=(-16, 0, 38), spine_rot=(-10, 0, 14), chest_rot=(-8, 0, 16), head_rot=(-18, 0, -48), hand_l=(0.28, 0.26, 0.56), hand_r=(-0.06, -0.24, 1.28), elbow_pole_r=(-0.34, -0.12, 0.90), foot_r=(-0.12, -0.22, 0.44), knee_pole_r=(-0.16, -0.80, 0.66), foot_l=(0.10, 0.14, 0.06), weapon_rot=(0, 0, 0), scale_weapon=1.26, scarf_drag=(38, 18)), "HOLD"),
        KeySpec(tot, fall_z, "EASE_OUT"),
    ], tot)

    # DAIR: ICONIC PALUTENA / SORA PLUNGING GALE-SPEAR METEOR DIVE (spears straight downward!)
    st, act, tot = mv("Dair", (12, 4, 42))
    _replace_clip(compiler, "Dair", [
        KeySpec(0, fall_z, "EASE_IN"),
        KeySpec(max(2, st - 2), SemanticPose(hip_off=(0, 0, 0.14), hips_rot=(18, 0, -24), hand_l=(0.24, -0.16, 0.88), hand_r=(-0.24, 0.10, 1.02), foot_l=(0.12, -0.18, 0.40), foot_r=(-0.12, 0.14, 0.44), weapon_rot=(10, 24, 0)), "SNAP"),
        KeySpec(st, SemanticPose(hip_off=(0, -0.04, 0.08), hips_rot=(30, 0, 26), spine_rot=(12, 0, 12), chest_rot=(12, 0, 14), head_rot=(20, 0, -28), hand_l=(0.34, 0.26, 0.88), hand_r=(-0.08, -0.26, 0.24), elbow_pole_r=(-0.36, 0.08, 0.62), foot_l=(0.14, 0.24, 0.34), foot_r=(-0.14, 0.32, 0.42), knee_pole_l=(0.18, -0.42, 0.56), knee_pole_r=(-0.18, -0.34, 0.60), weapon_rot=(-6, 0, 0), scale_weapon=1.28, scarf_drag=(48, 14)), "HOLD"),
        KeySpec(tot, fall_z, "EASE_OUT"),
    ], tot)

    return clips
