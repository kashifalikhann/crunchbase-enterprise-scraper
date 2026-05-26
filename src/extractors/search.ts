import { Page } from 'playwright';
import { SearchResult, CompanySearchFilters } from '../types.js';
import { randomDelay, waitForStablePage } from '../utils.js';
import { SEARCH_URL } from '../constants.js';

export async function searchCompanies(
  page: Page,
  filters: CompanySearchFilters,
  maxResults: number = 50
): Promise<SearchResult[]> {
  const url = buildSearchUrl(filters);
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await waitForStablePage(page);
  await randomDelay(2000, 4000);

  try {
    await page.waitForSelector('#__NEXT_DATA__', { timeout: 15000 }).catch(() => {});
  } catch {}

  const results: SearchResult[] = [];
  let pageNum = 0;
  const maxPages = Math.ceil(maxResults / 20) + 1;

  while (results.length < maxResults && pageNum < maxPages) {
    pageNum++;
    const parsed = await parseSearchPage(page);
    for (const r of parsed) {
      if (results.length >= maxResults) break;
      if (!results.some(ex => ex.url === r.url)) results.push(r);
    }

    if (!await clickNextPage(page) || results.length >= maxResults) break;
  }

  return results;
}

function buildSearchUrl(filters: CompanySearchFilters): string {
  const params = new URLSearchParams();
  if (filters.query) params.set('q', filters.query);
  if (filters.location) params.set('location', filters.location);
  if (filters.industry) params.set('industry_group', filters.industry);
  if (filters.fundingStage) params.set('last_funding_type', filters.fundingStage);
  if (filters.employeeCount) params.set('employee_count', filters.employeeCount);
  if (filters.fundingTotalMin !== undefined) params.set('total_funding_usd_min', String(filters.fundingTotalMin));
  if (filters.fundingTotalMax !== undefined) params.set('total_funding_usd_max', String(filters.fundingTotalMax));
  params.set('layout', 'table');
  return `${SEARCH_URL}?${params.toString()}`;
}

async function parseSearchPage(page: Page): Promise<SearchResult[]> {
  try {
    const nextData = await page.evaluate(() => {
      const el = document.getElementById('__NEXT_DATA__');
      return el?.textContent ? JSON.parse(el.textContent) : null;
    });

    if (nextData?.props?.pageProps?.searchResults) {
      return nextData.props.pageProps.searchResults.map((r: any) => ({
        name: r.name || r.identifier?.value || '',
        url: r.permalink
          ? `https://www.crunchbase.com/organization/${r.permalink}`
          : r.url || r.identifier?.permalink || '',
        shortDescription: r.short_description || r.description,
        location: `${r.city || ''} ${r.region || ''} ${r.country || ''}`.trim() || undefined,
        employeeRange: r.employee_count_range || undefined,
        industry: r.industry_groups?.[0] || r.categories?.[0] || undefined,
      }));
    }
  } catch {}

  try {
    return await page.evaluate(() => {
      const results: SearchResult[] = [];
      const rows = document.querySelectorAll('[class*="grid-row"], [class*="table-row"], tr[class]');
      rows.forEach(row => {
        const link = row.querySelector('a[href*="/organization/"]') as HTMLAnchorElement;
        const name = link?.textContent?.trim();
        const url = link?.href;
        if (!name || !url) return;
        results.push({
          name,
          url,
          shortDescription: row.querySelector('[class*="description"]')?.textContent?.trim() || undefined,
          location: row.querySelector('[class*="location"]')?.textContent?.trim() || undefined,
          employeeRange: row.querySelector('[class*="employee"]')?.textContent?.trim() || undefined,
          industry: row.querySelector('[class*="industry"]')?.textContent?.trim() || undefined,
        });
      });
      return results;
    });
  } catch {
    return [];
  }
}

async function clickNextPage(page: Page): Promise<boolean> {
  try {
    const hasNext = await page.evaluate(() => {
      const btn = document.querySelector('[aria-label="Next"]:not([disabled]), button:has-text("Next"):not([disabled])');
      return btn !== null;
    });
    if (!hasNext) return false;

    await page.evaluate(() => {
      const btn = document.querySelector('[aria-label="Next"]:not([disabled]), button:has-text("Next"):not([disabled])') as HTMLElement;
      btn?.click();
    });
    await waitForStablePage(page);
    await randomDelay(1500, 3000);
    return true;
  } catch {
    return false;
  }
}
