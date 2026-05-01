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

export interface RankedItem {
  fact_id: number;
  rank: number;
  score: number;
  source: "fts" | "jaccard" | "hrr";
}
