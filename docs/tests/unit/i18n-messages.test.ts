import { describe, expect, it } from "vitest";

import { LOCALE_CODES, type Locale } from "@/lib/locales";
// Aliased with a `msg` prefix: the Italian catalogue would otherwise bind to
// `it` and collide with vitest's `it`.
import msgDe from "@/locales/de.json";
import msgEn from "@/locales/en.json";
import msgEs from "@/locales/es.json";
import msgFr from "@/locales/fr.json";
import msgIt from "@/locales/it.json";
import msgJa from "@/locales/ja.json";
import msgKo from "@/locales/ko.json";
import msgPt from "@/locales/pt.json";
import msgZh from "@/locales/zh.json";

/**
 * Message-catalogue integrity.
 *
 * Key parity alone is not enough — it was already perfect while `zh.json`
 * served Portuguese for a quarter of its values and `de.json` carried a
 * find/replace artefact (`…affiliates., Inc.`). These tests check the *values*
 * as well: right script, not accidentally another locale's text, and ICU
 * placeholders that match the English source.
 */

type MessageTree = Record<string, unknown>;

const CATALOGUES: Record<Locale, MessageTree> = {
  de: msgDe,
  en: msgEn,
  es: msgEs,
  fr: msgFr,
  it: msgIt,
  ja: msgJa,
  ko: msgKo,
  pt: msgPt,
  zh: msgZh,
};

const TRANSLATED_LOCALES = LOCALE_CODES.filter(
  (locale): locale is Exclude<Locale, "en"> => locale !== "en"
);

/** Flattens to dotted paths, e.g. `Header.features`. */
function flatten(tree: MessageTree, prefix = ""): Map<string, string> {
  const out = new Map<string, string>();

  for (const [key, value] of Object.entries(tree)) {
    const path = prefix ? `${prefix}.${key}` : key;

    if (typeof value === "string") {
      out.set(path, value);
    } else if (value && typeof value === "object") {
      for (const [nested, nestedValue] of flatten(value as MessageTree, path)) {
        out.set(nested, nestedValue);
      }
    }
  }

  return out;
}

const FLAT: Record<Locale, Map<string, string>> = Object.fromEntries(
  LOCALE_CODES.map((locale) => [locale, flatten(CATALOGUES[locale])])
) as Record<Locale, Map<string, string>>;

/** `{name}`, `{count, plural, …}` → the argument names a message expects. */
const PLACEHOLDER = /\{\s*([a-zA-Z0-9_]+)\s*[,}]/g;

const placeholdersOf = (message: string): string[] =>
  [...message.matchAll(PLACEHOLDER)]
    .map((match) => match[1] ?? "")
    .filter(Boolean)
    .sort();

/**
 * Scripts each CJK locale must actually be written in. Latin-only text in one
 * of these files is either untranslated English or, as happened here, another
 * locale's copy pasted in wholesale.
 */
const REQUIRED_SCRIPT: Partial<Record<Locale, RegExp>> = {
  ja: /[぀-ヿ一-鿿]/,
  ko: /[가-힯]/,
  zh: /[一-鿿]/,
};

/**
 * Proper nouns that stay in Latin script in every locale — third-party brand
 * names and Frontal's own product names. Exempt from the script check, which
 * otherwise flags them in ja/ko/zh.
 */
const LATIN_PROPER_NOUNS: ReadonlySet<string> = new Set([
  "Navigation.social.github",
  "Navigation.social.linkedin",
  "Navigation.social.youtube",
  "Navigation.tools.agent",
  // "Frontal Agent" — the product's name, not a description of it.
  "Products.pages.agent.ogTitle",
  // The eyebrow over each product hero is that product's name, so it is the
  // same word in every catalogue.
  "Products.pages.aiGateway.eyebrow",
  "Products.pages.ask.eyebrow",
  "Products.pages.benchmark.eyebrow",
  "Products.pages.cloud.eyebrow",
  "Products.pages.evaluation.eyebrow",
  "Products.pages.studio.eyebrow",
  // A programming language's name plus the "SDK" acronym. Japanese, Korean
  // and Chinese technical writing all leave both in Latin script.
  "SDKs.metaTitle",
  "SDKs.ogTitle",
  "SDKs.sdks.go.title",
  "SDKs.sdks.php.title",
  "SDKs.sdks.typescript.title",
  // Acronyms, a product name, and a list of third-party brands — Latin in
  // every locale.
  "CLI.ogTitle",
  "CLI.surfaces.api.title",
  "CLI.surfaces.chat.items.first",
  "CLI.surfaces.cli.title",
  // Brand names, the "AI" speaker label, and example placeholder values (a
  // person's name and an example address) — Latin in every locale.
  "Application.fields.github",
  "Application.fields.linkedin",
  "Application.fields.twitter",
  "Chat.roleAssistant",
  "ContactSales.fields.fullNamePlaceholder",
  "ContactSales.fields.workEmailPlaceholder",
  // The startups and enterprise forms reuse `ContactSales.fields` verbatim,
  // so they inherit the same two example placeholders.
  "EnterpriseContact.fields.fullNamePlaceholder",
  "EnterpriseContact.fields.workEmailPlaceholder",
  "PartnersContact.fields.fullNamePlaceholder",
  "PartnersContact.fields.workEmailPlaceholder",
  "StartupsContact.fields.fullNamePlaceholder",
  "StartupsContact.fields.workEmailPlaceholder",
  // Job-board brand names.
  "Application.options.referralSource.GitHub",
  "Application.options.referralSource.Indeed",
  "Application.options.referralSource.LinkedIn",
  "Application.options.referralSource.Twitter/X",
  // Security and support acronyms, identical in every locale.
  "Pricing.comparison.sections.accessSecurity.rows.rbac.label",
  "Pricing.comparison.sections.accessSecurity.rows.scim.label",
  "Pricing.comparison.sections.accessSecurity.rows.ssoSaml.label",
  "Pricing.comparison.sections.compliance.rows.sla.label",
]);

