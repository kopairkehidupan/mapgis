// --- Initialization ---
var map = L.map('map').setView([0.5,101.4],12);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:22}).addTo(map);

// Editable group for Leaflet.draw
var editableLayers = new L.FeatureGroup().addTo(map);

var drawControl = new L.Control.Draw({
  edit:{ featureGroup: editableLayers },
  draw:{ polygon:true, polyline:true, rectangle:true, marker:true, circle:false }
});
map.addControl(drawControl);
map.on(L.Draw.Event.CREATED, function(e){ editableLayers.addLayer(e.layer); });

// --- State ---
var uploadedFiles = {}; // id -> { name, group:LayerGroup, bounds, color, weight, fillColor, fillOpacity, dashArray, markerSymbol }
var lastSelectedId = null;

// --- Helpers: create group from GeoJSON, adding each sublayer to a LayerGroup ---
function createGroupFromGeoJSON(geojson, styleMeta){
  styleMeta = styleMeta || {};
  var group = L.layerGroup();
  var base = L.geoJSON(geojson, {
    style: function(f){ return { color: styleMeta.color || '#0077ff', weight: styleMeta.weight || 3, dashArray: styleMeta.dashArray || null, fillColor: styleMeta.fillColor || (styleMeta.color || '#0077ff'), fillOpacity: styleMeta.fillOpacity || 0.4 }; },
    pointToLayer: function(f,latlng){
      // create marker based on symbol
      var symbol = styleMeta.markerSymbol || 'circle';
      // simple marker variants using CircleMarker or DivIcon
      if(symbol === 'circle'){
        return L.circleMarker(latlng, { radius:5, color: styleMeta.color || '#0077ff', fillColor: styleMeta.fillColor || (styleMeta.color||'#0077ff'), fillOpacity: styleMeta.fillOpacity || 0.8 });
      } else {
        // use DivIcon for other shapes
        var html = '<div style="width:12px;height:12px;border-radius:2px;background:' + (styleMeta.color || '#0077ff') + ';"></div>';
        return L.marker(latlng, { icon: L.divIcon({ className:'custom-marker', html:html, iconSize:[12,12], iconAnchor:[6,6] }) });
      }
    }
  });
  base.eachLayer(function(l){ group.addLayer(l); });
  return { group: group, base: base };
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
    if(show){ map.addLayer(layer); editableLayers.addLayer(layer); } 
    else { map.removeLayer(layer); editableLayers.removeLayer(layer); }
  });
}

// Zoom to file
function zoomFile(id){ var meta = uploadedFiles[id]; if(!meta) return; if(meta.bounds && meta.bounds.isValid()) map.fitBounds(meta.bounds); }

// delete file
function deleteFile(id){
  if(!confirm('Hapus file?')) return;
  var meta = uploadedFiles[id]; if(!meta) return;
  meta.group.eachLayer(function(l){ map.removeLayer(l); editableLayers.removeLayer(l); });
  delete uploadedFiles[id];
  var node = document.getElementById('file-'+id); if(node) node.remove();
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
  uploadedFiles[id].name = val;
  var card = document.getElementById('file-'+id);
  var input = card.querySelector('input[type=text]');
  var title = document.createElement('div'); title.className='file-title'; title.innerText = val; title.onclick = function(){ openRename(id); };
  input.replaceWith(title);
  // update properties header if open
  if(lastSelectedId === id) el('#propName').value = val;
}
function cancelRename(id, old){ var card = document.getElementById('file-'+id); if(!card) return; var input = card.querySelector('input[type=text]'); var title = document.createElement('div'); title.className='file-title'; title.innerText = old; title.onclick = function(){ openRename(id); }; input.replaceWith(title); }

// --- Properties panel ---
function openProperties(id){
  var meta = uploadedFiles[id]; if(!meta) return;
  lastSelectedId = id;
  var panel = el('#propertiesPanel'); panel.classList.remove('hidden');
  el('#propName').value = meta.name;
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
}

function closeProperties(){ lastSelectedId = null; el('#propertiesPanel').classList.add('hidden'); }

// hook save name
el('#propSaveName').onclick = function(){
  if(!lastSelectedId) return;
  var v = el('#propName').value.trim() || uploadedFiles[lastSelectedId].name;
  uploadedFiles[lastSelectedId].name = v;
  // update UI title
  var card = document.getElementById('file-'+lastSelectedId);
  if(card) card.querySelector('.file-title').innerText = v;
  alert('Nama disimpan.');
};

// style controls live display
el('#styleStrokeWidth').oninput = function(){ el('#strokeWidthVal').innerText = this.value; };
el('#styleFillOpacity').oninput = function(){ el('#fillOpacityVal').innerText = this.value; };

// apply style to lastSelectedId
el('#applyStyle').onclick = function(){
  if(!lastSelectedId) return alert('Pilih layer dulu.');
  var meta = uploadedFiles[lastSelectedId];
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
  alert('Style diterapkan.');
};

// revert style to defaults
el('#revertStyle').onclick = function(){
  if(!lastSelectedId) return;
  var meta = uploadedFiles[lastSelectedId];
  meta.color = '#0077ff'; meta.weight = 3; meta.fillColor = meta.color; meta.fillOpacity = 0.4; meta.dashArray = null; meta.markerSymbol = 'circle';
  openProperties(lastSelectedId);
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

// --- Upload handler ---
el('#btnUpload').onclick = function(){
  var fi = el('#gpxFile'); if(!fi.files || fi.files.length===0) return alert('Pilih file GPX.');
  var file = fi.files[0];
  var reader = new FileReader();
  reader.onload = function(){
    var dom = new DOMParser().parseFromString(reader.result,'text/xml');
    var geojson = toGeoJSON.gpx(dom);
    var id = Date.now() + '-' + Math.floor(Math.random()*1000);
    var metaDefaults = { color:'#0077ff', weight:3, fillColor:'#0077ff', fillOpacity:0.4, dashArray:null, markerSymbol:'circle' };
    var created = createGroupFromGeoJSON(geojson, metaDefaults);
    var group = created.group;
    var bounds = group.getBounds();

    // save meta
    uploadedFiles[id] = { name: file.name, group: group, bounds: bounds, color: metaDefaults.color, weight: metaDefaults.weight, fillColor: metaDefaults.fillColor, fillOpacity: metaDefaults.fillOpacity, dashArray: metaDefaults.dashArray, markerSymbol: metaDefaults.markerSymbol };
    // add to map & editableLayers
    group.eachLayer(function(l){ map.addLayer(l); editableLayers.addLayer(l); });
    // create UI card
    addFileCard(id, { name: file.name, summary: (bounds && bounds.isValid ? 'Bounds available' : 'No bounds') });
    // fit
    if(bounds && bounds.isValid()) map.fitBounds(bounds);
    // reset input
    fi.value = '';
  };
  reader.readAsText(file);
};

// close properties if click outside
map.on('click', function(){ /* keep panel open to edit; optionally close */ });

// Optional: keyboard Esc closes props
document.addEventListener('keydown', function(e){ if(e.key === 'Escape'){ closeProperties(); } });

// End of app.js
