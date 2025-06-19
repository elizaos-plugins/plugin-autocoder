import { Service, type IAgentRuntime, type Plugin, type Action, type Provider, type Evaluator } from '@elizaos/core';
import { Anthropic } from '@anthropic-ai/sdk';
import { EnhancedSecretManager, type SecretContext } from '@elizaos/plugin-secrets-manager';
import * as fs from 'fs-extra';
import path from 'path';
import { spawn, ChildProcess } from 'child_process';
import { v4 as uuidv4 } from 'uuid';
import * as utils from '../utils/plugin-templates';

export enum ClaudeModel {
  OPUS_3 = 'claude-3-opus-20240229',
  SONNET_3_5 = 'claude-3-5-sonnet-20241022',
}

export interface PluginSpecification {
  name: string;
  description: string;
  version?: string;
  actions?: ActionSpec[];
  providers?: ProviderSpec[];
  services?: ServiceSpec[];
  evaluators?: EvaluatorSpec[];
  environmentVariables?: EnvVarSpec[];
  dependencies?: string[];
}

export interface ActionSpec {
  name: string;
  description: string;
  parameters?: Record<string, any>;
}

export interface ProviderSpec {
  name: string;
  description: string;
  dataStructure?: Record<string, any>;
}

export interface ServiceSpec {
  name: string;
  description: string;
  methods?: string[];
}

export interface EvaluatorSpec {
  name: string;
  description: string;
}

export interface EnvVarSpec {
  name: string;
  description: string;
  required: boolean;
  sensitive: boolean;
}

export interface PluginJob {
  id: string;
  specification: PluginSpecification;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  createdAt: Date;
  startedAt?: Date;
  completedAt?: Date;
  error?: string;
  outputPath?: string;
  logs: string[];
  errors: string[];
  childProcess?: any;
}

export class PluginCreationService extends Service {
  static serviceType = 'plugin_creation';
  public capabilityDescription = 'Creates Eliza plugins using AI assistance';
  
  private anthropic?: Anthropic;
  private jobs: Map<string, PluginJob> = new Map();
  private selectedModel: ClaudeModel = ClaudeModel.SONNET_3_5;
  private jobTimeouts: Map<string, NodeJS.Timeout> = new Map();
  private readonly MAX_CONCURRENT_JOBS = 5;
  private readonly JOB_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes
  private readonly MAX_OUTPUT_SIZE = 1024 * 1024; // 1MB
  private readonly RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000; // 1 hour
  private readonly MAX_JOBS_PER_WINDOW = 10;
  private jobCreationTimes: number[] = [];
  private secretsManager: EnhancedSecretManager | null = null;
  declare protected runtime: IAgentRuntime;

  constructor(runtime: IAgentRuntime) {
    super();
    this.runtime = runtime;
    this.serviceName = PluginCreationService.serviceType;
  }

  async initialize(runtime: IAgentRuntime): Promise<void> {
    // Initialize secrets manager
    this.secretsManager = runtime.getService('SECRETS') as EnhancedSecretManager;
    if (!this.secretsManager) {
      console.warn('Secrets Manager service not available - using fallback to runtime.getSetting');
    }

    // Get API key through secrets manager
    const apiKey = await this.getAnthropicApiKey();
    if (apiKey) {
      this.anthropic = new Anthropic({ apiKey });
    } else {
      console.warn('ANTHROPIC_API_KEY not configured - plugin creation functionality will be limited');
    }
  }

  /**
   * Get secret context for secrets manager operations
   */
  private getSecretContext(): SecretContext {
    return {
      level: 'global',
      agentId: this.runtime.agentId,
      requesterId: this.runtime.agentId
    };
  }

