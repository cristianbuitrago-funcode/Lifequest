/* =========================================================================
   BATALLA DE PEONES -- motor propio (sin reyes)
   -------------------------------------------------------------------------
   chess.js exige un rey por bando, así que antes este modo cargaba un FEN con
   dos reyes. Ahora el modo usa este motor pequeño, que expone la MISMA
   interfaz que usa la app con chess.js (get, turn, moves, move, history,
   in_check...). De esta forma el tablero, la voz y el teclado funcionan
   igual en todos los modos y aquí no existe ninguna lógica de rey ni de jaque.

   Reglas:
   - Peones en la 2.ª fila (blancas) y en la 7.ª fila (negras).
   - Avance de 1 casilla, o de 2 desde la casilla inicial, sin saltar piezas.
   - Captura en diagonal y captura al paso.
   - No hay coronación: llegar a la última fila GANA la partida.
   - También gana quien captura todos los peones rivales.
   - Si el bando que debe mover no tiene jugadas: tablas por bloqueo.
   ========================================================================= */

class PawnBattle {
  constructor(){
    this.reset();
  }

  reset(){
    this.board = {};
    for (const file of PawnBattle.FILES){
      this.board[`${file}2`] = { type:'p', color:'w' };
      this.board[`${file}7`] = { type:'p', color:'b' };
    }
    this._turn = 'w';
    this.epSquare = null;      // casilla donde se puede capturar al paso
    this._history = [];
    this.result = null;        // { winner:'w'|'b'|null, reason }
  }

  get(square){
    const piece = this.board[square];
    return piece ? { type: piece.type, color: piece.color } : null;
  }

  turn(){ return this._turn; }

  history(options){
    return (options && options.verbose)
      ? this._history.map(m => ({ ...m }))
      : this._history.map(m => m.san);
  }

  pawnCount(color){
    return Object.values(this.board).filter(p => p.color === color).length;
  }

  _generate(color){
    const moves = [];
    const dir = color === 'w' ? 1 : -1;
    const startRank = color === 'w' ? 2 : 7;
    const lastRank = color === 'w' ? 8 : 1;

    for (const from of Object.keys(this.board)){
      if (this.board[from].color !== color) continue;
      const fileIdx = PawnBattle.FILES.indexOf(from[0]);
      const rank = Number(from[1]);
      const nextRank = rank + dir;
      if (nextRank < 1 || nextRank > 8) continue;

      const one = `${from[0]}${nextRank}`;
      if (!this.board[one]){
        moves.push(this._make(color, from, one, null, 'n', nextRank === lastRank));
        const two = `${from[0]}${rank + 2 * dir}`;
        if (rank === startRank && !this.board[two]){
          moves.push(this._make(color, from, two, null, 'b', false));
        }
      }

      for (const df of [-1, 1]){
        const nf = fileIdx + df;
        if (nf < 0 || nf > 7) continue;
        const to = `${PawnBattle.FILES[nf]}${nextRank}`;
        const target = this.board[to];
        if (target && target.color !== color){
          moves.push(this._make(color, from, to, 'p', 'c', nextRank === lastRank));
        } else if (!target && to === this.epSquare){
          moves.push(this._make(color, from, to, 'p', 'e', false));
        }
      }
    }
    return moves;
  }

  _make(color, from, to, captured, flags, reachesLastRank){
    const move = { color, from, to, piece:'p', flags, reachesLastRank };
    if (captured) move.captured = captured;
    move.san = captured ? `${from[0]}x${to}` : to;
    return move;
  }

  moves(options = {}){
    if (this.result) return [];
    let list = this._generate(this._turn);
    if (options.square) list = list.filter(m => m.from === options.square);
    return options.verbose ? list : list.map(m => m.san);
  }

  move(input){
    if (this.result || !input) return null;
    const legal = this._generate(this._turn);
    const found = (typeof input === 'string')
      ? legal.find(m => m.san === input)
      : legal.find(m => m.from === input.from && m.to === input.to);
    if (!found) return null;

    delete this.board[found.from];
    if (found.flags === 'e'){
      delete this.board[`${found.to[0]}${found.from[1]}`];
    }
    this.board[found.to] = { type:'p', color: found.color };

    const dir = found.color === 'w' ? 1 : -1;
    this.epSquare = found.flags === 'b' ? `${found.from[0]}${Number(found.from[1]) + dir}` : null;
    this._history.push(found);
    this._turn = found.color === 'w' ? 'b' : 'w';

    const opponent = this._turn;
    if (found.reachesLastRank){
      this.result = { winner: found.color, reason:'lastRank' };
    } else if (this.pawnCount(opponent) === 0){
      this.result = { winner: found.color, reason:'elimination' };
    } else if (this._generate(opponent).length === 0){
      this.result = { winner: null, reason:'blocked' };
    }
    return { ...found };
  }

  // Interfaz compatible con chess.js: en este modo nunca hay jaque.
  in_check(){ return false; }
  in_checkmate(){ return false; }
  in_stalemate(){ return false; }
  in_draw(){ return !!this.result && this.result.winner === null; }
  game_over(){ return !!this.result; }
}

PawnBattle.FILES = 'abcdefgh';
