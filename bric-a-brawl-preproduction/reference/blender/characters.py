"""characters.py - reference builders for the four launch fighters.

Each fighter is 6-12 RIGID parts under one root empty. No skinning, no weight painting:
at export every part becomes one bone with 100% weights (see export_gltf.py).
Part origins are the pivot the animation system rotates/scales around.

Slots used on faces (resolved to colours by the `livery` argument = the player's colour):
  body / body2 / trim   character-specific glazes
  livery                the player's colour (hands are ALWAYS livery: hands deal the hits)
  bone, ink, cheek, gilt, bisque, iron
"""
import math
from ceramic import Builder, empty, PAL

def _part(root, b, colours, finishes=None, loc=(0, 0, 0)):
    return b.finish(parent=root, colours=colours, finishes=finishes or {}, loc=loc)

def _ring(b, centre, radius, tube, slot, plane="XZ", segs=20):
    pts = []
    for i in range(segs + 1):
        a = 2 * math.pi * i / segs
        if plane == "XZ": pts.append((centre[0] + radius * math.cos(a), centre[1], centre[2] + radius * math.sin(a)))
        elif plane == "YZ": pts.append((centre[0], centre[1] + radius * math.cos(a), centre[2] + radius * math.sin(a)))
        else: pts.append((centre[0] + radius * math.cos(a), centre[1] + radius * math.sin(a), centre[2]))
    b.sweep(pts, tube, segs=8, sub=1, slot=slot, cap=False)

# ------------------------------------------------------------------ EARL, the teapot
def earl(livery="cobalt", seed=1):
    root = empty("CHR_earl")
    C = {"body": "bone", "trim": livery, "livery": livery, "ink": "ink", "gilt": "gilt", "bone": "bone"}
    F = {"gilt": "gilt", "ink": "satin"}
    z0 = 0.16
    b = Builder("earl_body", seed)
    b.lathe([(0.0, 0.0, "trim"), (0.30, 0.0, "trim"), (0.345, 0.03, "trim"), (0.33, 0.085, "trim"), (0.44, 0.17, "body"),
             (0.585, 0.38, "body"), (0.635, 0.60, "body"), (0.585, 0.82, "body"), (0.47, 0.97, "livery"), (0.385, 1.035, "livery"),
             (0.355, 1.075, "trim"), (0.30, 1.085, "trim"), (0.0, 1.085, "trim")], segs=24, wobble=0.014, origin=(0, 0, z0))
    # spout = nose. Pulled, flared at the lip.
    b.sweep([(0.50, 0, z0 + 0.46), (0.80, 0, z0 + 0.55), (0.99, 0, z0 + 0.78), (1.08, 0, z0 + 0.98), (1.12, 0, z0 + 1.04)],
            [0.185, 0.13, 0.085, 0.075, 0.092], segs=12, slot="body")
    _ring(b, (1.115, 0, z0 + 1.035), 0.088, 0.016, "trim", plane="YZ")
    # handle
    b.sweep([(-0.50, 0, z0 + 0.92), (-0.80, 0, z0 + 0.96), (-0.98, 0, z0 + 0.70), (-0.86, 0, z0 + 0.40), (-0.55, 0, z0 + 0.33)],
            [0.07, 0.062, 0.058, 0.062, 0.07], segs=10, slot="trim")
    # face: eyes either side of the spout root, heavy brows, a proper moustache, a monocle on the camera side
    for s in (-1, 1):
        b.blob((0.545, s * 0.27, z0 + 0.76), (0.035, 0.062, 0.095), "ink", tilt=(0, 0, s * 0.45))
        b.sweep([(0.56, s * 0.15, z0 + 0.93), (0.535, s * 0.27, z0 + 0.905), (0.49, s * 0.38, z0 + 0.86)], [0.016, 0.028, 0.012], segs=8, slot="ink")
        b.sweep([(0.615, s * 0.03, z0 + 0.40), (0.60, s * 0.19, z0 + 0.345), (0.535, s * 0.33, z0 + 0.39), (0.50, s * 0.385, z0 + 0.48)],
                [0.034, 0.044, 0.03, 0.008], segs=8, slot="ink")
    _ring(b, (0.585, -0.275, z0 + 0.76), 0.135, 0.016, "gilt", plane="YZ")
    _part(root, b, C, F)
    lid = Builder("earl_lid", seed + 1)
    lid.lathe([(0.34, 0.0, "livery"), (0.325, 0.045, "livery"), (0.22, 0.12, "livery"), (0.09, 0.165, "livery"), (0.055, 0.20, "gilt"),
               (0.105, 0.26, "gilt"), (0.10, 0.325, "gilt"), (0.0, 0.36, "gilt")], segs=24, wobble=0.012)
    _part(root, lid, C, F, loc=(0, 0, z0 + 1.085))
    for s, nm in ((-1, "handF"), (1, "handB")):
        h = Builder(f"earl_{nm}", seed + 3)
        h.blob((0, 0, 0), (0.17, 0.13, 0.15), "livery"); h.blob((0.10, 0, 0.11), (0.07, 0.06, 0.07), "livery")
        h.lathe([(0.105, -0.02, "bone"), (0.12, 0.0, "bone"), (0.105, 0.04, "bone")], segs=14, sub=1, origin=(-0.15, 0, -0.01), axis="X")
        _part(root, h, C, F, loc=(0.16, s * 0.88, z0 + 0.36))
    for s, nm in ((-1, "footF"), (1, "footB")):
        f = Builder(f"earl_{nm}", seed + 5)
        f.blob((0.05, 0, 0.075), (0.21, 0.135, 0.075), "trim")
        _part(root, f, C, F, loc=(0.02, s * 0.25, 0.0))
    return root

