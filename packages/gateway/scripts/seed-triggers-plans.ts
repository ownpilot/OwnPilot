/**
 * Seed Script for Triggers and Plans
 *
 * Run with: npx tsx scripts/seed-triggers-plans.ts
 * Or via API if server is running
 */

const API_BASE = process.env.API_URL || 'http://localhost:3001/api';

interface TriggerInput {
  name: string;
  description?: string;
  type: 'schedule' | 'event' | 'condition' | 'webhook';
  config: Record<string, unknown>;
  action: {
    type: 'chat' | 'tool' | 'notification' | 'goal_check' | 'memory_summary';
    payload: Record<string, unknown>;
  };
  enabled?: boolean;
  priority?: number;
}

interface PlanInput {
  name: string;
  description?: string;
  goal: string;
  priority?: number;
  autonomyLevel?: number;
  metadata?: Record<string, unknown>;
}

interface StepInput {
  orderNum: number;
  type: 'tool_call' | 'llm_decision' | 'user_input' | 'condition';
  name: string;
  description?: string;
  config: Record<string, unknown>;
}

// ============================================================================
// Sample Triggers
// ============================================================================

const sampleTriggers: TriggerInput[] = [
  // Schedule Triggers
  {
    name: 'Daily Morning Summary',
    description: 'Get a summary of tasks and calendar for the day every morning',
    type: 'schedule',
    config: {
      cron: '0 8 * * *', // Every day at 8 AM
      timezone: 'Europe/Istanbul',
    },
    action: {
      type: 'chat',
      payload: {
        message: 'Good morning! Please give me a summary of my tasks and calendar for today.',
        agentId: 'default',
      },
    },
    enabled: true,
    priority: 5,
  },
  {
    name: 'Weekly Review',
    description: 'Weekly review of goals and progress every Sunday',
    type: 'schedule',
    config: {
      cron: '0 18 * * 0', // Every Sunday at 6 PM
      timezone: 'Europe/Istanbul',
    },
    action: {
      type: 'goal_check',
      payload: {
        reviewType: 'weekly',
        includeMetrics: true,
      },
    },
    enabled: true,
    priority: 3,
  },
  {
    name: 'Memory Consolidation',
    description: 'Consolidate and summarize memories every night',
    type: 'schedule',
    config: {
      cron: '0 2 * * *', // Every day at 2 AM
      timezone: 'Europe/Istanbul',
    },
    action: {
      type: 'memory_summary',
      payload: {
        maxAge: 7, // days
        categories: ['conversation', 'preference', 'fact'],
      },
    },
    enabled: false,
    priority: 2,
  },

  // Event Triggers
  {
    name: 'Goal Completed Celebration',
    description: 'Send a congratulation when a goal is marked complete',
    type: 'event',
    config: {
      eventType: 'goal_completed',
      filters: {
        priority: { $gte: 3 },
      },
    },
    action: {
      type: 'notification',
      payload: {
        title: 'Goal Achieved!',
        template: 'Congratulations! You completed: {{goalTitle}}',
        channel: 'push',
      },
    },
    enabled: true,
    priority: 4,
  },
  {
    name: 'High Priority Message Alert',
    description: 'Alert when receiving urgent messages',
    type: 'event',
    config: {
      eventType: 'message_received',
      filters: {
        priority: 'high',
        channel: ['email', 'telegram'],
      },
    },
    action: {
      type: 'notification',
      payload: {
        title: 'Urgent Message',
        sound: true,
        vibrate: true,
      },
    },
    enabled: true,
    priority: 5,
  },
  {
    name: 'New Memory Learning',
    description: 'Process and categorize new memories automatically',
    type: 'event',
    config: {
      eventType: 'memory_added',
      filters: {
        type: 'fact',
      },
    },
    action: {
      type: 'tool',
      payload: {
        toolName: 'categorize_memory',
        autoApprove: true,
      },
    },
    enabled: false,
    priority: 2,
  },

  // Condition Triggers
  {
    name: 'Stale Goals Reminder',
    description: 'Remind about goals that have not been updated for a while',
    type: 'condition',
    config: {
      condition: 'stale_goals',
      threshold: 7, // days
      checkInterval: 60, // check every hour
    },
    action: {
      type: 'chat',
      payload: {
        message:
          'I noticed some of your goals have not been updated recently. Would you like to review them?',
        includeContext: true,
      },
    },
    enabled: true,
    priority: 3,
  },
  {
    name: 'Deadline Approaching',
    description: 'Alert when task deadline is approaching',
    type: 'condition',
    config: {
      condition: 'upcoming_deadline',
      threshold: 24, // hours
      checkInterval: 30, // check every 30 minutes
    },
    action: {
      type: 'notification',
      payload: {
        title: 'Deadline Approaching',
        template: 'Task "{{taskTitle}}" is due in {{hoursRemaining}} hours',
        priority: 'high',
      },
    },
    enabled: true,
    priority: 5,
  },
  {
    name: 'Memory Storage Check',
    description: 'Check if memory storage is getting full',
    type: 'condition',
    config: {
      condition: 'memory_threshold',
      threshold: 80, // percent
      checkInterval: 1440, // check daily
    },
    action: {
      type: 'notification',
      payload: {
        title: 'Memory Storage Alert',
        message: 'Memory storage is above 80%. Consider archiving old memories.',
      },
    },
    enabled: false,
    priority: 2,
  },

  // Webhook Triggers
  {
    name: 'GitHub Webhook',
    description: 'Process GitHub webhooks for repository events',
    type: 'webhook',
    config: {
      secret: 'github-webhook-secret',
      allowedSources: ['api.github.com'],
    },
    action: {
      type: 'chat',
      payload: {
        template: 'GitHub event received: {{event.type}} on {{event.repository}}',
        processAutomatically: true,
      },
    },
    enabled: false,
    priority: 3,
  },
  {
    name: 'External API Webhook',
    description: 'Generic webhook for external integrations',
    type: 'webhook',
    config: {
      secret: 'external-webhook-secret',
      allowedSources: ['*'],
    },
    action: {
      type: 'tool',
      payload: {
        toolName: 'process_webhook',
        validateSchema: true,
      },
    },
    enabled: false,
    priority: 2,
  },
];

