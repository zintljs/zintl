import { test } from "vite-plus/test";
import { createLab, createProjectLab } from "../environment/lab.js";
import type { Contract, ProjectManifest, BaseAdapter } from "./types.js";

/** The vitest cap. Matches `testTimeout` in `tests/vitest.config.ts`. */
const TEST_TIMEOUT_MS = 45_000;

/**
 * Held back from the contract so that a contract which runs long still fails
 * *here*, with its diagnosis, rather than being killed by vitest.
 *
 * Sized against the worst case that follows a budget failure, not guessed:
 * `describeStall`'s four page reads at their 1.5s ceiling (6s) plus a bounded
 * teardown (4s), leaving 5s of slack. An earlier 12s reserve was **measured too
 * small** — the budget fired correctly and vitest then killed the test during
 * teardown, discarding the diagnosis it had just produced, which is the same
 * silent failure one step further along.
 */
const DIAGNOSIS_RESERVE_MS = 15_000;

const CONTRACT_BUDGET_MS = TEST_TIMEOUT_MS - DIAGNOSIS_RESERVE_MS;

/**
 * Run a contract against its own budget, shorter than the test's.
 *
 * **The point is which failure arrives first.** When vitest hits `testTimeout`
 * it kills the test where it stands: the runner's `catch` never runs, no
 * `describeStall()` is attached, and what reaches the report is
 * `Error: Test timed out in 45000ms` and nothing else. Every diagnostic this
 * harness has — packet counts, the settle beacon, the delivery ledger, the HMR
 * trace, the body outline — is collected in that `catch`, so precisely the
 * failures that most need explaining were the ones that arrived unexplained.
 *
 * Ledger L-039 is the case that paid for this: five separate investigations into
 * an intermittent timeout, none of which could see the page, and the cause — a
 * render loop pinning the renderer — was found only by a throwaway probe that
 * streamed console output to a file. The harness had the answer and no way to
 * print it.
 *
 * The losing promise is left running deliberately; it belongs to a lab that is
 * about to be torn down. Its rejection is swallowed so an abandoned contract
 * cannot resurface as an unhandled rejection attributed to whatever test is
 * running by then.
 */
function withContractBudget<T>(work: Promise<T>, label: string, deadlineAt: number): Promise<T> {
  /**
   * A deadline, not a duration, and the difference is the whole of it.
   *
   * The test's clock starts before `createLab` — which starts a dev server and
   * launches a browser, and under a loaded four-worker run can take tens of
   * seconds. A budget counted from the moment the contract *body* starts
   * therefore expires after the cap it was meant to precede: measured, two
   * contracts still died at 45 000 ms with no diagnosis, which is exactly the
   * failure this was written to remove. Anchoring to the test's own start keeps
   * the reserve intact however slow the setup was.
   */
  const remaining = Math.max(500, deadlineAt - Date.now());
  let timer: ReturnType<typeof setTimeout>;
  const budget = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () =>
        reject(
          new Error(
            `[Contract] ${label} ran out of budget after ${remaining}ms ` +
              `(the ${TEST_TIMEOUT_MS}ms test cap, less ${DIAGNOSIS_RESERVE_MS}ms reserved for diagnosis, ` +
              `less the time lab setup had already spent). ` +
              `Failing here so the page state below is captured.`,
          ),
        ),
      remaining,
    );
  });
  work.catch(() => {});
  return Promise.race([work, budget]).finally(() => clearTimeout(timer));
}

/**
 * Tear down without letting a broken page hold the worker.
 *
 * `teardown()` closes a browser context, and closing a context whose renderer is
 * not answering can wait as long as the thing it is waiting on. That is the same
 * hazard the budget above exists for, one step later: a diagnosis printed and
 * then swallowed by a hang in the cleanup is no better than never printing it.
 */
async function teardownSafely(lab: { teardown(): Promise<void> }): Promise<void> {
  try {
    await Promise.race([
      lab.teardown(),
      new Promise<void>((resolve) => setTimeout(resolve, 4_000)),
    ]);
  } catch (err) {
    console.error("[Contract] Teardown failed:", err);
  }
}

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
    test(
      `[${contract.name}] ${manifest.name}`,
      async () => {
        const deadlineAt = Date.now() + CONTRACT_BUDGET_MS;
        const lab = await createLab({
          source: manifest.source,
          driver: manifest.driver,
          mode: "dev",
          // Declared on the contract, so an exemption travels with the thing it
          // exempts rather than living in the harness's environment.
          strictDeliveryExempt: contract.strictDeliveryExempt,
        });
        try {
          await withContractBudget(
            contract.execute(lab, manifest.adapter as TAdapter, manifest),
            `[${contract.name}] ${manifest.name}`,
            deadlineAt,
          );
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
          await teardownSafely(lab);
        }
      },
      TEST_TIMEOUT_MS,
    );
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
    test(
      `[${contract.name}] ${manifest.name}`,
      async () => {
        const deadlineAt = Date.now() + CONTRACT_BUDGET_MS;
        const lab = await createProjectLab({
          source: manifest.source,
          zintlOptions: manifest.zintlOptions,
          driver: manifest.driver,
        });
        try {
          await withContractBudget(
            contract.execute(lab, manifest.adapter as TAdapter, manifest),
            `[${contract.name}] ${manifest.name}`,
            deadlineAt,
          );
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
          await teardownSafely(lab);
        }
      },
      TEST_TIMEOUT_MS,
    );
  }
}
