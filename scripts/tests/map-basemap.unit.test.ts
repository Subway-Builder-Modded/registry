import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import type { FeatureCollection, GeoJsonProperties, MultiPolygon, Polygon } from "geojson";
import {
  computeGridBbox,
  getBasemapPath,
  squareBboxFromLonLatBbox,
  writeBasemapFromGrid,
} from "../lib/map-basemap.js";

function toMercator(lon: number, lat: number): { x: number; y: number } {
  const radius = 6_378_137;
  const lonRad = (lon * Math.PI) / 180;
  const latRad = (lat * Math.PI) / 180;
  return {
    x: radius * lonRad,
    y: radius * Math.log(Math.tan(Math.PI / 4 + latRad / 2)),
  };
}

test("getBasemapPath writes to maps/<id>/basemap.svg", () => {
  const outputPath = getBasemapPath("/repo", "guangzhou");
  assert.equal(outputPath, resolve("/repo", "maps", "guangzhou", "basemap.svg"));
});

test("computeGridBbox returns lon/lat bounds for polygon + multipolygon grids", () => {
  const grid: FeatureCollection<Polygon | MultiPolygon, GeoJsonProperties> = {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        properties: {},
        geometry: {
          type: "Polygon",
          coordinates: [
            [
              [10, 20],
              [12, 20],
              [12, 22],
              [10, 22],
              [10, 20],
            ],
          ],
        },
      },
      {
        type: "Feature",
        properties: {},
        geometry: {
          type: "MultiPolygon",
          coordinates: [
            [
              [
                [8, 19],
                [9, 19],
                [9, 20],
                [8, 20],
                [8, 19],
              ],
            ],
          ],
        },
      },
    ],
  };

  const bbox = computeGridBbox(grid);
  assert.deepEqual(bbox, {
    minLon: 8,
    minLat: 19,
    maxLon: 12,
    maxLat: 22,
  });
});

test("squareBboxFromLonLatBbox returns a square in Web Mercator", () => {
  const square = squareBboxFromLonLatBbox({
    minLon: -123.2,
    minLat: 37.6,
    maxLon: -122.1,
    maxLat: 38.2,
  });

  const sw = toMercator(square.minLon, square.minLat);
  const ne = toMercator(square.maxLon, square.maxLat);
  const width = ne.x - sw.x;
  const height = ne.y - sw.y;

  assert.ok(width > 0);
  assert.ok(height > 0);
  assert.ok(Math.abs(width - height) < 0.01, `expected square bounds, got width=${width} height=${height}`);
});

test("computeGridBbox rejects empty grid", () => {
  const empty: FeatureCollection<Polygon | MultiPolygon, GeoJsonProperties> = {
    type: "FeatureCollection",
    features: [],
  };

  assert.throws(
    () => computeGridBbox(empty),
    /grid is empty/,
  );
});

test("writeBasemapFromGrid renders square SVG and writes maps/<id>/basemap.svg", async () => {
  const repoRoot = mkdtempSync(join(tmpdir(), "railyard-map-basemap-"));
  const listingId = "sample-map";

  const grid: FeatureCollection<Polygon | MultiPolygon, GeoJsonProperties> = {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        properties: {},
        geometry: {
          type: "Polygon",
          coordinates: [
            [
              [114.0, 22.2],
              [114.2, 22.2],
              [114.2, 22.4],
              [114.0, 22.4],
              [114.0, 22.2],
            ],
          ],
        },
      },
    ],
  };

  const overpassPayload = {
    elements: [
      {
        type: "way",
        id: 1,
        tags: {
          highway: "primary",
          name: "Main Road",
        },
        geometry: [
          { lon: 114.01, lat: 22.21 },
          { lon: 114.19, lat: 22.39 },
        ],
      },
      {
        type: "way",
        id: 2,
        tags: {
          highway: "service",
        },
        geometry: [
          { lon: 114.05, lat: 22.25 },
          { lon: 114.1, lat: 22.26 },
        ],
      },
    ],
  };

  const fetchImpl: typeof fetch = async () => {
    return new Response(JSON.stringify(overpassPayload), {
      status: 200,
      headers: {
        "content-type": "application/json",
      },
    });
  };

  try {
    const result = await writeBasemapFromGrid(repoRoot, listingId, grid, {
      fetchImpl,
      overpassUrl: "https://example.test/overpass",
      generatedAt: new Date("2026-05-26T00:00:00.000Z"),
    });

    assert.equal(result.roadCount, 1);
    assert.equal(result.outputPath, resolve(repoRoot, "maps", listingId, "basemap.svg"));
    assert.equal(existsSync(result.outputPath), true);

    const svg = readFileSync(result.outputPath, "utf-8");
    assert.match(svg, /<svg[^>]*width="2048"[^>]*height="2048"[^>]*viewBox="0 0 2048 2048"/);
    assert.match(svg, /<g id="roads">/);
    assert.match(svg, /class="road primary"/);
    assert.match(svg, /stroke="#7a7a7a"/);
    assert.match(svg, /class="road primary"[^\n]*stroke-width="6"/);
    assert.doesNotMatch(svg, /<rect /);
    assert.doesNotMatch(svg, /class="road service"/);
    assert.match(svg, /square_bbox/);
    assert.match(svg, /OpenStreetMap contributors/);
  } finally {
    rmSync(repoRoot, { recursive: true, force: true });
  }
});
