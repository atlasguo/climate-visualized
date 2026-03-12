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
const CANVAS_DPR = Math.max(window.devicePixelRatio || 1, 1);
const UI_FONT_FAMILY = getComputedStyle(document.documentElement)
    .getPropertyValue("--font-family")
    .trim() || "Inter, system-ui, -apple-system, BlinkMacSystemFont, \"Helvetica Neue\", Arial, sans-serif";

// Search box elements
const searchInput = document.getElementById("search-input");
const searchSuggestions = document.getElementById("search-suggestions");
const searchClearBtn = document.getElementById("search-clear");

// Map display toggle elements
const toggleOcean = document.getElementById("toggle-ocean");
const toggleBorders = document.getElementById("toggle-borders");
const toggleGraticules = document.getElementById("toggle-graticules");
const toggleGeoLines = document.getElementById("toggle-geolines");
const toggleCityLabels = document.getElementById("toggle-city-labels");
const toggleCountryLabels = document.getElementById("toggle-country-labels");

/* =========================================================
   Global application state (moved to shared module)
   ========================================================= */

import {
    STATE,
    dispatcher,
    adjustColor,
    tempToR,
    precipToR,
    buildQuadtree,
    findNearestScreen,
    canUseHoverPreview,
    isMobileLayout,
    setMobileOptionsOpen,
    setMobileSheetOpen,
    runAfterViewportSettles
} from "./shared.js";
import { loadData, loadCountries, loadOcean, loadCityLabels } from "./data.js";
import { showLoading, hideLoading } from "./loading.js";
import { getLockState, setPanelLocked } from "./chart-tab-overall.js";

/* =========================================================
   Static reference layers
   ========================================================= */

let COUNTRIES = null;
let OCEAN = null;
let CITY_LABELS = [];

// Map display toggles
let showOcean = true;
let showBorders = true;
let showGraticules = true;
let showGeoLines = true;
let showCityLabels = false;
let showCountryLabels = false;

// Symbol style mode: 'point' (default) or 'glyph'
let symbolStyle = 'point';

// Currently hovered datum (used for visual highlight)
let hoveredDatum = null;

// Offscreen caches for staged rendering.
let oceanCache = null;
let countriesCache = null;
let climateLayerCache = null;
let oceanCacheCtx = null;
let countriesCacheCtx = null;
let climateLayerCacheCtx = null;
let lastOceanCacheZoom = null;
let lastCountriesCacheZoom = null;
let climateLayerKey = "";
let interactionSnapshotCanvas = null;
let interactionSnapshotCtx = null;
let zoomStartTransform = null;
let isInteractingBitmapMode = false;
let projectedCacheVersion = 0;
let renderEpoch = 0;
let pendingRefineJob = null;
let refineStartDelayTimer = null;
let mapBusyLoadingTimer = null;
let mapBusyLoadingVisible = false;
let pendingMobileLockFocusRaf = null;
let previousGlyphAutoSwitchRelativeZoom = 1;
const GLYPH_AUTO_SWITCH_RELATIVE_THRESHOLD = 8;
const CITY_LABEL_CAPITAL_COLOR = "#111111";
const CITY_LABEL_NON_CAPITAL_COLOR = "#8d949b";
const CITY_LABEL_HALO = "rgba(255, 255, 255, 0.75)";
const CITY_LABEL_HALO_WIDTH = 2.7;
const CITY_LABEL_PADDING = 3;
const CITY_LABEL_OFFSET_X = 0;
const CITY_LABEL_OFFSET_Y = 0;
const COUNTRY_LABEL_COLOR = "#666666";
const COUNTRY_LABEL_HALO = "rgba(255, 255, 255, 0.85)";
const COUNTRY_LABEL_HALO_WIDTH = 2;
const COUNTRY_LABEL_PADDING = 3;
const OCEAN_GLOW_LAYERS = [
    { width: 0, alpha: 0.52 },
    { width: 25, alpha: 0.3 },
    { width: 50, alpha: 0.2 },
    { width: 100, alpha: 0.1 }
];
const OCEAN_VIEWPORT_BUFFER_PX = 110;
const REFINE_START_DELAY_MS = 120;
const CAN_USE_PATH2D = typeof Path2D === "function";
const SYMBOL_RADIUS_REFERENCE_WIDTH = 960;
const MIN_SYMBOL_RADIUS_REFERENCE = 1.2;
const MIN_SYMBOL_RADIUS_SCALE = 0.28;
const MIN_POINT_RENDER_RADIUS = 0.2;
const MIN_GLYPH_RENDER_RADIUS = 0.35;
const MIN_HOVER_HIT_RADIUS_PX = 10;
const MIN_TOUCH_HIT_RADIUS_PX = 16;
const MIN_HOVER_CIRCLE_RADIUS_PX = 4;
const GLYPH_LINE_WIDTH_RATIO = 0.07;
const GLYPH_LINE_WIDTH_MIN_PX = 0.1;
const GLYPH_LINE_WIDTH_MAX_PX = 1.1;
const HOVER_RING_CORE_WIDTH_MIN = 2.4;
const HOVER_RING_CORE_WIDTH_MAX = 3.6;
const HOVER_RING_GLOW_WIDTH_MULTIPLIER = 2.8;
const HOVER_RING_SHADOW_WIDTH_MULTIPLIER = 2.2;
const HOVER_RING_GLOW_OPACITY = 0.34;
const HOVER_RING_SHADOW_OPACITY = 0.26;
const HOVER_RING_SHADOW_OFFSET_Y = 1.5;
const MOBILE_LOCK_FOCUS_VERTICAL_MARGIN_PX = 18;
const MOBILE_LOCK_FOCUS_HORIZONTAL_MARGIN_PX = 24;
const MOBILE_LOCK_FOCUS_SCALE_CANDIDATES = [1, 1.25, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10];

function getViewportProjectedBounds(transform = STATE.zoomTransform) {
    const k = transform?.k || 1;
    const x = transform?.x || 0;
    const y = transform?.y || 0;
    const left = (0 - x) / k;
    const right = (STATE.width - x) / k;
    const top = (0 - y) / k;
    const bottom = (STATE.height - y) / k;
    return {
        minX: Math.min(left, right),
        maxX: Math.max(left, right),
        minY: Math.min(top, bottom),
        maxY: Math.max(top, bottom)
    };
}

function bboxIntersectsBounds(bbox, bounds) {
    if (!bbox || !bounds) return false;
    return !(
        bbox.maxX < bounds.minX ||
        bbox.minX > bounds.maxX ||
        bbox.maxY < bounds.minY ||
        bbox.minY > bounds.maxY
    );
}

function intersectProjectedBounds(a, b) {
    if (!a || !b) return null;
    const minX = Math.max(a.minX, b.minX);
    const maxX = Math.min(a.maxX, b.maxX);
    const minY = Math.max(a.minY, b.minY);
    const maxY = Math.min(a.maxY, b.maxY);
    if (minX >= maxX || minY >= maxY) return null;
    return { minX, maxX, minY, maxY };
}

function featureIntersectsProjectedBounds(feature, bounds) {
    return bboxIntersectsBounds(feature?._projBBox, bounds);
}

function expandProjectedBounds(bounds, padding) {
    if (!bounds || !Number.isFinite(padding) || padding <= 0) return bounds;
    return {
        minX: bounds.minX - padding,
        maxX: bounds.maxX + padding,
        minY: bounds.minY - padding,
        maxY: bounds.maxY + padding
    };
}

function computeProjectedBBoxForObject(geoObj, path) {
    if (!geoObj || !path) return null;
    const bounds = path.bounds(geoObj);
    if (!bounds || bounds.length !== 2) return null;
    const [[minX, minY], [maxX, maxY]] = bounds;
    if (![minX, minY, maxX, maxY].every(Number.isFinite)) return null;
    return { minX, minY, maxX, maxY };
}

function buildProjectedPath2DForObject(geoObj, path) {
    if (!CAN_USE_PATH2D || !geoObj || !path) return null;
    const pathData = path(geoObj);
    if (typeof pathData !== "string" || !pathData.length) return null;
    try {
        return new Path2D(pathData);
    } catch {
        return null;
    }
}

function cacheProjectedGeometry(geoObj, path) {
    if (!geoObj) return;
    geoObj._projBBox = computeProjectedBBoxForObject(geoObj, path);
    geoObj._projPath2D = buildProjectedPath2DForObject(geoObj, path);
    geoObj._projPathVersion = projectedCacheVersion;
}

function getProjectedPath2DForObject(geoObj) {
    if (!geoObj || geoObj._projPathVersion !== projectedCacheVersion) return null;
    return geoObj._projPath2D || null;
}

function buildCombinedProjectedPath2D(features) {
    if (!CAN_USE_PATH2D || !Array.isArray(features) || !features.length) return null;
    if (features.length === 1) {
        return getProjectedPath2DForObject(features[0]);
    }
    const combinedPath = new Path2D();
    if (typeof combinedPath.addPath !== "function") return null;
    let hasPath = false;
    for (const feature of features) {
        const featurePath = getProjectedPath2DForObject(feature);
        if (!featurePath) return null;
        combinedPath.addPath(featurePath);
        hasPath = true;
    }
    return hasPath ? combinedPath : null;
}

function computeProjectedFeatureBounds() {
    if (!STATE.projection) return;
    const path = d3.geoPath(STATE.projection);

    if (COUNTRIES?.features) {
        for (const feature of COUNTRIES.features) {
            cacheProjectedGeometry(feature, path);
        }
    }

    if (!OCEAN) return;
    if (OCEAN.type === "FeatureCollection" && Array.isArray(OCEAN.features)) {
        let union = null;
        for (const feature of OCEAN.features) {
            cacheProjectedGeometry(feature, path);
            const b = feature._projBBox;
            if (!b) continue;
            if (!union) union = { ...b };
            else {
                union.minX = Math.min(union.minX, b.minX);
                union.maxX = Math.max(union.maxX, b.maxX);
                union.minY = Math.min(union.minY, b.minY);
                union.maxY = Math.max(union.maxY, b.maxY);
            }
        }
        OCEAN._projBBox = union;
    } else {
        cacheProjectedGeometry(OCEAN, path);
    }
}

function updateCountryLabelPoints() {
    if (!COUNTRIES?.features || !STATE.projection) return;
    COUNTRIES.features.forEach(feature => {
        if (feature._labelPoint && feature._labelPointVersion === projectedCacheVersion) return;
        const props = feature.properties || {};
        const labelLon = Number.isFinite(+props.LABEL_X) ? +props.LABEL_X : null;
        const labelLat = Number.isFinite(+props.LABEL_Y) ? +props.LABEL_Y : null;
        const lonLat = (labelLon !== null && labelLat !== null) ? [labelLon, labelLat] : d3.geoCentroid(feature);
        const projected = Array.isArray(lonLat) ? STATE.projection(lonLat) : null;
        if (Array.isArray(projected) && projected.every(Number.isFinite)) {
            feature._labelPoint = projected;
        } else {
            feature._labelPoint = null;
        }
        feature._labelPointVersion = projectedCacheVersion;
    });
}

function getVisibleOceanFeatures(bounds, bufferProjected = 0) {
    if (!OCEAN) return [];
    const effectiveBounds = expandProjectedBounds(bounds, bufferProjected);
    if (OCEAN.type === "FeatureCollection" && Array.isArray(OCEAN.features)) {
        return OCEAN.features.filter(feature => featureIntersectsProjectedBounds(feature, effectiveBounds));
    }
    return bboxIntersectsBounds(OCEAN._projBBox, effectiveBounds) ? [OCEAN] : [];
}

function getViewportLonLatBoundsFromProjectedBounds(bounds) {
    if (!STATE.projection || !bounds) return null;
    const effectiveBounds = STATE.mapExtent
        ? intersectProjectedBounds(bounds, STATE.mapExtent)
        : bounds;
    if (!effectiveBounds) return null;

    const corners = [
        [effectiveBounds.minX, effectiveBounds.minY],
        [effectiveBounds.minX, effectiveBounds.maxY],
        [effectiveBounds.maxX, effectiveBounds.minY],
        [effectiveBounds.maxX, effectiveBounds.maxY]
    ]
        .map(p => STATE.projection.invert(p))
        .filter(v => Array.isArray(v) && Number.isFinite(v[0]) && Number.isFinite(v[1]));

    if (!corners.length) return null;

    let minLon = Infinity, maxLon = -Infinity;
    let minLat = Infinity, maxLat = -Infinity;
    for (const [lon, lat] of corners) {
        minLon = Math.min(minLon, lon);
        maxLon = Math.max(maxLon, lon);
        minLat = Math.min(minLat, lat);
        maxLat = Math.max(maxLat, lat);
    }

    minLon = Math.max(-180, minLon);
    maxLon = Math.min(180, maxLon);
    minLat = Math.max(-90, minLat);
    maxLat = Math.min(90, maxLat);
    if (
        !Number.isFinite(minLon) ||
        !Number.isFinite(maxLon) ||
        !Number.isFinite(minLat) ||
        !Number.isFinite(maxLat)
    ) return null;

    // Guard against degenerate or invalid ranges near projection seam edges.
    const EPS = 1e-6;
    if (minLon >= maxLon - EPS || minLat >= maxLat - EPS) return null;

    return { minLon, maxLon, minLat, maxLat };
}

