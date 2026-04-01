export interface PlayableAreaMetrics {
  playableAreaKm2: number;
  playableAreaPerPointKm2: number;
  playableCatchmentRadiusKm: number;
}

export interface PlayableAreaLocation {
  longitude: number;
  latitude: number;
}

interface ProjectedPoint {
  xKm: number;
  yKm: number;
}

const DEGREES_TO_RADIANS = Math.PI / 180;
const EARTH_RADIUS_KM = 6371.0088;
const KILOMETERS_PER_DEGREE = (Math.PI * EARTH_RADIUS_KM) / 180;
const PLAYABLE_AREA_CELL_SIZES_KM = [4, 2, 1] as const;
const NEIGHBOR_OFFSETS = [-1, 0, 1] as const;

function cellKey(x: number, y: number): string {
  return `${x},${y}`;
}

function parseCellKey(key: string): [number, number] {
  const [x, y] = key.split(",", 2).map((part) => Number.parseInt(part, 10));
  return [x, y];
}

function intersectSets(a: Set<string>, b: Set<string>): Set<string> {
  const intersection = new Set<string>();
  const [smaller, larger] = a.size <= b.size ? [a, b] : [b, a];
  for (const key of smaller) {
    if (larger.has(key)) intersection.add(key);
  }
  return intersection;
}

function projectLocations(locations: PlayableAreaLocation[]): ProjectedPoint[] {
  if (locations.length === 0) return [];

  const meanLatitudeRadians = (
    locations.reduce((sum, location) => sum + location.latitude, 0) / locations.length
  ) * DEGREES_TO_RADIANS;
  const lonScaleKm = KILOMETERS_PER_DEGREE * Math.cos(meanLatitudeRadians);
  const latScaleKm = KILOMETERS_PER_DEGREE;

  return locations.map((location) => ({
    xKm: location.longitude * lonScaleKm,
    yKm: location.latitude * latScaleKm,
  }));
}

function buildOccupiedCells(
  points: ProjectedPoint[],
  originXKm: number,
  originYKm: number,
  cellSizeKm: number,
): Set<string> {
  const occupied = new Set<string>();
  for (const point of points) {
    const cellX = Math.floor((point.xKm - originXKm) / cellSizeKm);
    const cellY = Math.floor((point.yKm - originYKm) / cellSizeKm);
    occupied.add(cellKey(cellX, cellY));
  }
  return occupied;
}

function closeOccupiedCells(
  occupied: Set<string>,
  allowedCells?: Set<string>,
): Set<string> {
  if (occupied.size === 0) return new Set<string>();

  const dilated = new Set<string>();
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
  const closed = new Set<string>();
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

function buildChildCellUniverse(
  parentCells: Set<string>,
  parentCellSizeKm: number,
  childCellSizeKm: number,
): Set<string> {
  const ratio = parentCellSizeKm / childCellSizeKm;
  if (!Number.isInteger(ratio) || ratio <= 0) {
    throw new Error(`Invalid playable-area refinement ratio ${parentCellSizeKm}/${childCellSizeKm}`);
  }

  const universe = new Set<string>();
  for (const key of parentCells) {
    const [parentX, parentY] = parseCellKey(key);
    const childOriginX = parentX * ratio;
    const childOriginY = parentY * ratio;
    for (let dx = 0; dx < ratio; dx += 1) {
      for (let dy = 0; dy < ratio; dy += 1) {
        universe.add(cellKey(childOriginX + dx, childOriginY + dy));
      }
    }
  }
  return universe;
}

export function computePlayableAreaMetrics(locations: PlayableAreaLocation[]): PlayableAreaMetrics {
  const pointCount = locations.length;
  if (pointCount === 0) {
    return {
      playableAreaKm2: 0,
      playableAreaPerPointKm2: 0,
      playableCatchmentRadiusKm: 0,
    };
  }

  const projectedPoints = projectLocations(locations);
  const minXKm = Math.min(...projectedPoints.map((point) => point.xKm));
  const minYKm = Math.min(...projectedPoints.map((point) => point.yKm));

  let occupiedCells = closeOccupiedCells(
    buildOccupiedCells(projectedPoints, minXKm, minYKm, PLAYABLE_AREA_CELL_SIZES_KM[0]),
  );

  for (let index = 1; index < PLAYABLE_AREA_CELL_SIZES_KM.length; index += 1) {
    const parentSizeKm = PLAYABLE_AREA_CELL_SIZES_KM[index - 1]!;
    const childSizeKm = PLAYABLE_AREA_CELL_SIZES_KM[index]!;
    const allowedCells = buildChildCellUniverse(occupiedCells, parentSizeKm, childSizeKm);
    const rawChildCells = buildOccupiedCells(projectedPoints, minXKm, minYKm, childSizeKm);
    occupiedCells = closeOccupiedCells(intersectSets(rawChildCells, allowedCells), allowedCells);
  }

  const finalCellSizeKm = PLAYABLE_AREA_CELL_SIZES_KM[PLAYABLE_AREA_CELL_SIZES_KM.length - 1]!;
  const playableAreaKm2 = occupiedCells.size * (finalCellSizeKm ** 2);
  const playableAreaPerPointKm2 = playableAreaKm2 / pointCount;
  const playableCatchmentRadiusKm = Math.sqrt(playableAreaPerPointKm2 / Math.PI);

  return {
    playableAreaKm2,
    playableAreaPerPointKm2,
    playableCatchmentRadiusKm,
  };
}
