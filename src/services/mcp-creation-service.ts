import type { IAgentRuntime } from '@elizaos/core';
import { Service, elizaLogger } from '@elizaos/core';
import * as fs from 'fs/promises';
import * as path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export interface MCPProjectConfig {
  name: string;
  description: string;
  outputDir: string;
  tools?: Array<{
    name: string;
    description: string;
    parameters?: Record<string, any>;
  }>;
  resources?: Array<{
    name: string;
    description: string;
    mimeType?: string;
  }>;
  dependencies?: string[];
  environment?: Record<string, string>;
}

export interface MCPProjectResult {
  success: boolean;
  projectPath?: string;
  error?: string;
  details?: {
    filesCreated: string[];
    toolsGenerated: string[];
    resourcesGenerated: string[];
  };
}

export class MCPCreationService extends Service {
  static serviceName = 'mcp-creation';
  capabilityDescription = 'Creates and manages MCP (Model Context Protocol) server projects';

  private templatePath: string;

  constructor(runtime: IAgentRuntime) {
    super();
    this.templatePath = path.join(__dirname, '../resources/templates/mcp-starter');
  }

  async start(): Promise<void> {
    elizaLogger.info('[MCP] MCP Creation Service started');
  }

  async stop(): Promise<void> {
    elizaLogger.info('[MCP] MCP Creation Service stopped');
  }

  /**
   * Create MCP project following the same rigorous workflow as plugin creation
   * This implements the iterative development cycle with checks after each step
   */
  async createMCPProject(config: MCPProjectConfig): Promise<MCPProjectResult> {
    try {
      elizaLogger.info('[MCP] 🚀 Starting MCP creation workflow:', config.name);

      // Validate required fields
      if (!config.name || config.name.trim() === '') {
        throw new Error('Project name is required');
      }

      // Sanitize project name to prevent directory traversal
      const sanitizedName = config.name
        .replace(/[^a-zA-Z0-9-]/g, '-') // Replace invalid chars with hyphens
        .replace(/\.+/g, '') // Remove dots
        .replace(/\/+/g, '-') // Replace slashes with hyphens
        .replace(/--+/g, '-') // Replace multiple hyphens with single
        .replace(/^-+|-+$/g, '') // Remove leading/trailing hyphens
        .toLowerCase();

      // Create project directory
      const projectPath = path.join(config.outputDir, sanitizedName);
      await fs.mkdir(projectPath, { recursive: true });

      const filesCreated: string[] = [];
      const toolsGenerated: string[] = [];
      const resourcesGenerated: string[] = [];
      
      let success = false;
      let iterations = 0;
      const maxIterations = 3;

      // STEP 1: Copy template files (equivalent to cloning plugin-starter)
      elizaLogger.info('[MCP] 📁 STEP 1: Copying MCP template files...');
      await this.copyTemplateFiles(this.templatePath, projectPath, filesCreated);

      // Iterative development loop
      while (!success && iterations < maxIterations) {
        iterations++;
        elizaLogger.info(`[MCP] 🔄 Development Iteration ${iterations}/${maxIterations}`);

        try {
          // STEP 2: Generate tools and resources
          elizaLogger.info('[MCP] 📝 STEP 2: Generating tools and resources...');
          await this.generateTools(projectPath, config.tools, toolsGenerated, filesCreated);
          await this.generateResources(projectPath, config.resources, resourcesGenerated, filesCreated);

          // STEP 3: Update server file
          elizaLogger.info('[MCP] 🔧 STEP 3: Updating server configuration...');
          await this.updateServerFile(projectPath, toolsGenerated, resourcesGenerated);

          // STEP 4: Update package.json
          elizaLogger.info('[MCP] 📦 STEP 4: Updating package.json...');
          await this.generatePackageJson(projectPath, config, filesCreated);

          // STEP 5: Create README
          elizaLogger.info('[MCP] 📚 STEP 5: Generating documentation...');
          await this.generateReadme(projectPath, config, filesCreated);

          // STEP 6: Run TypeScript compilation check
          elizaLogger.info('[MCP] ✅ STEP 6: Running tsc check...');
          const tscSuccess = await this.runCheck(projectPath, 'tsc');
          if (!tscSuccess) {
            elizaLogger.error('[MCP] ❌ TypeScript compilation failed, fixing errors...');
            await this.fixTypeScriptErrors(projectPath);
            continue;
          }

          // STEP 7: Run linting check
          elizaLogger.info('[MCP] ✅ STEP 7: Running eslint check...');
          const eslintSuccess = await this.runCheck(projectPath, 'eslint');
          if (!eslintSuccess) {
            elizaLogger.error('[MCP] ❌ ESLint check failed, fixing errors...');
            await this.fixLintErrors(projectPath);
            continue;
          }

          // STEP 8: Run build
          elizaLogger.info('[MCP] ✅ STEP 8: Running build...');
          const buildSuccess = await this.runCheck(projectPath, 'build');
          if (!buildSuccess) {
            elizaLogger.error('[MCP] ❌ Build failed, fixing issues...');
            continue;
          }

          // STEP 9: Run tests
          elizaLogger.info('[MCP] ✅ STEP 9: Running tests...');
          const testSuccess = await this.runCheck(projectPath, 'test');
          if (!testSuccess) {
            elizaLogger.error('[MCP] ❌ Tests failed, fixing issues...');
            await this.generateMissingTests(projectPath, config);
            continue;
          }

          // All checks passed!
          success = true;
          elizaLogger.info('[MCP] 🎉 All checks passed! MCP is production ready.');

        } catch (error) {
          elizaLogger.error(`[MCP] ❌ Iteration ${iterations} failed:`, error);
          if (iterations === maxIterations) {
            throw error;
          }
        }
      }

      if (!success) {
        throw new Error(`Failed to create production-ready MCP after ${maxIterations} iterations`);
      }

      // STEP 10: Initialize git repository
      elizaLogger.info('[MCP] 🗄️ STEP 10: Initializing git repository...');
      await this.initializeGit(projectPath);

      // STEP 11: Install dependencies
      elizaLogger.info('[MCP] 📦 STEP 11: Installing dependencies...');
      await this.installDependencies(projectPath);

      // STEP 12: Final production readiness check
      elizaLogger.info('[MCP] 🔍 STEP 12: Final production readiness validation...');
      const isProductionReady = await this.validateProductionReadiness(projectPath);
      if (!isProductionReady) {
        throw new Error('MCP failed final production readiness check');
      }

      return {
        success: true,
        projectPath,
        details: {
          filesCreated,
          toolsGenerated,
          resourcesGenerated,
        },
      };
    } catch (error) {
      elizaLogger.error('[MCP] Failed to create MCP project:', error);
      return {
        success: false,
        error: error.message || error.toString(),
      };
    }
  }

