/**
 * Smart Route Optimization Engine
 * 
 * Provides:
 * 1. Real Road Network Routing & Distance/Duration Matrix (OSRM + Calibrated Fallback)
 * 2. Multi-Criteria Route Optimization (Travel Time + Distance + Backtracking + Time Constraints + Priority)
 * 3. Chronological Time & Schedule Calculations (Arrival, Stay, Departure, Opening Hours)
 * 4. Leg-by-Leg Details & Road Geometry Generation for Dual Map/Flow View
 */

const MODE_CONFIG = {
    driving: {
        osrmProfile: 'driving',
        avgSpeedKmH: 42,
        roadFactor: 1.28,
        transferBufferMin: 0,
        label: 'Driving'
    },
    walking: {
        osrmProfile: 'foot',
        avgSpeedKmH: 4.8,
        roadFactor: 1.22,
        transferBufferMin: 0,
        label: 'Walking'
    },
    cycling: {
        osrmProfile: 'bike',
        avgSpeedKmH: 16.5,
        roadFactor: 1.25,
        transferBufferMin: 0,
        label: 'Cycling'
    },
    transit: {
        osrmProfile: 'driving', // Uses driving roads with transit speed & transfer buffer
        avgSpeedKmH: 26,
        roadFactor: 1.35,
        transferBufferMin: 8,
        label: 'Public Transit'
    }
};

/**
 * Calculates Haversine distance in km between two geographic coordinates
 */
function calculateHaversineDistance(lat1, lon1, lat2, lon2) {
    const R = 6371; // Earth radius in km
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = 
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * 
        Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return parseFloat((R * c).toFixed(2));
}

/**
 * Parses time string "HH:MM" into minutes since midnight
 */
function parseTimeToMinutes(timeStr, defaultMinutes = 540) {
    if (!timeStr || typeof timeStr !== 'string') return defaultMinutes;
    const parts = timeStr.trim().split(':');
    if (parts.length < 2) return defaultMinutes;
    const hours = parseInt(parts[0], 10);
    const mins = parseInt(parts[1], 10);
    if (isNaN(hours) || isNaN(mins)) return defaultMinutes;
    return (hours * 60) + mins;
}

/**
 * Formats minutes since midnight into "HH:MM AM/PM" or "HH:MM"
 */
function formatMinutesToTimeString(totalMinutes, use12Hour = true) {
    const normalized = ((Math.round(totalMinutes) % 1440) + 1440) % 1440;
    const hours24 = Math.floor(normalized / 60);
    const mins = normalized % 60;
    const minsStr = mins < 10 ? `0${mins}` : `${mins}`;

    if (!use12Hour) {
        const hoursStr = hours24 < 10 ? `0${hours24}` : `${hours24}`;
        return `${hoursStr}:${minsStr}`;
    }

    const period = hours24 >= 12 ? 'PM' : 'AM';
    const hours12 = hours24 % 12 === 0 ? 12 : hours24 % 12;
    return `${hours12}:${minsStr} ${period}`;
}

/**
 * Fetches actual distance and duration matrix using OSRM Table API
 */
async function fetchDistanceDurationMatrix(allLocations, travelMode = 'driving') {
    const count = allLocations.length;
    const distances = Array.from({ length: count }, () => Array(count).fill(0));
    const durations = Array.from({ length: count }, () => Array(count).fill(0));

    const mode = MODE_CONFIG[travelMode] || MODE_CONFIG.driving;
    const coordsParam = allLocations.map(loc => `${loc.lon},${loc.lat}`).join(';');

    let usedActualRouting = false;

    // Only attempt OSRM for driving, walking, cycling if online
    if (travelMode !== 'transit') {
        try {
            const osrmUrl = `https://router.project-osrm.org/table/v1/${mode.osrmProfile}/${coordsParam}?annotations=distance,duration`;
            const res = await fetch(osrmUrl, { signal: AbortSignal.timeout(4000) });
            if (res.ok) {
                const data = await res.json();
                if (data.code === 'Ok' && data.distances && data.durations) {
                    for (let i = 0; i < count; i++) {
                        for (let j = 0; j < count; j++) {
                            if (i === j) continue;
                            const distMeters = data.distances[i]?.[j];
                            const durSeconds = data.durations[i]?.[j];

                            if (distMeters !== null && distMeters !== undefined) {
                                distances[i][j] = parseFloat((distMeters / 1000).toFixed(2));
                            }
                            if (durSeconds !== null && durSeconds !== undefined) {
                                durations[i][j] = Math.max(1, Math.round(durSeconds / 60));
                            }
                        }
                    }
                    usedActualRouting = true;
                }
            }
        } catch (err) {
            console.warn(`[RouteOptimizer] ⚠️ OSRM Table API unreachable (${err.message}), using calibrated road network model.`);
        }
    }

    // Calibrated fallback if OSRM is unavailable or for transit
    if (!usedActualRouting) {
        for (let i = 0; i < count; i++) {
            for (let j = 0; j < count; j++) {
                if (i === j) continue;
                const straightKm = calculateHaversineDistance(
                    allLocations[i].lat, allLocations[i].lon,
                    allLocations[j].lat, allLocations[j].lon
                );
                // Apply mode road detour factor
                const roadKm = parseFloat((straightKm * mode.roadFactor).toFixed(2));
                distances[i][j] = roadKm;

                // Travel time in minutes based on realistic speed
                const travelMin = Math.round((roadKm / mode.avgSpeedKmH) * 60) + mode.transferBufferMin;
                durations[i][j] = Math.max(2, travelMin);
            }
        }
    }

    return { distances, durations, usedActualRouting };
}

