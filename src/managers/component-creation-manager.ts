import { elizaLogger as logger } from '@elizaos/core';
import type { IAgentRuntime } from '@elizaos/core';
import fs from 'fs-extra';
import path from 'path';
import { DependencyManager } from './dependency-manager';
import { ServiceDiscoveryManager } from './service-discovery-manager';
import Anthropic from '@anthropic-ai/sdk';
import { withRetry, anthropicRetryConfig } from '../utils/retry-helper';

/**
 * Supported component types for generation
 */
export enum ComponentType {
  ACTION = 'action',
  PROVIDER = 'provider',
  EVALUATOR = 'evaluator',
  SERVICE = 'service',
  PLUGIN = 'plugin',
}

/**
 * Options for component creation
 */
export interface ComponentCreationOptions {
  type: ComponentType;
  name: string;
  description: string;
  targetPlugin?: string;
  dependencies?: string[];
  customInstructions?: string[];
}

/**
 * Result of component creation
 */
export interface ComponentCreationResult {
  success: boolean;
  componentType: ComponentType;
  componentName: string;
  filePath: string;
  content?: string;
  error?: string;
}

/**
 * Manager for creating standalone ElizaOS components using AI
 */
/**
 * Template for creating components
 */
interface ComponentTemplate {
  type: ComponentType;
  fileName: string;
  content: string;
  testContent?: string;
}

export class ComponentCreationManager {
  private anthropic: Anthropic | null = null;
  private serviceDiscovery: ServiceDiscoveryManager;
  private dependencyManager: DependencyManager;

  constructor() {
    this.serviceDiscovery = new ServiceDiscoveryManager();
    this.dependencyManager = new DependencyManager();
  }

  /**
   * Create a new component (action, provider, evaluator, or service)
   */
  async createComponent(
    options: ComponentCreationOptions,
    runtime?: IAgentRuntime
  ): Promise<ComponentCreationResult> {
    logger.info(`Creating ${options.type}: ${options.name}`);

    // Analyze dependencies if specified
    let dependencyContext = '';
    if (options.dependencies && options.dependencies.length > 0) {
      const manifest = await this.dependencyManager.analyzeDependencies(options.dependencies, []);
      const context = await this.dependencyManager.generateContext(manifest, options.description);
      dependencyContext = this.formatDependencyContext(context);
    }

    // Generate component template
    const template = await this.generateComponentTemplate(options, dependencyContext);

    // Determine file paths
    const { filePath, testFilePath } = this.determineFilePaths(options);

    // Write files
    await fs.ensureDir(path.dirname(filePath));
    await fs.writeFile(filePath, template.content);
    logger.info(`Created ${options.type} file: ${filePath}`);

    if (template.testContent && testFilePath) {
      await fs.ensureDir(path.dirname(testFilePath));
      await fs.writeFile(testFilePath, template.testContent);
      logger.info(`Created test file: ${testFilePath}`);
    }

    // Update plugin index if adding to existing plugin
    if (options.targetPlugin) {
      await this.updatePluginIndex(options);
    }

    return {
      success: true,
      componentType: options.type,
      componentName: options.name,
      filePath,
      content: template.content,
    };
  }

  /**
   * Generate component template based on type
   */
  private async generateComponentTemplate(
    options: ComponentCreationOptions,
    dependencyContext: string
  ): Promise<ComponentTemplate> {
    const templates: Record<ComponentType, () => ComponentTemplate> = {
      [ComponentType.ACTION]: () => this.generateActionTemplate(options, dependencyContext),
      [ComponentType.PROVIDER]: () => this.generateProviderTemplate(options, dependencyContext),
      [ComponentType.EVALUATOR]: () => this.generateEvaluatorTemplate(options, dependencyContext),
      [ComponentType.SERVICE]: () => this.generateServiceTemplate(options, dependencyContext),
      [ComponentType.PLUGIN]: () => this.generatePluginTemplate(options, dependencyContext),
    };

    const generator = templates[options.type];
    if (!generator) {
      throw new Error(`Unknown component type: ${options.type}`);
    }

    return generator();
  }

