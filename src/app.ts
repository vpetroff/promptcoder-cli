import chalk from 'chalk';
import inquirer from 'inquirer';
import { createLLMClient, LLMClient, LLMConfig, Message } from './llm';
import { FileTools } from './tools/file-tools';
import { AdvancedTools } from './tools/advanced-tools';
import { SandboxTools } from './tools/sandbox-tools';
import { ConversationManager } from './conversation-manager';

export interface AppConfig extends LLMConfig {
  workingDirectory?: string;
  sandbox?: {
    provider?: string;
    apiKey?: string;
    enabled?: boolean;
  };
}

export class CodePromptApp {
  private llmClient: LLMClient;
  private fileTools: FileTools;
  private advancedTools: AdvancedTools;
  private sandboxTools: SandboxTools;
  private config: AppConfig;
  private conversationHistory: Message[] = [];
  private conversationManager: ConversationManager;
  private currentConversationId: string | null = null;
  private currentConversationName: string | null = null;
  private ctrlCCount = 0;
  private ctrlCTimer: NodeJS.Timeout | null = null;
  private activeFileWatchers: Map<string, any> = new Map();

  constructor(config: AppConfig) {
    this.config = config;
    this.llmClient = createLLMClient(config);
    this.fileTools = new FileTools(config.workingDirectory);
    this.advancedTools = new AdvancedTools(config.workingDirectory);
    this.sandboxTools = new SandboxTools(config.workingDirectory);
    this.conversationManager = new ConversationManager();
    this.initializeSandboxTools();
  }

  private initializeSandboxTools(): void {
    if (this.config.sandbox?.enabled && this.config.sandbox.provider && this.config.sandbox.apiKey) {
      this.sandboxTools.setSandboxConfig(this.config.sandbox.provider, {
        apiKey: this.config.sandbox.apiKey
      });
    }
  }

  private setupDoubleCtrlCHandler(): void {
    // Remove any existing listeners to avoid duplicates
    process.removeAllListeners('SIGINT');

    process.on('SIGINT', async () => {
      this.ctrlCCount++;

      if (this.ctrlCCount === 1) {
        console.log(chalk.yellow('\n⚠️  Press Ctrl+C again within 3 seconds to exit'));
        
        // Reset counter after 3 seconds
        this.ctrlCTimer = setTimeout(() => {
          this.ctrlCCount = 0;
          console.log(chalk.gray('Exit cancelled. Continue working...'));
        }, 3000);
      } else if (this.ctrlCCount >= 2) {
        // Clear the timer if it exists
        if (this.ctrlCTimer) {
          clearTimeout(this.ctrlCTimer);
        }
        
        console.log(chalk.blue('\n👋 Exiting PromptCoder...'));
        
        // Stop any active file watchers
        await this.stopAllFileWatchers();
        
        // Check if we should save the conversation before exiting
        if (this.conversationHistory.length > 0 && !this.currentConversationId) {
          try {
            const inquirer = await import('inquirer');
            const { shouldSave } = await inquirer.default.prompt([
              {
                type: 'confirm',
                name: 'shouldSave',
                message: 'Save current conversation before exiting?',
                default: true
              }
            ]);

            if (shouldSave) {
              await this.handleSave();
            }
          } catch (error) {
            // If there's an error with the prompt, just exit
            console.log(chalk.yellow('Unable to prompt for save. Exiting...'));
          }
        } else if (this.currentConversationId && this.conversationHistory.length > 0) {
          // Auto-save existing conversation
          try {
            await this.autoSave();
            console.log(chalk.green('✅ Conversation auto-saved'));
          } catch (error) {
            console.log(chalk.yellow('⚠️  Failed to auto-save conversation'));
          }
        }
        
        console.log(chalk.green('🎉 Thanks for using PromptCoder!'));
        process.exit(0);
      }
    });
  }