/**
 * Fetches actual road GeoJSON geometry from OSRM Route API for the ordered route
 */
async function fetchRouteGeometry(orderedLocations, travelMode = 'driving') {
    if (!orderedLocations || orderedLocations.length < 2) {
        return null;
    }

    const mode = MODE_CONFIG[travelMode] || MODE_CONFIG.driving;
    const coordsParam = orderedLocations.map(loc => `${loc.lon},${loc.lat}`).join(';');

    try {
        const osrmRouteUrl = `https://router.project-osrm.org/route/v1/${mode.osrmProfile}/${coordsParam}?overview=full&geometries=geojson&steps=false`;
        const res = await fetch(osrmRouteUrl, { signal: AbortSignal.timeout(4500) });
        if (res.ok) {
            const data = await res.json();
            if (data.code === 'Ok' && data.routes && data.routes.length > 0) {
                const route = data.routes[0];
                return {
                    type: 'Feature',
                    geometry: route.geometry,
                    properties: {
                        distanceMeters: route.distance,
                        durationSeconds: route.duration,
                        legs: route.legs || []
                    }
                };
            }
        }
    } catch (err) {
        console.warn(`[RouteOptimizer] ⚠️ OSRM Route Geometry fallback used (${err.message}).`);
    }

    // Fallback: build high-density interpolated coordinates along the points
    const coordinates = [];
    for (let i = 0; i < orderedLocations.length - 1; i++) {
        const p1 = orderedLocations[i];
        const p2 = orderedLocations[i + 1];
        coordinates.push([p1.lon, p1.lat]);

        // Add 2 intermediate curvature points to simulate road lines
        const midLat = (p1.lat + p2.lat) / 2;
        const midLon = (p1.lon + p2.lon) / 2;
        const offset = 0.0012 * Math.sin(i * 1.5);
        coordinates.push([midLon + offset, midLat + offset]);
    }
    coordinates.push([
        orderedLocations[orderedLocations.length - 1].lon,
        orderedLocations[orderedLocations.length - 1].lat
    ]);

    return {
        type: 'Feature',
        geometry: {
            type: 'LineString',
            coordinates
        },
        properties: {
            isSynthetic: true
        }
    };
}

/**
 * Calculates backtracking metric for a given ordered index sequence
 * Backtracking happens when a vector reverses heading towards previous points (>120 deg)
 */
function calculateBacktrackingScore(sequenceIndices, allLocations) {
    if (sequenceIndices.length < 3) return 0;
    let backtrackCount = 0;

    for (let i = 1; i < sequenceIndices.length - 1; i++) {
        const p0 = allLocations[sequenceIndices[i - 1]];
        const p1 = allLocations[sequenceIndices[i]];
        const p2 = allLocations[sequenceIndices[i + 1]];

        const v1x = p1.lon - p0.lon;
        const v1y = p1.lat - p0.lat;
        const v2x = p2.lon - p1.lon;
        const v2y = p2.lat - p1.lat;

        const mag1 = Math.hypot(v1x, v1y);
        const mag2 = Math.hypot(v2x, v2y);

        if (mag1 > 0.0001 && mag2 > 0.0001) {
            const dot = (v1x * v2x + v1y * v2y) / (mag1 * mag2);
            // If dot < -0.5, angle > 120 degrees (sharp U-turn backtracking)
            if (dot < -0.5) {
                backtrackCount += (Math.abs(dot) * 2);
            }
        }
    }

    return backtrackCount;
}

/**
 * Calculates cost for a specific sequence permutation
 */