  /**
   * Generate action template
   */
  private generateActionTemplate(
    options: ComponentCreationOptions,
    dependencyContext: string
  ): ComponentTemplate {
    const actionName = this.toConstantCase(options.name);
    const handlerName = this.toCamelCase(options.name) + 'Handler';

    const content = `import { type Action, type IAgentRuntime, type Memory, type State, type HandlerCallback, elizaLogger } from '@elizaos/core';
${dependencyContext}

export const ${actionName}: Action = {
  name: '${this.toKebabCase(options.name)}',
  description: '${options.description}',
  
  validate: async (runtime: IAgentRuntime, message: Memory): Promise<boolean> => {
    // TODO: Implement validation logic
    // Return true if this action should be available for the current message
    return true;
  },

  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    state: State,
    options: any,
    callback?: HandlerCallback
  ): Promise<boolean> => {
    try {
      elizaLogger.info('Executing ${options.name} action');
      
      // TODO: Implement action logic here
      ${options.customInstructions ? `// Custom instructions:\n      // ${options.customInstructions.join('\n      // ')}` : ''}
      
      // Example response
      if (callback) {
        await callback({
          text: '${options.name} action executed successfully',
          action: '${this.toKebabCase(options.name)}',
        });
      }
      
      return true;
    } catch (error) {
      elizaLogger.error('Error in ${options.name} action:', error);
      if (callback) {
        await callback({
          text: 'Error executing ${options.name} action',
          error: error.message,
        });
      }
      return false;
    }
  },

  examples: [
    [
      {
        user: "{{user1}}",
        content: { text: "Can you help me with ${options.name}?" },
      },
      {
        user: "{{agent}}",
        content: { 
          text: "I'll help you with that.",
          action: "${this.toKebabCase(options.name)}"
        },
      },
    ],
  ],
};

export default ${actionName};
`;

    const testContent = `import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ${actionName} } from '../${path.basename(options.name)}';
import type { IAgentRuntime, Memory, State } from '@elizaos/core';

describe('${options.name} Action', () => {
  let mockRuntime: IAgentRuntime;
  let mockMessage: Memory;
  let mockState: State;
  let mockCallback: any;

  beforeEach(() => {
    mockRuntime = {
      agentId: 'test-agent',
      getSetting: vi.fn(),
      // Add other required runtime methods
    } as any;

    mockMessage = {
      id: 'test-message',
      content: { text: 'Test message' },
      agentId: 'test-agent',
      userId: 'test-user',
      roomId: 'test-room',
    } as Memory;

    mockState = {} as State;
    mockCallback = vi.fn();
  });

  it('should validate correctly', async () => {
    const isValid = await ${actionName}.validate(mockRuntime, mockMessage);
    expect(isValid).toBe(true);
  });

  it('should handle action execution', async () => {
    const result = await ${actionName}.handler(
      mockRuntime,
      mockMessage,
      mockState,
      {},
      mockCallback
    );

    expect(result).toBe(true);
    expect(mockCallback).toHaveBeenCalledWith(
      expect.objectContaining({
        text: expect.stringContaining('${options.name}'),
        action: '${this.toKebabCase(options.name)}',
      })
    );
  });

  it('should handle errors gracefully', async () => {
    // Mock an error condition
    mockRuntime.getSetting = vi.fn().mockImplementation(() => {
      throw new Error('Test error');
    });

    const result = await ${actionName}.handler(
      mockRuntime,
      mockMessage,
      mockState,
      {},
      mockCallback
    );

    expect(result).toBe(false);
    expect(mockCallback).toHaveBeenCalledWith(
      expect.objectContaining({
        text: expect.stringContaining('Error'),
        error: expect.any(String),
      })
    );
  });
});
`;

    return {
      type: ComponentType.ACTION,
      fileName: `${this.toKebabCase(options.name)}.ts`,
      content,
      testContent,
    };
  }

  /**
   * Generate provider template
   */
  private generateProviderTemplate(
    options: ComponentCreationOptions,
    dependencyContext: string
  ): ComponentTemplate {
    const providerName = this.toCamelCase(options.name) + 'Provider';

    const content = `import { type Provider, type IAgentRuntime, type Memory, type State, elizaLogger } from '@elizaos/core';
${dependencyContext}

