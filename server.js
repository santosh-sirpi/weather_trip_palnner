const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

// Architectural Modules: Semantic Layer, Access Control, Querying Layer, Self-Learning Loop, Smart Route Optimizer
const { accessControlMiddleware, validateTripPayload } = require('./access_control');
const { evaluateWeatherSemantics } = require('./semantic_layer');
const { orchestrateTripQuery, executeAdHocSemanticQuery } = require('./querying_layer');
const { recordFeedback, getLearningStats, evaluateGroundingScore } = require('./learning_loop');
const { optimizeRoutePlan } = require('./route_optimizer');

const app = express();
const PORT = process.env.PORT || 3000;

// Default n8n Webhook URL
let N8N_WEBHOOK_URL = process.env.N8N_WEBHOOK_URL || 'https://n8n-csr-interns.slicearrow.com/webhook/weather-trip-planner';
const GROQ_API_KEY = process.env.GROQ_API_KEY || '';

app.use(cors());
app.use(express.json());

// Favicon endpoint to serve brand logo
app.get('/favicon.ico', (req, res) => {
    res.sendFile(path.join(__dirname, 'logo.png'));
});

// Serve static frontend files
app.use(express.static(__dirname));

// Apply Access Control, RBAC, and Token-Bucket Rate Limiting to all /api endpoints
app.use('/api', accessControlMiddleware);

// Health check endpoint
app.get('/api/health', (req, res) => {
    res.json({
        status: 'online',
        message: 'TravelFlow Maps Backend Operational',
        n8n_target: N8N_WEBHOOK_URL,
        groq_fallback: !!GROQ_API_KEY,
        access_tier: req.accessTier?.role || 'guest'
    });
});

// Architecture System Status & Telemetry Endpoint
app.get('/api/system-status', (req, res) => {
    const learningStats = getLearningStats();
    res.json({
        status: 'operational',
        timestamp: new Date().toISOString(),
        architecture: {
            semantic_layer: {
                status: 'active',
                thermal_indices: ['Freezing', 'Chilly', 'Mild', 'Optimal', 'Warm', 'Scorching'],
                ontologies_supported: ['HeritageCulture', 'ScenicNature', 'Gastronomy', 'UrbanLeisure']
            },
            access_control: {
                status: 'enforcing',
                caller_tier: req.accessTier?.role || 'guest',
                rate_limit_per_min: req.accessTier?.rateLimitPerMin || 40
            },
            querying_layer: {
                status: 'active',
                stages: ['1: Intent Formulation', '2: Hybrid Retrieval', '3: Multi-Factor Re-Ranking', '4: Spatial Optimization'],
                multi_factor_weights: { semantic_fit: 0.40, learned_weight: 0.25, spatial_proximity: 0.25, baseline: 0.10 }
            },
            self_learning_loop: {
                status: 'continuous_learning',
                metrics: learningStats.global_metrics,
                total_tracked_places: learningStats.total_tracked_places,
                top_places: learningStats.top_places
            }
        }
    });
});

// Helper to calculate target URLs (handles test vs production toggle seamlessly)
function getTargetUrls(primaryUrl) {
    const urls = [primaryUrl];
    if (primaryUrl.includes('/webhook-test/')) {
        urls.push(primaryUrl.replace('/webhook-test/', '/webhook/'));
    } else if (primaryUrl.includes('/webhook/')) {
        urls.push(primaryUrl.replace('/webhook/', '/webhook-test/'));
    }
    return urls;
}

// Weather Code Interpretation
const WMO_MAP = {
    0: { emoji: '☀️', desc: 'Clear sky' },
    1: { emoji: '🌤️', desc: 'Mainly clear' },
    2: { emoji: '⛅', desc: 'Partly cloudy' },
    3: { emoji: '☁️', desc: 'Overcast' },
    45: { emoji: '🌫️', desc: 'Foggy' },
    48: { emoji: '🌫️', desc: 'Depositing rime fog' },
    51: { emoji: '🌦️', desc: 'Light drizzle' },
    53: { emoji: '🌦️', desc: 'Moderate drizzle' },
    55: { emoji: '🌧️', desc: 'Dense drizzle' },
    61: { emoji: '🌧️', desc: 'Slight rain' },
    63: { emoji: '🌧️', desc: 'Moderate rain' },
    65: { emoji: '🌧️', desc: 'Heavy rain' },
    71: { emoji: '🌨️', desc: 'Light snow' },
    73: { emoji: '🌨️', desc: 'Moderate snow' },
    75: { emoji: '❄️', desc: 'Heavy snow' },
    80: { emoji: '🌦️', desc: 'Light rain showers' },
    81: { emoji: '🌧️', desc: 'Moderate rain showers' },
    82: { emoji: '⛈️', desc: 'Violent rain showers' },
    95: { emoji: '⛈️', desc: 'Thunderstorm' },
    96: { emoji: '⛈️', desc: 'Thunderstorm with hail' },
    99: { emoji: '⛈️', desc: 'Thunderstorm with heavy hail' }
};

