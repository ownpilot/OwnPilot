---
name: api-debugging
description: Systematic approach to debugging REST APIs, HTTP errors, authentication issues, and network problems. Use when the user has API errors, status code issues, timeout problems, or needs help troubleshooting HTTP requests.
license: MIT
compatibility: Works best with code execution enabled for running curl/fetch commands
metadata:
  author: ownpilot
  version: "1.0.0"
allowed-tools: Bash(curl:*) Bash(wget:*)
---

# API Debugging

You are an expert API debugger. Follow this systematic process when helping troubleshoot API issues.

## Debugging Workflow

1. **Reproduce** — Get the exact request that fails (URL, method, headers, body)
2. **Isolate** — Is it the request, the server, auth, or network?
3. **Check basics** — Status code, response body, headers
4. **Fix** — Apply the solution
5. **Verify** — Confirm the fix works

## HTTP Status Code Guide

### Client Errors (4xx)
| Code | Meaning | Common Cause | Fix |
|------|---------|-------------|-----|
| 400 | Bad Request | Malformed JSON, missing field | Check request body schema |
| 401 | Unauthorized | Missing/expired token | Refresh auth token |
| 403 | Forbidden | Insufficient permissions | Check API key scopes |
| 404 | Not Found | Wrong URL or deleted resource | Verify endpoint path |
| 405 | Method Not Allowed | GET instead of POST | Check HTTP method |
| 409 | Conflict | Duplicate resource | Check unique constraints |
| 422 | Unprocessable | Validation failed | Check field types/values |
| 429 | Too Many Requests | Rate limited | Add retry with backoff |

### Server Errors (5xx)
| Code | Meaning | Action |
|------|---------|--------|
| 500 | Internal Server Error | Check server logs, report bug |
| 502 | Bad Gateway | Upstream service down, retry |
| 503 | Service Unavailable | Service overloaded, wait and retry |
| 504 | Gateway Timeout | Increase timeout, check slow queries |

## Authentication Checklist

When auth fails (401/403):
1. Is the token/key present in the request?
2. Is it in the right header? (`Authorization: Bearer <token>` vs `X-API-Key: <key>`)
3. Has the token expired? (Decode JWT at jwt.io to check `exp`)
4. Are the scopes/permissions sufficient?
5. Is there an IP allowlist blocking the request?
6. Is the API key for the correct environment (prod vs staging)?

## Common Patterns

### Retry with exponential backoff
```
Wait: 1s → 2s → 4s → 8s (max 3-4 retries)
Only retry on: 429, 500, 502, 503, 504
Never retry on: 400, 401, 403, 404
```

### Debug steps for timeout issues
1. Is the endpoint correct? (Try a simple GET first)
2. Is the payload too large?
3. Is the server under load? (Check response time headers)
4. Is there a proxy/firewall in the way?
5. Try with a longer timeout to confirm it's not just slow

### CORS issues (browser only)
- Error: "No Access-Control-Allow-Origin header"
- Fix: Server must add `Access-Control-Allow-Origin` header
- Workaround: Use server-side proxy, not browser fetch

## Request Debugging Template

When analyzing a failed request, gather:
```
Endpoint:  [METHOD] [URL]
Headers:   [Key headers, especially Auth]
Body:      [Request payload]
Status:    [Response status code]
Response:  [Error message or body]
Timing:    [How long did it take?]
Context:   [When did it start failing? What changed?]
```
