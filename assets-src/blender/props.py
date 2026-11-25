"""props.py - gadgets and small props (reference versions, enough to set the bar)."""
import math
from ceramic import Builder, empty

def side_plate(parent, livery="tangerine", r=0.62):
    b = Builder("PROP_guard_plate", 3)
    b.lathe([(0.0, 0.0, "l"), (r * 0.5, 0.0, "l"), (r * 0.62, 0.03, "l"), (r * 0.95, 0.10, "l"), (r, 0.115, "g"), (r * 0.97, 0.13, "g"), (r * 0.6, 0.06, "w"), (0.0, 0.05, "w")], segs=22, sub=2, wobble=0.012)
    return b.finish(parent=parent, colours={"l": livery, "g": "gilt", "w": "bone"}, finishes={"g": "gilt"})

def bellows(parent):
    """Seen side-on it must read as a sideways V with a nozzle: two boards hinged at the nozzle, leather between, two handles."""
    b = Builder("GAD_bellows", 4)
    for s in (-1, 1):
        b.blob((-0.02, 0, s * 0.105), (0.36, 0.25, 0.032), "wood", segs=12, rings=4, tilt=(0, s * 0.30, 0))
        b.sweep([(-0.30, 0, s * 0.19), (-0.50, 0, s * 0.27), (-0.66, 0, s * 0.30)], [0.045, 0.038, 0.045], segs=6, slot="wood")
    for i, x in enumerate((-0.24, -0.12, 0.0, 0.12)):
        h = 0.185 - 0.045 * i
        b.blob((x, 0, 0), (0.075, 0.215 - 0.02 * i, h), "leather", segs=8, rings=4)
    b.sweep([(0.26, 0, 0), (0.50, 0, 0), (0.66, 0, 0), (0.70, 0, 0)], [0.07, 0.04, 0.035, 0.05], segs=8, slot="brass")
    ob = b.finish(parent=parent, colours={"wood": "terracotta", "leather": "oxblood", "brass": "gilt"}, finishes={"wood": "satin", "leather": "satin", "brass": "gilt"})
    return ob

def parcel(parent):
    root = empty("PROP_parcel", parent)
    b = Builder("PROP_parcel_box", 8)
    b.lathe([(0.0, 0.0, "paper"), (0.40, 0.0, "paper"), (0.42, 0.03, "paper"), (0.42, 0.50, "paper"), (0.40, 0.53, "paper"), (0.0, 0.53, "paper")], segs=4, sub=1, wobble=0.0)
    b.sweep([(-0.31, 0, 0.56), (0.31, 0, 0.56)], 0.022, segs=5, sub=1, slot="string"); b.sweep([(0, -0.31, 0.56), (0, 0.31, 0.56)], 0.022, segs=5, sub=1, slot="string")
    box = b.finish(parent=root, colours={"paper": "bisque", "string": "stamp"}, finishes={"paper": "bisque", "string": "satin"}); box.rotation_euler = (0, 0, math.radians(45))
    d = Builder("PROP_doily", 9)
    prof = [(0.0, 1.95, "lace"), (0.5, 1.90, "lace"), (0.95, 1.72, "lace"), (1.22, 1.45, "lace"), (1.30, 1.30, "lace")]
    d.lathe(prof, segs=20, sub=2, wobble=0.05, lobes=10)
    for i in range(8):
        a = 2 * math.pi * i / 8
        d.sweep([(1.26 * math.cos(a), 1.26 * math.sin(a), 1.32), (0.25 * math.cos(a), 0.25 * math.sin(a), 0.56)], 0.008, segs=4, sub=1, slot="string", cap=False)
    d.finish(parent=root, colours={"lace": "bone", "string": "ink"}, finishes={"lace": "satin"})
    return root

def spoon(parent, livery="rose"):
    b = Builder("PROP_ghost_spoon", 10)
    b.blob((0, 0, 0), (0.20, 0.06, 0.28), "s", segs=12, rings=6)
    b.sweep([(0, 0, 0.24), (0.02, 0, 0.7), (0, 0, 1.15), (0, 0, 1.25)], [0.045, 0.03, 0.035, 0.06], segs=6, slot="s")
    b.blob((0, 0, 1.3), (0.07, 0.05, 0.07), "l", segs=8, rings=4)
    return b.finish(parent=parent, colours={"s": "ash", "l": livery}, finishes={"s": "gilt"})