/**
 * How many values a locale may share with an unrelated one before it looks
 * like a copied catalogue rather than coincidence. The real incident shared
 * 60; genuine cognate overlap currently peaks at 4.
 */
const COINCIDENCE_LIMIT = 15;

/**
 * `locale:key` pairs whose translation is legitimately identical to English —
 * loanwords ("Runtime", "Marketplace", "Blog"), cognates (fr "Documentation",
 * it "Marketing") and brand names.
 *
 * This is a baseline, not an approval list: it records what was true when the
 * catalogues were audited so that *new* untranslated strings fail. Entries
 * should be deleted as copy is genuinely localised, never added to casually.
 */
const UNTRANSLATED_BASELINE: ReadonlySet<string> = new Set([
  // A lesson's length. "min" is the same abbreviation in these languages, and
  // spelling it out ("minutos", "minuti") is longer than the number it sits
  // beside in a sidebar row.
  "es:Learn.minutes",
  "fr:Learn.minutes",
  "it:Learn.minutes",
  "pt:Learn.minutes",
  "de:Agents.videos.governance.title",
  "de:Agents.videos.runtime.title",
  // "Frontal Benchmark" is the product name, not a description of it.
  "de:Products.pages.benchmark.ogTitle",
  "de:Products.pages.benchmark.title",
  "de:Blog.meta.title",
  "de:PartnersContact.fields.fullNamePlaceholder",
  "de:PartnersContact.fields.workEmailPlaceholder",
  "de:Products.pages.agent.ogTitle",
  // The eyebrow over each product hero is the product's own name, which is
  // written the same way in every catalogue.
  "de:Products.pages.aiGateway.eyebrow",
  "de:Products.pages.ask.eyebrow",
  "de:Products.pages.benchmark.eyebrow",
  "de:Products.pages.cloud.eyebrow",
  "de:Products.pages.evaluation.eyebrow",
  "de:Products.pages.studio.eyebrow",
  "de:Products.pages.plugins.ogTitle",
  "de:Download.desktop.title",
  "de:Download.terminal.title",
  "de:Features.observability.eyebrow",
  "de:Features.observability.ogTitle",
  "de:Features.runtime.eyebrow",
  "de:Features.runtime.ogTitle",
  "de:Features.workflows.eyebrow",
  "de:Features.workflows.ogTitle",
  "de:Navigation.ai.benchmark",
  "de:Navigation.company.mission.label",
  "de:Navigation.company.newsroom.label",
  "de:Navigation.company.openSource",
  "de:Navigation.developers.sdks",
  "de:Navigation.developers.status",
  "de:Navigation.features.runtime.label",
  "de:Navigation.features.workflows.label",
  "de:Navigation.products.cloud",
  "de:Navigation.products.dashboard",
  "de:Navigation.products.download",
  "de:Navigation.products.studio",
  "de:Navigation.resources.blog.label",
  "de:Navigation.resources.community.label",
  "de:Navigation.resources.computer.label",
  "de:Navigation.resources.sdks.label",
  "de:Navigation.resources.support",
  "de:Navigation.social.github",
  "de:Navigation.social.linkedin",
  "de:Navigation.social.youtube",
  "de:Navigation.solutions.marketing",
  "de:Navigation.tools.frameworks",
  "de:News.meta.title",
  "de:Products.pages.cloud.ogTitle",
  "de:Products.pages.studio.ogTitle",
  "de:Releases.meta.title",
  "de:Solutions.teams.engineering.eyebrow",
  "de:Solutions.teams.marketing.eyebrow",
  // Language names and the "SDK" acronym stay in Latin script.
  "de:SDKs.metaTitle",
  "de:SDKs.ogTitle",
  // Acronyms ("CLI", "API"), loanwords, brand lists, and "Frontal Computer".
  "de:CLI.badge",
  "de:CLI.ogTitle",
  "de:CLI.surfaces.api.title",
  "de:CLI.surfaces.chat.items.first",
  "de:CLI.surfaces.chat.title",
  "de:CLI.surfaces.cli.title",
  "de:CLI.surfaces.dashboard.title",
  // Brand names, example placeholder values, and cognates.
  "de:Application.fields.github",
  "de:Application.fields.linkedin",
  "de:Application.fields.portfolio",
  "de:Application.fields.twitter",
  "de:Application.sections.optional",
  "de:ContactSales.fields.fullNamePlaceholder",
  "de:EnterpriseContact.fields.fullNamePlaceholder",
  "de:StartupsContact.fields.fullNamePlaceholder",
  "de:ContactSales.fields.workEmailPlaceholder",
  "de:EnterpriseContact.fields.workEmailPlaceholder",
  "de:StartupsContact.fields.workEmailPlaceholder",
  "de:Marketplace.beta",
  "de:Marketplace.breadcrumb",
  // Job-board brand names; es/it "No" is genuinely the same word.
  "de:Application.options.referralSource.GitHub",
  "de:Application.options.referralSource.Indeed",
  "de:Application.options.referralSource.LinkedIn",
  "de:Application.options.referralSource.Twitter/X",
  // "Claude Code" is a product name.
  // Acronyms, loanwords and cognates in the pricing table.
  "de:Pricing.comparison.sections.accessSecurity.rows.rbac.label",
  "de:Pricing.comparison.sections.accessSecurity.rows.scim.label",
  "de:Pricing.comparison.sections.accessSecurity.rows.ssoSaml.label",
  "de:Pricing.comparison.sections.accessSecurity.rows.teams.label",
  "de:Pricing.comparison.sections.buildDeploy.rows.apis.label",
  "de:Pricing.comparison.sections.buildDeploy.rows.deployments.label",
  "de:Pricing.comparison.sections.buildDeploy.rows.rollbacks.label",
  "de:Pricing.comparison.sections.buildDeploy.rows.workspaces.label",
  "de:Pricing.comparison.sections.buildDeploy.title",
  "de:Pricing.comparison.sections.compliance.rows.sla.label",
  "de:Pricing.comparison.sections.compliance.title",
  "de:Pricing.comparison.sections.compute.rows.autoscaling.label",
  "de:Pricing.comparison.sections.compute.title",
  "de:Pricing.comparison.sections.intelligence.rows.benchmarks.label",
  "de:Pricing.comparison.sections.intelligence.rows.workflows.label",
  "de:Pricing.comparison.sections.observability.rows.dashboards.label",
  "de:Pricing.comparison.sections.observability.rows.support.label",
  "de:Pricing.comparison.sections.observability.title",
  "de:Pricing.comparison.values.regional",
  "de:Pricing.comparison.values.standard",
  "de:Pricing.summaries.business.name",
  "de:Pricing.summaries.enterprise.name",
  "de:Pricing.summaries.team.name",
  // Loanwords: "Runtime", "Observability", fr "Agents".
  "de:StartPage.videos.observability.title",
  "de:StartPage.videos.runtime.title",
  // Loanword/cognate marketplace category labels.
  "de:Marketplace.categories.apps",
  "es:Agents.recentHighlights.posts.thirdEra.category",
  "es:Agents.videos.runtime.title",
  // "Frontal Benchmark" is the product name, not a description of it.
  "es:Products.pages.benchmark.ogTitle",
  "es:Products.pages.benchmark.title",
  "es:Blog.meta.title",
  "es:PartnersContact.fields.fullNamePlaceholder",
  "es:PartnersContact.fields.workEmailPlaceholder",
  "es:Products.pages.agent.ogTitle",
  // The eyebrow over each product hero is the product's own name, which is
  // written the same way in every catalogue.
  "es:Products.pages.aiGateway.eyebrow",
  "es:Products.pages.ask.eyebrow",
  "es:Products.pages.benchmark.eyebrow",
  "es:Products.pages.cloud.eyebrow",
  "es:Products.pages.evaluation.eyebrow",
  "es:Products.pages.studio.eyebrow",
  "es:Docs.breadcrumb",
  "es:Download.terminal.title",
  "es:Features.runtime.eyebrow",
  "es:Features.runtime.ogTitle",
  "es:Navigation.company.marketplace",
  "es:Navigation.company.startups",
  "es:Navigation.developers.sdks",
  "es:Navigation.features.runtime.label",
  "es:Navigation.mobile.marketplace",
  "es:Navigation.products.cloud",
  "es:Navigation.products.marketplace",
  "es:Navigation.products.studio",
  "es:Navigation.resources.blog.label",
  "es:Navigation.resources.sdks.label",
  "es:Navigation.search.marketplace",
  "es:Navigation.social.github",
  "es:Navigation.social.linkedin",
  "es:Navigation.social.youtube",
  "es:Navigation.solutions.marketing",
  "es:Navigation.tools.frameworks",
  // "Partner" is the loanword the Spanish copy uses throughout ("Conviértete
  // en partner"), so the bare noun matches English. "Socios" would read as a
  // different word from the rest of the page.
  "es:Partners.pages.index.metaTitle",
  "es:Partners.pages.index.ogTitle",
  "es:Products.pages.cloud.ogTitle",
  "es:Products.pages.studio.ogTitle",
  // "Startups" is the standard term in Spanish; "empresas emergentes" is the
  // literal calque and is not what the audience calls itself.
  "es:Segments.pages.startups.eyebrow",
  "es:Segments.pages.startups.metaTitle",
  "es:Segments.pages.startups.ogDescription",
  "es:Segments.pages.startups.ogTitle",
  "es:Solutions.teams.marketing.eyebrow",
  // Acronyms ("CLI", "API"), loanwords, brand lists, and "Frontal Computer".
  "es:CLI.howItWorks.steps.describe.title",
  "es:CLI.ogTitle",
  "es:CLI.surfaces.api.title",
  "es:CLI.surfaces.chat.items.first",
  "es:CLI.surfaces.chat.title",
  "es:CLI.surfaces.cli.title",
  // Brand names, example placeholder values, and cognates.
  "es:Application.fields.github",
  "es:Application.fields.linkedin",
  "es:Application.fields.twitter",
  "es:ContactSales.fields.fullNamePlaceholder",
  "es:EnterpriseContact.fields.fullNamePlaceholder",
  "es:StartupsContact.fields.fullNamePlaceholder",
  "es:ContactSales.fields.workEmailPlaceholder",
  "es:EnterpriseContact.fields.workEmailPlaceholder",
  "es:StartupsContact.fields.workEmailPlaceholder",
  "es:Marketplace.beta",
  "es:Marketplace.breadcrumb",
  // Job-board brand names; es/it "No" is genuinely the same word.
  "es:Application.options.referralSource.GitHub",
  "es:Application.options.referralSource.Indeed",
  "es:Application.options.referralSource.LinkedIn",
  "es:Application.options.referralSource.Twitter/X",
  "es:Application.options.yesNo.No",
  // "Claude Code" is a product name.
  // Acronyms, loanwords and cognates in the pricing table.
  "es:Pricing.comparison.sections.accessSecurity.rows.rbac.label",
  "es:Pricing.comparison.sections.accessSecurity.rows.scim.label",
  "es:Pricing.comparison.sections.accessSecurity.rows.ssoSaml.label",
  "es:Pricing.comparison.sections.compliance.rows.sla.label",
  "es:Pricing.comparison.sections.intelligence.rows.benchmarks.label",
  "es:Pricing.comparison.values.regional",
  "es:Pricing.summaries.business.name",
  "es:Pricing.summaries.enterprise.name",
  "es:Pricing.summaries.team.name",
  // Loanwords: "Runtime", "Observability", fr "Agents".
  "es:StartPage.videos.runtime.title",
  // "General" is a word that's identical in Spanish; meaningful translations would require context.
  "es:Shortcuts.groups.general",
  "fr:Agents.hero.eyebrow",
  "fr:Agents.videos.runtime.title",
  // "Frontal Benchmark" is the product name, not a description of it.
  "fr:Products.pages.benchmark.ogTitle",
  "fr:Products.pages.benchmark.title",
  "fr:Blog.meta.title",
  "fr:Partners.pages.index.technologyPartners.c.title",
  "fr:PartnersContact.fields.fullNamePlaceholder",
  "fr:PartnersContact.fields.message",
  "fr:PartnersContact.fields.workEmailPlaceholder",
  "fr:Products.pages.agent.ogTitle",
  // The eyebrow over each product hero is the product's own name, which is
  // written the same way in every catalogue.
  "fr:Products.pages.aiGateway.eyebrow",
  "fr:Products.pages.ask.eyebrow",
  "fr:Products.pages.benchmark.eyebrow",
  "fr:Products.pages.cloud.eyebrow",
  "fr:Products.pages.evaluation.eyebrow",
  "fr:Products.pages.studio.eyebrow",
  "fr:Docs.breadcrumb",
  // "Documentation" is spelled the same in French.
  "fr:Docs.nav.label",
  // "article"/"articles" and the ICU plural built from them are spelled the
  // same in French as in English.
  "fr:Help.categories.articleCount",
  "fr:Help.category.articles",
  "fr:Docs.hero.eyebrow",
  "fr:Docs.meta.ogTitle",
  "fr:Docs.meta.title",
  "fr:Download.terminal.title",
  "fr:Features.runtime.eyebrow",
  "fr:Features.runtime.ogTitle",
  "fr:Features.workflows.eyebrow",
  "fr:Features.workflows.ogTitle",
  "fr:Navigation.ai.benchmark",
  "fr:Navigation.company.mission.label",
  "fr:Navigation.developers.documentation",
  "fr:Navigation.features.agents.label",
  "fr:Navigation.features.runtime.label",
  "fr:Navigation.features.workflows.label",
  "fr:Navigation.footer.solutions",
  "fr:Navigation.products.cloud",
  "fr:Navigation.products.studio",
  "fr:Navigation.resources.blog.label",
  "fr:Navigation.resources.documentation.label",
  "fr:Navigation.search.documentation",
  "fr:Navigation.social.github",
  "fr:Navigation.social.linkedin",
  "fr:Navigation.social.youtube",
  "fr:Navigation.solutions.finance",
  "fr:Navigation.solutions.marketing",
  "fr:Navigation.tools.frameworks",
  "fr:Products.pages.cloud.ogTitle",
  "fr:Products.pages.studio.ogTitle",
  "fr:Releases.pageLabel",
  "fr:Solutions.teams.finance.eyebrow",
  "fr:Solutions.teams.marketing.eyebrow",
  // Acronyms ("CLI", "API"), loanwords, brand lists, and "Frontal Computer".
  "fr:CLI.ogTitle",
  "fr:CLI.surfaces.api.title",
  "fr:CLI.surfaces.chat.items.first",
  "fr:CLI.surfaces.chat.title",
  "fr:CLI.surfaces.cli.title",
  // Brand names, example placeholder values, and cognates.
  "fr:Application.fields.github",
  "fr:Application.fields.linkedin",
  "fr:Application.fields.portfolio",
  "fr:Application.fields.source",
  "fr:Application.fields.twitter",
  "fr:Application.sections.confirmations",
  "fr:ContactSales.fields.fullNamePlaceholder",
  "fr:EnterpriseContact.fields.fullNamePlaceholder",
  "fr:StartupsContact.fields.fullNamePlaceholder",
  "fr:ContactSales.fields.message",
  "fr:EnterpriseContact.fields.message",
  "fr:StartupsContact.fields.message",
  "fr:ContactSales.fields.workEmailPlaceholder",
  "fr:EnterpriseContact.fields.workEmailPlaceholder",
  "fr:StartupsContact.fields.workEmailPlaceholder",
  "fr:Marketplace.breadcrumb",
  // Job-board brand names; es/it "No" is genuinely the same word.
  "fr:Application.options.referralSource.GitHub",
  "fr:Application.options.referralSource.Indeed",
  "fr:Application.options.referralSource.LinkedIn",
  "fr:Application.options.referralSource.Twitter/X",
  // "Claude Code" is a product name.
  // Acronyms, loanwords and cognates in the pricing table.
  "fr:Pricing.comparison.sections.accessSecurity.rows.rbac.label",
  "fr:Pricing.comparison.sections.accessSecurity.rows.scim.label",
  "fr:Pricing.comparison.sections.accessSecurity.rows.ssoSaml.label",
  "fr:Pricing.comparison.sections.buildDeploy.rows.applications.label",
  "fr:Pricing.comparison.sections.compliance.rows.sla.label",
  "fr:Pricing.comparison.sections.compute.rows.autoscaling.label",
  "fr:Pricing.comparison.sections.intelligence.rows.agents.label",
  "fr:Pricing.comparison.sections.intelligence.rows.benchmarks.label",
  "fr:Pricing.comparison.sections.intelligence.rows.workflows.label",
  "fr:Pricing.comparison.sections.intelligence.title",
  "fr:Pricing.comparison.sections.observability.rows.support.label",
  "fr:Pricing.comparison.values.standard",
  "fr:Pricing.summaries.business.name",
  "fr:Pricing.summaries.enterprise.name",
  "fr:Pricing.summaries.team.name",
  // Loanwords: "Runtime", "Observability", fr "Agents".
  "fr:StartPage.videos.agents.title",
  "fr:StartPage.videos.runtime.title",
  // Loanword/cognate marketplace category labels.
  "fr:Marketplace.categories.capture",
  "it:Agents.videos.governance.title",
  "it:Agents.videos.runtime.title",
  // "Frontal Benchmark" is the product name, not a description of it.
  "it:Products.pages.benchmark.ogTitle",
  "it:Products.pages.benchmark.title",
  "it:Blog.meta.title",
  "it:PartnersContact.fields.fullNamePlaceholder",
  "it:PartnersContact.fields.workEmailPlaceholder",
  "it:Products.pages.agent.ogTitle",
  // The eyebrow over each product hero is the product's own name, which is
  // written the same way in every catalogue.
  "it:Products.pages.aiGateway.eyebrow",
  "it:Products.pages.ask.eyebrow",
  "it:Products.pages.benchmark.eyebrow",
  "it:Products.pages.cloud.eyebrow",
  "it:Products.pages.evaluation.eyebrow",
  "it:Products.pages.studio.eyebrow",
  "it:Docs.breadcrumb",
  "it:Download.desktop.title",
  "it:Features.runtime.eyebrow",
  "it:Features.runtime.ogTitle",
  "it:Navigation.ai.benchmark",
  "it:Navigation.ai.gateway",
  "it:Navigation.company.marketplace",
  "it:Navigation.features.runtime.label",
  "it:Navigation.footer.social",
  "it:Navigation.mobile.marketplace",
  "it:Navigation.products.cloud",
  "it:Navigation.products.dashboard",
  "it:Navigation.products.download",
  "it:Navigation.products.marketplace",
  "it:Navigation.products.studio",
  "it:Navigation.resources.blog.label",
  "it:Navigation.resources.community.label",
  "it:Navigation.resources.computer.label",
  "it:Navigation.search.marketplace",
  "it:Navigation.social.github",
  "it:Navigation.social.linkedin",
  "it:Navigation.social.youtube",
  "it:Navigation.solutions.marketing",
  "it:Products.pages.cloud.ogTitle",
  "it:Products.pages.studio.ogTitle",
  "it:Solutions.teams.marketing.eyebrow",
  // Acronyms ("CLI", "API"), loanwords, brand lists, and "Frontal Computer".
  "it:CLI.ogTitle",
  "it:CLI.surfaces.api.title",
  "it:CLI.surfaces.chat.items.first",
  "it:CLI.surfaces.chat.title",
  "it:CLI.surfaces.cli.title",
  "it:CLI.surfaces.dashboard.title",
  // Brand names, example placeholder values, and cognates.
  "it:Application.fields.github",
  "it:Application.fields.linkedin",
  "it:Application.fields.portfolio",
  "it:Application.fields.twitter",
  "it:ContactSales.fields.fullNamePlaceholder",
  "it:EnterpriseContact.fields.fullNamePlaceholder",
  "it:StartupsContact.fields.fullNamePlaceholder",
  "it:ContactSales.fields.workEmailPlaceholder",
  "it:EnterpriseContact.fields.workEmailPlaceholder",
  "it:StartupsContact.fields.workEmailPlaceholder",
  "it:Marketplace.beta",
  "it:Marketplace.breadcrumb",
  // Job-board brand names; es/it "No" is genuinely the same word.
  "it:Application.options.referralSource.GitHub",
  "it:Application.options.referralSource.Indeed",
  "it:Application.options.referralSource.LinkedIn",
  "it:Application.options.referralSource.Twitter/X",
  "it:Application.options.yesNo.No",
  // "Claude Code" is a product name.
  // Acronyms, loanwords and cognates in the pricing table.
  "it:Pricing.comparison.sections.accessSecurity.rows.rbac.label",
  "it:Pricing.comparison.sections.accessSecurity.rows.scim.label",
  "it:Pricing.comparison.sections.accessSecurity.rows.ssoSaml.label",
  "it:Pricing.comparison.sections.compliance.rows.sla.label",
  "it:Pricing.comparison.sections.compute.rows.autoscaling.label",
  "it:Pricing.comparison.sections.compute.rows.storage.label",
  "it:Pricing.comparison.sections.intelligence.rows.humanInTheLoop.label",
  "it:Pricing.comparison.sections.observability.rows.solutionsEngineering.label",
  "it:Pricing.comparison.sections.observability.rows.technicalAccountManager.label",
  "it:Pricing.comparison.values.multiStep",
  "it:Pricing.comparison.values.standard",
  "it:Pricing.summaries.business.name",
  "it:Pricing.summaries.enterprise.name",
  "it:Pricing.summaries.team.name",
  // Loanwords: "Runtime", "Observability", fr "Agents".
  "it:StartPage.videos.runtime.title",
  "ja:PartnersContact.fields.fullNamePlaceholder",
  "ja:PartnersContact.fields.workEmailPlaceholder",
  "ja:Products.pages.agent.ogTitle",
  // The eyebrow over each product hero is the product's own name, which is
  // written the same way in every catalogue.
  "ja:Products.pages.aiGateway.eyebrow",
  "ja:Products.pages.ask.eyebrow",
  "ja:Products.pages.benchmark.eyebrow",
  "ja:Products.pages.cloud.eyebrow",
  "ja:Products.pages.evaluation.eyebrow",
  "ja:Products.pages.studio.eyebrow",
  "ja:Navigation.social.github",
  "ja:Navigation.social.linkedin",
  "ja:Navigation.social.youtube",
  // Language names and the "SDK" acronym stay in Latin script.
  "ja:SDKs.sdks.go.title",
  "ja:SDKs.sdks.php.title",
  "ja:SDKs.sdks.typescript.title",
  // Acronyms ("CLI", "API"), loanwords, brand lists, and "Frontal Computer".
  "ja:CLI.ogTitle",
  "ja:CLI.surfaces.api.title",
  "ja:CLI.surfaces.cli.title",
  // Brand names, example placeholder values, and cognates.
  "ja:Application.fields.github",
  "ja:Application.fields.linkedin",
  "ja:Application.fields.twitter",
  "ja:Chat.roleAssistant",
  "ja:ContactSales.fields.fullNamePlaceholder",
  "ja:EnterpriseContact.fields.fullNamePlaceholder",
  "ja:StartupsContact.fields.fullNamePlaceholder",
  "ja:ContactSales.fields.workEmailPlaceholder",
  "ja:EnterpriseContact.fields.workEmailPlaceholder",
  "ja:StartupsContact.fields.workEmailPlaceholder",
  // Job-board brand names; es/it "No" is genuinely the same word.
  "ja:Application.options.referralSource.GitHub",
  "ja:Application.options.referralSource.Indeed",
  "ja:Application.options.referralSource.LinkedIn",
  "ja:Application.options.referralSource.Twitter/X",
  // "Claude Code" is a product name.
  // Acronyms, loanwords and cognates in the pricing table.
  "ja:Pricing.comparison.sections.accessSecurity.rows.rbac.label",
  "ja:Pricing.comparison.sections.accessSecurity.rows.scim.label",
  "ja:Pricing.comparison.sections.accessSecurity.rows.ssoSaml.label",
  "ja:Pricing.comparison.sections.compliance.rows.sla.label",
  "ko:PartnersContact.fields.fullNamePlaceholder",
  "ko:PartnersContact.fields.workEmailPlaceholder",
  "ko:Products.pages.agent.ogTitle",
  // The eyebrow over each product hero is the product's own name, which is
  // written the same way in every catalogue.
  "ko:Products.pages.aiGateway.eyebrow",
  "ko:Products.pages.ask.eyebrow",
  "ko:Products.pages.benchmark.eyebrow",
  "ko:Products.pages.cloud.eyebrow",
  "ko:Products.pages.evaluation.eyebrow",
  "ko:Products.pages.studio.eyebrow",
  "ko:Navigation.social.github",
  "ko:Navigation.social.linkedin",
  "ko:Navigation.social.youtube",
  // Language names and the "SDK" acronym stay in Latin script.
  "ko:SDKs.sdks.go.title",
  "ko:SDKs.sdks.php.title",
  "ko:SDKs.sdks.typescript.title",
  // Acronyms ("CLI", "API"), loanwords, brand lists, and "Frontal Computer".
  "ko:CLI.ogTitle",
  "ko:CLI.surfaces.api.title",
  "ko:CLI.surfaces.chat.items.first",
  "ko:CLI.surfaces.cli.title",
  // Brand names, example placeholder values, and cognates.
  "ko:Application.fields.github",
  "ko:Application.fields.linkedin",
  "ko:Application.fields.twitter",
  "ko:Chat.roleAssistant",
  "ko:ContactSales.fields.fullNamePlaceholder",
  "ko:EnterpriseContact.fields.fullNamePlaceholder",
  "ko:StartupsContact.fields.fullNamePlaceholder",
  "ko:ContactSales.fields.workEmailPlaceholder",
  "ko:EnterpriseContact.fields.workEmailPlaceholder",
  "ko:StartupsContact.fields.workEmailPlaceholder",
  // Job-board brand names; es/it "No" is genuinely the same word.
  "ko:Application.options.referralSource.GitHub",
  "ko:Application.options.referralSource.Indeed",
  "ko:Application.options.referralSource.LinkedIn",
  "ko:Application.options.referralSource.Twitter/X",
  // "Claude Code" is a product name.
  // Acronyms, loanwords and cognates in the pricing table.
  "ko:Pricing.comparison.sections.accessSecurity.rows.rbac.label",
  "ko:Pricing.comparison.sections.accessSecurity.rows.scim.label",
  "ko:Pricing.comparison.sections.accessSecurity.rows.ssoSaml.label",
  "ko:Pricing.comparison.sections.compliance.rows.sla.label",
  // "Frontal Benchmark" is the product name, not a description of it.
  "pt:Products.pages.benchmark.ogTitle",
  "pt:Products.pages.benchmark.title",
  "pt:Agents.videos.runtime.title",
  "pt:PartnersContact.fields.fullNamePlaceholder",
  "pt:PartnersContact.fields.workEmailPlaceholder",
  "pt:Products.pages.agent.ogTitle",
  // The eyebrow over each product hero is the product's own name, which is
  // written the same way in every catalogue.
  "pt:Products.pages.aiGateway.eyebrow",
  "pt:Products.pages.ask.eyebrow",
  "pt:Products.pages.benchmark.eyebrow",
  "pt:Products.pages.cloud.eyebrow",
  "pt:Products.pages.evaluation.eyebrow",
  "pt:Products.pages.studio.eyebrow",
  "pt:Docs.breadcrumb",
  "pt:Download.terminal.title",
  "pt:Features.runtime.eyebrow",
  "pt:Features.runtime.ogTitle",
  "pt:Navigation.ai.benchmark",
  "pt:Navigation.company.marketplace",
  "pt:Navigation.company.startups",
  "pt:Navigation.developers.sdks",
  "pt:Navigation.features.runtime.label",
  "pt:Navigation.mobile.marketplace",
  "pt:Navigation.products.cloud",
  "pt:Navigation.products.marketplace",
  "pt:Navigation.products.studio",
  "pt:Navigation.resources.sdks.label",
  "pt:Navigation.search.marketplace",
  "pt:Navigation.social.github",
  "pt:Navigation.social.linkedin",
  "pt:Navigation.social.youtube",
  "pt:Navigation.solutions.marketing",
  "pt:Navigation.tools.frameworks",
  "pt:Products.pages.cloud.ogTitle",
  "pt:Products.pages.studio.ogTitle",
  // As in Spanish: "startups" is the term actually used in Portuguese.
  "pt:Segments.pages.startups.eyebrow",
  "pt:Segments.pages.startups.metaTitle",
  "pt:Segments.pages.startups.ogDescription",
  "pt:Segments.pages.startups.ogTitle",
  "pt:Solutions.teams.marketing.eyebrow",
  // Acronyms ("CLI", "API"), loanwords, brand lists, and "Frontal Computer".
  "pt:CLI.ogTitle",
  "pt:CLI.surfaces.api.title",
  "pt:CLI.surfaces.chat.items.first",
  "pt:CLI.surfaces.chat.title",
  "pt:CLI.surfaces.cli.title",
  // Brand names, example placeholder values, and cognates.
  "pt:Application.fields.github",
  "pt:Application.fields.linkedin",
  "pt:Application.fields.twitter",
  "pt:ContactSales.fields.fullNamePlaceholder",
  "pt:EnterpriseContact.fields.fullNamePlaceholder",
  "pt:StartupsContact.fields.fullNamePlaceholder",
  "pt:ContactSales.fields.workEmailPlaceholder",
  "pt:EnterpriseContact.fields.workEmailPlaceholder",
  "pt:StartupsContact.fields.workEmailPlaceholder",
  "pt:Marketplace.beta",
  "pt:Marketplace.breadcrumb",
  // Job-board brand names; es/it "No" is genuinely the same word.
  "pt:Application.options.referralSource.GitHub",
  "pt:Application.options.referralSource.Indeed",
  "pt:Application.options.referralSource.LinkedIn",
  "pt:Application.options.referralSource.Twitter/X",
  // "Claude Code" is a product name.
  // Acronyms, loanwords and cognates in the pricing table.
  "pt:Pricing.comparison.sections.accessSecurity.rows.rbac.label",
  "pt:Pricing.comparison.sections.accessSecurity.rows.scim.label",
  "pt:Pricing.comparison.sections.accessSecurity.rows.ssoSaml.label",
  "pt:Pricing.comparison.sections.compliance.rows.sla.label",
  "pt:Pricing.comparison.sections.intelligence.rows.benchmarks.label",
  "pt:Pricing.comparison.sections.observability.rows.dashboards.label",
  "pt:Pricing.comparison.values.regional",
  "pt:Pricing.summaries.business.name",
  "pt:Pricing.summaries.enterprise.name",
  // Loanwords: "Runtime", "Observability", fr "Agents".
  "pt:StartPage.videos.runtime.title",
  "zh:PartnersContact.fields.fullNamePlaceholder",
  "zh:PartnersContact.fields.workEmailPlaceholder",
  "zh:Products.pages.agent.ogTitle",
  // The eyebrow over each product hero is the product's own name, which is
  // written the same way in every catalogue.
  "zh:Products.pages.aiGateway.eyebrow",
  "zh:Products.pages.ask.eyebrow",
  "zh:Products.pages.benchmark.eyebrow",
  "zh:Products.pages.cloud.eyebrow",
  "zh:Products.pages.evaluation.eyebrow",
  "zh:Products.pages.studio.eyebrow",
  "zh:Navigation.social.github",
  "zh:Navigation.social.linkedin",
  "zh:Navigation.social.youtube",
  "zh:Navigation.tools.agent",
  // Language names and the "SDK" acronym stay in Latin script.
  "zh:SDKs.sdks.go.title",
  "zh:SDKs.sdks.php.title",
  "zh:SDKs.sdks.typescript.title",
  // Acronyms ("CLI", "API"), loanwords, brand lists, and "Frontal Computer".
  "zh:CLI.ogTitle",
  "zh:CLI.surfaces.api.title",
  "zh:CLI.surfaces.cli.title",
  // Brand names, example placeholder values, and cognates.
  "zh:Application.fields.github",
  "zh:Application.fields.linkedin",
  "zh:Application.fields.twitter",
  "zh:Chat.roleAssistant",
  "zh:ContactSales.fields.fullNamePlaceholder",
  "zh:EnterpriseContact.fields.fullNamePlaceholder",
  "zh:StartupsContact.fields.fullNamePlaceholder",
  "zh:ContactSales.fields.workEmailPlaceholder",
  "zh:EnterpriseContact.fields.workEmailPlaceholder",
  "zh:StartupsContact.fields.workEmailPlaceholder",
  // Job-board brand names; es/it "No" is genuinely the same word.
  "zh:Application.options.referralSource.GitHub",
  "zh:Application.options.referralSource.Indeed",
  "zh:Application.options.referralSource.LinkedIn",
  "zh:Application.options.referralSource.Twitter/X",
  // "Claude Code" is a product name.
  // Acronyms, loanwords and cognates in the pricing table.
  "zh:Pricing.comparison.sections.accessSecurity.rows.rbac.label",
  "zh:Pricing.comparison.sections.accessSecurity.rows.scim.label",
  "zh:Pricing.comparison.sections.accessSecurity.rows.ssoSaml.label",
  "zh:Pricing.comparison.sections.compliance.rows.sla.label",
]);

