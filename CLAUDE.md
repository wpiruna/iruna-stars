# Waterpolo Iruña Stars 26-27

Juego arcade de waterpolo en 2D para móvil (y PC), protagonizado por el Waterpolo Iruña 98 02.
**`docs/GDD.md` es la fuente de verdad del diseño.** Léelo antes de tocar jugabilidad.

Se trabaja por fases (GDD §21). Cada fase termina jugable, publicada y con su lista de pruebas en
`docs/PRUEBAS/Fn.md`. **No se empieza la fase siguiente sin el visto bueno de Julián.**
Fase actual: **F5 (nuestros jugadores: estadísticas, energía, banquillo y cambios, tiempos muertos, convocatoria con
fotos, gorro, porteros con Salida y rasgos)**, en curso. F0–F4 aprobadas (F4 el 20-11-2026).

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
a favor o en contra) y la fila *Energía* (cansar a los nuestros o al rival) para probar sin esperar.

Al parar servidores de prueba no usar `pkill -f` con un patrón que también aparezca en la misma orden: se mata a sí
misma. Mejor `kill` con el número de proceso.

Para probar en el navegador sin pantalla: el service worker cachea la versión anterior, así que hay que
saltárselo (DevTools: `Network.setBypassServiceWorker`) o se estará mirando un build viejo. `tools/navegador/cdp.mjs`
lo hace solo: `google-chrome --headless=new --no-sandbox --use-angle=swiftshader --enable-unsafe-swiftshader
--remote-debugging-port=9337 --user-data-dir=<carpeta temporal>` y luego
`node --experimental-websocket tools/navegador/cdp.mjs 9337 <url> <pasos.json>` (pasos: size, mobile, wait, down/up de
teclas, shot, eval). Sin tarjeta gráfica va a ~9 fps: la simulación corre más lenta que en un móvil.

Escribir en la hoja de Julián: `python3 -I tools/datos/escribir-hoja.py datos/plantilla.ods valores.json copia.ods`
cambia solo las celdas pedidas (barras 1–10 y *Rasgo* de la pestaña Jugadores, por dorsal) y conserva estilos y
desplegables; comprobar la copia con el lector del juego (`tools/datos/leer-hoja.ts`) antes de sustituir la hoja, y
mirar que no exista `datos/.~lock.plantilla.ods#` (la tiene abierta).

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
                       penaltis con el duelo de la tanda, cambios, tiempos muertos), brain.ts (IA con balón), input.ts
                       (gramática según el momento), roles.ts (repliegue, superioridad del contraataque), energy.ts
                       (energía: gasto, recuperación y efectos)
src/sim/rules/         reglamento puro: qué es cada contacto (nada, ordinaria, exclusión, penalti, violenta), área
                       de gol, tiros libres, córner o saque de portería, relojes tras exclusión
src/sim/referee/       árbitro: si pita lo clasificado (perfil, sesgo acotado, "día" por partido), tarjetas
src/app/session.ts     interfaz común de lo que se juega; play.ts (tanda y laboratorio), attack.ts (entrenamiento),
                       match.ts (partido y laboratorios de contraataque; dirige la cámara, banquillo y Emilio),
                       replay.ts (repetición), squad.ts (convocatoria guardada → jugadores, gorro)
                       convierten eventos de la simulación en imagen, sonido, vibración y HUD
src/audio/sfx.ts       efectos sintetizados con WebAudio y el ambiente (agua y público que reacciona); app/ambience.ts
                       calcula cuánto nadan para el agua
