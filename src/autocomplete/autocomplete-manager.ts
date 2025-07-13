import { BaseCommand } from '../commands/base-command';
import { CommandRegistry } from '../commands/command-registry';

export class AutocompleteManager {
  constructor(private commandRegistry: CommandRegistry) {}

  public getCompletions(input: string): [string[], string] {
    if (!input.startsWith('/')) {
      return [[], input];
    }

    const parts = input.split(' ');
    const commandPart = parts[0];
    
    // Command name completion
    if (parts.length === 1) {
      return this.getCommandNameCompletions(commandPart);
    }

    // Argument completion
    return this.getCommandArgumentCompletions(commandPart, parts, input);
  }

  private getCommandNameCompletions(commandPart: string): [string[], string] {
    const commands = this.commandRegistry.listCommands();
    const allCommandNames: string[] = [];
    
    commands.forEach(cmd => {
      allCommandNames.push(`/${cmd.metadata.name}`);
      if (cmd.metadata.aliases) {
        cmd.metadata.aliases.forEach(alias => {
          allCommandNames.push(`/${alias}`);
        });
      }
    });

    const matches = allCommandNames
      .filter(cmd => cmd.startsWith(commandPart))
      .sort();
    
    return [matches, commandPart];
  }

  private getCommandArgumentCompletions(commandPart: string, parts: string[], input: string): [string[], string] {
    const commandName = commandPart.slice(1);
    const command = this.commandRegistry.getCommand(commandName);
    
    if (!command || typeof command.getCompletions !== 'function') {
      return [[], input];
    }

    return command.getCompletions(parts, input);
  }

  public createReadlineCompleter(): (line: string) => [string[], string] {
    return (line: string) => this.getCompletions(line);
  }
}