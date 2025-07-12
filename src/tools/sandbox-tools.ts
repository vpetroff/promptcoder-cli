import { SandboxManager } from '../sandbox/sandbox-manager';
import { Tool } from '../llm/types';
import { FileWatcher } from '../utils/file-watcher';

export class SandboxTools {
  private sandboxManager: SandboxManager | null = null;
  private workingDirectory: string;
  private fileWatcher: FileWatcher | null = null;

  constructor(workingDirectory: string = process.cwd()) {
    this.workingDirectory = workingDirectory;
  }

  setSandboxConfig(providerName: string, providerConfig: any): void {
    this.sandboxManager = new SandboxManager(providerName, providerConfig, this.workingDirectory);
  }

  getTools(): Tool[] {
    return [
      {
        name: 'deploy_to_sandbox',
        description: 'Deploy the current project to a sandbox environment for testing and sharing',
        parameters: {
          type: 'object',
          properties: {
            template: {
              type: 'string',
              description: 'Template to use (auto-detected if not specified)',
              enum: ['react-ts', 'react', 'nextjs', 'express', 'node-ts', 'python3', 'flask', 'fastapi', 'auto']
            },
            name: {
              type: 'string',
              description: 'Name for the sandbox deployment'
            },
            description: {
              type: 'string',
              description: 'Description of what this deployment contains'
            },
            open_browser: {
              type: 'boolean',
              description: 'Whether to open the deployed sandbox in browser',
              default: true
            }
          },
          required: []
        }
      },
      {
        name: 'sync_to_sandbox',
        description: 'Sync current project files to an existing sandbox',
        parameters: {
          type: 'object',
          properties: {
            sandbox_id: {
              type: 'string',
              description: 'ID of the sandbox to sync to'
            }
          },
          required: ['sandbox_id']
        }
      },
      {
        name: 'list_sandboxes',
        description: 'List all active sandbox deployments',
        parameters: {
          type: 'object',
          properties: {},
          required: []
        }
      },
      {
        name: 'get_sandbox_status',
        description: 'Get the status and details of a specific sandbox',
        parameters: {
          type: 'object',
          properties: {
            sandbox_id: {
              type: 'string',
              description: 'ID of the sandbox to check'
            }
          },
          required: ['sandbox_id']
        }
      },
      {
        name: 'delete_sandbox',
        description: 'Delete a sandbox deployment',
        parameters: {
          type: 'object',
          properties: {
            sandbox_id: {
              type: 'string',
              description: 'ID of the sandbox to delete'
            }
          },
          required: ['sandbox_id']
        }
      },
      {
        name: 'start_code_sync',
        description: 'Start watching for file changes and automatically sync to a sandbox',
        parameters: {
          type: 'object',
          properties: {
            sandbox_id: {
              type: 'string',
              description: 'ID of the sandbox to sync to'
            },
            watch_patterns: {
              type: 'array',
              items: { type: 'string' },
              description: 'File patterns to watch (default: all files)',
              default: ['**/*']
            },
            ignore_patterns: {
              type: 'array',
              items: { type: 'string' },
              description: 'File patterns to ignore',
              default: ['node_modules/**', '.git/**', 'dist/**', 'build/**']
            }
          },
          required: ['sandbox_id']
        }
      },
      {
        name: 'stop_code_sync',
        description: 'Stop file watching and syncing to sandbox',
        parameters: {
          type: 'object',
          properties: {
            sandbox_id: {
              type: 'string',
              description: 'ID of the sandbox to stop syncing (optional, stops all if not provided)'
            }
          },
          required: []
        }
      },
      {
        name: 'get_sync_status',
        description: 'Get the current file watching and sync status',
        parameters: {
          type: 'object',
          properties: {},
          required: []
        }
      },
      {
        name: 'get_sandbox_templates',
        description: 'Get available sandbox templates for different project types',
        parameters: {
          type: 'object',
          properties: {},
          required: []
        }
      }
    ];
  }

