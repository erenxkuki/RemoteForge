export class AgentClient {
  constructor(private serverUrl: string, private token?: string | null) {}

  setToken(t: string | null) {
    this.token = t;
  }

  private headers(extra?: Record<string, string>): Record<string, string> {
    const h: Record<string, string> = { "Content-Type": "application/json", ...(extra ?? {}) };
    if (this.token) h.Authorization = `Bearer ${this.token}`;
    return h;
  }

  async request(method: string, path: string, body?: unknown, extraHeaders?: Record<string, string>): Promise<any> {
    const url = this.serverUrl.replace(/\/$/, "") + path;
    const res = await fetch(url, {
      method,
      headers: this.headers(extraHeaders),
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let data: any = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    if (!res.ok) {
      const err: any = new Error(data?.message ?? `HTTP ${res.status}`);
      err.status = res.status;
      err.data = data;
      throw err;
    }
    return data;
  }
}