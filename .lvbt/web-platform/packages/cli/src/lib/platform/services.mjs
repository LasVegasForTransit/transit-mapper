import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * The outside world the platform command talks to, behind small interfaces
 * so tests replace them: a command runner, the Cloudflare API, and DNS. Secret
 * values only ever travel on a child process's stdin or in a request body.
 */

/** Run a command. `input` goes to stdin; `inherit` hands the terminal to it. */
export function runCommand(command, args, { cwd, env, input, inherit = false } = {}) {
  const result = spawnSync(command, args, {
    cwd,
    env: env ? { ...process.env, ...env } : process.env,
    input,
    encoding: 'utf8',
    stdio: inherit ? 'inherit' : ['pipe', 'pipe', 'pipe'],
    timeout: inherit ? undefined : 120_000,
  });
  return {
    status: result.status ?? 1,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
}

/** Replace a secret value anywhere in text that is about to be printed. */
export function redact(text, value) {
  return value ? text.split(value).join('[redacted]') : text;
}

/** Why a Cloudflare call failed, in terms the plan can act on. */
export function failureKind(status, errors = []) {
  const messages = errors.map((error) => `${error.code ?? ''} ${error.message ?? ''}`).join(' ');
  if (/not_enabled/.test(messages)) return 'not-enabled';
  if (
    status === 401 ||
    status === 403 ||
    errors.some((error) => [9109, 10000, 10001].includes(error.code))
  )
    return 'unauthorized';
  if (status === 404) return 'not-found';
  return 'error';
}

export class CloudflareError extends Error {
  constructor(kind, status, errors) {
    const detail = errors
      .map((error) => error.message)
      .filter(Boolean)
      .join('; ');
    super(`Cloudflare answered ${status}${detail ? `: ${detail}` : ''}`);
    this.kind = kind;
    this.status = status;
  }
}

/** A Cloudflare API client for one bearer token. */
export function cloudflareApi(token, request = fetch) {
  async function call(method, endpoint, body) {
    let response;
    try {
      response = await request(`https://api.cloudflare.com/client/v4/${endpoint}`, {
        method,
        redirect: 'error',
        headers: {
          Authorization: `Bearer ${token}`,
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(20_000),
      });
    } catch {
      throw new CloudflareError('error', 0, [{ message: 'the request failed or timed out' }]);
    }
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload.success === false) {
      const errors = payload.errors ?? [];
      throw new CloudflareError(failureKind(response.status, errors), response.status, errors);
    }
    return payload;
  }
  return {
    get: async (endpoint) => (await call('GET', endpoint)).result,
    post: async (endpoint, body) => (await call('POST', endpoint, body)).result,
    put: async (endpoint, body) => (await call('PUT', endpoint, body)).result,
    /**
     * Every page of a list endpoint. A resource missed on a later page would
     * look absent and be created a second time, so a list that cannot be read
     * to the end fails instead of returning what it has.
     */
    list: async (endpoint) => {
      const items = [];
      for (let page = 1; page <= MAX_PAGES; page += 1) {
        const separator = endpoint.includes('?') ? '&' : '?';
        const payload = await call(
          'GET',
          `${endpoint}${separator}page=${page}&per_page=${PER_PAGE}`,
        );
        const result = Array.isArray(payload.result) ? payload.result : [];
        if (payload.result_info?.page !== undefined && payload.result_info.page !== page)
          throw new CloudflareError('error', 0, [
            { message: `${endpoint} did not return page ${page}` },
          ]);
        items.push(...result);
        if (!morePages(payload.result_info, page, items.length, result.length)) return items;
      }
      throw new CloudflareError('error', 0, [
        { message: `${endpoint} has more than ${MAX_PAGES * PER_PAGE} entries` },
      ]);
    },
  };
}

const PER_PAGE = 50;
const MAX_PAGES = 100;

/**
 * Whether a list has another page. Cloudflare's list endpoints report their
 * size differently: some give total_pages, some only total_count, and some
 * nothing, in which case a full page means there may be more.
 */
export function morePages(info, page, seen, received) {
  if (received === 0) return false;
  if (info?.total_pages !== undefined) return page < info.total_pages;
  if (info?.total_count !== undefined) return seen < info.total_count;
  return received >= (info?.per_page ?? PER_PAGE);
}

/**
 * The token Wrangler signed in with, so reads need no extra credential.
 * Returns `{ token }`, or `{ reason }` saying why there is none.
 */
export function wranglerToken(run, cwd) {
  const result = run('pnpm', ['exec', 'wrangler', 'auth', 'token', '--json'], {
    cwd,
    env: { WRANGLER_SEND_METRICS: 'false' },
  });
  if (result.status === 0) {
    try {
      const parsed = JSON.parse(result.stdout.slice(result.stdout.indexOf('{')));
      if (typeof parsed.token === 'string' && parsed.token.length > 0)
        return { token: parsed.token };
    } catch {
      // Fall through to the explanation below.
    }
  }
  const said = `${result.stderr}\n${result.stdout}`
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !/^\[?WARN/.test(line));
  const hint = said.find((line) => /log ?in|authenticat|ERR_|error/i.test(line)) ?? said.at(-1);
  return {
    reason: `Wrangler has no credential here (${hint ?? 'pnpm exec wrangler auth token failed'}). Sign in with pnpm exec wrangler login.`,
  };
}

/** Public DNS answers through DNS over HTTPS, so checking records needs no credential. */
export function dnsResolver(request = fetch) {
  return async (name, type) => {
    const response = await request(
      `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(name)}&type=${type}`,
      { headers: { accept: 'application/dns-json' }, signal: AbortSignal.timeout(10_000) },
    );
    if (!response.ok) throw new Error(`DNS lookup answered ${response.status}`);
    const payload = await response.json();
    const code = { MX: 15, TXT: 16 }[type];
    return (payload.Answer ?? [])
      .filter((answer) => code === undefined || answer.type === code)
      .map((answer) => answer.data);
  };
}

/**
 * Things only a person can confirm, such as that a Google Group exists,
 * remembered on this computer so setup asks once. The file holds names and
 * dates, never a secret.
 */
export function confirmationFile(env = process.env) {
  const base = env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
  return path.join(base, 'lvbt', 'confirmations.json');
}

export function confirmationStore(file = confirmationFile()) {
  const load = () => {
    try {
      return JSON.parse(readFileSync(file, 'utf8'));
    } catch {
      return {};
    }
  };
  return {
    where: file,
    read: () => new Set(Object.keys(load())),
    add: (key) => {
      const current = load();
      if (key in current) return;
      current[key] = new Date().toISOString().slice(0, 10);
      mkdirSync(path.dirname(file), { recursive: true });
      writeFileSync(file, `${JSON.stringify(current, null, 2)}\n`);
    },
  };
}

/** A confirmation store that lives only for this process, for callers that pass none. */
export function memoryConfirmations() {
  const keys = new Set();
  return { where: 'memory', read: () => new Set(keys), add: (key) => keys.add(key) };
}
