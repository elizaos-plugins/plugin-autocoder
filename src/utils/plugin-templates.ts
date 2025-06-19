export const generateActionCode = (
  name: string,
  description: string,
  parameters?: Record<string, any>
): string => {
  const camelCaseName = name.charAt(0).toLowerCase() + name.slice(1);

  return `import {
  Action,
  IAgentRuntime,
  Memory,
  State,
  HandlerCallback,
  type ActionExample
} from "@elizaos/core";

export const ${camelCaseName}Action: Action = {
  name: "${name}",
  description: "${description}",
  similes: [
    // Add similar phrases that might trigger this action
    "${name.toLowerCase()}",
    "${description.toLowerCase().split(' ').slice(0, 3).join(' ')}"
  ],
  examples: [
    [
      {
        name: "user",
        content: {
          text: "Please ${name.toLowerCase()}"
        }
      } as ActionExample,
      {
        name: "agent", 
        content: {
          text: "I'll ${description.toLowerCase()} for you."
        }
      } as ActionExample
    ]
  ],
  validate: async (
    _runtime: IAgentRuntime,
    message: Memory,
    _state?: State
  ): Promise<boolean> => {
    // Add validation logic here
    const text = message.content?.text || '';
    return text.length > 0;
  },
  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    state?: State,
    options?: { [key: string]: unknown },
    callback?: HandlerCallback
  ): Promise<string> => {
    try {
      // Extract parameters from message or options
      const messageText = message.content?.text || '';
      ${parameters ? `
      // Expected parameters: ${JSON.stringify(parameters, null, 2)}
      // Extract parameters from the message or options
      const params = options || {};
      ` : ''}
      
      // Implement the action logic
      // For now, we'll acknowledge the request and simulate processing
      const actionDescription = "${description}";
      const responseText = \`I'm now executing the ${name} action to \${actionDescription.toLowerCase()}. This has been completed successfully.\`;
      
      // You can access runtime services like this:
      // const myService = runtime.getService('MY_SERVICE');
      
      // For configuration values, use secrets manager when available:
      // const secretsManager = runtime.getService('SECRETS') as EnhancedSecretManager;
      // const apiKey = await secretsManager?.get('API_KEY', { level: 'global', agentId: runtime.agentId, requesterId: runtime.agentId });
      // Or use fallback: const apiKey = runtime.getSetting('API_KEY');
      
      // Update state if needed
      if (state) {
        state.lastAction = "${name}";
        state.lastActionTime = new Date().toISOString();
      }
      
      if (callback) {
        await callback({
          text: responseText,
          type: "text",
          metadata: {
            action: "${name}",
            success: true,
            timestamp: new Date().toISOString()
          }
        });
      }
      
      return responseText;
    } catch (error) {
      const errorMessage = error instanceof Error 
        ? \`Failed to execute ${name}: \${error.message}\`
        : \`Failed to execute ${name}: Unknown error\`;
      
      if (callback) {
        await callback({
          text: errorMessage,
          type: "error",
          metadata: {
            action: "${name}",
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error'
          }
        });
      }
      
      return errorMessage;
    }
  }
};
`;
};

export const generateProviderCode = (
  name: string,
  description: string,
  dataStructure?: Record<string, any>
): string => {
  const camelCaseName = name.charAt(0).toLowerCase() + name.slice(1);

  return `import {
  Provider,
  IAgentRuntime,
  Memory,
  State,
  ProviderResult
} from "@elizaos/core";

export const ${camelCaseName}Provider: Provider = {
  name: "${name}",
  description: "${description}",
  get: async (
    runtime: IAgentRuntime,
    message: Memory,
    state: State
  ): Promise<ProviderResult> => {
    try {
      // Collect contextual data based on the provider's purpose
      const context = message.content?.text || '';
      const currentTime = new Date().toISOString();
      
      ${
        dataStructure ? `// Build the expected data structure: ${JSON.stringify(dataStructure, null, 2)}
      const providerData = {
        ${Object.entries(dataStructure || {}).map(([key, type]) => {
          if (type === 'string') return `${key}: 'Sample ${key} value'`;
          if (type === 'number') return `${key}: 0`;
          if (type === 'boolean') return `${key}: false`;
          if (type === 'array') return `${key}: []`;
          return `${key}: {}`;
        }).join(',\n        ')},
        timestamp: currentTime,
        source: "${name}",
        context: context.substring(0, 100) // Include some context
      };` : `
      // Create provider data based on the description: ${description}
      const providerData = {
        timestamp: currentTime,
        source: "${name}",
        context: context.substring(0, 100),
        // Add relevant data fields here based on what this provider should provide
        status: 'active',
        available: true
      };`
      }
      
      // You can access runtime services and state:
      // const service = runtime.getService('SOME_SERVICE');
      // const lastAction = state.lastAction;
      
      // Format the data as human-readable text
      const formattedText = \`${name} Information:\n\` +
        Object.entries(providerData)
          .map(([key, value]) => \`  - \${key}: \${value}\`)
          .join('\n');
      
      return {
        text: formattedText,
        data: providerData
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      return {
        text: \`Unable to retrieve ${name} data: \${errorMsg}\`,
        data: { 
          error: errorMsg,
          timestamp: new Date().toISOString(),
          source: "${name}"
        }
      };
    }
  }
};
`;
};

