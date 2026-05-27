import { log } from 'apify';
import type { Page } from 'playwright';
import {
  CAPSOLVER_CREATE_TASK_URL,
  CAPSOLVER_GET_RESULT_URL,
  CAPSOLVER_POLL_INTERVAL_MS,
  CAPSOLVER_MAX_POLL_SECONDS,
} from './constants.js';

interface CapsolverTask {
  type: string;
  websiteURL: string;
  websiteKey: string;
  pageAction?: string;
  metadata?: Record<string, string>;
}

interface CapsolverResponse {
  errorId: number;
  errorCode?: string;
  errorDescription?: string;
  taskId?: string;
  status?: string;
  solution?: {
    token?: string;
    userAgent?: string;
    [key: string]: any;
  };
}

async function callCapsolver(apiKey: string, url: string, payload: Record<string, any>): Promise<CapsolverResponse> {
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ clientKey: apiKey, ...payload }),
    signal: AbortSignal.timeout(30000),
  });
  return resp.json();
}

export async function extractTurnstileSiteKey(page: Page): Promise<string | null> {
  try {
    const siteKey = await page.evaluate(() => {
      const el = document.querySelector('.cf-turnstile');
      if (el) return el.getAttribute('data-sitekey');

      const opt = (window as any)._cf_chl_opt;
      if (opt?.sitekey) return opt.sitekey;

      const iframe = document.querySelector('iframe[src*="turnstile"]');
      if (iframe) {
        const src = iframe.getAttribute('src') || '';
        const m = src.match(/sitekey=([^&]+)/);
        if (m) return m[1];
      }

      const html = document.body?.innerHTML || '';
      const m = html.match(/data-sitekey=["']([^"']+)["']/);
      if (m) return m[1];

      return null;
    });
    return siteKey || null;
  } catch (err) {
    log.warning(`Failed to extract sitekey: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

export async function createTurnstileTask(apiKey: string, websiteUrl: string, siteKey: string): Promise<string | null> {
  const task: CapsolverTask = {
    type: 'AntiTurnstileTaskProxyLess',
    websiteURL: websiteUrl,
    websiteKey: siteKey,
  };

  const result = await callCapsolver(apiKey, CAPSOLVER_CREATE_TASK_URL, { task });
  if (result.errorId !== 0) {
    log.warning(`Capsolver createTask failed: ${result.errorCode} — ${result.errorDescription}`);
    return null;
  }
  return result.taskId || null;
}

export async function getTurnstileToken(apiKey: string, taskId: string): Promise<string | null> {
  const maxPolls = Math.floor(CAPSOLVER_MAX_POLL_SECONDS * 1000 / CAPSOLVER_POLL_INTERVAL_MS);

  for (let i = 0; i < maxPolls; i++) {
    await new Promise(r => setTimeout(r, CAPSOLVER_POLL_INTERVAL_MS));

    const result = await callCapsolver(apiKey, CAPSOLVER_GET_RESULT_URL, { taskId });

    if (result.errorId !== 0) {
      log.warning(`Capsolver getTaskResult failed: ${result.errorCode} — ${result.errorDescription}`);
      return null;
    }

    if (result.status === 'ready') {
      const token = result.solution?.token;
      if (token) {
        if (result.solution?.userAgent) {
          log.info(`Capsolver solved (UA: ${result.solution.userAgent.substring(0, 50)}...)`);
        }
        return token;
      }
      log.warning('Capsolver returned ready status but no token');
      return null;
    }

    if (result.status === 'failed') {
      log.warning('Capsolver task failed');
      return null;
    }
  }

  log.warning(`Capsolver timed out after ${CAPSOLVER_MAX_POLL_SECONDS}s`);
  return null;
}

export async function injectTurnstileTokenAndSubmit(page: Page, token: string): Promise<boolean> {
  try {
    await page.evaluate((t) => {
      const input = document.querySelector<HTMLInputElement>('[name="cf-turnstile-response"]');
      if (input) input.value = t;

      const textarea = document.querySelector<HTMLTextAreaElement>('#cf-turnstile-response');
      if (textarea) textarea.value = t;

      const form = document.querySelector<HTMLFormElement>('#challenge-form');
      if (form) {
        form.submit();
        return;
      }

      const btn = document.querySelector<HTMLElement>('#challenge-stage button[type="submit"], .challenge-button');
      if (btn) {
        btn.click();
        return;
      }

      window.location.reload();
    }, token);

    return true;
  } catch (err) {
    log.warning(`Failed to inject token: ${err instanceof Error ? err.message : String(err)}`);
    return false;
  }
}

export async function solveTurnstileChallenge(
  apiKey: string,
  url: string,
  page: Page,
): Promise<boolean> {
  log.info('Attempting to solve Cloudflare Turnstile via Capsolver');

  const siteKey = await extractTurnstileSiteKey(page);
  if (!siteKey) {
    log.warning('Could not find Turnstile sitekey on page');
    return false;
  }

  log.info(`Found Turnstile sitekey: ${siteKey.substring(0, 20)}...`);

  const taskId = await createTurnstileTask(apiKey, url, siteKey);
  if (!taskId) {
    log.warning('Failed to create Capsolver task');
    return false;
  }

  log.info(`Capsolver task created: ${taskId}`);

  const token = await getTurnstileToken(apiKey, taskId);
  if (!token) {
    log.warning('Failed to get Turnstile solution from Capsolver');
    return false;
  }

  log.info(`Got Turnstile token (${token.substring(0, 20)}...), injecting into page`);

  await injectTurnstileTokenAndSubmit(page, token);

  try {
    await page.waitForNavigation({ timeout: 30000 });
  } catch {
    await page.waitForLoadState('domcontentloaded', { timeout: 10000 }).catch(() => {});
  }

  const status = page.url().includes('crunchbase.com/organization/') ? 'redirected' : 'same page';
  log.info(`Turnstile challenge result: ${status}`);

  return true;
}
