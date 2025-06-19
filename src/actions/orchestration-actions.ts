import type { Action, IAgentRuntime, Memory, State, UUID } from '@elizaos/core';
import { logger } from '@elizaos/core';
import { AutoCodeService } from '../services/autocode-service.ts';
import { z } from 'zod';
import { runBenchmarkAction } from './benchmark-action.ts';

const CreatePluginProjectSchema = z.object({
  name: z.string().min(3, 'Plugin name must be at least 3 characters'),
  description: z.string().min(10, 'Description must be at least 10 characters'),
});

/**
 * Action to create a new plugin development project
 */
export const createPluginProjectAction: Action = {
  name: 'createPluginProject',
  description: 'Initiates a new plugin development project',
  examples: [
    [
      {
        name: 'user',
        content: {
          text: 'Create a plugin named "my-awesome-plugin" that does awesome things.',
        },
      },
      {
        name: 'agent',
        content: {
          text: "I'll start creating the 'my-awesome-plugin' for you. I will begin by researching the requirements.",
        },
      },
    ],
  ],
  validate: async (runtime: IAgentRuntime, message: Memory, state: State): Promise<boolean> => {
    // Basic validation, more can be added
    return message.content.text?.toLowerCase().includes('create a plugin') || false;
  },
  handler: async (runtime: IAgentRuntime, message: Memory, state: State) => {
    const service = runtime.getService('autocoder') as AutoCodeService;
    if (!service) return { text: 'Orchestration service is not available.' };

    const text = message.content.text || '';
    const nameMatch = text.match(/named "(.*?)"/);
    const description = text.substring(text.indexOf('that') + 5).trim();

    const name = nameMatch ? nameMatch[1] : `plugin-${Date.now()}`;

    const validation = CreatePluginProjectSchema.safeParse({ name, description });
    if (!validation.success) {
      return {
        text: `Invalid project details: ${validation.error.errors.map((e) => e.message).join(', ')}`,
      };
    }

    const project = await service.createPluginProject(name, description, message.entityId);

    return {
      text: `Started new plugin project: ${project.name} (ID: ${project.id}). I will start with the research phase.`,
    };
  },
};

const UpdatePluginProjectSchema = z.object({
  name: z.string().min(1, 'Plugin name must be provided'),
  description: z.string().min(10, 'Update description must be at least 10 characters'),
});

/**
 * Action to update an existing plugin
 */
export const updatePluginProjectAction: Action = {
  name: 'updatePluginProject',
  description: 'Updates an existing plugin with new features or fixes',
  examples: [
    [
      {
        name: 'user',
        content: { text: 'Update plugin "weather-tracker" with 5-day forecast support.' },
      },
    ],
  ],
  validate: async (runtime: IAgentRuntime, message: Memory, state: State): Promise<boolean> => {
    return message.content.text?.toLowerCase().includes('update plugin') || false;
  },
  handler: async (runtime: IAgentRuntime, message: Memory, state: State) => {
    const service = runtime.getService('autocoder') as AutoCodeService;
    if (!service) return { text: 'Orchestration service is not available.' };

    const text = message.content.text || '';
    const nameMatch = text.match(/plugin "(.*?)"/);
    const name = nameMatch ? nameMatch[1] : '';
    const description = text.substring(text.indexOf('with') + 5).trim();

    const validation = UpdatePluginProjectSchema.safeParse({ name, description });
    if (!validation.success) {
      return {
        text: `Invalid update details: ${validation.error.errors.map((e) => e.message).join(', ')}`,
      };
    }

    const project = await service.updatePluginProject(name, description, message.entityId);
    return { text: `Started plugin update project: ${project.name} (ID: ${project.id}).` };
  },
};

/**
 * Action to check project status
 */
