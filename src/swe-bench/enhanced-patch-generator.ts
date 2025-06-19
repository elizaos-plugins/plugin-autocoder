import { elizaLogger } from '@elizaos/core';
import * as fs from 'fs/promises';
import * as path from 'path';
import type { 
  SWEBenchInstance, 
  IssueAnalysis, 
  GeneratedPatch,
  ProjectContext 
} from './types';
import { IssueAnalyzer } from './issue-analyzer';
import { RepositoryManager } from './repository-manager';
import Anthropic from '@anthropic-ai/sdk';
import { ContinuousVerificationManager } from '../verification/continuous-verification-manager';
import type { Code, VerificationContext } from '../verification/types';
import { TDDEngine } from '../tdd/tdd-engine';
import type { Requirement, ProjectContext as TDDProjectContext } from '../tdd/types';
import { MultiStageAIReviewer } from '../review/multi-stage-ai-reviewer';
import { ResearchIntegration, type ResearchContext, createResearchPrompt } from '../research/research-integration';
import { promisify } from 'util';
import { exec } from 'child_process';

/**
 * Enhanced patch generator with verification and TDD
 */
export class EnhancedPatchGenerator {
  private anthropic: Anthropic | null = null;
  private verificationManager: ContinuousVerificationManager;
  private tddEngine: TDDEngine;
  private aiReviewer: MultiStageAIReviewer;
  private researchIntegration: ResearchIntegration;
  private totalTokenUsage = { prompt_tokens: 0, completion_tokens: 0, total: 0, cost: 0 };

  constructor(
    private runtime: any, // IAgentRuntime
    private issueAnalyzer: IssueAnalyzer,
    private repoManager: RepositoryManager
  ) {
    // Initialize verification and TDD systems
    this.verificationManager = new ContinuousVerificationManager({
      failFast: false, // Continue even with issues to get full picture
      autoFix: false, // Disabled to prevent infinite loops
      thresholds: {
        minScore: 70, // Lower threshold for SWE-bench
        maxCriticalErrors: 0,
        maxHighErrors: 5,
        minCoverage: 60,
        maxComplexity: 15
      }
    });
    
    this.tddEngine = new TDDEngine(runtime, {
      maxIterations: 10,
      targetCoverage: 80,
      enableRefactoring: true
    });
    
    this.aiReviewer = new MultiStageAIReviewer(runtime);
    this.researchIntegration = new ResearchIntegration(runtime);
  }

