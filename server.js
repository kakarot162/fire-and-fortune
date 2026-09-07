const express = require("express");
const http = require("http");
const path = require("path");
const crypto = require("crypto");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });
app.use(express.static(path.join(__dirname, "public")));

const PORT = process.env.PORT || 3000;
const rooms = new Map();

const CHARACTERS = ["car","plane","boat","bike","rocket"];
const PLAYER_ACCENTS = ["#ff4b55","#2f80ed","#17b26a","#f4b740","#9b51e0"];
const START_MONEY_OPTIONS = [5000,10000,15000,20000,25000,30000];
const TURN_SECONDS = 45;
const AUCTION_SECONDS = 20;

function property(name, group, price, rent, buildCost) {
  return {name,type:"property",group,price,rent,buildCost};
}
function utility(name, utilityKind) {
  return {name,type:"utility",utilityKind,price:1800,rent:250};
}
function railway(name) {
  return {name,type:"railway",price:2400,rent:400};
}

const BOARD = [
  {name:"START",type:"go"},
  property("Copper Court","brown",600,60,500),
  property("Walnut Walk","brown",700,70,500),
  {name:"Chance",type:"chance"},
  utility("Crystal Water I","water"),
  railway("North Railway"),
  property("Cocoa Crescent","brown",800,80,500),
  property("Chestnut Lane","brown",900,90,500),
  utility("Solar Grid I","electricity"),
  {name:"Random",type:"random"},

  {name:"JAIL / VISITING",type:"jail"},
  property("Ruby Road","red",1200,120,800),
  utility("Crystal Water II","water"),
  property("Crimson Avenue","red",1300,130,800),
  property("Scarlet Street","red",1400,140,800),
  railway("East Railway"),
  utility("Solar Grid II","electricity"),
  property("Rose Boulevard","red",1500,150,800),
  {name:"Chance",type:"chance"},
  property("Sunbeam Street","yellow",1800,180,1100),

  {name:"FREE PARKING",type:"free"},
  property("Golden Gate","yellow",1900,190,1100),
  utility("Crystal Water III","water"),
  property("Amber Avenue","yellow",2000,200,1100),
  railway("South Railway"),
  property("Honeycomb Heights","yellow",2200,220,1100),
  utility("Solar Grid III","electricity"),
  {name:"Random",type:"random"},
  property("Azure Avenue","blue",2600,260,1500),
  property("Sapphire Street","blue",2800,280,1500),

  {name:"GO TO JAIL",type:"gotojail"},
  utility("Crystal Water IV","water"),
  property("Ocean Drive","blue",3000,300,1500),
  railway("West Railway"),
  property("Cobalt Court","blue",3200,320,1500),
  utility("Solar Grid IV","electricity"),
  property("Tangerine Terrace","orange",3600,360,1900),
  property("Ember Estate","orange",3900,390,1900),
  property("Sunset Square","orange",4200,420,1900),
  property("Firelight Heights","orange",4500,450,1900)
];

const CHANCE = [
  {text:"🔥 Market blaze! Collect $1,200.", effect:{kind:"money",amount:1200}},
  {text:"🚔 Inspection disaster. Go directly to jail.", effect:{kind:"jail"}},
  {text:"✈️ Express flight: move forward 6 spaces.", effect:{kind:"move",amount:6}},
  {text:"🔁 Wrong turn: move back 4 spaces.", effect:{kind:"move",amount:-4}},
  {text:"💼 Consulting windfall. Collect $900.", effect:{kind:"money",amount:900}},
  {text:"🎁 Each opponent pays you $250.", effect:{kind:"collectAll",amount:250}},
  {text:"💸 Emergency repairs. Pay $700.", effect:{kind:"money",amount:-700}},
  {text:"🌀 Swap positions with a random opponent.", effect:{kind:"swap"}},
  {text:"🏁 Return to START and collect $1,000.", effect:{kind:"go"}},
  {text:"🎲 Double momentum: take another turn.", effect:{kind:"extraTurn"}}
];