export const checkProjectStatusAction: Action = {
  name: 'checkProjectStatus',
  description: 'Checks the status of an ongoing plugin development project',
  examples: [[{ name: 'user', content: { text: 'What is the status of project project-12345?' } }]],
  validate: async (runtime: IAgentRuntime, message: Memory, state: State): Promise<boolean> => {
    return message.content.text?.toLowerCase().includes('status of project') || false;
  },
  handler: async (runtime: IAgentRuntime, message: Memory, state: State) => {
    const service = runtime.getService('autocoder') as AutoCodeService;
    if (!service) return { text: 'Orchestration service is not available.' };

    const text = message.content.text || '';
    const idMatch = text.match(/project ([a-zA-Z0-9-]+)/);
    const projectId = idMatch ? idMatch[1] : null;

    if (projectId) {
      const project = await service.getProject(projectId);
      if (!project) return { text: `Project with ID ${projectId} not found.` };
      return {
        text: `Status of project ${project.name}: ${project.status}, Phase: ${project.phase}/${project.totalPhases}`,
      };
    }

    const activeProjects = await service.getActiveProjects();
    if (activeProjects.length === 0) {
      return { text: 'There are no active projects.' };
    }

    return {
      text:
        'Active projects:\n' +
        activeProjects.map((p) => `- ${p.name} (ID: ${p.id}): ${p.status}`).join('\n'),
    };
  },
};

/**
 * Action to provide secrets to a project
 */
export const provideSecretsAction: Action = {
  name: 'provideSecrets',
  description: 'Provides required secrets (like API keys) to a plugin development project',
  examples: [
    [
      { name: 'user', content: { text: 'Set ANTHROPIC_API_KEY to sk-ant-...' } },
      {
        name: 'user',
        content: { text: 'Provide secrets for project-12345: ANTHROPIC_API_KEY=sk-ant-...' },
      },
    ],
  ],
  validate: async (runtime: IAgentRuntime, message: Memory, state: State): Promise<boolean> => {
    const text = message.content.text?.toLowerCase() || '';
    return (
      text.includes('provide secret') ||
      (text.includes('set') && (text.includes('api_key') || text.includes('api key'))) ||
      text.includes('anthropic_api_key')
    );
  },
  handler: async (runtime: IAgentRuntime, message: Memory, state: State) => {
    const service = runtime.getService('autocoder') as AutoCodeService;
    if (!service) return { text: 'Orchestration service is not available.' };

    const text = message.content.text || '';

    // Extract project ID if provided
    const projectIdMatch = text.match(/project[- ]?([a-zA-Z0-9-]+)/i);
    let projectId: string | null = null;

    if (projectIdMatch) {
      projectId = projectIdMatch[1];
    } else {
      // Find the most recent project awaiting secrets
      const projects = await service.getActiveProjects();
      const awaitingProject = projects.find((p) => p.status === 'awaiting-secrets');
      if (awaitingProject) {
        projectId = awaitingProject.id;
      }
    }

    if (!projectId) {
      return { text: 'No project found that is awaiting secrets. Please specify a project ID.' };
    }

    // Extract secrets from the message
    const secrets: Record<string, string> = {};

    // Look for ANTHROPIC_API_KEY
    const anthropicMatch = text.match(/ANTHROPIC_API_KEY[=:\s]+([a-zA-Z0-9-_]+)/i);
    if (anthropicMatch) {
      secrets.ANTHROPIC_API_KEY = anthropicMatch[1];
    }

    // Look for GITHUB_TOKEN
    const githubMatch = text.match(/GITHUB_TOKEN[=:\s]+([a-zA-Z0-9-_]+)/i);
    if (githubMatch) {
      secrets.GITHUB_TOKEN = githubMatch[1];
    }

    // Look for NPM_TOKEN
    const npmMatch = text.match(/NPM_TOKEN[=:\s]+([a-zA-Z0-9-_]+)/i);
    if (npmMatch) {
      secrets.NPM_TOKEN = npmMatch[1];
    }

    if (Object.keys(secrets).length === 0) {
      return {
        text: 'No valid secrets found in your message. Please provide secrets in the format: SECRET_NAME=value',
      };
    }

    try {
      await service.provideSecrets(projectId, secrets);

      const project = await service.getProject(projectId);
      if (!project) return { text: 'Project not found.' };

      const providedKeys = Object.keys(secrets).join(', ');
      const remainingSecrets = project.requiredSecrets.filter(
        (s) => !project.providedSecrets.includes(s)
      );

      if (remainingSecrets.length === 0) {
        return {
          text: `Successfully provided secrets (${providedKeys}) to project ${project.name}. Development will resume automatically.`,
        };
      } else {
        return {
          text: `Successfully provided secrets (${providedKeys}) to project ${project.name}. Still waiting for: ${remainingSecrets.join(', ')}`,
        };
      }
    } catch (error) {
      return { text: `Failed to provide secrets: ${error.message}` };
    }
  },
};