export const generateServiceCode = (
  name: string,
  description: string,
  methods?: string[]
): string => {
  const className = name.charAt(0).toUpperCase() + name.slice(1);

  return `import { Service, IAgentRuntime, logger } from "@elizaos/core";

// Extend the ServiceTypeRegistry for this service
declare module "@elizaos/core" {
  interface ServiceTypeRegistry {
    ${name.toUpperCase()}: "${name.toLowerCase()}";
  }
}

export class ${className} extends Service {
  static serviceType: "${name.toLowerCase()}" = "${name.toLowerCase()}";
  
  public readonly capabilityDescription: string = "${description}";
  
  constructor(runtime?: IAgentRuntime) {
    super(runtime);
  }
  
  async stop(): Promise<void> {
    logger.info(\`Stopping ${className}\`);
    // Clean up any resources used by this service
    // For example: close connections, clear intervals, etc.
    this.cleanupResources();
  }
  
  private cleanupResources(): void {
    // Implement cleanup logic specific to this service
    logger.debug(\`${className} resources cleaned up\`);
  }
  
  static async start(runtime: IAgentRuntime): Promise<${className}> {
    const service = new ${className}(runtime);
    await service.initialize(runtime);
    return service;
  }
  
  async initialize(runtime: IAgentRuntime): Promise<void> {
    this.runtime = runtime;
    logger.info(\`Initializing ${className}\`);
    
    // Initialize service resources
    // For example: establish connections, load configuration, etc.
    try {
      // Service-specific initialization
      this.setupInternalState();
      logger.info(\`${className} initialized successfully\`);
    } catch (error) {
      logger.error(\`Failed to initialize ${className}:\`, error);
      throw error;
    }
  }
  
  private setupInternalState(): void {
    // Initialize any internal state or resources
    logger.debug(\`${className} internal state configured\`);
  }
  
  ${
    methods
      ? methods
          .map(
            (method) => `
  async ${method}(...args: any[]): Promise<any> {
    logger.info(\`${className}.${method} called with args:\`, args);
    
    try {
      // Implement the ${method} functionality
      // This is a placeholder that returns a success response
      const result = {
        success: true,
        method: '${method}',
        timestamp: new Date().toISOString(),
        // Add method-specific response data here
      };
      
      logger.debug(\`${className}.${method} completed successfully\`);
      return result;
    } catch (error) {
      logger.error(\`${className}.${method} failed:\`, error);
      throw error;
    }
  }
  `
          )
          .join('\n')
      : ''
  }
  
  // Additional service methods
  async getStatus(): Promise<{ active: boolean; uptime: number }> {
    return {
      active: true,
      uptime: Date.now() - (this as any).startTime || 0
    };
  }
}
`;
};

export const generateEvaluatorCode = (
  name: string,
  description: string,
  triggers?: string[]
): string => {
  const camelCaseName = name.charAt(0).toLowerCase() + name.slice(1);

  return `import {
  Evaluator,
  IAgentRuntime,
  Memory,
  State,
  logger
} from "@elizaos/core";

