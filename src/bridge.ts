/**
 * Bridge to Python MCP Server
 *
 * Communicates with the holographic-memory-mcp Python server via JSON-RPC
 * over stdin/stdout using child_process.
 */

import { spawn } from "child_process";
import type {
  Fact,
  SearchOptions,
  ProbeOptions,
  ReasonOptions,
  ContradictOptions,
  MemoryConfig,
} from "./types.js";

export class MCPBridge {
  private proc: ReturnType<typeof spawn> | null = null;
  private pendingRequests: Map<
    number,
    { resolve: (v: unknown) => void; reject: (e: Error) => void }
  > = new Map();
  private requestId = 0;
  private initialized = false;
  private readonly config: Required<MemoryConfig>;

  constructor(config: MemoryConfig) {
    this.config = {
      mcpServerPath:
        config.mcpServerPath || "/home/twebery/holographic-mcp/server.py",
      autoExtractOnSessionEnd: config.autoExtractOnSessionEnd ?? true,
      defaultCategory: config.defaultCategory || "general",
      minTrustThreshold: config.minTrustThreshold ?? 0.3,
    };
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;

    return new Promise((resolve, reject) => {
      this.proc = spawn("python3", [this.config.mcpServerPath], {
        stdio: ["pipe", "pipe", "pipe"],
      });

      this.proc.on("error", (err) => {
        console.error("[holographic-plugin] Process error:", err);
        reject(err);
      });

      this.proc.on("exit", (code) => {
        console.log(`[holographic-plugin] Process exited with code ${code}`);
        this.proc = null;
        this.initialized = false;
      });

      // Read responses from stdout
      let buffer = "";
      this.proc.stdout?.on("data", (data: Buffer) => {
        buffer += data.toString();
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (line.trim()) {
            try {
              const response = JSON.parse(line);
              this.handleResponse(response);
            } catch (e) {
              console.error("[holographic-plugin] Parse error:", e);
            }
          }
        }
      });

      // Send initialize request
      const reqId = this.nextId();
      const initReq = {
        jsonrpc: "2.0",
        id: reqId,
        method: "initialize",
        params: {
          protocolVersion: "2024-11-05",
          capabilities: {},
          clientInfo: {
            name: "holographic-opencode-plugin",
            version: "1.0.0",
          },
        },
      };

      this.pendingRequests.set(reqId, {
        resolve: () => {
          this.initialized = true;
          resolve();
        },
        reject: reject,
      });

      this.sendRaw(JSON.stringify(initReq));

      // Timeout after 10 seconds
      setTimeout(() => {
        if (!this.initialized) {
          reject(new Error("MCP initialization timeout"));
        }
      }, 10000);
    });
  }

  private sendRaw(data: string): void {
    if (this.proc?.stdin) {
      this.proc.stdin.write(data + "\n");
    }
  }

  private nextId(): number {
    return ++this.requestId;
  }

  private handleResponse(response: {
    id: number;
    result?: unknown;
    error?: { code: number; message: string };
  }): void {
    const pending = this.pendingRequests.get(response.id);
    if (pending) {
      this.pendingRequests.delete(response.id);
      if (response.error) {
        pending.reject(new Error(response.error.message));
      } else {
        pending.resolve(response.result);
      }
    }
  }

  private async sendRequest<T>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    if (!this.proc) {
      throw new Error("MCP process not running");
    }

    const reqId = this.nextId();
    const request = {
      jsonrpc: "2.0",
      id: reqId,
      method,
      params,
    };

    return new Promise((resolve, reject) => {
      this.pendingRequests.set(reqId, {
        resolve: resolve as (v: unknown) => void,
        reject,
      });

      this.sendRaw(JSON.stringify(request));

      // Timeout after 30 seconds
      setTimeout(() => {
        if (this.pendingRequests.has(reqId)) {
          this.pendingRequests.delete(reqId);
          reject(new Error(`Request ${method} timed out`));
        }
      }, 30000);
    });
  }

  // Tool methods
  async addFact(
    content: string,
    category = this.config.defaultCategory,
    tags = ""
  ): Promise<number> {
    const result = (await this.sendRequest<{ content: Array<{ text: string }> }>(
      "tools/call",
      {
        name: "add_fact",
        arguments: { content, category, tags },
      }
    )) as { content: Array<{ text: string }> };

    // Parse "Fact added with ID: X" from response
    const match = result.content[0].text.match(/ID:\s*(\d+)/);
    return match ? parseInt(match[1], 10) : -1;
  }

  async searchFacts(options: SearchOptions): Promise<Fact[]> {
    const result = (await this.sendRequest<{ content: Array<{ text: string }> }>(
      "tools/call",
      {
        name: "search_facts",
        arguments: options,
      }
    )) as { content: Array<{ text: string }> };

    return this.parseFactList(result.content[0].text);
  }

  async listFacts(
    category?: string,
    minTrust?: number,
    limit = 50
  ): Promise<Fact[]> {
    const result = (await this.sendRequest<{ content: Array<{ text: string }> }>(
      "tools/call",
      {
        name: "list_facts",
        arguments: { category, min_trust: minTrust ?? 0.0, limit },
      }
    )) as { content: Array<{ text: string }> };

    return this.parseFactList(result.content[0].text);
  }

  async getFact(factId: number): Promise<Fact | null> {
    const result = (await this.sendRequest<{ content: Array<{ text: string }> }>(
      "tools/call",
      {
        name: "get_fact",
        arguments: { fact_id: factId },
      }
    )) as { content: Array<{ text: string }> };

    const text = result.content[0].text;
    if (text === "Fact not found.") return null;

    const match = text.match(/\[(\d+)\]\s*\(([^,]+),\s*trust=([\d.]+)\)/);
    if (match) {
      return {
        fact_id: parseInt(match[1], 10),
        category: match[2],
        trust_score: parseFloat(match[3]),
        content: text.split("\n").slice(1).join("\n"),
        tags: "",
      };
    }
    return null;
  }

  async removeFact(factId: number): Promise<boolean> {
    const result = (await this.sendRequest<{ content: Array<{ text: string }> }>(
      "tools/call",
      {
        name: "remove_fact",
        arguments: { fact_id: factId },
      }
    )) as { content: Array<{ text: string }> };

    return result.content[0].text === "Fact removed.";
  }

  async recordFeedback(factId: number, helpful: boolean): Promise<{ old: number; new: number }> {
    const result = (await this.sendRequest<{ content: Array<{ text: string }> }>(
      "tools/call",
      {
        name: "record_feedback",
        arguments: { fact_id: factId, helpful },
      }
    )) as { content: Array<{ text: string }> };

    const match = result.content[0].text.match(/([\d.]+)\s*->\s*([\d.]+)/);
    if (match) {
      return { old: parseFloat(match[1]), new: parseFloat(match[2]) };
    }
    return { old: 0, new: 0 };
  }

  async probe(options: ProbeOptions): Promise<Fact[]> {
    const result = (await this.sendRequest<{ content: Array<{ text: string }> }>(
      "tools/call",
      {
        name: "probe",
        arguments: options,
      }
    )) as { content: Array<{ text: string }> };

    return this.parseFactList(result.content[0].text);
  }

  async related(entity: string, category?: string, limit = 10): Promise<Fact[]> {
    const result = (await this.sendRequest<{ content: Array<{ text: string }> }>(
      "tools/call",
      {
        name: "related",
        arguments: { entity, category, limit },
      }
    )) as { content: Array<{ text: string }> };

    return this.parseFactList(result.content[0].text);
  }

  async reason(options: ReasonOptions): Promise<Fact[]> {
    const result = (await this.sendRequest<{ content: Array<{ text: string }> }>(
      "tools/call",
      {
        name: "reason",
        arguments: options,
      }
    )) as { content: Array<{ text: string }> };

    return this.parseFactList(result.content[0].text);
  }

  async contradict(options: ContradictOptions): Promise<Array<{
    fact1: Fact;
    fact2: Fact;
    overlap: number;
    score: number;
  }>> {
    const result = (await this.sendRequest<{ content: Array<{ text: string }> }>(
      "tools/call",
      {
        name: "contradict",
        arguments: options,
      }
    )) as { content: Array<{ text: string }> };

    // Parse contradiction pairs from text
    const facts = this.parseFactList(result.content[0].text);
    // Simplified - return parsed facts
    return facts.map((f) => ({
      fact1: f,
      fact2: f,
      overlap: 0,
      score: 0,
    }));
  }

  async splitAndAdd(
    content: string,
    category = this.config.defaultCategory,
    tags = ""
  ): Promise<number[]> {
    const result = (await this.sendRequest<{ content: Array<{ text: string }> }>(
      "tools/call",
      {
        name: "split_and_add",
        arguments: { content, category, tags },
      }
    )) as { content: Array<{ text: string }> };

    const match = result.content[0].text.match(/\[(\d+(?:,\s*\[\d+\])*)\]/);
    if (match) {
      return match[1].split(",").map((s) => parseInt(s.replace(/\D/g, ""), 10));
    }
    return [];
  }

  private parseFactList(text: string): Fact[] {
    const facts: Fact[] = [];
    const lines = text.split("\n");

    for (const line of lines) {
      const match = line.match(/\[(\d+)\]\s*\(trust=([\d.]+)\)/);
      if (match) {
        // Extract category if present
        const catMatch = line.match(/\(([^,]+),\s*trust=/);
        facts.push({
          fact_id: parseInt(match[1], 10),
          trust_score: parseFloat(match[2]),
          category: catMatch ? catMatch[1] : "general",
          content: line.replace(/^\[[\d+]\]\s*\([^)]+\)\s*/, ""),
          tags: "",
        });
      }
    }

    return facts;
  }

  async shutdown(): Promise<void> {
    if (this.proc) {
      this.proc.kill();
      this.proc = null;
      this.initialized = false;
    }
  }
}

// Singleton instance
let bridgeInstance: MCPBridge | null = null;

export async function getBridge(): Promise<MCPBridge> {
  if (!bridgeInstance) {
    bridgeInstance = new MCPBridge({
      mcpServerPath: process.env.HOLOGRAPHIC_MCP_PATH || "/home/twebery/holographic-mcp/server.py",
      autoExtractOnSessionEnd: true,
      defaultCategory: "general",
      minTrustThreshold: 0.3,
    });
    await bridgeInstance.initialize();
  }
  return bridgeInstance;
}

export async function shutdownBridge(): Promise<void> {
  if (bridgeInstance) {
    await bridgeInstance.shutdown();
    bridgeInstance = null;
  }
}
