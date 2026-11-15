# PROMPT MAESTRO — Waterpolo Iruña Stars 26-27

> Documento para Claude Code en **modo planificación**. Es a la vez el encargo y el documento de diseño del juego (GDD).

---

## 0. Cómo debes trabajar con este documento

1. **Ahora mismo solo planificas. No escribas código.** Lee el documento entero y devuélveme un plan de implementación con el contenido descrito en la sección 24.
2. **Preguntas:** hazme como máximo 5, y solo las que bloqueen el plan. Para todo lo demás elige un valor razonable, apúntalo como suposición en el plan y sigue.
3. **Criterio propio:** si una decisión de este documento perjudica la jugabilidad o es técnicamente desproporcionada, dímelo y propón una alternativa. No la sigas a ciegas. Lo que está marcado como **[FIJO]** no se cambia sin consultarme.
4. **Cuando apruebe el plan**, el primer paso será:
   - guardar este documento como `docs/GDD.md`, que será la fuente de verdad del diseño;
   - crear un `CLAUDE.md` corto con comandos, estructura de carpetas, convenciones y las reglas [FIJO].
5. **Trabajo por fases** (sección 21). Cada fase termina con algo jugable, publicado en la versión web y en el HTML único, y con una lista de pruebas para mí. No empieces la fase siguiente sin mi visto bueno.

---

## 1. Visión y principios

**Nombre del juego [FIJO]:** ***Waterpolo Iruña Stars 26-27***. Nuestro equipo es el **Waterpolo Iruña 98 02**.

**Norte del proyecto:** *un Super Sidekicks de waterpolo protagonizado por el Waterpolo Iruña 98 02.* Super Sidekicks es la referencia del **espíritu** (inmediatez, rótulos enormes, ritmo de recreativa), no del aspecto. El acabado es **2D moderno y vistoso** (sección 16), como hizo Windjammers 2 con el original de Neo Geo. Salen nuestros jugadores reales, nuestros rivales reales de la Copa de Euskal Herria, árbitros reales y Emilio, el presidente del club.

**Jerarquía de prioridades [FIJO]** (cuando dos cosas choquen, gana la de arriba):
1. Divertido de controlar.
2. Fácil de entender.
3. Que se reconozca como waterpolo.
4. Que tenga profundidad.
5. Que respete el reglamento.

**Principio de control [FIJO]:** *la IA controla la estructura; el jugador toma las decisiones.*
- El waterpolo **no** es fútbol acuático. En ataque organizado los jugadores ocupan una estructura estable y el juego se decide con pases, entradas, juego con el boya, lucha por la posición y tiros.
- Por eso el usuario **no conduce nadadores** durante el ataque posicional. Decide dónde va el balón, quién entra y cuándo se tira.
- Durante las transiciones (contraataque y repliegue) sí se nada con el pad.

**Lo que tiene que sentir el jugador:** *"no controlo a un nadador, controlo el ataque"*. Tiene que poder decir *"pásasela al 7"* y que eso tenga sentido en pantalla.

---

## 2. Plataforma y tecnología

- **Entrega [FIJO]:** un mismo build genera dos salidas.
  1. **Versión web publicada en GitHub Pages.** Es el canal principal para los móviles: se abre con un enlace y se puede añadir a la pantalla de inicio como app instalable (PWA), con `manifest`, icono, arranque a pantalla completa en horizontal y *service worker* para jugar sin conexión.
  2. **Un único archivo `waterpolo.html` autocontenido** (código, datos e imágenes en base64), para abrirlo en un PC sin conexión ni servidor.
- **Dispositivos [FIJO]:**
  - **Móvil en horizontal** es el objetivo principal (pad táctil más dos botones).
  - **Teclado** en PC.
  - **Mando** en PC (Gamepad API): mandos de Xbox y PlayStation.
  - En vertical aparece una pantalla de **"gira el móvil"**. En Android se pide pantalla completa al empezar a jugar; en iPhone se consigue al abrirlo desde la pantalla de inicio.
- **Stack recomendado:**
  - TypeScript, **PixiJS** (dibuja con WebGL, necesario para los efectos de agua y partículas en móvil), Vite y `vite-plugin-singlefile` para la versión de un único HTML.
  - Si propones otra opción, justifícala pensando en el rendimiento en móvil, el peso del build y el control fino de la física y la IA.
- **Gráficos:**
  - **Nada de pixel-art de baja resolución.** Todo se dibuja con código (formas vectoriales, degradados, partículas y filtros), porque es lo que se puede hacer bien sin un dibujante. El arte externo se limita a las imágenes que aporto yo (sección 19).
  - Resolución lógica orientativa de 1280×720, escalada a la pantalla y nítida en pantallas de alta densidad (densidad de píxeles limitada a 2 para no penalizar el rendimiento).
  - Objetivo de 60 fps en un móvil de gama media.
  - **Calidad adaptativa** con 3 niveles: si los fps bajan de forma sostenida, se reducen solos partículas, filtros y reflejos. También se puede elegir el nivel en ajustes.
- **Simulación:**
  - Paso fijo de 60 Hz, con render interpolado.
  - RNG con semilla, para poder reproducir situaciones al depurar.
- **Persistencia:** `localStorage` para la Copa en curso, el historial, los récords, el álbum y los ajustes.
- **Datos fuera del código [FIJO]:** no edito JSON a mano. Relleno mis datos en una **hoja de cálculo** (`datos/plantilla.xlsx`) y un conversor genera los JSON de `/data` (sección 18). El código va en inglés; todo lo que veo yo (pestañas, columnas, mensajes) va en español.
- **Validación:** los datos se validan con esquemas (por ejemplo zod). Cada error se explica en español señalando la pestaña, la fila y la columna de la hoja, del tipo *"Jugadores, fila 7: Velocidad = 12 no es válida; se usa 5"*. **Un error nunca rompe el juego:** el valor erróneo se cambia por uno por defecto, o la fila se sustituye por un dato provisional.
- **Nombre en todas partes:** *Waterpolo Iruña Stars 26-27* es el título de la web, de la pantalla de título y de la app instalada. El nombre corto bajo el icono del móvil es *Iruña Stars*.
- **Propiedad intelectual [FIJO]:** nada de sprites, música, fuentes ni logotipos de SNK, Super Sidekicks u otros juegos. La estética es inspirada, pero todo tiene que ser original o tener licencia libre (por ejemplo, fuentes con licencia OFL, incluidas en el build).

---

## 3. Estructura del juego

### 3.1 Modos
1. **Copa de Euskal Herria** (modo principal): eliminatorias **Cuartos → Semifinal → Final**. Si pierdes, quedas eliminado.
2. **Amistoso:** eliges rival, árbitro y gorro.
3. **Tanda de penaltis:** es el modo rápido y el primer prototipo jugable.

### 3.2 Flujo de la Copa
1. **Convocatoria inicial.** Es lo primero al empezar una Copa nueva. De la plantilla completa se eligen **6 jugadores de campo + 1 portero + 4–5 suplentes** (la cifra se configura). Cada jugador aparece en una rejilla con su foto, dorsal, mote, puesto y sus barras.
2. **Sorteo y cuadro de la Copa.** Se ve el cuadro completo y nuestro equipo se coloca en un cruce.
3. **Presentación del partido:** ronda (CUARTOS DE FINAL…), con NUESTRO ESCUDO **VS** ESCUDO RIVAL, nombres y nivel.
4. **Informe de Emilio** (sección 14): su foto y un consejo sobre ese rival.
5. **Árbitro designado:** su foto, su nombre y una frase según su perfil (*"Hoy va a haber que andar con cuidado…"*).
6. **Revisar convocatoria.** Llega rellenada con la anterior y se puede cambiar después de oír a Emilio.
7. **Elección de gorro:** ⚪ blanco con número azul, o 🔵 azul con número blanco. El rival lleva el otro.
8. **Partido.**
9. **Final del partido:** marcador, estadísticas y MVP.
   - **Victoria:** celebración y animación del cuadro avanzando hasta el siguiente rival.
   - **Derrota:** pantalla GAME OVER con estadísticas y una frase graciosa.
   - **Campeones:** celebración grande y entrada en el historial.
10. Los demás cruces del cuadro se **simulan**: resultado verosímil según el nivel de cada equipo, con algo de azar.
11. Un **empate** en una eliminatoria se resuelve con **tanda de penaltis**: 5 lanzadores por equipo y después muerte súbita.

La Copa en curso se guarda entre partidos, para poder salir y volver.