  /**
   * Copy template files to project directory
   */
  private async copyTemplateFiles(
    templatePath: string,
    projectPath: string,
    filesCreated: string[]
  ): Promise<void> {
    const items = await fs.readdir(templatePath);

    for (const item of items) {
      const sourcePath = path.join(templatePath, item);
      const targetPath = path.join(projectPath, item);
      const stat = await fs.stat(sourcePath);

      if (stat.isDirectory()) {
        await fs.mkdir(targetPath, { recursive: true });
        await this.copyTemplateFiles(sourcePath, targetPath, filesCreated);
      } else if (!item.endsWith('.template')) {
        await fs.copyFile(sourcePath, targetPath);
        filesCreated.push(path.relative(projectPath, targetPath));
      }
    }
  }

  /**
   * Generate package.json file
   */
  private async generatePackageJson(
    projectPath: string,
    config: MCPProjectConfig,
    filesCreated: string[]
  ): Promise<void> {
    const packageJson = {
      name: config.name,
      version: '0.1.0',
      type: 'module',
      description: config.description,
      main: './dist/index.js',
      types: './dist/index.d.ts',
      bin: {
        'mcp-server': './dist/mcp-server/index.js',
      },
      scripts: {
        build: 'tsc && chmod +x dist/mcp-server/index.js',
        start: 'node --loader ts-node/esm dist/mcp-server/index.js',
        dev: 'node --loader ts-node/esm src/mcp-server/index.ts',
        test: 'vitest run',
        'test:watch': 'vitest',
        lint: 'eslint src --ext .ts',
        typecheck: 'tsc --noEmit',
      },
      keywords: ['mcp', 'server'],
      author: '',
      license: 'MIT',
      dependencies: {
        '@modelcontextprotocol/sdk': '0.5.0',
        dotenv: '^16.0.0',
        ...this.getAdditionalDependencies(config.dependencies || []),
      },
      devDependencies: {
        '@types/node': '^22.10.0',
        'ts-node': '^10.9.2',
        typescript: '^5.3.0',
        vitest: '^1.0.0',
        '@typescript-eslint/eslint-plugin': '^6.0.0',
        '@typescript-eslint/parser': '^6.0.0',
        eslint: '^8.0.0',
      },
      engines: {
        node: '>=18.0.0',
      },
    };

    const packageJsonPath = path.join(projectPath, 'package.json');
    await fs.writeFile(packageJsonPath, JSON.stringify(packageJson, null, 2));
    filesCreated.push('package.json');
  }

