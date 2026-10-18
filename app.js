import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import {
  browserLocalPersistence,
  browserSessionPersistence,
  createUserWithEmailAndPassword,
  indexedDBLocalPersistence,
  initializeAuth,
  onAuthStateChanged,
  sendPasswordResetEmail,
  setPersistence,
  signInWithEmailAndPassword,
  signOut,
  updateProfile,
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import {
  get,
  getDatabase,
  limitToLast,
  onValue,
  orderByChild,
  push,
  query,
  ref,
  serverTimestamp,
  set,
  update,
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-database.js";

import { firebaseConfig } from "./firebase-config.js";
import { mountBrain } from "./brain.js";
import { freeClient } from "./free-client.js";

const ADMIN_LOGIN = "admin@admin";
const ADMIN_AUTH_EMAIL = "admin@admin.com";
const MAX_INLINE_IMAGE_BYTES = 450 * 1024;
const LAST_EMAIL_KEY = "mq.lastEmail";
const LAST_NAME_KEY = "mq.lastName";

const $ = (selector) => document.querySelector(selector);
const setupRequired = firebaseConfig.apiKey.startsWith("PASTE_");

const splashScreen = $("#splash-screen");
const authScreen = $("#auth-screen");
const pendingScreen = $("#pending-screen");
const appShell = $("#app-shell");
const showLoginButton = $("#show-login-button");
const showSignupButton = $("#show-signup-button");
const loginPanel = $("#login-panel");
const signupPanel = $("#signup-panel");
const loginForm = $("#login-form");
const signupForm = $("#signup-form");
const authMessage = $("#auth-message");
const signupMessage = $("#signup-message");
const leaderboardList = $("#leaderboard-list");
const storeList = $("#store-list");
const pageTitle = $("#page-title");
const todayLabel = $("#today-label");
const adminNavButton = $("#admin-nav-button");
const productForm = $("#product-form");
const adminMessage = $("#admin-message");
const productDialog = $("#product-dialog");
const buyProductButton = $("#buy-product-button");
const purchaseMessage = $("#purchase-message");
const navButtons = document.querySelectorAll("[data-target-page]");

let auth;
let db;
let currentUser = null;
let currentProfile = null;
let walletPoints = null;
let selectedProduct = null;
let unsubscribers = [];
let disposeBrain;
let purchaseRequestId;
let purchaseClient = null;

const pageNames = {
  home: "아침 두뇌 체조",
  leaderboard: "순위",
  store: "포인트 상점",
  profile: "내 정보",
  admin: "선생님 관리",
};

if (setupRequired) {
  showSignedOut();
  setMessage(authMessage, "Firebase 설정값을 firebase-config.js에 넣어주세요.");
} else {
  const app = initializeApp(firebaseConfig);
  // 로그인 정보를 IndexedDB(안 되면 localStorage)에 저장해 다음에 열면 바로 들어가진다.
  auth = initializeAuth(app, { persistence: [indexedDBLocalPersistence, browserLocalPersistence] });
  db = getDatabase(app);
  showSplash();

  showLoginButton.addEventListener("click", () => setAuthMode("login"));
  showSignupButton.addEventListener("click", () => setAuthMode("signup"));
  loginForm.addEventListener("submit", handleLogin);
  signupForm.addEventListener("submit", handleSignup);
  $("#forgot-password-button").addEventListener("click", handlePasswordReset);
  $("#logout-button").addEventListener("click", () => {
    storeLocal(LAST_NAME_KEY, null);
    signOut(auth);
  });
  $("#pending-logout-button").addEventListener("click", () => signOut(auth));
  productForm.addEventListener("submit", handleProductSave);
  buyProductButton.addEventListener("click", handlePurchase);
  navButtons.forEach((button) => {
    button.addEventListener("click", () => showPage(button.dataset.targetPage));
  });
  setAuthMode("login");

  onAuthStateChanged(auth, async (user) => {
    clearSubscriptions();
    disposeBrain?.();
    disposeBrain = null;
    purchaseClient?.stop();
    purchaseClient = null;
    currentUser = user;
    currentProfile = null;
    walletPoints = null;
    selectedProduct = null;

    if (!user) {
      showSignedOut();
      return;
    }

    try {
      currentProfile = await ensureProfile(user);
    } catch (error) {
      showSignedOut();
      setMessage(authMessage, authErrorMessage(error.code));
      return;
    }
    if (currentUser?.uid !== user.uid) return;
    if (!isApproved(currentProfile, user)) {
      waitForApproval();
      return;
    }
    enterApp();
  });
}

function enterApp() {
  showSignedIn();
  renderProfile(currentUser, currentProfile);
  showPage("home");
  subscribeProfile();
  subscribeLeaderboard();
  subscribeStore();
  disposeBrain = mountBrain({ db, user: currentUser, root: $("#brain-root") });
}

function waitForApproval() {
  showPending(currentProfile);
  unsubscribers.push(onValue(ref(db, `users/${currentUser.uid}`), (snapshot) => {
    if (!snapshot.exists()) {
      // 선생님이 계정 정보를 지운 경우: 대기 화면에 갇히지 않도록 로그아웃한다.
      signOut(auth);
      return;
    }
    currentProfile = snapshot.val();
    if (!isApproved(currentProfile, currentUser)) {
      showPending(currentProfile);
      return;
    }
    clearSubscriptions();
    enterApp();
  }));
}

// ── 로그인 ──────────────────────────────────────────────────

async function handleLogin(event) {
  event.preventDefault();
  setMessage(authMessage, "로그인하는 중입니다.");
  const rawLogin = $("#login-email").value.trim();
  const password = $("#login-password").value;
  const remember = $("#remember-me").checked;

  try {
    if (remember) {
      // IndexedDB를 못 쓰는 브라우저(일부 앱 내 브라우저)는 localStorage로 저장한다.
      await setPersistence(auth, indexedDBLocalPersistence).catch(() => setPersistence(auth, browserLocalPersistence));
    } else {
      await setPersistence(auth, browserSessionPersistence);
    }
    await signInWithEmailAndPassword(auth, normalizeLoginEmail(rawLogin), password);
    storeLocal(LAST_EMAIL_KEY, remember ? rawLogin : null);
    if (!remember) storeLocal(LAST_NAME_KEY, null);
  } catch (error) {
    setMessage(authMessage, authErrorMessage(error.code));
  }
}

async function handlePasswordReset() {
  const email = $("#login-email").value.trim();
  if (!email) {
    setMessage(authMessage, "위 이메일 칸에 가입한 이메일을 먼저 입력하세요.");
    $("#login-email").focus();
    return;
  }
  if (normalizeLoginEmail(email) === ADMIN_AUTH_EMAIL) {
    setMessage(authMessage, "관리자 계정은 Firebase 콘솔에서 비밀번호를 바꿔주세요.");
    return;
  }
  try {
    setMessage(authMessage, "재설정 메일을 보내는 중입니다.");
    auth.languageCode = "ko";
    await sendPasswordResetEmail(auth, email);
    setMessage(authMessage, `${email}로 비밀번호 재설정 메일을 보냈어요. 메일함(스팸함 포함)에서 링크를 눌러 새 비밀번호를 정하세요.`);
  } catch (error) {
    setMessage(authMessage, authErrorMessage(error.code));
  }
}

async function handleSignup(event) {
  event.preventDefault();
  const name = $("#signup-name").value.trim();
  const email = $("#signup-email").value.trim();
  const password = $("#signup-password").value;

  try {
    setMessage(signupMessage, "가입하는 중입니다.");
    const credential = await createUserWithEmailAndPassword(auth, email, password);
    await updateProfile(credential.user, { displayName: name });
    await ensureProfile(credential.user);
    await update(ref(db, `users/${credential.user.uid}`), { name });
    setMessage(signupMessage, "가입 신청이 완료되었습니다. 선생님 승인을 기다려 주세요.");
  } catch (error) {
    setMessage(signupMessage, authErrorMessage(error.code));
  }
}

async function ensureProfile(user) {
  const userRef = ref(db, `users/${user.uid}`);
  const snapshot = await get(userRef);
  const isAdmin = user.email === ADMIN_AUTH_EMAIL;

  if (snapshot.exists()) {
    const profile = snapshot.val();
    const updates = {};
    if (isAdmin && profile.role !== "teacher") {
      updates.role = "teacher";
      updates.name = "선생님";
      updates.email = ADMIN_LOGIN;
      updates.authEmail = ADMIN_AUTH_EMAIL;
    }
    if (Object.keys(updates).length) {
      await update(userRef, updates);
      return { ...profile, ...updates };
    }
    return profile;
  }

  const profile = {
    name: isAdmin ? "선생님" : user.displayName || "학생",
    email: isAdmin ? ADMIN_LOGIN : user.email,
    authEmail: user.email,
    role: isAdmin ? "teacher" : "student",
    ...(isAdmin ? {} : { status: "pending" }),
    points: 0,
    todayResult: "-",
    createdAt: serverTimestamp(),
  };
  try {
    await set(userRef, profile);
  } catch (error) {
    // 가입 처리와 로그인 감지가 동시에 프로필을 만들 수 있다.
    const existing = await get(userRef);
    if (existing.exists()) return existing.val();
    throw error;
  }
  return profile;
}

function subscribeProfile() {
  unsubscribers.push(onValue(ref(db, `wallets/${currentUser.uid}/points`), (s) => {
    walletPoints = s.val();
    if (currentProfile) renderProfile(currentUser, currentProfile);
  }));
  unsubscribers.push(onValue(ref(db, `users/${currentUser.uid}`), (snapshot) => {
    if (!snapshot.exists()) return;
    currentProfile = snapshot.val();
    if (!isApproved(currentProfile, currentUser)) {
      clearSubscriptions();
      disposeBrain?.();
      disposeBrain = null;
      purchaseClient?.stop();
      purchaseClient = null;
      if (productDialog.open) productDialog.close();
      waitForApproval();
      return;
    }
    renderProfile(currentUser, currentProfile);
  }));
}

function renderProfile(user, profile) {
  const name = profile?.name || user.displayName || "학생";
  const teacher = isTeacher(profile, user);
  const points = Number(walletPoints ?? profile?.points ?? 0);
  $("#my-points").textContent = points.toLocaleString("ko-KR");
  $("#profile-points").textContent = points.toLocaleString("ko-KR");
  $("#profile-name").textContent = name;
  $("#profile-email").textContent = profile?.email ?? user.email;
  $("#profile-role").textContent = teacher ? "선생님" : "학생";
  $("#profile-message").textContent = teacher ? "선생님 계정은 게임 기록과 포인트가 저장되지 않아요." : "";
  adminNavButton.hidden = !teacher;
  // 로그인 상태 유지를 켠 기기에서만 로딩 화면에 이름을 기억해 보여준다.
  if (readLocal(LAST_EMAIL_KEY)) storeLocal(LAST_NAME_KEY, name);
}

// ── 화면 전환 ───────────────────────────────────────────────

function setAuthMode(mode) {
  const isSignup = mode === "signup";
  loginPanel.classList.toggle("active-auth-panel", !isSignup);
  signupPanel.classList.toggle("active-auth-panel", isSignup);
  showLoginButton.classList.toggle("active", !isSignup);
  showSignupButton.classList.toggle("active", isSignup);
  showLoginButton.setAttribute("aria-selected", String(!isSignup));
  showSignupButton.setAttribute("aria-selected", String(isSignup));
  setMessage(authMessage, isSignup ? "이름, 이메일, 비밀번호를 입력하세요." : "이메일과 비밀번호로 로그인하세요.");
}

function showSplash() {
  const lastName = readLocal(LAST_NAME_KEY);
  $("#splash-text").textContent = lastName ? `${lastName} 님, 두뇌 깨우는 중…` : "두뇌 깨우는 중…";
  splashScreen.hidden = false;
}

function showScreen(screen) {
  splashScreen.hidden = true;
  authScreen.hidden = screen !== "auth";
  pendingScreen.hidden = screen !== "pending";
  appShell.hidden = screen !== "app";
  document.body.classList.toggle("is-authenticated", screen === "app");
}

function showSignedIn() {
  showScreen("app");
}

function showSignedOut() {
  showScreen("auth");
  setAuthMode("login");
  const lastEmail = readLocal(LAST_EMAIL_KEY);
  if (lastEmail && !$("#login-email").value) {
    $("#login-email").value = lastEmail;
    $("#login-password").focus({ preventScroll: true });
  }
}

function showPending(profile) {
  showScreen("pending");
  $("#pending-message").textContent = profile?.status === "rejected"
    ? "가입이 승인되지 않았어요. 선생님께 확인해 주세요."
    : `${profile?.name ?? "학생"} 님, 가입 신청이 접수됐어요! 선생님이 승인하면 바로 시작돼요.`;
}

function showPage(page) {
  document.querySelectorAll(".page").forEach((section) => {
    section.classList.toggle("active-page", section.dataset.page === page);
  });
  document.querySelectorAll(".bottom-nav [data-target-page]").forEach((button) => {
    button.classList.toggle("active", button.dataset.targetPage === page);
  });
  pageTitle.textContent = pageNames[page] ?? "아침 두뇌 체조";
  todayLabel.textContent = new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", month: "long", day: "numeric", weekday: "short" }).format(new Date());
  window.scrollTo({ top: 0 });
}

// ── 포인트 순위 (전체 공개) ─────────────────────────────────

function subscribeLeaderboard() {
  unsubscribers.push(onValue(ref(db, "pointLeaderboard"), (snapshot) => {
    const students = [];
    snapshot.forEach((child) => {
      students.push({ uid: child.key, ...child.val() });
    });
    students.sort((a, b) => Number(b.points ?? 0) - Number(a.points ?? 0));
    leaderboardList.innerHTML = students.length
      ? students.map((student, index) => `
          <li class="rank-row ${student.uid === currentUser?.uid ? "is-me" : ""}">
            <span class="rank-medal">${["🥇", "🥈", "🥉"][index] ?? `${index + 1}위`}</span>
            <span class="rank-name">${escapeHtml(student.name ?? "학생")}${student.uid === currentUser?.uid ? " <em>나</em>" : ""}</span>
            <b>${Number(student.points ?? 0).toLocaleString("ko-KR")}P</b>
          </li>`).join("")
      : `<li class="empty">아직 포인트 기록이 없어요.</li>`;
  }));
}

// ── 상점 ────────────────────────────────────────────────────

function subscribeStore() {
  const productsQuery = query(ref(db, "storeProducts"), orderByChild("createdAt"), limitToLast(50));
  unsubscribers.push(onValue(productsQuery, (snapshot) => {
    const products = [];
    snapshot.forEach((child) => {
      const product = child.val();
      if (product.visible !== false) products.push({ id: child.key, ...product });
    });
    products.sort((a, b) => Number(b.createdAt ?? 0) - Number(a.createdAt ?? 0));
    storeList.innerHTML = products.length
      ? products.map(renderProductItem).join("")
      : `<p class="empty">지금 살 수 있는 상품이 없어요.</p>`;
    storeList.querySelectorAll("button[data-product-id]").forEach((button) => {
      const product = products.find((item) => item.id === button.dataset.productId);
      button.addEventListener("click", () => openProductDialog(product));
    });
  }));
}

function renderProductItem(product) {
  const image = product.imageUrl
    ? `<img class="product-image" src="${escapeAttribute(product.imageUrl)}" alt="" loading="lazy" />`
    : `<div class="product-image product-placeholder"><img src="assets/animal-pig.webp" alt="" width="72" height="72" /></div>`;
  return `
    <article class="product-card">
      ${image}
      <div class="product-body">
        <span class="price-tag">${Number(product.price ?? 0).toLocaleString("ko-KR")}P</span>
        <h3>${escapeHtml(product.title ?? "상품")}</h3>
        <p>${escapeHtml(product.description ?? "")}</p>
        <button class="btn btn-go btn-small" type="button" data-product-id="${escapeAttribute(product.id)}">자세히 보기</button>
      </div>
    </article>`;
}

function openProductDialog(product) {
  purchaseRequestId = crypto.randomUUID();
  selectedProduct = product;
  const price = Number(product.price ?? 0);
  const points = Number(walletPoints ?? currentProfile?.points ?? 0);
  renderImage($("#dialog-product-image"), product.imageUrl);
  $("#dialog-product-price").textContent = `${price.toLocaleString("ko-KR")}P`;
  $("#dialog-product-title").textContent = product.title ?? "상품";
  $("#dialog-product-description").textContent = product.description ?? "";
  $("#dialog-balance").textContent = `현재 잔액 ${points.toLocaleString("ko-KR")}P`;
  $("#dialog-after-balance").textContent = `구매 후 잔액 ${(points - price).toLocaleString("ko-KR")}P`;
  buyProductButton.disabled = points < price || isTeacher(currentProfile, currentUser);
  buyProductButton.textContent = points < price ? `${(price - points).toLocaleString("ko-KR")}P 더 모아야 해요` : "구매하기";
  setMessage(purchaseMessage, "버튼을 누르면 바로 포인트가 차감돼요.");
  productDialog.showModal();
}

// 구매는 지갑 규칙(wallets)으로 검증되는 무료 클라이언트를 통해 처리한다.
async function handlePurchase() {
  if (!currentUser || !selectedProduct) return;
  if (isTeacher(currentProfile, currentUser)) {
    setMessage(purchaseMessage, "선생님 계정은 구매하지 않습니다.");
    return;
  }
  buyProductButton.disabled = true;
  try {
    purchaseClient ??= freeClient(db, currentUser);
    const result = await purchaseClient.action({ action: "purchase", productId: selectedProduct.id, requestId: purchaseRequestId });
    const remaining = Number(result.data.points ?? 0);
    setMessage(purchaseMessage, `구매했어요! 남은 잔액은 ${remaining.toLocaleString("ko-KR")}P예요. 선생님께 이 화면을 보여주세요.`);
    $("#dialog-balance").textContent = `현재 잔액 ${remaining.toLocaleString("ko-KR")}P`;
    $("#dialog-after-balance").textContent = `구매 후 잔액 ${remaining.toLocaleString("ko-KR")}P`;
  } catch (error) {
    setMessage(purchaseMessage, error.message || authErrorMessage(error.code));
    buyProductButton.disabled = false;
  }
}

// ── 선생님 ──────────────────────────────────────────────────

async function handleProductSave(event) {
  event.preventDefault();
  if (!isTeacher(currentProfile, currentUser)) return;
  try {
    setMessage(adminMessage, "상품을 저장하는 중입니다.");
    const imageUrl = await getImageValue("#admin-product-image-url", "#admin-product-image-file");
    await set(push(ref(db, "storeProducts")), {
      title: $("#admin-product-title").value.trim(),
      description: $("#admin-product-description").value.trim(),
      price: Number($("#admin-product-price").value),
      imageUrl,
      visible: true,
      createdBy: currentUser.uid,
      createdAt: serverTimestamp(),
    });
    productForm.reset();
    $("#admin-product-price").value = 10;
    setMessage(adminMessage, "상점 상품을 저장했습니다.");
  } catch (error) {
    setMessage(adminMessage, error.message || "상품을 저장하지 못했습니다.");
  }
}

async function getImageValue(urlSelector, fileSelector) {
  const url = $(urlSelector).value.trim();
  const file = $(fileSelector).files?.[0];
  if (file) return readSmallImage(file);
  return url;
}

function readSmallImage(file) {
  if (file.size > MAX_INLINE_IMAGE_BYTES) {
    throw new Error("사진 파일이 너무 큽니다. 450KB 이하 사진이나 사진 주소를 사용해주세요.");
  }
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => resolve(reader.result));
    reader.addEventListener("error", () => reject(new Error("사진을 읽지 못했습니다.")));
    reader.readAsDataURL(file);
  });
}

