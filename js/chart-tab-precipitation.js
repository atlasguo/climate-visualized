/* =========================================================
   chart-tab-precipitation.js
   Tab3: Precipitation scatter plot and monthly precipitation line chart
   ========================================================= */

import {
    MONTH_FULL,
    precipColor, showTooltip, hideTooltip,
    RANGE_OPACITY_UNLOCKED,
    RANGE_OPACITY_LOCKED_ACTIVE,
    RANGE_OPACITY_LOCKED_DIM,
    hoverCircleColor,
    getActiveDatumHelper,
    updateCoordinateDisplay,
    dispatcher, STATE
} from "./chart-common.js";
import { PANEL_LOCKED, LOCKED_DATA, getLockState } from "./chart-tab-overall.js";

let hoverDatum = null;

// Cache for expensive computations
let scaleCache = null;

function getActiveDatum() {
    return getActiveDatumHelper(PANEL_LOCKED && LOCKED_DATA, LOCKED_DATA, hoverDatum);
}

function updatePrecipitationScatterHover(d) {
    const svgElement = document.getElementById("precipitationScatter");
    if (!svgElement) {
        return;
    }

    const svg = d3.select(svgElement);
    const layer = svg.select(".chart-hover-layer");
    if (layer.empty()) {
        return;
    }

    const valid = d && typeof d.p_01 === "number" && isFinite(d.p_01) && typeof d.p_07 === "number" && isFinite(d.p_07) && d.p_01 > 0 && d.p_07 > 0;
    const data = valid ? [d] : [];

    // Use cached scales if available
    if (!scaleCache || !scaleCache.scatterX) {
        layer.selectAll("circle").remove();
        return;
    }

    const x = scaleCache.scatterX;
    const y = scaleCache.scatterY;

    const dots = layer.selectAll("circle").data(data);
    dots.enter()
        .append("circle")
        .attr("class", "chart-hover-dot")
        .attr("r", 4)
        .merge(dots)
        .attr("cx", v => x(v.p_01))
        .attr("cy", v => y(v.p_07))
        .attr("fill", v => hoverCircleColor(v.baseColor));
    dots.exit().remove();

    // Update opacity of hulls based on hover state
    const highlightType = d?.kg_type || null;
    svg.selectAll(".precip-hull")
        .transition()
        .duration(150)
        .attr("opacity", function() {
            const kg_type = d3.select(this).datum().kg_type;
            if (!highlightType) return RANGE_OPACITY_UNLOCKED;
            return kg_type === highlightType ? RANGE_OPACITY_LOCKED_ACTIVE : RANGE_OPACITY_LOCKED_DIM;
        });
}

function updateMonthlyPrecipitationHover(d) {
    const svgElement = document.getElementById("monthlyPrecipitation");
    if (!svgElement) {
        return;
    }

    const svg = d3.select(svgElement);
    const layer = svg.select(".chart-hover-layer");
    if (layer.empty()) {
        return;
    }

    const valid = d && d.kg_type;
    const data = valid ? [d] : [];

    // Use cached scales if available
    if (!scaleCache || !scaleCache.monthlyX || !scaleCache.monthlyY) {
        layer.selectAll("path").remove();
        return;
    }

    const x = scaleCache.monthlyX;
    const y = scaleCache.monthlyY;
    const pMin = scaleCache.pMin;

    const months = d3.range(1, 13).map(month => {
        const key = month < 10 ? `p_0${month}` : `p_${month}`;
        let val = d && typeof d[key] === "number" && isFinite(d[key]) && d[key] > 0 ? d[key] : pMin;
        return { month, precip: val };
    });

    const line = d3.line()
        .x(v => x(v.month))
        .y(v => y(v.precip))
        .curve(d3.curveLinear);

    const lineData = data.length ? [months] : [];

    const outlinePaths = layer.selectAll("path.chart-hover-line-outline").data(lineData);
    outlinePaths.enter()
        .append("path")
        .attr("class", "chart-hover-line-outline")
        .merge(outlinePaths)
        .attr("d", line);
    outlinePaths.exit().remove();

    const paths = layer.selectAll("path.chart-hover-line").data(lineData);
    paths.enter()
        .append("path")
        .attr("class", "chart-hover-line")
        .merge(paths)
        .attr("d", line)
        .attr("stroke", () => hoverCircleColor(d?.baseColor));
    paths.exit().remove();

    // Update opacity of ranges based on hover state
    const highlightType = d?.kg_type || null;
    svg.selectAll(".precip-range")
        .transition()
        .duration(150)
        .attr("opacity", function() {
            const kg_type = d3.select(this).datum().kg_type;
            if (!highlightType) return RANGE_OPACITY_UNLOCKED;
            return kg_type === highlightType ? RANGE_OPACITY_LOCKED_ACTIVE : RANGE_OPACITY_LOCKED_DIM;
        });
}

