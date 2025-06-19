import { logger, type IAgentRuntime } from '@elizaos/core';
import { PluginManagerService } from '@elizaos/plugin-plugin-manager';
import * as ts from 'typescript';
import * as fs from 'fs-extra';
import * as path from 'path';
import { glob } from 'glob';

// Define PluginSearchResult locally since it's not exported from plugin-plugin-manager
export interface PluginSearchResult {
  name: string;
  path: string;
  description?: string;
  actions: string[];
  providers: string[];
  services: string[];
  evaluators: string[];
}

/**
 * Information about a discovered service
 */
export interface ServiceInfo {
  name: string;
  serviceType: string;
  capabilityDescription?: string;
  sourceFile?: string;
}

/**
 * Information about a discovered plugin
 */
export interface PluginInfo {
  name: string;
  description?: string;
  path: string;
  packageJson?: any;
  services: ServiceInfo[];
  actions: ActionInfo[];
  providers: ProviderInfo[];
  dependencies: string[];
}

/**
 * Information about a service method
 */
export interface MethodInfo {
  name: string;
  signature: string;
  parameters: ParameterInfo[];
  returnType: string;
  description?: string;
  example?: string;
}

/**
 * Information about a method parameter
 */
export interface ParameterInfo {
  name: string;
  type: string;
  optional: boolean;
  description?: string;
}

/**
 * Information about a discovered action
 */
export interface ActionInfo {
  name: string;
  description?: string;
  signature?: string; // For backward compatibility
  validateSignature: string;
  handlerSignature: string;
  parameters?: any[]; // For compatibility with other parts of the system
  returnType?: string; // For compatibility with other parts of the system
  examples?: string[];
  sourceFile?: string;
}

/**
 * Information about a discovered provider
 */
export interface ProviderInfo {
  name: string;
  description?: string;
  signature?: string; // For backward compatibility
  getSignature: string;
  parameters?: any[]; // For compatibility with other parts of the system
  returnType?: string; // For compatibility with other parts of the system
  sourceFile?: string;
}

/**
 * Result of service discovery for a plugin
 */
export interface ServiceDiscoveryResult {
  pluginName: string;
  pluginPath?: string;
  services: ServiceInfo[];
  actions: ActionInfo[];
  providers: ProviderInfo[];
  dependencies: string[];
  errors?: string[];
}

/**
 * Result of comprehensive service discovery
 */
export interface DiscoveryResult {
  plugins: PluginInfo[];
  services: ServiceInfo[];
  actions: ActionInfo[];
  providers: ProviderInfo[];
}

/**
 * Options for service discovery
 */
export interface DiscoveryOptions {
  includePrivateMethods?: boolean;
  includeInternalServices?: boolean;
  maxDepth?: number;
}

/**
 * Manager for discovering services, actions, and providers in ElizaOS plugins
 */
export class ServiceDiscoveryManager {
  private program: ts.Program | null = null;
  private checker: ts.TypeChecker | null = null;
  private runtime?: IAgentRuntime;

  constructor(runtime?: IAgentRuntime) {
    this.runtime = runtime;
  }

  /**
   * Discover services based on search terms
   */
  public async discoverServices(searchTerms: string[]): Promise<DiscoveryResult> {
    // Try plugin manager first if available
    if (this.runtime) {
      const pluginManagerResult = await this.discoverFromPluginManager(searchTerms);
      if (pluginManagerResult.plugins.length > 0) {
        logger.info(`[ServiceDiscovery] Found ${pluginManagerResult.plugins.length} plugins via Plugin Manager`);
        return pluginManagerResult;
      }
    }

    // Fallback to filesystem discovery
    logger.info('[ServiceDiscovery] Plugin Manager unavailable, falling back to filesystem discovery');
    return await this.discoverFromFilesystem(searchTerms);
  }

