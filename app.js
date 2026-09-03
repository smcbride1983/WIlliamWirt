/*
 * William Wirt Voyage Archive
 *
 * CSV location:
 *   williamwirt/data/logbook1.csv
 *
 * Expected CSV columns include:
 *   date
 *   short_date
 *   latitude
 *   longitude
 *   marker_type
 *   place
 *   course
 *   entry
 *   captains_entry
 *   comparison_note
 *   ships
 *   animals_plants
 *   note
 */

// ============================================================
// 1. Configuration
// ============================================================

const CONFIG = {
  csvPath: "./data/logbook1.csv",
  csvFilename: "logbook1.csv",
  storageKey: "william-wirt-records-v4",
  tileSize: 256,
  minimumZoom: 1,
  maximumZoom: 8,
};


// ============================================================
// 2. Page elements
// ============================================================

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


// ============================================================
// 3. Application state
// ============================================================

const state = {
  datasets: [],
  activeDatasetId: "",
  selectedRecordIndex: 0,
  searchText: "",
  mode: "map",

  map: {
    longitude: -35,
    latitude: 22,
    zoom: 2,
  },
};


// ============================================================
// 4. CSV parsing
// ============================================================

function parseCsv(text) {
  const rows = [];

  let row = [];
  let field = "";
  let insideQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    const nextCharacter = text[index + 1];

    if (
      character === '"' &&
      insideQuotes &&
      nextCharacter === '"'
    ) {
      field += '"';
      index += 1;
    } else if (character === '"') {
      insideQuotes = !insideQuotes;
    } else if (character === "," && !insideQuotes) {
      row.push(field);
      field = "";
    } else if (
      (character === "\n" || character === "\r") &&
      !insideQuotes
    ) {
      if (character === "\r" && nextCharacter === "\n") {
        index += 1;
      }

      row.push(field);

      if (row.some((value) => value.trim())) {
        rows.push(row);
      }

      row = [];
      field = "";
    } else {
      field += character;
    }
  }

  row.push(field);

  if (row.some((value) => value.trim())) {
    rows.push(row);
  }

  return rows;
}


function parseDate(value) {
  if (!value) {
    return null;
  }

  const withoutWeekday = value.replace(
    /^(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday),?\s*/i,
    "",
  );

  const date = new Date(`${withoutWeekday} 12:00:00`);

  return Number.isNaN(date.getTime()) ? null : date;
}


