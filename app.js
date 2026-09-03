/*
 * William Wirt Voyage Archive
 *
 * This file is organized by responsibility:
 *   1. Configuration and application state
 *   2. CSV parsing and normalization
 *   3. Position reconstruction
 *   4. Main rendering
 *   5. Map rendering and controls
 *   6. Calendar and entry details
 *   7. User interactions and startup
 */

// -----------------------------------------------------------------------------
// 1. Configuration and application state
// -----------------------------------------------------------------------------

const CONFIG = {
  publishedCsvPath: "./data/logbook1.csv",
  publishedCsvFilename: "logbook1.csv",
  localStorageKey: "william-wirt-records-v4",
  tileSize: 256,
  minZoom: 1,
  maxZoom: 8,
};

const elements = {
  status: document.getElementById("status"),
  source: document.getElementById("source"),
  title: document.getElementById("title"),
  subtitle: document.getElementById("subtitle"),
  mapTab: document.getElementById("map-tab"),
  calendarTab: document.getElementById("calendar-tab"),
  legend: document.getElementById("legend"),
  view: document.getElementById("view"),
  recordStrip: document.getElementById("record-strip"),
  details: document.getElementById("details"),
  files: document.getElementById("files"),
  search: document.getElementById("search"),
  remove: document.getElementById("remove"),
};

const state = {
  datasets: [],
  activeDatasetId: "",
  selectedRecordIndex: 0,
  query: "",
  mode: "map",
  map: {
    longitude: -35,
    latitude: 22,
    zoom: 2,
  },
};

// -----------------------------------------------------------------------------
// 2. CSV parsing and normalization
// -----------------------------------------------------------------------------

/** Parse ordinary quoted CSV text without requiring an external library. */
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let insideQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    const nextCharacter = text[index + 1];

    if (character === '"' && insideQuotes && nextCharacter === '"') {
      field += '"';
      index += 1;
    } else if (character === '"') {
      insideQuotes = !insideQuotes;
    } else if (character === "," && !insideQuotes) {
      row.push(field);
      field = "";
    } else if ((character === "\n" || character === "\r") && !insideQuotes) {
      if (character === "\r" && nextCharacter === "\n") index += 1;
      row.push(field);
      if (row.some((value) => value.trim())) rows.push(row);
      row = [];
      field = "";
    } else {
      field += character;
    }
  }

  row.push(field);
  if (row.some((value) => value.trim())) rows.push(row);
  return rows;
}