describe("message catalogues", () => {
  it("ships a catalogue for every configured locale", () => {
    expect(Object.keys(CATALOGUES).sort()).toEqual([...LOCALE_CODES].sort());
  });

  it.each(TRANSLATED_LOCALES)(
    "%s has exactly the English key set",
    (locale) => {
      const english = [...FLAT.en.keys()].sort();
      const translated = [...FLAT[locale].keys()].sort();

      expect(translated).toEqual(english);
    }
  );

  it.each(TRANSLATED_LOCALES)(
    "%s uses the same ICU arguments as English",
    (locale) => {
      // A message that drops `{year}` renders a blank; one that renames it
      // throws at runtime. Neither shows up in a key-parity check.
      const mismatched = [...FLAT.en].filter(([key, source]) => {
        const translated = FLAT[locale].get(key);

        return (
          translated !== undefined &&
          placeholdersOf(source).join() !== placeholdersOf(translated).join()
        );
      });

      expect(mismatched.map(([key]) => key)).toEqual([]);
    }
  );

  it.each(Object.keys(REQUIRED_SCRIPT) as Locale[])(
    "%s is written in its own script",
    (locale) => {
      const pattern = REQUIRED_SCRIPT[locale];
      if (!pattern) {
        throw new Error(`No script pattern configured for ${locale}`);
      }

      // Short values can legitimately be Latin ("API", "CLI"), as can the
      // brand names in `LATIN_PROPER_NOUNS`, so only flag substantial strings
      // with no native characters at all.
      const suspicious = [...FLAT[locale]]
        .filter(
          ([key, value]) =>
            !LATIN_PROPER_NOUNS.has(key) &&
            value.trim().length > 3 &&
            !pattern.test(value)
        )
        .map(([key]) => key);

      expect(suspicious).toEqual([]);
    }
  );

  it.each(TRANSLATED_LOCALES)(
    "%s is not a copy of an unrelated locale's catalogue",
    (locale) => {
      // `zh.json` once held 60 values byte-identical to `pt.json` — a whole
      // catalogue pasted in and partially translated.
      //
      // Deliberately a *bulk* check rather than a per-key one: unrelated
      // languages do coincide on individual strings (de and fr both write
      // "Ontologie" and "Presse"; ja and zh both render dates as 2026年2月26日).
      // Counting instead of listing distinguishes real coincidence, which is a
      // handful of keys, from a wholesale copy, which is dozens.
      const overlaps = TRANSLATED_LOCALES.filter(
        (other) => other !== locale && !sameFamily(locale, other)
      ).map((other) => ({
        other,
        shared: [...FLAT[locale]].filter(([key, value]) => {
          const isEnglishToo = FLAT.en.get(key) === value;

          return (
            !isEnglishToo &&
            value.trim().length > 3 &&
            FLAT[other].get(key) === value
          );
        }).length,
      }));

      const suspicious = overlaps.filter(
        ({ shared }) => shared > COINCIDENCE_LIMIT
      );

      expect(suspicious).toEqual([]);
    }
  );

  it.each(TRANSLATED_LOCALES)(
    "%s introduces no new untranslated values",
    (locale) => {
      // Not "must differ from English": plenty of values are legitimately
      // identical. "Marketing" is the Italian for marketing, French keeps
      // "Documentation" and "Contact", and GitHub is GitHub everywhere.
      //
      // So this pins the *reviewed baseline* in `UNTRANSLATED_BASELINE`
      // instead. Existing entries are accepted; a newly added key that ships
      // untranslated is not. Shrinking the baseline as copy gets translated is
      // the intended direction of travel.
      const untranslated = [...FLAT.en]
        .filter(([key, source]) => {
          const translated = FLAT[locale].get(key);

          return (
            source.trim().length > 3 &&
            translated === source &&
            !UNTRANSLATED_BASELINE.has(`${locale}:${key}`)
          );
        })
        .map(([key]) => key);

      expect(untranslated).toEqual([]);
    }
  );
});

/** Romance languages share enough short strings to make equality unremarkable. */
const ROMANCE: ReadonlySet<string> = new Set(["es", "fr", "it", "pt"]);

function sameFamily(a: Locale, b: Locale): boolean {
  return ROMANCE.has(a) && ROMANCE.has(b);
}
