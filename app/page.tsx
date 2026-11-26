"use client";

import { createUserWithEmailAndPassword, onAuthStateChanged, signInWithEmailAndPassword, signOut, type User } from "firebase/auth";
import { addDoc, collection, deleteDoc, deleteField, doc, increment, limit, onSnapshot, orderBy, query, runTransaction, setDoc, updateDoc, where, writeBatch, type Timestamp } from "firebase/firestore";
import { generateReactHelpers } from "@uploadthing/react";
import type { AnyFileRoute } from "uploadthing/types";
import { ArrowRight, Banknote, CalendarDays, Check, ClipboardList, Clock3, Download, Facebook, House, LogIn, LogOut, MapPin, MessageCircle, PackageCheck, Plus, QrCode, Search, ShieldAlert, ShoppingBag, Store, Trash2, Upload, Users, X } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import caragaAddressData from "@/lib/caraga-addresses.json";
import { auth, db, firebaseEnabled } from "@/lib/firebase";
import OrderConversation from "./OrderConversation";

const uploadThingUrl = process.env.NEXT_PUBLIC_UPLOADTHING_URL || "";
type GamzUploadRouter = { productImage: AnyFileRoute };
const { uploadFiles } = generateReactHelpers<GamzUploadRouter>({ url: uploadThingUrl || "/api/uploadthing" });

type Product = { id: string; name: string; product?: string; size?: string; description: string; stock: number; price: number; saleType: "regular" | "promo"; imageUrl?: string; promoStartDate?: string; promoEndDate?: string; active: boolean };
type Profile = { firstName: string; lastName: string; suffix: string; region?: string; province: string; municipality: string; barangay: string; street?: string; facebookName?: string; phone: string; email: string; role: "user" | "admin" };
type ShopOrder = { id: string; userId: string; customer: string; phone: string; productId: string; productName: string; orderName?: string; productImageUrl?: string; quantity: number; total: number; downpayment?: number; pickupDate: string; pickupTime: string; status: "pending" | "ready" | "completed" | "cancelled" | "delivered"; paymentStatus?: "unpaid" | "paid"; deliveredAt?: number; createdAt: number };
type MessageCursor = { seconds: number; nanoseconds: number; id: string };
type Tab = "shop" | "display" | "orders" | "admin" | "checklist" | "users";
type AuthMode = "login" | "signup";

