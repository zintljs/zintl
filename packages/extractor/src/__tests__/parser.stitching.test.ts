import { describe, it, expect } from "vite-plus/test";
import { extract } from "../parser.js";

describe("Intelligent Stitching & Directives Extraction", () => {
  it("should stitch pure template literals correctly without dataflow tracing", () => {
    const code = `
      function render() {
        const title = "My Website";
        element.innerHTML = \`Welcome to \${title} today!\`;
      }
    `;

    const result = extract(code, "test.ts", "test_boundary");
    const expectedText = "Welcome to {title} today!";

    expect(result.messages).toHaveLength(1);
    expect(result.messages[0]).toMatchObject({
      text: expectedText,
      variables: ["title"],
      contexts: ["innerHTML"],
    });
  });

  it("should aggressively ignore pure variables without surrounding text", () => {
    // Tests rule: "If the output is mostly '{mainTitle}': '{mainTitle}', do not extract"
    const code = `
      function render() {
        // Ignored because no real text is stitched
        element.innerHTML = \`\${mainTitle}\`; 
        
        // Ignored JSX
        return <p>{mainTitle}</p>;
      }
    `;

    const result = extract(code, "test.ts", "test_boundary");
    expect(result.messages).toHaveLength(0); // Zero extraction!
  });

  it("should correctly stitch Object properties acting as UI sinks", () => {
    const code = `
      const config = {
        label: \`You have \${count} unread notifications\`,
        placeholder: \`Search for \${category} items...\`
      };
    `;

    // Passing standard UI fields to be monitored
    const result = extract(code, "test.ts", "test_boundary", {
      uiObjectFields: new Set(["label", "placeholder"]),
    });

    expect(result.messages).toHaveLength(2);
    expect(result.messages[0].text).toBe("You have {count} unread notifications");
    expect(result.messages[0].variables).toEqual(["count"]);
    expect(result.messages[1].text).toBe("Search for {category} items...");
    expect(result.messages[1].variables).toEqual(["category"]);
  });

  it("should fragment monolithic HTML structures into inline literal sources", () => {
    const code = `
      function render() {
        // String literal monolithic extraction
        element.innerHTML = "<p>Fragment text</p>";
        
        // Template literal monolithic extraction
        app.innerHTML = \`
          <div>
            <p>Wait \${status}</p>
            <h1>\${mainTitle}</h1>
          </div>
        \`;
      }
    `;

    const result = extract(code, "test.ts", "test_boundary");

    expect(result.messages).toHaveLength(2);
    expect(result.messages[0].text).toBe("Fragment text");
    expect(result.messages[1].text).toBe("Wait {status}");

    expect(result.messages[0].text).toBe("Fragment text");
    expect(result.messages[1].text).toBe("Wait {status}");
  });
});

it("should completely skip extraction when @zintl-ignore directive is present", () => {
  const code = `
      function render() {
        // @zintl-ignore
        const config = {
          label: "Do not translate me"
        };
        
        return (
        {/* @zintl-ignore */}
          <div class="language-switcher">
            <button id="set-ar">العربية</button>
            <button id="set-en">English</button>
          </div>
        );
      }
    `;

  const result = extract(code, "test.tsx", "test_boundary", {
    uiObjectFields: new Set(["label"]),
  });

  // Check that we safely ignore all text inside the AST blocks!
  expect(result.messages).toHaveLength(0);
});

it("should handle HTML comment directives to suppress following fragments in template literals", () => {
  const code =
    "element.innerHTML = `<!-- @zintl-ignore -->\\n<button>العربية</button><span>Translated</span>`;";
  const result = extract(code, "test.ts", "test_boundary");

  // Translated should be extracted because </button> resets ignore
  expect(result.messages).toHaveLength(1);
  expect(result.messages[0].text).toBe("Translated");
});

it("should normalize unnamed template literal expressions to stable {input} name", () => {
  const code = 'document.body.innerHTML = `<li>Type-safe by default ${"✅"}</li>`;';
  const result = extract(code, "test.ts", "test_boundary");

  // Key should use {input} instead of {var0}
  const msg = result.messages.find((m) => m.text.includes("{input}"));
  expect(msg).toBeDefined();
  expect(msg?.text).toBe("Type-safe by default {input}");

  expect(msg).toBeDefined();
  expect(msg?.text).toBe("Type-safe by default {input}");
});

