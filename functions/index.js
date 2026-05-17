const {onCall, HttpsError} = require("firebase-functions/v2/https");
const {setGlobalOptions} = require("firebase-functions/v2");
const {onSchedule} = require("firebase-functions/v2/scheduler");

setGlobalOptions({region: "asia-southeast1"});
const admin = require("firebase-admin");
admin.initializeApp();
const db = admin.database();

/* =========================
   PIECE CONSTANTS
========================= */
const PIECE = {
  EMPTY: 0, WHITE: 1, BLACK: 2, WHITE_KING: 3, BLACK_KING: 4,
};

/* =========================
   PURE HELPERS
========================= */
function isWhite(piece) {
  return piece === PIECE.WHITE || piece === PIECE.WHITE_KING;
}
function isKing(piece) {
  return piece === PIECE.WHITE_KING || piece === PIECE.BLACK_KING;
}
function isPieceOwned(piece, player) {
  if (piece === PIECE.EMPTY) return false;
  return player === "white" ? isWhite(piece) : !isWhite(piece);
}
function isOnBoard(r, c) {
  return r >= 0 && r < 8 && c >= 0 && c < 8;
}

/* =========================
   DIAGONAL SCAN
========================= */
function scanDiagonal(board, fromRow, fromCol, dr, dc) {
  const squares = [];
  let r = fromRow + dr; let c = fromCol + dc;
  while (isOnBoard(r, c)) {
    squares.push({row: r, col: c, piece: board[r][c]});
    r += dr; c += dc;
  }
  return squares;
}

/* =========================
   RAW MOVE GENERATION
========================= */
function _getMovesForPiece(board, row, col, turn) {
  const piece = board[row][col];
  if (piece === PIECE.EMPTY || !isPieceOwned(piece, turn)) return [];
  const opponent = turn === "white" ? "black" : "white";
  const kingPiece = isKing(piece);
  const whitePiece = isWhite(piece);
  const moves = [];
  const DIRS = [[-1, -1], [-1, 1], [1, -1], [1, 1]];
  for (const [dr, dc] of DIRS) {
    const path = scanDiagonal(board, row, col, dr, dc);
    if (kingPiece) {
      let foundEnemy = false; let capturePos = null;
      for (const sq of path) {
        if (sq.piece === PIECE.EMPTY) {
          moves.push({
            fromRow: row, fromCol: col, row: sq.row, col: sq.col,
            isCapture: foundEnemy, capturePos: foundEnemy ? capturePos : null,
          });
        } else if (isPieceOwned(sq.piece, opponent) && !foundEnemy) {
          foundEnemy = true; capturePos = {row: sq.row, col: sq.col};
        } else {
          break;
        }
      }
    } else {
      const forward = whitePiece ? dr > 0 : dr < 0;
      if (path.length >= 1 && path[0].piece === PIECE.EMPTY && forward) {
        moves.push({
          fromRow: row, fromCol: col, row: path[0].row, col: path[0].col,
          isCapture: false, capturePos: null,
        });
      }
      if (path.length >= 2 && isPieceOwned(path[0].piece, opponent) && path[1].piece === PIECE.EMPTY) {
        moves.push({
          fromRow: row, fromCol: col, row: path[1].row, col: path[1].col,
          isCapture: true, capturePos: {row: path[0].row, col: path[0].col},
        });
      }
    }
  }
  return moves;
}

/* =========================
   MANDATORY CAPTURE SCAN
========================= */
function getAllCaptureMoves(board, turn) {
  const captures = [];
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      for (const m of _getMovesForPiece(board, r, c, turn)) {
        if (m.isCapture) captures.push(m);
      }
    }
  }
  return captures;
}

/* =========================
   VALID MOVES
========================= */
function getValidMoves(board, row, col, turn, chainPiece) {
  if (chainPiece) {
    const [lr, lc] = chainPiece;
    if (row !== lr || col !== lc) return [];
    return _getMovesForPiece(board, row, col, turn).filter((m) => m.isCapture);
  }
  if (getAllCaptureMoves(board, turn).length > 0) {
    return _getMovesForPiece(board, row, col, turn).filter((m) => m.isCapture);
  }
  return _getMovesForPiece(board, row, col, turn);
}

/* =========================
   FIND MOVE
========================= */
function findMove(board, fromRow, fromCol, toRow, toCol, turn, chainPiece) {
  const moves = getValidMoves(board, fromRow, fromCol, turn, chainPiece);
  return moves.find((m) => m.row === toRow && m.col === toCol) || null;
}

