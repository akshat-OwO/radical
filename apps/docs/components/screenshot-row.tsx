import Image from "next/image";

interface Screenshot {
  readonly src: string;
  readonly alt: string;
  readonly label: string;
  readonly width: number;
  readonly height: number;
}

// Each figure grows by its aspect ratio, so every image renders at the same height.
export const ScreenshotRow = ({
  shots,
}: {
  readonly shots: readonly Screenshot[];
}) => (
  <div className="not-prose my-6 flex items-end gap-3 sm:gap-4">
    {shots.map((shot) => (
      <figure
        className="m-0 min-w-0"
        key={shot.src}
        style={{ flex: `${shot.width / shot.height} 1 0%` }}
      >
        <Image
          alt={shot.alt}
          className="block h-auto w-full rounded-xl border"
          height={shot.height}
          sizes="(min-width: 768px) 40vw, 60vw"
          src={shot.src}
          width={shot.width}
        />
        <figcaption className="text-fd-muted-foreground mt-2 text-center text-sm">
          {shot.label}
        </figcaption>
      </figure>
    ))}
  </div>
);
