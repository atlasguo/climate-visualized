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
