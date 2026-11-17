# Waterpolo Iruña Stars 26-27

Juego arcade de waterpolo en 2D para móvil (y PC), protagonizado por el Waterpolo Iruña 98 02.
**`docs/GDD.md` es la fuente de verdad del diseño.** Léelo antes de tocar jugabilidad.

Se trabaja por fases (GDD §21). Cada fase termina jugable, publicada y con su lista de pruebas en
`docs/PRUEBAS/Fn.md`. **No se empieza la fase siguiente sin el visto bueno de Julián.**
Fase actual: **F4 (reglas y árbitro) terminada y publicada**; pendiente del visto bueno de Julián para empezar F5
(nuestros jugadores: estadísticas, energía, banquillo y cambios). F0, F1, F2 y F3 aprobadas.

Publicado en <https://wpiruna.github.io/iruna-stars/> desde el repositorio público `wpiruna/iruna-stars`.
Cada push a `main` convierte los datos, pasa los tests, compila y publica (`.github/workflows/publicar.yml`).

## Comandos

| Comando | Qué hace |
|---|---|
| `npm run dev` | Convierte los datos y arranca Vite (recarga al cambiar código o JSON). |
| `npm run datos` | Hoja + `assets/` → JSON de `data/`, imágenes optimizadas, iconos e `INFORME_DATOS.md`. |
| `npm run rivales -- --regenerar <id>` | Rehace la plantilla guardada de un rival (`--todos` para todas). |
| `npm test` | Vitest. |
| `npm run sim -- partidos=200` | Partidos IA contra IA sin pantalla: comprueba que terminan y da el equilibrio (goles, tiros, pérdidas, tiempo por fase, faltas, exclusiones, penaltis, tarjetas y cifras por árbitro; `arbitro=<id>` fija uno). |
| `npm run typecheck` | `tsc --noEmit`. |
| `npm run build` | datos → tipos → web (`dist/`) → HTML único (`dist/waterpolo.html`) → control de peso. |
| `npm run preview` | Sirve `dist/` en `http://localhost:4173/iruna-stars/`. |

Depuración: `F3` o `º`, `?debug=1` en la dirección, o cinco toques sobre la línea de versión del menú.
`?pantalla=datos&pestana=equipo` abre una pantalla directamente (`laboratorio`, `penaltis&rival=<id>`,
`ataque&rival=<id>&escenario=completo|entradas|boya|contra2x1|contra3x2|superioridad|inferioridad`,
`partido&rival=<id>&arbitro=<id>&minutos=1`, `tanda`, `entrenamiento`, `amistoso`, `ajustes`…); `?carga=16` multiplica
la escena de la portada. En un partido, la capa de depuración tiene la fila *Árbitro* (excluir rival o nuestro, penalti
a favor o en contra) para probar sin esperar.

Al parar servidores de prueba no usar `pkill -f` con un patrón que también aparezca en la misma orden: se mata a sí
misma. Mejor `kill` con el número de proceso.

Para probar en el navegador sin pantalla: el service worker cachea la versión anterior, así que hay que
saltárselo (DevTools: `Network.setBypassServiceWorker`) o se estará mirando un build viejo.

## Estructura