function parseNumber(value) {
  const cleanedValue = String(value ?? "").trim();

  if (!cleanedValue) {
    return undefined;
  }

  const number = Number(cleanedValue);

  return Number.isFinite(number) ? number : undefined;
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


// ============================================================
// 5. Convert CSV rows into logbook records
// ============================================================

function createDataset(csvText, filename) {
  const rows = parseCsv(csvText);

  if (rows.length < 2) {
    throw new Error(`${filename} has no data rows.`);
  }

  const originalHeaders = rows[0];

  const headers = originalHeaders.map((header) =>
    header.trim().toLowerCase(),
  );

  function getValue(row, ...possibleHeaders) {
    for (const possibleHeader of possibleHeaders) {
      const columnIndex = headers.indexOf(possibleHeader);

      if (
        columnIndex >= 0 &&
        row[columnIndex] !== undefined &&
        row[columnIndex].trim()
      ) {
        return row[columnIndex].trim();
      }
    }

    return "";
  }

  const basename = filename.replace(/\.csv$/i, "");
  const firstRow = rows[1];

  const datasetName =
    getValue(
      firstRow,
      "dataset_name",
      "source_name",
      "logbook",
    ) || basename.replace(/[-_]/g, " ");

  const records = rows
    .slice(1)
    .filter((row) => row.some((value) => value.trim()))
    .map((row, index) => {
      const latitude = parseNumber(
        getValue(row, "latitude", "lat"),
      );

      const longitude = parseNumber(
        getValue(row, "longitude", "longitude", "lon", "long"),
      );

      const date =
        getValue(row, "date", "entry_date") ||
        `Record ${index + 1}`;

      const markerType = getValue(
        row,
        "marker_type",
        "location_type",
        "place_type",
      ).toLowerCase();

      const isPort =
        /^(port|harbor|harbour|anchorage|at port|in port)$/.test(
          markerType.trim(),
        );

      const isSea =
        /^(sea|at sea|underway)$/.test(markerType.trim());

      const matesEntry =
        getValue(
          row,
          "mates_entry",
          "mate_entry",
          "mates_log",
          "mate_log",
          "entry",
          "transcription",
          "description",
          "text",
          "details",
        ) ||
        "No mate’s entry has been entered.";

      const captainsEntry = getValue(
        row,
        "captains_entry",
        "captain_entry",
        "captains_log",
        "captain_log",
      );

      const comparisonNote = getValue(
        row,
        "comparison_note",
        "source_comparison",
        "comparison",
      );

      return {
        id: `${basename}-${index}`,
        sourceIndex: index,

        day:
          Number(
            getValue(
              row,
              "day",
              "record_number",
              "number",
            ),
          ) ||
          index + 1,

        date,
        dateObject: parseDate(date),
        shortDate: getValue(row, "short_date") || date,

        /*
         * These are the coordinates actually recorded in the log.
         * They are never overwritten by calculated coordinates.
         */
        latitude,
        longitude,

        latitudeLabel:
          getValue(row, "latitude_label") ||
          formatCoordinate(latitude, "latitude"),

        longitudeLabel:
          getValue(row, "longitude_label") ||
          formatCoordinate(longitude, "longitude"),

        place:
          isPort || isSea
            ? isPort
              ? "port"
              : "sea"
            : latitude !== undefined || longitude !== undefined
              ? "sea"
              : "record",

        placeName: getValue(
          row,
          "place",
          "place_name",
          "port",
          "location",
        ),

        course: getValue(row, "course") || "Not recorded",

        ships: splitList(
          getValue(row, "ships", "ship_sightings"),
        ),

        nature: splitList(
          getValue(
            row,
            "animals_plants",
            "nature",
            "sightings",
          ),
        ),

        note: getValue(
          row,
          "note",
          "notes",
          "comment",
          "interpretation",
        ),

        matesEntry,
        captainsEntry,
        comparisonNote,
      };
    });

  assignDisplayPositions(records);

  return {
    id: `${basename}-${Date.now()}`,
    name: datasetName,
    filename,
    kind: "logbook",
    records,
  };
}


function formatCoordinate(value, coordinateType) {
  if (value === undefined) {
    return coordinateType === "latitude"
      ? "No latitude"
      : "No longitude";
  }

  let direction;

  if (coordinateType === "latitude") {
    direction = value >= 0 ? "N" : "S";
  } else {
    direction = value >= 0 ? "E" : "W";
  }

  return `${Math.abs(value).toFixed(4)}° ${direction}`;
}


// ============================================================
// 6. Reconstruct missing positions
// ============================================================

function hasRecordedPosition(record) {
  return (
    record.latitude !== undefined &&
    record.longitude !== undefined
  );
}


function hasDisplayPosition(record) {
  return (
    record.displayLatitude !== undefined &&
    record.displayLongitude !== undefined
  );
}


function setDisplayPosition(
  record,
  latitude,
  longitude,
  method,
  explanation = "",
) {
  record.displayLatitude = latitude;
  record.displayLongitude = longitude;
  record.positionMethod = method;
  record.positionNote = explanation;
}


function assignDisplayPositions(records) {
  /*
   * Remove previously calculated positions before recalculating.
   */
  for (const record of records) {
    delete record.displayLatitude;
    delete record.displayLongitude;
    delete record.positionMethod;
    delete record.positionNote;

    if (hasRecordedPosition(record)) {
      setDisplayPosition(
        record,
        record.latitude,
        record.longitude,
        "recorded",
      );
    }
  }

  assignPortPositions(records);
  assignInterpolatedPositions(records);
}


/*
 * Consecutive port entries can share the position recorded during
 * that port visit.
 */
function assignPortPositions(records) {
  let runStart = 0;

  while (runStart < records.length) {
    if (records[runStart].place !== "port") {
      runStart += 1;
      continue;
    }

    let runEnd = runStart;

    while (
      runEnd + 1 < records.length &&
      records[runEnd + 1].place === "port"
    ) {
      runEnd += 1;
    }

    const portRecords = records.slice(runStart, runEnd + 1);

    const recordedPortPosition =
      portRecords.find(hasRecordedPosition);

    if (recordedPortPosition) {
      for (
        let index = runStart;
        index <= runEnd;
        index += 1
      ) {
        const record = records[index];

        if (!hasDisplayPosition(record)) {
          const portName =
            record.placeName ||
            recordedPortPosition.placeName ||
            "this port";

          setDisplayPosition(
            record,
            record.latitude !== undefined
              ? record.latitude
              : recordedPortPosition.latitude,
            record.longitude !== undefined
              ? record.longitude
              : recordedPortPosition.longitude,
            "port-inherited",
            `Mapped to ${portName} using a recorded position from this port visit.`,
          );
        }
      }
    }

    runStart = runEnd + 1;
  }
}


/*
 * Missing coordinates at sea are calculated only when the record
 * is between two complete recorded positions.
 *
 * If latitude exists but longitude is missing:
 *   the recorded latitude is preserved.
 *
 * If longitude exists but latitude is missing:
 *   the recorded longitude is preserved.
 */
function assignInterpolatedPositions(records) {
  for (
    let recordIndex = 0;
    recordIndex < records.length;
    recordIndex += 1
  ) {
    const record = records[recordIndex];

    if (
      hasDisplayPosition(record) ||
      record.place === "port"
    ) {
      continue;
    }

    const previousIndex = findPreviousCompletePosition(
      records,
      recordIndex,
    );

    const nextIndex = findNextCompletePosition(
      records,
      recordIndex,
    );

    /*
     * Do not calculate a position unless there is a reliable
     * complete position on both sides.
     */
    if (previousIndex === -1 || nextIndex === -1) {
      continue;
    }

    const previousRecord = records[previousIndex];
    const nextRecord = records[nextIndex];

    const fraction = calculateInterpolationFraction(
      previousRecord,
      record,
      nextRecord,
      previousIndex,
      recordIndex,
      nextIndex,
    );

    const estimate = interpolateGreatCircle(
      previousRecord,
      nextRecord,
      fraction,
    );

    const hasRecordedLatitude =
      record.latitude !== undefined;

    const hasRecordedLongitude =
      record.longitude !== undefined;

    const displayLatitude = hasRecordedLatitude
      ? record.latitude
      : estimate.latitude;

    const displayLongitude = hasRecordedLongitude
      ? record.longitude
      : estimate.longitude;

    const isPartiallyRecorded =
      hasRecordedLatitude || hasRecordedLongitude;

    let explanation;

    if (isPartiallyRecorded) {
      const recordedCoordinate = hasRecordedLatitude
        ? "latitude"
        : "longitude";

      const estimatedCoordinate = hasRecordedLatitude
        ? "longitude"
        : "latitude";

      explanation =
        `The recorded ${recordedCoordinate} is preserved. ` +
        `The missing ${estimatedCoordinate} is estimated between ` +
        `${previousRecord.date} and ${nextRecord.date}.`;
    } else {
      explanation =
        `Latitude and longitude are estimated between ` +
        `${previousRecord.date} and ${nextRecord.date}.`;
    }

    setDisplayPosition(
      record,
      displayLatitude,
      displayLongitude,
      isPartiallyRecorded
        ? "partially-interpolated"
        : "interpolated",
      explanation,
    );
  }
}


function findPreviousCompletePosition(records, startingIndex) {
  for (
    let index = startingIndex - 1;
    index >= 0;
    index -= 1
  ) {
    if (hasRecordedPosition(records[index])) {
      return index;
    }
  }

  return -1;
}


function findNextCompletePosition(records, startingIndex) {
  for (
    let index = startingIndex + 1;
    index < records.length;
    index += 1
  ) {
    if (hasRecordedPosition(records[index])) {
      return index;
    }
  }

  return -1;
}


function calculateInterpolationFraction(
  previousRecord,
  currentRecord,
  nextRecord,
  previousIndex,
  currentIndex,
  nextIndex,
) {
  if (
    previousRecord.dateObject &&
    currentRecord.dateObject &&
    nextRecord.dateObject
  ) {
    const completeInterval =
      nextRecord.dateObject - previousRecord.dateObject;

    if (completeInterval > 0) {
      const currentInterval =
        currentRecord.dateObject -
        previousRecord.dateObject;

      return Math.max(
        0,
        Math.min(1, currentInterval / completeInterval),
      );
    }
  }

  return (
    (currentIndex - previousIndex) /
    (nextIndex - previousIndex)
  );
}


/*
 * Interpolate along a great-circle route instead of drawing a
 * simple straight line through latitude and longitude.
 */
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

  const startWeight =
    Math.sin((1 - fraction) * angle) / divisor;

  const endWeight =
    Math.sin(fraction * angle) / divisor;

  return vectorToCoordinate({
    x:
      startVector.x * startWeight +
      endVector.x * endWeight,

    y:
      startVector.y * startWeight +
      endVector.y * endWeight,

    z:
      startVector.z * startWeight +
      endVector.z * endWeight,
  });
}


