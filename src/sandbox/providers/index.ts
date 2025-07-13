import { E2BProvider } from './e2b-provider';
import { DaytonaProvider } from './daytona-provider';
import { SandboxProvider } from '../types';

export function createSandboxProvider(providerName: string, config: any): SandboxProvider {
  switch (providerName.toLowerCase()) {
    case 'e2b':
      if (!config.apiKey) {
        throw new Error('E2B API key is required');
      }
      return new E2BProvider(config.apiKey);
    
    case 'daytona':
      if (!config.apiKey) {
        throw new Error('Daytona API key is required');
      }
      return new DaytonaProvider({
        apiKey: config.apiKey,
        apiUrl: config.apiUrl,
        target: config.target
      });
    
    default:
      throw new Error(`Unsupported sandbox provider: ${providerName}. Supported: e2b, daytona`);
  }
}

export { E2BProvider, DaytonaProvider };
export * from '../types';