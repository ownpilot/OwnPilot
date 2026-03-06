/**
 * Skill Eval API Endpoints
 *
 * Test skills by running queries with/without the skill active,
 * grade results with AI, and optimize skill descriptions.
 */

import { apiClient } from '../client';

export interface EvalRunResult {
  response: string;
  durationMs: number;
}

export interface EvalGradeResult {
  score: number;
  passed: boolean;
  feedback: string;
}

export interface OptimizeIteration {
  description: string;
  triggerAccuracy: number;
  reasoning: string;
}

export interface OptimizeResult {
  iterations: OptimizeIteration[];
  best: OptimizeIteration;
}

export const evalApi = {
  /** Run a test query with or without the skill enabled */
  runTest: (skillId: string, query: string, withSkill: boolean) =>
    apiClient.post<EvalRunResult>(`/extensions/${skillId}/eval/run`, { query, withSkill }),

  /** Grade a response using AI */
  gradeResponse: (
    skillId: string,
    query: string,
    response: string,
    expectedKeywords: string[],
    notes: string
  ) =>
    apiClient.post<EvalGradeResult>(`/extensions/${skillId}/eval/grade`, {
      query,
      response,
      expectedKeywords,
      notes,
    }),

  /** Optimize skill description via iterative LLM testing */
  optimizeDescription: (
    skillId: string,
    currentDescription: string,
    testQueries: string[],
    iterations = 3
  ) =>
    apiClient.post<OptimizeResult>(`/extensions/${skillId}/eval/optimize-description`, {
      currentDescription,
      testQueries,
      iterations,
    }),
};
