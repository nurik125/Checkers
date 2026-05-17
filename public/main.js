// main.js — Entry point
// Auth runs first; lobby is shown only after the player is authenticated.

import './firebase.js';
import { waitForAuthReady, signInAsGuest, signInWithGoogle } from './auth.js';
import { createGame, joinGame, resetGame, onMoveAttempt } from './game.js';
import './ui.js';


/* =========================
   BOOT SEQUENCE
========================= */
async function boot() {
    // Check if user is already authenticated from a previous session
    const existingProfile = await waitForAuthReady();

    if (existingProfile) {
        // Returning player — skip modal
        window.__playerName = existingProfile.displayName;
        window.__playerColor = existingProfile.avatarColor;
        showLobby(existingProfile);
    } else {
        // New visitor — show auth modal
        showAuthModal();
    }
}

/* =========================
   AUTH MODAL
========================= */
function showAuthModal() {
    document.getElementById("authModal").classList.remove("hidden");
    document.getElementById("lobbyWrapper").classList.add("hidden");
}

function showLobby(profile) {
    document.getElementById("authModal").classList.add("hidden");
    document.getElementById("lobbyWrapper").classList.remove("hidden");

    // Update the persistent player badge in the lobby
    const badge = document.getElementById("playerBadge");
    if (badge) {
        badge.innerHTML = `
            <span style="
                display:inline-block;
                width:10px; height:10px;
                border-radius:50%;
                background:${profile.avatarColor};
                margin-right:6px;
                border:1px solid rgba(255,255,255,.4);
            "></span>
            ${profile.displayName}
        `;
    }
}

/* =========================
   BUTTON HANDLERS (wired to HTML)
========================= */
window.handleGuestLogin = async () => {
    const input = document.getElementById("nicknameInput");
    const nickname = input.value.trim();
    const errEl = document.getElementById("authError");
    errEl.textContent = "";

    try {
        setAuthLoading(true);
        const profile = await signInAsGuest(nickname);
        window.__playerName = profile.displayName;
        window.__playerColor = profile.avatarColor;
        showLobby(profile);
    } catch (err) {
        errEl.textContent = err.message;
    } finally {
        setAuthLoading(false);
    }
};

window.handleGoogleLogin = async () => {
    const errEl = document.getElementById("authError");
    errEl.textContent = "";
    try {
        setAuthLoading(true);
        const profile = await signInWithGoogle();
        window.__playerName = profile.displayName;
        window.__playerColor = profile.avatarColor;
        showLobby(profile);
    } catch (err) {
        errEl.textContent = err.message;
    } finally {
        setAuthLoading(false);
    }
};

function setAuthLoading(loading) {
    document.getElementById("guestBtn").disabled = loading;
    document.getElementById("googleBtn").disabled = loading;
    document.getElementById("authLoading").classList.toggle("hidden", !loading);
}

// Wire game functions to global scope for HTML onclick handlers
window.createGame = createGame;
window.joinGame = joinGame;
window.resetGame = resetGame;
window.onMoveAttempt = onMoveAttempt;

// Allow Enter key in nickname field
document.getElementById("nicknameInput")?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") window.handleGuestLogin();
});

boot();
