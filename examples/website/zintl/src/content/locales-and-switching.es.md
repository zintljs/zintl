# Idiomas y cambio de idioma

Lo que le pasas a `zintl()` decide cuánto de tu aplicación sigue sin decidirse en tiempo de compilación.

## Una variable o un literal

```ts
await zintl(locale); // una variable: el idioma se decide en ejecución
await zintl("fr"); //  un literal:   el idioma es un hecho de compilación
```

Compilan a aplicaciones distintas.

|                                            | `zintl("fr")` | `zintl(locale)` |
| :----------------------------------------- | :------------ | :-------------- |
| Fragmento de catálogo emitido              | ninguno       | sí              |
| Se construyen los demás idiomas            | no            | sí              |
| Cadenas del idioma de origen en el paquete | **ausentes**  | presentes       |

Fíjate en la última fila. Con un literal, tu texto en inglés no está en la salida en absoluto. La página no _recurre_ al inglés — el inglés nunca se construyó.

**Usa un literal** cuando una página es genuinamente de un solo idioma: una compilación estática por idioma, una página de aterrizaje localizada, una ruta generada una vez por lengua.

**Usa una variable** en cuanto un usuario pueda cambiar de idioma, o el idioma venga de una URL, una cookie, una cabecera o una preferencia.

> [!WARNING]
> Equivocarse aquí es silencioso. Un literal en una aplicación con selector de idioma compila sin problemas y luego no puede cambiar, porque los demás idiomas nunca se emitieron.

## Cambiar en tiempo de ejecución

Vuelve a llamar al macro:

```ts
await zintl("ar");
```

El catálogo se intercambia en el sitio y el almacén avisa a quien esté escuchando. Que la pantalla se repinte sin recargar es una propiedad de tu framework, no de Zintl: un framework cuyos componentes releen el catálogo se repinta donde está, y uno sin ese mecanismo rechaza la actualización y recarga. En ambos casos el resultado es correcto.

Zintl fija `lang` y `dir` en el propio documento, así que la escritura de derecha a izquierda llega con el idioma y no necesitas una segunda hoja de estilos — escribe `margin-inline-start` en vez de `margin-left` y la maquetación se refleja.

El idioma activo se recuerda, y se relee del primer segmento de la ruta cuando tus rutas llevan uno (`/ar/guide`). Mantén el idioma en la URL si quieres que se pueda compartir.

## Un documento por idioma

Cuando cada ruta es de un solo idioma, constrúyelos todos: la opción `multiplex` despliega tu HTML en un documento por idioma, cada uno con esa lengua integrada y nada más incluido.

Es la forma a la que recurrir en un sitio de marketing o en una documentación que no necesita un selector dentro de la página. Hoy es exclusiva de Vite — Rsbuild no tiene despliegue.

## Poner un idioma en pie

Un idioma que todavía estás traduciendo no tiene por qué romper tu compilación ni llegar a tus usuarios. `pendingLocales` nombra aquellos en los que se está trabajando: sus catálogos se mantienen y se comprueban, y no se publican.

Es la versión honesta de «pronto añadiremos japonés» — las cadenas son reales, el archivo es real, y a nadie se le sirve una página traducida a medias.

## Y ahora

| Para                            | Lee                                                     |
| :------------------------------ | :------------------------------------------------------ |
| Acertar con los plurales        | [Plurales y gramática](/guide/plurals-and-grammar)      |
| Ver cómo se dividen los límites | [Límites y fragmentos](/concepts/boundaries-and-chunks) |
