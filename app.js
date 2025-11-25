// app.js (FULL PATCHED)

// --- Initialization ---
// Force canvas renderer at map level and enable CORS on tile layer
var map = L.map('map', { preferCanvas: true }).setView([0.5, 101.4], 12);
L.tileLayer('https://cartodb-basemaps-{s}.global.ssl.fastly.net/light_all/{z}/{x}/{y}.png', {
  maxZoom: 22,
  crossOrigin: 'anonymous'
}).addTo(map);

// Editable group for Leaflet.draw (will contain canvas-rendered layers)
var editableLayers = new L.FeatureGroup().addTo(map);

// --- HACK: prevent Leaflet.draw and edit handlers from creating DOM markers ---
// (these prototypes are overwritten to avoid insertion of L.Marker DOM icons,
//  which break leaflet-image)
if (L.Edit && L.Edit.SimpleShape) {
  L.Edit.SimpleShape.prototype._createMoveMarker = function () {};
  L.Edit.SimpleShape.prototype._createResizeMarker = function () {};
}
if (L.Edit && L.Edit.PolyVerticesEdit) {
  L.Edit.PolyVerticesEdit.prototype._initMarkers = function () {};
}

// Ensure GeoJSON uses canvas renderer by default (safe fallback)
if (L.GeoJSON) {
  L.GeoJSON.prototype.options = L.Util.extend({}, L.GeoJSON.prototype.options, {
    renderer: L.canvas({ padding: 0.5 })
  });
}

// Draw control: disable marker tool to avoid DOM markers
var drawControl = new L.Control.Draw({
  edit: { featureGroup: editableLayers },
  draw: {
    polygon: true,
    polyline: true,
    rectangle: true,
    marker: false,   // IMPORTANT: disable marker
    circle: false
  }
});
map.addControl(drawControl);

// Ensure layers created from draw use canvas renderer
map.on(L.Draw.Event.CREATED, function (e) {
  var layer = e.layer;
  // if layer is a path (polyline/polygon), set renderer to canvas
  if (layer.setStyle) {
    try {
      layer.options = layer.options || {};
      layer.options.renderer = L.canvas({ padding: 0.5 });
      layer.setStyle(layer.options);
    } catch (err) {
      // ignore
    }
  }
  editableLayers.addLayer(layer);
});

// --- State ---
var uploadedFiles = {}; // id -> { name, group:LayerGroup, bounds, color, weight, fillColor, fillOpacity, dashArray, markerSymbol }
var lastSelectedId = null;

// --- Helpers: create group from GeoJSON, adding each sublayer to a FeatureGroup ---
// Force creation of L.Polygon / L.Polyline / L.CircleMarker with renderer: L.canvas()
function createGroupFromGeoJSON(geojson, styleMeta) {
  styleMeta = styleMeta || {};
  var group = L.featureGroup();

  function getStyle() {
    return {
      color: styleMeta.color || '#0077ff',
      weight: styleMeta.weight || 3,
      dashArray: styleMeta.dashArray || null,
      fillColor: styleMeta.fillColor || (styleMeta.color || '#0077ff'),
      fillOpacity: (typeof styleMeta.fillOpacity !== 'undefined') ? styleMeta.fillOpacity : 0.4,
      renderer: L.canvas({ padding: 0.5 })
    };
  }

  if (!geojson || !geojson.features) return group;

  geojson.features.forEach(function (f) {
    if (!f.geometry) return;
    var geom = f.geometry;
    var props = f.properties || {};

    if (geom.type === 'Point') {
      var c = geom.coordinates;
      var latlng = L.latLng(c[1], c[0]);
      var cm = L.circleMarker(latlng, L.Util.extend({
        radius: 6,
        renderer: L.canvas({ padding: 0.5 })
      }, getStyle()));
      cm.feature = f;
      group.addLayer(cm);

    } else if (geom.type === 'MultiPoint') {
      geom.coordinates.forEach(function (c) {
        var latlng = L.latLng(c[1], c[0]);
        var cm = L.circleMarker(latlng, L.Util.extend({ radius: 5, renderer: L.canvas({ padding: 0.5 }) }, getStyle()));
        cm.feature = f;
        group.addLayer(cm);
      });

    } else if (geom.type === 'LineString') {
      var latlngs = geom.coordinates.map(function (c) { return [c[1], c[0]]; });
      var pl = L.polyline(latlngs, getStyle());
      pl.feature = f;
      group.addLayer(pl);

    } else if (geom.type === 'MultiLineString') {
      geom.coordinates.forEach(function (line) {
        var latlngs = line.map(function (c) { return [c[1], c[0]]; });
        var pl = L.polyline(latlngs, getStyle());
        pl.feature = f;
        group.addLayer(pl);
      });

    } else if (geom.type === 'Polygon') {
      var rings = geom.coordinates.map(function (ring) {
        return ring.map(function (c) { return [c[1], c[0]]; });
      });
      var poly = L.polygon(rings, getStyle());
      poly.feature = f;
      group.addLayer(poly);

    } else if (geom.type === 'MultiPolygon') {
      geom.coordinates.forEach(function (polycoords) {
        var rings = polycoords.map(function (ring) {
          return ring.map(function (c) { return [c[1], c[0]]; });
        });
        var poly = L.polygon(rings, getStyle());
        poly.feature = f;
        group.addLayer(poly);
      });

    } else {
      // fallback
      var layer = L.geoJSON(f, {
        style: getStyle(),
        pointToLayer: function (feat, latlng) {
          return L.circleMarker(latlng, L.Util.extend({ radius: 5 }, getStyle()));
        }
      });
      layer.eachLayer(function (l) { group.addLayer(l); });
    }
  });

  return group;
}

