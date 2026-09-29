/* =========================================================================
   COMPUTADORA (rival automático)
   -------------------------------------------------------------------------
   Búsqueda negamax con poda alfa-beta y profundización iterativa con límite
   de tiempo. Trabaja sobre una COPIA de la posición (nunca toca la partida
   real) y usa la misma interfaz que el resto de la app: moves(), move(),
   undo() y turn(). Por eso sirve tanto para chess.js como para PawnBattle.

   Niveles:
   - Fácil:   mira 1 jugada, con bastante azar y algún movimiento al azar.
   - Medio:   mira 2 jugadas + capturas pendientes, con un poco de azar.
   - Difícil: hasta 4 jugadas + capturas pendientes, sin azar.
   ========================================================================= */

const AI_LEVELS = {
  easy:   { name:'Fácil',   maxDepth:1, noise:90, randomChance:0.25, quiescence:false, timeMs:300 },
  medium: { name:'Medio',   maxDepth:2, noise:25, randomChance:0,    quiescence:true,  timeMs:900 },
  hard:   { name:'Difícil', maxDepth:4, noise:0,  randomChance:0,    quiescence:true,  timeMs:1600 }
};

const AI_MATE = 100000;
const AI_TIMEOUT = Symbol('ai-timeout');
const AI_VALUES = { p:100, n:320, b:330, r:500, q:900, k:0 };

// Tablas de posición (vista de las blancas; fila 0 = octava fila).
const AI_PST = {
  p:[[0,0,0,0,0,0,0,0],[50,50,50,50,50,50,50,50],[10,10,20,30,30,20,10,10],[5,5,10,25,25,10,5,5],
     [0,0,0,20,20,0,0,0],[5,-5,-10,0,0,-10,-5,5],[5,10,10,-20,-20,10,10,5],[0,0,0,0,0,0,0,0]],
  n:[[-50,-40,-30,-30,-30,-30,-40,-50],[-40,-20,0,0,0,0,-20,-40],[-30,0,10,15,15,10,0,-30],[-30,5,15,20,20,15,5,-30],
     [-30,0,15,20,20,15,0,-30],[-30,5,10,15,15,10,5,-30],[-40,-20,0,5,5,0,-20,-40],[-50,-40,-30,-30,-30,-30,-40,-50]],
  b:[[-20,-10,-10,-10,-10,-10,-10,-20],[-10,0,0,0,0,0,0,-10],[-10,0,5,10,10,5,0,-10],[-10,5,5,10,10,5,5,-10],
     [-10,0,10,10,10,10,0,-10],[-10,10,10,10,10,10,10,-10],[-10,5,0,0,0,0,5,-10],[-20,-10,-10,-10,-10,-10,-10,-20]],
  r:[[0,0,0,0,0,0,0,0],[5,10,10,10,10,10,10,5],[-5,0,0,0,0,0,0,-5],[-5,0,0,0,0,0,0,-5],
     [-5,0,0,0,0,0,0,-5],[-5,0,0,0,0,0,0,-5],[-5,0,0,0,0,0,0,-5],[0,0,0,5,5,0,0,0]],
  q:[[-20,-10,-10,-5,-5,-10,-10,-20],[-10,0,0,0,0,0,0,-10],[-10,0,5,5,5,5,0,-10],[-5,0,5,5,5,5,0,-5],
     [0,0,5,5,5,5,0,-5],[-10,5,5,5,5,5,0,-10],[-10,0,5,0,0,0,0,-10],[-20,-10,-10,-5,-5,-10,-10,-20]],
  k:[[-30,-40,-40,-50,-50,-40,-40,-30],[-30,-40,-40,-50,-50,-40,-40,-30],[-30,-40,-40,-50,-50,-40,-40,-30],[-30,-40,-40,-50,-50,-40,-40,-30],
     [-20,-30,-30,-40,-40,-30,-30,-20],[-10,-20,-20,-20,-20,-20,-20,-10],[20,20,0,0,0,0,20,20],[20,30,10,0,0,10,30,20]]
};

/** Valoración desde el punto de vista del bando que mueve. */
function aiEvaluate(pos, isPawns){
  let score = 0;                                   // positivo = mejor para las blancas
  if (isPawns){
    const files = { w: [], b: [] };
    for (const sq in pos.board){
      const p = pos.board[sq];
      files[p.color].push([PawnBattle.FILES.indexOf(sq[0]), Number(sq[1])]);
    }
    for (const color of ['w', 'b']){
      const enemy = files[color === 'w' ? 'b' : 'w'];
      for (const [f, r] of files[color]){
        const progress = color === 'w' ? r - 2 : 7 - r;      // 0..5
        let v = 100 + progress * 12 + (progress >= 4 ? 60 : 0);
        const passed = !enemy.some(([ef, er]) => Math.abs(ef - f) <= 1 && (color === 'w' ? er > r : er < r));
        if (passed) v += 20 + progress * progress * 8;
        score += color === 'w' ? v : -v;
      }
    }
  } else {
    const board = pos.board();
    for (let i = 0; i < 8; i++){
      for (let j = 0; j < 8; j++){
        const p = board[i][j];
        if (!p) continue;
        const v = AI_VALUES[p.type] + AI_PST[p.type][p.color === 'w' ? i : 7 - i][j];
        score += p.color === 'w' ? v : -v;
      }
    }
  }
  return pos.turn() === 'w' ? score : -score;
}

