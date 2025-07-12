import * as fs from 'fs';
import * as path from 'path';
import * as chokidar from 'chokidar';
import { glob } from 'glob';

export interface WatchConfig {
  watchPatterns: string[];
  ignorePatterns: string[];
  onFileChange: (changedFiles: string[]) => Promise<void>;
}

export interface SandboxWatchInfo {
  sandboxId: string;
  watcher: chokidar.FSWatcher;
  watchPatterns: string[];
  ignorePatterns: string[];
  lastSync?: Date;
  filesSynced: number;
  config: WatchConfig;
}

export interface WatchStatus {
  activeSandboxes: {
    sandboxId: string;
    watchPatterns: string[];
    ignorePatterns: string[];
    lastSync?: Date;
    filesSynced: number;
  }[];
}

export class FileWatcher {
  private watchers: Map<string, SandboxWatchInfo> = new Map();
  private workingDirectory: string;
  private pendingChanges: Map<string, Set<string>> = new Map();
  private syncTimers: Map<string, NodeJS.Timeout> = new Map();
  private readonly SYNC_DEBOUNCE_MS = 1000; // Wait 1 second after last change before syncing

  constructor(workingDirectory: string) {
    this.workingDirectory = workingDirectory;
  }

  async startWatching(sandboxId: string, config: WatchConfig): Promise<void> {
    // Stop existing watcher for this sandbox if it exists
    if (this.watchers.has(sandboxId)) {
      await this.stopWatching(sandboxId);
    }

    // Create a new watcher
    const watcher = chokidar.watch(config.watchPatterns, {
      cwd: this.workingDirectory,
      ignored: config.ignorePatterns,
      ignoreInitial: true,
      persistent: true,
      awaitWriteFinish: {
        stabilityThreshold: 100,
        pollInterval: 50
      }
    });

    const watchInfo: SandboxWatchInfo = {
      sandboxId,
      watcher,
      watchPatterns: config.watchPatterns,
      ignorePatterns: config.ignorePatterns,
      filesSynced: 0,
      config
    };

    // Set up file change handlers
    const handleFileChange = (filePath: string) => {
      this.queueFileForSync(sandboxId, filePath);
    };

    watcher.on('add', handleFileChange);
    watcher.on('change', handleFileChange);
    watcher.on('unlink', handleFileChange);
    watcher.on('addDir', handleFileChange);
    watcher.on('unlinkDir', handleFileChange);

    watcher.on('error', (error) => {
      console.error(`File watcher error for sandbox ${sandboxId}:`, error);
    });

    this.watchers.set(sandboxId, watchInfo);
    console.log(`🔄 Started watching files for sandbox ${sandboxId}`);
  }

  async stopWatching(sandboxId: string): Promise<void> {
    const watchInfo = this.watchers.get(sandboxId);
    if (!watchInfo) {
      return;
    }

    // Clear any pending sync timer
    const timer = this.syncTimers.get(sandboxId);
    if (timer) {
      clearTimeout(timer);
      this.syncTimers.delete(sandboxId);
    }

    // Close the watcher
    await watchInfo.watcher.close();
    
    // Clean up
    this.watchers.delete(sandboxId);
    this.pendingChanges.delete(sandboxId);
    
    console.log(`⏹️ Stopped watching files for sandbox ${sandboxId}`);
  }

  async stopAllWatching(): Promise<void> {
    const sandboxIds = Array.from(this.watchers.keys());
    
    for (const sandboxId of sandboxIds) {
      await this.stopWatching(sandboxId);
    }
    
    console.log('⏹️ Stopped all file watchers');
  }

  getStatus(): WatchStatus {
    const activeSandboxes = Array.from(this.watchers.values()).map(info => ({
      sandboxId: info.sandboxId,
      watchPatterns: info.watchPatterns,
      ignorePatterns: info.ignorePatterns,
      lastSync: info.lastSync,
      filesSynced: info.filesSynced
    }));

    return { activeSandboxes };
  }

  private queueFileForSync(sandboxId: string, filePath: string): void {
    // Initialize pending changes for this sandbox if not exists
    if (!this.pendingChanges.has(sandboxId)) {
      this.pendingChanges.set(sandboxId, new Set());
    }

    // Add file to pending changes
    this.pendingChanges.get(sandboxId)!.add(filePath);

    // Clear existing timer
    const existingTimer = this.syncTimers.get(sandboxId);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    // Set new debounced timer
    const timer = setTimeout(() => {
      this.processPendingChanges(sandboxId);
    }, this.SYNC_DEBOUNCE_MS);

    this.syncTimers.set(sandboxId, timer);
  }

  private async processPendingChanges(sandboxId: string): Promise<void> {
    const watchInfo = this.watchers.get(sandboxId);
    const pendingFiles = this.pendingChanges.get(sandboxId);

    if (!watchInfo || !pendingFiles || pendingFiles.size === 0) {
      return;
    }

    try {
      const changedFiles = Array.from(pendingFiles);
      console.log(`🔄 Syncing ${changedFiles.length} changed file(s) to sandbox ${sandboxId}`);

      // Call the onFileChange callback
      await watchInfo.config.onFileChange(changedFiles);

      // Update stats
      watchInfo.lastSync = new Date();
      watchInfo.filesSynced += changedFiles.length;

      console.log(`✅ Successfully synced files to sandbox ${sandboxId}`);
    } catch (error) {
      console.error(`❌ Failed to sync files to sandbox ${sandboxId}:`, error);
    } finally {
      // Clear pending changes
      this.pendingChanges.delete(sandboxId);
      this.syncTimers.delete(sandboxId);
    }
  }

  // Helper method to get all files matching patterns (useful for initial sync)
  async getMatchingFiles(watchPatterns: string[], ignorePatterns: string[]): Promise<string[]> {
    const allFiles: string[] = [];

    for (const pattern of watchPatterns) {
      try {
        const files = await glob(pattern, {
          cwd: this.workingDirectory,
          ignore: ignorePatterns,
          nodir: true
        });
        allFiles.push(...files);
      } catch (error) {
        console.warn(`Warning: Failed to glob pattern ${pattern}:`, error);
      }
    }

    // Remove duplicates and return
    return Array.from(new Set(allFiles));
  }
}