  async startInteractive(): Promise<void> {
    console.log(chalk.blue.bold('🤖 PromptCoder Interactive Mode'));
    console.log(chalk.gray('Commands: exit, clear, save, load, list, rename, delete'));
    console.log(chalk.gray('CLI Commands: /deploy, /sandbox, /watch (use /help for full list)'));
    console.log(chalk.gray('Press Ctrl+C twice to exit\n'));

    // Show current conversation info
    if (this.currentConversationName) {
      console.log(chalk.green(`📝 Current conversation: ${this.currentConversationName}`));
      console.log(chalk.gray(`Messages: ${this.conversationHistory.length}\n`));
    }

    // Set up double Ctrl+C handler
    this.setupDoubleCtrlCHandler();

    while (true) {
      const { prompt } = await inquirer.prompt([
        {
          type: 'input',
          name: 'prompt',
          message: chalk.cyan(this.currentConversationName ? `[${this.currentConversationName}] Prompt:` : 'Prompt:'),
          validate: (input: string) => input.trim().length > 0 || 'Please enter a prompt'
        }
      ]);

      const trimmedPrompt = prompt.trim();

      // Handle CLI commands prefixed with /
      if (trimmedPrompt.startsWith('/')) {
        await this.handleCliCommand(trimmedPrompt);
        continue;
      }

      const command = trimmedPrompt.toLowerCase();

      if (command === 'exit') {
        await this.handleExit();
        break;
      }

      if (command === 'clear') {
        await this.handleClear();
        continue;
      }

      if (command === 'save') {
        await this.handleSave();
        continue;
      }

      if (command === 'load') {
        await this.handleLoad();
        continue;
      }

      if (command === 'list') {
        await this.handleList();
        continue;
      }

      if (command === 'rename') {
        await this.handleRename();
        continue;
      }

      if (command === 'delete') {
        await this.handleDelete();
        continue;
      }

      await this.executeInteractivePrompt(prompt);
      
      // Auto-save after each interaction if we have a current conversation
      if (this.currentConversationId && this.conversationHistory.length > 0) {
        await this.autoSave();
      }
      
      console.log(); // Empty line for spacing
    }
  }

  async executeInteractivePrompt(prompt: string): Promise<void> {
    try {
      // Add user message to conversation history
      this.conversationHistory.push({
        role: 'user',
        content: prompt
      });

      await this.continueConversation();
    } catch (error) {
      console.error(chalk.red('❌ Error in conversation:'));
      console.error(chalk.red(error instanceof Error ? error.message : String(error)));
    }
  }

