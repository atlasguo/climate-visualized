/* main.js
   Entry point (ES module): import chart to register subscribers, then initialize map.
   Ensures event listeners are registered before interactions/data load.
*/
import "./chart.js";
import { init as initMap } from "./map.js";
import {
    dispatcher,
    STATE,
    isMobileLayout,
    setMobileOptionsOpen,
    setMobileSheetOpen,
    syncVisualViewportMetrics,
    syncLayoutMode,
    toggleMobileOptions,
    toggleMobileSheet,
    usesCollapsedMapControls
} from "./shared.js";
import { showLoading, hideLoading } from "./loading.js";

let layoutRefreshTimer = null;
let viewportRefreshTimer = null;
let mapInitialized = false;
let webFontsReady = false;
let fontRefreshApplied = false;

syncVisualViewportMetrics();
syncLayoutMode(window.innerWidth);

function getActiveTabName() {
    const activeButton = document.querySelector(".panel-tab.active");
    return activeButton?.dataset.target || "overall";
}

function scheduleActiveTabRefresh(delay = 0) {
    window.clearTimeout(layoutRefreshTimer);
    layoutRefreshTimer = window.setTimeout(() => {
        const activeTab = getActiveTabName();
        if (activeTab === "overall") {
            window.redrawComboChart?.();
            return;
        }
        dispatcher.call("tabChanged", null, activeTab);
    }, delay);
}

function refreshTextRenderingAfterFontsLoad() {
    if (fontRefreshApplied || !webFontsReady || !mapInitialized) {
        return;
    }
    fontRefreshApplied = true;
    window.setTimeout(() => {
        scheduleActiveTabRefresh(0);
        window.redrawMap?.();
    }, 0);
}

function scheduleViewportResponsiveRefresh(delay = 160) {
    window.clearTimeout(viewportRefreshTimer);
    viewportRefreshTimer = window.setTimeout(() => {
        if (!mapInitialized) {
            return;
        }
        window.dispatchEvent(new Event("resize"));
        scheduleActiveTabRefresh(0);
    }, delay);
}

// Initialize map asynchronously
initMap()
    .then(() => {
        mapInitialized = true;
        refreshTextRenderingAfterFontsLoad();
    })
    .catch(err => {
        console.error("Failed to initialize map:", err);
        hideLoading();
    });

function setupPanelTabs() {
    const tabButtons = Array.from(document.querySelectorAll(".panel-tab"));
    if (!tabButtons.length) {
        return;
    }
    const tabPanels = Array.from(document.querySelectorAll(".tab-panel"));

    const activateTab = (target) => {
        showLoading("Loading tab...");

        tabButtons.forEach(button => {
            button.classList.toggle("active", button.dataset.target === target);
        });
        tabPanels.forEach(panel => {
            const panelTarget = panel.id.replace(/^tab-/, "");
            panel.classList.toggle("active", panelTarget === target);
        });

        setMobileOptionsOpen(false);
        dispatcher.call("tabChanged", null, target);

        if (target === "overall") {
            setTimeout(() => {
                try {
                    window.redrawComboChart?.();
                } catch {
                    // Ignore redraw failures during layout transitions.
                }
                hideLoading();
            }, 400);
        } else {
            setTimeout(() => hideLoading(), 400);
        }
    };

    tabButtons.forEach(button => {
        button.addEventListener("click", () => {
            activateTab(button.dataset.target);
        });
    });
}

// Initialize symbol style selector
function setupSymbolSelector() {
    const radioButtons = Array.from(document.querySelectorAll('input[name="symbol-style"]'));
    if (!radioButtons.length) {
        return;
    }

    window.setSymbolStyleSelection = (nextStyle) => {
        const target = document.querySelector(`input[name="symbol-style"][value="${nextStyle}"]`);
        if (!target) {
            return false;
        }
        radioButtons.forEach(radio => {
            radio.checked = radio === target;
        });
        dispatcher.call("symbolStyleChanged", null, nextStyle);
        return true;
    };

    radioButtons.forEach(radio => {
        radio.addEventListener("change", () => {
            const selectedStyle = document.querySelector('input[name="symbol-style"]:checked').value;
            dispatcher.call("symbolStyleChanged", null, selectedStyle);
        });
    });
}

function setupResponsiveShell() {
    const sheetToggle = document.getElementById("mobile-sheet-toggle");
    const optionsToggle = document.getElementById("map-options-toggle");
    const optionsPopover = document.getElementById("map-options-popover");

    sheetToggle?.addEventListener("click", () => {
        if (!isMobileLayout()) return;
        toggleMobileSheet();
    });

    optionsToggle?.addEventListener("click", (event) => {
        event.stopPropagation();
        if (!usesCollapsedMapControls()) return;
        if (isMobileLayout() && !STATE.mobileOptionsOpen) {
            setMobileSheetOpen(false);
        }
        toggleMobileOptions();
    });

    optionsPopover?.addEventListener("click", (event) => {
        event.stopPropagation();
    });

    document.addEventListener("click", (event) => {
        if (!usesCollapsedMapControls() || !STATE.mobileOptionsOpen) return;
        if (event.target.closest("#map-options-toggle") || event.target.closest("#map-options-popover")) {
            return;
        }
        setMobileOptionsOpen(false);
    });

    window.addEventListener("resize", () => {
        syncVisualViewportMetrics();
        syncLayoutMode(window.innerWidth);
    });

    dispatcher.on("layoutChanged.main", () => {
        scheduleActiveTabRefresh(220);
    });

    dispatcher.on("mobileSheetChanged.main", () => {
        if (isMobileLayout()) {
            scheduleActiveTabRefresh(220);
        }
    });

    dispatcher.on("lock.mainResponsive", () => {
        if (usesCollapsedMapControls()) {
            setMobileOptionsOpen(false);
        }
        if (!isMobileLayout()) return;
        setMobileSheetOpen(true);
    });

    dispatcher.on("unlock.mainResponsive", () => {
        if (!isMobileLayout()) return;
        setMobileSheetOpen(false);
    });
}

function setupVisualViewportSync() {
    syncVisualViewportMetrics();

    const vv = window.visualViewport;
    const activeSearchInput = document.getElementById("search-input");
    if (!vv) {
        return;
    }

    const onViewportChange = () => {
        syncVisualViewportMetrics();
        if (!isMobileLayout()) {
            return;
        }
        if (activeSearchInput && document.activeElement === activeSearchInput) {
            return;
        }
        scheduleViewportResponsiveRefresh(160);
    };

    vv.addEventListener("resize", onViewportChange);
    vv.addEventListener("scroll", onViewportChange);
}

function setupFontRefresh() {
    if (!document.fonts?.ready) {
        return;
    }
    document.fonts.ready.then(() => {
        webFontsReady = true;
        refreshTextRenderingAfterFontsLoad();
    }).catch(() => {
        webFontsReady = true;
        refreshTextRenderingAfterFontsLoad();
    });
}

document.addEventListener("DOMContentLoaded", () => {
    setupPanelTabs();
    setupSymbolSelector();
    setupResponsiveShell();
    setupVisualViewportSync();
    setupFontRefresh();
});
