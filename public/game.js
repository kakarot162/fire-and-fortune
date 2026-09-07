const socket = io();
let myId=null, roomCode=null, state=null, selectedCharacter="car", rolled=false;
let scene,camera,renderer,boardGroup,cloudGroup,raycaster,mouse;
const tileMeshes=[], tokenGroups=new Map(), tokenTargets=new Map(), buildingGroups=new Map();
let latestTrade=null, musicOn=false, audioCtx=null, musicTimer=null;

const $=id=>document.getElementById(id);
const money=n=>"$"+Number(n||0).toLocaleString();
const charEmoji={car:"🚗",plane:"✈️",boat:"⛵",bike:"🏍️",rocket:"🚀"};
const diceChars=["⚀","⚁","⚂","⚃","⚄","⚅"];
const groupHex={brown:0x8b5a2b,red:0xd83b3b,yellow:0xf0c419,blue:0x3182ce,orange:0xf28c28};
const groupCss={brown:"#8b5a2b",red:"#d83b3b",yellow:"#d4ad00",blue:"#3182ce",orange:"#e97710"};

document.querySelectorAll(".character").forEach(btn=>{
  btn.onclick=()=>{
    document.querySelectorAll(".character").forEach(x=>x.classList.remove("active"));
    btn.classList.add("active"); selectedCharacter=btn.dataset.character;
  };
});
document.querySelectorAll("[data-close]").forEach(b=>b.onclick=()=>$(b.dataset.close).classList.add("hidden"));

function err(msg){$("error").textContent=msg;setTimeout(()=>$("error").textContent="",3200);}
function nameValue(){const n=$("name").value.trim();if(!n){err("Enter your name first.");return null;}return n;}
$("createBtn").onclick=()=>{const name=nameValue();if(!name)return;socket.emit("createRoom",{name,character:selectedCharacter,startMoney:Number($("startMoney").value)});};
$("joinBtn").onclick=()=>{const name=nameValue(),code=$("roomCode").value.trim().toUpperCase();if(!name)return;if(!code)return err("Enter the room code.");socket.emit("joinRoom",{name,code,character:selectedCharacter});};
socket.on("connect",()=>myId=socket.id);
socket.on("errorMsg",err);
socket.on("roomCreated",({code})=>enter(code));
socket.on("joinedRoom",({code})=>enter(code));

function enter(code){
  roomCode=code;$("lobby").classList.add("hidden");$("game").classList.remove("hidden");$("codeLabel").textContent=code;
  const u=new URL(location.href);u.searchParams.set("room",code);history.replaceState({},"",u);
  setTimeout(init3D,80);
}
$("copyBtn").onclick=async()=>{const u=`${location.origin}${location.pathname}?room=${roomCode}`;await navigator.clipboard.writeText(u);$("copyBtn").textContent="✅ Copied";setTimeout(()=>$("copyBtn").textContent="🔗 Copy Invite",1200);};
$("startBtn").onclick=()=>socket.emit("startGame");
$("rollBtn").onclick=()=>{rolled=true;socket.emit("rollDice");};
$("buyBtn").onclick=()=>socket.emit("buyProperty");
$("auctionBtn").onclick=()=>socket.emit("startAuction");
$("endBtn").onclick=()=>{rolled=false;socket.emit("endTurn");};

socket.on("dice",({d1,d2})=>{$("die1").textContent=diceChars[d1-1];$("die2").textContent=diceChars[d2-1];pulseDice();});
socket.on("card",({label,text})=>{$("cardLabel").textContent=label.toUpperCase();$("cardText").textContent=text;$("cardModal").classList.remove("hidden");});
socket.on("tradeOffer",offer=>{latestTrade=offer;renderTradeOffer(offer);$("tradeOfferModal").classList.remove("hidden");});
$("acceptTrade").onclick=()=>{if(latestTrade)socket.emit("tradeResponse",{tradeId:latestTrade.id,accept:true});$("tradeOfferModal").classList.add("hidden");};
$("rejectTrade").onclick=()=>{if(latestTrade)socket.emit("tradeResponse",{tradeId:latestTrade.id,accept:false});$("tradeOfferModal").classList.add("hidden");};