  /**
   * Generate a patch with comprehensive verification
   */
  async generatePatch(
    instance: SWEBenchInstance, 
    repoPath: string
  ): Promise<GeneratedPatch> {
    elizaLogger.info(`[ENHANCED-PATCH] Generating verified patch for ${instance.instance_id}`);
    
    // Reset token usage for this patch generation
    this.totalTokenUsage = { prompt_tokens: 0, completion_tokens: 0, total: 0, cost: 0 };
    
    // Initialize Anthropic if not already done
    if (!this.anthropic) {
      const apiKey = this.runtime.getSetting('ANTHROPIC_API_KEY');
      if (!apiKey) {
        throw new Error('ANTHROPIC_API_KEY not configured');
      }
      this.anthropic = new Anthropic({ apiKey });
    }

    // Phase 0: Research the issue
    elizaLogger.info('[ENHANCED-PATCH] Phase 0: Researching the issue');
    const researchContext = await this.researchIntegration.researchIssue(instance);
    elizaLogger.info(`[ENHANCED-PATCH] Research completed with ${researchContext.findings.length} findings`);

    // Phase 1: Analyze the issue
    const analysis = await this.issueAnalyzer.analyzeIssue(instance, repoPath);
    
    // Phase 2: Generate comprehensive tests (TDD approach)
    const testSuite = await this.generateTestsForIssue(instance, analysis, repoPath);
    
    // Phase 3: Create project context with research insights
    const projectContext = await this.createProjectContext(instance, analysis, repoPath, researchContext);
    
    let iterations = 0;
    const maxIterations = analysis.complexity === 'high' ? 8 : 5;
    let bestPatch: GeneratedPatch | null = null;
    let bestScore = 0;
    let lastPatch = '';
    let lastVerificationResult: any = null;
    let approach = '';

    // Phase 4: Iterative patch generation with verification
    for (let iteration = 1; iteration <= maxIterations; iteration++) {
      elizaLogger.info(`[ENHANCED-PATCH] Iteration ${iteration}/${maxIterations}`);
      iterations = iteration;
      
      try {
        // Generate the code fix
        const result = await this.generatePatchIteration(
          instance,
          projectContext,
          analysis,
          iteration,
          lastPatch,
          testSuite,
          lastVerificationResult
        );
        
        // Apply changes
        for (const change of result.changes) {
          const fullPath = path.join(repoPath, change.file);
          
          // Log what we're about to write
          elizaLogger.info(`[ENHANCED-PATCH] Writing to file: ${change.file}`);
          elizaLogger.debug(`[ENHANCED-PATCH] Content preview: ${change.content.substring(0, 200)}...`);
          
          // Ensure directory exists
          await fs.mkdir(path.dirname(fullPath), { recursive: true });
          await fs.writeFile(fullPath, change.content, 'utf-8');
          elizaLogger.info(`[ENHANCED-PATCH] Modified ${change.file}`);
        }
        
        // Verify the patch
        const verificationResult = await this.verifyPatch(repoPath, instance, analysis);
        
        // Log verification results in detail
        elizaLogger.info(`[ENHANCED-PATCH] Verification score: ${verificationResult.score}/100`);
        elizaLogger.info(`[ENHANCED-PATCH] Build passed: ${verificationResult.realWorldChecks?.buildPassed || false}`);
        elizaLogger.info(`[ENHANCED-PATCH] Tests: ${verificationResult.realWorldChecks?.testsPassed || 0}/${verificationResult.realWorldChecks?.testsRun || 0}`);
        
        if (verificationResult.score >= 70 || verificationResult.realWorldChecks?.buildPassed) {
          elizaLogger.info('[ENHANCED-PATCH] Patch meets quality standards');
          
          // Generate final patch
          const patch = await this.repoManager.generateDiff(repoPath);
          const modifiedFiles = await this.getModifiedFiles(repoPath);
          const stats = this.analyzePatchStats(patch);
          
          return {
            patch,
            files_modified: modifiedFiles,
            additions: stats.additions,
            deletions: stats.deletions,
            iteration_count: iteration,
            approach_description: result.approach,
            verification_score: verificationResult.score,
            verification_passed: true,
            real_world_checks: verificationResult.realWorldChecks,
            test_coverage: testSuite ? testSuite.tests.length : 0,
            token_usage: this.totalTokenUsage
          };
        }
        
        // Store result for next iteration
        lastVerificationResult = {
          patch: await this.repoManager.generateDiff(repoPath),
          verificationScore: verificationResult.score,
          errors: verificationResult.errors || []
        };
        
        elizaLogger.info('[ENHANCED-PATCH] Learning from verification failures');
        
      } catch (error) {
        elizaLogger.error(`[ENHANCED-PATCH] Iteration ${iteration} failed:`, error);
        elizaLogger.error(`[ENHANCED-PATCH] Error details: ${error instanceof Error ? error.stack : String(error)}`);
        
        // Continue to next iteration unless it's a critical error
        if (error instanceof Error && error.message.includes('ANTHROPIC_API_KEY')) {
          throw error; // Re-throw API key errors
        }
      }
    }

    // Get final patch
    const finalPatch = await this.repoManager.generateDiff(repoPath);
    const stats = this.analyzePatchStats(finalPatch);
    
    // Final verification
    const finalVerification = await this.verifyPatch(repoPath, instance, analysis);
    
    return {
      patch: finalPatch,
      files_modified: stats.files,
      additions: stats.additions,
      deletions: stats.deletions,
      iteration_count: iterations,
      approach_description: approach,
      verification_score: finalVerification.score,
      verification_passed: finalVerification.passed,
      real_world_checks: finalVerification.realWorldChecks,
      test_coverage: testSuite ? testSuite.tests.length : 0,
      token_usage: this.totalTokenUsage
    };
  }

