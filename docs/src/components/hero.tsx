"use client";

import { Button } from "@/components/button";
import { cn } from "@/lib/utils";
import { ArrowUpRight, Play } from "lucide-react";
import { useTranslations } from "@/components/i18n";
import {
  type ComponentProps,
  type ReactNode,
  useEffect,
  useRef,
  useState,
} from "react";
import { assetUrl, cdnVideoPosterUrl, cdnVideoUrl } from "@/lib/cdn";
import { Link } from "@/components/navigation";
import { sectionProps } from "@/lib/section";

/**
 * Derived from the component rather than the package's exported `ButtonProps`,
 * which since 0.3.0 no longer carries the `variant`/`size` cva props.
 */
type ButtonVariantProps = ComponentProps<typeof Button>;

// The bucket holds a full-resolution master; Cloudflare Media Transformations
// downscale it at the edge so browsers never fetch the original.
const HERO_VIDEO_WIDTH = 1280;

const HOMEPAGE_HERO_VIDEO = "/videos/marketing/homepage/hero/preview.mp4";

const DEFAULT_VIDEO_SRC = cdnVideoUrl(HOMEPAGE_HERO_VIDEO, {
  width: HERO_VIDEO_WIDTH,
});
const DEFAULT_POSTER_SRC = cdnVideoPosterUrl(HOMEPAGE_HERO_VIDEO, {
  width: HERO_VIDEO_WIDTH,
});
const DEFAULT_DASHBOARD_LIGHT_SRC = "/images/dashboard-light.svg";
const DEFAULT_DASHBOARD_DARK_SRC = "/images/dashboard-dark.svg";

const PIXEL_PLATES = [
  { delay: "0s", src: "/images/pixel-flight.png" },
  { delay: "2s", src: "/images/pixel-digit.png" },
] as const;

/** Feature pages whose hero media lives under `marketing/features/<slug>`. */
export type FeatureSlug =
  | "agents"
  | "data"
  | "observability"
  | "ontology"
  | "runtime"
  | "security"
  | "storage"
  | "workflows";

/**
 * Hero media for a feature page. Every feature ships the same asset set under
 * its own slug, so the hero only ever needs the slug to resolve all four URLs.
 */
export function featureHeroMedia(
  slug: FeatureSlug
): Required<
  Pick<
    HeroProps,
    "dashboardDarkSrc" | "dashboardLightSrc" | "posterSrc" | "videoSrc"
  >
> {
  const video = `/videos/marketing/features/${slug}/hero/preview.mp4`;

  return {
    dashboardDarkSrc: assetUrl(
      `/images/marketing/features/${slug}/hero/dashboard-dark.svg`
    ),
    dashboardLightSrc: assetUrl(
      `/images/marketing/features/${slug}/hero/dashboard-light.svg`
    ),
    posterSrc: cdnVideoPosterUrl(video, { width: HERO_VIDEO_WIDTH }),
    videoSrc: cdnVideoUrl(video, { width: HERO_VIDEO_WIDTH }),
  };
}

export interface HeroContent {
  playLabel: string;
  title: string;
}

export interface HeroAction {
  /** Opens in a new tab and appends the outward arrow, as `SectionButton` does. */
  external?: boolean;
  href: string;
  label: string;
  size?: ButtonVariantProps["size"];
  variant?: ButtonVariantProps["variant"];
}

export interface HeroProps {
  /** Override the translated copy while retaining the default layout. */
  content?: Partial<HeroContent>;
  dashboardDarkSrc?: string;
  dashboardLightSrc?: string;
  description?: ReactNode;
  eyebrow?: ReactNode;
  onVideoPlay?: () => void;
  posterSrc?: string;
  primaryAction?: HeroAction;
  secondaryAction?: HeroAction;
  videoSrc?: string;
}

