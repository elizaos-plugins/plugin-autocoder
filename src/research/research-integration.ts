import { elizaLogger, type IAgentRuntime, Service } from '@elizaos/core';

// Define types locally instead of importing from non-existent plugin
export interface ResearchProject {
  id: string;
  query: string;
  status: ResearchStatus;
  findings: ResearchProjectFinding[];
  sources: ResearchSource[];
  report?: {
    summary: string;
    sections: Array<{
      title: string;
      content: string;
    }>;
  };
  error?: string;
  createdAt: number;
  updatedAt: number;
}

export interface ResearchProjectFinding {
  content: string;
  source?: ResearchSource | string;
  confidence?: number;
  relevance?: number;
}

export interface ResearchSource {
  title: string;
  url?: string;
  content?: string;
  metadata?: Record<string, any>;
}

// ResearchService is a service, not just an interface
export class ResearchService extends Service {
  static serviceName = 'research';
  capabilityDescription = 'Research service for finding information';
  
  async createResearchProject(query: string, options: ResearchOptions): Promise<ResearchProject> {
    throw new Error('Method not implemented');
  }
  
  async getProject(projectId: string): Promise<ResearchProject | null> {
    throw new Error('Method not implemented');
  }
  
  async stop(): Promise<void> {
    // Clean up resources
  }
}

export interface ResearchOptions {
  domain?: ResearchDomain;
  researchDepth?: ResearchDepth;
  maxSearchResults?: number;
  timeout?: number;
  enableCitations?: boolean;
  searchProviders?: string[];
}

export enum ResearchDepth {
  SURFACE = 'surface',
  MODERATE = 'moderate',
  DEEP = 'deep',
}

export enum ResearchDomain {
  COMPUTER_SCIENCE = 'computer_science',
  ENGINEERING = 'engineering',
  ART_DESIGN = 'art_design',
  GENERAL = 'general',
}

export enum ResearchStatus {
  PENDING = 'pending',
  IN_PROGRESS = 'in_progress',
  COMPLETED = 'completed',
  FAILED = 'failed',
}

import type { SWEBenchInstance } from '../swe-bench/types';

/**
 * Research context for SWE-bench tasks
 */
export interface ResearchContext {
  issue: SWEBenchInstance;
  researchProject?: ResearchProject;
  findings: ResearchFinding[];
  implementationGuidance: ImplementationGuidance;
  riskAssessment: RiskAssessment;
}

export interface ResearchFinding {
  type: 'solution_pattern' | 'similar_issue' | 'best_practice' | 'pitfall' | 'library_insight';
  content: string;
  source: string;
  confidence: number;
  relevance: number;
}

export interface ImplementationGuidance {
  approach: string;
  keyConsiderations: string[];
  testingStrategy: string;
  performanceConsiderations: string[];
  securityConsiderations: string[];
  codePatterns: CodePattern[];
}

export interface CodePattern {
  pattern: string;
  description: string;
  example: string;
  whenToUse: string;
  alternatives: string[];
}

export interface RiskAssessment {
  complexity: 'low' | 'medium' | 'high';
  breakingChanges: boolean;
  performanceImpact: 'none' | 'low' | 'medium' | 'high';
  securityImpact: 'none' | 'low' | 'medium' | 'high';
  risks: Risk[];
  mitigations: string[];
}

export interface Risk {
  type: 'technical' | 'security' | 'performance' | 'compatibility';
  description: string;
  probability: number;
  impact: number;
  mitigation: string;
}

/**
 * Research-driven SWE-bench integration
 */
export class ResearchIntegration {
  private researchService: ResearchService | null = null;

  constructor(private runtime: IAgentRuntime) {
    this.researchService = this.runtime.getService<ResearchService>('research');
  }