  /**
   * Generate TypeScript configuration
   */
  private async generateTsConfig(projectPath: string, filesCreated: string[]): Promise<void> {
    const tsConfig = {
      compilerOptions: {
        target: 'ES2022',
        module: 'commonjs',
        lib: ['ES2022'],
        outDir: './dist',
        rootDir: './src',
        strict: true,
        esModuleInterop: true,
        skipLibCheck: true,
        forceConsistentCasingInFileNames: true,
        resolveJsonModule: true,
        moduleResolution: 'node',
        declaration: true,
        declarationMap: true,
        sourceMap: true,
      },
      include: ['src/**/*'],
      exclude: ['node_modules', 'dist', '**/*.test.ts'],
    };

    const tsconfigPath = path.join(projectPath, 'tsconfig.json');
    await fs.writeFile(tsconfigPath, JSON.stringify(tsConfig, null, 2));
    filesCreated.push('tsconfig.json');
  }

  /**
   * Generate tool files
   */
  private async generateTools(
    projectPath: string,
    tools: MCPProjectConfig['tools'],
    toolsGenerated: string[],
    filesCreated: string[]
  ): Promise<void> {
    const toolsDir = path.join(projectPath, 'src/mcp-server/tools');
    await fs.mkdir(toolsDir, { recursive: true });

    const templatePath = path.join(this.templatePath, 'src/mcp-server/tools/example-tool.ts.template');
    const templateContent = await fs.readFile(templatePath, 'utf-8');

    for (const tool of tools || []) {
      const toolFileName = `${tool.name.toLowerCase().replace(/[^a-z0-9]/g, '-')}-tool.ts`;
      const toolPath = path.join(toolsDir, toolFileName);

      // Generate implementation based on tool type
      const implementation = this.generateToolImplementation(tool.name, tool.description);
      
      // Extract required parameters
      const requiredParams: string[] = [];
      const parameters = tool.parameters || {};
      
      // Build parameters object
      const paramsObj = Object.entries(parameters).reduce((acc, [key, param]: [string, any]) => {
        acc[key] = {
          type: param.type || 'string',
          description: param.description || `${key} parameter`,
        };
        if (param.required) {
          requiredParams.push(key);
        }
        return acc;
      }, {} as Record<string, any>);

      // Generate tool file
      let toolContent = templateContent
        .replace(/\{\{TOOL_NAME\}\}/g, tool.name)
        .replace(/\{\{TOOL_DESCRIPTION\}\}/g, tool.description)
        .replace('{{TOOL_PARAMETERS}}', JSON.stringify(paramsObj, null, 2))
        .replace('{{TOOL_REQUIRED_PARAMS}}', JSON.stringify(requiredParams))
        .replace('{{TOOL_IMPLEMENTATION}}', implementation);

      await fs.writeFile(toolPath, toolContent);
      toolsGenerated.push(toolFileName);
      filesCreated.push(path.relative(projectPath, toolPath));
    }
  }

