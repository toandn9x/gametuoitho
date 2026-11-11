import React, { useEffect, useState } from 'react';
import { getGameDetail } from '../lib/api';
import Nokia1280 from './Nokia1280';

interface HomeGamePreviewProps {
  slug: string;
  previewSrc: string;
}

type GameDetail = NonNullable<Awaited<ReturnType<typeof getGameDetail>>['data']>;

export default function HomeGamePreview({ slug, previewSrc }: HomeGamePreviewProps) {
  const [detail, setDetail] = useState<GameDetail>();
  const [loading, setLoading] = useState(true);
  const [failedImages, setFailedImages] = useState<string[]>([]);

  useEffect(() => {
    let active = true;
    setDetail(undefined);
    setLoading(true);
    setFailedImages([]);
    getGameDetail(slug)
      .then(response => {
        if (active && response.success && response.data) setDetail(response.data);
      })
      .catch(() => { /* Keep the phone's catalog fallback available offline. */ })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [slug]);

  // Prefer catalog screenshots. The bundled hero artwork is a captured game screen,
  // so the banner stays lightweight even when the catalog has no screenshots yet.
  const image = [detail?.screenshots[0]?.url, previewSrc]
    .find(source => source && !failedImages.includes(source));
  const phone = (
    <Nokia1280>
      {detail && image ? (
        <img
          src={image}
          alt={`Màn hình ${detail.game.name}`}
          width="240"
          height="320"
          decoding="async"
          className="block h-full w-full object-contain bg-black [image-rendering:pixelated]"
          onError={() => setFailedImages(previous => [...previous, image])}
        />
      ) : (
        <div role="status" className="flex h-full items-center justify-center p-4 text-center text-sm leading-relaxed text-arcade-950">
          {loading ? 'Đang tải thông tin game…' : detail ? detail.game.name : 'Khám phá kho game tuổi thơ'}
        </div>
      )}
    </Nokia1280>
  );

  return (
    <div className="flex w-full flex-col items-center">
      {detail ? (
        <a
          href={`/play/${detail.game.slug}`}
          aria-label={`Chơi ${detail.game.name}`}
          className="flex w-full flex-col items-center rounded-3xl focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-8 focus-visible:outline-neon-cyan"
        >
          {phone}
        </a>
      ) : phone}
    </div>
  );
}
