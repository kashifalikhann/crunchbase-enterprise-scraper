import { log } from 'apify';
import { CRUNCHBASE_URL, CRUNCHBASE_API_URL, API_FIELD_IDS, TIMING } from './constants.js';
import { SearchResult, CompanySearchFilters, CrunchbaseCompany, Person } from './types.js';
import { getRandomUserAgent, httpFetch, getSlugFromUrl, buildCookieHeader, extractCookiesFromResponse, parseApiEntityProperties, buildSocialLinks } from './utils.js';
import { extractNextDataFromHtml, parseNextDataCompanyProps, parseNextDataFundingRounds, parseNextDataPeople, parseNextDataInvestors, parseNextDataSimilarCompanies, parseNextDataTechStack, RawCompanyProperties } from './nextdata.js';
import { tryBrowserRetrieve, fetchCrunchbaseViaProxy } from './browser-launcher.js';

export type ClientAuth =
  | { type: 'api_key'; key: string }
  | { type: 'none' };

export class CrunchbaseClient {
  private auth: ClientAuth;
  private userAgent: string;
  private baseCookies: Record<string, string> = {};

  constructor(auth: ClientAuth, userAgent?: string) {
    this.auth = auth;
    this.userAgent = userAgent || getRandomUserAgent();
  }

  private async fetch(url: string, opts: RequestInit = {}): Promise<Response> {
    const headers: Record<string, string> = {
      'User-Agent': this.userAgent,
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
      'Accept-Encoding': 'gzip, deflate, br',
      'Cache-Control': 'no-cache',
      'Pragma': 'no-cache',
      ...(opts.headers as Record<string, string> || {}),
    };

    if (Object.keys(this.baseCookies).length > 0) {
      headers['Cookie'] = buildCookieHeader(this.baseCookies);
    }
    if (this.auth.type === 'api_key') {
      headers['X-cb-user-key'] = this.auth.key;
    }

    const resp = await httpFetch(url, { ...opts, headers });

    const newCookies = extractCookiesFromResponse(resp);
    Object.assign(this.baseCookies, newCookies);

    return resp;
  }

  async getCompany(slugOrUrl: string): Promise<{
    company: CrunchbaseCompany;
    nextData?: any;
  }> {
    const slug = getSlugFromUrl(slugOrUrl);

    if (this.auth.type === 'api_key') {
      const apiResult = await this.getCompanyViaApi(slug);
      if (apiResult) return { company: apiResult };
    }

    const browserResult = await this.getCompanyViaBrowser(slug);
    if (browserResult) return browserResult;

    return {
      company: {
        url: `https://www.crunchbase.com/organization/${slug}`,
        name: slug,
        scrapedAt: new Date().toISOString(),
        error: 'Failed to fetch company data — all methods exhausted',
      },
    };
  }

  private async getCompanyViaBrowser(slug: string): Promise<{ company: CrunchbaseCompany; nextData?: any } | null> {
    try {
      const url = `${CRUNCHBASE_URL}/organization/${slug}`;
      const html = await fetchCrunchbaseViaProxy(url);
      if (!html) return null;

      const parsed = this.parseCompanyFromHtml(html, url, 'browser');
      if (!parsed) {
        log.warning(`Proxy fetch got page but no __NEXT_DATA__ for ${slug}`);
        return null;
      }
      return parsed;
    } catch (err) {
      log.warning(`Proxy fetch failed for ${slug}: ${err instanceof Error ? err.message : String(err)}`);
      return null;
    }
  }

