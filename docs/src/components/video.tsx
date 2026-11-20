"use client";

import { Button } from "@/components/button";
import { Slider } from "@/components/slider";
import { cn } from "@/lib/utils";
import {
  Pause,
  Play,
  RotateCcw,
  RotateCw,
  Volume2,
  VolumeX,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

export interface VideoLabels {
  forward: string;
  mute: string;
  pause: string;
  play: string;
  replay: string;
  seek: string;
  unmute: string;
}

export interface VideoProps {
  /** Starts playback as soon as the element can play. Muted, necessarily. */
  autoPlay?: boolean;
  className?: string;
  /**
   * How the frame fills its box. `contain` letterboxes and is right when the
   * whole frame matters; `cover` crops to fill and is right when the clip is
   * a backdrop.
   */
  fit?: "contain" | "cover";
  /** Accessible name for the video itself, when the clip is the content. */
  label?: string;
  labels?: Partial<VideoLabels>;
  posterSrc?: string;
  src: string;
}

const DEFAULT_LABELS: VideoLabels = {
  forward: "Forward 10 seconds",
  mute: "Mute",
  pause: "Pause",
  play: "Play",
  replay: "Back 10 seconds",
  seek: "Seek",
  unmute: "Unmute",
};

const SECONDS_PER_MINUTE = 60;
const TIME_PAD = 2;
const SKIP_SECONDS = 10;

/** `m:ss`. Long-form content would want hours; these are marketing clips. */
function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds)) {
    return "0:00";
  }

  const whole = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(whole / SECONDS_PER_MINUTE);
  const rest = whole % SECONDS_PER_MINUTE;

  return `${minutes}:${String(rest).padStart(TIME_PAD, "0")}`;
}

/** Every control is the same ghost button, sized and tinted for footage. */
const CONTROL_CLASS =
  "shrink-0 text-white transition-colors duration-200 hover:bg-white/15 hover:text-white focus-visible:ring-white/50";

/**
 * A video player with the system's own controls rather than the browser's.
 *
 * The native control bar cannot be themed and looks different in every engine,
 * which is the whole reason this exists. The element keeps its real semantics —
 * it is still a `<video>`, so picture-in-picture, captions, and the media keys
 * all keep working — and only the chrome is ours: the package `Button` and
 * `Slider`, and the same lucide set the rest of the site draws from.
 */
