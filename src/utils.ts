import { Page } from 'playwright';
import { TIMING, USER_AGENTS } from './constants.js';
import { SocialLinks } from './types.js';

export function getRandomUserAgent(): string {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

export async function randomDelay(min = TIMING.minDelay, max = TIMING.maxDelay): Promise<void> {
  const ms = Math.floor(Math.random() * (max - min + 1)) + min;
  await new Promise(r => setTimeout(r, ms));
}

export async function scrollPage(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const scrollHeight = document.body.scrollHeight;
    const viewportHeight = window.innerHeight;
    const steps = Math.min(Math.ceil(scrollHeight / viewportHeight), 20);
    for (let i = 0; i < steps; i++) {
      window.scrollTo(0, Math.min(viewportHeight * (i + 1), scrollHeight));
      await new Promise(r => setTimeout(r, 300));
    }
  });
}

export async function extractText(page: Page, selector: string): Promise<string | undefined> {
  try {
    const el = await page.$(selector);
    if (!el) return undefined;
    return ((await el.textContent()) || '').trim() || undefined;
  } catch { return undefined; }
}

export function extractCurrencyAmountFromDOM(text: string | null | undefined): { amount?: number; currency?: string } {
  if (!text) return {};
  let cleaned = text.replace(/[$€£¥₹]/g, '').trim();
  const multipliers: [RegExp, number][] = [
    [/([0-9.]+)\s*B/i, 1_000_000_000],
    [/([0-9.]+)\s*M/i, 1_000_000],
    [/([0-9.]+)\s*K/i, 1_000],
  ];
  for (const [pattern, mult] of multipliers) {
    const m = cleaned.match(pattern);
    if (m) return { amount: parseFloat(m[1]) * mult };
  }
  const num = parseFloat(cleaned.replace(/[^0-9.]/g, ''));
  return { amount: isNaN(num) ? undefined : num };
}

export async function extractDOMSocialLinks(page: Page): Promise<SocialLinks | undefined> {
  try {
    return await page.evaluate(() => {
      const links = document.querySelectorAll('a');
      const result: Record<string, string> = {};
      links.forEach(link => {
        const href = link.href || '';
        if (href.includes('linkedin.com/company')) result.linkedin = href;
        if (href.includes('twitter.com') || href.includes('x.com')) result.twitter = href;
        if (href.includes('facebook.com')) result.facebook = href;
        if (href.includes('youtube.com')) result.youtube = href;
        if (href.includes('instagram.com')) result.instagram = href;
        if (href.includes('github.com')) result.github = href;
        if (href.includes('tiktok.com')) result.tiktok = href;
      });
      return Object.keys(result).length ? result as SocialLinks : undefined;
    });
  } catch { return undefined; }
}

export function parseCrunchbaseUrl(urlOrName: string): string {
  if (urlOrName.startsWith('http')) {
    const match = urlOrName.match(/crunchbase\.com\/(?:organization|company|person)\/([^/?]+)/);
    return match ? `https://www.crunchbase.com/organization/${match[1]}` : urlOrName;
  }
  return `https://www.crunchbase.com/organization/${urlOrName}`;
}

export async function waitForStablePage(page: Page): Promise<void> {
  try {
    await page.waitForLoadState('networkidle', { timeout: 15000 });
  } catch {}
  await randomDelay(1000, 2000);
}

export function parseNumber(val: string | number | undefined | null): number | undefined {
  if (val === undefined || val === null) return undefined;
  if (typeof val === 'number') return val;
  const n = parseFloat(val.replace(/[^0-9.-]/g, ''));
  return isNaN(n) ? undefined : n;
}