// --- Utility: simple GPX exporter for GeoJSON (points as wpt, lines/polygons as trk) ---
function geojsonToGpx(geojson, name) {
  var esc = function (s) { return ('' + s).replace(/&/g, '&amp;').replace(/</g, '&lt;'); };
  var xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
  xml += '<gpx version="1.1" creator="MiniArcGIS">\n';
  xml += '<name>' + esc(name || 'export') + '</name>\n';

  geojson.features.forEach(function (f) {
    var geom = f.geometry;
    if (!geom) return;
    if (geom.type === 'Point') {
      var c = geom.coordinates;
      xml += '<wpt lat="' + c[1] + '" lon="' + c[0] + '"><name>' + (esc(f.properties && f.properties.name || 'pt')) + '</name></wpt>\n';
    } else if (geom.type === 'LineString') {
      xml += '<trk><name>' + (esc(f.properties && f.properties.name || 'line')) + '</name><trkseg>\n';
      geom.coordinates.forEach(function (c) { xml += '<trkpt lat="' + c[1] + '" lon="' + c[0] + '"></trkpt>\n'; });
      xml += '</trkseg></trk>\n';
    } else if (geom.type === 'Polygon') {
      var ring = geom.coordinates[0];
      xml += '<trk><name>' + (esc(f.properties && f.properties.name || 'poly')) + '</name><trkseg>\n';
      ring.forEach(function (c) { xml += '<trkpt lat="' + c[1] + '" lon="' + c[0] + '"></trkpt>\n'; });
      xml += '</trkseg></trk>\n';
    } else if (geom.type === 'MultiLineString') {
      geom.coordinates.forEach(function (line) {
        xml += '<trk><trkseg>\n';
        line.forEach(function (c) { xml += '<trkpt lat="' + c[1] + '" lon="' + c[0] + '"></trkpt>\n'; });
        xml += '</trkseg></trk>\n';
      });
    }
  });

  xml += '</gpx>';
  return xml;
}

// --- UI helpers ---
function el(q) { return document.querySelector(q); }
function elAll(q) { return Array.from(document.querySelectorAll(q)); }

// Build file card in sidebar
function addFileCard(id, meta) {
  var ul = el('#fileList');
  var li = document.createElement('li'); li.className = 'file-card'; li.id = 'file-' + id;

  var header = document.createElement('div'); header.className = 'file-header';
  var chk = document.createElement('input'); chk.type = 'checkbox'; chk.checked = true;
  chk.onchange = function () { toggleFile(id, chk.checked); };
  var title = document.createElement('div'); title.className = 'file-title'; title.innerText = meta.name;
  title.onclick = function () { openRename(id); };

  var actions = document.createElement('div'); actions.className = 'file-actions';
  var btnZoom = document.createElement('button'); btnZoom.className = 'btn-small'; btnZoom.innerText = 'Zoom'; btnZoom.onclick = function (e) { e.stopPropagation(); zoomFile(id); };
  var btnStyle = document.createElement('button'); btnStyle.className = 'btn-small'; btnStyle.innerText = 'Style'; btnStyle.onclick = function (e) { e.stopPropagation(); openProperties(id); };
  var btnExport = document.createElement('button'); btnExport.className = 'btn-small'; btnExport.innerText = 'Export'; btnExport.onclick = function (e) { e.stopPropagation(); exportAllFor(id); };
  var btnDel = document.createElement('button'); btnDel.className = 'btn-small'; btnDel.innerText = 'Delete'; btnDel.onclick = function (e) { e.stopPropagation(); deleteFile(id); };

  actions.appendChild(btnZoom); actions.appendChild(btnStyle); actions.appendChild(btnExport); actions.appendChild(btnDel);
  header.appendChild(chk); header.appendChild(title); header.appendChild(actions);
  li.appendChild(header);

  var folder = document.createElement('div'); folder.className = 'folder-contents';
  var info = document.createElement('div'); info.className = 'muted';
  info.innerText = meta.summary || '';
  folder.appendChild(info);
  li.appendChild(folder);

  ul.appendChild(li);
}

