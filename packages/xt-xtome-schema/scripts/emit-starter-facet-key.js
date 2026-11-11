import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const packageDir = dirname(dirname(fileURLToPath(import.meta.url)));
const taxonomy = JSON.parse(readFileSync(join(packageDir, "taxonomy.json"), "utf8"));
const keys = taxonomy.facets.map((facet) => facet.key);
const list = keys.map((key) => `  "${key}",`).join("\n");
const body = `// Generated from taxonomy.json. Run \`pnpm typecheck\` after editing that file.
export const starterFacetKeys = [
${list}
] as const;

export type StarterFacetKey = (typeof starterFacetKeys)[number];
`;

writeFileSync(join(packageDir, "src/starter-facet-key.ts"), body);