---

## 4. El partido: estados de juego

Implementa una máquina de estados explícita. Es la columna vertebral del juego.

| Estado | Cuándo | Qué pasa |
|---|---|---|
| `SPRINT_INICIAL` | Al empezar cada periodo | Los equipos salen desde su línea de gol y el balón está en medio campo. Un nadador de cada equipo se lo disputa machacando HABILIDAD, con su Velocidad como base. Quien llega primero se queda la posesión. |
| `TRANSICION` | Tras robo, parada, rebote, cambio de posesión, saque rápido o sprint | Se nada por el campo. Contraataque para un equipo y repliegue para el otro. |
| `POSICIONAL` | Cuando se asienta el ataque | Los jugadores ocupan sus puestos automáticamente y el pad pasa a servir para pasar. |
| `SUPERIORIDAD` / `INFERIORIDAD` | Mientras hay una exclusión vigente | Es una variante del posicional con formaciones específicas (sección 9). |
| `BALON_PARADO` | Falta ordinaria, saque de portería, córner, reanudación tras gol | Recolocación rápida y saque. Es el momento en que entran los cambios. |
| `PENALTI` | Falta de penalti | Minijuego de lanzador contra portero. |
| `CELEBRACION_GOL` | Tras un gol | Animación y reanudación desde medio campo por el equipo que ha encajado. |
| `FIN_PERIODO` / `DESCANSO` / `TIEMPO_MUERTO` | — | Se abre el menú de banquillo y aparece un consejo de Emilio. |
| `FIN_PARTIDO` / `TANDA_PENALTIS` | — | — |

**Paso de transición a posicional** (los valores son iniciales y se ajustan probando):
- el poseedor está a menos de unos 8 m de la portería rival y no hay ventaja numérica clara; **o**
- han pasado unos 4 s desde que cruzó el medio campo; **o**
- todos los defensores han llegado a su zona.

Un contraataque con superioridad momentánea (2x1, 3x2…) **se mantiene en TRANSICION** hasta que se resuelve.

**Paso de posicional a transición:** cuando cambia la posesión, ya sea por robo, parada con blocaje, rebote rival o fin del tiempo de posesión.

**Cambio de función del pad:** debe ser fluido y llevar un aviso visual sutil, por ejemplo un icono del pad que cambia de ⇄ a ✋.

---

## 5. Controles

### 5.1 Hardware
- **Móvil:**
  - **Pad flotante:** aparece donde se apoya el pulgar en la mitad izquierda de la pantalla, con 8 direcciones y zona muerta. En ajustes se puede cambiar a pad fijo.
  - Abajo a la derecha, **[HABILIDAD]** y **[TIRO]**, grandes, semitransparentes y con un área táctil mayor que el dibujo. Arriba, un botón pequeño de pausa y banquillo.
  - **No hay más botones permanentes [FIJO]**, salvo que las pruebas demuestren que son imprescindibles.
  - Multitáctil real: pad y botones a la vez sin interferencias. Sin zoom, sin selección de texto y sin gestos del navegador durante el partido.
  - En los ajustes se puede invertir el lado del pad y de los botones (zurdos) y cambiar su tamaño.
  - Vibración opcional en tiros, goles y exclusiones, en los móviles que la permiten (los iPhone no la admiten desde el navegador).
- **Teclado:** flechas o WASD para el pad, `J`/`Z` para HABILIDAD, `K`/`X` para TIRO y `Esc`/`P` para la pausa.
- **Mando:** stick izquierdo o cruceta para el pad, botón inferior (A / ✕) para TIRO, botón izquierdo (X / □) para HABILIDAD y Start para la pausa.
- Los mensajes de ayuda muestran los controles del dispositivo que se está usando (táctil, teclado o mando).
- Las direcciones son **relativas a la pantalla**: ↑ significa "hacia arriba en la pantalla".

### 5.2 Gramática única de controles [FIJO]
Es la regla que tiene que hacer el control intuitivo en cualquier estado:
- **Toque corto del pad** (umbral inicial de unos 180 ms) = **elegir**: pasar en ataque, cambiar de defensor en defensa.
- **Mantener el pad** = **nadar** en transición. En ataque posicional, mantener muestra el destino del pase y al soltar se pasa.
- **HABILIDAD** = la acción especial según el contexto: escapada, entrada, robo o bloqueo.
- **TIRO** = lanzar cuando tienes el balón, y entrar al contacto cuando defiendes.

### 5.3 Tabla completa

| Situación | Pad: toque | Pad: mantener | HABILIDAD | TIRO |
|---|---|---|---|---|
| **Contraataque con balón** | Pase en esa dirección | Nadar con el balón, más lento que sin él | Acelerón o escapada, que gasta energía | Toque: tiro rápido. Mantener: tiro cargado |
| **Ataque posicional con balón** | Pase en esa dirección | Previsualiza flecha + Nº y al soltar se pasa. Volver al centro cancela | **Toque sin dirección:** escapada, protección o giro del poseedor. **Mantener + dirección:** ordena una **entrada** al compañero de esa zona; si es el boya, **lucha por la posición** | Toque: tiro rápido. Mantener: tiro cargado |
| **Ataque, siendo el boya el poseedor** | Pase hacia fuera (*kick-out*) | Previsualiza el pase | Girarse o buscar la falta, que puede provocar una exclusión | Toque: rosca o barrido. Mantener: giro y tiro |
| **Repliegue** (defensa en transición) | Cambiar al defensor de esa dirección | Nadar con el defensor seleccionado | Acelerón | Contacto, que puede ser falta táctica |
| **Defensa posicional** | Cambiar al defensor de esa dirección | Desplazar un poco al defensor seleccionado para ayudar, flotar sobre el boya o cerrar una línea de pase. La IA lo recoloca al soltar | Contextual: **robo** si estás pegado al poseedor, **interceptación** si estás en la línea de pase, **bloqueo** (brazo arriba) si el tirador se está armando | Toque: contacto leve (sujetar). Mantener: contacto fuerte (agarrar o hundir), que frena más pero arriesga más sanción |
| **Penalti a favor** | — | Apuntar mientras cargas | — | Cargar y soltar |
| **Penalti en contra** | Dirección de la estirada del portero en el momento del tiro | — | — | — |

**Secuencia típica en posicional:** mantener HABILIDAD y pulsar → (el compañero de la derecha empieza su entrada), soltar HABILIDAD, tocar → (pase adelantado a la entrada), y TIRO para el tiro de primeras.

**Control y balón:** el control **sigue al balón**. En ataque siempre manejas al poseedor. En defensa el sistema selecciona automáticamente al defensor del poseedor (en repliegue, al más cercano al balón), y tú puedes cambiarlo con un toque de pad. Opción en ajustes: cambio automático activado o desactivado.

---

## 6. Ataque

### 6.1 Puestos (terminología española)
- **Boya** (center, 2 metros): se coloca delante de la portería, lucha por la posición, recibe, provoca exclusiones y finaliza de cerca.
- **Extremos** izquierdo y derecho (wings): junto a la línea de 2 m, abiertos a los lados de la portería. Tiran con ángulo cerrado.
- **Laterales** izquierdo y derecho (flats/drivers): en la segunda línea, a unos 5–6 m. Hacen la mayoría de entradas y tiros exteriores.
- **Cierre** (point): el más alejado y central. Organiza, tira de lejos y es el primero en volver a defender.
- **Portero:** gorro rojo, según el reglamento.

Los **zurdos** se colocan preferentemente en el lado derecho del ataque, porque desde ahí tienen mejor ángulo de tiro. La IA asigna los puestos según el `puesto` de cada jugador, su mano y su arquetipo.

### 6.2 Formaciones (`data/formaciones.json`)
Las coordenadas están en metros respecto a la portería atacada:
- `x` es la distancia desde la línea de gol;
- `y` es el desplazamiento lateral desde el eje de la portería, positivo hacia la izquierda del atacante;
- la portería mide 3 m, así que los postes están en y = ±1,5.

Son valores iniciales y hay que ajustarlos jugando.

**Ataque base 3-3 (igualdad numérica):**

| Puesto | x | y |
|---|---|---|
| Boya | 2,0 | 0 |
| Extremo izq. | 2,0 | +4,5 |
| Extremo der. | 2,0 | −4,5 |
| Lateral izq. | 5,5 | +5,0 |
| Lateral der. | 5,5 | −5,0 |
| Cierre | 6,5 | 0 |

