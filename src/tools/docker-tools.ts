import { DockerfileSelector } from '../docker/dockerfile-selector';
import { DockerManager } from '../docker/docker-manager';

export class DockerTools {
  private dockerfileSelector: DockerfileSelector;
  private dockerManager: DockerManager;
  private workingDirectory: string;

  constructor(workingDirectory: string = process.cwd()) {
    this.workingDirectory = workingDirectory;
    this.dockerfileSelector = new DockerfileSelector();
    this.dockerManager = new DockerManager();
  }

  getTools() {
    return [
      this.dockerfileSelector.getDockerfileSelectorTool(),
      {
        name: 'check_docker_availability',
        description: 'Check if Docker is installed and available on the system',
        parameters: {
          type: 'object',
          properties: {},
          required: []
        }
      },
      {
        name: 'get_available_dockerfiles',
        description: 'Get list of available Dockerfile templates',
        parameters: {
          type: 'object',
          properties: {},
          required: []
        }
      }
    ];
  }

  async executeTool(toolName: string, parameters: any): Promise<string> {
    try {
      switch (toolName) {
        case 'select_dockerfile':
          return await this.dockerfileSelector.executeDockerfileSelection(parameters, this.workingDirectory);

        case 'check_docker_availability':
          const dockerCheck = await this.dockerManager.checkDockerAvailable();
          if (dockerCheck.available) {
            return `Docker is available: ${dockerCheck.version}`;
          } else {
            return `Docker is not available: ${dockerCheck.error}. Please install Docker to use sandbox deployment features.`;
          }

        case 'get_available_dockerfiles':
          const available = await this.dockerManager.getAvailableDockerfiles();
          return `Available Dockerfile templates: ${available.join(', ')}`;

        default:
          return `Unknown Docker tool: ${toolName}`;
      }
    } catch (error) {
      return `Error executing Docker tool '${toolName}': ${error instanceof Error ? error.message : 'Unknown error'}`;
    }
  }

  /**
   * Get Dockerfile content for a specific type
   */
  async getDockerfile(type: string): Promise<string> {
    return this.dockerManager.getDockerfile(type as any);
  }

  /**
   * Build Docker image from project
   */
  async buildImage(dockerfileType: string, imageName?: string): Promise<any> {
    const finalImageName = imageName || this.dockerManager.generateImageName();
    
    return this.dockerManager.buildImage({
      dockerfileType: dockerfileType as any,
      projectPath: this.workingDirectory,
      imageName: finalImageName
    });
  }

  /**
   * Get fallback Dockerfile selection
   */
  async getFallbackSelection(): Promise<any> {
    return this.dockerfileSelector.getFallbackSelection(this.workingDirectory);
  }
}