function buildParallelLine(lat, minLon, maxLon, lonStep) {
    if (!Number.isFinite(lat) || !Number.isFinite(minLon) || !Number.isFinite(maxLon)) return null;
    if (minLon >= maxLon) return null;
    const step = Math.max(0.1, lonStep);
    const start = Math.ceil(minLon / step) * step;
    const coordinates = [];
    coordinates.push([minLon, lat]);
    for (let lon = start; lon < maxLon; lon += step) {
        coordinates.push([lon, lat]);
    }
    coordinates.push([maxLon, lat]);
    if (coordinates.length < 2) return null;
    return { type: "LineString", coordinates };
}

function buildMeridianLine(lon, minLat, maxLat, latStep) {
    if (!Number.isFinite(lon) || !Number.isFinite(minLat) || !Number.isFinite(maxLat)) return null;
    if (minLat >= maxLat) return null;
    const step = Math.max(0.1, latStep);
    const start = Math.ceil(minLat / step) * step;
    const coordinates = [];
    coordinates.push([lon, minLat]);
    for (let lat = start; lat < maxLat; lat += step) {
        coordinates.push([lon, lat]);
    }
    coordinates.push([lon, maxLat]);
    if (coordinates.length < 2) return null;
    return { type: "LineString", coordinates };
}

// Check if ocean cache needs to be regenerated
function isCacheTransformMatch(cacheTransform, transform) {
    if (!cacheTransform || !transform) return false;
    return cacheTransform.k === transform.k &&
        cacheTransform.x === transform.x &&
        cacheTransform.y === transform.y;
}

function makeTransformSnapshot(transform = STATE.zoomTransform) {
    return { x: transform.x, y: transform.y, k: transform.k };
}

function makeClimateLayerKey(transform, lockedType, hoveredType) {
    return `${transform.k}|${transform.x}|${transform.y}|${symbolStyle}|${lockedType || ""}|${hoveredType || ""}`;
}

function hasOceanCache(transform = STATE.zoomTransform) {
    return !!oceanCache && isCacheTransformMatch(lastOceanCacheZoom, transform);
}

function hasCountriesCache(transform = STATE.zoomTransform) {
    return !!countriesCache && isCacheTransformMatch(lastCountriesCacheZoom, transform);
}

function hasClimateLayerCache(transform = STATE.zoomTransform, lockedType = null, hoveredType = null) {
    return !!climateLayerCache && climateLayerKey === makeClimateLayerKey(transform, lockedType, hoveredType);
}

// Invalidate caches (force regeneration on next draw)
function invalidateCaches() {
    lastOceanCacheZoom = null;
    lastCountriesCacheZoom = null;
    climateLayerKey = "";
}

// Initialize offscreen canvases
function initCaches() {
    if (!oceanCache) {
        oceanCache = document.createElement('canvas');
        oceanCacheCtx = oceanCache.getContext('2d');
    }
    if (!countriesCache) {
        countriesCache = document.createElement('canvas');
        countriesCacheCtx = countriesCache.getContext('2d');
    }
    if (!climateLayerCache) {
        climateLayerCache = document.createElement('canvas');
        climateLayerCacheCtx = climateLayerCache.getContext('2d');
    }
}

// Resize caches to match main canvas
function resizeCaches() {
    if (!oceanCache || !countriesCache || !climateLayerCache) return;
    const w = canvas.width;
    const h = canvas.height;
    if (oceanCache.width !== w || oceanCache.height !== h) {
        oceanCache.width = w;
        oceanCache.height = h;
    }
    if (countriesCache.width !== w || countriesCache.height !== h) {
        countriesCache.width = w;
        countriesCache.height = h;
    }
    if (climateLayerCache.width !== w || climateLayerCache.height !== h) {
        climateLayerCache.width = w;
        climateLayerCache.height = h;
    }
}

function generateOceanCache(transform = STATE.zoomTransform) {
    if (!OCEAN || !oceanCacheCtx) return;
    oceanCacheCtx.clearRect(0, 0, oceanCache.width, oceanCache.height);
    oceanCacheCtx.setTransform(CANVAS_DPR, 0, 0, CANVAS_DPR, 0, 0);
    let fallbackPath = null;
    const { x, y, k } = transform;
    const viewportBounds = getViewportProjectedBounds(transform);
    const bufferProjected = OCEAN_VIEWPORT_BUFFER_PX / Math.max(k, 1e-6);
    const visibleFeatures = getVisibleOceanFeatures(viewportBounds, bufferProjected);
    const visiblePath2D = buildCombinedProjectedPath2D(visibleFeatures);

    if (!visibleFeatures.length) {
        lastOceanCacheZoom = makeTransformSnapshot(transform);
        return;
    }

    oceanCacheCtx.save();
    oceanCacheCtx.translate(x, y);
    oceanCacheCtx.scale(k, k);

    if (visiblePath2D) {
        oceanCacheCtx.fillStyle = "#e2f4fc";
        oceanCacheCtx.fill(visiblePath2D, "evenodd");

        oceanCacheCtx.save();
        oceanCacheCtx.clip(visiblePath2D, "evenodd");
        for (const layer of OCEAN_GLOW_LAYERS) {
            const glowColor = layer.color || "250, 252, 255";
            oceanCacheCtx.strokeStyle = `rgba(${glowColor}, ${layer.alpha})`;
            oceanCacheCtx.lineWidth = layer.width / k;
            oceanCacheCtx.lineCap = "round";
            oceanCacheCtx.lineJoin = "round";
            oceanCacheCtx.stroke(visiblePath2D);
        }
        oceanCacheCtx.restore();
    } else {
        fallbackPath = d3.geoPath(STATE.projection, oceanCacheCtx);
        oceanCacheCtx.beginPath();
        for (const feature of visibleFeatures) {
            fallbackPath(feature);
        }
        oceanCacheCtx.fillStyle = "#e2f4fc";
        oceanCacheCtx.fill("evenodd");

        oceanCacheCtx.save();
        oceanCacheCtx.clip("evenodd");
        for (const layer of OCEAN_GLOW_LAYERS) {
            const glowColor = layer.color || "250, 252, 255";
            oceanCacheCtx.strokeStyle = `rgba(${glowColor}, ${layer.alpha})`;
            oceanCacheCtx.lineWidth = layer.width / k;
            oceanCacheCtx.lineCap = "round";
            oceanCacheCtx.lineJoin = "round";
            oceanCacheCtx.stroke();
        }
        oceanCacheCtx.restore();
    }
    oceanCacheCtx.restore();

    lastOceanCacheZoom = makeTransformSnapshot(transform);
}

// Generate countries cache
function generateCountriesCache(transform = STATE.zoomTransform) {
    if (!COUNTRIES || !countriesCacheCtx) return;
    
    countriesCacheCtx.clearRect(0, 0, countriesCache.width, countriesCache.height);
    countriesCacheCtx.setTransform(CANVAS_DPR, 0, 0, CANVAS_DPR, 0, 0);
    
    let fallbackPath = null;
    const { x, y, k } = transform;
    const b = STATE.mapExtent;
    const viewportBounds = getViewportProjectedBounds(transform);

    countriesCacheCtx.save();
    countriesCacheCtx.translate(x, y);
    countriesCacheCtx.scale(k, k);

    const zoomFactor = Math.min(k, 6);
    countriesCacheCtx.strokeStyle = "#7a7a7a";
    countriesCacheCtx.lineWidth = (0.15 + (zoomFactor - 1) / 5 * 1.5) / k;
    countriesCacheCtx.globalAlpha = 0.45;

    // Clip slightly inside world extent to avoid projection seam strokes on the outer rectangle.
    if (b) {
        const insetScreenPx = 1;
        const insetProjected = insetScreenPx / Math.max(k, 1e-6);
        countriesCacheCtx.beginPath();
        countriesCacheCtx.rect(
            b.minX + insetProjected,
            b.minY + insetProjected,
            Math.max(0, (b.maxX - b.minX) - insetProjected * 2),
            Math.max(0, (b.maxY - b.minY) - insetProjected * 2)
        );
        countriesCacheCtx.clip();
    }

    // Stroke features one-by-one to avoid collection-level seam joins that can form a rectangle.
    for (const feature of COUNTRIES.features || []) {
        if (!featureIntersectsProjectedBounds(feature, viewportBounds)) continue;
        const featurePath = getProjectedPath2DForObject(feature);
        if (featurePath) {
            countriesCacheCtx.stroke(featurePath);
        } else {
            if (!fallbackPath) fallbackPath = d3.geoPath(STATE.projection, countriesCacheCtx);
            countriesCacheCtx.beginPath();
            fallbackPath(feature);
            countriesCacheCtx.stroke();
        }
    }
    
    // Reset alpha
    countriesCacheCtx.globalAlpha = 1.0;
    countriesCacheCtx.restore();
    lastCountriesCacheZoom = makeTransformSnapshot(transform);
}

function drawClimateLayerToCache(transform = STATE.zoomTransform, lockedType = null, hoveredType = null) {
    if (!climateLayerCacheCtx) return;
    if (hasClimateLayerCache(transform, lockedType, hoveredType)) return;

    climateLayerCacheCtx.setTransform(1, 0, 0, 1, 0, 0);
    climateLayerCacheCtx.clearRect(0, 0, climateLayerCache.width, climateLayerCache.height);
    climateLayerCacheCtx.setTransform(CANVAS_DPR, 0, 0, CANVAS_DPR, 0, 0);
    if (symbolStyle === "point") {
        drawPointsBatchOnContext(climateLayerCacheCtx, transform, lockedType, hoveredType);
    } else {
        drawGlyphsBatchOnContext(climateLayerCacheCtx, transform, lockedType, hoveredType);
    }
    climateLayerCacheCtx.globalAlpha = 1.0;
    climateLayerKey = makeClimateLayerKey(transform, lockedType, hoveredType);
}

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
const MAP_CONTENT_FRAME_COLOR = "#d6d6d6";
const MAP_CONTENT_FRAME_WIDTH = 3;

const JAN_LINE_ALPHA = 1.0;

const MAP_POINT_TEMP_SAT_FACTOR = 0.5;
const MAP_POINT_TEMP_L_FACTOR = 0.75;
const MAP_BUSY_LOADING_DELAY_MS = 140;
const GLYPH_SAMPLE_SIZE = 2000;
const GLYPH_ANGLE_COUNT = 12;
const GLYPH_SIN = Array.from({ length: GLYPH_ANGLE_COUNT }, (_, i) => Math.sin(i * 2 * Math.PI / GLYPH_ANGLE_COUNT));
const GLYPH_COS = Array.from({ length: GLYPH_ANGLE_COUNT }, (_, i) => Math.cos(i * 2 * Math.PI / GLYPH_ANGLE_COUNT));

// Map-only point color helper: keep chart colors unchanged.
function tempColorForMapPoint(baseColor) {
    const hsl = d3.hsl(baseColor);
    hsl.s *= MAP_POINT_TEMP_SAT_FACTOR;
    hsl.l *= MAP_POINT_TEMP_L_FACTOR;
    return hsl.formatHex();
}

function initInteractionSnapshot() {
    if (!interactionSnapshotCanvas) {
        interactionSnapshotCanvas = document.createElement("canvas");
        interactionSnapshotCtx = interactionSnapshotCanvas.getContext("2d");
    }
}

function resizeInteractionSnapshot() {
    initInteractionSnapshot();
    if (!interactionSnapshotCanvas) return;
    if (interactionSnapshotCanvas.width !== canvas.width || interactionSnapshotCanvas.height !== canvas.height) {
        interactionSnapshotCanvas.width = canvas.width;
        interactionSnapshotCanvas.height = canvas.height;
    }
}

function beginInteractionBitmapMode() {
    resizeInteractionSnapshot();
    if (!interactionSnapshotCtx) return false;
    zoomStartTransform = { x: STATE.zoomTransform.x, y: STATE.zoomTransform.y, k: STATE.zoomTransform.k };
    const { locked, data: lockedData } = getLockState();
    const lockedType = locked ? (lockedData ? lockedData.kg_type : null) : null;
    const hoveredType = hoveredDatum ? hoveredDatum.kg_type : null;

    interactionSnapshotCtx.setTransform(1, 0, 0, 1, 0, 0);
    interactionSnapshotCtx.clearRect(0, 0, interactionSnapshotCanvas.width, interactionSnapshotCanvas.height);
    interactionSnapshotCtx.setTransform(CANVAS_DPR, 0, 0, CANVAS_DPR, 0, 0);
    if (symbolStyle === "point") {
        drawPointsBatchOnContext(interactionSnapshotCtx, zoomStartTransform, lockedType, hoveredType);
    } else {
        drawGlyphsBatchOnContext(interactionSnapshotCtx, zoomStartTransform, lockedType, hoveredType);
    }
    interactionSnapshotCtx.setTransform(1, 0, 0, 1, 0, 0);
    interactionSnapshotCtx.globalAlpha = 1.0;

    isInteractingBitmapMode = true;
    return true;
}

