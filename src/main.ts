import { Actor, log } from 'apify';
import { PlaywrightCrawler, Dataset } from 'crawlee';
import { Input, CrunchbaseCompany } from './types.js';
import { parseCompanyFromHtml, buildCompanyFromProps } from './parse-company.js';
import { searchCrunchbase } from './search.js';
import { loadCrunchbaseCookies, getCrunchbaseCookies, normalizeCookie } from './browser-launcher.js';
import { solveTurnstileChallenge } from './capsolver.js';
import { CRUNCHBASE_URL, CRUNCHBASE_API_URL, API_FIELD_IDS } from './constants.js';
import { getRandomUserAgent, parseApiEntityProperties, getSlugFromUrl } from './utils.js';

const CHECKPOINT_KEY = 'CHECKPOINT';

interface RunStats {
  totalUrls: number;
  completed: number;
  failed: number;
  startTime: number;
  searchResultsCount: number;
  fundingRoundsCount: number;
  peopleCount: number;
}

Actor.main(async () => {
  const input = await Actor.getInput<Input>();
  if (!input) { log.error('No input provided'); return; }

  const envApiKey = process.env['CRUNCHBASE_API_KEY'] || '';
  const envCapsolverKey = process.env['CAPSOLVER_API_KEY'] || '';

  log.info('Crunchbase Enterprise Scraper starting', {
    mode: input.mode,
    maxCompanies: input.maxCompanies || 'unlimited',
    hasApiKey: !!envApiKey,
    hasCapsolver: !!envCapsolverKey,
  });

  const webhookUrl = input?.webhookUrl;

  const stats: RunStats = {
    totalUrls: 0, completed: 0, failed: 0, startTime: Date.now(),
    searchResultsCount: 0, fundingRoundsCount: 0, peopleCount: 0,
  };

  const allCompanies: CrunchbaseCompany[] = [];
  const processedUrls = new Set<string>();

  const checkpoint = await Actor.getValue<{ processedUrls: string[] }>(CHECKPOINT_KEY).catch(() => null);
  if (checkpoint?.processedUrls) {
    checkpoint.processedUrls.forEach(u => processedUrls.add(u));
    log.info(`Resuming from checkpoint: ${processedUrls.size} already processed`);
  }

  if (!envApiKey) {
    await loadCrunchbaseCookies();
  }

  // ---- Phase 1: Search (for search/hybrid mode) ----
  let urlsToScrape: string[] = [];

  if (input.mode === 'search' || input.mode === 'hybrid') {
    const maxResults = Math.min(input.maxCompanies || 50, 500);
    log.info(`${input.mode} mode: searching Crunchbase`);
    const results = await searchCrunchbase(
      {
        query: input.searchQueries?.[0] || '',
        location: input.location,
        industry: input.industry,
        fundingStage: input.fundingStage,
        employeeCount: input.employeeCount,
      },
      maxResults,
      { apiKey: envApiKey, userAgent: getRandomUserAgent() },
    );

    stats.searchResultsCount = results.length;
    log.info(`Search found ${results.length} companies`);
    urlsToScrape = results.map(r => r.url);
  }

  if (input.mode === 'urls' || input.mode === 'hybrid') {
    const manualUrls = (input.startUrls || []).map(u => typeof u === 'string' ? u : u.url).filter(Boolean);
    if (input.mode === 'hybrid') {
      urlsToScrape = [...new Set([...urlsToScrape, ...manualUrls])];
    } else {
      urlsToScrape = manualUrls;
    }
  }

  // Filter out already-processed URLs and cap to maxCompanies
  const maxCompanies = input.maxCompanies || 500;
  const pendingUrls = urlsToScrape.filter(u => !processedUrls.has(u)).slice(0, maxCompanies);
  stats.totalUrls = pendingUrls.length;

  if (pendingUrls.length === 0) {
    log.info('No URLs to scrape');
    return;
  }

  // ---- Phase 2: Crawlee PlaywrightCrawler ----
  const proxyConfiguration = await Actor.createProxyConfiguration({
    groups: ['RESIDENTIAL'],
  });

  const crawler = new PlaywrightCrawler({
    proxyConfiguration,
    useSessionPool: true,
    sessionPoolOptions: {
      maxPoolSize: 10,
      sessionOptions: {
        maxUsageCount: 15,
      },
    },
    maxConcurrency: input.concurrency || 5,
    maxRequestsPerCrawl: maxCompanies,

    launchContext: {
      launchOptions: {
        headless: true,
        args: [
          '--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage',
          '--disable-blink-features=AutomationControlled',
          '--disable-web-security',
          '--disable-features=IsolateOrigins,site-per-process',
          '--no-first-run',
          '--no-default-browser-check',
          '--disable-component-update',
        ],
      },
    },

    preNavigationHooks: [
      async ({ page }) => {
        const cookies = getCrunchbaseCookies();
        if (cookies?.length) {
          await page.context().addCookies(cookies.filter(c => c.name && c.value).map(normalizeCookie));
        }
        await page.addInitScript(() => {
          Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
          Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
          Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
        });
      },
    ],

    requestHandler: async ({ page, request }) => {
      if (processedUrls.has(request.url)) return;

      // Try official API first if key available
      if (envApiKey) {
        const slug = getSlugFromUrl(request.url);
        const apiCompany = await getCompanyViaApi(slug, envApiKey, request.url);
        if (apiCompany) {
          await Dataset.pushData(apiCompany);
          allCompanies.push(apiCompany);
          processedUrls.add(request.url);
          stats.completed++;
          if (apiCompany.fundingRounds) stats.fundingRoundsCount += apiCompany.fundingRounds.length;
          if (apiCompany.people) stats.peopleCount += apiCompany.people.length;
          return;
        }
      }

      let html: string | null = null;
      const maxAttempts = (input.maxRetries || 3) + 1;

      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
          const response = await page.goto(request.url, {
            waitUntil: 'domcontentloaded',
            timeout: 45000,
          });

          if (response && (response.status() === 403 || response.status() === 429)) {
            if (response.status() === 403 && envCapsolverKey) {
              log.info(`Attempt ${attempt}: HTTP 403 — solving via Capsolver`);
              const solved = await solveTurnstileChallenge(envCapsolverKey, request.url, page);
              if (solved) {
                log.info(`Capsolver bypass succeeded on attempt ${attempt}`);
              } else {
                log.warning('Capsolver bypass failed');
              }
            }
            if (attempt < maxAttempts) {
              await new Promise(r => setTimeout(r, attempt * 5000));
              continue;
            }
          }

          const resolvedUrl = page.url();
          const onCrunchbase = resolvedUrl.includes('crunchbase.com/organization/');

          if (!onCrunchbase && !resolvedUrl.includes('web.archive.org')) {
            log.warning(`Attempt ${attempt}: unexpected redirect to ${resolvedUrl.substring(0, 80)}`);
            if (attempt < maxAttempts) {
              await new Promise(r => setTimeout(r, 3000));
              continue;
            }
          }

          try {
            await page.waitForSelector('script#__NEXT_DATA__', { timeout: 15000 });
          } catch {
            log.warning(`Attempt ${attempt}: __NEXT_DATA__ not found within timeout`);
          }

          html = await page.content();

          if (!html.includes('__NEXT_DATA__')) {
            log.warning(`Attempt ${attempt}: no __NEXT_DATA__ in HTML (length ${html.length})`);
            if (attempt < maxAttempts) {
              html = null;
              await new Promise(r => setTimeout(r, 3000));
              continue;
            }
          }
        } catch (err) {
          log.warning(`Attempt ${attempt} error: ${err instanceof Error ? err.message : String(err)}`);
          if (attempt < maxAttempts) {
            await new Promise(r => setTimeout(r, 3000));
          }
        }
      }

      if (!html) {
        log.warning(`Failed to scrape ${request.url}`);
        stats.failed++;
        processedUrls.add(request.url);
        return;
      }

      const result = parseCompanyFromHtml(html, request.url);
      if (!result) {
        log.warning(`Failed to parse company from ${request.url}`);
        stats.failed++;
        processedUrls.add(request.url);
        return;
      }

      const company = result.company;

      if (input.extractFunding === false) delete company.fundingRounds;
      if (input.extractPeople === false) { delete company.people; delete company.founders; }
      if (input.maxFundingRounds && company.fundingRounds && company.fundingRounds.length > input.maxFundingRounds) {
        company.fundingRounds = company.fundingRounds.slice(0, input.maxFundingRounds);
      }

      await Dataset.pushData(company);
      allCompanies.push(company);
      processedUrls.add(request.url);
      stats.completed++;
      if (company.fundingRounds) stats.fundingRoundsCount += company.fundingRounds.length;
      if (company.people) stats.peopleCount += company.people.length;

      if (stats.completed % 10 === 0) {
        await saveCheckpoint([...processedUrls]);
        if (webhookUrl) await sendWebhook(webhookUrl, stats);
      }
    },

    failedRequestHandler: async ({ request }) => {
      log.warning(`Scraping failed for ${request.url}`);
      processedUrls.add(request.url);
      stats.failed++;
    },
  });

  await crawler.run(pendingUrls.map(url => ({ url })));

  // ---- Phase 3: Output ----
  if (input.outputFormat === 'csv') {
    await writeCsvOutput(allCompanies);
  }

  const duration = ((Date.now() - stats.startTime) / 1000).toFixed(1);
  log.info('Scraping completed', { ...stats, durationSeconds: duration });

  await Actor.setValue('STATS', {
    ...stats,
    durationSeconds: parseFloat(duration),
    completedAt: new Date().toISOString(),
    mode: input.mode,
  });
});

