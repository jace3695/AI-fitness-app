import type { ReactNode } from "react";

export type RubySegment = {
  text: string;
  reading?: string;
};

type FuriganaTextProps = {
  text: string;
  reading?: string;
  rubySegments?: RubySegment[];
  showReading: boolean;
  className?: string;
};

const KANJI_REGEX = /[\u3400-\u9FFF]/;

export default function FuriganaText({ text, reading, rubySegments, showReading, className }: FuriganaTextProps) {
  if (!showReading) return <span className={className}>{text}</span>;

  if (rubySegments?.length) {
    return (
      <span className={className} style={{ whiteSpace: "normal", wordBreak: "break-word", lineHeight: 1.5 }}>
        {rubySegments.map((segment, index) => (
          segment.reading && segment.reading.trim()
            ? <ruby key={`${segment.text}-${index}`} style={{ rubyPosition: "over", rubyAlign: "center" }}>{segment.text}<rt style={{ fontSize: "0.58em", color: "#7b8c7b" }}>{segment.reading}</rt></ruby>
            : <span key={`${segment.text}-${index}`}>{segment.text}</span>
        ))}
      </span>
    );
  }

  if (reading && text === reading) return <span className={className}>{text}</span>;

  if (!KANJI_REGEX.test(text)) return <span className={className}>{text}</span>;

  return <span className={className}>{text}</span>;
}

