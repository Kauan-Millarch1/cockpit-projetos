# Cockpit de Projetos — Research (2026-08-03)

Research phase only. No implementation decisions locked yet.

## 1. Reference implementations studied

| Reference | What it is | Steal what |
|---|---|---|
| [Mission Control (builderz-labs)](https://github.com/builderz-labs/mission-control) | Self-hosted control plane for AI agents. Next.js 16 + React 19 + TS, SQLite (WAL, better-sqlite3), Zustand, Recharts, xterm.js. REST/OpenAPI + MCP + CLI + WebSocket/SSE. Data in `.data/`. | Entity model: agents / tasks / operations / knowledge / governance. Token+cost tracking. MCP surface so agents write into it. |
| [Mission Control dashboard from CLAUDE.md (DEV article)](https://dev.to/minatoplanb/i-built-a-mission-control-dashboard-with-claude-code-to-manage-20-projects-1p93) | 20+ projects tracked from markdown files w/ frontmatter (`project, path, updated, status, category`). Claude Code scans on session start, `/update` writes back at session end. Strict read-only: never modifies project code, never deploys. | **File-as-database.** Zero manual maintenance via agent write-back. Header aggregate metrics (active / tasks / blocked). Read-only boundary. |
| [Dashy](https://github.com/lissy93/dashy) | Self-hosted personal dashboard, YAML-configured, status checks, widgets, themes. | Config-as-YAML, live status pings, icon packs. |
| [Cockpit by 8grams](https://8grams.medium.com/introducing-cockpit-a-project-dashboard-from-8grams-3adfbc661fc5) | Org > projects container model. | Hierarchy: workspace > project. |
| [TaskView](https://taskview.tech/) | Self-hosted kanban, GitHub/GitLab sync via webhooks, MCP. | Per-project custom statuses. Repo sync. |
| [Plane](https://plane.so/) | Self-hosted PM with real reporting. | Cycles/modules concept for slicing work. |

## 2. What PPM literature says a portfolio dashboard must show

Sources: [Smartsheet](https://www.smartsheet.com/content/project-portfolio-dashboards), [Wrike](https://www.wrike.com/blog/project-portfolio-dashboard/), [Birdview](https://birdviewpsa.com/blog/project-portfolio-dashboards/), [North Highland](https://northhighland.com/insights/guides/14-elements-of-project-portfolio-management-ppm)

Per project: name, goal/objective, owner, timeline, RAG status.
Per portfolio: progress, risks, issues, **dependencies**, benefits, resource pressure, overdue items, RAG rollup.
Rules: consistent color code (red = risk, green = ok), real-time/automated sync over manual entry, drill-down from rollup to detail.

## 3. Dashboard design rules (desktop + mobile)

Sources: [artofstyleframe 2026](https://artofstyleframe.com/blog/dashboard-design-patterns-web-apps/), [datawireframe layout patterns](https://datawirefra.me/blog/dashboard-layout-patterns), [5of10](https://5of10.com/articles/dashboard-design-best-practices/), [FanRuan KPI cards](https://gallery.fanruan.com/kpi-card-example)

- Baseline layout = **sidebar (240–280px, 64px collapsed icon rail) + metric strip + CSS Grid card area** (`auto-fill`, `auto-rows: minmax(200px, auto)`). Linear / Stripe / Vercel / Grafana all converge here.
- **Cap the metric strip at 4–6 KPIs.** 18 cards = wallpaper, ignored within two weeks.
- Every component needs 3 designed states: loading (skeleton), empty, error.
- Ship light + dark from day one, respect `prefers-color-scheme`.
- Density over whitespace — power users want data.
- Mobile: single-column full-width card stack, 3–4 critical metrics only, touch targets ≥44px, sparklines simplify or drop. Not a squeezed desktop grid — a different information budget.
- If a metric isn't checked every session, it belongs on a detail page, not the home.

## 4. Skills registry check

`npx skills find "project dashboard portfolio registry agent engineer"` — nothing usable. Top hit 172 installs, rest <60. Below the 1K quality bar, unknown authors. **Recommendation: build it ourselves.** Installed `kpi-dashboard-design` + `dataviz` already cover the design side.

## 5. Existing project inventory (source for the registry)

`C:\Users\kauan.millarch_ecomm\Desktop\Projects` — 21 project folders today:
Agente Roberta, agente-roberto-dashboard, AI Coach, AI Puro, Apresentação, Bmad Masterclass, Chief of Staff, Dashboard, EP Stack, Extensão Notas, Jarvis, Manychat, N8n Workflows, NovArc, octogent, Onfly, PIM, Sales Ops, super-flow, Cockpit Projetos.

This is exactly the "lost sight of things" problem — 21 folders, no single view, no status, no last-touched signal.

## 6. Architecture options for our cockpit

**A. Markdown-as-database (DEV article model)** — one `.md` per project with frontmatter, cockpit reads folder. Agent writes back at end of session. Zero infra, git-versionable, editable by hand. Weakest at cross-project queries and history/trend.

**B. SQLite/Supabase-backed app (Mission Control model)** — real data model, trends over time, multi-device. Costs infra + an ingestion path.

**C. Hybrid (recommended to evaluate)** — markdown files are source of truth in the repo; a build step compiles them into a single `projects.json` the site reads. Agent engineer only ever edits markdown. Gives git history for free, cheap sync, and a static site that can be hosted anywhere and opened on the phone.

## 7. Decisions (2026-08-03)

- **Hosting:** localhost first. Deploy target decided later — so keep the build portable (no host-locked APIs, static-friendly output).
- **Data authorship:** the global agent engineer writes project data. Cockpit is the read surface; the agent is the ingestion mechanism. Manual editing stays possible but is not the primary path.

## 8. Still open

1. Which live integrations matter first: n8n runs, ClickUp tasks, git activity, Supabase, deploy status?
4. Does the cockpit only observe, or also trigger actions (run agent, open session)?
5. What makes a project "at risk" for you — days since last touch, blocked flag, deadline?
