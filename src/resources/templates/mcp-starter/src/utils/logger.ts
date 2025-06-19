/**
 * Simple logger utility for MCP server
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface Logger {
  debug: (message: string, ...args: any[]) => void;
  info: (message: string, ...args: any[]) => void;
  warn: (message: string, ...args: any[]) => void;
  error: (message: string, ...args: any[]) => void;
}

/**
 * Create a logger instance with a specific prefix
 */
export function createLogger(prefix: string = 'MCP'): Logger {
  const logLevel = process.env.LOG_LEVEL?.toLowerCase() || 'info';
  const levels: LogLevel[] = ['debug', 'info', 'warn', 'error'];
  const currentLevelIndex = levels.indexOf(logLevel as LogLevel);

  const shouldLog = (level: LogLevel): boolean => {
    const levelIndex = levels.indexOf(level);
    return levelIndex >= currentLevelIndex;
  };

  const log = (level: LogLevel, message: string, ...args: any[]) => {
    if (!shouldLog(level)) return;

    const timestamp = new Date().toISOString();
    const formattedMessage = `[${timestamp}] [${prefix}] [${level.toUpperCase()}] ${message}`;

    switch (level) {
      case 'debug':
      case 'info':
        console.log(formattedMessage, ...args);
        break;
      case 'warn':
        console.warn(formattedMessage, ...args);
        break;
      case 'error':
        console.error(formattedMessage, ...args);
        break;
    }
  };

  return {
    debug: (message: string, ...args: any[]) => log('debug', message, ...args),
    info: (message: string, ...args: any[]) => log('info', message, ...args),
    warn: (message: string, ...args: any[]) => log('warn', message, ...args),
    error: (message: string, ...args: any[]) => log('error', message, ...args),
  };
}

// Default logger instance
export const logger = createLogger(); 