import { Actor, log } from 'apify';
import { CRUNCHBASE_COOKIES_KEY } from './constants.js';

let storedCookies: Record<string, any>[] | null = null;

export async function loadCrunchbaseCookies(): Promise<void> {
  storedCookies = await Actor.getValue(CRUNCHBASE_COOKIES_KEY);
  if (storedCookies && Array.isArray(storedCookies) && storedCookies.length > 0) {
    const names = storedCookies.filter(c => c.name).map(c => c.name);
    log.info(`Loaded ${storedCookies.length} Crunchbase cookies from KV store: ${names.join(', ')}`);
  } else {
    storedCookies = null;
    log.info('No Crunchbase cookies found in KV store');
  }
}

export function getCrunchbaseCookies(): Record<string, any>[] | null {
  return storedCookies;
}

export function normalizeCookie(c: Record<string, any>): any {
  const out: any = { name: c.name, value: c.value };
  if (c.url) out.url = c.url;
  if (c.domain) out.domain = c.domain;
  out.path = c.path || '/';
  const expires = c.expires || c.expirationDate;
  if (expires) out.expires = Math.floor(expires);
  if (c.httpOnly !== undefined) out.httpOnly = c.httpOnly;
  if (c.secure !== undefined) out.secure = c.secure;
  if (c.sameSite && c.sameSite !== 'unspecified') {
    const map: Record<string, string> = {
      'no_restriction': 'None', 'lax': 'Lax', 'strict': 'Strict',
      'None': 'None', 'Lax': 'Lax', 'Strict': 'Strict',
    };
    const s = map[c.sameSite] || map[c.sameSite.toLowerCase()];
    if (s) out.sameSite = s;
  }
  return out;
}
