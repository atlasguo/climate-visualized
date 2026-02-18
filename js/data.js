/* data.js
   Data loading module: encapsulate CSV / GeoJSON loading and return normalized data.
   Purpose: provide reusable data APIs for map and charts.
*/

// Load and parse climate CSV, return normalized station array (lon,lat,baseColor,pointColor,t,p,kg_type,t_01-t_12,p_01-p_12)
export async function loadData() {
    const data = await d3.csv("data/kg.csv", d => {
        const t = [];
        const p = [];
        const obj = {
            lon: +d.lon,
            lat: +d.lat,
            baseColor: d.kg_color1,
            pointColor: d.kg_color3,
            t,
            p,
            kg_type: d.kg_type
        };
        
        // Extract monthly temperatures and precipitations for array format (Tab1)
        for (let i = 1; i <= 12; i++) {
            const month = String(i).padStart(2, "0");
            t.push(+d[`t${month}`]);
            p.push(+d[`p${month}`]);
        }
        
        // Extract monthly temperatures and precipitations for object property format (Tab2/Tab3)
        for (let i = 1; i <= 12; i++) {
            const month = String(i).padStart(2, "0");
            obj[`t_${month}`] = +d[`t_${month}`];
            obj[`p_${month}`] = +d[`p_${month}`];
        }
        
        return obj;
    });
    return data;
}

// Load country boundary GeoJSON
export async function loadCountries() {
    return await d3.json("data/countries.json");
}

// Load ocean GeoJSON
export async function loadOcean() {
    return await d3.json("data/ocean.json");
}

// Load Natural Earth populated places (10m), normalize to simple label array
export async function loadCityLabels() {
    try {
        const raw = await d3.json("data/ne_populated_places_50m.json");
        if (!raw) return [];
        if (Array.isArray(raw)) {
            return raw.map(d => ({
                lon: +d.lon,
                lat: +d.lat,
                name: d.name || d.NAME || d.NAMEASCII || "",
                labelrank: d.labelrank ?? d.LABELRANK,
                scalerank: d.scalerank ?? d.SCALERANK,
                pop: d.pop ?? d.POP_MAX ?? 0,
                featurecla: d.featurecla ?? d.FEATURECLA,
                adm0cap: d.adm0cap ?? d.ADM0CAP,
                megacity: d.megacity ?? d.MEGACITY,
                worldcity: d.worldcity ?? d.WORLDCITY
            })).filter(d => Number.isFinite(d.lon) && Number.isFinite(d.lat) && d.name);
        }
        if (raw.type === "FeatureCollection" && Array.isArray(raw.features)) {
            return raw.features.map(f => {
                const props = f.properties || {};
                const coords = f.geometry?.coordinates || [];
                return {
                    lon: +coords[0],
                    lat: +coords[1],
                    name: props.NAME || props.NAMEASCII || props.name || "",
                    labelrank: props.LABELRANK ?? props.labelrank,
                    scalerank: props.SCALERANK ?? props.scalerank,
                    pop: props.POP_MAX ?? props.pop ?? 0,
                    featurecla: props.FEATURECLA ?? props.featurecla,
                    adm0cap: props.ADM0CAP ?? props.adm0cap,
                    megacity: props.MEGACITY ?? props.megacity,
                    worldcity: props.WORLDCITY ?? props.worldcity
                };
            }).filter(d => Number.isFinite(d.lon) && Number.isFinite(d.lat) && d.name);
        }
    } catch (err) {
        console.warn("City labels not loaded:", err);
    }
    return [];
}
