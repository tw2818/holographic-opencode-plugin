import type { Fact } from "./types.js";
import { encode_fact, encode_text, phases_to_bytes, bytes_to_phases, bundle, snr_estimate, similarity } from "./hrr.js";
import { Database } from "bun:sqlite";
import { mkdirSync, existsSync } from "fs";
import { homedir } from "os";
import { join } from "path";

const TRUST_HELPFUL = 0.05;
const TRUST_UNHELPFUL = -0.10;
const DEFAULT_TRUST = 0.5;
const MIN_TRUST = 0.0;
const MAX_TRUST = 1.0;
const MIN_TRUST_THRESHOLD = 0.3;

const ENTITY_PATTERNS = [
  /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)\b/g,
  /"([^"]+)"/g,
  /'([^']+)'/g,
  /\b([A-Z]{2,})\b/g,
  /\b([a-z]+(?:[0-9]+[a-z]*)+)\b/gi,
  /(\w+(?:\s+\w+)*)\s+(?:aka|also known as)\s+(\w+(?:\s+\w+)*)/gi,
];

const SCHEMA = `
CREATE TABLE IF NOT EXISTS facts (
    fact_id         INTEGER PRIMARY KEY AUTOINCREMENT,
    content         TEXT NOT NULL UNIQUE,
    category        TEXT DEFAULT 'general',
    tags            TEXT DEFAULT '',
    trust_score     REAL DEFAULT 0.5,
    retrieval_count INTEGER DEFAULT 0,
    helpful_count   INTEGER DEFAULT 0,
    created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    hrr_vector      BLOB
);

CREATE TABLE IF NOT EXISTS entities (
    entity_id   INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT NOT NULL,
    entity_type TEXT DEFAULT 'unknown',
    aliases     TEXT DEFAULT '',
    created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS fact_entities (
    fact_id   INTEGER REFERENCES facts(fact_id),
    entity_id INTEGER REFERENCES entities(entity_id),
    PRIMARY KEY (fact_id, entity_id)
);

CREATE INDEX IF NOT EXISTS idx_facts_trust    ON facts(trust_score DESC);
CREATE INDEX IF NOT EXISTS idx_facts_category ON facts(category);
CREATE INDEX IF NOT EXISTS idx_entities_name  ON entities(name);

CREATE VIRTUAL TABLE IF NOT EXISTS facts_fts
    USING fts5(content, tags, content=facts, content_rowid=fact_id);

CREATE TRIGGER IF NOT EXISTS facts_ai AFTER INSERT ON facts BEGIN
    INSERT INTO facts_fts(rowid, content, tags)
        VALUES (new.fact_id, new.content, new.tags);
END;

CREATE TRIGGER IF NOT EXISTS facts_ad AFTER DELETE ON facts BEGIN
    INSERT INTO facts_fts(facts_fts, rowid, content, tags)
        VALUES ('delete', old.fact_id, old.content, old.tags);
END;

CREATE TRIGGER IF NOT EXISTS facts_au AFTER UPDATE ON facts BEGIN
    INSERT INTO facts_fts(facts_fts, rowid, content, tags)
        VALUES ('delete', old.fact_id, old.content, old.tags);
    INSERT INTO facts_fts(rowid, content, tags)
        VALUES (new.fact_id, new.content, new.tags);
END;

CREATE TABLE IF NOT EXISTS memory_banks (
    bank_id    INTEGER PRIMARY KEY AUTOINCREMENT,
    bank_name  TEXT NOT NULL UNIQUE,
    vector     BLOB NOT NULL,
    dim        INTEGER NOT NULL,
    fact_count INTEGER DEFAULT 0,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
`;

export class MemoryStore {
  private db: Database;
  private dim: number;

  constructor(dbPath?: string) {
    const defaultPath = join(homedir(), ".config", "opencode", "holographic_memory", "memory_store.db");
    const resolvedPath = dbPath || defaultPath;

    const dir = join(homedir(), ".config", "opencode", "holographic_memory");
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    this.db = new Database(resolvedPath);
    this.db.run("PRAGMA journal_mode = WAL");
    this.db.run("PRAGMA foreign_keys = ON");
    this.dim = 1024;

    this.db.exec(SCHEMA);

    this.decay_trust();
  }

