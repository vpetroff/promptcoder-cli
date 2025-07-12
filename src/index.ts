#!/usr/bin/env node

import { Command } from 'commander';
import { CodePromptApp } from './app';
import { loadConfig } from './config';

const program = new Command();

program
  .name('promptcoder')
  .description('Generate application code using LLM prompting')
  .version('1.0.0');

program
  .command('interactive')
  .alias('i')
  .description('Start interactive mode')
  .action(async () => {
    const config = await loadConfig();
    const app = new CodePromptApp(config);
    await app.startInteractive();
  });

program
  .command('prompt <message>')
  .alias('p')
  .description('Execute a single prompt')
  .option('-d, --directory <dir>', 'working directory', process.cwd())
  .action(async (message: string, options: { directory: string }) => {
    const config = await loadConfig();
    const app = new CodePromptApp(config);
    await app.executePrompt(message, options.directory);
  });

program
  .command('config')
  .description('Configure API keys and settings')
  .action(async () => {
    const { setupConfig } = await import('./config');
    await setupConfig();
  });

program
  .command('deploy')
  .description('Deploy current project to sandbox environment')
  .option('-t, --template <template>', 'Sandbox template to use (auto-detected if not specified)')
  .option('-n, --name <name>', 'Name for the deployment')
  .option('-d, --directory <dir>', 'Working directory', process.cwd())
  .option('--no-open', 'Do not open the deployed sandbox in browser')
  .action(async (options: { template?: string; name?: string; directory: string; open: boolean }) => {
    const config = await loadConfig();
    
    if (!config.sandbox?.enabled || !config.sandbox.apiKey) {
      console.log('🚫 Sandbox deployment not configured. Run "promptcoder config" to set up.');
      return;
    }

    const app = new CodePromptApp({ ...config, workingDirectory: options.directory });
    
    try {
      // Deploy using sandbox tools directly
      const { SandboxManager } = await import('./sandbox/sandbox-manager');
      const manager = new SandboxManager(
        config.sandbox.provider || 'e2b',
        { apiKey: config.sandbox.apiKey },
        options.directory
      );

      console.log('🚀 Deploying to sandbox...');
      const result = await manager.deployProject({
        template: options.template,
        name: options.name
      });

      console.log(`✅ Deployment successful!`);
      console.log(`📦 Sandbox ID: ${result.sandbox.id}`);
      console.log(`🌐 URL: ${result.url}`);
      console.log(`📁 Files uploaded: ${result.filesUploaded}`);
      console.log(`⚡ Template: ${result.sandbox.template}`);
      
      if (options.open) {
        const { default: open } = await import('open');
        await open(result.url);
        console.log('🌍 Opened in browser');
      }
    } catch (error) {
      console.error('❌ Deployment failed:', error instanceof Error ? error.message : String(error));
    }
  });

program
  .command('sandbox')
  .description('Manage sandbox deployments')
  .argument('<action>', 'Action to perform: list, delete, status')
  .argument('[id]', 'Sandbox ID (required for delete and status actions)')
  .option('-d, --directory <dir>', 'Working directory', process.cwd())
  .action(async (action: string, id?: string, options?: { directory: string }) => {
    const config = await loadConfig();
    
    if (!config.sandbox?.enabled || !config.sandbox.apiKey) {
      console.log('🚫 Sandbox deployment not configured. Run "promptcoder config" to set up.');
      return;
    }

    const { SandboxManager } = await import('./sandbox/sandbox-manager');
    const manager = new SandboxManager(
      config.sandbox.provider || 'e2b',
      { apiKey: config.sandbox.apiKey },
      options?.directory || process.cwd()
    );

    try {
      switch (action) {
        case 'list':
          const sandboxes = await manager.listSandboxes();
          if (sandboxes.length === 0) {
            console.log('No active sandboxes found.');
          } else {
            console.log(`Found ${sandboxes.length} sandbox(es):`);
            sandboxes.forEach(s => {
              console.log(`📦 ${s.name} (${s.id.slice(0, 8)}) - ${s.status} - ${s.url}`);
            });
          }
          break;

        case 'delete':
          if (!id) {
            console.log('❌ Sandbox ID required for delete action');
            return;
          }
          await manager.deleteSandbox(id);
          console.log(`🗑️ Deleted sandbox ${id}`);
          break;

        case 'status':
          if (!id) {
            console.log('❌ Sandbox ID required for status action');
            return;
          }
          const sandbox = await manager.getSandbox(id);
          console.log(`📦 ${sandbox.name}`);
          console.log(`🆔 ID: ${sandbox.id}`);
          console.log(`🌐 URL: ${sandbox.url}`);
          console.log(`📋 Status: ${sandbox.status}`);
          console.log(`🏷️ Template: ${sandbox.template}`);
          break;

        default:
          console.log('❌ Unknown action. Use: list, delete, or status');
      }
    } catch (error) {
      console.error('❌ Command failed:', error instanceof Error ? error.message : String(error));
    }
  });

program
  .command('watch')
  .description('Watch for file changes and auto-sync to a sandbox')
  .argument('<sandbox-id>', 'Sandbox ID to sync to')
  .option('-d, --directory <dir>', 'Working directory', process.cwd())
  .option('-w, --watch <patterns...>', 'File patterns to watch', ['**/*'])
  .option('-i, --ignore <patterns...>', 'File patterns to ignore', ['node_modules/**', '.git/**', 'dist/**', 'build/**'])
  .action(async (sandboxId: string, options: { directory: string; watch: string[]; ignore: string[] }) => {
    const config = await loadConfig();
    
    if (!config.sandbox?.enabled || !config.sandbox.apiKey) {
      console.log('🚫 Sandbox deployment not configured. Run "promptcoder config" to set up.');
      return;
    }

    const { FileWatcher } = await import('./utils/file-watcher');
    const { SandboxManager } = await import('./sandbox/sandbox-manager');
    
    const manager = new SandboxManager(
      config.sandbox.provider || 'e2b',
      { apiKey: config.sandbox.apiKey },
      options.directory
    );
    
    const watcher = new FileWatcher(options.directory);

    console.log(`🔄 Starting file watcher for sandbox ${sandboxId}`);
    console.log(`📂 Watching patterns: ${options.watch.join(', ')}`);
    console.log(`🚫 Ignoring patterns: ${options.ignore.join(', ')}`);
    console.log('💡 Press Ctrl+C to stop watching\n');

    try {
      await watcher.startWatching(sandboxId, {
        watchPatterns: options.watch,
        ignorePatterns: options.ignore,
        onFileChange: async (changedFiles) => {
          try {
            await manager.syncFiles(sandboxId, changedFiles);
            console.log(`✅ Synced ${changedFiles.length} file(s) to sandbox`);
          } catch (error) {
            console.error(`❌ Failed to sync files:`, error instanceof Error ? error.message : String(error));
          }
        }
      });

      // Keep the process alive and handle graceful shutdown
      process.on('SIGINT', async () => {
        console.log('\n⏹️ Stopping file watcher...');
        await watcher.stopAllWatching();
        console.log('👋 File watching stopped. Goodbye!');
        process.exit(0);
      });

      // Keep the process alive
      await new Promise(() => {});
    } catch (error) {
      console.error('❌ File watching failed:', error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

program.parse();