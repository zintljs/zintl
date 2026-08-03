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
    const pending = contract.pending ?? contract.pendingFor?.[manifest.name];
    if (pending) {
      test.skip(`[${contract.name}] ${manifest.name} — PENDING: ${pending}`, () => {});
      continue;
    }
    test(`[${contract.name}] ${manifest.name}`, async () => {
      const lab = await createLab({
        source: manifest.source,
        mode: "dev",
        // Declared on the contract, so an exemption travels with the thing it
        // exempts rather than living in the harness's environment.
        strictDeliveryExempt: contract.strictDeliveryExempt,
      });
      try {
        await contract.execute(lab, manifest.adapter as TAdapter, manifest);
      } catch (err) {
        /**
         * Attach page state to every contract failure, not just assertion
         * failures. A `page.click` that times out reports only which locator it
         * waited for — it cannot say whether the element was missing, the app
         * had crashed, or the page rendered nothing. Without that, each failure
         * costs a fresh investigation and flakes stay unfalsifiable.
         */
        let diagnosis = "";
        try {
          diagnosis = `\n\n${await lab.assert.describeStall()}`;
        } catch {
          // Diagnosis is best-effort; never mask the original failure.
        }
        (err as Error).message = `${(err as Error).message}${diagnosis}`;
        throw err;
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
    const pending = contract.pending ?? contract.pendingFor?.[manifest.name];
    if (pending) {
      test.skip(`[${contract.name}] ${manifest.name} — PENDING: ${pending}`, () => {});
      continue;
    }
    test(`[${contract.name}] ${manifest.name}`, async () => {
      const lab = await createProjectLab({
        source: manifest.source,
        zintlOptions: manifest.zintlOptions,
      });
      try {
        await contract.execute(lab, manifest.adapter as TAdapter, manifest);
      } catch (err) {
        /**
         * Attach page state to every contract failure, not just assertion
         * failures. A `page.click` that times out reports only which locator it
         * waited for — it cannot say whether the element was missing, the app
         * had crashed, or the page rendered nothing. Without that, each failure
         * costs a fresh investigation and flakes stay unfalsifiable.
         */
        let diagnosis = "";
        try {
          diagnosis = `\n\n${await lab.assert.describeStall()}`;
        } catch {
          // Diagnosis is best-effort; never mask the original failure.
        }
        (err as Error).message = `${(err as Error).message}${diagnosis}`;
        throw err;
      } finally {
        await lab.teardown();
      }
    }, 45000);
  }
}
