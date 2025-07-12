export interface SandboxConfig {
  template?: string;
  name?: string;
  description?: string;
  environment?: Record<string, string>;
  startCommand?: string;
  port?: number;
  domain?: string;
}

export interface Sandbox {
  id: string;
  name: string;
  url: string;
  status: 'creating' | 'running' | 'stopped' | 'error';
  provider: string;
  template: string;
  createdAt: Date;
  updatedAt: Date;
  metadata?: Record<string, any>;
}

export interface FileMap {
  [path: string]: string | Buffer | null; // null indicates file deletion
}

export interface SandboxProvider {
  name: string;
  createSandbox(config: SandboxConfig): Promise<Sandbox>;
  deploySandbox(sandbox: Sandbox, files: FileMap): Promise<string>;
  getSandbox(id: string): Promise<Sandbox>;
  deleteSandbox(id: string): Promise<void>;
  syncFiles(id: string, files: FileMap): Promise<void>;
  listSandboxes(): Promise<Sandbox[]>;
  getTemplates(): Promise<string[]>;
}

export interface SandboxTemplate {
  id: string;
  name: string;
  description: string;
  provider: string;
  template: string;
  startCommand?: string;
  port?: number;
  environment?: Record<string, string>;
  filePatterns?: string[];
}

export interface DeploymentResult {
  sandbox: Sandbox;
  url: string;
  filesUploaded: number;
  deploymentTime: number;
}

export interface SyncResult {
  filesUpdated: number;
  filesDeleted: number;
  syncTime: number;
}