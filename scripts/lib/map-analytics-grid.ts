import * as turf from "@turf/turf";
import { FeatureCollection, GeoJsonProperties, Polygon } from "geojson";

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

const HEARTBEAT_INTERVAL_MS = Number.parseInt(process.env.CI_HEARTBEAT_MS ?? "5000", 10);

const createHeartbeat = (label: string, mapId: string, total: number) => {
    let lastLogTime = 0;

    return (current: number, force = false) => {
        const now = Date.now();
        if(force || now - lastLogTime >= HEARTBEAT_INTERVAL_MS) {
            lastLogTime = now;
            const percent = total > 0 ? ((current / total) * 100).toFixed(1) : "0.0";
            console.log(`[heartbeat] ${label}{${mapId}}: ${current}/${total} (${percent}%)`);
        }
    };
};

export async function generateGrid(demandData: DemandData, cityCode: string): Promise<FeatureCollection<Polygon, GeoJsonProperties>> {
    let pointsCounter = 0;
    let pointsTotal = demandData.points.length;
    const commuteDistances = demandData.pops.map((pop) => pop.drivingDistance).sort((a, b) => a - b);
    const medianCommuteDistance = commuteDistances[Math.floor(demandData.pops.length / 2)];
    const meanCommuteDistance = demandData.pops.reduce((sum, pop) => sum + pop.drivingDistance, 0) / demandData.pops.length;
    const pointsHeartbeat = createHeartbeat("points", cityCode, pointsTotal);
    let points = turf.featureCollection(demandData.points.map((point) => {
        pointsCounter += 1;
        pointsHeartbeat(pointsCounter);
        return turf.point(point.location, {
            jobs: point.jobs,
            pop: point.residents,
            homeWorkCommuteDistances: demandData.pops.filter(pop => pop.residenceId === point.id).map(pop => pop.drivingDistance),
            workHomeCommuteDistances: demandData.pops.filter(pop => pop.jobId === point.id).map(pop => pop.drivingDistance)
        })
    }))
    pointsHeartbeat(pointsCounter, true);

    const grid = turf.squareGrid(turf.bbox(points), 1, {units: "kilometers"});

    let counter = 0;
    let total = grid.features.length;
    const cellsHeartbeat = createHeartbeat("cells", cityCode, total);
    grid.features.forEach((feature: any) => {
        counter += 1;
        const pointsInCell = turf.pointsWithinPolygon(points, feature);
        const jobs = pointsInCell.features.reduce((sum: number, point: any) => sum + point.properties.jobs, 0);
        const pop = pointsInCell.features.reduce((sum: number, point: any) => sum + point.properties.pop, 0);
        const homeWorkCommuteDistances = pointsInCell.features.reduce(
          (arr: number[], point: any) => arr.concat(point.properties!.homeWorkCommuteDistances as number[]),
          [],
        );
        const workHomeCommuteDistances = pointsInCell.features.reduce(
          (arr: number[], point: any) => arr.concat(point.properties!.workHomeCommuteDistances as number[]),
          [],
        );

        feature.properties!.jobs = jobs;
        feature.properties!.pop = pop;

        feature.properties!.pointCount = pointsInCell.features.length;
        
        if(homeWorkCommuteDistances.length === 0) {
            feature.properties!.homeWorkCommuteMedian = -1;
        }
        else {
            feature.properties!.homeWorkCommuteMedian = homeWorkCommuteDistances
              .sort((a: number, b: number) => a - b)[Math.floor(homeWorkCommuteDistances.length / 2)];
        }
   
        if(workHomeCommuteDistances.length > 0) {
            feature.properties!.workHomeCommuteMedian = workHomeCommuteDistances
              .sort((a: number, b: number) => a - b)[Math.floor(workHomeCommuteDistances.length / 2)];
        } else {
            feature.properties!.workHomeCommuteMedian = -1;
        }
    cellsHeartbeat(counter);
    });
    cellsHeartbeat(counter, true);

    grid.features = grid.features.filter(feature => feature.properties.pointCount > 0);

    return {
        ...grid,
        properties: {
            meanCommuteDistance: meanCommuteDistance,
            medianCommuteDistance: medianCommuteDistance
        }
    } as FeatureCollection<Polygon, GeoJsonProperties>;
}
