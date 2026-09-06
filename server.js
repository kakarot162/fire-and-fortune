const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const crypto = require("crypto");
const path = require("path");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, "public")));

const PORT = process.env.PORT || 3000;
const rooms = new Map();

const COLORS = ["#ff4d6d", "#4dabf7", "#ffd43b", "#69db7c", "#b197fc"];

const BOARD = [
  {name:"START", type:"go"},
  {name:"Cinder Lane", type:"property", price:600, rent:80, group:"ember"},
  {name:"Random", type:"random"},
  {name:"Ash Street", type:"property", price:600, rent:100, group:"ember"},
  {name:"Heat Tax", type:"tax", amount:10000},
  {name:"Oak Station", type:"station", price:2000, rent:250},
  {name:"Maple Avenue", type:"property", price:1000, rent:120, group:"gold"},
  {name:"Chance", type:"chance"},
  {name:"Birch Avenue", type:"property", price:1000, rent:120, group:"gold"},
  {name:"Cedar Avenue", type:"property", price:1200, rent:140, group:"gold"},
  {name:"JAIL / VISITING", type:"jail"},
  {name:"Pine Crescent", type:"property", price:1400, rent:160, group:"green"},
  {name:"Random", type:"random"},
  {name:"Walnut Crescent", type:"property", price:1400, rent:160, group:"green"},
  {name:"Teak Crescent", type:"property", price:1600, rent:180, group:"green"},
  {name:"Flame Station", type:"station", price:2000, rent:250},
  {name:"Rosewood Road", type:"property", price:1800, rent:200, group:"blue"},
  {name:"Chance", type:"chance"},
  {name:"Mahogany Road", type:"property", price:1800, rent:200, group:"blue"},
  {name:"Ebony Road", type:"property", price:2000, rent:220, group:"blue"},
  {name:"FREE FIRE", type:"free"},
  {name:"Sandalwood Way", type:"property", price:2200, rent:240, group:"purple"},
  {name:"Random", type:"random"},
  {name:"Juniper Way", type:"property", price:2200, rent:240, group:"purple"},
  {name:"Redwood Way", type:"property", price:2400, rent:260, group:"purple"},
  {name:"Coal Station", type:"station", price:2000, rent:250},
  {name:"Cherry Boulevard", type:"property", price:2600, rent:280, group:"red"},
  {name:"Spruce Boulevard", type:"property", price:2600, rent:280, group:"red"},
  {name:"Chance", type:"chance"},
  {name:"Sequoia Boulevard", type:"property", price:2800, rent:300, group:"red"},
  {name:"GO TO JAIL", type:"gotojail"},
  {name:"Ironwood Park", type:"property", price:3000, rent:320, group:"orange"},
  {name:"Bamboo Park", type:"property", price:3000, rent:320, group:"orange"},
  {name:"Random", type:"random"},
  {name:"Acacia Park", type:"property", price:3200, rent:350, group:"orange"},
  {name:"Blaze Station", type:"station", price:2000, rent:250},
  {name:"Chance", type:"chance"},
  {name:"Kingwood Heights", type:"property", price:3500, rent:400, group:"black"},
  {name:"Luxury Tax", type:"tax", amount:1500},
  {name:"Phoenix Heights", type:"property", price:4000, rent:500, group:"black"}
];

const CHANCE = [
  {text:"🔥 FIRE SALE! Lose $1,500.", effect:{kind:"money", amount:-1500}},
  {text:"💸 Jackpot! Collect $2,500.", effect:{kind:"money", amount:2500}},
  {text:"🌀 Portal jump: move forward 7 spaces.", effect:{kind:"move", amount:7}},
  {text:"👟 Backtrack! Move back 4 spaces.", effect:{kind:"move", amount:-4}},
  {text:"🚔 Straight to jail. No argument.", effect:{kind:"jail"}},
  {text:"🎁 Everyone chips in $500 for you.", effect:{kind:"collectAll", amount:500}},
  {text:"💣 Oops. Pay every other player $400.", effect:{kind:"payAll", amount:400}},
  {text:"🔀 CHAOS SWAP! Swap position with a random opponent.", effect:{kind:"swap"}},
  {text:"🧲 Magnet move: teleport to START and collect $2,000.", effect:{kind:"go"}},
  {text:"🎲 Double trouble: roll again after this turn.", effect:{kind:"extraTurn"}}
];

const RANDOM = [
  {text:"🌟 Lucky spark! +$1,200.", effect:{kind:"money", amount:1200}},
  {text:"🧯 Fire extinguisher bill: -$750.", effect:{kind:"money", amount:-750}},
  {text:"🎭 Street performance goes viral: +$1,800.", effect:{kind:"money", amount:1800}},
  {text:"🐿️ A squirrel stole your wallet: -$600.", effect:{kind:"money", amount:-600}},
  {text:"🚀 Rocket boost: move forward 5.", effect:{kind:"move", amount:5}},
  {text:"🧊 Frozen turn: skip your next turn.", effect:{kind:"skip"}},
  {text:"🤝 Kindness tax: give the poorest opponent $1,000.", effect:{kind:"givePoor", amount:10000}},
  {text:"🏆 Tiny tournament win: +$2,000.", effect:{kind:"money", amount:2000}},
  {text:"🪙 Coin storm! Every player gets $500.", effect:{kind:"allMoney", amount:500}},
  {text:"🕳️ Trapdoor! Move back 6.", effect:{kind:"move", amount:-6}}
];

