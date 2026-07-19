import { OnboardingSkeleton } from "./OnboardingSkeleton";

export interface SkeletonTileGeometry {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

interface SkeletonGridProps {
  tiles: readonly SkeletonTileGeometry[];
  className?: string;
}

export function SkeletonGrid({ tiles, className = "" }: SkeletonGridProps) {
  return (
    <div className={["absolute inset-0", className].join(" ")}>
      {tiles.map((tile, index) => (
        <OnboardingSkeleton
          key={tile.id}
          raised={index % 4 === 1}
          className="absolute rounded-[14px] border border-border/70"
          style={{
            left: tile.x,
            top: tile.y,
            width: tile.width,
            height: tile.height,
          }}
        />
      ))}
    </div>
  );
}
