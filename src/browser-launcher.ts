import { Actor, log } from 'apify';
import { chromium, Browser, BrowserContext, Page } from 'playwright';

let browser: Browser | null = null;
let context: BrowserContext | null = null;

export async function launchBrowser(proxyUrl?: string): Promise<void> {
  if (browser) return;
  log.info('Launching Playwright browser', { proxyConfigured: !!proxyUrl });

  const launchOptions: Parameters<typeof chromium.launch>[0] = {
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-blink-features=AutomationControlled',
      '--disable-web-security',
      '--disable-features=IsolateOrigins,site-per-process',
      '--disable-features=ChromeWhatsNewUI',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-component-update',
    ],
  };

  browser = await chromium.launch(launchOptions);

  const viewport = { width: 1920, height: 1080 };

  context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
    viewport,
    locale: 'en-US',
    timezoneId: 'America/New_York',
    proxy: proxyUrl ? { server: proxyUrl } : undefined,
    bypassCSP: true,
    ignoreHTTPSErrors: true,
    extraHTTPHeaders: {
      'Accept-Language': 'en-US,en;q=0.9',
    },
  });

  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
    Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
  });
}

export async function tryBrowserRetrieve(
  url: string,
  retries = 3,
  proxyUrl?: string,
  pageTimeout?: number,
): Promise<{ html: string; cookies: Record<string, string> } | null> {
  if (!browser || !context) {
    await launchBrowser(proxyUrl);
    if (!browser || !context) return null;
  }

  const navTimeout = pageTimeout ?? 45000;

  for (let attempt = 1; attempt <= retries; attempt++) {
    let page: Page | null = null;
    try {
      page = await context.newPage();

      page.setDefaultTimeout(30000);
      page.setDefaultNavigationTimeout(navTimeout);

      await page.route('**/*', (route: import('playwright').Route) => {
        const reqUrl = route.request().url();
        const blockPatterns = [
          'cdn-cgi',
          'challenges.cloudflare.com',
          'turnstile',
          'google-analytics',
          'googletagmanager',
          'facebook.net',
          'doubleclick.net',
        ];
        if (blockPatterns.some(p => reqUrl.includes(p))) {
          route.abort('blockedbyclient').catch(() => {});
          return;
        }
        route.continue().catch(() => {});
      });

      const resp = await page.goto(url, {
        waitUntil: 'domcontentloaded',
        timeout: 45000,
      });

      if (!resp) {
        log.warning(`Attempt ${attempt}: no response for ${url}`);
        await page.close();
        page = null;
        continue;
      }

      log.info(`Page loaded: status ${resp.status()} for ${url.substring(0, 80)}`);

      if (resp.status() === 403 || resp.status() === 429) {
        log.warning(`Attempt ${attempt}: HTTP ${resp.status()} — will retry`);
        await page.close();
        page = null;
        const delay = attempt * 5000;
        await new Promise(r => setTimeout(r, delay));
        continue;
      }

      await page.waitForFunction(
        () => document.querySelector('script#__NEXT_DATA__') !== null,
        { timeout: 15000 },
      ).catch(() => {
        log.warning(`Attempt ${attempt}: __NEXT_DATA__ not found within timeout`);
      });

      const html = await page.content();
      const cookies = await page.context().cookies();
      const cookieMap: Record<string, string> = {};
      for (const c of cookies) cookieMap[c.name] = c.value;

      if (!html.includes('__NEXT_DATA__')) {
        log.warning(`Attempt ${attempt}: no __NEXT_DATA__ in HTML (length ${html.length})`);
        await page.close();
        page = null;
        if (attempt < retries) {
          await new Promise(r => setTimeout(r, attempt * 5000));
        }
        continue;
      }

      log.info(`Success: got page with __NEXT_DATA__ (attempt ${attempt})`);
      await page.close();
      return { html, cookies: cookieMap };
    } catch (err) {
      log.warning(`Attempt ${attempt} error: ${err instanceof Error ? err.message : String(err)}`);
      if (page) {
        try { await page.close(); } catch {}
      }
      if (attempt < retries) {
        const delay = attempt * 5000;
        await new Promise(r => setTimeout(r, delay));
      }
    }
  }

  return null;
}

export async function closeBrowser(): Promise<void> {
  if (context) {
    try { await context.close(); } catch {}
    context = null;
  }
  if (browser) {
    try { await browser.close(); } catch {}
    browser = null;
  }
  log.info('Browser closed');
}
