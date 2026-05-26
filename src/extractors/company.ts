import { Page } from 'playwright';
import { CrunchbaseCompany, Address, SocialLinks, FundingRound, Investor, Person, SimilarCompany, Acquisition } from '../types.js';
import { extractText, extractCurrencyAmountFromDOM, extractDOMSocialLinks } from '../utils.js';
import {
  extractNextData, parseNextDataCompanyProps, parseNextDataPeople,
  parseNextDataFundingRounds, parseNextDataInvestors, parseNextDataSimilarCompanies,
  RawCompanyProperties,
} from '../nextdata.js';
import { waitForStablePage, scrollPage } from '../utils.js';

export async function extractCompanyData(page: Page, url: string): Promise<CrunchbaseCompany> {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForSelector('#__NEXT_DATA__', { timeout: 30000 }).catch(() => {});
  await waitForStablePage(page);

  const nextData = await extractNextData(page);
  const rawProps: RawCompanyProperties | null = nextData ? parseNextDataCompanyProps(nextData) : null;

  const company = buildFromNextData(rawProps, url);

  if (!rawProps) {
    await scrollPage(page);
    const domCompany = await extractFromDOM(page, url);
    Object.assign(company, domCompany);
    return company;
  }

  if (rawProps.num_funding_rounds && rawProps.num_funding_rounds > 0) {
    const nextFundingRounds = parseNextDataFundingRounds(nextData!);
    if (nextFundingRounds.length > 0) {
      company.fundingRounds = nextFundingRounds.map(r => ({
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

  const nextInvestors = parseNextDataInvestors(nextData!);
  if (nextInvestors.length > 0) {
    company.investors = nextInvestors.map(i => ({
      name: i.name,
      type: i.type,
    }));
  }

  const founders = parseNextDataPeople(nextData!, 'founders');
  const executives = parseNextDataPeople(nextData!, 'executives');
  const board = parseNextDataPeople(nextData!, 'board_members_and_advisors');

  const allPeople: Person[] = [];
  founders.forEach(f => allPeople.push({ name: f.name || '', title: f.title, type: 'founder' }));
  executives.forEach(f => allPeople.push({ name: f.name || '', title: f.title, type: 'executive' }));
  board.forEach(f => allPeople.push({ name: f.name || '', title: f.title, type: 'board' }));
  if (allPeople.length > 0) company.people = allPeople;
  if (founders.length > 0) company.founders = founders.map(f => f.name).filter(Boolean) as string[];

  const nextSimilar = parseNextDataSimilarCompanies(nextData!);
  if (nextSimilar.length > 0) {
    company.similarCompanies = nextSimilar.map(s => ({
      name: s.name,
      url: s.permalink ? `https://www.crunchbase.com/organization/${s.permalink}` : '',
    }));
  }

  const social = buildSocialLinks(rawProps);
  if (social) company.socialLinks = social;

  return company;
}

function buildFromNextData(props: RawCompanyProperties | null, url: string): CrunchbaseCompany {
  const company: CrunchbaseCompany = {
    url,
    name: props?.name || url.split('/').pop() || 'Unknown',
    scrapedAt: new Date().toISOString(),
  };

  if (!props) return company;

  company.legalName = props.legal_name;
  company.description = props.description;
  company.shortDescription = props.short_description;
  company.website = props.website;
  company.logo = props.logo_url;
  company.crunchbaseRank = props.rank_org;
  company.foundedDate = props.founded_on;
  company.employeeCount = props.employee_count || props.num_employees_min;
  company.employeeCountRange = props.employee_count_range || (props.num_employees_min && props.num_employees_max
    ? `${props.num_employees_min}-${props.num_employees_max}` : undefined);

  if (props.city || props.region || props.country) {
    company.headquarters = {} as Address;
    if (props.street_address) company.headquarters.street = props.street_address;
    if (props.city) company.headquarters.city = props.city;
    if (props.region) company.headquarters.region = props.region;
    if (props.country) company.headquarters.country = props.country;
    if (props.postal_code) company.headquarters.postalCode = props.postal_code;
  }

  company.categories = props.categories;
  company.industries = props.industry_groups;
  company.operatingStatus = props.operating_status;
  company.ipoStatus = props.ipo_status;
  company.stockSymbol = props.stock_symbol;

  company.lastFundingType = props.last_funding_type || props.last_equity_funding_type;
  company.lastFundingDate = props.last_funding_on;
  company.lastFundingAmount = props.last_funding_total_usd || props.last_equity_funding_total_usd;
  company.totalFundingAmount = props.total_funding_usd;
  company.totalFundingAmountCurrency = 'USD';

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

  if (props.num_acquisitions && props.num_acquisitions > 0) {
    company.acquisitionCount = props.num_acquisitions;
  }

  return company;
}

function buildSocialLinks(props: RawCompanyProperties): SocialLinks | undefined {
  const links: SocialLinks = {};
  let hasAny = false;
  if (props.linkedin_url) { links.linkedin = props.linkedin_url; hasAny = true; }
  if (props.twitter_url) { links.twitter = props.twitter_url; hasAny = true; }
  if (props.facebook_url) { links.facebook = props.facebook_url; hasAny = true; }
  if (props.youtube_url) { links.youtube = props.youtube_url; hasAny = true; }
  if (props.instagram_url) { links.instagram = props.instagram_url; hasAny = true; }
  if (props.github_url) { links.github = props.github_url; hasAny = true; }
  if (props.tiktok_url) { links.tiktok = props.tiktok_url; hasAny = true; }
  return hasAny ? links : undefined;
}

async function extractFromDOM(page: Page, url: string): Promise<Partial<CrunchbaseCompany>> {
  await scrollPage(page);

  const company: Partial<CrunchbaseCompany> = {};

  const name = await extractText(page, 'h1[class*="identifier"], [class*="profile-name"]');
  if (name) company.name = name;

  const desc = await page.evaluate(() => {
    const meta = document.querySelector('meta[name="description"]');
    return meta?.getAttribute('content') || undefined;
  });
  if (desc) company.description = desc || company.description;

  const websiteEl = await page.evaluate(() => {
    const links = document.querySelectorAll('a');
    for (const link of links) {
      const href = link.getAttribute('href') || '';
      if (href.startsWith('http') && !href.includes('crunchbase.com')) return href;
    }
    return undefined;
  });
  if (websiteEl) company.website = websiteEl;

  const totalText = await extractText(page, '[class*="total-funding"]');
  if (totalText) {
    const parsed = extractCurrencyAmountFromDOM(totalText);
    if (parsed.amount !== undefined) company.totalFundingAmount = parsed.amount;
  }

  const social = await extractDOMSocialLinks(page);
  if (social) company.socialLinks = social;

  return company;
}
