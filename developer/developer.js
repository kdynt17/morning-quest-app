import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import {
  getAuth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import {
  get,
  getDatabase,
  onValue,
  ref,
  remove,
  serverTimestamp,
  update,
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-database.js";

import { firebaseConfig } from "../firebase-config.js";
import { GAMES, closesAt, dayKey } from "../functions/domain.mjs";

const ADMIN_LOGIN = "admin@admin";
const ADMIN_AUTH_EMAIL = "admin@admin.com";

const $ = (selector) => document.querySelector(selector);

const loginScreen = $("#dev-login-screen");
const shell = $("#dev-shell");
const loginForm = $("#dev-login-form");
const loginMessage = $("#dev-login-message");
const pendingList = $("#pending-list");
const userList = $("#user-list");
const searchInput = $("#dev-search");
const statusFilter = $("#dev-status-filter");
const devMessage = $("#dev-message");

const statusLabels = { pending: "승인 대기", approved: "승인", rejected: "거절" };

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getDatabase(app);

let currentUser = null;
let users = [];
let unsubscribeUsers = null;

loginForm.addEventListener("submit", handleLogin);
$("#dev-logout-button").addEventListener("click", () => signOut(auth));
searchInput.addEventListener("input", renderUsers);
statusFilter.addEventListener("change", renderUsers);
document.addEventListener("click", handleActionClick);

onAuthStateChanged(auth, async (user) => {
  unsubscribeUsers?.();
  unsubscribeUsers = null;
  currentUser = user;

  if (!user) {
    showLogin();
    return;
  }

  let profile = null;
  try {
    const snapshot = await get(ref(db, `users/${user.uid}`));
    profile = snapshot.exists() ? snapshot.val() : null;
  } catch (error) {
    profile = null;
  }

  if (!isTeacher(profile, user)) {
    await signOut(auth);
    setMessage(loginMessage, "선생님 계정만 들어올 수 있습니다.");
    return;
  }

  showShell();
  subscribeUsers();
});

async function handleLogin(event) {
  event.preventDefault();
  setMessage(loginMessage, "로그인하는 중입니다.");
  const rawLogin = $("#dev-login-email").value.trim();
  const email = rawLogin === ADMIN_LOGIN ? ADMIN_AUTH_EMAIL : rawLogin;

  try {
    await signInWithEmailAndPassword(auth, email, $("#dev-login-password").value);
  } catch (error) {
    setMessage(loginMessage, error.code === "auth/invalid-credential" ? "아이디 또는 비밀번호를 확인해주세요." : "로그인하지 못했습니다.");
  }
}

function subscribeUsers() {
  unsubscribeUsers = onValue(
    ref(db, "users"),
    (snapshot) => {
      users = [];
      snapshot.forEach((child) => {
        users.push({ id: child.key, ...child.val() });
      });
      users.sort((a, b) => getTimestampValue(b.createdAt) - getTimestampValue(a.createdAt));
      renderStats();
      renderPending();
      renderUsers();
    },
    () => setMessage(devMessage, "가입자 목록을 읽지 못했습니다. 데이터베이스 규칙을 확인해주세요."),
  );
}

function renderStats() {
  const students = users.filter((user) => user.role !== "teacher");
  $("#stat-total").textContent = students.length;
  $("#stat-pending").textContent = students.filter((user) => getStatus(user) === "pending").length;
  $("#stat-approved").textContent = students.filter((user) => getStatus(user) === "approved").length;
  $("#stat-rejected").textContent = students.filter((user) => getStatus(user) === "rejected").length;
}

function renderPending() {
  const pending = users.filter((user) => user.role !== "teacher" && getStatus(user) === "pending");
  pendingList.innerHTML = pending.length
    ? pending.map(renderUserItem).join("")
    : `<p class="empty">승인을 기다리는 학생이 없습니다.</p>`;
}

function renderUsers() {
  const keyword = searchInput.value.trim().toLowerCase();
  const status = statusFilter.value;

  const filtered = users.filter((user) => {
    if (status !== "all" && (user.role === "teacher" || getStatus(user) !== status)) return false;
    if (!keyword) return true;
    return [user.name, user.email, user.authEmail].some((value) => String(value ?? "").toLowerCase().includes(keyword));
  });

  userList.innerHTML = filtered.length
    ? filtered.map(renderUserItem).join("")
    : `<p class="empty">조건에 맞는 가입자가 없습니다.</p>`;
}

function renderUserItem(user) {
  const teacher = user.role === "teacher";
  const status = getStatus(user);
  const badge = teacher
    ? `<span class="status-badge status-teacher">선생님</span>`
    : `<span class="status-badge status-${status}">${statusLabels[status]}</span>`;
  const meta = [
    user.email ?? user.authEmail ?? "-",
    `가입 ${formatDateTime(user.createdAt)}`,
  ].filter(Boolean).join(" · ");

  return `
    <article class="dev-user">
      <div class="dev-user-info">
        <p class="dev-user-name">${escapeHtml(user.name ?? "이름 없음")}${badge}</p>
        <p class="dev-user-meta">${escapeHtml(meta)}</p>
      </div>
      ${teacher ? "" : `<div class="dev-user-actions">${renderActions(user.id, status)}</div>`}
    </article>
  `;
}

function renderActions(uid, status) {
  const id = escapeHtml(uid);
  if (status === "pending") {
    return `
      <button class="approve-button" type="button" data-action="approve" data-uid="${id}">승인</button>
      <button class="reject-button" type="button" data-action="reject" data-uid="${id}">거절</button>
    `;
  }
  if (status === "approved") {
    return `<button class="reject-button" type="button" data-action="reject" data-uid="${id}">승인 취소</button>`;
  }
  return `<button class="neutral-button" type="button" data-action="approve" data-uid="${id}">다시 승인</button>`;
}

async function handleActionClick(event) {
  const button = event.target.closest("[data-action]");
  if (!button) return;

  const user = users.find((item) => item.id === button.dataset.uid);
  if (!user) return;

  const name = user.name ?? user.email ?? "학생";
  if (button.dataset.action === "reject" && !confirm(`${name} 학생을 ${getStatus(user) === "approved" ? "승인 취소" : "거절"}할까요? 학생은 앱을 이용할 수 없게 됩니다.`)) {
    return;
  }

  button.disabled = true;
  try {
    if (button.dataset.action === "approve") {
      await setStatus(user, "approved");
      setMessage(devMessage, `${name} 학생을 승인했습니다.`);
    } else {
      await setStatus(user, "rejected");
      setMessage(devMessage, `${name} 학생의 이용을 막았습니다.`);
    }
  } catch (error) {
    button.disabled = false;
    setMessage(devMessage, "상태를 바꾸지 못했습니다. 데이터베이스 규칙을 최신 버전으로 게시했는지 확인해주세요.");
  }
}

async function setStatus(user, status) {
  await update(ref(db, `users/${user.id}`), {
    status,
    statusUpdatedAt: serverTimestamp(),
    statusUpdatedBy: currentUser.uid,
  });

  // 승인 취소·거절하면 포인트 순위에서 뺀다. 승인되면 학생이 접속할 때 다시 올라간다.
  if (status === "approved") return;
  // 거절·승인 취소한 학생은 포인트 순위, 오늘 두뇌 체조 순위, 게임별 최고 기록에서 뺀다.
  const today = closesAt(dayKey(Date.now()));
  await Promise.all([
    remove(ref(db, `pointLeaderboard/${user.id}`)),
    remove(ref(db, `brain/daily/${today}/${user.id}`)),
    ...GAMES.map((game) => remove(ref(db, `brain/best/${game.id}/${user.id}`))),
  ]);
}

// 승인 기능 도입 전 가입자는 status가 없으므로 승인된 것으로 본다.
function getStatus(user) {
  return user.status ?? "approved";
}

function isTeacher(profile, user) {
  return profile?.role === "teacher" || user?.email === ADMIN_AUTH_EMAIL;
}

function showLogin() {
  loginScreen.hidden = false;
  shell.hidden = true;
}

function showShell() {
  loginScreen.hidden = true;
  shell.hidden = false;
  setMessage(loginMessage, "학생 계정으로는 들어갈 수 없습니다.");
}

function formatDateTime(timestamp) {
  if (!timestamp) return "-";
  return new Date(getTimestampValue(timestamp)).toLocaleString("ko-KR", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function getTimestampValue(timestamp) {
  return typeof timestamp === "number" ? timestamp : 0;
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
    .replaceAll("'", "&#39;");
}
