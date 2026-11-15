import { isIos, isStandalone } from '../../app/platform';
import { useApp } from '../context';
import { go, ui } from '../state';
import { useStore } from '../store';

/** How to put the game on the phone's home screen, and where to get the single-file PC version. */
export function Install() {
  const { actions } = useApp();
  const { canInstall } = useStore(ui);
  return (
    <section class="screen panel-screen">
      <header class="panel-screen__header">
        <button class="btn btn--back" onClick={() => go('menu')}>
          ‹ Volver
        </button>
        <h2 class="heading heading--big">{__SINGLE_FILE__ ? 'Versión web' : 'Instalar'}</h2>
      </header>
      <div class="panel-screen__body notes">
        {__SINGLE_FILE__ ? (
          <>
            <h3>Estás en la versión de un solo archivo</h3>
            <p>
              Este <code>waterpolo.html</code> funciona sin conexión y sin instalar nada. Para jugar en el móvil usa el
              enlace de la versión web, que se puede añadir a la pantalla de inicio.
            </p>
            <p class="hint">La partida guardada de este archivo es independiente de la de la versión web.</p>
          </>
        ) : (
          <>
            <h3>En el móvil</h3>
            {isStandalone() ? (
              <p>Ya lo tienes instalado: lo estás abriendo desde la pantalla de inicio.</p>
            ) : isIos() ? (
              <ol>
                <li>Abre esta página en Safari.</li>
                <li>
                  Toca el botón <b>Compartir</b> y elige <b>Añadir a pantalla de inicio</b>.
                </li>
                <li>
                  Ábrelo desde el icono <b>Iruña Stars</b>: arranca a pantalla completa y funciona sin conexión.
                </li>
              </ol>
            ) : (
              <>
                <ol>
                  <li>
                    Abre el menú del navegador y elige <b>Instalar aplicación</b> o <b>Añadir a pantalla de inicio</b>.
                  </li>
                  <li>
                    Ábrelo desde el icono <b>Iruña Stars</b>.
                  </li>
                </ol>
                {canInstall && (
                  <button class="btn" onClick={actions.install}>
                    Instalar ahora
                  </button>
                )}
              </>
            )}
            <h3>En el PC, sin conexión</h3>
            <p>
              Descarga el juego entero en un único archivo y ábrelo con doble clic. No necesita internet ni servidor.
            </p>
            <a class="btn" href={`${import.meta.env.BASE_URL}waterpolo.html`} download="waterpolo.html">
              Descargar waterpolo.html
            </a>
            <p class="hint">
              La partida guardada es propia de cada sitio: la web, la app instalada en un iPhone y el archivo del PC no la
              comparten.
            </p>
          </>
        )}
      </div>
    </section>
  );
}
