/* =========================================================
   chart-tab-overall.js
   Tab1: Overall climate info with combined temperature & precipitation chart
   ========================================================= */

import {
    MONTH_SHORT, MONTH_FULL, KOPPEN_TEMP, KOPPEN_PRECIP,
    CHART_TEMP_MIN, CHART_TEMP_MAX, CHART_PRECIP_MAX,
    tempColor, precipColor, bindTooltipInteraction, shouldUseHoverPreview,
    getChartSize, baseSvg, appendChartHeading, explainKgType,
    updateCoordinateDisplay,
    dispatcher, STATE, getExportingState, setExportingState
} from "./chart-common.js";
import { drawAxisLabelsForExport } from "./map.js";
import { showLoading, hideLoading } from "./loading.js";

/* =========================================================
   Panel state and DOM references
   ========================================================= */
export let PANEL_LOCKED = false;
export let LOCKED_DATA = null;
let panelHasData = false;
let hoverDatum = null;

const climateCoordLabel = document.getElementById("climate-coord");
const climateTypeLabel  = document.getElementById("climate-type");
const climateExplain    = document.getElementById("climate-explain");
const comboChartSvg     = d3.select("#climateComboChart");
const EXPORT_FONT_FAMILY = getComputedStyle(document.documentElement)
    .getPropertyValue("--font-family")
    .trim() || "Inter, system-ui, -apple-system, BlinkMacSystemFont, \"Helvetica Neue\", Arial, sans-serif";

/* =========================================================
   Lock/Unlock state management
   ========================================================= */
export function setPanelLocked(value, data = null) {
    PANEL_LOCKED = value;
    LOCKED_DATA = data;
}

export function getLockState() {
    return { locked: PANEL_LOCKED, data: LOCKED_DATA };
}

export function hasPanelData() {
    return panelHasData;
}

/* =========================================================
   Hover handlers for centralized management in chart.js
   ========================================================= */
export function handleOverallTabHover(d) {
    const { locked } = getLockState();
    if (locked) return;
    hoverDatum = d || null;
    updateCoordinateDisplay(d);
    updatePanel(d, false); // No animation on hover
}

export function handleOverallTabHoverEnd() {
    const { locked } = getLockState();
    if (locked) return;
    hoverDatum = null;
    updateCoordinateDisplay(null);
    updatePanel(null, false); // No animation when clearing
}

/* =========================================================
   Panel export logic - Chart only (no map)
   ========================================================= */
