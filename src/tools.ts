import { tool, type ToolDefinition } from "@opencode-ai/plugin";
import { homedir } from "os";
import { join } from "path";
import { MemoryStore } from "./store.js";
import { FactRetriever } from "./retriever.js";

const DB_PATH = join(homedir(), ".config", "opencode", "holographic_memory", "memory_store.db");
let store: MemoryStore | null = null;
let retriever: FactRetriever | null = null;

function getStore(): MemoryStore {
  if (!store) store = new MemoryStore(DB_PATH);
  return store;
}
function getRetriever(): FactRetriever {
  if (!retriever) retriever = new FactRetriever(getStore());
  return retriever;
}

export const memory_search: ToolDefinition = tool({
  description:
    "Search the user's persistent memory using holographic retrieval. " +
    "Use when user asks 'what do you remember', 'do you know about X', " +
    "'find facts about Y', or similar memory queries.",
  args: {
    query: tool.schema.string().describe("Natural language search query"),
    category: tool.schema.string().optional().describe("Category: preferences, facts, projects, lessons, people"),
    limit: tool.schema.number().optional().describe("Maximum results (default: 10)"),
  },
  async execute(args) {
    try {
      const results = getRetriever().search(args.query, args.category, args.limit || 10);
      if (results.length === 0) return "No matching facts found.";
      return results
        .map((r) =>
          `[${r.fact_id}] (${r.category}, trust=${r.trust_score.toFixed(2)}, relevance=${r.relevance_score.toFixed(3)})\n  ${r.content}`
        )
        .join("\n\n");
    } catch (error) {
      return `Search error: ${error}`;
    }
  },
});

export const memory_remember: ToolDefinition = tool({
  description:
    "Store a fact in the user's persistent memory. " +
    "Use when user says 'remember that X', 'note that Y', 'I prefer Z'.",
  args: {
    content: tool.schema.string().describe("The fact to remember"),
    category: tool.schema.string().optional().describe("Category (default: general)"),
    tags: tool.schema.string().optional().describe("Comma-separated tags"),
  },
  async execute(args) {
    try {
      const factId = getStore().add_fact(args.content, args.category || "general", args.tags || "");
      return `Stored fact with ID: ${factId}`;
    } catch (error) {
      return `Error storing fact: ${error}`;
    }
  },
});

export const memory_forget: ToolDefinition = tool({
  description: "Remove a fact from memory by ID.",
  args: {
    fact_id: tool.schema.number().describe("The fact ID to remove"),
  },
  async execute(args) {
    try {
      const success = getStore().remove_fact(args.fact_id);
      return success ? "Fact removed." : "Fact not found.";
    } catch (error) {
      return `Error removing fact: ${error}`;
    }
  },
});

export const memory_list: ToolDefinition = tool({
  description: "List all facts in memory, optionally filtered by category.",
  args: {
    category: tool.schema.string().optional().describe("Category filter"),
    min_trust: tool.schema.number().optional().describe("Minimum trust score (0-1)"),
    limit: tool.schema.number().optional().describe("Maximum results"),
  },
  async execute(args) {
    try {
      const facts = getStore().list_facts(
        args.category,
        args.min_trust ?? 0,
        args.limit || 50
      );
      if (facts.length === 0) return "No facts stored.";
      return facts
        .map((f) =>
          `[${f.fact_id}] (${f.category}, trust=${f.trust_score.toFixed(2)})\n  ${f.content}`
        )
        .join("\n\n");
    } catch (error) {
      return `Error listing facts: ${error}`;
    }
  },
});

export const memory_profile: ToolDefinition = tool({
  description: "Get a comprehensive profile of the user from memory.",
  args: {
    categories: tool.schema.string().optional().describe("Comma-separated categories"),
  },
  async execute(args) {
    try {
      const cats = args.categories
        ? args.categories.split(",").map((s: string) => s.trim())
        : ["preferences", "facts", "projects", "lessons"];

      const lines: string[] = ["=== User Memory Profile ===\n"];
      for (const cat of cats) {
        const facts = getStore().list_facts(cat, 0.3, 20);
        if (facts.length > 0) {
          lines.push(`## ${cat.charAt(0).toUpperCase() + cat.slice(1)}`);
          for (const fact of facts) {
            lines.push(`  • ${fact.content}`);
          }
          lines.push("");
        }
      }
      return lines.join("\n") || "No profile data available.";
    } catch (error) {
      return `Error getting profile: ${error}`;
    }
  },
});

export const memory_probe: ToolDefinition = tool({
  description:
    "HRR algebraic probe - find facts structurally bound to an entity.",
  args: {
    entity: tool.schema.string().describe("Entity to probe"),
    category: tool.schema.string().optional().describe("Category filter"),
    limit: tool.schema.number().optional().describe("Maximum results"),
  },
  async execute(args) {
    try {
      const results = getRetriever().probe(args.entity, args.category, args.limit || 10);
      if (results.length === 0) return "No probe results.";
      return results
        .map((r) =>
          `[${r.fact_id}] (${r.category}, trust=${r.trust_score.toFixed(2)}, relevance=${r.relevance_score.toFixed(3)})\n  ${r.content}`
        )
        .join("\n\n");
    } catch (error) {
      return `Probe error: ${error}`;
    }
  },
});

export const memory_feedback: ToolDefinition = tool({
  description: "Record feedback on a stored fact.",
  args: {
    fact_id: tool.schema.number().describe("The fact ID"),
    helpful: tool.schema.boolean().describe("True if helpful"),
  },
  async execute(args) {
    try {
      const result = getStore().record_feedback(args.fact_id, args.helpful);
      return `Trust: ${result.old_trust.toFixed(2)} → ${result.new_trust.toFixed(2)}`;
    } catch (error) {
      return `Feedback error: ${error}`;
    }
  },
});

export const memory_reason: ToolDefinition = tool({
  description:
    "Multi-entity reasoning - find facts related to ALL specified entities.",
  args: {
    entities: tool.schema.array(tool.schema.string()).describe("List of entities"),
    category: tool.schema.string().optional().describe("Category filter"),
    limit: tool.schema.number().optional().describe("Maximum results"),
  },
  async execute(args) {
    try {
      const results = getRetriever().reason(args.entities, args.category, args.limit || 10);
      if (results.length === 0) return "No reasoning results.";
      return results
        .map((r) =>
          `[${r.fact_id}] (${r.category}, trust=${r.trust_score.toFixed(2)}, relevance=${r.relevance_score.toFixed(3)})\n  ${r.content}`
        )
        .join("\n\n");
    } catch (error) {
      return `Reasoning error: ${error}`;
    }
  },
});

export const memory_contradict: ToolDefinition = tool({
  description: "Find potentially contradictory facts.",
  args: {
    category: tool.schema.string().optional().describe("Category filter"),
    threshold: tool.schema.number().optional().describe("Contradiction threshold (0-1)"),
    limit: tool.schema.number().optional().describe("Maximum pairs"),
  },
  async execute(args) {
    try {
      const pairs = getRetriever().contradict(args.category, args.threshold ?? 0.5, args.limit || 10);
      if (pairs.length === 0) return "No contradictions found.";
      return pairs
        .map(
          (p) =>
            `[${p.fact1.fact_id}] vs [${p.fact2.fact_id}] (score=${p.contradiction_score.toFixed(3)})\n  A: ${p.fact1.content.substring(0, 60)}\n  B: ${p.fact2.content.substring(0, 60)}`
        )
        .join("\n\n");
    } catch (error) {
      return `Contradiction detection error: ${error}`;
    }
  },
});