const suffixes = ["", "Jr.", "Sr.", "II", "III", "IV"];
const ORDER_CANCEL_WINDOW_MS = 60 * 60 * 1000;
const productCategories = ["Aerial", "Bombshells", "Firecrackers", "Fountains / Sparklers", "Kwitis", "Liquors", "Others"];
const productsByCategory: Record<string, string[]> = {
  "Fountains / Sparklers": ["Batibot", "Yanco Jumbo Silver", "Sputnik Silver", "Tiger Crackling Fountain", "Lucky Pagoda Crackling Fountain", "Lucky Mayon Crackling Fountain", "Mt. Everest Fountain", "3-Minute Fountain", "100-in Sparkler Stick", "Harry Potter 10s", "Harry Potter 30s", "Harry Potter 40s", "Harry Potter 50s", "Luces", "Victory Lights"],
  Aerial: ["Party USA 16s", "Guiding Light 16s", "Gold of Aztec 16s", "Dragon Aerial 16s", "LF Aerial 16s", "Fat Cat 16s", "RPG 24s", "Thumbs up 30s", "Cloud Dragon 24s", "Magician 30s"],
  Kwitis: ["Maribel Kwitis Stick 10s", "Maribel Kwitis Stick 50s", "Maribel Kwitis Stick 100s"],
  Firecrackers: ["Higad", "Sawa 500 Rounds", "Sawa 1000 Rounds", "Celebration Firecrackers 100k", "Celebrtion Firecrackers 50k"],
  Bombshells: ["JLJ Aquino 1s", "JLJ Aquino 3s", "JLJ Aquino 7s", "JLJ Aquino 9s"],
  Liquors: ["Black Label", "Gold Label", "Red Label", "Jack Daniel", "Jose Cuervo", "Blur Label", "Singleton", "Macallan"],
};
const liquorSizesByProduct: Record<string, string[]> = {
  "Black Label": ["700 Milliliters", "1 Liter"],
  "Gold Label": ["700 Milliliters", "1 Liter"],
  "Red Label": ["1 Liter", "3 Liters"],
  "Jack Daniel": ["700 Milliliters", "1 Liter"],
  "Jose Cuervo": ["700 Milliliters", "1 Liter"],
  "Blur Label": ["700 Milliliters", "1 Liter"],
  Singleton: ["12 yrs", "12 yrs with Glass"],
  Macallan: ["12 yrs Sherry Oak", "15 yrs Sherry Oak", "12 yrs Double Cask", "15 yrs Double Cask"],
};
const normalizedOrderName = (name: string) => name === "Fountains" || name === "Sparklers" ? "Fountains / Sparklers" : name;
const productLabel = (product: Pick<Product, "name" | "product" | "size">) => [product.product || product.name, product.size].filter(Boolean).join(" · ");
const peso = (value: number) => `₱${value.toLocaleString("en-PH", { maximumFractionDigits: 2 })}`;
const today = () => {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const part = (type: string) => parts.find((item) => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
};
const promoUnavailableMessage = (product: Pick<Product, "saleType" | "promoStartDate" | "promoEndDate">, date = today()) => {
  if (product.saleType !== "promo") return "";
  const { promoStartDate, promoEndDate } = product;
  if (!promoStartDate || !promoEndDate || !/^\d{4}-\d{2}-\d{2}$/.test(promoStartDate) || !/^\d{4}-\d{2}-\d{2}$/.test(promoEndDate) || promoEndDate < promoStartDate) return "This promo has no valid date range and cannot be ordered.";
  if (date < promoStartDate) return `This promo starts on ${promoStartDate}.`;
  if (date > promoEndDate) return `This promo ended on ${promoEndDate}.`;
  return "";
};
const formatPickupTime = (time: string) => {
  const match = /^(\d{2}):([0-5]\d)$/.exec(time);
  if (!match) return time;
  const hour = Number(match[1]);
  if (hour > 23) return time;
  return `${String(hour % 12 || 12).padStart(2, "0")}:${match[2]} ${hour < 12 ? "AM" : "PM"}`;
};
const orderBalance = (order: ShopOrder) => order.paymentStatus === "paid" ? 0 : Math.max(0, order.total - (order.downpayment ?? 0));
const messageReadKey = (userId: string, orderId: string) => `gamz:message-read:${userId}:${orderId}`;
function readMessageCursor(userId: string, orderId: string): MessageCursor | null {
  try {
    const value = window.localStorage.getItem(messageReadKey(userId, orderId));
    if (!value) return null;
    const cursor = JSON.parse(value) as Partial<MessageCursor>;
    return Number.isSafeInteger(cursor.seconds) && Number.isSafeInteger(cursor.nanoseconds) && typeof cursor.id === "string" ? cursor as MessageCursor : null;
  } catch { return null; }
}
function saveMessageCursor(userId: string, orderId: string, cursor: MessageCursor) {
  try { window.localStorage.setItem(messageReadKey(userId, orderId), JSON.stringify(cursor)); } catch { /* Ignore unavailable browser storage. */ }
}
function compareMessageCursors(left: MessageCursor, right: MessageCursor) {
  return left.seconds - right.seconds || left.nanoseconds - right.nanoseconds || left.id.localeCompare(right.id);
}

export default function Home() {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [profileReady, setProfileReady] = useState(false);
  const [products, setProducts] = useState<Product[]>([]);
  const [orders, setOrders] = useState<ShopOrder[]>([]);
  const [managedUsers, setManagedUsers] = useState<Array<Profile & { id: string }>>([]);
  const [tab, setTab] = useState<Tab>("shop");
  const [catalogSearch, setCatalogSearch] = useState("");
  const [catalogOrderName, setCatalogOrderName] = useState("");
  const [authMode, setAuthMode] = useState<AuthMode | null>(null);
  const [logoutConfirmation, setLogoutConfirmation] = useState(false);
  const [locationOpen, setLocationOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [authError, setAuthError] = useState("");
  const [notice, setNotice] = useState("");
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [pickupConfirmationOpen, setPickupConfirmationOpen] = useState(false);
  const [placingOrder, setPlacingOrder] = useState(false);
  const [conversationOrder, setConversationOrder] = useState<ShopOrder | null>(null);
  const [editingProduct, setEditingProduct] = useState<string | null>(null);
  const [isOtherProduct, setIsOtherProduct] = useState(false);
  const [productConfirmation, setProductConfirmation] = useState<{ product: Product; action: "publish" | "hide" | "delete" } | null>(null);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [savingProduct, setSavingProduct] = useState(false);
  const [savingProductAction, setSavingProductAction] = useState(false);
  const [authDraft, setAuthDraft] = useState({ firstName: "", lastName: "", suffix: "", province: "", municipality: "", barangay: "", facebookName: "", phone: "", email: "", password: "" });
  const [productDraft, setProductDraft] = useState({ name: "", product: "", size: "", description: "", stock: "", price: "", saleType: "regular" as "regular" | "promo", promoStartDate: "", promoEndDate: "", imageUrl: "" });
  const [orderDraft, setOrderDraft] = useState({ quantity: "1", pickupDate: "", pickupTime: "" });
  const [unreadMessageOrderIds, setUnreadMessageOrderIds] = useState<Set<string>>(() => new Set());
  const latestMessageCursors = useRef(new Map<string, MessageCursor>());
  const pageStartedAt = useRef(Date.now());
  const initialLandingUserId = useRef<string | null>(null);
  const userId = user?.uid;
  const pickupTotal = selectedProduct ? selectedProduct.price * (Number(orderDraft.quantity) || 0) : 0;
  const minimumDownpayment = Math.ceil(pickupTotal * 30 - 1e-8) / 100;
  const searchTerm = catalogSearch.trim().toLowerCase();
  const filteredProducts = products.filter((product) => [product.name, product.product ?? "", product.size ?? ""].some((value) => value.toLowerCase().includes(searchTerm)) && (!catalogOrderName || normalizedOrderName(product.name) === catalogOrderName));
  const groupedCatalog = Object.entries(filteredProducts.reduce<Record<string, Product[]>>((groups, product) => {
    const orderName = normalizedOrderName(product.name);
    (groups[orderName] ??= []).push(product);
    return groups;
  }, {}))
    .sort(([left], [right]) => left.localeCompare(right, "en", { sensitivity: "base" }))
    .map(([orderName, items]) => ({
      orderName,
      items: items.sort((left, right) => productLabel(left).localeCompare(productLabel(right), "en", { numeric: true, sensitivity: "base" })),
    }));
  const markOrderMessagesRead = useCallback((orderId: string, cursor?: MessageCursor | null) => {
    const latestCursor = cursor ?? latestMessageCursors.current.get(orderId) ?? null;
    if (userId && latestCursor) saveMessageCursor(userId, orderId, latestCursor);
    setUnreadMessageOrderIds((current) => {
      if (!current.has(orderId)) return current;
      const next = new Set(current);
      next.delete(orderId);
      return next;
    });
  }, [userId]);
  function openOrderConversation(order: ShopOrder) {
    markOrderMessagesRead(order.id);
    setConversationOrder(order);
  }

  useEffect(() => {
    if (window.location.hash === "#home") {
      window.history.replaceState(window.history.state, "", `${window.location.pathname}${window.location.search}`);
    }
    if (!auth) return;
    let unsubscribeProfile: (() => void) | undefined;
    const unsubscribeAuth = onAuthStateChanged(auth, (nextUser) => {
      unsubscribeProfile?.();
      unsubscribeProfile = undefined;
      setUser(nextUser);
      if (!nextUser || !db) {
        initialLandingUserId.current = null;
        setProfile(null);
        setProfileReady(true);
        setTab("shop");
        if (!nextUser) {
          setLogoutConfirmation(false);
          setSigningOut(false);
          setAuthMode(null);
          setSelectedProduct(null);
          setEditingProduct(null);
        }
        return;
      }
      setProfileReady(false);
      unsubscribeProfile = onSnapshot(doc(db, "users", nextUser.uid), (snapshot) => {
        const nextProfile = snapshot.exists() ? snapshot.data() as Profile : null;
        setProfile(nextProfile);
        setProfileReady(true);
        if (initialLandingUserId.current !== nextUser.uid) {
          setTab(nextProfile?.role === "admin" ? "admin" : "shop");
          initialLandingUserId.current = nextUser.uid;
        }
      }, () => { setProfileReady(true); setNotice("Could not load your account profile."); });
    });
    return () => { unsubscribeProfile?.(); unsubscribeAuth(); };
  }, []);

  useEffect(() => {
    const adminTabs: Tab[] = ["display", "admin", "checklist", "users"];
    if (!user && tab !== "shop") {
      setTab("shop");
    } else if (user && profileReady && profile?.role !== "admin" && adminTabs.includes(tab)) {
      setTab("shop");
    }
  }, [user, profileReady, profile?.role, tab]);

  useEffect(() => {
    if (!db || (userId && !profileReady)) return;
    const productsQuery = profile?.role === "admin"
      ? collection(db, "products")
      : query(collection(db, "products"), where("active", "==", true));
    return onSnapshot(productsQuery, (snapshot) => {
      setProducts(snapshot.docs.map((item) => ({ id: item.id, ...item.data() } as Product)));
    }, () => setNotice("Menu is unavailable. Check the Firebase configuration and Firestore rules."));
  }, [userId, profileReady, profile?.role]);

  useEffect(() => {
    if (!db || !userId || !profileReady) { setOrders([]); return; }
    const ordersQuery = profile?.role === "admin"
      ? collection(db, "orders")
      : query(collection(db, "orders"), where("userId", "==", userId));
    return onSnapshot(ordersQuery, (snapshot) => {
      setOrders(snapshot.docs.map((item) => ({ id: item.id, ...item.data() } as ShopOrder)).sort((a, b) => b.createdAt - a.createdAt));
    }, () => setNotice("Orders could not be loaded."));
  }, [userId, profileReady, profile?.role]);

  useEffect(() => {
    const firestore = db;
    if (!firestore || !userId) {
      latestMessageCursors.current.clear();
      setUnreadMessageOrderIds(new Set());
      return;
    }
    const orderIds = new Set(orders.map((order) => order.id));
    for (const orderId of latestMessageCursors.current.keys()) {
      if (!orderIds.has(orderId)) latestMessageCursors.current.delete(orderId);
    }
    setUnreadMessageOrderIds((current) => {
      const next = new Set([...current].filter((orderId) => orderIds.has(orderId)));
      return next.size === current.size ? current : next;
    });
    const baselineAt = pageStartedAt.current;
    const baselineCursor: MessageCursor = { seconds: Math.floor(baselineAt / 1000), nanoseconds: (baselineAt % 1000) * 1_000_000, id: "" };
    const unsubscribers = orders.map((order) => {
      const latestMessageQuery = query(collection(firestore, "orders", order.id, "messages"), orderBy("createdAt", "desc"), limit(1));
      return onSnapshot(latestMessageQuery, (snapshot) => {
        const latest = snapshot.docs[0];
        if (!latest) {
          if (!readMessageCursor(userId, order.id)) saveMessageCursor(userId, order.id, baselineCursor);
          latestMessageCursors.current.delete(order.id);
          setUnreadMessageOrderIds((current) => {
            if (!current.has(order.id)) return current;
            const next = new Set(current);
            next.delete(order.id);
            return next;
          });
          return;
        }
        const message = latest.data() as { senderId: string; createdAt?: Timestamp };
        if (!message.createdAt) return;
        const cursor: MessageCursor = { id: latest.id, seconds: message.createdAt.seconds, nanoseconds: message.createdAt.nanoseconds };
        latestMessageCursors.current.set(order.id, cursor);
        const storedCursor = readMessageCursor(userId, order.id);
        const readCursor = storedCursor ?? baselineCursor;
        if (!storedCursor) saveMessageCursor(userId, order.id, baselineCursor);
        const isUnread = message.senderId !== userId && compareMessageCursors(cursor, readCursor) > 0;
        if (message.senderId === userId && compareMessageCursors(cursor, readCursor) > 0) saveMessageCursor(userId, order.id, cursor);
        setUnreadMessageOrderIds((current) => {
          if (current.has(order.id) === isUnread) return current;
          const next = new Set(current);
          if (isUnread) next.add(order.id);
          else next.delete(order.id);
          return next;
        });
      }, () => {});
    });
    return () => unsubscribers.forEach((unsubscribe) => unsubscribe());
  }, [orders, userId]);

  useEffect(() => {
    if (!db || profile?.role !== "admin") { setManagedUsers([]); return; }
    return onSnapshot(collection(db, "users"), (snapshot) => {
      setManagedUsers(snapshot.docs.map((item) => ({ id: item.id, ...item.data() } as Profile & { id: string })));
    }, () => setNotice("User list could not be loaded."));
  }, [profile?.role]);

  async function handleSignOut() {
    if (!auth) return;
    setSigningOut(true);
    try {
      await signOut(auth);
      setLogoutConfirmation(false);
    } catch (error) {
      setNotice(error instanceof Error ? error.message.replace("Firebase: ", "") : "Sign out failed. Please try again.");
    } finally {
      setSigningOut(false);
    }
  }

  async function submitAuth(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!auth || !db || !authMode) { setAuthError("Firebase is not configured yet. Add the NEXT_PUBLIC_FIREBASE values first."); return; }
    setAuthError("");
    try {
      if (authMode === "login") {
        await signInWithEmailAndPassword(auth, authDraft.email.trim(), authDraft.password);
      } else {
        const created = await createUserWithEmailAndPassword(auth, authDraft.email.trim(), authDraft.password);
        const data = { firstName: authDraft.firstName.trim(), lastName: authDraft.lastName.trim(), suffix: authDraft.suffix, province: authDraft.province.trim(), municipality: authDraft.municipality.trim(), barangay: authDraft.barangay.trim(), facebookName: authDraft.facebookName.trim(), phone: authDraft.phone.trim(), email: authDraft.email.trim(), role: "user" } satisfies Profile;
        await setDoc(doc(db, "users", created.user.uid), data);
      }
      setAuthMode(null);
    } catch (error) {
      setAuthError(error instanceof Error ? error.message.replace("Firebase: ", "") : "Sign-in failed. Please try again.");
    }
  }

  function placeOrder(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!db || !user || !profile || !selectedProduct) { setNotice("Sign in to place an order."); return; }
    const promoMessage = promoUnavailableMessage(selectedProduct);
    if (promoMessage) { setNotice(promoMessage); return; }
    const quantity = Number(orderDraft.quantity);
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > selectedProduct.stock) { setNotice("Please choose a valid quantity within available stock."); return; }
    if (!orderDraft.pickupDate || !orderDraft.pickupTime || orderDraft.pickupDate < today()) { setNotice("Choose a valid pickup date and time."); return; }
    setPickupConfirmationOpen(true);
  }

  async function confirmPlaceOrder() {
    if (!db || !user || !profile || !selectedProduct) { setPickupConfirmationOpen(false); setNotice("Sign in to place an order."); return; }
    const promoMessage = promoUnavailableMessage(selectedProduct);
    if (promoMessage) { setPickupConfirmationOpen(false); setNotice(promoMessage); return; }
    const quantity = Number(orderDraft.quantity);
    setPlacingOrder(true);
    try {
      const orderRef = doc(collection(db, "orders"));
      const productRef = doc(db, "products", selectedProduct.id);
      const amount = selectedProduct.price * quantity;
      const order: ShopOrder = { id: orderRef.id, userId: user.uid, customer: `${profile.firstName} ${profile.lastName}`.trim(), phone: profile.phone, productId: selectedProduct.id, productName: productLabel(selectedProduct), orderName: selectedProduct.name, ...(selectedProduct.imageUrl ? { productImageUrl: selectedProduct.imageUrl } : {}), quantity, total: amount, downpayment: 0, pickupDate: orderDraft.pickupDate, pickupTime: orderDraft.pickupTime, status: "pending", paymentStatus: "unpaid", createdAt: Date.now() };
      await runTransaction(db, async (transaction) => {
        const latest = await transaction.get(productRef);
        if (!latest.exists() || latest.data().active !== true) throw new Error("This item is no longer available.");
        const latestProduct = latest.data() as Product;
        const latestPromoMessage = promoUnavailableMessage(latestProduct);
        if (latestPromoMessage) throw new Error(latestPromoMessage);
        if (Number(latestProduct.stock) < quantity) throw new Error("Stock changed. Please adjust your quantity.");
        transaction.update(productRef, { stock: Number(latestProduct.stock) - quantity, lastOrderId: orderRef.id });
        transaction.set(orderRef, order);
      });
      setPickupConfirmationOpen(false);
      setSelectedProduct(null);
      setNotice("");
      setTab(profile.role === "admin" ? "admin" : "orders");
    } catch (error) {
      setPickupConfirmationOpen(false);
      setNotice(error instanceof Error ? error.message : "Order could not be placed.");
    } finally {
      setPlacingOrder(false);
    }
  }

  function startProductEdit(product?: Product) {
    setEditingProduct(product?.id ?? "new");
    setImageFile(null);
    const category = product ? normalizedOrderName(product.name) : "";
    const productName = product?.product ?? "";
    setIsOtherProduct(category === "Others" || Boolean(productName && !productsByCategory[category]?.includes(productName)));
    setProductDraft(product ? { name: normalizedOrderName(product.name), product: product.product ?? "", size: product.size ?? "", description: product.description, stock: String(product.stock), price: String(product.price), saleType: product.saleType, promoStartDate: product.promoStartDate ?? "", promoEndDate: product.promoEndDate ?? "", imageUrl: product.imageUrl ?? "" } : { name: "", product: "", size: "", description: "", stock: "", price: "", saleType: "regular", promoStartDate: "", promoEndDate: "", imageUrl: "" });
  }

  async function saveProduct(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!db || !user || !editingProduct) return;
    setSavingProduct(true);
    try {
      let imageUrl = productDraft.imageUrl.trim();
      if (imageFile) {
        if (!uploadThingUrl) throw new Error("Set NEXT_PUBLIC_UPLOADTHING_URL to enable photo uploads.");
        if (imageFile.size > 8 * 1024 * 1024 || !["image/jpeg", "image/png", "image/webp"].includes(imageFile.type)) throw new Error("Choose a JPEG, PNG, or WebP photo up to 8 MB.");
        const uploaded = await uploadFiles("productImage", { files: [imageFile], headers: async () => ({ Authorization: `Bearer ${await user.getIdToken()}` }) });
        const file = uploaded?.[0] as { serverData?: { imageUrl?: string }; ufsUrl?: string; url?: string } | undefined;
        imageUrl = file?.serverData?.imageUrl ?? file?.ufsUrl ?? file?.url ?? imageUrl;
      }
      if (!imageUrl) throw new Error("Upload a photo for this display.");
      const data = { name: productDraft.name, product: productDraft.product.trim(), ...(productDraft.name === "Liquors" && !isOtherProduct ? { size: productDraft.size } : {}), description: productDraft.description.trim(), stock: Number(productDraft.stock), price: Number(productDraft.price), saleType: productDraft.saleType, imageUrl, ...(productDraft.saleType === "promo" ? { promoStartDate: productDraft.promoStartDate, promoEndDate: productDraft.promoEndDate } : {}), active: true };
      const validProductChoice = data.product.length > 0 && data.product.length <= 120 && (isOtherProduct || data.name === "Others" || productsByCategory[data.name]?.includes(data.product) === true);
      const validSizeChoice = data.name !== "Liquors" || (isOtherProduct || (liquorSizesByProduct[data.product] ?? []).includes(data.size ?? ""));
      if (!productCategories.includes(data.name) || !validProductChoice || !validSizeChoice || !data.description || !Number.isInteger(data.stock) || data.stock < 0 || !Number.isFinite(data.price) || data.price < 0) throw new Error("Choose an order name, product, required size, and description, then enter a valid stock and price.");
      if (data.saleType === "promo" && (!data.promoStartDate || !data.promoEndDate || data.promoEndDate < data.promoStartDate)) throw new Error("Choose a valid start and end date for this promo.");
      if (editingProduct === "new") await addDoc(collection(db, "products"), data);
      else await updateDoc(doc(db, "products", editingProduct), { ...data, ...(data.name !== "Liquors" || isOtherProduct ? { size: deleteField() } : {}), ...(data.saleType === "regular" ? { promoStartDate: deleteField(), promoEndDate: deleteField() } : {}) });
      setEditingProduct(null);
      setImageFile(null);
      setNotice("");
    } catch (error) { setNotice(error instanceof Error ? error.message : "Product could not be saved."); }
    finally { setSavingProduct(false); }
  }

  async function updateOrder(order: ShopOrder, changes: Partial<ShopOrder>) {
    if (!db) return false;
    try { await updateDoc(doc(db, "orders", order.id), changes); return true; }
    catch (error) { setNotice(error instanceof Error ? error.message : "Order update failed."); return false; }
  }

  async function cancelCustomerOrder(order: ShopOrder) {
    if (!db || !user) { setNotice("Sign in to cancel an order."); return false; }
    const now = Date.now();
    if (order.userId !== user.uid || order.status !== "pending" || !Number.isSafeInteger(order.createdAt) || order.createdAt > now || now - order.createdAt >= ORDER_CANCEL_WINDOW_MS || !Number.isSafeInteger(order.quantity) || order.quantity < 1) {
      setNotice("This order can no longer be cancelled.");
      return false;
    }
    try {
      const batch = writeBatch(db);
      batch.delete(doc(db, "orders", order.id));
      batch.update(doc(db, "products", order.productId), { stock: increment(order.quantity), lastOrderId: order.id });
      await batch.commit();
      setNotice("");
      return true;
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Order could not be cancelled. Please try again.");
      return false;
    }
  }

  async function changeRole(uid: string, role: "admin" | "user") {
    if (!db) return;
    try { await updateDoc(doc(db, "users", uid), { role }); }
    catch (error) { setNotice(error instanceof Error ? error.message : "Role update failed."); }
  }

  function confirmProductVisibility(product: Product) {
    setProductConfirmation({ product, action: product.active ? "hide" : "publish" });
  }

  function confirmProductDelete(product: Product) {
    setProductConfirmation({ product, action: "delete" });
  }

  async function applyProductConfirmation() {
    if (!db || !user || !productConfirmation) return;
    const { product, action } = productConfirmation;
    setSavingProductAction(true);
    try {
      if (action === "delete") {
        await deleteDoc(doc(db, "products", product.id));
      } else {
        await updateDoc(doc(db, "products", product.id), { active: action === "publish" });
      }
      setNotice("");
      setProductConfirmation(null);
    } catch (error) { setNotice(error instanceof Error ? error.message : "Display update failed."); }
    finally { setSavingProductAction(false); }
  }
  const isAdmin = profile?.role === "admin";
  const navItems: Array<{ id: Tab; label: string }> = isAdmin
    ? [{ id: "shop", label: "Home" }, { id: "admin", label: "Order List" }, { id: "users", label: "Users" }]
    : user ? [{ id: "shop", label: "Display" }, { id: "orders", label: "My Orders" }] : [{ id: "shop", label: "Display" }];
  const visibleOrders = isAdmin ? orders : orders.filter((order) => order.userId === user?.uid);
  const selectedProvince = caragaAddressData.provinces.find((province) => province.name === authDraft.province);
  const municipalities = selectedProvince?.municipalities ?? [];
  const selectedMunicipality = municipalities.find((municipality) => municipality.name === authDraft.municipality);
  const barangays = selectedMunicipality?.barangays ?? [];

  return <main className={`site-shell${tab === "shop" ? " has-home-footer" : ""}`}>
    <header className="topbar"><Link className="brand" href="/" onClick={() => setTab("shop")}><Image className="brand-logo" src="/logo.png" alt="" aria-hidden="true" width={48} height={48} priority /><span><strong>GAMZ</strong><small>FIREWORKS & LIQUORS</small></span></Link>
      <nav className="nav-links" aria-label="Main navigation">{navItems.map((item) => <button key={item.id} className={tab === item.id ? "nav-link active" : "nav-link"} aria-label={item.label} title={item.label} aria-current={tab === item.id ? "page" : undefined} onClick={() => setTab(item.id)}><span className="mobile-nav-icon" aria-hidden="true">{item.id === "shop" ? isAdmin ? <House size={19} /> : <Store size={19} /> : item.id === "orders" || item.id === "admin" ? <ClipboardList size={19} /> : <Users size={19} />}</span><span className="nav-link-label">{item.label}</span></button>)}</nav>
      <div className="account-actions">{user ? <button className="icon-button" aria-label="Sign out" title="Sign out" onClick={() => setLogoutConfirmation(true)}><LogOut size={18} /></button> : <button className="button quiet" onClick={() => { setAuthMode("login"); setAuthError(""); }}><LogIn size={17} /> Sign in</button>}</div>
    </header>
    {notice && <div className="notice" role="status">{notice}<button aria-label="Dismiss message" onClick={() => setNotice("")}><X size={16} /></button></div>}

    {tab === "shop" && <>
      <section className="catalog" id="catalog"><div className="section-title"><div><span className="eyebrow">THE GAMZ SELECTION</span><h2>Shop the Display</h2></div><span className="catalog-count">{filteredProducts.length} {filteredProducts.length === 1 ? "item" : "items"}</span></div><div className="catalog-tools"><label className="catalog-search"><Search size={18} aria-hidden="true" /><input type="search" value={catalogSearch} onChange={(event) => setCatalogSearch(event.target.value)} placeholder="Search orders" aria-label="Search orders" /></label><label className="catalog-filter"><select aria-label="Filter by order name" value={catalogOrderName} onChange={(event) => setCatalogOrderName(event.target.value)}><option value="">All order names</option>{productCategories.map((name) => <option key={name} value={name}>{name}</option>)}</select></label></div>
        {!firebaseEnabled && <div className="setup-note"><ShieldAlert size={20} /><span><strong>Store setup in progress</strong><small>Add your Firebase web configuration to load products and enable orders.</small></span></div>}
        <div className="catalog-groups">{groupedCatalog.length ? groupedCatalog.map(({ orderName, items }) => <section className="catalog-group" key={orderName}><h3 className="catalog-group-heading"><span>{orderName}</span><small>{items.length} {items.length === 1 ? "item" : "items"}</small></h3><div className="product-grid">{items.map((product) => <CatalogProductCard key={product.id} product={product} onOrder={() => {
          const promoMessage = promoUnavailableMessage(product);
          if (promoMessage) { setNotice(promoMessage); return; }
          if (!user) { setAuthMode("login"); setNotice("Sign in or create an account to order."); return; }
          setSelectedProduct(product);
          setOrderDraft({ quantity: "1", pickupDate: "", pickupTime: "" });
        }} />)}</div></section>) : products.length ? <div className="empty-menu"><span className="empty-icon"><Search size={24} /></span><h3>No displays match your search.</h3><p>Try a different search or clear the search and filter.</p><button className="text-button" onClick={() => { setCatalogSearch(""); setCatalogOrderName(""); }}>Clear search and filter</button></div> : <div className="empty-menu"><span className="empty-icon"><ShoppingBag size={24} /></span><h3>The shelves are getting ready.</h3><p>New favorites will show up here once the menu is published.</p>{!user && <button className="text-button" onClick={() => setAuthMode("signup")}>Create an account <ArrowRight size={15} /></button>}</div>}</div>
      </section></>}

    {tab === "orders" && <section className="workspace"><div className="page-heading"><div><span className="eyebrow">YOUR ACCOUNT</span><h1>My orders</h1><p>Pickup details and order status, all in one place.</p></div><button className="button quiet" onClick={() => setTab("shop")}>Back to Display <ArrowRight size={16} /></button></div><OrderList orders={visibleOrders} products={products} unreadMessageOrderIds={unreadMessageOrderIds} onMessage={openOrderConversation} onCancel={cancelCustomerOrder} /></section>}

    {isAdmin && tab === "admin" && <AdminOrderDashboard orders={orders} products={products} unreadMessageOrderIds={unreadMessageOrderIds} onUpdate={updateOrder} onMessage={openOrderConversation} onAddDisplay={() => startProductEdit()} onEditDisplay={startProductEdit} onToggleDisplay={confirmProductVisibility} onDeleteDisplay={confirmProductDelete} />}

    {isAdmin && tab === "checklist" && <section className="workspace"><div className="page-heading"><div><span className="eyebrow">PICKUP PREP</span><h1>Order checklist</h1><p>Mark orders ready when they&apos;re set for handoff.</p></div><PackageCheck size={31} className="heading-icon" /></div><div className="checklist">{orders.filter((order) => order.status !== "completed" && order.status !== "cancelled").map((order) => <article className="check-row" key={order.id}><div className="check-icon"><ShoppingBag size={19} /></div><div className="check-details"><strong>{order.productName} <span>× {order.quantity}</span></strong><small>{order.customer} · {order.pickupDate} at {formatPickupTime(order.pickupTime)}</small><small>{order.phone}</small></div><button className={order.status === "ready" ? "button ready" : "button quiet"} onClick={() => updateOrder(order, { status: order.status === "ready" ? "pending" : "ready" })}>{order.status === "ready" ? <><Check size={16} /> Ready</> : "Mark ready"}</button></article>)}{orders.filter((order) => order.status !== "completed" && order.status !== "cancelled").length === 0 && <p className="empty-inline">No active orders to prepare.</p>}</div></section>}

    {isAdmin && tab === "users" && <section className="workspace"><div className="page-heading"><div><span className="eyebrow">ACCOUNT DIRECTORY</span><h1>Users</h1><p>Review registered accounts and manage staff access.</p></div><div className="metric"><strong>{managedUsers.length}</strong><span>accounts</span></div></div><div className="user-list">{managedUsers.map((item) => <article className="user-row" key={item.id}><span className="user-avatar"><Users size={18} /></span><div><strong>{item.firstName} {item.lastName} {item.suffix}</strong><small>{item.email} · {item.phone}</small>{item.facebookName && <small>Facebook: {item.facebookName}</small>}<small>{[item.street, item.barangay, item.municipality, item.province, item.region].filter(Boolean).join(", ")}</small></div><select aria-label={`Role for ${item.email}`} value={item.role} disabled={item.id === user?.uid} onChange={(event) => changeRole(item.id, event.target.value as "admin" | "user")}><option value="user">Customer</option><option value="admin">Admin</option></select></article>)}</div></section>}

    {isAdmin && editingProduct && <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !savingProduct) setEditingProduct(null); }}><section className="modal display-modal" role="dialog" aria-modal="true" aria-labelledby="display-form-title" aria-busy={savingProduct} onKeyDown={(event) => { if (event.key === "Escape" && !savingProduct) setEditingProduct(null); }}><button className="modal-close" aria-label="Close" disabled={savingProduct} onClick={() => setEditingProduct(null)}><X size={20} /></button><span className="eyebrow">DISPLAY MANAGEMENT</span><h2 id="display-form-title">{editingProduct === "new" ? "Add Display" : "Edit Display"}</h2><p>Add the display details below.</p><form id="product-form" className="form-grid display-form-grid" onSubmit={saveProduct}>
      <label>Order Name<select required value={productDraft.name} onChange={(event) => { const name = event.target.value; setIsOtherProduct(name === "Others"); setProductDraft({ ...productDraft, name, product: "", size: "" }); }}><option value="">Select an order name</option>{productCategories.map((category) => <option key={category} value={category}>{category}</option>)}</select></label>
      <label>Product{isOtherProduct || productDraft.name === "Others" ? <input required maxLength={120} placeholder="Enter product name" value={productDraft.product} onChange={(event) => setProductDraft({ ...productDraft, product: event.target.value })} /> : <select required disabled={!productDraft.name} value={productDraft.product} onChange={(event) => { const product = event.target.value; const otherProduct = product === "__other__"; setIsOtherProduct(otherProduct); setProductDraft({ ...productDraft, product: otherProduct ? "" : product, size: "" }); }}><option value="">Select a product</option>{(productsByCategory[productDraft.name] ?? []).map((item) => <option key={item} value={item}>{item}</option>)}{productDraft.name && <option value="__other__">Others</option>}</select>}</label>
      {productDraft.name === "Liquors" && productDraft.product && !isOtherProduct && <label>Size<select required value={productDraft.size} onChange={(event) => setProductDraft({ ...productDraft, size: event.target.value })}><option value="">Select a size</option>{(liquorSizesByProduct[productDraft.product] ?? []).map((size) => <option key={size} value={size}>{size}</option>)}</select></label>}
      <label>Description<textarea required rows={2} value={productDraft.description} onChange={(event) => setProductDraft({ ...productDraft, description: event.target.value })} /></label>
      <label className="stock-field">Stock<input required type="number" min="0" step="1" value={productDraft.stock} onChange={(event) => setProductDraft({ ...productDraft, stock: event.target.value })} /></label>
      <label className="price-field">Price (PHP)<input required type="number" min="0" step="0.01" value={productDraft.price} onChange={(event) => setProductDraft({ ...productDraft, price: event.target.value })} /></label>
      <label className="full-field">Sale Type<select value={productDraft.saleType} onChange={(event) => setProductDraft({ ...productDraft, saleType: event.target.value as "regular" | "promo", ...(event.target.value === "regular" ? { promoStartDate: "", promoEndDate: "" } : {}) })}><option value="regular">Regular</option><option value="promo">Promo</option></select></label>
      {productDraft.saleType === "promo" && <div className="promo-date-row full-field"><label>Date From<input required type="date" value={productDraft.promoStartDate} onChange={(event) => setProductDraft({ ...productDraft, promoStartDate: event.target.value })} /></label><label>Date To<input required type="date" min={productDraft.promoStartDate || undefined} value={productDraft.promoEndDate} onChange={(event) => setProductDraft({ ...productDraft, promoEndDate: event.target.value })} /></label></div>}
      <label className="file-label full-field"><Upload size={18} /><span className="file-label-title">Upload Photo</span><input type="file" accept="image/jpeg,image/png,image/webp" required={!productDraft.imageUrl && !imageFile} onChange={(event) => setImageFile(event.target.files?.[0] ?? null)} /><small>{imageFile?.name ?? (productDraft.imageUrl ? "Current photo saved. Choose a file to replace it." : "JPEG, PNG or WebP, max 8 MB")}</small></label>
      <button className="button primary full-field" disabled={savingProduct}>{savingProduct ? "Saving..." : "Save Display"} <Check size={17} /></button>
    </form></section></div>}

    {isAdmin && productConfirmation && <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !savingProductAction) setProductConfirmation(null); }}><section className="modal product-confirmation-modal" role="dialog" aria-modal="true" aria-labelledby="product-confirmation-title" aria-describedby="product-confirmation-description" aria-busy={savingProductAction} onKeyDown={(event) => { if (event.key === "Escape" && !savingProductAction) setProductConfirmation(null); }}><button className="modal-close" aria-label="Close confirmation" disabled={savingProductAction} onClick={() => setProductConfirmation(null)}><X size={20} /></button><span className="eyebrow">DISPLAY MANAGEMENT</span><h2 id="product-confirmation-title">{productConfirmation.action === "delete" ? "Delete display?" : productConfirmation.action === "hide" ? "Hide display?" : "Publish display?"}</h2><p id="product-confirmation-description">{productConfirmation.action === "delete" ? <><strong>{productLabel(productConfirmation.product)}</strong> will be permanently deleted. This cannot be undone.</> : productConfirmation.action === "hide" ? <><strong>{productLabel(productConfirmation.product)}</strong> will be removed from the public display. You can publish it again later.</> : <><strong>{productLabel(productConfirmation.product)}</strong> will appear in the public display.</>}</p><div className="confirmation-actions"><button type="button" className="button quiet" autoFocus disabled={savingProductAction} onClick={() => setProductConfirmation(null)}>Cancel</button><button type="button" className={productConfirmation.action === "delete" ? "button destructive" : "button primary"} disabled={savingProductAction} onClick={applyProductConfirmation}>{savingProductAction ? "Saving..." : productConfirmation.action === "delete" ? "Delete display" : productConfirmation.action === "hide" ? "Hide display" : "Publish display"}{productConfirmation.action === "delete" ? <Trash2 size={16} /> : <Check size={16} />}</button></div></section></div>}
    {authMode && <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setAuthMode(null); }}><section className="modal auth-modal" role="dialog" aria-modal="true" aria-labelledby="auth-title"><button className="modal-close" aria-label="Close" onClick={() => setAuthMode(null)}><X size={20} /></button><span className="eyebrow">{authMode === "signup" ? "JOIN GAMZ" : "WELCOME BACK"}</span><h2 id="auth-title">{authMode === "signup" ? "Create your account" : "Sign in"}</h2><p>{authMode === "signup" ? "Save your details for a smoother pickup." : "Sign in to track orders and book your pickup."}</p><form className={authMode === "signup" ? "form-grid signup-form-grid" : "form-grid"} onSubmit={submitAuth}>
      {authMode === "signup" && <>
      <label className="signup-first">First name<input required autoComplete="given-name" value={authDraft.firstName} onChange={(event) => setAuthDraft({ ...authDraft, firstName: event.target.value })} /></label>
      <label className="signup-last">Last name<input required autoComplete="family-name" value={authDraft.lastName} onChange={(event) => setAuthDraft({ ...authDraft, lastName: event.target.value })} /></label>
      <label className="signup-suffix">Suffix<select value={authDraft.suffix} onChange={(event) => setAuthDraft({ ...authDraft, suffix: event.target.value })}>{suffixes.map((suffix) => <option key={suffix} value={suffix}>{suffix || "None"}</option>)}</select></label>
      <label className="signup-province">Province<select required value={authDraft.province} onChange={(event) => setAuthDraft({ ...authDraft, province: event.target.value, municipality: "", barangay: "" })}><option value="">Select province</option>{caragaAddressData.provinces.map((province) => <option key={province.name} value={province.name}>{province.name}</option>)}</select></label>
      <label className="signup-municipality">Municipality<select required disabled={!selectedProvince} value={authDraft.municipality} onChange={(event) => setAuthDraft({ ...authDraft, municipality: event.target.value, barangay: "" })}><option value="">Select municipality</option>{municipalities.map((municipality) => <option key={municipality.name} value={municipality.name}>{municipality.name}</option>)}</select></label>
      <label className="signup-barangay">Barangay<select required disabled={!selectedMunicipality} value={authDraft.barangay} onChange={(event) => setAuthDraft({ ...authDraft, barangay: event.target.value })}><option value="">Select barangay</option>{barangays.map((barangay) => <option key={barangay} value={barangay}>{barangay}</option>)}</select></label>
      <label className="signup-facebook full-field">Facebook Name<input required autoComplete="off" value={authDraft.facebookName} onChange={(event) => setAuthDraft({ ...authDraft, facebookName: event.target.value })} /></label>
      <label className="signup-contact">Contact No.<input required type="tel" autoComplete="tel" value={authDraft.phone} onChange={(event) => setAuthDraft({ ...authDraft, phone: event.target.value })} /></label>
      <label className="signup-email">Email<input required type="email" autoComplete="email" value={authDraft.email} onChange={(event) => setAuthDraft({ ...authDraft, email: event.target.value })} /></label>
    </>}
      {authMode === "login" && <label className="full-field">Email<input required type="email" autoComplete="email" value={authDraft.email} onChange={(e) => setAuthDraft({ ...authDraft, email: e.target.value })} /></label>}<label className={authMode === "signup" ? "signup-password" : "full-field"}>Password<input required type="password" minLength={authMode === "signup" ? 8 : 6} autoComplete={authMode === "signup" ? "new-password" : "current-password"} value={authDraft.password} onChange={(e) => setAuthDraft({ ...authDraft, password: e.target.value })} /></label>
      {authError && <p className="form-error full-field">{authError}</p>}<button className="button primary full-field" type="submit">{authMode === "signup" ? "Create account" : "Sign in"} <ArrowRight size={17} /></button></form><button className="text-button auth-switch" onClick={() => { setAuthError(""); setAuthMode(authMode === "signup" ? "login" : "signup"); }}>{authMode === "signup" ? "Already have an account? Sign in" : "New to Gamz? Create an account"}</button></section></div>}

    {logoutConfirmation && <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !signingOut) setLogoutConfirmation(false); }}><section className="modal logout-modal" role="dialog" aria-modal="true" aria-labelledby="logout-title" aria-describedby="logout-description" aria-busy={signingOut} onKeyDown={(event) => { if (event.key === "Escape" && !signingOut) setLogoutConfirmation(false); }}><button className="modal-close" aria-label="Close" disabled={signingOut} onClick={() => setLogoutConfirmation(false)}><X size={20} /></button><span className="eyebrow">ACCOUNT</span><h2 id="logout-title">Logout Confirmation</h2><p id="logout-description">Are you sure you want to log out of your account?</p><div className="logout-actions"><button className="button quiet" autoFocus disabled={signingOut} onClick={() => setLogoutConfirmation(false)}>Cancel</button><button className="button logout-confirm" disabled={signingOut} onClick={handleSignOut}>{signingOut ? "Logging out…" : "Log out"} <LogOut size={16} /></button></div></section></div>}

    {selectedProduct && <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setSelectedProduct(null); }}><section className="modal order-modal" role="dialog" aria-modal="true" aria-labelledby="order-title"><button className="modal-close" aria-label="Close" onClick={() => setSelectedProduct(null)}><X size={20} /></button><span className="eyebrow">SCHEDULE A PICKUP</span><h2 id="order-title">{productLabel(selectedProduct)}</h2><p>{selectedProduct.description}</p><div className="order-summary"><span>{peso(selectedProduct.price)} each</span><span>{selectedProduct.stock} in stock</span></div><form className="form-grid pickup-order-form" onSubmit={placeOrder}><label>Quantity<input required type="number" min="1" max={selectedProduct.stock} step="1" value={orderDraft.quantity} onChange={(e) => setOrderDraft({ ...orderDraft, quantity: e.target.value })} /></label><label>Pickup date<input required type="date" min={today()} value={orderDraft.pickupDate} onChange={(e) => setOrderDraft({ ...orderDraft, pickupDate: e.target.value })} /></label><label>Pickup time<input required type="time" value={orderDraft.pickupTime} onChange={(e) => setOrderDraft({ ...orderDraft, pickupTime: e.target.value })} /></label>{promoUnavailableMessage(selectedProduct) && <p className="form-error full-field" role="status">{promoUnavailableMessage(selectedProduct)}</p>}<p className="total-line full-field"><span>Estimated total</span><strong>{peso(selectedProduct.price * (Number(orderDraft.quantity) || 0))}</strong></p><button className="button primary full-field" type="submit" disabled={Boolean(promoUnavailableMessage(selectedProduct))}>Place pickup order <ArrowRight size={17} /></button></form><small className="modal-footnote">Your request is pending until Gamz confirms it. Bring valid ID at pickup.</small></section></div>}

    {pickupConfirmationOpen && selectedProduct && <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !placingOrder) setPickupConfirmationOpen(false); }}><section className="modal pickup-confirmation-modal" role="alertdialog" aria-modal="true" aria-labelledby="pickup-confirm-title" aria-describedby="pickup-confirm-description" aria-busy={placingOrder} onKeyDown={(event) => { if (event.key === "Escape" && !placingOrder) setPickupConfirmationOpen(false); }}><button className="modal-close" aria-label="Close confirmation" disabled={placingOrder} onClick={() => setPickupConfirmationOpen(false)}><X size={20} /></button><span className="eyebrow">ORDER CONFIRMATION</span><h2 id="pickup-confirm-title">Confirm your pickup order?</h2><p id="pickup-confirm-description">Please prepare a downpayment of at least <strong>{peso(minimumDownpayment)}</strong> (30% of the order total). Confirm to submit your pickup request.</p><div className="pickup-downpayment-summary"><span>Order total<strong>{peso(pickupTotal)}</strong></span><span>Minimum downpayment (30%)<strong>{peso(minimumDownpayment)}</strong></span></div><div className="confirmation-actions"><button type="button" className="button quiet" autoFocus disabled={placingOrder} onClick={() => setPickupConfirmationOpen(false)}>Go back</button><button type="button" className="button primary" disabled={placingOrder} onClick={confirmPlaceOrder}>{placingOrder ? "Placing order…" : "Confirm pickup order"}{!placingOrder && <Check size={17} />}</button></div></section></div>}
    {conversationOrder && user && <OrderConversation key={conversationOrder.id} order={conversationOrder} user={user} viewerRole={isAdmin ? "admin" : "customer"} onClose={() => setConversationOrder(null)} onMessagesSeen={markOrderMessagesRead} />}

    {isAdmin && tab === "display" && <section className="admin-products workspace">
      <div className="page-heading">
        <div><span className="eyebrow">DISPLAY MANAGEMENT</span><h1>Display items</h1><p>Add and update products shown in the public display.</p></div>
        <button className="button primary" onClick={() => startProductEdit()}><Plus size={18} /> Add Display</button>
      </div>
      <div className="admin-product-list">{products.map((product) => <article className="admin-product-row" key={product.id}>
        <div className="admin-product-thumb" style={product.imageUrl ? { backgroundImage: `url("${product.imageUrl.replaceAll('"', '%22')}")` } : undefined} />
        <div className="admin-product-copy"><strong>{productLabel(product)}</strong>
          <small>{normalizedOrderName(product.name)}</small>
          <small>{peso(product.price)} | {product.stock} in stock | {product.saleType === "promo" ? "Promo" : "Regular"}{product.saleType === "promo" && product.promoStartDate && product.promoEndDate ? ` | ${product.promoStartDate} to ${product.promoEndDate}` : ""}</small>
          <small>{product.description}</small>
        </div>
        <span className={product.active ? "active-pill" : "inactive-pill"}>{product.active ? "Live" : "Hidden"}</span>
        <button className="button quiet compact" onClick={() => startProductEdit(product)}>Edit</button>
        <button className="button quiet compact" onClick={() => confirmProductVisibility(product)}>{product.active ? "Hide" : "Publish"}</button>
        <button className="button quiet compact display-delete-button" onClick={() => confirmProductDelete(product)}><Trash2 size={14} /> Delete</button>
      </article>)}</div>

    </section>}

    {tab === "shop" && <footer className="site-footer"><div className="site-footer-inner">
      <Link className="footer-brand" href="/" aria-label="GAMZ Fireworks and Liquors homepage" onClick={() => setTab("shop")}><Image className="footer-logo" src="/logo.png" alt="" aria-hidden="true" width={48} height={48} /><span className="footer-brand-copy"><strong>GAMZ</strong><small>Fireworks and Liquors</small></span></Link>
      <div className="footer-actions"><button type="button" className="footer-icon-button" aria-label="View store location" title="View store location" onClick={() => setLocationOpen(true)}><MapPin size={22} /></button><a className="footer-icon-button" aria-label="Visit GAMZ on Facebook" title="Facebook" href="https://www.facebook.com/kimaii23#" target="_blank" rel="noopener noreferrer"><Facebook size={22} /></a></div>
    </div></footer>}

    {locationOpen && <div className="modal-backdrop location-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setLocationOpen(false); }} onKeyDown={(event) => { if (event.key === "Escape") setLocationOpen(false); }}><section className="modal location-modal" role="dialog" aria-modal="true" aria-labelledby="store-location-title"><button className="modal-close" aria-label="Close store location" onClick={() => setLocationOpen(false)}><X size={20} /></button><span className="eyebrow">VISIT GAMZ</span><h2 id="store-location-title">Store location</h2><p>Find us on the map or open Google Maps for directions.</p><div className="location-map"><iframe title="GAMZ Fireworks and Liquors location in satellite view" src="https://www.google.com/maps?q=8.94325171350585,125.5303620989787&amp;t=k&amp;z=18&amp;output=embed" loading="lazy" referrerPolicy="no-referrer-when-downgrade" allowFullScreen /></div><a className="button primary location-directions" href="https://www.google.com/maps/dir/?api=1&amp;destination=8.94325171350585%2C125.5303620989787" target="_blank" rel="noopener noreferrer">Get Direction</a></section></div>}
  </main>;
}