**Superioridad 4-2 (6 contra 5), que es la formación por defecto:** una línea de 4 en los 2 m y una línea de 2 a unos 5 m.

| Puesto | x | y |
|---|---|---|
| Poste izq. | 2,0 | +1,8 |
| Poste der. | 2,0 | −1,8 |
| Extremo izq. | 2,0 | +5,0 |
| Extremo der. | 2,0 | −5,0 |
| Exterior izq. | 5,0 | +2,5 |
| Exterior der. | 5,0 | −2,5 |

**Superioridad 3-3:** es una variante a la que se llega rotando desde la 4-2, cuando un jugador de la línea delantera sube a la trasera. Tiene tres jugadores en los 2 m y tres por fuera, dos a unos 4–5 m y uno más alejado. Es mucho menos frecuente que la 4-2, así que se usa como rotación ocasional o según el estilo del equipo.

### 6.3 Posicionamiento automático
- Cada jugador tiene un **puesto**, una **zona** alrededor del punto de su formación (no una coordenada exacta), una **posición actual** y un **objetivo**.
- La IA mueve al jugador con suavidad hacia su objetivo, con inercia de agua, separación entre compañeros y pequeños ajustes para abrir una línea de pase o evitar a su defensor.
- Cuando termina una acción (una entrada, una lucha de posición…), el jugador **vuelve a su zona**. Si otro ha ocupado su sitio, se reorganizan intercambiando puestos.
- **Regla de 2 m:** los atacantes sin balón no deben quedarse dentro de los 2 m rivales por delante del balón. La IA lo evita, y el motor de reglas lo pita si ocurre.
- **Bloqueos (picks):** son opcionales y los hace la IA sola. Un compañero se cruza para frenar al defensor del que entra o del boya.

### 6.4 Selección inteligente del receptor [FIJO]
Cuando el usuario pulsa una dirección **no** se elige al compañero que está matemáticamente en esa dirección. Se puntúa a cada candidato dentro de un cono de unos ±50° según:
- coincidencia angular con la dirección pulsada;
- distancia;
- **línea de pase abierta** (defensores cerca del trayecto y tiempo que tardan en interceptar);
- si el receptor está marcado o libre;
- su papel: si está haciendo una entrada, recibe pase adelantado; si es el boya, recibe un pase especial;
- el riesgo de interceptación.

Gana el candidato **más razonable**. Si no hay nadie en el cono, se amplía a 90°. Si sigue sin haber nadie, no se pasa y aparece un ✖ breve. Nunca se pasa al propio portero salvo que se apunte claramente hacia él.

**Tipo de pase automático** (sin botones adicionales):
- **Pase seco** a la mano: si el receptor está libre, permite tiro de primeras.
- **Pase mojado** al agua, al lado contrario de su defensor: para el boya y para jugadores marcados.
- **Pase adelantado** al espacio: para el que está entrando.
- **Pase largo:** en contraataque o desde el portero.

La calidad del pase depende de la estadística Pase. Un pase arriesgado se marca en la previsualización con colores: verde, ámbar o rojo.

### 6.5 Entradas (drives)
Se ordenan con **HABILIDAD + dirección** sobre el compañero de esa zona. No son una simple carrera. Cada entrada tiene:
- un **punto de inicio**;
- una **trayectoria** calculada por la IA, que busca el *agua interior* (ganar el lado de la portería a su defensor) hacia el palo o el centro según su puesto, la posición del balón y el espacio libre;
- una **duración** y un **resultado** que depende de lo que hace el atacante (Velocidad, Habilidad, energía) frente al defensor (Defensa, Velocidad, energía y atención de la IA).

Resultados posibles:
- **Se queda libre:** aparece **"¡LIBRE!"** sobre él y se abre una ventana corta para el pase adelantado.
- **Arrastra al defensor:** abre espacio para otro, por ejemplo el boya.
- **Provoca una exclusión:** el defensor lo agarra o lo hunde y el árbitro decide.
- **Falla:** vuelve a su zona.

Mientras dura la entrada se muestra una flecha sutil con su trayectoria.

### 6.6 Boya
- **Lucha por la posición** (HABILIDAD + dirección hacia el boya): gana o pierde posición frente a su defensor según su Habilidad y su energía frente a la Defensa y la Agresividad del rival. Si está bien colocado, aumentan las probabilidades de recibir, provocar una exclusión, girarse y tirar. Si está mal colocado, aumentan las de perder el balón, sufrir un robo, cometer falta en ataque o que intercepten el pase.
- **Recepción:** tiene una animación propia y llega casi siempre con pase mojado.
- **Con el balón:**
  - TIRO toque: **rosca o barrido** (*sweep*);
  - TIRO mantener: **giro y tiro**;
  - HABILIDAD: **buscar la falta o la exclusión**;
  - pad: pase hacia fuera.
- Provocar exclusiones en el boya es la vía principal para conseguir superioridades, igual que en el waterpolo real.

### 6.7 Tiro
- **Toque de TIRO = tiro rápido.** No hay subida: sale al instante, con menos potencia, y la precisión depende de la estadística. Es el tiro para el boya, después de una entrada o de primeras tras un pase seco.
- **Mantener TIRO = tiro cargado.** El jugador **se eleva del agua** (se le ve más torso en el sprite) y aparece una barra que se va llenando:
  - la **zona óptima** está hacia el 70–85 % de la barra y su anchura depende de la Precisión;
  - si sueltas antes, el tiro sale con menos potencia;
  - si sueltas en la zona óptima, sale con potencia alta y la mejor precisión;
  - si te pasas, sale con potencia máxima pero con una dispersión creciente que puede mandarlo fuera;
  - la velocidad máxima del balón depende de la Potencia;
  - mientras cargas, los defensores pueden **bloquear** y el reloj de posesión sigue corriendo.
- **Dirección del pad al soltar el tiro cargado:**
  - ↑ o ↓ (perpendicular al eje de la portería en pantalla): palo de arriba o palo de abajo;
  - **hacia la portería: tiro a bote** (*skip shot*);
  - **hacia atrás: vaselina**;
  - las diagonales combinan las dos cosas (bote o vaselina hacia ese palo);
  - sin dirección, el jugador busca el mejor hueco según su Precisión.
- **El tipo de tiro cambia según el puesto:**
  - boya: cerca, giro, rosca;
  - extremo: ángulo cerrado;
  - lateral: exterior o tras entrada;
  - cierre: lejano.
- **Desenlaces:** gol; parada con blocaje (posesión del portero y TRANSICION); parada con rechace (balón suelto); poste; fuera (saque de portería); córner (si lo toca por último un defensor o el portero antes de salir por la línea de gol).

---

## 7. Defensa

- La IA mantiene la defensa sola. Cada defensor tiene un **atacante asignado**, una **posición defensiva** (siempre en el *agua interior*, entre su atacante y la portería), una **distancia objetivo** y una **intensidad**.
- **Estilos de defensa** según el equipo:
  - **presión individual**;
  - **zona**: los exteriores se hunden para ayudar sobre el boya, al estilo de la "zona M".
- **Defensa del boya:** el defensor se coloca **delante** (para negar el pase) o **detrás** (para no conceder el giro), según el estilo y la situación. El cierre o los laterales pueden ayudar.
- **Ayudas y cambios de marca** cuando hay entradas o bloqueos.
- **El usuario** controla al defensor seleccionado según la tabla 5.3. Las decisiones importantes son suyas: presionar, robar, bloquear, cerrar líneas de pase, a quién marcar más y cuándo arriesgar con el contacto.
- **Robar o interceptar siempre tiene riesgo:** si fallas, te quedas atrás y el atacante gana ventaja.
- **Contacto:**
  - sobre el **poseedor**: puede causar pérdida de balón o una falta ordinaria;
  - sobre un **atacante sin balón** (sobre todo el boya o el que entra): agarrar, hundir o tirar hacia atrás suele ser **exclusión**;
  - dentro de los **6 m**, sobre un tirador en posición clara: **penalti**.
  
  La probabilidad de que el árbitro lo pite la decide la sección 13.
- **Aviso de peligro:** cuando un jugador **estrella** rival recibe el balón, aparece sobre él un pequeño ⚠️. Es lo que da sentido a los consejos de Emilio.

---

## 8. Transiciones

