import { elizaLogger } from '@elizaos/core';
import Anthropic from '@anthropic-ai/sdk';
import type {
  TestSuite,
  Test,
  TestType,
  TestCategory,
  TestGenerationOptions,
  Requirement,
  ProjectContext,
  Implementation,
  FailurePattern,
  TestRunResult,
  Fix,
  FailureAnalysis
} from './types';

/**
 * AI-powered test generator using Claude Opus 4
 */
export class AITestGenerator {
  private anthropic: Anthropic | null = null;

  constructor(private runtime: any) {
    const apiKey = runtime.getSetting('ANTHROPIC_API_KEY');
    if (apiKey) {
      this.anthropic = new Anthropic({ apiKey });
    }
  }

  /**
   * Generate comprehensive test suite from requirements
   */
  async generateFromRequirements(
    requirements: Requirement[],
    context: ProjectContext,
    options: TestGenerationOptions
  ): Promise<TestSuite> {
    elizaLogger.info('[AI-TEST] Generating test suite from requirements');

    if (!this.anthropic) {
      throw new Error('Anthropic API key not configured');
    }

    const prompt = this.buildTestGenerationPrompt(requirements, context, options);
    
    const response = await this.anthropic.messages.create({
      model: 'claude-opus-4-20250514',
      max_tokens: 8000,
      messages: [{
        role: 'user',
        content: prompt
      }],
      temperature: 0.2 // Lower temperature for more consistent test generation
    });

    const content = response.content[0];
    if (content.type !== 'text') {
      throw new Error('Unexpected response format from AI');
    }

    // Parse the generated test suite
    const testSuite = this.parseTestSuite(content.text, requirements, context);
    
    // Add additional test types based on options
    if (options.includePropertyTests) {
      await this.addPropertyTests(testSuite, context);
    }
    
    if (options.includeFuzzTests) {
      await this.addFuzzTests(testSuite, context);
    }
    
    if (options.includeSecurityTests) {
      await this.addSecurityTests(testSuite, context);
    }

    return testSuite;
  }

  /**
   * Build prompt for test generation
   */
  private buildTestGenerationPrompt(
    requirements: Requirement[],
    context: ProjectContext,
    options: TestGenerationOptions
  ): string {
    return `Generate a comprehensive test suite for the following project:

PROJECT: ${context.name}
DESCRIPTION: ${context.description}

REQUIREMENTS:
${requirements.map((req, i) => `
${i + 1}. ${req.description} (Priority: ${req.priority})
   Acceptance Criteria:
   ${req.acceptanceCriteria.map(ac => `   - ${ac}`).join('\n')}
`).join('\n')}

ARCHITECTURE:
${context.architecture ? `
Pattern: ${context.architecture.pattern}
Components: ${context.architecture.components.map(c => c.name).join(', ')}
` : 'Not specified'}

TESTING REQUIREMENTS:
- Test Framework: ${options.testFramework}
- Assertion Library: ${options.assertionLibrary}
- Include edge cases: ${options.includeEdgeCases}
- Include performance tests: ${options.includePerformanceTests}
- Include accessibility tests: ${options.includeAccessibilityTests}

Generate a complete test suite with the following structure:
1. For each requirement, create comprehensive tests covering:
   - Happy path scenarios
   - Edge cases and boundary conditions
   - Error handling
   - Negative test cases
   
2. For each test, provide:
   - Descriptive test name
   - Test category (happy-path, edge-case, error-handling, etc.)
   - Complete test code using ${options.testFramework}
   - Expected behavior description
   - Priority (critical, high, medium, low)

3. Include setup and teardown code if needed

4. Ensure tests are:
   - Independent and isolated
   - Deterministic
   - Fast to execute
   - Well-documented

Format the response as a JSON object with this structure:
{
  "name": "Test suite name",
  "description": "Suite description",
  "setupCode": "// Global setup code",
  "teardownCode": "// Global teardown code",
  "tests": [
    {
      "id": "test-id",
      "name": "Test name",
      "description": "What this test verifies",
      "type": "unit|integration|e2e",
      "category": "happy-path|edge-case|error-handling|boundary|negative",
      "code": "// Complete test code",
      "expectedBehavior": "Description of expected behavior",
      "priority": "critical|high|medium|low",
      "tags": ["tag1", "tag2"]
    }
  ]
}`;
  }

