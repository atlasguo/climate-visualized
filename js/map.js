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
const CANVAS_DPR = Math.max(window.devicePixelRatio || 1, 1);

// Search box elements
const searchInput = document.getElementById("search-input");
const searchSuggestions = document.getElementById("search-suggestions");

// Map display toggle elements
const toggleBorders = document.getElementById("toggle-borders");
const toggleGraticules = document.getElementById("toggle-graticules");
const toggleGeoLines = document.getElementById("toggle-geolines");

/* =========================================================
   Global application state (moved to shared module)
   ========================================================= */

import { STATE, dispatcher, adjustColor, tempToR, precipToR, screenToLonLat, findNearest, buildQuadtree, findNearestScreen } from "./shared.js";
import { loadData, loadCountries, loadOcean } from "./data.js";

/* =========================================================
   Static reference layers
   ========================================================= */

let COUNTRIES = null;
let OCEAN = null;

// Map display toggles
let showBorders = true;
let showGraticules = true;
let showGeoLines = true;

// Currently hovered datum (used for visual highlight)
let hoveredDatum = null;
// When panel is locked, freeze highlight at the locked datum
let isLocked = false;
let lockedDatum = null;

function getCountryNameForDatum(d) {
    if (!d || d.countryName !== undefined || !COUNTRIES) return d ? (d.countryName || "") : "";
    const pt = [d.lon, d.lat];

    function polygonContainsWithHoles(rings, point) {
        if (!rings || rings.length === 0) return false;
        if (!d3.polygonContains(rings[0], point)) return false;
        for (let i = 1; i < rings.length; i++) {
            if (d3.polygonContains(rings[i], point)) return false;
        }
        return true;
    }

    function featureContainsPoint(feature, point) {
        const geom = feature.geometry;
        if (!geom) return false;
        if (geom.type === "Polygon") {
            return polygonContainsWithHoles(geom.coordinates, point);
        }
        if (geom.type === "MultiPolygon") {
            return geom.coordinates.some(poly => polygonContainsWithHoles(poly, point));
        }
        return false;
    }

    for (const feature of COUNTRIES.features || []) {
        if (!feature._bbox) {
            feature._bbox = d3.geoBounds(feature);
        }

        const [[minLon, minLat], [maxLon, maxLat]] = feature._bbox;
        if (pt[0] < minLon || pt[0] > maxLon || pt[1] < minLat || pt[1] > maxLat) {
            continue;
        }

        if (featureContainsPoint(feature, pt)) {
            d.countryName = feature.properties?.ADMIN || feature.properties?.NAME || "";
            return d.countryName;
        }
    }
    d.countryName = "";
    return d.countryName;
}

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
    { lat:  66.5, dashed: true, name: "Arctic Circle" },
    { lat:  23.5, dashed: true, name: "Tropic of Cancer" },
    { lat:   0.0, dashed: false, name: "Equator" },
    { lat: -23.5, dashed: true, name: "Tropic of Capricorn" },
    { lat: -66.5, dashed: true, name: "Antarctic Circle" }
];

/* =========================================================
   Resize handling
   ========================================================= */

// Handle container resize: update projection, symbol radius, bounds and redraw
function resize() {
    STATE.width = mapWrapper.clientWidth;
    STATE.height = mapWrapper.clientHeight;

    canvas.width = STATE.width * CANVAS_DPR;
    canvas.height = STATE.height * CANVAS_DPR;
    canvas.style.width = STATE.width + "px";
    canvas.style.height = STATE.height + "px";
    overlay.attr("width", STATE.width).attr("height", STATE.height);
    ctx.setTransform(CANVAS_DPR, 0, 0, CANVAS_DPR, 0, 0);

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

    ctx.setTransform(CANVAS_DPR, 0, 0, CANVAS_DPR, 0, 0);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, STATE.width, STATE.height);

    ctx.fillStyle = "#ffffff";
    ctx.fillRect(
        b.minX * k + x,
        b.minY * k + y,
        (b.maxX - b.minX) * k,
        (b.maxY - b.minY) * k
    );
}