  parseCompanyFromHtml(
    html: string,
    url: string,
    source: 'browser' = 'browser',
  ): { company: CrunchbaseCompany; nextData?: any } | null {
    if (html.includes('Just a moment') || html.includes('Checking your browser')) {
      return null;
    }

    const nextData = extractNextDataFromHtml(html);
    if (!nextData) return null;

    const props = parseNextDataCompanyProps(nextData);
    if (!props) return null;

    const company = this.buildCompanyFromProps(props, url, source);

    const fundingData = parseNextDataFundingRounds(nextData);
    if (fundingData.length > 0) {
      company.fundingRounds = fundingData.map(r => ({
        name: r.type || r.name,
        date: r.announced_on,
        type: r.type,
        amount: r.money_raised_usd,
        valuation: r.pre_money_valuation_usd || r.post_money_valuation_usd,
        leadInvestors: r.lead_investors?.map(i => i?.identifier?.value).filter(Boolean) as string[],
        investors: r.investors?.map(i => i?.identifier?.value).filter(Boolean) as string[],
      }));
    }

    const investors = parseNextDataInvestors(nextData);
    if (investors.length > 0) {
      company.investors = investors.map(i => ({
        name: i.name,
        type: i.type,
      }));
    }

    const founders = parseNextDataPeople(nextData, 'founders');
    const executives = parseNextDataPeople(nextData, 'executives');
    const board = parseNextDataPeople(nextData, 'board_members_and_advisors');
    const allPeople: Person[] = [];
    founders.forEach(f => allPeople.push({ name: f.name || '', title: f.title, type: 'founder' }));
    executives.forEach(f => allPeople.push({ name: f.name || '', title: f.title, type: 'executive' }));
    board.forEach(f => allPeople.push({ name: f.name || '', title: f.title, type: 'board' }));
    if (allPeople.length > 0) company.people = allPeople;
    if (founders.length > 0) company.founders = founders.map(f => f.name).filter(Boolean) as string[];

    const similar = parseNextDataSimilarCompanies(nextData);
    if (similar.length > 0) {
      company.similarCompanies = similar.map(s => ({
        name: s.name,
        url: s.permalink ? `${CRUNCHBASE_URL}/organization/${s.permalink}` : '',
      }));
    }

    const techStack = parseNextDataTechStack(nextData);
    if (techStack.length > 0) {
      company.technologies = techStack;
    }

    return { company, nextData };
  }

  async searchCompanies(filters: CompanySearchFilters, maxResults: number = 50): Promise<SearchResult[]> {
    if (this.auth.type === 'api_key') {
      const results = await this.searchViaOfficialApi(filters, maxResults);
      if (results.length > 0) return results;
    }

    const browserResults = await this.searchViaBrowser(filters, maxResults);
    if (browserResults.length > 0) return browserResults;

    return [];
  }

  private async searchViaBrowser(filters: CompanySearchFilters, maxResults: number): Promise<SearchResult[]> {
    let results: SearchResult[] = [];

    results = await this.searchCrunchbaseDiscover(filters);
    if (results.length > 0) return results.slice(0, maxResults);

    log.info('Crunchbase discover blocked, falling back to Google search');
    results = await this.searchViaGoogle(filters.query || '');
    if (results.length > 0) return results.slice(0, maxResults);

    return [];
  }

  private async searchCrunchbaseDiscover(filters: CompanySearchFilters): Promise<SearchResult[]> {
    try {
      const params = new URLSearchParams();
      if (filters.query) params.set('q', filters.query);
      if (filters.industry) params.set('industry_group', filters.industry);
      if (filters.fundingStage) params.set('last_funding_type', filters.fundingStage);
      if (filters.employeeCount) params.set('employee_count', filters.employeeCount);
      params.set('layout', 'table');

      const url = `${CRUNCHBASE_URL}/discover/organization?${params.toString()}`;
      const html = await fetchCrunchbaseViaProxy(url);
      if (!html) return [];

      if (html.includes('Just a moment') || html.includes('Checking your browser')) return [];

      const nextData = extractNextDataFromHtml(html);
      if (!nextData) return [];

      return this.extractSearchResultsFromNextData(nextData);
    } catch {
      return [];
    }
  }

  private async searchViaGoogle(query: string): Promise<SearchResult[]> {
    if (!query) return [];
    try {
      const searchUrl = `https://www.google.com/search?q=site:crunchbase.com/organization+${encodeURIComponent(query)}`;
      const result = await tryBrowserRetrieve(searchUrl, 2, undefined, 30000, false);
      if (!result) {
        log.warning('Google search via browser returned no result');
        return [];
      }

      const { html } = result;
      log.info(`Google search returned ${html.length} bytes`);

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

      log.info(`Google search found ${results.length} Crunchbase URLs`);
      return results;
    } catch (err) {
      log.warning(`Google search failed: ${err instanceof Error ? err.message : String(err)}`);
      return [];
    }
  }

  private async getCompanyViaApi(slug: string): Promise<CrunchbaseCompany | null> {
    try {
      const uuid = await this.resolveSlugToUuid(slug);
      if (!uuid) return null;

      const fieldIds = API_FIELD_IDS.join(',');
      const url = `/entities/organizations/${uuid}?field_ids=${fieldIds}`;
      const resp = await this.apiFetch(url);

      if (!resp.ok) return null;

      const json = await resp.json();
      const props = parseApiEntityProperties(json);
      if (!props || !props.name) return null;

      return this.buildCompanyFromProps(props, `${CRUNCHBASE_URL}/organization/${slug}`, 'api');
    } catch {
      return null;
    }
  }

