import Image from "next/image";

/**
 * Official platform logos, in their real colours.
 *
 * Not tinted silhouettes. These are the actual marks, so Instagram keeps its
 * gradient and Telegram its two-tone paper plane, which is what makes them
 * recognisable at a glance from across a room. That recognition is the whole
 * reason they are here: three audience rows are otherwise structurally
 * identical, and the logo is the fastest way to tell them apart.
 *
 * The two stores are here for the same reason. A metric strip carrying a
 * rating, a download count and a chart position for each of Apple and Google
 * is eight tiles that differ only in their wording, and wording is the slowest
 * thing on the tile to read. Apple's blue and Google's four-colour triangle
 * sort them before the label is read at all.
 *
 * The marks do not share an aspect ratio. YouTube ships as a 1.43:1 tile while
 * Telegram and Instagram are square, so laying them out raw gives a ragged row
 * with the YouTube logo visually larger than the rest. Each is therefore
 * centred inside a fixed square box and contained within it, which gives every
 * platform the same optical weight whatever its native shape.
 *
 * Served as files rather than inlined. Instagram alone carries six gradient
 * definitions, and inlining the same SVG more than once in a document risks
 * duplicate gradient ids resolving against the wrong element.
 */

const LOGOS = {
  telegram: { src: "/logos/telegram.svg", alt: "Telegram" },
  instagram: { src: "/logos/instagram.svg", alt: "Instagram" },
  youtube: { src: "/logos/youtube.svg", alt: "YouTube" },
  appstore: { src: "/logos/app-store.svg", alt: "App Store" },
  googleplay: { src: "/logos/google-play.svg", alt: "Google Play" },
} as const;

export type BrandKey = keyof typeof LOGOS;

/**
 * The audience platforms, as opposed to the two stores.
 *
 * Callers that map every social platform to something must stay exhaustive
 * over these three; keyed on BrandKey instead they would be asked to supply a
 * follower count label for the App Store.
 */
export type SocialKey = Extract<BrandKey, "telegram" | "instagram" | "youtube">;

export function BrandLogo({
  platform,
  className,
}: {
  platform: BrandKey;
  className?: string;
}) {
  const logo = LOGOS[platform];

  return (
    <span className={`relative inline-block shrink-0 ${className ?? ""}`}>
      <Image
        src={logo.src}
        alt={logo.alt}
        fill
        // Contained, so a wide tile and a square glyph occupy the same space.
        className="object-contain"
        // Small, local, and above the fold on a screen that never scrolls.
        priority
        unoptimized
      />
    </span>
  );
}

/**
 * The store marks, ready to drop into a Metric's icon slot.
 *
 * Named exports rather than a prop on every call site: the size is the same
 * everywhere a store appears in a strip, and repeating the class string on two
 * dozen tiles is how it ends up wrong on one of them.
 */
export const APP_STORE_MARK = <BrandLogo platform="appstore" className="size-3.5" />;
export const GOOGLE_PLAY_MARK = <BrandLogo platform="googleplay" className="size-3.5" />;