  /**
   * Generate actual tool implementation based on tool type
   */
  private generateToolImplementation(toolName: string, description: string): string {
    const normalizedName = toolName.toLowerCase();
    
    // Time-related tools
    if (normalizedName.includes('time') || normalizedName.includes('now') || normalizedName.includes('date')) {
      return `
      const now = new Date();
      
      // Handle timezone parameter if provided
      const timezone = params.timezone || 'UTC';
      const format = params.format || 'iso';
      
      let result;
      
      switch (format) {
        case 'unix':
          result = Math.floor(now.getTime() / 1000);
          break;
        case 'human':
          result = now.toLocaleString('en-US', { timeZone: timezone });
          break;
        case 'iso':
        default:
          result = now.toISOString();
      }
      
      return {
        success: true,
        time: result,
        timezone: timezone,
        format: format,
      };`;
    }
    
    // Math/calculation tools
    if (normalizedName.includes('add') || normalizedName.includes('sum') || normalizedName.includes('plus')) {
      return `
      // Validate inputs are numbers
      if (typeof params.a !== 'number' || typeof params.b !== 'number') {
        throw new Error('Both parameters must be numbers');
      }
      
      const result = params.a + params.b;
      
      return {
        success: true,
        result: result,
        operation: 'addition',
        inputs: { a: params.a, b: params.b },
      };`;
    }
    
    if (normalizedName.includes('multiply') || normalizedName.includes('product')) {
      return `
      // Validate inputs are numbers
      if (typeof params.a !== 'number' || typeof params.b !== 'number') {
        throw new Error('Both parameters must be numbers');
      }
      
      const result = params.a * params.b;
      
      return {
        success: true,
        result: result,
        operation: 'multiplication',
        inputs: { a: params.a, b: params.b },
      };`;
    }
    
    if (normalizedName.includes('subtract') || normalizedName.includes('minus')) {
      return `
      // Validate inputs are numbers
      if (typeof params.a !== 'number' || typeof params.b !== 'number') {
        throw new Error('Both parameters must be numbers');
      }
      
      const result = params.a - params.b;
      
      return {
        success: true,
        result: result,
        operation: 'subtraction',
        inputs: { a: params.a, b: params.b },
      };`;
    }
    
    if (normalizedName.includes('divide')) {
      return `
      // Validate inputs are numbers
      if (typeof params.a !== 'number' || typeof params.b !== 'number') {
        throw new Error('Both parameters must be numbers');
      }
      
      if (params.b === 0) {
        throw new Error('Division by zero is not allowed');
      }
      
      const result = params.a / params.b;
      
      return {
        success: true,
        result: result,
        operation: 'division',
        inputs: { a: params.a, b: params.b },
      };`;
    }
    
    if (normalizedName.includes('calculate') || normalizedName.includes('calc')) {
      return `
      // Parse expression safely
      const expression = params.expression;
      if (!expression || typeof expression !== 'string') {
        throw new Error('Expression must be a string');
      }
      
      // Basic safe math evaluation (only numbers and operators)
      const sanitized = expression.replace(/[^0-9+\\-*/()\\s.]/g, '');
      if (sanitized !== expression) {
        throw new Error('Invalid characters in expression');
      }
      
      try {
        // Use Function constructor for safe evaluation
        const result = new Function('return ' + sanitized)();
        
        return {
          success: true,
          result: result,
          expression: expression,
        };
      } catch (error) {
        throw new Error('Invalid mathematical expression');
      }`;
    }
    
    // File operations
    if (normalizedName.includes('read') && normalizedName.includes('file')) {
      return `
      const fs = await import('fs/promises');
      const path = await import('path');
      
      // Validate file path
      if (!params.path || typeof params.path !== 'string') {
        throw new Error('File path is required');
      }
      
      // Security: Prevent directory traversal
      const normalizedPath = path.normalize(params.path);
      if (normalizedPath.includes('..')) {
        throw new Error('Directory traversal is not allowed');
      }
      
      // Check if file exists
      try {
        await fs.access(normalizedPath);
      } catch {
        throw new Error('File not found');
      }
      
      // Read file
      const encoding = params.encoding || 'utf-8';
      const content = await fs.readFile(normalizedPath, encoding);
      
      return {
        success: true,
        content: content,
        path: normalizedPath,
        encoding: encoding,
        size: content.length,
      };`;
    }
    
    if (normalizedName.includes('write') && normalizedName.includes('file')) {
      return `
      const fs = await import('fs/promises');
      const path = await import('path');
      
      // Validate inputs
      if (!params.path || typeof params.path !== 'string') {
        throw new Error('File path is required');
      }
      
      if (!params.content) {
        throw new Error('Content is required');
      }
      
      // Security: Prevent directory traversal
      const normalizedPath = path.normalize(params.path);
      if (normalizedPath.includes('..')) {
        throw new Error('Directory traversal is not allowed');
      }
      
      // Write file
      const encoding = params.encoding || 'utf-8';
      await fs.writeFile(normalizedPath, params.content, encoding);
      
      return {
        success: true,
        path: normalizedPath,
        encoding: encoding,
        size: params.content.length,
      };`;
    }
    
    // Weather (example external API)
    if (normalizedName.includes('weather')) {
      return `
      // Validate location
      if (!params.location || typeof params.location !== 'string') {
        throw new Error('Location is required');
      }
      
      // In a real implementation, you would call a weather API here
      // For demo purposes, return mock data
      const mockWeather = {
        location: params.location,
        temperature: Math.floor(Math.random() * 30) + 10,
        conditions: ['sunny', 'cloudy', 'rainy', 'partly cloudy'][Math.floor(Math.random() * 4)],
        humidity: Math.floor(Math.random() * 60) + 40,
        windSpeed: Math.floor(Math.random() * 20) + 5,
      };
      
      return {
        success: true,
        weather: mockWeather,
        timestamp: new Date().toISOString(),
        unit: params.unit || 'celsius',
      };`;
    }
    
    // Echo/test tool
    if (normalizedName.includes('echo') || normalizedName.includes('test')) {
      return `
      // Simple echo tool for testing
      return {
        success: true,
        echo: params,
        timestamp: new Date().toISOString(),
      };`;
    }
    
    // Database query
    if (normalizedName.includes('query') || normalizedName.includes('database') || normalizedName.includes('sql')) {
      return `
      // Validate query
      if (!params.query || typeof params.query !== 'string') {
        throw new Error('Query is required');
      }
      
      // Security: Basic SQL injection prevention
      const dangerousKeywords = ['DROP', 'DELETE', 'TRUNCATE', 'ALTER', 'CREATE'];
      const upperQuery = params.query.toUpperCase();
      
      for (const keyword of dangerousKeywords) {
        if (upperQuery.includes(keyword)) {
          throw new Error(\`Dangerous SQL keyword detected: \${keyword}\`);
        }
      }
      
      // In a real implementation, use parameterized queries
      // For demo, return mock data
      return {
        success: true,
        rows: [
          { id: 1, name: 'Example Row 1', created: new Date().toISOString() },
          { id: 2, name: 'Example Row 2', created: new Date().toISOString() },
        ],
        rowCount: 2,
        query: params.query,
      };`;
    }
    
    // HTTP request
    if (normalizedName.includes('request') || normalizedName.includes('http') || normalizedName.includes('api')) {
      return `
      // Validate required parameters
      if (!params.url || typeof params.url !== 'string') {
        throw new Error('URL is required');
      }
      
      const method = params.method || 'GET';
      const headers = params.headers || {};
      
      // Security: Validate URL
      let parsedUrl;
      try {
        parsedUrl = new URL(params.url);
      } catch {
        throw new Error('Invalid URL');
      }
      
      // Only allow HTTP/HTTPS
      if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
        throw new Error('Only HTTP/HTTPS protocols are allowed');
      }
      
      // In a real implementation, use fetch or axios
      // For demo, return mock response
      return {
        success: true,
        status: 200,
        statusText: 'OK',
        headers: {
          'content-type': 'application/json',
          'x-mock-response': 'true',
        },
        body: {
          message: 'Mock response',
          method: method,
          url: params.url,
        },
      };`;
    }
    
    // Default implementation for unknown tools
    return `
      // Generic tool implementation
      console.log('Executing ${toolName} with parameters:', params);
      
      // Process based on parameters
      const result = {
        success: true,
        toolName: '${toolName}',
        description: '${description}',
        parameters: params,
        timestamp: new Date().toISOString(),
      };
      
      // Add any parameter-specific processing here
      if (params) {
        result.processedParams = Object.entries(params).map(([key, value]) => ({
          key,
          value,
          type: typeof value,
        }));
      }
      
      return result;`;
  }