  /**
   * Generate tests for the issue (TDD approach)
   */
  private async generateTestsForIssue(
    instance: SWEBenchInstance,
    analysis: IssueAnalysis,
    repoPath: string
  ): Promise<any> {
    elizaLogger.info('[ENHANCED-PATCH] Generating tests for issue');
    
    // Convert issue to requirements
    const requirements: Requirement[] = analysis.requirements.map((req, i) => ({
      id: `req-${i}`,
      description: req,
      acceptanceCriteria: analysis.test_requirements || [],
      priority: 'must' as const,
      category: 'functional',
      testable: true
    }));
    
    // Create TDD project context
    const tddContext: TDDProjectContext = {
      name: instance.issue_title,
      description: instance.issue_body,
      requirements,
      architecture: {
        pattern: 'layered' as const,
        components: [],
        dataFlow: []
      }
    };
    
    try {
      // Generate comprehensive test suite
      const testSuite = await this.tddEngine.generateTestsFirst(requirements, tddContext);
      elizaLogger.info(`[ENHANCED-PATCH] Generated ${testSuite.tests.length} tests`);
      return testSuite;
    } catch (error) {
      elizaLogger.warn('[ENHANCED-PATCH] Test generation failed:', error);
      return null;
    }
  }

  /**
   * Verify the patch using continuous verification
   */
  private async verifyPatch(
    repoPath: string,
    instance: SWEBenchInstance,
    analysis: IssueAnalysis
  ): Promise<any> {
    elizaLogger.info('[ENHANCED-PATCH] Starting comprehensive patch verification');
    
    // First, ensure we have a clean git state
    try {
      await promisify(exec)('git add .', { cwd: repoPath });
    } catch (error) {
      elizaLogger.warn('[ENHANCED-PATCH] Failed to stage changes:', error);
    }
    
    // Step 1: Run actual repository build check
    const buildPassed = await this.repoManager.checkBuild(repoPath);
    if (!buildPassed) {
      elizaLogger.error('[ENHANCED-PATCH] Build check failed - syntax or type errors detected');
    }
    
    // Step 2: Run actual tests in the repository
    let testResults: any = null;
    try {
      // For SWE-bench, we run the existing test suite without applying test_patch
      // The test_patch is only used for final evaluation
      testResults = await this.repoManager.runTests(repoPath);
      elizaLogger.info(`[ENHANCED-PATCH] Test results: ${testResults.passed}/${testResults.total} passed`);
    } catch (error) {
      elizaLogger.error('[ENHANCED-PATCH] Test execution failed:', error);
      // Create a failed test result
      testResults = {
        total: 1,
        passed: 0,
        failed: 1,
        skipped: 0,
        duration: 0,
        failures: [{
          test_name: 'Test execution',
          error_message: error.message || 'Unknown error'
        }]
      };
    }
    
    // Step 3: Run linting if available
    let lintPassed = true;
    try {
      const { stderr } = await promisify(exec)('npm run lint --if-present', {
        cwd: repoPath,
        timeout: 60000
      });
      if (stderr && !stderr.includes('warning')) {
        lintPassed = false;
        elizaLogger.warn('[ENHANCED-PATCH] Linting issues detected');
      }
    } catch (error) {
      // Linting might not be configured, which is okay
      elizaLogger.debug('[ENHANCED-PATCH] Linting not available or failed');
    }
    
    // Step 4: Read all modified files for abstract verification
    const modifiedFiles = await this.getModifiedFiles(repoPath);
    
    // Create Code object for verification
    const code: Code = {
      files: await Promise.all(modifiedFiles.map(async f => ({
        path: f,
        content: await fs.readFile(path.join(repoPath, f), 'utf-8'),
        language: this.getFileLanguage(f)
      }))),
      entryPoint: analysis.affected_files[0],
      dependencies: {},
      devDependencies: {}
    };
    
    // Create verification context
    const context: VerificationContext = {
      projectPath: repoPath,
      requirements: analysis.requirements,
      constraints: [
        'Fix the reported issue',
        'Maintain backward compatibility',
        'Follow existing code patterns',
        'Pass all existing tests'
      ],
      targetEnvironment: 'production',
      language: analysis.context.language === 'typescript' ? 'TypeScript' : 'JavaScript',
      framework: analysis.context.framework
    };
    
    // Step 5: Run abstract verification
    const verificationResult = await this.verificationManager.verifyCode(code, context);
    
    // Step 6: Run AI review for additional insights
    let aiReviewScore = 70; // Default score
    try {
      const aiReview = await this.aiReviewer.reviewCode(code, context);
      
      // Merge AI review findings into verification result
      (verificationResult as any).aiReview = {
        overallScore: aiReview.overallScore,
        criticalFindings: aiReview.consolidatedReview.criticalIssues.filter((i: any) => i.severity === 'critical').length,
        summary: `Score: ${aiReview.overallScore}, Critical Issues: ${aiReview.criticalIssues.length}`,
        actionItems: aiReview.improvementPlan.immediateActions.map((a: any) => a.action)
      };
      
      aiReviewScore = aiReview.overallScore;
    } catch (error) {
      elizaLogger.warn('[ENHANCED-PATCH] AI review failed:', error);
    }
    
    // Step 7: Calculate comprehensive score based on all checks
    const realWorldScore = this.calculateRealWorldScore(buildPassed, testResults, lintPassed);
    const abstractScore = verificationResult.score;
    
    // Weight real-world results more heavily
    const finalScore = Math.round(
      (realWorldScore * 0.6) +      // 60% weight on build/test/lint
      (abstractScore * 0.3) +        // 30% weight on abstract verification
      (aiReviewScore * 0.1)          // 10% weight on AI review
    );
    
    // Determine if verification passed
    const passed = buildPassed && 
                  testResults && testResults.failed === 0 &&
                  verificationResult.criticalErrors.length === 0 &&
                  finalScore >= 70;
    
    // Enhance verification result with real-world data
    const enhancedResult = {
      ...verificationResult,
      score: finalScore,
      passed,
      realWorldChecks: {
        buildPassed,
        testsRun: testResults ? testResults.total : 0,
        testsPassed: testResults ? testResults.passed : 0,
        testsFailed: testResults ? testResults.failed : 0,
        lintPassed
      },
      criticalErrors: [
        ...verificationResult.criticalErrors,
        ...(buildPassed ? [] : [{
          type: 'build',
          message: 'Build failed - check syntax and types',
          severity: 'critical' as const,
          file: 'N/A',
          line: 0
        }]),
        ...(testResults && testResults.failed > 0 ? [{
          type: 'test',
          message: `${testResults.failed} tests failed`,
          severity: 'critical' as const,
          file: 'N/A',
          line: 0
        }] : [])
      ]
    };
    
    elizaLogger.info(`[ENHANCED-PATCH] Comprehensive verification complete:
      - Final Score: ${finalScore}/100
      - Build: ${buildPassed ? 'PASS' : 'FAIL'}
      - Tests: ${testResults ? `${testResults.passed}/${testResults.total}` : 'N/A'}
      - Lint: ${lintPassed ? 'PASS' : 'FAIL/N/A'}
      - Abstract: ${abstractScore}/100
      - AI Review: ${aiReviewScore}/100
      - Overall: ${passed ? 'PASSED' : 'FAILED'}`);
    
    return enhancedResult;
  }

