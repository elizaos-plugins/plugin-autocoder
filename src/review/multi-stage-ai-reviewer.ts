import { elizaLogger } from '@elizaos/core';
import Anthropic from '@anthropic-ai/sdk';
import type { 
  Code, 
  VerificationContext, 
  VerificationStageResult,
  VerificationFinding 
} from '../verification/types';

/**
 * Multi-stage AI code reviewer with XML parsing for production readiness
 * This is the "stern critic" that rejects any non-production code
 */
export class MultiStageAIReviewer {
  private anthropic: Anthropic;

  constructor(apiKey: string) {
    this.anthropic = new Anthropic({ apiKey });
  }

  /**
   * Comprehensive multi-stage review with XML parsing
   */
  async reviewCode(
    code: Code,
    context: VerificationContext
  ): Promise<ComprehensiveReview> {
    elizaLogger.info('[AI-REVIEWER] Starting comprehensive multi-stage review');

    const stages: ReviewStage[] = [
      'architecture_review',
      'security_review', 
      'performance_review',
      'maintainability_review',
      'production_readiness_review',
      'final_stern_critique'
    ];

    const stageResults: StageReviewResult[] = [];
    let overallScore = 100;
    let criticalIssues: CriticalIssue[] = [];

    for (const stage of stages) {
      elizaLogger.info(`[AI-REVIEWER] Running ${stage}`);
      
      const stageResult = await this.runReviewStage(stage, code, context);
      stageResults.push(stageResult);

      // Accumulate critical issues
      criticalIssues.push(...stageResult.criticalIssues);

      // Adjust overall score
      overallScore = Math.min(overallScore, stageResult.score);

      // If we find critical issues in stern critique, fail immediately
      if (stage === 'final_stern_critique' && stageResult.criticalIssues.length > 0) {
        elizaLogger.error('[AI-REVIEWER] STERN CRITIQUE FAILED - Non-production code detected');
        break;
      }
    }

    const consolidatedReview = await this.consolidateReviews(stageResults);
    const improvementPlan = await this.generateImprovementPlan(consolidatedReview, criticalIssues);

    const result: ComprehensiveReview = {
      overallScore,
      passed: criticalIssues.length === 0 && overallScore >= 85,
      stageResults,
      consolidatedReview,
      criticalIssues,
      improvementPlan,
      productionReady: criticalIssues.length === 0
    };

    elizaLogger.info(`[AI-REVIEWER] Review complete: ${result.passed ? 'PASSED' : 'FAILED'} (Score: ${overallScore})`);
    
    return result;
  }

  /**
   * Run individual review stage with XML parsing
   */
  private async runReviewStage(
    stage: ReviewStage,
    code: Code,
    context: VerificationContext
  ): Promise<StageReviewResult> {
    const prompt = this.buildStagePrompt(stage, code, context);
    
    try {
      const response = await this.anthropic.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 4000,
        temperature: 0.1, // Low temperature for consistent, thorough analysis
        messages: [{
          role: 'user',
          content: prompt
        }]
      });

      const content = response.content[0].type === 'text' ? response.content[0].text : '';
      const parsed = this.parseXMLResponse(content);

