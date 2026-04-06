#!/usr/bin/env bash
# seed-demo.sh — Populate OwnPilot with demo data visible in the UI.
#
# Usage:
#   ./tests/seed-demo.sh
#   API_URL=http://localhost:9090 ./tests/seed-demo.sh

set -uo pipefail

API="${API_URL:-http://localhost:8501}"
CT="Content-Type: application/json"
PASS=0; FAIL=0

post() {
  local label="$1" path="$2" body="$3" expect="${4:-201}"
  local resp status
  resp=$(curl -s -w '\n%{http_code}' -X POST "$API$path" -H "$CT" -d "$body")
  status=$(echo "$resp" | tail -1)
  local json
  json=$(echo "$resp" | sed '$d')
  if [[ "$status" =~ ^(200|201)$ ]]; then
    PASS=$((PASS+1))
    echo "  + $label (HTTP $status)"
  else
    FAIL=$((FAIL+1))
    echo "  ! $label (HTTP $status)"
    echo "$json" | head -1
  fi
  echo "$json" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4
}

echo "========================================================"
echo "  OwnPilot Demo Seed — $API"
echo "========================================================"
echo ""

# ── 1. Agents ──────────────────────────────────────────────
echo "--- Agents ---"

AGENT1=$(post "Research Agent" "/api/v1/agents" \
  '{"name":"Research Agent","systemPrompt":"You are a research assistant. Search the web, summarize articles, extract key facts. Always cite sources and present information with bullet points.","tools":["core.web_search","core.web_fetch"]}')

AGENT2=$(post "Code Assistant" "/api/v1/agents" \
  '{"name":"Code Assistant","systemPrompt":"You are an expert software engineer. Write clean, well-tested TypeScript, Python, Go, and Rust code. Explain your reasoning.","tools":["core.code_execute","core.file_read","core.file_write"]}')

AGENT3=$(post "Creative Writer" "/api/v1/agents" \
  '{"name":"Creative Writer","systemPrompt":"You are a creative writing assistant. Help with stories, blog posts, marketing copy, and brainstorming. Adapt tone and style to the request."}')

echo ""

# ── 2. Goals ───────────────────────────────────────────────
echo "--- Goals ---"

GOAL1=$(post "Master OwnPilot" "/api/v1/goals" \
  '{"title":"Master OwnPilot platform","description":"Learn all features: agents, workflows, triggers, knowledge graph, HITL approvals. Build a complete automation pipeline.","status":"active","priority":8,"dueDate":"2026-05-01"}')

post "Build automation" "/api/v1/goals" \
  '{"title":"Build content automation pipeline","description":"Create a workflow: RSS feeds → summarize → extract entities to knowledge graph → send weekly digests.","status":"active","priority":6,"dueDate":"2026-04-20"}'

post "Set up monitoring" "/api/v1/goals" \
  '{"title":"Set up system monitoring","description":"Configure triggers for error alerting, daily health checks, and performance metrics.","status":"active","priority":5,"dueDate":"2026-04-15"}'

echo ""

# ── 3. Memories ────────────────────────────────────────────
echo "--- Memories ---"

post "Preference" "/api/v1/memories" \
  '{"type":"preference","content":"User prefers concise responses with code examples. Likes bullet points over long paragraphs.","importance":0.9}'

post "Tech stack" "/api/v1/memories" \
  '{"type":"fact","content":"Project uses TypeScript monorepo with Turborepo. Backend: Hono, Frontend: React 19 + Vite + Tailwind. Database: PostgreSQL with pgvector.","importance":0.8}'

post "Team workflow" "/api/v1/memories" \
  '{"type":"fact","content":"Development team uses Docker for local dev. CI/CD on GitHub Actions. Deployments target a VPS with Docker Compose.","importance":0.7}'

post "Debug skill" "/api/v1/memories" \
  '{"type":"skill","content":"Docker networking debug: 1) check hostname resolution, 2) verify port exposed, 3) check firewall, 4) verify bind address (0.0.0.0 vs 127.0.0.1).","importance":0.85}'

