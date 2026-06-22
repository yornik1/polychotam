# Graph Report - .  (2026-06-16)

## Corpus Check
- 325 files · ~179,195 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 1182 nodes · 2512 edges · 92 communities (57 shown, 35 thin omitted)
- Extraction: 98% EXTRACTED · 2% INFERRED · 0% AMBIGUOUS · INFERRED: 45 edges (avg confidence: 0.78)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- [[_COMMUNITY_Market Data DTOs|Market Data DTOs]]
- [[_COMMUNITY_Telegram Bot Layer|Telegram Bot Layer]]
- [[_COMMUNITY_OMX Autopilot Orchestration|OMX Autopilot Orchestration]]
- [[_COMMUNITY_Polymarket Data API Client|Polymarket Data API Client]]
- [[_COMMUNITY_Product Analytics Agents|Product Analytics Agents]]
- [[_COMMUNITY_Codex Agent Framework|Codex Agent Framework]]
- [[_COMMUNITY_App Module & Trade Enrichment|App Module & Trade Enrichment]]
- [[_COMMUNITY_BullMQ Queue Infrastructure|BullMQ Queue Infrastructure]]
- [[_COMMUNITY_Smart Wallets Service|Smart Wallets Service]]
- [[_COMMUNITY_Markets Module|Markets Module]]
- [[_COMMUNITY_Live Trade Enricher|Live Trade Enricher]]
- [[_COMMUNITY_Gamma Top Markets|Gamma Top Markets]]
- [[_COMMUNITY_Wallet PnL Types & Utils|Wallet PnL Types & Utils]]
- [[_COMMUNITY_Ralplan Consensus Planning|Ralplan Consensus Planning]]
- [[_COMMUNITY_Package Dependencies|Package Dependencies]]
- [[_COMMUNITY_TypeScript Configuration|TypeScript Configuration]]
- [[_COMMUNITY_Trade Events & Backfill|Trade Events & Backfill]]
- [[_COMMUNITY_Codex Task & Review Skills|Codex Task & Review Skills]]
- [[_COMMUNITY_Trade Processor & Tests|Trade Processor & Tests]]
- [[_COMMUNITY_Market Entity & Resolution|Market Entity & Resolution]]
- [[_COMMUNITY_Community 20|Community 20]]
- [[_COMMUNITY_Community 21|Community 21]]
- [[_COMMUNITY_Community 22|Community 22]]
- [[_COMMUNITY_Community 23|Community 23]]
- [[_COMMUNITY_Community 24|Community 24]]
- [[_COMMUNITY_Community 25|Community 25]]
- [[_COMMUNITY_Community 26|Community 26]]
- [[_COMMUNITY_Community 27|Community 27]]
- [[_COMMUNITY_Community 28|Community 28]]
- [[_COMMUNITY_Community 29|Community 29]]
- [[_COMMUNITY_Community 30|Community 30]]
- [[_COMMUNITY_Community 31|Community 31]]
- [[_COMMUNITY_Community 32|Community 32]]
- [[_COMMUNITY_Community 33|Community 33]]
- [[_COMMUNITY_Community 34|Community 34]]
- [[_COMMUNITY_Community 35|Community 35]]
- [[_COMMUNITY_Community 36|Community 36]]
- [[_COMMUNITY_Community 37|Community 37]]
- [[_COMMUNITY_Community 38|Community 38]]
- [[_COMMUNITY_Community 39|Community 39]]
- [[_COMMUNITY_Community 40|Community 40]]
- [[_COMMUNITY_Community 41|Community 41]]
- [[_COMMUNITY_Community 42|Community 42]]
- [[_COMMUNITY_Community 43|Community 43]]
- [[_COMMUNITY_Community 44|Community 44]]
- [[_COMMUNITY_Community 45|Community 45]]
- [[_COMMUNITY_Community 46|Community 46]]
- [[_COMMUNITY_Community 47|Community 47]]
- [[_COMMUNITY_Community 48|Community 48]]
- [[_COMMUNITY_Community 49|Community 49]]
- [[_COMMUNITY_Community 50|Community 50]]
- [[_COMMUNITY_Community 51|Community 51]]
- [[_COMMUNITY_Community 52|Community 52]]
- [[_COMMUNITY_Community 53|Community 53]]
- [[_COMMUNITY_Community 54|Community 54]]
- [[_COMMUNITY_Community 55|Community 55]]
- [[_COMMUNITY_Community 56|Community 56]]
- [[_COMMUNITY_Community 57|Community 57]]
- [[_COMMUNITY_Community 58|Community 58]]
- [[_COMMUNITY_Community 59|Community 59]]
- [[_COMMUNITY_Community 60|Community 60]]
- [[_COMMUNITY_Community 61|Community 61]]
- [[_COMMUNITY_Community 62|Community 62]]
- [[_COMMUNITY_Community 63|Community 63]]
- [[_COMMUNITY_Community 64|Community 64]]
- [[_COMMUNITY_Community 65|Community 65]]
- [[_COMMUNITY_Community 66|Community 66]]
- [[_COMMUNITY_Community 67|Community 67]]
- [[_COMMUNITY_Community 68|Community 68]]
- [[_COMMUNITY_Community 69|Community 69]]
- [[_COMMUNITY_Community 70|Community 70]]
- [[_COMMUNITY_Community 71|Community 71]]
- [[_COMMUNITY_Community 72|Community 72]]
- [[_COMMUNITY_Community 73|Community 73]]
- [[_COMMUNITY_Community 74|Community 74]]
- [[_COMMUNITY_Community 75|Community 75]]
- [[_COMMUNITY_Community 76|Community 76]]
- [[_COMMUNITY_Community 77|Community 77]]
- [[_COMMUNITY_Community 78|Community 78]]
- [[_COMMUNITY_Community 79|Community 79]]
- [[_COMMUNITY_Community 80|Community 80]]
- [[_COMMUNITY_Community 81|Community 81]]
- [[_COMMUNITY_Community 82|Community 82]]
- [[_COMMUNITY_Community 83|Community 83]]
- [[_COMMUNITY_Community 84|Community 84]]
- [[_COMMUNITY_Community 85|Community 85]]
- [[_COMMUNITY_Community 87|Community 87]]
- [[_COMMUNITY_Community 88|Community 88]]
- [[_COMMUNITY_Community 89|Community 89]]
- [[_COMMUNITY_Community 90|Community 90]]

