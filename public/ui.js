// ui.js — UI rendering, input handling
import { onMoveAttempt } from './game.js';
import { getValidMoves } from './engine.js';

const PIECE = { EMPTY: 0, WHITE: 1, BLACK: 2, WHITE_KING: 3, BLACK_KING: 4 };

let selectedPiece = null;
let showMoveHints = false;

/* =========================
   RENDER BOARD
========================= */
export function renderBoard(gameState) {
    const boardDiv = document.getElementById("board");
    boardDiv.innerHTML = "";
    boardDiv.classList.toggle("atari-mode", gameState?.mode === "atari");

    for (let row = 0; row < 8; row++) {
        for (let col = 0; col < 8; col++) {
            const square = document.createElement("li");
            const dark = (row + col) % 2 === 1;
            square.className = `square ${dark ? "dark" : "light"}`;
            square.dataset.row = row;
            square.dataset.col = col;

            const lastMove = gameState?.lastMove;
            if (lastMove) {
                if (lastMove.from?.row === row && lastMove.from?.col === col) {
                    square.classList.add("last-move-from");
                }
                if (lastMove.to?.row === row && lastMove.to?.col === col) {
                    square.classList.add("last-move-to");
                }
            }

            const piece = gameState.board[row][col];
            if (piece !== PIECE.EMPTY) {
                const div = document.createElement("div");
                div.className = "piece";
                if (gameState?.mode === "atari") div.classList.add("atari-piece");
                if (gameState?.mode === "atari") div.classList.remove("piece");
                if (piece === PIECE.WHITE) div.classList.add("white");
                if (piece === PIECE.BLACK) div.classList.add("black");
                if (piece === PIECE.WHITE_KING) div.classList.add("white-king");
                if (piece === PIECE.BLACK_KING) div.classList.add("black-king");
                square.appendChild(div);
            }

            square.addEventListener("click", () => handleSquareClick(row, col));
            boardDiv.appendChild(square);
        }
    }

    if (showMoveHints) {
        if (selectedPiece) {
            highlightSelection(selectedPiece.row, selectedPiece.col);
            renderValidMoves(gameState, selectedPiece.row, selectedPiece.col);
        } else {
            renderAllMoveHints(gameState);
        }
    }
}

/* =========================
   SQUARE CLICK HANDLER
========================= */
async function handleSquareClick(row, col) {
    const gameState = window.__gameState;
    let playerRole = window.__playerRole;
    if (!gameState || gameState.winner) return;
    if (!gameState.players?.black?.joined) return;
    const localMode = playerRole === 'local';
    const activePlayer = localMode ? gameState.turn : playerRole;
    if (gameState.turn !== activePlayer) return;

    const piece = gameState.board[row][col];
    const isOwnPiece = isPieceOwned(piece, activePlayer);

    if (!selectedPiece) {
        if (!isOwnPiece) return;
        selectedPiece = { row, col };
        clearHighlights();
        highlightSelection(row, col);
        if (showMoveHints) renderValidMoves(gameState, row, col);
    } else {
        if (selectedPiece.row === row && selectedPiece.col === col) {
            selectedPiece = null;
            clearHighlights();
            return;
        }
        if (isOwnPiece) {
            selectedPiece = { row, col };
            clearHighlights();
            highlightSelection(row, col);
            if (showMoveHints) renderValidMoves(gameState, row, col);
            return;
        }
        const from = selectedPiece;
        selectedPiece = null;
        clearHighlights();
        await onMoveAttempt(from.row, from.col, row, col);
    }
}

/* =========================
   HIGHLIGHT FUNCTIONS
========================= */
export function clearHighlights() {
    document.querySelectorAll(".square").forEach(sq =>
        sq.classList.remove("selected", "valid-move", "valid-capture")
    );
}

function highlightSelection(row, col) {
    const sel = document.querySelector(`[data-row="${row}"][data-col="${col}"]`);
    if (sel) sel.classList.add("selected");
}

