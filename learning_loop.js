/**
 * Self-Learning Loop for Weather Trip Planner
 * 
 * Implements:
 * 1. Active Feedback Telemetry Ingestion (upvotes, downvotes, swaps, regenerations)
 * 2. Adaptive Place Affinity Re-weighting based on Weather Conditions
 * 3. Automated Grounding Evaluation & Factual Hallucination Detection
 * 4. Continuous Model Calibration & Persistence
 */

const fs = require('fs');
const path = require('path');

const STORE_PATH = path.join(__dirname, 'data', 'learning_store.json');

let store = {
    global_metrics: {
        total_feedback_events: 0,
        positive_votes: 0,
        negative_votes: 0,
        satisfaction_rate_percent: 100.0,
        last_learning_update: new Date().toISOString()
    },
    place_affinities: {},
    recent_events: []
};

function loadStore() {
    try {
        if (fs.existsSync(STORE_PATH)) {
            const raw = fs.readFileSync(STORE_PATH, 'utf-8');
            store = JSON.parse(raw);
        }
    } catch (e) {
        console.warn('[Learning Loop] Failed to load store:', e.message);
    }
}

function saveStore() {
    try {
        fs.writeFileSync(STORE_PATH, JSON.stringify(store, null, 2), 'utf-8');
    } catch (e) {
        console.warn('[Learning Loop] Failed to save store:', e.message);
    }
}

// Initial load
loadStore();

/**
 * Normalizes weather condition string to a canonical key ('rain', 'clear', 'snow', 'mild')
 */
function canonicalizeWeather(desc = '') {
    const d = desc.toLowerCase();
    if (/rain|drizzle|shower|thunderstorm|storm/i.test(d)) return 'rain';
    if (/snow|blizzard|sleet/i.test(d)) return 'snow';
    if (/clear|sun/i.test(d)) return 'clear';
    return 'mild';
}

/**
 * Ingests user interaction feedback (thumbs up / thumbs down / swap)
 */
function recordFeedback({ placeId, placeName, rating, weatherCondition = 'clear', city = '' }) {
    if (!placeId) return { success: false, message: 'placeId is required' };

    const isPositive = rating === 'thumbs_up' || rating === 'up' || rating === 1;
    const condKey = canonicalizeWeather(weatherCondition);

    // Update global metrics
    store.global_metrics.total_feedback_events++;
    if (isPositive) {
        store.global_metrics.positive_votes++;
    } else {
        store.global_metrics.negative_votes++;
    }

    const total = store.global_metrics.total_feedback_events;
    const pos = store.global_metrics.positive_votes;
    store.global_metrics.satisfaction_rate_percent = parseFloat(((pos / Math.max(1, total)) * 100).toFixed(1));
    store.global_metrics.last_learning_update = new Date().toISOString();

    // Update place affinity
    if (!store.place_affinities[placeId]) {
        store.place_affinities[placeId] = {
            name: placeName || placeId,
            upvotes: 0,
            downvotes: 0,
            weather_affinity: {}
        };
    }

    const record = store.place_affinities[placeId];
    if (placeName && !record.name) record.name = placeName;

    if (isPositive) {
        record.upvotes++;
        const currentAffinity = record.weather_affinity[condKey] || 1.0;
        record.weather_affinity[condKey] = Math.min(2.0, parseFloat((currentAffinity + 0.08).toFixed(2)));
    } else {
        record.downvotes++;
        const currentAffinity = record.weather_affinity[condKey] || 1.0;
        record.weather_affinity[condKey] = Math.max(0.4, parseFloat((currentAffinity - 0.10).toFixed(2)));
    }

    // Add recent event log (keep last 30)
    store.recent_events.unshift({
        timestamp: new Date().toISOString(),
        placeId,
        placeName: record.name,
        city,
        rating: isPositive ? 'thumbs_up' : 'thumbs_down',
        weatherCondition: condKey,
        newAffinityWeight: record.weather_affinity[condKey]
    });
    if (store.recent_events.length > 30) {
        store.recent_events.pop();
    }

    saveStore();

    console.log(`[Learning Loop] 🧠 Feedback logged for "${record.name}": ${rating} (${condKey}). New weight: ${record.weather_affinity[condKey]}`);

    return {
        success: true,
        placeId,
        newWeight: record.weather_affinity[condKey],
        satisfactionRate: store.global_metrics.satisfaction_rate_percent
    };
}

/**
 * Retrieves the learned affinity multiplier for a place given the weather condition
 */
function getLearnedWeight(placeId, weatherCondition = 'clear') {
    if (!placeId || !store.place_affinities[placeId]) return 1.0;
    const condKey = canonicalizeWeather(weatherCondition);
    const aff = store.place_affinities[placeId].weather_affinity?.[condKey];
    return aff !== undefined ? aff : 1.0;
}

/**
 * Automated Factual Grounding Evaluation
 * Compares synthesized itinerary activity titles against the candidate dataset places
 */
function evaluateGroundingScore(itinerary = [], candidatePlaces = []) {
    if (!itinerary || itinerary.length === 0 || !candidatePlaces || candidatePlaces.length === 0) {
        return 100.0;
    }

    let totalActivities = 0;
    let groundedActivities = 0;

    const candidateNames = candidatePlaces.map(p => (p.name || '').toLowerCase().trim());

    itinerary.forEach(day => {
        (day.activities || []).forEach(act => {
            totalActivities++;
            const title = (act.title || '').toLowerCase().trim();
            const desc = (act.description || '').toLowerCase().trim();

            const isGrounded = candidateNames.some(cName => {
                const words = cName.split(/\s+/).filter(w => w.length > 3);
                return title.includes(cName) || cName.includes(title) || 
                       (words.length >= 2 && words.every(w => title.includes(w) || desc.includes(w)));
            });

            if (isGrounded) {
                groundedActivities++;
            }
        });
    });

    const score = (groundedActivities / Math.max(1, totalActivities)) * 100;
    return parseFloat(score.toFixed(1));
}

/**
 * Returns current Learning Loop telemetry & metrics
 */
function getLearningStats() {
    return {
        global_metrics: store.global_metrics,
        total_tracked_places: Object.keys(store.place_affinities).length,
        top_places: Object.entries(store.place_affinities)
            .sort((a, b) => (b[1].upvotes - b[1].downvotes) - (a[1].upvotes - a[1].downvotes))
            .slice(0, 6)
            .map(([id, p]) => ({ id, name: p.name, upvotes: p.upvotes, downvotes: p.downvotes })),
        recent_feedback: store.recent_events.slice(0, 5)
    };
}

module.exports = {
    recordFeedback,
    getLearnedWeight,
    evaluateGroundingScore,
    getLearningStats
};