function drawOcean() {
    if (!OCEAN) return;

    const path = d3.geoPath(STATE.projection, ctx);
    const { x, y, k } = STATE.zoomTransform;

    ctx.save();
    ctx.translate(x, y);
    ctx.scale(k, k);

    // Set clipping region to ocean only
    ctx.beginPath();
    path(OCEAN);
    ctx.clip("evenodd");

    // Fill ocean base color (light blue)
    ctx.beginPath();
    path(OCEAN);
    ctx.fillStyle = "#e2f4fc"; // 浅蓝色底色
    ctx.fill("evenodd");

    // Simple inner glow effect: very light blue fade from edge inward
    const numLayers = 10;
    for (let i = 0; i < numLayers; i++) {
        const t = i / (numLayers - 1); // 0 (edge) to 1 (inner)
        const width = 1 + t * 150; // 1px to 151px (edge to inner)
        const alpha = 0.4 * (1 - t); // 0.4 at edge, 0 at inner
        
        ctx.beginPath();
        path(OCEAN);
        ctx.strokeStyle = `rgba(248, 252, 255, ${alpha})`; 
        ctx.lineWidth = width / k;
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        ctx.stroke();
    }

    ctx.restore();
}

function drawCountries() {
    if (!COUNTRIES || !showBorders) return;

    const path = d3.geoPath(STATE.projection, ctx);
    const { x, y, k } = STATE.zoomTransform;

    ctx.save();
    ctx.translate(x, y);
    ctx.scale(k, k);

    ctx.beginPath();
    path(COUNTRIES);
    
    // Adjust stroke width based on zoom level
    // At zoom 1: thin
    // As zoom increases: thicker (reaches max at zoom 6)
    const zoomFactor = Math.min(k, 6); // cap zoom effect at 6x
    
    ctx.strokeStyle = "#2b2b2b";
    ctx.lineWidth = (0.15 + (zoomFactor - 1) / 5 * 1.5) / k; // ranges from 0.15 to 1.65, scaled by k
    ctx.globalAlpha = 0.6;
    ctx.stroke();

    ctx.restore();
}

function drawGraticules() {
    if (!showGraticules) return;
    const path = d3.geoPath(STATE.projection, ctx);
    const { x, y, k } = STATE.zoomTransform;

    ctx.save();
    ctx.translate(x, y);
    ctx.scale(k, k);

    // Adjust stroke width based on zoom level
    const zoomFactor = Math.min(k, 6); // cap zoom effect at 6x

    ctx.beginPath();
    path(graticuleMinor());
    ctx.strokeStyle = "#e0e0e0";
    ctx.lineWidth = (0.25 + (zoomFactor - 1) / 5 * 0.5) / k; // ranges from 0.25 to 0.75
    ctx.stroke();

    ctx.beginPath();
    path(graticuleMajor());
    ctx.strokeStyle = "#c0c0c0";
    ctx.lineWidth = (0.5 + (zoomFactor - 1) / 5 * 1.0) / k; // ranges from 0.5 to 1.5
    ctx.stroke();

    ctx.restore();
}

