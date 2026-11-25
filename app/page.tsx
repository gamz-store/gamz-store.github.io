"use client";

import { createUserWithEmailAndPassword, onAuthStateChanged, signInWithEmailAndPassword, signOut, type User } from "firebase/auth";
import { addDoc, collection, doc, onSnapshot, query, runTransaction, setDoc, updateDoc, where } from "firebase/firestore";
import { generateReactHelpers } from "@uploadthing/react";
import type { AnyFileRoute } from "uploadthing/types";
import { ArrowRight, BadgeCheck, CalendarDays, Check, CircleUserRound, Clock3, Flame, LogIn, LogOut, Menu, PackageCheck, Plus, ShieldAlert, ShoppingBag, Sparkles, Upload, Users, X } from "lucide-react";
import Image from "next/image";
import { useEffect, useState, type FormEvent } from "react";
import { auth, db, firebaseEnabled } from "@/lib/firebase";

const uploadThingUrl = process.env.NEXT_PUBLIC_UPLOADTHING_URL || "";
type GamzUploadRouter = { productImage: AnyFileRoute };
const { uploadFiles } = generateReactHelpers<GamzUploadRouter>({ url: uploadThingUrl || "/api/uploadthing" });

type Product = { id: string; name: string; description: string; stock: number; price: number; saleType: "regular" | "promo"; imageUrl: string; active: boolean };
type Profile = { firstName: string; lastName: string; suffix: string; province: string; municipality: string; barangay: string; street: string; phone: string; email: string; role: "user" | "admin" };
type ShopOrder = { id: string; userId: string; customer: string; phone: string; productId: string; productName: string; quantity: number; total: number; pickupDate: string; pickupTime: string; status: "pending" | "ready" | "completed" | "cancelled"; createdAt: number };
type Tab = "shop" | "orders" | "admin" | "checklist" | "users";
type AuthMode = "login" | "signup";

