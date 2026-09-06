const socket = io();

let state = null;
let myId = null;
let roomCode = null;
let soundOn = false;
let lastPos = {};

const $ = (id) => document.getElementById(id);

const diceChars = ["⚀", "⚁", "⚂", "⚃", "⚄", "⚅"];

// ============================================================
// Utilities
// ============================================================

function err(message) {
    $("error").textContent = message;

    setTimeout(() => {
        $("error").textContent = "";
    }, 3500);
}

function esc(value) {
    return String(value).replace(/[&<>"']/g, (char) => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#039;",
    }[char]));
}

function money(amount) {
    return new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
        maximumFractionDigits: 0,
    }).format(amount);
}

function tone(frequency = 220, duration = 0.08) {
    if (!soundOn) {
        return;
    }

    const AudioContext =
        window.AudioContext || window.webkitAudioContext;

    if (!AudioContext) {
        return;
    }

    const audioContext = new AudioContext();
    const oscillator = audioContext.createOscillator();
    const gain = audioContext.createGain();

    oscillator.frequency.value = frequency;
    gain.gain.value = 0.04;

    oscillator.connect(gain);
    gain.connect(audioContext.destination);

    oscillator.start();

    gain.gain.exponentialRampToValueAtTime(
        0.001,
        audioContext.currentTime + duration
    );

    oscillator.stop(audioContext.currentTime + duration);
}

// ============================================================
// Lobby / Room
// ============================================================

function enter(code) {
    roomCode = code;

    $("lobby").classList.add("hidden");
    $("game").classList.remove("hidden");
    $("codeLabel").textContent = code;

    const url = new URL(location.href);
    url.searchParams.set("room", code);

    history.replaceState({}, "", url);
}

function getName() {
    const name = $("name").value.trim();

    if (!name) {
        err("Type your name first.");
        return null;
    }

    return name;
}

$("createBtn").onclick = () => {
    const name = getName();

    if (name) {
        socket.emit("createRoom", { name });
    }
};

$("joinBtn").onclick = () => {
    const name = getName();
    const code = $("roomCode").value.trim().toUpperCase();

    if (name && code) {
        socket.emit("joinRoom", {
            name,
            code,
        });
    } else if (name) {
        err("Enter the room code.");
    }
};

// ============================================================
// Socket Events
// ============================================================

socket.on("connect", () => {
    myId = socket.id;
});

socket.on("roomCreated", ({ code }) => {
    enter(code);
});

socket.on("joinedRoom", ({ code }) => {
    enter(code);
});

socket.on("errorMsg", err);

// ============================================================
// Header Controls
// ============================================================

$("copyBtn").onclick = async () => {
    try {
        const inviteUrl =
            `${location.origin}${location.pathname}?room=${roomCode}`;

        await navigator.clipboard.writeText(inviteUrl);

        $("copyBtn").textContent = "Copied!";

        setTimeout(() => {
            $("copyBtn").textContent = "Copy invite link";
        }, 1200);
    } catch (error) {
        err("Could not copy the invite link.");
    }
};

$("startBtn").onclick = () => {
    socket.emit("startGame");
};

$("soundBtn").onclick = () => {
    soundOn = !soundOn;

    $("soundBtn").textContent = soundOn
        ? "🔊 Sound on"
        : "🔇 Sound off";

    tone(330, 0.12);
};

// ============================================================
// Game Controls
// ============================================================

$("rollBtn").onclick = () => {
    socket.emit("rollDice");
};

$("buyBtn").onclick = () => {
    socket.emit("buyProperty");
};

$("auctionBtn").onclick = () => {
    socket.emit("declineProperty");
};

$("endBtn").onclick = () => {
    socket.emit("endTurn");
};

$("closeCard").onclick = () => {
    $("cardModal").classList.add("hidden");
};

document.querySelectorAll("[data-close]").forEach((button) => {
    button.onclick = () => {
        const modalId = button.dataset.close;
        $(modalId)?.classList.add("hidden");
    };
});

// ============================================================
// Socket Game Events
// ============================================================

socket.on("dice", ({ d1, d2 }) => {
    $("die1").textContent = diceChars[d1 - 1];
    $("die2").textContent = diceChars[d2 - 1];

    tone(170, 0.12);
});

socket.on("moveStep", () => {
    tone(260, 0.04);
});

socket.on("card", ({ label, text }) => {
    $("cardLabel").textContent = label.toUpperCase();
    $("cardText").textContent = text;

    $("cardModal").classList.remove("hidden");

    tone(440, 0.16);
});

