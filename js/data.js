/* data.js
   Data loading module: encapsulate CSV / GeoJSON loading and return normalized data.
   Purpose: provide reusable data APIs for map and charts.
*/

// Load and parse climate CSV, return normalized station array (lon,lat,baseColor,t,p,kg_type)
export async function loadData() {
    const data = await d3.csv("data/kg.csv", d => {
        const t = [];
        const p = [];
        for (let i = 1; i <= 12; i++) {
            t.push(+d[`t${String(i).padStart(2, "0")}`]);
            p.push(+d[`p${String(i).padStart(2, "0")}`]);
        }
        return {
            lon: +d.lon,
            lat: +d.lat,
            baseColor: d.kg_color1,
            t,
            p,
            kg_type: d.kg_type
        };
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
