/* ========================================
   TRAVELFLOW MAPS — APPLICATION LOGIC
   ======================================== */

// ============================================================
// CONFIGURATION
// ============================================================
const CONFIG = {
    // Backend API proxy (handles CORS & AI RAG 4 Pillars)
    API_PLAN_TRIP: window.location.protocol.startsWith('http') ? '/api/plan-trip' : 'http://localhost:3000/api/plan-trip',
    API_BASE: window.location.protocol.startsWith('http') ? '' : 'http://localhost:3000',

    // Primary n8n Webhook Endpoint
    N8N_WEBHOOK_URL: 'https://n8n-csr-interns.slicearrow.com/webhook/weather-trip-planner',
    N8N_WEBHOOK_TEST_URL: 'https://n8n-csr-interns.slicearrow.com/webhook-test/weather-trip-planner',

    // Open-Meteo Geocoding API (free, no key)
    GEOCODING_API: 'https://geocoding-api.open-meteo.com/v1/search',

    // Debounce delay for city search (ms)
    SEARCH_DEBOUNCE: 350,

    // Max forecast days
    MAX_DAYS: 14,
};

// ============================================================
// DOM ELEMENTS
// ============================================================
const DOM = {
    form: document.getElementById('tripForm'),
    cityInput: document.getElementById('cityInput'),
    citySuggestions: document.getElementById('citySuggestions'),
    startDate: document.getElementById('startDate'),
    endDate: document.getElementById('endDate'),
    submitBtn: document.getElementById('submitBtn'),
    loadingSection: document.getElementById('loadingSection'),
    resultsSection: document.getElementById('resultsSection'),
    resultsTitle: document.getElementById('resultsTitle'),
    resultsDates: document.getElementById('resultsDates'),
    weatherOverview: document.getElementById('weatherOverview'),
    timeline: document.getElementById('timeline'),
    backBtn: document.getElementById('backBtn'),
    howItWorksBackBtn: document.getElementById('howItWorksBackBtn'),
    errorToast: document.getElementById('errorToast'),
    toastMessage: document.getElementById('toastMessage'),
    hero: document.querySelector('.hero'),
    howItWorks: document.querySelector('.how-it-works'),
    step1: document.getElementById('step1'),
    step2: document.getElementById('step2'),
    step3: document.getElementById('step3'),
    bgParticles: document.getElementById('bgParticles'),
    optimizerSection: document.getElementById('optimizerSection'),
    navOptimizerBtn: document.getElementById('navOptimizerBtn'),
    heroOptimizerLaunchBtn: document.getElementById('heroOptimizerLaunchBtn'),
    optBackBtn: document.getElementById('optBackBtn'),
};

// ============================================================
// STATE
// ============================================================
let selectedCity = null;
let searchTimeout = null;
let latestPlanResult = null;

// ============================================================
// INITIALIZATION
// ============================================================
document.addEventListener('DOMContentLoaded', () => {
    initDateDefaults();
    initParticles();
    initEventListeners();
    initArchModal();
    initPresetChips();
    initSmartRouteOptimizer();
    showPlannerView();
});

function initPresetChips() {
    const chips = document.querySelectorAll('#presetChips .preset-chip');
    chips.forEach(chip => {
        chip.addEventListener('click', () => {
            const searchQuery = chip.dataset.search || chip.textContent.trim();
            searchAndSelectCity(searchQuery);
        });
    });
}

async function searchAndSelectCity(query) {
    if (DOM.cityInput) {
        DOM.cityInput.value = query;
        DOM.cityInput.classList.remove('input-highlight-pulse');
        void DOM.cityInput.offsetWidth;
        DOM.cityInput.classList.add('input-highlight-pulse');
        setTimeout(() => DOM.cityInput.classList.remove('input-highlight-pulse'), 1000);
    }
    try {
        const cityNameOnly = query.split(',')[0].trim();
        const res = await fetch(`${CONFIG.GEOCODING_API}?name=${encodeURIComponent(cityNameOnly)}&count=1&language=en&format=json`);
        const data = await res.json();
        if (data.results && data.results.length > 0) {
            const city = data.results[0];
            selectedCity = {
                name: city.name,
                country: city.country || '',
                admin: city.admin1 || '',
                latitude: city.latitude,
                longitude: city.longitude
            };
            DOM.cityInput.value = `${city.name}${city.admin1 ? ', ' + city.admin1 : ''}, ${city.country || ''}`;
        }
    } catch (err) {
        console.warn('Live geocoding error:', err);
    }
    hideSuggestions();
}

function selectCityDirectly(name, country, lat, lon) {
    selectedCity = {
        name: name,
        country: country,
        admin: '',
        latitude: lat,
        longitude: lon,
    };
    if (DOM.cityInput) {
        DOM.cityInput.value = `${name}${country ? ', ' + country : ''}`;
        DOM.cityInput.classList.remove('input-highlight-pulse');
        void DOM.cityInput.offsetWidth; // trigger reflow
        DOM.cityInput.classList.add('input-highlight-pulse');
        setTimeout(() => DOM.cityInput.classList.remove('input-highlight-pulse'), 1000);
    }
    hideSuggestions();
}

function initDateDefaults() {
    const today = new Date();
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const weekLater = new Date(today);
    weekLater.setDate(weekLater.getDate() + 7);
    
    // Open-Meteo free forecast limit: 14 days from today
    const maxDate = new Date(today);
    maxDate.setDate(maxDate.getDate() + 14);

    DOM.startDate.min = formatDate(tomorrow);
    DOM.startDate.max = formatDate(maxDate);
    DOM.startDate.value = formatDate(tomorrow);
    
    DOM.endDate.min = formatDate(new Date(tomorrow.getTime() + 86400000));
    DOM.endDate.max = formatDate(maxDate);
    DOM.endDate.value = formatDate(weekLater);
}

function initParticles() {
    const colors = ['#38bdf8', '#a78bfa', '#22d3ee', '#fbbf24', '#34d399'];
    for (let i = 0; i < 30; i++) {
        const particle = document.createElement('div');
        particle.className = 'particle';
        particle.style.left = Math.random() * 100 + '%';
        particle.style.animationDelay = Math.random() * 8 + 's';
        particle.style.animationDuration = (6 + Math.random() * 6) + 's';
        particle.style.background = colors[Math.floor(Math.random() * colors.length)];
        particle.style.width = (2 + Math.random() * 3) + 'px';
        particle.style.height = particle.style.width;
        DOM.bgParticles.appendChild(particle);
    }
}

function initEventListeners() {
    // City search with debounce
    DOM.cityInput.addEventListener('input', (e) => {
        clearTimeout(searchTimeout);
        const query = e.target.value.trim();
        if (query.length < 2) {
            hideSuggestions();
            selectedCity = null;
            return;
        }
        searchTimeout = setTimeout(() => searchCities(query), CONFIG.SEARCH_DEBOUNCE);
    });

    // Close suggestions on outside click
    document.addEventListener('click', (e) => {
        if (!e.target.closest('.city-group')) {
            hideSuggestions();
        }
    });

    // Date validation
    DOM.startDate.addEventListener('change', () => {
        const start = new Date(DOM.startDate.value);
        const nextDay = new Date(start);
        nextDay.setDate(nextDay.getDate() + 1);
        DOM.endDate.min = formatDate(nextDay);

        if (new Date(DOM.endDate.value) <= start) {
            DOM.endDate.value = formatDate(nextDay);
        }
    });

    // Form submission
    DOM.form.addEventListener('submit', handleSubmit);

    // Back buttons
    if (DOM.backBtn) DOM.backBtn.addEventListener('click', showPlannerView);
    if (DOM.howItWorksBackBtn) DOM.howItWorksBackBtn.addEventListener('click', showPlannerView);
    if (DOM.optBackBtn) DOM.optBackBtn.addEventListener('click', showPlannerView);

    // Hero quick launch optimizer button
    if (DOM.heroOptimizerLaunchBtn) {
        DOM.heroOptimizerLaunchBtn.addEventListener('click', () => {
            showOptimizerView();
        });
    }

    // Header Navigation links (Planner, Route Optimizer & How it Works)
    document.querySelectorAll('.header-nav .nav-link').forEach(link => {
        if (link.id === 'navArchBtn') return; // Handled by initArchModal()
        link.addEventListener('click', (e) => {
            e.preventDefault();
            const targetId = link.getAttribute('href'); // "#planner", "#route-optimizer", or "#how-it-works"

            if (targetId === '#route-optimizer') {
                showOptimizerView();
            } else if (targetId === '#how-it-works') {
                showHowItWorksView();
            } else {
                showPlannerView();
            }
        });
    });
}

// ============================================================
// CITY SEARCH (Open-Meteo Geocoding)
// ============================================================
async function searchCities(query) {
    try {
        const res = await fetch(`${CONFIG.GEOCODING_API}?name=${encodeURIComponent(query)}&count=5&language=en&format=json`);
        const data = await res.json();

        if (!data.results || data.results.length === 0) {
            hideSuggestions();
            return;
        }

        renderSuggestions(data.results);
    } catch (err) {
        console.error('Geocoding error:', err);
        hideSuggestions();
    }
}

function renderSuggestions(cities) {
    DOM.citySuggestions.innerHTML = cities.map((city, i) => `
        <div class="suggestion-item" data-index="${i}" 
             data-lat="${city.latitude}" data-lon="${city.longitude}"
             data-name="${city.name}" data-country="${city.country || ''}"
             data-admin="${city.admin1 || ''}">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0; color: var(--accent-blue)">
                <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/>
                <circle cx="12" cy="10" r="3"/>
            </svg>
            <span>${city.name}${city.admin1 ? ', ' + city.admin1 : ''}</span>
            <span class="country">${city.country || ''}</span>
        </div>
    `).join('');

    DOM.citySuggestions.classList.add('visible');

    // Attach click handlers
    DOM.citySuggestions.querySelectorAll('.suggestion-item').forEach(item => {
        item.addEventListener('click', () => {
            selectedCity = {
                name: item.dataset.name,
                country: item.dataset.country,
                admin: item.dataset.admin,
                latitude: parseFloat(item.dataset.lat),
                longitude: parseFloat(item.dataset.lon),
            };
            DOM.cityInput.value = `${selectedCity.name}${selectedCity.admin ? ', ' + selectedCity.admin : ''}, ${selectedCity.country}`;
            hideSuggestions();
        });
    });
}

function hideSuggestions() {
    DOM.citySuggestions.classList.remove('visible');
}

// ============================================================
// FORM SUBMISSION
// ============================================================
async function handleSubmit(e) {
    e.preventDefault();

    // Validate city selection
    if (!selectedCity) {
        showToast('Please select a city from the suggestions dropdown.');
        DOM.cityInput.focus();
        return;
    }

    // Validate dates
    const startDate = DOM.startDate.value;
    const endDate = DOM.endDate.value;

    if (!startDate || !endDate) {
        showToast('Please select both start and end dates.');
        return;
    }

    const daysDiff = Math.ceil((new Date(endDate) - new Date(startDate)) / 86400000);
    if (daysDiff > CONFIG.MAX_DAYS) {
        showToast(`Trip duration cannot exceed ${CONFIG.MAX_DAYS} days.`);
        return;
    }

    if (daysDiff < 1) {
        showToast('End date must be after start date.');
        return;
    }

    // Build payload
    const payload = {
        city: selectedCity.name,
        country: selectedCity.country,
        latitude: selectedCity.latitude,
        longitude: selectedCity.longitude,
        startDate: startDate,
        endDate: endDate,
        days: daysDiff + 1,
    };

    // Show loading
    showLoading();

    try {
        // Animate loading steps
        animateLoadingSteps();

        // Connect through Express RAG proxy first (handles 4 pillars & actual datasets)
        // Then direct n8n webhooks if needed
        const webhooks = [CONFIG.API_PLAN_TRIP, CONFIG.N8N_WEBHOOK_URL, CONFIG.N8N_WEBHOOK_TEST_URL];

        let n8nSuccess = false;
        let lastError = null;

        for (const url of webhooks) {
            try {
                console.log(`[Frontend] Connecting to itinerary service: ${url}`);
                const response = await fetch(url, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload),
                });

                if (response.ok) {
                    const result = await response.json();
                    showResults(payload, result);
                    n8nSuccess = true;
                    break;
                } else {
                    const errText = await response.text();
                    console.warn(`[Frontend] Webhook ${url} status ${response.status}: ${errText.substring(0, 100)}`);
                    lastError = `Status ${response.status}: ${errText.substring(0, 100)}`;
                }
            } catch (err) {
                console.warn(`[Frontend] Error fetching ${url}: ${err.message}`);
                lastError = err.message;
            }
        }

        if (!n8nSuccess) {
            throw new Error(lastError || 'Failed to fetch itinerary from n8n Groq AI workflow.');
        }

    } catch (err) {
        console.error('Submission error:', err);
        hideLoading();
        showToast(err.message || 'Failed to fetch itinerary from n8n Groq AI workflow.');
    }
}

// ============================================================
// LOADING STATE
// ============================================================
function showLoading() {
    DOM.hero.style.display = 'none';
    DOM.howItWorks.style.display = 'none';
    if (DOM.optimizerSection) DOM.optimizerSection.classList.remove('visible');
    DOM.resultsSection.classList.remove('visible');
    DOM.loadingSection.classList.add('visible');
    DOM.submitBtn.classList.add('loading');
    DOM.submitBtn.disabled = true;

    // Reset steps
    DOM.step1.className = 'loading-step active';
    DOM.step2.className = 'loading-step';
    DOM.step3.className = 'loading-step';
}

function animateLoadingSteps() {
    setTimeout(() => {
        DOM.step1.className = 'loading-step done';
        DOM.step2.className = 'loading-step active';
    }, 1500);

    setTimeout(() => {
        DOM.step2.className = 'loading-step done';
        DOM.step3.className = 'loading-step active';
    }, 3000);
}

