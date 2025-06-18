import { elizaLogger as logger } from '@elizaos/core';

// Characters that could be used for command injection
// Note: We allow - (dash) for command flags like --noEmit
const DANGEROUS_CHARS = /[;&|`$<>\\n\\r]/;
const PATH_TRAVERSAL = /\.\.[\/\\]/;
const HOME_DIR = /^~[\/\\]/;

export interface SanitizationResult {
  safe: boolean;
  sanitized?: string[];
  reason?: string;
}

/**
 * Sanitizes command arguments to prevent injection attacks
 */
export function sanitizeCommandArgs(args: string[]): SanitizationResult {
  const sanitized: string[] = [];

  for (const arg of args) {
    // Allow command flags (starting with - or --)
    if (arg.startsWith('-')) {
      // Still check for injection in flag values
      const flagValue = arg.includes('=') ? arg.split('=')[1] : '';
      if (flagValue && DANGEROUS_CHARS.test(flagValue)) {
        return {
          safe: false,
          reason: `Dangerous characters in flag value: ${arg}`,
        };
      }
      sanitized.push(arg);
      continue;
    }

    // Check for dangerous patterns
    if (DANGEROUS_CHARS.test(arg)) {
      return {
        safe: false,
        reason: `Dangerous characters detected in argument: ${arg}`,
      };
    }

    if (PATH_TRAVERSAL.test(arg)) {
      return {
        safe: false,
        reason: `Path traversal attempt detected: ${arg}`,
      };
    }

    if (HOME_DIR.test(arg)) {
      return {
        safe: false,
        reason: `Home directory reference not allowed: ${arg}`,
      };
    }

    // Only quote args that need it (contain spaces or special chars)
    if (/[\s'"\\]/.test(arg)) {
      const escaped = arg.replace(/'/g, "'\\''");
      sanitized.push(`'${escaped}'`);
    } else {
      sanitized.push(arg);
    }
  }

  return {
    safe: true,
    sanitized,
  };
}

/**
 * Validates that a command is in the allowed list
 */
export function isAllowedCommand(command: string): boolean {
  const allowedCommands = ['npm', 'npx', 'bun', 'bunx', 'git', 'tsc', 'eslint', 'vitest', 'node'];

  // Extract base command (handle paths like /usr/bin/npm)
  const baseCommand = command.split('/').pop() || command;

  return allowedCommands.includes(baseCommand);
}

/**
 * Sanitizes environment variables to prevent injection
 */
export function sanitizeEnv(env: Record<string, string>): Record<string, string> {
  const sanitized: Record<string, string> = {};

  for (const [key, value] of Object.entries(env)) {
    // Only allow alphanumeric keys with underscores
    if (!/^[A-Z0-9_]+$/i.test(key)) {
      logger.warn(`Skipping invalid environment variable name: ${key}`);
      continue;
    }

    // Remove any shell metacharacters from values
    const cleanValue = value.replace(/[$`\\]/g, '');
    sanitized[key] = cleanValue;
  }

  return sanitized;
}

/**
 * Creates a safe command string for execution
 */
export function createSafeCommand(
  command: string,
  args: string[],
  options?: { env?: Record<string, string> }
): { command: string; args: string[]; env?: Record<string, string> } | null {
  // Validate command
  if (!isAllowedCommand(command)) {
    logger.error(`Command not in allowed list: ${command}`);
    return null;
  }

  // Sanitize arguments
  const sanitizationResult = sanitizeCommandArgs(args);
  if (!sanitizationResult.safe) {
    logger.error(`Command sanitization failed: ${sanitizationResult.reason}`);
    return null;
  }

  // Sanitize environment if provided
  const sanitizedEnv = options?.env ? sanitizeEnv(options.env) : undefined;

  return {
    command,
    args: sanitizationResult.sanitized!,
    env: sanitizedEnv,
  };
}

/**
 * Escapes a string for use in a shell command
 * This is a more secure alternative to shell.escape
 */
export function escapeShellArg(arg: string): string {
  // If empty, return empty quotes
  if (!arg) return "''";

  // If it's a simple alphanumeric string, no escaping needed
  if (/^[a-zA-Z0-9_\-./]+$/.test(arg)) {
    return arg;
  }

  // Otherwise, escape single quotes and wrap in single quotes
  return "'" + arg.replace(/'/g, "'\\''") + "'";
}