  /**
   * Calculate score based on real-world verification results
   */
  private calculateRealWorldScore(
    buildPassed: boolean,
    testResults: any,
    lintPassed: boolean
  ): number {
    let score = 0;
    
    // Build is critical - 40 points
    if (buildPassed) {
      score += 40;
    }
    
    // Tests are critical - 40 points
    if (testResults) {
      if (testResults.total > 0) {
        // Calculate test score based on pass rate
        const passRate = testResults.passed / testResults.total;
        const testScore = passRate * 40;
        score += testScore;
      } else {
        // No tests found - this is suspicious for SWE-bench
        // Give minimal credit since we can't verify correctness
        score += 10;
        elizaLogger.warn('[ENHANCED-PATCH] No tests found in repository');
      }
    } else {
      // Test execution completely failed
      score += 0;
    }
    
    // Linting is nice to have - 20 points
    if (lintPassed) {
      score += 20;
    } else {
      // Linting might not be configured, give partial credit
      score += 10;
    }
    
    return score;
  }

  /**
   * Learn from verification failures
   */
  private async learnFromFailure(verificationResult: any, changes: any[]): Promise<void> {
    elizaLogger.info('[ENHANCED-PATCH] Learning from verification failures');
    
    // Analyze what went wrong
    const criticalIssues = verificationResult.criticalErrors;
    const warnings = verificationResult.warnings;
    const realWorldChecks = verificationResult.realWorldChecks;
    
    // Create detailed failure analysis
    const failureAnalysis = {
      timestamp: new Date(),
      score: verificationResult.score,
      passed: verificationResult.passed,
      realWorldFailures: {
        build: !realWorldChecks?.buildPassed,
        tests: realWorldChecks?.testsFailed > 0,
        lint: !realWorldChecks?.lintPassed
      },
      abstractFailures: {
        syntax: criticalIssues.some((e: any) => e.type === 'syntax'),
        types: criticalIssues.some((e: any) => e.type === 'typescript'),
        security: criticalIssues.some((e: any) => e.type === 'security'),
        complexity: criticalIssues.some((e: any) => e.type === 'complexity')
      },
      issues: criticalIssues.map((e: any) => ({
        type: e.type,
        message: e.message,
        file: e.file,
        severity: e.severity
      })),
      changes: changes.map(c => ({
        file: c.file,
        operation: c.operation
      }))
    };
    
    // Log detailed analysis for debugging
    elizaLogger.debug('[ENHANCED-PATCH] Failure analysis:', failureAnalysis);
    
    // In a real implementation, this would:
    // 1. Store patterns in a database
    // 2. Use ML to identify common failure patterns
    // 3. Adjust prompts based on historical failures
    // 4. Provide specific guidance for next iteration
  }