  /**
   * Get Anthropic API key through secrets manager with fallback
   */
  private async getAnthropicApiKey(): Promise<string | null> {
    if (this.secretsManager) {
      try {
        const apiKey = await this.secretsManager.get('ANTHROPIC_API_KEY', this.getSecretContext());
        if (apiKey) {
          return apiKey;
        }
      } catch (error) {
        console.warn('[PluginCreationService] Failed to get ANTHROPIC_API_KEY from secrets manager:', error);
      }
    }

    // Fallback to runtime settings
    const fallbackKey = this.runtime.getSetting('ANTHROPIC_API_KEY');
    if (fallbackKey) {
      console.warn('[PluginCreationService] Using fallback API key from runtime settings');
      return fallbackKey;
    }

    return null;
  }

  static async start(runtime: IAgentRuntime): Promise<PluginCreationService> {
    const service = new PluginCreationService(runtime);
    await service.initialize(runtime);
    return service;
  }

  async stop(): Promise<void> {
    // Cancel all running jobs
    for (const job of this.jobs.values()) {
      if (job.status === 'running' || job.status === 'pending') {
        this.cancelJob(job.id);
      }
    }
    
    // Clear timeouts
    for (const timeout of this.jobTimeouts.values()) {
      clearTimeout(timeout);
    }
    this.jobTimeouts.clear();
  }

  setModel(model: ClaudeModel): void {
    this.selectedModel = model;
  }

  async createPlugin(specification: PluginSpecification, apiKeyOverride?: string): Promise<string> {
    // Validate specification
    if (!specification.name || !specification.description) {
      throw new Error('Plugin name and description are required');
    }

    // Validate plugin name for security
    if (!this.isValidPluginName(specification.name)) {
      throw new Error('Invalid plugin name - contains unsafe characters');
    }

    // Check concurrent job limit first
    const activeJobs = Array.from(this.jobs.values()).filter(
      job => job.status === 'running' || job.status === 'pending'
    ).length;

    if (activeJobs >= this.MAX_CONCURRENT_JOBS) {
      throw new Error('Too many concurrent jobs. Please wait for existing jobs to complete.');
    }

    // Rate limiting
    this.cleanupOldJobTimes();
    if (this.jobCreationTimes.length >= this.MAX_JOBS_PER_WINDOW) {
      throw new Error('Rate limit exceeded. Please try again later.');
    }

    // Create job
    const jobId = uuidv4();
    const job: PluginJob = {
      id: jobId,
      specification,
      status: 'pending',
      createdAt: new Date(),
      logs: [],
      errors: [],
      outputPath: path.join(process.cwd(), 'generated-plugins', this.sanitizePluginName(specification.name))
    };

    this.jobs.set(jobId, job);
    this.jobCreationTimes.push(Date.now());

    // Set timeout
    const timeout = setTimeout(() => {
      const job = this.jobs.get(jobId);
      if (job && (job.status === 'running' || job.status === 'pending')) {
        job.status = 'failed';
        job.error = 'Job timed out after 30 minutes';
        job.completedAt = new Date();
        this.killChildProcess(job);
      }
    }, this.JOB_TIMEOUT_MS);
    this.jobTimeouts.set(jobId, timeout);

    // Start async processing with a small delay for tests
    setTimeout(() => {
      this.processJob(jobId, apiKeyOverride).catch(error => {
        const job = this.jobs.get(jobId);
        if (job) {
          job.status = 'failed';
          job.error = error.message;
          job.completedAt = new Date();
          job.errors.push(error.message);
        }
      });
    }, 50); // Allow tests to check initial state

    return jobId;
  }

  getJobStatus(jobId: string): PluginJob | null {
    return this.jobs.get(jobId) || null;
  }

  getJob(jobId: string): PluginJob | undefined {
    return this.jobs.get(jobId);
  }

  getAllJobs(): PluginJob[] {
    return Array.from(this.jobs.values());
  }

  cancelJob(jobId: string): void {
    const job = this.jobs.get(jobId);
    if (job && (job.status === 'running' || job.status === 'pending')) {
      job.status = 'cancelled';
      job.completedAt = new Date();
      this.killChildProcess(job);
      
      // Clear timeout
      const timeout = this.jobTimeouts.get(jobId);
      if (timeout) {
        clearTimeout(timeout);
        this.jobTimeouts.delete(jobId);
      }
    }
  }

