export function About() {
  const container = document.createElement("div");
  container.className = "page about-page";

  container.innerHTML = `
    <section class="about-content">
      <h2 class="section-title">About Zintl</h2>
      <p>
        Zintl was born out of a need for a more developer-friendly way to handle translations in complex web applications. 
        Traditional i18n systems often require manual management of JSON files and complex boilerplate code.
      </p>
      
      <div class="mission-statement">
        <blockquote>
          "Our mission is to make internationalization as seamless as writing your UI code."
        </blockquote>
      </div>

      <div class="team-section">
        <h3>The Philosophy</h3>
        <p>
          We believe that the compiler should be your best friend. By analyzing your source code, 
          Zintl can automate the extraction, stitching, and optimization of your translations, 
          leaving you free to focus on building amazing user experiences.
        </p>
      </div>
    </section>
  `;

  return container;
}
