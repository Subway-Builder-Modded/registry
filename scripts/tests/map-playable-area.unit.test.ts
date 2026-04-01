import test from "node:test";
import assert from "node:assert/strict";
import {
  computePlayableAreaDebugGeoJson,
  computePlayableAreaMetrics,
} from "../lib/map-playable-area.js";

function kmToLongitudeDegrees(km: number): number {
  return km / 111.32;
}

function kmToLatitudeDegrees(km: number): number {
  return km / 110.574;
}

test("computePlayableAreaMetrics bridges sparse corridor points into a continuous playable area", () => {
  const metrics = computePlayableAreaMetrics([
    { longitude: kmToLongitudeDegrees(0), latitude: 0 },
    { longitude: kmToLongitudeDegrees(1.6), latitude: 0 },
    { longitude: kmToLongitudeDegrees(3.2), latitude: 0 },
    { longitude: kmToLongitudeDegrees(4.8), latitude: 0 },
  ]);

  assert.ok(metrics.playableAreaKm2 > 4);
  assert.ok(metrics.playableAreaPerPointKm2 > 1);
});

test("computePlayableAreaMetrics does not bridge distant clusters across a wide empty gap", () => {
  const metrics = computePlayableAreaMetrics([
    { longitude: kmToLongitudeDegrees(0), latitude: 0 },
    { longitude: kmToLongitudeDegrees(1), latitude: 0 },
    { longitude: kmToLongitudeDegrees(20), latitude: 0 },
    { longitude: kmToLongitudeDegrees(21), latitude: 0 },
  ]);

  assert.ok(metrics.playableAreaKm2 < 15);
});

test("computePlayableAreaMetrics does not fill a large coastal void", () => {
  const metrics = computePlayableAreaMetrics([
    { longitude: kmToLongitudeDegrees(0), latitude: kmToLatitudeDegrees(0) },
    { longitude: kmToLongitudeDegrees(2), latitude: kmToLatitudeDegrees(0) },
    { longitude: kmToLongitudeDegrees(4), latitude: kmToLatitudeDegrees(0) },
    { longitude: kmToLongitudeDegrees(0), latitude: kmToLatitudeDegrees(4) },
    { longitude: kmToLongitudeDegrees(0), latitude: kmToLatitudeDegrees(6) },
    { longitude: kmToLongitudeDegrees(4), latitude: kmToLatitudeDegrees(6) },
  ]);

  assert.ok(metrics.playableAreaKm2 < 30);
});

test("computePlayableAreaMetrics stays bounded for zero and one-point inputs", () => {
  assert.deepEqual(
    computePlayableAreaMetrics([]),
    {
      playableAreaKm2: 0,
      playableAreaPerPointKm2: 0,
      playableCatchmentRadiusKm: 0,
    },
  );

  const single = computePlayableAreaMetrics([{ longitude: 0, latitude: 0 }]);
  assert.equal(single.playableAreaKm2, 4);
  assert.equal(single.playableAreaPerPointKm2, 4);
  assert.ok(single.playableCatchmentRadiusKm > 0);
  assert.ok(single.playableCatchmentRadiusKm < 2);
});

test("computePlayableAreaDebugGeoJson exposes the final playable raster cells as GeoJSON", () => {
  const debug = computePlayableAreaDebugGeoJson([
    { longitude: kmToLongitudeDegrees(0), latitude: 0 },
    { longitude: kmToLongitudeDegrees(1.6), latitude: 0 },
    { longitude: kmToLongitudeDegrees(3.2), latitude: 0 },
    { longitude: kmToLongitudeDegrees(4.8), latitude: 0 },
  ]);

  assert.equal(debug.finalPlayableArea.type, "FeatureCollection");
  assert.equal(debug.finalPlayableArea.features.length, debug.metrics.playableAreaKm2);
  assert.ok(debug.stagedCells.features.length > debug.finalPlayableArea.features.length);
  assert.ok(debug.finalPlayableArea.features.every((feature) => (
    feature.properties?.isFinalPlayableArea === true
    && feature.properties?.cellSizeKm === 1
  )));
});