  private async continueConversation(): Promise<void> {
    let maxIterations = 25; // More reasonable limit for complex tasks
    let iteration = 0;
    let lastToolCalls: string[] = [];

    while (iteration < maxIterations) {
      iteration++;
      
      console.log(chalk.blue(`🔄 Processing (${iteration}/${maxIterations})...`));
      
      const tools = [
        ...this.fileTools.getTools(), 
        ...this.advancedTools.getTools(),
        ...this.sandboxTools.getTools()
      ];
      const response = await this.llmClient.generateResponseWithHistory(this.conversationHistory, tools);

      // Add assistant response to conversation history
      this.conversationHistory.push({
        role: 'assistant',
        content: response.content,
        toolCalls: response.toolCalls
      });

      // Display LLM response
      if (response.content) {
        console.log(chalk.green('\n💬 Response:'));
        console.log(response.content);
      }

      // Execute any tool calls
      if (response.toolCalls && response.toolCalls.length > 0) {
        // Check for repeated tool calls (infinite loop detection)
        const currentToolCalls = response.toolCalls.map(call => `${call.name}(${JSON.stringify(call.parameters)})`);
        const currentToolCallsStr = currentToolCalls.join('|');
        
        if (lastToolCalls.length >= 2 && lastToolCalls.slice(-2).every(prev => prev === currentToolCallsStr)) {
          console.log(chalk.yellow('\n⚠️  Detected repeated tool calls - stopping to prevent infinite loop'));
          break;
        }
        lastToolCalls.push(currentToolCallsStr);
        if (lastToolCalls.length > 3) lastToolCalls.shift(); // Keep only last 3
        
        console.log(chalk.yellow(`\n🔧 Executing ${response.toolCalls.length} tool call(s):`));
        
        let combinedResults = '';
        for (let i = 0; i < response.toolCalls.length; i++) {
          const toolCall = response.toolCalls[i];
          console.log(chalk.cyan(`  → ${toolCall.name}(${JSON.stringify(toolCall.parameters)})`));
          
          // Check which tool set contains this tool and execute accordingly
          let result: string;
          const advancedToolNames = this.advancedTools.getTools().map(t => t.name);
          const basicToolNames = this.fileTools.getTools().map(t => t.name);
          const sandboxToolNames = this.sandboxTools.getTools().map(t => t.name);
          
          if (advancedToolNames.includes(toolCall.name)) {
            result = await this.advancedTools.executeTool(toolCall.name, toolCall.parameters);
          } else if (basicToolNames.includes(toolCall.name)) {
            result = await this.fileTools.executeTool(toolCall.name, toolCall.parameters);
          } else if (sandboxToolNames.includes(toolCall.name)) {
            result = await this.sandboxTools.executeTool(toolCall.name, toolCall.parameters);
          } else {
            result = `Error: Unknown tool "${toolCall.name}"`;
          }
          
          console.log(chalk.gray(`    ${result}`));
          
          if (response.toolCalls.length === 1) {
            combinedResults = result;
          } else {
            combinedResults += (i === 0 ? '' : '\n\nTool ') + `${i + 1} result: ${result}`;
          }
        }

        // Add tool results to conversation history
        this.conversationHistory.push({
          role: 'tool',
          content: combinedResults
        });

        // Continue the conversation after tool execution
        console.log(chalk.blue('\n🔄 Continuing conversation after tool execution...'));
        continue;
      }

      // If no tool calls, the conversation is complete for this turn
      console.log(chalk.green('\n✅ Turn completed'));
      break;
    }

    if (iteration >= maxIterations) {
      console.log(chalk.yellow('\n⚠️  Conversation reached maximum iterations limit'));
      console.log(chalk.gray('This usually happens when the LLM gets stuck in a loop or the task is very complex.'));
      console.log(chalk.gray('Try breaking down your request into smaller parts or use "clear" to reset the conversation.'));
    }
  }

  async executePrompt(prompt: string, workingDirectory?: string): Promise<void> {
    try {
      console.log(chalk.blue('🔄 Processing prompt...'));
      
      // Update working directory if provided
      if (workingDirectory && workingDirectory !== this.config.workingDirectory) {
        this.fileTools = new FileTools(workingDirectory);
        this.config.workingDirectory = workingDirectory;
      }

      const tools = [
        ...this.fileTools.getTools(), 
        ...this.advancedTools.getTools(),
        ...this.sandboxTools.getTools()
      ];
      const response = await this.llmClient.generateResponse(prompt, tools);

      // Display LLM response
      if (response.content) {
        console.log(chalk.green('\n💬 Response:'));
        console.log(response.content);
      }

      // Execute any tool calls
      if (response.toolCalls && response.toolCalls.length > 0) {
        console.log(chalk.yellow(`\n🔧 Executing ${response.toolCalls.length} tool call(s):`));
        
        for (const toolCall of response.toolCalls) {
          console.log(chalk.cyan(`  → ${toolCall.name}(${JSON.stringify(toolCall.parameters)})`));
          
          // Check which tool set contains this tool and execute accordingly
          let result: string;
          const advancedToolNames = this.advancedTools.getTools().map(t => t.name);
          const basicToolNames = this.fileTools.getTools().map(t => t.name);
          const sandboxToolNames = this.sandboxTools.getTools().map(t => t.name);
          
          if (advancedToolNames.includes(toolCall.name)) {
            result = await this.advancedTools.executeTool(toolCall.name, toolCall.parameters);
          } else if (basicToolNames.includes(toolCall.name)) {
            result = await this.fileTools.executeTool(toolCall.name, toolCall.parameters);
          } else if (sandboxToolNames.includes(toolCall.name)) {
            result = await this.sandboxTools.executeTool(toolCall.name, toolCall.parameters);
          } else {
            result = `Error: Unknown tool "${toolCall.name}"`;
          }
          
          console.log(chalk.gray(`    ${result}`));
        }
      }

      console.log(chalk.green('\n✅ Prompt execution completed'));
    } catch (error) {
      console.error(chalk.red('❌ Error executing prompt:'));
      console.error(chalk.red(error instanceof Error ? error.message : String(error)));
    }
  }