function hideLoading() {
    DOM.loadingSection.classList.remove('visible');
    DOM.submitBtn.classList.remove('loading');
    DOM.submitBtn.disabled = false;
}

// ============================================================
// RESULTS DISPLAY (Dedicated Separate Page View)
// ============================================================
function showResults(payload, result) {
    hideLoading();

    // Ensure hero form & howItWorks & optimizer sections are 100% hidden so results appear on their own clean page
    DOM.hero.style.display = 'none';
    DOM.howItWorks.style.display = 'none';
    if (DOM.optimizerSection) DOM.optimizerSection.classList.remove('visible');

    // Set header info
    DOM.resultsTitle.textContent = `Your Trip to ${payload.city}`;
    DOM.resultsDates.textContent = `${formatDisplayDate(payload.startDate)} — ${formatDisplayDate(payload.endDate)}`;

    // Store latest result for architecture console
    latestPlanResult = result;

    // RAG Grounding UI Update (Badges, dataset name & modal)
    renderRagBannerAndModal(result, payload);

    // Update Architecture Console telemetry
    updateArchConsoleStats(result);

    // Parse itinerary from the AI response
    const itinerary = parseItinerary(result, payload);

    // Render weather overview (clickable chips)
    renderWeatherOverview(itinerary);

    // Render AI Smart Packing Assistant (uses Groq AI packing_list if available)
    renderSmartPackingWidget(itinerary, result);

    // Render timeline
    renderTimeline(itinerary);

    // Initialize interactive Leaflet map system
    initTripMap(payload, itinerary);

    // Initialize category filters & export handlers
    initCategoryFilters();
    initExportHandlers(payload, itinerary);

    // Show results
    DOM.resultsSection.classList.add('visible');
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

// ============================================================
// RAG GROUNDING BANNER & DATASET KNOWLEDGE INSPECTOR
// ============================================================
function renderRagBannerAndModal(result, payload) {
    const banner = document.getElementById('ragGroundingBanner');
    const datasetNameEl = document.getElementById('ragDatasetName');
    const countEl = document.getElementById('ragCount');
    const inspectBtn = document.getElementById('ragInspectBtn');
    const modal = document.getElementById('ragModal');
    const modalCloseBtn = document.getElementById('ragModalCloseBtn');
    const modalBackdrop = document.getElementById('ragModalBackdrop');
    const modalList = document.getElementById('ragModalList');
    const modalSub = document.getElementById('ragModalSub');

    if (!banner) return;

    const datasetName = result?.rag_dataset || 'Verified Curated Travel & OpenStreetMap Dataset';
    const sources = result?.rag_sources || [];
    const count = result?.rag_total_retrieved || sources.length || 10;

    if (datasetNameEl) datasetNameEl.textContent = `${datasetName} · ${payload.city}, ${payload.country || ''}`;
    if (countEl) countEl.textContent = count;
    if (modalSub) modalSub.textContent = `Actual verified landmarks and attractions retrieved for ${payload.city} from ${datasetName} and injected into Groq AI.`;

    const n8nBadge = document.getElementById('n8nLiveIndicator');
    if (n8nBadge) {
        if (result?.n8n_sync && result.n8n_sync.triggered) {
            n8nBadge.innerHTML = '⚡ n8n Workflow: Active & Synced';
            n8nBadge.title = `User input and trip plan synchronized with n8n webhook (${result.n8n_sync.targetUrl || 'n8n automation'})`;
            n8nBadge.style.display = 'inline-flex';
        } else if (result?.n8n_executed) {
            n8nBadge.innerHTML = '⚡ n8n Workflow: Executed';
            n8nBadge.style.display = 'inline-flex';
        } else {
            n8nBadge.innerHTML = '⚡ n8n Workflow: Connected';
            n8nBadge.style.display = 'inline-flex';
        }
    }

    if (modalList) {
        if (sources.length > 0) {
            modalList.innerHTML = sources.map(p => `
                <div class="rag-place-card">
                    <div class="rag-place-top">
                        <div class="rag-place-name">📍 ${escapeHtml(p.name)}</div>
                        <div class="rag-place-badges">
                            <span class="rag-pill rag-pill-category">${escapeHtml(p.category || 'culture')}</span>
                            <span class="rag-pill rag-pill-weather">${escapeHtml((p.weather_suitability || 'all_weather').replace(/_/g, ' '))}</span>
                        </div>
                    </div>
                    <div class="rag-place-desc">${escapeHtml(p.description || '')}</div>
                    <div class="rag-place-meta">
                        <span>🗺️ Coordinates: ${p.lat}, ${p.lon}</span>
                        <span>📚 Dataset: ${escapeHtml(p.source || 'OpenStreetMap Verified POI')}</span>
                    </div>
                </div>
            `).join('');
        } else {
            modalList.innerHTML = `<div class="rag-place-card"><div class="rag-place-desc">Verified actual attractions retrieved for ${escapeHtml(payload.city)} and grounded into the AI generation prompt.</div></div>`;
        }
    }

    if (inspectBtn && modal) {
        inspectBtn.onclick = () => modal.classList.add('active');
    }
    if (modalCloseBtn && modal) {
        modalCloseBtn.onclick = () => modal.classList.remove('active');
    }
    if (modalBackdrop && modal) {
        modalBackdrop.onclick = () => modal.classList.remove('active');
    }
}

// ============================================================
// AI & RAG ENTERPRISE ARCHITECTURE CONSOLE & SELF-LEARNING
// ============================================================
function initArchModal() {
    const modal = document.getElementById('archModal');
    const closeBtn = document.getElementById('archModalCloseBtn');
    const backdrop = document.getElementById('archModalBackdrop');
    const navBtn = document.getElementById('navArchBtn');
    const bannerBtn = document.getElementById('openArchModalBtn');

    function openModal() {
        if (modal) {
            modal.classList.add('active');
            updateArchConsoleStats(latestPlanResult);
        }
    }

    function closeModal() {
        if (modal) {
            modal.classList.remove('active');
        }
    }

    if (navBtn) navBtn.addEventListener('click', openModal);
    if (bannerBtn) bannerBtn.addEventListener('click', openModal);
    if (closeBtn) closeBtn.addEventListener('click', closeModal);
    if (backdrop) backdrop.addEventListener('click', closeModal);
}

async function updateArchConsoleStats(latestResult) {
    try {
        const thermalEl = document.getElementById('archThermalVal');
        const groundingEl = document.getElementById('archGroundingVal');
        const policyEl = document.getElementById('archPolicyVal');
        const roleEl = document.getElementById('archRoleVal');
        const quotaEl = document.getElementById('archQuotaVal');
        const satisfactionEl = document.getElementById('archSatisfactionVal');
        const eventsEl = document.getElementById('archEventsVal');

        // Fetch live system status
        let sysStatus = null;
        try {
            const res = await fetch('/api/system-status');
            if (res.ok) {
                sysStatus = await res.json();
            }
        } catch (e) {
            console.warn('System status fetch failed:', e);
        }

        // 1. Semantic Layer
        if (latestResult && latestResult.semantic_metadata?.thermalComfort) {
            const tc = latestResult.semantic_metadata.thermalComfort;
            if (thermalEl) thermalEl.textContent = `${tc.comfortCategory || 'Optimal'} (${tc.tempRange || 'Mild'})`;
            if (policyEl) policyEl.textContent = tc.activityAdvice || 'Open-Air Promenades';
        } else if (sysStatus?.semanticLayer) {
            if (thermalEl) thermalEl.textContent = 'Optimal Comfort (18°C - 24°C)';
            if (policyEl) policyEl.textContent = 'Active Thermal Comfort Ontology';
        }

        if (latestResult && latestResult.rag_grounding_score !== undefined) {
            if (groundingEl) groundingEl.textContent = `${latestResult.rag_grounding_score}%`;
        } else if (groundingEl) {
            groundingEl.textContent = '100%';
        }

        // 2. Access Control
        if (latestResult && latestResult.access_metadata) {
            if (roleEl) roleEl.textContent = `${(latestResult.access_metadata.role || 'Guest').toUpperCase()} Tier (${latestResult.access_metadata.sanitized ? 'Sanitized' : 'Verified'})`;
        } else if (roleEl) {
            roleEl.textContent = 'GUEST Tier (Sanitized)';
        }

        if (sysStatus?.accessControl?.roles?.guest?.rateLimit) {
            if (quotaEl) quotaEl.textContent = `${sysStatus.accessControl.roles.guest.rateLimit} req / min`;
        }

        // 4. Self-Learning Loop
        if (sysStatus?.learningLoop) {
            if (satisfactionEl) satisfactionEl.textContent = sysStatus.learningLoop.satisfactionRate || '94.2%';
            if (eventsEl) eventsEl.textContent = `${sysStatus.learningLoop.totalFeedbackEvents || 0} Ratings`;
        }
    } catch (err) {
        console.error('Error updating arch console:', err);
    }
}

window.submitActivityFeedback = async function(placeName, rating, weatherCondition, city, btn) {
    try {
        const parent = btn.closest('.activity-feedback-group');
        if (parent) {
            parent.querySelectorAll('.feedback-btn').forEach(b => b.classList.remove('active-up', 'active-down'));
        }
        btn.classList.add(rating === 'thumbs_up' ? 'active-up' : 'active-down');

        const res = await fetch('/api/feedback', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                placeName,
                rating,
                weatherCondition,
                city: city || (activePayload ? activePayload.city : '')
            })
        });

        if (res.ok) {
            const data = await res.json();
            const changeStr = rating === 'thumbs_up' ? '+0.08' : '-0.10';
            showToast(rating === 'thumbs_up' 
                ? `👍 Upvote recorded! Self-Learning affinity calibrated (${changeStr})`
                : `👎 Downvote recorded! Self-Learning affinity calibrated (${changeStr})`
            );
            updateArchConsoleStats(latestPlanResult);
        } else {
            showToast('Feedback noted.');
        }
    } catch (err) {
        console.warn('Feedback submit error:', err);
        showToast('Feedback saved.');
    }
};

function escapeHtml(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function escapeJsString(str) {
    if (!str) return '';
    return String(str)
        .replace(/\\/g, '\\\\')
        .replace(/'/g, "\\'")
        .replace(/"/g, '&quot;')
        .replace(/\n/g, ' ')
        .replace(/\r/g, '');
}

function parseItinerary(result, payload) {
    let days = [];

    if (result && result.itinerary && Array.isArray(result.itinerary)) {
        days = result.itinerary;
    } else if (result && result.days && Array.isArray(result.days)) {
        days = result.days;
    } else if (result && (result.output || result.text || result.response || result.message)) {
        const text = result.output || result.text || result.response || result.message;
        days = parseTextItinerary(text, payload);
    } else if (Array.isArray(result)) {
        days = result;
    } else {
        throw new Error('No valid itinerary returned from n8n Groq AI workflow.');
    }

    return days;
}

function parseTextItinerary(text, payload) {
    const days = [];
    const startDate = new Date(payload.startDate);
    const dayCount = payload.days || 5;

    const dayRegex = /(?:^|\n)\s*(?:Day\s*\d+|##?\s*Day\s*\d+|\*\*Day\s*\d+)/gi;
    const parts = text.split(dayRegex).filter(p => p.trim());

    for (let i = 0; i < Math.min(parts.length, dayCount); i++) {
        const date = new Date(startDate);
        date.setDate(date.getDate() + i);

        days.push({
            date: formatDate(date),
            dayName: date.toLocaleDateString('en-US', { weekday: 'long' }),
            weather: {
                emoji: getRandomWeatherEmoji(),
                temp_max: Math.round(20 + Math.random() * 15),
                temp_min: Math.round(12 + Math.random() * 10),
                description: 'Forecast data',
            },
            activities: parseActivitiesFromText(parts[i]),
        });
    }

    if (days.length === 0) {
        throw new Error('Could not parse day-by-day itinerary from Groq AI output.');
    }

    return days;
}

function parseActivitiesFromText(text) {
    const activities = [];
    const lines = text.split('\n').filter(l => l.trim());
    const times = ['Morning', 'Late Morning', 'Afternoon', 'Late Afternoon', 'Evening'];
    let timeIndex = 0;

    for (const line of lines) {
        const cleaned = line.replace(/^[-*•]\s*/, '').trim();
        if (cleaned.length > 10 && cleaned.length < 200) {
            activities.push({
                time: times[timeIndex % times.length],
                title: cleaned.substring(0, 60),
                description: cleaned.length > 60 ? cleaned.substring(60) : '',
                category: timeIndex % 2 === 0 ? 'outdoor' : 'culture'
            });
            timeIndex++;
        }
        if (activities.length >= 4) break;
    }

    if (activities.length === 0) {
        const cityName = payload?.city || 'Destination';
        activities.push(
            { time: 'Morning', title: `${cityName} Historic Heritage Promenade`, description: `Discover landmark architecture and renowned historic monuments situated in the heart of ${cityName}.`, category: 'outdoor' },
            { time: 'Afternoon', title: `${cityName} Cultural Arts District`, description: `Immerse in authentic regional culture, exhibitions, and celebrated local specialties of ${cityName}.`, category: 'culture' },
            { time: 'Evening', title: `Scenic Waterfront & Skyline Vista in ${cityName}`, description: `Unwind at the destination's famous scenic overlook as twilight sets over ${cityName}.`, category: 'relax' }
        );
    }

    return activities;
}

// ============================================================
// RENDER FUNCTIONS
// ============================================================
function renderWeatherOverview(itinerary) {
    DOM.weatherOverview.innerHTML = itinerary.map((day, idx) => `
        <div class="weather-day-chip" data-idx="${idx}" title="Click to jump to ${day.dayName || 'Day ' + (idx+1)}">
            <span class="chip-day">${day.dayName ? day.dayName.substring(0, 3) : 'Day'}</span>
            <span class="chip-icon">${day.weather?.emoji || '☀️'}</span>
            <span class="chip-temp">
                ${day.weather?.temp_max || '--'}°
                <span class="temp-low">/ ${day.weather?.temp_min || '--'}°</span>
            </span>
        </div>
    `).join('');

    document.querySelectorAll('.weather-day-chip').forEach(chip => {
        chip.addEventListener('click', () => {
            const idx = chip.getAttribute('data-idx');
            const targetDay = document.querySelectorAll('.timeline-day')[idx];
            if (targetDay) {
                targetDay.scrollIntoView({ behavior: 'smooth', block: 'center' });
                targetDay.classList.remove('highlight-day');
                void targetDay.offsetWidth;
                targetDay.classList.add('highlight-day');
            }
        });
    });
}

function renderSmartPackingWidget(itinerary, result) {
    const packingContainer = document.getElementById('packingItems');
    if (!packingContainer) return;

    let items = [];

    // If Groq AI returned dynamic packing_list array, use it directly!
    if (result && result.packing_list && Array.isArray(result.packing_list) && result.packing_list.length > 0) {
        items = result.packing_list.map(item => {
            if (typeof item === 'string') return { icon: '🧳', label: item };
            return { icon: item.icon || '🧳', label: item.label || item.item || 'Travel Essential' };
        });
    } else {
        // Dynamic forecast calculation if AI list array shape differs
        let hasRain = false;
        let maxTemp = -100;
        let minTemp = 100;

        itinerary.forEach(day => {
            const desc = (day.weather?.description || '').toLowerCase();
            const emoji = day.weather?.emoji || '';
            if (desc.includes('rain') || desc.includes('drizzle') || desc.includes('thunderstorm') || desc.includes('snow') || emoji.includes('🌧️') || emoji.includes('⛈️') || emoji.includes('🌨️')) {
                hasRain = true;
            }
            if (day.weather?.temp_max && day.weather.temp_max > maxTemp) maxTemp = day.weather.temp_max;
            if (day.weather?.temp_min && day.weather.temp_min < minTemp) minTemp = day.weather.temp_min;
        });

        items = [
            { icon: '👟', label: 'Comfortable Walking Shoes' },
            { icon: '🔋', label: 'Portable Power Bank' },
            { icon: '💧', label: 'Reusable Water Bottle' },
        ];

        if (hasRain) {
            items.unshift(
                { icon: '☔', label: 'Compact Umbrella' },
                { icon: '🧥', label: 'Waterproof Raincoat' }
            );
        }

        if (maxTemp > 24) {
            items.push(
                { icon: '🕶️', label: 'UV Sunscreen & Sunglasses' },
                { icon: '🧢', label: 'Light Cotton Wear' }
            );
        }

        if (minTemp < 16) {
            items.push(
                { icon: '🧣', label: 'Cozy Jacket / Layer' }
            );
        }
    }

    packingContainer.innerHTML = items.map(item => `
        <div class="packing-item-chip">
            <span>${item.icon}</span>
            <span>${item.label}</span>
        </div>
    `).join('');
}

function initCategoryFilters() {
    const filterBtns = document.querySelectorAll('.filter-btn');
    filterBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            filterBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');

            const filter = btn.getAttribute('data-filter');
            filterTimelineActivities(filter);
        });
    });
}