  /**
   * Generate resource files
   */
  private async generateResources(
    projectPath: string,
    resources: MCPProjectConfig['resources'],
    resourcesGenerated: string[],
    filesCreated: string[]
  ): Promise<void> {
    const resourcesDir = path.join(projectPath, 'src/mcp-server/resources');
    await fs.mkdir(resourcesDir, { recursive: true });

    const templatePath = path.join(
      this.templatePath,
      'src/mcp-server/resources/example-resource.ts.template'
    );
    const templateContent = await fs.readFile(templatePath, 'utf-8');

    for (const resource of resources || []) {
      const resourceFileName = `${resource.name.toLowerCase().replace(/[^a-z0-9]/g, '-')}-resource.ts`;
      const resourcePath = path.join(resourcesDir, resourceFileName);

      const resourceContent = templateContent
        .replace(/{{RESOURCE_NAME}}/g, resource.name)
        .replace(/{{RESOURCE_DESCRIPTION}}/g, resource.description)
        .replace(/{{RESOURCE_MIME_TYPE}}/g, resource.mimeType || 'application/json');

      await fs.writeFile(resourcePath, resourceContent);
      resourcesGenerated.push(resourceFileName);
      filesCreated.push(path.relative(projectPath, resourcePath));
    }
  }

  /**
   * Update server file with tools and resources
   */
  private async updateServerFile(
    projectPath: string,
    toolsGenerated: string[],
    resourcesGenerated: string[]
  ): Promise<void> {
    const serverPath = path.join(projectPath, 'src/mcp-server/index.ts');
    let serverContent = await fs.readFile(serverPath, 'utf-8');

    // Generate tool imports
    const toolImports = toolsGenerated
      .map((file) => {
        const name = file.replace('-tool.ts', '').replace(/-/g, '_');
        return `import { ${name}Tool } from './tools/${file.replace('.ts', '.js')}';`;
      })
      .join('\n');

    serverContent = serverContent.replace(
      '// {{TOOL_IMPORTS}}',
      toolImports
    );

    // Generate resource imports
    const resourceImports = resourcesGenerated
      .map((file) => {
        const name = file.replace('-resource.ts', '').replace(/-/g, '_');
        return `import { ${name}Resource } from './resources/${file.replace('.ts', '.js')}';`;
      })
      .join('\n');

    serverContent = serverContent.replace(
      '// {{RESOURCE_IMPORTS}}',
      resourceImports
    );

    // Register tools
    const toolRegistrations = toolsGenerated
      .map((file) => {
        const name = file.replace('-tool.ts', '').replace(/-/g, '_');
        return `  tools.push(${name}Tool);`;
      })
      .join('\n');

    serverContent = serverContent.replace(
      '// {{REGISTER_TOOLS}}',
      toolRegistrations
    );

    // Register resources
    const resourceRegistrations = resourcesGenerated
      .map((file) => {
        const name = file.replace('-resource.ts', '').replace(/-/g, '_');
        return `  resources.push(${name}Resource);`;
      })
      .join('\n');

    serverContent = serverContent.replace(
      '// {{REGISTER_RESOURCES}}',
      resourceRegistrations
    );

    await fs.writeFile(serverPath, serverContent);
  }

