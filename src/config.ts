import * as fs from 'fs-extra';
import * as path from 'path';
import * as os from 'os';
import inquirer from 'inquirer';
import chalk from 'chalk';
import { config as dotenvConfig } from 'dotenv';
import { AppConfig } from './app';

dotenvConfig();

const CONFIG_DIR = path.join(os.homedir(), '.promptcoder');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');

export interface StoredConfig {
  defaultProvider: 'openai' | 'anthropic';
  openaiApiKey?: string;
  anthropicApiKey?: string;
  defaultModel?: {
    openai?: string;
    anthropic?: string;
  };
  sandbox?: {
    provider?: string;
    apiKey?: string;
    apiUrl?: string;
    target?: string;
    enabled?: boolean;
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
  const e2bKey = process.env.E2B_API_KEY;
  const daytonaKey = process.env.DAYTONA_API_KEY;

  let config: AppConfig | null = null;

  if (openaiKey) {
    config = {
      provider: 'openai',
      apiKey: openaiKey,
      model: process.env.OPENAI_MODEL || 'gpt-4'
    };
  } else if (anthropicKey) {
    config = {
      provider: 'anthropic',
      apiKey: anthropicKey,
      model: process.env.ANTHROPIC_MODEL || 'claude-3-5-sonnet-20241022'
    };
  }

  // Add sandbox config - prefer E2B, then Daytona
  if (config && e2bKey) {
    config.sandbox = {
      provider: 'e2b',
      apiKey: e2bKey,
      enabled: true
    };
  } else if (config && daytonaKey) {
    config.sandbox = {
      provider: 'daytona',
      apiKey: daytonaKey,
      apiUrl: process.env.DAYTONA_API_URL,
      target: process.env.DAYTONA_TARGET,
      enabled: true
    };
  }

  return config;
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

    return { 
      provider, 
      apiKey, 
      model,
      sandbox: storedConfig.sandbox 
    };
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

  // Ask about sandbox configuration
  const { setupSandbox } = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'setupSandbox',
      message: 'Would you like to configure sandbox deployment?',
      default: true
    }
  ]);

  let sandboxConfig: AppConfig['sandbox'] | undefined;

  if (setupSandbox) {
    const { sandboxProvider } = await inquirer.prompt([
      {
        type: 'list',
        name: 'sandboxProvider',
        message: 'Choose your sandbox provider:',
        choices: [
          { name: 'E2B (Template-based sandboxes)', value: 'e2b' },
          { name: 'Daytona (Docker workspaces)', value: 'daytona' },
          { name: 'Skip for now', value: 'none' }
        ]
      }
    ]);

    if (sandboxProvider !== 'none') {
      const { sandboxApiKey } = await inquirer.prompt([
        {
          type: 'password',
          name: 'sandboxApiKey',
          message: `Enter your ${sandboxProvider === 'e2b' ? 'E2B' : 'Daytona'} API key:`,
          validate: (input: string) => input.trim().length > 0 || 'API key is required'
        }
      ]);

      sandboxConfig = {
        provider: sandboxProvider,
        apiKey: sandboxApiKey,
        enabled: true
      };

      // For Daytona, ask for additional configuration
      if (sandboxProvider === 'daytona') {
        const { daytonaUrl, daytonaTarget } = await inquirer.prompt([
          {
            type: 'input',
            name: 'daytonaUrl',
            message: 'Daytona API URL (leave empty for default):',
            default: ''
          },
          {
            type: 'input',
            name: 'daytonaTarget',
            message: 'Daytona target region (leave empty for default):',
            default: ''
          }
        ]);

        if (daytonaUrl) sandboxConfig.apiUrl = daytonaUrl;
        if (daytonaTarget) sandboxConfig.target = daytonaTarget;
      }

      console.log(chalk.green(`✅ ${sandboxProvider === 'e2b' ? 'E2B' : 'Daytona'} sandbox configured!`));
    }
  }

  const { saveToFile } = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'saveToFile',
      message: 'Save this configuration to file for future use?',
      default: true
    }
  ]);

  if (saveToFile) {
    await saveConfigWithSandbox(provider, apiKey, model, sandboxConfig);
  }

  console.log(chalk.green('✅ Configuration completed!\n'));

  return { provider, apiKey, model, sandbox: sandboxConfig };
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

async function saveConfigWithSandbox(provider: 'openai' | 'anthropic', apiKey: string, model: string, sandboxConfig?: AppConfig['sandbox']): Promise<void> {
  try {
    await fs.ensureDir(CONFIG_DIR);
    
    let storedConfig: StoredConfig = { defaultProvider: provider };
    
    // Load existing config if it exists
    if (await fs.pathExists(CONFIG_FILE)) {
      storedConfig = await fs.readJson(CONFIG_FILE);
    }

    // Update LLM config
    storedConfig.defaultProvider = provider;
    if (provider === 'openai') {
      storedConfig.openaiApiKey = apiKey;
      storedConfig.defaultModel = { ...storedConfig.defaultModel, openai: model };
    } else {
      storedConfig.anthropicApiKey = apiKey;
      storedConfig.defaultModel = { ...storedConfig.defaultModel, anthropic: model };
    }

    // Update sandbox config if provided
    if (sandboxConfig) {
      storedConfig.sandbox = {
        provider: sandboxConfig.provider,
        apiKey: sandboxConfig.apiKey,
        apiUrl: sandboxConfig.apiUrl,
        target: sandboxConfig.target,
        enabled: sandboxConfig.enabled
      };
    }

    await fs.writeJson(CONFIG_FILE, storedConfig, { spaces: 2 });
    console.log(chalk.gray(`Configuration saved to ${CONFIG_FILE}`));
  } catch (error) {
    console.log(chalk.red('❌ Error saving config:'), error);
  }
}

export async function saveAppConfig(appConfig: AppConfig): Promise<void> {
  try {
    await fs.ensureDir(CONFIG_DIR);
    
    let storedConfig: StoredConfig = { defaultProvider: appConfig.provider };
    
    // Load existing config if it exists
    if (await fs.pathExists(CONFIG_FILE)) {
      storedConfig = await fs.readJson(CONFIG_FILE);
    }

    // Update stored config with app config values
    storedConfig.defaultProvider = appConfig.provider;
    
    if (appConfig.provider === 'openai') {
      storedConfig.openaiApiKey = appConfig.apiKey;
      storedConfig.defaultModel = { ...storedConfig.defaultModel, openai: appConfig.model };
    } else {
      storedConfig.anthropicApiKey = appConfig.apiKey;
      storedConfig.defaultModel = { ...storedConfig.defaultModel, anthropic: appConfig.model };
    }
    
    // Update sandbox config if provided
    if (appConfig.sandbox) {
      storedConfig.sandbox = {
        provider: appConfig.sandbox.provider,
        apiKey: appConfig.sandbox.apiKey,
        apiUrl: appConfig.sandbox.apiUrl,
        target: appConfig.sandbox.target,
        enabled: appConfig.sandbox.enabled
      };
    }

    await fs.writeJson(CONFIG_FILE, storedConfig, { spaces: 2 });
  } catch (error) {
    throw new Error(`Failed to save configuration: ${error instanceof Error ? error.message : String(error)}`);
  }
}