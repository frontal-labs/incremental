import { withRateLimit } from "@/lib/rate-limit";

export const json = <T>(body: T, init: ResponseInit = {}): Response => {
	const headers = new Headers(init.headers);
	headers.set("Content-Type", "application/json; charset=utf-8");

	return new Response(JSON.stringify(body), {
		...init,
		headers,
	});
};

export async function api(
	request: Request,
	handler: () => Promise<Response> | Response,
): Promise<Response> {
	if (request.method === "OPTIONS") {
		return new Response(null, { status: 204 });
	}

	return withRateLimit(() => handler())(request);
}
