# Glosario

Las palabras que usa esta documentación, y qué significa cada una aquí.

## Ancla

Véase **ancla de confianza**.

## Ancla de confianza

Una llamada a `zintl(locale)` — el punto en el que tu aplicación declara en qué idioma está. Cada ancla es independiente y tiene su propio ciclo de hidratación.

## Artefacto

El archivo por idioma que Zintl escribe para un **recurso localizado** — `zintl/src/about.fr.txt` junto a `src/about.txt`. Se crea vacío y lo redacta una persona; nunca se copia del original.

## Catálogo

Las traducciones de un archivo fuente en un idioma — un archivo JSON dentro de `outputDir`. Lo que editan los traductores.

## Colonia

Un límite alcanzable desde una entrada solo a través de una importación dinámica. Sus cadenas pertenecen al mundo de esa entrada, pero llegan con la ruta diferida.

## Directiva

Un comentario que guía al compilador — `@zintl-ignore`, `@zintl-target`, `@zintl-note`, `@zintl-pass`. Véase [Directivas en comentarios](/reference/comment-directives).

## Faceta

Una pieza componible del comportamiento del compilador que cubre una sola preocupación — un framework, un empaquetador, SSR, recursos. Se resuelve al construir el compilador.

## Fragmento

En lo que se convierte un límite en el navegador: una unidad que el empaquetador carga. Los fragmentos de entrada llegan con la página, los diferidos con la ruta que los necesita, los compartidos donde dos entradas se solapan.

## Gestor

Código generado que carga el catálogo correcto para un límite. Integra el idioma del ancla para arrancar rápido y mantiene los demás diferidos.

## Idioma de origen

El idioma en el que escribes. Nunca se escribe en disco, nunca se usa como reserva.

## Idioma pendiente

Un idioma en el que se está trabajando: sus catálogos se mantienen y se verifican, y no se publica.

## Límite

El conjunto de cadenas alcanzables desde un **ancla de confianza**. Se convierte en un fragmento de catálogo. Se identifica por un hash de su contenido (`b_<hash>`), no por una ruta.

## Modo fantasma

El idioma de origen nunca se escribe en disco. El compilador lo virtualiza a partir del manifiesto de extracción y lo carga de forma diferida solo si es el idioma activo.

## Multiplexado

Construir un documento HTML por idioma, cada uno con esa lengua integrada. Solo en Vite.

## Punto de entrada

Un archivo con una llamada a `zintl()` de **nivel superior**, a diferencia de una anidada dentro de una función. Una entrada posee un fragmento.

## Recurso localizado

Un archivo cuyo _contenido_ cambia según el idioma, en vez de una cadena dentro de un componente — identificado por `assetsTarget`, `.md` y `.txt` por defecto.

## Sumidero

Un lugar donde se sabe que una cadena mira al usuario — texto en marcado, un `alt`, una asignación a `textContent`. Lo que hace traducible a una cadena es llegar a un sumidero, no parecer prosa.

## Unidad cosida

La unidad real de extracción. Las plantillas literales, los fragmentos JSX y el HTML se cosen en piezas lógicas antes de extraerse, de modo que una frase repartida entre etiquetas siga siendo una sola clave.

## Y ahora

| Para                  | Lee                                                     |
| :-------------------- | :------------------------------------------------------ |
| Ver cómo encajan      | [Límites y fragmentos](/concepts/boundaries-and-chunks) |
| Configurar cualquiera | [Configuración](/reference/configuration)               |
