/**
 * Dynamic Skill & Role System
 *
 * Allows the AI assistant to dynamically develop, store, and use skills and roles.
 *
 * CONCEPTS:
 * - Skills: Specific capabilities with instructions (e.g., "write Python code")
 * - Roles: Personas the AI can adopt (e.g., "financial advisor")
 * - Instructions: Custom system prompts for specific scenarios
 * - Triggers: Conditions that activate skills/roles
 *
 * FEATURES:
 * - Dynamic skill creation and storage
 * - Role-based context switching
 * - Skill composition (combine multiple skills)
 * - Learning from feedback
 * - Export/import skills
 */

import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

// =============================================================================
// Types
// =============================================================================

/**
 * Skill category
 */
export type SkillCategory =
  | 'coding'
  | 'writing'
  | 'analysis'
  | 'communication'
  | 'research'
  | 'creativity'
  | 'organization'
  | 'teaching'
  | 'translation'
  | 'custom';

/**
 * Skill proficiency level
 */
export type SkillProficiency = 'beginner' | 'intermediate' | 'advanced' | 'expert';

/**
 * A skill definition
 */
export interface Skill {
  /** Unique skill ID */
  id: string;
  /** Skill name */
  name: string;
  /** Description */
  description: string;
  /** Category */
  category: SkillCategory;
  /** System instructions for this skill */
  instructions: string;
  /** Example prompts that trigger this skill */
  exampleTriggers: string[];
  /** Keywords that help identify when to use this skill */
  keywords: string[];
  /** Required tools for this skill */
  requiredTools?: string[];
  /** Proficiency level */
  proficiency: SkillProficiency;
  /** Success rate based on feedback (0-1) */
  successRate: number;
  /** Times used */
  usageCount: number;
  /** User who created this */
  createdBy: string;
  /** Whether this is a system skill */
  isSystem: boolean;
  /** Whether skill is enabled */
  enabled: boolean;
  /** Created timestamp */
  createdAt: string;
  /** Updated timestamp */
  updatedAt: string;
  /** Tags */
  tags: string[];
  /** Parent skills (for composition) */
  parentSkills?: string[];
}

/**
 * A role/persona definition
 */
export interface Role {
  /** Unique role ID */
  id: string;
  /** Role name */
  name: string;
  /** Description */
  description: string;
  /** System prompt for this role */
  systemPrompt: string;
  /** Personality traits */
  personality: {
    tone: 'formal' | 'casual' | 'friendly' | 'professional' | 'empathetic';
    verbosity: 'concise' | 'balanced' | 'detailed';
    style: string[];
  };
  /** Skills associated with this role */
  skills: string[];
  /** Domains of expertise */
  domains: string[];
  /** Trigger phrases that activate this role */
  triggers: string[];
  /** User who created this */
  createdBy: string;
  /** Whether this is a system role */
  isSystem: boolean;
  /** Whether role is enabled */
  enabled: boolean;
  /** Created timestamp */
  createdAt: string;
  /** Updated timestamp */
  updatedAt: string;
  /** Usage count */
  usageCount: number;
}

/**
 * Custom instruction
 */
export interface CustomInstruction {
  /** Unique ID */
  id: string;
  /** User ID */
  userId: string;
  /** Instruction name */
  name: string;
  /** The instruction content */
  content: string;
  /** When to apply this instruction */
  applyWhen: 'always' | 'specific_topics' | 'specific_roles' | 'manual';
  /** Topics that trigger this instruction */
  topics?: string[];
  /** Roles that use this instruction */
  roles?: string[];
  /** Priority (higher = applied first) */
  priority: number;
  /** Whether enabled */
  enabled: boolean;
  /** Created timestamp */
  createdAt: string;
  /** Updated timestamp */
  updatedAt: string;
}

/**
 * Skill execution context
 */
export interface SkillContext {
  /** Active skills */
  activeSkills: Skill[];
  /** Active role (if any) */
  activeRole?: Role;
  /** Custom instructions to apply */
  instructions: CustomInstruction[];
  /** Combined system prompt */
  systemPrompt: string;
  /** Context metadata */
  metadata: Record<string, unknown>;
}

/**
 * Skill feedback
 */
export interface SkillFeedback {
  /** Skill ID */
  skillId: string;
  /** Whether the skill helped */
  helpful: boolean;
  /** Rating (1-5) */
  rating?: number;
  /** Feedback comment */
  comment?: string;
  /** Timestamp */
  timestamp: string;
}

