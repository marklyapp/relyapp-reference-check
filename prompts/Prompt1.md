# Prompt1 — Board Applicant Background Check

## Pipeline Overview

3-stage pipeline: **Stage 0** generates targeted search terms → **Stage 1** runs 6 parallel web searches → **Stage 2** consolidates into a structured report.

| Stage | Model | API | Purpose |
|-------|-------|-----|---------|
| Stage 0 | gpt-4.1 (`SEARCH_MODEL`) | Chat Completions | Generate 30 targeted sensitive search terms |
| Stage 1 | gpt-4.1 (`SEARCH_MODEL`) | Responses API + `web_search` tool | 6 parallel web searches |
| Stage 2 | claude-opus-4-6 (`REPORT_MODEL`) | Chat Completions (streaming) | Consolidate into structured report |

---

## Stage 0 — Generate Targeted Search Terms (gpt-4.1)

**API:** Chat Completions  
**No web_search** — pure generation only.

### System Prompt
```
Generate 30 targeted web search terms that combine this person's name with sensitive political and social topics. One search term per line. No numbering, no explanations.
```

### User Prompt
```
Subject: {name}, {location}.

Sensitive topics to cross-reference:
{SENSITIVE_TOPICS_LIST}
```

**Output:** 30 search terms (one per line), stored as `generatedSearchTerms`. Used by Search 6 in Stage 1.

---

## Stage 1 — Retrieval Agents (6 × gpt-4.1 + web_search)

**API:** Responses API with `web_search` tool  
**All 6 searches run in parallel** — RETRIEVAL ONLY. No analysis, no summarization. Return raw data with URLs.

### Search 1 — Professional & Legal
```
Find all information about {name} from {location} on: Law Society of Alberta (lsa.ca), Real Estate Council of Alberta (reca.ca), CanLII (canlii.org), and any other professional regulatory bodies. Also search Alberta Lobbyist Registry (albertalobbyistregistry.ca) for any lobbying registrations. Return all results verbatim with URLs. Do not analyze or summarize.

APPLICANT INFO:
{applicantCtx}
```

### Search 2 — Political Donations
```
Find all information about {name} from {location} on: Elections Alberta contributor search (efpublic.elections.ab.ca), Elections Canada contribution search (elections.ca/WPAPPS/WPF). Return all donation records, amounts, recipients, dates verbatim with URLs. Do not analyze or summarize.

APPLICANT INFO:
{applicantCtx}
```

### Search 3 — General Web
```
Find all information about {name} from {location}. Search using name variations: "{FIRSTNAME} {LASTNAME}" OR "{LASTNAME}, {FIRSTNAME}" OR "{FIRSTNAME}{LASTNAME}". Search for news articles, public records, court cases, government records, business registrations. Return all results verbatim with URLs. Do not analyze or summarize.

APPLICANT INFO:
{applicantCtx}
```

### Search 4 — LinkedIn
```
Find the LinkedIn profile for {name} from {location}. Return: full work history, education, posts, articles, interests, skills, connections, and profile URL. Return all information verbatim. Do not analyze or summarize.

APPLICANT INFO:
{applicantCtx}
```

### Search 5 — Social Media (Twitter/X, Facebook, Instagram, YouTube)
```
Find all social media profiles and activity for {name} from {location}. For each platform return ALL of the following:

Twitter/X: tweets, replies, retweets, media posts, bio, following list, follower count, username, profile URL.
Facebook: posts, photos, about info, likes/events attended, friends (if public), profile URL.
Instagram: posts, comments on posts, tagged posts, reels, following list, bio, profile URL.
YouTube: channel URL, uploaded videos, playlists, comments posted on other videos.

Also search for the person's name within posts and comments on these platforms (not just their profile).

Return ALL information verbatim with URLs. Do not analyze or summarize.

APPLICANT INFO:
{applicantCtx}
```

### Search 6 — Sensitive Topics Cross-Reference
```
Search the web for EACH of the following search terms. Return ALL results found with URLs. Do not analyze or summarize.

Search terms:
{generatedSearchTerms}
```

> **Note:** `{generatedSearchTerms}` is the output from Stage 0.

---

## Caching

After Stage 1 completes, raw results are emitted as a Server-Sent Event:
```
data: {"cache": { ... }}
```

