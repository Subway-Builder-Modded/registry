import * as turf from "@turf/turf";
import { FeatureCollection, GeoJsonProperties, Polygon } from "geojson";
import { computePolycentrismMetrics, type PolycentrismMetrics } from "./map-polycentrism.js";

export interface Point {
    location: [number, number];
    jobs: number;
    residents: number;
    id: string;
}

export interface Pops {
    residenceId: string;
    jobId: string;
    drivingDistance: number;
}

export interface DemandData {
    points: Point[];
    pops: Pops[];
}

export interface MetricSummary {
    p10: number;
    p25: number;
    p50: number;
    p75: number;
    p90: number;
    mean: number;
}

export interface GridMetricsProperties {
    residentWeightedNearestNeighborKm: MetricSummary;
    workerWeightedNearestNeighborKm: MetricSummary;
    commuteDistanceKm: MetricSummary;
    residentCellDensity: MetricSummary;
    workerCellDensity: MetricSummary;
    polycentrism: PolycentrismMetrics;
}

const HEARTBEAT_INTERVAL_MS = Number.parseInt(process.env.CI_HEARTBEAT_MS ?? "5000", 10);
const HEARTBEAT_ITEMS = Number.parseInt(process.env.CI_HEARTBEAT_ITEMS ?? "500", 10);

const createHeartbeat = (label: string, mapId: string, total: number) => {
    let lastLogTime = 0;
    let lastLoggedCount = 0;
    let hasLogged = false;

    return (current: number, force = false) => {
        const boundedCurrent = Math.max(0, Math.min(current, total));
        const now = Date.now();
        const reachedCountInterval = (
            HEARTBEAT_ITEMS > 0
            && boundedCurrent - lastLoggedCount >= HEARTBEAT_ITEMS
        );
        const reachedTimeInterval = (
            hasLogged
            && boundedCurrent > lastLoggedCount
            && now - lastLogTime >= HEARTBEAT_INTERVAL_MS
        );
        const reachedCompletion = boundedCurrent === total && boundedCurrent > lastLoggedCount;
        const shouldLog = (
            (force && boundedCurrent !== lastLoggedCount)
            || (!hasLogged && boundedCurrent > 0 && (reachedCountInterval || reachedCompletion))
            || reachedCountInterval
            || reachedTimeInterval
            || reachedCompletion
        );

        if (shouldLog) {
            lastLogTime = now;
            lastLoggedCount = boundedCurrent;
            hasLogged = true;
            const percent = total > 0 ? ((boundedCurrent / total) * 100).toFixed(1) : "0.0";
            console.log(`[heartbeat] ${label}{${mapId}}: ${boundedCurrent}/${total} (${percent}%)`);
        }
    };
};

function emptyMetricSummary(): MetricSummary {
    return {
        p10: 0,
        p25: 0,
        p50: 0,
        p75: 0,
        p90: 0,
        mean: 0,
    };
}

function pickWeightedPercentile(
    sortedEntries: Array<{ value: number; weight: number }>,
    totalWeight: number,
    percentile: number,
): number {
    if (sortedEntries.length === 0 || totalWeight <= 0) return 0;
    const targetWeight = totalWeight * percentile;
    let cumulativeWeight = 0;
    for (const entry of sortedEntries) {
        cumulativeWeight += entry.weight;
        if (cumulativeWeight >= targetWeight) {
            return entry.value;
        }
    }
    return sortedEntries[sortedEntries.length - 1]?.value ?? 0;
}

function summarizeMetric(values: number[], weights?: number[]): MetricSummary {
    if (values.length === 0) return emptyMetricSummary();

    const entries = values
        .map((value, index) => ({
            value,
            weight: weights?.[index] ?? 1,
        }))
        .filter((entry) => Number.isFinite(entry.value) && Number.isFinite(entry.weight) && entry.weight > 0)
        .sort((a, b) => a.value - b.value);

    if (entries.length === 0) return emptyMetricSummary();

    const totalWeight = entries.reduce((sum, entry) => sum + entry.weight, 0);
    if (totalWeight <= 0) return emptyMetricSummary();

    const weightedValueSum = entries.reduce((sum, entry) => sum + (entry.value * entry.weight), 0);
    return {
        p10: pickWeightedPercentile(entries, totalWeight, 0.10),
        p25: pickWeightedPercentile(entries, totalWeight, 0.25),
        p50: pickWeightedPercentile(entries, totalWeight, 0.50),
        p75: pickWeightedPercentile(entries, totalWeight, 0.75),
        p90: pickWeightedPercentile(entries, totalWeight, 0.90),
        mean: weightedValueSum / totalWeight,
    };
}

