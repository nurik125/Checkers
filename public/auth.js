// auth.js — Authentication & player profile management
import { signInAnonymously, signInWithPopup, signOut, GoogleAuthProvider, onAuthStateChanged }
    from "https://www.gstatic.com/firebasejs/9.22.0/firebase-auth.js";
import { ref, set, get }
    from "https://www.gstatic.com/firebasejs/9.22.0/firebase-database.js";
import { db as _db, auth } from './firebase.js';

/* =========================
   SETUP — reuse the already-emulator-wired instances from firebase.js
========================= */
const db = _db;

// 20 vivid avatar colors — never pure black, never pure white
const AVATAR_COLORS = [
    "#E74C3C", "#E67E22", "#F1C40F", "#2ECC71", "#1ABC9C",
    "#3498DB", "#9B59B6", "#E91E63", "#00BCD4", "#FF5722",
    "#8BC34A", "#FF9800", "#607D8B", "#795548", "#009688",
    "#673AB7", "#F06292", "#4CAF50", "#26C6DA", "#FFA726"
];

function randomColor() {
    return AVATAR_COLORS[Math.floor(Math.random() * AVATAR_COLORS.length)];
}

/* =========================
   SAVE PLAYER TO DB
========================= */
async function savePlayer(uid, displayName, avatarColor) {
    const playerRef = ref(db, `players/${uid}`);
    const snap = await get(playerRef);
    if (snap.exists()) return snap.val();
    const profile = { uid, displayName, avatarColor, createdAt: Date.now() };
    await set(playerRef, profile);
    return profile;
}

/* =========================
   IN-MEMORY PROFILE CACHE
========================= */
let _cachedProfile = null;

export function getCachedProfile() { return _cachedProfile; }

/* =========================
   FETCH EXISTING PLAYER
========================= */
export async function getPlayerProfile(uid) {
    const snap = await get(ref(db, `players/${uid}`));
    return snap.exists() ? snap.val() : null;
}

/* =========================
   AUTH: ANONYMOUS (nickname)
========================= */
export async function signInAsGuest(nickname) {
    if (!nickname || nickname.trim().length < 2) {
        throw new Error("Nickname must be at least 2 characters.");
    }

    const cred = await signInAnonymously(auth);
    const profile = await savePlayer(cred.user.uid, nickname.trim(), randomColor());

    _cachedProfile = profile;
    return profile;
}
/* =========================
   AUTH: GOOGLE
========================= */
export async function signInWithGoogle() {
    const provider = new GoogleAuthProvider();
    const cred = await signInWithPopup(auth, provider);
    const name = cred.user.displayName || "Player";
    const profile = await savePlayer(cred.user.uid, name, randomColor());
    _cachedProfile = profile;
    return profile;
}

/* =========================
   OBSERVE AUTH STATE
   Resolves with the player profile if the session is valid,
   or null if not signed in / session is stale (emulator restart).

   The 400 on accounts:lookup happens when the browser has a cached
   Firebase token from a previous emulator session. The new emulator
   instance doesn't recognise it → we sign out and return null so
   the auth modal is shown again.
========================= */
export function waitForAuthReady() {
    return new Promise((resolve) => {
        const unsub = onAuthStateChanged(auth, async (user) => {
            unsub();
            if (!user) { resolve(null); return; }

            try {
                // Force-refresh the token. If the emulator was restarted
                // this throws and we fall through to the catch block.
                await user.getIdToken(true);

                const profile = await getPlayerProfile(user.uid);
                if (!profile) {
                    // Signed in via Auth but no DB profile — treat as fresh
                    await signOut(auth);
                    resolve(null);
                    return;
                }
                _cachedProfile = profile;
                resolve(profile);
            } catch (err) {
                // Stale / invalid token (common after emulator restart)
                console.warn("Stale auth token, signing out:", err.code || err.message);
                try { await signOut(auth); } catch (_) { /* ignore */ }
                _cachedProfile = null;
                resolve(null);
            }
        });
    });
}