```
docs/GDD.md            diseño (no se edita sin consultar)      docs/PRUEBAS/   pruebas manuales por fase
datos/plantilla.ods    la hoja de Julián (.ods o .xlsx)        assets/         sus imágenes originales
data/reglas.json  formaciones.json  tuning.json  provisional/  textos/         archivos del proyecto
data/generado/rivales/ plantillas de rivales, congeladas y versionadas
data/*.json, data/generado/{club,estado,reglas.ajustes}.json, data/generado/img/   GENERADOS, fuera de git
tools/datos/           conversor: leer-hoja → convertir → fusionar → informe (pipeline.ts los encadena)
tools/rivales/  tools/imagenes/  tools/build/
src/core/              bucle de paso fijo 60 Hz, RNG con semilla, bus de eventos, curvas
src/data/              schema.ts (zod, claves en castellano) → model.ts (tipos en inglés) → load.ts
src/sim/field.ts        geometría y coordenadas (x a lo largo, y hacia abajo en pantalla, z altura)
src/sim/shooting/      modelo puro de tiro y parada + trayectoria del balón
src/sim/duel/          duelo lanzador–portero, IA del penalti, tanda y laboratorio
src/sim/attack/        ataque posicional: drill.ts (orquesta), passing.ts (selector [FIJO] y riesgo), control.ts
                       (gramática de controles), drive.ts (entradas), formation.ts, keeper.ts, movement.ts
src/input/             mando virtual (teclado, mando, táctil) y reconocedor de gestos
src/render/            agua (shader), piscina y porterías, cámara, jugadores, balón, efectos; playview.ts dibuja
                       el juego en el agua (anillo, flecha de pase con color de riesgo, entradas, ¡LIBRE!)
src/sim/match/         partido: match.ts (máquina de estados, posesión, saques, relojes, balón, faltas, exclusiones,
                       penaltis con el duelo de la tanda, cambios por expulsión), brain.ts (IA con balón), input.ts
                       (gramática según el momento), roles.ts (repliegue, superioridad del contraataque)
src/sim/rules/         reglamento puro: qué es cada contacto (nada, ordinaria, exclusión, penalti, violenta), área
                       de gol, tiros libres, córner o saque de portería, relojes tras exclusión
src/sim/referee/       árbitro: si pita lo clasificado (perfil, sesgo acotado, "día" por partido), tarjetas
src/app/session.ts     interfaz común de lo que se juega; play.ts (tanda y laboratorio), attack.ts (entrenamiento),
                       match.ts (partido y laboratorios de contraataque; dirige la cámara), replay.ts (repetición)
                       convierten eventos de la simulación en imagen, sonido, vibración y HUD
src/audio/sfx.ts       efectos sintetizados con WebAudio y el ambiente (agua y público que reacciona); app/ambience.ts
                       calcula cuánto nadan para el agua
src/persist/  src/ui/ (Preact; hud.ts es el estado del marcador)  src/app/  src/debug/
```

## Convenciones

- **Código en inglés; todo lo que ve Julián en castellano** (pantallas, informe, avisos, pestañas, commits).
- Los JSON de datos llevan claves en castellano (GDD §18.3). `src/data/model.ts` es el único sitio donde
  se traducen al modelo en inglés.
- Flujo en un solo sentido: `input → sim → eventos → presentación`. La simulación no conoce Pixi ni el DOM
  y tiene que poder ejecutarse en Node (tests y partidos sin pantalla).
- Simulación a paso fijo de 60 Hz con render interpolado. Todo azar pasa por `src/core/rng.ts`.
- Constantes de juego en `data/tuning.json`; reglamento en `data/reglas.json`. Nada de eso en el código.
- Los datos nunca rompen el juego: valor erróneo → valor por defecto + aviso "Pestaña, fila N: …".
- Rendimiento: un solo shader para el agua, texturas precocinadas, sin filtros sobre contenedores,
  sin reservas de memoria por fotograma. El build falla si se supera el presupuesto de peso.
- TypeScript estricto con `noUncheckedIndexedAccess`. Tests junto a cada pieza pura.
- Partido en PixiJS; pantallas de menú en DOM con Preact y `rem` (1 rem = 16 px lógicos de 720).

## Reglas [FIJO] (no se cambian sin consultar a Julián)

1. Nombre: **Waterpolo Iruña Stars 26-27**; nombre corto **Iruña Stars**; equipo **Waterpolo Iruña 98 02**.
2. Prioridades, por orden: divertido de controlar → fácil de entender → que se reconozca como waterpolo →
   profundidad → reglamento.
