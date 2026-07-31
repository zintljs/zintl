/**
 * Compiler test harness for resolved-world tests.
 *
 * These tests live in the plugin package on purpose. Exercising the compiler
 * against a real framework world requires *resolved capabilities*, and
 * resolution is the plugin's job — the compiler cannot build a world for
 * itself, and its test suite must not pretend otherwise.
 *
 * This replaces the compiler's old `isTestMode` block, which silently injected
 * html + assets + vanilla + react facets whenever `VITEST=true`. That made the
 * compiler behave differently under test than in production and is why none of
 * these tests ever passed a facet list. The world is now declared here, once,
 * in the open.
 */
import { ZintlCompiler } from "@zintljs/compiler";
import type { CompilerCapabilities, CompilerOptions, ZintlFacet } from "@zintljs/compiler";
import {
  assetsFacet,
  htmlFacet,
  reactFacet,
  vanillaFacet,
  viteFacet,
} from "@zintljs/compiler/facets";
import { resolveFacets } from "../../facets/resolve.js";

/**
 * The baseline world for compiler tests: plain-DOM extraction, React JSX,
 * HTML projection, static assets and the Vite bundler hooks.
 *
 * This mirrors what the plugin resolves for a default React project, so these
 * tests exercise the production path rather than a test-only one.
 */
function testFacets(): ZintlFacet[] {
  return [vanillaFacet(), reactFacet(), htmlFacet(), assetsFacet(), viteFacet()].flat(
    Infinity,
  ) as ZintlFacet[];
}

/**
 * Resolved capabilities for the baseline world, plus any extra facets.
 *
 * `extra` is listed first on purpose: `resolveFacets` dedupes by name and keeps
 * the first occurrence at equal priority, so a test supplying its own
 * `assetsFacet({ targets: [...] })` overrides the baseline one rather than being
 * silently discarded by it.
 */
function testCapabilities(extra: unknown[] = []): CompilerCapabilities {
  return resolveFacets([...extra, ...testFacets()].flat(Infinity) as ZintlFacet[]);
}

/**
 * Construct a compiler with the baseline world already resolved.
 * Drop-in replacement for `new ZintlCompiler(options, root, isDev)`.
 */
export function createTestCompiler(
  options: Omit<CompilerOptions, "capabilities"> = {},
  root?: string,
  isDev?: boolean,
): ZintlCompiler {
  return new ZintlCompiler({ ...options, capabilities: testCapabilities() }, root, isDev);
}

/**
 * Construct a compiler with extra facets layered on top of the baseline world —
 * for tests that need Vue, Svelte or a custom facet.
 */
export function createTestCompilerWith(
  extra: unknown[],
  options: Omit<CompilerOptions, "capabilities"> = {},
  root?: string,
  isDev?: boolean,
): ZintlCompiler {
  return new ZintlCompiler({ ...options, capabilities: testCapabilities(extra) }, root, isDev);
}
