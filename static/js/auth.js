(function () {
  "use strict";

  let redirecting = false;

  async function request(url, options = {}) {
    if (!window.VocabFlowApi) throw new Error("VocabFlow API client is not loaded");
    return window.VocabFlowApi.request(url, options, { redirectOnUnauthorized: false });
  }

  async function ensureCsrfToken() {
    if (!window.VocabFlowApi) throw new Error("VocabFlow API client is not loaded");
    return window.VocabFlowApi.ensureCsrfToken();
  }

  function setMigrateFlag(value) {
    try {
      if (value) sessionStorage.setItem("vocabflow_migrate_legacy", "1");
      else sessionStorage.removeItem("vocabflow_migrate_legacy");
    } catch (_) {}
  }

  async function login(username, password) {
    const body = await request("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ username, password })
    });
    setMigrateFlag(false);
    window.__VOCABFLOW_USER__ = body.user;
    if (body.csrfToken) window.VocabFlowApi?.setCsrfToken(body.csrfToken);
    return body;
  }

  async function register(payload) {
    const body = await request("/api/auth/register", {
      method: "POST",
      body: JSON.stringify(payload || {})
    });
    setMigrateFlag(Boolean(body.migrateLegacy));
    window.__VOCABFLOW_USER__ = body.user;
    if (body.csrfToken) window.VocabFlowApi?.setCsrfToken(body.csrfToken);
    return body;
  }

  async function logout() {
    await request("/api/auth/logout", { method: "POST" });
    if (typeof clearCurrentUserStorage === "function") clearCurrentUserStorage();
    setMigrateFlag(false);
    window.__VOCABFLOW_USER__ = null;
    window.VocabFlowApi?.invalidateCsrfToken();
    window.location.href = "/login";
  }

  async function me() {
    const body = await request("/api/auth/me");
    window.__VOCABFLOW_USER__ = body.authenticated ? body.user : null;
    return body;
  }

  function handleUnauthorized() {
    if (redirecting) return;
    if (window.location.pathname.endsWith("/login") || window.location.pathname === "/login") return;
    redirecting = true;
    window.location.href = "/login";
  }

  function renderUserPanel() {
    const user = window.__VOCABFLOW_USER__;
    const trigger = document.getElementById("accountTrigger");
    const menu = document.getElementById("accountMenu");
    if (!trigger || !menu || !user) return;

    const name = user.fullName || user.username || "Account";
    const initial = String(name).trim().slice(0, 1).toUpperCase() || "V";
    const nameLabel = document.getElementById("accountTriggerName");
    const initialLabel = document.getElementById("accountTriggerInitial");
    const menuName = document.getElementById("accountMenuName");
    const menuEmail = document.getElementById("accountMenuEmail");
    if (nameLabel) nameLabel.textContent = name;
    if (initialLabel) initialLabel.textContent = initial;
    if (menuName) menuName.textContent = name;
    if (menuEmail) menuEmail.textContent = user.email || `@${user.username || "user"}`;

    if (!trigger.dataset.bound) {
      trigger.dataset.bound = "1";
      trigger.addEventListener("click", () => {
        const open = !menu.hidden;
        menu.hidden = open;
        trigger.setAttribute("aria-expanded", open ? "false" : "true");
      });
      document.addEventListener("click", event => {
        if (!event.target.closest(".account-menu-wrap")) {
          menu.hidden = true;
          trigger.setAttribute("aria-expanded", "false");
        }
      });
      document.addEventListener("keydown", event => {
        if (event.key === "Escape") {
          menu.hidden = true;
          trigger.setAttribute("aria-expanded", "false");
        }
      });
    }

    const logoutButton = document.getElementById("vocabflowLogout");
    if (logoutButton && !logoutButton.dataset.bound) {
      logoutButton.dataset.bound = "1";
      logoutButton.addEventListener("click", async () => {
        logoutButton.disabled = true;
        try {
          await logout();
        } catch (error) {
          logoutButton.disabled = false;
          console.error("VocabFlow logout failed:", error);
        }
      });
    }

    if (typeof window.applyTranslations === "function") window.applyTranslations();
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>'"]/g, char => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;"
    }[char]));
  }

  window.VocabFlowAuth = Object.freeze({ login, register, logout, me, request, handleUnauthorized, renderUserPanel, ensureCsrfToken });

  if (typeof document !== "undefined") {
    document.addEventListener("vocabflow:pageinit", () => {
      renderUserPanel();
      if (typeof window.applyTranslations === "function") window.applyTranslations();
    });
  }
})();
