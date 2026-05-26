import { TIMING, USER_AGENTS } from './constants.js';
import { SocialLinks } from './types.js';

export function getRandomUserAgent(): string {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

export async function randomDelay(min = TIMING.minDelay, max = TIMING.maxDelay): Promise<void> {
  const ms = Math.floor(Math.random() * (max - min + 1)) + min;
  await new Promise(r => setTimeout(r, ms));
}

export function parseCrunchbaseUrl(urlOrName: string): string {
  if (urlOrName.startsWith('http')) {
    const match = urlOrName.match(/crunchbase\.com\/(?:organization|company|person)\/([^/?]+)/);
    return match ? `https://www.crunchbase.com/organization/${match[1]}` : urlOrName;
  }
  return `https://www.crunchbase.com/organization/${urlOrName}`;
}

export function parseNumber(val: string | number | undefined | null): number | undefined {
  if (val === undefined || val === null) return undefined;
  if (typeof val === 'number') return val;
  const n = parseFloat(val.replace(/[^0-9.-]/g, ''));
  return isNaN(n) ? undefined : n;
}

export function getSlugFromUrl(url: string): string {
  const match = url.match(/crunchbase\.com\/(?:organization|company|person)\/([^/?]+)/);
  return match ? match[1] : url.split('/').pop() || '';
}

export function buildCookieHeader(cookies: Record<string, string>): string {
  return Object.entries(cookies)
    .map(([k, v]) => `${k}=${v}`)
    .join('; ');
}

export function parseCookiesFromString(cookieStr: string): Record<string, string> {
  const cookies: Record<string, string> = {};
  cookieStr.split(';').forEach(pair => {
    const [k, ...v] = pair.trim().split('=');
    if (k) cookies[k.trim()] = v.join('=');
  });
  return cookies;
}

export function extractCookiesFromResponse(resp: Response): Record<string, string> {
  const cookies: Record<string, string> = {};
  const setCookieHeaders = resp.headers.getSetCookie?.() || [];
  if (setCookieHeaders.length === 0) {
    const single = resp.headers.get('set-cookie');
    if (single) setCookieHeaders.push(single);
  }
  for (const h of setCookieHeaders) {
    Object.assign(cookies, parseCookiesFromString(h.split(';')[0]));
  }
  return cookies;
}

export function httpFetch(url: string, options: RequestInit = {}, timeout = TIMING.requestTimeout): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(timer));
}

export function extractCurrencyAmount(text: string | undefined | null): { amount?: number; currency?: string } {
  if (!text) return {};
  const multipliers: [RegExp, number][] = [
    [/([0-9.]+)\s*B/i, 1_000_000_000],
    [/([0-9.]+)\s*M/i, 1_000_000],
    [/([0-9.]+)\s*K/i, 1_000],
  ];
  for (const [pattern, mult] of multipliers) {
    const m = text.match(pattern);
    if (m) return { amount: parseFloat(m[1]) * mult };
  }
  const num = parseFloat(text.replace(/[^0-9.]/g, ''));
  return { amount: isNaN(num) ? undefined : num };
}

export function buildSocialLinks(props: any): SocialLinks | undefined {
  const links: SocialLinks = {};
  let hasAny = false;
  for (const [key, field] of Object.entries({
    linkedin: 'linkedin_url', twitter: 'twitter_url', facebook: 'facebook_url',
    youtube: 'youtube_url', instagram: 'instagram_url', github: 'github_url', tiktok: 'tiktok_url',
  } as Record<string, string>)) {
    const val = props[field];
    if (val) { (links as any)[key] = val; hasAny = true; }
  }
  return hasAny ? links : undefined;
}

export function parseApiEntityProperties(entity: any): Record<string, any> {
  const props: Record<string, any> = {};
  if (!entity?.properties) return props;
  for (const p of entity.properties) {
    if (p.value !== null && p.value !== undefined) {
      props[p.property_id] = p.value;
    }
  }
  return props;
}