function drawGeographicLines() {
    if (!showGeoLines) return;
    const path = d3.geoPath(STATE.projection, ctx);
    const { x, y, k } = STATE.zoomTransform;

    ctx.save();
    ctx.translate(x, y);
    ctx.scale(k, k);

    // Adjust stroke width based on zoom level
    const zoomFactor = Math.min(k, 6); // cap zoom effect at 6x

    referenceLatitudes.forEach(d => {
        const line = {
            type: "LineString",
            coordinates: d3.range(-180, 181, 1).map(lon => [lon, d.lat])
        };
        ctx.beginPath();
        path(line);
        ctx.setLineDash(d.dashed ? [6 / k, 4 / k] : []);
        ctx.strokeStyle = "#999999";
        ctx.lineWidth = (0.25 + (zoomFactor - 1) / 5 * 0.5) / k; // ranges from 0.25 to 0.75
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
    // Clamp latitude and longitude to valid ranges
    let lat = Math.max(-90, Math.min(90, d.lat));
    let lon = Math.max(-180, Math.min(180, d.lon));
    const [x0, y0] = STATE.projection([lon, lat]);
    const { x, y, k } = STATE.zoomTransform;

    const cx = x0 * k + x;
    const cy = y0 * k + y;

    const R_BASE = STATE.symbolRadius * DENSITY_FACTOR * k;
    const R_PRECIP = R_BASE * PRECIP_RADIUS_SCALE;

    const angles = d3.range(12).map(i => i * 2 * Math.PI / 12);

    ctx.save();
    ctx.translate(cx, cy);

    // Determine alpha for this glyph
    let glyphAlpha = 1.0;
    if (isLocked && lockedDatum && d.kg_type !== lockedDatum.kg_type) {
        glyphAlpha = 0.2;
    }

    // Precip ring
    ctx.beginPath();
    angles.forEach((a, i) => {
        const r = precipToR(d.p[i]) * R_PRECIP;
        ctx.lineTo(Math.sin(a) * r, -Math.cos(a) * r);
    });
    ctx.closePath();
    ctx.fillStyle = adjustColor(d.baseColor, PRECIP_SAT_FACTOR, PRECIP_L_FACTOR);
    ctx.globalAlpha = PRECIP_ALPHA * glyphAlpha;
    ctx.fill();

    // Temp fill
    ctx.beginPath();
    angles.forEach((a, i) => {
        const r = tempToR(d.t[i]) * R_BASE;
        ctx.lineTo(Math.sin(a) * r, -Math.cos(a) * r);
    });
    ctx.closePath();
    ctx.fillStyle = adjustColor(d.baseColor, TEMP_FILL_SAT_FACTOR, TEMP_FILL_L_FACTOR);
    ctx.globalAlpha = TEMP_FILL_ALPHA * glyphAlpha;
    ctx.fill();

    // Temp outline
    ctx.beginPath();
    angles.forEach((a, i) => {
        const r = tempToR(d.t[i]) * R_BASE;
        ctx.lineTo(Math.sin(a) * r, -Math.cos(a) * r);
    });
    ctx.closePath();
    ctx.strokeStyle = adjustColor(d.baseColor, TEMP_LINE_SAT_FACTOR, TEMP_LINE_L_FACTOR);
    ctx.globalAlpha = TEMP_LINE_ALPHA * glyphAlpha;
    ctx.lineWidth = TEMP_LINE_WIDTH * DENSITY_FACTOR * k;
    ctx.stroke();

    // Jan line
    const janR = tempToR(d.t[0]) * R_BASE;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(0, -janR);
    ctx.lineWidth = TEMP_LINE_WIDTH * DENSITY_FACTOR * k;
    ctx.globalAlpha = JAN_LINE_ALPHA * glyphAlpha;
    ctx.stroke();

    ctx.restore();
}

/* =========================================================
   Redraw, zoom, and initialization
   ========================================================= */

// Lightweight redraw: base map is drawn on canvas; hover highlight is handled by SVG overlay to avoid full canvas redraws for hover only
const LABEL_RIGHT_PADDING = 8;
const LABEL_BOTTOM_OFFSET = 16;

function buildAxisLabelSpecs(width, height, zoomTransform) {
    const { x, y, k } = zoomTransform;
    const corners = [
        [0, 0],
        [width, 0],
        [0, height],
        [width, height]
    ].map(([sx, sy]) => STATE.projection.invert([(sx - x) / k, (sy - y) / k]));

    let minLon = Infinity, maxLon = -Infinity;
    let minLat = Infinity, maxLat = -Infinity;
    corners.forEach(([lon, lat]) => {
        minLon = Math.min(minLon, lon);
        maxLon = Math.max(maxLon, lon);
        minLat = Math.min(minLat, lat);
        maxLat = Math.max(maxLat, lat);
    });

    const latSpecs = new Map();
    if (showGraticules) {
        const latStep = k <= 3 ? 30 : 10;
        for (let lat = Math.ceil(minLat / latStep) * latStep; lat <= maxLat; lat += latStep) {
            if (lat < -90 || lat > 90) continue;
            const label = lat === 0 ? "0°" : (lat > 0 ? `${lat}°N` : `${-lat}°S`);
            latSpecs.set(lat, label);
        }
    }
    if (showGeoLines) {
        referenceLatitudes.forEach(d => {
            if (d.lat >= minLat && d.lat <= maxLat && d.lat >= -90 && d.lat <= 90) {
                latSpecs.set(d.lat, d.name);
            }
        });
    }

    const latLabels = [];
    Array.from(latSpecs.keys()).sort((a, b) => a - b).forEach(lat => {
        const [px, py] = STATE.projection([0, lat]);
        const screenY = py * k + y;
        if (screenY > 0 && screenY < height) {
            latLabels.push({
                text: latSpecs.get(lat),
                baseX: width - LABEL_RIGHT_PADDING,
                baseY: screenY,
                align: "right",
                baseline: "middle"
            });
        }
    });

    const lonLabels = [];
    if (showGraticules) {
        const lonStep = k <= 3 ? 30 : 10;
        const lonSet = new Set();
        for (let lon = Math.ceil(minLon / lonStep) * lonStep; lon <= maxLon; lon += lonStep) {
            if (lon < -180 || lon > 180) continue;
            lonSet.add(lon);
        }
        lonSet.forEach(lon => {
            if (lon < -180 || lon > 180) return;
            const [px, py] = STATE.projection([lon, 0]);
            const screenX = px * k + x;
            if (screenX > 0 && screenX < width) {
                lonLabels.push({
                    text: lon === 0 ? "0°" : (lon > 0 ? `${lon}°E` : `${-lon}°W`),
                    baseX: screenX,
                    baseY: height - LABEL_BOTTOM_OFFSET,
                    align: "center",
                    baseline: "top"
                });
            }
        });
    }

    return { latLabels, lonLabels };
}

function renderAxisLabelSpecs(ctx, specs, fontSize, scale = 1) {
    ctx.font = `${fontSize}px Inter, system-ui`;
    ctx.globalAlpha = 1;
    ctx.lineWidth = 4;
    ctx.lineJoin = "round";
    ctx.strokeStyle = "rgba(255, 255, 255, 0.9)";
    ctx.fillStyle = "#666666";

    const renderLine = (spec) => {
        const x = spec.baseX * scale;
        const y = spec.baseY * scale;
        ctx.textAlign = spec.align;
        ctx.textBaseline = spec.baseline;
        ctx.strokeText(spec.text, x, y);
        ctx.fillText(spec.text, x, y);
    };

    specs.latLabels.forEach(renderLine);
    specs.lonLabels.forEach(renderLine);
}

function drawAxisLabels() {
    if (!STATE.projection) return;
    ctx.save();
    ctx.setTransform(CANVAS_DPR, 0, 0, CANVAS_DPR, 0, 0);
    const specs = buildAxisLabelSpecs(STATE.width, STATE.height, STATE.zoomTransform);
    renderAxisLabelSpecs(ctx, specs, 11);
    ctx.restore();
}

export function drawAxisLabelsForExport(targetCtx, overlayScale, fontSize = 26, showLabels = true) {
    if (!STATE.projection || !showLabels) return;
    if (!showLabels) return;
    const specs = buildAxisLabelSpecs(STATE.width, STATE.height, STATE.zoomTransform);
    targetCtx.save();
    targetCtx.setTransform(CANVAS_DPR, 0, 0, CANVAS_DPR, 0, 0);
    renderAxisLabelSpecs(targetCtx, specs, fontSize, overlayScale);
    targetCtx.restore();
}

function redraw() {
    drawMapBackground();
    drawOcean();
    drawCountries();
    drawGraticules();
    drawGeographicLines();
    STATE.data.forEach(drawGlyph);
    drawAxisLabels();
    
    // Update hover circle position after zoom/pan
    updateHoverCircle();
    updateSearchMarker();
}

// Update hover circle position based on current transform
function updateHoverCircle() {
    if (!STATE.projection) return;
    
    const datum = isLocked ? lockedDatum : hoveredDatum;
    if (!datum) return;
    
    const [x0, y0] = STATE.projection([datum.lon, datum.lat]);
    const cx = x0 * STATE.zoomTransform.k + STATE.zoomTransform.x;
    const cy = y0 * STATE.zoomTransform.k + STATE.zoomTransform.y;
    const R_BASE = STATE.symbolRadius * DENSITY_FACTOR * STATE.zoomTransform.k;
    const R_PRECIP = R_BASE * PRECIP_RADIUS_SCALE;
    const outerR = Math.max(R_PRECIP, R_BASE) * 1.35;
    
    hoverCircle.attr('cx', cx).attr('cy', cy).attr('r', outerR * 0.75);
}

function updateSearchMarker() {
    if (!STATE.projection || !searchMarker || !searchPoint) return;

    // searchPoint: the searched location (地名搜索结果)
    const [sx0, sy0] = STATE.projection([searchPoint.lon, searchPoint.lat]);
    const sx = sx0 * STATE.zoomTransform.k + STATE.zoomTransform.x;
    const sy = sy0 * STATE.zoomTransform.k + STATE.zoomTransform.y;

    // searchMarker: nearest climate data point (气候数据点，要躲避)
    const [cx0, cy0] = STATE.projection([searchMarker.lon, searchMarker.lat]);
    const cx = cx0 * STATE.zoomTransform.k + STATE.zoomTransform.x;
    const cy = cy0 * STATE.zoomTransform.k + STATE.zoomTransform.y;

    searchLayer.style('display', null);
    
    // Place symbol at search result point
    searchMarkerRect
        .attr('x', sx - 6)
        .attr('y', sy - 6);
    
    // Clear existing tspan elements
    searchMarkerLabel.selectAll('tspan').remove();
    
    // Split label by newlines and filter out empty lines
    const lines = searchMarker.label.split('\n').filter(line => line.trim().length > 0);
    
    if (lines.length === 0) return;  // Safety check
    
    const symbolRadius = 6;  // symbol is 12x12, so radius is 6
    const gap = 5;  // fixed gap between text block edge and search point symbol edge
    const estimatedWidth = Math.max(...lines.map(line => line.length * 6.5));
    const fontSize = 12;
    const lineHeight = 1.2;
    // Total text block height: first line height + (n-1) * line spacing
    const totalTextHeight = fontSize + (lines.length - 1) * fontSize * lineHeight;
    
    // Determine label position: place near search point, avoid climate data point
    // dx, dy: climate point relative to search point
    const dx = cx - sx;
    const dy = cy - sy;
    const absDx = Math.abs(dx);
    const absDy = Math.abs(dy);
    
    let labelX, labelY, textAnchor, dominantBaseline;
    
    // Use 45° angle threshold to determine primary separation direction
    if (absDx > absDy) {
        // Climate point is primarily on left or right
        // Place label horizontally with fixed gap from symbol edge
        labelY = sy;
        dominantBaseline = 'middle';
        
        if (dx > 0) {
            // Climate point is to the right, place label to the left
            labelX = sx - (symbolRadius + gap);
            textAnchor = 'end';
        } else {
            // Climate point is to the left, place label to the right
            labelX = sx + (symbolRadius + gap);
            textAnchor = 'start';
        }
    } else {
        // Climate point is primarily above or below
        // Place label vertically with fixed gap from symbol edge
        labelX = sx;  // center horizontally
        textAnchor = 'middle';
        
        if (dy < 0) {
            // Climate point is above, place label below
            // First line top edge = search point bottom + gap
            labelY = sy + symbolRadius + gap;
            dominantBaseline = 'hanging';  // y position is at top of text
        } else {
            // Climate point is below, place label above
            // Last line bottom edge = search point top - gap
            // We need to account for all lines above it
            labelY = sy - symbolRadius - gap - (lines.length - 1) * fontSize * lineHeight;
            dominantBaseline = 'alphabetic';  // y position is at baseline
        }
    }
    
    searchMarkerLabel
        .attr('x', labelX)
        .attr('y', labelY)
        .attr('text-anchor', textAnchor)
        .attr('dominant-baseline', dominantBaseline);
    
    lines.forEach((line, i) => {
        searchMarkerLabel.append('tspan')
            .attr('x', labelX)
            .attr('dy', i === 0 ? '0em' : '1.2em')
            .text(line);
    });
}

// Attach zoom handlers. Keep interactive redraw during zoom, and rebuild quadtree when projection changes (on end we don't need to rebuild quadtree because quadtree is built in projection updates)
let zoomRaf = null;
const zoomBehavior = d3.zoom()
    .scaleExtent([1, 20])
    .on("zoom", e => {
        STATE.zoomTransform = e.transform;
        if (zoomRaf) return;
        zoomRaf = requestAnimationFrame(() => {
            zoomRaf = null;
            constrainTransform();
            redraw();
        });
    });

overlay.call(zoomBehavior);

// Hover and interaction handling: find nearest point and dispatch hover/select events via dispatcher
// Convert screen coordinates to lon/lat, find nearest point, and dispatch events via dispatcher
const overlayNode = overlay.node();

// SVG highlight elements (cheap to update on hover)
const hoverLayer = overlay.append('g').attr('class', 'hover-layer').style('pointer-events', 'none').style('display', 'none');
const hoverCircle = hoverLayer.append('circle').attr('r', 0).attr('fill', 'none');

// Search marker elements
const searchLayer = overlay.append('g').attr('class', 'search-layer').style('pointer-events', 'none').style('display', 'none');
const searchMarkerRect = searchLayer.append('rect')
    .attr('width', 12)
    .attr('height', 12)
    .attr('rx', 3)
    .attr('ry', 3)
    .attr('fill', 'rgba(0, 0, 0, 0.75)')
    .attr('stroke', 'rgba(255, 255, 255, 0.9)')
    .attr('stroke-width', 3)
    .attr('stroke-linejoin', 'round')
    .attr('paint-order', 'stroke fill');
const searchMarkerLabel = searchLayer.append('text')
    .attr('font-size', 12)
    .attr('font-weight', 600)
    .attr('fill', 'rgba(0, 0, 0, 0.75)')
    .attr('stroke', 'rgba(255, 255, 255, 0.9)')
    .attr('stroke-width', 3)
    .attr('stroke-linejoin', 'round')
    .attr('paint-order', 'stroke fill');

// Track last mouse position (screen relative to overlay) so we can re-evaluate hover on unlock
let lastMousePos = null;

// Default hover circle styling
hoverCircle.attr('stroke', '#ffffff').attr('stroke-width', 3).attr('opacity', 0.95);

let searchMarker = null;
let searchPoint = null; // Store the search input location for relative positioning

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
        hoverCircle.attr('cx', cx).attr('cy', cy).attr('r', outerR*0.75)
            .attr('stroke', adjustColor(lockedDatum.baseColor, 1, 0.4));
    }
    // Set opacity for all points: same type 1, others 0.2
    if (lockedDatum && window.d3 && d3.selectAll) {
        d3.selectAll('.glyph').each(function(e) {
            const el = d3.select(this);
            if (e && e.kg_type === lockedDatum.kg_type) {
                el.style('opacity', 1.0);
            } else {
                el.style('opacity', 0.2);
            }
        });
    }
    overlayNode.style.cursor = 'default';
    // Force redraw to update glyph opacity
    if (typeof redraw === 'function') redraw();
});

