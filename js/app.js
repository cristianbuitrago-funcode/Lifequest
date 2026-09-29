/* =========================================================================
   AJEDREZ ACCESIBLE
   -------------------------------------------------------------------------
   Motor de reglas: chess.js 0.10.3, incluido en js/vendor/ (funciona sin conexión)
                    y PawnBattle (js/pawn-battle.js) para la batalla de peones.
   Entrada de voz:  Web Speech API -> SpeechRecognition (STT), opcional.
   Salida:          speak() en js/feedback.js (texto + voz + sonido + avisos).

   `engine` apunta al motor activo. Toda la interfaz (tablero, voz, teclado)
   habla con `engine`, así que funciona igual en todos los modos:
   - "classic": chess.js con la posición inicial estándar.
   - "pawns":   PawnBattle (solo peones, sin reyes ni jaques).
   - "custom":  el usuario coloca las piezas (editor) y se juega con chess.js.

   Flujo de una jugada (clic, teclado, voz o texto):
   requestMove() -> [promoción] -> [confirmación] -> executeMove()
   executeMove() mueve, anuncia, cambia el reloj y comprueba el final.
   ========================================================================= */

if (typeof Chess === 'undefined'){
  document.getElementById('status').textContent =
    'No se pudo cargar el motor de ajedrez (js/vendor/chess.js). Comprueba que la carpeta js/vendor está junto a index.html y recarga la página.';
  throw new Error('chess.js no se ha cargado');
}

const game = new Chess();
const pawnGame = new PawnBattle();
let engine = game;

const FILES = 'abcdefgh';
const pieceNames  = { p:'Peón', n:'Caballo', b:'Alfil', r:'Torre', q:'Dama', k:'Rey' };
const piecePlurals = { p:'Peones', n:'Caballos', b:'Alfiles', r:'Torres', q:'Damas', k:'Reyes' };
const pieceFemale = { r:true, q:true };
// Glifos rellenos + selector de variación U+FE0E para que ♟ no se dibuje como emoji en móviles.
const pieceGlyphs = { p:'♟︎', n:'♞︎', b:'♝︎', r:'♜︎', q:'♛︎', k:'♚︎' };

const pieceWords = {
  peon:'p', peones:'p',
  caballo:'n', caballos:'n', corcel:'n',
  alfil:'b', alfiles:'b',
  torre:'r', torres:'r',
  dama:'q', damas:'q', reina:'q', reinas:'q',
  rey:'k'
};

const TIME_STORAGE_KEY = 'ajedrez-accesible:tiempo:v1';
const AI_STORAGE_KEY   = 'ajedrez-accesible:rival:v1';

// ---- Estado general de interacción ----
let selectedSquare = null;
let focusedSquare  = 'e4';
let lastMove       = null;
let lastMoveText   = '';
let shouldListen   = false;

// ---- Estado de modos de juego ----
let mode = 'classic';          // 'classic' | 'pawns' | 'custom'
let editingCustom  = false;    // true mientras se colocan piezas en el editor
let editorBoard    = {};       // square -> {type, color} mientras se edita
let editorColor    = 'w';
let editorTool     = 'p';      // 'p'|'n'|'b'|'r'|'q'|'k'|'erase'
let customStartFEN = null;     // último FEN personalizado usado para "reiniciar"

// ---- Estado de la partida ----
let gameResult  = null;        // { winner:'w'|'b'|null, reason, loser? } cuando termina
let pendingMove = null;        // jugada esperando confirmación
let paused      = false;
let timeControl = loadTimeControl();   // ms por jugador, 0 = sin reloj

// ---- Rival: computadora ----
let aiSettings = loadAiSettings();     // { enabled, humanColor:'w'|'b', level:'easy'|'medium'|'hard' }
let aiThinking = false;
let aiTimer    = null;
let aiToken    = 0;                    // invalida cálculos pendientes al reiniciar, pausar, etc.
let hintMove   = null;                 // { from, to } sugerido por el botón «Pista»

const boardEl         = document.getElementById('board');
const logEl           = document.getElementById('move-log');
const micBtn          = document.getElementById('mic-btn');
const micLabel        = document.getElementById('mic-label');
const textForm        = document.getElementById('text-form');
const textInput       = document.getElementById('text-input');
const modeButtons     = document.querySelectorAll('.mode-btn');
const editorPanel     = document.getElementById('editor-panel');
const editBtn         = document.getElementById('edit-position-btn');
const colorButtons    = document.querySelectorAll('.seg-btn[data-color]');
const paletteButtons  = document.querySelectorAll('.pal-btn');
const startTurnSelect = document.getElementById('start-turn-select');
const editorClearBtn  = document.getElementById('editor-clear-btn');
const editorStartBtn  = document.getElementById('editor-start-btn');
const turnIndicator   = document.getElementById('turn-indicator');
const confirmBar      = document.getElementById('confirm-bar');
const confirmText     = document.getElementById('confirm-text');
const confirmYes      = document.getElementById('confirm-yes');
const confirmNo       = document.getElementById('confirm-no');
const guideEl         = document.getElementById('guide');
const pauseBtn        = document.getElementById('pause-btn');
const pauseOverlay    = document.getElementById('pause-overlay');
const promoDialog     = document.getElementById('promo-dialog');
const resultDialog    = document.getElementById('result-dialog');

const other = c => (c === 'w' ? 'b' : 'w');
const sideName = c => (c === 'w' ? 'blancas' : 'negras');
const SideName = c => (c === 'w' ? 'Blancas' : 'Negras');
const sideDot  = c => (c === 'w' ? '⚪' : '⚫');

function colorAdj(type, color){
  const f = !!pieceFemale[type];
  return color === 'w' ? (f ? 'blanca' : 'blanco') : (f ? 'negra' : 'negro');
}
function pieceLabel(piece){
  return `${pieceNames[piece.type]} ${colorAdj(piece.type, piece.color)}`;
}
function selectedWord(type){ return pieceFemale[type] ? 'seleccionada' : 'seleccionado'; }

// =====================================================================
// DESCRIPCIONES Y ANUNCIOS
// =====================================================================
function describeMove(m){
  const piece = { type: m.piece, color: m.color };
  if (m.flags.includes('k') || m.flags.includes('q')){
    const long = m.flags.includes('q');
    return txt(`Enroque ${long ? 'largo' : 'corto'} de las ${sideName(m.color)}.`,
               `🏰 Enroque ${long ? 'largo' : 'corto'}.`);
  }
  let normal, easy;
  if (m.flags.includes('e')){
    normal = `${pieceLabel(piece)} de ${m.from} captura al paso en ${m.to}`;
    easy = `✖ ${pieceLabel(piece)} captura en ${m.to}`;
  } else if (m.captured){
    normal = `${pieceLabel(piece)} de ${m.from} captura ${pieceNames[m.captured].toLowerCase()} en ${m.to}`;
    easy = `✖ ${pieceLabel(piece)} captura en ${m.to}`;
  } else {
    normal = `${pieceLabel(piece)} de ${m.from} a ${m.to}`;
    easy = `${pieceGlyphs[m.piece]} ${pieceLabel(piece)}: ${m.from} → ${m.to}`;
  }
  if (m.promotion){
    normal += ` y corona en ${pieceNames[m.promotion].toLowerCase()}`;
    easy += ` y es ${pieceNames[m.promotion].toLowerCase()}`;
  }
  return txt(`${normal}.`, `${easy}.`);
}

function turnText(){
  if (isAiGame()){
    return engine.turn() === aiSettings.humanColor
      ? txt(`Es tu turno (${sideName(engine.turn())}).`, 'Te toca a ti.')
      : txt('Turno de la computadora.', '🤖 Juega la computadora.');
  }
  return txt(`Turno de las ${sideName(engine.turn())}.`, `Ahora juegan: ${SideName(engine.turn())}.`);
}

