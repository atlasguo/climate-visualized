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

const CHART_TEMP_MIN = -40;
const CHART_TEMP_MAX = 40;
const CHART_PRECIP_MAX = 800;

const MARGIN = { top: 48, right: 32, bottom: 48, left: 42 };

/* =========================================================
   DOM references
   ========================================================= */

const climateCoordLabel = document.getElementById("climate-coord");
const climateTypeLabel  = document.getElementById("climate-type");
const climateExplain    = document.getElementById("climate-explain");
const comboChartSvg     = d3.select("#climateComboChart");

/* =========================================================
   Tab navigation
   ========================================================= */

// Import shared dispatcher and map helpers
import { dispatcher } from "./shared.js";
import { drawAxisLabelsForExport } from "./map.js";

// Panel export logic
function exportPanelAsImage() {
    // Export only from coord to stats (not including action row or below)
    const panel = document.getElementById("panel-body");
    if (!panel) return;

    // Find export range: from coord to stats
    const coord = document.getElementById("climate-coord");
    const stats = document.getElementById("climate-stats");
    if (!coord || !stats) return;

    // Create a range to export
    const range = document.createRange();
    range.setStartBefore(coord);
    range.setEndAfter(stats);

    // Clone the range contents for export
    const exportFragment = range.cloneContents();
    const exportDiv = document.createElement("div");
    exportDiv.style.background = "#fff";
    exportDiv.style.padding = "16px";
    exportDiv.style.display = "flex";
    exportDiv.style.flexDirection = "column";
    exportDiv.style.alignItems = "center";
    exportDiv.appendChild(exportFragment);

    // Add high-res map thumbnail below stats, same width as exportDiv
    const mapCanvas = document.getElementById("mapCanvas");
    if (mapCanvas) {
        const thumbWidth = exportDiv.offsetWidth || panel.offsetWidth || 320;
        const scale = 2; // High-res scale
        const thumb = document.createElement("canvas");
        thumb.width = thumbWidth * scale;
        thumb.height = Math.round(mapCanvas.height * (thumbWidth / mapCanvas.width) * scale);
        const ctx = thumb.getContext("2d");
        ctx.drawImage(mapCanvas, 0, 0, thumb.width, thumb.height);

        const overlayScale = thumb.width / mapCanvas.width;
        drawAxisLabelsForExport(ctx, overlayScale, 26, false);

        // Copy hover circle from overlay (ensures radius matches map exactly)
        const hoverLayer = document.querySelector('.hover-layer');
        const hoverCircleEl = hoverLayer ? hoverLayer.querySelector('circle') : null;
        if (
            hoverCircleEl &&
            hoverLayer &&
            window.getComputedStyle(hoverLayer).display !== 'none'
        ) {
            const cx = parseFloat(hoverCircleEl.getAttribute('cx')) || 0;
            const cy = parseFloat(hoverCircleEl.getAttribute('cy')) || 0;
            const r = parseFloat(hoverCircleEl.getAttribute('r')) || 0;
            const stroke = hoverCircleEl.getAttribute('stroke') || '#e94a4a';
            ctx.save();
            ctx.beginPath();
            ctx.arc(cx * overlayScale, cy * overlayScale, r * overlayScale, 0, 2 * Math.PI);
            ctx.lineWidth = (parseFloat(hoverCircleEl.getAttribute('stroke-width')) || 3) * overlayScale;
            ctx.strokeStyle = stroke;
            ctx.globalAlpha = 0.9;
            ctx.stroke();
            ctx.restore();
        }

        // Copy search marker label and rectangle so exported image mirrors the map annotations
        const searchLayer = document.querySelector('.search-layer');
        if (searchLayer && window.getComputedStyle(searchLayer).display !== 'none') {
            const rect = searchLayer.querySelector('rect');
            if (rect) {
                const x = parseFloat(rect.getAttribute('x')) || 0;
                const y = parseFloat(rect.getAttribute('y')) || 0;
                const w = parseFloat(rect.getAttribute('width')) || 12;
                const h = parseFloat(rect.getAttribute('height')) || 12;
                ctx.save();
                ctx.fillStyle = rect.getAttribute('fill') || 'rgba(0,0,0,0.75)';
                ctx.strokeStyle = rect.getAttribute('stroke') || '#fff';
                ctx.lineWidth = (parseFloat(rect.getAttribute('stroke-width')) || 3) * overlayScale;
                ctx.fillRect(x * overlayScale, y * overlayScale, w * overlayScale, h * overlayScale);
                ctx.strokeRect(x * overlayScale, y * overlayScale, w * overlayScale, h * overlayScale);
                ctx.restore();
            }

            const label = searchLayer.querySelector('text');
            if (label) {
                const lines = Array.from(label.querySelectorAll('tspan')).map(t => t.textContent).filter(Boolean);
                if (lines.length === 0) {
                    lines.push(label.textContent || '');
                }
                const textX = parseFloat(label.getAttribute('x')) || 0;
                const textY = parseFloat(label.getAttribute('y')) || 0;
                ctx.save();
                const fontSize = 21; // Increased by 5px for better visibility
                ctx.font = `bold ${fontSize}px Inter, 'Helvetica Neue', sans-serif`;
                ctx.textAlign = (label.getAttribute('text-anchor') || 'start') === 'middle' ? 'center' : (label.getAttribute('text-anchor') || 'start');
                const baseline = label.getAttribute('dominant-baseline') || 'alphabetic';
                ctx.textBaseline = baseline === 'middle' ? 'middle' : (baseline === 'hanging' ? 'top' : 'alphabetic');
                ctx.fillStyle = '#222';
                ctx.lineWidth = 3;
                ctx.strokeStyle = '#fff';
                const lineHeight = fontSize * 1.2;
                lines.forEach((line, i) => {
                    const y = textY * overlayScale + i * lineHeight;
                    ctx.strokeText(line, textX * overlayScale, y);
                    ctx.fillText(line, textX * overlayScale, y);
                });
                ctx.restore();
            }
        }

        // Downscale for display
        const thumbImg = document.createElement("img");
        thumbImg.src = thumb.toDataURL("image/png");
        thumbImg.style.width = thumbWidth + "px";
        thumbImg.style.height = "auto";
        thumbImg.style.margin = "8px auto 0 auto"; // Reduce top margin to bring map closer
        thumbImg.style.display = "block";
        thumbImg.style.borderRadius = "8px";
        thumbImg.style.boxShadow = "0 2px 8px rgba(0,0,0,0.08)";
        exportDiv.appendChild(thumbImg);
    }

    // Use html2canvas to render only the exportDiv
    document.body.appendChild(exportDiv);
    exportDiv.style.position = "absolute";
    exportDiv.style.left = "-9999px";

    if (window.html2canvas) {
        // Try to get climate type, lat, lon from LOCKED_DATA or fallback to panel
        let kg = "climate";
        let lat = null;
        let lon = null;
        if (window.LOCKED_DATA && typeof window.LOCKED_DATA === 'object') {
            kg = window.LOCKED_DATA.kg_type || kg;
            lat = window.LOCKED_DATA.lat;
            lon = window.LOCKED_DATA.lon;
        } else if (typeof LOCKED_DATA === 'object' && LOCKED_DATA) {
            kg = LOCKED_DATA.kg_type || kg;
            lat = LOCKED_DATA.lat;
            lon = LOCKED_DATA.lon;
        }
        // Fallback: try to parse from DOM if needed
        if (lat == null || lon == null) {
            const coordText = document.getElementById("climate-coord")?.textContent || "";
            const match = coordText.match(/([\d.]+)°\s*([NS]),\s*([\d.]+)°\s*([EW])/);
            if (match) {
                lat = parseFloat(match[1]) * (match[2] === 'S' ? -1 : 1);
                lon = parseFloat(match[3]) * (match[4] === 'W' ? -1 : 1);
            }
        }
        // Format filename
        let fileName = "climate-panel.png";
        if (kg && lat != null && lon != null) {
            const latStr = Number(lat).toFixed(2);
            const lonStr = Number(lon).toFixed(2);
            fileName = `${kg}_${latStr}_${lonStr}.png`;
        }
        window.html2canvas(exportDiv, {
            backgroundColor: '#fff',
            scale: 2
        }).then(canvas => {
            document.body.removeChild(exportDiv);
            const link = document.createElement("a");
            link.download = fileName;
            link.href = canvas.toDataURL("image/png");
            link.click();
        });
    } else {
        document.body.removeChild(exportDiv);
        alert("Export requires html2canvas library. Please include html2canvas.js.");
    }
}