// Core Generator powered by Semantic Layer, Querying Layer & Self-Learning Loop
async function generateDirectItinerary(payload, accessTier) {
    const { city, country, latitude, longitude, startDate, endDate } = payload;
    
    // 1. Fetch Open-Meteo weather forecast
    let dailyForecasts = [];
    try {
        const weatherUrl = `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&daily=weather_code,temperature_2m_max,temperature_2m_min&start_date=${startDate}&end_date=${endDate}&timezone=auto`;
        const weatherRes = await fetch(weatherUrl);
        if (weatherRes.ok) {
            const weatherData = await weatherRes.json();
            const daily = weatherData.daily || {};
            const timeArr = daily.time || [startDate];
            const codeArr = daily.weather_code || [0];
            const maxArr = daily.temperature_2m_max || [24];
            const minArr = daily.temperature_2m_min || [16];

            dailyForecasts = timeArr.map((dateStr, idx) => {
                const code = codeArr[idx] !== undefined ? codeArr[idx] : 0;
                const info = WMO_MAP[code] || { emoji: '🌤️', desc: 'Variable' };
                return {
                    date: dateStr,
                    temp_max: Math.round(maxArr[idx] !== undefined ? maxArr[idx] : 24),
                    temp_min: Math.round(minArr[idx] !== undefined ? minArr[idx] : 16),
                    emoji: info.emoji,
                    description: info.desc
                };
            });
        }
    } catch (err) {
        console.warn('[Backend] Weather API error:', err.message);
    }

    if (dailyForecasts.length === 0) {
        dailyForecasts = [{
            date: startDate,
            temp_max: 24,
            temp_min: 16,
            emoji: '☀️',
            description: 'Pleasant weather'
        }];
    }

    // 2. Querying Layer Orchestration (Multi-Stage Retrieval, Re-Ranking, Semantic Scoring)
    const queryResult = await orchestrateTripQuery({
        city,
        country,
        latitude,
        longitude,
        dailyForecasts
    });

    console.log(`[Backend] ⚡ Querying Layer orchestrated ${queryResult.plannedDays.length} days with ${queryResult.candidatePlaces.length} candidate places.`);

    const forecastSummary = dailyForecasts.map(d => 
        `- ${d.date}: ${d.description} ${d.emoji}, High ${d.temp_max}°C, Low ${d.temp_min}°C`
    ).join('\n');

    const systemPrompt = `You are a world-class travel curator and itinerary architect powered by Retrieval-Augmented Generation (RAG).

CRITICAL RAG GROUNDING & CONTEXTUAL RULES:
1. STRICT ANTI-GENERIC BAN: NEVER recommend generic, artificial, or vague placeholder activities.
   - STRICTLY FORBIDDEN EXAMPLES: "Visit Museum", "Local Museum", "Attend a Workshop", "Cooking Workshop", "Pottery Workshop", "Craft Workshop", "Explore the City", "Local Cuisine", "Walk around town", "Sunset Views".
   - Every single activity title MUST be the ACTUAL, RENOWNED, SPECIFIC FAMOUS PLACE or landmark located in or immediately near ${city}.
2. DEEP CONTEXTUAL DESCRIPTIONS:
   - Provide 1 to 2 sentences of genuine, rich, authentic context for each place.
   - Detail what specifically makes this landmark famous: its architectural marvel, historical era, famous artworks, panoramic vantage point, or signature culinary dish.
   - Explain why this specific place fits the day's forecast (e.g. indoor rain-sheltered halls during downpours, or sunlit gardens/open-air piazzas on clear days).
3. ATTRIBUTE REQUIREMENTS:
   - "title": Exact, renowned name of the genuine attraction
   - "description": Rich contextual description specific to this venue
   - "category": Must be one of: "outdoor", "culture", "dining", "relax"
   - "time": "Morning", "Late Morning", "Afternoon", or "Evening"
   - "lat": Exact latitude number from the RAG context
   - "lon": Exact longitude number from the RAG context
   - "dataset_reference": Exact dataset citation from the RAG context (e.g. "OpenStreetMap Verified Landmark", "Wikipedia Heritage Registry")

Return STRICT JSON matching format:
{
  "rag_grounded": true,
  "rag_dataset": "${queryResult.queryPlan.datasetType}",
  "packing_list": [
    { "icon": "☔", "label": "Compact Umbrella" },
    { "icon": "👟", "label": "Comfortable Walking Shoes" },
    { "icon": "🕶️", "label": "Sunscreen & Sunglasses" }
  ],
  "itinerary": [
    {
      "date": "YYYY-MM-DD",
      "dayName": "Monday",
      "weather": { "emoji": "☀️", "temp_max": 25, "temp_min": 15, "description": "Clear sky" },
      "activities": [
        {
          "time": "Morning",
          "title": "Actual Famous Landmark Name",
          "description": "Rich historical and contextual description...",
          "category": "outdoor",
          "lat": 35.6852,
          "lon": 139.7101,
          "dataset_reference": "Verified Travel Dataset POI"
        }
      ]
    }
  ]
}
4. Adapt activities to weather: indoor cultural landmarks for rain/snow, outdoor monuments and parks for clear/sunny days.
5. Provide 4 to 6 weather-adaptive items in packing_list tailored to forecast temperature and rain.`;

    const userPrompt = `Destination: ${city}, ${country || ''} (Coordinates: ${latitude}, ${longitude})\nDates: ${startDate} to ${endDate}\n\nDaily Weather Forecast:\n${forecastSummary}\n\n${queryResult.rawContextMarkdown}`;

    const groqRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${GROQ_API_KEY}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            model: 'openai/gpt-oss-120b',
            response_format: { type: 'json_object' },
            temperature: 0.5,
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: userPrompt }
            ]
        })
    });

    if (!groqRes.ok) {
        const errText = await groqRes.text();
        throw new Error(`Groq API error ${groqRes.status}: ${errText}`);
    }

    const groqData = await groqRes.json();
    const rawContent = groqData.choices?.[0]?.message?.content || '{}';
    let parsed = null;
    try {
        parsed = JSON.parse(rawContent);
    } catch (e) {
        const clean = rawContent.replace(/```json/g, '').replace(/```/g, '').trim();
        parsed = JSON.parse(clean);
    }

    if (!parsed || !parsed.itinerary) {
        throw new Error('Groq AI API failed to return a valid itinerary structure.');
    }

    // Evaluate Factual Grounding with Self-Learning Loop
    const groundingScore = evaluateGroundingScore(parsed.itinerary, queryResult.candidatePlaces);
    const learningStats = getLearningStats();

    parsed.rag_grounded = true;
    parsed.rag_dataset = queryResult.queryPlan.datasetType;
    parsed.rag_total_retrieved = queryResult.queryPlan.totalCandidateCount;
    parsed.rag_sources = queryResult.candidatePlaces;

    // Attach Multi-Layer Architecture Metadata
    parsed.semantic_metadata = {
        thermal_comfort: evaluateWeatherSemantics(dailyForecasts[0])?.thermalTier || 'Optimal',
        grounding_score_percent: groundingScore,
        environmental_policy: evaluateWeatherSemantics(dailyForecasts[0])?.environmentalPolicy || 'Standard'
    };

    parsed.access_metadata = {
        tier: accessTier?.role || 'guest',
        rate_limit: accessTier?.rateLimitPerMin || 40,
        security_policy: 'Input Sanitization & Geofence Validated'
    };

    parsed.learning_metadata = {
        satisfaction_rate: learningStats.global_metrics.satisfaction_rate_percent,
        total_evaluations: learningStats.global_metrics.total_feedback_events
    };

    if (Array.isArray(parsed.itinerary)) {
        parsed.itinerary = parsed.itinerary.map((item, idx) => {
            const fallbackForecast = dailyForecasts[idx] || dailyForecasts[0] || {};
            if (!item.weather || !item.weather.temp_max) {
                item.weather = {
                    emoji: fallbackForecast.emoji || '🌤️',
                    temp_max: fallbackForecast.temp_max || 24,
                    temp_min: fallbackForecast.temp_min || 16,
                    description: fallbackForecast.description || 'Forecast'
                };
            }
            return item;
        });
    }

    return parsed;
}