  /**
   * Research an issue before attempting to solve it
   */
  async researchIssue(instance: SWEBenchInstance): Promise<ResearchContext> {
    elizaLogger.info(`[RESEARCH] Starting research for issue: ${instance.instance_id}`);

    if (!this.researchService) {
      elizaLogger.debug('[RESEARCH] Research service not available, using enhanced static analysis');
      return this.createBasicContext(instance);
    }

    try {
      // Create research query from the issue
      const researchQuery = this.createResearchQuery(instance);
      elizaLogger.info(`[RESEARCH] Query: ${researchQuery}`);

      // Determine research parameters
      const domain = this.extractDomain(instance);
      const depth = this.extractDepth(instance);
      
      // Start research project
      const project = await this.researchService.createResearchProject(researchQuery, {
        domain,
        researchDepth: depth,
        maxSearchResults: 20,
        timeout: 120000, // 2 minutes for focused research
        enableCitations: true,
        searchProviders: ['web', 'academic'],
      });

      // Wait for research to complete (with timeout)
      const completedProject = await this.waitForResearchCompletion(project.id, 180000); // 3 minutes

      // Extract findings and create context
      const context = await this.createResearchContext(instance, completedProject);
      
      elizaLogger.info(`[RESEARCH] Research completed with ${context.findings.length} findings`);
      return context;

    } catch (error) {
      elizaLogger.error('[RESEARCH] Research failed, falling back to basic analysis:', error);
      return this.createBasicContext(instance);
    }
  }

  /**
   * Research specific aspect of an issue (for refinement)
   */
  async researchAspect(
    instance: SWEBenchInstance, 
    aspect: string,
    context?: ResearchContext
  ): Promise<ResearchFinding[]> {
    if (!this.researchService) {
      return [];
    }

    try {
      const aspectQuery = `${instance.issue_title}: ${aspect} - ${instance.problem_statement || ''}`;
      
      const project = await this.researchService.createResearchProject(aspectQuery, {
        domain: this.extractDomain(instance),
        researchDepth: ResearchDepth.MODERATE,
        maxSearchResults: 10,
        timeout: 60000, // 1 minute for aspect research
      });

      const completedProject = await this.waitForResearchCompletion(project.id, 90000);
      return this.extractFindings(completedProject, 'solution_pattern');

    } catch (error) {
      elizaLogger.error(`[RESEARCH] Aspect research failed for ${aspect}:`, error);
      return [];
    }
  }

  /**
   * Research best practices for plugin development
   */
  async researchPluginDevelopment(
    pluginType: string,
    requirements: string[]
  ): Promise<ImplementationGuidance> {
    elizaLogger.info(`[RESEARCH] Researching ${pluginType} plugin development`);

    if (!this.researchService) {
      return this.createBasicGuidance(pluginType, requirements);
    }

    try {
      const query = `ElizaOS ${pluginType} plugin development best practices architecture patterns ${requirements.join(' ')}`;
      
      const project = await this.researchService.createResearchProject(query, {
        domain: ResearchDomain.COMPUTER_SCIENCE,
        researchDepth: ResearchDepth.DEEP,
        maxSearchResults: 25,
        timeout: 180000, // 3 minutes for plugin research
        searchProviders: ['web', 'academic'],
      });

      const completedProject = await this.waitForResearchCompletion(project.id, 240000);
      return this.extractImplementationGuidance(completedProject, pluginType, requirements);

    } catch (error) {
      elizaLogger.error('[RESEARCH] Plugin research failed:', error);
      return this.createBasicGuidance(pluginType, requirements);
    }
  }

  /**
   * Create a research query from SWE-bench instance
   */
  private createResearchQuery(instance: SWEBenchInstance): string {
    const language = this.extractLanguage(instance);
    const framework = this.extractFramework(instance);
    
    let query = `${instance.issue_title} ${language}`;
    
    if (framework) {
      query += ` ${framework}`;
    }
    
    if (instance.problem_statement) {
      query += ` ${instance.problem_statement}`;
    }
    
    // Add context clues for better research
    query += ' solution implementation best practices';
    
    if (instance.hints && instance.hints.length > 0) {
      query += ` ${instance.hints.slice(0, 3).join(' ')}`;
    }

    return query.trim();
  }

