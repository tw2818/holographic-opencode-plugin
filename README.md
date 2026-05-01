# Holographic Memory OpenCode Plugin

[![GitHub Stars](https://img.shields.io/github/stars/tw2818/holographic-opencode-plugin)](https://github.com/tw2818/holographic-opencode-plugin)

Native OpenCode plugin for persistent memory with FTS5 full-text search and HRR (Holographic Reduced Representation) vector reranking. **100% TypeScript - no Python required.**

## Features

- **10 Memory Tools**: Search, store, forget, list, profile, probe, feedback, reason, contradict
- **Background Summarizer**: LLM-powered auto-summarization of conversations
- **HRR Algebra**: Semantic encoding with bind/unbind/bundle operations
- **RRF Fusion**: FTS5 + Jaccard + HRR for hybrid retrieval
- **Auto-Maintenance**: Dedup, trust decay, conflict detection — LLM + code-level
- **Dynamic Categories**: LLM creates categories freely based on content
- **Confidence Scoring**: Facts scored 0.2-0.9 based on LLM confidence
- **SQLite + FTS5**: Fast full-text search with vector similarity

## Installation

```bash
git clone https://github.com/tw2818/holographic-opencode-plugin.git
cd holographic-opencode-plugin
npm install
opencode plugin "$(pwd)"
```

## Configuration

Plugin auto-installs via `opencode plugin` command. The database will be created automatically at:
`~/.config/opencode/holographic_memory/memory_store.db`

## Tools

| Tool | Description |
|------|-------------|
| `memory_search` | Search memory using holographic RRF fusion |
| `memory_remember` | Store a fact in memory |
| `memory_forget` | Remove a fact by ID |
| `memory_list` | List facts by category/trust |
| `memory_profile` | Get user profile from all categories |
| `memory_probe` | HRR algebraic probe for entity |
| `memory_feedback` | Record helpful/unhelpful feedback |
| `memory_reason` | Multi-entity AND reasoning |
| `memory_contradict` | Find contradictory fact pairs |
| `memory_decay` | Manual trust decay for stale facts |

## Session Hooks

- **Auto-Extract**: Detects "remember that X", "I prefer Y" patterns
- **Background Summarizer**: Triggers when conversation is user-led (≥5 messages, ≥2 user messages in last 3). Runs in isolated sub-session to not pollute main conversation.
- **Compaction Context**: Injects relevant memory before session compaction

## Configuration

Optional config in `opencode.jsonc`:

```jsonc
"experimental": {
  "holographicMemory": {
    "summarizerModel": "minimax-cn/Minimax-M2.7-highspeed",
    "bufferSize": 20,
    "messageThreshold": 5,
    "enabled": true
  }
}
```

## Database

Data stored at: `~/.config/opencode/holographic_memory/memory_store.db`

Schema:
- `facts` - stored facts with HRR vectors
- `entities` - extracted entities
- `fact_entities` - fact-entity relationships
- `facts_fts` - FTS5 full-text search virtual table
- `memory_banks` - bundled category vectors

## Requirements

- [OpenCode AI](https://opencode.ai) (provides Bun runtime)
- SQLite with FTS5 support (included in Bun)

## License

MIT