## God Nodes (most connected - your core abstractions)
1. `SmartWalletsService` - 41 edges
2. `Market` - 37 edges
3. `PolymarketHttpClient` - 36 edges
4. `Trade` - 28 edges
5. `WalletPnlV2Service` - 25 edges
6. `MarketsService` - 24 edges
7. `MarketSyncService` - 21 edges
8. `DataApiClient` - 21 edges
9. `TelegramUpdate` - 21 edges
10. `TradeEvent` - 21 edges

## Surprising Connections (you probably didn't know these)
- `Test Review Skill (Polychotam)` --semantically_similar_to--> `Review Task Skill (Polychotam Commit + Notion Update)`  [INFERRED] [semantically similar]
  .codex/skills/test-review/SKILL.md → .cursor/skills/review-task/SKILL.md
- `Review Task Skill — Commit & PR Preparation Workflow` --semantically_similar_to--> `Atomic Commits Pattern — One Concern Per Commit`  [INFERRED] [semantically similar]
  .claude/skills/review-task.md → .codex/prompts/git-master.md
- `Codex Start-Task Skill (Polychotam)` --semantically_similar_to--> `Cursor Start-Task Skill (Notion TDD workflow)`  [INFERRED] [semantically similar]
  .codex/skills/start-task/SKILL.md → .cursor/skills/start-task/SKILL.md
- `Cash-Flow PnL Formula (usdcSize + MTM)` --semantically_similar_to--> `Mark-to-Market via BBO Snapshots Design`  [INFERRED] [semantically similar]
  .omc/plans/phase1-pnl-v2-smart-score.md → scripts/research/whale-predictive-value.md