  /**
   * Discover services using the Plugin Manager
   */
  private async discoverFromPluginManager(searchTerms: string[]): Promise<DiscoveryResult> {
    const allPlugins: PluginInfo[] = [];
    const allServices: ServiceInfo[] = [];
    const allActions: ActionInfo[] = [];
    const allProviders: ProviderInfo[] = [];

    try {
      const pluginManager = this.runtime?.getService('PLUGIN_MANAGER') as PluginManagerService;
      if (!pluginManager) {
        logger.warn('[ServiceDiscovery] Plugin Manager service not available');
        return { plugins: allPlugins, services: allServices, actions: allActions, providers: allProviders };
      }

      // Get all loaded plugins
      const loadedPlugins = await pluginManager.getAllPlugins();
      
      for (const pluginState of loadedPlugins) {
        if (pluginState.status === 'loaded' && pluginState.plugin) {
          const plugin = pluginState.plugin;
          
          // Check if plugin matches search terms
          const matchesSearch = this.pluginMatchesSearchTerms(plugin, searchTerms);
          if (matchesSearch) {
            const services = await this.extractServicesFromPlugin(plugin);
            const actions = await this.extractActionsFromPlugin(plugin);
            const providers = await this.extractProvidersFromPlugin(plugin);

            const pluginInfo: PluginInfo = {
              name: plugin.name,
              description: plugin.description,
              path: (pluginState as any).path || 'loaded',
              packageJson: pluginState.packageJson,
              services,
              actions,
              providers,
              dependencies: plugin.dependencies || [],
            };

            allPlugins.push(pluginInfo);
            allServices.push(...services);
            allActions.push(...actions);
            allProviders.push(...providers);
          }
        }
      }
    } catch (error) {
      logger.error('[ServiceDiscovery] Error discovering from Plugin Manager:', error);
    }

    return {
      plugins: allPlugins,
      services: allServices,
      actions: allActions,
      providers: allProviders,
    };
  }

  /**
   * Discover services from filesystem (fallback method)
   */
  private async discoverFromFilesystem(searchTerms: string[]): Promise<DiscoveryResult> {
    const elizaPath = path.resolve(process.cwd(), '../..');
    const pluginsPath = path.join(elizaPath, 'packages');

    const allPlugins: PluginInfo[] = [];
    const allServices: ServiceInfo[] = [];
    const allActions: ActionInfo[] = [];
    const allProviders: ProviderInfo[] = [];

    // Find all plugin directories
    const pluginDirs = await glob('plugin-*/', {
      cwd: pluginsPath,
      absolute: true,
    });

    for (const pluginDir of pluginDirs) {
      const result = await this.analyzePlugin(pluginDir);
      if (result) {
        // Check if plugin matches search terms
        const matchesSearch = this.matchesSearchTerms(result, searchTerms);
        if (matchesSearch) {
          const pluginInfo: PluginInfo = {
            name: result.pluginName,
            path: pluginDir,
            services: result.services,
            actions: result.actions,
            providers: result.providers,
            dependencies: result.dependencies,
          };
          allPlugins.push(pluginInfo);
          allServices.push(...result.services);
          allActions.push(...result.actions);
          allProviders.push(...result.providers);
        }
      }
    }

    return {
      plugins: allPlugins,
      services: allServices,
      actions: allActions,
      providers: allProviders,
    };
  }

  /**
   * Check if a plugin matches search terms
   */
  private pluginMatchesSearchTerms(plugin: any, searchTerms: string[]): boolean {
    const pluginText = (
      plugin.name + ' ' + 
      (plugin.description || '') + ' ' +
      (plugin.services?.map((s: any) => s.serviceName || s.name || '').join(' ') || '') + ' ' +
      (plugin.actions?.map((a: any) => a.name || '').join(' ') || '') + ' ' +
      (plugin.providers?.map((p: any) => p.name || '').join(' ') || '')
    ).toLowerCase();

    return searchTerms.some(term => 
      pluginText.includes(term.toLowerCase())
    );
  }

  /**
   * Extract service information from a plugin
   */
  private async extractServicesFromPlugin(plugin: any): Promise<ServiceInfo[]> {
    const services: ServiceInfo[] = [];
    
    if (plugin.services) {
      for (const service of plugin.services) {
        const serviceInfo: ServiceInfo = {
          name: service.serviceName || service.name || service.constructor?.name || 'Unknown',
          serviceType: service.serviceType || service.constructor?.serviceType || 'unknown',
          capabilityDescription: service.capabilityDescription || '',
          sourceFile: 'plugin'
        };
        services.push(serviceInfo);
      }
    }
    
    return services;
  }

