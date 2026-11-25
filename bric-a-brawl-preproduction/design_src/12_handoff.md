# 12. Handoff package

One folder. Start with `00_READ_THIS_FIRST.md`.

```
bric-a-brawl-preproduction/
  00_READ_THIS_FIRST.md        one page: vision, pillars, constraints, libraries, first milestone, rules
  MASTER_DESIGN.md             this document: chapters 1 to 12 (generated from design_src/)
  ART_BIBLE.md                 chapter 4 in full
  LICENSES.md                  what in this package came from where
  data/                        the numbers, machine-readable. Load these; do not retype tables
    tuning.json  fighters.json  gadgets.json  arenas.json  palette.json
  concept_art/
    index.html                 every image on one page
    CRITIQUE.md                chapter 5: verdicts, what was redone, what is still below the bar
    png/                       26 images
    src/                       the mock-ups as real HTML and CSS (base.css is the UI style), fonts, source renders
  reference/
    blender/                   the reference asset scripts: shared library, matcap bake, four fighters,
                               nine gadgets, arenas from data, style frame, key art, glTF export
      out/                     the packed matcap, four exported fighters (.glb), measurements
    poc/                       measurement scripts and RESULTS.md
  tools/
    design_data.py             the single source for every number; writes data/ and the tables
    build_master.py            assembles MASTER_DESIGN.md
  design_src/                  the chapters as separate files, and the generated tables
```

**How the pieces stay consistent.** `tools/design_data.py` is the only place numbers are typed. It writes `data/*.json` and the tables embedded in chapter 3, and it computes the on-block frames and KO percentages from the launch model, so the tables cannot disagree with the formulas. The arena maps, palette sheet, character sheets and gadget sheet are generated from the same JSON. The arena meshes are generated from `data/arenas.json`. To change a number: edit `design_data.py`, run it, run `build_master.py`.

**What to do with the reference scripts.** They run as they are on the VM (`reference/blender/rebuild_all.sh`, about six minutes). Copy them into the game repository as the first version of `assets-src/blender/`. They are the quality floor for M4.

**What is not in the package:** game code; pose data; hitbox data; audio; the word lists; the second and third arenas' final dressing; any proof that the network plan works between two homes. Those are M1 to M5.