### 8.1 Contraataque
- Hay hasta tres **carriles** (centro y bandas) y dos **oleadas**: la primera es la de los más rápidos; la segunda es la de apoyo y el jugador de seguridad.
- El portero puede iniciarlo con un **pase largo**, según su estadística Salida.
- El usuario nada con el poseedor (pad mantenido) y pasa con un toque. La IA de los compañeros busca ventaja, se abre en carriles y pide el pase adelantado.
- Si se detecta superioridad momentánea, aparece **"¡CONTRA 2x1!"** (o 3x2) y la cámara gana velocidad.
- **Velocidad y Resistencia mandan:** un jugador agotado no llega.

### 8.2 Repliegue
- Al perder el balón, todos vuelven por dentro hacia su portería. El cierre, o el más retrasado, protege la portería.
- El primero en llegar marca al atacante más peligroso o más adelantado. El resto se reparte por cercanía y se pasa a marcaje individual al llegar al posicional.
- Así aparecen de forma natural situaciones de **3x2, 4x3 y 5x4**.
- **Falta táctica:** un contacto para frenar un contraataque es posible, pero se arriesga a una exclusión según el reglamento y el árbitro.

---

## 9. Superioridad e inferioridad

- **Exclusión de un rival (6x5):** el equipo atacante pasa automáticamente a **4-2** y puede rotar a **3-3**. El usuario no recoloca a nadie. Solo pasa (los pases rápidos son la clave), ordena entradas o rotaciones con HABILIDAD + dirección y tira.
  - La defensa rival intenta cerrar líneas de pase y bloquear tiros.
  - Aparece **"¡SUPERIORIDAD!"** y un contador de exclusión encima de la zona de reentrada.
- **Exclusión nuestra (5x6):** la IA monta la defensa de inferioridad:
  - protege los postes;
  - los defensores levantan el brazo ante los tiradores exteriores;
  - el defensor más cercano al tirador tapa un lado de la portería y el portero cubre el otro;
  - la defensa bascula hacia el balón y deja libre al tirador menos peligroso.
  
  El usuario intenta bloquear, interceptar y forzar tiros difíciles. Esta fase **se tiene que sentir claramente distinta** del juego normal.
- **El excluido** nada hasta la zona de reentrada, junto a su línea de gol, y vuelve cuando se cumple el tiempo de exclusión, cuando hay gol o cuando su equipo recupera el balón.

---

## 10. Porteros

- Los controla la IA, con estadísticas propias: **Reflejos** (reacción y alcance ante tiros rápidos), **Colocación** (cubrir el ángulo y defender vaselinas y botes) y **Salida** (cortar pases al boya y en contraataques, y pase largo para iniciar la contra).
- **Modelo de parada:** compara la velocidad del tiro y la distancia del balón al alcance del portero con sus Reflejos y su Colocación, y tiene en cuenta si hay defensores tapando y su energía. Nunca hay parada ni gol garantizados: los límites van entre el 5 % y el 95 %.
- **Rasgo opcional:** 🧤 *MURO* (para mucho), 🧤 *KAMIKAZE* (sale mucho y corta contras), 🧤 *INSEGURO* (bueno, pero con una probabilidad baja de cantada memorable).
- El usuario solo controla al portero en **penaltis y tandas**: elige la dirección de la estirada en el momento del tiro.

---

## 11. Jugadores: estadísticas, energía y cambios

### 11.1 Estadísticas (escala 1–10, que son las que meto yo)

| Estadística | Qué provoca en el juego |
|---|---|
| **Velocidad** | Velocidad máxima de nado y aceleración. Pesa en contraataques, repliegues, entradas y el sprint inicial. |
| **Resistencia** | Lo rápido que se gasta la barra de energía y lo rápido que se recupera. |
| **Potencia** | Velocidad del balón al tirar y alcance del pase largo. |
| **Precisión** | Anchura de la zona óptima de la barra de tiro y dispersión del tiro: más probabilidad de que vaya donde se apunta en vez de fuera o al portero. |
| **Pase** | Precisión y velocidad del pase, y menor riesgo de que lo intercepten. |
| **Habilidad** | Mantener el balón, regatear, escaparse, girarse, ganar la lucha por la posición y resistir robos. |
| **Defensa** | Robar, interceptar, bloquear y seguir al atacante en las entradas. |
| **Agresividad** | Frecuencia e intensidad del contacto. Más agresividad frena más al rival, pero aumenta la probabilidad de falta, exclusión, penalti o tarjeta cuando hay contacto. Es un dilema, no una ventaja pura. |

Los **porteros** tienen además Reflejos, Colocación y Salida.

**Reglas de diseño:**
- convierte el 1–10 en modificadores con curvas suaves;
- ningún atributo garantiza ni imposibilita nada;
- las diferencias entre jugadores **se tienen que notar a simple vista**: un tirador de 9 lanza misiles y un nadador de 9 se escapa de todos.

**Arquetipo** (opcional en mis jugadores, obligatorio en los rivales generados): Boya, Defensor, Lanzador, Extremo, Organizador, Velocista, Todoterreno o Portero. Se usa para asignar puestos, generar rivales coherentes y redactar los informes de Emilio.

### 11.2 Energía
- Cada jugador tiene una barra de 0 a 100.
- **Se gasta** al nadar fuerte, con los acelerones, las entradas, la lucha por la posición, al subirse a tirar y en los contactos.
- **Se recupera** poco a poco en el posicional, rápido en el banquillo y algo en descansos y tiempos muertos.
- Por debajo del 50 % la velocidad baja de forma progresiva (orientativo: hasta −35 % con la barra a 0), y la precisión y la habilidad bajan algo.
- Un jugador con mucha resistencia aguanta el partido entero. Uno con poca empieza fuerte y se va apagando.
- En el agua solo se ve una barrita pequeña bajo el jugador seleccionado. Las barras completas están en el menú de banquillo.

### 11.3 Cambios
- **Menú BANQUILLO** (desde pausa): eliges quién sale y quién entra. El cambio se aplica en el **siguiente balón parado**. Los cambios volantes reales por la zona de reentrada quedan como opción de `reglas.json`.
- Emilio grita **"¡CAMBIO!"** en un bocadillo cuando un jugador baja del 25 % de energía.
- Los rivales hacen sus cambios solos, según la energía de sus jugadores.
- Hay 2 tiempos muertos por equipo. Abren el banquillo y un consejo de Emilio.

### 11.4 Rasgos y tiro especial (opcionales, para la fase de personalidad)
- **Rasgo:** como máximo uno por jugador y con modificadores pequeños:
  - 🚀 MISIL: más potencia;
  - 🧲 IMÁN: recupera más rebotes;
  - 🏊 DIÉSEL: gasta menos energía;
  - 🌀 REGATEADOR: más difícil de robar;
  - 😈 LEÑADOR: contacto más eficaz y más faltas;
  - 🧠 CEREBRO: mejores decisiones de la IA y mejores pases.
- **Tiro especial con nombre propio** (por ejemplo, "El Cañonazo"): se activa con la **barra de racha** llena (que sube con robos, paradas y goles) manteniendo TIRO más tiempo. Tiene una animación exagerada al estilo Neo Geo y un empuje de potencia y precisión.

---

## 12. Reglas (motor de reglas configurable)

- Crea un módulo `rules` **puro y testeable**, separado del árbitro:
  - las reglas deciden **qué es sancionable y de qué tipo**;
  - el árbitro decide **si lo pita** (sección 13).
- **Todos los valores van en `data/reglas.json`.** No codifiques reglas en el código.
- Los valores por defecto son los del **reglamento vigente de World Aquatics** (cambios en vigor desde junio de 2025 y versión de febrero de 2026), adaptados al arcade.
- **No uses la antigua regla de los 7 m.**
- Más adelante ajustaré los valores a la normativa concreta de nuestra Copa.

**Valores por defecto:**
- **Campo:** 25 × 20 m, con portería de 3 m de ancho. Líneas de 2 m, 5 m, 6 m y medio campo.
- **Partido:** 4 periodos de 8 minutos (en el marcador). Hay 2 tiempos muertos por equipo.
- **Tiempo de posesión:**
  - 28 s en la primera posesión;
  - 18 s en la segunda posesión del mismo equipo (por ejemplo, tras recuperar el rebote de un tiro en poste o larguero), tras un córner y tras un penalti sin cambio de posesión;
  - tras una exclusión se pone a 18 s, salvo que queden más.
  
  Si se agota, la posesión pasa al rival.