/**
 * Action to cancel a project
 */
export const cancelProjectAction: Action = {
  name: 'cancelProject',
  description: 'Cancels an ongoing plugin development project',
  examples: [[{ name: 'user', content: { text: 'Cancel project project-12345' } }]],
  validate: async (runtime: IAgentRuntime, message: Memory, state: State): Promise<boolean> => {
    return message.content.text?.toLowerCase().includes('cancel project') || false;
  },
  handler: async (runtime: IAgentRuntime, message: Memory, state: State) => {
    const service = runtime.getService('autocoder') as AutoCodeService;
    if (!service) return { text: 'Orchestration service is not available.' };

    const text = message.content.text || '';
    const idMatch = text.match(/project ([a-zA-Z0-9-]+)/);
    const projectId = idMatch ? idMatch[1] : null;
    if (!projectId) return { text: 'Please specify a project ID to cancel.' };

    await service.cancelProject(projectId);
    return { text: `Project ${projectId} has been cancelled.` };
  },
};

/**
 * Action to enable infinite mode for a project
 */
export const setInfiniteModeAction: Action = {
  name: 'setInfiniteMode',
  description: 'Enables or disables infinite mode for a plugin development project',
  examples: [
    [{ name: 'user', content: { text: 'Enable infinite mode for project project-12345' } }],
    [{ name: 'user', content: { text: 'Disable infinite mode for project project-12345' } }],
  ],
  validate: async (runtime: IAgentRuntime, message: Memory, state: State): Promise<boolean> => {
    const text = message.content.text?.toLowerCase() || '';
    return text.includes('infinite mode') && text.includes('project');
  },
  handler: async (runtime: IAgentRuntime, message: Memory, state: State) => {
    const service = runtime.getService('autocoder') as AutoCodeService;
    if (!service) return { text: 'Orchestration service is not available.' };

    const text = message.content.text || '';
    const idMatch = text.match(/project ([a-zA-Z0-9-]+)/);
    const projectId = idMatch ? idMatch[1] : null;
    if (!projectId) return { text: 'Please specify a project ID.' };

    const enable = text.toLowerCase().includes('enable');
    await service.setInfiniteMode(projectId, enable);

    return {
      text: `Infinite mode ${enable ? 'enabled' : 'disabled'} for project ${projectId}. ${enable ? 'Development will continue until all tests pass.' : 'Development will stop after max iterations.'}`,
    };
  },
};

/**
 * Action to add custom instructions to a project
 */