document.addEventListener("DOMContentLoaded", () => {
    const exportBtn = document.getElementById("panel-export-btn");
    const unlockBtn = document.getElementById("panel-unlock-btn");
    if (exportBtn) {
        exportBtn.addEventListener("click", exportPanelAsImage);
    }
    if (unlockBtn) {
        unlockBtn.addEventListener("click", () => {
            if (PANEL_LOCKED) {
                PANEL_LOCKED = false;
                LOCKED_DATA = null;
                // Notify other modules that the panel was unlocked
                dispatcher.call("unlock", null);
                updatePanel(null);
            }
        });
    }
    // Match the current lock state once the DOM is ready
    setPanelActionVisibility(PANEL_LOCKED);
});
// Show/hide panel action row based on lock state
function setPanelActionVisibility(visible) {
    const actionRow = document.querySelector('.panel-action-row');
    if (actionRow) actionRow.style.display = visible ? 'flex' : 'none';
}

// Listen for lock/unlock events to toggle action row
dispatcher.on("lock", () => {
    setPanelActionVisibility(true);
});
dispatcher.on("unlock", () => {
    setPanelActionVisibility(false);
    const hint = document.getElementById('panel-lock-hint');
    if (hint) hint.style.display = 'none';
});

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

function getAvailableChartHeight() {
    const panelBody = document.getElementById("panel-body");
    if (!panelBody) return 180; // fallback

    const containerHeight = panelBody.getBoundingClientRect().height;
    if (containerHeight < 100) return 180; // not yet rendered

    const header = panelBody.querySelector(".panel-header");
    
    const headerHeight = header ? header.getBoundingClientRect().height : 0;
    const spacing = 50; // br elements and padding
    
    // Divide remaining space between two charts
    const availableForCharts = containerHeight - headerHeight - spacing;
    const singleChartHeight = Math.max(150, Math.floor(availableForCharts / 2) - 10);
    
    return singleChartHeight;
}

