import {
  type Action,
  type IAgentRuntime,
  type Memory,
  type State,
  type HandlerCallback,
  elizaLogger,
} from '@elizaos/core';

/**
 * Trust levels required for different autocoder operations
 * ADMIN_ROLE: Full system access for critical operations
 * DEVELOPER_ROLE: Code generation and project management
 * USER_ROLE: Basic project interaction and status checking
 */
export const AUTOCODER_TRUST_REQUIREMENTS = {
  // Critical system operations requiring ADMIN_ROLE
  CREATE_PROJECT: { minTrustScore: 0.8, requiredRole: 'ADMIN_ROLE' },
  UPDATE_PROJECT: { minTrustScore: 0.8, requiredRole: 'ADMIN_ROLE' },
  CANCEL_PROJECT: { minTrustScore: 0.7, requiredRole: 'ADMIN_ROLE' },
  PROVIDE_SECRETS: { minTrustScore: 0.9, requiredRole: 'ADMIN_ROLE' },
  PUBLISH_PLUGIN: { minTrustScore: 0.8, requiredRole: 'ADMIN_ROLE' },
  
  // Development operations requiring DEVELOPER_ROLE
  SET_INFINITE_MODE: { minTrustScore: 0.6, requiredRole: 'DEVELOPER_ROLE' },
  ADD_CUSTOM_INSTRUCTIONS: { minTrustScore: 0.6, requiredRole: 'DEVELOPER_ROLE' },
  RUN_BENCHMARK: { minTrustScore: 0.6, requiredRole: 'DEVELOPER_ROLE' },
  
  // Read-only operations requiring USER_ROLE
  CHECK_PROJECT_STATUS: { minTrustScore: 0.3, requiredRole: 'USER_ROLE' },
  GET_NOTIFICATIONS: { minTrustScore: 0.3, requiredRole: 'USER_ROLE' },
} as const;

/**
 * Enhanced trust validation for autocoder actions
 */
export async function validateAutocoderTrust(
  runtime: IAgentRuntime,
  message: Memory,
  actionName: string,
  requirements: { minTrustScore: number; requiredRole: string }
): Promise<{ allowed: boolean; reason?: string; trustScore?: number }> {
  try {
    // Get trust service
    const trustService = runtime.getService('trust-engine');
    if (!trustService) {
      elizaLogger.warn('Trust service not available - allowing action with warning');
      return { allowed: true, reason: 'Trust service unavailable' };
    }

    // Get role service
    const roleService = runtime.getService('role-manager');
    if (!roleService) {
      elizaLogger.warn('Role service not available - allowing action with warning');
      return { allowed: true, reason: 'Role service unavailable' };
    }

    const entityId = message.entityId || (message as any).userId;
    if (!entityId) {
      return { allowed: false, reason: 'No entity ID available for trust validation' };
    }

    // Check trust score
    const trustScore = await (trustService as any).getTrustScore(entityId);
    if (trustScore < requirements.minTrustScore) {
      elizaLogger.warn(
        `Autocoder action ${actionName} rejected: insufficient trust score ${trustScore} < ${requirements.minTrustScore}`
      );
      return {
        allowed: false,
        reason: `Insufficient trust score (${trustScore.toFixed(2)} < ${requirements.minTrustScore})`,
        trustScore,
      };
    }

    // Check role authorization
    const hasRole = await (roleService as any).hasRole(entityId, requirements.requiredRole);
    if (!hasRole) {
      elizaLogger.warn(
        `Autocoder action ${actionName} rejected: insufficient role permissions for ${requirements.requiredRole}`
      );
      return {
        allowed: false,
        reason: `Insufficient role permissions (requires ${requirements.requiredRole})`,
        trustScore,
      };
    }

    // Additional security checks for high-risk operations
    if (requirements.requiredRole === 'ADMIN_ROLE') {
      const securityModule = runtime.getService('security-module');
      if (securityModule) {
        const securityCheck = await (securityModule as any).validateHighRiskOperation({
          entityId,
          action: actionName,
          context: message.content,
          requiredPermissions: [requirements.requiredRole],
        });

        if (!securityCheck.allowed) {
          elizaLogger.warn(`Autocoder admin action ${actionName} blocked by security module`);
          return {
            allowed: false,
            reason: securityCheck.reason || 'Security validation failed',
            trustScore,
          };
        }
      }
    }

    elizaLogger.info(
      `Autocoder action ${actionName} authorized: trust=${trustScore.toFixed(2)}, role=${requirements.requiredRole}`
    );

    return { allowed: true, trustScore };
  } catch (error) {
    elizaLogger.error(`Trust validation error for autocoder action ${actionName}:`, error);
    return { allowed: false, reason: `Trust validation error: ${error.message}` };
  }
}

