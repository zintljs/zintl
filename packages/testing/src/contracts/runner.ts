import { test } from "@playwright/test";
import { createLab } from "../environment/lab.js";
import type { Contract, ExampleManifest, BaseAdapter } from "./types.js";

export function executeContract<TAdapter extends BaseAdapter = BaseAdapter>(
  contract: Contract<TAdapter>,
  manifests: ExampleManifest[],
) {
  // Filter manifests that claim all required capabilities
  const eligible = manifests.filter((m) =>
    contract.requires.every((cap) => m.capabilities.includes(cap)),
  );

  for (const manifest of eligible) {
    test(`[${contract.name}] ${manifest.name}`, async () => {
      const lab = await createLab({ example: manifest.name, mode: "dev" });
      try {
        await contract.execute(lab, manifest.adapter as TAdapter);
      } finally {
        await lab.teardown();
      }
    });
  }
}
