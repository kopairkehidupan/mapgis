// --- Initialization ---
var map = L.map('map').setView([0.5,101.4],12);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:22}).addTo(map);

// ===== BASEMAP LAYERS =====
var osmLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 22,
  attribution: 'Erik Simarmata'
});

var satelliteLayer = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
  maxZoom: 22,
  attribution: 'Erik Simarmata'
});

var topoLayer = L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', {
  maxZoom: 17,
  attribution: 'Erik Simarmata'
});

var cartoDBLight = L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
  maxZoom: 22,
  attribution: 'Erik Simarmata'
});

var cartoDBDark = L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
  maxZoom: 22,
  attribution: 'Erik Simarmata'
});

// Tambahkan default layer (OpenStreetMap)
osmLayer.addTo(map);

// ===== LAYER CONTROL =====
var baseMaps = {
  "OpenStreetMap": osmLayer,
  "Satellite": satelliteLayer,
  "Topographic": topoLayer,
  "CartoDB Light": cartoDBLight,
  "CartoDB Dark": cartoDBDark
};

// Tambahkan Layer Control ke peta
L.control.layers(baseMaps, null, {
  position: 'topright',
  collapsed: true
}).addTo(map);

// Editable group for Leaflet.draw
var editableLayers = new L.FeatureGroup().addTo(map);

var drawControl = new L.Control.Draw({
  edit:{ featureGroup: editableLayers },
  draw:{ polygon:true, polyline:true, rectangle:true, marker:true, circle:false }
});
map.addControl(drawControl);
map.on(L.Draw.Event.CREATED, function(e){ editableLayers.addLayer(e.layer); });

// ===== TAMBAHAN BARU: Event listener untuk edit layer =====
map.on(L.Draw.Event.EDITED, function(e) {
  var layers = e.layers;
  
  layers.eachLayer(function(editedLayer) {
    Object.keys(uploadedFiles).forEach(function(id) {
      var meta = uploadedFiles[id];
      var found = false;
      
      meta.group.eachLayer(function(layer) {
        if (layer === editedLayer) {
          found = true;
        }
      });
      
      if (found) {
        console.log('Layer edited for file:', meta.name);
        
        // Re-attach click event setelah edit
        attachLayerClickEvent(editedLayer, id);
        
        updateMapLabels(id);
        
        if (lastSelectedId === id) {
          updatePropertiesStats(id);
        }
      }
    });
  });
});

map.on(L.Draw.Event.DELETED, function(e) {
  var layers = e.layers;
  
  // Cari layer mana yang dihapus dan hapus labelnya
  layers.eachLayer(function(deletedLayer) {
    // Cari uploadedFile mana yang mengandung layer ini
    Object.keys(uploadedFiles).forEach(function(id) {
      var meta = uploadedFiles[id];
      var found = false;
      var layerToRemove = null;
      
      meta.group.eachLayer(function(layer) {
        if (layer === deletedLayer) {
          found = true;
          layerToRemove = layer;
        }
      });
      
      if (found && layerToRemove) {
        // Hapus layer dari group
        meta.group.removeLayer(layerToRemove);
        
        // Update label untuk file ini
        console.log('Layer deleted for file:', meta.name);
        updateMapLabels(id);
        
        // Update stats di properties panel jika sedang dibuka
        if (lastSelectedId === id) {
          updatePropertiesStats(id);
        }
      }
    });
  });
  
  // PENTING: Bersihkan label yang orphan setelah delete
  cleanupOrphanLabels();
});

// Event untuk vertex drag (real-time update)
map.on('draw:editvertex', function(e) {
  // Cari layer yang sedang di-edit
  Object.keys(uploadedFiles).forEach(function(id) {
    var meta = uploadedFiles[id];
    var found = false;
    
    meta.group.eachLayer(function(layer) {
      if (layer === e.layer) {
        found = true;
      }
    });
    
    if (found) {
      // Delay update agar tidak terlalu sering (throttle)
      if (meta._updateTimeout) clearTimeout(meta._updateTimeout);
      
      meta._updateTimeout = setTimeout(function() {
        updateMapLabels(id);
        if (lastSelectedId === id) {
          updatePropertiesStats(id);
        }
      }, 100); // Update setiap 100ms
    }
  });
});

// --- State ---
var uploadedFiles = {}; // id -> { name, group:LayerGroup, bounds, color, weight, fillColor, fillOpacity, dashArray, markerSymbol }
var lastSelectedId = null;
var labelLayers = {}; // id -> array of label markers

// --- Helpers: create group from GeoJSON, adding each sublayer to a LayerGroup ---
// --- Helpers: create group from GeoJSON, adding each sublayer to a LayerGroup ---
function createGroupFromGeoJSON(geojson, styleMeta, fileId){
  styleMeta = styleMeta || {};

  // HARUS FeatureGroup supaya ada getBounds()
  var group = L.featureGroup();

  // Buat GeoJSON layer sementara
  var base = L.geoJSON(geojson, {
    style: function(f){
      return {
        color: styleMeta.color || '#0077ff',
        weight: styleMeta.weight || 3,
        dashArray: styleMeta.dashArray || null,
        fillColor: styleMeta.fillColor || (styleMeta.color || '#0077ff'),
        fillOpacity: styleMeta.fillOpacity || 0.4
      };
    },
    pointToLayer: function(f,latlng){
      var symbol = styleMeta.markerSymbol || 'circle';

      if(symbol === 'circle'){
        return L.circleMarker(latlng,{
          radius:5,
          color: styleMeta.color || '#0077ff',
          fillColor: styleMeta.fillColor || (styleMeta.color||'#0077ff'),
          fillOpacity: styleMeta.fillOpacity || 0.8
        });
      } else {
        var html = '<div style="width:12px;height:12px;border-radius:2px;background:'+ 
                    (styleMeta.color||'#0077ff') +'"></div>';

        return L.marker(latlng,{
          icon: L.divIcon({
            className:'custom-marker',
            html:html,
            iconSize:[12,12],
            iconAnchor:[6,6]
          })
        });
      }
    }
  });

  // PENTING: pindahkan SEMUA sublayer geojson ke FeatureGroup
  base.eachLayer(function(layer){
    // Attach click event jika fileId tersedia
    if (fileId) {
      attachLayerClickEvent(layer, fileId);
    }
    group.addLayer(layer);
  });

  return group;
}

// --- Helper: Attach click event to layers ---
function attachLayerClickEvent(layer, fileId) {
  layer.on('click', function(e) {
    L.DomEvent.stopPropagation(e); // Prevent map click event
    console.log('Layer clicked, opening properties for:', fileId);
    openProperties(fileId);
  });
}

// --- Helper: Attach click event to layers ---
function attachLayerClickEvent(layer, fileId) {
  layer.on('click', function(e) {
    L.DomEvent.stopPropagation(e); // Prevent map click event
    console.log('Layer clicked, opening properties for:', fileId);
    openProperties(fileId);
  });
}

