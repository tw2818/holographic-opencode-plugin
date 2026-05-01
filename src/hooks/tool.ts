import type { Hooks } from "@opencode-ai/plugin";
import { getBridge } from "../bridge.js";

const SIGNIFICANT_TOOLS = [
  "edit",
  "write",
  "bash",
  "Task",
  "task",
  "create_file",
  "multi-edit",
  "apply_diff",
];

export function createToolHooks(): Pick<Hooks, "tool.execute.after"> {
  return {
    async "tool.execute.after"(input, output) {
      if (!SIGNIFICANT_TOOLS.includes(input.tool)) return;

      try {
        const bridge = await getBridge();

        if (input.tool === "bash" && typeof input.args.command === "string") {
          const cmd = input.args.command;
          if (cmd.includes("git commit")) {
            const match = cmd.match(/git commit\s+-m\s+["'](.+)["']/);
            if (match) {
              await bridge.addFact(`Committed: ${match[1]}`, "lessons", "auto-extract");
            }
          }
        }

        if (input.tool === "write" && typeof input.args.filePath === "string") {
          if (typeof input.args.content === "string") {
            const lines = input.args.content.split("\n").slice(0, 3).join(" ");
            await bridge.addFact(
              `Created ${input.args.filePath}: ${lines.substring(0, 80)}`,
              "facts",
              "auto-extract"
            );
          }
        }
      } catch (e) {
        console.error("[holographic-plugin] Tool hook error:", e);
      }
    },
  };
}