export const addCustomInstructionsAction: Action = {
  name: 'addCustomInstructions',
  description: 'Adds custom instructions for the AI to follow during plugin development',
  examples: [
    [
      {
        name: 'user',
        content: {
          text: 'Add custom instructions to project project-12345: "Use axios for HTTP requests" and "Add detailed JSDoc comments"',
        },
      },
    ],
  ],
  validate: async (runtime: IAgentRuntime, message: Memory, state: State): Promise<boolean> => {
    const text = message.content.text?.toLowerCase() || '';
    return text.includes('custom instruction') && text.includes('project');
  },
  handler: async (runtime: IAgentRuntime, message: Memory, state: State) => {
    const service = runtime.getService('autocoder') as AutoCodeService;
    if (!service) return { text: 'Orchestration service is not available.' };

    const text = message.content.text || '';
    const idMatch = text.match(/project ([a-zA-Z0-9-]+)/);
    const projectId = idMatch ? idMatch[1] : null;
    if (!projectId) return { text: 'Please specify a project ID.' };

    // Extract instructions - look for quoted strings or text after colon
    const quotedInstructions = text.match(/"([^"]+)"/g);
    let instructions: string[] = [];

    if (quotedInstructions) {
      instructions = quotedInstructions.map((s) => s.replace(/"/g, ''));
    } else {
      // Try to extract after colon
      const colonIndex = text.indexOf(':');
      if (colonIndex > -1) {
        const instructionText = text.substring(colonIndex + 1).trim();
        instructions = instructionText.split(/\s+and\s+/i).map((s) => s.trim());
      }
    }

    if (instructions.length === 0) {
      return { text: 'Please provide instructions in quotes or after a colon.' };
    }

    await service.addCustomInstructions(projectId, instructions);

    return {
      text: `Added ${instructions.length} custom instructions to project ${projectId}:\n${instructions.map((inst, i) => `${i + 1}. ${inst}`).join('\n')}`,
    };
  },
};

/**
 * Action to publish a plugin to Plugin Manager
 */
export const publishPluginAction: Action = {
  name: 'publishPlugin',
  description: 'Publishes a completed plugin to the Plugin Manager registry',
  examples: [
    [{ name: 'user', content: { text: 'Publish project project-12345 to plugin registry' } }],
    [{ name: 'user', content: { text: 'Publish the weather-tracker plugin' } }],
  ],
  validate: async (runtime: IAgentRuntime, message: Memory, state: State): Promise<boolean> => {
    const text = message.content.text?.toLowerCase() || '';
    return text.includes('publish') && (text.includes('plugin') || text.includes('project'));
  },
  handler: async (runtime: IAgentRuntime, message: Memory, state: State) => {
    const service = runtime.getService('autocoder') as AutoCodeService;
    if (!service) return { text: 'Orchestration service is not available.' };

    const pluginManager = runtime.getService('PLUGIN_MANAGER') as any; // PluginManagerService
    if (!pluginManager) {
      return { text: 'Plugin Manager service is not available. Please ensure plugin-plugin-manager is loaded.' };
    }

    const text = message.content.text || '';
    const idMatch = text.match(/project ([a-zA-Z0-9-]+)/);
    const nameMatch = text.match(/plugin "(.*?)"/);
    
    let project: any = null;
    
    if (idMatch) {
      project = await service.getProject(idMatch[1]);
      if (!project) return { text: `Project ${idMatch[1]} not found.` };
    } else if (nameMatch) {
      // Try to find project by name
      const projects = await service.getAllProjects();
      project = projects.find(p => p.name === nameMatch[1]);
      if (!project) return { text: `No project found with name "${nameMatch[1]}".` };
    } else {
      // Try to find the most recent completed project
      const projects = await service.getProjectsByUser(message.entityId);
      project = projects.find(p => p.status === 'completed');
      if (!project) return { text: 'No completed projects found to publish.' };
    }

    // Check if project is completed
    if (project.status !== 'completed') {
      return { text: `Project ${project.name} is not yet completed. Current status: ${project.status}` };
    }

    if (!project.localPath) {
      return { text: `Project ${project.name} does not have a local path for publishing.` };
    }

    try {
      // Enhanced security validation for plugin publishing
      const securityModule = runtime.getService('security-module');
      if (securityModule) {
        const securityCheck = await (securityModule as any).validatePluginPublishing({
          projectPath: project.localPath,
          entityId: message.entityId,
          projectName: project.name,
        });

        if (!securityCheck.allowed) {
          return { text: `Plugin publishing blocked by security validation: ${securityCheck.reason}` };
        }

        logger.info(`Security validation passed for plugin ${project.name}`);
      }

      // Check what to publish (npm, github, registry)
      const publishToNpm = text.includes('npm');
      const publishToGithub = text.includes('github');
      const publishToRegistry = text.includes('registry') || (!publishToNpm && !publishToGithub);

      logger.info(`Publishing plugin ${project.name} to: npm=${publishToNpm}, github=${publishToGithub}, registry=${publishToRegistry}`);

      // Record trust event for publishing attempt
      const trustService = runtime.getService('trust-engine');
      if (trustService) {
        await (trustService as any).updateTrust({
          entityId: message.entityId,
          change: 0.05, // Positive trust for publishing plugins
          reason: `Publishing plugin: ${project.name}`,
          source: 'autocoder-plugin',
          evidence: {
            action: 'publishPlugin',
            projectName: project.name,
            publishTargets: { npm: publishToNpm, github: publishToGithub, registry: publishToRegistry },
          },
        });
      }

      const result = await pluginManager.publishPlugin({
        path: project.localPath,
        npm: publishToNpm,
        github: publishToGithub,
        registry: publishToRegistry
      });

      if (!result.success) {
        return { text: `Failed to publish plugin ${project.name}.` };
      }

      let successMessage = `Successfully published ${project.name}:\n`;
      if (result.npmPackage) {
        successMessage += `- NPM: ${result.npmPackage}\n`;
      }
      if (result.githubRepo) {
        successMessage += `- GitHub: ${result.githubRepo}\n`;
      }
      if (publishToRegistry) {
        successMessage += `- Plugin Registry: Available for discovery\n`;
      }

      // Update project with publishing info
      if (result.npmPackage) {
        project.npmPackage = result.npmPackage;
      }
      if (result.githubRepo) {
        project.githubRepo = result.githubRepo;
      }

      return { text: successMessage };
    } catch (error) {
      logger.error('Failed to publish plugin:', error);
      return { text: `Failed to publish plugin: ${error.message}` };
    }
  },
};

/**
 * Action to get project notifications
 */
export const getProjectNotificationsAction: Action = {
  name: 'getProjectNotifications',
  description: 'Gets recent notifications for a plugin development project',
  examples: [
    [{ name: 'user', content: { text: 'Show notifications for project project-12345' } }],
    [{ name: 'user', content: { text: 'What notifications do I have?' } }],
  ],
  validate: async (runtime: IAgentRuntime, message: Memory, state: State): Promise<boolean> => {
    const text = message.content.text?.toLowerCase() || '';
    return text.includes('notification');
  },
  handler: async (runtime: IAgentRuntime, message: Memory, state: State) => {
    const service = runtime.getService('autocoder') as AutoCodeService;
    if (!service) return { text: 'Orchestration service is not available.' };

    const text = message.content.text || '';
    const idMatch = text.match(/project ([a-zA-Z0-9-]+)/);

    if (idMatch) {
      // Get notifications for specific project
      const projectId = idMatch[1];
      const project = await service.getProject(projectId);
      if (!project) return { text: `Project ${projectId} not found.` };

      const recentNotifications = project.userNotifications.slice(-10);
      if (recentNotifications.length === 0) {
        return { text: `No notifications for project ${project.name}.` };
      }

      let response = `Recent notifications for ${project.name}:\n\n`;
      for (const notif of recentNotifications) {
        const icon =
          notif.type === 'error'
            ? '❌'
            : notif.type === 'warning'
              ? '⚠️'
              : notif.type === 'success'
                ? '✅'
                : 'ℹ️';
        response += `${icon} [${notif.timestamp.toLocaleTimeString()}] ${notif.message}\n`;
        if (notif.requiresAction) {
          response += `   ⚡ Action required: ${notif.actionType}\n`;
        }
      }

      return { text: response };
    } else {
      // Get notifications for all active projects
      const activeProjects = await service.getActiveProjects();
      if (activeProjects.length === 0) {
        return { text: 'No active projects with notifications.' };
      }

      let response = 'Notifications from active projects:\n\n';
      for (const project of activeProjects) {
        const actionRequired = project.userNotifications.filter((n) => n.requiresAction);
        if (actionRequired.length > 0) {
          response += `📌 ${project.name} (${project.id.substring(0, 8)}...):\n`;
          for (const notif of actionRequired) {
            response += `   ⚡ ${notif.message}\n`;
          }
          response += '\n';
        }
      }

      return { text: response || 'No action-required notifications.' };
    }
  },
};

// Export all orchestration actions
export const orchestrationActions = [
  createPluginProjectAction,
  updatePluginProjectAction,
  checkProjectStatusAction,
  provideSecretsAction,
  cancelProjectAction,
  setInfiniteModeAction,
  addCustomInstructionsAction,
  getProjectNotificationsAction,
  publishPluginAction,
  runBenchmarkAction,
];
