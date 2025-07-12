import chalk from 'chalk';
import inquirer from 'inquirer';
import * as readline from 'readline';
import death from 'death';
import { createLLMClient, LLMClient, LLMConfig, Message } from './llm';
import { FileTools } from './tools/file-tools';
import { AdvancedTools } from './tools/advanced-tools';
import { SandboxTools } from './tools/sandbox-tools';
import { ConversationManager } from './conversation-manager';
import { CommandRegistry } from './commands/command-registry';

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
  public config: AppConfig;
  public conversationHistory: Message[] = [];
  public conversationManager: ConversationManager;
  public currentConversationId: string | null = null;
  public currentConversationName: string | null = null;
  private activeFileWatchers: Map<string, any> = new Map();
  private commandRegistry: CommandRegistry;

  constructor(config: AppConfig) {
    this.config = config;
    this.llmClient = createLLMClient(config);
    this.fileTools = new FileTools(config.workingDirectory);
    this.advancedTools = new AdvancedTools(config.workingDirectory);
    this.sandboxTools = new SandboxTools(config.workingDirectory);
    this.conversationManager = new ConversationManager();
    this.commandRegistry = new CommandRegistry();
    this.initializeSandboxTools();
    
    // Set up graceful exit handler early
    this.setupGracefulExit();
  }

  private initializeSandboxTools(): void {
    if (this.config.sandbox?.enabled && this.config.sandbox.provider && this.config.sandbox.apiKey) {
      this.sandboxTools.setSandboxConfig(this.config.sandbox.provider, {
        apiKey: this.config.sandbox.apiKey
      });
    }
  }

  private async autoSaveOnExit(): Promise<void> {
      try {
        // Stop any active file watchers
        await this.stopAllFileWatchers();
        
        // Auto-save conversations
        if (this.conversationHistory.length > 0 && !this.currentConversationId) {
          console.log(chalk.blue('Auto-saving conversation before exit...'));
          const timestamp = new Date().toISOString().slice(0, 16).replace('T', ' ');
          const conversationName = `Conversation ${timestamp}`;
          await this.conversationManager.saveConversation(
            this.conversationHistory,
            this.config.workingDirectory || process.cwd(),
            conversationName,
            'Auto-saved during exit'
          );
          console.log(chalk.green(`✅ Conversation saved as "${conversationName}"`));
        } else if (this.currentConversationId && this.conversationHistory.length > 0) {
          await this.autoSave();
          console.log(chalk.green('✅ Conversation auto-saved'));
        }
      } catch (error) {
        console.log(chalk.yellow('Failed to save conversation. Exiting...'));
      }
      
      console.log(chalk.green('🎉 Thanks for using PromptCoder!'));
      process.exit(0);
  }    

  private setupGracefulExit(): void {
    death(async (signal: string) => {
      return this.autoSaveOnExit();
    });
  }

  private async promptUser(message: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
        terminal: true
      });

      rl.question(message, (answer) => {
        rl.close();
        resolve(answer);
      });

      // Handle SIGINT properly - let death handle it
      rl.on('SIGINT', async () => {
        console.log(chalk.blue('\n👋 Exiting...'));
        rl.close();
        await this.autoSaveOnExit();
      });
    });
  }

  async startInteractive(): Promise<void> {
    console.log(chalk.blue.bold('🤖 PromptCoder Interactive Mode'));
    console.log(chalk.gray('Commands: /exit, /clear, /save, /load, /list, /rename, /delete'));
    console.log(chalk.gray('CLI Commands: /deploy, /sandbox, /watch, /stop (use /help for full list)'));
    console.log(chalk.gray('Press Ctrl+C to exit\n'));

    // Show current conversation info
    if (this.currentConversationName) {
      console.log(chalk.green(`📝 Current conversation: ${this.currentConversationName}`));
      console.log(chalk.gray(`Messages: ${this.conversationHistory.length}\n`));
    }

    while (true) {
      try {
        const promptMessage = chalk.cyan(this.currentConversationName ? `[${this.currentConversationName}] Prompt: ` : 'Prompt: ');
        const prompt = await this.promptUser(promptMessage);
        
        const trimmedPrompt = prompt.trim();
        
        if (trimmedPrompt.length === 0) {
          console.log(chalk.yellow('Please enter a prompt\n'));
          continue;
        }

        // Handle all commands prefixed with /
        const wasCommand = await this.commandRegistry.executeCommand(trimmedPrompt, { app: this });
        if (wasCommand) {
          continue;
        }

        // Check if user might have intended to use a command without /
        const commandNames = this.commandRegistry.listCommands().map(cmd => cmd.metadata.name);
        const allAliases = this.commandRegistry.listCommands().flatMap(cmd => cmd.metadata.aliases || []);
        const possibleCommands = [...commandNames, ...allAliases];
        const lowerPrompt = trimmedPrompt.toLowerCase();
        
        if (possibleCommands.includes(lowerPrompt) || possibleCommands.some(cmd => lowerPrompt.startsWith(cmd + ' '))) {
          console.log(chalk.yellow(`💡 Did you mean to use /${lowerPrompt}? All commands require a / prefix.`));
          console.log(chalk.gray('Use /help to see all available commands\n'));
          continue;
        }

        // If it doesn't start with /, treat it as a prompt for the AI
        await this.executeInteractivePrompt(trimmedPrompt);
        
        // Auto-save after each interaction if we have a current conversation
        if (this.currentConversationId && this.conversationHistory.length > 0) {
          await this.autoSave();
        }
        
        console.log(); // Empty line for spacing
      } catch (error) {
        // Handle any errors gracefully
        break;
      }
    }
  }

  // Public methods for command system
  public async autoSave(): Promise<void> {
    if (this.currentConversationId && this.conversationHistory.length > 0) {
      try {
        await this.conversationManager.saveConversation(
          this.conversationHistory,
          this.config.workingDirectory || process.cwd(),
          this.currentConversationName || 'Untitled',
          undefined,
          this.currentConversationId
        );
      } catch (error) {
        console.log(chalk.yellow('⚠️ Auto-save failed, but continuing...'));
      }
    }
  }

  public async startFileWatching(sandboxId: string, options: { watchPatterns: string[]; ignorePatterns: string[] }): Promise<void> {
    if (!this.config.sandbox?.enabled || !this.config.sandbox.apiKey) {
      throw new Error('Sandbox not configured');
    }

    try {
      const { FileWatcher } = await import('./utils/file-watcher');
      const { SandboxManager } = await import('./sandbox/sandbox-manager');
      
      const manager = new SandboxManager(
        this.config.sandbox.provider || 'e2b',
        { apiKey: this.config.sandbox.apiKey },
        this.config.workingDirectory || process.cwd()
      );
      
      const watcher = new FileWatcher(this.config.workingDirectory || process.cwd());

      console.log(chalk.blue(`🔄 Starting file watcher for sandbox ${sandboxId}`));
      console.log(chalk.gray(`📂 Watching patterns: ${options.watchPatterns.join(', ')}`));
      console.log(chalk.gray(`🚫 Ignoring patterns: ${options.ignorePatterns.join(', ')}`));
      console.log(chalk.yellow('💡 File watcher runs in background. Continue using PromptCoder normally.\n'));

      await watcher.startWatching(sandboxId, {
        watchPatterns: options.watchPatterns,
        ignorePatterns: options.ignorePatterns,
        onFileChange: async (changedFiles) => {
          try {
            await manager.syncFiles(sandboxId, changedFiles);
            console.log(chalk.green(`✅ Synced ${changedFiles.length} file(s) to sandbox`));
          } catch (error) {
            console.error(chalk.red(`❌ Failed to sync files: ${error instanceof Error ? error.message : String(error)}`));
          }
        }
      });

      this.activeFileWatchers.set(sandboxId, watcher);
      console.log(chalk.green('🔄 File watcher started successfully for background sync'));
    } catch (error) {
      throw new Error(`File watching failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  public async stopFileWatching(sandboxId: string): Promise<void> {
    const watcher = this.activeFileWatchers.get(sandboxId);
    if (!watcher) {
      throw new Error(`No active file watcher found for sandbox ${sandboxId}`);
    }

    try {
      await watcher.stopWatching(sandboxId);
      this.activeFileWatchers.delete(sandboxId);
    } catch (error) {
      throw new Error(`Failed to stop watcher: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  public async stopAllFileWatchers(): Promise<void> {
    const watchers = Array.from(this.activeFileWatchers.entries());
    for (const [sandboxId, watcher] of watchers) {
      try {
        await watcher.stopAllWatching();
        this.activeFileWatchers.delete(sandboxId);
      } catch (error) {
        console.error(chalk.red(`❌ Failed to stop watcher for ${sandboxId}: ${error instanceof Error ? error.message : String(error)}`));
      }
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


}