/* =========================
   APPLY MOVE
========================= */
function applyMove(game, fromRow, fromCol, toRow, toCol, move) {
  const board = game.board.map((r) => [...r]);
  let piece = board[fromRow][fromCol];
  board[fromRow][fromCol] = PIECE.EMPTY;
  board[toRow][toCol] = piece;
  if (move.isCapture && move.capturePos) {
    board[move.capturePos.row][move.capturePos.col] = PIECE.EMPTY;
  }
  const promoted =
        (piece === PIECE.WHITE && toRow === 7) ||
        (piece === PIECE.BLACK && toRow === 0);
  if (promoted) {
    board[toRow][toCol] = piece === PIECE.WHITE ? PIECE.WHITE_KING : PIECE.BLACK_KING;
    piece = board[toRow][toCol];
  }
  let nextTurn = game.turn === "white" ? "black" : "white";
  let chainPiece = null;
  if (move.isCapture && !promoted) {
    const followUps = _getMovesForPiece(board, toRow, toCol, game.turn)
        .filter((m) => m.isCapture);
    if (followUps.length > 0) {
      nextTurn = game.turn; chainPiece = [toRow, toCol];
    }
  }
  const winner = checkWinner(board, nextTurn);
  return {
    board,
    turn: nextTurn,
    chainPiece,
    winner: winner || null,
    players: game.players,
    lastMove: {
      from: {row: fromRow, col: fromCol},
      to: {row: toRow, col: toCol},
    },
    lastMoveTime: Date.now(),
  };
}

/* =========================
   WIN CONDITION
========================= */
function checkWinner(board, nextTurn) {
  let white = 0; let black = 0;
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const p = board[r][c];
      if (p === PIECE.EMPTY) continue;
      if (isWhite(p)) white++; else black++;
    }
  }
  if (white === 0) return "black";
  if (black === 0) return "white";
  let hasMove = false;
  outer: for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      if (_getMovesForPiece(board, r, c, nextTurn).length > 0) {
        hasMove = true; break outer;
      }
    }
  }
  if (!hasMove) return nextTurn === "white" ? "black" : "white";
  return null;
}

async function updatePlayerHistory(playerId, opponent, result, gameId, mode) {
  if (!playerId) return;
  const playerRef = db.ref(`players/${playerId}`);
  const snapshot = await playerRef.get();
  const current = snapshot.exists() ? snapshot.val() : {};
  const stats = current.stats || {gamesPlayed: 0, wins: 0, losses: 0};
  stats.gamesPlayed += 1;
  if (result === "win") stats.wins += 1;
  if (result === "loss") stats.losses += 1;
  const history = current.history || {};
  history[gameId] = {
    opponentId: opponent.id || null,
    opponentName: opponent.name || "Unknown",
    result,
    mode: mode || "classic",
    endedAt: Date.now(),
  };
  await playerRef.update({stats, history});
}

async function recordMatchResult(game, winner) {
  if (!winner || !game.players) return;
  const loser = winner === "white" ? "black" : "white";
  const winnerPlayer = game.players[winner];
  const loserPlayer = game.players[loser];
  const mode = game.mode || "classic";
  await Promise.all([
    updatePlayerHistory(winnerPlayer.id, {id: loserPlayer.id, name: loserPlayer.displayName}, "win", game.gameId || "unknown", mode),
    updatePlayerHistory(loserPlayer.id, {id: winnerPlayer.id, name: winnerPlayer.displayName}, "loss", game.gameId || "unknown", mode),
  ].filter(Boolean));
}

