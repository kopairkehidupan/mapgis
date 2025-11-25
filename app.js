// Inisialisasi peta
var map = L.map('map').setView([0.5, 101.4], 12);

L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 22,
}).addTo(map);

var editableLayers = new L.FeatureGroup().addTo(map);

// Draw control
var drawControl = new L.Control.Draw({
    edit: { featureGroup: editableLayers },
    draw: { polygon:true, polyline:true, rectangle:true, marker:true, circle:false }
});
map.addControl(drawControl);

map.on(L.Draw.Event.CREATED, function(e){
    editableLayers.addLayer(e.layer);
});

// ===== Penyimpanan layer =====
var uploadedFiles = {};    
// id -> { name, group:LayerGroup, bounds, color, weight }

// Membuat LayerGroup per file
function createGroupFromGeoJSON(geojson, color){
    const group = L.layerGroup();
    const base = L.geoJSON(geojson, {
        style: { color:color, weight:3 },
        pointToLayer: (f,latlng)=>L.circleMarker(latlng,{radius:5,color:color})
    });

    base.eachLayer(l => group.addLayer(l));
    return group;
}

// UI List
function addFileEntry(id, name){
    const ul = document.getElementById("fileList");

    const li = document.createElement("li");
    li.id = "file-" + id;

    // Header
    const header = document.createElement("div");
    header.className = "file-header";

    const chk = document.createElement("input");
    chk.type = "checkbox";
    chk.checked = true;
    chk.onchange = ()=> toggleFile(id, chk.checked);

    const label = document.createElement("label");
    label.innerText = name;

    header.appendChild(chk);
    header.appendChild(label);
    li.appendChild(header);

    // Buttons row
    const row = document.createElement("div");
    row.className = "btn-row";

    const btnZoom = document.createElement("button");
    btnZoom.className = "btn-small";
    btnZoom.innerText = "Zoom";
    btnZoom.onclick = ()=> zoomFile(id);

    const btnStyle = document.createElement("button");
    btnStyle.className = "btn-small";
    btnStyle.innerText = "Style";
    btnStyle.onclick = ()=> editStyle(id);

    const btnExport = document.createElement("button");
    btnExport.className = "btn-small";
    btnExport.innerText = "Export KML";
    btnExport.onclick = ()=> exportKML(id);

    const btnDel = document.createElement("button");
    btnDel.className = "btn-small";
    btnDel.innerText = "Hapus";
    btnDel.onclick = ()=> deleteFile(id);

    row.appendChild(btnZoom);
    row.appendChild(btnStyle);
    row.appendChild(btnExport);
    row.appendChild(btnDel);

    li.appendChild(row);
    ul.appendChild(li);
}

// Toggle show/hide
function toggleFile(id, show){
    const meta = uploadedFiles[id];
    if(!meta) return;

    meta.group.eachLayer(layer=>{
        if(show){
            map.addLayer(layer);
            editableLayers.addLayer(layer);
        } else {
            map.removeLayer(layer);
            editableLayers.removeLayer(layer);
        }
    });
}

// Zoom
function zoomFile(id){
    const meta = uploadedFiles[id];
    if(meta.bounds && meta.bounds.isValid()) map.fitBounds(meta.bounds);
}

// Edit Style (warna & ketebalan)
function editStyle(id){
    const meta = uploadedFiles[id];
    if(!meta) return;

    const warna = prompt("Warna (misal: red, blue, #00ff00):", meta.color);
    if(!warna) return;

    const weight = prompt("Ketebalan garis:", meta.weight);
    if(!weight) return;

    meta.color = warna;
    meta.weight = parseInt(weight);

    // Terapkan styling baru
    meta.group.eachLayer(layer=>{
        if(layer.setStyle){
            layer.setStyle({ color:meta.color, weight:meta.weight });
        }
        if(layer.setRadius){
            layer.setStyle({ color:meta.color });
        }
    });
}

// Export KML per file
function exportKML(id){
    const meta = uploadedFiles[id];
    if(!meta) return;

    const gj = meta.group.toGeoJSON();
    const kml = tokml(gj);
    saveAs(new Blob([kml],{type:"application/vnd.google-earth.kml+xml"}), meta.name + ".kml");
}

// Hapus file
function deleteFile(id){
    if(!confirm("Hapus file ini?")) return;

    const meta = uploadedFiles[id];
    if(!meta) return;

    meta.group.eachLayer(layer=>{
        map.removeLayer(layer);
        editableLayers.removeLayer(layer);
    });

    delete uploadedFiles[id];
    const el = document.getElementById("file-" + id);
    if(el) el.remove();
}

// ===== UPLOAD GPX =====
document.getElementById("btnUpload").onclick = ()=>{
    const inp = document.getElementById("gpxFile");
    const file = inp.files[0];
    if(!file) return alert("Pilih file GPX");

    const reader = new FileReader();
    reader.onload = ()=>{
        const dom = new DOMParser().parseFromString(reader.result, "text/xml");
        const geojson = toGeoJSON.gpx(dom);

        const id = Date.now();
        const color = "#0077ff";

        const group = createGroupFromGeoJSON(geojson, color);
        const bounds = group.getBounds();

        uploadedFiles[id] = {
            name:file.name,
            group:group,
            bounds:bounds,
            color:color,
            weight:3
        };

        // Tampilkan layer default
        group.eachLayer(l=>{
            map.addLayer(l);
            editableLayers.addLayer(l);
        });

        addFileEntry(id, file.name);

        if(bounds.isValid()) map.fitBounds(bounds);

        inp.value = "";
    };

    reader.readAsText(file);
};
