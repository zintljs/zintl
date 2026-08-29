# Integraciones

Zintl necesita un sitio de plugin en el empaquetador que controla tu grafo de fragmentos. Eso es todo lo que decide esta lista.

## Dónde funciona

| Host                   | Frameworks                                      | Formas de aplicación                              | Estado       |
| :--------------------- | :---------------------------------------------- | :------------------------------------------------ | :----------- |
| **Vite** 6 / 7 / 8     | React, Preact, Solid, Vue, Svelte, Lit, vanilla | SPA, MPA, SSR, compilaciones estáticas por idioma | Soportado    |
| **Rsbuild** 2.x        | React, Preact, Solid, Vue, Svelte, Lit, vanilla | SPA, MPA                                          | Soportado    |
| **Next.js vía vinext** | React (App Router, RSC)                         | SSR                                               | Experimental |

Todas las filas menos la última están dirigidas de punta a punta por la suite de contratos: navegadores reales contra aplicaciones reales, en cada cambio.

## Vite

La integración de referencia. Todo lo de esta documentación aplica sin matices.

## Rsbuild

Los catálogos alineados con fragmentos — incluidas las rutas tras `await import()` — el modo fantasma, los recursos localizados, el `lang` y el `dir` por idioma en `<html>` y la edición de cadenas en desarrollo se trasladan tal cual, sin código específico de Rspack en el compilador.

Dos cosas son exclusivas de Vite, y están sin construir más que bloqueadas:

- **`multiplex`** — el despliegue de HTML por idioma.
- **SSR.**

Un empaquetador que no las ha construido lo dice a través de su faceta, así que combinarlas falla en voz alta en vez de en silencio.

Que Rsbuild funcione siquiera es la evidencia de la arquitectura de facetas. El modelo de plugins de Rspack es todo lo distinto del de Rollup que puede ser un empaquetador, y alcanzar la paridad no requirió ramas en el compilador — solo una segunda faceta de empaquetador.

## Next.js vía vinext

Experimental. React con App Router y RSC, sobre Vite.

## Qué no está soportado, y por qué

**Next.js sobre webpack o Turbopack.** Turbopack no tiene API pública de plugins, y no vamos a construir sobre el empaquetador del que Next.js se está alejando. `vinext` es la vía soportada, y es experimental. Si hoy necesitas i18n en Next.js estándar, Zintl no es la herramienta.

**Nuxt, SvelteKit, Astro, Remix, TanStack Start.** Corren sobre Vite, así que el plugin _cargará_ y parecerá funcionar. Nada de esto está probado, y sus formas de enrutado y de entrada SSR no están modeladas. Trátalo como inexplorado más que como funcional.

**webpack, Rollup, esbuild, Farm.** Ninguna faceta de empaquetador reclama estos hosts, así que el plugin se niega a compilar en vez de emitir algo sutilmente incorrecto.

> [!NOTE]
> Si te topas con alguno de estos, [dilo en una incidencia](https://github.com/zintljs/zintl/issues). A qué host acudir después es una decisión que preferimos tomar a partir de informes y no de conjeturas.

## Añadir uno tú mismo

El extractor no lleva conocimiento de frameworks y el compilador es agnóstico respecto al empaquetador. Ambos se componen de **facetas**, así que el soporte para otro framework o herramienta de compilación es algo que añades, no algo alrededor de lo cual haya que reescribir el núcleo.

## Y ahora

| Para                    | Lee                                                     |
| :---------------------- | :------------------------------------------------------ |
| Entender las facetas    | [Límites y fragmentos](/concepts/boundaries-and-chunks) |
| Saber qué está asentado | [Estabilidad](/reference/stability)                     |
