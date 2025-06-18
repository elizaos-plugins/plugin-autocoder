import { elizaLogger as logger } from '@elizaos/core';
import * as fs from 'fs-extra';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { format } from 'date-fns';

/**
 * Represents an entry in the log system.
 */
export interface LogEntry {
  timestamp: string;
  runId: string;
  type: LogType;
  category?: string;
  actionName?: string;
  phase?: string;
  metadata?: Record<string, any>;
  data?: any;
  content?: any;
  sequenceNumber?: number;
}

/**
 * The type of log entry.
 */
export type LogType = 'prompt' | 'response' | 'action' | 'service_call' | 'state_change' | 'error';

/**
 * Options for configuring the logger.
 */
export interface LoggerOptions {
  logDir?: string;
  bufferSize?: number;
  flushInterval?: number;
}

/**
 * Manager for detailed logging of all AutoCoder operations
 */
export class DetailedLogger {
  private logDir: string;
  private currentRunId: string;
  private flushInterval: NodeJS.Timeout;
  private bufferSize: number;
  private logBuffer: LogEntry[] = [];
  private currentLogFile: string;
  private logStream: fs.WriteStream;
  private sequenceNumber = 0;

  constructor(baseLogDir: string = './logs/autocoder') {
    this.logDir = baseLogDir;
    this.currentRunId = uuidv4();
    this.ensureLogDirectory();
    this.initializeLogFile();

    // Flush logs every 5 seconds
    this.flushInterval = setInterval(() => {
      this.flushLogs();
    }, 5000);

    // Also flush on process exit
    process.on('exit', () => {
      this.close();
    });
  }

  private ensureLogDirectory(): void {
    fs.ensureDirSync(this.logDir);
    fs.ensureDirSync(path.join(this.logDir, 'runs'));
    fs.ensureDirSync(path.join(this.logDir, 'prompts'));
    fs.ensureDirSync(path.join(this.logDir, 'responses'));
    fs.ensureDirSync(path.join(this.logDir, 'actions'));
    fs.ensureDirSync(path.join(this.logDir, 'services'));
  }

  private initializeLogFile(): void {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    this.currentLogFile = path.join(
      this.logDir,
      'runs',
      `run_${this.currentRunId}_${timestamp}.log`
    );

    // Write header
    const header = {
      runId: this.currentRunId,
      startTime: new Date().toISOString(),
      version: '1.0.0',
      logFormat: 'NDJSON',
    };

    fs.writeFileSync(this.currentLogFile, JSON.stringify(header) + '\n');

    // Create write stream for appending
    this.logStream = fs.createWriteStream(this.currentLogFile, { flags: 'a' });
  }

  public startNewRun(projectId?: string, projectName?: string): string {
    this.close();
    this.currentRunId = uuidv4();
    this.sequenceNumber = 0;
    this.initializeLogFile();

    this.log({
      type: 'state_change',
      category: 'run_lifecycle',
      metadata: {
        projectId,
        projectName,
        event: 'run_started',
      },
      content: {
        message: `New run started for project: ${projectName || 'Unknown'}`,
      },
    });

    return this.currentRunId;
  }

  public log(entry: Omit<LogEntry, 'runId' | 'timestamp' | 'sequenceNumber'>): void {
    const fullEntry: LogEntry = {
      runId: this.currentRunId,
      timestamp: new Date().toISOString(),
      sequenceNumber: this.sequenceNumber++,
      ...entry,
    };

    this.logBuffer.push(fullEntry);

    // Also log to console in development
    if (process.env.NODE_ENV === 'development') {
      logger.debug(`[${fullEntry.type}] ${fullEntry.category || ''}`, fullEntry);
    }

    // Auto-flush if buffer gets large
    if (this.logBuffer.length >= 100) {
      this.flushLogs();
    }
  }

  public logPrompt(params: {
    projectId: string;
    projectName?: string;
    phase: string;
    model: string;
    messages: any[];
    systemPrompt?: string;
    temperature?: number;
    maxTokens?: number;
    metadata?: any;
  }): void {
    const promptId = uuidv4();

    // Log the full prompt
    this.log({
      type: 'prompt',
      category: 'llm_interaction',
      phase: params.phase,
      metadata: {
        projectId: params.projectId,
        projectName: params.projectName,
        promptId,
        llmModel: params.model,
        temperature: params.temperature,
        maxTokens: params.maxTokens,
        messageCount: params.messages.length,
        ...params.metadata,
      },
      content: {
        systemPrompt: params.systemPrompt,
        messages: params.messages,
        fullPrompt: this.formatPromptForLogging(params.systemPrompt, params.messages),
      },
    });

    // Also save prompt to separate file for easy review
    const promptFile = path.join(
      this.logDir,
      'prompts',
      `${this.currentRunId}_${this.sequenceNumber}_${promptId}.json`
    );
    fs.writeJsonSync(
      promptFile,
      {
        ...params,
        promptId,
        timestamp: new Date().toISOString(),
        runId: this.currentRunId,
        sequenceNumber: this.sequenceNumber - 1,
      },
      { spaces: 2 }
    );
  }

