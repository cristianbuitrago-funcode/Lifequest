/* =========================================================================
   RETROALIMENTACIÓN: voz, sonidos y avisos visuales
   -------------------------------------------------------------------------
   speak() es la única puerta de salida de mensajes de la app:
   - Siempre actualiza el texto de estado (#status, región aria-live) para
     que lectores de pantalla y personas que no oyen tengan la información.
   - Lee en voz alta solo si "Narración" está activada.
   - Opcionalmente reproduce un sonido (si "Efectos de sonido" está activo)
     y muestra un aviso visual equivalente (si "Avisos visuales" está activo).
   ========================================================================= */

const statusEl = document.getElementById('status');
const alertEl  = document.getElementById('alert');
const bannerEl = document.getElementById('event-banner');
const boardFrameEl = document.getElementById('board-frame');

const synthAvailable = ('speechSynthesis' in window) && (typeof SpeechSynthesisUtterance !== 'undefined');
const letterSpeech = { a:'a', b:'be', c:'ce', d:'de', e:'e', f:'efe', g:'ge', h:'hache' };

/** Adapta un texto de pantalla para la síntesis de voz ("e4" -> "e 4", sin emojis). */
function toSpeech(text){
  return text
    .replace(/\b([a-h])([1-8])\b/g, (m, l, n) => `${letterSpeech[l]} ${n}`)
    .replace(/→/g, ' a ')
    .replace(/[←-⇿☀-➿⬀-⯿️︎]|[\u{1F000}-\u{1FAFF}]/gu, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function speakAloud(text, queue = false){
  if (!synthAvailable || !A11y.get('narration')) return;
  try{
    if (!queue) window.speechSynthesis.cancel();
    const utter = new SpeechSynthesisUtterance(toSpeech(text));
    utter.lang = 'es-ES';
    utter.rate = A11y.get('speechRate');
    window.speechSynthesis.speak(utter);
  } catch(e){
    console.warn('Síntesis de voz no disponible:', e);
  }
}

/**
 * @param {string} text
 * @param {boolean} urgent  también se anuncia en la región assertive (#alert)
 * @param {object} opts     { type, sound, status:false, banner:false, queue:true }
 *   queue: la voz espera a que termine el mensaje anterior en lugar de cortarlo.
 *   type: 'info' | 'move' | 'capture' | 'check' | 'win' | 'draw' | 'time' | 'error' | 'select'
 */
function speak(text, urgent = false, opts = {}){
  if (opts.status !== false){
    statusEl.textContent = text;
    statusEl.dataset.type = opts.type || 'info';
  }
  if (urgent){
    alertEl.textContent = '';
    requestAnimationFrame(() => { alertEl.textContent = text; });
  }
  speakAloud(text, !!opts.queue);
  const kind = opts.sound || (opts.type in SOUND_FOR_TYPE ? SOUND_FOR_TYPE[opts.type] : null);
  if (kind) playSound(kind);
  if (opts.type && opts.banner !== false && BANNER_TYPES.includes(opts.type)) showBanner(text, opts.type);
}

/* ---------------------------------------------------------------------
   Efectos de sonido (Web Audio, sin archivos externos)
   --------------------------------------------------------------------- */
const SOUND_FOR_TYPE = { move:'move', capture:'capture', check:'check', win:'end', draw:'end', time:'low', error:'error', select:'select' };
let audioCtx = null;

function tone(freq, duration, { type = 'sine', gain = 0.07, delay = 0 } = {}){
  const t0 = audioCtx.currentTime + delay;
  const osc = audioCtx.createOscillator();
  const vol = audioCtx.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  vol.gain.setValueAtTime(gain, t0);
  vol.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
  osc.connect(vol).connect(audioCtx.destination);
  osc.start(t0);
  osc.stop(t0 + duration + 0.02);
}

function playSound(kind){
  if (!A11y.get('sound')) return;
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return;
  try{
    if (!audioCtx) audioCtx = new Ctx();
    if (audioCtx.state === 'suspended') audioCtx.resume();
    switch(kind){
      case 'move':    tone(520, .08, { type:'triangle' }); break;
      case 'select':  tone(740, .05, { gain:.04 }); break;
      case 'capture': tone(320, .09, { type:'square', gain:.05 }); tone(220, .14, { type:'square', gain:.05, delay:.08 }); break;
      case 'check':   tone(880, .12); tone(660, .16, { delay:.13 }); break;
      case 'end':     [523, 659, 784].forEach((f, i) => tone(f, .25, { delay: i * .14 })); break;
      case 'low':     tone(1000, .06, { gain:.05 }); tone(1000, .06, { gain:.05, delay:.12 }); break;
      case 'error':   tone(170, .16, { type:'sawtooth', gain:.04 }); break;
    }
  } catch(e){ /* audio no disponible */ }
}

/* ---------------------------------------------------------------------
   Avisos visuales (alternativa a los sonidos)
   --------------------------------------------------------------------- */
const BANNER_TYPES = ['move', 'capture', 'check', 'win', 'draw', 'time', 'error'];
const BANNER_ICONS = { move:'♟', capture:'✖', check:'⚠', win:'🏆', draw:'🤝', time:'⏰', error:'⛔', info:'ℹ️' };
let bannerTimer = null;

function showBanner(text, type){
  if (!A11y.get('visualAlerts')) return;
  bannerEl.hidden = false;
  bannerEl.dataset.type = type;
  bannerEl.querySelector('.banner-icon').textContent = BANNER_ICONS[type] || BANNER_ICONS.info;
  bannerEl.querySelector('.banner-text').textContent = text;
  bannerEl.classList.remove('show');
  void bannerEl.offsetWidth;                    // reinicia la animación de entrada
  bannerEl.classList.add('show');
  clearTimeout(bannerTimer);
  bannerTimer = setTimeout(() => { bannerEl.hidden = true; }, (type === 'win' || type === 'draw') ? 8000 : 4000);

  if (type === 'check' || type === 'capture' || type === 'win' || type === 'time' || type === 'error'){
    boardFrameEl.dataset.flash = type;
    setTimeout(() => { if (boardFrameEl.dataset.flash === type) delete boardFrameEl.dataset.flash; }, 1400);
  }
}
