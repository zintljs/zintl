import type { Lab, SourceInsertion } from "@zintljs/testing";

/**
 * The three helpers the structural-edit contracts share.
 *
 * `HMR Sink`, `HMR Sink Warm` and `HMR Growth` were one file until the suite
 * was profiled: at 172 s it was the longest file in the run, and a file is the
 * unit a worker takes, so no amount of parallelism could get the suite below it.
 * Split into three, the longest of them is 92 s and the suite's floor moves to
 * `hmr.contract.spec.ts` instead.
 *
 * They live here rather than in one of the three because a spec file importing
 * another spec file would re-run its `executeContract` calls and register every
 * test twice. This module is not matched by the suite's `include` glob, so it is
 * only ever loaded as a dependency.
 */

/**
 * A locale this project actually writes catalogs for.
 *
 * Asked of the compiler rather than declared by the manifest, for the reason
 * L-062 records: `outputDir`, `catalogFormat` and which locales exist are
 * resolved compiler facts, and twenty adapters restating them is how a contract
 * comes to guess at paths the compiler had already worked out. The source
 * locale is excluded because ghost mode never writes it.
 */
export function catalogLocale(lab: Lab): string {
  const compiler = lab.compiler.instance as
    | { locales?: string[]; sourceLocale?: string }
    | undefined;
  const target = compiler?.locales?.find((l) => l !== compiler.sourceLocale);
  if (!target) {
    throw new Error(
      `The compiler reports no locale other than the source one, so no catalog is ever ` +
        `written and there is nothing for this assertion to look in.`,
    );
  }
  return target;
}

/** Boundaries the compiler currently knows about, or `-1` if it cannot say. */
export function boundaryCount(lab: Lab): number {
  try {
    return lab.compiler.getBoundaryGraph()?.nodes?.size ?? -1;
  } catch {
    return -1;
  }
}

export async function insert(lab: Lab, edit: SourceInsertion, which: string): Promise<void> {
  await lab.fs.edit(edit.file, (content) => {
    const at = content.indexOf(edit.anchorOn);
    if (at === -1) {
      throw new Error(
        `${which} anchors on ${JSON.stringify(edit.anchorOn)}, which is not in ${edit.file}. ` +
          `The adapter has drifted from the project it describes.`,
      );
    }
    const cut = at + edit.anchorOn.length;
    return content.slice(0, cut) + edit.insert + content.slice(cut);
  });
}
