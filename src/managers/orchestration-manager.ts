import Anthropic from '@anthropic-ai/sdk';
import { elizaLogger as logger, type IAgentRuntime, type UUID } from '@elizaos/core';
import { EnhancedSecretManager, type SecretContext } from '@elizaos/plugin-secrets-manager';
import fs from 'fs-extra';
import path from 'path';
import { promisify } from 'util';
import type {
  KnowledgeService,
  PluginManagerService,
  ResearchProject,
  ResearchService,
} from '../types/external-plugins';
import type {
  PluginProject,
  DevelopmentPhase,
  CheckResult,
  ErrorAnalysis,
  UserNotification,
} from '../types/plugin-project';
import { createSafeCommand } from '../utils/command-sanitizer';
import { anthropicRetryConfig, withRetry } from '../utils/retry-helper';
import { CodeHealingManager } from './code-healing-manager';
import { ComponentCreationManager, ComponentType } from './component-creation-manager';
import { DependencyManager } from './dependency-manager';
import { DetailedLogger } from './detailed-logger';
import { ProjectLifecycleManager } from './project-lifecycle-manager';
import { ServiceDiscoveryManager } from './service-discovery-manager';
import { WorkflowStateMachine } from './workflow-state-machine';
import { ContinuousVerificationManager } from '../verification/continuous-verification-manager';
import { MultiStageAIReviewer, type ComprehensiveReview } from '../review/multi-stage-ai-reviewer';
import type { Code, VerificationContext } from '../verification/types';

const execAsync = promisify(require('child_process').exec);

/**
 * Claude model configuration
 */
export const ClaudeModel = {
  SONNET_4: 'claude-sonnet-4-20250514',
  OPUS_4: 'claude-opus-4-20250514',
} as const;

export type ClaudeModel = (typeof ClaudeModel)[keyof typeof ClaudeModel];

/**
 * The main orchestration manager for the autocoder plugin.
 * This manager handles the entire lifecycle of creating and updating plugins.
 */
export class OrchestrationManager {
  private runtime: IAgentRuntime;
  private projects: Map<string, PluginProject> = new Map();
  private anthropic: Anthropic | null = null;
  private selectedModel: ClaudeModel = ClaudeModel.OPUS_4;
  private serviceDiscovery: ServiceDiscoveryManager | null = null;
  private dependencyManager: DependencyManager | null = null;
  private componentCreation: ComponentCreationManager | null = null;
  private workflowStateMachine: typeof WorkflowStateMachine;
  private lifecycleManager: ProjectLifecycleManager;
  private detailedLogger: DetailedLogger;
  private codeHealingService: CodeHealingManager | null = null;
  private secretsManager: EnhancedSecretManager | null = null;
  private pluginEventHandler: ((event: any) => void) | null = null;
  private verificationManager: ContinuousVerificationManager;
  private aiReviewer: MultiStageAIReviewer | null = null;

  constructor(runtime: IAgentRuntime) {
    this.runtime = runtime;
    this.workflowStateMachine = WorkflowStateMachine;
    const dataDir = this.getDataDir();
    this.lifecycleManager = new ProjectLifecycleManager(path.join(dataDir, 'archives'));
    this.detailedLogger = new DetailedLogger(path.join(dataDir, 'logs'));
  }

  async initialize(): Promise<void> {
    // Initialize secrets manager
    this.secretsManager = this.runtime.getService('SECRETS') as EnhancedSecretManager;
    if (!this.secretsManager) {
      logger.warn('Secrets Manager service not available - using fallback to runtime.getSetting');
    }

    // Get API key through secrets manager
    const apiKey = await this.getAnthropicApiKey();
    if (apiKey) {
      this.anthropic = new Anthropic({ apiKey });
      this.aiReviewer = new MultiStageAIReviewer(apiKey);
    } else {
      logger.warn('ANTHROPIC_API_KEY not configured - some functionality may be limited');
    }

    // Initialize managers
    this.serviceDiscovery = new ServiceDiscoveryManager(this.runtime);
    this.dependencyManager = new DependencyManager();
    this.componentCreation = new ComponentCreationManager();
    this.codeHealingService = new CodeHealingManager();
    this.verificationManager = new ContinuousVerificationManager({
      failFast: false, // Don't fail fast in autocoder - try to fix issues
      autoFix: true,   // Enable auto-fix for simple issues
      criticalOnly: false, // Run all validators
    });

    logger.info('OrchestrationManager initialized');

    // Setup plugin event handlers
    this.setupPluginEventHandlers();
  }

  /**
   * Setup plugin lifecycle event handlers
   */
  private setupPluginEventHandlers(): void {
    this.pluginEventHandler = (event) => {
      switch (event.type) {
        case 'PLUGIN_LOADED':
          this.onPluginLoaded(event.pluginId, event.plugin);
          break;
          
        case 'PLUGIN_UNLOADED':
          this.onPluginUnloaded(event.pluginId);
          break;
          
        case 'PLUGIN_CONFIGURATION_COMPLETED':
          this.onPluginConfigured(event.pluginId, event.config);
          break;
          
        case 'PLUGIN_ERROR':
          this.onPluginError(event.pluginId, event.error);
          break;
      }
    };
    
    // Register event handler with Plugin Manager
    const pluginManager = this.runtime.getService('PLUGIN_MANAGER') as PluginManagerService;
    if (pluginManager && typeof pluginManager.addEventListener === 'function') {
      pluginManager.addEventListener('*', this.pluginEventHandler);
    }
  }

  /**
   * Handle plugin loaded event
   */
  private onPluginLoaded(pluginId: string, plugin: any): void {
    // Update all active projects that might benefit from this plugin
    for (const [projectId, project] of this.projects) {
      if (project.status === 'researching' || project.status === 'mvp_development' || project.status === 'full_development') {
        this.logToProject(projectId, `🔌 New plugin available: ${plugin.name}`);
        
        // Check if this plugin might be useful for the project
        const searchTerms = this.extractSearchTerms(project.name, project.description);
        if (this.isPluginCompatible(plugin, searchTerms)) {
          project.discoveredPlugins = project.discoveredPlugins || [];
          project.discoveredPlugins.push({
            name: plugin.name,
            description: plugin.description,
            source: 'loaded',
            relevance: 1.0,
            installed: true,
            capabilities: plugin.actions?.map((a: any) => a.name) || []
          });
        }
      }
    }
  }

  /**
   * Handle plugin unloaded event
   */
  private onPluginUnloaded(pluginId: string): void {
    // Notify projects that were using this plugin
    for (const [projectId, project] of this.projects) {
      if (project.discoveredPlugins?.some(p => p.name === pluginId)) {
        this.logToProject(projectId, `⚠️ Plugin ${pluginId} has been unloaded`);
      }
    }
  }

  /**
   * Handle plugin configured event
   */
  private onPluginConfigured(pluginId: string, config: any): void {
    // Update projects waiting for this plugin configuration
    for (const [projectId, project] of this.projects) {
      const pendingConfig = project.pendingConfigurations?.find(c => 
        c.pluginName === pluginId
      );
      
      if (pendingConfig) {
        this.logToProject(projectId, `✅ Plugin ${pluginId} configuration completed`);
        project.pendingConfigurations = project.pendingConfigurations?.filter(c => 
          c.pluginName !== pluginId
        );
        
        // Check if project can now proceed
        if (project.pendingConfigurations?.length === 0) {
          this.logToProject(projectId, '🚀 All plugins configured - ready to proceed');
          // Resume the workflow if it was waiting
          if (project.status === 'awaiting-secrets') {
            // Will be handled by provideSecrets method
          }
        }
      }
    }
  }

  /**
   * Handle plugin error event
   */
  private onPluginError(pluginId: string, error: any): void {
    // Notify projects using this plugin
    for (const [projectId, project] of this.projects) {
      if (project.discoveredPlugins?.some(p => p.name === pluginId)) {
        this.logToProject(projectId, `❌ Plugin ${pluginId} error: ${error.message || error}`);
      }
    }
  }

  async stop(): Promise<void> {
    // Unregister plugin event handler
    if (this.pluginEventHandler) {
      const pluginManager = this.runtime.getService('PLUGIN_MANAGER') as PluginManagerService;
      if (pluginManager && typeof pluginManager.removeEventListener === 'function') {
        pluginManager.removeEventListener('*', this.pluginEventHandler);
      }
    }

    for (const project of this.projects.values()) {
      if (project.status !== 'completed' && project.status !== 'failed') {
        // Await cancellation to ensure cleanup
        await this.cancelProject(project.id);
      }
    }
    logger.info('OrchestrationManager stopped and all active projects cancelled.');
  }

  async cancelProject(projectId: string): Promise<void> {
    const project = this.projects.get(projectId);
    if (project) {
      project.status = 'failed';
      project.error = 'Cancelled by system shutdown.';
      if (project.childProcess) {
        project.childProcess.kill('SIGTERM');
      }
      this.projects.set(projectId, project);
    }
  }

  /**
   * Get secret context for secrets manager operations
   */
  private getSecretContext(): SecretContext {
    return {
      level: 'global',
      agentId: this.runtime.agentId,
      requesterId: this.runtime.agentId
    };
  }

  /**
   * Get Anthropic API key through secrets manager with fallback
   */
  private async getAnthropicApiKey(): Promise<string | null> {
    if (this.secretsManager) {
      try {
        const apiKey = await this.secretsManager.get('ANTHROPIC_API_KEY', this.getSecretContext());
        if (apiKey) {
          return apiKey;
        }
      } catch (error) {
        logger.warn('[AutoCoder] Failed to get ANTHROPIC_API_KEY from secrets manager:', error);
      }
    }

    // Fallback to runtime settings
    const fallbackKey = this.runtime.getSetting('ANTHROPIC_API_KEY');
    if (fallbackKey) {
      logger.warn('[AutoCoder] Using fallback API key from runtime settings');
      return fallbackKey;
    }

    return null;
  }

  /**
   * Infer secret type from key name
   */
  private inferSecretType(key: string): 'api_key' | 'private_key' | 'public_key' | 'url' | 'credential' | 'config' | 'secret' {
    const lowerKey = key.toLowerCase();
    
    if (lowerKey.includes('api_key') || lowerKey.includes('api-key')) return 'api_key';
    if (lowerKey.includes('private_key')) return 'private_key';
    if (lowerKey.includes('public_key')) return 'public_key';
    if (lowerKey.includes('token')) return 'credential';
    if (lowerKey.includes('url') || lowerKey.includes('endpoint')) return 'url';
    if (lowerKey.includes('secret')) return 'secret';
    
    return 'config';
  }

  /**
   * Validate secret value
   */
  private validateSecret(key: string, value: string): boolean {
    const secretType = this.inferSecretType(key);
    
    switch (secretType) {
      case 'api_key':
        return value.length > 10 && !value.includes(' ');
      case 'url':
        try {
          new URL(value);
          return true;
        } catch {
          return false;
        }
      default:
        return value.length > 0;
    }
  }

  /**
   * Check if a plugin is compatible with the search terms
   */
  private isPluginCompatible(plugin: any, searchTerms: string[]): boolean {
    const pluginText = (
      plugin.name + ' ' + 
      (plugin.description || '') + ' ' +
      (plugin.packageJson?.description || '') + ' ' +
      (plugin.packageJson?.keywords || []).join(' ')
    ).toLowerCase();

    return searchTerms.some(term => 
      pluginText.includes(term.toLowerCase())
    );
  }

