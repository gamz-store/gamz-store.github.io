"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import type { User } from "firebase/auth";
import { addDoc, collection, limit, onSnapshot, orderBy, query, serverTimestamp, type Timestamp } from "firebase/firestore";
import { Send, X } from "lucide-react";
import { db } from "@/lib/firebase";

type ConversationOrder = { id: string; customer: string; productName: string };
type ViewerRole = "customer" | "admin";
type OrderMessage = { id: string; senderId: string; senderRole: ViewerRole; text: string; createdAt?: Timestamp };
type MessageCursor = { id: string; seconds: number; nanoseconds: number };
const maxMessageLength = 2000;

function messageDate(value?: Timestamp) {
  if (!value) return "Sending…";
  return new Intl.DateTimeFormat("en-PH", { timeZone: "Asia/Manila", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(value.toDate());
}

export default function OrderConversation({ order, user, viewerRole, onClose, onMessagesSeen }: { order: ConversationOrder; user: User; viewerRole: ViewerRole; onClose: () => void; onMessagesSeen: (orderId: string, cursor: MessageCursor | null) => void }) {
  const [messages, setMessages] = useState<OrderMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const threadRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!db) {
      setLoading(false);
      setError("Messaging is unavailable right now.");
      return;
    }
    setMessages([]);
    setLoading(true);
    setError("");
    const messagesQuery = query(collection(db, "orders", order.id, "messages"), orderBy("createdAt", "desc"), limit(100));
    return onSnapshot(messagesQuery, (snapshot) => {
      setMessages(snapshot.docs.map((item) => ({ id: item.id, ...item.data() }) as OrderMessage).reverse());
      const latest = snapshot.docs[0];
      const latestMessage = latest?.data() as OrderMessage | undefined;
      if (latest && latestMessage?.createdAt) {
        onMessagesSeen(order.id, { id: latest.id, seconds: latestMessage.createdAt.seconds, nanoseconds: latestMessage.createdAt.nanoseconds });
      } else if (!latest) {
        onMessagesSeen(order.id, null);
      }
      setLoading(false);
      setError("");
    }, () => {
      setLoading(false);
      setError("Could not load this conversation. Please try again.");
    });
  }, [order.id, onMessagesSeen]);

  useEffect(() => {
    const thread = threadRef.current;
    if (thread) thread.scrollTo({ top: thread.scrollHeight, behavior: "smooth" });
  }, [messages.length]);

  async function sendMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = draft.trim();
    if (!db || !text || sending) return;
    if (text.length > maxMessageLength) {
      setError(`Messages can contain up to ${maxMessageLength} characters.`);
      return;
    }
    setSending(true);
    setError("");
    try {
      await addDoc(collection(db, "orders", order.id, "messages"), { senderId: user.uid, senderRole: viewerRole, text, createdAt: serverTimestamp() });
      setDraft("");
    } catch {
      setError("Could not send your message. Please try again.");
    } finally {
      setSending(false);
    }
  }

  return <div className="modal-backdrop order-conversation-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }} onKeyDown={(event) => { if (event.key === "Escape") onClose(); }}>
    <section className="modal order-conversation-modal" role="dialog" aria-modal="true" aria-labelledby="order-conversation-title">
      <button className="modal-close" autoFocus onClick={onClose} aria-label="Close conversation"><X size={20} /></button>
      <span className="eyebrow">ORDER MESSAGES</span>
      <h2 id="order-conversation-title">{viewerRole === "customer" ? "Gamz Fireworks & Liquors" : order.customer}</h2>
      <p>Conversation about {order.productName}</p>
      <div className="order-conversation-thread" ref={threadRef} aria-live="polite">
        {loading && <p className="order-conversation-empty">Loading messages…</p>}
        {!loading && messages.length === 0 && <p className="order-conversation-empty">No messages yet. Start the conversation.</p>}
        {messages.map((message) => {
          const mine = message.senderId === user.uid;
          const sender = message.senderRole === "admin" ? "Gamz Store" : viewerRole === "customer" ? "You" : order.customer;
          return <article className={`order-message${mine ? " mine" : ""}`} key={message.id}><span className="order-message-sender">{sender}</span><p>{message.text}</p><time>{messageDate(message.createdAt)}</time></article>;
        })}
      </div>
      {error && <p className="order-conversation-error" role="alert">{error}</p>}
      <form className="order-conversation-composer" onSubmit={sendMessage}>
        <textarea aria-label="Your message" maxLength={maxMessageLength} placeholder="Write a message…" value={draft} onChange={(event) => { setDraft(event.target.value); setError(""); }} rows={2} />
        <button className="button primary" type="submit" disabled={sending || !draft.trim()}>{sending ? "Sending…" : "Send"}<Send size={15} /></button>
      </form>
    </section>
  </div>;
}
