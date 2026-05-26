import { Page } from 'playwright';
import { FundingRound } from '../types.js';
import { extractCurrencyAmountFromDOM } from '../utils.js';

export async function extractFundingRoundsFromDOM(page: Page): Promise<FundingRound[]> {
  try {
    return await page.evaluate(() => {
      const sections = document.querySelectorAll('[class*="funding"]');
      for (const section of sections) {
        const header = section.querySelector('h2, h3, [class*="title"]');
        if (!header?.textContent?.toLowerCase().includes('funding')) continue;

        const rows = section.querySelectorAll('[class*="row"], tr, [class*="item"]');
        if (!rows.length) continue;

        return Array.from(rows).map(row => {
          const cells = row.querySelectorAll('[class*="cell"], td, [class*="field"]');
          return {
            name: cells[0]?.textContent?.trim() || undefined,
            date: cells[1]?.textContent?.trim() || undefined,
            type: cells[2]?.textContent?.trim() || undefined,
          };
        });
      }
      return [];
    });
  } catch {
    return [];
  }
}

export async function extractFundingRounds(page: Page): Promise<FundingRound[]> {
  return extractFundingRoundsFromDOM(page);
}
