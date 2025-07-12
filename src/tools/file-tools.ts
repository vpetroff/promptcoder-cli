import * as fs from 'fs-extra';
import * as path from 'path';
import { Tool } from '../llm/types';

export class FileTools {
  private workingDirectory: string;

  constructor(workingDirectory: string = process.cwd()) {
    this.workingDirectory = workingDirectory;
  }

  getTools(): Tool[] {
    return [
      {
        name: 'read_file',
        description: 'Read the contents of a file',
        parameters: {
          type: 'object',
          properties: {
            file_path: {
              type: 'string',
              description: 'Path to the file to read (relative to working directory)'
            }
          },
          required: ['file_path']
        }
      },
      {
        name: 'write_file',
        description: 'Write content to a file (creates directories if needed)',
        parameters: {
          type: 'object',
          properties: {
            file_path: {
              type: 'string',
              description: 'Path to the file to write (relative to working directory)'
            },
            content: {
              type: 'string',
              description: 'Content to write to the file'
            }
          },
          required: ['file_path', 'content']
        }
      },
      {
        name: 'read_directory',
        description: 'List files and directories in a directory (automatically filters common unnecessary files like node_modules, .git, etc.)',
        parameters: {
          type: 'object',
          properties: {
            dir_path: {
              type: 'string',
              description: 'Path to the directory to read (relative to working directory)',
              default: '.'
            },
            recursive: {
              type: 'boolean',
              description: 'Whether to list files recursively',
              default: false
            },
            show_hidden: {
              type: 'boolean',
              description: 'Whether to show hidden files (starting with .)',
              default: false
            },
            include_ignored: {
              type: 'boolean',
              description: 'Whether to include commonly ignored directories (node_modules, .git, dist, etc.)',
              default: false
            },
            max_depth: {
              type: 'number',
              description: 'Maximum depth for recursive listing (1-5)',
              default: 3
            }
          },
          required: ['dir_path']
        }
      },
      {
        name: 'create_directory',
        description: 'Create a directory and any necessary parent directories',
        parameters: {
          type: 'object',
          properties: {
            dir_path: {
              type: 'string',
              description: 'Path to the directory to create (relative to working directory)'
            }
          },
          required: ['dir_path']
        }
      },
      {
        name: 'delete_file',
        description: 'Delete a file',
        parameters: {
          type: 'object',
          properties: {
            file_path: {
              type: 'string',
              description: 'Path to the file to delete (relative to working directory)'
            }
          },
          required: ['file_path']
        }
      },
      {
        name: 'file_exists',
        description: 'Check if a file or directory exists',
        parameters: {
          type: 'object',
          properties: {
            path: {
              type: 'string',
              description: 'Path to check (relative to working directory)'
            }
          },
          required: ['path']
        }
      }
    ];
  }

