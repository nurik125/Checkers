// ui.js — UI rendering, input handling
import { onMoveAttempt } from './game.js';

const PIECE = { EMPTY: 0, WHITE: 1, BLACK: 2, WHITE_KING: 3, BLACK_KING: 4 };

let selectedPiece = null;

/* =========================
   RENDER BOARD
========================= */
export function renderBoard(gameState) {
    const boardDiv = document.getElementById("board");
    boardDiv.innerHTML = "";

    for (let row = 0; row < 8; row++) {
        for (let col = 0; col < 8; col++) {
            const square = document.createElement("li");
            const dark = (row + col) % 2 === 1;
            square.className = `square ${dark ? "dark" : "light"}`;
            square.dataset.row = row;
            square.dataset.col = col;

            const piece = gameState.board[row][col];
            if (piece !== PIECE.EMPTY) {
                const div = document.createElement("div");
                div.className = "piece";
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
}

/* =========================
   SQUARE CLICK HANDLER
========================= */
async function handleSquareClick(row, col) {
    const gameState = window.__gameState;
    const playerRole = window.__playerRole;
    if (!gameState || gameState.winner) return;
    if (!gameState.players?.black?.joined) return;
    if (gameState.turn !== playerRole) return;

    const piece = gameState.board[row][col];
    const isOwnPiece = isPieceOwned(piece, playerRole);

    if (!selectedPiece) {
        if (!isOwnPiece) return;
        selectedPiece = { row, col };
        clearHighlights();
        highlightSelection(row, col);
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

    // My piece color
    roleEl.innerHTML = playerRole === "white"
        ? "⚪ <strong>White</strong>"
        : "⚫ <strong>Black</strong>";

    // Opponent info
    const opponentData = playerRole === "white"
        ? gameState.players?.black
        : gameState.players?.white;

    if (opponentData?.joined) {
        const oppColor = opponentData.avatarColor || "#888";
        const oppName = opponentData.displayName || opponentData.id?.substring(0, 8) || "Opponent";
        opponentEl.innerHTML = avatarDot(oppColor) + oppName;
    } else {
        opponentEl.textContent = "Waiting...";
    }

    const playerStatusEl = document.getElementById("playerStatus");

    // Title & turn
    if (gameState.winner) {
        titleEl.textContent = `🎉 ${gameState.winner.toUpperCase()} WINS!`;
        turnEl.textContent = "";
        if (playerStatusEl) playerStatusEl.textContent = "Game over";
    } else if (!gameState.players?.black?.joined) {
        titleEl.textContent = "⏳ Waiting for opponent...";
        turnEl.textContent = "";
        if (playerStatusEl) playerStatusEl.textContent = "Waiting for opponent…";
    } else {
        titleEl.textContent = "Game In Progress";
        const isMyTurn = gameState.turn === playerRole;
        turnEl.innerHTML =
            `${isMyTurn ? "▶ Your turn" : "⏳ Opponent's turn"} ` +
            `(${gameState.turn === "white" ? "⚪ White" : "⚫ Black"})`;
        turnEl.className = `turn ${gameState.turn}`;
        if (playerStatusEl) playerStatusEl.textContent = "Opponent connected";
    }
}

export function showGameSession(gameId, role) {
    document.getElementById("joinSection").classList.add("hidden");
    document.getElementById("gameInfo").classList.remove("hidden");
    document.getElementById("playerRole").classList.remove("hidden");
    document.getElementById("gameIdDisplay").textContent = gameId;
    document.getElementById("roleText").innerHTML = role === "white"
        ? "⚪ <strong>White</strong>"
        : "⚫ <strong>Black</strong>";
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
            : "Joining game…";
    }
}

export function showGameCreated(gameId) {
    showGameSession(gameId, "white");
    const playerStatusEl = document.getElementById("playerStatus");
    if (playerStatusEl) playerStatusEl.textContent = "Waiting for opponent…";
}

/* =========================
   HELPERS
========================= */
function isPieceOwned(piece, player) {
    if (piece === PIECE.EMPTY) return false;
    const isWhite = piece === PIECE.WHITE || piece === PIECE.WHITE_KING;
    return player === "white" ? isWhite : !isWhite;
}
