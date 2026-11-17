import { useState } from 'react';
import { getInitials } from '../utils/formatters';

interface AvatarProps {
  name: string;
  avatarUrl?: string | null;
  online?: boolean;
  showPresenceDot?: boolean;
  size?: 'sm' | 'md' | 'lg';
}

const SIZE_CLASSES = {
  sm: 'w-9 h-9 text-xs',
  md: 'w-11 h-11 text-sm',
  lg: 'w-12 h-12 text-base',
};

const DOT_CLASSES = {
  sm: 'w-2.5 h-2.5 right-0 bottom-0',
  md: 'w-3 h-3 right-0 bottom-0',
  lg: 'w-3 h-3 right-0.5 bottom-0.5',
};

export function Avatar({
  name,
  avatarUrl,
  online = false,
  showPresenceDot = false,
  size = 'md',
}: AvatarProps) {
  const [imgFailed, setImgFailed] = useState(false);

  return (
    <div className={`relative shrink-0 inline-flex items-center justify-center ${SIZE_CLASSES[size]}`}>
      {avatarUrl && !imgFailed ? (
        <img
          src={avatarUrl}
          alt={name}
          referrerPolicy="no-referrer"
          onError={() => setImgFailed(true)}
          className="w-full h-full rounded-full object-cover border border-slate-200 bg-slate-100"
        />
      ) : (
        <div
          aria-label={name}
          className="w-full h-full rounded-full bg-slate-200 text-slate-700 font-display font-semibold flex items-center justify-center border border-slate-300/70 select-none"
        >
          {getInitials(name)}
        </div>
      )}

      {showPresenceDot && (
        <span
          title={online ? 'Online' : 'Offline'}
          aria-label={online ? 'Online' : 'Offline'}
          className={`absolute rounded-full ring-2 ring-white ${DOT_CLASSES[size]} ${
            online ? 'bg-emerald-600' : 'bg-slate-400'
          }`}
        />
      )}
    </div>
  );
}