function computeNearestNeighborDistances(points: Point[], cityCode: string): number[] {
    if (points.length <= 1) {
        return points.map(() => 0);
    }

    const heartbeat = createHeartbeat("nearest-neighbors", cityCode, points.length);
    const distances = points.map((point, pointIndex) => {
        let nearestDistanceKm = Number.POSITIVE_INFINITY;
        for (let candidateIndex = 0; candidateIndex < points.length; candidateIndex += 1) {
            if (candidateIndex === pointIndex) continue;
            const candidate = points[candidateIndex]!;
            const distanceKm = turf.distance(
                turf.point(point.location),
                turf.point(candidate.location),
                { units: "kilometers" },
            );
            if (distanceKm < nearestDistanceKm) {
                nearestDistanceKm = distanceKm;
            }
        }
        heartbeat(pointIndex + 1);
        return Number.isFinite(nearestDistanceKm) ? nearestDistanceKm : 0;
    });
    heartbeat(points.length, true);
    return distances;
}

export async function generateGrid(demandData: DemandData, cityCode: string): Promise<FeatureCollection<Polygon, GeoJsonProperties>> {
    let pointsCounter = 0;
    const pointsTotal = demandData.points.length;
    const pointsHeartbeat = createHeartbeat("points", cityCode, pointsTotal);
    const pointFeatures = demandData.points.map((point) => {
        pointsCounter += 1;
        pointsHeartbeat(pointsCounter);
        return turf.point(point.location, {
            jobs: point.jobs,
            pop: point.residents,
        });
    });
    pointsHeartbeat(pointsCounter, true);

    const points = turf.featureCollection(pointFeatures);
    const nearestNeighborDistancesKm = computeNearestNeighborDistances(demandData.points, cityCode);

    const grid = turf.squareGrid(turf.bbox(points), 1, { units: "kilometers" });

    let counter = 0;
    let total = grid.features.length;
    const cellsHeartbeat = createHeartbeat("cells", cityCode, total);
    grid.features.forEach((feature: any) => {
        counter += 1;
        const pointsInCell = turf.pointsWithinPolygon(points, feature);
        const jobs = pointsInCell.features.reduce((sum: number, point: any) => sum + point.properties.jobs, 0);
        const pop = pointsInCell.features.reduce((sum: number, point: any) => sum + point.properties.pop, 0);

        feature.properties!.jobs = jobs;
        feature.properties!.pop = pop;
        feature.properties!.pointCount = pointsInCell.features.length;
        cellsHeartbeat(counter);
    });
    cellsHeartbeat(counter, true);

    grid.features = grid.features.filter(feature => feature.properties!.pointCount > 0);

    const populatedResidentCellCounts = grid.features
        .map((feature) => Number(feature.properties?.pop ?? 0))
        .filter((value) => Number.isFinite(value) && value > 0);
    const populatedWorkerCellCounts = grid.features
        .map((feature) => Number(feature.properties?.jobs ?? 0))
        .filter((value) => Number.isFinite(value) && value > 0);
    const commuteDistances = demandData.pops
        .map((pop) => pop.drivingDistance)
        .filter((value) => Number.isFinite(value) && value >= 0);
    const residentWeights = demandData.points.map((point) => point.residents);
    const workerWeights = demandData.points.map((point) => point.jobs);
    const residentWeightedNearestNeighborKm = summarizeMetric(nearestNeighborDistancesKm, residentWeights);
    const workerWeightedNearestNeighborKm = summarizeMetric(nearestNeighborDistancesKm, workerWeights);
    const commuteDistanceKm = summarizeMetric(commuteDistances);
    const residentCellDensity = summarizeMetric(populatedResidentCellCounts);
    const workerCellDensity = summarizeMetric(populatedWorkerCellCounts);
    const gridMetrics: GridMetricsProperties = {
        residentWeightedNearestNeighborKm,
        workerWeightedNearestNeighborKm,
        commuteDistanceKm,
        residentCellDensity,
        workerCellDensity,
        polycentrism: computePolycentrismMetrics(demandData),
    };

    return {
        ...grid,
        properties: gridMetrics,
    } as FeatureCollection<Polygon, GeoJsonProperties>;
}
