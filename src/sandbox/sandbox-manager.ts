import * as fs from 'fs-extra';
import * as path from 'path';
import { glob } from 'glob';
import { createSandboxProvider } from './providers';
import { SandboxProvider, Sandbox, SandboxConfig, FileMap, DeploymentResult, SandboxTemplate, DockerSandboxConfig } from './types';
import { DockerManager, DockerfileType } from '../docker/docker-manager';
import { DockerfileSelector } from '../docker/dockerfile-selector';

export class SandboxManager {
  private provider: SandboxProvider;
  private workingDirectory: string;
  private templates: Map<string, SandboxTemplate> = new Map();
  private dockerManager: DockerManager;
  private dockerfileSelector: DockerfileSelector;

  constructor(providerName: string, providerConfig: any, workingDirectory: string = process.cwd()) {
    this.provider = createSandboxProvider(providerName, providerConfig);
    this.workingDirectory = workingDirectory;
    this.dockerManager = new DockerManager();
    this.dockerfileSelector = new DockerfileSelector();
    this.loadDefaultTemplates();
  }

  async deployProject(config: SandboxConfig = {}): Promise<DeploymentResult> {
    // Check if we should use Docker-based deployment
    if (config.template === 'docker' || await this.shouldUseDockerDeployment()) {
      return this.deployProjectWithDocker(config);
    }

    // Use traditional deployment
    return this.deployProjectTraditional(config);
  }