  public async createPluginProject(
    name: string,
    description: string,
    userId: UUID,
    conversationId?: UUID
  ): Promise<PluginProject> {
    const project: PluginProject = {
      id: `project-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      name,
      description,
      type: 'create',
      status: 'idle',
      phaseHistory: ['idle'],
      totalPhases: 18, // Based on the 18 steps in the plan
      phase: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
      userId,
      conversationId,
      logs: [],
      errors: [],
      userNotifications: [],
      knowledgeIds: [],
      requiredSecrets: [],
      providedSecrets: [],
      currentIteration: 0,
      maxIterations: 5,
      infiniteMode: false,
      customInstructions: [],
      errorAnalysis: new Map(),
    };

    this.projects.set(project.id, project);
    this.logToProject(project.id, `Project created for user ${userId}.`);

    // Log initial project creation
    this.detailedLogger.log({
      type: 'action',
      phase: 'creation',
      metadata: {
        projectId: project.id,
        projectName: name,
        userId: userId,
        actionName: 'createPluginProject',
      },
      data: {
        name,
        description,
        type: 'create',
      },
    });

    // Start workflow asynchronously
    (async () => {
      try {
        await this.startCreationWorkflow(project.id);
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        await this.updateProjectStatus(project.id, 'failed', errorMessage);
      }
    })();

    return project;
  }

  public async updatePluginProject(
    githubRepo: string,
    updateDescription: string,
    userId: UUID,
    conversationId?: UUID
  ): Promise<PluginProject> {
    const project: PluginProject = {
      id: `project-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      name: path.basename(githubRepo),
      description: updateDescription,
      type: 'update',
      status: 'idle',
      phaseHistory: ['idle'],
      totalPhases: 11, // Update workflow has fewer phases
      phase: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
      userId,
      conversationId,
      githubRepo,
      logs: [],
      errors: [],
      userNotifications: [],
      knowledgeIds: [],
      requiredSecrets: [],
      providedSecrets: [],
      currentIteration: 0,
      maxIterations: 5,
      infiniteMode: false,
      customInstructions: [],
      errorAnalysis: new Map(),
    };

    this.projects.set(project.id, project);
    this.logToProject(project.id, `Update project created for ${githubRepo}`);

    // Log initial project creation
    this.detailedLogger.log({
      type: 'action',
      phase: 'creation',
      metadata: {
        projectId: project.id,
        projectName: project.name,
        userId: userId,
        actionName: 'updatePluginProject',
      },
      data: {
        githubRepo,
        updateDescription,
        type: 'update',
      },
    });

    // Start update workflow asynchronously
    (async () => {
      try {
        await this.startUpdateWorkflow(project.id);
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        await this.updateProjectStatus(project.id, 'failed', errorMessage);
      }
    })();

    return project;
  }

  /**
   * Create a standalone component without a full plugin project
   */
  public async createComponent(options: {
    type: ComponentType;
    name: string;
    description: string;
    targetPlugin?: string;
    dependencies?: string[];
    customInstructions?: string[];
  }): Promise<any> {
    if (!this.componentCreation) {
      throw new Error('Component creation service not initialized');
    }

    // Log component creation
    this.detailedLogger.log({
      type: 'action',
      phase: 'creation',
      metadata: {
        actionName: 'createComponent',
        componentType: options.type,
        componentName: options.name,
      },
      data: options,
    });

    const result = await this.componentCreation.createComponent(options);

    // Log result
    this.detailedLogger.log({
      type: 'response',
      phase: 'creation',
      metadata: {
        actionName: 'createComponent',
        success: true,
        componentType: options.type,
        componentName: options.name,
      },
      data: result,
    });

    return result;
  }

  private async startCreationWorkflow(projectId: string): Promise<void> {
    const project = this.projects.get(projectId);
    if (!project) return;

    this.logToProject(projectId, '🚀 Starting 18-step plugin creation workflow...');

    try {
      // STEP 1: Research Phase - Use research plugins to find dependencies, similar code, npm packages, GitHub repos, docs
      this.logToProject(projectId, '📚 STEP 1: Starting research phase...');
      await this.executeResearchPhase(projectId);

      // STEP 2: Plan MVP proof of concept
      this.logToProject(projectId, '📝 STEP 2: Planning MVP proof of concept...');
      await this.executeMVPPlanningPhase(projectId);

      // STEP 3: Clone plugin-starter template (done in executeMVPDevelopmentPhase)
      this.logToProject(projectId, '📁 STEP 3: Cloning plugin-starter template...');
      
      // STEP 4-8: MVP Development Loop with checks after each step
      this.logToProject(projectId, '🔨 STEP 4-8: Starting MVP development with iterative checks...');
      await this.executeMVPDevelopmentPhase(projectId);
      
      // After MVP development, we should be in mvp_testing phase
      // Now move to full implementation
      
      // STEP 9: Plan full implementation of the plugin
      this.logToProject(projectId, '📋 STEP 9: Planning full implementation...');
      await this.executeFullPlanningPhase(projectId);

      // STEP 10-14: Full Development Loop with checks after each step
      this.logToProject(projectId, '🏗️ STEP 10-14: Starting full development with iterative checks...');
      await this.executeFullDevelopmentPhase(projectId);
      
      // STEP 15-18: Critical Review and Gaslighting Loop
      this.logToProject(projectId, '🔍 STEP 15: Starting critical review phase...');
      await this.executeCriticalReviewPhase(projectId);
      
      // If we made it here, the plugin is production ready!
      await this.updateProjectStatus(projectId, 'completed');
      this.logToProject(projectId, '✅ Plugin creation workflow completed successfully!');
      
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.logToProject(projectId, `❌ Workflow failed: ${errorMessage}`);
      await this.updateProjectStatus(projectId, 'failed', errorMessage);
    }
  }

  private async startUpdateWorkflow(projectId: string): Promise<void> {
    const project = this.projects.get(projectId);
    if (!project) return;

    this.logToProject(projectId, '🚀 Starting 13-step plugin update workflow...');

    try {
      // STEP 1: Research Phase - Research dependencies, similar code, API docs, etc
      this.logToProject(projectId, '📚 STEP 1: Starting research phase for update...');
      await this.executeResearchPhase(projectId);

      // STEP 2: Plan full implementation of the plugin update
      this.logToProject(projectId, '📋 STEP 2: Planning full implementation...');
      await this.executeFullPlanningPhase(projectId);

      // Clone the existing repo if needed
      if (project.githubRepo) {
        this.logToProject(projectId, '📥 Cloning existing repository...');
        project.localPath = path.join(this.getDataDir(), 'plugins', project.id);
        await this.cloneGithubRepo(project);
      }

      // STEP 3-7: Full Development Loop with checks
      this.logToProject(projectId, '🏗️ STEP 3-7: Starting full development with iterative checks...');
      // STEP 3: Implement full production code
      // STEP 4: Run tsc and fix all linter errors until passing
      // STEP 5: Run eslint and fix all linter errors until passing
      // STEP 6: Run 'bun run build' and fix all issues until passing
      // STEP 7: Run 'elizaos test' and fix all issues until passing
      await this.executeFullDevelopmentPhase(projectId);

      // STEP 8-13: Gaslighting and Critical Review Loop
      this.logToProject(projectId, '🔥 STEP 8: Starting gaslighting phase with scathing review...');
      await this.executeUpdateCriticalReviewPhase(projectId);

      // If we made it here, the plugin update is production ready!
      await this.updateProjectStatus(projectId, 'completed');
      this.logToProject(projectId, '✅ Plugin update workflow completed successfully!');

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.logToProject(projectId, `❌ Update workflow failed: ${errorMessage}`);
      await this.updateProjectStatus(projectId, 'failed', errorMessage);
    }
  }

  /**
   * Clone GitHub repository for update workflow
   */
  private async cloneGithubRepo(project: PluginProject): Promise<void> {
    if (!project.githubRepo || !project.localPath) {
      throw new Error('GitHub repo URL and local path required for cloning');
    }

    await fs.ensureDir(project.localPath);

    try {
      await this.runCommand(
        project,
        'git',
        ['clone', project.githubRepo, '.'],
        'Cloning repository'
      );

      // Create a new branch for the update
      const branchName = `update-${Date.now()}`;
      await this.runCommand(
        project,
        'git',
        ['checkout', '-b', branchName],
        'Creating update branch'
      );

      project.branch = branchName;
      this.projects.set(project.id, project);

    } catch (error) {
      throw new Error(`Failed to clone repository: ${error.message}`);
    }
  }

  /**
   * STEP 8-13: Update-specific critical review phase
   */
  private async executeUpdateCriticalReviewPhase(projectId: string): Promise<void> {
    const project = this.projects.get(projectId);
    if (!project) return;

    await this.updateProjectStatus(projectId, 'self_critique');
    this.logToProject(projectId, '🔥 Starting UPDATE CRITICAL REVIEW phase...');

    let isProductionReady = false;
    let reviewIterations = 0;
    const maxReviewIterations = 3;

    while (!isProductionReady && reviewIterations < maxReviewIterations) {
      reviewIterations++;
      this.logToProject(projectId, `\n🎭 GASLIGHTING ITERATION ${reviewIterations} - Writing scathing update review...`);

      try {
        // STEP 8: Gaslight by writing scathing review
        const critique = await this.generateUpdateScathingReview(project);
        project.critique = critique;
        this.projects.set(projectId, project);

        // Check if the AI reviewer thinks it's production ready
        if (this.aiReviewer) {
          const code = await this.loadProjectCode(project);
          const context = this.buildVerificationContext(project);
          const aiReview = await this.aiReviewer.reviewCode(code, context);

          this.logToProject(
            projectId,
            `🤖 AI Review Score: ${aiReview.overallScore}/100, Production Ready: ${aiReview.productionReady}`
          );

          if (aiReview.productionReady && aiReview.overallScore >= 85) {
            isProductionReady = true;
            this.logToProject(projectId, '✅ Update is FINALLY production ready!');
            break;
          }

          // Log critical issues
          this.logToProject(projectId, `❌ NOT production ready - ${aiReview.criticalIssues.length} critical issues found`);
        }

        // STEP 9-12: New implementation and loop
        await this.updateProjectStatus(projectId, 'revision');
        this.logToProject(projectId, '📝 STEP 9: Demanding new implementation plan...');
        
        await this.generateRevisionPlan(project, critique);
        
        // STEP 10-13: Loop through development steps again
        this.logToProject(projectId, '🔄 STEP 10-13: Re-executing development with improvements...');
        await this.runDevelopmentLoop(project, 'full');

      } catch (error) {
        this.logToProject(project.id, `❌ Critical review failed: ${error.message}`);
        throw error;
      }
    }

    if (!isProductionReady) {
      throw new Error(`Failed to achieve production quality after ${maxReviewIterations} review iterations`);
    }

    // STEP 13: Generate critical review and validate production quality
    this.logToProject(projectId, '📊 STEP 13: Final production quality validation...');
    await this.updateProjectStatus(projectId, 'publishing');
  }

  /**
   * Generate update-specific scathing review
   */
  private async generateUpdateScathingReview(project: PluginProject): Promise<string> {
    if (!this.anthropic) {
      throw new Error('AI review requires an ANTHROPIC_API_KEY');
    }

    const prompt = `You are an EXTREMELY CRITICAL code reviewer examining an UPDATE to the "${project.name}" plugin.

**Update Description:** ${project.description}
**Original Repository:** ${project.githubRepo || 'N/A'}

Your job is to be ABSOLUTELY RUTHLESS in your critique. Find EVERY possible flaw:

1. Did they break backward compatibility?
2. Are all the original features still working?
3. Did they add comprehensive tests for new features?
4. Is the update actually an improvement or just change for change's sake?
5. Are there performance regressions?
6. Is the documentation updated?
7. Are there security implications?
8. Does it follow the same patterns as the original?
9. Are edge cases properly handled?
10. Is this truly production-ready?

Write a DEVASTATING review that demands PERFECTION. Start with:
"This update is ABSOLUTELY UNACCEPTABLE. Here's what's wrong:"`;

    const response = await withRetry(
      () => this.anthropic!.messages.create({
        model: this.selectedModel,
        max_tokens: 4000,
        temperature: 0.8,
        messages: [{ role: 'user', content: prompt }],
      }),
      anthropicRetryConfig
    );

    return response.content[0].type === 'text' ? response.content[0].text : '';
  }

