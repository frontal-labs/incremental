import { cdnUrl, siteUrls } from "@/config/config";

/**
 * Cloudflare transformation endpoints, both served from the CDN zone:
 * `https://<zone>/cdn-cgi/image/<options>/<source>` for images and
 * `https://<zone>/cdn-cgi/media/<options>/<source>` for video.
 *
 * @see https://developers.cloudflare.com/images/transform-images/
 * @see https://developers.cloudflare.com/stream/transform-videos/
 */
const CLOUDFLARE_IMAGE_ENDPOINT = "cdn-cgi/image";
const CLOUDFLARE_MEDIA_ENDPOINT = "cdn-cgi/media";

interface CdnVideoOptions {
	/** Seconds of video to serve, e.g. `"5s"`. */
	duration?: string;
	height?: number;
	/** Start offset, e.g. `"2s"`. */
	time?: string;
	width?: number;
}

const serializeOptions = (options: CdnVideoOptions): string =>
	Object.entries(options)
		.filter(([, value]) => value !== undefined)
		.map(([key, value]) => `${key}=${value}`)
		.join(",");

/** Resolves a CDN-relative path; absolute URLs are used as-is. */
const resolveSource = (source: string): string =>
	source.startsWith("http") ? source : cdnUrl(source);

/**
 * Whether a URL already carries a Cloudflare transformation. Nesting one
 * transform inside another produces a URL Cloudflare cannot resolve.
 */
const hasCloudflareTransform = (url: string): boolean =>
	url.includes(`/${CLOUDFLARE_IMAGE_ENDPOINT}/`) ||
	url.includes(`/${CLOUDFLARE_MEDIA_ENDPOINT}/`);

/**
 * Resolves a CDN-relative asset path against the CDN origin. Content assets
 * are authored CDN-relative (e.g. `/images/...`), but the schema also allows
 * a fully qualified URL — those pass through unchanged. A raw relative path
 * must never reach the browser directly, where it would resolve against the
 * page origin instead of the CDN.
 */
export const assetUrl = (path: string): string =>
	URL.canParse(path) ? path : cdnUrl(path);

/**
 * Absolute URL for a CDN-hosted video. Without options the file is served
 * directly; with options it is routed through Cloudflare media transformations.
 */
export const cdnVideoUrl = (
	source: string,
	options: CdnVideoOptions = {},
): string => {
	const target = resolveSource(source);
	const serialized = serializeOptions(options);

	if (!serialized || hasCloudflareTransform(target)) {
		return target;
	}

	return `${siteUrls.cdn}/${CLOUDFLARE_MEDIA_ENDPOINT}/${serialized}/${target}`;
};

/**
 * A still frame extracted from a video, as a real image.
 *
 * The hero previously passed the `.mp4` straight into an image component as its
 * poster. That element is the page's LCP candidate, so the browser was being
 * asked to decode a video file as an image — it never paints, and the largest
 * contentful paint falls back to whatever renders next.
 *
 * @see https://developers.cloudflare.com/stream/transform-videos/#fetch-a-still-image-from-a-video
 */
export const cdnVideoPosterUrl = (
	source: string,
	options: Omit<CdnVideoOptions, "duration"> = {},
): string => {
	const target = resolveSource(source);

	if (hasCloudflareTransform(target)) {
		return target;
	}

	const serialized = serializeOptions({
		time: "0s",
		...options,
	});

	return `${siteUrls.cdn}/${CLOUDFLARE_MEDIA_ENDPOINT}/${serialized},mode=frame,format=jpg/${target}`;
};
