import { SearchResult, CompanySearchFilters } from '../types.js';
import { CrunchbaseClient } from '../crunchbase-client.js';

export async function searchCompanies(
  client: CrunchbaseClient,
  filters: CompanySearchFilters,
  maxResults: number = 50,
): Promise<SearchResult[]> {
  return client.searchCompanies(filters, maxResults);
}
