const socket = io();
let state = null;
let myId = null;
let roomCode = null;
let rolledThisTurn = false;

const $ = id => document.getElementById(id);
const diceChars = ["⚀","⚁","⚂","⚃","⚄","⚅"];

function showError(msg){ $("error").textContent = msg; setTimeout(()=> $("error").textContent="", 3500); }

function nameValue(){
  const n = $("name").value.trim();
  if(!n){ showError("Type your name first."); return null; }
  return n;
}

function enterGame(code){
  roomCode = code;
  $("lobby").classList.add("hidden");
  $("game").classList.remove("hidden");
  $("codeLabel").textContent = code;
  const url = new URL(location.href);
  url.searchParams.set("room", code);
  history.replaceState({}, "", url);
}

$("createBtn").onclick = () => {
  const name = nameValue(); if(!name) return;
  socket.emit("createRoom",{name});
};
$("joinBtn").onclick = () => {
  const name = nameValue(); if(!name) return;
  const code = $("roomCode").value.trim().toUpperCase();
  if(!code) return showError("Enter the room code.");
  socket.emit("joinRoom",{name,code});
};

socket.on("connect",()=> myId = socket.id);
socket.on("roomCreated",({code})=>enterGame(code));
socket.on("joinedRoom",({code})=>enterGame(code));
socket.on("errorMsg",showError);

$("copyBtn").onclick = async () => {
  const url = `${location.origin}${location.pathname}?room=${roomCode}`;
  await navigator.clipboard.writeText(url);
  $("copyBtn").textContent = "Copied!";
  setTimeout(()=> $("copyBtn").textContent="Copy invite link",1200);
};

$("startBtn").onclick = ()=> socket.emit("startGame");
$("rollBtn").onclick = ()=> { rolledThisTurn = true; socket.emit("rollDice"); };
$("buyBtn").onclick = ()=> socket.emit("buyProperty");
$("endBtn").onclick = ()=> { rolledThisTurn = false; socket.emit("endTurn"); };

socket.on("dice",({d1,d2})=>{
  $("die1").textContent = diceChars[d1-1];
  $("die2").textContent = diceChars[d2-1];
});

socket.on("card",({label,text})=>{
  $("cardLabel").textContent = label.toUpperCase();
  $("cardText").textContent = text;
  $("cardModal").classList.remove("hidden");
});
$("closeCard").onclick = ()=> $("cardModal").classList.add("hidden");

function positionFor(i){
  // Board perimeter: 0 bottom-right, then counter-clockwise.
  if(i <= 10) return {row:11, col:11-i};
  if(i <= 20) return {row:21-i, col:1};
  if(i <= 30) return {row:1, col:i-19};
  return {row:i-29, col:11};
}

function tileClass(t){
  if(["go","jail","free","gotojail"].includes(t.type)) return "corner";
  return t.type;
}

function renderBoard(){
  const board = $("board");
  [...board.querySelectorAll(".tile")].forEach(n=>n.remove());

  state.board.forEach((tile,i)=>{
    const pos = positionFor(i);
    const el = document.createElement("div");
    el.className = `tile ${tileClass(tile)}`;
    el.style.gridRow = pos.row;
    el.style.gridColumn = pos.col;
    const ownerId = state.properties[i];
    const owner = state.players.find(p=>p.id===ownerId);
    const playersHere = state.players.filter(p=>p.pos===i && !p.bankrupt);

    el.innerHTML = `
      <div>${tile.name}</div>
      <div class="tokens">${playersHere.map(p=>`<span class="token" title="${escapeHtml(p.name)}" style="background:${p.color}"></span>`).join("")}</div>
      ${tile.price ? `<div class="price">₹${tile.price}</div>` : ""}
      ${owner ? `<div class="owner" style="background:${owner.color}"></div>` : ""}
    `;
    board.appendChild(el);
  });
}

function escapeHtml(s){return String(s).replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[m]));}

function renderPlayers(){
  $("players").innerHTML = state.players.map((p,i)=>`
    <div class="player ${p.id===state.currentPlayerId?"current":""} ${p.bankrupt?"bankrupt":""}">
      <span class="swatch" style="background:${p.color}"></span>
      <span>${escapeHtml(p.name)} ${i===0?"👑":""}</span>
      <b>₹${p.money}</b>
    </div>
  `).join("");
}

function renderLog(){
  $("log").innerHTML = state.log.slice().reverse().map(x=>`<div>${escapeHtml(x)}</div>`).join("");
}

function renderControls(){
  const me = state.players.find(p=>p.id===myId);
  const mine = state.currentPlayerId===myId;
  const host = state.players[0]?.id===myId;

  $("startBtn").classList.toggle("hidden", state.started || !host);
  $("startBtn").disabled = state.players.length < 2;

  if(state.winner){
    const w = state.players.find(p=>p.id===state.winner);
    $("turnText").textContent = `🏆 ${w?.name || "Player"} wins!`;
  } else if(!state.started){
    $("turnText").textContent = `Waiting — ${state.players.length}/5 players`;
  } else {
    const current = state.players.find(p=>p.id===state.currentPlayerId);
    $("turnText").textContent = mine ? "Your turn!" : `${current?.name || "Player"}'s turn`;
  }

  $("rollBtn").disabled = !state.started || !mine || rolledThisTurn || !!state.winner || me?.bankrupt;
  $("endBtn").disabled = !state.started || !mine || !rolledThisTurn || !!state.winner || me?.bankrupt;

  let canBuy = false;
  if(me && mine && rolledThisTurn){
    const t = state.board[me.pos];
    canBuy = ["property","station"].includes(t.type) && !state.properties[me.pos] && me.money >= t.price;
    $("buyBtn").textContent = canBuy ? `Buy ${t.name} — ₹${t.price}` : "Buy";
  }
  $("buyBtn").disabled = !canBuy || !!state.winner;
}

socket.on("state",s=>{
  const turnChanged = state && state.currentPlayerId !== s.currentPlayerId;
  state = s;
  if(turnChanged && s.currentPlayerId===myId) rolledThisTurn = false;
  renderBoard(); renderPlayers(); renderLog(); renderControls();
});

const params = new URLSearchParams(location.search);
const preset = params.get("room");
if(preset){
  $("roomCode").value = preset.toUpperCase();
  $("createBtn").classList.add("hidden");
}
