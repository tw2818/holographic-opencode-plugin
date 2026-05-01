import type { PluginInput, Hooks } from "@opencode-ai/plugin";
import { MemoryStore } from "../store.js";

const DEFAULT_MODEL = "minimax-cn/Minimax-M2.7-highspeed";
const DEFAULT_BUFFER_SIZE = 20;
const DEFAULT_MESSAGE_THRESHOLD = 5;

interface BufferEntry {
  type: "user" | "assistant" | "tool" | "system";
  text: string;
  time: string;
}

interface SummarizerConfig {
  summarizerModel?: string;
  bufferSize?: number;
  messageThreshold?: number;
  enabled?: boolean;
}

class CircularBuffer {
  private entries: BufferEntry[] = [];
  constructor(private maxSize: number = 20) {}
  push(entry: BufferEntry) {
    if (this.entries.length >= this.maxSize) this.entries.shift();
    this.entries.push(entry);
  }
  getAll(): BufferEntry[] { return [...this.entries]; }
  size(): number { return this.entries.length; }
  clear() { this.entries = []; }
}

function parseConfig(input: PluginInput): SummarizerConfig {
  const raw = ((input as any).config?.experimental?.holographicMemory ?? {}) as SummarizerConfig;
  return {
    summarizerModel: raw?.summarizerModel ?? DEFAULT_MODEL,
    bufferSize: raw?.bufferSize ?? DEFAULT_BUFFER_SIZE,
    messageThreshold: raw?.messageThreshold ?? DEFAULT_MESSAGE_THRESHOLD,
    enabled: raw?.enabled ?? true,
  };
}

function buildSummarizerPrompt(entries: BufferEntry[]): string {
  const formatted = entries.map(e => `[${e.type}] (${e.time}): ${e.text}`).join("\n");
  return `You are a memory summarizer. Extract key information and return JSON.

Recent conversation:
${formatted}

Analyze and extract:
- lessons: what was learned, how things were done
- facts: technical details, paths, commands, configs, file names
- preferences: user likes/dislikes, naming preferences, interaction style
- projects: project status, milestones, next steps, blockers

Return ONLY valid JSON, no other text:
{"lessons": ["lesson1","lesson2"], "facts": ["fact1"], "preferences": ["pref1"], "projects": ["project1"]}

Skip trivial/greeting messages. Only extract meaningful, reusable information.`;
}

function parseSummarizerResponse(text: string): Array<{ content: string; category: string }> {
  const cleaned = text.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
  const match = cleaned.match(/\{[\s\S]*\}/);
  if (!match) return [];

  const parsed = JSON.parse(match[0]);
  const results: Array<{ content: string; category: string }> = [];

  for (const [category, items] of Object.entries(parsed)) {
    if (Array.isArray(items)) {
      for (const item of items) {
        if (typeof item === "string" && item.trim().length > 0) {
          results.push({ content: item.trim(), category });
        }
      }
    }
  }
  return results;
}

export function createMemoryHooks(input: PluginInput): Pick<Hooks, "chat.message" | "tool.execute.after" | "experimental.session.compacting"> {
  const config = parseConfig(input);
  const store = new MemoryStore();
  const client = input.client;
  const buffer = new CircularBuffer(config.bufferSize);
  let messageCount = 0;
  let isSummarizing = false;

  const COMPLETION_SIGNALS = /(done|完成了|完成|finished|搞定了|ok|好的|可以)\s*$/i;

  function shouldSummarize(): boolean {
    if (!config.enabled) return false;
    if (isSummarizing) return false;
    if (buffer.size() === 0) return false;
    if (messageCount >= (config.messageThreshold || 5)) return true;
    return false;
  }

  function checkCompletionSignal(text: string): boolean {
    return COMPLETION_SIGNALS.test(text.trim());
  }

  async function triggerSummarization(sessionID: string, directory: string) {
    if (isSummarizing) return;
    isSummarizing = true;

    try {
      const [providerID, modelID] = (config.summarizerModel || DEFAULT_MODEL).split("/", 2);
      const entries = buffer.getAll();
      const prompt = buildSummarizerPrompt(entries);

      const response = await client.session.prompt({
        path: { id: sessionID },
        body: {
          model: { providerID, modelID },
          agent: "default",
          tools: {},
          parts: [{ type: "text", text: prompt }],
        },
        query: { directory },
      });

      const textParts = (response as any).parts?.filter((p: any) => p.type === "text") || [];
      const answer = textParts.map((p: any) => p.text).join("");

      if (answer) {
        const facts = parseSummarizerResponse(answer);
        for (const { content, category } of facts) {
          try {
            const conflictResults = store.search_facts(content, category, 0.3, 5);
            for (const conflict of conflictResults) {
              if (conflict.content !== content) {
                try { store.record_feedback(conflict.fact_id, false); } catch {}
              }
            }
            store.add_fact(content, category, "auto-summarized");
          } catch {}
        }
      }

      buffer.clear();
      messageCount = 0;
    } catch {
      // Summarizer should never break main conversation
    } finally {
      isSummarizing = false;
    }
  }

  const EXTRACT_PATTERNS = [
    { regex: /remember that (.+)/i, category: "general" },
    { regex: /note that (.+)/i, category: "general" },
    { regex: /don't forget (.+)/i, category: "general" },
    { regex: /I prefer (.+)/i, category: "preferences" },
    { regex: /I like (.+)/i, category: "preferences" },
    { regex: /I hate (.+)/i, category: "preferences" },
  ];

  return {
    "chat.message": async (msgInput, output) => {
      if (!msgInput.messageID) return;

      const text = output.parts
        .map((p) => {
          if ("text" in p && p.text) return p.text;
          if ("content" in p && typeof p.content === "string") return p.content;
          return "";
        })
        .join("");

      // Auto-extract explicit patterns (keep existing behavior)
      for (const { regex, category } of EXTRACT_PATTERNS) {
        const match = text.match(regex);
        if (match) {
          const content = match[1].trim();
          if (content.length > 3) {
            try { store.add_fact(content, category, "auto-extracted"); } catch {}
          }
          break;
        }
      }

      // Capture to buffer
      const entryType = msgInput.agent === "user" ? "user" : "assistant";
      buffer.push({
        type: entryType,
        text: text.substring(0, 500),
        time: new Date().toISOString(),
      });
      messageCount++;

      // Trigger summarization on completion signals
      if (checkCompletionSignal(text)) {
        const sessionID = msgInput.sessionID;
        const directory = (input as any).directory || process.cwd();
        triggerSummarization(sessionID, directory);
      } else if (shouldSummarize()) {
        const sessionID = msgInput.sessionID;
        const directory = (input as any).directory || process.cwd();
        triggerSummarization(sessionID, directory);
      }
    },

    "tool.execute.after": async (execution) => {
      buffer.push({
        type: "tool",
        text: `Tool ${execution.tool}: ${execution.args ? JSON.stringify(execution.args).substring(0, 300) : ""}`,
        time: new Date().toISOString(),
      });
    },

    "experimental.session.compacting": async (compactionInput, output) => {
      // Trigger summarization before compaction (clear buffer)
      const sessionID = compactionInput.sessionID;
      const directory = (input as any).directory || process.cwd();
      await triggerSummarization(sessionID, directory);

      // Inject relevant memory into context
      try {
        const facts = store.search_facts(sessionID, undefined, 0.3, 3);
        if (facts.length > 0) {
          output.context.push(
            `=== Relevant Memory ===\n${facts.map((f) => f.content).join("\n")}`
          );
        }
      } catch {}
    },
  };
}