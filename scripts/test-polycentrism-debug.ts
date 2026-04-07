import { computePolycentrismMetrics } from './lib/map-polycentrism.js';

function buildCluster(center: [number, number], pointCount: number, residentsEach: number, jobsEach: number) {
  const points: any[] = [];
  const [centerLon, centerLat] = center;
  const radius = 0.004;
  for (let i = 0; i < pointCount; i++) {
    const angle = (i / pointCount) * Math.PI * 2;
    const distance = (i / pointCount) * radius;
    points.push({
      location: [
        centerLon + Math.cos(angle) * distance,
        centerLat + Math.sin(angle) * distance,
      ] as [number, number],
      residents: residentsEach,
      jobs: jobsEach,
    });
  }
  return points;
}

function buildDemandData(points: any[]) {
  return { points };
}

// Test: detects two balanced centres
const demandData = buildDemandData([
  ...buildCluster([0, 0], 12, 30, 10),
  ...buildCluster([0.08, 0.08], 12, 30, 10),
]);

const polycentrism = computePolycentrismMetrics(demandData);

console.log('detectedCenterCount:', polycentrism.activity.detectedCenterCount);
console.log('score:', polycentrism.activity.score);
console.log('continuousScore:', polycentrism.activity.continuousScore);
console.log('effectiveCenterCount:', polycentrism.activity.effectiveCenterCount);
console.log('Test expects: continuousScore > 0.5, got:', polycentrism.activity.continuousScore);
console.log('Test result:', polycentrism.activity.continuousScore > 0.5 ? 'PASS' : 'FAIL');