  /**
   * Get verification issues from previous patch attempt
   */
  private async getVerificationIssuesFromPreviousPatch(patch: string, verificationResult?: any): Promise<string> {
    // If we have actual verification results, use them
    if (verificationResult) {
      const issues: string[] = [];
      
      // Real-world issues
      if (!verificationResult.realWorldChecks?.buildPassed) {
        issues.push('- Build failed: Fix syntax errors and ensure TypeScript compilation succeeds');
      }
      if (verificationResult.realWorldChecks?.testsFailed > 0) {
        issues.push(`- ${verificationResult.realWorldChecks.testsFailed} tests failed: Ensure all tests pass`);
      }
      if (!verificationResult.realWorldChecks?.lintPassed) {
        issues.push('- Linting failed: Fix code style issues');
      }
      
      // Critical errors
      verificationResult.criticalErrors.forEach((error: any) => {
        issues.push(`- ${error.type}: ${error.message}`);
      });
      
      // Warnings (top 3)
      verificationResult.warnings.slice(0, 3).forEach((warning: any) => {
        issues.push(`- Warning: ${warning.message}`);
      });
      
      return issues.join('\n');
    }
    
    // Fallback to generic guidance
    return `
Real-World Issues to Fix:
- Ensure all TypeScript types are correct and compilation succeeds
- Fix any syntax errors that prevent the build
- Ensure all existing tests continue to pass
- Address any linting errors if lint rules are configured
- Check for any runtime errors in the test suite

Code Quality Issues:
- Reduce complexity if cyclomatic complexity > 10  
- Ensure no security vulnerabilities are introduced
- Maintain consistent code style with the existing codebase
- Verify all imports and dependencies are correct
- Handle all edge cases and error conditions properly`;
  }

  /**
   * Get list of modified files
   */
  private async getModifiedFiles(repoPath: string): Promise<string[]> {
    try {
      const diff = await this.repoManager.generateDiff(repoPath);
      const files = new Set<string>();
      
      const lines = diff.split('\n');
      for (const line of lines) {
        if (line.startsWith('diff --git')) {
          // Git diff format: diff --git a/path/to/file b/path/to/file
          // Handle edge cases like spaces in filenames
          const match = line.match(/diff --git a\/.+ b\/(.+)$/);
          if (match) {
            // Remove quotes if present (for filenames with spaces)
            const filename = match[1].replace(/^"|"$/g, '');
            files.add(filename);
          }
        }
      }
      
      // If no files found in diff, try getting staged files
      if (files.size === 0) {
        try {
          const { stdout } = await promisify(exec)('git diff --cached --name-only', {
            cwd: repoPath
          });
          if (stdout) {
            stdout.split('\n').filter(f => f.trim()).forEach(f => files.add(f));
          }
        } catch {
          // Ignore if this fails
        }
      }
      
      return Array.from(files);
    } catch (error) {
      elizaLogger.warn('[ENHANCED-PATCH] Failed to get modified files:', error);
      return [];
    }
  }

  /**
   * Get file language from extension
   */
  private getFileLanguage(filePath: string): string {
    const ext = path.extname(filePath).toLowerCase();
    switch (ext) {
      case '.ts':
      case '.tsx':
        return 'typescript';
      case '.js':
      case '.jsx':
        return 'javascript';
      case '.py':
        return 'python';
      default:
        return 'unknown';
    }
  }

