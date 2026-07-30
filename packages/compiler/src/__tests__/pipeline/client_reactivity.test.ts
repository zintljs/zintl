import { describe, it, expect } from "vite-plus/test";
import { observe } from "../../pipeline/observe.js";
import { resolve } from "../../pipeline/resolve.js";
import { apply } from "../../pipeline/apply.js";
import { reactCodegenFacet } from "../../facet/index.js";
import { baseExtraction, emptyCapabilities } from "../helpers/capabilities.js";

const compiledState = baseExtraction();

// Which framework hook client reactivity needs is declared by the codegen facet,
// not hardcoded in the compiler — so the test must supply that world.
const { system } = emptyCapabilities({
  clientReactivityImports: reactCodegenFacet().clientReactivityImports,
});

const mockConfig = {
  isDev: true,
  sourceLocale: "en",
  locales: ["en"],
  root: "/root",
  system,
} as any;

const mockLogger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  withPrefix: () => mockLogger,
} as any;

describe("Client Component Reactivity Injection Test", () => {
  it("should inject useSyncExternalStore in client component files", () => {
    const code = `
"use client";
import React from "react";

export function ClientComponent() {
  return <div>{"hello"}</div>;
}
    `;

    const observation = observe(code, "client.tsx", "client", mockLogger, { compiledState });
    expect(observation.isClientComponent).toBe(true);
    expect(observation.componentFunctions?.length).toBeGreaterThan(0);

    const plan = resolve([], observation, mockConfig, mockLogger, "client.tsx");
    const result = apply(code, plan, mockLogger);

    expect(result.code).toContain(
      "useSyncExternalStore(subscribe, getStoreVersion, getStoreVersion)",
    );
    expect(result.code).toContain('import { useSyncExternalStore } from "react";');
    expect(result.code).toContain(
      'import { subscribe, getStoreVersion } from "virtual:zintl/runtime/internal";',
    );
  });

  it("should NOT inject useSyncExternalStore in server components", () => {
    const code = `
import React from "react";

export function ServerComponent() {
  return <div>{"hello"}</div>;
}
    `;

    const observation = observe(code, "server.tsx", "server", mockLogger, { compiledState });
    expect(observation.isClientComponent).toBe(false);

    const plan = resolve([], observation, mockConfig, mockLogger, "server.tsx");
    const result = apply(code, plan, mockLogger);

    expect(result.code).not.toContain("useSyncExternalStore");
  });

  describe("Edge Case: Component used inside client component", () => {
    it("should handle helper components defined in the same 'use client' file", () => {
      const code = `
"use client";
import React from "react";

function HelperComponent() {
  return <div>{"helper"}</div>;
}

export default function ClientComponent() {
  return (
    <div>
      <HelperComponent />
    </div>
  );
}
      `;

      const observation = observe(code, "hybrid.tsx", "hybrid", mockLogger, { compiledState });
      expect(observation.isClientComponent).toBe(true);
      // Both HelperComponent and ClientComponent contain translatable JSX sinks ("helper"), so both should be registered.
      expect(observation.componentFunctions?.length).toBe(2);

      const plan = resolve([], observation, mockConfig, mockLogger, "hybrid.tsx");
      const result = apply(code, plan, mockLogger);

      // Verify BOTH functions get the hook injected because they are in a "use client" file
      const helperCount = (result.code.match(/useSyncExternalStore\(/g) || []).length;
      expect(helperCount).toBe(2);
    });

    it("should NOT inject in imported helper component files without 'use client'", () => {
      const helperCode = `
import React from "react";
export function HelperComponent() {
  return <div>{"helper"}</div>;
}
      `;

      const observation = observe(helperCode, "helper.tsx", "helper", mockLogger, {
        compiledState,
      });
      expect(observation.isClientComponent).toBe(false);

      const plan = resolve([], observation, mockConfig, mockLogger, "helper.tsx");
      const result = apply(helperCode, plan, mockLogger);

      expect(result.code).not.toContain("useSyncExternalStore");
    });
  });
});
