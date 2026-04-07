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

function buildOccupiedCells(points, originXKm, originYKm, cellSizeKm) {
  const occupied = new Set();
  for (const point of points) {
    const cellX = Math.floor((point.xKm - originXKm) / cellSizeKm);
    const cellY = Math.floor((point.yKm - originYKm) / cellSizeKm);
    occupied.add(cellKey(cellX, cellY));
  }
  return occupied;
}

function closeOccupiedCells(occupied, allowedCells) {
  if (occupied.size === 0) return new Set();

  const dilated = new Set();
  for (const key of occupied) {
    const [x, y] = parseCellKey(key);
    for (const dx of NEIGHBOR_OFFSETS) {
      for (const dy of NEIGHBOR_OFFSETS) {
        const neighborKey = cellKey(x + dx, y + dy);
        if (allowedCells && !allowedCells.has(neighborKey)) continue;
        dilated.add(neighborKey);
      }
    }
  }

  const candidateCells = allowedCells ?? dilated;
  const closed = new Set();
  for (const key of candidateCells) {
    const [x, y] = parseCellKey(key);
    let keep = true;
    for (const dx of NEIGHBOR_OFFSETS) {
      for (const dy of NEIGHBOR_OFFSETS) {
        const neighborKey = cellKey(x + dx, y + dy);
        if (allowedCells && !allowedCells.has(neighborKey)) continue;
        if (!dilated.has(neighborKey)) {
          keep = false;
          break;
        }
      }
      if (!keep) break;
    }
    if (keep) closed.add(key);
  }

  return closed.size > 0 ? closed : occupied;
}

// Test with single point at (0, 0)
const points = [{xKm: 0, yKm: 0}];
const originXKm = 0;
const originYKm = 0;
const coarseCellSizeKm = 4;

const occupied = buildOccupiedCells(points, originXKm, originYKm, coarseCellSizeKm);
console.log("Occupied cells (4km):", occupied);

const closed = closeOccupiedCells(occupied);
console.log("Closed cells (4km):", closed);
console.log("Closed size:", closed.size);
console.log("Expected: 9 cells (3x3), got:", closed.size);
