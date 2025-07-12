# CodePrompt

A console application that uses LLM prompting to generate application code, similar to Claude Code. The app accepts prompts and commands and uses external LLMs (OpenAI or Anthropic) to write code with file system tools.

## Features

- **Interactive Mode**: Chat-like interface for iterative code generation
- **Single Prompt Mode**: Execute one-off prompts
- **Multiple LLM Providers**: Support for OpenAI (GPT-4) and Anthropic (Claude)
- **File System Tools**: Read, write, create, and manage files and directories
- **Configuration Management**: Save API keys and preferences
- **Colorized Output**: Beautiful console interface with syntax highlighting

## Installation

```bash
npm install
npm run build
```

## Configuration

### Option 1: Environment Variables
```bash
cp .env.example .env
# Edit .env with your API keys
```

### Option 2: Interactive Setup
```bash
npm run dev config
```

### Option 3: Command Line Setup
The app will prompt you for configuration on first run if no config is found.

## Usage

### Interactive Mode
```bash
npm run dev interactive
# or
npm run dev i
```

### Single Prompt
```bash
npm run dev prompt "Create a React component for a todo list"
# or
npm run dev p "Add error handling to my express server" --directory ./my-project
```

### Configuration
```bash
npm run dev config
```

## Available Tools

The LLM has access to these file system tools:

- `read_file` - Read contents of a file
- `write_file` - Write content to a file (creates directories if needed)
- `read_directory` - List files and directories (with recursive option)
- `create_directory` - Create directories
- `delete_file` - Delete files
- `file_exists` - Check if file/directory exists

## Examples

### Interactive Session
```
🤖 CodePrompt Interactive Mode
Type your prompts to generate code. Type "exit" to quit.

Prompt: Create a simple Express.js server with CORS enabled

💬 Response:
I'll create a simple Express.js server with CORS enabled for you.

🔧 Executing 3 tool call(s):
  → write_file({"file_path":"package.json","content":"{\n  \"name\": \"express-server\",\n  \"version\": \"1.0.0\",\n  \"main\": \"server.js\",\n  \"scripts\": {\n    \"start\": \"node server.js\",\n    \"dev\": \"nodemon server.js\"\n  },\n  \"dependencies\": {\n    \"express\": \"^4.18.0\",\n    \"cors\": \"^2.8.5\"\n  },\n  \"devDependencies\": {\n    \"nodemon\": \"^3.0.0\"\n  }\n}"})
    Successfully wrote 284 characters to package.json
  → write_file({"file_path":"server.js","content":"const express = require('express');\nconst cors = require('cors');\n\nconst app = express();\nconst PORT = process.env.PORT || 3000;\n\n// Middleware\napp.use(cors());\napp.use(express.json());\n\n// Routes\napp.get('/', (req, res) => {\n  res.json({ message: 'Hello World! Server is running.' });\n});\n\napp.get('/api/health', (req, res) => {\n  res.json({ status: 'OK', timestamp: new Date().toISOString() });\n});\n\n// Start server\napp.listen(PORT, () => {\n  console.log(`Server is running on port ${PORT}`);\n});"})
    Successfully wrote 486 characters to server.js

✅ Prompt execution completed
```

## Development

```bash
# Install dependencies
npm install

# Run in development mode
npm run dev

# Build for production
npm run build

# Run built version
npm start
```

## License

MIT