src/persist/  src/ui/ (Preact; hud.ts es el estado del marcador; components/Bench.tsx banquillo y Emilio;
              screens/SquadSetup.tsx convocatoria y gorro)  src/app/  src/debug/
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
- **Antes de cada `git push`**: `npm run typecheck` además de `npm test` (Vitest no comprueba los tipos de los tests y
  el build sí: una vez falló la publicación por eso), y la columna *Nombre* de la hoja tiene que seguir vacía. Si `npm run datos`
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
- **Pendiente**: Julián está puntuando las barras de los 19 jugadores en una página con botones
  (https://claude.ai/artifact/J6LxEjtBgqi5DNsZucuCin, colección `barras`, un documento `jugador-NN` con `valores`).
  Cuando diga «ya está»: leerla con ArtifactData, escribirla con `tools/datos/escribir-hoja.py`, `npm run datos`,
  comprobar y publicar. A Ángel (2) ya se le puso el rasgo Leñador en la hoja.
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
- Equilibrio (`npm run sim`, 2 periodos de 6 min, con energía y cambios de la IA): ~3,5 goles por equipo, ~2,5
  exclusiones por equipo, ~0,4 penaltis, superioridad ~31–35 % de gol, ~1,5 contras con superioridad, ~78 % de posesiones
  al estático con ~25 s de posesión, ~4–6 cambios desde el banquillo por equipo. `npm run sim` también da la energía.
- Vuelta rápida (pedida por Julián): sin superioridad (contada en toda la piscina) ni nadie solo ante el portero, el
  ataque se asienta en cuanto el balón cruza el medio campo (`transicion.margenMedio`) o a `segundosSinVentaja` de
  cambiar de manos. En posicional, quien está lejos de su puesto nada a ritmo de contra; el que lleva el balón nada
  solo a su puesto del arco (la IA, no el jugador: [FIJO] 3); los defensores esperan en la línea de recogida.
- Aura verde (Julián: el azul se confunde con el agua) bajo el jugador que se maneja, en ataque y en defensa.
- Zurdos siempre por la derecha del ataque (`ataque.zona.mano`); en defensa estática el cierre marca al boya rival
  (`partido.defensa.cierreAlBoya`). `assign` prueba todas las combinaciones: los costes pueden ser negativos
  (`bestMatching` también: poda con lo mínimo que pueden sumar las filas que faltan; antes podaba mal y repartía peor).
- El boya nunca llega solo a su sitio (Julián): mientras nada hacia él en el estático, nadie que vaya por detrás se lo
  queda (`cierreAlBoya.margen`; el cierre solo si no va detrás) y su defensor le acompaña por dentro, un poco por
  delante y a su ritmo de contra (`centreComingIn`, `escolta`). Escaparse en un contraataque sí puede pasar. Hay un
  test con partidos reales (antes llegaba solo el 82 % de las veces). Bajaron las contras de 2,1 a 1,6: el defensor
  del boya ya no se quedaba arriba.
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
  medidos con un render sin altavoces (OfflineAudioContext en Chrome sin pantalla, RMS): fondo en ataque estático
  ≈ −44 dBFS, −36 en una contra, efectos ≈ −32, silbato ≈ −26 (pico −23), pitido de gol ≈ −25. Si se toca, que el fondo quede siempre por debajo de los
  efectos. Excepción pedida por Julián: la **ovación** de un gol nuestro (`Sfx.ovation`: sube el murmullo de toda la
  grada unos 3 s, gritos de «¡gol!» con voces sintetizadas, silbidos y aplauso largo) va a ≈ −21 los dos primeros
  segundos y ≈ −25…−30 durante la repetición; gol rival: lamento y su afición al fondo (≈ −32). El entrenamiento no
  tiene público.
- Agua según cuánto se nada (Julián): `swimActivity` es la media de velocidades al cuadrado sobre 1,9² (≈ 1 en la contra,
  < 0,15 en el estático asentado; hay un test con partidos reales); `Sfx` la suaviza (sube en 0,3 s, baja en 1,1 s).
- Gol en partido (Julián): pitido largo del árbitro 0,3 s después y rótulo arriba (`hud.goal`, `GoalHeadline` en
  `Play.tsx`) que sustituye al marcador hasta que acaba la repetición: cromo con la foto especial (la segunda) si es
  nuestro, escudo si es del rival, «N.º GOL» si repite. El público aplaude toda la repetición. Los laboratorios
  conservan el rótulo central.
- Energía (F5, `partido.energia`, `src/sim/match/energy.ts`): en segundos reales; gasta al nadar por encima del 45 % de su
  velocidad máxima, en acelerones, entradas, lucha, tiro y contacto; recupera flotando, mucho en el banquillo, de golpe
  en el tiempo muerto y al empezar el periodo siguiente (en el descanso el banquillo enseña la energía real). Julián: un 5
  de Resistencia aguanta como mucho un periodo y llega al descanso con un 30 %. Calibrada sin cambios: Resistencia 1 →
  baja del 25 % antes del descanso; 5 → ~32 % al descanso y ~14 % al final; 10 → >60 % todo el partido. Rotaciones
  (Julián): el que sale recupera en el banquillo (del 30 % a ~90 % en ~40 s reales) y puede volver a entrar sin límite;
  la IA hace ~6 cambios por partido y en ~4 vuelve a entrar uno ya descansado. Hay test. Por debajo de la mitad: hasta −35 % de velocidad, tiro
  más flojo y desviado (modelo de tiro) y −2,5 puntos de Habilidad. Los laboratorios no gastan. Tests en
  `tests/unit/energia.test.ts`.
- Cambios (F5): los pedidos desde Pausa → Banquillo entran en la **siguiente parada** (Julián: falta, saque, fuera, gol,
  penalti, periodo, tiempo muerto) en el sitio del que sale (arcade: sin nadar a la zona de reentrada); sin límite de
  cambios. Si el balón ya está parado al cerrar el banquillo (libre sin sacar, salida antes del sprint: `Match.deadBall`)
  entran en ese momento; si el que sale está excluido, el cambio espera a la siguiente parada. Mientras esperan, aviso
  «⇄ N cambios en la próxima parada»; al hacerse, rótulo **CAMBIOS** a la derecha con «▼ SALE / ▲ ENTRA» por cada uno,
  los nuestros y los del rival (`partido.cambios.rotulo`), aparte del rótulo central para no tapar la falta. La IA cambia
  sola a los que bajan de 0,35 (`partido.cambios`); nuestros solo si Julián lo pide. Emilio grita «¡CAMBIO!» (bocadillo
  con su foto) cuando uno de los nuestros baja del 25 %. Solo jugadores de campo: el portero no se cambia.
- Tiempos muertos (F5): 2 por equipo (`reglas.json`), solo con el balón (WP); reanuda con un libre desde el medio campo
  sin reiniciar la posesión y sin devolver a los excluidos. La IA pide uno en el último minuto y medio si va empatada o
  perdiendo de 1–2. En el descanso se abre solo el banquillo con un consejo de Emilio.
- Convocatoria (F5): en el Amistoso, tras elegir rival; se guarda por ID (`save.squad`) y se completa sola si falta alguien
  (`resolveSquad`). El gorro (`settings.cap`) vale para partido, entrenamiento y tanda; el rival lleva el otro.
- Porteros (F5): Salida cuenta en tres sitios: corta pases a su área (el portero entra en `passRisk` como un cortador más,
  sin escudo del receptor y con `pase.defensor.portero.factor`; la IA evita esos pases), sale ante un tirador solo y
  cercano (+alcance, `portero.salida`) y saca en largo (su pase usa Salida en vez de Pase). Rasgos: Muro +8 % de alcance,
  Kamikaze sale 1,5 veces más y corta más, Inseguro deja entrar el 5 % de las que para (¡CANTADA!).
