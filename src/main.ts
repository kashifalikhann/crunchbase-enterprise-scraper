import { Actor, log } from 'apify';
import { Input, CrunchbaseCompany } from './types.js';
import { handleCompanyUrl, handleSearch } from './routes.js';
import { CrunchbaseClient, ClientAuth } from './crunchbase-client.js';
import { solveCloudflare } from './capsolver.js';
import { TIMING, MAX_RETRIES, DEFAULT_CONCURRENCY, CRUNCHBASE_URL } from './constants.js';
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
    hasApiKey: !!input.crunchbaseApiKey,
    hasCapsolverKey: !!input.capsolverApiKey,
  });

  if (!input.crunchbaseApiKey && !input.capsolverApiKey) {
    log.warning('No authentication provided. Provide crunchbaseApiKey or capsolverApiKey for data access.');
  }

  const stats: RunStats = {
    totalUrls: 0,
    completed: 0,
    failed: 0,
    startTime: Date.now(),
    searchResultsCount: 0,
    fundingRoundsCount: 0,
    peopleCount: 0,
  };

  const maxRetries = input.maxRetries || MAX_RETRIES;
  const webhookUrl = input?.webhookUrl;

  const processedUrls = new Set<string>();
  const checkpoint = await Actor.getValue<{ processedUrls: string[] }>(CHECKPOINT_KEY).catch(() => null);
  if (checkpoint?.processedUrls) {
    checkpoint.processedUrls.forEach(u => processedUrls.add(u));
    log.info(`Resuming from checkpoint: ${processedUrls.size} already processed`);
  }

  try {
    let auth: ClientAuth;
    let userAgent = getRandomUserAgent();

    if (input.capsolverApiKey) {
      log.info('Solving Cloudflare challenge via CapSolver...');
      try {
        const solution = await solveCloudflare(
          input.capsolverApiKey,
          CRUNCHBASE_URL,
          input.capsolverProxy,
          userAgent,
        );
        userAgent = solution.userAgent || userAgent;
        log.info(`CapSolver solved Cloudflare. Cookies: ${Object.keys(solution.cookies).join(', ') || 'none'}`);
        auth = { type: 'session', cookies: solution.cookies };
      } catch (capsolverError) {
        log.error('CapSolver failed', { error: String(capsolverError) });
        if (input.crunchbaseApiKey) {
          log.info('Falling back to official API key');
          auth = { type: 'api_key', key: input.crunchbaseApiKey };
        } else {
          throw new Error(`CapSolver failed and no API key fallback: ${capsolverError}`);
        }
      }
    } else if (input.crunchbaseApiKey) {
      auth = { type: 'api_key', key: input.crunchbaseApiKey };
    } else {
      log.warning('No auth configured — attempting direct fetch (likely blocked by Cloudflare)');
      auth = { type: 'none' };
    }

    const client = new CrunchbaseClient(auth, userAgent);

    if (input.mode === 'search') {
      log.info(`Search mode: ${input.searchQueries?.join(', ') || 'all'}`, {
        location: input.location,
        industry: input.industry,
        fundingStage: input.fundingStage,
      });

      const { companies, searchResults } = await handleSearch(client, input);
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

    if (input.mode === 'urls') {
      const rawUrls = (input.startUrls || []).map(u => u.url).filter(Boolean);
      stats.totalUrls = rawUrls.length;
      log.info(`URL mode: ${rawUrls.length} URLs (${processedUrls.size} already processed)`);

      for (let i = 0; i < rawUrls.length; i++) {
        const url = rawUrls[i];
        if (processedUrls.has(url)) continue;

        await processUrlWithRetry(client, url, input, stats, maxRetries);
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
    throw error;
  }
});

async function processUrlWithRetry(
  client: CrunchbaseClient,
  url: string,
  input: Input,
  stats: RunStats,
  maxRetries: number,
): Promise<void> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const company = await handleCompanyUrl(client, url, input);
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