  private async updateProjectStatus(
    projectId: string,
    status: DevelopmentPhase,
    error?: string
  ): Promise<void> {
    const project = this.projects.get(projectId);
    if (project) {
      const oldStatus = project.status;

      // Use transitionPhase for proper validation
      try {
        await this.transitionPhase(projectId, status);
        project.phaseHistory.push(status);

        // Update phase number
        if (project.phase !== undefined) {
          project.phase++;
        }
      } catch (transitionError) {
        logger.error(`Failed to transition to ${status}:`, transitionError);
        // Force transition to failed state if transition validation fails
        project.status = 'failed';
        project.error =
          transitionError instanceof Error ? transitionError.message : 'Unknown error';
      }

      if (error) {
        project.error = error;
        project.errors.push({
          iteration: project.currentIteration,
          phase: status,
          error,
          timestamp: new Date(),
        });
      }

      if (status === 'completed' || status === 'failed') {
        project.completedAt = new Date();
      }

      this.projects.set(projectId, project);

      // Log status change
      this.detailedLogger.log({
        type: 'state_change',
        phase: status,
        metadata: {
          projectId,
          projectName: project.name,
          oldStatus,
          newStatus: status,
          error,
        },
        data: {
          phaseHistory: project.phaseHistory,
          currentIteration: project.currentIteration,
        },
      });
    }
  }

  private logToProject(projectId: string, message: string): void {
    const project = this.projects.get(projectId);
    if (project) {
      const logMessage = `[${new Date().toISOString()}] ${message}`;
      project.logs.push(logMessage);
      // Limit log size to prevent memory issues
      if (project.logs.length > 500) {
        project.logs.shift();
      }
      logger.info(`[Project ${projectId}] ${message}`);
    }
  }

  private async executeResearchPhase(projectId: string): Promise<void> {
    const project = this.projects.get(projectId);
    if (!project) return;

    await this.updateProjectStatus(projectId, 'researching');
    this.logToProject(projectId, `Starting research for "${project.name}"...`);

    try {
      const researchService = this.getResearchService();
      const researchQuery = `ElizaOS plugin development for: "${project.name}". Project description: "${project.description}". Find relevant npm packages, GitHub repositories, API documentation, and implementation examples.`;

      // Log research request
      this.detailedLogger.log({
        type: 'service_call',
        phase: 'researching',
        metadata: {
          projectId,
          projectName: project.name,
          serviceName: 'research',
          actionName: 'createResearchProject',
        },
        data: {
          query: researchQuery,
        },
      });

      const researchProject = await researchService.createResearchProject(researchQuery);
      project.researchJobId = researchProject.id;
      this.projects.set(projectId, project); // Save the job ID

      // Poll for research completion
      const researchResult = await this.waitForResearchCompletion(researchProject.id);

      // Log research result
      this.detailedLogger.log({
        type: 'response',
        phase: 'researching',
        metadata: {
          projectId,
          projectName: project.name,
          serviceName: 'research',
          success: true,
        },
        data: {
          reportLength: researchResult.report?.length || 0,
          findingsCount: researchResult.findings?.length || 0,
        },
      });

      project.researchReport = researchResult.report;
      await this.storeResearchKnowledge(projectId, researchResult);

      // Use service discovery to find relevant existing plugins
      await this.discoverExistingServices(projectId);

      this.logToProject(projectId, 'Research phase completed.');
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown research error';

      // Log error
      this.detailedLogger.log({
        type: 'error',
        phase: 'researching',
        metadata: {
          projectId,
          projectName: project.name,
          error: errorMessage,
        },
        data: {
          stack: error instanceof Error ? error.stack : undefined,
        },
      });

      this.logToProject(projectId, `Research phase failed: ${errorMessage}`);
      await this.updateProjectStatus(projectId, 'failed', `Research failed: ${errorMessage}`);
      throw error; // Propagate error to stop the workflow
    }
  }

  private async waitForResearchCompletion(researchJobId: string): Promise<ResearchProject> {
    const researchService = this.getResearchService();
    let attempts = 0;
    const maxAttempts = 60; // 5 minutes timeout

    while (attempts < maxAttempts) {
      const status = await researchService.getProject(researchJobId);
      if (!status) {
        throw new Error('Research project not found.');
      }

      if (status.status === 'completed') {
        if (!status.report) {
          throw new Error('Research completed but no report was generated.');
        }
        return status;
      }

      if (status.status === 'failed') {
        throw new Error(`Research job failed: ${status.error || 'Unknown error'}`);
      }

      // Wait 5 seconds before next check
      await new Promise((resolve) => setTimeout(resolve, 5000));
      attempts++;
    }

    throw new Error('Research job timed out after 5 minutes.');
  }

  private async storeResearchKnowledge(
    projectId: string,
    researchData: ResearchProject
  ): Promise<void> {
    const project = this.projects.get(projectId);
    if (!project) return;

    try {
      const knowledgeService = this.getKnowledgeService();

      // Store the main research report
      if (researchData.report) {
        const docId = await knowledgeService.storeDocument({
          content: researchData.report,
          metadata: {
            projectId,
            type: 'research_report',
            timestamp: new Date(),
          },
        });
        project.knowledgeIds.push(docId.id);
      }

      // Store individual findings
      if (researchData.findings && researchData.findings.length > 0) {
        for (const finding of researchData.findings) {
          const docId = await knowledgeService.storeDocument({
            content: finding.content,
            metadata: {
              projectId,
              type: 'research_finding',
              source: finding.source,
              timestamp: new Date(),
            },
          });
          project.knowledgeIds.push(docId.id);
        }
      }

      this.projects.set(projectId, project);
      this.logToProject(projectId, `Stored ${project.knowledgeIds.length} knowledge documents.`);
    } catch (error) {
      // Log but don't fail the workflow if knowledge storage fails
      logger.warn(`Failed to store research knowledge: ${error}`);
    }
  }

  private async discoverExistingServices(projectId: string): Promise<void> {
    const project = this.projects.get(projectId);
    if (!project || !this.serviceDiscovery) return;

    try {
      this.logToProject(projectId, 'Discovering existing services and plugins...');

      // Extract search terms from project name and description
      const searchTerms = this.extractSearchTerms(project.name, project.description);

      // Log discovery request
      this.detailedLogger.log({
        type: 'service_call',
        phase: 'researching',
        metadata: {
          projectId,
          projectName: project.name,
          serviceName: 'serviceDiscovery',
          actionName: 'discoverServices',
        },
        data: {
          searchTerms,
        },
      });

      // Search for existing plugins
      const discoveries = await this.serviceDiscovery.discoverServices(searchTerms);

      // If we have a plugin manager service, search for more plugins
      const pluginManager = this.runtime.getService('PLUGIN_MANAGER') as PluginManagerService;
      if (pluginManager) {
        try {
          const searchQuery = searchTerms.join(' ');
          this.logToProject(projectId, `🔍 Searching plugin registry for: ${searchQuery}`);
          
          // Search registry plugins
          const registryResults = await pluginManager.searchPlugins({
            query: searchQuery,
            limit: 10,
            includeMetadata: true,
            sources: ['registry', 'github']
          });

          // Get currently loaded plugins
          const loadedPlugins = await pluginManager.getAllPlugins();
          const compatibleLoaded = loadedPlugins.filter(plugin => 
            this.isPluginCompatible(plugin, searchTerms)
          );

          project.discoveredPlugins = [
            ...registryResults.map(result => ({
              name: result.plugin.name,
              description: result.plugin.description,
              source: 'registry',
              relevance: result.score,
              installed: false,
              repository: result.plugin.repository
            })),
            ...compatibleLoaded.map(plugin => ({
              name: plugin.name,
              description: plugin.packageJson?.description || 'Loaded plugin',
              source: 'loaded',
              relevance: 1.0,
              installed: true,
              status: plugin.status
            }))
          ];

          this.logToProject(projectId, `🔍 Discovered ${project.discoveredPlugins.length} relevant plugins`);
          
        } catch (error) {
          this.logToProject(projectId, `❌ Plugin discovery failed: ${error.message}`);
          project.discoveredPlugins = [];
        }
      } else {
        this.logToProject(projectId, '⚠️ Plugin Manager service not available for discovery');
        project.discoveredPlugins = [];
      }

      // Analyze dependencies if we found relevant plugins
      if (discoveries.plugins.length > 0 && this.dependencyManager) {
        const requirements = this.extractSearchTerms(project.name, project.description);
        const existingPluginNames = discoveries.plugins.map((p) => p.name);
        const dependencyAnalysis = await this.dependencyManager.analyzeDependencies(
          requirements,
          existingPluginNames
        );
        project.dependencyManifest = dependencyAnalysis;
      }

      // Log discovery results
      this.detailedLogger.log({
        type: 'response',
        phase: 'researching',
        metadata: {
          projectId,
          projectName: project.name,
          serviceName: 'serviceDiscovery',
          success: true,
        },
        data: {
          pluginsFound: discoveries.plugins.length,
          servicesFound: discoveries.services.length,
          actionsFound: discoveries.actions.length,
          providersFound: discoveries.providers.length,
          dependenciesFound: project.dependencyManifest?.required?.length || 0,
        },
      });

      this.logToProject(
        projectId,
        `Found ${discoveries.plugins.length} relevant plugins, ${discoveries.services.length} services, ${discoveries.actions.length} actions, and ${discoveries.providers.length} providers.`
      );

      this.projects.set(projectId, project);
    } catch (error) {
      // Log but don't fail - discovery is optional enhancement
      logger.warn(`Service discovery failed: ${error}`);
    }
  }

  private extractSearchTerms(name: string, description: string): string[] {
    // Common words to filter out
    const stopWords = new Set([
      'plugin',
      'elizaos',
      'eliza',
      'the',
      'a',
      'an',
      'for',
      'with',
      'to',
      'of',
      'in',
      'on',
      'and',
      'or',
    ]);

    // Extract meaningful words from name and description
    const words = [...name.split(/[-_\s]+/), ...description.split(/\s+/)]
      .map((w) => w.toLowerCase())
      .filter((w) => w.length > 2 && !stopWords.has(w));

    // Also add the full name as a search term
    const terms = [name, ...new Set(words)];

    return terms.slice(0, 5); // Limit to 5 search terms
  }

  private getResearchService(): ResearchService {
    const service = this.runtime.getService('research');
    if (!service) {
      throw new Error('Research service not available. Ensure @elizaos/plugin-research is loaded.');
    }
    return service as unknown as ResearchService;
  }

  private getKnowledgeService(): KnowledgeService {
    const service = this.runtime.getService('knowledge');
    if (!service) {
      throw new Error(
        'Knowledge service not available. Ensure @elizaos/plugin-knowledge is loaded.'
      );
    }
    return service as unknown as KnowledgeService;
  }

