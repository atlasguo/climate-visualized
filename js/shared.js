/* shared.js
   Shared module: export global STATE, dispatcher and utility helpers.
   Purpose: decouple map and chart for easier testing and extension.
*/

export const LAYOUT_BREAKPOINTS = Object.freeze({
    mobileMax: 767,
    compactMax: 1700
});

const COMPACT_COLLAPSED_MAX = 1150;

export const STATE = {
    width: 0,
    height: 0,
    data: [],
    projection: null,
    zoomTransform: d3.zoomIdentity,
    mapBounds: null,
    mapExtent: null,
    symbolRadius: null,
    layoutMode: "desktop",
    compactControlsMode: "regular",
    mobileSheetOpen: false,
    mobileOptionsOpen: false,
    visualViewport: null,
    hasAutoSwitchedGlyphThisSession: false,
    hasManuallyEnteredGlyphThisSession: false
};

export const dispatcher = d3.dispatch(
    "hover", "hoverend",
    "select", "searchSelect", "viewChanged", "dataLoaded", "lock", "unlock", "tabChanged", "symbolStyleChanged",
    "layoutChanged", "mobileSheetChanged", "mobileOptionsChanged"
);

// Hover threshold (degrees^2) - preserved for backward compatibility
export const HOVER_MAX_DIST2 = 0.25 * 0.25; // degrees^2 (~25 km)

function getAppRoot() {
    return document.getElementById("app");
}

function getMobileSheetToggleButton() {
    return document.getElementById("mobile-sheet-toggle");
}

function getMapOptionsToggleButton() {
    return document.getElementById("map-options-toggle");
}

function getMapOptionsPopover() {
    return document.getElementById("map-options-popover");
}

function usesCollapsedMapControlsForState(layoutMode, compactControlsMode) {
    return layoutMode === "mobile"
        || (layoutMode === "compact" && compactControlsMode === "collapsed");
}

function syncUiStateToDom() {
    const app = getAppRoot();
    const isMobile = STATE.layoutMode === "mobile";
    const usesCollapsedControls = usesCollapsedMapControlsForState(STATE.layoutMode, STATE.compactControlsMode);
    const sheetOpen = isMobile && STATE.mobileSheetOpen;
    const optionsOpen = usesCollapsedControls && STATE.mobileOptionsOpen;

    if (app) {
        app.setAttribute("data-layout", STATE.layoutMode);
        app.setAttribute("data-compact-controls", STATE.compactControlsMode);
        app.classList.toggle("mobile-sheet-open", sheetOpen);
        app.classList.toggle("mobile-options-open", optionsOpen);
    }

    const sheetToggle = getMobileSheetToggleButton();
    if (sheetToggle) {
        sheetToggle.setAttribute("aria-expanded", String(sheetOpen));
        sheetToggle.setAttribute("aria-label", sheetOpen ? "Close details panel" : "Open details panel");
    }

    const optionsToggle = getMapOptionsToggleButton();
    if (optionsToggle) {
        optionsToggle.setAttribute("aria-expanded", String(optionsOpen));
    }

    const optionsPopover = getMapOptionsPopover();
    if (optionsPopover) {
        optionsPopover.setAttribute("aria-hidden", String(!optionsOpen || !usesCollapsedControls));
    }
}

export function getLayoutModeForWidth(width = window.innerWidth) {
    if (width <= LAYOUT_BREAKPOINTS.mobileMax) {
        return "mobile";
    }
    if (width <= LAYOUT_BREAKPOINTS.compactMax) {
        return "compact";
    }
    return "desktop";
}

export function isMobileLayout() {
    return STATE.layoutMode === "mobile";
}

export function isCompactLayout() {
    return STATE.layoutMode === "compact";
}

export function getCompactControlsModeForWidth(width = window.innerWidth, layoutMode = getLayoutModeForWidth(width)) {
    return layoutMode === "compact" && width <= COMPACT_COLLAPSED_MAX
        ? "collapsed"
        : "regular";
}

export function isCollapsedCompactLayout() {
    return isCompactLayout() && STATE.compactControlsMode === "collapsed";
}

