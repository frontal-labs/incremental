import { Video } from "@/components/video";
import { assetUrl, cdnVideoPosterUrl } from "@/lib/cdn";

const BRAND_VIDEO = "/videos/marketing/brand/brand-kit.mp4";

/** Matches the width the poster is transformed at on the CDN. */
const POSTER_WIDTH = 1280;

/**
 * The brand reel on `/brand`.
 *
 * Uses the shared `Video` rather than the browser's `controls`, so the
 * chrome here matches the strip on the marketing pages instead of rendering a
 * different native control bar in every engine. It plays in place — there is
 * no dialog to open, because the reel is already the point of the section.
 */
export const Logo = () => (
  <Video
    autoPlay
    className="h-[350px] w-full bg-subtle sm:h-[450px]"
    // `cover` and the label carry over from the plain `<video>` this replaced.
    fit="cover"
    label="Incremental"
    posterSrc={cdnVideoPosterUrl(BRAND_VIDEO, { width: POSTER_WIDTH })}
    src={assetUrl(BRAND_VIDEO)}
  />
);

/** The mark's own viewBox, matching `assets/logo.svg`. */
export const MARK_VIEWBOX = {
  height: 259.99,
  width: 162.5,
} as const;

/** Width / height of the mark. Used to size it from a height alone. */
export const MARK_ASPECT = MARK_VIEWBOX.width / MARK_VIEWBOX.height;

/** Light-appearance icon background: extended-gray 1.00 -> 0.85. */
export const ICON_BACKGROUND_LIGHT =
  "linear-gradient(180deg, #ffffff 0%, #d9d9d9 100%)";

/** Light-appearance logo fill. */
export const ICON_MARK_COLOR_LIGHT = "#000000";

/** Approximates the macOS squircle. */
export const ICON_CORNER_RADIUS = "22.5%";

/** The mark spans this fraction of the icon tile's height, centred. */
export const ICON_MARK_HEIGHT_RATIO = 0.735;

/** The pixel-grid mark used by generated app icons. */
export function Mark({
  height,
  color = ICON_MARK_COLOR_LIGHT,
}: {
  height: number;
  color?: string;
}) {
  return (
    <svg
      aria-hidden="true"
      fill={color}
      height={Math.round(height)}
      viewBox={`0 0 ${MARK_VIEWBOX.width} ${MARK_VIEWBOX.height}`}
      width={Math.round(height * MARK_ASPECT)}
      xmlns="http://www.w3.org/2000/svg"
    >
      <rect height="32.5" width="32.5" x="0" y="0" />
      <rect height="32.5" width="32.5" x="65" y="0" />
      <rect height="32.5" width="32.5" x="130" y="0" />
      <rect height="32.5" width="32.5" x="32.5" y="32.5" />
      <rect height="32.5" width="32.5" x="97.5" y="32.5" />
      <rect height="32.5" width="32.5" x="0" y="65" />
      <rect height="32.5" width="32.5" x="65" y="65" />
      <rect height="32.5" width="32.5" x="32.5" y="97.5" />
      <rect height="32.5" width="32.5" x="97.5" y="97.5" />
      <rect height="32.5" width="32.5" x="0" y="130" />
      <rect height="32.5" width="32.5" x="65" y="130" />
      <rect height="32.5" width="32.5" x="32.5" y="162.5" />
      <rect height="32.5" width="32.5" x="0" y="195" />
      <rect height="32.5" width="32.5" x="32.5" y="227.5" />
    </svg>
  );
}

/** A full icon tile with the mark centred on its background. */
export function Tile({
  size,
  background = ICON_BACKGROUND_LIGHT,
  markColor = ICON_MARK_COLOR_LIGHT,
  rounded = false,
}: {
  size: number;
  background?: string;
  markColor?: string;
  rounded?: boolean;
}) {
  return (
    <div
      style={{
        alignItems: "center",
        background,
        display: "flex",
        height: "100%",
        justifyContent: "center",
        width: "100%",
        ...(rounded ? { borderRadius: ICON_CORNER_RADIUS } : {}),
      }}
    >
      <Mark color={markColor} height={size * ICON_MARK_HEIGHT_RATIO} />
    </div>
  );
}
