/* VIBE HEROES simulation: pure game rules, no graphics, no DOM.
   The same file can run in the browser, in Node tests, and later on a server. */
(function(root){
'use strict';
var MODES={
  ctf:{id:'ctf',name:'Capture 3 Flags',teams:true,teamSize:5,flags:true,captureLimit:3,scoreLimit:999,timeLimit:720,respawnTime:5,spawnProtect:2},
  tdm:{id:'tdm',name:'Team Deathmatch',teams:true,teamSize:5,scoreLimit:50,timeLimit:480,respawnTime:5,spawnProtect:2},
  ffa:{id:'ffa',name:'Free For All',teams:false,teamSize:8,scoreLimit:20,timeLimit:480,respawnTime:4,spawnProtect:2}
};
var DIFF={easy:{react:0.65,err:0.13,turn:4,burst:0.45,head:0.05},normal:{react:0.4,err:0.08,turn:6.5,burst:0.65,head:0.15},hard:{react:0.22,err:0.04,turn:10,burst:0.85,head:0.35}};
var P={r:0.35,h:1.75,hc:1.2,eye:1.6,eyeC:1.05,walk:5.2,sprint:7.4,crouch:2.8,jump:6.4,grav:20,step:0.5,miniR:0.25,miniH:0.5,mini:6.2};
function clamp(v,a,b){ return v<a?a:v>b?b:v; }
function len2(x,z){ return Math.sqrt(x*x+z*z); }
function angDiff(a,b){ var d=b-a; while(d>Math.PI) d-=2*Math.PI; while(d<-Math.PI) d+=2*Math.PI; return d; }
function rng(seed){ var s=seed>>>0||1; return function(){ s^=s<<13; s^=s>>>17; s^=s<<5; return (s>>>0)/4294967296; }; }

function Sim(opts){
  var S=this; S.map=opts.map; S.weapons=opts.weapons.weapons; S.chars=opts.chars; S.mode=Object.assign({},MODES[opts.mode||'tdm'],opts.modeOverrides||{});
  S.rand=rng(opts.seed||Date.now()); S.time=0; S.events=[]; S.players=[]; S.score={A:0,B:0}; S.over=false; S.winner=null; S.timeLeft=S.mode.timeLimit;
  S.boxes=S.map.boxes.map(function(b){ return {min:b.min,max:b.max}; });
  S.projectiles=[]; S.turrets=[]; S.captures={A:0,B:0}; S.flags=[]; S.racks=[];
  var bases=S.map.bases||{}; ['A','B'].forEach(function(t){ var B=bases[t]; if(!B) return;
    if(S.mode.flags) B.flags.forEach(function(f,i){ S.flags.push({id:t+i,team:t,home:[f[0],f[1]],x:f[0],z:f[1],state:'home',carrier:null,dropT:0}); });
    (B.racks||[]).forEach(function(r){ S.racks.push({team:t,weapon:r.weapon,x:r.pos[0],z:r.pos[1]}); }); });
  S.pickups=(S.map.pickups||[]).map(function(p,i){ return {id:i,type:p.type,x:p.pos[0],z:p.pos[1],t:0}; });
  S.buildNav();
  S.flags.forEach(function(f){ f.y=S.heightAt(f.x,f.z); }); S.racks.forEach(function(r){ r.y=S.heightAt(r.x,r.z); });
}
var SP=Sim.prototype;
SP.emit=function(e){ this.events.push(e); };
SP.drain=function(){ var e=this.events; this.events=[]; return e; };
/* ---------- players ---------- */
SP.addPlayer=function(o){
  var ch=this.chars[o.charId]; var p={id:o.id,name:o.name,team:o.team||'A',charId:o.charId,isBot:!!o.isBot,diff:DIFF[o.difficulty||'normal'],
    x:0,y:0,z:0,vx:0,vy:0,vz:0,yaw:0,pitch:0,crouch:false,onGround:true,hp:100,armor:0,state:'alive',miniT:0,prot:0,
    loadout:(ch&&ch.loadout)||['rifle','pistol','bat'],preferred:(ch&&ch.preferred)||'rifle',ability:(ch&&ch.ability)||{id:'shield',duration:12},charge:0,abilityT:0,shieldHp:0,flag:null,captures:0,
    weapons:[],wi:0,fireCd:0,reloadT:0,switchT:0,spreadKick:0,kills:0,deaths:0,dmgBy:{},
    input:{mx:0,mz:0,yaw:0,pitch:0},brain:o.isBot?{}:null};
  this.players.push(p); this.respawn(p,true); return p;
};
SP.giveLoadout=function(p){ var W=this.weapons; p.weapons=p.loadout.map(function(id){ if(!id) return null; var w=W[id]; return {id:id,mag:w.mag||0,reserve:w.reserve||0}; }); p.wi=p.weapons[0]?0:1; p.reloadT=0; p.fireCd=0; p.switchT=0; };
SP.takeWeapon=function(p,id){ var w=this.weapons[id]; if(!w||w.slot!=='primary') return false; p.weapons[0]={id:id,mag:w.mag,reserve:w.reserve}; p.wi=0; p.reloadT=0; p.switchT=0.35; this.emit({type:'armory',id:p.id,weapon:id}); return true; };
SP.rackNear=function(p){ var best=null,bd=1.7; this.racks.forEach(function(r){ if(r.team!==p.team) return; var d=len2(r.x-p.x,r.z-p.z); if(d<bd){ bd=d; best=r; } }); return best; };
SP.has=function(p,id){ return p.abilityT>0&&p.ability.id===id; };
SP.enemiesOf=function(p){ var m=this.mode; return this.players.filter(function(q){ return q!==p&&(m.teams?q.team!==p.team:true); }); };
SP.respawn=function(p,first){
  var S=this, pts=S.mode.teams?S.map.spawns[p.team]:S.map.spawns.A.concat(S.map.spawns.B), enemies=S.enemiesOf(p).filter(function(q){ return q.state==='alive'; });
  var best=null,bs=-1e9; if(S.map.bases&&S.mode.teams) pts=S.map.bases[p.team].spawns;
  pts.forEach(function(sp){ var x=sp[0],z=sp[1]; if(S.blocked(x,S.heightAt(x,z),z,P.r,P.h)) return;
    var near=S.players.some(function(q){ return q!==p&&q.state!=='dead'&&len2(q.x-x,q.z-z)<1.2; }); if(near) return;
    var md=60; enemies.forEach(function(e){ md=Math.min(md,len2(e.x-x,e.z-z)); });
    var seen=enemies.some(function(e){ return S.los(e.x,e.y+P.eye,e.z,x,1.5,z); });
    var sc=md-(seen?40:0)+S.rand()*3; if(sc>bs){ bs=sc; best=sp; } });
  best=best||pts[Math.floor(S.rand()*pts.length)];
  p.x=best[0]; p.z=best[1]; p.y=S.heightAt(best[0],best[1]); p.vx=p.vy=p.vz=0; p.state='alive'; p.hp=100; p.armor=50; p.crouch=false; p.dmgBy={}; p.abilityT=0; p.shieldHp=0; p.flag=null;
  p.yaw=p.team==='A'?-Math.PI/2:Math.PI/2; p.pitch=0; p.prot=first?0:S.mode.spawnProtect; S.giveLoadout(p);
  if(p.brain){ p.brain={}; }
  if(!first) S.emit({type:'respawn',id:p.id,x:p.x,z:p.z});
};
/* ---------- collision ---------- */
SP.blocked=function(x,y,z,r,h){ var b=this.boxes;
  for(var i=0;i<b.length;i++){ var m=b[i]; if(x+r>m.min[0]&&x-r<m.max[0]&&z+r>m.min[2]&&z-r<m.max[2]&&y+h>m.min[1]+0.001&&y<m.max[1]-0.001) return m; } return null; };
SP.groundAt=function(x,y,z,r){ var g=0,b=this.boxes; for(var i=0;i<b.length;i++){ var m=b[i]; if(x+r>m.min[0]&&x-r<m.max[0]&&z+r>m.min[2]&&z-r<m.max[2]&&m.max[1]<=y+0.05&&m.max[1]>g) g=m.max[1]; } return g; };
SP.moveBody=function(p,dx,dz,dt){
  var mini=p.state==='mini', r=mini?P.miniR:P.r, h=mini?P.miniH:(p.crouch?P.hc:P.h), S=this;
  function tryAxis(ax,d){ if(!d) return; var nx=p.x+(ax==='x'?d:0), nz=p.z+(ax==='z'?d:0);
    if(!S.blocked(nx,p.y,nz,r,h)){ p.x=nx; p.z=nz; return; }
    if(p.onGround&&!S.blocked(nx,p.y+P.step,nz,r,h)){ var g=S.groundAt(nx,p.y+P.step,nz,r); if(g-p.y<=P.step+0.01){ p.x=nx; p.z=nz; p.y=g; return; } }
    if(ax==='x') p.vx=0; else p.vz=0; }
  tryAxis('x',dx); tryAxis('z',dz);
  // vertical
  p.vy-=P.grav*dt; var ny=p.y+p.vy*dt, g=S.groundAt(p.x,p.y+0.01,p.z,r);
  if(p.vy>0&&S.blocked(p.x,ny,p.z,r,h)){ p.vy=0; ny=p.y; }
  if(ny<=g){ ny=g; p.vy=0; p.onGround=true; } else p.onGround=false;
  p.y=ny;
};
/* ---------- rays ---------- */
function rayBox(ox,oy,oz,dx,dy,dz,mn,mx,maxT){
  var t0=0,t1=maxT, o=[ox,oy,oz], d=[dx,dy,dz];
  for(var i=0;i<3;i++){ if(Math.abs(d[i])<1e-9){ if(o[i]<mn[i]||o[i]>mx[i]) return -1; continue; }
    var a=(mn[i]-o[i])/d[i], b=(mx[i]-o[i])/d[i]; if(a>b){ var t=a; a=b; b=t; } if(a>t0) t0=a; if(b<t1) t1=b; if(t0>t1) return -1; }
  return t0; }
SP.rayWorld=function(ox,oy,oz,dx,dy,dz,maxT){ var best=maxT, hit=null, b=this.boxes;
  for(var i=0;i<b.length;i++){ var t=rayBox(ox,oy,oz,dx,dy,dz,b[i].min,b[i].max,best); if(t>=0&&t<best){ best=t; hit=b[i]; } }
  if(dy<0){ var tf=-oy/dy; if(tf>=0&&tf<best){ best=tf; hit={floor:true}; } }
  return {t:best,box:hit}; };
SP.los=function(ax,ay,az,bx,by,bz){ var dx=bx-ax,dy=by-ay,dz=bz-az,L=Math.sqrt(dx*dx+dy*dy+dz*dz); if(L<1e-6) return true; var r=this.rayWorld(ax,ay,az,dx/L,dy/L,dz/L,L); return r.t>=L-0.05; };
SP.hitboxes=function(q){ var h=q.crouch?P.hc:P.h, hr=0.27;
  return {body:{min:[q.x-P.r,q.y,q.z-P.r],max:[q.x+P.r,q.y+h-0.42,q.z+P.r]},head:{min:[q.x-hr,q.y+h-0.42,q.z-hr],max:[q.x+hr,q.y+h+0.04,q.z+hr]}}; };
SP.eye=function(p){ return p.y+(p.crouch?P.eyeC:P.eye); };
SP.aimDir=function(yaw,pitch){ var c=Math.cos(pitch); return [-Math.sin(yaw)*c,Math.sin(pitch),-Math.cos(yaw)*c]; };
/* ---------- combat ---------- */
SP.curWeapon=function(p){ var s=p.weapons[p.wi]; if(!s){ p.wi=1; s=p.weapons[1]; } return {slot:s,def:this.weapons[s.id]}; };
SP.fire=function(p){
  var S=this, cw=S.curWeapon(p), w=cw.def, s=cw.slot;
  if(p.fireCd>0||p.reloadT>0||p.switchT>0) return false;
  if(!w.melee&&s.mag<=0){ S.startReload(p); return false; }
  var rate=w.rate; if(S.has(p,'endless')||S.has(p,'overclock')) rate/=1.35; p.fireCd=rate; p.prot=0; if(!w.melee&&!S.has(p,'endless')) s.mag--;
  var ex=p.x, ey=S.eye(p), ez=p.z, moving=len2(p.vx,p.vz)>0.5||!p.onGround;
  var spread=(p.input.aim?w.adsSpread||w.spread:w.spread)+(moving?w.moveSpread||0:0)+p.spreadKick;
  if(p.crouch) spread*=0.7;
  var shots=[], n=w.pellets||1, range=w.range||100;
  if(w.projectile){ var dd=S.aimDir(p.yaw,p.pitch); S.projectiles.push({x:ex+dd[0]*0.8,y:ey-0.15+dd[1]*0.8,z:ez+dd[2]*0.8,vx:dd[0]*w.projectile.speed,vy:dd[1]*w.projectile.speed,vz:dd[2]*w.projectile.speed,owner:p.id,team:p.team,dmg:w.damage,radius:w.projectile.radius,t:6,kind:'rocket',grav:2});
    S.emit({type:'shot',id:p.id,weapon:s.id,from:[ex,ey,ez],hits:[],rocket:true}); if(s.mag<=0&&s.reserve>0) S.startReload(p); return true; }
  for(var k=0;k<n;k++){
    var yaw=p.yaw+(S.rand()-0.5)*2*spread, pitch=p.pitch+(S.rand()-0.5)*2*spread, d=S.aimDir(yaw,pitch);
    var wr=S.rayWorld(ex,ey,ez,d[0],d[1],d[2],range), best=wr.t, tgt=null, head=false;
    S.players.forEach(function(q){ if(q===p||q.state!=='alive') return; if(S.mode.teams&&q.team===p.team) return;
      var hb=S.hitboxes(q), th=rayBox(ex,ey,ez,d[0],d[1],d[2],hb.head.min,hb.head.max,best), tb=rayBox(ex,ey,ez,d[0],d[1],d[2],hb.body.min,hb.body.max,best);
      if(th>=0&&th<best&&(tb<0||th<=tb)){ best=th; tgt=q; head=true; } else if(tb>=0&&tb<best){ best=tb; tgt=q; head=false; } });
    var hx=ex+d[0]*best, hy=ey+d[1]*best, hz=ez+d[2]*best;
    if(tgt){ var dmg=w.damage*(head?w.headMult:1); if(!w.melee&&best>range*0.6) dmg*=0.8; S.damage(tgt,dmg*S.dmgMult(p),p,head,s.id); }
    shots.push({x:hx,y:hy,z:hz,hit:tgt?tgt.id:null,head:head,wall:!tgt&&best<range});
  }
  p.spreadKick=Math.min(0.06,p.spreadKick+(w.recoil||0)*0.6);
  S.emit({type:w.melee?'melee':'shot',id:p.id,weapon:s.id,from:[ex,ey,ez],hits:shots});
  if(!w.melee&&s.mag<=0&&s.reserve>0) S.startReload(p);
  return true;
};
SP.dmgMult=function(p){ return this.has(p,'rampage')?1.5:this.has(p,'vision')?1.25:1; };
SP.startReload=function(p){ var cw=this.curWeapon(p); if(this.has(p,'endless')) return; if(cw.def.melee||p.reloadT>0||cw.slot.mag>=cw.def.mag||cw.slot.reserve<=0) return; p.reloadT=cw.def.reload; this.emit({type:'reload',id:p.id}); };
SP.switchWeapon=function(p,i){ if(i<0||i>=p.weapons.length||i===p.wi||!p.weapons[i]) return; p.wi=i; p.reloadT=0; p.switchT=0.35; p.fireCd=Math.max(p.fireCd,0.1); this.emit({type:'switch',id:p.id,weapon:p.weapons[i].id}); };
SP.damage=function(q,dmg,from,head,wid){
  if(q.state!=='alive'||q.prot>0) return;
  if(this.has(q,'rampage')) dmg*=0.7;
  if(q.shieldHp>0&&q.abilityT>0){ var ab=Math.min(q.shieldHp,dmg); q.shieldHp-=ab; dmg-=ab; this.emit({type:'shieldHit',id:q.id}); if(q.shieldHp<=0) q.abilityT=0; if(dmg<=0) return; }
  var a=Math.min(q.armor,dmg*0.5); q.armor-=a; dmg-=a; q.hp-=dmg; q.dmgBy[from.id]=(q.dmgBy[from.id]||0)+dmg+a;
  if(q.brain){ q.brain.hurtBy=from.id; q.brain.hurtT=this.time; }
  this.emit({type:'hit',id:q.id,by:from.id,dmg:Math.round(dmg+a),head:head,x:q.x,y:q.y,z:q.z});
  if(q.hp<=0) this.kill(q,from,head,wid);
};
SP.kill=function(q,from,head,wid){
  var S=this; q.hp=0; q.deaths++; q.state='mini'; q.miniT=S.mode.respawnTime; q.vx=q.vz=0; q.crouch=false;
  if(from&&from!==q){ from.kills++; if(S.mode.teams) S.score[from.team]++; if(from.abilityT<=0) from.charge=Math.min(100,from.charge+34); }
  if(q.flag){ var fl=S.flags.filter(function(f){ return f.id===q.flag; })[0]; if(fl){ fl.state='dropped'; fl.carrier=null; fl.x=q.x; fl.z=q.z; fl.y=S.heightAt(q.x,q.z); fl.dropT=20; S.emit({type:'flagDrop',flag:fl.id,team:fl.team,x:q.x,z:q.z}); } q.flag=null; }
  q.abilityT=0; q.shieldHp=0;
  S.emit({type:'kill',killer:from?from.id:null,victim:q.id,weapon:wid,head:!!head,x:q.x,y:q.y,z:q.z});
  S.emit({type:'transform',id:q.id,x:q.x,y:q.y,z:q.z});
  S.checkEnd();
};
SP.checkEnd=function(){ var S=this; if(S.over) return; var m=S.mode;
  if(m.flags){ if(S.captures.A>=m.captureLimit||S.captures.B>=m.captureLimit||S.timeLeft<=0){ S.over=true; S.winner=S.captures.A===S.captures.B?(S.score.A===S.score.B?'draw':(S.score.A>S.score.B?'A':'B')):(S.captures.A>S.captures.B?'A':'B'); } }
  else if(m.teams){ if(S.score.A>=m.scoreLimit||S.score.B>=m.scoreLimit||S.timeLeft<=0){ S.over=true; S.winner=S.score.A===S.score.B?'draw':(S.score.A>S.score.B?'A':'B'); } }
  else { var top=S.players.slice().sort(function(a,b){ return b.kills-a.kills; })[0]; if((top&&top.kills>=m.scoreLimit)||S.timeLeft<=0){ S.over=true; S.winner=top?top.id:null; } }
  if(S.over) S.emit({type:'matchEnd',winner:S.winner});
};
/* ---------- tick ---------- */
SP.byId=function(id){ for(var i=0;i<this.players.length;i++) if(this.players[i].id===id) return this.players[i]; return null; };
SP.step=function(dt){
  var S=this; if(S.over) return; S.time+=dt; S.timeLeft=Math.max(0,S.timeLeft-dt); if(S.timeLeft<=0) S.checkEnd();
  S.players.forEach(function(p){ if(p.isBot) S.botThink(p,dt); S.applyInput(p,dt); });
  S.pickups.forEach(function(k){ if(k.t>0){ k.t-=dt; return; }
    if(k.y==null) k.y=S.heightAt(k.x,k.z);
    S.players.forEach(function(p){ if(k.t>0||p.state!=='alive') return; if(len2(p.x-k.x,p.z-k.z)<0.9&&Math.abs(p.y-k.y)<1.2){
      if(k.type==='health'&&p.hp<100){ p.hp=Math.min(100,p.hp+50); k.t=20; S.emit({type:'pickup',id:p.id,kind:'health',pickup:k.id}); }
      else if(k.type==='armor'&&p.armor<100){ p.armor=Math.min(100,p.armor+50); k.t=20; S.emit({type:'pickup',id:p.id,kind:'armor',pickup:k.id}); } } }); });
  S.stepStrikes(dt); S.stepProjectiles(dt); S.stepTurrets(dt); if(S.mode.flags) S.stepFlags(dt);
};
SP.stepStrikes=function(dt){ var S=this; S.strikes=(S.strikes||[]).filter(function(k){ k.t-=dt; if(k.t<=0&&k.n>0){ k.n--; k.t=0.42; var a=S.rand()*6.28, r=S.rand()*4.5;
  S.projectiles.push({x:k.x+Math.cos(a)*r+3,y:45,z:k.z+Math.sin(a)*r,vx:-4,vy:-48,vz:0,owner:k.owner,team:k.team,dmg:95,radius:4.2,t:3,kind:'missile',grav:0}); } return k.n>0; }); };
SP.stepProjectiles=function(dt){
  var S=this;
  S.projectiles=S.projectiles.filter(function(pr){ pr.t-=dt; pr.vy-=(pr.grav||0)*dt;
    var dx=pr.vx*dt, dy=pr.vy*dt, dz=pr.vz*dt, L=Math.sqrt(dx*dx+dy*dy+dz*dz), hit=null;
    var wr=S.rayWorld(pr.x,pr.y,pr.z,dx/L,dy/L,dz/L,L); if(wr.box) hit=[pr.x+dx/L*wr.t,pr.y+dy/L*wr.t,pr.z+dz/L*wr.t];
    if(!hit) S.players.forEach(function(q){ if(hit||q.state!=='alive'||q.team===pr.team||q.id===pr.owner) return; var cy=q.y+0.9; if(Math.abs(pr.x+dx-q.x)<0.6&&Math.abs(pr.z+dz-q.z)<0.6&&Math.abs(pr.y+dy-cy)<1) hit=[pr.x+dx,pr.y+dy,pr.z+dz]; });
    if(!hit&&pr.t<=0) hit=[pr.x,pr.y,pr.z];
    if(hit){ S.explode(hit[0],hit[1],hit[2],pr); return false; }
    pr.x+=dx; pr.y+=dy; pr.z+=dz; return true; });
};
SP.explode=function(x,y,z,pr){
  var S=this, owner=S.byId(pr.owner);
  S.players.forEach(function(q){ if(q.state!=='alive') return; var self=q.id===pr.owner; if(!self&&q.team===pr.team&&S.mode.teams) return;
    var d=Math.sqrt((q.x-x)*(q.x-x)+(q.y+0.9-y)*(q.y+0.9-y)+(q.z-z)*(q.z-z)); if(d>pr.radius) return;
    if(!S.los(x,y+0.3,z,q.x,q.y+0.9,q.z)&&d>1.2) return;
    var dmg=pr.dmg*Math.pow(1-d/pr.radius,0.6)*(self?0.4:1)*(owner?S.dmgMult(owner):1); if(dmg>1) S.damage(q,dmg,owner||q,false,pr.kind==='missile'?'missiles':'launcher'); });
  S.emit({type:'explode',x:x,y:y,z:z,r:pr.radius,kind:pr.kind});
};
SP.stepTurrets=function(dt){
  var S=this;
  S.turrets=S.turrets.filter(function(t){ t.t-=dt; t.cd-=dt; if(t.t<=0){ S.emit({type:'turretGone',id:t.id}); return false; }
    if(t.cd<=0){ var owner=S.byId(t.owner), best=null, bd=32;
      S.players.forEach(function(q){ if(q.state!=='alive'||q.team===t.team) return; var d=len2(q.x-t.x,q.z-t.z); if(d<bd&&S.los(t.x,t.y+1.3,t.z,q.x,q.y+1.1,q.z)){ bd=d; best=q; } });
      if(best){ t.cd=0.13; t.yaw=Math.atan2(-(best.x-t.x),-(best.z-t.z)); var miss=S.rand()<0.25; if(!miss&&owner) S.damage(best,9,owner,false,'turret');
        S.emit({type:'turretShot',id:t.id,from:[t.x,t.y+1.3,t.z],to:[best.x+(miss?(S.rand()-0.5):0),best.y+1.1,best.z+(miss?(S.rand()-0.5):0)]}); } else t.cd=0.25; }
    return true; });
};
SP.stepFlags=function(dt){
  var S=this, bases=S.map.bases;
  S.flags.forEach(function(f){
    if(f.state==='captured') return;
    if(f.state==='carried'){ var c=S.byId(f.carrier); if(!c||c.state!=='alive'){ f.state='dropped'; f.carrier=null; f.dropT=20; return; }
      f.x=c.x; f.z=c.z; f.y=c.y; var cap=bases[c.team].capture;
      if(len2(c.x-cap[0],c.z-cap[1])<cap[2]){ f.state='captured'; f.carrier=null; c.flag=null; c.captures++; S.captures[c.team]++; c.charge=Math.min(100,c.charge+50);
        S.emit({type:'capture',flag:f.id,team:c.team,id:c.id}); S.checkEnd(); }
      return; }
    if(f.state==='dropped'){ f.dropT-=dt; if(f.dropT<=0){ f.state='home'; f.x=f.home[0]; f.z=f.home[1]; f.y=S.heightAt(f.x,f.z); S.emit({type:'flagReturn',flag:f.id,team:f.team}); return; } }
    S.players.forEach(function(p){ if(p.state!=='alive'||f.state==='carried'||f.state==='captured') return; if(len2(p.x-f.x,p.z-f.z)>1.3) return;
      if(p.team!==f.team&&!p.flag){ f.state='carried'; f.carrier=p.id; p.flag=f.id; p.charge=Math.min(100,p.charge+15); S.emit({type:'flagTake',flag:f.id,team:f.team,id:p.id}); }
      else if(p.team===f.team&&f.state==='dropped'){ f.state='home'; f.x=f.home[0]; f.z=f.home[1]; f.y=S.heightAt(f.x,f.z); S.emit({type:'flagReturn',flag:f.id,team:f.team,id:p.id}); } });
  });
};
SP.activate=function(p){
  var S=this; if(p.state!=='alive'||p.charge<100||p.abilityT>0) return false;
  var ab=p.ability; p.charge=0; p.abilityT=ab.duration||12;
  if(ab.id==='shield') p.shieldHp=250;
  if(ab.id==='missiles'){ var d=S.aimDir(p.yaw,Math.min(p.pitch,-0.02)), ey=S.eye(p), r=S.rayWorld(p.x,ey,p.z,d[0],d[1],d[2],90), t=Math.min(r.t,90); (S.strikes=S.strikes||[]).push({x:p.x+d[0]*t,z:p.z+d[2]*t,team:p.team,owner:p.id,n:7,t:0.6}); }
  if(ab.id==='turret'){ var fx=p.x-Math.sin(p.yaw)*1.2, fz=p.z-Math.cos(p.yaw)*1.2; if(S.blocked(fx,0,fz,0.4,1.2)){ fx=p.x; fz=p.z; } S.turrets.push({id:'t'+p.id+S.time.toFixed(2),x:fx,z:fz,y:S.heightAt(fx,fz),team:p.team,owner:p.id,t:ab.duration||15,cd:0.4,yaw:p.yaw}); }
  S.emit({type:'ability',id:p.id,ability:ab.id,x:p.x,z:p.z});
  return true;
};
SP.applyInput=function(p,dt){
  var S=this, I=p.input;
  if(p.state==='mini'){ p.miniT-=dt; if(p.miniT<=0){ S.respawn(p,false); return; } }
  else { if(p.abilityT>0){ p.abilityT-=dt; if(p.ability.id==='feast'){ S.players.forEach(function(q){ if(q.state==='alive'&&q.team===p.team&&len2(q.x-p.x,q.z-p.z)<7) q.hp=Math.min(100,q.hp+12*dt); }); } if(p.abilityT<=0){ p.shieldHp=0; S.emit({type:'abilityEnd',id:p.id}); } }
    else p.charge=Math.min(100,p.charge+dt*0.45);
    if(I.ability){ I.ability=false; S.activate(p); }
    if(I.use){ I.use=false; var rk=S.rackNear(p); if(rk) S.takeWeapon(p,rk.weapon); } }
  p.yaw=I.yaw; p.pitch=clamp(I.pitch,-1.45,1.45);
  if(p.fireCd>0) p.fireCd-=dt; if(p.switchT>0) p.switchT-=dt; if(p.prot>0) p.prot-=dt; p.spreadKick=Math.max(0,p.spreadKick-dt*0.12);
  if(p.reloadT>0){ p.reloadT-=dt; if(p.reloadT<=0){ var cw=S.curWeapon(p), need=cw.def.mag-cw.slot.mag, take=Math.min(need,cw.slot.reserve); cw.slot.mag+=take; cw.slot.reserve-=take; S.emit({type:'reloaded',id:p.id}); } }
  var mini=p.state==='mini';
  p.crouch=!mini&&!!I.crouch&&p.onGround||(p.crouch&&!mini&&S.blocked(p.x,p.y,p.z,P.r,P.h)!==null);
  var sp=mini?P.mini:(p.crouch?P.crouch:(I.sprint&&I.mz>0.1&&!I.fire&&!I.aim?P.sprint:P.walk)); if(I.aim&&!mini) sp*=0.75;
  if(!mini&&S.has(p,'overclock')) sp*=1.4;
  var fx=-Math.sin(p.yaw), fz=-Math.cos(p.yaw), rx=Math.cos(p.yaw), rz=-Math.sin(p.yaw);
  var wx=fx*I.mz+rx*I.mx, wz=fz*I.mz+rz*I.mx, L=len2(wx,wz); if(L>1){ wx/=L; wz/=L; }
  var acc=p.onGround?14:4; p.vx+=(wx*sp-p.vx)*Math.min(1,acc*dt); p.vz+=(wz*sp-p.vz)*Math.min(1,acc*dt);
  if(I.jump&&p.onGround&&!p.crouch){ p.vy=mini?5:P.jump; p.onGround=false; S.emit({type:'jump',id:p.id}); }
  S.moveBody(p,p.vx*dt,p.vz*dt,dt);
  if(mini) return;
  if(I.switchTo!=null){ S.switchWeapon(p,I.switchTo); I.switchTo=null; }
  if(I.reload){ S.startReload(p); I.reload=false; }
  var w=S.curWeapon(p).def;
  if(I.fire&&(w.auto||!I.fireHeld)) S.fire(p);
  I.fireHeld=!!I.fire;
};
/* ---------- navigation grid ---------- */
SP.buildNav=function(){
  var S=this, W=S.map.size[0], D=S.map.size[1], c=1, walk={}; (S.map.walkable||['crate']).forEach(function(k){ walk[k]=1; });
  S.walkTops=S.map.boxes.filter(function(b){ return walk[b.kind]; });
  S.nav={w:W/c,d:D/c,c:c,ox:-W/2,oz:-D/2,ok:[],h:[]};
  for(var j=0;j<S.nav.d;j++) for(var i=0;i<S.nav.w;i++){ var x=S.nav.ox+(i+0.5)*c, z=S.nav.oz+(j+0.5)*c, h=S.surfaceAt(x,z);
    S.nav.h.push(h); S.nav.ok.push(!S.blocked(x,h+0.85,z,P.r+0.15,P.h-0.85)&&!S.blocked(x,h,z,P.r-0.1,P.h)); }   // low steps nearby are climbable, not walls
};
SP.surfaceAt=function(x,z){ var h=0; (this.walkTops||[]).forEach(function(b){ if(x>b.min[0]&&x<b.max[0]&&z>b.min[2]&&z<b.max[2]&&b.max[1]>h) h=b.max[1]; }); return h; };
SP.heightAt=function(x,z){ var c=this.cellOf(x,z); return this.nav.h[c[1]*this.nav.w+c[0]]; };
SP.cellOf=function(x,z){ var n=this.nav; return [clamp(Math.floor((x-n.ox)/n.c),0,n.w-1),clamp(Math.floor((z-n.oz)/n.c),0,n.d-1)]; };
SP.cellPos=function(i,j){ var n=this.nav; return [n.ox+(i+0.5)*n.c,n.oz+(j+0.5)*n.c]; };
SP.walkable=function(i,j){ var n=this.nav; return i>=0&&j>=0&&i<n.w&&j<n.d&&n.ok[j*n.w+i]; };
SP.startCell=function(x,z){ var S=this, c=S.cellOf(x,z); if(S.walkable(c[0],c[1])) return c;
  for(var r=1;r<6;r++) for(var dj=-r;dj<=r;dj++) for(var di=-r;di<=r;di++){ if(Math.max(Math.abs(di),Math.abs(dj))!==r) continue; var i=c[0]+di, j=c[1]+dj; if(!S.walkable(i,j)) continue; var cp=S.cellPos(i,j);
    var ok=true, L=len2(cp[0]-x,cp[1]-z), st=Math.ceil(L/0.2), h=S.heightAt(x,z); for(var k=1;k<=st;k++){ var t=k/st; if(S.blocked(x+(cp[0]-x)*t,h+0.45,z+(cp[1]-z)*t,P.r*0.9,1.2)){ ok=false; break; } } if(ok) return [i,j]; }
  return S.nearestWalkable(x,z); };
SP.nearestWalkable=function(x,z){ var c=this.cellOf(x,z); if(this.walkable(c[0],c[1])) return c; for(var r=1;r<8;r++) for(var dj=-r;dj<=r;dj++) for(var di=-r;di<=r;di++){ if(this.walkable(c[0]+di,c[1]+dj)) return [c[0]+di,c[1]+dj]; } return c; };
SP.path=function(x0,z0,x1,z1){
  var S=this, n=S.nav, W=n.w, a=S.startCell(x0,z0), b=S.nearestWalkable(x1,z1), A=a[1]*W+a[0], Bk=b[1]*W+b[0];
  var g=new Float32Array(n.w*n.d).fill(1e9), from=new Int32Array(n.w*n.d).fill(-1), closed=new Uint8Array(n.w*n.d), heap=[];
  function h(k){ var i=k%W, j=(k/W)|0, dx=Math.abs(i-b[0]), dz=Math.abs(j-b[1]); return dx+dz-0.586*Math.min(dx,dz); }
  function push(k,f){ heap.push([f,k]); var i=heap.length-1; while(i>0){ var pa=(i-1)>>1; if(heap[pa][0]<=heap[i][0]) break; var t=heap[pa]; heap[pa]=heap[i]; heap[i]=t; i=pa; } }
  function pop(){ var top=heap[0], last=heap.pop(); if(heap.length){ heap[0]=last; var i=0; for(;;){ var l=2*i+1, r=l+1, m=i; if(l<heap.length&&heap[l][0]<heap[m][0]) m=l; if(r<heap.length&&heap[r][0]<heap[m][0]) m=r; if(m===i) break; var t=heap[m]; heap[m]=heap[i]; heap[i]=t; i=m; } } return top; }
  g[A]=0; push(A,h(A)); var found=false, guard=0;
  while(heap.length&&guard++<20000){ var k=pop()[1]; if(closed[k]) continue; closed[k]=1; if(k===Bk){ found=true; break; }
    var ci=k%W, cj=(k/W)|0;
    for(var dj=-1;dj<=1;dj++) for(var di=-1;di<=1;di++){ if(!di&&!dj) continue; var ni=ci+di, nj=cj+dj; if(!S.walkable(ni,nj)) continue;
      if(di&&dj&&(!S.walkable(ci+di,cj)||!S.walkable(ci,cj+dj))) continue; var nk=nj*W+ni; if(closed[nk]) continue;
      if(n.h[nk]-n.h[k]>0.85) continue;
      var ng=g[k]+(di&&dj?1.414:1); if(ng<g[nk]){ g[nk]=ng; from[nk]=k; push(nk,ng+h(nk)); } } }
  if(!found&&A!==Bk) return null;
  var out=[], kk=Bk; while(kk!==-1&&kk!==A){ out.unshift(S.cellPos(kk%W,(kk/W)|0)); kk=from[kk]; }
  var sm=[], px=x0, pz=z0; for(var q=0;q<out.length;q++){ var nxt=out[q+1]; if(nxt&&S.clearWalk(px,pz,nxt[0],nxt[1])) continue; sm.push(out[q]); px=out[q][0]; pz=out[q][1]; }
  return sm;
};
SP.clearWalk=function(x0,z0,x1,z1){ var S=this, n=S.nav, L=len2(x1-x0,z1-z0), steps=Math.max(1,Math.ceil(L/0.25)), prev=S.heightAt(x0,z0);
  for(var k=1;k<=steps;k++){ var t=k/steps, x=x0+(x1-x0)*t, z=z0+(z1-z0)*t, c=S.cellOf(x,z); if(!S.walkable(c[0],c[1])) return false; var h=n.h[c[1]*n.w+c[0]]; if(Math.abs(h-prev)>0.45) return false;
    if(S.blocked(x,h+0.45,z,P.r+0.1,1.2)) return false; prev=h; }
  return true; };
SP.botRole=function(p){ var B=p.brain; if(B.role) return B.role; var mates=this.players.filter(function(q){ return q.team===p.team&&q.isBot; }), i=mates.indexOf(p);
  B.role=['attack','defend','attack','escort','defend'][i%5]; return B.role; };
SP.botGoal=function(p){
  var S=this, B=p.brain, bases=S.map.bases, role=S.botRole(p), mine=bases&&bases[p.team];
  if(mine&&!p.weapons[0]){ var r=S.racks.filter(function(k){ return k.team===p.team&&k.weapon===p.preferred; })[0]||S.racks.filter(function(k){ return k.team===p.team; })[0]; if(r) return {x:r.x,z:r.z,kind:'armory',rack:r}; }
  if(p.hp<45){ var hk=S.pickups.filter(function(k){ return k.type==='health'&&k.t<=0; }).sort(function(a,b){ return len2(a.x-p.x,a.z-p.z)-len2(b.x-p.x,b.z-p.z); })[0]; if(hk&&len2(hk.x-p.x,hk.z-p.z)<25) return {x:hk.x,z:hk.z,kind:'heal'}; }
  if(S.mode.flags&&mine){
    if(p.flag) return {x:mine.capture[0],z:mine.capture[1],kind:'carry'};
    var stolen=S.flags.filter(function(f){ return f.team===p.team&&f.state==='carried'; }).map(function(f){ return S.byId(f.carrier); }).filter(Boolean)[0];
    if(stolen&&(role!=='attack'||len2(stolen.x-p.x,stolen.z-p.z)<25)) return {x:stolen.x,z:stolen.z,kind:'chase',target:stolen.id};
    var dropped=S.flags.filter(function(f){ return f.team===p.team&&f.state==='dropped'; }).sort(function(a,b){ return len2(a.x-p.x,a.z-p.z)-len2(b.x-p.x,b.z-p.z); })[0];
    if(dropped&&(role==='defend'||len2(dropped.x-p.x,dropped.z-p.z)<20)) return {x:dropped.x,z:dropped.z,kind:'return'};
    if(role==='escort'){ var mate=S.players.filter(function(q){ return q.team===p.team&&q.flag&&q!==p; })[0]; if(mate) return {x:mate.x,z:mate.z,kind:'escort'}; }
    if(role==='attack'||role==='escort'){ var ef=S.flags.filter(function(f){ return f.team!==p.team&&(f.state==='home'||f.state==='dropped'); }).sort(function(a,b){ return len2(a.x-p.x,a.z-p.z)-len2(b.x-p.x,b.z-p.z); });
      if(ef.length){ var pick=ef[B.flagPick=(B.flagPick==null?Math.floor(S.rand()*ef.length):B.flagPick)%ef.length]; return {x:pick.x,z:pick.z,kind:'flag'}; } }
    if(role==='defend'){ var own=S.flags.filter(function(f){ return f.team===p.team&&f.state==='home'; }); if(own.length){ if(!B.guard||S.rand()<0.004) B.guard=own[Math.floor(S.rand()*own.length)].id; var gf=S.flags.filter(function(f){ return f.id===B.guard; })[0]||own[0]; var a=S.rand()*6.28;
      return {x:gf.x+Math.cos(a)*(3+S.rand()*4),z:gf.z+Math.sin(a)*(3+S.rand()*4),kind:'guard'}; } }
  }
  if(B.lastSeen&&S.time-B.lastSeenT<6) return {x:B.lastSeen[0],z:B.lastSeen[1],kind:'hunt'};
  var side=S.mode.teams?(p.team==='A'?1:-1):(S.rand()<0.5?1:-1), W=S.map.size[0]/2, Dz=S.map.size[1]/2;
  return {x:side*(S.rand()*W*0.7),z:(S.rand()-0.5)*2*Dz*0.8,kind:'roam'};
};
SP.botThink=function(p,dt){
  var S=this, B=p.brain, I=p.input, d=p.diff;
  I.mx=0; I.mz=0; I.fire=false; I.aim=false; I.jump=false; I.sprint=false; I.crouch=false;
  if(I.yaw==null) I.yaw=p.yaw;
  B.seeT=(B.seeT||0)-dt; B.pathT=(B.pathT||0)-dt; B.strafeT=(B.strafeT||0)-dt;
  if(p.state==='mini'){ if(B.pathT<=0){ var a0=S.rand()*6.28; B.path=S.path(p.x,p.z,p.x+Math.cos(a0)*6,p.z+Math.sin(a0)*6)||[]; B.pathT=3; } S.botFollow(p,dt,false); return; }
  // objective first: it decides where we walk
  if(B.pathT<=0||!B.path||!B.path.length||(B.goal&&(B.goal.kind==='chase'||B.goal.kind==='escort')&&B.pathT<2.5)){
    B.goal=S.botGoal(p); B.pathT=B.goal&&(B.goal.kind==='chase'||B.goal.kind==='escort')?3:4+S.rand()*2; B.path=B.goal?(S.path(p.x,p.z,B.goal.x,B.goal.z)||[[B.goal.x,B.goal.z]]):[]; }
  if(B.goal&&B.goal.kind==='armory'&&len2(B.goal.x-p.x,B.goal.z-p.z)<1.7){ S.takeWeapon(p,B.goal.rack.weapon); B.path=[]; B.pathT=0; }
  // perception (carriers of our flags are spotted from further and through the field of view)
  if(B.seeT<=0){ B.seeT=0.15; var best=null,bd=1e9;
    S.enemiesOf(p).forEach(function(e){ if(e.state!=='alive') return; var dx=e.x-p.x, dz=e.z-p.z, dist=len2(dx,dz); if(dist>75) return;
      var ang=Math.abs(angDiff(p.yaw,Math.atan2(-dx,-dz))); if(dist>9&&ang>1.15&&B.hurtBy!==e.id&&!e.flag) return;
      if(!S.los(p.x,S.eye(p),p.z,e.x,S.eye(e),e.z)) return; var sc=dist-(e.flag?30:0); if(sc<bd){ bd=sc; best=e; } });
    if(best){ if(B.target!==best.id){ B.target=best.id; B.acquireT=S.time; } B.lastSeen=[best.x,best.z]; B.lastSeenT=S.time; }
    else if(B.target&&S.time-(B.lastSeenT||0)>0.4) B.target=null; }
  var tgt=B.target&&S.byId(B.target); if(tgt&&tgt.state!=='alive'){ tgt=null; B.target=null; }
  var cw=S.curWeapon(p), w=cw.def;
  if(p.weapons[0]&&p.wi!==0&&p.weapons[0].mag+p.weapons[0].reserve>0) I.switchTo=0;
  if(!w.melee&&cw.slot.mag<=0&&cw.slot.reserve<=0&&!S.has(p,'endless')) I.switchTo=p.wi===0?1:2;
  var pushing=B.goal&&(B.goal.kind==='carry'||B.goal.kind==='flag'||B.goal.kind==='chase'||B.goal.kind==='return'||B.goal.kind==='armory');
  if(tgt){
    if(B.aimHeadFor!==tgt.id){ B.aimHeadFor=tgt.id; B.aimHead=S.rand()<d.head; }
    var tx=tgt.x-p.x, tz=tgt.z-p.z, dist=len2(tx,tz), ty=(S.eye(tgt)-(B.aimHead?0.15:0.65))-S.eye(p);
    var since=S.time-(B.acquireT||0), err=d.err*Math.max(0.25,1-since/1.6)*(1+dist/40);
    if(!B.errA||S.rand()<dt*2){ B.errA=[(S.rand()-0.5)*2*err,(S.rand()-0.5)*2*err*0.6]; }
    var wantYaw=Math.atan2(-tx,-tz)+B.errA[0], wantPitch=Math.atan2(ty,dist)+B.errA[1];
    I.yaw=p.yaw+clamp(angDiff(p.yaw,wantYaw),-d.turn*dt,d.turn*dt); I.pitch=p.pitch+clamp(wantPitch-p.pitch,-d.turn*dt,d.turn*dt);
    var aligned=Math.abs(angDiff(I.yaw,wantYaw))<0.12+0.6/Math.max(dist,1), id=cw.slot.id;
    if(since>d.react&&aligned){ if(w.auto){ if(S.rand()<d.burst) I.fire=true; } else I.fire=S.rand()<(id==='launcher'?0.3:0.5); }
    if(id==='launcher'&&dist<5) I.fire=false;
    I.aim=(id==='sniper'||id==='dmr'||id==='rifle')&&dist>14;
    if(w.melee&&dist<2.2) I.fire=aligned;
    if(p.charge>=100&&since>0.5&&(p.ability.id!=='feast'||p.hp<70)) I.ability=true;
    if(pushing&&B.path&&B.path.length){ S.botFollow(p,dt,false); }
    else { if(B.strafeT<=0){ B.strafeT=0.5+S.rand()*0.9; B.strafe=S.rand()<0.5?-1:1; }
      var range=w.melee?1.5:(id==='shotgun'?7:id==='sniper'||id==='dmr'?30:id==='smg'?12:18);
      I.mx=B.strafe*0.8; I.mz=dist>range+4?0.8:(dist<range*0.5?-0.6:0);
      if(I.mz>0&&!S.clearWalk(p.x,p.z,p.x+(-Math.sin(p.yaw))*1.2,p.z+(-Math.cos(p.yaw))*1.2)) I.mz=0;
      if(p.hp<35&&!B.coverT){ B.coverT=S.time+3; var cv=S.findCover(p,tgt); if(cv){ B.path=S.path(p.x,p.z,cv[0],cv[1])||[]; B.goal={kind:'cover',x:cv[0],z:cv[1]}; B.pathT=3; } }
      if(B.goal&&B.goal.kind==='cover'&&B.path&&B.path.length){ S.botFollow(p,dt,false); I.fire=I.fire&&S.rand()<0.4; } }
    if(cw.slot.mag===0&&!w.melee) I.reload=true;
    return;
  }
  if(!w.melee&&cw.slot.mag<w.mag*0.4&&cw.slot.reserve>0) I.reload=true;
  if(p.charge>=100&&p.ability.id==='feast'&&p.hp<60) I.ability=true;
  S.botFollow(p,dt,true);
};
SP.botFollow=function(p,dt,face){
  var S=this, B=p.brain, I=p.input;
  if(B.unstuckT>0){ B.unstuckT-=dt; var ua=angDiff(I.yaw,B.unstuckA); I.mz=Math.cos(ua); I.mx=-Math.sin(ua); return; }
  if((!B.path||!B.path.length)&&B.goal&&len2(B.goal.x-p.x,B.goal.z-p.z)>0.6&&len2(B.goal.x-p.x,B.goal.z-p.z)<4) B.path=[[B.goal.x,B.goal.z]];
  if(!B.path||!B.path.length) return;
  var wp=B.path[0], dx=wp[0]-p.x, dz=wp[1]-p.z, d=len2(dx,dz);
  if(d<0.6){ B.path.shift(); if(!B.path.length&&B.goal&&len2(B.goal.x-p.x,B.goal.z-p.z)>0.7&&len2(B.goal.x-p.x,B.goal.z-p.z)<4&&!(wp[0]===B.goal.x&&wp[1]===B.goal.z)) B.path.push([B.goal.x,B.goal.z]); return; }
  var want=Math.atan2(-dx,-dz);
  if(face&&!B.target){ I.yaw=p.yaw+clamp(angDiff(p.yaw,want),-6*dt,6*dt); I.pitch=p.pitch*0.9; }
  var rel=angDiff(I.yaw,want); I.mz=Math.cos(rel); I.mx=-Math.sin(rel); I.sprint=(!B.target||p.flag)&&Math.abs(rel)<0.5;
  if(p.flag&&!B.target){ I.yaw=p.yaw+clamp(angDiff(p.yaw,want),-8*dt,8*dt); }
  B.stuck=(B.stuck||0)+(len2(p.vx,p.vz)<0.4?dt:-dt); if(B.stuck>0.8){ B.stuck=0; B.path=null; B.pathT=0.7; I.jump=true; B.unstuckT=0.6; B.unstuckA=want+Math.PI+(S.rand()-0.5)*2.4; }
  if(B.stuck<0) B.stuck=0;
};
SP.findCover=function(p,from){ var S=this, best=null, bd=1e9;
  for(var k=0;k<40;k++){ var a=S.rand()*6.28, r=3+S.rand()*7, x=p.x+Math.cos(a)*r, z=p.z+Math.sin(a)*r, c=S.cellOf(x,z); if(!S.walkable(c[0],c[1])) continue;
    var cp=S.cellPos(c[0],c[1]); if(S.los(from.x,S.eye(from),from.z,cp[0],S.nav.h[c[1]*S.nav.w+c[0]]+1.2,cp[1])) continue; var dd=len2(cp[0]-p.x,cp[1]-p.z); if(dd<bd){ bd=dd; best=cp; } }
  return best; };
Sim.MODES=MODES; Sim.DIFF=DIFF; Sim.PHYS=P; Sim.angDiff=angDiff;
root.VGSim=Sim;
if(typeof module!=='undefined') module.exports=Sim;
})(typeof window!=='undefined'?window:globalThis);