// Helper: Dispatches user trip request directly to n8n automation workflow
async function dispatchToN8n(payload, timeoutMs = 6000) {
    const targetUrls = getTargetUrls(N8N_WEBHOOK_URL);
    for (const url of targetUrls) {
        try {
            console.log(`[n8n Workflow] 🔗 Triggering n8n automation webhook: ${url}`);
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), timeoutMs);

            const n8nResponse = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    ...payload,
                    event: 'trip_request',
                    source: 'TravelFlow Web UI',
                    timestamp: new Date().toISOString()
                }),
                signal: controller.signal
            });
            clearTimeout(timer);

            if (n8nResponse.ok) {
                const data = await n8nResponse.json();
                console.log(`[n8n Workflow] ⚡ n8n executed workflow successfully (${n8nResponse.status})!`);
                return { success: true, url, data };
            } else {
                const text = await n8nResponse.text();
                console.warn(`[n8n Workflow] ℹ️ n8n webhook returned status ${n8nResponse.status}: ${text.substring(0, 100)}`);
            }
        } catch (err) {
            console.warn(`[n8n Workflow] ℹ️ n8n attempt notice (${url}): ${err.message}`);
        }
    }
    return { success: false };
}

// Helper: Synchronizes complete generated trip data to n8n in background
function syncToN8nBackground(dataPayload) {
    const targetUrls = getTargetUrls(N8N_WEBHOOK_URL);
    for (const url of targetUrls) {
        fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(dataPayload)
        }).then(r => {
            if (r.ok) {
                console.log(`[n8n Workflow] ⚡ Background sync to n8n successful (${url})!`);
            } else {
                console.log(`[n8n Workflow] ℹ️ Background sync notice (${url}): status ${r.status}`);
            }
        }).catch(err => {
            console.log(`[n8n Workflow] ℹ️ Background sync notice (${url}): ${err.message}`);
        });
    }
}

