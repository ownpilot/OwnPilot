/**
 * Search Tags Registry for Tool Discovery
 *
 * These tags enable the search_tools meta-tool to find relevant tools
 * even when the user's query doesn't match the tool name or description.
 * Tags include synonyms, related concepts, and common intents that
 * should surface each tool.
 *
 * Format: tool_name → array of search keywords
 */

export const TOOL_SEARCH_TAGS: Record<string, readonly string[]> = {
  // ─────────────────────────────────────────────
  // EMAIL
  // ─────────────────────────────────────────────
  send_email: ['mail', 'email', 'send', 'message', 'smtp', 'contact', 'notify', 'notification', 'letter'],
  list_emails: ['mail', 'email', 'inbox', 'read mail', 'check mail'],
  read_email: ['mail', 'email', 'open mail', 'message content', 'read message'],
  delete_email: ['mail', 'email', 'remove mail', 'trash', 'delete mail'],
  search_emails: ['mail', 'email', 'find mail', 'filter', 'search mail'],
  reply_email: ['mail', 'email', 'respond', 'answer', 'reply'],

  // ─────────────────────────────────────────────
  // GIT / VERSION CONTROL
  // ─────────────────────────────────────────────
  git_status: ['git', 'version', 'repo', 'changes', 'modified', 'status'],
  git_diff: ['git', 'compare', 'changes', 'diff', 'difference'],
  git_log: ['git', 'history', 'commit list', 'log', 'record'],
  git_commit: ['git', 'save', 'commit', 'version'],
  git_add: ['git', 'stage', 'add files', 'prepare'],
  git_branch: ['git', 'branch', 'branching'],
  git_checkout: ['git', 'switch', 'checkout', 'change branch'],

  // ─────────────────────────────────────────────
  // MEMORY
  // ─────────────────────────────────────────────
  remember: ['save', 'store', 'note', 'memorize', 'remember', 'keep'],
  batch_remember: ['batch', 'bulk save', 'multiple save', 'remember batch'],
  recall: ['retrieve', 'search memory', 'remember', 'find', 'query'],
  forget: ['delete memory', 'remove', 'clear', 'forget'],
  list_memories: ['memories', 'records', 'list', 'show'],
  boost_memory: ['priority', 'boost', 'highlight', 'important'],
  memory_stats: ['stats', 'memory info', 'status', 'statistics'],

  // ─────────────────────────────────────────────
  // TASKS / TODO
  // ─────────────────────────────────────────────
  add_task: ['task', 'todo', 'to-do', 'job', 'plan', 'add', 'create', 'new task', 'reminder'],
  list_tasks: ['tasks', 'todos', 'list', 'show', 'pending'],
  complete_task: ['done', 'finish', 'complete', 'close', 'mark', 'check'],
  update_task: ['edit task', 'modify', 'task update', 'change task'],
  delete_task: ['remove task', 'delete', 'cancel'],
  batch_add_tasks: ['bulk tasks', 'batch', 'multiple tasks'],

  // ─────────────────────────────────────────────
  // NOTES
  // ─────────────────────────────────────────────
  add_note: ['write', 'note', 'text', 'document', 'create note'],
  list_notes: ['notes', 'list', 'show', 'writings', 'documents'],
  update_note: ['edit note', 'modify note', 'change note'],
  delete_note: ['remove note', 'delete note'],
  batch_add_notes: ['bulk notes', 'batch notes', 'multiple notes'],

  // ─────────────────────────────────────────────
  // CALENDAR / EVENTS
  // ─────────────────────────────────────────────
  add_calendar_event: ['calendar', 'event', 'appointment', 'meeting', 'plan', 'schedule', 'create', 'date'],
  list_calendar_events: ['calendar', 'events', 'appointments', 'schedule', 'today', 'tomorrow', 'week'],
  delete_calendar_event: ['cancel event', 'remove event', 'delete event'],
  batch_add_calendar_events: ['bulk events', 'batch calendar', 'multiple events'],

  // ─────────────────────────────────────────────
  // CONTACTS
  // ─────────────────────────────────────────────
  add_contact: ['contact', 'phone', 'number', 'add', 'save contact', 'person'],
  list_contacts: ['contacts', 'phonebook', 'list', 'show contacts'],
  update_contact: ['contact update', 'edit contact', 'change contact'],
  delete_contact: ['remove contact', 'delete contact'],
  batch_add_contacts: ['bulk contacts', 'multiple contacts'],

  // ─────────────────────────────────────────────
  // BOOKMARKS
  // ─────────────────────────────────────────────
  add_bookmark: ['bookmark', 'favorite', 'save', 'link', 'url', 'site', 'web'],
  list_bookmarks: ['bookmarks', 'favorites', 'links', 'list'],
  delete_bookmark: ['remove bookmark', 'delete bookmark'],
  batch_add_bookmarks: ['bulk bookmarks', 'multiple bookmarks'],

  // ─────────────────────────────────────────────
  // EXPENSES / FINANCE
  // ─────────────────────────────────────────────
  add_expense: ['expense', 'money', 'payment', 'bill', 'cost', 'price', 'shopping', 'spend'],
  batch_add_expenses: ['bulk expenses', 'multiple expenses'],
  parse_receipt: ['receipt', 'invoice', 'scan', 'read receipt'],
  query_expenses: ['expense search', 'filter', 'budget', 'query expenses'],
  export_expenses: ['export', 'report', 'csv', 'excel', 'download expenses'],
  expense_summary: ['summary', 'total', 'statistics', 'analysis', 'budget'],
  delete_expense: ['remove expense', 'delete expense'],

  // ─────────────────────────────────────────────
  // FILE SYSTEM
  // ─────────────────────────────────────────────
  read_file: ['file read', 'open', 'content', 'view'],
  write_file: ['file write', 'save', 'create file', 'new file'],
  list_directory: ['folder', 'directory', 'ls', 'list', 'files'],
  search_files: ['file search', 'find', 'grep', 'search'],
  download_file: ['download', 'fetch', 'get file'],
  file_info: ['file info', 'size', 'detail', 'metadata'],
  delete_file: ['file delete', 'remove file'],
  copy_file: ['file copy', 'duplicate', 'move'],

  // ─────────────────────────────────────────────
  // WEB / API
  // ─────────────────────────────────────────────
  http_request: ['api', 'http', 'rest', 'request', 'endpoint', 'fetch', 'call'],
  fetch_web_page: ['web', 'page', 'site', 'url', 'scrape', 'read', 'html'],
  search_web: ['search', 'google', 'internet', 'web search', 'find', 'query', 'information'],
  json_api: ['json', 'api', 'rest', 'data', 'endpoint', 'service'],

  // ─────────────────────────────────────────────
  // CODE EXECUTION
  // ─────────────────────────────────────────────
  execute_javascript: ['code', 'javascript', 'js', 'run', 'script', 'calculate', 'program'],
  execute_python: ['code', 'python', 'py', 'run', 'script', 'program'],
  execute_shell: ['terminal', 'shell', 'bash', 'command', 'cmd', 'run', 'cli'],
  compile_code: ['compile', 'build', 'code', 'program'],
  package_manager: ['package', 'npm', 'pip', 'install', 'dependency'],

  // ─────────────────────────────────────────────
  // IMAGE
  // ─────────────────────────────────────────────
  analyze_image: ['image', 'photo', 'analyze', 'describe', 'ocr', 'vision'],
  generate_image: ['generate image', 'dall-e', 'ai art', 'draw', 'create image'],
  edit_image: ['image edit', 'modify image'],
  image_variation: ['image variation', 'similar image'],
  resize_image: ['resize', 'scale', 'crop'],

  // ─────────────────────────────────────────────
  // AUDIO
  // ─────────────────────────────────────────────
  text_to_speech: ['audio', 'speak', 'tts', 'voice', 'speech synthesis'],
  speech_to_text: ['transcribe', 'stt', 'listen', 'audio to text', 'transcript'],
  translate_audio: ['audio translate', 'language'],
  audio_info: ['audio info', 'duration', 'format', 'detail'],
  split_audio: ['audio split', 'cut', 'segment'],

  // ─────────────────────────────────────────────
  // PDF
  // ─────────────────────────────────────────────
  read_pdf: ['pdf', 'document', 'read', 'file', 'extract text'],
  create_pdf: ['create pdf', 'document create', 'report'],
  pdf_info: ['pdf info', 'document info', 'page count', 'size'],

  // ─────────────────────────────────────────────
  // TRANSLATION
  // ─────────────────────────────────────────────
  translate_text: ['translate', 'language', 'english', 'spanish', 'french', 'german'],
  detect_language: ['detect', 'which language', 'identify language'],
  list_languages: ['languages', 'supported', 'available'],
  batch_translate: ['bulk translate', 'batch', 'multiple translate'],

  // ─────────────────────────────────────────────
  // GOALS
  // ─────────────────────────────────────────────
  create_goal: ['goal', 'objective', 'target', 'plan', 'vision', 'create'],
  list_goals: ['goals', 'objectives', 'list', 'show'],
  update_goal: ['goal update', 'edit', 'progress'],
  decompose_goal: ['decompose', 'sub-goals', 'steps', 'break down'],
  get_next_actions: ['next action', 'what to do', 'suggestion'],
  complete_step: ['step complete', 'finish', 'mark progress'],
  get_goal_details: ['goal detail', 'info', 'status'],
  goal_stats: ['goal stats', 'progress', 'report'],

  // ─────────────────────────────────────────────
  // SCHEDULER
  // ─────────────────────────────────────────────
  create_scheduled_task: ['schedule', 'cron', 'automation', 'timer', 'automatic', 'recurring', 'reminder'],
  list_scheduled_tasks: ['schedules', 'cron list', 'automations', 'list'],
  update_scheduled_task: ['schedule update', 'edit schedule'],
  delete_scheduled_task: ['schedule delete', 'cancel'],
  get_task_history: ['task history', 'execution log'],
  trigger_task: ['trigger', 'run now', 'manual run'],

  // ─────────────────────────────────────────────
  // DATA EXTRACTION
  // ─────────────────────────────────────────────
  extract_structured_data: ['structured data', 'parse', 'extract', 'json', 'table'],
  extract_entities: ['entity extraction', 'ner', 'name', 'date', 'place'],
  extract_table_data: ['table', 'csv', 'excel', 'parse table'],
  summarize_text: ['summarize', 'summary', 'brief', 'tldr'],

  // ─────────────────────────────────────────────
  // CUSTOM DATA
  // ─────────────────────────────────────────────
  list_custom_tables: ['database', 'table', 'list', 'show', 'schema'],
  describe_custom_table: ['table info', 'structure', 'columns'],
  create_custom_table: ['create table', 'database', 'new table'],
  delete_custom_table: ['drop table', 'remove table'],
  add_custom_record: ['add record', 'insert', 'add data', 'row'],
  batch_add_custom_records: ['bulk insert', 'multiple data'],
  list_custom_records: ['records', 'list', 'data', 'rows'],
  search_custom_records: ['search records', 'find', 'filter', 'query'],
  get_custom_record: ['get record', 'detail', 'single record'],
  update_custom_record: ['update record', 'edit', 'change'],
  delete_custom_record: ['delete record', 'remove'],

  // ─────────────────────────────────────────────
  // VECTOR SEARCH
  // ─────────────────────────────────────────────
  create_embedding: ['embedding', 'vector', 'encode', 'semantic'],
  semantic_search: ['semantic search', 'similarity', 'meaning', 'smart search'],
  upsert_vectors: ['upsert', 'vector add', 'update vectors'],
  delete_vectors: ['vector delete', 'remove vectors'],
  list_vector_collections: ['collections', 'vector list'],
  create_vector_collection: ['create collection', 'new collection'],
  similarity_score: ['similarity score', 'compare', 'proximity'],

  // ─────────────────────────────────────────────
  // WEATHER
  // ─────────────────────────────────────────────
  get_weather: ['weather', 'temperature', 'rain', 'sun', 'forecast', 'today'],
  get_weather_forecast: ['forecast', 'tomorrow', 'weekly', 'prediction'],

  // ─────────────────────────────────────────────
  // UTILITY / MATH / TEXT
  // ─────────────────────────────────────────────
  get_current_datetime: ['time', 'date', 'now', 'today', 'what time'],
  calculate: ['calculate', 'math', 'formula', 'operation', 'compute'],
  convert_units: ['convert', 'unit', 'metre', 'kilo', 'fahrenheit', 'celsius', 'cm', 'inch', 'dollar', 'euro'],
  generate_uuid: ['uuid', 'id', 'unique', 'identifier'],
  generate_password: ['password', 'secure', 'random'],
  random_number: ['random number', 'luck', 'dice'],
  hash_text: ['hash', 'md5', 'sha', 'encrypt', 'digest'],
  encode_decode: ['encode', 'decode', 'base64', 'url encode'],
  count_text: ['count', 'word count', 'character', 'line'],
  extract_from_text: ['extract', 'regex', 'pattern', 'find', 'parse'],
  validate: ['validate', 'check', 'valid', 'email', 'url', 'phone'],
  transform_text: ['transform', 'uppercase', 'lowercase', 'trim', 'replace'],
  date_diff: ['date diff', 'how many days', 'duration', 'difference'],
  date_add: ['date add', 'add days', 'next', 'previous'],
  format_json: ['json format', 'prettify', 'indent'],
  parse_csv: ['csv parse', 'table', 'excel', 'read data'],
  generate_csv: ['csv generate', 'create table', 'export'],
  array_operations: ['array', 'list', 'sort', 'filter', 'unique'],
  statistics: ['statistics', 'average', 'mean', 'median', 'std', 'sum'],
  compare_text: ['compare', 'diff', 'similarity'],
  regex: ['regex', 'regular expression', 'pattern', 'match'],
  system_info: ['system', 'info', 'platform', 'os', 'memory', 'cpu'],

  // ─────────────────────────────────────────────
  // DYNAMIC TOOLS (meta)
  // ─────────────────────────────────────────────
  create_tool: ['tool create', 'custom tool', 'new tool'],
  list_custom_tools: ['tools', 'list', 'custom tools'],
  delete_custom_tool: ['tool delete', 'remove tool'],
  toggle_custom_tool: ['tool toggle', 'enable', 'disable'],
  search_tools: ['find tool', 'discover', 'search', 'which tool', 'available tools'],
  get_tool_help: ['help', 'usage', 'parameters', 'how to use', 'docs', 'documentation', 'batch help', 'multiple tools'],
  use_tool: ['execute', 'run tool', 'call tool', 'invoke'],

  // ─────────────────────────────────────────────
  // CONFIG CENTER
  // ─────────────────────────────────────────────
  config_list_services: ['settings', 'services', 'config', 'api key', 'list'],
  config_get_service: ['setting', 'config', 'service info', 'api key', 'detail'],
  config_set_entry: ['config set', 'api key add', 'configure'],

  // ─────────────────────────────────────────────
  // TRIGGERS (Automation)
  // ─────────────────────────────────────────────
  create_trigger: ['trigger', 'automation', 'schedule', 'cron', 'event', 'proactive'],
  list_triggers: ['trigger', 'automation', 'list', 'schedule list'],
  enable_trigger: ['trigger', 'enable', 'disable', 'toggle'],
  fire_trigger: ['trigger', 'run', 'execute', 'fire', 'manual'],
  delete_trigger: ['trigger', 'delete', 'remove'],
  trigger_stats: ['trigger', 'stats', 'statistics', 'status'],

  // ─────────────────────────────────────────────
  // PLANS (Automation)
  // ─────────────────────────────────────────────
  create_plan: ['plan', 'workflow', 'automation', 'step', 'process'],
  add_plan_step: ['plan', 'step', 'add step', 'workflow step'],
  list_plans: ['plan', 'workflow', 'list', 'automation list'],
  get_plan_details: ['plan', 'detail', 'workflow detail', 'steps'],
  execute_plan: ['plan', 'execute', 'run', 'start'],
  pause_plan: ['plan', 'pause', 'hold'],
  delete_plan: ['plan', 'delete', 'remove'],
};
