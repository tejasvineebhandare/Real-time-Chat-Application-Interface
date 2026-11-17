import type {
  ChatMessage,
  ConversationPeer,
  PresenceUpdateEvent,
  ReadReceiptEvent,
  TypingUpdateEvent,
} from '../types/chat';
import { apiFetch } from './apiClient';
import { authService } from './authService';
import { socketService, type SocketStateSnapshot } from './socketService';

export interface ChatStoreState {
  peers: ConversationPeer[];
  selectedPeerId: string | null;
  messagesByPeer: Record<string, ChatMessage[]>;
  loadingPeers: boolean;
  loadingMessages: boolean;
  error: string | null;
  typingByPeer: Record<string, boolean>;
  socketState: SocketStateSnapshot;
}

type StoreListener = (state: ChatStoreState) => void;

class ChatStore {
  private state: ChatStoreState = {
    peers: [],
    selectedPeerId: null,
    messagesByPeer: {},
    loadingPeers: false,
    loadingMessages: false,
    error: null,
    typingByPeer: {},
    socketState: socketService.getState(),
  };

  private listeners = new Set<StoreListener>();
  private socketUnsubs: Array<() => void> = [];
  private initializedForUserId: string | null = null;

  private emit(): void {
    this.listeners.forEach((listener) => listener(this.state));
  }

  private setState(partial: Partial<ChatStoreState>): void {
    this.state = { ...this.state, ...partial };
    this.emit();
  }

  getState(): ChatStoreState {
    return this.state;
  }

  subscribe(listener: StoreListener): () => void {
    this.listeners.add(listener);
    listener(this.state);
    return () => {
      this.listeners.delete(listener);
    };
  }

  async initializeSession(): Promise<void> {
    const session = authService.getSession();
    if (!session) {
      this.teardown();
      return;
    }

    if (this.initializedForUserId === session.user.id) {
      return;
    }

    this.teardown();
    this.initializedForUserId = session.user.id;

    socketService.connect(session.token);

    this.socketUnsubs = [
      socketService.onStateChange((socketState) => {
        this.setState({ socketState });
      }),
      socketService.onMessage((message) => {
        this.handleIncomingMessage(message);
      }),
      socketService.onPresence((event) => {
        this.handlePresenceUpdate(event);
      }),
      socketService.onTyping((event) => {
        this.handleTypingUpdate(event);
      }),
      socketService.onReadReceipt((event) => {
        this.handleReadReceipt(event);
      }),
      socketService.onUserRegistered((newUser) => {
        const currentUserId = authService.getCurrentUser()?.id;
        if (!currentUserId || newUser.id === currentUserId) return;
        const exists = this.state.peers.some((p) => p.id === newUser.id);
        if (!exists) {
          this.setState({
            peers: [...this.state.peers, { ...newUser, unreadCount: 0, lastMessage: null }],
          });
        }
      }),
    ];

    await this.loadPeers();
  }

  teardown(): void {
    this.socketUnsubs.forEach((unsub) => unsub());
    this.socketUnsubs = [];
    this.initializedForUserId = null;
    socketService.disconnect();
    this.setState({
      peers: [],
      selectedPeerId: null,
      messagesByPeer: {},
      loadingPeers: false,
      loadingMessages: false,
      error: null,
      typingByPeer: {},
      socketState: socketService.getState(),
    });
  }

  async loadPeers(): Promise<void> {
    this.setState({ loadingPeers: true, error: null });
    try {
      const data = await apiFetch<{ users: ConversationPeer[] }>('/api/users');
      const peers = data.users;
      const currentSelected = this.state.selectedPeerId;
      const stillValid = currentSelected && peers.some((p) => p.id === currentSelected);

      this.setState({
        peers,
        loadingPeers: false,
      });

      // On desktop default-select first peer if none selected yet
      if (!stillValid && peers.length > 0 && typeof window !== 'undefined' && window.innerWidth >= 768) {
        await this.selectPeer(peers[0].id);
      }
    } catch (err) {
      this.setState({
        loadingPeers: false,
        error: err instanceof Error ? err.message : 'Unable to load contacts.',
      });
    }
  }

