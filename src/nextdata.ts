import { Page } from 'playwright';

export interface NextDataProps {
  pageProps?: {
    pageContext?: {
      entity?: {
        id?: string;
        uuid?: string;
        properties?: Record<string, any>;
        cards?: Record<string, any>;
        relationships?: Record<string, any>;
      };
    };
  };
}

export async function extractNextData<T = NextDataProps>(page: Page): Promise<T | null> {
  try {
    return await page.evaluate(() => {
      const el = document.getElementById('__NEXT_DATA__');
      if (!el?.textContent) return null;
      return JSON.parse(el.textContent);
    });
  } catch {
    return null;
  }
}

export interface RawFundingRound {
  uuid?: string;
  type?: string;
  announced_on?: string;
  money_raised?: string;
  money_raised_usd?: number;
  pre_money_valuation?: string;
  pre_money_valuation_usd?: number;
  post_money_valuation?: string;
  post_money_valuation_usd?: number;
  lead_investors?: Array<{ identifier?: { value?: string; permalink?: string } }>;
  investors?: Array<{ identifier?: { value?: string; permalink?: string } }>;
  name?: string;
}

export interface RawPerson {
  name?: string;
  title?: string;
  linkedin_url?: string;
  location?: string;
  type?: string;
}

export interface RawCompanyProperties {
  name?: string;
  legal_name?: string;
  short_description?: string;
  description?: string;
  website?: string;
  logo_url?: string;
  rank_org?: number;
  founded_on?: string;
  num_employees_min?: number;
  num_employees_max?: number;
  employee_count?: number;
  employee_count_range?: string;
  city?: string;
  region?: string;
  country?: string;
  postal_code?: string;
  street_address?: string;
  categories?: string[];
  industry_groups?: string[];
  operating_status?: string;
  company_type?: string;
  ipo_status?: string;
  stock_symbol?: string;
  stock_exchange?: string;
  total_funding_usd?: number;
  total_funding?: string;
  last_funding_type?: string;
  last_funding_on?: string;
  last_funding_total?: string;
  last_funding_total_usd?: number;
  last_equity_funding_type?: string;
  last_equity_funding_total_usd?: number;
  num_funding_rounds?: number;
  num_investors?: number;
  num_lead_investors?: number;
  num_acquisitions?: number;
  num_exits?: number;
  revenue_range?: string;
  estimated_revenue_range?: string;
  contact_email?: string;
  phone_number?: string;
  facebook_url?: string;
  twitter_url?: string;
  linkedin_url?: string;
  youtube_url?: string;
  instagram_url?: string;
  github_url?: string;
  tiktok_url?: string;
  diversity_spotlight?: string[];
  hub_tags?: string[];
  actively_hiring?: boolean;
  growth_score?: number;
  growth_score_tier?: string;
  heat_score_tier?: string;
  trend_score_7d?: number;
  trend_score_30d?: number;
  trend_score_90d?: number;
  monthly_visits?: number;
  monthly_visits_growth?: number;
  visit_duration?: number;
  page_views_per_visit?: number;
  bounce_rate?: number;
  global_traffic_rank?: number;
  monthly_rank_change?: number;
  semrush_monthly_visits?: number;
  it_spend?: number;
  it_spend_usd?: number;
  most_recent_valuation?: number;
  most_recent_valuation_range?: string;
  patents_granted?: number;
  trademarks_registered?: number;
  number_of_articles?: number;
  number_of_events?: number;
  num_sub_orgs?: number;
}

export function parseNextDataCompanyProps(nextData: NextDataProps): RawCompanyProperties | null {
  try {
    const props = nextData?.pageProps?.pageContext?.entity?.properties;
    if (!props || !props.name) return null;
    return props as unknown as RawCompanyProperties;
  } catch {
    return null;
  }
}

export function parseNextDataPeople(nextData: NextDataProps, peopleType: 'founders' | 'executives' | 'board_members' | 'board_members_and_advisors' = 'founders'): RawPerson[] {
  try {
    const cards = nextData?.pageProps?.pageContext?.entity?.cards;
    if (!cards) return [];

    const data = cards[peopleType] || cards[`${peopleType}_and_advisors`];
    if (!data?.length) return [];

    return data.map((p: any) => ({
      name: p?.name || p?.identifier?.value || p?.person_identifier?.value,
      title: p?.title,
    }));
  } catch {
    return [];
  }
}

export function parseNextDataFundingRounds(nextData: NextDataProps): RawFundingRound[] {
  try {
    const cards = nextData?.pageProps?.pageContext?.entity?.cards;
    const funding = cards?.funding_rounds || cards?.funding_rounds_custom;
    if (!funding?.length) return [];

    return funding.map((r: any) => ({
      uuid: r?.uuid,
      type: r?.type,
      announced_on: r?.announced_on,
      money_raised: r?.money_raised,
      money_raised_usd: r?.money_raised_usd,
      pre_money_valuation: r?.pre_money_valuation,
      pre_money_valuation_usd: r?.pre_money_valuation_usd,
      lead_investors: r?.lead_investors || r?.investors?.filter((i: any) => i?.is_lead),
      investors: r?.investors,
    }));
  } catch {
    return [];
  }
}

export function parseNextDataInvestors(nextData: NextDataProps): Array<{ name: string; type?: string }> {
  try {
    const rels = nextData?.pageProps?.pageContext?.entity?.relationships;
    const investors = rels?.investors || rels?.investors_list;
    if (!investors?.length) return [];

    return investors.map((i: any) => ({
      name: i?.identifier?.value || i?.name,
      type: i?.investor_type || i?.type,
    }));
  } catch {
    return [];
  }
}

export function parseNextDataSimilarCompanies(nextData: NextDataProps): Array<{ name: string; permalink: string }> {
  try {
    const cards = nextData?.pageProps?.pageContext?.entity?.cards;
    const similar = cards?.similar_companies || cards?.similar_organizations;
    if (!similar?.length) return [];

    return similar.map((s: any) => ({
      name: s?.identifier?.value || s?.name,
      permalink: s?.identifier?.permalink || s?.permalink,
    }));
  } catch {
    return [];
  }
}