function toggleFile(id, show) {
  var meta = uploadedFiles[id]; if (!meta) return;
  meta.group.eachLayer(function (layer) {
    if (show) { map.addLayer(layer); editableLayers.addLayer(layer); }
    else { map.removeLayer(layer); editableLayers.removeLayer(layer); }
  });
}

function zoomFile(id) { var meta = uploadedFiles[id]; if (!meta) return; if (meta.bounds && meta.bounds.isValid()) map.fitBounds(meta.bounds); }

function deleteFile(id) {
  if (!confirm('Hapus file?')) return;
  var meta = uploadedFiles[id]; if (!meta) return;
  meta.group.eachLayer(function (l) { map.removeLayer(l); editableLayers.removeLayer(l); });
  delete uploadedFiles[id];
  var node = document.getElementById('file-' + id); if (node) node.remove();
  if (lastSelectedId === id) closeProperties();
}

function openRename(id) {
  var card = document.getElementById('file-' + id);
  if (!card) return;
  var title = card.querySelector('.file-title');
  var old = title.innerText;
  var input = document.createElement('input'); input.type = 'text'; input.value = old; input.style.flex = '1';
  title.replaceWith(input);
  input.focus();
  input.onkeydown = function (e) {
    if (e.key === 'Enter') { finishRename(id, input.value); }
    if (e.key === 'Escape') { cancelRename(id, old); }
  };
  input.onblur = function () { finishRename(id, input.value); };
}
function finishRename(id, val) {
  val = (val || '').trim() || uploadedFiles[id].name;
  uploadedFiles[id].name = val;
  var card = document.getElementById('file-' + id);
  var input = card.querySelector('input[type=text]');
  var title = document.createElement('div'); title.className = 'file-title'; title.innerText = val; title.onclick = function () { openRename(id); };
  input.replaceWith(title);
  if (lastSelectedId === id) el('#propName').value = val;
}
function cancelRename(id, old) { var card = document.getElementById('file-' + id); if (!card) return; var input = card.querySelector('input[type=text]'); var title = document.createElement('div'); title.className = 'file-title'; title.innerText = old; title.onclick = function () { openRename(id); }; input.replaceWith(title); }

function openProperties(id) {
  var meta = uploadedFiles[id]; if (!meta) return;
  lastSelectedId = id;
  var panel = el('#propertiesPanel'); panel.classList.remove('hidden');
  el('#propName').value = meta.name;
  var gj = meta.group.toGeoJSON();
  var cnt = gj.features.length;
  var len = 0, area = 0;
  gj.features.forEach(function (f) {
    if (f.geometry && (f.geometry.type === 'LineString' || f.geometry.type === 'MultiLineString')) len += turf.length(f, { units: 'meters' }) * 1000;
    if (f.geometry && (f.geometry.type === 'Polygon' || f.geometry.type === 'MultiPolygon')) area += turf.area(f);
  });
  el('#propStats').innerText = 'Features: ' + cnt + '  •  Length ≈ ' + Math.round(len) + ' m  •  Area ≈ ' + Math.round(area) + ' m²';

  el('#styleStrokeColor').value = meta.color || '#0077ff';
  el('#styleStrokeWidth').value = meta.weight || 3;
  el('#strokeWidthVal').innerText = meta.weight || 3;
  el('#styleFillColor').value = meta.fillColor || (meta.color || '#0077ff');
  el('#styleFillOpacity').value = (typeof meta.fillOpacity !== 'undefined') ? meta.fillOpacity : 0.4;
  el('#fillOpacityVal').innerText = el('#styleFillOpacity').value;
  el('#styleDash').value = meta.dashArray || '';
  el('#styleMarker').value = meta.markerSymbol || 'circle';
}

