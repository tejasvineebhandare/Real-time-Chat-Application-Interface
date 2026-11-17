import { Check, CheckCheck, Download, FileText } from 'lucide-react';
import { getAuthorizedFileUrl } from '../services/apiClient';
import type { Attachment, ChatMessage } from '../types/chat';
import { formatFileSize, formatMessageTime } from '../utils/formatters';

interface MessageBubbleProps {
  message: ChatMessage;
  isOwn: boolean;
  onPreviewImage: (attachment: Attachment) => void;
}

export function MessageBubble({ message, isOwn, onPreviewImage }: MessageBubbleProps) {
  const attachment = message.attachment;
  const isImage = Boolean(attachment && attachment.mimeType.startsWith('image/'));

  return (
    <div className={`flex flex-col ${isOwn ? 'items-end' : 'items-start'}`}>
      <div
        className={`max-w-[82%] sm:max-w-[70%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed ${
          isOwn
            ? 'bg-teal-700 text-white rounded-br-sm'
            : 'bg-slate-100 text-slate-900 border border-slate-200/80 rounded-bl-sm'
        }`}
      >
        {attachment && isImage && (
          <button
            type="button"
            onClick={() => onPreviewImage(attachment)}
            className="block mb-2 overflow-hidden rounded-xl border border-black/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-500 cursor-pointer"
          >
            <img
              src={getAuthorizedFileUrl(attachment.url)}
              alt={attachment.originalName}
              referrerPolicy="no-referrer"
              className="max-h-64 w-auto object-cover bg-slate-200/40"
            />
          </button>
        )}

        {attachment && !isImage && (
          <div
            className={`mb-2 flex items-center justify-between gap-3 rounded-xl px-3 py-2.5 border ${
              isOwn
                ? 'bg-teal-800/70 border-teal-600/60 text-white'
                : 'bg-white border-slate-200 text-slate-900'
            }`}
          >
            <div className="flex items-center gap-2.5 min-w-0">
              <div
                className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${
                  isOwn ? 'bg-teal-900/70 text-teal-100' : 'bg-slate-100 text-slate-600'
                }`}
              >
                <FileText className="w-4 h-4" />
              </div>
              <div className="min-w-0">
                <p className="text-xs font-medium truncate">{attachment.originalName}</p>
                <p
                  className={`text-[11px] font-mono-tabular ${
                    isOwn ? 'text-teal-100/80' : 'text-slate-500'
                  }`}
                >
                  {formatFileSize(attachment.sizeBytes)}
                </p>
              </div>
            </div>

            <a
              href={getAuthorizedFileUrl(attachment.downloadUrl)}
              download={attachment.originalName}
              title={`Download ${attachment.originalName}`}
              className={`p-2 rounded-lg transition-colors shrink-0 ${
                isOwn
                  ? 'hover:bg-teal-900/60 text-teal-50'
                  : 'hover:bg-slate-100 text-slate-600 hover:text-slate-900'
              }`}
            >
              <Download className="w-4 h-4" />
            </a>
          </div>
        )}

        {message.content && (
          <p className="whitespace-pre-wrap break-words">{message.content}</p>
        )}

        <div
          className={`mt-1 flex items-center justify-end gap-1.5 text-[11px] font-mono-tabular ${
            isOwn ? 'text-teal-100/85' : 'text-slate-500'
          }`}
        >
          <span>{formatMessageTime(message.createdAt)}</span>
          {isOwn && (
            <span title={message.readAt ? 'Read' : 'Delivered'} aria-label={message.readAt ? 'Read' : 'Delivered'}>
              {message.readAt ? (
                <CheckCheck className="w-3.5 h-3.5 text-teal-100" />
              ) : (
                <Check className="w-3.5 h-3.5 text-teal-100/75" />
              )}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