  async setWorkingDirectory(directory: string): Promise<void> {
    this.fileTools = new FileTools(directory);
    this.advancedTools = new AdvancedTools(directory);
    this.sandboxTools = new SandboxTools(directory);
    this.config.workingDirectory = directory;
    this.initializeSandboxTools(); // Re-initialize sandbox tools with new directory
    console.log(chalk.blue(`📁 Working directory set to: ${directory}`));
  }

  private async handleCliCommand(command: string): Promise<void> {
    try {
      const args = command.slice(1).split(/\s+/); // Remove leading '/' and split by whitespace
      const cmd = args[0].toLowerCase();
      const params = args.slice(1);

      switch (cmd) {
        case 'help':
          await this.showCliHelp();
          break;

        case 'deploy':
          await this.handleDeployCommand(params);
          break;

        case 'sandbox':
          await this.handleSandboxCommand(params);
          break;

        case 'watch':
          await this.handleWatchCommand(params);
          break;

        case 'stop':
          await this.handleStopCommand(params);
          break;

        case 'config':
          const { setupConfig } = await import('./config');
          await setupConfig();
          console.log(chalk.green('Configuration updated. Restart interactive mode to apply changes.\n'));
          break;

        default:
          console.log(chalk.red(`❌ Unknown command: /${cmd}`));
          console.log(chalk.gray('Use /help to see available commands\n'));
      }
    } catch (error) {
      console.error(chalk.red(`❌ Command failed: ${error instanceof Error ? error.message : String(error)}\n`));
    }
  }

  private async showCliHelp(): Promise<void> {
    console.log(chalk.blue.bold('\n📖 Available CLI Commands:'));
    console.log();
    console.log(chalk.cyan('/help') + chalk.gray(' - Show this help message'));
    console.log(chalk.cyan('/config') + chalk.gray(' - Configure API keys and settings'));
    console.log(chalk.cyan('/deploy [options]') + chalk.gray(' - Deploy current project to sandbox'));
    console.log(chalk.gray('  Options: --template <name>, --name <name>, --no-open'));
    console.log(chalk.cyan('/sandbox <action> [id]') + chalk.gray(' - Manage sandbox deployments'));
    console.log(chalk.gray('  Actions: list, status <id>, delete <id>'));
    console.log(chalk.cyan('/watch <sandbox-id> [options]') + chalk.gray(' - Start file watching'));
    console.log(chalk.gray('  Options: --watch <patterns>, --ignore <patterns>'));
    console.log(chalk.cyan('/stop [sandbox-id]') + chalk.gray(' - Stop file watching (all or specific)'));
    console.log();
    console.log(chalk.blue('Examples:'));
    console.log(chalk.gray('/deploy --template react-ts --name "My App"'));
    console.log(chalk.gray('/sandbox list'));
    console.log(chalk.gray('/watch abc123 --watch src/**/*.ts'));
    console.log(chalk.gray('/stop abc123'));
    console.log();
  }

