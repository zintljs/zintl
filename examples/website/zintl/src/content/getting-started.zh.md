# 快速开始

四步，最后一步可选。

## 安装

```bash
npm install -D zintljs
```

## 添加插件

```ts
// vite.config.ts
import { defineConfig } from "vite";
import zintl from "zintljs/vite";

export default defineConfig({
  plugins: [zintl({ locales: ["en", "ar", "fr"] })],
});
```

列表中的第一个语言就是你的源语言，除非你用 `sourceLocale` 另行指定。它是你书写所用的语言，也是 Zintl 唯一不会写入磁盘的语言。

用的是 Rsbuild？插件和选项完全一样——只需注意展开运算符，因为那个入口返回的是数组：

```ts
// rsbuild.config.ts
import zintl from "zintljs/rsbuild";

export default defineConfig({
  plugins: [...zintl({ locales: ["en", "ar", "fr"] })],
});
```

## 设定语言

在入口的某处，告诉 Zintl 当前是什么语言：

```ts
// src/main.ts
import { zintl } from "zintljs/macro";

const locale = new URLSearchParams(location.search).get("lang") ?? "en";
await zintl(locale);
```

这次调用就是一个**信任锚点**。从它可达的一切构成一个目录，而这也是大多数项目唯一会用到的 Zintl API。

> [!IMPORTANT]
> 如果用户可以切换语言，请传入变量。`zintl("fr")` 是编译期事实而不是默认值——编译器会把法语固化进去，其余语言根本不会被构建，于是语言切换器画得出来、点得下去，却什么也不会发生。

## 运行

启动开发服务器，写一个普通字符串：

```ts
document.querySelector("#app").innerHTML = `<h1>Welcome back!</h1>`;
```

Zintl 会提取它，并在 `zintl/` 下为每种目标语言写一个文件：

```json
{
  "Welcome back!": ""
}
```

把空值填上。整个工作流就是这样——英文那一侧永远不会被写下来，因为编译器本来就有。

## 漏掉一条会怎样

构建失败，并指名是哪个字符串、哪种语言。

这是刻意的，也是继续往下读之前唯一需要理解的一点：Zintl 没有任何回退到源语言的路径，所以缺失的翻译不可能伪装成英文抵达用户。如果你更希望在浏览器里而不是 CI 里看到这个失败，由 `verifyIntegrity` 控制——但默认值是更早发现问题的那个。

## 接下来

| 想要                 | 阅读                                       |
| :------------------- | :----------------------------------------- |
| 填写并维护目录       | [翻译](/guide/translating)                 |
| 只发一种语言，或全部 | [语言与切换](/guide/locales-and-switching) |
| 把复数处理正确       | [复数与语法](/guide/plurals-and-grammar)   |
