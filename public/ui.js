function highlightSquare(fromRow, fromCol, className) {
    const square = document.querySelector(`[data-row="${fromRow}"][data-col="${fromCol}"]`);
    square.classList.add(className);
}

function renderBoard(gameState) {
    const boardDiv = document.getElementById("board");
    boardDiv.innerHTML = '';

    for (let row = 0; row < 8; row++) {
        for (let col = 0; col < 8; col++) {
            const square = document.createElement('li');
            const isBlack = (row + col) % 2 === 1;
            square.className = `square ${isBlack ? 'even' : 'odd'}`;

            square.dataset.row = row;
            square.dataset.col = col;

            const piece = gameState.board[row][col];
            if (piece !== 0) {
                const div = document.createElement('div');
                div.className = 'piece';

                if (piece === PIECE.WHITE) div.classList.add('white');
                if (piece === PIECE.BLACK) div.classList.add('black');
                if (piece === PIECE.WHITE_KING) div.classList.add('white-king');
                if (piece === PIECE.BLACK_KING) div.classList.add('black-king');

                square.appendChild(div);
            }
            boardDiv.appendChild(square);
        }
    }
}
