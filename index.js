let gameState = {
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
    turn: 'white',
    chainPiece: null,
    history: []
};

let selectedPiece = null;

function clearHighlights() {
    document.querySelectorAll('.square').forEach(sq => {
        sq.classList.remove('valid', 'danger', 'selected');
    });
}

function handleChainState() {
    if (!gameState.chainPiece) return;
    const [r, c] = gameState.chainPiece;
    selectedPiece = [r, c];
    clearHighlights();
    const square = document.querySelector(`[data-row="${r}"][data-col="${c}"]`);
    if (square) square.classList.add('selected');
    const moves = getValidMoves(gameState, r, c);
    moves.forEach(m => highlightSquare(m.row, m.col, 'danger'));
}

document.addEventListener('click', (e) => {
    const squareEl = e.target.closest('.square');
    const pieceEl = e.target.closest('.piece');

    // Clicking a highlighted destination square — attempt the move
    if (squareEl && selectedPiece && (squareEl.classList.contains('valid') || squareEl.classList.contains('danger'))) {
        const toRow = parseInt(squareEl.dataset.row);
        const toCol = parseInt(squareEl.dataset.col);
        const validation = isValidMove(gameState, selectedPiece[0], selectedPiece[1], toRow, toCol);
        if (validation.valid) {
            // Pass capturePos explicitly — makeMove never guesses which piece to remove
            gameState = makeMove(gameState, selectedPiece[0], selectedPiece[1], toRow, toCol, validation.capturePos);
            selectedPiece = null;
            clearHighlights();
            renderBoard(gameState);
            handleChainState();
        }
        return;
    }

    // Clicking a piece — select it (blocked during a chain)
    if (pieceEl) {
        if (gameState.chainPiece) return;
        const square = pieceEl.parentElement;
        const fromRow = parseInt(square.dataset.row);
        const fromCol = parseInt(square.dataset.col);
        clearHighlights();
        selectedPiece = [fromRow, fromCol];
        square.classList.add('selected');
        const moves = getValidMoves(gameState, fromRow, fromCol);
        moves.forEach(m => highlightSquare(m.row, m.col, m.isCapture ? 'danger' : 'valid'));
        return;
    }

    // Clicking empty space — deselect
    if (!gameState.chainPiece) {
        clearHighlights();
        selectedPiece = null;
    }

    const winner = checkWinner(gameState);
    if (winner) {
        alert(`${winner.toUpperCase()} WINS!`);
        // Optionally: disable further moves, show a message, etc.
    }
});

renderBoard(gameState);
