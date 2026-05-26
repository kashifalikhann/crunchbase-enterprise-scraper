import { CrunchbaseClient } from '../crunchbase-client.js';
import { CrunchbaseCompany, FundingRound, Person } from '../types.js';
import { parseNextDataFundingRounds, parseNextDataPeople } from '../nextdata.js';

export async function extractCompanyData(
  client: CrunchbaseClient,
  slugOrUrl: string,
  opts?: { extractFunding?: boolean; extractPeople?: boolean; maxFundingRounds?: number },
): Promise<CrunchbaseCompany> {
  const result = await client.getCompany(slugOrUrl);
  const company = result.company;

  if (company.error) return company;

  if (result.nextData && opts) {
    if (opts.extractFunding !== false && (!company.fundingRounds || company.fundingRounds.length === 0)) {
      const fundingData = parseNextDataFundingRounds(result.nextData);
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
    }

    if (opts.extractPeople !== false && (!company.people || company.people.length === 0)) {
      const allPeople: Person[] = [];
      for (const type of ['founders', 'executives', 'board_members_and_advisors'] as const) {
        const ppl = parseNextDataPeople(result.nextData, type);
        ppl.forEach(p => {
          const personType = type === 'founders' ? 'founder' as const
            : type === 'executives' ? 'executive' as const
            : 'board' as const;
          if (p.name) allPeople.push({ name: p.name, title: p.title, type: personType });
        });
      }
      if (allPeople.length > 0) company.people = allPeople;
    }
  }

  return company;
}