// ============================================================
// Board
// ============================================================

function pos(index) {
    if (index <= 10) {
        return {
            row: 11,
            col: 11 - index,
        };
    }

    if (index <= 20) {
        return {
            row: 21 - index,
            col: 1,
        };
    }

    if (index <= 30) {
        return {
            row: 1,
            col: index - 19,
        };
    }

    return {
        row: index - 29,
        col: 11,
    };
}

function tileClass(tile) {
    return ["go", "jail", "free", "gotojail"].includes(tile.type)
        ? "corner"
        : tile.type;
}

function renderBoard() {
    const board = $("board");

    board.querySelectorAll(".tile").forEach((tile) => {
        tile.remove();
    });

    state.board.forEach((tile, index) => {
        const position = pos(index);
        const element = document.createElement("div");

        const owner = state.players.find(
            (player) => player.id === state.properties[index]
        );

        const playersHere = state.players.filter(
            (player) =>
                player.pos === index &&
                !player.bankrupt
        );

        const buildings = state.buildings[index] || 0;

        element.className = `tile ${tileClass(tile)}`;

        element.style.gridRow = position.row;
        element.style.gridColumn = position.col;

        const tokens = playersHere
            .map((player) => {
                const isMoving =
                    lastPos[player.id] !== undefined &&
                    lastPos[player.id] !== player.pos;

                return `
                    <span
                        class="token ${isMoving ? "moving" : ""}"
                        title="${esc(player.name)}"
                        style="background:${player.color}"
                    ></span>
                `;
            })
            .join("");

        const buildingMarkup = buildings
            ? `
                <div class="buildings">
                    ${buildings === 5
                        ? "🏨"
                        : "🏠".repeat(buildings)}
                </div>
            `
            : "";

        const priceMarkup = tile.price
            ? `
                <div class="price">
                    $${tile.price.toLocaleString()}
                </div>
            `
            : "";

        const ownerMarkup = owner
            ? `
                <div
                    class="owner"
                    style="background:${owner.color}"
                ></div>
            `
            : "";

        element.innerHTML = `
            <div>${esc(tile.name)}</div>

            <div class="tokens">
                ${tokens}
            </div>

            ${buildingMarkup}
            ${priceMarkup}
            ${ownerMarkup}
        `;

        board.appendChild(element);
    });

    state.players.forEach((player) => {
        lastPos[player.id] = player.pos;
    });
}

// ============================================================
// Players / Activity
// ============================================================

function renderPlayers() {
    $("players").innerHTML = state.players
        .map((player, index) => {
            const isCurrent =
                player.id === state.currentPlayerId;

            return `
                <div
                    class="player
                        ${isCurrent ? "current" : ""}
                        ${player.bankrupt ? "bankrupt" : ""}"
                >
                    <span
                        class="swatch"
                        style="background:${player.color}"
                    ></span>

                    <span>
                        ${esc(player.name)}
                        ${index === 0 ? "👑" : ""}
                    </span>

                    <b>${money(player.money)}</b>
                </div>
            `;
        })
        .join("");
}

function renderLog() {
    $("log").innerHTML = state.log
        .slice()
        .reverse()
        .map((message) => `<div>${esc(message)}</div>`)
        .join("");
}

// ============================================================
// Player Helpers
// ============================================================

function me() {
    return state.players.find(
        (player) => player.id === myId
    );
}

function current() {
    return state.players.find(
        (player) => player.id === state.currentPlayerId
    );
}

// ============================================================
// Game Controls State
// ============================================================

