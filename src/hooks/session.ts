import type { Hooks } from "@opencode-ai/plugin";
import { getBridge } from "../bridge.js";

export function createSessionHooks(): Pick<
  Hooks,
  "experimental.session.compacting"
> {
  return {
    async "experimental.session.compacting"(input, output) {
      try {
        const bridge = await getBridge();

        const categories = ["preferences", "facts", "projects", "lessons"];
        const memoryLines: string[] = [];
        memoryLines.push("\n--- User Memory Context ---\n");

        for (const category of categories) {
          const facts = await bridge.listFacts(category, 0.4, 10);
          if (facts.length > 0) {
            memoryLines.push(`\n[${category.toUpperCase()}]:`);
            for (const fact of facts) {
              memoryLines.push(`  • ${fact.content}`);
            }
          }
        }

        if (memoryLines.length > 1) {
          output.context.push(memoryLines.join("\n"));
        }
      } catch (e) {
        console.error("[holographic-plugin] Compaction hook error:", e);
      }
    },
  };
}
