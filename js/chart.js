/* =========================================================
   chart.js
   Climate visualization chart management - main entry point
   Orchestrates Tab1 (Overall), Tab2 (Temperature), Tab3 (Precipitation)
   ========================================================= */

// Import tab modules
import {
    PANEL_LOCKED,
    LOCKED_DATA,
    setPanelLocked,
    getLockState,
    setPanelActionVisibility,
    exportPanelAsImage,
    exportChartOnly,
    updatePanel,
    redrawComboChart,
    renderComboChart,
    hasPanelData,
    initOverallTab,
    handleOverallTabHover,
    handleOverallTabHoverEnd
} from "./chart-tab-overall.js";

import {
    drawTemperatureScatter,
    drawMonthlyTemperature,
    initTemperatureTab,
    handleTemperatureTabHover,
    handleTemperatureTabHoverEnd
} from "./chart-tab-temperature.js";

import {
    drawPrecipitationScatter,
    drawMonthlyPrecipitation,
    initPrecipitationTab,
    handlePrecipitationTabHover,
    handlePrecipitationTabHoverEnd
} from "./chart-tab-precipitation.js";

// Import shared utilities
import { dispatcher, getExportingState, setExportingState, updateCoordinateDisplay } from "./chart-common.js";
import { showLoading, hideLoading } from "./loading.js";

/* =========================================================
   State Variables
   ========================================================= */
let isLoading = true; // Start as loading

/* =========================================================
   Button State Helper
   ========================================================= */
function setButtonState(btnIds, disabled, ariaValue) {
    btnIds.forEach(id => {
        const btn = document.getElementById(id);
        if (btn) {
            btn.disabled = disabled;
            btn.setAttribute('aria-disabled', ariaValue);
        }
    });
}

/* =========================================================
   Update Action Buttons State
   Enables/disables buttons based on:
   - Loading state: all buttons disabled during loading
   - Lock state: unlock buttons only enabled when locked
   - Export Chart: Tab2/Tab3 always enabled, Tab1 disabled
   - Export Map: always enabled
   ========================================================= */
function updateActionButtonsState() {
    const { locked } = getLockState();
    
    const allBtnIds = [
        "panel-export-chart-btn", "panel-export-map-btn", "panel-unlock-btn",
        "temperature-export-chart-btn", "temperature-export-map-btn", "temperature-unlock-btn",
        "precipitation-export-chart-btn", "precipitation-export-map-btn", "precipitation-unlock-btn"
    ];
    
    const tab1ChartBtn = ["panel-export-chart-btn"];
    const tab2Tab3ChartBtns = ["temperature-export-chart-btn", "precipitation-export-chart-btn"];
    const mapBtnIds = ["panel-export-map-btn", "temperature-export-map-btn", "precipitation-export-map-btn"];
    const unlockBtnIds = ["panel-unlock-btn", "temperature-unlock-btn", "precipitation-unlock-btn"];
    
    if (isLoading) {
        // During loading: all buttons disabled
        setButtonState(allBtnIds, true, 'true');
    } else {
        // Tab1 Export Chart button: enabled only when locked
        setButtonState(tab1ChartBtn, !locked, locked ? 'false' : 'true');
        
        // Tab2/Tab3 Export Chart buttons: always enabled
        setButtonState(tab2Tab3ChartBtns, false, 'false');
        
        // Export Map buttons: always enabled (when not loading)
        setButtonState(mapBtnIds, false, 'false');
        
        // Unlock buttons: only enabled when locked
        setButtonState(unlockBtnIds, !locked, locked ? 'false' : 'true');
    }
}

/* =========================================================
   Button Setup Helper
   ========================================================= */
function setupButton(elementId, handler) {
    const btn = document.getElementById(elementId);
    if (btn) {
        btn.addEventListener("click", handler);
    }
}

/* =========================================================
   Panel Action Buttons - DOM Event Handlers
   ========================================================= */
document.addEventListener("DOMContentLoaded", () => {
    // Tab1 (Overall) buttons
    setupButton("panel-export-chart-btn", exportChartOnly);
    setupButton("panel-export-map-btn", exportMapAsImage);
    setupButton("panel-unlock-btn", handleUnlock);

    // Tab2 (Temperature) buttons
    setupButton("temperature-export-chart-btn", () => exportTabAsImage("tab-temperature", "temperature"));
    setupButton("temperature-export-map-btn", exportMapAsImage);
    setupButton("temperature-unlock-btn", handleUnlock);

    // Tab3 (Precipitation) buttons
    setupButton("precipitation-export-chart-btn", () => exportTabAsImage("tab-precipitation", "precipitation"));
    setupButton("precipitation-export-map-btn", exportMapAsImage);
    setupButton("precipitation-unlock-btn", handleUnlock);

    const { locked } = getLockState();
    setPanelActionVisibility(locked);
    updateActionButtonsState();
    initOverallTab();
    initTemperatureTab();
    initPrecipitationTab();
});

