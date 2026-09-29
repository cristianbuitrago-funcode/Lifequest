/* =========================================================================
   SISTEMA DE ACCESIBILIDAD
   -------------------------------------------------------------------------
   Dos niveles:
   1. Modos rápidos (perfiles): Visual, Auditiva, Motora, Cognitiva,
      Daltonismo y Lectura fácil. Se pueden COMBINAR (no se asume que una
      persona tenga una sola necesidad).
   2. Personalización: cada ajuste se puede cambiar individualmente. Esos
      cambios se guardan como "overrides" encima de los perfiles.

   Ajustes efectivos = valores por defecto + perfiles activos + overrides.
   Se guardan en localStorage (si el navegador lo permite).
   ========================================================================= */

const A11Y_STORAGE_KEY = 'ajedrez-accesible:accesibilidad:v1';

const prefersReducedMotion = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

const A11Y_DEFAULTS = Object.freeze({
  // Visión
  highContrast:    false,
  textSize:        'md',       // 'md' | 'lg' | 'xl'
  pieceSize:       'md',       // 'md' | 'lg' | 'xl' (también agranda el tablero)
  colorScheme:     'default',  // 'default' | 'deuteranopia' | 'protanopia' | 'tritanopia' | 'mono'
  patterns:        false,      // patrones, símbolos y letras además del color
  showLegalMoves:  true,
  showCoordinates: true,
  // Audición y voz
  sound:           true,       // efectos de sonido
  narration:       true,       // lectura en voz alta (comportamiento original de la app)
  speechRate:      1,          // 0.8 | 1 | 1.25
  visualAlerts:    false,      // avisos visuales grandes + destellos del tablero
  // Movimiento
  largeTargets:      false,    // botones y casillas grandes
  keyboardShortcuts: true,     // teclas M, R, T, Esc
  announceFocus:     false,    // leer la casilla al moverse con las flechas
  moveConfirmation:  false,
  // Comprensión y lectura
  simplifiedUI:    false,
  stepGuide:       false,
  easyRead:        false,
  reducedMotion:   prefersReducedMotion
});

const A11Y_PROFILES = {
  visual: {
    name:'Visual', icon:'👁️',
    summary:'alto contraste, piezas y texto grandes, símbolos y lectura de casillas',
    settings:{ highContrast:true, textSize:'lg', pieceSize:'lg', patterns:true, showLegalMoves:true,
               showCoordinates:true, narration:true, announceFocus:true }
  },
  auditiva: {
    name:'Auditiva', icon:'👂',
    summary:'avisos visuales grandes para turno, capturas, jaque y final de partida',
    settings:{ visualAlerts:true, showLegalMoves:true }
  },
  motora: {
    name:'Motora', icon:'♿',
    summary:'botones y casillas grandes, sin arrastrar, confirmación de movimientos y atajos de teclado',
    settings:{ largeTargets:true, pieceSize:'lg', keyboardShortcuts:true, moveConfirmation:true, showLegalMoves:true }
  },
  cognitiva: {
    name:'Cognitiva', icon:'🧠',
    summary:'interfaz sencilla, guía paso a paso, confirmación y menos animaciones',
    settings:{ simplifiedUI:true, stepGuide:true, reducedMotion:true, moveConfirmation:true,
               showLegalMoves:true, speechRate:0.8 }
  },
  daltonismo: {
    name:'Daltonismo', icon:'🎨',
    summary:'colores seguros para daltonismo, patrones, símbolos y letras en las piezas',
    settings:{ colorScheme:'deuteranopia', patterns:true, showLegalMoves:true }
  },
  lectura: {
    name:'Lectura fácil', icon:'📖',
    summary:'frases cortas, iconos con texto y guía paso a paso',
    settings:{ easyRead:true, textSize:'lg', stepGuide:true, speechRate:0.8 }
  }
};

const A11Y_SIZE_ORDER = ['md', 'lg', 'xl'];

const A11Y_LABELS = {
  highContrast:'Alto contraste', textSize:'Tamaño del texto', pieceSize:'Tamaño de piezas y tablero',
  colorScheme:'Esquema de color', patterns:'Patrones y símbolos', showLegalMoves:'Mostrar movimientos posibles',
  showCoordinates:'Mostrar coordenadas', sound:'Efectos de sonido', narration:'Narración por voz',
  speechRate:'Velocidad de la voz', visualAlerts:'Avisos visuales', largeTargets:'Botones grandes',
  keyboardShortcuts:'Atajos de teclado', announceFocus:'Leer casilla al navegar', moveConfirmation:'Confirmar movimientos',
  simplifiedUI:'Interfaz simplificada', stepGuide:'Guía paso a paso', easyRead:'Lectura fácil',
  reducedMotion:'Reducir animaciones'
};

