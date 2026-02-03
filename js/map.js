/* =========================================================
   DOM references
   Canvas-based map rendering with SVG overlay for interaction
   Responsibilities: construct projection, manage zoom/pan, render background/countries/graticules and glyphs, and dispatch interaction events (hover/select).
   Note: does not render charts; events are dispatched via dispatcher.
   ========================================================= */

const mapWrapper = document.getElementById("map-wrapper");
const canvas = document.getElementById("mapCanvas");
const ctx = canvas.getContext("2d");
const overlay = d3.select("#overlay");
const loadingOverlay = document.getElementById("loading-overlay");

/* =========================================================
   Global application state (moved to shared module)
   ========================================================= */

import { STATE, dispatcher, adjustColor, tempToR, precipToR, screenToLonLat, findNearest, buildQuadtree, findNearestScreen } from "./shared.js";
import { loadData, loadCountries } from "./data.js";

/* =========================================================
   Static reference layers
   ========================================================= */

let COUNTRIES = null;

// Currently hovered datum (used for visual highlight)
let hoveredDatum = null;
// When panel is locked, freeze highlight at the locked datum
let isLocked = false;
let lockedDatum = null;

/* =========================================================
   Data range and geometry parameters
   ========================================================= */

const TEMP_MIN = -63.9375;
const TEMP_MAX = 39.0;
const PRECIP_MAX = 1519.375;

const PRECIP_RADIUS_SCALE = 2.3;
const DENSITY_FACTOR = 1.1;

/* =========================================================
   Precipitation nonlinear mapping parameters
   ========================================================= */

const X1 = 0.10;
const X2 = 0.90;
const Y1 = 0.20;
const Y2 = 0.80;

const R_MIN = 0.10;
const R_MAX = 1;

/* =========================================================
   Color and opacity parameters
   ========================================================= */

const PRECIP_SAT_FACTOR = 0.75;
const PRECIP_L_FACTOR   = 0.5;
const PRECIP_ALPHA      = 0.5;

const TEMP_FILL_SAT_FACTOR = 0.75;
const TEMP_FILL_L_FACTOR   = 0.5;
const TEMP_FILL_ALPHA      = 0.10;

const TEMP_LINE_SAT_FACTOR = 0.75;
const TEMP_LINE_L_FACTOR   = 0.5;
const TEMP_LINE_ALPHA      = 1.0;
const TEMP_LINE_WIDTH      = 0.1;

const JAN_LINE_ALPHA = 1.0;

/* =========================================================
   Graticules and reference latitudes
   ========================================================= */

const graticuleMajor = d3.geoGraticule().step([30, 30]);
const graticuleMinor = d3.geoGraticule().step([10, 10]);

const referenceLatitudes = [
    { lat:  66.5, dashed: true  },
    { lat:  23.5, dashed: true  },
    { lat:   0.0, dashed: false },
    { lat: -23.5, dashed: true  },
    { lat: -66.5, dashed: true  }
];

/* =========================================================
   Resize handling
   ========================================================= */

// Handle container resize: update projection, symbol radius, bounds and redraw
function resize() {
    STATE.width = mapWrapper.clientWidth;
    STATE.height = mapWrapper.clientHeight;

    canvas.width = STATE.width;
    canvas.height = STATE.height;
    overlay.attr("width", STATE.width).attr("height", STATE.height);

    if (STATE.projection) {
        updateProjection();
        computeSymbolRadius();
        computeMapBounds();
        computeMapExtent();
        constrainTransform();
        redraw();
    }
}

window.addEventListener("resize", resize);

/* =========================================================
   Data loading (moved to data.js)
   ========================================================= */

// Data loading is handled by ./data.js (loadData, loadCountries)


/* =========================================================
   Map projection
   ========================================================= */

// Compute and set projection to fit current data and canvas size
function updateProjection() {
    STATE.projection = d3.geoEquirectangular()
        .fitExtent([[0, 0], [STATE.width, STATE.height]], {
            type: "FeatureCollection",
            features: STATE.data.map(d => ({
                type: "Feature",
                geometry: {
                    type: "Point",
                    coordinates: [d.lon, d.lat]
                }
            }))
        });
}

/* =========================================================
   Symbol radius estimation
   Based on median nearest-neighbor distance
   ========================================================= */