/* =========================================================
   Unified Unlock Handler
   ========================================================= */
function handleUnlock() {
    const { locked } = getLockState();
    if (locked) {
        setPanelLocked(false, null);
        dispatcher.call("unlock", null);
        updatePanel(null, false);
        updateActionButtonsState();
    }
}

/* =========================================================
   Export Tab as Image
   ========================================================= */
function exportTabAsImage(tabId, tabName) {
    // Prevent concurrent exports
    if (getExportingState()) {
        return;
    }
    
    const tabElement = document.getElementById(tabId);
    if (!tabElement) {
        alert("Tab not found.");
        return;
    }

    setExportingState(true);
    showLoading('Exporting...');

    setTimeout(() => {
        try {
            // Create container div for export
            const exportContainer = document.createElement('div');
            exportContainer.style.position = 'absolute';
            exportContainer.style.top = '-9999px';
            exportContainer.style.left = '-9999px';
            exportContainer.style.width = tabElement.offsetWidth + 'px';
            exportContainer.style.background = '#fff';
            exportContainer.style.padding = '20px';
            exportContainer.style.display = 'flex';
            exportContainer.style.flexDirection = 'column';
            exportContainer.style.alignItems = 'center';
            
            // Add coordinate info at top
            const coordElement = document.getElementById('climate-coord');
            if (coordElement) {
                const coordClone = coordElement.cloneNode(true);
                coordClone.style.marginBottom = '16px';
                exportContainer.appendChild(coordClone);
            }
            
            // Clone and add the tab content
            const exportDiv = tabElement.cloneNode(true);
            exportDiv.style.position = 'static';
            exportDiv.style.background = 'transparent';
            exportDiv.style.padding = '0';
            exportDiv.style.width = '100%';
            
            // Remove action buttons and hint text from export
            exportDiv.querySelectorAll('.panel-action-row, .panel-hint, .panel-lock-hint').forEach(el => el.remove());
            
            exportContainer.appendChild(exportDiv);
            document.body.appendChild(exportContainer);

            // Wait a bit for DOM to settle
            setTimeout(() => {
                if (window.html2canvas) {
                // Get file name
                let fileName = `${tabName}-panel.png`;
                const { data } = getLockState();
                if (data && data.kg_type) {
                    const lat = data.lat != null ? Number(data.lat).toFixed(2) : '';
                    const lon = data.lon != null ? Number(data.lon).toFixed(2) : '';
                    if (lat && lon) {
                        fileName = `${tabName}_${data.kg_type}_${lat}_${lon}.png`;
                    }
                }

                window.html2canvas(exportContainer, {
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
                        document.body.removeChild(exportContainer);
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
                        if (exportContainer.parentNode) {
                            document.body.removeChild(exportContainer);
                        }
                    } catch (e) {}
                    hideLoading();
                    setExportingState(false);
                    alert("Export failed. Please try again.");
                });
            } else {
                document.body.removeChild(exportContainer);
                hideLoading();
                setExportingState(false);
                alert("Export requires html2canvas library.");
            }
            }, 50);
        } catch (err) {
            console.error("Export error:", err);
            hideLoading();
            setExportingState(false);
        }
    }, 150);
}

/* =========================================================
   Export Map as High-Resolution Image
   ========================================================= */
