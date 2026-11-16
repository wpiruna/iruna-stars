import '@fontsource/anton/latin-400.css';
import '@fontsource/barlow-condensed/latin-600.css';
import '@fontsource/barlow-condensed/latin-700-italic.css';
import '@fontsource/barlow-condensed/latin-800-italic.css';
import './styles.css';
import { startGame } from './app/game';

const gameHost = document.getElementById('game');
const controlsHost = document.getElementById('controls');
const uiHost = document.getElementById('ui');

if (gameHost && controlsHost && uiHost) {
  startGame(gameHost, controlsHost, uiHost).catch((error: unknown) => {
    console.error(error);
    uiHost.innerHTML =
      '<p class="fatal">No se ha podido arrancar el juego en este navegador. Prueba con Chrome, Safari o Firefox actualizados.</p>';
  });
}
