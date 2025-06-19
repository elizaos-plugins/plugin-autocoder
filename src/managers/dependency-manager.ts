import { elizaLogger as logger } from '@elizaos/core';
import * as ts from 'typescript';
import * as path from 'path';
import * as fs from 'fs-extra';
import {
  ServiceDiscoveryManager,
  type ServiceDiscoveryResult,
  type ServiceInfo,
} from './service-discovery-manager';

/**
 * Represents a plugin dependency
 */
export interface PluginDependency {
  name: string;
  version?: string;
  services: string[];
  reason: string;
  optional?: boolean;
}

/**
 * Service interface information
 */
export interface ServiceInterface {
  name: string;
  methods: string[];
  interface: string;
  examples?: string[];
}

/**
 * Dependency manifest for a plugin
 */
export interface DependencyManifest {
  required: PluginDependency[];
  optional: PluginDependency[];
  serviceInterfaces: Map<string, ServiceInterface>;
  typeImports: string[];
}

/**
 * Context for code generation
 */
export interface GenerationContext {
  dependencies: DependencyManifest;
  serviceUsageExamples: Map<string, string[]>;
  bestPractices: string[];
  warnings: string[];
}

/**
 * Options for dependency analysis
 */
export interface DependencyAnalysisOptions {
  includeOptional?: boolean;
  maxDepth?: number;
  excludePlugins?: string[];
}

/**
 * A dependency declaration with its usage context
 */
export interface DependencyInfo {
  moduleName: string;
  importPath: string;
  namedImports?: string[];
  defaultImport?: string;
  isTypeOnly?: boolean;
  usageLocations: UsageLocation[];
}

/**
 * Location where a dependency is used
 */
export interface UsageLocation {
  file: string;
  line: number;
  column: number;
  usage: string;
}

/**
 * Result of dependency analysis
 */
export interface DependencyAnalysisResult {
  dependencies: DependencyInfo[];
  packageJsonDeps?: Record<string, string>;
  missingDependencies?: string[];
  errors?: string[];
}

/**
 * Manages dependency analysis and resolution for ElizaOS plugins
 */
export class DependencyManager {
  private program: ts.Program | null = null;
  private checker: ts.TypeChecker | null = null;
  private serviceDiscovery: ServiceDiscoveryManager;
  private dependencyCache: Map<string, DependencyManifest> = new Map();

  constructor() {
    this.serviceDiscovery = new ServiceDiscoveryManager();
  }

  /**
   * Analyze dependencies based on requirements
   */
  async analyzeDependencies(
    requirements: string[],
    existingPlugins: string[],
    options: DependencyAnalysisOptions = {}
  ): Promise<DependencyManifest> {
    logger.info('[DependencyManager] Analyzing dependencies for requirements:', requirements);

    const manifest: DependencyManifest = {
      required: [],
      optional: [],
      serviceInterfaces: new Map(),
      typeImports: [],
    };

    // Search for relevant plugins
    const relevantPlugins = await this.findRelevantPlugins(requirements, existingPlugins);

    // Analyze each plugin
    for (const plugin of relevantPlugins) {
      if (options.excludePlugins?.includes(plugin.name)) {
        continue;
      }

      const dependency = await this.analyzePlugin(plugin, requirements);
      if (dependency) {
        if (dependency.optional) {
          manifest.optional.push(dependency);
        } else {
          manifest.required.push(dependency);
        }

        // Extract service interfaces
        await this.extractServiceInterfaces(plugin, manifest);
      }
    }

    // Resolve transitive dependencies
    if (options.maxDepth && options.maxDepth > 1) {
      await this.resolveTransitiveDependencies(manifest, options);
    }

    // Generate type imports
    manifest.typeImports = this.generateTypeImports(manifest);

    return manifest;
  }

  /**
   * Find plugins relevant to the requirements
   */
  private async findRelevantPlugins(
    requirements: string[],
    existingPlugins: string[]
  ): Promise<Array<{ name: string; path?: string; relevance: number }>> {
    const plugins: Array<{ name: string; path?: string; relevance: number }> = [];
    const seen = new Set<string>();

    // Search for each requirement
    for (const requirement of requirements) {
      const discoveryResult = await this.serviceDiscovery.discoverServices([requirement]);

      // Process plugins from discovery
      for (const plugin of discoveryResult.plugins) {
        if (!seen.has(plugin.name) && !existingPlugins.includes(plugin.name)) {
          seen.add(plugin.name);

          // Calculate relevance score
          const relevance = this.calculateRelevance(requirement, plugin);

          plugins.push({
            name: plugin.name,
            path: plugin.path,
            relevance,
          });
        }
      }
    }

    // Sort by relevance
    return plugins.sort((a, b) => b.relevance - a.relevance);
  }

