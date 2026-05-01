# Holographic Memory OpenCode Plugin - SPEC

## Goal

Create a native OpenCode plugin that deeply integrates holographic memory, going beyond the current MCP approach.

## Current State

- MCP server at `/home/twebery/holographic-mcp/` provides 11 tools via JSON-RPC
- OpenCode config already references it: `"python3 /home/twebery/holographic-mcp/server.py"`
- `memory-summarizer` skill uses MCP tools

## Why Native Plugin?

| Capability | MCP | Native Plugin |
|------------|-----|---------------|
| Tool definitions | ✓ | ✓ |
| Message interception | ✗ | ✓ |
| Session lifecycle hooks | ✗ | ✓ |
| LLM param modification | ✗ | ✓ |
| Skill system integration | ✗ | ✓ |
| Config hooks | ✗ | ✓ |
| Full SDK access | ✗ | ✓ |

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    OpenCode Plugin System                         │
│  ┌───────────────┐  ┌──────────────┐  ┌───────────────────┐   │
│  │ memory-tools  │  │ session-     │  │ chat-message      │   │
│  │ (tool defs)   │  │ hooks        │  │ interceptors      │   │
│  └───────┬───────┘  └──────┬───────┘  └─────────┬─────────┘   │
│          │                  │                     │             │
│          └──────────────────┼─────────────────────┘             │
│                             │                                    │
│                    ┌────────▼────────┐                          │
│                    │ Plugin Hooks   │                           │
│                    │ • tool.execute.after                       │
│                    │ • experimental.session.compacting          │
│                    │ • chat.message                              │
│                    │ • config                                    │
│                    └────────┬────────┘                          │
│                             │                                    │
│                    ┌────────▼────────┐                          │
│                    │ Holographic     │                          │
│                    │ Memory Bridge   │                          │
│                    └────────┬────────┘                          │
│                             │                                    │
│          ┌──────────────────┼──────────────────┐                │
│          │                  │                  │                │
│  ┌───────▼───────┐  ┌──────▼──────┐  ┌──────▼──────┐       │
│  │ MCP Tools     │  │ Skill System │  │ Session     │       │
│  │ (backward     │  │ Integration  │  │ Memory      │       │
│  │  compat)      │  │              │  │ Context     │       │
│  └───────────────┘  └──────────────┘  └─────────────┘       │
└─────────────────────────────────────────────────────────────────┘
                             │
                             │ IPC / child_process
                             ▼
              ┌──────────────────────────┐
              │ Python MCP Server        │
              │ (existing holographic-   │
              │  mcp server)            │
              └──────────────────────────┘
```

## Implementation Plan

### Phase 1: Plugin Package Structure

```
holographic-opencode-plugin/
├── src/
│   ├── index.ts           # Plugin entry point (exports server: Plugin)
│   ├── bridge.ts          # IPC bridge to Python MCP server
│   ├── tools.ts           # Native tool definitions
│   ├── hooks/
│   │   ├── session.ts     # on_session_end, compaction
│   │   ├── chat.ts        # chat.message interceptor
│   │   └── tool.ts        # tool.execute.after interceptor
│   ├── skills/
│   │   └── memory-summarizer.ts  # Skill implementation
│   └── types.ts
├── package.json
├── tsconfig.json
└── README.md
```

### Phase 2: Core Features

1. **Native Tool Definitions** - Direct plugin tools (not MCP)
   - `memory_search` - Search memory with natural language
   - `memory_remember` - Store fact with context
   - `memory_forget` - Remove fact
   - `memory_profile` - Get user profile from memory

2. **Session Hooks**
   - `experimental.session.compacting` - Prepend memory context to compaction
   - `tool.execute.after` - Auto-extract facts after significant tools (edit, write, bash)

3. **Chat Message Interceptor**
   - Detect memory trigger phrases ("remember that", "what do you remember", etc.)
   - Parse intent and call memory tools automatically

4. **Skill Integration**
   - `memory-summarizer` skill enhanced to use native plugin instead of MCP

### Phase 3: Backward Compatibility

- MCP server still runs for external users
- Plugin wraps MCP calls internally
- `memory-summarizer` skill updated to use native plugin

## Key Files to Create

1. `package.json` - npm package with `@opencode-ai/plugin` dependency
2. `src/index.ts` - Main plugin entry
3. `src/bridge.ts` - Python MCP server IPC wrapper
4. `src/tools.ts` - Tool definitions
5. `src/hooks/*.ts` - Hook implementations
6. `src/skills/memory-summarizer.ts` - Enhanced skill

## Success Criteria

1. Plugin loads without errors in OpenCode
2. Native tools appear in tool list
3. `tool.execute.after` hook fires on edits
4. Session compaction includes memory context
5. `memory-summarizer` skill uses native plugin
6. MCP server still works for external tools