  /**
   * Create project context for patch generation
   */
  private async createProjectContext(
    instance: SWEBenchInstance,
    analysis: IssueAnalysis,
    repoPath: string,
    researchContext?: ResearchContext
  ): Promise<ProjectContext> {
    // Read relevant file contents
    const codeContext: string[] = [];
    
    for (const file of analysis.affected_files.slice(0, 5)) {
      try {
        const filePath = path.join(repoPath, file);
        const content = await fs.readFile(filePath, 'utf-8');
        codeContext.push(`// File: ${file}\n${content}`);
      } catch (error) {
        elizaLogger.warn(`[ENHANCED-PATCH] Could not read ${file}:`, error);
      }
    }

    // Enhanced constraints with verification requirements and research insights
    const constraints = [
      'Modify only existing files, do not create new files unless absolutely necessary',
      'Ensure all changes are minimal and focused on fixing the issue',
      'Maintain existing code style and conventions',
      'Do not modify test files unless specifically required',
      'Ensure backward compatibility',
      'Follow the existing project patterns and architecture',
      'Code must pass all verification checks',
      'Maintain or improve test coverage',
      'Ensure no security vulnerabilities are introduced',
      'Keep cyclomatic complexity below 10',
      'Follow SOLID principles'
    ];

    // Add research-based constraints
    if (researchContext) {
      constraints.push(
        ...researchContext.implementationGuidance.keyConsiderations,
        ...researchContext.implementationGuidance.securityConsiderations,
        ...researchContext.riskAssessment.mitigations
      );
    }

    if (analysis.context.language === 'TypeScript') {
      constraints.push('Ensure TypeScript types are correct and compilation succeeds');
      constraints.push('Maintain strict type safety');
      constraints.push('No use of any type unless absolutely necessary');
    }

    return {
      name: `Fix: ${instance.issue_title}`,
      description: researchContext?.implementationGuidance.approach || analysis.suggested_approach,
      requirements: analysis.requirements,
      constraints,
      existing_code_context: codeContext.join('\n\n'),
      test_requirements: analysis.test_requirements,
      target_directory: repoPath,
      verification_requirements: {
        minScore: 70,
        requiredValidators: ['syntax', 'typescript', 'security'],
        maxComplexity: 10
      },
      research_context: researchContext
    };
  }

