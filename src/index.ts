import type { Plugin } from "@opencode-ai/plugin";
import {
  memory_search,
  memory_remember,
  memory_forget,
  memory_list,
  memory_profile,
  memory_probe,
  memory_feedback,
  memory_reason,
  memory_contradict,
} from "./tools.js";
import { memoryHooks } from "./hooks/memory-hooks.js";

export * from "./tools.js";

const plugin: Plugin = async () => ({
  tool: {
    memory_search,
    memory_remember,
    memory_forget,
    memory_list,
    memory_profile,
    memory_probe,
    memory_feedback,
    memory_reason,
    memory_contradict,
  },
  ...memoryHooks,
});

export default { server: plugin };