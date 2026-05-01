# Holographic Memory OpenCode Plugin

[![GitHub Stars](https://img.shields.io/github/stars/tw2818/holographic-opencode-plugin)](https://github.com/tw2818/holographic-opencode-plugin)

Native OpenCode plugin providing holographic memory with HRR (Holographic Reduced Representation) retrieval. **100% TypeScript - no Python required.**

## Features

- **9 Native Tools**: Direct plugin tools for memory operations
- **Session Hooks**: Auto-extract facts on chat messages, compaction context injection
- **HRR Algebra**: Semantic encoding with bind/unbind/bundle operations
- **RRF Fusion**: Combines FTS5 + Jaccard + HRR for hybrid retrieval
- **SQLite + FTS5**: Fast full-text search with vector similarity

## Installation

### From GitHub (recommended)
```bash
opencode plugin tw2818/holographic-opencode-plugin
```

### From local clone
```bash
git clone https://github.com/tw2818/holographic-opencode-plugin.git
cd holographic-opencode-plugin
npm install
npm run build
opencode plugin /path/to/holographic-opencode-plugin
```

### From npm (when published)
```bash
opencode plugin holographic-opencode-plugin
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

## Session Hooks

### Auto-Extract
Automatically detects and stores facts from:
- Chat messages matching patterns: "remember that X", "note that Y", "I prefer Z"
- Tool executions that modify files or make commits

### Compaction Context
Before session compaction, relevant memory is injected into context.

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
