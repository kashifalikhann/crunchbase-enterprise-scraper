import { Page } from 'playwright';
import { SearchResult, CompanySearchFilters } from '../types.js';
import { randomDelay, waitForStablePage } from '../utils.js';
import { CRUNCHBASE_URL, GOOGLE_SEARCH_URL } from '../constants.js';

export async function searchCompanies(
  page: Page,
  filters: CompanySearchFilters,
  maxResults: number = 50,
  apiKey?: string,
): Promise<SearchResult[]> {
  if (apiKey) {
    console.log('Using Crunchbase API v4 for search');
    const results = await searchViaAPI(filters, maxResults, apiKey);
    if (results.length > 0) return results;
    console.warn('API search returned 0 results, falling back to Google');
  }

  const results = await searchViaGoogle(page, filters, maxResults);
  if (results.length > 0) {
    console.log(`Google search returned ${results.length} results`);
    return results;
  }
  console.warn('Google search returned 0 results');

  const discoverResults = await searchViaDiscover(page, filters, maxResults);
  if (discoverResults.length > 0) {
    console.log(`Discover page returned ${discoverResults.length} results`);
    return discoverResults;
  }
  console.warn('Discover page returned 0 results');

  return [];
}

async function searchViaGoogle(
  page: Page,
  filters: CompanySearchFilters,
  maxResults: number,
): Promise<SearchResult[]> {
  try {
    const query = buildGoogleQuery(filters);
    const url = `${GOOGLE_SEARCH_URL}?q=${encodeURIComponent(query)}&num=${Math.min(maxResults, 100)}`;
    console.log(`Google search URL: ${url}`);

    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
    await randomDelay(2000, 4000);

    const results = await page.evaluate((baseUrl) => {
      const items: SearchResult[] = [];
      const seen = new Set<string>();

      const links = document.querySelectorAll('a[href*="crunchbase.com/organization/"]');
      links.forEach(a => {
        const href = (a as HTMLAnchorElement).href;
        if (!href || seen.has(href)) return;
        seen.add(href);

        const container = a.closest('div') || a.parentElement;
        const snippet = container?.querySelector('[class*="VwiCb"], span.aCOpRe, [data-sncf]');
        const titleEl = a.querySelector('h3, span');

        items.push({
          name: titleEl?.textContent?.trim() || a.textContent?.trim() || '',
          url: href.split('?')[0],
          shortDescription: snippet?.textContent?.trim()?.substring(0, 300) || undefined,
        });
      });

      return items;
    }, url);

    if (results.length === 0) {
      return resultsViaGoogleSearchUrl(page, filters, maxResults);
    }

    return results.slice(0, maxResults);
  } catch (err) {
    console.warn(`Google search failed: ${err}`);
    return [];
  }
}

async function resultsViaGoogleSearchUrl(
  page: Page,
  filters: CompanySearchFilters,
  maxResults: number,
): Promise<SearchResult[]> {
  try {
    const query = buildGoogleQuery(filters);
    const url = `https://www.google.com/search?q=${encodeURIComponent(query)}&num=${Math.min(maxResults, 100)}`;

    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
    await randomDelay(1000, 2000);

    return await page.evaluate(() => {
      const items: SearchResult[] = [];
      const seen = new Set<string>();
      const resultDivs = document.querySelectorAll('#search a[href*="crunchbase.com/organization/"]');

      resultDivs.forEach(a => {
        const href = (a as HTMLAnchorElement).href;
        if (!href || seen.has(href)) return;
        seen.add(href);

        const parent = a.closest('div[jscontroller]') || a.parentElement;
        const snippet = parent?.querySelector('[data-sncf], .VwiCb, span.aCOpRe')?.textContent?.trim()?.substring(0, 300);

        items.push({
          name: (a.querySelector('h3')?.textContent || a.textContent || '').trim(),
          url: href.split('?')[0],
          shortDescription: snippet || undefined,
        });
      });

      return items;
    });
  } catch (err) {
    console.warn(`Google search URL fallback failed: ${err}`);
    return [];
  }
}

function buildGoogleQuery(filters: CompanySearchFilters): string {
  let q = `site:crunchbase.com/organization ${filters.query || ''}`;
  if (filters.location) q += ` ${filters.location}`;
  if (filters.industry) q += ` ${filters.industry.replace(/-/g, ' ')}`;
  if (filters.fundingStage) q += ` ${filters.fundingStage.replace(/_/g, ' ')}`;
  return q;
}

async function searchViaDiscover(
  page: Page,
  filters: CompanySearchFilters,
  maxResults: number,
): Promise<SearchResult[]> {
  const url = buildSearchUrl(filters);
  console.log(`Discover page URL: ${url}`);

  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  } catch (err) {
    console.warn(`Discover page navigation failed: ${err}`);
    return [];
  }

  const cloudflare = await isCloudflare(page);
  if (cloudflare) {
    console.warn('Cloudflare challenge detected on discover page');
    return [];
  }

  await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
  await randomDelay(2000, 4000);

  const viaResponse = await interceptSearchApi(page, maxResults);
  if (viaResponse.length > 0) {
    console.log(`Intercepted API response: ${viaResponse.length} results`);
    return viaResponse;
  }

  const viaNextData = await tryParseNextData(page);
  if (viaNextData.length > 0) {
    console.log(`NextData parsing: ${viaNextData.length} results`);
    return viaNextData;
  }

  const viaDOM = await tryParseDOM(page);
  if (viaDOM.length > 0) {
    console.log(`DOM parsing: ${viaDOM.length} results`);
    return viaDOM;
  }

  const results: SearchResult[] = [];
  let pageNum = 0;
  const maxPages = Math.ceil(maxResults / 20) + 1;

  while (results.length < maxResults && pageNum < maxPages) {
    pageNum++;
    const viaNext = await tryParseDOM(page);
    for (const r of viaNext) {
      if (results.length >= maxResults) break;
      if (!results.some(ex => ex.url === r.url)) results.push(r);
    }
    if (results.length >= maxResults) break;
    if (!await clickNextPage(page)) break;
  }

  if (results.length > 0) console.log(`Discover pagination: ${results.length} results`);
  return results;
}

