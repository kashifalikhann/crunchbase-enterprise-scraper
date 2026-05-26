# Crunchbase Company Scraper — Enterprise Grade

[![Apify](https://img.shields.io/badge/Apify-Actor-blue)](https://apify.com/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.6-blue)](https://www.typescriptlang.org/)
[![Playwright](https://img.shields.io/badge/Playwright-latest-green)](https://playwright.dev/)

Extract comprehensive company intelligence from Crunchbase at scale. 65+ data fields per company including funding history, leadership team, investors, technology stack, and competitive landscape.

**No paid API keys required** — uses Playwright stealth browser to bypass Cloudflare. Optionally supports Crunchbase's official API v4 if available.

## Features

- **3 Modes** — URLs, Search, or Hybrid (search + auto-scrape results)
- **65+ Data Fields** — Full company profiles with financials, people, tech, and more
- **Funding History** — Every round with amounts, dates, investors, and valuations
- **Team Extraction** — Founders, executives, and employees with titles
- **Tech Stack** — Technology categories used by the company
- **Competitor Intelligence** — Similar companies and direct competitors
- **Investor Network** — List of investors with types and lead status
- **Smart Retry** — Automatic retry with exponential backoff (configurable)
- **Stealth Browser** — Playwright with anti-detection, Cloudflare Turnstile blocking
- **Checkpoint Resume** — Survives restarts without re-scraping completed URLs
- **Progress Webhooks** — Real-time progress notifications via POST webhook
- **Detailed Statistics** — Run duration, success rate, data volume per run
- **CSV Output** — Optional CSV export alongside default JSON
- **Batch Processing** — Hundreds of companies per run with streaming output

## Input Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `mode` | enum | `urls` | Scraping mode: `urls`, `search`, or `hybrid` |
| `startUrls` | array | — | List of Crunchbase company URLs |
| `searchQueries` | array | — | Keywords to search for companies |
| `maxCompanies` | int | `50` | Max companies to scrape (1-500) |
| `maxFundingRounds` | int | `10` | Max funding rounds per company (0-50) |
| `extractPeople` | bool | `true` | Extract team members |
| `extractFunding` | bool | `true` | Extract funding rounds |
| `extractTechStack` | bool | `true` | Extract technology stack |
| `extractSimilarCompanies` | bool | `true` | Extract similar companies |
| `extractInvestors` | bool | `true` | Extract investor information |
| `crunchbaseApiKey` | string | — | Optional Crunchbase API v4 key (paid) |
| `maxRetries` | int | `3` | Retry attempts per URL |
| `webhookUrl` | string | — | Progress notification webhook |
| `outputFormat` | enum | `json` | Output format: `json` or `csv` |

## Output Data (per company)

### Company Info
- name, legalName, website, logo, description
- foundedDate, employeeCount, headquarters
- categories, industries, operatingStatus
- crunchbaseRank, ipoStatus, stockSymbol

### Financial Data
- totalFundingAmount, totalFundingAmountCurrency
- lastFundingType, lastFundingDate, lastFundingAmount
- fundingRounds (all rounds with amounts, dates, investors)
- acquisitions made by the company

### People
- founders list
- full people array with names, titles, locations
- Person type classification (founder/executive/employee/board)

### Network
- investors with names, URLs, types, lead status
- similar/competitor companies
- technology stack categories

### Social & Web
- socialLinks (LinkedIn, Twitter/X, Facebook, YouTube, Instagram, GitHub, TikTok)
- trafficRank, monthlyVisits

## Quick Start

```bash
# URL mode (default, no API key needed)
apify call <actor-id> -i '{
  "mode": "urls",
  "startUrls": [{ "url": "https://www.crunchbase.com/organization/openai" }]
}'

# Search mode
apify call <actor-id> -i '{
  "mode": "search",
  "searchQueries": ["AI startup Series B 2024"],
  "maxCompanies": 20
}'

# Hybrid mode (search + scrape each result)
apify call <actor-id> -i '{
  "mode": "hybrid",
  "searchQueries": ["fintech SaaS"],
  "maxCompanies": 10,
  "extractPeople": true,
  "extractFunding": true
}'
```

## Use Cases

- **Lead Generation** — Build targeted company lists with funding and contact data
- **Market Research** — Analyze competitors, funding trends, and market segments
- **Investment Analysis** — Track funding rounds, valuations, and investor syndicates
- **Sales Intelligence** — Enrich CRM with company profiles, tech stack, and team data
- **M&A Advisory** — Identify acquisition targets and track deal activity

## How It Works

1. If you provide a Crunchbase API key — uses the official API v4 (fastest, most reliable)
2. No API key — launches a headless Playwright Chromium browser with stealth anti-detection:
   - Blocks Cloudflare Turnstile and challenge scripts at the network level
   - Overrides `navigator.webdriver`, sets realistic viewport/locale/timezone
   - Waits for `__NEXT_DATA__` to appear before extracting
   - Reuses browser session across requests for efficiency
3. Extracts structured data from `__NEXT_DATA__` JSON embedded in the page
4. Falls back to official API if browser fails (when API key is configured)

## Performance

- ~10-20 seconds per company with Playwright browser
- Batch processing: 50-100 companies per run
- Browser is auto-launched at start and reused across all requests
- Automatic retry with backoff for transient failures

## Technical Details

- Built with Crawlee + Playwright for reliable browser automation
- Anti-detection: custom user-agent, viewport, navigator overrides, script blocking
- Runs on Apify infrastructure with global proxy support
- Dockerized with `apify/actor-node-playwright-chrome` base image
- TypeScript with full type definitions for all data structures