  /**
   * Extract research domain from issue
   */
  private extractDomain(instance: SWEBenchInstance): ResearchDomain {
    const text = `${instance.issue_title} ${instance.issue_body || ''}`.toLowerCase();
    
    if (text.includes('security') || text.includes('vulnerability')) {
      return ResearchDomain.COMPUTER_SCIENCE;
    }
    if (text.includes('performance') || text.includes('optimization')) {
      return ResearchDomain.ENGINEERING;
    }
    if (text.includes('database') || text.includes('sql')) {
      return ResearchDomain.COMPUTER_SCIENCE;
    }
    if (text.includes('ui') || text.includes('frontend')) {
      return ResearchDomain.ART_DESIGN;
    }
    if (text.includes('api') || text.includes('backend')) {
      return ResearchDomain.COMPUTER_SCIENCE;
    }
    
    return ResearchDomain.COMPUTER_SCIENCE; // Default for software issues
  }

  /**
   * Extract research depth based on issue complexity
   */
  private extractDepth(instance: SWEBenchInstance): ResearchDepth {
    const issueLength = (instance.issue_body || '').length;
    const hasHints = instance.hints && instance.hints.length > 0;
    const problemComplexity = (instance.problem_statement || '').length;

    // Simple heuristics for depth
    if (issueLength < 200 && hasHints) {
      return ResearchDepth.SURFACE;
    }
    if (issueLength > 800 || problemComplexity > 300) {
      return ResearchDepth.DEEP;
    }
    
    return ResearchDepth.MODERATE;
  }

  /**
   * Wait for research project to complete
   */
  private async waitForResearchCompletion(
    projectId: string, 
    timeoutMs: number
  ): Promise<ResearchProject> {
    const startTime = Date.now();
    const pollInterval = 5000; // Check every 5 seconds

    while (Date.now() - startTime < timeoutMs) {
      const project = await this.researchService!.getProject(projectId);
      
      if (!project) {
        throw new Error(`Research project ${projectId} not found`);
      }

      if (project.status === ResearchStatus.COMPLETED) {
        return project;
      }
      
      if (project.status === ResearchStatus.FAILED) {
        throw new Error(`Research failed: ${project.error}`);
      }

      await new Promise(resolve => setTimeout(resolve, pollInterval));
    }

    // Return project even if not complete (partial results)
    const project = await this.researchService!.getProject(projectId);
    elizaLogger.warn(`[RESEARCH] Research timed out, using partial results for ${projectId}`);
    return project!;
  }

  /**
   * Create research context from completed project
   */
  private async createResearchContext(
    instance: SWEBenchInstance,
    project: ResearchProject
  ): Promise<ResearchContext> {
    const findings = this.extractFindings(project, 'solution_pattern');
    const guidance = this.extractImplementationGuidanceFromProject(project, instance);
    const risks = this.assessRisks(instance, project);

    return {
      issue: instance,
      researchProject: project,
      findings,
      implementationGuidance: guidance,
      riskAssessment: risks,
    };
  }

  /**
   * Extract findings from research project
   */
  private extractFindings(
    project: ResearchProject, 
    preferredType: ResearchFinding['type'] = 'solution_pattern'
  ): ResearchFinding[] {
    const findings: ResearchFinding[] = [];

    // Extract from research findings
    project.findings.forEach(finding => {
      findings.push({
        type: preferredType,
        content: finding.content,
        source: typeof finding.source === 'string' ? finding.source : finding.source?.title || 'Research',
        confidence: finding.confidence || 0.8,
        relevance: finding.relevance || 0.7,
      });
    });

    // Extract from sources
    project.sources.slice(0, 5).forEach(source => {
      const quotes = (source as any).relevant_quotes || (source.metadata as any)?.relevantQuotes || [];
      if (quotes.length > 0) {
        quotes.forEach((quote: string) => {
          findings.push({
            type: 'library_insight',
            content: quote,
            source: source.url || source.title,
            confidence: 0.7,
            relevance: (source as any).relevance_score || (source as any).relevance || 0.6,
          });
        });
      }
    });

    return findings.sort((a, b) => (b.confidence * b.relevance) - (a.confidence * a.relevance));
  }

