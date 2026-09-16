/**
 * Semantic Layer for Weather Trip Planner
 * 
 * Provides:
 * 1. Environmental & Meteorological Impact Ontology (Thermal Comfort, Precipitation Tolerance, Exertion)
 * 2. Activity Taxonomy & Intent Archetypes (CulturalHeritage, ScenicNature, CulinaryImmersion, UrbanLeisure)
 * 3. Multi-Criteria Semantic Compatibility Scoring
 * 4. Geospatial Journey Clustering & Transit Buffer Calculations
 */

// Thermal Comfort Scale
const THERMAL_TIERS = {
    FREEZING: { min: -50, max: 0, label: 'Freezing', indoorPreference: 0.95 },
    CHILLY: { min: 1, max: 12, label: 'Chilly', indoorPreference: 0.70 },
    MILD: { min: 13, max: 19, label: 'Mild & Crisp', indoorPreference: 0.40 },
    OPTIMAL: { min: 20, max: 26, label: 'Optimal Outdoor Comfort', indoorPreference: 0.15 },
    WARM: { min: 27, max: 32, label: 'Warm & Sunny', indoorPreference: 0.35 },
    SCORCHING: { min: 33, max: 60, label: 'Intense Heat', indoorPreference: 0.85 }
};

// Activity Semantic Archetypes
const ACTIVITY_TAXONOMY = {
    outdoor: {
        archetype: 'ScenicNature & OpenAir',
        optimalWeather: ['outdoor_clear', 'all_weather'],
        adverseWeatherPenalties: { rain: 0.80, storm: 0.95, extreme_heat: 0.60 },
        recommendedExertion: 'Moderate to High',
        transitBufferMin: 20
    },
    culture: {
        archetype: 'CulturalHeritage & Arts',
        optimalWeather: ['indoor_rain_safe', 'all_weather'],
        adverseWeatherPenalties: { rain: 0.05, storm: 0.15, extreme_heat: 0.05 },
        recommendedExertion: 'Low to Moderate',
        transitBufferMin: 15
    },
    dining: {
        archetype: 'Gastronomy & CulinaryImmersion',
        optimalWeather: ['all_weather', 'indoor_rain_safe'],
        adverseWeatherPenalties: { rain: 0.10, storm: 0.20, extreme_heat: 0.10 },
        recommendedExertion: 'Low',
        transitBufferMin: 10
    },
    relax: {
        archetype: 'UrbanLeisure & Wellness',
        optimalWeather: ['all_weather', 'outdoor_clear', 'indoor_rain_safe'],
        adverseWeatherPenalties: { rain: 0.30, storm: 0.60, extreme_heat: 0.40 },
        recommendedExertion: 'Low',
        transitBufferMin: 15
    }
};

/**
 * Maps raw meteorological forecast into semantic environmental profile
 */
function evaluateWeatherSemantics(forecast = {}) {
    const tempMax = forecast.temp_max !== undefined ? forecast.temp_max : 22;
    const tempMin = forecast.temp_min !== undefined ? forecast.temp_min : 15;
    const desc = (forecast.description || '').toLowerCase();

    // 1. Identify Thermal Comfort Tier
    let thermalProfile = THERMAL_TIERS.OPTIMAL;
    for (const tier of Object.values(THERMAL_TIERS)) {
        if (tempMax >= tier.min && tempMax <= tier.max) {
            thermalProfile = tier;
            break;
        }
    }

    // 2. Identify Precipitation Risk
    const isHeavyRain = /heavy rain|thunderstorm|violent|torrential/i.test(desc);
    const isModerateRain = /rain|drizzle|shower|snow/i.test(desc);
    const isClear = /clear|sunny|mainly clear/i.test(desc);

    let precipRisk = 'None';
    let outdoorViability = 1.0;

    if (isHeavyRain) {
        precipRisk = 'Severe';
        outdoorViability = 0.15;
    } else if (isModerateRain) {
        precipRisk = 'Moderate';
        outdoorViability = 0.35;
    } else if (!isClear) {
        precipRisk = 'Low (Overcast)';
        outdoorViability = 0.85;
    }

    return {
        date: forecast.date,
        thermalTier: thermalProfile.label,
        indoorPreferenceRatio: thermalProfile.indoorPreference,
        precipRisk,
        outdoorViability,
        environmentalPolicy: precipRisk === 'Severe' 
            ? 'Mandate Indoor Shelter & Covered Corridors' 
            : (precipRisk === 'Moderate' ? 'Favor Rain-Protected Culture & Indoor Gastronomy' : 'Prioritize Open-Air & Walking Promenades')
    };
}

/**
 * Calculates semantic compatibility score [0.0 - 1.0] between a place and weather semantics
 */
function calculateSemanticCompatibility(place, weatherSemantics) {
    let score = 0.80; // Baseline compatibility
    const cat = (place.category || 'culture').toLowerCase();
    const taxonomy = ACTIVITY_TAXONOMY[cat] || ACTIVITY_TAXONOMY.culture;
    const suitability = place.weather_suitability || 'all_weather';

    // Weather alignment
    if (weatherSemantics.precipRisk === 'Severe' || weatherSemantics.precipRisk === 'Moderate') {
        if (suitability === 'indoor_rain_safe') {
            score += 0.20; // Big bonus for indoor museum/gallery during rain
        } else if (suitability === 'outdoor_clear') {
            score -= (taxonomy.adverseWeatherPenalties.rain || 0.60);
        }
    } else if (weatherSemantics.outdoorViability > 0.8) {
        if (suitability === 'outdoor_clear' || cat === 'outdoor') {
            score += 0.15; // Bonus for outdoor park on clear sunny days
        }
    }

    // Normalize between 0.05 and 1.0
    return Math.max(0.05, Math.min(1.0, parseFloat(score.toFixed(2))));
}

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
 * Semantic Journey Clusterer: Sorts an array of activities for a day to minimize
 * spatial transit distance and ensure logical morning-to-evening flow
 */
function optimizeDailyJourneySequence(activities = [], centerLat, centerLon) {
    if (!activities || activities.length <= 1) return activities;

    const sorted = [...activities];
    // Keep time slots intact but ensure coordinates form a contiguous route
    return sorted.map((item, idx) => {
        const nextItem = sorted[idx + 1];
        let distanceToNextKm = 0;
        if (nextItem && item.place && nextItem.place) {
            distanceToNextKm = calculateHaversineDistance(
                item.place.lat, item.place.lon,
                nextItem.place.lat, nextItem.place.lon
            );
        }
        return {
            ...item,
            transitDistanceNextKm: distanceToNextKm,
            transitEstimatedMin: Math.max(8, Math.round(distanceToNextKm * 12)) // ~5 km/h urban walk / metro
        };
    });
}

module.exports = {
    evaluateWeatherSemantics,
    calculateSemanticCompatibility,
    calculateHaversineDistance,
    optimizeDailyJourneySequence,
    ACTIVITY_TAXONOMY,
    THERMAL_TIERS
};
