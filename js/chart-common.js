// 页面初始显示坐标提示
document.addEventListener("DOMContentLoaded", () => {
    const climateCoordLabel = document.getElementById("climate-coord");
    if (climateCoordLabel && climateCoordLabel.innerHTML.trim() === "") {
        updateCoordinateDisplay(null);
    }
});
/* =========================================================
   chart-common.js
   Shared constants, color helpers, and utility functions for all chart tabs
   ========================================================= */

import { dispatcher, STATE, adjustColor } from "./shared.js";

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
export const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const MONTH_FULL = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/* =========================================================
   Köppen classification dictionaries
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

export const MARGIN = { top: 48, right: 32, bottom: 48, left: 42 };

/* =========================================================
   Color scaling factors (chart-specific)
   ========================================================= */
export const TEMP_SAT_FACTOR_CHART   = 0.5;
export const TEMP_L_FACTOR_CHART     = 0.5;
export const PRECIP_SAT_FACTOR_CHART = 0.5;
export const PRECIP_L_FACTOR_CHART   = 0.75;

/* =========================================================
    Tab2/Tab3 chart opacity (range + hull)
    ========================================================= */
export const RANGE_OPACITY_UNLOCKED = 0.22;
export const RANGE_OPACITY_LOCKED_ACTIVE = 0.48;
export const RANGE_OPACITY_LOCKED_DIM = 0.05;

/* =========================================================
   Tooltip
   ========================================================= */
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
    .style("z-index", "10000");

export function showTooltip(event, text) {
    tooltip
        .style("visibility", "visible")
        .text(text)
        .style("left", (event.pageX + 10) + "px")
        .style("top", (event.pageY - 20) + "px");
}

export function hideTooltip() {
    tooltip.style("visibility", "hidden");
}

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

/* =========================================================
   Chart sizing helpers
   ========================================================= */
export function getPanelWidth() {
    const panel = document.getElementById("panel-left");
    return panel ? panel.getBoundingClientRect().width : 240;
}

export function getAvailableChartHeight() {
    const panelBody = document.getElementById("panel-body");
    if (!panelBody) return 180;

    const containerHeight = panelBody.getBoundingClientRect().height;
    if (containerHeight < 100) return 180;

    const header = panelBody.querySelector(".panel-header");
    const headerHeight = header ? header.getBoundingClientRect().height : 0;
    const spacing = 50;

    const availableForCharts = containerHeight - headerHeight - spacing;
    return Math.max(150, Math.floor(availableForCharts / 2) - 10);
}

export function getChartSize() {
    const width = Math.max(180, getPanelWidth() - 32);
    const height = Math.round(getAvailableChartHeight() * 1.5);
    return {
        width,
        height,
        innerWidth:  width  - MARGIN.left - MARGIN.right,
        innerHeight: height - MARGIN.top  - MARGIN.bottom
    };
}

export function baseSvg(svg) {
    const { width, height } = getChartSize();
    svg.selectAll("*").remove();
    svg.attr("width", width).attr("height", height);
    return svg.append("g")
        .attr("transform", `translate(${MARGIN.left},${MARGIN.top})`);
}

/* =========================================================
   Köppen explanation formatter
   ========================================================= */
export function explainKgType(kg) {
    if (!kg || kg.length < 1) return "";

    const lines = [];
    const main = kg[0];

    if (KOPPEN_MAIN[main]) {
        lines.push(`Main: <strong>${main}</strong> ${KOPPEN_MAIN[main]}`);
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
        lines.push(`Temperature: <strong>${tempChar}</strong> ${KOPPEN_TEMP[tempChar]}`);
    } else {
        lines.push("<br>");
    }

    if (precipChar && KOPPEN_PRECIP[precipChar]) {
        lines.push(`Precipitation: <strong>${precipChar}</strong> ${KOPPEN_PRECIP[precipChar]}`);
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

/* =========================================================
   Shared exports: dispatcher and STATE
   ========================================================= */
export { dispatcher, STATE };
