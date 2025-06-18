import type { Provider, IAgentRuntime, Memory, State } from '@elizaos/core';
import { AutoCodeService } from '../services/autocode-service';

/**
 * Provider for active plugin development projects
 */
export const activeProjectsProvider: Provider = {
  name: 'activeProjects',
  description: 'Provides information about active plugin development projects',

  get: async (runtime: IAgentRuntime, message: Memory, state: State) => {
    const orchestrationService = runtime.getService('autocoder') as AutoCodeService;
    if (!orchestrationService) {
      return { text: 'No active plugin development projects.' };
    }

    const activeProjects = await orchestrationService.getActiveProjects();

    if (activeProjects.length === 0) {
      return { text: 'No active plugin development projects.' };
    }

    let projectInfo = `Active Plugin Development Projects (${activeProjects.length}):\n\n`;

    for (const project of activeProjects) {
      projectInfo += `• ${project.name} (${project.id.substring(0, 8)}...)\n`;
      projectInfo += `  Type: ${project.type} | Status: ${project.status}\n`;
      projectInfo += `  Phase: ${project.phase}/${project.totalPhases}\n`;

      if (project.requiredSecrets.length > project.providedSecrets.length) {
        const missing = project.requiredSecrets.filter((s) => !project.providedSecrets.includes(s));
        projectInfo += `  ⚠️ Waiting for secrets: ${missing.join(', ')}\n`;
      }

      projectInfo += '\n';
    }

    return { text: projectInfo.trim() };
  },
};

/**
 * Provider for orchestration capabilities
 */
export const orchestrationCapabilitiesProvider: Provider = {
  name: 'orchestrationCapabilities',
  description: 'Provides information about plugin development orchestration capabilities',

  get: async (runtime: IAgentRuntime, message: Memory, state: State) => {
    const orchestrationService = runtime.getService('autocoder') as AutoCodeService;
    if (!orchestrationService) {
      return { text: 'Plugin orchestration service is not available.' };
    }

    return {
      text: `Plugin Development Orchestration Capabilities:

• Create new plugins from scratch with automated workflow
• Update existing plugins with new features or fixes
• Research dependencies, APIs, and best practices
• Store research findings in knowledge base
• Manage required secrets and environment variables
• Clone plugin templates and existing plugins
• Run automated testing (unit tests and e2e tests)
• Create pull requests for completed work
• Track multiple projects in parallel
• Provide real-time status updates

Workflow Phases:
1. Research - Gather information about dependencies and similar code
2. Planning - Design plugin architecture and components
3. Implementation - Generate code with AI assistance
4. Testing - Run automated tests and fix issues
5. Deployment - Create pull request for review

Use "create a plugin for..." to start a new project or "update plugin..." to modify an existing one.`,
    };
  },
};

/**
 * Provider for project history
 */
export const projectHistoryProvider: Provider = {
  name: 'projectHistory',
  description:
    'Provides information about all plugin development projects including completed ones',

  get: async (runtime: IAgentRuntime, message: Memory, state: State) => {
    const orchestrationService = runtime.getService('autocoder') as AutoCodeService;
    if (!orchestrationService) {
      return { text: 'No plugin development history available.' };
    }

    const allProjects = await orchestrationService.getAllProjects();

    if (allProjects.length === 0) {
      return { text: 'No plugin development history available.' };
    }

    const completed = allProjects.filter((p) => p.status === 'completed');
    const failed = allProjects.filter((p) => p.status === 'failed');
    const active = allProjects.filter((p) => p.status !== 'completed' && p.status !== 'failed');

    let historyInfo = `Plugin Development History:\n\n`;

    if (active.length > 0) {
      historyInfo += `Active Projects (${active.length}):\n`;
      active.forEach((p) => {
        historyInfo += `• ${p.name} - ${p.status} (${p.phase}/${p.totalPhases})\n`;
      });
      historyInfo += '\n';
    }

    if (completed.length > 0) {
      historyInfo += `Completed Projects (${completed.length}):\n`;
      completed.forEach((p) => {
        historyInfo += `• ${p.name}`;
        if (p.pullRequestUrl) {
          historyInfo += ` - PR: ${p.pullRequestUrl}`;
        }
        historyInfo += '\n';
      });
      historyInfo += '\n';
    }

    if (failed.length > 0) {
      historyInfo += `Failed Projects (${failed.length}):\n`;
      failed.forEach((p) => {
        historyInfo += `• ${p.name} - ${p.error || 'Unknown error'}\n`;
      });
    }

    return { text: historyInfo.trim() };
  },
};

/**
 * Provider for plugin development best practices
 */
export const pluginBestPracticesProvider: Provider = {
  name: 'pluginBestPractices',
  description: 'Provides best practices for ElizaOS plugin development',

  get: async (runtime: IAgentRuntime, message: Memory, state: State) => {
    return {
      text: `ElizaOS Plugin Development Best Practices:

1. **Plugin Structure**:
   - Use TypeScript for type safety
   - Follow the standard plugin interface
   - Organize code into actions, providers, services, and evaluators
   - Include comprehensive tests

2. **Actions**:
   - Clear, descriptive names
   - Proper validation logic
   - Helpful examples
   - Return structured responses

3. **Services**:
   - Singleton pattern for stateful components
   - Proper initialization and cleanup
   - Error handling and recovery
   - Clear service type constants

4. **Testing**:
   - Unit tests for isolated logic
   - E2E tests for integration
   - Mock external dependencies in unit tests
   - Use real runtime in E2E tests

5. **Environment Variables**:
   - Declare in package.json elizaos section
   - Mark sensitive variables appropriately
   - Provide clear descriptions
   - Use runtime.getSetting() to access

6. **Documentation**:
   - Clear README with usage examples
   - Document all public APIs
   - Include configuration instructions
   - Provide troubleshooting guide`,
    };
  },
};