const A11y = (() => {
  let state = { profiles: [], overrides: {} };
  let settings = { ...A11Y_DEFAULTS };
  const listeners = [];

  function load(){
    try{
      const raw = localStorage.getItem(A11Y_STORAGE_KEY);
      if (!raw) return;
      const saved = JSON.parse(raw);
      const profiles = Array.isArray(saved.profiles) ? saved.profiles.filter(p => p in A11Y_PROFILES) : [];
      const overrides = {};
      if (saved.overrides && typeof saved.overrides === 'object'){
        for (const key in saved.overrides){
          if (key in A11Y_DEFAULTS) overrides[key] = saved.overrides[key];
        }
      }
      state = { profiles, overrides };
    } catch(e){ /* almacenamiento no disponible: se usan los valores por defecto */ }
  }

  function save(){
    try{ localStorage.setItem(A11Y_STORAGE_KEY, JSON.stringify(state)); } catch(e){}
  }

  /** Combina perfiles: "sí" gana a "no", el tamaño mayor gana y la voz más lenta gana. */
  function fromProfiles(){
    const merged = { ...A11Y_DEFAULTS };
    const seen = {};
    for (const id of state.profiles){
      const preset = A11Y_PROFILES[id].settings;
      for (const key in preset){
        const value = preset[key];
        if (!(key in seen)){ merged[key] = value; seen[key] = true; continue; }
        if (typeof value === 'boolean') merged[key] = merged[key] || value;
        else if (key === 'textSize' || key === 'pieceSize'){
          merged[key] = A11Y_SIZE_ORDER[Math.max(A11Y_SIZE_ORDER.indexOf(merged[key]), A11Y_SIZE_ORDER.indexOf(value))];
        } else if (key === 'speechRate') merged[key] = Math.min(merged[key], value);
        else if (merged[key] === A11Y_DEFAULTS[key]) merged[key] = value;
      }
    }
    return merged;
  }

  function recompute(){
    const base = fromProfiles();
    // Un override igual al valor que ya dan los perfiles no aporta nada.
    for (const key in state.overrides){
      if (state.overrides[key] === base[key]) delete state.overrides[key];
    }
    settings = { ...base, ...state.overrides };
    save();
    listeners.forEach(fn => fn(settings));
  }

  return {
    init(){ load(); recompute(); },
    get(key){ return settings[key]; },
    all(){ return { ...settings }; },
    profiles(){ return [...state.profiles]; },
    overrideCount(){ return Object.keys(state.overrides).length; },
    isNormal(){ return state.profiles.length === 0 && Object.keys(state.overrides).length === 0; },
    toggleProfile(id){
      if (!(id in A11Y_PROFILES)) return false;
      const on = !state.profiles.includes(id);
      state.profiles = on ? [...state.profiles, id] : state.profiles.filter(p => p !== id);
      recompute();
      return on;
    },
    set(key, value){
      if (!(key in A11Y_DEFAULTS)) return;
      state.overrides[key] = value;
      recompute();
    },
    resetAll(){
      state = { profiles: [], overrides: {} };
      recompute();
    },
    onChange(fn){ listeners.push(fn); }
  };
})();

/* ---------------------------------------------------------------------
   Aplicación de los ajustes a la página (clases y atributos en <html>)
   --------------------------------------------------------------------- */
function applyA11yToDocument(s){
  const root = document.documentElement;
  const flags = {
    'a11y-hc': s.highContrast,
    'a11y-patterns': s.patterns,
    'a11y-large-targets': s.largeTargets,
    'a11y-simplified': s.simplifiedUI,
    'a11y-easy-read': s.easyRead,
    'a11y-reduce-motion': s.reducedMotion,
    'a11y-hide-legal': !s.showLegalMoves,
    'a11y-hide-coords': !s.showCoordinates,
    'a11y-visual-alerts': s.visualAlerts
  };
  for (const cls in flags) root.classList.toggle(cls, !!flags[cls]);
  root.dataset.textSize = s.textSize;
  root.dataset.pieceSize = s.pieceSize;
  root.dataset.scheme = s.colorScheme;

  // Textos de "lectura fácil": los elementos con data-easy cambian de texto.
  document.querySelectorAll('[data-easy]').forEach(el => {
    if (el.dataset.normal === undefined) el.dataset.normal = el.textContent;
    el.textContent = s.easyRead ? el.dataset.easy : el.dataset.normal;
  });
}

/** Devuelve el texto normal o su versión de lectura fácil. */
function txt(normal, easy){
  return (A11y.get('easyRead') && easy) ? easy : normal;
}
