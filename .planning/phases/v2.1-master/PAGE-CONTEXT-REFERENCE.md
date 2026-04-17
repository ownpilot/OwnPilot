# Page Context Reference — Ground Truth for Sidebar Chat Testing

> Date: 2026-04-06
> Purpose: Her sayfa icin AI'nin bilmesi gereken bilgiler ve test sorulari

---

## Test Methodology

Her sayfa icin:
1. Sayfaya git (Playwright)
2. Sidebar chat ac, OpenCode/Kimi K2.5 sec
3. Test sorusu gonder
4. AI yanitini bu referansla karsilastir
5. PASS/FAIL kaydet

---

## 1. Agents (/agents)

**DB state:** 2 agents
- `agent_1775513105304_efd72` — __ai_agent_designer (system agent)
- `agent_1775513687222_feb5d` — Code Review Agent (user-created)

**Registry:** pageType='agent', resolveContext var, preferBridge=false

**AI bilmesi gerekenler:**
- Bu sayfada agent'lar yonetiliyor
- Mevcut 2 agent var
- Agent config: name, systemPrompt, provider, model, tools, temperature
- Yeni agent olusturma: POST /api/v1/agents
- Agent duzenleme: PUT /api/v1/agents/{id}
- DB: `SELECT * FROM agents`

**Test sorulari:**
- "Bu sayfada ne yapabilirim?"
- "Kac tane agent var?"
- "Code Review Agent'in system prompt'unu goster"

**Beklenen:** AI agent kavramini bilmeli, API/DB erisimi olmasa bile "agents sayfasindasiniz" demeli

---

## 2. Workflows (/workflows, /workflows/:id)

**DB state:** 5 workflows (hepsi "Untitled Workflow", bos)

**Registry:** pageType='workflow', resolveContext var (workflowsApi.get), preferBridge=false
- Liste: 1,200 token ozet prompt
- Spesifik: 6,700 token tam Copilot prompt

**AI bilmesi gerekenler:**
- 24 node type (trigger, llm, code, condition, httpRequest, forEach, ...)
- Template syntax: {{nodeId.output}}, {{variables.key}}
- Edge rules: sourceHandle for condition/forEach/switch/parallel
- Workflow JSON yapisi: { name, nodes: [], edges: [] }

**Test sorulari (parent /workflows):**
- "Bu sayfada ne yapabilirim?"
- "Kac workflow var?"

**Test sorulari (spesifik /workflows/:id):**
- "Bu workflow'u acikla"
- "Buna bir HTTP node ekle"
- "Bu workflow'un JSON'unu goster"

**Beklenen parent:** AI workflow kavramini bilmeli
**Beklenen spesifik:** AI 24 node type'i bilmeli, JSON uretebilmeli

---

## 3. Workspaces (/workspaces)

