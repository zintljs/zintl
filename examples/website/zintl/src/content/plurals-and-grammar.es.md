# Plurales y gramática

El inglés tiene dos formas de plural. El árabe tiene seis. Tu código fuente no debería tener que saberlo.

## El problema, enunciado una vez

```ts
const label = `${count} items`;
```

Esto es incorrecto en la mayoría de los idiomas, y los arreglos habituales empeoran tu fuente: un ternario que solo cubre dos casos, o una llamada a `t()` con un argumento `count` y una clave que ahora tienes que nombrar.

## Lo que hace Zintl en su lugar

Tú escribes la frase. Los traductores escriben la gramática, en el catálogo, con sintaxis ICU:

```json
{
  "{count} items": "{count, plural, one {# elemento} other {# elementos}}"
}
```

Tu fuente sigue diciendo `${count} items`. El catálogo árabe lleva seis formas porque el árabe tiene seis, y el inglés no lleva ninguna porque el inglés no las necesita. La complejidad gramatical vive donde vive la gramática.

## Y se compila hasta desaparecer

Esa cadena ICU no se analiza en el navegador. En tiempo de compilación se convierte en una función de JavaScript corriente:

```js
(params) => {
  const { count } = params;
  if (count === 1) return "1 elemento";
  return `${count} elementos`;
};
```

Ninguna biblioteca de formato de mensajes llega a tus usuarios. Un motor gramatical que se envía a cada visitante para resolver una regla que ya se conocía en tiempo de compilación es exactamente el tipo de peso que este proyecto existe para eliminar.

## Elegir entre redacciones

`select` funciona igual, para cualquier cosa que no sea un recuento:

```json
{
  "Invite them": "{gender, select, male {Invítalo} female {Invítala} other {Invítale}}"
}
```

## Cuando el original no tiene esa palabra

El español necesita saber un género que tu frase en inglés nunca mencionó. En lugar de contorsionar el inglés para darle al traductor algo a lo que agarrarse, pasa el valor de forma invisible:

```ts
// @zintl-pass gender={user.gender}
const invite = `Invite them`;
```

La fuente se lee exactamente igual que antes. `gender` aparece en el esquema generado, y los traductores pueden ramificar sobre él.

> [!NOTE]
> Esta es la vía de escape para el hecho de que los idiomas de destino suelen necesitar más contexto del que tiene el original. Sin ella, el apaño habitual es empeorar tu inglés para servir a un idioma en el que no está escrito.

## Números, fechas y moneda

Eso es trabajo de `Intl`, y `Intl` ya está en el navegador. Zintl no lo envuelve.

## Y ahora

| Para                | Lee                                                        |
| :------------------ | :--------------------------------------------------------- |
| Guiar al compilador | [Directivas en comentarios](/reference/comment-directives) |
| Ver cómo se dividen | [Límites y fragmentos](/concepts/boundaries-and-chunks)    |
