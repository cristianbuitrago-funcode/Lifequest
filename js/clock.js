/* =========================================================================
   RELOJ DE AJEDREZ
   -------------------------------------------------------------------------
   Dos relojes independientes (blancas y negras). El tiempo se calcula con
   marcas de tiempo (performance.now) y no contando "ticks", así que sigue
   siendo exacto aunque el navegador ralentice los temporizadores al cambiar
   de pestaña: al volver, sync() descuenta todo el tiempo transcurrido.
   ========================================================================= */

class ChessClock {
  constructor({ onTick = () => {}, onFlag = () => {}, onLow = () => {} } = {}){
    this.onTick = onTick;
    this.onFlag = onFlag;
    this.onLow = onLow;
    this.timer = null;
    // Estado inicial sin llamar a onTick (la app aún no ha terminado de crearse).
    this.initial = 0;
    this.remaining = { w:0, b:0 };
    this.running = null;
    this.last = 0;
    this.lowWarned = { w:false, b:false };
  }

  /** ms = tiempo por jugador; 0 = sin reloj. */
  configure(ms){
    this._stopTimer();
    this.initial = Math.max(0, Math.floor(ms) || 0);
    this.remaining = { w: this.initial, b: this.initial };
    this.running = null;
    this.last = 0;
    this.lowWarned = { w:false, b:false };
    this.onTick();
  }

  get enabled(){ return this.initial > 0; }

  /** Pone en marcha el reloj de `color` (y detiene el otro). */
  start(color){
    if (!this.enabled) return;
    if (this.sync()) return;               // el que movía ya había agotado su tiempo
    this.running = color;
    this.last = performance.now();
    this._startTimer();
    this.onTick();
  }

  stop(){
    this.sync();
    this.running = null;
    this._stopTimer();
    this.onTick();
  }

  /**
   * Descuenta el tiempo transcurrido del reloj activo.
   * Devuelve el color que ha agotado su tiempo, o null.
   */
  sync(){
    if (!this.running) return null;
    const color = this.running;
    const now = performance.now();
    this.remaining[color] -= now - this.last;
    this.last = now;

    if (this.remaining[color] <= 0){
      this.remaining[color] = 0;
      this.running = null;
      this._stopTimer();
      this.onTick();
      this.onFlag(color);
      return color;
    }
    if (!this.lowWarned[color] && this.remaining[color] <= this.lowThreshold()){
      this.lowWarned[color] = true;
      this.onLow(color);
    }
    return null;
  }

  /** "Poco tiempo": 10 % del total, entre 10 y 60 segundos. */
  lowThreshold(){
    return Math.min(60000, Math.max(10000, this.initial * 0.1));
  }

  isLow(color){
    return this.enabled && this.remaining[color] <= this.lowThreshold();
  }

  _startTimer(){
    if (this.timer) return;
    this.timer = setInterval(() => {
      if (!this.sync()) this.onTick();
    }, 100);
  }

  _stopTimer(){
    if (this.timer){
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  static format(ms){
    const total = Math.max(0, ms);
    if (total < 10000 && total > 0){
      return `0:0${Math.floor(total / 1000)}.${Math.floor((total % 1000) / 100)}`;
    }
    const secs = Math.ceil(total / 1000);
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    const s = secs % 60;
    const pad = n => String(n).padStart(2, '0');
    return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
  }

  static toWords(ms){
    const secs = Math.ceil(Math.max(0, ms) / 1000);
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    const s = secs % 60;
    const parts = [];
    if (h) parts.push(`${h} ${h === 1 ? 'hora' : 'horas'}`);
    if (m) parts.push(`${m} ${m === 1 ? 'minuto' : 'minutos'}`);
    if (s || !parts.length) parts.push(`${s} ${s === 1 ? 'segundo' : 'segundos'}`);
    return parts.length > 1 ? `${parts.slice(0, -1).join(', ')} y ${parts[parts.length - 1]}` : parts[0];
  }
}