dispatcher.on('unlock.map', () => {
    console.debug('[map] received unlock event');
    isLocked = false;
    lockedDatum = null;
    hoveredDatum = null;
    hoverLayer.style('display', 'none');
    searchMarker = null;
    searchLayer.style('display', 'none');
    overlayNode.style.cursor = 'default';
    // Force redraw to restore all glyphs
    if (typeof redraw === 'function') redraw();
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
            getCountryNameForDatum(nearest);
            dispatcher.call("hover", null, nearest);
            // show svg highlight
            const [x0, y0] = STATE.projection([nearest.lon, nearest.lat]);
            const cx = x0 * STATE.zoomTransform.k + STATE.zoomTransform.x;
            const cy = y0 * STATE.zoomTransform.k + STATE.zoomTransform.y;
            const R_BASE = STATE.symbolRadius * DENSITY_FACTOR * STATE.zoomTransform.k;
            const R_PRECIP = R_BASE * PRECIP_RADIUS_SCALE;
            const outerR = Math.max(R_PRECIP, R_BASE) * 1.35;

            hoverLayer.style('display', null);
            hoverCircle.attr('cx', cx).attr('cy', cy).attr('r', outerR*0.75)
                .attr('stroke', adjustColor(nearest.baseColor, 1, 0.5));

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

    if (d) {
        getCountryNameForDatum(d);
    }
    dispatcher.call("select", null, d);
});