function outcomeText(o){
  const w = o.winner, l = o.loser;
  switch(o.reason){
    case 'checkmate':   return txt(`Jaque mate. Ganan las ${sideName(w)}.`, `🏁 ¡Jaque mate! Ganan las ${sideName(w)}.`);
    case 'stalemate':   return txt('Rey ahogado: el bando que mueve no tiene jugadas y no está en jaque. Tablas.', '🤝 Rey ahogado. Empate.');
    case 'insufficient':return txt('Tablas: no queda material suficiente para dar jaque mate.', '🤝 Empate. Faltan piezas para ganar.');
    case 'repetition':  return txt('Tablas por triple repetición de la posición.', '🤝 Empate. Se repitió la posición.');
    case 'fifty':       return txt('Tablas por la regla de los 50 movimientos.', '🤝 Empate por 50 movimientos.');
    case 'lastRank':    return txt(`Un peón de las ${sideName(w)} llegó a la última fila. Ganan las ${sideName(w)}.`, `🏁 ¡Peón en la meta! Ganan las ${sideName(w)}.`);
    case 'elimination': return txt(`Las ${sideName(other(w))} se quedaron sin peones. Ganan las ${sideName(w)}.`, `🏁 No quedan peones ${other(w) === 'w' ? 'blancos' : 'negros'}. Ganan las ${sideName(w)}.`);
    case 'blocked':     return txt(`Las ${sideName(engine.turn())} no tienen movimientos posibles. La partida termina en tablas por bloqueo.`, '🤝 Nadie puede mover. Empate.');
    case 'timeout':     return txt(`Se acabó el tiempo de las ${sideName(l)}. Ganan las ${sideName(w)}.`, `⏰ Sin tiempo: ${SideName(l)}. Ganan las ${sideName(w)}.`);
    case 'timeout-draw':return txt(`Se acabó el tiempo de las ${sideName(l)}, pero las ${sideName(other(l))} no tienen material para dar mate. Tablas.`, `⏰ Sin tiempo, pero no se puede dar mate. Empate.`);
    default:            return 'La partida ha terminado.';
  }
}

function addToLog(san, spokenText){
  const li = document.createElement('li');
  const n = engine.history().length;
  li.textContent = san ? `${Math.ceil(n / 2)}.${n % 2 === 0 ? '..' : ''} ${san} -- ${spokenText}` : spokenText;
  logEl.insertBefore(li, logEl.firstChild);
}

function announceTurn(){
  let text = turnText();
  if (gameResult) text = outcomeText(gameResult);
  else if (clock.enabled) text += ` Te quedan ${ClockTimeWords(engine.turn())}.`;
  speak(text);
}

function ClockTimeWords(color){ return ChessClock.toWords(clock.remaining[color]); }

function announceClocks(){
  if (!clock.enabled){ speak('Esta partida no tiene reloj.'); return; }
  speak(`Blancas: ${ClockTimeWords('w')}. Negras: ${ClockTimeWords('b')}.`);
}

function announceLastMove(){
  if (!lastMove){
    speak(txt('Aún no se ha realizado ningún movimiento.', 'Todavía no hay jugadas.'));
    return;
  }
  speak(`${txt('Última jugada:', 'Última:')} ${lastMoveText}`);
}

function speakHelp(){
  showTab('help');
  speak(txt(
    'Toca una pieza y después la casilla a la que quieres moverla, o usa las flechas y Enter. ' +
    'Si quieres usar la voz, activa el micrófono y di movimientos como e 2 e 4, peón a e 4, o caballo de g 1 a f 3. ' +
    'También puedes decir enroque corto, enroque largo, turno, tiempo, repite, confirmar, cancelar, ' +
    'o cambiar de modo diciendo modo clásico, batalla de peones o modo personalizado.',
    'Paso 1: toca una pieza. Paso 2: toca una casilla con punto. Eso es todo.'));
}

// =====================================================================
// RELOJ
// =====================================================================
const clockEls = {
  w: document.getElementById('clock-w'),
  b: document.getElementById('clock-b')
};

const clock = new ChessClock({
  onTick: renderClocks,
  onFlag: onTimeout,
  onLow: (color) => speak(txt(`Atención: a las ${sideName(color)} les quedan menos de ${ChessClock.toWords(clock.lowThreshold())}.`,
                              `⏰ ¡Poco tiempo para ${sideName(color)}!`), true, { type:'time' })
});

function renderClocks(){
  const enabled = clock.enabled;
  for (const c of ['w', 'b']){
    const el = clockEls[c];
    el.hidden = !enabled;
    if (!enabled) continue;
    el.querySelector('.clock-time').textContent = ChessClock.format(clock.remaining[c]);
    el.classList.toggle('running', clock.running === c);
    el.classList.toggle('low', clock.isLow(c));
    el.classList.toggle('flagged', clock.remaining[c] <= 0);
    el.setAttribute('aria-label', `Reloj de las ${sideName(c)}: ${ChessClock.toWords(clock.remaining[c])}${clock.running === c ? ', en marcha' : ''}`);
  }
  pauseBtn.hidden = !enabled || !!gameResult || editingCustom || (!clock.running && !paused);
  pauseBtn.textContent = paused ? '▶ Reanudar' : '⏸ Pausa';
  pauseBtn.setAttribute('aria-pressed', paused ? 'true' : 'false');
}

function onTimeout(color){
  if (gameResult) return;
  const winner = other(color);
  const draw = mode !== 'pawns' && !hasMatingMaterial(winner);
  finishGame({ winner: draw ? null : winner, loser: color, reason: draw ? 'timeout-draw' : 'timeout' });
}

/** ¿Puede `color` dar mate con alguna secuencia legal? (aproximación a la regla FIDE). */
function hasMatingMaterial(color){
  const pieces = game.board().flat().filter(Boolean);
  const own = pieces.filter(p => p.color === color && p.type !== 'k');
  if (own.length === 0) return false;
  if (own.length === 1 && (own[0].type === 'n' || own[0].type === 'b')){
    return pieces.some(p => p.color !== color && p.type !== 'k');
  }
  return true;
}

function togglePause(){
  if (!clock.enabled || gameResult || editingCustom) return;
  if (paused){
    paused = false;
    if (engine.history().length > 0) clock.start(engine.turn());
    speak(txt('Partida reanudada. ', '▶ Seguimos. ') + turnText());
    scheduleAiMove();
  } else {
    if (!clock.running) return;
    paused = true;
    cancelAi();
    clock.stop();
    cancelSelection(false);
    speak(txt('Partida en pausa. Los relojes están detenidos.', '⏸ Pausa.'));
  }
  render();
}

function loadTimeControl(){
  try{
    const v = Number(localStorage.getItem(TIME_STORAGE_KEY));
    return Number.isFinite(v) && v >= 0 ? v : 0;
  } catch(e){ return 0; }
}

function saveTimeControl(){
  try{ localStorage.setItem(TIME_STORAGE_KEY, String(timeControl)); } catch(e){}
}

// =====================================================================
// MODOS DE JUEGO
// =====================================================================
function setModeButtonsUI(){
  modeButtons.forEach(btn => btn.setAttribute('aria-pressed', btn.dataset.mode === mode ? 'true' : 'false'));
}

function resetCommonState(){
  cancelAi();
  hintMove = null;
  lastMove = null;
  lastMoveText = '';
  selectedSquare = null;
  pendingMove = null;
  gameResult = null;
  paused = false;
  focusedSquare = 'e4';
  logEl.innerHTML = '';
  confirmBar.hidden = true;
  if (promoDialog.open) promoDialog.close();
  if (resultDialog.open) resultDialog.close();
  clock.configure(timeControl);
}

function setMode(newMode){
  mode = newMode;
  setModeButtonsUI();

  if (newMode === 'classic'){
    editingCustom = false;
    editorPanel.hidden = true;
    editBtn.hidden = true;
    engine = game;
    game.reset();
    resetCommonState();
    render();
    speak(txt('Modo clásico activado. ', '♟️ Ajedrez clásico. ') + turnText() + clockHint());
    scheduleAiMove();

  } else if (newMode === 'pawns'){
    editingCustom = false;
    editorPanel.hidden = true;
    editBtn.hidden = true;
    engine = pawnGame;
    pawnGame.reset();
    resetCommonState();
    render();
    speak(txt('Batalla de peones: solo hay peones, sin reyes. Gana quien lleve un peón a la última fila o capture todos los peones rivales. ',
              '⚔️ Solo peones. Llega al final para ganar. ') + turnText() + clockHint());
    scheduleAiMove();

  } else if (newMode === 'custom'){
    editingCustom = true;
    engine = game;
    editorBoard = {};
    editorPanel.hidden = false;
    editBtn.hidden = true;
    resetCommonState();
    render();
    speak(txt('Modo personalizado activado. Elige una pieza y un color, y toca las casillas del tablero para colocarlas. Debes incluir un rey de cada color antes de iniciar la partida.',
              '🎨 Elige pieza y color. Toca casillas para ponerlas. Pon un rey de cada color.'));
  }
}

