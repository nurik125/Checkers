const PIECE = {
    EMPTY: 0,
    WHITE: 1,
    BLACK: 2,
    WHITE_KING: 3,
    BLACK_KING: 4
};

function isKing(piece) {
    return piece === PIECE.WHITE_KING || piece === PIECE.BLACK_KING;
}

function isWhite(piece) {
    return piece === PIECE.WHITE || piece === PIECE.WHITE_KING;
}

function isOnBoard(onRow, onCol) {
    return 0 <= onRow && onRow < 8 && 0 <= onCol && onCol < 8
}

function isPieceOwned(piece, player) {
    if (piece === PIECE.EMPTY) return false;
    const isWhitePiece = isWhite(piece);
    return player === 'white' ? isWhitePiece : !isWhitePiece;
}

function isForward(piece, toRow) {
    const isWhitePiece = isWhite(piece);
    return isWhitePiece ? toRow > 0 : toRow < 0;
}
