/* =========================================================
   chart-tab-temperature.js
   Tab2: Temperature scatter plot and monthly temperature line chart
   ========================================================= */

import {
    MONTH_FULL,
    tempColor, showTooltip, hideTooltip,
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

function updateTemperatureScatterHover(d) {
    const svgElement = document.getElementById("temperatureScatter");
    if (!svgElement) {
        return;
    }

    const svg = d3.select(svgElement);
    const layer = svg.select(".chart-hover-layer");
    if (layer.empty()) {
        return;
    }

    const valid = d && typeof d.t_01 === "number" && isFinite(d.t_01) && typeof d.t_07 === "number" && isFinite(d.t_07);
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
        .style("cursor", "pointer")
        .on("mouseover", function(event, v) {
            if (v && typeof v.t_01 === "number" && typeof v.t_07 === "number") {
                showTooltip(event, `Jan: ${v.t_01.toFixed(1)}°C, Jul: ${v.t_07.toFixed(1)}°C`);
            }
        })
        .on("mouseout", function() {
            hideTooltip();
        })
        .merge(dots)
        .attr("cx", v => x(v.t_01))
        .attr("cy", v => y(v.t_07))
        .attr("fill", v => hoverCircleColor(v.baseColor));
    dots.exit().remove();

    // Update opacity of hulls based on hover state
    const highlightType = d?.kg_type || null;
    svg.selectAll(".temp-hull")
        .transition()
        .duration(150)
        .attr("opacity", function() {
            const kg_type = d3.select(this).datum().kg_type;
            if (!highlightType) return RANGE_OPACITY_UNLOCKED;
            return kg_type === highlightType ? RANGE_OPACITY_LOCKED_ACTIVE : RANGE_OPACITY_LOCKED_DIM;
        });
}

function updateMonthlyTemperatureHover(d) {
    const svgElement = document.getElementById("monthlyTemperature");
    if (!svgElement) {
        return;
    }

    const svg = d3.select(svgElement);
    const layer = svg.select(".chart-hover-layer");
    if (layer.empty()) {
        return;
    }

    const valid = d && typeof d.t_01 === "number" && isFinite(d.t_01);
    const data = valid ? [d] : [];

    // Use cached scales if available
    if (!scaleCache || !scaleCache.monthlyX || !scaleCache.monthlyY) {
        layer.selectAll("path").remove();
        return;
    }

    const x = scaleCache.monthlyX;
    const y = scaleCache.monthlyY;

    const months = d3.range(1, 13).map(month => {
        const key = month < 10 ? `t_0${month}` : `t_${month}`;
        return { month, temp: d ? d[key] : null };
    });

    const line = d3.line()
        .x(v => x(v.month))
        .y(v => y(v.temp))
        .defined(v => typeof v.temp === "number" && isFinite(v.temp))
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
        .style("pointer-events", "stroke")
        .style("cursor", "pointer")
        .on("mouseover", function(event) {
            if (d && d.t) {
                const temps = d.t.map((t, i) => `${MONTH_FULL[i]}: ${t.toFixed(1)}°C`).join(', ');
                showTooltip(event, temps);
            }
        })
        .on("mouseout", function() {
            hideTooltip();
        })
        .merge(paths)
        .attr("d", line)
        .attr("stroke", () => hoverCircleColor(d?.baseColor));
    paths.exit().remove();

    // Add individual month markers for easier per-month hover
    const monthPoints = data.length ? months.filter(m => typeof m.temp === "number" && isFinite(m.temp)) : [];
    const markers = layer.selectAll("circle.chart-hover-month-marker").data(monthPoints);
    markers.enter()
        .append("circle")
        .attr("class", "chart-hover-month-marker")
        .attr("r", 3)
        .style("cursor", "pointer")
        .style("pointer-events", "all")
        .on("mouseover", function(event, m) {
            d3.select(this).attr("r", 5);
            showTooltip(event, `${MONTH_FULL[m.month - 1]}: ${m.temp.toFixed(1)}°C`);
        })
        .on("mouseout", function() {
            d3.select(this).attr("r", 3);
            hideTooltip();
        })
        .merge(markers)
        .attr("cx", m => x(m.month))
        .attr("cy", m => y(m.temp))
        .attr("fill", () => hoverCircleColor(d?.baseColor))
        .attr("stroke", "#fff")
        .attr("stroke-width", 1);
    markers.exit().remove();

    // Update opacity of ranges based on hover state
    const highlightType = d?.kg_type || null;
    svg.selectAll(".temp-range")
        .transition()
        .duration(150)
        .attr("opacity", function() {
            const kg_type = d3.select(this).datum().kg_type;
            if (!highlightType) return RANGE_OPACITY_UNLOCKED;
            return kg_type === highlightType ? RANGE_OPACITY_LOCKED_ACTIVE : RANGE_OPACITY_LOCKED_DIM;
        });
}

/* =========================================================
   Tab2: Monthly Temperature Chart
   ========================================================= */
export function handleTemperatureTabHover(d) {
    const { locked } = getLockState();
    // Allow hover updates even when locked to enable value reading
    hoverDatum = d || null;
    updateCoordinateDisplay(d);
    // Only update hover indicators, not full redraw
    updateTemperatureScatterHover(d);
    updateMonthlyTemperatureHover(d);
}

export function handleTemperatureTabHoverEnd() {
    const { locked } = getLockState();
    // Keep locked data visible when hover ends in locked state
    if (locked) {
        // Keep showing locked data, just hide tooltip
        hideTooltip();
        return;
    }
    hoverDatum = null;
    updateCoordinateDisplay(null);
    // Only update hover indicators, not full redraw
    updateTemperatureScatterHover(null);
    updateMonthlyTemperatureHover(null);
}

export function drawMonthlyTemperature() {
    const svgElement = document.getElementById("monthlyTemperature");
    if (!svgElement) {
        return;
    }

    const svg = d3.select(svgElement);
    const rect = svgElement.getBoundingClientRect();
    const width = Math.max(rect.width, 240) || 240;
    const height = Math.max(rect.height, 180) || 180;

    svg.selectAll("*").remove();
    svg.attr("width", width).attr("height", height);
    // ...existing code...

    const margin = { top: 28, right: 20, bottom: 36, left: 44 };
    const innerWidth = width - margin.left - margin.right;
    const innerHeight = height - margin.top - margin.bottom;
    const g = svg.append("g").attr("transform", `translate(${margin.left},${margin.top})`);

    // Get all data with valid climate type
    const data = (STATE.data || []).filter(d => d.kg_type);

    if (!data.length) return;

    // Prepare monthly min/max range data for each climate type
    const groupedByType = d3.group(data, d => d.kg_type);
    const rangeData = Array.from(groupedByType, ([kg_type, values]) => {
        const ranges = d3.range(1, 13).map(month => {
            const key = month < 10 ? `t_0${month}` : `t_${month}`;
            const temps = values
                .map(v => v[key])
                .filter(t => typeof t === "number" && isFinite(t));

            if (!temps.length) {
                return { month, min: null, max: null };
            }

            return {
                month,
                min: d3.min(temps),
                max: d3.max(temps)
            };
        });

        return {
            kg_type,
            baseColor: values[0]?.baseColor,
            ranges
        };
    });

    // Fixed Y-axis range for temperature
    const yMin = -70, yMax = 40;

    // Scales
    const x = d3.scaleLinear()
        .domain([0.5, 12.5])
        .range([0, innerWidth]);
    const y = d3.scaleLinear()
        .domain([yMin, yMax])
        .range([innerHeight, 0]);

    // Axes
    // Add horizontal grid lines
    const tempTicksMonthly = d3.range(-70, 50, 10);
    g.append("g")
        .attr("class", "chart-grid")
        .selectAll("line")
        .data(tempTicksMonthly)
        .enter()
        .append("line")
        .attr("x1", 0)
        .attr("x2", innerWidth)
        .attr("y1", d => y(d))
        .attr("y2", d => y(d))
        .attr("stroke", "#e5e5e5")
        .attr("stroke-width", 1)
        .attr("stroke-dasharray", "2,2");

    // Add vertical grid lines
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

    // Coordinate axes (for monthly chart)
    g.append("g")
        .attr("class", "chart-axis")
        .call(d3.axisLeft(y).tickValues(tempTicksMonthly));
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
        .text("Monthly Temperature");

    // Color function
    function getColor(d) {
        return tempColor(d.baseColor || d3.schemeCategory10[d.kg_type.charCodeAt(0) % 10]);
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
    g.selectAll(".temp-range")
        .data(rangeData)
        .enter()
        .append("path")
        .attr("class", "temp-range")
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

    updateMonthlyTemperatureHover(getActiveDatum());
}

/* =========================================================
   Tab2: Temperature Scatter Plot (Month 1 vs Month 7)
   ========================================================= */
export function drawTemperatureScatter() {
    const svgElement = document.getElementById("temperatureScatter");
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

    // Filter valid temperature points (January vs July)
    const data = (STATE.data || []).filter(d => {
        if (!d.kg_type || typeof d.t_01 !== 'number' || typeof d.t_07 !== 'number') return false;
        d._t01 = d.t_01;
        d._t07 = d.t_07;
        return true;
    });

    if (!data.length) {
        return;
    }

    // Scale setup with fixed axis ranges
    const xMin = -70, xMax = 30;
    const yMin = -40, yMax = 40;

    const x = d3.scaleLinear()
        .domain([xMin, xMax])
        .range([0, innerWidth]);
    const y = d3.scaleLinear()
        .domain([yMin, yMax])
        .range([innerHeight, 0]);

    // Add horizontal grid lines (for scatter plot)
    const tempTicksScatter = d3.range(-40, 50, 10);
    g.append("g")
        .attr("class", "chart-grid")
        .selectAll("line")
        .data(tempTicksScatter)
        .enter()
        .append("line")
        .attr("x1", 0)
        .attr("x2", innerWidth)
        .attr("y1", d => y(d))
        .attr("y2", d => y(d))
        .attr("stroke", "#e5e5e5")
        .attr("stroke-width", 1)
        .attr("stroke-dasharray", "2,2");

    // Add vertical grid lines (for scatter plot)
    const tempTicksX = d3.range(-70, 40, 10);
    g.append("g")
        .attr("class", "chart-grid")
        .selectAll("line")
        .data(tempTicksX)
        .enter()
        .append("line")
        .attr("y1", 0)
        .attr("y2", innerHeight)
        .attr("x1", m => x(m))
        .attr("x2", m => x(m))
        .attr("stroke", "#e5e5e5")
        .attr("stroke-width", 1)
        .attr("stroke-dasharray", "2,2");

    // Add y=x reference line
    g.append("line")
        .attr("class", "reference-line")
        .attr("x1", x(-40))
        .attr("y1", y(-40))
        .attr("x2", x(30))
        .attr("y2", y(30))
        .attr("stroke", "#999")
        .attr("stroke-width", 1)
        .attr("stroke-dasharray", "4,4")
        .attr("opacity", 0.6)
        .style("pointer-events", "stroke")
        .style("cursor", "pointer")
        .on("mouseover", function(event) {
            showTooltip(event, "y=x reference line");
        })
        .on("mouseout", function() {
            hideTooltip();
        });

    // Coordinate axes (for scatter plot)
    g.append("g")
        .attr("class", "chart-axis")
        .call(d3.axisLeft(y).tickValues(tempTicksScatter));
    g.append("g")
        .attr("class", "chart-axis")
        .attr("transform", `translate(0,${innerHeight})`)
        .call(d3.axisBottom(x).tickValues(tempTicksX));

    // Title
    g.append("text")
        .attr("x", 0)
        .attr("y", -16)
        .attr("font-size", 12)
        .attr("font-weight", 600)
        .attr("fill", "#333")
        .text("Winter (Month 1) vs Summer (Month 7) Temperature");

    // Color function
    function getColor(d) {
        return tempColor(d.baseColor || d3.schemeCategory10[d.kg_type.charCodeAt(0) % 10]);
    }

    // Determine highlight type if locked or hovered
    let highlightType = null;
    if (PANEL_LOCKED && LOCKED_DATA && LOCKED_DATA.kg_type) {
        highlightType = LOCKED_DATA.kg_type;
    } else if (hoverDatum && hoverDatum.kg_type) {
        highlightType = hoverDatum.kg_type;
    }

    // Build convex hulls per climate type
    const groupedByType = d3.group(data, d => d.kg_type);
    const hullData = Array.from(groupedByType, ([kg_type, values]) => {
        const points = values.map(v => [x(v._t01), y(v._t07)]);
        const hull = d3.polygonHull(points);
        return hull ? { kg_type, baseColor: values[0]?.baseColor, hull } : null;
    }).filter(Boolean);

    const hullLine = d3.line().curve(d3.curveLinearClosed);

    g.selectAll(".temp-hull")
        .data(hullData)
        .enter()
        .append("path")
        .attr("class", "temp-hull")
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

    updateTemperatureScatterHover(getActiveDatum());
}

/* =========================================================
   Tab2 Event Handlers
   ========================================================= */
export function initTemperatureTab() {
    // Redraw on data load
    dispatcher.on("dataLoaded.temperatureScatter", () => {
        drawTemperatureScatter();
        drawMonthlyTemperature();
    });

    // Redraw on tab switch (wait for CSS transitions and layout to complete)
    dispatcher.on("tabChanged.temperatureScatter", (tabName) => {
        if (tabName === 'temperature') {
            setTimeout(() => {
                drawTemperatureScatter();
                drawMonthlyTemperature();
            }, 350);
        }
    });

    // Redraw on lock/unlock
    dispatcher.on("lock.temperatureTab", () => {
        if (document.getElementById('tab-temperature')?.classList.contains('active')) {
            setTimeout(() => {
                drawTemperatureScatter();
                drawMonthlyTemperature();
            }, 0);
        }
    });

    dispatcher.on("unlock.temperatureTab", () => {
        hoverDatum = null;
        if (document.getElementById('tab-temperature')?.classList.contains('active')) {
            setTimeout(() => {
                drawTemperatureScatter();
                drawMonthlyTemperature();
            }, 0);
        }
    });

    // Note: Hover events are handled centrally in chart.js to optimize performance
    // Only the active tab's update functions are called

    // ResizeObserver for initial rendering
    const temperatureTab = document.getElementById("tab-temperature");
    if (temperatureTab && window.ResizeObserver) {
        const resizeObserver = new ResizeObserver(() => {
            const scatterSvg = document.getElementById("temperatureScatter");
            if (scatterSvg && scatterSvg.getBoundingClientRect().width > 0) {
                setTimeout(() => {
                    drawTemperatureScatter();
                    drawMonthlyTemperature();
                }, 0);
            }
        });
        resizeObserver.observe(temperatureTab);
    }
}