post "Project kickoff" "/api/v1/memories" \
  '{"type":"event","content":"Project kickoff 2026-04-01. Setup: Docker dev env, 4 Tier 1 services (Graph RAG, HITL, Workflow Generator, Hooks), integration tests.","importance":0.6}'

echo ""

# ── 4. Triggers ────────────────────────────────────────────
echo "--- Triggers ---"

post "Morning summary" "/api/v1/triggers" \
  '{"name":"Daily Morning Summary","type":"schedule","description":"Every morning at 8:00 — summarize pending goals and tasks","config":{"cron":"0 8 * * *","timezone":"Europe/Moscow"},"action":{"type":"chat","payload":{"message":"Good morning! Summarize my active goals, pending HITL approvals, and any trigger errors from the last 24h."}},"enabled":true,"priority":7}'

post "Weekly digest" "/api/v1/triggers" \
  '{"name":"Weekly Knowledge Digest","type":"schedule","description":"Every Monday at 9:00 — weekly knowledge graph summary","config":{"cron":"0 9 * * 1","timezone":"Europe/Moscow"},"action":{"type":"chat","payload":{"message":"Compile a weekly digest of new entities in the knowledge graph. Group by entity type, highlight key relationships."}},"enabled":true,"priority":5}'

post "Error watchdog" "/api/v1/triggers" \
  '{"name":"Error Watchdog","type":"condition","description":"Alert when workflow errors exceed threshold","config":{"condition":"workflow_errors_last_hour > 5","checkInterval":300},"action":{"type":"chat","payload":{"message":"ALERT: >5 workflow errors in the last hour. Investigate and summarize failures."}},"enabled":false,"priority":9}'

echo ""

# ── 5. Plans ───────────────────────────────────────────────
echo "--- Plans ---"

post "Automation plan" "/api/v1/plans" \
  '{"name":"Content Automation Pipeline","goal":"Build end-to-end pipeline: RSS monitoring -> article summarization -> entity extraction -> knowledge graph -> weekly digest email","description":"Phase 1: RSS fetch workflow. Phase 2: LLM summarization. Phase 3: Graph RAG ingestion. Phase 4: Digest generation with HITL approval."}'

post "Monitoring plan" "/api/v1/plans" \
  '{"name":"System Health Monitoring","goal":"Automated health checks with escalation: scheduled triggers check endpoints, condition triggers catch anomalies, HITL gates critical actions","description":"Step 1: Health check trigger (every 5 min). Step 2: Error threshold condition. Step 3: HITL approval for restart. Step 4: Notification hooks on workflow completion."}'

echo ""

# ── 6. Workflows ───────────────────────────────────────────
echo "--- Workflows ---"

post "Research Pipeline" "/api/v1/workflows" '{
  "name": "Web Research Pipeline",
  "description": "Search the web, fetch results, summarize with LLM, output findings",
  "nodes": [
    {"id":"trigger_1","type":"triggerNode","position":{"x":400,"y":0},"data":{"triggerType":"manual","label":"Start Research"}},
    {"id":"tool_search","type":"toolNode","position":{"x":400,"y":140},"data":{"toolName":"core.web_search","toolArgs":{"query":"latest AI developments 2026"},"label":"Web Search"}},
    {"id":"llm_summarize","type":"llmNode","position":{"x":400,"y":280},"data":{"label":"Summarize Results","provider":"openai","model":"gpt-4o","userMessage":"Summarize these search results into 5 key findings with bullet points.","systemMessage":"You are a research summarizer."}},
    {"id":"output_1","type":"outputNode","position":{"x":400,"y":420},"data":{"label":"Research Summary"}}
  ],
  "edges": [
    {"id":"e1","source":"trigger_1","target":"tool_search"},
    {"id":"e2","source":"tool_search","target":"llm_summarize"},
    {"id":"e3","source":"llm_summarize","target":"output_1"}
  ]
}'