export function usesCollapsedMapControls() {
    return usesCollapsedMapControlsForState(STATE.layoutMode, STATE.compactControlsMode);
}

export function supportsFinePointer() {
    if (typeof window.matchMedia !== "function") {
        return true;
    }
    return window.matchMedia("(hover: hover) and (pointer: fine)").matches;
}

export function canUseHoverPreview() {
    return !isMobileLayout() && supportsFinePointer();
}

export function syncLayoutMode(width = window.innerWidth) {
    const nextMode = getLayoutModeForWidth(width);
    const nextCompactControlsMode = getCompactControlsModeForWidth(width, nextMode);
    const layoutChanged = STATE.layoutMode !== nextMode;
    const compactControlsChanged = STATE.compactControlsMode !== nextCompactControlsMode;
    STATE.layoutMode = nextMode;
    STATE.compactControlsMode = nextCompactControlsMode;

    if (nextMode !== "mobile") {
        STATE.mobileSheetOpen = false;
    }

    if (layoutChanged || compactControlsChanged || !usesCollapsedMapControlsForState(nextMode, nextCompactControlsMode)) {
        STATE.mobileOptionsOpen = false;
    }

    syncUiStateToDom();

    if (layoutChanged || compactControlsChanged) {
        dispatcher.call("layoutChanged", null, nextMode);
    }

    return nextMode;
}

function getViewportMetrics() {
    const vv = window.visualViewport;
    return {
        width: vv?.width || window.innerWidth || document.documentElement.clientWidth || 0,
        height: vv?.height || window.innerHeight || document.documentElement.clientHeight || 0,
        offsetTop: vv?.offsetTop || 0,
        offsetLeft: vv?.offsetLeft || 0,
        scale: vv?.scale || 1
    };
}

function syncVisualViewportCssVars(metrics) {
    const root = document.documentElement;
    if (!root) {
        return;
    }
    root.style.setProperty("--visual-viewport-width", `${metrics.width}px`);
    root.style.setProperty("--visual-viewport-height", `${metrics.height}px`);
    root.style.setProperty("--visual-viewport-offset-top", `${metrics.offsetTop}px`);
    root.style.setProperty("--visual-viewport-offset-left", `${metrics.offsetLeft}px`);
    root.style.setProperty("--visual-viewport-scale", String(metrics.scale));
}

export function syncVisualViewportMetrics() {
    const metrics = getViewportMetrics();
    STATE.visualViewport = metrics;
    syncVisualViewportCssVars(metrics);
    return metrics;
}

export function runAfterViewportSettles(callback, {
    debounceMs = 140,
    maxWaitMs = 520,
    fallbackMs = 120
} = {}) {
    if (typeof callback !== "function") {
        return;
    }

    const vv = window.visualViewport;
    if (!vv) {
        syncVisualViewportMetrics();
        window.setTimeout(() => {
            syncVisualViewportMetrics();
            callback();
        }, fallbackMs);
        return;
    }

    let finished = false;
    let debounceTimer = null;
    let maxWaitTimer = null;

    const cleanup = () => {
        vv.removeEventListener("resize", onViewportChange);
        vv.removeEventListener("scroll", onViewportChange);
        window.clearTimeout(debounceTimer);
        window.clearTimeout(maxWaitTimer);
    };

    const finish = () => {
        if (finished) {
            return;
        }
        finished = true;
        cleanup();
        syncVisualViewportMetrics();
        callback();
    };

    const onViewportChange = () => {
        syncVisualViewportMetrics();
        window.clearTimeout(debounceTimer);
        debounceTimer = window.setTimeout(finish, debounceMs);
    };

    syncVisualViewportMetrics();
    vv.addEventListener("resize", onViewportChange);
    vv.addEventListener("scroll", onViewportChange);
    onViewportChange();
    maxWaitTimer = window.setTimeout(finish, maxWaitMs);
}

export function setMobileSheetOpen(value) {
    const nextValue = isMobileLayout() ? !!value : false;
    const changed = STATE.mobileSheetOpen !== nextValue;
    STATE.mobileSheetOpen = nextValue;
    syncUiStateToDom();
    if (changed) {
        dispatcher.call("mobileSheetChanged", null, nextValue);
    }
}