async function getCompanyViaApi(slug: string, apiKey: string, url: string): Promise<CrunchbaseCompany | null> {
  try {
    const uuid = await resolveSlugToUuid(slug, apiKey);
    if (!uuid) return null;

    const fieldIds = API_FIELD_IDS.join(',');
    const resp = await fetch(`${CRUNCHBASE_API_URL}/entities/organizations/${uuid}?field_ids=${fieldIds}`, {
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'X-cb-user-key': apiKey,
        'User-Agent': getRandomUserAgent(),
      },
      signal: AbortSignal.timeout(15000),
    });
    if (!resp.ok) return null;

    const json = await resp.json();
    const props = parseApiEntityProperties(json);
    if (!props || !props.name) return null;

    return buildCompanyFromProps(props, url, 'api');
  } catch {
    return null;
  }
}

async function resolveSlugToUuid(slug: string, apiKey: string): Promise<string | null> {
  try {
    const resp = await fetch(`${CRUNCHBASE_API_URL}/entities/organizations/${slug}?field_ids=name`, {
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'X-cb-user-key': apiKey,
        'User-Agent': getRandomUserAgent(),
      },
      signal: AbortSignal.timeout(15000),
    });
    if (!resp.ok) return null;
    const json = await resp.json();
    return json?.uuid || null;
  } catch {
    return null;
  }
}

