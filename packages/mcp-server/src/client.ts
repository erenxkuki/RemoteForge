export class RFClient {
  constructor(private serverUrl: string, private token?: string) {}
  setToken(t: string) { this.token = t; }
  getToken() { return this.token; }
  private headers() {
    const h: Record<string, string> = { "Content-Type": "application/json" };
    if (this.token) h.Authorization = `Bearer ${this.token}`;
    return h;
  }
  async request(method: string, path: string, body?: any): Promise<any> {
    const url = this.serverUrl.replace(/\/$/, "") + path;
    const res = await fetch(url, { method, headers: this.headers(), body: body !== undefined ? JSON.stringify(body) : undefined });
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
  async pollJob(jobId: string, timeoutMs = 300000): Promise<any> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const j = await this.request("GET", `/api/jobs/${jobId}`);
      if (j.status !== "pending" && j.status !== "running") return j;
      await new Promise((r) => setTimeout(r, 1000));
    }
    throw new Error("Job timed out");
  }
}