const suffixes = ["", "Jr.", "Sr.", "II", "III", "IV"];
const peso = (value: number) => `₱${value.toLocaleString("en-PH", { maximumFractionDigits: 2 })}`;
const today = () => { const date = new Date(); return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`; };

export default function Home() {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [profileReady, setProfileReady] = useState(false);
  const [products, setProducts] = useState<Product[]>([]);
  const [orders, setOrders] = useState<ShopOrder[]>([]);
  const [managedUsers, setManagedUsers] = useState<Array<Profile & { id: string }>>([]);
  const [tab, setTab] = useState<Tab>("shop");
  const [authMode, setAuthMode] = useState<AuthMode | null>(null);
  const [authError, setAuthError] = useState("");
  const [notice, setNotice] = useState("");
  const [ageAccepted, setAgeAccepted] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [confirmedOrder, setConfirmedOrder] = useState<ShopOrder | null>(null);
  const [editingProduct, setEditingProduct] = useState<string | null>(null);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [savingProduct, setSavingProduct] = useState(false);
  const [mobileNav, setMobileNav] = useState(false);
  const [authDraft, setAuthDraft] = useState({ firstName: "", lastName: "", suffix: "", province: "", municipality: "", barangay: "", street: "", phone: "", email: "", password: "" });
  const [productDraft, setProductDraft] = useState({ name: "", description: "", stock: "", price: "", saleType: "regular" as "regular" | "promo", imageUrl: "" });
  const [orderDraft, setOrderDraft] = useState({ quantity: "1", pickupDate: "", pickupTime: "" });
  const userId = user?.uid;

  useEffect(() => {
    setAgeAccepted(localStorage.getItem("gamz-age-confirmed") === "yes");
    if (!auth) return;
    let unsubscribeProfile: (() => void) | undefined;
    const unsubscribeAuth = onAuthStateChanged(auth, (nextUser) => {
      unsubscribeProfile?.();
      unsubscribeProfile = undefined;
      setUser(nextUser);
      if (!nextUser || !db) { setProfile(null); setProfileReady(true); return; }
      setProfileReady(false);
      unsubscribeProfile = onSnapshot(doc(db, "users", nextUser.uid), (snapshot) => {
        setProfile(snapshot.exists() ? snapshot.data() as Profile : null);
        setProfileReady(true);
      }, () => { setProfileReady(true); setNotice("Could not load your account profile."); });
    });
    return () => { unsubscribeProfile?.(); unsubscribeAuth(); };
  }, []);

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
    if (!db || profile?.role !== "admin") { setManagedUsers([]); return; }
    return onSnapshot(collection(db, "users"), (snapshot) => {
      setManagedUsers(snapshot.docs.map((item) => ({ id: item.id, ...item.data() } as Profile & { id: string })));
    }, () => setNotice("User list could not be loaded."));
  }, [profile?.role]);

  function acceptAge() {
    localStorage.setItem("gamz-age-confirmed", "yes");
    setAgeAccepted(true);
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
        const data = { firstName: authDraft.firstName.trim(), lastName: authDraft.lastName.trim(), suffix: authDraft.suffix, province: authDraft.province.trim(), municipality: authDraft.municipality.trim(), barangay: authDraft.barangay.trim(), street: authDraft.street.trim(), phone: authDraft.phone.trim(), email: authDraft.email.trim(), role: "user" } satisfies Profile;
        await setDoc(doc(db, "users", created.user.uid), data);
      }
      setAuthMode(null);
      setNotice(authMode === "signup" ? "Account created. Welcome to Gamz." : "You are signed in.");
    } catch (error) {
      setAuthError(error instanceof Error ? error.message.replace("Firebase: ", "") : "Sign-in failed. Please try again.");
    }
  }

  async function placeOrder(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!db || !user || !profile || !selectedProduct) { setNotice("Sign in to place an order."); return; }
    const quantity = Number(orderDraft.quantity);
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > selectedProduct.stock) { setNotice("Please choose a valid quantity within available stock."); return; }
    if (!orderDraft.pickupDate || !orderDraft.pickupTime || orderDraft.pickupDate < today()) { setNotice("Choose a valid pickup date and time."); return; }
    try {
      const orderRef = doc(collection(db, "orders"));
      const productRef = doc(db, "products", selectedProduct.id);
      const amount = selectedProduct.price * quantity;
      const order: ShopOrder = { id: orderRef.id, userId: user.uid, customer: `${profile.firstName} ${profile.lastName}`.trim(), phone: profile.phone, productId: selectedProduct.id, productName: selectedProduct.name, quantity, total: amount, pickupDate: orderDraft.pickupDate, pickupTime: orderDraft.pickupTime, status: "pending", createdAt: Date.now() };
      await runTransaction(db, async (transaction) => {
        const latest = await transaction.get(productRef);
        if (!latest.exists() || latest.data().active !== true) throw new Error("This item is no longer available.");
        if (Number(latest.data().stock) < quantity) throw new Error("Stock changed. Please adjust your quantity.");
          transaction.update(productRef, { stock: Number(latest.data().stock) - quantity, lastOrderId: orderRef.id });
        transaction.set(orderRef, order);
      });
      setSelectedProduct(null);
      setConfirmedOrder(order);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Order could not be placed.");
    }
  }

  function startProductEdit(product?: Product) {
    setEditingProduct(product?.id ?? "new");
    setImageFile(null);
    setProductDraft(product ? { name: product.name, description: product.description, stock: String(product.stock), price: String(product.price), saleType: product.saleType, imageUrl: product.imageUrl } : { name: "", description: "", stock: "", price: "", saleType: "regular", imageUrl: "" });
    document.getElementById("product-form")?.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  async function saveProduct(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!db || !user || !editingProduct) return;
    setSavingProduct(true);
    try {
      let imageUrl = productDraft.imageUrl.trim();
      if (imageFile) {
        if (!uploadThingUrl) throw new Error("Set NEXT_PUBLIC_UPLOADTHING_URL and deploy the UploadThing Worker to enable image uploads.");
        const uploaded = await uploadFiles("productImage", { files: [imageFile], headers: async () => ({ Authorization: `Bearer ${await user.getIdToken()}` }) });
        const file = uploaded?.[0] as { serverData?: { imageUrl?: string }; ufsUrl?: string; url?: string } | undefined;
        imageUrl = file?.serverData?.imageUrl ?? file?.ufsUrl ?? file?.url ?? imageUrl;
      }
      const data = { name: productDraft.name.trim(), description: productDraft.description.trim(), stock: Number(productDraft.stock), price: Number(productDraft.price), saleType: productDraft.saleType, imageUrl, active: true };
      if (!data.name || !Number.isInteger(data.stock) || data.stock < 0 || !Number.isFinite(data.price) || data.price < 0) throw new Error("Enter a name, non-negative whole stock, and valid price.");
      if (!imageUrl) throw new Error("Add an image URL or upload an image.");
      if (editingProduct === "new") await addDoc(collection(db, "products"), data);
      else await updateDoc(doc(db, "products", editingProduct), data);
      setEditingProduct(null);
      setNotice("Menu item saved.");
    } catch (error) { setNotice(error instanceof Error ? error.message : "Product could not be saved."); }
    finally { setSavingProduct(false); }
  }

  async function updateOrder(order: ShopOrder, changes: Partial<ShopOrder>) {
    if (!db) return;
    try { await updateDoc(doc(db, "orders", order.id), changes); }
    catch (error) { setNotice(error instanceof Error ? error.message : "Order update failed."); }
  }

  async function changeRole(uid: string, role: "admin" | "user") {
    if (!db) return;
    try { await updateDoc(doc(db, "users", uid), { role }); }
    catch (error) { setNotice(error instanceof Error ? error.message : "Role update failed."); }
  }

  async function toggleProduct(product: Product) {
    if (!db) return;
    try { await updateDoc(doc(db, "products", product.id), { active: !product.active }); }
    catch (error) { setNotice(error instanceof Error ? error.message : "Menu item update failed."); }
  }

  const isAdmin = profile?.role === "admin";
  const navItems: Array<{ id: Tab; label: string }> = isAdmin
    ? [{ id: "shop", label: "Display" }, { id: "admin", label: "Order list" }, { id: "checklist", label: "Checklist" }, { id: "users", label: "Users" }]
    : user ? [{ id: "shop", label: "Display" }, { id: "orders", label: "My orders" }] : [{ id: "shop", label: "Menu" }];
  const visibleOrders = isAdmin ? orders : orders.filter((order) => order.userId === user?.uid);

  return <main className="site-shell">
    {!ageAccepted && <div className="age-overlay"><section className="age-dialog"><span className="brand-mark"><Flame size={25} /></span><p className="eyebrow">WELCOME TO GAMZ</p><h1>Good times. <em>Grown-up choices.</em></h1><p>This shop offers alcoholic beverages and regulated fireworks. You must be at least 18 years old to continue. Fireworks sales and use are subject to local laws and safety requirements.</p><button className="button primary" onClick={acceptAge}>I am 18 or older <ArrowRight size={17} /></button><small>By continuing, you confirm that you meet the minimum age requirement.</small></section></div>}
    <header className="topbar"><a className="brand" href="#home" onClick={() => setTab("shop")}><span className="brand-mark"><Flame size={24} /></span><span><strong>GAMZ</strong><small>FIREWORKS & LIQUORS</small></span></a>
      <nav className={mobileNav ? "nav-links open" : "nav-links"}>{navItems.map((item) => <button key={item.id} className={tab === item.id ? "nav-link active" : "nav-link"} onClick={() => { setTab(item.id); setMobileNav(false); }}>{item.label}</button>)}</nav>
      <div className="account-actions">{user ? <><span className="account-name"><CircleUserRound size={17} />{profile?.firstName || user.email}</span><button className="icon-button" aria-label="Sign out" title="Sign out" onClick={() => signOut(auth!)}><LogOut size={18} /></button></> : <button className="button quiet" onClick={() => { setAuthMode("login"); setAuthError(""); }}><LogIn size={17} /> Sign in</button>}<button className="mobile-toggle" aria-label="Toggle navigation" onClick={() => setMobileNav(!mobileNav)}>{mobileNav ? <X size={21} /> : <Menu size={21} />}</button></div>
    </header>
    {notice && <div className="notice" role="status">{notice}<button aria-label="Dismiss message" onClick={() => setNotice("")}><X size={16} /></button></div>}

    {tab === "shop" && <><section className="hero" id="home"><div className="hero-copy"><span className="eyebrow"><span className="eyebrow-dot" /> YOUR CELEBRATION STARTS HERE</span><h1>Make a little<br /><em>more memorable.</em></h1><p>Party favorites, bright nights, and bottles worth sharing. Find your pick and schedule a convenient store pickup.</p><button className="button primary" onClick={() => document.getElementById("catalog")?.scrollIntoView({ behavior: "smooth" })}>Explore the menu <ArrowRight size={18} /></button><div className="hero-proof"><span><BadgeCheck size={17} /> Easy pickup scheduling</span><span><ShieldAlert size={17} /> 18+ only</span></div></div><div className="hero-art"><div className="hero-photo" /><div className="hero-sticker"><Sparkles size={18} /><strong>MAKE<br />IT A NIGHT</strong></div><span className="art-caption">GAMZ / CELEBRATE RESPONSIBLY</span></div><div className="hero-swoosh" /></section>
      <section className="catalog" id="catalog"><div className="section-title"><div><span className="eyebrow">THE GAMZ SELECTION</span><h2>Shop the menu</h2></div><span className="catalog-count">{products.length} {products.length === 1 ? "item" : "items"}</span></div>
        {!firebaseEnabled && <div className="setup-note"><ShieldAlert size={20} /><span><strong>Store setup in progress</strong><small>Add your Firebase web configuration to load products and enable orders.</small></span></div>}
        <div className="product-grid">{products.length ? products.map((product) => <article className="product-card" key={product.id}><div className="product-image" style={{ backgroundImage: `url("${product.imageUrl.replaceAll('"', '%22')}")` }}><span className={product.saleType === "promo" ? "product-badge promo" : "product-badge"}>{product.saleType === "promo" ? "SPECIAL PRICE" : "GAMZ PICK"}</span>{product.stock < 1 && <span className="sold-out">SOLD OUT</span>}</div><div className="product-copy"><div className="product-name-line"><h3>{product.name}</h3><strong>{peso(product.price)}</strong></div><p>{product.description || "Ready for your next celebration."}</p><div className="product-bottom"><span>{product.stock > 0 ? `${product.stock} in stock` : "Out of stock"}</span><button className="button small primary" disabled={product.stock < 1} onClick={() => { if (!user) { setAuthMode("login"); setNotice("Sign in or create an account to order."); return; } setSelectedProduct(product); setOrderDraft({ quantity: "1", pickupDate: "", pickupTime: "" }); }}>Order <ArrowRight size={15} /></button></div></div></article>) : <div className="empty-menu"><span className="empty-icon"><ShoppingBag size={24} /></span><h3>The shelves are getting ready.</h3><p>New favorites will show up here once the menu is published.</p>{!user && <button className="text-button" onClick={() => setAuthMode("signup")}>Create an account <ArrowRight size={15} /></button>}</div>}</div>
      </section><section className="pickup-band"><div><span className="eyebrow">PLAN AHEAD</span><h2>Choose your pickup time at checkout.</h2><p>Every order is confirmed by our team before pickup.</p></div><div className="pickup-icon"><CalendarDays size={28} /><Clock3 size={22} /></div></section></>}

    {tab === "orders" && <section className="workspace"><div className="page-heading"><div><span className="eyebrow">YOUR ACCOUNT</span><h1>My orders</h1><p>Pickup details and order status, all in one place.</p></div><button className="button quiet" onClick={() => setTab("shop")}>Back to menu <ArrowRight size={16} /></button></div><OrderList orders={visibleOrders} /></section>}

    {isAdmin && tab === "admin" && <section className="workspace admin-workspace"><div className="page-heading"><div><span className="eyebrow">STORE DESK</span><h1>Order list</h1><p>Track every pickup request and update its progress.</p></div><div className="metric"><strong>{orders.filter((order) => order.status === "pending").length}</strong><span>awaiting action</span></div></div><OrderList orders={orders} admin onUpdate={updateOrder} /></section>}

    {isAdmin && tab === "checklist" && <section className="workspace"><div className="page-heading"><div><span className="eyebrow">PICKUP PREP</span><h1>Order checklist</h1><p>Mark orders ready when they&apos;re set for handoff.</p></div><PackageCheck size={31} className="heading-icon" /></div><div className="checklist">{orders.filter((order) => order.status !== "completed" && order.status !== "cancelled").map((order) => <article className="check-row" key={order.id}><div className="check-icon"><ShoppingBag size={19} /></div><div className="check-details"><strong>{order.productName} <span>× {order.quantity}</span></strong><small>{order.customer} · {order.pickupDate} at {order.pickupTime}</small><small>{order.phone}</small></div><button className={order.status === "ready" ? "button ready" : "button quiet"} onClick={() => updateOrder(order, { status: order.status === "ready" ? "pending" : "ready" })}>{order.status === "ready" ? <><Check size={16} /> Ready</> : "Mark ready"}</button></article>)}{orders.filter((order) => order.status !== "completed" && order.status !== "cancelled").length === 0 && <p className="empty-inline">No active orders to prepare.</p>}</div></section>}

    {isAdmin && tab === "users" && <section className="workspace"><div className="page-heading"><div><span className="eyebrow">ACCOUNT DIRECTORY</span><h1>Users</h1><p>Review registered accounts and manage staff access.</p></div><div className="metric"><strong>{managedUsers.length}</strong><span>accounts</span></div></div><div className="user-list">{managedUsers.map((item) => <article className="user-row" key={item.id}><span className="user-avatar"><Users size={18} /></span><div><strong>{item.firstName} {item.lastName} {item.suffix}</strong><small>{item.email} · {item.phone}</small><small>{[item.street, item.barangay, item.municipality, item.province].filter(Boolean).join(", ")}</small></div><select aria-label={`Role for ${item.email}`} value={item.role} disabled={item.id === user?.uid} onChange={(event) => changeRole(item.id, event.target.value as "admin" | "user")}><option value="user">Customer</option><option value="admin">Admin</option></select></article>)}</div></section>}

    <footer className="footer"><a className="brand" href="#home"><span className="brand-mark"><Flame size={21} /></span><span><strong>GAMZ</strong><small>FIREWORKS & LIQUORS</small></span></a><p>Celebrate responsibly. 18+ only. Fireworks sales and use follow local regulations.</p><span>© {new Date().getFullYear()} Gamz</span></footer>

    {authMode && <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setAuthMode(null); }}><section className="modal auth-modal" role="dialog" aria-modal="true" aria-labelledby="auth-title"><button className="modal-close" aria-label="Close" onClick={() => setAuthMode(null)}><X size={20} /></button><span className="eyebrow">{authMode === "signup" ? "JOIN GAMZ" : "WELCOME BACK"}</span><h2 id="auth-title">{authMode === "signup" ? "Create your account" : "Sign in"}</h2><p>{authMode === "signup" ? "Save your details for a smoother pickup." : "Sign in to track orders and book your pickup."}</p><form className="form-grid" onSubmit={submitAuth}>
      {authMode === "signup" && <><label>First name<input required autoComplete="given-name" value={authDraft.firstName} onChange={(e) => setAuthDraft({ ...authDraft, firstName: e.target.value })} /></label><label>Last name<input required autoComplete="family-name" value={authDraft.lastName} onChange={(e) => setAuthDraft({ ...authDraft, lastName: e.target.value })} /></label><label>Suffix<select value={authDraft.suffix} onChange={(e) => setAuthDraft({ ...authDraft, suffix: e.target.value })}>{suffixes.map((suffix) => <option key={suffix} value={suffix}>{suffix || "None"}</option>)}</select></label><label>Contact number<input required type="tel" autoComplete="tel" value={authDraft.phone} onChange={(e) => setAuthDraft({ ...authDraft, phone: e.target.value })} /></label><label>Email<input required type="email" autoComplete="email" value={authDraft.email} onChange={(e) => setAuthDraft({ ...authDraft, email: e.target.value })} /></label><label>Province<input required value={authDraft.province} onChange={(e) => setAuthDraft({ ...authDraft, province: e.target.value, municipality: "", barangay: "" })} /></label><label>Municipality / city<input required disabled={!authDraft.province} value={authDraft.municipality} onChange={(e) => setAuthDraft({ ...authDraft, municipality: e.target.value, barangay: "" })} /></label><label>Barangay<input required disabled={!authDraft.municipality} value={authDraft.barangay} onChange={(e) => setAuthDraft({ ...authDraft, barangay: e.target.value })} /></label><label className="full-field">Street / house no.<input required autoComplete="street-address" value={authDraft.street} onChange={(e) => setAuthDraft({ ...authDraft, street: e.target.value })} /></label></>}
      <label className={authMode === "signup" ? "full-field" : ""}>Password<input required type="password" minLength={8} autoComplete={authMode === "signup" ? "new-password" : "current-password"} value={authDraft.password} onChange={(e) => setAuthDraft({ ...authDraft, password: e.target.value })} /></label>{authMode === "login" && <label className="full-field">Email<input required type="email" autoComplete="email" value={authDraft.email} onChange={(e) => setAuthDraft({ ...authDraft, email: e.target.value })} /></label>}
      {authError && <p className="form-error full-field">{authError}</p>}<button className="button primary full-field" type="submit">{authMode === "signup" ? "Create account" : "Sign in"} <ArrowRight size={17} /></button></form><button className="text-button auth-switch" onClick={() => { setAuthError(""); setAuthMode(authMode === "signup" ? "login" : "signup"); }}>{authMode === "signup" ? "Already have an account? Sign in" : "New to Gamz? Create an account"}</button></section></div>}

    {selectedProduct && <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setSelectedProduct(null); }}><section className="modal order-modal" role="dialog" aria-modal="true" aria-labelledby="order-title"><button className="modal-close" aria-label="Close" onClick={() => setSelectedProduct(null)}><X size={20} /></button><span className="eyebrow">SCHEDULE A PICKUP</span><h2 id="order-title">{selectedProduct.name}</h2><p>{selectedProduct.description}</p><div className="order-summary"><span>{peso(selectedProduct.price)} each</span><span>{selectedProduct.stock} in stock</span></div><form className="form-grid" onSubmit={placeOrder}><label>Quantity<input required type="number" min="1" max={selectedProduct.stock} step="1" value={orderDraft.quantity} onChange={(e) => setOrderDraft({ ...orderDraft, quantity: e.target.value })} /></label><label>Pickup date<input required type="date" min={today()} value={orderDraft.pickupDate} onChange={(e) => setOrderDraft({ ...orderDraft, pickupDate: e.target.value })} /></label><label className="full-field">Pickup time<input required type="time" value={orderDraft.pickupTime} onChange={(e) => setOrderDraft({ ...orderDraft, pickupTime: e.target.value })} /></label><p className="total-line full-field"><span>Estimated total</span><strong>{peso(selectedProduct.price * (Number(orderDraft.quantity) || 0))}</strong></p><button className="button primary full-field" type="submit">Place pickup order <ArrowRight size={17} /></button></form><small className="modal-footnote">Your request is pending until Gamz confirms it. Bring valid ID at pickup.</small></section></div>}

    {confirmedOrder && <div className="modal-backdrop"><section className="modal success-modal" role="dialog" aria-modal="true" aria-labelledby="success-title"><span className="success-mark"><Check size={26} /></span><span className="eyebrow">ORDER RECEIVED</span><h2 id="success-title">Pickup request confirmed.</h2><p>{confirmedOrder.quantity} × {confirmedOrder.productName} · {peso(confirmedOrder.total)}</p><p className="success-pickup"><CalendarDays size={17} /> {confirmedOrder.pickupDate} <Clock3 size={17} /> {confirmedOrder.pickupTime}</p><div className="payment-qr"><Image src="/gcash-qr.jpg" alt="Gamz InstaPay QR code" width={105} height={140} /><span><strong>Pay by InstaPay</strong><small>Verify the recipient name and amount in your banking app before sending.</small></span></div><button className="button primary" onClick={() => { setConfirmedOrder(null); setTab("orders"); }}>View my orders <ArrowRight size={17} /></button></section></div>}

    {isAdmin && tab === "shop" && <section className="admin-products workspace"><div className="page-heading"><div><span className="eyebrow">MENU MANAGEMENT</span><h1>Display items</h1><p>Add products or keep the public menu up to date.</p></div><button className="button primary" onClick={() => startProductEdit()}><Plus size={18} /> Add item</button></div><div className="admin-product-list">{products.map((product) => <article className="admin-product-row" key={product.id}><div className="admin-product-thumb" style={{ backgroundImage: `url("${product.imageUrl.replaceAll('"', '%22')}")` }} /><div className="admin-product-copy"><strong>{product.name}</strong><small>{peso(product.price)} · {product.stock} in stock · {product.saleType === "promo" ? "Promotion" : "Regular"}</small><small>{product.description}</small></div><span className={product.active ? "active-pill" : "inactive-pill"}>{product.active ? "Live" : "Hidden"}</span><button className="button quiet compact" onClick={() => startProductEdit(product)}>Edit</button><button className="button quiet compact" onClick={() => toggleProduct(product)}>{product.active ? "Hide" : "Publish"}</button></article>)}</div>
      {editingProduct && <form id="product-form" className="product-form" onSubmit={saveProduct}><div className="form-heading"><h2>{editingProduct === "new" ? "New menu item" : "Edit menu item"}</h2><button className="icon-button" type="button" aria-label="Close" onClick={() => setEditingProduct(null)}><X size={18} /></button></div><div className="form-grid"><label>Order name<input required value={productDraft.name} onChange={(e) => setProductDraft({ ...productDraft, name: e.target.value })} /></label><label>Price (₱)<input required type="number" min="0" step="0.01" value={productDraft.price} onChange={(e) => setProductDraft({ ...productDraft, price: e.target.value })} /></label><label>Stock<input required type="number" min="0" step="1" value={productDraft.stock} onChange={(e) => setProductDraft({ ...productDraft, stock: e.target.value })} /></label><label>Sale type<select value={productDraft.saleType} onChange={(e) => setProductDraft({ ...productDraft, saleType: e.target.value as "regular" | "promo" })}><option value="regular">Regular</option><option value="promo">Promotion</option></select></label><label className="full-field">Description<textarea rows={3} value={productDraft.description} onChange={(e) => setProductDraft({ ...productDraft, description: e.target.value })} /></label><label className="full-field">Image URL<input type="url" placeholder="https://..." value={productDraft.imageUrl} onChange={(e) => setProductDraft({ ...productDraft, imageUrl: e.target.value })} /></label><label className="full-field file-label"><Upload size={17} /> Upload image<input type="file" accept="image/jpeg,image/png,image/webp" onChange={(e) => setImageFile(e.target.files?.[0] ?? null)} /><small>{imageFile?.name || "JPEG, PNG or WebP, max 8 MB"}</small></label><button className="button primary full-field" disabled={savingProduct}>{savingProduct ? "Saving…" : "Save menu item"} <Check size={17} /></button></div></form>}
    </section>}
  </main>;
}