# ------------------------------------------------------------------ GROG, the bull
def grog(livery="oxblood", seed=11):
    root = empty("CHR_grog")
    C = {"body": "oxblood" if livery != "oxblood" else "iron", "muzzle": "bisque", "livery": livery, "ink": "ink", "gilt": "gilt", "bone": "bone", "hoof": "tenmoku"}
    C["body"] = "basalt"   # black basalt stoneware: neutral, so ANY livery reads on him
    F = {"gilt": "gilt", "muzzle": "satin", "hoof": "satin", "ink": "satin", "body": "satin"}
    zc = 0.98
    b = Builder("grog_body", seed)
    b.lathe([(0.0, -0.80, "body"), (0.30, -0.78, "body"), (0.47, -0.62, "body"), (0.53, -0.34, "body"), (0.545, -0.27, "gilt"),
             (0.55, -0.24, "livery"), (0.585, 0.02, "livery"), (0.62, 0.24, "livery"), (0.625, 0.27, "gilt"), (0.635, 0.31, "body"),
             (0.62, 0.52, "body"), (0.50, 0.72, "body"), (0.30, 0.84, "body"), (0.0, 0.86, "body")],
            segs=24, wobble=0.016, axis="X", origin=(0, 0, zc), squash=(0.94, 1.0))
    b.blob((0.40, 0, zc + 0.50), (0.36, 0.40, 0.26), "body")            # shoulder hump
    b.sweep([(-0.78, 0, zc + 0.20), (-1.02, 0, zc + 0.34), (-1.16, 0, zc + 0.10), (-1.12, 0, zc - 0.18)], [0.05, 0.04, 0.035, 0.03], segs=8, slot="body")
    b.blob((-1.11, 0, zc - 0.25), (0.07, 0.07, 0.11), "hoof")
    _part(root, b, C, F)
    h = Builder("grog_head", seed + 1)
    h.blob((0, 0, 0), (0.37, 0.36, 0.35), "body")
    h.blob((0.30, 0, -0.14), (0.25, 0.275, 0.21), "muzzle")
    for s in (-1, 1):
        h.blob((0.52, s * 0.095, -0.12), (0.02, 0.035, 0.045), "ink")                       # nostrils
        h.blob((0.235, s * 0.25, 0.10), (0.035, 0.062, 0.078), "bone", tilt=(0, 0, s * 0.5))  # eye whites
        h.blob((0.268, s * 0.245, 0.085), (0.018, 0.03, 0.042), "ink", tilt=(0, 0, s * 0.5))   # pupils
        h.sweep([(0.37, s * 0.10, 0.215), (0.29, s * 0.25, 0.205), (0.17, s * 0.37, 0.255)], [0.028, 0.045, 0.02], segs=6, slot="gilt")  # scowl, gilded
        h.blob((-0.10, s * 0.40, 0.12), (0.07, 0.13, 0.085), "body", tilt=(s * 0.5, 0, 0))  # ears
        h.sweep([(-0.02, s * 0.27, 0.27), (0.03, s * 0.50, 0.40), (0.16, s * 0.60, 0.62), (0.30, s * 0.55, 0.78)], [0.115, 0.095, 0.065, 0.02], segs=8, slot="bone")
        h.sweep([(0.245, s * 0.585, 0.725), (0.30, s * 0.55, 0.78), (0.34, s * 0.52, 0.82)], [0.045, 0.024, 0.004], segs=8, slot="gilt")
    _ring(h, (0.56, 0, -0.235), 0.105, 0.02, "gilt", plane="XZ")
    _part(root, h, C, F, loc=(0.92, 0, zc + 0.16))
    for (x, s, nm, slot) in ((0.56, -1, "hoofFL", "livery"), (0.56, 1, "hoofFR", "livery"), (-0.50, -1, "hoofBL", "hoof"), (-0.50, 1, "hoofBR", "hoof")):
        f = Builder(f"grog_{nm}", seed + 4)
        f.lathe([(0.0, 0.0, slot), (0.155, 0.0, slot), (0.18, 0.035, slot), (0.15, 0.21, slot), (0.125, 0.25, "gilt"), (0.0, 0.26, "gilt")], segs=16, wobble=0.02)
        _part(root, f, C, F, loc=(x, s * 0.33, 0.0))
    return root

