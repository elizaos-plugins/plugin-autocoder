import { elizaLogger } from '@elizaos/core';
import * as fs from 'fs/promises';
import * as path from 'path';
import { query, type SDKMessage } from "@anthropic-ai/claude-code";
import type { 
  SWEBenchInstance, 
  IssueAnalysis, 
  GeneratedPatch,
  ProjectContext 
} from './types';
import { IssueAnalyzer } from './issue-analyzer';
import { RepositoryManager } from './repository-manager';
import { ResearchIntegration } from '../research/research-integration';
import { promisify } from 'util';
import { exec } from 'child_process';

/**
 * Claude Code SDK-based patch generator for SWE-bench
 * Uses Claude Code's built-in capabilities for code generation and editing
 */
export class ClaudeCodePatchGenerator {
  private researchIntegration: ResearchIntegration;

  constructor(
    private runtime: any, // IAgentRuntime
    private issueAnalyzer: IssueAnalyzer,
    private repoManager: RepositoryManager
  ) {
    this.researchIntegration = new ResearchIntegration(runtime);
  }

  /**
   * Generate a patch using Claude Code SDK
   */
  async generatePatch(
    instance: SWEBenchInstance, 
    repoPath: string
  ): Promise<GeneratedPatch> {
    elizaLogger.info(`[CLAUDE-CODE-PATCH] Generating patch for ${instance.instance_id} using Claude Code SDK`);
    
    // Phase 1: Research the issue
    elizaLogger.info('[CLAUDE-CODE-PATCH] Phase 1: Researching the issue');
    const researchContext = await this.researchIntegration.researchIssue(instance);
    elizaLogger.info(`[CLAUDE-CODE-PATCH] Research completed with ${researchContext.findings.length} findings`);

    // Phase 2: Analyze the issue
    elizaLogger.info('[CLAUDE-CODE-PATCH] Phase 2: Analyzing the issue');
    const analysis = await this.issueAnalyzer.analyzeIssue(instance, repoPath);
    
    // Phase 3: Prepare the prompt for Claude Code
    const prompt = this.buildClaudeCodePrompt(instance, analysis, researchContext);
    
    // Phase 4: Use Claude Code SDK to generate the fix
    elizaLogger.info('[CLAUDE-CODE-PATCH] Phase 4: Generating fix with Claude Code SDK');
    
    const messages: SDKMessage[] = [];
    let sessionId: string | null = null;
    let totalCost = 0;
    let iterations = 0;
    const maxIterations = analysis.complexity === 'high' ? 8 : 5;
    
    try {
      // Configure Claude Code options for comprehensive code modification
      const options = {
        maxTurns: Math.max(maxIterations, 8), // Ensure at least 8 turns for complex fixes
        cwd: repoPath,
        allowedTools: ["Read", "Write", "Edit", "Bash", "LS"], // Include Edit tool for better modifications
        permissionMode: "acceptEdits" as const,
      };
      
      elizaLogger.info('[CLAUDE-CODE-PATCH] Starting Claude Code session with options:', {
        maxTurns: options.maxTurns,
        cwd: options.cwd,
        allowedTools: options.allowedTools
      });
      
      // Run Claude Code with better error handling
      const abortController = new AbortController();
      
      try {
        for await (const message of query({
          prompt: prompt + '\n\n' + this.buildSystemPrompt(analysis),
          abortController,
          options
        })) {
        messages.push(message);
        
        // Track session and costs
        if (message.type === 'system' && message.subtype === 'init') {
          sessionId = message.session_id;
          elizaLogger.info(`[CLAUDE-CODE-PATCH] Session started: ${sessionId}`);
        } else if (message.type === 'result') {
          iterations = message.num_turns;
          totalCost = message.total_cost_usd;
          elizaLogger.info(`[CLAUDE-CODE-PATCH] Session completed: ${iterations} turns, $${totalCost.toFixed(4)}`);
        } else if (message.type === 'assistant') {
          // Log assistant actions
          const content = message.message.content;
          if (Array.isArray(content)) {
            for (const block of content) {
              if (block.type === 'tool_use') {
                elizaLogger.info(`[CLAUDE-CODE-PATCH] Tool use: ${block.name}`);
              }
            }
          }
        }
        }
      } catch (queryError) {
        elizaLogger.error('[CLAUDE-CODE-PATCH] Claude Code query error:', queryError);
        throw new Error(`Claude Code session failed: ${queryError.message}`);
      }
      
      // Phase 5: Verify the generated fix
      elizaLogger.info('[CLAUDE-CODE-PATCH] Phase 5: Verifying the fix');
      const verificationResult = await this.verifyFix(repoPath, instance);
      
      // Phase 6: Generate the final patch
      let patch = await this.repoManager.generateDiff(repoPath);
      let modifiedFiles = await this.getModifiedFiles(repoPath);
      
      elizaLogger.info(`[CLAUDE-CODE-PATCH] Initial patch generation - patch length: ${patch.length}, files: ${modifiedFiles.length}`);
      
      // If no changes were made, try one more attempt with more specific guidance
      if (!patch || patch.trim() === '') {
        elizaLogger.warn('[CLAUDE-CODE-PATCH] No changes detected, attempting focused fix...');
        
        const focusedPrompt = this.buildFocusedPrompt(instance, analysis);
        
        try {
          for await (const message of query({
            prompt: focusedPrompt,
            abortController: new AbortController(),
            options: {
              maxTurns: 5,
              cwd: repoPath,
              allowedTools: ["Read", "Write", "Edit", "Bash"],
              permissionMode: "acceptEdits" as const,
            }
          })) {
            if (message.type === 'result') {
              totalCost += message.total_cost_usd;
              iterations += message.num_turns;
              elizaLogger.info(`[CLAUDE-CODE-PATCH] Focused session completed: ${message.num_turns} additional turns, total cost: $${totalCost.toFixed(4)}`);
            }
          }
        } catch (focusedError) {
          elizaLogger.warn(`[CLAUDE-CODE-PATCH] Focused fix attempt failed: ${focusedError.message}`);
        }
        
        // Check for changes again
        patch = await this.repoManager.generateDiff(repoPath);
        modifiedFiles = await this.getModifiedFiles(repoPath);
        elizaLogger.info(`[CLAUDE-CODE-PATCH] After focused fix - patch length: ${patch.length}, files: ${modifiedFiles.length}`);
      }
      
      const stats = this.calculatePatchStats(patch);
      elizaLogger.info(`[CLAUDE-CODE-PATCH] Patch stats - additions: ${stats.additions}, deletions: ${stats.deletions}`);
      
      return {
        patch,
        files_modified: modifiedFiles,
        additions: stats.additions,
        deletions: stats.deletions,
        iteration_count: iterations,
        approach_description: `Claude Code SDK automated fix with ${iterations} iterations${modifiedFiles.length === 0 ? ' (no changes made)' : ''}`,
        verification_score: verificationResult.score,
        verification_passed: verificationResult.passed,
        real_world_checks: verificationResult.realWorldChecks,
        test_coverage: verificationResult.testCoverage,
        token_usage: {
          prompt_tokens: 0, // Claude Code SDK doesn't provide token breakdown
          completion_tokens: 0,
          total: 0,
          cost: totalCost
        }
      };
      
    } catch (error) {
      elizaLogger.error('[CLAUDE-CODE-PATCH] Error during patch generation:', error);
      throw error;
    }
  }