  private async handleDeployCommand(params: string[]): Promise<void> {
    if (!this.config.sandbox?.enabled || !this.config.sandbox.apiKey) {
      console.log(chalk.red('🚫 Sandbox deployment not configured. Use /config to set up.\n'));
      return;
    }

    // Parse parameters
    const options: any = { directory: this.config.workingDirectory || process.cwd(), open: true };
    
    for (let i = 0; i < params.length; i++) {
      const param = params[i];
      if (param === '--template' && i + 1 < params.length) {
        options.template = params[++i];
      } else if (param === '--name' && i + 1 < params.length) {
        options.name = params[++i];
      } else if (param === '--no-open') {
        options.open = false;
      }
    }

    try {
      const { SandboxManager } = await import('./sandbox/sandbox-manager');
      const manager = new SandboxManager(
        this.config.sandbox.provider || 'e2b',
        { apiKey: this.config.sandbox.apiKey },
        options.directory
      );

      console.log(chalk.blue('🚀 Deploying to sandbox...'));
      const result = await manager.deployProject({
        template: options.template,
        name: options.name
      });

      console.log(chalk.green(`✅ Deployment successful!`));
      console.log(chalk.cyan(`📦 Sandbox ID: ${result.sandbox.id}`));
      console.log(chalk.cyan(`🌐 URL: ${result.url}`));
      console.log(chalk.cyan(`📁 Files uploaded: ${result.filesUploaded}`));
      console.log(chalk.cyan(`⚡ Template: ${result.sandbox.template}`));
      
      if (options.open) {
        const { default: open } = await import('open');
        await open(result.url);
        console.log(chalk.green('🌍 Opened in browser'));
      }
    } catch (error) {
      console.error(chalk.red(`❌ Deployment failed: ${error instanceof Error ? error.message : String(error)}`));
    }
    console.log();
  }

  private async handleSandboxCommand(params: string[]): Promise<void> {
    if (!this.config.sandbox?.enabled || !this.config.sandbox.apiKey) {
      console.log(chalk.red('🚫 Sandbox deployment not configured. Use /config to set up.\n'));
      return;
    }

    if (params.length === 0) {
      console.log(chalk.red('❌ Sandbox action required. Use: list, status <id>, delete <id>\n'));
      return;
    }

    const action = params[0].toLowerCase();
    const id = params[1];

    try {
      const { SandboxManager } = await import('./sandbox/sandbox-manager');
      const manager = new SandboxManager(
        this.config.sandbox.provider || 'e2b',
        { apiKey: this.config.sandbox.apiKey },
        this.config.workingDirectory || process.cwd()
      );

      switch (action) {
        case 'list':
          const sandboxes = await manager.listSandboxes();
          if (sandboxes.length === 0) {
            console.log(chalk.yellow('No active sandboxes found.\n'));
          } else {
            console.log(chalk.blue(`Found ${sandboxes.length} sandbox(es):`));
            sandboxes.forEach(s => {
              console.log(chalk.cyan(`📦 ${s.name} (${s.id.slice(0, 8)}) - ${s.status} - ${s.url}`));
            });
            console.log();
          }
          break;

        case 'status':
          if (!id) {
            console.log(chalk.red('❌ Sandbox ID required for status action\n'));
            return;
          }
          const sandbox = await manager.getSandbox(id);
          console.log(chalk.blue('Sandbox Details:'));
          console.log(chalk.cyan(`📦 ${sandbox.name}`));
          console.log(chalk.cyan(`🆔 ID: ${sandbox.id}`));
          console.log(chalk.cyan(`🌐 URL: ${sandbox.url}`));
          console.log(chalk.cyan(`📋 Status: ${sandbox.status}`));
          console.log(chalk.cyan(`🏷️ Template: ${sandbox.template}`));
          console.log();
          break;

        case 'delete':
          if (!id) {
            console.log(chalk.red('❌ Sandbox ID required for delete action\n'));
            return;
          }
          await manager.deleteSandbox(id);
          console.log(chalk.green(`🗑️ Deleted sandbox ${id}\n`));
          break;

        default:
          console.log(chalk.red('❌ Unknown action. Use: list, status <id>, delete <id>\n'));
      }
    } catch (error) {
      console.error(chalk.red(`❌ Sandbox command failed: ${error instanceof Error ? error.message : String(error)}\n`));
    }
  }