function rnd(max) { return crypto.randomInt(0, max); }
function die() { return crypto.randomInt(1, 7); }

function makeRoom(code) {
  return {
    code,
    started:false,
    players:[],
    turnIndex:0,
    properties:{},
    log:["Room created."],
    winner:null
  };
}

function sanitizeName(name) {
  return String(name || "").replace(/[<>]/g, "").trim().slice(0, 20) || "Player";
}

function roomState(room) {
  return {
    code: room.code,
    started: room.started,
    players: room.players,
    turnIndex: room.turnIndex,
    currentPlayerId: room.players[room.turnIndex]?.id || null,
    properties: room.properties,
    board: BOARD,
    log: room.log.slice(-25),
    winner: room.winner
  };
}

function emitRoom(room) {
  io.to(room.code).emit("state", roomState(room));
}

function addLog(room, msg) {
  room.log.push(msg);
  if (room.log.length > 100) room.log.shift();
}

function applyMove(room, player, delta) {
  let old = player.pos;
  let next = old + delta;
  if (delta > 0 && next >= BOARD.length) {
    player.money += 2000;
    addLog(room, `${player.name} passed START and collected $2,000.`);
  }
  while (next < 0) next += BOARD.length;
  player.pos = next % BOARD.length;
}

function land(room, player) {
  const tile = BOARD[player.pos];
  if (!tile) return;

  if (tile.type === "tax") {
    player.money -= tile.amount;
    addLog(room, `${player.name} paid ${tile.amount} tax.`);
  } else if (tile.type === "gotojail") {
    player.pos = 10;
    player.jail = 1;
    addLog(room, `${player.name} was sent to jail.`);
  } else if (tile.type === "chance") {
    drawCard(room, player, CHANCE, "Chance");
  } else if (tile.type === "random") {
    drawCard(room, player, RANDOM, "Random");
  } else if (tile.type === "property" || tile.type === "station") {
    const ownerId = room.properties[player.pos];
    if (ownerId && ownerId !== player.id) {
      const owner = room.players.find(p => p.id === ownerId);
      if (owner && !owner.bankrupt) {
        const rent = tile.rent;
        player.money -= rent;
        owner.money += rent;
        addLog(room, `${player.name} paid ${rent} rent to ${owner.name}.`);
      }
    }
  }
  checkBankruptcy(room, player);
}

function drawCard(room, player, deck, label) {
  const card = deck[rnd(deck.length)];
  addLog(room, `${label}: ${card.text}`);
  io.to(room.code).emit("card", {playerId: player.id, label, text: card.text});
  const e = card.effect;

  if (e.kind === "money") player.money += e.amount;
  if (e.kind === "move") {
    applyMove(room, player, e.amount);
    land(room, player);
  }
  if (e.kind === "jail") {
    player.pos = 10; player.jail = 1;
  }
  if (e.kind === "collectAll") {
    room.players.filter(p=>p.id!==player.id && !p.bankrupt).forEach(p=>{
      const amt = Math.min(e.amount, Math.max(0,p.money));
      p.money -= amt; player.money += amt;
    });
  }
  if (e.kind === "payAll") {
    room.players.filter(p=>p.id!==player.id && !p.bankrupt).forEach(p=>{
      const amt = Math.min(e.amount, Math.max(0,player.money));
      player.money -= amt; p.money += amt;
    });
  }
  if (e.kind === "swap") {
    const others = room.players.filter(p=>p.id!==player.id && !p.bankrupt);
    if (others.length) {
      const other = others[rnd(others.length)];
      [player.pos, other.pos] = [other.pos, player.pos];
      addLog(room, `${player.name} swapped positions with ${other.name}.`);
    }
  }
  if (e.kind === "go") {
    player.pos = 0; player.money += 2000;
  }
  if (e.kind === "extraTurn") player.extraTurn = true;
  if (e.kind === "skip") player.skip = 1;
  if (e.kind === "givePoor") {
    const others = room.players.filter(p=>p.id!==player.id && !p.bankrupt).sort((a,b)=>a.money-b.money);
    if (others.length) {
      const amt = Math.min(e.amount, Math.max(0,player.money));
      player.money -= amt; others[0].money += amt;
      addLog(room, `${player.name} gave ${amt} to ${others[0].name}.`);
    }
  }
  if (e.kind === "allMoney") room.players.filter(p=>!p.bankrupt).forEach(p=>p.money += e.amount);
  checkBankruptcy(room, player);
}

