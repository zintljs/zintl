# Qué es Zintl

Zintl es un motor de internacionalización en tiempo de compilación. Tú escribes cadenas normales; el compilador las encuentra, deduce cuáles necesita realmente cada pantalla y envía exactamente esas.

## Toda la API

```ts
import { zintl } from "zintljs/macro";

await zintl(userLocale);

document.querySelector("#app").innerHTML = `<h1>Welcome back!</h1>`;
```

Eso no es un fragmento recortado. No hay ningún `t()` con el que envolver el encabezado, ninguna clave que inventarle y ningún diccionario que mantener sincronizado a mano.

## Por qué eso es posible

La mayoría de las bibliotecas de i18n se ejecutan en tiempo de ejecución, así que hay que decirles qué cadenas existen — y la única forma de decírselo es marcar cada una en su punto de uso. Zintl lee tu código con un analizador antes de que tu aplicación se ejecute. Qué cadenas existen, y qué pantalla puede alcanzarlas, son dos hechos que puede deducir en tiempo de compilación.

Una vez que tienes esos dos hechos, traducir deja de ser un problema de búsqueda y pasa a ser un problema de **empaquetado**. De ese cambio de enfoque sale todo lo demás.

## Lo que se deriva de ello

**Tus traducciones se dividen igual que tu código.** Una llamada a `zintl(locale)` marca un _ancla de confianza_: el punto en el que tu aplicación decide en qué idioma está. Todo lo alcanzable desde esa ancla forma un _límite_, y un límite se convierte en un fragmento de catálogo. Quien abra tu página de ajustes descargará las traducciones de los ajustes. No todas.

**No se envía nada que no uses.** Las reglas de plural y de género se compilan a condicionales de JavaScript, así que ningún motor gramatical llega al navegador. Tu idioma de origen no se escribe nunca en disco — el compilador ya tiene esas cadenas.

**Refactorizar sale gratis.** La identidad se basa en el contenido y no en la ruta, así que mover un archivo o renombrar un componente no inventa claves nuevas. Reestructurar una aplicación suele costar después un día de reconciliar catálogos. Aquí no cuesta nada.

## Lo que te pide a cambio

Una traducción que falta es un error de compilación, no un valor de reserva.

> [!IMPORTANT]
> Zintl nunca muestra tu idioma de origen en lugar de una traducción que falta. No hay ninguna ruta de reserva que activar, y es intencionado: una reserva silenciosa es un fallo que llega a tus usuarios con aspecto de función.

Ese es el único punto en el que Zintl es más estricto de lo que probablemente estés acostumbrado, y es deliberado: la comprobación que lo habría detectado se ejecuta en tu compilación en vez de en producción.

## Por dónde seguir

| Si quieres                             | Lee                                                     |
| :------------------------------------- | :------------------------------------------------------ |
| Instalarlo y ver una cadena traducirse | [Primeros pasos](/guide/getting-started)                |
| Entender el grafo que hay debajo       | [Límites y fragmentos](/concepts/boundaries-and-chunks) |
| Saber qué está asentado y qué se mueve | [Estabilidad](/reference/stability)                     |

Este sitio está construido con Zintl, en cuatro idiomas. La barra de arriba cambia entre ellos, no se recarga nada, y el único catálogo que tu navegador ha descargado es el de la página que estás leyendo.