export function Video({
  autoPlay = false,
  className,
  fit = "contain",
  label,
  labels,
  posterSrc,
  src,
}: VideoProps) {
  const text = { ...DEFAULT_LABELS, ...labels };
  const videoRef = useRef<HTMLVideoElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(true);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) {
      return;
    }

    const onTime = () => setCurrentTime(video.currentTime);
    const onMeta = () => setDuration(video.duration);
    const onPlay = () => setIsPlaying(true);
    const onPause = () => setIsPlaying(false);
    const onVolume = () => setIsMuted(video.muted);

    video.addEventListener("timeupdate", onTime);
    video.addEventListener("loadedmetadata", onMeta);
    video.addEventListener("play", onPlay);
    video.addEventListener("pause", onPause);
    video.addEventListener("volumechange", onVolume);

    return () => {
      video.removeEventListener("timeupdate", onTime);
      video.removeEventListener("loadedmetadata", onMeta);
      video.removeEventListener("play", onPlay);
      video.removeEventListener("pause", onPause);
      video.removeEventListener("volumechange", onVolume);
    };
  }, []);

  const toggle = useCallback(() => {
    const video = videoRef.current;
    if (!video) {
      return;
    }

    if (video.paused) {
      video.play().catch(() => setIsPlaying(false));
      return;
    }

    video.pause();
  }, []);

  const toggleMuted = useCallback(() => {
    const video = videoRef.current;
    if (video) {
      video.muted = !video.muted;
    }
  }, []);

  const skip = useCallback((offset: number) => {
    const video = videoRef.current;
    if (!video) {
      return;
    }

    const next = Math.min(
      Math.max(0, video.currentTime + offset),
      video.duration || 0
    );
    video.currentTime = next;
    setCurrentTime(next);
  }, []);

  const seek = useCallback((value: number | readonly number[]) => {
    const video = videoRef.current;
    const next = Array.isArray(value) ? value[0] : (value as number);
    if (!video || next === undefined) {
      return;
    }

    video.currentTime = next;
    setCurrentTime(next);
  }, []);

  return (
    <div className={cn("group/player relative bg-black", className)}>
      <video
        aria-label={label}
        autoPlay={autoPlay}
        className={cn(
          "h-full w-full",
          fit === "cover" ? "object-cover object-center" : "object-contain"
        )}
        loop
        muted={isMuted}
        onClick={toggle}
        playsInline
        poster={posterSrc}
        preload="metadata"
        ref={videoRef}
        src={src}
      />

      {/*
        A paused clip gets a centre affordance, because the bottom bar alone
        does not read as "this is playable" on a still frame. It disappears the
        moment playback starts, so a playing clip is just the clip.
      */}
      <button
        aria-label={isPlaying ? text.pause : text.play}
        className={cn(
          "absolute inset-0 flex items-center justify-center transition-opacity duration-300 ease-out",
          isPlaying ? "pointer-events-none opacity-0" : "opacity-100"
        )}
        onClick={toggle}
        type="button"
      >
        <span className="flex size-16 items-center justify-center rounded-full bg-white/15 text-white backdrop-blur-sm transition-[transform,scale] duration-160 ease-out hover:scale-105 active:scale-[0.97]">
          <Play aria-hidden="true" className="size-6 translate-x-px" />
        </span>
      </button>

      {/*
        The bar rests hidden and comes back on hover, focus, or while paused,
        so a playing clip is unobstructed. `focus-within` is what keeps it
        reachable by keyboard once it has faded out.
      */}
      <div
        className={cn(
          "absolute inset-x-0 bottom-0 flex items-center gap-2 bg-gradient-to-t from-black/85 via-black/45 to-transparent px-4 pt-12 pb-4 sm:gap-3 sm:px-5",
          "opacity-0 transition-opacity duration-300 ease-out",
          "group-focus-within/player:opacity-100 group-hover/player:opacity-100",
          !isPlaying && "opacity-100"
        )}
      >
        <Button
          aria-label={isPlaying ? text.pause : text.play}
          className={CONTROL_CLASS}
          onClick={toggle}
          shape="pill"
          size="icon-sm"
          variant="ghost"
        >
          {isPlaying ? <Pause /> : <Play />}
        </Button>

        <Button
          aria-label={text.replay}
          className={cn(CONTROL_CLASS, "hidden sm:inline-flex")}
          onClick={() => skip(-SKIP_SECONDS)}
          shape="pill"
          size="icon-sm"
          variant="ghost"
        >
          <RotateCcw />
        </Button>

        <Button
          aria-label={text.forward}
          className={cn(CONTROL_CLASS, "hidden sm:inline-flex")}
          onClick={() => skip(SKIP_SECONDS)}
          shape="pill"
          size="icon-sm"
          variant="ghost"
        >
          <RotateCw />
        </Button>

        <span className="shrink-0 font-sans text-white/70 text-xs tabular-nums">
          {formatTime(currentTime)}
        </span>

        {/*
          Two things are being corrected here, both through slots rather than
          by forking the component.

          Colour: the package slider is built for a page surface, so its track
          is `muted` and its range is `primary`. Both vanish against footage.

          Height: the package sizes the bar with `data-horizontal:h-1`, and
          that attribute is not what this version of the primitive emits, so
          the track and the range both computed to zero height and only the
          thumb was visible. The explicit heights below are the fix.
        */}
        <Slider
          aria-label={text.seek}
          className={cn(
            "min-w-0 flex-1",
            "[&_[data-slot=slider-track]]:h-1 [&_[data-slot=slider-track]]:bg-white/25",
            "[&_[data-slot=slider-range]]:h-full [&_[data-slot=slider-range]]:bg-white",
            "[&_[data-slot=slider-thumb]]:border-white/50 [&_[data-slot=slider-thumb]]:ring-white/40"
          )}
          max={Math.max(duration, 1)}
          min={0}
          onValueChange={seek}
          step={0.1}
          value={[Math.min(currentTime, Math.max(duration, 1))]}
        />

        <span className="shrink-0 font-sans text-white/70 text-xs tabular-nums">
          {formatTime(duration)}
        </span>

        <Button
          aria-label={isMuted ? text.unmute : text.mute}
          className={CONTROL_CLASS}
          onClick={toggleMuted}
          shape="pill"
          size="icon-sm"
          variant="ghost"
        >
          {isMuted ? <VolumeX /> : <Volume2 />}
        </Button>
      </div>
    </div>
  );
}
