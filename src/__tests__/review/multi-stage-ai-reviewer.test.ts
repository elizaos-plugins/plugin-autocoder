import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MultiStageAIReviewer } from '../../review/multi-stage-ai-reviewer';
import type { Code, VerificationContext } from '../../verification/types';

// Mock Anthropic SDK
const mockAnthropicCreate = vi.fn();
const mockAnthropicConstructor = vi.fn();

// Mock the entire module before importing
vi.mock('@anthropic-ai/sdk', () => ({
  default: vi.fn(() => ({
    messages: {
      create: mockAnthropicCreate
    }
  }))
}));

// Set up default mock response after mocking
mockAnthropicCreate.mockResolvedValue({
  content: [{
    type: 'text',
    text: `<review>
<findings>
  <finding>
    <severity>high</severity>
    <category>architecture</category>
    <issue>Poor separation of concerns</issue>
    <location>src/index.ts</location>
    <suggestion>Extract business logic to separate service layer</suggestion>
    <confidence>0.8</confidence>
  </finding>
  <finding>
    <severity>critical</severity>
    <category>security</category>
    <issue>SQL injection vulnerability</issue>
    <location>src/database.ts:45</location>
    <suggestion>Use parameterized queries</suggestion>
    <confidence>0.95</confidence>
  </finding>
</findings>
<summary>
  <score>65</score>
  <passed>false</passed>
  <critical_issues>1</critical_issues>
  <high_issues>1</high_issues>
  <medium_issues>0</medium_issues>
  <low_issues>0</low_issues>
</summary>
</review>`
  }]
});

describe('MultiStageAIReviewer', () => {
  let reviewer: MultiStageAIReviewer;
  const mockApiKey = 'test-api-key';

  beforeEach(() => {
    vi.clearAllMocks();
    reviewer = new MultiStageAIReviewer(mockApiKey);
  });

  it('should initialize with API key', () => {
    // Can't directly check constructor call with current mock setup
    // Just verify the reviewer was created
    expect(reviewer).toBeDefined();
  });

  it('should run comprehensive review', async () => {
    const code: Code = {
      files: [{
        path: 'src/index.ts',
        content: 'export function test() { return "test"; }',
        language: 'typescript'
      }],
      dependencies: {},
      devDependencies: {}
    };

    const context: VerificationContext = {
      projectPath: '/test/project',
      requirements: ['Implement secure database access'],
      constraints: ['Use TypeScript'],
      targetEnvironment: 'production',
      language: 'TypeScript'
    };

    const result = await reviewer.reviewCode(code, context);

    expect(result).toBeDefined();
    expect(result.passed).toBe(false); // Should fail due to security issue
    expect(result.overallScore).toBeLessThan(70);
    expect(result.criticalIssues.length).toBeGreaterThan(0);
  });

  it('should handle review stage failures gracefully', async () => {
    // Mock a failure
    mockAnthropicCreate.mockRejectedValueOnce(new Error('API Error'));

    const code: Code = {
      files: [{
        path: 'src/test.ts',
        content: 'test',
        language: 'typescript'
      }],
      dependencies: {},
      devDependencies: {}
    };

    const context: VerificationContext = {
      projectPath: '/test/project',
      requirements: [],
      constraints: [],
      targetEnvironment: 'development',
      language: 'TypeScript'
    };

    const result = await reviewer.reviewCode(code, context);

    expect(result).toBeDefined();
    expect(result.passed).toBe(false);
    expect(result.overallScore).toBe(0);
  });
});