  cleanupOldJobs(): void {
    const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    
    for (const [jobId, job] of this.jobs.entries()) {
      if (job.completedAt && job.completedAt < oneWeekAgo) {
        this.jobs.delete(jobId);
        
        // Clean up output directory
        if (job.outputPath) {
          fs.remove(job.outputPath).catch(error => {
            console.error(`Failed to clean up job output: ${error.message}`);
          });
        }
      }
    }
  }

  private async processJob(jobId: string, apiKeyOverride?: string): Promise<void> {
    const job = this.jobs.get(jobId);
    if (!job) return;

    try {
      job.status = 'running';
      job.startedAt = new Date();

      // Create output directory
      await fs.ensureDir(job.outputPath!);

      // Generate plugin code
      if (this.shouldUseAI(job.specification)) {
        await this.generatePluginWithAI(job, apiKeyOverride);
      } else {
        await this.generatePluginWithTemplates(job);
      }

      // Create package.json
      await this.createPackageJson(job);

      // Create tests
      await this.createTests(job);

      // Run initial build and test
      await this.runCommand(job, 'npm', ['install']);
      await this.runCommand(job, 'npm', ['run', 'build']);
      await this.runCommand(job, 'npm', ['test']);

      job.status = 'completed';
      job.completedAt = new Date();

    } catch (error) {
      job.status = 'failed';
      job.error = error instanceof Error ? error.message : String(error);
      job.completedAt = new Date();
      job.errors.push(job.error);
      
      // Clean up on failure
      if (job.outputPath) {
        await fs.remove(job.outputPath).catch(() => {});
      }
    } finally {
      // Clear timeout
      const timeout = this.jobTimeouts.get(jobId);
      if (timeout) {
        clearTimeout(timeout);
        this.jobTimeouts.delete(jobId);
      }
    }
  }

  private shouldUseAI(specification: PluginSpecification): boolean {
    // Use AI for complex plugins
    const hasComplexActions = specification.actions?.some(
      action => action.parameters && Object.keys(action.parameters).length > 3
    );
    
    const hasServices = specification.services && specification.services.length > 0;
    const hasMultipleComponents = 
      (specification.actions?.length || 0) + 
      (specification.providers?.length || 0) + 
      (specification.services?.length || 0) + 
      (specification.evaluators?.length || 0) > 3;
    
    return hasComplexActions || hasServices || hasMultipleComponents;
  }

  private async generatePluginWithAI(job: PluginJob, apiKeyOverride?: string): Promise<void> {
    const anthropic = apiKeyOverride ? new Anthropic({ apiKey: apiKeyOverride }) : this.anthropic;
    
    if (!anthropic) {
      throw new Error('Anthropic API key is required for AI generation');
    }

    const prompt = this.buildAIPrompt(job.specification);
    
    try {
      const response = await anthropic.messages.create({
        model: this.selectedModel,
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 8000,
      });

      const content = response.content[0];
      if (content.type === 'text') {
        await this.parseAndWriteAIResponse(job, content.text);
      }
    } catch (error) {
      job.logs.push('AI generation failed, falling back to templates');
      await this.generatePluginWithTemplates(job);
    }
  }

