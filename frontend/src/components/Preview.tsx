import { useState } from 'react';

interface Props {
  sources: string[];
  alt: string;
  placeholder: string;
}

/** Tries each source in turn (e.g. server thumbnail, then local file) before a placeholder. */
export function Preview({ sources, alt, placeholder }: Props) {
  const [failed, setFailed] = useState<ReadonlySet<string>>(new Set());
  const src = sources.find((s) => !failed.has(s));

  if (!src) {
    return (
      <div className="preview preview--empty" role="img" aria-label={alt}>
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <rect x="3" y="4" width="18" height="16" rx="2" />
          <path d="M3 16l5-5 4 4 3-3 6 6" />
          <circle cx="15.5" cy="8.5" r="1.5" />
        </svg>
        <span>{placeholder}</span>
      </div>
    );
  }

  return (
    <img
      className="preview"
      src={src}
      alt={alt}
      loading="lazy"
      decoding="async"
      onError={() => setFailed((prev) => new Set(prev).add(src))}
    />
  );
}