// ============================================================================
// Sample Plans
// ============================================================================

interface PlanWithSteps {
  plan: PlanInput;
  steps: StepInput[];
}

const samplePlans: PlanWithSteps[] = [
  {
    plan: {
      name: 'Morning Routine Analysis',
      description: 'Analyze calendar and tasks, provide daily briefing',
      goal: 'Provide a comprehensive morning briefing with tasks, calendar events, and priorities',
      priority: 4,
      autonomyLevel: 3,
      metadata: {
        category: 'productivity',
        recurring: true,
      },
    },
    steps: [
      {
        orderNum: 1,
        type: 'tool_call',
        name: 'Fetch Calendar Events',
        description: "Get today's calendar events",
        config: {
          toolName: 'calendar_list',
          toolArgs: {
            startDate: 'today',
            endDate: 'today',
          },
        },
      },
      {
        orderNum: 2,
        type: 'tool_call',
        name: 'Fetch Tasks',
        description: 'Get pending tasks',
        config: {
          toolName: 'tasks_list',
          toolArgs: {
            status: 'pending',
            sortBy: 'priority',
          },
        },
      },
      {
        orderNum: 3,
        type: 'llm_decision',
        name: 'Prioritize',
        description: 'Analyze and prioritize the day',
        config: {
          prompt:
            'Based on the calendar events and tasks, create a prioritized plan for the day. Consider deadlines, importance, and time blocks.',
          choices: ['high_priority', 'normal_priority', 'can_defer'],
        },
      },
      {
        orderNum: 4,
        type: 'tool_call',
        name: 'Send Briefing',
        description: 'Send the morning briefing',
        config: {
          toolName: 'send_notification',
          toolArgs: {
            title: 'Morning Briefing',
            channel: 'push',
          },
        },
      },
    ],
  },
  {
    plan: {
      name: 'Weekly Goal Review',
      description: 'Comprehensive weekly review of all active goals',
      goal: 'Review progress on all active goals and adjust priorities',
      priority: 3,
      autonomyLevel: 2,
      metadata: {
        category: 'goals',
        recurring: true,
        frequency: 'weekly',
      },
    },
    steps: [
      {
        orderNum: 1,
        type: 'tool_call',
        name: 'Fetch Active Goals',
        description: 'Get all active goals',
        config: {
          toolName: 'goals_list',
          toolArgs: {
            status: 'active',
          },
        },
      },
      {
        orderNum: 2,
        type: 'tool_call',
        name: 'Fetch Goal Progress',
        description: 'Calculate progress for each goal',
        config: {
          toolName: 'goals_progress',
          toolArgs: {
            includeSubgoals: true,
          },
        },
      },
      {
        orderNum: 3,
        type: 'llm_decision',
        name: 'Analyze Progress',
        description: 'Analyze goal progress and identify blockers',
        config: {
          prompt:
            'Analyze the progress on each goal. Identify goals that are behind schedule, goals that are on track, and any blockers that need attention.',
        },
      },
      {
        orderNum: 4,
        type: 'user_input',
        name: 'User Feedback',
        description: 'Ask user for feedback on goals',
        config: {
          question:
            'Would you like to adjust any goal priorities or deadlines based on this review?',
          inputType: 'choice',
          options: ['Adjust priorities', 'Extend deadlines', 'Mark some complete', 'Keep as is'],
          timeout: 86400000, // 24 hours
        },
      },
      {
        orderNum: 5,
        type: 'condition',
        name: 'Check User Response',
        description: 'Process user feedback',
        config: {
          condition: "userInput !== 'Keep as is'",
          trueStep: 'apply_changes',
          falseStep: 'complete',
        },
      },
    ],
  },
  {
    plan: {
      name: 'Email Processing Pipeline',
      description: 'Automatically process and categorize incoming emails',
      goal: 'Process unread emails, categorize them, and prepare responses',
      priority: 4,
      autonomyLevel: 4,
      metadata: {
        category: 'communication',
        source: 'email',
      },
    },
    steps: [
      {
        orderNum: 1,
        type: 'tool_call',
        name: 'Fetch Unread Emails',
        description: 'Get unread emails from inbox',
        config: {
          toolName: 'email_fetch',
          toolArgs: {
            status: 'unread',
            limit: 20,
          },
        },
      },
      {
        orderNum: 2,
        type: 'llm_decision',
        name: 'Categorize Emails',
        description: 'Categorize emails by urgency and type',
        config: {
          prompt:
            'Categorize each email into: urgent, important, newsletter, spam, personal. For urgent and important emails, suggest a brief response.',
          choices: ['urgent', 'important', 'newsletter', 'spam', 'personal'],
        },
      },
      {
        orderNum: 3,
        type: 'condition',
        name: 'Check Urgent',
        description: 'Check if there are urgent emails',
        config: {
          condition: 'urgentCount > 0',
          trueStep: 'notify_urgent',
          falseStep: 'process_normal',
        },
      },
      {
        orderNum: 4,
        type: 'tool_call',
        name: 'Send Urgent Alert',
        description: 'Alert about urgent emails',
        config: {
          toolName: 'send_notification',
          toolArgs: {
            priority: 'high',
            sound: true,
          },
        },
      },
      {
        orderNum: 5,
        type: 'tool_call',
        name: 'Archive Newsletters',
        description: 'Auto-archive newsletter emails',
        config: {
          toolName: 'email_archive',
          toolArgs: {
            category: 'newsletter',
          },
        },
      },
    ],
  },
  {
    plan: {
      name: 'Code Review Assistant',
      description: 'Assist with code review process',
      goal: 'Review code changes and provide feedback',
      priority: 3,
      autonomyLevel: 2,
      metadata: {
        category: 'development',
        requiresApproval: true,
      },
    },
    steps: [
      {
        orderNum: 1,
        type: 'user_input',
        name: 'Get PR URL',
        description: 'Ask for the pull request URL',
        config: {
          question: 'Please provide the pull request URL or paste the code diff:',
          inputType: 'text',
        },
      },
      {
        orderNum: 2,
        type: 'tool_call',
        name: 'Fetch PR Details',
        description: 'Fetch pull request details',
        config: {
          toolName: 'github_pr_fetch',
          toolArgs: {},
        },
      },
      {
        orderNum: 3,
        type: 'llm_decision',
        name: 'Review Code',
        description: 'Analyze code and provide review',
        config: {
          prompt:
            'Review the code changes. Look for: bugs, security issues, performance problems, code style, and best practices. Provide specific line-by-line feedback where needed.',
        },
      },
      {
        orderNum: 4,
        type: 'user_input',
        name: 'Confirm Feedback',
        description: 'Confirm before posting feedback',
        config: {
          question: 'Here is my review. Should I post it as a comment on the PR?',
          inputType: 'confirm',
        },
      },
      {
        orderNum: 5,
        type: 'condition',
        name: 'Check Approval',
        description: 'Check if user approved posting',
        config: {
          condition: 'userConfirmed === true',
          trueStep: 'post_review',
          falseStep: 'skip_post',
        },
      },
      {
        orderNum: 6,
        type: 'tool_call',
        name: 'Post Review',
        description: 'Post review comment on PR',
        config: {
          toolName: 'github_comment_post',
          toolArgs: {},
        },
      },
    ],
  },
  {
    plan: {
      name: 'Research Topic Deep Dive',
      description: 'Research a topic comprehensively',
      goal: 'Gather information about a topic from multiple sources and summarize',
      priority: 2,
      autonomyLevel: 3,
      metadata: {
        category: 'research',
      },
    },
    steps: [
      {
        orderNum: 1,
        type: 'user_input',
        name: 'Get Topic',
        description: 'Ask for research topic',
        config: {
          question: 'What topic would you like me to research?',
          inputType: 'text',
        },
      },
      {
        orderNum: 2,
        type: 'tool_call',
        name: 'Web Search',
        description: 'Search the web for information',
        config: {
          toolName: 'web_search',
          toolArgs: {
            maxResults: 10,
          },
        },
      },
      {
        orderNum: 3,
        type: 'tool_call',
        name: 'Fetch Articles',
        description: 'Fetch content from top results',
        config: {
          toolName: 'web_fetch',
          toolArgs: {
            maxArticles: 5,
          },
        },
      },
      {
        orderNum: 4,
        type: 'tool_call',
        name: 'Check Memories',
        description: 'Check if we have relevant memories',
        config: {
          toolName: 'memory_search',
          toolArgs: {
            limit: 10,
          },
        },
      },
      {
        orderNum: 5,
        type: 'llm_decision',
        name: 'Synthesize',
        description: 'Synthesize information into a summary',
        config: {
          prompt:
            'Synthesize all gathered information into a comprehensive summary. Include: key facts, different perspectives, sources, and areas that need more research.',
        },
      },
      {
        orderNum: 6,
        type: 'tool_call',
        name: 'Save to Notes',
        description: 'Save research to notes',
        config: {
          toolName: 'notes_create',
          toolArgs: {
            category: 'research',
          },
        },
      },
      {
        orderNum: 7,
        type: 'tool_call',
        name: 'Create Memory',
        description: 'Store key facts as memories',
        config: {
          toolName: 'memory_create',
          toolArgs: {
            type: 'fact',
            extractKeyFacts: true,
          },
        },
      },
    ],
  },
];

