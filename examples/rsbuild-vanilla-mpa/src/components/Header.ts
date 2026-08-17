import { zintl } from "zintljs/macro";

/**
 * A shared component with its **own** trust anchor.
 *
 * Both pages import this, and it calls `zintl(locale)` itself rather than
 * inheriting from whichever page mounted it. That is the point: an anchor is
 * independent, with its own hydration lifecycle, so this header's strings form a
 * boundary shared by both entries rather than being duplicated into each.
 *
 * On Vite this case has its own example (`examples/vanilla-mpa-shared`). Here it
 * is folded into the one multi-page app rather than adding a second directory.
 */
export async function Header(locale: string): Promise<HTMLElement> {
  await zintl(locale);

  const header = document.createElement("header");
  header.className = "site-header";

  header.innerHTML = `
    <nav class="nav">
      <a href="/">Home</a>
      <a href="/about">Guide</a>
    </nav>
  `;

  return header;
}
