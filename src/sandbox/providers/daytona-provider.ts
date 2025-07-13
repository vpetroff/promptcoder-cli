import { SandboxProvider, Sandbox, SandboxConfig, FileMap, DockerSandboxConfig, DeploymentResult } from '../types';
import { Daytona } from '@daytonaio/sdk';

export class DaytonaProvider implements SandboxProvider {
  name = 'daytona';
  private client: Daytona;
  private activeSandboxes: Map<string, any> = new Map();

  constructor(config: { apiKey: string; apiUrl?: string; target?: string }) {
    // Initialize Daytona SDK client with configuration
    this.client = new Daytona({
      apiKey: config.apiKey,
      apiUrl: config.apiUrl,
      target: config.target
    });
  }

  async createSandbox(config: SandboxConfig): Promise<Sandbox> {
    try {
      // Create sandbox using Daytona SDK
      const daytonaSandbox = await this.client.create({
        language: this.detectLanguageFromTemplate(config.template)
      });

      this.activeSandboxes.set(daytonaSandbox.id, daytonaSandbox);

      return {
        id: daytonaSandbox.id,
        name: config.name || `Daytona Workspace ${daytonaSandbox.id.slice(0, 8)}`,
        url: `https://app.daytona.io/workspace/${daytonaSandbox.id}`,
        status: 'running',
        provider: this.name,
        template: config.template || 'base',
        createdAt: new Date(),
        updatedAt: new Date(),
        metadata: {
          daytonaSandbox,
          language: this.detectLanguageFromTemplate(config.template),
          startCommand: config.startCommand,
          port: config.port,
          environment: config.environment
        }
      };
    } catch (error) {
      throw new Error(`Failed to create Daytona sandbox: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async deploySandbox(sandbox: Sandbox, files: FileMap): Promise<string> {
    const daytonaSandbox = this.activeSandboxes.get(sandbox.id);
    if (!daytonaSandbox) {
      throw new Error(`Daytona sandbox ${sandbox.id} not found`);
    }

    try {
      // Upload files to the sandbox
      const uploadPromises = Object.entries(files)
        .filter(([, content]) => content !== null)
        .map(async ([path, content]) => {
          const contentStr = content instanceof Buffer ? content.toString('utf8') : content as string;
          await daytonaSandbox.fs.uploadFile(Buffer.from(contentStr), path);
        });

      await Promise.all(uploadPromises);

      // Start the application if configured
      if (sandbox.metadata?.startCommand) {
        console.log(`🚀 Starting application with: ${sandbox.metadata.startCommand}`);
        
        const result = await daytonaSandbox.process.executeCommand(sandbox.metadata.startCommand);
        console.log(`✅ Application started: ${result.result}`);
        
        // Wait for the server to start
        await new Promise(resolve => setTimeout(resolve, 3000));
        
        // Update URL with port if specified
        if (sandbox.metadata?.port) {
          return `${sandbox.url}:${sandbox.metadata.port}`;
        }
      }

      return sandbox.url;
    } catch (error) {
      throw new Error(`Failed to deploy to Daytona sandbox: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Deploy using Docker - Daytona's main strength
   * Creates a snapshot from Dockerfile, then deploys a sandbox from that snapshot
   */
  async deployWithDockerfile(dockerfile: string, files: FileMap, config: DockerSandboxConfig): Promise<DeploymentResult> {
    const startTime = Date.now();

    try {
      console.log('🏗️ Creating Daytona snapshot from Dockerfile...');
      
      // Step 1: Write Dockerfile and project files to temporary directory
      const tempDir = `/tmp/daytona-build-${Date.now()}`;
      const { writeFileSync, mkdirSync } = await import('fs');
      const { join } = await import('path');
      
      mkdirSync(tempDir, { recursive: true });
      
      // Write Dockerfile
      writeFileSync(join(tempDir, 'Dockerfile'), dockerfile);
      
      // Write project files
      for (const [path, content] of Object.entries(files)) {
        if (content !== null) {
          const contentStr = content instanceof Buffer ? content.toString('utf8') : content as string;
          const fullPath = join(tempDir, path);
          const { dirname } = await import('path');
          mkdirSync(dirname(fullPath), { recursive: true });
          writeFileSync(fullPath, contentStr);
        }
      }

      // Step 2: Create Image from Dockerfile with proper context
      const { Image } = await import('@daytonaio/sdk');
      // Create image from dockerfile - this should automatically include the entire temp directory as context
      const image = Image.fromDockerfile(join(tempDir, 'Dockerfile'));

      // Step 3: Create Snapshot from Image
      const snapshotName = config.imageName || this.generateImageName(config.name);
      
      console.log(`📸 Creating snapshot "${snapshotName}"...`);
      const snapshot = await this.client.snapshot.create({
        name: snapshotName,
        image: image,
        resources: {
          cpu: 1,
          memory: 2,
          disk: 10
        }
      }, {
        onLogs: (logs) => console.log(`Build: ${logs.trim()}`),
        timeout: 300 // 5 minutes timeout
      });

      console.log(`✅ Snapshot "${snapshotName}" created successfully!`);

      // Step 4: Create Sandbox from Snapshot
      console.log('🚀 Deploying sandbox from snapshot...');
      const daytonaSandbox = await this.client.create({
        snapshot: snapshotName,
        language: 'typescript', // Default language for Docker deployments
        envVars: config.environment || {},
        autoStopInterval: 60, // Auto-stop after 1 hour
        public: false
      });

      this.activeSandboxes.set(daytonaSandbox.id, daytonaSandbox);

      // Clean up temp directory
      try {
        const { rmSync } = await import('fs');
        rmSync(tempDir, { recursive: true, force: true });
      } catch (error) {
        console.warn(`Warning: Failed to clean up temp directory ${tempDir}`);
      }

      // Step 5: Get preview URL for the application
      const port = config.port || 3000;
      let url = `https://app.daytona.io/workspace/${daytonaSandbox.id}`;
      
      try {
        const previewLink = await daytonaSandbox.getPreviewLink(port);
        url = previewLink.url;
      } catch (error) {
        console.warn(`Warning: Could not get preview link for port ${port}, using workspace URL`);
      }

      const deploymentTime = Date.now() - startTime;

      return {
        sandbox: {
          id: daytonaSandbox.id,
          name: config.name || `Docker App ${daytonaSandbox.id.slice(0, 8)}`,
          url,
          status: 'running',
          provider: this.name,
          template: 'docker',
          createdAt: new Date(),
          updatedAt: new Date(),
          metadata: {
            daytonaSandbox,
            dockerfile,
            snapshotName,
            port
          }
        },
        url,
        filesUploaded: Object.keys(files).length,
        deploymentTime
      };

    } catch (error) {
      const deploymentTime = Date.now() - startTime;
      throw new Error(`Daytona Docker deployment failed after ${deploymentTime}ms: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async getSandbox(id: string): Promise<Sandbox> {
    try {
      let daytonaSandbox = this.activeSandboxes.get(id);
      
      if (!daytonaSandbox) {
        // In the real SDK, we might need to fetch sandbox info differently
        // For now, create a basic sandbox object if we don't have it cached
        daytonaSandbox = { id };
        this.activeSandboxes.set(id, daytonaSandbox);
      }
      
      return {
        id: id,
        name: `Daytona Workspace ${id.slice(0, 8)}`,
        url: `https://app.daytona.io/workspace/${id}`,
        status: 'running',
        provider: this.name,
        template: 'unknown',
        createdAt: new Date(),
        updatedAt: new Date(),
        metadata: { daytonaSandbox }
      };
    } catch (error) {
      throw new Error(`Daytona sandbox ${id} not found: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async deleteSandbox(id: string): Promise<void> {
    try {
      const daytonaSandbox = this.activeSandboxes.get(id);
      if (daytonaSandbox && daytonaSandbox.stop) {
        await daytonaSandbox.stop();
      }
      this.activeSandboxes.delete(id);
      
      // Note: The Daytona SDK might handle deletion through the workspace API
      // For now, we'll rely on the sandbox's stop method
      console.log(`🗑️ Daytona sandbox ${id} deleted`);
    } catch (error) {
      throw new Error(`Failed to delete Daytona sandbox: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async syncFiles(id: string, files: FileMap): Promise<void> {
    try {
      let daytonaSandbox = this.activeSandboxes.get(id);
      
      if (!daytonaSandbox) {
        throw new Error(`Daytona sandbox ${id} not found in active sandboxes`);
      }

      const promises = Object.entries(files).map(async ([path, content]) => {
        if (content === null) {
          try {
            if (daytonaSandbox.fs && daytonaSandbox.fs.deleteFile) {
              await daytonaSandbox.fs.deleteFile(path);
            }
          } catch (error) {
            // File might not exist - ignore error
          }
        } else {
          const contentStr = content instanceof Buffer ? content.toString('utf8') : content as string;
          if (daytonaSandbox.fs && daytonaSandbox.fs.uploadFile) {
            await daytonaSandbox.fs.uploadFile(Buffer.from(contentStr), path);
          }
        }
      });

      await Promise.all(promises);
    } catch (error) {
      throw new Error(`Failed to sync files to Daytona sandbox: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async listSandboxes(): Promise<Sandbox[]> {
    try {
      // For now, return active sandboxes from memory
      // The Daytona SDK might provide a different way to list workspaces
      const sandboxes: Sandbox[] = [];
      
      for (const [id, daytonaSandbox] of this.activeSandboxes.entries()) {
        sandboxes.push({
          id: daytonaSandbox.id || id,
          name: `Daytona Workspace ${id.slice(0, 8)}`,
          url: `https://app.daytona.io/workspace/${id}`,
          status: 'running',
          provider: this.name,
          template: 'unknown',
          createdAt: new Date(),
          updatedAt: new Date(),
          metadata: { daytonaSandbox }
        });
      }
      
      return sandboxes;
    } catch (error) {
      throw new Error(`Failed to list Daytona sandboxes: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async getTemplates(): Promise<string[]> {
    return [
      'typescript',
      'javascript', 
      'python',
      'go',
      'rust',
      'java',
      'docker'
    ];
  }

  /**
   * Generate Docker image name
   */
  private generateImageName(name?: string): string {
    const baseName = name?.toLowerCase().replace(/[^a-z0-9-]/g, '-') || 'app';
    return `daytona-${baseName}-${Date.now()}`;
  }

  /**
   * Detect language from template name
   */
  private detectLanguageFromTemplate(template?: string): string {
    if (!template || template === 'base') return 'typescript';
    
    const languageMap: Record<string, string> = {
      'react': 'typescript',
      'react-ts': 'typescript',
      'nextjs': 'typescript',
      'node': 'javascript',
      'node-ts': 'typescript',
      'python3': 'python',
      'flask': 'python',
      'fastapi': 'python',
      'django': 'python',
      'go': 'go',
      'rust': 'rust',
      'java': 'java'
    };
    
    return languageMap[template] || 'typescript';
  }
}