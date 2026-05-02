import type { PluginInput, Hooks } from "@opencode-ai/plugin";
import { MemoryStore } from "../store.js";
import { FactRetriever } from "../retriever.js";
import { encode_text, similarity } from "../hrr.js";
import type { Fact } from "../types.js";

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

function getConfig(): SummarizerConfig {
    return {
      summarizerModel: undefined,
      bufferSize: DEFAULT_BUFFER_SIZE,
      messageThreshold: DEFAULT_MESSAGE_THRESHOLD,
      enabled: true,
    };
  }

function buildSummarizerPrompt(entries: BufferEntry[], store: MemoryStore): string {
  const formatted = entries.map(e => `[${e.type}] (${e.time}): ${e.text}`).join("\n");
  
  // Find existing similar facts that might conflict
  const keyText = entries.map(e => e.text).join(" ");
  const existingFacts = store.list_facts(undefined, 0.3, 20);
  const relevantExisting = existingFacts
    .map(f => ({ fact: f, sim: similarity(encode_text(keyText), encode_text(f.content)) }))
    .filter(x => x.sim > 0.2)
    .sort((a, b) => b.sim - a.sim)
    .slice(0, 10);

  let existingBlock = "";
  if (relevantExisting.length > 0) {
    existingBlock = "\nExisting stored facts that might overlap:\n" +
      relevantExisting.map(({ fact, sim }) => 
        `  [ID:${fact.fact_id}] (${fact.category}, trust:${fact.trust_score.toFixed(2)}, sim:${sim.toFixed(2)})\n    ${fact.content}`
      ).join("\n") + "\n";
  }

  return `You are a memory summarizer. Extract key information and return JSON.

Recent conversation:
${formatted}
${existingBlock}
Analyze, rewrite, and classify each fact:

1. REWRITE each fact to be self-contained (no pronouns like "he", "it", "this" — replace with actual names/objects)
2. CLASSIFY each fact into a category:
   - Prefer existing categories when they fit (you can see current ones in the stored facts above)
   - Create new specific categories when needed (single lowercase word, e.g. "deployment", "bugs", "ui", "ci")
   - Avoid overly generic categories like "general", "other", "misc"
   - The JSON key for each fact can be ANY category name, not just the four examples below
3. SCORE trust (0-1) for each fact:
   - 0.8-1.0: user explicitly stated this
   - 0.5-0.7: solid inference from conversation
   - 0.2-0.4: weak inference, might be inaccurate

Return ONLY valid JSON, no other text:
{
  "lessons": [{"content": "rewritten fact", "trust": 0.7}],
  "deployment": [{"content": "rewritten fact", "trust": 0.8}],
  "bugs": [{"content": "rewritten fact", "trust": 0.6}],
  "dedup": [
    {"action": "merge", "old_id": 5, "new_content": "merged fact text"},
    {"action": "replace", "old_id": 3, "reason": "why replacing"},
    {"action": "keep_existing", "old_id": 8, "reason": "why keeping old"}
  ]
}

Dedup rules:
- If new fact is identical to existing: DON'T include it in facts array, just add dedup entry with action "keep_existing"
- If new fact updates old fact: DO include updated version in facts array, add dedup with action "merge" or "replace"
- If new fact is genuinely new: just include it in facts array, no dedup needed
- "merge": combine info from both → the new_content in dedup overrides what's in facts array
- "replace": old fact is outdated → old fact will be downranked

Skip trivial/greeting messages. Only extract meaningful, reusable information.`;
}

interface DedupAction {
  action: "merge" | "replace" | "keep_existing" | "keep_new";
  old_id?: number;
  new_content?: string;
  reason?: string;
}

interface SummarizerFact {
  content: string;
  trust?: number;
}

interface SummarizerOutput {
  lessons?: SummarizerFact[];
  facts?: SummarizerFact[];
  preferences?: SummarizerFact[];
  projects?: SummarizerFact[];
  dedup?: DedupAction[];
}

function parseSummarizerResponse(text: string): { facts: Array<{ content: string; category: string; trust: number }>; dedup: DedupAction[] } {
  const cleaned = text.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
  const match = cleaned.match(/\{[\s\S]*\}/);
  if (!match) return { facts: [], dedup: [] };
  
  let parsed: SummarizerOutput;
  try {
    parsed = JSON.parse(match[0]);
  } catch {
    return { facts: [], dedup: [] };
  }
  
  const results: Array<{ content: string; category: string; trust: number }> = [];
  
  for (const [category, items] of Object.entries(parsed)) {
    if (category === "dedup") continue;
    const itemList = Array.isArray(items) ? items : [items];
    for (const item of itemList) {
      if (typeof item === "string" && item.trim().length > 0) {
        results.push({ content: item.trim(), category, trust: 0.5 });
      } else if (typeof item === "object" && item.content?.trim?.()) {
        results.push({ 
          content: item.content.trim(), 
          category, 
          trust: Math.min(1, Math.max(0, item.trust ?? 0.5)) 
        });
      }
    }
  }
  
  return { facts: results, dedup: parsed.dedup || [] };
}