function clockHint(){
  return clock.enabled ? txt(` Reloj: ${ChessClock.toWords(clock.initial)} por jugador. Empieza a correr tras la primera jugada.`, ' ⏱ El reloj empieza tras la primera jugada.') : '';
}

function resetGame(){
  if (mode === 'classic' || mode === 'pawns'){
    setMode(mode);
    return;
  }
  // modo personalizado
  if (editingCustom){
    editorBoard = {};
    render();
    speak('Tablero de edición vaciado.');
  } else if (customStartFEN){
    game.load(customStartFEN);
    resetCommonState();
    render();
    speak(txt('Partida personalizada reiniciada. ', 'Partida otra vez. ') + turnText());
    scheduleAiMove();
  }
}

// ---- Editor de posición personalizada ----
function castlingRights(){
  const has = (sq, type, color) => editorBoard[sq] && editorBoard[sq].type === type && editorBoard[sq].color === color;
  let rights = '';
  if (has('e1', 'k', 'w')){
    if (has('h1', 'r', 'w')) rights += 'K';
    if (has('a1', 'r', 'w')) rights += 'Q';
  }
  if (has('e8', 'k', 'b')){
    if (has('h8', 'r', 'b')) rights += 'k';
    if (has('a8', 'r', 'b')) rights += 'q';
  }
  return rights || '-';
}

function buildFENFromEditor(turn){
  const rows = [];
  for (let rank = 8; rank >= 1; rank--){
    let row = '';
    let empty = 0;
    for (let f = 0; f < 8; f++){
      const square = FILES[f] + rank;
      const piece = editorBoard[square];
      if (!piece){
        empty++;
      } else {
        if (empty > 0){ row += empty; empty = 0; }
        row += piece.color === 'w' ? piece.type.toUpperCase() : piece.type;
      }
    }
    if (empty > 0) row += empty;
    rows.push(row);
  }
  return `${rows.join('/')} ${turn} ${castlingRights()} - 0 1`;
}

function startCustomGame(){
  const entries = Object.entries(editorBoard);
  const whiteKings = entries.filter(([, p]) => p.type === 'k' && p.color === 'w').length;
  const blackKings = entries.filter(([, p]) => p.type === 'k' && p.color === 'b').length;
  if (whiteKings !== 1 || blackKings !== 1){
    speak('Debes colocar exactamente un rey blanco y un rey negro antes de iniciar la partida.', true, { type:'error' });
    return;
  }
  if (entries.some(([sq, p]) => p.type === 'p' && (sq[1] === '1' || sq[1] === '8'))){
    speak('Los peones no pueden estar en la primera ni en la última fila.', true, { type:'error' });
    return;
  }
  const turn = startTurnSelect.value;
  // El bando que NO mueve no puede estar en jaque: sería una posición imposible.
  if (game.load(buildFENFromEditor(other(turn))) && game.in_check()){
    speak(`Posición imposible: el rey de las ${sideName(other(turn))} está en jaque y no le toca mover.`, true, { type:'error' });
    return;
  }
  const fen = buildFENFromEditor(turn);
  if (!game.load(fen)){
    speak('Esa posición no es válida. Revisa la colocación de las piezas.', true, { type:'error' });
    return;
  }
  customStartFEN = fen;
  editingCustom = false;
  editorPanel.hidden = true;
  editBtn.hidden = false;
  resetCommonState();
  render();
  const outcome = evaluateOutcome();
  if (outcome){ finishGame(outcome); return; }
  speak(txt('Partida personalizada iniciada. ', '▶ ¡A jugar! ') + (game.in_check() ? 'Jaque. ' : '') + turnText() + clockHint());
  scheduleAiMove();
}

function populateEditorFromGame(){
  editorBoard = {};
  for (let rank = 8; rank >= 1; rank--){
    for (let f = 0; f < 8; f++){
      const square = FILES[f] + rank;
      const piece = game.get(square);
      if (piece) editorBoard[square] = { type: piece.type, color: piece.color };
    }
  }
}

function onEditorCellActivate(square){
  if (editorTool === 'erase'){
    delete editorBoard[square];
    speak(`Casilla ${square} vaciada.`);
  } else {
    editorBoard[square] = { type: editorTool, color: editorColor };
    speak(`${pieceLabel({ type: editorTool, color: editorColor })} ${pieceFemale[editorTool] ? 'colocada' : 'colocado'} en ${square}.`);
  }
  render();
}

function processEditorVoiceCommand(norm){
  const squareMatch = (normalizeSquares(norm).match(/\b[a-h][1-8]\b/) || [])[0];

  if (/vaciar tablero|borrar todo el tablero/.test(norm)){
    editorBoard = {};
    speak('Tablero de edición vaciado.');
    render();
    return true;
  }
  if (/iniciar partida|comenzar partida|empezar partida/.test(norm)){
    startCustomGame();
    return true;
  }
  if (squareMatch && /borrar|quitar|elimina/.test(norm)){
    delete editorBoard[squareMatch];
    speak(`Casilla ${squareMatch} vaciada.`);
    render();
    return true;
  }
  if (squareMatch){
    const pieceType = findPieceWord(norm);
    const color = /negr/.test(norm) ? 'b' : (/blanc/.test(norm) ? 'w' : null);
    if (pieceType && color){
      editorBoard[squareMatch] = { type: pieceType, color };
      speak(`${pieceLabel({ type: pieceType, color })} ${pieceFemale[pieceType] ? 'colocada' : 'colocado'} en ${squareMatch}.`);
      render();
      return true;
    }
  }
  return false;
}

colorButtons.forEach(btn => btn.addEventListener('click', () => {
  editorColor = btn.dataset.color;
  colorButtons.forEach(b => b.setAttribute('aria-pressed', b === btn ? 'true' : 'false'));
}));

paletteButtons.forEach(btn => btn.addEventListener('click', () => {
  editorTool = btn.dataset.piece;
  paletteButtons.forEach(b => b.setAttribute('aria-pressed', b === btn ? 'true' : 'false'));
}));

editorClearBtn.addEventListener('click', () => {
  editorBoard = {};
  render();
  speak('Tablero de edición vaciado.');
});

editorStartBtn.addEventListener('click', startCustomGame);

editBtn.addEventListener('click', () => {
  populateEditorFromGame();
  cancelAi();
  hintMove = null;
  editingCustom = true;
  clock.stop();
  paused = false;
  selectedSquare = null;
  pendingMove = null;
  confirmBar.hidden = true;
  editorPanel.hidden = false;
  editBtn.hidden = true;
  render();
  speak('Editando la posición actual. Toca las casillas para modificar las piezas.');
});

modeButtons.forEach(btn => btn.addEventListener('click', () => setMode(btn.dataset.mode)));

// =====================================================================
// JUGADAS: selección, promoción, confirmación y ejecución
// =====================================================================
function blockedReason(byComputer = false){
  if (editingCustom) return 'Estás editando la posición. Pulsa «Iniciar partida» para jugar.';
  if (gameResult) return txt('La partida ha terminado. Pulsa «Reiniciar partida» para jugar otra.', '🏁 Terminó. Pulsa «Reiniciar».');
  if (paused) return txt('La partida está en pausa. Pulsa «Reanudar» para seguir.', '⏸ Pausa. Pulsa «Reanudar».');
  if (!byComputer && isAiTurn()) return txt('Espera: ahora juega la computadora.', '🤖 Espera. Juega la computadora.');
  return null;
}

function legalMovesFrom(square){
  return engine.moves({ square, verbose: true });
}

function findLegalMove(from, to, promotion){
  const list = legalMovesFrom(from).filter(m => m.to === to);
  if (!list.length) return null;
  return list.find(m => m.promotion === (promotion || 'q')) || list[0];
}

/**
 * Punto de entrada único para intentar una jugada.
 * source: 'board' (clic/teclado) | 'voice' (voz o texto)
 */
function requestMove(from, to, promotion = null, source = 'board'){
  const reason = blockedReason();
  if (reason){ speak(reason, true, { type:'error' }); return false; }

  const mv = findLegalMove(from, to, promotion);
  if (!mv){
    speak(txt('Movimiento inválido, intenta de nuevo.', '⛔ No se puede. Prueba otra vez.'), true, { type:'error' });
    return false;
  }
  if (mv.flags.includes('p') && !promotion && source === 'board'){
    openPromotionDialog(from, to, mv.color);
    return true;
  }
  const intended = { from, to };
  if (mv.flags.includes('p')) intended.promotion = promotion || 'q';

  if (A11y.get('moveConfirmation')){
    pendingMove = intended;
    selectedSquare = from;
    const preview = { ...mv, promotion: intended.promotion };
    confirmText.textContent = txt(`¿Confirmas: ${describeMove(preview)}`, `¿Mover? ${describeMove(preview)}`);
    confirmBar.hidden = false;
    render();
    speak(`${confirmText.textContent} ${txt('Pulsa Confirmar o Cancelar.', 'Sí o No.')}`);
    confirmYes.focus();
    return true;
  }
  return executeMove(intended);
}

