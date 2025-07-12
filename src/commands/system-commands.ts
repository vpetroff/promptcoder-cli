import chalk from 'chalk';
import { BaseCommand, CommandContext, CommandMetadata } from './base-command';

export class HelpCommand extends BaseCommand {
  readonly metadata: CommandMetadata = {
    name: 'help',
    description: 'Show available commands',
    aliases: ['h', '?'],
    usage: '/help [command]',
    examples: ['/help', '/help save']
  };

  constructor(private commandRegistry: Map<string, BaseCommand>) {
    super();
  }

  async execute(context: CommandContext): Promise<void> {
    const commandName = context.args[0];

    if (commandName) {
      const command = this.commandRegistry.get(commandName);
      if (!command) {
        console.log(chalk.red(`❌ Unknown command: ${commandName}`));
        return;
      }

      console.log(chalk.blue.bold(`📖 Help for /${command.metadata.name}`));
      console.log(chalk.gray(command.metadata.description));
      
      if (command.metadata.aliases?.length) {
        console.log(chalk.cyan(`Aliases: ${command.metadata.aliases.map(a => `/${a}`).join(', ')}`));
      }
      
      if (command.metadata.usage) {
        console.log(chalk.cyan(`Usage: ${command.metadata.usage}`));
      }
      
      if (command.metadata.examples?.length) {
        console.log(chalk.cyan('Examples:'));
        command.metadata.examples.forEach(example => {
          console.log(chalk.gray(`  ${example}`));
        });
      }
      return;
    }

    console.log(chalk.blue.bold('🤖 PromptCoder Interactive Commands'));
    console.log(chalk.gray('All commands must start with a forward slash (/)'));
    console.log();

    const categories = {
      'Conversation Management': ['exit', 'clear', 'save', 'load', 'list', 'rename', 'delete'],
      'Development & Deployment': ['config', 'deploy', 'sandbox', 'watch', 'stop'],
      'Help': ['help']
    };

    Object.entries(categories).forEach(([category, commandNames]) => {
      console.log(chalk.blue.bold(category));
      commandNames.forEach(name => {
        const command = this.commandRegistry.get(name);
        if (command) {
          const aliases = command.metadata.aliases?.length ? 
            ` (${command.metadata.aliases.map(a => `/${a}`).join(', ')})` : '';
          console.log(chalk.cyan(`  /${name}${aliases}`));
          console.log(chalk.gray(`    ${command.metadata.description}`));
        }
      });
      console.log();
    });

    console.log(chalk.yellow('💡 Tips:'));
    console.log(chalk.gray('  • Use /help <command> for detailed help on a specific command'));
    console.log(chalk.gray('  • Press Ctrl+C to exit with auto-save'));
    console.log(chalk.gray('  • Commands are case-insensitive'));
  }
}

export class ConfigCommand extends BaseCommand {
  readonly metadata: CommandMetadata = {
    name: 'config',
    description: 'Configure API keys and settings',
    usage: '/config',
    examples: ['/config']
  };

  async execute(context: CommandContext): Promise<void> {
    try {
      const { setupConfig } = await import('../config');
      await setupConfig();
    } catch (error) {
      console.log(chalk.red('❌ Failed to open configuration:'));
      console.log(chalk.red(error instanceof Error ? error.message : String(error)));
    }
  }
}