function evaluateSequenceCost({
    sequenceIndices,
    allLocations,
    distancesMatrix,
    durationsMatrix,
    startTimeMinutes,
    availableTripTimeMinutes,
    optimizeMode = 'balanced'
}) {
    let totalDistanceKm = 0;
    let totalTravelTimeMin = 0;
    let currentClockMinutes = startTimeMinutes;
    let timeWindowViolations = 0;
    let priorityScore = 0;

    for (let i = 0; i < sequenceIndices.length - 1; i++) {
        const fromIdx = sequenceIndices[i];
        const toIdx = sequenceIndices[i + 1];

        const legDist = distancesMatrix[fromIdx][toIdx] || 0;
        const legDur = durationsMatrix[fromIdx][toIdx] || 0;

        totalDistanceKm += legDist;
        totalTravelTimeMin += legDur;
        currentClockMinutes += legDur;

        // Evaluate destination at toIdx
        const dest = allLocations[toIdx];
        if (dest && toIdx !== 0) {
            // Opening & closing hours check
            const openMin = parseTimeToMinutes(dest.openTime, 540); // 09:00 default
            const closeMin = parseTimeToMinutes(dest.closeTime, 1200); // 20:00 default

            if (currentClockMinutes < openMin) {
                // Arrives before opening -> wait
                currentClockMinutes = openMin;
            } else if (currentClockMinutes > closeMin) {
                // Arrives after closing!
                timeWindowViolations += (currentClockMinutes - closeMin);
            }

            // Planned stay duration
            const stayMin = parseInt(dest.stayDurationMin, 10) || 45;
            currentClockMinutes += stayMin;

            // Priority incentive (High priority favored earlier)
            const prio = (dest.priority || 'medium').toLowerCase();
            const stepOrderWeight = (sequenceIndices.length - i);
            if (prio === 'high') {
                priorityScore += (stepOrderWeight * 12);
            } else if (prio === 'low') {
                priorityScore -= (stepOrderWeight * 4);
            }
        }
    }

    const totalTripDurationMin = currentClockMinutes - startTimeMinutes;
    const overtimePenalty = Math.max(0, totalTripDurationMin - availableTripTimeMinutes) * 2.5;
    const backtrackScore = calculateBacktrackingScore(sequenceIndices, allLocations);

    // Weights adjusted by optimization mode
    let wTime = 1.0;
    let wDist = 0.8;
    let wBacktrack = 15.0;

    if (optimizeMode === 'time') {
        wTime = 1.8;
        wDist = 0.4;
    } else if (optimizeMode === 'distance') {
        wTime = 0.5;
        wDist = 2.0;
    }

    const totalCost = (totalTravelTimeMin * wTime) +
                      (totalDistanceKm * wDist) +
                      (backtrackScore * wBacktrack) +
                      (timeWindowViolations * 1.5) +
                      overtimePenalty -
                      priorityScore;

    return {
        totalCost,
        totalDistanceKm,
        totalTravelTimeMin,
        totalTripDurationMin,
        backtrackScore,
        timeWindowViolations
    };
}

/**
 * Generates all permutations of an array
 */
function getPermutations(arr) {
    if (arr.length <= 1) return [arr];
    const result = [];
    for (let i = 0; i < arr.length; i++) {
        const current = arr[i];
        const remaining = arr.slice(0, i).concat(arr.slice(i + 1));
        const remainingPerms = getPermutations(remaining);
        for (const perm of remainingPerms) {
            result.push([current, ...perm]);
        }
    }
    return result;
}

/**
 * 2-opt local search optimization for larger destination sets (>8 stops)
 */
function optimize2Opt(initialSequence, evaluateCostFn) {
    let bestSequence = [...initialSequence];
    let bestCost = evaluateCostFn(bestSequence).totalCost;
    let improved = true;
    let iterations = 0;

    while (improved && iterations < 60) {
        improved = false;
        iterations++;

        for (let i = 1; i < bestSequence.length - 1; i++) {
            for (let k = i + 1; k < bestSequence.length; k++) {
                const newSequence = [
                    ...bestSequence.slice(0, i),
                    ...bestSequence.slice(i, k + 1).reverse(),
                    ...bestSequence.slice(k + 1)
                ];

                const cost = evaluateCostFn(newSequence).totalCost;
                if (cost < bestCost) {
                    bestCost = cost;
                    bestSequence = newSequence;
                    improved = true;
                    break;
                }
            }
            if (improved) break;
        }
    }

    return bestSequence;
}

/**
 * Main Smart Route Optimizer Orchestrator
 */
