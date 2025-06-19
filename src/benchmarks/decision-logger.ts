import type { DecisionLog } from './types';
import type { DevelopmentPhase, ErrorAnalysis } from '../types/plugin-project';
import * as fs from 'fs/promises';
import * as path from 'path';

/**
 * Logs decisions made during AutoCoder execution for observability
 */
export class DecisionLogger {
  private decisions: DecisionLog[] = [];
  private logDir: string;
  private projectId: string;
  private verbose: boolean;

  constructor(logDir: string, projectId: string, verbose = false) {
    this.logDir = logDir;
    this.projectId = projectId;
    this.verbose = verbose;
  }

  /**
   * Log a design decision
   */
  async logDesignDecision(
    phase: DevelopmentPhase,
    iteration: number,
    reasoning: string,
    alternatives: string[],
    chosenPath: string,
    confidence: number,
    requirements: string[]
  ): Promise<void> {
    const decision: DecisionLog = {
      timestamp: new Date(),
      phase,
      iteration,
      decision: {
        type: 'design',
        reasoning,
        alternatives,
        chosenPath,
        confidence,
      },
      context: {
        errors: [],
        requirements,
        constraints: [],
      },
      outcome: {
        success: false, // Will be updated later
        impact: '',
        nextSteps: [],
      },
    };

    this.decisions.push(decision);
    await this.saveDecision(decision);

    if (this.verbose) {
      console.log(`[DECISION] Design: ${chosenPath}`);
      console.log(`  Reasoning: ${reasoning}`);
      console.log(`  Confidence: ${confidence}%`);
    }
  }

  /**
   * Log an implementation decision
   */
  async logImplementationDecision(
    phase: DevelopmentPhase,
    iteration: number,
    component: string,
    approach: string,
    reasoning: string,
    confidence: number
  ): Promise<void> {
    const decision: DecisionLog = {
      timestamp: new Date(),
      phase,
      iteration,
      decision: {
        type: 'implementation',
        reasoning,
        alternatives: [],
        chosenPath: `${component}: ${approach}`,
        confidence,
      },
      context: {
        errors: [],
        requirements: [],
        constraints: [],
      },
      outcome: {
        success: false,
        impact: '',
        nextSteps: [],
      },
    };

    this.decisions.push(decision);
    await this.saveDecision(decision);

    if (this.verbose) {
      console.log(`[DECISION] Implementation: ${component}`);
      console.log(`  Approach: ${approach}`);
      console.log(`  Reasoning: ${reasoning}`);
    }
  }

  /**
   * Log a fix decision
   */
  async logFixDecision(
    phase: DevelopmentPhase,
    iteration: number,
    error: ErrorAnalysis,
    fixStrategy: string,
    reasoning: string,
    alternatives: string[],
    confidence: number
  ): Promise<void> {
    const decision: DecisionLog = {
      timestamp: new Date(),
      phase,
      iteration,
      decision: {
        type: 'fix',
        reasoning,
        alternatives,
        chosenPath: fixStrategy,
        confidence,
      },
      context: {
        errors: [error],
        requirements: [],
        constraints: [],
      },
      outcome: {
        success: false,
        impact: '',
        nextSteps: [],
      },
    };

    this.decisions.push(decision);
    await this.saveDecision(decision);

    if (this.verbose) {
      console.log(`[DECISION] Fix: ${error.errorType} error`);
      console.log(`  Strategy: ${fixStrategy}`);
      console.log(`  Reasoning: ${reasoning}`);
    }
  }

  /**
   * Log an optimization decision
   */
  async logOptimizationDecision(
    phase: DevelopmentPhase,
    iteration: number,
    target: string,
    optimization: string,
    reasoning: string,
    expectedImprovement: string,
    confidence: number
  ): Promise<void> {
    const decision: DecisionLog = {
      timestamp: new Date(),
      phase,
      iteration,
      decision: {
        type: 'optimization',
        reasoning,
        alternatives: [],
        chosenPath: `${target}: ${optimization}`,
        confidence,
      },
      context: {
        errors: [],
        requirements: [],
        constraints: [],
      },
      outcome: {
        success: false,
        impact: expectedImprovement,
        nextSteps: [],
      },
    };

    this.decisions.push(decision);
    await this.saveDecision(decision);

    if (this.verbose) {
      console.log(`[DECISION] Optimization: ${target}`);
      console.log(`  Strategy: ${optimization}`);
      console.log(`  Expected: ${expectedImprovement}`);
    }
  }