function tileCoord(i){
  const S=18, edge=S/2, step=S/10;
  if(i<=10)return{x:edge-i*step,z:edge};
  if(i<=20)return{x:-edge,z:edge-(i-10)*step};
  if(i<=30)return{x:-edge+(i-20)*step,z:-edge};
  return{x:edge,z:-edge+(i-30)*step};
}
function textureForTile(t,i){
  const c=document.createElement("canvas");c.width=512;c.height=512;const x=c.getContext("2d");
  x.fillStyle="#f7eddc";x.fillRect(0,0,512,512);
  if(t.type==="property"){x.fillStyle=groupCss[t.group];x.fillRect(0,0,512,92);}
  else if(t.type==="chance"){x.fillStyle="#9b43d0";x.fillRect(0,0,512,92);}
  else if(t.type==="random"){x.fillStyle="#18a9bd";x.fillRect(0,0,512,92);}
  else if(t.type==="utility"){x.fillStyle=t.utilityKind==="water"?"#38a3db":"#f4c542";x.fillRect(0,0,512,92);}
  else if(t.type==="railway"){x.fillStyle="#4f5562";x.fillRect(0,0,512,92);}
  else {x.fillStyle="#d4b07c";x.fillRect(0,0,512,92);}
  x.fillStyle="#161616";x.font="bold 31px Arial";x.textAlign="center";
  wrapText(x,t.name,256,165,430,36);
  if(t.price){x.font="bold 27px Arial";x.fillText(money(t.price),256,450);}
  if(t.type==="utility"){x.font="bold 24px Arial";x.fillText(t.utilityKind==="water"?"💧 WATER":"⚡ ELECTRICITY",256,430);}
  if(t.type==="railway"){x.font="bold 24px Arial";x.fillText("🚆 RAILWAY",256,430);}
  const tex=new THREE.CanvasTexture(c);tex.anisotropy=renderer?.capabilities.getMaxAnisotropy?.()||1;return tex;
}
function wrapText(ctx,text,x,y,maxWidth,lineHeight){
  const words=String(text).split(" ");let line="",lines=[];
  for(const w of words){const test=line?line+" "+w:w;if(ctx.measureText(test).width>maxWidth&&line){lines.push(line);line=w;}else line=test;}
  if(line)lines.push(line);lines.slice(0,4).forEach((l,k)=>ctx.fillText(l,x,y+k*lineHeight));
}