export function exportChartOnly() {
    // Prevent concurrent exports
    if (getExportingState()) {
        return;
    }
    
    const panel = document.getElementById("panel-body");
    if (!panel) return;

    const coord = document.getElementById("climate-coord");
    const stats = document.getElementById("climate-stats");
    if (!coord || !stats) return;

    setExportingState(true);
    showLoading('Exporting chart...');

    setTimeout(() => {
        requestAnimationFrame(() => {
            try {
                const range = document.createRange();
                range.setStartBefore(coord);
                range.setEndAfter(stats);

                const exportFragment = range.cloneContents();
                const exportDiv = document.createElement("div");
                exportDiv.style.background = "#fff";
                exportDiv.style.padding = "16px";
                exportDiv.style.display = "flex";
                exportDiv.style.flexDirection = "column";
                exportDiv.style.alignItems = "center";
                exportDiv.appendChild(exportFragment);

                // Remove action buttons, tab buttons, and hint text from export
                exportDiv.querySelectorAll('.panel-action-row, .panel-hint, .panel-lock-hint, .panel-tabs').forEach(el => el.remove());

                // No map thumbnail - chart only

                document.body.appendChild(exportDiv);
                exportDiv.style.position = "absolute";
                exportDiv.style.left = "-9999px";

                if (window.html2canvas) {
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
                if (lat == null || lon == null) {
                    const coordText = document.getElementById("climate-coord")?.textContent || "";
                    const match = coordText.match(/([\d.]+)°\s*([NS]),\s*([\d.]+)°\s*([EW])/);
                    if (match) {
                        lat = parseFloat(match[1]) * (match[2] === 'S' ? -1 : 1);
                        lon = parseFloat(match[3]) * (match[4] === 'W' ? -1 : 1);
                    }
                }
                let fileName = "climate-chart.png";
                if (kg && lat != null && lon != null) {
                    const latStr = Number(lat).toFixed(2);
                    const lonStr = Number(lon).toFixed(2);
                    fileName = `${kg}_chart_${latStr}_${lonStr}.png`;
                }
                window.html2canvas(exportDiv, {
                    backgroundColor: '#fff',
                    scale: 1.5,
                    allowTaint: true,
                    useCORS: false,
                    logging: false,
                    onclone: (clonedDoc) => {
                        // Ensure cloned styles are applied
                        const clonedDiv = clonedDoc.querySelector('[style*="position: absolute"]');
                        if (clonedDiv) {
                            clonedDiv.style.position = 'relative';
                            clonedDiv.style.left = '0';
                            clonedDiv.style.top = '0';
                        }
                    }
                }).then(canvas => {
                    try {
                        document.body.removeChild(exportDiv);
                        const link = document.createElement("a");
                        link.download = fileName;
                        link.href = canvas.toDataURL("image/png", 0.95);
                        link.click();
                        hideLoading();
                        setExportingState(false);
                    } catch (e) {
                        console.error("Download error:", e);
                        hideLoading();
                        setExportingState(false);
                        alert("Failed to download image.");
                    }
                }).catch(err => {
                    console.error("Export failed:", err);
                    try {
                        if (exportDiv.parentNode) {
                            document.body.removeChild(exportDiv);
                        }
                    } catch (e) {}
                    hideLoading();
                    setExportingState(false);
                    alert("Export failed. Please try again.");
                });
            } else {
                document.body.removeChild(exportDiv);
                hideLoading();
                setExportingState(false);
                alert("Export requires html2canvas library. Please include html2canvas.js.");
            }
        } catch (err) {
            console.error("Export error:", err);
            hideLoading();
            setExportingState(false);
        }
        });
    }, 150);
}

/* =========================================================
   Panel export logic - Original (with map)
   ========================================================= */