  private async generatePluginWithTemplates(job: PluginJob): Promise<void> {
    const spec = job.specification;

    // Generate actions
    if (spec.actions) {
      await fs.ensureDir(path.join(job.outputPath!, 'src', 'actions'));
      for (const action of spec.actions) {
        const code = utils.generateActionCode(action.name, action.description || '');
        await fs.writeFile(
          path.join(job.outputPath!, 'src', 'actions', `${action.name}.ts`),
          code
        );
      }
    }

    // Generate providers
    if (spec.providers) {
      await fs.ensureDir(path.join(job.outputPath!, 'src', 'providers'));
      for (const provider of spec.providers) {
        const code = utils.generateProviderCode(provider.name, provider.description || '');
        await fs.writeFile(
          path.join(job.outputPath!, 'src', 'providers', `${provider.name}.ts`),
          code
        );
      }
    }

    // Generate services
    if (spec.services) {
      await fs.ensureDir(path.join(job.outputPath!, 'src', 'services'));
      for (const service of spec.services) {
        const code = utils.generateServiceCode(service.name, service.description || '');
        await fs.writeFile(
          path.join(job.outputPath!, 'src', 'services', `${service.name}.ts`),
          code
        );
      }
    }

    // Generate evaluators
    if (spec.evaluators) {
      await fs.ensureDir(path.join(job.outputPath!, 'src', 'evaluators'));
      for (const evaluator of spec.evaluators) {
        const code = utils.generateEvaluatorCode(evaluator.name, evaluator.description || '');
        await fs.writeFile(
          path.join(job.outputPath!, 'src', 'evaluators', `${evaluator.name}.ts`),
          code
        );
      }
    }

    // Generate index file
    const indexCode = utils.generatePluginIndex(spec.name, spec);
    await fs.writeFile(path.join(job.outputPath!, 'src', 'index.ts'), indexCode);
  }

  private async createPackageJson(job: PluginJob): Promise<void> {
    const packageJson = {
      name: job.specification.name,
      version: job.specification.version || '1.0.0',
      description: job.specification.description,
      main: 'dist/index.js',
      types: 'dist/index.d.ts',
      scripts: {
        build: 'tsc',
        test: 'vitest run',
        dev: 'vitest watch',
      },
      dependencies: {
        '@elizaos/core': '^0.1.0',
        ...(job.specification.dependencies?.reduce((acc, dep) => {
          acc[dep] = 'latest';
          return acc;
        }, {} as Record<string, string>) || {})
      },
      devDependencies: {
        typescript: '^5.0.0',
        vitest: '^1.0.0',
        '@types/node': '^20.0.0',
      },
      agentConfig: {
        pluginType: 'elizaos:plugin:1.0.0'
      }
    };

    await fs.writeJson(path.join(job.outputPath!, 'package.json'), packageJson, { spaces: 2 });

    // Create tsconfig.json
    const tsconfig = {
      compilerOptions: {
        target: 'es2022',
        module: 'commonjs',
        lib: ['es2022'],
        outDir: './dist',
        rootDir: './src',
        declaration: true,
        strict: true,
        esModuleInterop: true,
        skipLibCheck: true,
        forceConsistentCasingInFileNames: true,
        resolveJsonModule: true,
      },
      include: ['src/**/*'],
      exclude: ['node_modules', 'dist', '**/*.test.ts'],
    };

    await fs.writeJson(path.join(job.outputPath!, 'tsconfig.json'), tsconfig, { spaces: 2 });
  }

  private async createTests(job: PluginJob): Promise<void> {
    await fs.ensureDir(path.join(job.outputPath!, '__tests__'));
    
    // Generate generic plugin test
    const pluginName = job.specification.name.split('/').pop() || 'plugin';
    const testCode = utils.generateTestCode(pluginName, 'Plugin');
    await fs.writeFile(
      path.join(job.outputPath!, '__tests__', 'plugin.test.ts'),
      testCode
    );
  }

