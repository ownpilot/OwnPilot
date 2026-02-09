/**
 * Core types for OwnPilot
 * @packageDocumentation
 */

// Result pattern
export {
  type Result,
  ok,
  err,
  unwrap,
  unwrapOr,
  mapResult,
  mapError,
  andThen,
  fromPromise,
  fromThrowable,
  combine,
  isOk,
  isErr,
} from './result.js';

// Branded types
export {
  type Brand,
  type UserId,
  type SessionId,
  type PluginId,
  type ChannelId,
  type MessageId,
  type AuditEventId,
  type ToolId,
  type ConversationId,
  createUserId,
  createSessionId,
  createPluginId,
  createChannelId,
  createMessageId,
  createAuditEventId,
  createToolId,
  createConversationId,
  unsafeUserId,
  unsafeSessionId,
  unsafePluginId,
  unsafeChannelId,
  unsafeMessageId,
  unsafeAuditEventId,
  unsafeToolId,
  unsafeConversationId,
} from './branded.js';

// Error classes
export {
  AppError,
  ValidationError,
  NotFoundError,
  PermissionDeniedError,
  AuthenticationError,
  TimeoutError,
  RateLimitError,
  ConflictError,
  InternalError,
  CryptoError,
  PluginError,
  isAppError,
  toAppError,
} from './errors.js';

// Type guards
export {
  isObject,
  isString,
  isNonEmptyString,
  isNumber,
  isPositiveInteger,
  isNonNegativeInteger,
  isBoolean,
  isArray,
  isStringArray,
  isDate,
  isISODateString,
  isNull,
  isUndefined,
  isNullish,
  isFunction,
  hasProperty,
  hasProperties,
  isUUID,
  isEmail,
  isURL,
  isSemver,
  assert,
  assertDefined,
} from './guards.js';

// Utility types
export {
  type JsonValue,
  type JsonObject,
  type DeepReadonly,
  type DeepPartial,
  type WithRequired,
  type WithOptional,
  type Mutable,
  type KeysOfType,
  type OmitByType,
  type AsyncState,
  type ISOTimestamp,
  type DurationMs,
  type Bytes,
  type NonEmptyArray,
  sleep,
  withTimeout,
  retry,
} from './utility.js';
