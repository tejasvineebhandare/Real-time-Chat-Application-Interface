import { io, type Socket } from 'socket.io-client';
import type {
  ChatMessage,
  ConnectionState,
  ConversationPeer,
  PresenceUpdateEvent,
  ReadReceiptEvent,
  TypingUpdateEvent,
} from '../types/chat';

export interface SocketStateSnapshot {
  state: ConnectionState;
  error: string | null;
}

type StateListener = (snapshot: SocketStateSnapshot) => void;
type MessageListener = (message: ChatMessage) => void;
type PresenceListener = (event: PresenceUpdateEvent) => void;
type TypingListener = (event: TypingUpdateEvent) => void;
type ReadReceiptListener = (event: ReadReceiptEvent) => void;
type UserRegisteredListener = (user: ConversationPeer) => void;

class SocketService {
  private socket: Socket | null = null;
  private snapshot: SocketStateSnapshot = { state: 'disconnected', error: null };

  private stateListeners = new Set<StateListener>();
  private messageListeners = new Set<MessageListener>();
  private presenceListeners = new Set<PresenceListener>();
  private typingListeners = new Set<TypingListener>();
  private readListeners = new Set<ReadReceiptListener>();
  private userRegisteredListeners = new Set<UserRegisteredListener>();

  private updateState(state: ConnectionState, error: string | null = null): void {
    this.snapshot = { state, error };
    this.stateListeners.forEach((listener) => listener(this.snapshot));
  }

  getState(): SocketStateSnapshot {
    return this.snapshot;
  }

  connect(token: string): void {
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
    }

    this.updateState('connecting', null);

    const socket = io({
      auth: { token },
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
    });

    socket.on('connect', () => {
      this.updateState('connected', null);
    });

    socket.on('disconnect', (reason) => {
      if (reason === 'io client disconnect') {
        this.updateState('disconnected', null);
      } else {
        this.updateState('disconnected', 'Connection lost. Attempting to reconnect...');
      }
    });

    socket.on('connect_error', (err) => {
      this.updateState('error', err.message || 'Unable to connect to real-time server.');
    });

    socket.on('message:new', (message: ChatMessage) => {
      this.messageListeners.forEach((listener) => listener(message));
    });

    socket.on('presence:update', (event: PresenceUpdateEvent) => {
      this.presenceListeners.forEach((listener) => listener(event));
    });

    socket.on('typing:update', (event: TypingUpdateEvent) => {
      this.typingListeners.forEach((listener) => listener(event));
    });

    socket.on('messages:read_receipt', (event: ReadReceiptEvent) => {
      this.readListeners.forEach((listener) => listener(event));
    });

    socket.on('user:registered', (user: ConversationPeer) => {
      this.userRegisteredListeners.forEach((listener) => listener(user));
    });

    this.socket = socket;
  }

  disconnect(): void {
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
    }
    this.updateState('disconnected', null);
  }

  reconnect(token: string): void {
    this.connect(token);
  }

  sendMessage(payload: {
    recipientId: string;
    content: string;
    attachmentId?: string | null;
    clientMessageId?: string;
  }): Promise<ChatMessage> {
    return new Promise((resolve, reject) => {
      if (!this.socket || !this.socket.connected) {
        reject(new Error('Not connected to real-time server.'));
        return;
      }

      this.socket.emit(
        'message:send',
        payload,
        (ack: { ok: boolean; message?: ChatMessage; error?: string }) => {
          if (ack?.ok && ack.message) {
            resolve(ack.message);
          } else {
            reject(new Error(ack?.error || 'Failed to deliver message.'));
          }
        }
      );
    });
  }

  markRead(peerId: string): void {
    this.socket?.emit('messages:read', { peerId });
  }

  emitTyping(recipientId: string, isTyping: boolean): void {
    if (!this.socket?.connected) return;
    this.socket.emit(isTyping ? 'typing:start' : 'typing:stop', { recipientId });
  }

  onStateChange(listener: StateListener): () => void {
    this.stateListeners.add(listener);
    listener(this.snapshot);
    return () => this.stateListeners.delete(listener);
  }

  onMessage(listener: MessageListener): () => void {
    this.messageListeners.add(listener);
    return () => this.messageListeners.delete(listener);
  }

  onPresence(listener: PresenceListener): () => void {
    this.presenceListeners.add(listener);
    return () => this.presenceListeners.delete(listener);
  }

  onTyping(listener: TypingListener): () => void {
    this.typingListeners.add(listener);
    return () => this.typingListeners.delete(listener);
  }

  onReadReceipt(listener: ReadReceiptListener): () => void {
    this.readListeners.add(listener);
    return () => this.readListeners.delete(listener);
  }

  onUserRegistered(listener: UserRegisteredListener): () => void {
    this.userRegisteredListeners.add(listener);
    return () => this.userRegisteredListeners.delete(listener);
  }
}

export const socketService = new SocketService();