- **Falta ordinaria:** se concede tiro libre en el sitio de la falta.
  - **Si el balón está fuera de los 6 m, se puede tirar directo a portería sin demora.**
  - Si la falta fue dentro de los 6 m, hay que pasar, aunque el jugador puede salir nadando de los 6 m y tirar desde fuera.
  - Una falta del defensor dentro del área de gol se saca desde la línea de 2 m.
- **Exclusión:** dura **18 s** de juego. El excluido vuelve antes si hay gol o si su equipo recupera el balón.
- **Faltas personales:** las exclusiones y los penaltis cuentan como faltas personales. Con **3**, el jugador queda fuera el resto del partido y entra un sustituto cuando termina la exclusión.
- **Falta de penalti:** se pita dentro de los **6 m** cuando una falta impide un gol probable o cuando se impide por detrás a un jugador que está tirando. **El penalti se lanza desde la línea de 5 m.**
- **Mala conducta o tarjeta roja:** expulsión el resto del partido. En caso de **brutalidad**, el sustituto entra tras **4 minutos** de juego efectivo.
- **Tarjetas** (configurable):
  - **modo `arcade`** (por defecto, como lo he pedido): **amarilla** como aviso al jugador por contacto muy agresivo, y **roja** como expulsión definitiva;
  - **modo `reglamento`**: la amarilla es para el banquillo (por ejemplo, Emilio protestando, con su gracia), y la roja para mala conducta o brutalidad.
- **Regla de 2 m:** es falta ordinaria que un atacante esté dentro de los 2 m rivales por delante del balón.
- **Córner:** si el balón sale por la línea de gol tocado por último por un defensor o por el portero, se saca desde la marca de 2 m en el lateral. Si lo tocó por último un atacante, es saque de portería.
- **Reanudación tras gol:** desde medio campo, por el equipo que ha encajado.
- **Empate en una eliminatoria:** tanda de penaltis.
- **Tiempo arcade:** los relojes **muestran los valores del reglamento** (8:00, 28, 18), pero corren más deprisa con factores configurables. Valores iniciales:
  - el reloj de partido pasa unos 3,2 s de marcador por cada segundo real, así que un periodo dura unos 2:30 reales;
  - los relojes de posesión y exclusión van a unos 1,6× (28 s de marcador son unos 17 s reales).
  
  Se ajustan jugando.

**Verificación:** antes de cerrar la fase de reglas, contrasta los valores con el reglamento oficial (referencias en la sección 23) y marca en `reglas.json` la versión usada.

---

## 13. Árbitros

- Cada árbitro (pestaña **Árbitros** de la hoja) tiene:
  - nombre y foto;
  - **tolerancia al contacto**, **propensión a exclusiones** y **propensión a tarjetas** (todas 1–10);
  - **sesgo**, de −3 (a favor nuestro) a 0 (neutro) y hasta +3 (muy en contra nuestro);
  - **regularidad** (1–10, cuánto azar hay en sus decisiones);
  - frases de presentación.
- **Cada contacto genera un evento:** tipo de contacto, intensidad, zona, si el contactado tiene el balón y la situación de tiro.
- **El motor de reglas** clasifica la acción: nada, falta ordinaria, exclusión, penalti o roja.
- **El árbitro decide si la pita** con una probabilidad que combina:
  - la base de ese tipo de acción;
  - la intensidad;
  - la Agresividad del infractor;
  - su tolerancia;
  - la zona;
  - **su sesgo según qué equipo comete la falta**;
  - un ruido que depende de su regularidad.
- **El sesgo** multiplica las probabilidades de sanción contra nuestro equipo y reduce un poco las del rival (orientativo: +12 % y −8 % por punto de sesgo). Tiene límites para que el juego **parezca un árbitro que pita todo y no un juego que hace trampas**.
- **Coherencia [FIJO]:**
  - un jugador muy agresivo que entra al contacto con un árbitro estricto debe acumular exclusiones, y el jugador tiene que poder aprender *"con este árbitro y este jugador tengo que defender de otra forma"*;
  - cada sanción muestra un rótulo corto con el motivo: AGARRÓN, HUNDIR, POR DETRÁS, BRAZOS…;
  - suena el silbato.
- La **ventaja** (dejar seguir si el atacante está mejor) es opcional y va en una fase posterior.
- **Designación:** aleatoria en cada partido entre los árbitros activos, sin repetir árbitro en la misma Copa mientras haya otros disponibles.

---

## 14. Emilio y la presentación previa

- **Emilio** (presidente del club) aparece con su foto antes de cada partido, en los tiempos muertos y en el descanso.
- **Informe del rival**, generado automáticamente a partir de las estadísticas del rival y del árbitro:
  - ⚠️ **Jugador clave:** el número y una descripción según su arquetipo y su mejor estadística (*"Nº 7, lanzamiento potentísimo"*).
  - ⚠️ **Segundo peligro** (*"Nº 2, muy rápido al contraataque"*).
  - 💡 **Clave del partido**, según el estilo del rival y el perfil del árbitro (*"No les dejéis correr. Y con este árbitro, nada de agarrones."*).
- Las frases salen de plantillas con variables en `data/textos/emilio.json`. Puedo **sobrescribir** los consejos sobre un rival concreto con frases mías (columna *Consejo de Emilio* de la pestaña Equipos, o pestaña Frases).
- Los jugadores estrella señalados por Emilio son los que llevan el ⚠️ al recibir el balón (sección 7). **Su consejo tiene que servir de verdad para defender.**

---

## 15. Equipos rivales

- **En la pestaña Equipos de la hoja defino yo** cada equipo: nombre, siglas de 3 letras, **nivel** (1–10), **estilo** (defensivo, rápido, lanzadores, físico, equilibrado o de estrellas), si juega la Copa y, si quiero, un consejo propio de Emilio. Su escudo es `assets/escudos/<id>.png`.
- **Generación de plantillas:** escribe un script que genere la plantilla de cada rival **una sola vez**, con una semilla sacada del ID del equipo, y la guarde en `data/generado/rivales/<id>.json`. Así el Nº 7 de un rival es siempre el mismo. Solo se regenera si lo pido.
- **Rivales reales:** los jugadores que ponga en esa pestaña sustituyen a los generados con el mismo dorsal. Lo que deje vacío se toma del jugador generado.
  - **13 jugadores** (11 de campo y 2 porteros), con dorsales, motes genéricos y arquetipos coherentes con el estilo.
  - **Estrellas según el nivel:** a más nivel, más jugadores buenos y menos mediocres. Orientativo:
    - nivel 1–3: 0–1 estrellas;
    - nivel 4–6: 1–2;
    - nivel 7–8: 2–3;
    - nivel 9–10: 3–4.
    
    Las estrellas tienen 2–3 estadísticas en 8–10 según su arquetipo. El resto se mueve alrededor del nivel del equipo, con su perfil.
- **El estilo cambia la IA, no solo las estadísticas:**
  - agresividad en transición;
  - presión o zona;
  - distancia de tiro preferida;
  - uso del boya;
  - frecuencia de contacto;
  - velocidad de circulación.
- **Dificultad global** (Fácil, Normal o Difícil): cambia los tiempos de reacción y la calidad de las decisiones de la IA rival. No cambia el sesgo arbitral.

---

## 16. Presentación visual y sonido

**Estilo: arcade moderno en 2D.** Es limpio, colorido y con mucho movimiento y efectos. Tiene que verse espectacular en un móvil actual y seguir siendo ligero. La sensación de recreativa la dan el ritmo, los rótulos y los efectos, no la baja resolución.

- **Piscina horizontal** vista desde arriba con una ligera inclinación. Lleva:
  - líneas de colores (2 m, 5 m, 6 m y medio campo) y corcheras;
  - porterías con red que se mueve al recibir un gol;
  - zonas de reentrada;
  - **relojes de posesión dibujados en las esquinas, como en las piscinas reales**.
- **El agua es la protagonista visual:**
  - reflejos de luz animados en el fondo de la piscina (cáusticas) y calles visibles bajo el agua;
  - ondas alrededor de cada jugador, estelas al nadar, salpicaduras en tiros, paradas y contactos;
  - **sombra del balón en el fondo**, separada del balón según su altura. Así se distingue a simple vista una vaselina de un tiro a bote, y el bote deja su salpicadura en el agua;
  - un ligero efecto de distorsión del agua (filtro de desplazamiento), que se desactiva en calidad baja.
- **Efectos de impacto:**
  - pausa de unos pocos fotogramas al soltar un tiro fuerte;
  - temblor de pantalla al dar en el poste o en una parada fuerte;
  - estela en los tiros muy potentes;
  - cámara lenta breve y red moviéndose en los goles;
  - destellos y partículas en las paradas.
  
  Todo en dosis cortas, que nunca estorben la lectura del juego.