async function saveCheckpoint(processedUrls: string[]): Promise<void> {
  await Actor.setValue(CHECKPOINT_KEY, { processedUrls }).catch(() => {});
}

async function sendWebhook(webhookUrl: string, stats: RunStats): Promise<void> {
  try {
    const resp = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event: 'progress', stats, timestamp: new Date().toISOString() }),
    });
    if (!resp.ok) log.warning('Webhook failed', { status: resp.status });
  } catch (e) {
    log.warning('Webhook error', { error: String(e) });
  }
}

async function writeCsvOutput(companies: CrunchbaseCompany[]): Promise<void> {
  try {
    const headers = [
      'url', 'name', 'description', 'website', 'crunchbaseRank', 'foundedDate',
      'employeeCount', 'city', 'region', 'country', 'operatingStatus',
      'lastFundingType', 'lastFundingDate', 'lastFundingAmount', 'totalFundingAmount',
      'numFundingRounds', 'numInvestors', 'revenueRange', 'contactEmail',
      'growthScore', 'monthlyVisits', 'trafficRank',
    ];

    const headerRow = headers.join(',');
    const csvRows = [headerRow];

    for (const c of companies) {
      const row = headers.map(h => {
        let val: any;
        if (h === 'city') val = c.headquarters?.city;
        else if (h === 'region') val = c.headquarters?.region;
        else if (h === 'country') val = c.headquarters?.country;
        else val = (c as any)[h];
        const str = val === undefined || val === null ? '' : String(val);
        if (str.includes(',') || str.includes('"') || str.includes('\n')) {
          return `"${str.replace(/"/g, '""')}"`;
        }
        return str;
      }).join(',');
      csvRows.push(row);
    }

    const csv = csvRows.join('\n');
    await Actor.setValue('OUTPUT.csv', csv, { contentType: 'text/csv' });
    log.info(`CSV output written: ${companies.length} companies`);
  } catch (err) {
    log.warning('Failed to write CSV', { error: String(err) });
  }
}
