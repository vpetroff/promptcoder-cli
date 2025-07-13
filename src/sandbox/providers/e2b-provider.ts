import { Sandbox as E2BSandbox } from '@e2b/code-interpreter';
import { SandboxProvider, Sandbox, SandboxConfig, FileMap, DockerSandboxConfig, DeploymentResult } from '../types';

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

    // Upload files to the sandbox
    const uploadPromises = Object.entries(files)
      .filter(([, content]) => content !== null)
      .map(([path, content]) => {
        const contentStr = content instanceof Buffer ? content.toString('utf8') : content as string;
        return e2bSandbox.files.write(path, contentStr);
      });

    await Promise.all(uploadPromises);

    // Start the application if configured
    if (sandbox.template && sandbox.metadata?.startCommand) {
      console.log(`🚀 Starting application with: ${sandbox.metadata.startCommand}`);
      
      try {
        await e2bSandbox.runCode(sandbox.metadata.startCommand);
        console.log(`✅ Application started`);
        
        // Wait for the server to start
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

  /**
   * Deploy using Docker template - the main method for Docker-based deployment
   */
  async deployWithDockerfile(dockerfile: string, files: FileMap, config: DockerSandboxConfig): Promise<DeploymentResult> {
    const startTime = Date.now();

    try {
      // Step 1: Create E2B template from Dockerfile
      console.log('🏗️ Creating E2B template from Dockerfile...');
      const templateId = await this.createE2BTemplate(dockerfile, files, config);
      
      // Step 2: Create sandbox from the new template
      console.log(`🚀 Creating sandbox from template: ${templateId}`);
      const sandbox = await E2BSandbox.create(templateId, {
        apiKey: this.apiKey
      });

      this.activeSandboxes.set(sandbox.sandboxId, sandbox);

      const port = config.port || 3000;
      const url = `https://${sandbox.sandboxId}-${port}.e2b.dev`;

      const deploymentTime = Date.now() - startTime;

      return {
        sandbox: {
          id: sandbox.sandboxId,
          name: config.name || `Docker App ${sandbox.sandboxId.slice(0, 8)}`,
          url,
          status: 'running',
          provider: this.name,
          template: templateId,
          createdAt: new Date(),
          updatedAt: new Date(),
          metadata: {
            sandbox,
            templateId,
            dockerfile,
            port
          }
        },
        url,
        filesUploaded: Object.keys(files).length,
        deploymentTime
      };

    } catch (error) {
      const deploymentTime = Date.now() - startTime;
      throw new Error(`E2B Docker deployment failed after ${deploymentTime}ms: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Create E2B template using CLI following official documentation
   */
  private async createE2BTemplate(dockerfile: string, files: FileMap, config: DockerSandboxConfig): Promise<string> {
    const { exec } = require('child_process');
    const { promisify } = require('util');
    const execAsync = promisify(exec);
    const fs = require('fs-extra');
    const path = require('path');
    const os = require('os');

    // Create temporary directory for template build
    const tempDir = path.join(os.tmpdir(), `e2b-template-${Date.now()}`);
    await fs.ensureDir(tempDir);

    try {
      // Convert Dockerfile to E2B format (must use e2bdev/code-interpreter:latest)
      const e2bDockerfile = this.convertToE2BDockerfile(dockerfile);
      await fs.writeFile(path.join(tempDir, 'e2b.Dockerfile'), e2bDockerfile);

      // Write all project files
      for (const [filePath, content] of Object.entries(files)) {
        if (content !== null) {
          const fullPath = path.join(tempDir, filePath);
          await fs.ensureDir(path.dirname(fullPath));
          const contentStr = content instanceof Buffer ? content.toString('utf8') : content as string;
          await fs.writeFile(fullPath, contentStr);
        }
      }

      // Set E2B API key
      const env = { ...process.env, E2B_API_KEY: this.apiKey };

      // Check E2B CLI is installed
      try {
        await execAsync('e2b --version', { env });
      } catch (error) {
        throw new Error('E2B CLI not installed. Install with: npm install -g @e2b/cli');
      }

      // Initialize E2B template
      console.log('🏗️ Initializing E2B template...');
      await execAsync(`cd "${tempDir}" && e2b template init`, { env });

      // Build the template
      console.log('📦 Building E2B template...');
      const { stdout, stderr } = await execAsync(`cd "${tempDir}" && e2b template build`, { env });
      
      // E2B CLI may output build info in stderr, so check both
      const fullOutput = stdout + '\n' + stderr;
      
      console.log('📄 E2B CLI stdout:', stdout);
      console.log('📄 E2B CLI stderr:', stderr);

      // Extract template ID from CLI output
      const templateId = this.extractTemplateId(fullOutput);
      
      if (!templateId) {
        console.log('❌ Could not extract template ID from E2B CLI output');
        console.log('Full output:', fullOutput);
        throw new Error('Could not extract template ID from E2B CLI output');
      }
      
      console.log(`✅ E2B template created: ${templateId}`);
      return templateId;

    } finally {
      // Clean up temporary directory
      await fs.remove(tempDir);
    }
  }

  /**
   * Convert regular Dockerfile to E2B format
   */
  private convertToE2BDockerfile(originalDockerfile: string): string {
    let e2bDockerfile = `FROM e2bdev/code-interpreter:latest

# PromptCoder CLI - Generated E2B Template
# Based on original Dockerfile configuration

WORKDIR /app

`;

    // Process the original Dockerfile line by line, handling multiline commands
    const lines = originalDockerfile.split('\n');
    let currentCommand = '';
    let inMultilineCommand = false;
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trim();
      
      // Skip original FROM statements
      if (trimmed.startsWith('FROM ')) {
        continue;
      }
      
      // Handle multiline commands (lines ending with \)
      if (trimmed.endsWith('\\')) {
        inMultilineCommand = true;
        currentCommand += line + '\n';
        continue;
      }
      
      // End of multiline command
      if (inMultilineCommand) {
        currentCommand += line + '\n';
        inMultilineCommand = false;
        
        // Add the complete multiline command
        if (this.shouldIncludeDockerfileCommand(currentCommand)) {
          e2bDockerfile += currentCommand;
        }
        currentCommand = '';
        continue;
      }
      
      // Single line commands
      if (this.shouldIncludeDockerfileCommand(line)) {
        e2bDockerfile += line + '\n';
      }
    }

    // Add final setup for E2B
    e2bDockerfile += `
# E2B template ready - files will be available in /app
`;

    return e2bDockerfile;
  }

  /**
   * Determine if a Dockerfile command should be included in E2B template
   */
  private shouldIncludeDockerfileCommand(command: string): boolean {
    const trimmed = command.trim();
    
    // Skip empty lines and comments (but keep them for readability)
    if (trimmed === '' || trimmed.startsWith('#')) {
      return true;
    }
    
    // Skip original FROM and CMD commands
    if (trimmed.startsWith('FROM ') || trimmed.startsWith('CMD ')) {
      return false;
    }
    
    // Skip build commands that might fail in basic setup
    if (trimmed.includes('yarn build') || 
        trimmed.includes('npm run build') || 
        trimmed.includes('pnpm build')) {
      return false;
    }
    
    // Include COPY, RUN (for installs), EXPOSE commands
    if (trimmed.startsWith('COPY ') || 
        trimmed.startsWith('RUN ') || 
        trimmed.startsWith('EXPOSE ') ||
        trimmed.startsWith('ENV ') ||
        trimmed.startsWith('ARG ') ||
        trimmed.startsWith('WORKDIR ')) {
      return true;
    }
    
    return false;
  }

  /**
   * Extract template ID from E2B CLI output
   */
  private extractTemplateId(output: string): string | null {
    // Based on the Docker image name pattern seen in the error:
    // docker.e2b.app/e2b/custom-envs/10tc0zofac05sesz7zg7:3cd3ea0a-aebf-4473-ac53-ebe03eb32979
    // The template ID appears to be the part after custom-envs/
    
    const patterns = [
      // E2B CLI template build pattern (most reliable)
      /Requested build for the sandbox template\s+([a-z0-9]+)/i,
      
      // Docker image naming pattern
      /docker\.e2b\.app\/e2b\/custom-envs\/([a-z0-9]+):/i,
      
      // Template with build ID pattern
      /Triggered build for the sandbox template\s+([a-z0-9]+)\s+with build ID/i,
      
      // Standard E2B CLI patterns
      /Template\s+ID:\s*([a-z0-9\-_]+)/i,
      /Template\s+['""]?([a-z0-9\-_]+)['""]?\s+(?:built|created|successfully)/i,
      /(?:template|Template)\s+(?:ID|id):\s*([a-z0-9\-_]+)/i,
      
      // Success message patterns
      /(?:built|created|pushed)\s+(?:template\s+)?['""]?([a-z0-9\-_]+)['""]?/i
    ];

    for (const pattern of patterns) {
      const match = output.match(pattern);
      if (match && match[1]) {
        console.log(`🔍 Found potential template ID: ${match[1]} (pattern: ${pattern})`);
        return match[1];
      }
    }

    // For the global pattern, try all matches and pick the most template-like one
    const globalPattern = /\b([a-z0-9]{12,})\b/g;
    const matches = Array.from(output.matchAll(globalPattern));
    
    for (const match of matches) {
      const candidate = match[1];
      // Skip obvious non-template IDs (like timestamps, hashes that are too long, etc.)
      if (candidate.length >= 12 && candidate.length <= 25 && !/^\d+$/.test(candidate)) {
        console.log(`🔍 Found candidate template ID: ${candidate}`);
        return candidate;
      }
    }

    return null;
  }

  // Standard provider methods
  async getSandbox(id: string): Promise<Sandbox> {
    let e2bSandbox = this.activeSandboxes.get(id);
    
    if (!e2bSandbox) {
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
      template: 'unknown',
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
        try {
          await e2bSandbox!.files.remove(path);
        } catch (error) {
          // File might not exist
        }
      } else {
        const contentStr = content instanceof Buffer ? content.toString('utf8') : content as string;
        await e2bSandbox!.files.write(path, contentStr);
      }
    });

    await Promise.all(promises);
  }

  async listSandboxes(): Promise<Sandbox[]> {
    const sandboxes: Sandbox[] = [];
    
    for (const [id, e2bSandbox] of this.activeSandboxes.entries()) {
      sandboxes.push({
        id: e2bSandbox.sandboxId,
        name: `Sandbox ${id.slice(0, 8)}`,
        url: `https://${id}.e2b.dev`,
        status: 'running',
        provider: this.name,
        template: 'unknown',
        createdAt: new Date(),
        updatedAt: new Date(),
        metadata: { sandbox: e2bSandbox }
      });
    }
    
    return sandboxes;
  }

  async getTemplates(): Promise<string[]> {
    return ['base'];
  }
}