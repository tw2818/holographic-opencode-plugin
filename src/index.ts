import type { Plugin } from "@opencode-ai/plugin";
import {
  memory_search, memory_remember, memory_forget, memory_list,
  memory_profile, memory_probe, memory_feedback, memory_reason, memory_contradict,
} from "./tools.js";
import { createMemoryHooks } from "./hooks/memory-hooks-factory.js";

export * from "./tools.js";

const plugin: Plugin = async (input) => ({
  id: "holographic-memory",
  tool: {
    memory_search, memory_remember, memory_forget, memory_list,
    memory_profile, memory_probe, memory_feedback, memory_reason, memory_contradict,
  },
  ...createMemoryHooks(input),
});

export default { id: "holographic-memory", server: plugin };