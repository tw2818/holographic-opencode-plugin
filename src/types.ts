// Holographic Memory OpenCode Plugin - Type Definitions

export interface Fact {
  fact_id: number;
  content: string;
  category: string;
  tags: string;
  trust_score: number;
  retrieval_count: number;
  helpful_count: number;
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

// RRF Retrieval Types
export interface RetrievalResult {
  fact_id: number;
  content: string;
  category: string;
  tags: string[];
  trust_score: number;
  relevance_score: number;
  source: "fts" | "jaccard" | "hrr" | "hybrid";
}

export interface RetrievalOptions {
  query: string;
  categories?: string[];
  min_trust?: number;
  limit?: number;
  entity_filter?: string[];
  include_source?: boolean;
}

export interface RankedItem {
  fact_id: number;
  rank: number;
  score: number;
  source: "fts" | "jaccard" | "hrr";
}

// Memory Bank
export interface MemoryBank {
  bank_id: number;
  bank_name: string;
  vector: Uint8Array;
  dim: number;
  fact_count: number;
  updated_at: string;
}

// Entity
export interface Entity {
  entity_id: number;
  name: string;
  entity_type: string;
  aliases: string;
  created_at: string;
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

export interface HolographicMemoryConfig {
  summarizerModel?: string;
  bufferSize?: number;
  messageThreshold?: number;
  enabled?: boolean;
}
