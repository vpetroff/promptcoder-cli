import * as fs from 'fs-extra';
import * as path from 'path';
import * as os from 'os';
import inquirer from 'inquirer';
import chalk from 'chalk';
import { config as dotenvConfig } from 'dotenv';
import { AppConfig } from './app';

dotenvConfig();

const CONFIG_DIR = path.join(os.homedir(), '.codeprompt');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');

export interface StoredConfig {
  defaultProvider: 'openai' | 'anthropic';
  openaiApiKey?: string;
  anthropicApiKey?: string;
  defaultModel?: {
    openai?: string;
    anthropic?: string;
  };
}

export async function loadConfig(): Promise<AppConfig> {
  // Try to load from environment variables first
  const envConfig = loadFromEnv();
  if (envConfig) {
    return envConfig;
  }

  // Try to load from config file
  const fileConfig = await loadFromFile();
  if (fileConfig) {
    return fileConfig;
  }

  // If no config found, prompt user to set it up
  console.log(chalk.yellow('⚠️  No configuration found. Please set up your API keys.'));
  return await setupConfig();
}

function loadFromEnv(): AppConfig | null {
  const openaiKey = process.env.OPENAI_API_KEY;
  const anthropicKey = process.env.ANTHROPIC_API_KEY;

  if (openaiKey) {
    return {
      provider: 'openai',
      apiKey: openaiKey,
      model: process.env.OPENAI_MODEL || 'gpt-4'
    };
  }

  if (anthropicKey) {
    return {
      provider: 'anthropic',
      apiKey: anthropicKey,
      model: process.env.ANTHROPIC_MODEL || 'claude-3-5-sonnet-20241022'
    };
  }

  return null;
}

async function loadFromFile(): Promise<AppConfig | null> {
  try {
    if (!(await fs.pathExists(CONFIG_FILE))) {
      return null;
    }

    const storedConfig: StoredConfig = await fs.readJson(CONFIG_FILE);
    const provider = storedConfig.defaultProvider;
    
    let apiKey: string;
    let model: string;

    if (provider === 'openai') {
      apiKey = storedConfig.openaiApiKey!;
      model = storedConfig.defaultModel?.openai || 'gpt-4';
    } else {
      apiKey = storedConfig.anthropicApiKey!;
      model = storedConfig.defaultModel?.anthropic || 'claude-3-sonnet-20240229';
    }

    if (!apiKey) {
      console.log(chalk.yellow(`⚠️  No API key found for ${provider} in config file.`));
      return null;
    }

    return { provider, apiKey, model };
  } catch (error) {
    console.log(chalk.red('❌ Error loading config file:'), error);
    return null;
  }
}

export async function setupConfig(): Promise<AppConfig> {
  console.log(chalk.blue.bold('\n🔧 CodePrompt Configuration Setup\n'));

  const { provider } = await inquirer.prompt([
    {
      type: 'list',
      name: 'provider',
      message: 'Choose your preferred LLM provider:',
      choices: [
        { name: 'OpenAI (GPT-4, GPT-3.5)', value: 'openai' },
        { name: 'Anthropic (Claude)', value: 'anthropic' }
      ]
    }
  ]);

  const { apiKey } = await inquirer.prompt([
    {
      type: 'password',
      name: 'apiKey',
      message: `Enter your ${provider === 'openai' ? 'OpenAI' : 'Anthropic'} API key:`,
      validate: (input: string) => input.trim().length > 0 || 'API key is required'
    }
  ]);

  const defaultModels: Record<'openai' | 'anthropic', string[]> = {
    openai: ['gpt-4o'],
    anthropic: ['claude-3-5-sonnet-20241022']
  };

  const { model } = await inquirer.prompt([
    {
      type: 'list',
      name: 'model',
      message: 'Choose the model to use:',
      choices: defaultModels[provider as 'openai' | 'anthropic']
    }
  ]);

  const { saveToFile } = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'saveToFile',
      message: 'Save this configuration to file for future use?',
      default: true
    }
  ]);

  if (saveToFile) {
    await saveConfig(provider, apiKey, model);
  }

  console.log(chalk.green('✅ Configuration completed!\n'));

  return { provider, apiKey, model };
}

async function saveConfig(provider: 'openai' | 'anthropic', apiKey: string, model: string): Promise<void> {
  try {
    await fs.ensureDir(CONFIG_DIR);
    
    let storedConfig: StoredConfig = { defaultProvider: provider };
    
    // Load existing config if it exists
    if (await fs.pathExists(CONFIG_FILE)) {
      storedConfig = await fs.readJson(CONFIG_FILE);
    }

    // Update config
    storedConfig.defaultProvider = provider;
    if (provider === 'openai') {
      storedConfig.openaiApiKey = apiKey;
      storedConfig.defaultModel = { ...storedConfig.defaultModel, openai: model };
    } else {
      storedConfig.anthropicApiKey = apiKey;
      storedConfig.defaultModel = { ...storedConfig.defaultModel, anthropic: model };
    }

    await fs.writeJson(CONFIG_FILE, storedConfig, { spaces: 2 });
    console.log(chalk.gray(`Configuration saved to ${CONFIG_FILE}`));
  } catch (error) {
    console.log(chalk.red('❌ Error saving config:'), error);
  }
}