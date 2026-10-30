import React, { useState } from "react";
import { Headphones } from "lucide-react";

interface ResilientImageProps {
  src: string;
  alt: string;
  className?: string;
  imgClassName?: string;
  fallbackLabel?: string;
}

export const ResilientImage: React.FC<ResilientImageProps> = ({
  src,
  alt,
  className = "",
  imgClassName,
  fallbackLabel,
}) => {
  const [hasError, setHasError] = useState(false);

  if (hasError || !src) {
    return (
      <div
        role="img"
        aria-label={alt}
        className={`flex flex-col items-center justify-center bg-gradient-to-br from-slate-100 via-slate-50 to-blue-50 text-slate-600 dark:from-slate-900 dark:via-slate-900 dark:to-slate-800 dark:text-slate-300 p-6 text-center ${className}`}
      >
        <Headphones className="w-8 h-8 text-blue-700 dark:text-blue-400 mb-2 shrink-0" aria-hidden="true" />
        <span className="text-xs font-medium max-w-xs">
          {fallbackLabel || alt}
        </span>
      </div>
    );
  }

  return (
    <img
      src={src}
      alt={alt}
      referrerPolicy="no-referrer"
      onError={() => setHasError(true)}
      className={imgClassName || className}
    />
  );
};
