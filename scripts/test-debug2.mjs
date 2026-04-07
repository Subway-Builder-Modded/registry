const DEGREES_TO_RADIANS = Math.PI / 180;
const EARTH_RADIUS_KM = 6371.0088;
const KILOMETERS_PER_DEGREE = (Math.PI * EARTH_RADIUS_KM) / 180;
const PLAYABLE_AREA_CELL_SIZES_KM = [4, 2, 1];
const NEIGHBOR_OFFSETS = [-1, 0, 1];

function cellKey(x, y) {
  return `${x},${y}`;
}

function parseCellKey(key) {
  const [x, y] = key.split(",", 2).map((part) => Number.parseInt(part, 10));
  return [x, y];
}

function projectLocations(locations) {
  if (locations.length === 0) {
    return {
      points: [],
      projection: {
        originXKm: 0,
        originYKm: 0,
        lonScaleKm: KILOMETERS_PER_DEGREE,
        latScaleKm: KILOMETERS_PER_DEGREE,
      },
    };
  }

  const meanLatitudeRadians = (
    locations.reduce((sum, location) => sum + location.latitude, 0) / locations.length
  ) * DEGREES_TO_RADIANS;
  const lonScaleKm = Math.max(
    KILOMETERS_PER_DEGREE * Math.cos(meanLatitudeRadians),
    KILOMETERS_PER_DEGREE * 1e-6,
  );
  const latScaleKm = KILOMETERS_PER_DEGREE;

  const points = locations.map((location) => ({
    xKm: location.longitude * lonScaleKm,
    yKm: location.latitude * latScaleKm,
  }));

  return {
    points,
    projection: {
      originXKm: Math.min(...points.map((point) => point.xKm)),
      originYKm: Math.min(...points.map((point) => point.yKm)),
      lonScaleKm,
      latScaleKm,
    },
  };
}

function buildOccupiedCells(points, originXKm, originYKm, cellSizeKm) {
  const occupied = new Set();
  for (const point of points) {
    const cellX = Math.floor((point.xKm - originXKm) / cellSizeKm);
    const cellY = Math.floor((point.yKm - originYKm) / cellSizeKm);
    console.log(`Point (${point.xKm}, ${point.yKm}) - origin (${originXKm}, ${originYKm}) -> cell (${cellX}, ${cellY})`);
    occupied.add(cellKey(cellX, cellY));
  }
  return occupied;
}

function closeOccupiedCells(occupied) {
  if (occupied.size === 0) return new Set();

  const dilated = new Set();
  for (const key of occupied) {
    const [x, y] = parseCellKey(key);
    for (const dx of NEIGHBOR_OFFSETS) {
      for (const dy of NEIGHBOR_OFFSETS) {
        const neighborKey = cellKey(x + dx, y + dy);
        dilated.add(neighborKey);
      }
    }
  }

  const closed = new Set();
  for (const key of dilated) {
    const [x, y] = parseCellKey(key);
    let keep = true;
    for (const dx of NEIGHBOR_OFFSETS) {
      for (const dy of NEIGHBOR_OFFSETS) {
        const neighborKey = cellKey(x + dx, y + dy);
        if (!dilated.has(neighborKey)) {
          keep = false;
          break;
        }
      }
      if (!keep) break;
    }
    if (keep) closed.add(key);
  }

  console.log("Dilated:", dilated);
  console.log("Closed:", closed);
  return closed.size > 0 ? closed : occupied;
}

// Test with single point at (0, 0)
const { points, projection } = projectLocations([{ longitude: 0, latitude: 0 }]);
console.log("Points:", points);
console.log("Projection:", projection);

const occupied = buildOccupiedCells(points, projection.originXKm, projection.originYKm, 4);
console.log("Occupied:", occupied);

const closed = closeOccupiedCells(occupied);
console.log("Final closed:", closed);
console.log("Final size:", closed.size);
console.log("Expected: 4 cells at 1km scale");
