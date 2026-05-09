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
