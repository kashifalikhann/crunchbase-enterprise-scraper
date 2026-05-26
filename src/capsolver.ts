import { CAPSOLVER_API_URL, CAPSOLVER_POLL_INTERVAL, CAPSOLVER_MAX_POLL_TIME, CAPSOLVER_MIN_SCORE } from './constants.js';
import { httpFetch } from './utils.js';

export interface CapSolverSolution {
  cookies: Array<{ name: string; value: string }>;
  userAgent: string;
}

interface CapSolverTaskResult {
  errorId: number;
  errorCode?: string;
  errorDescription?: string;
  status?: 'ready' | 'processing';
  solution?: {
    cookies?: Array<{ name: string; value: string }>;
    userAgent?: string;
    resp?: string;
  };
  taskId?: string;
}

async function createAntiCloudflareTask(
  clientKey: string,
  websiteURL: string,
  proxy?: string,
  userAgent?: string,
): Promise<string> {
  const body: Record<string, any> = {
    clientKey,
    task: {
      type: 'AntiCloudflareTask',
      websiteURL,
    },
  };

  if (proxy) body.task.proxy = proxy;
  if (userAgent) body.task.userAgent = userAgent;

  const resp = await httpFetch(`${CAPSOLVER_API_URL}/createTask`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`CapSolver createTask failed: ${resp.status} ${text}`);
  }

  const json: CapSolverTaskResult = await resp.json();
  if (json.errorId !== 0) {
    throw new Error(`CapSolver error: ${json.errorCode} — ${json.errorDescription}`);
  }

  return json.taskId!;
}

async function pollTaskResult(clientKey: string, taskId: string): Promise<CapSolverSolution> {
  const startTime = Date.now();

  while (Date.now() - startTime < CAPSOLVER_MAX_POLL_TIME) {
    const resp = await httpFetch(`${CAPSOLVER_API_URL}/getTaskResult`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientKey, taskId }),
    });

    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`CapSolver poll failed: ${resp.status} ${text}`);
    }

    const json: CapSolverTaskResult = await resp.json();
    if (json.errorId !== 0) {
      throw new Error(`CapSolver poll error: ${json.errorCode} — ${json.errorDescription}`);
    }

    if (json.status === 'ready' && json.solution) {
      const solution = json.solution;
      if (solution.cookies && solution.cookies.length > 0) {
        return {
          cookies: solution.cookies,
          userAgent: solution.userAgent || '',
        };
      }
      if (solution.resp) {
        const parsed = parseRespCookies(solution.resp);
        if (parsed.cookies.length > 0) {
          return { cookies: parsed.cookies, userAgent: parsed.userAgent || solution.userAgent || '' };
        }
      }
    }

    await new Promise(r => setTimeout(r, CAPSOLVER_POLL_INTERVAL));
  }

  throw new Error(`CapSolver task did not complete within ${CAPSOLVER_MAX_POLL_TIME / 1000}s`);
}

function parseRespCookies(resp: string): { cookies: Array<{ name: string; value: string }>; userAgent?: string } {
  const cookies: Array<{ name: string; value: string }> = [];
  let userAgent: string | undefined;

  for (const line of resp.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (trimmed.startsWith('#') || trimmed.startsWith('!')) {
      const uaMatch = trimmed.match(/user-agent:\s*(.+)/i);
      if (uaMatch) userAgent = uaMatch[1].trim();
      continue;
    }
    const parts = trimmed.split('\t');
    if (parts.length >= 6) {
      cookies.push({ name: parts[4]?.trim(), value: parts[5]?.trim() });
    }
  }

  return { cookies, userAgent };
}

export function cookiesToRecord(cookies: Array<{ name: string; value: string }>): Record<string, string> {
  const record: Record<string, string> = {};
  for (const c of cookies) {
    record[c.name] = c.value;
  }
  return record;
}

export async function solveCloudflare(
  clientKey: string,
  websiteURL: string,
  proxy?: string,
  userAgent?: string,
): Promise<{ cookies: Record<string, string>; userAgent: string }> {
  const taskId = await createAntiCloudflareTask(clientKey, websiteURL, proxy, userAgent);
  const solution = await pollTaskResult(clientKey, taskId);

  const cookies = cookiesToRecord(solution.cookies);
  const ua = solution.userAgent || userAgent || '';

  return { cookies, userAgent: ua };
}
