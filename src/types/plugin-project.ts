import type { UUID } from '@elizaos/core';

/**
 * Defines the distinct phases of the development workflow.
 */
export type DevelopmentPhase =
  | 'idle'
  | 'researching'
  | 'mvp_planning'
  | 'mvp_development'
  | 'mvp_testing'
  | 'full_planning'
  | 'full_development'
  | 'full_testing'
  | 'self_critique'
  | 'revision'
  | 'publishing'
  | 'completed'
  | 'failed'
  | 'awaiting-secrets';

/**
 * Represents a single check performed during a testing phase.
 */
export interface CheckResult {
  phase: 'tsc' | 'eslint' | 'build' | 'test';
  success: boolean;
  duration: number;
  errorCount: number;
  errors?: string[];
}

/**
 * Represents the analysis of a specific error.
 */
export interface ErrorAnalysis {
  errorType: 'typescript' | 'eslint' | 'build' | 'test' | 'runtime';
  message: string;
  file?: string;
  line?: number;
  column?: number;
  suggestion?: string;
  fixAttempts: number;
  resolved: boolean;
}

/**
 * Represents a notification to be sent to the user.
 */
export interface UserNotification {
  timestamp: Date;
  type: 'info' | 'warning' | 'error' | 'success' | 'secret_request' | 'action_required';
  message: string;
  requiresAction: boolean;
  actionType?: 'provide_secret' | 'approve_change' | 'provide_feedback';
  metadata?: any;
}

/**
 * Main interface for a plugin development project, tracking its entire state.
 */
export interface PluginProject {
  id: string;
  name: string;
  description: string;
  type: 'create' | 'update';
  status: DevelopmentPhase;
  createdAt: Date;
  updatedAt: Date;
  completedAt?: Date;
  error?: string;
  logs: string[];

  // User Interaction
  userId: UUID;
  conversationId?: UUID;
  lastUserFeedback?: string;
  userNotifications: UserNotification[];

  // Workflow & State
  phaseHistory: DevelopmentPhase[];
  currentIteration: number;
  maxIterations: number;
  infiniteMode: boolean;
  developmentStartTime?: Date;

  // Research & Planning
  researchJobId?: string;
  researchReport?: string;
  mvpPlan?: string;
  fullPlan?: string;
  critique?: string;

  // Code & Workspace
  githubRepo?: string;
  localPath?: string;
  branch?: string;

  // Secret Management
  requiredSecrets: string[];
  providedSecrets: string[];
  secretsRequestedAt?: Date;

  // Error & Testing
  errors: Array<{
    iteration: number;
    phase: string;
    error: string;
    timestamp: Date;
  }>;
  errorAnalysis: Map<string, ErrorAnalysis>;
  testResults?: {
    passed: number;
    failed: number;
    duration: number;
    failures?: Array<{ test: string; error: string }>;
  };

  // Publishing
  npmPackage?: string;
  pullRequestUrl?: string;

  // Internals
  childProcess?: any;
  customInstructions: string[];

  // New properties
  knowledgeIds: string[];
  discoveredPlugins?: any[]; // PluginSearchResult[] from plugin-plugin-manager
  dependencyManifest?: any; // DependencyManifest from dependency-manager

  // Added for the new methods
  totalPhases: number;
  phase?: number;
  healingAttempts?: number;

  // Missing properties from the original
  failedAttempts?: Map<string, number>;
  successfulPhases?: string[];
  
  // Plugin Manager integration
  pendingConfigurations?: Array<{
    pluginName: string;
    type: 'environment_variables' | 'configuration';
    required: boolean;
  }>;
}
