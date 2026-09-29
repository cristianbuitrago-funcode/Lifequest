# Ajedrez Accesible

Ajedrez para el navegador pensado para que cualquier persona pueda jugar: con ratón o pantalla táctil, con teclado o con la voz (opcional).

Abre `index.html` en el navegador. No hace falta instalar nada ni tener conexión: la única dependencia, chess.js 0.10.3, está incluida en `js/vendor/` (licencia BSD-2 en `js/vendor/chess.js-LICENSE.txt`). Las tipografías de Google Fonts se cargan si hay internet; sin conexión se usan las fuentes del sistema.

## Sin conexión e instalación
- Abierto como archivo (`index.html`), funciona sin internet porque chess.js está incluido.
- Publicado (GitHub Pages), el service worker `sw.js` guarda el juego en la primera visita: después abre y funciona sin conexión.
- `manifest.webmanifest` e `icons/` permiten instalarlo en el móvil o el ordenador como una app («Añadir a pantalla de inicio» / «Instalar»).
- Si añades un archivo nuevo al juego, inclúyelo en `APP_FILES` de `sw.js` y sube `CACHE_VERSION`.

## Estructura

| Archivo | Qué hace |
|---|---|
| `index.html` | Estructura de la página: panel de accesibilidad, tablero, relojes, pestañas y diálogos |
| `css/styles.css` | Estilos base, tablero y modos de accesibilidad (clases `a11y-*` en `<html>`) |
| `js/vendor/chess.js` | Motor de reglas chess.js 0.10.3 (sin modificar) |
| `js/pawn-battle.js` | Motor de la Batalla de peones (sin reyes). Tiene la misma interfaz que chess.js |
| `js/clock.js` | `ChessClock`: dos relojes basados en marcas de tiempo |
| `js/accessibility.js` | Modelo de preferencias (`A11y`), perfiles combinables, guardado en `localStorage` y `txt()` para lectura fácil |
| `js/ai.js` | Computadora: negamax con poda alfa-beta y límite de tiempo (niveles fácil, medio y difícil) |
| `js/feedback.js` | `speak()`: texto de estado, voz, sonidos (Web Audio) y avisos visuales |
| `sw.js`, `manifest.webmanifest`, `icons/` | Modo sin conexión e instalación como app |
| `js/app.js` | Partida, modos, editor, voz, teclado y renderizado del tablero |

## Modos de juego
- **Clásico**: reglas completas (jaque, mate, enroque, captura al paso, coronación con elección de pieza, tablas).
- **Batalla de peones**: solo peones, sin reyes ni jaques. Gana quien lleve un peón a la última fila o capture todos los peones rivales. Si el bando que mueve no tiene jugadas, la partida es tablas.
- **Personalizado**: editor de posición; si el rey y la torre están en su casilla inicial se puede enrocar.

## Contra la computadora
En «Rival» se elige entre **Dos jugadores** o **Computadora** (tu color y el nivel: fácil, medio o difícil). Funciona en los tres modos, se puede activar a mitad de partida y se recuerda para la próxima visita. Si juegas con negras, el tablero se gira para que tus piezas queden abajo. El botón **💡 Pista** sugiere una jugada.

## Accesibilidad
Modos rápidos que se pueden combinar: Visual, Auditiva, Motora, Cognitiva, Daltonismo y Lectura fácil. En «Personalizada» se ajusta cada ayuda por separado. «Normal» restablece la configuración estándar.
