# Crunchbase Company Scraper — Enterprise Grade

[![Apify](https://img.shields.io/badge/Apify-Actor-blue)](https://apify.com/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.6-blue)](https://www.typescriptlang.org/)
[![Playwright](https://img.shields.io/badge/Playwright-latest-green)](https://playwright.dev/)

Extract comprehensive company intelligence from Crunchbase at scale. 50+ data fields per company including funding history, leadership team, investors, technology stack, and competitive landscape.

## Features

- **3 Modes** — URLs, Search, or Hybrid (search + auto-scrape results)
- **50+ Data Fields** — Full company profiles with financials, people, tech, and more
- **Funding History** — Every round with amounts, dates, investors, and valuations
- **Team Extraction** — Founders, executives, and employees with titles and LinkedIn
- **Tech Stack** — Technology categories used by the company
- **Competitor Intelligence** — Similar companies and direct competitors
- **Investor Network** — List of investors with types and lead status
- **Smart Retry** — Automatic retry with exponential backoff (configurable)
- **Proxy Rotation** — Built-in Apify proxy support with residential IPs
- **Progress Webhooks** — Real-time progress notifications via POST webhook
- **Detailed Statistics** — Run duration, success rate, data volume per run
- **Enterprise Logging** — Structured JSON logs with Apify log censoring
- **Batch Processing** — Hundreds of companies per run with streaming output

## Input Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `mode` | enum | `hybrid` | Scraping mode: `urls`, `search`, or `hybrid` |
| `startUrls` | array | — | List of Crunchbase company URLs |
| `searchQueries` | array | — | Keywords to search for companies |
| `maxCompanies` | int | `50` | Max companies to scrape (1-500) |
| `maxFundingRounds` | int | `10` | Max funding rounds per company (0-50) |
| `extractPeople` | bool | `true` | Extract team members |
| `extractFunding` | bool | `true` | Extract funding rounds |
| `extractTechStack` | bool | `true` | Extract technology stack |
| `extractSimilarCompanies` | bool | `true` | Extract similar companies |
| `extractInvestors` | bool | `true` | Extract investor information |
| `concurrency` | int | `3` | Browser concurrency (1-10) |
| `maxRetries` | int | `3` | Retry attempts per URL |
| `proxyConfiguration` | object | Apify proxy | Proxy settings |
| `screenshot` | bool | `false` | Capture page screenshots |
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
- full people array with names, titles, locations, LinkedIn URLs
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
# URL mode
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

## Performance

- ~30-60 seconds per company with full data extraction
- Batch processing: 50-100 companies per run
- Smart rate limiting prevents IP blocking
- Automatic retry with backoff for transient failures

## Technical Details

- Built with Crawlee + Playwright for reliable browser automation
- Anti-detection measures: custom user-agent, viewport, navigator overrides
- Runs on Apify infrastructure with global proxy support
- Dockerized with `apify/actor-node-playwright-chrome` base image
- TypeScript with full type definitions for all data structures