// --- Utility: simple GPX exporter for GeoJSON (points as wpt, lines/polygons as trk) ---
function geojsonToGpx(geojson, name){
  var esc = function(s){ return (''+s).replace(/&/g,'&amp;').replace(/</g,'&lt;'); };
  var xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
  xml += '<gpx version="1.1" creator="MiniArcGIS">\n';
  xml += '<name>' + esc(name||'export') + '</name>\n';

  geojson.features.forEach(function(f){
    var geom = f.geometry;
    if(!geom) return;
    if(geom.type === 'Point'){
      var c = geom.coordinates;
      xml += '<wpt lat="'+c[1]+'" lon="'+c[0]+'"><name>' + (esc(f.properties && f.properties.name || 'pt')) + '</name></wpt>\n';
    } else if(geom.type === 'LineString'){
      xml += '<trk><name>' + (esc(f.properties && f.properties.name || 'line')) + '</name><trkseg>\n';
      geom.coordinates.forEach(function(c){ xml += '<trkpt lat="'+c[1]+'" lon="'+c[0]+'"></trkpt>\n'; });
      xml += '</trkseg></trk>\n';
    } else if(geom.type === 'Polygon'){
      // export outer ring as track
      var ring = geom.coordinates[0];
      xml += '<trk><name>' + (esc(f.properties && f.properties.name || 'poly')) + '</name><trkseg>\n';
      ring.forEach(function(c){ xml += '<trkpt lat="'+c[1]+'" lon="'+c[0]+'"></trkpt>\n'; });
      xml += '</trkseg></trk>\n';
    } else if(geom.type === 'MultiLineString'){
      geom.coordinates.forEach(function(line){
        xml += '<trk><trkseg>\n';
        line.forEach(function(c){ xml += '<trkpt lat="'+c[1]+'" lon="'+c[0]+'"></trkpt>\n'; });
        xml += '</trkseg></trk>\n';
      });
    }
  });

  xml += '</gpx>';
  return xml;
}

// --- UI helpers ---
function el(q){ return document.querySelector(q); }
function elAll(q){ return Array.from(document.querySelectorAll(q)); }

// Build file card in sidebar
function addFileCard(id, meta){
  var ul = el('#fileList');
  var li = document.createElement('li'); li.className='file-card'; li.id='file-'+id;

  // header row
  var header = document.createElement('div'); header.className='file-header';
  var chk = document.createElement('input'); chk.type='checkbox'; chk.checked=true;
  chk.onchange = function(){ toggleFile(id, chk.checked); };
  var title = document.createElement('div'); title.className='file-title'; title.innerText = meta.name;
  title.onclick = function(){ openRename(id); };

  var actions = document.createElement('div'); actions.className='file-actions';
  var btnZoom = document.createElement('button'); btnZoom.className='btn-small'; btnZoom.innerText='Zoom'; btnZoom.onclick=function(e){ e.stopPropagation(); zoomFile(id); };
  var btnStyle = document.createElement('button'); btnStyle.className='btn-small'; btnStyle.innerText='Style'; btnStyle.onclick=function(e){ e.stopPropagation(); openProperties(id); };
  var btnExport = document.createElement('button'); btnExport.className='btn-small'; btnExport.innerText='Export'; btnExport.onclick=function(e){ e.stopPropagation(); exportAllFor(id); };
  var btnDel = document.createElement('button'); btnDel.className='btn-small'; btnDel.innerText='Delete'; btnDel.onclick=function(e){ e.stopPropagation(); deleteFile(id); };

  actions.appendChild(btnZoom); actions.appendChild(btnStyle); actions.appendChild(btnExport); actions.appendChild(btnDel);
  header.appendChild(chk); header.appendChild(title); header.appendChild(actions);
  li.appendChild(header);

  // folder contents (infos)
  var folder = document.createElement('div'); folder.className='folder-contents';
  var info = document.createElement('div'); info.className='muted';
  info.innerText = meta.summary || '';
  folder.appendChild(info);
  li.appendChild(folder);

  ul.appendChild(li);
}

// Toggle display/hide file
function toggleFile(id, show){
  var meta = uploadedFiles[id]; if(!meta) return;
  
  meta.group.eachLayer(function(layer){
    if(show){ 
      map.addLayer(layer); 
      editableLayers.addLayer(layer); 
    } else { 
      map.removeLayer(layer); 
      editableLayers.removeLayer(layer); 
    }
  });
  
  // Toggle label juga
  if (show) {
    updateMapLabels(id);
  } else {
    if (labelLayers[id]) {
      labelLayers[id].forEach(function(layer) {
        map.removeLayer(layer);
      });
    }
  }
}

// Zoom to file
function zoomFile(id){ var meta = uploadedFiles[id]; if(!meta) return; if(meta.bounds && meta.bounds.isValid()) map.fitBounds(meta.bounds); }

// delete file
function deleteFile(id){
  if(!confirm('Hapus file?')) return;
  var meta = uploadedFiles[id]; if(!meta) return;
  
  // Hapus semua layer dari peta
  meta.group.eachLayer(function(l){ 
    map.removeLayer(l); 
    editableLayers.removeLayer(l); 
  });
  
  // PENTING: Hapus semua label
  if (labelLayers[id]) {
    labelLayers[id].forEach(function(layer) {
      map.removeLayer(layer);
    });
    delete labelLayers[id];
  }
  
  delete uploadedFiles[id];
  var node = document.getElementById('file-'+id); 
  if(node) node.remove();
  if(lastSelectedId === id) closeProperties();
}

// open rename inline
function openRename(id){
  var card = document.getElementById('file-'+id);
  if(!card) return;
  var title = card.querySelector('.file-title');
  var old = title.innerText;
  var input = document.createElement('input'); input.type='text'; input.value = old; input.style.flex='1';
  title.replaceWith(input);
  input.focus();
  input.onkeydown = function(e){
    if(e.key === 'Enter'){ finishRename(id, input.value); }
    if(e.key === 'Escape'){ cancelRename(id, old); }
  };
  input.onblur = function(){ finishRename(id, input.value); };
}

function finishRename(id, val){
  val = (val||'').trim() || uploadedFiles[id].name;
  var meta = uploadedFiles[id];
  
  // Update nama layer
  meta.name = val;
  
  // AUTO UPDATE LABEL BLOCK NAME
  meta.labelSettings.blockName = val.replace('.gpx', '');
  
  var card = document.getElementById('file-'+id);
  var input = card.querySelector('input[type=text]');
  var title = document.createElement('div'); title.className='file-title'; title.innerText = val; title.onclick = function(){ openRename(id); };
  input.replaceWith(title);
  
  // Update properties header if open
  if(lastSelectedId === id) el('#propName').value = val;
  
  // Refresh labels di peta
  updateMapLabels(id);
}

function cancelRename(id, old){ var card = document.getElementById('file-'+id); if(!card) return; var input = card.querySelector('input[type=text]'); var title = document.createElement('div'); title.className='file-title'; title.innerText = old; title.onclick = function(){ openRename(id); }; input.replaceWith(title); }