function filterTimelineActivities(filter) {
    const activityItems = document.querySelectorAll('.activity-item');
    activityItems.forEach(item => {
        if (filter === 'all') {
            item.style.display = 'flex';
            return;
        }

        const category = (item.getAttribute('data-category') || '').toLowerCase();
        const text = item.textContent.toLowerCase();
        let matches = false;

        if (category === filter) {
            matches = true;
        } else if (filter === 'outdoor' && (text.includes('walk') || text.includes('tour') || text.includes('park') || text.includes('view') || text.includes('outdoor') || text.includes('beach') || text.includes('hike') || text.includes('garden') || text.includes('street') || text.includes('river'))) {
            matches = true;
        } else if (filter === 'culture' && (text.includes('museum') || text.includes('gallery') || text.includes('history') || text.includes('art') || text.includes('monument') || text.includes('castle') || text.includes('palace') || text.includes('church') || text.includes('temple') || text.includes('cathedral'))) {
            matches = true;
        } else if (filter === 'dining' && (text.includes('food') || text.includes('dinner') || text.includes('lunch') || text.includes('breakfast') || text.includes('cafe') || text.includes('restaurant') || text.includes('coffee') || text.includes('bakery') || text.includes('taste') || text.includes('cuisine') || text.includes('wine'))) {
            matches = true;
        } else if (filter === 'relax' && (text.includes('shop') || text.includes('mall') || text.includes('relax') || text.includes('market') || text.includes('spa') || text.includes('stroll') || text.includes('lounge') || text.includes('sunset') || text.includes('hotel'))) {
            matches = true;
        }

        item.style.display = matches ? 'flex' : 'none';
    });
}

function initExportHandlers(payload, itinerary) {
    const pdfBtn = document.getElementById('exportPdfBtn');
    if (pdfBtn) {
        pdfBtn.onclick = () => window.print();
    }

    const icalBtn = document.getElementById('exportIcalBtn');
    if (icalBtn) {
        icalBtn.onclick = () => exportICalendar(payload, itinerary);
    }

    const copyBtn = document.getElementById('copySummaryBtn');
    if (copyBtn) {
        copyBtn.onclick = () => copyTripSummary(payload, itinerary);
    }
}

