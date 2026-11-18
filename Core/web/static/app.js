// Khung trang + định tuyến theo URL thật (History API). Mọi trạng thái nằm trong URL:
// tải lại, mở tab mới, gửi link đều ra đúng màn hình đó.

import { api, esc, store } from "./lib.js";
import overview from "./pages/overview.js";
import dataset from "./pages/dataset.js";
import item from "./pages/item.js";
import tryPage from "./pages/try.js";
import evalPage from "./pages/eval.js";
import algorithms from "./pages/algorithms.js";
import videoPage from "./pages/video.js";

const ROUTES = [
  [/^\/$/, overview],
  [/^\/d\/([^/]+)\/?$/, dataset],
  [/^\/d\/([^/]+)\/i\/(.+)$/, item],
  [/^\/try(?:\/([^/]+))?\/?$/, tryPage],
  [/^\/eval\/?$/, evalPage],
  [/^\/algorithms\/?$/, algorithms],
  [/^\/video\/?$/, videoPage],
];

const main = document.getElementById("main");
const nav = document.getElementById("nav");
let meta = null;
let cleanup = null;
let navId = 0;
history.scrollRestoration = "manual";

async function loadMeta(force = false) {
  if (!meta || force) meta = await api("/api/meta");
  return meta;
}

function renderNav() {
  const path = location.pathname;
  const on = (test) => (test ? ' class="on"' : "");
  const ds = (meta?.datasets || []).map((d) => {
    const last = store(`ds:${d.name}`) || "";
    return `<a href="/d/${encodeURIComponent(d.name)}${esc(last)}"${on(path.startsWith(`/d/${d.name}`))}>${esc(d.name)} <small>${d.images.toLocaleString("vi-VN")}</small></a>`;
  });
  nav.innerHTML = [
    `<a href="/"${on(path === "/")}>Tổng quan</a>`,
    `<span class="sep"></span>`,
    ...ds,
    `<span class="sep"></span>`,
    `<a href="/try"${on(path.startsWith("/try"))}>Thử ảnh</a>`,
    `<a href="/eval"${on(path.startsWith("/eval"))}>Chạy đánh giá</a>`,
    `<a href="/algorithms"${on(path.startsWith("/algorithms"))}>Thuật toán</a>`,
    `<a href="/video"${on(path.startsWith("/video"))}>Luồng video</a>`,
  ].join("");
}

export function navigate(url, { replace = false } = {}) {
  const next = new URL(url, location.href);
  const samePath = next.pathname === location.pathname;
  history[replace ? "replaceState" : "pushState"](null, "", next.pathname + next.search + next.hash);
  route({ keepScroll: samePath && !next.hash });
}

async function route({ keepScroll = false } = {}) {
  const id = ++navId;
  if (cleanup) { try { cleanup(); } catch {} cleanup = null; }
  const path = location.pathname;
  let page = null, params = [];
  for (const [re, fn] of ROUTES) {
    const m = path.match(re);
    if (m) { page = fn; params = m.slice(1).map((p) => p && decodeURIComponent(p)); break; }
  }
  if (!main.firstChild) main.innerHTML = `<div class="loading">Đang tải…</div>`;
  try {
    await loadMeta();
  } catch (e) {
    main.innerHTML = `<div class="alert">Không kết nối được server: ${esc(e.message)}</div>`;
    return;
  }
  renderNav();
  const ctx = {
    params,
    q: new URLSearchParams(location.search),
    meta,
    stale: () => id !== navId,
    navigate,
    refreshMeta: async () => { await loadMeta(true); ctx.meta = meta; renderNav(); return meta; },
    setNavActive: renderNav,
  };
  if (!page) {
    main.innerHTML = `<div class="empty">Không có trang này. <a href="/" style="color:var(--accent)">Về tổng quan</a></div>`;
    return;
  }
  try {
    const c = await page(main, ctx);
    if (ctx.stale()) { c?.(); return; }
    cleanup = c || null;
    if (location.hash) document.getElementById(location.hash.slice(1))?.scrollIntoView();
    else if (!keepScroll) scrollTo(0, 0);
    renderNav();
  } catch (e) {
    if (!ctx.stale()) main.innerHTML = `<div class="alert">${esc(e.message)}</div>`;
    console.error(e);
  }
}

// Link nội bộ: chuyển trang không tải lại. Ctrl/Cmd/giữa chuột vẫn mở tab mới như link bình thường.
document.addEventListener("click", (e) => {
  const a = e.target.closest("a[href]");
  if (!a || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  if (a.target || a.hasAttribute("download")) return;
  const u = new URL(a.href, location.href);
  if (u.origin !== location.origin || u.pathname.startsWith("/api/") || u.pathname.startsWith("/static/")) return;
  e.preventDefault();
  navigate(u.pathname + u.search + u.hash);
});
// Hàng trong bảng có data-href: bấm như link.
document.addEventListener("click", (e) => {
  const tr = e.target.closest("[data-href]");
  if (!tr || e.target.closest("a, input, button, select, label")) return;
  if (e.ctrlKey || e.metaKey || e.button === 1) window.open(tr.dataset.href, "_blank");
  else navigate(tr.dataset.href);
});
window.addEventListener("popstate", () => route({ keepScroll: false }));

document.getElementById("theme").addEventListener("click", () => {
  const root = document.documentElement;
  const dark = root.dataset.theme ? root.dataset.theme === "dark" : matchMedia("(prefers-color-scheme: dark)").matches;
  root.dataset.theme = dark ? "light" : "dark";
  try { localStorage.setItem("theme", root.dataset.theme); } catch {}
});

route();
