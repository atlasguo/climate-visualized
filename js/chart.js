/* =========================================================
   chart.js
   Climate detail charts for the left panel
   Renders monthly temperature and precipitation on hover
   ========================================================= */

/* =========================================================
   Panel interaction state
   Controls whether the panel is driven by hover or locked
   ========================================================= */

let PANEL_LOCKED = false;
let LOCKED_DATA = null;

/* =========================================================
   Month names
   ========================================================= */

const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTH_FULL = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/* =========================================================
   Köppen classification dictionaries
   ========================================================= */

const KOPPEN_MAIN = {
    A: "Tropical",
    B: "Arid",
    C: "Temperate",
    D: "Cold",
    E: "Polar"
};

const KOPPEN_PRECIP = {
    W: "Desert",
    S: "Steppe",
    f: "Without Dry Season",
    s: "Dry Summer",
    w: "Dry Winter",
    m: "Monsoon"
};

const KOPPEN_TEMP = {
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
   DOM references
   ========================================================= */

const climateCoordLabel = document.getElementById("climate-coord");
const climateTypeLabel  = document.getElementById("climate-type");
const climateExplain    = document.getElementById("climate-explain");
const tempChartSvg      = d3.select("#tempChart");
const precipChartSvg    = d3.select("#precipChart");

const unlockBtn = document.getElementById("unlock-hover");

// Import shared dispatcher
import { dispatcher } from "./shared.js";

/* =========================================================
   Tooltip for chart hover
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

function showTooltip(event, text) {
    tooltip
        .style("visibility", "visible")
        .text(text)
        .style("left", (event.pageX + 10) + "px")
        .style("top", (event.pageY - 20) + "px");
}

function hideTooltip() {
    tooltip.style("visibility", "hidden");
}

/* =========================================================
   Explicit unlock control
   Click unlock to resume hover-driven panel updates
   ========================================================= */

if (unlockBtn) {
    unlockBtn.addEventListener("click", () => {
        PANEL_LOCKED = false;
        LOCKED_DATA = null;
        unlockBtn.style.display = "none";

        // Notify other modules (map) to unlock and resume hover-driven updates
        dispatcher.call("unlock", null);
    });
}

/* =========================================================
   Chart layout constants
   ========================================================= */

const MARGIN = { top: 35, right: 20, bottom: 20, left: 35 };
const CHART_HEIGHT = 300;

/*
    Fixed chart scales for consistent comparison across stations.
    Temperature in °C and precipitation in mm.
*/
const CHART_TEMP_MIN = -40; // °C
const CHART_TEMP_MAX = 40;  // °C
const CHART_PRECIP_MAX = 800; // mm

/* =========================================================
   Color scaling factors (chart-specific)
   ========================================================= */

const TEMP_SAT_FACTOR_CHART   = 0.5;
const TEMP_L_FACTOR_CHART     = 0.5;
const PRECIP_SAT_FACTOR_CHART = 0.5;
const PRECIP_L_FACTOR_CHART   = 0.75;

/* =========================================================
   Hover distance threshold
   Used to ignore distant or no-data regions
   (handled by ./shared.js)
   ========================================================= */


/* =========================================================
   Responsive size helpers
   ========================================================= */

function getPanelWidth() {
    const panel = document.getElementById("panel-left");
    return panel ? panel.getBoundingClientRect().width : 240;
}

function getChartSize() {
    const width = Math.max(180, getPanelWidth() - 24);
    const height = CHART_HEIGHT;
    return {
        width,
        height,
        innerWidth:  width  - MARGIN.left - MARGIN.right,
        innerHeight: height - MARGIN.top  - MARGIN.bottom
    };
}

function baseSvg(svg) {
    const { width, height } = getChartSize();
    svg.selectAll("*").remove();
    svg.attr("width", width).attr("height", height);
    return svg.append("g")
        .attr("transform", `translate(${MARGIN.left},${MARGIN.top})`);
}

/* =========================================================
   Color helpers
   ========================================================= */

function tempColor(baseColor) {
    const hsl = d3.hsl(baseColor);
    hsl.s *= TEMP_SAT_FACTOR_CHART;
    hsl.l *= TEMP_L_FACTOR_CHART;
    return hsl.formatHex();
}

function precipColor(baseColor) {
    const hsl = d3.hsl(baseColor);
    hsl.s *= PRECIP_SAT_FACTOR_CHART;
    hsl.l *= PRECIP_L_FACTOR_CHART;
    return hsl.formatHex();
}

/* =========================================================
   Temperature chart renderer
   ========================================================= */

// Render temperature line chart for the provided data; d is single-station data or null
function renderTempChart(d) {
    const { innerWidth, innerHeight } = getChartSize();
    const g = baseSvg(tempChartSvg);

    g.append("text")
        .attr("x", 0)
        .attr("y", -26)
        .attr("font-size", 12)
        .attr("font-weight", 800)
        .attr("fill", "#333333")
        .text("Temperature");

    g.append("text")
        .attr("x", 0)
        .attr("y", -12)
        .attr("font-size", 11)
        .attr("fill", "#777777")
        .text("Month (x) · Temperature (°C)");

    if (!d) {
        // Render empty axes when no data available
        const x = d3.scaleLinear()
            .domain([1, 12])
            .range([0, innerWidth]);

        const y = d3.scaleLinear()
            .domain([CHART_TEMP_MIN, CHART_TEMP_MAX])
            .range([innerHeight, 0]);

        g.append("g")
            .attr("class", "chart-axis")
            .call(d3.axisLeft(y).ticks(4));

        g.append("g")
            .attr("class", "chart-axis")
            .attr("transform", `translate(0,${innerHeight})`)
            .call(d3.axisBottom(x).tickValues([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]).tickFormat(i => MONTH_SHORT[i - 1]));
        return;
    }

    const x = d3.scaleLinear()
        .domain([1, 12])
        .range([0, innerWidth]);

    const y = d3.scaleLinear()
        .domain([CHART_TEMP_MIN, CHART_TEMP_MAX])
        .range([innerHeight, 0]);

    const line = d3.line()
        .x((_, i) => x(i + 1))
        .y(v => Math.max(0, Math.min(innerHeight, y(v))))
        .curve(d3.curveMonotoneX);

    g.append("path")
        .datum(d.t)
        .attr("class", "temp-line")
        .attr("stroke", tempColor(d.baseColor))
        .attr("d", line);

    // Add data points
    g.selectAll(".temp-point")
        .data(d.t)
        .enter()
        .append("circle")
        .attr("class", "temp-point")
        .attr("cx", (_, i) => x(i + 1))
        .attr("cy", v => Math.max(0, Math.min(innerHeight, y(v))))
        .attr("r", 3)
        .attr("fill", tempColor(d.baseColor))
        .attr("stroke", "#ffffff")
        .attr("stroke-width", 1.5)
        .style("cursor", "pointer")
        .on("mouseover", function(event, v) {
            const monthIndex = d.t.indexOf(v);
            d3.select(this).attr("r", 5);
            const belowMsg = v < CHART_TEMP_MIN ? " (below chart min)" : "";
            showTooltip(event, `${MONTH_FULL[monthIndex]}: ${v.toFixed(1)}°C${belowMsg}`);
        })
        .on("mouseout", function() {
            d3.select(this).attr("r", 3);
            hideTooltip();
        });

    // Add markers for values below chart min
    g.selectAll(".temp-below-marker")
        .data(d.t)
        .enter()
        .append("text")
        .attr("class", "temp-below-marker")
        .attr("x", (_, i) => x(i + 1))
        .attr("y", v => v < CHART_TEMP_MIN ? innerHeight - 5 : null)
        .attr("text-anchor", "middle")
        .attr("font-size", 18)
        .attr("font-weight", "bold")
        .attr("fill", "#555555")
        .text(v => v < CHART_TEMP_MIN ? "▼" : "")
        .style("cursor", "pointer")
        .on("mouseover", function(event, v) {
            if (v < CHART_TEMP_MIN) {
                const monthIndex = d.t.indexOf(v);
                d3.select(this).attr("font-size", 22);
                showTooltip(event, `${MONTH_FULL[monthIndex]}: ${v.toFixed(1)}°C (below chart min)`);
            }
        })
        .on("mouseout", function(event, v) {
            if (v < CHART_TEMP_MIN) {
                d3.select(this).attr("font-size", 18);
                hideTooltip();
            }
        });

    g.append("g")
        .attr("class", "chart-axis")
        .call(d3.axisLeft(y).ticks(4));

    g.append("g")
        .attr("class", "chart-axis")
        .attr("transform", `translate(0,${innerHeight})`)
        .call(d3.axisBottom(x).tickValues([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]).tickFormat(i => MONTH_SHORT[i - 1]));
}

/* =========================================================
   Precipitation chart renderer
   ========================================================= */

// Render precipitation bar chart for the provided data; d is single-station data or null
function renderPrecipChart(d) {
    const { innerWidth, innerHeight } = getChartSize();
    const g = baseSvg(precipChartSvg);

    g.append("text")
        .attr("x", 0)
        .attr("y", -26)
        .attr("font-size", 12)
        .attr("font-weight", 800)
        .attr("fill", "#333333")
        .text("Precipitation");

    g.append("text")
        .attr("x", 0)
        .attr("y", -12)
        .attr("font-size", 11)
        .attr("fill", "#777777")
        .text("Month (x) · Precipitation (mm)");

    if (!d) {
        // Render empty axes when no data available
        const months = d3.range(1, 13);
        const x = d3.scaleBand()
            .domain(months)
            .range([0, innerWidth])
            .padding(0.18);

        const y = d3.scaleLinear()
            .domain([0, CHART_PRECIP_MAX])
            .range([innerHeight, 0]);

        g.append("g")
            .attr("class", "chart-axis")
            .call(d3.axisLeft(y).ticks(4));

        g.append("g")
            .attr("class", "chart-axis")
            .attr("transform", `translate(0,${innerHeight})`)
            .call(d3.axisBottom(x).tickFormat((_, i) => i < months.length ? MONTH_SHORT[months[i] - 1] : ""));
        return;
    }

    const x = d3.scaleBand()
        .domain(d3.range(1, 13))
        .range([0, innerWidth])
        .padding(0.18);

    const y = d3.scaleLinear()
        .domain([0, CHART_PRECIP_MAX])
        .range([innerHeight, 0]);

    g.selectAll("rect")
        .data(d.p)
        .enter()
        .append("rect")
        .attr("class", "precip-bar")
        .attr("x", (_, i) => x(i + 1))
        .attr("y", v => {
            const py = y(v);
            return Math.max(0, Math.min(innerHeight, py));
        })
        .attr("width", x.bandwidth())
        .attr("height", v => {
            const py = y(v);
            const clampedY = Math.max(0, Math.min(innerHeight, py));
            return Math.max(0, innerHeight - clampedY);
        })
        .attr("fill", precipColor(d.baseColor))
        .style("cursor", "pointer")
        .on("mouseover", function(event, v) {
            const monthIndex = d.p.indexOf(v);
            d3.select(this).attr("opacity", 0.7);
            const exceedsMsg = v > CHART_PRECIP_MAX ? " (exceeds chart max)" : "";
            showTooltip(event, `${MONTH_FULL[monthIndex]}: ${v.toFixed(1)} mm${exceedsMsg}`);
        })
        .on("mouseout", function() {
            d3.select(this).attr("opacity", 1);
            hideTooltip();
        });

    // Add markers for values exceeding chart max
    g.selectAll(".precip-exceed-marker")
        .data(d.p)
        .enter()
        .append("text")
        .attr("class", "precip-exceed-marker")
        .attr("x", (_, i) => x(i + 1) + x.bandwidth() / 2)
        .attr("y", v => v > CHART_PRECIP_MAX ? 18 : null)
        .attr("text-anchor", "middle")
        .attr("font-size", 18)
        .attr("font-weight", "bold")
        .attr("fill", "#ffffff")
        .text(v => v > CHART_PRECIP_MAX ? "▲" : "")
        .style("cursor", "pointer")
        .on("mouseover", function(event, v) {
            if (v > CHART_PRECIP_MAX) {
                const monthIndex = d.p.indexOf(v);
                d3.select(this).attr("font-size", 22);
                showTooltip(event, `${MONTH_FULL[monthIndex]}: ${v.toFixed(1)} mm (exceeds chart max)`);
            }
        })
        .on("mouseout", function(event, v) {
            if (v > CHART_PRECIP_MAX) {
                d3.select(this).attr("font-size", 18);
                hideTooltip();
            }
        });

    g.append("g")
        .attr("class", "chart-axis")
        .call(d3.axisLeft(y).ticks(4));

    g.append("g")
        .attr("class", "chart-axis")
        .attr("transform", `translate(0,${innerHeight})`)
        .call(d3.axisBottom(x).tickValues([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]).tickFormat(i => MONTH_SHORT[i - 1]));
}

/* =========================================================
   Hover and interaction logic
   ========================================================= */

// Nearest-point and screen->lonlat helpers are provided by ./shared.js

// Update left info panel (labels + charts); d is current station data or null
function updatePanel(d) {
    if (!d) {
        if (climateCoordLabel) {
            climateCoordLabel.innerHTML = "<div class=\"coord-line\"><br></div><div class=\"country-line\"><br></div>";
        }
        climateTypeLabel.textContent = "Hover or search a location";
        climateExplain.innerHTML = `<div class="explain-line"><br></div><div class="explain-line"><br></div><div class="explain-line"><br></div>`;
        renderTempChart(null);
        renderPrecipChart(null);
        return;
    }

    if (climateCoordLabel) {
        const latDir = d.lat >= 0 ? "N" : "S";
        const lonDir = d.lon >= 0 ? "E" : "W";

        const latVal = Math.abs(d.lat).toFixed(2);
        const lonVal = Math.abs(d.lon).toFixed(2);

        const coordText = `${latVal}° ${latDir}, ${lonVal}° ${lonDir}`;
        const countryText = d.countryName ? d.countryName : "<br>";
        climateCoordLabel.innerHTML = `
            <div class="coord-line">${coordText}</div>
            <div class="country-line">${countryText}</div>
        `;
    }

    const kg = d.kg_type || "—";
    climateTypeLabel.textContent = kg;

    const explainLines = explainKgType(kg);
    climateExplain.innerHTML = explainLines
        .map(t => `<div class="explain-line">${t}</div>`)
        .join("");

    renderTempChart(d);
    renderPrecipChart(d);
}

// Hover handling moved to map.js; chart subscribes to events via dispatcher.

/* =========================================================
   Köppen explanation formatter
   ========================================================= */

// Split Köppen code and produce explanation lines
function explainKgType(kg) {
    if (!kg || kg.length < 1) return "";

    const lines = [];
    const main = kg[0];

    // Main line - always show if we have a main type
    if (KOPPEN_MAIN[main]) {
        lines.push(`Main: <strong>${main}</strong> ${KOPPEN_MAIN[main]}`);
    } else {
        lines.push("<br>"); // empty line
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
        lines.push("<br>"); // keep empty temperature line height
    }

    if (precipChar && KOPPEN_PRECIP[precipChar]) {
        lines.push(`Precipitation: <strong>${precipChar}</strong> ${KOPPEN_PRECIP[precipChar]}`);
    } else {
        lines.push("<br>"); // keep empty precipitation line height
    }

    return lines;
}

// Click interaction handled by map.js via dispatcher; chart subscribes to implement lock/unlock
// Subscribe to select events to implement panel lock/unlock
dispatcher.on("select.chart", d => {
    console.debug("[chart] select event -> PANEL_LOCKED=", PANEL_LOCKED, "d=", d);
    if (PANEL_LOCKED) {
        PANEL_LOCKED = false;
        LOCKED_DATA = null;

        if (unlockBtn) {
            unlockBtn.style.display = "none";
        }

        // Notify other modules that the panel was unlocked
        console.debug("[chart] dispatch unlock");
        dispatcher.call("unlock", null);
        return;
    }

    if (!d) return;

    PANEL_LOCKED = true;
    LOCKED_DATA = d;

    if (unlockBtn) {
        unlockBtn.style.display = "block";
    }

    // Notify other modules that the panel was locked to a datum
    console.debug("[chart] dispatch lock ->", LOCKED_DATA);
    dispatcher.call("lock", null, LOCKED_DATA);

    updatePanel(d);
});

/* =========================================================
   Event binding
   ========================================================= */

// Subscribe to hover events published by map.js
dispatcher.on("hover.chart", d => { if (!PANEL_LOCKED) updatePanel(d); });
dispatcher.on("hoverend.chart", () => { if (!PANEL_LOCKED) updatePanel(null); });

// Initialize panel with empty state
updatePanel(null);