const RANDOM = [
  {text:"☁️ A lucky cloud drops $750 into your account.", effect:{kind:"money",amount:750}},
  {text:"⚡ Grid surcharge. Pay $450.", effect:{kind:"money",amount:-450}},
  {text:"🚀 Tailwind! Move forward 5 spaces.", effect:{kind:"move",amount:5}},
  {text:"🌧️ Storm delay. Skip your next turn.", effect:{kind:"skip"}},
  {text:"🏆 Business award. Collect $1,000.", effect:{kind:"money",amount:1000}},
  {text:"🤝 Give the poorest opponent $400.", effect:{kind:"givePoor",amount:400}},
  {text:"🪙 Dividend day. Every active player gets $300.", effect:{kind:"allMoney",amount:300}},
  {text:"🕳️ Detour! Move back 5 spaces.", effect:{kind:"move",amount:-5}},
  {text:"💰 Surprise refund. Collect $500.", effect:{kind:"money",amount:500}},
  {text:"🧾 Maintenance week. Pay $350.", effect:{kind:"money",amount:-350}}
];

function randomInt(max){ return crypto.randomInt(0,max); }
function rollDie(){ return crypto.randomInt(1,7); }
function sanitizeName(v){ return String(v||"").replace(/[<>]/g,"").trim().slice(0,20) || "Player"; }
function money(v){ return Math.max(0, Math.floor(Number(v)||0)); }

function newRoom(code,startMoney){
  return {
    code,
    started:false,
    startMoney: START_MONEY_OPTIONS.includes(startMoney) ? startMoney : 15000,
    players:[],
    turnIndex:0,
    owners:{},
    buildings:{},
    log:["Room created."],
    winner:null,
    turnDeadline:null,
    pendingPurchase:null,
    auction:null,
    tradeOffers:{}
  };
}

function activePlayers(room){ return room.players.filter(p=>!p.bankrupt); }
function ownerPlayer(room,idx){
  const id=room.owners[idx];
  return room.players.find(p=>p.id===id);
}
function log(room,msg){
  room.log.push(msg);
  if(room.log.length>120) room.log.shift();
}
function safeState(room){
  return {
    code:room.code,
    started:room.started,
    startMoney:room.startMoney,
    players:room.players,
    turnIndex:room.turnIndex,
    currentPlayerId:room.players[room.turnIndex]?.id||null,
    owners:room.owners,
    buildings:room.buildings,
    board:BOARD,
    log:room.log.slice(-35),
    winner:room.winner,
    turnDeadline:room.turnDeadline,
    pendingPurchase:room.pendingPurchase,
    auction:room.auction,
    turnSeconds:TURN_SECONDS
  };
}
function emit(room){ io.to(room.code).emit("state",safeState(room)); }

function resetTurnClock(room){
  room.turnDeadline = Date.now() + TURN_SECONDS*1000;
}
function current(room){ return room.players[room.turnIndex]; }

function advanceTurn(room){
  if(room.winner) return;
  let guard=0;
  while(guard < room.players.length*2){
    room.turnIndex=(room.turnIndex+1)%room.players.length;
    const p=current(room);
    guard++;
    if(!p || p.bankrupt) continue;
    if(p.skip>0){
      p.skip--;
      log(room,`${p.name} skips this turn.`);
      continue;
    }
    room.pendingPurchase=null;
    resetTurnClock(room);
    return;
  }
}

function movePlayer(room,p,delta){
  let raw=p.pos+delta;
  if(delta>0 && raw>=BOARD.length){
    p.money+=1000;
    log(room,`${p.name} passed START and collected $1,000.`);
  }
  while(raw<0) raw+=BOARD.length;
  p.pos=((raw%BOARD.length)+BOARD.length)%BOARD.length;
}

