/* VIBE HEROES view: turns simulation state into a 3D scene (three.js r128). Reads only data, never changes game rules. */
(function(root){
'use strict';
var TEAM_COL={A:'#4aa8ff',B:'#ff3a4a'};   // you are always BLUE, enemies are always RED
function hexC(h){ return new THREE.Color(h); }
/* ---------- voxel geometry from box data (one merged mesh per body part) ---------- */
var FACES=[ // normal, 4 corners as [x,y,z] picks from (0=min,1=max)
  [[1,0,0],[[1,0,1],[1,0,0],[1,1,0],[1,1,1]]],[[-1,0,0],[[0,0,0],[0,0,1],[0,1,1],[0,1,0]]],
  [[0,1,0],[[0,1,1],[1,1,1],[1,1,0],[0,1,0]]],[[0,-1,0],[[0,0,0],[1,0,0],[1,0,1],[0,0,1]]],
  [[0,0,1],[[0,0,1],[1,0,1],[1,1,1],[0,1,1]]],[[0,0,-1],[[1,0,0],[0,0,0],[0,1,0],[1,1,0]]]];
function buildBoxes(list,toLocal,shadeTop){
  var pos=[],nor=[],col=[],idx=[],epos=[], c=new THREE.Color();
  list.forEach(function(b){ var a=toLocal(b), mn=a[0], mx=a[1]; c.set(b[6]);
    FACES.forEach(function(f){ var base=pos.length/3, k=f[0][1]>0?1.08:f[0][1]<0?0.7:(f[0][0]!==0?0.86:1);
      f[1].forEach(function(q){ pos.push(q[0]?mx[0]:mn[0],q[1]?mx[1]:mn[1],q[2]?mx[2]:mn[2]); nor.push(f[0][0],f[0][1],f[0][2]); col.push(Math.min(1,c.r*k),Math.min(1,c.g*k),Math.min(1,c.b*k)); });
      idx.push(base,base+1,base+2,base,base+2,base+3); });
    var X=[mn[0],mx[0]],Y=[mn[1],mx[1]],Z=[mn[2],mx[2]];
    [[0,0,0,1,0,0],[0,1,0,1,1,0],[0,0,1,1,0,1],[0,1,1,1,1,1],[0,0,0,0,1,0],[1,0,0,1,1,0],[0,0,1,0,1,1],[1,0,1,1,1,1],[0,0,0,0,0,1],[1,0,0,1,0,1],[0,1,0,0,1,1],[1,1,0,1,1,1]].forEach(function(e){ epos.push(X[e[0]],Y[e[1]],Z[e[2]],X[e[3]],Y[e[4]],Z[e[5]]); }); });
  var g=new THREE.BufferGeometry(); g.setAttribute('position',new THREE.Float32BufferAttribute(pos,3)); g.setAttribute('normal',new THREE.Float32BufferAttribute(nor,3)); g.setAttribute('color',new THREE.Float32BufferAttribute(col,3)); g.setIndex(idx);
  var eg=new THREE.BufferGeometry(); eg.setAttribute('position',new THREE.Float32BufferAttribute(epos,3));
  return {geo:g,edges:eg};
}
var VOX_MAT=null, VOX_GLOW={}, EDGE_MAT=null;
function voxMat(){ if(!VOX_MAT) VOX_MAT=new THREE.MeshStandardMaterial({vertexColors:true,roughness:0.62,metalness:0.05}); return VOX_MAT; }
function edgeMat(){ if(!EDGE_MAT) EDGE_MAT=new THREE.LineBasicMaterial({color:0x121014,transparent:true,opacity:0.85}); return EDGE_MAT; }
function partMesh(list,unit,pivot,cx,cz){
  var normal=list.filter(function(b){ return b[7]!=='g'; }), glow=list.filter(function(b){ return b[7]==='g'; }), grp=new THREE.Group();
  function toLocal(b){ var x0=-(b[0]+b[3]-cx)*unit, x1=-(b[0]-cx)*unit; return [[x0-pivot[0],b[1]*unit-pivot[1],(b[2]-cz)*unit-pivot[2]],[x1-pivot[0],(b[1]+b[4])*unit-pivot[1],(b[2]+b[5]-cz)*unit-pivot[2]]]; }
  if(normal.length){ var r=buildBoxes(normal,toLocal); var m=new THREE.Mesh(r.geo,voxMat()); m.castShadow=true; m.receiveShadow=true; grp.add(m); grp.add(new THREE.LineSegments(r.edges,edgeMat())); }
  glow.forEach(function(b){ var k=b[6]; if(!VOX_GLOW[k]) VOX_GLOW[k]=new THREE.MeshStandardMaterial({color:k,emissive:k,emissiveIntensity:1.6,roughness:0.4}); var a=toLocal(b), g=new THREE.BoxGeometry(a[1][0]-a[0][0],a[1][1]-a[0][1],a[1][2]-a[0][2]), mm=new THREE.Mesh(g,VOX_GLOW[k]); mm.position.set((a[0][0]+a[1][0])/2,(a[0][1]+a[1][1])/2,(a[0][2]+a[1][2])/2); grp.add(mm); });
  return grp;
}
function bounds(list){ var b={x0:1e9,x1:-1e9,y0:1e9,y1:-1e9,z0:1e9,z1:-1e9}; list.forEach(function(q){ b.x0=Math.min(b.x0,q[0]); b.x1=Math.max(b.x1,q[0]+q[3]); b.y0=Math.min(b.y0,q[1]); b.y1=Math.max(b.y1,q[1]+q[4]); b.z0=Math.min(b.z0,q[2]); b.z1=Math.max(b.z1,q[2]+q[5]); }); return b; }
/* character rig: legs split left/right, arms swing at the shoulder, head+hat turn together */
function buildCharacter(ch){
  var u=ch.model.unit, P=ch.model.parts, cx=6, cz=5, root=new THREE.Group(), rig={};
  var legs=P.legs||[], legL=legs.filter(function(b){ return b[0]+b[3]/2<6; }), legR=legs.filter(function(b){ return b[0]+b[3]/2>=6; });
  function add(name,list,pv){ if(!list||!list.length) return; var g=partMesh(list,u,pv,cx,cz), holder=new THREE.Group(); holder.position.set(pv[0],pv[1],pv[2]); holder.add(g); root.add(holder); rig[name]=holder; }
  function pivotOf(list,top){ var b=bounds(list); return [-((b.x0+b.x1)/2-cx)*u, (top?b.y1:b.y0)*u, ((b.z0+b.z1)/2-cz)*u]; }
  if(legL.length) add('legL',legL,pivotOf(legL,true)); if(legR.length) add('legR',legR,pivotOf(legR,true));
  if(P.body) add('body',P.body,[0,0,0]);
  if(P.armL) add('armL',P.armL,pivotOf(P.armL,true)); if(P.armR) add('armR',P.armR,pivotOf(P.armR,true));
  var head=(P.head||[]).concat(P.hat||[]); if(head.length){ var hb=bounds(P.head||head); add('head',head,[0,hb.y0*u,0]); }
  var top=bounds([].concat.apply([],Object.keys(P).map(function(k){ return P[k]; }))); rig.height=top.y1*u;
  return {root:root,rig:rig};
}
function buildMini(ch){ var d=ch.deathForm, b=bounds(d.boxes), g=partMesh(d.boxes,d.unit,[0,0,0],(b.x0+b.x1)/2,(b.z0+b.z1)/2); var r=new THREE.Group(); r.add(g); return r; }
function buildGun(models,id,scale){ var list=(models[id]||[]).map(function(b){ return b; }), g=new THREE.Group();
  list.forEach(function(b){ var m=b[7]==='g'?new THREE.MeshStandardMaterial({color:b[6],emissive:b[6],emissiveIntensity:1.5}):new THREE.MeshStandardMaterial({color:b[6],roughness:0.45,metalness:0.4});
    var mesh=new THREE.Mesh(new THREE.BoxGeometry(b[3],b[4],b[5]),m); mesh.position.set(b[0]+b[3]/2,b[1]+b[4]/2,b[2]+b[5]/2); mesh.castShadow=true; g.add(mesh); });
  g.scale.setScalar(scale||1); return g; }
function canvasTex(w,h,draw){ var c=document.createElement('canvas'); c.width=w; c.height=h; var g=c.getContext('2d'); draw(g,w,h); var t=new THREE.CanvasTexture(c); t.anisotropy=4; return t; }
function glowTex(col){ return canvasTex(64,64,function(g){ var r=g.createRadialGradient(32,32,0,32,32,32); r.addColorStop(0,'#ffffff'); r.addColorStop(0.3,col); r.addColorStop(1,'rgba(0,0,0,0)'); g.fillStyle=r; g.fillRect(0,0,64,64); }); }

function View(canvas,data,settings){
  var V=this; V.marked={}; V.losT={}; V.losCheck={}; V.dmgNums=[]; V.data=data; V.settings=settings; V.quality=settings.quality||'high';
  var R=V.renderer=new THREE.WebGLRenderer({canvas:canvas,antialias:V.quality==='high',powerPreference:'high-performance'});
  R.setPixelRatio(Math.min(window.devicePixelRatio||1,V.quality==='high'?2:1.25)); R.toneMapping=THREE.ACESFilmicToneMapping; R.toneMappingExposure=1.15;
  R.shadowMap.enabled=true; R.shadowMap.type=V.quality==='high'?THREE.PCFSoftShadowMap:THREE.PCFShadowMap;
  V.scene=new THREE.Scene(); V.camera=new THREE.PerspectiveCamera(settings.fov||80,1,0.05,600); V.scene.add(V.camera);
  V.players={}; V.fx=[]; V.decals=[]; V.tex={spark:glowTex('#ffd27a'),flash:glowTex('#ffcf6a')};
  V.resize(); window.addEventListener('resize',function(){ V.resize(); });
}
var VP=View.prototype;
VP.resize=function(){ var w=innerWidth,h=innerHeight; this.renderer.setSize(w,h,false); this.camera.aspect=w/h; this.camera.updateProjectionMatrix(); if(this.composer) this.composer.setSize(w,h); };
VP.loadMap=function(map){
  var V=this, S=V.scene; V.map=map;
  while(S.children.length>1) S.remove(S.children[S.children.length-1]); // keep the camera
  S.background=hexC(map.fog.color); S.fog=new THREE.Fog(map.fog.color,map.fog.near,map.fog.far);
  // sky dome with a vertical gradient
  var sky=new THREE.Mesh(new THREE.SphereGeometry(400,32,16),new THREE.MeshBasicMaterial({side:THREE.BackSide,fog:false,map:canvasTex(8,256,function(g,w,h){ var gr=g.createLinearGradient(0,0,0,h); gr.addColorStop(0,map.sky.top); gr.addColorStop(0.48,map.sky.horizon); gr.addColorStop(0.55,map.sky.bottom); gr.addColorStop(1,map.sky.bottom); g.fillStyle=gr; g.fillRect(0,0,w,h); })}));
  S.add(sky);
  var hemi=new THREE.HemisphereLight(map.ambient.sky,map.ambient.ground,map.ambient.intensity); S.add(hemi);
  var sun=new THREE.DirectionalLight(map.sun.color,map.sun.intensity), d=map.sun.dir; sun.position.set(-d[0]*60,-d[1]*60,-d[2]*60); sun.castShadow=true;
  var sz=Math.max(map.size[0],map.size[1])/2+4; var sc=sun.shadow.camera; sc.left=-sz; sc.right=sz; sc.top=sz; sc.bottom=-sz; sc.near=1; sc.far=200; sun.shadow.mapSize.set(V.quality==='high'?2048:1024,V.quality==='high'?2048:1024); sun.shadow.bias=-0.0006; S.add(sun); S.add(sun.target);
  // floor: tinted team halves and a neon grid
  var W=map.size[0], D=map.size[1];
  var floorTex=canvasTex(1024,Math.round(1024*D/W),function(g,w,h){ g.fillStyle=map.floor.color; g.fillRect(0,0,w,h);
    var a=g.createLinearGradient(0,0,w,0); a.addColorStop(0,map.floor.teamTint[0]); a.addColorStop(0.32,'rgba(0,0,0,0)'); a.addColorStop(0.68,'rgba(0,0,0,0)'); a.addColorStop(1,map.floor.teamTint[1]); g.fillStyle=a; g.globalAlpha=0.8; g.fillRect(0,0,w,h); g.globalAlpha=1;
    var step=w/W*2; g.strokeStyle=map.floor.grid; g.globalAlpha=0.18; g.lineWidth=1.5; for(var x=0;x<=w;x+=step){ g.beginPath(); g.moveTo(x,0); g.lineTo(x,h); g.stroke(); } for(var y=0;y<=h;y+=step){ g.beginPath(); g.moveTo(0,y); g.lineTo(w,y); g.stroke(); }
    g.globalAlpha=0.5; g.lineWidth=4; g.strokeStyle='#ffffff'; g.beginPath(); g.arc(w/2,h/2,w*0.06,0,6.28); g.stroke(); g.globalAlpha=1; });
  var floor=new THREE.Mesh(new THREE.PlaneGeometry(W,D),new THREE.MeshStandardMaterial({map:floorTex,roughness:0.42,metalness:0.15})); floor.rotation.x=-Math.PI/2; floor.receiveShadow=true; S.add(floor);
  var outside=new THREE.Mesh(new THREE.PlaneGeometry(600,600),new THREE.MeshStandardMaterial({color:map.fog.color,roughness:1})); outside.rotation.x=-Math.PI/2; outside.position.y=-0.02; S.add(outside);
  // level boxes: colored blocks with dark edges, neon strips on top of walls and blocks
  var neonCols=[TEAM_COL.A,TEAM_COL.B,'#cdff65','#ffb347'];
  var H=map.theme==='halloween', faceM=new THREE.MeshStandardMaterial({color:'#ffd060',emissive:'#ffb020',emissiveIntensity:2.2}), winM=new THREE.MeshStandardMaterial({color:'#ffb050',emissive:'#ff9a30',emissiveIntensity:1.8});
  map.boxes.forEach(function(b,i){ var w=b.max[0]-b.min[0], h=b.max[1]-b.min[1], dd=b.max[2]-b.min[2], cx=(b.min[0]+b.max[0])/2, cz=(b.min[2]+b.max[2])/2;
    if(V.themedPiece(b,w,h,dd,cx,cz,faceM,winM)) return;
    var m=new THREE.Mesh(new THREE.BoxGeometry(w,h,dd),new THREE.MeshStandardMaterial({color:b.color,roughness:b.kind==='crate'?0.7:0.5,metalness:b.kind==='edge'?0.3:0.1}));
    m.position.set((b.min[0]+b.max[0])/2,(b.min[1]+b.max[1])/2,(b.min[2]+b.max[2])/2); m.castShadow=b.kind!=='edge'; m.receiveShadow=true; S.add(m);
    var e=new THREE.LineSegments(new THREE.EdgesGeometry(m.geometry),new THREE.LineBasicMaterial({color:0x0c0a14,transparent:true,opacity:0.6})); e.position.copy(m.position); S.add(e);
    if(b.kind==='block'||b.kind==='wall'||b.kind==='edge'){ var nc=b.kind==='edge'?(b.min[0]<0?TEAM_COL.A:TEAM_COL.B):neonCols[i%neonCols.length];
      var strip=new THREE.Mesh(new THREE.BoxGeometry(w+0.04,0.08,dd+0.04),new THREE.MeshStandardMaterial({color:nc,emissive:nc,emissiveIntensity:2})); strip.position.set(m.position.x,b.max[1]-0.12,m.position.z); S.add(strip); }
    if(b.kind==='crate'){ var band=new THREE.Mesh(new THREE.BoxGeometry(w+0.02,0.12,dd+0.02),new THREE.MeshStandardMaterial({color:0x2a2030,roughness:0.5})); band.position.set(m.position.x,b.max[1]*0.5,m.position.z); S.add(band); } });
  // spawn rings
  ['A','B'].forEach(function(t){ var sp=map.spawns[t], cx=0,cz=0; sp.forEach(function(p){ cx+=p[0]; cz+=p[1]; }); cx/=sp.length; cz/=sp.length;
    var ring=new THREE.Mesh(new THREE.RingGeometry(3.6,4,48),new THREE.MeshBasicMaterial({color:TEAM_COL[t],transparent:true,opacity:0.55,side:THREE.DoubleSide})); ring.rotation.x=-Math.PI/2; ring.position.set(cx,(V.heightAt?V.heightAt(cx,cz):0)+0.03,cz); S.add(ring); });
  // pickups
  V.pickups=(map.pickups||[]).map(function(p){ var g=new THREE.Group(), col=p.type==='health'?'#5dff8a':'#ffd23f', m=new THREE.MeshStandardMaterial({color:col,emissive:col,emissiveIntensity:0.9});
    if(p.type==='health'){ g.add(new THREE.Mesh(new THREE.BoxGeometry(0.5,0.16,0.16),m)); g.add(new THREE.Mesh(new THREE.BoxGeometry(0.16,0.5,0.16),m)); }
    else { g.add(new THREE.Mesh(new THREE.BoxGeometry(0.42,0.5,0.12),m)); }
    var pad=new THREE.Mesh(new THREE.CylinderGeometry(0.5,0.6,0.08,20),new THREE.MeshStandardMaterial({color:0x22223a,emissive:col,emissiveIntensity:0.3})); pad.position.y=-0.75; g.add(pad);
    g.position.set(p.pos[0],0.85+(V.heightAt?V.heightAt(p.pos[0],p.pos[1]):0),p.pos[1]); S.add(g); return g; });
  (map.lights||[]).forEach(function(l){ var pl=new THREE.PointLight(l.color,l.intensity,l.distance||14,2); pl.position.set(l.pos[0],l.pos[1],l.pos[2]); S.add(pl); });
  V.bats=null; V.fogs=[];
  if(map.theme==='halloween'){
    var moon=new THREE.Sprite(new THREE.SpriteMaterial({map:glowTex('#f4f0d8'),color:map.sky.moon||'#f4f0d8',fog:false})); moon.scale.set(60,60,1); moon.position.set(-160,120,-220); S.add(moon);
    var disc=new THREE.Mesh(new THREE.CircleGeometry(12,32),new THREE.MeshBasicMaterial({color:'#fff8e0',fog:false})); disc.position.copy(moon.position); disc.lookAt(0,0,0); S.add(disc);
    var bg=new THREE.BufferGeometry(); bg.setAttribute('position',new THREE.Float32BufferAttribute([0,0,0,-0.5,0,0.15,-0.8,0,-0.15, 0,0,0,0.5,0,0.15,0.8,0,-0.15],3)); bg.computeVertexNormals();
    V.bats=new THREE.InstancedMesh(bg,new THREE.MeshBasicMaterial({color:0x0c0614,side:THREE.DoubleSide}),40); V.bats.frustumCulled=false; S.add(V.bats);
    V.batData=[]; for(var i=0;i<40;i++) V.batData.push({c:[(Math.random()-0.5)*80,(Math.random()-0.5)*50],r:4+Math.random()*10,h:9+Math.random()*10,a:Math.random()*6.28,s:(0.6+Math.random())*(i%2?1:-1)});
    var ft=canvasTex(128,128,function(g){ var r=g.createRadialGradient(64,64,0,64,64,64); r.addColorStop(0,'rgba(200,180,255,.35)'); r.addColorStop(1,'rgba(200,180,255,0)'); g.fillStyle=r; g.fillRect(0,0,128,128); });
    for(var f=0;f<26;f++){ var sp=new THREE.Sprite(new THREE.SpriteMaterial({map:ft,transparent:true,depthWrite:false,opacity:0.6})); sp.scale.set(14,5,1); sp.position.set((Math.random()-0.5)*110,1.2,(Math.random()-0.5)*72); S.add(sp); V.fogs.push(sp); } }
  // bases: capture zones and armory racks
  V.flagMeshes={}; V.rackLabels=[];
  if(map.bases) ['A','B'].forEach(function(t){ var B=map.bases[t], col=TEAM_COL[t];
    var hy=V.heightAt?V.heightAt(B.capture[0],B.capture[1]):0;
    var cz=new THREE.Mesh(new THREE.RingGeometry(B.capture[2]-0.35,B.capture[2],56),new THREE.MeshBasicMaterial({color:col,transparent:true,opacity:0.75,side:THREE.DoubleSide})); cz.rotation.x=-Math.PI/2; cz.position.set(B.capture[0],hy+0.04,B.capture[1]); S.add(cz);
    var czf=new THREE.Mesh(new THREE.CircleGeometry(B.capture[2],56),new THREE.MeshBasicMaterial({color:col,transparent:true,opacity:0.08,side:THREE.DoubleSide,depthWrite:false})); czf.rotation.x=-Math.PI/2; czf.position.set(B.capture[0],hy+0.03,B.capture[1]); S.add(czf);
    (B.racks||[]).forEach(function(r){ var ry=V.heightAt?V.heightAt(r.pos[0],r.pos[1]):0; var stand=new THREE.Mesh(new THREE.BoxGeometry(0.9,0.9,0.6),new THREE.MeshStandardMaterial({color:'#2a2436',roughness:0.6})); stand.position.set(r.pos[0],ry+0.45,r.pos[1]); stand.receiveShadow=true; S.add(stand);
      var g=buildGun(V.data.weapons.models,r.weapon,1.6); g.position.set(r.pos[0],ry+1.25,r.pos[1]); g.rotation.y=Math.PI/2; S.add(g); V.rackLabels.push(g);
      var glow=new THREE.Mesh(new THREE.BoxGeometry(0.92,0.05,0.62),new THREE.MeshStandardMaterial({color:col,emissive:col,emissiveIntensity:1.5})); glow.position.set(r.pos[0],ry+0.92,r.pos[1]); S.add(glow); }); });
  V.setupPost();
};
VP.flagMesh=function(f){ var V=this; if(V.flagMeshes[f.id]) return V.flagMeshes[f.id]; var g=new THREE.Group(), col=TEAM_COL[f.team];
  var pole=new THREE.Mesh(new THREE.CylinderGeometry(0.05,0.05,2.6,8),new THREE.MeshStandardMaterial({color:'#e8e4f0',metalness:0.6,roughness:0.3})); pole.position.y=1.3; g.add(pole);
  var cloth=new THREE.Mesh(new THREE.BoxGeometry(0.9,0.55,0.04),new THREE.MeshStandardMaterial({color:col,emissive:col,emissiveIntensity:0.9})); cloth.position.set(0.47,2.25,0); g.add(cloth);
  var base=new THREE.Mesh(new THREE.CylinderGeometry(0.6,0.7,0.12,20),new THREE.MeshStandardMaterial({color:'#20202e',emissive:col,emissiveIntensity:0.4})); base.position.y=0.06; g.add(base);
  var beam=new THREE.Mesh(new THREE.CylinderGeometry(0.3,0.3,30,12,1,true),new THREE.MeshBasicMaterial({color:col,transparent:true,opacity:0.12,side:THREE.DoubleSide,depthWrite:false,blending:THREE.AdditiveBlending})); beam.position.y=15; g.add(beam);
  g.userData={cloth:cloth,base:base,beam:beam}; V.scene.add(g); V.flagMeshes[f.id]=g; return g; };
VP.themedPiece=function(b,w,h,dd,cx,cz,faceM,winM){
  var S=this.scene, k=b.kind, std=function(c,r){ return new THREE.MeshStandardMaterial({color:c,roughness:r==null?0.7:r}); }, add=function(m,x,y,z){ m.position.set(x,y,z); m.castShadow=true; m.receiveShadow=true; S.add(m); return m; };
  if(k==='pumpkin'){ var pk=add(new THREE.Mesh(new THREE.SphereGeometry(0.5,14,10),std(b.color,0.45)),cx,h*0.48,cz); pk.scale.set(w*1.05,h*0.98,dd*1.05);
    [1,-1].forEach(function(sd){ [-0.22,0.22].forEach(function(o){ var e=new THREE.Mesh(new THREE.BoxGeometry(0.06,h*0.16,w*0.14),faceM); e.position.set(cx+sd*w*0.5,h*0.58,cz+o*dd); S.add(e); }); var mo=new THREE.Mesh(new THREE.BoxGeometry(0.06,h*0.1,w*0.5),faceM); mo.position.set(cx+sd*w*0.5,h*0.32,cz); S.add(mo); });
    add(new THREE.Mesh(new THREE.CylinderGeometry(0.08,0.12,0.35,6),std('#3a6a2a')),cx,h+0.1,cz); return true; }
  if(k==='grave'){ add(new THREE.Mesh(new THREE.BoxGeometry(w,h*0.8,dd),std(b.color,0.9)),cx,h*0.4,cz); add(new THREE.Mesh(new THREE.BoxGeometry(w*0.7,h*0.2,dd),std(b.color,0.9)),cx,h*0.9,cz); add(new THREE.Mesh(new THREE.BoxGeometry(w*1.3,0.12,dd*2.2),std('#2a2a34',0.95)),cx,0.06,cz); return true; }
  if(k==='tree'){ add(new THREE.Mesh(new THREE.CylinderGeometry(w*0.35,w*0.55,h,7),std(b.color,0.95)),cx,h/2,cz);
    for(var i=0;i<6;i++){ var a=i/6*6.28+0.4, br=new THREE.Mesh(new THREE.BoxGeometry(0.16,1.8+(i%3)*0.5,0.16),std(b.color,0.95)); br.position.set(cx+Math.cos(a)*0.55,h*0.55+i*0.38,cz+Math.sin(a)*0.55); br.rotation.set(Math.sin(a)*0.8,0,-Math.cos(a)*0.8); br.castShadow=true; S.add(br); } return true; }
  if(k==='fence'){ var long=w>dd, L=long?w:dd, n=Math.max(2,Math.round(L/0.5)), m=std(b.color,0.5);
    for(var j=0;j<=n;j++){ var t=-L/2+j*L/n, post=new THREE.Mesh(new THREE.BoxGeometry(0.08,h+(j%2?0:0.25),0.08),m); post.position.set(cx+(long?t:0),(h+(j%2?0:0.25))/2,cz+(long?0:t)); post.castShadow=true; S.add(post); }
    [0.35,0.85].forEach(function(f){ var rail=new THREE.Mesh(new THREE.BoxGeometry(long?L:0.06,0.07,long?0.06:L),m); rail.position.set(cx,h*f,cz); S.add(rail); }); return true; }
  if(k==='house'){ var body=add(new THREE.Mesh(new THREE.BoxGeometry(w,h,dd),std(b.color,0.8)),cx,h/2,cz);
    var roof=add(new THREE.Mesh(new THREE.ConeGeometry(Math.max(w,dd)*0.78,h*0.7,4),std('#1f1626',0.8)),cx,h+h*0.35,cz); roof.rotation.y=Math.PI/4;
    for(var q=0;q<4;q++){ var sd=q<2?1:-1, onX=q%2===0, win=new THREE.Mesh(new THREE.BoxGeometry(onX?0.05:0.8,0.9,onX?0.8:0.05),winM); win.position.set(cx+(onX?sd*(w/2+0.01):(q===1?-1:1)*w*0.22),h*0.62,cz+(onX?(q===0?-1:1)*dd*0.22:sd*(dd/2+0.01))); S.add(win); }
    S.add(new THREE.LineSegments(new THREE.EdgesGeometry(body.geometry),new THREE.LineBasicMaterial({color:0x0c0a14,transparent:true,opacity:0.5}))).position.copy(body.position); return true; }
  if(k==='crypt'){ var c=add(new THREE.Mesh(new THREE.BoxGeometry(w,h,dd),std(b.color,0.85)),cx,h/2,cz); add(new THREE.Mesh(new THREE.BoxGeometry(w+0.4,0.3,dd+0.4),std('#3a3448',0.85)),cx,h+0.15,cz);
    var cr=new THREE.Mesh(new THREE.BoxGeometry(0.15,0.9,0.5),new THREE.MeshStandardMaterial({color:'#9affc0',emissive:'#3fe07a',emissiveIntensity:1.5})); cr.position.set(cx,h+0.75,cz); S.add(cr); return true; }
  if(k==='roof'){ add(new THREE.Mesh(new THREE.BoxGeometry(w,h,dd),std(b.color,0.8)),cx,(b.min[1]+b.max[1])/2,cz); return true; }
  return false;
};
VP.setupPost=function(){ var V=this; V.composer=null; if(V.quality!=='high'||!THREE.EffectComposer||!THREE.UnrealBloomPass) return;
  try{ V.composer=new THREE.EffectComposer(V.renderer); V.composer.addPass(new THREE.RenderPass(V.scene,V.camera)); V.composer.addPass(new THREE.UnrealBloomPass(new THREE.Vector2(innerWidth/2,innerHeight/2),0.55,0.5,0.82)); V.composer.setSize(innerWidth,innerHeight); }catch(e){ V.composer=null; } };
/* ---------- players ---------- */
VP.ensurePlayer=function(p){
  var V=this; if(V.players[p.id]) return V.players[p.id];
  var ch=V.data.chars[p.charId], body=buildCharacter(ch), mini=buildMini(ch), root=new THREE.Group(); root.add(body.root); root.add(mini); mini.visible=false;
  var gun=buildGun(V.data.weapons.models,p.loadout[0],0.9); if(body.rig.armR){ gun.position.set(0,-0.25,-0.15); body.rig.armR.add(gun); }
  var mark=new THREE.Mesh(new THREE.OctahedronGeometry(0.12),new THREE.MeshBasicMaterial({color:TEAM_COL[p.team]})); mark.position.y=body.rig.height+0.35; root.add(mark);
  var ring=new THREE.Mesh(new THREE.RingGeometry(0.34,0.44,24),new THREE.MeshBasicMaterial({color:TEAM_COL[p.team],transparent:true,opacity:0.7,side:THREE.DoubleSide})); ring.rotation.x=-Math.PI/2; ring.position.y=0.02; root.add(ring);
  var shield=new THREE.Mesh(new THREE.SphereGeometry(1.05,20,14),new THREE.MeshBasicMaterial({color:TEAM_COL[p.team],transparent:true,opacity:0.18,depthWrite:false})); shield.position.y=0.9; shield.visible=false; root.add(shield);
  var pc=document.createElement('canvas'); pc.width=256; pc.height=64; var plate=new THREE.Sprite(new THREE.SpriteMaterial({map:new THREE.CanvasTexture(pc),transparent:true,depthTest:false})); plate.scale.set(1.6,0.4,1); plate.position.y=body.rig.height+0.7; plate.renderOrder=997; root.add(plate);
  V.scene.add(root); var o={plate:plate,plateCanvas:pc,root:root,body:body.root,rig:body.rig,mini:mini,gun:gun,gunId:p.loadout[0],mark:mark,ring:ring,shield:shield,walk:0,miniPop:0,lastX:p.x,lastZ:p.z};
  V.players[p.id]=o; return o;
};
VP.plate=function(p,o){ var hp=Math.max(0,Math.ceil(p.hp/10)), key=p.name+'|'+hp+'|'+p.team+'|'+(p.flag?1:0);
  if(o.plateKey===key) return; o.plateKey=key; var c=o.plateCanvas, g=c.getContext('2d'), col=TEAM_COL[p.team]; g.clearRect(0,0,256,64);
  g.font='bold 26px Oswald, Arial, sans-serif'; g.textAlign='center'; g.lineWidth=5; g.strokeStyle='rgba(0,0,0,.85)'; var label=(p.flag?'⚑ ':'')+p.name; g.strokeText(label,128,26); g.fillStyle=col; g.fillText(label,128,26);
  g.fillStyle='rgba(0,0,0,.7)'; g.fillRect(48,36,160,14); g.fillStyle=p.hp>50?col:(p.hp>25?'#ffc83d':'#ff3a4a'); g.fillRect(50,38,156*Math.max(0,p.hp)/100,10); o.plate.material.map.needsUpdate=true; };
VP.syncPlayers=function(sim,localId,dt){
  var V=this;
  sim.players.forEach(function(p){ var o=V.ensurePlayer(p), local=p.id===localId, mini=p.state==='mini';
    o.root.position.set(p.x,p.y,p.z); o.root.rotation.y=p.yaw;
    var speed=Math.hypot(p.x-o.lastX,p.z-o.lastZ)/Math.max(dt,1e-3); o.lastX=p.x; o.lastZ=p.z;
    o.body.visible=!mini&&!local; o.mini.visible=mini; o.mark.visible=!mini&&!local&&sim.mode.teams&&p.team===sim.players.filter(function(q){ return q.id===localId; })[0].team; o.ring.visible=!mini&&!local;
    var dome=p.shieldHp>0&&p.abilityT>0&&!mini; o.shield.visible=(p.prot>0||dome)&&!mini&&!local; if(o.shield.visible){ o.shield.material.opacity=dome?0.28+0.06*Math.sin(sim.time*8):0.12+0.08*Math.sin(sim.time*12); o.shield.scale.setScalar(dome?1.2:1); }
    if(!o.aura){ o.aura=new THREE.Mesh(new THREE.RingGeometry(0.6,1,32),new THREE.MeshBasicMaterial({color:'#5dff8a',transparent:true,opacity:0.6,side:THREE.DoubleSide,blending:THREE.AdditiveBlending,depthWrite:false})); o.aura.rotation.x=-Math.PI/2; o.aura.position.y=0.05; o.root.add(o.aura); }
    var ab=p.abilityT>0&&!mini?p.ability.id:null; o.aura.visible=ab==='feast'||ab==='rampage'||ab==='overclock';
    if(o.aura.visible){ o.aura.material.color.set(ab==='feast'?'#5dff8a':ab==='rampage'?'#ff4a3a':'#40e8ff'); var ss=ab==='feast'?7:1.3+0.2*Math.sin(sim.time*10); o.aura.scale.set(ss,ss,1); }
    if(ab==='overclock'&&Math.random()<0.3) V.sparks(p.x,p.y+0.4,p.z,0x40e8ff,1,0.25,1);
    var me=sim.byId(localId), foe=me&&p.team!==me.team, hunted=foe&&(V.marked[p.id]||0)>sim.time, seeAll=foe&&!mini&&((me.abilityT>0&&me.ability.id==='vision')||hunted);
    // plates: teammates always, enemies when you can see them, or when they recently shot you
    if(!local&&!mini){ V.plate(p,o); var cam=V.camera.position, inSight=!foe||hunted||((V.losT[p.id]||0)>sim.time);
      if(foe&&(!V.losCheck[p.id]||V.losCheck[p.id]<sim.time)){ V.losCheck[p.id]=sim.time+0.2; if(sim.los(cam.x,cam.y,cam.z,p.x,p.y+1.4,p.z)) V.losT[p.id]=sim.time+0.35; }
      o.plate.visible=inSight; var dcam=Math.hypot(cam.x-p.x,cam.z-p.z), k=Math.max(1,dcam/14); o.plate.scale.set(1.6*k,0.4*k,1); } else o.plate.visible=false;
    if(!o.ghost){ o.ghost=new THREE.Mesh(new THREE.BoxGeometry(0.75,1.7,0.6),new THREE.MeshBasicMaterial({color:'#ff3a4a',transparent:true,opacity:0.45,depthTest:false})); o.ghost.position.y=0.85; o.ghost.renderOrder=998; o.root.add(o.ghost); }
    o.ghost.visible=!!seeAll;
    if(mini){ o.miniPop=Math.min(1,o.miniPop+dt*3); var s=o.miniPop<1?1.4-0.4*o.miniPop:1; o.mini.scale.setScalar(s); o.mini.position.y=0.05+Math.abs(Math.sin(sim.time*7+p.x))*0.12*Math.min(1,speed/3); o.mini.rotation.y=Math.sin(sim.time*2)*0.2; return; }
    o.miniPop=0;
    var cur=p.weapons[p.wi]&&p.weapons[p.wi].id; if(cur&&cur!==o.gunId&&o.rig.armR){ o.rig.armR.remove(o.gun); o.gun=buildGun(V.data.weapons.models,cur,0.9); o.gun.position.set(0,-0.25,-0.15); o.rig.armR.add(o.gun); o.gunId=cur; }
    o.walk+=dt*Math.min(speed,8)*1.6; var sw=Math.sin(o.walk)*Math.min(1,speed/3)*0.7, r=o.rig;
    if(r.legL) r.legL.rotation.x=sw; if(r.legR) r.legR.rotation.x=-sw;
    if(r.armL) r.armL.rotation.x=-sw*0.6;
    if(r.armR) r.armR.rotation.x=-Math.PI/2.4+p.pitch*0.8;      // gun arm points where they aim
    if(r.head) r.head.rotation.x=p.pitch*0.5;
    o.body.position.y=Math.abs(Math.sin(o.walk))*0.04*Math.min(1,speed/3)-(p.crouch?0.28:0); o.body.scale.y=p.crouch?0.82:1;
  });
};
/* ---------- first-person weapon ---------- */
VP.setViewmodel=function(wid,armColor){
  var V=this; if(V.vm&&V.vmId===wid) return; if(V.vm) V.camera.remove(V.vm);
  var g=new THREE.Group(), gun=buildGun(V.data.weapons.models,wid,1);
  var hand=new THREE.Mesh(new THREE.BoxGeometry(0.09,0.09,0.12),new THREE.MeshStandardMaterial({color:armColor||'#cfcbc1',roughness:0.6})); hand.position.set(0,-0.09,wid==='bat'?-0.15:-0.05);
  var hand2=hand.clone(); hand2.position.set(-0.02,-0.08,-0.35); g.add(gun); g.add(hand); if(wid!=='pistol'&&wid!=='bat') g.add(hand2);
  g.traverse(function(o){ if(o.material){ o.material=o.material.clone(); o.material.depthTest=false; o.material.fog=false; } o.renderOrder=999; o.castShadow=false; });
  g.position.set(0.22,-0.2,-0.38); V.camera.add(g); V.vm=g; V.vmId=wid; V.vmKick=0; V.vmBob=0;
  var tip=new THREE.Sprite(new THREE.SpriteMaterial({map:V.tex.flash,color:0xffd27a,transparent:true,depthTest:false,blending:THREE.AdditiveBlending})); tip.scale.set(0.35,0.35,1); tip.visible=false; tip.renderOrder=1000;
  var z=-0.6; (V.data.weapons.models[wid]||[]).forEach(function(b){ z=Math.min(z,b[2]); }); tip.position.set(0,0,z-0.05); g.add(tip); V.vmFlash=tip; V.vmFlashT=0;
};
VP.updateCamera=function(p,sim,dt,input){
  var V=this, cam=V.camera;
  if(p.state==='mini'){ if(V.vm) V.vm.visible=false; var back=3.2, hgt=1.6; cam.position.set(p.x+Math.sin(p.yaw)*back,p.y+hgt,p.z+Math.cos(p.yaw)*back); cam.lookAt(p.x,p.y+0.3,p.z); cam.fov+=(V.settings.fov-cam.fov)*Math.min(1,dt*8); cam.updateProjectionMatrix(); return; }
  var eye=sim.eye(p); V.eyeY=V.eyeY==null?eye:V.eyeY+(eye-V.eyeY)*Math.min(1,dt*14);
  var sk=V.shake||0; V.shake=Math.max(0,sk-dt*1.2); cam.position.set(p.x+(Math.random()-0.5)*sk*0.3,V.eyeY+(Math.random()-0.5)*sk*0.3,p.z); cam.rotation.order='YXZ'; cam.rotation.set(p.pitch+(V.vmKick||0)*0.4,p.yaw,0);
  var w=sim.curWeapon(p).def, ads=input.aim&&!w.melee, tf=ads?w.adsFov||60:V.settings.fov; cam.fov+=(tf-cam.fov)*Math.min(1,dt*14); cam.updateProjectionMatrix();
  if(V.vm){ var speed=Math.hypot(p.vx,p.vz); V.vm.visible=!(ads&&w.scope); V.vmBob+=dt*speed*1.3;
    var bx=Math.cos(V.vmBob)*0.012*Math.min(1,speed/4), by=Math.abs(Math.sin(V.vmBob))*0.016*Math.min(1,speed/4);
    var reload=p.reloadT>0?Math.sin(Math.min(1,p.reloadT/w.reload)*Math.PI):0, sw=p.switchT>0?p.switchT/0.35:0;
    V.vm.position.set((ads?0:0.22)+bx,(ads?-0.12:-0.2)+by-reload*0.15-sw*0.25,(ads?-0.32:-0.38)+V.vmKick*0.6); V.vm.rotation.set(V.vmKick*2+reload*0.6,0,reload*0.4);
    V.vmKick=Math.max(0,V.vmKick-dt*0.5);
    if(V.vmFlashT>0){ V.vmFlashT-=dt; V.vmFlash.visible=true; V.vmFlash.material.rotation=Math.random()*6; } else V.vmFlash.visible=false; }
};
/* ---------- effects ---------- */
VP.muzzleWorld=function(){ var v=new THREE.Vector3(); if(this.vmFlash){ this.vmFlash.getWorldPosition(v); } else v.copy(this.camera.position); return v; };
VP.tracer=function(a,b,col){ var g=new THREE.BufferGeometry(); g.setAttribute('position',new THREE.Float32BufferAttribute([a.x,a.y,a.z,b[0],b[1],b[2]],3));
  var l=new THREE.Line(g,new THREE.LineBasicMaterial({color:col||0xffe7a0,transparent:true,opacity:0.9})); this.scene.add(l); this.fx.push({o:l,t:0.07,max:0.07,kind:'fade'}); };
VP.sparks=function(x,y,z,col,n,size,speed){ for(var i=0;i<(n||6);i++){ var s=new THREE.Sprite(new THREE.SpriteMaterial({map:this.tex.spark,color:col||0xffd27a,transparent:true,blending:THREE.AdditiveBlending,depthWrite:false})); s.position.set(x,y,z); var k=size||0.18; s.scale.set(k,k,1); this.scene.add(s);
  this.fx.push({o:s,t:0.35,max:0.35,kind:'spark',v:[(Math.random()-0.5)*(speed||4),Math.random()*(speed||4),(Math.random()-0.5)*(speed||4)]}); } };
VP.cubes=function(x,y,z,cols,n,spd){ for(var i=0;i<n;i++){ var m=new THREE.Mesh(new THREE.BoxGeometry(0.09,0.09,0.09),new THREE.MeshStandardMaterial({color:cols[i%cols.length],roughness:0.6})); m.position.set(x,y,z); m.castShadow=true; this.scene.add(m);
  this.fx.push({o:m,t:1.1,max:1.1,kind:'cube',v:[(Math.random()-0.5)*spd,Math.random()*spd*0.9+1,(Math.random()-0.5)*spd],r:[Math.random()*8,Math.random()*8]}); } };
VP.damageNumber=function(x,y,z,n,head){ var c=document.createElement('canvas'); c.width=128; c.height=64; var g=c.getContext('2d'); g.font='900 44px Impact, Arial, sans-serif'; g.textAlign='center'; g.lineWidth=6; g.strokeStyle='#000'; g.strokeText(n,64,46); g.fillStyle=head?'#ff7a3a':'#ffe14a'; g.fillText(n,64,46);
  var s=new THREE.Sprite(new THREE.SpriteMaterial({map:new THREE.CanvasTexture(c),transparent:true,depthTest:false})); s.renderOrder=999; s.position.set(x+(Math.random()-0.5)*0.6,y,z+(Math.random()-0.5)*0.6); var k=head?1.1:0.8; s.scale.set(k,k/2,1); this.scene.add(s);
  this.fx.push({o:s,t:0.9,max:0.9,kind:'num'}); };
VP.decal=function(x,y,z){ var m=new THREE.Mesh(new THREE.PlaneGeometry(0.1,0.1),new THREE.MeshBasicMaterial({color:0x111018,transparent:true,opacity:0.7,depthWrite:false,polygonOffset:true,polygonOffsetFactor:-2}));
  m.position.set(x,y,z); m.lookAt(this.camera.position); this.scene.add(m); this.decals.push(m); if(this.decals.length>80) this.scene.remove(this.decals.shift()); };
VP.ringBurst=function(x,z,col,r){ var m=new THREE.Mesh(new THREE.RingGeometry(0.8,1,40),new THREE.MeshBasicMaterial({color:col,transparent:true,side:THREE.DoubleSide,blending:THREE.AdditiveBlending,depthWrite:false})); m.rotation.x=-Math.PI/2; m.position.set(x,0.05,z); this.scene.add(m); this.fx.push({o:m,t:0.6,max:0.6,kind:'ring',r:r||3}); };
VP.beam=function(x,z,col){ var m=new THREE.Mesh(new THREE.CylinderGeometry(0.55,0.55,6,20,1,true),new THREE.MeshBasicMaterial({color:col,transparent:true,opacity:0.5,side:THREE.DoubleSide,blending:THREE.AdditiveBlending,depthWrite:false})); m.position.set(x,3,z); this.scene.add(m); this.fx.push({o:m,t:0.8,max:0.8,kind:'beam'}); };
VP.colorsOf=function(charId){ var ch=this.data.chars[charId], seen={}, out=[]; Object.keys(ch.model.parts).forEach(function(k){ ch.model.parts[k].forEach(function(b){ if(!seen[b[6]]&&out.length<6){ seen[b[6]]=1; out.push(b[6]); } }); }); return out; };
VP.onEvents=function(evts,sim,localId){
  var V=this;
  evts.forEach(function(e){ var p=e.id&&sim.players.filter(function(q){ return q.id===e.id; })[0];
    if(e.type==='shot'){ var local=e.id===localId, from=local?V.muzzleWorld():new THREE.Vector3(e.from[0],e.from[1]-0.25,e.from[2]);
      if(local){ V.vmKick=Math.min(0.12,(V.vmKick||0)+(sim.weapons[e.weapon].recoil||0.02)*1.6); V.vmFlashT=0.05; }
      else if(V.players[e.id]){ V.sparks(e.from[0],e.from[1]-0.3,e.from[2],0xffd27a,1,0.5,0.1); }
      e.hits.forEach(function(h,i){ if(i<3||local) V.tracer(from,[h.x,h.y,h.z]); if(h.wall){ V.sparks(h.x,h.y,h.z,0xffd27a,4,0.12,3); V.decal(h.x,h.y,h.z); } }); }
    else if(e.type==='melee'&&e.id===localId){ V.vmKick=0.25; }
    else if(e.type==='hit'){ var q=sim.players.filter(function(x){ return x.id===e.id; })[0]; if(q) V.cubes(q.x,q.y+(e.head?1.6:1.0),q.z,V.colorsOf(q.charId),e.head?6:3,3);
      if(e.by===localId&&q) V.damageNumber(q.x,q.y+2.1,q.z,e.dmg,e.head);
      if(e.id===localId&&e.by) V.marked[e.by]=sim.time+3; }
    else if(e.type==='kill'&&e.victim===localId&&e.killer){ V.marked[e.killer]=sim.time+6; }
    else if(e.type==='transform'){ var t=sim.players.filter(function(x){ return x.id===e.id; })[0]; if(!t) return; V.cubes(e.x,e.y+0.9,e.z,V.colorsOf(t.charId),26,6); V.sparks(e.x,e.y+0.6,e.z,0xffffff,10,0.35,5); V.ringBurst(e.x,e.z,TEAM_COL[t.team],3.5); if(V.players[e.id]) V.players[e.id].miniPop=0; }
    else if(e.type==='respawn'){ var r=sim.players.filter(function(x){ return x.id===e.id; })[0]; if(r){ V.beam(e.x,e.z,TEAM_COL[r.team]); V.ringBurst(e.x,e.z,TEAM_COL[r.team],2); } }
    else if(e.type==='explode'){ var fl=new THREE.Sprite(new THREE.SpriteMaterial({map:V.tex.flash,color:0xffa040,transparent:true,blending:THREE.AdditiveBlending,depthWrite:false})); fl.position.set(e.x,e.y+0.5,e.z); fl.scale.set(e.r*2.2,e.r*2.2,1); V.scene.add(fl); V.fx.push({o:fl,t:0.35,max:0.35,kind:'fade'});
      V.sparks(e.x,e.y+0.4,e.z,0xff8a3a,16,0.6,9); V.cubes(e.x,e.y+0.3,e.z,['#3a3448','#ff7a1a','#2a2030'],10,7); V.ringBurst(e.x,e.z,'#ffb050',e.r); V.shake=Math.max(V.shake||0,0.35*Math.max(0,1-Math.hypot(e.x-V.camera.position.x,e.z-V.camera.position.z)/30)); }
    else if(e.type==='turretShot'){ V.tracer(new THREE.Vector3(e.from[0],e.from[1],e.from[2]),e.to,0xaaefa1); }
    else if(e.type==='ability'){ var ap=sim.byId(e.id); if(ap){ V.ringBurst(ap.x,ap.z,'#ffffff',3); V.sparks(ap.x,ap.y+1,ap.z,0xffffff,12,0.3,4); } }
    else if(e.type==='armory'){ var am=sim.byId(e.id); if(am) V.sparks(am.x,am.y+1,am.z,0xcdff65,8,0.2,2); }
    else if(e.type==='capture'){ var cp=sim.byId(e.id); if(cp){ V.beam(cp.x,cp.z,TEAM_COL[cp.team]); V.ringBurst(cp.x,cp.z,TEAM_COL[cp.team],8); } }
    else if(e.type==='pickup'){ var k=sim.pickups[e.pickup]; V.sparks(k.x,0.9,k.z,e.kind==='health'?0x5dff8a:0xffd23f,10,0.25,3); }
  });
};
VP.updateFx=function(dt,sim){
  var V=this;
  V.fx=V.fx.filter(function(f){ f.t-=dt; var k=Math.max(0,f.t/f.max);
    if(f.kind==='fade'){ f.o.material.opacity=k; } else if(f.kind==='spark'){ f.o.position.x+=f.v[0]*dt; f.o.position.y+=f.v[1]*dt; f.o.position.z+=f.v[2]*dt; f.v[1]-=9*dt; f.o.material.opacity=k; }
    else if(f.kind==='cube'){ f.o.position.x+=f.v[0]*dt; f.o.position.y=Math.max(0.05,f.o.position.y+f.v[1]*dt); f.o.position.z+=f.v[2]*dt; f.v[1]-=14*dt; if(f.o.position.y<=0.05){ f.v[0]*=0.8; f.v[2]*=0.8; f.v[1]=Math.abs(f.v[1])*0.3; } f.o.rotation.x+=f.r[0]*dt; f.o.rotation.y+=f.r[1]*dt; if(k<0.3) f.o.scale.setScalar(k/0.3); }
    else if(f.kind==='num'){ f.o.position.y+=dt*1.2; f.o.material.opacity=Math.min(1,k*2); }
    else if(f.kind==='ring'){ var s=1+(1-k)*f.r; f.o.scale.set(s,s,1); f.o.material.opacity=k; } else if(f.kind==='beam'){ f.o.material.opacity=0.5*k; f.o.scale.set(k,1,k); }
    if(f.t<=0){ V.scene.remove(f.o); if(f.o.geometry) f.o.geometry.dispose(); return false; } return true; });
  (sim.flags||[]).forEach(function(f){ var g=V.flagMesh(f), u=g.userData;
    if(f.state==='captured'){ var cap=V.map.bases[f.team==='A'?'B':'A'].capture, idx=+f.id.slice(1); g.position.set(cap[0]+(idx-1)*1.2,sim.heightAt(cap[0],cap[1]),cap[1]+1.5); u.beam.visible=false; u.base.visible=true; g.rotation.y=0; g.scale.setScalar(0.8); return; }
    g.scale.setScalar(1); u.beam.visible=f.state!=='carried';
    if(f.state==='carried'){ var c=sim.byId(f.carrier); if(c){ g.position.set(c.x+Math.sin(c.yaw)*0.35,c.y+0.6,c.z+Math.cos(c.yaw)*0.35); g.rotation.y=c.yaw+Math.PI/2; u.base.visible=false; } }
    else { g.position.set(f.x,f.y||0,f.z); u.base.visible=true; g.rotation.y+=dt*0.6; }
    u.cloth.rotation.y=Math.sin(sim.time*4+f.x)*0.25; });
  V.rackLabels.forEach(function(g){ g.rotation.y+=dt*0.8; });
  V.projMeshes=V.projMeshes||[]; V.projMeshes.forEach(function(m){ m.visible=false; });
  (sim.projectiles||[]).forEach(function(pr,i){ var m=V.projMeshes[i]; if(!m){ m=new THREE.Mesh(new THREE.BoxGeometry(0.16,0.16,0.6),new THREE.MeshStandardMaterial({color:'#ff7a1a',emissive:'#ff5a00',emissiveIntensity:2})); V.scene.add(m); V.projMeshes[i]=m; }
    m.visible=true; m.position.set(pr.x,pr.y,pr.z); m.lookAt(pr.x+pr.vx,pr.y+pr.vy,pr.z+pr.vz); if(Math.random()<0.6) V.sparks(pr.x,pr.y,pr.z,pr.kind==='missile'?0xff9a4a:0xbbbbcc,1,0.45,0.6); });
  V.turretMeshes=V.turretMeshes||{}; var alive={};
  (sim.turrets||[]).forEach(function(t){ alive[t.id]=1; var m=V.turretMeshes[t.id]; if(!m){ m=new THREE.Group(); var base=new THREE.Mesh(new THREE.CylinderGeometry(0.45,0.55,0.9,10),new THREE.MeshStandardMaterial({color:'#8b97a5',metalness:0.5,roughness:0.4})); base.position.y=0.45; m.add(base);
      var head=new THREE.Group(); var hat=new THREE.Mesh(new THREE.BoxGeometry(0.9,0.25,0.9),new THREE.MeshStandardMaterial({color:'#9aa8b7'})); hat.position.y=1.05; head.add(hat);
      var eye=new THREE.Mesh(new THREE.BoxGeometry(0.5,0.12,0.05),new THREE.MeshStandardMaterial({color:'#aaefa1',emissive:'#aaefa1',emissiveIntensity:2})); eye.position.set(0,1.05,-0.46); head.add(eye);
      var barrel=new THREE.Mesh(new THREE.BoxGeometry(0.1,0.1,0.7),new THREE.MeshStandardMaterial({color:'#1a1c24'})); barrel.position.set(0,0.95,-0.6); head.add(barrel); m.add(head); m.userData.head=head; V.scene.add(m); V.turretMeshes[t.id]=m; V.ringBurst(t.x,t.z,TEAM_COL[t.team],1.5); }
    m.position.set(t.x,t.y||0,t.z); m.userData.head.rotation.y+=Sim_angDiff(m.userData.head.rotation.y,t.yaw)*Math.min(1,dt*10); });
  Object.keys(V.turretMeshes).forEach(function(id){ if(!alive[id]){ var m=V.turretMeshes[id]; V.sparks(m.position.x,1,m.position.z,0xaaefa1,10,0.3,4); V.scene.remove(m); delete V.turretMeshes[id]; } });
  if(V.bats){ var mt=new THREE.Matrix4(), q=new THREE.Quaternion(), e=new THREE.Euler(), sc=new THREE.Vector3(), ps=new THREE.Vector3();
    V.batData.forEach(function(b,i){ b.a+=b.s*dt; var flap=0.4+Math.abs(Math.sin(sim.time*14+i))*0.9; e.set(Math.sin(sim.time*14+i)*0.5,-(b.a+Math.PI/2*Math.sign(b.s)),0); q.setFromEuler(e); sc.set(flap,1,1); ps.set(b.c[0]+Math.cos(b.a)*b.r,b.h+Math.sin(sim.time*2+i)*0.6,b.c[1]+Math.sin(b.a)*b.r); mt.compose(ps,q,sc); V.bats.setMatrixAt(i,mt); });
    V.bats.instanceMatrix.needsUpdate=true; }
  V.fogs.forEach(function(f,i){ f.position.x+=Math.sin(sim.time*0.1+i)*dt*0.6; });
  if(V.pickups) V.pickups.forEach(function(g,i){ var k=sim.pickups[i]; g.visible=k.t<=0; g.rotation.y+=dt*1.6; g.children.forEach(function(c,j){ if(j<2) c.position.y=Math.sin(sim.time*2)*0.08; }); });
};
VP.render=function(){ if(this.composer) this.composer.render(); else this.renderer.render(this.scene,this.camera); };
function Sim_angDiff(a,b){ var d=b-a; while(d>Math.PI) d-=2*Math.PI; while(d<-Math.PI) d+=2*Math.PI; return d; }
View.buildCharacter=buildCharacter; View.buildMini=buildMini; View.TEAM_COL=TEAM_COL;
root.VGView=View;
})(window);
