import type { Plugin } from '@elizaos/core';
import {
  type Action,
  type Content,
  type GenerateTextParams,
  type HandlerCallback,
  type IAgentRuntime,
  type Memory,
  ModelType,
  type Provider,
  type ProviderResult,
  Service,
  type State,
  logger,
} from '@elizaos/core';
import { z } from 'zod';
import type { EnhancedSecretManager, SecretContext } from '@elizaos/plugin-secrets-manager';

/**
 * Defines the configuration schema for a plugin, including the validation rules for the plugin name.
 *
 * @type {import('zod').ZodObject<{ EXAMPLE_PLUGIN_VARIABLE: import('zod').ZodString }>}
 */
const configSchema = z.object({
  EXAMPLE_PLUGIN_VARIABLE: z
    .string()
    .min(1, 'Example plugin variable is not provided')
    .optional()
    .transform((val) => {
      if (!val) {
        logger.warn('Example plugin variable is not provided (this is expected)');
      }
      return val;
    }),
});

/**
 * Helper function to get secret context for secrets manager operations
 */
function getSecretContext(runtime: IAgentRuntime): SecretContext {
  return {
    level: 'global',
    agentId: runtime.agentId,
    requesterId: runtime.agentId
  };
}

/**
 * Helper function to securely get configuration values
 */
async function getConfigValue(runtime: IAgentRuntime, key: string): Promise<string | undefined> {
  const secretsManager = runtime.getService('SECRETS') as EnhancedSecretManager;
  
  if (secretsManager) {
    try {
      const value = await secretsManager.get(key, getSecretContext(runtime));
      if (value) {
        return value;
      }
    } catch (error) {
      logger.warn(`Failed to get ${key} from secrets manager:`, error);
    }
  }
  
  // Fallback to environment variable for backward compatibility
  return process.env[key];
}

/**
 * Helper function to securely set configuration values
 */
async function setConfigValue(
  runtime: IAgentRuntime, 
  key: string, 
  value: string
): Promise<boolean> {
  const secretsManager = runtime.getService('SECRETS') as EnhancedSecretManager;
  
  if (secretsManager) {
    try {
      return await secretsManager.set(
        key,
        value,
        getSecretContext(runtime),
        {
          type: 'config',
          encrypted: false,
          plugin: 'plugin-starter'
        }
      );
    } catch (error) {
      logger.error(`Failed to set ${key} in secrets manager:`, error);
    }
  }
  
  // Fallback to environment variable
  process.env[key] = value;
  return true;
}

/**
 * Example HelloWorld action
 * This demonstrates the simplest possible action structure
 */
/**
 * Action representing a hello world message.
 * @typedef {Object} Action
 * @property {string} name - The name of the action.
 * @property {string[]} similes - An array of related actions.
 * @property {string} description - A brief description of the action.
 * @property {Function} validate - Asynchronous function to validate the action.
 * @property {Function} handler - Asynchronous function to handle the action and generate a response.
 * @property {Object[]} examples - An array of example inputs and expected outputs for the action.
 */
const helloWorldAction: Action = {
  name: 'HELLO_WORLD',
  similes: ['GREET', 'SAY_HELLO'],
  description: 'Responds with a simple hello world message',

  validate: async (_runtime: IAgentRuntime, _message: Memory, _state?: State): Promise<boolean> => {
    // Always valid
    return true;
  },

  handler: async (
    _runtime: IAgentRuntime,
    message: Memory,
    _state?: State,
    _options?: any,
    callback?: HandlerCallback,
    _responses?: Memory[]
  ) => {
    try {
      logger.info('Handling HELLO_WORLD action');

      // Simple response content
      const responseContent: Content = {
        text: 'hello world!',
        actions: ['HELLO_WORLD'],
        source: message.content.source,
      };

      // Call back with the hello world message
      if (callback) {
        await callback(responseContent);
      }

      return responseContent;
    } catch (error) {
      logger.error('Error in HELLO_WORLD action:', error);
      throw error;
    }
  },

  examples: [
    [
      {
        name: '{{name1}}',
        content: {
          text: 'Can you say hello?',
        },
      },
      {
        name: '{{name2}}',
        content: {
          text: 'hello world!',
          actions: ['HELLO_WORLD'],
        },
      },
    ],
  ],
};

/**
 * Example Hello World Provider
 * This demonstrates the simplest possible provider implementation
 */