  async executeTool(name: string, parameters: Record<string, any>): Promise<string> {
    try {
      switch (name) {
        case 'read_file':
          return await this.readFile(parameters.file_path);
        case 'write_file':
          return await this.writeFile(parameters.file_path, parameters.content);
        case 'read_directory':
          return await this.readDirectory(
            parameters.dir_path || '.', 
            parameters.recursive || false,
            parameters.show_hidden || false,
            parameters.include_ignored || false,
            parameters.max_depth || 3
          );
        case 'create_directory':
          return await this.createDirectory(parameters.dir_path);
        case 'delete_file':
          return await this.deleteFile(parameters.file_path);
        case 'file_exists':
          return await this.fileExists(parameters.path);
        default:
          throw new Error(`Unknown tool: ${name}`);
      }
    } catch (error) {
      return `Error executing ${name}: ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  private resolvePath(relativePath: string): string {
    return path.resolve(this.workingDirectory, relativePath);
  }

  private async readFile(filePath: string): Promise<string> {
    const fullPath = this.resolvePath(filePath);
    const content = await fs.readFile(fullPath, 'utf-8');
    return `File contents of ${filePath}:\n\n${content}`;
  }

  private async writeFile(filePath: string, content: string): Promise<string> {
    const fullPath = this.resolvePath(filePath);
    await fs.ensureDir(path.dirname(fullPath));
    await fs.writeFile(fullPath, content, 'utf-8');
    return `Successfully wrote ${content.length} characters to ${filePath}`;
  }

  private async readDirectory(
    dirPath: string, 
    recursive: boolean, 
    showHidden: boolean = false, 
    includeIgnored: boolean = false,
    maxDepth: number = 3
  ): Promise<string> {
    const fullPath = this.resolvePath(dirPath);
    
    if (recursive) {
      const files = await this.getFilesRecursively(fullPath, fullPath, showHidden, includeIgnored, maxDepth, 0);
      const filteredFiles = files.filter(f => f.trim().length > 0);
      
      if (filteredFiles.length === 0) {
        return `No relevant files found in ${dirPath} (recursive, depth=${maxDepth})`;
      }
      
      return `Files in ${dirPath} (recursive, depth=${maxDepth}, ${filteredFiles.length} items):\n${filteredFiles.map(f => `  ${f}`).join('\n')}`;
    } else {
      const items = await fs.readdir(fullPath, { withFileTypes: true });
      const filteredItems = this.filterDirectoryItems(items, showHidden, includeIgnored);
      
      if (filteredItems.length === 0) {
        return `No relevant files found in ${dirPath}`;
      }
      
      const formatted = filteredItems.map(item => {
        const type = item.isDirectory() ? 'DIR' : 'FILE';
        const size = item.isFile() ? this.getFileSizeSync(path.join(fullPath, item.name)) : '';
        return `  ${type}: ${item.name}${size}`;
      }).join('\n');
      
      return `Contents of ${dirPath} (${filteredItems.length} items):\n${formatted}`;
    }
  }

  private async getFilesRecursively(
    dirPath: string, 
    relativeTo: string = dirPath, 
    showHidden: boolean = false, 
    includeIgnored: boolean = false,
    maxDepth: number = 3,
    currentDepth: number = 0
  ): Promise<string[]> {
    if (currentDepth >= maxDepth) {
      return [];
    }
    
    const items = await fs.readdir(dirPath, { withFileTypes: true });
    const filteredItems = this.filterDirectoryItems(items, showHidden, includeIgnored);
    const files: string[] = [];
    
    for (const item of filteredItems) {
      const fullPath = path.join(dirPath, item.name);
      const relativePath = path.relative(relativeTo, fullPath);
      
      if (item.isDirectory()) {
        const subFiles = await this.getFilesRecursively(fullPath, relativeTo, showHidden, includeIgnored, maxDepth, currentDepth + 1);
        files.push(...subFiles);
      } else {
        const size = this.getFileSizeSync(fullPath);
        files.push(`${relativePath}${size}`);
      }
    }
    
    return files;
  }

  private filterDirectoryItems(items: fs.Dirent[], showHidden: boolean, includeIgnored: boolean): fs.Dirent[] {
    const commonIgnorePatterns = [
      'node_modules',
      '.git',
      '.svn',
      '.hg',
      'dist',
      'build',
      'out',
      'target',
      '.next',
      '.nuxt',
      '.vscode',
      '.idea',
      '__pycache__',
      '.pytest_cache',
      '.coverage',
      '.nyc_output',
      'coverage',
      '.DS_Store',
      'Thumbs.db',
      '*.tmp',
      '*.temp',
      '*.log',
      '.env.local',
      '.env.production',
      '.cache',
      '.parcel-cache',
      '.turbo',
      '.vercel',
      '.netlify'
    ];

    return items.filter(item => {
      // Filter hidden files/directories
      if (!showHidden && item.name.startsWith('.')) {
        return false;
      }

      // Filter commonly ignored directories and files
      if (!includeIgnored) {
        const isIgnored = commonIgnorePatterns.some(pattern => {
          if (pattern.includes('*')) {
            // Simple glob pattern matching
            const regex = new RegExp(pattern.replace(/\*/g, '.*'));
            return regex.test(item.name);
          }
          return item.name === pattern;
        });
        
        if (isIgnored) {
          return false;
        }
      }

      return true;
    });
  }

  private getFileSizeSync(filePath: string): string {
    try {
      const stats = fs.statSync(filePath);
      if (stats.isFile()) {
        const bytes = stats.size;
        if (bytes < 1024) return ` (${bytes}B)`;
        if (bytes < 1024 * 1024) return ` (${Math.round(bytes / 1024)}KB)`;
        return ` (${Math.round(bytes / (1024 * 1024))}MB)`;
      }
      return '';
    } catch {
      return '';
    }
  }

  private async createDirectory(dirPath: string): Promise<string> {
    const fullPath = this.resolvePath(dirPath);
    await fs.ensureDir(fullPath);
    return `Successfully created directory ${dirPath}`;
  }

  private async deleteFile(filePath: string): Promise<string> {
    const fullPath = this.resolvePath(filePath);
    await fs.remove(fullPath);
    return `Successfully deleted ${filePath}`;
  }

  private async fileExists(checkPath: string): Promise<string> {
    const fullPath = this.resolvePath(checkPath);
    const exists = await fs.pathExists(fullPath);
    return `Path ${checkPath} ${exists ? 'exists' : 'does not exist'}`;
  }
}