- `Smart Whale Whitelist (≥10 trades, sum_pnl>0, HR>60%)` --semantically_similar_to--> `Smart Score Wallet Scoring (PnL + WinRate + ProfitFactor)`  [INFERRED] [semantically similar]
  scripts/research/whale-predictive-value-iteration3-results.md → .omc/plans/phase1-pnl-v2-smart-score.md

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Planning Pipeline — Analyst → Planner → Critic** — codex_analyst_agent, codex_planner_agent, codex_critic_agent [EXTRACTED 0.95]
- **Code Review Dual Lane — Code Reviewer + Architect** — codex_codereviewer_agent, codex_architect_agent, concept_spec_compliance [EXTRACTED 0.95]
- **Polychotam Project Workflow Skills — Check/Fix/Review/Quiz** — skills_check_workflow, skills_fix_workflow, skills_reviewtask_workflow, skills_quiz_socratic [EXTRACTED 0.95]
- **Prometheus Strict Planning Pipeline (Metis → Momus → Oracle)** — prompts_prometheus_strict_metis_metis, prompts_prometheus_strict_momus_momus, prompts_prometheus_strict_oracle_oracle [EXTRACTED 1.00]
- **Quality Assurance Triad (Quality Reviewer + Test Engineer + Verifier)** — prompts_quality_reviewer_quality_reviewer, prompts_test_engineer_test_engineer, prompts_verifier_verifier [INFERRED 0.85]
- **Product Discovery Triad (UX Researcher + Product Manager + Product Analyst)** — prompts_ux_researcher_daedalus, prompts_product_manager_athena, prompts_product_analyst_hermes [INFERRED 0.85]
- **Autopilot Pipeline Phases (deep-interview -> ralplan -> ultragoal -> code-review -> ultraqa)** — autopilot_skill_autopilot, deepinterview_skill_deepinterview, omx_skill_ralplan, omx_skill_ultragoal, codereview_skill_codereview, omx_skill_ultraqa [EXTRACTED 1.00]
- **OMX Planning Skill Family (plan, deep-interview, prometheus-strict)** — plan_skill_plan, deepinterview_skill_deepinterview, prometheusstrict_skill_prometheusstrict [INFERRED 0.85]
- **OMX Research Skill Family (autoresearch, autoresearch-goal, best-practice-research)** — autoresearch_skill_autoresearch, autoresearchgoal_skill_autoresearchgoal, bestpracticeresearch_skill_bestpracticeresearch [INFERRED 0.85]
- **Polychotam Task Workflow Loop (start → check → review)** — cursor_starttask_skill, cursor_check_skill, cursor_reviewtask_skill [INFERRED 0.90]
- **OMX Consensus-to-Execution Chain (ralplan → ultragoal → team)** — codex_ralplan_skill, codex_ultragoal_skill, codex_team_skill [EXTRACTED 1.00]
- **Polychotam Learning Loop (walkthrough → quiz → socratic reviewer)** — cursor_walkthrough_skill, cursor_quiz_skill, cursor_socraticreviewer_agent [INFERRED 0.85]
- **PnL v2 Core Pipeline: Cash-Flow Formula + Watermark Sync + lb-api Validation** — omc_plans_phase1_cashflowpnl, omc_plans_phase1_watermarksync, omc_plans_phase1_lbcrossvalidation [EXTRACTED 0.95]
- **Whale Research Progression: Iter2 Task → Results → Iter3 Wallet-Level Analysis** — scripts_research_whale_iter2_task, scripts_research_whale_iter2_results, scripts_research_whale_iter3_results [EXTRACTED 0.95]
- **Full Deploy Pipeline: GitHub Actions → SSH → docker-compose.prod → Health Check** — github_workflows_deploy_ec2_deployworkflow, github_workflows_deploy_ec2_sshaction, github_workflows_deploy_ec2_healthcheck [EXTRACTED 1.00]

## Communities (92 total, 35 thin omitted)

### Community 0 - "Market Data DTOs"
Cohesion: 0.06
Nodes (20): MarketDto, MarketsResponseDto, PolymarketMarketRaw, PolymarketSimplifiedMarketRaw, PolymarketSimplifiedTokenRaw, assertBooleanField(), assertNonEmptyStringField(), assertNormalizedIsoDateField() (+12 more)

### Community 1 - "Telegram Bot Layer"
Cohesion: 0.07
Nodes (38): isAdminChat(), asMarketTokens(), ErrorEntry, escapeHtml(), formatAgo(), formatAlertHitRatePercent(), formatAlertRoiPercent(), formatAlertsStatusMessage() (+30 more)