  private async handleWatchCommand(params: string[]): Promise<void> {
    if (!this.config.sandbox?.enabled || !this.config.sandbox.apiKey) {
      console.log(chalk.red('🚫 Sandbox deployment not configured. Use /config to set up.\n'));
      return;
    }

    if (params.length === 0) {
      console.log(chalk.red('❌ Sandbox ID required for watch command\n'));
      return;
    }

    const sandboxId = params[0];
    const options: any = {
      directory: this.config.workingDirectory || process.cwd(),
      watch: ['**/*'],
      ignore: ['node_modules/**', '.git/**', 'dist/**', 'build/**']
    };

    // Parse watch and ignore patterns
    for (let i = 1; i < params.length; i++) {
      const param = params[i];
      if (param === '--watch') {
        options.watch = [];
        while (i + 1 < params.length && !params[i + 1].startsWith('--')) {
          options.watch.push(params[++i]);
        }
      } else if (param === '--ignore') {
        options.ignore = [];
        while (i + 1 < params.length && !params[i + 1].startsWith('--')) {
          options.ignore.push(params[++i]);
        }
      }
    }

    try {
      const { FileWatcher } = await import('./utils/file-watcher');
      const { SandboxManager } = await import('./sandbox/sandbox-manager');
      
      const manager = new SandboxManager(
        this.config.sandbox.provider || 'e2b',
        { apiKey: this.config.sandbox.apiKey },
        options.directory
      );
      
      const watcher = new FileWatcher(options.directory);

      console.log(chalk.blue(`🔄 Starting file watcher for sandbox ${sandboxId}`));
      console.log(chalk.gray(`📂 Watching patterns: ${options.watch.join(', ')}`));
      console.log(chalk.gray(`🚫 Ignoring patterns: ${options.ignore.join(', ')}`));
      console.log(chalk.yellow('💡 File watcher runs in background. Continue using PromptCoder normally.\n'));

      await watcher.startWatching(sandboxId, {
        watchPatterns: options.watch,
        ignorePatterns: options.ignore,
        onFileChange: async (changedFiles) => {
          try {
            await manager.syncFiles(sandboxId, changedFiles);
            console.log(chalk.green(`✅ Synced ${changedFiles.length} file(s) to sandbox`));
          } catch (error) {
            console.error(chalk.red(`❌ Failed to sync files: ${error instanceof Error ? error.message : String(error)}`));
          }
        }
      });

      // Track the watcher so we can stop it on exit
      this.activeFileWatchers.set(sandboxId, watcher);

      console.log(chalk.green('🔄 File watcher started successfully for background sync'));
      console.log(chalk.gray('Files will automatically sync when changed. Use "exit" to stop.\n'));
      
    } catch (error) {
      console.error(chalk.red(`❌ File watching failed: ${error instanceof Error ? error.message : String(error)}`));
    }
    console.log();
  }

  private async handleStopCommand(params: string[]): Promise<void> {
    if (params.length === 0) {
      // Stop all watchers
      await this.stopAllFileWatchers();
      console.log(chalk.green('⏹️ All file watchers stopped\n'));
    } else {
      // Stop specific watcher
      const sandboxId = params[0];
      const watcher = this.activeFileWatchers.get(sandboxId);
      
      if (!watcher) {
        console.log(chalk.yellow(`⚠️  No active file watcher found for sandbox ${sandboxId}\n`));
        return;
      }

      try {
        await watcher.stopWatching(sandboxId);
        this.activeFileWatchers.delete(sandboxId);
        console.log(chalk.green(`⏹️ Stopped file watcher for sandbox ${sandboxId}\n`));
      } catch (error) {
        console.error(chalk.red(`❌ Failed to stop watcher: ${error instanceof Error ? error.message : String(error)}\n`));
      }
    }
  }

  private async handleExit(): Promise<void> {
    // Stop any active file watchers
    await this.stopAllFileWatchers();
    
    if (this.conversationHistory.length > 0 && !this.currentConversationId) {
      const { shouldSave } = await inquirer.prompt([
        {
          type: 'confirm',
          name: 'shouldSave',
          message: 'Save this conversation before exiting?',
          default: true
        }
      ]);

      if (shouldSave) {
        await this.handleSave();
      }
    } else if (this.currentConversationId) {
      await this.autoSave();
      console.log(chalk.green(`💾 Conversation "${this.currentConversationName}" saved automatically`));
    }

    console.log(chalk.yellow('Goodbye! 👋'));
  }