// --- Properties panel ---
function openProperties(id){
  var meta = uploadedFiles[id]; if(!meta) return;
  lastSelectedId = id;
  var panel = el('#propertiesPanel'); panel.classList.remove('hidden');
  el('#propName').value = meta.name;

  // Update stats menggunakan helper function
  updatePropertiesStats(id);
  
  // stats: counts, length, area
  var gj = meta.group.toGeoJSON();
  var cnt = gj.features.length;
  var len = 0, area = 0;
  gj.features.forEach(function(f){
    if(f.geometry && (f.geometry.type==='LineString' || f.geometry.type==='MultiLineString')) len += turf.length(f, {units:'meters'}) * 1000; // turf.length returns km, convert m
    if(f.geometry && (f.geometry.type==='Polygon' || f.geometry.type==='MultiPolygon')) area += turf.area(f);
  });
  el('#propStats').innerText = 'Features: ' + cnt + '  •  Length ≈ ' + Math.round(len) + ' m  •  Area ≈ ' + Math.round(area) + ' m²';

  // style controls set to current meta
  el('#styleStrokeColor').value = meta.color || '#0077ff';
  el('#styleStrokeWidth').value = meta.weight || 3;
  el('#strokeWidthVal').innerText = meta.weight || 3;
  el('#styleFillColor').value = meta.fillColor || (meta.color || '#0077ff');
  el('#styleFillOpacity').value = (typeof meta.fillOpacity !== 'undefined') ? meta.fillOpacity : 0.4;
  el('#fillOpacityVal').innerText = el('#styleFillOpacity').value;
  el('#styleDash').value = meta.dashArray || '';
  el('#styleMarker').value = meta.markerSymbol || 'circle';

  // Load label settings
  el('#labelShow').checked = meta.labelSettings.show;
  // HAPUS baris labelBlockName karena input sudah tidak ada
  el('#labelTextColor').value = meta.labelSettings.textColor;
  el('#labelTextSize').value = meta.labelSettings.textSize;
  el('#labelSizeVal').innerText = meta.labelSettings.textSize;

  // Pastikan offsetX dan offsetY ada (untuk backward compatibility)
  if (typeof meta.labelSettings.offsetX === 'undefined') {
    meta.labelSettings.offsetX = 0;
    meta.labelSettings.offsetY = 0;
  }
  
  // Update labels on map
  updateMapLabels(id);
}

// Fungsi helper untuk update statistics di properties panel
function updatePropertiesStats(id) {
  var meta = uploadedFiles[id];
  if (!meta) return;
  
  var gj = meta.group.toGeoJSON();
  var cnt = gj.features.length;
  var len = 0, area = 0;
  
  gj.features.forEach(function(f){
    if(f.geometry && (f.geometry.type==='LineString' || f.geometry.type==='MultiLineString')) {
      len += turf.length(f, {units:'meters'}) * 1000;
    }
    if(f.geometry && (f.geometry.type==='Polygon' || f.geometry.type==='MultiPolygon')) {
      area += turf.area(f);
    }
  });
  
  el('#propStats').innerText = 'Features: ' + cnt + '  •  Length ≈ ' + Math.round(len) + ' m  •  Area ≈ ' + Math.round(area) + ' m²';
}

// Tambahkan setelah fungsi openProperties (sekitar baris 230)

// Fungsi untuk membuat/update label di peta
function updateMapLabels(id) {
  var meta = uploadedFiles[id];
  if (!meta || !meta.labelSettings.show) {
    // Hapus label jika ada
    if (labelLayers[id]) {
      labelLayers[id].forEach(function(layer) {
        map.removeLayer(layer);
      });
      labelLayers[id] = [];
    }
    return;
  }

  // Hapus label lama
  if (labelLayers[id]) {
    labelLayers[id].forEach(function(layer) {
      map.removeLayer(layer);
    });
  }
  labelLayers[id] = [];

  var gj = meta.group.toGeoJSON();
  gj.features.forEach(function(f, featureIdx) {
    if (!f.geometry || f.geometry.type !== 'Polygon') return;
    
    var centroid = turf.centroid(f);
    var area = turf.area(f);
    var areaHa = (area / 10000).toFixed(2);
    
    // Gunakan offset jika ada (dalam derajat geografis)
    var offsetX = meta.labelSettings.offsetX || 0;
    var offsetY = meta.labelSettings.offsetY || 0;
    var labelLat = centroid.geometry.coordinates[1] + offsetY;
    var labelLng = centroid.geometry.coordinates[0] + offsetX;
    
    var labelHtml = '<div style="' +
      'background:rgba(255,255,255,0.8);' +
      'padding:4px 8px;' +
      'border:1px solid #000;' +
      'border-radius:4px;' +
      'text-align:center;' +
      'white-space:nowrap;' +
      'font-weight:600;' +
      'color:' + meta.labelSettings.textColor + ';' +
      'font-size:' + meta.labelSettings.textSize + 'px;' +
      'cursor:move;' +
      '">' +
      meta.labelSettings.blockName + '<br>' +
      areaHa + ' Ha' +
      '</div>';
    
    var labelMarker = L.marker(
      [labelLat, labelLng],
      {
        icon: L.divIcon({
          className: 'label-marker',
          html: labelHtml,
          iconSize: null,
          iconAnchor: [0, 0]
        }),
        draggable: true
      }
    );
    
    // Event saat label di-drag
    labelMarker.on('dragend', function(e) {
      var newLatLng = e.target.getLatLng();
      var originalCentroid = centroid.geometry.coordinates;
      
      // Hitung offset baru dalam derajat
      var newOffsetX = newLatLng.lng - originalCentroid[0];
      var newOffsetY = newLatLng.lat - originalCentroid[1];
      
      // Simpan offset
      meta.labelSettings.offsetX = newOffsetX;
      meta.labelSettings.offsetY = newOffsetY;
      
      console.log('Label moved. New offset:', newOffsetX, newOffsetY);
    });
    
    labelMarker.addTo(map);
    labelLayers[id].push(labelMarker);
  });
}

// Fungsi untuk membersihkan label yang tidak ada layer-nya
function cleanupOrphanLabels() {
  Object.keys(labelLayers).forEach(function(id) {
    var meta = uploadedFiles[id];
    
    // Jika file sudah tidak ada, hapus labelnya
    if (!meta) {
      if (labelLayers[id]) {
        labelLayers[id].forEach(function(layer) {
          map.removeLayer(layer);
        });
        delete labelLayers[id];
      }
      return;
    }
    
    // Jika group kosong (semua layer dihapus), hapus label
    var hasLayers = false;
    meta.group.eachLayer(function() { hasLayers = true; });
    
    if (!hasLayers) {
      if (labelLayers[id]) {
        labelLayers[id].forEach(function(layer) {
          map.removeLayer(layer);
        });
        labelLayers[id] = [];
      }
    }
  });
}

