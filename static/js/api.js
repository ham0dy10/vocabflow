/* VocabFlow API client.
 * Centralizes HTTP, CSRF handling, credentials, JSON parsing, and 401 handling
 * so authentication and data persistence use one predictable request path.
 */
(function () {
  "use strict";

  const MUTATION_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
  let csrfToken = null;
  let csrfPromise = null;

  function isMutation(method) {
    return MUTATION_METHODS.has(String(method || "GET").toUpperCase());
  }

  function setCsrfToken(token) {
    csrfToken = token || null;
    if (typeof window !== "undefined") window.__VOCABFLOW_CSRF_TOKEN__ = csrfToken;
    return csrfToken;
  }

  function getCsrfToken() {
    if (csrfToken) return csrfToken;
    if (typeof window !== "undefined" && window.__VOCABFLOW_CSRF_TOKEN__) {
      csrfToken = window.__VOCABFLOW_CSRF_TOKEN__;
    }
    return csrfToken;
  }

  async function ensureCsrfToken({ force = false } = {}) {
    if (!force && getCsrfToken()) return csrfToken;
    if (csrfPromise && !force) return csrfPromise;

    csrfPromise = fetch("/api/auth/csrf", {
      credentials: "same-origin",
      headers: { Accept: "application/json" }
    })
      .then(async response => {
        const body = await response.json().catch(() => null);
        if (!response.ok || !body?.csrfToken) {
          throw new Error(body?.error || "Could not initialize security token");
        }
        return setCsrfToken(body.csrfToken);
      })
      .finally(() => {
        csrfPromise = null;
      });

    return csrfPromise;
  }

  async function request(url, options = {}, config = {}) {
    const method = String(options.method || "GET").toUpperCase();
    const redirectOnUnauthorized = config.redirectOnUnauthorized !== false;
    const headers = {
      Accept: "application/json",
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(options.headers || {})
    };

    if (isMutation(method)) headers["X-CSRF-Token"] = await ensureCsrfToken();

    const response = await fetch(url, {
      credentials: "same-origin",
      ...options,
      headers
    });

    let body = null;
    try { body = await response.json(); } catch (_) {}

    if (response.status === 401 && redirectOnUnauthorized) {
      if (typeof window !== "undefined" && window.VocabFlowAuth?.handleUnauthorized) {
        window.VocabFlowAuth.handleUnauthorized();
      }
    }

    if (!response.ok) {
      const error = new Error(body?.error || `Request failed (${response.status})`);
      error.status = response.status;
      error.body = body;
      throw error;
    }

    if (body?.csrfToken) setCsrfToken(body.csrfToken);
    return body;
  }

  function invalidateCsrfToken() {
    setCsrfToken(null);
  }

  window.VocabFlowApi = Object.freeze({
    request,
    ensureCsrfToken,
    setCsrfToken,
    invalidateCsrfToken,
    isMutation
  });
})();
