import { Page } from 'playwright';
import { CrunchbaseCompany, Input, SearchResult, CompanySearchFilters } from './types.js';
import { extractCompanyData } from './extractors/company.js';
import { searchCompanies } from './extractors/search.js';
import { extractFundingRounds } from './extractors/funding.js';
import { extractPeople } from './extractors/people.js';
import { parseCrunchbaseUrl, randomDelay } from './utils.js';
import { TIMING } from './constants.js';

export async function handleCompanyUrl(
  page: Page,
  url: string,
  input: Input
): Promise<CrunchbaseCompany> {
  const normalizedUrl = parseCrunchbaseUrl(url);

  try {
    const company = await extractCompanyData(page, normalizedUrl);

    if (input.extractFunding !== false && company.fundingRounds === undefined) {
      const rounds = await extractFundingRounds(page);
      if (rounds.length > 0) company.fundingRounds = rounds;
      if (company.fundingRounds?.length && input.maxFundingRounds) {
        company.fundingRounds = company.fundingRounds.slice(0, input.maxFundingRounds);
      }
    }

    if (input.extractPeople !== false && (company.people === undefined || company.people.length === 0)) {
      const people = await extractPeople(page);
      if (people.length > 0) company.people = people;
    }

    return company;
  } catch (error) {
    return {
      url: normalizedUrl,
      name: url.split('/').pop() || 'Unknown',
      scrapedAt: new Date().toISOString(),
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

export async function handleSearch(
  page: Page,
  input: Input
): Promise<{ companies: CrunchbaseCompany[]; searchResults: SearchResult[] }> {
  const allCompanies: CrunchbaseCompany[] = [];
  const allSearchResults: SearchResult[] = [];
  const maxResults = Math.min(input.maxCompanies || 50, 500);

  const filters: CompanySearchFilters = {
    query: input.searchQueries?.[0] || '',
    location: input.location,
    industry: input.industry,
    fundingStage: input.fundingStage,
    employeeCount: input.employeeCount,
    fundingTotalMin: input.fundingTotalMin,
    fundingTotalMax: input.fundingTotalMax,
  };

  const results = await searchCompanies(page, filters, maxResults, input.crunchbaseApiKey);
  for (const r of results) {
    if (!allSearchResults.some(ex => ex.url === r.url)) allSearchResults.push(r);
  }

  for (const result of results.slice(0, maxResults)) {
    if (allCompanies.length >= maxResults) break;
    await randomDelay(TIMING.minDelay, TIMING.maxDelay);
    const company = await handleCompanyUrl(page, result.url, input);
    allCompanies.push(company);
  }

  return { companies: allCompanies, searchResults: allSearchResults };
}