function aiOrder(moves){
  const key = m => (m.captured ? 10 * AI_VALUES[m.captured] - AI_VALUES[m.piece] + 1000 : 0)
                 + (m.promotion ? 800 : 0) + (m.reachesLastRank ? 5000 : 0);
  return moves.sort((a, b) => key(b) - key(a));
}

/** Resultado terminal (desde el bando que mueve) o null si la partida sigue. */
function aiTerminal(pos, moves, isPawns, ply){
  if (isPawns && pos.result){
    if (!pos.result.winner) return 0;
    return pos.result.winner === pos.turn() ? AI_MATE - ply : -(AI_MATE - ply);
  }
  if (moves.length === 0){
    if (isPawns) return 0;
    return pos.in_check() ? -(AI_MATE - ply) : 0;
  }
  return null;
}

function aiQuiescence(pos, alpha, beta, ctx, qdepth){
  if (performance.now() > ctx.deadline) throw AI_TIMEOUT;
  const standPat = aiEvaluate(pos, ctx.isPawns);
  if (standPat >= beta) return beta;
  if (standPat > alpha) alpha = standPat;
  if (qdepth === 0) return alpha;
  const captures = aiOrder(pos.moves({ verbose:true }).filter(m => m.captured || m.promotion || m.reachesLastRank));
  for (const m of captures){
    pos.move(m);
    const score = (ctx.isPawns && pos.result) ? -aiTerminal(pos, [], true, 1)
                                              : -aiQuiescence(pos, -beta, -alpha, ctx, qdepth - 1);
    pos.undo();
    if (score >= beta) return beta;
    if (score > alpha) alpha = score;
  }
  return alpha;
}

function aiNegamax(pos, depth, alpha, beta, ply, ctx){
  if (performance.now() > ctx.deadline) throw AI_TIMEOUT;
  const moves = pos.moves({ verbose:true });
  const terminal = aiTerminal(pos, moves, ctx.isPawns, ply);
  if (terminal !== null) return terminal;
  if (depth === 0){
    return ctx.level.quiescence ? aiQuiescence(pos, alpha, beta, ctx, 4) : aiEvaluate(pos, ctx.isPawns);
  }
  for (const m of aiOrder(moves)){
    pos.move(m);
    const score = -aiNegamax(pos, depth - 1, -beta, -alpha, ply + 1, ctx);
    pos.undo();
    if (score >= beta) return beta;
    if (score > alpha) alpha = score;
  }
  return alpha;
}

/**
 * Elige una jugada para el bando que mueve en `pos` (una copia).
 * @returns {{from, to, promotion?}|null}
 */
function chooseComputerMove(pos, isPawns, levelKey){
  const level = AI_LEVELS[levelKey] || AI_LEVELS.medium;
  const rootMoves = aiOrder(pos.moves({ verbose:true }));
  if (!rootMoves.length) return null;
  const pick = m => (m.promotion ? { from: m.from, to: m.to, promotion: m.promotion } : { from: m.from, to: m.to });

  if (rootMoves.length === 1) return pick(rootMoves[0]);
  if (Math.random() < level.randomChance) return pick(rootMoves[Math.floor(Math.random() * rootMoves.length)]);

  const ctx = { isPawns, level, deadline: performance.now() + level.timeMs, baseHistory: pos.history().length };
  let ordered = rootMoves;
  let best = null;

  for (let depth = 1; depth <= level.maxDepth; depth++){
    try{
      const scored = [];
      let alpha = -Infinity;
      for (const m of ordered){
        pos.move(m);
        // Con azar, las jugadas a menos de `noise` de la mejor necesitan su valor exacto.
        const score = -aiNegamax(pos, depth - 1, -Infinity, -(alpha - level.noise), 1, ctx);
        pos.undo();
        scored.push({ m, score });
        if (score > alpha) alpha = score;
      }
      scored.sort((a, b) => b.score - a.score);
      ordered = scored.map(s => s.m);
      best = scored;
      if (scored[0].score >= AI_MATE - 50) break;        // ya encontró un mate
    } catch(e){
      if (e !== AI_TIMEOUT) throw e;
      // Se acabó el tiempo: se deshace lo que quedara a medias y se usa la última profundidad completa.
      while (pos.history().length > ctx.baseHistory) pos.undo();
      break;
    }
  }
  if (!best) return pick(rootMoves[0]);

  let choice = best[0];
  if (level.noise){
    let top = -Infinity;
    for (const s of best){
      if (s.score < best[0].score - level.noise) continue;
      const noisy = s.score + Math.random() * level.noise;
      if (noisy > top){ top = noisy; choice = s; }
    }
  }
  return pick(choice.m);
}
