import * as fs from 'fs-extra';
import * as path from 'path';
import { DockerfileType } from './docker-manager';

export interface DockerfileSelection {
  type: DockerfileType;
  reasoning: string;
  confidence: 'high' | 'medium' | 'low';
}

export interface ProjectAnalysis {
  hasPackageJson: boolean;
  hasCsprojFiles: boolean;
  hasIndexHtml: boolean;
  dependencies: string[];
  scripts: Record<string, string>;
  framework?: string;
  language?: string;
}

export class DockerfileSelector {
  /**
   * Analyze project directory to gather information for LLM tool
   */
  async analyzeProject(projectPath: string): Promise<ProjectAnalysis> {
    const analysis: ProjectAnalysis = {
      hasPackageJson: false,
      hasCsprojFiles: false,
      hasIndexHtml: false,
      dependencies: [],
      scripts: {}
    };

    try {
      // Check for package.json (Node.js projects)
      const packageJsonPath = path.join(projectPath, 'package.json');
      if (await fs.pathExists(packageJsonPath)) {
        analysis.hasPackageJson = true;
        try {
          const packageJson = await fs.readJson(packageJsonPath);
          analysis.dependencies = Object.keys({ 
            ...packageJson.dependencies, 
            ...packageJson.devDependencies 
          });
          analysis.scripts = packageJson.scripts || {};
          
          // Detect framework from dependencies
          if (analysis.dependencies.includes('react') && !analysis.dependencies.includes('@anthropic-ai/sdk')) {
            // Only treat as React if it's actually a frontend React app, not a CLI tool with React dependencies
            analysis.framework = 'react';
            analysis.language = 'javascript';
          } else if (analysis.dependencies.includes('next')) {
            analysis.framework = 'nextjs';
            analysis.language = 'javascript';
          } else if (analysis.hasPackageJson && (analysis.scripts.start || analysis.scripts.dev)) {
            // Node.js project (CLI, server, etc.)
            analysis.framework = 'nodejs';
            analysis.language = 'javascript';
          }
          
          if (analysis.dependencies.includes('typescript')) {
            analysis.language = 'typescript';
          }
        } catch (error) {
          // package.json exists but is malformed
        }
      }

      // Check for .csproj files (.NET projects)
      const files = await fs.readdir(projectPath);
      analysis.hasCsprojFiles = files.some(file => file.endsWith('.csproj'));
      
      if (analysis.hasCsprojFiles) {
        analysis.framework = 'aspnet';
        analysis.language = 'csharp';
      }

      // Check for index.html (static projects)
      const indexHtmlPath = path.join(projectPath, 'index.html');
      analysis.hasIndexHtml = await fs.pathExists(indexHtmlPath);

    } catch (error) {
      // If we can't analyze, return basic analysis
      console.warn(`Failed to analyze project: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }

    return analysis;
  }

  /**
   * Get the LLM tool definition for Dockerfile selection
   */
  getDockerfileSelectorTool() {
    return {
      name: 'select_dockerfile',
      description: 'Analyze project structure and select the most appropriate Dockerfile template for deployment',
      parameters: {
        type: 'object',
        properties: {
          dockerfileType: {
            type: 'string',
            enum: ['react', 'nextjs', 'nodejs', 'dotnet', 'basic-webserver'],
            description: 'The Dockerfile template to use based on project analysis'
          },
          reasoning: {
            type: 'string',
            description: 'Brief explanation of why this Dockerfile was selected based on the project files and dependencies'
          },
          confidence: {
            type: 'string',
            enum: ['high', 'medium', 'low'],
            description: 'Confidence level in the selection'
          }
        },
        required: ['dockerfileType', 'reasoning', 'confidence']
      }
    };
  }

  /**
   * Execute the Dockerfile selection tool
   */
  async executeDockerfileSelection(params: any, projectPath: string): Promise<string> {
    try {
      const { dockerfileType, reasoning, confidence } = params;
      
      // Validate the selection
      const validTypes: DockerfileType[] = ['react', 'nextjs', 'nodejs', 'dotnet', 'basic-webserver'];
      if (!validTypes.includes(dockerfileType)) {
        return `Error: Invalid dockerfile type '${dockerfileType}'. Must be one of: ${validTypes.join(', ')}`;
      }

      // Perform our own analysis to validate the LLM's choice
      const analysis = await this.analyzeProject(projectPath);
      const validation = this.validateSelection(dockerfileType, analysis);

      return JSON.stringify({
        selectedType: dockerfileType,
        reasoning,
        confidence,
        validation: validation.isValid ? 'validated' : 'warning',
        validationMessage: validation.message,
        projectAnalysis: {
          framework: analysis.framework,
          language: analysis.language,
          hasPackageJson: analysis.hasPackageJson,
          hasCsprojFiles: analysis.hasCsprojFiles,
          hasIndexHtml: analysis.hasIndexHtml,
          keyDependencies: analysis.dependencies.slice(0, 10) // Limit for brevity
        }
      });

    } catch (error) {
      return `Error executing dockerfile selection: ${error instanceof Error ? error.message : 'Unknown error'}`;
    }
  }

  /**
   * Validate LLM's Dockerfile selection against project analysis
   */
  private validateSelection(selectedType: DockerfileType, analysis: ProjectAnalysis): { isValid: boolean; message: string } {
    switch (selectedType) {
      case 'react':
        if (analysis.framework === 'react') {
          return { isValid: true, message: 'React framework detected in dependencies' };
        }
        if (analysis.hasPackageJson && analysis.dependencies.includes('react')) {
          return { isValid: true, message: 'React dependency found' };
        }
        return { isValid: false, message: 'No React framework detected' };

      case 'nextjs':
        if (analysis.framework === 'nextjs') {
          return { isValid: true, message: 'Next.js framework detected in dependencies' };
        }
        if (analysis.hasPackageJson && analysis.dependencies.includes('next')) {
          return { isValid: true, message: 'Next.js dependency found' };
        }
        return { isValid: false, message: 'No Next.js framework detected' };

      case 'nodejs':
        if (analysis.framework === 'nodejs') {
          return { isValid: true, message: 'Node.js project detected' };
        }
        if (analysis.hasPackageJson && !analysis.dependencies.includes('react') && !analysis.dependencies.includes('next')) {
          return { isValid: true, message: 'Node.js package.json found without frontend frameworks' };
        }
        return { isValid: false, message: 'No Node.js project detected' };

      case 'dotnet':
        if (analysis.framework === 'aspnet') {
          return { isValid: true, message: '.NET project files detected' };
        }
        if (analysis.hasCsprojFiles) {
          return { isValid: true, message: '.csproj files found' };
        }
        return { isValid: false, message: 'No .NET project files detected' };

      case 'basic-webserver':
        if (analysis.hasIndexHtml) {
          return { isValid: true, message: 'index.html found - suitable for static serving' };
        }
        return { isValid: true, message: 'Fallback option - will serve any static files' };

      default:
        return { isValid: false, message: 'Unknown dockerfile type' };
    }
  }

  /**
   * Provide fallback selection if LLM tool fails
   */
  async getFallbackSelection(projectPath: string): Promise<DockerfileSelection> {
    const analysis = await this.analyzeProject(projectPath);

    // Simple rule-based fallback logic
    if (analysis.framework === 'nextjs') {
      return {
        type: 'nextjs',
        reasoning: 'Detected Next.js framework in package.json dependencies',
        confidence: 'high'
      };
    }

    if (analysis.framework === 'react') {
      return {
        type: 'react',
        reasoning: 'Detected React framework in package.json dependencies',
        confidence: 'high'
      };
    }

    if (analysis.framework === 'aspnet') {
      return {
        type: 'dotnet',
        reasoning: 'Detected .NET project files (.csproj)',
        confidence: 'high'
      };
    }

    if (analysis.hasIndexHtml) {
      return {
        type: 'basic-webserver',
        reasoning: 'Detected index.html - using static web server',
        confidence: 'medium'
      };
    }

    return {
      type: 'basic-webserver',
      reasoning: 'No specific framework detected - using basic web server as fallback',
      confidence: 'low'
    };
  }
}