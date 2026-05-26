import { Page } from 'playwright';
import { Person } from '../types.js';

export async function extractPeopleFromDOM(page: Page): Promise<Person[]> {
  try {
    return await page.evaluate(() => {
      const items = document.querySelectorAll('[class*="person"], [class*="team-member"]');
      if (!items.length) return [];

      return Array.from(items).map(el => {
        const nameEl = el.querySelector('[class*="name"]');
        const titleEl = el.querySelector('[class*="title"]');
        const linkedInEl = el.querySelector('a[href*="linkedin"]') as HTMLAnchorElement;
        const rawName = nameEl?.textContent?.trim() || '';
        const rawTitle = titleEl?.textContent?.trim() || '';
        let type: Person['type'] = 'employee';
        const t = rawTitle.toLowerCase();
        if (t.includes('founder') || t.includes('co-founder')) type = 'founder';
        else if (t.includes('ceo') || t.includes('cto') || t.includes('cfo') || t.includes('chief')
          || t.includes('president') || t.includes('vp ') || t.includes('head of') || t.includes('director')) type = 'executive';
        return { name: rawName, title: rawTitle || undefined, linkedIn: linkedInEl?.href || undefined, type };
      });
    });
  } catch { return []; }
}

export async function extractPeople(page: Page): Promise<Person[]> {
  return extractPeopleFromDOM(page);
}