  /**
   * Generate README file
   */
  private async generateReadme(
    projectPath: string,
    config: MCPProjectConfig,
    filesCreated: string[]
  ): Promise<void> {
    let readme = `# ${config.name}\n\n`;
    readme += `${config.description || 'An MCP (Model Context Protocol) server'}\n\n`;
    readme += `## Installation\n\n`;
    readme += `\`\`\`bash\nnpm install\n\`\`\`\n\n`;
    readme += `## Usage\n\n`;
    readme += `### Development\n\n`;
    readme += `\`\`\`bash\nnpm run dev\n\`\`\`\n\n`;
    readme += `### Production\n\n`;
    readme += `\`\`\`bash\nnpm run build\nnpm start\n\`\`\`\n\n`;

    if (config.tools && config.tools.length > 0) {
      readme += `## Available Tools\n\n`;
      for (const tool of config.tools) {
        readme += `### ${tool.name}\n\n`;
        readme += `${tool.description}\n\n`;
        if (tool.parameters) {
          readme += `**Parameters:**\n\`\`\`json\n${JSON.stringify(tool.parameters, null, 2)}\n\`\`\`\n\n`;
        }
      }
    }

    if (config.resources && config.resources.length > 0) {
      readme += `## Available Resources\n\n`;
      for (const resource of config.resources) {
        readme += `### ${resource.name}\n\n`;
        readme += `${resource.description}\n\n`;
        if (resource.mimeType) {
          readme += `**MIME Type:** ${resource.mimeType}\n\n`;
        }
      }
    }

    readme += `## Testing\n\n`;
    readme += `\`\`\`bash\nnpm test\n\`\`\`\n\n`;
    readme += `## License\n\nMIT\n`;

    const readmePath = path.join(projectPath, 'README.md');
    await fs.writeFile(readmePath, readme);
    filesCreated.push('README.md');
  }