function init3D(){
  if(renderer||!$("threeRoot"))return;
  const root=$("threeRoot");
  scene=new THREE.Scene();scene.background=new THREE.Color(0x87c8ee);scene.fog=new THREE.Fog(0x9bd8f5,28,72);
  camera=new THREE.PerspectiveCamera(42,root.clientWidth/root.clientHeight,.1,120);camera.position.set(0,23,24);camera.lookAt(0,0,0);
  renderer=new THREE.WebGLRenderer({antialias:true,alpha:true});renderer.setPixelRatio(Math.min(devicePixelRatio,2));renderer.setSize(root.clientWidth,root.clientHeight);renderer.shadowMap.enabled=true;root.appendChild(renderer.domElement);
  scene.add(new THREE.HemisphereLight(0xffffff,0x4f6c7a,1.35));
  const sun=new THREE.DirectionalLight(0xffffff,1.6);sun.position.set(12,28,8);sun.castShadow=true;sun.shadow.mapSize.set(2048,2048);scene.add(sun);
  boardGroup=new THREE.Group();scene.add(boardGroup);
  makePhysicalBoard();makeClouds3D();
  window.addEventListener("resize",onResize);setupOrbit(root);animate();
}
function makePhysicalBoard(){
  tileMeshes.length=0;
  while(boardGroup.children.length)boardGroup.remove(boardGroup.children[0]);
  const base=new THREE.Mesh(new THREE.BoxGeometry(22,1.1,22),new THREE.MeshStandardMaterial({color:0x6e3f24,roughness:.65}));
  base.position.y=-.7;base.castShadow=base.receiveShadow=true;boardGroup.add(base);
  const felt=new THREE.Mesh(new THREE.BoxGeometry(18.4,.35,18.4),new THREE.MeshStandardMaterial({color:0xdde8d5,roughness:.86}));
  felt.position.y=.02;felt.receiveShadow=true;boardGroup.add(felt);
  const railMat=new THREE.MeshStandardMaterial({color:0x4f2b1a,roughness:.5});
  [[0,1,11.1,.65],[0,-11.1,11.1,.65],[11.1,0,.65,11.1],[-11.1,0,.65,11.1]].forEach(([x,z,w,d])=>{
    const m=new THREE.Mesh(new THREE.BoxGeometry(w*2,.9,d*2),railMat);m.position.set(x,.35,z);m.castShadow=true;boardGroup.add(m);
  });
  // side drawers inspired by physical board trays
  [["left",-12.2,0,2.2,7],["right",12.2,0,2.2,7]].forEach(([n,x,z,w,d])=>{
    const drawer=new THREE.Mesh(new THREE.BoxGeometry(w,.55,d),new THREE.MeshStandardMaterial({color:0x8a5434,roughness:.58}));
    drawer.position.set(x,-.35,z);drawer.castShadow=true;boardGroup.add(drawer);
  });
  if(!state)return;
  state.board.forEach((t,i)=>{
    const p=tileCoord(i), tex=textureForTile(t,i);
    const mat=[new THREE.MeshStandardMaterial({color:0xd8c6a9}),new THREE.MeshStandardMaterial({color:0xd8c6a9}),new THREE.MeshStandardMaterial({color:0xd8c6a9}),new THREE.MeshStandardMaterial({color:0xd8c6a9}),new THREE.MeshStandardMaterial({map:tex,roughness:.82}),new THREE.MeshStandardMaterial({color:0xcab28c})];
    const mesh=new THREE.Mesh(new THREE.BoxGeometry(1.62,.25,1.62),mat);
    mesh.position.set(p.x,.30,p.z);mesh.rotation.y=tileRotation(i);mesh.receiveShadow=true;mesh.castShadow=true;mesh.userData={tileIndex:i};boardGroup.add(mesh);tileMeshes[i]=mesh;
  });
}
function tileRotation(i){if(i<=10)return 0;if(i<=20)return -Math.PI/2;if(i<=30)return Math.PI;return Math.PI/2;}

function makeClouds3D(){
  cloudGroup=new THREE.Group();scene.add(cloudGroup);
  for(let i=0;i<12;i++){
    const g=new THREE.Group();
    const mat=new THREE.MeshStandardMaterial({color:0xffffff,transparent:true,opacity:.62,roughness:1});
    [[0,0,0,1.6],[1.3,.15,0,1.15],[-1.2,.1,.1,1.0],[.35,.6,.05,1.05]].forEach(a=>{
      const m=new THREE.Mesh(new THREE.SphereGeometry(a[3],18,12),mat);m.position.set(a[0],a[1],a[2]);g.add(m);
    });
    g.position.set(-28+Math.random()*56,7+Math.random()*10,-25+Math.random()*50);g.scale.setScalar(.5+Math.random()*1.3);g.userData.speed=.004+Math.random()*.009;cloudGroup.add(g);
  }
}
function updateClouds(){if(!cloudGroup)return;cloudGroup.children.forEach(c=>{c.position.x+=c.userData.speed;if(c.position.x>30)c.position.x=-30;});}
function setupOrbit(root){
  let down=false,lx=0,ly=0,az=0,el=.62,dist=33;
  const apply=()=>{camera.position.set(Math.sin(az)*dist,Math.sin(el)*dist,Math.cos(az)*dist);camera.lookAt(0,0,0);};
  root.addEventListener("pointerdown",e=>{down=true;lx=e.clientX;ly=e.clientY;root.setPointerCapture(e.pointerId);});
  root.addEventListener("pointermove",e=>{if(!down)return;az-=(e.clientX-lx)*.005;el=Math.max(.28,Math.min(1.05,el+(e.clientY-ly)*.004));lx=e.clientX;ly=e.clientY;apply();});
  root.addEventListener("pointerup",()=>down=false);root.addEventListener("pointercancel",()=>down=false);
  root.addEventListener("wheel",e=>{dist=Math.max(20,Math.min(48,dist+e.deltaY*.015));apply();e.preventDefault();},{passive:false});apply();
}
function onResize(){const r=$("threeRoot");if(!r||!renderer)return;camera.aspect=r.clientWidth/r.clientHeight;camera.updateProjectionMatrix();renderer.setSize(r.clientWidth,r.clientHeight);}
function animate(){
  requestAnimationFrame(animate);updateClouds();animateTokens();renderer?.render(scene,camera);
}
function disposeGroup(g){g.traverse(o=>{o.geometry?.dispose?.();if(Array.isArray(o.material))o.material.forEach(m=>m.dispose?.());else o.material?.dispose?.();});}

