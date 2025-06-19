/**
 * Types for Test-Driven Development system
 */

export interface TestSuite {
  name: string;
  description: string;
  tests: Test[];
  setupCode?: string;
  teardownCode?: string;
  requirements: string[];
  coverage: CoverageRequirements;
}

export interface Test {
  id: string;
  name: string;
  description: string;
  type: TestType;
  category: TestCategory;
  code: string;
  expectedBehavior: string;
  priority: 'critical' | 'high' | 'medium' | 'low';
  tags: string[];
}

export type TestType = 
  | 'unit'
  | 'integration'
  | 'e2e'
  | 'property'
  | 'fuzz'
  | 'performance'
  | 'security'
  | 'accessibility';

export type TestCategory =
  | 'happy-path'
  | 'edge-case'
  | 'error-handling'
  | 'boundary'
  | 'negative'
  | 'stress'
  | 'regression';

export interface CoverageRequirements {
  statements: number;
  branches: number;
  functions: number;
  lines: number;
}

export interface TestGenerationOptions {
  includeEdgeCases: boolean;
  includePropertyTests: boolean;
  includePerformanceTests: boolean;
  includeFuzzTests: boolean;
  includeAccessibilityTests: boolean;
  includeSecurityTests: boolean;
  testFramework: 'jest' | 'mocha' | 'vitest';
  assertionLibrary: 'jest' | 'chai' | 'node:assert';
  mockingLibrary?: 'jest' | 'sinon' | 'testdouble';
}

export interface TestRunResult {
  test: Test;
  passed: boolean;
  duration: number;
  error?: TestError;
  output?: string;
  coverage?: CoverageData;
}

export interface TestError {
  message: string;
  stack?: string;
  expected?: any;
  actual?: any;
  line?: number;
  column?: number;
}

export interface CoverageData {
  statements: { total: number; covered: number; percentage: number };
  branches: { total: number; covered: number; percentage: number };
  functions: { total: number; covered: number; percentage: number };
  lines: { total: number; covered: number; percentage: number };
  uncoveredLines: number[];
}

export interface TestSuiteResult {
  suite: TestSuite;
  results: TestRunResult[];
  passed: boolean;
  duration: number;
  coverage: CoverageData;
  summary: TestSummary;
}

export interface TestSummary {
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  errorRate: number;
  avgDuration: number;
  slowestTest: { name: string; duration: number };
  failureReasons: FailureReason[];
}

export interface FailureReason {
  category: string;
  count: number;
  examples: string[];
}

export interface Implementation {
  files: ImplementationFile[];
  entryPoint: string;
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
}

export interface ImplementationFile {
  path: string;
  content: string;
  language: string;
  purpose: string;
}

export interface FailureAnalysis {
  failedTests: TestRunResult[];
  patterns: FailurePattern[];
  suggestedFixes: Fix[];
  rootCause?: string;
}

export interface FailurePattern {
  type: string;
  description: string;
  affectedTests: string[];
  confidence: number;
}

export interface Fix {
  description: string;
  code: string;
  targetFile: string;
  targetLine?: number;
  confidence: number;
  impact: 'high' | 'medium' | 'low';
}

export interface RefactoringSuggestion {
  type: RefactoringType;
  description: string;
  before: string;
  after: string;
  benefits: string[];
  risks: string[];
  confidence: number;
}

export type RefactoringType =
  | 'extract-method'
  | 'inline-method'
  | 'rename'
  | 'move-method'
  | 'extract-interface'
  | 'introduce-parameter-object'
  | 'replace-conditional-with-polymorphism'
  | 'decompose-conditional'
  | 'remove-duplication'
  | 'simplify-method';

export interface TDDContext {
  projectType: 'swe-bench' | 'eliza-plugin' | 'general';
  language: 'TypeScript' | 'JavaScript';
  framework?: string;
  existingCode?: Implementation;
  constraints?: string[];
  performanceRequirements?: PerformanceRequirements;
  securityRequirements?: SecurityRequirements;
}

export interface PerformanceRequirements {
  maxResponseTime: number;
  maxMemoryUsage: number;
  minThroughput?: number;
  maxCpuUsage?: number;
}

export interface SecurityRequirements {
  preventSQLInjection: boolean;
  preventXSS: boolean;
  requireAuthentication: boolean;
  requireAuthorization: boolean;
  encryptSensitiveData: boolean;
  validateInput: boolean;
}

export interface Requirement {
  id: string;
  description: string;
  acceptanceCriteria: string[];
  priority: 'must' | 'should' | 'could' | 'wont';
  category: string;
  testable: boolean;
}

export interface ProjectContext {
  name: string;
  description: string;
  requirements: Requirement[];
  architecture?: ArchitectureSpec;
  dependencies?: string[];
  targetEnvironment?: string;
}

export interface ArchitectureSpec {
  pattern: 'mvc' | 'mvvm' | 'layered' | 'microservices' | 'serverless';
  components: ComponentSpec[];
  dataFlow: DataFlowSpec[];
}

export interface ComponentSpec {
  name: string;
  type: string;
  responsibilities: string[];
  interfaces: InterfaceSpec[];
}

export interface InterfaceSpec {
  name: string;
  methods: MethodSpec[];
}

export interface MethodSpec {
  name: string;
  parameters: ParameterSpec[];
  returnType: string;
  description: string;
}

export interface ParameterSpec {
  name: string;
  type: string;
  required: boolean;
  description?: string;
}

export interface DataFlowSpec {
  from: string;
  to: string;
  data: string;
  protocol?: string;
}