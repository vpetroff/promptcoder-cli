import chalk from 'chalk';
import { BaseCommand, CommandContext, CommandMetadata } from './base-command';

export class DeployCommand extends BaseCommand {
  readonly metadata: CommandMetadata = {
    name: 'deploy',
    description: 'Deploy current project to sandbox environment',
    usage: '/deploy [options]',
    examples: [
      '/deploy',
      '/deploy --template react-ts',
      '/deploy --name "My App" --no-open'
    ]
  };

  async execute(context: CommandContext): Promise<void> {
    if (!context.app.config.sandbox?.enabled || !context.app.config.sandbox.apiKey) {
      console.log(chalk.red('🚫 Sandbox deployment not configured. Run /config to set up.'));
      return;
    }

    const { flags } = this.parseFlags(context.args);

    try {
      const { SandboxManager } = await import('../sandbox/sandbox-manager');
      const manager = new SandboxManager(
        context.app.config.sandbox.provider || 'e2b',
        { apiKey: context.app.config.sandbox.apiKey },
        context.app.config.workingDirectory || process.cwd()
      );

      console.log(chalk.blue('🚀 Deploying to sandbox...'));
      const result = await manager.deployProject({
        template: flags.template as string,
        name: flags.name as string
      });

      console.log(chalk.green('✅ Deployment successful!'));
      console.log(chalk.cyan(`📦 Sandbox ID: ${result.sandbox.id}`));
      console.log(chalk.cyan(`🌐 URL: ${result.url}`));
      console.log(chalk.cyan(`📁 Files uploaded: ${result.filesUploaded}`));
      console.log(chalk.cyan(`⚡ Template: ${result.sandbox.template}`));

      if (flags.open !== false && !flags['no-open']) {
        try {
          const { default: open } = await import('open');
          await open(result.url);
          console.log(chalk.green('🌍 Opened in browser'));
        } catch (error) {
          console.log(chalk.yellow('⚠️ Could not open browser automatically'));
        }
      }
    } catch (error) {
      console.log(chalk.red('❌ Deployment failed:'));
      console.log(chalk.red(error instanceof Error ? error.message : String(error)));
    }
  }
}

export class SandboxCommand extends BaseCommand {
  readonly metadata: CommandMetadata = {
    name: 'sandbox',
    description: 'Manage sandbox deployments',
    usage: '/sandbox <action> [id]',
    examples: [
      '/sandbox list',
      '/sandbox status abc123',
      '/sandbox delete abc123'
    ]
  };

  async execute(context: CommandContext): Promise<void> {
    if (!context.app.config.sandbox?.enabled || !context.app.config.sandbox.apiKey) {
      console.log(chalk.red('🚫 Sandbox deployment not configured. Run /config to set up.'));
      return;
    }

    this.validateArgs(context.args, 1);
    const [action, id] = context.args;

    try {
      const { SandboxManager } = await import('../sandbox/sandbox-manager');
      const manager = new SandboxManager(
        context.app.config.sandbox.provider || 'e2b',
        { apiKey: context.app.config.sandbox.apiKey },
        context.app.config.workingDirectory || process.cwd()
      );

      switch (action.toLowerCase()) {
        case 'list':
          await this.handleList(manager);
          break;
        case 'status':
          if (!id) throw new Error('Sandbox ID required for status action');
          await this.handleStatus(manager, id);
          break;
        case 'delete':
          if (!id) throw new Error('Sandbox ID required for delete action');
          await this.handleDelete(manager, id);
          break;
        default:
          console.log(chalk.red(`❌ Unknown action: ${action}`));
          console.log(chalk.gray('Available actions: list, status, delete'));
      }
    } catch (error) {
      console.log(chalk.red('❌ Sandbox command failed:'));
      console.log(chalk.red(error instanceof Error ? error.message : String(error)));
    }
  }

  private async handleList(manager: any): Promise<void> {
    const sandboxes = await manager.listSandboxes();
    if (sandboxes.length === 0) {
      console.log(chalk.yellow('No active sandboxes found.'));
    } else {
      console.log(chalk.blue(`Found ${sandboxes.length} sandbox(es):`));
      sandboxes.forEach((s: any) => {
        console.log(chalk.cyan(`📦 ${s.name} (${s.id.slice(0, 8)}) - ${s.status} - ${s.url}`));
      });
    }
  }

  private async handleStatus(manager: any, id: string): Promise<void> {
    const sandbox = await manager.getSandbox(id);
    console.log(chalk.blue(`📦 ${sandbox.name}`));
    console.log(chalk.cyan(`🆔 ID: ${sandbox.id}`));
    console.log(chalk.cyan(`🌐 URL: ${sandbox.url}`));
    console.log(chalk.cyan(`📋 Status: ${sandbox.status}`));
    console.log(chalk.cyan(`🏷️ Template: ${sandbox.template}`));
  }

  private async handleDelete(manager: any, id: string): Promise<void> {
    await manager.deleteSandbox(id);
    console.log(chalk.green(`🗑️ Deleted sandbox ${id}`));
  }
}

export class WatchCommand extends BaseCommand {
  readonly metadata: CommandMetadata = {
    name: 'watch',
    description: 'Watch for file changes and auto-sync to a sandbox',
    usage: '/watch <sandbox-id> [options]',
    examples: [
      '/watch abc123',
      '/watch abc123 --watch "src/**/*.ts"',
      '/watch abc123 --ignore "node_modules/**"'
    ]
  };

  async execute(context: CommandContext): Promise<void> {
    if (!context.app.config.sandbox?.enabled || !context.app.config.sandbox.apiKey) {
      console.log(chalk.red('🚫 Sandbox deployment not configured. Run /config to set up.'));
      return;
    }

    this.validateArgs(context.args, 1);
    const { flags, positional } = this.parseFlags(context.args);
    const sandboxId = positional[0];

    const watchPatterns = flags.watch ? 
      (Array.isArray(flags.watch) ? flags.watch as string[] : [flags.watch as string]) : 
      ['**/*'];
    const ignorePatterns = flags.ignore ? 
      (Array.isArray(flags.ignore) ? flags.ignore as string[] : [flags.ignore as string]) : 
      ['node_modules/**', '.git/**', 'dist/**', 'build/**'];

    try {
      await context.app.startFileWatching(sandboxId, {
        watchPatterns,
        ignorePatterns
      });
    } catch (error) {
      console.log(chalk.red('❌ Failed to start file watching:'));
      console.log(chalk.red(error instanceof Error ? error.message : String(error)));
    }
  }
}

export class StopCommand extends BaseCommand {
  readonly metadata: CommandMetadata = {
    name: 'stop',
    description: 'Stop file watching for a sandbox or all sandboxes',
    usage: '/stop [sandbox-id]',
    examples: [
      '/stop',
      '/stop abc123'
    ]
  };

  async execute(context: CommandContext): Promise<void> {
    const sandboxId = context.args[0];

    try {
      if (sandboxId) {
        await context.app.stopFileWatching(sandboxId);
        console.log(chalk.green(`⏹️ Stopped file watching for sandbox ${sandboxId}`));
      } else {
        await context.app.stopAllFileWatchers();
        console.log(chalk.green('⏹️ Stopped all file watchers'));
      }
    } catch (error) {
      console.log(chalk.red('❌ Failed to stop file watching:'));
      console.log(chalk.red(error instanceof Error ? error.message : String(error)));
    }
  }
}