  private extract_entities(content: string): string[] {
    const entities = new Set<string>();

    for (const pattern of ENTITY_PATTERNS) {
      const regex = new RegExp(pattern.source, pattern.flags);
      let match;
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

  private get_or_create_entity(name: string): number {
    const existing = this.db.prepare("SELECT entity_id FROM entities WHERE name = ?").get(name) as
      | { entity_id: number }
      | undefined;

    if (existing) {
      return existing.entity_id;
    }

    const result = this.db
      .prepare("INSERT INTO entities (name) VALUES (?)")
      .run(name);
    return Number(result.lastInsertRowid);
  }

  private link_entities(fact_id: number, entities: string[]): void {
    const insert = this.db.prepare(
      "INSERT OR IGNORE INTO fact_entities (fact_id, entity_id) VALUES (?, ?)"
    );
    for (const entity of entities) {
      const entity_id = this.get_or_create_entity(entity);
      insert.run(fact_id, entity_id);
    }
  }

  private rebuild_category_bank(category: string): void {
    const facts = this.db
      .prepare("SELECT hrr_vector FROM facts WHERE category = ? AND hrr_vector IS NOT NULL")
      .all(category) as { hrr_vector: Buffer }[];

    if (facts.length === 0) {
      this.db.prepare("DELETE FROM memory_banks WHERE bank_name = ?").run(category);
      return;
    }

    const vectors = facts.map((f) => bytes_to_phases(new Uint8Array(f.hrr_vector)));
    const bundled = bundle(...vectors);
    const vector_bytes = phases_to_bytes(bundled);

    snr_estimate(this.dim, facts.length);

    this.db
      .prepare(
        `INSERT INTO memory_banks (bank_name, vector, dim, fact_count, updated_at)
         VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
         ON CONFLICT(bank_name) DO UPDATE SET
           vector = excluded.vector,
           dim = excluded.dim,
           fact_count = excluded.fact_count,
           updated_at = CURRENT_TIMESTAMP`
      )
      .run(category, Buffer.from(vector_bytes), this.dim, facts.length);
  }

  add_fact(content: string, category = "general", tags = ""): number {
    const existing = this.db.prepare("SELECT fact_id FROM facts WHERE content = ?").get(content) as
      | { fact_id: number }
      | undefined;

    if (existing) {
      return existing.fact_id;
    }

    const entities = this.extract_entities(content);
    const hrr_vector = encode_fact(content, entities, this.dim);

    // Similar dedup via HRR - compare token-level text encoding
    const contentVec = encode_text(content, this.dim);
    const recentFacts = this.db.prepare(
      "SELECT fact_id, content FROM facts WHERE category = ? ORDER BY created_at DESC LIMIT 20"
    ).all(category) as { fact_id: number; content: string }[];

    for (const existingFact of recentFacts) {
      const existingVec = encode_text(existingFact.content, this.dim);
      const sim = similarity(contentVec, existingVec);
      if (sim > 0.35) {
        this.db.run("UPDATE facts SET retrieval_count = retrieval_count + 1 WHERE fact_id = ?", [existingFact.fact_id]);
        return existingFact.fact_id;
      }
    }

    const vector_bytes = phases_to_bytes(hrr_vector);

    const result = this.db
      .prepare(
        `INSERT INTO facts (content, category, tags, hrr_vector)
         VALUES (?, ?, ?, ?)`
      )
      .run(content, category, tags, Buffer.from(vector_bytes));

    const fact_id = Number(result.lastInsertRowid);

    this.link_entities(fact_id, entities);
    this.rebuild_category_bank(category);

    return fact_id;
  }

  search_facts(
    query: string,
    category?: string,
    minTrust = MIN_TRUST_THRESHOLD,
    limit = 10
  ): Fact[] {
    let facts: Fact[] = [];
    const trimmed = query?.trim() ?? "";

    const categoryClause = category ? "AND f.category = ?" : "";
    const baseParams: (string | number)[] = [];
    if (category) baseParams.push(category);

    if (trimmed) {
      const ftsParams = [trimmed, ...baseParams, minTrust, limit];

      const ftsSql = `
        SELECT f.fact_id, f.content, f.category, f.tags, f.trust_score,
               f.retrieval_count, f.helpful_count, f.created_at, f.updated_at
        FROM facts f
        JOIN facts_fts fts ON f.fact_id = fts.rowid
        WHERE facts_fts MATCH ?
          ${categoryClause}
          AND f.trust_score >= ?
        ORDER BY fts.rank, f.trust_score DESC
        LIMIT ?
      `;

      facts = this.db.prepare(ftsSql).all(...ftsParams) as Fact[];
    }

    // LIKE fallback if FTS5 returns nothing (for Chinese and partial matches)
    if (facts.length === 0 && trimmed) {
      const likePattern = `%${trimmed}%`;
      const likeParams = [likePattern, ...baseParams, minTrust, limit];

      const likeSql = `
        SELECT fact_id, content, category, tags, trust_score,
               retrieval_count, helpful_count, created_at, updated_at
        FROM facts
        WHERE content LIKE ?
          ${categoryClause}
          AND trust_score >= ?
        ORDER BY trust_score DESC
        LIMIT ?
      `;

      facts = this.db.prepare(likeSql).all(...likeParams) as Fact[];
    }

    // Fallback: list facts filtered by category when no query
    if (facts.length === 0 && !trimmed) {
      facts = this.list_facts(category, minTrust, limit);
    }

    if (facts.length > 0) {
      const updateRetrieval = this.db.prepare(
        "UPDATE facts SET retrieval_count = retrieval_count + 1 WHERE fact_id = ?"
      );
      for (const fact of facts) {
        updateRetrieval.run(fact.fact_id);
      }
    }

    return facts;
  }

  list_facts(category?: string, minTrust = MIN_TRUST, limit = 50): Fact[] {
    let sql = `
      SELECT fact_id, content, category, tags, trust_score,
             retrieval_count, helpful_count, created_at, updated_at
      FROM facts
      WHERE trust_score >= ?
    `;
    const params: (string | number)[] = [minTrust];

    if (category) {
      sql += " AND category = ?";
      params.push(category);
    }

    sql += " ORDER BY trust_score DESC LIMIT ?";
    params.push(limit);

    return this.db.prepare(sql).all(...params) as Fact[];
  }

  update_fact(
    fact_id: number,
    updates: {
      content?: string;
      trust_delta?: number;
      tags?: string;
      category?: string;
    }
  ): boolean {
    const existing = this.db.prepare("SELECT * FROM facts WHERE fact_id = ?").get(fact_id) as
      | {
          fact_id: number;
          content: string;
          category: string;
          tags: string;
          trust_score: number;
        }
      | undefined;

    if (!existing) {
      return false;
    }

    const new_content = updates.content ?? existing.content;
    const new_category = updates.category ?? existing.category;
    const new_tags = updates.tags ?? existing.tags;
    const content_changed = updates.content !== undefined && updates.content !== existing.content;

    let new_trust = existing.trust_score;
    if (updates.trust_delta !== undefined) {
      new_trust = Math.max(MIN_TRUST, Math.min(MAX_TRUST, new_trust + updates.trust_delta));
    }

    let vector_update = "";
    const vector_params: (string | Buffer)[] = [];

    if (content_changed) {
      const entities = this.extract_entities(new_content);
      const hrr_vector = encode_fact(new_content, entities, this.dim);
      const vector_bytes = phases_to_bytes(hrr_vector);
      vector_update = ", hrr_vector = ?";
      vector_params.push(Buffer.from(vector_bytes));
    }

    this.db
      .prepare(
        `UPDATE facts SET
          content = ?,
          category = ?,
          tags = ?,
          trust_score = ?,
          updated_at = CURRENT_TIMESTAMP
          ${vector_update}
        WHERE fact_id = ?`
      )
      .run(new_content, new_category, new_tags, new_trust, ...vector_params, fact_id);

    if (content_changed) {
      this.db.prepare("DELETE FROM fact_entities WHERE fact_id = ?").run(fact_id);
      const entities = this.extract_entities(new_content);
      this.link_entities(fact_id, entities);
    }

    if (existing.category !== new_category) {
      this.rebuild_category_bank(existing.category);
    }
    this.rebuild_category_bank(new_category);

    return true;
  }

  remove_fact(fact_id: number): boolean {
    const existing = this.db.prepare("SELECT category FROM facts WHERE fact_id = ?").get(fact_id) as
      | { category: string }
      | undefined;

    if (!existing) {
      return false;
    }

    const category = existing.category;

    this.db.prepare("DELETE FROM facts WHERE fact_id = ?").run(fact_id);
    this.rebuild_category_bank(category);

    return true;
  }

  record_feedback(fact_id: number, helpful: boolean): { old_trust: number; new_trust: number } {
    const existing = this.db.prepare("SELECT trust_score, helpful_count FROM facts WHERE fact_id = ?").get(fact_id) as
      | { trust_score: number; helpful_count: number }
      | undefined;

    if (!existing) {
      throw new Error(`Fact ${fact_id} not found`);
    }

    const old_trust = existing.trust_score;
    const delta = helpful ? TRUST_HELPFUL : TRUST_UNHELPFUL;
    let new_trust = Math.max(MIN_TRUST, Math.min(MAX_TRUST, old_trust + delta));

    if (helpful) {
      this.db
        .prepare("UPDATE facts SET trust_score = ?, helpful_count = helpful_count + 1 WHERE fact_id = ?")
        .run(new_trust, fact_id);
    } else {
      this.db.prepare("UPDATE facts SET trust_score = ? WHERE fact_id = ?").run(new_trust, fact_id);
    }

    return { old_trust, new_trust };
  }

  decay_trust(daysStale = 30, decayAmount = -0.02): number {
    const result = this.db.run(
      `UPDATE facts
       SET trust_score = MAX(?, trust_score + ?),
           updated_at = CURRENT_TIMESTAMP
       WHERE retrieval_count = 0
         AND created_at < datetime('now', '-' || ? || ' days')
         AND trust_score > ?`,
      [MIN_TRUST, decayAmount, daysStale, MIN_TRUST + 0.01]
    );
    return result.changes;
  }

  get_fact(fact_id: number): Fact | null {
    return (
      (this.db.prepare(
        `SELECT fact_id, content, category, tags, trust_score,
                retrieval_count, helpful_count, created_at, updated_at
         FROM facts WHERE fact_id = ?`
      ).get(fact_id) as Fact) || null
    );
  }

  get_fact_with_vector(fact_id: number): (Fact & { hrr_vector: Buffer }) | null {
    return (
      (this.db.prepare(
        `SELECT fact_id, content, category, tags, trust_score,
                retrieval_count, helpful_count, created_at, updated_at,
                hrr_vector
         FROM facts WHERE fact_id = ? AND hrr_vector IS NOT NULL`
      ).get(fact_id) as (Fact & { hrr_vector: Buffer })) || null
    );
  }

  get_facts_with_vectors(fact_ids: number[]): Map<number, Float64Array> {
    if (fact_ids.length === 0) return new Map();
    const placeholders = fact_ids.map(() => "?").join(",");
    const rows = this.db.prepare(
      `SELECT fact_id, hrr_vector FROM facts WHERE fact_id IN (${placeholders}) AND hrr_vector IS NOT NULL`
    ).all(...fact_ids) as { fact_id: number; hrr_vector: Buffer }[];

    const result = new Map<number, Float64Array>();
    for (const row of rows) {
      result.set(row.fact_id, bytes_to_phases(new Uint8Array(row.hrr_vector)));
    }
    return result;
  }

  get_category_bank(category: string): { vector: Float64Array; fact_count: number } | null {
    const row = this.db.prepare(
      "SELECT vector, fact_count FROM memory_banks WHERE bank_name = ?"
    ).get(category) as { vector: Buffer; fact_count: number } | undefined;

    if (!row) return null;

    return {
      vector: bytes_to_phases(new Uint8Array(row.vector)),
      fact_count: row.fact_count,
    };
  }

  close(): void {
    this.db.close();
  }
}