function CatalogProductCard({ product, onOrder }: { product: Product; onOrder: () => void }) {
  const promoMessage = promoUnavailableMessage(product);
  return <article className="product-card">
    <div className="product-image" style={product.imageUrl ? { backgroundImage: `url("${product.imageUrl.replaceAll('"', "%22")}")` } : undefined}>
      <span className={product.saleType === "promo" ? "product-badge promo" : "product-badge"}>{product.saleType === "promo" ? "PROMO" : "REGULAR"}</span>
      {!(product.stock > 0) && <span className="sold-out">Out of Stock</span>}
    </div>
    <div className="product-copy">
      <div className="product-name-line"><h3>{productLabel(product)}</h3><strong>{peso(product.price)}</strong></div>
      <p>{[normalizedOrderName(product.name), product.description].filter(Boolean).join(" · ") || "Ready for your next celebration."}</p>
      {product.saleType === "promo" && <small className="promo-dates">Promo: {product.promoStartDate || "date not set"} - {product.promoEndDate || "date not set"}{promoMessage ? ` · ${promoMessage}` : ""}</small>}
      <div className="product-bottom"><span>{product.stock > 0 ? `${product.stock} in stock` : "0 in stock"}</span><button className="button small primary" aria-label={promoMessage || `Order ${productLabel(product)}`} disabled={!(product.stock > 0) || Boolean(promoMessage)} onClick={onOrder}>Order <ArrowRight size={15} /></button></div>
    </div>
  </article>;
}

