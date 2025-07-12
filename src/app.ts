import chalk from 'chalk';
import inquirer from 'inquirer';
import { createLLMClient, LLMClient, LLMConfig, Message } from './llm';
import { FileTools } from './tools/file-tools';
import { AdvancedTools } from './tools/advanced-tools';
import { ConversationManager } from './conversation-manager';

export interface AppConfig extends LLMConfig {
  workingDirectory?: string;
}

export class CodePromptApp {
  private llmClient: LLMClient;
  private fileTools: FileTools;
  private advancedTools: AdvancedTools;
  private config: AppConfig;
  private conversationHistory: Message[] = [];
  private conversationManager: ConversationManager;
  private currentConversationId: string | null = null;
  private currentConversationName: string | null = null;

  constructor(config: AppConfig) {
    this.config = config;
    this.llmClient = createLLMClient(config);
    this.fileTools = new FileTools(config.workingDirectory);
    this.advancedTools = new AdvancedTools(config.workingDirectory);
    this.conversationManager = new ConversationManager();
  }

  async startInteractive(): Promise<void> {
    console.log(chalk.blue.bold('🤖 PromptCoder Interactive Mode'));
    console.log(chalk.gray('Commands: exit, clear, save, load, list, rename, delete\n'));

    // Show current conversation info
    if (this.currentConversationName) {
      console.log(chalk.green(`📝 Current conversation: ${this.currentConversationName}`));
      console.log(chalk.gray(`Messages: ${this.conversationHistory.length}\n`));
    }

    while (true) {
      const { prompt } = await inquirer.prompt([
        {
          type: 'input',
          name: 'prompt',
          message: chalk.cyan(this.currentConversationName ? `[${this.currentConversationName}] Prompt:` : 'Prompt:'),
          validate: (input: string) => input.trim().length > 0 || 'Please enter a prompt'
        }
      ]);

      const command = prompt.toLowerCase().trim();

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
      
      const tools = [...this.fileTools.getTools(), ...this.advancedTools.getTools()];
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
          
          if (advancedToolNames.includes(toolCall.name)) {
            result = await this.advancedTools.executeTool(toolCall.name, toolCall.parameters);
          } else if (basicToolNames.includes(toolCall.name)) {
            result = await this.fileTools.executeTool(toolCall.name, toolCall.parameters);
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

      const tools = [...this.fileTools.getTools(), ...this.advancedTools.getTools()];
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
          
          if (advancedToolNames.includes(toolCall.name)) {
            result = await this.advancedTools.executeTool(toolCall.name, toolCall.parameters);
          } else if (basicToolNames.includes(toolCall.name)) {
            result = await this.fileTools.executeTool(toolCall.name, toolCall.parameters);
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
    this.config.workingDirectory = directory;
    console.log(chalk.blue(`📁 Working directory set to: ${directory}`));
  }

  private async handleExit(): Promise<void> {
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
}