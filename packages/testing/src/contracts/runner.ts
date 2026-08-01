import { test } from "vite-plus/test";
import { createLab, createProjectLab } from "../environment/lab.js";
import type { Contract, ProjectManifest, BaseAdapter } from "./types.js";

export function executeContract<TAdapter extends BaseAdapter = BaseAdapter>(
  contract: Contract<TAdapter>,
  manifests: ProjectManifest[],
) {
  const eligible = manifests.filter((m) =>
    contract.requires.every((cap) => m.capabilities.includes(cap)),
  );

  for (const manifest of eligible) {
    test(`[${contract.name}] ${manifest.name}`, async () => {
      const lab = await createLab({ source: manifest.source, mode: "dev" });
      try {
        await contract.execute(lab, manifest.adapter as TAdapter, manifest);
      } finally {
        await lab.teardown();
      }
    }, 45000);
  }
}

export function executeProjectContract<TAdapter extends BaseAdapter = BaseAdapter>(
  contract: Contract<TAdapter>,
  manifests: ProjectManifest[],
) {
  const eligible = manifests.filter((m) =>
    contract.requires.every((cap) => m.capabilities.includes(cap)),
  );

  for (const manifest of eligible) {
    test(`[${contract.name}] ${manifest.name}`, async () => {
      const lab = await createProjectLab({
        source: manifest.source,
        zintlOptions: manifest.zintlOptions,
      });
      try {
        await contract.execute(lab, manifest.adapter as TAdapter, manifest);
      } finally {
        await lab.teardown();
      }
    }, 45000);
  }
}