// =============================================================================
// Built-in Skills
// =============================================================================

/**
 * Built-in system skills
 */
export const BUILTIN_SKILLS: Omit<Skill, 'id' | 'createdAt' | 'updatedAt'>[] = [
  {
    name: 'Python Developer',
    description: 'Write clean, efficient Python code with best practices',
    category: 'coding',
    instructions: `You are an expert Python developer. When writing Python code:
- Follow PEP 8 style guidelines
- Use type hints for function parameters and return types
- Write docstrings for functions and classes
- Handle exceptions appropriately
- Prefer list comprehensions over loops when readable
- Use f-strings for string formatting
- Consider performance and memory efficiency
- Write unit tests when appropriate`,
    exampleTriggers: ['write python', 'python script', 'python function'],
    keywords: ['python', 'py', 'script', 'pip', 'django', 'flask', 'pandas'],
    requiredTools: ['code_execute'],
    proficiency: 'expert',
    successRate: 1.0,
    usageCount: 0,
    createdBy: 'system',
    isSystem: true,
    enabled: true,
    tags: ['coding', 'python', 'programming'],
  },
  {
    name: 'TypeScript Developer',
    description: 'Write type-safe TypeScript code with modern patterns',
    category: 'coding',
    instructions: `You are an expert TypeScript developer. When writing TypeScript code:
- Use strict type checking
- Define interfaces and types for data structures
- Use generics when appropriate
- Prefer const assertions and as const
- Use discriminated unions for complex types
- Handle null/undefined safely
- Use async/await for asynchronous code
- Follow functional programming patterns when appropriate`,
    exampleTriggers: ['write typescript', 'ts code', 'typescript function'],
    keywords: ['typescript', 'ts', 'node', 'react', 'angular', 'vue', 'deno'],
    requiredTools: ['code_execute'],
    proficiency: 'expert',
    successRate: 1.0,
    usageCount: 0,
    createdBy: 'system',
    isSystem: true,
    enabled: true,
    tags: ['coding', 'typescript', 'javascript', 'programming'],
  },
  {
    name: 'Technical Writer',
    description: 'Write clear, well-structured technical documentation',
    category: 'writing',
    instructions: `You are an expert technical writer. When writing documentation:
- Use clear, concise language
- Structure content with headings and sections
- Include code examples where helpful
- Define technical terms
- Use numbered steps for procedures
- Include diagrams descriptions when helpful
- Consider the audience's technical level
- Add notes, warnings, and tips appropriately`,
    exampleTriggers: ['write documentation', 'document this', 'readme'],
    keywords: ['documentation', 'docs', 'readme', 'guide', 'tutorial', 'manual'],
    proficiency: 'expert',
    successRate: 1.0,
    usageCount: 0,
    createdBy: 'system',
    isSystem: true,
    enabled: true,
    tags: ['writing', 'documentation', 'technical'],
  },
  {
    name: 'Data Analyst',
    description: 'Analyze data and provide insights',
    category: 'analysis',
    instructions: `You are an expert data analyst. When analyzing data:
- Start by understanding the data structure
- Identify patterns, trends, and anomalies
- Calculate relevant statistics
- Create clear visualizations descriptions
- Consider data quality issues
- Draw actionable insights
- Present findings clearly
- Suggest next steps for deeper analysis`,
    exampleTriggers: ['analyze this data', 'data analysis', 'what does this data show'],
    keywords: ['data', 'analysis', 'statistics', 'trends', 'insights', 'metrics'],
    requiredTools: ['code_execute'],
    proficiency: 'expert',
    successRate: 1.0,
    usageCount: 0,
    createdBy: 'system',
    isSystem: true,
    enabled: true,
    tags: ['analysis', 'data', 'statistics'],
  },
  {
    name: 'Email Composer',
    description: 'Write professional and effective emails',
    category: 'communication',
    instructions: `You are an expert at writing professional emails. When composing emails:
- Match the tone to the context (formal/casual)
- Start with a clear subject line
- Keep the message concise and focused
- Use proper greeting and sign-off
- Structure content with clear paragraphs
- Include a clear call to action
- Proofread for grammar and clarity
- Consider cultural sensitivities`,
    exampleTriggers: ['write an email', 'compose email', 'email to'],
    keywords: ['email', 'mail', 'message', 'reply', 'forward'],
    proficiency: 'expert',
    successRate: 1.0,
    usageCount: 0,
    createdBy: 'system',
    isSystem: true,
    enabled: true,
    tags: ['communication', 'email', 'professional'],
  },
  {
    name: 'Research Assistant',
    description: 'Research topics and synthesize information',
    category: 'research',
    instructions: `You are an expert research assistant. When researching:
- Understand the research question clearly
- Search for relevant, reliable sources
- Cross-reference information
- Distinguish facts from opinions
- Summarize key findings
- Cite sources when possible
- Identify knowledge gaps
- Present balanced viewpoints`,
    exampleTriggers: ['research', 'find information about', 'look up'],
    keywords: ['research', 'find', 'search', 'learn about', 'information'],
    requiredTools: ['web_search', 'web_fetch'],
    proficiency: 'expert',
    successRate: 1.0,
    usageCount: 0,
    createdBy: 'system',
    isSystem: true,
    enabled: true,
    tags: ['research', 'information', 'learning'],
  },
  {
    name: 'Task Planner',
    description: 'Break down complex tasks and create action plans',
    category: 'organization',
    instructions: `You are an expert task planner. When planning:
- Understand the goal clearly
- Break down into smaller, manageable tasks
- Identify dependencies between tasks
- Estimate time and effort
- Prioritize by importance and urgency
- Consider resources needed
- Create milestones and checkpoints
- Account for potential risks`,
    exampleTriggers: ['plan this', 'break down', 'create a plan for'],
    keywords: ['plan', 'organize', 'breakdown', 'steps', 'tasks', 'schedule'],
    proficiency: 'expert',
    successRate: 1.0,
    usageCount: 0,
    createdBy: 'system',
    isSystem: true,
    enabled: true,
    tags: ['organization', 'planning', 'productivity'],
  },
  {
    name: 'Creative Writer',
    description: 'Write creative content with style and imagination',
    category: 'creativity',
    instructions: `You are a creative writer. When writing creatively:
- Engage the reader from the start
- Use vivid imagery and sensory details
- Develop compelling characters
- Create tension and resolution
- Vary sentence structure
- Show, don't tell
- Match style to genre
- Edit for flow and impact`,
    exampleTriggers: ['write a story', 'creative writing', 'write something creative'],
    keywords: ['story', 'creative', 'fiction', 'poem', 'narrative', 'write'],
    proficiency: 'expert',
    successRate: 1.0,
    usageCount: 0,
    createdBy: 'system',
    isSystem: true,
    enabled: true,
    tags: ['creativity', 'writing', 'storytelling'],
  },
  {
    name: 'Code Reviewer',
    description: 'Review code for quality, security, and best practices',
    category: 'coding',
    instructions: `You are an expert code reviewer. When reviewing code:
- Check for correctness and logic errors
- Identify security vulnerabilities
- Evaluate code style and readability
- Look for performance issues
- Suggest improvements
- Check for proper error handling
- Verify test coverage
- Provide constructive feedback`,
    exampleTriggers: ['review this code', 'code review', 'check my code'],
    keywords: ['review', 'check', 'audit', 'code quality', 'bugs'],
    proficiency: 'expert',
    successRate: 1.0,
    usageCount: 0,
    createdBy: 'system',
    isSystem: true,
    enabled: true,
    tags: ['coding', 'review', 'quality'],
  },
  {
    name: 'Translator',
    description: 'Translate text between languages accurately',
    category: 'translation',
    instructions: `You are an expert translator. When translating:
- Preserve the original meaning
- Adapt idioms and cultural references
- Maintain the tone and style
- Handle ambiguity appropriately
- Use natural phrasing in target language
- Note untranslatable terms
- Consider context and audience
- Provide alternatives when needed`,
    exampleTriggers: ['translate', 'say in', 'how do you say'],
    keywords: ['translate', 'translation', 'language', 'convert'],
    proficiency: 'expert',
    successRate: 1.0,
    usageCount: 0,
    createdBy: 'system',
    isSystem: true,
    enabled: true,
    tags: ['translation', 'language', 'communication'],
  },
];

