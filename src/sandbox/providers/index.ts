import { E2BProvider } from './e2b-provider';
import { SandboxProvider } from '../types';

export function createSandboxProvider(providerName: string, config: any): SandboxProvider {
  switch (providerName.toLowerCase()) {
    case 'e2b':
      if (!config.apiKey) {
        throw new Error('E2B API key is required');
      }
      return new E2BProvider(config.apiKey);
    
    default:
      throw new Error(`Unsupported sandbox provider: ${providerName}`);
  }
}

export { E2BProvider };
export * from '../types';