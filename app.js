// --- Inisialisasi peta ---
var map = L.map('map').setView([0.5, 101.4], 12);

L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 22,
}).addTo(map);

// grup layer yang bisa diedit (Leaflet.draw)
var editableLayers = new L.FeatureGroup().addTo(map);

// control draw
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

// ===== Manajemen file & layer =====
var uploadedFiles = {}; // id -> { name, group (LayerGroup), bounds }

// helper: tambahkan semua sublayer GeoJSON ke sebuah layerGroup (per-file)
function createFileGroupFromGeoJSON(geojson, options) {
    options = options || {};
    var tmp = L.geoJSON(geojson, options);
    var group = L.layerGroup();
    tmp.eachLayer(function (layer) {
        // simpan layer ke group (tidak langsung ke editableLayers)
        group.addLayer(layer);
    });
    return { tmpGeo: tmp, group: group };
}

// show/hide file by id (checkbox)
function toggleFileDisplay(id, show) {
    var meta = uploadedFiles[id];
    if (!meta) return;
    if (show) {
        // tambahkan tiap layer dari group ke peta & ke editableLayers
        meta.group.eachLayer(function (layer) {
            map.addLayer(layer);
            editableLayers.addLayer(layer);
        });
    } else {
        // hapus tiap layer dari peta & editableLayers
        meta.group.eachLayer(function (layer) {
            if (map.hasLayer(layer)) map.removeLayer(layer);
            if (editableLayers.hasLayer(layer)) editableLayers.removeLayer(layer);
        });
    }
}

// zoom ke file
function zoomToFile(id) {
    var meta = uploadedFiles[id];
    if (!meta) return;
    if (meta.bounds) {
        map.fitBounds(meta.bounds);
    }
}

// hapus file sepenuhnya (dari list & map)
function removeFile(id) {
    var meta = uploadedFiles[id];
    if (!meta) return;
    // pastikan semua layer dihapus dari map dan editable
    meta.group.eachLayer(function (layer) {
        if (map.hasLayer(layer)) map.removeLayer(layer);
        if (editableLayers.hasLayer(layer)) editableLayers.removeLayer(layer);
    });
    // hapus dari daftar
    delete uploadedFiles[id];
    var el = document.getElementById('file-item-' + id);
    if (el) el.remove();
}

// helper untuk menambahkan entry di UI list
function addFileListEntry(id, name) {
    var ul = document.getElementById('fileList');

    var li = document.createElement('li');
    li.id = 'file-item-' + id;

    var checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = true;
    checkbox.id = 'chk-' + id;
    checkbox.onchange = function () {
        toggleFileDisplay(id, this.checked);
    };

    var label = document.createElement('label');
    label.htmlFor = checkbox.id;
    label.innerText = name;

    // zoom button
    var zoomBtn = document.createElement('button');
    zoomBtn.className = 'btn-small';
    zoomBtn.title = 'Zoom to layer';
    zoomBtn.innerText = 'Zoom';
    zoomBtn.onclick = function (e) {
        e.stopPropagation();
        zoomToFile(id);
    };

    // remove button
    var rmBtn = document.createElement('button');
    rmBtn.className = 'btn-small';
    rmBtn.title = 'Hapus file';
    rmBtn.innerText = 'Hapus';
    rmBtn.onclick = function (e) {
        e.stopPropagation();
        if (!confirm('Hapus file "' + name + '"?')) return;
        removeFile(id);
    };

    li.appendChild(checkbox);
    li.appendChild(label);
    li.appendChild(zoomBtn);
    li.appendChild(rmBtn);

    ul.appendChild(li);
}

// ===== Upload GPX handler =====
document.getElementById("btnUpload").onclick = () => {
    const fileInput = document.getElementById("gpxFile");
    const file = fileInput.files[0];
    if (!file) return alert("Pilih file GPX dulu.");

    const reader = new FileReader();
    reader.onload = () => {
        const text = reader.result;
        const dom = new DOMParser().parseFromString(text, "text/xml");
        const geojson = toGeoJSON.gpx(dom);

        // create per-file group (but don't add to editableLayers yet via tmp)
        const created = createFileGroupFromGeoJSON(geojson, {
            style: { color: "blue", weight: 3 },
            pointToLayer: function (feature, latlng) {
                return L.circleMarker(latlng, { radius: 5 });
            }
        });

        // compute bounds if possible
        var bounds = null;
        try { bounds = created.tmpGeo.getBounds(); } catch (e) { bounds = null; }

        // generate id
        const id = Date.now() + '-' + Math.floor(Math.random()*1000);

        // simpan metadata
        uploadedFiles[id] = {
            name: file.name,
            group: created.group,
            bounds: bounds
        };

        // add to map and editableLayers (default: visible)
        uploadedFiles[id].group.eachLayer(function (layer) {
            map.addLayer(layer);
            editableLayers.addLayer(layer);
        });

        // add UI entry
        addFileListEntry(id, file.name);

        // fit bounds if exists
        if (bounds && bounds.isValid && bounds.isValid()) {
            map.fitBounds(bounds);
        } else if (geojson.features && geojson.features.length) {
            // fallback: center to first coord
            const f = geojson.features[0];
            if (f.geometry && f.geometry.coordinates) {
                const c = f.geometry.coordinates;
                map.setView([c[1], c[0]], 15);
            }
        }

        // reset input so same file can be uploaded again if needed
        fileInput.value = '';
    };

    reader.readAsText(file);
};

// ===== Buffer, Clear, Export =====
document.getElementById("btnBuffer").onclick = () => {
    if (editableLayers.getLayers().length === 0)
        return alert("Tidak ada layer untuk dibuffer.");

    const geojson = editableLayers.toGeoJSON();
    const buffered = turf.buffer(geojson, 20, { units: 'meters' });

    // tambahkan hasil buffer ke satu group baru (file-like)
    const tmp = L.geoJSON(buffered, {
        style: { color: "red", weight: 2, fillOpacity: 0.2 }
    });

    // tambahkan tiap sublayer ke editableLayers AND map
    tmp.eachLayer(function (layer) {
        map.addLayer(layer);
        editableLayers.addLayer(layer);
    });
};

document.getElementById("btnClear").onclick = () => {
    // clear map and editableLayers, also clear uploadedFiles list UI and metadata
    editableLayers.eachLayer(function (layer) {
        if (map.hasLayer(layer)) map.removeLayer(layer);
    });
    editableLayers.clearLayers();

    // remove UI list entries
    var ul = document.getElementById('fileList');
    ul.innerHTML = '';
    uploadedFiles = {};
};

document.getElementById("btnDownloadKml").onclick = () => {
    if (editableLayers.getLayers().length === 0) return alert("Tidak ada data untuk diekspor.");
    const geojson = editableLayers.toGeoJSON();
    const kml = tokml(geojson);
    const blob = new Blob([kml], { type: "application/vnd.google-earth.kml+xml" });
    saveAs(blob, "hasil.kml");
};