### Community 2 - "OMX Autopilot Orchestration"
Cohesion: 0.07
Nodes (49): Autopilot Skill, Ralplan Consensus Gate, Autopilot State Management, Autopilot Strict Loop Contract, Autoresearch Skill, Autoresearch Validation Mode, Autoresearch Goal Skill, Professor-Critic Validation (+41 more)

### Community 3 - "Polymarket Data API Client"
Cohesion: 0.08
Nodes (11): DataApiClient, DataApiMaxPagesExceededError, DataApiTimeoutError, DataApiUpstreamError, FetchActivityPageOpts, FetchAllActivityOpts, LbProfitResult, LbProfitWindow (+3 more)

### Community 4 - "Product Analytics Agents"
Cohesion: 0.07
Nodes (36): Event Schema Design, Experiment Measurement Design, Hermes - Product Analyst Agent, Product Metric Definition, Athena - Product Manager Agent, KPI Tree, Product Requirements Document (PRD), Value Hypothesis (+28 more)

### Community 5 - "Codex Agent Framework"
Cohesion: 0.09
Nodes (35): Analyst Agent (Metis) — Requirements Gap Analysis, API Reviewer Agent — Contract & Backward Compatibility Review, Architect Agent (Oracle) — Read-Only Strategic Analysis, Build Fixer Agent — Minimal-Diff Compilation Error Resolution, Code Reviewer Agent — Severity-Rated Two-Stage Review, Code Simplifier Agent — Clarity & Maintainability Refiner, Critic Agent — Work Plan Review & Actionability Gate, Debugger Agent — Root-Cause Analysis & Minimal Fix (+27 more)

### Community 6 - "App Module & Trade Enrichment"
Cohesion: 0.14
Nodes (14): TradeEnrichmentProcessor, AppModule, E2eTradesProcessorStub, E2eTradesProcessorStub, E2eTradesProcessorStub, emptySpec, VALID_SCORES, WalletScoreSpecialization (+6 more)

### Community 7 - "BullMQ Queue Infrastructure"
Cohesion: 0.11
Nodes (17): TRADE_ENRICHMENT_WORKER_OPTIONS, tradesDerivedJobId(), tradesQueueRegisterOptions, WALLET_ANALYTICS_WORKER_OPTIONS, walletAnalyticsQueueRegisterOptions, MarketResolution, MarketScoreReasonCode, MarketScoreReasonImpact (+9 more)

### Community 9 - "Markets Module"
Cohesion: 0.16
Nodes (13): MarketsModule, PolymarketController, PolymarketEnrichmentModule, PolymarketGateway, PolymarketModule, QueueController, QueueModule, tradeEnrichmentQueueRegisterOptions (+5 more)

### Community 10 - "Live Trade Enricher"
Cohesion: 0.15
Nodes (9): asString(), asTimestamp(), HistoricalTradeCandidate, isPlainRecord(), LiveTradeEnricherService, normalizeToSeconds(), numericEqual(), priceNear() (+1 more)

### Community 11 - "Gamma Top Markets"
Cohesion: 0.13
Nodes (7): buildTopMarketsWsSelectionFromGamma(), PolymarketService, PolymarketServiceCtor, buildTopMarketsWsSelection(), pickTopMarketsByVolume(), TopMarketsWsSelection, TopMarketWsRow

### Community 12 - "Wallet PnL Types & Utils"
Cohesion: 0.12
Nodes (8): WalletPnlQueryOptions, WalletPnlSummary, WalletUpsertInput, parseWalletPnlDays(), resolveWalletPnlPeriod(), WalletPnlResolvedPeriod, WalletsController, WalletsService

### Community 13 - "Ralplan Consensus Planning"
Cohesion: 0.12
Nodes (24): Consensus Planning Workflow, Durable Consensus Handoff Contract, Planner-Architect-Critic Consensus Loop, Pre-Execution Gate (ralplan-first), RALPLAN-DR Structured Deliberation, Ralplan Skill (Consensus Planning), Team Big Five / ATEM Coordination Gate, Team Skill (OMX tmux Parallel Execution) (+16 more)