# ------------------------------------------------------------------ the nine gadgets (reference models)
# Household junk at ornament scale. Thrown or pulled forms only. Gadgets may use saturated colour.
def _fin(b, parent, colours, finishes=None, rot=(0, 0, 0)):
    ob = b.finish(parent=parent, colours=colours, finishes=finishes or {}); ob.rotation_euler = rot
    return ob

def plunger(parent):
    b = Builder("GAD_plunger", 21)
    b.lathe([(0.30, 0.0, "cup"), (0.31, 0.03, "cup"), (0.24, 0.16, "cup"), (0.12, 0.25, "cup"), (0.07, 0.29, "cup"), (0.0, 0.30, "cup")], segs=16, sub=2, wobble=0.02)
    b.sweep([(0, 0, 0.28), (0, 0, 0.95)], [0.035, 0.03], segs=6, sub=1, slot="wood")
    b.sweep([(0, 0, 0.95), (0.25, 0, 1.15), (0.1, 0, 1.4), (-0.25, 0, 1.3), (-0.1, 0, 1.6)], 0.012, segs=4, slot="string", cap=False)
    return _fin(b, parent, {"cup": "oxblood", "wood": "bisque", "string": "ink"}, {"cup": "satin", "wood": "bisque"}, (0, math.radians(-70), 0))

def cork_bottle(parent):
    b = Builder("GAD_vintage", 22)
    b.lathe([(0.0, 0.0, "glass"), (0.20, 0.0, "glass"), (0.215, 0.04, "glass"), (0.215, 0.26, "label"), (0.215, 0.50, "glass"), (0.17, 0.66, "glass"), (0.08, 0.86, "foil"), (0.07, 1.0, "foil"), (0.085, 1.03, "foil"),
             (0.07, 1.05, "cork"), (0.095, 1.12, "cork"), (0.09, 1.18, "cork"), (0.0, 1.20, "cork")], segs=16, sub=2, wobble=0.012)
    return _fin(b, parent, {"glass": "verdigris", "label": "bone", "foil": "gilt", "cork": "bisque"}, {"foil": "gilt", "cork": "bisque"}, (0, math.radians(55), 0))

def pepper_mill(parent):
    b = Builder("GAD_pepper", 23)
    b.lathe([(0.0, 0.0, "wood"), (0.17, 0.0, "wood"), (0.19, 0.04, "wood"), (0.12, 0.22, "wood"), (0.10, 0.34, "wood"), (0.16, 0.50, "wood"), (0.17, 0.60, "wood"), (0.10, 0.66, "steel"),
             (0.16, 0.72, "wood"), (0.18, 0.84, "wood"), (0.12, 0.94, "wood"), (0.05, 0.97, "steel"), (0.07, 1.03, "steel"), (0.0, 1.05, "steel")], segs=14, sub=2, wobble=0.015)
    return _fin(b, parent, {"wood": "tenmoku", "steel": "ash"}, {"wood": "satin", "steel": "gilt"}, (0, math.radians(18), 0))

def toaster(parent):
    b = Builder("GAD_toaster", 24)
    b.lathe([(0.0, 0.0, "foot"), (0.40, 0.0, "foot"), (0.42, 0.04, "body"), (0.44, 0.30, "body"), (0.42, 0.50, "body"), (0.36, 0.56, "body"), (0.0, 0.57, "body")], segs=4, sub=2, wobble=0.0, squash=(1.0, 0.62))
    for x in (-0.12, 0.12):
        b.sweep([(x - 0.0, -0.17, 0.575), (x, 0.17, 0.575)], 0.035, segs=6, sub=1, slot="slot")
    b.blob((0.0, 0.0, 0.66), (0.2, 0.04, 0.17), "toast", segs=8, rings=4)
    b.sweep([(0.43, 0, 0.36), (0.50, 0, 0.36)], 0.03, segs=6, sub=1, slot="foot"); b.blob((0.52, 0, 0.36), (0.035, 0.05, 0.05), "foot", segs=8, rings=4)
    return _fin(b, parent, {"body": "ash", "foot": "ink", "slot": "ink", "toast": "mustard"}, {"body": "gilt", "foot": "satin", "toast": "bisque"}, (0, 0, math.radians(45)))

