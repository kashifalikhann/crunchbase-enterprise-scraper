import { FundingRound } from '../types.js';
import { parseNextDataFundingRounds } from '../nextdata.js';

export function extractFundingRoundsFromNextData(nextData: any, maxRounds?: number): FundingRound[] {
  const fundingData = parseNextDataFundingRounds(nextData);
  const rounds = fundingData.map(r => ({
    name: r.type || r.name,
    date: r.announced_on,
    type: r.type,
    amount: r.money_raised_usd,
    valuation: r.pre_money_valuation_usd || r.post_money_valuation_usd,
    leadInvestors: r.lead_investors?.map(i => i?.identifier?.value).filter(Boolean) as string[],
    investors: r.investors?.map(i => i?.identifier?.value).filter(Boolean) as string[],
  }));

  if (maxRounds && maxRounds > 0) return rounds.slice(0, maxRounds);
  return rounds;
}