  public logResponse(params: {
    projectId: string;
    projectName?: string;
    phase: string;
    model: string;
    promptId?: string;
    response: any;
    tokenUsage?: {
      promptTokens?: number;
      completionTokens?: number;
      totalTokens?: number;
    };
    duration: number;
    success: boolean;
    error?: string;
    metadata?: any;
  }): void {
    const responseId = uuidv4();

    // Log the response
    this.log({
      type: 'response',
      category: 'llm_interaction',
      phase: params.phase,
      metadata: {
        projectId: params.projectId,
        projectName: params.projectName,
        responseId,
        promptId: params.promptId,
        llmModel: params.model,
        duration: params.duration,
        success: params.success,
        error: params.error,
        tokenCount: params.tokenUsage?.totalTokens,
        ...params.tokenUsage,
        ...params.metadata,
      },
      content: {
        response: params.response,
        parsedContent: this.parseResponseContent(params.response),
      },
    });

    // Save response to separate file
    const responseFile = path.join(
      this.logDir,
      'responses',
      `${this.currentRunId}_${this.sequenceNumber}_${responseId}.json`
    );
    fs.writeJsonSync(
      responseFile,
      {
        ...params,
        responseId,
        timestamp: new Date().toISOString(),
        runId: this.currentRunId,
        sequenceNumber: this.sequenceNumber - 1,
      },
      { spaces: 2 }
    );
  }

  public logAction(params: {
    projectId: string;
    projectName?: string;
    actionName: string;
    phase: string;
    input: any;
    output?: any;
    duration?: number;
    success: boolean;
    error?: string;
    metadata?: any;
  }): void {
    const actionId = uuidv4();

    this.log({
      type: 'action',
      category: 'action_execution',
      phase: params.phase,
      metadata: {
        projectId: params.projectId,
        projectName: params.projectName,
        actionId,
        actionName: params.actionName,
        duration: params.duration,
        success: params.success,
        error: params.error,
        ...params.metadata,
      },
      content: {
        input: params.input,
        output: params.output,
        error: params.error,
      },
    });

    // Save action details to separate file
    const actionFile = path.join(
      this.logDir,
      'actions',
      `${this.currentRunId}_${this.sequenceNumber}_${params.actionName}_${actionId}.json`
    );
    fs.writeJsonSync(
      actionFile,
      {
        ...params,
        actionId,
        timestamp: new Date().toISOString(),
        runId: this.currentRunId,
        sequenceNumber: this.sequenceNumber - 1,
      },
      { spaces: 2 }
    );
  }

  public logServiceCall(params: {
    projectId: string;
    projectName?: string;
    serviceName: string;
    methodName: string;
    phase: string;
    input: any;
    output?: any;
    duration?: number;
    success: boolean;
    error?: string;
    metadata?: any;
  }): void {
    const serviceCallId = uuidv4();

    this.log({
      type: 'service_call',
      category: 'service_execution',
      phase: params.phase,
      metadata: {
        projectId: params.projectId,
        projectName: params.projectName,
        serviceCallId,
        serviceName: params.serviceName,
        methodName: params.methodName,
        duration: params.duration,
        success: params.success,
        error: params.error,
        ...params.metadata,
      },
      content: {
        input: params.input,
        output: params.output,
        error: params.error,
      },
    });

    // Save service call to separate file
    const serviceFile = path.join(
      this.logDir,
      'services',
      `${this.currentRunId}_${this.sequenceNumber}_${params.serviceName}_${params.methodName}_${serviceCallId}.json`
    );
    fs.writeJsonSync(
      serviceFile,
      {
        ...params,
        serviceCallId,
        timestamp: new Date().toISOString(),
        runId: this.currentRunId,
        sequenceNumber: this.sequenceNumber - 1,
      },
      { spaces: 2 }
    );
  }

  public logError(params: {
    projectId?: string;
    projectName?: string;
    phase?: string;
    error: Error | string;
    context?: any;
    metadata?: any;
  }): void {
    const errorMessage = params.error instanceof Error ? params.error.message : params.error;

    const stackTrace = params.error instanceof Error ? params.error.stack : undefined;

    this.log({
      type: 'error',
      category: 'error',
      phase: params.phase,
      metadata: {
        projectId: params.projectId,
        projectName: params.projectName,
        errorType: params.error instanceof Error ? params.error.name : 'Error',
        ...params.metadata,
      },
      content: {
        message: errorMessage,
        stackTrace,
        context: params.context,
      },
    });
  }

  public logDebug(message: string, data?: any, metadata?: any): void {
    this.log({
      type: 'debug',
      category: 'debug',
      metadata: metadata || {},
      content: {
        message,
        data,
      },
    });
  }

