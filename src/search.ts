import { log } from 'apify';
import { extractNextDataFromHtml } from './nextdata.js';
import { SearchResult, CompanySearchFilters } from './types.js';
import { CRUNCHBASE_URL, CRUNCHBASE_API_URL, API_FIELD_IDS } from './constants.js';
import { getSlugFromUrl, getRandomUserAgent, buildCookieHeader, extractCookiesFromResponse, parseApiEntityProperties } from './utils.js';

interface SearchOpts {
  apiKey?: string;
  proxyUrl?: string;
  userAgent?: string;
}

export async function searchCrunchbase(
  filters: CompanySearchFilters,
  maxResults: number,
  opts: SearchOpts = {},
): Promise<SearchResult[]> {
  let results: SearchResult[] = [];

  if (opts.apiKey) {
    results = await searchViaOfficialApi(filters, maxResults, opts.apiKey);
    if (results.length > 0) return results;
  }

  results = await searchDiscoverHttp(filters);
  if (results.length > 0) return results.slice(0, maxResults);

  results = await searchViaGoogleHttp(filters.query || '');
  if (results.length > 0) return results.slice(0, maxResults);

  return [];
}

async function searchDiscoverHttp(filters: CompanySearchFilters): Promise<SearchResult[]> {
  try {
    const params = new URLSearchParams();
    if (filters.query) params.set('q', filters.query);
    if (filters.industry) params.set('industry_group', filters.industry);
    if (filters.fundingStage) params.set('last_funding_type', filters.fundingStage);
    if (filters.employeeCount) params.set('employee_count', filters.employeeCount);
    params.set('layout', 'table');

    const url = `${CRUNCHBASE_URL}/discover/organization?${params.toString()}`;

    const resp = await fetch(url, {
      headers: {
        'User-Agent': getRandomUserAgent(),
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      signal: AbortSignal.timeout(30000),
    });

    if (!resp.ok) {
      log.warning(`Discover search returned ${resp.status}`);
      return [];
    }

    const html = await resp.text();
    if (html.includes('Just a moment') || html.includes('Checking your browser')) {
      log.warning('Discover search hit Cloudflare challenge');
      return [];
    }

    const nextData = extractNextDataFromHtml(html);
    if (!nextData) return [];

    return extractSearchResultsFromNextData(nextData);
  } catch (err) {
    log.warning(`Discover search failed: ${err instanceof Error ? err.message : String(err)}`);
    return [];
  }
}

async function searchViaGoogleHttp(query: string): Promise<SearchResult[]> {
  if (!query) return [];
  try {
    const searchUrl = `https://www.google.com/search?q=site:crunchbase.com/organization+${encodeURIComponent(query)}`;
    const resp = await fetch(searchUrl, {
      headers: {
        'User-Agent': getRandomUserAgent(),
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      signal: AbortSignal.timeout(15000),
    });

    if (!resp.ok) return [];
    const html = await resp.text();

    const results: SearchResult[] = [];
    const seen = new Set<string>();
    const urlRegex = /https:\/\/www\.crunchbase\.com\/organization\/[a-zA-Z0-9_-]+/g;
    let match: RegExpExecArray | null;

    while ((match = urlRegex.exec(html)) !== null) {
      const url = match[0];
      if (seen.has(url)) continue;
      seen.add(url);
      const ctx = html.substring(Math.max(0, match.index - 150), match.index + 250);
      const nameMatch = ctx.match(/<h3[^>]*>(.*?)<\/h3>/);
      const name = nameMatch
        ? nameMatch[1].replace(/<[^>]+>/g, '').trim()
        : getSlugFromUrl(url);
      results.push({ name, url, shortDescription: undefined });
    }
    return results;
  } catch (err) {
    log.warning(`Google search HTTP failed: ${err instanceof Error ? err.message : String(err)}`);
    return [];
  }
}

async function searchViaOfficialApi(filters: CompanySearchFilters, maxResults: number, apiKey: string): Promise<SearchResult[]> {
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

    const resp = await fetch(`${CRUNCHBASE_API_URL}/searches/organizations`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'X-cb-user-key': apiKey,
        'User-Agent': getRandomUserAgent(),
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30000),
    });

    if (!resp.ok) return [];

    const json = await resp.json();
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
  } catch {
    return [];
  }
}

function extractSearchResultsFromNextData(nextData: any): SearchResult[] {
  try {
    const results: SearchResult[] = [];
    const p = nextData?.props?.pageProps;
    const sources = [
      p?.searchResults,
      p?.discoverResults?.data?.items,
      p?.organizations,
      nextData?.pageData?.organizations,
    ];

    for (const source of sources) {
      if (Array.isArray(source) && source.length > 0) {
        const mapped = source.map((r: any) => {
          const permalink = r.permalink || r.identifier?.value || r.identifier?.permalink;
          if (!permalink) return null;
          return {
            name: r.name || r.identifier?.value || '',
            url: `${CRUNCHBASE_URL}/organization/${permalink.replace(/^\/organization\//, '')}`,
            shortDescription: r.short_description || r.description || undefined,
            location: [r.city, r.region, r.country].filter(Boolean).join(', ') || undefined,
            employeeRange: r.employee_count_range || undefined,
            industry: r.industry_groups?.[0] || r.categories?.[0] || undefined,
          } as SearchResult;
        }).filter((r): r is SearchResult => r !== null);
        if (mapped.length > 0) return mapped;
      }
    }
    return results;
  } catch {
    return [];
  }
}