async function optimizeRoutePlan({
    startLocation,
    destinations = [],
    travelMode = 'driving',
    startTime = '09:00',
    availableTripTimeMinutes = 480, // 8 hours default
    optimizeMode = 'balanced'
}) {
    if (!startLocation || !startLocation.lat || !startLocation.lon) {
        throw new Error('Valid start location with lat and lon is required.');
    }

    if (!Array.isArray(destinations) || destinations.length === 0) {
        throw new Error('At least one destination is required for route optimization.');
    }

    const startTimeMinutes = parseTimeToMinutes(startTime, 540);
    const availableMinutes = parseInt(availableTripTimeMinutes, 10) || 480;

    // Consolidated location list: Index 0 is always START
    const allLocations = [
        {
            id: 'start-point',
            name: startLocation.name || 'Starting Point',
            address: startLocation.address || '',
            lat: parseFloat(startLocation.lat),
            lon: parseFloat(startLocation.lon),
            isStart: true,
            stayDurationMin: 0
        },
        ...destinations.map((d, idx) => ({
            id: d.id || `dest-${idx + 1}`,
            name: d.name || `Destination ${idx + 1}`,
            address: d.address || '',
            category: d.category || 'culture',
            lat: parseFloat(d.lat),
            lon: parseFloat(d.lon),
            priority: d.priority || 'medium',
            stayDurationMin: parseInt(d.stayDurationMin, 10) || 45,
            openTime: d.openTime || '09:00',
            closeTime: d.closeTime || '19:00',
            isStart: false
        }))
    ];

    console.log(`[RouteOptimizer] ⚡ Optimizing route for START + ${destinations.length} destinations using [${travelMode}] mode...`);

    // 1. Fetch distance and duration matrix using real road network (OSRM)
    const { distances, durations, usedActualRouting } = await fetchDistanceDurationMatrix(allLocations, travelMode);

    // 2. Determine optimal destination sequence
    const destinationIndices = Array.from({ length: destinations.length }, (_, i) => i + 1);
    let bestSequenceIndices = null;
    let bestCost = Infinity;

    const evaluateCostFn = (seq) => evaluateSequenceCost({
        sequenceIndices: seq,
        allLocations,
        distancesMatrix: distances,
        durationsMatrix: durations,
        startTimeMinutes,
        availableTripTimeMinutes: availableMinutes,
        optimizeMode
    });

    if (destinationIndices.length <= 8) {
        // Exact Branch & Bound / Permutation Evaluation
        const permutations = getPermutations(destinationIndices);
        for (const perm of permutations) {
            const candidateSeq = [0, ...perm];
            const evalResult = evaluateCostFn(candidateSeq);
            if (evalResult.totalCost < bestCost) {
                bestCost = evalResult.totalCost;
                bestSequenceIndices = candidateSeq;
            }
        }
    } else {
        // Nearest-Neighbor Greedy Initialization + 2-Opt Local Search
        const visited = new Set([0]);
        let currentIdx = 0;
        const greedySeq = [0];

        while (visited.size < allLocations.length) {
            let nearestIdx = -1;
            let minTravelMin = Infinity;

            for (let i = 1; i < allLocations.length; i++) {
                if (!visited.has(i)) {
                    const dur = durations[currentIdx][i];
                    if (dur < minTravelMin) {
                        minTravelMin = dur;
                        nearestIdx = i;
                    }
                }
            }

            if (nearestIdx !== -1) {
                visited.add(nearestIdx);
                greedySeq.push(nearestIdx);
                currentIdx = nearestIdx;
            } else {
                break;
            }
        }

        bestSequenceIndices = optimize2Opt(greedySeq, evaluateCostFn);
    }

    if (!bestSequenceIndices) {
        bestSequenceIndices = [0, ...destinationIndices];
    }

    // 3. Build Detailed Chronological Schedule
    let currentClockMinutes = startTimeMinutes;
    let runningDistanceKm = 0;
    let runningTravelTimeMin = 0;
    let totalStayDurationMin = 0;
    let totalWaitTimeMin = 0;

    const orderedStops = [];
    const connections = [];

    for (let i = 0; i < bestSequenceIndices.length; i++) {
        const currLocIdx = bestSequenceIndices[i];
        const loc = allLocations[currLocIdx];

        if (i === 0) {
            // Starting Point
            orderedStops.push({
                orderIndex: 0,
                id: loc.id,
                name: loc.name,
                address: loc.address,
                isStart: true,
                lat: loc.lat,
                lon: loc.lon,
                arrivalTime: null,
                departureTime: formatMinutesToTimeString(startTimeMinutes),
                departureMinutes: startTimeMinutes,
                stayDurationMin: 0,
                status: 'departed_start'
            });
        } else {
            const prevLocIdx = bestSequenceIndices[i - 1];
            const legDist = distances[prevLocIdx][currLocIdx] || 0;
            const legDur = durations[prevLocIdx][currLocIdx] || 0;

            runningDistanceKm += legDist;
            runningTravelTimeMin += legDur;

            const arrivalClockMin = currentClockMinutes + legDur;
            const openMin = parseTimeToMinutes(loc.openTime, 540);
            const closeMin = parseTimeToMinutes(loc.closeTime, 1200);

            let waitTime = 0;
            let effectiveArrivalMin = arrivalClockMin;
            let status = 'open_on_arrival';

            if (arrivalClockMin < openMin) {
                waitTime = openMin - arrivalClockMin;
                totalWaitTimeMin += waitTime;
                effectiveArrivalMin = openMin;
                status = 'waiting_for_opening';
            } else if (arrivalClockMin > closeMin) {
                status = 'closed_on_arrival';
            }

            const stayMin = loc.stayDurationMin;
            totalStayDurationMin += stayMin;
            const departureClockMin = effectiveArrivalMin + stayMin;
            currentClockMinutes = departureClockMin;

            // Record connection (Leg)
            const prevLoc = allLocations[prevLocIdx];
            connections.push({
                fromName: prevLoc.name,
                toName: loc.name,
                fromIndex: i - 1,
                toIndex: i,
                distanceKm: legDist,
                travelTimeMin: legDur,
                travelMode,
                summaryText: `${prevLoc.name} → ${loc.name} (${legDist} km • ${legDur} min)`
            });

            orderedStops.push({
                orderIndex: i, // 1-based order for destinations (①, ②, ...)
                id: loc.id,
                name: loc.name,
                address: loc.address,
                category: loc.category,
                isStart: false,
                lat: loc.lat,
                lon: loc.lon,
                priority: loc.priority,
                arrivalTime: formatMinutesToTimeString(arrivalClockMin),
                arrivalMinutes: arrivalClockMin,
                effectiveArrivalTime: formatMinutesToTimeString(effectiveArrivalMin),
                stayDurationMin: stayMin,
                departureTime: formatMinutesToTimeString(departureClockMin),
                departureMinutes: departureClockMin,
                openTime: loc.openTime,
                closeTime: loc.closeTime,
                waitTimeMin: waitTime,
                status,
                legFromPrevious: {
                    distanceKm: legDist,
                    travelTimeMin: legDur,
                    travelMode
                }
            });
        }
    }

    const totalTripDurationMin = currentClockMinutes - startTimeMinutes;
    const isWithinBudget = totalTripDurationMin <= availableMinutes;
    const budgetDeltaMin = totalTripDurationMin - availableMinutes;

    // 4. Fetch actual road geometry for the ordered stops
    const orderedLocationsForMap = orderedStops.map(s => ({ lat: s.lat, lon: s.lon }));
    const routeGeometry = await fetchRouteGeometry(orderedLocationsForMap, travelMode);

    // Recommended Order formatted string
    const recommendedOrderSummary = orderedStops.map(s => s.isStart ? 'START' : s.name).join(' → ');

    return {
        success: true,
        travelMode,
        travelModeLabel: MODE_CONFIG[travelMode]?.label || 'Driving',
        usedActualRouting,
        startTime: formatMinutesToTimeString(startTimeMinutes),
        endTime: formatMinutesToTimeString(currentClockMinutes),
        recommendedOrderSummary,
        totals: {
            totalDistanceKm: parseFloat(runningDistanceKm.toFixed(1)),
            totalTravelTimeMin: runningTravelTimeMin,
            totalTravelTimeFormatted: `${Math.floor(runningTravelTimeMin / 60)}h ${runningTravelTimeMin % 60}m`,
            totalStayDurationMin: totalStayDurationMin,
            totalStayDurationFormatted: `${Math.floor(totalStayDurationMin / 60)}h ${totalStayDurationMin % 60}m`,
            totalTripDurationMin: totalTripDurationMin,
            totalTripDurationFormatted: `${Math.floor(totalTripDurationMin / 60)}h ${totalTripDurationMin % 60}m`,
            availableTripTimeMinutes: availableMinutes,
            availableTripTimeFormatted: `${Math.floor(availableMinutes / 60)}h ${availableMinutes % 60}m`,
            isWithinBudget,
            budgetDeltaMin: Math.abs(budgetDeltaMin),
            stopsCount: destinations.length
        },
        orderedStops,
        connections,
        routeGeometry
    };
}

module.exports = {
    optimizeRoutePlan,
    calculateHaversineDistance,
    fetchDistanceDurationMatrix,
    fetchRouteGeometry,
    MODE_CONFIG
};