// Estimate base symbol radius from median nearest-neighbor distance
function computeSymbolRadius() {
    const pts = STATE.data.map(d => STATE.projection([d.lon, d.lat]));
    const distances = [];

    for (let i = 0; i < pts.length; i++) {
        let minDist = Infinity;
        for (let j = 0; j < pts.length; j++) {
            if (i === j) continue;
            const dx = pts[j][0] - pts[i][0];
            const dy = pts[j][1] - pts[i][1];
            const dist = Math.hypot(dx, dy);
            if (dist < minDist) minDist = dist;
        }
        if (isFinite(minDist)) distances.push(minDist);
    }

    distances.sort((a, b) => a - b);
    const m = Math.floor(distances.length / 2);
    const median =
        distances.length % 2
            ? distances[m]
            : 0.5 * (distances[m - 1] + distances[m]);

    STATE.symbolRadius = median / 2;
}

/* =========================================================
   Map bounds
   Includes glyph padding to prevent clipping
   ========================================================= */

function computeMapBounds() {
    let minX = Infinity, maxX = -Infinity;
    let minY = Infinity, maxY = -Infinity;

    STATE.data.forEach(d => {
        const [x, y] = STATE.projection([d.lon, d.lat]);
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
    });

    const pad = STATE.symbolRadius * DENSITY_FACTOR * PRECIP_RADIUS_SCALE * 2;

    STATE.mapBounds = {
        minX: minX - pad,
        maxX: maxX + pad,
        minY: minY - pad,
        maxY: maxY + pad
    };
}

/* =========================================================
   World extent
   ========================================================= */

function computeMapExtent() {
    const corners = [
        [-180, -90],
        [-180,  90],
        [ 180, -90],
        [ 180,  90]
    ].map(c => STATE.projection(c));

    let minX = Infinity, maxX = -Infinity;
    let minY = Infinity, maxY = -Infinity;

    corners.forEach(([x, y]) => {
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
    });

    STATE.mapExtent = { minX, maxX, minY, maxY };
}

/* =========================================================
   Pan and zoom constraint
   ========================================================= */

function constrainTransform() {
    const t = STATE.zoomTransform;
    const k = t.k;
    const b = STATE.mapBounds;

    const w = (b.maxX - b.minX) * k;
    const h = (b.maxY - b.minY) * k;

    t.x = w <= STATE.width
        ? (STATE.width - w) / 2 - b.minX * k
        : Math.min(-b.minX * k, Math.max(STATE.width - b.maxX * k, t.x));

    t.y = h <= STATE.height
        ? (STATE.height - h) / 2 - b.minY * k
        : Math.min(-b.minY * k, Math.max(STATE.height - b.maxY * k, t.y));
}

/* =========================================================
   Background and graticules
   ========================================================= */

function drawMapBackground() {
    const b = STATE.mapExtent;
    const { x, y, k } = STATE.zoomTransform;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = "#eeeeee";
    ctx.fillRect(0, 0, STATE.width, STATE.height);

    ctx.fillStyle = "#ffffff";
    ctx.fillRect(
        b.minX * k + x,
        b.minY * k + y,
        (b.maxX - b.minX) * k,
        (b.maxY - b.minY) * k
    );
}

function drawCountries() {
    if (!COUNTRIES) return;

    const path = d3.geoPath(STATE.projection, ctx);
    const { x, y, k } = STATE.zoomTransform;

    ctx.save();
    ctx.translate(x, y);
    ctx.scale(k, k);

    ctx.beginPath();
    path(COUNTRIES);
    ctx.strokeStyle = "#2b2b2b";
    ctx.lineWidth = 0.4 / k;
    ctx.globalAlpha = 0.9;
    ctx.stroke();

    ctx.restore();
}

function drawGraticules() {
    const path = d3.geoPath(STATE.projection, ctx);
    const { x, y, k } = STATE.zoomTransform;

    ctx.save();
    ctx.translate(x, y);
    ctx.scale(k, k);

    ctx.beginPath();
    path(graticuleMinor());
    ctx.strokeStyle = "#e0e0e0";
    ctx.lineWidth = 0.25 / k;
    ctx.stroke();

    ctx.beginPath();
    path(graticuleMajor());
    ctx.strokeStyle = "#c0c0c0";
    ctx.lineWidth = 0.5 / k;
    ctx.stroke();

    referenceLatitudes.forEach(d => {
        const line = {
            type: "LineString",
            coordinates: d3.range(-180, 181, 1).map(lon => [lon, d.lat])
        };
        ctx.beginPath();
        path(line);
        ctx.setLineDash(d.dashed ? [6 / k, 4 / k] : []);
        ctx.strokeStyle = "#999999";
        ctx.lineWidth = 0.25 / k;
        ctx.stroke();
        ctx.setLineDash([]);
    });

    ctx.restore();
}