  private formatPromptForLogging(systemPrompt?: string, messages?: any[]): string {
    let formatted = '';

    if (systemPrompt) {
      formatted += `=== SYSTEM PROMPT ===\n${systemPrompt}\n\n`;
    }

    if (messages && messages.length > 0) {
      formatted += `=== MESSAGES ===\n`;
      messages.forEach((msg, index) => {
        formatted += `[${index + 1}] ${msg.role?.toUpperCase() || 'UNKNOWN'}:\n`;
        if (typeof msg.content === 'string') {
          formatted += `${msg.content}\n\n`;
        } else {
          formatted += `${JSON.stringify(msg.content, null, 2)}\n\n`;
        }
      });
    }

    return formatted;
  }

  private parseResponseContent(response: any): any {
    if (typeof response === 'string') {
      // Try to extract code blocks
      const codeBlocks = response.match(/```[\s\S]*?```/g) || [];
      const hasCodeBlocks = codeBlocks.length > 0;

      // Try to extract file paths
      const filePaths = response.match(/(?:src|packages)\/[\w\-/.]+\.\w+/g) || [];

      return {
        hasCodeBlocks,
        codeBlockCount: codeBlocks.length,
        codeBlocks: codeBlocks.map((block) => {
          const match = block.match(/```(\w*)\n([\s\S]*?)```/);
          return {
            language: match?.[1] || 'unknown',
            code: match?.[2] || block,
          };
        }),
        mentionedFiles: filePaths,
        responseLength: response.length,
      };
    }

    return response;
  }

  private flushLogs(): void {
    if (this.logBuffer.length === 0) return;

    const toFlush = [...this.logBuffer];
    this.logBuffer = [];

    toFlush.forEach((entry) => {
      if (this.logStream && !this.logStream.destroyed) {
        this.logStream.write(JSON.stringify(entry) + '\n');
      }
    });
  }

  public generateSummary(): string {
    const summaryFile = path.join(this.logDir, 'runs', `summary_${this.currentRunId}.md`);

    let summary = `# AutoCoder Run Summary\n\n`;
    summary += `**Run ID:** ${this.currentRunId}\n`;
    summary += `**Generated:** ${new Date().toISOString()}\n\n`;

    // Read all logs for this run
    const logContent = fs.readFileSync(this.currentLogFile!, 'utf-8');
    const lines = logContent.split('\n').filter((line) => line.trim());

    // Skip header line
    const entries = lines
      .slice(1)
      .map((line) => {
        try {
          return JSON.parse(line) as LogEntry;
        } catch {
          return null;
        }
      })
      .filter(Boolean) as LogEntry[];

    // Generate statistics
    const stats = {
      totalEntries: entries.length,
      prompts: entries.filter((e) => e.type === 'prompt').length,
      responses: entries.filter((e) => e.type === 'response').length,
      actions: entries.filter((e) => e.type === 'action').length,
      serviceCalls: entries.filter((e) => e.type === 'service_call').length,
      errors: entries.filter((e) => e.type === 'error').length,
    };

    summary += `## Statistics\n\n`;
    summary += `- Total Log Entries: ${stats.totalEntries}\n`;
    summary += `- LLM Prompts: ${stats.prompts}\n`;
    summary += `- LLM Responses: ${stats.responses}\n`;
    summary += `- Actions Executed: ${stats.actions}\n`;
    summary += `- Service Calls: ${stats.serviceCalls}\n`;
    summary += `- Errors: ${stats.errors}\n\n`;

    // List all phases
    const phases = [...new Set(entries.map((e) => e.phase).filter(Boolean))];
    summary += `## Phases\n\n`;
    phases.forEach((phase) => {
      const phaseEntries = entries.filter((e) => e.phase === phase);
      summary += `- **${phase}**: ${phaseEntries.length} entries\n`;
    });

    // List errors
    const errors = entries.filter((e) => e.type === 'error');
    if (errors.length > 0) {
      summary += `\n## Errors\n\n`;
      errors.forEach((error, index) => {
        summary += `${index + 1}. **[${error.timestamp}]** ${error.content.message}\n`;
        if (error.phase) summary += `   - Phase: ${error.phase}\n`;
        if (error.metadata.projectId) summary += `   - Project: ${error.metadata.projectId}\n`;
      });
    }

    // Token usage summary
    const tokenUsage = entries
      .filter((e) => e.type === 'response' && e.metadata.tokenCount)
      .reduce((sum, e) => sum + (e.metadata.tokenCount || 0), 0);

    summary += `\n## Token Usage\n\n`;
    summary += `Total Tokens Used: ${tokenUsage}\n`;

    fs.writeFileSync(summaryFile, summary);

    return summaryFile;
  }

  public close(): void {
    this.flushLogs();

    if (this.flushInterval) {
      clearInterval(this.flushInterval);
    }

    if (this.logStream && !this.logStream.destroyed) {
      this.logStream.end();
    }

    // Generate summary on close
    try {
      const summaryPath = this.generateSummary();
      logger.info(`Log summary generated: ${summaryPath}`);
    } catch (error) {
      logger.error('Failed to generate log summary:', error);
    }
  }

  public getCurrentRunId(): string {
    return this.currentRunId;
  }

  public getLogDirectory(): string {
    return this.logDir;
  }
}