  /**
   * Calculate relevance score for a plugin
   */
  private calculateRelevance(requirement: string, plugin: any): number {
    let score = 0;
    const reqLower = requirement.toLowerCase();

    // Name match
    if (plugin.name.toLowerCase().includes(reqLower)) {
      score += 10;
    }

    // Description match
    if (plugin.description?.toLowerCase().includes(reqLower)) {
      score += 5;
    }

    // Tag match
    if (plugin.tags?.some((tag: string) => tag.toLowerCase().includes(reqLower))) {
      score += 7;
    }

    // Relevant section match
    if (plugin.relevantSection?.toLowerCase().includes(reqLower)) {
      score += 3;
    }

    return score;
  }

  /**
   * Analyze a plugin to determine if it should be a dependency
   */
  private async analyzePlugin(
    plugin: { name: string; path?: string },
    requirements: string[]
  ): Promise<PluginDependency | null> {
    try {
      // If we have a local path, analyze it
      if (plugin.path) {
        const analysis = await this.serviceDiscovery.analyzePlugin(plugin.path);

        // Check if the plugin provides useful services
        const usefulServices = this.findUsefulServices(analysis, requirements);

        if (usefulServices.length > 0) {
          return {
            name: plugin.name,
            services: usefulServices.map((s) => s.name),
            reason: `Provides ${usefulServices.map((s) => s.name).join(', ')} services`,
            optional: usefulServices.length < 2, // Optional if only provides one service
          };
        }
      } else {
        // For registry plugins without local path, make a best guess
        return {
          name: plugin.name,
          services: [],
          reason: 'May provide useful functionality based on description',
          optional: true,
        };
      }
    } catch (error) {
      logger.error(`[DependencyManager] Error analyzing plugin ${plugin.name}:`, error);
    }

    return null;
  }

  /**
   * Find services that might be useful for the requirements
   */
  private findUsefulServices(
    analysis: ServiceDiscoveryResult,
    requirements: string[]
  ): ServiceInfo[] {
    const useful: ServiceInfo[] = [];

    for (const service of analysis.services) {
      for (const req of requirements) {
        // Split requirement into words for better matching
        const reqWords = req.toLowerCase().split(/\s+/);

        // Check if any word in the requirement matches the service
        const matchesService = reqWords.some((word) => {
          // Check service name
          if (service.name.toLowerCase().includes(word)) {
            return true;
          }

          // Check service type/capability
          if (service.capabilityDescription?.toLowerCase().includes(word)) {
            return true;
          }

          return false;
        });

        if (matchesService) {
          useful.push(service);
          break;
        }
      }
    }

    return useful;
  }

  /**
   * Extract service interfaces from a plugin
   */
  private async extractServiceInterfaces(
    plugin: { name: string; path?: string },
    manifest: DependencyManifest
  ): Promise<void> {
    if (!plugin.path) return;

    try {
      const analysis = await this.serviceDiscovery.analyzePlugin(plugin.path);

      for (const service of analysis.services) {
        const serviceInterface: ServiceInterface = {
          name: service.name,
          methods: [], // ServiceInfo doesn't have methods, so we leave it empty
          interface: `interface ${service.name} extends Service`, // Generate a basic interface
        };

        // Try to get usage examples
        const examples = await this.serviceDiscovery.extractUsageExamples(
          plugin.path,
          service.name
        );

        if (examples.length > 0) {
          serviceInterface.examples = examples;
        }

        manifest.serviceInterfaces.set(service.name, serviceInterface);
      }
    } catch (error) {
      logger.error(`[DependencyManager] Error extracting interfaces from ${plugin.name}:`, error);
    }
  }

  /**
   * Resolve transitive dependencies
   */
  private async resolveTransitiveDependencies(
    manifest: DependencyManifest,
    options: DependencyAnalysisOptions
  ): Promise<void> {
    const processed = new Set<string>();
    const toProcess = [...manifest.required.map((d) => d.name)];

    while (toProcess.length > 0 && processed.size < (options.maxDepth || 10)) {
      const pluginName = toProcess.shift();
      if (!pluginName || processed.has(pluginName)) continue;

      processed.add(pluginName);

      // TODO: Analyze the plugin's dependencies and add them
      // This would require fetching the plugin's package.json
    }
  }