function countOwned(room,pid,type){
  return Object.entries(room.owners).filter(([idx,owner])=>{
    if(owner!==pid) return false;
    return BOARD[Number(idx)]?.type===type;
  }).length;
}
function utilityCount(room,pid){
  return Object.entries(room.owners).filter(([idx,owner])=>{
    if(owner!==pid) return false;
    return BOARD[Number(idx)]?.type==="utility";
  }).length;
}
function rentFor(room,idx){
  const t=BOARD[idx], owner=ownerPlayer(room,idx);
  if(!t || !owner) return 0;
  if(t.type==="railway") return 400*countOwned(room,owner.id,"railway");
  if(t.type==="utility") return 250*utilityCount(room,owner.id);
  if(t.type==="property"){
    const level=room.buildings[idx]||0;
    const mult=[1,5,15,45,80,125][level]||1;
    return t.rent*mult;
  }
  return 0;
}

function ownsGroup(room,pid,group){
  const ids=BOARD.map((t,i)=>({t,i})).filter(x=>x.t.type==="property" && x.t.group===group).map(x=>x.i);
  return ids.length>0 && ids.every(i=>room.owners[i]===pid);
}
function groupIndexes(group){
  return BOARD.map((t,i)=>({t,i})).filter(x=>x.t.type==="property" && x.t.group===group).map(x=>x.i);
}
function canBuildEvenly(room,pid,idx){
  const t=BOARD[idx];
  if(!t || t.type!=="property" || room.owners[idx]!==pid || !ownsGroup(room,pid,t.group)) return false;
  const group=groupIndexes(t.group);
  const levels=group.map(i=>room.buildings[i]||0);
  const here=room.buildings[idx]||0;
  if(here>=5) return false;
  return here===Math.min(...levels);
}

function checkBankrupt(room,p){
  if(p.money>=0 || p.bankrupt) return;
  p.bankrupt=true;
  log(room,`${p.name} is bankrupt.`);
  Object.keys(room.owners).forEach(k=>{ if(room.owners[k]===p.id){delete room.owners[k]; delete room.buildings[k];} });
  const alive=activePlayers(room);
  if(room.started && alive.length===1){
    room.winner=alive[0].id;
    room.turnDeadline=null;
    log(room,`🏆 ${alive[0].name} wins!`);
  }
}

function applyCard(room,p,deck,label){
  const card=deck[randomInt(deck.length)];
  log(room,`${label}: ${card.text}`);
  io.to(room.code).emit("card",{playerId:p.id,label,text:card.text});
  const e=card.effect;
  if(e.kind==="money") p.money+=e.amount;
  else if(e.kind==="move"){ movePlayer(room,p,e.amount); land(room,p,true); }
  else if(e.kind==="jail"){p.pos=10;p.jail=1;}
  else if(e.kind==="collectAll"){
    room.players.filter(x=>x.id!==p.id&&!x.bankrupt).forEach(x=>{const a=Math.min(e.amount,Math.max(0,x.money));x.money-=a;p.money+=a;});
  }
  else if(e.kind==="swap"){
    const others=room.players.filter(x=>x.id!==p.id&&!x.bankrupt);
    if(others.length){const x=others[randomInt(others.length)];[p.pos,x.pos]=[x.pos,p.pos];log(room,`${p.name} swapped positions with ${x.name}.`);}
  }
  else if(e.kind==="go"){p.pos=0;p.money+=1000;}
  else if(e.kind==="extraTurn")p.extraTurn=true;
  else if(e.kind==="skip")p.skip++;
  else if(e.kind==="givePoor"){
    const others=room.players.filter(x=>x.id!==p.id&&!x.bankrupt).sort((a,b)=>a.money-b.money);
    if(others.length){const a=Math.min(e.amount,Math.max(0,p.money));p.money-=a;others[0].money+=a;}
  }
  else if(e.kind==="allMoney")activePlayers(room).forEach(x=>x.money+=e.amount);
  checkBankrupt(room,p);
}

