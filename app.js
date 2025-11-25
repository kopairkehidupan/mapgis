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
    editableLayers.addLayer(e.layer);
});


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

        window.gpxLayer = L.geoJSON(geojson, {
            style: { color: "blue", weight: 3 }
        }).addTo(editableLayers);

        map.fitBounds(window.gpxLayer.getBounds());
    };

    reader.readAsText(file);
};


// --- Buffer 20 meter ---
document.getElementById("btnBuffer").onclick = () => {
    if (editableLayers.getLayers().length === 0)
        return alert("Tidak ada layer untuk dibuffer.");

    const geojson = editableLayers.toGeoJSON();
    const buffered = turf.buffer(geojson, 20, { units: 'meters' });

    L.geoJSON(buffered, {
        style: { color: "red", weight: 2, fillOpacity: 0.2 }
    }).addTo(editableLayers);
};


// --- Clear all ---
document.getElementById("btnClear").onclick = () => {
    editableLayers.clearLayers();
};


// --- Download KML ---
document.getElementById("btnDownloadKml").onclick = () => {
    const geojson = editableLayers.toGeoJSON();
    const kml = tokml(geojson);

    const blob = new Blob([kml], {
        type: "application/vnd.google-earth.kml+xml"
    });

    saveAs(blob, "hasil.kml");
};
