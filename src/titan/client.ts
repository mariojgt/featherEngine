/** Typed REST adapter for the same Titan endpoints used by the Unreal plugin. No secret keys. */
export interface TitanSettings { baseUrl: string; gameKey: string }
export class TitanError extends Error {
  constructor(message: string, readonly status: number, readonly code?: string) { super(message); this.name = 'TitanError'; }
}
export function validateHttpUrl(raw: string): string {
  const url = new URL(raw.trim());
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error('Use an HTTP(S) URL without credentials, query, or fragment.');
  if (url.protocol === 'http:' && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) throw new Error('Use HTTPS for remote servers. HTTP is supported on localhost.');
  return url.toString().replace(/\/+$/, '');
}
export class TitanClient {
  private token = '';
  readonly baseUrl: string;
  // Browser fetch needs its global receiver even when invoked through a client instance.
  constructor(private settings: TitanSettings, private fetcher: typeof fetch = globalThis.fetch.bind(globalThis)) {
    this.baseUrl = `${validateHttpUrl(settings.baseUrl).replace(/\/functions\/v1$/, '')}/functions/v1`;
    if (!settings.gameKey.trim()) throw new Error('Enter the game key from your Titan project.');
    if (/^(sb_secret_|service_role)/i.test(settings.gameKey)) throw new Error('Use a Titan game key, never a Supabase secret.');
  }
  setPlayerToken(token: string) { this.token = token; }
  logout() { this.token = ''; }
  async request<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
    if (!/^game-[a-z-]+(?:\/[a-zA-Z0-9_.%~-]+)*$/.test(path)) throw new Error('Invalid Titan endpoint.');
    const controller = new AbortController(); const timeout = setTimeout(() => controller.abort(), 10000);
    try {
      const response = await this.fetcher(`${this.baseUrl}/${path}`, { method, signal: controller.signal,
        headers: { 'Content-Type': 'application/json', 'X-Game-Key': this.settings.gameKey,
          ...(this.token ? { 'X-Player-Token': this.token, Authorization: `Bearer ${this.token}` } : {}) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      const data = await response.json();
      if (!response.ok) throw new TitanError(data.message ?? `Titan request failed (${response.status})`, response.status, data.error);
      return data as T;
    } finally { clearTimeout(timeout); }
  }
  async login(email: string, password: string) { return this.authenticate('login', { email, password }); }
  async register(email: string, password: string, displayName: string) { return this.authenticate('register', { email, password, display_name: displayName }); }
  async anonymous(resume?: string) { return this.authenticate('anonymous', resume ? { uuid: resume } : {}); }
  private async authenticate(action: string, body: unknown) {
    const result = await this.request<{ token: string; player: { uuid: string; display_name?: string } }>(`game-auth/${action}`, 'POST', body);
    if (typeof result.token !== 'string' || !result.token) throw new Error('Titan returned no player token.');
    this.token = result.token; return result;
  }
  me() { return this.request('game-auth/me'); }
  ping() { return this.request('game-server/ping'); }
  /** Ping is public. Config authenticates the game key without creating a player. */
  async checkConnection() {
    const result = await this.request<{ configs: unknown[] }>('game-config');
    if (!Array.isArray(result?.configs)) throw new Error('This URL did not return a Titan project configuration. Check the API base URL.');
  }
  inventory() { return this.request('game-inventory/items'); }
  wallets() { return this.request('game-inventory/currencies'); }
  quests() { return this.request('game-quests'); }
  config() { return this.request('game-config'); }
  async load<T>(slot: string): Promise<T> {
    const result = await this.request<{ data: string | T }>(`game-saves/${encodeURIComponent(slot)}`);
    return typeof result.data === 'string' ? JSON.parse(result.data) as T : result.data;
  }
  save(slot: string, data: unknown) { return this.request(`game-saves/${encodeURIComponent(slot)}`, 'PUT', { data }); }
}