export const ${providerName}: Provider = {
  name: '${this.toKebabCase(options.name)}',
  description: '${options.description}',
  
  get: async (runtime: IAgentRuntime, message: Memory, state?: State): Promise<string> => {
    try {
      elizaLogger.info('Getting ${options.name} context');
      
      // TODO: Implement provider logic here
      ${options.customInstructions ? `// Custom instructions:\n      // ${options.customInstructions.join('\n      // ')}` : ''}
      
      // Example: Fetch and format relevant data
      const data = await fetch${this.toPascalCase(options.name)}Data(runtime);
      
      return format${this.toPascalCase(options.name)}Context(data);
    } catch (error) {
      elizaLogger.error('Error in ${options.name} provider:', error);
      return 'Unable to fetch ${options.name} information at this time.';
    }
  },
};

// Helper functions
async function fetch${this.toPascalCase(options.name)}Data(runtime: IAgentRuntime): Promise<any> {
  // TODO: Implement data fetching logic
  return {
    // Example data structure
    timestamp: new Date().toISOString(),
    status: 'active',
  };
}

function format${this.toPascalCase(options.name)}Context(data: any): string {
  // TODO: Format data for LLM context
  return \`${options.name} Information:
- Status: \${data.status}
- Last Updated: \${data.timestamp}
\`;
}

export default ${providerName};
`;

    const testContent = `import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ${providerName} } from '../${path.basename(options.name)}';
import type { IAgentRuntime, Memory, State } from '@elizaos/core';

describe('${options.name} Provider', () => {
  let mockRuntime: IAgentRuntime;
  let mockMessage: Memory;
  let mockState: State;

  beforeEach(() => {
    mockRuntime = {
      agentId: 'test-agent',
      getSetting: vi.fn(),
      // Add other required runtime methods
    } as any;

    mockMessage = {
      id: 'test-message',
      content: { text: 'Test message' },
      agentId: 'test-agent',
      userId: 'test-user',
      roomId: 'test-room',
    } as Memory;

    mockState = {} as State;
  });

  it('should provide context successfully', async () => {
    const context = await ${providerName}.get(mockRuntime, mockMessage, mockState);
    
    expect(context).toBeTruthy();
    expect(context).toContain('${options.name} Information');
    expect(context).toContain('Status:');
  });

  it('should handle errors gracefully', async () => {
    // Mock an error condition
    mockRuntime.getSetting = vi.fn().mockImplementation(() => {
      throw new Error('Test error');
    });

    const context = await ${providerName}.get(mockRuntime, mockMessage, mockState);
    
    expect(context).toContain('Unable to fetch');
  });
});
`;

    return {
      type: ComponentType.PROVIDER,
      fileName: `${this.toKebabCase(options.name)}.ts`,
      content,
      testContent,
    };
  }

  /**
   * Generate evaluator template
   */
  private generateEvaluatorTemplate(
    options: ComponentCreationOptions,
    dependencyContext: string
  ): ComponentTemplate {
    const evaluatorName = this.toCamelCase(options.name) + 'Evaluator';

    const content = `import { type Evaluator, type IAgentRuntime, type Memory, type State, elizaLogger } from '@elizaos/core';
${dependencyContext}

export const ${evaluatorName}: Evaluator = {
  name: '${this.toKebabCase(options.name)}',
  description: '${options.description}',
  
  validate: async (runtime: IAgentRuntime, message: Memory): Promise<boolean> => {
    // TODO: Determine if this evaluator should run for this message
    return true;
  },

  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    state: State,
    options: any
  ): Promise<any> => {
    try {
      elizaLogger.info('Running ${options.name} evaluation');
      
      // TODO: Implement evaluation logic here
      ${options.customInstructions ? `// Custom instructions:\n      // ${options.customInstructions.join('\n      // ')}` : ''}
      
      // Example: Analyze conversation and extract insights
      const analysis = await analyze${this.toPascalCase(options.name)}(runtime, message, state);
      
      // Store insights or trigger actions based on evaluation
      if (analysis.shouldTakeAction) {
        await runtime.processActions(message, [], state);
      }
      
      return {
        success: true,
        data: analysis,
      };
    } catch (error) {
      elizaLogger.error('Error in ${options.name} evaluator:', error);
      return {
        success: false,
        error: error.message,
      };
    }
  },

  examples: [
    {
      context: "After a conversation about ${options.description}",
      outcome: "The evaluator analyzes the conversation and extracts relevant insights",
    },
  ],
};