  /**
   * Extract implementation guidance from research project
   */
  private extractImplementationGuidanceFromProject(
    project: ResearchProject,
    instance: SWEBenchInstance
  ): ImplementationGuidance {
    const language = this.extractLanguage(instance);
    const framework = this.extractFramework(instance);

    // Synthesize guidance from research findings
    let approach = 'Implement a targeted solution based on research findings';
    const considerations: string[] = [];
    const codePatterns: CodePattern[] = [];

    // Extract insights from research
    if (project.report?.summary) {
      approach = project.report.summary.substring(0, 200) + '...';
    }

    project.findings.forEach(finding => {
      if (finding.content.includes('pattern') || finding.content.includes('best practice')) {
        considerations.push(finding.content.substring(0, 100));
      }
    });

    // Add language-specific patterns
    if (language === 'typescript') {
      codePatterns.push({
        pattern: 'Type-safe implementation',
        description: 'Use strict typing for better reliability',
        example: 'interface Config { readonly prop: string; }',
        whenToUse: 'Always in TypeScript projects',
        alternatives: ['any type (discouraged)', 'loose typing'],
      });
    }

    return {
      approach,
      keyConsiderations: considerations.length > 0 ? considerations : [
        'Follow existing code patterns',
        'Ensure backward compatibility',
        'Add comprehensive error handling',
      ],
      testingStrategy: `Create unit tests for ${language} implementation`,
      performanceConsiderations: [
        'Optimize for common use cases',
        'Consider memory usage',
        'Profile critical paths',
      ],
      securityConsiderations: [
        'Validate all inputs',
        'Follow security best practices',
        'Review for common vulnerabilities',
      ],
      codePatterns,
    };
  }

  /**
   * Assess risks for the implementation
   */
  private assessRisks(instance: SWEBenchInstance, project: ResearchProject): RiskAssessment {
    const text = `${instance.issue_title} ${instance.issue_body || ''}`.toLowerCase();
    
    const risks: Risk[] = [];
    let complexity: 'low' | 'medium' | 'high' = 'medium';
    let breakingChanges = false;
    let performanceImpact: 'none' | 'low' | 'medium' | 'high' = 'low';
    let securityImpact: 'none' | 'low' | 'medium' | 'high' = 'none';

    // Analyze for complexity indicators
    if (text.includes('refactor') || text.includes('breaking') || text.includes('major')) {
      complexity = 'high';
      breakingChanges = true;
    }

    // Check for performance implications
    if (text.includes('performance') || text.includes('optimization') || text.includes('slow')) {
      performanceImpact = 'medium';
      risks.push({
        type: 'performance',
        description: 'Changes may affect system performance',
        probability: 0.7,
        impact: 0.6,
        mitigation: 'Add performance tests and benchmarks',
      });
    }

    // Check for security implications
    if (text.includes('security') || text.includes('vulnerability') || text.includes('auth')) {
      securityImpact = 'high';
      risks.push({
        type: 'security',
        description: 'Changes may introduce security vulnerabilities',
        probability: 0.5,
        impact: 0.9,
        mitigation: 'Conduct security review and penetration testing',
      });
    }

    // Add technical risks based on research findings
    if (project.findings.some(f => f.content.toLowerCase().includes('complex'))) {
      risks.push({
        type: 'technical',
        description: 'Implementation complexity may lead to bugs',
        probability: 0.6,
        impact: 0.5,
        mitigation: 'Use incremental development and extensive testing',
      });
    }

    return {
      complexity,
      breakingChanges,
      performanceImpact,
      securityImpact,
      risks,
      mitigations: [
        'Implement comprehensive test coverage',
        'Use feature flags for gradual rollout',
        'Monitor system metrics after deployment',
        'Have rollback plan ready',
      ],
    };
  }