/**
 * Provider for real-time project updates
 */
export const projectUpdatesProvider: Provider = {
  name: 'projectUpdates',
  description:
    'Provides real-time updates and notifications for active plugin development projects',

  get: async (runtime: IAgentRuntime, message: Memory, state: State) => {
    const orchestrationService = runtime.getService('autocoder') as AutoCodeService;
    if (!orchestrationService) {
      return { text: 'No project updates available.' };
    }

    const activeProjects = await orchestrationService.getActiveProjects();
    if (activeProjects.length === 0) {
      return { text: 'No active projects to monitor.' };
    }

    let updates = `Real-time Project Updates:\n\n`;

    for (const project of activeProjects) {
      updates += `📦 ${project.name} (${project.id.substring(0, 8)}...)\n`;
      updates += `   Status: ${project.status} | Phase: ${project.phase}/${project.totalPhases}\n`;

      // Show current iteration if in development
      if (project.status === 'developing') {
        updates += `   Iteration: ${project.currentIteration}${project.infiniteMode ? ' (∞ mode)' : `/${project.maxIterations}`}\n`;

        // Show error summary
        const unresolvedErrors = Array.from(project.errorAnalysis?.values() || []).filter(
          (e) => !e.resolved
        );
        if (unresolvedErrors.length > 0) {
          updates += `   ⚠️ Errors: ${unresolvedErrors.length} unresolved\n`;
        }
      }

      // Show recent notifications
      const recentNotifs = project.userNotifications.slice(-3);
      if (recentNotifs.length > 0) {
        updates += `   Recent activity:\n`;
        for (const notif of recentNotifs) {
          const icon =
            notif.type === 'error'
              ? '❌'
              : notif.type === 'warning'
                ? '⚠️'
                : notif.type === 'success'
                  ? '✅'
                  : '•';
          updates += `     ${icon} ${notif.message.substring(0, 60)}${notif.message.length > 60 ? '...' : ''}\n`;
        }
      }

      // Show action required
      const actionRequired = project.userNotifications.filter((n) => n.requiresAction).slice(-1);
      if (actionRequired.length > 0) {
        updates += `   ⚡ ACTION REQUIRED: ${actionRequired[0].message}\n`;
      }

      updates += '\n';
    }

    return { text: updates.trim() };
  },
};

/**
 * Provider for development progress tracking
 */
export const developmentProgressProvider: Provider = {
  name: 'developmentProgress',
  description: 'Provides detailed progress information for plugin development projects',

  get: async (runtime: IAgentRuntime, message: Memory, state: State) => {
    const orchestrationService = runtime.getService('autocoder') as AutoCodeService;
    if (!orchestrationService) {
      return { text: 'No development progress available.' };
    }

    const userId = message.entityId;
    const userProjects = await orchestrationService.getProjectsByUser(userId);

    if (userProjects.length === 0) {
      return { text: 'You have no plugin development projects.' };
    }

    let progress = `Your Plugin Development Progress:\n\n`;

    for (const project of userProjects) {
      progress += `📊 ${project.name}\n`;
      progress += `   Created: ${project.createdAt.toLocaleDateString()}\n`;

      if (project.status === 'completed') {
        progress += `   ✅ Completed: ${project.completedAt?.toLocaleDateString()}\n`;
        if (project.pullRequestUrl) {
          progress += `   🔗 PR: ${project.pullRequestUrl}\n`;
        }
      } else if (project.status === 'failed') {
        progress += `   ❌ Failed: ${project.error}\n`;
      } else {
        // Active project
        const elapsedTime = Date.now() - project.developmentStartTime?.getTime() || 0;
        const elapsedMinutes = Math.floor(elapsedTime / 60000);
        progress += `   ⏱️ Time elapsed: ${elapsedMinutes} minutes\n`;

        // Success rate
        const totalAttempts = Array.from(project.failedAttempts?.values() || []).reduce(
          (sum, count) => sum + count,
          0
        );
        const successRate = project.successfulPhases?.length || 0;
        progress += `   📈 Success rate: ${successRate} phases completed, ${totalAttempts} failed attempts\n`;

        // Custom instructions
        if (project.customInstructions?.length > 0) {
          progress += `   📝 Custom instructions: ${project.customInstructions.length}\n`;
        }
      }

      progress += '\n';
    }

    return { text: progress.trim() };
  },
};

// Export all orchestration providers
export const orchestrationProviders = [
  activeProjectsProvider,
  orchestrationCapabilitiesProvider,
  projectHistoryProvider,
  pluginBestPracticesProvider,
  projectUpdatesProvider,
  developmentProgressProvider,
];