/* =========================
   CREATE GAME (Cloud Function)
   Now accepts: playerId, displayName, avatarColor, mode
========================= */
exports.createGame = onCall(async (request) => {
  const data = request.data;
  const auth = request.auth;

  const {playerId, displayName, avatarColor} = data;
  // Basic validation of incoming data
  if (playerId !== undefined && typeof playerId !== "string") {
    throw new HttpsError("invalid-argument", "playerId must be a string");
  }

  // Verify user is authenticated (allow emulator fallback)
  if (!auth) {
    throw new HttpsError(
        "unauthenticated",
        "User must be authenticated",
    );
  }

  // Verify playerId matches authenticated user (skip check in emulator if unauthenticated)
  if (auth && playerId !== auth.uid) {
    throw new HttpsError(
        "permission-denied",
        "PlayerId does not match authenticated user",
    );
  }

  try {
    // Generate a unique gameId, retrying on collision
    let gameId = Math.random().toString(36).substring(2, 10).toUpperCase();
    let gameRef = db.ref(`games/${gameId}`);
    let snapshot = await gameRef.get();
    let attempts = 0;
    while (snapshot.exists() && attempts < 5) {
      gameId = Math.random().toString(36).substring(2, 10).toUpperCase();
      gameRef = db.ref(`games/${gameId}`);
      snapshot = await gameRef.get();
      attempts++;
    }
    if (snapshot.exists()) {
      throw new HttpsError("internal", "Could not generate unique game ID");
    }

    const initialState = {
      board: [
        [0, 1, 0, 1, 0, 1, 0, 1],
        [1, 0, 1, 0, 1, 0, 1, 0],
        [0, 1, 0, 1, 0, 1, 0, 1],
        [0, 0, 0, 0, 0, 0, 0, 0],
        [0, 0, 0, 0, 0, 0, 0, 0],
        [2, 0, 2, 0, 2, 0, 2, 0],
        [0, 2, 0, 2, 0, 2, 0, 2],
        [2, 0, 2, 0, 2, 0, 2, 0],
      ],
      turn: "white",
      chainPiece: null,
      winner: null,
      mode: data.mode === "atari" ? "atari" : "classic",
      players: {
        white: {
          id: playerId ?? "unknown",
          displayName: displayName || "Player",
          avatarColor: avatarColor || "#3498DB",
          joined: true,
        },
        black: {
          id: null,
          displayName: null,
          avatarColor: null,
          joined: false,
        },
      },
      spectators: {},
      chat: {},
      createdAt: Date.now(),
      lastMove: null,
      lastMoveTime: Date.now(),
    };

    // Attempt to write initial game state. Log and rethrow detailed error in dev.
    try {
      await gameRef.set(initialState);
      console.log("createGame succeeded", {gameId});
      return {gameId};
    } catch (writeErr) {
      console.error("createGame write error:", writeErr, "auth:", auth, "data:", data);
      // Surface more useful message to callers while keeping HttpsError semantics
      const message = writeErr && writeErr.message ? writeErr.message : "Failed to write game to database";
      throw new HttpsError("internal", message);
    }
  } catch (err) {
    console.error("createGame error:", err && err.stack ? err.stack : err, "auth:", auth, "data:", data);
    if (err instanceof HttpsError) throw err;
    throw new HttpsError("internal", err && err.message ? err.message : "Internal server error");
  }
});

/* =========================
   MAKE MOVE (Cloud Function)
========================= */
exports.makeMove = onCall(async (request) => {
  const data = request.data;
  const auth = request.auth;

  // Verify user is authenticated (allow emulator fallback)
  if (!auth) {
    throw new HttpsError(
        "unauthenticated",
        "User must be authenticated",
    );
  }

  const {gameId, fromRow, fromCol, toRow, toCol, playerId} = data;

  // Verify playerId matches authenticated user (skip check in emulator if unauthenticated)
  if (auth && playerId !== auth.uid) {
    throw new HttpsError(
        "permission-denied",
        "PlayerId does not match authenticated user",
    );
  }

  const gameRef = db.ref(`games/${gameId}`);
  const snapshot = await gameRef.get();
  if (!snapshot.exists()) throw new HttpsError("not-found", "Game not found");

  const game = snapshot.val();
  if (game.winner) {
    throw new HttpsError("failed-precondition", "Game is already over");
  }
  if (!game.players?.white?.joined || !game.players?.black?.joined) {
    throw new HttpsError("failed-precondition", "Waiting for opponent");
  }

  let player = null;
  if (game.players?.white?.id === playerId) player = "white";
  if (game.players?.black?.id === playerId) player = "black";
  if (!player) {
    throw new HttpsError("permission-denied", "Not a player in this game");
  }
  if (game.turn !== player) {
    throw new HttpsError("failed-precondition", "Not your turn");
  }

  const chainPiece = Array.isArray(game.chainPiece) ?
        game.chainPiece :
        game.chainPiece ? [game.chainPiece[0], game.chainPiece[1]] : null;

  const move = findMove(game.board, fromRow, fromCol, toRow, toCol, player, chainPiece);
  if (!move) throw new HttpsError("invalid-argument", "Invalid move");

  const newGame = applyMove({...game, chainPiece}, fromRow, fromCol, toRow, toCol, move);
  if (newGame.winner) {
    newGame.endedAt = Date.now();
  }
  await gameRef.update(newGame);
  if (newGame.winner) {
    await recordMatchResult({...newGame, gameId}, newGame.winner);
  }
  return {success: true, winner: newGame.winner};
});

/* =========================
   JOIN AS SPECTATOR
========================= */
exports.joinSpectator = onCall(async (request) => {
  const data = request.data;
  const auth = request.auth;
  if (!auth) {
    throw new HttpsError("unauthenticated", "User must be authenticated");
  }
  const {gameId, playerId, displayName, avatarColor} = data;
  if (playerId !== auth.uid) {
    throw new HttpsError("permission-denied", "PlayerId does not match authenticated user");
  }
  const gameRef = db.ref(`games/${gameId}`);
  const snapshot = await gameRef.get();
  if (!snapshot.exists()) throw new HttpsError("not-found", "Game not found");
  const game = snapshot.val();
  if (game.players?.white?.id === playerId || game.players?.black?.id === playerId) {
    throw new HttpsError("failed-precondition", "Players do not need spectator mode");
  }
  const spectatorRef = gameRef.child(`spectators/${playerId}`);
  await spectatorRef.set({id: playerId, displayName: displayName || "Spectator", avatarColor: avatarColor || "#888", joinedAt: Date.now()});
  return {success: true};
});