/**
 * Built-in roles
 */
export const BUILTIN_ROLES: Omit<Role, 'id' | 'createdAt' | 'updatedAt'>[] = [
  {
    name: 'Personal Assistant',
    description: 'Helpful, friendly personal assistant for everyday tasks',
    systemPrompt: `You are a helpful personal assistant. Your goal is to help with everyday tasks while being friendly and efficient. You:
- Remember context from our conversations
- Anticipate needs and offer proactive help
- Keep responses concise but complete
- Ask clarifying questions when needed
- Maintain a warm, supportive tone`,
    personality: {
      tone: 'friendly',
      verbosity: 'balanced',
      style: ['helpful', 'proactive', 'supportive'],
    },
    skills: [],
    domains: ['general', 'organization', 'communication'],
    triggers: ['help me', 'can you', 'I need'],
    createdBy: 'system',
    isSystem: true,
    enabled: true,
    usageCount: 0,
  },
  {
    name: 'Senior Developer',
    description: 'Expert software developer for coding tasks',
    systemPrompt: `You are a senior software developer with expertise across multiple languages and frameworks. You:
- Write clean, maintainable code
- Follow best practices and design patterns
- Consider performance and security
- Provide thorough explanations
- Review code critically
- Suggest improvements`,
    personality: {
      tone: 'professional',
      verbosity: 'detailed',
      style: ['technical', 'thorough', 'educational'],
    },
    skills: [],
    domains: ['coding', 'architecture', 'debugging'],
    triggers: ['code', 'programming', 'develop', 'build'],
    createdBy: 'system',
    isSystem: true,
    enabled: true,
    usageCount: 0,
  },
  {
    name: 'Writing Coach',
    description: 'Expert writing coach for improving written content',
    systemPrompt: `You are an expert writing coach. Your role is to help improve writing skills and create better content. You:
- Provide constructive feedback
- Suggest specific improvements
- Explain writing principles
- Help with structure and flow
- Adapt to the writer's style
- Encourage and motivate`,
    personality: {
      tone: 'empathetic',
      verbosity: 'detailed',
      style: ['educational', 'encouraging', 'constructive'],
    },
    skills: [],
    domains: ['writing', 'editing', 'storytelling'],
    triggers: ['write', 'edit', 'improve my writing', 'draft'],
    createdBy: 'system',
    isSystem: true,
    enabled: true,
    usageCount: 0,
  },
  {
    name: 'Business Analyst',
    description: 'Analytical thinker for business and strategy',
    systemPrompt: `You are a business analyst with expertise in strategy and operations. You:
- Analyze situations from multiple angles
- Identify opportunities and risks
- Provide data-driven insights
- Create actionable recommendations
- Consider stakeholder perspectives
- Think strategically`,
    personality: {
      tone: 'professional',
      verbosity: 'balanced',
      style: ['analytical', 'strategic', 'objective'],
    },
    skills: [],
    domains: ['business', 'analysis', 'strategy'],
    triggers: ['analyze', 'business', 'strategy', 'evaluate'],
    createdBy: 'system',
    isSystem: true,
    enabled: true,
    usageCount: 0,
  },
];

