// app.js (patched) -- Canvas renderer penuh

// --- Initialization ---
// Force canvas renderer at map level
var map = L.map('map', { preferCanvas: true }).setView([0.5, 101.4], 12);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 22 }).addTo(map);

// Editable group for Leaflet.draw (will contain canvas-rendered layers)
var editableLayers = new L.FeatureGroup().addTo(map);

// Ensure GeoJSON uses canvas renderer by default (safe fallback)
L.GeoJSON.prototype.options = L.Util.extend({}, L.GeoJSON.prototype.options, {
  renderer: L.canvas({ padding: 0.5 })
});

// Draw control (works with canvas renderer)
var drawControl = new L.Control.Draw({
  edit: { featureGroup: editableLayers },
  draw: { polygon: true, polyline: true, rectangle: true, marker: true, circle: false }
});
map.addControl(drawControl);
map.on(L.Draw.Event.CREATED, function (e) {
  var layer = e.layer;
  // ensure layer uses canvas renderer when it's a path
  if (layer.setStyle) {
    layer.setStyle(layer.options || {});
  }
  editableLayers.addLayer(layer);
});

// --- State ---
var uploadedFiles = {}; // id -> { name, group:LayerGroup, bounds, color, weight, fillColor, fillOpacity, dashArray, markerSymbol }
var lastSelectedId = null;

