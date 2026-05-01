# Holographic Memory OpenCode Plugin

[![GitHub Stars](https://img.shields.io/github/stars/tw2818/holographic-opencode-plugin)](https://github.com/tw2818/holographic-opencode-plugin)

Native OpenCode plugin providing holographic memory with HRR (Holographic Reduced Representation) retrieval.

## Features

- **9 Native Tools**: Direct plugin tools for memory operations
- **Session Hooks**: Auto-extract facts on session end, compaction context injection
- **Chat Interception**: Detect "remember that" patterns and auto-store
- **Tool Hooks**: Auto-extract facts after significant tool executions
- **HRR Algebra**: Semantic encoding with bind/unbind/bundle operations
- **RRF Fusion**: Combines FTS5 + Jaccard + HRR for hybrid retrieval

## Installation

```bash
npm install holographic-opencode-plugin
```

Or for local development:

```bash
git clone https://github.com/tw2818/holographic-opencode-plugin.git
cd holographic-opencode-plugin
npm install
npm run build
npm link
# Then in your opencode config directory:
npm link holographic-opencode-plugin
```

## Configuration

Add to your `opencode.jsonc`:

```json
{
  "plugin": [
    "holographic-opencode-plugin"
  ]
}
```

The plugin communicates with the Python MCP backend via stdin/stdout. Ensure the Python MCP server is accessible.

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

## Hooks

### Session Compaction
Before session compaction, memory context is automatically prepended.

### Chat Message
Detects patterns like "remember that X", "I prefer Y" and auto-stores.

### Tool Execute After
After significant tools (edit, write, bash), extracts facts for storage.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                  OpenCode Plugin System                     │
│  ┌─────────────┐  ┌──────────────┐  ┌───────────────────┐ │
│  │ Tool Defs   │  │ Session      │  │ Chat              │ │
│  │ (9 native)  │  │ Hooks        │  │ Interceptors      │ │
│  └─────────────┘  └──────────────┘  └───────────────────┘ │
└──────────────────────────┬──────────────────────────────────┘
                           │ IPC (stdin/stdout)
                           ▼
┌─────────────────────────────────────────────────────────────┐
│              Python MCP Server                              │
│  (holographic-mcp server.py)                              │
│  ┌─────────────┐  ┌──────────────┐  ┌───────────────────┐ │
│  │ HRR Algebra │  │ SQLite Store │  │ RRF Retrieval     │ │
│  └─────────────┘  └──────────────┘  └───────────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

## Requirements

- Node.js 18+
- Python 3.11+
- SQLite 3.35+ (FTS5)
- OpenCode AI

## License

MIT