  private async handleClear(): Promise<void> {
    if (this.conversationHistory.length > 0) {
      const { confirm } = await inquirer.prompt([
        {
          type: 'confirm',
          name: 'confirm',
          message: 'Are you sure you want to clear the conversation history?',
          default: false
        }
      ]);

      if (confirm) {
        this.conversationHistory = [];
        this.currentConversationId = null;
        this.currentConversationName = null;
        console.log(chalk.blue('🧹 Conversation history cleared'));
      }
    } else {
      console.log(chalk.gray('No conversation history to clear'));
    }
    console.log();
  }

  private async handleSave(): Promise<void> {
    if (this.conversationHistory.length === 0) {
      console.log(chalk.yellow('No conversation to save'));
      return;
    }

    const { name, description } = await inquirer.prompt([
      {
        type: 'input',
        name: 'name',
        message: 'Conversation name:',
        default: this.currentConversationName || `Conversation ${new Date().toLocaleDateString()}`,
        validate: (input: string) => input.trim().length > 0 || 'Name is required'
      },
      {
        type: 'input',
        name: 'description',
        message: 'Description (optional):'
      }
    ]);

    try {
      const id = await this.conversationManager.saveConversation(
        this.conversationHistory,
        this.config.workingDirectory || process.cwd(),
        name.trim(),
        description.trim() || undefined,
        this.currentConversationId || undefined
      );

      this.currentConversationId = id;
      this.currentConversationName = name.trim();
      
      console.log(chalk.green(`💾 Conversation saved as "${name}"`));
      console.log(chalk.gray(`ID: ${id}`));
    } catch (error) {
      console.log(chalk.red('❌ Failed to save conversation:'), error);
    }
    console.log();
  }

  private async handleLoad(): Promise<void> {
    const conversations = await this.conversationManager.listConversations();
    
    if (conversations.length === 0) {
      console.log(chalk.yellow('No saved conversations found'));
      console.log();
      return;
    }

    const choices = conversations.map(conv => ({
      name: `${conv.name} (${conv.messageCount} messages, ${conv.updatedAt.toLocaleDateString()})`,
      value: conv.id,
      short: conv.name
    }));

    const { conversationId } = await inquirer.prompt([
      {
        type: 'list',
        name: 'conversationId',
        message: 'Select conversation to load:',
        choices,
        pageSize: 10
      }
    ]);

    const conversation = await this.conversationManager.loadConversation(conversationId);
    
    if (!conversation) {
      console.log(chalk.red('❌ Failed to load conversation'));
      return;
    }

    // Warn if working directories don't match
    if (conversation.workingDirectory !== this.config.workingDirectory) {
      const { switchDirectory } = await inquirer.prompt([
        {
          type: 'confirm',
          name: 'switchDirectory',
          message: `This conversation was in directory "${conversation.workingDirectory}". Switch to it?`,
          default: true
        }
      ]);

      if (switchDirectory) {
        await this.setWorkingDirectory(conversation.workingDirectory);
      }
    }

    this.conversationHistory = conversation.messages;
    this.currentConversationId = conversation.id;
    this.currentConversationName = conversation.name;

    console.log(chalk.green(`📂 Loaded conversation "${conversation.name}"`));
    console.log(chalk.gray(`Messages: ${conversation.messages.length}, Created: ${conversation.createdAt.toLocaleDateString()}`));
    if (conversation.description) {
      console.log(chalk.gray(`Description: ${conversation.description}`));
    }
    console.log();
  }