function executeMove(m, byComputer = false){
  const reason = blockedReason(byComputer);
  if (reason){ speak(reason, true, { type:'error' }); return false; }
  if (clock.enabled && clock.sync()) return false;     // el tiempo se agotó antes de mover

  const result = engine.move(m.promotion ? { from: m.from, to: m.to, promotion: m.promotion } : { from: m.from, to: m.to });
  selectedSquare = null;
  pendingMove = null;
  confirmBar.hidden = true;
  if (!result){
    speak(txt('Movimiento inválido, intenta de nuevo.', '⛔ No se puede. Prueba otra vez.'), true, { type:'error' });
    render();
    return false;
  }

  lastMove = result;
  hintMove = null;
  const moveText = (byComputer ? txt('La computadora juega: ', '🤖 ') : '') + describeMove(result);
  const outcome = evaluateOutcome();
  lastMoveText = moveText;
  addToLog(result.san, moveText);

  if (outcome){
    render();
    finishGame(outcome, moveText);
    return true;
  }

  const check = engine.in_check();
  if (clock.enabled) clock.start(engine.turn());
  render();
  const text = `${moveText} ${check ? txt('Jaque. ', '⚠ ¡Jaque! ') : ''}${turnText()}`;
  // La jugada de la computadora se pone en cola para no cortar el anuncio de la jugada anterior.
  speak(text, check, { type: check ? 'check' : (result.captured ? 'capture' : 'move'), queue: byComputer });
  scheduleAiMove();
  return true;
}

// =====================================================================
// COMPUTADORA
// =====================================================================
function isAiGame(){ return aiSettings.enabled && !editingCustom; }
function aiColor(){ return other(aiSettings.humanColor); }
function isAiTurn(){ return isAiGame() && !gameResult && engine.turn() === aiColor(); }

/** Copia de la posición actual para que la computadora calcule sin tocar la partida. */
function positionCopy(){
  return mode === 'pawns' ? pawnGame.clone() : new Chess(game.fen());
}

function cancelAi(){
  clearTimeout(aiTimer);
  aiTimer = null;
  aiToken++;
  aiThinking = false;
}

function scheduleAiMove(){
  if (!isAiTurn() || paused) return;
  cancelAi();
  aiThinking = true;
  const token = aiToken;
  render();
  // Una breve espera deja ver y oír la jugada anterior antes de responder.
  aiTimer = setTimeout(() => {
    if (token !== aiToken) return;
    const choice = chooseComputerMove(positionCopy(), mode === 'pawns', aiSettings.level);
    aiThinking = false;
    if (token !== aiToken || paused || !isAiTurn() || !choice){ render(); return; }
    executeMove(choice, true);
  }, 500);
}

function showHint(){
  const reason = blockedReason();
  if (reason){ speak(reason, true, { type:'error' }); return; }
  speak(txt('Buscando una buena jugada…', '💡 Pensando…'), false, { banner:false });
  setTimeout(() => {
    if (blockedReason()) return;
    const choice = chooseComputerMove(positionCopy(), mode === 'pawns', 'hard');
    if (!choice) return;
    const mv = findLegalMove(choice.from, choice.to, choice.promotion);
    hintMove = { from: choice.from, to: choice.to };
    selectedSquare = null;
    render();
    speak(`${txt('Pista:', '💡 Pista:')} ${describeMove({ ...mv, promotion: choice.promotion })}`, false, { type:'move' });
  }, 30);
}

function loadAiSettings(){
  const defaults = { enabled:false, humanColor:'w', level:'medium' };
  try{
    const saved = JSON.parse(localStorage.getItem(AI_STORAGE_KEY) || '{}');
    return {
      enabled: saved.enabled === true,
      humanColor: saved.humanColor === 'b' ? 'b' : 'w',
      level: saved.level in AI_LEVELS ? saved.level : 'medium'
    };
  } catch(e){ return defaults; }
}

function saveAiSettings(){
  try{ localStorage.setItem(AI_STORAGE_KEY, JSON.stringify(aiSettings)); } catch(e){}
}

const rivalButtons   = document.querySelectorAll('[data-rival]');
const aiHumanButtons = document.querySelectorAll('[data-ai-human]');
const aiLevelButtons = document.querySelectorAll('[data-ai-level]');

function syncRivalUI(){
  rivalButtons.forEach(b => b.setAttribute('aria-pressed', String((b.dataset.rival === 'ai') === aiSettings.enabled)));
  aiHumanButtons.forEach(b => b.setAttribute('aria-pressed', String(b.dataset.aiHuman === aiSettings.humanColor)));
  aiLevelButtons.forEach(b => b.setAttribute('aria-pressed', String(b.dataset.aiLevel === aiSettings.level)));
  document.getElementById('ai-options').hidden = !aiSettings.enabled;
}

/** Los cambios de rival se aplican al momento, también a mitad de partida. */
function updateAiSettings(changes, message){
  Object.assign(aiSettings, changes);
  saveAiSettings();
  syncRivalUI();
  cancelAi();
  hintMove = null;
  selectedSquare = null;
  pendingMove = null;
  confirmBar.hidden = true;
  render();
  let extra = '';
  if (editingCustom) extra = txt(' Se aplicará al iniciar la partida.', '');
  else if (!gameResult) extra = ` ${turnText()}`;
  speak(message + extra);
  scheduleAiMove();
}

rivalButtons.forEach(b => b.addEventListener('click', () => {
  const enabled = b.dataset.rival === 'ai';
  updateAiSettings({ enabled }, enabled
    ? txt(`Juegas contra la computadora, nivel ${AI_LEVELS[aiSettings.level].name.toLowerCase()}, con las ${sideName(aiSettings.humanColor)}.`,
          `🤖 Juegas contra la computadora. Tú: ${sideName(aiSettings.humanColor)}.`)
    : txt('Modo dos jugadores: dos personas en el mismo dispositivo.', '👥 Dos jugadores.'));
}));
aiHumanButtons.forEach(b => b.addEventListener('click', () => {
  updateAiSettings({ humanColor: b.dataset.aiHuman }, txt(`Juegas con las ${sideName(b.dataset.aiHuman)}.`, `Tú: ${sideName(b.dataset.aiHuman)}.`));
}));
aiLevelButtons.forEach(b => b.addEventListener('click', () => {
  updateAiSettings({ level: b.dataset.aiLevel }, `Nivel de la computadora: ${AI_LEVELS[b.dataset.aiLevel].name.toLowerCase()}.`);
}));

function evaluateOutcome(){
  if (mode === 'pawns'){
    return pawnGame.result ? { ...pawnGame.result } : null;
  }
  if (game.in_checkmate())            return { winner: other(game.turn()), reason:'checkmate' };
  if (game.in_stalemate())            return { winner: null, reason:'stalemate' };
  if (game.insufficient_material())   return { winner: null, reason:'insufficient' };
  if (game.in_threefold_repetition()) return { winner: null, reason:'repetition' };
  if (game.in_draw())                 return { winner: null, reason:'fifty' };
  return null;
}

function finishGame(outcome, prefix = ''){
  cancelAi();
  hintMove = null;
  gameResult = outcome;
  clock.stop();
  paused = false;
  selectedSquare = null;
  pendingMove = null;
  confirmBar.hidden = true;
  if (promoDialog.open) promoDialog.close();
  const text = outcomeText(outcome);
  addToLog('', `🏁 ${text}`);
  render();
  speak(prefix ? `${prefix} ${text}` : text, true, { type: outcome.winner ? 'win' : 'draw' });
  showResultDialog(outcome, text);
}

function showResultDialog(outcome, text){
  let title;
  if (!outcome.winner) title = txt('🤝 Tablas', '🤝 Empate');
  else if (isAiGame()) title = outcome.winner === aiSettings.humanColor ? '🏆 ¡Has ganado!' : '🤖 Gana la computadora';
  else title = txt(`🏆 Ganan las ${sideName(outcome.winner)}`, `🏆 ¡Ganan ${sideName(outcome.winner)}!`);
  document.getElementById('result-title').textContent = title;
  document.getElementById('result-text').textContent = text;
  if (typeof resultDialog.showModal === 'function' && !resultDialog.open){
    resultDialog.showModal();
  }
}