  /**
   * Extract language from repository/issue context
   */
  private extractLanguage(instance: SWEBenchInstance): string {
    if (instance.language) {
      return instance.language.toLowerCase();
    }
    
    const text = `${instance.repo} ${instance.issue_title} ${instance.issue_body || ''}`.toLowerCase();
    
    if (text.includes('typescript') || text.includes('.ts')) return 'typescript';
    if (text.includes('javascript') || text.includes('.js')) return 'javascript';
    if (text.includes('python') || text.includes('.py')) return 'python';
    if (text.includes('java') && !text.includes('javascript')) return 'java';
    if (text.includes('rust') || text.includes('.rs')) return 'rust';
    if (text.includes('go') || text.includes('golang')) return 'go';
    
    return 'typescript'; // Default assumption
  }

  /**
   * Extract framework from repository/issue context
   */
  private extractFramework(instance: SWEBenchInstance): string | undefined {
    const text = `${instance.repo} ${instance.issue_title} ${instance.issue_body || ''}`.toLowerCase();
    
    if (text.includes('react')) return 'react';
    if (text.includes('vue')) return 'vue';
    if (text.includes('angular')) return 'angular';
    if (text.includes('express')) return 'express';
    if (text.includes('fastify')) return 'fastify';
    if (text.includes('django')) return 'django';
    if (text.includes('flask')) return 'flask';
    if (text.includes('spring')) return 'spring';
    
    return undefined;
  }

  /**
   * Create enhanced context when research service is unavailable
   */
  private createBasicContext(instance: SWEBenchInstance): ResearchContext {
    const language = this.extractLanguage(instance);
    const framework = this.extractFramework(instance);
    
    // Enhanced static analysis based on issue content
    const findings = this.analyzeIssueStatically(instance, language, framework);
    const guidance = this.createEnhancedGuidance(instance, language, framework);
    const risks = this.assessRisks(instance, { findings: [], sources: [] } as any);

    return {
      issue: instance,
      findings,
      implementationGuidance: guidance,
      riskAssessment: risks,
    };
  }

