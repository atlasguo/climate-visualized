/* =========================================================
   chart-common.js
   Shared constants, color helpers, and utility functions for all chart tabs
   ========================================================= */

import {
    dispatcher,
    STATE,
    adjustColor,
    isMobileLayout,
    canUseHoverPreview,
    supportsFinePointer
} from "./shared.js";

const OVERALL_MARGIN_DESKTOP = { top: 48, right: 32, bottom: 48, left: 42 };
const OVERALL_MARGIN_MOBILE = { top: 34, right: 30, bottom: 30, left: 34 };
const DETAIL_MONTHLY_MARGIN_DESKTOP = { top: 42, right: 20, bottom: 36, left: 44 };
const DETAIL_MONTHLY_MARGIN_MOBILE = { top: 34, right: 14, bottom: 30, left: 34 };
const DETAIL_SCATTER_MARGIN_DESKTOP = { top: 42, right: 24, bottom: 40, left: 44 };
const DETAIL_SCATTER_MARGIN_MOBILE = { top: 34, right: 16, bottom: 32, left: 36 };

const tooltip = d3.select("body")
    .append("div")
    .attr("class", "chart-tooltip")
    .style("position", "absolute")
    .style("visibility", "hidden")
    .style("background-color", "rgba(0, 0, 0, 0.8)")
    .style("color", "#ffffff")
    .style("padding", "6px 10px")
    .style("border-radius", "4px")
    .style("font-size", "12px")
    .style("pointer-events", "none")
    .style("z-index", "10000")
    .style("max-width", "min(260px, calc(100vw - 24px))");

const tooltipState = {
    pinned: false,
    sourceKey: null
};

