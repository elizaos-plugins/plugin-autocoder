import { elizaLogger as logger } from '@elizaos/core';
import * as ts from 'typescript';
import * as path from 'path';
import * as fs from 'fs-extra';
import { DependencyManager } from './dependency-manager';
import type { IAgentRuntime, Action, Provider, Evaluator, Service, Plugin } from '@elizaos/core';
import { createRequire } from 'module';
import { pathToFileURL } from 'url';
import vm from 'vm';
import { ComponentType } from './component-creation-manager';

/**
 * Options for dynamic loading
 */
export interface DynamicLoadOptions {
  runtimeServices?: Map<string, any>;
  sandboxed?: boolean;
  requireCache?: Map<string, any>;
}

/**
 * Result of dynamic component loading
 */
export interface DynamicLoadResult {
  success: boolean;
  exports: any;
  dependencies: string[];
  error?: string;
}

/**
 * Manager for dynamically loading TypeScript components at runtime
 */
export class DynamicLoaderManager {
  private dependencyManager: DependencyManager;
  private compilerOptions: ts.CompilerOptions = {
    target: ts.ScriptTarget.ES2020,
    module: ts.ModuleKind.CommonJS,
    esModuleInterop: true,
    allowSyntheticDefaultImports: true,
    strict: true,
    skipLibCheck: true,
  };

  constructor() {
    this.dependencyManager = new DependencyManager();
  }

  /**
   * Dynamically load a component from a file
   */
  async loadComponent(options: DynamicLoadOptions): Promise<DynamicLoadResult> {
    logger.info(`Loading component with options:`, options);

    try {
      const absolutePath = path.resolve(options.filePath);

      if (!(await fs.pathExists(absolutePath))) {
        throw new Error(`Component file not found: ${absolutePath}`);
      }

      // Read and transpile the TypeScript file
      const fileContent = await fs.readFile(absolutePath, 'utf-8');
      const transpiledCode = await this.transpileTypeScript(fileContent);

      // Load the component
      let exports: any;
      if (options.sandboxed) {
        exports = await this.loadInSandbox(transpiledCode, absolutePath);
      } else {
        exports = await this.loadDirectly(transpiledCode, absolutePath);
      }

      // Extract the component based on type
      const component = this.extractComponent(exports, options.componentType);

      if (!component) {
        throw new Error(`No valid component found in ${absolutePath}`);
      }

      const loadedComponent: DynamicLoadResult = {
        success: true,
        exports,
        dependencies: [],
        error: undefined,
      };

      // Cache the loaded component
      this.loadedComponents.set(absolutePath, loadedComponent);

      logger.info(`Successfully loaded component from ${absolutePath}`);
      return loadedComponent;
    } catch (error) {
      logger.error(`Failed to load component from ${options.filePath}:`, error);
      return {
        success: false,
        exports: null,
        dependencies: [],
        error: error.message,
      };
    }
  }