  /**
   * Perform static analysis of the issue without external research
   */
  private analyzeIssueStatically(
    instance: SWEBenchInstance, 
    language: string, 
    framework?: string
  ): ResearchFinding[] {
    const findings: ResearchFinding[] = [];
    const issueText = `${instance.issue_title} ${instance.issue_body || ''}`.toLowerCase();

    // Always add a primary solution pattern finding
    findings.push({
      type: 'solution_pattern',
      content: `Implement solution for: ${instance.issue_title}`,
      source: 'Static analysis',
      confidence: 0.8,
      relevance: 0.9,
    });

    // Analyze issue type and complexity
    if (issueText.includes('bug') || issueText.includes('error') || issueText.includes('exception')) {
      findings.push({
        type: 'solution_pattern',
        content: 'This appears to be a bug fix requiring debugging and error handling improvements',
        source: 'Static analysis',
        confidence: 0.8,
        relevance: 0.9,
      });
    }

    if (issueText.includes('feature') || issueText.includes('add') || issueText.includes('implement')) {
      findings.push({
        type: 'solution_pattern',
        content: 'This is a feature implementation requiring new functionality',
        source: 'Static analysis',
        confidence: 0.8,
        relevance: 0.9,
      });
    }

    if (issueText.includes('performance') || issueText.includes('slow') || issueText.includes('optimization')) {
      findings.push({
        type: 'best_practice',
        content: 'Performance optimization requires benchmarking and profiling',
        source: 'Performance analysis',
        confidence: 0.9,
        relevance: 0.8,
      });
    }

    if (issueText.includes('security') || issueText.includes('vulnerability')) {
      findings.push({
        type: 'best_practice',
        content: 'Security fixes require careful validation and testing',
        source: 'Static analysis',
        confidence: 0.9,
        relevance: 0.9,
      });
    }

    // Language-specific insights
    if (language === 'typescript') {
      findings.push({
        type: 'library_insight',
        content: 'Use TypeScript strict mode and proper type definitions for reliability',
        source: 'TypeScript best practices',
        confidence: 0.8,
        relevance: 0.7,
      });
    }

    if (framework) {
      findings.push({
        type: 'library_insight',
        content: `Follow ${framework} framework conventions and patterns`,
        source: `${framework} best practices`,
        confidence: 0.7,
        relevance: 0.8,
      });
    }

    // Add hints as findings if available
    if (instance.hints && instance.hints.length > 0) {
      instance.hints.forEach(hint => {
        findings.push({
          type: 'solution_pattern',
          content: hint,
          source: 'Issue hints',
          confidence: 0.9,
          relevance: 0.9,
        });
      });
    }

    return findings.length > 0 ? findings : [{
      type: 'solution_pattern',
      content: `Systematic approach needed for ${instance.issue_title}`,
      source: 'Default analysis',
      confidence: 0.6,
      relevance: 0.7,
    }];
  }

  /**
   * Create enhanced guidance based on static analysis
   */
  private createEnhancedGuidance(
    instance: SWEBenchInstance,
    language: string,
    framework?: string
  ): ImplementationGuidance {
    const issueText = `${instance.issue_title} ${instance.issue_body || ''}`.toLowerCase();
    
    let approach = 'Implement solution following best practices';
    const considerations: string[] = [];
    const codePatterns: CodePattern[] = [];

    // Tailor approach based on issue type
    if (issueText.includes('bug')) {
      approach = 'Debug the issue systematically, identify root cause, and implement targeted fix';
      considerations.push('Reproduce the bug in tests');
      considerations.push('Verify fix resolves all related scenarios');
    } else if (issueText.includes('feature')) {
      approach = 'Design and implement new functionality with proper integration';
      considerations.push('Ensure backward compatibility');
      considerations.push('Follow existing API patterns');
    } else if (issueText.includes('refactor')) {
      approach = 'Refactor code while maintaining existing functionality';
      considerations.push('Preserve public API contracts');
      considerations.push('Maintain test coverage');
    }

    // Language-specific considerations
    if (language === 'typescript') {
      considerations.push('Use strict TypeScript types');
      considerations.push('Leverage type inference where appropriate');
      
      codePatterns.push({
        pattern: 'Type-safe implementation',
        description: 'Define interfaces and use strict typing',
        example: 'interface Config { readonly value: string; }',
        whenToUse: 'Always in TypeScript projects',
        alternatives: ['any type (avoid)', 'loose typing'],
      });
    }

    if (framework) {
      considerations.push(`Follow ${framework} conventions`);
    }

    return {
      approach,
      keyConsiderations: considerations.length > 0 ? considerations : [
        'Follow project conventions',
        'Maintain code quality standards',
        'Ensure comprehensive testing',
        'Document changes appropriately',
      ],
      testingStrategy: `Create comprehensive tests for ${language} implementation covering edge cases`,
      performanceConsiderations: [
        'Profile performance-critical paths',
        'Consider memory usage and allocation patterns',
        'Optimize for common use cases',
        'Monitor impact on system performance',
      ],
      securityConsiderations: [
        'Validate all inputs and parameters',
        'Follow secure coding practices',
        'Review for common vulnerabilities',
        'Test security assumptions',
      ],
      codePatterns: codePatterns.length > 0 ? codePatterns : [{
        pattern: 'Standard implementation',
        description: 'Follow established project patterns',
        example: '// Implementation following project conventions',
        whenToUse: 'Default approach for this codebase',
        alternatives: ['Custom implementation patterns'],
      }],
    };
  }

