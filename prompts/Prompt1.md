# Prompt1 — Board Applicant Background Check Pipeline

## OVERVIEW
- 3-stage pipeline: Term Generation → Web Search → Report Consolidation
- Stage 0: gpt-4.1 generates targeted search terms (~5s)
- Stage 1: 6 parallel gpt-4.1 web searches (~18s)
- Stage 2: claude-opus-4-6 analyzes all raw data and writes report (~60s)
- Total: ~80s per report

## SECTION A: SEARCH STRATEGY

### Stage 0 — Search Term Generation
- Model: gpt-4.1 (Chat Completions, no web_search)
- Purpose: Generate 30 targeted search terms combining the subject's name with sensitive topics
- Input: Subject name, location, sensitive topics list
- Output: 30 search terms, one per line
- Example output for "Brian Jean, Fort McMurray":
  - Brian Jean carbon tax Alberta
  - Brian Jean pipeline Trans Mountain
  - Brian Jean UCP leadership controversy
  - ...

### Stage 1 — Web Search (6 parallel agents)
All use gpt-4.1 with web_search tool. RETRIEVAL ONLY — no analysis.

| Search | Target Sources | What to find |
|--------|---------------|-------------|
| 1. Professional/Legal | LSA, RECA, CanLII, Lobbyist Registry | Discipline records, court cases, lobbying |
| 2. Political Donations | Elections AB, Elections Canada | Contribution records, amounts, dates |
| 3. General Web | Google (name variations) | News, public records, government, business |
| 4. LinkedIn | linkedin.com | Work history, education, posts, articles |
| 5. Social Media | Twitter, Facebook, Instagram, YouTube, Reddit | Profiles, posts, comments, media (using site: operators) |
| 6. Sensitive Cross-Ref | Web (using Stage 0 terms) | Connections to sensitive political/social topics |

### Caching
After Stage 1, all raw results are saved as JSON. The API accepts `cachedResults` to skip Stages 0+1 and go straight to Stage 2.

## SECTION B: REPORT GENERATION

### Stage 2 — Analysis & Consolidation
- Model: claude-opus-4-6 (Chat Completions)
- Input: All raw results from Stage 1 (concatenated)
- max_tokens: 16000
- Role: Analyze ALL raw data, cross-reference against sensitive topics, write structured report

### Report Structure
The model produces a report with these sections in order:
1. **Header** — Name, location, date, recommendation (Proceed/Caution/Do Not Proceed)
2. **NOTABLE ITEMS** — Key findings for decision-makers (bullets only)
3. **SENSITIVE TOPICS FLAGGED** — Table with color-coded severity
4. **11 Source Sections** — One per mandatory source
5. **SOURCES** — All URLs referenced
6. **SEARCH TERMS** — All terms used (original + generated)

### Source Honesty Rules
- Elections Alberta, Elections Canada, Alberta Lobbyist Registry are form-based databases
- Web search CANNOT directly query these databases
- Use "⚠️ Web search only" unless actual specific records (amounts, dates) were found
- Never claim "Found" without real data

## SECTION C: SENSITIVE TOPICS

### Color-Coded Severity
| Emoji | Level | Categories |
|-------|-------|-----------|
| 🔴 | High | Politicians, Political Parties, Legal/Legislative, Ideologies |
| 🟠 | Medium | Political Issues, Health Policy, Education, Social Issues |
| 🟡 | Contextual | Energy, Environment, Resource Industry |

### Full Sensitive Topics List

```
SENSITIVE TOPICS TO FLAG — check ALL search results for any mention of or connection to:

POLITICIANS & POLITICAL FIGURES:
- Politicians and political parties from the last 100 years (all English-speaking countries, all levels of government)
- Current Calgary or Edmonton Councillors/mayors
- Notable non-English figures: Hitler, Stalin, Mao, Putin, Zelensky, Xi Jinping

LEGAL & LEGISLATIVE:
- Any judicial decision
- Any federal or provincial legislation/bills
- Any existing Alberta public agencies (public-agency-list.alberta.ca)

IDEOLOGIES:
- Fascism, Communism, Socialism, Nationalism, Conservatism, Liberalism, Feminism, Environmentalism

POLITICAL ISSUES:
- Israel/Palestine, Emissions Regulation, Carbon Tax, COP conferences
- United Nations, Davos, World Economic Forum
- Residential schools, 2SLGBTQI+, Diversity/Equity/Inclusion
- Pipelines, Equalization, Sovereignty, Tariffs
- NATO, CUSMA, Iran War, Guns/Gun control

HEALTH POLICY:
- Mental Health/addiction, Supervised Consumption, Recovery, Safe Supply, MAID
- Immigration, Housing Costs, Affordability, COVID-19
- AHS restructuring, Public vs private healthcare
- Ambulance response times, Alberta Medical Association
- Emergency room wait times, Family doctor availability, Hospital bed space

EDUCATION:
- Teachers strike, Classroom sizes/complexity, Teacher pay
- Alberta Teachers' Association, K-12 Curriculum
- University Tuition, International Students, Arts Funding

ENERGY & ENVIRONMENT:
- Electricity/Water rates, Cell phone rates
- Fertilizer Regulation/Nitrogen Oxide emissions, Methane Emissions
- Alberta Energy Regulator, Canadian Energy Regulator
- Coal mining, Oil, Gas, Wind, Solar, Nuclear (any resource industry)
- Forest fire management, Logging industry

SOCIAL ISSUES:
- Missing and murdered indigenous women
- Truth and reconciliation
- Temporary Foreign Worker Program
- Mandatory Minimum sentences
- Property Tax, Transit, Policing, Pension, AISH
```

### Table Format
| Category | Topic | Finding | Source |
|----------|-------|---------|--------|
Short source labels (Wikipedia, CBC, GoA). Full URLs in SOURCES section.

## SECTION D: REPORT FORMATTING

### General Rules
- TABLES for all structured data (donations, profiles, records, employment)
- BULLETS for narrative items — never paragraphs
- Each source section: data found = table, nothing found = one line
- Report must be scannable by a busy executive — no filler

### .docx Output
- No cover page — report starts with content
- Headers: "CONFIDENTIAL — Board Applicant Background Check"
- Footers: Page numbers, generation date
- Source summary table at top
- Sensitive topics table with color-coded row shading (red/amber/yellow)
- Hyperlinked sources
- Typography: Cambria 11pt body, Calibri Bold headings

### Social Media Section Format
| Platform | Profile URL | Status | Key Findings |
|----------|-------------|--------|-------------|

### Donation Section Format
| Date | Amount | Recipient | Type | Source |
|------|--------|-----------|------|--------|

## SECTION E: VARIABLES & MODELS

| Variable | Description | Example |
|----------|------------|---------|
| {name} | Full name | Brian Jean |
| {location} | City, Province | Fort McMurray, Alberta |
| {date} | Current date | 2026-04-09 |

| Stage | Model | Method | Purpose |
|-------|-------|--------|---------|
| 0 | gpt-4.1 | Chat Completions | Generate search terms |
| 1 | gpt-4.1 | Responses API + web_search | Retrieve raw data |
| 2 | claude-opus-4-6 | Chat Completions | Analyze and write report |

## BENCHMARK (Brian Jean)
- Stage 0: ~5s (31 terms generated)
- Stage 1: ~18s (6 parallel searches)
- Stage 2: ~54s (Opus consolidation)
- Total: ~77s
- Output: ~12K chars, 22 URLs