/* =========================================================
   Location search functionality
   Uses Nominatim API for geocoding
   ========================================================= */

let searchTimeout;

async function searchLocations(query) {
    if (!query || query.length < 2) {
        searchSuggestions.style.display = 'none';
        return;
    }

    try {
        const response = await fetch(
            `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=8`
        );
        const results = await response.json();

        if (results.length === 0) {
            searchSuggestions.innerHTML = '<div class="search-suggestion-item" style="color: #999;">No results found</div>';
            searchSuggestions.style.display = 'block';
            return;
        }

        searchSuggestions.innerHTML = results
            .map(result => `
                <div class="search-suggestion-item" data-lat="${result.lat}" data-lon="${result.lon}">
                    ${result.display_name || result.name}
                </div>
            `)
            .join('');

        searchSuggestions.style.display = 'block';

        // Add click handlers to suggestions
        document.querySelectorAll('.search-suggestion-item[data-lat]').forEach(item => {
            item.addEventListener('click', () => {
                const lat = parseFloat(item.dataset.lat);
                const lon = parseFloat(item.dataset.lon);
                const label = item.textContent.trim();
                jumpToLocation(lat, lon, label);
                searchInput.value = label;
                searchSuggestions.style.display = 'none';
            });
        });
    } catch (error) {
        console.error('Search error:', error);
        searchSuggestions.innerHTML = '<div class="search-suggestion-item" style="color: #999;">Search error</div>';
        searchSuggestions.style.display = 'block';
    }
}