function coordinateToVector(latitude, longitude) {
  const latitudeRadians = degreesToRadians(latitude);
  const longitudeRadians = degreesToRadians(longitude);

  return {
    x:
      Math.cos(latitudeRadians) *
      Math.cos(longitudeRadians),

    y:
      Math.cos(latitudeRadians) *
      Math.sin(longitudeRadians),

    z: Math.sin(latitudeRadians),
  };
}


function vectorToCoordinate(vector) {
  return {
    latitude: radiansToDegrees(
      Math.atan2(
        vector.z,
        Math.hypot(vector.x, vector.y),
      ),
    ),

    longitude: radiansToDegrees(
      Math.atan2(vector.y, vector.x),
    ),
  };
}


function degreesToRadians(value) {
  return (value * Math.PI) / 180;
}


function radiansToDegrees(value) {
  return (value * 180) / Math.PI;
}


// ============================================================
// 7. Dataset selection and searching
// ============================================================

function getActiveDataset() {
  return (
    state.datasets.find(
      (dataset) =>
        dataset.id === state.activeDatasetId,
    ) ||
    state.datasets[0]
  );
}


function getVisibleRecords() {
  const dataset = getActiveDataset();

  if (!dataset) {
    return [];
  }

  if (!state.searchText) {
    return dataset.records;
  }

  const searchText = state.searchText.toLowerCase();

  return dataset.records.filter((record) => {
    const searchableText = [
      record.date,
      record.matesEntry,
      record.captainsEntry,
      record.comparisonNote,
      record.note,
      record.ships.join(" "),
      record.nature.join(" "),
      record.placeName,
    ]
      .join(" ")
      .toLowerCase();

    return searchableText.includes(searchText);
  });
}


// ============================================================
// 8. Main rendering
// ============================================================

function render() {
  const dataset = getActiveDataset();
  const records = getVisibleRecords();

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

  const selectedRecord =
    records[state.selectedRecordIndex];

  if (state.mode === "map") {
    drawMap(dataset.records, selectedRecord);
  } else {
    drawCalendar(dataset.records, selectedRecord);
  }

  renderRecordStrip(records);

  renderDetails(
    selectedRecord,
    records,
    dataset.records,
  );
}


function renderSourceSelector() {
  elements.source.innerHTML = state.datasets
    .map(
      (dataset) => `
        <option
          value="${escapeHtml(dataset.id)}"
          ${
            dataset.id === state.activeDatasetId
              ? "selected"
              : ""
          }
        >
          ${escapeHtml(dataset.name)}
        </option>
      `,
    )
    .join("");
}


function renderHeader(dataset) {
  elements.title.textContent = dataset
    ? dataset.name
    : "No source loaded";

  elements.subtitle.textContent = dataset
    ? `${dataset.filename} · ${dataset.kind}`
    : "The published CSV could not be loaded.";

  elements.mapTab.classList.toggle(
    "active",
    state.mode === "map",
  );

  elements.calendarTab.classList.toggle(
    "active",
    state.mode === "calendar",
  );

  elements.legend.style.display =
    state.mode === "map" ? "flex" : "none";
}


function renderEmptyPage() {
  elements.view.className = "view empty-state";

  elements.view.innerHTML = `
    <div>
      <h2>No source loaded</h2>
      <p>
        Check the CSV path or upload a CSV manually.
      </p>
    </div>
  `;

  elements.recordStrip.innerHTML = "";

  elements.details.innerHTML = `
    <div class="empty-state">
      <p>Select a record.</p>
    </div>
  `;
}


function renderRecordStrip(records) {
  elements.recordStrip.innerHTML = records
    .map(
      (record, index) => `
        <button
          data-index="${index}"
          class="${
            index === state.selectedRecordIndex
              ? "active"
              : ""
          }"
          type="button"
        >
          <b>${record.day}</b>
          <span>${escapeHtml(record.shortDate)}</span>
        </button>
      `,
    )
    .join("");

  elements.recordStrip
    .querySelectorAll("button")
    .forEach((button) => {
      button.addEventListener("click", () => {
        state.selectedRecordIndex =
          Number(button.dataset.index);

        render();
      });
    });
}