const helloWorldProvider: Provider = {
  name: 'HELLO_WORLD_PROVIDER',
  description: 'A simple example provider',

  get: async (
    _runtime: IAgentRuntime,
    _message: Memory,
    _state: State
  ): Promise<ProviderResult> => {
    return {
      text: 'I am a provider',
      values: {},
      data: {},
    };
  },
};

export class StarterService extends Service {
  static serviceType = 'starter';
  capabilityDescription =
    'This is a starter service which is attached to the agent through the starter plugin.';
  constructor(protected runtime: IAgentRuntime) {
    super(runtime);
  }

  static async start(runtime: IAgentRuntime) {
    logger.info(`*** Starting starter service - MODIFIED: ${new Date().toISOString()} ***`);
    const service = new StarterService(runtime);
    return service;
  }

  static async stop(runtime: IAgentRuntime) {
    logger.info('*** TESTING DEV MODE - STOP MESSAGE CHANGED! ***');
    // get the service from the runtime
    const service = runtime.getService(StarterService.serviceType);
    if (!service) {
      throw new Error('Starter service not found');
    }
    service.stop();
  }

  async stop() {
    logger.info('*** THIRD CHANGE - TESTING FILE WATCHING! ***');
  }
}

// Store runtime reference for init function
let pluginRuntime: IAgentRuntime | null = null;

export const starterPlugin: Plugin = {
  name: 'plugin-starter',
  description: 'Plugin starter for elizaOS',
  
  // Declare dependency on secrets manager for secure configuration
  dependencies: ['plugin-env'],
  
  config: {
    // Configuration will be loaded through secrets manager in init
    EXAMPLE_PLUGIN_VARIABLE: process.env.EXAMPLE_PLUGIN_VARIABLE
  },
  
  async init(config: Record<string, string>, runtime: IAgentRuntime) {
    logger.info('*** TESTING DEV MODE - PLUGIN MODIFIED AND RELOADED! ***');
    
    // Store runtime reference
    pluginRuntime = runtime;
    
    try {
      // Get existing configuration from secrets manager
      const exampleVar = await getConfigValue(runtime, 'EXAMPLE_PLUGIN_VARIABLE');
      
      // Merge with provided config
      const mergedConfig = {
        EXAMPLE_PLUGIN_VARIABLE: config.EXAMPLE_PLUGIN_VARIABLE || exampleVar
      };
      
      // Validate merged configuration
      const validatedConfig = await configSchema.parseAsync(mergedConfig);

      // Store validated configuration securely
      for (const [key, value] of Object.entries(validatedConfig)) {
        if (value) {
          await setConfigValue(runtime, key, value);
        }
      }
    } catch (error) {
      if (error instanceof z.ZodError) {
        throw new Error(
          `Invalid plugin configuration: ${error.errors.map((e) => e.message).join(', ')}`
        );
      }
      throw error;
    }
  },
  models: {
    [ModelType.TEXT_SMALL]: async (
      _runtime,
      { prompt, stopSequences = [] }: GenerateTextParams
    ) => {
      return 'Never gonna give you up, never gonna let you down, never gonna run around and desert you...';
    },
    [ModelType.TEXT_LARGE]: async (
      _runtime,
      {
        prompt,
        stopSequences = [],
        maxTokens = 8192,
        temperature = 0.7,
        frequencyPenalty = 0.7,
        presencePenalty = 0.7,
      }: GenerateTextParams
    ) => {
      return 'Never gonna make you cry, never gonna say goodbye, never gonna tell a lie and hurt you...';
    },
  },
  routes: [
    {
      name: 'hello-world-route',
      path: '/helloworld',
      type: 'GET',
      handler: async (_req: any, res: any) => {
        // send a response
        res.json({
          message: 'Hello World!',
        });
      },
    },
  ],
  events: {
    MESSAGE_RECEIVED: [
      async (params) => {
        logger.debug('MESSAGE_RECEIVED event received');
        // print the keys
        logger.debug(Object.keys(params));
      },
    ],
    VOICE_MESSAGE_RECEIVED: [
      async (params) => {
        logger.debug('VOICE_MESSAGE_RECEIVED event received');
        // print the keys
        logger.debug(Object.keys(params));
      },
    ],
    WORLD_CONNECTED: [
      async (params) => {
        logger.debug('WORLD_CONNECTED event received');
        // print the keys
        logger.debug(Object.keys(params));
      },
    ],
    WORLD_JOINED: [
      async (params) => {
        logger.debug('WORLD_JOINED event received');
        // print the keys
        logger.debug(Object.keys(params));
      },
    ],
  },
  services: [StarterService],
  actions: [helloWorldAction],
  providers: [helloWorldProvider],
};

export default starterPlugin;