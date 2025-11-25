// --- Inisialisasi peta ---
var map = L.map('map').setView([0.5, 101.4], 12);

L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 22,
}).addTo(map);

// grup layer yang bisa diedit
var editableLayers = new L.FeatureGroup().addTo(map);

// Leaflet Draw Control
var drawControl = new L.Control.Draw({
    edit: { featureGroup: editableLayers },
    draw: {
        polygon: true,
        polyline: true,
        rectangle: true,
        circle: false,
        marker: true
    }
});
map.addControl(drawControl);

map.on(L.Draw.Event.CREATED, function (e) {
    // tambahkan layer hasil draw ke grup edit
    editableLayers.addLayer(e.layer);
});


// --- Helper: tambahkan semua sublayer GeoJSON ke editableLayers ---
function addGeoJSONToEditableLayers(geojson, options) {
    options = options || {};
    var temp = L.geoJSON(geojson, options);
    // setiap sublayer (polyline/polygon/marker) ditambahkan tersendiri
    temp.eachLayer(function (layer) {
        editableLayers.addLayer(layer);
    });
    return temp;
}


// --- Upload GPX ---
document.getElementById("btnUpload").onclick = () => {
    const file = document.getElementById("gpxFile").files[0];
    if (!file) return alert("Pilih file GPX dulu.");

    const reader = new FileReader();
    reader.onload = () => {
        const text = reader.result;
        const dom = new DOMParser().parseFromString(text, "text/xml");

        // konversi GPX -> GeoJSON
        const geojson = toGeoJSON.gpx(dom);

        // jangan langsung addTo(editableLayers) — tambahkan tiap sublayer
        const tmp = addGeoJSONToEditableLayers(geojson, {
            style: { color: "blue", weight: 3 },
            pointToLayer: function (feature, latlng) {
                return L.circleMarker(latlng, { radius: 5 });
            }
        });

        // sesuaikan tampilan peta jika ada bounds
        try {
            map.fitBounds(tmp.getBounds());
        } catch (err) {
            // jika tidak ada bounds (mis. hanya titik), pusatkan pada titik pertama
            if (geojson.features && geojson.features.length) {
                const f = geojson.features[0];
                if (f.geometry && f.geometry.coordinates) {
                    const c = f.geometry.coordinates;
                    // koordinat GPX biasanya [lon, lat]
                    map.setView([c[1], c[0]], 15);
                }
            }
        }
    };

    reader.readAsText(file);
};


// --- Buffer 20 meter ---
document.getElementById("btnBuffer").onclick = () => {
    if (editableLayers.getLayers().length === 0)
        return alert("Tidak ada layer untuk dibuffer.");

    // gabungkan semua feature dari editableLayers menjadi satu GeoJSON
    const geojson = editableLayers.toGeoJSON();

    // turf.buffer expects a Feature or FeatureCollection
    const buffered = turf.buffer(geojson, 20, { units: 'meters' });

    // tambahkan hasil buffer sebagai sublayer terpisah
    const tmp = L.geoJSON(buffered, {
        style: { color: "red", weight: 2, fillOpacity: 0.2 }
    });

    tmp.eachLayer(function (layer) {
        editableLayers.addLayer(layer);
    });

    // centering optional
    try { map.fitBounds(tmp.getBounds()); } catch (e) { /* ignore */ }
};


// --- Clear all ---
document.getElementById("btnClear").onclick = () => {
    editableLayers.clearLayers();
};


// --- Download KML ---
document.getElementById("btnDownloadKml").onclick = () => {
    if (editableLayers.getLayers().length === 0) return alert("Tidak ada data untuk diekspor.");

    const geojson = editableLayers.toGeoJSON();
    const kml = tokml(geojson);

    const blob = new Blob([kml], {
        type: "application/vnd.google-earth.kml+xml"
    });

    saveAs(blob, "hasil.kml");
};