/* =========================
   SEND CHAT MESSAGE
========================= */
exports.sendChatMessage = onCall(async (request) => {
  const data = request.data;
  const auth = request.auth;
  if (!auth) {
    throw new HttpsError("unauthenticated", "User must be authenticated");
  }
  const {gameId, playerId, message, displayName, avatarColor} = data;
  if (playerId !== auth.uid) {
    throw new HttpsError("permission-denied", "PlayerId does not match authenticated user");
  }
  if (!message || typeof message !== "string" || message.trim().length === 0) {
    throw new HttpsError("invalid-argument", "Message cannot be empty");
  }
  const chatRef = db.ref(`games/${gameId}/chat`);
  await chatRef.push({playerId, displayName: displayName || "Player", avatarColor: avatarColor || "#888", message: message.trim(), sentAt: Date.now()});
  return {success: true};
});

/* =========================
   SURRENDER GAME
========================= */
exports.surrenderGame = onCall(async (request) => {
  const data = request.data;
  const auth = request.auth;
  if (!auth) {
    throw new HttpsError("unauthenticated", "User must be authenticated");
  }
  const {gameId, playerId} = data;
  if (playerId !== auth.uid) {
    throw new HttpsError("permission-denied", "PlayerId does not match authenticated user");
  }
  const gameRef = db.ref(`games/${gameId}`);
  const snapshot = await gameRef.get();
  if (!snapshot.exists()) throw new HttpsError("not-found", "Game not found");
  const game = snapshot.val();
  if (game.winner) {
    throw new HttpsError("failed-precondition", "Game is already over");
  }
  let player = null;
  if (game.players?.white?.id === playerId) player = "white";
  if (game.players?.black?.id === playerId) player = "black";
  if (!player) {
    throw new HttpsError("permission-denied", "Only players can surrender");
  }
  const winner = player === "white" ? "black" : "white";
  const update = {winner, surrenderedBy: player, lastMoveTime: Date.now(), endedAt: Date.now()};
  await gameRef.update(update);
  await recordMatchResult({...game, gameId}, winner);
  return {success: true, winner};
});

/* =========================
   CLAIM WIN AFTER OPPONENT LEAVES
========================= */
exports.claimWin = onCall(async (request) => {
  const data = request.data;
  const auth = request.auth;
  if (!auth) {
    throw new HttpsError("unauthenticated", "User must be authenticated");
  }
  const {gameId, playerId} = data;
  if (playerId !== auth.uid) {
    throw new HttpsError("permission-denied", "PlayerId does not match authenticated user");
  }
  const gameRef = db.ref(`games/${gameId}`);
  const snapshot = await gameRef.get();
  if (!snapshot.exists()) throw new HttpsError("not-found", "Game not found");
  const game = snapshot.val();
  if (game.winner) {
    throw new HttpsError("failed-precondition", "Game is already over");
  }
  let player = null;
  if (game.players?.white?.id === playerId) player = "white";
  if (game.players?.black?.id === playerId) player = "black";
  if (!player) {
    throw new HttpsError("permission-denied", "Not a player in this game");
  }
  const opponent = player === "white" ? "black" : "white";
  if (game.players?.[opponent]?.joined !== false) {
    throw new HttpsError("failed-precondition", "Opponent has not left the game");
  }
  const update = {
    winner: player,
    surrenderedBy: opponent,
    lastMoveTime: Date.now(),
    endedAt: Date.now(),
  };
  await gameRef.update(update);
  await recordMatchResult({...game, gameId}, player);
  return {success: true, winner: player};
});

/* =========================
   CLEANUP ENDED GAMES
======================== */
exports.cleanupEndedGames = onSchedule("every 6 hours", async () => {
  const cutoff = Date.now() - 1000 * 60 * 60 * 24;
  const snapshot = await db.ref("games").get();
  if (!snapshot.exists()) {
    return {deleted: 0};
  }
  const removals = [];
  snapshot.forEach((child) => {
    const value = child.val();
    if (!value) return;
    const endedAt = value.endedAt || value.lastMoveTime || 0;
    const createdAt = value.createdAt || 0;
    if (value.winner && endedAt > 0 && endedAt <= cutoff) {
      removals.push(db.ref(`games/${child.key}`).remove());
    } else if (value.winner && !endedAt && createdAt > 0 && createdAt <= cutoff) {
      removals.push(db.ref(`games/${child.key}`).remove());
    }
  });
  await Promise.all(removals);
  return {deleted: removals.length};
});