function cancelSelection(announce = true){
  const had = selectedSquare !== null || pendingMove !== null;
  selectedSquare = null;
  pendingMove = null;
  confirmBar.hidden = true;
  if (announce && had) speak(txt('Selección cancelada.', 'Cancelado.'));
  render();
}

function openPromotionDialog(from, to, color){
  promoDialog.dataset.from = from;
  promoDialog.dataset.to = to;
  promoDialog.querySelectorAll('.promo-btn').forEach(btn => {
    btn.querySelector('.promo-glyph').textContent = pieceGlyphs[btn.dataset.piece];
    btn.querySelector('.promo-glyph').className = `promo-glyph ${color === 'w' ? 'white-piece' : 'black-piece'}`;
  });
  speak(txt('Tu peón corona. Elige la nueva pieza: dama, torre, alfil o caballo.', '👑 Elige pieza nueva.'));
  if (typeof promoDialog.showModal === 'function') promoDialog.showModal();
  else requestMove(from, to, 'q', 'voice');
}

promoDialog.querySelectorAll('.promo-btn').forEach(btn => btn.addEventListener('click', () => {
  const { from, to } = promoDialog.dataset;
  promoDialog.close();
  requestMove(from, to, btn.dataset.piece, 'voice');
}));
promoDialog.addEventListener('cancel', () => {
  selectedSquare = null;
  speak('Coronación cancelada.');
  render();
});
document.getElementById('promo-cancel').addEventListener('click', () => {
  promoDialog.close();
  selectedSquare = null;
  speak('Coronación cancelada.');
  render();
});

confirmYes.addEventListener('click', () => {
  if (!pendingMove) return;
  const m = pendingMove;
  const ok = executeMove(m);
  const cell = boardEl.querySelector(`[data-square="${focusedSquare}"]`);
  if (ok && cell) cell.focus();
});
confirmNo.addEventListener('click', () => {
  cancelSelection();
  const cell = boardEl.querySelector(`[data-square="${focusedSquare}"]`);
  if (cell) cell.focus();
});

document.getElementById('result-new').addEventListener('click', () => {
  resultDialog.close();
  resetGame();
});
document.getElementById('result-close').addEventListener('click', () => resultDialog.close());

// =====================================================================
// INTERPRETACIÓN DEL LENGUAJE NATURAL -> JUGADA
// =====================================================================
function stripAccents(s){
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '');
}

function normalizeSquares(text){
  const letterMap = { a:'a', be:'b', ve:'b', uve:'b', ce:'c', de:'d', e:'e', efe:'f', ge:'g', je:'g', hache:'h', ache:'h' };
  const numberMap = { uno:'1', una:'1', dos:'2', tres:'3', cuatro:'4', cinco:'5', seis:'6', siete:'7', ocho:'8' };
  const letterAlt = Object.keys(letterMap).join('|');
  const numberAlt = Object.keys(numberMap).join('|');
  const re = new RegExp(`\\b(${letterAlt})\\b\\s+(?:numero\\s+)?(${numberAlt}|[1-8])\\b`, 'gi');
  return text.replace(re, (m, l, n) => {
    const letter = letterMap[l.toLowerCase()] || l.toLowerCase();
    const number = numberMap[n.toLowerCase()] || n;
    return letter + number;
  });
}

function findPieceWord(norm){
  for (const word in pieceWords){
    if (new RegExp(`\\b${word}\\b`).test(norm)) return pieceWords[word];
  }
  return null;
}

function parseMoveCommand(rawText){
  const norm = normalizeSquares(stripAccents(rawText.toLowerCase()));
  const squares = norm.match(/\b[a-h][1-8]\b/g) || [];
  const pieceType = findPieceWord(norm);

  let promotion = null;
  const promoMatch = norm.match(/(corona|corono|promocion|convierte|asciende)[a-z\s]*?(dama|reina|torre|alfil|caballo)/);
  if (promoMatch) promotion = pieceWords[promoMatch[2]];

  return { squares, pieceType, promotion };
}

function tryMove(parsed){
  const { squares, pieceType, promotion } = parsed;

  if (squares.length >= 2){
    requestMove(squares[0], squares[1], promotion, 'voice');
  } else if (squares.length === 1){
    const to = squares[0];
    const reason = blockedReason();
    if (reason){ speak(reason, true, { type:'error' }); return; }
    const candidates = engine.moves({ verbose:true }).filter(m => m.to === to && (!pieceType || m.piece === pieceType));
    // Una coronación genera 4 jugadas con el mismo origen: se cuentan orígenes distintos.
    const origins = [...new Set(candidates.map(m => m.from))];
    if (origins.length === 1){
      requestMove(origins[0], to, promotion, 'voice');
    } else if (origins.length > 1){
      speak(`Hay más de una pieza que puede mover a ${to}. Indica también la casilla de origen, por ejemplo "de ${origins[0]} a ${to}".`, true, { type:'error' });
    } else {
      speak(txt('Movimiento inválido, intenta de nuevo.', '⛔ No se puede. Prueba otra vez.'), true, { type:'error' });
    }
  } else {
    speak('No entendí el comando. Di "ayuda" para escuchar las instrucciones.', true, { type:'error' });
  }
}

function tryCastle(isLong){
  if (mode === 'pawns'){
    speak('En la batalla de peones no hay reyes ni torres, así que no existe el enroque.', true, { type:'error' });
    return;
  }
  const reason = blockedReason();
  if (reason){ speak(reason, true, { type:'error' }); return; }
  const mv = game.moves({ verbose:true }).find(m => m.flags.includes(isLong ? 'q' : 'k'));
  if (mv) requestMove(mv.from, mv.to, null, 'voice');
  else speak('Ahora no se puede enrocar por ese lado.', true, { type:'error' });
}

function processVoiceCommand(rawText){
  const norm = stripAccents(rawText.toLowerCase());

  if (/ayuda|comandos|instrucciones/.test(norm)) { speakHelp(); return; }
  if (/modo clasico|ajedrez clasico|juego clasico/.test(norm)) { setMode('classic'); return; }
  if (/batalla de peones/.test(norm)) { setMode('pawns'); return; }
  if (/modo personalizado|personalizar piezas/.test(norm)) { setMode('custom'); return; }
  if (/contra la (computadora|maquina|ordenador)/.test(norm)) { rivalButtons[1].click(); return; }
  if (/dos jugadores/.test(norm)) { rivalButtons[0].click(); return; }
  const levelMatch = norm.match(/nivel (facil|medio|dificil)/);
  if (levelMatch) { document.querySelector(`[data-ai-level="${{ facil:'easy', medio:'medium', dificil:'hard' }[levelMatch[1]]}"]`).click(); return; }

  if (editingCustom){
    if (processEditorVoiceCommand(norm)) return;
    speak('Estás en el editor de posición. Di, por ejemplo, "colocar torre blanca en a1", "borrar a1", o "iniciar partida".', true);
    return;
  }

  if (pendingMove && /^(si|confirmar|confirmo|confirma|vale|ok)\b/.test(norm.trim())) { confirmYes.click(); return; }
  if (/^(no|cancelar|cancela)\b/.test(norm.trim())) { cancelSelection(); return; }
  if (/turno/.test(norm)) { announceTurn(); return; }
  if (/tiempo|reloj/.test(norm)) { announceClocks(); return; }
  if (/repite|repetir|ultima jugada|ultimo movimiento/.test(norm)) { announceLastMove(); return; }
  if (/reiniciar|nueva partida/.test(norm)) { resetGame(); return; }
  if (/pausa|reanudar|continuar/.test(norm)) { togglePause(); return; }
  if (/pista|sugerencia|que muevo/.test(norm)) { showHint(); return; }
  if (/enroque/.test(norm)) { tryCastle(/largo/.test(norm)); return; }

  tryMove(parseMoveCommand(rawText));
}

// =====================================================================
// RECONOCIMIENTO DE VOZ (STT) -- opcional, nunca obligatorio
// =====================================================================
const SpeechRecognitionAPI = window.SpeechRecognition || window.webkitSpeechRecognition;
let recognition = null;