  /**
   * Deploy project using Docker-based approach with LLM selection
   */
  async deployProjectWithDocker(config: SandboxConfig = {}): Promise<DeploymentResult> {
    const startTime = Date.now();

    try {
      // Get fallback Dockerfile selection (will be replaced by LLM in actual usage)
      const dockerfileSelection = await this.dockerfileSelector.getFallbackSelection(this.workingDirectory);
      
      console.log(`🔍 Selected Dockerfile: ${dockerfileSelection.type}`);
      console.log(`📝 Reasoning: ${dockerfileSelection.reasoning}`);

      // Get the Dockerfile content
      const dockerfileContent = await this.dockerManager.getDockerfile(dockerfileSelection.type);

      // Collect project files
      const files = await this.collectProjectFiles();

      // Configure Docker deployment
      const dockerConfig: DockerSandboxConfig = {
        name: config.name || `Docker App ${Date.now()}`,
        port: this.getPortForDockerfile(dockerfileSelection.type),
        environment: config.environment || {},
        imageName: this.dockerManager.generateImageName(config.name)
      };

      // Deploy using provider's Docker support
      if (this.provider.deployWithDockerfile) {
        return await this.provider.deployWithDockerfile(dockerfileContent, files, dockerConfig);
      } else {
        throw new Error(`Provider ${this.provider.name} does not support Docker deployment`);
      }

    } catch (error) {
      const deploymentTime = Date.now() - startTime;
      throw new Error(`Docker deployment failed after ${deploymentTime}ms: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Traditional deployment method (existing logic)
   */
  async deployProjectTraditional(config: SandboxConfig = {}): Promise<DeploymentResult> {
    const startTime = Date.now();

    // Auto-detect project type if template not specified
    if (!config.template) {
      config.template = await this.detectProjectType();
    }

    // Get template configuration
    const template = this.getTemplate(config.template);
    if (template) {
      config = { ...template, ...config };
    }

    // Create sandbox
    const sandbox = await this.provider.createSandbox(config);

    // Collect files to upload
    const files = await this.collectProjectFiles();

    // Deploy files to sandbox
    const url = await this.provider.deploySandbox(sandbox, files);

    const deploymentTime = Date.now() - startTime;

    return {
      sandbox: { ...sandbox, url },
      url,
      filesUploaded: Object.keys(files).length,
      deploymentTime
    };
  }

  async syncProject(sandboxId: string): Promise<void> {
    const files = await this.collectProjectFiles();
    await this.provider.syncFiles(sandboxId, files);
  }

  async syncFiles(sandboxId: string, filePaths: string[]): Promise<void> {
    const files: FileMap = {};
    
    for (const filePath of filePaths) {
      try {
        const fullPath = path.join(this.workingDirectory, filePath);
        
        // Check if file exists (it might have been deleted)
        if (await fs.pathExists(fullPath)) {
          const stats = await fs.stat(fullPath);
          
          // Skip large files (> 1MB)
          if (stats.size > 1024 * 1024) {
            continue;
          }

          // Try to read as text, fallback to binary for binary files
          try {
            const content = await fs.readFile(fullPath, 'utf8');
            files[filePath] = content;
          } catch (error) {
            // If it fails to read as text, it might be binary
            const content = await fs.readFile(fullPath);
            files[filePath] = content;
          }
        } else {
          // File was deleted, we should handle this in the provider
          files[filePath] = null; // Null indicates file deletion
        }
      } catch (error) {
        console.warn(`Warning: Failed to read file ${filePath}:`, error);
        continue;
      }
    }

    if (Object.keys(files).length > 0) {
      await this.provider.syncFiles(sandboxId, files);
    }
  }

  async listSandboxes(): Promise<Sandbox[]> {
    return this.provider.listSandboxes();
  }

  async getSandbox(id: string): Promise<Sandbox> {
    return this.provider.getSandbox(id);
  }

  async deleteSandbox(id: string): Promise<void> {
    await this.provider.deleteSandbox(id);
  }

  async getAvailableTemplates(): Promise<string[]> {
    return this.provider.getTemplates();
  }

  getTemplate(templateId: string): SandboxTemplate | undefined {
    return this.templates.get(templateId);
  }

  addTemplate(template: SandboxTemplate): void {
    this.templates.set(template.id, template);
  }

  private async detectProjectType(): Promise<string> {
    const packageJsonPath = path.join(this.workingDirectory, 'package.json');
    
    if (await fs.pathExists(packageJsonPath)) {
      try {
        const packageJson = await fs.readJson(packageJsonPath);
        
        // Check dependencies for framework detection
        const deps = { ...packageJson.dependencies, ...packageJson.devDependencies };
        
        if (deps.react && deps.typescript) return 'react-ts';
        if (deps.react) return 'react';
        if (deps.next) return 'nextjs';
        if (deps.vue) return 'vue';
        if (deps['@angular/core']) return 'angular';
        if (deps.express) return 'express';
        if (deps.typescript) return 'node-ts';
        
        return 'node20';
      } catch (error) {
        // Fallback if package.json is malformed
      }
    }

    // Python detection
    const pythonFiles = ['requirements.txt', 'pyproject.toml', 'setup.py', 'Pipfile'];
    for (const file of pythonFiles) {
      if (await fs.pathExists(path.join(this.workingDirectory, file))) {
        if (await fs.pathExists(path.join(this.workingDirectory, 'manage.py'))) {
          return 'django';
        }
        if (await this.hasFileContaining('flask', ['app.py', 'main.py', '*.py'])) {
          return 'flask';
        }
        if (await this.hasFileContaining('fastapi', ['app.py', 'main.py', '*.py'])) {
          return 'fastapi';
        }
        return 'python3';
      }
    }

    // Default fallback
    return 'base';
  }

  private async hasFileContaining(searchTerm: string, patterns: string[]): Promise<boolean> {
    for (const pattern of patterns) {
      try {
        const files = await glob(pattern, { cwd: this.workingDirectory });
        for (const file of files) {
          const content = await fs.readFile(path.join(this.workingDirectory, file), 'utf8');
          if (content.toLowerCase().includes(searchTerm.toLowerCase())) {
            return true;
          }
        }
      } catch (error) {
        // Continue checking other patterns
      }
    }
    return false;
  }

  private async collectProjectFiles(): Promise<FileMap> {
    const files: FileMap = {};
    
    // Common ignore patterns
    const ignorePatterns = [
      'node_modules/**',
      '.git/**',
      'dist/**',
      'build/**',
      '.next/**',
      '__pycache__/**',
      '*.pyc',
      '.env',
      '.env.local',
      '.DS_Store',
      'Thumbs.db',
      '*.log',
      '.vscode/**',
      '.idea/**'
    ];

    try {
      // Get all files, excluding common ignore patterns
      const allFiles = await glob('**/*', {
        cwd: this.workingDirectory,
        ignore: ignorePatterns,
        nodir: true,
        dot: false
      });

      // Read each file
      for (const filePath of allFiles) {
        try {
          const fullPath = path.join(this.workingDirectory, filePath);
          const stats = await fs.stat(fullPath);
          
          // Skip large files (> 1MB)
          if (stats.size > 1024 * 1024) {
            continue;
          }

          // Try to read as text, fallback to binary for binary files
          try {
            const content = await fs.readFile(fullPath, 'utf8');
            files[filePath] = content;
          } catch (error) {
            // If it fails to read as text, it might be binary
            const content = await fs.readFile(fullPath);
            files[filePath] = content;
          }
        } catch (error) {
          // Skip files that can't be read
          continue;
        }
      }
    } catch (error) {
      throw new Error(`Failed to collect project files: ${error instanceof Error ? error.message : String(error)}`);
    }

    return files;
  }

  private loadDefaultTemplates(): void {
    const templates: SandboxTemplate[] = [
      {
        id: 'react-ts',
        name: 'React TypeScript',
        description: 'React application with TypeScript',
        provider: 'e2b',
        template: 'base',
        startCommand: 'npm install && npm run dev',
        port: 3000,
        environment: { NODE_ENV: 'development' }
      },
      {
        id: 'react',
        name: 'React JavaScript',
        description: 'React application with JavaScript',
        provider: 'e2b',
        template: 'base',
        startCommand: 'npm install && npm run dev',
        port: 3000,
        environment: { NODE_ENV: 'development' }
      },
      {
        id: 'nextjs',
        name: 'Next.js',
        description: 'Next.js React framework',
        provider: 'e2b',
        template: 'base',
        startCommand: 'npm install && npm run dev',
        port: 3000,
        environment: { NODE_ENV: 'development' }
      },
      {
        id: 'express',
        name: 'Express.js',
        description: 'Express.js Node.js server',
        provider: 'e2b',
        template: 'base',
        startCommand: 'npm install && npm start',
        port: 3000,
        environment: { NODE_ENV: 'development' }
      },
      {
        id: 'node-ts',
        name: 'Node.js TypeScript',
        description: 'Node.js application with TypeScript',
        provider: 'e2b',
        template: 'base',
        startCommand: 'npm install && npm run build && npm start',
        port: 3000,
        environment: { NODE_ENV: 'development' }
      },
      {
        id: 'python3',
        name: 'Python 3',
        description: 'Python 3 application',
        provider: 'e2b',
        template: 'base',
        startCommand: 'pip install -r requirements.txt && python main.py',
        port: 8000,
        environment: { PYTHONPATH: '.' }
      },
      {
        id: 'flask',
        name: 'Flask',
        description: 'Flask Python web framework',
        provider: 'e2b',
        template: 'base',
        startCommand: 'pip install -r requirements.txt && python app.py',
        port: 5000,
        environment: { FLASK_ENV: 'development' }
      },
      {
        id: 'fastapi',
        name: 'FastAPI',
        description: 'FastAPI Python web framework',
        provider: 'e2b',
        template: 'base',
        startCommand: 'pip install -r requirements.txt && uvicorn main:app --host 0.0.0.0 --port 8000',
        port: 8000,
        environment: { PYTHONPATH: '.' }
      }
    ];

    templates.forEach(template => this.addTemplate(template));
  }

  /**
   * Determine if we should use Docker-based deployment
   */
  private async shouldUseDockerDeployment(): Promise<boolean> {
    // Check if Docker is available
    const dockerCheck = await this.dockerManager.checkDockerAvailable();
    if (!dockerCheck.available) {
      return false;
    }

    // For now, default to Docker deployment if available
    // In the future, this could be based on user preference or project type
    return true;
  }

  /**
   * Get the appropriate port for a Dockerfile type
   */
  private getPortForDockerfile(dockerfileType: DockerfileType): number {
    switch (dockerfileType) {
      case 'react':
      case 'nextjs':
        return 3000;
      case 'dotnet':
        return 5000;
      case 'basic-webserver':
        return 3000; // Changed from 80 to 3000 for E2B compatibility
      default:
        return 3000;
    }
  }

  /**
   * Deploy project with LLM-selected Dockerfile (for use by LLM tools)
   */
  async deployProjectWithLLMSelection(dockerfileType: DockerfileType, reasoning: string, config: SandboxConfig = {}): Promise<DeploymentResult> {
    const startTime = Date.now();

    try {
      console.log(`🤖 LLM selected Dockerfile: ${dockerfileType}`);
      console.log(`📝 Reasoning: ${reasoning}`);

      // Get the Dockerfile content
      const dockerfileContent = await this.dockerManager.getDockerfile(dockerfileType);

      // Collect project files
      const files = await this.collectProjectFiles();

      // Configure Docker deployment
      const dockerConfig: DockerSandboxConfig = {
        name: config.name || `${dockerfileType} App ${Date.now()}`,
        port: this.getPortForDockerfile(dockerfileType),
        environment: config.environment || {},
        imageName: this.dockerManager.generateImageName(config.name)
      };

      // Deploy using provider's Docker support
      if (this.provider.deployWithDockerfile) {
        return await this.provider.deployWithDockerfile(dockerfileContent, files, dockerConfig);
      } else {
        throw new Error(`Provider ${this.provider.name} does not support Docker deployment`);
      }

    } catch (error) {
      const deploymentTime = Date.now() - startTime;
      throw new Error(`LLM Docker deployment failed after ${deploymentTime}ms: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}