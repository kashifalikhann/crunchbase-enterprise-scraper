import { Person } from '../types.js';
import { parseNextDataPeople } from '../nextdata.js';

export function extractPeopleFromNextData(nextData: any): Person[] {
  const allPeople: Person[] = [];

  for (const type of ['founders', 'executives', 'board_members_and_advisors'] as const) {
    const ppl = parseNextDataPeople(nextData, type);
    const personType = type === 'founders' ? 'founder' as const
      : type === 'executives' ? 'executive' as const
      : 'board' as const;

    for (const p of ppl) {
      if (p.name) {
        allPeople.push({ name: p.name, title: p.title, type: personType });
      }
    }
  }

  return allPeople;
}
