// game.js — Game state, Firebase listeners, move requests
import { db, auth, app, fns } from './firebase.js';
import { getCachedProfile } from './auth.js';
import {
    ref, set, get, update, onValue, onDisconnect
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";
import {
    getFunctions, httpsCallable
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-functions.js";
import { renderBoard, clearHighlights, updateGameInfo, showGameCreated, showGameSession } from './ui.js';

const _makeMove = httpsCallable(fns, "makeMove");
const _createGame = httpsCallable(fns, "createGame");
const _joinSpectator = httpsCallable(fns, "joinSpectator");
const _sendChatMessage = httpsCallable(fns, "sendChatMessage");
const _surrenderGame = httpsCallable(fns, "surrenderGame");
const _claimWin = httpsCallable(fns, "claimWin");
/* =========================
   MODULE STATE
========================= */
let gameState = null;
let gameId = null;
let gameRef = null;
let unsubscribe = null;
let disconnectHandlers = [];
let previousGameState = null;
let gameMode = "classic";
let isSpectator = false;
let playerId = null;   // Firebase Auth UID
let playerName = null;   // display name
let playerColor = null;  // avatar color (hex)
let playerRole = null;   // 'white' | 'black' | 'spectator'

/* =========================
   EXPOSE STATE TO OTHER MODULES
========================= */
window.__gameState = null;
window.__playerRole = null;
window.__playerName = null;
window.__playerColor = null;

/* =========================
   LOAD CURRENT PLAYER FROM CACHE
   Profile is guaranteed to be set by the time the lobby is visible —
   main.js calls waitForAuthReady() before showing any game buttons.
========================= */
function loadCurrentPlayer() {
    const profile = getCachedProfile();
    if (!profile) throw new Error("Not authenticated — please refresh and sign in again.");
    playerId = profile.uid;
    playerName = profile.displayName || auth.currentUser?.displayName || "Player";
    playerColor = profile.avatarColor || "#3498DB";
    window.__playerId = playerId;
    window.__playerName = playerName;
    window.__playerColor = playerColor;
}

async function cancelDisconnectHandler() {
    for (const handler of disconnectHandlers) {
        try {
            await handler.cancel();
        } catch (err) {
            console.warn("cancelDisconnectHandler failed:", err && err.message ? err.message : err);
        }
    }
    disconnectHandlers = [];
}

async function setupDisconnectHandler() {
    await cancelDisconnectHandler();
    if (!gameId || !playerRole || playerRole === "spectator") return;

    try {
        const joinedRef = ref(db, `games/${gameId}/players/${playerRole}/joined`);
        const disconnectedAtRef = ref(db, `games/${gameId}/players/${playerRole}/disconnectedAt`);

        const joinedOnDisconnect = onDisconnect(joinedRef);
        await joinedOnDisconnect.set(false);
        const disconnectedAtOnDisconnect = onDisconnect(disconnectedAtRef);
        await disconnectedAtOnDisconnect.set(Date.now());

        disconnectHandlers = [joinedOnDisconnect, disconnectedAtOnDisconnect];
    } catch (err) {
        console.warn("setupDisconnectHandler failed:", err && err.message ? err.message : err);
    }
}

async function maybeClaimWin() {
    if (!gameId || !playerRole || playerRole === "spectator") return;
    try {
        await _claimWin({ gameId, playerId });
    } catch (err) {
        console.warn("Claim win failed:", err && err.message ? err.message : err);
    }
}

async function handleOpponentLeave(oldState, newState) {
    if (!oldState || !newState || !playerRole || playerRole === "spectator" || newState.winner) return;
    const opponentRole = playerRole === "white" ? "black" : "white";
    const wasOpponentJoined = oldState.players?.[opponentRole]?.joined;
    const isOpponentJoined = newState.players?.[opponentRole]?.joined;
    const amStillJoined = newState.players?.[playerRole]?.joined;
    if (wasOpponentJoined && !isOpponentJoined && amStillJoined) {
        const disconnectTime = newState.players?.[opponentRole]?.disconnectedAt;
        if (!disconnectTime || Date.now() - disconnectTime >= 5000) {
            await maybeClaimWin();
        }
    }
}

/* =========================
   PUBLIC: CREATE GAME
========================= */
export async function createGame() {
    try {
        const currentUser = auth.currentUser;
        if (!currentUser) throw new Error("Not authenticated.");
        
        await currentUser.reload();
        
        await currentUser.getIdToken(true);
        
        loadCurrentPlayer();
        
        playerId = currentUser.uid;
        gameMode = document.querySelector('input[name="gameMode"]:checked')?.value || "classic";
        isSpectator = false;

        const result = await _createGame({
            playerId,
            displayName: playerName,
            avatarColor: playerColor,
            mode: gameMode
        });

        gameId = result.data.gameId;
        playerRole = "white";
        window.__playerRole = playerRole;
        showGameSession(gameId, playerRole);
        gameRef = ref(db, `games/${gameId}`);
        await setupDisconnectHandler();
        updateGameInfo({
            ...{
                board: result.data.board || Array(8).fill(null),
                players: {
                    white: {
                        id: playerId,
                        displayName: playerName,
                        avatarColor: playerColor,
                        joined: true
                    },
                    black: {
                        id: null,
                        displayName: null,
                        avatarColor: null,
                        joined: false
                    }
                },
                turn: "white",
                winner: null,
                chainPiece: null,
                mode: gameMode,
                spectators: {},
                chat: {}
            }
        }, playerRole, gameId);
        startListening();
    } catch (err) {
        console.error("Create game failed:", err.message);
        alert("Failed to create game: " + err.message);
    }
}

/* =========================
   PUBLIC: JOIN GAME
========================= */
export async function joinGame() {
    const inputId = document.getElementById("gameIdInput").value.trim().toUpperCase();
    if (!inputId) { alert("Please enter a Game ID"); return; }

    try {
        // Verify user is authenticated in Firebase Auth
        const currentUser = auth.currentUser;
        if (!currentUser) {
            throw new Error("Not authenticated. Please sign in first.");
        }

        // Refresh auth state and ensure token is valid
        await currentUser.reload();
        await currentUser.getIdToken(true);

        loadCurrentPlayer();
        playerId = currentUser.uid;

        gameId = inputId;
        playerRole = "black";
        isSpectator = false;
        window.__playerRole = playerRole;
        gameRef = ref(db, `games/${gameId}`);

        const snapshot = await get(gameRef);
        if (!snapshot.exists()) { alert("Game not found!"); return; }

        const game = snapshot.val();

        // Prevent joining your own game as black
        if (game.players?.white?.id === playerId) {
            alert("You already created this game as White!");
            return;
        }
        // Prevent joining a full game
        if (game.players?.black?.joined && game.players?.black?.id !== playerId) {
            alert("This game is already full!");
            return;
        }

        const updates = {
            "players/black/id": playerId,
            "players/black/displayName": playerName,
            "players/black/avatarColor": playerColor,
            "players/black/joined": true,
        };

        // Add a 10s timeout to surface hangs instead of waiting indefinitely
        await Promise.race([
            update(gameRef, updates),
            new Promise((_, reject) => setTimeout(() => reject(new Error('Database update timeout')), 10000)),
        ]);

        // Force an immediate UI refresh from the latest DB state to avoid
        // showing a lingering "Joining…" state if the realtime listener
        // is slightly delayed.
        try {
            const latest = await get(gameRef);
            if (latest.exists()) {
                updateGameInfo(latest.val(), playerRole, gameId);
            }
        } catch (uiErr) {
            console.warn("joinGame: failed to fetch latest game for UI refresh", uiErr && uiErr.message);
        }

        showGameSession(gameId, playerRole); 
        await setupDisconnectHandler();
        startListening();
        // UI will also refresh from onValue listener after the update.
    } catch (err) {
        console.error("Join game failed:", err.message);
        alert("Failed to join game: " + err.message);
    }
}

export async function spectateGame() {
    const inputId = document.getElementById("gameIdInput").value.trim().toUpperCase();
    if (!inputId) { alert("Please enter a Game ID to spectate"); return; }
    try {
        const currentUser = auth.currentUser;
        if (!currentUser) throw new Error("Not authenticated.");
        await currentUser.reload();
        await currentUser.getIdToken(true);
        loadCurrentPlayer();
        playerId = currentUser.uid;

        gameId = inputId;
        playerRole = "spectator";
        isSpectator = true;
        window.__playerRole = playerRole;
        gameRef = ref(db, `games/${gameId}`);

        await _joinSpectator({
            gameId,
            playerId,
            displayName: playerName,
            avatarColor: playerColor
        });

        showGameSession(gameId, playerRole);
        startListening();
    } catch (err) {
        console.error("Spectate failed:", err.message);
        alert("Failed to join as spectator: " + err.message);
    }
}

/* =========================
   PUBLIC: ATTEMPT A MOVE
========================= */
export async function onMoveAttempt(fromRow, fromCol, toRow, toCol) {
    try {
        // Verify user is authenticated before attempting move
        const currentUser = auth.currentUser;
        if (!currentUser) {
            throw new Error("Not authenticated. Please refresh and sign in again.");
        }

        await _makeMove({ gameId, playerId, fromRow, fromCol, toRow, toCol });
    } catch (err) {
        console.warn("Move rejected:", err.message);
        alert("Invalid move: " + err.message);
    }
}

export async function sendChatMessage() {
    const input = document.getElementById("chatInput");
    const message = input?.value.trim();
    if (!message) return;
    try {
        const currentUser = auth.currentUser;
        if (!currentUser) throw new Error("Not authenticated.");
        loadCurrentPlayer();
        playerId = currentUser.uid;

        await _sendChatMessage({
            gameId,
            playerId,
            displayName: playerName,
            avatarColor: playerColor,
            message
        });
        input.value = "";
    } catch (err) {
        console.error("Chat send failed:", err.message);
        alert("Could not send chat message: " + err.message);
    }
}

export async function openProfile() {
    try {
        const currentUser = auth.currentUser;
        if (!currentUser) throw new Error("Not authenticated.");
        await currentUser.reload();
        await currentUser.getIdToken(true);
        loadCurrentPlayer();
        playerId = currentUser.uid;

        const snapshot = await get(ref(db, `players/${playerId}`));
        const profile = snapshot.exists() ? snapshot.val() : null;
        if (!profile) throw new Error("Profile not available");

        document.getElementById("profileName").textContent = profile.displayName || "Player";
        document.getElementById("profileColor").style.background = profile.avatarColor || "#888";
        document.getElementById("profileGamesPlayed").textContent = profile.stats?.gamesPlayed ?? 0;
        document.getElementById("profileWins").textContent = profile.stats?.wins ?? 0;
        document.getElementById("profileLosses").textContent = profile.stats?.losses ?? 0;
        const historyEl = document.getElementById("profileHistory");
        historyEl.innerHTML = "";
        const history = profile.history || {};
        const entries = Object.entries(history).sort((a, b) => (b[1].endedAt || 0) - (a[1].endedAt || 0));
        if (entries.length === 0) {
            historyEl.innerHTML = `<div class="profile-history-item">No matches played yet.</div>`;
        } else {
            for (const [gameId, item] of entries.slice(0, 10)) {
                const row = document.createElement("div");
                row.className = "profile-history-item";
                row.innerHTML = `
                    <strong>${item.result.toUpperCase()}</strong> vs ${item.opponentName || 'Opponent'}<br>
                    <span>${item.mode || 'classic'} • ${new Date(item.endedAt).toLocaleString()}</span>
                `;
                historyEl.appendChild(row);
            }
        }
        document.getElementById("profileModal").classList.remove("hidden");
    } catch (err) {
        console.error("Open profile failed:", err.message);
        alert("Could not open profile: " + err.message);
    }
}

export function closeProfile() {
    document.getElementById("profileModal").classList.add("hidden");
}

export async function surrenderGame() {
    if (playerRole !== "white" && playerRole !== "black") {
        alert("Only players can surrender.");
        return;
    }
    if (!confirm("Are you sure you want to surrender?")) return;
    try {
        const currentUser = auth.currentUser;
        if (!currentUser) throw new Error("Not authenticated.");
        loadCurrentPlayer();
        playerId = currentUser.uid;

        await _surrenderGame({ gameId, playerId });
        await cancelDisconnectHandler();
    } catch (err) {
        console.error("Surrender failed:", err.message);
        alert("Could not surrender: " + err.message);
    }
}

/* =========================
   PUBLIC: RESET GAME
========================= */
export async function resetGame() {
    if (!gameRef || playerRole !== "white") {
        alert("Only the game creator can reset.");
        return;
    }
    try {
        await set(gameRef, {
            board: [
                [0, 1, 0, 1, 0, 1, 0, 1],
                [1, 0, 1, 0, 1, 0, 1, 0],
                [0, 1, 0, 1, 0, 1, 0, 1],
                [0, 0, 0, 0, 0, 0, 0, 0],
                [0, 0, 0, 0, 0, 0, 0, 0],
                [2, 0, 2, 0, 2, 0, 2, 0],
                [0, 2, 0, 2, 0, 2, 0, 2],
                [2, 0, 2, 0, 2, 0, 2, 0]
            ],
            turn: "white",
            chainPiece: null,
            winner: null,
            mode: gameState?.mode || gameMode,
            players: gameState.players,
            spectators: gameState?.spectators || {},
            chat: gameState?.chat || {},
            lastMove: null,
            lastMoveTime: Date.now()
        });
    } catch (err) {
        console.error("Reset failed:", err.message);
        alert("Failed to reset game");
    }
}

export async function returnToLobby() {
    if (gameId && (playerRole === "white" || playerRole === "black") && gameState && !gameState.winner) {
        const opponentRole = playerRole === "white" ? "black" : "white";
        const opponentJoined = gameState.players?.[opponentRole]?.joined;
        if (opponentJoined) {
            try {
                await _surrenderGame({ gameId, playerId });
            } catch (err) {
                console.warn("Auto surrender failed:", err?.message || err);
            }
        }
    }

    await cancelDisconnectHandler();
    if (unsubscribe) {
        unsubscribe();
        unsubscribe = null;
    }
    gameState = null;
    gameId = null;
    gameRef = null;
    window.__gameState = null;
    window.__playerRole = null;

    clearHighlights();
    const boardEl = document.getElementById("board");
    if (boardEl) {
        boardEl.innerHTML = "";
        boardEl.classList.remove("atari-mode");
    }
    const chatPanel = document.getElementById("chatPanel");
    if (chatPanel) chatPanel.classList.add("hidden");

    const joinSection = document.getElementById("joinSection");
    if (joinSection) joinSection.classList.remove("hidden");
    const gameInfo = document.getElementById("gameInfo");
    if (gameInfo) gameInfo.classList.add("hidden");
    const playerRolePanel = document.getElementById("playerRole");
    if (playerRolePanel) playerRolePanel.classList.add("hidden");

    const gameIdInput = document.getElementById("gameIdInput");
    if (gameIdInput) {
        gameIdInput.value = "";
        gameIdInput.focus();
    }

    const titleEl = document.getElementById("gameTitle");
    const turnEl = document.getElementById("turnDisplay");
    const modeEl = document.getElementById("gameModeLabel");
    if (titleEl) titleEl.textContent = "Back to lobby";
    if (turnEl) turnEl.textContent = "";
    if (modeEl) modeEl.textContent = "Choose mode to play";

    const statusEl = document.getElementById("connectionStatus");
    if (statusEl) {
        statusEl.textContent = "Connected";
        statusEl.className = "status connected";
    }
    window.scrollTo({ top: 0, behavior: "smooth" });
}

/* =========================
   PRIVATE: START LISTENING
=========================*/
function startListening() {
    if (unsubscribe) unsubscribe();
    console.log("startListening: attaching onValue", { gameId, gameRefPath: gameRef?.toString?.() || String(gameRef), playerRole });
    unsubscribe = onValue(gameRef, async (snapshot) => {
        if (!snapshot.exists()) { console.warn("Game disappeared"); return; }
        const data = snapshot.val();
        console.log("onValue(game)", { gameId, playerRole, joinedBlack: data?.players?.black?.joined, players: data?.players });
        if (data.chainPiece && !Array.isArray(data.chainPiece)) {
            data.chainPiece = [data.chainPiece[0], data.chainPiece[1]];
        }
        await handleOpponentLeave(previousGameState, data);
        gameState = data;
        previousGameState = data;
        gameMode = gameState.mode || gameMode;
        window.__gameState = gameState;
        window.__playerRole = playerRole;
        renderBoard(gameState);
        clearHighlights();
        updateGameInfo(gameState, playerRole, gameId);
        if (gameState.winner) {
            await cancelDisconnectHandler();
        }
    });
}

/* =========================
   GLOBALS (for HTML buttons)
========================= */
window.createGame = createGame;
window.joinGame = joinGame;
window.spectateGame = spectateGame;
window.sendChatMessage = sendChatMessage;
window.surrenderGame = surrenderGame;
window.openProfile = openProfile;
window.closeProfile = closeProfile;
window.resetGame = resetGame;
window.returnToLobby = returnToLobby;
window.copyGameId = () => {
    navigator.clipboard.writeText(gameId);
    alert("Game ID copied!");
};