      return {
        stage,
        score: parsed.score,
        passed: parsed.passed,
        findings: parsed.findings,
        criticalIssues: parsed.criticalIssues,
        recommendations: parsed.recommendations,
        rawResponse: content
      };

    } catch (error) {
      elizaLogger.error(`[AI-REVIEWER] Error in ${stage}:`, error);
      return {
        stage,
        score: 0,
        passed: false,
        findings: [{
          type: 'error',
          severity: 'critical',
          message: `Review stage failed: ${error.message}`
        }],
        criticalIssues: [{
          type: 'reviewer_error',
          description: `Failed to complete ${stage}`,
          severity: 'critical',
          location: 'N/A',
          mustFix: true
        }],
        recommendations: [],
        rawResponse: ''
      };
    }
  }

  /**
   * Build stage-specific prompts
   */
  private buildStagePrompt(
    stage: ReviewStage,
    code: Code,
    context: VerificationContext
  ): string {
    const baseContext = this.buildCodeContext(code);
    
    // Add requirements context to the code context
    let contextualizedPrompt = baseContext;
    
    if (context.requirements && context.requirements.length > 0) {
      contextualizedPrompt = `${baseContext}

# PROJECT REQUIREMENTS
The following are the specific requirements for this project that MUST be considered in your review:
${context.requirements.map(req => `- ${req}`).join('\n')}

# IMPORTANT CONTEXT
- Target Environment: ${context.targetEnvironment}
- Framework: ${context.framework}
${context.constraints && context.constraints.length > 0 ? `\nConstraints:\n${context.constraints.map(c => `- ${c}`).join('\n')}` : ''}

Please review the code IN THE CONTEXT of these requirements. The code should be evaluated based on whether it correctly implements the stated requirements, not based on abstract ideals of production-readiness that may not apply to this specific use case.
`;
    }
    
    switch (stage) {
      case 'architecture_review':
        return this.buildArchitecturePrompt(contextualizedPrompt);
      case 'security_review':
        return this.buildSecurityPrompt(contextualizedPrompt);
      case 'performance_review':
        return this.buildPerformancePrompt(contextualizedPrompt);
      case 'maintainability_review':
        return this.buildMaintainabilityPrompt(contextualizedPrompt);
      case 'production_readiness_review':
        return this.buildProductionReadinessPrompt(contextualizedPrompt);
      case 'final_stern_critique':
        // For stern critique, we need to be even more explicit about context
        if (context.targetEnvironment === 'development' && context.requirements.length > 0) {
          return this.buildContextualizedSternCritiquePrompt(contextualizedPrompt, context);
        }
        return this.buildSternCritiquePrompt(contextualizedPrompt);
      default:
        throw new Error(`Unknown review stage: ${stage}`);
    }
  }

  /**
   * Build code context for prompts
   */
  private buildCodeContext(code: Code): string {
    let context = `# Code Review Context\n\n`;
    context += `**Total Files:** ${code.files.length}\n`;
    context += `**Project Type:** ${this.detectProjectType(code)}\n\n`;

    // Add file overview
    context += `## File Structure\n`;
    for (const file of code.files) {
      context += `- ${file.path} (${file.content.split('\n').length} lines)\n`;
    }

    // Add file contents (truncated if too large)
    context += `\n## File Contents\n\n`;
    for (const file of code.files) {
      const lines = file.content.split('\n');
      const displayLines = lines.length > 100 ? lines.slice(0, 100) : lines;
      context += `### ${file.path}\n\`\`\`${file.language || 'typescript'}\n`;
      context += displayLines.join('\n');
      if (lines.length > 100) {
        context += `\n... (${lines.length - 100} more lines)`;
      }
      context += `\n\`\`\`\n\n`;
    }

    return context;
  }

  /**
   * Architecture review prompt
   */
  private buildArchitecturePrompt(codeContext: string): string {
    return `${codeContext}

# Architecture Review

You are an expert software architect conducting a thorough architecture review. Analyze the code structure, design patterns, and architectural decisions.

**Focus Areas:**
- Overall architecture and design patterns
- Separation of concerns
- Code organization and modularity
- Dependency management
- Interface design
- Extensibility and maintainability

**Critical Issues to Check:**
- Tight coupling between components
- Missing abstractions
- Circular dependencies
- Poor separation of concerns
- Violation of SOLID principles

Respond in this exact XML format:

<review>
<score>85</score>
<passed>true</passed>
<findings>
  <finding type="warning" severity="medium" file="src/example.ts" line="42">
    <message>Component has too many responsibilities, violates SRP</message>
    <recommendation>Split into smaller, focused components</recommendation>
  </finding>
</findings>
<critical_issues>
  <issue type="architecture" severity="high" location="src/manager.ts:15" must_fix="true">
    <description>Tight coupling detected between business logic and UI components</description>
  </issue>
</critical_issues>
<recommendations>
  <recommendation priority="high">Implement dependency injection pattern</recommendation>
  <recommendation priority="medium">Add interface abstractions for external dependencies</recommendation>
</recommendations>
</review>`;
  }

  /**
   * Security review prompt
   */
  private buildSecurityPrompt(codeContext: string): string {
    return `${codeContext}

# Security Review

You are a cybersecurity expert conducting a thorough security analysis. Look for vulnerabilities, security anti-patterns, and potential attack vectors.

**Focus Areas:**
- Input validation and sanitization
- Authentication and authorization
- Data encryption and protection
- SQL injection vulnerabilities
- XSS vulnerabilities
- CSRF protection
- Secret management
- Error handling that might leak information

**Critical Issues to Check:**
- Hardcoded secrets or API keys
- Missing input validation
- Insecure data transmission
- Improper error handling
- Missing authentication/authorization

Respond in this exact XML format:

<review>
<score>75</score>
<passed>false</passed>
<findings>
  <finding type="error" severity="critical" file="src/auth.ts" line="23">
    <message>Hardcoded API key detected</message>
    <recommendation>Move to environment variables</recommendation>
  </finding>
</findings>
<critical_issues>
  <issue type="security" severity="critical" location="src/auth.ts:23" must_fix="true">
    <description>Hardcoded API key 'sk-abcd1234' found in source code</description>
  </issue>
</critical_issues>
<recommendations>
  <recommendation priority="critical">Remove all hardcoded secrets</recommendation>
  <recommendation priority="high">Implement proper input validation</recommendation>
</recommendations>
</review>`;
  }

  /**
   * Performance review prompt
   */
  private buildPerformancePrompt(codeContext: string): string {
    return `${codeContext}

# Performance Review

You are a performance optimization expert. Analyze the code for performance bottlenecks, inefficiencies, and optimization opportunities.

**Focus Areas:**
- Algorithm efficiency
- Memory usage patterns
- I/O operations
- Caching strategies
- Database queries
- Network calls
- Resource management

**Critical Issues to Check:**
- N+1 query problems
- Memory leaks
- Blocking operations
- Inefficient algorithms
- Missing caching
- Large object creation in loops

Respond in this exact XML format:

<review>
<score>80</score>
<passed>true</passed>
<findings>
  <finding type="warning" severity="medium" file="src/service.ts" line="67">
    <message>Potential N+1 query pattern detected</message>
    <recommendation>Consider using batch queries or eager loading</recommendation>
  </finding>
</findings>
<critical_issues>
</critical_issues>
<recommendations>
  <recommendation priority="medium">Implement caching for frequently accessed data</recommendation>
  <recommendation priority="low">Consider lazy loading for large datasets</recommendation>
</recommendations>
</review>`;
  }

  /**
   * Maintainability review prompt
   */
  private buildMaintainabilityPrompt(codeContext: string): string {
    return `${codeContext}

# Maintainability Review

You are a senior software engineer focusing on code maintainability, readability, and long-term sustainability.

**Focus Areas:**
- Code clarity and readability
- Documentation quality
- Test coverage
- Error handling
- Logging and debugging support
- Code duplication
- Naming conventions

**Critical Issues to Check:**
- Poor naming conventions
- Missing documentation
- Code duplication
- Complex, hard-to-understand logic
- Missing error handling
- Inconsistent coding style

Respond in this exact XML format:

<review>
<score>70</score>
<passed>true</passed>
<findings>
  <finding type="warning" severity="medium" file="src/utils.ts" line="12">
    <message>Function name 'fn1' is not descriptive</message>
    <recommendation>Use descriptive function names like 'processUserData'</recommendation>
  </finding>
</findings>
<critical_issues>
</critical_issues>
<recommendations>
  <recommendation priority="high">Improve function and variable naming</recommendation>
  <recommendation priority="medium">Add comprehensive JSDoc documentation</recommendation>
</recommendations>
</review>`;
  }

  /**
   * Production readiness prompt
   */
  private buildProductionReadinessPrompt(codeContext: string): string {
    return `${codeContext}

# Production Readiness Review

You are a DevOps/SRE expert evaluating production readiness. Check for monitoring, logging, error handling, configuration management, and deployment considerations.

**Focus Areas:**
- Error handling and recovery
- Logging and monitoring
- Configuration management
- Health checks
- Graceful shutdown
- Resource limits
- Deployment artifacts

**Critical Issues to Check:**
- Missing error handling
- Poor logging
- Missing health checks
- Hardcoded configuration
- No graceful shutdown
- Missing monitoring

Respond in this exact XML format:

<review>
<score>85</score>
<passed>true</passed>
<findings>
  <finding type="warning" severity="medium" file="src/server.ts" line="45">
    <message>Missing graceful shutdown handling</message>
    <recommendation>Add SIGTERM handler for graceful shutdown</recommendation>
  </finding>
</findings>
<critical_issues>
</critical_issues>
<recommendations>
  <recommendation priority="high">Add comprehensive health check endpoint</recommendation>
  <recommendation priority="medium">Implement structured logging</recommendation>
</recommendations>
</review>`;
  }

  /**
   * Contextualized stern critique for development/benchmark scenarios
   */
  private buildContextualizedSternCritiquePrompt(codeContext: string, context: VerificationContext): string {
    return `${codeContext}

# CONTEXTUALIZED CODE REVIEW - REQUIREMENTS-BASED VALIDATION

You are reviewing code that was created to meet SPECIFIC REQUIREMENTS. Your job is to verify that the code correctly implements those requirements, not to apply generic production standards that may not be relevant.

**EVALUATION CRITERIA:**
1. Does the code correctly implement ALL the stated requirements?
2. Does the code follow the specified constraints?
3. Is the code appropriate for the ${context.targetEnvironment} environment?
4. Are there any ACTUAL bugs or errors that would prevent the code from working as specified?

**WHAT TO IGNORE for ${context.targetEnvironment} environment:**
- Minor security concerns that are not relevant to the use case (e.g., XSS in a simple echo function)
- Configuration patterns that are acceptable for development/testing
- Code complexity concerns if the simple solution meets the requirements
- "Production-readiness" issues that don't affect the core functionality

**FOCUS ON:**
- Whether the requirements are met
- Whether the code works correctly
- Whether there are actual bugs
- Whether the implementation follows ElizaOS patterns

**SCORING FOR ${context.targetEnvironment.toUpperCase()}:**
- 100: All requirements perfectly implemented, no bugs
- 85-99: Requirements met with minor style issues
- 70-84: Most requirements met, some minor issues
- 50-69: Some requirements missing or bugs present
- 0-49: Major requirements not met or critical bugs

Remember: A simple echo action that works correctly should score HIGH if that's what was requested, even if it doesn't have enterprise-grade security features.

Respond in this exact XML format:

<review>
<score>90</score>
<passed>true</passed>
<findings>
  <finding type="info" severity="low" file="src/actions/echo.ts" line="10">
    <message>Echo action correctly implements the requirement to echo user input</message>
    <recommendation>No changes needed - requirement satisfied</recommendation>
  </finding>
</findings>
<critical_issues>
</critical_issues>
<recommendations>
  <recommendation priority="low">Consider adding input validation in future production version</recommendation>
</recommendations>
</review>`;
  }

  /**
   * Final stern critique prompt - the harshest reviewer
   */
  private buildSternCritiquePrompt(codeContext: string): string {
    return `${codeContext}

# FINAL STERN CRITIQUE - PRODUCTION CODE VALIDATOR

You are the most stringent code reviewer possible. Your job is to REJECT any code that is not 100% production-ready. You have ZERO tolerance for:

**IMMEDIATE REJECTION CRITERIA:**
- ANY TODO comments
- ANY FIXME comments  
- ANY placeholder text like "TODO", "PLACEHOLDER", "STUB"
- ANY hardcoded values that should be configurable
- ANY demo/example/test code in production paths
- ANY "proof of concept" or "PoC" implementations
- ANY console.log statements (use proper logging)
- ANY commented-out code
- ANY temporary workarounds
- ANY function/variable names like "temp", "tmp", "test", "foo", "bar"
- ANY magic numbers without constants
- ANY missing error handling
- ANY unhandled promise rejections
- ANY potential memory leaks
- ANY security vulnerabilities
- ANY performance anti-patterns
- ANY code that doesn't follow established patterns

**ZERO TOLERANCE ITEMS:**
- Code that doesn't work in production
- Code that will fail under load
- Code that has security holes
- Code that doesn't handle errors properly
- Code that lacks proper logging
- Code that isn't maintainable

Be absolutely ruthless. If you find ANYTHING that suggests this is not production-ready, enterprise-grade code, mark it as a CRITICAL ISSUE that MUST be fixed.

**SCORING:**
- 100: Perfect production code, no issues whatsoever
- 85-99: Minor issues that don't affect production readiness
- 70-84: Some issues that could cause problems in production
- 50-69: Multiple issues that WILL cause problems in production
- 0-49: NOT PRODUCTION READY - multiple critical issues

Respond in this exact XML format:

<review>
<score>45</score>
<passed>false</passed>
<findings>
  <finding type="error" severity="critical" file="src/service.ts" line="23">
    <message>TODO comment found: 'TODO: implement proper error handling'</message>
    <recommendation>Remove TODO and implement proper error handling immediately</recommendation>
  </finding>
  <finding type="error" severity="critical" file="src/config.ts" line="5">
    <message>Hardcoded API endpoint 'https://api.example.com' should be configurable</message>
    <recommendation>Move to environment variable or configuration file</recommendation>
  </finding>
</findings>
<critical_issues>
  <issue type="todo_comment" severity="critical" location="src/service.ts:23" must_fix="true">
    <description>TODO comment indicates incomplete implementation</description>
  </issue>
  <issue type="hardcoded_value" severity="critical" location="src/config.ts:5" must_fix="true">
    <description>Hardcoded API endpoint prevents proper configuration management</description>
  </issue>
  <issue type="poor_naming" severity="critical" location="src/utils.ts:12" must_fix="true">
    <description>Function named 'doStuff' is unprofessional and unclear</description>
  </issue>
</critical_issues>
<recommendations>
  <recommendation priority="critical">Remove ALL TODO/FIXME comments and implement proper solutions</recommendation>
  <recommendation priority="critical">Replace ALL hardcoded values with proper configuration</recommendation>
  <recommendation priority="critical">Use professional, descriptive naming throughout</recommendation>
  <recommendation priority="critical">Implement comprehensive error handling</recommendation>
</recommendations>
</review>`;
  }

  /**
   * Parse XML response from Claude
   */
  private parseXMLResponse(response: string): ParsedReview {
    try {
      // Extract XML content
      const xmlMatch = response.match(/<review>(.*?)<\/review>/s);
      if (!xmlMatch) {
        throw new Error('No valid XML review found in response');
      }

      const xmlContent = xmlMatch[1];

      // Parse score
      const scoreMatch = xmlContent.match(/<score>(\d+)<\/score>/);
      const score = scoreMatch ? parseInt(scoreMatch[1]) : 0;

      // Parse passed
      const passedMatch = xmlContent.match(/<passed>(true|false)<\/passed>/);
      const passed = passedMatch ? passedMatch[1] === 'true' : false;

      // Parse findings
      const findings: VerificationFinding[] = [];
      const findingMatches = xmlContent.match(/<finding[^>]*>.*?<\/finding>/gs) || [];
      
      for (const findingMatch of findingMatches) {
        const typeMatch = findingMatch.match(/type="([^"]+)"/);
        const severityMatch = findingMatch.match(/severity="([^"]+)"/);
        const fileMatch = findingMatch.match(/file="([^"]+)"/);
        const lineMatch = findingMatch.match(/line="([^"]+)"/);
        const messageMatch = findingMatch.match(/<message>(.*?)<\/message>/s);
        const recommendationMatch = findingMatch.match(/<recommendation>(.*?)<\/recommendation>/s);

        findings.push({
          type: (typeMatch?.[1] || 'warning') as any,
          severity: (severityMatch?.[1] || 'medium') as any,
          message: messageMatch?.[1] || 'Unknown issue',
          file: fileMatch?.[1],
          line: lineMatch?.[1] ? parseInt(lineMatch[1]) : undefined,
          fix: recommendationMatch?.[1] ? {
            description: recommendationMatch[1],
            automatic: false,
            confidence: 0.7
          } : undefined
        });
      }

      // Parse critical issues
      const criticalIssues: CriticalIssue[] = [];
      const issueMatches = xmlContent.match(/<issue[^>]*>.*?<\/issue>/gs) || [];
      
      for (const issueMatch of issueMatches) {
        const typeMatch = issueMatch.match(/type="([^"]+)"/);
        const severityMatch = issueMatch.match(/severity="([^"]+)"/);
        const locationMatch = issueMatch.match(/location="([^"]+)"/);
        const mustFixMatch = issueMatch.match(/must_fix="([^"]+)"/);
        const descriptionMatch = issueMatch.match(/<description>(.*?)<\/description>/s);

        criticalIssues.push({
          type: typeMatch?.[1] || 'unknown',
          severity: (severityMatch?.[1] || 'high') as any,
          location: locationMatch?.[1] || 'unknown',
          mustFix: mustFixMatch?.[1] === 'true',
          description: descriptionMatch?.[1] || 'Unknown critical issue'
        });
      }

      // Parse recommendations
      const recommendations: string[] = [];
      const recommendationMatches = xmlContent.match(/<recommendation[^>]*>(.*?)<\/recommendation>/gs) || [];
      
      for (const recMatch of recommendationMatches) {
        const contentMatch = recMatch.match(/<recommendation[^>]*>(.*?)<\/recommendation>/s);
        if (contentMatch?.[1]) {
          recommendations.push(contentMatch[1]);
        }
      }

      return {
        score,
        passed,
        findings,
        criticalIssues,
        recommendations
      };

    } catch (error) {
      elizaLogger.error('[AI-REVIEWER] Failed to parse XML response:', error);
      return {
        score: 0,
        passed: false,
        findings: [{
          type: 'error',
          severity: 'critical',
          message: `Failed to parse review response: ${error.message}`
        }],
        criticalIssues: [{
          type: 'parser_error',
          severity: 'critical',
          location: 'N/A',
          mustFix: true,
          description: 'Could not parse AI review response'
        }],
        recommendations: ['Fix AI reviewer integration']
      };
    }
  }

  /**
   * Consolidate multiple stage reviews
   */
  private async consolidateReviews(stageResults: StageReviewResult[]): Promise<ConsolidatedReview> {
    const allFindings = stageResults.flatMap(stage => stage.findings);
    const allCriticalIssues = stageResults.flatMap(stage => stage.criticalIssues);
    const allRecommendations = stageResults.flatMap(stage => stage.recommendations);

    // Remove duplicates
    const uniqueFindings = this.deduplicateFindings(allFindings);
    const uniqueCriticalIssues = this.deduplicateCriticalIssues(allCriticalIssues);
    const uniqueRecommendations = [...new Set(allRecommendations)];

    // Calculate weighted score
    const weights = {
      architecture_review: 0.20,
      security_review: 0.25,
      performance_review: 0.15,
      maintainability_review: 0.15,
      production_readiness_review: 0.15,
      final_stern_critique: 0.10
    };

    const weightedScore = stageResults.reduce((sum, stage) => {
      const weight = weights[stage.stage] || 0.1;
      return sum + (stage.score * weight);
    }, 0);

    return {
      overallScore: Math.round(weightedScore),
      totalFindings: uniqueFindings.length,
      totalCriticalIssues: uniqueCriticalIssues.length,
      stageScores: stageResults.reduce((acc, stage) => {
        acc[stage.stage] = stage.score;
        return acc;
      }, {} as Record<ReviewStage, number>),
      recommendations: uniqueRecommendations,
      criticalIssues: uniqueCriticalIssues
    };
  }

  /**
   * Generate improvement plan
   */
  private async generateImprovementPlan(
    consolidatedReview: ConsolidatedReview,
    criticalIssues: CriticalIssue[]
  ): Promise<ImprovementPlan> {
    const criticalItems = criticalIssues.filter(issue => issue.mustFix);
    const highPriorityItems = criticalIssues.filter(issue => !issue.mustFix && issue.severity === 'critical');
    const mediumPriorityItems = criticalIssues.filter(issue => issue.severity === 'high');

    return {
      immediateActions: criticalItems.map(issue => ({
        action: `Fix ${issue.type}: ${issue.description}`,
        location: issue.location,
        priority: 'critical' as const
      })),
      shortTermActions: highPriorityItems.map(issue => ({
        action: `Address ${issue.type}: ${issue.description}`,
        location: issue.location,
        priority: 'high' as const
      })),
      longTermActions: mediumPriorityItems.map(issue => ({
        action: `Improve ${issue.type}: ${issue.description}`,
        location: issue.location,
        priority: 'medium' as const
      })),
      estimatedEffort: this.estimateEffort(criticalItems.length, highPriorityItems.length, mediumPriorityItems.length)
    };
  }

  /**
   * Detect project type from code structure
   */
  private detectProjectType(code: Code): string {
    const files = code.files.map(f => f.path);
    
    if (files.some(f => f.includes('package.json'))) {
      if (files.some(f => f.includes('next.config'))) return 'Next.js';
      if (files.some(f => f.includes('react'))) return 'React';
      if (files.some(f => f.includes('express') || f.includes('server'))) return 'Node.js API';
      return 'Node.js';
    }
    
    if (files.some(f => f.endsWith('.py'))) return 'Python';
    if (files.some(f => f.endsWith('.java'))) return 'Java';
    if (files.some(f => f.endsWith('.go'))) return 'Go';
    
    return 'Unknown';
  }

  /**
   * Deduplicate findings by message and location
   */
  private deduplicateFindings(findings: VerificationFinding[]): VerificationFinding[] {
    const seen = new Set<string>();
    return findings.filter(finding => {
      const key = `${finding.message}:${finding.file}:${finding.line}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  /**
   * Deduplicate critical issues
   */
  private deduplicateCriticalIssues(issues: CriticalIssue[]): CriticalIssue[] {
    const seen = new Set<string>();
    return issues.filter(issue => {
      const key = `${issue.type}:${issue.location}:${issue.description}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  /**
   * Estimate effort required for fixes
   */
  private estimateEffort(critical: number, high: number, medium: number): string {
    const totalWork = critical * 4 + high * 2 + medium * 1;
    
    if (totalWork <= 4) return '2-4 hours';
    if (totalWork <= 8) return '1-2 days';
    if (totalWork <= 16) return '3-5 days';
    if (totalWork <= 32) return '1-2 weeks';
    return '2+ weeks';
  }
}

// Type definitions
export type ReviewStage = 
  | 'architecture_review'
  | 'security_review'
  | 'performance_review'
  | 'maintainability_review'
  | 'production_readiness_review'
  | 'final_stern_critique';

export interface StageReviewResult {
  stage: ReviewStage;
  score: number;
  passed: boolean;
  findings: VerificationFinding[];
  criticalIssues: CriticalIssue[];
  recommendations: string[];
  rawResponse: string;
}

export interface CriticalIssue {
  type: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  location: string;
  mustFix: boolean;
  description: string;
}

export interface ParsedReview {
  score: number;
  passed: boolean;
  findings: VerificationFinding[];
  criticalIssues: CriticalIssue[];
  recommendations: string[];
}

export interface ConsolidatedReview {
  overallScore: number;
  totalFindings: number;
  totalCriticalIssues: number;
  stageScores: Record<ReviewStage, number>;
  recommendations: string[];
  criticalIssues: CriticalIssue[];
}

export interface ImprovementPlan {
  immediateActions: ActionItem[];
  shortTermActions: ActionItem[];
  longTermActions: ActionItem[];
  estimatedEffort: string;
}

export interface ActionItem {
  action: string;
  location: string;
  priority: 'critical' | 'high' | 'medium' | 'low';
}

export interface ComprehensiveReview {
  overallScore: number;
  passed: boolean;
  stageResults: StageReviewResult[];
  consolidatedReview: ConsolidatedReview;
  criticalIssues: CriticalIssue[];
  improvementPlan: ImprovementPlan;
  productionReady: boolean;
}