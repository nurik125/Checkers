const functions = require("firebase-functions");
const admin = require("firebase-admin");
admin.initializeApp();
const db = admin.database();
const IS_EMULATOR = !!process.env.FIREBASE_AUTH_EMULATOR_HOST;

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
    board, turn: nextTurn, chainPiece, winner: winner || null,
    players: game.players, lastMoveTime: Date.now(),
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

/* =========================
   CREATE GAME (Cloud Function)
   Now accepts: playerId, displayName, avatarColor
========================= */
exports.createGame = functions.https.onCall(async (data, context) => {
  // Verify user is authenticated (allow emulator fallback)
  if (!context.auth && !IS_EMULATOR) {
    throw new functions.https.HttpsError(
        "unauthenticated",
        "User must be authenticated",
    );
  }

  // Debug: log auth context for emulator troubleshooting
  console.log("createGame auth:", context.auth);

  const {playerId, displayName, avatarColor} = data;

  // Verify playerId matches authenticated user (skip check in emulator if unauthenticated)
  if (context.auth && playerId !== context.auth.uid) {
    throw new functions.https.HttpsError(
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
            throw new functions.https.HttpsError("internal", "Could not generate unique game ID");
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
    players: {
      white: {
        id: playerId ?? null,
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
    createdAt: Date.now(),
    lastMoveTime: Date.now(),
  };

  console.log("createGame initialState:", initialState, "gameId:", gameId);
  await gameRef.set(initialState);
  return {gameId};
    } catch (err) {
        console.error("createGame error:", err, "context.auth:", context && context.auth, "data:", data);
        throw new functions.https.HttpsError("internal", "Internal server error");
    }
});

/* =========================
   MAKE MOVE (Cloud Function)
========================= */
exports.makeMove = functions.https.onCall(async (data, context) => {
  // Verify user is authenticated (allow emulator fallback)
  if (!context.auth && !IS_EMULATOR) {
    throw new functions.https.HttpsError(
        "unauthenticated",
        "User must be authenticated",
    );
  }

  // Debug: log auth context for emulator troubleshooting
  console.log("makeMove auth:", context.auth);

  const {gameId, fromRow, fromCol, toRow, toCol, playerId} = data;

  // Verify playerId matches authenticated user (skip check in emulator if unauthenticated)
  if (context.auth && playerId !== context.auth.uid) {
    throw new functions.https.HttpsError(
        "permission-denied",
        "PlayerId does not match authenticated user",
    );
  }

  const gameRef = db.ref(`games/${gameId}`);
  const snapshot = await gameRef.get();
  if (!snapshot.exists()) throw new functions.https.HttpsError("not-found", "Game not found");

  const game = snapshot.val();
  if (game.winner) {
    throw new functions.https.HttpsError("failed-precondition", "Game is already over");
  }
  if (!game.players?.white?.joined || !game.players?.black?.joined) {
    throw new functions.https.HttpsError("failed-precondition", "Waiting for opponent");
  }

  let player = null;
  if (game.players?.white?.id === playerId) player = "white";
  if (game.players?.black?.id === playerId) player = "black";
  if (!player) {
    throw new functions.https.HttpsError("permission-denied", "Not a player in this game");
  }
  if (game.turn !== player) {
    throw new functions.https.HttpsError("failed-precondition", "Not your turn");
  }

  const chainPiece = Array.isArray(game.chainPiece) ?
        game.chainPiece :
        game.chainPiece ? [game.chainPiece[0], game.chainPiece[1]] : null;

  const move = findMove(game.board, fromRow, fromCol, toRow, toCol, player, chainPiece);
  if (!move) throw new functions.https.HttpsError("invalid-argument", "Invalid move");

  const newGame = applyMove({...game, chainPiece}, fromRow, fromCol, toRow, toCol, move);
  await gameRef.update(newGame);
  return {success: true, winner: newGame.winner};
});
