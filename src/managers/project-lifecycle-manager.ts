import { elizaLogger as logger } from '@elizaos/core';
import * as fs from 'fs-extra';
import { LRUCache } from 'lru-cache';
import * as path from 'path';
import { PluginProject } from '../types/plugin-project';

export interface ProjectArchive {
  project: PluginProject;
  archivedAt: Date;
  archivePath: string;
}

export class ProjectLifecycleManager {
  private activeProjects = new Map<string, PluginProject>();
  private completedProjects: LRUCache<string, ProjectArchive>;
  private archiveDir: string;

  constructor(archiveDir: string) {
    this.archiveDir = archiveDir;
    this.completedProjects = new LRUCache<string, ProjectArchive>({
      max: 100, // Keep last 100 completed projects in memory
      ttl: 1000 * 60 * 60 * 24, // 24 hour TTL
      dispose: (value, key) => {
        logger.debug(`Evicting project ${key} from completed cache`);
      },
    });

    // Ensure archive directory exists
    fs.ensureDirSync(this.archiveDir);
  }

  /**
   * Add a project to active management
   */
  addProject(project: PluginProject): void {
    this.activeProjects.set(project.id, project);
    logger.info(`Added project ${project.id} to lifecycle management`);
  }

  /**
   * Get an active project
   */
  getActiveProject(projectId: string): PluginProject | undefined {
    return this.activeProjects.get(projectId);
  }

  /**
   * Get all active projects
   */
  getAllActiveProjects(): PluginProject[] {
    return Array.from(this.activeProjects.values());
  }

  /**
   * Archive a completed or failed project
   */
  async archiveProject(projectId: string): Promise<void> {
    const project = this.activeProjects.get(projectId);
    if (!project) {
      logger.warn(`Project ${projectId} not found in active projects`);
      return;
    }

    if (!['completed', 'failed'].includes(project.status)) {
      logger.warn(`Cannot archive project ${projectId} in status ${project.status}`);
      return;
    }

    try {
      // Save project data to disk
      const archivePath = await this.saveProjectArchive(project);

      // Clean up workspace
      await this.cleanupWorkspace(project);

      // Move to completed cache
      const archive: ProjectArchive = {
        project: this.sanitizeProjectForArchive(project),
        archivedAt: new Date(),
        archivePath,
      };

      this.completedProjects.set(projectId, archive);
      this.activeProjects.delete(projectId);

      logger.info(`Archived project ${projectId} to ${archivePath}`);
    } catch (error) {
      logger.error(`Failed to archive project ${projectId}:`, error);
      throw error;
    }
  }

  /**
   * Save project data to persistent storage
   */
  private async saveProjectArchive(project: PluginProject): Promise<string> {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const archiveFileName = `${project.name}-${project.id}-${timestamp}.json`;
    const archivePath = path.join(this.archiveDir, archiveFileName);

    // Prepare project data for archiving
    const archiveData = {
      ...project,
      archivedAt: new Date(),
      // Remove sensitive data
      providedSecrets: project.providedSecrets.map(() => '[REDACTED]'),
      // Limit log size
      logs: project.logs.slice(-100), // Keep only last 100 log entries
      // Convert Maps to objects for JSON serialization
      errorAnalysis: Object.fromEntries(project.errorAnalysis),
    };

    await fs.writeJson(archivePath, archiveData, { spaces: 2 });

    return archivePath;
  }

  /**
   * Clean up project workspace and temporary files
   */
  private async cleanupWorkspace(project: PluginProject): Promise<void> {
    if (!project.localPath) return;

    try {
      // Check if it's a temporary directory
      if (project.localPath.includes('temp') || project.localPath.includes('tmp')) {
        logger.info(`Removing temporary workspace: ${project.localPath}`);
        await fs.remove(project.localPath);
      } else {
        logger.info(`Preserving non-temporary workspace: ${project.localPath}`);
      }

      // Clean up any other temporary resources
      if (project.childProcess) {
        project.childProcess.kill('SIGTERM');
      }
    } catch (error) {
      logger.error(`Failed to cleanup workspace for project ${project.id}:`, error);
    }
  }

  /**
   * Sanitize project data for archiving (remove large/sensitive data)
   */
  private sanitizeProjectForArchive(project: PluginProject): PluginProject {
    return {
      ...project,
      // Clear large data
      researchReport: project.researchReport ? '[ARCHIVED]' : undefined,
      mvpPlan: project.mvpPlan ? '[ARCHIVED]' : undefined,
      fullPlan: project.fullPlan ? '[ARCHIVED]' : undefined,
      critique: project.critique ? '[ARCHIVED]' : undefined,
      // Clear process references
      childProcess: undefined,
      // Limit arrays
      logs: [],
      errors: project.errors.slice(-10),
      userNotifications: project.userNotifications.slice(-20),
    };
  }

  /**
   * Get a completed project from cache or disk
   */
  async getCompletedProject(projectId: string): Promise<PluginProject | null> {
    // Check cache first
    const cached = this.completedProjects.get(projectId);
    if (cached) {
      return cached.project;
    }

    // Search in archives
    try {
      const files = await fs.readdir(this.archiveDir);
      const projectFile = files.find((f) => f.includes(projectId));

      if (projectFile) {
        const archivePath = path.join(this.archiveDir, projectFile);
        const archiveData = await fs.readJson(archivePath);

        // Restore Maps from objects
        if (archiveData.errorAnalysis) {
          archiveData.errorAnalysis = new Map(Object.entries(archiveData.errorAnalysis));
        }

        return archiveData;
      }
    } catch (error) {
      logger.error(`Failed to load archived project ${projectId}:`, error);
    }

    return null;
  }

  /**
   * Clean up old archives based on age and disk space
   */
  async cleanupOldArchives(maxAgeDays: number = 30, maxSizeMB: number = 1000): Promise<void> {
    try {
      const files = await fs.readdir(this.archiveDir);
      const now = Date.now();
      const maxAgeMs = maxAgeDays * 24 * 60 * 60 * 1000;

      let totalSize = 0;
      const fileStats: Array<{ file: string; size: number; mtime: number }> = [];

      // Collect file stats
      for (const file of files) {
        const filePath = path.join(this.archiveDir, file);
        const stats = await fs.stat(filePath);
        fileStats.push({
          file: filePath,
          size: stats.size,
          mtime: stats.mtimeMs,
        });
        totalSize += stats.size;
      }

      // Sort by modification time (oldest first)
      fileStats.sort((a, b) => a.mtime - b.mtime);

      // Remove old files or if total size exceeds limit
      for (const { file, size, mtime } of fileStats) {
        const age = now - mtime;

        if (age > maxAgeMs || totalSize > maxSizeMB * 1024 * 1024) {
          await fs.remove(file);
          totalSize -= size;
          logger.info(`Removed old archive: ${path.basename(file)}`);
        }
      }
    } catch (error) {
      logger.error('Failed to cleanup old archives:', error);
    }
  }

  /**
   * Get statistics about managed projects
   */
  getStatistics(): {
    activeCount: number;
    completedCount: number;
    failedCount: number;
    memoryUsage: number;
  } {
    const active = Array.from(this.activeProjects.values());
    const completed = Array.from(this.completedProjects.values());

    return {
      activeCount: active.length,
      completedCount: completed.filter((a) => a.project.status === 'completed').length,
      failedCount: completed.filter((a) => a.project.status === 'failed').length,
      memoryUsage: process.memoryUsage().heapUsed,
    };
  }
}