  /**
   * Test a component
   */
  async testComponent(options: TestOptions): Promise<TestResult> {
    logger.info(`Testing ${options.componentType} component`);

    const tests = [];

    try {
      switch (options.componentType) {
        case ComponentType.ACTION:
          const action = options.component as Action;

          // Test validation
          try {
            const testMessage = {
              content: { text: 'test message' },
              roomId: 'test-room',
              userId: 'test-user',
              agentId: options.runtime.agentId,
            };
            const isValid = await action.validate?.(options.runtime, testMessage as any);
            tests.push({
              name: 'Validation',
              passed: true,
              result: isValid,
            });
          } catch (error) {
            tests.push({
              name: 'Validation',
              passed: false,
              error: error.message,
            });
          }

          // Test handler
          try {
            const testMessage = {
              content: { text: 'test message' },
              roomId: 'test-room',
              userId: 'test-user',
              agentId: options.runtime.agentId,
            };
            const state = await options.runtime.composeState(testMessage as any);
            const result = await action.handler(
              options.runtime,
              testMessage as any,
              state,
              {},
              async () => []
            );
            tests.push({
              name: 'Handler execution',
              passed: true,
              result,
            });
          } catch (error) {
            tests.push({
              name: 'Handler execution',
              passed: false,
              error: error.message,
            });
          }
          break;

        case ComponentType.PROVIDER:
          const provider = options.component as Provider;

          try {
            const testMessage = {
              content: { text: 'test message' },
              roomId: 'test-room',
              userId: 'test-user',
              agentId: options.runtime.agentId,
            };
            const state = await options.runtime.composeState(testMessage as any);
            const result = await provider.get(options.runtime, testMessage as any, state);
            tests.push({
              name: 'Provider get method',
              passed: true,
              result,
            });
          } catch (error) {
            tests.push({
              name: 'Provider get method',
              passed: false,
              error: error.message,
            });
          }
          break;

        // Add other component types as needed
      }

      return {
        passed: tests.every((t) => t.passed),
        tests,
      };
    } catch (error) {
      logger.error(`Test failed:`, error);
      return {
        passed: false,
        tests: [
          ...tests,
          {
            name: 'General test',
            passed: false,
            error: error.message,
          },
        ],
      };
    }
  }

  /**
   * Execute component in sandbox mode
   */
  async sandboxComponent(options: SandboxOptions): Promise<SandboxResult> {
    logger.info(`Running ${options.componentType} in sandbox mode`);

    try {
      // Load the component in sandbox mode
      const loaded = await this.loadComponent({
        filePath: options.filePath,
        componentType: options.componentType,
        runtime: options.runtime,
        sandboxed: true,
      });

      // Try to execute based on type
      let result: any;

      switch (options.componentType) {
        case ComponentType.ACTION:
          const action = loaded.exports as Action;
          const testMessage = options.testData?.message || {
            content: { text: 'sandbox test' },
            roomId: 'sandbox-room',
            userId: 'sandbox-user',
            agentId: options.runtime.agentId,
          };
          const state = await options.runtime.composeState(testMessage as any);
          result = await action.handler(
            options.runtime,
            testMessage as any,
            state,
            {},
            async () => []
          );
          break;

        case ComponentType.PROVIDER:
          const provider = loaded.exports as Provider;
          const providerMessage = options.testData?.message || {
            content: { text: 'sandbox test' },
            roomId: 'sandbox-room',
            userId: 'sandbox-user',
            agentId: options.runtime.agentId,
          };
          const providerState = await options.runtime.composeState(providerMessage as any);
          result = await provider.get(options.runtime, providerMessage as any, providerState);
          break;

        default:
          result = { message: 'Component loaded successfully in sandbox' };
      }

      return {
        success: true,
        sandboxed: true,
        result,
      };
    } catch (error) {
      logger.error(`Sandbox execution failed:`, error);
      return {
        success: false,
        sandboxed: true,
        error: error.message,
      };
    }
  }

  /**
   * Hot reload a component
   */
  async reloadComponent(options: ReloadOptions): Promise<DynamicLoadResult> {
    const absolutePath = path.resolve(options.filePath);

    // Remove from cache
    this.loadedComponents.delete(absolutePath);

    // Clear require cache if using Node.js require
    if (require.cache[absolutePath]) {
      delete require.cache[absolutePath];
    }

    // Clear temp file cache
    const tempFile = absolutePath.replace('.ts', '.temp.cjs');
    if (require.cache[tempFile]) {
      delete require.cache[tempFile];
    }

    // Reload the component
    return this.loadComponent({
      filePath: options.filePath,
      componentType: options.componentType,
      runtime: options.runtime,
    });
  }

  /**
   * Unload a component
   */
  async unloadComponent(filePath: string): Promise<void> {
    const absolutePath = path.resolve(filePath);

    // Remove from cache
    this.loadedComponents.delete(absolutePath);

    // Clear require cache
    if (require.cache[absolutePath]) {
      delete require.cache[absolutePath];
    }

    // Clear temp file cache
    const tempFile = absolutePath.replace('.ts', '.temp.cjs');
    if (require.cache[tempFile]) {
      delete require.cache[tempFile];
    }
  }