3. La IA controla la estructura; el jugador toma las decisiones. No se conducen nadadores en ataque posicional.
4. Un build, dos salidas: web instalable en GitHub Pages y `waterpolo.html` autocontenido.
5. Móvil en horizontal como objetivo; también teclado y mando. En vertical, "gira el móvil".
6. Solo pad + HABILIDAD + TIRO (+ pausa). Sin más botones permanentes.
7. Gramática de controles: toque = elegir, mantener = nadar o previsualizar, HABILIDAD = acción especial,
   TIRO = lanzar o entrar al contacto.
8. Selector de receptor inteligente: el pad nunca pasa a quien no esperas.
9. El número del gorro identifica al jugador: blanco con número azul, azul con número blanco, rojo el portero.
10. Árbitro coherente: se puede aprender cómo pita; cada sanción lleva su motivo y el silbato.
11. La hoja de cálculo es la fuente de los datos. Los JSON generados no se editan a mano.
12. El juego funciona completo sin datos reales: paquete provisional y sustitución progresiva.
13. Nada de material de SNK ni de otros juegos. Todo original o con licencia libre.

## Decisiones tomadas con Julián

- Repositorio **público** `wpiruna/iruna-stars`, **solo motes**: la columna *Nombre* de la hoja nunca llega
  a los JSON ni al build (hay un test que lo comprueba).
- **Antes de cada `git push`**: la columna *Nombre* de la hoja tiene que seguir vacía. Si `npm run datos`
  muestra el apartado "Privacidad", no se sube: el repositorio es público y su historial no se borra.
- Los commits se firman con la dirección anónima de GitHub de la cuenta `wpiruna` (configurada solo en
  este repositorio), para que no quede ningún correo personal a la vista.
- Fotos: filtro arcade automático en el build y cromo vertical 3:4.
- Nuestro equipo ataca siempre hacia la derecha (`reglas.json` → `partido.cambioDeCampo`).
- Las plantillas de rivales se congelan; la publicación automática hace commit de las nuevas.
- F1 probada por Julián en móvil y teclado: el tiro, la barra, el portero y el pad flotante le gustan tal
  como están. No retocar `data/tuning.json` (tiro, portero, penalti) sin motivo.
- En la tanda juega el portero real aunque tenga las barras vacías; el provisional solo si no hay ninguno.
- Selector de pase: el aviso de riesgo y la tirada real usan el mismo cálculo (`passRisk`); hay un test que
  comprueba que la frecuencia de intercepciones coincide con lo mostrado. No romper esa igualdad.
- Entradas calibradas con una curva gradual (igualados ≈ 45 % ¡LIBRE!); nada garantizado ni imposible.
- F2 aprobada («está super chulo, me encanta»).
- El entrenamiento de ataque (`AttackDrill`) y el partido (`Match`) comparten los módulos de `src/sim/attack/` pero
  cada uno tiene su orquestador; el balón y el tiro están duplicados entre ambos. Unificar cuando entre el árbitro.
- Equilibrio del partido medido con `npm run sim`: ~8 goles por equipo, 28 tiros, 36 posesiones, 7–8 contras con
  superioridad. Superioridad: «ventaja en número» mantiene la transición; solo se anuncia con un hombre libre a tiro.
- Objeción nº 3 resuelta: a Julián le resulta cómodo pasar mientras nada en el contraataque (soltar el pad y un
  toque). Se queda así; nada de «TIRO lejos = pase largo».
- Un botón pulsado antes de que cambie el momento del juego no cuenta (gesto enganchado a su contexto).
- F3 aprobada («de momento está todo muy bien»). Julián pidió **2 periodos de 6 minutos** de marcador (4 de 8 era
  demasiado largo), con el reloj a la misma velocidad (3,2×): está en `reglas.json`; el GDD sigue diciendo 4 de 8.
  El botón del menú se llama **«Entrenamiento del jueves»**.