function closeProperties() { lastSelectedId = null; el('#propertiesPanel').classList.add('hidden'); }

el('#propSaveName').onclick = function () {
  if (!lastSelectedId) return;
  var v = el('#propName').value.trim() || uploadedFiles[lastSelectedId].name;
  uploadedFiles[lastSelectedId].name = v;
  var card = document.getElementById('file-' + lastSelectedId);
  if (card) card.querySelector('.file-title').innerText = v;
  alert('Nama disimpan.');
};

el('#styleStrokeWidth').oninput = function () { el('#strokeWidthVal').innerText = this.value; };
el('#styleFillOpacity').oninput = function () { el('#fillOpacityVal').innerText = this.value; };

el('#applyStyle').onclick = function () {
  if (!lastSelectedId) return alert('Pilih layer dulu.');
  var meta = uploadedFiles[lastSelectedId];
  meta.color = el('#styleStrokeColor').value;
  meta.weight = parseInt(el('#styleStrokeWidth').value);
  meta.fillColor = el('#styleFillColor').value;
  meta.fillOpacity = parseFloat(el('#styleFillOpacity').value);
  meta.dashArray = el('#styleDash').value || null;
  meta.markerSymbol = el('#styleMarker').value || 'circle';

  meta.group.eachLayer(function (layer) {
    if (layer.setStyle) {
      layer.setStyle({
        color: meta.color,
        weight: meta.weight,
        dashArray: meta.dashArray,
        fillColor: meta.fillColor,
        fillOpacity: meta.fillOpacity
      });
    }
    if (layer.setRadius) {
      layer.setStyle({ color: meta.color, fillColor: meta.fillColor });
    }
  });
  alert('Style diterapkan.');
};

el('#revertStyle').onclick = function () {
  if (!lastSelectedId) return;
  var meta = uploadedFiles[lastSelectedId];
  meta.color = '#0077ff'; meta.weight = 3; meta.fillColor = meta.color; meta.fillOpacity = 0.4; meta.dashArray = null; meta.markerSymbol = 'circle';
  openProperties(lastSelectedId);
  el('#applyStyle').click();
};

el('#exportGeojson').onclick = function () { if (!lastSelectedId) return; var meta = uploadedFiles[lastSelectedId]; var gj = meta.group.toGeoJSON(); var blob = new Blob([JSON.stringify(gj, null, 2)], { type: 'application/json' }); saveAs(blob, (meta.name || 'layer') + '.geojson'); };
el('#exportGpx').onclick = function () { if (!lastSelectedId) return; var meta = uploadedFiles[lastSelectedId]; var gj = meta.group.toGeoJSON(); var gpx = geojsonToGpx(gj, meta.name); saveAs(new Blob([gpx], { type: 'application/gpx+xml' }), (meta.name || 'layer') + '.gpx'); };
el('#exportKml').onclick = function () { if (!lastSelectedId) return; var meta = uploadedFiles[lastSelectedId]; var gj = meta.group.toGeoJSON(); var kml = tokml(gj); saveAs(new Blob([kml], { type: 'application/vnd.google-earth.kml+xml' }), (meta.name || 'layer') + '.kml'); };
el('#deleteLayer').onclick = function () { if (!lastSelectedId) return deleteFile(lastSelectedId); };

function exportAllFor(id) { openProperties(id); }

// --- Upload handler ---
el('#btnUpload').onclick = function () {
  var fi = el('#gpxFile');
  if (!fi.files || fi.files.length === 0) return alert('Pilih file GPX.');

  var file = fi.files[0];
  var reader = new FileReader();

  reader.onload = function () {
    var dom = new DOMParser().parseFromString(reader.result, 'text/xml');
    var geojson = toGeoJSON.gpx(dom);

    // convert lines to polygons automatically if needed
    geojson = convertLineToPolygonGeoJSON(geojson);

    var id = Date.now() + '-' + Math.floor(Math.random() * 1000);

    var metaDefaults = {
      color: '#0077ff',
      weight: 3,
      fillColor: '#0077ff',
      fillOpacity: 0.4,
      dashArray: null,
      markerSymbol: 'circle'
    };

    var group = createGroupFromGeoJSON(geojson, metaDefaults);
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
      markerSymbol: metaDefaults.markerSymbol
    };

    // add each sublayer to map and editableLayers
    group.eachLayer(function (l) {
      map.addLayer(l);
      editableLayers.addLayer(l);
    });

    addFileCard(id, {
      name: file.name,
      summary: (bounds && bounds.isValid ? "Bounds available" : "No bounds")
    });

    if (bounds && bounds.isValid()) map.fitBounds(bounds);

    fi.value = '';
  };

  reader.readAsText(file);
};

