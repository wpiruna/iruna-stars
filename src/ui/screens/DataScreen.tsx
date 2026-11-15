/** "Datos del juego" (GDD §18.2): what is real, what is provisional and what is still missing. */
import { useState } from 'preact/hooks';
import { imageUrl, personPlaceholder } from '../../data/images';
import { debugParam } from '../../debug/config';
import { STYLE_LABEL } from '../../data/model';
import { Shield } from '../components/Shield';
import { Sticker } from '../components/Sticker';
import { useApp } from '../context';
import { go } from '../state';

type Tab = 'resumen' | 'equipo' | 'rivales' | 'arbitros' | 'avisos';
const TABS: { id: Tab; label: string }[] = [
  { id: 'resumen', label: 'Resumen' },
  { id: 'equipo', label: 'Nuestro equipo' },
  { id: 'rivales', label: 'Rivales' },
  { id: 'arbitros', label: 'Árbitros' },
  { id: 'avisos', label: 'Avisos' },
];

const plural = (count: number, one: string, many: string): string => (count === 1 ? one : many);
const stars = (count: number): string => (count === 0 ? 'sin estrellas' : `${count} ${plural(count, 'estrella', 'estrellas')}`);


function Count({ label, real, provisional }: { label: string; real: number; provisional: number }) {
  const total = real + provisional;
  return (
    <div class="count">
      <div class="count__label">{label}</div>
      <div class="count__values">
        <strong>{real}</strong> {plural(real, 'real', 'reales')} <span>·</span> <em>{provisional}</em>{' '}
        {plural(provisional, 'provisional', 'provisionales')}
      </div>
      <div class="count__meter">
        <i style={{ width: `${total === 0 ? 0 : (real / total) * 100}%` }} />
      </div>
    </div>
  );
}

const BIAS_LABEL: Record<string, string> = {
  '-3': 'Muy a favor',
  '-2': 'A favor',
  '-1': 'Algo a favor',
  '0': 'Neutro',
  '1': 'Algo en contra',
  '2': 'En contra',
  '3': 'Muy en contra',
};