/**
 * Record autocoder action execution for trust tracking
 */
export async function recordAutocoderAction(
  runtime: IAgentRuntime,
  message: Memory,
  actionName: string,
  success: boolean,
  details?: any
): Promise<void> {
  try {
    const trustService = runtime.getService('trust-engine');
    if (!trustService) return;

    const entityId = message.entityId || (message as any).userId;
    if (!entityId) return;

    // Calculate trust impact based on action type and outcome
    let trustChange = 0;
    if (success) {
      // Positive trust for successful actions
      if (AUTOCODER_TRUST_REQUIREMENTS[actionName]?.requiredRole === 'ADMIN_ROLE') {
        trustChange = 0.02; // Small positive boost for admin actions
      } else if (AUTOCODER_TRUST_REQUIREMENTS[actionName]?.requiredRole === 'DEVELOPER_ROLE') {
        trustChange = 0.01; // Smaller boost for dev actions
      }
    } else {
      // Negative trust for failed critical actions
      if (AUTOCODER_TRUST_REQUIREMENTS[actionName]?.requiredRole === 'ADMIN_ROLE') {
        trustChange = -0.05; // Bigger penalty for failed admin actions
      } else {
        trustChange = -0.02; // Smaller penalty for other failures
      }
    }

    await (trustService as any).updateTrust({
      entityId,
      change: trustChange,
      reason: `Autocoder action: ${actionName} (${success ? 'success' : 'failure'})`,
      source: 'autocoder-plugin',
      evidence: {
        action: actionName,
        success,
        details,
        timestamp: new Date().toISOString(),
      },
    });

    elizaLogger.debug(
      `Recorded trust change ${trustChange} for autocoder action ${actionName} (${success ? 'success' : 'failure'})`
    );
  } catch (error) {
    elizaLogger.error('Failed to record autocoder action trust impact:', error);
  }
}

/**
 * Wrap an autocoder action with trust validation
 */
export function wrapAutocoderActionWithTrust(
  action: Action,
  trustRequirements: { minTrustScore: number; requiredRole: string }
): Action {
  const originalHandler = action.handler;
  const originalValidate = action.validate;

  return {
    ...action,
    validate: async (runtime: IAgentRuntime, message: Memory, state?: State) => {
      // First run original validation
      if (originalValidate) {
        const originalValid = await originalValidate(runtime, message, state);
        if (!originalValid) return false;
      }

      // Then check trust requirements
      const trustCheck = await validateAutocoderTrust(
        runtime,
        message,
        action.name,
        trustRequirements
      );

      return trustCheck.allowed;
    },
    handler: async (
      runtime: IAgentRuntime,
      message: Memory,
      state: State | undefined,
      options?: any,
      callback?: HandlerCallback
    ) => {
      // Validate trust before execution
      const trustCheck = await validateAutocoderTrust(
        runtime,
        message,
        action.name,
        trustRequirements
      );

      if (!trustCheck.allowed) {
        const errorMessage = `Access denied for autocoder action '${action.name}': ${trustCheck.reason}`;
        elizaLogger.warn(errorMessage);
        
        if (callback) {
          callback({
            text: errorMessage,
            content: { 
              error: trustCheck.reason,
              requiredTrustScore: trustRequirements.minTrustScore,
              requiredRole: trustRequirements.requiredRole,
              currentTrustScore: trustCheck.trustScore,
            },
          });
        }
        return false;
      }

      try {
        // Execute original handler
        const result = await originalHandler(runtime, message, state, options, callback);
        
        // Record successful execution
        await recordAutocoderAction(runtime, message, action.name, true, { result });
        
        return result;
      } catch (error) {
        // Record failed execution
        await recordAutocoderAction(runtime, message, action.name, false, { error: error.message });
        throw error;
      }
    },
  };
}