/* =========================================================
   Tab3: Monthly Precipitation Chart
   ========================================================= */
export function handlePrecipitationTabHover(d) {
    const { locked } = getLockState();
    if (locked) return;
    hoverDatum = d || null;
    updateCoordinateDisplay(d);
    // Only update hover indicators, not full redraw
    updatePrecipitationScatterHover(d);
    updateMonthlyPrecipitationHover(d);
}

export function handlePrecipitationTabHoverEnd() {
    const { locked } = getLockState();
    if (locked) return;
    hoverDatum = null;
    updateCoordinateDisplay(null);
    // Only update hover indicators, not full redraw
    updatePrecipitationScatterHover(null);
    updateMonthlyPrecipitationHover(null);
}

export function drawMonthlyPrecipitation() {
    const svgElement = document.getElementById("monthlyPrecipitation");
    if (!svgElement) {
        return;
    }

    const svg = d3.select(svgElement);
    const rect = svgElement.getBoundingClientRect();
    const width = Math.max(rect.width, 240) || 240;
    const height = Math.max(rect.height, 180) || 180;

    svg.selectAll("*").remove();
    svg.attr("width", width).attr("height", height);

    const margin = { top: 28, right: 20, bottom: 36, left: 44 };
    const innerWidth = width - margin.left - margin.right;
    const innerHeight = height - margin.top - margin.bottom;
    const g = svg.append("g").attr("transform", `translate(${margin.left},${margin.top})`);

    // Get all data with valid climate type
    const data = (STATE.data || []).filter(d => d.kg_type);

    if (!data.length) return;

    // Get Y-axis extent for precipitation range (filter for positive values for log scale)
    let allPrecip = [];
    (STATE.data || []).forEach(v => {
        for (let month = 1; month <= 12; month += 1) {
            const key = month < 10 ? `p_0${month}` : `p_${month}`;
            const value = v[key];
            if (typeof value === "number" && isFinite(value) && value > 0) {
                allPrecip.push(value);
            }
        }
    });
    
    // Use extent or fallback if no data
    let pMin = 0.1, pMax = 1000;
    if (allPrecip.length > 0) {
        const extent = d3.extent(allPrecip);
        // Ensure minimum is at least 0.1 for log scale
        pMin = Math.max(0.1, extent[0]);
        pMax = Math.max(1, extent[1]);
    }

    // Prepare monthly min/max range data for each climate type
    const groupedByType = d3.group(data, d => d.kg_type);
    const rangeData = Array.from(groupedByType, ([kg_type, values]) => {
        const ranges = d3.range(1, 13).map(month => {
            const key = month < 10 ? `p_0${month}` : `p_${month}`;
            const valuesForMonth = values
                .map(v => v[key])
                .filter(p => typeof p === "number" && isFinite(p) && p >= 0);

            if (!valuesForMonth.length) {
                return { month, min: null, max: null };
            }

            const minValue = d3.min(valuesForMonth);
            const maxValue = d3.max(valuesForMonth);
            return {
                month,
                min: minValue > 0 ? minValue : pMin,
                max: maxValue > 0 ? maxValue : pMin
            };
        });

        return {
            kg_type,
            baseColor: values[0]?.baseColor,
            ranges
        };
    });

    // Scales with logarithmic Y-axis for precipitation
    const x = d3.scaleLinear()
        .domain([0.5, 12.5])
        .range([0, innerWidth]);
    const y = d3.scaleLog()
        .domain([pMin, pMax])
        .nice()
        .range([innerHeight, 0])
        .clamp(true);

    // Axes with log scale formatting
    // 添加辅助网格线（横向）
    g.append("g")
        .attr("class", "chart-grid")
        .selectAll("line")
        .data(y.ticks(4))
        .enter()
        .append("line")
        .attr("x1", 0)
        .attr("x2", innerWidth)
        .attr("y1", d => y(d))
        .attr("y2", d => y(d))
        .attr("stroke", "#e5e5e5")
        .attr("stroke-width", 1)
        .attr("stroke-dasharray", "2,2");

    // 添加辅助网格线（纵向）
    g.append("g")
        .attr("class", "chart-grid")
        .selectAll("line")
        .data(d3.range(1, 13))
        .enter()
        .append("line")
        .attr("y1", 0)
        .attr("y2", innerHeight)
        .attr("x1", m => x(m))
        .attr("x2", m => x(m))
        .attr("stroke", "#e5e5e5")
        .attr("stroke-width", 1)
        .attr("stroke-dasharray", "2,2");

    // 坐标轴
    g.append("g")
        .attr("class", "chart-axis")
        .call(d3.axisLeft(y).ticks(4, ".0f"));
    g.append("g")
        .attr("class", "chart-axis")
        .attr("transform", `translate(0,${innerHeight})`)
        .call(d3.axisBottom(x).tickValues(d3.range(1, 13)).tickFormat(d => d));

    // Title
    g.append("text")
        .attr("x", 0)
        .attr("y", -12)
        .attr("font-size", 12)
        .attr("font-weight", 600)
        .attr("fill", "#333")
        .text("Monthly Precipitation");

    // Color function
    function getColor(d) {
        return precipColor(d.baseColor || d3.schemeCategory10[d.kg_type.charCodeAt(0) % 10]);
    }

    // Area generator with .defined() to skip invalid points
    const area = d3.area()
        .x(d => x(d.month))
        .y0(d => y(d.min))
        .y1(d => y(d.max))
        .defined(d => typeof d.min === "number" && typeof d.max === "number" && isFinite(d.min) && isFinite(d.max))
        .curve(d3.curveLinear);

    // Determine highlight type if locked
    let highlightType = null;
    if (PANEL_LOCKED && LOCKED_DATA && LOCKED_DATA.kg_type) {
        highlightType = LOCKED_DATA.kg_type;
    } else if (hoverDatum && hoverDatum.kg_type) {
        highlightType = hoverDatum.kg_type;
    }

    // Draw range areas for each climate type
    g.selectAll(".precip-range")
        .data(rangeData)
        .enter()
        .append("path")
        .attr("class", "precip-range")
        .attr("d", d => area(d.ranges))
        .attr("fill", d => getColor(d))
        .attr("stroke", "none")
        .attr("opacity", d => {
            if (!highlightType) return RANGE_OPACITY_UNLOCKED;
            return d.kg_type === highlightType ? RANGE_OPACITY_LOCKED_ACTIVE : RANGE_OPACITY_LOCKED_DIM;
        });

    const hoverLayer = svg.append("g")
        .attr("class", "chart-hover-layer")
        .attr("transform", `translate(${margin.left},${margin.top})`);

    // Cache scales for hover updates
    if (!scaleCache) scaleCache = {};
    scaleCache.monthlyX = x;
    scaleCache.monthlyY = y;
    scaleCache.pMin = pMin;

    updateMonthlyPrecipitationHover(getActiveDatum());
}