function tokenModel(character,accent){
  const g=new THREE.Group(), mat=new THREE.MeshStandardMaterial({color:new THREE.Color(accent),metalness:.2,roughness:.42}),dark=new THREE.MeshStandardMaterial({color:0x20252b,roughness:.6}),white=new THREE.MeshStandardMaterial({color:0xffffff});
  const box=(w,h,d,x,y,z,m=mat)=>{const q=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),m);q.position.set(x,y,z);q.castShadow=true;g.add(q);return q;};
  const cyl=(r,h,x,y,z,rot=0,m=dark)=>{const q=new THREE.Mesh(new THREE.CylinderGeometry(r,r,h,16),m);q.position.set(x,y,z);q.rotation.z=rot;q.castShadow=true;g.add(q);return q;};
  if(character==="car"){
    box(1.05,.32,.62,0,.34,0);box(.55,.28,.52,-.05,.62,0,white);
    [-.38,.38].forEach(x=>[-.34,.34].forEach(z=>{const w=cyl(.16,.10,x,.20,z,Math.PI/2);w.userData.wheel=true;}));
  }else if(character==="plane"){
    box(1.2,.18,.22,0,.48,0);box(.22,.18,1.15,-.05,.48,0);box(.25,.42,.20,-.48,.68,0);
    const prop=cyl(.05,.95,.62,.48,0,Math.PI/2,white);prop.userData.prop=true;
  }else if(character==="boat"){
    const hull=new THREE.Mesh(new THREE.ConeGeometry(.55,1.25,4),mat);hull.rotation.z=Math.PI/2;hull.position.y=.38;hull.castShadow=true;g.add(hull);
    box(.05,.85,.05,0,.9,0,dark);const sail=new THREE.Mesh(new THREE.ConeGeometry(.48,.9,3),white);sail.position.set(.12,.98,0);sail.rotation.z=-.15;g.add(sail);
  }else if(character==="bike"){
    [-.43,.43].forEach(x=>{const w=cyl(.28,.07,x,.32,0,Math.PI/2);w.userData.wheel=true;});
    const frame=new THREE.Mesh(new THREE.TorusGeometry(.35,.05,10,20,Math.PI),mat);frame.rotation.y=Math.PI/2;frame.position.y=.48;g.add(frame);box(.38,.08,.08,0,.72,0,dark);
  }else{
    const body=cyl(.27,.95,0,.7,0,0,mat);const nose=new THREE.Mesh(new THREE.ConeGeometry(.28,.42,18),white);nose.position.y=1.38;g.add(nose);
    [-.28,.28].forEach(x=>box(.18,.35,.1,x,.48,0,mat));const flame=new THREE.Mesh(new THREE.ConeGeometry(.18,.5,12),new THREE.MeshStandardMaterial({color:0xff8a00,emissive:0xff4d00,emissiveIntensity:1.3}));flame.position.y=.0;flame.rotation.x=Math.PI;flame.userData.flame=true;g.add(flame);
  }
  g.scale.setScalar(.82);return g;
}