map.on('click', function () { /* keep panel open to edit; optionally close */ });
document.addEventListener('keydown', function (e) { if (e.key === 'Escape') { closeProperties(); } });

function convertLineToPolygonGeoJSON(gj) {
  if (!gj || !gj.features) return gj;
  var newFeatures = [];
  gj.features.forEach(function (f) {
    if (!f.geometry) return;
    if (f.geometry.type === "LineString") {
      var coords = f.geometry.coordinates;
      if (coords.length >= 3) {
        var ring = coords.slice();
        var first = ring[0];
        var last = ring[ring.length - 1];
        if (first[0] !== last[0] || first[1] !== last[1]) ring.push(first);
        newFeatures.push({ type: "Feature", properties: f.properties || {}, geometry: { type: "Polygon", coordinates: [ring] } });
      } else {
        newFeatures.push(f);
      }
    } else {
      newFeatures.push(f);
    }
  });
  return { type: "FeatureCollection", features: newFeatures };
}

// === Print to A3 PDF (A3-L1 layout) ===
// Path uploaded template (server-side path)
const templatePdfUrl = '/mnt/data/SAIL A2 W (1).pdf'; // use uploaded file

function fmtArea(m2) { if (m2 >= 10000) return (m2 / 10000).toFixed(2) + ' Ha'; return Math.round(m2) + ' m²'; }
function metersPerPixelAtLat(lat, zoom) { return 156543.03392 * Math.cos(lat * Math.PI / 180) / Math.pow(2, zoom); }
function buildLegendEntries() {
  var items = [];
  for (var id in uploadedFiles) {
    if (!uploadedFiles.hasOwnProperty(id)) continue;
    var m = uploadedFiles[id];
    items.push({ name: m.name || ('layer-' + id), color: m.color || '#0077ff' });
  }
  return items;
}