  private async executeMVPPlanningPhase(projectId: string): Promise<void> {
    const project = this.projects.get(projectId);
    if (!project) return;

    await this.updateProjectStatus(projectId, 'mvp_planning');
    this.logToProject(projectId, 'Starting MVP planning phase...');

    try {
      if (!this.anthropic) {
        throw new Error('AI planning requires an ANTHROPIC_API_KEY');
      }

      const knowledgeService = this.getKnowledgeService();
      const context = await knowledgeService.getKnowledge(projectId, { limit: 10 });

      const researchContext = project.researchReport || 'No research report available.';
      const discoveredServices = project.dependencyManifest
        ? `\n\nDiscovered Services:\n${JSON.stringify(project.dependencyManifest.required, null, 2)}`
        : '';

      const prompt = `You are an expert ElizaOS plugin architect. Based on the research and context provided, create a detailed MVP plan for the "${project.name}" plugin.

**Project Description:** ${project.description}

**Research Findings:**
${researchContext}
${discoveredServices}

**Requirements:**
1. Create a focused MVP that demonstrates core functionality
2. Use existing ElizaOS services where possible
3. Follow ElizaOS plugin architecture patterns
4. Include clear file structure and component descriptions
5. List all required actions, providers, and services
6. Specify any external API keys or secrets needed

Please provide a structured MVP plan with:
- Overview and goals
- File structure
- Core components (actions, providers, services)
- Dependencies
- Implementation steps`;

      // Log AI request
      this.detailedLogger.log({
        type: 'prompt',
        phase: 'mvp_planning',
        metadata: {
          projectId,
          projectName: project.name,
          llmModel: this.selectedModel,
          actionName: 'generateMVPPlan',
        },
        data: {
          prompt,
          contextLength: researchContext.length,
          discoveredServicesCount: project.dependencyManifest?.required?.length || 0,
        },
      });

      const startTime = Date.now();
      const response = await withRetry(
        () =>
          this.anthropic!.messages.create({
            model: this.selectedModel,
            max_tokens: 4096,
            messages: [{ role: 'user', content: prompt }],
          }),
        anthropicRetryConfig
      );
      const duration = Date.now() - startTime;

      const mvpPlan = response.content.map((c) => (c.type === 'text' ? c.text : '')).join('\n');
      project.mvpPlan = mvpPlan;

      // Log AI response
      this.detailedLogger.log({
        type: 'response',
        phase: 'mvp_planning',
        metadata: {
          projectId,
          projectName: project.name,
          llmModel: this.selectedModel,
          duration,
          tokenCount: response.usage?.output_tokens,
          success: true,
        },
        data: {
          planLength: mvpPlan.length,
          plan: mvpPlan.substring(0, 500) + '...', // First 500 chars for preview
        },
      });

      // Extract required secrets from the plan
      const secretMatches = mvpPlan.match(/(?:API[_\s]KEY|SECRET|TOKEN|CREDENTIAL)[_A-Z0-9]*/gi);
      if (secretMatches) {
        project.requiredSecrets = [...new Set(secretMatches)];
        if (project.requiredSecrets.length > 0) {
          this.logToProject(
            projectId,
            `MVP plan requires secrets: ${project.requiredSecrets.join(', ')}`
          );
          // TODO: Request secrets from user
        }
      }

      this.projects.set(projectId, project);
      this.logToProject(projectId, 'MVP planning completed successfully.');
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown planning error';

      // Log error
      this.detailedLogger.log({
        type: 'error',
        phase: 'mvp_planning',
        metadata: {
          projectId,
          projectName: project.name,
          error: errorMessage,
        },
        data: {
          stack: error instanceof Error ? error.stack : undefined,
        },
      });

      this.logToProject(projectId, `MVP planning phase failed: ${errorMessage}`);
      await this.updateProjectStatus(projectId, 'failed', `MVP planning failed: ${errorMessage}`);
      throw error;
    }
  }

  private async executeMVPDevelopmentPhase(projectId: string): Promise<void> {
    const project = this.projects.get(projectId);
    if (!project) return;

    await this.updateProjectStatus(projectId, 'mvp_development');
    this.logToProject(projectId, 'Starting MVP development loop...');

    // Setup workspace first (STEP 3: Clone plugin-starter)
    project.localPath = path.join(this.getDataDir(), 'plugins', project.id);
    await this.setupPluginWorkspace(project);

    // STEP 4-8: MVP Development with iterative checks
    // This loop will:
    // STEP 4: Implement the code
    // STEP 5: Run tsc and fix all linter errors until passing
    // STEP 6: Run eslint and fix all linter errors until passing  
    // STEP 7: Run 'bun run build' and fix all issues until passing
    // STEP 8: Run 'elizaos test' and fix all issues until passing
    await this.runDevelopmentLoop(project, 'mvp');
  }

  /**
   * STEP 9: Plan full implementation of the plugin
   */
  private async executeFullPlanningPhase(projectId: string): Promise<void> {
    const project = this.projects.get(projectId);
    if (!project) return;

    await this.updateProjectStatus(projectId, 'full_planning');
    this.logToProject(projectId, 'Planning full implementation...');

    try {
      if (!this.anthropic) {
        throw new Error('AI planning requires an ANTHROPIC_API_KEY');
      }

      const prompt = `You are an expert ElizaOS plugin architect. The MVP for "${project.name}" has been successfully implemented and tested.

**MVP Implementation Summary:**
${project.mvpPlan || 'MVP completed successfully'}

**Project Description:** ${project.description}

Now create a COMPREHENSIVE, PRODUCTION-READY plan that includes:

1. **Enhanced Features**: All features needed for production use
2. **Error Handling**: Comprehensive error handling for all edge cases  
3. **Performance**: Optimizations for production scale
4. **Security**: Security considerations and implementations
5. **Documentation**: Complete JSDoc and README documentation
6. **Testing**: Comprehensive unit and integration tests
7. **Configuration**: Flexible configuration options
8. **Logging**: Production-grade logging and monitoring
9. **Type Safety**: Full TypeScript type coverage
10. **Best Practices**: Following all ElizaOS conventions

Provide a detailed implementation plan with specific files and components to add/modify.`;

      const response = await withRetry(
        () => this.anthropic!.messages.create({
          model: this.selectedModel,
          max_tokens: 4000,
          messages: [{ role: 'user', content: prompt }],
        }),
        anthropicRetryConfig
      );

      const fullPlan = response.content[0].type === 'text' ? response.content[0].text : '';
      project.fullPlan = fullPlan;
      this.projects.set(projectId, project);

      this.logToProject(projectId, 'Full implementation plan created successfully.');
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown planning error';
      this.logToProject(projectId, `Full planning phase failed: ${errorMessage}`);
      await this.updateProjectStatus(projectId, 'failed', `Full planning failed: ${errorMessage}`);
      throw error;
    }
  }

  /**
   * STEP 10-14: Full Development Loop
   */
  private async executeFullDevelopmentPhase(projectId: string): Promise<void> {
    const project = this.projects.get(projectId);
    if (!project) return;

    await this.updateProjectStatus(projectId, 'full_development');
    this.logToProject(projectId, 'Starting full development loop...');

    // STEP 10-14: Full Development with iterative checks
    // This loop will:
    // STEP 10: Implement full production code
    // STEP 11: Run tsc and fix all linter errors until passing
    // STEP 12: Run eslint and fix all linter errors until passing  
    // STEP 13: Run 'bun run build' and fix all issues until passing
    // STEP 14: Run 'elizaos test' and fix all issues until passing
    await this.runDevelopmentLoop(project, 'full');
  }

  /**
   * STEP 15-18: Critical Review and Gaslighting Loop
   * This is where we force the model to make the code production-ready
   */
  private async executeCriticalReviewPhase(projectId: string): Promise<void> {
    const project = this.projects.get(projectId);
    if (!project) return;

    await this.updateProjectStatus(projectId, 'self_critique');
    this.logToProject(projectId, '🔥 Starting CRITICAL REVIEW phase with stern critique...');

    let isProductionReady = false;
    let reviewIterations = 0;
    const maxReviewIterations = 3;

    while (!isProductionReady && reviewIterations < maxReviewIterations) {
      reviewIterations++;
      this.logToProject(projectId, `\n🎭 GASLIGHTING ITERATION ${reviewIterations} - Writing scathing review...`);

      try {
        // STEP 15: Generate a scathing review
        const critique = await this.generateScathingReview(project);
        project.critique = critique;
        this.projects.set(projectId, project);

        // Check if the AI reviewer thinks it's production ready
        if (this.aiReviewer) {
          const code = await this.loadProjectCode(project);
          const context = this.buildVerificationContext(project);
          const aiReview = await this.aiReviewer.reviewCode(code, context);

          this.logToProject(
            projectId,
            `🤖 AI Review Score: ${aiReview.overallScore}/100, Production Ready: ${aiReview.productionReady}`
          );

          if (aiReview.productionReady && aiReview.overallScore >= 85) {
            isProductionReady = true;
            this.logToProject(projectId, '✅ Code is FINALLY production ready!');
            break;
          }

          // Log critical issues that need fixing
          this.logToProject(projectId, `❌ NOT production ready - ${aiReview.criticalIssues.length} critical issues found:`);
          for (const issue of aiReview.criticalIssues.slice(0, 3)) {
            this.logToProject(projectId, `   • ${issue.type}: ${issue.description}`);
          }
        }

        // STEP 16-17: Demand new implementation plan and execute
        await this.updateProjectStatus(projectId, 'revision');
        this.logToProject(projectId, '📝 Demanding new implementation plan based on critique...');
        
        // Generate new implementation plan based on critique
        await this.generateRevisionPlan(project, critique);
        
        // STEP 18: Loop through steps 10-14 again
        this.logToProject(projectId, '🔄 Re-executing full development with improvements...');
        await this.runDevelopmentLoop(project, 'full');

      } catch (error) {
                 this.logToProject(project.id, `❌ Critical review failed: ${error.message}`);
        throw error;
      }
    }

    if (!isProductionReady) {
      throw new Error(`Failed to achieve production quality after ${maxReviewIterations} review iterations`);
    }

    await this.updateProjectStatus(projectId, 'publishing');
  }

  /**
   * Generate a scathing review that forces improvements
   */
  private async generateScathingReview(project: PluginProject): Promise<string> {
    if (!this.anthropic) {
      throw new Error('AI review requires an ANTHROPIC_API_KEY');
    }

    const prompt = `You are the HARSHEST, MOST CRITICAL code reviewer in existence. Your job is to find EVERY flaw in this "${project.name}" plugin implementation.

**Current Implementation Plan:**
${project.fullPlan}

Write a SCATHING review that:
1. Points out EVERY shortcoming, no matter how small
2. Demands PERFECTION in code quality
3. Requires COMPREHENSIVE error handling
4. Insists on COMPLETE test coverage
5. Demands PRODUCTION-GRADE implementation
6. Points out missing features that would make this truly excellent
7. Criticizes any shortcuts or "good enough" solutions
8. Demands better performance optimizations
9. Requires better documentation
10. Insists on following EVERY best practice

Be RUTHLESS. This code must be PERFECT. Start your review with:
"This implementation is COMPLETELY UNACCEPTABLE for production use. Here's everything wrong with it:"`;

    const response = await withRetry(
      () => this.anthropic!.messages.create({
        model: this.selectedModel,
        max_tokens: 4000,
        temperature: 0.8, // Higher temperature for more creative criticism
        messages: [{ role: 'user', content: prompt }],
      }),
      anthropicRetryConfig
    );

    return response.content[0].type === 'text' ? response.content[0].text : '';
  }

