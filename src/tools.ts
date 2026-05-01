import { tool } from "@opencode-ai/plugin";
import { getBridge } from "./bridge.js";

export const memory_search = tool({
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
    const bridge = await getBridge();
    const facts = await bridge.searchFacts({
      query: args.query,
      category: args.category,
      limit: args.limit || 10,
    });
    if (facts.length === 0) return "No matching facts found.";
    return facts
      .map(
        (f) =>
          `[${f.fact_id}] (${f.category}, trust=${f.trust_score.toFixed(2)})\n  ${f.content}`
      )
      .join("\n\n");
  },
});

export const memory_remember = tool({
  description:
    "Store a fact in the user's persistent memory. " +
    "Use when user says 'remember that X', 'note that Y', 'I prefer Z'.",
  args: {
    content: tool.schema.string().describe("The fact to remember"),
    category: tool.schema.string().optional().describe("Category (default: general)"),
    tags: tool.schema.string().optional().describe("Comma-separated tags"),
  },
  async execute(args) {
    const bridge = await getBridge();
    const factId = await bridge.addFact(
      args.content,
      args.category || "general",
      args.tags || ""
    );
    return `Stored fact with ID: ${factId}`;
  },
});

export const memory_forget = tool({
  description: "Remove a fact from memory by ID.",
  args: {
    fact_id: tool.schema.number().describe("The fact ID to remove"),
  },
  async execute(args) {
    const bridge = await getBridge();
    const success = await bridge.removeFact(args.fact_id);
    return success ? "Fact removed." : "Fact not found.";
  },
});

export const memory_list = tool({
  description: "List all facts in memory, optionally filtered by category.",
  args: {
    category: tool.schema.string().optional().describe("Category filter"),
    min_trust: tool.schema.number().optional().describe("Minimum trust score (0-1)"),
    limit: tool.schema.number().optional().describe("Maximum results"),
  },
  async execute(args) {
    const bridge = await getBridge();
    const facts = await bridge.listFacts(
      args.category,
      args.min_trust,
      args.limit || 50
    );
    if (facts.length === 0) return "No facts stored.";
    return facts
      .map(
        (f) =>
          `[${f.fact_id}] (${f.category}, trust=${f.trust_score.toFixed(2)})\n  ${f.content}`
      )
      .join("\n\n");
  },
});

export const memory_profile = tool({
  description: "Get a comprehensive profile of the user from memory.",
  args: {
    categories: tool.schema.string().optional().describe("Comma-separated categories"),
  },
  async execute(args) {
    const bridge = await getBridge();
    const cats = args.categories
      ? args.categories.split(",").map((s: string) => s.trim())
      : ["preferences", "facts", "projects", "lessons"];

    const lines: string[] = ["=== User Memory Profile ===\n"];
    for (const cat of cats) {
      const facts = await bridge.listFacts(cat, 0.3, 20);
      if (facts.length > 0) {
        lines.push(`## ${cat.charAt(0).toUpperCase() + cat.slice(1)}`);
        for (const fact of facts) {
          lines.push(`  • ${fact.content}`);
        }
        lines.push("");
      }
    }
    return lines.join("\n") || "No profile data available.";
  },
});

export const memory_probe = tool({
  description:
    "HRR algebraic probe - find facts structurally bound to an entity.",
  args: {
    entity: tool.schema.string().describe("Entity to probe"),
    category: tool.schema.string().optional().describe("Category filter"),
    limit: tool.schema.number().optional().describe("Maximum results"),
  },
  async execute(args) {
    const bridge = await getBridge();
    const facts = await bridge.probe({
      entity: args.entity,
      category: args.category,
      limit: args.limit || 10,
    });
    if (facts.length === 0) return "No probe results.";
    return facts
      .map(
        (f) =>
          `[${f.fact_id}] (${f.category}, trust=${f.trust_score.toFixed(2)})\n  ${f.content}`
      )
      .join("\n\n");
  },
});

export const memory_feedback = tool({
  description: "Record feedback on a stored fact.",
  args: {
    fact_id: tool.schema.number().describe("The fact ID"),
    helpful: tool.schema.boolean().describe("True if helpful"),
  },
  async execute(args) {
    const bridge = await getBridge();
    const result = await bridge.recordFeedback(args.fact_id, args.helpful);
    return `Trust: ${result.old.toFixed(2)} → ${result.new.toFixed(2)}`;
  },
});

export const memory_reason = tool({
  description:
    "Multi-entity reasoning - find facts related to ALL specified entities.",
  args: {
    entities: tool.schema.array(tool.schema.string()).describe("List of entities"),
    category: tool.schema.string().optional().describe("Category filter"),
    limit: tool.schema.number().optional().describe("Maximum results"),
  },
  async execute(args) {
    const bridge = await getBridge();
    const facts = await bridge.reason({
      entities: args.entities,
      category: args.category,
      limit: args.limit || 10,
    });
    if (facts.length === 0) return "No reasoning results.";
    return facts
      .map(
        (f) =>
          `[${f.fact_id}] (${f.category}, trust=${f.trust_score.toFixed(2)})\n  ${f.content}`
      )
      .join("\n\n");
  },
});

export const memory_contradict = tool({
  description: "Find potentially contradictory facts.",
  args: {
    category: tool.schema.string().optional().describe("Category filter"),
    threshold: tool.schema.number().optional().describe("Contradiction threshold (0-1)"),
    limit: tool.schema.number().optional().describe("Maximum pairs"),
  },
  async execute(args) {
    const bridge = await getBridge();
    const pairs = await bridge.contradict({
      category: args.category,
      threshold: args.threshold,
      limit: args.limit || 10,
    });
    if (pairs.length === 0) return "No contradictions found.";
    return pairs
      .map(
        (p) =>
          `[${p.fact1.fact_id}] vs [${p.fact2.fact_id}]\n  A: ${p.fact1.content.substring(0, 60)}\n  B: ${p.fact2.content.substring(0, 60)}`
      )
      .join("\n\n");
  },
});
