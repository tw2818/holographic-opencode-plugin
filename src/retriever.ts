import { MemoryStore } from "./store.js";
import {
  encode_text,
  encode_atom,
  bind,
  unbind,
  similarity,
  ROLE_CONTENT,
  ROLE_ENTITY,
  DIM_DEFAULT,
} from "./hrr.js";
import type { Fact, RetrievalResult } from "./types.js";

const RRF_C = 60;
const MAX_CONTRADICTION_FACTS = 500;

// Entity extraction patterns (same as store.ts)
const ENTITY_PATTERNS = [
  /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)\b/g,
  /"([^"]+)"/g,
  /'([^']+)'/g,
  /\b([A-Z]{2,})\b/g,
  /\b([a-z]+(?:[0-9]+[a-z]*)+)\b/gi,
  /(\w+(?:\s+\w+)*)\s+(?:aka|also known as)\s+(\w+(?:\s+\w+)*)/gi,
];

export interface ContradictionPair {
  fact1: RetrievalResult;
  fact2: RetrievalResult;
  entity_overlap: number;
  content_similarity: number;
  contradiction_score: number;
}

export class FactRetriever {
  constructor(private store: MemoryStore) {}

  /**
   * Hybrid search combining FTS5, Jaccard, and HRR similarity via RRF fusion.
   */
  search(query: string, category?: string, limit = 10): RetrievalResult[] {
    if (!query?.trim()) {
      return this.store.list_facts(category, 0.3, limit).map((f) => ({
        fact_id: f.fact_id,
        content: f.content,
        category: f.category,
        tags: f.tags ? f.tags.split(",").filter(Boolean) : [],
        trust_score: f.trust_score,
        relevance_score: 0,
        source: "fts" as const,
      }));
    }

    // Step 1: FTS5 candidates (get 3x limit for better RRF)
    const ftsCandidates = this.store.search_facts(query, category, 0.3, limit * 3);
    if (ftsCandidates.length === 0) {
      return [];
    }

    const ftsIds = ftsCandidates.map((f) => f.fact_id);

    // Step 2: Jaccard ranking
    const queryTokens = this.tokenize(query);
    const jaccardScores = new Map<number, { score: number; rank: number }>();
    const jaccardResults: { fact_id: number; score: number }[] = [];
    ftsCandidates.forEach((fact) => {
      const factTokens = this.tokenize(fact.content + " " + fact.tags);
      const score = this.jaccard(queryTokens, factTokens);
      jaccardResults.push({ fact_id: fact.fact_id, score });
    });
    // Sort by Jaccard score descending for independent ranking
    jaccardResults.sort((a, b) => b.score - a.score);
    jaccardResults.forEach((r, idx) => {
      jaccardScores.set(r.fact_id, { score: r.score, rank: idx + 1 });
    });

    // Step 3: HRR ranking
    const queryVec = encode_text(query, DIM_DEFAULT);
    const factVectors = this.store.get_facts_with_vectors(ftsIds);
    const hrrScores = new Map<number, { score: number; rank: number }>();

    // Compute HRR similarities and rank
    const hrrResults: { fact_id: number; sim: number }[] = [];
    for (const [fact_id, vec] of factVectors) {
      const sim = similarity(queryVec, vec);
      hrrResults.push({ fact_id, sim });
    }
    // Sort by similarity descending for ranking
    hrrResults.sort((a, b) => b.sim - a.sim);
    hrrResults.forEach((r, idx) => {
      hrrScores.set(r.fact_id, { score: r.sim, rank: idx + 1 });
    });

    // Step 4: RRF fusion
    const fusedScores = new Map<
      number,
      { score: number; fts_rank: number; jaccard_rank: number; hrr_rank: number; trust: number }
    >();

    ftsCandidates.forEach((fact, idx) => {
      const fts_rank = idx + 1;
      const jaccard = jaccardScores.get(fact.fact_id)!;
      const hrr = hrrScores.get(fact.fact_id);
      if (!hrr) return; // skip if no HRR vector

      // RRF formula: C / (rank + C)
      const rrfScore =
        RRF_C / (fts_rank + RRF_C) +
        RRF_C / (jaccard.rank + RRF_C) +
        RRF_C / (hrr.rank + RRF_C);

      fusedScores.set(fact.fact_id, {
        score: rrfScore * fact.trust_score,
        fts_rank,
        jaccard_rank: jaccard.rank,
        hrr_rank: hrr.rank,
        trust: fact.trust_score,
      });
    });

    // Step 5: Sort and cap at limit
    const sorted = Array.from(fusedScores.entries())
      .sort(([, a], [, b]) => b.score - a.score)
      .slice(0, limit);

    return sorted.map(([fact_id, data]) => {
      const fact = ftsCandidates.find((f) => f.fact_id === fact_id)!;
      return {
        fact_id,
        content: fact.content,
        category: fact.category,
        tags: fact.tags ? fact.tags.split(",").filter(Boolean) : [],
        trust_score: fact.trust_score,
        relevance_score: data.score,
        source: "hybrid" as const,
      };
    });
  }

