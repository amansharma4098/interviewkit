import { cp, mkdir, access } from "node:fs/promises";
import { kits } from "../src/catalog.js";
if (process.env.PREPTRICK_PUBLIC_BUILD !== "1") {
  for (const kit of kits) {
    try {
      await access(`output/pdf/${kit.id}.pdf`);
    } catch {
      throw Error(
        `Private PDF missing: ${kit.id}. Restore the private content backup before deployment, or use PREPTRICK_PUBLIC_BUILD=1 for a public-source preview only.`,
      );
    }
  }
}
await mkdir("dist/_private", { recursive: true });
await cp("output/pdf", "dist/_private", { recursive: true });