  async executeTool(name: string, parameters: Record<string, any>): Promise<string> {
    if (!this.sandboxManager) {
      return 'Error: Sandbox provider not configured. Please run "promptcoder config" to set up sandbox deployment.';
    }

    try {
      switch (name) {
        case 'deploy_to_sandbox':
          return await this.deployToSandbox(parameters);
        case 'sync_to_sandbox':
          return await this.syncToSandbox(parameters.sandbox_id);
        case 'list_sandboxes':
          return await this.listSandboxes();
        case 'get_sandbox_status':
          return await this.getSandboxStatus(parameters.sandbox_id);
        case 'delete_sandbox':
          return await this.deleteSandbox(parameters.sandbox_id);
        case 'start_code_sync':
          return await this.startCodeSync(parameters.sandbox_id, parameters.watch_patterns, parameters.ignore_patterns);
        case 'stop_code_sync':
          return await this.stopCodeSync(parameters.sandbox_id);
        case 'get_sync_status':
          return await this.getSyncStatus();
        case 'get_sandbox_templates':
          return await this.getSandboxTemplates();
        default:
          throw new Error(`Unknown tool: ${name}`);
      }
    } catch (error) {
      return `Error executing ${name}: ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  private async deployToSandbox(parameters: Record<string, any>): Promise<string> {
    const config = {
      template: parameters.template === 'auto' ? undefined : parameters.template,
      name: parameters.name,
      description: parameters.description
    };

    const result = await this.sandboxManager!.deployProject(config);

    let response = `🚀 Successfully deployed to sandbox!
📦 Sandbox ID: ${result.sandbox.id}
🌐 URL: ${result.url}
📁 Files uploaded: ${result.filesUploaded}
⚡ Template: ${result.sandbox.template}
⏱️ Deployment time: ${result.deploymentTime}ms`;

    if (parameters.open_browser !== false) {
      response += `\n🌍 Opening in browser...`;
    }

    return response;
  }

  private async syncToSandbox(sandboxId: string): Promise<string> {
    await this.sandboxManager!.syncProject(sandboxId);
    return `🔄 Successfully synced project files to sandbox ${sandboxId}`;
  }

  private async listSandboxes(): Promise<string> {
    const sandboxes = await this.sandboxManager!.listSandboxes();

    if (sandboxes.length === 0) {
      return 'No active sandboxes found. Use deploy_to_sandbox to create one.';
    }

    const sandboxList = sandboxes.map(sandbox => {
      const age = Math.round((Date.now() - sandbox.createdAt.getTime()) / (1000 * 60));
      return `📦 ${sandbox.name} (${sandbox.id.slice(0, 8)})
   🌐 URL: ${sandbox.url}
   📋 Status: ${sandbox.status}
   🏷️ Template: ${sandbox.template}
   ⏰ Created: ${age}m ago`;
    }).join('\n\n');

    return `Active Sandboxes (${sandboxes.length}):\n\n${sandboxList}`;
  }

  private async getSandboxStatus(sandboxId: string): Promise<string> {
    const sandbox = await this.sandboxManager!.getSandbox(sandboxId);

    const age = Math.round((Date.now() - sandbox.createdAt.getTime()) / (1000 * 60));
    const lastUpdate = Math.round((Date.now() - sandbox.updatedAt.getTime()) / (1000 * 60));

    return `Sandbox Details:
📦 Name: ${sandbox.name}
🆔 ID: ${sandbox.id}
🌐 URL: ${sandbox.url}
📋 Status: ${sandbox.status}
🏷️ Template: ${sandbox.template}
🔧 Provider: ${sandbox.provider}
⏰ Created: ${age}m ago
🔄 Last updated: ${lastUpdate}m ago`;
  }

  private async deleteSandbox(sandboxId: string): Promise<string> {
    await this.sandboxManager!.deleteSandbox(sandboxId);
    return `🗑️ Successfully deleted sandbox ${sandboxId}`;
  }

  private async startCodeSync(sandboxId: string, watchPatterns?: string[], ignorePatterns?: string[]): Promise<string> {
    if (!this.fileWatcher) {
      this.fileWatcher = new FileWatcher(this.workingDirectory);
    }

    const defaultWatchPatterns = watchPatterns || ['**/*'];
    const defaultIgnorePatterns = ignorePatterns || ['node_modules/**', '.git/**', 'dist/**', 'build/**', '.env', '.env.*'];

    await this.fileWatcher.startWatching(sandboxId, {
      watchPatterns: defaultWatchPatterns,
      ignorePatterns: defaultIgnorePatterns,
      onFileChange: async (changedFiles) => {
        if (this.sandboxManager) {
          await this.sandboxManager.syncFiles(sandboxId, changedFiles);
        }
      }
    });

    return `🔄 Started file watching and auto-sync for sandbox ${sandboxId}
📂 Watching patterns: ${defaultWatchPatterns.join(', ')}
🚫 Ignoring patterns: ${defaultIgnorePatterns.join(', ')}
💡 Files will be automatically synced to the sandbox when they change.`;
  }

  private async stopCodeSync(sandboxId?: string): Promise<string> {
    if (!this.fileWatcher) {
      return 'No file watching is currently active.';
    }

    if (sandboxId) {
      await this.fileWatcher.stopWatching(sandboxId);
      return `⏹️ Stopped file watching for sandbox ${sandboxId}`;
    } else {
      await this.fileWatcher.stopAllWatching();
      return '⏹️ Stopped all file watching and syncing';
    }
  }

  private async getSyncStatus(): Promise<string> {
    if (!this.fileWatcher) {
      return 'No file watching is currently active.';
    }

    const status = this.fileWatcher.getStatus();
    
    if (status.activeSandboxes.length === 0) {
      return 'File watcher is initialized but no sandboxes are being watched.';
    }

    const statusInfo = status.activeSandboxes.map(info => {
      const lastSync = info.lastSync ? 
        `${Math.round((Date.now() - info.lastSync.getTime()) / 1000)}s ago` : 
        'Never';
      
      return `📦 Sandbox: ${info.sandboxId}
🔄 Last sync: ${lastSync}
📊 Files synced: ${info.filesSynced}
📂 Watch patterns: ${info.watchPatterns.join(', ')}
🚫 Ignore patterns: ${info.ignorePatterns.join(', ')}`;
    }).join('\n\n');

    return `File Sync Status:
🟢 Active watchers: ${status.activeSandboxes.length}
📂 Working directory: ${this.workingDirectory}

${statusInfo}`;
  }

  private async getSandboxTemplates(): Promise<string> {
    const templates = await this.sandboxManager!.getAvailableTemplates();
    
    const templateList = templates.map(template => {
      const templateInfo = this.sandboxManager!.getTemplate(template);
      if (templateInfo) {
        return `🏷️ ${template}: ${templateInfo.description}`;
      }
      return `🏷️ ${template}`;
    }).join('\n');

    return `Available Templates:\n\n${templateList}\n\nUse template: 'auto' for automatic detection based on your project files.`;
  }
}