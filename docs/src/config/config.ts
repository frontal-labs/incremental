import { z } from "zod";

import { env } from "@/config/env";

const origin = z
  .string()
  .url()
  .transform((value) => value.replace(/\/+$/, ""));

export const siteUrls = z
  .object({
    app: origin,
    auth: origin,
    avatar: origin,
    cdn: origin,
    community: origin,
    status: origin,
    studio: origin,
    support: origin,
    website: origin,
  })
  .parse({
    app: env.NEXT_PUBLIC_APP_URL,
    auth: env.NEXT_PUBLIC_AUTH_URL,
    avatar: env.NEXT_PUBLIC_AVATAR_URL,
    cdn: env.NEXT_PUBLIC_CDN_URL,
    community: env.NEXT_PUBLIC_COMMUNITY_URL,
    status: env.NEXT_PUBLIC_STATUS_PAGE_URL,
    studio: env.NEXT_PUBLIC_STUDIO_URL,
    support: env.NEXT_PUBLIC_SUPPORT_URL,
    website: env.NEXT_PUBLIC_URL,
  });

const joinUrl = (base: string, path?: string): string => {
  if (!path) {
    return base;
  }

  return `${base}/${path.replace(/^\/+/, "")}`;
};

export const cdnUrl = (path?: string): string => joinUrl(siteUrls.cdn, path);

export const siteRoutes = {
  home: "/",
} as const;

export const siteConfig = {
  name: "Incremental Docs",
  publisher: "Incremental Labs",
  siteId: "docs",
  social: {
    github: "https://github.com/incremental-labs/incremental",
    linkedin: "https://linkedin.com/company/incremental-labs",
    x: "https://x.com/incremental_dev",
    youtube: "https://youtube.com/@incremental-labs",
  },
  twitterCreator: "@incremental_dev",
  twitterSite: "@incremental_dev",
} as const;