# ------------------------------------------------------------------ NESTA, the nesting doll
NESTA_SCALE = {"big": 0.893 * 1.25, "mid": 0.893, "small": 0.893 * 0.72}   # data/fighters.json scales 1.25 / 1.0 / 0.72 -> heights 1.88 / 1.50 / 1.08 u
def nesta(livery="mustard", size="mid", seed=21, shell_only=False):
    """A pin, not a blob: narrow waist, small head, a pointed kerchief with a knot and two tails behind.
    (Redone after the first version failed the silhouette gate against Earl: IoU 0.63, limit 0.60.)"""
    root = empty(f"CHR_nesta_{size}")
    C = {"body": "slip", "livery": livery, "ink": "ink", "cheek": "cheek", "bone": "bone", "rose": "rose", "leaf": "celadon_dk", "gilt": "gilt", "trim": livery}
    F = {"gilt": "gilt", "ink": "satin", "cheek": "satin"}
    bands = {"big": 3, "mid": 2, "small": 1}[size]          # base bands = shells left, like tree rings
    K = 0.88                                                 # slimness: radii and face depth scale together
    prof = [(0.0, 0.0, "trim"), (0.29 * K, 0.0, "trim"), (0.37 * K, 0.03, "trim")]
    z = 0.03
    for i in range(bands):
        prof += [((0.385 + 0.012 * i) * K, z + 0.035, "trim"), ((0.40 + 0.012 * i) * K, z + 0.07, "body")]; z += 0.07
    prof += [(0.48 * K, 0.34, "body"), (0.50 * K, 0.58, "body"), (0.455 * K, 0.84, "body"), (0.36 * K, 1.0, "body"), (0.335 * K, 1.035, "gilt"),
             (0.335 * K, 1.06, "livery"), (0.385 * K, 1.18, "livery"), (0.365 * K, 1.36, "livery"), (0.25 * K, 1.53, "livery"), (0.07 * K, 1.64, "livery"), (0.0, 1.68, "livery")]
    b = Builder("nesta_body", seed)
    b.lathe(prof, segs=24, wobble=0.014)
    b.blob((-0.36 * K, 0, 1.17), (0.13, 0.13, 0.10), "livery")                                     # the kerchief knot: her one pulled feature
    for s in (-1, 1):
        b.sweep([(-0.40 * K, s * 0.05, 1.13), (-0.60 * K, s * 0.10, 1.00), (-0.68 * K, s * 0.13, 0.80)], [0.07, 0.06, 0.02], segs=6, slot="livery")
    if not shell_only:
        b.blob((0.30 * K, 0, 1.285), (0.09 * K, 0.225, 0.215), "bone")                             # face
        for s in (-1, 1):
            b.blob((0.388 * K, s * 0.088, 1.32), (0.014, 0.034, 0.052), "ink")
            b.blob((0.37 * K, s * 0.15, 1.232), (0.012, 0.05, 0.04), "cheek")
            b.sweep([(0.365 * K, s * 0.015, 1.495), (0.36 * K, s * 0.105, 1.475), (0.325 * K, s * 0.19, 1.385)], [0.016, 0.02, 0.008], segs=6, slot="ink")  # hair
        b.blob((0.392 * K, 0, 1.2), (0.01, 0.03, 0.016), "rose")                                   # mouth
        b.blob((0.455 * K, 0, 0.60), (0.075 * K, 0.21, 0.27), "bone")                              # apron
        b.blob((0.53 * K, 0, 0.64), (0.012, 0.05, 0.05), "gilt")
        for k in range(5):
            a = 2 * math.pi * k / 5 + 0.3
            b.blob((0.523 * K, 0.09 * math.cos(a), 0.64 + 0.09 * math.sin(a)), (0.012, 0.05, 0.05), "rose")
        for s in (-1, 1):
            b.blob((0.507 * K, s * 0.105, 0.455), (0.012, 0.062, 0.035), "leaf", tilt=(s * 0.7, 0, 0))
    body = _part(root, b, C, F)
    if not shell_only:
        for s, nm in ((-1, "handF"), (1, "handB")):
            h = Builder(f"nesta_{nm}", seed + 3)
            h.blob((0, 0, 0), (0.135, 0.105, 0.125), "livery"); h.blob((0.085, 0, 0.09), (0.055, 0.05, 0.055), "livery")
            _part(root, h, C, F, loc=(0.14, s * 0.66, 0.68))
    root.scale = (NESTA_SCALE[size],) * 3
    return root

