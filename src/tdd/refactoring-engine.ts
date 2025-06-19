import { elizaLogger } from '@elizaos/core';
import Anthropic from '@anthropic-ai/sdk';
import type { Implementation, RefactoringSuggestion } from './types';

export interface RefactoringOptions {
  maintainTestCompatibility: boolean;
  improvePerformance: boolean;
  reduceComplexity: boolean;
  enhanceReadability: boolean;
  eliminateDuplication: boolean;
}

/**
 * AI-powered refactoring engine
 */
export class RefactoringEngine {
  private anthropic: Anthropic | null = null;

  constructor(private runtime: any) {
    const apiKey = runtime.getSetting('ANTHROPIC_API_KEY');
    if (apiKey) {
      this.anthropic = new Anthropic({ apiKey });
    }
  }

  /**
   * Suggest refactorings for implementation
   */
  async suggestRefactorings(
    implementation: Implementation,
    options: RefactoringOptions
  ): Promise<RefactoringSuggestion[]> {
    elizaLogger.info('[REFACTOR] Analyzing code for refactoring opportunities');
    
    if (!this.anthropic) {
      return [];
    }

    const prompt = `Analyze the following code and suggest refactorings:

${implementation.files.map(f => `
File: ${f.path}
\`\`\`typescript
${f.content}
\`\`\`
`).join('\n')}

Refactoring Goals:
- Maintain test compatibility: ${options.maintainTestCompatibility}
- Improve performance: ${options.improvePerformance}
- Reduce complexity: ${options.reduceComplexity}
- Enhance readability: ${options.enhanceReadability}
- Eliminate duplication: ${options.eliminateDuplication}

For each refactoring suggestion, provide:
1. Type (extract-method, rename, etc.)
2. Description
3. Before and after code
4. Benefits
5. Risks
6. Confidence score (0-1)

Return as JSON array.`;

    const response = await this.anthropic.messages.create({
      model: 'claude-opus-4-20250514',
      max_tokens: 4000,
      messages: [{
        role: 'user',
        content: prompt
      }],
      temperature: 0.3
    });

    const content = response.content[0];
    if (content.type !== 'text') {
      return [];
    }

    return this.parseRefactorings(content.text);
  }

  /**
   * Apply a refactoring to the implementation
   */
  async applyRefactoring(
    implementation: Implementation,
    refactoring: RefactoringSuggestion
  ): Promise<Implementation> {
    elizaLogger.info(`[REFACTOR] Applying ${refactoring.type}: ${refactoring.description}`);
    
    // Clone implementation
    const updated = JSON.parse(JSON.stringify(implementation));
    
    // Apply the refactoring
    // This is simplified - in reality would need proper AST manipulation
    for (const file of updated.files) {
      if (file.content.includes(refactoring.before)) {
        file.content = file.content.replace(refactoring.before, refactoring.after);
      }
    }
    
    return updated;
  }

  /**
   * Parse refactoring suggestions from AI response
   */
  private parseRefactorings(response: string): RefactoringSuggestion[] {
    try {
      const jsonMatch = response.match(/\[[\s\S]*\]/);
      if (!jsonMatch) {
        return [];
      }

      const parsed = JSON.parse(jsonMatch[0]);

      return parsed.map((r: any) => ({
        type: r.type || 'unknown',
        description: r.description,
        before: r.before || '',
        after: r.after || '',
        benefits: r.benefits || [],
        risks: r.risks || [],
        confidence: r.confidence || 0.5
      }));
    } catch (error) {
      elizaLogger.error('[REFACTOR] Failed to parse refactorings:', error);
      return [];
    }
  }
}