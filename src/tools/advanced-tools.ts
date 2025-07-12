import * as fs from 'fs-extra';
import * as path from 'path';
import { Tool } from '../llm/types';

export class AdvancedTools {
  private workingDirectory: string;
  private checkpoints: Map<string, { files: Map<string, string>, timestamp: Date, description: string }> = new Map();

  constructor(workingDirectory: string = process.cwd()) {
    this.workingDirectory = workingDirectory;
  }

  getTools(): Tool[] {
    return [
      {
        name: 'edit_file_diff',
        description: 'Apply precise edits to a file using line-based diff format. More reliable than full file replacement.',
        parameters: {
          type: 'object',
          properties: {
            file_path: {
              type: 'string',
              description: 'Path to the file to edit (relative to working directory)'
            },
            old_text: {
              type: 'string',
              description: 'Exact text to find and replace (must match exactly including whitespace)'
            },
            new_text: {
              type: 'string', 
              description: 'New text to replace the old text with'
            },
            line_number: {
              type: 'number',
              description: 'Optional: approximate line number where the change should occur (for verification)'
            }
          },
          required: ['file_path', 'old_text', 'new_text']
        }
      },
      {
        name: 'insert_lines',
        description: 'Insert new lines at a specific position in a file',
        parameters: {
          type: 'object',
          properties: {
            file_path: {
              type: 'string',
              description: 'Path to the file (relative to working directory)'
            },
            line_number: {
              type: 'number',
              description: 'Line number to insert after (1-based, 0 means insert at beginning)'
            },
            content: {
              type: 'string',
              description: 'Content to insert (will be split on newlines)'
            }
          },
          required: ['file_path', 'line_number', 'content']
        }
      },
      {
        name: 'delete_lines',
        description: 'Delete specific lines from a file',
        parameters: {
          type: 'object',
          properties: {
            file_path: {
              type: 'string',
              description: 'Path to the file (relative to working directory)'
            },
            start_line: {
              type: 'number',
              description: 'Starting line number to delete (1-based)'
            },
            end_line: {
              type: 'number',
              description: 'Ending line number to delete (1-based, inclusive)'
            }
          },
          required: ['file_path', 'start_line', 'end_line']
        }
      },
      {
        name: 'search_in_files',
        description: 'Search for text patterns across multiple files',
        parameters: {
          type: 'object',
          properties: {
            pattern: {
              type: 'string',
              description: 'Text pattern to search for (supports regex)'
            },
            file_pattern: {
              type: 'string',
              description: 'File pattern to search in (e.g., "*.js", "**/*.ts")',
              default: '**/*'
            },
            case_sensitive: {
              type: 'boolean',
              description: 'Whether search should be case sensitive',
              default: false
            },
            max_results: {
              type: 'number',
              description: 'Maximum number of results to return',
              default: 50
            }
          },
          required: ['pattern']
        }
      },
      {
        name: 'create_checkpoint',
        description: 'Create a checkpoint of current file states for easy rollback',
        parameters: {
          type: 'object',
          properties: {
            checkpoint_name: {
              type: 'string',
              description: 'Name for this checkpoint'
            },
            description: {
              type: 'string',
              description: 'Description of what this checkpoint represents'
            },
            file_patterns: {
              type: 'array',
              items: { type: 'string' },
              description: 'File patterns to include in checkpoint (e.g., ["*.js", "*.ts"])',
              default: ['**/*']
            }
          },
          required: ['checkpoint_name']
        }
      },
      {
        name: 'list_checkpoints',
        description: 'List all available checkpoints',
        parameters: {
          type: 'object',
          properties: {},
          required: []
        }
      },
      {
        name: 'restore_checkpoint',
        description: 'Restore files from a previously created checkpoint',
        parameters: {
          type: 'object',
          properties: {
            checkpoint_name: {
              type: 'string',
              description: 'Name of the checkpoint to restore'
            }
          },
          required: ['checkpoint_name']
        }
      },
      {
        name: 'show_file_diff',
        description: 'Show differences between current file and a checkpoint version',
        parameters: {
          type: 'object',
          properties: {
            file_path: {
              type: 'string',
              description: 'Path to the file (relative to working directory)'
            },
            checkpoint_name: {
              type: 'string',
              description: 'Checkpoint to compare against'
            }
          },
          required: ['file_path', 'checkpoint_name']
        }
      }
    ];
  }