function controls() {
    const player = me();

    const isMyTurn =
        state.currentPlayerId === myId;

    const isHost =
        state.players[0]?.id === myId;

    const pendingPurchase =
        state.pendingPurchase;

    // Start button
    $("startBtn").classList.toggle(
        "hidden",
        state.started || !isHost
    );

    $("startBtn").disabled =
        state.players.length < 2;

    // Turn text
    if (state.winner) {
        const winner = state.players.find(
            (p) => p.id === state.winner
        );

        $("turnText").textContent =
            `🏆 ${winner?.name || "A player"} wins!`;
    } else if (!state.started) {
        $("turnText").textContent =
            `Waiting — ${state.players.length}/5 players`;
    } else {
        $("turnText").textContent = isMyTurn
            ? "Your turn!"
            : `${current()?.name || "Player"}'s turn`;
    }

    // Roll
    $("rollBtn").disabled =
        !isMyTurn ||
        !state.started ||
        state.rolled ||
        Boolean(pendingPurchase) ||
        Boolean(state.auction) ||
        Boolean(state.winner);

    // End turn
    $("endBtn").disabled =
        !isMyTurn ||
        !state.rolled ||
        Boolean(pendingPurchase) ||
        Boolean(state.winner);

    // Buy
    const currentTile =
        player && state.board[player.pos];

    const canBuy =
        isMyTurn &&
        pendingPurchase?.playerId === myId &&
        player.money >= (currentTile?.price || Infinity);

    $("buyBtn").disabled = !canBuy;

    $("buyBtn").textContent = canBuy
        ? `Buy ${currentTile.name} — $${currentTile.price.toLocaleString()}`
        : "Buy Property";

    // Auction
    $("auctionBtn").disabled =
        !(isMyTurn && pendingPurchase?.playerId === myId);

    // Other controls
    $("propertyBtn").disabled = !player;

    $("buildBtn").disabled =
        !isMyTurn ||
        !state.rolled;

    const availablePlayers =
        state.players.filter(
            (p) =>
                !p.bankrupt &&
                p.id !== myId
        );

    $("tradeBtn").disabled =
        !isMyTurn ||
        !state.rolled ||
        Boolean(state.trade) ||
        availablePlayers.length === 0;
}

// ============================================================
// Auction
// ============================================================

function renderAuction() {
    const auction = state.auction;

    if (!auction) {
        $("auctionModal").classList.add("hidden");
        return;
    }

    const tile = state.board[auction.pos];

    const highestBidder = state.players.find(
        (player) => player.id === auction.highestId
    );

    $("auctionInfo").innerHTML = `
        <b>${esc(tile.name)}</b>

        <p>
            Current bid:
            ${money(auction.highest)}
        </p>

        <p>
            Leader:
            ${esc(highestBidder?.name || "No bids yet")}
        </p>
    `;

    $("auctionModal").classList.remove("hidden");
}

// ============================================================
// Trade
// ============================================================

function selected(className) {
    return [
        ...document.querySelectorAll(`.${className}:checked`),
    ].map((input) => Number(input.value));
}

function tradeInputs(playerId, propertyClass, moneyId) {
    const ownedProperties = Object.entries(
        state.properties
    )
        .filter(([, ownerId]) => ownerId === playerId)
        .map(([index]) => Number(index));

    const propertyInputs = ownedProperties
        .map(
            (index) => `
                <label class="check">
                    <input
                        class="${propertyClass}"
                        type="checkbox"
                        value="${index}"
                    >

                    ${esc(state.board[index].name)}
                </label>
            `
        )
        .join("");

    return `
        <p>Your properties:</p>

        ${
            propertyInputs ||
            "<p>No properties.</p>"
        }

        <input
            id="${moneyId}"
            type="number"
            min="0"
            placeholder="Cash amount"
        >
    `;
}

function renderTrade() {
    const trade = state.trade;

    if (!trade) {
        $("tradeModal").classList.add("hidden");
        return;
    }

    const from = state.players.find(
        (player) => player.id === trade.from
    );

    const to = state.players.find(
        (player) => player.id === trade.to
    );

    if (!from || !to) {
        return;
    }

    if (myId === trade.to) {
        const offeredProperties =
            trade.offer.properties
                .map(
                    (index) =>
                        esc(state.board[index].name)
                )
                .join(", ") || "no property";

        $("tradeInfo").innerHTML = `
            <p>
                <b>${esc(from.name)}</b>
                offers
                ${offeredProperties}
                +
                ${money(trade.offer.money)}.
            </p>
        `;

        $("tradeControls").innerHTML =
            tradeInputs(
                to.id,
                "giveProp",
                "giveMoney"
            ) +
            `
                <button
                    id="acceptTrade"
                    class="primary"
                    type="button"
                >
                    Accept with selected counter-offer
                </button>

                <button
                    id="declineTrade"
                    type="button"
                >
                    Decline
                </button>
            `;

        $("acceptTrade").onclick = () => {
            socket.emit("respondTrade", {
                accept: true,
                giveProperties: selected("giveProp"),
                giveMoney: $("giveMoney").value,
            });
        };

        $("declineTrade").onclick = () => {
            socket.emit("respondTrade", {
                accept: false,
            });
        };

        $("tradeModal").classList.remove("hidden");
    }
}