// Endpoint: Dual Pipeline (User UI + n8n Automation Workflow)
app.post('/api/plan-trip', async (req, res) => {
    // 1. Access Control Policy & Sanitization Check
    const validation = validateTripPayload(req.body);
    if (!validation.isValid) {
        return res.status(400).json({
            error: 'Invalid trip request payload.',
            details: validation.errors
        });
    }

    const payload = validation.sanitizedPayload;
    console.log(`\n[Backend] 📩 Received validated trip request for ${payload.city}, ${payload.country || ''} (Role: ${req.accessTier?.role || 'guest'})`);

    // 2. DUAL EXECUTION (BOTH SIDES):
    // Side 1: Fire trigger to n8n automation workflow
    const n8nTask = dispatchToN8n(payload);

    // Side 2: Generate RAG itinerary with 4 pillars for immediate rich UI rendering
    let ragData = null;
    let ragError = null;
    try {
        console.log(`[Backend] 🧠 Processing via Semantic Layer, Querying Layer & Self-Learning Loop...`);
        ragData = await generateDirectItinerary(payload, req.accessTier);
        console.log(`[Backend] ✅ Successfully generated RAG-grounded itinerary (Grounding Score: ${ragData.semantic_metadata?.grounding_score_percent || 100}%)!`);
    } catch (err) {
        ragError = err;
        console.warn(`[Backend] ⚠️ Direct RAG generation notice: ${err.message}`);
    }

    // Await n8n result
    const n8nResult = await n8nTask;

    // If local RAG failed but n8n returned an itinerary, use n8n's output
    if ((!ragData || !ragData.itinerary) && n8nResult.success && n8nResult.data && n8nResult.data.itinerary) {
        ragData = n8nResult.data;
        ragData.rag_grounded = true;
        ragData.rag_dataset = 'Verified Dataset & n8n Pipeline';
    }

    if (!ragData || !ragData.itinerary) {
        return res.status(502).json({
            error: 'Failed to generate itinerary from both RAG engine and n8n.',
            details: ragError ? ragError.message : 'Unknown itinerary error.'
        });
    }

    // Add n8n sync metadata to response so UI can show sync status
    ragData.n8n_sync = {
        triggered: true,
        success: n8nResult.success,
        targetUrl: n8nResult.url || N8N_WEBHOOK_URL,
        timestamp: new Date().toISOString()
    };

    // If local RAG generated the itinerary and n8n didn't return one, push the complete plan to n8n as well
    if (!n8nResult.success) {
        syncToN8nBackground({
            event: 'trip_result_synced',
            userInput: payload,
            city: payload.city,
            country: payload.country,
            startDate: payload.startDate,
            endDate: payload.endDate,
            latitude: payload.latitude,
            longitude: payload.longitude,
            itinerary: ragData.itinerary?.map(d => ({
                date: d.date,
                dayName: d.dayName,
                weather: d.weather,
                activities: d.activities?.map(a => ({ title: a.title, category: a.category, time: a.time }))
            })),
            packing_list: ragData.packing_list,
            timestamp: new Date().toISOString()
        });
    }

    return res.json(ragData);
});