export function DataScreen() {
  const { data } = useApp();
  const requested = debugParam('pestana');
  const [tab, setTab] = useState<Tab>(TABS.find((item) => item.id === requested)?.id ?? 'resumen');
  const status = data.status;
  const pendingCount = status.avisos.length + status.imagenesFaltantes.length + status.imagenesSobrantes.length;

  return (
    <section class="screen panel-screen">
      <header class="panel-screen__header">
        <button class="btn btn--back" onClick={() => go('menu')}>
          ‹ Volver
        </button>
        <h2 class="heading heading--big">Datos del juego</h2>
        <nav class="tabs">
          {TABS.map((item) => (
            <button class={`tab${tab === item.id ? ' tab--on' : ''}`} onClick={() => setTab(item.id)}>
              {item.label}
              {item.id === 'avisos' && pendingCount > 0 && <b>{pendingCount}</b>}
            </button>
          ))}
        </nav>
      </header>

      <div class="panel-screen__body">
        {tab === 'resumen' && (
          <div class="summary">
            <p class="lead">
              {status.hoja ? (
                <>
                  Datos leídos de <code>{status.hoja}</code>. Lo que falta lo inventa el juego y se va sustituyendo
                  según rellenas la hoja.
                </>
              ) : (
                <>No hay hoja de cálculo todavía: todo lo que ves es provisional.</>
              )}
            </p>
            <div class="summary__counts">
              <Count label="Jugadores" real={status.jugadores.reales} provisional={status.jugadores.provisionales} />
              <Count label="Equipos rivales" real={status.equipos.reales} provisional={status.equipos.provisionales} />
              <Count label="Árbitros" real={status.arbitros.reales} provisional={status.arbitros.provisionales} />
              <Count label="Frases" real={status.frases.reales} provisional={status.frases.provisionales} />
            </div>
            <ul class="todo">
              {status.barrasVacias > 0 && (
                <li>
                  <b>{status.barrasVacias}</b> {plural(status.barrasVacias, 'barra', 'barras')} de jugadores sin
                  rellenar (valen 5 mientras tanto).
                </li>
              )}
              {status.imagenesFaltantes.length > 0 && (
                <li>
                  <b>{status.imagenesFaltantes.length}</b>{' '}
                  {plural(status.imagenesFaltantes.length, 'imagen', 'imágenes')} por aportar.
                </li>
              )}
              {status.imagenesSobrantes.length > 0 && (
                <li>
                  <b>{status.imagenesSobrantes.length}</b>{' '}
                  {plural(status.imagenesSobrantes.length, 'imagen', 'imágenes')} en <code>assets/</code> que no{' '}
                  {plural(status.imagenesSobrantes.length, 'se usa', 'se usan')}.
                </li>
              )}
              {status.avisos.length > 0 && (
                <li>
                  <b>{status.avisos.length}</b> {plural(status.avisos.length, 'aviso', 'avisos')} (pestaña Avisos).
                </li>
              )}
              {status.privacidad.map((note) => (
                <li class="todo__privacy">{note}</li>
              ))}
            </ul>
            <p class="hint">
              Competición: {data.cup.nombre} · Presidente: {data.club.president} · Reglas: {data.rules.version}
            </p>
          </div>
        )}

        {tab === 'equipo' && (
          <div class="stickers">
            {data.ourTeam.players.map((player) => (
              <Sticker player={player} />
            ))}
          </div>
        )}

        {tab === 'rivales' && (
          <ul class="rows">
            {data.rivals.map((team) => (
              <li class={`row${team.origin === 'provisional' ? ' row--provisional' : ''}`}>
                <Shield id={team.id} code={team.code} image={team.shield} size={3.4} />
                <div class="row__main">
                  <strong>{team.name}</strong>
                  <span>
                    {team.code} · Nivel {team.level} · {team.style ? STYLE_LABEL[team.style] : ''} ·{' '}
                    {stars(team.players.filter((p) => p.star).length)}
                  </span>
                </div>
                <div class="row__tags">
                  {team.inCup && <span class="tag tag--cup">En la Copa</span>}
                  <span class={`tag${team.origin === 'provisional' ? ' tag--provisional' : ' tag--real'}`}>
                    {team.origin === 'provisional' ? 'Provisional' : 'Real'}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}

        {tab === 'arbitros' && (
          <ul class="rows">
            {data.referees.map((referee) => (
              <li class={`row${referee.origin === 'provisional' ? ' row--provisional' : ''}`}>
                <span class="row__face">
                  <img src={imageUrl(referee.photo) ?? personPlaceholder('referee')} alt="" />
                </span>
                <div class="row__main">
                  <strong>{referee.name}</strong>
                  <span>
                    Tolerancia {referee.contactTolerance} · Exclusiones {referee.exclusionTendency} · Tarjetas{' '}
                    {referee.cardTendency} · Regularidad {referee.consistency} · {BIAS_LABEL[String(referee.bias)]}
                  </span>
                  {referee.phrases[0] && <q>{referee.phrases[0]}</q>}
                </div>
                <div class="row__tags">
                  <span class={`tag${referee.origin === 'provisional' ? ' tag--provisional' : ' tag--real'}`}>
                    {referee.origin === 'provisional' ? 'Provisional' : 'Real'}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}

        {tab === 'avisos' && (
          <div class="notes">
            <h3>Imágenes que faltan</h3>
            {status.imagenesFaltantes.length === 0 ? (
              <p class="hint">Ninguna.</p>
            ) : (
              <ul>
                {status.imagenesFaltantes.map((image) => (
                  <li>
                    {image.tipo}: <b>{image.de}</b> → <code>{image.esperado}</code>
                  </li>
                ))}
              </ul>
            )}
            <h3>Imágenes que no se usan</h3>
            {status.imagenesSobrantes.length === 0 ? (
              <p class="hint">Ninguna.</p>
            ) : (
              <ul>
                {status.imagenesSobrantes.map((image) => (
                  <li>
                    <code>{image.archivo}</code>: {image.motivo}
                  </li>
                ))}
              </ul>
            )}
            <h3>Avisos</h3>
            {status.avisos.length === 0 ? (
              <p class="hint">Ninguno.</p>
            ) : (
              <ul>
                {status.avisos.map((warning) => (
                  <li>
                    <b>
                      {warning.pestana}
                      {warning.fila !== undefined ? `, fila ${warning.fila}` : ''}:
                    </b>{' '}
                    {warning.mensaje}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