  /**
   * Extract action information from a plugin
   */
  private async extractActionsFromPlugin(plugin: any): Promise<ActionInfo[]> {
    const actions: ActionInfo[] = [];
    
    if (plugin.actions) {
      for (const action of plugin.actions) {
        const actionInfo: ActionInfo = {
          name: action.name || 'Unknown',
          description: action.description || '',
          signature: action.signature || 'handler(runtime, message, state, options, callback)',
          validateSignature: 'validate(runtime, message, state)',
          handlerSignature: 'handler(runtime, message, state, options, callback)',
          parameters: [], // Could be enhanced to parse actual parameters
          returnType: 'Promise<any>',
          sourceFile: 'plugin'
        };
        actions.push(actionInfo);
      }
    }
    
    return actions;
  }

  /**
   * Extract provider information from a plugin
   */
  private async extractProvidersFromPlugin(plugin: any): Promise<ProviderInfo[]> {
    const providers: ProviderInfo[] = [];
    
    if (plugin.providers) {
      for (const provider of plugin.providers) {
        const providerInfo: ProviderInfo = {
          name: provider.name || 'Unknown',
          description: provider.description || '',
          signature: provider.signature || 'get(runtime, message, state)',
          getSignature: 'get(runtime, message, state)',
          parameters: [], // Could be enhanced to parse actual parameters
          returnType: 'Promise<ProviderResult>',
          sourceFile: 'plugin'
        };
        providers.push(providerInfo);
      }
    }
    
    return providers;
  }

  /**
   * Analyze a plugin directory to discover services, actions, and providers
   */
  async analyzePlugin(
    pluginPath: string,
    options: DiscoveryOptions = {}
  ): Promise<ServiceDiscoveryResult> {
    logger.info(`[ServiceDiscovery] Analyzing plugin at: ${pluginPath}`);

    const result: ServiceDiscoveryResult = {
      pluginName: path.basename(pluginPath),
      pluginPath,
      services: [],
      actions: [],
      providers: [],
      dependencies: [],
      errors: [],
    };

    try {
      // Check if plugin directory exists
      if (!(await fs.pathExists(pluginPath))) {
        throw new Error(`Plugin directory not found: ${pluginPath}`);
      }

      // Read package.json for dependencies
      const packageJsonPath = path.join(pluginPath, 'package.json');
      if (await fs.pathExists(packageJsonPath)) {
        const packageJson = await fs.readJson(packageJsonPath);
        result.pluginName = packageJson.name || result.pluginName;
        result.dependencies = Object.keys({
          ...packageJson.dependencies,
          ...packageJson.peerDependencies,
        }).filter((dep) => dep.startsWith('@elizaos/'));
      }

      // Find TypeScript files
      const srcPath = path.join(pluginPath, 'src');
      if (!(await fs.pathExists(srcPath))) {
        throw new Error(`Source directory not found: ${srcPath}`);
      }

      const tsFiles = await this.findTypeScriptFiles(srcPath);

      // Create TypeScript program
      this.createProgram(tsFiles);

      // Analyze each file
      for (const file of tsFiles) {
        await this.analyzeFile(file, result, options);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error(`[ServiceDiscovery] Error analyzing plugin: ${errorMessage}`);
      result.errors?.push(errorMessage);
    }

    return result;
  }

  /**
   * Find all TypeScript files in a directory
   */
  private async findTypeScriptFiles(dir: string): Promise<string[]> {
    const files: string[] = [];
    const entries = await fs.readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules') {
        const subFiles = await this.findTypeScriptFiles(fullPath);
        files.push(...subFiles);
      } else if (entry.isFile() && entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts')) {
        files.push(fullPath);
      }
    }

