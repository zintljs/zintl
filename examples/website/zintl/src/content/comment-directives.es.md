# Directivas en comentarios

Zintl extrae automáticamente, y acierta casi siempre. Las directivas son para el resto.

Son comentarios corrientes — `//`, `/* */` o `<!-- -->` — así que viajan con el código que describen y desaparecen en tiempo de compilación.

## `@zintl-ignore`

Salta el siguiente nodo, y todo lo que contiene.

```jsx
<div>
  {/* @zintl-ignore */}
  <span>SKU-40021</span>
  <span>Add to cart</span>
</div>
```

`SKU-40021` no se extrae nunca; `Add to cart` sí.

Recurre a esto cuando una cadena parece prosa pero no lo es: códigos de producto, nombres de marca, salida de depuración, o un selector de idioma cuyas etiquetas están deliberadamente escritas en su propia lengua.

## `@zintl-target`

Lo contrario: extrae toda cadena del siguiente nodo, se llamen como se llamen sus campos.

```ts
// @zintl-target
export default {
  title: "Zintl — compile-time i18n",
  description: "Write your app in plain language.",
};
```

Zintl encuentra cadenas por dónde aparecen — en marcado, en un `alt`, asignadas a `textContent`. Un objeto corriente no es uno de esos lugares, y no puede serlo: `{ label: "…" }` es tan a menudo un evento de analítica como un botón.

Usa esto cuando no haya un nombre al que apuntar, o prefieras no depender de uno — un `export default` anónimo, un objeto pasado directamente a una llamada, o cualquier cosa que quieras que siga extrayéndose después de que alguien renombre la variable.

Dentro de un nodo marcado se toma **todo** campo de texto, incluidos los anidados. `@zintl-ignore` sigue aplicándose dentro, así que ambas se componen:

```ts
// @zintl-target
const meta = {
  title: "Checkout",
  // @zintl-ignore
  icon: "/favicon.svg",
};
```

## `@zintl-note`

Deja una nota para quien traduzca la cadena. Acaba en el esquema generado, así que los traductores la ven en su editor en vez de adivinar solo a partir del texto.

```ts
// @zintl-note Se muestra en el panel justo después de iniciar sesión
const welcomeMsg = `Hello again!`;
```

Vale la pena escribirla siempre que el original sea ambiguo fuera de contexto. «Open» es un verbo o un adjetivo según la pantalla.

## `@zintl-pass`

Da a una traducción acceso a un valor que tu texto original no menciona.

```ts
// @zintl-pass role={user.role}
const dashboardTitle = `Welcome to your dashboard!`;
```

El inglés no necesita nada aquí. Otros idiomas podrían necesitar el género, el rol o el recuento del usuario para elegir las palabras correctas — distinciones que el inglés sencillamente no hace.

El valor se enlaza de forma invisible: tu fuente se lee exactamente igual, la variable aparece en el esquema generado, y los traductores pueden ramificar sobre ella con [sintaxis de plural o select](/guide/plurals-and-grammar) corriente. Nada de tu lógica en ejecución cambia.

> [!NOTE]
> Esta es la vía de escape para el hecho de que los idiomas de destino suelen necesitar más contexto del que tiene el original. Sin ella, el apaño habitual es contorsionar el inglés para darle al traductor algo a lo que agarrarse — lo que empeora tu fuente para servir a un idioma en el que no está escrita.

## Y ahora

| Para                     | Lee                                                |
| :----------------------- | :------------------------------------------------- |
| Ver todas las opciones   | [Configuración](/reference/configuration)          |
| Acertar con los plurales | [Plurales y gramática](/guide/plurals-and-grammar) |
