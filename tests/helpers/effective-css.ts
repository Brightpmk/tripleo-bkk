import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const projectRoot = resolve(__dirname, "../..");

/**
 * app/globals.css is an import entrypoint: the rules live in ../styles/.
 *
 * Tests that assert on stylesheet content need the *effective* stylesheet —
 * the entrypoint with every @import inlined in order — which is what the
 * browser actually receives. Reading globals.css alone would only see the
 * import list.
 */
export function readEffectiveCss(entry = "app/globals.css"): string {
  const seen = new Set<string>();

  function inline(absolutePath: string): string {
    if (seen.has(absolutePath)) {
      return "";
    }

    seen.add(absolutePath);

    return readFileSync(absolutePath, "utf-8").replace(
      /^@import\s+["']([^"']+)["'];[ \t]*$/gm,
      (_match, specifier: string) =>
        inline(resolve(dirname(absolutePath), specifier))
    );
  }

  return inline(resolve(projectRoot, entry));
}
