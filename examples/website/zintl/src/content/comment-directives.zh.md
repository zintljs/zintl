# 注释指令

Zintl 会自动提取，而且绝大多数时候都是对的。指令是为剩下那些情况准备的。

它们是普通注释——`//`、`/* */` 或 `<!-- -->`——因此会随它们所描述的代码一起移动，并在构建时消失。

## `@zintl-ignore`

跳过下一个节点，以及它内部的一切。

```jsx
<div>
  {/* @zintl-ignore */}
  <span>SKU-40021</span>
  <span>Add to cart</span>
</div>
```

`SKU-40021` 永远不会被提取；`Add to cart` 会。

当一个字符串看起来像散文但其实不是时，就用它：产品编号、品牌名、调试输出，或者一个刻意用各自语言书写标签的语言切换器。

## `@zintl-target`

反过来：提取下一个节点中的每一个字符串，无论它的字段叫什么。

```ts
// @zintl-target
export default {
  title: "Zintl — compile-time i18n",
  description: "Write your app in plain language.",
};
```

Zintl 依据字符串出现的位置来发现它们——在标记中、在 `alt` 里、被赋给 `textContent`。普通对象并不属于这些位置，也不可能属于：`{ label: "…" }` 是按钮的可能性，并不比它是一个埋点事件更大。

当没有名字可指，或者你宁可不依赖某个名字时，就用它——匿名的 `export default`、直接传进调用的对象，或者任何你希望在别人重命名变量之后仍然被提取的东西。

在被标记的节点内部，**每一个**字符串字段都会被取用，包括嵌套的。`@zintl-ignore` 在内部依然有效，所以两者可以组合：

```ts
// @zintl-target
const meta = {
  title: "Checkout",
  // @zintl-ignore
  icon: "/favicon.svg",
};
```

## `@zintl-note`

给翻译这条字符串的人留一条注记。它会进入生成的 schema，因此译者能在编辑器里看到它，而不必仅凭字符串本身去猜。

```ts
// @zintl-note 登录后立即显示在仪表板上
const welcomeMsg = `Hello again!`;
```

只要原文脱离上下文就会有歧义，就值得写一条。「Open」是动词还是形容词，取决于页面。

## `@zintl-pass`

让译文能拿到一个你的原文并未提及的值。

```ts
// @zintl-pass role={user.role}
const dashboardTitle = `Welcome to your dashboard!`;
```

英语在这里什么都不需要。别的语言可能需要用户的性别、角色或数量才能选对词——这些区分是英语根本不作的。

这个值以不可见的方式绑定：你的源码读起来一字未改，变量会出现在生成的 schema 中，译者可以用普通的[复数或 select 语法](/guide/plurals-and-grammar)在它上面分支。你的运行时逻辑没有任何变化。

> [!NOTE]
> 这是一个逃生出口，用来应对「目标语言往往需要比原文更多的上下文」这一事实。没有它，通常的变通办法就是扭曲英文，给译者一个着力点——而这会为了迁就一门它本非用来书写的语言，把你的源码写得更差。

## 接下来

| 想要           | 阅读                                     |
| :------------- | :--------------------------------------- |
| 查看全部选项   | [配置](/reference/configuration)         |
| 把复数处理正确 | [复数与语法](/guide/plurals-and-grammar) |
