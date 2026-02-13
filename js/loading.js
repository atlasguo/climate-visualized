/* =========================================================
   loading.js
   Unified loading overlay and mobile entry gate management
   ========================================================= */

const loadingOverlay = document.getElementById("loading-overlay");
const loadingBox = loadingOverlay?.querySelector(".loading-box");
const loadingText = loadingOverlay?.querySelector(".loading-text");

function ensureMobileEntryGate() {
    if (!loadingBox) return { gate: null, button: null };

    let gate = document.getElementById("mobile-entry-gate");
    if (!gate) {
        gate = document.createElement("div");
        gate.id = "mobile-entry-gate";
        gate.setAttribute("aria-hidden", "true");
        gate.innerHTML = `
            <p id="mobile-entry-desc">For the best visual experience, please view on a larger screen.</p>
            <p class="mobile-entry-linkline">
                Climate Visualized:
                <a href="https://cartoguophy.com/climate-visualized/" target="_blank" rel="noopener">
                    https://cartoguophy.com/climate-visualized/
                </a>
            </p>
            <button id="mobile-entry-btn" type="button">Continue</button>
        `;
        loadingBox.appendChild(gate);
    }

    const button = gate.querySelector("#mobile-entry-btn");
    return { gate, button };
}

const { gate: mobileEntryGate, button: mobileEntryBtn } = ensureMobileEntryGate();
const smallScreenMedia = typeof window.matchMedia === "function"
    ? window.matchMedia("(max-width: 1199px)")
    : null;

let isLoading = true;
let mobileEntryAccepted = false;

function isSmallScreen() {
    return !!smallScreenMedia?.matches;
}

function shouldShowGate() {
    return !isLoading && isSmallScreen() && !mobileEntryAccepted;
}

function syncOverlay() {
    if (!loadingOverlay) return;

    const gateActive = shouldShowGate();
    loadingOverlay.classList.toggle("gate-mode", gateActive);

    if (mobileEntryGate) {
        mobileEntryGate.setAttribute("aria-hidden", gateActive ? "false" : "true");
    }

    loadingOverlay.style.display = (isLoading || gateActive) ? "flex" : "none";
}

if (mobileEntryBtn) {
    mobileEntryBtn.addEventListener("click", () => {
        mobileEntryAccepted = true;
        syncOverlay();
    });
}

if (smallScreenMedia) {
    if (typeof smallScreenMedia.addEventListener === "function") {
        smallScreenMedia.addEventListener("change", syncOverlay);
    } else if (typeof smallScreenMedia.addListener === "function") {
        smallScreenMedia.addListener(syncOverlay);
    }
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
 * Hide loading overlay or switch to mobile entry gate when needed.
 */
export function hideLoading() {
    isLoading = false;
    if (loadingText) {
        loadingText.textContent = "Loading...";
    }
    syncOverlay();
    document.dispatchEvent(new CustomEvent("app-loading", { detail: { loading: false } }));
}