function syncTokens(){
  if(!state||!boardGroup)return;
  state.players.forEach((p,idx)=>{
    if(p.bankrupt){const old=tokenGroups.get(p.id);if(old){boardGroup.remove(old);disposeGroup(old);tokenGroups.delete(p.id);}return;}
    let g=tokenGroups.get(p.id);
    if(!g){g=tokenModel(p.character,p.accent);boardGroup.add(g);tokenGroups.set(p.id,g);const pos=tileCoord(p.pos);g.position.set(pos.x,.62,pos.z);}
    const pos=tileCoord(p.pos), offset=(idx%3-.9)*.24;
    tokenTargets.set(p.id,{x:pos.x+offset,z:pos.z+((idx%2)?-.22:.22),pos:p.pos});
  });
}
function animateTokens(){
  const t=performance.now()/1000;
  tokenGroups.forEach((g,id)=>{
    const target=tokenTargets.get(id);if(!target)return;
    const dx=target.x-g.position.x,dz=target.z-g.position.z,dist=Math.hypot(dx,dz);
    if(dist>.02){
      const speed=Math.min(.085,dist*.14);g.position.x+=dx*speed;g.position.z+=dz*speed;
      g.rotation.y=Math.atan2(dx,dz);
      g.position.y=.66+Math.sin(t*9)*.08;
      g.children.forEach(c=>{if(c.userData.wheel)c.rotation.x+=.18;if(c.userData.prop)c.rotation.x+=.5;if(c.userData.flame)c.scale.y=.75+Math.sin(t*16)*.25;});
    }else{
      g.position.y=.66+Math.sin(t*2+id.length)*.025;
      if(g.children.some(c=>c.userData.prop))g.rotation.z=Math.sin(t*2)*.04;
    }
  });
}
function syncBuildings(){
  if(!state||!boardGroup)return;
  buildingGroups.forEach((g,idx)=>{boardGroup.remove(g);disposeGroup(g);});buildingGroups.clear();
  Object.entries(state.buildings||{}).forEach(([k,level])=>{
    const idx=Number(k);if(!level)return;const p=tileCoord(idx),g=new THREE.Group();
    const houseMat=new THREE.MeshStandardMaterial({color:0x2ca25f,roughness:.6}),hotelMat=new THREE.MeshStandardMaterial({color:0xc9302c,roughness:.55});
    if(level<5){
      for(let n=0;n<level;n++){const h=new THREE.Mesh(new THREE.BoxGeometry(.28,.34,.28),houseMat);h.position.set((n%2)*.36-.18,.22,Math.floor(n/2)*.36-.18);h.castShadow=true;g.add(h);}
    }else{const h=new THREE.Mesh(new THREE.BoxGeometry(.72,.62,.42),hotelMat);h.position.y=.35;h.castShadow=true;g.add(h);}
    g.position.set(p.x,.52,p.z);boardGroup.add(g);buildingGroups.set(idx,g);
  });
}
function syncOwners(){
  if(!state)return;
  tileMeshes.forEach((m,i)=>{
    if(!m)return;const owner=state.players.find(p=>p.id===state.owners[i]);
    if(owner)m.scale.y=1.32;else m.scale.y=1;
  });
}

function pulseDice(){document.querySelectorAll(".die").forEach(d=>{d.animate([{transform:"rotate(0) scale(1)"},{transform:"rotate(22deg) scale(1.18)"},{transform:"rotate(-14deg) scale(1.08)"},{transform:"rotate(0) scale(1)"}],{duration:520});});}
function renderPlayers(){
  $("players").innerHTML=state.players.map(p=>`<div class="player-row ${p.id===state.currentPlayerId?"current-player":""} ${p.bankrupt?"bankrupt":""}">
    <div class="player-icon">${charEmoji[p.character]||"🎯"}</div><div><div class="player-name">${esc(p.name)}</div><div class="player-meta">${p.character} · tile ${p.pos}</div></div><div class="cash">${money(p.money)}</div></div>`).join("");
}
function renderLog(){$("log").innerHTML=state.log.slice().reverse().map(x=>`<div>${esc(x)}</div>`).join("");}
function esc(s){return String(s).replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[m]));}
function me(){return state.players.find(p=>p.id===myId);}
function tile(){const p=me();return p?state.board[p.pos]:null;}
function renderControls(){
  const p=me(),mine=state.currentPlayerId===myId,host=state.players[0]?.id===myId,t=tile();
  $("roomSettings").textContent=`${state.players.length}/5 players · Start ${money(state.startMoney)}`;
  $("startBtn").classList.toggle("hidden",state.started||!host);$("startBtn").disabled=state.players.length<2;
  const hasRolled=!!p?.hasRolled;
  if(state.winner){const w=state.players.find(x=>x.id===state.winner);$("turnText").textContent=`🏆 ${w?.name||"Player"} wins!`;}
  else if(!state.started)$("turnText").textContent=`${state.players.length} joined · host can start at 2`;
  else $("turnText").textContent=mine?"YOUR TURN":`${state.players.find(x=>x.id===state.currentPlayerId)?.name||"Player"}'s turn`;
  $("rollBtn").disabled=!state.started||!mine||hasRolled||!!state.winner||!!state.auction;
  const pp=state.pendingPurchase;
  const canBuy=!!(mine&&pp&&pp.playerId===myId&&pp.tileIndex===p?.pos);
  $("buyBtn").disabled=!canBuy;$("auctionBtn").disabled=!canBuy;
  $("endBtn").disabled=!state.started||!mine||!hasRolled||!!state.auction;
  $("tradeBtn").disabled=!state.started||state.players.filter(x=>!x.bankrupt&&x.id!==myId).length===0;
  $("buildBtn").disabled=!state.started||!Object.keys(state.owners).some(i=>state.owners[i]===myId&&state.board[i]?.type==="property");
}
function renderTimer(){
  if(!state?.started||!state.turnDeadline){$("timerText").textContent="45s";$("timerFill").style.width="100%";return;}
  const s=Math.max(0,Math.ceil((state.turnDeadline-Date.now())/1000));$("timerText").textContent=`${s}s`;
  $("timerFill").style.width=`${Math.max(0,Math.min(100,s/state.turnSeconds*100))}%`;
}
setInterval(renderTimer,250);