  private async handleList(): Promise<void> {
    const conversations = await this.conversationManager.listConversations();
    
    if (conversations.length === 0) {
      console.log(chalk.yellow('No saved conversations found'));
      console.log();
      return;
    }

    console.log(chalk.blue.bold('📚 Saved Conversations:'));
    console.log();

    for (const conv of conversations) {
      const current = conv.id === this.currentConversationId ? ' (current)' : '';
      console.log(chalk.green(`${conv.name}${current}`));
      console.log(chalk.gray(`  ID: ${conv.id}`));
      console.log(chalk.gray(`  Messages: ${conv.messageCount}`));
      console.log(chalk.gray(`  Directory: ${conv.workingDirectory}`));
      console.log(chalk.gray(`  Updated: ${conv.updatedAt.toLocaleString()}`));
      if (conv.description) {
        console.log(chalk.gray(`  Description: ${conv.description}`));
      }
      console.log();
    }

    const stats = await this.conversationManager.getConversationStats();
    console.log(chalk.blue('📊 Statistics:'));
    console.log(chalk.gray(`  Total conversations: ${stats.total}`));
    console.log(chalk.gray(`  Total messages: ${stats.totalMessages}`));
    console.log(chalk.gray(`  Average messages per conversation: ${stats.averageMessagesPerConversation}`));
    console.log();
  }

  private async handleRename(): Promise<void> {
    if (!this.currentConversationId) {
      console.log(chalk.yellow('No current conversation to rename. Load a conversation first.'));
      console.log();
      return;
    }

    const { newName } = await inquirer.prompt([
      {
        type: 'input',
        name: 'newName',
        message: 'New conversation name:',
        default: this.currentConversationName || '',
        validate: (input: string) => input.trim().length > 0 || 'Name is required'
      }
    ]);

    const success = await this.conversationManager.renameConversation(this.currentConversationId, newName.trim());
    
    if (success) {
      const oldName = this.currentConversationName;
      this.currentConversationName = newName.trim();
      console.log(chalk.green(`✏️  Renamed conversation from "${oldName}" to "${newName.trim()}"`));
    } else {
      console.log(chalk.red('❌ Failed to rename conversation'));
    }
    console.log();
  }

  private async handleDelete(): Promise<void> {
    const conversations = await this.conversationManager.listConversations();
    
    if (conversations.length === 0) {
      console.log(chalk.yellow('No saved conversations to delete'));
      console.log();
      return;
    }

    const choices = conversations.map(conv => ({
      name: `${conv.name} (${conv.messageCount} messages, ${conv.updatedAt.toLocaleDateString()})`,
      value: conv.id,
      short: conv.name
    }));

    const { conversationId } = await inquirer.prompt([
      {
        type: 'list',
        name: 'conversationId',
        message: 'Select conversation to delete:',
        choices,
        pageSize: 10
      }
    ]);

    const conversation = conversations.find(c => c.id === conversationId);
    
    const { confirm } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'confirm',
        message: `Are you sure you want to delete "${conversation?.name}"? This cannot be undone.`,
        default: false
      }
    ]);

    if (confirm) {
      const success = await this.conversationManager.deleteConversation(conversationId);
      
      if (success) {
        console.log(chalk.green(`🗑️  Deleted conversation "${conversation?.name}"`));
        
        // Clear current conversation if it was deleted
        if (conversationId === this.currentConversationId) {
          this.conversationHistory = [];
          this.currentConversationId = null;
          this.currentConversationName = null;
        }
      } else {
        console.log(chalk.red('❌ Failed to delete conversation'));
      }
    }
    console.log();
  }

  private async autoSave(): Promise<void> {
    if (!this.currentConversationId || this.conversationHistory.length === 0) {
      return;
    }

    try {
      await this.conversationManager.saveConversation(
        this.conversationHistory,
        this.config.workingDirectory || process.cwd(),
        this.currentConversationName || undefined,
        undefined,
        this.currentConversationId || undefined
      );
    } catch (error) {
      // Silent fail for auto-save
      console.log(chalk.yellow('⚠️  Auto-save failed'));
    }
  }

  private async stopAllFileWatchers(): Promise<void> {
    if (this.activeFileWatchers.size === 0) {
      return;
    }

    console.log(chalk.blue('🔄 Stopping active file watchers...'));
    
    for (const [sandboxId, watcher] of this.activeFileWatchers) {
      try {
        await watcher.stopAllWatching();
        console.log(chalk.gray(`⏹️ Stopped watcher for sandbox ${sandboxId}`));
      } catch (error) {
        console.log(chalk.yellow(`⚠️  Failed to stop watcher for ${sandboxId}`));
      }
    }
    
    this.activeFileWatchers.clear();
  }
}