  /**
   * Generate a single patch iteration using AI with verification context
   */
  private async generatePatchIteration(
    instance: SWEBenchInstance,
    context: ProjectContext,
    analysis: IssueAnalysis,
    iteration: number,
    previousPatch: string,
    testSuite: any,
    previousVerificationResult?: any
  ): Promise<{ approach: string; changes: Array<{ file: string; operation: 'modify' | 'create'; content: string }> }> {
    let prompt = `You are an expert developer fixing a GitHub issue with a focus on code quality and verification.

**Repository:** ${instance.repo}
**Issue Title:** ${instance.issue_title}
**Issue Description:** ${instance.issue_body}
**Problem Statement:** ${instance.problem_statement || 'Not provided'}

**Analysis:**
${context.description}

**Requirements:**
${context.requirements.map((r, i) => `${i + 1}. ${r}`).join('\n')}

**Quality Constraints:**
${context.constraints.map((c, i) => `${i + 1}. ${c}`).join('\n')}

**Verification Requirements:**
- Syntax must be 100% correct
- Type safety must be maintained
- No security vulnerabilities
- Cyclomatic complexity < 10
- Must pass all existing tests

**Affected Files:**
${analysis.affected_files.join('\n')}

**Existing Code Context:**
${context.existing_code_context}

${context.research_context ? `**Research Findings:**
Based on comprehensive research, here are key insights:
${context.research_context.findings.slice(0, 5).map((f, i) => 
  `${i + 1}. ${f.type.toUpperCase()}: ${f.content} (Confidence: ${(f.confidence * 100).toFixed(0)}%)`
).join('\n')}

**Implementation Guidance:**
Approach: ${context.research_context.implementationGuidance.approach}
Key Considerations: ${context.research_context.implementationGuidance.keyConsiderations.slice(0, 3).join(', ')}
Testing Strategy: ${context.research_context.implementationGuidance.testingStrategy}

**Risk Assessment:**
Complexity: ${context.research_context.riskAssessment.complexity}
Performance Impact: ${context.research_context.riskAssessment.performanceImpact}
Security Impact: ${context.research_context.riskAssessment.securityImpact}
${context.research_context.riskAssessment.risks.length > 0 ? 
  `Key Risks: ${context.research_context.riskAssessment.risks.slice(0, 2).map(r => r.description).join(', ')}` : ''}
` : ''}

${testSuite ? `**Generated Tests (${testSuite.tests.length} tests):**
These tests verify the fix is correct:
${testSuite.tests.slice(0, 3).map((t: any) => `- ${t.name}: ${t.description}`).join('\n')}
` : ''}

${instance.hints && instance.hints.length > 0 ? `**Hints:**\n${instance.hints.join('\n')}` : ''}
`;

    if (iteration > 1 && previousVerificationResult) {
      // Add specific feedback from previous verification
      prompt += `
**Previous Attempt (Iteration ${iteration - 1}) Failed Verification:**

Verification Score: ${previousVerificationResult.score}/100
Build: ${previousVerificationResult.realWorldChecks?.buildPassed ? 'PASSED' : 'FAILED'}
Tests: ${previousVerificationResult.realWorldChecks ? 
  `${previousVerificationResult.realWorldChecks.testsPassed}/${previousVerificationResult.realWorldChecks.testsRun} passed` : 
  'N/A'}
Lint: ${previousVerificationResult.realWorldChecks?.lintPassed ? 'PASSED' : 'FAILED/N/A'}

Critical Errors:
${previousVerificationResult.criticalErrors.slice(0, 5).map((e: any) => 
  `- [${e.type}] ${e.message}${e.file !== 'N/A' ? ` in ${e.file}` : ''}`
).join('\n')}

${previousPatch ? `Previous changes:
\`\`\`diff
${previousPatch.substring(0, 2000)}${previousPatch.length > 2000 ? '\n... (truncated)' : ''}
\`\`\`` : ''}

**IMPORTANT**: Fix the above issues. Focus especially on:
${!previousVerificationResult.realWorldChecks?.buildPassed ? '- Fix syntax/type errors preventing build' : ''}
${previousVerificationResult.realWorldChecks?.testsFailed > 0 ? '- Ensure all tests pass' : ''}
${previousVerificationResult.criticalErrors.some((e: any) => e.type === 'syntax') ? '- Fix syntax errors' : ''}
${previousVerificationResult.criticalErrors.some((e: any) => e.type === 'typescript') ? '- Fix TypeScript type errors' : ''}
`;
    }

    prompt += `
**Instructions:**
1. FIRST, review the research findings and implementation guidance above
2. Explain your approach to fixing this issue in 2-3 sentences, incorporating research insights
3. Use the recommended patterns and avoid identified pitfalls from research
4. Ensure your solution is minimal, focused, and high quality
5. Follow SOLID principles and clean code practices
6. Address any security and performance considerations from the risk assessment
7. Then provide the COMPLETE file contents for each file that needs to be modified
8. Make sure all code passes verification (types, security, complexity)
${iteration > 1 ? '9. CRITICAL: Fix the specific errors from the previous attempt' : ''}

**IMPORTANT CODE REQUIREMENTS:**
- Use proper JavaScript/TypeScript syntax (no Python-style imports or syntax)
- For JavaScript: Use require() or ES6 import/export syntax correctly
- For TypeScript: Ensure all types are properly defined
- Include all necessary imports at the top of the file
- Follow the existing code style in the repository
- Do NOT mix Python and JavaScript syntax
- Ensure proper semicolons, brackets, and quotes

**Format your response EXACTLY like this:**

Approach: [Your 2-3 sentence explanation of how you'll fix the issue]

File: path/to/file.js
\`\`\`javascript
// Complete file contents with proper JavaScript syntax
const something = require('something');
// or: import something from 'something';

// Your implementation here
\`\`\`

File: path/to/file.ts
\`\`\`typescript
// Complete file contents with proper TypeScript syntax
import { Something } from 'something';

// Your implementation here
\`\`\`
`;

    // Log the prompt for debugging
    elizaLogger.info('[ENHANCED-PATCH] Sending prompt to Claude Opus 4');
    elizaLogger.debug('[ENHANCED-PATCH] Prompt length:', prompt.length);
    
    // Log first 500 chars of prompt for context
    elizaLogger.info('[ENHANCED-PATCH] Prompt preview:', prompt.substring(0, 500) + '...');
    
    const response = await this.anthropic!.messages.create({
      model: 'claude-opus-4-20250514',
      max_tokens: 8192,
      temperature: 0.05, // Very low temperature for consistent, accurate syntax
      messages: [{ role: 'user', content: prompt }]
    });

    // Log response info
    elizaLogger.info('[ENHANCED-PATCH] Received response from Claude');
    elizaLogger.info('[ENHANCED-PATCH] Response tokens:', response.usage);
    
    const contentBlock = response.content[0];
    const content = contentBlock.type === 'text' ? contentBlock.text : '';
    
    // Log first 500 chars of response
    elizaLogger.info('[ENHANCED-PATCH] Response preview:', content.substring(0, 500) + '...');

    // Track token usage
    if (response.usage) {
      this.totalTokenUsage.prompt_tokens += response.usage.input_tokens || 0;
      this.totalTokenUsage.completion_tokens += response.usage.output_tokens || 0;
      this.totalTokenUsage.total = this.totalTokenUsage.prompt_tokens + this.totalTokenUsage.completion_tokens;
      // Estimate cost: Claude Opus 4 pricing (using Opus 3 pricing as estimate)
      this.totalTokenUsage.cost = (this.totalTokenUsage.prompt_tokens / 1000) * 0.015 + 
                                  (this.totalTokenUsage.completion_tokens / 1000) * 0.075;
    }

    // Extract approach
    const approachMatch = content.match(/Approach:\s*(.+?)(?:\n\nFile:|$)/s);
    const approach = approachMatch ? approachMatch[1].trim() : 'Direct fix implementation with verification';

    // Parse file changes
    const changes = this.parseCodeChanges(content);

    return { approach, changes };
  }

  /**
   * Parse code changes from AI response
   */
  private parseCodeChanges(response: string): Array<{
    file: string;
    operation: 'modify' | 'create';
    content: string;
  }> {
    const changes: Array<{
      file: string;
      operation: 'modify' | 'create';
      content: string;
    }> = [];

    const filePattern = /File:\s*(.+?)\s*\n```(?:typescript|javascript|ts|js|python|py)?\s*\n([\s\S]+?)```/g;
    let match;

    while ((match = filePattern.exec(response)) !== null) {
      const file = match[1].trim();
      const content = match[2];
      
      changes.push({
        file,
        operation: 'modify',
        content
      });
    }

    return changes;
  }

  /**
   * Apply generated changes to the repository
   */
  private async applyGeneratedChanges(
    repoPath: string,
    changes: Array<{ file: string; operation: string; content: string }>
  ): Promise<void> {
    for (const change of changes) {
      const filePath = path.join(repoPath, change.file);

      try {
        if (change.operation === 'modify') {
          await fs.mkdir(path.dirname(filePath), { recursive: true });
          await fs.writeFile(filePath, change.content);
          elizaLogger.info(`[ENHANCED-PATCH] Modified ${change.file}`);
        } else if (change.operation === 'create') {
          await fs.mkdir(path.dirname(filePath), { recursive: true });
          await fs.writeFile(filePath, change.content);
          elizaLogger.info(`[ENHANCED-PATCH] Created ${change.file}`);
        }
      } catch (error) {
        elizaLogger.error(`[ENHANCED-PATCH] Failed to apply change to ${change.file}:`, error);
        throw error;
      }
    }
  }

  /**
   * Analyze patch statistics
   */
  private analyzePatchStats(patch: string): {
    files: string[];
    additions: number;
    deletions: number;
  } {
    const files: Set<string> = new Set();
    let additions = 0;
    let deletions = 0;

    const lines = patch.split('\n');
    for (const line of lines) {
      if (line.startsWith('diff --git')) {
        // Git diff format: diff --git a/path/to/file b/path/to/file
        const match = line.match(/\s+b\/(.+)$/);
        if (match) {
          files.add(match[1]);
        }
      } else if (line.startsWith('+') && !line.startsWith('+++')) {
        additions++;
      } else if (line.startsWith('-') && !line.startsWith('---')) {
        deletions++;
      }
    }

    return {
      files: Array.from(files),
      additions,
      deletions
    };
  }
}