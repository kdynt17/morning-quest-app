import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import {
  createUserWithEmailAndPassword,
  getAuth,
  onAuthStateChanged,
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
  runTransaction,
  serverTimestamp,
  set,
  update,
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-database.js";

import { firebaseConfig } from "./firebase-config.js";

const ADMIN_LOGIN = "admin@admin";
const ADMIN_AUTH_EMAIL = "admin@admin.com";
const MAX_INLINE_IMAGE_BYTES = 450 * 1024;

const $ = (selector) => document.querySelector(selector);
const setupRequired = firebaseConfig.apiKey.startsWith("PASTE_");

const authScreen = $("#auth-screen");
const appShell = $("#app-shell");
const showLoginButton = $("#show-login-button");
const showSignupButton = $("#show-signup-button");
const loginPanel = $("#login-panel");
const signupPanel = $("#signup-panel");
const loginForm = $("#login-form");
const signupForm = $("#signup-form");
const logoutButton = $("#logout-button");
const authMessage = $("#auth-message");
const signupMessage = $("#signup-message");
const answerForm = $("#answer-form");
const answerInput = $("#answer");
const answerMessage = $("#answer-message");
const challengeDate = $("#challenge-date");
const challengeStatus = $("#challenge-status");
const challengeTitle = $("#challenge-title");
const challengeImage = $("#challenge-image");
const challengeDescription = $("#challenge-description");
const leaderboardList = $("#leaderboard-list");
const storeList = $("#store-list");
const pageTitle = $("#page-title");
const todayLabel = $("#today-label");
const myPoints = $("#my-points");
const profileMessage = $("#profile-message");
const profileName = $("#profile-name");
const profileEmail = $("#profile-email");
const profileRole = $("#profile-role");
const profilePoints = $("#profile-points");
const adminNavButton = $("#admin-nav-button");
const challengeForm = $("#challenge-form");
const productForm = $("#product-form");
const adminMessage = $("#admin-message");
const productDialog = $("#product-dialog");
const dialogProductImage = $("#dialog-product-image");
const dialogProductPrice = $("#dialog-product-price");
const dialogProductTitle = $("#dialog-product-title");
const dialogProductDescription = $("#dialog-product-description");
const dialogBalance = $("#dialog-balance");
const dialogAfterBalance = $("#dialog-after-balance");
const buyProductButton = $("#buy-product-button");
const purchaseMessage = $("#purchase-message");
const navButtons = document.querySelectorAll("[data-target-page]");

let auth;
let db;
let currentUser = null;
let currentProfile = null;
let currentChallengeId = null;
let selectedProduct = null;
let unsubscribers = [];

const pageNames = {
  home: "오늘의 문제",
  leaderboard: "포인트 순위",
  store: "포인트 상점",
  profile: "내 정보",
  admin: "선생님 관리",
};

if (setupRequired) {
  setMessage(authMessage, "Firebase 설정값을 firebase-config.js에 넣어주세요.");
} else {
  const app = initializeApp(firebaseConfig);
  auth = getAuth(app);
  db = getDatabase(app);

  showLoginButton.addEventListener("click", () => setAuthMode("login"));
  showSignupButton.addEventListener("click", () => setAuthMode("signup"));
  loginForm.addEventListener("submit", handleLogin);
  signupForm.addEventListener("submit", handleSignup);
  logoutButton.addEventListener("click", () => signOut(auth));
  answerForm.addEventListener("submit", handleAnswerSubmit);
  challengeForm.addEventListener("submit", handleChallengeSave);
  productForm.addEventListener("submit", handleProductSave);
  buyProductButton.addEventListener("click", handlePurchase);

  navButtons.forEach((button) => {
    button.addEventListener("click", () => showPage(button.dataset.targetPage));
  });

  $("#admin-challenge-date").value = getKoreaDateKey();
  setAuthMode("login");

  onAuthStateChanged(auth, async (user) => {
    clearSubscriptions();
    currentUser = user;
    currentProfile = null;
    selectedProduct = null;

    if (!user) {
      showSignedOut();
      return;
    }

    showSignedIn();
    currentProfile = await ensureProfile(user);
    renderProfile(user, currentProfile);
    showPage("home");
    subscribeProfile();
    subscribeChallenge();
    subscribeLeaderboard();
    subscribeStore();
  });
}

async function handleLogin(event) {
  event.preventDefault();
  setMessage(authMessage, "로그인하는 중입니다.");
  const rawLogin = $("#login-email").value.trim();
  const password = $("#login-password").value;
  const email = normalizeLoginEmail(rawLogin);

  try {
    await signInWithEmailAndPassword(auth, email, password);
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
    await set(ref(db, `users/${credential.user.uid}`), {
      name,
      email,
      authEmail: credential.user.email,
      role: "student",
      points: 0,
      todayResult: "-",
      createdAt: serverTimestamp(),
    });
    setMessage(signupMessage, "가입되었습니다.");
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
    if (!profile.name && user.displayName) updates.name = user.displayName;

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
    points: 0,
    todayResult: "-",
    createdAt: serverTimestamp(),
  };
  await set(userRef, profile);
  return profile;
}

function subscribeProfile() {
  const unsubscribe = onValue(ref(db, `users/${currentUser.uid}`), (snapshot) => {
    if (!snapshot.exists()) return;
    currentProfile = snapshot.val();
    renderProfile(currentUser, currentProfile);
  });
  unsubscribers.push(unsubscribe);
}

function renderProfile(user, profile) {
  const name = profile?.name || user.displayName || "학생";
  const teacher = isTeacher(profile, user);
  const points = Number(profile?.points ?? 0);

  myPoints.textContent = points;
  profileMessage.textContent = teacher
    ? "문제와 상점 상품을 등록할 수 있습니다."
    : `${name} 님, 오늘 문제를 확인해보세요.`;
  profileName.textContent = name;
  profileEmail.textContent = profile?.email ?? user.email;
  profileRole.textContent = teacher ? "선생님" : "학생";
  profilePoints.textContent = points;
  adminNavButton.hidden = !teacher;
}

function setAuthMode(mode) {
  const isSignup = mode === "signup";
  loginPanel.classList.toggle("active-auth-panel", !isSignup);
  signupPanel.classList.toggle("active-auth-panel", isSignup);
  showLoginButton.classList.toggle("active", !isSignup);
  showSignupButton.classList.toggle("active", isSignup);
  showLoginButton.setAttribute("aria-selected", String(!isSignup));
  showSignupButton.setAttribute("aria-selected", String(isSignup));
  setMessage(authMessage, isSignup ? "처음이면 이름, 이메일, 비밀번호를 입력하세요." : "이메일과 비밀번호로 로그인하세요.");
}

function showSignedIn() {
  document.body.classList.add("is-authenticated");
  authScreen.hidden = true;
  appShell.hidden = false;
}

function showSignedOut() {
  document.body.classList.remove("is-authenticated");
  authScreen.hidden = false;
  appShell.hidden = true;
  setAuthMode("login");
  setMessage(authMessage, "이메일과 비밀번호로 로그인하세요.");
}

function showPage(page) {
  document.querySelectorAll(".page").forEach((section) => {
    section.classList.toggle("active-page", section.dataset.page === page);
  });

  navButtons.forEach((button) => {
    button.classList.toggle("active", button.dataset.targetPage === page);
  });

  pageTitle.textContent = pageNames[page] ?? "아침 창의력 챌린지";
  todayLabel.textContent = getKoreaDateKey();
}

function subscribeChallenge() {
  const today = getKoreaDateKey();
  const challengeRef = ref(db, `dailyChallenges/${today}`);

  const unsubscribe = onValue(challengeRef, (snapshot) => {
    if (!snapshot.exists()) {
      currentChallengeId = null;
      challengeDate.textContent = today;
      challengeStatus.textContent = "아직 공개 전";
      challengeTitle.textContent = "오늘의 문제가 아직 등록되지 않았습니다.";
      challengeDescription.textContent = "선생님이 문제를 등록하면 자동으로 표시됩니다.";
      challengeImage.hidden = true;
      challengeImage.removeAttribute("src");
      answerForm.querySelector("button").disabled = true;
      return;
    }

    const challenge = snapshot.val();
    currentChallengeId = snapshot.key;
    challengeDate.textContent = today;
    challengeStatus.textContent = challenge.status === "open" ? "제출 가능" : "마감";
    challengeTitle.textContent = challenge.title;
    challengeDescription.textContent = challenge.description;
    renderImage(challengeImage, challenge.imageUrl);
    answerForm.querySelector("button").disabled = challenge.status !== "open";
  });
  unsubscribers.push(unsubscribe);
}

function subscribeLeaderboard() {
  const studentsQuery = query(ref(db, "users"), orderByChild("points"), limitToLast(30));

  const unsubscribe = onValue(studentsQuery, (snapshot) => {
    if (!snapshot.exists()) {
      leaderboardList.innerHTML = `<p class="empty-text">아직 포인트 기록이 없습니다.</p>`;
      return;
    }

    const students = [];
    snapshot.forEach((child) => {
      const student = child.val();
      if (student.role !== "teacher") students.push(student);
    });
    students.sort((a, b) => Number(b.points ?? 0) - Number(a.points ?? 0));

    leaderboardList.innerHTML = students.length
      ? students.map(renderRankItem).join("")
      : `<p class="empty-text">아직 학생 기록이 없습니다.</p>`;
  });
  unsubscribers.push(unsubscribe);
}

function renderRankItem(student, index) {
  const points = Number(student.points ?? 0);
  return `
    <article class="rank-item">
      <span class="rank-number">${index + 1}</span>
      <div>
        <p class="rank-name">${escapeHtml(student.name ?? student.email ?? "학생")}</p>
        <p class="rank-meta">${escapeHtml(student.todayResult ?? "-")}</p>
      </div>
      <span class="rank-points">${points}점</span>
    </article>
  `;
}

function subscribeStore() {
  const productsQuery = query(ref(db, "storeProducts"), orderByChild("createdAt"), limitToLast(50));

  const unsubscribe = onValue(productsQuery, (snapshot) => {
    if (!snapshot.exists()) {
      storeList.innerHTML = `<p class="empty-text">아직 상점 상품이 없습니다.</p>`;
      return;
    }

    const products = [];
    snapshot.forEach((child) => {
      const product = child.val();
      if (product.visible !== false) products.push({ id: child.key, ...product });
    });
    products.sort((a, b) => Number(b.createdAt ?? 0) - Number(a.createdAt ?? 0));

    storeList.innerHTML = products.length
      ? products.map(renderProductItem).join("")
      : `<p class="empty-text">지금 살 수 있는 상품이 없습니다.</p>`;

    storeList.querySelectorAll("button[data-product-id]").forEach((button) => {
      const product = products.find((item) => item.id === button.dataset.productId);
      button.addEventListener("click", () => openProductDialog(product));
    });
  });
  unsubscribers.push(unsubscribe);
}

function renderProductItem(product) {
  const image = product.imageUrl
    ? `<img class="product-image" src="${escapeAttribute(product.imageUrl)}" alt="" loading="lazy" />`
    : `<div class="product-placeholder">상품</div>`;

  return `
    <article class="product-card">
      ${image}
      <div class="product-body">
        <p class="eyebrow">${Number(product.price ?? 0)}점</p>
        <h3>${escapeHtml(product.title ?? "상품")}</h3>
        <p>${escapeHtml(product.description ?? "")}</p>
        <button type="button" data-product-id="${product.id}">자세히 보기</button>
      </div>
    </article>
  `;
}

function openProductDialog(product) {
  selectedProduct = product;
  const price = Number(product.price ?? 0);
  const points = Number(currentProfile?.points ?? 0);
  renderImage(dialogProductImage, product.imageUrl);
  dialogProductPrice.textContent = `${price}점`;
  dialogProductTitle.textContent = product.title ?? "상품";
  dialogProductDescription.textContent = product.description ?? "";
  dialogBalance.textContent = `현재 잔액 ${points}점`;
  dialogAfterBalance.textContent = `구매 후 잔액 ${points - price}점`;
  buyProductButton.disabled = points < price || isTeacher(currentProfile, currentUser);
  buyProductButton.textContent = points < price ? "포인트가 부족합니다" : "제품 구입";
  setMessage(purchaseMessage, "진짜 구매하시겠습니까? 버튼을 누르면 포인트가 차감됩니다.");
  productDialog.showModal();
}

async function handlePurchase() {
  if (!currentUser || !selectedProduct) return;
  if (isTeacher(currentProfile, currentUser)) {
    setMessage(purchaseMessage, "선생님 계정은 구매하지 않습니다.");
    return;
  }

  const price = Number(selectedProduct.price ?? 0);
  buyProductButton.disabled = true;

  try {
    const result = await runTransaction(ref(db, `users/${currentUser.uid}/points`), (currentPoints) => {
      const points = Number(currentPoints ?? 0);
      if (points < price) return;
      return points - price;
    });

    if (!result.committed) {
      setMessage(purchaseMessage, "포인트가 부족해서 구매하지 못했습니다.");
      return;
    }

    const remaining = Number(result.snapshot.val() ?? 0);
    await set(push(ref(db, "purchases")), {
      uid: currentUser.uid,
      productId: selectedProduct.id,
      productTitle: selectedProduct.title,
      price,
      remainingPoints: remaining,
      createdAt: serverTimestamp(),
    });
    setMessage(purchaseMessage, `구매되었습니다. 남은 잔액은 ${remaining}점입니다.`);
    dialogBalance.textContent = `현재 잔액 ${remaining}점`;
    dialogAfterBalance.textContent = `구매 후 잔액 ${remaining}점`;
  } catch (error) {
    setMessage(purchaseMessage, authErrorMessage(error.code));
    buyProductButton.disabled = false;
  }
}

async function handleAnswerSubmit(event) {
  event.preventDefault();

  if (!currentUser || !currentChallengeId) {
    setMessage(answerMessage, "로그인 후 오늘의 문제를 불러와 주세요.");
    return;
  }

  const answer = answerInput.value.trim();
  if (!answer) return;

  const submissionRef = push(ref(db, "submissions"));
  await set(submissionRef, {
    challengeId: currentChallengeId,
    uid: currentUser.uid,
    answer,
    status: "pending",
    createdAt: serverTimestamp(),
  });

  answerInput.value = "";
  setMessage(answerMessage, "제출되었습니다.");
}

async function handleChallengeSave(event) {
  event.preventDefault();
  if (!isTeacher(currentProfile, currentUser)) return;

  try {
    setMessage(adminMessage, "문제를 저장하는 중입니다.");
    const dateKey = $("#admin-challenge-date").value;
    const title = $("#admin-challenge-title").value.trim();
    const description = $("#admin-challenge-description").value.trim();
    const answer = $("#admin-answer").value.trim();
    const imageUrl = await getImageValue("#admin-challenge-image-url", "#admin-challenge-image-file");

    await update(ref(db), {
      [`dailyChallenges/${dateKey}`]: {
        title,
        description,
        imageUrl,
        status: "open",
        createdBy: currentUser.uid,
        updatedAt: serverTimestamp(),
      },
      [`challengeAnswers/${dateKey}`]: {
        answer,
        updatedAt: serverTimestamp(),
      },
    });

    challengeForm.reset();
    $("#admin-challenge-date").value = getKoreaDateKey();
    setMessage(adminMessage, "문제를 저장했습니다.");
  } catch (error) {
    setMessage(adminMessage, error.message || "문제를 저장하지 못했습니다.");
  }
}

async function handleProductSave(event) {
  event.preventDefault();
  if (!isTeacher(currentProfile, currentUser)) return;

  try {
    setMessage(adminMessage, "상품을 저장하는 중입니다.");
    const title = $("#admin-product-title").value.trim();
    const description = $("#admin-product-description").value.trim();
    const price = Number($("#admin-product-price").value);
    const imageUrl = await getImageValue("#admin-product-image-url", "#admin-product-image-file");

    await set(push(ref(db, "storeProducts")), {
      title,
      description,
      price,
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

function normalizeLoginEmail(value) {
  return value === ADMIN_LOGIN ? ADMIN_AUTH_EMAIL : value;
}

function getKoreaDateKey() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function authErrorMessage(code) {
  if (code === "auth/email-already-in-use") return "이미 가입된 이메일입니다. 로그인으로 들어가세요.";
  if (code === "auth/invalid-email") return "아이디 또는 이메일 형식을 확인해주세요.";
  if (code === "auth/invalid-credential") return "아이디 또는 비밀번호를 확인해주세요.";
  if (code === "auth/unauthorized-domain") return "Firebase Authentication 승인 도메인에 kdynt17.github.io를 추가해주세요.";
  if (code === "auth/weak-password") return "비밀번호는 6자 이상이어야 합니다.";
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
