import { useState } from 'react';
import { ImageOff } from 'lucide-react';

export default function ChannelMedia({ src, name }: { src: string; name: string }) {
  const [failed, setFailed] = useState('');
  if (!/^https?:\/\//i.test(src) || failed === src)
    return (
      <div className="tg-image-fallback">
        <ImageOff size={25} />
        <span>图片暂时无法显示</span>
      </div>
    );
  return (
    <img
      className="tg-message-image"
      src={src}
      alt={name}
      loading="lazy"
      referrerPolicy="no-referrer"
      onError={() => setFailed(src)}
    />
  );
}