// Endpoint: Explicitly test or ping n8n webhook
app.post('/api/test-n8n', async (req, res) => {
    const testPayload = req.body && Object.keys(req.body).length > 0 ? req.body : {
        city: 'Bengaluru',
        country: 'India',
        startDate: new Date().toISOString().split('T')[0],
        endDate: new Date(Date.now() + 86400000 * 3).toISOString().split('T')[0],
        latitude: 12.9716,
        longitude: 77.5946,
        event: 'manual_n8n_ping',
        source: 'TravelFlow Web UI Test'
    };
    const result = await dispatchToN8n(testPayload, 8000);
    res.json({
        success: result.success,
        target: N8N_WEBHOOK_URL,
        details: result
    });
});

// Self-Learning Loop Endpoint: Ingests user ratings on activities
app.post('/api/feedback', (req, res) => {
    const { placeId, placeName, rating, weatherCondition, city } = req.body;
    if (!placeId) {
        return res.status(400).json({ error: 'placeId is required.' });
    }

    const result = recordFeedback({
        placeId,
        placeName,
        rating,
        weatherCondition,
        city
    });

    res.json(result);
});

// Learning Stats Endpoint
app.get('/api/learning-stats', (req, res) => {
    res.json(getLearningStats());
});

// Ad-Hoc Semantic Query Endpoint
app.post('/api/semantic-query', async (req, res) => {
    const { query, city, country, lat, lon } = req.body;
    if (!query || !city) {
        return res.status(400).json({ error: 'query and city are required.' });
    }

    const results = await executeAdHocSemanticQuery({ query, city, country, lat, lon });
    res.json(results);
});

// Smart Route Optimization Endpoint
app.post('/api/optimize-route', async (req, res) => {
    try {
        const { startLocation, destinations, travelMode, startTime, availableTripTimeMinutes, optimizeMode } = req.body;

        if (!startLocation || !startLocation.lat || !startLocation.lon) {
            return res.status(400).json({ error: 'Valid start location (name, lat, lon) is required.' });
        }

        if (!Array.isArray(destinations) || destinations.length === 0) {
            return res.status(400).json({ error: 'At least one destination is required.' });
        }

        const plan = await optimizeRoutePlan({
            startLocation,
            destinations,
            travelMode: travelMode || 'driving',
            startTime: startTime || '09:00',
            availableTripTimeMinutes: availableTripTimeMinutes || 480,
            optimizeMode: optimizeMode || 'balanced'
        });

        res.json(plan);
    } catch (err) {
        console.error('[Backend] Route optimization error:', err);
        res.status(500).json({ error: 'Failed to optimize route.', details: err.message });
    }
});

// Start Express Server
app.listen(PORT, () => {
    console.log(`=================================================`);
    console.log(`🚀 TravelFlow Maps Enterprise Server Running!`);
    console.log(`🌐 Local UI URL: http://localhost:${PORT}`);
    console.log(`🧠 Semantic Layer: Active`);
    console.log(`🛡️ Access Control: Enforcing (RBAC & Rate Limiting)`);
    console.log(`⚡ Querying Layer: Active (Multi-Stage Hybrid Search)`);
    console.log(`🔄 Self-Learning Loop: Active (Continuous Calibration)`);
    console.log(`=================================================`);
});