/* =========================================================
   Color and value helpers
   ========================================================= */

// Helpers (adjustColor, tempToR, precipToR) are imported from ./shared.js


/* =========================================================
   Glyph rendering
   ========================================================= */

// Draw a station's precipitation and temperature glyph at projected position (fill + outline + January line)
function drawGlyph(d) {
    const [x0, y0] = STATE.projection([d.lon, d.lat]);
    const { x, y, k } = STATE.zoomTransform;

    const cx = x0 * k + x;
    const cy = y0 * k + y;

    const R_BASE = STATE.symbolRadius * DENSITY_FACTOR * k;
    const R_PRECIP = R_BASE * PRECIP_RADIUS_SCALE;

    const angles = d3.range(12).map(i => i * 2 * Math.PI / 12);

    ctx.save();
    ctx.translate(cx, cy);

    ctx.beginPath();
    angles.forEach((a, i) => {
        const r = precipToR(d.p[i]) * R_PRECIP;
        ctx.lineTo(Math.sin(a) * r, -Math.cos(a) * r);
    });
    ctx.closePath();
    ctx.fillStyle = adjustColor(d.baseColor, PRECIP_SAT_FACTOR, PRECIP_L_FACTOR);
    ctx.globalAlpha = PRECIP_ALPHA;
    ctx.fill();

    ctx.beginPath();
    angles.forEach((a, i) => {
        const r = tempToR(d.t[i]) * R_BASE;
        ctx.lineTo(Math.sin(a) * r, -Math.cos(a) * r);
    });
    ctx.closePath();
    ctx.fillStyle = adjustColor(d.baseColor, TEMP_FILL_SAT_FACTOR, TEMP_FILL_L_FACTOR);
    ctx.globalAlpha = TEMP_FILL_ALPHA;
    ctx.fill();

    ctx.beginPath();
    angles.forEach((a, i) => {
        const r = tempToR(d.t[i]) * R_BASE;
        ctx.lineTo(Math.sin(a) * r, -Math.cos(a) * r);
    });
    ctx.closePath();
    ctx.strokeStyle = adjustColor(d.baseColor, TEMP_LINE_SAT_FACTOR, TEMP_LINE_L_FACTOR);
    ctx.globalAlpha = TEMP_LINE_ALPHA;
    ctx.lineWidth = TEMP_LINE_WIDTH * DENSITY_FACTOR * k;
    ctx.stroke();

    const janR = tempToR(d.t[0]) * R_BASE;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(0, -janR);
    ctx.lineWidth = TEMP_LINE_WIDTH * DENSITY_FACTOR * k;
    ctx.globalAlpha = JAN_LINE_ALPHA;
    ctx.stroke();

    ctx.restore();
}

/* =========================================================
   Redraw, zoom, and initialization
   ========================================================= */

// Lightweight redraw: base map is drawn on canvas; hover highlight is handled by SVG overlay to avoid full canvas redraws for hover only
function redraw() {
    drawMapBackground();
    drawCountries();
    drawGraticules();
    STATE.data.forEach(drawGlyph);
}

// Attach zoom handlers. Keep interactive redraw during zoom, and rebuild quadtree when projection changes (on end we don't need to rebuild quadtree because quadtree is built in projection updates)
overlay.call(
    d3.zoom()
        .scaleExtent([1, 30])
        .on("zoom", e => {
            STATE.zoomTransform = e.transform;
            constrainTransform();
            redraw();
        })
);

// Hover and interaction handling: find nearest point and dispatch hover/select events via dispatcher
// Convert screen coordinates to lon/lat, find nearest point, and dispatch events via dispatcher
const overlayNode = overlay.node();

// SVG highlight elements (cheap to update on hover)
const hoverLayer = overlay.append('g').attr('class', 'hover-layer').style('pointer-events', 'none').style('display', 'none');
const hoverCircle = hoverLayer.append('circle').attr('r', 0).attr('fill', 'none');

// Track last mouse position (screen relative to overlay) so we can re-evaluate hover on unlock
let lastMousePos = null;

// Default hover circle styling
hoverCircle.attr('stroke', '#ffffff').attr('stroke-width', 2).attr('opacity', 0.95);