function jumpToLocation(lat, lon, label) {
    if (!STATE.projection) return;

    // Clamp latitude and longitude to valid ranges
    lat = Math.max(-90, Math.min(90, lat));
    lon = Math.max(-180, Math.min(180, lon));

    // Store the search input location for label positioning
    searchPoint = { lat, lon };

    const targetZoom = 10;
    const [x, y] = STATE.projection([lon, lat]);

    // Calculate center of screen
    const centerX = STATE.width / 2;
    const centerY = STATE.height / 2;

    // Calculate new transform to center the location at target zoom
    const newX = centerX - x * targetZoom;
    const newY = centerY - y * targetZoom;

    const newTransform = d3.zoomIdentity.translate(newX, newY).scale(targetZoom);

    const lockNearest = () => {
        let nearest = null;
        let minDist = Infinity;
        for (const d of STATE.data) {
            const dx = d.lon - lon;
            const dy = d.lat - lat;
            const dist = dx * dx + dy * dy;
            if (dist < minDist) {
                minDist = dist;
                nearest = d;
            }
        }

        if (isLocked) {
            dispatcher.call("select", null, null);
        }

        if (nearest) {
            getCountryNameForDatum(nearest);
            dispatcher.call("select", null, nearest);
            // Store nearest climate data point - use nearest's coordinates, not search point
            searchMarker = { lat: nearest.lat, lon: nearest.lon, label: (label || 'Search result').replace(/,/g, '\n') };
        } else {
            // Fallback if no nearest point found
            searchMarker = { lat, lon, label: (label || 'Search result').replace(/,/g, '\n') };
        }
        updateSearchMarker();
    };

    overlay.interrupt();
    overlay
        .transition()
        .duration(900)
        .ease(d3.easeCubicOut)
        .call(zoomBehavior.transform, newTransform)
        .on("end", lockNearest);
}

