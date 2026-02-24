/**
 * Cost Optimization Recommendations
 *
 * Analyzes usage patterns and suggests cost-saving strategies.
 */

import type { CostRecommendation } from './types.js';
import { MODEL_PRICING } from './model-pricing.js';
import type { UsageTracker } from './usage-tracker.js';

/**
 * Generate cost optimization recommendations
 */
export async function generateRecommendations(
  tracker: UsageTracker,
  days: number = 30
): Promise<CostRecommendation[]> {
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);

  const summary = await tracker.getSummary(startDate);
  const recommendations: CostRecommendation[] = [];

  // Check for expensive model usage
  for (const [model, stats] of Object.entries(summary.byModel)) {
    const pricing = MODEL_PRICING.find((p) => p.modelId === model);
    if (!pricing) continue;

    // Find cheaper alternatives
    const cheaper = MODEL_PRICING.filter(
      (p) =>
        p.provider !== 'local' &&
        p.inputPricePerMillion < pricing.inputPricePerMillion * 0.5 &&
        p.contextWindow >= pricing.contextWindow * 0.5
    );

    if (cheaper.length > 0 && stats.cost > 1) {
      const cheapestAlt = cheaper.sort(
        (a, b) => a.inputPricePerMillion - b.inputPricePerMillion
      )[0]!;
      const potentialCost =
        stats.cost * (cheapestAlt.inputPricePerMillion / pricing.inputPricePerMillion);

      recommendations.push({
        type: 'model_switch',
        title: `Switch from ${pricing.displayName} to ${cheapestAlt.displayName}`,
        description:
          `You've spent $${stats.cost.toFixed(2)} on ${pricing.displayName}. ` +
          `Consider ${cheapestAlt.displayName} for simpler tasks.`,
        currentCost: stats.cost,
        potentialCost,
        estimatedSavings: stats.cost - potentialCost,
      });
    }
  }

  // Check for high token usage (prompt optimization)
  const avgInputPerRequest = summary.totalInputTokens / summary.totalRequests;
  if (avgInputPerRequest > 2000) {
    const optimizedCost = summary.totalCost * 0.7; // Assume 30% reduction possible
    recommendations.push({
      type: 'prompt_optimization',
      title: 'Optimize prompt length',
      description:
        `Your average prompt is ${Math.round(avgInputPerRequest)} tokens. ` +
        `Consider shorter system prompts or using summarization.`,
      currentCost: summary.totalCost,
      potentialCost: optimizedCost,
      estimatedSavings: summary.totalCost - optimizedCost,
    });
  }

  return recommendations.sort((a, b) => b.estimatedSavings - a.estimatedSavings);
}