- Ritmo pedido por Julián tras probar la F4: transiciones rápidas y pocas pérdidas en ellas; **unas 2 de cada 3
  posesiones deben llegar al ataque en estático** (arco formado, ataque y defensa) con tiempo de posesión, y 1 de cada
  3 puede ser contra o robo. En la transición todos nadan más rápido, se roba menos y los defensores que vuelven
  reaccionan tarde a los pases (`tuning.json` → `partido.transicion`: velocidad, robo, reaccionPase). Hay un test que
  lo vigila y `npm run sim` lo mide («Posesiones que llegan al ataque en estático»).
- Reglamento contrastado en F4 con World Aquatics feb. 2026 (RFEN). Donde difería del GDD manda el reglamento: «2 m» es
  el área de gol (7,16 × 2 m) por delante de la línea del balón; tiro tapado por un defensor que sale por el fondo =
  saque de portería; el excluido también vuelve si a su equipo le dan tiro libre, saque de portería o penalti.
- El árbitro nunca inventa ni agrava: solo pita lo que clasifica `rules` (o algo más leve). El sesgo es ±12/8 % por
  punto con tope de 0,25. Hay tests de Monte Carlo (`tests/unit/arbitro.test.ts`): no romper esas bandas.
- Equilibrio F4 (`npm run sim`, 2 periodos de 6 min): ~3,5 goles por equipo, ~2 exclusiones por equipo, ~0,25 penaltis,
  superioridad ~35 % de gol, ~63 % de posesiones al estático con ~23 s de posesión.
- Solo ante el portero (`throughOnGoal`): mientras ningún defensor de campo esté más cerca de la portería que el que
  lleva el balón, el contraataque NO se asienta; puede nadar hasta `transicion.solo.cerca` (2,4 m), donde frena. En
  posicional el que lleva el balón no nada ([FIJO] 3), así que asentar antes de tiempo le deja clavado.
- Repliegue pedido por Julián: en la transición los defensores NO salen a por los atacantes al medio campo. Vuelven a su
  sitio en la defensa estática y recogen a su hombre al llegar, siempre del lado de su portería (esperan en la línea de
  recogida, ~8 m, y acompañan a ~2 m; `partido.transicion.recogida`, `colchon`, `colchonPoseedor`). Tras perder el
  balón en juego (robo, corte, rechace) tardan `reaccionPerdida` (0,6 s) en darse la vuelta: de ahí salen las contras. Faltas que provoca la IA en `tuning.json` → `partido.faltas`; árbitro en `arbitro`.
- Nadie da golpes todavía: la acción violenta existe en las reglas pero no se genera en el juego.
- Faltas en ataque (pedidas por Julián): el que recibe o aguanta el balón con un defensor encima puede empujarle
  (`partido.faltas.ataque`); pocas en general, sobre todo boyas. El rasgo **Leñador** de la hoja las multiplica
  (`partido.faltas.lenador`). A Ángel (2) se lo puse en la hoja a petición de Julián: no hardcodear jugadores en el
  código, siempre por datos. En el repositorio solo motes: nunca apellidos, ni aunque Julián los diga.
- Repetición de goles (`src/app/replay.ts`, `partido.repeticion`): graba cada paso en búferes reservados una vez y,
  tras un gol, lo reproduce con zoom y a cámara lenta; al acabar devuelve el estado exacto (hay un test que lo exige).
- Tras un gol el balón se queda dentro de la red (`keepInNet` en `src/sim/shooting/trajectory.ts`, común al partido,
  al entrenamiento y a la tanda); un tiro que no es gol acaba fuera. Hay un test con partidos reales.
- Ambiente pedido por Julián: agua y público de fondo «sin ser molesto» (Ajustes → Ambiente: normal, bajo, sin). Niveles
  medidos con un render sin altavoces: fondo ≈ −41 dBFS (−36 en una contra), efectos ≈ −32, gol nuestro ≈ −27, silbato
  ≈ −23. Si se toca, que el fondo quede siempre por debajo de los efectos. El entrenamiento no tiene público.