export function renderChatMessages(chat = {}) {
    const chatPanel = document.getElementById("chatMessages");
    if (!chatPanel) return;
    chatPanel.innerHTML = "";

    const messages = Object.entries(chat || {}).map(([key, msg]) => ({ key, ...msg }));
    messages.sort((a, b) => (a.sentAt || 0) - (b.sentAt || 0));

    messages.slice(-60).forEach((message) => {
        const row = document.createElement("div");
        row.className = `chat-message ${message.playerId === window.__playerId ? "me" : "them"}`;
        row.innerHTML = `
            <div class="chat-avatar" style="background:${message.avatarColor || '#888'}"></div>
            <div class="chat-bubble">
                <div class="chat-meta"><strong>${message.displayName || 'Player'}</strong> · ${new Date(message.sentAt).toLocaleTimeString()}</div>
                <div>${message.message}</div>
            </div>
        `;
        chatPanel.appendChild(row);
    });
    chatPanel.scrollTop = chatPanel.scrollHeight;
}

/* =========================
   PLAYER AVATAR DOT
========================= */
function avatarDot(color, size = 12) {
    return `<span style="
        display:inline-block;
        width:${size}px; height:${size}px;
        border-radius:50%;
        background:${color || '#888'};
        margin-right:5px;
        vertical-align:middle;
        border:1px solid rgba(255,255,255,.3);
    "></span>`;
}

/* =========================
   UPDATE GAME INFO
========================= */
export function updateGameInfo(gameState, playerRole, gameId) {
    const titleEl = document.getElementById("gameTitle");
    const turnEl = document.getElementById("turnDisplay");
    const roleEl = document.getElementById("roleText");
    const opponentEl = document.getElementById("opponentStatus");
    const myNameEl = document.getElementById("myName");

    document.getElementById("connectionStatus").textContent = "✓ Connected";
    document.getElementById("connectionStatus").className = "status connected";
    document.getElementById("gameInfo").classList.remove("hidden");
    document.getElementById("playerRole").classList.remove("hidden");
    document.getElementById("gameIdDisplay").textContent = gameId;

    // My info
    const myColor = window.__playerColor || "#888";
    const myName = window.__playerName || "You";
    if (myNameEl) myNameEl.innerHTML = avatarDot(myColor) + myName;

    // My piece color or spectator/local mode label
    roleEl.innerHTML = playerRole === "white"
        ? "⚪ <strong>White</strong>"
        : playerRole === "black"
            ? "⚫ <strong>Black</strong>"
            : playerRole === "local"
                ? "🟧 <strong>Local play</strong>"
                : "👀 <strong>Spectator</strong>";

    // Opponent info (players only)
    const opponentData = playerRole === "white"
        ? gameState.players?.black
        : playerRole === "black"
            ? gameState.players?.white
            : gameState.players?.black;

    if (opponentData?.joined) {
        const oppColor = opponentData.avatarColor || "#888";
        const oppName = opponentData.displayName || opponentData.id?.substring(0, 8) || "Opponent";
        opponentEl.innerHTML = avatarDot(oppColor) + oppName;
    } else {
        opponentEl.textContent = playerRole === 'spectator' ? "Live match" : "Waiting...";
    }

    const playerStatusEl = document.getElementById("playerStatus");
    const spectatorCountEl = document.getElementById("spectatorCount");
    const modeEl = document.getElementById("gameModeLabel");
    const spectators = gameState.spectators || {};
    const spectatorCount = Object.keys(spectators).length;

    const chatSpectatorCountEl = document.getElementById("chatSpectatorCount");
    if (spectatorCountEl) {
        spectatorCountEl.textContent = spectatorCount > 0
            ? `${spectatorCount} spectator${spectatorCount === 1 ? '' : 's'}`
            : "No spectators yet";
    }
    if (chatSpectatorCountEl) {
        chatSpectatorCountEl.textContent = spectatorCount > 0
            ? `${spectatorCount} spectator${spectatorCount === 1 ? '' : 's'} watching` 
            : "No spectators yet";
    }
    if (modeEl) {
        modeEl.textContent = `Mode: ${gameState.mode === 'atari' ? 'Atari' : 'Classic'}`;
    }

    // Title & turn
    if (gameState.winner) {
        titleEl.textContent = `🎉 ${gameState.winner.toUpperCase()} WINS!`;
        turnEl.textContent = "";
        if (playerStatusEl) playerStatusEl.textContent = "Game over";
    } else if (!gameState.players?.black?.joined && playerRole !== 'local') {
        titleEl.textContent = "⏳ Waiting for opponent...";
        turnEl.textContent = "";
        if (playerStatusEl) playerStatusEl.textContent = "Waiting for opponent…";
    } else {
        titleEl.textContent = playerRole === 'spectator' ? "Watching Live" : "Game In Progress";
        if (playerRole === 'spectator') {
            turnEl.innerHTML = `👀 Spectating ${gameState.turn === "white" ? "White" : "Black"} move`; 
            turnEl.className = "turn spectator";
            if (playerStatusEl) playerStatusEl.textContent = "Viewing as spectator";
        } else if (playerRole === 'local') {
            turnEl.innerHTML = `▶ ${gameState.turn === "white" ? "White" : "Black"} move`;
            turnEl.className = `turn ${gameState.turn}`;
            if (playerStatusEl) playerStatusEl.textContent = "Local two-player game";
        } else {
            const isMyTurn = gameState.turn === playerRole;
            turnEl.innerHTML =
                `${isMyTurn ? "▶ Your turn" : "⏳ Opponent's turn"} ` +
                `(${gameState.turn === "white" ? "⚪ White" : "⚫ Black"})`;
            turnEl.className = `turn ${gameState.turn}`;
            if (playerStatusEl) playerStatusEl.textContent = "Opponent connected";
        }
    }
    renderChatMessages(gameState.chat || {});
}