$("propertyBtn").onclick=()=>{renderProperties();$("propertyModal").classList.remove("hidden");};
function renderProperties(){
  const p=me();if(!p)return;
  const ids=Object.keys(state.owners).map(Number).filter(i=>state.owners[i]===myId);
  $("propertyList").innerHTML=ids.length?ids.map(i=>{
    const t=state.board[i],level=state.buildings[i]||0;
    const ownedSame=t.type==="railway"?Object.keys(state.owners).filter(k=>state.owners[k]===myId&&state.board[k].type==="railway").length:t.type==="utility"?Object.keys(state.owners).filter(k=>state.owners[k]===myId&&state.board[k].type==="utility").length:0;
    const rent=t.type==="property"?t.rent*[1,5,15,45,80,125][level]:t.type==="railway"?400*ownedSame:250*ownedSame;
    return `<div class="property-item"><div class="property-title">${esc(t.name)}</div><div>${t.group?`<span class="group-badge" style="background:${groupCss[t.group]}">${t.group}</span>`:""} ${t.type}</div><div>Current rent: <b>${money(rent)}</b></div>${t.type==="property"?`<div>Buildings: ${level===5?"🏨 Hotel":"🏠".repeat(level)||"None"} · Build ${money(t.buildCost)}</div><button onclick="buildAt(${i})" ${level>=5?"disabled":""}>Build here</button>`:""}</div>`;
  }).join(""):`<p>You don't own any properties yet.</p>`;
}
window.buildAt=i=>socket.emit("build",{tileIndex:i});
$("buildBtn").onclick=()=>{$("propertyBtn").click();};

$("tradeBtn").onclick=()=>{renderTrade();$("tradeModal").classList.remove("hidden");};
$("tradeTarget").onchange=renderTradeLists;
function renderTrade(){
  const others=state.players.filter(p=>p.id!==myId&&!p.bankrupt);
  $("tradeTarget").innerHTML=others.map(p=>`<option value="${p.id}">${esc(p.name)} · ${charEmoji[p.character]}</option>`).join("");
  $("offerMoney").value=0;$("requestMoney").value=0;renderTradeLists();
}
function renderTradeLists(){
  const target=$("tradeTarget").value;
  const mine=Object.keys(state.owners).map(Number).filter(i=>state.owners[i]===myId);
  const theirs=Object.keys(state.owners).map(Number).filter(i=>state.owners[i]===target);
  $("offerProps").innerHTML=mine.length?mine.map(i=>`<label class="checkrow"><input type="checkbox" data-offer="${i}"> ${esc(state.board[i].name)}</label>`).join(""):"<small>No properties</small>";
  $("requestProps").innerHTML=theirs.length?theirs.map(i=>`<label class="checkrow"><input type="checkbox" data-request="${i}"> ${esc(state.board[i].name)}</label>`).join(""):"<small>No properties</small>";
}
$("tradeSend").onclick=()=>{
  const offerProperties=[...document.querySelectorAll("[data-offer]:checked")].map(x=>Number(x.dataset.offer));
  const requestProperties=[...document.querySelectorAll("[data-request]:checked")].map(x=>Number(x.dataset.request));
  socket.emit("sendTrade",{toId:$("tradeTarget").value,offerMoney:Number($("offerMoney").value)||0,requestMoney:Number($("requestMoney").value)||0,offerProperties,requestProperties});
  $("tradeModal").classList.add("hidden");
};
function renderTradeOffer(o){
  const from=state?.players.find(p=>p.id===o.fromId);
  $("tradeOfferTitle").textContent=`${o.fromName||from?.name||"Player"} wants to trade`;
  const names=arr=>arr.length?arr.map(i=>state.board[i]?.name).join(", "):"No property";
  $("tradeOfferBody").innerHTML=`<p><b>You receive:</b> ${money(o.offerMoney)} + ${esc(names(o.offerProperties))}</p><p><b>You give:</b> ${money(o.requestMoney)} + ${esc(names(o.requestProperties))}</p>`;
}