  /**
   * Build the main prompt for Claude Code
   */
  private buildClaudeCodePrompt(
    instance: SWEBenchInstance,
    analysis: IssueAnalysis,
    researchContext: any
  ): string {
    return `You must fix the following GitHub issue in the ${instance.repo} repository. This is a SWE-bench evaluation task that requires you to make actual code changes to resolve the issue.

**CRITICAL: You MUST make code changes. Simply reading the code is not sufficient - you need to modify files to fix the issue.**

**Issue Title:** ${instance.issue_title}
**Issue Description:** ${instance.issue_body}

**Problem Statement:** ${instance.problem_statement || 'See issue description above'}

**Research Findings:**
${researchContext.findings.slice(0, 5).map((f: any, i: number) => 
  `${i + 1}. ${f.type.toUpperCase()}: ${f.content} (Confidence: ${(f.confidence * 100).toFixed(0)}%)`
).join('\n')}

**Implementation Guidance:**
- Approach: ${researchContext.implementationGuidance.approach}
- Key Considerations: ${researchContext.implementationGuidance.keyConsiderations.slice(0, 3).join(', ')}
- Testing Strategy: ${researchContext.implementationGuidance.testingStrategy}

**Files that likely need changes:**
${analysis.affected_files.join('\n')}

**Requirements you must fulfill:**
${analysis.requirements.map((r, i) => `${i + 1}. ${r}`).join('\n')}

${instance.hints && instance.hints.length > 0 ? `**Hints:**\n${instance.hints.join('\n')}` : ''}

**MANDATORY ACTION PLAN (TEST-FIRST DEVELOPMENT):**
1. **Explore**: Use Read tool to understand the codebase structure and locate relevant files
2. **Write Failing Test**: Create a test that reproduces the reported issue (this test should fail initially)
3. **Analyze**: Identify the exact root cause by running the failing test
4. **Implement Fix**: Use Write tool to make the minimal code changes needed to make the test pass
5. **Verify**: Run all tests to ensure your fix works and doesn't break existing functionality
6. **Complete**: Ensure you've made actual code modifications and all tests pass

**TEST-FIRST REQUIREMENTS:**
- You MUST write a test that demonstrates the issue before fixing it
- The test should fail initially, proving the bug exists
- Your fix should make this test (and all existing tests) pass
- This follows proper TDD (Test-Driven Development) methodology

**EVALUATION CRITERIA:**
- You will be evaluated on whether your changes fix the reported issue
- You must write a test that proves the issue exists and then fixes it
- Your solution must pass ALL tests (existing + your new test)
- You must make actual code modifications (not just suggestions)
- The fix should be minimal but complete and well-tested

**Language**: Use proper ${analysis.context.language} syntax and follow the existing code style.

Remember: This is a coding task that requires you to actually modify source code files. Reading and analysis alone is insufficient.`;
  }

