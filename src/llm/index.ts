import { LLMClient, LLMConfig } from './types';
import { OpenAIClient } from './openai-client';
import { AnthropicClient } from './anthropic-client';

export function createLLMClient(config: LLMConfig): LLMClient {
  switch (config.provider) {
    case 'openai':
      return new OpenAIClient(config.apiKey, config.model);
    case 'anthropic':
      return new AnthropicClient(config.apiKey, config.model);
    default:
      throw new Error(`Unsupported LLM provider: ${config.provider}`);
  }
}

export * from './types';