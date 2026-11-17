import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
  type FormEvent,
} from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  Download,
  FileText,
  MessageSquare,
  Paperclip,
  RefreshCw,
  Send,
  Upload,
  X,
} from 'lucide-react';
import { getAuthorizedFileUrl } from '../services/apiClient';
import { authService } from '../services/authService';
import { chatStore, type ChatStoreState } from '../services/chatStore';
import { socketService } from '../services/socketService';
import { uploadAttachment, validateFileBeforeUpload } from '../services/uploadService';
import type { Attachment, ChatMessage, UserProfile } from '../types/chat';
import { formatDayDivider, formatFileSize, formatLastSeen } from '../utils/formatters';
import { Avatar } from './Avatar';
import { ChatSidebar } from './ChatSidebar';
import { MessageBubble } from './MessageBubble';

interface ChatDashboardProps {
  currentUser: UserProfile;
  onLogout: () => void;
}

export function ChatDashboard({ currentUser, onLogout }: ChatDashboardProps) {
  const [storeState, setStoreState] = useState<ChatStoreState>(() => chatStore.getState());
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);

  const [stagedFile, setStagedFile] = useState<File | null>(null);
  const [stagedAttachment, setStagedAttachment] = useState<Attachment | null>(null);
  const [uploadProgress, setUploadProgress] = useState<number>(0);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [draggingOver, setDraggingOver] = useState(false);

  const [lightboxImage, setLightboxImage] = useState<Attachment | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const typingTimerRef = useRef<number | null>(null);
  const lastTypingSentRef = useRef<boolean>(false);

  useEffect(() => {
    const unsub = chatStore.subscribe(setStoreState);
    void chatStore.initializeSession();
    return () => {
      unsub();
      if (typingTimerRef.current) window.clearTimeout(typingTimerRef.current);
    };
  }, [currentUser.id]);

  const selectedPeer = useMemo(
    () => storeState.peers.find((p) => p.id === storeState.selectedPeerId) ?? null,
    [storeState.peers, storeState.selectedPeerId]
  );

  const activeMessages = useMemo(
    () => (selectedPeer ? storeState.messagesByPeer[selectedPeer.id] ?? [] : []),
    [selectedPeer, storeState.messagesByPeer]
  );

  const isPeerTyping = selectedPeer ? Boolean(storeState.typingByPeer[selectedPeer.id]) : false;

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [activeMessages.length, selectedPeer?.id, isPeerTyping]);

  // Clear staged upload if switching peer
  useEffect(() => {
    setSendError(null);
    setUploadError(null);
    setStagedFile(null);
    setStagedAttachment(null);
    setUploadProgress(0);
    setUploading(false);
  }, [selectedPeer?.id]);

  const handleSelectFile = async (file: File) => {
    setUploadError(null);
    const validationErr = validateFileBeforeUpload(file);
    if (validationErr) {
      setUploadError(validationErr);
      return;
    }

    setStagedFile(file);
    setStagedAttachment(null);
    setUploadProgress(0);
    setUploading(true);

    try {
      const attachment = await uploadAttachment(file, (pct) => {
        setUploadProgress(pct);
      });
      setStagedAttachment(attachment);
      setUploading(false);
    } catch (err) {
      setUploading(false);
      setStagedFile(null);
      setUploadError(err instanceof Error ? err.message : 'File upload failed.');
    }
  };

  const handleFileInputChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (file) {
      void handleSelectFile(file);
    }
  };

  const handleDragOver = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    if (!selectedPeer) return;
    setDraggingOver(true);
  };

  const handleDragLeave = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDraggingOver(false);
  };

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDraggingOver(false);
    if (!selectedPeer) return;
    const file = e.dataTransfer.files?.[0];
    if (file) {
      void handleSelectFile(file);
    }
  };

  const handleDraftChange = (value: string) => {
    setDraft(value);
    if (!selectedPeer) return;

    const hasText = value.trim().length > 0;
    if (hasText && !lastTypingSentRef.current) {
      socketService.emitTyping(selectedPeer.id, true);
      lastTypingSentRef.current = true;
    }

    if (typingTimerRef.current) {
      window.clearTimeout(typingTimerRef.current);
    }

    if (hasText) {
      typingTimerRef.current = window.setTimeout(() => {
        socketService.emitTyping(selectedPeer.id, false);
        lastTypingSentRef.current = false;
      }, 1500);
    } else if (lastTypingSentRef.current) {
      socketService.emitTyping(selectedPeer.id, false);
      lastTypingSentRef.current = false;
    }
  };

  const handleSend = async (e: FormEvent) => {
    e.preventDefault();
    if (!selectedPeer || sending || uploading) return;

    const trimmed = draft.trim();
    if (!trimmed && !stagedAttachment) return;

    setSendError(null);
    setSending(true);

    if (lastTypingSentRef.current) {
      socketService.emitTyping(selectedPeer.id, false);
      lastTypingSentRef.current = false;
    }

    try {
      await chatStore.sendMessage(selectedPeer.id, trimmed, stagedAttachment?.id ?? null);
      setDraft('');
      setStagedFile(null);
      setStagedAttachment(null);
      setUploadProgress(0);
    } catch (err) {
      setSendError(err instanceof Error ? err.message : 'Unable to send message.');
    } finally {
      setSending(false);
    }
  };

  const handleReconnect = () => {
    const token = authService.getToken();
    if (token) {
      socketService.reconnect(token);
    }
  };

  const showSocketBanner =
    storeState.socketState.state === 'error' ||
    (storeState.socketState.state === 'disconnected' && Boolean(storeState.socketState.error));

  // Group messages with day dividers
  const messageItems = useMemo(() => {
    const items: Array<
      | { type: 'divider'; key: string; label: string }
      | { type: 'message'; key: string; message: ChatMessage }
    > = [];
    let lastDayLabel = '';

    for (const msg of activeMessages) {
      const label = formatDayDivider(msg.createdAt);
      if (label !== lastDayLabel) {
        items.push({ type: 'divider', key: `day-${label}-${msg.createdAt}`, label });
        lastDayLabel = label;
      }
      items.push({ type: 'message', key: msg.id, message: msg });
    }
    return items;
  }, [activeMessages]);

  return (
    <div className="h-dvh w-full bg-white flex overflow-hidden">
      {/* Sidebar: Always visible on md+, hidden on mobile when a peer is active */}
      <div className={`${selectedPeer ? 'hidden md:flex' : 'flex'} w-full md:w-auto h-full`}>
        <ChatSidebar
          currentUser={currentUser}
          peers={storeState.peers}
          selectedPeerId={storeState.selectedPeerId}
          loading={storeState.loadingPeers}
          onSelectPeer={(peerId) => void chatStore.selectPeer(peerId)}
          onLogout={() => {
            chatStore.teardown();
            onLogout();
          }}
        />
      </div>

      {/* Main Chat Viewport */}
      <main
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={`${
          selectedPeer ? 'flex' : 'hidden md:flex'
        } flex-1 flex-col h-full min-w-0 bg-white relative`}
      >
        {/* Real-Time Connection Failure / Disconnect Banner */}
        {showSocketBanner && (
          <div
            role="alert"
            className="px-4 py-2.5 bg-red-50 border-b border-red-200 flex items-center justify-between gap-3 text-xs sm:text-sm text-red-900"
          >
            <div className="flex items-center gap-2 min-w-0">
              <AlertTriangle className="w-4 h-4 text-red-600 shrink-0" />
              <span className="truncate">
                {storeState.socketState.error || 'Real-time connection interrupted.'}
              </span>
            </div>
            <button
              type="button"
              onClick={handleReconnect}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-white border border-red-200 text-red-800 hover:bg-red-100/70 text-xs font-medium cursor-pointer shrink-0 whitespace-nowrap"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>Reconnect</span>
            </button>
          </div>
        )}

        {!selectedPeer ? (
          <div className="flex-1 flex flex-col items-center justify-center p-8 text-center bg-slate-50/50">
            <div className="w-12 h-12 rounded-xl bg-teal-50 border border-teal-100 text-teal-700 flex items-center justify-center mb-4">
              <MessageSquare className="w-6 h-6" />
            </div>
            <h2 className="font-display text-lg font-semibold text-slate-900">
              Select a teammate to start messaging
            </h2>
            <p className="mt-1.5 max-w-sm text-sm text-slate-600">
              Choose a conversation from the directory to exchange instant messages, share files, and view real-time online presence.
            </p>
          </div>
        ) : (
          <>
            {/* Chat Header */}
            <header className="px-4 sm:px-6 py-3.5 border-b border-slate-200 bg-white flex items-center justify-between gap-4 shrink-0">
              <div className="flex items-center gap-3 min-w-0">
                <button
                  type="button"
                  onClick={() => void chatStore.selectPeer(null)}
                  aria-label="Back to conversations"
                  className="md:hidden p-2 -ml-2 rounded-lg text-slate-600 hover:bg-slate-100 hover:text-slate-900 cursor-pointer shrink-0"
                >
                  <ArrowLeft className="w-5 h-5" />
                </button>

                <Avatar
                  name={selectedPeer.name}
                  avatarUrl={selectedPeer.avatarUrl}
                  online={selectedPeer.online}
                  showPresenceDot={true}
                  size="md"
                />

                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <h1 className="font-display text-base font-semibold text-slate-900 truncate">
                      {selectedPeer.name}
                    </h1>
                    <span className="hidden sm:inline text-xs text-slate-400" aria-hidden="true">
                      ·
                    </span>
                    <span className="hidden sm:inline text-xs text-slate-500 truncate">
                      {selectedPeer.role}
                    </span>
                  </div>

                  <div className="flex items-center gap-1.5 text-xs">
                    {isPeerTyping ? (
                      <span className="text-teal-700 font-medium">Typing...</span>
                    ) : selectedPeer.online ? (
                      <>
                        <span className="w-2 h-2 rounded-full bg-emerald-600 shrink-0" />
                        <span className="text-emerald-700 font-medium">Online</span>
                      </>
                    ) : (
                      <>
                        <span className="w-2 h-2 rounded-full bg-slate-400 shrink-0" />
                        <span className="text-slate-500">
                          Offline · {formatLastSeen(selectedPeer.lastSeen)}
                        </span>
                      </>
                    )}
                  </div>
                </div>
              </div>
            </header>

            {/* Message History Area */}
            <div className="flex-1 overflow-y-auto chat-scroll px-4 sm:px-6 py-5 space-y-3 bg-slate-50/40">
              {storeState.loadingMessages ? (
                <div className="space-y-4 py-4">
                  <div className="flex justify-start">
                    <div className="h-12 w-56 rounded-2xl bg-slate-200/70 animate-pulse" />
                  </div>
                  <div className="flex justify-end">
                    <div className="h-12 w-64 rounded-2xl bg-teal-700/15 animate-pulse" />
                  </div>
                  <div className="flex justify-start">
                    <div className="h-10 w-44 rounded-2xl bg-slate-200/70 animate-pulse" />
                  </div>
                </div>
              ) : messageItems.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-center py-12">
                  <p className="text-sm font-medium text-slate-700">
                    No messages with {selectedPeer.name} yet
                  </p>
                  <p className="mt-1 text-xs text-slate-500">
                    Send a message or attach a file below to start the conversation.
                  </p>
                </div>
              ) : (
                messageItems.map((item) =>
                  item.type === 'divider' ? (
                    <div key={item.key} className="flex items-center gap-3 py-2">
                      <div className="flex-1 h-px bg-slate-200" />
                      <span className="text-[11px] font-medium text-slate-500">{item.label}</span>
                      <div className="flex-1 h-px bg-slate-200" />
                    </div>
                  ) : (
                    <MessageBubble
                      key={item.key}
                      message={item.message}
                      isOwn={item.message.senderId === currentUser.id}
                      onPreviewImage={(att) => setLightboxImage(att)}
                    />
                  )
                )
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* Drag-and-Drop Overlay */}
            {draggingOver && (
              <div className="absolute inset-0 z-20 bg-teal-950/20 backdrop-blur-[1px] border-2 border-dashed border-teal-700 m-3 rounded-xl flex flex-col items-center justify-center pointer-events-none">
                <div className="bg-white border border-slate-200 rounded-xl px-6 py-4 shadow-sm flex items-center gap-3">
                  <Upload className="w-5 h-5 text-teal-700" />
                  <span className="text-sm font-medium text-slate-900">
                    Drop file to attach to {selectedPeer.name}
                  </span>
                </div>
              </div>
            )}

            {/* Composer Area */}
            <footer className="px-4 sm:px-6 py-3.5 border-t border-slate-200 bg-white shrink-0">
              {(uploadError || sendError || storeState.error) && (
                <div
                  role="alert"
                  className="mb-2.5 flex items-center justify-between gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800"
                >
                  <span>{uploadError || sendError || storeState.error}</span>
                  <button
                    type="button"
                    onClick={() => {
                      setUploadError(null);
                      setSendError(null);
                    }}
                    className="p-0.5 text-red-700 hover:text-red-900 cursor-pointer"
                    aria-label="Dismiss error"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}

              {(stagedFile || stagedAttachment) && (
                <div className="mb-2.5 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <FileText className="w-4 h-4 text-teal-700 shrink-0" />
                      <div className="min-w-0">
                        <p className="text-xs font-medium text-slate-800 truncate">
                          {stagedAttachment?.originalName ?? stagedFile?.name}
                        </p>
                        <p className="text-[11px] text-slate-500 font-mono-tabular">
                          {formatFileSize(stagedAttachment?.sizeBytes ?? stagedFile?.size ?? 0)}
                          {uploading ? ` · Uploading ${uploadProgress}%` : ' · Ready to send'}
                        </p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setStagedFile(null);
                        setStagedAttachment(null);
                        setUploading(false);
                        setUploadProgress(0);
                      }}
                      aria-label="Remove attachment"
                      className="p-1 text-slate-500 hover:text-slate-900 rounded cursor-pointer"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>

                  {uploading && (
                    <div className="mt-2 h-1.5 w-full bg-slate-200 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-teal-700 transition-all duration-150"
                        style={{ width: `${uploadProgress}%` }}
                      />
                    </div>
                  )}
                </div>
              )}

              <form onSubmit={handleSend} className="flex items-center gap-2.5">
                <input
                  ref={fileInputRef}
                  type="file"
                  onChange={handleFileInputChange}
                  accept="image/*,.pdf,.txt,.csv,.doc,.docx,.xls,.xlsx,.zip"
                  className="hidden"
                />

                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploading}
                  title="Attach file (images, PDF, documents, ZIP up to 10 MB)"
                  aria-label="Attach file"
                  className="w-10 h-10 rounded-lg border border-slate-200 text-slate-600 hover:text-slate-900 hover:bg-slate-50 disabled:opacity-50 flex items-center justify-center transition-colors cursor-pointer shrink-0"
                >
                  <Paperclip className="w-4 h-4" />
                </button>

                <input
                  type="text"
                  value={draft}
                  onChange={(e) => handleDraftChange(e.target.value)}
                  placeholder={`Message ${selectedPeer.name}...`}
                  aria-label="Message input"
                  className="flex-1 min-w-0 px-3.5 py-2.5 text-sm bg-slate-50 border border-slate-200 rounded-lg text-slate-900 placeholder:text-slate-400 focus:outline-none focus:bg-white focus:border-teal-700 focus:ring-2 focus:ring-teal-700/15 transition-colors"
                />

                <button
                  type="submit"
                  disabled={sending || uploading || (!draft.trim() && !stagedAttachment)}
                  aria-label="Send message"
                  className="inline-flex items-center gap-1.5 px-4 py-2.5 bg-teal-700 hover:bg-teal-800 disabled:opacity-45 disabled:cursor-not-allowed text-white text-sm font-medium rounded-lg transition-colors cursor-pointer shrink-0 whitespace-nowrap"
                >
                  <Send className="w-4 h-4" />
                  <span className="hidden sm:inline">Send</span>
                </button>
              </form>
            </footer>
          </>
        )}
      </main>

      {/* Lightbox Modal for Image Attachments */}
      {lightboxImage && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={lightboxImage.originalName}
          onClick={() => setLightboxImage(null)}
          className="fixed inset-0 z-50 bg-slate-950/80 flex items-center justify-center p-4"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="max-w-4xl w-full bg-white rounded-xl overflow-hidden border border-slate-200 shadow-lg"
          >
            <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between gap-4">
              <div className="min-w-0">
                <p className="text-sm font-medium text-slate-900 truncate">
                  {lightboxImage.originalName}
                </p>
                <p className="text-xs text-slate-500 font-mono-tabular">
                  {formatFileSize(lightboxImage.sizeBytes)}
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <a
                  href={getAuthorizedFileUrl(lightboxImage.downloadUrl)}
                  download={lightboxImage.originalName}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-teal-700 hover:bg-teal-800 text-white rounded-lg transition-colors whitespace-nowrap"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>Download</span>
                </a>
                <button
                  type="button"
                  onClick={() => setLightboxImage(null)}
                  aria-label="Close preview"
                  className="p-1.5 rounded-lg text-slate-500 hover:text-slate-900 hover:bg-slate-100 cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>
            <div className="bg-slate-900 flex items-center justify-center max-h-[75vh] overflow-auto p-4">
              <img
                src={getAuthorizedFileUrl(lightboxImage.url)}
                alt={lightboxImage.originalName}
                referrerPolicy="no-referrer"
                className="max-h-[68vh] w-auto object-contain rounded"
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