function clampValue(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

function getEventPagePosition(event) {
    if (!event) {
        return { pageX: window.innerWidth / 2, pageY: window.innerHeight / 2 };
    }

    if (typeof event.pageX === "number" && typeof event.pageY === "number") {
        return { pageX: event.pageX, pageY: event.pageY };
    }

    if (typeof event.clientX === "number" && typeof event.clientY === "number") {
        return {
            pageX: event.clientX + window.scrollX,
            pageY: event.clientY + window.scrollY
        };
    }

    const targetRect = event.currentTarget?.getBoundingClientRect?.();
    if (targetRect) {
        return {
            pageX: targetRect.left + window.scrollX + targetRect.width / 2,
            pageY: targetRect.top + window.scrollY + targetRect.height / 2
        };
    }

    return { pageX: window.innerWidth / 2, pageY: window.innerHeight / 2 };
}

function positionTooltip(pageX, pageY) {
    const tooltipNode = tooltip.node();
    if (!tooltipNode) return;

    const tooltipWidth = tooltipNode.offsetWidth || 180;
    const tooltipHeight = tooltipNode.offsetHeight || 44;
    const maxLeft = window.scrollX + window.innerWidth - tooltipWidth - 12;
    const maxTop = window.scrollY + window.innerHeight - tooltipHeight - 12;
    const left = clampValue(pageX + 10, window.scrollX + 12, maxLeft);
    const top = clampValue(pageY - tooltipHeight - 10, window.scrollY + 12, maxTop);

    tooltip
        .style("left", `${left}px`)
        .style("top", `${top}px`);
}

export function clearTooltip() {
    tooltipState.pinned = false;
    tooltipState.sourceKey = null;
    tooltip.style("visibility", "hidden");
}

export function showTooltip(event, text, options = {}) {
    if (!text) return;

    const { pageX, pageY } = getEventPagePosition(event);
    tooltipState.pinned = !!options.pin;
    tooltipState.sourceKey = options.sourceKey || null;

    tooltip
        .style("visibility", "visible")
        .text(text);

    positionTooltip(pageX, pageY);
}

export function hideTooltip(force = false) {
    if (!force && tooltipState.pinned && isMobileLayout()) {
        return;
    }
    clearTooltip();
}

export function toggleTooltip(event, text, sourceKey) {
    if (!text) return;

    if (tooltipState.pinned && tooltipState.sourceKey === sourceKey) {
        clearTooltip();
        return;
    }

    showTooltip(event, text, { pin: true, sourceKey });
}

export function bindTooltipInteraction(selection, getText, sourcePrefix = "tooltip") {
    const resolveText = function(event, datum, index) {
        return typeof getText === "function"
            ? getText.call(this, event, datum, index)
            : getText;
    };

    selection.style("cursor", "pointer");

    if (supportsFinePointer()) {
        selection
            .on(`pointerenter.${sourcePrefix}`, function(event, datum) {
                const text = resolveText.call(this, event, datum);
                if (text) {
                    const sourceKey = `${sourcePrefix}-${datum?.kg_type || text}`;
                    showTooltip(event, text, { sourceKey });
                }
            })
            .on(`pointermove.${sourcePrefix}`, function(event, datum) {
                if (tooltipState.pinned) return;
                const text = resolveText.call(this, event, datum);
                if (text) {
                    const sourceKey = `${sourcePrefix}-${datum?.kg_type || text}`;
                    showTooltip(event, text, { sourceKey });
                }
            })
            .on(`pointerleave.${sourcePrefix}`, () => {
                hideTooltip(true);
            })
            .on(`click.${sourcePrefix}`, null);
    } else {
        selection
            .on(`pointerenter.${sourcePrefix}`, null)
            .on(`pointermove.${sourcePrefix}`, null)
            .on(`pointerleave.${sourcePrefix}`, null)
            .on(`click.${sourcePrefix}`, function(event, datum) {
                event.stopPropagation();
                const text = resolveText.call(this, event, datum);
                if (text) {
                    toggleTooltip(event, text, `${sourcePrefix}-${datum?.kg_type || text}`);
                }
            });
    }
}

document.addEventListener("click", () => {
    if (!supportsFinePointer()) {
        clearTooltip();
    }
});

// Initialize coordinate display on page load
function updateMobileSheetSummary(d) {
    const title = document.getElementById("mobile-sheet-title");
    const subtitle = document.getElementById("mobile-sheet-subtitle");
    if (!title || !subtitle) return;

    if (!d) {
        title.classList.add("mobile-sheet-title-empty");
        title.textContent = "Select or search a location to explore the climates.";
        subtitle.textContent = "";
        return;
    }

    title.classList.remove("mobile-sheet-title-empty");
    const latDir = d.lat >= 0 ? "N" : "S";
    const lonDir = d.lon >= 0 ? "E" : "W";
    const coordText = `${Math.abs(d.lat).toFixed(2)}° ${latDir}, ${Math.abs(d.lon).toFixed(2)}° ${lonDir}`;
    title.textContent = d.countryName || coordText;
    subtitle.textContent = d.kg_type ? `${d.kg_type} climate • ${coordText}` : coordText;
}

document.addEventListener("DOMContentLoaded", () => {
    const climateCoordLabel = document.getElementById("climate-coord");
    if (climateCoordLabel && climateCoordLabel.innerHTML.trim() === "") {
        updateCoordinateDisplay(null);
    }
});

/* =========================================================
   Export State Management
   Prevents concurrent export operations across all modules
   ========================================================= */
let isExporting = false;

export function getExportingState() {
    return isExporting;
}

export function setExportingState(value) {
    isExporting = value;
}

/* =========================================================
   Month names
   ========================================================= */
export const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const MONTH_FULL = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/* =========================================================
   Koppen classification dictionaries
   ========================================================= */
export const KOPPEN_MAIN = {
    A: "Tropical",
    B: "Arid",
    C: "Temperate",
    D: "Cold",
    E: "Polar"
};

export const KOPPEN_PRECIP = {
    W: "Desert",
    S: "Steppe",
    f: "Without Dry Season",
    s: "Dry Summer",
    w: "Dry Winter",
    m: "Monsoon"
};

export const KOPPEN_TEMP = {
    h: "Hot",
    k: "Cold",
    a: "Hot Summer",
    b: "Warm Summer",
    c: "Cold Summer",
    d: "Very Cold Winter",
    T: "Tundra",
    F: "Frost"
};

/* =========================================================
   Chart bounds and limits
   ========================================================= */
export const CHART_TEMP_MIN = -40;
export const CHART_TEMP_MAX = 40;
export const CHART_PRECIP_MAX = 800;

export const MARGIN = OVERALL_MARGIN_DESKTOP;

/* =========================================================
   Color scaling factors (chart-specific)
   ========================================================= */
export const TEMP_SAT_FACTOR_CHART = 0.5;
export const TEMP_L_FACTOR_CHART = 0.5;
export const PRECIP_SAT_FACTOR_CHART = 0.5;
export const PRECIP_L_FACTOR_CHART = 0.75;

/* =========================================================
   Tab2/Tab3 chart opacity (range + hull)
   ========================================================= */
export const RANGE_OPACITY_UNLOCKED = 0.15;
export const RANGE_OPACITY_LOCKED_ACTIVE = 0.4;
export const RANGE_OPACITY_LOCKED_DIM = 0.05;

/* =========================================================
   Color helpers
   ========================================================= */
export function tempColor(baseColor) {
    const hsl = d3.hsl(baseColor);
    hsl.s *= TEMP_SAT_FACTOR_CHART;
    hsl.l *= TEMP_L_FACTOR_CHART;
    return hsl.formatHex();
}

export function precipColor(baseColor) {
    const hsl = d3.hsl(baseColor);
    hsl.s *= PRECIP_SAT_FACTOR_CHART;
    hsl.l *= PRECIP_L_FACTOR_CHART;
    return hsl.formatHex();
}

export function hoverCircleColor(baseColor) {
    if (!baseColor) {
        return "#333333";
    }
    return adjustColor(baseColor, 1, 0.5);
}

function getPanelElement() {
    return document.getElementById("panel-left");
}

function getPanelBodyElement() {
    return document.getElementById("panel-body");
}

/* =========================================================
   Chart sizing helpers
   ========================================================= */
export function getPanelWidth() {
    const panelBody = getPanelBodyElement();
    if (panelBody) {
        const bodyWidth = panelBody.getBoundingClientRect().width;
        if (bodyWidth > 0) return bodyWidth;
    }

    const panel = getPanelElement();
    return panel ? panel.getBoundingClientRect().width : 240;
}

export function getAvailableChartHeight() {
    const panelBody = getPanelBodyElement();
    if (!panelBody) return 180;

    const containerHeight = panelBody.getBoundingClientRect().height;
    if (containerHeight < 100) return 180;

    const header = panelBody.querySelector(".panel-header");
    const headerHeight = header ? header.getBoundingClientRect().height : 0;
    const metadata = panelBody.querySelector(".panel-metadata")
        || panelBody.closest(".panel-scroll")?.querySelector("#shared-panel-metadata");
    const metadataHeight = metadata ? metadata.getBoundingClientRect().height : 0;
    const spacing = isMobileLayout() ? 36 : 50;

    const availableForCharts = containerHeight - headerHeight - metadataHeight - spacing;
    return Math.max(150, Math.floor(availableForCharts / 2) - 10);
}

export function getOverallChartMargin() {
    return isMobileLayout() ? OVERALL_MARGIN_MOBILE : OVERALL_MARGIN_DESKTOP;
}

export function getDetailChartMargin(kind = "monthly") {
    if (kind === "scatter") {
        return isMobileLayout() ? DETAIL_SCATTER_MARGIN_MOBILE : DETAIL_SCATTER_MARGIN_DESKTOP;
    }
    return isMobileLayout() ? DETAIL_MONTHLY_MARGIN_MOBILE : DETAIL_MONTHLY_MARGIN_DESKTOP;
}

function getSvgWidth(svgElement, minWidth = 240) {
    const rectWidth = svgElement?.getBoundingClientRect?.().width || 0;
    if (rectWidth > 0) {
        return Math.max(rectWidth, minWidth);
    }
    return Math.max(getPanelWidth() - (isMobileLayout() ? 0 : 4), minWidth);
}

export function getChartSize() {
    const margin = getOverallChartMargin();
    const width = Math.max(180, getPanelWidth() - (isMobileLayout() ? 0 : 8));
    const height = isMobileLayout()
        ? Math.round(clampValue(width * 0.88, 296, 392))
        : Math.round(getAvailableChartHeight() * 1.5);

    return {
        width,
        height,
        margin,
        innerWidth: width - margin.left - margin.right,
        innerHeight: height - margin.top - margin.bottom
    };
}

export function getDetailChartSize(svgElement, kind = "monthly") {
    const margin = getDetailChartMargin(kind);
    const width = getSvgWidth(svgElement, 240);
    const defaultDesktopHeight = kind === "scatter" ? 392 : 352;
    const height = isMobileLayout()
        ? Math.round(clampValue(width * 0.8, 248, 348))
        : Math.max(svgElement?.getBoundingClientRect?.().height || 0, defaultDesktopHeight);

    return {
        width,
        height,
        margin,
        innerWidth: width - margin.left - margin.right,
        innerHeight: height - margin.top - margin.bottom
    };
}

export function baseSvg(svg) {
    const { width, height, margin } = getChartSize();
    svg.selectAll("*").remove();
    svg.attr("width", width).attr("height", height);
    return svg.append("g")
        .attr("transform", `translate(${margin.left},${margin.top})`);
}

export function appendChartHeading(group, title, subtitle) {
    if (!group || !title) {
        return;
    }

    group.append("text")
        .attr("x", 0)
        .attr("y", -24)
        .attr("font-size", 12)
        .attr("font-weight", 600)
        .attr("fill", "#333333")
        .text(title);

    if (!subtitle) {
        return;
    }

    group.append("text")
        .attr("x", 0)
        .attr("y", -10)
        .attr("font-size", 11)
        .attr("fill", "#777777")
        .text(subtitle);
}

/* =========================================================
   Koppen explanation formatter
   ========================================================= */
export function explainKgType(kg) {
    if (!kg || kg.length < 1) return "";

    const lines = [];
    const main = kg[0];

    if (KOPPEN_MAIN[main]) {
        lines.push(`Main: <strong>${main}</strong> - ${KOPPEN_MAIN[main]}`);
    } else {
        lines.push("<br>");
    }

    const tempChar = main === "E"
        ? (kg.length >= 2 ? kg[1] : null)
        : (kg.length >= 3 ? kg[2] : null);
    const precipChar = main === "E"
        ? null
        : (kg.length >= 2 ? kg[1] : null);

    if (tempChar && KOPPEN_TEMP[tempChar]) {
        lines.push(`Temperature: <strong>${tempChar}</strong> - ${KOPPEN_TEMP[tempChar]}`);
    } else {
        lines.push("<br>");
    }

    if (precipChar && KOPPEN_PRECIP[precipChar]) {
        lines.push(`Precipitation: <strong>${precipChar}</strong> - ${KOPPEN_PRECIP[precipChar]}`);
    } else {
        lines.push("<br>");
    }

    return lines;
}

/* =========================================================
   Get active datum (locked or hovered)
   Helper for all tab modules to determine which datum to display
   ========================================================= */
export function getActiveDatumHelper(locked, lockedData, hoverDatum) {
    return locked ? lockedData : hoverDatum;
}

/* =========================================================
   Update coordinates display (shared across all tabs)
   ========================================================= */
export function updateCoordinateDisplay(d) {
    const climateCoordLabel = document.getElementById("climate-coord");
    updateMobileSheetSummary(d);

    if (!climateCoordLabel) return;

    if (!d) {
        climateCoordLabel.innerHTML = `
            <div class="coord-line">(No location selected)</div>
            <div class="country-line"><br></div>
        `;
        return;
    }

    const latDir = d.lat >= 0 ? "N" : "S";
    const lonDir = d.lon >= 0 ? "E" : "W";
    climateCoordLabel.innerHTML = `
        <div class="coord-line">${Math.abs(d.lat).toFixed(2)}° ${latDir}, ${Math.abs(d.lon).toFixed(2)}° ${lonDir}</div>
        <div class="country-line">${d.countryName || "<br>"}</div>
    `;
}

export function shouldUseHoverPreview() {
    return canUseHoverPreview();
}

/* =========================================================
   Shared exports: dispatcher and STATE
   ========================================================= */
export { dispatcher, STATE };