// ============================================================
// 9. Map
// ============================================================

function drawMap(allRecords, selectedRecord) {
  const positionedRecords =
    allRecords.filter(hasDisplayPosition);

  if (!positionedRecords.length) {
    elements.view.className = "view empty-state";

    elements.view.innerHTML = `
      <div>
        <h2>No mappable coordinates</h2>
        <p>
          These records are still available in the calendar.
        </p>
      </div>
    `;

    return;
  }

  elements.view.className = "view";

  elements.view.innerHTML = `
    <div id="tile-map" class="map">
      <div id="tiles" class="tiles"></div>

      <svg
        id="overlay"
        class="overlay"
        aria-label="Voyage route"
      ></svg>

      <span class="map-help">
        Scroll to zoom · drag to pan
      </span>

      <span class="map-attribution">
        ©
        <a
          href="https://www.openstreetmap.org/copyright"
          target="_blank"
          rel="noopener"
        >
          OpenStreetMap
        </a>
      </span>
    </div>
  `;

  const mapElement =
    document.getElementById("tile-map");

  installMapControls(
    mapElement,
    allRecords,
    selectedRecord,
  );

  requestAnimationFrame(() => {
    paintMap(allRecords, selectedRecord);
  });
}


function paintMap(allRecords, selectedRecord) {
  const mapElement =
    document.getElementById("tile-map");

  const tilesElement =
    document.getElementById("tiles");

  const overlayElement =
    document.getElementById("overlay");

  if (
    !mapElement ||
    !tilesElement ||
    !overlayElement
  ) {
    return;
  }

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

  paintTiles(
    tilesElement,
    width,
    height,
    zoom,
    left,
    top,
  );

  const positionedRecords =
    allRecords.filter(hasDisplayPosition);

  const screenPoint = (record) =>
    recordScreenPoint(
      record,
      center,
      left,
      top,
      zoom,
    );

  const markers =
    groupPortMarkers(positionedRecords);

  overlayElement.setAttribute(
    "viewBox",
    `0 0 ${width} ${height}`,
  );

  overlayElement.innerHTML =
    createRouteSvg(positionedRecords, screenPoint) +
    createMarkerSvg(
      markers,
      selectedRecord,
      screenPoint,
    );

  overlayElement
    .querySelectorAll(".map-marker")
    .forEach((markerElement) => {
      markerElement.addEventListener(
        "click",
        (event) => {
          event.stopPropagation();

          selectMarkerRecord(
            markerElement.dataset.recordIds,
            selectedRecord,
          );
        },
      );
    });
}


function paintTiles(
  tilesElement,
  width,
  height,
  zoom,
  left,
  top,
) {
  const tileSize = CONFIG.tileSize;

  const minimumX = Math.floor(left / tileSize);
  const maximumX = Math.floor(
    (left + width) / tileSize,
  );

  const minimumY = Math.floor(top / tileSize);
  const maximumY = Math.floor(
    (top + height) / tileSize,
  );

  const tilesPerAxis = 2 ** zoom;

  let html = "";

  for (
    let y = minimumY;
    y <= maximumY;
    y += 1
  ) {
    for (
      let x = minimumX;
      x <= maximumX;
      x += 1
    ) {
      if (y < 0 || y >= tilesPerAxis) {
        continue;
      }

      const wrappedX =
        ((x % tilesPerAxis) + tilesPerAxis) %
        tilesPerAxis;

      html += `
        <img
          class="tile"
          draggable="false"
          alt=""
          src="https://tile.openstreetmap.org/${zoom}/${wrappedX}/${y}.png"
          style="
            left:${x * tileSize - left}px;
            top:${y * tileSize - top}px;
          "
        />
      `;
    }
  }

  tilesElement.innerHTML = html;
}


function worldPixel(longitude, latitude, zoom) {
  const worldSize =
    CONFIG.tileSize * 2 ** zoom;

  const clampedLatitude = Math.max(
    -85.0511,
    Math.min(85.0511, latitude),
  );

  const x =
    ((longitude + 180) / 360) * worldSize;

  const y =
    ((1 -
      Math.log(
        Math.tan(
          degreesToRadians(clampedLatitude),
        ) +
          1 /
            Math.cos(
              degreesToRadians(clampedLatitude),
            ),
      ) /
        Math.PI) /
      2) *
    worldSize;

  return {
    x,
    y,
    worldSize,
  };
}


function recordScreenPoint(
  record,
  center,
  left,
  top,
  zoom,
) {
  const point = worldPixel(
    record.displayLongitude,
    record.displayLatitude,
    zoom,
  );

  /*
   * Select the copy of the point nearest the map center
   * when crossing the international date line.
   */
  while (
    point.x - center.x >
    point.worldSize / 2
  ) {
    point.x -= point.worldSize;
  }

  while (
    point.x - center.x <
    -point.worldSize / 2
  ) {
    point.x += point.worldSize;
  }

  return {
    x: point.x - left,
    y: point.y - top,
  };
}


function createRouteSvg(records, screenPoint) {
  let svg = "";

  for (
    let index = 1;
    index < records.length;
    index += 1
  ) {
    const start = records[index - 1];
    const end = records[index];

    const startPoint = screenPoint(start);
    const endPoint = screenPoint(end);

    const estimatedMethods = [
      "interpolated",
      "partially-interpolated",
    ];

    const isEstimated =
      estimatedMethods.includes(
        start.positionMethod,
      ) ||
      estimatedMethods.includes(
        end.positionMethod,
      );

    const coordinates =
      `x1="${startPoint.x}" ` +
      `y1="${startPoint.y}" ` +
      `x2="${endPoint.x}" ` +
      `y2="${endPoint.y}"`;

    svg += `
      <line
        class="route-underlay"
        ${coordinates}
      />
    `;

    svg += `
      <line
        class="route-segment${
          isEstimated ? " estimated" : ""
        }"
        ${coordinates}
      />
    `;
  }

  return svg;
}