// ============================================================
// Properties
// ============================================================

$("propertyBtn").onclick = () => {
    const ownedProperties = Object.entries(
        state.properties
    )
        .filter(([, ownerId]) => ownerId === myId)
        .map(([index]) => Number(index));

    $("propertyList").innerHTML = ownedProperties.length
        ? ownedProperties
            .map((index) => {
                const tile = state.board[index];
                const buildings =
                    state.buildings[index] || 0;

                return `
                    <div class="prop">
                        <b>${esc(tile.name)}</b>

                        <span>
                            ${money(tile.price)}
                            · Rent ${money(tile.rent)}
                            ·
                            ${
                                buildings === 5
                                    ? "HOTEL"
                                    : buildings
                                        ? `${buildings} houses`
                                        : "No buildings"
                            }
                        </span>
                    </div>
                `;
            })
            .join("")
        : "<p>You do not own any property yet.</p>";

    $("propertyModal").classList.remove("hidden");
};

// ============================================================
// Building
// ============================================================

$("buildBtn").onclick = () => {
    const ownedBuildableProperties =
        Object.entries(state.properties)
            .filter(([index, ownerId]) => {
                const tile = state.board[Number(index)];

                return (
                    ownerId === myId &&
                    tile &&
                    tile.group
                );
            })
            .map(([index]) => Number(index));

    if (!ownedBuildableProperties.length) {
        err(
            "You need a full colour set before building."
        );
        return;
    }

    const propertyList =
        ownedBuildableProperties
            .map((index) => {
                const tile = state.board[index];
                const buildings =
                    state.buildings[index] || 0;

                return `${index}: ${tile.name} (${buildings === 5
                    ? "Hotel"
                    : `${buildings} houses`})`;
            })
            .join("\n");

    const input = prompt(
        `Enter property number:\n${propertyList}`
    );

    if (input === null) {
        return;
    }

    const propertyIndex = Number(input);

    if (
        !Number.isInteger(propertyIndex) ||
        !ownedBuildableProperties.includes(propertyIndex)
    ) {
        err("Invalid property number.");
        return;
    }

    socket.emit("build", {
        pos: propertyIndex,
    });
};

// ============================================================
// Trade
// ============================================================

$("tradeBtn").onclick = () => {
    const otherPlayers = state.players.filter(
        (player) =>
            !player.bankrupt &&
            player.id !== myId
    );

    if (!otherPlayers.length) {
        err("There are no players available to trade with.");
        return;
    }

    $("tradeInfo").innerHTML = `
        <select id="tradeTo">
            ${otherPlayers
                .map(
                    (player) => `
                        <option value="${player.id}">
                            ${esc(player.name)}
                        </option>
                    `
                )
                .join("")}
        </select>
    `;

    $("tradeControls").innerHTML =
        tradeInputs(
            myId,
            "offerProp",
            "offerMoney"
        );

    $("tradeModal").classList.remove("hidden");
};

$("tradeSend").onclick = () => {
    const target = $("tradeTo");

    if (!target) {
        return;
    }

    socket.emit("proposeTrade", {
        to: target.value,
        properties: selected("offerProp"),
        money: $("offerMoney").value,
    });

    $("tradeModal").classList.add("hidden");
};

// ============================================================
// Auction Bidding
// ============================================================

$("bidBtn").onclick = () => {
    const amount = Number($("bidAmount").value);

    if (!Number.isFinite(amount) || amount < 0) {
        err("Enter a valid bid amount.");
        return;
    }

    socket.emit("auctionBid", {
        amount,
    });
};

// ============================================================
// Turn Timer
// ============================================================

setInterval(() => {
    if (!state?.turnEndsAt || state.winner) {
        return;
    }

    const remaining = Math.max(
        0,
        Math.ceil(
            (state.turnEndsAt - Date.now()) / 1000
        )
    );

    $("timerText").textContent =
        `${remaining}s`;
}, 250);

// ============================================================
// State Updates
// ============================================================

socket.on("state", (newState) => {
    state = newState;

    renderBoard();
    renderPlayers();
    renderLog();
    controls();
    renderAuction();
    renderTrade();
});

// ============================================================
// Invite / Room URL
// ============================================================

const presetRoom =
    new URLSearchParams(location.search).get("room");

if (presetRoom) {
    $("roomCode").value =
        presetRoom.toUpperCase();

    $("createBtn").classList.add("hidden");
}