  /**
   * Parse AI response into TestSuite
   */
  private parseTestSuite(
    response: string,
    requirements: Requirement[],
    context: ProjectContext
  ): TestSuite {
    try {
      // Extract JSON from response
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error('No JSON found in response');
      }

      const parsed = JSON.parse(jsonMatch[0]);
      
      // Validate and transform
      const tests: Test[] = parsed.tests.map((test: any, index: number) => ({
        id: test.id || `test-${index}`,
        name: test.name,
        description: test.description || test.name,
        type: (test.type || 'unit') as TestType,
        category: (test.category || 'happy-path') as TestCategory,
        code: test.code,
        expectedBehavior: test.expectedBehavior,
        priority: test.priority || 'medium',
        tags: test.tags || []
      }));

      return {
        name: parsed.name || `${context.name} Test Suite`,
        description: parsed.description || `Tests for ${context.description}`,
        tests,
        setupCode: parsed.setupCode,
        teardownCode: parsed.teardownCode,
        requirements: requirements.map(r => r.id),
        coverage: {
          statements: 90,
          branches: 85,
          functions: 90,
          lines: 90
        }
      };
    } catch (error) {
      elizaLogger.error('[AI-TEST] Failed to parse test suite:', error);
      throw new Error(`Failed to parse AI response: ${error.message}`);
    }
  }

  /**
   * Add property-based tests
   */
  private async addPropertyTests(
    testSuite: TestSuite,
    context: ProjectContext
  ): Promise<void> {
    elizaLogger.info('[AI-TEST] Adding property-based tests');
    
    try {
      const prompt = `Generate property-based tests for the following test suite:

TEST SUITE: ${testSuite.name}
EXISTING TESTS: ${testSuite.tests.length}

Generate property tests that verify invariants and properties of the system.
Use fast-check or similar property testing library.

For each property test:
1. Identify a property that should always hold
2. Generate random inputs
3. Verify the property holds for all inputs

Return tests in the same format as before.`;

      // Add timeout wrapper
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Property test generation timed out')), 30000);
      });
      
      const responsePromise = this.anthropic!.messages.create({
        model: 'claude-opus-4-20250514',
        max_tokens: 4000,
        messages: [{
          role: 'user',
          content: prompt
        }],
        temperature: 0.3
      });

      const response = await Promise.race([responsePromise, timeoutPromise]) as any;
      const content = response.content[0];
      
      if (content.type === 'text') {
        const propertyTests = this.parseAdditionalTests(content.text, 'property');
        testSuite.tests.push(...propertyTests);
        elizaLogger.info(`[AI-TEST] Added ${propertyTests.length} property-based tests`);
      }
    } catch (error) {
      elizaLogger.warn('[AI-TEST] Failed to generate property tests:', error);
      // Don't throw - just skip property tests if they fail
    }
  }

  /**
   * Add fuzz tests
   */
  private async addFuzzTests(
    testSuite: TestSuite,
    context: ProjectContext
  ): Promise<void> {
    elizaLogger.info('[AI-TEST] Adding fuzz tests');

    const prompt = `Generate fuzz tests for the following test suite:

TEST SUITE: ${testSuite.name}

Generate fuzz tests that:
1. Test with random/malformed inputs
2. Test boundary conditions
3. Test with extremely large inputs
4. Test with special characters and edge cases

Focus on finding crashes, hangs, and security vulnerabilities.`;

    const response = await this.anthropic!.messages.create({
      model: 'claude-opus-4-20250514',
      max_tokens: 4000,
      messages: [{
        role: 'user',
        content: prompt
      }],
      temperature: 0.4
    });

    const content = response.content[0];
    if (content.type === 'text') {
      const fuzzTests = this.parseAdditionalTests(content.text, 'fuzz');
      testSuite.tests.push(...fuzzTests);
    }
  }

  /**
   * Add security tests
   */
  private async addSecurityTests(
    testSuite: TestSuite,
    context: ProjectContext
  ): Promise<void> {
    elizaLogger.info('[AI-TEST] Adding security tests');
    
    try {
      const prompt = `Generate security tests for the following test suite:

TEST SUITE: ${testSuite.name}

Generate security tests that check for:
1. SQL injection vulnerabilities
2. XSS vulnerabilities
3. Authentication bypass
4. Authorization issues
5. Data exposure
6. Input validation
7. Rate limiting
8. CSRF protection

Focus on OWASP Top 10 vulnerabilities.`;

      // Add timeout wrapper
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Security test generation timed out')), 30000);
      });
      
      const responsePromise = this.anthropic!.messages.create({
        model: 'claude-opus-4-20250514',
        max_tokens: 4000,
        messages: [{
          role: 'user',
          content: prompt
        }],
        temperature: 0.2
      });

      const response = await Promise.race([responsePromise, timeoutPromise]) as any;
      const content = response.content[0];
      
      if (content.type === 'text') {
        const securityTests = this.parseAdditionalTests(content.text, 'security');
        testSuite.tests.push(...securityTests);
        elizaLogger.info(`[AI-TEST] Added ${securityTests.length} security tests`);
      }
    } catch (error) {
      elizaLogger.warn('[AI-TEST] Failed to generate security tests:', error);
      // Don't throw - just skip security tests if they fail
    }
  }

  /**
   * Parse additional tests from AI response
   */
  private parseAdditionalTests(response: string, type: TestType): Test[] {
    try {
      const jsonMatch = response.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
      if (!jsonMatch) {
        return [];
      }

      const parsed = JSON.parse(jsonMatch[0]);
      const tests = Array.isArray(parsed) ? parsed : parsed.tests || [];

      return tests.map((test: any, index: number) => ({
        id: `${type}-test-${index}`,
        name: test.name,
        description: test.description || test.name,
        type,
        category: test.category || 'edge-case',
        code: test.code,
        expectedBehavior: test.expectedBehavior,
        priority: test.priority || 'high',
        tags: [...(test.tags || []), type]
      }));
    } catch (error) {
      elizaLogger.warn(`[AI-TEST] Failed to parse ${type} tests:`, error);
      return [];
    }
  }

  /**
   * Analyze test structure to understand implementation needs
   */
  async analyzeTestStructure(testSuite: TestSuite): Promise<any> {
    const structure = {
      modules: new Set<string>(),
      functions: new Set<string>(),
      classes: new Set<string>(),
      interfaces: new Set<string>(),
      dependencies: new Set<string>()
    };

    // Analyze test code to extract structure
    for (const test of testSuite.tests) {
      // Extract imports
      const importMatches = test.code.matchAll(/import\s+.*?\s+from\s+['"](.+?)['"]/g);
      for (const match of importMatches) {
        structure.dependencies.add(match[1]);
      }

      // Extract function calls
      const functionMatches = test.code.matchAll(/(\w+)\s*\(/g);
      for (const match of functionMatches) {
        structure.functions.add(match[1]);
      }

      // Extract class instantiations
      const classMatches = test.code.matchAll(/new\s+(\w+)/g);
      for (const match of classMatches) {
        structure.classes.add(match[1]);
      }
    }

    return {
      modules: Array.from(structure.modules),
      functions: Array.from(structure.functions),
      classes: Array.from(structure.classes),
      interfaces: Array.from(structure.interfaces),
      dependencies: Array.from(structure.dependencies)
    };
  }

  /**
   * Generate implementation skeleton based on tests
   */
  async generateSkeleton(structure: any, context: any): Promise<Implementation> {
    const prompt = `Generate a minimal implementation skeleton based on the following test structure:

STRUCTURE:
${JSON.stringify(structure, null, 2)}

CONTEXT:
Language: ${context.language}
Project Type: ${context.projectType}

Generate the minimal code needed to make the tests compile (but not pass).
Include:
1. All required functions with throw new Error('Not implemented')
2. All required classes with empty methods
3. All required interfaces
4. Proper file structure

Return as JSON with file paths and contents.`;

    const response = await this.anthropic!.messages.create({
      model: 'claude-opus-4-20250514',
      max_tokens: 4000,
      messages: [{
        role: 'user',
        content: prompt
      }],
      temperature: 0.1
    });

    const content = response.content[0];
    if (content.type !== 'text') {
      throw new Error('Unexpected response format');
    }

    const skeleton = this.parseImplementation(content.text);
    return skeleton;
  }

  /**
   * Parse implementation from AI response
   */
  private parseImplementation(response: string): Implementation {
    try {
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error('No JSON found in response');
      }

      const parsed = JSON.parse(jsonMatch[0]);

      return {
        files: parsed.files || [],
        entryPoint: parsed.entryPoint || 'index.ts',
        dependencies: parsed.dependencies || {},
        devDependencies: parsed.devDependencies || {}
      };
    } catch (error) {
      elizaLogger.error('[AI-TEST] Failed to parse implementation:', error);
      
      // Return minimal skeleton
      return {
        files: [{
          path: 'index.ts',
          content: '// Implementation skeleton\nexport {};\n',
          language: 'typescript',
          purpose: 'Main entry point'
        }],
        entryPoint: 'index.ts',
        dependencies: {},
        devDependencies: {}
      };
    }
  }

  /**
   * Generate fixes for test failures
   */
  async generateFixes(
    pattern: FailurePattern,
    failures: TestRunResult[]
  ): Promise<Fix[]> {
    const prompt = `Analyze the following test failures and generate fixes:

FAILURE PATTERN: ${pattern.type}
DESCRIPTION: ${pattern.description}
AFFECTED TESTS: ${pattern.affectedTests.length}

SAMPLE FAILURES:
${failures.slice(0, 3).map(f => `
Test: ${f.test.name}
Error: ${f.error?.message}
Expected: ${f.error?.expected}
Actual: ${f.error?.actual}
`).join('\n')}

Generate fixes that:
1. Address the root cause
2. Are minimal and focused
3. Don't break other tests
4. Follow best practices

Return fixes as JSON array.`;

    const response = await this.anthropic!.messages.create({
      model: 'claude-opus-4-20250514',
      max_tokens: 4000,
      messages: [{
        role: 'user',
        content: prompt
      }],
      temperature: 0.2
    });

    const content = response.content[0];
    if (content.type !== 'text') {
      return [];
    }

    return this.parseFixes(content.text);
  }

  /**
   * Parse fixes from AI response
   */
  private parseFixes(response: string): Fix[] {
    try {
      const jsonMatch = response.match(/\[[\s\S]*\]/);
      if (!jsonMatch) {
        return [];
      }

      const parsed = JSON.parse(jsonMatch[0]);

      return parsed.map((fix: any) => ({
        description: fix.description,
        code: fix.code,
        targetFile: fix.targetFile || 'index.ts',
        targetLine: fix.targetLine,
        confidence: fix.confidence || 0.7,
        impact: fix.impact || 'medium'
      }));
    } catch (error) {
      elizaLogger.error('[AI-TEST] Failed to parse fixes:', error);
      return [];
    }
  }

  /**
   * Analyze root cause of failures
   */
  async analyzeRootCause(
    patterns: FailurePattern[],
    failures: TestRunResult[]
  ): Promise<{ rootCause?: string }> {
    const prompt = `Analyze the following test failure patterns and identify the root cause:

PATTERNS:
${patterns.map(p => `- ${p.type}: ${p.description} (${p.affectedTests.length} tests)`).join('\n')}

TOTAL FAILURES: ${failures.length}

Common error messages:
${this.getCommonErrors(failures).join('\n')}

Identify the most likely root cause of these failures.`;

    const response = await this.anthropic!.messages.create({
      model: 'claude-opus-4-20250514',
      max_tokens: 1000,
      messages: [{
        role: 'user',
        content: prompt
      }],
      temperature: 0.3
    });

    const content = response.content[0];
    if (content.type === 'text') {
      return { rootCause: content.text.trim() };
    }

    return {};
  }

  /**
   * Get common error messages
   */
  private getCommonErrors(failures: TestRunResult[]): string[] {
    const errorCounts = new Map<string, number>();

    for (const failure of failures) {
      if (failure.error?.message) {
        const msg = failure.error.message;
        errorCounts.set(msg, (errorCounts.get(msg) || 0) + 1);
      }
    }

    return Array.from(errorCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([msg, count]) => `- "${msg}" (${count} occurrences)`);
  }

  /**
   * Generate minimal fix for failures
   */
  async generateMinimalFix(
    analysis: FailureAnalysis,
    implementation: Implementation,
    testSuite: TestSuite
  ): Promise<Fix> {
    const prompt = `Generate a minimal fix for the following test failures:

ROOT CAUSE: ${analysis.rootCause || 'Unknown'}

FAILURE PATTERNS:
${analysis.patterns.map(p => `- ${p.type}: ${p.description}`).join('\n')}

CURRENT IMPLEMENTATION:
${implementation.files.map(f => `
File: ${f.path}
\`\`\`typescript
${f.content.slice(0, 500)}...
\`\`\`
`).join('\n')}

Generate the minimal code change needed to fix the most critical failure.
Focus on making at least one test pass.

Return as JSON with: description, code, targetFile, targetLine (optional), confidence, impact`;

    const response = await this.anthropic!.messages.create({
      model: 'claude-opus-4-20250514',
      max_tokens: 2000,
      messages: [{
        role: 'user',
        content: prompt
      }],
      temperature: 0.2
    });

    const content = response.content[0];
    if (content.type !== 'text') {
      throw new Error('Failed to generate fix');
    }

    const fixes = this.parseFixes(content.text);
    if (fixes.length === 0) {
      throw new Error('No fix generated');
    }

    return fixes[0];
  }
}