export function exportPanelAsImage() {
    // Prevent concurrent exports
    if (getExportingState()) {
        return;
    }
    
    const panel = document.getElementById("panel-body");
    if (!panel) return;

    const coord = document.getElementById("climate-coord");
    const stats = document.getElementById("climate-stats");
    if (!coord || !stats) return;

    setExportingState(true);
    showLoading('Exporting image...');

    setTimeout(() => {
        requestAnimationFrame(() => {
            try {
                const range = document.createRange();
                range.setStartBefore(coord);
                range.setEndAfter(stats);

                const exportFragment = range.cloneContents();
                const exportDiv = document.createElement("div");
                exportDiv.style.background = "#fff";
                exportDiv.style.padding = "16px";
                exportDiv.style.display = "flex";
                exportDiv.style.flexDirection = "column";
                exportDiv.style.alignItems = "center";
                exportDiv.appendChild(exportFragment);

                const mapCanvas = document.getElementById("mapCanvas");
                if (mapCanvas) {
                const thumbWidth = exportDiv.offsetWidth || panel.offsetWidth || 320;
                const scale = 1.5;
                const thumb = document.createElement("canvas");
                thumb.width = thumbWidth * scale;
                thumb.height = Math.round(mapCanvas.height * (thumbWidth / mapCanvas.width) * scale);
                const ctx = thumb.getContext("2d", { willReadFrequently: false });

                if (window.redrawMapForExport) {
                    window.redrawMapForExport();
                    ctx.drawImage(mapCanvas, 0, 0, thumb.width, thumb.height);
                } else {
                    ctx.drawImage(mapCanvas, 0, 0, thumb.width, thumb.height);
                }

                    const mapRect = mapCanvas.getBoundingClientRect();
                    const overlayScale = mapRect.width > 0 ? (thumb.width / mapRect.width) : 1;
                    drawAxisLabelsForExport(ctx, overlayScale, 26, true);

                if (PANEL_LOCKED && LOCKED_DATA) {
                    const hoverLayer = document.querySelector('.hover-layer');
                    const hoverCircleEl = hoverLayer ? hoverLayer.querySelector('circle') : null;
                    let circleDrawn = false;

                    if (hoverCircleEl) {
                        const cx = parseFloat(hoverCircleEl.getAttribute('cx')) || 0;
                        const cy = parseFloat(hoverCircleEl.getAttribute('cy')) || 0;
                        const r = parseFloat(hoverCircleEl.getAttribute('r')) || 0;
                        if (cx > 0 && cy > 0 && r > 0) {
                            const stroke = hoverCircleEl.getAttribute('stroke') || '#e94a4a';
                            ctx.save();
                            ctx.beginPath();
                            ctx.arc(cx * overlayScale, cy * overlayScale, r * overlayScale, 0, 2 * Math.PI);
                            ctx.lineWidth = (parseFloat(hoverCircleEl.getAttribute('stroke-width')) || 3) * overlayScale;
                            ctx.strokeStyle = stroke;
                            ctx.globalAlpha = 0.9;
                            ctx.stroke();
                            ctx.restore();
                            circleDrawn = true;
                        }
                    }

                    if (!circleDrawn) {
                        const svg = document.querySelector('#overlay');
                        if (svg) {
                            const circles = svg.querySelectorAll('circle');
                            for (const circle of circles) {
                                const cx = parseFloat(circle.getAttribute('cx')) || 0;
                                const cy = parseFloat(circle.getAttribute('cy')) || 0;
                                const r = parseFloat(circle.getAttribute('r')) || 0;

                                if (cx > 0 && cy > 0 && r > 0) {
                                    const stroke = circle.getAttribute('stroke') || circle.style.stroke || '#e94a4a';
                                    const strokeWidth = parseFloat(circle.getAttribute('stroke-width') || circle.style.strokeWidth) || 3;

                                    ctx.save();
                                    ctx.beginPath();
                                    ctx.arc(cx * overlayScale, cy * overlayScale, r * overlayScale, 0, 2 * Math.PI);
                                    ctx.lineWidth = strokeWidth * overlayScale;
                                    ctx.strokeStyle = stroke;
                                    ctx.globalAlpha = 0.9;
                                    ctx.stroke();
                                    ctx.restore();
                                    circleDrawn = true;
                                    break;
                                }
                            }
                        }
                    }
                }

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
                        const fontSize = 21;
                        ctx.font = `bold ${fontSize}px ${EXPORT_FONT_FAMILY}`;
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

                const thumbImg = document.createElement("img");
                thumbImg.src = thumb.toDataURL("image/png");
                thumbImg.style.width = thumbWidth + "px";
                thumbImg.style.height = "auto";
                thumbImg.style.margin = "8px auto 0 auto";
                thumbImg.style.display = "block";
                thumbImg.style.borderRadius = "8px";
                thumbImg.style.boxShadow = "0 2px 8px rgba(0,0,0,0.08)";
                exportDiv.appendChild(thumbImg);
                }

            document.body.appendChild(exportDiv);
            exportDiv.style.position = "absolute";
            exportDiv.style.left = "-9999px";

            if (window.html2canvas) {
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
                if (lat == null || lon == null) {
                    const coordText = document.getElementById("climate-coord")?.textContent || "";
                    const match = coordText.match(/([\d.]+)°\s*([NS]),\s*([\d.]+)°\s*([EW])/);
                    if (match) {
                        lat = parseFloat(match[1]) * (match[2] === 'S' ? -1 : 1);
                        lon = parseFloat(match[3]) * (match[4] === 'W' ? -1 : 1);
                    }
                }
                let fileName = "climate-panel.png";
                if (kg && lat != null && lon != null) {
                    const latStr = Number(lat).toFixed(2);
                    const lonStr = Number(lon).toFixed(2);
                    fileName = `${kg}_${latStr}_${lonStr}.png`;
                }
                window.html2canvas(exportDiv, {
                    backgroundColor: '#fff',
                    scale: 1.5,
                    allowTaint: true,
                    useCORS: false,
                    logging: false,
                    onclone: (clonedDoc) => {
                        // Ensure cloned styles are applied
                        const clonedDiv = clonedDoc.querySelector('[style*="position: absolute"]');
                        if (clonedDiv) {
                            clonedDiv.style.position = 'relative';
                            clonedDiv.style.left = '0';
                            clonedDiv.style.top = '0';
                        }
                    }
                }).then(canvas => {
                    try {
                        document.body.removeChild(exportDiv);
                        const link = document.createElement("a");
                        link.download = fileName;
                        link.href = canvas.toDataURL("image/png", 0.95);
                        link.click();
                        hideLoading();
                        setExportingState(false);
                        if (window.redrawMap) {
                            window.redrawMap();
                        }
                    } catch (e) {
                        console.error("Download error:", e);
                        hideLoading();
                        setExportingState(false);
                        if (window.redrawMap) {
                            window.redrawMap();
                        }
                        alert("Failed to download image.");
                    }
                }).catch(err => {
                    console.error("Export failed:", err);
                    try {
                        if (exportDiv.parentNode) {
                            document.body.removeChild(exportDiv);
                        }
                    } catch (e) {}
                    hideLoading();
                    setExportingState(false);
                    if (window.redrawMap) {
                        window.redrawMap();
                    }
                    alert("Export failed. Please try again.");
                });
            } else {
                document.body.removeChild(exportDiv);
                hideLoading();
                setExportingState(false);
                if (window.redrawMap) {
                    window.redrawMap();
                }
                alert("Export requires html2canvas library. Please include html2canvas.js.");
            }
        } catch (err) {
            console.error("Export error:", err);
            hideLoading();
            setExportingState(false);
            if (window.redrawMap) {
                window.redrawMap();
            }
        }
        });
    }, 150);
}

