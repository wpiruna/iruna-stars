/** Builds data/INFORME_DATOS.md: what is real, what is provisional and what is still missing. */
import type { DataStatus, DataWarning } from '../../src/data/schema';

export function formatWarning(warning: DataWarning): string {
  const where = [warning.pestana, warning.fila !== undefined ? `fila ${warning.fila}` : null]
    .filter((part) => part !== null)
    .join(', ');
  return `${where}: ${warning.mensaje}`;
}

export function buildReport(status: DataStatus, rosterNotes: string[]): string {
  const lines: string[] = [];
  const add = (...text: string[]): void => void lines.push(...text);

  add('# Informe de datos — Waterpolo Iruña Stars 26-27', '');
  add(
    status.hoja
      ? `Hoja leída: \`${status.hoja}\`.`
      : 'No hay hoja de cálculo (`datos/plantilla.xlsx` o `.ods`): todo el juego usa datos provisionales.',
    '',
    'Este archivo lo escribe `npm run datos`. No lo edites: se sobrescribe en cada conversión.',
    '',
  );

  add('## Resumen', '', '| Dato | Reales | Provisionales |', '|---|---:|---:|');
  add(`| Jugadores de nuestro equipo | ${status.jugadores.reales} | ${status.jugadores.provisionales} |`);
  add(`| Equipos rivales | ${status.equipos.reales} | ${status.equipos.provisionales} |`);
  add(`| Árbitros | ${status.arbitros.reales} | ${status.arbitros.provisionales} |`);
  add(`| Frases | ${status.frases.reales} | ${status.frases.provisionales} |`, '');

  if (status.privacidad.length > 0) {
    add('## Privacidad', '');
    for (const note of status.privacidad) add(`- ${note}`);
    add('');
  }

  add('## Lo que queda por rellenar', '');
  const pending: string[] = [];
  if (status.barrasVacias > 0) {
    pending.push(`Hay ${status.barrasVacias} barras vacías en la pestaña Jugadores; cada una vale 5 hasta que la rellenes.`);
  }
  if (status.jugadoresSinBarras.length > 0) {
    pending.push(
      `Jugadores sin ninguna barra (${status.jugadoresSinBarras.length}): ${status.jugadoresSinBarras.join(', ')}.`,
    );
  }
  if (status.jugadores.provisionales > 0) {
    pending.push(
      `Nuestro equipo se completa con ${status.jugadores.provisionales} jugador(es) provisional(es) para poder hacer una convocatoria entera.`,
    );
  }
  if (status.equipos.provisionales > 0) {
    pending.push(`Faltan rivales reales: la Copa y los amistosos usan ${status.equipos.provisionales} equipos inventados.`);
  }
  if (status.arbitros.reales === 0) pending.push('No hay árbitros en la hoja: se usan los 4 provisionales.');
  if (pending.length === 0) pending.push('Nada: todos los datos son tuyos.');
  for (const item of pending) add(`- ${item}`);
  add('');

  add('## Imágenes que faltan', '');
  if (status.imagenesFaltantes.length === 0) add('- Ninguna.');
  for (const image of status.imagenesFaltantes) add(`- ${image.tipo}: ${image.de} → \`${image.esperado}\``);
  add('', 'Mientras falten, el juego dibuja una genérica.', '');

  add('## Imágenes que no se usan', '');
  if (status.imagenesSobrantes.length === 0) add('- Ninguna.');
  for (const image of status.imagenesSobrantes) add(`- \`${image.archivo}\`: ${image.motivo}`);
  add('');

  add('## Avisos', '');
  if (status.avisos.length === 0) add('- Ninguno.');
  for (const warning of status.avisos) add(`- ${formatWarning(warning)}`);
  add('');

  add('## Plantillas de rivales', '');
  if (rosterNotes.length === 0) add('- Sin cambios: todas las plantillas ya estaban generadas.');
  for (const note of rosterNotes) add(`- ${note}`);
  add('');

  return lines.join('\n');
}