// Respect lock/unlock events from chart: freeze or resume hover highlight
dispatcher.on('lock.map', d => {
    console.debug('[map] received lock event ->', d);
    isLocked = true;
    lockedDatum = d || null;
    hoveredDatum = lockedDatum;

    if (lockedDatum && STATE.projection) {
        const [x0, y0] = STATE.projection([lockedDatum.lon, lockedDatum.lat]);
        const cx = x0 * STATE.zoomTransform.k + STATE.zoomTransform.x;
        const cy = y0 * STATE.zoomTransform.k + STATE.zoomTransform.y;
        const R_BASE = STATE.symbolRadius * DENSITY_FACTOR * STATE.zoomTransform.k;
        const R_PRECIP = R_BASE * PRECIP_RADIUS_SCALE;
        const outerR = Math.max(R_PRECIP, R_BASE) * 1.35;

        hoverLayer.style('display', null);
        hoverCircle.attr('cx', cx).attr('cy', cy).attr('r', outerR)
            .attr('stroke', adjustColor(lockedDatum.baseColor, 1.2, 0.6));
    }
    overlayNode.style.cursor = 'default';
});

dispatcher.on('unlock.map', () => {
    console.debug('[map] received unlock event');
    isLocked = false;
    lockedDatum = null;
    hoveredDatum = null;
    hoverLayer.style('display', 'none');
    overlayNode.style.cursor = 'default';
});
function onMouseMove(e) {
    if (!STATE.projection) return;

    // Compute and cache last mouse position (overlay-relative pixels)
    const rect = overlay.node().getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    lastMousePos = { x: sx, y: sy };

    // If panel is locked, keep highlight frozen
    if (isLocked) return;

    // Use screen-space quadtree for fast nearest lookup
    const pixelRadius = STATE.symbolRadius * DENSITY_FACTOR * PRECIP_RADIUS_SCALE * STATE.zoomTransform.k * 1.2;
    const nearest = findNearestScreen(sx, sy, pixelRadius);

    // Only update state when hover target changes
    if (nearest !== hoveredDatum) {
        hoveredDatum = nearest;
        if (nearest) {
            dispatcher.call("hover", null, nearest);
            // show svg highlight
            const [x0, y0] = STATE.projection([nearest.lon, nearest.lat]);
            const cx = x0 * STATE.zoomTransform.k + STATE.zoomTransform.x;
            const cy = y0 * STATE.zoomTransform.k + STATE.zoomTransform.y;
            const R_BASE = STATE.symbolRadius * DENSITY_FACTOR * STATE.zoomTransform.k;
            const R_PRECIP = R_BASE * PRECIP_RADIUS_SCALE;
            const outerR = Math.max(R_PRECIP, R_BASE) * 1.35;

            hoverLayer.style('display', null);
            hoverCircle.attr('cx', cx).attr('cy', cy).attr('r', outerR)
                .attr('stroke', adjustColor(nearest.baseColor, 1.2, 0.6));

            overlayNode.style.cursor = 'pointer';
        } else {
            dispatcher.call("hoverend", null);
            hoverLayer.style('display', 'none');
            overlayNode.style.cursor = 'default';
        }
    }
}

function onMouseLeave() {
    // If the panel is locked, keep the highlight visible when the cursor leaves the overlay
    if (isLocked) return;

    if (hoveredDatum !== null) {
        hoveredDatum = null;
        dispatcher.call("hoverend", null);
        hoverLayer.style('display', 'none');
        overlayNode.style.cursor = 'default';
    }
}

overlayNode.addEventListener("mousemove", onMouseMove);
overlayNode.addEventListener("mouseleave", onMouseLeave);
overlayNode.addEventListener("click", e => {
    if (!STATE.projection) return;

    const rect = overlay.node().getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    const pixelRadius = STATE.symbolRadius * DENSITY_FACTOR * PRECIP_RADIUS_SCALE * STATE.zoomTransform.k * 1.2;
    const d = findNearestScreen(sx, sy, pixelRadius);

    // Debug: log click and nearest datum
    console.debug("[map] click -> nearest:", d);

    dispatcher.call("select", null, d);
});

export async function init() {
    resize();
    STATE.data = await loadData();
    COUNTRIES = await loadCountries();
    await new Promise(r => requestAnimationFrame(r));
    updateProjection();
    computeSymbolRadius();
    computeMapBounds();
    computeMapExtent();
    // Build quadtree for fast screen-space queries
    buildQuadtree();
    redraw();

    // data load complete
    loadingOverlay.style.display = "none";
    dispatcher.call("dataLoaded", null, STATE.data);
}