- **Cámara:**
  - sigue al balón adelantándose a la jugada;
  - se abre en el posicional para que se vea la estructura entera;
  - va más dinámica en el contraataque;
  - en los tiros hace un zoom rápido y una cámara lenta breve si es gol.
- **Jugadores en el agua, dibujados con código:**
  - vistos desde arriba: gorro, hombros y brazos, con una parte del cuerpo bajo el agua algo distorsionada;
  - animaciones sencillas pero expresivas: brazada al nadar, pataleo al estar parado, **subida del cuerpo y brazo armado al cargar el tiro**, brazo arriba al bloquear, forcejeo en los contactos;
  - **el NÚMERO del gorro, grande y legible, identifica a cada jugador [FIJO]**: gorro blanco con número azul, azul con número blanco, y rojo para los porteros;
  - el jugador controlado lleva un anillo de color en el agua;
  - **las fotos reales solo aparecen fuera del agua**: convocatoria, rótulo de gol, Emilio, árbitro, MVP, ¡EXPULSADO! y álbum.
- **Cromos:** cada jugador se presenta como un **cromo** con foto, dorsal, mote, puesto y barras. Se usa en la convocatoria, el MVP y el álbum. Los retratos de estilo noventero que aporto encajan como un guiño retro deliberado dentro del acabado moderno.
- **Una o dos fotos por jugador:**
  - la **primera** (por orden alfabético del nombre de archivo) es la principal: cromo, convocatoria y banquillo;
  - la **segunda**, si existe, se usa en los momentos especiales: rótulo de gol, MVP, ¡EXPULSADO! y reverso del cromo en el álbum;
  - si solo hay una, se usa para todo.
- **Pantalla de título:** logotipo **WATERPOLO IRUÑA STARS 26-27** generado con código, con tipografía deportiva y efecto de agua. Si pongo un logo en `assets/logo/logo.png`, se usa ese.
- **Presentación de retransmisión deportiva:**
  - marcador como el de la televisión, con escudos, siglas, goles, periodo y reloj;
  - entradas de equipo con los escudos deslizándose ("CUARTOS DE FINAL", VS);
  - rótulos inferiores para el informe de Emilio y el árbitro;
  - transiciones de pantalla rápidas y con estilo.
- **Tipografía:** de deporte, en negrita e itálica, legible en un móvil. Lleva licencia libre y va incluida en el build.
- **HUD mínimo:**
  - el marcador descrito arriba;
  - previsualización del pase (flecha y Nº con color de riesgo);
  - flecha de la entrada;
  - "¡LIBRE!";
  - ⚠️ sobre las estrellas;
  - contador de exclusión;
  - barra de tiro.
  
  **No saturar la pantalla.**
- **Rótulos arcade grandes y animados:** ¡GOL!, ¡CONTRA!, ¡EXCLUSIÓN!, ¡SUPERIORIDAD!, ¡PENALTI!, 🟥 ¡ROJA!, y **¡EXPULSADO!** con el cromo tachado cuando un jugador llega a 3 faltas personales.
- **Rendimiento:** los efectos tienen que caber en el presupuesto de 60 fps en un móvil de gama media gracias a la calidad adaptativa (sección 2). Si un efecto no cabe, se simplifica: **la jugabilidad va antes que el adorno**.
- **Sonido:** efectos generados con WebAudio: silbato (imprescindible), chapoteo, poste, red, público, bocina de fin de periodo. Música original sencilla o ninguna al principio.

---

## 17. Capa de personalidad (fases finales)

- **Celebraciones de gol** por jugador (configurables) y celebración especial para el **gol de la victoria**.
- **Estadísticas al final del partido:** goles, tiros, tiros a puerta, exclusiones, posesión, contraataques, penaltis y paradas, más el ⭐ **MVP**.
- **Historial de la Copa:** copas, finales, semifinales, victorias y derrotas. **Récords:** máximo goleador, más exclusiones, más paradas, mayor goleada y mayor remontada.
- **Momentos legendarios** detectados automáticamente: REMONTADA IMPOSIBLE, CAÑONAZO EN EL ÚLTIMO SEGUNDO, BAÑO DE SANGRE (muchas exclusiones)…
- **Álbum de la Copa:** las fotos de nuestro equipo y, al enfrentarte a un rival, sus fichas quedan desbloqueadas.
- **Humor interno** con las frases de la pestaña Frases de la hoja (que se convierten en `data/textos/humor.json`), más unas por defecto: frases de jugadores, bocadillos del banquillo ("¡Estoy solo!"), reacciones, rivalidades y eventos especiales. Todo editable sin tocar código.
- **Racha y nervios** (opcional y suave): una racha positiva da una pequeña mejora temporal; ir perdiendo por mucho aumenta un poco los errores. No debe ser determinante.

---

## 18. Datos

### 18.1 La hoja de cálculo es la fuente de mis datos [FIJO]

Relleno mis datos en una hoja de cálculo que guardo en el repositorio como `datos/plantilla.xlsx`.

**Pestañas y columnas.** Las cabeceras son exactamente estas:
- **Jugadores:** Activo, Dorsal, Mote, Nombre, Puesto, Mano, Velocidad, Resistencia, Potencia, Precisión, Pase, Habilidad, Defensa, Agresividad, Reflejos, Colocación, Salida, Arquetipo, Rasgo, Tiro especial, Tipo de tiro especial, Celebración, Frase, Fotos.
- **Equipos:** Activo, ID, Nombre, Siglas, Nivel, Estilo, En la Copa, Consejo de Emilio, Archivo de escudo.
- **Rivales reales:** Activo, ID del equipo, Dorsal, Mote, Puesto, Mano, las 8 barras, Reflejos, Colocación, Salida, Rasgo.
- **Árbitros:** Activo, ID, Nombre o apodo, Tolerancia al contacto, Exclusiones, Tarjetas, Sesgo, Regularidad, Frase de presentación, Archivo de foto.
- **Ajustes:** filas de *Ajuste* y *Valor*:
  - nombre y siglas del club, archivo de su escudo;
  - nombre y foto del presidente;
  - nombre de la competición;
  - suplentes, minutos por periodo, duración real del periodo, posesión, segunda posesión, exclusión y modo de tarjetas.
  
  Un valor vacío deja el de `reglas.json` o el provisional.
- **Frases:** Tipo, Para, Frase. *Para* es el ID de un equipo o de un árbitro, o el dorsal de un jugador; vacío vale para cualquiera. Admite `{rival}`.
- **Instrucciones** y **Ayuda** son solo para mí: el conversor las ignora.

**Valores:**
- Las barras van del 1 al 10 y pueden llegar como número o como texto.
- El sesgo llega como texto (de "-3 Muy a favor" a "+3 Muy en contra"): se toma el número del principio.
- *Activo* vacío cuenta como Sí.
- Los desplegables van en español (Boya, Extremo…).
- Las columnas *Fotos* y *Archivo* son fórmulas de ayuda para mí. **El conversor busca las imágenes él mismo**, sin fiarse del valor guardado:
  - **jugadores: por el dorsal.** En `assets/jugadores/`, cada archivo cuyo nombre **empieza por el dorsal** (`01`, `02`… o `1`, `2`…, seguido de algo que no sea un número) es una foto de ese jugador. El resto del nombre es libre: `01_larry.jpg`, `01 larry celebrando.png`. Cada jugador puede tener una o dos fotos (sección 16). Si hay más de dos, se usan las dos primeras y el informe lo avisa;
  - equipos y árbitros: el ID en minúsculas;
  - formatos admitidos: PNG, JPG y WebP, sin distinguir mayúsculas en la extensión.

**Lectura tolerante:** las columnas se buscan por su nombre, sin importar mayúsculas, tildes ni orden. Se ignoran las columnas desconocidas y las filas vacías.

**Conversor:**
- `npm run datos` lee la hoja, la valida, la fusiona con los datos provisionales (18.2) y escribe los JSON de `/data`.
- Se ejecuta solo en cada build y en cada publicación automática.
- **Los JSON generados no se editan a mano.** `reglas.json` y `formaciones.json` sí son archivos del proyecto: la pestaña Ajustes solo sobrescribe algunos de sus valores.

**Informe:** cada conversión genera `data/INFORME_DATOS.md` y lo muestra en consola. Dice cuántos datos son reales y cuántos provisionales, qué imágenes faltan, qué filas tenían errores y qué se ha hecho con ellas.

