import type { Plugin } from "vite";
import type { ZintlCompiler } from "@zintl/compiler";
import { PLUGIN_NAME } from "./constants.js";
import type { ZintlPluginOptions } from "./index.js";
import zintlUnplugin, { contextMap } from "./plugin.js";

export interface ZintlPluginArray extends Array<Plugin> {
  __compiler?: ZintlCompiler;
  __options?: ZintlPluginOptions;
  name?: string;
  enforce?: "pre" | "post";
  config?: Plugin["config"];
  configResolved?: Plugin["configResolved"];
  configureServer?: Plugin["configureServer"];
  buildStart?: Plugin["buildStart"];
  resolveId?: Plugin["resolveId"];
  load?: Plugin["load"];
  transform?: Plugin["transform"];
  transformIndexHtml?: Plugin["transformIndexHtml"];
  handleHotUpdate?: Plugin["handleHotUpdate"];
  hotUpdate?: Plugin["hotUpdate"];
  buildEnd?: Plugin["buildEnd"];
}

/**
 * Zintl Vite Plugin
 * Handles message extraction and virtual catalog injection.
 */
function vite(options: ZintlPluginOptions = {}): ZintlPluginArray {
  const result = zintlUnplugin.vite(options) as ZintlPluginArray;
  const activeCtx = contextMap.get(options);
  const mainPlugin = result.find((p) => p.name === PLUGIN_NAME);

  if (mainPlugin && activeCtx) {
    Object.defineProperty(mainPlugin, "__compiler", {
      get() {
        return activeCtx.compiler;
      },
      configurable: true,
      enumerable: true,
    });
    Object.defineProperty(mainPlugin, "__options", {
      get() {
        return activeCtx.options;
      },
      configurable: true,
      enumerable: true,
    });
  }

  const propertiesToForward: Array<keyof Plugin> = [
    "name",
    "enforce",
    "config",
    "configResolved",
    "configureServer",
    "buildStart",
    "resolveId",
    "load",
    "transform",
    "transformIndexHtml",
    "handleHotUpdate",
    "hotUpdate",
    "buildEnd",
  ];

  if (mainPlugin) {
    for (const prop of propertiesToForward) {
      Object.defineProperty(result, prop, {
        get() {
          return mainPlugin[prop];
        },
        configurable: true,
        enumerable: true,
      });
    }
  }

  if (activeCtx) {
    Object.defineProperty(result, "__compiler", {
      get() {
        return activeCtx.compiler;
      },
      configurable: true,
      enumerable: true,
    });
    Object.defineProperty(result, "__options", {
      get() {
        return activeCtx.options;
      },
      configurable: true,
      enumerable: true,
    });
  }

  return result;
}

export default vite;
export { vite as "module.exports" };
