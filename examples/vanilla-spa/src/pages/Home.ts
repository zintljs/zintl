// import { zintl } from "zintl";
import heroImg from "../assets/hero.png";

export async function Home() {
  // Independent anchor for the Home page
  // await zintl(currentLocale);

  const container = document.createElement("div");
  container.className = "page home-page";

  container.innerHTML = `
    <section class="hero">
      <div class="hero-content">
        <h1 class="hero-title">Powerful I18n for Modern Apps</h1>
        <p class="hero-subtitle">
          Zintl transforms your static strings into optimized, chunk-aware translation catalogs.
          Experience the future of internationalization today!
        </p>
        <div class="hero-cta">
          <button class="btn btn-primary">Get Started</button>
          <button class="btn btn-secondary">Learn More</button>
        </div>
      </div>
      <div class="hero-visual">
        <img src="${heroImg}" alt="Zintl Visualization" class="hero-image" />
      </div>
    </section>

    <section class="features">
      <div class="feature-card">
        <!-- @zintl-note This is a note for Zero Config -->
        <h3>Zero Config</h3>
        <!-- @zintl-pass x=1 -->
        <p>Just call zintl() and let the compiler do the rest of the heavy lifting for you.</p>
      </div>
      <div class="feature-card">
        <h3>Type Safe</h3>
        <p>Enjoy full TypeScript support with automatically generated translation schemas.</p>
      </div>
      <div class="feature-card">
        <h3>Optimized</h3>
        <p>Only load what you need, when you need it. Smallest runtime footprint in the industry.</p>
      </div>
    </section>
  `;

  return container;
}