/* =========================================================
   Panel UI management
   ========================================================= */
export function setPanelActionVisibility(visible) {
    // Control unlock buttons by disabling when not locked
    const unlockButtons = document.querySelectorAll('.panel-unlock-btn');
    unlockButtons.forEach(btn => {
        btn.disabled = !visible;
        btn.setAttribute('aria-disabled', (!visible).toString());
    });
}

/* =========================================================
   Panel update logic
   ========================================================= */
export function updatePanel(d, withAnimation = false) {
    if (!d) {
        panelHasData = false;
        climateTypeLabel.textContent = "Select or search a location";
        climateExplain.innerHTML = `<div class=\"explain-line\"><br></div><div class=\"explain-line\"><br></div><div class=\"explain-line\"><br></div>`;
        renderComboChart(null, withAnimation);
        const statsDiv = document.getElementById("climate-stats");
        if (statsDiv) {
            statsDiv.innerHTML = `
                <span><span class="stat-label">Annual Mean Temp:</span> <span class="stat-value">-</span></span>
                <span><span class="stat-label">Temp Range:</span> <span class="stat-value">-</span></span>
                <span><span class="stat-label">Annual Precip:</span> <span class="stat-value">-</span></span>
            `;
        }
        return;
    }

    panelHasData = true;

    climateTypeLabel.textContent = d.kg_type || "-";
    climateExplain.innerHTML = explainKgType(d.kg_type || "")
        .map(t => `<div class="explain-line">${t}</div>`)
        .join("");
    renderComboChart(d, withAnimation);
}

export function redrawComboChart() {
    renderComboChart(LOCKED_DATA, false);
}

/* =========================================================
   Combined temperature & precipitation chart (Tab1)
   ========================================================= */
function showHoverGuide(xPos, hoverLayer, innerHeight) {
    hoverLayer.selectAll(".hover-guide-line").remove();
    hoverLayer.append("line")
        .attr("class", "hover-guide-line")
        .attr("x1", xPos)
        .attr("x2", xPos)
        .attr("y1", 0)
        .attr("y2", innerHeight)
        .attr("stroke", "#999")
        .attr("stroke-width", 1)
        .attr("stroke-dasharray", "4,4")
        .attr("opacity", 0.5);
}

function clearHoverGuides(hoverLayer) {
    hoverLayer.selectAll(".hover-guide-line").remove();
}

