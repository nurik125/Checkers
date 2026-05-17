// firebase.js — Firebase app init + emulator wiring
import { initializeApp }
    from "https://www.gstatic.com/firebasejs/9.22.0/firebase-app.js";
import { getDatabase, connectDatabaseEmulator }
    from "https://www.gstatic.com/firebasejs/9.22.0/firebase-database.js";
import { getFunctions, connectFunctionsEmulator }
    from "https://www.gstatic.com/firebasejs/9.22.0/firebase-functions.js";
import { getAuth, connectAuthEmulator }
    from "https://www.gstatic.com/firebasejs/9.22.0/firebase-auth.js";

const firebaseConfig = {
    apiKey: "AIzaSyCqnKZAMZcepEEuHG5S0i8KRiSpoTC6LJg",
    authDomain: "nfac-checkers.firebaseapp.com",
    databaseURL: "https://nfac-checkers-default-rtdb.asia-southeast1.firebasedatabase.app",
    projectId: "nfac-checkers",
    storageBucket: "nfac-checkers.firebasestorage.app",
    messagingSenderId: "481153763142",
    appId: "1:481153763142:web:25e39f068c0c2bdf440747",
    measurementId: "G-GEVKBPRS1F"
};

export const app = initializeApp(firebaseConfig);
export const db = getDatabase(app);
export const fns = getFunctions(app, "us-central1");
export const auth = getAuth(app);

const isLocal = location.hostname === "localhost" || location.hostname === "127.0.0.1";

if (isLocal) {
    console.log("🔧 Development mode — connecting to emulators");
    connectDatabaseEmulator(db, "127.0.0.1", 9000);
    connectFunctionsEmulator(fns, "127.0.0.1", 5001);
    connectAuthEmulator(auth, "http://127.0.0.1:9099");
    console.log("✅ Emulators: DB:9000  Functions:5001  Auth:9099");
} else {
    console.log("📡 Production mode — live Firebase");
}