  /**
   * Probe memory bank for facts related to an entity using HRR unbinding.
   */
  probe(entity: string, category?: string, limit = 10): RetrievalResult[] {
    // If no category specified, try each bank until one matches
    if (!category) {
      const categories = ["preferences", "facts", "lessons", "projects"];
      for (const cat of categories) {
        const result = this.probe(entity, cat, limit);
        if (result.length > 0) return result;
      }
      return [];
    }

    // Step 1: Encode entity as HRR atom
    const entityVec = encode_atom(entity, DIM_DEFAULT);

    // Step 3: Create probe key by binding entity to ROLE_ENTITY
    const roleEntity = encode_atom(ROLE_ENTITY, DIM_DEFAULT);
    const probeKey = bind(entityVec, roleEntity);

    // Step 4: Get facts in category and compute similarity scores
    const facts = this.store.list_facts(category, 0.0, 100);
    if (facts.length === 0) {
      return [];
    }

    const factIds = facts.map((f) => f.fact_id);
    const factVectors = this.store.get_facts_with_vectors(factIds);

    // Encode role content for comparison
    const roleContent = encode_atom(ROLE_CONTENT, DIM_DEFAULT);

    const scoredFacts: { fact: Fact; score: number }[] = [];

    for (const fact of facts) {
      const factVec = factVectors.get(fact.fact_id);
      if (!factVec) continue;

      // Unbind fact vector with probe key to get residual
      const residual = unbind(factVec, probeKey);

      // Bind encoded content with role to create content vector
      const contentVec = encode_text(fact.content, DIM_DEFAULT);
      const boundContent = bind(contentVec, roleContent);

      // Compute similarity between residual and bound content
      const sim = similarity(residual, boundContent);

      // Normalize from [-1, 1] to [0, 1] and apply trust
      const normalizedScore = ((sim + 1.0) / 2.0) * fact.trust_score;
      scoredFacts.push({ fact, score: normalizedScore });
    }

    // Sort by score descending and cap at limit
    scoredFacts.sort((a, b) => b.score - a.score);
    return scoredFacts.slice(0, limit).map(({ fact, score }) => ({
      fact_id: fact.fact_id,
      content: fact.content,
      category: fact.category,
      tags: fact.tags ? fact.tags.split(",").filter(Boolean) : [],
      trust_score: fact.trust_score,
      relevance_score: score,
      source: "hrr" as const,
    }));
  }

  /**
   * Find facts related to ALL specified entities using multi-probe HRR reasoning.
   */
  reason(entities: string[], category?: string, limit = 10): RetrievalResult[] {
    if (entities.length === 0) {
      return [];
    }

    // Step 1: Create probe keys for each entity
    const roleEntity = encode_atom(ROLE_ENTITY, DIM_DEFAULT);
    const entityProbeKeys = entities.map((entity) => {
      const entityAtom = encode_atom(entity, DIM_DEFAULT);
      return bind(entityAtom, roleEntity);
    });

    // Step 2: Get facts and their vectors
    const facts = this.store.list_facts(category, 0.0, 100);
    if (facts.length === 0) {
      return [];
    }

    const factIds = facts.map((f) => f.fact_id);
    const factVectors = this.store.get_facts_with_vectors(factIds);

    // Encode role content for comparison
    const roleContent = encode_atom(ROLE_CONTENT, DIM_DEFAULT);

    // Step 3: Score each fact against all entity probes (AND semantics)
    const scoredFacts: { fact: Fact; score: number; allPositive: boolean }[] = [];

    for (const fact of facts) {
      const factVec = factVectors.get(fact.fact_id);
      if (!factVec) continue;

      const entitySimilarities: number[] = [];

      for (const probeKey of entityProbeKeys) {
        // Unbind fact vector with entity probe key
        const residual = unbind(factVec, probeKey);

        // Create content vector bound to role
        const contentVec = encode_text(fact.content, DIM_DEFAULT);
        const boundContent = bind(contentVec, roleContent);

        // Compute similarity
        const sim = similarity(residual, boundContent);
        entitySimilarities.push(sim);
      }

      // AND gate: use minimum similarity
      const minSim = Math.min(...entitySimilarities);
      const allPositive = entitySimilarities.every((s) => s > 0);
      const normalizedScore = ((minSim + 1.0) / 2.0) * fact.trust_score;

      scoredFacts.push({ fact, score: normalizedScore, allPositive });
    }

    // Step 4: Filter to facts where ALL entities have positive similarity, then sort
    const filtered = scoredFacts
      .filter((sf) => sf.allPositive)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);