export function renderComboChart(d, withAnimation = false) {
    const svgElement = document.getElementById("climateComboChart");
    if (!svgElement) return;

    const comboChartSvg = d3.select(svgElement);
    const { innerWidth, innerHeight } = getChartSize();
    const g = baseSvg(comboChartSvg);

    appendChartHeading(
        g,
        "Temperature & Precipitation",
        "Month (x) / Temp (°C, left) / Precip (mm, right)"
    );

    const months = d3.range(1, 13);
    const x = d3.scaleBand()
        .domain(months)
        .range([0, innerWidth])
        .padding(0.18);

    const yTemp = d3.scaleLinear()
        .domain([CHART_TEMP_MIN, CHART_TEMP_MAX])
        .range([innerHeight, 0]);
    const yPrecip = d3.scaleLinear()
        .domain([0, CHART_PRECIP_MAX])
        .range([innerHeight, 0]);

    g.append("g")
        .attr("class", "chart-grid")
        .selectAll("line")
        .data(yTemp.ticks(8))
        .enter()
        .append("line")
        .attr("x1", 0)
        .attr("x2", innerWidth)
        .attr("y1", value => yTemp(value))
        .attr("y2", value => yTemp(value))
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
        .attr("x1", month => x(month) + x.bandwidth() / 2)
        .attr("x2", month => x(month) + x.bandwidth() / 2)
        .attr("stroke", "#e5e5e5")
        .attr("stroke-width", 1)
        .attr("stroke-dasharray", "2,2");

    g.append("g")
        .attr("class", "chart-axis")
        .call(d3.axisLeft(yTemp).ticks(8));
    g.append("g")
        .attr("class", "chart-axis")
        .attr("transform", `translate(${innerWidth},0)`)
        .call(d3.axisRight(yPrecip).ticks(8));
    g.append("g")
        .attr("class", "chart-axis")
        .attr("transform", `translate(0,${innerHeight})`)
        .call(d3.axisBottom(x).tickFormat((_, i) => MONTH_SHORT[i]));

    if (!d) return;

    const hoverLayer = g.append("g").attr("class", "hover-effects");
    const useHoverPreview = shouldUseHoverPreview();

    const precipBars = g.selectAll(".precip-bar")
        .data(d.p)
        .enter()
        .append("rect")
        .attr("class", "precip-bar")
        .attr("x", (_, i) => x(i + 1))
        .attr("y", withAnimation ? innerHeight : value => yPrecip(Math.min(value, CHART_PRECIP_MAX)))
        .attr("width", x.bandwidth())
        .attr("height", withAnimation ? 0 : value => innerHeight - yPrecip(Math.min(value, CHART_PRECIP_MAX)))
        .attr("fill", precipColor(d.baseColor))
        .attr("opacity", 0.75)
        .style("transition", "opacity 0.2s ease");

    if (useHoverPreview) {
        precipBars
            .on("pointerenter", function(event, value) {
                const monthIndex = d.p.indexOf(value);
                d3.selectAll(".precip-bar").attr("opacity", 0.4);
                d3.select(this).attr("opacity", 1.0);
                showHoverGuide(x(monthIndex + 1) + x.bandwidth() / 2, hoverLayer, innerHeight);
            })
            .on("pointerleave", function() {
                d3.selectAll(".precip-bar").attr("opacity", 0.75);
                clearHoverGuides(hoverLayer);
            });
    }

    bindTooltipInteraction(
        precipBars,
        (_, value) => {
            const monthIndex = d.p.indexOf(value);
            const aboveMsg = value > CHART_PRECIP_MAX ? " (above chart max)" : "";
            return `${MONTH_FULL[monthIndex]}: ${value.toFixed(1)} mm${aboveMsg}`;
        },
        "overall-precip-bar"
    );

    if (withAnimation) {
        precipBars
            .transition()
            .duration(400)
            .delay((_, i) => i * 30)
            .attr("y", value => yPrecip(Math.min(value, CHART_PRECIP_MAX)))
            .attr("height", value => innerHeight - yPrecip(Math.min(value, CHART_PRECIP_MAX)));
    }

    const precipMarkers = g.selectAll(".precip-above-marker")
        .data(d.p)
        .enter()
        .append("text")
        .attr("class", "precip-above-marker")
        .attr("x", (_, i) => x(i + 1) + x.bandwidth() / 2)
        .attr("y", value => value > CHART_PRECIP_MAX ? yPrecip(CHART_PRECIP_MAX) + 16 : null)
        .attr("text-anchor", "middle")
        .attr("font-size", 18)
        .attr("font-weight", "bold")
        .attr("fill", "#ffffff")
        .attr("opacity", withAnimation ? 0 : 1)
        .text(value => value > CHART_PRECIP_MAX ? "▲" : "")
        .style("transition", "font-size 0.2s ease");

    if (useHoverPreview) {
        precipMarkers
            .on("pointerenter", function(event, value) {
                if (value <= CHART_PRECIP_MAX) return;
                const monthIndex = d.p.indexOf(value);
                d3.select(this).attr("font-size", 24);
                showHoverGuide(x(monthIndex + 1) + x.bandwidth() / 2, hoverLayer, innerHeight);
            })
            .on("pointerleave", function(event, value) {
                if (value <= CHART_PRECIP_MAX) return;
                d3.select(this).attr("font-size", 18);
                clearHoverGuides(hoverLayer);
            });
    }

    bindTooltipInteraction(
        precipMarkers.filter(value => value > CHART_PRECIP_MAX),
        (_, value) => {
            const monthIndex = d.p.indexOf(value);
            return `${MONTH_FULL[monthIndex]}: ${value.toFixed(1)} mm (above chart max)`;
        },
        "overall-precip-marker"
    );

    if (withAnimation) {
        precipMarkers
            .transition()
            .duration(400)
            .delay((_, i) => i * 30 + 200)
            .attr("opacity", 1);
    }

    const line = d3.line()
        .x((_, i) => x(i + 1) + x.bandwidth() / 2)
        .y(value => yTemp(Math.max(value, CHART_TEMP_MIN)))
        .curve(d3.curveMonotoneX);

    const tempPath = g.append("path")
        .datum(d.t)
        .attr("class", "temp-line")
        .attr("stroke", tempColor(d.baseColor))
        .attr("d", line)
        .attr("fill", "none");

    if (withAnimation) {
        const totalLength = tempPath.node().getTotalLength();
        tempPath
            .attr("stroke-dasharray", `${totalLength} ${totalLength}`)
            .attr("stroke-dashoffset", totalLength)
            .transition()
            .duration(600)
            .ease(d3.easeLinear)
            .attr("stroke-dashoffset", 0)
            .on("end", function() {
                d3.select(this).attr("stroke-dasharray", "none");
            });
    }

    const tempPoints = g.selectAll(".temp-point")
        .data(d.t)
        .enter()
        .append("circle")
        .attr("class", "temp-point")
        .attr("cx", (_, i) => x(i + 1) + x.bandwidth() / 2)
        .attr("cy", value => yTemp(Math.max(value, CHART_TEMP_MIN)))
        .attr("r", withAnimation ? 0 : 5)
        .attr("fill", tempColor(d.baseColor))
        .attr("stroke", "#ffffff")
        .attr("stroke-width", 1.5)
        .style("transition", "r 0.2s ease");

    if (useHoverPreview) {
        tempPoints
            .on("pointerenter", function(event, value) {
                const monthIndex = d.t.indexOf(value);
                d3.selectAll(".temp-point").attr("r", 5).attr("opacity", 0.5);
                d3.select(this).attr("r", 8).attr("opacity", 1.0);
                showHoverGuide(x(monthIndex + 1) + x.bandwidth() / 2, hoverLayer, innerHeight);
            })
            .on("pointerleave", function() {
                d3.selectAll(".temp-point").attr("r", 5).attr("opacity", 1.0);
                clearHoverGuides(hoverLayer);
            });
    }

    bindTooltipInteraction(
        tempPoints,
        (_, value) => {
            const monthIndex = d.t.indexOf(value);
            const belowMsg = value < CHART_TEMP_MIN ? " (below chart min)" : "";
            return `${MONTH_FULL[monthIndex]}: ${value.toFixed(1)}°C${belowMsg}`;
        },
        "overall-temp-point"
    );

    if (withAnimation) {
        tempPoints
            .transition()
            .duration(300)
            .delay((_, i) => i * 40 + 400)
            .attr("r", 5);
    }

    const tempMarkers = g.selectAll(".temp-below-marker")
        .data(d.t)
        .enter()
        .append("text")
        .attr("class", "temp-below-marker")
        .attr("x", (_, i) => x(i + 1) + x.bandwidth() / 2)
        .attr("y", value => value < CHART_TEMP_MIN ? yTemp(CHART_TEMP_MIN) - 5 : null)
        .attr("text-anchor", "middle")
        .attr("font-size", 18)
        .attr("font-weight", "bold")
        .attr("fill", tempColor(d.baseColor))
        .attr("opacity", withAnimation ? 0 : 1)
        .text(value => value < CHART_TEMP_MIN ? "▼" : "")
        .style("transition", "font-size 0.2s ease");

    if (useHoverPreview) {
        tempMarkers
            .on("pointerenter", function(event, value) {
                if (value >= CHART_TEMP_MIN) return;
                const monthIndex = d.t.indexOf(value);
                d3.select(this).attr("font-size", 24);
                showHoverGuide(x(monthIndex + 1) + x.bandwidth() / 2, hoverLayer, innerHeight);
            })
            .on("pointerleave", function(event, value) {
                if (value >= CHART_TEMP_MIN) return;
                d3.select(this).attr("font-size", 18);
                clearHoverGuides(hoverLayer);
            });
    }

    bindTooltipInteraction(
        tempMarkers.filter(value => value < CHART_TEMP_MIN),
        (_, value) => {
            const monthIndex = d.t.indexOf(value);
            return `${MONTH_FULL[monthIndex]}: ${value.toFixed(1)}°C (below chart min)`;
        },
        "overall-temp-marker"
    );

    if (withAnimation) {
        tempMarkers
            .transition()
            .duration(300)
            .delay((_, i) => i * 40 + 600)
            .attr("opacity", 1);
    }

    const statsDiv = document.getElementById("climate-stats");
    if (statsDiv && d) {
        const meanTemp = d.t?.length ? d.t.reduce((a, b) => a + b, 0) / d.t.length : null;
        const tempRange = d.t?.length ? Math.max(...d.t) - Math.min(...d.t) : null;
        const totalPrecip = d.p?.length ? d.p.reduce((a, b) => a + b, 0) : null;
        statsDiv.innerHTML = `
            <span><span class="stat-label">Annual Mean Temp:</span> <span class="stat-value">${meanTemp !== null ? `${meanTemp.toFixed(1)}°C` : "-"}</span></span>
            <span><span class="stat-label">Temp Range:</span> <span class="stat-value">${tempRange !== null ? `${tempRange.toFixed(1)}°C` : "-"}</span></span>
            <span><span class="stat-label">Annual Precip:</span> <span class="stat-value">${totalPrecip !== null ? `${totalPrecip.toFixed(0)} mm` : "-"}</span></span>
        `;
    }
}

/* =========================================================
   Tab1 Event Handlers
   ========================================================= */
export function initOverallTab() {
    dispatcher.on("lock.overallTab", () => {
        if (document.getElementById("tab-overall")?.classList.contains("active")) {
            setTimeout(() => {
                updatePanel(LOCKED_DATA, true);
            }, 0);
        }
    });

    dispatcher.on("unlock.overallTab", () => {
        hoverDatum = null;
        if (document.getElementById("tab-overall")?.classList.contains("active")) {
            updatePanel(null, false);
        }
    });

    const panelBody = document.getElementById("panel-body");
    if (panelBody && window.ResizeObserver) {
        const resizeObserver = new ResizeObserver(() => {
            if (!document.getElementById("tab-overall")?.classList.contains("active")) return;
            setTimeout(() => {
                updatePanel(PANEL_LOCKED ? LOCKED_DATA : hoverDatum, false);
            }, 0);
        });
        resizeObserver.observe(panelBody);
    }
}
