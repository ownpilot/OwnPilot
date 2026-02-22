/**
 * Core Tool Definitions
 *
 * Contains CORE_TOOLS — the tool definitions (schemas) for built-in utility tools.
 * Executors are in core-tool-executors.ts.
 */

import type { ToolDefinition } from './types.js';

/**
 * Built-in core tools
 */
export const CORE_TOOLS: readonly ToolDefinition[] = [
  {
    name: 'get_current_time',
    description: 'Get the current date and time in ISO format',
    parameters: {
      type: 'object',
      properties: {
        timezone: {
          type: 'string',
          description: 'IANA timezone name (e.g., "America/New_York")',
        },
      },
    },
  },
  {
    name: 'calculate',
    description: 'Evaluate a mathematical expression',
    parameters: {
      type: 'object',
      properties: {
        expression: {
          type: 'string',
          description: 'Mathematical expression to evaluate (e.g., "2 + 2 * 3")',
        },
      },
      required: ['expression'],
    },
  },
  {
    name: 'generate_uuid',
    description: 'Generate a random UUID',
    parameters: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'create_folder',
    description: 'Create a folder (directory) in the workspace. Can create nested folders.',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description:
            'Relative path of the folder to create (e.g., "projects/my-project" or "notes/2024")',
        },
      },
      required: ['path'],
    },
  },
  {
    name: 'write_file',
    description:
      'Write content to a file in the workspace. Creates the file if it does not exist, or overwrites if it does. Parent folders are created automatically.',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description:
            'Relative path of the file (e.g., "notes/meeting.md" or "data/contacts.json")',
        },
        content: {
          type: 'string',
          description: 'Content to write to the file',
        },
      },
      required: ['path', 'content'],
    },
  },
  {
    name: 'read_file',
    description: 'Read the contents of a file from the workspace',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Relative path of the file to read',
        },
      },
      required: ['path'],
    },
  },
  {
    name: 'list_files',
    description: 'List files and folders in a directory within the workspace',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Relative path of the directory to list (use "" or "/" for workspace root)',
        },
        recursive: {
          type: 'boolean',
          description: 'If true, list files recursively in subdirectories (default: false)',
        },
      },
    },
  },
  {
    name: 'delete_file',
    description: 'Delete a file or empty folder from the workspace',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Relative path of the file or folder to delete',
        },
      },
      required: ['path'],
    },
  },
  {
    name: 'move_file',
    description: 'Move or rename a file or folder within the workspace',
    parameters: {
      type: 'object',
      properties: {
        source: {
          type: 'string',
          description: 'Current relative path of the file or folder',
        },
        destination: {
          type: 'string',
          description: 'New relative path for the file or folder',
        },
      },
      required: ['source', 'destination'],
    },
  },
  // ===== DATA & TEXT TOOLS =====
  {
    name: 'parse_json',
    description: 'Parse and validate JSON string, optionally extract specific fields',
    parameters: {
      type: 'object',
      properties: {
        json: {
          type: 'string',
          description: 'JSON string to parse',
        },
        path: {
          type: 'string',
          description: 'Optional dot notation path to extract (e.g., "user.name" or "items[0].id")',
        },
      },
      required: ['json'],
    },
  },
  {
    name: 'format_json',
    description: 'Format/prettify JSON with indentation',
    parameters: {
      type: 'object',
      properties: {
        json: {
          type: 'string',
          description: 'JSON string to format',
        },
        indent: {
          type: 'number',
          description: 'Number of spaces for indentation (default: 2)',
        },
      },
      required: ['json'],
    },
  },
  {
    name: 'text_stats',
    description: 'Get statistics about text (word count, character count, line count, etc.)',
    parameters: {
      type: 'object',
      properties: {
        text: {
          type: 'string',
          description: 'Text to analyze',
        },
      },
      required: ['text'],
    },
  },
  {
    name: 'text_transform',
    description: 'Transform text (uppercase, lowercase, title case, reverse, etc.)',
    parameters: {
      type: 'object',
      properties: {
        text: {
          type: 'string',
          description: 'Text to transform',
        },
        operation: {
          type: 'string',
          description: 'Operation: uppercase, lowercase, titlecase, reverse, trim, slug',
        },
      },
      required: ['text', 'operation'],
    },
  },
  {
    name: 'search_replace',
    description: 'Search and replace text with support for regex',
    parameters: {
      type: 'object',
      properties: {
        text: {
          type: 'string',
          description: 'Text to search in',
        },
        search: {
          type: 'string',
          description: 'Text or regex pattern to search for',
        },
        replace: {
          type: 'string',
          description: 'Replacement text',
        },
        regex: {
          type: 'boolean',
          description: 'If true, treat search as regex pattern (default: false)',
        },
        global: {
          type: 'boolean',
          description: 'If true, replace all occurrences (default: true)',
        },
      },
      required: ['text', 'search', 'replace'],
    },
  },
  // ===== DATE & TIME TOOLS =====
  {
    name: 'format_date',
    description: 'Format a date in various formats',
    parameters: {
      type: 'object',
      properties: {
        date: {
          type: 'string',
          description:
            'Date string to format (ISO format or natural language like "tomorrow", "next week")',
        },
        format: {
          type: 'string',
          description: 'Output format: iso, short, long, relative, custom (with pattern)',
        },
        timezone: {
          type: 'string',
          description: 'Target timezone (default: UTC)',
        },
      },
      required: ['date'],
    },
  },
  {
    name: 'date_diff',
    description: 'Calculate difference between two dates',
    parameters: {
      type: 'object',
      properties: {
        date1: {
          type: 'string',
          description: 'First date (ISO format)',
        },
        date2: {
          type: 'string',
          description: 'Second date (ISO format, defaults to now)',
        },
        unit: {
          type: 'string',
          description: 'Unit for result: days, hours, minutes, seconds, weeks, months, years',
        },
      },
      required: ['date1'],
    },
  },
  {
    name: 'add_to_date',
    description: 'Add or subtract time from a date',
    parameters: {
      type: 'object',
      properties: {
        date: {
          type: 'string',
          description: 'Starting date (ISO format, defaults to now)',
        },
        amount: {
          type: 'number',
          description: 'Amount to add (negative to subtract)',
        },
        unit: {
          type: 'string',
          description: 'Unit: days, hours, minutes, seconds, weeks, months, years',
        },
      },
      required: ['amount', 'unit'],
    },
  },
  // ===== CONVERSION TOOLS =====
  {
    name: 'convert_units',
    description: 'Convert between units (length, weight, temperature, etc.)',
    parameters: {
      type: 'object',
      properties: {
        value: {
          type: 'number',
          description: 'Value to convert',
        },
        from: {
          type: 'string',
          description: 'Source unit (e.g., "km", "lb", "celsius")',
        },
        to: {
          type: 'string',
          description: 'Target unit (e.g., "miles", "kg", "fahrenheit")',
        },
      },
      required: ['value', 'from', 'to'],
    },
  },
  {
    name: 'convert_currency',
    description: 'Convert between currencies (uses approximate rates)',
    parameters: {
      type: 'object',
      properties: {
        amount: {
          type: 'number',
          description: 'Amount to convert',
        },
        from: {
          type: 'string',
          description: 'Source currency code (e.g., "USD", "EUR", "TRY")',
        },
        to: {
          type: 'string',
          description: 'Target currency code',
        },
      },
      required: ['amount', 'from', 'to'],
    },
  },
  // ===== ENCODING TOOLS =====
  {
    name: 'base64_encode',
    description: 'Encode text to Base64',
    parameters: {
      type: 'object',
      properties: {
        text: {
          type: 'string',
          description: 'Text to encode',
        },
      },
      required: ['text'],
    },
  },
  {
    name: 'base64_decode',
    description: 'Decode Base64 to text',
    parameters: {
      type: 'object',
      properties: {
        encoded: {
          type: 'string',
          description: 'Base64 encoded string to decode',
        },
      },
      required: ['encoded'],
    },
  },
  {
    name: 'url_encode',
    description: 'URL encode/decode text',
    parameters: {
      type: 'object',
      properties: {
        text: {
          type: 'string',
          description: 'Text to encode or decode',
        },
        decode: {
          type: 'boolean',
          description: 'If true, decode instead of encode (default: false)',
        },
      },
      required: ['text'],
    },
  },
  {
    name: 'hash_text',
    description: 'Generate hash of text (MD5, SHA256, etc.)',
    parameters: {
      type: 'object',
      properties: {
        text: {
          type: 'string',
          description: 'Text to hash',
        },
        algorithm: {
          type: 'string',
          description: 'Hash algorithm: md5, sha1, sha256, sha512 (default: sha256)',
        },
      },
      required: ['text'],
    },
  },
  // ===== RANDOM GENERATION TOOLS =====
  {
    name: 'random_number',
    description: 'Generate a random number within a range',
    parameters: {
      type: 'object',
      properties: {
        min: {
          type: 'number',
          description: 'Minimum value (default: 0)',
        },
        max: {
          type: 'number',
          description: 'Maximum value (default: 100)',
        },
        integer: {
          type: 'boolean',
          description: 'If true, return integer only (default: true)',
        },
      },
    },
  },
  {
    name: 'random_string',
    description: 'Generate a random string',
    parameters: {
      type: 'object',
      properties: {
        length: {
          type: 'number',
          description: 'Length of string (default: 16)',
        },
        charset: {
          type: 'string',
          description: 'Character set: alphanumeric, alpha, numeric, hex, custom',
        },
        custom: {
          type: 'string',
          description: 'Custom characters to use (when charset is "custom")',
        },
      },
    },
  },
  {
    name: 'random_choice',
    description: 'Randomly select from a list of options',
    parameters: {
      type: 'object',
      properties: {
        options: {
          type: 'array',
          items: { type: 'string' },
          description: 'List of options to choose from',
        },
        count: {
          type: 'number',
          description: 'Number of items to select (default: 1)',
        },
      },
      required: ['options'],
    },
  },
  // ===== TASK & REMINDER TOOLS =====
  {
    name: 'create_task',
    description: 'Create a task or reminder and save to workspace',
    parameters: {
      type: 'object',
      properties: {
        title: {
          type: 'string',
          description: 'Task title',
        },
        description: {
          type: 'string',
          description: 'Task description',
        },
        due_date: {
          type: 'string',
          description: 'Due date (ISO format or natural language)',
        },
        priority: {
          type: 'string',
          description: 'Priority: low, medium, high',
        },
        tags: {
          type: 'array',
          items: { type: 'string' },
          description: 'Tags for categorization',
        },
      },
      required: ['title'],
    },
  },
  {
    name: 'list_tasks',
    description: 'List all tasks from workspace',
    parameters: {
      type: 'object',
      properties: {
        filter: {
          type: 'string',
          description: 'Filter: all, pending, completed, overdue (default: all)',
        },
        tag: {
          type: 'string',
          description: 'Filter by tag',
        },
      },
    },
  },
  {
    name: 'complete_task',
    description: 'Mark a task as completed',
    parameters: {
      type: 'object',
      properties: {
        task_id: {
          type: 'string',
          description: 'Task ID to complete',
        },
      },
      required: ['task_id'],
    },
  },
  // ===== NOTE TAKING TOOLS =====
  {
    name: 'create_note',
    description: 'Create a note in the workspace with automatic organization',
    parameters: {
      type: 'object',
      properties: {
        title: {
          type: 'string',
          description: 'Note title',
        },
        content: {
          type: 'string',
          description: 'Note content (supports Markdown)',
        },
        category: {
          type: 'string',
          description: 'Category for organization (creates subfolder)',
        },
        tags: {
          type: 'array',
          items: { type: 'string' },
          description: 'Tags for the note',
        },
      },
      required: ['title', 'content'],
    },
  },
  {
    name: 'search_notes',
    description: 'Search notes in workspace by title, content, or tags',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Search query',
        },
        category: {
          type: 'string',
          description: 'Limit search to category',
        },
      },
      required: ['query'],
    },
  },
  // ===== DATA EXTRACTION TOOLS =====
  {
    name: 'extract_urls',
    description: 'Extract all URLs from text',
    parameters: {
      type: 'object',
      properties: {
        text: {
          type: 'string',
          description: 'Text to extract URLs from',
        },
      },
      required: ['text'],
    },
  },
  {
    name: 'extract_emails',
    description: 'Extract all email addresses from text',
    parameters: {
      type: 'object',
      properties: {
        text: {
          type: 'string',
          description: 'Text to extract emails from',
        },
      },
      required: ['text'],
    },
  },
  {
    name: 'extract_numbers',
    description: 'Extract all numbers from text',
    parameters: {
      type: 'object',
      properties: {
        text: {
          type: 'string',
          description: 'Text to extract numbers from',
        },
        include_decimals: {
          type: 'boolean',
          description: 'Include decimal numbers (default: true)',
        },
      },
      required: ['text'],
    },
  },
  // ===== LIST & DATA TOOLS =====
  {
    name: 'sort_list',
    description: 'Sort a list of items',
    parameters: {
      type: 'object',
      properties: {
        items: {
          type: 'array',
          items: { type: 'string' },
          description: 'List of items to sort',
        },
        order: {
          type: 'string',
          description: 'Sort order: asc, desc (default: asc)',
        },
        numeric: {
          type: 'boolean',
          description: 'Sort numerically if items are numbers (default: false)',
        },
      },
      required: ['items'],
    },
  },
  {
    name: 'deduplicate',
    description: 'Remove duplicate items from a list',
    parameters: {
      type: 'object',
      properties: {
        items: {
          type: 'array',
          items: { type: 'string' },
          description: 'List of items to deduplicate',
        },
        case_sensitive: {
          type: 'boolean',
          description: 'Case sensitive comparison (default: true)',
        },
      },
      required: ['items'],
    },
  },
  {
    name: 'create_table',
    description: 'Create a formatted table from data',
    parameters: {
      type: 'object',
      properties: {
        headers: {
          type: 'array',
          items: { type: 'string' },
          description: 'Column headers',
        },
        rows: {
          type: 'array',
          items: {
            type: 'array',
            items: { type: 'string' },
          },
          description: 'Table rows (array of arrays)',
        },
        format: {
          type: 'string',
          description: 'Output format: markdown, csv, json (default: markdown)',
        },
      },
      required: ['headers', 'rows'],
    },
  },
  // ===== VALIDATION TOOLS =====
  {
    name: 'validate_email',
    description: 'Validate if a string is a valid email address',
    parameters: {
      type: 'object',
      properties: {
        email: {
          type: 'string',
          description: 'Email address to validate',
        },
      },
      required: ['email'],
    },
  },
  {
    name: 'validate_url',
    description: 'Validate if a string is a valid URL',
    parameters: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description: 'URL to validate',
        },
      },
      required: ['url'],
    },
  },
  // ===== GENERATOR TOOLS =====
  {
    name: 'generate_password',
    description: 'Generate a secure random password',
    parameters: {
      type: 'object',
      properties: {
        length: {
          type: 'number',
          description: 'Password length (default: 16)',
        },
        uppercase: {
          type: 'boolean',
          description: 'Include uppercase letters (default: true)',
        },
        lowercase: {
          type: 'boolean',
          description: 'Include lowercase letters (default: true)',
        },
        numbers: {
          type: 'boolean',
          description: 'Include numbers (default: true)',
        },
        symbols: {
          type: 'boolean',
          description: 'Include symbols (default: true)',
        },
      },
    },
  },
  {
    name: 'generate_lorem_ipsum',
    description: 'Generate Lorem Ipsum placeholder text',
    parameters: {
      type: 'object',
      properties: {
        type: {
          type: 'string',
          description: 'Type: words, sentences, paragraphs (default: paragraphs)',
        },
        count: {
          type: 'number',
          description: 'Number of units to generate (default: 3)',
        },
      },
    },
  },
  // ===== COLOR TOOLS =====
  {
    name: 'convert_color',
    description: 'Convert between color formats (HEX, RGB, HSL)',
    parameters: {
      type: 'object',
      properties: {
        color: {
          type: 'string',
          description: 'Color value (e.g., "#ff5733", "rgb(255,87,51)", "hsl(11,100%,60%)")',
        },
        to: {
          type: 'string',
          description: 'Target format: hex, rgb, hsl (default: all)',
        },
      },
      required: ['color'],
    },
  },
  // ===== TEXT COMPARISON =====
  {
    name: 'compare_texts',
    description: 'Compare two texts and show differences',
    parameters: {
      type: 'object',
      properties: {
        text1: {
          type: 'string',
          description: 'First text',
        },
        text2: {
          type: 'string',
          description: 'Second text',
        },
        mode: {
          type: 'string',
          description: 'Comparison mode: lines, words, chars (default: lines)',
        },
      },
      required: ['text1', 'text2'],
    },
  },
  // ===== REGEX TOOLS =====
  {
    name: 'test_regex',
    description: 'Test a regular expression against text',
    parameters: {
      type: 'object',
      properties: {
        pattern: {
          type: 'string',
          description: 'Regular expression pattern',
        },
        text: {
          type: 'string',
          description: 'Text to test against',
        },
        flags: {
          type: 'string',
          description: 'Regex flags (g, i, m, etc.)',
        },
      },
      required: ['pattern', 'text'],
    },
  },
  // ===== WORD TOOLS =====
  {
    name: 'count_words',
    description: 'Count word frequency in text',
    parameters: {
      type: 'object',
      properties: {
        text: {
          type: 'string',
          description: 'Text to analyze',
        },
        top: {
          type: 'number',
          description: 'Show top N most frequent words (default: 10)',
        },
        min_length: {
          type: 'number',
          description: 'Minimum word length to count (default: 1)',
        },
      },
      required: ['text'],
    },
  },
  {
    name: 'find_and_replace_bulk',
    description: 'Find and replace multiple patterns at once',
    parameters: {
      type: 'object',
      properties: {
        text: {
          type: 'string',
          description: 'Text to process',
        },
        replacements: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              find: { type: 'string' },
              replace: { type: 'string' },
            },
          },
          description: 'Array of {find, replace} pairs',
        },
      },
      required: ['text', 'replacements'],
    },
  },
  // ===== MARKDOWN TOOLS =====
  {
    name: 'markdown_to_html',
    description: 'Convert Markdown to HTML',
    parameters: {
      type: 'object',
      properties: {
        markdown: {
          type: 'string',
          description: 'Markdown text to convert',
        },
      },
      required: ['markdown'],
    },
  },
  {
    name: 'strip_markdown',
    description: 'Remove Markdown formatting and return plain text',
    parameters: {
      type: 'object',
      properties: {
        markdown: {
          type: 'string',
          description: 'Markdown text to strip',
        },
      },
      required: ['markdown'],
    },
  },
  // ===== JSON/CSV TOOLS =====
  {
    name: 'json_to_csv',
    description: 'Convert JSON array to CSV format',
    parameters: {
      type: 'object',
      properties: {
        json: {
          type: 'string',
          description: 'JSON array string to convert',
        },
        delimiter: {
          type: 'string',
          description: 'CSV delimiter (default: ,)',
        },
      },
      required: ['json'],
    },
  },
  {
    name: 'csv_to_json',
    description: 'Convert CSV to JSON array',
    parameters: {
      type: 'object',
      properties: {
        csv: {
          type: 'string',
          description: 'CSV string to convert',
        },
        delimiter: {
          type: 'string',
          description: 'CSV delimiter (default: ,)',
        },
        headers: {
          type: 'boolean',
          description: 'First row contains headers (default: true)',
        },
      },
      required: ['csv'],
    },
  },
  // ===== CALCULATION TOOLS =====
  {
    name: 'calculate_percentage',
    description: 'Calculate percentage (what % is X of Y, X% of Y, % change)',
    parameters: {
      type: 'object',
      properties: {
        operation: {
          type: 'string',
          description:
            'Operation: "of" (X% of Y), "is" (X is what % of Y), "change" (% change from X to Y)',
        },
        value1: {
          type: 'number',
          description: 'First value',
        },
        value2: {
          type: 'number',
          description: 'Second value',
        },
      },
      required: ['operation', 'value1', 'value2'],
    },
  },
  {
    name: 'calculate_statistics',
    description: 'Calculate statistics for a list of numbers',
    parameters: {
      type: 'object',
      properties: {
        numbers: {
          type: 'array',
          items: { type: 'number' },
          description: 'Array of numbers',
        },
      },
      required: ['numbers'],
    },
  },
  // ===== STRING TOOLS =====
  {
    name: 'truncate_text',
    description: 'Truncate text to specified length with ellipsis',
    parameters: {
      type: 'object',
      properties: {
        text: {
          type: 'string',
          description: 'Text to truncate',
        },
        length: {
          type: 'number',
          description: 'Maximum length (default: 100)',
        },
        suffix: {
          type: 'string',
          description: 'Suffix to add (default: "...")',
        },
        word_boundary: {
          type: 'boolean',
          description: 'Cut at word boundary (default: true)',
        },
      },
      required: ['text'],
    },
  },
  {
    name: 'wrap_text',
    description: 'Wrap text to specified line width',
    parameters: {
      type: 'object',
      properties: {
        text: {
          type: 'string',
          description: 'Text to wrap',
        },
        width: {
          type: 'number',
          description: 'Maximum line width (default: 80)',
        },
      },
      required: ['text'],
    },
  },
  // ===== SLUG & CASE TOOLS =====
  {
    name: 'to_slug',
    description: 'Convert text to URL-friendly slug',
    parameters: {
      type: 'object',
      properties: {
        text: {
          type: 'string',
          description: 'Text to convert',
        },
        separator: {
          type: 'string',
          description: 'Word separator (default: "-")',
        },
      },
      required: ['text'],
    },
  },
  {
    name: 'change_case',
    description: 'Change text case (camelCase, PascalCase, snake_case, kebab-case, CONSTANT_CASE)',
    parameters: {
      type: 'object',
      properties: {
        text: {
          type: 'string',
          description: 'Text to convert',
        },
        case_type: {
          type: 'string',
          description: 'Target case: camel, pascal, snake, kebab, constant',
        },
      },
      required: ['text', 'case_type'],
    },
  },
  // ===== BOOKMARK & LINK TOOLS =====
  {
    name: 'create_bookmark',
    description: 'Save a bookmark/link with title and description',
    parameters: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description: 'URL to bookmark',
        },
        title: {
          type: 'string',
          description: 'Bookmark title',
        },
        description: {
          type: 'string',
          description: 'Optional description',
        },
        tags: {
          type: 'array',
          items: { type: 'string' },
          description: 'Tags for categorization',
        },
      },
      required: ['url', 'title'],
    },
  },
  {
    name: 'list_bookmarks',
    description: 'List saved bookmarks',
    parameters: {
      type: 'object',
      properties: {
        tag: {
          type: 'string',
          description: 'Filter by tag',
        },
        search: {
          type: 'string',
          description: 'Search in title/description',
        },
      },
    },
  },
];
