/* =========================================================
   loading.js
   Unified loading overlay management
   ========================================================= */

const loadingOverlay = document.getElementById("loading-overlay");
const loadingText = loadingOverlay?.querySelector(".loading-text");

let isLoading = true;

function syncOverlay() {
    if (!loadingOverlay) return;
    loadingOverlay.style.display = isLoading ? "flex" : "none";
}

/**
 * Show loading overlay with optional custom text.
 * @param {string} text - Optional custom text to display.
 */
export function showLoading(text = "Loading...") {
    isLoading = true;
    if (loadingText) {
        loadingText.textContent = text;
    }
    syncOverlay();
    document.dispatchEvent(new CustomEvent("app-loading", { detail: { loading: true } }));
}

/**
 * Hide loading overlay.
 */
export function hideLoading() {
    isLoading = false;
    if (loadingText) {
        loadingText.textContent = "Loading...";
    }
    syncOverlay();
    document.dispatchEvent(new CustomEvent("app-loading", { detail: { loading: false } }));
}
