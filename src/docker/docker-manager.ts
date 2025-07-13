import * as fs from 'fs-extra';
import * as path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export type DockerfileType = 'react' | 'nextjs' | 'nodejs' | 'dotnet' | 'basic-webserver';

export interface DockerBuildConfig {
  dockerfileType: DockerfileType;
  projectPath: string;
  imageName: string;
  buildArgs?: Record<string, string>;
}

export interface DockerBuildResult {
  imageName: string;
  buildTime: number;
  success: boolean;
  logs: string;
}

export class DockerManager {
  private dockerfilesPath: string;

  constructor() {
    // Use source path in development, dist path in production
    const isDev = __dirname.includes('/src/');
    this.dockerfilesPath = isDev 
      ? path.join(__dirname, '../dockerfiles')
      : path.join(__dirname, '../../src/dockerfiles');
  }

  /**
   * Check if Docker is available on the system
   */
  async checkDockerAvailable(): Promise<{ available: boolean; version?: string; error?: string }> {
    try {
      const { stdout } = await execAsync('docker --version');
      return {
        available: true,
        version: stdout.trim()
      };
    } catch (error) {
      return {
        available: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Get the content of a specific Dockerfile template
   */
  async getDockerfile(type: DockerfileType): Promise<string> {
    const dockerfilePath = path.join(this.dockerfilesPath, `${type}.dockerfile`);
    
    if (!(await fs.pathExists(dockerfilePath))) {
      throw new Error(`Dockerfile template '${type}' not found at ${dockerfilePath}`);
    }

    return fs.readFile(dockerfilePath, 'utf8');
  }

  /**
   * List all available Dockerfile templates
   */
  async getAvailableDockerfiles(): Promise<DockerfileType[]> {
    try {
      const files = await fs.readdir(this.dockerfilesPath);
      return files
        .filter(file => file.endsWith('.dockerfile'))
        .map(file => file.replace('.dockerfile', '') as DockerfileType);
    } catch (error) {
      throw new Error(`Failed to read dockerfiles directory: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Build a Docker image from project files using selected Dockerfile
   */
  async buildImage(config: DockerBuildConfig): Promise<DockerBuildResult> {
    const startTime = Date.now();
    
    try {
      // Check if Docker is available
      const dockerCheck = await this.checkDockerAvailable();
      if (!dockerCheck.available) {
        throw new Error(`Docker not available: ${dockerCheck.error}`);
      }

      // Get Dockerfile content
      const dockerfileContent = await this.getDockerfile(config.dockerfileType);

      // Create temporary build directory
      const tempDir = path.join(config.projectPath, '.tmp-docker-build');
      await fs.ensureDir(tempDir);

      try {
        // Copy project files to temp directory (excluding node_modules, .git, etc.)
        await this.copyProjectFiles(config.projectPath, tempDir);

        // Write Dockerfile to temp directory
        const dockerfilePath = path.join(tempDir, 'Dockerfile');
        await fs.writeFile(dockerfilePath, dockerfileContent);

        // Build Docker image
        const buildArgs = config.buildArgs ? 
          Object.entries(config.buildArgs).map(([key, value]) => `--build-arg ${key}=${value}`).join(' ') : '';

        const buildCommand = `docker build ${buildArgs} -t ${config.imageName} ${tempDir}`;
        const { stdout, stderr } = await execAsync(buildCommand);

        const buildTime = Date.now() - startTime;

        return {
          imageName: config.imageName,
          buildTime,
          success: true,
          logs: stdout + stderr
        };

      } finally {
        // Clean up temporary directory
        await fs.remove(tempDir);
      }

    } catch (error) {
      const buildTime = Date.now() - startTime;
      
      return {
        imageName: config.imageName,
        buildTime,
        success: false,
        logs: error instanceof Error ? error.message : 'Unknown build error'
      };
    }
  }

  /**
   * Generate a unique image name for the project
   */
  generateImageName(projectName?: string): string {
    const timestamp = Date.now();
    const name = projectName || 'promptcoder-app';
    // Sanitize name for Docker (lowercase, alphanumeric + hyphens only)
    const sanitizedName = name.toLowerCase().replace(/[^a-z0-9-]/g, '-');
    return `promptcoder-${sanitizedName}-${timestamp}`;
  }

  /**
   * Copy project files to build directory, excluding common ignore patterns
   */
  private async copyProjectFiles(sourceDir: string, targetDir: string): Promise<void> {
    const ignorePatterns = [
      'node_modules',
      '.git',
      '.tmp-docker-build',
      'dist',
      'build',
      '.next',
      'bin',
      'obj',
      '*.log',
      '.env.local',
      '.env.*.local'
    ];

    const files = await fs.readdir(sourceDir);
    
    for (const file of files) {
      // Skip ignored patterns
      if (ignorePatterns.some(pattern => {
        if (pattern.includes('*')) {
          return file.match(new RegExp(pattern.replace('*', '.*')));
        }
        return file === pattern;
      })) {
        continue;
      }

      const sourcePath = path.join(sourceDir, file);
      const targetPath = path.join(targetDir, file);
      
      const stats = await fs.stat(sourcePath);
      if (stats.isDirectory()) {
        await fs.copy(sourcePath, targetPath);
      } else {
        await fs.copy(sourcePath, targetPath);
      }
    }
  }

  /**
   * Push image to registry (if configured)
   */
  async pushImage(imageName: string, registryUrl?: string): Promise<boolean> {
    try {
      if (registryUrl) {
        const taggedName = `${registryUrl}/${imageName}`;
        await execAsync(`docker tag ${imageName} ${taggedName}`);
        await execAsync(`docker push ${taggedName}`);
      }
      return true;
    } catch (error) {
      console.warn(`Failed to push image: ${error instanceof Error ? error.message : 'Unknown error'}`);
      return false;
    }
  }
}