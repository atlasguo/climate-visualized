/* shared.js
   Shared module: export global STATE, dispatcher and utility helpers.
   Purpose: decouple map and chart for easier testing and extension.
*/

export const STATE = {
    width: 0,
    height: 0,
    data: [],
    projection: null,
    zoomTransform: d3.zoomIdentity,
    mapBounds: null,
    mapExtent: null,
    symbolRadius: null
};

export const dispatcher = d3.dispatch(
    "hover", "hoverend", 
    "select", "viewChanged", "dataLoaded", "lock", "unlock", "tabChanged", "symbolStyleChanged"
);

// Hover threshold (degrees^2) - preserved for backward compatibility
export const HOVER_MAX_DIST2 = 0.25 * 0.25; // degrees^2 (~25 km)

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
   rebuild on every zoom — we scale the search radius during query.
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