  /**
   * Create basic implementation guidance
   */
  private createBasicGuidance(type: string, _requirements: string[]): ImplementationGuidance {
    return {
      approach: `Implement ${type} following best practices`,
      keyConsiderations: [
        'Follow existing patterns',
        'Ensure type safety',
        'Add error handling',
        'Write comprehensive tests',
      ],
      testingStrategy: 'Unit tests with good coverage',
      performanceConsiderations: [
        'Optimize critical paths',
        'Consider memory usage',
      ],
      securityConsiderations: [
        'Validate inputs',
        'Follow security guidelines',
      ],
      codePatterns: [{
        pattern: 'Standard implementation',
        description: 'Follow project conventions',
        example: '// Implementation here',
        whenToUse: 'Default approach',
        alternatives: ['Custom implementation'],
      }],
    };
  }

  /**
   * Extract implementation guidance from completed research
   */
  private extractImplementationGuidance(
    project: ResearchProject,
    pluginType: string,
    _requirements: string[]
  ): ImplementationGuidance {
    // Extract guidance from research findings
    const patterns: CodePattern[] = [];
    const considerations: string[] = [];

    project.findings.forEach(finding => {
      if (finding.content.includes('pattern')) {
        patterns.push({
          pattern: finding.content.substring(0, 50),
          description: finding.content,
          example: '// Pattern implementation',
          whenToUse: 'When applicable',
          alternatives: ['Alternative approaches'],
        });
      }
      
      if (finding.content.includes('consider') || finding.content.includes('important')) {
        considerations.push(finding.content.substring(0, 100));
      }
    });

    return {
      approach: project.report?.summary || `Implement ${pluginType} plugin based on research findings`,
      keyConsiderations: considerations.length > 0 ? considerations.slice(0, 5) : [
        'Follow ElizaOS architecture patterns',
        'Implement proper TypeScript interfaces',
        'Add comprehensive error handling',
        'Ensure proper service lifecycle management',
      ],
      testingStrategy: 'Comprehensive unit and integration tests',
      performanceConsiderations: [
        'Optimize plugin initialization',
        'Consider memory footprint',
        'Use efficient data structures',
      ],
      securityConsiderations: [
        'Validate all external inputs',
        'Secure API integrations',
        'Follow ElizaOS security guidelines',
      ],
      codePatterns: patterns.length > 0 ? patterns.slice(0, 3) : [{
        pattern: 'ElizaOS Plugin Structure',
        description: 'Standard plugin implementation pattern',
        example: 'export const plugin: Plugin = { name, description, actions, providers };',
        whenToUse: 'All ElizaOS plugins',
        alternatives: ['Custom plugin structure'],
      }],
    };
  }
}

/**
 * Helper function to create research prompt for specific scenarios
 */
export function createResearchPrompt(
  scenario: 'swe-bench' | 'plugin-creation' | 'plugin-update',
  context: any
): string {
  switch (scenario) {
    case 'swe-bench':
      return `Research best practices and solutions for: ${context.issue_title}. 
      Focus on ${context.language || 'TypeScript'} implementation patterns, common pitfalls, 
      and proven solutions for similar issues.`;
      
    case 'plugin-creation':
      return `Research ElizaOS plugin development best practices for ${context.pluginType} plugin. 
      Include architecture patterns, TypeScript implementation, testing strategies, 
      and integration approaches.`;
      
    case 'plugin-update':
      return `Research best practices for updating ${context.pluginName} plugin. 
      Focus on backward compatibility, migration strategies, version management, 
      and testing updated functionality.`;
      
    default:
      return `Research development best practices for: ${JSON.stringify(context)}`;
  }
}