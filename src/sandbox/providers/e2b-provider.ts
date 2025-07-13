import { Sandbox as E2BSandbox } from '@e2b/code-interpreter';
import { SandboxProvider, Sandbox, SandboxConfig, FileMap } from '../types';

export class E2BProvider implements SandboxProvider {
  name = 'e2b';
  private apiKey: string;
  private activeSandboxes: Map<string, E2BSandbox> = new Map();

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  async createSandbox(config: SandboxConfig): Promise<Sandbox> {
    const sandbox = await E2BSandbox.create(config.template || 'base', {
      apiKey: this.apiKey
    });

    this.activeSandboxes.set(sandbox.sandboxId, sandbox);

    return {
      id: sandbox.sandboxId,
      name: config.name || `Sandbox ${sandbox.sandboxId.slice(0, 8)}`,
      url: `https://${sandbox.sandboxId}.e2b.dev`,
      status: 'running',
      provider: this.name,
      template: config.template || 'base',
      createdAt: new Date(),
      updatedAt: new Date(),
      metadata: { 
        sandbox,
        startCommand: config.startCommand,
        port: config.port,
        environment: config.environment
      }
    };
  }

  async deploySandbox(sandbox: Sandbox, files: FileMap): Promise<string> {
    const e2bSandbox = this.activeSandboxes.get(sandbox.id);
    if (!e2bSandbox) {
      throw new Error(`Sandbox ${sandbox.id} not found`);
    }

    // Upload files to the sandbox (skip null values as they indicate deletions)
    const uploadPromises = Object.entries(files)
      .filter(([, content]) => content !== null)
      .map(([path, content]) => {
        const contentStr = content instanceof Buffer ? content.toString('utf8') : content as string;
        return e2bSandbox.files.write(path, contentStr);
      });

    await Promise.all(uploadPromises);

    // Start the application based on template
    if (sandbox.template && sandbox.metadata?.startCommand) {
      console.log(`🚀 Starting application with: ${sandbox.metadata.startCommand}`);
      
      try {
        // Execute the start command in background
        const result = await e2bSandbox.runCode(sandbox.metadata.startCommand);
        
        console.log(`✅ Application started`);
        
        // Wait a moment for the server to start
        await new Promise(resolve => setTimeout(resolve, 3000));
        
        // Update the URL with the correct port if specified
        if (sandbox.metadata?.port) {
          return `https://${sandbox.id}-${sandbox.metadata.port}.e2b.dev`;
        }
      } catch (error) {
        console.warn(`⚠️ Warning: Failed to start application: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    return sandbox.url;
  }

  async getSandbox(id: string): Promise<Sandbox> {
    let e2bSandbox = this.activeSandboxes.get(id);
    
    if (!e2bSandbox) {
      // Try to connect to existing sandbox
      try {
        e2bSandbox = await E2BSandbox.connect(id, { apiKey: this.apiKey });
        this.activeSandboxes.set(id, e2bSandbox);
      } catch (error) {
        throw new Error(`Sandbox ${id} not found or cannot be connected`);
      }
    }
    
    return {
      id: e2bSandbox.sandboxId,
      name: `Sandbox ${id.slice(0, 8)}`,
      url: `https://${id}.e2b.dev`,
      status: 'running',
      provider: this.name,
      template: 'base',
      createdAt: new Date(),
      updatedAt: new Date(),
      metadata: { sandbox: e2bSandbox }
    };
  }

  async deleteSandbox(id: string): Promise<void> {
    const e2bSandbox = this.activeSandboxes.get(id);
    if (e2bSandbox) {
      await e2bSandbox.kill();
      this.activeSandboxes.delete(id);
    } else {
      // Try to connect and kill
      try {
        const sandbox = await E2BSandbox.connect(id, { apiKey: this.apiKey });
        await sandbox.kill();
      } catch (error) {
        // Sandbox might already be deleted
      }
    }
  }

  async syncFiles(id: string, files: FileMap): Promise<void> {
    let e2bSandbox = this.activeSandboxes.get(id);
    
    if (!e2bSandbox) {
      e2bSandbox = await E2BSandbox.connect(id, { apiKey: this.apiKey });
      this.activeSandboxes.set(id, e2bSandbox);
    }

    const promises = Object.entries(files).map(async ([path, content]) => {
      if (content === null) {
        // Handle file deletion
        try {
          await e2bSandbox!.files.remove(path);
        } catch (error) {
          // File might not exist
        }
      } else {
        // Handle file upload/update
        const contentStr = content instanceof Buffer ? content.toString('utf8') : content as string;
        await e2bSandbox!.files.write(path, contentStr);
      }
    });

    await Promise.all(promises);
  }

  async listSandboxes(): Promise<Sandbox[]> {
    // E2B SDK doesn't have a direct list method, so we'll return active sandboxes
    const sandboxes: Sandbox[] = [];
    
    for (const [id, e2bSandbox] of this.activeSandboxes.entries()) {
      sandboxes.push({
        id: e2bSandbox.sandboxId,
        name: `Sandbox ${id.slice(0, 8)}`,
        url: `https://${id}.e2b.dev`,
        status: 'running',
        provider: this.name,
        template: 'base',
        createdAt: new Date(),
        updatedAt: new Date(),
        metadata: { sandbox: e2bSandbox }
      });
    }
    
    return sandboxes;
  }

  async getTemplates(): Promise<string[]> {
    // E2B SDK templates (using 'base' for most since it's more flexible)
    return [
      'base'
    ];
  }

}