  async executeTool(name: string, parameters: Record<string, any>): Promise<string> {
    try {
      switch (name) {
        case 'edit_file_diff':
          return await this.editFileDiff(parameters.file_path, parameters.old_text, parameters.new_text, parameters.line_number);
        case 'insert_lines':
          return await this.insertLines(parameters.file_path, parameters.line_number, parameters.content);
        case 'delete_lines':
          return await this.deleteLines(parameters.file_path, parameters.start_line, parameters.end_line);
        case 'search_in_files':
          return await this.searchInFiles(parameters.pattern, parameters.file_pattern, parameters.case_sensitive, parameters.max_results);
        case 'create_checkpoint':
          return await this.createCheckpoint(parameters.checkpoint_name, parameters.description, parameters.file_patterns);
        case 'list_checkpoints':
          return await this.listCheckpoints();
        case 'restore_checkpoint':
          return await this.restoreCheckpoint(parameters.checkpoint_name);
        case 'show_file_diff':
          return await this.showFileDiff(parameters.file_path, parameters.checkpoint_name);
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

  private async editFileDiff(filePath: string, oldText: string, newText: string, lineNumber?: number): Promise<string> {
    const fullPath = this.resolvePath(filePath);
    const content = await fs.readFile(fullPath, 'utf-8');
    
    // Find the old text
    const index = content.indexOf(oldText);
    if (index === -1) {
      return `Error: Could not find the specified text in ${filePath}. Make sure the old_text matches exactly.`;
    }

    // Verify line number if provided
    if (lineNumber) {
      const lines = content.substring(0, index).split('\n');
      const actualLine = lines.length;
      if (Math.abs(actualLine - lineNumber) > 5) {
        return `Warning: Text found at line ${actualLine}, but expected around line ${lineNumber}. Proceeding with edit.`;
      }
    }

    // Apply the replacement
    const newContent = content.substring(0, index) + newText + content.substring(index + oldText.length);
    await fs.writeFile(fullPath, newContent, 'utf-8');

    return `Successfully applied diff edit to ${filePath}. Replaced ${oldText.length} characters with ${newText.length} characters.`;
  }

  private async insertLines(filePath: string, lineNumber: number, content: string): Promise<string> {
    const fullPath = this.resolvePath(filePath);
    const fileContent = await fs.readFile(fullPath, 'utf-8');
    const lines = fileContent.split('\n');
    
    const newLines = content.split('\n');
    lines.splice(lineNumber, 0, ...newLines);
    
    await fs.writeFile(fullPath, lines.join('\n'), 'utf-8');
    return `Inserted ${newLines.length} lines at position ${lineNumber} in ${filePath}`;
  }

  private async deleteLines(filePath: string, startLine: number, endLine: number): Promise<string> {
    const fullPath = this.resolvePath(filePath);
    const fileContent = await fs.readFile(fullPath, 'utf-8');
    const lines = fileContent.split('\n');
    
    const deletedCount = endLine - startLine + 1;
    lines.splice(startLine - 1, deletedCount);
    
    await fs.writeFile(fullPath, lines.join('\n'), 'utf-8');
    return `Deleted lines ${startLine}-${endLine} (${deletedCount} lines) from ${filePath}`;
  }

  private async searchInFiles(pattern: string, filePattern: string = '**/*', caseSensitive: boolean = false, maxResults: number = 50): Promise<string> {
    const glob = await import('glob');
    const files = await glob.glob(filePattern, { cwd: this.workingDirectory });
    
    const results: string[] = [];
    const regex = new RegExp(pattern, caseSensitive ? 'g' : 'gi');
    
    for (const file of files) {
      if (results.length >= maxResults) break;
      
      try {
        const fullPath = this.resolvePath(file);
        const stat = await fs.stat(fullPath);
        if (!stat.isFile()) continue;
        
        const content = await fs.readFile(fullPath, 'utf-8');
        const lines = content.split('\n');
        
        for (let i = 0; i < lines.length; i++) {
          if (results.length >= maxResults) break;
          
          const matches = lines[i].match(regex);
          if (matches) {
            results.push(`${file}:${i + 1}: ${lines[i].trim()}`);
          }
        }
      } catch (error) {
        // Skip files that can't be read
        continue;
      }
    }
    
    return results.length > 0 
      ? `Found ${results.length} matches:\n${results.join('\n')}`
      : `No matches found for pattern "${pattern}"`;
  }

  private async createCheckpoint(checkpointName: string, description: string = '', filePatterns: string[] = ['**/*']): Promise<string> {
    const glob = await import('glob');
    const files = new Map<string, string>();
    
    for (const pattern of filePatterns) {
      const matchedFiles = await glob.glob(pattern, { cwd: this.workingDirectory });
      
      for (const file of matchedFiles) {
        try {
          const fullPath = this.resolvePath(file);
          const stat = await fs.stat(fullPath);
          if (stat.isFile()) {
            const content = await fs.readFile(fullPath, 'utf-8');
            files.set(file, content);
          }
        } catch (error) {
          // Skip files that can't be read
          continue;
        }
      }
    }
    
    this.checkpoints.set(checkpointName, {
      files,
      timestamp: new Date(),
      description
    });
    
    return `Created checkpoint "${checkpointName}" with ${files.size} files. ${description}`;
  }

  private async listCheckpoints(): Promise<string> {
    if (this.checkpoints.size === 0) {
      return 'No checkpoints created yet.';
    }
    
    const checkpointList = Array.from(this.checkpoints.entries()).map(([name, data]) => {
      return `${name}: ${data.files.size} files, created ${data.timestamp.toISOString()}${data.description ? ` - ${data.description}` : ''}`;
    });
    
    return `Available checkpoints:\n${checkpointList.join('\n')}`;
  }

  private async restoreCheckpoint(checkpointName: string): Promise<string> {
    const checkpoint = this.checkpoints.get(checkpointName);
    if (!checkpoint) {
      return `Checkpoint "${checkpointName}" not found. Use list_checkpoints to see available checkpoints.`;
    }
    
    let restoredCount = 0;
    for (const [filePath, content] of checkpoint.files) {
      try {
        const fullPath = this.resolvePath(filePath);
        await fs.ensureDir(path.dirname(fullPath));
        await fs.writeFile(fullPath, content, 'utf-8');
        restoredCount++;
      } catch (error) {
        // Log error but continue with other files
        console.error(`Failed to restore ${filePath}:`, error);
      }
    }
    
    return `Restored ${restoredCount} files from checkpoint "${checkpointName}"`;
  }

  private async showFileDiff(filePath: string, checkpointName: string): Promise<string> {
    const checkpoint = this.checkpoints.get(checkpointName);
    if (!checkpoint) {
      return `Checkpoint "${checkpointName}" not found.`;
    }
    
    const checkpointContent = checkpoint.files.get(filePath);
    if (!checkpointContent) {
      return `File "${filePath}" not found in checkpoint "${checkpointName}"`;
    }
    
    try {
      const fullPath = this.resolvePath(filePath);
      const currentContent = await fs.readFile(fullPath, 'utf-8');
      
      // Simple diff - show if files are different
      if (currentContent === checkpointContent) {
        return `No differences between current ${filePath} and checkpoint "${checkpointName}"`;
      }
      
      const currentLines = currentContent.split('\n');
      const checkpointLines = checkpointContent.split('\n');
      
      const diff: string[] = [];
      const maxLines = Math.max(currentLines.length, checkpointLines.length);
      
      for (let i = 0; i < maxLines; i++) {
        const currentLine = currentLines[i] || '';
        const checkpointLine = checkpointLines[i] || '';
        
        if (currentLine !== checkpointLine) {
          diff.push(`Line ${i + 1}:`);
          diff.push(`  - ${checkpointLine}`);
          diff.push(`  + ${currentLine}`);
        }
      }
      
      return diff.length > 0 
        ? `Differences in ${filePath}:\n${diff.slice(0, 20).join('\n')}${diff.length > 20 ? '\n... (truncated)' : ''}`
        : `Files are different but no line-by-line differences detected (whitespace changes?)`;
        
    } catch (error) {
      return `Error reading current file ${filePath}: ${error instanceof Error ? error.message : String(error)}`;
    }
  }
}