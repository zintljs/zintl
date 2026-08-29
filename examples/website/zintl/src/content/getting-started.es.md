# Primeros pasos

Cuatro pasos, y el último es opcional.

## Instalación

```bash
npm install -D zintljs
```

## Añade el plugin

```ts
// vite.config.ts
import { defineConfig } from "vite";
import zintl from "zintljs/vite";

export default defineConfig({
  plugins: [zintl({ locales: ["en", "ar", "fr"] })],
});
```

El primer idioma de la lista es tu idioma de origen, salvo que indiques otro con `sourceLocale`. Es el idioma en el que escribes, y el único que Zintl nunca escribe en disco.

¿Usas Rsbuild? El plugin y sus opciones son los mismos — fíjate solo en el operador de propagación, ya que ese punto de entrada devuelve un array:

```ts
// rsbuild.config.ts
import zintl from "zintljs/rsbuild";

export default defineConfig({
  plugins: [...zintl({ locales: ["en", "ar", "fr"] })],
});
```

## Fija un idioma

En algún punto de tu entrada, dile a Zintl en qué idioma está esto:

```ts
// src/main.ts
import { zintl } from "zintljs/macro";

const locale = new URLSearchParams(location.search).get("lang") ?? "en";
await zintl(locale);
```

Esa llamada es un **ancla de confianza**. Todo lo alcanzable desde ella forma un catálogo, y es la única API de Zintl que la mayoría de los proyectos llega a tocar.

> [!IMPORTANT]
> Pasa una variable si el usuario puede cambiar de idioma. `zintl("fr")` es un hecho de tiempo de compilación, no un valor por defecto: el compilador integra el francés y no llega a construir los demás, así que un selector de idioma se dibujaría, se podría pulsar, y no haría nada.

## Ejecútalo

Arranca tu servidor de desarrollo y escribe una cadena normal:

```ts
document.querySelector("#app").innerHTML = `<h1>Welcome back!</h1>`;
```

Zintl la extrae y escribe un archivo por cada idioma de destino dentro de `zintl/`:

```json
{
  "Welcome back!": ""
}
```

Rellena los valores vacíos. Ese es todo el flujo de trabajo — el lado en inglés no se escribe nunca, porque el compilador ya lo tiene.

## Qué pasa si olvidas una

Tu compilación falla, nombrando la cadena y el idioma.

Es intencionado, y es lo único que conviene entender antes de seguir: Zintl no tiene ningún valor de reserva hacia tu idioma de origen, así que una traducción que falta no puede llegar a un usuario disfrazada de texto en inglés. Si prefieres ver el fallo en el navegador antes que en CI, `verifyIntegrity` lo controla — pero el valor por defecto es el que lo detecta antes.

## Y ahora

| Para                          | Lee                                                        |
| :---------------------------- | :--------------------------------------------------------- |
| Rellenar y mantener catálogos | [Traducir](/guide/translating)                             |
| Publicar un idioma, o todos   | [Idiomas y cambio de idioma](/guide/locales-and-switching) |
| Acertar con los plurales      | [Plurales y gramática](/guide/plurals-and-grammar)         |
