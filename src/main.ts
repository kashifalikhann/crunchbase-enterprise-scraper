import { Actor, log } from 'apify';
import { Input, CrunchbaseCompany } from './types.js';
import { handleCompanyUrl, handleSearch, handleHybrid } from './routes.js';
import { CrunchbaseClient, ClientAuth } from './crunchbase-client.js';
import { launchBrowser, closeBrowser } from './browser-launcher.js';
import { MAX_RETRIES, CRUNCHBASE_URL } from './constants.js';
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

  const maxRetries = input.maxRetries || MAX_RETRIES;
  const webhookUrl = input?.webhookUrl;
  const allCompanies: CrunchbaseCompany[] = [];

  const processedUrls = new Set<string>();
  const checkpoint = await Actor.getValue<{ processedUrls: string[] }>(CHECKPOINT_KEY).catch(() => null);
  if (checkpoint?.processedUrls) {
    checkpoint.processedUrls.forEach(u => processedUrls.add(u));
    log.info(`Resuming from checkpoint: ${processedUrls.size} already processed`);
  }

  try {
    const auth: ClientAuth = input.crunchbaseApiKey
      ? { type: 'api_key', key: input.crunchbaseApiKey }
      : { type: 'none' };

    if (auth.type === 'none') {
      await launchBrowser();
    }

    const client = new CrunchbaseClient(auth, getRandomUserAgent());

    if (input.mode === 'search' || input.mode === 'hybrid') {
      log.info(`${input.mode} mode: ${input.searchQueries?.join(', ') || 'all'}`, {
        location: input.location,
        industry: input.industry,
        fundingStage: input.fundingStage,
      });

      const { companies, searchResults } = await handleSearch(client, input);
      stats.searchResultsCount = searchResults.length;

      for (const company of companies) {
        if (processedUrls.has(company.url)) continue;
        await Actor.pushData(company);
        allCompanies.push(company);
        processedUrls.add(company.url);
        updateStats(company, stats);
      }
      stats.completed = companies.filter(c => !c.error).length;
      stats.failed = companies.filter(c => c.error).length;

      if (input.mode === 'hybrid') {
        const maxCompanies = input.maxCompanies || 50;
        const extraNeeded = maxCompanies - companies.length;
        if (extraNeeded > 0 && searchResults.length > companies.length) {
          log.info(`Hybrid: scraping ${Math.min(extraNeeded, searchResults.length - companies.length)} additional companies from search results`);
          const extraCompanies = await handleHybrid(
            client, searchResults.slice(companies.length),
            input, extraNeeded,
          );
          for (const company of extraCompanies) {
            await Actor.pushData(company);
            allCompanies.push(company);
            updateStats(company, stats);
          }
          stats.completed = allCompanies.filter(c => !c.error).length;
          stats.failed = allCompanies.filter(c => c.error).length;
        }
      }
    }

    if (input.mode === 'urls') {
      const rawUrls = (input.startUrls || []).map(u => typeof u === 'string' ? u : u.url).filter(Boolean);
      stats.totalUrls = rawUrls.length;
      log.info(`URL mode: ${rawUrls.length} URLs (${processedUrls.size} already processed)`);

      for (let i = 0; i < rawUrls.length; i++) {
        const url = rawUrls[i];
        if (processedUrls.has(url)) continue;

        const company = await processUrlWithRetry(client, url, input, maxRetries);
        await Actor.pushData(company);
        allCompanies.push(company);
        processedUrls.add(url);
        if (company.error) stats.failed++;
        else {
          stats.completed++;
          if (company.fundingRounds) stats.fundingRoundsCount += company.fundingRounds.length;
          if (company.people) stats.peopleCount += company.people.length;
        }

        if (processedUrls.size % 10 === 0) {
          await saveCheckpoint([...processedUrls]);
          if (webhookUrl) await sendWebhook(webhookUrl, stats);
        }
      }
    }

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

  } catch (error) {
    log.error('Fatal error', { error: String(error) });
    throw error;
  } finally {
    await closeBrowser();
  }
});

async function processUrlWithRetry(
  client: CrunchbaseClient,
  url: string,
  input: Input,
  maxRetries: number,
): Promise<CrunchbaseCompany> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const company = await handleCompanyUrl(client, url, input);
      if (company.error) {
        log.warning(`Attempt ${attempt}/${maxRetries} failed for ${url}: ${company.error}`);
        if (attempt === maxRetries) return company;
        await randomDelay(3000, 6000);
        continue;
      }
      await randomDelay();
      return company;
    } catch (error) {
      log.warning(`Attempt ${attempt}/${maxRetries} errored for ${url}`, { error: String(error) });
      if (attempt === maxRetries) {
        const failed: CrunchbaseCompany = {
          url, name: url.split('/').pop() || 'Unknown',
          scrapedAt: new Date().toISOString(),
          error: `Failed after ${maxRetries} attempts: ${error instanceof Error ? error.message : String(error)}`,
        };
        return failed;
      }
      await randomDelay(3000, 6000);
    }
  }
  throw new Error('Unreachable');
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
