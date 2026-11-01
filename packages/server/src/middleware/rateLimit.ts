import type { FastifyRequest, FastifyReply } from "fastify";

interface Bucket {
  count: number;
  resetAt: number;
}

export interface RateLimitOptions {
  windowMs: number;
  max: number;
  keyFn?: (req: FastifyRequest) => string;
}

export function createRateLimiter(opts: RateLimitOptions) {
  const buckets = new Map<string, Bucket>();
  const keyFn = opts.keyFn ?? ((req) => req.ip);
  return async function rateLimit(req: FastifyRequest, reply: FastifyReply): Promise<void> {
    const key = keyFn(req);
    const now = Date.now();
    let b = buckets.get(key);
    if (!b || b.resetAt <= now) {
      b = { count: 0, resetAt: now + opts.windowMs };
      buckets.set(key, b);
    }
    b.count += 1;
    reply.header("X-RateLimit-Limit", opts.max);
    reply.header("X-RateLimit-Remaining", Math.max(0, opts.max - b.count));
    reply.header("X-RateLimit-Reset", Math.ceil(b.resetAt / 1000));
    if (b.count > opts.max) {
      reply.code(429).send({ code: "RATE_LIMITED", message: "Too many requests" });
      throw new Error("RATE_LIMITED");
    }
  };
}