async function exportMapToA3PDF() {
  const pdfWidthMM = 420, pdfHeightMM = 297, marginMM = 12;
  const mapAreaMM = { x: marginMM, y: marginMM + 8, w: 280, h: pdfHeightMM - marginMM * 2 - 16 };
  const { jsPDF } = window.jspdf;
  const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a3' });

  // BEFORE rendering: temporarily hide panes that contain DOM icons
  var panes = map.getPanes();
  var markerPane = panes.markerPane;
  var shadowPane = panes.shadowPane;
  var overlayPane = panes.overlayPane;
  var origMarkerDisp, origShadowDisp, origOverlayDisp;
  if (markerPane) { origMarkerDisp = markerPane.style.display; markerPane.style.display = 'none'; }
  if (shadowPane) { origShadowDisp = shadowPane.style.display; shadowPane.style.display = 'none'; }
  // also hide any overlay nodes that might contain HTML icons
  if (overlayPane) { origOverlayDisp = overlayPane.style.display; overlayPane.style.display = 'none'; }

  // generate canvas via leaflet-image
  leafletImage(map, function (err, canvas) {
    // restore panes immediately
    if (markerPane) markerPane.style.display = origMarkerDisp || '';
    if (shadowPane) shadowPane.style.display = origShadowDisp || '';
    if (overlayPane) overlayPane.style.display = origOverlayDisp || '';

    if (err || !canvas) {
      alert('Gagal mengambil gambar peta: ' + (err || 'unknown error'));
      return;
    }

    // upscale output canvas for quality
    var scaleFactor = 2;
    var w = canvas.width, h = canvas.height;
    var tmp = document.createElement('canvas');
    tmp.width = w * scaleFactor;
    tmp.height = h * scaleFactor;
    var tctx = tmp.getContext('2d');
    tctx.imageSmoothingEnabled = false;
    tctx.scale(scaleFactor, scaleFactor);
    tctx.drawImage(canvas, 0, 0);

    var imgData = tmp.toDataURL('image/png');

    // compute draw size in PDF mm
    var imgAspect = tmp.width / tmp.height;
    var mapWmm = mapAreaMM.w;
    var mapHmm = mapWmm / imgAspect;
    var drawW = mapWmm, drawH = mapHmm;
    if (drawH > mapAreaMM.h) { drawH = mapAreaMM.h; drawW = drawH * imgAspect; }

    // add map image
    pdf.addImage(imgData, 'PNG', mapAreaMM.x, mapAreaMM.y, drawW, drawH);

    // border
    pdf.setDrawColor(0); pdf.setLineWidth(0.8);
    pdf.rect(mapAreaMM.x - 1, mapAreaMM.y - 1, drawW + 2, drawH + 2);

    // title
    pdf.setFontSize(22); pdf.setFont('helvetica', 'bold');
    pdf.text('Peta Baku Lahan', pdfWidthMM - marginMM, marginMM + 6, { align: 'right' });

    // legend
    var legendX = mapAreaMM.x + drawW + 8; var legendY = mapAreaMM.y;
    pdf.setFontSize(12); pdf.setFont('helvetica', 'normal');
    pdf.text('Legenda:', legendX, legendY); legendY += 6;
    var legend = buildLegendEntries();
    legend.forEach(function (item) {
      var boxSize = 6;
      pdf.setFillColor(item.color); pdf.rect(legendX, legendY - 4, boxSize, boxSize, 'F');
      pdf.setDrawColor(0); pdf.rect(legendX, legendY - 4, boxSize, boxSize);
      pdf.setTextColor(0); pdf.text(item.name, legendX + boxSize + 4, legendY + 1);
      legendY += 8;
    });
    legendY += 8;

    // scale bar estimation
    var center = map.getCenter(); var zoom = map.getZoom();
    var mPerPx = metersPerPixelAtLat(center.lat, zoom);
    var targetMm = 40;
    var metersOnImage = tmp.width * mPerPx;
    var metersPerMmOnImage = metersOnImage / drawW;
    var scaleMeters = Math.round(metersPerMmOnImage * targetMm / 10) * 10;
    var scaleX = mapAreaMM.x + 12, scaleY = mapAreaMM.y + drawH - 12;
    pdf.setFontSize(10);
    var scaleApprox = Math.round(metersPerMmOnImage);
    pdf.text('Scale ≈ 1:' + scaleApprox, scaleX, scaleY - 6);
    pdf.setFillColor(0); pdf.rect(scaleX, scaleY, targetMm, 3, 'F');
    pdf.setFontSize(9); pdf.text(scaleMeters + ' m', scaleX + targetMm + 4, scaleY + 3);

    // north arrow (simple)
    var naX = mapAreaMM.x + drawW - 18, naY = mapAreaMM.y + 8;
    pdf.setDrawColor(0); pdf.setFillColor(0);
    // draw small triangle (approx)
    pdf.lines([[[8, 12], [0, 0], [16, 0]]], naX - 8, naY, null, 'F');
    pdf.setFontSize(10); pdf.text('N', naX + 8, naY + 18, { align: 'center' });

    // coordinates (WGS84) corners
    var b = map.getBounds();
    pdf.setFontSize(9);
    pdf.text('NW: ' + b.getNorth().toFixed(6) + ', ' + b.getWest().toFixed(6), mapAreaMM.x, mapAreaMM.y - 2);
    pdf.text('NE: ' + b.getNorth().toFixed(6) + ', ' + b.getEast().toFixed(6), mapAreaMM.x + drawW, mapAreaMM.y - 2, { align: 'right' });
    pdf.text('SW: ' + b.getSouth().toFixed(6) + ', ' + b.getWest().toFixed(6), mapAreaMM.x, mapAreaMM.y + drawH + 8);
    pdf.text('SE: ' + b.getSouth().toFixed(6) + ', ' + b.getEast().toFixed(6), mapAreaMM.x + drawW, mapAreaMM.y + drawH + 8, { align: 'right' });

    // footer
    pdf.setFontSize(9);
    var now = new Date();
    pdf.text('Dicetak: ' + now.toLocaleString(), marginMM, pdfHeightMM - marginMM + 2);
    pdf.text('Template: ' + templatePdfUrl, pdfWidthMM - marginMM, pdfHeightMM - marginMM + 2, { align: 'right' });

    // save
    pdf.save('peta_baku_lahan_A3.pdf');
  });
}

document.getElementById('btnPrintA3').addEventListener('click', function () {
  exportMapToA3PDF();
});

// End of app.js
