/* VIBE HEROES UI: menus, HUD, input, audio, game loop. */
(function(){
'use strict';
var $=function(id){ return document.getElementById(id); };
var DEFAULT_KEYS={ability:'KeyQ',use:'KeyE',forward:'KeyW',back:'KeyS',left:'KeyA',right:'KeyD',jump:'Space',crouch:'KeyC',sprint:'ShiftLeft',reload:'KeyR',slot1:'Digit1',slot2:'Digit2',slot3:'Digit3',scores:'Tab'};
var KEY_LABEL={ability:'Special power',use:'Take weapon (armory)',forward:'Move forward',back:'Move back',left:'Move left',right:'Move right',jump:'Jump',crouch:'Crouch',sprint:'Sprint',reload:'Reload',slot1:'Primary weapon',slot2:'Pistol',slot3:'Melee',scores:'Scoreboard'};
var BOT_NAMES=['MellowGecko','PixelPilot','LuckyViber','NeonNomad','ByteBandit','GlitchGoose','VoxelVandal','RetroRacer','CubeCaptain','SyncSamurai','LagLord','BeamBuddy','ChipChamp','DataDuck'];
function load(k,d){ try{ var v=localStorage.getItem('vg.'+k); return v==null?d:JSON.parse(v); }catch(e){ return d; } }
function save(k,v){ try{ localStorage.setItem('vg.'+k,JSON.stringify(v)); }catch(e){} }
var settings=Object.assign({sens:1,fov:80,invertY:false,quality:matchMedia('(pointer:coarse)').matches?'low':'high',volume:0.7,difficulty:'normal'},load('settings',{}));
settings.keys=Object.assign({},DEFAULT_KEYS,settings.keys||{});
var DATA={chars:{},charIds:[],maps:{},mapIds:[],weapons:null}, sim=null, view=null, me=null, state='menu', choice={char:null,map:null,mode:'ctf'};
var input={mx:0,mz:0,yaw:0,pitch:0,fire:false,aim:false,jump:false,crouch:false,sprint:false}, keys={}, locked=false;
/* ---------- assets ---------- */
function getJSON(u){ if(window.VG_BUNDLE&&window.VG_BUNDLE[u]) return Promise.resolve(JSON.parse(JSON.stringify(window.VG_BUNDLE[u]))); return fetch(u).then(function(r){ if(!r.ok) throw new Error(u+' '+r.status); return r.json(); }); }
function loadAll(){
  return Promise.all([getJSON('assets/characters/index.json'),getJSON('assets/maps/index.json'),getJSON('assets/weapons/weapons.json')]).then(function(r){
    DATA.charIds=r[0].characters; DATA.mapIds=r[1].maps; DATA.weapons=r[2];
    return Promise.all(DATA.charIds.map(function(id){ return getJSON('assets/characters/'+id+'/character.json').then(function(c){ c.folder='assets/characters/'+id+'/'; DATA.chars[id]=c; }); }).concat(
      DATA.mapIds.map(function(id){ return getJSON('assets/maps/'+id+'/map.json').then(function(m){ DATA.maps[id]=m; }); })));
  });
}
/* ---------- audio (synthesized, no files needed) ---------- */
var AC=null, master=null;
function ac(){ if(!AC){ try{ AC=new (window.AudioContext||window.webkitAudioContext)(); master=AC.createGain(); master.gain.value=settings.volume; master.connect(AC.destination); }catch(e){} } if(AC&&AC.state==='suspended') AC.resume(); return AC; }
function noise(dur,vol,freq,q,type){ var a=ac(); if(!a) return; var n=Math.floor(a.sampleRate*dur), b=a.createBuffer(1,n,a.sampleRate), d=b.getChannelData(0); for(var i=0;i<n;i++) d[i]=(Math.random()*2-1)*Math.pow(1-i/n,2.2);
  var s=a.createBufferSource(); s.buffer=b; var f=a.createBiquadFilter(); f.type=type||'lowpass'; f.frequency.value=freq||2000; f.Q.value=q||0.7; var g=a.createGain(); g.gain.value=vol; s.connect(f); f.connect(g); g.connect(master); s.start(); }
function tone(f0,f1,dur,type,vol){ var a=ac(); if(!a) return; var o=a.createOscillator(), g=a.createGain(); o.type=type||'sine'; o.frequency.setValueAtTime(f0,a.currentTime); o.frequency.exponentialRampToValueAtTime(Math.max(20,f1),a.currentTime+dur);
  g.gain.setValueAtTime(vol,a.currentTime); g.gain.exponentialRampToValueAtTime(0.0001,a.currentTime+dur); o.connect(g); g.connect(master); o.start(); o.stop(a.currentTime+dur+0.02); }
var SFX={
  shot:function(w,dist){ var v=Math.max(0.05,1-dist/60); if(w==='sniper'){ noise(0.5,0.9*v,1400); tone(120,40,0.4,'sine',0.5*v); } else if(w==='shotgun'){ noise(0.35,0.9*v,1000); tone(90,40,0.25,'sine',0.4*v); } else if(w==='pistol'){ noise(0.12,0.55*v,2600); } else if(w==='smg'){ noise(0.08,0.45*v,3000); } else noise(0.12,0.6*v,2200); },
  melee:function(){ noise(0.15,0.4,800,1,'bandpass'); }, reload:function(){ tone(900,600,0.05,'square',0.06); setTimeout(function(){ tone(700,1200,0.06,'square',0.06); },180); },
  hit:function(head){ tone(head?1700:1200,head?2200:1500,0.06,'triangle',0.12); }, kill:function(){ tone(880,1320,0.12,'triangle',0.15); setTimeout(function(){ tone(1320,1760,0.16,'triangle',0.13); },90); },
  transform:function(){ tone(600,120,0.35,'square',0.08); noise(0.3,0.25,4000,1,'highpass'); setTimeout(function(){ tone(400,900,0.2,'triangle',0.12); },250); },
  respawn:function(){ tone(300,900,0.4,'sine',0.12); tone(450,1350,0.4,'sine',0.06); }, hurt:function(){ tone(220,120,0.12,'sawtooth',0.08); },
  pickup:function(){ tone(660,990,0.12,'triangle',0.12); }, step:function(){ noise(0.05,0.08,700); }, empty:function(){ tone(1400,1300,0.03,'square',0.05); } };
/* ---------- menus ---------- */
function show(id){ ['scr-load','scr-menu','scr-setup','scr-settings','scr-pause','scr-results'].forEach(function(s){ $(s).hidden=s!==id; }); document.body.classList.toggle('in-menu',id!==null); }
function buildSetup(){
  var grid=$('char-grid'); grid.innerHTML='';
  DATA.charIds.forEach(function(id){ var c=DATA.chars[id], b=document.createElement('button'); b.type='button'; b.className='char'; b.setAttribute('aria-pressed',String(choice.char===id));
    var w=DATA.weapons.weapons[c.preferred]||{name:''};
    b.innerHTML='<img alt="" src="'+((window.VG_PORTRAITS&&window.VG_PORTRAITS[id])||(c.folder+c.portrait))+'"><b></b><span></span><em></em><i></i>'; b.querySelector('b').textContent=c.name; b.querySelector('span').textContent='★ '+(c.ability?c.ability.name:''); b.querySelector('em').textContent=c.ability?c.ability.desc:''; b.querySelector('i').textContent='Favors '+w.name+' · dies as '+c.deathForm.name;
    b.onclick=function(){ choice.char=id; save('char',id); buildSetup(); }; grid.appendChild(b); });
  var ml=$('map-list'); ml.innerHTML='';
  DATA.mapIds.forEach(function(id){ var m=DATA.maps[id], b=document.createElement('button'); b.type='button'; b.className='opt'; b.textContent=m.name; b.setAttribute('aria-pressed',String(choice.map===id)); b.onclick=function(){ choice.map=id; save('map2',id); buildSetup(); }; ml.appendChild(b); });
  ['easy','normal','hard'].forEach(function(d){ $('diff-'+d).setAttribute('aria-pressed',String(settings.difficulty===d)); });
  ['ctf','tdm'].forEach(function(m){ $('mode-'+m).setAttribute('aria-pressed',String(choice.mode===m)); }); $('mode-note').textContent=choice.mode==='ctf'?'Each team has 3 flags in its base. Grab enemy flags and bring them to your capture zone. First to 3 wins. Weapons are in your base armory (E).':'First team to 50 eliminations wins. Grab a weapon from your base armory (E).';
  $('b-start').disabled=!choice.char||!choice.map;
}
function buildSettings(){
  $('set-sens').value=settings.sens; $('set-fov').value=settings.fov; $('set-inv').checked=settings.invertY; $('set-vol').value=settings.volume; $('set-q').value=settings.quality;
  $('sens-v').textContent=settings.sens.toFixed(2); $('fov-v').textContent=settings.fov;
  var kl=$('key-list'); kl.innerHTML='';
  Object.keys(DEFAULT_KEYS).forEach(function(k){ var row=document.createElement('div'); row.className='keyrow'; var l=document.createElement('span'); l.textContent=KEY_LABEL[k]; var b=document.createElement('button'); b.type='button'; b.className='keybtn'; b.textContent=settings.keys[k].replace(/^Key|^Digit/,'');
    b.onclick=function(){ b.textContent='Press a key…'; rebinding=k; }; row.appendChild(l); row.appendChild(b); kl.appendChild(row); });
}
var rebinding=null, settingsBack='scr-menu';
function saveSettings(){ save('settings',settings); if(master) master.gain.value=settings.volume; if(view) view.settings=settings; }
/* ---------- match ---------- */
function startMatch(){
  var map=DATA.maps[choice.map], mode='tdm';
  mode=choice.mode; sim=new VGSim({map:map,weapons:DATA.weapons,chars:DATA.chars,mode:mode});
  var others=DATA.charIds.filter(function(id){ return id!==choice.char; }), names=BOT_NAMES.slice().sort(function(){ return Math.random()-0.5; }), n=0;
  function pickChar(i){ return others.length?others[i%others.length]:choice.char; }
  me=sim.addPlayer({id:'you',name:load('name','You'),team:'A',charId:choice.char});
  for(var i=0;i<4;i++) sim.addPlayer({id:'a'+i,name:names[n++],team:'A',charId:pickChar(i),isBot:true,difficulty:settings.difficulty});
  for(var j=0;j<5;j++) sim.addPlayer({id:'b'+j,name:names[n++],team:'B',charId:pickChar(j+3),isBot:true,difficulty:settings.difficulty});
  view.players={}; view.marked={}; view.heightAt=function(x,z){ return sim.heightAt(x,z); }; view.loadMap(map); view.vm=null; view.camera.fov=settings.fov;
  input.yaw=me.yaw; input.pitch=0; feed=[]; renderFeed();
  $('mode-name').textContent=sim.mode.name+' · '+map.name; state='play'; show(null); lockPointer();
  var ab=DATA.chars[me.charId].ability; $('intro-goal').textContent=sim.mode.flags?'Steal the 3 RED flags and bring them to your BLUE zone. Protect your own flags.':'Eliminate RED players. First team to 50 wins.';
  $('intro-ab').textContent='Your power: '+ab.name+' ('+settings.keys.ability.replace('Key','')+') · get a weapon at your armory ('+settings.keys.use.replace('Key','')+')'; $('intro').hidden=false; clearTimeout(introT); introT=setTimeout(function(){ $('intro').hidden=true; },6500);
}
function lockPointer(){ var c=$('game'); if(c.requestPointerLock) try{ c.requestPointerLock(); }catch(e){} }
document.addEventListener('pointerlockchange',function(){ locked=document.pointerLockElement===$('game'); if(!locked&&state==='play') pause(); });
function pause(){ if(state!=='play') return; state='paused'; show('scr-pause'); input.fire=false; keys={}; }
function resume(){ state='play'; show(null); lockPointer(); }
function toMenu(){ state='menu'; sim=null; show('scr-menu'); if(document.exitPointerLock) document.exitPointerLock(); }
/* ---------- input ---------- */
function kd(code){ return !!keys[code]; }
addEventListener('keydown',function(e){
  if(rebinding){ e.preventDefault(); if(e.code!=='Escape'){ settings.keys[rebinding]=e.code; saveSettings(); } rebinding=null; buildSettings(); return; }
  keys[e.code]=true; if(state!=='play') return;
  var K=settings.keys;
  if(e.code===K.reload) input.reload=true; if(e.code===K.ability) input.ability=true; if(e.code===K.use) input.use=true; if(e.code===K.slot1) input.switchTo=0; if(e.code===K.slot2) input.switchTo=1; if(e.code===K.slot3) input.switchTo=2;
  if(e.code===K.scores){ e.preventDefault(); $('scoreboard').hidden=false; renderScoreboard(); }
  if(e.code==='Space'||e.code==='Tab') e.preventDefault();
});
addEventListener('keyup',function(e){ keys[e.code]=false; if(e.code===settings.keys.scores) $('scoreboard').hidden=true; });
addEventListener('mousemove',function(e){ if(!locked||state!=='play') return; var k=0.0022*settings.sens*(view&&me&&input.aim?view.camera.fov/settings.fov:1);
  input.yaw-=e.movementX*k; input.pitch-=e.movementY*k*(settings.invertY?-1:1); input.pitch=Math.max(-1.45,Math.min(1.45,input.pitch)); });
addEventListener('mousedown',function(e){ if(state!=='play') return; if(!locked){ lockPointer(); return; } ac(); if(e.button===0) input.fire=true; if(e.button===2) input.aim=true; });
addEventListener('mouseup',function(e){ if(e.button===0) input.fire=false; if(e.button===2) input.aim=false; });
addEventListener('contextmenu',function(e){ if(state==='play') e.preventDefault(); });
addEventListener('wheel',function(e){ if(state!=='play'||!me) return; var n=me.weapons.length, i=me.wi; for(var k=0;k<n;k++){ i=((i+(e.deltaY>0?1:-1))%n+n)%n; if(me.weapons[i]) break; } input.switchTo=i; },{passive:true});
function gatherInput(){ var K=settings.keys; input.mz=(kd(K.forward)?1:0)-(kd(K.back)?1:0); input.mx=(kd(K.right)?1:0)-(kd(K.left)?1:0); input.jump=kd(K.jump); input.crouch=kd(K.crouch)||kd('ControlLeft'); input.sprint=kd(K.sprint);
  var I=me.input; I.mx=input.mx; I.mz=input.mz; I.yaw=input.yaw; I.pitch=input.pitch; I.fire=input.fire; I.aim=input.aim; I.jump=input.jump; I.crouch=input.crouch; I.sprint=input.sprint;
  if(input.switchTo!=null){ I.switchTo=input.switchTo; input.switchTo=null; } if(input.reload){ I.reload=true; input.reload=false; }
  if(input.ability){ I.ability=true; input.ability=false; } if(input.use){ I.use=true; input.use=false; } }
/* ---------- HUD ---------- */
var feed=[], dmgDirs=[], hitT=0, stepT=0, introT=null, hitByT=null;
function nameOf(id){ var p=sim.players.filter(function(q){ return q.id===id; })[0]; return p?p.name:'?'; }
function teamOf(id){ var p=sim.players.filter(function(q){ return q.id===id; })[0]; return p?p.team:'A'; }
function renderFeed(){ var el=$('feed'); el.innerHTML=''; feed.forEach(function(f){ var d=document.createElement('div'); d.className='kf'+(f.mine?' mine':'');
  var a=document.createElement('b'); a.textContent=f.k; a.className='t'+f.kt; var w=document.createElement('span'); w.textContent=' '+f.w+(f.head?' ✦ ':' '); var v=document.createElement('b'); v.textContent=f.v; v.className='t'+f.vt; d.appendChild(a); d.appendChild(w); d.appendChild(v); el.appendChild(d); }); }
function waypoints(){
  var box=$('wps'), list=[]; if(!sim||!view) return;
  var bases=sim.map.bases, mine=bases&&bases[me.team];
  if(me.state==='alive'&&mine){
    if(!me.weapons[0]){ var rk=sim.racks.filter(function(r){ return r.team===me.team; })[0]; if(rk) list.push({x:rk.x,y:(rk.y||0)+1.6,z:rk.z,label:'ARMORY',cls:'wp-arm'}); }
    if(sim.mode.flags){
      if(me.flag) list.push({x:mine.capture[0],y:sim.heightAt(mine.capture[0],mine.capture[1])+1.5,z:mine.capture[1],label:'HOME',cls:'wp-home'});
      sim.flags.forEach(function(f){ if(f.state==='captured') return; var own=f.team===me.team;
        if(!own&&f.state!=='carried'&&!me.flag) list.push({x:f.x,y:(f.y||0)+2.8,z:f.z,label:'ENEMY FLAG',cls:'wp-enemy'});
        if(own&&f.state==='carried'){ var c=sim.byId(f.carrier); if(c) list.push({x:c.x,y:c.y+2.6,z:c.z,label:'STOLEN!',cls:'wp-alert'}); }
        if(own&&f.state==='dropped') list.push({x:f.x,y:(f.y||0)+2.4,z:f.z,label:'RETURN',cls:'wp-own'});
        if(!own&&f.state==='carried'){ var cc=sim.byId(f.carrier); if(cc&&cc!==me) list.push({x:cc.x,y:cc.y+2.6,z:cc.z,label:'ESCORT',cls:'wp-own'}); } }); } }
  while(box.children.length<list.length){ var d=document.createElement('div'); d.className='wp'; d.innerHTML='<b></b><span></span>'; box.appendChild(d); }
  var W=innerWidth,H=innerHeight, v=new THREE.Vector3();
  Array.prototype.forEach.call(box.children,function(el,i){ var w=list[i]; if(!w){ el.hidden=true; return; } el.hidden=false; el.className='wp '+w.cls;
    v.set(w.x,w.y,w.z); v.project(view.camera); var behind=v.z>1, sx=(v.x*0.5+0.5)*W, sy=(-v.y*0.5+0.5)*H;
    if(behind){ sx=W-sx; sy=H-60; } var m=46, edge=behind||sx<m||sx>W-m||sy<m||sy>H-m; sx=Math.max(m,Math.min(W-m,sx)); sy=Math.max(m+40,Math.min(H-m-80,sy));
    el.style.transform='translate('+Math.round(sx)+'px,'+Math.round(sy)+'px)'; el.classList.toggle('edge',edge);
    el.querySelector('b').textContent=w.label; el.querySelector('span').textContent=Math.round(Math.hypot(w.x-me.x,w.z-me.z))+' m'; });
}
function renderFlags(){ ['A','B'].forEach(function(t){ var el=$('fl-'+t); el.innerHTML=''; sim.flags.filter(function(f){ return f.team===t; }).forEach(function(f){ var i=document.createElement('i'); i.className='fl '+f.state; i.title=f.state; el.appendChild(i); }); }); }
var mm=null;
function drawMinimap(){ var c=$('minimap'); if(!c) return; var g=c.getContext('2d'), W=c.width, H=c.height, ms=sim.map.size, sx=W/ms[0], sz=H/ms[1], X=function(x){ return (x+ms[0]/2)*sx; }, Z=function(z){ return (z+ms[1]/2)*sz; };
  if(!mm||mm.id!==sim.map.id){ mm=document.createElement('canvas'); mm.width=W; mm.height=H; mm.id=sim.map.id; var b=mm.getContext('2d'); b.fillStyle='rgba(10,8,24,.85)'; b.fillRect(0,0,W,H);
    sim.map.boxes.forEach(function(q){ if(q.kind==='roof'||q.kind==='edge') return; b.fillStyle=q.kind==='pumpkin'?'#a8551c':'#5a5478'; b.fillRect(X(q.min[0]),Z(q.min[2]),Math.max(1,(q.max[0]-q.min[0])*sx),Math.max(1,(q.max[2]-q.min[2])*sz)); });
    ['A','B'].forEach(function(t){ var B=sim.map.bases[t]; if(!B) return; b.strokeStyle=t==='A'?'#4aa8ff':'#ff3a4a'; b.lineWidth=2; b.beginPath(); b.arc(X(B.capture[0]),Z(B.capture[1]),B.capture[2]*sx,0,6.28); b.stroke(); b.fillStyle='#cdff65'; (B.racks||[]).forEach(function(r){ b.fillRect(X(r.pos[0])-1,Z(r.pos[1])-1,2,2); }); }); }
  g.clearRect(0,0,W,H); g.drawImage(mm,0,0);
  (sim.flags||[]).forEach(function(f){ if(f.state==='captured') return; g.fillStyle=f.team==='A'?'#4aa8ff':'#ff3a4a'; g.fillRect(X(f.x)-3,Z(f.z)-6,6,4); g.fillStyle='#fff'; g.fillRect(X(f.x)-3,Z(f.z)-6,1,8); });
  var vision=me.abilityT>0&&me.ability.id==='vision';
  sim.players.forEach(function(p){ if(p.state==='mini') return; var ally=p.team===me.team; if(!ally&&!vision&&!p.flag&&!((view.marked[p.id]||0)>sim.time)&&!((view.losT[p.id]||0)>sim.time)) return; g.fillStyle=p===me?'#ffffff':(ally?'#4aa8ff':'#ff3a4a'); g.beginPath(); g.arc(X(p.x),Z(p.z),p===me?4:3,0,6.28); g.fill(); });
  g.strokeStyle='#ffffff'; g.lineWidth=2; g.beginPath(); g.moveTo(X(me.x),Z(me.z)); g.lineTo(X(me.x)-Math.sin(me.yaw)*12,Z(me.z)-Math.cos(me.yaw)*12); g.stroke(); }
function renderScoreboard(){ if(!sim) return; ['A','B'].forEach(function(t){ var tb=$('sb-'+t); tb.innerHTML=''; sim.players.filter(function(p){ return p.team===t; }).sort(function(a,b){ return b.kills-a.kills; }).forEach(function(p){
  var tr=document.createElement('tr'); if(p===me) tr.className='me'; ['name','charId','kills','deaths'].forEach(function(k){ var td=document.createElement('td'); td.textContent=k==='charId'?DATA.chars[p.charId].name:p[k]; tr.appendChild(td); }); tb.appendChild(tr); }); }); }
function hud(dt){
  var cw=sim.curWeapon(me), w=cw.def, slot=cw.slot;
  $('hp-v').textContent=Math.ceil(me.hp); $('hp-bar').style.width=Math.max(0,me.hp)+'%'; $('ar-v').textContent=Math.ceil(me.armor); $('ar-bar').style.width=me.armor+'%';
  $('hud').classList.toggle('low',me.hp<35&&me.state==='alive');
  $('w-name').textContent=w.name; $('w-mag').textContent=w.melee?'∞':slot.mag; $('w-res').textContent=w.melee?'':'/ '+slot.reserve; $('w-state').textContent=me.reloadT>0?'RELOADING':(!w.melee&&slot.mag===0?(slot.reserve>0?'PRESS '+settings.keys.reload.replace('Key','')+' TO RELOAD':'NO AMMO'):'');
  document.querySelectorAll('.wslot').forEach(function(el,i){ var s=me.weapons[i]; el.classList.toggle('on',i===me.wi); el.classList.toggle('empty',!s); el.querySelector('b').textContent=s?DATA.weapons.weapons[s.id].name:'Armory (E)'; });
  if(sim.has(me,'endless')){ $('w-mag').textContent='∞'; $('w-res').textContent=''; }
  // special power
  var ab=me.ability, act=me.abilityT>0; $('ab-name').textContent=(ab.name||ab.id); $('ab-fill').style.width=(act?me.abilityT/ab.duration*100:me.charge)+'%'; $('ab').classList.toggle('ready',!act&&me.charge>=100); $('ab').classList.toggle('active',act);
  $('ab-key').textContent=act?Math.ceil(me.abilityT)+'s':(me.charge>=100?'PRESS '+settings.keys.ability.replace('Key',''):Math.floor(me.charge)+'%');
  // armory prompt and flag hints
  var rk=me.state==='alive'&&sim.rackNear(me); $('prompt').textContent=rk?'['+settings.keys.use.replace('Key','')+'] Take '+DATA.weapons.weapons[rk.weapon].name:''; $('prompt').hidden=!rk;
  if(sim.mode.flags){ var cap=sim.map.bases[me.team].capture, dx=cap[0]-me.x, dz=cap[1]-me.z; $('carry').hidden=!me.flag; if(me.flag){ var a=Math.atan2(dx,dz)+me.yaw+Math.PI; $('carry-arrow').style.transform='rotate('+(-a)+'rad)'; $('carry-d').textContent=Math.round(Math.hypot(dx,dz))+' m'; } renderFlags(); }
  else $('carry').hidden=true;
  drawMinimap(); waypoints();
  var fl=sim.mode.flags; $('sc-A').textContent=fl?sim.captures.A:sim.score.A; $('sc-B').textContent=fl?sim.captures.B:sim.score.B; var tl=Math.ceil(sim.timeLeft); $('timer').textContent=Math.floor(tl/60)+':'+('0'+tl%60).slice(-2); $('goal').textContent=fl?'Flags captured · first to 3':'First to '+sim.mode.scoreLimit;
  var mini=me.state==='mini'; $('death').hidden=!mini; $('xh').hidden=mini||(input.aim&&w.scope); $('scope').hidden=!(input.aim&&w.scope&&!mini);
  if(mini){ $('death-n').textContent=Math.max(1,Math.ceil(me.miniT)); }
  var moving=Math.hypot(me.vx,me.vz)>0.5||!me.onGround, sp=(input.aim?(w.adsSpread||w.spread):w.spread)+(moving?w.moveSpread||0:0)+me.spreadKick; var gap=6+sp*420; $('xh').style.setProperty('--gap',Math.min(60,gap)+'px');
  $('prot').hidden=!(me.prot>0&&!mini);
  hitT=Math.max(0,hitT-dt); $('hitm').style.opacity=hitT>0?1:0;
  var dd=$('dmgdir'); dmgDirs=dmgDirs.filter(function(d){ d.t-=dt; return d.t>0; }); dd.innerHTML=''; dmgDirs.forEach(function(d){ var s=sim.players.filter(function(q){ return q.id===d.by; })[0]; if(!s) return; var a=Math.atan2(s.x-me.x,s.z-me.z)+me.yaw+Math.PI; var el=document.createElement('i'); el.style.transform='rotate('+(-a)+'rad)'; el.style.opacity=Math.min(1,d.t); dd.appendChild(el); });
  // crosshair on an enemy shows their name
  var tgtName=''; if(!mini){ var dir=sim.aimDir(me.yaw,me.pitch), ey=sim.eye(me), wr=sim.rayWorld(me.x,ey,me.z,dir[0],dir[1],dir[2],120).t;
    sim.players.forEach(function(q){ if(q===me||q.state!=='alive') return; var hb=sim.hitboxes(q); var dx=q.x-me.x, dz=q.z-me.z, dist=Math.hypot(dx,dz); if(dist>wr) return; var pr=dx*dir[0]+dz*dir[2]; if(pr<0) return; var lat=Math.hypot(me.x+dir[0]*pr-q.x,me.z+dir[2]*pr-q.z); if(lat<0.45&&Math.abs((ey+dir[1]*pr)-(q.y+1))<1.1) tgtName=q.name+(q.team!==me.team?'':' (team)'); }); }
  $('aimname').textContent=tgtName; $('aimname').className=tgtName.indexOf('(team)')>0?'tA':'tB';
}
function onEvents(evts){
  evts.forEach(function(e){
    if(e.type==='shot'){ var s=sim.players.filter(function(q){ return q.id===e.id; })[0]; SFX.shot(e.weapon,s===me?0:Math.hypot(s.x-me.x,s.z-me.z)); if(e.id===me.id&&e.hits.some(function(h){ return h.hit; })){ hitT=0.15; SFX.hit(e.hits.some(function(h){ return h.head; })); } }
    else if(e.type==='melee'){ SFX.melee(); }
    else if(e.type==='hit'&&e.id===me.id){ dmgDirs.push({by:e.by,t:1.2}); SFX.hurt(); if(e.by&&e.by!==me.id){ var sh=sim.byId(e.by); $('hitby').textContent='Hit by '+(sh?sh.name+' ('+DATA.chars[sh.charId].name+')':'?')+' -'+e.dmg; $('hitby').classList.add('on'); clearTimeout(hitByT); hitByT=setTimeout(function(){ $('hitby').classList.remove('on'); },1600); } $('hurt').style.opacity=0.5; setTimeout(function(){ $('hurt').style.opacity=0; },150); }
    else if(e.type==='reload'&&e.id===me.id){ SFX.reload(); }
    else if(e.type==='kill'){ var mine=e.killer===me.id||e.victim===me.id; feed.unshift({k:nameOf(e.killer),kt:teamOf(e.killer),v:nameOf(e.victim),vt:teamOf(e.victim),w:DATA.weapons.weapons[e.weapon]?DATA.weapons.weapons[e.weapon].name:'',head:e.head,mine:mine}); feed=feed.slice(0,6); renderFeed();
      if(e.killer===me.id&&e.victim!==me.id){ SFX.kill(); flashMsg((e.head?'HEADSHOT · ':'')+'ELIMINATED '+nameOf(e.victim)); }
      if(e.victim===me.id){ var ch=DATA.chars[me.charId], kp=e.killer&&sim.byId(e.killer); $('death-by').textContent=kp&&kp!==me?'Eliminated by '+kp.name+' · '+DATA.chars[kp.charId].name+(e.weapon&&DATA.weapons.weapons[e.weapon]?' · '+DATA.weapons.weapons[e.weapon].name:'')+' (marked in red)':'You went down'; $('death-form').textContent='You are now '+ch.deathForm.name; $('death-desc').textContent=ch.deathForm.description; } }
    else if(e.type==='transform'){ var t=sim.players.filter(function(q){ return q.id===e.id; })[0]; if(t&&Math.hypot(t.x-me.x,t.z-me.z)<30) SFX.transform(); }
    else if(e.type==='respawn'&&e.id===me.id){ SFX.respawn(); input.yaw=me.yaw; input.pitch=0; }
    else if(e.type==='pickup'&&e.id===me.id){ SFX.pickup(); flashMsg(e.kind==='health'?'+50 HEALTH':'+50 ARMOR'); }
    else if(e.type==='matchEnd'){ endMatch(); }
    else if(e.type==='flagTake'){ var mineT=e.team===me.team; feed.unshift({k:nameOf(e.id),kt:teamOf(e.id),v:(mineT?'YOUR':'ENEMY')+' FLAG',vt:e.team,w:'took',mine:e.id===me.id}); feed=feed.slice(0,6); renderFeed(); flashMsg(e.id===me.id?'YOU HAVE THE FLAG · BRING IT HOME':(mineT?'YOUR FLAG WAS TAKEN':'ENEMY FLAG TAKEN')); tone(mineT?300:600,mineT?200:900,0.3,'square',0.08); }
    else if(e.type==='capture'){ var ours=e.team===me.team; flashMsg(ours?'FLAG CAPTURED!':'THEY CAPTURED A FLAG'); feed.unshift({k:nameOf(e.id),kt:e.team,v:'CAPTURED A FLAG',vt:e.team,w:'',mine:e.id===me.id}); feed=feed.slice(0,6); renderFeed(); if(ours){ SFX.kill(); setTimeout(SFX.kill,180); } else tone(400,150,0.5,'sawtooth',0.1); }
    else if(e.type==='flagReturn'){ if(e.team===me.team) flashMsg('YOUR FLAG IS BACK'); }
    else if(e.type==='flagDrop'){ if(e.team===me.team) flashMsg('YOUR FLAG IS ON THE GROUND · TOUCH IT TO RETURN'); }
    else if(e.type==='ability'){ var ap=sim.players.filter(function(q){ return q.id===e.id; })[0]; if(ap&&(ap===me||Math.hypot(ap.x-me.x,ap.z-me.z)<40)){ tone(300,1200,0.35,'sawtooth',0.07); tone(600,1800,0.3,'triangle',0.05); } if(e.id===me.id) flashMsg(me.ability.name.toUpperCase()+'!'); }
    else if(e.type==='explode'){ var dd=Math.hypot(e.x-me.x,e.z-me.z); noise(0.7,Math.max(0.05,1-dd/70),600); tone(90,30,0.5,'sine',0.4*Math.max(0,1-dd/70)); }
    else if(e.type==='armory'&&e.id===me.id){ SFX.pickup(); flashMsg('GOT '+DATA.weapons.weapons[e.weapon].name.toUpperCase()); }
    else if(e.type==='turretShot'){ var td=Math.hypot(e.from[0]-me.x,e.from[2]-me.z); if(td<40) noise(0.05,0.25*(1-td/40),3000); }
  });
}
var msgT=null; function flashMsg(t){ var el=$('msg'); el.textContent=t; el.classList.add('on'); clearTimeout(msgT); msgT=setTimeout(function(){ el.classList.remove('on'); },1400); }
function endMatch(){
  state='results'; if(document.exitPointerLock) document.exitPointerLock();
  var won=sim.winner===me.team, draw=sim.winner==='draw'; $('res-title').textContent=draw?'DRAW':(won?'VICTORY':'DEFEAT'); $('res-title').className=draw?'':(won?'win':'lose');
  $('res-score').textContent=sim.mode.flags?('Flags '+sim.captures.A+' – '+sim.captures.B+' · Kills '+sim.score.A+' – '+sim.score.B):(sim.score.A+' – '+sim.score.B);
  var mvp=sim.players.slice().sort(function(a,b){ return (b.kills-b.deaths*0.3)-(a.kills-a.deaths*0.3); })[0]; $('res-mvp').textContent='MVP: '+mvp.name+' ('+DATA.chars[mvp.charId].name+') · '+mvp.kills+' kills';
  $('res-you').textContent='You: '+me.kills+' kills · '+me.deaths+' deaths'; renderScoreboard(); $('res-board').innerHTML=$('sb-wrap').innerHTML; show('scr-results');
}
/* ---------- loop ---------- */
var acc=0, last=performance.now(), DT=1/60;
function frame(now){ var dt=Math.min(0.1,(now-last)/1000); last=now;
  if(sim&&state==='play'){ acc+=dt; var n=0; while(acc>=DT&&n<6){ gatherInput(); sim.step(DT); var ev=sim.drain(); view.onEvents(ev,sim,me.id); onEvents(ev); acc-=DT; n++; }
    stepT-=dt; if(me.onGround&&Math.hypot(me.vx,me.vz)>3&&stepT<=0&&me.state==='alive'){ SFX.step(); stepT=me.input.sprint?0.28:0.38; } }
  if(sim&&state!=='menu'){ var ch=DATA.chars[me.charId]; if(me.state==='alive') view.setViewmodel(me.weapons[me.wi].id,(ch.model.parts.armR||[[0,0,0,0,0,0,'#cfcbc1']])[0][6]);
    view.syncPlayers(sim,me.id,dt); view.updateCamera(me,sim,dt,input); view.updateFx(dt,sim); view.render(); if(state==='play') hud(dt); }
  requestAnimationFrame(frame); }
/* ---------- wiring ---------- */
function wire(){
  $('b-play').onclick=function(){ ac(); buildSetup(); show('scr-setup'); };
  $('b-settings').onclick=function(){ settingsBack='scr-menu'; buildSettings(); show('scr-settings'); };
  $('b-setup-back').onclick=function(){ show('scr-menu'); };
  $('b-start').onclick=function(){ ac(); startMatch(); };
  ['easy','normal','hard'].forEach(function(d){ $('diff-'+d).onclick=function(){ settings.difficulty=d; saveSettings(); buildSetup(); }; });
  ['ctf','tdm'].forEach(function(m){ $('mode-'+m).onclick=function(){ choice.mode=m; save('mode',m); buildSetup(); }; });
  $('b-resume').onclick=resume; $('b-pause-settings').onclick=function(){ settingsBack='scr-pause'; buildSettings(); show('scr-settings'); }; $('b-quit').onclick=toMenu;
  $('b-set-back').onclick=function(){ show(settingsBack); };
  $('set-sens').oninput=function(){ settings.sens=+this.value; $('sens-v').textContent=settings.sens.toFixed(2); saveSettings(); };
  $('set-fov').oninput=function(){ settings.fov=+this.value; $('fov-v').textContent=settings.fov; saveSettings(); };
  $('set-inv').onchange=function(){ settings.invertY=this.checked; saveSettings(); };
  $('set-vol').oninput=function(){ settings.volume=+this.value; saveSettings(); };
  $('set-q').onchange=function(){ settings.quality=this.value; saveSettings(); $('q-note').hidden=false; };
  $('b-keys-reset').onclick=function(){ settings.keys=Object.assign({},DEFAULT_KEYS); saveSettings(); buildSettings(); };
  $('b-again').onclick=function(){ startMatch(); }; $('b-res-menu').onclick=toMenu;
}
window.addEventListener('load',function(){
  wire(); show('scr-load');
  if(!window.THREE){ $('load-msg').textContent='Could not load the 3D engine. Check your connection and refresh.'; return; }
  loadAll().then(function(){
    choice.char=DATA.chars[load('char','')]?load('char',''):DATA.charIds[0]; choice.map=DATA.maps[load('map2','')]?load('map2',''):DATA.mapIds[0]; choice.mode=load('mode','ctf');
    view=new VGView($('game'),DATA,settings); show('scr-menu'); requestAnimationFrame(frame);
  }).catch(function(err){ $('load-msg').textContent='Could not load game data ('+err.message+'). The game must be served from a web server, not opened as a file.'; });
});
window.__vg={choice:choice,get sim(){ return sim; },get me(){ return me; },get state(){ return state; },input:input,settings:settings,DATA:DATA,startMatch:function(){ startMatch(); },step:function(n){ for(var i=0;i<n;i++){ gatherInput(); sim.step(DT); var ev=sim.drain(); view.onEvents(ev,sim,me.id); onEvents(ev); } }};
})();
