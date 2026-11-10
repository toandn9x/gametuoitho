import React, { useEffect, useRef, useState } from 'react';

interface GameIconProps {
  src?: string | null;
  name: string;
  size?: 'card' | 'detail';
  loading?: 'lazy' | 'eager';
}

export default function GameIcon({ src, name, size = 'card', loading = 'lazy' }: GameIconProps) {
  const source = src || '';
  const imageRef = useRef<HTMLImageElement>(null);
  const [image, setImage] = useState<{ source: string; width: number; height: number; failed: boolean }>();
  const current = image?.source === source ? image : undefined;

  const measure = (element: HTMLImageElement) => {
    setImage({ source, width: element.naturalWidth, height: element.naturalHeight, failed: !element.naturalWidth });
  };

  useEffect(() => {
    // Cached/SSR images can finish loading before React attaches its load handler.
    if (imageRef.current?.complete) measure(imageRef.current);
  }, [source]);

  return (
    <div
      className={`game-icon flex shrink-0 items-center justify-center overflow-hidden rounded-xl border border-arcade-700/70 bg-arcade-950 p-2 ${
        size === 'detail' ? 'h-20 w-20 sm:h-24 sm:w-24' : 'h-14 w-14 sm:h-16 sm:w-16'
      }`}
    >
      {source && !current?.failed ? (
        <img
          ref={imageRef}
          src={source}
          alt={name}
          loading={loading}
          decoding="async"
          className="h-full w-full object-contain"
          // Tiny MIDlet icons should never become large posters. Keep aspect ratio,
          // and limit enlargement to 2x even when the surrounding frame has room.
          style={current ? { maxWidth: current.width * 2, maxHeight: current.height * 2 } : undefined}
          onLoad={(event) => measure(event.currentTarget)}
          onError={() => setImage({ source, width: 0, height: 0, failed: true })}
        />
      ) : (
        <span role="img" aria-label="Chưa có ảnh bìa" className="text-3xl">🎮</span>
      )}
    </div>
  );
}