### Community 14 - "Package Dependencies"
Cohesion: 0.08
Nodes (24): dependencies, @bull-board/api, @bull-board/express, @bull-board/nestjs, bullmq, dotenv, ethers, ioredis (+16 more)

### Community 15 - "TypeScript Configuration"
Cohesion: 0.09
Nodes (22): compilerOptions, allowSyntheticDefaultImports, baseUrl, emitDecoratorMetadata, esModuleInterop, experimentalDecorators, forceConsistentCasingInFileNames, incremental (+14 more)

### Community 16 - "Trade Events & Backfill"
Cohesion: 0.18
Nodes (10): asNonEmptyString(), asString(), asTimestamp(), asTraderSide(), asTradeSide(), BackfillService, HistoricalTradeRaw, isPlainRecord() (+2 more)

### Community 17 - "Codex Task & Review Skills"
Cohesion: 0.12
Nodes (20): Execution Brief Output Shape, Codex Start-Task Skill (Polychotam), Business-Meaningful Test Coverage Check, Test Review Skill (Polychotam), DoD Checklist Verification Flow, Check Skill (Polychotam DoD Verification), Known Debug Pitfalls (WS URL, logger level, BullMQ silent return), Debug Layer Localization (tests/build/runtime/queue/db/ws) (+12 more)

### Community 18 - "Trade Processor & Tests"
Cohesion: 0.18
Nodes (6): TradesProcessor, TRADES_WORKER_OPTIONS, buildWsTradeRecordId(), TradeIdentity, TradeEvent, TradesBackfillPageJob

### Community 19 - "Market Entity & Resolution"
Cohesion: 0.23
Nodes (7): Market, ReplyContext, Trade, TradesController, HistoricalTradeEvent, SaveWsTradeOutcome, TradeUpsertPayload

### Community 20 - "Community 20"
Cohesion: 0.14
Nodes (20): Boundary Timestamp Deduplication, Cash-Flow PnL Formula (usdcSize + MTM), lb-api Cross-Validation with Epsilon Tolerance, Phase 1 PnL v2 + Smart Score Plan, Smart Score Wallet Scoring (PnL + WinRate + ProfitFactor), Timestamp Watermark Incremental Sync, Whale Candidate Discovery Pipeline (Phase 1.5), Phase 1.5 Acceptance Criteria (Discovery Pipeline) (+12 more)

### Community 21 - "Community 21"
Cohesion: 0.17
Nodes (6): WalletPnlDivergence, LbCrossCheckService, VALIDATION_WINDOWS, classifyDivergence(), DivergenceThresholds, thresholds

### Community 22 - "Community 22"
Cohesion: 0.16
Nodes (8): MarketScoreService, MarketTokenLike, ReplyContext, MarketScore, MarketScoreConclusionCode, MarketScoreDataGapCode, MarketScoreInput, MarketScoreReason

### Community 23 - "Community 23"
Cohesion: 0.11
Nodes (18): devDependencies, eslint, eslint-config-prettier, @nestjs/cli, @nestjs/schematics, @nestjs/testing, prettier, supertest (+10 more)

### Community 24 - "Community 24"
Cohesion: 0.21
Nodes (17): BITQUERY_TIMEOUT_MS, bitqueryTopSide(), chunkBySize(), fetchAllActiveMarketsKeyset(), fetchWithRetry(), main(), mergeVolumes(), normMarket() (+9 more)

### Community 25 - "Community 25"
Cohesion: 0.12
Nodes (17): scripts, build, lint, migration:create, migration:generate, migration:revert, migration:run, smart-wallets:refresh (+9 more)

### Community 26 - "Community 26"
Cohesion: 0.26
Nodes (7): WalletPnlV2Summary, WalletPnlV2Window, deduplicateBoundary(), makeIdentity(), mergeByOperation(), WalletPnlV2Service, computeCashFlowPnl()

### Community 27 - "Community 27"
Cohesion: 0.16
Nodes (7): CommonController, CommonModule, CommonService, buildBullMqConfig(), buildBullMqConnection(), BullJobErrorLogListener, QueueEventKind

### Community 28 - "Community 28"
Cohesion: 0.21
Nodes (3): MarketSyncService, bootstrap(), parsePositiveInt()