/* =========================================================
   Tab3: Precipitation Scatter Plot (Month 1 vs Month 7)
   ========================================================= */
export function drawPrecipitationScatter() {
    const svgElement = document.getElementById("precipitationScatter");
    if (!svgElement) {
        return;
    }

    const svg = d3.select(svgElement);
    const rect = svgElement.getBoundingClientRect();
    const width = Math.max(rect.width, 240) || 240;
    const height = Math.max(rect.height, 180) || 180;

    svg.selectAll("*").remove();
    svg.attr("width", width).attr("height", height);

    const margin = { top: 32, right: 24, bottom: 40, left: 44 };
    const innerWidth = width - margin.left - margin.right;
    const innerHeight = height - margin.top - margin.bottom;
    const g = svg.append("g").attr("transform", `translate(${margin.left},${margin.top})`);

    // Filter valid precipitation points (January vs July) - must be greater than 0 for log scale
    const data = (STATE.data || []).filter(d => {
        if (!d.kg_type || d.p_01 === undefined || d.p_07 === undefined) return false;
        if (d.p_01 <= 0 || d.p_07 <= 0) return false;
        d._p01 = d.p_01;
        d._p07 = d.p_07;
        return true;
    });

    if (!data.length) {
        return;
    }

    // Get extent of both axes for logarithmic scale
    const xDomain = d3.extent(data, d => d._p01);
    const yDomain = d3.extent(data, d => d._p07);
    
    // Logarithmic scales for both axes - ensure minimum is at least 0.1
    const x = d3.scaleLog()
        .domain([Math.max(0.1, xDomain[0]), Math.max(1, xDomain[1])])
        .nice()
        .range([0, innerWidth])
        .clamp(true);
    const y = d3.scaleLog()
        .domain([Math.max(0.1, yDomain[0]), Math.max(1, yDomain[1])])
        .nice()
        .range([innerHeight, 0])
        .clamp(true);

    // 添加辅助网格线（横向）
    g.append("g")
        .attr("class", "chart-grid")
        .selectAll("line")
        .data(y.ticks(4))
        .enter()
        .append("line")
        .attr("x1", 0)
        .attr("x2", innerWidth)
        .attr("y1", d => y(d))
        .attr("y2", d => y(d))
        .attr("stroke", "#e5e5e5")
        .attr("stroke-width", 1)
        .attr("stroke-dasharray", "2,2");

    // 添加辅助网格线（纵向）
    g.append("g")
        .attr("class", "chart-grid")
        .selectAll("line")
        .data(x.ticks ? x.ticks(4) : [])
        .enter()
        .append("line")
        .attr("y1", 0)
        .attr("y2", innerHeight)
        .attr("x1", m => x(m))
        .attr("x2", m => x(m))
        .attr("stroke", "#e5e5e5")
        .attr("stroke-width", 1)
        .attr("stroke-dasharray", "2,2");

    // 坐标轴
    g.append("g")
        .attr("class", "chart-axis")
        .call(d3.axisLeft(y).ticks(4, ".0f"));
    g.append("g")
        .attr("class", "chart-axis")
        .attr("transform", `translate(0,${innerHeight})`)
        .call(d3.axisBottom(x).ticks(4, ".0f"));

    // Title
    g.append("text")
        .attr("x", 0)
        .attr("y", -16)
        .attr("font-size", 12)
        .attr("font-weight", 600)
        .attr("fill", "#333")
        .text("Month 1 vs Month 7 Precipitation");

    // Color function
    function getColor(d) {
        return precipColor(d.baseColor || d3.schemeCategory10[d.kg_type.charCodeAt(0) % 10]);
    }

    // Determine highlight type if locked
    let highlightType = null;
    if (PANEL_LOCKED && LOCKED_DATA && LOCKED_DATA.kg_type) {
        highlightType = LOCKED_DATA.kg_type;
    } else if (hoverDatum && hoverDatum.kg_type) {
        highlightType = hoverDatum.kg_type;
    }

    // Build convex hulls per climate type
    const groupedByType = d3.group(data, d => d.kg_type);
    const hullData = Array.from(groupedByType, ([kg_type, values]) => {
        const points = values.map(v => [x(v._p01), y(v._p07)]);
        const hull = d3.polygonHull(points);
        return hull ? { kg_type, baseColor: values[0]?.baseColor, hull } : null;
    }).filter(Boolean);

    const hullLine = d3.line().curve(d3.curveLinearClosed);

    g.selectAll(".precip-hull")
        .data(hullData)
        .enter()
        .append("path")
        .attr("class", "precip-hull")
        .attr("d", d => hullLine(d.hull))
        .attr("fill", d => getColor(d))
        .attr("stroke", d => getColor(d))
        .attr("stroke-width", 0.6)
        .attr("opacity", d => {
            if (!highlightType) return RANGE_OPACITY_UNLOCKED;
            return d.kg_type === highlightType ? RANGE_OPACITY_LOCKED_ACTIVE : RANGE_OPACITY_LOCKED_DIM;
        });

    const hoverLayer = svg.append("g")
        .attr("class", "chart-hover-layer")
        .attr("transform", `translate(${margin.left},${margin.top})`);

    // Cache scales for hover updates
    if (!scaleCache) scaleCache = {};
    scaleCache.scatterX = x;
    scaleCache.scatterY = y;

    updatePrecipitationScatterHover(getActiveDatum());
}