if (SpeechRecognitionAPI){
  recognition = new SpeechRecognitionAPI();
  recognition.lang = 'es-ES';
  recognition.continuous = true;
  recognition.interimResults = false;

  recognition.onresult = (event) => {
    const last = event.results[event.results.length - 1];
    const transcript = last[0].transcript.trim();
    processVoiceCommand(transcript);
  };

  recognition.onerror = (event) => {
    if (event.error === 'no-speech' || event.error === 'aborted') return;
    if (event.error === 'not-allowed' || event.error === 'service-not-allowed'){
      // Sin permiso: se deja de reintentar (antes se reiniciaba sin fin).
      shouldListen = false;
      updateMicUI(false);
      speak('No hay permiso para usar el micrófono. Puedes seguir jugando con el ratón, el teclado o escribiendo.', true, { type:'error' });
      return;
    }
    speak('Hubo un problema con el micrófono.', true, { type:'error' });
  };

  recognition.onend = () => {
    if (shouldListen){
      try { recognition.start(); } catch(e){ }
    } else {
      updateMicUI(false);
    }
  };
} else {
  micBtn.disabled = true;
  micLabel.textContent = 'Voz no disponible en este navegador (puedes jugar sin ella)';
}

function toggleListening(){
  if (!recognition) return;
  shouldListen = !shouldListen;
  if (shouldListen){
    try { recognition.start(); } catch(e){}
    updateMicUI(true);
    speak('Escuchando. Di tu movimiento o comando.');
  } else {
    recognition.stop();
    updateMicUI(false);
  }
}

function updateMicUI(on){
  micBtn.setAttribute('aria-pressed', on ? 'true' : 'false');
  micBtn.classList.toggle('listening', on);
  micLabel.textContent = on ? 'Escuchando… (clic para detener)' : 'Activar micrófono (opcional)';
}

micBtn.addEventListener('click', toggleListening);
document.getElementById('help-btn').addEventListener('click', speakHelp);
document.getElementById('hint-btn').addEventListener('click', showHint);
document.getElementById('reset-btn').addEventListener('click', resetGame);
pauseBtn.addEventListener('click', togglePause);

textForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const val = textInput.value.trim();
  if (val) processVoiceCommand(val);
  textInput.value = '';
});

// Atajos globales: se ignoran dentro de campos de texto/selects y con Ctrl/Alt/Cmd
// (antes Ctrl+R también disparaba "repetir jugada").
document.addEventListener('keydown', (e) => {
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.target.closest('input, textarea, select, dialog')) return;
  const key = e.key.toLowerCase();
  if (key === 'escape'){
    if (selectedSquare || pendingMove) cancelSelection();
    return;
  }
  if (!A11y.get('keyboardShortcuts')) return;
  if (key === 'm') toggleListening();
  else if (key === 'r') announceLastMove();
  else if (key === 't') announceTurn();
  else if (key === 'p') togglePause();
});

// =====================================================================
// TABLERO VISUAL + NAVEGACIÓN POR TECLADO
// Las 64 casillas se crean una sola vez; render() solo actualiza su estado.
// Un único listener de clic y otro de teclado (delegación de eventos).
// =====================================================================
const cells = {};

function buildBoard(){
  boardEl.innerHTML = '';
  for (let rank = 8; rank >= 1; rank--){
    const rowEl = document.createElement('div');
    rowEl.className = 'row';
    rowEl.setAttribute('role', 'row');
    for (let fileIdx = 0; fileIdx < 8; fileIdx++){
      const square = `${FILES[fileIdx]}${rank}`;
      const cell = document.createElement('button');
      cell.type = 'button';
      // a1 es una casilla oscura (antes los colores estaban invertidos).
      cell.className = `cell ${(rank + fileIdx) % 2 === 1 ? 'dark' : 'light'}`;
      cell.dataset.square = square;
      cell.dataset.coord = square;
      cell.setAttribute('role', 'gridcell');
      cell.innerHTML = '<span class="pc" aria-hidden="true"></span><span class="side-tag" aria-hidden="true"></span><span class="state-tag" aria-hidden="true"></span>';
      cells[square] = cell;
      rowEl.appendChild(cell);
    }
    boardEl.appendChild(rowEl);
  }
}

boardEl.addEventListener('click', (e) => {
  const cell = e.target.closest('.cell');
  if (!cell) return;
  focusedSquare = cell.dataset.square;
  onCellActivate(cell.dataset.square);
});

boardEl.addEventListener('keydown', (e) => {
  const cell = e.target.closest('.cell');
  if (!cell) return;
  const square = cell.dataset.square;
  let fileIdx = FILES.indexOf(square[0]);
  let rank = Number(square[1]);
  const dir = boardEl.classList.contains('flipped') ? -1 : 1;   // con negras abajo, "arriba" es hacia la fila 1
  const clampFile = f => Math.min(7, Math.max(0, f));
  const clampRank = r => Math.min(8, Math.max(1, r));
  switch(e.key){
    case 'ArrowUp':    rank = clampRank(rank + dir); break;
    case 'ArrowDown':  rank = clampRank(rank - dir); break;
    case 'ArrowLeft':  fileIdx = clampFile(fileIdx - dir); break;
    case 'ArrowRight': fileIdx = clampFile(fileIdx + dir); break;
    case 'Home':       fileIdx = dir === 1 ? 0 : 7; break;
    case 'End':        fileIdx = dir === 1 ? 7 : 0; break;
    case 'Enter':
    case ' ':
      e.preventDefault();
      onCellActivate(square);
      return;
    default: return;
  }
  e.preventDefault();
  moveFocus(`${FILES[fileIdx]}${rank}`);
});

function moveFocus(square){
  if (cells[focusedSquare]) cells[focusedSquare].tabIndex = -1;
  focusedSquare = square;
  const cell = cells[square];
  cell.tabIndex = 0;
  cell.focus();
  if (A11y.get('announceFocus') || editingCustom){
    speak(cell.getAttribute('aria-label'), false, { status: false });
  }
}

function onCellActivate(square){
  if (editingCustom){ onEditorCellActivate(square); return; }
  onGameCellActivate(square);
}

function onGameCellActivate(square){
  const reason = blockedReason();
  if (reason){ speak(reason, true, { type:'error' }); return; }
  if (pendingMove){
    speak(txt('Primero confirma o cancela el movimiento propuesto.', 'Primero pulsa Confirmar o Cancelar.'), true);
    confirmYes.focus();
    return;
  }

  const piece = engine.get(square);
  const turn = engine.turn();

  if (selectedSquare === square){
    cancelSelection();
    return;
  }

  if (piece && piece.color === turn){
    const n = legalMovesFrom(square).length;
    if (n === 0){
      speak(txt(`${pieceLabel(piece)} en ${square} no tiene movimientos posibles. Elige otra pieza.`, `⛔ Esa pieza no puede moverse.`), true, { type:'error' });
      return;
    }
    selectedSquare = square;
    render();
    speak(txt(`${pieceLabel(piece)} en ${square} ${selectedWord(piece.type)}. Tiene ${n} ${n === 1 ? 'movimiento posible' : 'movimientos posibles'}. Elige la casilla destino.`,
              `✋ ${pieceLabel(piece)}. Ahora toca una casilla con punto.`), false, { type:'select', banner:false });
    return;
  }

  if (selectedSquare === null){
    if (piece && isAiGame()){
      speak(txt(`Esa pieza es de la computadora. Tú juegas con las ${sideName(aiSettings.humanColor)}.`, `Esa es de la computadora. Tú: ${sideName(aiSettings.humanColor)}.`), true, { type:'error' });
    } else if (piece){
      speak(txt(`Esa pieza es de las ${sideName(piece.color)}. Ahora juegan las ${sideName(turn)}.`, `No es tu turno. Juegan ${sideName(turn)}.`), true, { type:'error' });
    } else {
      speak(txt(`Casilla ${square} vacía. Selecciona primero una pieza de las ${sideName(turn)}.`, `Casilla vacía. Toca una pieza de ${sideName(turn)}.`), true, { type:'error' });
    }
    return;
  }

  if (!findLegalMove(selectedSquare, square)){
    // La selección se mantiene: no hace falta volver a empezar.
    speak(txt(`No puede moverse a ${square}. Elige una casilla marcada o toca de nuevo la pieza para cancelar.`, `⛔ Ahí no. Elige una casilla con punto.`), true, { type:'error' });
    return;
  }
  requestMove(selectedSquare, square, null, 'board');
}

function kingInCheckSquare(){
  if (mode === 'pawns' || editingCustom || !game.in_check()) return null;
  const turn = game.turn();
  for (const sq in cells){
    const p = game.get(sq);
    if (p && p.type === 'k' && p.color === turn) return sq;
  }
  return null;
}

