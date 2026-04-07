// Test the continuous score calculation
const CONTINUOUS_SCORE_DISTANCE_SCALE_KM = 15;
const KILOMETERS_PER_DEGREE = (Math.PI * 6371.0088) / 180;  // ~111.195

// Two clusters at [0,0] and [0.08,0.08]
const lat1 = 0, lon1 = 0;
const lat2 = 0.08, lon2 = 0.08;

const xKm1 = lon1 * KILOMETERS_PER_DEGREE;
const yKm1 = lat1 * KILOMETERS_PER_DEGREE;
const xKm2 = lon2 * KILOMETERS_PER_DEGREE;
const yKm2 = lat2 * KILOMETERS_PER_DEGREE;

const distanceKm = Math.sqrt((xKm2 - xKm1) ** 2 + (yKm2 - yKm1) ** 2);
console.log('Distance between centers:', distanceKm, 'km');

// For balanced clusters, both should have 0.5 share
const share1 = 0.5;
const share2 = 0.5;
const pairWeight = share1 * share2;

const separationDiscount = 1 - Math.exp(-((distanceKm / CONTINUOUS_SCORE_DISTANCE_SCALE_KM) ** 2));
console.log('Separation discount:', separationDiscount);

// effectiveCenterCount = 2 for two equal shares
const effectiveCountTerm = (2 - 1) / (2 + 1);  // 1/3 = 0.333
console.log('Effective count term:', effectiveCountTerm);

const continuousScore = effectiveCountTerm * separationDiscount;
console.log('Continuous score:', continuousScore);
console.log('Expected: > 0.5');

// What would we need?
console.log('\n--- Analysis ---');
console.log('With distance scale 15km and distance 12.5km:');
console.log('  separation discount = 1 - exp(-(12.5/15)^2) = 1 - exp(-0.694) = 1 - 0.5 = 0.5');
console.log('With effective count term = 0.333 and discount = 0.5:');
console.log('  score = 0.333 * 0.5 = 0.167 (matches observed!)');
console.log('\nTo get > 0.5, we would need:');
console.log('  Either: different CONTINUOUS_SCORE_DISTANCE_SCALE_KM');
console.log('  Or: different calculation of effective count term');
console.log('  Or: distance calculation or bandwidth usage is wrong');
