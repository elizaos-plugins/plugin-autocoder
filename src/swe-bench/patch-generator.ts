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

/**
 * Generates patches for SWE-bench instances using AI
 */
export class PatchGenerator {
  private anthropic: Anthropic | null = null;

  constructor(
    private runtime: any, // IAgentRuntime
    private issueAnalyzer: IssueAnalyzer,
    private repoManager: RepositoryManager
  ) {
    const apiKey = runtime.getSetting('ANTHROPIC_API_KEY');
    if (apiKey) {
      this.anthropic = new Anthropic({ apiKey });
    }
  }

  /**
   * Generate a patch for a SWE-bench instance
   */
  async generatePatch(
    instance: SWEBenchInstance, 
    repoPath: string
  ): Promise<GeneratedPatch> {
    elizaLogger.info(`[PATCH-GENERATOR] Generating patch for ${instance.instance_id}`);

    if (!this.anthropic) {
      throw new Error('Anthropic API key not configured');
    }

    // Analyze the issue
    const analysis = await this.issueAnalyzer.analyzeIssue(instance, repoPath);
    
    // Create project context
    const projectContext = await this.createProjectContext(instance, analysis, repoPath);
    
    let iterations = 0;
    const maxIterations = 5;
    let approach = '';
    let lastPatch = '';

    // Iterative patch generation
    while (iterations < maxIterations) {
      iterations++;
      elizaLogger.info(`[PATCH-GENERATOR] Running iteration ${iterations}`);

      try {
        // Generate patch using AI
        const result = await this.generatePatchIteration(
          instance, 
          projectContext, 
          analysis,
          iterations,
          lastPatch
        );
        
        if (!approach) {
          approach = result.approach;
        }

        // Apply the patch
        await this.applyGeneratedChanges(repoPath, result.changes);
        
        // Generate diff
        lastPatch = await this.repoManager.generateDiff(repoPath);
        
        // Check if build/tests pass
        const buildSuccess = await this.repoManager.checkBuild(repoPath);
        if (buildSuccess && instance.test_patch) {
          const testResults = await this.repoManager.runTests(repoPath, instance.test_patch);
          if (testResults.failed === 0) {
            elizaLogger.info('[PATCH-GENERATOR] Tests pass, patch complete');
            break;
          }
        } else if (buildSuccess && !instance.test_patch) {
          // If no test patch, just ensure it builds
          elizaLogger.info('[PATCH-GENERATOR] Build successful, patch complete');
          break;
        }
      } catch (error) {
        elizaLogger.error(`[PATCH-GENERATOR] Iteration ${iterations} failed:`, error);
        if (iterations === maxIterations) {
          throw error;
        }
      }
    }

    // Get final patch
    const finalPatch = await this.repoManager.generateDiff(repoPath);
    const stats = this.analyzePatchStats(finalPatch);
    
    return {
      patch: finalPatch,
      files_modified: stats.files,
      additions: stats.additions,
      deletions: stats.deletions,
      iteration_count: iterations,
      approach_description: approach
    };
  }

  /**
   * Create project context for patch generation
   */
  private async createProjectContext(
    instance: SWEBenchInstance,
    analysis: IssueAnalysis,
    repoPath: string
  ): Promise<ProjectContext> {
    // Read relevant file contents
    const codeContext: string[] = [];
    
    for (const file of analysis.affected_files.slice(0, 5)) {
      try {
        const filePath = path.join(repoPath, file);
        const content = await fs.readFile(filePath, 'utf-8');
        codeContext.push(`// File: ${file}\n${content}`);
      } catch (error) {
        elizaLogger.warn(`[PATCH-GENERATOR] Could not read ${file}:`, error);
      }
    }

    // Build constraints based on repository
    const constraints = [
      'Modify only existing files, do not create new files unless absolutely necessary',
      'Ensure all changes are minimal and focused on fixing the issue',
      'Maintain existing code style and conventions',
      'Do not modify test files unless specifically required',
      'Ensure backward compatibility',
      'Follow the existing project patterns and architecture'
    ];

    if (analysis.context.language === 'TypeScript') {
      constraints.push('Ensure TypeScript types are correct and compilation succeeds');
      constraints.push('Maintain strict type safety');
    }

    return {
      name: `Fix: ${instance.issue_title}`,
      description: analysis.suggested_approach,
      requirements: analysis.requirements,
      constraints,
      existing_code_context: codeContext.join('\n\n'),
      test_requirements: analysis.test_requirements,
      target_directory: repoPath
    };
  }