export function toggleMobileSheet() {
    setMobileSheetOpen(!STATE.mobileSheetOpen);
}

export function setMobileOptionsOpen(value) {
    const nextValue = usesCollapsedMapControls() ? !!value : false;
    const changed = STATE.mobileOptionsOpen !== nextValue;
    STATE.mobileOptionsOpen = nextValue;
    syncUiStateToDom();
    if (changed) {
        dispatcher.call("mobileOptionsChanged", null, nextValue);
    }
}

export function toggleMobileOptions() {
    setMobileOptionsOpen(!STATE.mobileOptionsOpen);
}

// Color and mapping helpers
// Adjust color saturation and lightness; return hex
export function adjustColor(hex, satFactor, lightFactor) {
    const hsl = d3.hsl(d3.color(hex));
    hsl.s *= satFactor;
    hsl.l *= lightFactor;
    return hsl.formatHex();
}

// Temperature mapping (uses original constants)
// Normalize temperature to 0..1 for glyph scaling
export function tempToR(t) {
    const TEMP_MIN = -63.9375;
    const TEMP_MAX = 39.0;
    return (t - TEMP_MIN) / (TEMP_MAX - TEMP_MIN);
}

// Precipitation mapping (preserves original nonlinear mapping)
// Map precipitation to a relative radius proportion
export function precipToR(p) {
    const PRECIP_MAX = 1519.375;
    const X1 = 0.10, X2 = 0.90, Y1 = 0.20, Y2 = 0.80;
    const R_MIN = 0.10, R_MAX = 1;

    const x = Math.min(PRECIP_MAX, Math.max(0, p)) / PRECIP_MAX;
    const y = x < X1 ? Y1 / X1 * x
        : x > X2 ? Y2 + (1 - Y2) / (1 - X2) * (x - X2)
        : Y1 + (Y2 - Y1) / (X2 - X1) * (x - X1);
    return R_MIN + (R_MAX - R_MIN) * y;
}

// Convert screen pixel coordinates to lon/lat (based on current zoomTransform and projection)
export function screenToLonLat(x, y) {
    const t = STATE.zoomTransform;
    return STATE.projection.invert([
        (x - t.x) / t.k,
        (y - t.y) / t.k
    ]);
}

// Find nearest data point by lon/lat (Euclidean), using existing threshold filter
export function findNearest(lon, lat) {
    let best = null;
    let minDist = Infinity;

    for (const d of STATE.data) {
        const dx = d.lon - lon;
        const dy = d.lat - lat;
        const dist = dx * dx + dy * dy;
        if (dist < minDist) {
            minDist = dist;
            best = d;
        }
    }

    return minDist <= HOVER_MAX_DIST2 * 25 ? best : null;
}

/* =========================================================
   Screen-space quadtree for fast nearest-neighbor lookup
   Build once when projection or data changes; searches operate
   in projected (pre-transform) coordinates so we don't need to
   rebuild on every zoom - we scale the search radius during query.
   ========================================================= */

let quadtreeRoot = null;

export function buildQuadtree() {
    if (!STATE.projection || !STATE.data) {
        quadtreeRoot = null;
        return;
    }

    const pts = STATE.data.map(d => {
        let x = d.px;
        let y = d.py;
        if (!Number.isFinite(x) || !Number.isFinite(y)) {
            [x, y] = STATE.projection([d.lon, d.lat]);
        }
        return { x, y, d };
    });

    quadtreeRoot = d3.quadtree()
        .x(p => p.x)
        .y(p => p.y)
        .addAll(pts);
}

// Find nearest by screen pixel coordinates (sx, sy are pixel coordinates within map wrapper)
// maxPixelRadius is a search radius in screen pixels (optional). Returns the matched datum or null.
export function findNearestScreen(sx, sy, maxPixelRadius = 24) {
    if (!quadtreeRoot) return null;
    const t = STATE.zoomTransform;
    const ux = (sx - t.x) / t.k;
    const uy = (sy - t.y) / t.k;

    const r = (maxPixelRadius / t.k) || Infinity;
    const found = quadtreeRoot.find(ux, uy, r);
    return found ? found.d : null;
}
