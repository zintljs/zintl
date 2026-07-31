import { zintl } from "zintljs/macro";
// @ts-ignore
import { _t } from "zintljs/internal";
// @ts-ignore
import renderTemplate from "./template.hbs";
// @ts-ignore
import brandMgr from "virtual:zintl/manager/none/boundary:b_brand";

// Top-level anchor: establishing main.ts as a module-level trust anchor.
// This allows Zintl's boundary graph reachability to trace static imports (like template.hbs) successfully.
const urlParams = new URLSearchParams(window.location.search);
const lang = urlParams.get("lang") || "en";
await zintl(lang);

function render() {
  // Read current brand from environment variable or query parameter (defaulting to nike)
  const brand = urlParams.get("brand") || "nike";

  // Display the active brand and locale
  const brandIndicator = document.getElementById("brand-indicator")!;
  brandIndicator.innerHTML = `
    <strong>Active Brand:</strong> <span style="color: #60a5fa; text-transform: uppercase;">${brand}</span>
    &nbsp;&nbsp;|&nbsp;&nbsp;
    <strong>Active Locale:</strong> <span style="color: #34d399; text-transform: uppercase;">${lang}</span>
  `;

  // Render Handlebars template containing text and dynamic mustaches
  const templateHtml = renderTemplate({
    name: "Alex",
    site: "Zintl Stress Test App",
    locale: lang,
  });

  // Query translations from our crazy custom adapters!
  // Multi-Brand Theme translations
  const brandSlogan = _t(`brand_slogan:${brand}`, {}, { _mgr: brandMgr });

  // Combine and render to DOM
  const content = document.getElementById("content")!;
  content.innerHTML = `
    <h3>1. Handlebars Template Adapter Output:</h3>
    <div style="background: #1e293b; padding: 1rem; border-radius: 4px; margin-bottom: 2rem;">
      ${templateHtml}
    </div>

    <h3>2. Multi-Brand Theme Projection Output:</h3>
    <div style="background: #1e293b; padding: 1rem; border-radius: 4px; margin-bottom: 2rem;">
      <p><strong>brand_slogan:</strong> <span style="font-style: italic; color: #f43f5e;">"${brandSlogan}"</span></p>
    </div>

    <div style="margin-top: 2rem; border-top: 1px solid #334155; padding-top: 1rem;">
      <h4>Change Language:</h4>
      <button onclick="window.location.search = '?lang=en&brand=${brand}'" style="padding: 0.5rem 1rem; margin-right: 0.5rem; background: #2563eb; color: white; border: none; border-radius: 4px; cursor: pointer;">English</button>
      <button onclick="window.location.search = '?lang=ar&brand=${brand}'" style="padding: 0.5rem 1rem; background: #059669; color: white; border: none; border-radius: 4px; cursor: pointer;">العربية</button>

      <h4 style="margin-top: 1.5rem;">Change Brand:</h4>
      <button onclick="window.location.search = '?lang=${lang}&brand=nike'" style="padding: 0.5rem 1rem; margin-right: 0.5rem; background: #4b5563; color: white; border: none; border-radius: 4px; cursor: pointer;">Nike</button>
      <button onclick="window.location.search = '?lang=${lang}&brand=adidas'" style="padding: 0.5rem 1rem; background: #4b5563; color: white; border: none; border-radius: 4px; cursor: pointer;">Adidas</button>
    </div>
  `;
}

render();