function renderAuction(){
  if(!state.auction){$("auctionModal").classList.add("hidden");return;}
  const a=state.auction,t=state.board[a.tileIndex],bidder=state.players.find(p=>p.id===a.highestBidder);
  $("auctionTitle").textContent=t.name;
  const sec=Math.max(0,Math.ceil((a.deadline-Date.now())/1000));
  $("auctionInfo").innerHTML=`<p>Highest bid: <b>${money(a.highestBid)}</b></p><p>Leader: <b>${esc(bidder?.name||"No bids")}</b></p><p>Closing in about ${sec}s</p>`;
  $("bidAmount").min=a.highestBid+100;$("bidAmount").placeholder=`Minimum ${money(a.highestBid+100)}`;
  $("auctionModal").classList.remove("hidden");
}
$("bidBtn").onclick=()=>socket.emit("bid",{amount:Number($("bidAmount").value)});
setInterval(()=>{if(state?.auction)renderAuction();},500);

socket.on("state",s=>{
  const first=!state,turnChanged=state&&state.currentPlayerId!==s.currentPlayerId;
  state=s;if(turnChanged&&s.currentPlayerId===myId)rolled=false;
  if(renderer && (first||tileMeshes.length===0))makePhysicalBoard();
  renderPlayers();renderLog();renderControls();renderAuction();syncTokens();syncOwners();syncBuildings();
});

$("musicBtn").onclick=()=>{musicOn=!musicOn;if(musicOn)startMusic();else stopMusic();$("musicBtn").textContent=musicOn?"🎵 Music On":"🎵 Music Off";};
function startMusic(){
  if(!audioCtx)audioCtx=new (window.AudioContext||window.webkitAudioContext)();
  if(audioCtx.state==="suspended")audioCtx.resume();
  if(musicTimer)return;
  // Original generative piano/strings pattern: no copyrighted recording or famous-song melody.
  const scale=[0,3,5,7,10,12,15,17],base=220;
  let step=0;
  const play=()=>{
    if(!musicOn)return;
    const now=audioCtx.currentTime;
    const note=base*Math.pow(2,scale[step%scale.length]/12);
    const o=audioCtx.createOscillator(),g=audioCtx.createGain(),f=audioCtx.createBiquadFilter();
    o.type=step%4===0?"triangle":"sine";o.frequency.value=note;f.type="lowpass";f.frequency.value=1200;
    g.gain.setValueAtTime(.0001,now);g.gain.exponentialRampToValueAtTime(.045,now+.03);g.gain.exponentialRampToValueAtTime(.0001,now+1.7);
    o.connect(f);f.connect(g);g.connect(audioCtx.destination);o.start(now);o.stop(now+1.8);
    if(step%4===0){const b=audioCtx.createOscillator(),bg=audioCtx.createGain();b.type="sine";b.frequency.value=note/2;bg.gain.setValueAtTime(.0001,now);bg.gain.exponentialRampToValueAtTime(.025,now+.08);bg.gain.exponentialRampToValueAtTime(.0001,now+2.4);b.connect(bg);bg.connect(audioCtx.destination);b.start(now);b.stop(now+2.5);}
    step++;musicTimer=setTimeout(play,680);
  };play();
}
function stopMusic(){clearTimeout(musicTimer);musicTimer=null;}

const preset=new URLSearchParams(location.search).get("room");
if(preset){$("roomCode").value=preset.toUpperCase();$("startMoney").disabled=true;}