function land(room,p,fromCard=false){
  const t=BOARD[p.pos];
  room.pendingPurchase=null;
  if(!t) return;
  if(["property","railway","utility"].includes(t.type)){
    const owner=ownerPlayer(room,p.pos);
    if(owner && owner.id!==p.id && !owner.bankrupt){
      const rent=rentFor(room,p.pos);
      p.money-=rent; owner.money+=rent;
      log(room,`${p.name} paid $${rent.toLocaleString()} rent to ${owner.name} for ${t.name}.`);
      checkBankrupt(room,p);
    } else if(!owner){
      room.pendingPurchase={playerId:p.id,tileIndex:p.pos};
      log(room,`${p.name} may buy ${t.name} for $${t.price.toLocaleString()} or auction it.`);
    }
  } else if(t.type==="chance"){
    applyCard(room,p,CHANCE,"Chance");
  } else if(t.type==="random"){
    applyCard(room,p,RANDOM,"Random");
  } else if(t.type==="gotojail"){
    p.pos=10;p.jail=1;log(room,`${p.name} was sent to jail.`);
  }
}

function startAuction(room,idx,starterId){
  const t=BOARD[idx];
  if(!t || room.owners[idx]) return false;
  room.pendingPurchase=null;
  room.auction={
    tileIndex:idx,
    highestBid:0,
    highestBidder:null,
    deadline:Date.now()+AUCTION_SECONDS*1000,
    starterId
  };
  log(room,`🔨 Auction started for ${t.name}.`);
  return true;
}

function finishAuction(room){
  const a=room.auction;
  if(!a) return;
  const t=BOARD[a.tileIndex];
  if(a.highestBidder && a.highestBid>0){
    const p=room.players.find(x=>x.id===a.highestBidder && !x.bankrupt);
    if(p && p.money>=a.highestBid){
      p.money-=a.highestBid;
      room.owners[a.tileIndex]=p.id;
      log(room,`${p.name} won ${t.name} for $${a.highestBid.toLocaleString()}.`);
    } else log(room,`Auction ended without a valid winner.`);
  } else log(room,`Auction ended with no bids.`);
  room.auction=null;
  const p=current(room);
  if(p?.extraTurn){p.extraTurn=false;resetTurnClock(room);}
  else advanceTurn(room);
  emit(room);
}

function validateTrade(room,offer){
  const from=room.players.find(p=>p.id===offer.fromId&&!p.bankrupt);
  const to=room.players.find(p=>p.id===offer.toId&&!p.bankrupt);
  if(!from||!to||from.id===to.id) return false;
  if(from.money<offer.offerMoney || to.money<offer.requestMoney) return false;
  if(!offer.offerProperties.every(i=>room.owners[i]===from.id)) return false;
  if(!offer.requestProperties.every(i=>room.owners[i]===to.id)) return false;
  return true;
}

