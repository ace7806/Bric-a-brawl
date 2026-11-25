# Proof-of-concept measurements

Run on 25 November 2026 on a 2-vCPU, 7 GB, CPU-only Linux box (Python 3.13, Node 22.23, Chrome for Testing 153).
This is the same class of machine as the build VM. Re-run these on the VM in M1 and replace the numbers.

`npm install` here first. These scripts measure things; they are not a starting point for the game.

## 1. Rapier 2D headless in Node: `node rapier_bench.mjs [package]`

74 bodies: 24 terrain chunks, 6 falling chunks, 16 rubble, 8 gadgets, 12 projectiles, 8 kinematic fighters moved through the character controller. 7,200 ticks is one 2-minute match.

| Build | Total | Mean tick | p50 | p99 | Same result twice | Snapshot | Take | Restore |
|---|---|---|---|---|---|---|---|---|
| `@dimforge/rapier2d-compat` 0.21.0 | 4.67 s | 0.648 ms | 0.561 ms | 2.39 ms | yes | 94,736 B | 0.074 ms | 0.298 ms |
| `@dimforge/rapier2d-deterministic-compat` 0.21.0 | 5.13 s | 0.712 ms | 0.626 ms | 2.18 ms | yes | 94,736 B | 0.092 ms | 0.186 ms |

Estimated cost of one rollback frame (restore, re-simulate 7 ticks, save): 4.9 to 5.3 ms of physics alone.
Peak memory of the Node process: 401 MB.

## 2. Snapshot and input sizes with real msgpackr: `node snapshot_size.mjs`

| Message | Bytes |
|---|---|
| Fighters-only snapshot (8 fighters, 4 projectiles) | 239 |
| Typical snapshot with world (plus 2 chunks, 6 rubble, 3 gadgets) | 379 |
| Worst-case fighters-only (12 projectiles) | 338 |
| Worst-case with world (6 chunks, 16 rubble, 8 gadgets, 12 projectiles) | 716 |
| Input packet (tick and four 16-bit masks) | 16 |

Encode worst case: 5.0 µs. Decode: 2.9 µs.
With 85 B of assumed per-packet overhead: client down 11.8 kB/s typical, 18.4 worst; client up 6.1 kB/s; host up 82.8 kB/s typical, 128.5 worst.

## 3. Bundle sizes: `cd bundle && npx vite build`

Vite 8.3.8, production build in 0.4 to 0.9 s, 321 MB peak.

| Chunk | Raw | Gzip |
|---|---|---|
| rapier2d-deterministic-compat | 3,446,039 | 1,300,070 |
| three (tree-shaken) | 650,530 | 160,232 |
| trystero (nostr) | 149,715 | 52,787 |
| msgpackr | 31,720 | 11,470 |
| snapshot-interpolation | 5,518 | 2,248 |

Separate wasm (non-compat build): 2,436,321 raw, 919,151 gzip.

## 4. Headless Chrome, software WebGL: serve this folder's parent and run `node glsmoke/run.mjs`

44,208 triangles, 29 draw calls, matcap material. Renderer string: ANGLE over llvmpipe.

| Canvas | Mean frame | p95 |
|---|---|---|
| 960x540 | 12.0 ms | 15.5 ms |
| 640x360 | 8.6 ms | 10.8 ms |
| 480x270 | 7.1 ms | 9.0 ms |
| 320x180 | 6.3 ms | 8.8 ms |

## 5. Headless Blender (`pip install bpy`, 5.3.0): `python3 blender_smoke.py`, and the scripts in `../blender`

| Job | Time | Peak memory |
|---|---|---|
| Cycles 640x360, 16 samples | 4.9 s | |
| Cycles 640x360, 64 samples | 11.7 s | |
| Workbench 640x360 (via Mesa software GL; Vulkan failed, EGL logged errors, image was correct) | 1.3 s | |
| EEVEE | hung; killed | |
| Packed matcap bake (3 renders at 256x256, 96 samples) | 16 s | |
| Fighter build and glTF export | 0.7 s | 294 MB |
| One 640x640 engine-look tile | about 5 s | |
| Style frame 960x540, 46k triangles | 17 s | 901 MB |
| Style frame 1600x900 | 41 to 46 s | |
| All sheet tiles (33) | 155 s | |

Fighter glTF sizes: 561 to 695 KB as exported; 79 to 96 KB after `gltf-transform optimize --compress meshopt --simplify false`; 49 to 58 KB gzip. Triangle counts unchanged.
Blender's own `export_meshopt_compression_enable` flag did not produce a compressed file in this build.

## 6. Disk

`bpy` 919 MB · Node 294 MB · Chrome for Testing 863 MB · Mesa and LLVM 255 MB · this research `node_modules` 243 MB.

## 7. Library versions checked on the registries

trystero 0.27.0 (11 Nov 2026) · @dimforge/rapier2d 0.21.0 (25 Sep 2026) · three 0.187.0 (30 Oct 2026) · msgpackr 2.1.4 (2 Nov 2026) · @geckos.io/snapshot-interpolation 1.1.1 (22 Feb 2025) · netplayjs 0.4.1 (2 Apr 2023) · rollback-netcode 0.0.6 (5 Feb 2026) · peerjs 1.5.5 (7 Jun 2025) · vite 8.3.8 · typescript 7.0.2 · vitest 5.1.1 · playwright 1.65.1 · @gltf-transform/cli 4.5.1 · bpy 5.3.0.
