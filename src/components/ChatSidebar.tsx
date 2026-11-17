import { useMemo, useState } from 'react';
import { LogOut, MessageSquare, Search } from 'lucide-react';
import type { ConversationPeer, UserProfile } from '../types/chat';
import { formatLastSeen, formatMessageTime } from '../utils/formatters';
import { Avatar } from './Avatar';

interface ChatSidebarProps {
  currentUser: UserProfile;
  peers: ConversationPeer[];
  selectedPeerId: string | null;
  loading: boolean;
  onSelectPeer: (peerId: string) => void;
  onLogout: () => void;
}

export function ChatSidebar({
  currentUser,
  peers,
  selectedPeerId,
  loading,
  onSelectPeer,
  onLogout,
}: ChatSidebarProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [filterMode, setFilterMode] = useState<'all' | 'online'>('all');

  const onlineCount = useMemo(() => peers.filter((p) => p.online).length, [peers]);

  const filteredPeers = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    return peers
      .filter((peer) => {
        if (filterMode === 'online' && !peer.online) return false;
        if (!query) return true;
        return (
          peer.name.toLowerCase().includes(query) ||
          peer.role.toLowerCase().includes(query) ||
          peer.email.toLowerCase().includes(query)
        );
      })
      .sort((a, b) => {
        const timeA = a.lastMessage?.createdAt ?? 0;
        const timeB = b.lastMessage?.createdAt ?? 0;
        if (timeA !== timeB) return timeB - timeA;
        if (a.online !== b.online) return a.online ? -1 : 1;
        return a.name.localeCompare(b.name);
      });
  }, [peers, searchQuery, filterMode]);

  return (
    <aside className="w-full md:w-80 lg:w-[340px] shrink-0 h-full bg-slate-100/75 border-r border-slate-200 flex flex-col">
      {/* Workspace Brand Header */}
      <div className="px-4 pt-4 pb-3 border-b border-slate-200 bg-white">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-8 h-8 rounded-lg bg-teal-700 text-white flex items-center justify-center shrink-0">
              <MessageSquare className="w-4 h-4" />
            </div>
            <span className="font-display text-base font-bold tracking-tight text-slate-900 truncate">
              RelayChat
            </span>
          </div>
          <span className="text-xs text-slate-500 font-mono-tabular whitespace-nowrap shrink-0">
            {onlineCount} online
          </span>
        </div>

        {/* Search Input */}
        <div className="mt-3 relative">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search people..."
            aria-label="Search people"
            className="w-full pl-9 pr-3 py-2 text-sm bg-slate-50 border border-slate-200 rounded-lg text-slate-900 placeholder:text-slate-400 focus:outline-none focus:bg-white focus:border-teal-700 focus:ring-2 focus:ring-teal-700/15 transition-colors"
          />
        </div>

        {/* Interactive Segmented Filter */}
        <div className="mt-2.5 grid grid-cols-2 gap-1 p-1 bg-slate-100 rounded-lg">
          <button
            type="button"
            onClick={() => setFilterMode('all')}
            className={`py-1.5 px-2.5 text-xs font-medium rounded-md transition-colors cursor-pointer whitespace-nowrap ${
              filterMode === 'all'
                ? 'bg-white text-slate-900 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            All ({peers.length})
          </button>
          <button
            type="button"
            onClick={() => setFilterMode('online')}
            className={`py-1.5 px-2.5 text-xs font-medium rounded-md transition-colors cursor-pointer whitespace-nowrap ${
              filterMode === 'online'
                ? 'bg-white text-slate-900 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Online ({onlineCount})
          </button>
        </div>
      </div>

      {/* User Directory List */}
      <div className="flex-1 overflow-y-auto chat-scroll divide-y divide-slate-200/70">
        {loading && peers.length === 0 ? (
          <div className="p-4 space-y-3">
            {[1, 2, 3].map((idx) => (
              <div key={idx} className="flex items-center gap-3 animate-pulse">
                <div className="w-11 h-11 rounded-full bg-slate-200 shrink-0" />
                <div className="flex-1 space-y-2">
                  <div className="h-3.5 bg-slate-200 rounded w-1/2" />
                  <div className="h-3 bg-slate-200 rounded w-3/4" />
                </div>
              </div>
            ))}
          </div>
        ) : filteredPeers.length === 0 ? (
          <div className="p-6 text-center text-sm text-slate-500">
            {searchQuery || filterMode === 'online'
              ? 'No matching users found.'
              : 'No other users have registered yet.'}
          </div>
        ) : (
          filteredPeers.map((peer) => {
            const isSelected = peer.id === selectedPeerId;
            const previewText = peer.lastMessage
              ? peer.lastMessage.content ||
                (peer.lastMessage.hasAttachment ? 'Sent an attachment' : '')
              : peer.online
                ? `${peer.role} · Online`
                : `${peer.role} · ${formatLastSeen(peer.lastSeen)}`;

            return (
              <button
                key={peer.id}
                type="button"
                onClick={() => onSelectPeer(peer.id)}
                className={`w-full px-4 py-3 flex items-start gap-3 text-left transition-colors cursor-pointer ${
                  isSelected
                    ? 'bg-teal-50/80 hover:bg-teal-50'
                    : 'bg-transparent hover:bg-slate-200/45'
                }`}
              >
                <Avatar
                  name={peer.name}
                  avatarUrl={peer.avatarUrl}
                  online={peer.online}
                  showPresenceDot={true}
                  size="md"
                />

                <div className="flex-1 min-w-0">
                  <div className="flex items-baseline justify-between gap-2">
                    <span
                      className={`text-sm font-medium truncate ${
                        isSelected ? 'text-teal-950' : 'text-slate-900'
                      }`}
                    >
                      {peer.name}
                    </span>
                    <span className="text-[11px] text-slate-500 font-mono-tabular shrink-0">
                      {peer.lastMessage
                        ? formatMessageTime(peer.lastMessage.createdAt)
                        : peer.online
                          ? 'Online'
                          : 'Offline'}
                    </span>
                  </div>

                  <div className="mt-0.5 flex items-center justify-between gap-2">
                    <p className="text-xs text-slate-600 truncate">
                      {peer.lastMessage && peer.lastMessage.senderId === currentUser.id ? 'You: ' : ''}
                      {previewText}
                    </p>
                    {peer.unreadCount > 0 && (
                      <span className="inline-flex items-center justify-center min-w-5 h-5 px-1.5 rounded-full bg-teal-700 text-white text-[11px] font-mono-tabular font-medium shrink-0">
                        {peer.unreadCount}
                      </span>
                    )}
                  </div>
                </div>
              </button>
            );
          })
        )}
      </div>

      {/* Current User Profile Footer */}
      <div className="px-4 py-3 border-t border-slate-200 bg-white flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <Avatar
            name={currentUser.name}
            avatarUrl={currentUser.avatarUrl}
            online={true}
            showPresenceDot={true}
            size="sm"
          />
          <div className="min-w-0">
            <p className="text-sm font-medium text-slate-900 truncate">{currentUser.name}</p>
            <p className="text-xs text-slate-500 truncate">{currentUser.email}</p>
          </div>
        </div>

        <button
          type="button"
          onClick={onLogout}
          title="Sign out"
          aria-label="Sign out"
          className="inline-flex items-center gap-1.5 px-2.5 py-2 text-xs font-medium text-slate-700 hover:text-red-700 hover:bg-red-50 rounded-lg transition-colors cursor-pointer shrink-0 whitespace-nowrap"
        >
          <LogOut className="w-4 h-4" />
          <span className="hidden sm:inline">Sign out</span>
        </button>
      </div>
    </aside>
  );
}
