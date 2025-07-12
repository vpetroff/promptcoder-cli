# CodePrompt CLI

🤖 **AI-powered code generation CLI tool** with conversation persistence, advanced file tools, and support for multiple LLM providers (OpenAI GPT & Anthropic Claude).

[![npm version](https://badge.fury.io/js/codeprompt-cli.svg)](https://badge.fury.io/js/codeprompt-cli)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js Version](https://img.shields.io/node/v/codeprompt-cli.svg)](https://nodejs.org/en/)

## ✨ Features

- 🎯 **Interactive Mode**: Chat-like interface for iterative code generation
- 📝 **Conversation Persistence**: Save and resume conversations across sessions
- 🔧 **Advanced File Tools**: Diff edits, search, checkpoints, and smart directory filtering
- 🤖 **Multiple LLM Providers**: OpenAI (GPT-4) and Anthropic (Claude) support
- 🚀 **Retry Logic**: Automatic retry with exponential backoff for API rate limits
- 🎨 **Beautiful Interface**: Colorized output with progress indicators
- 📁 **Project-Aware**: Maintains working directory context per conversation

## 🚀 Installation

### Global Installation (Recommended)
```bash
npm install -g codeprompt-cli
```

### Local Installation
```bash
npm install codeprompt-cli
```

## ⚙️ Configuration

### First Run Setup
```bash
codeprompt config
```

### Environment Variables
```bash
# OpenAI
export OPENAI_API_KEY="your-openai-api-key"
export OPENAI_MODEL="gpt-4o"  # optional

# Anthropic
export ANTHROPIC_API_KEY="your-anthropic-api-key"
export ANTHROPIC_MODEL="claude-3-5-sonnet-20241022"  # optional
```

### Manual Configuration
Configuration is stored in `~/.codeprompt/config.json`

## 🎯 Usage

### Interactive Mode
```bash
codeprompt interactive
# or
codeprompt i
```

### Single Prompt
```bash
codeprompt prompt "Create a React component for a todo list"
# or
codeprompt p "Add error handling to my express server" --directory ./my-project
```

### Conversation Management
```bash
# In interactive mode:
save          # Save current conversation
load          # Load a previous conversation
list          # List all saved conversations
rename        # Rename current conversation
delete        # Delete a conversation
clear         # Clear current conversation
```

## 🔧 Available Tools

The AI has access to these powerful tools:

### **Basic File Operations**
- `read_file` - Read file contents
- `write_file` - Write content to files (creates directories automatically)
- `read_directory` - Smart directory listing (filters node_modules, .git, etc.)
- `create_directory` - Create directories
- `delete_file` - Delete files
- `file_exists` - Check if files/directories exist

### **Advanced Editing**
- `edit_file_diff` - Precise edits using exact text matching
- `insert_lines` - Insert content at specific line numbers
- `delete_lines` - Remove specific line ranges

### **Search & Discovery**
- `search_in_files` - Search patterns across multiple files with regex support

### **Version Control**
- `create_checkpoint` - Save snapshots of file states
- `list_checkpoints` - View all checkpoints with metadata
- `restore_checkpoint` - Rollback to previous states
- `show_file_diff` - Compare current files with checkpoint versions

## 📚 Examples

### Creating a React App
```bash
codeprompt i
Prompt: Create a modern React TypeScript app with routing and state management

# The AI will:
# 1. Read your directory structure
# 2. Create package.json with dependencies
# 3. Set up TypeScript configuration
# 4. Create components and routing
# 5. Set up state management
# 6. Add proper file structure
```

### Refactoring Code
```bash
codeprompt i
Prompt: Refactor this codebase to use TypeScript and add proper error handling

# The AI will:
# 1. Create a checkpoint of current state
# 2. Search through existing files
# 3. Convert JavaScript to TypeScript
# 4. Add error handling patterns
# 5. Update configurations
# 6. Show diffs of changes made
```

### Conversation Persistence
```bash
# Start working on a project
codeprompt i
Prompt: Build a REST API with Express and PostgreSQL
# ... work continues ...
save
Name: "E-commerce API"
Description: "Building product catalog and user auth"

# Later, resume exactly where you left off
codeprompt i
load
# Select: "E-commerce API (15 messages, 12/5/2024)"
# Continue with full context preserved
```

## 🔄 Conversation Flow

```
🤖 CodePrompt Interactive Mode
Commands: exit, clear, save, load, list, rename, delete

[My React Project] Prompt: Add authentication to the app

🔄 Processing (1/25)...

💬 Response:
I'll help you add authentication to your React app. Let me first examine your current project structure.

🔧 Executing 2 tool call(s):
  → read_directory({"dir_path":"."})
    Contents of . (8 items):
    FILE: package.json (2KB)
    DIR: src
    FILE: tsconfig.json (421B)
    ...

  → read_file({"file_path":"src/App.tsx"})
    File contents of src/App.tsx:
    ...

🔄 Continuing conversation after tool execution...

💬 Response:
Now I'll create the authentication system. I'll add:
1. Auth context and provider
2. Login/signup components
3. Protected routes
4. JWT token management

🔧 Executing 4 tool call(s):
  → create_checkpoint({"checkpoint_name":"before_auth","description":"Before adding authentication"})
    Created checkpoint "before_auth" with 12 files

  → write_file({"file_path":"src/contexts/AuthContext.tsx","content":"..."})
    Successfully wrote 1240 characters to src/contexts/AuthContext.tsx
  ...

✅ Turn completed
```

## 🛠️ Development

```bash
# Clone and install
git clone https://github.com/codeprompt/codeprompt-cli.git
cd codeprompt-cli
npm install

# Development mode
npm run dev

# Build
npm run build

# Test global installation
npm run build && npm link
```

## 🔒 Privacy & Security

- **API Keys**: Stored locally in `~/.codeprompt/config.json`
- **Conversations**: Stored locally in `~/.codeprompt/conversations/`
- **No Data Sharing**: All data remains on your machine
- **Secure**: Uses official OpenAI and Anthropic SDKs

## 🚨 Requirements

- **Node.js**: 16.0.0 or higher
- **API Key**: OpenAI or Anthropic API key
- **Operating System**: macOS, Linux, or Windows

## 📄 License

MIT © CodePrompt Team

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## 📞 Support

- **Issues**: [GitHub Issues](https://github.com/codeprompt/codeprompt-cli/issues)
- **Discussions**: [GitHub Discussions](https://github.com/codeprompt/codeprompt-cli/discussions)

---

**Made with ❤️ for developers who want to code faster with AI assistance.**