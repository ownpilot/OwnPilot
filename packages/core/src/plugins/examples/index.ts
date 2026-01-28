/**
 * Example Marketplace Plugins
 *
 * These plugins demonstrate how to build secure, marketplace-ready plugins
 * for the OwnPilot system.
 *
 * KEY SECURITY PRINCIPLES DEMONSTRATED:
 * =====================================
 *
 * 1. CAPABILITY-BASED PERMISSIONS
 *    - Plugins declare exactly what they need
 *    - No access beyond declared capabilities
 *    - Users can review before installation
 *
 * 2. NETWORK DOMAIN RESTRICTIONS
 *    - Plugins can only access declared domains
 *    - No arbitrary network access
 *    - Transparent data flow
 *
 * 3. ISOLATED STORAGE
 *    - Each plugin has its own storage namespace
 *    - Cannot access other plugins' data
 *    - Quota enforced
 *
 * 4. NO ACCESS TO SENSITIVE DATA
 *    - NEVER access user memory
 *    - NEVER access user credentials
 *    - NEVER access audit logs
 *    - NEVER access encryption keys
 *
 * 5. SANDBOXED EXECUTION
 *    - Plugins run in isolated contexts
 *    - Resource limits enforced
 *    - Timeout protection
 */

// Weather Plugin - demonstrates network, storage, and tools (Marketplace pattern)
// This is the ONLY plugin exported here because it doesn't use createPlugin() at module load time
export * from './weather-plugin.js';

// =============================================================================
// NOTE: All other plugins are NOT exported from this barrel file to avoid
// circular dependency issues. They all call createPlugin() at module load time,
// which causes "Cannot access 'PluginBuilder' before initialization" errors.
//
// To use these plugins, import them directly:
//   import { createExpenseTrackerPlugin } from './expense-plugin.js';
//   import { newsPlugin } from './news-plugin.js';
//   import { codeAssistantPlugin } from './code-assistant-plugin.js';
//   import { reminderPlugin } from './reminder-plugin.js';
//   import { clipboardPlugin } from './clipboard-plugin.js';
//   import { calculatorPlugin } from './calculator-plugin.js';
//   import { pomodoroPlugin } from './pomodoro-plugin.js';
//   import { habitTrackerPlugin } from './habit-tracker-plugin.js';
//   import { quickCapturePlugin } from './quick-capture-plugin.js';
// =============================================================================

// Re-export for convenience
export {
  WEATHER_PLUGIN_MANIFEST,
  WeatherService,
  createWeatherPluginTools,
  createWeatherToolExecutors,
  WEATHER_CURRENT_TOOL,
  WEATHER_FORECAST_TOOL,
  WEATHER_CONFIGURE_TOOL,
  DEFAULT_WEATHER_CONFIG,
} from './weather-plugin.js';

/**
 * Example plugin manifests for reference
 */
export const EXAMPLE_PLUGIN_MANIFESTS = {
  weather: () => import('./weather-plugin.js').then(m => m.WEATHER_PLUGIN_MANIFEST),
};

/**
 * Plugin Development Guidelines
 *
 * 1. MANIFEST REQUIREMENTS
 *    - Unique ID (reverse domain notation)
 *    - Semantic version
 *    - Clear description
 *    - Author information
 *    - Capability declarations
 *    - Security declarations
 *
 * 2. CAPABILITY USAGE
 *    - Request minimum necessary capabilities
 *    - Document why each capability is needed
 *    - Handle gracefully if capability denied
 *
 * 3. STORAGE BEST PRACTICES
 *    - Use structured keys (namespace:type:id)
 *    - Handle storage errors gracefully
 *    - Implement cache expiration
 *    - Respect quota limits
 *
 * 4. NETWORK BEST PRACTICES
 *    - Declare all domains upfront
 *    - Use timeouts for all requests
 *    - Handle network errors gracefully
 *    - Cache responses when appropriate
 *
 * 5. TOOL REGISTRATION
 *    - Clear, descriptive names
 *    - Comprehensive parameter schemas
 *    - Helpful error messages
 *    - Return structured responses
 *
 * 6. ERROR HANDLING
 *    - Never expose internal errors to users
 *    - Log errors for debugging
 *    - Provide actionable error messages
 *    - Fail gracefully
 *
 * 7. TESTING
 *    - Unit test all core functionality
 *    - Test with denied capabilities
 *    - Test with network failures
 *    - Test with storage quota exceeded
 */
export const PLUGIN_DEVELOPMENT_GUIDELINES = `
# Plugin Development Guidelines

## 1. Manifest Requirements

Every marketplace plugin MUST have:
- Unique ID (reverse domain notation, e.g., "com.example.myplugin")
- Semantic version (e.g., "1.2.3")
- Clear, concise description
- Author information (name, email, optional URL)
- Capability declarations (what the plugin needs)
- Security declarations (data handling, audit info)

## 2. Security Checklist

Before submitting a plugin:
□ Request only necessary capabilities
□ Declare all network domains
□ Handle errors without exposing internals
□ No eval() or dynamic imports
□ No access to process/env/fs
□ Properly validate all inputs
□ Implement request timeouts
□ Respect rate limits

## 3. Storage Guidelines

- Use namespaced keys: "myplug:cache:weather:london"
- Implement TTL for cached data
- Handle quota exceeded errors
- Clean up expired data periodically

## 4. Network Guidelines

- Always use HTTPS
- Set reasonable timeouts (10-30 seconds)
- Implement retry with exponential backoff
- Cache responses when appropriate
- Never hardcode API keys in plugin code

## 5. Testing Requirements

- Unit tests for core logic
- Integration tests for API calls (with mocks)
- Tests for capability denial scenarios
- Tests for error conditions
`;
