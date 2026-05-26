import { Page } from 'playwright';
import { SearchResult, CompanySearchFilters } from '../types.js';
import { randomDelay, waitForStablePage } from '../utils.js';
import { CRUNCHBASE_URL } from '../constants.js';

export async function searchCompanies(
  page: Page,
  filters: CompanySearchFilters,
  maxResults: number = 50
): Promise<SearchResult[]> {
  const url = buildSearchUrl(filters);

  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await waitForPageReady(page);
  await randomDelay(3000, 5000);

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

    if (results.length >= maxResults) break;
    if (!await clickNextPage(page)) break;
  }

  return results;
}

function buildSearchUrl(filters: CompanySearchFilters): string {
  const base = `${CRUNCHBASE_URL}/discover/organization`;
  const params = new URLSearchParams();
  if (filters.query) params.set('q', filters.query);
  if (filters.location) params.set('location', filters.location);
  if (filters.industry) params.set('industry_group', filters.industry);
  if (filters.fundingStage) params.set('last_funding_type', filters.fundingStage);
  if (filters.employeeCount) params.set('employee_count', filters.employeeCount);
  if (filters.fundingTotalMin !== undefined) params.set('total_funding_usd_min', String(filters.fundingTotalMin));
  if (filters.fundingTotalMax !== undefined) params.set('total_funding_usd_max', String(filters.fundingTotalMax));
  params.set('layout', 'table');
  return `${base}?${params.toString()}`;
}

async function waitForPageReady(page: Page): Promise<void> {
  try {
    await page.waitForSelector('#__NEXT_DATA__', { timeout: 20000 });
  } catch {
    try {
      await page.waitForSelector('[class*="grid-row"], table, [class*="table"]', { timeout: 15000 });
    } catch {}
  }
  try {
    await page.waitForLoadState('networkidle', { timeout: 20000 });
  } catch {}
  await randomDelay(1000, 2000);
}

async function parseSearchPage(page: Page): Promise<SearchResult[]> {
  const fromNextData = await tryParseNextData(page);
  if (fromNextData.length > 0) return fromNextData;

  const fromDOM = await tryParseDOM(page);
  if (fromDOM.length > 0) return fromDOM;

  const fromAPI = await tryParseAPI(page);
  if (fromAPI.length > 0) return fromAPI;

  return [];
}

async function tryParseNextData(page: Page): Promise<SearchResult[]> {
  try {
    const data = await page.evaluate(() => {
      const el = document.getElementById('__NEXT_DATA__');
      return el?.textContent ? JSON.parse(el.textContent) : null;
    });
    if (!data) return [];

    const results: SearchResult[] = [];
    const p = data.props?.pageProps;

    if (p?.searchResults) {
      return mapSearchResults(p.searchResults);
    }

    if (p?.discoverResults?.data?.items) {
      return mapSearchResults(p.discoverResults.data.items);
    }

    if (p?.organizations) {
      return mapSearchResults(p.organizations);
    }

    if (data?.pageData?.organizations) {
      return mapSearchResults(data.pageData.organizations);
    }

    const searches = Object.keys(data?.props?.pageProps || {}).filter(k =>
      k.toLowerCase().includes('search') || k.toLowerCase().includes('result') || k.toLowerCase().includes('organization') || k.toLowerCase().includes('company')
    );
    for (const key of searches) {
      const val = p?.[key];
      if (Array.isArray(val) && val.length > 0) {
        const mapped = mapSearchResults(val);
        if (mapped.length > 0) return mapped;
      }
    }

    return [];
  } catch {
    return [];
  }
}

function mapSearchResults(items: any[]): SearchResult[] {
  return items.map((r: any) => {
    const permalink = r.permalink || r.identifier?.value || r.identifier?.permalink || r.url?.split('/').pop();
    const url = permalink ? `https://www.crunchbase.com/organization/${permalink.replace(/^\/organization\//, '')}` : '';
    if (!url) return null;

    return {
      name: r.name || r.identifier?.value || '',
      url,
      shortDescription: r.short_description || r.description || undefined,
      location: r.city || r.region || r.country
        ? `${r.city || ''} ${r.region || ''} ${r.country || ''}`.trim() || undefined
        : undefined,
      employeeRange: r.employee_count_range || r.employee_range || undefined,
      industry: r.industry_groups?.[0] || r.categories?.[0] || r.industry_group?.[0] || undefined,
    };
  }).filter(Boolean) as SearchResult[];
}

async function tryParseDOM(page: Page): Promise<SearchResult[]> {
  try {
    return await page.evaluate(() => {
      const results: SearchResult[] = [];
      const rows = document.querySelectorAll(
        'a[href*="/organization/"], [class*="grid-row"], [class*="table-row"], tr[class]'
      );

      const seen = new Set<string>();
      rows.forEach(row => {
        const link = row.tagName === 'A'
          ? row as HTMLAnchorElement
          : row.querySelector('a[href*="/organization/"]') as HTMLAnchorElement;
        if (!link?.href) return;
        const url = link.href;
        if (seen.has(url)) return;
        seen.add(url);

        const nameEl = link.querySelector('[class*="name"], [class*="title"]') || link;
        const name = nameEl?.textContent?.trim() || link.textContent?.trim() || '';

        if (url.includes('/organization/')) {
          results.push({
            name,
            url,
            shortDescription: row.querySelector('[class*="desc"]')?.textContent?.trim() || undefined,
            location: row.querySelector('[class*="loc"]')?.textContent?.trim() || undefined,
            employeeRange: row.querySelector('[class*="emp"]')?.textContent?.trim() || undefined,
            industry: row.querySelector('[class*="industry"]')?.textContent?.trim() || undefined,
          });
        }
      });

      return results;
    });
  } catch {
    return [];
  }
}

async function tryParseAPI(page: Page): Promise<SearchResult[]> {
  try {
    const html = await page.content();
    const match = html.match(
      /"https:\\\/\\\/[^"]+?\.crunchbase\.com\\\/v\\\/4\\\/[^"]*?search[^"]*?"/
    );
    if (!match) return [];

    const url = JSON.parse(`"${match[0]}"`);
    const results = await page.evaluate(async (apiUrl) => {
      try {
        const resp = await fetch(apiUrl, {
          headers: { 'Accept': 'application/json' },
        });
        const data = await resp.json();
        return data?.entities?.map((e: any) => ({
          name: e.properties?.name || '',
          url: `https://www.crunchbase.com/organization/${e.properties?.permalink || e.identifier?.permalink}`,
          shortDescription: e.properties?.short_description || undefined,
        })).filter((r: any) => r.name && r.url.includes('/organization/')) || [];
      } catch {
        return [];
      }
    }, url);

    return results;
  } catch {
    return [];
  }
}

async function clickNextPage(page: Page): Promise<boolean> {
  try {
    const clicked = await page.evaluate(() => {
      const selectors = [
        '[aria-label="Next page"]:not([disabled])',
        '[aria-label="Next"]:not([disabled])',
        'button:has-text("Next"):not([disabled])',
        'a[rel="next"]:not([disabled])',
        '[class*="pagination"] button:last-child:not([disabled])',
        'button:has(svg[class*="chevron-right"]):not([disabled])',
      ];
      for (const sel of selectors) {
        const btn = document.querySelector(sel) as HTMLElement;
        if (btn) { btn.click(); return true; }
      }
      return false;
    });
    if (!clicked) return false;
    await waitForPageReady(page);
    return true;
  } catch {
    return false;
  }
}