function closeProperties(){ lastSelectedId = null; el('#propertiesPanel').classList.add('hidden'); }

// style controls live display
el('#styleStrokeWidth').oninput = function(){ el('#strokeWidthVal').innerText = this.value; };
el('#styleFillOpacity').oninput = function(){ el('#fillOpacityVal').innerText = this.value; };

// Tambahkan setelah baris el('#styleFillOpacity').oninput

// Label controls live display
el('#labelTextSize').oninput = function(){ el('#labelSizeVal').innerText = this.value; };

// Reset label position
el('#resetLabelPosition').onclick = function(){
  if(!lastSelectedId) return;
  var meta = uploadedFiles[lastSelectedId];
  meta.labelSettings.offsetX = 0;
  meta.labelSettings.offsetY = 0;
  updateMapLabels(lastSelectedId);
  alert('Posisi label direset ke tengah polygon.');
};

// apply ALL (style + label) to lastSelectedId
// apply ALL (nama + style + label) to lastSelectedId
el('#applyStyle').onclick = function(){
  if(!lastSelectedId) return alert('Pilih layer dulu.');
  var meta = uploadedFiles[lastSelectedId];
  
  // ===== APPLY NAMA LAYER =====
  var newName = el('#propName').value.trim() || meta.name;
  meta.name = newName;
  
  // Update nama di sidebar card
  var card = document.getElementById('file-'+lastSelectedId);
  if(card) card.querySelector('.file-title').innerText = newName;
  
  // ===== APPLY STYLE =====
  meta.color = el('#styleStrokeColor').value;
  meta.weight = parseInt(el('#styleStrokeWidth').value);
  meta.fillColor = el('#styleFillColor').value;
  meta.fillOpacity = parseFloat(el('#styleFillOpacity').value);
  meta.dashArray = el('#styleDash').value || null;
  meta.markerSymbol = el('#styleMarker').value || 'circle';

  // apply styles to each sublayer
  meta.group.eachLayer(function(layer){
    if(layer.setStyle){
      layer.setStyle({ color: meta.color, weight: meta.weight, dashArray: meta.dashArray, fillColor: meta.fillColor, fillOpacity: meta.fillOpacity });
    }
    // for markers drawn as CircleMarker
    if(layer.setRadius){
      layer.setStyle({ color: meta.color, fillColor: meta.fillColor });
    }
  });
  
  // ===== APPLY LABEL =====
  // Preserve offset jika sudah ada
  var existingOffsetX = meta.labelSettings.offsetX || 0;
  var existingOffsetY = meta.labelSettings.offsetY || 0;
  
  meta.labelSettings = {
    show: el('#labelShow').checked,
    blockName: newName.replace('.gpx', ''), // AUTO dari nama layer yang baru
    textColor: el('#labelTextColor').value,
    textSize: parseInt(el('#labelTextSize').value),
    offsetX: existingOffsetX,
    offsetY: existingOffsetY
  };
  
  // Update labels on map
  updateMapLabels(lastSelectedId);
  
  alert('Semua perubahan (nama, style, label) diterapkan!');
};

// revert ALL (style + label) to defaults
el('#revertStyle').onclick = function(){
  if(!lastSelectedId) return;
  var meta = uploadedFiles[lastSelectedId];
  
  // ===== RESET STYLE =====
  meta.color = '#000000';
  meta.weight = 3;
  meta.fillColor = '#ee00ff';
  meta.fillOpacity = 0.4;
  meta.dashArray = null;
  meta.markerSymbol = 'circle';
  
  // ===== RESET LABEL =====
  meta.labelSettings = {
    show: true,
    blockName: meta.name.replace('.gpx', ''),
    textColor: '#000000',
    textSize: 12,
    offsetX: meta.labelSettings.offsetX || 0,  // Keep position
    offsetY: meta.labelSettings.offsetY || 0
  };
  
  // Refresh properties panel
  openProperties(lastSelectedId);
  
  // Apply changes
  el('#applyStyle').click();
};

// Export buttons
el('#exportGeojson').onclick = function(){ if(!lastSelectedId) return; var meta = uploadedFiles[lastSelectedId]; var gj = meta.group.toGeoJSON(); var blob = new Blob([JSON.stringify(gj,null,2)],{type:'application/json'}); saveAs(blob, (meta.name||'layer') + '.geojson'); };
el('#exportGpx').onclick = function(){ if(!lastSelectedId) return; var meta = uploadedFiles[lastSelectedId]; var gj = meta.group.toGeoJSON(); var gpx = geojsonToGpx(gj, meta.name); saveAs(new Blob([gpx],{type:'application/gpx+xml'}), (meta.name||'layer') + '.gpx'); };
el('#exportKml').onclick = function(){ if(!lastSelectedId) return; var meta = uploadedFiles[lastSelectedId]; var gj = meta.group.toGeoJSON(); var kml = tokml(gj); saveAs(new Blob([kml],{type:'application/vnd.google-earth.kml+xml'}), (meta.name||'layer') + '.kml'); };
el('#deleteLayer').onclick = function(){ if(!lastSelectedId) return deleteFile(lastSelectedId); };

// export all action from card (opens properties then triggers export dialog)
function exportAllFor(id){
  openProperties(id);
  // user can click desired export button
}