  /**
   * Generate a single patch iteration using AI
   */
  private async generatePatchIteration(
    instance: SWEBenchInstance,
    context: ProjectContext,
    analysis: IssueAnalysis,
    iteration: number,
    previousPatch: string
  ): Promise<{ approach: string; changes: Array<{ file: string; operation: 'modify' | 'create'; content: string }> }> {
    let prompt = `You are an expert developer fixing a GitHub issue.

**Repository:** ${instance.repo}
**Issue Title:** ${instance.issue_title}
**Issue Description:** ${instance.issue_body}
**Problem Statement:** ${instance.problem_statement || 'Not provided'}

**Analysis:**
${context.description}

**Requirements:**
${context.requirements.map((r, i) => `${i + 1}. ${r}`).join('\n')}

**Constraints:**
${context.constraints.map((c, i) => `${i + 1}. ${c}`).join('\n')}

**Affected Files:**
${analysis.affected_files.join('\n')}

**Existing Code Context:**
${context.existing_code_context}

${analysis.test_requirements ? `**Test Requirements:**\n${analysis.test_requirements.join('\n')}` : ''}

${instance.hints && instance.hints.length > 0 ? `**Hints:**\n${instance.hints.join('\n')}` : ''}

`;

    if (iteration > 1 && previousPatch) {
      prompt += `\n**Previous Attempt (Iteration ${iteration - 1}):**
The previous patch was applied but tests still fail. Here's what was changed:

\`\`\`diff
${previousPatch.substring(0, 2000)}${previousPatch.length > 2000 ? '\n... (truncated)' : ''}
\`\`\`

Please analyze what might be wrong and provide a corrected solution.
`;
    }

    prompt += `
**Instructions:**
1. First, explain your approach to fixing this issue in 2-3 sentences
2. Then provide the COMPLETE file contents for each file that needs to be modified
3. Use the exact format shown below for each file
4. Make sure to include ALL necessary imports and code
5. Focus on fixing the specific issue described

**Format your response EXACTLY like this:**

Approach: [Your 2-3 sentence explanation of how you'll fix the issue]

File: path/to/file.ts
\`\`\`typescript
[Complete file contents]
\`\`\`

File: path/to/another/file.js
\`\`\`javascript
[Complete file contents]
\`\`\`
`;

    const response = await this.anthropic!.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 8192,
      temperature: 0.2,
      messages: [{ role: 'user', content: prompt }]
    });

    const responseText = response.content
      .filter(c => c.type === 'text')
      .map(c => c.text)
      .join('\n');

    // Extract approach
    const approachMatch = responseText.match(/Approach:\s*(.+?)(?:\n\nFile:|$)/s);
    const approach = approachMatch ? approachMatch[1].trim() : 'Direct fix implementation';

    // Parse file changes
    const changes = this.parseCodeChanges(responseText);

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

    // Updated regex to handle various formats
    const filePattern = /File:\s*(.+?)\s*\n```(?:typescript|javascript|ts|js|python|py)?\s*\n([\s\S]+?)```/g;
    let match;

    while ((match = filePattern.exec(response)) !== null) {
      const file = match[1].trim();
      const content = match[2];
      
      changes.push({
        file,
        operation: 'modify', // For SWE-bench, we mostly modify existing files
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
          // Ensure directory exists
          await fs.mkdir(path.dirname(filePath), { recursive: true });
          
          // Write the new content
          await fs.writeFile(filePath, change.content);
          elizaLogger.info(`[PATCH-GENERATOR] Modified ${change.file}`);
        } else if (change.operation === 'create') {
          // Ensure directory exists
          await fs.mkdir(path.dirname(filePath), { recursive: true });
          
          // Create new file
          await fs.writeFile(filePath, change.content);
          elizaLogger.info(`[PATCH-GENERATOR] Created ${change.file}`);
        }
      } catch (error) {
        elizaLogger.error(`[PATCH-GENERATOR] Failed to apply change to ${change.file}:`, error);
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
        const match = line.match(/b\/(.+)$/);
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