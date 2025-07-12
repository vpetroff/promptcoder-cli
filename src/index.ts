#!/usr/bin/env node

import { Command } from 'commander';
import { CodePromptApp } from './app';
import { loadConfig } from './config';

const program = new Command();

program
  .name('codeprompt')
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

program.parse();