export const ${camelCaseName}Evaluator: Evaluator = {
  name: "${name}",
  description: "${description}",
  similes: [
    "${name.toLowerCase()}",
    "${description.toLowerCase().split(' ').slice(0, 3).join(' ')}"
  ],
  examples: [
    {
      context: "When evaluating ${name.toLowerCase()}",
      messages: [
        {
          name: "user",
          content: {
            text: "Analyze this for ${name.toLowerCase()}"
          }
        }
      ],
      expectedOutcome: "Should trigger ${name} evaluation"
    }
  ],
  validate: async (
    runtime: IAgentRuntime,
    message: Memory,
    state?: State
  ): Promise<boolean> => {
    // Check if this evaluator should run based on message content and state
    const content = message.content?.text?.toLowerCase() || '';
    
    ${
      triggers && triggers.length > 0
        ? `// Check against configured triggers: ${triggers.join(', ')}
    const shouldTrigger = ${triggers.map(t => `content.includes('${t.toLowerCase()}')`).join(' || ')};
    
    if (!shouldTrigger) {
      return false;
    }` 
        : `// Default validation - run on messages with sufficient content
    if (content.length < 5) {
      return false;
    }`
    }
    
    // Additional validation logic
    // For example, check if enough time has passed since last evaluation
    if (state?.lastEvaluation) {
      const timeSinceLastEval = Date.now() - new Date(state.lastEvaluation.timestamp).getTime();
      const minInterval = 60000; // 1 minute minimum between evaluations
      
      if (timeSinceLastEval < minInterval) {
        logger.debug(\`${name} evaluator skipped - too soon since last evaluation\`);
        return false;
      }
    }
    
    return true;
  },
  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    state?: State
  ): Promise<string> => {
    try {
      logger.info(\`Running ${name} evaluator\`);
      
      const content = message.content?.text || '';
      
      // Perform evaluation based on the evaluator's purpose
      // Example: sentiment analysis, content moderation, quality check, etc.
      const evaluationCriteria = {
        relevance: content.length > 10 ? 0.8 : 0.3,
        quality: content.includes('please') || content.includes('thank') ? 0.9 : 0.6,
        appropriateness: 1.0, // Assume appropriate unless detected otherwise
      };
      
      // Calculate overall score
      const scores = Object.values(evaluationCriteria);
      const overallScore = scores.reduce((a, b) => a + b, 0) / scores.length;
      
      const result = {
        evaluated: true,
        score: overallScore,
        criteria: evaluationCriteria,
        details: \`Content evaluated for ${description.toLowerCase()}\`,
        recommendation: overallScore > 0.7 ? 'proceed' : 'review',
        timestamp: new Date().toISOString()
      };
      
      // Update state with evaluation results if needed
      if (state) {
        state.lastEvaluation = {
          evaluator: "${name}",
          score: overallScore,
          timestamp: result.timestamp
        };
      }
      
      // You can trigger actions based on evaluation results
      // const actions = runtime.getActions();
      // if (overallScore < 0.5 && actions.has('flagContent')) {
      //   await actions.get('flagContent').handler(runtime, message, state);
      // }
      
      return \`${name} evaluation complete. Score: \${(overallScore * 100).toFixed(1)}% - \${result.recommendation}\`;
    } catch (error) {
      logger.error(\`${name} evaluator error:\`, error);
      return \`${name} evaluation failed: \${error instanceof Error ? error.message : 'Unknown error'}\`;
    }
  }
};
`;
};

export const generatePluginIndex = (pluginName: string, specification: any): string => {
  const cleanPluginName = pluginName.replace(/^@[^/]+\//, '').replace(/[-_]/g, '');
  const pluginClassName =
    cleanPluginName.charAt(0).toUpperCase() + cleanPluginName.slice(1) + 'Plugin';

  const imports: string[] = [];
  const exports: string[] = [];

  // Always import from core
  imports.push(`import { Plugin, IAgentRuntime, logger } from "@elizaos/core";`);
  
  // Determine if this plugin needs secrets manager based on environment variables
  const needsSecretsManager = specification.environmentVariables?.length > 0;
  if (needsSecretsManager) {
    imports.push(`import type { EnhancedSecretManager, SecretContext } from "@elizaos/plugin-secrets-manager";`);
  }

  if (specification.actions?.length) {
    specification.actions.forEach((action: any) => {
      const camelCaseName = action.name.charAt(0).toLowerCase() + action.name.slice(1);
      imports.push(`import { ${camelCaseName}Action } from './actions/${action.name}.ts';`);
      exports.push(`${camelCaseName}Action`);
    });
  }

  if (specification.providers?.length) {
    specification.providers.forEach((provider: any) => {
      const camelCaseName = provider.name.charAt(0).toLowerCase() + provider.name.slice(1);
      // Check if provider.name already ends with "Provider"
      const exportName = provider.name.endsWith('Provider')
        ? camelCaseName
        : `${camelCaseName}Provider`;
      imports.push(`import { ${exportName} } from './providers/${provider.name}.ts';`);
      exports.push(exportName);
    });
  }

  if (specification.services?.length) {
    specification.services.forEach((service: any) => {
      imports.push(`import { ${service.name} } from './services/${service.name}.ts';`);
      exports.push(`${service.name}`);
    });
  }

  if (specification.evaluators?.length) {
    specification.evaluators.forEach((evaluator: any) => {
      const camelCaseName = evaluator.name.charAt(0).toLowerCase() + evaluator.name.slice(1);
      imports.push(
        `import { ${camelCaseName}Evaluator } from './evaluators/${evaluator.name}.ts';`
      );
      exports.push(`${camelCaseName}Evaluator`);
    });
  }

  // Determine dependencies
  const dependencies = specification.dependencies || [];
  if (needsSecretsManager && !dependencies.includes('plugin-env')) {
    dependencies.push('plugin-env');
  }

  return `${imports.join('\n')}

${needsSecretsManager ? `// Helper functions for secrets manager integration
function getSecretContext(runtime: IAgentRuntime): SecretContext {
  return {
    level: 'global',
    agentId: runtime.agentId,
    requesterId: runtime.agentId
  };
}

async function getConfigValue(runtime: IAgentRuntime, key: string): Promise<string | undefined> {
  const secretsManager = runtime.getService('SECRETS') as EnhancedSecretManager;
  
  if (secretsManager) {
    try {
      const value = await secretsManager.get(key, getSecretContext(runtime));
      if (value) {
        return value;
      }
    } catch (error) {
      logger.warn(\`Failed to get \${key} from secrets manager:\`, error);
    }
  }
  
  // Fallback to environment variable for backward compatibility
  return process.env[key];
}

async function setConfigValue(
  runtime: IAgentRuntime, 
  key: string, 
  value: string,
  metadata?: { type?: string; required?: boolean; sensitive?: boolean }
): Promise<boolean> {
  const secretsManager = runtime.getService('SECRETS') as EnhancedSecretManager;
  
  if (secretsManager) {
    try {
      return await secretsManager.set(
        key,
        value,
        getSecretContext(runtime),
        {
          type: metadata?.type || 'config',
          encrypted: metadata?.sensitive || false,
          plugin: '${pluginName}'
        }
      );
    } catch (error) {
      logger.error(\`Failed to set \${key} in secrets manager:\`, error);
    }
  }
  
  // Fallback to environment variable
  process.env[key] = value;
  return true;
}

` : ''}export const ${pluginClassName}: Plugin = {
  name: "${pluginName}",
  description: "${specification.description}",${dependencies.length > 0 ? `
  
  // Declare dependencies${needsSecretsManager ? ' including secrets manager for secure configuration' : ''}
  dependencies: [${dependencies.map(d => `'${d}'`).join(', ')}],` : ''}${specification.environmentVariables?.length > 0 ? `
  
  // Declare environment variables for secrets manager
  declaredEnvVars: {${specification.environmentVariables.map((envVar: any) => `
    '${envVar.name}': {
      type: '${envVar.sensitive ? 'api_key' : 'config'}',
      required: ${envVar.required || false},
      description: '${envVar.description || ''}',
      canGenerate: false
    }`).join(',')}
  },` : ''}${needsSecretsManager ? `
  
  async init(config: Record<string, string>, runtime: IAgentRuntime) {
    logger.info('Initializing ${pluginName}');
    
    try {
      // Load and validate configuration using secrets manager${specification.environmentVariables?.map((envVar: any) => `
      const ${envVar.name.toLowerCase()} = config?.${envVar.name} || await getConfigValue(runtime, '${envVar.name}');${envVar.required ? `
      if (!${envVar.name.toLowerCase()}) {
        throw new Error('${envVar.name} is required but not configured');
      }` : ''}
      
      if (${envVar.name.toLowerCase()}) {
        await setConfigValue(runtime, '${envVar.name}', ${envVar.name.toLowerCase()}, {
          type: '${envVar.sensitive ? 'api_key' : 'config'}',
          required: ${envVar.required || false},
          sensitive: ${envVar.sensitive || false}
        });
      }`).join('\n      ')}
      
      logger.info('${pluginName} initialized successfully');
    } catch (error) {
      logger.error('Failed to initialize ${pluginName}:', error);
      throw error;
    }
  },` : ''}${
    specification.actions?.length
      ? `
  
  actions: [
    ${specification.actions.map((a: any) => `${a.name.charAt(0).toLowerCase() + a.name.slice(1)}Action`).join(',\n    ')}
  ],`
      : ''
  }${
    specification.providers?.length
      ? `
  
  providers: [
    ${specification.providers
      .map((p: any) => {
        const camelCaseName = p.name.charAt(0).toLowerCase() + p.name.slice(1);
        return p.name.endsWith('Provider') ? camelCaseName : `${camelCaseName}Provider`;
      })
      .join(',\n    ')}
  ],`
      : ''
  }${
    specification.services?.length
      ? `
  
  services: [
    ${specification.services.map((s: any) => `${s.name}`).join(',\n    ')}
  ],`
      : ''
  }${
    specification.evaluators?.length
      ? `
  
  evaluators: [
    ${specification.evaluators.map((e: any) => `${e.name.charAt(0).toLowerCase() + e.name.slice(1)}Evaluator`).join(',\n    ')}
  ]`
      : ''
  }
};

// Export individual components for direct use
export {
  ${exports.join(',\n  ')}
};

// Default export
export default ${pluginClassName};
`;
};

export const generateTestCode = (componentName: string, componentType: string): string => {
  const camelCaseName = componentName.charAt(0).toLowerCase() + componentName.slice(1);
  const typeLower = componentType.toLowerCase();

  return `import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ${camelCaseName}${componentType} } from '../${typeLower}s/${componentName}';
import { IAgentRuntime, Memory, State } from '@elizaos/core';

// Mock runtime
const createMockRuntime = (): IAgentRuntime => {
  return {
    getSetting: vi.fn(),
    services: new Map(),
    providers: new Map(),
    actions: new Map(),
    evaluators: new Map()
  } as any;
};

// Mock memory
const createMockMemory = (text: string): Memory => ({
  id: crypto.randomUUID(),
  content: { text },
  userId: 'test-user',
  roomId: 'test-room',
  entityId: 'test-entity',
  createdAt: Date.now()
} as Memory);

describe('${componentName}${componentType}', () => {
  let mockRuntime: IAgentRuntime;
  let mockState: State;
  
  beforeEach(() => {
    mockRuntime = createMockRuntime();
    mockState = { values: {}, data: {}, text: "" };
    vi.clearAllMocks();
  });
  
  it('should be properly defined', () => {
    expect(${camelCaseName}${componentType}).toBeDefined();
    expect(${camelCaseName}${componentType}.name).toBe('${componentName}');
  });
  
  ${
    componentType === 'Action'
      ? `
  describe('validate', () => {
    it('should validate valid input', async () => {
      const message = createMockMemory('test input');
      const result = await ${camelCaseName}${componentType}.validate(mockRuntime, message, mockState);
      expect(result).toBe(true);
    });
    
    it('should reject empty input', async () => {
      const message = createMockMemory('');
      const result = await ${camelCaseName}${componentType}.validate(mockRuntime, message, mockState);
      expect(result).toBe(false);
    });
  });
  
  describe('handler', () => {
    it('should handle valid request', async () => {
      const message = createMockMemory('test request');
      const result = await ${camelCaseName}${componentType}.handler(mockRuntime, message, mockState);
      expect(result).toContain('Successfully');
    });
    
    it('should handle errors gracefully', async () => {
      const message = createMockMemory('trigger error');
      // TODO: Mock error condition
      const result = await ${camelCaseName}${componentType}.handler(mockRuntime, message, mockState);
      expect(typeof result).toBe('string');
    });
  });
  `
      : ''
  }
  
  ${
    componentType === 'Provider'
      ? `
  describe('get', () => {
    it('should provide data', async () => {
      const message = createMockMemory('test');
      const result = await ${camelCaseName}${componentType}.get(mockRuntime, message, mockState);
      expect(result).toBeDefined();
      expect(result.text).toBeDefined();
      expect(result.data).toBeDefined();
    });
    
    it('should handle errors', async () => {
      // TODO: Mock error condition
      const message = createMockMemory('test');
      const result = await ${camelCaseName}${componentType}.get(mockRuntime, message, mockState);
      expect(result.text).toBeDefined();
    });
  });
  `
      : ''
  }
  
  ${
    componentType === 'Evaluator'
      ? `
  describe('validate', () => {
    it('should validate when appropriate', async () => {
      const message = createMockMemory('test evaluation');
      const result = await ${camelCaseName}${componentType}.validate(mockRuntime, message, mockState);
      expect(typeof result).toBe('boolean');
    });
  });
  
  describe('handler', () => {
    it('should evaluate messages', async () => {
      const message = createMockMemory('test evaluation');
      const result = await ${camelCaseName}${componentType}.handler(mockRuntime, message, mockState);
      expect(result).toContain('evaluation');
    });
  });
  `
      : ''
  }
  
  // TODO: Add more specific tests based on the component's functionality
});
`;
};

// Re-export with old names for backward compatibility
export const actionTemplate = generateActionCode;
export const providerTemplate = generateProviderCode;
export const serviceTemplate = generateServiceCode;
export const evaluatorTemplate = generateEvaluatorCode;
export const pluginIndexTemplate = generatePluginIndex;
export const testTemplate = generateTestCode;
