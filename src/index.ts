import type { Plugin } from "@opencode-ai/plugin";
import { getBridge, shutdownBridge } from "./bridge.js";
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
import { createChatHooks } from "./hooks/chat.js";
import { createToolHooks } from "./hooks/tool.js";
import { createSessionHooks } from "./hooks/session.js";

export const HolographicMemoryPlugin: Plugin = async () => {
  console.log("[holographic-plugin] Initializing...");

  try {
    const bridge = await getBridge();
    console.log("[holographic-plugin] MCP bridge initialized");
  } catch (e) {
    console.error("[holographic-plugin] Failed to initialize MCP bridge:", e);
  }

  return {
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

    ...createChatHooks(),
    ...createToolHooks(),
    ...createSessionHooks(),

    async shutdown() {
      console.log("[holographic-plugin] Shutting down...");
      await shutdownBridge();
    },
  };
};

export default HolographicMemoryPlugin;
