import { tool, type ToolDefinition } from "@opencode-ai/plugin";
import { homedir } from "os";
import { join } from "path";
import { MemoryStore } from "./store.js";
import { encode_fact, similarity as hrr_similarity } from "./hrr.js";
import type { Fact } from "./types.js";

const DB_PATH = join(homedir(), ".config", "opencode", "holographic_memory", "memory_store.db");
let store: MemoryStore | null = null;

function getStore(): MemoryStore {
  if (!store) store = new MemoryStore(DB_PATH);
  return store;
}

function format_fact(f: Fact): string {
  return `[${f.fact_id}] (${f.category}, trust=${f.trust_score.toFixed(2)})\n  ${f.content}`;
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
      const facts = getStore().search_facts(
        args.query,
        args.category,
        0.3,
        args.limit || 10
      );
      if (facts.length === 0) return "No matching facts found.";
      return facts.map(format_fact).join("\n\n");
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
      return facts.map(format_fact).join("\n\n");
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
      const store = getStore();
      const entityVector = encode_fact(args.entity, [args.entity]);
      const facts = store.list_facts(args.category, 0, 100);

      const factIds = facts.map(f => f.fact_id);
      const vectors = store.get_facts_with_vectors(factIds);

      const scoredFacts: Array<{ fact: Fact; score: number }> = [];

      for (const fact of facts) {
        const factVector = vectors.get(fact.fact_id);
        if (!factVector) continue;
        const score = hrr_similarity(entityVector, factVector);
        if (score > 0) {
          scoredFacts.push({ fact, score });
        }
      }

      scoredFacts.sort((a, b) => b.score - a.score);
      const top = scoredFacts.slice(0, args.limit || 10);

      if (top.length === 0) return "No probe results.";
      return top
        .map((item) =>
          `[${item.fact.fact_id}] (${item.fact.category}, trust=${item.fact.trust_score.toFixed(2)})\n  ${item.fact.content}`
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
      const store = getStore();
      const facts = store.list_facts(args.category, 0, 100);

      const factsWithAllEntities = facts.filter((fact) => {
        const content_lower = fact.content.toLowerCase();
        return args.entities.every((entity) =>
          content_lower.includes(entity.toLowerCase())
        );
      });

      const sorted = factsWithAllEntities.sort((a, b) => b.trust_score - a.trust_score);
      const top = sorted.slice(0, args.limit || 10);

      if (top.length === 0) return "No reasoning results.";
      return top
        .map(
          (f) =>
            `[${f.fact_id}] (${f.category}, trust=${f.trust_score.toFixed(2)})\n  ${f.content}`
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
      const store = getStore();
      const facts = store.list_facts(args.category, 0.3, 50);
      const threshold = args.threshold ?? 0.5;
      const contradictingPairs: Array<{ fact1: Fact; fact2: Fact; combinedTrust: number }> = [];

      function textSimilarity(a: string, b: string): number {
        const aWords = new Set(a.toLowerCase().split(/\s+/).filter(w => w.length > 2));
        const bWords = new Set(b.toLowerCase().split(/\s+/).filter(w => w.length > 2));
        const intersection = new Set([...aWords].filter(x => bWords.has(x)));
        const union = new Set([...aWords, ...bWords]);
        return union.size > 0 ? intersection.size / union.size : 0;
      }

      for (let i = 0; i < facts.length; i++) {
        for (let j = i + 1; j < facts.length; j++) {
          const sim = textSimilarity(facts[i].content, facts[j].content);
          if (sim < threshold && facts[i].trust_score >= 0.3 && facts[j].trust_score >= 0.3) {
            contradictingPairs.push({
              fact1: facts[i],
              fact2: facts[j],
              combinedTrust: facts[i].trust_score + facts[j].trust_score,
            });
          }
        }
      }

      contradictingPairs.sort((a, b) => b.combinedTrust - a.combinedTrust);
      const top = contradictingPairs.slice(0, args.limit || 10);

      if (top.length === 0) return "No contradictions found.";
      return top
        .map(
          (p) =>
            `[${p.fact1.fact_id}] vs [${p.fact2.fact_id}]\n  A: ${p.fact1.content.substring(0, 60)}\n  B: ${p.fact2.content.substring(0, 60)}`
        )
        .join("\n\n");
    } catch (error) {
      return `Contradiction detection error: ${error}`;
    }
  },
});