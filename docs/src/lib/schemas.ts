import { metaSchema, pageSchema } from "fumadocs-core/source/schema";
import { z } from "zod";
import { LOCALE_CODES } from "./locales.ts";

const CONTENT_LIMITS = {
  description: 160,
  keywords: 8,
  productAreas: 8,
  tags: 6,
  title: 80,
} as const;

const CONTENT_REGIONS = [
  "global",
  "europe",
  "north-america",
  "latin-america",
  "asia-pacific",
  "middle-east-africa",
] as const;

// Primitive content validators.
const text = z.string().trim().min(1);

// Metadata field validators.
const title = text
  .max(CONTENT_LIMITS.title)
  .describe("A concise, human-readable page title.");
const description = text
  .max(CONTENT_LIMITS.description)
  .describe("A concise summary used in search and social metadata.");
const tags = z
  .array(text)
  .min(1)
  .max(CONTENT_LIMITS.tags)
  .describe("One to six topical labels used for filtering and discovery.");
const keywords = z
  .array(text)
  .min(1)
  .max(CONTENT_LIMITS.keywords)
  .describe("Search phrases that describe the page's subject.");
const date = z.iso
  .date()
  .describe("An ISO 8601 calendar date in YYYY-MM-DD format.");
const asset = text
  .refine(
    (value) => value.startsWith("/") || URL.canParse(value),
    "Expected a site-relative path or absolute URL"
  )
  .describe("A site-relative asset path or absolute URL.");
const externalUrl = z
  .url()
  .refine(
    (value) => new URL(value).protocol.startsWith("http"),
    "Expected an HTTP(S) URL"
  )
  .describe("A fully qualified HTTP(S) URL.");
const socialImage = asset.describe(
  "The image used when this page is shared on social platforms."
);
const socialImageAlt = text
  .max(125)
  .describe("Accessible text describing the social sharing image.");
const videoAlt = text
  .max(125)
  .describe("Accessible text describing the cover video.");
const featuredContent = z
  .boolean()
  .default(false)
  .describe("Whether to prioritize this entry in featured content.");

// Shared list and publication validators.
const list = (fieldDescription: string, max: number = CONTENT_LIMITS.tags) =>
  z.array(text).min(1).max(max).describe(fieldDescription);