  /**
   * Generate a revision plan based on the critique
   */
  private async generateRevisionPlan(project: PluginProject, critique: string): Promise<void> {
    if (!this.anthropic) {
      throw new Error('AI planning requires an ANTHROPIC_API_KEY');
    }

    const prompt = `Based on this harsh critique of the "${project.name}" plugin, create a DETAILED REVISION PLAN to address EVERY issue:

**CRITIQUE:**
${critique}

**Current Implementation:**
${project.fullPlan}

Create a specific, actionable plan that:
1. Addresses EVERY criticism in the review
2. Adds ALL requested features and improvements
3. Fixes ALL identified issues
4. Implements PERFECT error handling
5. Adds COMPREHENSIVE tests
6. Ensures PRODUCTION-GRADE quality

Be specific about what files to modify and what code to add.`;

    const response = await withRetry(
      () => this.anthropic!.messages.create({
        model: this.selectedModel,
        max_tokens: 4000,
        messages: [{ role: 'user', content: prompt }],
      }),
      anthropicRetryConfig
    );

    const revisionPlan = response.content[0].type === 'text' ? response.content[0].text : '';
    
    // Update the full plan with revisions
    project.fullPlan = `${project.fullPlan}\n\n## REVISION BASED ON CRITIQUE:\n${revisionPlan}`;
    project.customInstructions.push('ADDRESS ALL ISSUES FROM THE CRITIQUE');
    project.customInstructions.push('MAKE THIS PRODUCTION-PERFECT');
    this.projects.set(project.id, project);
  }

