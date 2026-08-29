# Configuración

Cada opción, qué cambia y cuándo recurrirías a ella.

## Idiomas

| Opción           | Tipo       | Por defecto             | Qué hace                                                    |
| :--------------- | :--------- | :---------------------- | :---------------------------------------------------------- |
| `locales`        | `string[]` | —                       | Todos los idiomas que construye este proyecto. Obligatoria. |
| `sourceLocale`   | `string`   | el primero de `locales` | El idioma en el que escribes. Nunca se escribe en disco.    |
| `pendingLocales` | `string[]` | `[]`                    | Mantenidos y verificados, pero no publicados.               |

## Dónde va cada cosa

| Opción          | Tipo                        | Por defecto                     | Qué hace                                                                           |
| :-------------- | :-------------------------- | :------------------------------ | :--------------------------------------------------------------------------------- |
| `outputDir`     | `string`                    | `"./zintl"`                     | Dónde se escriben los catálogos, desde la raíz del proyecto.                       |
| `catalogFormat` | `string \| (ctx) => string` | `<path>[.<func>].<locale>.json` | Nombrado de catálogos. Tokens: `[locale] [path] [dir] [name] [func] [bId] [hash]`. |
| `metadataDir`   | `string`                    | `node_modules/.zintl`           | La contabilidad interna del compilador. No es algo que edites.                     |

## Contenido más allá del código

| Opción          | Tipo                              | Por defecto     | Qué hace                                                                                                                    |
| :-------------- | :-------------------------------- | :-------------- | :-------------------------------------------------------------------------------------------------------------------------- |
| `assetsTarget`  | `(string \| AssetTargetConfig)[]` | `["md", "txt"]` | Archivos cuyo contenido varía según el idioma. Una extensión suelta significa `**/*.<ext>`.                                 |
| `virtualAssets` | `boolean`                         | `false`         | Entregar los recursos localizados a través de módulos virtuales en vez de resolver las importaciones al artefacto en disco. |

Un recurso marcado se **redacta** por idioma, no se traduce a la existencia. Si un archivo es el mismo en todos los idiomas, no lo marques.

Cómo llega al navegador depende de tu importación, no de la extensión:

```ts
import text from "./about.txt?raw"; // el contenido, incrustado en el catálogo
import url from "./hero.webp"; // la URL del empaquetador para el artefacto de este idioma
```

Ambas siguen al idioma en tiempo de ejecución, así que cambiar de lengua reapunta la importación sin recargar.

## Mantenimiento

| Opción                | Tipo      | Por defecto                               | Qué hace                                                                                          |
| :-------------------- | :-------- | :---------------------------------------- | :------------------------------------------------------------------------------------------------ |
| `prune`               | `boolean` | `true`                                    | Eliminar claves del catálogo cuando ninguna cadena fuente las produce.                            |
| `similarityThreshold` | `number`  | `0.6`                                     | Cuánto debe parecerse una cadena editada para conservar su traducción. Más bajo es más permisivo. |
| `verifyIntegrity`     | `boolean` | `true` al compilar, `false` en desarrollo | Hacer fallar la compilación ante una traducción que falta.                                        |

> [!IMPORTANT]
> `verifyIntegrity` es lo que hace que una traducción ausente rompa tu compilación en lugar de renderizarse vacía. Zintl no tiene reserva hacia el idioma de origen por diseño — esta es la comprobación que detecta el hueco antes que tus usuarios. También cubre los recursos localizados: un artefacto vacío es una traducción que falta con un archivo por cuerpo.

## Qué cuenta como cadena traducible

Una cadena se extrae cuando llega a un **sumidero**: un lugar donde se sabe que una cadena mira al usuario. Los sumideros los declaran las facetas, así que lo que extrae tu proyecto se deriva de qué facetas están activas.

| Forma                   | Coincide con                                  |
| :---------------------- | :-------------------------------------------- |
| `jsx:<element>:<attr>`  | Un atributo JSX; `*` para cualquier elemento  |
| `html:attr:<attr>`      | Un atributo en HTML o en una plantilla SFC    |
| `dom:<receiver>:<prop>` | Una asignación a una propiedad                |
| `obj:<binding>:<field>` | Un campo de un objeto con nombre              |
| `call:<fn>:<field>`     | Un campo de un objeto pasado a esa llamada    |
| `tag:<fn>`              | Una plantilla etiquetada que contiene marcado |

El texto plano en HTML, en plantillas SFC y en hijos JSX no necesita descriptor — es texto en marcado, y eso ya es la evidencia.

Deliberadamente **no hay `obj:field:*`** por defecto. Hacer coincidir un nombre de campo en cualquier objeto no sabe nada sobre el objeto, así que `{ label: "signup_click" }` se extraía como cualquier etiqueta. Nombra el objeto en su lugar:

```ts
const ui = { home: { title: "Welcome" } }; // obj:ui:title
defineConfig({ title: "My site" }); //        call:defineConfig:title
```

Usa `additionalTargets` para sumar a lo que las facetas activas ya encuentran, y los `targets` de una faceta para reemplazar lo que esa faceta aporta.

## Extenderlo

| Opción              | Tipo                  | Qué hace                                                           |
| :------------------ | :-------------------- | :----------------------------------------------------------------- |
| `facets`            | `(string \| Facet)[]` | Componer el comportamiento de framework, empaquetador y contenido. |
| `additionalTargets` | `string[]`            | Añadir descriptores de sumidero sin reemplazar ninguno.            |
| `multiplex`         | `boolean`             | Un documento HTML por idioma. Solo en Vite.                        |
| `debug`             | `string`              | Trazar un subsistema del compilador.                               |

Configurar una opción que pertenece a una faceta que reemplazaste es un error inmediato, no un ajuste que en silencio no hace nada.

## Y ahora

| Para                | Lee                                                        |
| :------------------ | :--------------------------------------------------------- |
| Guiar la extracción | [Directivas en comentarios](/reference/comment-directives) |
| Comprobar tu host   | [Integraciones](/reference/integrations)                   |
