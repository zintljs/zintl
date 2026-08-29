# Traducir

Dónde están los catálogos, quién los edita y qué los mantiene honestos.

## Dónde aparecen

Un archivo por archivo fuente y por idioma, dentro de `outputDir` — `zintl/` si no lo cambias:

```
zintl/
  src/
    App.vue.ar.json
    App.vue.fr.json
  .schemas/
    src/App.vue.schema.json
```

Dividirlos por archivo fuente es para quien los edita: quien abre `Checkout.vue.fr.json` ve las cadenas de una pantalla, no las de todo el producto. No tiene nada que ver con cómo se fragmentan los catálogos para el navegador — eso sigue tu grafo de importaciones, no tu árbol de directorios.

No hay archivo para tu idioma de origen. Nunca se escribe, porque el compilador ya tiene esas cadenas y un archivo de `{"clave": "clave"}` es una carga de mantenimiento disfrazada de datos.

## El esquema que los acompaña

Cada catálogo apunta a un JSON Schema generado, así que un editor con soporte de esquemas ofrece a los traductores autocompletado, validación y — allí donde dejaste una [`@zintl-note`](/reference/comment-directives) — la nota que explica qué significa la cadena.

Vale más de lo que parece. «Open» es un verbo o un adjetivo según la pantalla, y un traductor sin contexto tiene que adivinar.

## Editarlos

Son JSON corriente. Rellena los valores:

```json
{
  "Welcome back!": "¡Bienvenido de nuevo!",
  "Settings": "Ajustes"
}
```

Todo lo que dejes vacío hace fallar la compilación. De eso se trata.

## Cuando cambia el original

Edita una cadena en inglés y sus traducciones la siguen, siempre que ambas sean reconociblemente la misma frase. Zintl compara el texto anterior con el nuevo y arrastra la traducción cuando se parecen lo suficiente — `similarityThreshold` decide cuánto, y bajarlo es más permisivo.

Mueve el archivo, renombra el componente, reorganiza el directorio: no se pierde nada. La identidad se basa en el contenido y no en la ruta, así que las traducciones están unidas a las palabras y no al lugar donde vivían.

Borra una cadena y sus entradas desaparecen, salvo que desactives `prune`.

## Llevarlos a otro sitio

Los catálogos son JSON, así que la mayoría de las herramientas pueden leerlos directamente. Cuando un sistema de traducción quiere XLIFF, Zintl lo exporta e importa — llevando consigo el contexto que el grafo conoce de cada cadena, que una exportación de clave y valor tira a la basura.

> [!NOTE]
> Una importación es una compuerta, no una fusión: lo que vuelve se contrasta con lo que el compilador sabe, en lugar de aceptarse y escribirse por encima.

## Recursos localizados

Parte del contenido no es una cadena dentro de un componente — una página de prosa, un diagrama, un PDF. Los archivos que encajan con `assetsTarget` (`.md` y `.txt` por defecto) se **redactan por idioma** en vez de traducirse a la existencia: Zintl escribe un artefacto vacío junto a tus catálogos y espera a que lo llenes.

Nunca copia el original, porque un PDF en inglés en la ruta alemana no es un PDF alemán, y un archivo idéntico byte a byte es una reserva que nada río abajo puede detectar.

Si un archivo es el mismo en todos los idiomas, no lo marques. Eso es todo lo que significa marcarlo.

## Y ahora

| Para                      | Lee                                                     |
| :------------------------ | :------------------------------------------------------ |
| Entender la fragmentación | [Límites y fragmentos](/concepts/boundaries-and-chunks) |
| Ver todas las opciones    | [Configuración](/reference/configuration)               |