function checkBankruptcy(room, player) {
  if (player.money >= 0 || player.bankrupt) return;
  player.bankrupt = true;
  addLog(room, `${player.name} went bankrupt!`);
  Object.keys(room.properties).forEach(k => {
    if (room.properties[k] === player.id) delete room.properties[k];
  });
  const alive = room.players.filter(p=>!p.bankrupt);
  if (alive.length === 1 && room.started) {
    room.winner = alive[0].id;
    addLog(room, `🏆 ${alive[0].name} wins the game!`);
  }
}

function nextTurn(room) {
  if (!room.players.length) return;
  let guard = 0;
  do {
    room.turnIndex = (room.turnIndex + 1) % room.players.length;
    const p = room.players[room.turnIndex];
    if (!p.bankrupt) {
      if (p.skip > 0) {
        p.skip--;
        addLog(room, `${p.name} skipped this turn.`);
      } else {
        return;
      }
    }
    guard++;
  } while (guard < room.players.length * 2);
}

io.on("connection", socket => {
  socket.on("createRoom", ({name}) => {
    let code;
    do { code = crypto.randomBytes(3).toString("hex").toUpperCase(); } while (rooms.has(code));
    const room = makeRoom(code);
    rooms.set(code, room);
    const player = {
      id: socket.id,
      name:sanitizeName(name),
      color:COLORS[0],
      pos:0,money:15000,jail:0,skip:0,extraTurn:false,bankrupt:false
    };
    room.players.push(player);
    socket.join(code);
    socket.data.roomCode = code;
    addLog(room, `${player.name} joined.`);
    socket.emit("roomCreated", {code});
    emitRoom(room);
  });

  socket.on("joinRoom", ({name, code}) => {
    code = String(code || "").trim().toUpperCase();
    const room = rooms.get(code);
    if (!room) return socket.emit("errorMsg", "Room not found.");
    if (room.started) return socket.emit("errorMsg", "Game already started.");
    if (room.players.length >= 5) return socket.emit("errorMsg", "Room is full.");
    const idx = room.players.length;
    const player = {
      id:socket.id,
      name:sanitizeName(name),
      color:COLORS[idx],
      pos:0,money:15000,jail:0,skip:0,extraTurn:false,bankrupt:false
    };
    room.players.push(player);
    socket.join(code);
    socket.data.roomCode = code;
    addLog(room, `${player.name} joined.`);
    socket.emit("joinedRoom", {code});
    emitRoom(room);
  });

  socket.on("startGame", () => {
    const room = rooms.get(socket.data.roomCode);
    if (!room || room.players[0]?.id !== socket.id) return;
    if (room.players.length < 2) return socket.emit("errorMsg","Need at least 2 players.");
    room.started = true;
    room.turnIndex = rnd(room.players.length);
    addLog(room, `${room.players[room.turnIndex].name} goes first — chosen randomly.`);
    emitRoom(room);
  });

  socket.on("rollDice", () => {
    const room = rooms.get(socket.data.roomCode);
    if (!room || !room.started || room.winner) return;
    const p = room.players[room.turnIndex];
    if (!p || p.id !== socket.id || p.bankrupt) return;
    if (p.jail > 0) {
      p.jail--;
      addLog(room, `${p.name} served a jail turn.`);
      nextTurn(room);
      return emitRoom(room);
    }
    const d1 = die(), d2 = die();
    const total = d1 + d2;
    io.to(room.code).emit("dice", {playerId:p.id,d1,d2});
    addLog(room, `${p.name} rolled ${d1} + ${d2} = ${total}.`);
    applyMove(room, p, total);
    land(room, p);
    emitRoom(room);
  });

  socket.on("buyProperty", () => {
    const room = rooms.get(socket.data.roomCode);
    if (!room || !room.started || room.winner) return;
    const p = room.players[room.turnIndex];
    if (!p || p.id !== socket.id) return;
    const tile = BOARD[p.pos];
    if (!tile || !["property","station"].includes(tile.type)) return;
    if (room.properties[p.pos]) return;
    if (p.money < tile.price) return socket.emit("errorMsg","Not enough money.");
    p.money -= tile.price;
    room.properties[p.pos] = p.id;
    addLog(room, `${p.name} bought ${tile.name} for ${tile.price}.`);
    emitRoom(room);
  });

  socket.on("endTurn", () => {
    const room = rooms.get(socket.data.roomCode);
    if (!room || !room.started || room.winner) return;
    const p = room.players[room.turnIndex];
    if (!p || p.id !== socket.id) return;
    if (p.extraTurn) {
      p.extraTurn = false;
      addLog(room, `${p.name} gets an extra turn!`);
    } else {
      nextTurn(room);
    }
    emitRoom(room);
  });

  socket.on("disconnect", () => {
    const code = socket.data.roomCode;
    const room = rooms.get(code);
    if (!room) return;
    const p = room.players.find(x=>x.id===socket.id);
    if (p) {
      p.bankrupt = true;
      addLog(room, `${p.name} disconnected.`);
      checkBankruptcy(room,p);
    }
    emitRoom(room);
  });
});

server.listen(PORT, () => console.log(`Wild Property Empire running on port ${PORT}`));
