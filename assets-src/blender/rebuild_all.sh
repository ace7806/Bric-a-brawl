#!/bin/sh
# rebuild_all.sh - regenerate every reference render and export, one Blender process at a time (about 6 minutes on 2 vCPUs).
set -e
cd "$(dirname "$0")"
[ -f out/matcap_packed.png ] || python3 bake_matcap.py
python3 render_sheets.py                      # character, livery, pose, gadget and prop tiles -> out/sheets/
python3 style_frame.py 1600 900               # the in-game style frame
python3 key_art.py 1600 840                   # key art render
python3 arena_views.py                        # three arena concept views
python3 lobby_view.py                         # the lobby
python3 export_gltf.py                        # four fighters -> out/*.glb + sidecar json
python3 measure.py                            # triangle counts -> out/tri_counts.json
