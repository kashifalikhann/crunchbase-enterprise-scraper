import { log } from 'apify';
import { extractNextDataFromHtml, parseNextDataCompanyProps, parseNextDataFundingRounds, parseNextDataPeople, parseNextDataInvestors, parseNextDataSimilarCompanies, parseNextDataTechStack, RawCompanyProperties } from './nextdata.js';
import { CrunchbaseCompany, Person } from './types.js';
import { buildSocialLinks } from './utils.js';
import { CRUNCHBASE_URL } from './constants.js';

export function parseCompanyFromHtml(html: string, url: string): { company: CrunchbaseCompany; nextData?: any } | null {
  if (html.includes('Just a moment') || html.includes('Checking your browser')) return null;

  const nextData = extractNextDataFromHtml(html);
  if (!nextData) return null;

  const props = parseNextDataCompanyProps(nextData);
  if (!props) return null;

  const company = buildCompanyFromProps(props, url);

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
    company.investors = investors.map(i => ({ name: i.name, type: i.type }));
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
  if (techStack.length > 0) company.technologies = techStack;

  return { company, nextData };
}

export function buildCompanyFromProps(props: RawCompanyProperties | Record<string, any>, url: string, source: 'api' | 'browser' = 'browser'): CrunchbaseCompany {
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