// --- Helpers: create group from GeoJSON, adding each sublayer to a FeatureGroup ---
// This will create explicit L.Polygon / L.Polyline / L.CircleMarker with renderer: L.canvas()
function createGroupFromGeoJSON(geojson, styleMeta) {
  styleMeta = styleMeta || {};
  var group = L.featureGroup();

  // helper to create style object
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
        radius: 5,
        renderer: L.canvas({ padding: 0.5 })
      }, getStyle()));
      cm.feature = f;
      group.addLayer(cm);

    } else if (geom.type === 'MultiPoint') {
      geom.coordinates.forEach(function (c) {
        var latlng = L.latLng(c[1], c[0]);
        var cm = L.circleMarker(latlng, L.Util.extend({
          radius: 5,
          renderer: L.canvas({ padding: 0.5 })
        }, getStyle()));
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
      // coords: [ [ [lng,lat], ... ] , ... ]
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
      // fallback: try to add as generic geoJSON layer (renderer enforced)
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

  // header row
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

  // folder contents (infos)
  var folder = document.createElement('div'); folder.className = 'folder-contents';
  var info = document.createElement('div'); info.className = 'muted';
  info.innerText = meta.summary || '';
  folder.appendChild(info);
  li.appendChild(folder);

  ul.appendChild(li);
}

// Toggle display/hide file
function toggleFile(id, show) {
  var meta = uploadedFiles[id]; if (!meta) return;
  meta.group.eachLayer(function (layer) {
    if (show) { map.addLayer(layer); editableLayers.addLayer(layer); }
    else { map.removeLayer(layer); editableLayers.removeLayer(layer); }
  });
}

// Zoom to file
function zoomFile(id) { var meta = uploadedFiles[id]; if (!meta) return; if (meta.bounds && meta.bounds.isValid()) map.fitBounds(meta.bounds); }

// delete file
function deleteFile(id) {
  if (!confirm('Hapus file?')) return;
  var meta = uploadedFiles[id]; if (!meta) return;
  meta.group.eachLayer(function (l) { map.removeLayer(l); editableLayers.removeLayer(l); });
  delete uploadedFiles[id];
  var node = document.getElementById('file-' + id); if (node) node.remove();
  if (lastSelectedId === id) closeProperties();
}

// open rename inline
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

// --- Properties panel ---
function openProperties(id) {
  var meta = uploadedFiles[id]; if (!meta) return;
  lastSelectedId = id;
  var panel = el('#propertiesPanel'); panel.classList.remove('hidden');
  el('#propName').value = meta.name;
  // stats: counts, length, area
  var gj = meta.group.toGeoJSON();
  var cnt = gj.features.length;
  var len = 0, area = 0;
  gj.features.forEach(function (f) {
    if (f.geometry && (f.geometry.type === 'LineString' || f.geometry.type === 'MultiLineString')) len += turf.length(f, { units: 'meters' }) * 1000;
    if (f.geometry && (f.geometry.type === 'Polygon' || f.geometry.type === 'MultiPolygon')) area += turf.area(f);
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

function closeProperties() { lastSelectedId = null; el('#propertiesPanel').classList.add('hidden'); }

// hook save name
el('#propSaveName').onclick = function () {
  if (!lastSelectedId) return;
  var v = el('#propName').value.trim() || uploadedFiles[lastSelectedId].name;
  uploadedFiles[lastSelectedId].name = v;
  var card = document.getElementById('file-' + lastSelectedId);
  if (card) card.querySelector('.file-title').innerText = v;
  alert('Nama disimpan.');
};

// style controls live display
el('#styleStrokeWidth').oninput = function () { el('#strokeWidthVal').innerText = this.value; };
el('#styleFillOpacity').oninput = function () { el('#fillOpacityVal').innerText = this.value; };

// apply style to lastSelectedId
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

// revert style to defaults
el('#revertStyle').onclick = function () {
  if (!lastSelectedId) return;
  var meta = uploadedFiles[lastSelectedId];
  meta.color = '#0077ff'; meta.weight = 3; meta.fillColor = meta.color; meta.fillOpacity = 0.4; meta.dashArray = null; meta.markerSymbol = 'circle';
  openProperties(lastSelectedId);
  el('#applyStyle').click();
};

// Export buttons
el('#exportGeojson').onclick = function () { if (!lastSelectedId) return; var meta = uploadedFiles[lastSelectedId]; var gj = meta.group.toGeoJSON(); var blob = new Blob([JSON.stringify(gj, null, 2)], { type: 'application/json' }); saveAs(blob, (meta.name || 'layer') + '.geojson'); };
el('#exportGpx').onclick = function () { if (!lastSelectedId) return; var meta = uploadedFiles[lastSelectedId]; var gj = meta.group.toGeoJSON(); var gpx = geojsonToGpx(gj, meta.name); saveAs(new Blob([gpx], { type: 'application/gpx+xml' }), (meta.name || 'layer') + '.gpx'); };
el('#exportKml').onclick = function () { if (!lastSelectedId) return; var meta = uploadedFiles[lastSelectedId]; var gj = meta.group.toGeoJSON(); var kml = tokml(gj); saveAs(new Blob([kml], { type: 'application/vnd.google-earth.kml+xml' }), (meta.name || 'layer') + '.kml'); };
el('#deleteLayer').onclick = function () { if (!lastSelectedId) return deleteFile(lastSelectedId); };

function exportAllFor(id) {
  openProperties(id);
  // user can click desired export button
}

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

// close properties if click outside
map.on('click', function () { /* keep panel open to edit; optionally close */ });

// Optional: keyboard Esc closes props
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
        // ensure closed ring: if first != last push
        var first = ring[0];
        var last = ring[ring.length - 1];
        if (first[0] !== last[0] || first[1] !== last[1]) ring.push(first);
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

// === Print to A3 PDF (A3-L1 layout) ===

// Path file uploaded (developer: gunakan path ini di server/tool wrapper)
const templatePdfUrl = '/mnt/data/SAIL A2 W (1).pdf'; // <-- path upload Anda

// Helper: format meter to human (m/Ha)
function fmtArea(m2) {
  if (m2 >= 10000) return (m2 / 10000).toFixed(2) + ' Ha';
  return Math.round(m2) + ' m²';
}

// Hitung approximate meters-per-pixel di lat & zoom (WebMercator approximation)
function metersPerPixelAtLat(lat, zoom) {
  return 156543.03392 * Math.cos(lat * Math.PI / 180) / Math.pow(2, zoom);
}

// Buat legend entries dari uploadedFiles (yang ada di memory)
function buildLegendEntries() {
  var items = [];
  for (var id in uploadedFiles) {
    if (!uploadedFiles.hasOwnProperty(id)) continue;
    var m = uploadedFiles[id];
    items.push({
      name: m.name || ('layer-' + id),
      color: m.color || '#0077ff'
    });
  }
  return items;
}

// Fungsi utama export
async function exportMapToA3PDF() {
  // ukuran A3 dalam mm (landscape)
  const pdfWidthMM = 420;
  const pdfHeightMM = 297;
  const marginMM = 12;

  // PILIH area peta dalam PDF: lebar 280mm, sisanya untuk legenda & teks (kanan)
  const mapAreaMM = { x: marginMM, y: marginMM + 8, w: 280, h: pdfHeightMM - marginMM * 2 - 16 };

  // inisialisasi jsPDF
  const { jsPDF } = window.jspdf;
  const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a3' });

  // --- 1) ambil canvas peta menggunakan leaflet-image ---
  const scaleFactor = 2;

  leafletImage(map, function (err, canvas) {
    if (err) {
      alert('Gagal mengambil gambar peta: ' + err);
      return;
    }

    // upscale to improve resolution
    const w = canvas.width;
    const h = canvas.height;
    const tmp = document.createElement('canvas');
    tmp.width = w * scaleFactor;
    tmp.height = h * scaleFactor;
    var tctx = tmp.getContext('2d');
    // use imageSmoothingEnabled false for crisp tiles
    tctx.imageSmoothingEnabled = false;
    tctx.scale(scaleFactor, scaleFactor);
    tctx.drawImage(canvas, 0, 0);

    const imgData = tmp.toDataURL('image/png');

    // dimension calculations
    const imgAspect = tmp.width / tmp.height;
    const mapWmm = mapAreaMM.w;
    const mapHmm = mapWmm / imgAspect;

    let drawW = mapWmm;
    let drawH = mapHmm;
    if (drawH > mapAreaMM.h) {
      drawH = mapAreaMM.h;
      drawW = drawH * imgAspect;
    }

    // add map image
    pdf.addImage(imgData, 'PNG', mapAreaMM.x, mapAreaMM.y, drawW, drawH);

    // border
    pdf.setDrawColor(0);
    pdf.setLineWidth(0.8);
    pdf.rect(mapAreaMM.x - 1, mapAreaMM.y - 1, drawW + 2, drawH + 2);

    // title
    pdf.setFontSize(22);
    pdf.setFont('helvetica', 'bold');
    const title = 'Peta Baku Lahan';
    pdf.text(title, pdfWidthMM - marginMM, marginMM + 6, { align: 'right' });

    // legend
    const legendX = mapAreaMM.x + drawW + 8;
    let legendY = mapAreaMM.y;
    pdf.setFontSize(12);
    pdf.setFont('helvetica', 'normal');
    pdf.text('Legenda:', legendX, legendY);
    legendY += 6;

    const legend = buildLegendEntries();
    legend.forEach(function (item, i) {
      const boxSize = 6;
      pdf.setFillColor(item.color);
      pdf.rect(legendX, legendY - 4, boxSize, boxSize, 'F');
      pdf.setDrawColor(0);
      pdf.rect(legendX, legendY - 4, boxSize, boxSize);
      pdf.setTextColor(0);
      pdf.text(item.name, legendX + boxSize + 4, legendY + 1);
      legendY += 8;
    });

    legendY += 8;

    // scale bar estimation
    const center = map.getCenter();
    const zoom = map.getZoom();
    const mPerPx = metersPerPixelAtLat(center.lat, zoom);

    const targetMm = 40;
    const metersOnImage = tmp.width * mPerPx;
    const metersPerMmOnImage = metersOnImage / drawW;
    const scaleMeters = Math.round(metersPerMmOnImage * targetMm / 10) * 10;

    const scaleX = mapAreaMM.x + 12;
    const scaleY = mapAreaMM.y + drawH - 12;
    pdf.setFontSize(10);
    const scaleApprox = Math.round(metersPerMmOnImage);
    pdf.text('Scale ≈ 1:' + scaleApprox, scaleX, scaleY - 6);
    pdf.setFillColor(0);
    pdf.rect(scaleX, scaleY, targetMm, 3, 'F');
    pdf.setFontSize(9);
    pdf.text(scaleMeters + ' m', scaleX + targetMm + 4, scaleY + 3);

    // north arrow
    const naX = mapAreaMM.x + drawW - 18;
    const naY = mapAreaMM.y + 8;
    pdf.setFillColor(0);
    // draw triangle manually (triangle API may not exist in some jspdf builds)
    // fallback to drawing polygon with lines:
    pdf.setDrawColor(0);
    pdf.setFillColor(0);
    pdf.lines([[[8, 12], [0, 0], [16, 0]]], naX - 8, naY, null, 'F'); // approximate triangle
    pdf.setFontSize(10);
    pdf.text('N', naX + 8, naY + 18, { align: 'center' });

    // coordinates
    const b = map.getBounds();
    pdf.setFontSize(9);
    pdf.text('NW: ' + b.getNorth().toFixed(6) + ', ' + b.getWest().toFixed(6), mapAreaMM.x, mapAreaMM.y - 2);
    pdf.text('NE: ' + b.getNorth().toFixed(6) + ', ' + b.getEast().toFixed(6), mapAreaMM.x + drawW, mapAreaMM.y - 2, { align: 'right' });
    pdf.text('SW: ' + b.getSouth().toFixed(6) + ', ' + b.getWest().toFixed(6), mapAreaMM.x, mapAreaMM.y + drawH + 8);
    pdf.text('SE: ' + b.getSouth().toFixed(6) + ', ' + b.getEast().toFixed(6), mapAreaMM.x + drawW, mapAreaMM.y + drawH + 8, { align: 'right' });

    // footer
    pdf.setFontSize(9);
    const now = new Date();
    pdf.text('Dicetak: ' + now.toLocaleString(), marginMM, pdfHeightMM - marginMM + 2);
    pdf.text('Template: ' + templatePdfUrl, pdfWidthMM - marginMM, pdfHeightMM - marginMM + 2, { align: 'right' });

    // save
    pdf.save('peta_baku_lahan_A3.pdf');
  });
}

// tombol pemicu
document.getElementById('btnPrintA3').addEventListener('click', function () {
  exportMapToA3PDF();
});

// End of app.js