function getChartSize() {
    // Slightly reduce width to avoid horizontal scroll
    const width = Math.max(180, getPanelWidth() - 32); // was -24, now -32
    // Increase height by 50%
    const height = Math.round(getAvailableChartHeight() * 1.5); // was 1.25, now 1.5
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
        climateExplain.innerHTML = `<div class=\"explain-line\"><br></div><div class=\"explain-line\"><br></div><div class=\"explain-line\"><br></div>`;
        renderComboChart(null);
        // Show stats area with all values as '—'
        const statsDiv = document.getElementById("climate-stats");
        if (statsDiv) {
            statsDiv.innerHTML = `
                <span><span class="stat-label">Annual Mean Temp:</span> <span class="stat-value">–</span></span>
                <span><span class="stat-label">Temp Range:</span> <span class="stat-value">–</span></span>
                <span><span class="stat-label">Annual Precip:</span> <span class="stat-value">–</span></span>
            `;
        }
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

    renderComboChart(d);
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

        // Notify other modules that the panel was unlocked
        console.debug("[chart] dispatch unlock");
        dispatcher.call("unlock", null);
        return;
    }

    if (!d) return;

    PANEL_LOCKED = true;
    LOCKED_DATA = d;

    // Notify other modules that the panel was locked to a datum
    console.debug("[chart] dispatch lock ->", LOCKED_DATA);
    dispatcher.call("lock", null, LOCKED_DATA);

    // Show lock hint below buttons
    const actionRow = document.querySelector('.panel-action-row');
    if (actionRow) {
        let hint = document.getElementById('panel-lock-hint');
        if (!hint) {
            hint = document.createElement('div');
            hint.id = 'panel-lock-hint';
            hint.className = 'panel-lock-hint';
            hint.innerHTML = 'Panel locked to this location.<br>Other climate types are muted (faded).<br>Click Unlock or another place to restore.';
            actionRow.parentNode.insertBefore(hint, actionRow.nextSibling);
        }
        hint.style.display = 'block';
    }
    updatePanel(d);
});