// Helper functions
async function analyze${this.toPascalCase(options.name)}(
  runtime: IAgentRuntime,
  message: Memory,
  state: State
): Promise<any> {
  // TODO: Implement analysis logic
  return {
    shouldTakeAction: false,
    insights: [],
    confidence: 0.8,
  };
}

export default ${evaluatorName};
`;

    const testContent = `import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ${evaluatorName} } from '../${path.basename(options.name)}';
import type { IAgentRuntime, Memory, State } from '@elizaos/core';

describe('${options.name} Evaluator', () => {
  let mockRuntime: IAgentRuntime;
  let mockMessage: Memory;
  let mockState: State;

  beforeEach(() => {
    mockRuntime = {
      agentId: 'test-agent',
      getSetting: vi.fn(),
      processActions: vi.fn(),
      // Add other required runtime methods
    } as any;

    mockMessage = {
      id: 'test-message',
      content: { text: 'Test message' },
      agentId: 'test-agent',
      userId: 'test-user',
      roomId: 'test-room',
    } as Memory;

    mockState = {} as State;
  });

  it('should validate correctly', async () => {
    const isValid = await ${evaluatorName}.validate(mockRuntime, mockMessage);
    expect(isValid).toBe(true);
  });

  it('should evaluate successfully', async () => {
    const result = await ${evaluatorName}.handler(
      mockRuntime,
      mockMessage,
      mockState,
      {}
    );

    expect(result.success).toBe(true);
    expect(result.data).toBeDefined();
  });

  it('should handle errors gracefully', async () => {
    // Mock an error condition
    mockRuntime.getSetting = vi.fn().mockImplementation(() => {
      throw new Error('Test error');
    });

    const result = await ${evaluatorName}.handler(
      mockRuntime,
      mockMessage,
      mockState,
      {}
    );

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });
});
`;

    return {
      type: ComponentType.EVALUATOR,
      fileName: `${this.toKebabCase(options.name)}.ts`,
      content,
      testContent,
    };
  }

  /**
   * Generate service template
   */
  private generateServiceTemplate(
    options: ComponentCreationOptions,
    dependencyContext: string
  ): ComponentTemplate {
    const serviceName = this.toPascalCase(options.name) + 'Service';
    const serviceType = this.toConstantCase(options.name);

    const content = `import { Service, type IAgentRuntime, elizaLogger } from '@elizaos/core';
${dependencyContext}

export class ${serviceName} extends Service {
  static serviceType = '${serviceType}';

  public capabilityDescription = '${options.description}';

  constructor(runtime?: IAgentRuntime) {
    super(runtime);
  }

  static async start(runtime: IAgentRuntime): Promise<Service> {
    const service = new ${serviceName}(runtime);
    await service.initialize();
    return service;
  }

  async initialize(): Promise<void> {
    elizaLogger.info('Initializing ${serviceName}');
    
    // TODO: Initialize service resources
    ${options.customInstructions ? `// Custom instructions:\n    // ${options.customInstructions.join('\n    // ')}` : ''}
    
    elizaLogger.info('${serviceName} initialized successfully');
  }

  async stop(): Promise<void> {
    elizaLogger.info('Stopping ${serviceName}');
    
    // TODO: Clean up resources
    
    elizaLogger.info('${serviceName} stopped');
  }

  // Service-specific methods
  async process(input: any): Promise<any> {
    try {
      elizaLogger.info('Processing in ${serviceName}');
      
      // TODO: Implement main service logic
      
      return {
        success: true,
        result: 'Processed successfully',
      };
    } catch (error) {
      elizaLogger.error('Error in ${serviceName}:', error);
      throw error;
    }
  }
}

export default ${serviceName};
`;

    const testContent = `import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ${serviceName} } from '../${path.basename(options.name)}';
import type { IAgentRuntime } from '@elizaos/core';

