# Code Review Reference

## Common Vulnerability Patterns

### SQL Injection
```
BAD:  db.query(`SELECT * FROM users WHERE id = '${userId}'`)
GOOD: db.query('SELECT * FROM users WHERE id = $1', [userId])
```

### XSS Prevention
```
BAD:  Assigning user input directly to DOM element HTML content
GOOD: Use textContent for plain text, or a sanitizer library (DOMPurify) for HTML
```

### Command Injection Prevention
```
BAD:  Interpolating user input into shell command strings
GOOD: Use execFile with argument arrays instead of shell string execution
```

## Performance Checklist
- No N+1 queries (use JOIN or batch loading)
- Database indexes for WHERE/ORDER BY columns
- Pagination for list endpoints
- Bounded collections (Set/Map with max size)
- Lazy loading for heavy imports
