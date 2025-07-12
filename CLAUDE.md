# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Essential Development Commands

```bash
# Build the project
npm run build

# Development with auto-reload
npm run dev

# Clean build artifacts
npm run clean

# Test the CLI locally (after build)
npm run start

# Global install for testing
npm run build && npm link
```

## Code Architecture Overview

PromptCoder CLI is a Node.js TypeScript application that provides an interactive AI-powered code generation interface. The architecture follows a modular design with clear separation of concerns:

### Core Components

**Entry Point & CLI** (`src/index.ts`)
- Uses Commander.js for CLI argument parsing
- Main commands: `interactive`, `prompt`, `config`
- Compiled to `dist/index.js` with global `promptcoder` binary

**Main Application** (`src/app.ts`)
- `CodePromptApp` class orchestrates the entire application
- Manages conversation flow with 25 iteration limit and infinite loop detection
- Handles tool execution coordination and working directory management
- Provides auto-save functionality for conversations

**Configuration Management** (`src/config.ts`)
- Stores config in `~/.promptcoder/config.json`
- Supports multiple LLM providers (OpenAI/Anthropic)
- Interactive setup wizard with environment variable support
- Hierarchical loading: environment → file → interactive setup

**LLM Provider System** (`src/llm/`)
- Factory pattern with unified `LLMClient` interface
- Supports OpenAI GPT and Anthropic Claude
- Built-in retry logic with exponential backoff
- Enhanced error handling with user-friendly messages
- Tool calling support for both providers

**Tool System Architecture** (`src/tools/`)
- **Basic File Tools** (`file-tools.ts`): Core file operations (read, write, directory listing)
- **Advanced Tools** (`advanced-tools.ts`): Sophisticated operations (diff editing, search, checkpoints)
- All tools follow unified interface pattern for seamless integration

**Conversation Management** (`src/conversation-manager.ts`)
- Persistent storage in `~/.promptcoder/conversations/`
- Metadata tracking and search capabilities
- Export functionality (JSON/Markdown)
- Working directory context preservation

### Data Flow

```
User Input → CodePromptApp → LLMClient → Tool Execution → Response
    ↓           ↓              ↓           ↓            ↓
CLI Parser → Conversation → Provider → File System → User Output
             Manager        (OpenAI/     Operations
                           Anthropic)
```

### Key Design Patterns

- **Factory Pattern**: LLM provider creation
- **Strategy Pattern**: Multiple LLM provider implementations
- **Command Pattern**: Tool execution system
- **Unified Interface**: All tools implement consistent interfaces

### Storage Structure

```
~/.promptcoder/
├── config.json              # API keys and preferences
└── conversations/           # Conversation files
    ├── conv_123456789.json
    └── conv_987654321.json
```

### TypeScript Configuration

- Target: ES2020 with CommonJS modules
- Output: `./dist` with source maps and declarations
- Strict mode enabled for type safety

### Dependencies

**Runtime**: `@anthropic-ai/sdk`, `openai`, `commander`, `inquirer`, `chalk`, `fs-extra`, `glob`, `dotenv`
**Development**: `typescript`, `ts-node`, `@types/*`

## Development Notes

- No test framework configured yet (test script exits with error)
- Global installation preferred with `preferGlobal: true`
- Node.js 16+ required
- Binary name: `promptcoder`
- Uses `ts-node` for development mode
- Build artifacts in `dist/` directory

## Security & Privacy

- All data stored locally on user's machine
- API keys secured in user's home directory
- No external data transmission except to chosen LLM providers
- File system operations scoped to working directory