  async selectPeer(peerId: string | null): Promise<void> {
    if (!peerId) {
      this.setState({ selectedPeerId: null });
      return;
    }

    this.setState({
      selectedPeerId: peerId,
      loadingMessages: true,
      error: null,
      peers: this.state.peers.map((p) => (p.id === peerId ? { ...p, unreadCount: 0 } : p)),
    });

    try {
      const data = await apiFetch<{ messages: ChatMessage[] }>(`/api/messages/${peerId}`);
      this.setState({
        loadingMessages: false,
        messagesByPeer: {
          ...this.state.messagesByPeer,
          [peerId]: data.messages,
        },
      });
      socketService.markRead(peerId);
    } catch (err) {
      this.setState({
        loadingMessages: false,
        error: err instanceof Error ? err.message : 'Failed to load message history.',
      });
    }
  }

  async sendMessage(recipientId: string, content: string, attachmentId?: string | null): Promise<void> {
    const clientMessageId =
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random()}`;

    const delivered = await socketService.sendMessage({
      recipientId,
      content,
      attachmentId: attachmentId ?? null,
      clientMessageId,
    });

    // Idempotent insert in case socket broadcast arrived before ack
    this.handleIncomingMessage(delivered);
  }

  private handleIncomingMessage(message: ChatMessage): void {
    const currentUserId = authService.getCurrentUser()?.id;
    if (!currentUserId) return;

    const peerId = message.senderId === currentUserId ? message.recipientId : message.senderId;
    const existingList = this.state.messagesByPeer[peerId] ?? [];

    // Idempotent deduplication by message ID
    if (existingList.some((m) => m.id === message.id)) {
      return;
    }

    const isViewingPeer = this.state.selectedPeerId === peerId;
    const isIncomingFromPeer = message.senderId === peerId;

    if (isViewingPeer && isIncomingFromPeer) {
      socketService.markRead(peerId);
    }

    const nextMessages = [...existingList, message];

    const updatedPeers = this.state.peers.map((peer) => {
      if (peer.id !== peerId) return peer;
      return {
        ...peer,
        unreadCount:
          isIncomingFromPeer && !isViewingPeer ? peer.unreadCount + 1 : isViewingPeer ? 0 : peer.unreadCount,
        lastMessage: {
          id: message.id,
          content: message.content,
          senderId: message.senderId,
          createdAt: message.createdAt,
          hasAttachment: Boolean(message.attachment),
        },
      };
    });

    this.setState({
      messagesByPeer: {
        ...this.state.messagesByPeer,
        [peerId]: nextMessages,
      },
      peers: updatedPeers,
      typingByPeer: isIncomingFromPeer
        ? { ...this.state.typingByPeer, [peerId]: false }
        : this.state.typingByPeer,
    });
  }

  private handlePresenceUpdate(event: PresenceUpdateEvent): void {
    this.setState({
      peers: this.state.peers.map((peer) =>
        peer.id === event.userId
          ? { ...peer, online: event.online, lastSeen: event.lastSeen }
          : peer
      ),
    });
  }

  private handleTypingUpdate(event: TypingUpdateEvent): void {
    this.setState({
      typingByPeer: {
        ...this.state.typingByPeer,
        [event.userId]: event.isTyping,
      },
    });
  }

  private handleReadReceipt(event: ReadReceiptEvent): void {
    const currentMessages = this.state.messagesByPeer[event.peerId];
    if (!currentMessages) return;

    const currentUserId = authService.getCurrentUser()?.id;
    const updated = currentMessages.map((m) =>
      m.senderId === currentUserId && !m.readAt ? { ...m, readAt: event.readAt } : m
    );

    this.setState({
      messagesByPeer: {
        ...this.state.messagesByPeer,
        [event.peerId]: updated,
      },
    });
  }
}

export const chatStore = new ChatStore();