/**
 * Enhanced validation for plugin publishing operations
 */
export async function validatePluginPublishingSecurity(
  runtime: IAgentRuntime,
  message: Memory,
  projectDetails: any
): Promise<{ allowed: boolean; reason?: string }> {
  try {
    const securityModule = runtime.getService('security-module');
    if (!securityModule) {
      return { allowed: true, reason: 'Security module not available' };
    }

    // Check for malicious code patterns
    const codeSecurityCheck = await (securityModule as any).scanCodeForThreats({
      projectPath: projectDetails.localPath,
      entityId: message.entityId,
    });

    if (!codeSecurityCheck.safe) {
      return {
        allowed: false,
        reason: `Code security scan failed: ${codeSecurityCheck.threats.join(', ')}`,
      };
    }

    // Validate package.json for suspicious dependencies
    const dependencyCheck = await (securityModule as any).validateDependencies({
      projectPath: projectDetails.localPath,
    });

    if (!dependencyCheck.safe) {
      return {
        allowed: false,
        reason: `Dependency security scan failed: ${dependencyCheck.issues.join(', ')}`,
      };
    }

    return { allowed: true };
  } catch (error) {
    elizaLogger.error('Plugin publishing security validation error:', error);
    return { allowed: false, reason: `Security validation error: ${error.message}` };
  }
}

/**
 * Apply trust-based access control to all autocoder actions
 */
export function wrapAutocoderActionsWithTrust(actions: Action[]): Action[] {
  return actions.map((action) => {
    // Determine trust requirements based on action name
    let requirements: { minTrustScore: number; requiredRole: string } = AUTOCODER_TRUST_REQUIREMENTS.CHECK_PROJECT_STATUS; // Default to lowest requirement
    
    for (const [actionType, reqs] of Object.entries(AUTOCODER_TRUST_REQUIREMENTS)) {
      if (action.name.toUpperCase().includes(actionType)) {
        requirements = reqs as { minTrustScore: number; requiredRole: string };
        break;
      }
    }

    // Special handling for specific actions
    if (action.name.includes('createPlugin') || action.name.includes('Create')) {
      requirements = AUTOCODER_TRUST_REQUIREMENTS.CREATE_PROJECT;
    } else if (action.name.includes('updatePlugin') || action.name.includes('Update')) {
      requirements = AUTOCODER_TRUST_REQUIREMENTS.UPDATE_PROJECT;
    } else if (action.name.includes('provideSecrets') || action.name.includes('Secret')) {
      requirements = AUTOCODER_TRUST_REQUIREMENTS.PROVIDE_SECRETS;
    } else if (action.name.includes('publishPlugin') || action.name.includes('Publish')) {
      requirements = AUTOCODER_TRUST_REQUIREMENTS.PUBLISH_PLUGIN;
    } else if (action.name.includes('cancelProject') || action.name.includes('Cancel')) {
      requirements = AUTOCODER_TRUST_REQUIREMENTS.CANCEL_PROJECT;
    } else if (action.name.includes('setInfiniteMode') || action.name.includes('Infinite')) {
      requirements = AUTOCODER_TRUST_REQUIREMENTS.SET_INFINITE_MODE;
    } else if (action.name.includes('addCustomInstructions') || action.name.includes('Instructions')) {
      requirements = AUTOCODER_TRUST_REQUIREMENTS.ADD_CUSTOM_INSTRUCTIONS;
    } else if (action.name.includes('Notification')) {
      requirements = AUTOCODER_TRUST_REQUIREMENTS.GET_NOTIFICATIONS;
    }

    elizaLogger.info(
      `Wrapping autocoder action '${action.name}' with trust requirements: ${requirements.requiredRole}, min trust: ${requirements.minTrustScore}`
    );

    return wrapAutocoderActionWithTrust(action, requirements);
  });
}