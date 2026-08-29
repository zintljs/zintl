# Estabilidad

Zintl está en alfa. Esta página dice qué significa eso en la práctica, para que puedas decidir de qué depender.

## Qué está asentado

Esto tiene pruebas de contrato detrás y no se espera que cambie de forma:

- **El macro.** `zintl(locale)`, y la diferencia entre pasar una variable y un literal.
- **Sin reserva hacia el idioma de origen.** Una traducción que falta es un error de compilación. Es el diseño, no un valor por defecto.
- **Identidad basada en contenido.** Mover o renombrar un archivo no deja huérfanas sus traducciones.
- **Formato de catálogo.** Un archivo JSON por archivo fuente y por idioma, con un esquema al lado.
- **Catálogos alineados con fragmentos.** Las traducciones se dividen siguiendo tu grafo de importaciones.
- **Modo fantasma.** El idioma de origen nunca se escribe en disco.

## Qué sigue moviéndose

- **Nombres de opciones.** Algunos son más específicos de lo necesario y podrían renombrarse con una deprecación.
- **Escritura de facetas.** El contrato interno para escribir tu propia faceta no está congelado. Usar las integradas es seguro; escribir una contra la interfaz actual puede requerir ajustes.
- **SSR y streaming.** Soportados en Vite, ejercitados por la suite, y la superficie todavía puede crecer.
- **vinext.** Experimental en el sentido de que no está cubierto de punta a punta.

## Qué no está previsto

- **Una API `t()` en ejecución.** Si necesitas buscar una cadena por clave en tiempo de ejecución, Zintl tiene la forma equivocada.
- **Traducción automática.** Los catálogos son archivos; pásales lo que quieras por encima.
- **Cadenas de reserva.** Véase la primera lista.

## Versionado

Las publicaciones alfa llevan un sufijo de versión y una etiqueta de npm a juego. Los cambios rompedores llegan en versiones menores mientras la mayor sea `0`, y cada uno viene con un changeset que explica qué se movió y por qué.

## Quitar Zintl

Conviene saberlo antes de adoptarlo, y es corto por diseño:

1. Borra el plugin de la configuración de tu empaquetador.
2. Tu fuente no ha cambiado — siempre fueron cadenas planas. Sigue funcionando en tu idioma de origen.
3. Borra `outputDir` si no quieres conservar las traducciones.

No hay paso de expulsión ni código generado en tu repositorio que haya que deshacer, porque Zintl nunca escribe dentro de tu fuente. Es una propiedad que vale la pena exigir a cualquier cosa que dejes acercarse a tu código, y es la razón de que esta página pueda ser así de breve.

## Informar de algo

Cualquier cosa sorprendente, poco clara o simplemente rota merece [una incidencia](https://github.com/zintljs/zintl/issues). Los informes de uso real pesan más que nada ahora mismo — incluido «no conseguí averiguar cómo…», que es un fallo de documentación y se trata como tal.

## Y ahora

| Para              | Lee                                      |
| :---------------- | :--------------------------------------- |
| Comprobar tu host | [Integraciones](/reference/integrations) |
| Empezar a usarlo  | [Primeros pasos](/guide/getting-started) |