  /**
   * Generate TypeScript type imports
   */
  private generateTypeImports(manifest: DependencyManifest): string[] {
    const imports: string[] = [];

    // Import types from all dependencies (both required and optional)
    const allDeps = [...manifest.required, ...manifest.optional];

    for (const dep of allDeps) {
      if (dep.services.length > 0) {
        imports.push(`import type { ${dep.services.join(', ')} } from '${dep.name}';`);
      }
    }

    // Remove duplicates
    return [...new Set(imports)];
  }

  /**
   * Generate context for AI code generation
   */
  async generateContext(
    manifest: DependencyManifest,
    projectDescription: string
  ): Promise<GenerationContext> {
    const context: GenerationContext = {
      dependencies: manifest,
      serviceUsageExamples: new Map(),
      bestPractices: [],
      warnings: [],
    };

    // Add service usage examples
    for (const [serviceName, serviceInterface] of manifest.serviceInterfaces) {
      if (serviceInterface.examples) {
        context.serviceUsageExamples.set(serviceName, serviceInterface.examples);
      }
    }

    // Add best practices
    context.bestPractices.push(
      'Always use runtime.getService() to access services',
      'Check if services exist before using them',
      'Handle service initialization errors gracefully',
      'Use TypeScript types for better type safety',
      'Follow the ElizaOS plugin architecture patterns'
    );

    // Add warnings for common issues
    if (manifest.required.length > 5) {
      context.warnings.push('High number of dependencies may increase complexity');
    }

    if (manifest.optional.length > manifest.required.length) {
      context.warnings.push('Consider if all optional dependencies are necessary');
    }

    // Check for circular dependencies
    const circularDeps = this.detectCircularDependencies(manifest);
    if (circularDeps.length > 0) {
      context.warnings.push(`Potential circular dependencies detected: ${circularDeps.join(', ')}`);
    }

    return context;
  }

  /**
   * Detect potential circular dependencies
   */
  private detectCircularDependencies(manifest: DependencyManifest): string[] {
    const circular: string[] = [];

    // Simple check - in a real implementation, this would be more sophisticated
    const allDeps = [...manifest.required, ...manifest.optional];
    const depNames = new Set(allDeps.map((d) => d.name));

    // Check if any dependency might depend back on us
    // This is a placeholder - real implementation would analyze actual dependencies

    return circular;
  }

  /**
   * Build a dependency graph
   */
  buildDependencyGraph(manifest: DependencyManifest): Map<string, string[]> {
    const graph = new Map<string, string[]>();

    // Add all dependencies to the graph
    for (const dep of [...manifest.required, ...manifest.optional]) {
      if (!graph.has(dep.name)) {
        graph.set(dep.name, []);
      }

      // Add services as "dependencies" for visualization
      for (const service of dep.services) {
        const edges = graph.get(dep.name) || [];
        edges.push(`service:${service}`);
        graph.set(dep.name, edges);
      }
    }

    return graph;
  }

  /**
   * Validate dependencies
   */
  async validateDependencies(manifest: DependencyManifest): Promise<{
    valid: boolean;
    errors: string[];
    warnings: string[];
  }> {
    const result = {
      valid: true,
      errors: [] as string[],
      warnings: [] as string[],
    };

    // Check for missing required dependencies
    for (const dep of manifest.required) {
      if (dep.services.length === 0) {
        result.warnings.push(`Dependency ${dep.name} provides no services`);
      }
    }

    // Check for duplicate services
    const serviceProviders = new Map<string, string[]>();
    for (const dep of [...manifest.required, ...manifest.optional]) {
      for (const service of dep.services) {
        const providers = serviceProviders.get(service) || [];
        providers.push(dep.name);
        serviceProviders.set(service, providers);
      }
    }

    for (const [service, providers] of serviceProviders) {
      if (providers.length > 1) {
        result.warnings.push(
          `Service ${service} is provided by multiple plugins: ${providers.join(', ')}`
        );
      }
    }

    // Check for version conflicts (placeholder)
    // In a real implementation, this would check actual version compatibility

    if (result.errors.length > 0) {
      result.valid = false;
    }

    return result;
  }
}