export function createMemoryHooks(input: PluginInput): Pick<Hooks, "chat.message" | "tool.execute.after" | "experimental.session.compacting"> {
  const config = getConfig();
  const store = new MemoryStore();
  const client = input.client;
  const buffer = new CircularBuffer(config.bufferSize);
  let messageCount = 0;
  let isSummarizing = false;

  function shouldSummarizeNow(): boolean {
    if (!config.enabled) return false;
    if (isSummarizing) return false;
    if (buffer.size() === 0) return false;
    if (messageCount < (config.messageThreshold || 10)) return false;
    return true;
  }

  function getModelOverride(): { providerID: string; modelID: string } | undefined {
    if (!config.summarizerModel) return undefined;
    const p = config.summarizerModel.indexOf("/");
    if (p <= 0) return undefined;
    return { providerID: config.summarizerModel.substring(0, p), modelID: config.summarizerModel.substring(p + 1) };
  }

  async function triggerSummarization(parentSessionID: string, directory: string) {
    if (isSummarizing) return;
    isSummarizing = true;

    try {
      const modelOverride = getModelOverride();
      const createResult: any = await client.session.create({
        body: {
          parentID: parentSessionID,
          title: "memory-summarizer",
        },
        query: { directory },
      });
      const subSessionID = createResult.data?.id;
      if (!subSessionID) throw new Error("failed to create sub-session");

      const entries = buffer.getAll();
      const prompt = buildSummarizerPrompt(entries, store);

      const response = await client.session.prompt({
        path: { id: subSessionID },
        body: {
          ...(modelOverride ? { model: modelOverride } : {}),
          tools: {},
          parts: [{ type: "text", text: prompt }],
        },
        query: { directory },
      });

      const responseData = (response as any).data;
      const textParts = responseData?.parts?.filter((p: any) => p.type === "text") || [];
      const answer = textParts.map((p: any) => p.text).join("");

      if (answer) {
        const { facts, dedup } = parseSummarizerResponse(answer);

        for (const action of dedup) {
          try {
            switch (action.action) {
              case "merge":
                if (action.old_id) {
                  store.update_fact(action.old_id, { content: action.new_content });
                  store.record_feedback(action.old_id, true);
                }
                break;
              case "replace":
                if (action.old_id) {
                  store.record_feedback(action.old_id, false);
                }
                break;
              case "keep_existing":
                if (action.old_id) {
                  store.record_feedback(action.old_id, true);
                }
                break;
              case "keep_new":
                break;
            }
          } catch {}
        }

        for (const { content, category, trust } of facts) {
          try {
            store.add_fact(content, category, "auto-summarized", trust);
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
        }
      }

      // Capture to buffer
      const entryType = !msgInput.agent || msgInput.agent === "user" ? "user" : "assistant";
      buffer.push({
        type: entryType,
        text: text.substring(0, 500),
        time: new Date().toISOString(),
      });
      messageCount++;

      // LLM decides if it's time to summarize
      const sessionID = msgInput.sessionID;
      const directory = (input as any).directory || process.cwd();
      if (shouldSummarizeNow()) {
        triggerSummarization(sessionID, directory);
      }
    },

    "tool.execute.after": async (execution) => {
      try {
        buffer.push({
          type: "tool",
          text: `Tool ${execution.tool}: ${execution.args ? JSON.stringify(execution.args).substring(0, 300) : ""}`,
          time: new Date().toISOString(),
        });
      } catch {}
    },

    "experimental.session.compacting": async (compactionInput, output) => {
      const sessionID = compactionInput.sessionID;
      const directory = (input as any).directory || process.cwd();
      
      // Snapshot buffer before summarization clears it
      const recentEntries = buffer.getAll().slice(-5);
      await triggerSummarization(sessionID, directory);

      // Inject relevant memory via RRF retrieval
      try {
        const recentText = recentEntries.map(e => e.text).join(" ");
        const retriever = new FactRetriever(store);
        const results = recentText ? retriever.search(recentText, undefined, 3) : [];
        if (results.length > 0) {
          output.context.push(
            `=== Relevant Memory ===\n${results.map((r) => r.content).join("\n")}`
          );
        }
      } catch {}
    },
  };
}