// ============================================================================
// Seed Functions
// ============================================================================

async function seedTriggers() {
  console.log('Seeding triggers...');

  for (const trigger of sampleTriggers) {
    try {
      const response = await fetch(`${API_BASE}/triggers`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(trigger),
      });

      const result = await response.json();
      if (result.success) {
        console.log(`  Created trigger: ${trigger.name}`);
      } else {
        console.error(`  Failed to create trigger ${trigger.name}:`, result.error);
      }
    } catch (error) {
      console.error(`  Error creating trigger ${trigger.name}:`, error);
    }
  }
}

async function seedPlans() {
  console.log('Seeding plans...');

  for (const { plan, steps } of samplePlans) {
    try {
      // Create the plan
      const planResponse = await fetch(`${API_BASE}/plans`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(plan),
      });

      const planResult = await planResponse.json();
      if (!planResult.success) {
        console.error(`  Failed to create plan ${plan.name}:`, planResult.error);
        continue;
      }

      const planId = planResult.data.plan.id;
      console.log(`  Created plan: ${plan.name} (${planId})`);

      // Add steps
      for (const step of steps) {
        const stepResponse = await fetch(`${API_BASE}/plans/${planId}/steps`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(step),
        });

        const stepResult = await stepResponse.json();
        if (stepResult.success) {
          console.log(`    Added step: ${step.name}`);
        } else {
          console.error(`    Failed to add step ${step.name}:`, stepResult.error);
        }
      }
    } catch (error) {
      console.error(`  Error creating plan ${plan.name}:`, error);
    }
  }
}

async function main() {
  console.log('Starting seed process...');
  console.log(`API Base: ${API_BASE}\n`);

  await seedTriggers();
  console.log('');
  await seedPlans();

  console.log('\nSeed process completed!');
}

main().catch(console.error);
