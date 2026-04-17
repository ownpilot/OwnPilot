# Page-Specific Context Templates

When spawned from the sidebar chat, the system prompt includes a `## Page Context`
section that tells you which page the user is viewing. Use these templates to
understand what data is available and how to access it.

## Workflow Page

When user is viewing a workflow:
```bash
# Fetch workflow definition
curl -s "$API/workflows/{id}" -H "X-Session-Token: $TOKEN" | jq '.data'

# Or via DB
psql -c "SELECT name, nodes, edges, variables FROM workflows WHERE id = '{id}'"

# Workflow has: nodes (jsonb array), edges (jsonb array), variables (jsonb)
# Node types: trigger, llm, code, condition, httpRequest, forEach, delay, switch, etc.
```

What you can do:
- Explain the workflow logic
- Suggest optimizations (reduce nodes, add error handling)
- Generate modified workflow JSON
- Debug execution issues (check workflow_logs table)
- Add/remove/modify nodes

## Agent Page

When user is viewing an agent:
```bash
curl -s "$API/agents/{id}" -H "X-Session-Token: $TOKEN" | jq '.data'

# Agent has: name, system_prompt, provider, model, tools[], config
psql -c "SELECT name, system_prompt, provider FROM agents WHERE id = '{id}'"
```

What you can do:
- Improve the system prompt
- Suggest tool additions
- Optimize model/temperature settings
- Review agent performance (check agent_messages table)

## MCP Server Page

When user is viewing MCP servers:
```bash
curl -s "$API/mcp-servers" -H "X-Session-Token: $TOKEN" | jq '.data'

# MCP server has: name, command, args, env, status, tools[]
psql -c "SELECT name, command, status FROM mcp_servers"
```

What you can do:
- Diagnose connection issues
- List available tools per server
- Suggest configuration changes
- Check server health and restart procedures

## Skills/Extensions Page

When user is viewing a skill or extension:
```bash
curl -s "$API/extensions/{id}" -H "X-Session-Token: $TOKEN" | jq '.data'

# Extension has: name, type, code, manifest, tools[]
psql -c "SELECT name, type, substring(code,1,500) FROM user_extensions WHERE id = '{id}'"
```

What you can do:
- Review and improve skill code
- Fix bugs in extension logic
- Generate new tool implementations
- Validate SKILL.md format

## Custom Tools Page

When user is viewing custom tools:
```bash
curl -s "$API/custom-tools/{id}" -H "X-Session-Token: $TOKEN" | jq '.data'

# Custom tool has: name, description, code, input_schema, output_schema
```

What you can do:
- Write or improve tool code (JavaScript)
- Generate input/output schemas
- Debug tool execution
- Write tests

## Tools Page (Built-in)

When user is on the tools listing:
```bash
curl -s "$API/tools" -H "X-Session-Token: $TOKEN" | jq '.data | length'
# Returns all registered tools (built-in + MCP + custom)
```

What you can do:
- Explain tool usage and parameters
- Suggest tool combinations for tasks
- Find the right tool for a job

## File Workspace Page

When user is viewing a workspace with a path:
- You are SPAWNED in that directory!
- Use ls, cat, git freely — you are IN the project
- Read CLAUDE.md if it exists for project-specific context
- This is the MOST powerful context — full filesystem access