describe("Rich HTML/JSX Tag Stitching exploration", () => {
  it.skip("explores how the current system parses rich HTML blocks with tags", () => {
    const code = `
      element.innerHTML = "Please <span>click here</span> to read the <code>instructions</code>.";
    `;
    const result = extract(code, "test.ts", "test_boundary");
    console.log(
      "DIAGNOSTIC - Extracted messages:",
      result.messages.map((m) => m.text),
    );
  });

  it.skip("explores how the current system parses rich JSX elements with tags", () => {
    const code = `
      const App = () => {
        return <p>Please <span>click here</span> to read the <code>instructions</code>.</p>;
      };
    `;
    const result = extract(code, "test.tsx", "test_boundary");
    console.log(
      "DIAGNOSTIC - Extracted JSX messages:",
      Array.from(result.messages.values()).map((m) => m.text),
    );
  });

  it("should isolate adjacent standalone sibling HTML elements without sibling text", () => {
    const code = `
      element.innerHTML = '<a>Home</a>\\n<a>About</a>';
    `;
    const result = extract(code, "test.ts", "test_boundary");
    const texts = result.messages.map((m) => m.text);
    expect(texts).toContain("Home");
    expect(texts).toContain("About");
    expect(texts).not.toContain("Home Navigation");
  });

  it("should parse ignore comment directives inside phrasing tags correctly", () => {
    const code = `
      element.innerHTML = '<p>Edit <!-- @zintl-ignore --> <code>src/main.ts</code> and save to test</p>';
    `;
    const result = extract(code, "test.ts", "test_boundary");
    const texts = result.messages.map((m) => m.text);
    expect(texts).toContain("Edit");
    expect(texts).toContain("and save to test");
  });

  it("should construct full tagMaps with attributes and keep aliases stable", () => {
    const code = `
      element.innerHTML = \`Please <span class="accent-btn" id="clicker">click here</span> to read.\`;
    `;
    const result = extract(code, "test.ts", "test_boundary");
    expect(result.rawSinks).toHaveLength(1);
    const sink = result.rawSinks[0];
    expect(sink.text).toBe("Please <span>click here</span> to read.");
    expect(sink.tagMap).toBeDefined();
    expect(sink.tagMap).toHaveLength(1);
    expect(sink.tagMap![0]).toMatchObject({
      alias: "span",
      tagName: "span",
      originalOpen: '<span class="accent-btn" id="clicker">',
    });
  });

  it("should handle multiple spans where one has attributes and one does not", () => {
    const code = `
      element.innerHTML = \`This is <span class="blue-text" id="t1">first</span> and <span>second</span>.\`;
    `;
    const result = extract(code, "test.ts", "test_boundary");
    expect(result.rawSinks).toHaveLength(1);
    const sink = result.rawSinks[0];
    expect(sink.text).toBe("This is <span1>first</span1> and <span2>second</span2>.");
    expect(sink.tagMap).toBeDefined();
    expect(sink.tagMap).toHaveLength(2);
    expect(sink.tagMap![0]).toMatchObject({
      alias: "span1",
      tagName: "span",
      originalOpen: '<span class="blue-text" id="t1">',
    });
    expect(sink.tagMap![1]).toMatchObject({
      alias: "span2",
      tagName: "span",
      originalOpen: "<span>",
    });
  });

  it("should handle multiple spans that share the exact same attributes", () => {
    const code = `
      element.innerHTML = \`Both <span class="highlight" id="same">first</span> and <span class="highlight" id="same">second</span>.\`;
    `;
    const result = extract(code, "test.ts", "test_boundary");
    expect(result.rawSinks).toHaveLength(1);
    const sink = result.rawSinks[0];
    expect(sink.text).toBe("Both <span>first</span> and <span>second</span>.");
    expect(sink.tagMap).toBeDefined();
    expect(sink.tagMap).toHaveLength(1);
    expect(sink.tagMap![0]).toMatchObject({
      alias: "span",
      tagName: "span",
      originalOpen: '<span class="highlight" id="same">',
    });
  });

  it("should handle multiple spans with completely different classes and ids", () => {
    const code = `
      element.innerHTML = \`<span class="c1" id="id1">first</span> and <span class="c1">second</span>.\`;
    `;
    const result = extract(code, "test.ts", "test_boundary");
    expect(result.rawSinks).toHaveLength(1);
    const sink = result.rawSinks[0];
    expect(sink.text).toBe("<span1>first</span1> and <span2>second</span2>.");
    expect(sink.tagMap).toBeDefined();
    expect(sink.tagMap).toHaveLength(2);
    expect(sink.tagMap![0]).toMatchObject({
      alias: "span1",
      tagName: "span",
      originalOpen: '<span class="c1" id="id1">',
    });
    expect(sink.tagMap![1]).toMatchObject({
      alias: "span2",
      tagName: "span",
      originalOpen: '<span class="c1">',
    });
  });
});
