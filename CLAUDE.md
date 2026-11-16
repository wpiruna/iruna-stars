# Waterpolo Iruña Stars 26-27

Juego arcade de waterpolo en 2D para móvil (y PC), protagonizado por el Waterpolo Iruña 98 02.
**`docs/GDD.md` es la fuente de verdad del diseño.** Léelo antes de tocar jugabilidad.

Se trabaja por fases (GDD §21). Cada fase termina jugable, publicada y con su lista de pruebas en
`docs/PRUEBAS/Fn.md`. **No se empieza la fase siguiente sin el visto bueno de Julián.**
Fase actual: **F1 (tiro y portero) terminada y publicada**; pendiente del visto bueno de Julián para empezar F2
(ataque posicional). F0 aprobada.

Publicado en <https://wpiruna.github.io/iruna-stars/> desde el repositorio público `wpiruna/iruna-stars`.
Cada push a `main` convierte los datos, pasa los tests, compila y publica (`.github/workflows/publicar.yml`).

## Comandos

| Comando | Qué hace |
|---|---|
| `npm run dev` | Convierte los datos y arranca Vite (recarga al cambiar código o JSON). |
| `npm run datos` | Hoja + `assets/` → JSON de `data/`, imágenes optimizadas, iconos e `INFORME_DATOS.md`. |
| `npm run rivales -- --regenerar <id>` | Rehace la plantilla guardada de un rival (`--todos` para todas). |
| `npm test` | Vitest. |
| `npm run typecheck` | `tsc --noEmit`. |
| `npm run build` | datos → tipos → web (`dist/`) → HTML único (`dist/waterpolo.html`) → control de peso. |
| `npm run preview` | Sirve `dist/` en `http://localhost:4173/iruna-stars/`. |

Depuración: `F3` o `º`, `?debug=1` en la dirección, o cinco toques sobre la línea de versión del menú.
`?pantalla=datos&pestana=equipo` abre una pantalla directamente (`laboratorio`, `penaltis&rival=<id>`, `tanda`,
`ajustes`…); `?carga=16` multiplica la escena de la portada.

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
src/input/             mando virtual (teclado, mando, táctil) y reconocedor de gestos
src/render/            agua (shader), piscina y porterías, cámara, jugadores, balón, efectos
src/app/play.ts        sesión de juego: sim → eventos → imagen, sonido, vibración y HUD
src/audio/sfx.ts       efectos sintetizados con WebAudio
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
- Pendiente de decidir en F3 con pruebas: cómo pasar mientras se nada en contraataque.
- F1 probada por Julián en móvil y teclado: el tiro, la barra, el portero y el pad flotante le gustan tal
  como están. No retocar `data/tuning.json` (tiro, portero, penalti) sin motivo.
- En la tanda juega el portero real aunque tenga las barras vacías; el provisional solo si no hay ninguno.