function render(){
  const editing = editingCustom;
  const targets = new Map();
  if (!editing && selectedSquare){
    for (const m of legalMovesFrom(selectedSquare)){
      if (!targets.has(m.to)) targets.set(m.to, m);
    }
  }
  const checkSq = editing ? null : kingInCheckSquare();
  const last = (!editing && lastMove) ? lastMove : null;
  const pending = pendingMove;

  for (const square in cells){
    const cell = cells[square];
    const piece = editing ? editorBoard[square] : engine.get(square);
    const target = targets.get(square);

    let label = piece ? `${pieceLabel(piece)} en ${square}` : `Casilla ${square} vacía`;
    let stateTag = '';
    if (square === selectedSquare){ label += `, ${selectedWord(piece ? piece.type : 'p')}`; stateTag = '★'; }
    if (square === checkSq){ label += ', en jaque'; stateTag = '⚠'; }
    if (target){
      const sel = engine.get(selectedSquare);
      label += target.captured
        ? `. Captura disponible: ${pieceNames[sel.type].toLowerCase()} de ${selectedSquare} captura en ${square}`
        : `. Movimiento disponible: ${pieceNames[sel.type].toLowerCase()} de ${selectedSquare} a ${square}`;
    }
    if (last && (square === last.from || square === last.to)){
      label += square === last.to ? ', llegada de la última jugada' : ', salida de la última jugada';
      if (!stateTag) stateTag = square === last.to ? '◆' : '◇';
    }
    if (pending && square === pending.to){ label += ', destino pendiente de confirmar'; stateTag = '?'; }
    if (hintMove && square === hintMove.from){ label += ', pista: mover esta pieza'; stateTag = '💡'; }
    if (hintMove && square === hintMove.to){ label += ', pista: casilla de destino'; stateTag = '💡'; }
    if (editing) label += ', modo edición';

    cell.setAttribute('aria-label', label);
    cell.setAttribute('aria-selected', square === selectedSquare ? 'true' : 'false');
    cell.tabIndex = square === focusedSquare ? 0 : -1;
    cell.querySelector('.pc').textContent = piece ? pieceGlyphs[piece.type] : '';
    cell.querySelector('.side-tag').textContent = piece ? (piece.color === 'w' ? 'B' : 'N') : '';
    cell.querySelector('.state-tag').textContent = stateTag;

    cell.classList.toggle('white-piece', !!piece && piece.color === 'w');
    cell.classList.toggle('black-piece', !!piece && piece.color === 'b');
    cell.classList.toggle('selected', square === selectedSquare);
    cell.classList.toggle('legal', !!target && !target.captured);
    cell.classList.toggle('legal-capture', !!target && !!target.captured);
    cell.classList.toggle('in-check', square === checkSq);
    cell.classList.toggle('last-from', !!last && square === last.from);
    cell.classList.toggle('last-to', !!last && square === last.to);
    cell.classList.toggle('pending-to', !!pending && square === pending.to);
    cell.classList.toggle('hint-from', !!hintMove && square === hintMove.from);
    cell.classList.toggle('hint-to', !!hintMove && square === hintMove.to);
  }

  boardEl.classList.toggle('editing', editing);
  // Contra la computadora con negras: el tablero se gira para tener tus piezas abajo.
  const flipped = isAiGame() && aiSettings.humanColor === 'b';
  boardEl.classList.toggle('flipped', flipped);
  const barB = document.querySelector('.player-bar[data-color="b"]');
  const barW = document.querySelector('.player-bar[data-color="w"]');
  boardFrameEl.before(flipped ? barW : barB);
  boardFrameEl.after(flipped ? barB : barW);
  document.querySelectorAll('.player-role').forEach(el => {
    el.textContent = !isAiGame() ? '' : (el.dataset.roleFor === aiSettings.humanColor ? '· 🙂 Tú' : `· 🤖 Computadora (${AI_LEVELS[aiSettings.level].name.toLowerCase()})`);
  });
  pauseOverlay.hidden = !paused;
  renderTurnIndicator(checkSq);
  renderCaptured();
  renderClocks();
  renderGuide();
}

function renderTurnIndicator(checkSq){
  let icon, text, state;
  if (editingCustom){ icon = '✏️'; text = txt('Editando la posición', 'Editando'); state = 'edit'; }
  else if (gameResult){
    icon = '🏁';
    text = gameResult.winner ? txt(`Partida terminada: ganan las ${sideName(gameResult.winner)}`, `Ganan ${sideName(gameResult.winner)}`) : txt('Partida terminada: tablas', 'Empate');
    state = 'over';
  } else if (paused){ icon = '⏸'; text = txt('Partida en pausa', 'Pausa'); state = 'paused'; }
  else if (isAiTurn()){
    icon = '🤖';
    text = aiThinking ? txt('La computadora está pensando…', 'La computadora piensa…') : txt('Turno de la computadora', 'Juega la computadora');
    state = 'ai';
    if (checkSq) text += txt(' · ¡Jaque!', ' · ⚠ ¡Jaque!');
  } else if (isAiGame()){
    icon = sideDot(engine.turn());
    text = txt(`Tu turno (${sideName(engine.turn())})`, 'Te toca');
    state = checkSq ? 'check' : engine.turn();
    if (checkSq) text += txt(' · ¡Jaque!', ' · ⚠ ¡Jaque!');
  } else {
    const t = engine.turn();
    icon = sideDot(t);
    text = txt(`Turno de las ${sideName(t)}`, `Juegan ${sideName(t)}`);
    state = t;
    if (checkSq){ text += txt(' · ¡Jaque!', ' · ⚠ ¡Jaque!'); state = 'check'; }
  }
  turnIndicator.dataset.state = state;
  turnIndicator.querySelector('.turn-icon').textContent = icon;
  turnIndicator.querySelector('.turn-text').textContent = text;
  document.querySelectorAll('.player-bar').forEach(bar => {
    bar.classList.toggle('to-move', !editingCustom && !gameResult && bar.dataset.color === engine.turn());
  });
}

function renderCaptured(){
  const captured = { w: [], b: [] };          // piezas capturadas POR cada bando
  if (!editingCustom){
    for (const m of engine.history({ verbose:true })){
      if (m.captured) captured[m.color].push(m.captured);
    }
  }
  const order = 'qrbnp';
  for (const c of ['w', 'b']){
    const list = captured[c].sort((a, b) => order.indexOf(a) - order.indexOf(b));
    const el = document.getElementById(`captured-${c}`);
    el.textContent = list.map(t => pieceGlyphs[t]).join('');
    el.className = `captured ${c === 'w' ? 'black-piece' : 'white-piece'}`;
    const counts = {};
    list.forEach(t => { counts[t] = (counts[t] || 0) + 1; });
    const words = Object.entries(counts).map(([t, n]) => `${n} ${(n > 1 ? piecePlurals[t] : pieceNames[t]).toLowerCase()}`);
    el.setAttribute('aria-label', words.length ? `Piezas capturadas por las ${sideName(c)}: ${words.join(', ')}` : `Las ${sideName(c)} no han capturado piezas`);
  }
}

function renderGuide(){
  guideEl.hidden = !A11y.get('stepGuide');
  if (guideEl.hidden) return;
  let step, text;
  if (editingCustom){ step = '✏️'; text = txt('Elige pieza y color abajo. Toca casillas para colocarlas. Luego pulsa «Iniciar partida».', 'Elige pieza. Toca casillas. Pulsa «Iniciar».'); }
  else if (gameResult){ step = '🏁'; text = txt('La partida terminó. Pulsa «Reiniciar partida» para jugar otra vez.', 'Terminó. Pulsa «Reiniciar».'); }
  else if (paused){ step = '⏸'; text = txt('Pausa. Pulsa «Reanudar» cuando quieras seguir.', 'Pulsa «Reanudar».'); }
  else if (isAiTurn()){ step = '🤖'; text = txt('Espera: ahora juega la computadora.', 'Espera. Juega la computadora.'); }
  else if (pendingMove){ step = '3'; text = txt('Paso 3: pulsa ✔ Confirmar para mover, o ✖ Cancelar.', 'Paso 3: pulsa ✔ o ✖.'); }
  else if (selectedSquare){ step = '2'; text = txt('Paso 2: toca una casilla con punto (●) para mover. Para cambiar de pieza, toca otra.', 'Paso 2: toca una casilla con punto ●.'); }
  else { step = '1'; text = txt(`Paso 1: toca una pieza de las ${sideName(engine.turn())}.`, `Paso 1: toca una pieza ${engine.turn() === 'w' ? 'blanca' : 'negra'}.`); }
  guideEl.querySelector('.guide-step').textContent = step;
  guideEl.querySelector('.guide-text').textContent = text;
}