function OrderList({ orders, admin = false, onUpdate }: { orders: ShopOrder[]; admin?: boolean; onUpdate?: (order: ShopOrder, changes: Partial<ShopOrder>) => void }) {
  if (!orders.length) return <div className="empty-state"><span className="empty-icon"><ShoppingBag size={24} /></span><h2>No orders just yet</h2><p>Your orders will appear here after you schedule a pickup.</p></div>;
  return <div className="order-list">{orders.map((order) => <article className="order-row" key={order.id}><div className="order-item-icon"><ShoppingBag size={20} /></div><div className="order-main"><strong>{order.productName} <span>× {order.quantity}</span></strong><small>{order.customer} · {order.phone}</small><small><CalendarDays size={14} /> {order.pickupDate} <Clock3 size={14} /> {order.pickupTime}</small></div><div className="order-total"><strong>{peso(order.total)}</strong><span className={`status ${order.status}`}>{order.status}</span></div>{admin && <div className="order-actions"><select aria-label="Order status" value={order.status} onChange={(event) => onUpdate?.(order, { status: event.target.value as ShopOrder["status"] })}><option value="pending">Pending</option><option value="ready">Ready</option><option value="completed">Completed</option><option value="cancelled">Cancelled</option></select></div>}</article>)}</div>;
}