/*
 * Consecutive entries from one port visit share one marker.
 * All individual dates remain selectable in the side panel.
 */
function groupPortMarkers(positionedRecords) {
  const markers = [];

  for (const record of positionedRecords) {
    const previousMarker =
      markers[markers.length - 1];

    const joinsPreviousPort =
      record.place === "port" &&
      previousMarker?.place === "port" &&
      previousMarker.lastSourceIndex + 1 ===
        record.sourceIndex &&
      distanceNauticalMiles(
        previousMarker.displayLatitude,
        previousMarker.displayLongitude,
        record.displayLatitude,
        record.displayLongitude,
      ) < 1;

    if (joinsPreviousPort) {
      previousMarker.records.push(record);

      previousMarker.lastSourceIndex =
        record.sourceIndex;
    } else {
      markers.push({
        place: record.place,
        displayLatitude:
          record.displayLatitude,
        displayLongitude:
          record.displayLongitude,
        positionMethod:
          record.positionMethod,
        records: [record],
        lastSourceIndex:
          record.sourceIndex,
      });
    }
  }

  return markers;
}


function createMarkerSvg(
  markers,
  selectedRecord,
  screenPoint,
) {
  return markers
    .map((marker) => {
      const point = screenPoint(marker);

      const recordIds = marker.records.map(
        (record) => record.id,
      );

      const isSelected = recordIds.includes(
        selectedRecord?.id,
      );

      const isEstimated = [
        "interpolated",
        "partially-interpolated",
      ].includes(marker.positionMethod);

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
            points="
              0,-12 3,-4 11,-3 5,2 7,11
              0,6 -7,11 -5,2 -11,-3 -3,-4
            "
            transform="
              translate(${point.x} ${point.y})
            "
          />
        `;
      } else {
        shape = `
          <circle
            cx="${point.x}"
            cy="${point.y}"
            r="${isSelected ? 9 : 7}"
          />
        `;
      }

      const label =
        marker.place === "port" &&
        marker.records.length > 1
          ? `
            <text
              class="port-count"
              x="${point.x + 11}"
              y="${point.y - 9}"
            >
              ${marker.records.length}
            </text>
          `
          : `
            <text
              x="${point.x}"
              y="${point.y + 3}"
            >
              ${marker.records[0].day}
            </text>
          `;

      return `
        <g
          class="${classes}"
          data-record-ids="${escapeHtml(
            recordIds.join(","),
          )}"
        >
          ${shape}
          ${label}
        </g>
      `;
    })
    .join("");
}


function selectMarkerRecord(
  recordIdsText,
  currentRecord,
) {
  const recordIds = recordIdsText.split(",");

  const selectedId = recordIds.includes(
    currentRecord?.id,
  )
    ? currentRecord.id
    : recordIds[0];

  selectRecordById(selectedId);
}


function installMapControls(
  mapElement,
  allRecords,
  selectedRecord,
) {
  let dragging = false;
  let dragStart;
  let startingMapState;
  let wheelAccumulator = 0;

  mapElement.addEventListener(
    "wheel",
    (event) => {
      event.preventDefault();

      wheelAccumulator += event.deltaY;

      if (Math.abs(wheelAccumulator) < 180) {
        return;
      }

      state.map.zoom = Math.max(
        CONFIG.minimumZoom,
        Math.min(
          CONFIG.maximumZoom,
          state.map.zoom +
            (wheelAccumulator < 0 ? 1 : -1),
        ),
      );

      wheelAccumulator = 0;

      paintMap(allRecords, selectedRecord);
    },
    {
      passive: false,
    },
  );

  mapElement.addEventListener(
    "pointerdown",
    (event) => {
      if (
        event.button !== 0 ||
        event.target.closest(".map-marker")
      ) {
        return;
      }

      dragging = true;

      dragStart = {
        x: event.clientX,
        y: event.clientY,
      };

      startingMapState = {
        ...state.map,
      };

      mapElement.setPointerCapture(
        event.pointerId,
      );

      mapElement.classList.add("dragging");
    },
  );

  mapElement.addEventListener(
    "pointermove",
    (event) => {
      if (!dragging) {
        return;
      }

      const startingCenter = worldPixel(
        startingMapState.longitude,
        startingMapState.latitude,
        startingMapState.zoom,
      );

      const movedCenter = {
        x:
          startingCenter.x -
          (event.clientX - dragStart.x),

        y:
          startingCenter.y -
          (event.clientY - dragStart.y),

        worldSize: startingCenter.worldSize,
      };

      state.map.longitude =
        (movedCenter.x /
          movedCenter.worldSize) *
          360 -
        180;

      const mercatorLatitude =
        Math.PI *
        (1 -
          (2 * movedCenter.y) /
            movedCenter.worldSize);

      state.map.latitude = radiansToDegrees(
        Math.atan(
          Math.sinh(mercatorLatitude),
        ),
      );

      paintMap(allRecords, selectedRecord);
    },
  );

  function stopDragging() {
    dragging = false;
    mapElement.classList.remove("dragging");
  }

  mapElement.addEventListener(
    "pointerup",
    stopDragging,
  );

  mapElement.addEventListener(
    "pointercancel",
    stopDragging,
  );
}


// ============================================================
// 10. Calendar
// ============================================================

function drawCalendar(allRecords, selectedRecord) {
  const datedRecords = allRecords
    .filter((record) => record.dateObject)
    .sort(
      (first, second) =>
        first.dateObject - second.dateObject,
    );

  if (!datedRecords.length) {
    elements.view.className =
      "view empty-state";

    elements.view.innerHTML = `
      <div>
        <h2>No machine-readable dates</h2>
        <p>
          Use dates such as October 15, 1850.
        </p>
      </div>
    `;

    return;
  }

  const recordsByDate = new Map(
    datedRecords.map((record) => [
      dateKey(record.dateObject),
      record,
    ]),
  );

  const firstDate =
    datedRecords[0].dateObject;

  const lastDate =
    datedRecords[
      datedRecords.length - 1
    ].dateObject;

  const firstMonth = new Date(
    firstDate.getFullYear(),
    firstDate.getMonth(),
    1,
  );

  const lastMonth = new Date(
    lastDate.getFullYear(),
    lastDate.getMonth(),
    1,
  );

  let calendarHtml = "";

  for (
    const month = new Date(firstMonth);
    month <= lastMonth;
    month.setMonth(month.getMonth() + 1)
  ) {
    calendarHtml += createMonthHtml(
      month,
      recordsByDate,
      selectedRecord,
    );
  }

  elements.view.className = "view calendar";
  elements.view.innerHTML = calendarHtml;

  elements.view
    .querySelectorAll("[data-record-id]")
    .forEach((button) => {
      button.addEventListener("click", () => {
        selectRecordById(
          button.dataset.recordId,
        );
      });
    });
}


function createMonthHtml(
  month,
  recordsByDate,
  selectedRecord,
) {
  const year = month.getFullYear();
  const monthIndex = month.getMonth();

  const daysInMonth = new Date(
    year,
    monthIndex + 1,
    0,
  ).getDate();

  let dayCells = "";

  const firstWeekday = new Date(
    year,
    monthIndex,
    1,
  ).getDay();

  for (
    let blank = 0;
    blank < firstWeekday;
    blank += 1
  ) {
    dayCells += `
      <button
        class="day blank"
        type="button"
        disabled
      ></button>
    `;
  }

  for (
    let dayNumber = 1;
    dayNumber <= daysInMonth;
    dayNumber += 1
  ) {
    const date = new Date(
      year,
      monthIndex,
      dayNumber,
      12,
    );

    const record =
      recordsByDate.get(dateKey(date));

    const summary = record
      ? (
          record.nature[0] ||
          record.ships[0] ||
          record.note ||
          record.matesEntry
        ).slice(0, 60)
      : "No entry loaded";

    dayCells += `
      <button
        type="button"
        ${
          record
            ? `data-record-id="${escapeHtml(
                record.id,
              )}"`
            : "disabled"
        }
        class="
          day
          ${record ? "" : "missing"}
          ${
            record?.id === selectedRecord?.id
              ? "active"
              : ""
          }
        "
      >
        <b>${dayNumber}</b>
        <span>${escapeHtml(summary)}</span>
      </button>
    `;
  }

  const monthLabel =
    new Intl.DateTimeFormat("en", {
      month: "long",
      year: "numeric",
    }).format(month);

  return `
    <section class="month">
      <h3>${monthLabel}</h3>

      <div class="weekday-row">
        ${[
          "Sun",
          "Mon",
          "Tue",
          "Wed",
          "Thu",
          "Fri",
          "Sat",
        ]
          .map(
            (weekday) =>
              `<span>${weekday}</span>`,
          )
          .join("")}
      </div>

      <div class="days">
        ${dayCells}
      </div>
    </section>
  `;
}


function dateKey(date) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(
      2,
      "0",
    ),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}


// ============================================================
// 11. Side panel and entry comparison
// ============================================================

function renderDetails(
  record,
  visibleRecords,
  allRecords,
) {
  if (!record) {
    elements.details.innerHTML = `
      <div class="empty-state">
        <p>No matching records.</p>
      </div>
    `;

    return;
  }

  const previousPosition =
    findPreviousMappedRecord(
      allRecords,
      record.sourceIndex,
    );

  let legDistance = 0;

  if (
    previousPosition &&
    hasDisplayPosition(record)
  ) {
    legDistance = distanceNauticalMiles(
      previousPosition.displayLatitude,
      previousPosition.displayLongitude,
      record.displayLatitude,
      record.displayLongitude,
    );
  }

  let elapsedDays = 1;

  if (
    previousPosition?.dateObject &&
    record.dateObject
  ) {
    elapsedDays = Math.max(
      1,
      Math.round(
        (record.dateObject -
          previousPosition.dateObject) /
          86400000,
      ),
    );
  }

  const metricsAreEstimated =
    Boolean(previousPosition) &&
    (
      !hasRecordedPosition(previousPosition) ||
      !hasRecordedPosition(record)
    );

  const portVisit =
    findPortVisit(allRecords, record);

  elements.details.innerHTML = `
    <div class="record-nav">
      <button
        id="previous-record"
        type="button"
        ${
          state.selectedRecordIndex === 0
            ? "disabled"
            : ""
        }
      >
        ‹
      </button>

      <span>
        Record
        ${state.selectedRecordIndex + 1}
        of
        ${visibleRecords.length}
      </span>

      <button
        id="next-record"
        type="button"
        ${
          state.selectedRecordIndex >=
          visibleRecords.length - 1
            ? "disabled"
            : ""
        }
      >
        ›
      </button>
    </div>

    <p class="eyebrow">
      ${positionTypeLabel(record)}
    </p>

    <h2>${escapeHtml(record.date)}</h2>

    ${createCoordinateHtml(record)}

    ${
      record.positionNote
        ? `
          <p class="estimate-note">
            <strong>Map position:</strong>
            ${escapeHtml(record.positionNote)}
          </p>
        `
        : ""
    }

    ${createPortVisitHtml(portVisit, record)}

    ${
      hasDisplayPosition(record)
        ? createMetricsHtml(
            record,
            previousPosition,
            legDistance,
            elapsedDays,
            metricsAreEstimated,
          )
        : ""
    }

    ${createObservationsHtml(record)}

    ${
      record.note
        ? `
          <p class="editorial-note">
            ${escapeHtml(record.note)}
          </p>
        `
        : ""
    }

    <div class="entry">
      <h3>Mate’s log</h3>

      <blockquote>
        ${escapeHtml(record.matesEntry)}
      </blockquote>
    </div>

    ${
      record.captainsEntry
        ? `
          <div class="entry">
            <h3>Captain’s log</h3>

            <blockquote>
              ${escapeHtml(
                record.captainsEntry,
              )}
            </blockquote>
          </div>
        `
        : ""
    }

    ${
      record.comparisonNote
        ? `
          <div class="entry">
            <h3>Comparison note</h3>

            <p class="editorial-note">
              ${escapeHtml(
                record.comparisonNote,
              )}
            </p>
          </div>
        `
        : ""
    }
  `;

  document
    .getElementById("previous-record")
    .addEventListener("click", () => {
      state.selectedRecordIndex -= 1;
      render();
    });

  document
    .getElementById("next-record")
    .addEventListener("click", () => {
      state.selectedRecordIndex += 1;
      render();
    });

  elements.details
    .querySelectorAll("[data-port-record-id]")
    .forEach((button) => {
      button.addEventListener("click", () => {
        selectRecordById(
          button.dataset.portRecordId,
        );
      });
    });
}


function positionTypeLabel(record) {
  if (record.place === "port") {
    return "Port record";
  }

  if (
    record.positionMethod ===
    "partially-interpolated"
  ) {
    return "Partially estimated position at sea";
  }

  if (
    record.positionMethod === "interpolated"
  ) {
    return "Estimated position at sea";
  }

  if (hasRecordedPosition(record)) {
    return "Recorded position at sea";
  }

  return "Source record";
}


function createCoordinateHtml(record) {
  let latitudeText;
  let longitudeText;

  if (record.latitude !== undefined) {
    latitudeText = record.latitudeLabel;
  } else if (hasDisplayPosition(record)) {
    latitudeText =
      `Estimated ` +
      formatCoordinate(
        record.displayLatitude,
        "latitude",
      );
  } else {
    latitudeText = "No latitude recorded";
  }

  if (record.longitude !== undefined) {
    longitudeText = record.longitudeLabel;
  } else if (hasDisplayPosition(record)) {
    longitudeText =
      `Estimated ` +
      formatCoordinate(
        record.displayLongitude,
        "longitude",
      );
  } else {
    longitudeText = "No longitude recorded";
  }

  return `
    <div class="coordinate-labels">
      <span>${escapeHtml(latitudeText)}</span>
      <span>${escapeHtml(longitudeText)}</span>
    </div>
  `;
}


function createMetricsHtml(
  record,
  previousPosition,
  legDistance,
  elapsedDays,
  isEstimated,
) {
  const prefix = isEstimated
    ? "Estimated "
    : "";

  const distanceText = previousPosition
    ? `${Math.round(legDistance)} nmi`
    : "Departure";

  const speedText = previousPosition
    ? `${(
        legDistance /
        (24 * elapsedDays)
      ).toFixed(1)} kn`
    : "—";

  return `
    <div class="metrics">
      <div>
        <small>
          ${prefix}from prior mapped position
        </small>

        <b>${distanceText}</b>
      </div>

      <div>
        <small>
          ${prefix}average speed
        </small>

        <b>${speedText}</b>
      </div>

      <div>
        <small>Course</small>
        <b>${escapeHtml(record.course)}</b>
      </div>
    </div>
  `;
}


function findPreviousMappedRecord(
  allRecords,
  startingIndex,
) {
  for (
    let index = startingIndex - 1;
    index >= 0;
    index -= 1
  ) {
    if (hasDisplayPosition(allRecords[index])) {
      return allRecords[index];
    }
  }

  return null;
}


function createObservationsHtml(record) {
  const shipsHtml = record.ships.length
    ? `
      <div>
        <b>Ships</b>
        ${escapeHtml(record.ships.join("; "))}
      </div>
    `
    : "";

  const natureHtml = record.nature.length
    ? `
      <div>
        <b>Animals &amp; plants</b>
        ${escapeHtml(record.nature.join("; "))}
      </div>
    `
    : "";

  if (!shipsHtml && !natureHtml) {
    return "";
  }

  return `
    <div class="observations">
      ${shipsHtml}
      ${natureHtml}
    </div>
  `;
}


// ============================================================
// 12. Port visits
// ============================================================

function findPortVisit(
  allRecords,
  selectedRecord,
) {
  if (
    selectedRecord.place !== "port" ||
    !hasDisplayPosition(selectedRecord)
  ) {
    return [];
  }

  let startIndex = selectedRecord.sourceIndex;
  let endIndex = selectedRecord.sourceIndex;

  while (
    startIndex > 0 &&
    recordsSharePortVisit(
      allRecords[startIndex - 1],
      selectedRecord,
    )
  ) {
    startIndex -= 1;
  }

  while (
    endIndex + 1 < allRecords.length &&
    recordsSharePortVisit(
      allRecords[endIndex + 1],
      selectedRecord,
    )
  ) {
    endIndex += 1;
  }

  return allRecords.slice(
    startIndex,
    endIndex + 1,
  );
}


function recordsSharePortVisit(
  candidate,
  selectedRecord,
) {
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


function createPortVisitHtml(
  portVisit,
  selectedRecord,
) {
  if (portVisit.length <= 1) {
    return "";
  }

  const firstRecord = portVisit[0];

  const lastRecord =
    portVisit[portVisit.length - 1];

  const label =
    firstRecord.placeName ||
    selectedRecord.placeName ||
    "Port visit";

  return `
    <div class="port-visit">
      <strong>
        ${escapeHtml(label)}
        ·
        ${portVisit.length} entries
      </strong>

      <br>

      ${escapeHtml(firstRecord.shortDate)}
      –
      ${escapeHtml(lastRecord.shortDate)}

      <div class="port-date-list">
        ${portVisit
          .map(
            (record) => `
              <button
                type="button"
                data-port-record-id="${escapeHtml(
                  record.id,
                )}"
                class="${
                  record.id === selectedRecord.id
                    ? "active"
                    : ""
                }"
              >
                ${escapeHtml(record.shortDate)}
              </button>
            `,
          )
          .join("")}
      </div>
    </div>
  `;
}


// ============================================================
// 13. Record selection and distance calculations
// ============================================================

function selectRecordById(recordId) {
  const records = getVisibleRecords();

  const index = records.findIndex(
    (record) => record.id === recordId,
  );

  if (index >= 0) {
    state.selectedRecordIndex = index;
    render();
  }
}


function distanceNauticalMiles(
  latitude1,
  longitude1,
  latitude2,
  longitude2,
) {
  const earthRadiusNauticalMiles = 3440.065;

  const latitudeDifference =
    degreesToRadians(
      latitude2 - latitude1,
    );

  const longitudeDifference =
    degreesToRadians(
      longitude2 - longitude1,
    );

  const haversine =
    Math.sin(latitudeDifference / 2) ** 2 +
    Math.cos(degreesToRadians(latitude1)) *
      Math.cos(degreesToRadians(latitude2)) *
      Math.sin(longitudeDifference / 2) ** 2;

  return (
    2 *
    earthRadiusNauticalMiles *
    Math.asin(Math.sqrt(haversine))
  );
}


// ============================================================
// 14. Browser storage
// ============================================================

function showStatus(message) {
  elements.status.textContent = message;
  elements.status.classList.add("visible");
}


function saveDatasets() {
  try {
    localStorage.setItem(
      CONFIG.storageKey,
      JSON.stringify(state.datasets),
    );
  } catch (error) {
    console.warn(
      "The browser could not save the datasets.",
      error,
    );
  }
}


function restoreSavedDatasets() {
  try {
    state.datasets = JSON.parse(
      localStorage.getItem(
        CONFIG.storageKey,
      ) || "[]",
    );

    for (const dataset of state.datasets) {
      for (const record of dataset.records) {
        record.dateObject =
          parseDate(record.date);

        /*
         * Support records saved by an earlier version
         * that used the property name "entry."
         */
        if (!record.matesEntry && record.entry) {
          record.matesEntry = record.entry;
        }
      }

      assignDisplayPositions(dataset.records);
    }
  } catch (error) {
    console.warn(
      "Saved data could not be restored.",
      error,
    );

    state.datasets = [];
  }
}


// ============================================================
// 15. Load the published GitHub CSV
// ============================================================

async function loadPublishedCsv() {
  const response = await fetch(
    CONFIG.csvPath,
    {
      cache: "no-store",
    },
  );

  if (!response.ok) {
    throw new Error(
      `HTTP ${response.status}`,
    );
  }

  const csvText = await response.text();

  const publishedDataset = createDataset(
    csvText,
    CONFIG.csvFilename,
  );

  /*
   * Remove an older cached copy of the same CSV.
   */
  state.datasets = state.datasets.filter(
    (dataset) =>
      dataset.filename !== CONFIG.csvFilename,
  );

  state.datasets.unshift(
    publishedDataset,
  );

  state.activeDatasetId =
    publishedDataset.id;

  state.selectedRecordIndex = 0;

  saveDatasets();
}


// ============================================================
// 16. Page controls
// ============================================================

elements.files.addEventListener(
  "change",
  async (event) => {
    const addedDatasets = [];

    for (const file of event.target.files) {
      try {
        const csvText = await file.text();

        addedDatasets.push(
          createDataset(csvText, file.name),
        );
      } catch (error) {
        showStatus(error.message);
      }
    }

    if (addedDatasets.length) {
      state.datasets.push(...addedDatasets);

      state.activeDatasetId =
        addedDatasets[0].id;

      state.selectedRecordIndex = 0;

      saveDatasets();

      showStatus(
        `Added ${addedDatasets
          .map((dataset) => dataset.name)
          .join(", ")}`,
      );

      render();
    }

    event.target.value = "";
  },
);


elements.source.addEventListener(
  "change",
  (event) => {
    state.activeDatasetId =
      event.target.value;

    state.selectedRecordIndex = 0;

    render();
  },
);


elements.search.addEventListener(
  "input",
  (event) => {
    state.searchText = event.target.value;
    state.selectedRecordIndex = 0;

    render();
  },
);


elements.remove.addEventListener(
  "click",
  () => {
    state.datasets = state.datasets.filter(
      (dataset) =>
        dataset.id !==
        state.activeDatasetId,
    );

    state.activeDatasetId =
      state.datasets[0]?.id || "";

    state.selectedRecordIndex = 0;

    saveDatasets();
    render();
  },
);


elements.mapTab.addEventListener(
  "click",
  () => {
    state.mode = "map";
    render();
  },
);


elements.calendarTab.addEventListener(
  "click",
  () => {
    state.mode = "calendar";
    render();
  },
);


// ============================================================
// 17. Start the website
// ============================================================

async function initializeSite() {
  restoreSavedDatasets();

  try {
    await loadPublishedCsv();
  } catch (error) {
    showStatus(
      `Could not load ${CONFIG.csvPath}: ` +
      `${error.message}. ` +
      `The website must be opened through ` +
      `GitHub Pages or another web server.`,
    );

    state.activeDatasetId =
      state.datasets[0]?.id || "";
  }

  render();
}


initializeSite();
