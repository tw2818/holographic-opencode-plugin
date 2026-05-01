import type { Hooks } from "@opencode-ai/plugin";
import { getBridge } from "../bridge.js";

const MEMORY_PATTERNS = [
  { regex: /remember\s+that\s+(.+)/i, category: "general" },
  { regex: /don't?\s+forget\s+that\s+(.+)/i, category: "general" },
  { regex: /note\s+that\s+(.+)/i, category: "general" },
  { regex: /(?:I|i)\s+(?:prefer|like|hate|want|wish)\s+(.+)/i, category: "preferences" },
  { regex: /(?:I|i)\s+(?:am|'m)\s+working\s+on\s+(.+)/i, category: "projects" },
  { regex: /(?:I|i)\s+(?:found|learned|discovered|realized)\s+(.+)/i, category: "lessons" },
];

export function createChatHooks(): Pick<Hooks, "chat.message"> {
  return {
    async "chat.message"(input, output) {
      if (!input.messageID) return;

      const text = extractText(output.parts as readonly { text?: string; content?: string }[]);

      for (const { regex, category } of MEMORY_PATTERNS) {
        const match = text.match(regex);
        if (match) {
          const content = match[1].replace(/\?$/, "").trim();
          if (content.length > 10) {
            try {
              const bridge = await getBridge();
              await bridge.addFact(content, category, "auto-extracted");
              console.log(`[holographic-plugin] Auto-stored: "${content.substring(0, 50)}..."`);
            } catch (e) {
              console.error("[holographic-plugin] Auto-store failed:", e);
            }
          }
          break;
        }
      }
    },
  };
}

function extractText(parts: readonly { text?: string; content?: string }[]): string {
  return parts
    .map((p) => {
      if (p.text) return p.text;
      if (p.content && typeof p.content === "string") return p.content;
      return "";
    })
    .join("");
}
