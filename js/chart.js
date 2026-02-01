/* =========================================================
   chart.js
   Climate detail charts for the left panel
   Renders monthly temperature and precipitation on hover
   ========================================================= */

/* =========================================================
   Köppen classification dictionaries
   ========================================================= */

const KOPPEN_MAIN = {
    A: "equatorial",
    B: "arid",
    C: "warm temperate",
    D: "snow",
    E: "polar"
};

const KOPPEN_PRECIP = {
    W: "desert",
    S: "steppe",
    f: "fully humid",
    s: "summer dry",
    w: "winter dry",
    m: "monsoonal"
};

const KOPPEN_TEMP = {
    h: "hot arid",
    k: "cold arid",
    a: "hot summer",
    b: "warm summer",
    c: "cool summer",
    d: "extremely continental",
    F: "polar frost",
    T: "polar tundra"
};

/* =========================================================
   DOM references
   ========================================================= */

const climateTypeLabel = document.getElementById("climate-type");
const climateExplain   = document.getElementById("climate-explain");
const tempChartSvg     = d3.select("#tempChart");
const precipChartSvg   = d3.select("#precipChart");

/* =========================================================
   Chart layout constants
   ========================================================= */

const MARGIN = { top: 35, right: 20, bottom: 20, left: 35 };
const CHART_HEIGHT = 150;

/* =========================================================
   Color scaling factors (chart-specific)
   Adjust saturation and lightness relative to map colors
   ========================================================= */

const TEMP_SAT_FACTOR_CHART   = 0.5;
const TEMP_L_FACTOR_CHART     = 0.5;
const PRECIP_SAT_FACTOR_CHART = 0.5;
const PRECIP_L_FACTOR_CHART   = 0.75;

/* =========================================================
   Hover distance threshold
   Filters out distant points over ocean or no-data regions
   ========================================================= */

const HOVER_MAX_DIST2 = 0.25 * 0.25; // degrees² (~25 km)

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

function renderTempChart(d) {
    if (!d) {
        tempChartSvg.selectAll("*").remove();
        return;
    }

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

    const x = d3.scaleLinear()
        .domain([1, 12])
        .range([0, innerWidth]);

    const y = d3.scaleLinear()
        .domain(d3.extent(d.t))
        .nice()
        .range([innerHeight, 0]);

    const line = d3.line()
        .x((_, i) => x(i + 1))
        .y(v => y(v))
        .curve(d3.curveMonotoneX);

    g.append("path")
        .datum(d.t)
        .attr("class", "temp-line")
        .attr("stroke", tempColor(d.baseColor))
        .attr("d", line);

    g.append("g")
        .attr("class", "chart-axis")
        .call(d3.axisLeft(y).ticks(4));

    g.append("g")
        .attr("class", "chart-axis")
        .attr("transform", `translate(0,${innerHeight})`)
        .call(d3.axisBottom(x).tickValues([1, 4, 7, 10]));
}

/* =========================================================
   Precipitation chart renderer
   ========================================================= */

function renderPrecipChart(d) {
    if (!d) {
        precipChartSvg.selectAll("*").remove();
        return;
    }

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

    const x = d3.scaleBand()
        .domain(d3.range(1, 13))
        .range([0, innerWidth])
        .padding(0.18);

    const y = d3.scaleLinear()
        .domain([0, d3.max(d.p)])
        .nice()
        .range([innerHeight, 0]);

    g.selectAll("rect")
        .data(d.p)
        .enter()
        .append("rect")
        .attr("class", "precip-bar")
        .attr("x", (_, i) => x(i + 1))
        .attr("y", v => y(v))
        .attr("width", x.bandwidth())
        .attr("height", v => innerHeight - y(v))
        .attr("fill", precipColor(d.baseColor));

    g.append("g")
        .attr("class", "chart-axis")
        .call(d3.axisLeft(y).ticks(4));

    g.append("g")
        .attr("class", "chart-axis")
        .attr("transform", `translate(0,${innerHeight})`)
        .call(d3.axisBottom(x).tickValues([1, 4, 7, 10]));
}

/* =========================================================
   Hover and interaction logic
   ========================================================= */

function screenToLonLat(x, y) {
    const t = STATE.zoomTransform;
    return STATE.projection.invert([
        (x - t.x) / t.k,
        (y - t.y) / t.k
    ]);
}

function findNearest(lon, lat) {
    let best = null;
    let minDist = Infinity;

    for (const d of STATE.data) {
        const dx = d.lon - lon;
        const dy = d.lat - lat;
        const dist = dx * dx + dy * dy;
        if (dist < minDist) {
            minDist = dist;
            best = d;
        }
    }

    return minDist <= HOVER_MAX_DIST2 * 25 ? best : null;
}

function updatePanel(d) {
    if (!d) {
        climateTypeLabel.textContent = "—";
        climateExplain.innerHTML = "";
        renderTempChart(null);
        renderPrecipChart(null);
        return;
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

function onMouseMove(e) {
    if (!STATE.projection) return;

    const rect = overlay.node().getBoundingClientRect();
    const lonLat = screenToLonLat(
        e.clientX - rect.left,
        e.clientY - rect.top
    );

    updatePanel(lonLat ? findNearest(lonLat[0], lonLat[1]) : null);
}

function onMouseLeave() {
    updatePanel(null);
}

/* =========================================================
   Köppen explanation formatter
   ========================================================= */

function explainKgType(kg) {
    if (!kg || kg.length < 1) return "";

    const lines = [];
    const main = kg[0];

    if (KOPPEN_MAIN[main]) {
        lines.push(`Main: <strong>${main}</strong> ${KOPPEN_MAIN[main]}`);
    }

    if (main === "E") {
        const t = kg[1];
        if (KOPPEN_TEMP[t]) {
            lines.push(`Temperature: <strong>${t}</strong> ${KOPPEN_TEMP[t]}`);
        }
    } else {
        if (kg.length >= 2 && KOPPEN_PRECIP[kg[1]]) {
            lines.push(`Precipitation: <strong>${kg[1]}</strong> ${KOPPEN_PRECIP[kg[1]]}`);
        }
        if (kg.length >= 3 && KOPPEN_TEMP[kg[2]]) {
            lines.push(`Temperature: <strong>${kg[2]}</strong> ${KOPPEN_TEMP[kg[2]]}`);
        }
    }

    return lines;
}

/* =========================================================
   Event binding
   ========================================================= */

const overlayNode = overlay.node();
overlayNode.addEventListener("mousemove", onMouseMove);
overlayNode.addEventListener("mouseleave", onMouseLeave);