### Community 29 - "Community 29"
Cohesion: 0.16
Nodes (4): PolymarketMarketResolutionService, WsClientInternals, wsHarness, PolymarketWsStatusService

### Community 30 - "Community 30"
Cohesion: 0.19
Nodes (3): WsConnectionEvent, WsConnectionKind, WsUptimeService

### Community 31 - "Community 31"
Cohesion: 0.17
Nodes (10): SmartWalletAggregate, SmartWalletDetail, SmartWalletRefreshOptions, SmartWalletRefreshResult, SmartWalletRefreshRow, SmartWalletRefreshSkippedEntry, SmartWalletRefreshThresholds, SmartWalletStats (+2 more)

### Community 32 - "Community 32"
Cohesion: 0.20
Nodes (4): resolveBullJobErrorsLogPathRaw(), BullJobNdjsonLogService, NdjsonErrorRow, QueueCountsRow

### Community 33 - "Community 33"
Cohesion: 0.16
Nodes (6): WalletAnalyticsProcessor, computeRollingCheck(), RollingCheckInput, RollingCheckResult, isMarketCategory(), WalletScoreService

### Community 34 - "Community 34"
Cohesion: 0.17
Nodes (13): Delegation Rules (deep-interview / ralplan / team / ralph), Lore Commit Protocol (decision record in git trailers), AGENTS.md — oh-my-codex Orchestration Contract, CLAUDE.md — Claude Code Project Guide, TDD Approach (spec first, Vitest), Teach Mode (Code Reference + Quiz after each edit), Markets Ingest MVP Plan (GET /markets TDD Steps), Markets Ingest MVP Design Spec (+5 more)

### Community 35 - "Community 35"
Cohesion: 0.24
Nodes (8): ENV_FILE_PATHS, buildTypeOrmConfig(), getDataSourceOptions(), parseDatabaseUrl(), ParsedDbUrl, AppDataSource, configService, databaseUrl

### Community 36 - "Community 36"
Cohesion: 0.46
Nodes (9): MarketSnapshotRow, buildTokensJsonFromGamma(), deriveWinningTokenIdFromGamma(), gammaConditionId(), gammaLiquidityNum(), gammaVolume24hr(), gammaWinningOutcome(), parseClobTokenIdsFromGamma() (+1 more)

### Community 37 - "Community 37"
Cohesion: 0.31
Nodes (7): isPlainRecord(), MarketResolvedWsPayload, tryParseMarketResolvedWsPayload(), asNonEmptyString(), isTradeSide(), parseTimestamp(), parseTradeEventsFromWsPayload()

### Community 38 - "Community 38"
Cohesion: 0.27
Nodes (8): GammaMarketRaw, CRYPTO_CATEGORY_KEYWORDS, findCategoryInTags(), mapGammaCategory(), MarketCategory, normalizeCategoryString(), POLITICS_CATEGORY_KEYWORDS, SPORTS_CATEGORY_KEYWORDS

### Community 39 - "Community 39"
Cohesion: 0.23
Nodes (5): fetchAllActiveMarkets(), fetchGammaKeysetPayload(), fetchWithRetry(), normMarket(), num()

### Community 44 - "Community 44"
Cohesion: 0.44
Nodes (8): http_post_json(), is_cli_available(), load_env_file(), main(), query_codex_cli(), query_gemini(), query_gemini_cli(), query_openai()

### Community 47 - "Community 47"
Cohesion: 0.33
Nodes (7): DEPLOY.md — AWS EC2 t3.small Setup Guide, docker-compose.yml Development Services, Production Memory Limits (512M app, 512M postgres, 128M redis), docker-compose.prod.yml Production Services (app+postgres+redis), Deploy EC2 GitHub Actions Workflow, Health Check Loop on Deploy, SSH Deploy Action (appleboy/ssh-action)

### Community 48 - "Community 48"
Cohesion: 0.71
Nodes (4): parseBoolean(), parsePositiveInt(), parsePositiveNumber(), bootstrap()

### Community 50 - "Community 50"
Cohesion: 0.38
Nodes (5): WalletPnlDataGapCode, calculateResolvedTradePnl(), ResolvedTradePnlOutcome, ResolvedTradePnlResult, WALLET_PNL_LIMITATIONS

