import { Actor, log } from 'apify';
import { chromium, Browser, Page } from 'playwright';
import { Input, CrunchbaseCompany } from './types.js';
import { handleCompanyUrl, handleSearch } from './routes.js';
import { TIMING, MAX_RETRIES, DEFAULT_CONCURRENCY } from './constants.js';
import { randomDelay, getRandomUserAgent } from './utils.js';

interface RunStats {
  totalUrls: number;
  completed: number;
  failed: number;
  startTime: number;
  searchResultsCount: number;
  fundingRoundsCount: number;
  peopleCount: number;
}

const CHECKPOINT_KEY = 'CHECKPOINT';

Actor.main(async () => {
  const input = await Actor.getInput<Input>();
  if (!input) {
    log.error('No input provided');
    return;
  }

  log.info('Crunchbase Enterprise Scraper starting', {
    mode: input.mode,
    maxCompanies: input.maxCompanies || 'unlimited',
    concurrency: input.concurrency || DEFAULT_CONCURRENCY,
  });

  const stats: RunStats = {
    totalUrls: 0,
    completed: 0,
    failed: 0,
    startTime: Date.now(),
    searchResultsCount: 0,
    fundingRoundsCount: 0,
    peopleCount: 0,
  };

  const concurrency = Math.min(input.concurrency || DEFAULT_CONCURRENCY, 10);
  const maxRetries = input.maxRetries || MAX_RETRIES;
  const webhookUrl = input?.webhookUrl;
  const proxyConfig = input.proxyConfiguration || { useApifyProxy: true };

  const processedUrls = new Set<string>();
  const checkpoint = await Actor.getValue<{ processedUrls: string[] }>(CHECKPOINT_KEY).catch(() => null);
  if (checkpoint?.processedUrls) {
    checkpoint.processedUrls.forEach(u => processedUrls.add(u));
    log.info(`Resuming from checkpoint: ${processedUrls.size} already processed`);
  }

  let browser: Browser | null = null;

  try {
    const proxyOptions: Record<string, any> = {};
    if (proxyConfig.useApifyProxy) {
      proxyOptions.apifyProxyGroups = proxyConfig.apifyProxyGroups || ['RESIDENTIAL'];
    }

    browser = await chromium.launch({
      headless: true,
      args: [
        '--disable-blink-features=AutomationControlled',
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-web-security',
        '--disable-features=IsolateOrigins,site-per-process',
      ],
    });

    const context = await browser.newContext({
      userAgent: getRandomUserAgent(),
      viewport: { width: 1920, height: 1080 },
      locale: 'en-US',
      timezoneId: 'America/New_York',
      extraHTTPHeaders: { 'Accept-Language': 'en-US,en;q=0.9' },
    });

    await context.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => false });
      Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] as any });
      Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
      (window as Record<string, any>).chrome = { runtime: {} };
    });

    const page = await context.newPage();
    await page.setDefaultTimeout(TIMING.navigationTimeout);

    if (input.mode === 'search' || input.mode === 'hybrid') {
      log.info(`Search mode: ${input.searchQueries?.join(', ') || 'all'}`, {
        location: input.location,
        industry: input.industry,
        fundingStage: input.fundingStage,
      });
      const { companies, searchResults } = await handleSearch(page, input);
      stats.searchResultsCount = searchResults.length;

      for (const company of companies) {
        if (processedUrls.has(company.url)) continue;
        await Actor.pushData(company);
        processedUrls.add(company.url);
        updateStats(company, stats);
      }
      stats.completed = companies.filter(c => !c.error).length;
      stats.failed = companies.filter(c => c.error).length;
    }

    if (input.mode === 'urls' || input.mode === 'hybrid') {
      const rawUrls = (input.startUrls || []).map(u => u.url).filter(Boolean);
      stats.totalUrls = rawUrls.length;
      log.info(`URL mode: ${rawUrls.length} URLs (${processedUrls.size} already processed)`);

      for (let i = 0; i < rawUrls.length; i++) {
        const url = rawUrls[i];
        if (processedUrls.has(url)) continue;

        await processUrlWithRetry(page, url, input, stats, maxRetries);
        processedUrls.add(url);

        if (processedUrls.size % 10 === 0) {
          await saveCheckpoint([...processedUrls]);
          if (webhookUrl) await sendWebhook(webhookUrl, stats);
        }
      }
    }

    const duration = ((Date.now() - stats.startTime) / 1000).toFixed(1);
    log.info('Scraping completed', { ...stats, durationSeconds: duration });

    await Actor.setValue('STATS', {
      ...stats,
      durationSeconds: parseFloat(duration),
      completedAt: new Date().toISOString(),
      mode: input.mode,
    });

  } catch (error) {
    log.error('Fatal error', { error: String(error) });
    if (processedUrls.size > 0) await saveCheckpoint([...processedUrls]);
    throw error;
  } finally {
    if (browser) { await browser.close(); }
  }
});

async function processUrlWithRetry(
  page: Page, url: string, input: Input, stats: RunStats, maxRetries: number
): Promise<void> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const company = await handleCompanyUrl(page, url, input);
      await Actor.pushData(company);

      if (company.error) {
        stats.failed++;
      } else {
        stats.completed++;
        if (company.fundingRounds) stats.fundingRoundsCount += company.fundingRounds.length;
        if (company.people) stats.peopleCount += company.people.length;
      }
      await randomDelay();
      return;
    } catch (error) {
      log.warning(`Attempt ${attempt}/${maxRetries} failed for ${url}`, { error: String(error) });
      if (attempt === maxRetries) {
        const failed: CrunchbaseCompany = {
          url, name: url.split('/').pop() || 'Unknown',
          scrapedAt: new Date().toISOString(),
          error: `Failed after ${maxRetries} attempts`,
        };
        await Actor.pushData(failed);
        stats.failed++;
        return;
      }
      await randomDelay(TIMING.retryDelay, TIMING.retryDelay * 2);
    }
  }
}

function updateStats(company: CrunchbaseCompany, stats: RunStats): void {
  if (company.fundingRounds) stats.fundingRoundsCount += company.fundingRounds.length;
  if (company.people) stats.peopleCount += company.people.length;
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