// =============================================================================
// Skill Manager
// =============================================================================

/**
 * Skill & Role Manager
 */
export class SkillManager {
  private readonly userId: string;
  private readonly storageDir: string;
  private skills: Map<string, Skill> = new Map();
  private roles: Map<string, Role> = new Map();
  private instructions: Map<string, CustomInstruction> = new Map();
  private activeRole?: Role;
  private initialized = false;

  constructor(userId: string, storageDir?: string) {
    this.userId = userId;
    const homeDir = process.env.HOME ?? process.env.USERPROFILE ?? '.';
    this.storageDir = storageDir ?? path.join(homeDir, '.ownpilot', 'skills', userId);
  }

  /**
   * Initialize the skill manager
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    await fs.mkdir(this.storageDir, { recursive: true });
    await this.loadSkills();
    await this.loadRoles();
    await this.loadInstructions();
    await this.ensureBuiltins();
    this.initialized = true;
  }

  // ===========================================================================
  // Skill Management
  // ===========================================================================

  /**
   * Add a new skill
   */
  async addSkill(
    skill: Omit<Skill, 'id' | 'createdAt' | 'updatedAt' | 'usageCount' | 'successRate'>
  ): Promise<Skill> {
    await this.ensureInitialized();

    const now = new Date().toISOString();
    const entry: Skill = {
      ...skill,
      id: `skill_${randomUUID()}`,
      usageCount: 0,
      successRate: 1.0,
      createdAt: now,
      updatedAt: now,
    };

    this.skills.set(entry.id, entry);
    await this.saveSkills();

    return entry;
  }