    return filtered.map(({ fact, score }) => ({
      fact_id: fact.fact_id,
      content: fact.content,
      category: fact.category,
      tags: fact.tags ? fact.tags.split(",").filter(Boolean) : [],
      trust_score: fact.trust_score,
      relevance_score: score,
      source: "hrr" as const,
    }));
  }

  /**
   * Find potentially contradictory fact pairs based on entity overlap and content similarity.
   */
  contradict(category?: string, threshold = 0.5, limit = 10): ContradictionPair[] {
    // Step 1: Get all facts in category (limit to avoid O(n²) explosion)
    let facts = this.store.list_facts(category, 0.0, MAX_CONTRADICTION_FACTS);

    if (facts.length < 2) {
      return [];
    }

    // Step 2: Extract entities for each fact
    const factEntities = facts.map((f) => ({
      fact: f,
      entities: new Set(this.extract_entities(f.content)),
    }));

    // Step 3: Get HRR vectors for similarity computation
    const factIds = facts.map((f) => f.fact_id);
    const factVectors = this.store.get_facts_with_vectors(factIds);

    // Step 4: Compare each pair
    const pairs: ContradictionPair[] = [];

    for (let i = 0; i < factEntities.length; i++) {
      for (let j = i + 1; j < factEntities.length; j++) {
        const { fact: fact1, entities: entities1 } = factEntities[i];
        const { fact: fact2, entities: entities2 } = factEntities[j];

        // Compute entity overlap (Jaccard)
        const union = new Set([...entities1, ...entities2]);
        const intersection = new Set([...entities1].filter((e) => entities2.has(e)));
        const entityOverlap = union.size > 0 ? intersection.size / union.size : 0;

        // Skip if no entity overlap
        if (entityOverlap === 0) continue;

        // Compute HRR content similarity
        const vec1 = factVectors.get(fact1.fact_id);
        const vec2 = factVectors.get(fact2.fact_id);
        if (!vec1 || !vec2) continue;

        const contentSim = similarity(vec1, vec2);

        // Compute contradiction score: high entity overlap + low content similarity
        // = potential contradiction
        const contradictionScore = entityOverlap * (1.0 - (contentSim + 1.0) / 2.0);

        if (contradictionScore > threshold) {
          pairs.push({
            fact1: {
              fact_id: fact1.fact_id,
              content: fact1.content,
              category: fact1.category,
              tags: fact1.tags ? fact1.tags.split(",").filter(Boolean) : [],
              trust_score: fact1.trust_score,
              relevance_score: entityOverlap,
              source: "hrr",
            },
            fact2: {
              fact_id: fact2.fact_id,
              content: fact2.content,
              category: fact2.category,
              tags: fact2.tags ? fact2.tags.split(",").filter(Boolean) : [],
              trust_score: fact2.trust_score,
              relevance_score: entityOverlap,
              source: "hrr",
            },
            entity_overlap: entityOverlap,
            content_similarity: contentSim,
            contradiction_score: contradictionScore,
          });
        }
      }
    }

    // Step 5: Sort by contradiction score and cap at limit
    return pairs.sort((a, b) => b.contradiction_score - a.contradiction_score).slice(0, limit);
  }

  // Private helpers

  /**
   * Tokenize text into lowercase word set.
   */
  private tokenize(text: string): Set<string> {
    return new Set(
      text
        .toLowerCase()
        .split(/\s+/)
        .map((token) => token.replace(/[^\w]/g, ""))
        .filter((token) => token.length > 0)
    );
  }

  /**
   * Compute Jaccard coefficient between two token sets.
   */
  private jaccard(a: Set<string>, b: Set<string>): number {
    if (a.size === 0 && b.size === 0) return 0;
    const intersection = new Set([...a].filter((x) => b.has(x)));
    const union = new Set([...a, ...b]);
    return union.size > 0 ? intersection.size / union.size : 0;
  }

  /**
   * Extract entities from content using regex patterns.
   */
  private extract_entities(content: string): string[] {
    const entities = new Set<string>();

    for (const pattern of ENTITY_PATTERNS) {
      const regex = new RegExp(pattern.source, pattern.flags);
      let match: RegExpExecArray | null;
      while ((match = regex.exec(content)) !== null) {
        if (match.length > 1) {
          for (let i = 1; i < match.length; i++) {
            if (match[i] && match[i].trim()) {
              entities.add(match[i].trim());
            }
          }
        } else if (match[0]) {
          entities.add(match[0].trim());
        }
      }
    }

    return Array.from(entities);
  }
}