def jam_jar(parent):
    b = Builder("GAD_jam", 25)
    b.lathe([(0.0, 0.0, "jam"), (0.22, 0.0, "jam"), (0.25, 0.04, "jam"), (0.26, 0.30, "label"), (0.25, 0.42, "jam"), (0.20, 0.50, "jam"), (0.21, 0.52, "lid"), (0.235, 0.54, "lid"), (0.235, 0.60, "lid"), (0.20, 0.63, "lid"), (0.0, 0.64, "lid")], segs=16, sub=2, wobble=0.015)
    return _fin(b, parent, {"jam": "oxblood", "label": "bone", "lid": "mustard"}, {"lid": "satin"}, (0, math.radians(12), 0))

def egg_timer(parent):
    b = Builder("GAD_timer", 26)
    b.lathe([(0.0, 0.0, "base"), (0.20, 0.0, "base"), (0.22, 0.03, "base"), (0.25, 0.12, "egg"), (0.30, 0.30, "egg"), (0.27, 0.50, "egg"), (0.17, 0.66, "egg"), (0.0, 0.72, "egg")], segs=16, sub=2, wobble=0.015)
    b.lathe([(0.27, 0.235, "dial"), (0.305, 0.25, "dial"), (0.305, 0.28, "dial"), (0.27, 0.295, "dial")], segs=16, sub=1, wobble=0.0)
    b.sweep([(0.29, -0.02, 0.33), (0.31, -0.02, 0.44)], 0.018, segs=5, sub=1, slot="base")
    return _fin(b, parent, {"egg": "bone", "base": "ink", "dial": "tangerine"}, {"base": "satin", "dial": "satin"}, (0, math.radians(8), math.radians(-30)))

def hoover(parent):
    b = Builder("GAD_hoover", 27)
    b.lathe([(0.0, -0.36, "body"), (0.17, -0.35, "body"), (0.24, -0.22, "body"), (0.26, 0.0, "body"), (0.26, 0.05, "trim"), (0.24, 0.09, "trim"), (0.20, 0.25, "body"), (0.11, 0.42, "body"), (0.09, 0.50, "trim")], segs=14, sub=2, wobble=0.015, axis="X")
    b.sweep([(0.50, 0, 0.0), (0.70, 0, -0.04), (0.82, 0, -0.16)], [0.085, 0.085, 0.13], segs=10, slot="trim")
    b.sweep([(-0.12, 0, 0.24), (-0.05, 0, 0.42), (0.18, 0, 0.42), (0.25, 0, 0.20)], 0.035, segs=6, slot="trim")
    b.blob((-0.42, 0, 0.0), (0.2, 0.22, 0.22), "bag", segs=10, rings=5)
    return _fin(b, parent, {"body": "celadon", "trim": "ink", "bag": "bisque"}, {"trim": "satin", "bag": "bisque"}, (0, math.radians(-12), 0))

def magnet(parent):
    b = Builder("GAD_magnet", 28)
    arc = [(0.26 * math.cos(a), 0, 0.26 * math.sin(a) + 0.32) for a in [math.pi * i / 8 for i in range(9)]]
    b.sweep([(0.26, 0, 0.14)] + arc + [(-0.26, 0, 0.14)], 0.075, segs=8, sub=1, slot="red")
    for x in (0.26, -0.26):
        b.sweep([(x, 0, 0.14), (x, 0, 0.0)], 0.078, segs=8, sub=1, slot="steel")
    return _fin(b, parent, {"red": "oxblood", "steel": "ash"}, {"steel": "gilt"}, (0, math.radians(20), 0))

GADGETS = [("bellows", bellows), ("plunger", plunger), ("cork", cork_bottle), ("pepper", pepper_mill), ("toaster", toaster), ("jam", jam_jar), ("timer", egg_timer), ("hoover", hoover), ("magnet", magnet)]