export function showGameSession(gameId, role) {
    document.getElementById("joinSection").classList.add("hidden");
    document.getElementById("gameInfo").classList.remove("hidden");
    document.getElementById("playerRole").classList.remove("hidden");
    document.getElementById("gameIdDisplay").textContent = gameId;
    document.getElementById("roleText").innerHTML = role === "white"
        ? "⚪ <strong>White</strong>"
        : role === "black"
            ? "⚫ <strong>Black</strong>"
            : role === "local"
                ? "🟧 <strong>Local play</strong>"
                : "👀 <strong>Spectator</strong>";
    const myNameEl = document.getElementById("myName");
    if (myNameEl) {
        const myColor = window.__playerColor || "#888";
        const myName = window.__playerName || "You";
        myNameEl.innerHTML = avatarDot(myColor) + myName;
    }
    const playerStatusEl = document.getElementById("playerStatus");
    if (playerStatusEl) {
        playerStatusEl.textContent = role === "white"
            ? "Waiting for opponent…"
            : role === "black"
                ? "Joining game…"
                : "Spectating the match…";
    }
    const chatPanel = document.getElementById("chatPanel");
    if (chatPanel) chatPanel.classList.remove("hidden");
}

export function showGameCreated(gameId) {
    showGameSession(gameId, "white");
    const playerStatusEl = document.getElementById("playerStatus");
    if (playerStatusEl) playerStatusEl.textContent = "Waiting for opponent…";
}

export function toggleMoveHints() {
    showMoveHints = !showMoveHints;
    const button = document.getElementById("toggleMovesButton");
    if (button) {
        button.textContent = showMoveHints ? "Hide moves" : "Show moves";
        button.classList.toggle("active", showMoveHints);
    }
    if (window.__gameState) {
        clearHighlights();
        if (selectedPiece) {
            highlightSelection(selectedPiece.row, selectedPiece.col);
            if (showMoveHints) renderValidMoves(window.__gameState, selectedPiece.row, selectedPiece.col);
        } else if (showMoveHints) {
            renderAllMoveHints(window.__gameState);
        }
    }
}

window.toggleMoveHints = toggleMoveHints;

function renderValidMoves(gameState, row, col) {
    const moves = getValidMoves(gameState, row, col);
    moves.forEach((move) => {
        const square = document.querySelector(`[data-row="${move.row}"][data-col="${move.col}"]`);
        if (square) {
            square.classList.add(move.isCapture ? "valid-capture" : "valid-move");
        }
    });
}

function renderAllMoveHints(gameState) {
    if (!gameState || !gameState.board) return;
    const player = gameState.turn;
    for (let row = 0; row < 8; row++) {
        for (let col = 0; col < 8; col++) {
            const piece = gameState.board[row][col];
            if (!isPieceOwned(piece, player)) continue;
            const moves = getValidMoves(gameState, row, col);
            if (moves.length === 0) continue;
            moves.forEach((move) => {
                const square = document.querySelector(`[data-row="${move.row}"][data-col="${move.col}"]`);
                if (square) {
                    square.classList.add(move.isCapture ? "valid-capture" : "valid-move");
                }
            });
        }
    }
}

/* =========================
   HELPERS
========================= */
function isPieceOwned(piece, player) {
    if (piece === PIECE.EMPTY) return false;
    const isWhite = piece === PIECE.WHITE || piece === PIECE.WHITE_KING;
    return player === "white" ? isWhite : !isWhite;
}