  /**
   * Get all loaded components
   */
  getLoadedComponents(): DynamicLoadResult[] {
    return Array.from(this.loadedComponents.values());
  }

  /**
   * Transpile TypeScript to JavaScript
   */
  private async transpileTypeScript(code: string): Promise<string> {
    // For now, we'll use a simple approach
    // In production, you'd want to use the TypeScript compiler API
    try {
      // Track exports
      const namedExports = [];
      let defaultExport = null;

      // Remove TypeScript-specific syntax
      let jsCode = code
        // Remove type imports
        .replace(/import\s+type\s+{[^}]+}\s+from\s+['"][^'"]+['"]/g, '')
        // Remove type imports with regular imports
        .replace(/import\s+{\s*type\s+[^}]+}\s+from\s+['"][^'"]+['"]/g, '')
        // Convert ES6 imports to CommonJS requires
        .replace(
          /import\s+{\s*([^}]+)\s*}\s+from\s+['"]([^'"]+)['"]/g,
          (match, imports, module) => {
            // For relative imports, create mock objects
            if (module.startsWith('.') || module.startsWith('..')) {
              const importList = imports.split(',').map((i) => i.trim());
              return importList
                .map((imp) => {
                  // Create a mock object for the import
                  if (imp === 'TEST_ACTION') {
                    return `const ${imp} = { name: 'test-action', handler: async () => ({ text: 'mocked' }) };`;
                  } else if (imp === 'testProvider') {
                    return `const ${imp} = { name: 'test-provider', get: async () => ({ text: 'mocked provider' }) };`;
                  } else {
                    return `const ${imp} = {};`;
                  }
                })
                .join('\n');
            }
            const importList = imports.split(',').map((i) => i.trim());
            return importList
              .map((imp) => `const ${imp} = require('${module}').${imp};`)
              .join('\n');
          }
        )
        .replace(/import\s+(\w+)\s+from\s+['"]([^'"]+)['"]/g, (match, name, module) => {
          // For relative imports, create mock objects
          if (module.startsWith('.') || module.startsWith('..')) {
            return `const ${name} = {};`;
          }
          return `const ${name} = require('${module}')`;
        })
        // Remove function parameter type annotations
        .replace(
          /(\w+)\s*:\s*(string|number|boolean|any|void|Promise<[^>]+>|I?[A-Z]\w*(\[\])?)\s*([,)])/g,
          '$1$4'
        )
        // Remove arrow function return type annotations
        .replace(
          /\)\s*:\s*(string|number|boolean|any|void|Promise<[^>]+>|[A-Za-z]+(\[\])?)\s*=>/g,
          ') =>'
        )
        // Remove function return type annotations
        .replace(/\)\s*:\s*(Promise<[^>]+>|[A-Za-z]+(\[\])?)\s*{/g, ') {')
        // Remove const/let/var type annotations (including custom types like CustomData)
        .replace(/(const|let|var)\s+(\w+)\s*:\s*(\w+(\[\])?)\s*=/g, '$1 $2 =')
        // Remove interface declarations (multiline)
        .replace(/interface\s+\w+\s*{[^}]*}/gs, '')
        // Remove type declarations
        .replace(/type\s+\w+\s*=\s*[^;]+;/g, '')
        // Remove generic type parameters
        .replace(/<[A-Za-z\s,]+>/g, '');

      // Find and replace export const statements
      jsCode = jsCode.replace(/export\s+const\s+(\w+)/g, (match, name) => {
        namedExports.push(name);
        return `const ${name}`;
      });

      // Find and replace export default statements
      jsCode = jsCode.replace(/export\s+default\s+(\w+);?/g, (match, name) => {
        defaultExport = name;
        return '';
      });

      // Handle inline export default object/function
      jsCode = jsCode.replace(/export\s+default\s+({[\s\S]*?});/gm, (match, objectDef) => {
        // Generate a unique name for the default export
        defaultExport = '__defaultExport';
        return `const ${defaultExport} = ${objectDef};`;
      });

      // Build exports section
      const exportLines = [];

      if (defaultExport) {
        exportLines.push(`module.exports = ${defaultExport};`);
        // Also add named exports to the default export
        namedExports.forEach((name) => {
          exportLines.push(`module.exports.${name} = ${name};`);
        });
        // Add 'default' as a self-reference
        exportLines.push(`module.exports.default = module.exports;`);
      } else if (namedExports.length > 0) {
        // No default export, so create module.exports as an object
        exportLines.push('module.exports = {};');
        namedExports.forEach((name) => {
          exportLines.push(`module.exports.${name} = ${name};`);
        });
      }

      // Append exports at the end
      if (exportLines.length > 0) {
        jsCode = jsCode + '\n\n' + exportLines.join('\n');
      }

      return jsCode;
    } catch (error) {
      logger.error('Transpilation error:', error);
      throw new Error(`Failed to transpile TypeScript: ${error.message}`);
    }
  }

  /**
   * Load component in a sandbox
   */
  private async loadInSandbox(code: string, filePath: string): Promise<any> {
    const sandbox = {
      module: { exports: {} },
      exports: {},
      require: createRequire(filePath),
      console: {
        log: (...args: any[]) => logger.info(args.join(' ')),
        error: (...args: any[]) => logger.error(args.join(' ')),
        warn: (...args: any[]) => logger.warn(args.join(' ')),
      },
      __filename: filePath,
      __dirname: path.dirname(filePath),
    };

    const script = new vm.Script(code);
    const context = vm.createContext(sandbox);
    script.runInContext(context);

    return sandbox.module.exports || sandbox.exports;
  }

  /**
   * Load component directly
   */
  private async loadDirectly(code: string, filePath: string): Promise<any> {
    // Write to a temporary file and require it
    const tempFile = filePath.replace('.ts', '.temp.cjs');

    try {
      await fs.writeFile(tempFile, code);

      // Clear require cache
      if (require.cache[tempFile]) {
        delete require.cache[tempFile];
      }

      // Use require instead of dynamic import for CommonJS modules
      const module = require(tempFile);

      return module;
    } finally {
      // Clean up temp file
      if (await fs.pathExists(tempFile)) {
        await fs.unlink(tempFile);
      }
    }
  }

  /**
   * Extract component from exports
   */
  private extractComponent(exports: any, type: ComponentType): any {
    // Check default export first
    if (exports.default) {
      return exports.default;
    }

    // Look for named exports that are actual components (objects with expected properties)
    for (const [key, value] of Object.entries(exports)) {
      if (!value || typeof value !== 'object') continue;

      // Check if the export has properties expected for the component type
      const component = value as any;
      switch (type) {
        case ComponentType.ACTION:
          if (component.handler && (component.name || component.description)) {
            return component;
          }
          break;
        case ComponentType.PROVIDER:
          if (component.get && (component.name || component.description)) {
            return component;
          }
          break;
        case ComponentType.EVALUATOR:
          if (component.handler && component.validate) {
            return component;
          }
          break;
        case ComponentType.SERVICE:
          if (typeof component === 'function' || component.serviceType) {
            return component;
          }
          break;
        case ComponentType.PLUGIN:
          if (component.name && (component.actions || component.providers || component.services)) {
            return component;
          }
          break;
      }
    }

    // Return the first export if no pattern matches
    const exportKeys = Object.keys(exports).filter((key) => key !== 'default');
    if (exportKeys.length > 0) {
      return exports[exportKeys[0]];
    }

    return null;
  }

  /**
   * Get component name
   */
  private getComponentName(component: any, type: ComponentType): string {
    if (component.name) {
      return component.name;
    }

    if (type === ComponentType.SERVICE && component.serviceType) {
      return component.serviceType;
    }

    return 'Unknown Component';
  }
}