    return files;
  }

  /**
   * Create TypeScript program for analysis
   */
  private createProgram(files: string[]): void {
    const options: ts.CompilerOptions = {
      target: ts.ScriptTarget.ES2020,
      module: ts.ModuleKind.CommonJS,
      lib: ['es2020'],
      skipLibCheck: true,
      skipDefaultLibCheck: true,
    };

    this.program = ts.createProgram(files, options);
    this.checker = this.program.getTypeChecker();
  }

  /**
   * Analyze a single TypeScript file
   */
  private async analyzeFile(
    filePath: string,
    result: ServiceDiscoveryResult,
    options: DiscoveryOptions
  ): Promise<void> {
    if (!this.program || !this.checker) {
      return;
    }

    const sourceFile = this.program.getSourceFile(filePath);
    if (!sourceFile) {
      return;
    }

    // Visit each node in the AST
    ts.forEachChild(sourceFile, (node) => {
      this.visitNode(node, sourceFile, result, options);
    });
  }

  /**
   * Visit a TypeScript AST node
   */
  private visitNode(
    node: ts.Node,
    sourceFile: ts.SourceFile,
    result: ServiceDiscoveryResult,
    options: DiscoveryOptions
  ): void {
    if (!this.checker) return;

    // Check for service classes
    if (ts.isClassDeclaration(node) && node.name) {
      const className = node.name.text;

      // Check if it's a service
      if (className.endsWith('Service') || this.extendsService(node)) {
        const serviceInfo = this.extractServiceInfo(node, sourceFile, options);
        if (serviceInfo) {
          result.services.push(serviceInfo);
        }
      }
    }

    // Check for action exports
    if (ts.isVariableStatement(node)) {
      const declaration = node.declarationList.declarations[0];
      if (declaration && ts.isIdentifier(declaration.name)) {
        const name = declaration.name.text;

        // Check if it might be an action
        if (name.endsWith('Action') || name.includes('action')) {
          const actionInfo = this.extractActionInfo(declaration, sourceFile);
          if (actionInfo) {
            result.actions.push(actionInfo);
          }
        }

        // Check if it might be a provider
        if (name.endsWith('Provider') || name.includes('provider')) {
          const providerInfo = this.extractProviderInfo(declaration, sourceFile);
          if (providerInfo) {
            result.providers.push(providerInfo);
          }
        }
      }
    }

    // Recursively visit child nodes
    ts.forEachChild(node, (child) => {
      this.visitNode(child, sourceFile, result, options);
    });
  }

  /**
   * Check if a class extends Service
   */
  private extendsService(node: ts.ClassDeclaration): boolean {
    if (!node.heritageClauses) return false;

    for (const clause of node.heritageClauses) {
      if (clause.token === ts.SyntaxKind.ExtendsKeyword) {
        for (const type of clause.types) {
          if (ts.isIdentifier(type.expression)) {
            const name = type.expression.text;
            if (name === 'Service' || name.endsWith('Service')) {
              return true;
            }
          }
        }
      }
    }

    return false;
  }

  /**
   * Extract service information from a class declaration
   */
  private extractServiceInfo(
    node: ts.ClassDeclaration,
    sourceFile: ts.SourceFile,
    options: DiscoveryOptions
  ): ServiceInfo | null {
    if (!node.name || !this.checker) return null;

    const serviceInfo: ServiceInfo = {
      name: node.name.text,
      serviceType: '',
      sourceFile: sourceFile.fileName,
    };

    // Extract JSDoc comment
    const jsDoc = this.getJSDocComment(node);
    if (jsDoc) {
      serviceInfo.capabilityDescription = jsDoc;
    }

    // Extract methods
    node.members.forEach((member) => {
      if (ts.isMethodDeclaration(member) && member.name && ts.isIdentifier(member.name)) {
        const methodName = member.name.text;

        // Skip private methods unless requested
        if (!options.includePrivateMethods && this.isPrivate(member)) {
          return;
        }

        // Method extraction removed - not needed for new ServiceInfo structure
      }
    });

    // Set service type from static property
    const serviceTypeProp = node.members.find(
      (member) =>
        ts.isPropertyDeclaration(member) &&
        ts.isIdentifier(member.name) &&
        member.name.text === 'serviceType' &&
        member.modifiers?.some((mod) => mod.kind === ts.SyntaxKind.StaticKeyword)
    );

    if (
      serviceTypeProp &&
      ts.isPropertyDeclaration(serviceTypeProp) &&
      serviceTypeProp.initializer
    ) {
      if (ts.isStringLiteral(serviceTypeProp.initializer)) {
        serviceInfo.serviceType = serviceTypeProp.initializer.text;
      }
    }

    return serviceInfo;
  }

  /**
   * Extract method information
   */
  private extractMethodInfo(
    node: ts.MethodDeclaration,
    sourceFile: ts.SourceFile
  ): MethodInfo | null {
    if (!node.name || !ts.isIdentifier(node.name) || !this.checker) return null;

    const signature = this.checker.getSignatureFromDeclaration(node);
    if (!signature) return null;

    const methodInfo: MethodInfo = {
      name: node.name.text,
      signature: this.checker.signatureToString(signature),
      parameters: [],
      returnType: this.checker.typeToString(signature.getReturnType()),
    };

    // Extract JSDoc
    const jsDoc = this.getJSDocComment(node);
    if (jsDoc) {
      methodInfo.description = jsDoc;
    }

    // Extract parameters
    node.parameters.forEach((param) => {
      if (ts.isIdentifier(param.name)) {
        const paramType = param.type
          ? sourceFile.text.substring(param.type.pos, param.type.end).trim()
          : 'any';

        methodInfo.parameters.push({
          name: param.name.text,
          type: paramType,
          optional: !!param.questionToken,
        });
      }
    });

    return methodInfo;
  }

  /**
   * Extract action information
   */
  private extractActionInfo(
    node: ts.VariableDeclaration,
    sourceFile: ts.SourceFile
  ): ActionInfo | null {
    if (!node.initializer || !ts.isObjectLiteralExpression(node.initializer)) {
      return null;
    }

    const actionInfo: ActionInfo = {
      name: ts.isIdentifier(node.name) ? node.name.text : 'unknown',
      validateSignature: '',
      handlerSignature: '',
      sourceFile: sourceFile.fileName,
    };

    // Look for properties in the object literal
    node.initializer.properties.forEach((prop) => {
      if (ts.isPropertyAssignment(prop) && ts.isIdentifier(prop.name)) {
        const propName = prop.name.text;

        if (propName === 'name' && ts.isStringLiteral(prop.initializer)) {
          actionInfo.name = prop.initializer.text;
        } else if (propName === 'description' && ts.isStringLiteral(prop.initializer)) {
          actionInfo.description = prop.initializer.text;
        } else if (
          propName === 'validate' &&
          (ts.isFunctionExpression(prop.initializer) || ts.isArrowFunction(prop.initializer))
        ) {
          actionInfo.validateSignature = this.getFunctionSignature(prop.initializer, sourceFile);
        } else if (
          propName === 'handler' &&
          (ts.isFunctionExpression(prop.initializer) || ts.isArrowFunction(prop.initializer))
        ) {
          actionInfo.handlerSignature = this.getFunctionSignature(prop.initializer, sourceFile);
        }
      }
    });

    return actionInfo;
  }

  /**
   * Extract provider information
   */
  private extractProviderInfo(
    node: ts.VariableDeclaration,
    sourceFile: ts.SourceFile
  ): ProviderInfo | null {
    if (!node.initializer || !ts.isObjectLiteralExpression(node.initializer)) {
      return null;
    }

    const providerInfo: ProviderInfo = {
      name: ts.isIdentifier(node.name) ? node.name.text : 'unknown',
      getSignature: '',
      sourceFile: sourceFile.fileName,
    };

    // Look for properties in the object literal
    node.initializer.properties.forEach((prop) => {
      if (ts.isPropertyAssignment(prop) && ts.isIdentifier(prop.name)) {
        const propName = prop.name.text;

        if (propName === 'name' && ts.isStringLiteral(prop.initializer)) {
          providerInfo.name = prop.initializer.text;
        } else if (propName === 'description' && ts.isStringLiteral(prop.initializer)) {
          providerInfo.description = prop.initializer.text;
        } else if (
          propName === 'get' &&
          (ts.isFunctionExpression(prop.initializer) || ts.isArrowFunction(prop.initializer))
        ) {
          providerInfo.getSignature = this.getFunctionSignature(prop.initializer, sourceFile);
        }
      }
    });

    return providerInfo;
  }

  /**
   * Get function signature as string
   */
  private getFunctionSignature(
    node: ts.FunctionExpression | ts.ArrowFunction,
    sourceFile: ts.SourceFile
  ): string {
    const params = node.parameters
      .map((p) => {
        const name = ts.isIdentifier(p.name) ? p.name.text : 'param';
        const type = p.type ? sourceFile.text.substring(p.type.pos, p.type.end).trim() : 'any';
        return `${name}: ${type}`;
      })
      .join(', ');

    const returnType = node.type
      ? sourceFile.text.substring(node.type.pos, node.type.end).trim()
      : 'any';

    return `(${params}) => ${returnType}`;
  }

  /**
   * Check if a member is private
   */
  private isPrivate(member: ts.ClassElement): boolean {
    // Use TypeScript's getCombinedModifierFlags
    const modifiers = ts.getCombinedModifierFlags(member);
    return (modifiers & ts.ModifierFlags.Private) !== 0;
  }

  /**
   * Get JSDoc comment for a node
   */
  private getJSDocComment(node: ts.Node): string | null {
    const jsDocTags = ts.getJSDocTags(node);
    const comments = ts.getLeadingCommentRanges(node.getSourceFile().text, node.pos);

    if (comments && comments.length > 0) {
      const comment = comments[comments.length - 1];
      const text = node.getSourceFile().text.substring(comment.pos, comment.end);

      // Clean up the comment
      return text
        .replace(/^\/\*\*/, '')
        .replace(/\*\/$/, '')
        .split('\n')
        .map((line) => line.replace(/^\s*\*\s?/, ''))
        .join('\n')
        .trim();
    }

    return null;
  }

  /**
   * Generate TypeScript interface from service info
   */
  private generateInterface(service: ServiceInfo): string {
    // Method generation removed - not needed for new ServiceInfo structure
    return `interface ${service.name} {}`;
  }

  /**
   * Extract service usage examples from a plugin
   */
  async extractUsageExamples(pluginPath: string, serviceName: string): Promise<string[]> {
    const examples: string[] = [];

    try {
      // Look for test files
      const testPaths = [
        path.join(pluginPath, 'src', '__tests__'),
        path.join(pluginPath, 'tests'),
        path.join(pluginPath, 'test'),
      ];

      for (const testPath of testPaths) {
        if (await fs.pathExists(testPath)) {
          const testFiles = await this.findTypeScriptFiles(testPath);

          for (const file of testFiles) {
            const content = await fs.readFile(file, 'utf-8');

            // Look for usage of the service
            const serviceUsageRegex = new RegExp(`${serviceName}\\s*\\.\\s*(\\w+)\\s*\\(`, 'g');

            let match;
            while ((match = serviceUsageRegex.exec(content)) !== null) {
              const startIndex = Math.max(0, match.index - 100);
              const endIndex = Math.min(content.length, match.index + 200);
              const example = content.substring(startIndex, endIndex);

              if (!examples.some((e) => e.includes(example))) {
                examples.push(example);
              }
            }
          }
        }
      }
    } catch (error) {
      logger.error('[ServiceDiscovery] Error extracting examples:', error);
    }

    return examples;
  }

  /**
   * Scan a plugin directory to extract basic information
   */
  private async scanPluginDirectory(pluginPath: string): Promise<PluginSearchResult> {
    const result: PluginSearchResult = {
      name: path.basename(pluginPath),
      path: pluginPath,
      actions: [],
      providers: [],
      services: [],
      evaluators: [],
    };

    try {
      // Read package.json for name and description
      const packageJsonPath = path.join(pluginPath, 'package.json');
      if (await fs.pathExists(packageJsonPath)) {
        const packageJson = await fs.readJson(packageJsonPath);
        result.name = packageJson.name || result.name;
        result.description = packageJson.description;
      }

      // Quick scan of src directory for component types
      const srcPath = path.join(pluginPath, 'src');
      if (await fs.pathExists(srcPath)) {
        const files = await this.findTypeScriptFiles(srcPath);

        for (const file of files) {
          const content = await fs.readFile(file, 'utf-8');
          const fileName = path.basename(file);

          // Simple heuristic-based detection
          if (fileName.includes('action') || content.includes('Action = {')) {
            const match = content.match(/export\s+const\s+(\w+Action)/);
            if (match) result.actions.push(match[1]);
          }

          if (fileName.includes('provider') || content.includes('Provider = {')) {
            const match = content.match(/export\s+const\s+(\w+Provider)/);
            if (match) result.providers.push(match[1]);
          }

          if (fileName.includes('service') || content.includes('extends Service')) {
            const match = content.match(/export\s+class\s+(\w+Service)/);
            if (match) result.services.push(match[1]);
          }

          if (fileName.includes('evaluator') || content.includes('Evaluator = {')) {
            const match = content.match(/export\s+const\s+(\w+Evaluator)/);
            if (match) result.evaluators.push(match[1]);
          }
        }
      }
    } catch (error) {
      logger.error(`[ServiceDiscovery] Error scanning plugin ${pluginPath}:`, error);
    }

    return result;
  }

  private matchesSearchTerms(result: ServiceDiscoveryResult, searchTerms: string[]): boolean {
    return searchTerms.every(
      (term) =>
        result.services.some((service) =>
          service.name.toLowerCase().includes(term.toLowerCase())
        ) ||
        result.actions.some((action) => action.name.toLowerCase().includes(term.toLowerCase())) ||
        result.providers.some((provider) =>
          provider.name.toLowerCase().includes(term.toLowerCase())
        )
    );
  }
}