describe('${serviceName}', () => {
  let mockRuntime: IAgentRuntime;
  let service: ${serviceName};

  beforeEach(() => {
    mockRuntime = {
      agentId: 'test-agent',
      getSetting: vi.fn(),
      registerService: vi.fn(),
      // Add other required runtime methods
    } as any;
  });

  afterEach(async () => {
    if (service) {
      await service.stop();
    }
  });

  it('should initialize successfully', async () => {
    service = new ${serviceName}(mockRuntime);
    await expect(service.initialize()).resolves.not.toThrow();
  });

  it('should process input successfully', async () => {
    service = new ${serviceName}(mockRuntime);
    await service.initialize();

    const result = await service.process({ test: 'data' });
    
    expect(result.success).toBe(true);
    expect(result.result).toBeDefined();
  });

  it('should stop gracefully', async () => {
    service = new ${serviceName}(mockRuntime);
    await service.initialize();
    
    await expect(service.stop()).resolves.not.toThrow();
  });
});
`;

    return {
      type: ComponentType.SERVICE,
      fileName: `${this.toKebabCase(options.name)}.ts`,
      content,
      testContent,
    };
  }

  /**
   * Generate plugin template
   */
  private generatePluginTemplate(
    options: ComponentCreationOptions,
    dependencyContext: string
  ): ComponentTemplate {
    const pluginName = this.toCamelCase(options.name) + 'Plugin';

    const content = `import { type Plugin } from '@elizaos/core';
${dependencyContext}

export const ${pluginName}: Plugin = {
  name: '${this.toKebabCase(options.name)}',
  description: '${options.description}',
  
  actions: [
    // TODO: Import and add actions
  ],
  
  providers: [
    // TODO: Import and add providers
  ],
  
  evaluators: [
    // TODO: Import and add evaluators
  ],
  
  services: [
    // TODO: Import and add services
  ],
  
  // Optional: Add custom initialization logic
  init: async (runtime) => {
    // TODO: Perform any plugin-specific initialization
    ${options.customInstructions ? `// Custom instructions:\n    // ${options.customInstructions.join('\n    // ')}` : ''}
  },
};

export default ${pluginName};
`;

    const testContent = `import { describe, it, expect } from 'vitest';
import { ${pluginName} } from '../index';

