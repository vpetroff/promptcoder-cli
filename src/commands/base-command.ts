import { CodePromptApp } from '../app';

export interface CommandContext {
  app: CodePromptApp;
  args: string[];
  rawInput: string;
}

export interface CommandMetadata {
  name: string;
  description: string;
  aliases?: string[];
  usage?: string;
  examples?: string[];
}

export abstract class BaseCommand {
  abstract readonly metadata: CommandMetadata;
  
  abstract execute(context: CommandContext): Promise<void>;
  
  protected validateArgs(args: string[], minArgs: number, maxArgs?: number): void {
    if (args.length < minArgs) {
      throw new Error(`Command '${this.metadata.name}' requires at least ${minArgs} argument(s)`);
    }
    if (maxArgs !== undefined && args.length > maxArgs) {
      throw new Error(`Command '${this.metadata.name}' accepts at most ${maxArgs} argument(s)`);
    }
  }
  
  protected parseFlags(args: string[]): { flags: Record<string, string | boolean>; positional: string[] } {
    const flags: Record<string, string | boolean> = {};
    const positional: string[] = [];
    
    for (let i = 0; i < args.length; i++) {
      const arg = args[i];
      
      if (arg.startsWith('--')) {
        const [key, value] = arg.slice(2).split('=');
        if (value !== undefined) {
          flags[key] = value;
        } else if (i + 1 < args.length && !args[i + 1].startsWith('-')) {
          flags[key] = args[++i];
        } else {
          flags[key] = true;
        }
      } else if (arg.startsWith('-')) {
        const key = arg.slice(1);
        if (i + 1 < args.length && !args[i + 1].startsWith('-')) {
          flags[key] = args[++i];
        } else {
          flags[key] = true;
        }
      } else {
        positional.push(arg);
      }
    }
    
    return { flags, positional };
  }
}