### Community 51 - "Community 51"
Cohesion: 0.33
Nodes (6): Quiz Skill (Polychotam Socratic Tutor), Quiz Teach-then-Question Format, Polychotam Socratic Reviewer Agent, Socratic Tutor Dialog Rules, Onboarding Module Walkthrough Sequence, Walkthrough Skill (Polychotam Module Explainer)

### Community 52 - "Community 52"
Cohesion: 0.33
Nodes (5): collection, compilerOptions, deleteOutDir, $schema, sourceRoot

### Community 53 - "Community 53"
Cohesion: 0.33
Nodes (5): description, license, name, private, version

### Community 54 - "Community 54"
Cohesion: 0.53
Nodes (4): computeWalletScore(), ComputeWalletScoreInput, normalizePnl(), sigmoid()

### Community 56 - "Community 56"
Cohesion: 0.40
Nodes (5): Quality Reviewer Agent, SOLID Principles Review, OWASP Top 10 Security Analysis, Security Reviewer Agent, Style Reviewer Agent

### Community 58 - "Community 58"
Cohesion: 0.40
Nodes (4): compilerOptions, sourceMap, exclude, extends

### Community 73 - "Community 73"
Cohesion: 0.67
Nodes (3): Skill Lifecycle (add/remove/edit/sync), Skill Management CLI, Skill Templates (Error/Workflow/Pattern/Integration)

### Community 74 - "Community 74"
Cohesion: 0.67
Nodes (3): Reproducible Design System Output, Visual Ralph Skill (Frontend UI Delivery Loop), Visual Ralph Verdict + Pixel-Diff Loop

### Community 75 - "Community 75"
Cohesion: 0.67
Nodes (3): LLM Council Query Process (prompt + synth + plan), LLM Council Setup (API keys, CLI fallback), LLM Council Skill (ChatGPT + Gemini Architecture Consultation)

### Community 76 - "Community 76"
Cohesion: 0.67
Nodes (3): WebSocket CLOB Module Implementation Plan, Polymarket CLOB WebSocket Design Spec, WebSocket Reconnect Full Cycle (HTTP fetch → top-20 → subscribe)

### Community 77 - "Community 77"
Cohesion: 0.67
Nodes (3): Ontology Validation (Category Mistake Detection), Evidence vs Inference Distinction, Analyze Skill (Read-Only Deep Repository Analysis)

### Community 78 - "Community 78"
Cohesion: 0.67
Nodes (3): Sisyphus-Lite Agent (Fast Bounded Worker), Team Executor Agent, Team Orchestrator Brain

## Knowledge Gaps
- **243 isolated node(s):** `docker-entrypoint.sh script`, `$schema`, `collection`, `sourceRoot`, `deleteOutDir` (+238 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **35 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `SmartWalletsService` connect `Smart Wallets Service` to `App Module & Trade Enrichment`, `Community 40`, `Community 41`, `Community 48`, `Market Entity & Resolution`, `Community 22`, `Community 57`, `Community 31`?**
  _High betweenness centrality (0.037) - this node is a cross-community bridge._
- **Why does `PolymarketHttpClient` connect `Market Data DTOs` to `Community 36`, `Community 37`, `App Module & Trade Enrichment`, `Markets Module`, `Gamma Top Markets`, `Community 55`, `Community 28`, `Community 29`?**
  _High betweenness centrality (0.028) - this node is a cross-community bridge._
- **Why does `DataApiClient` connect `Polymarket Data API Client` to `Markets Module`, `Community 26`, `Community 21`, `App Module & Trade Enrichment`?**
  _High betweenness centrality (0.028) - this node is a cross-community bridge._
- **What connects `docker-entrypoint.sh script`, `$schema`, `collection` to the rest of the system?**
  _256 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Market Data DTOs` be split into smaller, more focused modules?**
  _Cohesion score 0.05997778600518327 - nodes in this community are weakly interconnected._
- **Should `Telegram Bot Layer` be split into smaller, more focused modules?**
  _Cohesion score 0.06775956284153005 - nodes in this community are weakly interconnected._
- **Should `OMX Autopilot Orchestration` be split into smaller, more focused modules?**
  _Cohesion score 0.0663265306122449 - nodes in this community are weakly interconnected._