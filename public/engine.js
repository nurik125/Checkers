import { PIECE, isKing, isWhite, isOnBoard, isPieceOwned } from "./module.js";

// Returns all squares along a diagonal direction from a starting position.
function _scanDiagonal(board, fromRow, fromCol, stepRow, stepCol) {
    const squares = [];
    let r = fromRow + stepRow;
    let c = fromCol + stepCol;
    while (isOnBoard(r, c)) {
        squares.push({ row: r, col: c, piece: board[r][c] });
        r += stepRow;
        c += stepCol;
    }
    return squares;
}

// Internal: compute all moves for a single piece without the mandatory-capture filter.
function _getMovesForPiece(gameState, row, col) {
    const piece = gameState.board[row][col];
    if (piece === PIECE.EMPTY || !isPieceOwned(piece, gameState.turn)) return [];

    const isKingPiece = isKing(piece);
    const isWhitePiece = isWhite(piece);
    const opponent = gameState.turn === 'white' ? 'black' : 'white';

    const moves = [];

    const directions = [
        { row: -1, col: -1 },
        { row: -1, col: 1 },
        { row: 1, col: -1 },
        { row: 1, col: 1 }
    ];

    for (const dir of directions) {
        const squares = _scanDiagonal(gameState.board, row, col, dir.row, dir.col);

        if (isKingPiece) {
            let foundEnemy = false;
            let capturedPos = null;

            for (const sq of squares) {
                if (sq.piece === PIECE.EMPTY) {
                    if (!foundEnemy) {
                        moves.push({ fromRow: row, fromCol: col, row: sq.row, col: sq.col, isCapture: false, capturePos: null });
                    } else {
                        // capturePos is the exact enemy square — passed to makeMove so it never guesses
                        moves.push({ fromRow: row, fromCol: col, row: sq.row, col: sq.col, isCapture: true, capturePos: capturedPos });
                    }
                } else if (isPieceOwned(sq.piece, opponent) && !foundEnemy) {
                    foundEnemy = true;
                    capturedPos = { row: sq.row, col: sq.col };
                } else {
                    break;
                }
            }
        } else {
            const isForward = isWhitePiece ? dir.row > 0 : dir.row < 0;

            if (squares.length >= 1 && squares[0].piece === PIECE.EMPTY && isForward) {
                moves.push({ fromRow: row, fromCol: col, row: squares[0].row, col: squares[0].col, isCapture: false, capturePos: null });
            }

            // Capture: enemy on first square, empty landing on second (any direction)
            if (squares.length >= 2
                && isPieceOwned(squares[0].piece, opponent)
                && squares[1].piece === PIECE.EMPTY) {
                moves.push({
                    fromRow: row, fromCol: col,
                    row: squares[1].row, col: squares[1].col,
                    isCapture: true,
                    capturePos: { row: squares[0].row, col: squares[0].col }
                });
            }
        }
    }

    return moves;
}

// Collect all capture moves available on the board for the current player.
function getAllCaptureMoves(gameState) {
    const captures = [];
    for (let r = 0; r < 8; r++) {
        for (let c = 0; c < 8; c++) {
            const piece = gameState.board[r][c];
            if (piece === PIECE.EMPTY || !isPieceOwned(piece, gameState.turn)) continue;
            for (const m of _getMovesForPiece(gameState, r, c)) {
                if (m.isCapture) captures.push(m);
            }
        }
    }
    return captures;
}

// Public: returns valid moves for a piece, respecting mandatory capture and chain locks.
function getValidMoves(gameState, row, col) {
    if (gameState.chainPiece) {
        const [lr, lc] = gameState.chainPiece;
        if (row !== lr || col !== lc) return [];
        return _getMovesForPiece(gameState, row, col).filter(m => m.isCapture);
    }

    const allCaptures = getAllCaptureMoves(gameState);
    if (allCaptures.length > 0) {
        return _getMovesForPiece(gameState, row, col).filter(m => m.isCapture);
    }

    return _getMovesForPiece(gameState, row, col);
}

export { getValidMoves };