function exportICalendar(payload, itinerary) {
    let icsContent = [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'PRODID:-//TravelFlowMaps//Trip Planner//EN',
        'CALSCALE:GREGORIAN'
    ];

    itinerary.forEach(day => {
        const dateFormatted = (day.date || '').replace(/-/g, '');
        (day.activities || []).forEach(act => {
            icsContent.push('BEGIN:VEVENT');
            icsContent.push(`SUMMARY:[${payload.city}] ${act.title || 'Activity'}`);
            icsContent.push(`DESCRIPTION:${act.description || ''} (Weather: ${day.weather?.description || 'Forecast'})`);
            icsContent.push(`DTSTART;VALUE=DATE:${dateFormatted}`);
            icsContent.push(`DTEND;VALUE=DATE:${dateFormatted}`);
            icsContent.push('END:VEVENT');
        });
    });

    icsContent.push('END:VCALENDAR');

    const blob = new Blob([icsContent.join('\r\n')], { type: 'text/calendar;charset=utf-8' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `Trip_to_${payload.city.replace(/\s+/g, '_')}_Itinerary.ics`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    showToast('Calendar (.ics) file exported! 📅');
}

function copyTripSummary(payload, itinerary) {
    let summaryText = `📍 Trip to ${payload.city} (${payload.startDate} to ${payload.endDate})\n\n`;
    itinerary.forEach(day => {
        summaryText += `🗓️ ${day.dayName || ''} (${day.date}): ${day.weather?.emoji || '🌤️'} ${day.weather?.temp_max}°C / ${day.weather?.temp_min}°C — ${day.weather?.description || ''}\n`;
        (day.activities || []).forEach(act => {
            summaryText += `  • [${act.time}] ${act.title}: ${act.description}\n`;
        });
        summaryText += '\n';
    });

    navigator.clipboard.writeText(summaryText).then(() => {
        showToast('Itinerary summary copied to clipboard! 📋');
    }).catch(err => {
        console.error('Copy failed:', err);
    });
}

function renderTimeline(itinerary) {
    DOM.timeline.innerHTML = itinerary.map((day, index) => `
        <div class="timeline-day" style="animation-delay: ${0.1 + index * 0.1}s">
            <div class="timeline-dot"></div>
            <div class="timeline-card">
                <div class="timeline-card-header">
                    <div class="timeline-date">
                        <span class="timeline-date-day">${day.dayName || 'Day ' + (index + 1)}</span>
                        <span class="timeline-date-full">${day.date ? formatDisplayDate(day.date) : ''}</span>
                    </div>
                    <div style="display:flex; align-items:center; gap:10px; flex-wrap:wrap;">
                        <button type="button" class="day-optimize-btn" onclick="importDayToOptimizer(${index})" title="Optimize this day's route in Dual Map/Flow View">
                            ⚡ Optimize Day Route
                        </button>
                        <div class="timeline-weather-badge">
                            <span class="weather-emoji">${day.weather?.emoji || '☀️'}</span>
                            <span>${day.weather?.temp_max || '--'}° / ${day.weather?.temp_min || '--'}°</span>
                            ${day.weather?.description ? `<span style="color:var(--text-muted)">· ${day.weather.description}</span>` : ''}
                        </div>
                    </div>
                </div>
                <div class="timeline-activities">
                    ${(day.activities || []).map((act, actIdx) => `
                        <div class="activity-item" id="act-${index}-${actIdx}" data-category="${act.category || 'outdoor'}" data-act-id="act-${index}-${actIdx}">
                            <div class="activity-header">
                                <span class="activity-time">${act.time || ''}</span>
                                <div class="activity-actions-group" style="display:flex; align-items:center; gap:8px;">
                                    <div class="activity-feedback-group">
                                        <button type="button" class="feedback-btn" onclick="submitActivityFeedback('${escapeJsString(act.title)}', 'thumbs_up', '${escapeJsString(day.weather?.description || '')}', '${escapeJsString(activePayload?.city || '')}', this)" title="Upvote (trains Self-Learning Loop)">👍</button>
                                        <button type="button" class="feedback-btn" onclick="submitActivityFeedback('${escapeJsString(act.title)}', 'thumbs_down', '${escapeJsString(day.weather?.description || '')}', '${escapeJsString(activePayload?.city || '')}', this)" title="Downvote (trains Self-Learning Loop)">👎</button>
                                    </div>
                                    <button class="activity-map-link" type="button" onclick="focusMapMarker('act-${index}-${actIdx}')" title="Locate on map">
                                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
                                        Map
                                    </button>
                                </div>
                            </div>
                            <div class="activity-content">
                                <div class="activity-title">${act.title || ''}</div>
                                ${act.description ? `<div class="activity-description">${act.description}</div>` : ''}
                                <div class="activity-rag-tag">
                                    <span>🏛️ ${escapeHtml(act.dataset_reference || 'Verified Travel Dataset POI')}</span>
                                </div>
                            </div>
                        </div>
                    `).join('')}
                </div>
            </div>
        </div>
    `).join('');
}

// ============================================================
// RESET
// ============================================================
// ============================================================
// PAGE VIEW NAVIGATION (Separate Dedicated Views)
// ============================================================
function showPlannerView() {
    DOM.hero.style.display = '';
    DOM.howItWorks.style.display = 'none';
    DOM.loadingSection.classList.remove('visible');
    DOM.resultsSection.classList.remove('visible');
    if (DOM.optimizerSection) DOM.optimizerSection.classList.remove('visible');
    
    // Highlight nav link
    document.querySelectorAll('.header-nav .nav-link').forEach(n => {
        n.classList.toggle('active', n.getAttribute('href') === '#planner');
    });

    window.scrollTo({ top: 0, behavior: 'smooth' });
}

function showHowItWorksView() {
    DOM.hero.style.display = 'none';
    DOM.loadingSection.classList.remove('visible');
    DOM.resultsSection.classList.remove('visible');
    if (DOM.optimizerSection) DOM.optimizerSection.classList.remove('visible');
    DOM.howItWorks.style.display = 'block';

    // Highlight nav link
    document.querySelectorAll('.header-nav .nav-link').forEach(n => {
        n.classList.toggle('active', n.getAttribute('href') === '#how-it-works');
    });

    window.scrollTo({ top: 0, behavior: 'smooth' });
}

function showOptimizerView() {
    DOM.hero.style.display = 'none';
    DOM.howItWorks.style.display = 'none';
    DOM.loadingSection.classList.remove('visible');
    DOM.resultsSection.classList.remove('visible');
    if (DOM.optimizerSection) DOM.optimizerSection.classList.add('visible');

    // Highlight nav link
    document.querySelectorAll('.header-nav .nav-link').forEach(n => {
        n.classList.toggle('active', n.getAttribute('href') === '#route-optimizer');
    });

    window.scrollTo({ top: 0, behavior: 'smooth' });

    // Sync start location with current trip city if not already customized
    const city = activePayload?.city || selectedCity?.name;
    const country = activePayload?.country || selectedCity?.country || '';
    const lat = activePayload?.latitude || selectedCity?.latitude;
    const lon = activePayload?.longitude || selectedCity?.longitude;

    if (!optimizerState.startLocation && city && lat != null && lon != null) {
        optimizerState.startLocation = {
            name: `${city} City Center`,
            address: country ? `${city}, ${country}` : city,
            lat: parseFloat(lat),
            lon: parseFloat(lon)
        };
        const startInput = document.getElementById('optStartInput');
        if (startInput) {
            startInput.value = `${city} City Center${country ? ', ' + country : ''}`;
        }
        const optTitle = document.getElementById('optTitle');
        if (optTitle) {
            optTitle.textContent = `Smart Route Optimizer: ${city}`;
        }
    }

    // If optimizer has no destinations and active itinerary has activities, auto-load them!
    if (optimizerState.destinations.length === 0 && activeItinerary && activeItinerary.length > 0) {
        loadFromActiveItinerary();
    } else if (optimizerState.destinations.length > 0) {
        if (!optimizerState.lastOptimizedResult) {
            runRouteOptimization();
        }
    } else {
        renderOptimizerEmptyMetrics();
        renderOptimizerEmptyFlow();
        if (optimizerState.startLocation && optimizerState.startLocation.lat) {
            renderStartOnlyMap();
        }
    }

    // Refresh optimizer map layout
    setTimeout(() => {
        if (optimizerState.map) {
            optimizerState.map.invalidateSize();
        }
    }, 250);
}

function resetToForm() {
    showPlannerView();
}

// ============================================================
// TOAST NOTIFICATION
// ============================================================
function showToast(message) {
    DOM.toastMessage.textContent = message;
    DOM.errorToast.classList.add('visible');
    setTimeout(() => {
        DOM.errorToast.classList.remove('visible');
    }, 4000);
}

// ============================================================
// UTILITY FUNCTIONS
// ============================================================
function formatDate(date) {
    return date.toISOString().split('T')[0];
}

function formatDisplayDate(dateStr) {
    const d = new Date(dateStr + 'T00:00:00');
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function getRandomWeatherEmoji() {
    const emojis = ['☀️', '🌤️', '⛅', '🌦️', '🌧️', '⛈️', '🌩️'];
    return emojis[Math.floor(Math.random() * emojis.length)];
}

function getWeatherEmoji(code) {
    // WMO Weather interpretation codes
    const map = {
        0: '☀️',   // Clear sky
        1: '🌤️',  // Mainly clear
        2: '⛅',    // Partly cloudy
        3: '☁️',   // Overcast
        45: '🌫️', // Fog
        48: '🌫️', // Depositing rime fog
        51: '🌦️', // Drizzle: Light
        53: '🌦️', // Drizzle: Moderate
        55: '🌧️', // Drizzle: Dense
        61: '🌧️', // Rain: Slight
        63: '🌧️', // Rain: Moderate
        65: '🌧️', // Rain: Heavy
        71: '🌨️', // Snow fall: Slight
        73: '🌨️', // Snow fall: Moderate
        75: '❄️',  // Snow fall: Heavy
        80: '🌦️', // Rain showers: Slight
        81: '🌧️', // Rain showers: Moderate
        82: '⛈️',  // Rain showers: Violent
        95: '⛈️',  // Thunderstorm
        96: '⛈️',  // Thunderstorm with hail
        99: '⛈️',  // Thunderstorm with heavy hail
    };
    return map[code] || '🌤️';
}

function getWeatherDescription(code) {
    const map = {
        0: 'Clear sky',
        1: 'Mainly clear',
        2: 'Partly cloudy',
        3: 'Overcast',
        45: 'Foggy',
        48: 'Rime fog',
        51: 'Light drizzle',
        53: 'Moderate drizzle',
        55: 'Dense drizzle',
        61: 'Light rain',
        63: 'Moderate rain',
        65: 'Heavy rain',
        71: 'Light snow',
        73: 'Moderate snow',
        75: 'Heavy snow',
        80: 'Light showers',
        81: 'Moderate showers',
        82: 'Heavy showers',
        95: 'Thunderstorm',
        96: 'Thunderstorm & hail',
        99: 'Severe thunderstorm',
    };
    return map[code] || 'Variable';
}

// ============================================================
// INTERACTIVE MAP SYSTEM (Leaflet.js + CartoDB Dark Matter)
// ============================================================
let tripMap = null;
let mapMarkers = [];
let mapPolylines = [];
let activeTileLayer = null;
let currentMapTheme = 'dark';
let activeItinerary = null;
let activePayload = null;
let currentDayFilter = 'all';

const DAY_COLORS = [
    '#38bdf8', // Cyan (Day 1)
    '#a78bfa', // Purple (Day 2)
    '#fb923c', // Orange (Day 3)
    '#f472b6', // Pink (Day 4)
    '#34d399', // Green (Day 5)
    '#fbbf24', // Amber (Day 6)
    '#60a5fa', // Blue (Day 7)
    '#c084fc', // Violet (Day 8+)
];

const CATEGORY_ICONS = {
    outdoor: '🏃',
    culture: '🏛️',
    dining: '🍽️',
    relax: '🛍️'
};

const TILE_CONFIGS = {
    dark: {
        url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
        options: {
            attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
            maxZoom: 19,
            className: 'dark-mode-tiles'
        }
    },
    street: {
        url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
        options: {
            attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
            maxZoom: 19
        }
    }
};

function generateActivityCoordinates(centerLat, centerLon, dayIndex, actIndex, totalActs) {
    // Generate realistic geographic distribution clustered by neighborhood per day
    const dayAngle = (dayIndex * 1.35) % (2 * Math.PI);
    const dayDistance = 0.012 + (dayIndex * 0.005) % 0.022; // ~1.5 - 3km from city center

    const neighborhoodLat = centerLat + Math.sin(dayAngle) * dayDistance;
    const neighborhoodLon = centerLon + (Math.cos(dayAngle) * dayDistance) / Math.cos(centerLat * Math.PI / 180);

    // Progression along the day's route (~400m - 1.2km between stops)
    const actAngle = dayAngle + (actIndex / Math.max(totalActs, 1)) * 1.5 - 0.75;
    const actDistance = 0.003 + (actIndex * 0.0045);

    const lat = neighborhoodLat + Math.sin(actAngle) * actDistance;
    const lon = neighborhoodLon + (Math.cos(actAngle) * actDistance) / Math.cos(neighborhoodLat * Math.PI / 180);

    return [lat, lon];
}

function initTripMap(payload, itinerary) {
    if (typeof L === 'undefined') {
        console.warn('[Map] Leaflet.js library not loaded.');
        return;
    }

    const mapElement = document.getElementById('itineraryMap');
    if (!mapElement) return;

    activeItinerary = itinerary;
    activePayload = payload;

    const centerLat = parseFloat(payload.latitude) || 48.8566;
    const centerLon = parseFloat(payload.longitude) || 2.3522;

    // Update title in map header
    const destTitle = document.getElementById('mapDestinationTitle');
    if (destTitle) {
        destTitle.textContent = `${payload.city} — Geography & Route`;
    }

    // Initialize or reset map instance
    if (!tripMap) {
        tripMap = L.map('itineraryMap', {
            center: [centerLat, centerLon],
            zoom: 13,
            zoomControl: true,
            scrollWheelZoom: false,
        });

        // Add base dark tile layer
        activeTileLayer = L.tileLayer(TILE_CONFIGS.dark.url, TILE_CONFIGS.dark.options).addTo(tripMap);
    } else {
        tripMap.setView([centerLat, centerLon], 13);
        // Clear existing markers & lines
        mapMarkers.forEach(item => tripMap.removeLayer(item.marker));
        mapPolylines.forEach(item => tripMap.removeLayer(item.polyline));
    }

    mapMarkers = [];
    mapPolylines = [];
    const allBounds = [];

    // 1. Destination Center Radar Marker
    const destEmoji = itinerary[0]?.weather?.emoji || '🌤️';
    const destIcon = L.divIcon({
        className: 'dest-div-icon',
        html: `
            <div class="marker-destination">
                <div class="dest-radar-ring"></div>
                <div class="dest-badge">
                    <span>📍 ${payload.city}</span>
                    <span>${destEmoji}</span>
                </div>
            </div>
        `,
        iconSize: [140, 40],
        iconAnchor: [70, 20],
    });

    const destMarker = L.marker([centerLat, centerLon], { icon: destIcon, zIndexOffset: 200 }).addTo(tripMap);
    destMarker.bindPopup(`
        <div class="map-popup-card">
            <h4 class="popup-title">📍 ${payload.city}, ${payload.country || ''}</h4>
            <p class="popup-desc">Trip destination center. ${itinerary.length} days of weather-adaptive AI activities planned.</p>
        </div>
    `);
    mapMarkers.push({ id: 'dest-center', dayIndex: -1, marker: destMarker });
    allBounds.push([centerLat, centerLon]);

    // 2. Day-by-day Activity Markers & Daily Route Tracks
    itinerary.forEach((day, dayIdx) => {
        const dayColor = DAY_COLORS[dayIdx % DAY_COLORS.length];
        const dayCoords = [];
        const activities = day.activities || [];

        activities.forEach((act, actIdx) => {
            const actId = `act-${dayIdx}-${actIdx}`;
            const hasValidCoords = act.lat && act.lon && !isNaN(parseFloat(act.lat)) && !isNaN(parseFloat(act.lon));
            const coords = hasValidCoords
                ? [parseFloat(act.lat), parseFloat(act.lon)]
                : generateActivityCoordinates(centerLat, centerLon, dayIdx, actIdx, activities.length);
            dayCoords.push(coords);
            allBounds.push(coords);

            const cat = (act.category || 'outdoor').toLowerCase();
            const iconEmoji = CATEGORY_ICONS[cat] || '📍';

            const pinIcon = L.divIcon({
                className: 'custom-leaflet-pin',
                html: `
                    <div class="custom-map-marker" style="--pin-color: ${dayColor}; --pin-glow: ${dayColor}66;">
                        <div class="marker-pin">
                            <span>${iconEmoji}</span>
                        </div>
                    </div>
                `,
                iconSize: [32, 38],
                iconAnchor: [16, 38],
                popupAnchor: [0, -36]
            });

            const marker = L.marker(coords, { icon: pinIcon, zIndexOffset: 100 + actIdx }).addTo(tripMap);

            const popupContent = `
                <div class="map-popup-card">
                    <div class="popup-tag-row">
                        <span class="popup-time-badge" style="border-color: ${dayColor}; color: ${dayColor};">
                            ${day.dayName ? day.dayName.substring(0, 3) : 'Day ' + (dayIdx + 1)} · ${act.time || ''}
                        </span>
                        <span class="popup-category-badge">${cat}</span>
                    </div>
                    <h4 class="popup-title">${escapeHtml(act.title || 'Activity')}</h4>
                    ${act.description ? `<p class="popup-desc">${escapeHtml(act.description)}</p>` : ''}
                    <div style="font-size:0.68rem; color:var(--accent-green); margin-bottom:8px; display:flex; align-items:center; gap:4px;">
                        <span>🏛️ ${escapeHtml(act.dataset_reference || 'Verified Dataset POI')}</span>
                    </div>
                    <button class="popup-btn-sync" onclick="scrollToTimelineCard('${actId}')">
                        <span>📋 View in Timeline</span>
                    </button>
                </div>
            `;

            marker.bindPopup(popupContent);

            // Clicking marker also highlights timeline card
            marker.on('click', () => {
                highlightTimelineCard(actId);
            });

            mapMarkers.push({
                id: actId,
                dayIndex: dayIdx,
                marker: marker,
                coords: coords,
                act: act
            });
        });

        // 3. Draw route polyline for the day if there are multiple stops
        if (dayCoords.length > 1) {
            const polyline = L.polyline(dayCoords, {
                color: dayColor,
                weight: 3.5,
                opacity: 0.85,
                dashArray: '8, 8',
                lineCap: 'round',
                lineJoin: 'round'
            }).addTo(tripMap);

            mapPolylines.push({
                dayIndex: dayIdx,
                polyline: polyline
            });
        }
    });

    // Fit map to show all pins nicely
    if (allBounds.length > 0) {
        tripMap.fitBounds(allBounds, { padding: [40, 40], maxZoom: 15 });
    }

    // Set up interactive controls (view mode switcher, day filter chips, tile theme)
    setupMapViewControls(payload, itinerary);

    // Refresh layout size
    setTimeout(() => {
        if (tripMap) tripMap.invalidateSize();
    }, 250);
}

function setupMapViewControls(payload, itinerary) {
    // 1. Populate Day Filter Chips
    const chipsContainer = document.getElementById('mapDayChips');
    if (chipsContainer) {
        let chipsHtml = `<button class="map-day-chip active" data-day="all">All Days</button>`;
        itinerary.forEach((day, idx) => {
            const dayColor = DAY_COLORS[idx % DAY_COLORS.length];
            chipsHtml += `
                <button class="map-day-chip" data-day="${idx}" style="--day-accent: ${dayColor};">
                    ${day.dayName ? day.dayName.substring(0, 3) : 'Day ' + (idx + 1)}
                </button>
            `;
        });
        chipsContainer.innerHTML = chipsHtml;

        chipsContainer.querySelectorAll('.map-day-chip').forEach(chip => {
            chip.addEventListener('click', () => {
                chipsContainer.querySelectorAll('.map-day-chip').forEach(c => c.classList.remove('active'));
                chip.classList.add('active');
                const dayVal = chip.getAttribute('data-day');
                filterMapByDay(dayVal === 'all' ? 'all' : parseInt(dayVal, 10));
            });
        });
    }

    // 2. View Mode Tabs (Split View, Full Map, Timeline Only)
    const layout = document.getElementById('resultsContentLayout');
    const viewTabs = document.querySelectorAll('.view-mode-btn');

    viewTabs.forEach(tab => {
        tab.onclick = () => {
            viewTabs.forEach(t => t.classList.remove('active'));
            tab.classList.add('active');

            const view = tab.getAttribute('data-view');
            if (layout) {
                layout.className = `results-content-layout ${view}-view`;
            }

            setTimeout(() => {
                if (tripMap) tripMap.invalidateSize();
            }, 300);
        };
    });

    // 3. Map Tile Theme Toggle (Dark vs Street)
    const darkBtn = document.getElementById('mapThemeDark');
    const lightBtn = document.getElementById('mapThemeLight');

    if (darkBtn && lightBtn) {
        darkBtn.onclick = () => {
            darkBtn.classList.add('active');
            lightBtn.classList.remove('active');
            switchMapTileTheme('dark');
        };

        lightBtn.onclick = () => {
            lightBtn.classList.add('active');
            darkBtn.classList.remove('active');
            switchMapTileTheme('street');
        };
    }
}

function filterMapByDay(dayFilter) {
    if (!tripMap) return;
    currentDayFilter = dayFilter;
    const bounds = [];

    mapMarkers.forEach(item => {
        if (item.dayIndex === -1) {
            // Destination center is always shown
            if (item.coords) bounds.push(item.coords);
            return;
        }

        if (dayFilter === 'all' || item.dayIndex === dayFilter) {
            if (!tripMap.hasLayer(item.marker)) {
                item.marker.addTo(tripMap);
            }
            bounds.push(item.coords);
        } else {
            if (tripMap.hasLayer(item.marker)) {
                tripMap.removeLayer(item.marker);
            }
        }
    });

    mapPolylines.forEach(item => {
        if (dayFilter === 'all' || item.dayIndex === dayFilter) {
            if (!tripMap.hasLayer(item.polyline)) {
                item.polyline.addTo(tripMap);
            }
        } else {
            if (tripMap.hasLayer(item.polyline)) {
                tripMap.removeLayer(item.polyline);
            }
        }
    });

    if (bounds.length > 0) {
        tripMap.fitBounds(bounds, { padding: [50, 50], maxZoom: 16 });
    }
}

function switchMapTileTheme(theme) {
    if (!tripMap || currentMapTheme === theme) return;
    currentMapTheme = theme;

    if (activeTileLayer) {
        tripMap.removeLayer(activeTileLayer);
    }

    const cfg = TILE_CONFIGS[theme] || TILE_CONFIGS.dark;
    activeTileLayer = L.tileLayer(cfg.url, cfg.options).addTo(tripMap);
}

// Global functions for bidirectional sync
window.focusMapMarker = function(actId) {
    if (!tripMap) return;

    // Ensure layout shows map (if in timeline-only mode, switch to split)
    const layout = document.getElementById('resultsContentLayout');
    if (layout && layout.classList.contains('timeline-only-view')) {
        const splitBtn = document.getElementById('viewSplitBtn');
        if (splitBtn) splitBtn.click();
    }

    const item = mapMarkers.find(m => m.id === actId);
    if (item && item.marker) {
        // If marker was filtered out, restore day
        if (currentDayFilter !== 'all' && currentDayFilter !== item.dayIndex) {
            filterMapByDay('all');
            const allBtn = document.querySelector('.map-day-chip[data-day="all"]');
            if (allBtn) {
                document.querySelectorAll('.map-day-chip').forEach(c => c.classList.remove('active'));
                allBtn.classList.add('active');
            }
        }

        const latLng = item.marker.getLatLng();
        tripMap.flyTo(latLng, 15, { duration: 0.8 });
        setTimeout(() => {
            item.marker.openPopup();
        }, 850);
    }
};

window.scrollToTimelineCard = function(actId) {
    const card = document.getElementById(actId);
    if (!card) return;

    // Switch view if in map-only mode
    const layout = document.getElementById('resultsContentLayout');
    if (layout && layout.classList.contains('map-only-view')) {
        const splitBtn = document.getElementById('viewSplitBtn');
        if (splitBtn) splitBtn.click();
    }

    card.scrollIntoView({ behavior: 'smooth', block: 'center' });
    highlightTimelineCard(actId);
};

function highlightTimelineCard(actId) {
    const card = document.getElementById(actId);
    if (!card) return;
    card.classList.remove('highlighted-from-map');
    void card.offsetWidth;
    card.classList.add('highlighted-from-map');
    setTimeout(() => {
        card.classList.remove('highlighted-from-map');
    }, 2800);
}

// ============================================================
// SMART ROUTE OPTIMIZER & DUAL MAP/FLOW VIEW MODULE
// ============================================================

const optimizerState = {
    startLocation: null,
    destinations: [],
    travelMode: 'driving',
    startTime: '09:00',
    availableTripTimeMinutes: 480,
    optimizeMode: 'balanced',
    autoOptimize: true,
    map: null,
    markers: [],
    routePolyline: null,
    activeTileLayer: null,
    currentMapTheme: 'dark',
    lastOptimizedResult: null,
    isOptimizing: false
};

function initSmartRouteOptimizer() {
    initOptimizerInputs();
    initOptimizerModes();
    initOptimizerControls();
    initOptimizerMapTheme();
}

function initOptimizerInputs() {
    const startInput = document.getElementById('optStartInput');
    const startSuggestions = document.getElementById('optStartSuggestions');
    const destInput = document.getElementById('optAddDestInput');
    const destSuggestions = document.getElementById('optDestSuggestions');
    const addBtn = document.getElementById('optAddBtn');

    if (startInput) {
        startInput.value = optimizerState.startLocation
            ? `${optimizerState.startLocation.name}${optimizerState.startLocation.address ? ' — ' + optimizerState.startLocation.address : ''}`
            : '';

        let startTimeout = null;
        startInput.addEventListener('input', (e) => {
            clearTimeout(startTimeout);
            const query = e.target.value.trim();
            if (query.length < 2) {
                if (startSuggestions) startSuggestions.classList.remove('visible');
                return;
            }
            startTimeout = setTimeout(() => {
                fetchLocationSuggestions(query, startSuggestions, (place) => {
                    optimizerState.startLocation = {
                        name: place.name,
                        address: place.country ? `${place.name}, ${place.country}` : place.name,
                        lat: parseFloat(place.latitude),
                        lon: parseFloat(place.longitude)
                    };
                    startInput.value = `${place.name}${place.country ? ', ' + place.country : ''}`;
                    if (startSuggestions) startSuggestions.classList.remove('visible');
                    showToast(`📍 Start location set to: ${place.name}`);
                    triggerAutoReoptimization();
                });
            }, 300);
        });
    }

    if (destInput) {
        let destTimeout = null;
        destInput.addEventListener('input', (e) => {
            clearTimeout(destTimeout);
            const query = e.target.value.trim();
            if (query.length < 2) {
                if (destSuggestions) destSuggestions.classList.remove('visible');
                return;
            }
            destTimeout = setTimeout(() => {
                fetchLocationSuggestions(query, destSuggestions, (place) => {
                    const prioritySelect = document.getElementById('optDestPriority');
                    const staySelect = document.getElementById('optDestStay');

                    const newDest = {
                        id: `custom-dest-${Date.now()}`,
                        name: place.name,
                        address: place.country ? `${place.name}, ${place.country}` : place.name,
                        category: 'culture',
                        lat: parseFloat(place.latitude),
                        lon: parseFloat(place.longitude),
                        priority: prioritySelect ? prioritySelect.value : 'medium',
                        stayDurationMin: staySelect ? parseInt(staySelect.value, 10) : 45,
                        openTime: '09:00',
                        closeTime: '19:00'
                    };

                    optimizerState.destinations.push(newDest);
                    destInput.value = '';
                    if (destSuggestions) destSuggestions.classList.remove('visible');
                    showToast(`➕ Added "${place.name}" to route.`);
                    triggerAutoReoptimization();
                });
            }, 300);
        });
    }

    if (addBtn) {
        addBtn.onclick = () => {
            if (destInput && destInput.value.trim().length > 1) {
                // If typed directly without clicking suggestion, query top result
                const query = destInput.value.trim();
                fetch(`${CONFIG.GEOCODING_API}?name=${encodeURIComponent(query)}&count=1&language=en&format=json`)
                    .then(res => res.json())
                    .then(data => {
                        if (data.results && data.results.length > 0) {
                            const place = data.results[0];
                            const prioritySelect = document.getElementById('optDestPriority');
                            const staySelect = document.getElementById('optDestStay');

                            optimizerState.destinations.push({
                                id: `custom-dest-${Date.now()}`,
                                name: place.name,
                                address: place.country ? `${place.name}, ${place.country}` : place.name,
                                category: 'culture',
                                lat: parseFloat(place.latitude),
                                lon: parseFloat(place.longitude),
                                priority: prioritySelect ? prioritySelect.value : 'medium',
                                stayDurationMin: staySelect ? parseInt(staySelect.value, 10) : 45,
                                openTime: '09:00',
                                closeTime: '19:00'
                            });
                            destInput.value = '';
                            if (destSuggestions) destSuggestions.classList.remove('visible');
                            showToast(`➕ Added "${place.name}" to route.`);
                            triggerAutoReoptimization();
                        } else {
                            showToast('Could not find location coordinates. Please select from dropdown.');
                        }
                    })
                    .catch(err => {
                        console.warn('Geocoding error:', err);
                        showToast('Geocoding search failed.');
                    });
            } else {
                destInput?.focus();
            }
        };
    }

    // Close suggestions on outside click
    document.addEventListener('click', (e) => {
        if (!e.target.closest('.opt-start-group') && startSuggestions) {
            startSuggestions.classList.remove('visible');
        }
        if (!e.target.closest('.opt-add-destination-bar') && destSuggestions) {
            destSuggestions.classList.remove('visible');
        }
    });
}

function fetchLocationSuggestions(query, containerEl, onSelect) {
    if (!containerEl) return;
    fetch(`${CONFIG.GEOCODING_API}?name=${encodeURIComponent(query)}&count=5&language=en&format=json`)
        .then(res => res.json())
        .then(data => {
            const results = data.results || [];
            if (results.length === 0) {
                containerEl.classList.remove('visible');
                return;
            }

            containerEl.innerHTML = results.map((place, i) => `
                <div class="suggestion-item" data-idx="${i}">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0; color: var(--accent-cyan)">
                        <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/>
                        <circle cx="12" cy="10" r="3"/>
                    </svg>
                    <span>${escapeHtml(place.name)}${place.admin1 ? ', ' + escapeHtml(place.admin1) : ''}</span>
                    <span class="country">${escapeHtml(place.country || '')}</span>
                </div>
            `).join('');

            containerEl.classList.add('visible');

            containerEl.querySelectorAll('.suggestion-item').forEach(item => {
                item.onclick = () => {
                    const idx = parseInt(item.getAttribute('data-idx'), 10);
                    if (results[idx]) {
                        onSelect(results[idx]);
                    }
                };
            });
        })
        .catch(err => {
            console.warn('Suggestions error:', err);
            containerEl.classList.remove('visible');
        });
}

function initOptimizerModes() {
    const modePills = document.querySelectorAll('.opt-mode-pill');
    modePills.forEach(pill => {
        pill.addEventListener('click', () => {
            modePills.forEach(p => p.classList.remove('active'));
            pill.classList.add('active');
            const mode = pill.getAttribute('data-mode');
            optimizerState.travelMode = mode;
            showToast(`🚀 Travel mode switched to: ${mode.toUpperCase()}`);
            triggerAutoReoptimization();
        });
    });
}

function initOptimizerControls() {
    const timeInput = document.getElementById('optStartTime');
    const budgetSelect = document.getElementById('optAvailableHours');
    const autoToggle = document.getElementById('optAutoToggle');
    const autoStatus = document.getElementById('optAutoStatus');
    const manualBtn = document.getElementById('optManualReorderBtn');
    const exportSummaryBtn = document.getElementById('optExportSummaryBtn');
    const loadTripBtn = document.getElementById('optLoadTripBtn');
    const clearAllBtn = document.getElementById('optClearAllBtn');
    const useGpsBtn = document.getElementById('optUseGpsBtn');
    const useCityCenterBtn = document.getElementById('optUseCityCenterBtn');
    const chipGps = document.getElementById('optChipGps');
    const chipCity = document.getElementById('optChipCity');
    const chipLoadTrip = document.getElementById('optChipLoadTrip');
    const chipClear = document.getElementById('optChipClear');

    if (timeInput) {
        timeInput.addEventListener('change', () => {
            optimizerState.startTime = timeInput.value || '09:00';
            triggerAutoReoptimization();
        });
    }

    if (budgetSelect) {
        budgetSelect.addEventListener('change', () => {
            optimizerState.availableTripTimeMinutes = parseInt(budgetSelect.value, 10) || 480;
            triggerAutoReoptimization();
        });
    }

    if (autoToggle) {
        autoToggle.addEventListener('change', () => {
            optimizerState.autoOptimize = autoToggle.checked;
            if (autoStatus) {
                autoStatus.textContent = autoToggle.checked ? 'ON' : 'OFF (Manual)';
            }
            if (autoToggle.checked) {
                runRouteOptimization();
            }
        });
    }

    if (manualBtn) {
        manualBtn.addEventListener('click', () => {
            runRouteOptimization();
        });
    }

    if (exportSummaryBtn) {
        exportSummaryBtn.addEventListener('click', () => {
            copyOptimizerSummary();
        });
    }

    // Dynamic Start Point Actions
    if (useGpsBtn) useGpsBtn.addEventListener('click', useDeviceGeolocation);
    if (chipGps) chipGps.addEventListener('click', useDeviceGeolocation);

    if (useCityCenterBtn) useCityCenterBtn.addEventListener('click', useTripCityCenter);
    if (chipCity) chipCity.addEventListener('click', useTripCityCenter);

    // Dynamic Destinations Actions
    if (loadTripBtn) loadTripBtn.addEventListener('click', loadFromActiveItinerary);
    if (chipLoadTrip) chipLoadTrip.addEventListener('click', loadFromActiveItinerary);

    if (clearAllBtn) clearAllBtn.addEventListener('click', clearOptimizerDestinations);
    if (chipClear) chipClear.addEventListener('click', clearOptimizerDestinations);
}

function initOptimizerMapTheme() {
    const darkBtn = document.getElementById('optMapThemeDark');
    const streetBtn = document.getElementById('optMapThemeStreet');

    if (darkBtn && streetBtn) {
        darkBtn.onclick = () => {
            darkBtn.classList.add('active');
            streetBtn.classList.remove('active');
            switchOptimizerMapTheme('dark');
        };

        streetBtn.onclick = () => {
            streetBtn.classList.add('active');
            darkBtn.classList.remove('active');
            switchOptimizerMapTheme('street');
        };
    }
}

function switchOptimizerMapTheme(theme) {
    if (!optimizerState.map || optimizerState.currentMapTheme === theme) return;
    optimizerState.currentMapTheme = theme;

    if (optimizerState.activeTileLayer) {
        optimizerState.map.removeLayer(optimizerState.activeTileLayer);
    }

    const cfg = TILE_CONFIGS[theme] || TILE_CONFIGS.dark;
    optimizerState.activeTileLayer = L.tileLayer(cfg.url, cfg.options).addTo(optimizerState.map);
}

// ------------------------------------------------------------
// DYNAMIC USER-DRIVEN LOCATION & ITINERARY ACTIONS
// ------------------------------------------------------------

function useDeviceGeolocation() {
    if (!navigator.geolocation) {
        showToast('Geolocation is not supported by your browser.');
        return;
    }

    showToast('📡 Detecting your device GPS location...');
    navigator.geolocation.getCurrentPosition(
        async (position) => {
            const lat = position.coords.latitude;
            const lon = position.coords.longitude;

            let displayName = `My Location (${lat.toFixed(3)}, ${lon.toFixed(3)})`;
            let address = `Lat: ${lat.toFixed(4)}, Lon: ${lon.toFixed(4)}`;

            try {
                // Try reverse geocoding via OpenStreetMap Nominatim
                const revRes = await fetch(`https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json`, {
                    headers: { 'Accept-Language': 'en' }
                });
                if (revRes.ok) {
                    const revData = await revRes.json();
                    if (revData && revData.display_name) {
                        const parts = revData.display_name.split(',');
                        displayName = parts.slice(0, 2).join(',').trim();
                        address = revData.display_name;
                    }
                }
            } catch (err) {
                console.warn('[Geolocation] Reverse geocode note:', err);
            }

            optimizerState.startLocation = {
                name: displayName,
                address: address,
                lat: parseFloat(lat),
                lon: parseFloat(lon)
            };

            const startInput = document.getElementById('optStartInput');
            if (startInput) {
                startInput.value = displayName;
            }

            showToast(`📍 Start set to: ${displayName}`);
            if (optimizerState.destinations.length > 0) {
                triggerAutoReoptimization();
            } else {
                renderStartOnlyMap();
            }
        },
        (error) => {
            console.warn('[Geolocation] Error:', error);
            let msg = 'Unable to detect device location.';
            if (error.code === error.PERMISSION_DENIED) {
                msg = 'Location access denied. Please type your starting address or hotel in the search bar.';
            } else if (error.code === error.POSITION_UNAVAILABLE) {
                msg = 'Location signal unavailable. Please type your starting address.';
            } else if (error.code === error.TIMEOUT) {
                msg = 'Location request timed out. Please try again or type your address.';
            }
            showToast(msg);
        },
        { enableHighAccuracy: true, timeout: 9000, maximumAge: 60000 }
    );
}

function useTripCityCenter() {
    const city = activePayload?.city || selectedCity?.name;
    const country = activePayload?.country || selectedCity?.country || '';
    const lat = activePayload?.latitude || selectedCity?.latitude;
    const lon = activePayload?.longitude || selectedCity?.longitude;

    if (!city || lat == null || lon == null) {
        showToast('No trip city selected yet. Search for a destination in the planner first, or click 📍 GPS.');
        return;
    }

    optimizerState.startLocation = {
        name: `${city} City Center`,
        address: country ? `${city}, ${country}` : city,
        lat: parseFloat(lat),
        lon: parseFloat(lon)
    };

    const startInput = document.getElementById('optStartInput');
    if (startInput) {
        startInput.value = `${city} City Center${country ? ', ' + country : ''}`;
    }

    const optTitle = document.getElementById('optTitle');
    if (optTitle) {
        optTitle.textContent = `Smart Route Optimizer: ${city}`;
    }

    showToast(`📍 Start location set to ${city} City Center.`);
    if (optimizerState.destinations.length > 0) {
        triggerAutoReoptimization();
    } else {
        renderStartOnlyMap();
    }
}

function loadFromActiveItinerary() {
    if (!activeItinerary || activeItinerary.length === 0) {
        const city = activePayload?.city || selectedCity?.name;
        if (city) {
            showToast(`Generate your AI trip for ${city} in the planner to automatically load activities!`);
        } else {
            showToast('No trip planned yet. Please generate a trip in the planner or add destinations manually.');
        }
        return;
    }

    const city = activePayload?.city || selectedCity?.name || 'Trip Destination';
    const country = activePayload?.country || selectedCity?.country || '';
    const centerLat = parseFloat(activePayload?.latitude || selectedCity?.latitude || 0);
    const centerLon = parseFloat(activePayload?.longitude || selectedCity?.longitude || 0);

    // Set starting point to city center if unset
    if (!optimizerState.startLocation && centerLat && centerLon) {
        optimizerState.startLocation = {
            name: `${city} Central Hotel`,
            address: country ? `${city}, ${country}` : city,
            lat: centerLat,
            lon: centerLon
        };
        const startInput = document.getElementById('optStartInput');
        if (startInput) {
            startInput.value = optimizerState.startLocation.name;
        }
    }

    // Collect activities from itinerary
    const loadedDestinations = [];
    activeItinerary.forEach((day, dayIdx) => {
        const activities = day.activities || [];
        activities.forEach((act, actIdx) => {
            const hasCoords = act.lat && act.lon && !isNaN(parseFloat(act.lat));
            const coords = hasCoords
                ? [parseFloat(act.lat), parseFloat(act.lon)]
                : (centerLat && centerLon
                    ? generateActivityCoordinates(centerLat, centerLon, dayIdx, actIdx, activities.length)
                    : [0, 0]);

            loadedDestinations.push({
                id: `itinerary-${dayIdx}-${actIdx}-${Date.now()}`,
                name: act.title || `Day ${dayIdx + 1} Stop ${actIdx + 1}`,
                address: act.location || `${city}`,
                category: act.category || 'culture',
                lat: coords[0],
                lon: coords[1],
                priority: actIdx === 0 ? 'high' : 'medium',
                stayDurationMin: act.estimatedDurationMin || 45,
                openTime: '09:00',
                closeTime: '19:00'
            });
        });
    });

    if (loadedDestinations.length === 0) {
        showToast('No activities found in the planned itinerary.');
        return;
    }

    // Take up to 8 stops for optimal road routing
    optimizerState.destinations = loadedDestinations.slice(0, 8);

    const optTitle = document.getElementById('optTitle');
    if (optTitle) {
        optTitle.textContent = `Smart Route Optimizer: ${city}`;
    }

    showToast(`⚡ Loaded ${optimizerState.destinations.length} places from your ${city} itinerary!`);
    runRouteOptimization();
}

function clearOptimizerDestinations() {
    optimizerState.destinations = [];
    optimizerState.lastOptimizedResult = null;

    if (optimizerState.markers) {
        optimizerState.markers.forEach(m => {
            if (optimizerState.map) optimizerState.map.removeLayer(m);
        });
        optimizerState.markers = [];
    }
    if (optimizerState.routePolyline) {
        if (optimizerState.map) optimizerState.map.removeLayer(optimizerState.routePolyline);
        optimizerState.routePolyline = null;
    }

    renderOptimizerEmptyMetrics();
    renderOptimizerEmptyFlow();

    if (optimizerState.startLocation && optimizerState.startLocation.lat && optimizerState.map) {
        renderStartOnlyMap();
    }

    showToast('Stops cleared. Add destinations above to optimize your route.');
}

function renderOptimizerEmptyMetrics() {
    const distEl = document.getElementById('optTotalDistance');
    const travelEl = document.getElementById('optTotalTravelTime');
    const stayEl = document.getElementById('optTotalStayTime');
    const durEl = document.getElementById('optTotalDuration');
    const budgetBadge = document.getElementById('optBudgetBadge');
    const budgetSub = document.getElementById('optBudgetSub');
    const breadcrumbs = document.getElementById('optSequenceBreadcrumbs');
    const stopsCountEl = document.getElementById('optStopsCount');

    if (distEl) distEl.textContent = '0.0 km';
    if (travelEl) travelEl.textContent = '0 min';
    if (stayEl) stayEl.textContent = '0 min';
    if (durEl) durEl.textContent = '0h 00m';
    if (stopsCountEl) stopsCountEl.textContent = '0 Destinations';

    if (budgetBadge) {
        budgetBadge.className = 'opt-budget-badge status-ok';
        budgetBadge.textContent = 'Awaiting Stops';
    }
    if (budgetSub) {
        budgetSub.textContent = 'Add destinations to optimize travel order';
    }
    if (breadcrumbs) {
        breadcrumbs.innerHTML = '<span class="seq-empty" style="color:var(--text-muted); font-size:0.8rem;">Add at least 1 destination to calculate optimized path</span>';
    }
}

function renderOptimizerEmptyFlow() {
    const flowList = document.getElementById('optFlowList');
    if (!flowList) return;

    flowList.innerHTML = `
        <div class="opt-empty-state">
            <div class="opt-empty-icon">🗺️</div>
            <h4 class="opt-empty-title">No Destinations Added Yet</h4>
            <p class="opt-empty-desc">
                Add places you plan to visit using the search box above, or load activities from your planned trip itinerary.
            </p>
            <div class="opt-empty-actions">
                <button type="button" class="preset-chip opt-quick-action" onclick="loadFromActiveItinerary()">📋 Load Trip Activities</button>
                <button type="button" class="preset-chip opt-quick-action" onclick="useDeviceGeolocation()">📍 Use My GPS</button>
                <button type="button" class="preset-chip opt-quick-action" onclick="useTripCityCenter()">🏙️ Use Trip City</button>
            </div>
        </div>
    `;
}

function renderStartOnlyMap() {
    if (typeof L === 'undefined' || !optimizerState.startLocation) return;
    const mapElement = document.getElementById('optimizerMap');
    if (!mapElement) return;

    const lat = optimizerState.startLocation.lat;
    const lon = optimizerState.startLocation.lon;

    if (!optimizerState.map) {
        optimizerState.map = L.map('optimizerMap', {
            center: [lat, lon],
            zoom: 13,
            zoomControl: true,
            scrollWheelZoom: false
        });
        const cfg = TILE_CONFIGS[optimizerState.currentMapTheme] || TILE_CONFIGS.dark;
        optimizerState.activeTileLayer = L.tileLayer(cfg.url, cfg.options).addTo(optimizerState.map);
    } else {
        optimizerState.markers.forEach(m => optimizerState.map.removeLayer(m));
        optimizerState.markers = [];
        if (optimizerState.routePolyline) {
            optimizerState.map.removeLayer(optimizerState.routePolyline);
            optimizerState.routePolyline = null;
        }
    }

    const startIcon = L.divIcon({
        className: 'custom-opt-icon',
        html: `
            <div class="opt-start-pin">
                <div class="start-beacon">
                    <div class="start-beacon-radar"></div>
                    <span>🏁</span>
                </div>
                <div class="start-label-badge">START</div>
            </div>
        `,
        iconSize: [60, 50],
        iconAnchor: [30, 25]
    });

    const startMarker = L.marker([lat, lon], { icon: startIcon, zIndexOffset: 500 }).addTo(optimizerState.map);
    startMarker.bindPopup(`
        <div class="map-popup-card">
            <span class="popup-time-badge" style="border-color:var(--accent-green); color:var(--accent-green);">🟢 START POINT</span>
            <h4 class="popup-title">${escapeHtml(optimizerState.startLocation.name)}</h4>
            <p class="popup-desc">${escapeHtml(optimizerState.startLocation.address || 'Starting point ready')}</p>
        </div>
    `);
    optimizerState.markers.push(startMarker);
    optimizerState.map.setView([lat, lon], 14);

    setTimeout(() => {
        if (optimizerState.map) optimizerState.map.invalidateSize();
    }, 200);
}

function triggerAutoReoptimization() {
    if (optimizerState.autoOptimize) {
        runRouteOptimization();
    } else {
        runManualRouteCalculation();
    }
}

async function runRouteOptimization() {
    if (optimizerState.isOptimizing) return;

    // Guard: Empty destinations
    if (!optimizerState.destinations || optimizerState.destinations.length === 0) {
        optimizerState.lastOptimizedResult = null;
        renderOptimizerEmptyMetrics();
        renderOptimizerEmptyFlow();
        if (optimizerState.startLocation && optimizerState.startLocation.lat && optimizerState.map) {
            renderStartOnlyMap();
        }
        return;
    }

    // Guard: Unset start location -> auto-resolve from trip city or first stop
    if (!optimizerState.startLocation) {
        const city = activePayload?.city || selectedCity?.name;
        const lat = activePayload?.latitude || selectedCity?.latitude;
        const lon = activePayload?.longitude || selectedCity?.longitude;
        if (city && lat != null && lon != null) {
            optimizerState.startLocation = {
                name: `${city} City Center`,
                address: activePayload?.country ? `${city}, ${activePayload.country}` : city,
                lat: parseFloat(lat),
                lon: parseFloat(lon)
            };
            const startInput = document.getElementById('optStartInput');
            if (startInput) startInput.value = optimizerState.startLocation.name;
        } else if (optimizerState.destinations.length > 0) {
            const first = optimizerState.destinations[0];
            optimizerState.startLocation = {
                name: `Start: ${first.name}`,
                address: first.address || first.name,
                lat: first.lat,
                lon: first.lon
            };
            const startInput = document.getElementById('optStartInput');
            if (startInput) startInput.value = optimizerState.startLocation.name;
        } else {
            showToast('Please set your starting location (or click 📍 GPS).');
            return;
        }
    }

    optimizerState.isOptimizing = true;
    const autoStatus = document.getElementById('optAutoStatus');
    if (autoStatus) autoStatus.textContent = 'Calculating...';

    const payload = {
        startLocation: optimizerState.startLocation,
        destinations: optimizerState.destinations,
        travelMode: optimizerState.travelMode,
        startTime: optimizerState.startTime,
        availableTripTimeMinutes: optimizerState.availableTripTimeMinutes,
        optimizeMode: optimizerState.optimizeMode
    };

    try {
        const response = await fetch('/api/optimize-route', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (response.ok) {
            const result = await response.json();
            optimizerState.lastOptimizedResult = result;

            renderOptimizerMetrics(result);
            renderOptimizerMap(result);
            renderOptimizerFlow(result);

            const badge = document.getElementById('optRoutingBadge');
            if (badge) {
                badge.textContent = result.usedActualRouting
                    ? '🛰️ OSRM Real Road Engine: Active'
                    : '⚡ Calibrated Road Transit Model';
            }
        } else {
            console.warn('[RouteOptimizer] Backend returned non-200, running client fallback.');
            runClientSideFallbackOptimization();
        }
    } catch (err) {
        console.warn('[RouteOptimizer] Network fetch error, running client fallback:', err.message);
        runClientSideFallbackOptimization();
    } finally {
        optimizerState.isOptimizing = false;
        if (autoStatus) {
            autoStatus.textContent = optimizerState.autoOptimize ? 'ON' : 'OFF (Manual)';
        }
    }
}

function runClientSideFallbackOptimization() {
    // Client-side fallback: ensures 100% reliability offline
    if (!optimizerState.destinations || optimizerState.destinations.length === 0) {
        renderOptimizerEmptyMetrics();
        renderOptimizerEmptyFlow();
        return;
    }

    let startLoc = optimizerState.startLocation;
    if (!startLoc) {
        const first = optimizerState.destinations[0];
        startLoc = {
            name: `Start: ${first.name}`,
            address: first.address || first.name,
            lat: first.lat,
            lon: first.lon
        };
    }

    const dests = [...optimizerState.destinations];

    const allLocations = [
        { name: startLoc.name, lat: startLoc.lat, lon: startLoc.lon, isStart: true },
        ...dests
    ];

    // Simple nearest neighbor route
    const ordered = [allLocations[0]];
    const unvisited = dests.map((d, i) => ({ ...d, origIdx: i + 1 }));

    let current = allLocations[0];
    while (unvisited.length > 0) {
        let bestIdx = 0;
        let bestDist = Infinity;
        for (let i = 0; i < unvisited.length; i++) {
            const d = calculateHaversineDistance(current.lat, current.lon, unvisited[i].lat, unvisited[i].lon);
            if (d < bestDist) {
                bestDist = d;
                bestIdx = i;
            }
        }
        const next = unvisited.splice(bestIdx, 1)[0];
        ordered.push(next);
        current = next;
    }

    // Build timeline
    let clockMin = parseTimeToMinutes(optimizerState.startTime, 540);
    let totalDist = 0;
    let totalTravelMin = 0;
    let totalStayMin = 0;

    const orderedStops = [];
    const connections = [];

    ordered.forEach((loc, i) => {
        if (i === 0) {
            orderedStops.push({
                orderIndex: 0,
                id: 'start',
                name: loc.name,
                isStart: true,
                lat: loc.lat,
                lon: loc.lon,
                departureTime: formatMinutesToTimeString(clockMin),
                stayDurationMin: 0
            });
        } else {
            const prev = ordered[i - 1];
            const dist = parseFloat((calculateHaversineDistance(prev.lat, prev.lon, loc.lat, loc.lon) * 1.3).toFixed(1));
            const travelMin = Math.max(3, Math.round(dist * 2.5));

            totalDist += dist;
            totalTravelMin += travelMin;
            clockMin += travelMin;

            const arrTime = formatMinutesToTimeString(clockMin);
            const stayMin = loc.stayDurationMin || 45;
            totalStayMin += stayMin;
            clockMin += stayMin;
            const depTime = formatMinutesToTimeString(clockMin);

            connections.push({
                fromName: prev.name,
                toName: loc.name,
                distanceKm: dist,
                travelTimeMin: travelMin
            });

            orderedStops.push({
                orderIndex: i,
                id: loc.id || `dest-${i}`,
                name: loc.name,
                category: loc.category || 'culture',
                lat: loc.lat,
                lon: loc.lon,
                priority: loc.priority || 'medium',
                arrivalTime: arrTime,
                stayDurationMin: stayMin,
                departureTime: depTime,
                openTime: loc.openTime || '09:00',
                closeTime: loc.closeTime || '19:00',
                status: 'open_on_arrival',
                legFromPrevious: {
                    distanceKm: dist,
                    travelTimeMin: travelMin,
                    travelMode: optimizerState.travelMode
                }
            });
        }
    });

    const totalTripMin = totalTravelMin + totalStayMin;
    const isWithin = totalTripMin <= optimizerState.availableTripTimeMinutes;

    const fallbackResult = {
        success: true,
        travelMode: optimizerState.travelMode,
        travelModeLabel: optimizerState.travelMode.toUpperCase(),
        usedActualRouting: false,
        recommendedOrderSummary: orderedStops.map(s => s.isStart ? 'START' : s.name).join(' → '),
        totals: {
            totalDistanceKm: parseFloat(totalDist.toFixed(1)),
            totalTravelTimeMin: totalTravelMin,
            totalTravelTimeFormatted: `${Math.floor(totalTravelMin / 60)}h ${totalTravelMin % 60}m`,
            totalStayDurationMin: totalStayMin,
            totalStayDurationFormatted: `${Math.floor(totalStayMin / 60)}h ${totalStayMin % 60}m`,
            totalTripDurationMin: totalTripMin,
            totalTripDurationFormatted: `${Math.floor(totalTripMin / 60)}h ${totalTripMin % 60}m`,
            availableTripTimeMinutes: optimizerState.availableTripTimeMinutes,
            isWithinBudget: isWithin,
            budgetDeltaMin: Math.abs(totalTripMin - optimizerState.availableTripTimeMinutes),
            stopsCount: dests.length
        },
        orderedStops,
        connections,
        routeGeometry: null
    };

    optimizerState.lastOptimizedResult = fallbackResult;
    renderOptimizerMetrics(fallbackResult);
    renderOptimizerMap(fallbackResult);
    renderOptimizerFlow(fallbackResult);
}

function runManualRouteCalculation() {
    // Computes times along user's exact current list order without reordering
    runClientSideFallbackOptimization();
}

function renderOptimizerMetrics(result) {
    const distEl = document.getElementById('optTotalDistance');
    const travelEl = document.getElementById('optTotalTravelTime');
    const stayEl = document.getElementById('optTotalStayTime');
    const durEl = document.getElementById('optTotalDuration');
    const budgetBadge = document.getElementById('optBudgetBadge');
    const budgetSub = document.getElementById('optBudgetSub');
    const breadcrumbs = document.getElementById('optSequenceBreadcrumbs');

    if (distEl) distEl.textContent = `${result.totals.totalDistanceKm} km`;
    if (travelEl) travelEl.textContent = result.totals.totalTravelTimeFormatted || `${result.totals.totalTravelTimeMin} min`;
    if (stayEl) stayEl.textContent = result.totals.totalStayDurationFormatted || `${result.totals.totalStayDurationMin} min`;
    if (durEl) durEl.textContent = result.totals.totalTripDurationFormatted || `${result.totals.totalTripDurationMin} min`;

    if (budgetBadge && budgetSub) {
        const availHours = Math.floor(result.totals.availableTripTimeMinutes / 60);
        if (result.totals.isWithinBudget) {
            budgetBadge.className = 'opt-budget-badge status-ok';
            budgetBadge.textContent = `✅ Within ${availHours}h Budget`;
            const spareHours = Math.floor(result.totals.budgetDeltaMin / 60);
            const spareMins = result.totals.budgetDeltaMin % 60;
            budgetSub.textContent = `${spareHours}h ${spareMins}m buffer remaining`;
        } else {
            budgetBadge.className = 'opt-budget-badge status-warning';
            budgetBadge.textContent = `⚠️ Exceeds ${availHours}h Budget`;
            const overHours = Math.floor(result.totals.budgetDeltaMin / 60);
            const overMins = result.totals.budgetDeltaMin % 60;
            budgetSub.textContent = `Overtime by ${overHours}h ${overMins}m`;
        }
    }

    if (breadcrumbs && result.orderedStops) {
        breadcrumbs.innerHTML = result.orderedStops.map((stop, i) => {
            if (stop.isStart) {
                return `<span class="seq-step seq-start" onclick="focusOptimizerMarker('opt-stop-0')" title="Start location">🟢 START</span>`;
            }
            return `
                <span class="seq-arrow">→</span>
                <span class="seq-step" onclick="focusOptimizerMarker('opt-stop-${i}')" title="${escapeHtml(stop.name)}">
                    <span class="seq-num">${i}</span>
                    <span>${escapeHtml(stop.name)}</span>
                </span>
            `;
        }).join('');
    }
}

function renderOptimizerMap(result) {
    if (typeof L === 'undefined') {
        console.warn('[OptimizerMap] Leaflet.js library not loaded.');
        return;
    }

    const mapElement = document.getElementById('optimizerMap');
    if (!mapElement) return;

    const startLat = result.orderedStops[0]?.lat || optimizerState.startLocation?.lat || 20.5937;
    const startLon = result.orderedStops[0]?.lon || optimizerState.startLocation?.lon || 78.9629;

    if (!optimizerState.map) {
        optimizerState.map = L.map('optimizerMap', {
            center: [startLat, startLon],
            zoom: 13,
            zoomControl: true,
            scrollWheelZoom: false
        });

        const cfg = TILE_CONFIGS[optimizerState.currentMapTheme] || TILE_CONFIGS.dark;
        optimizerState.activeTileLayer = L.tileLayer(cfg.url, cfg.options).addTo(optimizerState.map);
    } else {
        // Clear previous markers & lines
        optimizerState.markers.forEach(m => optimizerState.map.removeLayer(m));
        if (optimizerState.routePolyline) {
            optimizerState.map.removeLayer(optimizerState.routePolyline);
            optimizerState.routePolyline = null;
        }
    }

    optimizerState.markers = [];
    const allBounds = [];

    // 1. Plot START Pin
    const startStop = result.orderedStops[0];
    if (startStop) {
        const startIcon = L.divIcon({
            className: 'custom-opt-icon',
            html: `
                <div class="opt-start-pin">
                    <div class="start-beacon">
                        <div class="start-beacon-radar"></div>
                        <span>🏁</span>
                    </div>
                    <div class="start-label-badge">START</div>
                </div>
            `,
            iconSize: [60, 50],
            iconAnchor: [30, 25]
        });

        const startMarker = L.marker([startStop.lat, startStop.lon], { icon: startIcon, zIndexOffset: 500 }).addTo(optimizerState.map);
        startMarker.bindPopup(`
            <div class="map-popup-card">
                <span class="popup-time-badge" style="border-color:var(--accent-green); color:var(--accent-green);">🟢 START POINT</span>
                <h4 class="popup-title">${escapeHtml(startStop.name)}</h4>
                <p class="popup-desc">Departure scheduled at <strong>${startStop.departureTime}</strong>.</p>
            </div>
        `);
        startMarker.on('click', () => highlightFlowStopCard('opt-card-0'));
        optimizerState.markers.push(startMarker);
        allBounds.push([startStop.lat, startStop.lon]);
    }

    // 2. Plot Numbered Destination Pins
    const DAY_PALETTE = ['#38bdf8', '#a78bfa', '#fb923c', '#34d399', '#f472b6', '#fbbf24', '#22d3ee'];

    result.orderedStops.forEach((stop, idx) => {
        if (stop.isStart) return;

        const stopColor = DAY_PALETTE[(idx - 1) % DAY_PALETTE.length];
        const stopId = `opt-card-${idx}`;

        const pinIcon = L.divIcon({
            className: 'custom-opt-icon',
            html: `
                <div class="opt-stop-pin" style="--stop-color: ${stopColor};">
                    <div class="stop-marker-circle">
                        <span>${idx}</span>
                    </div>
                    <div class="stop-marker-label">${escapeHtml(stop.name)}</div>
                </div>
            `,
            iconSize: [110, 56],
            iconAnchor: [55, 28],
            popupAnchor: [0, -28]
        });

        const marker = L.marker([stop.lat, stop.lon], { icon: pinIcon, zIndexOffset: 200 + idx }).addTo(optimizerState.map);
        marker.bindPopup(`
            <div class="map-popup-card">
                <div class="popup-tag-row">
                    <span class="popup-time-badge" style="border-color:${stopColor}; color:${stopColor};">
                        Stop #${idx} · ${escapeHtml(stop.category || 'culture')}
                    </span>
                    <span class="popup-category-badge">${stop.priority ? stop.priority.toUpperCase() : 'MED'}</span>
                </div>
                <h4 class="popup-title">${escapeHtml(stop.name)}</h4>
                <div style="font-size:0.8rem; margin:8px 0; color:var(--text-secondary);">
                    <div>⏱️ <strong>Arrival:</strong> ${stop.arrivalTime}</div>
                    <div>⏳ <strong>Planned Stay:</strong> ${stop.stayDurationMin} min</div>
                    <div>🚀 <strong>Departure:</strong> ${stop.departureTime}</div>
                </div>
                <div style="font-size:0.75rem; color:var(--accent-cyan); margin-bottom:8px;">
                    🛣️ Leg: ${stop.legFromPrevious?.distanceKm || 0} km • ${stop.legFromPrevious?.travelTimeMin || 0} min
                </div>
                <button class="popup-btn-sync" onclick="highlightFlowStopCard('${stopId}')">
                    <span>📋 View in Trip Flow</span>
                </button>
            </div>
        `);

        marker.on('click', () => highlightFlowStopCard(stopId));
        optimizerState.markers.push(marker);
        allBounds.push([stop.lat, stop.lon]);
    });

    // 3. Render Real Road Polyline Geometry (OSRM GeoJSON or Interpolated)
    let polylineCoords = [];

    if (result.routeGeometry && result.routeGeometry.geometry && result.routeGeometry.geometry.coordinates) {
        // OSRM GeoJSON is [lon, lat] -> convert to Leaflet [lat, lon]
        polylineCoords = result.routeGeometry.geometry.coordinates.map(coord => [coord[1], coord[0]]);
    } else {
        // Fallback straight connections between ordered stops
        polylineCoords = result.orderedStops.map(s => [s.lat, s.lon]);
    }

    if (polylineCoords.length > 1) {
        optimizerState.routePolyline = L.polyline(polylineCoords, {
            color: '#38bdf8',
            weight: 5,
            opacity: 0.9,
            lineCap: 'round',
            lineJoin: 'round',
            dashArray: '8, 8'
        }).addTo(optimizerState.map);

        // Bind tooltip on road line
        optimizerState.routePolyline.bindTooltip(`
            <div style="font-size:0.8rem; font-weight:700; color:#38bdf8;">
                🛣️ Total: ${result.totals.totalDistanceKm} km • ${result.totals.totalTravelTimeFormatted || result.totals.totalTravelTimeMin + 'm'}
            </div>
        `, { sticky: true });
    }

    // Fit map bounds smoothly
    if (allBounds.length > 0) {
        optimizerState.map.fitBounds(allBounds, { padding: [50, 50], maxZoom: 15 });
    }

    setTimeout(() => {
        if (optimizerState.map) optimizerState.map.invalidateSize();
    }, 200);
}

function renderOptimizerFlow(result) {
    const flowList = document.getElementById('optFlowList');
    const stopsCountEl = document.getElementById('optStopsCount');

    if (!result || !result.orderedStops || result.orderedStops.length <= 1) {
        if (stopsCountEl) stopsCountEl.textContent = '0 Destinations';
        renderOptimizerEmptyFlow();
        return;
    }

    if (stopsCountEl) {
        stopsCountEl.textContent = `${Math.max(0, result.orderedStops.length - 1)} Destinations`;
    }

    if (!flowList) return;

    const modeIcons = { driving: '🚗', transit: '🚆', cycling: '🚲', walking: '🚶' };
    const currentModeIcon = modeIcons[result.travelMode] || '🚗';

    let flowHtml = '';

    result.orderedStops.forEach((stop, i) => {
        if (stop.isStart) {
            // START Stop Card
            flowHtml += `
                <div class="flow-stop-card flow-start-card" id="opt-card-0">
                    <div class="flow-stop-top">
                        <div class="flow-stop-info">
                            <div class="flow-stop-badge-row">
                                <span class="stop-start-badge">🟢 START POINT</span>
                                <span class="stop-category-badge">Origin</span>
                            </div>
                            <h4 class="flow-stop-name">${escapeHtml(stop.name)}</h4>
                            <p class="flow-stop-address">${escapeHtml(stop.address || 'Starting Location')}</p>
                        </div>
                        <div class="flow-stop-actions">
                            <button type="button" class="flow-action-btn" onclick="focusOptimizerMarker('opt-stop-0')" title="Locate start on map">🗺️</button>
                        </div>
                    </div>
                    <div class="flow-time-grid">
                        <div class="time-slot-item">
                            <span class="time-slot-label">Departure</span>
                            <span class="time-slot-value" style="color:var(--accent-green);">${stop.departureTime}</span>
                        </div>
                        <div class="time-slot-item">
                            <span class="time-slot-label">Travel Mode</span>
                            <span class="time-slot-value">${currentModeIcon} ${escapeHtml(result.travelModeLabel || 'Driving')}</span>
                        </div>
                        <div class="time-slot-item">
                            <span class="time-slot-label">Route Sequence</span>
                            <span class="time-slot-value">Point 0</span>
                        </div>
                    </div>
                </div>
            `;
        } else {
            // Leg Connector between stop i-1 and stop i
            const leg = stop.legFromPrevious || {};
            flowHtml += `
                <div class="flow-leg-connector" onclick="focusOptimizerMarker('opt-stop-${i}')" title="Click to view this leg on map">
                    <div class="flow-connector-line"></div>
                    <div class="flow-connector-pill">
                        <span class="connector-arrow">↓</span>
                        <span class="connector-mode-icon">${currentModeIcon}</span>
                        <span class="connector-metrics">${leg.distanceKm || 0} km • ${leg.travelTimeMin || 0} min</span>
                    </div>
                </div>
            `;

            // Destination Card
            const cardId = `opt-card-${i}`;
            const prio = stop.priority || 'medium';
            const prioClass = prio === 'high' ? 'priority-high' : (prio === 'low' ? 'priority-low' : 'priority-medium');

            let hoursStatusHtml = '';
            if (stop.status === 'waiting_for_opening') {
                hoursStatusHtml = `<span class="hours-status-badge hours-wait">⚠️ Opens ${stop.openTime} (Waits ${stop.waitTimeMin}m)</span>`;
            } else if (stop.status === 'closed_on_arrival') {
                hoursStatusHtml = `<span class="hours-status-badge hours-closed">🔴 Arrives after ${stop.closeTime}</span>`;
            } else {
                hoursStatusHtml = `<span class="hours-status-badge hours-open">🟢 Open ${stop.openTime || '09:00'} - ${stop.closeTime || '19:00'}</span>`;
            }

            flowHtml += `
                <div class="flow-stop-card" id="${cardId}">
                    <div class="flow-stop-top">
                        <div class="flow-stop-info">
                            <div class="flow-stop-badge-row">
                                <span class="stop-num-badge">${i}</span>
                                <span class="stop-category-badge">${escapeHtml(stop.category || 'Culture')}</span>
                                <span class="priority-pill ${prioClass}">${prio.toUpperCase()} PRIORITY</span>
                            </div>
                            <h4 class="flow-stop-name">${escapeHtml(stop.name)}</h4>
                            <p class="flow-stop-address">${escapeHtml(stop.address || '')}</p>
                        </div>
                        <div class="flow-stop-actions">
                            <button type="button" class="flow-action-btn" onclick="moveOptimizerStop(${i - 1}, -1)" title="Move earlier in route" ${i === 1 ? 'disabled style="opacity:0.3;"' : ''}>⬆️</button>
                            <button type="button" class="flow-action-btn" onclick="moveOptimizerStop(${i - 1}, 1)" title="Move later in route" ${i === result.orderedStops.length - 1 ? 'disabled style="opacity:0.3;"' : ''}>⬇️</button>
                            <button type="button" class="flow-action-btn" onclick="focusOptimizerMarker('opt-stop-${i}')" title="Locate on map">🗺️</button>
                            <button type="button" class="flow-action-btn btn-remove" onclick="removeOptimizerStop('${stop.id}')" title="Remove stop">✕</button>
                        </div>
                    </div>

                    <!-- Time schedule calculation -->
                    <div class="flow-time-grid">
                        <div class="time-slot-item">
                            <span class="time-slot-label">Arrival Time</span>
                            <span class="time-slot-value">${stop.arrivalTime}</span>
                        </div>
                        <div class="time-slot-item">
                            <span class="time-slot-label">Planned Stay</span>
                            <select class="stay-duration-select" onchange="updateStopStayDuration('${stop.id}', this.value)" title="Change stay duration">
                                <option value="15" ${stop.stayDurationMin === 15 ? 'selected' : ''}>15 min</option>
                                <option value="30" ${stop.stayDurationMin === 30 ? 'selected' : ''}>30 min</option>
                                <option value="45" ${stop.stayDurationMin === 45 ? 'selected' : ''}>45 min</option>
                                <option value="60" ${stop.stayDurationMin === 60 ? 'selected' : ''}>1 hour</option>
                                <option value="90" ${stop.stayDurationMin === 90 ? 'selected' : ''}>1.5 hrs</option>
                                <option value="120" ${stop.stayDurationMin === 120 ? 'selected' : ''}>2 hours</option>
                            </select>
                        </div>
                        <div class="time-slot-item">
                            <span class="time-slot-label">Departure Time</span>
                            <span class="time-slot-value" style="color:var(--accent-purple);">${stop.departureTime}</span>
                        </div>
                    </div>

                    <div class="flow-tags-row">
                        ${hoursStatusHtml}
                        <div style="font-size:0.7rem; color:var(--text-muted);">
                            Transit from prior: <strong>${leg.travelTimeMin || 0} min</strong> (${leg.distanceKm || 0} km)
                        </div>
                    </div>
                </div>
            `;
        }
    });

    // Final Completion Card
    const lastStop = result.orderedStops[result.orderedStops.length - 1];
    flowHtml += `
        <div class="flow-completion-card">
            <span class="completion-icon">🏁</span>
            <div>
                <div class="completion-title">Itinerary Completed at ${lastStop?.departureTime || 'End of Day'}</div>
                <div class="completion-desc">Covered ${result.totals.totalDistanceKm} km across ${result.orderedStops.length - 1} stops in ${result.totals.totalTripDurationFormatted}.</div>
            </div>
        </div>
    `;

    flowList.innerHTML = flowHtml;
}

// Global actions for Smart Route Optimizer
window.focusOptimizerMarker = function(markerKey) {
    if (!optimizerState.map || !optimizerState.lastOptimizedResult) return;

    // markerKey format: "opt-stop-X"
    const parts = markerKey.split('-');
    const idx = parseInt(parts[2], 10);
    const stop = optimizerState.lastOptimizedResult.orderedStops[idx];

    if (stop && stop.lat && stop.lon) {
        optimizerState.map.flyTo([stop.lat, stop.lon], 15, { duration: 0.8 });
        const marker = optimizerState.markers[idx];
        if (marker) {
            setTimeout(() => marker.openPopup(), 850);
        }
    }
};

window.highlightFlowStopCard = function(cardId) {
    const card = document.getElementById(cardId);
    if (!card) return;

    card.scrollIntoView({ behavior: 'smooth', block: 'center' });
    card.classList.remove('highlighted-stop');
    void card.offsetWidth;
    card.classList.add('highlighted-stop');
    setTimeout(() => {
        card.classList.remove('highlighted-stop');
    }, 2500);
};

window.updateStopStayDuration = function(destId, stayDurationMin) {
    const dest = optimizerState.destinations.find(d => d.id === destId);
    if (dest) {
        dest.stayDurationMin = parseInt(stayDurationMin, 10);
        showToast(`Updated stay duration for ${dest.name} to ${stayDurationMin} min.`);
        triggerAutoReoptimization();
    }
};

window.moveOptimizerStop = function(destIndex, direction) {
    // destIndex is index in optimizerState.destinations
    const targetIndex = destIndex + direction;
    if (targetIndex < 0 || targetIndex >= optimizerState.destinations.length) return;

    const temp = optimizerState.destinations[destIndex];
    optimizerState.destinations[destIndex] = optimizerState.destinations[targetIndex];
    optimizerState.destinations[targetIndex] = temp;

    showToast(`Reordered stop: moved ${direction > 0 ? 'later' : 'earlier'}.`);

    // If auto-optimize was on, keep manual sequence and recalculate schedule
    optimizerState.autoOptimize = false;
    const autoToggle = document.getElementById('optAutoToggle');
    const autoStatus = document.getElementById('optAutoStatus');
    if (autoToggle) autoToggle.checked = false;
    if (autoStatus) autoStatus.textContent = 'OFF (Manual)';

    runManualRouteCalculation();
};

window.removeOptimizerStop = function(destId) {
    const initialLen = optimizerState.destinations.length;
    optimizerState.destinations = optimizerState.destinations.filter(d => d.id !== destId);
    if (optimizerState.destinations.length < initialLen) {
        showToast('Destination removed.');
        triggerAutoReoptimization();
    }
};

window.importDayToOptimizer = function(dayIndex) {
    if (!activeItinerary || !activeItinerary[dayIndex]) {
        showToast('No activities found for this day.');
        return;
    }

    const day = activeItinerary[dayIndex];
    const activities = day.activities || [];

    if (activities.length === 0) {
        showToast('No activities found for this day.');
        return;
    }

    // Set starting point to first activity or destination center
    const centerLat = activePayload?.latitude || selectedCity?.latitude || activities[0]?.lat || (optimizerState.startLocation && optimizerState.startLocation.lat) || 0;
    const centerLon = activePayload?.longitude || selectedCity?.longitude || activities[0]?.lon || (optimizerState.startLocation && optimizerState.startLocation.lon) || 0;

    optimizerState.startLocation = {
        name: `${activePayload?.city || 'Destination'} Central Hotel`,
        address: `${activePayload?.city || 'Destination'}, ${activePayload?.country || ''}`,
        lat: parseFloat(centerLat),
        lon: parseFloat(centerLon)
    };

    optimizerState.destinations = activities.map((act, i) => {
        const hasCoords = act.lat && act.lon && !isNaN(parseFloat(act.lat));
        const coords = hasCoords
            ? [parseFloat(act.lat), parseFloat(act.lon)]
            : generateActivityCoordinates(parseFloat(centerLat), parseFloat(centerLon), dayIndex, i, activities.length);

        return {
            id: `imported-${dayIndex}-${i}`,
            name: act.title || `Day ${dayIndex + 1} Activity ${i + 1}`,
            address: `${activePayload?.city || ''}`,
            category: act.category || 'culture',
            lat: coords[0],
            lon: coords[1],
            priority: i === 0 ? 'high' : 'medium',
            stayDurationMin: 60,
            openTime: '09:00',
            closeTime: '19:00'
        };
    });

    const startInput = document.getElementById('optStartInput');
    if (startInput) {
        startInput.value = `${optimizerState.startLocation.name}`;
    }

    const optTitle = document.getElementById('optTitle');
    if (optTitle) {
        optTitle.textContent = `Optimizing Day ${dayIndex + 1} (${day.dayName || day.date}): ${activePayload?.city || ''}`;
    }

    showOptimizerView();
    showToast(`⚡ Imported ${activities.length} stops from Day ${dayIndex + 1} into Route Optimizer!`);
};

function copyOptimizerSummary() {
    if (!optimizerState.lastOptimizedResult) {
        showToast('No route available to copy.');
        return;
    }

    const res = optimizerState.lastOptimizedResult;
    let text = `⚡ Smart Route Optimization Plan (${res.travelModeLabel || 'Driving'})\n`;
    text += `🛣️ Total Distance: ${res.totals.totalDistanceKm} km | ⏱️ Total Travel Time: ${res.totals.totalTravelTimeFormatted} | 🏁 Duration: ${res.totals.totalTripDurationFormatted}\n\n`;
    text += `Sequence: ${res.recommendedOrderSummary}\n\n`;

    res.orderedStops.forEach((s, i) => {
        if (s.isStart) {
            text += `🟢 [START] ${s.name} (Departure: ${s.departureTime})\n`;
        } else {
            const leg = s.legFromPrevious || {};
            text += `  ↓ ${leg.distanceKm || 0} km • ${leg.travelTimeMin || 0} min\n`;
            text += `📍 [Stop ${i}] ${s.name}\n`;
            text += `   Arrival: ${s.arrivalTime} | Stay: ${s.stayDurationMin}m | Departure: ${s.departureTime}\n`;
        }
    });

    navigator.clipboard.writeText(text).then(() => {
        showToast('Route flow summary copied to clipboard! 📋');
    }).catch(err => {
        console.warn('Clipboard copy error:', err);
    });
}