**Actualizar los datos no necesita a Claude Code:** sustituyo `datos/plantilla.xlsx` o añado imágenes en `assets/` y lo subo al repositorio. La publicación automática (GitHub Actions) convierte, compila y publica.

### 18.2 Datos provisionales y sustitución progresiva [FIJO]

El juego tiene que programarse y jugarse completo **desde la F0 sin ningún dato mío**, e ir sustituyendo lo inventado por lo real según lo voy añadiendo.

**Paquete provisional** en `data/provisional/`, versionado en git y con datos claramente inventados (nombres que no coincidan con clubes ni personas reales):
- **nuestro equipo:** se llama **Waterpolo Iruña 98 02** (siglas provisionales `IRU` hasta que ponga otras en Ajustes), con 13 jugadores inventados (11 de campo con todos los puestos y perfiles variados, y 2 porteros);
- **10 equipos rivales** con niveles de 2 a 9 y todos los estilos;
- **4 árbitros:** neutro, estricto, permisivo y "en contra";
- **presidente:** "Emilio" (o el nombre que ponga en Ajustes), con una silueta;
- **frases por defecto** para todos los tipos.

**Reglas de fusión:**
- **Nuestro equipo:** entran todos mis jugadores activos.
  - Si no llegan al mínimo para una convocatoria completa (orientativo: 13 jugadores con 2 porteros), se completan con provisionales con dorsales libres, empezando por los puestos que falten.
  - Cada jugador real que añado retira a un provisional.
  - Los provisionales llevan la marca "PROVISIONAL" en su cromo.
- **Rivales de la Copa:** los equipos activos con *En la Copa = Sí*, hasta 7. Si hay menos, se completan con provisionales. En los amistosos se ofrecen todos mis equipos activos y, mientras tenga menos de 7, también los provisionales.
- **Jugadores de los rivales:** se generan como dice la sección 15, y los de *Rivales reales* los sustituyen por dorsal.
- **Árbitros:** los míos que estén activos. Si no hay ninguno, los provisionales.
- **Club y Ajustes:** cada valor vacío toma el provisional o el de `reglas.json`.
- **Celdas vacías:** toman un valor por defecto (5 en las barras, Diestro, el puesto que más falte en la plantilla…).
- **Filas desactivadas o borradas:** desaparecen, y el hueco vuelve a rellenarse con un provisional.

**Imágenes:**
- Si existe el archivo esperado, se usa. Las fotos que no son cuadradas se recortan a cuadrado en el build, centradas en la parte de arriba (donde suele estar la cara), y se optimizan.
- Una foto de un dorsal que no está en la hoja no se usa, pero aparece en el informe para que sepa que sobra o que falta su fila.
- Si no, se genera con código un placeholder **que encaje con el estilo visual**: cromo con silueta y dorsal, escudo con las siglas y colores derivados del ID, silueta de árbitro o de presidente.
- Nunca se muestra una imagen rota.

**Partidas guardadas robustas:**
- La Copa en curso, el historial, los récords y el álbum guardan los IDs y una copia de nombres y resultados.
- Si los datos cambian entre sesiones, nada se rompe. Una Copa en curso cuyo rival ha desaparecido se reinicia con un aviso, y el historial conserva los nombres que tenía.

**Pantalla "Datos del juego"** (en el menú, dentro de Extras): lista qué es real y qué es provisional, y qué fotos y escudos faltan. Así sé qué me queda por aportar.

### 18.3 Carpetas y JSON generados

```
/datos
  plantilla.xlsx         mi hoja de cálculo, la fuente de mis datos
/data                    lo genera `npm run datos`, salvo reglas y formaciones
  equipo.json            nuestro equipo, ya fusionado con los provisionales
  equipos.json           rivales
  arbitros.json          árbitros
  copa.json              participantes, rondas y designación arbitral
  reglas.json            motor de reglas (sección 12), archivo del proyecto
  formaciones.json       formaciones y coordenadas (sección 6.2), archivo del proyecto
  /textos                emilio.json, humor.json, textos.es.json
  /provisional           paquete de datos inventados (18.2)
  /generado/rivales      plantillas generadas de los rivales (versionadas en git)
  INFORME_DATOS.md       informe de la última conversión
/assets
  /jugadores   01_larry.jpg, 01_larry_2.jpg, 02_….png   (empiezan por el dorsal; 1 o 2 por jugador)
  /logo        logo.png   (opcional)
  /emilio      emilio.png
  /arbitros    <id>.png
  /escudos     <id>.png y nuestro.png
```

Formato orientativo de los JSON generados (nombres y valores ficticios):

```json
// equipo.json
{
  "id": "nuestro", "nombre": "Waterpolo Iruña 98 02", "siglas": "IRU",
  "escudo": "assets/escudos/nuestro.png",
  "jugadores": [
    {
      "dorsal": 7, "nombre": "Nombre", "mote": "PEPE",
      "fotos": ["assets/jugadores/07_pepe.png", "assets/jugadores/07_pepe_gol.jpg"],
      "puesto": "lateral", "mano": "zurdo", "arquetipo": "lanzador",
      "stats": { "velocidad": 6, "resistencia": 5, "potencia": 9, "precision": 7,
                 "pase": 6, "habilidad": 6, "defensa": 5, "agresividad": 4 },
      "rasgo": "misil",
      "tiroEspecial": { "nombre": "El Cañonazo", "tipo": "potencia" },
      "celebracion": "puno_arriba",
      "frases": ["¡Dámela!"]
    },
    {
      "dorsal": 1, "nombre": "Nombre", "mote": "MURO", "puesto": "portero",
      "fotos": ["assets/jugadores/01_muro.jpg"], "mano": "diestro",
      "stats": { "velocidad": 4, "resistencia": 6, "potencia": 5, "precision": 5,
                 "pase": 7, "habilidad": 5, "defensa": 6, "agresividad": 3 },
      "statsPortero": { "reflejos": 8, "colocacion": 7, "salida": 5 },
      "rasgo": "muro"
    }
  ]
}
```

```json
// equipos.json
[{ "id": "rival1", "nombre": "Club Rival", "siglas": "RIV",
   "escudo": "assets/escudos/rival1.png", "nivel": 7, "estilo": "fisico",
   "jugadoresReales": [], "consejosEmilio": [] }]
```

```json
// arbitros.json
[{ "id": "arb1", "nombre": "Nombre Apellido", "foto": "assets/arbitros/arb1.png",
   "toleranciaContacto": 3, "exclusiones": 8, "tarjetas": 6,
   "sesgo": 2, "regularidad": 5,
   "frases": ["Hoy va a haber que andar con cuidado..."] }]
```

```json
// copa.json
{ "nombre": "Copa de Euskal Herria",
  "participantes": ["nuestro", "rival1", "...hasta 8"],
  "sorteo": "aleatorio", "rondas": ["Cuartos de final", "Semifinal", "Final"],
  "designacionArbitros": "aleatoria", "empate": "penaltis" }
```

```json
// reglas.json (extracto)
{ "version": "World Aquatics 2025/26 adaptado", "modoTarjetas": "arcade",
  "campo": { "largo": 25, "ancho": 20, "porteriaAncho": 3,
             "lineas": { "dosMetros": 2, "penalti": 5, "seisMetros": 6 } },
  "partido": { "periodos": 4, "minutosMarcador": 8, "tiemposMuertos": 2 },
  "posesion": { "primera": 28, "segunda": 18, "trasExclusion": 18, "trasCorner": 18 },
  "exclusion": { "segundos": 18, "faltasPersonalesMax": 3, "brutalidadMinutos": 4 },
  "tiroDirectoFueraDe": 6, "penaltiDesde": 5,
  "velocidadRelojes": { "partido": 3.2, "posesion": 1.6, "exclusion": 1.6 },
  "convocatoria": { "campo": 6, "porteros": 1, "suplentesMin": 4, "suplentesMax": 5 },
  "cambios": { "volantes": false },
  "tandaPenaltis": { "lanzadores": 5, "muerteSubita": true } }
```

---

## 19. Material que aporto yo

- **Fotos de los jugadores**, ya pasadas a estilo arcade: **una o dos por jugador** en `assets/jugadores/`, con un nombre que **empieza por el dorsal** (`01` es Larry, el portero; luego `02`, `03`…). Mejor cuadradas, de al menos 512 px y con un encuadre parecido.
- **Foto de Emilio** y, si puedo, **fotos de los árbitros**.
- **Escudos y nombres** de todos los equipos.
- **Datos:** la hoja `datos/plantilla.xlsx`, con plantilla, equipos, rivales reales, árbitros, ajustes y frases (sección 18.1).