function endInteractionBitmapMode() {
    isInteractingBitmapMode = false;
    zoomStartTransform = null;
}

function drawInteractionBitmap() {
    if (!isInteractingBitmapMode || !interactionSnapshotCanvas || !zoomStartTransform) return false;
    if (!zoomStartTransform.k) return false;

    const scale = STATE.zoomTransform.k / zoomStartTransform.k;
    const tx = STATE.zoomTransform.x - zoomStartTransform.x * scale;
    const ty = STATE.zoomTransform.y - zoomStartTransform.y * scale;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(
        interactionSnapshotCanvas,
        tx * CANVAS_DPR,
        ty * CANVAS_DPR,
        interactionSnapshotCanvas.width * scale,
        interactionSnapshotCanvas.height * scale
    );
    return true;
}

/* =========================================================
   Graticules and reference latitudes
   ========================================================= */

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
    const wasHome = isHomeTransform();
    STATE.width = mapWrapper.clientWidth;
    STATE.height = mapWrapper.clientHeight;

    canvas.width = STATE.width * CANVAS_DPR;
    canvas.height = STATE.height * CANVAS_DPR;
    canvas.style.width = STATE.width + "px";
    canvas.style.height = STATE.height + "px";
    overlay.attr("width", STATE.width).attr("height", STATE.height);
    ctx.setTransform(CANVAS_DPR, 0, 0, CANVAS_DPR, 0, 0);

    if (STATE.projection) {
        cancelRefineJob();
        endInteractionBitmapMode();
        updateProjection();
        updateProjectedDataCache();
        updateProjectedCityLabelCache();
        updateCountryLabelPoints();
        computeSymbolRadius();
        computeMapBounds();
        computeMapExtent();
        homeZoomTransform = computeHomeZoomTransform();
        buildQuadtree();
        if (wasHome) {
            syncZoomTransform(homeZoomTransform);
        } else {
            constrainTransform();
            syncZoomTransform();
        }
        previousGlyphAutoSwitchRelativeZoom = getRelativeZoomFromHome() ?? 1;
        updateZoomControlState();
        invalidateCaches();
        resizeInteractionSnapshot();
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
    projectedCacheVersion += 1;
    computeProjectedFeatureBounds();
}

function updateProjectedDataCache() {
    if (!STATE.projection || !STATE.data) return;
    STATE.data.forEach(d => {
        const [px, py] = STATE.projection([d.lon, d.lat]);
        d.px = px;
        d.py = py;
        d.projectedCacheVersion = projectedCacheVersion;
    });
}

function updateProjectedCityLabelCache() {
    if (!STATE.projection || !CITY_LABELS?.length) return;
    CITY_LABELS.forEach(d => {
        const [px, py] = STATE.projection([d.lon, d.lat]);
        d.px = px;
        d.py = py;
        d.projectedCacheVersion = projectedCacheVersion;
    });
}

function buildGlyphRenderCache() {
    if (!STATE.data) return;
    STATE.data.forEach(d => {
        d.tempR12 = d.t.map(v => tempToR(v));
        d.precipR12 = d.p.map(v => precipToR(v));
        d.glyphPrecipFill = adjustColor(d.baseColor, PRECIP_SAT_FACTOR, PRECIP_L_FACTOR);
        d.glyphTempFill = adjustColor(d.baseColor, TEMP_FILL_SAT_FACTOR, TEMP_FILL_L_FACTOR);
        d.glyphTempStroke = adjustColor(d.baseColor, TEMP_LINE_SAT_FACTOR, TEMP_LINE_L_FACTOR);
    });
}

function nearestDistanceFromQuadtree(quadtree, p) {
    let minDist2 = Infinity;
    quadtree.visit((node, x0, y0, x1, y1) => {
        const dx = p.x < x0 ? x0 - p.x : p.x > x1 ? p.x - x1 : 0;
        const dy = p.y < y0 ? y0 - p.y : p.y > y1 ? p.y - y1 : 0;
        if (dx * dx + dy * dy > minDist2) return true;

        if (!node.length) {
            let q = node;
            do {
                if (q.data !== p) {
                    const ddx = q.data.x - p.x;
                    const ddy = q.data.y - p.y;
                    const dist2 = ddx * ddx + ddy * ddy;
                    if (dist2 < minDist2) minDist2 = dist2;
                }
                q = q.next;
            } while (q);
        }
        return false;
    });

    return Number.isFinite(minDist2) ? Math.sqrt(minDist2) : NaN;
}

function getMinimumSymbolRadius() {
    const width = Number.isFinite(STATE.width) ? STATE.width : 0;
    const normalizedWidth = width > 0
        ? Math.min(1, width / SYMBOL_RADIUS_REFERENCE_WIDTH)
        : 1;
    return MIN_SYMBOL_RADIUS_REFERENCE * Math.max(MIN_SYMBOL_RADIUS_SCALE, normalizedWidth);
}

function getVisualHitRadius(transform = STATE.zoomTransform) {
    const k = Number.isFinite(transform?.k) ? transform.k : 1;
    return STATE.symbolRadius * DENSITY_FACTOR * PRECIP_RADIUS_SCALE * k * 1.2;
}

function getInteractionHitRadius(transform = STATE.zoomTransform) {
    const minimumRadius = canUseHoverPreview() ? MIN_HOVER_HIT_RADIUS_PX : MIN_TOUCH_HIT_RADIUS_PX;
    return Math.max(minimumRadius, getVisualHitRadius(transform));
}

function getGlyphLineWidth(baseRadius) {
    const safeBaseRadius = Number.isFinite(baseRadius) ? baseRadius : 0;
    return Math.min(
        GLYPH_LINE_WIDTH_MAX_PX,
        Math.max(GLYPH_LINE_WIDTH_MIN_PX, safeBaseRadius * GLYPH_LINE_WIDTH_RATIO)
    );
}

function getCurrentMaxZoomScale() {
    return isMobileLayout() ? 54 : 20;
}

function getHoverStrokeWidths(radius) {
    const safeRadius = Number.isFinite(radius) ? radius : 0;
    const coreWidth = Math.min(
        HOVER_RING_CORE_WIDTH_MAX,
        Math.max(HOVER_RING_CORE_WIDTH_MIN, safeRadius * 0.14)
    );
    return {
        coreWidth,
        glowWidth: coreWidth * HOVER_RING_GLOW_WIDTH_MULTIPLIER,
        shadowWidth: coreWidth * HOVER_RING_SHADOW_WIDTH_MULTIPLIER
    };
}

/* =========================================================
   Symbol radius estimation
   Based on median nearest-neighbor distance
   ========================================================= */

// Estimate base symbol radius from median nearest-neighbor distance
function computeSymbolRadius() {
    const minimumSymbolRadius = getMinimumSymbolRadius();
    const pts = STATE.data
        .map(d => ({ x: d.px, y: d.py }))
        .filter(p => Number.isFinite(p.x) && Number.isFinite(p.y));
    if (pts.length < 2) {
        STATE.symbolRadius = minimumSymbolRadius;
        return;
    }

    const sampleSize = Math.min(GLYPH_SAMPLE_SIZE, pts.length);
    const step = Math.max(1, Math.floor(pts.length / sampleSize));
    const sampled = [];
    for (let i = 0; i < pts.length && sampled.length < sampleSize; i += step) {
        sampled.push(pts[i]);
    }

    const quadtree = d3.quadtree().x(p => p.x).y(p => p.y).addAll(pts);
    const distances = [];
    sampled.forEach(p => {
        const dist = nearestDistanceFromQuadtree(quadtree, p);
        if (Number.isFinite(dist)) {
            distances.push(dist);
        }
    });

    if (!distances.length) {
        STATE.symbolRadius = minimumSymbolRadius;
        return;
    }

    distances.sort((a, b) => a - b);
    const m = Math.floor(distances.length / 2);
    const median =
        distances.length % 2
            ? distances[m]
            : 0.5 * (distances[m - 1] + distances[m]);

    STATE.symbolRadius = Math.max(minimumSymbolRadius, median / 2);
}

/* =========================================================
   Map bounds
   Includes glyph padding to prevent clipping
   ========================================================= */

function computeMapBounds() {
    let minX = Infinity, maxX = -Infinity;
    let minY = Infinity, maxY = -Infinity;

    STATE.data.forEach(d => {
        if (!Number.isFinite(d.px) || !Number.isFinite(d.py)) return;
        minX = Math.min(minX, d.px);
        maxX = Math.max(maxX, d.px);
        minY = Math.min(minY, d.py);
        maxY = Math.max(maxY, d.py);
    });

    const pad = STATE.symbolRadius * DENSITY_FACTOR * PRECIP_RADIUS_SCALE * 2;

    if (!Number.isFinite(minX) || !Number.isFinite(maxX) || !Number.isFinite(minY) || !Number.isFinite(maxY)) {
        minX = 0;
        minY = 0;
        maxX = STATE.width;
        maxY = STATE.height;
    }

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

function getRenderableMapExtent() {
    const b = STATE.mapExtent;
    if (!b) return null;
    if (![b.minX, b.maxX, b.minY, b.maxY].every(Number.isFinite)) {
        return null;
    }
    return b;
}

function hasRenderableMapFrame() {
    return !!STATE.projection
        && Number.isFinite(STATE.width) && STATE.width > 0
        && Number.isFinite(STATE.height) && STATE.height > 0
        && !!getRenderableMapExtent();
}

/* =========================================================
   Pan and zoom constraint
   ========================================================= */

function getConstraintOverscrollBase() {
    let overscrollXBase = 0;
    let overscrollYBase = 0;
    if (STATE.projection) {
        const center = STATE.projection([0, 0]);
        const lon10 = STATE.projection([10, 0]);
        const lat10 = STATE.projection([0, 10]);
        if (center && lon10 && lat10) {
            overscrollXBase = Math.abs(lon10[0] - center[0]);
            overscrollYBase = Math.abs(lat10[1] - center[1]);
        }
    }
    return { overscrollXBase, overscrollYBase };
}

function getConstraintOverscroll(scale = STATE.zoomTransform?.k || 1) {
    const safeScale = Number.isFinite(scale) ? scale : 1;
    const { overscrollXBase, overscrollYBase } = getConstraintOverscrollBase();
    return {
        overscrollX: overscrollXBase * safeScale,
        overscrollY: overscrollYBase * safeScale
    };
}

function constrainTransform() {
    const t = STATE.zoomTransform;
    const k = t.k;
    const b = STATE.mapBounds;
    const { overscrollX, overscrollY } = getConstraintOverscroll(k);

    const w = (b.maxX - b.minX) * k;
    const h = (b.maxY - b.minY) * k;

    const minX = STATE.width - b.maxX * k - overscrollX;
    const maxX = -b.minX * k + overscrollX;
    if (minX <= maxX) {
        t.x = Math.min(maxX, Math.max(minX, t.x));
    } else {
        t.x = (STATE.width - w) / 2 - b.minX * k;
    }

    const minY = STATE.height - b.maxY * k - overscrollY;
    const maxY = -b.minY * k + overscrollY;
    if (minY <= maxY) {
        t.y = Math.min(maxY, Math.max(minY, t.y));
    } else {
        t.y = (STATE.height - h) / 2 - b.minY * k;
    }
}

/* =========================================================
   Background and graticules
   ========================================================= */

function drawMapBackground(transform = STATE.zoomTransform) {
    const b = getRenderableMapExtent();
    const safeWidth = Number.isFinite(STATE.width) ? STATE.width : 0;
    const safeHeight = Number.isFinite(STATE.height) ? STATE.height : 0;
    const x = Number.isFinite(transform?.x) ? transform.x : 0;
    const y = Number.isFinite(transform?.y) ? transform.y : 0;
    const k = Number.isFinite(transform?.k) ? transform.k : 1;

    ctx.setTransform(CANVAS_DPR, 0, 0, CANVAS_DPR, 0, 0);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, safeWidth, safeHeight);

    if (!b) return;

    ctx.fillStyle = "#ffffff";
    ctx.fillRect(
        b.minX * k + x,
        b.minY * k + y,
        (b.maxX - b.minX) * k,
        (b.maxY - b.minY) * k
    );
}

function drawMapContentFrame(transform = STATE.zoomTransform) {
    const b = getRenderableMapExtent();
    if (!b) return;
    const { x, y, k } = transform;
    const left = b.minX * k + x;
    const top = b.minY * k + y;
    const width = (b.maxX - b.minX) * k;
    const height = (b.maxY - b.minY) * k;

    ctx.save();
    ctx.setTransform(CANVAS_DPR, 0, 0, CANVAS_DPR, 0, 0);
    ctx.strokeStyle = MAP_CONTENT_FRAME_COLOR;
    ctx.lineWidth = MAP_CONTENT_FRAME_WIDTH;
    ctx.strokeRect(left, top, width, height);
    ctx.restore();
}