describe('${pluginName}', () => {
  it('should have required properties', () => {
    expect(${pluginName}.name).toBe('${this.toKebabCase(options.name)}');
    expect(${pluginName}.description).toBeDefined();
  });

  it('should have valid structure', () => {
    expect(${pluginName}.actions).toBeDefined();
    expect(Array.isArray(${pluginName}.actions)).toBe(true);
    
    expect(${pluginName}.providers).toBeDefined();
    expect(Array.isArray(${pluginName}.providers)).toBe(true);
    
    expect(${pluginName}.evaluators).toBeDefined();
    expect(Array.isArray(${pluginName}.evaluators)).toBe(true);
    
    expect(${pluginName}.services).toBeDefined();
    expect(Array.isArray(${pluginName}.services)).toBe(true);
  });
});
`;

    return {
      type: ComponentType.PLUGIN,
      fileName: 'index.ts',
      content,
      testContent,
    };
  }

  /**
   * Format dependency context for code generation
   */
  private formatDependencyContext(context: any): string {
    if (!context.typeImports || context.typeImports.length === 0) {
      return '';
    }

    return context.typeImports.join('\n');
  }

  /**
   * Determine file paths for the component
   */
  private determineFilePaths(options: ComponentCreationOptions): {
    filePath: string;
    testFilePath?: string;
  } {
    // Special handling for plugin type
    if (options.type === ComponentType.PLUGIN) {
      return {
        filePath: 'src/index.ts',
        testFilePath: 'src/__tests__/index.test.ts',
      };
    }

    const basePath = options.targetPlugin || 'src';
    const componentDir = this.getComponentDirectory(options.type);
    const fileName = this.toKebabCase(options.name) + '.ts';

    const filePath = path.join(basePath, componentDir, fileName);
    const testFilePath = path.join(
      basePath,
      '__tests__',
      componentDir,
      fileName.replace('.ts', '.test.ts')
    );

    return { filePath, testFilePath };
  }

  /**
   * Get component directory based on type
   */
  private getComponentDirectory(type: ComponentType): string {
    const directories: Record<ComponentType, string> = {
      [ComponentType.ACTION]: 'actions',
      [ComponentType.PROVIDER]: 'providers',
      [ComponentType.EVALUATOR]: 'evaluators',
      [ComponentType.SERVICE]: 'services',
      [ComponentType.PLUGIN]: '',
    };

    return directories[type] || '';
  }

  /**
   * Update plugin index to include new component
   */
  private async updatePluginIndex(options: ComponentCreationOptions): Promise<void> {
    if (!options.targetPlugin || options.type === ComponentType.PLUGIN) {
      return;
    }

    const indexPath = path.join(options.targetPlugin, 'index.ts');
    if (!(await fs.pathExists(indexPath))) {
      logger.warn(`Plugin index not found at ${indexPath}`);
      return;
    }

    const indexContent = await fs.readFile(indexPath, 'utf-8');
    const componentName = this.getComponentExportName(options);
    const importPath = `./${this.getComponentDirectory(options.type)}/${this.toKebabCase(options.name)}`;

    // Add import
    const importStatement = `import { ${componentName} } from '${importPath}';`;
    const updatedContent = this.addImportToFile(indexContent, importStatement);

    // Add to plugin exports
    const arrayName = this.getPluginArrayName(options.type);
    const finalContent = this.addToPluginArray(updatedContent, arrayName, componentName);

    await fs.writeFile(indexPath, finalContent);
    logger.info(`Updated plugin index with ${options.type}: ${options.name}`);
  }

  /**
   * Get component export name
   */
  private getComponentExportName(options: ComponentCreationOptions): string {
    const suffixes: Record<ComponentType, string> = {
      [ComponentType.ACTION]: '',
      [ComponentType.PROVIDER]: 'Provider',
      [ComponentType.EVALUATOR]: 'Evaluator',
      [ComponentType.SERVICE]: 'Service',
      [ComponentType.PLUGIN]: 'Plugin',
    };

    const suffix = suffixes[options.type] || '';
    return options.type === ComponentType.ACTION
      ? this.toConstantCase(options.name)
      : this.toCamelCase(options.name) + suffix;
  }

  /**
   * Get plugin array name for component type
   */
  private getPluginArrayName(type: ComponentType): string {
    const arrays: Record<ComponentType, string> = {
      [ComponentType.ACTION]: 'actions',
      [ComponentType.PROVIDER]: 'providers',
      [ComponentType.EVALUATOR]: 'evaluators',
      [ComponentType.SERVICE]: 'services',
      [ComponentType.PLUGIN]: '',
    };

    return arrays[type] || '';
  }

  /**
   * Add import statement to file
   */
  private addImportToFile(content: string, importStatement: string): string {
    // Find the last import statement
    const importRegex = /^import\s+.*$/gm;
    const imports = content.match(importRegex) || [];

    if (imports.length > 0) {
      const lastImport = imports[imports.length - 1];
      const lastImportIndex = content.lastIndexOf(lastImport);
      const insertIndex = lastImportIndex + lastImport.length;

      return content.slice(0, insertIndex) + '\n' + importStatement + content.slice(insertIndex);
    } else {
      // No imports found, add at the beginning
      return importStatement + '\n\n' + content;
    }
  }

  /**
   * Add component to plugin array
   */
  private addToPluginArray(content: string, arrayName: string, componentName: string): string {
    const regex = new RegExp(`${arrayName}:\\s*\\[([^\\]]*)]`, 's');
    const match = content.match(regex);

    if (match) {
      const arrayContent = match[1].trim();
      let newArrayContent: string;

      if (!arrayContent) {
        // Empty array
        newArrayContent = `\n    ${componentName}\n  `;
      } else if (arrayContent.includes('\n')) {
        // Multi-line array - add comma to last element
        newArrayContent = `${arrayContent},\n    ${componentName}\n  `;
      } else {
        // Single-line array with existing elements
        newArrayContent = `\n    ${arrayContent},\n    ${componentName}\n  `;
      }

      return content.replace(regex, `${arrayName}: [${newArrayContent}]`);
    }

    return content;
  }

  // String transformation utilities
  private toKebabCase(str: string): string {
    return str
      .replace(/([a-z])([A-Z])/g, '$1-$2')
      .replace(/[\s_]+/g, '-')
      .toLowerCase();
  }

  private toCamelCase(str: string): string {
    return str
      .replace(/[-_\s]+(.)?/g, (_, c) => (c ? c.toUpperCase() : ''))
      .replace(/^./, (c) => c.toLowerCase());
  }

  private toPascalCase(str: string): string {
    const camel = this.toCamelCase(str);
    return camel.charAt(0).toUpperCase() + camel.slice(1);
  }

  private toConstantCase(str: string): string {
    return str
      .replace(/([a-z])([A-Z])/g, '$1_$2')
      .replace(/[-\s]+/g, '_')
      .toUpperCase();
  }
}
