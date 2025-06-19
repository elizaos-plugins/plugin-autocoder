import type { Plugin, IAgentRuntime } from '@elizaos/core';
import { orchestrationActions } from './actions/orchestration-actions.ts';
import { runSWEBenchAction, getSWEBenchStatsAction } from './actions/swe-bench-action.ts';
import { createMCPAction } from './actions/mcp-creation-action.ts';
import { echoAction } from './actions/echo.ts';
import { orchestrationProviders } from './providers/orchestration-providers.ts';
import { AutoCodeService } from './services/autocode-service.ts';
import { MCPCreationService } from './services/mcp-creation-service.ts';
import { wrapAutocoderActionsWithTrust } from './trust/autocoderTrustIntegration.ts';
import { elizaLogger } from '@elizaos/core';

// Export the plugin
export const autocoderPlugin: Plugin = {
  name: '@elizaos/plugin-autocoder',
  description: 'Self-improving agent system with SWE-bench evaluation, MCP server creation, and trust-based access control',
  
  // Declare dependencies on secrets manager, plugin manager, and trust system
  dependencies: ['plugin-env', 'plugin-manager', 'plugin-trust'],
  
  actions: [...orchestrationActions, runSWEBenchAction, getSWEBenchStatsAction, createMCPAction, echoAction],
  providers: [...orchestrationProviders],
  services: [AutoCodeService, MCPCreationService],
  
  async init(config: Record<string, string>, runtime: IAgentRuntime): Promise<void> {
    elizaLogger.info('\n┌════════════════════════════════════════┐');
    elizaLogger.info('│          AUTOCODER PLUGIN              │');
    elizaLogger.info('├────────────────────────────────────────┤');
    elizaLogger.info('│  Initializing AutoCoder Plugin...      │');
    elizaLogger.info('│  Enhanced with Trust Integration       │');
    elizaLogger.info('│  MCP Server Creation Support           │');
    elizaLogger.info('└════════════════════════════════════════┘');

    // Check if trust system is available
    const trustService = runtime.getService('trust-engine');
    const roleService = runtime.getService('role-manager');
    
    if (trustService && roleService) {
      elizaLogger.info('✔ Trust and role services available - applying access control');
      
      // Apply trust-based access control to all actions
      const trustWrappedActions = wrapAutocoderActionsWithTrust([
        ...orchestrationActions,
        runSWEBenchAction,
        getSWEBenchStatsAction,
        createMCPAction,
        echoAction,
      ]);
      
      // Register trust-enhanced actions
      for (const action of trustWrappedActions) {
        runtime.registerAction(action);
      }
      
      elizaLogger.info(`✔ Registered ${trustWrappedActions.length} trust-enhanced autocoder actions`);
      
      // Set up admin role validation for critical operations
      try {
        const securityModule = runtime.getService('security-module');
        if (securityModule && typeof (securityModule as any).configureHighRiskOperations === 'function') {
          await (securityModule as any).configureHighRiskOperations([
            'createPluginProject',
            'updatePluginProject', 
            'provideSecrets',
            'publishPlugin',
            'cancelProject',
            'createMCPServer',
          ]);
          elizaLogger.info('✔ Configured high-risk operation protection');
        }
      } catch (error) {
        elizaLogger.warn('⚠️ Failed to configure security module protection:', error);
      }
      
    } else {
      elizaLogger.warn('⚠️ Trust/role services not available - actions will run without access control');
      elizaLogger.warn('⚠️ This poses significant security risks for code generation and plugin publishing');
      
      // Register actions without trust enhancement (fallback mode)
      for (const action of [...orchestrationActions, runSWEBenchAction, getSWEBenchStatsAction, createMCPAction, echoAction]) {
        runtime.registerAction(action);
      }
    }
  },
};

// Default export
export default autocoderPlugin;