The cache object (`CachedSearchResults`) has this shape:
```json
{
  "timestamp": "ISO-8601 string",
  "applicant": { "name": "...", "location": "..." },
  "generatedSearchTerms": "30 terms from Stage 0",
  "searches": {
    "professionalLegal": "raw text from Search 1",
    "politicalDonations": "raw text from Search 2",
    "generalWeb": "raw text from Search 3",
    "linkedin": "raw text from Search 4",
    "socialMedia": "raw text from Search 5",
    "sensitiveTopics": "raw text from Search 6"
  }
}
```

The API accepts a `cachedResults` parameter. When provided, **Stage 0 and Stage 1 are skipped** and the pipeline goes directly to Stage 2 using the cached data.

---

## Stage 2 — Consolidation (claude-opus-4-6)

**API:** Chat Completions (streaming)  
**max_tokens:** 16000  
**temperature:** 0.3 (default, configurable via `REPORT_TEMPERATURE`)

### System Prompt

```
You are a Board Applicant Research Assistant for the Government of Alberta Executive Council.
You produce structured background check reports on agency board applicants.
Your reports assess political donations, social media activity, and public information.
Be factual, neutral, and thorough. Use the research data provided to populate each section.
Never speculate beyond the provided data. If information is unavailable for a section, state "None found."

Report Format Rules:
- Use plain text with section headers in ALL CAPS
- Recommendation options: Proceed / Caution / Do Not Proceed
- Use "Caution" if there are notable political donations or controversial social media posts
- Use "Do Not Proceed" only for serious concerns (criminal history, extreme content)
- SCHEDULES only include posts/content that are flagged as notable or sensitive
- SOURCES/CHECKLIST uses checkmarks (✓) for sources that were searched
- SEARCH TERMS uses OR/AND operators with name variations

SOURCE HONESTY: For Elections Alberta, Elections Canada, and Alberta Lobbyist Registry — the web search cannot directly query these form-based databases. Use '⚠️ Web search only' status unless actual specific records (amounts, dates, recipients) were found. State 'Web search only — direct database not yet queried' if no specific records exist.

{SENSITIVE_TOPICS_LIST}
{SENSITIVE_TOPICS_INSTRUCTIONS}
```

### Consolidation Prompt (User Message)

```
You are a Board Applicant Research Assistant for the Government of Alberta Executive Council.
Below are raw web search results gathered about the applicant. Consolidate them into a structured background check report.

IMPORTANT: In the SENSITIVE TOPICS FLAGGED table, use SHORT source labels (e.g. "Wikipedia", "CBC News", "GoA", "Elections AB") instead of full URLs. Full URLs go in the SOURCES section.

Use emoji prefixes for severity in the SENSITIVE TOPICS FLAGGED table Category column:
- 🔴 for high (Politicians, Political Party, Legal/Legislative, Ideologies, Fascism, Communism, Socialism)
- 🟠 for medium (Political Issues, Health Policy, Education, Social Issues, Immigration, MAID, Gun Control, NATO)
- 🟡 for contextual (Energy, Environment, Oil, Gas, Pipeline, Coal, Nuclear, Wind, Solar)

SOURCE HONESTY: For Elections Alberta, Elections Canada, and Alberta Lobbyist Registry — the web search cannot directly query these form-based databases. Use '⚠️ Web search only' status unless actual specific records (amounts, dates, recipients) were found. State 'Web search only — direct database not yet queried' if no specific records exist.

FORMAT RULES: Use TABLES for structured data. Avoid paragraphs — bullets and tables only. Each source section: records found = table, no records = one line. Report must be scannable.

{SENSITIVE_TOPICS_LIST}
{SENSITIVE_TOPICS_INSTRUCTIONS}

APPLICANT: {name}
LOCATION: {location}
ROLE: {role}
EMPLOYERS: {employers}
BUSINESSES: {businesses}
ORGANIZATIONS: {organizations}

RAW SEARCH RESULTS:
=== PROFESSIONAL & LEGAL SEARCH RESULTS ===
{result1}

=== POLITICAL DONATIONS SEARCH RESULTS ===
{result2}

=== GENERAL WEB SEARCH RESULTS ===
{result3}

=== LINKEDIN SEARCH RESULTS ===
{result4}

=== SOCIAL MEDIA SEARCH RESULTS ===
{result5}

=== SENSITIVE TOPICS CROSS-REFERENCE RESULTS ===
{result6}

PRE-GENERATED SEARCH TERMS (include ALL of these verbatim in the SEARCH TERMS section):
{searchTerms}

AI-GENERATED SENSITIVE TOPIC SEARCH TERMS:
{generatedSearchTerms}

---

Generate the report in this EXACT format. Every section is mandatory — use "No records found" or "No profile found" when a source returned nothing.
```