**Mientras no los tenga:** se usan los datos provisionales y los placeholders automáticos (sección 18.2), para que nada se bloquee. El build **redimensiona y optimiza** las imágenes (orientativo: retratos de 512 px para los cromos y escudos de 256 px) para que la web y el HTML no pesen demasiado.

---

## 20. Herramientas de desarrollo y pruebas

- **Capa de depuración** (con una tecla y desactivada en el build final). Muestra:
  - el estado de la máquina;
  - el estado de la IA de cada jugador;
  - la puntuación de los candidatos a pase;
  - las probabilidades del árbitro en cada contacto;
  - la energía;
  - los fps.
- **Modo laboratorio:** cargar situaciones concretas (2x1, 3x2, 6x5, penalti, boya contra defensor, entrada) para ajustar sin jugar un partido entero.
- Semilla de RNG fija opcional y recarga de los JSON sin recompilar durante el desarrollo.
- **Tests unitarios** (por ejemplo con Vitest) para:
  - el motor de reglas (relojes, reinicios de posesión, exclusiones, 3 faltas personales, penaltis, córners);
  - el árbitro;
  - el selector de receptor;
  - el generador de rivales (determinista con semilla);
  - el conversor de la hoja y la fusión con los provisionales: sin hoja, hoja vacía, hoja a medias, valores erróneos, filas desactivadas y columnas en otro orden;
  - el cuadro de la Copa y la simulación de cruces.
- **Cada fase** entrega:
  - `npm run build`, que genera la versión web y `dist/waterpolo.html`;
  - la **versión web publicada** en GitHub Pages, para probarla en móviles reales con un enlace;
  - una **lista de pruebas manuales** para mí: en móvil (Android y iPhone, desde el enlace y desde la pantalla de inicio) y en PC (teclado y mando).

---

## 21. Fases de desarrollo

Cada fase tiene que ser jugable. Si el núcleo de una fase **no es divertido, se itera antes de seguir**.

**Ninguna fase depende de que yo haya aportado datos reales:** todas se prueban con el paquete provisional y con lo que yo haya añadido hasta ese momento.

| Fase | Contenido | Criterio de aceptación |
|---|---|---|
| **F0. Base** | Proyecto, build doble (web instalable y HTML único), publicación automática en GitHub Pages, conversor de la hoja, paquete provisional, fusión, informe de datos, placeholders, pantalla "Datos del juego", capa de depuración, calidad adaptativa, pantalla de "gira el móvil", `CLAUDE.md` y `docs/GDD.md`. | El juego se abre desde el enlace en el móvil, se puede añadir a la pantalla de inicio y arranca a pantalla completa en horizontal. El HTML se abre sin conexión en el PC. Sin hoja o con la hoja vacía funciona con datos provisionales. Si añado un jugador a la hoja y la subo, aparece en el juego tras la publicación automática, sin tocar código. |
| **F1. Tiro y portero** | Piscina, física del agua, cámara, pad táctil, botones y teclado, un tirador contra el portero (IA), tiro rápido y cargado con dirección (palos, bote, vaselina). **Modo Tanda de penaltis** jugable. | Tirar es satisfactorio en móvil. Potencia y Precisión se notan. El portero no es ni un muro ni un coladero. |
| **F2. Ataque posicional** | 6 contra 6 con defensa IA básica, formación 3-3, posicionamiento automático, selector inteligente de receptor con previsualización, tipos de pase, entradas con HABILIDAD + dirección, boya (lucha por la posición, recepción, rosca y giro), escapada del poseedor. | Se puede montar un ataque de pase, entrada, pase y tiro sin pensar en los controles. El pad nunca pasa a quien no esperas. |
| **F3. Transiciones y defensa** | Máquina de estados completa, contraataque y repliegue, regla de toque o mantener, defensa del usuario (cambio de defensor, robo, interceptación, bloqueo, contacto), sprint inicial, reloj de posesión, saques, córners, reanudación tras gol, partido completo de 4 periodos. | Un partido entero contra la IA se juega de principio a fin. El cambio entre transición y posicional se siente natural. |
| **F4. Reglas y árbitro** | Motor de reglas configurable, faltas ordinarias, tiro directo desde fuera de los 6 m, exclusiones con zona de reentrada, superioridad 4-2/3-3 e inferioridad automáticas, penaltis, 3 faltas personales, tarjetas, perfiles de árbitro con sesgo y rótulos de motivo. | Las sanciones se entienden. La superioridad y la inferioridad se sienten distintas. Un árbitro "en contra" se nota sin parecer trampa. |
| **F5. Nuestros jugadores** | Estadísticas reales aplicadas, energía, menú de banquillo y cambios, Emilio gritando "¡CAMBIO!", tiempos muertos, convocatoria con fotos, elección de gorro, porteros con estadísticas y rasgos. | Cada compañero se reconoce por cómo juega. El banquillo importa. |
| **F6. Copa de Euskal Herria** | Rivales generados y guardados, estilos de IA, cuadro con sorteo, simulación de cruces, presentación, informe de Emilio, árbitro designado, tanda en caso de empate, final, campeón y GAME OVER, guardado de la Copa en curso. | Se puede jugar una Copa entera, con un rival distinto en cada ronda. Los consejos de Emilio sirven. |
| **F7. Personalidad y pulido** | Celebraciones, estadísticas y MVP, historial y récords, momentos legendarios, álbum, `humor.json`, rasgos y tiro especial, racha, sonido, efectos de agua, rótulos y transiciones de pantalla. | El equipo quiere jugarlo y picarse con los récords. |

---

## 22. Fuera de alcance (por ahora)

- Multijugador online.
- Dos jugadores en local (quizá más adelante en PC).
- Liga completa.
- Voces reales.
- Editor de datos dentro del juego (los datos se editan en los JSON).
- 3D.

**Posibles ampliaciones:** enlazarlo desde la web del equipo, repeticiones de gol y modo liga.

---

## 23. Glosario y referencias

| Español | Inglés / técnico |
|---|---|
| Boya | Center, 2-meter, hole set |
| Extremo | Wing |
| Lateral | Flat, driver |
| Cierre | Point |
| Entrada | Drive |
| Lucha por la posición del boya | Post-up, posición en los 2 m |
| Bloqueo | Pick, screen |
| Pase seco / pase mojado | Dry pass / wet pass |
| Agua interior | Inside water |
| Superioridad / inferioridad | Power play, 6v5 / man-down, 5v6 |
| Exclusión | Exclusion, ejection |
| Zona de reentrada | Re-entry area |
| Tiro a bote / vaselina / rosca | Skip shot / lob / sweep shot |
| Sprint inicial | Swim-off |

**Reglamento:**
- World Aquatics Competition Regulations, parte de waterpolo: https://www.worldaquatics.com/rules/competition-regulations
- Traducción de la RFEN del reglamento (febrero de 2026): https://cdn.rfen.es/sectionFiles/1776320617_4603.pdf

---

## 24. Qué debe contener tu plan

1. **Resumen** de lo que has entendido, en 10 líneas como máximo.
2. **Preguntas bloqueantes** (máximo 5) y **suposiciones** que tomas.
3. **Arquitectura:** módulos y responsabilidades (input, máquina de estados, física, IA ofensiva y defensiva, selector de pase, motor de reglas, árbitro, render, cámara, UI y pantallas, datos, persistencia, audio) y cómo se comunican.
4. **Estructura de carpetas** del proyecto y del build.
5. **Esquemas de datos** definitivos, con validación.
6. **Diseño técnico** de los puntos críticos:
   - la gramática de controles (detección de toque o mantener en pad táctil y teclado);
   - el algoritmo del selector de receptor;
   - el modelo de entradas;
   - el modelo de tiro y parada;
   - el modelo de contacto y árbitro;
   - las transiciones entre estados.
7. **Plan por fases** según la sección 21, con tareas, criterios de aceptación y pruebas manuales de cada fase.
8. **Riesgos** (rendimiento de los efectos en móvil, legibilidad con 14 jugadores en pantalla, controles táctiles en Android e iPhone, peso del build, equilibrio de la IA) y cómo los vas a mitigar.
9. **Qué necesitas de mí** y en qué fase lo necesitas.