function AdminOrderDashboard({ orders, products, unreadMessageOrderIds, onUpdate, onMessage, onAddDisplay, onEditDisplay, onToggleDisplay, onDeleteDisplay }: { orders: ShopOrder[]; products: Product[]; unreadMessageOrderIds: ReadonlySet<string>; onUpdate: (order: ShopOrder, changes: Partial<ShopOrder>) => Promise<boolean>; onMessage: (order: ShopOrder) => void; onAddDisplay: () => void; onEditDisplay: (product: Product) => void; onToggleDisplay: (product: Product) => void; onDeleteDisplay: (product: Product) => void }) {
  const [selectedDate, setSelectedDate] = useState(today);
  const [month, setMonth] = useState(() => { const date = new Date(); return new Date(date.getFullYear(), date.getMonth(), 1); });
  const [filter, setFilter] = useState<"all" | "needs-payment" | "ready">("all");
  const [rescheduleDraft, setRescheduleDraft] = useState<{ orderId: string; pickupDate: string; pickupTime: string } | null>(null);
  const [rescheduleConfirmation, setRescheduleConfirmation] = useState<{ orderId: string; pickupDate: string; pickupTime: string } | null>(null);
  const [savingReschedule, setSavingReschedule] = useState(false);
  const [rescheduleError, setRescheduleError] = useState("");
  const allOrders = orders.length;
  const needsPayment = orders.filter((order) => order.status !== "cancelled" && orderBalance(order) > 0).length;
  const readyToPickup = orders.filter((order) => order.status === "ready").length;
  const totalSold = orders.filter((order) => order.pickupDate === selectedDate && order.status !== "cancelled" && order.paymentStatus === "paid").reduce((total, order) => total + order.total, 0);
  const monthStart = new Date(month.getFullYear(), month.getMonth(), 1);
  const daysInMonth = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  const orderCounts = new Map<string, number>();
  orders.forEach((order) => orderCounts.set(order.pickupDate, (orderCounts.get(order.pickupDate) ?? 0) + 1));
  const calendarDays = [...Array(monthStart.getDay()).fill(null), ...Array.from({ length: daysInMonth }, (_, index) => index + 1)];
  const selectedOrders = orders.filter((order) => {
    if (order.pickupDate !== selectedDate) return false;
    if (filter === "needs-payment") return order.status !== "cancelled" && orderBalance(order) > 0;
    if (filter === "ready") return order.status === "ready";
    return true;
  }).sort((a, b) => a.pickupTime.localeCompare(b.pickupTime));
  const selectedDateLabel = new Date(`${selectedDate}T12:00:00`).toLocaleDateString("en-PH", { month: "long", day: "numeric", year: "numeric" });
  const confirmingRescheduleOrder = rescheduleConfirmation ? orders.find((order) => order.id === rescheduleConfirmation.orderId) : undefined;
  const metrics = [
    { id: "all" as const, label: "All Orders", value: String(allOrders), icon: <PackageCheck size={18} />, className: "orders-metric peach" },
    { id: "needs-payment" as const, label: "Needs Payment", value: String(needsPayment), icon: <Banknote size={18} />, className: "orders-metric coral" },
    { id: "ready" as const, label: "Ready to Pickup", value: String(readyToPickup), icon: <Clock3 size={18} />, className: "orders-metric yellow" },
  ];

  function openReschedule(order: ShopOrder) {
    setRescheduleDraft({ orderId: order.id, pickupDate: order.pickupDate, pickupTime: order.pickupTime });
    setRescheduleConfirmation(null);
    setRescheduleError("");
  }

  function prepareReschedule(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!rescheduleDraft || !rescheduleDraft.pickupDate || !rescheduleDraft.pickupTime || rescheduleDraft.pickupDate < today()) return;
    setRescheduleError("");
    setRescheduleConfirmation({ ...rescheduleDraft });
  }

  async function confirmReschedule() {
    if (!rescheduleConfirmation || savingReschedule) return;
    const order = orders.find((item) => item.id === rescheduleConfirmation.orderId);
    if (!order) {
      setRescheduleDraft(null);
      setRescheduleConfirmation(null);
      return;
    }
    setSavingReschedule(true);
    setRescheduleError("");
    try {
      const saved = await onUpdate(order, { pickupDate: rescheduleConfirmation.pickupDate, pickupTime: rescheduleConfirmation.pickupTime });
      if (saved) {
        setRescheduleDraft(null);
        setRescheduleConfirmation(null);
      } else {
        setRescheduleError("Could not save the new pickup schedule. Please try again.");
      }
    } catch {
      setRescheduleError("Could not save the new pickup schedule. Please try again.");
    } finally {
      setSavingReschedule(false);
    }
  }

  return <section className="workspace admin-workspace order-dashboard">
    <div className="page-heading"><div><span className="eyebrow">STORE DESK</span><h1>Order List</h1><p>Review payments and prepare scheduled pickups.</p></div></div>
    <div className="order-metrics">
      {metrics.map((metric) => <button key={metric.id} className={`${metric.className}${filter === metric.id ? " selected" : ""}`} aria-pressed={filter === metric.id} onClick={() => setFilter(metric.id)}><span className="orders-metric-heading">{metric.label}{metric.icon}</span><strong>{metric.value}</strong></button>)}
      <div className="orders-metric total-sold"><span className="orders-metric-heading">Total Sold<Banknote size={18} /></span><strong>{peso(totalSold)}</strong></div>
    </div>
    <div className="order-calendar-layout">
      <section className="calendar-panel" aria-label="Pickup calendar">
        <div className="calendar-heading"><button className="icon-button" aria-label="Previous month" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}><ArrowRight className="previous-month-icon" size={18} /></button><h2>{month.toLocaleDateString("en-PH", { month: "long", year: "numeric" })}</h2><div className="calendar-nav"><button className="icon-button" aria-label="Next month" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}><ArrowRight size={18} /></button><button className="button quiet small" onClick={() => { const date = new Date(); setMonth(new Date(date.getFullYear(), date.getMonth(), 1)); setSelectedDate(today()); }}>Today</button></div></div>
        <div className="calendar-grid calendar-weekdays">{"Sun Mon Tue Wed Thu Fri Sat".split(" ").map((day) => <span key={day}>{day}</span>)}</div>
        <div className="calendar-grid calendar-days">{calendarDays.map((day, index) => {
          if (!day) return <span className="calendar-blank" key={`blank-${index}`} />;
          const dateKey = `${month.getFullYear()}-${String(month.getMonth() + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
          const count = orderCounts.get(dateKey) ?? 0;
          return <button key={dateKey} className={`calendar-day${selectedDate === dateKey ? " selected" : ""}${count ? " has-orders" : ""}`} aria-label={`${dateKey}${count ? `, ${count} orders` : ""}`} aria-pressed={selectedDate === dateKey} onClick={() => setSelectedDate(dateKey)}><span>{day}</span>{count > 0 && <small>{count}</small>}</button>;
        })}</div>
      </section>
      <section className="selected-date-panel">
        <div className="selected-date-heading"><div><span className="eyebrow">SELECTED DATE</span><h2>{selectedDateLabel}</h2></div><span className="date-order-count">{selectedOrders.length} {selectedOrders.length === 1 ? "order" : "orders"}</span></div>
        {selectedOrders.length ? <>
          <div className="admin-order-table-head"><span>Name</span><span>Order</span><span>Balance</span><span>Action</span></div>
          <div className="admin-order-table">{selectedOrders.map((order) => <article className="admin-order-row" key={order.id}>
            <div className="admin-order-name"><strong>{order.customer}</strong><small>{order.phone} · {formatPickupTime(order.pickupTime)}</small></div>
            <div className="admin-order-items"><strong>{order.quantity} {order.quantity === 1 ? "item" : "items"}</strong><span>· {order.productName}</span></div>
            <button className={`payment-balance${orderBalance(order) === 0 ? " paid" : ""}`} aria-label={orderBalance(order) === 0 ? `${order.customer}'s order is fully paid` : `Mark ${order.customer}'s order paid (${peso(orderBalance(order))})`} disabled={orderBalance(order) === 0} onClick={() => onUpdate(order, { paymentStatus: "paid" })}>{orderBalance(order) === 0 ? "Paid" : peso(orderBalance(order))}</button>
            <div className="admin-order-actions"><select aria-label={`Pickup status for ${order.customer}`} value={order.status} onChange={(event) => onUpdate(order, { status: event.target.value as ShopOrder["status"] })}><option value="pending">Needs pickup</option><option value="ready">Ready</option><option value="completed">Completed</option><option value="cancelled">Cancelled</option></select><button type="button" className="text-button reschedule-button" onClick={() => openReschedule(order)}>Reschedule</button></div>
          </article>)}</div>
        </> : <div className="empty-state compact-empty"><span className="empty-icon"><ShoppingBag size={22} /></span><h2>No orders for this date</h2><p>{filter === "all" ? "Pickup orders for this day will appear here." : "No orders match this filter for the selected day."}</p></div>}
      </section>
    </div>
    <PickupList orders={orders} selectedDate={selectedDate} unreadMessageOrderIds={unreadMessageOrderIds} onUpdate={onUpdate} onMessage={onMessage} />
    <DisplayManagement products={products} onAdd={onAddDisplay} onEdit={onEditDisplay} onToggle={onToggleDisplay} onDelete={onDeleteDisplay} />
    {rescheduleDraft && !rescheduleConfirmation && <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setRescheduleDraft(null); }} onKeyDown={(event) => { if (event.key === "Escape") setRescheduleDraft(null); }}><section className="modal reschedule-modal" role="dialog" aria-modal="true" aria-labelledby="reschedule-title"><button className="modal-close" aria-label="Close reschedule form" onClick={() => setRescheduleDraft(null)}><X size={20} /></button><span className="eyebrow">UPDATE PICKUP</span><h2 id="reschedule-title">Reschedule pickup</h2><p>Choose a new pickup date and time.</p><form className="form-grid reschedule-form" onSubmit={prepareReschedule}><label className="full-field">Pickup Date<input required type="date" min={today()} value={rescheduleDraft.pickupDate} onChange={(event) => setRescheduleDraft({ ...rescheduleDraft, pickupDate: event.target.value })} /></label><label className="full-field">Pickup Time<input required type="time" value={rescheduleDraft.pickupTime} onChange={(event) => setRescheduleDraft({ ...rescheduleDraft, pickupTime: event.target.value })} /></label><div className="confirmation-actions full-field"><button type="button" className="button quiet" onClick={() => setRescheduleDraft(null)}>Cancel</button><button type="submit" className="button primary">Continue <ArrowRight size={17} /></button></div></form></section></div>}
    {rescheduleConfirmation && <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !savingReschedule) setRescheduleConfirmation(null); }} onKeyDown={(event) => { if (event.key === "Escape" && !savingReschedule) setRescheduleConfirmation(null); }}><section className="modal pickup-confirmation-modal" role="alertdialog" aria-modal="true" aria-labelledby="reschedule-confirm-title" aria-describedby="reschedule-confirm-description" aria-busy={savingReschedule}><button className="modal-close" aria-label="Close reschedule confirmation" disabled={savingReschedule} onClick={() => setRescheduleConfirmation(null)}><X size={20} /></button><span className="eyebrow">CONFIRM SCHEDULE</span><h2 id="reschedule-confirm-title">Confirm reschedule?</h2><p id="reschedule-confirm-description">Change {confirmingRescheduleOrder?.productName ?? "this order"} for {confirmingRescheduleOrder?.customer ?? "the customer"} to:</p><div className="reschedule-summary"><span>Pickup Date<strong>{new Date(`${rescheduleConfirmation.pickupDate}T12:00:00`).toLocaleDateString("en-PH", { month: "long", day: "numeric", year: "numeric" })}</strong></span><span>Pickup Time<strong>{formatPickupTime(rescheduleConfirmation.pickupTime)}</strong></span></div>{rescheduleError && <p className="reschedule-error" role="alert">{rescheduleError}</p>}<div className="confirmation-actions"><button type="button" className="button quiet" disabled={savingReschedule} onClick={() => setRescheduleConfirmation(null)}>Back to edit</button><button type="button" className="button primary" disabled={savingReschedule} onClick={confirmReschedule}>{savingReschedule ? "Saving…" : "Confirm reschedule"}</button></div></section></div>}
  </section>;
}

function PickupList({ orders, selectedDate, unreadMessageOrderIds, onUpdate, onMessage }: { orders: ShopOrder[]; selectedDate: string; unreadMessageOrderIds: ReadonlySet<string>; onUpdate: (order: ShopOrder, changes: Partial<ShopOrder>) => Promise<boolean>; onMessage: (order: ShopOrder) => void }) {
  const [confirmation, setConfirmation] = useState<{ orderId: string; action: "payment" | "delivered" } | null>(null);
  const [savingOrderId, setSavingOrderId] = useState<string | null>(null);
  const [deliveredDateFilter, setDeliveredDateFilter] = useState("");
  const [deliveredMonthFilter, setDeliveredMonthFilter] = useState("");
  const pickupOrders = orders.filter((order) => order.pickupDate === selectedDate && order.status !== "cancelled" && order.status !== "delivered").sort((a, b) => a.pickupTime.localeCompare(b.pickupTime));
  const deliveredOrders = orders.filter((order) => order.status === "delivered").sort((a, b) => (b.deliveredAt ?? b.createdAt) - (a.deliveredAt ?? a.createdAt));
  const filteredDeliveredOrders = deliveredOrders.filter((order) => {
    const deliveryDate = new Date(order.deliveredAt ?? order.createdAt).toLocaleDateString("en-CA", { timeZone: "Asia/Manila" });
    return (!deliveredDateFilter || deliveryDate === deliveredDateFilter) && (!deliveredMonthFilter || deliveryDate.slice(0, 7) === deliveredMonthFilter);
  });

  async function saveDownpayment(order: ShopOrder, input: HTMLInputElement) {
    const enteredValue = input.value.trim();
    const amount = Number(enteredValue);
    if (order.status === "delivered" || order.status === "cancelled" || !enteredValue || !Number.isFinite(amount) || amount < 0 || amount > order.total) {
      input.value = String(order.downpayment ?? 0);
      return;
    }
    const normalizedAmount = Math.round(amount * 100) / 100;
    input.value = String(normalizedAmount);
    if (normalizedAmount === (order.downpayment ?? 0)) return;
    const saved = await onUpdate(order, { downpayment: normalizedAmount, ...(normalizedAmount >= order.total ? { paymentStatus: "paid" } : {}) });
    if (!saved) input.value = String(order.downpayment ?? 0);
  }

  async function confirmAction() {
    if (!confirmation || savingOrderId) return;
    const order = orders.find((item) => item.id === confirmation.orderId);
    if (!order) { setConfirmation(null); return; }
    if (confirmation.action === "payment" && orderBalance(order) === 0) { setConfirmation(null); return; }
    if (confirmation.action === "delivered" && (order.status === "cancelled" || order.status === "delivered" || orderBalance(order) > 0)) { setConfirmation(null); return; }
    setSavingOrderId(order.id);
    const changes: Partial<ShopOrder> = confirmation.action === "payment"
      ? { paymentStatus: "paid" }
      : { status: "delivered", deliveredAt: Date.now(), ...(orderBalance(order) === 0 ? { paymentStatus: "paid" } : {}) };
    const saved = await onUpdate(order, changes);
    if (saved) setConfirmation(null);
    setSavingOrderId(null);
  }

  function renderPickupOrder(order: ShopOrder, delivered = false) {
    const balance = orderBalance(order);
    return <article className={`pickup-order-card${delivered ? " delivered" : ""}`} key={order.id}>
      <div className="pickup-order-field pickup-customer"><span>Name</span><strong>{order.customer}</strong><a href={`tel:${order.phone}`}>{order.phone}</a></div>
      <div className="pickup-order-field"><span>Order Name</span><strong>{normalizedOrderName(order.orderName ?? order.productName)}</strong>{order.orderName && <small>Product · {order.productName}</small>}<small>{order.quantity} × {peso(order.total / Math.max(order.quantity, 1))} <b>·</b> {peso(order.total)}</small></div>
      <div className="pickup-order-field"><span>Pickup Date</span><strong>{new Date(`${order.pickupDate}T12:00:00`).toLocaleDateString("en-PH", { month: "short", day: "numeric", year: "numeric" })}</strong><small>Pickup Time · {formatPickupTime(order.pickupTime)}</small></div>
      <div className="pickup-order-field"><span>Downpayment</span>{delivered ? <strong>{peso(order.downpayment ?? 0)}</strong> : <label className="pickup-downpayment-input">₱<input type="number" min="0" max={order.total} step="0.01" defaultValue={order.downpayment ?? 0} key={`${order.id}-${order.downpayment ?? 0}`} aria-label={`Downpayment for ${order.customer}`} onBlur={(event) => saveDownpayment(order, event.currentTarget)} /></label>}</div>
      <div className="pickup-order-field pickup-order-balance"><span>Balance</span><strong>{peso(balance)}</strong>{order.paymentStatus === "paid" || balance === 0 ? <span className="pickup-paid-label">Fully paid</span> : delivered ? <span className="pickup-paid-label">Payment due</span> : <button className="pickup-payment-button" onClick={() => setConfirmation({ orderId: order.id, action: "payment" })}>Fully Paid (Click Here)</button>}</div>
      <div className="pickup-order-actions"><MessageButton unread={unreadMessageOrderIds.has(order.id)} onClick={() => onMessage(order)} />{delivered ? <span className="pickup-delivered-label"><Check size={15} /> Delivered</span> : <button className="button primary small" onClick={() => setConfirmation({ orderId: order.id, action: "delivered" })} disabled={balance > 0} title={balance > 0 ? "Collect the remaining balance before marking delivered." : undefined}>Mark Delivered</button>}</div>
    </article>;
  }

  const confirmingOrder = confirmation ? orders.find((item) => item.id === confirmation.orderId) : undefined;
  const confirmingPayment = confirmation?.action === "payment";
  const isSaving = Boolean(confirmingOrder && savingOrderId === confirmingOrder.id);

  return <section className="pickup-list-section" aria-labelledby="pickup-list-title">
    <div className="pickup-list-heading"><div><span className="eyebrow">STORE DESK</span><h2 id="pickup-list-title">The Pickup List</h2><p>Orders scheduled for {new Date(`${selectedDate}T12:00:00`).toLocaleDateString("en-PH", { month: "long", day: "numeric", year: "numeric" })}.</p></div><span className="date-order-count">{pickupOrders.length} {pickupOrders.length === 1 ? "order" : "orders"}</span></div>
    {pickupOrders.length ? <div className="pickup-order-list">{pickupOrders.map((order) => renderPickupOrder(order))}</div> : <div className="pickup-list-empty"><span className="empty-icon"><ShoppingBag size={22} /></span><div><strong>No pickup orders for this date</strong><p>Choose another date on the calendar to view its orders.</p></div></div>}
    <div className="pickup-list-heading delivered-list-heading"><div><span className="eyebrow">COMPLETED HANDOFFS</span><h2>Delivered Orders</h2><p>Orders already handed to customers.</p></div><div className="delivered-list-filters"><label>Specific date<input type="date" value={deliveredDateFilter} onChange={(event) => setDeliveredDateFilter(event.target.value)} /></label><label>Month and year<input type="month" value={deliveredMonthFilter} onChange={(event) => setDeliveredMonthFilter(event.target.value)} /></label>{(deliveredDateFilter || deliveredMonthFilter) && <button className="text-button" onClick={() => { setDeliveredDateFilter(""); setDeliveredMonthFilter(""); }}>Clear filters</button>}</div></div>
    {deliveredOrders.length === 0 ? <div className="pickup-list-empty compact"><strong>No delivered orders just yet.</strong></div> : filteredDeliveredOrders.length === 0 ? <div className="pickup-list-empty compact"><strong>No delivered orders match these filters.</strong></div> : <div className="pickup-order-list">{filteredDeliveredOrders.map((order) => renderPickupOrder(order, true))}</div>}
    {confirmation && confirmingOrder && <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !savingOrderId) setConfirmation(null); }} onKeyDown={(event) => { if (event.key === "Escape" && !savingOrderId) setConfirmation(null); }}><section className="modal pickup-confirmation-modal" role="alertdialog" aria-modal="true" aria-labelledby="pickup-confirm-title" aria-describedby="pickup-confirm-description" aria-busy={isSaving}><button className="modal-close" aria-label="Close confirmation" disabled={isSaving} onClick={() => setConfirmation(null)}><X size={20} /></button><span className="eyebrow">ORDER CONFIRMATION</span><h2 id="pickup-confirm-title">{confirmingPayment ? "Confirm full payment?" : "Confirm order delivery?"}</h2><p id="pickup-confirm-description">{confirmingPayment ? <>Has <strong>{confirmingOrder.customer}</strong> paid the full remaining balance? Confirm after receiving the payment.</> : <>Confirm that <strong>{confirmingOrder.customer}</strong> has picked up this order.</>}</p><div className="confirmation-actions"><button className="button quiet" autoFocus disabled={isSaving} onClick={() => setConfirmation(null)}>{confirmingPayment ? "Not yet" : "Keep pending"}</button><button className="button primary" disabled={isSaving} onClick={confirmAction}>{isSaving ? "Saving…" : confirmingPayment ? "Confirm full payment" : "Mark Delivered"}</button></div></section></div>}
  </section>;
}

function DisplayManagement({ products, onAdd, onEdit, onToggle, onDelete }: { products: Product[]; onAdd: () => void; onEdit: (product: Product) => void; onToggle: (product: Product) => void; onDelete: (product: Product) => void }) {
  const sortedProducts = [...products].sort((a, b) => a.name.localeCompare(b.name));

  return <section className="display-management" aria-labelledby="display-management-title">
    <div className="display-management-heading">
      <div><span className="eyebrow">CATALOG CONTROL</span><h2 id="display-management-title">Display Management</h2><p>Create, edit, publish, hide, or delete items in the public display.</p></div>
      <button className="button primary" onClick={onAdd}><Plus size={18} /> Add Display</button>
    </div>
    {sortedProducts.length ? <div className="display-management-list">{sortedProducts.map((product) => <article className="display-management-row" key={product.id}>
      <div className="display-management-thumb" style={product.imageUrl ? { backgroundImage: `url("${product.imageUrl.replaceAll('"', '%22')}")` } : undefined} />
      <div className="display-management-copy"><div className="display-management-title-line"><strong>{productLabel(product)}</strong><span className={product.active ? "active-pill" : "inactive-pill"}>{product.active ? "Live" : "Hidden"}</span></div>
        <small>{normalizedOrderName(product.name)}</small>
        <small>{peso(product.price)} · {product.stock} in stock · {product.saleType === "promo" ? "Promo" : "Regular"}{product.saleType === "promo" && product.promoStartDate && product.promoEndDate ? ` · ${product.promoStartDate} to ${product.promoEndDate}` : ""}</small>
        <small>{product.description}</small>
      </div>
      <div className="display-management-actions"><button className="button quiet compact" onClick={() => onEdit(product)}>Edit</button><button className="button quiet compact" onClick={() => onToggle(product)}>{product.active ? "Hide" : "Publish"}</button><button className="button quiet compact display-delete-button" aria-label={`Delete ${product.name}`} onClick={() => onDelete(product)}><Trash2 size={14} /><span>Delete</span></button></div>
    </article>)}</div> : <div className="display-management-empty"><span className="empty-icon"><ShoppingBag size={22} /></span><div><strong>No display items yet</strong><p>Add an item to start managing the public display.</p></div></div>}
  </section>;
}

