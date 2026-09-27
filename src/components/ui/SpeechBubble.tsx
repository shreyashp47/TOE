import { Mascot, type MascotMood } from "@/components/Mascot";
import { cn } from "@/lib/cn";
import type { ReactNode } from "react";

/**
 * Manga speech bubble (theme doc §4). Tail is a rotated square rather than a
 * pseudo-element so it can be positioned without magic offsets.
 */
export function SpeechBubble({
  children,
  mood = "cheer",
  className,
  tail = "left",
}: {
  children: ReactNode;
  mood?: MascotMood;
  className?: string;
  tail?: "left" | "right" | "none";
}) {
  return (
    <div className={cn("flex items-end gap-3", className)}>
      <Mascot mood={mood} size={92} className="shrink-0" />
      <div className="relative flex-1 rounded-lg rounded-bl-md border-2 border-line bg-paper px-4 py-3 shadow-card">
        <p className="font-round text-base text-ink">{children}</p>
        {tail !== "none" ? (
          <span
            aria-hidden="true"
            className={cn(
              "absolute -bottom-2 size-4 rotate-45 border-b-2 border-r-2 border-line bg-paper",
              tail === "left" ? "left-7" : "right-7",
            )}
          />
        ) : null}
      </div>
    </div>
  );
}

/**
 * Tilted washi-taped sticky note (theme doc §4: handwritten sticky-note
 * accents + washi-tape detail). Used for the cafe's sticky tagline and the
 * "today's special" board.
 */
export function WashiNote({
  children,
  tilt = -2,
  tone = "highlight",
  className,
}: {
  children: ReactNode;
  tilt?: number;
  tone?: "highlight" | "paper" | "sage";
  className?: string;
}) {
  const tones = {
    highlight: "bg-highlight-soft border-highlight",
    paper: "bg-paper border-line",
    sage: "bg-sage-soft border-sage",
  } as const;

  return (
    <div
      className={cn(
        "relative inline-block rounded-md border-2 px-4 py-2 shadow-card",
        tones[tone],
        className,
      )}
      style={{ transform: `rotate(${tilt}deg)` }}
    >
      {/* washi tape */}
      <span
        aria-hidden="true"
        className="absolute -top-2.5 left-1/2 h-4 w-16 -translate-x-1/2 rounded-[2px] bg-secondary/45 backdrop-blur-[1px]"
      />
      <span className="font-hand text-xl leading-tight text-primary-dark">
        {children}
      </span>
    </div>
  );
}

export default SpeechBubble;