// ── 공통 ────────────────────────────────────────────────────

function renderImage(imageElement, imageUrl) {
  if (!imageUrl) {
    imageElement.hidden = true;
    imageElement.removeAttribute("src");
    return;
  }
  imageElement.src = imageUrl;
  imageElement.hidden = false;
}

function isTeacher(profile, user) {
  return profile?.role === "teacher" || user?.email === ADMIN_AUTH_EMAIL;
}

// 승인 기능 이전에 가입한 학생은 status가 없으므로 승인된 것으로 본다.
function isApproved(profile, user) {
  if (isTeacher(profile, user)) return true;
  return !profile?.status || profile.status === "approved";
}

function normalizeLoginEmail(value) {
  return value === ADMIN_LOGIN ? ADMIN_AUTH_EMAIL : value;
}

function readLocal(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function storeLocal(key, value) {
  try {
    if (value === null || value === undefined) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // 시크릿 창 등 저장소를 못 쓰면 기억하지 않는다.
  }
}

function authErrorMessage(code) {
  if (code === "auth/email-already-in-use") return "이미 가입된 이메일입니다. 로그인으로 들어가세요.";
  if (code === "auth/invalid-email") return "아이디 또는 이메일 형식을 확인해주세요.";
  if (code === "auth/invalid-credential") return "아이디 또는 비밀번호를 확인해주세요.";
  if (code === "auth/unauthorized-domain") return "Firebase Authentication 승인 도메인에 kdynt17.github.io를 추가해주세요.";
  if (code === "auth/weak-password") return "비밀번호는 6자 이상이어야 합니다.";
  if (code === "auth/missing-email") return "가입한 이메일을 입력해주세요.";
  if (code === "auth/too-many-requests") return "잠시 후 다시 시도해주세요.";
  if (code === "PERMISSION_DENIED") return "데이터베이스 규칙을 최신 버전으로 게시해주세요.";
  return "처리 중 문제가 생겼습니다.";
}

function clearSubscriptions() {
  unsubscribers.forEach((unsubscribe) => unsubscribe());
  unsubscribers = [];
}

function setMessage(element, message) {
  element.textContent = message;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeAttribute(value) {
  return escapeHtml(value).replaceAll("`", "&#096;");
}
