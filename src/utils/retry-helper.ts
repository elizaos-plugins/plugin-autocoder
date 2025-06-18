import { elizaLogger as logger } from '@elizaos/core';

export interface RetryConfig {
  maxAttempts?: number;
  initialDelayMs?: number;
  maxDelayMs?: number;
  backoffMultiplier?: number;
  shouldRetry?: (error: any) => boolean;
  onRetry?: (attempt: number, error: any) => void;
}

const DEFAULT_CONFIG: Required<RetryConfig> = {
  maxAttempts: 3,
  initialDelayMs: 1000,
  maxDelayMs: 30000,
  backoffMultiplier: 2,
  shouldRetry: (error) => {
    // Retry on rate limits and network errors
    if (error.status === 429) return true;
    if (error.code === 'ECONNRESET' || error.code === 'ETIMEDOUT') return true;
    if (error.message?.includes('rate limit')) return true;
    if (error.message?.includes('timeout')) return true;
    return false;
  },
  onRetry: (attempt, error) => {
    logger.warn(`Retry attempt ${attempt}: ${error.message}`);
  },
};

export async function withRetry<T>(
  operation: () => Promise<T>,
  userConfig?: RetryConfig
): Promise<T> {
  const config = { ...DEFAULT_CONFIG, ...userConfig };
  let lastError: any;

  for (let attempt = 1; attempt <= config.maxAttempts; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;

      // Check if we should retry
      if (!config.shouldRetry(error) || attempt === config.maxAttempts) {
        throw error;
      }

      // Calculate delay with exponential backoff
      const baseDelay = config.initialDelayMs * Math.pow(config.backoffMultiplier, attempt - 1);
      const delay = Math.min(baseDelay, config.maxDelayMs);

      // Add jitter to prevent thundering herd
      const jitter = Math.random() * 0.3 * delay;
      const finalDelay = delay + jitter;

      // Notify about retry
      config.onRetry(attempt, error);

      // Wait before retrying
      await new Promise((resolve) => setTimeout(resolve, finalDelay));
    }
  }

  throw lastError;
}

// Specific retry configuration for Anthropic API
export const anthropicRetryConfig: RetryConfig = {
  maxAttempts: 5,
  initialDelayMs: 2000,
  maxDelayMs: 60000,
  shouldRetry: (error) => {
    // Anthropic-specific error handling
    if (error.status === 429) return true; // Rate limit
    if (error.status === 500 || error.status === 502 || error.status === 503) return true; // Server errors
    if (error.error?.type === 'rate_limit_error') return true;
    if (error.error?.type === 'overloaded_error') return true;
    return DEFAULT_CONFIG.shouldRetry!(error);
  },
  onRetry: (attempt, error) => {
    const retryAfter = error.headers?.['retry-after'];
    if (retryAfter) {
      logger.info(`Anthropic API rate limited. Retry after ${retryAfter}s (attempt ${attempt})`);
    } else {
      logger.warn(`Retrying Anthropic API call (attempt ${attempt}): ${error.message}`);
    }
  },
};

// Helper to extract retry delay from error headers
export function getRetryDelay(error: any): number | null {
  const retryAfter = error.headers?.['retry-after'] || error.response?.headers?.['retry-after'];
  if (retryAfter) {
    // Retry-After can be in seconds or an HTTP date
    const seconds = parseInt(retryAfter, 10);
    if (!isNaN(seconds)) {
      return seconds * 1000; // Convert to milliseconds
    }

    // Try parsing as date
    const retryDate = new Date(retryAfter);
    if (!isNaN(retryDate.getTime())) {
      return Math.max(0, retryDate.getTime() - Date.now());
    }
  }

  return null;
}