  /**
   * Update a skill
   */
  async updateSkill(id: string, updates: Partial<Skill>): Promise<Skill | null> {
    const skill = this.skills.get(id);
    if (!skill || skill.isSystem) return null;

    const updated: Skill = {
      ...skill,
      ...updates,
      id: skill.id,
      createdAt: skill.createdAt,
      updatedAt: new Date().toISOString(),
    };

    this.skills.set(id, updated);
    await this.saveSkills();

    return updated;
  }

  /**
   * Delete a skill
   */
  async deleteSkill(id: string): Promise<boolean> {
    const skill = this.skills.get(id);
    if (!skill || skill.isSystem) return false;

    this.skills.delete(id);
    await this.saveSkills();

    return true;
  }

  /**
   * Get a skill by ID
   */
  getSkill(id: string): Skill | undefined {
    return this.skills.get(id);
  }

  /**
   * Get all skills
   */
  getAllSkills(): Skill[] {
    return Array.from(this.skills.values());
  }

  /**
   * Get skills by category
   */
  getSkillsByCategory(category: SkillCategory): Skill[] {
    return Array.from(this.skills.values())
      .filter(s => s.category === category && s.enabled);
  }

  /**
   * Find relevant skills for a prompt
   */
  findRelevantSkills(prompt: string, maxSkills: number = 3): Skill[] {
    const promptLower = prompt.toLowerCase();
    const scores: Array<{ skill: Skill; score: number }> = [];

    for (const skill of this.skills.values()) {
      if (!skill.enabled) continue;

      let score = 0;

      // Check keywords
      for (const keyword of skill.keywords) {
        if (promptLower.includes(keyword.toLowerCase())) {
          score += 2;
        }
      }

      // Check example triggers
      for (const trigger of skill.exampleTriggers) {
        if (promptLower.includes(trigger.toLowerCase())) {
          score += 3;
        }
      }

      // Check tags
      for (const tag of skill.tags) {
        if (promptLower.includes(tag.toLowerCase())) {
          score += 1;
        }
      }

      // Boost by proficiency and success rate
      score *= (1 + skill.successRate * 0.5);

      if (score > 0) {
        scores.push({ skill, score });
      }
    }

    return scores
      .sort((a, b) => b.score - a.score)
      .slice(0, maxSkills)
      .map(s => s.skill);
  }

  /**
   * Record skill usage
   */
  async recordSkillUsage(skillId: string, feedback?: SkillFeedback): Promise<void> {
    const skill = this.skills.get(skillId);
    if (!skill) return;

    skill.usageCount++;
    skill.updatedAt = new Date().toISOString();

    if (feedback) {
      // Update success rate with exponential moving average
      const newSuccess = feedback.helpful ? 1 : 0;
      skill.successRate = skill.successRate * 0.9 + newSuccess * 0.1;
    }

    await this.saveSkills();
  }

  // ===========================================================================
  // Role Management
  // ===========================================================================

  /**
   * Add a new role
   */
  async addRole(
    role: Omit<Role, 'id' | 'createdAt' | 'updatedAt' | 'usageCount'>
  ): Promise<Role> {
    await this.ensureInitialized();

    const now = new Date().toISOString();
    const entry: Role = {
      ...role,
      id: `role_${randomUUID()}`,
      usageCount: 0,
      createdAt: now,
      updatedAt: now,
    };

    this.roles.set(entry.id, entry);
    await this.saveRoles();

    return entry;
  }

  /**
   * Update a role
   */
  async updateRole(id: string, updates: Partial<Role>): Promise<Role | null> {
    const role = this.roles.get(id);
    if (!role || role.isSystem) return null;

    const updated: Role = {
      ...role,
      ...updates,
      id: role.id,
      createdAt: role.createdAt,
      updatedAt: new Date().toISOString(),
    };

    this.roles.set(id, updated);
    await this.saveRoles();

    return updated;
  }

  /**
   * Delete a role
   */
  async deleteRole(id: string): Promise<boolean> {
    const role = this.roles.get(id);
    if (!role || role.isSystem) return false;

    this.roles.delete(id);
    await this.saveRoles();

    return true;
  }