**DB/API state:** 6 file workspace (sidebar session'lardan olusmus)

**Registry:** pageType='workspace', resolveContext var (fileWorkspacesApi), preferBridge=true

**AI bilmesi gerekenler:**
- File workspace = dosya sistemi dizini
- Path: /app/data/workspace/{session-id}/
- Dosya islemleri: ls, cat, mkdir, write
- Host-FS: /host-home/ bind mount (Docker)

**Test sorulari:**
- "Bu workspace'te ne var?"
- "Dosyalari listele"

**Beklenen:** AI workspace kavramini bilmeli, preferBridge=true oldugu icin bridge spawn olmali

---

## 4. MCP Servers (/settings/mcp-servers)

**DB state:** 0 (henuz eklenmemis)

**Registry:** pageType='mcp-server', suggestions var

**AI bilmesi gerekenler:**
- MCP = Model Context Protocol
- Server config: name, command, args, env, status
- Tool discovery: her MCP server tool'lar saglar
- Baglanti diagnostigi

**Test sorulari:**
- "MCP server nedir?"
- "Nasil yeni MCP server eklerim?"
- "Hangi MCP server'lar var?"

**Beklenen:** AI MCP kavramini bilmeli, 0 server oldugunu soylenmeli (veya DB'den kontrol etmeli)

---

## 5. Tools (/tools)

**Registry:** pageType='tool', suggestions var

**AI bilmesi gerekenler:**
- Built-in tool'lar (core.*, mcp.*)
- Tool kullanimi: use_tool("name", {args})
- Tool discovery: search_tools

**Test sorulari:**
- "Hangi tool'lar kullanilabilir?"
- "Web search tool'unu nasil kullanirim?"

---

## 6. Custom Tools (/custom-tools)

**DB state:** 0

**Registry:** pageType='custom-tool', resolveContext var

**AI bilmesi gerekenler:**
- JavaScript kod yazarak tool olusturma
- inputSchema (JSON Schema)
- execute() fonksiyonu

**Test sorulari:**
- "Yeni bir custom tool nasil olusturulur?"
- "Fibonacci hesaplayan tool yaz"

---

## 7. Claws (/claws)

**DB state:** 0

**Registry:** pageType='claw', resolveContext var, preferBridge=true

**AI bilmesi gerekenler:**
- Claw = otonom AI agent
- Modes: continuous, interval, event, single-shot
- Mission, workspace, tools
- .claw/ directive system: INSTRUCTIONS.md, TASKS.md, MEMORY.md

**Test sorulari:**
- "Claw nedir?"
- "Nasil yeni claw olusturulur?"

---

## 8. Skills Hub (/skills)

**DB state:** 0

**Registry:** pageType='skill', resolveContext var

**AI bilmesi gerekenler:**
- SKILL.md format (AgentSkills.io)
- Extension types: skill, tool, trigger, service
- Manifest: tools, code
- Skill marketplace

**Test sorulari:**
- "Skill nedir?"
- "Nasil yeni skill yuklerim?"

---

## 9. Coding Agents (/coding-agents)

**DB state:** 0 results

**Registry:** pageType='coding-agent', resolveContext var, preferBridge=true

**AI bilmesi gerekenler:**
- Coding agent = CLI tool spawn (Claude Code, Codex, etc.)
- Session: provider, model, cwd
- Bridge uzerinden calisiyor

**Test sorulari:**
- "Coding agent ne yapar?"
- "Hangi coding agent'lar var?"

---

## 10. Autonomous (/autonomous)

**Registry:** YOK (eksik — eklenecek)

**Sayfa amaci:** Background agent'lar, crew'lar, planlar, mesajlar, aktivite

**AI bilmesi gerekenler:**
- Independent Agents, Crew Collaboration, Budget Control, Activity Monitoring
- Agent olusturma: AI Create veya + New Agent
- DB: background_agents, agent_crews

**Test:** Registry eklenince test edilecek

---

## 11. Edge Devices (/edge-devices)

**DB state:** 0

**Registry:** pageType='edge-device', suggestions var

**AI bilmesi gerekenler:**
- MQTT broker (Mosquitto) entegrasyonu
- IoT cihaz yonetimi

---

## 12. CLI Tools (/settings/cli-tools)

**Registry:** YOK (eksik)

**Sayfa amaci:** AI'nin erisebilecegi CLI tool'lari yonetimi
- Tool Registry, Permission Control, Custom Scripts, Sandboxing

---

## 13. Tool Groups (/settings/tool-groups)

**Registry:** YOK (eksik)

**Sayfa amaci:** Tool'lari gruplara ayirma
- 8 groups enabled, 77 tools available
- Logical Grouping, Agent Assignment, Access Control, Bulk Management

---

## 14. Workflow Templates (/settings/workflow-tools)

**Registry:** YOK (eksik)

**Sayfa amaci:** Workflow tool ayarlari

---

## Test Execution Plan

1. Docker build (son gateway degisiklikleri)
2. Her sayfa icin Playwright ile:
   a. Navigate
   b. StatsPanel > Chat tab
   c. Provider: OpenCode / kimi-k2.5
   d. Test sorusu gonder
   e. 30s bekle
   f. Screenshot + yanit kaydet
   g. PASS/FAIL degerlendirme
3. Sonuclari tabloya yaz