if (searchInput) {
    const searchClearBtn = document.getElementById('search-clear');
    
    searchInput.addEventListener('input', (e) => {
        // Show/hide clear button based on input value
        if (searchClearBtn) {
            searchClearBtn.style.display = e.target.value.trim() ? 'block' : 'none';
        }
        
        clearTimeout(searchTimeout);
        searchTimeout = setTimeout(() => {
            searchLocations(e.target.value);
        }, 300);
    });
    
    // Clear search function
    if (searchClearBtn) {
        searchClearBtn.addEventListener('click', () => {
            searchInput.value = '';
            searchClearBtn.style.display = 'none';
            searchSuggestions.style.display = 'none';
            searchLayer.style('display', 'none');
            searchPoint = null;
            searchMarker = null;
        });
    }

    document.addEventListener('click', (e) => {
        if (!e.target.closest('.search-container')) {
            searchSuggestions.style.display = 'none';
        }
    });
}

// Zoom control buttons
const zoomInBtn = document.getElementById('zoom-in');
const zoomOutBtn = document.getElementById('zoom-out');
const zoomResetBtn = document.getElementById('zoom-reset');

if (zoomInBtn) {
    zoomInBtn.addEventListener('click', () => {
        const currentTransform = STATE.zoomTransform;
        const newScale = Math.min(currentTransform.k * 1.5, 20); // max scale 20
        
        // Zoom towards center of viewport
        const centerX = STATE.width / 2;
        const centerY = STATE.height / 2;
        
        // Calculate the point in the original coordinate space
        const x0 = (centerX - currentTransform.x) / currentTransform.k;
        const y0 = (centerY - currentTransform.y) / currentTransform.k;
        
        // Calculate new transform to keep center point stable
        const newTransform = d3.zoomIdentity
            .translate(centerX - x0 * newScale, centerY - y0 * newScale)
            .scale(newScale);
        
        overlay.transition()
            .duration(300)
            .call(zoomBehavior.transform, newTransform);
    });
}