// =====================================================================
// PANEL LATERAL: pestañas y selección de tiempo
// =====================================================================
const tabs = document.querySelectorAll('[role="tab"]');

function showTab(id){
  tabs.forEach(tab => {
    const on = tab.dataset.tab === id;
    tab.setAttribute('aria-selected', on ? 'true' : 'false');
    tab.tabIndex = on ? 0 : -1;
    document.getElementById(tab.getAttribute('aria-controls')).hidden = !on;
  });
}

tabs.forEach((tab, i) => {
  tab.addEventListener('click', () => showTab(tab.dataset.tab));
  tab.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    e.preventDefault();
    const next = tabs[(i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length];
    showTab(next.dataset.tab);
    next.focus();
  });
});

const timeButtons = document.querySelectorAll('.time-btn');
const customTimeBox = document.getElementById('custom-time');
const timeNote = document.getElementById('time-note');

function timeLabel(ms){
  return ms ? ChessClock.toWords(ms) : 'sin reloj';
}

function syncTimeButtons(){
  const preset = [...timeButtons].find(b => b.dataset.ms !== 'custom' && Number(b.dataset.ms) === timeControl);
  timeButtons.forEach(b => {
    const on = preset ? b === preset : b.dataset.ms === 'custom';
    b.setAttribute('aria-pressed', on ? 'true' : 'false');
  });
  customTimeBox.hidden = !!preset;
  if (!preset){
    const secs = Math.round(timeControl / 1000);
    document.getElementById('custom-h').value = Math.floor(secs / 3600);
    document.getElementById('custom-m').value = Math.floor((secs % 3600) / 60);
    document.getElementById('custom-s').value = secs % 60;
  }
  document.getElementById('time-summary').textContent = timeControl ? ChessClock.format(timeControl) : 'Sin reloj';
}

function chooseTimeControl(ms){
  timeControl = ms;
  saveTimeControl();
  syncTimeButtons();
  // Si la partida aún no ha empezado, el tiempo se aplica al momento.
  if (!gameResult && engine.history().length === 0){
    clock.configure(timeControl);
    paused = false;
    render();
    timeNote.textContent = '';
    speak(`Tiempo de partida: ${timeLabel(ms)}${ms ? ' por jugador. El reloj empieza tras la primera jugada' : ''}.`);
  } else {
    timeNote.textContent = `Se aplicará en la próxima partida (${timeLabel(ms)}).`;
    speak(`Tiempo elegido: ${timeLabel(ms)}. Se aplicará al reiniciar la partida.`);
  }
}

timeButtons.forEach(btn => btn.addEventListener('click', () => {
  if (btn.dataset.ms === 'custom'){
    timeButtons.forEach(b => b.setAttribute('aria-pressed', b === btn ? 'true' : 'false'));
    customTimeBox.hidden = false;
    document.getElementById('custom-m').focus();
    return;
  }
  chooseTimeControl(Number(btn.dataset.ms));
}));

document.getElementById('custom-time-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const read = id => Math.max(0, Math.floor(Number(document.getElementById(id).value) || 0));
  const h = Math.min(read('custom-h'), 10), m = Math.min(read('custom-m'), 59), s = Math.min(read('custom-s'), 59);
  const ms = ((h * 60 + m) * 60 + s) * 1000;
  if (ms < 10000){
    speak('El tiempo personalizado debe ser de al menos 10 segundos.', true, { type:'error' });
    return;
  }
  chooseTimeControl(ms);
});

document.getElementById('time-new-game').addEventListener('click', () => {
  timeNote.textContent = '';
  if (mode === 'custom' && !customStartFEN && editingCustom){
    speak('Primero coloca las piezas y pulsa «Iniciar partida».', true);
    return;
  }
  resetGame();
});

document.getElementById('time-open').addEventListener('click', () => {
  showTab('clock');
  const pressed = document.querySelector('.time-btn[aria-pressed="true"]');
  if (pressed) pressed.focus();
});

// Al volver a la pestaña, se descuenta enseguida el tiempo que pasó fuera.
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && clock.running){
    if (!clock.sync()) renderClocks();
  }
});

// =====================================================================
// PANEL DE ACCESIBILIDAD
// =====================================================================
const profileButtons = document.querySelectorAll('.profile-btn');
const customPanel = document.getElementById('a11y-custom');
const customToggle = document.getElementById('profile-custom');

function renderA11yPanel(){
  const s = A11y.all();
  const active = A11y.profiles();
  profileButtons.forEach(btn => {
    const id = btn.dataset.profile;
    if (id === 'normal') btn.setAttribute('aria-pressed', A11y.isNormal() ? 'true' : 'false');
    else if (id in A11Y_PROFILES) btn.setAttribute('aria-pressed', active.includes(id) ? 'true' : 'false');
  });
  customToggle.classList.toggle('has-overrides', A11y.overrideCount() > 0);

  document.querySelectorAll('[data-setting]').forEach(ctrl => {
    const key = ctrl.dataset.setting;
    if (ctrl.getAttribute('role') === 'switch'){
      ctrl.setAttribute('aria-checked', s[key] ? 'true' : 'false');
    } else if (ctrl.tagName === 'SELECT'){
      ctrl.value = s[key];
    } else if (ctrl.dataset.value !== undefined){
      ctrl.setAttribute('aria-pressed', String(s[key]) === ctrl.dataset.value ? 'true' : 'false');
    }
  });

  const names = active.map(id => `${A11Y_PROFILES[id].icon} ${A11Y_PROFILES[id].name}`);
  const n = A11y.overrideCount();
  let summary = names.length ? `Activo: ${names.join(' + ')}` : (n ? 'Configuración personalizada' : 'Modo normal (sin ayudas extra)');
  if (names.length && n) summary += ` · ${n} ${n === 1 ? 'ajuste propio' : 'ajustes propios'}`;
  document.getElementById('a11y-summary').textContent = summary;
}

profileButtons.forEach(btn => btn.addEventListener('click', () => {
  const id = btn.dataset.profile;
  if (id === 'normal'){
    A11y.resetAll();
    speak('Accesibilidad desactivada. Se restauró la configuración estándar.');
    return;
  }
  if (id === 'custom'){
    const open = customPanel.hidden;
    customPanel.hidden = !open;
    customToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    if (open) customPanel.querySelector('[data-setting]').focus();
    return;
  }
  const on = A11y.toggleProfile(id);
  const p = A11Y_PROFILES[id];
  speak(on ? txt(`Modo ${p.name} activado: ${p.summary}.`, `${p.icon} ${p.name}: activado.`)
           : txt(`Modo ${p.name} desactivado.`, `${p.icon} ${p.name}: apagado.`));
}));

document.querySelectorAll('[data-setting]').forEach(ctrl => {
  const key = ctrl.dataset.setting;
  const handler = () => {
    let value;
    if (ctrl.getAttribute('role') === 'switch') value = ctrl.getAttribute('aria-checked') !== 'true';
    else if (ctrl.tagName === 'SELECT') value = ctrl.value;
    else value = key === 'speechRate' ? Number(ctrl.dataset.value) : ctrl.dataset.value;
    A11y.set(key, value);
    const shown = typeof value === 'boolean' ? (value ? 'activado' : 'desactivado')
                : (ctrl.tagName === 'SELECT' ? ctrl.options[ctrl.selectedIndex].text : ctrl.textContent.trim());
    speak(`${A11Y_LABELS[key]}: ${shown}.`);
  };
  ctrl.addEventListener(ctrl.tagName === 'SELECT' ? 'change' : 'click', handler);
});

document.getElementById('a11y-reset').addEventListener('click', () => {
  A11y.resetAll();
  speak('Todas las ayudas se restablecieron a la configuración estándar.');
});

A11y.onChange((s) => {
  applyA11yToDocument(s);
  renderA11yPanel();
  if (Object.keys(cells).length) render();
});

// ---- Arranque ----
buildBoard();
A11y.init();
clock.configure(timeControl);
syncTimeButtons();
syncRivalUI();
render();
statusEl.textContent = txt(
  'Bienvenido al ajedrez accesible. Modo clásico. Turno de las blancas. Toca una pieza para empezar, o di "ayuda" si usas la voz.',
  '👋 Hola. Juegan blancas. Toca una pieza para empezar.');
scheduleAiMove();
