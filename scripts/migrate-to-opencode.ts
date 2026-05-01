#!/usr/bin/env npx tsx
import Database from "better-sqlite3";
import { encode_fact, phases_to_bytes } from "../src/hrr.js";
import { existsSync, mkdirSync } from "fs";
import { homedir, platform } from "os";
import { join } from "path";

const OLD_DB = join(homedir(), ".openclaw", "holographic_memory", "memory_store.db");
const NEW_DB = join(homedir(), ".config", "opencode", "holographic_memory", "memory_store.db");

const ENTITY_PATTERNS = [
  /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)\b/g,
  /"([^"]+)"/g,
  /'([^']+)'/g,
  /\b([A-Z]{2,})\b/g,
  /\b([a-z]+(?:[0-9]+[a-z]*)+)\b/gi,
  /(\w+(?:\s+\w+)*)\s+(?:aka|also known as)\s+(\w+(?:\s+\w+)*)/gi,
];

function extractEntities(content: string): string[] {
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

async function migrate() {
  console.log("Migration: Python SQLite → Pure TypeScript");
  console.log(`From: ${OLD_DB}`);
  console.log(`To: ${NEW_DB}`);

  if (!existsSync(OLD_DB)) {
    console.log("No old database found. Nothing to migrate.");
    return;
  }

  const newDir = join(homedir(), ".config", "opencode", "holographic_memory");
  if (!existsSync(newDir)) {
    mkdirSync(newDir, { recursive: true });
  }

  const oldDb = new Database(OLD_DB, { readonly: true });
  const newDb = new Database(NEW_DB);

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

  newDb.exec(SCHEMA);

  const facts = oldDb.prepare("SELECT * FROM facts").all() as Array<{
    fact_id: number;
    content: string;
    category: string;
    tags: string;
    trust_score: number;
  }>;

  let factCount = 0;
  for (const fact of facts) {
    const entities = extractEntities(fact.content);
    const vector = encode_fact(fact.content, entities);
    const vectorBytes = phases_to_bytes(vector);

    try {
      newDb
        .prepare(
          `INSERT INTO facts (content, category, tags, trust_score, hrr_vector)
           VALUES (?, ?, ?, ?, ?)`
        )
        .run(fact.content, fact.category || "general", fact.tags || "", fact.trust_score || 0.5, Buffer.from(vectorBytes));

      factCount++;
    } catch {
      // Skip duplicates
    }
  }

  const entities = oldDb.prepare("SELECT * FROM entities").all() as Array<{
    entity_id: number;
    name: string;
    entity_type: string;
    aliases: string;
  }>;

  let entityCount = 0;
  for (const entity of entities) {
    try {
      newDb
        .prepare(`INSERT INTO entities (name, entity_type, aliases) VALUES (?, ?, ?)`)
        .run(entity.name, entity.entity_type || "unknown", entity.aliases || "");
      entityCount++;
    } catch {
      // Skip duplicates
    }
  }

  console.log(`Migrated ${factCount} facts, ${entityCount} entities`);
  oldDb.close();
  newDb.close();
}

migrate();