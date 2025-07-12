import chalk from 'chalk';
import inquirer from 'inquirer';
import { BaseCommand, CommandContext, CommandMetadata } from './base-command';

export class ExitCommand extends BaseCommand {
  readonly metadata: CommandMetadata = {
    name: 'exit',
    description: 'Exit PromptCoder',
    aliases: ['quit', 'q'],
    usage: '/exit',
    examples: ['/exit']
  };

  async execute(context: CommandContext): Promise<void> {
    console.log(chalk.blue('👋 Goodbye!'));
    process.exit(0);
  }
}

export class ClearCommand extends BaseCommand {
  readonly metadata: CommandMetadata = {
    name: 'clear',
    description: 'Clear the current conversation history',
    usage: '/clear',
    examples: ['/clear']
  };

  async execute(context: CommandContext): Promise<void> {
    if (context.app.conversationHistory.length === 0) {
      console.log(chalk.yellow('No conversation to clear.'));
      return;
    }

    const { confirm } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'confirm',
        message: 'Are you sure you want to clear the conversation?',
        default: false
      }
    ]);

    if (confirm) {
      context.app.conversationHistory = [];
      context.app.currentConversationId = null;
      context.app.currentConversationName = null;
      console.log(chalk.green('✅ Conversation cleared.'));
    } else {
      console.log(chalk.gray('Clear cancelled.'));
    }
  }
}

export class SaveCommand extends BaseCommand {
  readonly metadata: CommandMetadata = {
    name: 'save',
    description: 'Save the current conversation',
    usage: '/save [name]',
    examples: ['/save', '/save "My Project"']
  };

  async execute(context: CommandContext): Promise<void> {
    if (context.app.conversationHistory.length === 0) {
      console.log(chalk.yellow('No conversation to save.'));
      return;
    }

    if (context.app.currentConversationId) {
      await context.app.autoSave();
      console.log(chalk.green('✅ Conversation auto-saved.'));
      return;
    }

    let conversationName = context.args.join(' ');
    let description = '';

    if (!conversationName) {
      const answers = await inquirer.prompt([
        {
          type: 'input',
          name: 'name',
          message: 'Conversation name:',
          validate: (input: string) => input.trim().length > 0 || 'Please enter a name'
        },
        {
          type: 'input',
          name: 'description',
          message: 'Description (optional):'
        }
      ]);
      conversationName = answers.name;
      description = answers.description;
    }

    try {
      const conversationId = await context.app.conversationManager.saveConversation(
        context.app.conversationHistory,
        context.app.config.workingDirectory || process.cwd(),
        conversationName,
        description
      );

      context.app.currentConversationId = conversationId;
      context.app.currentConversationName = conversationName;
      console.log(chalk.green(`✅ Conversation saved as "${conversationName}"`));
    } catch (error) {
      console.log(chalk.red('❌ Failed to save conversation:'));
      console.log(chalk.red(error instanceof Error ? error.message : String(error)));
    }
  }
}

export class LoadCommand extends BaseCommand {
  readonly metadata: CommandMetadata = {
    name: 'load',
    description: 'Load a saved conversation',
    usage: '/load [conversation-id]',
    examples: ['/load', '/load abc123']
  };

  async execute(context: CommandContext): Promise<void> {
    const conversations = await context.app.conversationManager.listConversations();
    
    if (conversations.length === 0) {
      console.log(chalk.yellow('No saved conversations found.'));
      return;
    }

    let selectedId = context.args[0];

    if (!selectedId) {
      const choices = conversations.map(conv => ({
        name: `${conv.name} (${conv.messageCount} messages, ${new Date(conv.updatedAt).toLocaleDateString()})`,
        value: conv.id
      }));

      const { conversationId } = await inquirer.prompt([
        {
          type: 'list',
          name: 'conversationId',
          message: 'Select a conversation to load:',
          choices
        }
      ]);
      selectedId = conversationId;
    }

    try {
      const conversation = await context.app.conversationManager.loadConversation(selectedId);
      
      if (!conversation) {
        console.log(chalk.red('❌ Conversation not found.'));
        return;
      }
      
      if (conversation.workingDirectory !== (context.app.config.workingDirectory || process.cwd())) {
        const { switchDirectory } = await inquirer.prompt([
          {
            type: 'confirm',
            name: 'switchDirectory',
            message: `This conversation was saved from a different directory (${conversation.workingDirectory}). Switch to that directory?`,
            default: true
          }
        ]);

        if (switchDirectory) {
          context.app.config.workingDirectory = conversation.workingDirectory;
          process.chdir(conversation.workingDirectory);
        }
      }

      context.app.conversationHistory = conversation.messages;
      context.app.currentConversationId = selectedId;
      context.app.currentConversationName = conversation.name;
      
      console.log(chalk.green(`✅ Loaded conversation "${conversation.name}"`));
      console.log(chalk.gray(`Messages: ${conversation.messages.length}, Directory: ${conversation.workingDirectory}`));
    } catch (error) {
      console.log(chalk.red('❌ Failed to load conversation:'));
      console.log(chalk.red(error instanceof Error ? error.message : String(error)));
    }
  }
}

