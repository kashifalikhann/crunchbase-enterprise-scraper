export const CRUNCHBASE_URL = 'https://www.crunchbase.com';
export const CRUNCHBASE_API_URL = 'https://api.crunchbase.com/api/v4';

export const USER_AGENTS = [
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:123.0) Gecko/20100101 Firefox/123.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:123.0) Gecko/20100101 Firefox/123.0',
];

export const TIMING = {
  minDelay: 1000,
  maxDelay: 3000,
  requestTimeout: 60000,
  retryDelay: 3000,
};

export const MAX_RETRIES = 3;

export const CRUNCHBASE_COOKIES_KEY = 'CRUNCHBASE_COOKIES';
export const DEFAULT_CONCURRENCY = 5;
export const MAX_PAGES_PER_SEARCH = 10;

export const API_FIELD_IDS = [
  'name', 'legal_name', 'short_description', 'description',
  'website', 'logo_url', 'rank_org', 'rank_company',
  'founded_on', 'num_employees_min', 'num_employees_max',
  'employee_count', 'employee_count_range',
  'city', 'region', 'country', 'postal_code', 'street_address',
  'categories', 'industry_groups',
  'operating_status', 'company_type',
  'ipo_status', 'stock_symbol', 'stock_exchange',
  'total_funding_usd', 'total_funding',
  'last_funding_type', 'last_funding_on',
  'last_funding_total', 'last_funding_total_usd',
  'last_equity_funding_type', 'last_equity_funding_total_usd',
  'num_funding_rounds', 'num_investors', 'num_lead_investors',
  'num_acquisitions', 'num_exits',
  'revenue_range', 'estimated_revenue_range',
  'contact_email', 'phone_number',
  'facebook_url', 'twitter_url', 'linkedin_url',
  'youtube_url', 'instagram_url', 'github_url', 'tiktok_url',
  'diversity_spotlight', 'hub_tags', 'actively_hiring',
  'growth_score', 'growth_score_tier', 'heat_score_tier',
  'trend_score_7d', 'trend_score_30d', 'trend_score_90d',
  'monthly_visits', 'monthly_visits_growth',
  'visit_duration', 'page_views_per_visit', 'bounce_rate',
  'global_traffic_rank', 'monthly_rank_change',
  'semrush_monthly_visits',
  'it_spend', 'it_spend_usd',
  'most_recent_valuation', 'most_recent_valuation_range',
  'patents_granted', 'trademarks_registered',
  'number_of_articles', 'number_of_events', 'num_sub_orgs',
];