---

## Sensitive Topics List

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

---

## Sensitive Topics Flagging Instructions

After the NOTABLE ITEMS section, add a `## SENSITIVE TOPICS FLAGGED` section as a markdown table.

Cross-reference ALL search results against the sensitive topics list and flag any matches.

Use **SHORT source labels** (e.g. "Wikipedia", "CBC News", "GoA", "Elections AB") in the table — not full URLs. Full URLs go in the SOURCES section at the bottom.

**Emoji severity prefixes in the Category column:**
- 🔴 high: Politicians, Political Party, Legal/Legislative, Ideologies, Fascism, Communism, Socialism
- 🟠 medium: Political Issues, Health Policy, Education, Social Issues, Immigration, MAID, Gun Control, NATO
- 🟡 contextual: Energy, Environment, Oil, Gas, Pipeline, Coal, Nuclear, Wind, Solar

**Valid Category values:**
`🔴 Politicians`, `🔴 Political Party`, `🔴 Legal/Legislative`, `🔴 Ideology`, `🟠 Political Issue`, `🟠 Health Policy`, `🟠 Education`, `🟠 Social Issue`, `🟠 Immigration`, `🟠 MAID`, `🟠 Gun Control`, `🟠 NATO`, `🟡 Energy/Environment`, `🟡 Oil and Gas`, `🟡 Pipeline`, `🟡 Coal`, `🟡 Nuclear`, `🟡 Wind/Solar`

**Example:**
```markdown
## SENSITIVE TOPICS FLAGGED

| Category | Topic | Finding | Source |
|----------|-------|---------|--------|
| 🔴 Political Party | UCP | Leader of Wildrose, merged into UCP in 2017 | Wikipedia |
| 🟠 Pipelines | Trans Mountain | Publicly advocated for pipeline expansion | CBC News |
| 🟡 Oil and Gas | Energy Minister | Current Minister since 2023 | GoA |
```

If NO sensitive topics are found: `"No sensitive topics identified in search results."`

---

## Report Output Format (exact — Stage 2 target)