async function isCloudflare(page: Page): Promise<boolean> {
  try {
    return await page.evaluate(() => {
      const title = document.title.toLowerCase();
      const body = document.body?.innerText?.toLowerCase() || '';
      return title.includes('just a moment') || title.includes('challenge') ||
             body.includes('checking your browser') || body.includes('cloudflare');
    });
  } catch {
    return true;
  }
}

async function interceptSearchApi(page: Page, maxResults: number): Promise<SearchResult[]> {
  try {
    const responsePromise = page.waitForResponse(
      resp => resp.url().includes('crunchbase.com/api') && resp.status() === 200,
      { timeout: 15000 }
    );
    const resp = await responsePromise;
    const json = await resp.json();

    const entities = json?.entities || json?.data?.entities || [];
    if (!Array.isArray(entities) || entities.length === 0) return [];

    return entities.map((e: any) => {
      const p = e.properties || e;
      const permalink = p.permalink || p.identifier?.permalink || p.identifier?.value;
      return {
        name: p.name || p.identifier?.value || '',
        url: permalink ? `https://www.crunchbase.com/organization/${permalink}` : '',
        shortDescription: p.short_description || undefined,
        location: [p.city, p.region, p.country].filter(Boolean).join(', ') || undefined,
        employeeRange: p.employee_count_range || undefined,
        industry: p.industry_groups?.[0] || p.categories?.[0] || undefined,
      } as SearchResult;
    }).filter((r: SearchResult) => r.name && r.url).slice(0, maxResults);
  } catch {
    return [];
  }
}

async function searchViaAPI(
  filters: CompanySearchFilters,
  maxResults: number,
  apiKey: string,
): Promise<SearchResult[]> {
  try {
    const body: Record<string, any> = {
      field_ids: ['identifier', 'short_description', 'location_identifiers', 'employee_count', 'categories'],
      limit: Math.min(maxResults, 200),
    };

    const query: any[] = [];
    if (filters.query) {
      query.push({ type: 'predicate', field_id: 'identifier', operator_id: 'contains', values: [filters.query] });
    }
    if (filters.industry) {
      query.push({ type: 'predicate', field_id: 'industry_groups', operator_id: 'includes', values: [filters.industry] });
    }
    if (filters.location) {
      query.push({ type: 'predicate', field_id: 'location_identifiers', operator_id: 'includes', values: [filters.location] });
    }
    if (filters.fundingStage) {
      query.push({ type: 'predicate', field_id: 'last_funding_type', operator_id: 'eq', values: [filters.fundingStage] });
    }

    if (query.length > 0) body.query = query;

    const resp = await fetch('https://api.crunchbase.com/api/v4/searches/organizations', {
      method: 'POST',
      headers: {
        'X-cb-user-key': apiKey,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!resp.ok) {
      console.warn(`API search failed: ${resp.status} ${resp.statusText}`);
      return [];
    }

    const json = await resp.json();
    console.log(`API search response: ${JSON.stringify({ status: resp.status, count: json?.entities?.length || 0 })}`);

    return (json?.entities || []).map((e: any) => {
      const p = e.properties || e;
      return {
        name: p.name || p.identifier?.value || '',
        url: `https://www.crunchbase.com/organization/${p.permalink || p.identifier?.permalink || p.identifier?.value}`,
        shortDescription: p.short_description || undefined,
        location: p.location_identifiers?.[0]?.value || undefined,
        employeeRange: p.employee_count_range || undefined,
        industry: p.categories?.[0]?.value || undefined,
      } as SearchResult;
    }).filter((r: SearchResult) => r.name && r.url);
  } catch (err) {
    console.warn(`API search error: ${err}`);
    return [];
  }
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

    const searches = Object.keys(p || {}).filter(k =>
      k.toLowerCase().includes('search') || k.toLowerCase().includes('result') ||
      k.toLowerCase().includes('organization') || k.toLowerCase().includes('company')
    );
    for (const key of searches) {
      const val = p?.[key];
      if (Array.isArray(val) && val.length > 0) {
        const mapped = mapSearchResults(val);
        if (mapped.length > 0) return mapped;
      }
    }

    return results;
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
      const rows = document.querySelectorAll('a[href*="/organization/"], [class*="grid-row"], [class*="table-row"], tr[class]');
      const seen = new Set<string>();

      rows.forEach(row => {
        const link = row.tagName === 'A'
          ? row as HTMLAnchorElement
          : row.querySelector('a[href*="/organization/"]') as HTMLAnchorElement;
        if (!link?.href) return;
        const url = link.href;
        if (seen.has(url)) return;
        seen.add(url);

        results.push({
          name: link.textContent?.trim() || '',
          url,
          shortDescription: row.querySelector('[class*="desc"]')?.textContent?.trim() || undefined,
          location: row.querySelector('[class*="loc"]')?.textContent?.trim() || undefined,
          employeeRange: row.querySelector('[class*="emp"]')?.textContent?.trim() || undefined,
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
    await waitForStablePage(page);
    return true;
  } catch {
    return false;
  }
}