  /**
   * Update the outcome of a decision
   */
  async updateDecisionOutcome(
    index: number,
    success: boolean,
    impact: string,
    nextSteps: string[]
  ): Promise<void> {
    if (index >= 0 && index < this.decisions.length) {
      this.decisions[index].outcome = {
        success,
        impact,
        nextSteps,
      };

      await this.saveDecision(this.decisions[index]);

      if (this.verbose) {
        const decision = this.decisions[index];
        console.log(`[OUTCOME] ${decision.decision.type}: ${success ? 'SUCCESS' : 'FAILED'}`);
        console.log(`  Impact: ${impact}`);
        if (nextSteps.length > 0) {
          console.log(`  Next: ${nextSteps.join(', ')}`);
        }
      }
    }
  }

  /**
   * Save a decision to disk
   */
  private async saveDecision(decision: DecisionLog): Promise<void> {
    const filename = `${this.projectId}_decisions.jsonl`;
    const filepath = path.join(this.logDir, filename);

    // Ensure log directory exists
    await fs.mkdir(this.logDir, { recursive: true });

    // Append decision as JSON line
    const line = JSON.stringify(decision) + '\n';
    await fs.appendFile(filepath, line);
  }

  /**
   * Get all decisions
   */
  getDecisions(): DecisionLog[] {
    return [...this.decisions];
  }

  /**
   * Get decisions by phase
   */
  getDecisionsByPhase(phase: DevelopmentPhase): DecisionLog[] {
    return this.decisions.filter((d) => d.phase === phase);
  }

  /**
   * Get decisions by type
   */
  getDecisionsByType(type: 'design' | 'implementation' | 'fix' | 'optimization'): DecisionLog[] {
    return this.decisions.filter((d) => d.decision.type === type);
  }

  /**
   * Generate decision summary
   */
  generateSummary(): {
    totalDecisions: number;
    byType: Record<string, number>;
    byPhase: Record<string, number>;
    successRate: number;
    averageConfidence: number;
  } {
    const byType: Record<string, number> = {};
    const byPhase: Record<string, number> = {};
    let successCount = 0;
    let totalConfidence = 0;

    for (const decision of this.decisions) {
      // Count by type
      byType[decision.decision.type] = (byType[decision.decision.type] || 0) + 1;

      // Count by phase
      byPhase[decision.phase] = (byPhase[decision.phase] || 0) + 1;

      // Track success
      if (decision.outcome.success) {
        successCount++;
      }

      // Sum confidence
      totalConfidence += decision.decision.confidence;
    }

    return {
      totalDecisions: this.decisions.length,
      byType,
      byPhase,
      successRate: this.decisions.length > 0 ? (successCount / this.decisions.length) * 100 : 0,
      averageConfidence: this.decisions.length > 0 ? totalConfidence / this.decisions.length : 0,
    };
  }

  /**
   * Export decision tree visualization
   */
  async exportDecisionTree(outputPath: string): Promise<void> {
    const tree = this.buildDecisionTree();
    await fs.writeFile(outputPath, JSON.stringify(tree, null, 2));
  }

  /**
   * Build a decision tree structure
   */
  private buildDecisionTree(): any {
    const tree: any = {
      name: 'AutoCoder Decisions',
      children: [],
    };

    // Group by phase
    const phaseGroups = new Map<DevelopmentPhase, DecisionLog[]>();
    for (const decision of this.decisions) {
      if (!phaseGroups.has(decision.phase)) {
        phaseGroups.set(decision.phase, []);
      }
      phaseGroups.get(decision.phase)!.push(decision);
    }

    // Build tree structure
    for (const [phase, decisions] of phaseGroups) {
      const phaseNode = {
        name: phase,
        children: decisions.map((d) => ({
          name: d.decision.chosenPath,
          type: d.decision.type,
          confidence: d.decision.confidence,
          success: d.outcome.success,
          timestamp: d.timestamp,
        })),
      };
      tree.children.push(phaseNode);
    }

    return tree;
  }

  /**
   * Get the last decision index
   */
  getLastDecisionIndex(): number {
    return this.decisions.length - 1;
  }
}