export class ListCommand extends BaseCommand {
  readonly metadata: CommandMetadata = {
    name: 'list',
    description: 'List all saved conversations',
    aliases: ['ls'],
    usage: '/list',
    examples: ['/list']
  };

  async execute(context: CommandContext): Promise<void> {
    const conversations = await context.app.conversationManager.listConversations();
    
    if (conversations.length === 0) {
      console.log(chalk.yellow('No saved conversations found.'));
      return;
    }

    console.log(chalk.blue(`📚 Found ${conversations.length} saved conversation(s):`));
    conversations.forEach(conv => {
      const isActive = conv.id === context.app.currentConversationId ? chalk.green('(active)') : '';
      console.log(chalk.cyan(`• ${conv.name} ${isActive}`));
      console.log(chalk.gray(`  ${conv.messageCount} messages, last modified: ${new Date(conv.updatedAt).toLocaleString()}`));
      console.log(chalk.gray(`  Directory: ${conv.workingDirectory}`));
      if (conv.description) {
        console.log(chalk.gray(`  Description: ${conv.description}`));
      }
      console.log();
    });
  }
}

export class RenameCommand extends BaseCommand {
  readonly metadata: CommandMetadata = {
    name: 'rename',
    description: 'Rename the current conversation',
    usage: '/rename [new-name]',
    examples: ['/rename "New Name"']
  };

  async execute(context: CommandContext): Promise<void> {
    if (!context.app.currentConversationId) {
      console.log(chalk.yellow('No active conversation to rename. Save the conversation first.'));
      return;
    }

    let newName = context.args.join(' ');

    if (!newName) {
      const { name } = await inquirer.prompt([
        {
          type: 'input',
          name: 'name',
          message: 'New conversation name:',
          default: context.app.currentConversationName,
          validate: (input: string) => input.trim().length > 0 || 'Please enter a name'
        }
      ]);
      newName = name;
    }

    try {
      await context.app.conversationManager.renameConversation(context.app.currentConversationId, newName);
      context.app.currentConversationName = newName;
      console.log(chalk.green(`✅ Conversation renamed to "${newName}"`));
    } catch (error) {
      console.log(chalk.red('❌ Failed to rename conversation:'));
      console.log(chalk.red(error instanceof Error ? error.message : String(error)));
    }
  }
}

export class DeleteCommand extends BaseCommand {
  readonly metadata: CommandMetadata = {
    name: 'delete',
    description: 'Delete a saved conversation',
    aliases: ['rm'],
    usage: '/delete [conversation-id]',
    examples: ['/delete', '/delete abc123']
  };

  async execute(context: CommandContext): Promise<void> {
    const conversations = await context.app.conversationManager.listConversations();
    
    if (conversations.length === 0) {
      console.log(chalk.yellow('No saved conversations found.'));
      return;
    }

    let selectedId = context.args[0];

    if (!selectedId) {
      const choices = conversations.map(conv => ({
        name: `${conv.name} (${conv.messageCount} messages, ${new Date(conv.updatedAt).toLocaleDateString()})`,
        value: conv.id
      }));

      const { conversationId } = await inquirer.prompt([
        {
          type: 'list',
          name: 'conversationId',
          message: 'Select a conversation to delete:',
          choices
        }
      ]);
      selectedId = conversationId;
    }

    const conversation = conversations.find(c => c.id === selectedId);
    if (!conversation) {
      console.log(chalk.red('❌ Conversation not found.'));
      return;
    }

    const { confirm } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'confirm',
        message: `Are you sure you want to delete "${conversation.name}"?`,
        default: false
      }
    ]);

    if (!confirm) {
      console.log(chalk.gray('Delete cancelled.'));
      return;
    }

    try {
      await context.app.conversationManager.deleteConversation(selectedId);
      
      if (selectedId === context.app.currentConversationId) {
        context.app.currentConversationId = null;
        context.app.currentConversationName = null;
      }
      
      console.log(chalk.green(`✅ Deleted conversation "${conversation.name}"`));
    } catch (error) {
      console.log(chalk.red('❌ Failed to delete conversation:'));
      console.log(chalk.red(error instanceof Error ? error.message : String(error)));
    }
  }
}