type HeroHeaderProps = Pick<HeroContent, "title"> & {
  /**
   * Merged into the outer block, so a caller can drop the bespoke top padding
   * and bottom margin below. `cn` is `twMerge`, so a conflicting class here
   * wins — which is what lets a viewport-height hero centre its content
   * instead of inheriting spacing sized for a hero with media under it.
   */
  className?: string;
  /** Overrides the default hero eyebrow typography for a specific page. */
  eyebrowClassName?: string;
  /**
   * `start` — the default — is the left-aligned column every hero with media
   * under it uses. `center` is for the header-only bands, where a left column
   * on a full-width band reads as unbalanced.
   */
  align?: "center" | "start";
  eyebrow?: ReactNode;
  description?: ReactNode;
  primaryAction?: HeroAction;
  secondaryAction?: HeroAction;
};

/**
 * The hero header's type scale, rhythm and alignment.
 *
 * Exported because the homepage renders its own header beside a bespoke video
 * reel rather than `Hero`; without a shared source the two drift into two
 * different heroes. Sizes only ever step up — a breakpoint that repeats the
 * previous size is dropped rather than restated.
 *
 * The eyebrow carries the description's size steps rather than the small-label
 * scale `section-primitives.tsx` uses for `h2` sections: a hero label sits over
 * type twice that size, so the section eyebrow reads as a caption there.
 */
export const HERO_EYEBROW_CLASS =
  "font-sans text-md text-muted-foreground lg:text-base";
// The base step carries phones, where the title previously sat at 24px — only
// half a step above the 16px description under it, so the hero read as body
// copy. `md` is not repeated because it now matches the base.
export const HERO_TITLE_CLASS =
  "font-sans 3xl:text-6xl text-3xl text-foreground leading-[1.1] tracking-tight lg:text-4xl xl:text-5xl";
export const HERO_DESCRIPTION_CLASS =
  "max-w-2xl font-sans text-base text-muted-foreground leading-relaxed lg:text-lg";

function HeroActionButton({ action }: { action: HeroAction }) {
  const anchorClass = "group inline-flex items-center gap-1";

  return (
    <Button
      className="h-11 px-6 transition-colors"
      nativeButton={false}
      render={
        action.href.startsWith("/") ? (
          <Link className={anchorClass} href={action.href} />
        ) : (
          <a
            className={anchorClass}
            href={action.href}
            rel={action.external ? "noopener" : undefined}
            target={action.external ? "_blank" : undefined}
          />
        )
      }
      shape="pill"
      size={action.size}
      variant={action.variant}
    >
      <span className="text-inherit text-sm">{action.label}</span>
      {action.external && (
        <ArrowUpRight
          aria-hidden="true"
          className="size-3.5 transition-transform duration-200 group-hover:translate-x-0.5 group-hover:-translate-y-0.5"
        />
      )}
    </Button>
  );
}