function drawGraticules(transform = STATE.zoomTransform) {
    if (!showGraticules) return;
    const bounds = getViewportProjectedBounds(transform);
    drawGraticulesViewport(transform, bounds);
}

function drawGraticulesViewport(transform = STATE.zoomTransform, bounds = getViewportProjectedBounds(transform)) {
    if (!showGraticules || !STATE.projection) return;
    const geoBounds = getViewportLonLatBoundsFromProjectedBounds(bounds);
    if (!geoBounds) return;

    const path = d3.geoPath(STATE.projection, ctx);
    const { x, y, k } = transform;
    const lineSampleStep = k < 6 ? 1 : 0.5;
    const lonStartMinor = Math.ceil(geoBounds.minLon / 10) * 10;
    const lonStartMajor = Math.ceil(geoBounds.minLon / 30) * 30;
    const latStartMinor = Math.ceil(geoBounds.minLat / 10) * 10;
    const latStartMajor = Math.ceil(geoBounds.minLat / 30) * 30;

    ctx.save();
    ctx.translate(x, y);
    ctx.scale(k, k);

    // Adjust stroke width based on zoom level
    const zoomFactor = Math.min(k, 6); // cap zoom effect at 6x

    ctx.strokeStyle = "#e0e0e0";
    ctx.lineWidth = (0.25 + (zoomFactor - 1) / 5 * 0.5) / k; // ranges from 0.25 to 0.75
    for (let lon = lonStartMinor; lon <= geoBounds.maxLon; lon += 10) {
        const line = buildMeridianLine(lon, geoBounds.minLat, geoBounds.maxLat, lineSampleStep);
        if (!line) continue;
        ctx.beginPath();
        path(line);
        ctx.stroke();
    }
    for (let lat = latStartMinor; lat <= geoBounds.maxLat; lat += 10) {
        const line = buildParallelLine(lat, geoBounds.minLon, geoBounds.maxLon, lineSampleStep);
        if (!line) continue;
        ctx.beginPath();
        path(line);
        ctx.stroke();
    }

    ctx.strokeStyle = "#c0c0c0";
    ctx.lineWidth = (0.5 + (zoomFactor - 1) / 5 * 1.0) / k; // ranges from 0.5 to 1.5
    for (let lon = lonStartMajor; lon <= geoBounds.maxLon; lon += 30) {
        const line = buildMeridianLine(lon, geoBounds.minLat, geoBounds.maxLat, lineSampleStep);
        if (!line) continue;
        ctx.beginPath();
        path(line);
        ctx.stroke();
    }
    for (let lat = latStartMajor; lat <= geoBounds.maxLat; lat += 30) {
        const line = buildParallelLine(lat, geoBounds.minLon, geoBounds.maxLon, lineSampleStep);
        if (!line) continue;
        ctx.beginPath();
        path(line);
        ctx.stroke();
    }

    ctx.restore();
}

function drawGeographicLines(transform = STATE.zoomTransform) {
    if (!showGeoLines) return;
    const bounds = getViewportProjectedBounds(transform);
    drawGeographicLinesViewport(transform, bounds);
}