io.on("connection",socket=>{
  socket.on("createRoom",({name,character,startMoney})=>{
    const char=CHARACTERS.includes(character)?character:"car";
    let code; do{code=crypto.randomBytes(3).toString("hex").toUpperCase();}while(rooms.has(code));
    const room=newRoom(code,Number(startMoney));
    const p={id:socket.id,name:sanitizeName(name),character:char,accent:PLAYER_ACCENTS[0],pos:0,money:room.startMoney,jail:0,skip:0,extraTurn:false,bankrupt:false};
    room.players.push(p);rooms.set(code,room);socket.join(code);socket.data.roomCode=code;
    log(room,`${p.name} joined as ${char}.`);
    socket.emit("roomCreated",{code});emit(room);
  });

  socket.on("joinRoom",({name,code,character})=>{
    code=String(code||"").trim().toUpperCase();
    const room=rooms.get(code);
    if(!room)return socket.emit("errorMsg","Room not found.");
    if(room.started)return socket.emit("errorMsg","Game already started.");
    if(room.players.length>=5)return socket.emit("errorMsg","Room is full.");
    const char=CHARACTERS.includes(character)?character:"car";
    if(room.players.some(p=>p.character===char&&!p.bankrupt))return socket.emit("errorMsg","That character is already taken. Choose another.");
    const p={id:socket.id,name:sanitizeName(name),character:char,accent:PLAYER_ACCENTS[room.players.length],pos:0,money:room.startMoney,jail:0,skip:0,extraTurn:false,bankrupt:false};
    room.players.push(p);socket.join(code);socket.data.roomCode=code;
    log(room,`${p.name} joined as ${char}.`);
    socket.emit("joinedRoom",{code});emit(room);
  });

  socket.on("startGame",()=>{
    const room=rooms.get(socket.data.roomCode);
    if(!room||room.players[0]?.id!==socket.id||room.started)return;
    if(room.players.length<2)return socket.emit("errorMsg","At least 2 players are required.");
    room.started=true;room.turnIndex=randomInt(room.players.length);resetTurnClock(room);
    log(room,`${current(room).name} goes first — selected randomly.`);
    emit(room);
  });

  socket.on("rollDice",()=>{
    const room=rooms.get(socket.data.roomCode); if(!room||!room.started||room.winner||room.auction)return;
    const p=current(room); if(!p||p.id!==socket.id||p.bankrupt)return;
    if(p.hasRolled)return;
    if(p.jail>0){p.jail--;p.hasRolled=true;log(room,`${p.name} serves a jail turn.`);emit(room);return;}
    const d1=rollDie(),d2=rollDie(),total=d1+d2;
    p.hasRolled=true;
    io.to(room.code).emit("dice",{playerId:p.id,d1,d2,total});
    log(room,`${p.name} rolled ${d1} + ${d2} = ${total}.`);
    movePlayer(room,p,total);land(room,p);emit(room);
  });

  socket.on("buyProperty",()=>{
    const room=rooms.get(socket.data.roomCode); if(!room||room.auction)return;
    const p=current(room); const pp=room?.pendingPurchase;
    if(!p||p.id!==socket.id||!pp||pp.playerId!==p.id)return;
    const t=BOARD[pp.tileIndex];
    if(room.owners[pp.tileIndex])return;
    if(p.money<t.price)return socket.emit("errorMsg","Not enough money.");
    p.money-=t.price;room.owners[pp.tileIndex]=p.id;room.pendingPurchase=null;
    log(room,`${p.name} bought ${t.name} for $${t.price.toLocaleString()}.`);emit(room);
  });

  socket.on("startAuction",()=>{
    const room=rooms.get(socket.data.roomCode); if(!room||room.auction)return;
    const p=current(room),pp=room.pendingPurchase;
    if(!p||p.id!==socket.id||!pp||pp.playerId!==p.id)return;
    if(startAuction(room,pp.tileIndex,p.id))emit(room);
  });

  socket.on("bid",({amount})=>{
    const room=rooms.get(socket.data.roomCode);if(!room?.auction)return;
    const p=room.players.find(x=>x.id===socket.id&&!x.bankrupt);if(!p)return;
    const a=money(amount);
    if(a<room.auction.highestBid+100)return socket.emit("errorMsg",`Bid must be at least $${(room.auction.highestBid+100).toLocaleString()}.`);
    if(a>p.money)return socket.emit("errorMsg","You do not have enough cash.");
    room.auction.highestBid=a;room.auction.highestBidder=p.id;room.auction.deadline=Date.now()+8000;
    log(room,`${p.name} bids $${a.toLocaleString()}.`);emit(room);
  });

  socket.on("build",({tileIndex})=>{
    const room=rooms.get(socket.data.roomCode);const p=room?.players.find(x=>x.id===socket.id&&!x.bankrupt);
    const idx=Number(tileIndex),t=BOARD[idx];
    if(!room||!p||!t||t.type!=="property")return;
    if(!canBuildEvenly(room,p.id,idx))return socket.emit("errorMsg","Own the full colour set and build evenly across it.");
    if(p.money<t.buildCost)return socket.emit("errorMsg","Not enough cash to build.");
    p.money-=t.buildCost;room.buildings[idx]=(room.buildings[idx]||0)+1;
    const level=room.buildings[idx];
    log(room,level===5?`${p.name} built a HOTEL on ${t.name}.`:`${p.name} built house ${level} on ${t.name}.`);
    emit(room);
  });

  socket.on("sendTrade",payload=>{
    const room=rooms.get(socket.data.roomCode); if(!room)return;
    const offer={
      id:crypto.randomBytes(6).toString("hex"),
      fromId:socket.id,
      toId:String(payload.toId||""),
      offerMoney:money(payload.offerMoney),
      requestMoney:money(payload.requestMoney),
      offerProperties:(payload.offerProperties||[]).map(Number).filter(Number.isInteger),
      requestProperties:(payload.requestProperties||[]).map(Number).filter(Number.isInteger),
      createdAt:Date.now()
    };
    if(!validateTrade(room,offer))return socket.emit("errorMsg","Trade is not valid.");
    room.tradeOffers[offer.id]=offer;
    io.to(offer.toId).emit("tradeOffer",{...offer,fromName:room.players.find(p=>p.id===offer.fromId)?.name});
    log(room,`${room.players.find(p=>p.id===offer.fromId)?.name} sent a trade offer.`);
  });

  socket.on("tradeResponse",({tradeId,accept})=>{
    const room=rooms.get(socket.data.roomCode);const offer=room?.tradeOffers[tradeId];
    if(!room||!offer||offer.toId!==socket.id)return;
    if(accept && validateTrade(room,offer)){
      const from=room.players.find(p=>p.id===offer.fromId),to=room.players.find(p=>p.id===offer.toId);
      from.money-=offer.offerMoney;to.money+=offer.offerMoney;
      to.money-=offer.requestMoney;from.money+=offer.requestMoney;
      offer.offerProperties.forEach(i=>room.owners[i]=to.id);
      offer.requestProperties.forEach(i=>room.owners[i]=from.id);
      log(room,`${to.name} accepted ${from.name}'s trade.`);
    } else {
      log(room,`${room.players.find(p=>p.id===offer.toId)?.name} rejected a trade.`);
    }
    delete room.tradeOffers[tradeId];emit(room);
  });

  socket.on("endTurn",()=>{
    const room=rooms.get(socket.data.roomCode);if(!room||room.auction||room.winner)return;
    const p=current(room);if(!p||p.id!==socket.id||!p.hasRolled)return;
    if(room.pendingPurchase?.playerId===p.id){startAuction(room,room.pendingPurchase.tileIndex,p.id);emit(room);return;}
    p.hasRolled=false;
    if(p.extraTurn){p.extraTurn=false;resetTurnClock(room);log(room,`${p.name} gets an extra turn.`);}
    else advanceTurn(room);
    const np=current(room);if(np)np.hasRolled=false;
    emit(room);
  });

  socket.on("disconnect",()=>{
    const room=rooms.get(socket.data.roomCode);if(!room)return;
    const p=room.players.find(x=>x.id===socket.id);if(!p)return;
    p.bankrupt=true;log(room,`${p.name} disconnected.`);
    Object.keys(room.owners).forEach(k=>{if(room.owners[k]===p.id){delete room.owners[k];delete room.buildings[k];}});
    checkBankrupt(room,p);
    if(!room.winner && current(room)?.id===p.id)advanceTurn(room);
    emit(room);
  });
});

setInterval(()=>{
  const now=Date.now();
  for(const room of rooms.values()){
    if(room.auction && now>=room.auction.deadline){finishAuction(room);continue;}
    if(!room.started||room.winner||room.auction||!room.turnDeadline)continue;
    if(now>=room.turnDeadline){
      const p=current(room);if(!p)continue;
      log(room,`⏱ ${p.name}'s turn timed out.`);
      p.hasRolled=false;
      if(room.pendingPurchase?.playerId===p.id){startAuction(room,room.pendingPurchase.tileIndex,p.id);}
      else advanceTurn(room);
      emit(room);
    }
  }
},500);

server.listen(PORT,()=>console.log(`Fire & Fortune v4 running on port ${PORT}`));
