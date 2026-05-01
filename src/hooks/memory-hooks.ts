import type { Hooks } from "@opencode-ai/plugin";
import { MemoryStore } from "../store.js";

const store = new MemoryStore();

const EXTRACT_PATTERNS = [
  { regex: /remember that (.+)/i, category: "general" },
  { regex: /note that (.+)/i, category: "general" },
  { regex: /don't forget (.+)/i, category: "general" },
  { regex: /I prefer (.+)/i, category: "preferences" },
  { regex: /I like (.+)/i, category: "preferences" },
  { regex: /I hate (.+)/i, category: "preferences" },
];

export const memoryHooks: Pick<Hooks, "chat.message" | "tool.execute.after" | "experimental.session.compacting"> = {
  "chat.message": async (input, output) => {
    if (!input.messageID) return;

    const text = output.parts
      .map((p) => {
        if ("text" in p && p.text) return p.text;
        if ("content" in p && typeof p.content === "string") return p.content;
        return "";
      })
      .join("");

    for (const { regex, category } of EXTRACT_PATTERNS) {
      const match = text.match(regex);
      if (match) {
        const content = match[1].trim();
        if (content.length > 3) {
          try {
            store.add_fact(content, category, "auto-extracted");
          } catch {
            // Ignore duplicates or errors
          }
        }
        break;
      }
    }
  },

  "tool.execute.after": async (execution) => {
    // Auto-save important tool outputs (handled by tool itself)
  },

  "experimental.session.compacting": async (input, output) => {
    // Inject relevant memory into context
    try {
      const facts = store.search_facts(input.sessionID, undefined, 0.3, 3);
      if (facts.length > 0) {
        output.context.push(
          `=== Relevant Memory ===\n${
            facts.map((f) => f.content).join("\n")
          }`
        );
      }
    } catch {
      // Ignore retrieval errors during compaction
    }
  },
};