# Límites y fragmentos

Zintl trata la traducción como un problema de empaquetado. Todo lo que sigue se deriva de ahí.

## El proceso

```
tu código ──▶ extractor ──▶ compilador ──▶ plugin + runtime
              (qué hay)     (qué va         (qué carga
                             junto)          el navegador)
```

El **extractor** lee tu fuente con un analizador y reporta lo que encuentra. Nunca modifica archivos y no lleva conocimiento de ningún framework — el comportamiento de React, Vue y Svelte llega como configuración.

El **compilador** decide qué va junto: construye el grafo de límites, divide los catálogos en fragmentos, compila la gramática y mantiene las traducciones unidas a las cadenas mientras esas cadenas cambian.

El **plugin y el runtime** conectan todo eso con tu herramienta de compilación y tu navegador.

## Anclas y límites

Una llamada a `zintl(locale)` es un **ancla de confianza**: el punto en el que tu aplicación decide en qué idioma está.

Desde cada ancla, Zintl recorre las importaciones alcanzables y reúne todas las cadenas que podrían aparecer. Ese conjunto es un **límite**, y un límite se convierte en un fragmento de catálogo.

```
src/main.ts        zintl(locale) ──┐
  └─ Header.tsx                    ├──▶ un límite, un fragmento
     └─ Nav.tsx                  ──┘

src/admin.ts       zintl(locale) ──┐
  └─ Charts.tsx                    ├──▶ un límite distinto
                                 ──┘
```

Cada ancla es independiente. Una llamada a `zintl()` anidada dentro de una función es su propio límite con su propio ciclo de carga — deliberadamente no hereda nada de lo que esté por encima, así que lo que se carga es previsible y no accidental.

La recompensa: quien abre tu página de ajustes descarga las traducciones de los ajustes. No todas.

## Por qué no un único diccionario

El enfoque habitual es un solo objeto con todas las cadenas, cargado de entrada. Es simple, y significa que quien lee tu página de aterrizaje descarga traducciones de pantallas que nunca verá. Ese coste crece con tu aplicación y permanece invisible hasta que es grande.

Fragmentar las traducciones siguiendo los límites que tu empaquetador ya usa hace que ambos sean coherentes: las traducciones de una ruta cargada de forma diferida llegan con esa ruta.

## La identidad se basa en el contenido

Un límite se identifica por un hash de lo que contiene, no por la ruta de la que vino. Mueve un archivo y el límite sigue siendo el mismo límite.

Por eso refactorizar no te cuesta después un día de reconciliar catálogos, y es una restricción que el propio código se impone: cualquier cosa que ate la identidad de una traducción a una ruta de archivo o a un número de línea es una regresión.

## La extracción es estructural

Zintl no extrae cadenas sueltas; extrae **unidades de significado**. Las plantillas literales, los fragmentos JSX y el HTML se cosen primero en piezas lógicas, de modo que:

- una frase repartida entre etiquetas sigue siendo una frase traducible,
- los valores interpolados se convierten en marcadores estables en vez de ruido posicional,
- el mismo fragmento produce la misma clave allí donde aparezca.

Ese último punto es lo que permite que las traducciones sobrevivan a los refactores. El titular de este mismo sitio es una única clave que contiene dos `<span>`, porque es una sola frase.

## Facetas

El soporte de frameworks, el SSR, el manejo de recursos y la integración con el empaquetador son piezas componibles separadas llamadas **facetas**, resueltas al construir el compilador en vez de repartidas como condicionales por dentro.

Añadir un framework o una herramienta de compilación significa aportar una faceta, no editar el núcleo. Que dos facetas reclamen la misma extensión es un error inmediato, no un silencioso «gana la última».

Rsbuild es la prueba de esa afirmación. Corre sobre Rspack, cuyo modelo de plugins es todo lo distinto del de Rollup que puede ser un empaquetador, y alcanzó la paridad sin una sola rama específica de Rspack en el compilador.

## Y ahora

| Para                   | Lee                                       |
| :--------------------- | :---------------------------------------- |
| Buscar un término      | [Glosario](/concepts/glossary)            |
| Ver todas las opciones | [Configuración](/reference/configuration) |