el('#btnUpload').onclick = function(){
  var fi = el('#gpxFile');
  if(!fi.files || fi.files.length === 0) return alert('Pilih file GPX.');

  var files = Array.from(fi.files);
  var totalFiles = files.length;
  var processedFiles = 0;
  var allBounds = [];

  // Tampilkan progress
  var progressDiv = el('#uploadProgress');
  var progressText = el('#progressText');
  if(progressDiv) {
    progressDiv.style.display = 'block';
    progressText.innerText = '0/' + totalFiles;
  }

  console.log('Mulai upload ' + totalFiles + ' file...');

  files.forEach(function(file, index) {
    var reader = new FileReader();

    reader.onload = function(){
      try {
        var dom = new DOMParser().parseFromString(reader.result, 'text/xml');
        var geojson = toGeoJSON.gpx(dom);
        geojson = convertLineToPolygonGeoJSON(geojson);

        var id = Date.now() + '-' + index + '-' + Math.floor(Math.random()*1000);

        // ===== WARNA DEFAULT TETAP (TIDAK RANDOM) =====
        var metaDefaults = {
          color: '#000000',        // Line hitam RGB(0,0,0)
          weight: 3,
          fillColor: '#ee00ff',    // Polygon pink RGB(238,0,255)
          fillOpacity: 0.4,
          dashArray: null,
          markerSymbol: 'circle'
        };

        var group = createGroupFromGeoJSON(geojson, metaDefaults, id);
        var bounds = group.getBounds();

        uploadedFiles[id] = {
          name: file.name,
          group: group,
          bounds: bounds,
          color: metaDefaults.color,
          weight: metaDefaults.weight,
          fillColor: metaDefaults.fillColor,
          fillOpacity: metaDefaults.fillOpacity,
          dashArray: metaDefaults.dashArray,
          markerSymbol: metaDefaults.markerSymbol,
          labelSettings: {
            show: true,
            blockName: file.name.replace('.gpx', ''),
            textColor: '#000000',
            textSize: 12,
            offsetX: 0,
            offsetY: 0
          }
        };

        group.eachLayer(function(l){
          map.addLayer(l);
          editableLayers.addLayer(l);
        });

        addFileCard(id, {
          name: file.name,
          summary: (bounds && bounds.isValid() ? "Bounds available" : "No bounds")
        });

        if(bounds && bounds.isValid()) {
          allBounds.push(bounds);
        }

        processedFiles++;
        
        // Update progress
        if(progressText) {
          progressText.innerText = processedFiles + '/' + totalFiles;
        }
        
        console.log('File ' + processedFiles + '/' + totalFiles + ' berhasil: ' + file.name);

        if(processedFiles === totalFiles) {
          if(allBounds.length > 0) {
            var combinedBounds = allBounds[0];
            for(var i = 1; i < allBounds.length; i++) {
              combinedBounds.extend(allBounds[i]);
            }
            map.fitBounds(combinedBounds);
          }
          
          // Sembunyikan progress
          if(progressDiv) {
            setTimeout(function() {
              progressDiv.style.display = 'none';
            }, 1000);
          }
          
          alert('Berhasil upload ' + totalFiles + ' file!');
          fi.value = '';
        }

      } catch(error) {
        console.error('Error processing file ' + file.name + ':', error);
        processedFiles++;
        
        if(progressText) {
          progressText.innerText = processedFiles + '/' + totalFiles;
        }
        
        if(processedFiles === totalFiles) {
          if(progressDiv) progressDiv.style.display = 'none';
          alert('Upload selesai dengan beberapa error. Cek console.');
          fi.value = '';
        }
      }
    };

    reader.onerror = function() {
      console.error('Error reading file: ' + file.name);
      processedFiles++;
      
      if(progressText) {
        progressText.innerText = processedFiles + '/' + totalFiles;
      }
      
      if(processedFiles === totalFiles) {
        if(progressDiv) progressDiv.style.display = 'none';
        alert('Upload selesai dengan beberapa error. Cek console.');
        fi.value = '';
      }
    };

    reader.readAsText(file);
  });
};

// close properties if click outside
map.on('click', function(){ /* keep panel open to edit; optionally close */ });

// Optional: keyboard Esc closes props
document.addEventListener('keydown', function(e){ if(e.key === 'Escape'){ closeProperties(); } });

function convertLineToPolygonGeoJSON(gj) {
    if (!gj || !gj.features) return gj;

    var newFeatures = [];

    gj.features.forEach(function (f) {
        if (!f.geometry) return;

        // Jika LineString → jadikan Polygon
        if (f.geometry.type === "LineString") {
            var coords = f.geometry.coordinates;

            if (coords.length >= 3) {
                var ring = coords.slice();
                ring.push(coords[0]); // Tutup polygon

                newFeatures.push({
                    type: "Feature",
                    properties: f.properties || {},
                    geometry: {
                        type: "Polygon",
                        coordinates: [ring]
                    }
                });
            } else {
                newFeatures.push(f);
            }
        } else {
            newFeatures.push(f);
        }
    });

    return {
        type: "FeatureCollection",
        features: newFeatures
    };
}

// ===== TAMBAHKAN DI AKHIR app.js (sebelum // End of app.js) =====

// Variable untuk menyimpan judul PDF
var pdfSettings = {
  title: "PETA AREAL KEBUN",
  subtitle: ""
};

// Event handler untuk tombol Print PDF
document.getElementById("btnPrintPdf").onclick = function() {
  // Cek apakah ada data
  const gj = editableLayers.toGeoJSON();
  if (!gj || !gj.features || gj.features.length === 0) {
    alert("Tidak ada data untuk dicetak.");
    return;
  }
  
  // Tampilkan modal
  showPdfModal();
};

// Fungsi untuk menampilkan modal
function showPdfModal() {
  const modal = document.getElementById('pdfModal');
  const titleInput = document.getElementById('pdfTitle');
  const subtitleInput = document.getElementById('pdfSubtitle');
  
  // Set nilai default
  titleInput.value = pdfSettings.title;
  subtitleInput.value = pdfSettings.subtitle;
  
  // Tampilkan modal
  modal.style.display = 'flex';
  
  // Focus ke input pertama
  setTimeout(() => titleInput.focus(), 100);
}

// Fungsi untuk menyembunyikan modal
function hidePdfModal() {
  const modal = document.getElementById('pdfModal');
  modal.style.display = 'none';
}

// Event handler untuk tombol Batal
document.getElementById('btnCancelPdf').onclick = function() {
  hidePdfModal();
};

// Event handler untuk tombol Cetak PDF
document.getElementById('btnConfirmPdf').onclick = function() {
  // Ambil nilai dari input
  const titleInput = document.getElementById('pdfTitle');
  const subtitleInput = document.getElementById('pdfSubtitle');
  
  pdfSettings.title = titleInput.value.trim() || "PETA AREAL KEBUN";
  pdfSettings.subtitle = subtitleInput.value.trim() || "";
  
  // Sembunyikan modal
  hidePdfModal();
  
  // Mulai generate PDF
  exportPdfFromLayers();
};

// Event handler untuk Enter key di input
// Auto UPPERCASE untuk Title
document.getElementById('pdfTitle').addEventListener('input', function(e) {
  this.value = this.value.toUpperCase();
});

document.getElementById('pdfTitle').addEventListener('keydown', function(e) {
  if (e.key === 'Enter') {
    document.getElementById('pdfSubtitle').focus();
  }
});

// Auto UPPERCASE untuk Subtitle
document.getElementById('pdfSubtitle').addEventListener('input', function(e) {
  this.value = this.value.toUpperCase();
});

document.getElementById('pdfSubtitle').addEventListener('keydown', function(e) {
  if (e.key === 'Enter') {
    document.getElementById('btnConfirmPdf').click();
  }
});

// Event handler untuk Escape key (tutup modal)
document.addEventListener('keydown', function(e) {
  if (e.key === 'Escape') {
    const modal = document.getElementById('pdfModal');
    if (modal.style.display === 'flex') {
      hidePdfModal();
    }
  }
});

// Event handler untuk klik di luar modal (tutup modal)
document.getElementById('pdfModal').addEventListener('click', function(e) {
  if (e.target === this) {
    hidePdfModal();
  }
});