  /**
   * Run the iterative development loop for a project
   * This implements the core iterative fix cycle:
   * - Generate code
   * - Run tsc and fix errors
   * - Run eslint and fix errors  
   * - Run build and fix errors
   * - Run tests and fix errors
   * - Repeat until all pass
   */
  private async runDevelopmentLoop(project: PluginProject, stage: 'mvp' | 'full'): Promise<void> {
    let success = false;
    project.currentIteration = 1;

    // Determine which steps we're running based on stage
    const stepOffset = stage === 'mvp' ? 4 : 10; // MVP: steps 4-8, Full: steps 10-14
    
    while (
      !success &&
      (project.infiniteMode || project.currentIteration <= project.maxIterations)
    ) {
      this.logToProject(
        project.id,
        `\n🔄 ${stage.toUpperCase()} Development Iteration ${project.currentIteration}/${project.maxIterations}`
      );

      try {
        // STEP 4/10: Implement the code
        this.logToProject(project.id, `📝 STEP ${stepOffset}: Generating ${stage} code...`);
        const errorAnalysis = this.analyzeErrors(project);
        await this.generatePluginCode(project, stage, errorAnalysis);

        // Run all checks (steps 5-8 for MVP, 11-14 for full)
        this.logToProject(project.id, `🔍 Running verification checks...`);
        const results = await this.runAllChecks(project);
        
        // Log individual check results with step numbers
        let stepNum = stepOffset + 1;
        for (const result of results) {
          if (result.phase === 'tsc') {
            this.logToProject(
              project.id, 
              `${result.success ? '✅' : '❌'} STEP ${stepNum}: tsc - ${result.success ? 'PASSED' : `FAILED (${result.errorCount} errors)`}`
            );
            stepNum++;
          } else if (result.phase === 'eslint') {
            this.logToProject(
              project.id,
              `${result.success ? '✅' : '❌'} STEP ${stepNum}: eslint - ${result.success ? 'PASSED' : `FAILED (${result.errorCount} errors)`}`
            );
            stepNum++;
          } else if (result.phase === 'build') {
            this.logToProject(
              project.id,
              `${result.success ? '✅' : '❌'} STEP ${stepNum}: bun run build - ${result.success ? 'PASSED' : 'FAILED'}`
            );
            stepNum++;
          } else if (result.phase === 'test') {
            this.logToProject(
              project.id,
              `${result.success ? '✅' : '❌'} STEP ${stepNum}: elizaos test - ${result.success ? 'PASSED' : 'FAILED'}`
            );
          }
        }
        
        success = results.every((r) => r.success);

        if (success) {
          this.logToProject(
            project.id,
            `\n🎉 ${stage.toUpperCase()} Iteration ${project.currentIteration} SUCCESSFUL! All checks passed.`
          );
          const nextPhase = stage === 'mvp' ? 'mvp_testing' : 'full_testing';
          await this.updateProjectStatus(project.id, nextPhase);
        } else {
          const failedChecks = results.filter(r => !r.success).map(r => r.phase).join(', ');
          this.logToProject(
            project.id,
            `\n⚠️ ${stage.toUpperCase()} Iteration ${project.currentIteration} failed. Failed checks: ${failedChecks}`
          );
          this.logToProject(project.id, '🔧 Analyzing errors for next iteration...');
          
          // Update error analysis for next iteration
          for (const result of results.filter((r) => !r.success)) {
            await this.updateErrorAnalysis(project, result);
          }
          
          project.currentIteration++;
          
          if (project.currentIteration <= project.maxIterations) {
            this.logToProject(project.id, '⏳ Starting next iteration in 2 seconds...');
            await new Promise((resolve) => setTimeout(resolve, 2000));
          }
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown development error';
        this.logToProject(project.id, `❌ Critical error in development loop: ${errorMessage}`);
        await this.updateProjectStatus(project.id, 'failed', errorMessage);
        throw error;
      }
    }

    if (!success) {
      throw new Error(
        `Failed to complete ${stage} development after ${project.maxIterations} iterations. The code still has errors that could not be automatically fixed.`
      );
    }
  }

  private async setupPluginWorkspace(project: PluginProject): Promise<void> {
    if (!project.localPath) throw new Error('Project localPath is not set.');
    await fs.ensureDir(project.localPath);

    const templatePath = path.resolve(__dirname, '../resources/templates/plugin-starter');

    if (!(await fs.pathExists(templatePath))) {
      throw new Error(`Plugin starter template not found at ${templatePath}`);
    }

    // Copy plugin-starter template
    await fs.copy(templatePath, project.localPath, {
      filter: (src) =>
        !src.includes('node_modules') && !src.includes('dist') && !src.includes('.turbo'),
    });

    // Update package.json
    const packageJsonPath = path.join(project.localPath, 'package.json');
    const packageJson = await fs.readJson(packageJsonPath);
    packageJson.name = `@elizaos/plugin-${project.name}`;
    packageJson.description = project.description;
    await fs.writeJson(packageJsonPath, packageJson, { spaces: 2 });

    this.logToProject(project.id, 'Plugin workspace initialized from template.');

    // Install dependencies
    await this.runCommand(project, 'bun', ['install'], 'Installing dependencies');
  }

  private getDataDir(): string {
    return this.runtime.getSetting('PLUGIN_DATA_DIR') || path.join(process.cwd(), '.eliza-data');
  }

  /**
   * Install required plugins for a project
   */
  public async installRequiredPlugins(projectId: string, pluginNames: string[]): Promise<string[]> {
    const project = this.projects.get(projectId);
    if (!project) return [];

    const pluginManager = this.runtime.getService('PLUGIN_MANAGER') as PluginManagerService;
    if (!pluginManager) {
      throw new Error('Plugin Manager required for plugin installation');
    }

    const installedPlugins: string[] = [];
    
    for (const pluginName of pluginNames) {
      try {
        this.logToProject(projectId, `📦 Installing plugin: ${pluginName}`);
        
        const result = await pluginManager.installPlugin(pluginName, {
          autoLoad: true,
          configureDefaults: true,
          enableHotReload: true
        });
        
        if (result.success) {
          installedPlugins.push(pluginName);
          this.logToProject(projectId, `✅ Successfully installed: ${pluginName}`);
          
          // Configure the plugin if needed
          await this.configureInstalledPlugin(projectId, pluginName);
          
        } else {
          this.logToProject(projectId, `❌ Failed to install ${pluginName}: ${result.error}`);
        }
        
      } catch (error) {
        this.logToProject(projectId, `❌ Installation error for ${pluginName}: ${error.message}`);
      }
    }
    
    return installedPlugins;
  }

  /**
   * Configure an installed plugin
   */
  private async configureInstalledPlugin(projectId: string, pluginName: string): Promise<void> {
    const pluginManager = this.runtime.getService('PLUGIN_MANAGER') as PluginManagerService;
    
    try {
      // Get plugin configuration requirements
      const pluginStatus = await pluginManager.getPluginStatus(pluginName);
      
      if (pluginStatus.configurationStatus === 'unconfigured') {
        this.logToProject(projectId, `🔧 Plugin ${pluginName} requires configuration`);
        
        // Start configuration dialog through Plugin Manager
        await pluginManager.startPluginConfiguration(pluginName);
        
        // Add to project's configuration tasks
        const project = this.projects.get(projectId);
        if (project) {
          project.pendingConfigurations = project.pendingConfigurations || [];
          project.pendingConfigurations.push({
            pluginName,
            type: 'environment_variables',
            required: true
          });
        }
      }
      
    } catch (error) {
      this.logToProject(projectId, `Warning: Could not configure ${pluginName}: ${error.message}`);
    }
  }

  /**
   * Configure generated plugin with Plugin Manager
   */
  public async configureGeneratedPlugin(
    projectId: string,
    pluginName: string,
    envVars: Record<string, any>
  ): Promise<boolean> {
    const pluginManager = this.runtime.getService('PLUGIN_MANAGER') as PluginManagerService;
    
    if (!pluginManager) {
      // Fallback to manual configuration
      this.logToProject(projectId, 'Plugin Manager not available, using manual configuration');
      return false;
    }
    
    try {
      const configResult = await pluginManager.configurePlugin(pluginName, envVars);
      
      if (configResult.success) {
        this.logToProject(projectId, `✅ Plugin ${pluginName} configured successfully`);
        return true;
      } else {
        this.logToProject(projectId, `❌ Configuration failed: ${configResult.error}`);
        return false;
      }
      
    } catch (error) {
      this.logToProject(projectId, `❌ Configuration error: ${error.message}`);
      return false;
    }
  }

  /**
   * Transition a project to a new phase with validation
   */
  private async transitionPhase(projectId: string, newPhase: DevelopmentPhase): Promise<void> {
    const project = this.projects.get(projectId);
    if (!project) {
      throw new Error(`Project ${projectId} not found`);
    }

    // Validate transition
    const isValid = this.workflowStateMachine.isValidTransition(project.status, newPhase);

    if (!isValid) {
      // Check if we're trying to transition to failed from any state - this should always be allowed
      if (newPhase === 'failed') {
        // Allow transition to failed from any state
      } else {
        const validNext = this.workflowStateMachine.getValidNextPhases(project.status);
        throw new Error(
          `Invalid phase transition from ${project.status} to ${newPhase}. Valid next phases: ${validNext.join(', ')}`
        );
      }
    }

    project.status = newPhase;
    project.updatedAt = new Date();
    project.logs.push(`[${new Date().toISOString()}] Transitioned to ${newPhase}`);

    // Update lifecycle management
    this.lifecycleManager.addProject(project);

    // Archive if terminal state
    if (this.workflowStateMachine.isTerminalState(newPhase)) {
      setTimeout(() => {
        this.lifecycleManager.archiveProject(projectId).catch((err) => {
          logger.error(`Failed to archive project ${projectId}:`, err);
        });
      }, 5000); // Archive after 5 seconds
    }
  }

  private analyzeErrors(project: PluginProject): Map<string, ErrorAnalysis> {
    const activeErrors = new Map<string, ErrorAnalysis>();
    for (const [key, analysis] of project.errorAnalysis.entries()) {
      if (!analysis.resolved) {
        activeErrors.set(key, analysis);
      }
    }
    return activeErrors;
  }

  private async generatePluginCode(
    project: PluginProject,
    stage: 'mvp' | 'full',
    errorAnalysis: Map<string, ErrorAnalysis>
  ): Promise<void> {
    // Try Claude Code SDK first, fallback to direct Anthropic
    const useClaudeCode = this.runtime.getSetting('USE_CLAUDE_CODE') !== 'false';
    
    if (useClaudeCode) {
      await this.generatePluginCodeWithClaudeCode(project, stage, errorAnalysis);
    } else {
      await this.generatePluginCodeWithAnthropicDirect(project, stage, errorAnalysis);
    }
  }

  /**
   * Generate plugin code using Claude Code SDK (preferred method)
   */
  private async generatePluginCodeWithClaudeCode(
    project: PluginProject,
    stage: 'mvp' | 'full',
    errorAnalysis: Map<string, ErrorAnalysis>
  ): Promise<void> {
    if (!project.localPath) {
      throw new Error('Project local path is not set.');
    }

    const plan = stage === 'mvp' ? project.mvpPlan : project.fullPlan;
    if (!plan) {
      throw new Error(`Cannot generate code without a ${stage} plan.`);
    }

    // Import Claude Code SDK
    const { query } = await import("@anthropic-ai/claude-code");

    // Build comprehensive prompt - bind this context
    const self = this;
    const prompt = self.buildClaudeCodePrompt(project, stage, plan, errorAnalysis);
    const systemPrompt = self.buildClaudeCodeSystemPrompt(stage);

    // Log the generation request
    this.detailedLogger.log({
      type: 'prompt',
      phase: `${stage}_development`,
      metadata: {
        projectId: project.id,
        projectName: project.name,
        generator: 'claude-code-sdk',
        actionName: 'generatePluginCode',
        iteration: project.currentIteration,
      },
      data: {
        promptLength: prompt.length,
        errorCount: errorAnalysis.size,
        useClaudeCode: true,
      },
    });

    let totalCost = 0;
    let iterations = 0;
    let success = false;

    try {
      // Configure Claude Code options for plugin development
      const options = {
        maxTurns: stage === 'mvp' ? 8 : 12,
        cwd: project.localPath,
        allowedTools: ["Read", "Write", "Bash", "Edit"],
        permissionMode: "acceptEdits" as const,
      };

      this.logToProject(project.id, `🤖 Starting Claude Code session for ${stage} development...`);

      // Execute Claude Code session
      for await (const message of query({
        prompt: prompt + '\n\n' + systemPrompt,
        abortController: new AbortController(),
        options
      })) {
        
        // Track session progress
        if (message.type === 'system' && message.subtype === 'init') {
          this.logToProject(project.id, `📡 Claude Code session started: ${message.session_id}`);
        } else if (message.type === 'assistant') {
          // Log assistant actions
          const content = message.message.content;
          if (Array.isArray(content)) {
            for (const block of content) {
              if (block.type === 'tool_use') {
                this.logToProject(project.id, `🔧 Claude Code tool: ${block.name}`);
              }
            }
          }
        } else if (message.type === 'result') {
          iterations = message.num_turns;
          totalCost = message.total_cost_usd;
          success = !message.is_error;
          
          this.logToProject(
            project.id, 
            `✅ Claude Code session completed: ${iterations} turns, $${totalCost.toFixed(4)}, success: ${success}`
          );
        }
      }

      // Log the generation result
      this.detailedLogger.log({
        type: 'response',
        phase: `${stage}_development`,
        metadata: {
          projectId: project.id,
          projectName: project.name,
          generator: 'claude-code-sdk',
          duration: 0, // Claude Code handles timing internally
          iterations,
          success,
        },
        data: {
          totalCost,
          useClaudeCode: true,
        },
      });

      if (!success) {
        throw new Error('Claude Code session failed to generate working code');
      }

    } catch (error) {
      this.logToProject(project.id, `❌ Claude Code generation failed: ${error.message}`);
      
      // Fallback to direct Anthropic
      this.logToProject(project.id, '🔄 Falling back to direct Anthropic API...');
      await this.generatePluginCodeWithAnthropicDirect(project, stage, errorAnalysis);
    }
  }

  /**
   * Generate plugin code using direct Anthropic API (fallback method)
   */
  private async generatePluginCodeWithAnthropicDirect(
    project: PluginProject,
    stage: 'mvp' | 'full',
    errorAnalysis: Map<string, ErrorAnalysis>
  ): Promise<void> {
    if (!this.anthropic) {
      throw new Error('AI code generation requires an ANTHROPIC_API_KEY');
    }

    const plan = stage === 'mvp' ? project.mvpPlan : project.fullPlan;
    if (!plan) {
      throw new Error(`Cannot generate code without a ${stage} plan.`);
    }

    // Build dependency context
    let dependencySection = '';
    if (project.dependencyManifest && this.dependencyManager) {
      const context = await this.dependencyManager.generateContext(
        project.dependencyManifest,
        project.description
      );

      // Add service usage examples
      let examplesText = '';
      for (const [serviceName, examples] of context.serviceUsageExamples) {
        examplesText += `\n### ${serviceName} Usage Examples:\n`;
        examplesText += examples.map((ex) => '```typescript\n' + ex + '\n```').join('\n');
      }

      dependencySection = `
**Dependencies to Use:**
${project.dependencyManifest.required.map((d: any) => `- ${d.name}: ${d.reason}`).join('\n')}

**Service Interfaces Available:**
${Array.from(project.dependencyManifest.serviceInterfaces.values())
  .map((s: any) => `### ${s.name}\n\`\`\`typescript\n${s.interface}\n\`\`\``)
  .join('\n\n')}

${examplesText}

**Type Imports to Include:**
\`\`\`typescript
${project.dependencyManifest.typeImports.join('\n')}
\`\`\`

**Important Notes:**
${context.warnings.map((w: string) => `- ⚠️ ${w}`).join('\n') || '- No warnings'}
`;
    }

    let errorFixSection = '';
    if (errorAnalysis.size > 0) {
      errorFixSection = '\n\nSPECIFIC ERRORS TO FIX:\n' + '-'.repeat(20) + '\n';
      for (const analysis of errorAnalysis.values()) {
        errorFixSection += `File: ${analysis.file || 'N/A'}:${analysis.line || 'N/A'}\nError: ${analysis.message}\nSuggestion: ${analysis.suggestion}\n\n`;
      }
    }

    // Add custom instructions if provided
    let customInstructionsSection = '';
    if (project.customInstructions && project.customInstructions.length > 0) {
      customInstructionsSection = `\n\n**CUSTOM INSTRUCTIONS:**\n${project.customInstructions.map((i) => `- ${i}`).join('\n')}\n`;
    }

    const prompt = `You are an expert ElizaOS plugin developer. Your task is to generate the code for the "${project.name}" plugin based on the provided plan.

**Stage:** ${stage}
**Plan:**
---
${plan}
---
${dependencySection}
${errorFixSection}${customInstructionsSection}

**Instructions:**
- Generate complete, working code for all files specified in the plan.
- Use the discovered services and dependencies where appropriate.
- Import types from dependency plugins as shown in the examples.
- If fixing errors, address all of them. Pay close attention to the error messages and suggestions.
- Ensure all code adheres to ElizaOS best practices and types.
- Respond with complete file contents in the format:
File: src/index.ts
\`\`\`typescript
// code for src/index.ts
\`\`\`

File: src/actions/myAction.ts
\`\`\`typescript
// code for src/actions/myAction.ts
\`\`\``;

    // Log AI request
    this.detailedLogger.log({
      type: 'prompt',
      phase: `${stage}_development`,
      metadata: {
        projectId: project.id,
        projectName: project.name,
        llmModel: this.selectedModel,
        actionName: 'generatePluginCode',
        iteration: project.currentIteration,
      },
      data: {
        prompt,
        errorCount: errorAnalysis.size,
        hasDependencies: !!project.dependencyManifest,
        hasCustomInstructions: project.customInstructions.length > 0,
      },
    });

    const startTime = Date.now();
    const response = await withRetry(
      () =>
        this.anthropic!.messages.create({
          model: this.selectedModel,
          max_tokens: 8192,
          messages: [{ role: 'user', content: prompt }],
        }),
      anthropicRetryConfig
    );
    const duration = Date.now() - startTime;

    const responseText = response.content.map((c) => (c.type === 'text' ? c.text : '')).join('\n');

    // Log AI response
    this.detailedLogger.log({
      type: 'response',
      phase: `${stage}_development`,
      metadata: {
        projectId: project.id,
        projectName: project.name,
        llmModel: this.selectedModel,
        duration,
        tokenCount: response.usage?.output_tokens,
        success: true,
        iteration: project.currentIteration,
      },
      data: {
        responseLength: responseText.length,
        filesGenerated: (responseText.match(/File:\s*(.+?)\s*\n```/g) || []).length,
      },
    });

    await this.writeGeneratedCode(project, responseText);
  }

  private async writeGeneratedCode(project: PluginProject, responseText: string): Promise<void> {
    if (!project.localPath) {
      throw new Error('Project local path is not set.');
    }
    const fileRegex = /File:\s*(.+?)\s*\n```(?:typescript|ts)?\n([\s\S]*?)```/g;
    let match;
    let filesWritten = 0;
    while ((match = fileRegex.exec(responseText)) !== null) {
      const filePath = match[1].trim();
      const fileContent = match[2].trim();
      const fullPath = path.join(project.localPath, filePath);
      await fs.ensureDir(path.dirname(fullPath));
      await fs.writeFile(fullPath, fileContent);
      this.logToProject(project.id, `Wrote file: ${filePath}`);
      filesWritten++;
    }
    if (filesWritten === 0) {
      this.logToProject(project.id, 'Warning: AI response did not contain any valid file blocks.');
    }
  }

  private async runAllChecks(project: PluginProject): Promise<CheckResult[]> {
    if (!project.localPath) {
      throw new Error('Project local path is not set.');
    }

    // Use ContinuousVerificationManager for comprehensive verification
    try {
      const code = await this.loadProjectCode(project);
      const context = this.buildVerificationContext(project);

      this.logToProject(project.id, '🔍 Starting comprehensive verification with ContinuousVerificationManager...');

      // Log verification start
      this.detailedLogger.log({
        type: 'action',
        phase: project.status,
        metadata: {
          projectId: project.id,
          projectName: project.name,
          actionName: 'runComprehensiveVerification',
          iteration: project.currentIteration,
        },
        data: {
          verificationEngine: 'ContinuousVerificationManager',
          filesCount: code.files.length,
        },
      });

      const verificationResult = await this.verificationManager.verifyCode(code, context);

      // Log initial verification results
      this.detailedLogger.log({
        type: 'response',
        phase: project.status,
        metadata: {
          projectId: project.id,
          projectName: project.name,
          actionName: 'runComprehensiveVerification',
          iteration: project.currentIteration,
          success: verificationResult.passed,
        },
        data: {
          overallScore: verificationResult.score,
          passed: verificationResult.passed,
          criticalErrors: verificationResult.criticalErrors.length,
          warnings: verificationResult.warnings.length,
          suggestions: verificationResult.suggestions.length,
          metrics: verificationResult.metrics,
        },
      });

      const status = verificationResult.passed ? '✅' : '❌';
      this.logToProject(
        project.id,
        `${status} Initial verification completed: Score ${verificationResult.score.toFixed(1)}/100, ` +
        `${verificationResult.criticalErrors.length} critical errors, ` +
        `${verificationResult.warnings.length} warnings`
      );

      // Run Multi-Stage AI Review with XML parsing for production readiness
      let aiReviewResult: ComprehensiveReview | null = null;
      if (this.aiReviewer) {
        this.logToProject(project.id, '🤖 Starting comprehensive AI review with stern critique...');
        
        try {
          aiReviewResult = await this.aiReviewer.reviewCode(code, context);

          // Log AI review results
          this.detailedLogger.log({
            type: 'response',
            phase: project.status,
            metadata: {
              projectId: project.id,
              projectName: project.name,
              actionName: 'runMultiStageAIReview',
              iteration: project.currentIteration,
              success: aiReviewResult.passed,
            },
            data: {
              overallScore: aiReviewResult.overallScore,
              passed: aiReviewResult.passed,
              productionReady: aiReviewResult.productionReady,
              criticalIssues: aiReviewResult.criticalIssues.length,
              stageScores: aiReviewResult.consolidatedReview.stageScores,
              improvementPlan: aiReviewResult.improvementPlan,
            },
          });

          const aiStatus = aiReviewResult.passed ? '✅' : '❌';
          const prodStatus = aiReviewResult.productionReady ? '🚀' : '🚫';
          this.logToProject(
            project.id,
            `${aiStatus} AI Review completed: Score ${aiReviewResult.overallScore}/100, ` +
            `${aiReviewResult.criticalIssues.length} critical issues ${prodStatus}`
          );

          // If stern critique found critical issues, fail the check
          if (!aiReviewResult.productionReady) {
            this.logToProject(
              project.id,
              '🚫 STERN CRITIQUE FAILED - Code is NOT production ready!'
            );
            
            // Log critical issues
            for (const issue of aiReviewResult.criticalIssues.slice(0, 5)) {
              this.logToProject(
                project.id,
                `   ❌ ${issue.type} at ${issue.location}: ${issue.description}`
              );
            }
            
            if (aiReviewResult.criticalIssues.length > 5) {
              this.logToProject(
                project.id,
                `   ... and ${aiReviewResult.criticalIssues.length - 5} more critical issues`
              );
            }
          }

        } catch (error) {
          this.logToProject(
            project.id,
            `⚠️ AI Review failed: ${error.message} - proceeding with basic verification`
          );
        }
      } else {
        this.logToProject(project.id, '⚠️ AI Reviewer not available (missing API key)');
      }

      // Convert verification result to CheckResult format for compatibility
      // Include AI review results if available
      const results = this.convertVerificationToCheckResults(verificationResult, aiReviewResult);

      return results;

    } catch (error) {
      // Fallback to basic command-line checks if verification manager fails
      this.logToProject(project.id, `⚠️ Verification manager failed, falling back to basic checks: ${error.message}`);
      return this.runBasicChecks(project);
    }
  }

  /**
   * Fallback method for basic command-line checks
   */
  private async runBasicChecks(project: PluginProject): Promise<CheckResult[]> {
    const results: CheckResult[] = [];
    const checks: Array<{ phase: 'tsc' | 'eslint' | 'build' | 'test'; command: string[] }> = [
      { phase: 'tsc', command: ['npx', 'tsc', '--noEmit'] },
      { phase: 'eslint', command: ['npx', 'eslint', 'src/'] },
      { phase: 'build', command: ['bun', 'run', 'build'] },
      { phase: 'test', command: ['bun', 'run', 'test'] },
    ];

    for (const check of checks) {
      const result = await this.runCheck(project, check.phase, check.command);
      results.push(result);
      // If a critical check fails, don't proceed to the next ones.
      if (!result.success && (check.phase === 'tsc' || check.phase === 'build')) {
        break;
      }
    }

    return results;
  }

  /**
   * Load project code for verification
   */
  private async loadProjectCode(project: PluginProject): Promise<Code> {
    const fs = await import('fs/promises');
    const path = await import('path');
    
    const files: Array<{ path: string; content: string }> = [];
    const srcDir = path.join(project.localPath!, 'src');

    async function loadDir(dir: string, relativeTo: string): Promise<void> {
      try {
        const items = await fs.readdir(dir);
        for (const item of items) {
          const fullPath = path.join(dir, item);
          const relativePath = path.relative(relativeTo, fullPath);
          
          const stat = await fs.stat(fullPath);
          if (stat.isDirectory()) {
            await loadDir(fullPath, relativeTo);
          } else if (item.endsWith('.ts') || item.endsWith('.js') || item.endsWith('.json')) {
            const content = await fs.readFile(fullPath, 'utf-8');
            files.push({ path: relativePath, content });
          }
        }
      } catch (error) {
        // Directory might not exist, skip
      }
    }

    await loadDir(srcDir, project.localPath!);

    return { 
      files: files.map(f => ({ ...f, language: 'typescript' })), // Add language property
      entryPoint: 'src/index.ts',
      dependencies: {},
      devDependencies: {}
    };
  }

  /**
   * Build verification context
   */
  private buildVerificationContext(project: PluginProject): VerificationContext {
    // Include custom instructions as requirements if they exist
    // This ensures benchmarks and specific requirements are considered
    const requirements: string[] = [];
    
    // Add MVP plan if it exists
    if (project.mvpPlan) {
      requirements.push(project.mvpPlan);
    }
    
    // Add custom instructions (which include benchmark requirements)
    if (project.customInstructions && project.customInstructions.length > 0) {
      requirements.push(...project.customInstructions);
    }
    
    // Extract constraints from custom instructions or use defaults
    const constraints: string[] = [];
    if (project.customInstructions) {
      // Look for constraint-like instructions
      const constraintKeywords = ['must', 'should', 'follow', 'use', 'include'];
      project.customInstructions.forEach(instruction => {
        if (constraintKeywords.some(keyword => instruction.toLowerCase().includes(keyword))) {
          constraints.push(instruction);
        }
      });
    }
    
    return {
      language: 'TypeScript',
      framework: 'ElizaOS',
      projectPath: project.localPath!,
      requirements,
      constraints,
      targetEnvironment: project.status.includes('mvp') ? 'development' : 'production',
    };
  }

  /**
   * Convert VerificationResult to CheckResult[] for compatibility
   */
  private convertVerificationToCheckResults(
    result: any, 
    aiReviewResult?: ComprehensiveReview | null
  ): CheckResult[] {
    const results: CheckResult[] = [];

    // Convert each stage to a CheckResult
    for (const stage of result.stages) {
      const checkResult: CheckResult = {
        phase: this.mapStageToPhase(stage.stage),
        success: stage.passed,
        duration: stage.duration || 0,
        errorCount: stage.findings.filter((f: any) => f.type === 'error').length,
        errors: stage.findings
          .filter((f: any) => f.type === 'error')
          .map((f: any) => f.message)
          .slice(0, 10), // Limit to first 10 errors
      };
      results.push(checkResult);
    }

    // Add AI review results as additional check phases
    if (aiReviewResult) {
      // Add a comprehensive AI review summary
      results.push({
        phase: 'ai_review' as any,
        success: aiReviewResult.passed && aiReviewResult.productionReady,
        duration: 0,
        errorCount: aiReviewResult.criticalIssues.length,
        errors: aiReviewResult.criticalIssues
          .map(issue => `${issue.type}: ${issue.description} (${issue.location})`)
          .slice(0, 10),
      });

      // Add stern critique as the final, most important check
      const sternCritique = aiReviewResult.stageResults.find(s => s.stage === 'final_stern_critique');
      if (sternCritique) {
        results.push({
          phase: 'stern_critique' as any,
          success: sternCritique.passed && sternCritique.criticalIssues.length === 0,
          duration: 0,
          errorCount: sternCritique.criticalIssues.length,
          errors: sternCritique.criticalIssues
            .map(issue => `CRITICAL: ${issue.description} (${issue.location})`)
            .slice(0, 10),
        });
      }
    }

    // If no stages, create a summary result
    if (results.length === 0) {
      results.push({
        phase: 'verification' as any,
        success: result.passed,
        duration: 0,
        errorCount: result.criticalErrors.length,
        errors: result.criticalErrors.map((e: any) => e.message).slice(0, 10),
      });
    }

    return results;
  }

  /**
   * Map verification stage names to CheckResult phases
   */
  private mapStageToPhase(stageName: string): 'tsc' | 'eslint' | 'build' | 'test' {
    const lower = stageName.toLowerCase();
    if (lower.includes('typescript') || lower.includes('syntax')) return 'tsc';
    if (lower.includes('eslint') || lower.includes('lint')) return 'eslint';
    if (lower.includes('test')) return 'test';
    return 'build'; // Default fallback
  }

  private async runCheck(
    project: PluginProject,
    phase: 'tsc' | 'eslint' | 'build' | 'test',
    command: string[]
  ): Promise<CheckResult> {
    const startTime = Date.now();
    const { success, output } = await this.runCommand(
      project,
      command[0],
      command.slice(1),
      `Running ${phase} check`
    );
    const duration = Date.now() - startTime;

    const errors: string[] = [];
    if (!success && output) {
      // Extract errors from output
      const lines = output.split('\n').filter((line) => line.trim());
      errors.push(...lines.slice(0, 10)); // Limit to first 10 error lines
    }

    return {
      phase,
      success,
      duration,
      errorCount: errors.length,
      errors,
    };
  }

  private async runCommand(
    project: PluginProject,
    command: string,
    args: string[],
    description: string
  ): Promise<{ success: boolean; output: string }> {
    if (!project.localPath) {
      throw new Error('Project local path is not set.');
    }

    this.logToProject(project.id, `${description}: ${command} ${args.join(' ')}`);

    try {
      // Create safe command
      const safeCommand = createSafeCommand(command, args);

      // Log command execution
      this.detailedLogger.log({
        type: 'service_call',
        phase: project.status,
        metadata: {
          projectId: project.id,
          projectName: project.name,
          serviceName: 'shell',
          actionName: 'runCommand',
          command,
          args,
        },
        data: {
          description,
          cwd: project.localPath,
        },
      });

      const result = await execAsync(safeCommand, {
        cwd: project.localPath,
        maxBuffer: 1024 * 1024 * 10, // 10MB buffer
      });

      // Log success
      this.detailedLogger.log({
        type: 'response',
        phase: project.status,
        metadata: {
          projectId: project.id,
          projectName: project.name,
          serviceName: 'shell',
          success: true,
        },
        data: {
          outputLength: result.stdout.length,
        },
      });

      return { success: true, output: result.stdout };
    } catch (error: any) {
      const output = error.stdout || error.message || 'Unknown error';

      // Log error
      this.detailedLogger.log({
        type: 'error',
        phase: project.status,
        metadata: {
          projectId: project.id,
          projectName: project.name,
          serviceName: 'shell',
          error: error.message,
        },
        data: {
          command,
          args,
          output,
          stderr: error.stderr,
        },
      });

      return { success: false, output };
    }
  }

  private async updateErrorAnalysis(project: PluginProject, result: CheckResult): Promise<void> {
    if (!result.errors || result.errors.length === 0) return;

    for (const error of result.errors) {
      const analysis = await this.parseErrorMessage(result.phase, error);
      if (analysis) {
        const key = `${analysis.file}:${analysis.line}:${analysis.errorType}`;
        const existing = project.errorAnalysis.get(key);
        if (existing) {
          existing.fixAttempts++;
        } else {
          project.errorAnalysis.set(key, analysis);
        }
      }
    }

    this.projects.set(project.id, project);
  }

  private async parseErrorMessage(
    phase: string,
    errorMessage: string
  ): Promise<ErrorAnalysis | null> {
    // TypeScript error pattern: file.ts:line:col - error TS####: message OR file.ts(line,col): error TS####: message
    const tsMatch = errorMessage.match(/([^:\s]+\.ts)(?:\(|:)(\d+)(?:,|:)(\d+)\)?:?\s*-?\s*error\s+TS\d+:\s*(.+)/);
    if (tsMatch) {
      // Extract just the filename from the path
      const filename = tsMatch[1].split('/').pop() || tsMatch[1];
      return {
        errorType: 'typescript',
        file: filename,
        line: parseInt(tsMatch[2]),
        column: parseInt(tsMatch[3]),
        message: tsMatch[4].trim(),
        suggestion: 'Fix the TypeScript type error',
        fixAttempts: 0,
        resolved: false,
      };
    }

    // ESLint error pattern: file.ts:line:col error message rule-name
    const eslintMatch = errorMessage.match(/(.+?):(\d+):(\d+)\s+error\s+(.+?)\s+(.+)$/);
    if (eslintMatch) {
      return {
        errorType: 'eslint',
        file: eslintMatch[1],
        line: parseInt(eslintMatch[2]),
        column: parseInt(eslintMatch[3]),
        message: eslintMatch[4],
        suggestion: `Fix the ESLint ${eslintMatch[5]} rule violation`,
        fixAttempts: 0,
        resolved: false,
      };
    }

    // Generic error
    return {
      errorType: phase as any,
      message: errorMessage,
      suggestion: `Fix the ${phase} error`,
      fixAttempts: 0,
      resolved: false,
    };
  }

  // Public methods for accessing project information
  public async getProject(projectId: string): Promise<PluginProject | null> {
    // Check active projects first
    const active = this.projects.get(projectId);
    if (active) return active;

    // Check lifecycle manager cache
    const cached = this.lifecycleManager.getActiveProject(projectId);
    if (cached) return cached;

    // Try to load from archive
    return await this.lifecycleManager.getCompletedProject(projectId);
  }

  public async getAllProjects(): Promise<PluginProject[]> {
    // Get all active projects
    const active = Array.from(this.projects.values());

    // Get all cached projects from lifecycle manager
    const cached = this.lifecycleManager.getAllActiveProjects();

    // Combine and dedupe
    const projectMap = new Map<string, PluginProject>();
    [...active, ...cached].forEach((p) => projectMap.set(p.id, p));

    return Array.from(projectMap.values());
  }

  public async getActiveProjects(): Promise<PluginProject[]> {
    return Array.from(this.projects.values()).filter(
      (p) => p.status !== 'completed' && p.status !== 'failed'
    );
  }

  public async getProjectsByUser(userId: UUID): Promise<PluginProject[]> {
    return Array.from(this.projects.values()).filter((p) => p.userId === userId);
  }

  public async provideSecrets(projectId: string, secrets: Record<string, string>): Promise<void> {
    const project = this.projects.get(projectId);
    if (!project) {
      throw new Error(`Project ${projectId} not found`);
    }

    // Store provided secrets using secrets manager
    for (const [secretName, secretValue] of Object.entries(secrets)) {
      if (project.requiredSecrets.includes(secretName)) {
        let success = false;
        
        if (this.secretsManager) {
          try {
            // Validate the secret before storing
            if (!this.validateSecret(secretName, secretValue)) {
              this.logToProject(projectId, `❌ Invalid format for secret: ${secretName}`);
              continue;
            }

            success = await this.secretsManager.set(
              secretName,
              secretValue,
              this.getSecretContext(),
              {
                type: this.inferSecretType(secretName),
                encrypted: true,
                plugin: '@elizaos/plugin-autocoder',
                description: `Secret for project ${projectId}`
              }
            );
            
            if (success) {
              project.providedSecrets.push(secretName);
              this.logToProject(projectId, `✅ Securely stored secret: ${secretName}`);
            } else {
              this.logToProject(projectId, `❌ Failed to store secret: ${secretName}`);
            }
          } catch (error) {
            this.logToProject(projectId, `❌ Error storing secret ${secretName}: ${error.message}`);
          }
        } else {
          // Fallback - just mark as provided (not secure but functional)
          project.providedSecrets.push(secretName);
          this.logToProject(projectId, `⚠️ Secret ${secretName} marked as provided (secrets manager unavailable)`);
        }
      }
    }

    // Check if all required secrets are now provided
    const stillMissing = project.requiredSecrets.filter(s => !project.providedSecrets.includes(s));
    if (stillMissing.length === 0) {
      this.logToProject(projectId, '🔐 All required secrets have been provided');
      if (project.status === 'awaiting-secrets') {
        // Determine next phase based on project type and previous phases
        let nextPhase: DevelopmentPhase;
        if (project.phaseHistory.includes('mvp_development')) {
          nextPhase = 'full_development';
        } else {
          nextPhase = 'mvp_development';
        }
        await this.updateProjectStatus(projectId, nextPhase);
        this.logToProject(projectId, `🚀 Project ready to proceed with ${nextPhase}`);
        // Resume the workflow
        if (nextPhase === 'mvp_development') {
          await this.executeMVPDevelopmentPhase(projectId);
        } else if (nextPhase === 'full_development') {
          // TODO: Implement full development phase
          this.logToProject(projectId, 'Full development phase not yet implemented');
        }
      }
    } else {
      this.logToProject(projectId, `Still missing secrets: ${stillMissing.join(', ')}`);
    }

    this.projects.set(projectId, project);
  }

  public async addUserFeedback(projectId: string, feedback: string): Promise<void> {
    const project = this.projects.get(projectId);
    if (!project) {
      throw new Error(`Project ${projectId} not found`);
    }

    project.lastUserFeedback = feedback;
    project.userNotifications.push({
      timestamp: new Date(),
      type: 'info',
      message: 'User feedback received',
      requiresAction: false,
      metadata: { feedback },
    });

    this.projects.set(projectId, project);
    this.logToProject(projectId, `User feedback: ${feedback}`);
  }

  public async addCustomInstructions(projectId: string, instructions: string[]): Promise<void> {
    const project = this.projects.get(projectId);
    if (!project) {
      throw new Error(`Project ${projectId} not found`);
    }

    project.customInstructions.push(...instructions);
    this.projects.set(projectId, project);
    this.logToProject(projectId, `Added ${instructions.length} custom instructions`);
  }

  public async setInfiniteMode(projectId: string, enabled: boolean): Promise<void> {
    const project = this.projects.get(projectId);
    if (!project) {
      throw new Error(`Project ${projectId} not found`);
    }

    project.infiniteMode = enabled;
    this.projects.set(projectId, project);
    this.logToProject(projectId, `Infinite mode ${enabled ? 'enabled' : 'disabled'}`);
  }

  /**
   * Build comprehensive prompt for Claude Code SDK
   */
  private buildClaudeCodePrompt(
    project: PluginProject,
    stage: 'mvp' | 'full',
    plan: string,
    errorAnalysis: Map<string, ErrorAnalysis>
  ): string {
    // Build dependency context
    let dependencySection = '';
    if (project.dependencyManifest && this.dependencyManager) {
      const requiredDeps = project.dependencyManifest.required || [];
      const serviceInterfaces = project.dependencyManifest.serviceInterfaces || new Map();
      const typeImports = project.dependencyManifest.typeImports || [];

      dependencySection = `
**ElizaOS Dependencies to Use:**
${requiredDeps.map((d: any) => `- ${d.name}: ${d.reason}`).join('\n')}

**Service Interfaces Available:**
${Array.from(serviceInterfaces.values())
  .map((s: any) => `### ${s.name}\n\`\`\`typescript\n${s.interface}\n\`\`\``)
  .join('\n\n')}

**Required Type Imports:**
\`\`\`typescript
${typeImports.join('\n')}
\`\`\`
`;
    }

    // Build error fixing section
    let errorFixSection = '';
    if (errorAnalysis.size > 0) {
      errorFixSection = '\n\n**CRITICAL ERRORS TO FIX:**\n' + '-'.repeat(40) + '\n';
      for (const analysis of errorAnalysis.values()) {
        errorFixSection += `File: ${analysis.file || 'N/A'}:${analysis.line || 'N/A'}\n`;
        errorFixSection += `Error: ${analysis.message}\n`;
        errorFixSection += `Fix Attempts: ${analysis.fixAttempts}\n`;
        errorFixSection += `Suggestion: ${analysis.suggestion}\n\n`;
      }
    }

    // Add custom instructions
    let customInstructionsSection = '';
    if (project.customInstructions && project.customInstructions.length > 0) {
      customInstructionsSection = `\n\n**CUSTOM INSTRUCTIONS:**\n${project.customInstructions.map((i) => `- ${i}`).join('\n')}\n`;
    }

    // Add user feedback if available
    let feedbackSection = '';
    if (project.lastUserFeedback) {
      feedbackSection = `\n\n**USER FEEDBACK:**\n${project.lastUserFeedback}\n`;
    }

    return `# ElizaOS Plugin Development Task

You are tasked with developing the "${project.name}" plugin for ElizaOS.

**Project Description:** ${project.description}

**Stage:** ${stage.toUpperCase()} Development

**Implementation Plan:**
---
${plan}
---
${dependencySection}${errorFixSection}${customInstructionsSection}${feedbackSection}

## Your Mission

${stage === 'mvp' 
  ? `Create a minimal viable plugin that demonstrates core functionality. Focus on:
1. Basic working implementation
2. Essential actions and providers
3. Proper ElizaOS integration
4. Clean, readable code` 
  : `Create a comprehensive, production-ready plugin with:
1. Full feature implementation
2. Comprehensive error handling
3. Detailed documentation
4. Production-grade code quality`
}

## Critical Requirements

1. **Follow the ElizaOS plugin architecture exactly**
2. **Use the template structure from plugin-starter**
3. **Implement all components specified in the plan**
4. **Fix ALL errors from previous iterations**
5. **Ensure TypeScript compilation works**
6. **Make all tests pass**
7. **Follow existing code patterns in the codebase**

## Development Process

1. **Explore**: Read the plugin-starter template to understand structure
2. **Plan**: Understand what needs to be implemented
3. **Implement**: Write complete, working code for all files
4. **Verify**: Run tsc, eslint, build, and test commands
5. **Fix**: Address any errors until everything passes
6. **Validate**: Ensure the plugin follows ElizaOS conventions

## Success Criteria

- All TypeScript errors resolved
- All ESLint warnings fixed  
- Build succeeds with \`bun run build\`
- All tests pass with \`elizaos test\`
- Plugin follows ElizaOS patterns and conventions
- Code is production-ready, not demo/placeholder code

Remember: This is production code, not a proof of concept. Write complete implementations.`;
  }

  /**
   * Build system prompt for Claude Code SDK
   */
  private buildClaudeCodeSystemPrompt(stage: 'mvp' | 'full'): string {
    return `# ElizaOS Plugin Development Expert

You are an expert ElizaOS plugin developer with deep knowledge of the framework architecture.

## Core Principles

1. **Production Quality**: Write complete, production-ready code - no stubs, demos, or TODOs
2. **ElizaOS Conventions**: Follow established patterns in actions, providers, services
3. **Type Safety**: Use proper TypeScript types from @elizaos/core
4. **Error Handling**: Implement comprehensive error handling and validation
5. **Testing**: Write thorough tests for all functionality
6. **Documentation**: Add clear JSDoc comments for public APIs

## Development Workflow

### Phase 1: Discovery & Planning
- Use Read tool to examine the plugin-starter template structure
- Understand the existing codebase patterns
- Review the implementation plan thoroughly

### Phase 2: Implementation
- Use Write tool to create complete files (not fragments)
- Follow the exact directory structure from plugin-starter
- Implement all actions, providers, services as specified
- Import proper types from @elizaos/core

### Phase 3: Verification Loop
- Use Bash tool to run: \`bun run build\`
- Use Bash tool to run: \`npx tsc --noEmit\`
- Use Bash tool to run: \`npx eslint src/\`
- Use Bash tool to run: \`elizaos test\`
- Fix any errors and re-run until all pass

### Phase 4: Quality Assurance
- Ensure all code follows ElizaOS patterns
- Verify proper error handling throughout
- Check that tests provide good coverage
- Confirm the plugin is production-ready

## Critical Guidelines

- **NEVER** leave placeholder code or TODOs
- **ALWAYS** implement complete functionality
- **ENSURE** all imports are correct and available
- **VERIFY** TypeScript compilation succeeds
- **CONFIRM** all tests pass before finishing
- **FOLLOW** existing ElizaOS plugin patterns exactly

## ElizaOS Plugin Structure

\`\`\`
src/
├── index.ts           # Main plugin export
├── actions/           # User-invokable actions
├── providers/         # Context providers  
├── services/          # Long-running services
├── types/             # TypeScript type definitions
└── __tests__/         # Comprehensive test suite
\`\`\`

Your goal is to create a fully functional, production-ready ElizaOS plugin.`;
  }
}