/* =========================================================
   Tab3 Event Handlers
   ========================================================= */
export function initPrecipitationTab() {
    // Redraw on data load
    dispatcher.on("dataLoaded.precipitationScatter", () => {
        drawPrecipitationScatter();
        drawMonthlyPrecipitation();
    });

    // Redraw on tab switch (wait for CSS transitions and layout to complete)
    dispatcher.on("tabChanged.precipitationScatter", (tabName) => {
        if (tabName === 'precipitation') {
            setTimeout(() => {
                drawPrecipitationScatter();
                drawMonthlyPrecipitation();
            }, 350);
        }
    });

    // Redraw on lock/unlock
    dispatcher.on("lock.precipitationTab", () => {
        if (document.getElementById('tab-precipitation')?.classList.contains('active')) {
            setTimeout(() => {
                drawPrecipitationScatter();
                drawMonthlyPrecipitation();
            }, 0);
        }
    });

    dispatcher.on("unlock.precipitationTab", () => {
        hoverDatum = null;
        if (document.getElementById('tab-precipitation')?.classList.contains('active')) {
            setTimeout(() => {
                drawPrecipitationScatter();
                drawMonthlyPrecipitation();
            }, 0);
        }
    });

    // Note: Hover events are handled centrally in chart.js to optimize performance
    // Only the active tab's update functions are called

    // ResizeObserver for initial rendering
    const precipitationTab = document.getElementById("tab-precipitation");
    if (precipitationTab && window.ResizeObserver) {
        const resizeObserver = new ResizeObserver(() => {
            const scatterSvg = document.getElementById("precipitationScatter");
            if (scatterSvg && scatterSvg.getBoundingClientRect().width > 0) {
                setTimeout(() => {
                    drawPrecipitationScatter();
                    drawMonthlyPrecipitation();
                }, 0);
            }
        });
        resizeObserver.observe(precipitationTab);
    }
}
