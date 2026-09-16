/**
 * Querying Layer for Weather Trip Planner
 * 
 * Implements:
 * 1. Multi-Stage Hybrid Search Orchestration
 * 2. Intent Parsing & Query Expansion
 * 3. Composite Multi-Factor Re-Ranking (Semantic Fit + Spatial Proximity + Self-Learning + Diversity)
 * 4. Day-by-Day Spatial Sequence Optimization
 * 5. Ad-Hoc Semantic Query Engine
 */

const { retrievePlacesForTrip } = require('./rag_engine');
const { 
    evaluateWeatherSemantics, 
    calculateSemanticCompatibility, 
    calculateHaversineDistance, 
    optimizeDailyJourneySequence 
} = require('./semantic_layer');
const { getLearnedWeight } = require('./learning_loop');

/**
 * Orchestrates multi-stage query pipeline for an entire trip itinerary
 */
async function orchestrateTripQuery({ city, country, latitude, longitude, dailyForecasts = [] }) {
    console.log(`[Querying Layer] ⚡ Stage 1: Parsing trip parameters for ${city}...`);
    const lat = parseFloat(latitude);
    const lon = parseFloat(longitude);

    // Stage 2: Hybrid Retrieval via RAG Engine
    console.log(`[Querying Layer] ⚡ Stage 2: Hybrid retrieval across verified travel datasets...`);
    const rawRetrieval = await retrievePlacesForTrip(city, country, lat, lon, dailyForecasts);
    const candidatePlaces = rawRetrieval.candidatePlaces || [];

    // Stage 3: Multi-Factor Re-Ranking & Day Allocation
    console.log(`[Querying Layer] ⚡ Stage 3: Multi-factor re-ranking with Semantic Layer & Learning Loop...`);
    const plannedDays = [];
    const usedPlaceIds = new Set();

    dailyForecasts.forEach((forecast, dayIdx) => {
        // Evaluate environmental semantics for this day
        const weatherSemantics = evaluateWeatherSemantics(forecast);

        // Score all available candidates
        const scoredCandidates = candidatePlaces.map(place => {
            const semanticFit = calculateSemanticCompatibility(place, weatherSemantics);
            const learnedWeight = getLearnedWeight(place.id, forecast.description);
            const distFromCenter = calculateHaversineDistance(lat, lon, place.lat, place.lon);
            const spatialScore = Math.max(0.1, 1 - (distFromCenter / 25)); // Prefer within 25km

            // Composite ranking formula:
            // Score = (SemanticFit * 0.40) + (LearnedWeight * 0.25) + (SpatialScore * 0.25) + Baseline (0.10)
            const compositeScore = parseFloat(
                ((semanticFit * 0.40) + (learnedWeight * 0.25) + (spatialScore * 0.25) + 0.10).toFixed(3)
            );

            return {
                place,
                compositeScore,
                semanticFit,
                learnedWeight,
                spatialScore
            };
        });

        // Sort descending by composite score
        scoredCandidates.sort((a, b) => b.compositeScore - a.compositeScore);

        // Select 4 diverse activities for this day
        const timeSlots = ['Morning', 'Late Morning', 'Afternoon', 'Evening'];
        const dayActivities = [];

        timeSlots.forEach((time, tIdx) => {
            const desiredCategory = tIdx === 0 ? 'outdoor' : (tIdx === 1 ? 'culture' : (tIdx === 2 ? 'dining' : 'relax'));

            // Look for best scoring unused candidate
            let match = scoredCandidates.find(sc => !usedPlaceIds.has(sc.place.id) && (sc.place.category === desiredCategory || sc.place.time_slot === time));
            if (!match) {
                match = scoredCandidates.find(sc => !usedPlaceIds.has(sc.place.id));
            }
            if (!match && scoredCandidates.length > 0) {
                match = scoredCandidates[tIdx % scoredCandidates.length];
            }

            if (match) {
                usedPlaceIds.add(match.place.id);
                dayActivities.push({
                    time,
                    place: match.place,
                    rankingMetrics: {
                        compositeScore: match.compositeScore,
                        semanticFit: match.semanticFit,
                        learnedWeight: match.learnedWeight
                    }
                });
            }
        });

        // Stage 4: Optimize Spatial Transit Sequence
        const sequencedActivities = optimizeDailyJourneySequence(dayActivities, lat, lon);

        plannedDays.push({
            date: forecast.date,
            weather: forecast,
            weatherSemantics,
            activities: sequencedActivities
        });
    });

    return {
        queryPlan: {
            destination: `${city}, ${country || ''}`,
            coordinates: [lat, lon],
            totalCandidateCount: candidatePlaces.length,
            datasetType: rawRetrieval.datasetType,
            daysPlanned: plannedDays.length
        },
        plannedDays,
        rawContextMarkdown: rawRetrieval.ragContextMarkdown,
        candidatePlaces
    };
}

/**
 * Ad-Hoc Semantic Query Processor (e.g. for user searches like "museums in Paris for rainy afternoon")
 */
async function executeAdHocSemanticQuery({ query, city, country, lat = 0, lon = 0 }) {
    console.log(`[Querying Layer] 🔍 Processing ad-hoc semantic query: "${query}" in ${city}...`);
    
    // Simulate current weather or generic
    const dummyForecast = [{ date: new Date().toISOString().split('T')[0], description: query, temp_max: 20 }];
    const retrieval = await retrievePlacesForTrip(city, country, lat, lon, dummyForecast);
    const places = retrieval.candidatePlaces || [];

    const queryLower = query.toLowerCase();
    const isRainIntent = /rain|indoor|museum|shelter/i.test(queryLower);
    const isOutdoorIntent = /sun|walk|park|nature|garden|view/i.test(queryLower);

    const matches = places.filter(p => {
        const text = `${p.name} ${p.description} ${p.category}`.toLowerCase();
        if (isRainIntent && p.weather_suitability === 'indoor_rain_safe') return true;
        if (isOutdoorIntent && (p.category === 'outdoor' || p.weather_suitability === 'outdoor_clear')) return true;
        return text.includes(queryLower) || queryLower.split(/\s+/).some(term => term.length > 3 && text.includes(term));
    });

    return {
        query,
        matchedCount: matches.length > 0 ? matches.length : places.length,
        results: matches.length > 0 ? matches : places.slice(0, 6)
    };
}

module.exports = {
    orchestrateTripQuery,
    executeAdHocSemanticQuery
};