  /**
   * Initialize git repository
   */
  private async initializeGit(projectPath: string): Promise<void> {
    try {
      await execAsync('git init', { cwd: projectPath });
      
      // Create .gitignore
      const gitignore = `node_modules/
dist/
.env
.env.local
*.log
.DS_Store
coverage/
.vscode/
`;
      await fs.writeFile(path.join(projectPath, '.gitignore'), gitignore);
      
      await execAsync('git add .', { cwd: projectPath });
      await execAsync('git commit -m "Initial commit"', { cwd: projectPath });
    } catch (error) {
      elizaLogger.warn('[MCP] Failed to initialize git repository:', error.message);
    }
  }

  /**
   * Install project dependencies
   */
  private async installDependencies(projectPath: string): Promise<void> {
    try {
      elizaLogger.info('[MCP] Installing dependencies...');
      await execAsync('npm install', { cwd: projectPath });
    } catch (error) {
      elizaLogger.warn('[MCP] Failed to install dependencies:', error.message);
    }
  }

  /**
   * Get additional dependencies based on configuration
   */
  private getAdditionalDependencies(deps: string[]): Record<string, string> {
    const dependencies: Record<string, string> = {};
    
    for (const dep of deps) {
      // Handle package@version format
      if (dep.includes('@')) {
        const atIndex = dep.lastIndexOf('@');
        const packageName = dep.substring(0, atIndex);
        const version = dep.substring(atIndex + 1);
        dependencies[packageName] = version;
      } else {
        // Add common dependencies with default versions
        if (dep === 'axios') dependencies['axios'] = '^1.6.0';
        if (dep === 'dotenv') dependencies['dotenv'] = '^16.0.0';
        if (dep === 'zod') dependencies['zod'] = '^3.22.0';
        if (dep === 'node-fetch') dependencies['node-fetch'] = '^3.0.0';
        if (dep === 'pg') dependencies['pg'] = '^8.11.0';
        // Add more as needed
      }
    }
    
    return dependencies;
  }

