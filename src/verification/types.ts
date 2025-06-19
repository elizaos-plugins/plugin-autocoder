/**
 * Types for the verification system
 */

export interface VerificationContext {
  projectPath: string;
  requirements: string[];
  constraints: string[];
  targetEnvironment: 'development' | 'production';
  language: 'TypeScript' | 'JavaScript';
  framework?: string;
}

export interface VerificationResult {
  passed: boolean;
  score: number; // 0-100
  stages: VerificationStageResult[];
  criticalErrors: VerificationError[];
  warnings: VerificationWarning[];
  suggestions: VerificationSuggestion[];
  metrics: VerificationMetrics;
}

export interface VerificationStageResult {
  stage: string;
  validator: string;
  passed: boolean;
  score: number;
  duration: number;
  findings: VerificationFinding[];
}

export interface VerificationFinding {
  type: 'error' | 'warning' | 'suggestion' | 'info';
  severity: 'critical' | 'high' | 'medium' | 'low';
  message: string;
  file?: string;
  line?: number;
  column?: number;
  rule?: string;
  fix?: VerificationFix;
}

export interface VerificationFix {
  description: string;
  automatic: boolean;
  patch?: string;
  confidence: number;
}

export interface VerificationError extends VerificationFinding {
  type: 'error';
  stackTrace?: string;
}

export interface VerificationWarning extends VerificationFinding {
  type: 'warning';
}

export interface VerificationSuggestion extends VerificationFinding {
  type: 'suggestion';
  improvement: string;
  impact: 'performance' | 'security' | 'maintainability' | 'readability';
}

export interface VerificationMetrics {
  totalFiles: number;
  totalLines: number;
  coveragePercentage: number;
  complexityScore: number;
  securityScore: number;
  performanceScore: number;
  maintainabilityScore: number;
  typeScore: number;
  testScore: number;
}

export interface Validator {
  name: string;
  description: string;
  validate(code: Code, context: VerificationContext): Promise<VerificationStageResult>;
  canAutoFix: boolean;
  autoFix?(code: Code, findings: VerificationFinding[]): Promise<Code>;
}

export interface Code {
  files: CodeFile[];
  entryPoint?: string;
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
}

export interface CodeFile {
  path: string;
  content: string;
  language: string;
}

export interface CheckResult {
  success: boolean;
  output: string;
  errors: string[];
  warnings: string[];
  duration: number;
}

export interface TestResult extends CheckResult {
  totalTests: number;
  passedTests: number;
  failedTests: number;
  skippedTests: number;
  coverage?: CoverageResult;
}

export interface CoverageResult {
  statements: CoverageMetric;
  branches: CoverageMetric;
  functions: CoverageMetric;
  lines: CoverageMetric;
}

export interface CoverageMetric {
  total: number;
  covered: number;
  percentage: number;
}

export interface SecurityCheckResult extends CheckResult {
  vulnerabilities: SecurityVulnerability[];
  securityScore: number;
}

export interface SecurityVulnerability {
  severity: 'critical' | 'high' | 'medium' | 'low';
  type: string;
  description: string;
  file: string;
  line?: number;
  recommendation: string;
}

export interface ComplexityResult extends CheckResult {
  averageComplexity: number;
  maxComplexity: number;
  complexFiles: ComplexFile[];
}

export interface ComplexFile {
  path: string;
  complexity: number;
  functions: ComplexFunction[];
}

export interface ComplexFunction {
  name: string;
  complexity: number;
  line: number;
}

export interface PerformanceResult extends CheckResult {
  metrics: PerformanceMetrics;
  bottlenecks: PerformanceBottleneck[];
}

export interface PerformanceMetrics {
  bundleSize: number;
  memoryUsage: number;
  loadTime: number;
  runtimePerformance: number;
}

export interface PerformanceBottleneck {
  type: 'memory' | 'cpu' | 'io' | 'network';
  description: string;
  location: string;
  impact: 'high' | 'medium' | 'low';
  suggestion: string;
}

export interface AIReviewResult {
  reviewer: string;
  perspective: string;
  findings: AIReviewFinding[];
  overallAssessment: string;
  score: number;
  suggestions: AIReviewSuggestion[];
}

export interface AIReviewFinding {
  category: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  description: string;
  location?: string;
  reasoning: string;
}

export interface AIReviewSuggestion {
  category: string;
  suggestion: string;
  impact: string;
  implementation: string;
  priority: 'high' | 'medium' | 'low';
}