  private async resolveSlugToUuid(slug: string): Promise<string | null> {
    try {
      const resp = await this.apiFetch(`/entities/organizations/${slug}?field_ids=name`);
      if (!resp.ok) return null;
      const json = await resp.json();
      return json?.uuid || null;
    } catch {
      return null;
    }
  }

  private async apiFetch(path: string, opts: RequestInit = {}): Promise<Response> {
    const url = `${CRUNCHBASE_API_URL}${path}`;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'User-Agent': this.userAgent,
      ...(opts.headers as Record<string, string> || {}),
    };
    return this.fetch(url, { ...opts, headers });
  }

  private async searchViaOfficialApi(filters: CompanySearchFilters, maxResults: number): Promise<SearchResult[]> {
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

      const resp = await this.apiFetch('/searches/organizations', {
        method: 'POST',
        body: JSON.stringify(body),
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

  private extractSearchResultsFromNextData(nextData: any): SearchResult[] {
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

  private buildCompanyFromProps(props: RawCompanyProperties | Record<string, any>, url: string, source: 'api' | 'browser'): CrunchbaseCompany {
    const company: CrunchbaseCompany = {
      url,
      name: props.name || url.split('/').pop() || 'Unknown',
      scrapedAt: new Date().toISOString(),
      source: source === 'api' ? 'official_api' : 'browser',
    };

    company.legalName = props.legal_name;
    company.description = props.description;
    company.shortDescription = props.short_description;
    company.website = props.website;
    company.logo = props.logo_url;
    company.crunchbaseRank = props.rank_org;
    company.foundedDate = props.founded_on;

    if (props.num_employees_min !== undefined || props.num_employees_max !== undefined) {
      company.employeeCount = props.employee_count || props.num_employees_min;
      company.employeeCountRange = props.employee_count_range
        || (props.num_employees_min && props.num_employees_max
          ? `${props.num_employees_min}-${props.num_employees_max}` : undefined);
    }

    company.headquarters = [props.street_address, props.city, props.region, props.country, props.postal_code]
      .some(Boolean) ? {
        street: props.street_address,
        city: props.city,
        region: props.region,
        country: props.country,
        postalCode: props.postal_code,
      } : undefined;

    company.categories = props.categories;
    company.industries = props.industry_groups;
    company.operatingStatus = props.operating_status;
    company.companyType = props.company_type;
    company.ipoStatus = props.ipo_status;
    company.stockSymbol = props.stock_symbol;
    company.stockExchange = props.stock_exchange;

    company.lastFundingType = props.last_funding_type || props.last_equity_funding_type;
    company.lastFundingDate = props.last_funding_on;
    company.lastFundingAmount = props.last_funding_total_usd || props.last_equity_funding_total_usd;
    company.totalFundingAmount = props.total_funding_usd;
    company.totalFundingAmountCurrency = 'USD';
    company.numFundingRounds = props.num_funding_rounds;
    company.numInvestors = props.num_investors;
    company.numLeadInvestors = props.num_lead_investors;

    company.revenueRange = props.revenue_range || props.estimated_revenue_range;
    company.contactEmail = props.contact_email;
    company.phoneNumber = props.phone_number;
    company.diversitySpotlight = props.diversity_spotlight;
    company.activelyHiring = props.actively_hiring;
    company.growthScore = props.growth_score;
    company.growthScoreTier = props.growth_score_tier;
    company.heatScoreTier = props.heat_score_tier;
    company.trendScore30d = props.trend_score_30d;

    company.monthlyVisits = props.monthly_visits || props.semrush_monthly_visits;
    company.trafficRank = props.global_traffic_rank;
    company.bounceRate = props.bounce_rate;
    company.visitDuration = props.visit_duration;
    company.pageViewsPerVisit = props.page_views_per_visit;

    company.patentsGranted = props.patents_granted;
    company.trademarksRegistered = props.trademarks_registered;
    company.itSpend = props.it_spend_usd || props.it_spend;
    company.mostRecentValuation = props.most_recent_valuation;
    company.numberOfArticles = props.number_of_articles;

    if (props.num_acquisitions) company.acquisitionCount = props.num_acquisitions;

    const social = buildSocialLinks(props);
    if (social) company.socialLinks = social;

    return company;
  }
}
