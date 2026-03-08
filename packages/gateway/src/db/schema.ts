/**
 * PostgreSQL Schema Definition
 *
 * Re-exports from split domain modules in ./schema/ for backward compatibility.
 * See schema/ directory for the actual SQL definitions organized by domain.
 */

export { SCHEMA_SQL, MIGRATIONS_SQL, INDEXES_SQL, initializeSchema } from './schema/index.js';