  /**
   * Build a focused prompt for when the first attempt didn't make changes
   */
  private buildFocusedPrompt(
    instance: SWEBenchInstance,
    analysis: IssueAnalysis
  ): string {
    return `CRITICAL: The previous attempt to fix this issue made no code changes. You MUST now make actual modifications to fix the issue.

**Issue**: ${instance.issue_title}
**Problem**: ${instance.problem_statement || instance.issue_body}

**SPECIFIC FILES TO MODIFY** (based on analysis):
${analysis.affected_files.map(file => `- ${file}`).join('\n')}

**YOU MUST:**
1. Choose ONE of the files above that is most relevant to the issue
2. Use the Read tool to examine that file
3. Use the Write or Edit tool to make the necessary changes
4. Test your changes with the Bash tool

**EXAMPLE WORKFLOW:**
1. Read ${analysis.affected_files[0] || 'the main file'}
2. Identify the specific lines that cause the issue
3. Write/Edit the file with the fix
4. Run tests to verify the fix

**CONSTRAINT**: You CANNOT complete this task without making code changes. Reading files is not sufficient.

**FOCUS**: Look for specific code patterns mentioned in the issue description and modify them accordingly.

Start by reading the most relevant file and then immediately make the necessary changes.`;
  }

  /**
   * Build the system prompt for Claude Code
   */
  private buildSystemPrompt(analysis: IssueAnalysis): string {
    const language = analysis.context.language === 'typescript' ? 'TypeScript' : 'JavaScript';
    
    return `You are an expert ${language} developer fixing GitHub issues. Follow these principles:

1. **Code Quality**: Write clean, maintainable code following SOLID principles
2. **Minimal Changes**: Make only the necessary changes to fix the issue
3. **Compatibility**: Ensure backward compatibility and don't break existing functionality
4. **Testing**: Ensure all existing tests pass after your changes
5. **Style**: Follow the existing code style and conventions in the repository
6. **Security**: Don't introduce any security vulnerabilities
7. **Performance**: Consider performance implications of your changes

When exploring the codebase:
- Use the Read tool to understand the code structure
- Look for existing patterns and follow them
- Check test files to understand expected behavior

When implementing fixes:
- Use the Write tool to modify files
- Make atomic, focused changes
- Add comments only when necessary for clarity

When verifying:
- Use the Bash tool to run tests and build commands
- Ensure the build passes before finishing
- Run relevant tests to verify your fix`;
  }

  /**
   * Verify the generated fix
   */
  private async verifyFix(
    repoPath: string,
    instance: SWEBenchInstance
  ): Promise<any> {
    elizaLogger.info('[CLAUDE-CODE-PATCH] Starting fix verification');
    
    // Run build check
    const buildPassed = await this.repoManager.checkBuild(repoPath);
    elizaLogger.info(`[CLAUDE-CODE-PATCH] Build check: ${buildPassed ? 'PASSED' : 'FAILED'}`);
    
    // Run tests
    let testResults: any = null;
    try {
      testResults = await this.repoManager.runTests(repoPath);
      elizaLogger.info(`[CLAUDE-CODE-PATCH] Tests: ${testResults.passed}/${testResults.total} passed`);
    } catch (error) {
      elizaLogger.error('[CLAUDE-CODE-PATCH] Test execution failed:', error);
      testResults = {
        total: 0,
        passed: 0,
        failed: 0,
        skipped: 0
      };
    }
    
    // Calculate verification score
    const score = this.calculateVerificationScore(buildPassed, testResults);
    const passed = buildPassed && testResults && testResults.failed === 0 && score >= 70;
    
    return {
      score,
      passed,
      realWorldChecks: {
        buildPassed,
        testsRun: testResults ? testResults.total : 0,
        testsPassed: testResults ? testResults.passed : 0,
        testsFailed: testResults ? testResults.failed : 0
      },
      testCoverage: testResults ? testResults.total : 0
    };
  }

