export interface Input {
  mode: 'search' | 'urls';

  startUrls?: { url: string }[];
  searchQueries?: string[];

  location?: string;
  industry?: string;
  fundingStage?: string;
  employeeCount?: string;
  fundingTotalMin?: number;
  fundingTotalMax?: number;

  maxCompanies?: number;
  maxFundingRounds?: number;

  extractPeople?: boolean;
  extractFunding?: boolean;
  extractTechStack?: boolean;
  extractSimilarCompanies?: boolean;
  extractInvestors?: boolean;
  extractContacts?: boolean;

  capsolverApiKey?: string;
  capsolverProxy?: string;
  crunchbaseApiKey?: string;

  proxyConfiguration?: {
    useApifyProxy?: boolean;
    apifyProxyGroups?: string[];
  };
  concurrency?: number;
  maxRetries?: number;
  webhookUrl?: string;
  outputFormat?: 'json' | 'csv';
}

export interface CrunchbaseCompany {
  url: string;
  name: string;
  legalName?: string;
  description?: string;
  shortDescription?: string;
  website?: string;
  logo?: string;
  crunchbaseRank?: number;
  ipoStatus?: string;
  stockSymbol?: string;
  stockExchange?: string;
  foundedDate?: string;
  founders?: string[];
  employeeCount?: number;
  employeeCountRange?: string;
  headquarters?: Address;
  categories?: string[];
  industries?: string[];
  operatingStatus?: string;
  companyType?: string;

  lastFundingType?: string;
  lastFundingDate?: string;
  lastFundingAmount?: number;
  totalFundingAmount?: number;
  totalFundingAmountCurrency?: string;
  numFundingRounds?: number;
  fundingRounds?: FundingRound[];
  investors?: Investor[];
  numInvestors?: number;
  numLeadInvestors?: number;

  acquisitions?: Acquisition[];
  acquisitionCount?: number;

  people?: Person[];
  technologies?: string[];
  similarCompanies?: SimilarCompany[];
  socialLinks?: SocialLinks;

  revenueRange?: string;
  contactEmail?: string;
  phoneNumber?: string;
  activelyHiring?: boolean;
  diversitySpotlight?: string[];
  growthScore?: number;
  growthScoreTier?: string;
  heatScoreTier?: string;
  trendScore30d?: number;

  trafficRank?: number;
  monthlyVisits?: number;
  bounceRate?: number;
  visitDuration?: number;
  pageViewsPerVisit?: number;

  patentsGranted?: number;
  trademarksRegistered?: number;
  itSpend?: number;
  mostRecentValuation?: number;
  numberOfArticles?: number;

  scrapedAt: string;
  error?: string;
  source?: 'official_api' | 'session_api' | 'nextdata';
}

export interface Address {
  street?: string;
  city?: string;
  region?: string;
  country?: string;
  postalCode?: string;
}

export interface FundingRound {
  name?: string;
  date?: string;
  type?: string;
  amount?: number;
  amountCurrency?: string;
  valuation?: number;
  investors?: string[];
  leadInvestors?: string[];
}

export interface Investor {
  name: string;
  url?: string;
  type?: string;
  leadInvestor?: boolean;
}

export interface Acquisition {
  name?: string;
  url?: string;
  date?: string;
  price?: number;
  priceCurrency?: string;
  type?: string;
}

export interface Person {
  name: string;
  url?: string;
  title?: string;
  location?: string;
  linkedIn?: string;
  type?: 'founder' | 'executive' | 'employee' | 'board';
}

export interface SimilarCompany {
  name: string;
  url: string;
  description?: string;
  location?: string;
}

export interface SocialLinks {
  linkedin?: string;
  twitter?: string;
  facebook?: string;
  youtube?: string;
  instagram?: string;
  github?: string;
  tiktok?: string;
}

export interface SearchResult {
  name: string;
  url: string;
  uuid?: string;
  shortDescription?: string;
  location?: string;
  employeeRange?: string;
  industry?: string;
}

export interface CompanySearchFilters {
  query?: string;
  location?: string;
  industry?: string;
  fundingStage?: string;
  employeeCount?: string;
  fundingTotalMin?: number;
  fundingTotalMax?: number;
}