export function HeroHeader({
  align = "start",
  className,
  eyebrowClassName,
  title,
  eyebrow,
  description,
  primaryAction,
  secondaryAction,
}: HeroHeaderProps) {
  const centered = align === "center";

  return (
    <div
      className={cn(
        "z-20 3xl:mb-16 mb-12 flex flex-1 flex-col justify-center md:justify-start md:pt-16 lg:mb-12 lg:w-full lg:flex-none lg:pt-48",
        className
      )}
    >
      <div className="page-shell">
        {/* The column's own alignment and the text alignment inside it move
            together. Setting only one of the two is what made the earlier
            version look centred on a full-width band while every line stayed
            ragged against the left edge. */}
        <div
          className={cn(
            "flex w-full 3xl:max-w-6xl max-w-4xl flex-col space-y-6 px-2 lg:space-y-8 lg:px-0",
            centered
              ? "mx-auto items-center text-center"
              : "items-start text-left"
          )}
        >
          {eyebrow && (
            <p
              className={cn(
                "enter",
                eyebrowClassName ?? HERO_EYEBROW_CLASS
              )}
            >
              {eyebrow}
            </p>
          )}
          <h1 className={cn("enter [--enter-delay:80ms]", HERO_TITLE_CLASS)}>
            {title}
          </h1>
          {description && (
            <p
              className={cn(
                "enter [--enter-delay:160ms]",
                HERO_DESCRIPTION_CLASS,
                centered && "mx-auto"
              )}
            >
              {description}
            </p>
          )}

          {(primaryAction || secondaryAction) && (
            <div
              className={cn(
                "enter flex flex-wrap items-center gap-3 pt-2 [--enter-delay:240ms]",
                centered && "justify-center"
              )}
            >
              {primaryAction && <HeroActionButton action={primaryAction} />}
              {secondaryAction && <HeroActionButton action={secondaryAction} />}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

type HeroShowcaseProps = Pick<HeroContent, "playLabel"> & {
  videoSrc: string;
  posterSrc: string;
  dashboardLightSrc: string;
  dashboardDarkSrc: string;
  onVideoPlay?: () => void;
};

export function HeroShowcase({
  videoSrc,
  posterSrc,
  dashboardLightSrc,
  dashboardDarkSrc,
  playLabel,
  onVideoPlay,
}: HeroShowcaseProps) {
  const [isVideoLoaded, setIsVideoLoaded] = useState(false);
  const [isPosterLoaded, setIsPosterLoaded] = useState(false);
  const [isDashboardLightLoaded, setIsDashboardLightLoaded] = useState(false);
  const [isDashboardDarkLoaded, setIsDashboardDarkLoaded] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) {
      return;
    }

    const handleLoad = () => setIsVideoLoaded(true);
    if (video.readyState >= 3) {
      handleLoad();
    }

    video.addEventListener("canplay", handleLoad);
    video.addEventListener("loadeddata", handleLoad);

    return () => {
      video.removeEventListener("canplay", handleLoad);
      video.removeEventListener("loadeddata", handleLoad);
    };
  }, []);

  return (
    <div className="mt-8 w-full overflow-visible md:mt-12 lg:mt-0">
      <div className="mx-auto w-full max-w-[1760px]">
        {/* This is the band the header inverts over. Marking it here covers
            every page that renders a `HeroShowcase`. */}
        <div {...sectionProps("dark", "relative overflow-hidden")}>
          <div className="absolute inset-0 z-[1] bg-gradient-to-t from-black via-black/50 to-transparent" />
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0"
          >
            {PIXEL_PLATES.map(({ delay, src }) => (
              <img
                alt=""
                className="pixel-plate z-10 object-cover"
                key={src}
                loading="eager"
                sizes="100vw"
                src={src}
                style={{ animationDelay: delay, height: "100%", width: "100%" }}
              />
            ))}
          </div>

          <div
            className={cn(
              "absolute inset-0 z-10 h-full w-full transition-[opacity,filter] duration-1000 ease-out",
              isVideoLoaded ? "pointer-events-none opacity-0" : "opacity-100"
            )}
            style={{ filter: isVideoLoaded ? "blur(0px)" : "blur(1px)" }}
          >
            <img
              alt="Frontal dashboard preview"
              className="object-cover transition-[filter,transform] duration-1000 ease-out"
              fetchPriority="high"
              onLoad={() => setIsPosterLoaded(true)}
              sizes="100vw"
              src={posterSrc}
              style={{
                filter: isPosterLoaded ? "blur(0px)" : "blur(12px)",
                transform: isPosterLoaded ? "scale(1)" : "scale(1.05)",
              }}
            />
          </div>

          <video
            autoPlay
            className={cn(
              "relative z-0 3xl:h-[1000px] h-[420px] w-full object-cover transition-opacity duration-1000 ease-out sm:h-[520px] md:h-[600px] lg:h-[800px] xl:h-[900px]",
              isVideoLoaded ? "opacity-100" : "opacity-0"
            )}
            loop
            muted
            playsInline
            preload="none"
            ref={videoRef}
          >
            <source src={videoSrc} type="video/mp4" />
          </video>

          <div className="absolute inset-0 z-20 flex items-center justify-center p-0 lg:p-4">
            <div className="relative scale-[0.95] md:scale-100 lg:static lg:flex lg:h-full lg:scale-100 lg:flex-col lg:items-center lg:justify-center">
              <HeroDashboardImage
                className="dark:hidden"
                isLoaded={isDashboardLightLoaded}
                onLoad={() => setIsDashboardLightLoaded(true)}
                src={dashboardLightSrc}
              />
              <HeroDashboardImage
                className="hidden dark:block"
                isLoaded={isDashboardDarkLoaded}
                onLoad={() => setIsDashboardDarkLoaded(true)}
                src={dashboardDarkSrc}
              />
            </div>
          </div>

          <button
            aria-label={playLabel}
            className={cn(
              // `hidden` stays until a caller actually passes `onVideoPlay`.
              // `Hero` forwards it through to `HeroShowcase`, but no call
              // site in the app supplies one, so un-hiding this today would
              // render a play button whose `onClick` is `undefined` on every
              // feature page. The home page's own play button is wired and is
              // visible; this one is not.
              "pointer-events-none absolute inset-0 z-30 flex hidden items-center justify-center transition-opacity delay-300 duration-500",
              isDashboardLightLoaded || isDashboardDarkLoaded
                ? "opacity-100"
                : "opacity-0"
            )}
            onClick={onVideoPlay}
            type="button"
          >
            <div className="pointer-events-auto flex h-12 w-12 items-center justify-center bg-muted transition-[transform,scale,background-color] duration-160 ease-out hover:scale-105 hover:bg-secondary active:scale-[0.97] sm:h-14 sm:w-14 md:h-16 md:w-16">
              <Play className="h-5 w-5 text-primary sm:h-6 sm:w-6 md:h-7 md:w-7" />
            </div>
          </button>
        </div>
      </div>
    </div>
  );
}

function HeroDashboardImage({
  src,
  className,
  isLoaded,
  onLoad,
}: {
  src: string;
  className: string;
  isLoaded: boolean;
  onLoad: () => void;
}) {
  return (
    <img
      alt="Dashboard illustration"
      className={cn(
        "md:!scale-[0.85] lg:!scale-100 h-auto w-full transition-[filter,transform] duration-700 ease-out lg:max-w-[85%] lg:object-contain 2xl:max-w-[75%] lg:[filter:drop-shadow(0_30px_60px_rgba(0,0,0,0.6))] lg:[transform:rotate(-2deg)_skewY(1deg)]",
        className
      )}
      fetchPriority="high"
      onLoad={onLoad}
      src={src}
      style={{
        filter: isLoaded
          ? "blur(0px) drop-shadow(0 30px 60px rgba(0,0,0,0.6))"
          : "blur(16px)",
        transform: isLoaded ? "scale(1)" : "scale(1.02)",
      }}
    />
  );
}

export function Hero({
  content,
  eyebrow,
  description,
  primaryAction,
  secondaryAction,
  videoSrc = DEFAULT_VIDEO_SRC,
  posterSrc = DEFAULT_POSTER_SRC,
  dashboardLightSrc = DEFAULT_DASHBOARD_LIGHT_SRC,
  dashboardDarkSrc = DEFAULT_DASHBOARD_DARK_SRC,
  onVideoPlay,
}: HeroProps) {
  const t = useTranslations("StartPage");
  const heroContent: HeroContent = {
    playLabel: t("video.playLabel"),
    title: t("hero.title"),
    ...content,
  };

  return (
    <div className="relative min-h-screen overflow-visible lg:overflow-hidden">
      <div className="relative flex min-h-screen flex-col overflow-hidden pt-32 pb-12 sm:py-32 md:pt-24 lg:pt-0">
        <HeroHeader
          {...heroContent}
          description={description}
          eyebrow={eyebrow}
          primaryAction={primaryAction}
          secondaryAction={secondaryAction}
        />
        <HeroShowcase
          dashboardDarkSrc={dashboardDarkSrc}
          dashboardLightSrc={dashboardLightSrc}
          onVideoPlay={onVideoPlay}
          playLabel={heroContent.playLabel}
          posterSrc={posterSrc}
          videoSrc={videoSrc}
        />
      </div>
    </div>
  );
}