  /**
   * Check if file exists
   */
  private async fileExists(filePath: string): Promise<boolean> {
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Run various checks (tsc, eslint, build, test)
   */
  private async runCheck(projectPath: string, checkType: 'tsc' | 'eslint' | 'build' | 'test'): Promise<boolean> {
    try {
      elizaLogger.info(`[MCP] Running ${checkType} check...`);
      
      let command: string;
      switch (checkType) {
        case 'tsc':
          command = 'npx tsc --noEmit';
          break;
        case 'eslint':
          command = 'npx eslint src --ext .ts';
          break;
        case 'build':
          command = 'npm run build';
          break;
        case 'test':
          command = 'npm test';
          break;
      }

      const { stdout, stderr } = await execAsync(command, { cwd: projectPath });
      
      if (stderr && checkType !== 'eslint') { // ESLint writes warnings to stderr
        elizaLogger.warn(`[MCP] ${checkType} warnings:`, stderr);
      }
      
      elizaLogger.info(`[MCP] ${checkType} check passed`);
      return true;
    } catch (error) {
      elizaLogger.error(`[MCP] ${checkType} check failed:`, error.message);
      return false;
    }
  }

  /**
   * Fix TypeScript errors by analyzing and correcting common issues
   */
  private async fixTypeScriptErrors(projectPath: string): Promise<void> {
    try {
      // Run tsc to get error details
      const { stderr } = await execAsync('npx tsc --noEmit', { cwd: projectPath }).catch(e => e);
      
      if (stderr) {
        elizaLogger.info('[MCP] Analyzing TypeScript errors...');
        
        // Common fixes for TypeScript errors
        const srcDir = path.join(projectPath, 'src');
        const files = await this.getAllTypeScriptFiles(srcDir);
        
        for (const file of files) {
          let content = await fs.readFile(file, 'utf-8');
          let modified = false;
          
          // Add missing type imports
          if (stderr.includes("Cannot find name") && !content.includes('import type')) {
            content = `import type { McpContext, McpToolResult } from '../types';\n` + content;
            modified = true;
          }
          
          // Fix any type issues
          if (stderr.includes("implicitly has an 'any' type")) {
            content = content.replace(/\((\w+)\)/g, '($1: any)');
            modified = true;
          }
          
          if (modified) {
            await fs.writeFile(file, content);
          }
        }
      }
    } catch (error) {
      elizaLogger.warn('[MCP] Error fixing TypeScript issues:', error.message);
    }
  }

  /**
   * Fix ESLint errors
   */
  private async fixLintErrors(projectPath: string): Promise<void> {
    try {
      // Run ESLint with fix flag
      await execAsync('npx eslint src --ext .ts --fix', { cwd: projectPath });
      elizaLogger.info('[MCP] ESLint errors fixed');
    } catch (error) {
      elizaLogger.warn('[MCP] Some ESLint errors could not be auto-fixed:', error.message);
    }
  }

  /**
   * Generate missing tests for tools and resources
   */
  private async generateMissingTests(projectPath: string, config: MCPProjectConfig): Promise<void> {
    try {
      const testDir = path.join(projectPath, 'src/__tests__');
      await fs.mkdir(testDir, { recursive: true });
      
      // Generate test for each tool
      for (const tool of config.tools || []) {
        const testFileName = `${tool.name.toLowerCase().replace(/[^a-z0-9]/g, '-')}.test.ts`;
        const testPath = path.join(testDir, testFileName);
        
        if (!(await this.fileExists(testPath))) {
          const testContent = `import { describe, it, expect } from 'vitest';
import { ${tool.name}Tool } from '../mcp-server/tools/${tool.name.toLowerCase().replace(/[^a-z0-9]/g, '-')}-tool';

describe('${tool.name} Tool', () => {
  it('should execute successfully with valid parameters', async () => {
    const result = await ${tool.name}Tool.execute({
      // Add test parameters here
    });
    
    expect(result).toBeDefined();
    expect(result.success).toBe(true);
  });
  
  it('should handle errors gracefully', async () => {
    await expect(${tool.name}Tool.execute({})).rejects.toThrow();
  });
});
`;
          await fs.writeFile(testPath, testContent);
        }
      }
      
      elizaLogger.info('[MCP] Generated missing tests');
    } catch (error) {
      elizaLogger.warn('[MCP] Error generating tests:', error.message);
    }
  }

  /**
   * Get all TypeScript files in a directory
   */
  private async getAllTypeScriptFiles(dir: string): Promise<string[]> {
    const files: string[] = [];
    const items = await fs.readdir(dir);
    
    for (const item of items) {
      const fullPath = path.join(dir, item);
      const stat = await fs.stat(fullPath);
      
      if (stat.isDirectory() && !item.includes('node_modules')) {
        files.push(...await this.getAllTypeScriptFiles(fullPath));
      } else if (item.endsWith('.ts')) {
        files.push(fullPath);
      }
    }
    
    return files;
  }

  /**
   * Validate production readiness
   */
  private async validateProductionReadiness(projectPath: string): Promise<boolean> {
    try {
      elizaLogger.info('[MCP] Validating production readiness...');
      
      // Check for required files
      const requiredFiles = [
        'package.json',
        'tsconfig.json',
        'README.md',
        'src/index.ts',
        'src/mcp-server/index.ts',
      ];
      
      for (const file of requiredFiles) {
        if (!(await this.fileExists(path.join(projectPath, file)))) {
          elizaLogger.error(`[MCP] Missing required file: ${file}`);
          return false;
        }
      }
      
      // Run all checks one more time
      const checks = ['tsc', 'eslint', 'build', 'test'] as const;
      for (const check of checks) {
        if (!(await this.runCheck(projectPath, check))) {
          elizaLogger.error(`[MCP] Production readiness check failed: ${check}`);
          return false;
        }
      }
      
      elizaLogger.info('[MCP] ✅ Production readiness validated');
      return true;
    } catch (error) {
      elizaLogger.error('[MCP] Production readiness validation failed:', error);
      return false;
    }
  }
}