  /**
   * Calculate verification score
   */
  private calculateVerificationScore(buildPassed: boolean, testResults: any): number {
    let score = 0;
    
    // Build is worth 40 points
    if (buildPassed) {
      score += 40;
    }
    
    // Tests are worth 60 points
    if (testResults && testResults.total > 0) {
      const passRate = testResults.passed / testResults.total;
      score += passRate * 60;
    } else if (buildPassed) {
      // If no tests but build passes, give partial credit
      score += 30;
    }
    
    return Math.round(score);
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
          const match = line.match(/diff --git a\/.+ b\/(.+)$/);
          if (match) {
            const filename = match[1].replace(/^"|"$/g, '');
            files.add(filename);
          }
        }
      }
      
      return Array.from(files);
    } catch (error) {
      elizaLogger.warn('[CLAUDE-CODE-PATCH] Failed to get modified files:', error);
      return [];
    }
  }

  /**
   * Calculate patch statistics
   */
  private calculatePatchStats(patch: string): {
    additions: number;
    deletions: number;
  } {
    let additions = 0;
    let deletions = 0;

    const lines = patch.split('\n');
    for (const line of lines) {
      if (line.startsWith('+') && !line.startsWith('+++')) {
        additions++;
      } else if (line.startsWith('-') && !line.startsWith('---')) {
        deletions++;
      }
    }

    return { additions, deletions };
  }

  /**
   * Alternative method: Use Claude Code in multi-turn conversation mode
   */
  async generatePatchWithConversation(
    instance: SWEBenchInstance,
    repoPath: string
  ): Promise<GeneratedPatch> {
    elizaLogger.info('[CLAUDE-CODE-PATCH] Using conversation mode for complex issue');
    
    // Research and analyze
    const researchContext = await this.researchIntegration.researchIssue(instance);
    const analysis = await this.issueAnalyzer.analyzeIssue(instance, repoPath);
    
    const messages: SDKMessage[] = [];
    let sessionId: string | null = null;
    let totalCost = 0;
    
    // Initial prompt
    const initialPrompt = this.buildClaudeCodePrompt(instance, analysis, researchContext);
    
    // Start conversation
    for await (const message of query({
      prompt: initialPrompt + '\n\n' + this.buildSystemPrompt(analysis),
      abortController: new AbortController(),
      options: {
        maxTurns: 3,
        cwd: repoPath,
        allowedTools: ["Read", "Write", "Bash"],
      }
    })) {
      messages.push(message);
      
      if (message.type === 'system' && message.subtype === 'init') {
        sessionId = message.session_id;
      } else if (message.type === 'result') {
        totalCost = message.total_cost_usd;
        
        // If not successful, continue the conversation
        if (!message.is_error && sessionId) {
          // Verify current state
          const verification = await this.verifyFix(repoPath, instance);
          
          if (!verification.passed) {
            // Continue with feedback
            const feedbackPrompt = `The fix didn't pass verification. Here are the issues:
              
Build: ${verification.realWorldChecks.buildPassed ? 'PASSED' : 'FAILED'}
Tests: ${verification.realWorldChecks.testsPassed}/${verification.realWorldChecks.testsRun} passed

Please fix these issues and ensure all tests pass.`;
            
            // Resume the conversation
            for await (const followUpMessage of query({
              prompt: feedbackPrompt,
              abortController: new AbortController(),
              options: {
                resume: sessionId,
                maxTurns: 2,
                allowedTools: ["Read", "Write", "Bash"],
              }
            })) {
              messages.push(followUpMessage);
              
              if (followUpMessage.type === 'result') {
                totalCost += followUpMessage.total_cost_usd;
              }
            }
          }
        }
      }
    }
    
    // Generate final patch
    const patch = await this.repoManager.generateDiff(repoPath);
    const modifiedFiles = await this.getModifiedFiles(repoPath);
    const stats = this.calculatePatchStats(patch);
    const finalVerification = await this.verifyFix(repoPath, instance);
    
    return {
      patch,
      files_modified: modifiedFiles,
      additions: stats.additions,
      deletions: stats.deletions,
      iteration_count: messages.filter(m => m.type === 'assistant').length,
      approach_description: 'Claude Code SDK conversation mode',
      verification_score: finalVerification.score,
      verification_passed: finalVerification.passed,
      real_world_checks: finalVerification.realWorldChecks,
      test_coverage: finalVerification.testCoverage,
      token_usage: {
        prompt_tokens: 0,
        completion_tokens: 0,
        total: 0,
        cost: totalCost
      }
    };
  }
} 