  /**
   * Get a role by ID
   */
  getRole(id: string): Role | undefined {
    return this.roles.get(id);
  }

  /**
   * Get all roles
   */
  getAllRoles(): Role[] {
    return Array.from(this.roles.values());
  }

  /**
   * Find relevant role for a prompt
   */
  findRelevantRole(prompt: string): Role | undefined {
    const promptLower = prompt.toLowerCase();

    let bestRole: Role | undefined;
    let bestScore = 0;

    for (const role of this.roles.values()) {
      if (!role.enabled) continue;

      let score = 0;

      // Check triggers
      for (const trigger of role.triggers) {
        if (promptLower.includes(trigger.toLowerCase())) {
          score += 3;
        }
      }

      // Check domains
      for (const domain of role.domains) {
        if (promptLower.includes(domain.toLowerCase())) {
          score += 2;
        }
      }

      if (score > bestScore) {
        bestScore = score;
        bestRole = role;
      }
    }

    return bestRole;
  }

  /**
   * Set active role
   */
  setActiveRole(roleId: string | undefined): void {
    if (roleId) {
      this.activeRole = this.roles.get(roleId);
      if (this.activeRole) {
        this.activeRole.usageCount++;
      }
    } else {
      this.activeRole = undefined;
    }
  }

  /**
   * Get active role
   */
  getActiveRole(): Role | undefined {
    return this.activeRole;
  }

  // ===========================================================================
  // Custom Instructions
  // ===========================================================================

  /**
   * Add a custom instruction
   */
  async addInstruction(
    instruction: Omit<CustomInstruction, 'id' | 'userId' | 'createdAt' | 'updatedAt'>
  ): Promise<CustomInstruction> {
    await this.ensureInitialized();

    const now = new Date().toISOString();
    const entry: CustomInstruction = {
      ...instruction,
      id: `instr_${randomUUID()}`,
      userId: this.userId,
      createdAt: now,
      updatedAt: now,
    };

    this.instructions.set(entry.id, entry);
    await this.saveInstructions();

    return entry;
  }

  /**
   * Update an instruction
   */
  async updateInstruction(
    id: string,
    updates: Partial<CustomInstruction>
  ): Promise<CustomInstruction | null> {
    const instruction = this.instructions.get(id);
    if (!instruction) return null;

    const updated: CustomInstruction = {
      ...instruction,
      ...updates,
      id: instruction.id,
      userId: instruction.userId,
      createdAt: instruction.createdAt,
      updatedAt: new Date().toISOString(),
    };

    this.instructions.set(id, updated);
    await this.saveInstructions();

    return updated;
  }

  /**
   * Delete an instruction
   */
  async deleteInstruction(id: string): Promise<boolean> {
    const deleted = this.instructions.delete(id);
    if (deleted) {
      await this.saveInstructions();
    }
    return deleted;
  }

  /**
   * Get applicable instructions for a context
   */
  getApplicableInstructions(topics?: string[], roleId?: string): CustomInstruction[] {
    const results: CustomInstruction[] = [];

    for (const instruction of this.instructions.values()) {
      if (!instruction.enabled) continue;

      switch (instruction.applyWhen) {
        case 'always':
          results.push(instruction);
          break;
        case 'specific_topics':
          if (topics && instruction.topics?.some(t => topics.includes(t))) {
            results.push(instruction);
          }
          break;
        case 'specific_roles':
          if (roleId && instruction.roles?.includes(roleId)) {
            results.push(instruction);
          }
          break;
      }
    }

    return results.sort((a, b) => b.priority - a.priority);
  }

  // ===========================================================================
  // Context Building
  // ===========================================================================

  /**
   * Build skill context for a prompt
   */
  buildContext(prompt: string, topics?: string[]): SkillContext {
    // Find relevant skills
    const activeSkills = this.findRelevantSkills(prompt);

    // Find relevant role (or use active)
    const role = this.activeRole ?? this.findRelevantRole(prompt);

    // Get applicable instructions
    const instructions = this.getApplicableInstructions(topics, role?.id);

    // Build combined system prompt
    const systemPromptParts: string[] = [];

    // Add role prompt
    if (role) {
      systemPromptParts.push(`## Role: ${role.name}\n${role.systemPrompt}`);
    }

    // Add skill instructions
    if (activeSkills.length > 0) {
      systemPromptParts.push('## Active Skills');
      for (const skill of activeSkills) {
        systemPromptParts.push(`### ${skill.name}\n${skill.instructions}`);
      }
    }

    // Add custom instructions
    if (instructions.length > 0) {
      systemPromptParts.push('## Custom Instructions');
      for (const instruction of instructions) {
        systemPromptParts.push(`### ${instruction.name}\n${instruction.content}`);
      }
    }

    return {
      activeSkills,
      activeRole: role,
      instructions,
      systemPrompt: systemPromptParts.join('\n\n'),
      metadata: {
        timestamp: new Date().toISOString(),
        userId: this.userId,
      },
    };
  }