async function exportPdfFromLayers() {
    const { PDFDocument, rgb } = PDFLib;

    const pdfDoc = await PDFDocument.create();
    const page = pdfDoc.addPage([842, 595]); // A4 landscape

    const gj = editableLayers.toGeoJSON();
    if (!gj || !gj.features || gj.features.length === 0) {
        alert("Tidak ada data untuk dicetak.");
        return;
    }

    // --------- Hitung bounding box ---------
    const bbox = turf.bbox(gj);
    const [minX, minY, maxX, maxY] = bbox;

    // Area peta
    const mapWidth = 500;
    const mapHeight = 450;
    const mapOffsetX = 50;
    const mapOffsetY = 80;

    function project([lng, lat]) {
        const dx = maxX - minX;
        const dy = maxY - minY;
        const scale = Math.min(mapWidth / dx, mapHeight / dy) * 0.9;
        const centerX = mapOffsetX + mapWidth / 2;
        const centerY = mapOffsetY + mapHeight / 2;
        const x = centerX + (lng - (minX + maxX) / 2) * scale;
        const y = centerY + (lat - (minY + maxY) / 2) * scale;
        return [x, y];
    }

    // --------- Border Peta ---------
    page.drawRectangle({
        x: mapOffsetX,
        y: mapOffsetY,
        width: mapWidth,
        height: mapHeight,
        borderColor: rgb(0, 0, 0),
        borderWidth: 2
    });

    // --------- Grid Koordinat ---------
    const gridColor = rgb(0.7, 0.7, 0.7);
    const numGridLines = 4;
    
    // Vertical grid lines
    for (let i = 0; i <= numGridLines; i++) {
        const lng = minX + (maxX - minX) * (i / numGridLines);
        const [x, y1] = project([lng, minY]);
        const [, y2] = project([lng, maxY]);
        
        page.drawLine({
            start: { x, y: y1 },
            end: { x, y: y2 },
            thickness: 0.5,
            color: gridColor,
            dashArray: [3, 3]
        });
        
        const lngLabel = lng.toFixed(4) + "°E";
        page.drawText(lngLabel, { x: x - 20, y: mapOffsetY - 15, size: 8, color: rgb(0, 0, 0) });
    }
    
    // Horizontal grid lines
    for (let i = 0; i <= numGridLines; i++) {
        const lat = minY + (maxY - minY) * (i / numGridLines);
        const [x1, y] = project([minX, lat]);
        const [x2] = project([maxX, lat]);
        
        page.drawLine({
            start: { x: x1, y },
            end: { x: x2, y },
            thickness: 0.5,
            color: gridColor,
            dashArray: [3, 3]
        });
        
        const latLabel = lat.toFixed(4) + "°N";
        page.drawText(latLabel, { x: mapOffsetX - 45, y: y - 3, size: 8, color: rgb(0, 0, 0) });
    }
    
    // --------- Helper Functions ---------
    
    // Helper: konversi hex color ke RGB
    function hexToRgb(hex) {
        const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
        return result ? {
            r: parseInt(result[1], 16) / 255,
            g: parseInt(result[2], 16) / 255,
            b: parseInt(result[3], 16) / 255
        } : { r: 0, g: 0.5, b: 1 };
    }
    
    // Helper: gambar garis dengan dash pattern
    function drawDashedLine(page, x1, y1, x2, y2, dashPattern, thickness, color) {
        const dx = x2 - x1;
        const dy = y2 - y1;
        const lineLength = Math.sqrt(dx * dx + dy * dy);
        
        if (lineLength === 0) return;
        
        const unitX = dx / lineLength;
        const unitY = dy / lineLength;
        
        let currentPos = 0;
        let patternIndex = 0;
        let isDash = true;
        
        while (currentPos < lineLength) {
            const segmentLength = dashPattern[patternIndex % dashPattern.length];
            const endPos = Math.min(currentPos + segmentLength, lineLength);
            
            if (isDash) {
                const startX = x1 + unitX * currentPos;
                const startY = y1 + unitY * currentPos;
                const endX = x1 + unitX * endPos;
                const endY = y1 + unitY * endPos;
                
                page.drawLine({
                    start: { x: startX, y: startY },
                    end: { x: endX, y: endY },
                    thickness: thickness,
                    color: color,
                    opacity: 1
                });
            }
            
            currentPos = endPos;
            patternIndex++;
            isDash = !isDash;
        }
    }
    
    // --------- Gambar Polygon & Polyline ---------
    let totalArea = 0;
    
    Object.keys(uploadedFiles).forEach(id => {
        const meta = uploadedFiles[id];
        const layerGj = meta.group.toGeoJSON();
        
        const strokeRgb = hexToRgb(meta.color || '#0077ff');
        const fillRgb = hexToRgb(meta.fillColor || meta.color || '#0077ff');
        const strokeColor = rgb(strokeRgb.r, strokeRgb.g, strokeRgb.b);
        const fillColor = rgb(fillRgb.r, fillRgb.g, fillRgb.b);
        const lineWidth = meta.weight || 3;
        const fillOpacity = (typeof meta.fillOpacity !== 'undefined') ? meta.fillOpacity : 0.4;
        
        layerGj.features.forEach(f => {
            if (!f.geometry) return;
            const type = f.geometry.type;
        
            // ---- POLYGON ----
            if (type === "Polygon") {
                const area = turf.area(f);
                totalArea += area;
    
                f.geometry.coordinates.forEach((ring, ringIdx) => {
                    if (ringIdx !== 0) return;
                    
                    // Gambar fill
                    const allY = ring.map(c => project(c)[1]);
                    const minYPoly = Math.min(...allY);
                    const maxYPoly = Math.max(...allY);
                    
                    for(let fillY = minYPoly; fillY <= maxYPoly; fillY += 1) {
                        const intersections = [];
                        for(let i = 0; i < ring.length - 1; i++){
                            const [x1, y1] = project(ring[i]);
                            const [x2, y2] = project(ring[i + 1]);
                            
                            if((y1 <= fillY && fillY <= y2) || (y2 <= fillY && fillY <= y1)) {
                                if(y2 !== y1) {
                                    const t = (fillY - y1) / (y2 - y1);
                                    const xInt = x1 + t * (x2 - x1);
                                    intersections.push(xInt);
                                }
                            }
                        }
                        
                        intersections.sort((a, b) => a - b);
                        for(let j = 0; j < intersections.length - 1; j += 2) {
                            if(intersections[j + 1] !== undefined) {
                                page.drawLine({
                                    start: { x: intersections[j], y: fillY },
                                    end: { x: intersections[j + 1], y: fillY },
                                    thickness: 1,
                                    color: fillColor,
                                    opacity: fillOpacity * 0.6
                                });
                            }
                        }
                    }
                    
                    // Gambar border dengan support dash pattern
                    const dashPattern = meta.dashArray || '';
                    const isDashed = dashPattern.length > 0;
    
                    if (isDashed) {
                        const dashValues = dashPattern.split(',').map(v => parseFloat(v.trim()));
                        
                        for(let i = 0; i < ring.length - 1; i++){
                            const [x1, y1] = project(ring[i]);
                            const [x2, y2] = project(ring[i + 1]);
                            drawDashedLine(page, x1, y1, x2, y2, dashValues, lineWidth, strokeColor);
                        }
                        
                        const [xFirst, yFirst] = project(ring[0]);
                        const [xLast, yLast] = project(ring[ring.length - 1]);
                        drawDashedLine(page, xLast, yLast, xFirst, yFirst, dashValues, lineWidth, strokeColor);
                        
                    } else {
                        for(let i = 0; i < ring.length - 1; i++){
                            const [x1, y1] = project(ring[i]);
                            const [x2, y2] = project(ring[i + 1]);
                            
                            page.drawLine({
                                start: { x: x1, y: y1 },
                                end: { x: x2, y: y2 },
                                thickness: lineWidth,
                                color: strokeColor,
                                opacity: 1
                            });
                        }
                        
                        const [xFirst, yFirst] = project(ring[0]);
                        const [xLast, yLast] = project(ring[ring.length - 1]);
                        page.drawLine({
                            start: { x: xLast, y: yLast },
                            end: { x: xFirst, y: yFirst },
                            thickness: lineWidth,
                            color: strokeColor,
                            opacity: 1
                        });
                    }
                    
                    // ===== LABEL DI DALAM POLYGON =====
                    if (meta.labelSettings && meta.labelSettings.show) {
                        const centroid = turf.centroid(f);
                        const offsetX = meta.labelSettings.offsetX || 0;
                        const offsetY = meta.labelSettings.offsetY || 0;
                        const labelCoords = [
                            centroid.geometry.coordinates[0] + offsetX,
                            centroid.geometry.coordinates[1] + offsetY
                        ];
                        const [centX, centY] = project(labelCoords);
                        
                        const blockName = meta.labelSettings.blockName || meta.name.replace('.gpx', '');
                        const labelTextColor = hexToRgb(meta.labelSettings.textColor || '#000000');
                        
                        // ===== UKURAN FONT KECIL DAN SERAGAM =====
                        const labelSize = 7;
                        
                        // Hitung ukuran polygon di layar (pixel)
                        const polyBounds = turf.bbox(f);
                        const [polyMinX, polyMinY, polyMaxX, polyMaxY] = polyBounds;
                        const [pMinX, pMinY] = project([polyMinX, polyMinY]);
                        const [pMaxX, pMaxY] = project([polyMaxX, polyMaxY]);
                        const polyWidth = Math.abs(pMaxX - pMinX);
                        const polyHeight = Math.abs(pMaxY - pMinY);
                        const polySize = Math.min(polyWidth, polyHeight);
                        
                        // Skip polygon yang terlalu kecil
                        if (polySize < 25) {
                            console.log('Polygon terlalu kecil untuk label:', blockName);
                            return;
                        }
                        
                        const labelText = blockName;
                        const textWidth = labelText.length * (labelSize * 0.5);
                        const textHeight = labelSize * 1.4;
                        
                        // CEK: Apakah label muat di dalam polygon?
                        if (textWidth > polyWidth * 0.9 || textHeight > polyHeight * 0.9) {
                            console.log('Label terlalu besar untuk polygon:', blockName);
                            return;
                        }
                        
                        // Background kotak putih
                        page.drawRectangle({
                            x: centX - textWidth/2 - 3,
                            y: centY - textHeight/2,
                            width: textWidth + 6,
                            height: textHeight,
                            color: rgb(1, 1, 1),
                            opacity: 0.9
                        });
                        
                        // Border kotak
                        page.drawRectangle({
                            x: centX - textWidth/2 - 3,
                            y: centY - textHeight/2,
                            width: textWidth + 6,
                            height: textHeight,
                            borderColor: rgb(0, 0, 0),
                            borderWidth: 0.5
                        });
                        
                        // Teks nama blok (centered)
                        page.drawText(labelText, {
                            x: centX - (labelText.length * labelSize * 0.25),
                            y: centY - (labelSize * 0.25),
                            size: labelSize,
                            color: rgb(labelTextColor.r, labelTextColor.g, labelTextColor.b)
                        });
                    }
                });
            }
        
            // ---- LINESTRING ----
            else if (type === "LineString") {
                const dashPattern = meta.dashArray || '';
                const isDashed = dashPattern.length > 0;
                
                if (isDashed) {
                    const dashValues = dashPattern.split(',').map(v => parseFloat(v.trim()));
                    
                    for(let i = 0; i < f.geometry.coordinates.length - 1; i++){
                        const [x1, y1] = project(f.geometry.coordinates[i]);
                        const [x2, y2] = project(f.geometry.coordinates[i + 1]);
                        drawDashedLine(page, x1, y1, x2, y2, dashValues, lineWidth, strokeColor);
                    }
                } else {
                    for(let i = 0; i < f.geometry.coordinates.length - 1; i++){
                        const [x1, y1] = project(f.geometry.coordinates[i]);
                        const [x2, y2] = project(f.geometry.coordinates[i + 1]);
                        
                        page.drawLine({
                            start: { x: x1, y: y1 },
                            end: { x: x2, y: y2 },
                            thickness: lineWidth,
                            color: strokeColor,
                            opacity: 1
                        });
                    }
                }
            }
        });
    });
    
    // ========================================
    // SIDEBAR KANAN: Title, Kompas, Skala, Legenda
    // ========================================
    
    const sidebarX = 570;
    const sidebarWidth = 240;
    const centerX = sidebarX + (sidebarWidth / 2);
    
    let yPos = mapOffsetY + mapHeight - 15;
    
    // ========== KOTAK 1: TITLE & SUBTITLE (CENTER) ==========
    const box1Top = yPos;
    yPos -= 18;
    
    // Title (centered)
    const titleText = pdfSettings.title || "PETA AREAL KEBUN";
    const titleWidth = titleText.length * 8; // Estimasi lebar
    page.drawText(titleText, { 
        x: centerX - (titleWidth / 2), 
        y: yPos, 
        size: 14, 
        color: rgb(0, 0, 0) 
    });
    
    yPos -= 20;
    
    // Subtitle (centered)
    if (pdfSettings.subtitle && pdfSettings.subtitle.length > 0) {
        const subtitleWidth = pdfSettings.subtitle.length * 6;
        page.drawText(pdfSettings.subtitle, { 
            x: centerX - (subtitleWidth / 2), 
            y: yPos, 
            size: 10, 
            color: rgb(0.4, 0.4, 0.4) 
        });
        yPos -= 15;
    } else {
        yPos -= 5;
    }
    
    const box1Bottom = yPos - 10;
    page.drawRectangle({
        x: sidebarX,
        y: box1Bottom,
        width: sidebarWidth,
        height: box1Top - box1Bottom,
        borderColor: rgb(0, 0, 0),
        borderWidth: 1.5
    });
    
    yPos = box1Bottom - 15;
    
    // ========== KOTAK 2: KOMPAS & SKALA (CENTER) ==========
    const box2Top = yPos;
    yPos -= 20;
    
    // KOMPAS (centered left)
    const compassCenterX = sidebarX + 60;
    const compassCenterY = yPos - 20;
    
    page.drawCircle({
        x: compassCenterX,
        y: compassCenterY,
        size: 20,
        borderColor: rgb(0, 0, 0),
        borderWidth: 1.5
    });
    
    page.drawLine({
        start: { x: compassCenterX, y: compassCenterY },
        end: { x: compassCenterX, y: compassCenterY + 16 },
        thickness: 2.5,
        color: rgb(0, 0, 0)
    });
    page.drawLine({
        start: { x: compassCenterX, y: compassCenterY + 16 },
        end: { x: compassCenterX - 5, y: compassCenterY + 11 },
        thickness: 2.5,
        color: rgb(0, 0, 0)
    });
    page.drawLine({
        start: { x: compassCenterX, y: compassCenterY + 16 },
        end: { x: compassCenterX + 5, y: compassCenterY + 11 },
        thickness: 2.5,
        color: rgb(0, 0, 0)
    });
    page.drawText("U", { x: compassCenterX - 4, y: compassCenterY + 22, size: 11, color: rgb(0, 0, 0) });
    
    // SKALA (text only, centered)
    const scaleCenterX = sidebarX + 165;
    const scaleY = compassCenterY;
    
    // Hitung skala rasio
    const realDist = turf.distance([minX, minY], [maxX, minY], {units: 'meters'});
    const pixelDist = mapWidth;
    
    // Konversi ke cm
    const realDistCm = realDist * 100; // meter ke cm
    const pdfScaleCm = pixelDist * 2.54 / 72; // pixels ke cm (asumsi 72 DPI)
    
    // Hitung rasio skala (1 cm di peta = X cm di lapangan)
    const scaleRatio = Math.round(realDistCm / pdfScaleCm);
    
    // Format dengan pemisah ribuan
    const scaleText = "Skala 1 : " + scaleRatio.toLocaleString('id-ID');
    
    // Label SKALA (centered, line 1)
    const scaleTextWidth = scaleText.length * 5;
    page.drawText(scaleText, { 
        x: scaleCenterX - (scaleTextWidth / 2), 
        y: scaleY + 5, 
        size: 10, 
        color: rgb(0, 0, 0) 
    });
    
    yPos -= 55;
    
    const box2Bottom = yPos;
    page.drawRectangle({
        x: sidebarX,
        y: box2Bottom,
        width: sidebarWidth,
        height: box2Top - box2Bottom,
        borderColor: rgb(0, 0, 0),
        borderWidth: 1.5
    });
    
    yPos -= 15;
    
    // ========== KOTAK 3: KETERANGAN (CENTER HEADER) ==========
    const box3Top = yPos;
    yPos -= 15;
    
    // Header KETERANGAN (centered)
    const headerWidth = "KETERANGAN:".length * 6.5;
    page.drawText("KETERANGAN:", { x: centerX - headerWidth / 2, y: yPos, size: 11, color: rgb(0, 0, 0) });
    
    yPos -= 22;
    
    const fileIds = Object.keys(uploadedFiles);
    const totalFiles = fileIds.length;
    const lineHeight = 13;
    const maxLegendItems = 16;
    const useDoubleColumn = totalFiles > maxLegendItems;
    const itemsPerColumn = useDoubleColumn ? Math.ceil(totalFiles / 2) : totalFiles;
    
    const legendStartY = yPos;
    const paddingX = 12;
    
    fileIds.forEach((id, index) => {
        const meta = uploadedFiles[id];
        
        let itemX = sidebarX + paddingX;
        let itemY = legendStartY - (index % itemsPerColumn) * lineHeight;
        
        if (useDoubleColumn && index >= itemsPerColumn) {
            itemX = sidebarX + paddingX + 118;
            itemY = legendStartY - ((index - itemsPerColumn) % itemsPerColumn) * lineHeight;
        }
        
        const fillRgb = hexToRgb(meta.fillColor || meta.color || '#0077ff');
        const strokeRgb = hexToRgb(meta.color || '#0077ff');
        
        // Color box
        page.drawRectangle({
            x: itemX,
            y: itemY - 7,
            width: 13,
            height: 7,
            color: rgb(fillRgb.r, fillRgb.g, fillRgb.b),
            borderColor: rgb(strokeRgb.r, strokeRgb.g, strokeRgb.b),
            borderWidth: 0.8,
            opacity: meta.fillOpacity || 0.4
        });
        
        // Calculate area
        const layerGj = meta.group.toGeoJSON();
        let layerArea = 0;
        layerGj.features.forEach(f => {
            if (f.geometry && (f.geometry.type === 'Polygon' || f.geometry.type === 'MultiPolygon')) {
                layerArea += turf.area(f);
            }
        });
        
        const areaHa = (layerArea / 10000).toFixed(2);
        
        // Truncate name
        let displayName = meta.name.replace('.gpx', '');
        const maxChars = useDoubleColumn ? 10 : 18;
        if (displayName.length > maxChars) {
            displayName = displayName.substring(0, maxChars - 2) + '..';
        }
        
        // Text label
        page.drawText(displayName + " - " + areaHa + " Ha", { 
            x: itemX + 17, 
            y: itemY - 5, 
            size: 7,
            color: rgb(0, 0, 0) 
        });
    });
    
    yPos = legendStartY - (itemsPerColumn * lineHeight) - 15;
    
    // Total Luas (centered)
    const totalHa = (totalArea / 10000).toFixed(2);
    const totalText = "Total Luas: " + totalHa + " Ha";
    const totalWidth = totalText.length * 6;
    page.drawText(totalText, { 
        x: centerX - (totalWidth / 2), 
        y: yPos, 
        size: 10, 
        color: rgb(0, 0, 0)
    });
    
    yPos -= 15;
    
    const box3Bottom = yPos;
    page.drawRectangle({
        x: sidebarX,
        y: box3Bottom,
        width: sidebarWidth,
        height: box3Top - box3Bottom,
        borderColor: rgb(0, 0, 0),
        borderWidth: 1.5
    });
    
    // ========== FOOTER ==========
    const now = new Date();
    const dateStr = now.toLocaleDateString('id-ID');
    page.drawText("Dicetak: " + dateStr, { 
        x: 50, 
        y: 20, 
        size: 8, 
        color: rgb(0.4, 0.4, 0.4) 
    });
    
    const pdfBytes = await pdfDoc.save();

    // Generate nama file dari title + subtitle
    let filename = "";
    
    if (pdfSettings.title) {
        filename += pdfSettings.title.replace(/ /g, '_');
    }
    
    if (pdfSettings.subtitle && pdfSettings.subtitle.length > 0) {
        if (filename.length > 0) filename += "_";
        filename += pdfSettings.subtitle.replace(/ /g, '_');
    }
    
    // Fallback jika kosong
    if (filename.length === 0) {
        filename = "PETA_AREAL";
    }
    
    // Tambahkan ekstensi .pdf
    filename += ".pdf";
    
    saveAs(new Blob([pdfBytes]), filename);
}

// End of app.js