if (zoomOutBtn) {
    zoomOutBtn.addEventListener('click', () => {
        const currentTransform = STATE.zoomTransform;
        const newScale = Math.max(currentTransform.k / 1.5, 1); // min scale 1
        
        // Zoom from center of viewport
        const centerX = STATE.width / 2;
        const centerY = STATE.height / 2;
        
        // Calculate the point in the original coordinate space
        const x0 = (centerX - currentTransform.x) / currentTransform.k;
        const y0 = (centerY - currentTransform.y) / currentTransform.k;
        
        // Calculate new transform to keep center point stable
        const newTransform = d3.zoomIdentity
            .translate(centerX - x0 * newScale, centerY - y0 * newScale)
            .scale(newScale);
        
        overlay.transition()
            .duration(300)
            .call(zoomBehavior.transform, newTransform);
    });
}

if (zoomResetBtn) {
    zoomResetBtn.addEventListener('click', () => {
        // Reset to initial view (scale 1, centered)
        overlay.transition()
            .duration(600)
            .ease(d3.easeCubicOut)
            .call(zoomBehavior.transform, d3.zoomIdentity);
    });
}

// Map display toggle controls
if (toggleBorders) {
    toggleBorders.addEventListener('change', (e) => {
        showBorders = e.target.checked;
        redraw();
    });
}

if (toggleGraticules) {
    toggleGraticules.addEventListener('change', (e) => {
        showGraticules = e.target.checked;
        redraw();
    });
}

if (toggleGeoLines) {
    toggleGeoLines.addEventListener('change', (e) => {
        showGeoLines = e.target.checked;
        redraw();
    });
}

export async function init() {
    resize();
    STATE.data = await loadData();
    COUNTRIES = await loadCountries();
    OCEAN = await loadOcean();
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
