import type {
  Action,
  Content,
  HandlerCallback,
  IAgentRuntime,
  Memory,
  State,
} from '@elizaos/core';
import { logger } from '@elizaos/core';

/**
 * Configuration interface for the echo action
 */
export interface EchoConfig {
  prefix?: string;          // Optional prefix for echoed messages
  suffix?: string;          // Optional suffix for echoed messages
  uppercase?: boolean;      // Transform to uppercase
  addTimestamp?: boolean;   // Include timestamp in response
}

/**
 * Echo action that repeats user input with optional formatting
 */
export const echoAction: Action = {
  name: 'ECHO_MESSAGE',
  similes: ['ECHO', 'REPEAT', 'SAY_BACK'],
  description: 'Echoes back the user\'s input with optional formatting',

  /**
   * Validates if the action should be triggered
   * Looks for echo-related keywords in the message
   */
  validate: async (runtime: IAgentRuntime, message: Memory, state?: State): Promise<boolean> => {
    try {
      const text = message.content.text?.toLowerCase() || '';
      
      // Check if message contains echo trigger words
      const triggers = ['echo', 'repeat', 'say back', 'say again'];
      const hasEchoTrigger = triggers.some(trigger => text.includes(trigger));
      
      // Also validate if there's actual content to echo
      const hasContent = message.content.text && message.content.text.trim().length > 0;
      
      logger.debug(`Echo validation - hasEchoTrigger: ${hasEchoTrigger}, hasContent: ${hasContent}`);
      
      return hasEchoTrigger && hasContent;
    } catch (error) {
      logger.error('Error in echo action validation:', error);
      return false;
    }
  },

  /**
   * Handles the echo action execution
   */
  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    state?: State,
    options?: any,
    callback?: HandlerCallback,
    responses?: Memory[]
  ): Promise<boolean> => {
    try {
      logger.info('Executing ECHO_MESSAGE action');

      // Get configuration from character settings
      const config = runtime.character?.settings?.echo as EchoConfig || {};
      
      // Extract the text to echo (remove trigger words)
      const originalText = message.content.text || '';
      const triggers = ['echo', 'repeat', 'say back', 'say again'];
      
      let textToEcho = originalText;
      
      // Remove trigger words from the beginning
      for (const trigger of triggers) {
        const regex = new RegExp(`^${trigger}\\s*:?\\s*`, 'i');
        textToEcho = textToEcho.replace(regex, '').trim();
      }
      
      // If no text remains after removing triggers, use original text
      if (!textToEcho) {
        textToEcho = originalText;
      }

      // Apply formatting based on configuration
      let formattedText = textToEcho;
      
      if (config.uppercase) {
        formattedText = formattedText.toUpperCase();
      }
      
      if (config.prefix) {
        formattedText = `${config.prefix} ${formattedText}`;
      }
      
      if (config.suffix) {
        formattedText = `${formattedText} ${config.suffix}`;
      }
      
      if (config.addTimestamp) {
        const timestamp = new Date().toISOString();
        formattedText = `[${timestamp}] ${formattedText}`;
      }

      // Create response content
      const responseContent: Content = {
        text: formattedText,
        actions: ['ECHO_MESSAGE'],
        source: message.content.source,
      };

      // Store echo in memory for context
      await runtime.createMemory({
        ...message,
        content: {
          ...responseContent,
          metadata: {
            isEcho: true,
            originalText: textToEcho,
            config: config,
          },
        },
      });

      // Send response via callback
      if (callback) {
        await callback(responseContent);
      }

      logger.info(`Echo action completed successfully. Echoed: "${formattedText}"`);
      return true;
    } catch (error) {
      logger.error('Error in echo action handler:', error);
      throw error;
    }
  },

  /**
   * Example usage patterns for the echo action
   */
  examples: [
    [
      {
        name: '{{user}}',
        content: {
          text: 'echo Hello World!',
        },
      },
      {
        name: '{{agent}}',
        content: {
          text: 'Hello World!',
          actions: ['ECHO_MESSAGE'],
        },
      },
    ],
    [
      {
        name: '{{user}}',
        content: {
          text: 'please repeat what I just said',
        },
      },
      {
        name: '{{agent}}',
        content: {
          text: 'what I just said',
          actions: ['ECHO_MESSAGE'],
        },
      },
    ],
    [
      {
        name: '{{user}}',
        content: {
          text: 'echo: testing the echo function',
        },
      },
      {
        name: '{{agent}}',
        content: {
          text: 'testing the echo function',
          actions: ['ECHO_MESSAGE'],
        },
      },
    ],
  ],
};