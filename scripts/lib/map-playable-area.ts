import type { Feature, FeatureCollection, GeoJsonProperties, Polygon } from "geojson";

export interface PlayableAreaMetrics {
  playableAreaKm2: number;
  playableAreaPerPointKm2: number;
  playableCatchmentRadiusKm: number;
}

export interface PlayableAreaLocation {
  longitude: number;
  latitude: number;
}

export interface PlayableAreaDebugProperties {
  stage: "raw" | "closed";
  cellSizeKm: number;
  isFinalPlayableArea: boolean;
}

export interface PlayableAreaDebugResult {
  metrics: PlayableAreaMetrics;
  finalPlayableArea: FeatureCollection<Polygon, PlayableAreaDebugProperties>;
  stagedCells: FeatureCollection<Polygon, PlayableAreaDebugProperties>;
}

interface ProjectedPoint {
  xKm: number;
  yKm: number;
}

interface ProjectionContext {
  originXKm: number;
  originYKm: number;
  lonScaleKm: number;
  latScaleKm: number;
}

interface PlayableAreaState {
  metrics: PlayableAreaMetrics;
  projection: ProjectionContext;
  finalCellSizeKm: number;
  finalCells: Set<string>;
  stagedCells: Array<{
    stage: "raw" | "closed";
    cellSizeKm: number;
    cells: Set<string>;
  }>;
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

function projectLocations(
  locations: PlayableAreaLocation[],
): {
  points: ProjectedPoint[];
  projection: ProjectionContext;
} {
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

function computePlayableAreaState(locations: PlayableAreaLocation[]): PlayableAreaState {
  const pointCount = locations.length;
  if (pointCount === 0) {
    return {
      metrics: {
        playableAreaKm2: 0,
        playableAreaPerPointKm2: 0,
        playableCatchmentRadiusKm: 0,
      },
      projection: {
        originXKm: 0,
        originYKm: 0,
        lonScaleKm: KILOMETERS_PER_DEGREE,
        latScaleKm: KILOMETERS_PER_DEGREE,
      },
      finalCellSizeKm: PLAYABLE_AREA_CELL_SIZES_KM[PLAYABLE_AREA_CELL_SIZES_KM.length - 1]!,
      finalCells: new Set<string>(),
      stagedCells: [],
    };
  }

  const { points: projectedPoints, projection } = projectLocations(locations);
  const stagedCells: PlayableAreaState["stagedCells"] = [];

  const coarseCellSizeKm = PLAYABLE_AREA_CELL_SIZES_KM[0]!;
  let occupiedCells = buildOccupiedCells(
    projectedPoints,
    projection.originXKm,
    projection.originYKm,
    coarseCellSizeKm,
  );
  stagedCells.push({
    stage: "raw",
    cellSizeKm: coarseCellSizeKm,
    cells: new Set(occupiedCells),
  });
  occupiedCells = closeOccupiedCells(occupiedCells);
  stagedCells.push({
    stage: "closed",
    cellSizeKm: coarseCellSizeKm,
    cells: new Set(occupiedCells),
  });

  for (let index = 1; index < PLAYABLE_AREA_CELL_SIZES_KM.length; index += 1) {
    const parentSizeKm = PLAYABLE_AREA_CELL_SIZES_KM[index - 1]!;
    const childSizeKm = PLAYABLE_AREA_CELL_SIZES_KM[index]!;
    const allowedCells = buildChildCellUniverse(occupiedCells, parentSizeKm, childSizeKm);
    const rawChildCells = intersectSets(
      buildOccupiedCells(projectedPoints, projection.originXKm, projection.originYKm, childSizeKm),
      allowedCells,
    );
    stagedCells.push({
      stage: "raw",
      cellSizeKm: childSizeKm,
      cells: new Set(rawChildCells),
    });
    occupiedCells = closeOccupiedCells(rawChildCells, allowedCells);
    stagedCells.push({
      stage: "closed",
      cellSizeKm: childSizeKm,
      cells: new Set(occupiedCells),
    });
  }

  const finalCellSizeKm = PLAYABLE_AREA_CELL_SIZES_KM[PLAYABLE_AREA_CELL_SIZES_KM.length - 1]!;
  const playableAreaKm2 = occupiedCells.size * (finalCellSizeKm ** 2);
  const playableAreaPerPointKm2 = playableAreaKm2 / pointCount;
  const playableCatchmentRadiusKm = Math.sqrt(playableAreaPerPointKm2 / Math.PI);

  return {
    metrics: {
      playableAreaKm2,
      playableAreaPerPointKm2,
      playableCatchmentRadiusKm,
    },
    projection,
    finalCellSizeKm,
    finalCells: occupiedCells,
    stagedCells,
  };
}

function buildCellPolygon(
  key: string,
  cellSizeKm: number,
  projection: ProjectionContext,
): Feature<Polygon, PlayableAreaDebugProperties>["geometry"] {
  const [cellX, cellY] = parseCellKey(key);
  const minXKm = projection.originXKm + (cellX * cellSizeKm);
  const maxXKm = minXKm + cellSizeKm;
  const minYKm = projection.originYKm + (cellY * cellSizeKm);
  const maxYKm = minYKm + cellSizeKm;

  const minLon = minXKm / projection.lonScaleKm;
  const maxLon = maxXKm / projection.lonScaleKm;
  const minLat = minYKm / projection.latScaleKm;
  const maxLat = maxYKm / projection.latScaleKm;

  return {
    type: "Polygon",
    coordinates: [[
      [minLon, minLat],
      [minLon, maxLat],
      [maxLon, maxLat],
      [maxLon, minLat],
      [minLon, minLat],
    ]],
  };
}

function buildDebugFeatureCollection(
  cells: Set<string>,
  cellSizeKm: number,
  stage: PlayableAreaDebugProperties["stage"],
  isFinalPlayableArea: boolean,
  projection: ProjectionContext,
): FeatureCollection<Polygon, PlayableAreaDebugProperties> {
  return {
    type: "FeatureCollection",
    features: [...cells].map((key) => ({
      type: "Feature",
      properties: {
        stage,
        cellSizeKm,
        isFinalPlayableArea,
      },
      geometry: buildCellPolygon(key, cellSizeKm, projection),
    })),
  };
}

function mergeFeatureCollections(
  collections: Array<FeatureCollection<Polygon, PlayableAreaDebugProperties>>,
): FeatureCollection<Polygon, PlayableAreaDebugProperties> {
  return {
    type: "FeatureCollection",
    features: collections.flatMap((collection) => collection.features),
  };
}

export function computePlayableAreaMetrics(locations: PlayableAreaLocation[]): PlayableAreaMetrics {
  return computePlayableAreaState(locations).metrics;
}

export function computePlayableAreaDebugGeoJson(
  locations: PlayableAreaLocation[],
): PlayableAreaDebugResult {
  const state = computePlayableAreaState(locations);

  const finalPlayableArea = buildDebugFeatureCollection(
    state.finalCells,
    state.finalCellSizeKm,
    "closed",
    true,
    state.projection,
  );

  const stagedCells = mergeFeatureCollections(
    state.stagedCells.map((entry) => buildDebugFeatureCollection(
      entry.cells,
      entry.cellSizeKm,
      entry.stage,
      entry.stage === "closed" && entry.cellSizeKm === state.finalCellSizeKm,
      state.projection,
    )),
  );

  return {
    metrics: state.metrics,
    finalPlayableArea,
    stagedCells,
  };
}
