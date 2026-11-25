import bpy, time, sys, os, math, resource
t0=time.time()
bpy.ops.wm.read_factory_settings(use_empty=True)
import bmesh
# lathe test: profile spun around Z
def lathe(name, profile, segs=24):
    bm=bmesh.new()
    rings=[]
    for (r,z) in profile:
        ring=[bm.verts.new((r*math.cos(2*math.pi*i/segs), r*math.sin(2*math.pi*i/segs), z)) for i in range(segs)]
        rings.append(ring)
    for a,b in zip(rings[:-1],rings[1:]):
        for i in range(segs):
            bm.faces.new((a[i],a[(i+1)%segs],b[(i+1)%segs],b[i]))
    me=bpy.data.meshes.new(name); bm.to_mesh(me); bm.free()
    ob=bpy.data.objects.new(name,me); bpy.context.scene.collection.objects.link(ob)
    for p in me.polygons: p.use_smooth=True
    return ob
scene=bpy.context.scene
ob=lathe('pot',[(0.01,0),(0.5,0),(0.55,0.05),(0.8,0.5),(0.75,0.9),(0.45,1.2),(0.4,1.3),(0.45,1.35),(0.01,1.36)])
mat=bpy.data.materials.new('glaze'); mat.use_nodes=True
b=mat.node_tree.nodes.get('Principled BSDF'); b.inputs['Base Color'].default_value=(0.9,0.88,0.84,1); b.inputs['Roughness'].default_value=0.12
ob.data.materials.append(mat)
bpy.ops.mesh.primitive_plane_add(size=20)
cam=bpy.data.cameras.new('c'); co=bpy.data.objects.new('c',cam); scene.collection.objects.link(co); co.location=(0,-5,1.2); co.rotation_euler=(math.radians(85),0,0); scene.camera=co
ld=bpy.data.lights.new('l','AREA'); ld.energy=600; ld.size=3; lo=bpy.data.objects.new('l',ld); scene.collection.objects.link(lo); lo.location=(-3,-3,4); lo.rotation_euler=(math.radians(45),0,math.radians(-40))
w=bpy.data.worlds.new('w'); scene.world=w; w.use_nodes=True; w.node_tree.nodes['Background'].inputs[0].default_value=(0.8,0.85,0.83,1)
scene.render.resolution_x=640; scene.render.resolution_y=360
print('setup',round(time.time()-t0,2))
for eng,samples in (('CYCLES',16),('CYCLES',64)):
    scene.render.engine=eng; scene.cycles.samples=samples; scene.cycles.device='CPU'; scene.cycles.use_denoising=True
    scene.render.filepath=f'./smoke_{eng}_{samples}.png'
    t=time.time()
    try:
        bpy.ops.render.render(write_still=True); print(eng,samples,'ok',round(time.time()-t,2),'s')
    except Exception as e: print(eng,samples,'FAIL',e)
for eng in ('BLENDER_WORKBENCH','BLENDER_EEVEE','BLENDER_EEVEE_NEXT'):
    try:
        scene.render.engine=eng
        scene.render.filepath=f'./smoke_{eng}.png'
        t=time.time(); bpy.ops.render.render(write_still=True); print(eng,'ok',round(time.time()-t,2),'s')
    except Exception as e: print(eng,'FAIL',str(e)[:200])
t=time.time()
bpy.ops.export_scene.gltf(filepath='./smoke.glb', export_format='GLB')
print('gltf ok',round(time.time()-t,2),'s', os.path.getsize('./smoke.glb'),'bytes')
print('maxrss MB', resource.getrusage(resource.RUSAGE_SELF).ru_maxrss/1024)
print('total',round(time.time()-t0,2))
