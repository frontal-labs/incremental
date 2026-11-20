import { Ratelimit, type RatelimitConfig } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";
import { siteConfig } from "@/config/config";
import { env } from "@/config/env";
import { log } from "@/lib/log";

// Create a rate limiter with Upstash
const createLimiter = (props: Omit<RatelimitConfig, "redis">) =>
	new Ratelimit({
		limiter: props.limiter ?? Ratelimit.slidingWindow(10, "10 s"),
		prefix: props.prefix ?? siteConfig.siteId,
		redis: new Redis({
			token: env.UPSTASH_REDIS_REST_TOKEN,
			url: env.UPSTASH_REDIS_REST_URL,
		}),
	});

const { slidingWindow } = Ratelimit;

const API_RATE_LIMIT_MAX_REQUESTS = env.RATE_LIMIT_REQUESTS_PER_MINUTE;
const API_RATE_LIMIT_WINDOW = "1 m";
const API_RATE_LIMIT_PREFIX = `${siteConfig.siteId}:api`;

const apiLimiter =
	env.UPSTASH_REDIS_REST_URL && env.UPSTASH_REDIS_REST_TOKEN
		? createLimiter({
				limiter: slidingWindow(
					API_RATE_LIMIT_MAX_REQUESTS,
					API_RATE_LIMIT_WINDOW,
				),
				prefix: API_RATE_LIMIT_PREFIX,
			})
		: null;

/** Resolve the client address from forwarded request headers. */
const clientAddress = (headers: Headers): string => {
	const cfConnectingIp = headers.get("cf-connecting-ip")?.trim();
	const flyClientIp = headers.get("fly-client-ip")?.trim();
	const realIp = headers.get("x-real-ip")?.trim();
	const forwarded = headers.get("x-forwarded-for")?.split(",")[0]?.trim();

	return cfConnectingIp || flyClientIp || realIp || forwarded || "anonymous";
};

const getApiRateLimitIdentifier = (request: Request): string => {
	const normalizedPath = new URL(request.url).pathname
		.replace(/\/[0-9a-f]{32,}/g, "/:id")
		.replace(/\/\d+/g, "/:num");
	return [request.method, normalizedPath, clientAddress(request.headers)].join(
		":",
	);
};

const limit = async (request: Request): Promise<Response | undefined> => {
	if (!env.RATE_LIMIT_ENABLED) {
		return;
	}

	if (!apiLimiter) {
		return;
	}

	try {
		const result = await apiLimiter.limit(getApiRateLimitIdentifier(request));
		if (result.success) {
			return;
		}

		const retryAfterSeconds = Math.max(
			1,
			Math.ceil((result.reset - Date.now()) / 1000),
		);
		const response = new Response(
			JSON.stringify({ error: "Too many requests", success: false }),
			{
				headers: { "Content-Type": "application/json; charset=utf-8" },
				status: 429,
			},
		);

		response.headers.set("Retry-After", String(retryAfterSeconds));
		response.headers.set("X-RateLimit-Limit", String(result.limit));
		response.headers.set("X-RateLimit-Remaining", String(result.remaining));
		response.headers.set("X-RateLimit-Reset", String(result.reset));

		return response;
	} catch (error) {
		log.error("Rate limiter error", { error });
	}
};

type ApiHandler<TArgs extends [Request, ...unknown[]]> = (
	...args: TArgs
) => Response | Promise<Response>;

/** Protect an API handler without repeating the 429 response boilerplate. */
export const withRateLimit =
	<TArgs extends [Request, ...unknown[]]>(handler: ApiHandler<TArgs>) =>
	async (...args: TArgs): Promise<Response> => {
		const blocked = await limit(args[0]);
		return blocked ?? handler(...args);
	};
