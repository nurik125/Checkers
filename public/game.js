// game.js — Game state, Firebase listeners, move requests
import { db, fns, auth } from './firebase.js';
import { getCachedProfile } from './auth.js';
import {
    ref, set, get, update, onValue
} from "https://www.gstatic.com/firebasejs/9.22.0/firebase-database.js";
import {
    httpsCallable
} from "https://www.gstatic.com/firebasejs/9.22.0/firebase-functions.js";
import { renderBoard, clearHighlights, updateGameInfo, showGameCreated, showGameSession } from './ui.js';

/* =========================
   MODULE STATE
========================= */
let gameState = null;
let gameId = null;
let gameRef = null;
let unsubscribe = null;

// Filled from Firebase Auth + player profile
let playerId = null;   // Firebase Auth UID
let playerName = null;   // display name
let playerColor = null;  // avatar color (hex)
let playerRole = null;   // 'white' | 'black'

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
    window.__playerName = playerName;
    window.__playerColor = playerColor;
}

/* =========================
   FIREBASE FUNCTIONS BRIDGE
   Uses the fns instance from firebase.js which is already
   wired to the emulator in dev mode.
========================= */
const _makeMove = httpsCallable(fns, "makeMove");

let _createGame;

function getCreateGame() {
    if (!_createGame) {
        if (!fns) throw new Error("fns not ready");
        _createGame = httpsCallable(fns, "createGame");
    }

    console.log(_createGame);

    return _createGame;
}

/* =========================
   PUBLIC: CREATE GAME
========================= */
export async function createGame() {
    try {
        loadCurrentPlayer();

        // Verify user is authenticated in Firebase Auth
        const currentUser = auth.currentUser;
        if (!currentUser) {
            throw new Error("Not authenticated. Please sign in first.");
        }

        // Refresh auth state and ensure token is valid
        await currentUser.reload();
        await currentUser.getIdToken(true);
        playerId = currentUser.uid;

        const result = await getCreateGame()({
            playerId,
            displayName: playerName,
            avatarColor: playerColor
        });

        gameId = result.data.gameId;
        playerRole = "white";
        window.__playerRole = playerRole;
        showGameSession(gameId, playerRole);
        gameRef = ref(db, `games/${gameId}`);
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
                chainPiece: null
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
        loadCurrentPlayer();

        // Verify user is authenticated in Firebase Auth
        const currentUser = auth.currentUser;
        if (!currentUser) {
            throw new Error("Not authenticated. Please sign in first.");
        }

        // Refresh auth state and ensure token is valid
        await currentUser.reload();
        await currentUser.getIdToken(true);
        playerId = currentUser.uid;

        gameId = inputId;
        playerRole = "black";
        window.__playerRole = playerRole;
        gameRef = ref(db, `games/${gameId}`);
        startListening();

        const snapshot = await get(gameRef);
        if (!snapshot.exists()) { alert("Game not found!"); return; }

        const game = snapshot.val();
        console.log("joinGame current game:", game);

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

        console.log("joinGame: updating black player", playerId);
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

        console.log("joinGame: updated black player", playerId);

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
        // UI will also refresh from onValue listener after the update.
    } catch (err) {
        console.error("Join game failed:", err.message);
        alert("Failed to join game: " + err.message);
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
            players: gameState.players,
            lastMoveTime: Date.now()
        });
    } catch (err) {
        console.error("Reset failed:", err.message);
        alert("Failed to reset game");
    }
}

/* =========================
   PRIVATE: START LISTENING
========================= */
function startListening() {
    if (unsubscribe) unsubscribe();
    unsubscribe = onValue(gameRef, (snapshot) => {
        if (!snapshot.exists()) { console.warn("Game disappeared"); return; }
        const data = snapshot.val();
        console.log("game update received", data, "role", playerRole);
        if (data.chainPiece && !Array.isArray(data.chainPiece)) {
            data.chainPiece = [data.chainPiece[0], data.chainPiece[1]];
        }
        gameState = data;
        window.__gameState = gameState;
        window.__playerRole = playerRole;
        renderBoard(gameState);
        clearHighlights();
        updateGameInfo(gameState, playerRole, gameId);
    });
}

/* =========================
   GLOBALS (for HTML buttons)
========================= */
window.createGame = createGame;
window.joinGame = joinGame;
window.resetGame = resetGame;
window.copyGameId = () => {
    navigator.clipboard.writeText(gameId);
    alert("Game ID copied!");
};
