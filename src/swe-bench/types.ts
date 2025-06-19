import type { IAgentRuntime } from '@elizaos/core';

/**
 * SWE-bench instance from Multi-SWE-bench dataset
 */
export interface SWEBenchInstance {
  instance_id: string;
  repo: string;
  repo_url: string;
  language: 'TypeScript' | 'JavaScript' | 'Java' | 'Go' | 'Rust' | 'C' | 'C++';
  issue_title: string;
  issue_body: string;
  issue_number: number;
  base_commit: string;
  patch?: string;
  test_patch?: string;
  fix_patch?: string;
  hints?: string[];
  created_at: string;
  version: string;
  problem_statement?: string;
  environment_setup_commit?: string;
}

/**
 * Result of running SWE-bench on a single instance
 */
export interface SWEBenchResult {
  instance_id: string;
  success: boolean;
  patch: string;
  execution_time: number;
  iterations: number;
  token_usage: TokenUsage;
  error?: string;
  test_results?: TestResults;
  compilation_success?: boolean;
  validation_details?: ValidationDetails;
}

/**
 * Token usage metrics
 */
export interface TokenUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total: number;
  cost: number;
}

/**
 * Test execution results
 */
export interface TestResults {
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  duration: number;
  failures?: TestFailure[];
}

/**
 * Individual test failure details
 */
export interface TestFailure {
  test_name: string;
  error_message: string;
  stack_trace?: string;
}

/**
 * Validation details for a patch
 */
export interface ValidationDetails {
  compilation_success: boolean;
  test_pass_rate: number;
  requirements_met: string[];
  requirements_missed: string[];
  performance_issues: string[];
}

/**
 * Configuration for SWE-bench evaluation
 */
export interface EvaluationConfig {
  dataset: 'multi-swe-bench';
  language_filter: Array<'TypeScript' | 'JavaScript'>;
  max_instances?: number;
  timeout_per_instance?: number;
  docker_enabled: boolean;
  cache_dir: string;
  parallel_instances?: number;
  save_artifacts?: boolean;
  output_dir: string;
}

/**
 * Repository context for issue analysis
 */
export interface RepoContext {
  structure: DirectoryStructure;
  dependencies: Record<string, string>;
  test_framework?: string;
  build_system?: string;
  relevant_files: string[];
  code_patterns: CodePattern[];
}

/**
 * Directory structure representation
 */
export interface DirectoryStructure {
  name: string;
  path: string;
  type: 'file' | 'directory';
  children?: DirectoryStructure[];
}

/**
 * Code pattern found in repository
 */
export interface CodePattern {
  pattern: string;
  frequency: number;
  files: string[];
}

/**
 * Issue analysis result
 */
export interface IssueAnalysis {
  requirements: string[];
  affected_files: string[];
  suggested_approach: string;
  complexity: 'low' | 'medium' | 'high';
  context: Record<string, any>;
  test_requirements?: string[];
}

/**
 * Generated patch with metadata
 */
export interface GeneratedPatch {
  patch: string;
  files_modified: string[];
  additions: number;
  deletions: number;
  iteration_count: number;
  approach_description: string;
  verification_score?: number;
  verification_passed?: boolean;
  real_world_checks?: {
    buildPassed: boolean;
    testsRun: number;
    testsPassed: number;
    testsFailed: number;
    lintPassed: boolean;
  };
  test_coverage?: number;
  token_usage?: TokenUsage;
}

/**
 * Project context for AutoCoder
 */
export interface ProjectContext {
  name: string;
  description: string;
  requirements: string[];
  constraints: string[];
  existing_code_context: string;
  test_requirements?: string[];
  target_directory: string;
  verification_requirements?: {
    minScore: number;
    requiredValidators: string[];
    maxComplexity: number;
  };
  research_context?: any; // Will be ResearchContext when imported
}

/**
 * Patch submission for evaluation
 */
export interface PatchSubmission {
  instance_id: string;
  model_patch: string;
  model_name: string;
  timestamp: string;
}

/**
 * Evaluation results from Multi-SWE-bench
 */
export interface EvaluationResults {
  total_instances: number;
  resolved_instances: number;
  resolution_rate: number;
  exact_matches: number;
  test_pass_rate: number;
  compilation_success_rate: number;
  per_instance_results: InstanceResult[];
  summary: EvaluationSummary;
}

/**
 * Individual instance evaluation result
 */
export interface InstanceResult {
  instance_id: string;
  resolved: boolean;
  tests_passed: boolean;
  compilation_success: boolean;
  execution_time: number;
  error?: string;
}

/**
 * Evaluation summary statistics
 */
export interface EvaluationSummary {
  avg_execution_time: number;
  avg_token_usage: number;
  total_cost: number;
  success_by_complexity: Record<string, number>;
  common_errors: Array<{ error: string; count: number }>;
}

/**
 * Benchmark options for running SWE-bench
 */
export interface BenchmarkOptions {
  instance_ids?: string[];
  max_instances?: number;
  language_filter?: Array<'TypeScript' | 'JavaScript'>;
  complexity_filter?: Array<'low' | 'medium' | 'high'>;
  repo_filter?: string[];
  timeout_per_instance?: number;
  save_artifacts?: boolean;
  verbose?: boolean;
  skip_evaluation?: boolean;
  docker_enabled?: boolean;
}

/**
 * Complete benchmark report
 */
export interface BenchmarkReport {
  start_time: string;
  end_time: string;
  duration: number;
  config: BenchmarkOptions;
  results: EvaluationResults;
  artifacts_dir?: string;
  logs_dir?: string;
}

/**
 * SWE-bench configuration
 */
export interface SWEBenchConfig {
  dataset_path?: string;
  cache_dir: string;
  work_dir: string;
  docker_enabled: boolean;
  python_path?: string;
  evaluation_script_path?: string;
  max_parallel_instances: number;
  timeout_per_instance: number;
  cleanup_after_run: boolean;
  useEnhancedGenerator?: boolean;
  useClaudeCode?: boolean;
}

/**
 * Python bridge communication
 */
export interface PythonBridgeMessage {
  type: 'evaluate' | 'status' | 'result' | 'error';
  data: any;
  timestamp: string;
}

/**
 * Raw evaluation results from Python
 */
export interface RawEvaluationResults {
  instance_id: string;
  resolved: boolean;
  test_output: string;
  patch_applied: boolean;
  error?: string;
  metadata?: Record<string, any>;
}