  private async runCommand(job: PluginJob, command: string, args: string[]): Promise<void> {
    return new Promise((resolve, reject) => {
      job.logs.push(`Running: ${command} ${args.join(' ')}`);
      
      const child = spawn(command, args, {
        cwd: job.outputPath,
        shell: false,
      });

      job.childProcess = child;

      let outputSize = 0;
      const maxOutputSize = this.MAX_OUTPUT_SIZE;

      const handleOutput = (data: Buffer) => {
        outputSize += data.length;
        if (outputSize > maxOutputSize) {
          job.logs.push('[Output truncated - exceeded 1MB limit]');
          return;
        }
        job.logs.push(data.toString());
      };

      child.stdout.on('data', handleOutput);
      child.stderr.on('data', (data) => {
        handleOutput(data);
        job.errors.push(data.toString());
      });

      const timeout = setTimeout(() => {
        child.kill('SIGTERM');
        reject(new Error(`Command timed out: ${command} ${args.join(' ')}`));
      }, 5 * 60 * 1000); // 5 minute timeout per command

      child.on('close', (code) => {
        clearTimeout(timeout);
        delete job.childProcess;
        
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`Command failed with exit code ${code}`));
        }
      });

      child.on('error', (error) => {
        clearTimeout(timeout);
        reject(error);
      });
    });
  }

  private buildAIPrompt(specification: PluginSpecification): string {
    let prompt = `Create a production-ready Eliza plugin with the following specification:

Name: ${specification.name}
Description: ${specification.description}
Version: ${specification.version || '1.0.0'}

IMPORTANT REQUIREMENTS:
1. Use TypeScript with strict type safety
2. Follow Eliza plugin architecture patterns exactly:
   - Actions must implement the Action interface with name, validate, handler
   - Providers must implement the Provider interface with get method
   - Services must extend the Service class and implement required methods
3. Include comprehensive error handling with try-catch blocks
4. Add proper logging using elizaLogger
5. Implement all required interfaces correctly
6. Include JSDoc comments for all public methods
7. Make it production-ready with no TODOs, stubs, or placeholder code
8. All handlers must return proper response objects with text and actions

COMMON MISTAKES TO AVOID:
- Do NOT use 'throw new Error("Not implemented")' - implement real functionality
- Do NOT return undefined from handlers - always return { text: string, actions?: any[] }
- Do NOT forget to validate inputs in action validators
- Do NOT use console.log - use elizaLogger instead
- Do NOT forget to handle edge cases and errors gracefully
- Do NOT leave any TypeScript errors or type issues

CODE PATTERNS TO FOLLOW:
// For Actions:
export const myAction: Action = {
  name: "myAction",
  description: "Description here",
  validate: async (runtime: IAgentRuntime, message: Memory) => {
    // Return true if action should run, false otherwise
    return true;
  },
  handler: async (runtime: IAgentRuntime, message: Memory, state?: State, options?: any, callback?: HandlerCallback) => {
    try {
      // Implementation here
      const result = "Action completed";
      
      if (callback) {
        callback({ text: result });
      }
      return { text: result, success: true };
    } catch (error) {
      elizaLogger.error("Error in myAction:", error);
      const errorMsg = "Failed to execute action";
      if (callback) {
        callback({ text: errorMsg, error: true });
      }
      return { text: errorMsg, success: false };
    }
  }
};

// For Providers:
export const myProvider: Provider = {
  get: async (runtime: IAgentRuntime, message: Memory, state?: State) => {
    try {
      const data = await fetchData();
      return {
        text: formatDataAsText(data),
        data: data
      };
    } catch (error) {
      elizaLogger.error("Error in provider:", error);
      return {
        text: "Unable to fetch data",
        data: {}
      };
    }
  }
};

// For Services:
export class MyService extends Service {
  static serviceType = "MY_SERVICE";
  
  async initialize(runtime: IAgentRuntime): Promise<void> {
    this.runtime = runtime;
    // Initialization logic
  }
  
  async start(): Promise<void> {
    // Start service
  }
  
  async stop(): Promise<void> {
    // Cleanup
  }
}

`;

    if (specification.actions?.length) {
      prompt += '\nActions:\n';
      specification.actions.forEach(action => {
        prompt += `- ${action.name}: ${action.description}\n`;
        if (action.parameters) {
          prompt += `  Parameters: ${JSON.stringify(action.parameters, null, 2)}\n`;
        }
      });
    }

    if (specification.providers?.length) {
      prompt += '\nProviders:\n';
      specification.providers.forEach(provider => {
        prompt += `- ${provider.name}: ${provider.description}\n`;
        if (provider.dataStructure) {
          prompt += `  Data Structure: ${JSON.stringify(provider.dataStructure, null, 2)}\n`;
        }
      });
    }

    if (specification.services?.length) {
      prompt += '\nServices:\n';
      specification.services.forEach(service => {
        prompt += `- ${service.name}: ${service.description}\n`;
        if (service.methods?.length) {
          prompt += `  Methods: ${service.methods.join(', ')}\n`;
        }
      });
    }

    if (specification.evaluators?.length) {
      prompt += '\nEvaluators:\n';
      specification.evaluators.forEach(evaluator => {
        prompt += `- ${evaluator.name}: ${evaluator.description}\n`;
      });
    }

    if (specification.environmentVariables?.length) {
      prompt += '\nEnvironment Variables:\n';
      specification.environmentVariables.forEach(envVar => {
        prompt += `- ${envVar.name}: ${envVar.description} (${envVar.required ? 'required' : 'optional'}, ${envVar.sensitive ? 'sensitive' : 'not sensitive'})\n`;
      });
    }

    prompt += `
Please generate the complete plugin code. Format your response as:

File: path/to/file.ts
\`\`\`typescript
// File contents here
\`\`\`

File: path/to/another-file.ts
\`\`\`typescript
// File contents here
\`\`\`

Include all necessary files including the main index.ts file that exports the plugin.`;

    return prompt;
  }

  private async parseAndWriteAIResponse(job: PluginJob, response: string): Promise<void> {
    const fileRegex = /File:\s*([^\n]+)\n```(?:typescript|javascript|ts|js)?\n([\s\S]*?)```/g;
    let match;

    while ((match = fileRegex.exec(response)) !== null) {
      const filePath = match[1].trim();
      const fileContent = match[2].trim();

      const fullPath = path.join(job.outputPath!, filePath);
      await fs.ensureDir(path.dirname(fullPath));
      await fs.writeFile(fullPath, fileContent);
      
      job.logs.push(`Created file: ${filePath}`);
    }

    // If no files were parsed, fall back to templates
    if (!fileRegex.test(response)) {
      job.logs.push('Could not parse AI response, falling back to templates');
      await this.generatePluginWithTemplates(job);
    }
  }

  private isValidPluginName(name: string): boolean {
    // Allow only safe characters
    const safePattern = /^[@a-zA-Z0-9\-_\/]+$/;
    
    // Prevent directory traversal
    if (name.includes('..') || name.includes('\\')) {
      return false;
    }
    
    return safePattern.test(name);
  }

  private sanitizePluginName(name: string): string {
    return name
      .replace('@', '')
      .replace(/[^a-zA-Z0-9\-_]/g, '-')
      .toLowerCase();
  }

  private killChildProcess(job: PluginJob): void {
    if (job.childProcess && !job.childProcess.killed) {
      job.childProcess.kill('SIGTERM');
      job.logs.push('Process terminated');
    }
  }

  private cleanupOldJobTimes(): void {
    const cutoffTime = Date.now() - this.RATE_LIMIT_WINDOW_MS;
    this.jobCreationTimes = this.jobCreationTimes.filter(time => time > cutoffTime);
  }

  // Test helper methods
  clearAllJobs(): void {
    // Cancel all running jobs
    for (const job of this.jobs.values()) {
      if (job.status === 'running' || job.status === 'pending') {
        this.cancelJob(job.id);
      }
    }
    this.jobs.clear();
    this.jobCreationTimes = [];
    
    // Clear timeouts
    for (const timeout of this.jobTimeouts.values()) {
      clearTimeout(timeout);
    }
    this.jobTimeouts.clear();
  }

  getActiveJobCount(): number {
    return Array.from(this.jobs.values()).filter(
      job => job.status === 'running' || job.status === 'pending'
    ).length;
  }
} 