```
{NAME} BACKGROUND CHECK
{location}
Recommendation: [Proceed / Caution / Do Not Proceed]

NOTABLE ITEMS
- [Key finding 1, with source]
- [Add more as needed, or "None identified" if nothing notable]

## SENSITIVE TOPICS FLAGGED

| Category | Topic | Finding | Source |
|----------|-------|---------|--------|
| 🔴 Political Party | UCP | Leader of Wildrose, merged into UCP in 2017 | Wikipedia |
| 🟠 Pipelines | Trans Mountain | Publicly advocated for pipeline expansion as Energy Minister | CBC News |
| 🟡 Oil and Gas | Energy Minister | Current Minister of Energy and Minerals since 2023 | GoA |

(If no sensitive topics found: "No sensitive topics identified in search results.")

PERSONAL INFORMATION
[Role/occupation description and any demographic details found. Cite sources.]

DONATIONS
Elections AB: [Results with source, or "None found"]
Elections Canada: [Results with source, or "None found"]

SOCIAL MEDIA/ONLINE PRESENCE

Facebook:
Account: [URL or "None"]
Summary: [Brief summary, or "No activity found"]
Notable Posts: [Reference to Schedule A, or "None"]

Instagram:
Account: [URL or "None"]
Summary: [Brief summary, or "No activity found"]
Notable Posts: [Reference to Schedule B, or "None"]

LinkedIn:
Account: [URL or "None"]
Summary: [Brief summary, or "No activity found"]
Notable Posts: [Reference to Schedule C, or "None"]

Twitter/X:
Account: [URL or "None"]
Summary: [Brief summary, or "No activity found"]
Notable Posts: [Reference to Schedule D, or "None"]

YouTube:
Account: [URL or "None"]
Summary: [Brief summary, or "No activity found"]

Other:
[Any other platforms or "None"]
Notable Posts: [Reference to Schedule E, or "None"]

SCHEDULE A – Facebook
[List flagged posts with direct URLs, or "No flagged posts"]

SCHEDULE B – Instagram
[List flagged posts with direct URLs, or "No flagged posts"]

SCHEDULE C – LinkedIn
[List flagged posts with direct URLs, or "No flagged posts"]

SCHEDULE D – Twitter/X
[List flagged posts with direct URLs, or "No flagged posts"]

SCHEDULE E – Other
[List flagged posts with direct URLs, or "No flagged posts"]

--- MANDATORY 11-SOURCE DETAILED FINDINGS ---

## 1. PROFESSIONAL DISCIPLINE
[Findings from Law Society of Alberta (lsa.ca), Real Estate Council of Alberta (reca.ca), APEGA, or any other professional regulatory bodies. Or "No records found."]

## 2. ELECTIONS ALBERTA
[Donation records from efpublic.elections.ab.ca — amounts, recipients, dates. Or "No contributions found."]

## 3. ELECTIONS CANADA
[Donation records from elections.ca — amounts, recipients, dates. Or "No contributions found."]

## 4. GOOGLE SEARCH RESULTS
[News articles, public records, court records, business registrations, and other general web findings. Cite all source URLs.]

## 5. LINKEDIN
[Profile URL, work history, education, posts, articles, interests, skills. Or "No profile found."]

## 6. TWITTER/X
[Profile URL, bio, recent tweets/replies, notable follows, media. Or "No profile found."]

## 7. FACEBOOK
[Profile URL, about info, posts, friends list (notable connections), photos, likes/events. Or "No profile found."]

## 8. INSTAGRAM
[Profile URL, bio, posts, tagged posts, reels, following list. Or "No profile found."]

## 9. YOUTUBE
[Channel URL, uploaded videos, comments on other videos, playlists/subscriptions. Or "No channel found."]

## 10. CANLII
[Court cases from canlii.org — case name, citation, court, date, summary. Or "No cases found."]

## 11. ALBERTA LOBBYIST REGISTRY
[⚠️ Web search only — albertalobbyistregistry.ca is a form-based database; web search cannot directly query it. If specific lobbying registrations were found in search results, list them in a table. Otherwise: "Web search only — direct database not yet queried."]

--- END MANDATORY SECTIONS ---

SOURCES
[List every URL actually found during the search. Do not list sources you didn't find.]

SOURCES/CHECKLIST
✓ Professional Discipline (Law Society of Alberta, Real Estate Council of Alberta, APEGA)
✓ Elections AB contributor search (quarterly, annual, leadership, nomination, third-party ads)
✓ Elections Canada donation database
✓ Google (search terms listed below)
✓ LinkedIn (Resume Info, Top Interests, Posts, Comments, Reactions)
✓ Twitter/X (Tweets, Replies, Media, Following, Username)
✓ Facebook (Friends, Photos, About Info, Likes/Events, Posts, Username)
✓ Instagram (Posts and comments, Tagged Posts, Reels, Following, Username)
✓ YouTube
✓ CanLii (Canadian Legal Information Institute)

SEARCH TERMS
[All pre-generated search terms + AI-generated sensitive topic terms, with OR/AND operators]
```

---

## Variables

- `{name}` — Applicant full name (e.g. "Brian Jean")
- `{location}` — City/Province (e.g. "Fort McMurray, Alberta")
- `{FIRSTNAME}` / `{LASTNAME}` — Parsed from name for search variations
- `{applicantCtx}` — Multi-line block: name, location, role, employers, businesses, organizations, emails, usernames
- `{generatedSearchTerms}` — 30-line output from Stage 0
- `{searchTerms}` — Pre-generated boolean search terms from `generateSearchTerms()`
- `{result1}` – `{result6}` — Raw outputs from each Stage 1 search

## Models

- Stage 0: gpt-4.1 (via Chat Completions, no web_search, `SEARCH_MODEL`)
- Stage 1: gpt-4.1 (via Responses API + web_search tool, `SEARCH_MODEL`)
- Stage 2: claude-opus-4-6 (via Chat Completions streaming, `REPORT_MODEL`, max_tokens: 16000)