  // ===========================================================================
  // Private Helpers
  // ===========================================================================

  private async ensureInitialized(): Promise<void> {
    if (!this.initialized) {
      await this.initialize();
    }
  }

  private async ensureBuiltins(): Promise<void> {
    // Add builtin skills if not present
    const existingSkillNames = new Set(Array.from(this.skills.values()).map(s => s.name));
    for (const builtin of BUILTIN_SKILLS) {
      if (!existingSkillNames.has(builtin.name)) {
        const now = new Date().toISOString();
        const skill: Skill = {
          ...builtin,
          id: `skill_builtin_${builtin.name.toLowerCase().replace(/\s+/g, '_')}`,
          createdAt: now,
          updatedAt: now,
        };
        this.skills.set(skill.id, skill);
      }
    }

    // Add builtin roles if not present
    const existingRoleNames = new Set(Array.from(this.roles.values()).map(r => r.name));
    for (const builtin of BUILTIN_ROLES) {
      if (!existingRoleNames.has(builtin.name)) {
        const now = new Date().toISOString();
        const role: Role = {
          ...builtin,
          id: `role_builtin_${builtin.name.toLowerCase().replace(/\s+/g, '_')}`,
          createdAt: now,
          updatedAt: now,
        };
        this.roles.set(role.id, role);
      }
    }

    await this.saveSkills();
    await this.saveRoles();
  }

  private async loadSkills(): Promise<void> {
    const filePath = path.join(this.storageDir, 'skills.json');
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      const skills = JSON.parse(content) as Skill[];
      this.skills = new Map(skills.map(s => [s.id, s]));
    } catch {
      this.skills = new Map();
    }
  }

  private async saveSkills(): Promise<void> {
    const filePath = path.join(this.storageDir, 'skills.json');
    const skills = Array.from(this.skills.values());
    await fs.writeFile(filePath, JSON.stringify(skills, null, 2), 'utf-8');
  }

  private async loadRoles(): Promise<void> {
    const filePath = path.join(this.storageDir, 'roles.json');
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      const roles = JSON.parse(content) as Role[];
      this.roles = new Map(roles.map(r => [r.id, r]));
    } catch {
      this.roles = new Map();
    }
  }

  private async saveRoles(): Promise<void> {
    const filePath = path.join(this.storageDir, 'roles.json');
    const roles = Array.from(this.roles.values());
    await fs.writeFile(filePath, JSON.stringify(roles, null, 2), 'utf-8');
  }

  private async loadInstructions(): Promise<void> {
    const filePath = path.join(this.storageDir, 'instructions.json');
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      const instructions = JSON.parse(content) as CustomInstruction[];
      this.instructions = new Map(instructions.map(i => [i.id, i]));
    } catch {
      this.instructions = new Map();
    }
  }

  private async saveInstructions(): Promise<void> {
    const filePath = path.join(this.storageDir, 'instructions.json');
    const instructions = Array.from(this.instructions.values());
    await fs.writeFile(filePath, JSON.stringify(instructions, null, 2), 'utf-8');
  }
}

// =============================================================================
// Factory Functions
// =============================================================================

/**
 * Create a skill manager
 */
export function createSkillManager(userId: string, storageDir?: string): SkillManager {
  return new SkillManager(userId, storageDir);
}

/**
 * Skill manager cache (one per user)
 */
const skillManagerCache = new Map<string, SkillManager>();

/**
 * Get or create skill manager for a user
 */
export async function getSkillManager(userId: string): Promise<SkillManager> {
  let manager = skillManagerCache.get(userId);
  if (!manager) {
    manager = createSkillManager(userId);
    await manager.initialize();
    skillManagerCache.set(userId, manager);
  }
  return manager;
}