function exportMapAsImage() {
    // Prevent concurrent exports
    if (getExportingState()) {
        return;
    }
    
    const mapCanvas = document.getElementById("mapCanvas");
    if (!mapCanvas) {
        alert("Map not found.");
        return;
    }

    setExportingState(true);
    showLoading('Exporting map...');

    setTimeout(() => {
        try {
            // Create high-resolution canvas (2x scale)
            const scale = 2;
            const exportCanvas = document.createElement("canvas");
            exportCanvas.width = mapCanvas.width * scale;
            exportCanvas.height = mapCanvas.height * scale;
            const ctx = exportCanvas.getContext("2d", { willReadFrequently: false });

            // Redraw map if function exists
            if (window.redrawMapForExport) {
                window.redrawMapForExport();
            }

            // Draw map to export canvas
            ctx.drawImage(mapCanvas, 0, 0, exportCanvas.width, exportCanvas.height);

            // Import and draw axis labels
            const mapRect = mapCanvas.getBoundingClientRect();
            const overlayScale = mapRect.width > 0 ? (exportCanvas.width / mapRect.width) : 1;
            if (window.drawAxisLabelsForExport) {
                window.drawAxisLabelsForExport(ctx, overlayScale, 26 * scale, true);
            }

            // Draw hover/locked circle only when locked
            const { locked, data: lockedData } = getLockState();
            if (locked) {
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

                if (!circleDrawn && lockedData) {
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

            // Draw search marker if visible
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
                    const fontSize = 21 * scale;
                    ctx.font = `bold ${fontSize}px Inter, 'Helvetica Neue', sans-serif`;
                    ctx.textAlign = (label.getAttribute('text-anchor') || 'start') === 'middle' ? 'center' : (label.getAttribute('text-anchor') || 'start');
                    const baseline = label.getAttribute('dominant-baseline') || 'alphabetic';
                    ctx.textBaseline = baseline === 'middle' ? 'middle' : (baseline === 'hanging' ? 'top' : 'alphabetic');
                    ctx.fillStyle = '#222';
                    ctx.lineWidth = 3 * scale;
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

            // Generate file name
            let fileName = "climate-map.png";
            const { data } = getLockState();
            if (data && data.kg_type) {
                const lat = data.lat != null ? Number(data.lat).toFixed(2) : '';
                const lon = data.lon != null ? Number(data.lon).toFixed(2) : '';
                if (lat && lon) {
                    fileName = `map_${data.kg_type}_${lat}_${lon}.png`;
                }
            }

            // Download image
            const link = document.createElement("a");
            link.download = fileName;
            link.href = exportCanvas.toDataURL("image/png", 0.95);
            link.click();
            hideLoading();
            setExportingState(false);
            if (window.redrawMap) {
                window.redrawMap();
            }
        } catch (err) {
            console.error("Export error:", err);
            hideLoading();
            setExportingState(false);
            if (window.redrawMap) {
                window.redrawMap();
            }
            alert("Export failed. Please try again.");
        }
    }, 200);
}

/* =========================================================
   Panel Lock/Unlock Coordination
   ========================================================= */
const redrawTabCharts = (tabId, drawFns) => {
    if (document.getElementById(tabId)?.classList.contains('active')) {
        setTimeout(() => {
            drawFns.forEach(fn => typeof fn === 'function' && fn());
        }, 0);
    }
};

dispatcher.on("lock", () => {
    showLoading('Updating charts...');
    
    redrawTabCharts('tab-temperature', [drawTemperatureScatter, drawMonthlyTemperature]);
    redrawTabCharts('tab-precipitation', [drawPrecipitationScatter, drawMonthlyPrecipitation]);
    
    // Show buttons and hints after charts are redrawn
    setTimeout(() => {
        setPanelActionVisibility(true);
        
        // Show lock hints for all tabs
        const hintHTML = 'Panel locked to this location.<br>Other climate types are muted (faded).<br>Click Unlock or another place to restore.';
        
        // Tab1 (Overall) hint
        const tab1ActionRow = document.querySelector('#panel-body .panel-action-row');
        if (tab1ActionRow) {
            let hint1 = document.getElementById('panel-lock-hint');
            if (!hint1) {
                hint1 = document.createElement('div');
                hint1.id = 'panel-lock-hint';
                hint1.className = 'panel-lock-hint';
                hint1.innerHTML = hintHTML;
                tab1ActionRow.parentNode.insertBefore(hint1, tab1ActionRow.nextSibling);
            }
            hint1.style.display = 'block';
        }
        
        // Tab2 (Temperature) hint
        const tab2ActionRow = document.getElementById('temperature-action-row');
        if (tab2ActionRow) {
            let hint2 = document.getElementById('temperature-lock-hint');
            if (!hint2) {
                hint2 = document.createElement('div');
                hint2.id = 'temperature-lock-hint';
                hint2.className = 'panel-lock-hint';
                hint2.innerHTML = hintHTML;
                tab2ActionRow.parentNode.insertBefore(hint2, tab2ActionRow.nextSibling);
            }
            hint2.style.display = 'block';
        }
        
        // Tab3 (Precipitation) hint
        const tab3ActionRow = document.getElementById('precipitation-action-row');
        if (tab3ActionRow) {
            let hint3 = document.getElementById('precipitation-lock-hint');
            if (!hint3) {
                hint3 = document.createElement('div');
                hint3.id = 'precipitation-lock-hint';
                hint3.className = 'panel-lock-hint';
                hint3.innerHTML = hintHTML;
                tab3ActionRow.parentNode.insertBefore(hint3, tab3ActionRow.nextSibling);
            }
            hint3.style.display = 'block';
        }
        
        hideLoading();
        updateActionButtonsState();
    }, 400);
});

dispatcher.on("unlock", () => {
    showLoading('Updating charts...');
    setPanelActionVisibility(false);
    
    // Hide all lock hints
    const hint1 = document.getElementById('panel-lock-hint');
    if (hint1) hint1.style.display = 'none';
    
    const hint2 = document.getElementById('temperature-lock-hint');
    if (hint2) hint2.style.display = 'none';
    
    const hint3 = document.getElementById('precipitation-lock-hint');
    if (hint3) hint3.style.display = 'none';
    
    redrawTabCharts('tab-temperature', [drawTemperatureScatter, drawMonthlyTemperature]);
    redrawTabCharts('tab-precipitation', [drawPrecipitationScatter, drawMonthlyPrecipitation]);
    // Hide loading after charts are redrawn
    setTimeout(() => {
        hideLoading();
        updateActionButtonsState();
    }, 400);
});

/* =========================================================
   Tab Selection Interaction (from map.js or main.js)
   Implements lock/unlock toggle on click
   ========================================================= */
dispatcher.on("select.chart", d => {
    const { locked } = getLockState();

    if (locked) {
        setPanelLocked(false, null);
        updateCoordinateDisplay(null);
        dispatcher.call("unlock", null);
        return;
    }

    if (!d) return;

    setPanelLocked(true, d);
    updateCoordinateDisplay(d);
    dispatcher.call("lock", null, d);
    updatePanel(d, true);
});

/* =========================================================
   Centralized Hover Interaction
   Only the active tab's update functions are called to optimize performance
   ========================================================= */
function getActiveTabName() {
    if (document.getElementById('tab-overall')?.classList.contains('active')) {
        return 'overall';
    } else if (document.getElementById('tab-temperature')?.classList.contains('active')) {
        return 'temperature';
    } else if (document.getElementById('tab-precipitation')?.classList.contains('active')) {
        return 'precipitation';
    }
    return null;
}

dispatcher.on("hover", (d) => {
    const activeTab = getActiveTabName();
    if (!activeTab) return;

    if (activeTab === 'overall') {
        handleOverallTabHover(d);
    } else if (activeTab === 'temperature') {
        handleTemperatureTabHover(d);
    } else if (activeTab === 'precipitation') {
        handlePrecipitationTabHover(d);
    }
});

dispatcher.on("hoverend", () => {
    const activeTab = getActiveTabName();
    if (!activeTab) return;

    if (activeTab === 'overall') {
        handleOverallTabHoverEnd();
    } else if (activeTab === 'temperature') {
        handleTemperatureTabHoverEnd();
    } else if (activeTab === 'precipitation') {
        handlePrecipitationTabHoverEnd();
    }
});

/* =========================================================
   Global Lock/Unlock State Updates
   Update button states whenever lock state changes
   ========================================================= */
dispatcher.on("lock", () => {
    updateActionButtonsState();
});

dispatcher.on("unlock", () => {
    updateActionButtonsState();
});

/* =========================================================
   Tab Change: Restore hover state when switching tabs
   ========================================================= */
dispatcher.on("tabChanged", (target) => {
    // After tab switch, if there's hover data, redraw the new tab with hover state
    // The tab modules maintain their own hoverDatum, so we just need to redraw
    // Wait for CSS transition to complete
    setTimeout(() => {
        if (target === 'overall') {
            // updatePanel will be called when user hovers, so just clear if no lock
            const { locked } = getLockState();
            if (!locked) {
                // Tab is active and not locked, it will show hover state automatically
            }
        } else if (target === 'temperature') {
            // Redraw to show any preserved hover state
            try {
                drawTemperatureScatter();
                drawMonthlyTemperature();
            } catch (e) {
                console.error('Error redrawing temperature tab:', e);
            }
        } else if (target === 'precipitation') {
            // Redraw to show any preserved hover state
            try {
                drawPrecipitationScatter();
                drawMonthlyPrecipitation();
            } catch (e) {
                console.error('Error redrawing precipitation tab:', e);
            }
        }
    }, 350);
});

document.addEventListener('app-loading', (event) => {
    isLoading = Boolean(event?.detail?.loading);
    updateActionButtonsState();
});

/* =========================================================
   Initialize panel with empty state on startup
   ========================================================= */
updatePanel(null, false);
updateActionButtonsState();

/* =========================================================
   Export redraw functions for external use (map.js, main.js)
   ========================================================= */
window.redrawComboChart = redrawComboChart;
window.getPanelLockState = getLockState;
window.isPanelLocked = () => getLockState().locked;

/* =========================================================
   Public API
   ========================================================= */
export {
    // Tab1 (Overall)
    updatePanel,
    redrawComboChart,
    renderComboChart,
    exportPanelAsImage,
    exportChartOnly,
    setPanelLocked,
    getLockState,
    // Tab2 (Temperature)
    drawTemperatureScatter,
    drawMonthlyTemperature,
    // Tab3 (Precipitation)
    drawPrecipitationScatter,
    drawMonthlyPrecipitation,
    // Export functions
    exportTabAsImage,
    exportMapAsImage
};
