// Holographic Memory OpenCode Plugin - Type Definitions

export interface Fact {
  fact_id: number;
  content: string;
  category: string;
  tags: string;
  trust_score: number;
  created_at?: string;
  updated_at?: string;
}

export interface SearchOptions {
  query: string;
  category?: string;
  min_trust?: number;
  limit?: number;
}

export interface ProbeOptions {
  entity: string;
  category?: string;
  limit?: number;
}

export interface ReasonOptions {
  entities: string[];
  category?: string;
  limit?: number;
}

export interface ContradictOptions {
  category?: string;
  threshold?: number;
  limit?: number;
}

export interface MemoryConfig {
  mcpServerPath: string;
  autoExtractOnSessionEnd: boolean;
  defaultCategory: string;
  minTrustThreshold: number;
}

export interface ToolExecution {
  tool: string;
  sessionID: string;
  callID: string;
  args: Record<string, unknown>;
  output?: string;
  title?: string;
}

export interface ChatMessage {
  sessionID: string;
  agent?: string;
  messageID?: string;
}

export interface CompactionContext {
  sessionID: string;
  context: string[];
}
