/* =========================================================
   loading.js
   Unified loading overlay management
   ========================================================= */

const loadingOverlay = document.getElementById("loading-overlay");
const loadingText = loadingOverlay?.querySelector('.loading-text');

/**
 * Show loading overlay with optional custom text
 * @param {string} text - Optional custom text to display
 */
export function showLoading(text = 'Loading…') {
    if (loadingOverlay) {
        if (loadingText) {
            loadingText.textContent = text;
        }
        loadingOverlay.style.display = 'flex';
    }
    document.dispatchEvent(new CustomEvent('app-loading', { detail: { loading: true } }));
}

/**
 * Hide loading overlay
 */
export function hideLoading() {
    if (loadingOverlay) {
        loadingOverlay.style.display = 'none';
        if (loadingText) {
            loadingText.textContent = 'Loading…'; // Reset to default
        }
    }
    document.dispatchEvent(new CustomEvent('app-loading', { detail: { loading: false } }));
}
