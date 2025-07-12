import { BaseCommand, CommandContext } from './base-command';
import { 
  ExitCommand, 
  ClearCommand, 
  SaveCommand, 
  LoadCommand, 
  ListCommand, 
  RenameCommand, 
  DeleteCommand 
} from './conversation-commands';
import { HelpCommand, ConfigCommand } from './system-commands';
import { DeployCommand, SandboxCommand, WatchCommand, StopCommand } from './sandbox-commands';

export class CommandRegistry {
  private commands = new Map<string, BaseCommand>();
  private aliases = new Map<string, string>();

  constructor() {
    this.registerDefaultCommands();
  }

  private registerDefaultCommands(): void {
    // Create help command first since it needs the registry
    const helpCommand = new HelpCommand(this.commands);
    
    const commands = [
      // Conversation commands
      new ExitCommand(),
      new ClearCommand(),
      new SaveCommand(),
      new LoadCommand(),
      new ListCommand(),
      new RenameCommand(),
      new DeleteCommand(),
      
      // System commands
      helpCommand,
      new ConfigCommand(),
      
      // Sandbox commands
      new DeployCommand(),
      new SandboxCommand(),
      new WatchCommand(),
      new StopCommand()
    ];

    commands.forEach(command => {
      this.registerCommand(command);
    });
  }

  registerCommand(command: BaseCommand): void {
    this.commands.set(command.metadata.name.toLowerCase(), command);
    
    // Register aliases
    if (command.metadata.aliases) {
      command.metadata.aliases.forEach(alias => {
        this.aliases.set(alias.toLowerCase(), command.metadata.name.toLowerCase());
      });
    }
  }

  async executeCommand(input: string, context: Omit<CommandContext, 'args' | 'rawInput'>): Promise<boolean> {
    const trimmed = input.trim();
    
    if (!trimmed.startsWith('/')) {
      return false; // Not a command
    }

    const commandPart = trimmed.slice(1); // Remove the /
    const [commandName, ...args] = this.parseCommandLine(commandPart);
    
    if (!commandName) {
      return false;
    }

    const normalizedName = commandName.toLowerCase();
    const actualName = this.aliases.get(normalizedName) || normalizedName;
    const command = this.commands.get(actualName);

    if (!command) {
      console.log(`❌ Unknown command: /${commandName}`);
      console.log('💡 Use /help to see available commands');
      return true; // It was a command attempt, just invalid
    }

    try {
      await command.execute({
        ...context,
        args,
        rawInput: trimmed
      });
    } catch (error) {
      console.log(`❌ Error executing command /${commandName}:`);
      console.log(error instanceof Error ? error.message : String(error));
    }

    return true; // Command was processed
  }

  getCommand(name: string): BaseCommand | undefined {
    const normalizedName = name.toLowerCase();
    const actualName = this.aliases.get(normalizedName) || normalizedName;
    return this.commands.get(actualName);
  }

  listCommands(): BaseCommand[] {
    return Array.from(this.commands.values());
  }

  private parseCommandLine(input: string): string[] {
    const args: string[] = [];
    let current = '';
    let inQuotes = false;
    let quoteChar = '';

    for (let i = 0; i < input.length; i++) {
      const char = input[i];
      
      if (!inQuotes && (char === '"' || char === "'")) {
        inQuotes = true;
        quoteChar = char;
      } else if (inQuotes && char === quoteChar) {
        inQuotes = false;
        quoteChar = '';
      } else if (!inQuotes && char === ' ') {
        if (current) {
          args.push(current);
          current = '';
        }
      } else {
        current += char;
      }
    }

    if (current) {
      args.push(current);
    }

    return args;
  }
}