function parseDate(value) {
  if (!value) return null;

  const withoutWeekday = value.replace(
    /^(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday),?\s*/i,
    "",
  );
  const date = new Date(`${withoutWeekday} 12:00:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function parseNumber(value) {
  const trimmed = String(value ?? "").trim();
  return trimmed && Number.isFinite(Number(trimmed)) ? Number(trimmed) : undefined;
}

function splitList(value) {
  return String(value ?? "")
    .split(";")
    .map((item) => item.trim())
    .filter(Boolean);
}

function escapeHtml(value) {
  const replacements = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  };

  return String(value ?? "").replace(
    /[&<>"']/g,
    (character) => replacements[character],
  );
}

/**
 * Convert a CSV into the site's internal record format.
 * Header aliases allow this page to accept slightly different CSV schemas.
 */
function createDataset(csvText, filename) {
  const rows = parseCsv(csvText);
  if (rows.length < 2) throw new Error(`${filename} has no data rows.`);

  const originalHeaders = rows[0];
  const headers = originalHeaders.map((header) => header.trim().toLowerCase());

  function getValue(row, ...possibleHeaders) {
    for (const header of possibleHeaders) {
      const columnIndex = headers.indexOf(header);
      if (columnIndex >= 0 && row[columnIndex]?.trim()) {
        return row[columnIndex].trim();
      }
    }
    return "";
  }

  const basename = filename.replace(/\.csv$/i, "");
  const firstDataRow = rows[1];
  const datasetName =
    getValue(firstDataRow, "dataset_name", "source_name", "logbook") ||
    basename.replace(/[-_]/g, " ");

  const records = rows
    .slice(1)
    .filter((row) => row.some((value) => value.trim()))
    .map((row, index) => {
      const latitude = parseNumber(getValue(row, "latitude", "lat"));
      const longitude = parseNumber(
        getValue(row, "longitude", "lon", "long"),
      );
      const date = getValue(row, "date", "entry_date") || `Record ${index + 1}`;
      const markerType = getValue(
        row,
        "marker_type",
        "location_type",
        "place_type",
      ).toLowerCase();
      const isPort = /^(port|harbor|harbour|anchorage|at port|in port)$/.test(
        markerType.trim(),
      );

      const entry =
        getValue(
          row,
          "entry",
          "transcription",
          "description",
          "text",
          "details",
          "account",
        ) ||
        headers
          .map((header, columnIndex) =>
            row[columnIndex]?.trim()
              ? `${originalHeaders[columnIndex]}: ${row[columnIndex].trim()}`
              : "",
          )
          .filter(Boolean)
          .join(" · ");

      return {
        id: `${basename}-${index}`,
        sourceIndex: index,
        day: Number(getValue(row, "day", "record_number", "number")) || index + 1,
        date,
        dateObject: parseDate(date),
        shortDate: getValue(row, "short_date") || date,

        // Historical coordinates remain untouched. Reconstructed map positions
        // are stored separately in displayLatitude/displayLongitude below.
        latitude,
        longitude,
        latitudeLabel:
          getValue(row, "latitude_label") || formatCoordinate(latitude, "latitude"),
        longitudeLabel:
          getValue(row, "longitude_label") ||
          formatCoordinate(longitude, "longitude"),

        place: isPort ? "port" : latitude === undefined ? "record" : "sea",
        placeName: getValue(row, "place", "place_name", "port", "location"),
        course: getValue(row, "course") || "Not recorded",
        ships: splitList(getValue(row, "ships", "ship_sightings")),
        nature: splitList(
          getValue(row, "animals_plants", "nature", "sightings"),
        ),
        note: getValue(row, "note", "notes", "comment", "interpretation"),
        entry,
      };
    });

  assignDisplayPositions(records);

  return {
    id: `${basename}-${Date.now()}`,
    name: datasetName,
    filename,
    kind: headers.includes("latitude") ? "logbook" : "account book",
    records,
  };
}

function formatCoordinate(value, type) {
  if (value === undefined) return type === "latitude" ? "No latitude" : "No longitude";

  const direction =
    type === "latitude" ? (value >= 0 ? "N" : "S") : value >= 0 ? "E" : "W";
  return `${Math.abs(value).toFixed(4)}° ${direction}`;
}

// -----------------------------------------------------------------------------
// 3. Position reconstruction
// -----------------------------------------------------------------------------

/**
 * Give every mappable record a display position without overwriting the
 * transcribed latitude and longitude.
 *
 * Rules:
 *   1. Recorded fixes are used exactly as transcribed.
 *   2. Coordinate-less records within a port visit inherit that port's fix.
 *   3. Other coordinate-less records are interpolated only when bracketed by
 *      recorded positions on both sides.
 */
function assignDisplayPositions(records) {
  for (const record of records) {
    if (hasRecordedPosition(record)) {
      setDisplayPosition(record, record.latitude, record.longitude, "recorded");
    }
  }

  assignPortVisitPositions(records);
  assignInterpolatedSeaPositions(records);
}

function hasRecordedPosition(record) {
  return record.latitude !== undefined && record.longitude !== undefined;
}

function hasDisplayPosition(record) {
  return (
    record.displayLatitude !== undefined && record.displayLongitude !== undefined
  );
}

function setDisplayPosition(record, latitude, longitude, method, note = "") {
  record.displayLatitude = latitude;
  record.displayLongitude = longitude;
  record.positionMethod = method;
  record.positionNote = note;
}

/** Fill missing positions inside each consecutive run of port records. */
function assignPortVisitPositions(records) {
  let runStart = 0;

  while (runStart < records.length) {
    if (records[runStart].place !== "port") {
      runStart += 1;
      continue;
    }

    let runEnd = runStart;
    while (runEnd + 1 < records.length && records[runEnd + 1].place === "port") {
      runEnd += 1;
    }

    const positionedPortRecord = records
      .slice(runStart, runEnd + 1)
      .find(hasRecordedPosition);

    if (positionedPortRecord) {
      for (let index = runStart; index <= runEnd; index += 1) {
        const record = records[index];
        if (!hasDisplayPosition(record)) {
          const portName = record.placeName || positionedPortRecord.placeName || "the port";
          setDisplayPosition(
            record,
            positionedPortRecord.latitude,
            positionedPortRecord.longitude,
            "port-inherited",
            `Mapped to ${portName} using a recorded position from this port visit.`,
          );
        }
      }
    }

    runStart = runEnd + 1;
  }
}

/** Interpolate coordinate-less sea days between the nearest known fixes. */
function assignInterpolatedSeaPositions(records) {
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    if (hasDisplayPosition(record) || record.place === "port") continue;

    const previousIndex = findPreviousPositionIndex(records, index);
    const nextIndex = findNextPositionIndex(records, index);
    if (previousIndex === -1 || nextIndex === -1) continue;

    const previous = records[previousIndex];
    const next = records[nextIndex];
    const fraction = interpolationFraction(
      previous,
      record,
      next,
      previousIndex,
      index,
      nextIndex,
    );
    const estimated = interpolateGreatCircle(previous, next, fraction);

    setDisplayPosition(
      record,
      estimated.latitude,
      estimated.longitude,
      "interpolated",
      `Estimated between the recorded fixes for ${previous.date} and ${next.date}.`,
    );
  }
}

function findPreviousPositionIndex(records, startingIndex) {
  for (let index = startingIndex - 1; index >= 0; index -= 1) {
    if (hasRecordedPosition(records[index])) return index;
  }
  return -1;
}

function findNextPositionIndex(records, startingIndex) {
  for (let index = startingIndex + 1; index < records.length; index += 1) {
    if (hasRecordedPosition(records[index])) return index;
  }
  return -1;
}

function interpolationFraction(
  previous,
  current,
  next,
  previousIndex,
  currentIndex,
  nextIndex,
) {
  if (previous.dateObject && current.dateObject && next.dateObject) {
    const fullInterval = next.dateObject - previous.dateObject;
    if (fullInterval > 0) {
      return Math.max(
        0,
        Math.min(1, (current.dateObject - previous.dateObject) / fullInterval),
      );
    }
  }

  return (currentIndex - previousIndex) / (nextIndex - previousIndex);
}

/** Spherical interpolation follows the shorter great-circle path. */
function interpolateGreatCircle(start, end, fraction) {
  const startVector = coordinateToVector(
    start.displayLatitude ?? start.latitude,
    start.displayLongitude ?? start.longitude,
  );
  const endVector = coordinateToVector(
    end.displayLatitude ?? end.latitude,
    end.displayLongitude ?? end.longitude,
  );
  const dotProduct = Math.max(
    -1,
    Math.min(
      1,
      startVector.x * endVector.x +
        startVector.y * endVector.y +
        startVector.z * endVector.z,
    ),
  );
  const angle = Math.acos(dotProduct);

  if (angle < 0.000001) {
    return {
      latitude: start.latitude,
      longitude: start.longitude,
    };
  }

  const divisor = Math.sin(angle);
  const startWeight = Math.sin((1 - fraction) * angle) / divisor;
  const endWeight = Math.sin(fraction * angle) / divisor;
  const vector = {
    x: startVector.x * startWeight + endVector.x * endWeight,
    y: startVector.y * startWeight + endVector.y * endWeight,
    z: startVector.z * startWeight + endVector.z * endWeight,
  };

  return vectorToCoordinate(vector);
}

function coordinateToVector(latitude, longitude) {
  const latitudeRadians = degreesToRadians(latitude);
  const longitudeRadians = degreesToRadians(longitude);
  return {
    x: Math.cos(latitudeRadians) * Math.cos(longitudeRadians),
    y: Math.cos(latitudeRadians) * Math.sin(longitudeRadians),
    z: Math.sin(latitudeRadians),
  };
}

function vectorToCoordinate(vector) {
  return {
    latitude: radiansToDegrees(
      Math.atan2(vector.z, Math.hypot(vector.x, vector.y)),
    ),
    longitude: radiansToDegrees(Math.atan2(vector.y, vector.x)),
  };
}

function degreesToRadians(value) {
  return (value * Math.PI) / 180;
}

function radiansToDegrees(value) {
  return (value * 180) / Math.PI;
}

// -----------------------------------------------------------------------------
// 4. Main rendering
// -----------------------------------------------------------------------------

function activeDataset() {
  return (
    state.datasets.find((dataset) => dataset.id === state.activeDatasetId) ||
    state.datasets[0]
  );
}

function visibleRecords() {
  const dataset = activeDataset();
  if (!dataset) return [];
  if (!state.query) return dataset.records;

  const normalizedQuery = state.query.toLowerCase();
  return dataset.records.filter((record) => {
    const searchableText = [
      record.date,
      record.entry,
      record.note,
      record.ships.join(" "),
      record.nature.join(" "),
      record.placeName,
    ]
      .join(" ")
      .toLowerCase();
    return searchableText.includes(normalizedQuery);
  });
}

function render() {
  const dataset = activeDataset();
  const records = visibleRecords();

  renderSourceSelector();
  renderHeader(dataset);

  if (!dataset) {
    renderEmptyPage();
    return;
  }

  state.selectedRecordIndex = Math.min(
    state.selectedRecordIndex,
    Math.max(0, records.length - 1),
  );
  const selectedRecord = records[state.selectedRecordIndex];

  if (state.mode === "map") {
    drawMap(dataset.records, selectedRecord);
  } else {
    drawCalendar(dataset.records, selectedRecord);
  }

  renderRecordStrip(records);
  renderDetails(selectedRecord, records, dataset.records);
}

function renderSourceSelector() {
  elements.source.innerHTML = state.datasets
    .map(
      (dataset) =>
        `<option value="${escapeHtml(dataset.id)}"${
          dataset.id === state.activeDatasetId ? " selected" : ""
        }>${escapeHtml(dataset.name)}</option>`,
    )
    .join("");
}

function renderHeader(dataset) {
  elements.title.textContent = dataset ? dataset.name : "No source loaded";
  elements.subtitle.textContent = dataset
    ? `${dataset.filename} · ${dataset.kind}`
    : "The published CSV could not be loaded.";

  elements.mapTab.classList.toggle("active", state.mode === "map");
  elements.calendarTab.classList.toggle("active", state.mode === "calendar");
  elements.legend.style.display = state.mode === "map" ? "flex" : "none";
}

function renderEmptyPage() {
  elements.view.className = "view empty-state";
  elements.view.innerHTML = `
    <div>
      <h2>No source loaded</h2>
      <p>Check the CSV path or upload a CSV manually.</p>
    </div>`;
  elements.recordStrip.innerHTML = "";
  elements.details.innerHTML = '<div class="empty-state"><p>Select a record.</p></div>';
}

function renderRecordStrip(records) {
  elements.recordStrip.innerHTML = records
    .map(
      (record, index) => `
        <button data-index="${index}" class="${
          index === state.selectedRecordIndex ? "active" : ""
        }" type="button">
          <b>${record.day}</b>
          <span>${escapeHtml(record.shortDate)}</span>
        </button>`,
    )
    .join("");

  elements.recordStrip.querySelectorAll("button").forEach((button) => {
    button.addEventListener("click", () => {
      state.selectedRecordIndex = Number(button.dataset.index);
      render();
    });
  });
}

// -----------------------------------------------------------------------------
// 5. Map rendering and controls
// -----------------------------------------------------------------------------

function drawMap(allRecords, selectedRecord) {
  const positionedRecords = allRecords.filter(hasDisplayPosition);
  if (!positionedRecords.length) {
    elements.view.className = "view empty-state";
    elements.view.innerHTML = `
      <div>
        <h2>No coordinates in this source</h2>
        <p>The calendar still includes every dated record.</p>
      </div>`;
    return;
  }

  elements.view.className = "view";
  elements.view.innerHTML = `
    <div id="tile-map" class="map">
      <div id="tiles" class="tiles"></div>
      <svg id="overlay" class="overlay" aria-label="Voyage route"></svg>
      <span class="map-help">Scroll to zoom · drag to pan</span>
      <span class="map-attribution">
        © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>
      </span>
    </div>`;

  const mapElement = document.getElementById("tile-map");
  installMapControls(mapElement, allRecords, selectedRecord);
  requestAnimationFrame(() => paintMap(allRecords, selectedRecord));
}

function paintMap(allRecords, selectedRecord) {
  const mapElement = document.getElementById("tile-map");
  const tilesElement = document.getElementById("tiles");
  const overlayElement = document.getElementById("overlay");
  if (!mapElement || !tilesElement || !overlayElement) return;

  const width = mapElement.clientWidth;
  const height = mapElement.clientHeight;
  const zoom = state.map.zoom;
  const center = worldPixel(
    state.map.longitude,
    state.map.latitude,
    zoom,
  );
  const left = center.x - width / 2;
  const top = center.y - height / 2;

  paintTiles(tilesElement, width, height, zoom, left, top);

  const positionedRecords = allRecords.filter(hasDisplayPosition);
  const screenPoint = (record) =>
    recordScreenPoint(record, center, left, top, zoom);
  const markers = groupPortMarkers(positionedRecords);

  overlayElement.setAttribute("viewBox", `0 0 ${width} ${height}`);
  overlayElement.innerHTML = [
    createRouteSvg(positionedRecords, screenPoint),
    createMarkerSvg(markers, selectedRecord, screenPoint),
  ].join("");

  overlayElement.querySelectorAll(".map-marker").forEach((markerElement) => {
    markerElement.addEventListener("click", (event) => {
      event.stopPropagation();
      selectMarkerRecord(markerElement.dataset.recordIds, selectedRecord);
    });
  });
}

function paintTiles(tilesElement, width, height, zoom, left, top) {
  const tileSize = CONFIG.tileSize;
  const minimumX = Math.floor(left / tileSize);
  const maximumX = Math.floor((left + width) / tileSize);
  const minimumY = Math.floor(top / tileSize);
  const maximumY = Math.floor((top + height) / tileSize);
  const tilesPerAxis = 2 ** zoom;
  let html = "";

  for (let y = minimumY; y <= maximumY; y += 1) {
    for (let x = minimumX; x <= maximumX; x += 1) {
      if (y < 0 || y >= tilesPerAxis) continue;
      const wrappedX = ((x % tilesPerAxis) + tilesPerAxis) % tilesPerAxis;
      html += `
        <img
          class="tile"
          draggable="false"
          alt=""
          src="https://tile.openstreetmap.org/${zoom}/${wrappedX}/${y}.png"
          style="left:${x * tileSize - left}px; top:${y * tileSize - top}px"
        />`;
    }
  }

  tilesElement.innerHTML = html;
}

function worldPixel(longitude, latitude, zoom) {
  const worldSize = CONFIG.tileSize * 2 ** zoom;
  const clampedLatitude = Math.max(-85.0511, Math.min(85.0511, latitude));
  const x = ((longitude + 180) / 360) * worldSize;
  const y =
    ((1 -
      Math.log(
        Math.tan(degreesToRadians(clampedLatitude)) +
          1 / Math.cos(degreesToRadians(clampedLatitude)),
      ) /
        Math.PI) /
      2) *
    worldSize;
  return { x, y, worldSize };
}

function recordScreenPoint(record, center, left, top, zoom) {
  const point = worldPixel(
    record.displayLongitude,
    record.displayLatitude,
    zoom,
  );

  // Wrap points around the date line to the copy nearest the map center.
  while (point.x - center.x > point.worldSize / 2) point.x -= point.worldSize;
  while (point.x - center.x < -point.worldSize / 2) point.x += point.worldSize;

  return { x: point.x - left, y: point.y - top };
}

function createRouteSvg(records, screenPoint) {
  let svg = "";

  for (let index = 1; index < records.length; index += 1) {
    const start = records[index - 1];
    const end = records[index];
    const startPoint = screenPoint(start);
    const endPoint = screenPoint(end);
    const isEstimated =
      start.positionMethod === "interpolated" ||
      end.positionMethod === "interpolated";
    const coordinates = `x1="${startPoint.x}" y1="${startPoint.y}" x2="${endPoint.x}" y2="${endPoint.y}"`;

    svg += `<line class="route-underlay" ${coordinates} />`;
    svg += `<line class="route-segment${isEstimated ? " estimated" : ""}" ${coordinates} />`;
  }

  return svg;
}

/**
 * Consecutive port records at the same location become one marker. The marker
 * retains all record IDs, so every daily entry remains available.
 */
function groupPortMarkers(positionedRecords) {
  const markers = [];

  for (const record of positionedRecords) {
    const previousMarker = markers[markers.length - 1];
    const canJoinPreviousPort =
      record.place === "port" &&
      previousMarker?.place === "port" &&
      previousMarker.lastSourceIndex + 1 === record.sourceIndex &&
      distanceNauticalMiles(
        previousMarker.displayLatitude,
        previousMarker.displayLongitude,
        record.displayLatitude,
        record.displayLongitude,
      ) < 1;

    if (canJoinPreviousPort) {
      previousMarker.records.push(record);
      previousMarker.lastSourceIndex = record.sourceIndex;
    } else {
      markers.push({
        id: `marker-${record.id}`,
        place: record.place,
        displayLatitude: record.displayLatitude,
        displayLongitude: record.displayLongitude,
        positionMethod: record.positionMethod,
        records: [record],
        lastSourceIndex: record.sourceIndex,
      });
    }
  }

  return markers;
}

function createMarkerSvg(markers, selectedRecord, screenPoint) {
  return markers
    .map((marker) => {
      const point = screenPoint(marker);
      const recordIds = marker.records.map((record) => record.id);
      const isSelected = recordIds.includes(selectedRecord?.id);
      const isEstimated = marker.positionMethod === "interpolated";
      const classes = [
        "map-marker",
        isSelected ? "selected" : "",
        isEstimated ? "estimated" : "",
      ]
        .filter(Boolean)
        .join(" ");

      let shape;
      if (marker.place === "port") {
        shape = `
          <polygon
            points="0,-12 3,-4 11,-3 5,2 7,11 0,6 -7,11 -5,2 -11,-3 -3,-4"
            transform="translate(${point.x} ${point.y})"
          />`;
      } else {
        shape = `<circle cx="${point.x}" cy="${point.y}" r="${isSelected ? 9 : 7}" />`;
      }

      const label =
        marker.place === "port" && marker.records.length > 1
          ? `<text class="port-count" x="${point.x + 11}" y="${point.y - 9}">${marker.records.length}</text>`
          : `<text x="${point.x}" y="${point.y + 3}">${marker.records[0].day}</text>`;

      return `
        <g class="${classes}" data-record-ids="${escapeHtml(recordIds.join(","))}">
          ${shape}
          ${label}
        </g>`;
    })
    .join("");
}

function selectMarkerRecord(recordIdsText, currentRecord) {
  const recordIds = recordIdsText.split(",");
  const selectedId = recordIds.includes(currentRecord?.id)
    ? currentRecord.id
    : recordIds[0];
  selectRecordById(selectedId);
}

function installMapControls(mapElement, allRecords, selectedRecord) {
  let dragging = false;
  let dragStart;
  let startingMapState;
  let wheelAccumulator = 0;

  mapElement.addEventListener(
    "wheel",
    (event) => {
      event.preventDefault();
      wheelAccumulator += event.deltaY;
      if (Math.abs(wheelAccumulator) < 180) return;

      state.map.zoom = Math.max(
        CONFIG.minZoom,
        Math.min(
          CONFIG.maxZoom,
          state.map.zoom + (wheelAccumulator < 0 ? 1 : -1),
        ),
      );
      wheelAccumulator = 0;
      paintMap(allRecords, selectedRecord);
    },
    { passive: false },
  );

  mapElement.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 || event.target.closest(".map-marker")) return;
    dragging = true;
    dragStart = { x: event.clientX, y: event.clientY };
    startingMapState = { ...state.map };
    mapElement.setPointerCapture(event.pointerId);
    mapElement.classList.add("dragging");
  });

  mapElement.addEventListener("pointermove", (event) => {
    if (!dragging) return;

    const startingCenter = worldPixel(
      startingMapState.longitude,
      startingMapState.latitude,
      startingMapState.zoom,
    );
    const movedCenter = {
      x: startingCenter.x - (event.clientX - dragStart.x),
      y: startingCenter.y - (event.clientY - dragStart.y),
      worldSize: startingCenter.worldSize,
    };

    state.map.longitude = (movedCenter.x / movedCenter.worldSize) * 360 - 180;
    const mercatorLatitude = Math.PI * (1 - (2 * movedCenter.y) / movedCenter.worldSize);
    state.map.latitude = radiansToDegrees(Math.atan(Math.sinh(mercatorLatitude)));
    paintMap(allRecords, selectedRecord);
  });

  function stopDragging() {
    dragging = false;
    mapElement.classList.remove("dragging");
  }

  mapElement.addEventListener("pointerup", stopDragging);
  mapElement.addEventListener("pointercancel", stopDragging);
}

// -----------------------------------------------------------------------------
// 6. Calendar and entry details
// -----------------------------------------------------------------------------

function drawCalendar(allRecords, selectedRecord) {
  const datedRecords = allRecords
    .filter((record) => record.dateObject)
    .sort((a, b) => a.dateObject - b.dateObject);

  if (!datedRecords.length) {
    elements.view.className = "view empty-state";
    elements.view.innerHTML = `
      <div>
        <h2>No machine-readable dates</h2>
        <p>Use dates such as October 15, 1850.</p>
      </div>`;
    return;
  }

  const recordsByDate = new Map(
    datedRecords.map((record) => [dateKey(record.dateObject), record]),
  );
  const firstMonth = new Date(
    datedRecords[0].dateObject.getFullYear(),
    datedRecords[0].dateObject.getMonth(),
    1,
  );
  const finalRecord = datedRecords[datedRecords.length - 1];
  const lastMonth = new Date(
    finalRecord.dateObject.getFullYear(),
    finalRecord.dateObject.getMonth(),
    1,
  );

  let calendarHtml = "";
  for (
    const month = new Date(firstMonth);
    month <= lastMonth;
    month.setMonth(month.getMonth() + 1)
  ) {
    calendarHtml += createMonthHtml(month, recordsByDate, selectedRecord);
  }

  elements.view.className = "view calendar";
  elements.view.innerHTML = calendarHtml;
  elements.view.querySelectorAll("[data-record-id]").forEach((button) => {
    button.addEventListener("click", () => selectRecordById(button.dataset.recordId));
  });
}

function createMonthHtml(month, recordsByDate, selectedRecord) {
  const year = month.getFullYear();
  const monthIndex = month.getMonth();
  const daysInMonth = new Date(year, monthIndex + 1, 0).getDate();
  let dayCells = "";

  for (let blank = 0; blank < new Date(year, monthIndex, 1).getDay(); blank += 1) {
    dayCells += '<button class="day blank" type="button"></button>';
  }

  for (let dayNumber = 1; dayNumber <= daysInMonth; dayNumber += 1) {
    const date = new Date(year, monthIndex, dayNumber, 12);
    const record = recordsByDate.get(dateKey(date));
    const summary = record
      ? (record.nature[0] || record.ships[0] || record.note || record.entry).slice(
          0,
          60,
        )
      : "No entry loaded";

    dayCells += `
      <button
        type="button"
        ${record ? `data-record-id="${escapeHtml(record.id)}"` : "disabled"}
        class="day ${record ? "" : "missing"} ${
          record?.id === selectedRecord?.id ? "active" : ""
        }"
      >
        <b>${dayNumber}</b>
        <span>${escapeHtml(summary)}</span>
      </button>`;
  }

  const monthLabel = new Intl.DateTimeFormat("en", {
    month: "long",
    year: "numeric",
  }).format(month);

  return `
    <section class="month">
      <h3>${monthLabel}</h3>
      <div class="weekday-row">
        ${["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
          .map((weekday) => `<span>${weekday}</span>`)
          .join("")}
      </div>
      <div class="days">${dayCells}</div>
    </section>`;
}

function dateKey(date) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

function renderDetails(record, visibleRecordList, allRecords) {
  if (!record) {
    elements.details.innerHTML =
      '<div class="empty-state"><p>No matching records.</p></div>';
    return;
  }

  const recordedPositionRecords = visibleRecordList.filter(hasRecordedPosition);
  const recordedPositionIndex = recordedPositionRecords.indexOf(record);
  const priorFix =
    recordedPositionIndex > 0
      ? recordedPositionRecords[recordedPositionIndex - 1]
      : null;
  const legDistance = priorFix
    ? distanceNauticalMiles(
        priorFix.latitude,
        priorFix.longitude,
        record.latitude,
        record.longitude,
      )
    : 0;
  const elapsedDays =
    priorFix?.dateObject && record.dateObject
      ? Math.max(1, Math.round((record.dateObject - priorFix.dateObject) / 86400000))
      : 1;

  const portVisit = findPortVisit(allRecords, record);
  const positionLabel = positionTypeLabel(record);
  const coordinateHtml = createCoordinateHtml(record);
  const estimateHtml = record.positionNote
    ? `<p class="estimate-note"><strong>Map position:</strong> ${escapeHtml(
        record.positionNote,
      )}</p>`
    : "";
  const portVisitHtml = createPortVisitHtml(portVisit, record);
  const metricsHtml = hasRecordedPosition(record)
    ? createMetricsHtml(record, priorFix, legDistance, elapsedDays)
    : "";
  const observationsHtml = createObservationsHtml(record);

  elements.details.innerHTML = `
    <div class="record-nav">
      <button id="previous-record" type="button" ${
        state.selectedRecordIndex === 0 ? "disabled" : ""
      }>‹</button>
      <span>Record ${state.selectedRecordIndex + 1} of ${visibleRecordList.length}</span>
      <button id="next-record" type="button" ${
        state.selectedRecordIndex >= visibleRecordList.length - 1 ? "disabled" : ""
      }>›</button>
    </div>

    <p class="eyebrow">${positionLabel}</p>
    <h2>${escapeHtml(record.date)}</h2>
    ${coordinateHtml}
    ${estimateHtml}
    ${portVisitHtml}
    ${metricsHtml}
    ${observationsHtml}
    ${
      record.note
        ? `<p class="editorial-note">${escapeHtml(record.note)}</p>`
        : ""
    }

    <div class="entry">
      <h3>Transcription or entry</h3>
      <blockquote>${escapeHtml(record.entry)}</blockquote>
    </div>`;

  document.getElementById("previous-record").addEventListener("click", () => {
    state.selectedRecordIndex -= 1;
    render();
  });
  document.getElementById("next-record").addEventListener("click", () => {
    state.selectedRecordIndex += 1;
    render();
  });
  elements.details.querySelectorAll("[data-port-record-id]").forEach((button) => {
    button.addEventListener("click", () =>
      selectRecordById(button.dataset.portRecordId),
    );
  });
}

function positionTypeLabel(record) {
  if (record.place === "port") return "Port record";
  if (record.positionMethod === "interpolated") return "Estimated position at sea";
  if (hasRecordedPosition(record)) return "Recorded position at sea";
  return "Source record";
}

function createCoordinateHtml(record) {
  if (hasRecordedPosition(record)) {
    return `
      <div class="coordinate-labels">
        <span>${escapeHtml(record.latitudeLabel)}</span>
        <span>${escapeHtml(record.longitudeLabel)}</span>
      </div>`;
  }

  if (hasDisplayPosition(record)) {
    return `
      <div class="coordinate-labels">
        <span>Estimated ${formatCoordinate(record.displayLatitude, "latitude")}</span>
        <span>Estimated ${formatCoordinate(record.displayLongitude, "longitude")}</span>
      </div>`;
  }

  return `
    <div class="coordinate-labels">
      <span>No latitude recorded</span>
      <span>No longitude recorded</span>
    </div>`;
}

function createMetricsHtml(record, priorFix, legDistance, elapsedDays) {
  return `
    <div class="metrics">
      <div>
        <small>From prior recorded fix</small>
        <b>${priorFix ? `${Math.round(legDistance)} nmi` : "Departure"}</b>
      </div>
      <div>
        <small>Average speed</small>
        <b>${priorFix ? `${(legDistance / (24 * elapsedDays)).toFixed(1)} kn` : "—"}</b>
      </div>
      <div>
        <small>Course</small>
        <b>${escapeHtml(record.course)}</b>
      </div>
    </div>`;
}

function createObservationsHtml(record) {
  const ships = record.ships.length
    ? `<div><b>Ships</b>${escapeHtml(record.ships.join("; "))}</div>`
    : "";
  const nature = record.nature.length
    ? `<div><b>Animals &amp; plants</b>${escapeHtml(
        record.nature.join("; "),
      )}</div>`
    : "";
  return ships || nature ? `<div class="observations">${ships}${nature}</div>` : "";
}

function findPortVisit(allRecords, selectedRecord) {
  if (selectedRecord.place !== "port" || !hasDisplayPosition(selectedRecord)) {
    return [];
  }

  let startIndex = selectedRecord.sourceIndex;
  let endIndex = selectedRecord.sourceIndex;

  while (
    startIndex > 0 &&
    recordsSharePortVisit(allRecords[startIndex - 1], selectedRecord)
  ) {
    startIndex -= 1;
  }
  while (
    endIndex + 1 < allRecords.length &&
    recordsSharePortVisit(allRecords[endIndex + 1], selectedRecord)
  ) {
    endIndex += 1;
  }

  return allRecords.slice(startIndex, endIndex + 1);
}

function recordsSharePortVisit(candidate, selectedRecord) {
  return (
    candidate.place === "port" &&
    hasDisplayPosition(candidate) &&
    distanceNauticalMiles(
      candidate.displayLatitude,
      candidate.displayLongitude,
      selectedRecord.displayLatitude,
      selectedRecord.displayLongitude,
    ) < 1
  );
}

function createPortVisitHtml(portVisit, selectedRecord) {
  if (portVisit.length <= 1) return "";

  const first = portVisit[0];
  const last = portVisit[portVisit.length - 1];
  const label = first.placeName || selectedRecord.placeName || "Port visit";

  return `
    <div class="port-visit">
      <strong>${escapeHtml(label)} · ${portVisit.length} entries</strong><br />
      ${escapeHtml(first.shortDate)}–${escapeHtml(last.shortDate)}
      <div class="port-date-list">
        ${portVisit
          .map(
            (record) => `
              <button
                type="button"
                data-port-record-id="${escapeHtml(record.id)}"
                class="${record.id === selectedRecord.id ? "active" : ""}"
              >${escapeHtml(record.shortDate)}</button>`,
          )
          .join("")}
      </div>
    </div>`;
}

function selectRecordById(recordId) {
  const records = visibleRecords();
  const index = records.findIndex((record) => record.id === recordId);
  if (index >= 0) {
    state.selectedRecordIndex = index;
    render();
  }
}

function distanceNauticalMiles(lat1, lon1, lat2, lon2) {
  const earthRadiusNauticalMiles = 3440.065;
  const latitudeDifference = degreesToRadians(lat2 - lat1);
  const longitudeDifference = degreesToRadians(lon2 - lon1);
  const haversine =
    Math.sin(latitudeDifference / 2) ** 2 +
    Math.cos(degreesToRadians(lat1)) *
      Math.cos(degreesToRadians(lat2)) *
      Math.sin(longitudeDifference / 2) ** 2;
  return 2 * earthRadiusNauticalMiles * Math.asin(Math.sqrt(haversine));
}

// -----------------------------------------------------------------------------
// 7. User interactions and startup
// -----------------------------------------------------------------------------

function showStatus(message) {
  elements.status.textContent = message;
  elements.status.classList.add("visible");
}

function saveDatasets() {
  try {
    localStorage.setItem(CONFIG.localStorageKey, JSON.stringify(state.datasets));
  } catch (error) {
    console.warn("The browser could not save uploaded datasets.", error);
  }
}

function restoreSavedDatasets() {
  try {
    state.datasets = JSON.parse(
      localStorage.getItem(CONFIG.localStorageKey) || "[]",
    );

    for (const dataset of state.datasets) {
      for (const record of dataset.records) {
        record.dateObject = parseDate(record.date);
      }
      // Recalculate rather than trusting an older cached reconstruction.
      assignDisplayPositions(dataset.records);
    }
  } catch {
    state.datasets = [];
  }
}

async function loadPublishedCsv() {
  const response = await fetch(CONFIG.publishedCsvPath, { cache: "no-store" });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);

  const csvText = await response.text();
  const publishedDataset = createDataset(
    csvText,
    CONFIG.publishedCsvFilename,
  );

  // Always use the newest GitHub copy instead of a stale browser copy.
  state.datasets = state.datasets.filter(
    (dataset) => dataset.filename !== CONFIG.publishedCsvFilename,
  );
  state.datasets.unshift(publishedDataset);
  state.activeDatasetId = publishedDataset.id;
  state.selectedRecordIndex = 0;
  saveDatasets();
}

elements.files.addEventListener("change", async (event) => {
  const addedDatasets = [];

  for (const file of event.target.files) {
    try {
      addedDatasets.push(createDataset(await file.text(), file.name));
    } catch (error) {
      showStatus(error.message);
    }
  }

  if (addedDatasets.length) {
    state.datasets.push(...addedDatasets);
    state.activeDatasetId = addedDatasets[0].id;
    state.selectedRecordIndex = 0;
    saveDatasets();
    showStatus(`Added ${addedDatasets.map((dataset) => dataset.name).join(", ")}`);
    render();
  }

  event.target.value = "";
});

elements.source.addEventListener("change", (event) => {
  state.activeDatasetId = event.target.value;
  state.selectedRecordIndex = 0;
  render();
});

elements.search.addEventListener("input", (event) => {
  state.query = event.target.value;
  state.selectedRecordIndex = 0;
  render();
});

elements.remove.addEventListener("click", () => {
  state.datasets = state.datasets.filter(
    (dataset) => dataset.id !== state.activeDatasetId,
  );
  state.activeDatasetId = state.datasets[0]?.id || "";
  state.selectedRecordIndex = 0;
  saveDatasets();
  render();
});

elements.mapTab.addEventListener("click", () => {
  state.mode = "map";
  render();
});

elements.calendarTab.addEventListener("click", () => {
  state.mode = "calendar";
  render();
});

async function initializeSite() {
  restoreSavedDatasets();

  try {
    await loadPublishedCsv();
  } catch (error) {
    showStatus(
      `Could not load ${CONFIG.publishedCsvPath}: ${error.message}. ` +
        "The file must be viewed through GitHub Pages or another web server.",
    );
    state.activeDatasetId = state.datasets[0]?.id || "";
  }

  render();
}

initializeSite();