function drawGeographicLinesViewport(transform = STATE.zoomTransform, bounds = getViewportProjectedBounds(transform)) {
    if (!showGeoLines || !STATE.projection) return;
    const geoBounds = getViewportLonLatBoundsFromProjectedBounds(bounds);
    if (!geoBounds) return;

    const path = d3.geoPath(STATE.projection, ctx);
    const { x, y, k } = transform;
    const lineSampleStep = k < 6 ? 1 : 0.5;

    ctx.save();
    ctx.translate(x, y);
    ctx.scale(k, k);

    // Adjust stroke width based on zoom level
    const zoomFactor = Math.min(k, 6); // cap zoom effect at 6x

    referenceLatitudes.forEach(d => {
        if (d.lat < geoBounds.minLat || d.lat > geoBounds.maxLat) return;
        const line = buildParallelLine(d.lat, geoBounds.minLon, geoBounds.maxLon, lineSampleStep);
        if (!line) return;
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

function getLabelRankLimit(k) {
    if (k < 0.9) return 1;
    if (k < 1.3) return 2;
    if (k < 2.0) return 3;
    if (k < 3.5) return 5;
    return 7;
}

function getCityLabelFontSize(rank, k) {
    const size = 9;
    const scale = Math.max(0.9, Math.min(1.1, Math.pow(k, 0.08)));
    return size * scale;
}

function getPopulationThreshold(k) {
    if (k < 0.9) return 12000000;
    if (k < 1.3) return 6000000;
    if (k < 2.0) return 2000000;
    if (k < 3.5) return 800000;
    return 0;
}

function drawCityLabels(transform = STATE.zoomTransform, collision = null) {
    if (!showCityLabels || !CITY_LABELS?.length || !STATE.projection) return;
    ctx.setTransform(CANVAS_DPR, 0, 0, CANVAS_DPR, 0, 0);
    const { x, y, k } = transform;
    const rankLimit = getLabelRankLimit(k);
    const popThreshold = getPopulationThreshold(k);
    const viewportPadding = 20;
    const viewportLeft = -viewportPadding;
    const viewportRight = STATE.width + viewportPadding;
    const viewportTop = -viewportPadding;
    const viewportBottom = STATE.height + viewportPadding;

    const visible = CITY_LABELS.filter(d => {
        if (!Number.isFinite(d.px) || !Number.isFinite(d.py)) return false;
        const sx = d.px * k + x;
        const sy = d.py * k + y;
        if (sx < viewportLeft || sx > viewportRight || sy < viewportTop || sy > viewportBottom) return false;
        const rank = Number.isFinite(+d.labelrank) ? +d.labelrank : (Number.isFinite(+d.scalerank) ? +d.scalerank : 10);
        const isCapital = d.adm0cap === 1 || d.adm0cap === "1" || (d.featurecla || "").toLowerCase().includes("admin-0 capital");
        const isMega = d.megacity === 1 || d.megacity === "1" || d.worldcity === 1 || d.worldcity === "1";
        const pop = Number.isFinite(+d.pop) ? +d.pop : 0;
        if (isCapital || isMega) return true;
        if (popThreshold > 0 && pop < popThreshold) return false;
        return rank <= rankLimit;
    }).map(d => {
        const rank = Number.isFinite(+d.labelrank) ? +d.labelrank : (Number.isFinite(+d.scalerank) ? +d.scalerank : 10);
        const isCapital = d.adm0cap === 1 || d.adm0cap === "1" || (d.featurecla || "").toLowerCase().includes("admin-0 capital");
        const pop = Number.isFinite(+d.pop) ? +d.pop : 0;
        return { ...d, _rank: rank, _isCapital: isCapital, _pop: pop };
    });

    visible.sort((a, b) => {
        if (a._isCapital !== b._isCapital) return a._isCapital ? -1 : 1;
        if (b._pop !== a._pop) return b._pop - a._pop;
        if (a._rank !== b._rank) return a._rank - b._rank;
        return 0;
    });

    const gridSize = collision?.size ?? 140;
    const grid = collision?.grid ?? new Map();
    const addToGrid = (rect) => {
        const x0 = Math.floor(rect.x / gridSize);
        const x1 = Math.floor((rect.x + rect.w) / gridSize);
        const y0 = Math.floor(rect.y / gridSize);
        const y1 = Math.floor((rect.y + rect.h) / gridSize);
        for (let gx = x0; gx <= x1; gx++) {
            for (let gy = y0; gy <= y1; gy++) {
                const key = `${gx},${gy}`;
                if (!grid.has(key)) grid.set(key, []);
                grid.get(key).push(rect);
            }
        }
    };
    const collides = (rect) => {
        const x0 = Math.floor(rect.x / gridSize);
        const x1 = Math.floor((rect.x + rect.w) / gridSize);
        const y0 = Math.floor(rect.y / gridSize);
        const y1 = Math.floor((rect.y + rect.h) / gridSize);
        for (let gx = x0; gx <= x1; gx++) {
            for (let gy = y0; gy <= y1; gy++) {
                const key = `${gx},${gy}`;
                const bucket = grid.get(key);
                if (!bucket) continue;
                for (const other of bucket) {
                    if (
                        rect.x < other.x + other.w &&
                        rect.x + rect.w > other.x &&
                        rect.y < other.y + other.h &&
                        rect.y + rect.h > other.y
                    ) {
                        return true;
                    }
                }
            }
        }
        return false;
    };

    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.strokeStyle = CITY_LABEL_HALO;
    ctx.lineWidth = CITY_LABEL_HALO_WIDTH;
    ctx.lineJoin = "round";

    for (const d of visible) {
        const fontSize = getCityLabelFontSize(d._rank, k);
        ctx.font = `${fontSize}px ${UI_FONT_FAMILY}`;
        const label = d.name;
        if (!label) continue;
        const isCapital = d._isCapital;
        ctx.fillStyle = isCapital ? CITY_LABEL_CAPITAL_COLOR : CITY_LABEL_NON_CAPITAL_COLOR;
        const sx = d.px * k + x;
        const sy = d.py * k + y;
        const textWidth = ctx.measureText(label).width;
        const rect = {
            x: sx - (textWidth / 2) + CITY_LABEL_OFFSET_X - CITY_LABEL_PADDING,
            y: sy - (fontSize / 2) + CITY_LABEL_OFFSET_Y - CITY_LABEL_PADDING,
            w: textWidth + CITY_LABEL_PADDING * 2,
            h: fontSize + CITY_LABEL_PADDING * 2
        };
        if (rect.x < viewportLeft || rect.x + rect.w > viewportRight ||
            rect.y < viewportTop || rect.y + rect.h > viewportBottom) {
            continue;
        }
        if (collides(rect)) continue;
        addToGrid(rect);
        const textX = sx + CITY_LABEL_OFFSET_X;
        const textY = sy + CITY_LABEL_OFFSET_Y;
        ctx.strokeText(label, textX, textY);
        ctx.fillText(label, textX, textY);
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
}

function getCountryLabelRankLimit(k) {
    if (k < 0.9) return 2;
    if (k < 1.3) return 2;
    if (k < 2.0) return 3;
    return 5;
}

function drawCountryLabels(transform = STATE.zoomTransform, collision = null) {
    if (!showCountryLabels || !COUNTRIES?.features || !STATE.projection) return;
    ctx.setTransform(CANVAS_DPR, 0, 0, CANVAS_DPR, 0, 0);
    updateCountryLabelPoints();

    const { x, y, k } = transform;
    const rankLimit = getCountryLabelRankLimit(k);
    const viewportPadding = 20;
    const viewportLeft = -viewportPadding;
    const viewportRight = STATE.width + viewportPadding;
    const viewportTop = -viewportPadding;
    const viewportBottom = STATE.height + viewportPadding;

    const visible = COUNTRIES.features.map(f => {
        const props = f.properties || {};
        const rank = Number.isFinite(+props.LABELRANK) ? +props.LABELRANK
            : (Number.isFinite(+props.scalerank) ? +props.scalerank : 10);
        const pop = Number.isFinite(+props.POP_EST) ? +props.POP_EST : 0;
        const label = props.ADMIN || props.NAME || props.SOVEREIGNT || "";
        return { f, label, rank, pop };
    }).filter(d => {
        if (!d.label || !Array.isArray(d.f._labelPoint)) return false;
        if (d.rank > rankLimit) return false;
        const [px, py] = d.f._labelPoint;
        if (!Number.isFinite(px) || !Number.isFinite(py)) return false;
        const sx = px * k + x;
        const sy = py * k + y;
        if (sx < viewportLeft || sx > viewportRight || sy < viewportTop || sy > viewportBottom) return false;
        return true;
    });

    visible.sort((a, b) => {
        if (a.rank !== b.rank) return a.rank - b.rank;
        return b.pop - a.pop;
    });

    const gridSize = collision?.size ?? 180;
    const grid = collision?.grid ?? new Map();
    const addToGrid = (rect) => {
        const x0 = Math.floor(rect.x / gridSize);
        const x1 = Math.floor((rect.x + rect.w) / gridSize);
        const y0 = Math.floor(rect.y / gridSize);
        const y1 = Math.floor((rect.y + rect.h) / gridSize);
        for (let gx = x0; gx <= x1; gx++) {
            for (let gy = y0; gy <= y1; gy++) {
                const key = `${gx},${gy}`;
                if (!grid.has(key)) grid.set(key, []);
                grid.get(key).push(rect);
            }
        }
    };
    const collides = (rect) => {
        const x0 = Math.floor(rect.x / gridSize);
        const x1 = Math.floor((rect.x + rect.w) / gridSize);
        const y0 = Math.floor(rect.y / gridSize);
        const y1 = Math.floor((rect.y + rect.h) / gridSize);
        for (let gx = x0; gx <= x1; gx++) {
            for (let gy = y0; gy <= y1; gy++) {
                const key = `${gx},${gy}`;
                const bucket = grid.get(key);
                if (!bucket) continue;
                for (const other of bucket) {
                    if (
                        rect.x < other.x + other.w &&
                        rect.x + rect.w > other.x &&
                        rect.y < other.y + other.h &&
                        rect.y + rect.h > other.y
                    ) {
                        return true;
                    }
                }
            }
        }
        return false;
    };

    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = COUNTRY_LABEL_COLOR;
    ctx.strokeStyle = COUNTRY_LABEL_HALO;
    ctx.lineWidth = COUNTRY_LABEL_HALO_WIDTH;
    ctx.lineJoin = "round";

    const fontSize = 10 * Math.max(0.9, Math.min(1.1, Math.pow(k, 0.1)));
    ctx.font = `${fontSize}px ${UI_FONT_FAMILY}`;

    for (const d of visible) {
        const [px, py] = d.f._labelPoint;
        const sx = px * k + x;
        const sy = py * k + y;
        const labelText = d.label.toUpperCase();
        const textWidth = ctx.measureText(labelText).width;
        const rect = {
            x: sx - (textWidth / 2) - COUNTRY_LABEL_PADDING,
            y: sy - (fontSize / 2) - COUNTRY_LABEL_PADDING,
            w: textWidth + COUNTRY_LABEL_PADDING * 2,
            h: fontSize + COUNTRY_LABEL_PADDING * 2
        };
        if (collides(rect)) continue;
        addToGrid(rect);
        ctx.strokeText(labelText, sx, sy);
        ctx.fillText(labelText, sx, sy);
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
}

/* =========================================================
   Color and value helpers
   ========================================================= */

// Helpers (adjustColor, tempToR, precipToR) are imported from ./shared.js


/* =========================================================
   Glyph rendering
   ========================================================= */

// Draw a station's precipitation and temperature glyph at projected position (fill + outline + January line)
// lockedType: null (not locked) or kg_type string (locked to this type)
function drawGlyphOnContext(drawCtx, d, transform, lockedType = null, hoveredType = null) {
    // Quickly determine if this glyph should be faded
    // Priority: locked > hovered (if not locked) > none
    let glyphAlpha = 1.0;
    const highlightType = lockedType !== null ? lockedType : hoveredType;
    if (highlightType !== null && d.kg_type !== highlightType) {
        glyphAlpha = 0.2;
    }

    const { x, y, k } = transform;
    const x0 = d.px;
    const y0 = d.py;
    if (!Number.isFinite(x0) || !Number.isFinite(y0)) return;

    const cx = x0 * k + x;
    const cy = y0 * k + y;

    const R_BASE = STATE.symbolRadius * DENSITY_FACTOR * k;
    const R_PRECIP = R_BASE * PRECIP_RADIUS_SCALE;
    const glyphLineWidth = getGlyphLineWidth(R_BASE);
    const tempR12 = d.tempR12 || d.t.map(v => tempToR(v));
    const precipR12 = d.precipR12 || d.p.map(v => precipToR(v));
    const precipFill = d.glyphPrecipFill || adjustColor(d.baseColor, PRECIP_SAT_FACTOR, PRECIP_L_FACTOR);
    const tempFill = d.glyphTempFill || adjustColor(d.baseColor, TEMP_FILL_SAT_FACTOR, TEMP_FILL_L_FACTOR);
    const tempStroke = d.glyphTempStroke || adjustColor(d.baseColor, TEMP_LINE_SAT_FACTOR, TEMP_LINE_L_FACTOR);

    drawCtx.save();
    drawCtx.translate(cx, cy);

    // Precip ring
    drawCtx.beginPath();
    for (let i = 0; i < GLYPH_ANGLE_COUNT; i++) {
        const r = precipR12[i] * R_PRECIP;
        drawCtx.lineTo(GLYPH_SIN[i] * r, -GLYPH_COS[i] * r);
    }
    drawCtx.closePath();
    drawCtx.fillStyle = precipFill;
    drawCtx.globalAlpha = PRECIP_ALPHA * glyphAlpha;
    drawCtx.fill();

    // Temp fill
    drawCtx.beginPath();
    for (let i = 0; i < GLYPH_ANGLE_COUNT; i++) {
        const r = tempR12[i] * R_BASE;
        drawCtx.lineTo(GLYPH_SIN[i] * r, -GLYPH_COS[i] * r);
    }
    drawCtx.closePath();
    drawCtx.fillStyle = tempFill;
    drawCtx.globalAlpha = TEMP_FILL_ALPHA * glyphAlpha;
    drawCtx.fill();

    // Temp outline
    drawCtx.beginPath();
    for (let i = 0; i < GLYPH_ANGLE_COUNT; i++) {
        const r = tempR12[i] * R_BASE;
        drawCtx.lineTo(GLYPH_SIN[i] * r, -GLYPH_COS[i] * r);
    }
    drawCtx.closePath();
    drawCtx.strokeStyle = tempStroke;
    drawCtx.globalAlpha = TEMP_LINE_ALPHA * glyphAlpha;
    drawCtx.lineWidth = glyphLineWidth;
    drawCtx.stroke();

    // Jan line
    const janR = tempR12[0] * R_BASE;
    drawCtx.beginPath();
    drawCtx.moveTo(0, 0);
    drawCtx.lineTo(0, -janR);
    drawCtx.lineWidth = glyphLineWidth;
    drawCtx.globalAlpha = JAN_LINE_ALPHA * glyphAlpha;
    drawCtx.stroke();

    drawCtx.restore();
}

// Batch render all points with optimized opacity handling and performance
function drawPointsBatchOnContext(drawCtx, transform, lockedType = null, hoveredType = null) {
    if (!STATE.data || !STATE.data.length) return;

    const { x, y, k } = transform;
    const locked = lockedType !== null;
    const pointRadius = STATE.symbolRadius * DENSITY_FACTOR * k * 0.8;
    
    // Skip rendering if points are too small to see
    if (pointRadius < MIN_POINT_RENDER_RADIUS) return;

    // Compute viewport bounds to skip off-screen points
    const viewportPadding = pointRadius + 2;
    const viewportLeft = -viewportPadding - x / k;
    const viewportRight = (STATE.width - x) / k + viewportPadding;
    const viewportTop = -viewportPadding - y / k;
    const viewportBottom = (STATE.height - y) / k + viewportPadding;

    STATE.data.forEach(d => {
        const x0 = d.px;
        const y0 = d.py;
        if (!Number.isFinite(x0) || !Number.isFinite(y0)) return;
        // Quick viewport check in projected coordinates (before transform)
        if (x0 < viewportLeft || x0 > viewportRight || 
            y0 < viewportTop || y0 > viewportBottom) {
            return; // Skip this point, it's off-screen
        }

        const cx = x0 * k + x;
        const cy = y0 * k + y;

        // Set opacity based on lock state or hover state
        let pointAlpha = 0.6;
        
        // In point mode: apply transparency effect on hover (like Lock behavior)
        if (hoveredType && !locked) {
            // Hover effect: same type stays full opacity, others become semi-transparent
            pointAlpha = d.kg_type !== hoveredType ? 0.1 : 0.6;
        } else if (locked && lockedType) {
            // Lock effect: same type full opacity, others become semi-transparent
            pointAlpha = d.kg_type !== lockedType ? 0.1 : 0.6;
        }
        
        drawCtx.globalAlpha = pointAlpha;

        // Draw point with map-specific temperature color (lighter than chart tempColor).
        drawCtx.beginPath();
        drawCtx.arc(cx, cy, pointRadius, 0, 2 * Math.PI);
        drawCtx.fillStyle = tempColorForMapPoint(d.baseColor);
        drawCtx.fill();
    });
    
    // Reset global alpha
    drawCtx.globalAlpha = 1.0;
}

function drawGlyphsBatchOnContext(drawCtx, transform, lockedType = null, hoveredType = null) {
    if (!STATE.data || !STATE.data.length) return;
    const { x, y, k } = transform;
    const maxGlyphRadius = STATE.symbolRadius * DENSITY_FACTOR * PRECIP_RADIUS_SCALE * k;
    if (maxGlyphRadius < MIN_GLYPH_RENDER_RADIUS) return;

    const viewportPadding = maxGlyphRadius + 2;
    const viewportLeft = -viewportPadding - x / k;
    const viewportRight = (STATE.width - x) / k + viewportPadding;
    const viewportTop = -viewportPadding - y / k;
    const viewportBottom = (STATE.height - y) / k + viewportPadding;

    STATE.data.forEach(d => {
        const x0 = d.px;
        const y0 = d.py;
        if (!Number.isFinite(x0) || !Number.isFinite(y0)) return;
        if (x0 < viewportLeft || x0 > viewportRight || y0 < viewportTop || y0 > viewportBottom) return;
        drawGlyphOnContext(drawCtx, d, transform, lockedType, hoveredType);
    });
}

/* =========================================================
   Redraw, zoom, and initialization
   ========================================================= */

// Lightweight redraw: base map is drawn on canvas; hover highlight is handled by SVG overlay to avoid full canvas redraws for hover only
const LABEL_RIGHT_PADDING = 8;
const LABEL_BOTTOM_OFFSET = 16;

function buildAxisLabelSpecs(width, height, zoomTransform) {
    // Early return if neither layer is enabled
    if (!showGraticules && !showGeoLines) {
        return { latLabels: [], lonLabels: [] };
    }

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
        for (let lon = -180; lon <= 180; lon += lonStep) {
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
        }
    }

    return { latLabels, lonLabels };
}

function renderAxisLabelSpecs(ctx, specs, fontSize, scale = 1) {
    ctx.font = `${fontSize}px ${UI_FONT_FAMILY}`;
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

function drawAxisLabels(transform = STATE.zoomTransform) {
    if (!STATE.projection) return;
    // Skip if neither graticules nor geographic lines are visible
    if (!showGraticules && !showGeoLines) return;
    ctx.save();
    ctx.setTransform(CANVAS_DPR, 0, 0, CANVAS_DPR, 0, 0);
    const specs = buildAxisLabelSpecs(STATE.width, STATE.height, transform);
    renderAxisLabelSpecs(ctx, specs, 11);
    ctx.restore();
}

export function drawAxisLabelsForExport(targetCtx, overlayScale, fontSize = 26, showLabels = true) {
    if (!STATE.projection || !showLabels) return;
    // Skip if neither graticules nor geographic lines are visible
    if (!showGraticules && !showGeoLines) return;
    const specs = buildAxisLabelSpecs(STATE.width, STATE.height, STATE.zoomTransform);
    targetCtx.save();
    targetCtx.setTransform(CANVAS_DPR, 0, 0, CANVAS_DPR, 0, 0);
    renderAxisLabelSpecs(targetCtx, specs, fontSize, overlayScale);
    targetCtx.restore();
}

function ensureBaseLayerCaches(transform = STATE.zoomTransform, options = { ocean: true, countries: true }) {
    initCaches();
    resizeCaches();
    if (showOcean && options.ocean && !hasOceanCache(transform)) {
        generateOceanCache(transform);
    }
    if (showBorders && options.countries && !hasCountriesCache(transform)) {
        generateCountriesCache(transform);
    }
}

function scheduleMapBusyLoadingOverlay() {
    if (mapBusyLoadingVisible || mapBusyLoadingTimer) return;
    mapBusyLoadingTimer = setTimeout(() => {
        mapBusyLoadingTimer = null;
        if (!pendingRefineJob) return;
        showLoading("Loading map...");
        mapBusyLoadingVisible = true;
    }, MAP_BUSY_LOADING_DELAY_MS);
}

function clearMapBusyLoadingOverlay() {
    if (mapBusyLoadingTimer) {
        clearTimeout(mapBusyLoadingTimer);
        mapBusyLoadingTimer = null;
    }
    if (mapBusyLoadingVisible) {
        hideLoading();
        mapBusyLoadingVisible = false;
    }
}

function cancelRefineJob() {
    if (refineStartDelayTimer) {
        clearTimeout(refineStartDelayTimer);
        refineStartDelayTimer = null;
    }
    if (pendingRefineJob) {
        pendingRefineJob.cancelled = true;
        if (pendingRefineJob.rafId) cancelAnimationFrame(pendingRefineJob.rafId);
        if (pendingRefineJob.idleId) {
            if (typeof cancelIdleCallback === "function") cancelIdleCallback(pendingRefineJob.idleId);
            else clearTimeout(pendingRefineJob.idleId);
        }
        pendingRefineJob = null;
    }
    clearMapBusyLoadingOverlay();
}

function scheduleRefineJobWithDelay(epoch) {
    if (refineStartDelayTimer) {
        clearTimeout(refineStartDelayTimer);
        refineStartDelayTimer = null;
    }
    refineStartDelayTimer = setTimeout(() => {
        refineStartDelayTimer = null;
        if (isZooming) return;
        if (epoch !== renderEpoch) return;
        startRefineJob(epoch);
    }, REFINE_START_DELAY_MS);
}

function scheduleRefineStep(job, fn) {
    const run = () => {
        job.idleId = null;
        if (job.cancelled || job.epoch !== renderEpoch) return;
        fn();
    };
    if (typeof requestIdleCallback === "function") {
        job.idleId = requestIdleCallback(run, { timeout: 120 });
    } else {
        job.idleId = setTimeout(run, 0);
    }
}

function composeFrameFromCaches({ transform = STATE.zoomTransform, drawLabels = true, drawMarkers = true } = {}) {
    if (!hasRenderableMapFrame()) {
        drawMapBackground(transform);
        return;
    }
    drawMapBackground(transform);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (showOcean && oceanCache && hasOceanCache(transform)) {
        ctx.drawImage(oceanCache, 0, 0);
    }
    if (showBorders && countriesCache && hasCountriesCache(transform)) {
        ctx.drawImage(countriesCache, 0, 0);
    }
    drawMapContentFrame(transform);
    // Graticules/geographic lines expect DPR transform space.
    ctx.setTransform(CANVAS_DPR, 0, 0, CANVAS_DPR, 0, 0);
    if (showGraticules) drawGraticules(transform);
    if (showGeoLines) drawGeographicLines(transform);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (climateLayerCache) {
        ctx.drawImage(climateLayerCache, 0, 0);
    }
    const labelCollision = (showCityLabels || showCountryLabels) ? { grid: new Map(), size: 160 } : null;
    drawCountryLabels(transform, labelCollision);
    drawCityLabels(transform, labelCollision);
    if (drawLabels && (showGraticules || showGeoLines)) {
        drawAxisLabels(transform);
    }
    if (drawMarkers) {
        updateHoverCircle();
        updateSearchMarker();
    }
}

function redrawFastPostInteraction() {
    endInteractionBitmapMode();
    if (!hasRenderableMapFrame()) {
        drawMapBackground();
        return;
    }
    const transform = makeTransformSnapshot();
    const { locked, data: lockedData } = getLockState();
    const lockedType = locked ? (lockedData ? lockedData.kg_type : null) : null;
    const hoveredType = hoveredDatum ? hoveredDatum.kg_type : null;
    initCaches();
    resizeCaches();
    drawClimateLayerToCache(transform, lockedType, hoveredType);
    composeFrameFromCaches({ transform, drawLabels: false, drawMarkers: true });
}

function startRefineJob(epoch) {
    cancelRefineJob();
    if (!hasRenderableMapFrame()) return;
    const job = {
        epoch,
        cancelled: false,
        transform: makeTransformSnapshot(),
        step: 0,
        rafId: null,
        idleId: null
    };
    pendingRefineJob = job;
    scheduleMapBusyLoadingOverlay();

    const runStep = () => {
        if (job.cancelled || job.epoch !== renderEpoch) return;
        const transform = job.transform;
        if (job.step === 0) {
            ensureBaseLayerCaches(transform, { ocean: true, countries: false });
            composeFrameFromCaches({ transform, drawLabels: false, drawMarkers: true });
        } else if (job.step === 1) {
            ensureBaseLayerCaches(transform, { ocean: false, countries: true });
            composeFrameFromCaches({ transform, drawLabels: false, drawMarkers: true });
        } else {
            composeFrameFromCaches({ transform, drawLabels: true, drawMarkers: true });
            pendingRefineJob = null;
            clearMapBusyLoadingOverlay();
            return;
        }

        job.step += 1;
        job.rafId = requestAnimationFrame(() => {
            job.rafId = null;
            scheduleRefineStep(job, runStep);
        });
    };

    scheduleRefineStep(job, runStep);
}

// Redraw only glyphs/points (optimized for zoom/pan interactive performance)
function redrawGlyphsOnly() {
    if (!isZooming) {
        endInteractionBitmapMode();
    }
    if (!hasRenderableMapFrame()) {
        drawMapBackground();
        return;
    }
    initCaches();
    resizeCaches();
    const transform = makeTransformSnapshot();
    const { locked, data: lockedData } = getLockState();
    const lockedType = locked ? (lockedData ? lockedData.kg_type : null) : null;
    const hoveredType = hoveredDatum ? hoveredDatum.kg_type : null;
    drawClimateLayerToCache(transform, lockedType, hoveredType);
    drawMapBackground();
    drawMapContentFrame(transform);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (climateLayerCache) {
        ctx.drawImage(climateLayerCache, 0, 0);
    }
}

// Full redraw: all layers including base map
function redraw(skipAxisLabels = false) {
    cancelRefineJob();
    endInteractionBitmapMode();
    if (!hasRenderableMapFrame()) {
        drawMapBackground();
        clearMapBusyLoadingOverlay();
        return;
    }
    const transform = makeTransformSnapshot();
    const { locked, data: lockedData } = getLockState();
    const lockedType = locked ? (lockedData ? lockedData.kg_type : null) : null;
    const hoveredType = hoveredDatum ? hoveredDatum.kg_type : null;
    initCaches();
    resizeCaches();
    drawClimateLayerToCache(transform, lockedType, hoveredType);
    ensureBaseLayerCaches(transform, { ocean: true, countries: true });
    composeFrameFromCaches({ transform, drawLabels: !skipAxisLabels, drawMarkers: true });
    if (!isZooming && !pendingRefineJob) {
        clearMapBusyLoadingOverlay();
    }
}

// Redraw map without axis labels for export
function redrawMapForExport() {
    redraw(true);
}

// Export for use in export dialog
window.redrawMapForExport = redrawMapForExport;
// Allow restoring map layers after export
window.redrawMap = redraw;

// Helper: Calculate hover circle radius  
function calcHoverRadius() {
    const R_BASE = STATE.symbolRadius * DENSITY_FACTOR * STATE.zoomTransform.k;
    const R_PRECIP = R_BASE * PRECIP_RADIUS_SCALE;
    const outerR = Math.max(Math.max(R_PRECIP, R_BASE) * 1.35, MIN_HOVER_CIRCLE_RADIUS_PX);
    return { R_BASE, R_PRECIP, outerR };
}

// Helper: Project datum to screen coordinates
function projectDatumToScreen(datum) {
    if (!STATE.projection || !datum) return null;
    let x0 = datum.px;
    let y0 = datum.py;
    if (!Number.isFinite(x0) || !Number.isFinite(y0)) {
        [x0, y0] = STATE.projection([datum.lon, datum.lat]);
    }
    return {
        cx: x0 * STATE.zoomTransform.k + STATE.zoomTransform.x,
        cy: y0 * STATE.zoomTransform.k + STATE.zoomTransform.y
    };
}

function getMobileSheetTargetHeight() {
    const viewportHeight = window.visualViewport?.height || window.innerHeight || STATE.height;
    return Math.min(viewportHeight * 0.64, 600);
}

function getMobileSheetPeekHeight() {
    const rootStyles = getComputedStyle(document.documentElement);
    const rawValue = rootStyles.getPropertyValue("--sheet-peek-height").trim();
    const parsed = Number.parseFloat(rawValue);
    return Number.isFinite(parsed) ? parsed : 72;
}

function getMobileViewportBounds(sheetHeight) {
    const searchBox = document.getElementById("search-box");
    const optionsToggle = document.getElementById("map-options-toggle");
    const searchRect = searchBox?.getBoundingClientRect?.();
    const optionsRect = optionsToggle?.getBoundingClientRect?.();
    const topSafe = Math.max(
        Number.isFinite(searchRect?.bottom) ? searchRect.bottom + 16 : 72,
        Number.isFinite(optionsRect?.bottom) ? optionsRect.bottom + 16 : 72
    );
    const visibleBottom = Math.max(topSafe + 48, STATE.height - sheetHeight - 24);
    return { topSafe, visibleBottom };
}

function getHomeViewportBounds() {
    if (isMobileLayout()) {
        return getMobileViewportBounds(getMobileSheetPeekHeight());
    }
    return {
        topSafe: 0,
        visibleBottom: STATE.height
    };
}

function getMobileViewportFocusTarget() {
    const { topSafe, visibleBottom } = getMobileViewportBounds(getMobileSheetTargetHeight());
    const targetX = STATE.width / 2;
    const targetY = topSafe + (visibleBottom - topSafe) * 0.56;
    return { targetX, targetY, topSafe, visibleBottom };
}

function isPointComfortablyVisibleInMobileViewport(screenX, screenY, topSafe, visibleBottom) {
    return screenY >= topSafe + MOBILE_LOCK_FOCUS_VERTICAL_MARGIN_PX
        && screenY <= visibleBottom - MOBILE_LOCK_FOCUS_VERTICAL_MARGIN_PX
        && screenX >= MOBILE_LOCK_FOCUS_HORIZONTAL_MARGIN_PX
        && screenX <= STATE.width - MOBILE_LOCK_FOCUS_HORIZONTAL_MARGIN_PX;
}

function getMinimumScaleForFocusTarget(x0, y0, targetX, targetY) {
    const b = STATE.mapBounds;
    const maxZoomScale = getCurrentMaxZoomScale();
    if (!b || !Number.isFinite(x0) || !Number.isFinite(y0)) {
        return MIN_ZOOM_SCALE;
    }

    const { overscrollXBase, overscrollYBase } = getConstraintOverscrollBase();
    const leftCapacity = x0 - b.minX + overscrollXBase;
    const rightCapacity = b.maxX - x0 + overscrollXBase;
    const topCapacity = y0 - b.minY + overscrollYBase;
    const bottomCapacity = b.maxY - y0 + overscrollYBase;

    const minScaleLeft = leftCapacity > 0 ? targetX / leftCapacity : maxZoomScale;
    const minScaleRight = rightCapacity > 0 ? (STATE.width - targetX) / rightCapacity : maxZoomScale;
    const minScaleTop = topCapacity > 0 ? targetY / topCapacity : maxZoomScale;
    const minScaleBottom = bottomCapacity > 0 ? (STATE.height - targetY) / bottomCapacity : maxZoomScale;

    const minimumScale = Math.max(
        MIN_ZOOM_SCALE,
        minScaleLeft,
        minScaleRight,
        minScaleTop,
        minScaleBottom
    );
    return Number.isFinite(minimumScale)
        ? Math.min(maxZoomScale, minimumScale)
        : maxZoomScale;
}

function buildConstrainedDatumFocusTransform(x0, y0, scale, targetX, targetY) {
    const unconstrained = d3.zoomIdentity
        .translate(targetX - x0 * scale, targetY - y0 * scale)
        .scale(scale);
    const previousTransform = STATE.zoomTransform;
    STATE.zoomTransform = { x: unconstrained.x, y: unconstrained.y, k: unconstrained.k };
    constrainTransform();
    const constrained = cloneZoomTransform(STATE.zoomTransform);
    STATE.zoomTransform = previousTransform;
    return constrained;
}

function findMobileLockFocusTransform(x0, y0, targetX, targetY, topSafe, visibleBottom) {
    const currentScale = Math.max(STATE.zoomTransform.k || MIN_ZOOM_SCALE, MIN_ZOOM_SCALE);
    const maxZoomScale = getCurrentMaxZoomScale();
    const minimumFocusScale = getMinimumScaleForFocusTarget(x0, y0, targetX, targetY);
    const candidateScales = new Set([
        currentScale,
        homeZoomTransform?.k || MIN_ZOOM_SCALE,
        minimumFocusScale,
        Math.min(maxZoomScale, minimumFocusScale * 1.05)
    ]);

    MOBILE_LOCK_FOCUS_SCALE_CANDIDATES.forEach(scale => {
        if (scale >= currentScale && scale <= maxZoomScale) {
            candidateScales.add(scale);
        }
    });

    if (minimumFocusScale > MOBILE_LOCK_FOCUS_SCALE_CANDIDATES[MOBILE_LOCK_FOCUS_SCALE_CANDIDATES.length - 1]) {
        candidateScales.add(maxZoomScale);
    }

    const orderedScales = Array.from(candidateScales)
        .filter(scale => Number.isFinite(scale) && scale >= currentScale && scale <= maxZoomScale)
        .sort((a, b) => a - b);

    let fallbackTransform = cloneZoomTransform(STATE.zoomTransform);

    for (const scale of orderedScales) {
        const transform = buildConstrainedDatumFocusTransform(x0, y0, scale, targetX, targetY);
        const screenX = x0 * transform.k + transform.x;
        const screenY = y0 * transform.k + transform.y;
        if (isPointComfortablyVisibleInMobileViewport(screenX, screenY, topSafe, visibleBottom)) {
            return transform;
        }
        fallbackTransform = transform;
    }

    return fallbackTransform;
}

function focusLockedDatumInMobileViewport(datum) {
    if (!isMobileLayout() || !datum || !STATE.projection) return;

    let x0 = datum.px;
    let y0 = datum.py;
    if (!Number.isFinite(x0) || !Number.isFinite(y0)) {
        [x0, y0] = STATE.projection([datum.lon, datum.lat]);
    }
    if (!Number.isFinite(x0) || !Number.isFinite(y0)) return;

    const { targetX, targetY, topSafe, visibleBottom } = getMobileViewportFocusTarget();
    const currentX = x0 * STATE.zoomTransform.k + STATE.zoomTransform.x;
    const currentY = y0 * STATE.zoomTransform.k + STATE.zoomTransform.y;
    const comfortablyVisible = isPointComfortablyVisibleInMobileViewport(currentX, currentY, topSafe, visibleBottom);
    const deltaX = targetX - currentX;
    const deltaY = targetY - currentY;
    if (comfortablyVisible && Math.abs(deltaX) < 20 && Math.abs(deltaY) < 20) {
        return;
    }

    const constrained = findMobileLockFocusTransform(x0, y0, targetX, targetY, topSafe, visibleBottom);

    overlay.interrupt();
    overlay
        .transition()
        .duration(280)
        .ease(d3.easeCubicOut)
        .call(zoomBehavior.transform, constrained);
}

function scheduleMobileLockFocus(datum) {
    if (pendingMobileLockFocusRaf) {
        cancelAnimationFrame(pendingMobileLockFocusRaf);
        pendingMobileLockFocusRaf = null;
    }
    if (!isMobileLayout() || !datum) return;

    pendingMobileLockFocusRaf = requestAnimationFrame(() => {
        pendingMobileLockFocusRaf = null;
        focusLockedDatumInMobileViewport(datum);
    });
}

function clearHoverHighlight() {
    hoverShadowCircle.interrupt().attr("r", 0);
    hoverGlowCircle.interrupt().attr("r", 0);
    hoverCircle.interrupt().attr("r", 0);
    hoverLayer.style("display", "none");
}

function renderHoverHighlight(datum) {
    if (!datum || !STATE.projection) {
        clearHoverHighlight();
        return;
    }

    const pos = projectDatumToScreen(datum);
    if (!pos) {
        clearHoverHighlight();
        return;
    }

    const { outerR } = calcHoverRadius();
    const radius = outerR * 0.75;
    const ringColor = adjustColor(datum.baseColor, 1, 0.4);
    const { coreWidth, glowWidth, shadowWidth } = getHoverStrokeWidths(radius);

    hoverLayer.style("display", null);

    hoverShadowCircle
        .interrupt()
        .attr("cx", pos.cx)
        .attr("cy", pos.cy + HOVER_RING_SHADOW_OFFSET_Y)
        .attr("r", radius)
        .attr("stroke-width", shadowWidth);

    hoverGlowCircle
        .interrupt()
        .attr("cx", pos.cx)
        .attr("cy", pos.cy)
        .attr("r", radius)
        .attr("stroke", ringColor)
        .attr("stroke-width", glowWidth);

    hoverCircle
        .interrupt()
        .attr("cx", pos.cx)
        .attr("cy", pos.cy)
        .attr("r", radius)
        .attr("stroke", ringColor)
        .attr("stroke-width", coreWidth);
}

// Update hover circle position based on current transform
function updateHoverCircle() {
    if (!STATE.projection) return;

    const { locked, data: lockedData } = getLockState();
    const datum = locked ? lockedData : hoveredDatum;
    if (!datum) {
        clearHoverHighlight();
        return;
    }

    renderHoverHighlight(datum);
}

function updateSearchMarker() {
    if (!STATE.projection || !searchMarker || !searchPoint) {
        hideSearchResultVisual();
        return;
    }

    // searchPoint: the searched location (search result location)
    const [sx0, sy0] = STATE.projection([searchPoint.lon, searchPoint.lat]);
    const sx = sx0 * STATE.zoomTransform.k + STATE.zoomTransform.x;
    const sy = sy0 * STATE.zoomTransform.k + STATE.zoomTransform.y;

    // searchMarker: nearest climate data point (climate data point to avoid)
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
    const fontSize = 12;
    const lineHeight = 1.2;
    
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

// Attach zoom handlers with bitmap-fast interaction and staged refine after interaction ends.
let zoomRaf = null;
let zoomEndRaf = null;
let isZooming = false;
let scheduleFullRedraw = false;
const MIN_ZOOM_SCALE = 1;
const TRANSFORM_EPSILON = 1e-6;
let homeZoomTransform = d3.zoomIdentity;

function isNearValue(value, target, epsilon = TRANSFORM_EPSILON) {
    return Math.abs(value - target) <= epsilon;
}

function cloneZoomTransform(transform = d3.zoomIdentity) {
    const x = Number.isFinite(transform?.x) ? transform.x : 0;
    const y = Number.isFinite(transform?.y) ? transform.y : 0;
    const k = Number.isFinite(transform?.k) ? transform.k : MIN_ZOOM_SCALE;
    return d3.zoomIdentity.translate(x, y).scale(k);
}

function syncZoomTransform(transform = STATE.zoomTransform) {
    STATE.zoomTransform = cloneZoomTransform(transform);
    const overlayElement = overlay.node();
    if (overlayElement) {
        overlayElement.__zoom = STATE.zoomTransform;
    }
}

function computeHomeZoomTransform() {
    if (!hasRenderableMapFrame()) {
        return d3.zoomIdentity;
    }
    const maxZoomScale = getCurrentMaxZoomScale();

    const b = getRenderableMapExtent();
    const contentWidth = b.maxX - b.minX;
    const contentHeight = b.maxY - b.minY;
    if (!(contentWidth > 0 && contentHeight > 0)) {
        return d3.zoomIdentity;
    }

    const { topSafe, visibleBottom } = getHomeViewportBounds();
    const visibleWidth = STATE.width;
    const visibleHeight = visibleBottom - topSafe;
    if (!(visibleWidth > 0 && visibleHeight > 0)) {
        return d3.zoomIdentity;
    }

    const scale = Math.max(
        MIN_ZOOM_SCALE,
        Math.min(
            maxZoomScale,
            Math.max(visibleWidth / contentWidth, visibleHeight / contentHeight)
        )
    );
    const centerX = (b.minX + b.maxX) / 2;
    const centerY = (b.minY + b.maxY) / 2;
    const candidate = d3.zoomIdentity
        .translate(
            visibleWidth / 2 - centerX * scale,
            topSafe + visibleHeight / 2 - centerY * scale
        )
        .scale(scale);

    const previousTransform = STATE.zoomTransform;
    STATE.zoomTransform = { x: candidate.x, y: candidate.y, k: candidate.k };
    constrainTransform();
    const constrained = cloneZoomTransform(STATE.zoomTransform);
    STATE.zoomTransform = previousTransform;
    return constrained;
}

function isHomeTransform(transform = STATE.zoomTransform) {
    return isNearValue(transform?.k ?? MIN_ZOOM_SCALE, homeZoomTransform?.k ?? MIN_ZOOM_SCALE)
        && isNearValue(transform?.x ?? 0, homeZoomTransform?.x ?? 0)
        && isNearValue(transform?.y ?? 0, homeZoomTransform?.y ?? 0);
}

function setZoomButtonDisabled(button, disabled) {
    if (!button) return;
    button.disabled = disabled;
    button.setAttribute("aria-disabled", String(disabled));
}

function updateZoomControlState(transform = STATE.zoomTransform) {
    const scale = transform?.k ?? MIN_ZOOM_SCALE;
    const maxZoomScale = getCurrentMaxZoomScale();
    setZoomButtonDisabled(zoomInBtn, scale >= maxZoomScale - TRANSFORM_EPSILON);
    setZoomButtonDisabled(zoomOutBtn, scale <= MIN_ZOOM_SCALE + TRANSFORM_EPSILON);
    setZoomButtonDisabled(zoomResetBtn, isHomeTransform(transform));
}

const zoomBehavior = d3.zoom()
    .scaleExtent([MIN_ZOOM_SCALE, getCurrentMaxZoomScale()])
    .on("zoom", e => {
        cancelRefineJob();
        if (zoomEndRaf) {
            cancelAnimationFrame(zoomEndRaf);
            zoomEndRaf = null;
        }
        STATE.zoomTransform = e.transform;
        maybeAutoSwitchToGlyph(STATE.zoomTransform);
        updateZoomControlState(STATE.zoomTransform);
        isZooming = true;
        scheduleFullRedraw = true;

        if (symbolStyle === "glyph" && !isInteractingBitmapMode) {
            beginInteractionBitmapMode();
        }
        hoverLayer.style("display", "none");
        searchLayer.style("display", "none");
        
        if (zoomRaf) return;
        zoomRaf = requestAnimationFrame(() => {
            zoomRaf = null;
            constrainTransform();
            updateZoomControlState();
            // During active zoom in glyph mode: transform snapshot bitmap for smooth interaction
            if (symbolStyle === "glyph" && isInteractingBitmapMode && drawInteractionBitmap()) {
                return;
            }
            // Point mode fallback keeps lightweight redraw behavior
            redrawGlyphsOnly();
        });
    })
    .on("end", () => {
        // After zoom ends: fast redraw first, then progressively refine base layers.
        isZooming = false;
        endInteractionBitmapMode();
        if (scheduleFullRedraw) {
            scheduleFullRedraw = false;
            if (zoomEndRaf) {
                cancelAnimationFrame(zoomEndRaf);
                zoomEndRaf = null;
            }
            zoomEndRaf = requestAnimationFrame(() => {
                zoomEndRaf = null;
                if (isZooming) return;
                constrainTransform();
                updateZoomControlState();
                renderEpoch += 1;
                const epoch = renderEpoch;
                redrawFastPostInteraction();
                scheduleRefineJobWithDelay(epoch);
            });
        } else if (!pendingRefineJob) {
            clearMapBusyLoadingOverlay();
        }
    });

overlay.call(zoomBehavior);


// Hover and interaction handling
const overlayNode = overlay.node();

// SVG highlight elements (cheap to update on hover)
const hoverLayer = overlay.append('g').attr('class', 'hover-layer').style('pointer-events', 'none').style('display', 'none');
const hoverShadowCircle = hoverLayer.append('circle').attr('r', 0).attr('fill', 'none');
const hoverGlowCircle = hoverLayer.append('circle').attr('r', 0).attr('fill', 'none');
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

// Default hover circle styling
hoverShadowCircle
    .attr('stroke', 'rgba(12, 20, 28, 0.38)')
    .attr('opacity', HOVER_RING_SHADOW_OPACITY);
hoverGlowCircle
    .attr('stroke', '#ffffff')
    .attr('opacity', HOVER_RING_GLOW_OPACITY);
hoverCircle
    .attr('stroke', '#ffffff')
    .attr('opacity', 0.97);

let searchMarker = null;
let searchPoint = null; // Store the search input location for relative positioning

function showGlyphAutoSwitchToast() {
    const mapWrapperNode = document.getElementById("map-wrapper");
    if (!mapWrapperNode) {
        return;
    }

    if (isMobileLayout()) {
        setMobileOptionsOpen(false);
        setMobileSheetOpen(false);
    }

    let toast = document.getElementById("glyph-auto-switch-toast");
    if (!toast) {
        toast = document.createElement("div");
        toast.id = "glyph-auto-switch-toast";
        toast.className = "lock-toast glyph-toast";
        toast.innerHTML = [
            "<div class=\"glyph-toast-title\">Switched to Climate Glyph Mode</div>",
            "<div class=\"glyph-toast-meta\">",
            "<div><strong>Outline</strong> Temperature</div>",
            "<div><strong>Inner</strong> Precipitation</div>",
            "<div><strong>Order</strong> January at top (clockwise)</div>",
            "</div>",
            "<div class=\"glyph-toast-body\">To switch back, click Map Options (top right) &gt; Mode &gt; Point.</div>",
            "<button type=\"button\" class=\"lock-toast-btn glyph-toast-dismiss\">Got it</button>"
        ].join("");
        toast.querySelector(".glyph-toast-dismiss")?.addEventListener("click", (event) => {
            event.stopPropagation();
            toast.classList.remove("show");
        });
        mapWrapperNode.appendChild(toast);
    }

    toast.classList.add("show");
}

function setSymbolStyleProgrammatically(nextStyle) {
    if (!nextStyle || symbolStyle === nextStyle) {
        return false;
    }

    if (typeof window.setSymbolStyleSelection === "function") {
        return window.setSymbolStyleSelection(nextStyle);
    }

    const target = document.querySelector(`input[name="symbol-style"][value="${nextStyle}"]`);
    if (target) {
        target.checked = true;
    }
    dispatcher.call("symbolStyleChanged", null, nextStyle);
    return true;
}

function getRelativeZoomFromHome(transform = STATE.zoomTransform) {
    const currentScale = transform?.k ?? MIN_ZOOM_SCALE;
    const homeScale = homeZoomTransform?.k ?? MIN_ZOOM_SCALE;
    if (!(Number.isFinite(currentScale) && Number.isFinite(homeScale) && homeScale > 0)) {
        return null;
    }
    return currentScale / homeScale;
}

function maybeAutoSwitchToGlyph(transform) {
    const currentRelativeZoom = getRelativeZoomFromHome(transform);
    if (!Number.isFinite(currentRelativeZoom)) {
        return;
    }

    const crossedThreshold = previousGlyphAutoSwitchRelativeZoom <= GLYPH_AUTO_SWITCH_RELATIVE_THRESHOLD
        && currentRelativeZoom > GLYPH_AUTO_SWITCH_RELATIVE_THRESHOLD;
    previousGlyphAutoSwitchRelativeZoom = currentRelativeZoom;

    if (!crossedThreshold) {
        return;
    }
    if (STATE.hasAutoSwitchedGlyphThisSession) {
        return;
    }

    STATE.hasAutoSwitchedGlyphThisSession = true;
    if (symbolStyle === "glyph") {
        return;
    }

    const changed = setSymbolStyleProgrammatically("glyph");
    if (changed) {
        showGlyphAutoSwitchToast();
    }
}

// Respect lock/unlock events from chart: freeze or resume hover highlight
dispatcher.on('lock.map', d => {
    setPanelLocked(true, d || null);
    hoveredDatum = d || null;
    scheduleMobileLockFocus(d || null);

    renderHoverHighlight(d || null);
    // Set opacity for all points: same type 1, others 0.2
    if (d && window.d3 && d3.selectAll) {
        d3.selectAll('.glyph')
            .interrupt()
            .each(function(e) {
                const el = d3.select(this);
                if (e && e.kg_type === d.kg_type) {
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
    if (pendingMobileLockFocusRaf) {
        cancelAnimationFrame(pendingMobileLockFocusRaf);
        pendingMobileLockFocusRaf = null;
    }
    setPanelLocked(false, null);
    hoveredDatum = null;

    clearHoverHighlight();
    clearSearchResultState();
    overlayNode.style.cursor = 'default';
    
    // Force redraw to restore all glyphs
    if (typeof redraw === 'function') redraw();
})

dispatcher.on("layoutChanged.mapHover", () => {
    if (canUseHoverPreview()) return;

    hoveredDatum = null;
    dispatcher.call("hoverend", null);
    clearHoverHighlight();
    overlayNode.style.cursor = "default";
});

dispatcher.on("layoutChanged.mapSizing", () => {
    zoomBehavior.scaleExtent([MIN_ZOOM_SCALE, getCurrentMaxZoomScale()]);
    resize();
});

// Handle symbol style change (point vs glyph mode)
dispatcher.on('symbolStyleChanged.map', newStyle => {
    symbolStyle = newStyle;
    // Maintain current lock state while switching symbol style
    redraw();
});

// Track if a redraw is already scheduled
let hoverRedrawScheduled = false;

function onMouseMove(e) {
    if (!STATE.projection) return;
    if (!canUseHoverPreview()) return;

    const rect = overlay.node().getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;

    // Skip hover lookup and redraw during active zoom/pan to avoid frame contention.
    if (isZooming || isInteractingBitmapMode) return;

    // If panel is locked, keep highlight frozen
    const { locked } = getLockState();
    if (locked) return;

    // Use screen-space quadtree for fast nearest lookup
    const pixelRadius = getInteractionHitRadius();
    const nearest = findNearestScreen(sx, sy, pixelRadius);

    // Only update state when hover target changes
    if (nearest !== hoveredDatum) {
        hoveredDatum = nearest;
        if (nearest) {
            getCountryNameForDatum(nearest);
            dispatcher.call("hover", null, nearest);
            renderHoverHighlight(nearest);

            overlayNode.style.cursor = 'pointer';
            
            // Schedule redraw to update glyph/point opacity on hover
            if (!hoverRedrawScheduled) {
                hoverRedrawScheduled = true;
                requestAnimationFrame(() => {
                    hoverRedrawScheduled = false;
                    redraw();  // Full redraw including labels
                });
            }
        } else {
            dispatcher.call("hoverend", null);
            clearHoverHighlight();
            overlayNode.style.cursor = 'default';
            
            // Schedule redraw to restore full opacity on hover end
            if (!hoverRedrawScheduled) {
                hoverRedrawScheduled = true;
                requestAnimationFrame(() => {
                    hoverRedrawScheduled = false;
                    redraw();  // Full redraw including labels
                });
            }
        }
    }
}

function onMouseLeave() {
    if (!canUseHoverPreview()) return;

    // If the panel is locked, keep the highlight visible when the cursor leaves the overlay
    const { locked } = getLockState();
    if (locked) return;

    if (hoveredDatum !== null) {
        hoveredDatum = null;
        dispatcher.call("hoverend", null);
        clearHoverHighlight();
        overlayNode.style.cursor = 'default';
        
        // Schedule redraw to restore full opacity when leaving
        if (!hoverRedrawScheduled) {
            hoverRedrawScheduled = true;
            requestAnimationFrame(() => {
                hoverRedrawScheduled = false;
                redraw();  // Full redraw including labels
            });
        }
    }
}

/* =========================================================
   Location search functionality
   Uses Nominatim API for geocoding
   ========================================================= */

let searchTimeout;

function syncSearchClearButton(value) {
    if (!searchClearBtn) {
        return;
    }
    searchClearBtn.classList.toggle("show", !!value?.trim());
}

function hideSearchResultVisual() {
    searchLayer.style("display", "none");
}

function clearSearchResultState() {
    if (searchInput) {
        searchInput.value = "";
        searchInput.blur();
    }
    syncSearchClearButton("");
    searchSuggestions.classList.remove("show");
    searchPoint = null;
    searchMarker = null;
    hideSearchResultVisual();
}

function getFirstSearchSuggestionItem() {
    return searchSuggestions?.querySelector?.(".search-suggestion-item[data-lat][data-lon]") || null;
}

function openSearchSuggestionItem(item) {
    if (!item) {
        return false;
    }
    const lat = parseFloat(item.dataset.lat);
    const lon = parseFloat(item.dataset.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
        return false;
    }
    const label = item.textContent.trim();
    finalizeSearchSelection(lat, lon, label);
    return true;
}

function finalizeSearchSelection(lat, lon, label) {
    const nextLabel = (label || "Search result").trim();

    if (searchInput) {
        searchInput.value = nextLabel;
    }
    syncSearchClearButton(nextLabel);
    searchSuggestions.classList.remove("show");

    const runJump = () => {
        if (isMobileLayout() && searchInput) {
            searchInput.blur();
        }
        jumpToLocation(lat, lon, nextLabel);
    };

    if (!isMobileLayout()) {
        runJump();
        return;
    }

    if (searchInput) {
        searchInput.blur();
    }

    runAfterViewportSettles(runJump, {
        debounceMs: 150,
        maxWaitMs: 640,
        fallbackMs: 140
    });
}

async function searchLocations(query) {
    if (!query || query.length < 2) {
        searchSuggestions.classList.remove('show');
        return;
    }

    try {
        const response = await fetch(
            `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=8`
        );
        const results = await response.json();

        if (results.length === 0) {
            searchSuggestions.innerHTML = '<div class="search-suggestion-item">No results found</div>';
            searchSuggestions.classList.add('show');
            return;
        }

        searchSuggestions.innerHTML = results
            .map(result => `
                <div class="search-suggestion-item" data-lat="${result.lat}" data-lon="${result.lon}">
                    ${result.display_name || result.name}
                </div>
            `)
            .join('');

        searchSuggestions.classList.add('show');

        // Add click handlers to suggestions
        document.querySelectorAll('.search-suggestion-item[data-lat]').forEach(item => {
            item.addEventListener('click', () => {
                openSearchSuggestionItem(item);
            });
        });
    } catch (error) {
        console.error('Search error:', error);
        searchSuggestions.innerHTML = '<div class="search-suggestion-item">Search error</div>';
        searchSuggestions.classList.add('show');
    }
}

function jumpToLocation(lat, lon, label) {
    if (!STATE.projection) return;

    // Clamp latitude and longitude to valid ranges
    lat = Math.max(-90, Math.min(90, lat));
    lon = Math.max(-180, Math.min(180, lon));

    // Store the search input location for label positioning
    searchPoint = { lat, lon };

    const [x, y] = STATE.projection([lon, lat]);

    const { targetX: mobileTargetX, targetY: mobileTargetY } = isMobileLayout()
        ? getMobileViewportFocusTarget()
        : { targetX: STATE.width / 2, targetY: STATE.height / 2 };
    const minimumFocusScale = getMinimumScaleForFocusTarget(x, y, mobileTargetX, mobileTargetY);
    const targetZoom = Math.min(getCurrentMaxZoomScale(), Math.max(10, minimumFocusScale));

    // Pre-constrain the target transform so polar results can still land in the intended focus area.
    const newTransform = buildConstrainedDatumFocusTransform(x, y, targetZoom, mobileTargetX, mobileTargetY);
    
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

        if (nearest) {
            getCountryNameForDatum(nearest);
            dispatcher.call("searchSelect", null, nearest);
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
        .on("end", () => {
            lockNearest();
            // Cancel any pending RAF to prevent conflicts
            if (zoomRaf) {
                cancelAnimationFrame(zoomRaf);
                zoomRaf = null;
            }
            isZooming = false;
            scheduleFullRedraw = false;
            redraw();
        });
}

if (searchInput) {
    searchInput.addEventListener('input', (e) => {
        // Show/hide clear button based on input value
        syncSearchClearButton(e.target.value);
        
        clearTimeout(searchTimeout);
        searchTimeout = setTimeout(() => {
            searchLocations(e.target.value);
        }, 300);
    });

    searchInput.addEventListener("keydown", (e) => {
        if (e.key !== "Enter") {
            return;
        }
        const firstItem = getFirstSearchSuggestionItem();
        if (!firstItem) {
            return;
        }
        e.preventDefault();
        openSearchSuggestionItem(firstItem);
    });
    
    // Clear search function
    if (searchClearBtn) {
        searchClearBtn.addEventListener('click', () => {
            clearSearchResultState();
        });
    }

    document.addEventListener('click', (e) => {
        if (!e.target.closest('.search-container')) {
            searchSuggestions.classList.remove('show');
        }
    });
}

// Zoom control buttons
const zoomInBtn = document.getElementById('zoom-in');
const zoomOutBtn = document.getElementById('zoom-out');
const zoomResetBtn = document.getElementById('zoom-reset');

updateZoomControlState(d3.zoomIdentity);

if (zoomInBtn) {
    zoomInBtn.addEventListener('click', () => {
        if (zoomInBtn.disabled) return;
        const currentTransform = STATE.zoomTransform;
        const newScale = Math.min(currentTransform.k * 1.5, getCurrentMaxZoomScale());
        
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
        if (zoomOutBtn.disabled) return;
        const currentTransform = STATE.zoomTransform;
        const newScale = Math.max(currentTransform.k / 1.5, MIN_ZOOM_SCALE);
        
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
        if (zoomResetBtn.disabled) return;
        // Reset to the layout-specific home view.
        overlay.transition()
            .duration(600)
            .ease(d3.easeCubicOut)
            .call(zoomBehavior.transform, cloneZoomTransform(homeZoomTransform));
    });
}

// Helper: Setup toggle control that calls redraw on change
function setupToggleControl(element, onToggle) {
    if (element) {
        element.addEventListener('change', (e) => {
            onToggle(e.target.checked);
            redraw();
        });
    }
}

// Map display toggle controls
setupToggleControl(toggleOcean, (checked) => { 
    showOcean = checked; 
    invalidateCaches(); // Ocean cache needs update
});
setupToggleControl(toggleBorders, (checked) => { 
    showBorders = checked; 
    invalidateCaches(); // Countries cache needs update
});
setupToggleControl(toggleGraticules, (checked) => { showGraticules = checked; });
setupToggleControl(toggleGeoLines, (checked) => { showGeoLines = checked; });
setupToggleControl(toggleCityLabels, (checked) => { showCityLabels = checked; });
setupToggleControl(toggleCountryLabels, (checked) => { showCountryLabels = checked; });

export async function init() {
    showLoading("Loading map...");
    resize();
    STATE.data = await loadData();
    COUNTRIES = await loadCountries();
    OCEAN = await loadOcean();
    CITY_LABELS = await loadCityLabels();
    buildGlyphRenderCache();
    await new Promise(r => requestAnimationFrame(r));
    updateProjection();
    updateProjectedDataCache();
    updateProjectedCityLabelCache();
    computeSymbolRadius();
    computeMapBounds();
    computeMapExtent();
    homeZoomTransform = computeHomeZoomTransform();
    syncZoomTransform(homeZoomTransform);
    previousGlyphAutoSwitchRelativeZoom = getRelativeZoomFromHome() ?? 1;
    // Build quadtree for fast screen-space queries
    buildQuadtree();
    // Initialize caches
    initCaches();
    resizeCaches();
    resizeInteractionSnapshot();
    redraw();
    updateZoomControlState();

    // Register event listeners after initialization
    overlayNode.addEventListener("mousemove", onMouseMove);
    overlayNode.addEventListener("mouseleave", onMouseLeave);
    overlayNode.addEventListener("click", e => {
        if (!STATE.projection) return;

        const rect = overlay.node().getBoundingClientRect();
        const sx = e.clientX - rect.left;
        const sy = e.clientY - rect.top;
        const pixelRadius = getInteractionHitRadius();
        const d = findNearestScreen(sx, sy, pixelRadius);

        if (d) {
            getCountryNameForDatum(d);
        }
        dispatcher.call("select", null, d);
    });

    hideLoading();
    dispatcher.call("dataLoaded", null, STATE.data);
}
