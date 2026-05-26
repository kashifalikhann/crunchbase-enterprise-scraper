import { CrunchbaseClient } from './crunchbase-client.js';
import { CrunchbaseCompany, Input, SearchResult } from './types.js';
import { extractCompanyData } from './extractors/company.js';
import { searchCompanies } from './extractors/search.js';
import { TIMING } from './constants.js';
import { randomDelay } from './utils.js';

export async function handleCompanyUrl(
  client: CrunchbaseClient,
  url: string,
  input: Input,
): Promise<CrunchbaseCompany> {
  try {
    const company = await extractCompanyData(client, url, {
      extractFunding: input.extractFunding,
      extractPeople: input.extractPeople,
      maxFundingRounds: input.maxFundingRounds,
    });

    return company;
  } catch (error) {
    return {
      url,
      name: url.split('/').pop() || 'Unknown',
      scrapedAt: new Date().toISOString(),
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

export async function handleSearch(
  client: CrunchbaseClient,
  input: Input,
): Promise<{ companies: CrunchbaseCompany[]; searchResults: SearchResult[] }> {
  const allCompanies: CrunchbaseCompany[] = [];
  const allSearchResults: SearchResult[] = [];
  const maxResults = Math.min(input.maxCompanies || 50, 500);

  const filters = {
    query: input.searchQueries?.[0] || '',
    location: input.location,
    industry: input.industry,
    fundingStage: input.fundingStage,
    employeeCount: input.employeeCount,
    fundingTotalMin: input.fundingTotalMin,
    fundingTotalMax: input.fundingTotalMax,
  };

  const results = await searchCompanies(client, filters, maxResults);
  for (const r of results) {
    if (!allSearchResults.some(ex => ex.url === r.url)) allSearchResults.push(r);
  }

  for (const result of results.slice(0, maxResults)) {
    if (allCompanies.length >= maxResults) break;
    await randomDelay(TIMING.minDelay, TIMING.maxDelay);
    const company = await handleCompanyUrl(client, result.url, input);
    allCompanies.push(company);
  }

  return { companies: allCompanies, searchResults: allSearchResults };
}
