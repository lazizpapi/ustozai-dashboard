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
} as const;

export type BrandKey = keyof typeof LOGOS;

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
