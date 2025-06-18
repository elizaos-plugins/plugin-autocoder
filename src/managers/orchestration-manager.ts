import Anthropic from '@anthropic-ai/sdk';
import { elizaLogger as logger, type IAgentRuntime, type UUID } from '@elizaos/core';
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

  constructor(runtime: IAgentRuntime) {
    this.runtime = runtime;
    this.workflowStateMachine = WorkflowStateMachine;
    const dataDir = this.getDataDir();
    this.lifecycleManager = new ProjectLifecycleManager(path.join(dataDir, 'archives'));
    this.detailedLogger = new DetailedLogger(path.join(dataDir, 'logs'));
  }

  async initialize(): Promise<void> {
    const apiKey = this.runtime.getSetting('ANTHROPIC_API_KEY');
    if (apiKey) {
      this.anthropic = new Anthropic({ apiKey });
    }

    // Initialize managers
    this.serviceDiscovery = new ServiceDiscoveryManager();
    this.dependencyManager = new DependencyManager();
    this.componentCreation = new ComponentCreationManager();
    this.codeHealingService = new CodeHealingManager();

    logger.info('OrchestrationManager initialized');
  }

  async stop(): Promise<void> {
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

    this.logToProject(projectId, 'Starting plugin creation workflow...');

    // Log workflow start
    this.detailedLogger.log({
      type: 'action',
      phase: 'start',
      metadata: {
        projectId,
        projectName: project.name,
        actionName: 'startCreationWorkflow',
      },
      data: {
        workflowType: 'creation',
        phases: ['researching', 'mvp_planning', 'mvp_development'],
      },
    });

    // TODO: Implement the full workflow state machine
    // For now, this is a placeholder.
    await this.executeResearchPhase(projectId);
    await this.executeMVPPlanningPhase(projectId);
    await this.executeMVPDevelopmentPhase(projectId);
  }

  private async startUpdateWorkflow(projectId: string): Promise<void> {
    const project = this.projects.get(projectId);
    if (!project) return;

    this.logToProject(projectId, 'Starting plugin update workflow...');

    // Log workflow start
    this.detailedLogger.log({
      type: 'action',
      phase: 'start',
      metadata: {
        projectId,
        projectName: project.name,
        actionName: 'startUpdateWorkflow',
      },
      data: {
        workflowType: 'update',
        githubRepo: project.githubRepo,
      },
    });

    // TODO: Implement update workflow
    this.logToProject(projectId, 'Update workflow not yet implemented');
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
      const pluginManager = this.runtime.getService('plugin-manager') as PluginManagerService;
      if (pluginManager) {
        // TODO: Update when plugin-manager service API is available
        // const pluginSearchResults = await pluginManager.searchPlugins({
        //   query: searchTerms.join(' '),
        //   limit: 10,
        // });
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

    // Setup workspace first
    project.localPath = path.join(this.getDataDir(), 'plugins', project.id);
    await this.setupPluginWorkspace(project);

    // Use the shared development loop
    await this.runDevelopmentLoop(project, 'mvp');
  }

  /**
   * Run the iterative development loop for a project
   * This is exposed for testing purposes
   */
  private async runDevelopmentLoop(project: PluginProject, stage: 'mvp' | 'full'): Promise<void> {
    let success = false;
    project.currentIteration = 1;

    while (
      !success &&
      (project.infiniteMode || project.currentIteration <= project.maxIterations)
    ) {
      this.logToProject(
        project.id,
        `Starting ${stage.toUpperCase()} development iteration ${project.currentIteration}`
      );

      try {
        const errorAnalysis = this.analyzeErrors(project);
        await this.generatePluginCode(project, stage, errorAnalysis);

        const results = await this.runAllChecks(project);
        success = results.every((r) => r.success);

        if (success) {
          this.logToProject(
            project.id,
            `${stage.toUpperCase()} Iteration ${project.currentIteration} successful! All checks passed.`
          );
          const nextPhase = stage === 'mvp' ? 'mvp_testing' : 'full_testing';
          await this.updateProjectStatus(project.id, nextPhase);
        } else {
          this.logToProject(
            project.id,
            `${stage.toUpperCase()} Iteration ${project.currentIteration} failed. Analyzing errors...`
          );
          for (const result of results.filter((r) => !r.success)) {
            await this.updateErrorAnalysis(project, result);
          }
          project.currentIteration++;
          await new Promise((resolve) => setTimeout(resolve, 2000)); // Delay before next attempt
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown development error';
        this.logToProject(project.id, `Critical error in development loop: ${errorMessage}`);
        await this.updateProjectStatus(project.id, 'failed', errorMessage);
        throw error;
      }
    }

    if (!success) {
      throw new Error(
        `Failed to complete ${stage} development after ${project.maxIterations} iterations.`
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
    const results: CheckResult[] = [];
    const checks: Array<{ phase: 'tsc' | 'eslint' | 'build' | 'test'; command: string[] }> = [
      { phase: 'tsc', command: ['npx', 'tsc', '--noEmit'] },
      { phase: 'eslint', command: ['npx', 'eslint', 'src/'] },
      { phase: 'build', command: ['bun', 'run', 'build'] },
      { phase: 'test', command: ['bun', 'run', 'test'] },
    ];

    // Log check start
    this.detailedLogger.log({
      type: 'action',
      phase: project.status,
      metadata: {
        projectId: project.id,
        projectName: project.name,
        actionName: 'runAllChecks',
        iteration: project.currentIteration,
      },
      data: {
        checks: checks.map((c) => c.phase),
      },
    });

    for (const check of checks) {
      const result = await this.runCheck(project, check.phase, check.command);
      results.push(result);
      // If a critical check fails, don't proceed to the next ones.
      if (!result.success && (check.phase === 'tsc' || check.phase === 'build')) {
        break;
      }
    }

    // Log check results
    this.detailedLogger.log({
      type: 'response',
      phase: project.status,
      metadata: {
        projectId: project.id,
        projectName: project.name,
        actionName: 'runAllChecks',
        iteration: project.currentIteration,
        success: results.every((r) => r.success),
      },
      data: {
        results: results.map((r) => ({
          phase: r.phase,
          success: r.success,
          duration: r.duration,
          errorCount: r.errorCount,
        })),
      },
    });

    return results;
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
    // TypeScript error pattern: file.ts(line,col): error TS####: message
    const tsMatch = errorMessage.match(/(.+?)\((\d+),(\d+)\):\s*error\s+TS\d+:\s*(.+)/);
    if (tsMatch) {
      return {
        errorType: 'typescript',
        file: tsMatch[1],
        line: parseInt(tsMatch[2]),
        column: parseInt(tsMatch[3]),
        message: tsMatch[4],
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

    // Store provided secrets
    for (const secretName of Object.keys(secrets)) {
      if (project.requiredSecrets.includes(secretName)) {
        project.providedSecrets.push(secretName);
        // TODO: Store secret securely using env-manager service
      }
    }

    // Check if all secrets are provided
    const allProvided = project.requiredSecrets.every((s) => project.providedSecrets.includes(s));
    if (allProvided && project.status === 'awaiting-secrets') {
      // Resume workflow
      this.logToProject(projectId, 'All secrets provided, resuming workflow...');
      // TODO: Resume from where we left off
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
}