const publicationFields = {
  contentOwner: text
    .optional()
    .describe("The person or team responsible for factual accuracy."),
  evidence: z
    .array(text)
    .max(10)
    .optional()
    .describe(
      "Approved internal source references supporting publishable factual claims."
    ),
  fallbackLocale: z
    .enum(LOCALE_CODES)
    .default("en")
    .describe("The locale to use when a requested translation is unavailable."),
  locale: z
    .enum(LOCALE_CODES)
    .default("en")
    .describe("The locale of this content variant."),
  publishAt: z.iso
    .datetime()
    .optional()
    .describe("The UTC instant when this entry becomes eligible to publish."),
  published: z
    .boolean()
    .default(true)
    .describe("Whether this entry is eligible to appear publicly."),
  publishRegions: z
    .array(z.enum(CONTENT_REGIONS))
    .min(1)
    .default(["global"])
    .describe(
      "Regions where this entry may be shown; global makes it available everywhere."
    ),
  relatedPages: z
    .array(text.regex(/^\//, "Expected an internal route beginning with /"))
    .max(6)
    .optional()
    .describe("Related internal pages that provide a useful next step."),
  reviewAt: date
    .optional()
    .describe("The date this content must next be reviewed for accuracy."),
  unpublishAt: z.iso
    .datetime()
    .optional()
    .describe("The UTC instant after which this entry is hidden."),
  variantOf: text
    .optional()
    .describe("A stable content key shared by translations of the same entry."),
};

/** Navigation metadata for each Fumadocs collection. */
export const contentMetaSchema = metaSchema.extend({
  description: description.optional(),
  image: socialImage.optional(),
  imageAlt: socialImageAlt.optional(),
  title: title.optional(),
  ...publicationFields,
});

/** Shared validated frontmatter for all published Fumadocs pages. */
const contentPageSchema = pageSchema
  .extend({
    canonicalUrl: externalUrl
      .optional()
      .describe("The preferred public URL when this page is syndicated."),
    description,
    image: socialImage.optional(),
    imageAlt: socialImageAlt.optional(),
    keywords,
    noindex: z
      .boolean()
      .default(false)
      .describe("Whether search engines should exclude this page."),
    title,
    ...publicationFields,
  })
  .refine(
    (page) => Boolean(page.image) === Boolean(page.imageAlt),
    "image and imageAlt must be provided together"
  );

/** Job listings shown on the careers pages. */
export const careerSchema = contentPageSchema.safeExtend({
  applicationStatus: z
    .enum(["Open", "Paused", "Closed"])
    .describe("Whether the role is accepting applications."),
  closesAt: date
    .optional()
    .describe("The final application date, if one exists."),
  department: text.describe("The team responsible for the role."),
  employmentUrl: externalUrl
    .optional()
    .describe("The external application URL, when applications are open."),
  hiringRegions: list("Regions in which the company can hire for the role."),
  location: text.describe("The primary location or hiring region."),
  publishedAt: date.describe("The date the role was published."),
  tags,
  type: z
    .enum(["Full-time", "Part-time", "Contract", "Internship", "Temporary"])
    .describe("The employment arrangement."),
});

/** Editorial articles and company announcements. */
export const articleSchema = contentPageSchema
  .safeExtend({
    audience: z
      .enum(["Technical", "Business", "General"])
      .describe("The intended primary audience."),
    authors: z
      .array(text)
      .min(1)
      .describe("The people or team credited for the article."),
    category: text.describe("The editorial category."),
    featured: featuredContent,
    publishedAt: date.describe("The original publication date."),
    readingTime: z
      .number()
      .int()
      .positive()
      .describe("Estimated reading time in whole minutes."),
    reviewedAt: date.describe(
      "The date the article was last reviewed for accuracy."
    ),
    showCover: z
      .boolean()
      .default(false)
      .describe("Whether to render the cover image or video on the article."),
    tags,
    takeaways: list(
      "The key points a reader should take away from the article."
    ),
    updatedAt: date
      .optional()
      .describe("The most recent substantive update date."),
    video: asset
      .optional()
      .describe(
        "A looping video used as the article's lead visual; image acts as its poster and social fallback."
      ),
    videoAlt: videoAlt
      .optional()
      .describe("Accessible text describing the cover video."),
  })
  .refine(
    (article) => Boolean(article.image) || Boolean(article.video),
    "Either image or video must be provided for article cover"
  )
  .refine(
    (article) => Boolean(article.video) === Boolean(article.videoAlt),
    "video and videoAlt must be provided together"
  );

/**
 * Product documentation pages.
 *
 * Ordering and grouping are not frontmatter here: the page tree comes from the
 * `meta.json` files Fumadocs reads, which is what lets a section be reordered
 * without touching a single page. Everything below is metadata the tree cannot
 * carry.
 */
export const docsSchema = contentPageSchema.safeExtend({
  featured: featuredContent,
  /**
   * The card glyph, named rather than imported: frontmatter cannot hold a
   * component, and `src/components/icons.tsx` resolves the name to a lucide
   * icon.
   */
  icon: text
    .optional()
    .describe("A key in OSS_ICONS; the card falls back to a generic glyph."),
  /** Shown as a chip beside the title, for pages that are not yet stable. */
  stage: z
    .enum(["Stable", "Beta", "Preview", "Experimental"])
    .default("Stable")
    .describe("The maturity of the feature the page documents."),
  tags: tags.optional(),
  updatedAt: date
    .optional()
    .describe("The most recent substantive update date."),
});

/** Customer outcomes and case studies. */
export const storySchema = contentPageSchema.safeExtend({
  company: text.describe("The customer or organization featured in the story."),
  companyUrl: externalUrl.optional().describe("The customer's public website."),
  customerSize: z
    .enum(["1-50", "51-200", "201-1,000", "1,001+"])
    .describe("The customer's approximate employee range."),
  featured: featuredContent,
  heroImage: asset.optional().describe("The story's primary visual."),
  industry: text.describe("The customer's industry."),
  logo: asset.optional().describe("The customer's logo."),
  outcomes: list(
    "The measurable or operational outcomes highlighted in the story."
  ),
  publishedAt: date.describe("The date the story was published."),
  quote: text.optional().describe("A representative customer quote."),
  tags,
  useCase: text.describe(
    "The primary workflow or use case described by the story."
  ),
});

/** Press releases and other news items. */
export const newsSchema = contentPageSchema
  .safeExtend({
    audience: z
      .enum(["Customers", "Partners", "Press", "Public"])
      .describe("The primary audience for the announcement."),
    availability: z
      .enum(["Available", "Limited availability", "Planned"])
      .describe("The availability of the announced item."),
    featured: featuredContent,
    kind: z
      .enum(["Announcement", "Press release", "Media coverage", "Event"])
      .describe("The news entry type."),
    location: text.describe("The place associated with the news item."),
    publishedAt: date.describe("The date the item was published."),
    showCover: z
      .boolean()
      .default(false)
      .describe("Whether to render the cover image or video on the news item."),
    sourceUrl: externalUrl
      .optional()
      .describe("The original source for external coverage."),
    tags,
    video: asset
      .optional()
      .describe(
        "A looping video used as the news item's lead visual; image acts as its poster and social fallback."
      ),
    videoAlt: videoAlt
      .optional()
      .describe("Accessible text describing the cover video."),
  })
  .refine(
    (news) => Boolean(news.image) || Boolean(news.video),
    "Either image or video must be provided for news cover"
  )
  .refine(
    (news) => Boolean(news.video) === Boolean(news.videoAlt),
    "video and videoAlt must be provided together"
  );

/** Legal, security, and policy documents. */
export const documentSchema = contentPageSchema.safeExtend({
  changeSummary: text
    .optional()
    .describe(
      "One line describing what changed. Required for non-initial versions."
    ),
  effectiveAt: date.describe("The date this version becomes effective."),
  jurisdiction: text.describe("The geographic or legal scope of the document."),
  materialChange: z
    .boolean()
    .default(false)
    .describe(
      "Whether this version contains a material change that triggers notices."
    ),
  owner: text.describe("The team accountable for maintaining the document."),
  reviewAt: date.describe("The next scheduled review date."),
  supersedes: text
    .optional()
    .describe(
      "The version this one replaces. Defaults to the next-lower effectiveAt."
    ),
  type: z
    .enum(["Legal", "Policy", "Security", "Compliance", "Technical"])
    .describe("The document classification."),
  updatedAt: date
    .optional()
    .describe("The most recent substantive update date."),
  variantOf: text.describe(
    "A stable content key shared by translations of the same entry."
  ),
  version: text.describe("The publisher-assigned document version."),
});

/**
 * Research index entries.
 *
 * The `/research` page is a curated index of research documents rather than an
 * aggregation of the existing collections. Each entry declares its own `kind`,
 * which is what the page's tab filter reads.
 *
 * Where an entry points is owned by `content/research/meta.json`'s `redirects`
 * map, not by this schema.
 */
export const RESEARCH_KINDS = [
  "Publication",
  "Conclusion",
  "Milestone",
  "Release",
] as const satisfies readonly string[];

export const researchSchema = contentPageSchema.safeExtend({
  authors: z
    .array(text)
    .min(1)
    .describe("The people or team credited for the research entry."),
  category: text.describe("The editorial category."),
  kind: z
    .enum(RESEARCH_KINDS)
    .describe("The research entry type, shown as the tab filter's categories."),
  publishedAt: date.describe("The date this entry was published or recorded."),
  tags,
});

/** Product release notes. */
export const releaseSchema = contentPageSchema
  .safeExtend({
    authors: z
      .array(text)
      .min(1)
      .describe("The people or team credited for the release notes."),
    availability: z
      .enum(["General availability", "Beta", "Preview"])
      .describe("The release availability stage."),
    breaking: z
      .boolean()
      .default(false)
      .describe("Whether the release includes breaking changes."),
    category: text.describe("The editorial category shown in the breadcrumb."),
    featured: featuredContent,
    productAreas: list(
      "Product areas affected by this release.",
      CONTENT_LIMITS.productAreas
    ),
    publishedAt: date.describe("The date this release became available."),
    readingTime: z
      .number()
      .int()
      .positive()
      .describe("Estimated reading time in whole minutes."),
    release: z
      .enum(["Major", "Minor", "Patch", "Security"])
      .describe("The release classification."),
    reviewedAt: date
      .optional()
      .describe("The date the release notes were last reviewed for accuracy."),
    showCover: z
      .boolean()
      .default(false)
      .describe(
        "Whether to render the cover image or video on the release notes."
      ),
    tags,
    updatedAt: date
      .optional()
      .describe("The most recent substantive update date."),
    upgradeRequired: z
      .boolean()
      .default(false)
      .describe("Whether customers must take action to adopt the release."),
    version: text.describe("The product version released."),
    video: asset
      .optional()
      .describe(
        "A looping video used as the release's lead visual; image acts as its poster and social fallback."
      ),
    videoAlt: videoAlt
      .optional()
      .describe("Accessible text describing the cover video."),
  })
  .refine(
    (release) => Boolean(release.image) || Boolean(release.video),
    "Either image or video must be provided for release cover"
  )
  .refine(
    (release) => Boolean(release.video) === Boolean(release.videoAlt),
    "video and videoAlt must be provided together"
  );