post "Content Review (HITL)" "/api/v1/workflows" '{
  "name": "Content Review with Human Approval",
  "description": "Generate content, get human approval via HITL, then route based on decision",
  "nodes": [
    {"id":"trigger_1","type":"triggerNode","position":{"x":400,"y":0},"data":{"triggerType":"manual","label":"New Content Request"}},
    {"id":"llm_draft","type":"llmNode","position":{"x":400,"y":150},"data":{"label":"Draft Content","provider":"openai","model":"gpt-4o","userMessage":"Write a short blog post about building AI-powered automation workflows.","systemMessage":"You are a tech blogger who writes engaging, practical content."}},
    {"id":"code_format","type":"codeNode","position":{"x":400,"y":300},"data":{"label":"Format as Markdown","language":"javascript","code":"const draft = inputs.llm_draft?.output || \"No content\";\nreturn { formatted: \"# Blog Post\\n\\n\" + draft, wordCount: draft.split(\" \").length };"}},
    {"id":"output_ready","type":"outputNode","position":{"x":400,"y":450},"data":{"label":"Content Ready for Review"}}
  ],
  "edges": [
    {"id":"e1","source":"trigger_1","target":"llm_draft"},
    {"id":"e2","source":"llm_draft","target":"code_format"},
    {"id":"e3","source":"code_format","target":"output_ready"}
  ]
}'

post "Data ETL Pipeline" "/api/v1/workflows" '{
  "name": "Data ETL: Fetch - Transform - Store",
  "description": "Extract data from API, transform with code, generate summary with LLM",
  "nodes": [
    {"id":"trigger_1","type":"triggerNode","position":{"x":400,"y":0},"data":{"triggerType":"manual","label":"Run ETL"}},
    {"id":"tool_fetch","type":"toolNode","position":{"x":400,"y":140},"data":{"toolName":"core.web_fetch","toolArgs":{"url":"https://jsonplaceholder.typicode.com/posts?_limit=5"},"label":"Fetch API Data"}},
    {"id":"code_transform","type":"codeNode","position":{"x":400,"y":280},"data":{"label":"Transform Data","language":"javascript","code":"const posts = JSON.parse(inputs.tool_fetch?.output || \"[]\");\nreturn { count: posts.length, titles: posts.map(p => p.title), avgLength: Math.round(posts.reduce((s,p) => s + p.body.length, 0) / posts.length) };"}},
    {"id":"llm_report","type":"llmNode","position":{"x":400,"y":420},"data":{"label":"Generate Report","provider":"openai","model":"gpt-4o","userMessage":"Generate a brief data quality report for this dataset summary.","systemMessage":"You are a data analyst."}},
    {"id":"output_1","type":"outputNode","position":{"x":400,"y":560},"data":{"label":"ETL Complete"}}
  ],
  "edges": [
    {"id":"e1","source":"trigger_1","target":"tool_fetch"},
    {"id":"e2","source":"tool_fetch","target":"code_transform"},
    {"id":"e3","source":"code_transform","target":"llm_report"},
    {"id":"e4","source":"llm_report","target":"output_1"}
  ]
}'

echo ""

# ── 7. Knowledge Graph ─────────────────────────────────────
echo "--- Knowledge Graph ---"

post "Ingest: AI companies" "/api/v1/knowledge-graph/ingest-text" \
  '{"text":"OpenAI developed GPT-4 and DALL-E. Anthropic created Claude. Google DeepMind built Gemini. Meta released LLaMA as open-source. Mistral AI in Paris released Mixtral.","agentId":"default"}' 200

post "Ingest: project" "/api/v1/knowledge-graph/ingest-text" \
  '{"text":"OwnPilot is a privacy-first AI platform built with TypeScript. Uses PostgreSQL with pgvector. Supports OpenAI, Anthropic, LMStudio, Ollama. Four packages: core, gateway, ui, cli.","agentId":"default"}' 200