/* =========================================================
   Event binding
   ========================================================= */

// Subscribe to hover events published by map.js
// Update panel while not locked
dispatcher.on("hover.chart", d => {
    if (!PANEL_LOCKED) {
        updatePanel(d);
    }
});
dispatcher.on("hoverend.chart", () => { if (!PANEL_LOCKED) updatePanel(null); });

// Initialize panel with empty state
updatePanel(null);

// Render combined temperature (line, left y-axis) and precipitation (bars, right y-axis) chart
function renderComboChart(d) {
    const { innerWidth, innerHeight } = getChartSize();
    const g = baseSvg(comboChartSvg);

    g.append("text")
        .attr("x", 0)
        .attr("y", -26)
        .attr("font-size", 12)
        .attr("font-weight", 600) // was 800, now 600 for slightly thinner
        .attr("fill", "#333333")
        .text("Temperature & Precipitation");

    g.append("text")
        .attr("x", 0)
        .attr("y", -12)
        .attr("font-size", 11)
        .attr("fill", "#777777")
        .text("Month (x) · Temp (°C, left) · Precip (mm, right)");

    const months = d3.range(1, 13);
    const x = d3.scaleBand()
        .domain(months)
        .range([0, innerWidth])
        .padding(0.18);

    // Left y-axis: temperature
    const yTemp = d3.scaleLinear()
        .domain([CHART_TEMP_MIN, CHART_TEMP_MAX])
        .range([innerHeight, 0]);
    // Right y-axis: precipitation
    const yPrecip = d3.scaleLinear()
        .domain([0, CHART_PRECIP_MAX])
        .range([innerHeight, 0]);

    // Draw grid lines first (background)
    g.append("g")
        .attr("class", "chart-grid")
        .selectAll("line")
        .data(yTemp.ticks(4))
        .enter()
        .append("line")
        .attr("x1", 0)
        .attr("x2", innerWidth)
        .attr("y1", d => yTemp(d))
        .attr("y2", d => yTemp(d))
        .attr("stroke", "#e5e5e5")
        .attr("stroke-width", 1)
        .attr("stroke-dasharray", "2,2");

    g.append("g")
        .attr("class", "chart-grid")
        .selectAll("line")
        .data(months)
        .enter()
        .append("line")
        .attr("y1", 0)
        .attr("y2", innerHeight)
        .attr("x1", m => x(m) + x.bandwidth() / 2)
        .attr("x2", m => x(m) + x.bandwidth() / 2)
        .attr("stroke", "#e5e5e5")
        .attr("stroke-width", 1)
        .attr("stroke-dasharray", "2,2");

    // Draw axes
    g.append("g")
        .attr("class", "chart-axis")
        .call(d3.axisLeft(yTemp).ticks(4));
    g.append("g")
        .attr("class", "chart-axis")
        .attr("transform", `translate(${innerWidth},0)`)
        .call(d3.axisRight(yPrecip).ticks(4));
    g.append("g")
        .attr("class", "chart-axis")
        .attr("transform", `translate(0,${innerHeight})`)
        .call(d3.axisBottom(x).tickFormat((_, i) => MONTH_SHORT[i]));

    if (!d) return;

    g.selectAll(".precip-bar")
        .data(d.p)
        .enter()
        .append("rect")
        .attr("class", "precip-bar")
        .attr("x", (_, i) => x(i + 1))
        .attr("y", v => yPrecip(Math.min(v, CHART_PRECIP_MAX)))
        .attr("width", x.bandwidth())
        .attr("height", v => innerHeight - yPrecip(Math.min(v, CHART_PRECIP_MAX)))
        .attr("fill", precipColor(d.baseColor))
        .attr("opacity", 0.75)
        .on("mouseover", function(event, v) {
            const monthIndex = d.p.indexOf(v);
            const aboveMsg = v > CHART_PRECIP_MAX ? " (above chart max)" : "";
            showTooltip(event, `${MONTH_FULL[monthIndex]}: ${v.toFixed(1)} mm${aboveMsg}`);
        })
        .on("mouseout", hideTooltip);

    // Add markers for values above chart max
    g.selectAll(".precip-above-marker")
        .data(d.p)
        .enter()
        .append("text")
        .attr("class", "precip-above-marker")
        .attr("x", (_, i) => x(i + 1) + x.bandwidth() / 2)
        .attr("y", v => v > CHART_PRECIP_MAX ? yPrecip(CHART_PRECIP_MAX) + 16 : null)
        .attr("text-anchor", "middle")
        .attr("font-size", 18)
        .attr("font-weight", "bold")
        .attr("fill", "#fff") // white triangle
        .text(v => v > CHART_PRECIP_MAX ? "▲" : "")
        .style("cursor", "pointer")
        .on("mouseover", function(event, v) {
            if (v > CHART_PRECIP_MAX) {
                const monthIndex = d.p.indexOf(v);
                d3.select(this).attr("font-size", 22);
                showTooltip(event, `${MONTH_FULL[monthIndex]}: ${v.toFixed(1)} mm (above chart max)`);
            }
        })
        .on("mouseout", function(event, v) {
            if (v > CHART_PRECIP_MAX) {
                d3.select(this).attr("font-size", 18);
                hideTooltip();
            }
        });

    // Temperature line (left y-axis)
    const line = d3.line()
        .x((_, i) => x(i + 1) + x.bandwidth() / 2)
        .y(v => yTemp(Math.max(v, CHART_TEMP_MIN)))
        .curve(d3.curveMonotoneX);

    g.append("path")
        .datum(d.t)
        .attr("class", "temp-line")
        .attr("stroke", tempColor(d.baseColor))
        .attr("d", line)
        .attr("fill", "none");

    // Data points for temperature
    g.selectAll(".temp-point")
        .data(d.t)
        .enter()
        .append("circle")
        .attr("class", "temp-point")
        .attr("cx", (_, i) => x(i + 1) + x.bandwidth() / 2)
        .attr("cy", v => yTemp(Math.max(v, CHART_TEMP_MIN)))
        .attr("r", 5) // larger for easier hover
        .attr("fill", tempColor(d.baseColor))
        .attr("stroke", "#fff")
        .attr("stroke-width", 1.5)
        .style("cursor", "pointer")
        .on("mouseover", function(event, v) {
            const monthIndex = d.t.indexOf(v);
            const belowMsg = v < CHART_TEMP_MIN ? " (below chart min)" : "";
            showTooltip(event, `${MONTH_FULL[monthIndex]}: ${v.toFixed(1)}°C${belowMsg}`);
        })
        .on("mouseout", hideTooltip);

    // Add markers for values below chart min
    g.selectAll(".temp-below-marker")
        .data(d.t)
        .enter()
        .append("text")
        .attr("class", "temp-below-marker")
        .attr("x", (_, i) => x(i + 1) + x.bandwidth() / 2)
        .attr("y", v => v < CHART_TEMP_MIN ? yTemp(CHART_TEMP_MIN) - 5 : null)
        .attr("text-anchor", "middle")
        .attr("font-size", 18)
        .attr("font-weight", "bold")
        .attr("fill", tempColor(d.baseColor))
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

    // Update climate stats below the chart
    const statsDiv = document.getElementById("climate-stats");
    if (statsDiv && d) {
        // Calculate stats
        const meanTemp = d.t && d.t.length ? (d.t.reduce((a, b) => a + b, 0) / d.t.length) : null;
        const tempRange = d.t && d.t.length ? (Math.max(...d.t) - Math.min(...d.t)) : null;
        const totalPrecip = d.p && d.p.length ? d.p.reduce((a, b) => a + b, 0) : null;
        statsDiv.innerHTML = `
            <span><span class=\"stat-label\">Annual Mean Temp:</span> <span class=\"stat-value\">${meanTemp !== null ? meanTemp.toFixed(1) + '°C' : '–'}</span></span>
            <span><span class=\"stat-label\">Temp Range:</span> <span class=\"stat-value\">${tempRange !== null ? tempRange.toFixed(1) + '°C' : '–'}</span></span>
            <span><span class=\"stat-label\">Annual Precip:</span> <span class=\"stat-value\">${totalPrecip !== null ? totalPrecip.toFixed(0) + ' mm' : '–'}</span></span>
        `;
    }
}