# ------------------------------------------------------------------ MOSS, the angler gnome
def moss(livery="verdigris", seed=31, rod=True):
    root = empty("CHR_moss")
    C = {"coat": "terracotta", "belt": "ink", "livery": livery, "ink": "ink", "bone": "bone", "skin": "bisque", "nose": "cheek", "boot": "tenmoku", "gilt": "gilt", "iron": "iron", "float": livery}
    F = {"coat": "bisque", "skin": "satin", "nose": "satin", "boot": "satin", "gilt": "gilt", "iron": "satin", "ink": "satin", "belt": "satin"}
    b = Builder("moss_body", seed)
    b.lathe([(0.0, 0.15, "coat"), (0.29, 0.15, "coat"), (0.375, 0.20, "coat"), (0.40, 0.40, "coat"), (0.375, 0.50, "belt"), (0.365, 0.565, "belt"),
             (0.33, 0.70, "coat"), (0.25, 0.86, "coat"), (0.0, 0.92, "coat")], segs=24, wobble=0.02)
    b.blob((0.0, 0, 0.99), (0.245, 0.25, 0.23), "skin")
    b.blob((0.375, 0, 0.535), (0.02, 0.06, 0.05), "gilt")                                           # buckle
    # beard: a flattened thrown cone, hung from the chin
    b.lathe([(0.0, 0.30, "bone"), (0.10, 0.36, "bone"), (0.215, 0.58, "bone"), (0.255, 0.80, "bone"), (0.235, 0.94, "bone"), (0.15, 1.02, "bone"), (0.0, 1.04, "bone")],
            segs=16, wobble=0.03, origin=(0.21, 0, -0.03), squash=(0.66, 1.08), lobes=5)
    b.blob((0.435, 0, 1.0), (0.115, 0.115, 0.105), "nose")
    for s in (-1, 1):
        b.blob((0.37, s * 0.13, 0.925), (0.085, 0.125, 0.055), "bone", tilt=(s * 0.35, 0, 0))    # moustache
        b.blob((0.265, s * 0.125, 1.085), (0.022, 0.036, 0.05), "ink")
    _part(root, b, C, F)
    hat = Builder("moss_hat", seed + 1)
    def droop(h):
        t = max(0.0, (h - 0.22) / 0.78)
        return (-0.42 * t * t, 0.0)
    hat.lathe([(0.0, -0.03, "livery"), (0.30, -0.03, "livery"), (0.365, 0.0, "livery"), (0.35, 0.045, "livery"), (0.275, 0.14, "livery"), (0.205, 0.36, "livery"),
               (0.13, 0.62, "livery"), (0.06, 0.86, "livery"), (0.03, 0.97, "livery"), (0.0, 1.0, "livery")], segs=22, wobble=0.025, bend=droop)
    hat.blob((-0.435, 0, 1.0), (0.055, 0.055, 0.055), "gilt")                                       # the bell on the tip
    _part(root, hat, C, F, loc=(0.0, 0, 1.07))
    for s, nm in ((-1, "handF"), (1, "handB")):
        h = Builder(f"moss_{nm}", seed + 3)
        h.blob((0, 0, 0), (0.13, 0.10, 0.12), "livery"); h.blob((0.08, 0, 0.085), (0.05, 0.045, 0.05), "livery")
        _part(root, h, C, F, loc=(0.30, s * 0.66, 0.50))
    for s, nm in ((-1, "footF"), (1, "footB")):
        f = Builder(f"moss_{nm}", seed + 5)
        f.blob((0.06, 0, 0.075), (0.19, 0.12, 0.075), "boot")
        _part(root, f, C, F, loc=(0.0, s * 0.19, 0.0))
    if rod:
        r = Builder("moss_rod", seed + 7)
        r.sweep([(0, 0, 0), (0.55, 0, 0.60), (1.05, 0, 1.02), (1.42, 0, 1.18)], [0.028, 0.022, 0.015, 0.008], segs=6, slot="iron")
        r.sweep([(1.42, 0, 1.18), (1.50, 0, 0.80), (1.52, 0, 0.42)], [0.006, 0.006, 0.006], segs=4, slot="ink", cap=False)
        r.blob((1.52, 0, 0.34), (0.06, 0.06, 0.085), "float"); r.blob((1.52, 0, 0.395), (0.05, 0.05, 0.04), "bone")
        _part(root, r, C, F, loc=(0.30, -0.66, 0.50))
    return root

BUILDERS = {"earl": earl, "grog": grog, "nesta": nesta, "moss": moss}
