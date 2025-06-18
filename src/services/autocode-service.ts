import { Service, type IAgentRuntime, type UUID, elizaLogger as logger } from '@elizaos/core';
import { OrchestrationManager } from '../managers/orchestration-manager';
import { ComponentCreationManager, ComponentType } from '../managers/component-creation-manager';
import { DynamicLoaderManager } from '../managers/dynamic-loader-manager';
import type { PluginProject, DevelopmentPhase } from '../types/plugin-project';
import type {
  ComponentCreationOptions,
  ComponentCreationResult,
} from '../managers/component-creation-manager';
import type { DynamicLoadOptions, DynamicLoadResult } from '../managers/dynamic-loader-manager';

/**
 * Main service for automated code generation and plugin development
 * This is the discoverable service that provides all autocoding capabilities
 */
export class AutoCodeService extends Service {
  static serviceType = 'autocoder';
  static serviceName = 'autocoder';

  public capabilityDescription =
    'Advanced plugin development service with automated code generation, dependency management, testing, and self-healing capabilities';

  private orchestrationManager: OrchestrationManager;
  private componentCreationManager: ComponentCreationManager;
  private dynamicLoaderManager: DynamicLoaderManager;

  public static async start(runtime: IAgentRuntime): Promise<AutoCodeService> {
    const service = new AutoCodeService(runtime);
    await service.orchestrationManager.initialize();
    return service;
  }

  constructor(runtime: IAgentRuntime) {
    super();
    this.orchestrationManager = new OrchestrationManager(runtime);
    this.componentCreationManager = new ComponentCreationManager();
    this.dynamicLoaderManager = new DynamicLoaderManager();
    logger.info('AutoCodeService initialized');
  }

  async stop(): Promise<void> {
    logger.info('AutoCodeService stopped');
  }

  // ===== Orchestration Methods (delegated to OrchestrationManager) =====

  /**
   * Create a new plugin development project
   */
  public async createPluginProject(
    name: string,
    description: string,
    userId: UUID,
    conversationId?: UUID
  ): Promise<PluginProject> {
    return this.orchestrationManager.createPluginProject(name, description, userId, conversationId);
  }

  /**
   * Update an existing plugin project
   */
  public async updatePluginProject(
    name: string,
    description: string,
    userId: UUID,
    conversationId?: UUID
  ): Promise<PluginProject> {
    return this.orchestrationManager.updatePluginProject(name, description, userId, conversationId);
  }

  /**
   * Get a project by ID
   */
  public async getProject(projectId: string): Promise<PluginProject | null> {
    return this.orchestrationManager.getProject(projectId);
  }

  /**
   * Get all projects
   */
  public async getAllProjects(): Promise<PluginProject[]> {
    return this.orchestrationManager.getAllProjects();
  }

  /**
   * Get active projects
   */
  public async getActiveProjects(): Promise<PluginProject[]> {
    return this.orchestrationManager.getActiveProjects();
  }

  /**
   * Get projects by user
   */
  public async getProjectsByUser(userId: UUID): Promise<PluginProject[]> {
    return this.orchestrationManager.getProjectsByUser(userId);
  }

  /**
   * Provide secrets to a project
   */
  public async provideSecrets(projectId: string, secrets: Record<string, string>): Promise<void> {
    return this.orchestrationManager.provideSecrets(projectId, secrets);
  }

  /**
   * Cancel a project
   */
  public async cancelProject(projectId: string): Promise<void> {
    return this.orchestrationManager.cancelProject(projectId);
  }

  /**
   * Set infinite mode for a project
   */
  public async setInfiniteMode(projectId: string, enabled: boolean): Promise<void> {
    return this.orchestrationManager.setInfiniteMode(projectId, enabled);
  }

  /**
   * Add custom instructions to a project
   */
  public async addCustomInstructions(projectId: string, instructions: string[]): Promise<void> {
    return this.orchestrationManager.addCustomInstructions(projectId, instructions);
  }

  /**
   * Add user feedback to a project
   */
  public async addUserFeedback(projectId: string, feedback: string): Promise<void> {
    return this.orchestrationManager.addUserFeedback(projectId, feedback);
  }

  // ===== Component Creation Methods (delegated to ComponentCreationManager) =====

  /**
   * Create a new component
   */
  public async createComponent(
    options: ComponentCreationOptions
  ): Promise<ComponentCreationResult> {
    return this.componentCreationManager.createComponent(options);
  }

  // ===== Dynamic Loading Methods (delegated to DynamicLoaderManager) =====

  /**
   * Load a component dynamically
   */
  public async loadComponent(options: {
    filePath: string;
    componentType: ComponentType;
  }): Promise<DynamicLoadResult> {
    return this.dynamicLoaderManager.loadComponent({
      ...options,
      runtimeServices: new Map(),
      sandboxed: false,
    });
  }

  // ===== Methods for E2E tests =====

  /**
   * Run discovery phase for a project
   */
  public async runDiscoveryPhase(projectId: string, searchTerms: string[]): Promise<void> {
    const project = await this.getProject(projectId);
    if (!project) {
      throw new Error(`Project ${projectId} not found`);
    }

    logger.info(
      `Running discovery phase for project ${projectId} with terms: ${searchTerms.join(', ')}`
    );
    // This would normally trigger the orchestration manager to run discovery
    // For now, we just log it
  }

  /**
   * Run development phase for a project
   */
  public async runDevelopmentPhase(projectId: string): Promise<void> {
    const project = await this.getProject(projectId);
    if (!project) {
      throw new Error(`Project ${projectId} not found`);
    }

    logger.info(`Running development phase for project ${projectId}`);
    // This would normally trigger the orchestration manager to run development
    // For now, we just log it
  }

  /**
   * Transition project to a new phase
   */
  public async transitionProjectPhase(
    projectId: string,
    newPhase: DevelopmentPhase
  ): Promise<void> {
    const project = await this.getProject(projectId);
    if (!project) {
      throw new Error(`Project ${projectId} not found`);
    }

    // Use the orchestration manager's internal method
    // This is a simplified version for now
    project.status = newPhase;
    project.updatedAt = new Date();
    logger.info(`Transitioned project ${projectId} to phase ${newPhase}`);
  }
}