function MessageButton({ unread, onClick }: { unread: boolean; onClick: () => void }) {
  return <button type="button" className="button quiet small message-action" aria-label={unread ? "Message, new message" : "Message"} title={unread ? "New message" : undefined} onClick={onClick}><MessageCircle size={15} /> Message{unread && <span className="message-notification-dot" aria-hidden="true" />}</button>;
}

function OrderList({ orders, products, unreadMessageOrderIds, onMessage, onCancel }: { orders: ShopOrder[]; products: Product[]; unreadMessageOrderIds: ReadonlySet<string>; onMessage: (order: ShopOrder) => void; onCancel: (order: ShopOrder) => Promise<boolean> }) {
  const [gcashQrOpen, setGcashQrOpen] = useState(false);
  const [cancelConfirmation, setCancelConfirmation] = useState<ShopOrder | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const currentTime = Date.now();
    const nextExpiry = orders
      .filter((order) => order.status === "pending" && Number.isSafeInteger(order.createdAt))
      .map((order) => order.createdAt + ORDER_CANCEL_WINDOW_MS)
      .filter((expiry) => expiry > currentTime)
      .sort((a, b) => a - b)[0];
    if (nextExpiry === undefined) return;
    const timeout = window.setTimeout(() => setNow(Date.now()), nextExpiry - currentTime + 1);
    return () => window.clearTimeout(timeout);
  }, [orders]);

  async function confirmCancel() {
    if (!cancelConfirmation || cancelling) return;
    setCancelling(true);
    try {
      await onCancel(cancelConfirmation);
      setCancelConfirmation(null);
    } finally {
      setCancelling(false);
    }
  }

  if (!orders.length) return <div className="empty-state"><span className="empty-icon"><ShoppingBag size={24} /></span><h2>No orders just yet</h2><p>Your orders will appear here after you schedule a pickup.</p></div>;
  return <>
    <div className="order-list">{orders.map((order) => {
      const canCancel = order.status === "pending" && Number.isSafeInteger(order.createdAt) && order.createdAt <= now && now < order.createdAt + ORDER_CANCEL_WINDOW_MS; const productImageUrl = order.productImageUrl ?? products.find((product) => product.id === order.productId)?.imageUrl;
      return <article className="order-row" key={order.id}><div className="order-item-icon">{productImageUrl ? <Image src={productImageUrl} alt={order.productName} width={44} height={44} unoptimized /> : <ShoppingBag size={20} />}</div><div className="order-main"><strong>{order.productName} <span>× {order.quantity}</span></strong>{order.orderName && <small>{normalizedOrderName(order.orderName)}</small>}<small>{order.customer} · {order.phone}</small><small><CalendarDays size={14} /> {order.pickupDate} <Clock3 size={14} /> {formatPickupTime(order.pickupTime)}</small></div><div className="order-total">{canCancel && <button type="button" className="order-cancel-button" onClick={() => setCancelConfirmation(order)}>Cancel</button>}<strong>{peso(order.total)}</strong><span className={`status ${order.status}`}>{order.status}</span></div><div className="order-actions"><button type="button" className="button quiet small" onClick={() => setGcashQrOpen(true)}><QrCode size={15} /> GCash QR</button><MessageButton unread={unreadMessageOrderIds.has(order.id)} onClick={() => onMessage(order)} /></div></article>;
    })}</div>
    {gcashQrOpen && <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setGcashQrOpen(false); }} onKeyDown={(event) => { if (event.key === "Escape") setGcashQrOpen(false); }}><section className="modal gcash-qr-modal" role="dialog" aria-modal="true" aria-labelledby="gcash-qr-title"><button className="modal-close" aria-label="Close GCash QR" onClick={() => setGcashQrOpen(false)}><X size={20} /></button><span className="eyebrow">GCASH PAYMENT</span><h2 id="gcash-qr-title">Pay here via GCash</h2><p>Scan the QR code or send your payment to this number.</p><Image className="gcash-qr-image" src="/gcash-qr.jpg" alt="Gamz GCash QR code" width={300} height={400} /><p className="gcash-qr-number"><span>GCash No.</span><strong>09989771033</strong></p><a className="button primary" href="/gcash-qr.jpg" download="gcash-qr.jpg"><Download size={17} /> Save this QR</a></section></div>}
    {cancelConfirmation && <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !cancelling) setCancelConfirmation(null); }} onKeyDown={(event) => { if (event.key === "Escape" && !cancelling) setCancelConfirmation(null); }}><section className="modal pickup-confirmation-modal" role="alertdialog" aria-modal="true" aria-labelledby="order-cancel-title" aria-describedby="order-cancel-description" aria-busy={cancelling}><button className="modal-close" aria-label="Close cancellation confirmation" disabled={cancelling} onClick={() => setCancelConfirmation(null)}><X size={20} /></button><span className="eyebrow">CANCEL ORDER</span><h2 id="order-cancel-title">Cancel this order?</h2><p id="order-cancel-description">Cancel your {cancelConfirmation.productName} pickup order? Its reserved stock will return to the display.</p><div className="confirmation-actions"><button type="button" className="button quiet" autoFocus disabled={cancelling} onClick={() => setCancelConfirmation(null)}>Keep order</button><button type="button" className="button order-cancel-confirm" disabled={cancelling} onClick={confirmCancel}>{cancelling ? "Cancelling…" : "Cancel order"}</button></div></section></div>}
  </>;
}