post "Ingest: devops" "/api/v1/knowledge-graph/ingest-text" \
  '{"text":"Development uses Docker Compose with hot reload via tsx watch and Vite. Integration tests run via shell scripts. CI uses GitHub Actions with Turborepo for parallel builds.","agentId":"default"}' 200

post "Collection: AI Research" "/api/v1/knowledge-graph/collections" \
  '{"name":"AI Research","description":"AI companies, models, and technologies","agentId":"default"}'

post "Collection: Project Docs" "/api/v1/knowledge-graph/collections" \
  '{"name":"Project Documentation","description":"Technical docs and architecture knowledge","agentId":"default"}'

echo ""

# ── 8. HITL Requests ───────────────────────────────────────
echo "--- HITL Requests ---"

post "Deploy approval" "/api/v1/hitl/requests" \
  '{"workflowLogId":"demo-deploy-001","nodeId":"hitl_deploy","interactionType":"approve_reject","mode":"blocking","title":"Production Deployment v0.3.3","message":"Deploy version 0.3.3 to production? 43 tests passed, 0 failed. Changes: 4 new API endpoints, 2 bug fixes.","data":{"version":"0.3.3","testsPassed":43}}'

post "Content review" "/api/v1/hitl/requests" \
  '{"workflowLogId":"demo-content-001","nodeId":"hitl_review","interactionType":"approve_reject","mode":"blocking","title":"Blog Post Review","message":"Review auto-generated blog post before publishing. 850 words, generated by Creative Writer agent.","data":{"wordCount":850,"generatedBy":"Creative Writer"}}'

post "Budget approval" "/api/v1/hitl/requests" \
  '{"workflowLogId":"demo-budget-001","nodeId":"hitl_budget","interactionType":"approve_reject","mode":"blocking","title":"API Budget Alert","message":"Monthly API spending reached $45 of $50 budget. Approve to continue or reject to pause non-essential calls.","data":{"currentSpend":45.20,"budget":50.00}}'

echo ""

# ── 9. Workflow Hooks ──────────────────────────────────────
echo "--- Workflow Hooks ---"

WF_ID=$(curl -s "$API/api/v1/workflows" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)

if [[ -n "$WF_ID" ]]; then
  post "Logging hook" "/api/v1/workflow-hooks/$WF_ID" \
    '{"hookType":"logging","event":"on_complete","enabled":true,"config":{"logLevel":"info","includeOutput":true}}'

  post "Webhook hook" "/api/v1/workflow-hooks/$WF_ID" \
    '{"hookType":"webhook","event":"on_error","enabled":true,"config":{"url":"https://hooks.example.com/errors","method":"POST"}}'

  post "Metrics hook" "/api/v1/workflow-hooks/$WF_ID" \
    '{"hookType":"metrics","event":"on_complete","enabled":true,"config":{"trackDuration":true,"trackTokenUsage":true}}'
else
  echo "  ! No workflows found, skipping hooks"
fi

echo ""

# ── Summary ────────────────────────────────────────────────
echo "========================================================"
echo "  SEED COMPLETE: $PASS created, $FAIL failed"
echo "========================================================"
echo ""
echo "  Open http://localhost:8501 and check:"
echo ""
echo "  Agents          → System > Agents"
echo "  Chat            → Chat (select agent + model in header)"
echo "  Goals           → AI & Automation > Goals"
echo "  Memories        → AI & Automation > Memories"
echo "  Triggers        → AI & Automation > Triggers"
echo "  Plans           → AI & Automation > Plans"
echo "  Workflows       → AI & Automation > Workflows"
echo "  Approvals       → AI & Automation > Approvals"
echo "  Workflow Hooks  → open a workflow > Hooks tab"
echo "  Model Routing   → Settings > AI Models"
echo ""

[[ $FAIL -gt 0 ]] && exit 1 || exit 0
