// ==UserScript==
// @name         MTG Draft GIH WR Overlay
// @namespace    http://tampermonkey.net/
// @version      3.4
// @description  Toggle overlay showing Game In Hand win rates for MTG cards on Draftmancer and 17Lands, optionally filtered by deck colours
// @author       You
// @match        https://draftmancer.com/*
// @match        https://www.17lands.com/*
// @license      MIT
// @grant        GM_xmlhttpRequest
// @grant        GM.xmlHttpRequest
// @connect      api.scryfall.com
// @connect      www.17lands.com
// ==/UserScript==

(function() {
    'use strict';

    let overlayEnabled = false;
    let cardData = {};
    let scryfallToName = {}; // Map Scryfall ID to card name (Draftmancer only)
    let currentExpansion = null;
    let manualExpansion = null;
    let dataLoaded = false;
    let currentSite = null;
    let colorFilter = null; // e.g. "WU" - restricts 17Lands data to decks of these colors
    let lastLoadError = null; // surfaced on the Colors button when a fetch comes back empty

    // 17Lands only recognises colour pairs in canonical WUBRG order: colors=WU
    // returns data, colors=UW returns an empty array with a 200, which would
    // otherwise look like "this set has no cards". Everything the user picks is
    // funnelled through here so the request is always in the order the API wants.
    const WUBRG = ['W', 'U', 'B', 'R', 'G'];

    function normalizeColors(input) {
        const seen = new Set(
            String(input || '').toUpperCase().split('').filter(ch => WUBRG.includes(ch))
        );
        return WUBRG.filter(ch => seen.has(ch)).join('');
    }

    // Resolve whichever cross-origin request helper this userscript runtime
    // provides. Tampermonkey/Violentmonkey expose GM_xmlhttpRequest; the iOS
    // Safari "Userscripts" extension exposes the promise-style GM.xmlHttpRequest
    // instead. Fall back to window.fetch so the script degrades instead of
    // throwing (works for 17Lands, which is same-origin, and for Scryfall, which
    // sends permissive CORS headers - only a strict page CSP will block it).
    const gmRequest =
        (typeof GM_xmlhttpRequest === 'function') ? GM_xmlhttpRequest :
        (typeof GM !== 'undefined' && GM && typeof GM.xmlHttpRequest === 'function') ? GM.xmlHttpRequest.bind(GM) :
        null;

    // Helper function to wrap the request helper as a Promise
    function gmFetch(url, options = {}) {
        if (!gmRequest) {
            console.warn('No GM request API available - falling back to fetch()');
            return fetch(url, {
                method: options.method || 'GET',
                headers: options.headers || {},
                body: options.body
            });
        }

        return new Promise((resolve, reject) => {
            gmRequest({
                method: options.method || 'GET',
                url: url,
                headers: options.headers || {},
                data: options.body,
                onload: (response) => {
                    resolve({
                        ok: response.status >= 200 && response.status < 300,
                        status: response.status,
                        json: async () => JSON.parse(response.responseText),
                        text: async () => response.responseText
                    });
                },
                onerror: (error) => {
                    reject(new Error(`Userscript request failed: ${error}`));
                }
            });
        });
    }

    // Site detection and configuration
    const SITES = {
        DRAFTMANCER: {
            name: 'Draftmancer',
            detect: () => window.location.hostname.includes('draftmancer.com'),
            cardSelector: '.card.booster-card',
            imageContainerSelector: '.card-image',
            expansionDetector: detectExpansionDraftmancer,
            getCardName: getCardNameDraftmancer,
            needsScryfall: true
        },
        SEVENTEENLANDS: {
            name: '17Lands',
            detect: () => window.location.hostname.includes('17lands.com'),
            cardSelector: 'img[alt][src*="cards.scryfall.io"]',
            imageContainerSelector: null, // Append directly to parent
            expansionDetector: detectExpansion17Lands,
            getCardName: getCardName17Lands,
            needsScryfall: false
        }
    };

    // Detect which site we're on
    function detectSite() {
        for (const site of Object.values(SITES)) {
            if (site.detect()) {
                currentSite = site;
                console.log(`Detected site: ${site.name}`);
                return site;
            }
        }
        console.error('Unknown site - extension may not work correctly');
        return null;
    }

    // Draftmancer: Fetch Scryfall card names for visible cards using collection endpoint
    async function loadScryfallMapping() {
        if (!currentSite || !currentSite.needsScryfall) return;

        try {
            const cardElements = document.querySelectorAll(currentSite.cardSelector);
            const scryfallIds = Array.from(cardElements).map(card => {
                // Extract Scryfall ID from image URL
                const img = card.querySelector('img[src*="cards.scryfall.io"]');
                if (img && img.src) {
                    // URL format: https://cards.scryfall.io/.../front/e/1/e1068723-d1ef-4007-97d9-b10dccdbade4.jpg
                    const match = img.src.match(/\/([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})\./);
                    return match ? match[1] : null;
                }
                return null;
            }).filter(id => id && !scryfallToName[id]);

            if (scryfallIds.length === 0) {
                console.log('All visible cards already mapped');
                return;
            }

            console.log(`Fetching Scryfall data for ${scryfallIds.length} cards...`);

            // Split into batches of 75 (Scryfall's limit)
            const batches = [];
            for (let i = 0; i < scryfallIds.length; i += 75) {
                batches.push(scryfallIds.slice(i, i + 75));
            }

            for (const batch of batches) {
                const identifiers = batch.map(id => ({ id }));

                const response = await gmFetch('https://api.scryfall.com/cards/collection', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({ identifiers })
                });

                if (!response.ok) {
                    throw new Error(`Scryfall API error: ${response.status}`);
                }

                const data = await response.json();

                data.data.forEach(card => {
                    scryfallToName[card.id] = card.name;
                });

                if (batches.length > 1) {
                    await new Promise(resolve => setTimeout(resolve, 100));
                }
            }

            console.log(`Loaded ${Object.keys(scryfallToName).length} Scryfall ID mappings`);

        } catch (error) {
            console.error('Error fetching Scryfall data:', error);
        }
    }

    // Draftmancer: Detect expansion from page
    function detectExpansionDraftmancer() {
        const cardPoolIcon = document.querySelector('.card-pool-controls .selected-sets .set-icon[alt]');

        if (cardPoolIcon) {
            const alt = cardPoolIcon.getAttribute('alt');
            if (alt) {
                const expansion = alt.toUpperCase();
                console.log(`Detected expansion from card pool: ${expansion}`);
                return expansion;
            }
        }

        const selectedSets = document.querySelector('.selected-sets .set-icon[alt]');
        if (selectedSets) {
            const alt = selectedSets.getAttribute('alt');
            if (alt) {
                const expansion = alt.toUpperCase();
                console.log(`Detected expansion from selected-sets: ${expansion}`);
                return expansion;
            }
        }

        console.warn('Could not detect expansion from page');
        return null;
    }

    // 17Lands: Detect expansion from URL or page
    function detectExpansion17Lands() {
        // Look for the expansion in the page heading or data attributes
        const heading = document.querySelector('h1');
        if (heading) {
            const text = heading.textContent;
            // Look for common set code patterns (3-4 uppercase letters)
            const setMatch = text.match(/\b([A-Z]{3,4})\b/);
            if (setMatch) {
                const expansion = setMatch[1].toUpperCase();
                console.log(`Detected expansion from heading: ${expansion}`);
                return expansion;
            }
        }

        // Try to find set information in the page
        const setElements = document.querySelectorAll('[class*="set"], [class*="expansion"]');
        for (const el of setElements) {
            const text = el.textContent;
            const setMatch = text.match(/\b([A-Z]{3,4})\b/);
            if (setMatch) {
                const expansion = setMatch[1].toUpperCase();
                console.log(`Detected expansion from page: ${expansion}`);
                return expansion;
            }
        }

        console.warn('Could not detect expansion from 17Lands page');
        return null;
    }

    // Draftmancer: Get card name from Scryfall mapping
    function getCardNameDraftmancer(cardElement) {
        // Extract Scryfall ID from image URL
        const img = cardElement.querySelector('img[src*="cards.scryfall.io"]');
        if (img && img.src) {
            const match = img.src.match(/\/([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})\./);
            const scryfallId = match ? match[1] : null;
            return scryfallId ? scryfallToName[scryfallId] : null;
        }
        return null;
    }

    // 17Lands: Get card name from alt text
    function getCardName17Lands(cardElement) {
        return cardElement.getAttribute('alt');
    }

    // Fetch card data from 17Lands API
    async function loadCardData(expansion = null) {
        if (!expansion) {
            expansion = currentSite.expansionDetector();
        }

        if (!expansion) {
            console.error('Cannot load card data: no expansion detected');
            return;
        }

        currentExpansion = expansion;

        try {
            console.log(`Fetching card data for ${expansion}${colorFilter ? ` (colors=${colorFilter})` : ''}...`);

            // Use the current 17Lands API (the old card_ratings/data endpoint with
            // start_date/end_date is legacy and returns a much smaller, stale-looking
            // dataset). time_period=ALL_TIME pulls the full sample 17Lands has.
            let url = `https://www.17lands.com/api/card_data?expansion=${expansion}&event_type=PremierDraft&time_period=ALL_TIME`;
            if (colorFilter) {
                url += `&colors=${colorFilter}`;
            }

            console.log(`API URL: ${url}`);

            const response = await gmFetch(url, {
                method: 'GET',
                headers: {
                    'Accept': 'application/json',
                }
            });

            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            const responseBody = await response.json();
            const data = responseBody.data || [];

            // 17Lands answers an unusable colors= value with a 200 and an empty
            // array rather than an error, and a legitimate but rare pair can come
            // back empty too. Keep the previous dataset rather than blanking every
            // overlay, and tell the user which case they are in.
            if (colorFilter && data.length === 0) {
                console.warn(`No ${expansion} data for colors=${colorFilter} - keeping previous data. Try a different pair.`);
                lastLoadError = `No data for ${colorFilter}`;
                return;
            }

            lastLoadError = null;
            cardData = {};

            data.forEach(card => {
                // 17Lands sometimes nulls out ever_drawn_win_rate (esp. on freshly
                // released sets) while overall win_rate is still populated.
                // Fall back to win_rate in that case so cards aren't silently dropped.
                const wr = card.ever_drawn_win_rate !== null && card.ever_drawn_win_rate !== undefined
                    ? card.ever_drawn_win_rate
                    : card.win_rate;

                if (card.name && wr !== null && wr !== undefined) {
                    const id = card.mtga_id || card.arena_id || card.name;

                    cardData[id] = {
                        gihWR: wr,
                        isFallbackWR: card.ever_drawn_win_rate === null || card.ever_drawn_win_rate === undefined,
                        name: card.name,
                        color: card.color || '',
                        rarity: card.rarity || '',
                        gamesPlayed: card.game_count || 0
                    };
                }
            });

            dataLoaded = true;
            console.log(`Loaded data for ${Object.keys(cardData).length} cards from ${expansion}`);

            if (overlayEnabled) {
                hideOverlays();
                showOverlays();
            }

        } catch (error) {
            console.error('Error fetching card data:', error);
            console.log('Attempting to load from localStorage cache...');
            loadFromCache();
        }
    }

    // Cache data in localStorage
    function cacheData() {
        try {
            const cache = {
                data: cardData,
                expansion: currentExpansion,
                colors: colorFilter || '',
                timestamp: Date.now()
            };
            localStorage.setItem('gihWRCache', JSON.stringify(cache));
        } catch (e) {
            console.warn('Failed to cache data:', e);
        }
    }

    // Load from localStorage cache
    function loadFromCache() {
        try {
            const cached = localStorage.getItem('gihWRCache');
            if (cached) {
                const cache = JSON.parse(cached);
                const age = Date.now() - cache.timestamp;

                // A cache written under a colour filter holds that archetype's
                // win rates, not the set's. Restoring it for a different filter
                // would quietly show the wrong numbers, so treat it as a miss.
                if ((cache.colors || '') !== (colorFilter || '')) {
                    console.log('Cached data was for a different colour filter - ignoring');
                    return false;
                }

                if (age < 24 * 60 * 60 * 1000) {
                    cardData = cache.data;
                    currentExpansion = cache.expansion;
                    dataLoaded = true;
                    console.log(`Loaded ${Object.keys(cardData).length} cards from cache (${currentExpansion})`);
                    updateControls();
                    return true;
                }
            }
        } catch (e) {
            console.warn('Failed to load cache:', e);
        }
        return false;
    }

    // Create overlay element for a card
    function createOverlay(cardElement) {
        if (!currentSite) return null;

        let cardName = currentSite.getCardName(cardElement);

        if (!cardName) {
            return null;
        }

        // Store original name for lookup
        let lookupName = cardName;

        // Try to find the card data with multiple name variations
        let data = null;

        // First, try exact match
        data = Object.values(cardData).find(c => c.name === lookupName);

        // If not found and card has //, try front face only
        if (!data && lookupName.includes(' // ')) {
            const frontFace = lookupName.split(' // ')[0];
            data = Object.values(cardData).find(c => c.name === frontFace);
        }

        // If still not found and card doesn't have //, try adding back face
        // (check if any card in data starts with this name and has //)
        if (!data && !lookupName.includes(' // ')) {
            data = Object.values(cardData).find(c =>
                c.name.includes(' // ') && c.name.split(' // ')[0] === lookupName
            );
        }

        if (!data) {
            console.log(`No 17Lands rate data at all for "${lookupName}" (not in card_data response, or has null win_rate and ever_drawn_win_rate)`);
            return null;
        }

        if (data.gihWR === null || data.gihWR === undefined) {
            return null;
        }

        const overlay = document.createElement('div');
        overlay.className = 'gih-wr-overlay';

        const sampleWarning = data.gamesPlayed < 500 ? '⚠️ ' : '';

        // Scale the badge with the rendered card. Cards are a few hundred pixels
        // wide on desktop but well under 120px on a phone, where a fixed 16px
        // badge covers most of the art.
        const cardWidth = cardElement.getBoundingClientRect().width || 200;
        const maxFont = currentSite === SITES.DRAFTMANCER ? 16 : 12;
        const fontSize = Math.round(Math.min(maxFont, Math.max(9, cardWidth / 12)));
        const padding = fontSize >= 14 ? '5px 10px' : '3px 6px';
        const topOffset = Math.round(Math.min(32, Math.max(4, cardWidth * 0.16)));

        overlay.style.cssText = `
            position: absolute;
            top: ${topOffset}px;
            right: 8px;
            background: rgba(0, 0, 0, 0.85);
            color: ${getWinrateColor(data.gihWR)};
            padding: ${padding};
            border-radius: 4px;
            font-weight: bold;
            font-size: ${fontSize}px;
            z-index: 1000;
            pointer-events: none;
            box-shadow: 0 2px 4px rgba(0,0,0,0.3);
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        `;
        const label = data.isFallbackWR ? 'WR' : 'GIH';
        overlay.textContent = `${sampleWarning}${label}: ${(data.gihWR * 100).toFixed(1)}%`;

        return overlay;
    }

    // Color code based on win rate (colorblind-friendly palette)
    function getWinrateColor(wr) {
        if (wr >= 0.58) return '#60a5fa'; // Blue - excellent
        if (wr >= 0.55) return '#93c5fd'; // Light blue - good
        if (wr >= 0.52) return '#e0e7ff'; // Very light blue/white - above average
        if (wr >= 0.50) return '#fbbf24'; // Amber/yellow - average
        return '#fb923c'; // Orange - below average
    }

    // Turn overlays on/off. Every entry point (hotkey, on-screen button, the
    // auto-off when a pick is made) goes through here so the button state and
    // the DOM never disagree.
    async function setOverlayEnabled(enabled) {
        overlayEnabled = enabled;

        if (overlayEnabled) {
            // Reload Scryfall mapping for current cards before showing overlays
            if (currentSite && currentSite.needsScryfall) {
                await loadScryfallMapping();
            }
            showOverlays();
        } else {
            hideOverlays();
        }

        updateControls();
        console.log(`GIH WR Overlay: ${overlayEnabled ? 'ON' : 'OFF'}`);
    }

    function toggleOverlays() {
        return setOverlayEnabled(!overlayEnabled);
    }

    // Drop everything and re-fetch for the active expansion
    function reloadData() {
        console.log('Reloading card data...');
        // cardData is deliberately left alone here: loadCardData swaps it only
        // once a usable response arrives, so a colour pair with no games keeps
        // the overlays that are already on screen instead of blanking them.
        scryfallToName = {};
        dataLoaded = false;

        // currentSite is null until detectSite() has run, and on any page that is
        // neither Draftmancer nor 17Lands. Guard rather than throw so a caller
        // that fires early - or a reset triggered before boot finishes - degrades
        // quietly instead of breaking the handler it was called from.
        const expansion = manualExpansion || (currentSite && currentSite.expansionDetector());
        if (!expansion) {
            console.warn('No expansion detected - set one manually first');
            updateControls();
            return Promise.resolve();
        }

        const fetchData = () => loadCardData(expansion).then(() => {
            if (dataLoaded) cacheData();
            updateControls();
        });

        return (currentSite && currentSite.needsScryfall)
            ? loadScryfallMapping().then(fetchData)
            : fetchData();
    }

    // Apply a manually entered expansion code and reload
    function applyExpansion(code) {
        const expansion = (code || '').trim().toUpperCase();
        if (!expansion) return;

        manualExpansion = expansion;
        saveUIState({ manualExpansion: expansion, manualExpansionAt: Date.now() });
        console.log(`Manual expansion override set to: ${manualExpansion}`);
        reloadData();
    }

    // Apply a colour-pair filter (or clear it when given nothing) and reload.
    // Persisted with a timestamp like the expansion override so a phone that
    // reloads mid-draft keeps the archetype, but a stale pair cannot outlive
    // the day it was set.
    function applyColors(input) {
        const colors = normalizeColors(input);
        const next = colors || null;

        if (next === colorFilter) {
            updateControls();
            return Promise.resolve();
        }

        colorFilter = next;
        lastLoadError = null;
        saveUIState({ colorFilter: colorFilter || '', colorFilterAt: Date.now() });
        console.log(colorFilter
            ? `Colour filter set to: ${colorFilter}`
            : 'Colour filter cleared - showing overall win rates');
        return reloadData();
    }

    function clearColors() {
        return applyColors('');
    }

    function showOverlays() {
        if (!currentSite) return;

        const cards = document.querySelectorAll(currentSite.cardSelector);

        console.log(`Looking for cards with selector '${currentSite.cardSelector}'`);
        console.log(`Found ${cards.length} cards`);

        cards.forEach(card => {
            // Skip if overlay already exists
            if (card.querySelector('.gih-wr-overlay')) return;

            const overlay = createOverlay(card);
            if (overlay) {
                // For 17Lands, we need to wrap the image in a positioned container
                if (currentSite === SITES.SEVENTEENLANDS) {
                    const parent = card.parentElement;
                    if (parent && !parent.querySelector('.gih-wr-overlay')) {
                        parent.style.position = 'relative';
                        parent.appendChild(overlay);
                    }
                } else {
                    // Draftmancer - use the card-image container
                    const imageContainer = card.querySelector(currentSite.imageContainerSelector);
                    if (imageContainer) {
                        imageContainer.style.position = 'relative';
                        imageContainer.appendChild(overlay);
                    }
                }
            }
        });
    }

    function hideOverlays() {
        const overlays = document.querySelectorAll('.gih-wr-overlay');
        overlays.forEach(overlay => overlay.remove());
    }

    // Watch for new cards being added to the DOM
    function observeCards() {
        let debounceTimer = null;

        const observer = new MutationObserver((mutations) => {
            // Runs before the overlay check: the pick counter keeps advancing
            // while overlays are off (they auto-hide after every pick), and a
            // new draft has to be noticed in that state too.
            if (currentSite === SITES.DRAFTMANCER) {
                checkForNewDraft();
            }

            if (!overlayEnabled) return;

            // Check if any mutations actually added/removed card elements
            const hasCardChanges = mutations.some(mutation => {
                if (mutation.type === 'childList') {
                    const addedCards = Array.from(mutation.addedNodes).some(node => {
                        return node.nodeType === 1 && (
                            node.matches && node.matches(currentSite.cardSelector) ||
                            node.querySelector && node.querySelector(currentSite.cardSelector)
                        );
                    });
                    const removedCards = Array.from(mutation.removedNodes).some(node => {
                        return node.nodeType === 1 && (
                            node.matches && node.matches(currentSite.cardSelector) ||
                            node.querySelector && node.querySelector(currentSite.cardSelector)
                        );
                    });

                    // If cards were removed (user made a pick), turn overlay off
                    if (removedCards) {
                        console.log('Card selected - GIH WR Overlay turned OFF');
                        setOverlayEnabled(false);
                        return false;
                    }

                    return addedCards;
                }
                return false;
            });

            if (hasCardChanges) {
                // Debounce to avoid rapid updates
                clearTimeout(debounceTimer);
                debounceTimer = setTimeout(showOverlays, 200);
            }
        });

        // characterData is included so the pick counter is still seen if
        // Draftmancer ever updates that text in place rather than rebuilding the
        // subtree. The callback ignores non-card mutations cheaply, so the extra
        // notifications cost nothing.
        observer.observe(document.body, {
            childList: true,
            subtree: true,
            characterData: true
        });
    }

    // ---------------------------------------------------------------------
    // New-draft detection
    //
    // A colour filter is only meaningful for the draft it was chosen in, so it
    // has to reset when a new one starts. Draftmancer renders the active
    // drafter's position as "Pack #N, Pick #M" inside #booster-controls, which
    // is the one unambiguous signal available from the DOM: seeing pack 1 /
    // pick 1 after having been deeper into a draft means a new draft began.
    // (Watching for the pool emptying is unreliable - the pool is also empty
    // during the pre-draft lobby, which would clear a filter set while waiting
    // to fire.)
    //
    // 17Lands has no draft to track - it is a stats site, so the filter simply
    // persists there until changed or cleared.
    // ---------------------------------------------------------------------

    let lastDraftPosition = null;
    // Set once we have handled the P1P1 we are currently sitting on, so repeated
    // re-renders of the same first pick do not re-fire the reset. Cleared as soon
    // as the draft moves off P1P1, which arms the next draft's reset.
    let handledCurrentStart = false;

    function readDraftPosition() {
        const controlsEl = document.querySelector('#booster-controls');
        if (!controlsEl) return null;

        const match = controlsEl.textContent.match(/Pack\s*#(\d+),\s*Pick\s*#(\d+)/i);
        if (!match) return null;

        return { pack: parseInt(match[1], 10), pick: parseInt(match[2], 10) };
    }

    function checkForNewDraft() {
        const position = readDraftPosition();
        if (!position) return;

        lastDraftPosition = position;

        const atStart = position.pack === 1 && position.pick === 1;

        // Off P1P1: arm the reset so the next time we land on a first pick it
        // counts as a new draft.
        if (!atStart) {
            handledCurrentStart = false;
            return;
        }

        // On P1P1. Fire once per arrival, not once per re-render - Draftmancer
        // rebuilds this subtree on every render, so this runs many times per pick.
        if (handledCurrentStart) return;
        handledCurrentStart = true;

        if (colorFilter) {
            console.log('New draft detected (Pack #1, Pick #1) - clearing colour filter');
            clearColors();
        }
    }

    // ---------------------------------------------------------------------
    // On-screen controls
    //
    // iOS has no Ctrl key, and the software keyboard only emits key events while
    // a text field is focused, so the hotkeys below are unreachable on iPhone and
    // on iPad without a hardware keyboard. Every hotkey action is therefore also
    // available from a draggable on-screen control cluster.
    // ---------------------------------------------------------------------

    const UI_STATE_KEY = 'gihWROverlayUI';
    const MANUAL_EXPANSION_TTL = 24 * 60 * 60 * 1000;
    // Shorter than the expansion TTL: you draft the same set for days, but a
    // colour pair belongs to one draft (~1 hour).
    const COLOR_FILTER_TTL = 3 * 60 * 60 * 1000;
    let controls = null;

    function loadUIState() {
        try {
            return JSON.parse(localStorage.getItem(UI_STATE_KEY)) || {};
        } catch (e) {
            return {};
        }
    }

    function saveUIState(patch) {
        try {
            localStorage.setItem(UI_STATE_KEY, JSON.stringify(Object.assign(loadUIState(), patch)));
        } catch (e) {
            // Private browsing / storage disabled - controls still work, just not sticky
        }
    }

    const BUTTON_BASE = `
        appearance: none;
        -webkit-appearance: none;
        margin: 0;
        border: 1px solid rgba(255, 255, 255, 0.25);
        background: rgba(0, 0, 0, 0.8);
        color: #e0e7ff;
        font-family: inherit;
        font-weight: bold;
        line-height: 1;
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.4);
        cursor: pointer;
        touch-action: manipulation;
        -webkit-tap-highlight-color: transparent;
    `;

    // 44px minimum keeps every control inside Apple's recommended touch target
    function makeButton(text, title, extraCss) {
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = text;
        button.title = title;
        button.setAttribute('aria-label', title);
        button.style.cssText = BUTTON_BASE + extraCss;
        return button;
    }

    function createControls() {
        if (controls) return controls;

        const root = document.createElement('div');
        root.className = 'gih-wr-controls';
        root.style.cssText = `
            position: fixed;
            right: calc(12px + env(safe-area-inset-right, 0px));
            bottom: calc(12px + env(safe-area-inset-bottom, 0px));
            z-index: 2147483000;
            display: flex;
            flex-direction: column;
            align-items: flex-end;
            gap: 8px;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            touch-action: none;
            -webkit-user-select: none;
            user-select: none;
        `;

        const menu = document.createElement('div');
        menu.style.cssText = `
            display: none;
            flex-direction: column;
            align-items: flex-end;
            gap: 8px;
        `;

        const menuCss = 'min-height: 44px; padding: 0 14px; font-size: 14px; border-radius: 22px;';
        const setButton = makeButton('Set: —', 'Set expansion code', menuCss);
        const colorsButton = makeButton('Colors: Any', 'Filter win rates by deck colours', menuCss);
        const reloadButton = makeButton('Reload data', 'Reload 17Lands data', menuCss);
        menu.appendChild(setButton);
        menu.appendChild(colorsButton);
        menu.appendChild(reloadButton);

        const row = document.createElement('div');
        row.style.cssText = 'display: flex; align-items: center; gap: 8px;';

        const menuButton = makeButton('•••', 'More options',
            'width: 44px; height: 44px; font-size: 13px; border-radius: 22px;');
        const toggleButton = makeButton('WR', 'Toggle win rate overlay',
            'width: 52px; height: 52px; font-size: 15px; border-radius: 26px;');
        row.appendChild(menuButton);
        row.appendChild(toggleButton);

        root.appendChild(menu);
        root.appendChild(row);

        const closeMenu = () => { menu.style.display = 'none'; };

        toggleButton.addEventListener('click', () => {
            closeMenu();
            toggleOverlays();
        });

        menuButton.addEventListener('click', () => {
            menu.style.display = menu.style.display === 'none' ? 'flex' : 'none';
        });

        reloadButton.addEventListener('click', () => {
            closeMenu();
            reloadData();
        });

        setButton.addEventListener('click', () => {
            closeMenu();
            openExpansionDialog();
        });

        colorsButton.addEventListener('click', () => {
            closeMenu();
            openColorsDialog();
        });

        // Drag support: the cluster sits on top of the pick UI on small screens,
        // so it has to be movable. A pointer that travels more than a few pixels
        // is a drag, and the click it would produce is swallowed.
        let dragging = false;
        let moved = false;
        let startX = 0, startY = 0, originX = 0, originY = 0;

        function positionAt(x, y) {
            const rect = root.getBoundingClientRect();
            const maxX = Math.max(0, window.innerWidth - rect.width);
            const maxY = Math.max(0, window.innerHeight - rect.height);
            root.style.left = `${Math.min(Math.max(0, x), maxX)}px`;
            root.style.top = `${Math.min(Math.max(0, y), maxY)}px`;
            root.style.right = 'auto';
            root.style.bottom = 'auto';
        }

        root.addEventListener('pointerdown', (e) => {
            if (e.button) return;
            const rect = root.getBoundingClientRect();
            dragging = true;
            moved = false;
            startX = e.clientX;
            startY = e.clientY;
            originX = rect.left;
            originY = rect.top;
            root.setPointerCapture(e.pointerId);
        });

        root.addEventListener('pointermove', (e) => {
            if (!dragging) return;
            const dx = e.clientX - startX;
            const dy = e.clientY - startY;
            if (!moved && Math.hypot(dx, dy) < 8) return;
            moved = true;
            positionAt(originX + dx, originY + dy);
        });

        function endDrag(e) {
            if (!dragging) return;
            dragging = false;
            if (root.hasPointerCapture(e.pointerId)) {
                root.releasePointerCapture(e.pointerId);
            }
            if (moved) {
                const rect = root.getBoundingClientRect();
                saveUIState({ pos: { x: rect.left, y: rect.top } });
                // Reset after the click that follows this pointerup is swallowed
                setTimeout(() => { moved = false; }, 0);
            }
        }

        root.addEventListener('pointerup', endDrag);
        root.addEventListener('pointercancel', endDrag);
        root.addEventListener('click', (e) => {
            if (moved) {
                e.preventDefault();
                e.stopPropagation();
            }
        }, true);

        document.body.appendChild(root);

        const saved = loadUIState().pos;
        if (saved) {
            requestAnimationFrame(() => positionAt(saved.x, saved.y));
        }

        // Keep the cluster on screen through rotation and keyboard resizes
        const reclamp = () => {
            if (root.style.left) {
                positionAt(parseFloat(root.style.left), parseFloat(root.style.top));
            }
        };
        window.addEventListener('resize', reclamp);
        window.addEventListener('orientationchange', reclamp);

        controls = { root, toggleButton, setButton, colorsButton, menu };
        updateControls();
        return controls;
    }

    function updateControls() {
        if (!controls) return;

        const { root, toggleButton, setButton, colorsButton } = controls;
        toggleButton.setAttribute('aria-pressed', String(overlayEnabled));
        toggleButton.style.background = overlayEnabled ? 'rgba(96, 165, 250, 0.95)' : 'rgba(0, 0, 0, 0.8)';
        toggleButton.style.color = overlayEnabled ? '#0b1220' : '#e0e7ff';
        root.style.opacity = overlayEnabled ? '1' : '0.85';

        const expansion = manualExpansion || currentExpansion;
        setButton.textContent = `Set: ${expansion || '—'}`;
        setButton.title = manualExpansion
            ? `Expansion manually set to ${manualExpansion} - tap to change`
            : 'Set expansion code';

        colorsButton.textContent = lastLoadError
            ? `Colors: ${lastLoadError}`
            : `Colors: ${colorFilter || 'Any'}`;
        colorsButton.title = colorFilter
            ? `Win rates from ${colorFilter} decks - tap to change`
            : 'Filter win rates by deck colours';
        // Tint the row so an active filter is obvious at a glance - the numbers
        // mean something different while it is on.
        colorsButton.style.background = colorFilter ? 'rgba(96, 165, 250, 0.95)' : 'rgba(0, 0, 0, 0.8)';
        colorsButton.style.color = colorFilter ? '#0b1220' : '#e0e7ff';
    }

    // Replaces prompt(): a real input we control, so it can force uppercase,
    // avoid iOS autocorrect, and use a 16px font (anything smaller makes Safari
    // zoom the page when the field is focused).
    function openExpansionDialog() {
        const previous = document.querySelector('.gih-wr-dialog');
        if (previous) previous.remove();

        const backdrop = document.createElement('div');
        backdrop.className = 'gih-wr-dialog';
        backdrop.style.cssText = `
            position: fixed;
            inset: 0;
            z-index: 2147483001;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 16px;
            background: rgba(0, 0, 0, 0.55);
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        `;

        const panel = document.createElement('div');
        panel.style.cssText = `
            width: min(320px, 100%);
            box-sizing: border-box;
            padding: 16px;
            border-radius: 12px;
            background: #111827;
            color: #e0e7ff;
            box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
        `;

        const label = document.createElement('div');
        label.textContent = 'Expansion code';
        label.style.cssText = 'font-size: 14px; font-weight: bold; margin-bottom: 8px;';

        const input = document.createElement('input');
        input.type = 'text';
        input.value = manualExpansion || currentExpansion || '';
        input.placeholder = 'e.g. FIN, MH3, BLB';
        input.autocapitalize = 'characters';
        input.autocomplete = 'off';
        input.autocorrect = 'off';
        input.spellcheck = false;
        input.enterKeyHint = 'go';
        input.style.cssText = `
            width: 100%;
            box-sizing: border-box;
            padding: 10px;
            font-size: 16px;
            text-transform: uppercase;
            border-radius: 8px;
            border: 1px solid rgba(255, 255, 255, 0.25);
            background: #0b1220;
            color: #e0e7ff;
        `;

        const row = document.createElement('div');
        row.style.cssText = 'display: flex; justify-content: flex-end; gap: 8px; margin-top: 16px;';

        const dialogButtonCss = 'min-height: 44px; padding: 0 16px; font-size: 14px; border-radius: 8px;';
        const cancelButton = makeButton('Cancel', 'Cancel', dialogButtonCss);
        const applyButton = makeButton('Apply', 'Apply expansion code',
            dialogButtonCss + 'background: rgba(96, 165, 250, 0.95); color: #0b1220;');

        const close = () => backdrop.remove();
        const apply = () => {
            const value = input.value;
            close();
            applyExpansion(value);
        };

        cancelButton.addEventListener('click', close);
        applyButton.addEventListener('click', apply);
        backdrop.addEventListener('click', (e) => {
            if (e.target === backdrop) close();
        });
        input.addEventListener('keydown', (e) => {
            e.stopPropagation();
            if (e.key === 'Enter') apply();
            if (e.key === 'Escape') close();
        });

        row.appendChild(cancelButton);
        row.appendChild(applyButton);
        panel.appendChild(label);
        panel.appendChild(input);
        panel.appendChild(row);
        backdrop.appendChild(panel);
        document.body.appendChild(backdrop);

        // Focusing synchronously inside the tap handler is what gets iOS to
        // raise the software keyboard
        input.focus();
        input.select();
    }

    // Colour-pair picker.
    //
    // Deliberately built from five tap targets rather than a text field. Typing
    // "UW" into a text box would be normalised to "WU" anyway, and tapping two
    // mana symbols is both faster on desktop and the only comfortable option on
    // a phone, where the existing dialog pattern already works (it is a plain
    // DOM overlay, not prompt(), so nothing here is desktop-only).
    const COLOR_META = {
        W: { label: 'W', name: 'White', bg: '#fffbeb', fg: '#3b2f14' },
        U: { label: 'U', name: 'Blue', bg: '#93c5fd', fg: '#0b1220' },
        B: { label: 'B', name: 'Black', bg: '#6b7280', fg: '#0b1220' },
        R: { label: 'R', name: 'Red', bg: '#fca5a5', fg: '#3b1414' },
        G: { label: 'G', name: 'Green', bg: '#86efac', fg: '#0f2417' }
    };

    function openColorsDialog() {
        const previous = document.querySelector('.gih-wr-dialog');
        if (previous) previous.remove();

        const backdrop = document.createElement('div');
        backdrop.className = 'gih-wr-dialog';
        backdrop.style.cssText = `
            position: fixed;
            inset: 0;
            z-index: 2147483001;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 16px;
            background: rgba(0, 0, 0, 0.55);
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        `;

        const panel = document.createElement('div');
        panel.style.cssText = `
            width: min(340px, 100%);
            box-sizing: border-box;
            padding: 16px;
            border-radius: 12px;
            background: #111827;
            color: #e0e7ff;
            box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
        `;

        const label = document.createElement('div');
        label.textContent = 'Deck colours';
        label.style.cssText = 'font-size: 14px; font-weight: bold; margin-bottom: 4px;';

        const hint = document.createElement('div');
        hint.style.cssText = 'font-size: 12px; opacity: 0.75; margin-bottom: 12px;';

        // Working copy - nothing is fetched until Apply, so half-made
        // selections never trigger a request.
        let selected = new Set((colorFilter || '').split('').filter(Boolean));

        const swatchRow = document.createElement('div');
        swatchRow.style.cssText = 'display: flex; gap: 8px; justify-content: space-between;';

        const swatches = WUBRG.map(ch => {
            const meta = COLOR_META[ch];
            const button = makeButton(meta.label, meta.name,
                'flex: 1; min-width: 0; height: 52px; font-size: 18px; border-radius: 10px;');
            button.addEventListener('click', () => {
                if (selected.has(ch)) {
                    selected.delete(ch);
                } else {
                    selected.add(ch);
                }
                render();
            });
            swatchRow.appendChild(button);
            return { ch, button, meta };
        });

        const row = document.createElement('div');
        row.style.cssText = 'display: flex; justify-content: flex-end; gap: 8px; margin-top: 16px;';

        const dialogButtonCss = 'min-height: 44px; padding: 0 16px; font-size: 14px; border-radius: 8px;';
        const clearButton = makeButton('Clear', 'Show overall win rates', dialogButtonCss + 'margin-right: auto;');
        const cancelButton = makeButton('Cancel', 'Cancel', dialogButtonCss);
        const applyButton = makeButton('Apply', 'Apply colour filter',
            dialogButtonCss + 'background: rgba(96, 165, 250, 0.95); color: #0b1220;');

        function render() {
            const chosen = WUBRG.filter(ch => selected.has(ch)).join('');
            swatches.forEach(({ ch, button, meta }) => {
                const on = selected.has(ch);
                button.style.background = on ? meta.bg : 'rgba(0, 0, 0, 0.8)';
                button.style.color = on ? meta.fg : '#e0e7ff';
                button.style.borderColor = on ? meta.bg : 'rgba(255, 255, 255, 0.25)';
                button.setAttribute('aria-pressed', String(on));
            });
            hint.textContent = chosen
                ? `17Lands win rates from ${chosen} decks only.`
                : 'No filter - showing overall win rates.';
            applyButton.textContent = chosen ? `Apply ${chosen}` : 'Apply';
        }

        const close = () => {
            document.removeEventListener('keydown', onKey, true);
            backdrop.remove();
        };
        const apply = () => {
            const chosen = WUBRG.filter(ch => selected.has(ch)).join('');
            close();
            applyColors(chosen);
        };

        clearButton.addEventListener('click', () => { selected = new Set(); render(); });
        cancelButton.addEventListener('click', close);
        applyButton.addEventListener('click', apply);
        backdrop.addEventListener('click', (e) => {
            if (e.target === backdrop) close();
        });

        // There is no text input to hang key handling off, so listen at the
        // document (capture) and stop the page from also acting on the keys.
        function onKey(e) {
            if (e.key === 'Escape') {
                e.preventDefault();
                e.stopPropagation();
                close();
            } else if (e.key === 'Enter') {
                e.preventDefault();
                e.stopPropagation();
                apply();
            } else if (/^[wubrgWUBRG]$/.test(e.key)) {
                e.preventDefault();
                e.stopPropagation();
                const ch = e.key.toUpperCase();
                if (selected.has(ch)) selected.delete(ch); else selected.add(ch);
                render();
            }
        }
        document.addEventListener('keydown', onKey, true);

        row.appendChild(clearButton);
        row.appendChild(cancelButton);
        row.appendChild(applyButton);
        panel.appendChild(label);
        panel.appendChild(hint);
        panel.appendChild(swatchRow);
        panel.appendChild(row);
        backdrop.appendChild(panel);
        document.body.appendChild(backdrop);

        render();
    }

    // Keyboard shortcut handler (desktop / iPad with a hardware keyboard)
    function handleKeyPress(e) {
        if (!(e.ctrlKey || e.metaKey) || !e.shiftKey) return;

        // Toggle with Ctrl+Shift+A (or Cmd+Shift+A on Mac)
        if (e.key === 'A') {
            e.preventDefault();
            toggleOverlays();
        }

        // Reload data with Ctrl+Shift+R
        if (e.key === 'R') {
            e.preventDefault();
            reloadData();
        }

        // Manual set override with Ctrl+Shift+S
        if (e.key === 'S') {
            e.preventDefault();
            openExpansionDialog();
        }

        // Colour-pair filter with Ctrl+Shift+C
        if (e.key === 'C') {
            e.preventDefault();
            openColorsDialog();
        }
    }

    // Initialize
    async function init() {
        // Detect which site we're on
        detectSite();

        if (!currentSite) {
            console.error('Could not detect site - extension will not work');
            return;
        }

        console.log(`GIH WR Overlay script loaded for ${currentSite.name}.`);
        console.log('Hotkeys (desktop / hardware keyboard):');
        console.log('  Ctrl+Shift+A - Toggle overlay');
        console.log('  Ctrl+Shift+R - Reload data');
        console.log('  Ctrl+Shift+S - Manually set expansion code');
        console.log('  Ctrl+Shift+C - Set deck colour filter (e.g. WU)');
        console.log('On touch devices use the WR button in the corner (drag to move it).');

        // Restore a recent manual override so iPad users do not have to retype
        // the set every session. It expires so a stale code cannot silently
        // outlive the draft it was entered for.
        const uiState = loadUIState();
        if (uiState.manualExpansion && Date.now() - (uiState.manualExpansionAt || 0) < MANUAL_EXPANSION_TTL) {
            manualExpansion = uiState.manualExpansion;
            console.log(`Restored manual expansion override: ${manualExpansion}`);
        }

        // Same deal for the colour filter: a phone backgrounding the tab mid-draft
        // should not lose the archetype, but it expires so it cannot silently
        // colour a later session's numbers.
        if (uiState.colorFilter && Date.now() - (uiState.colorFilterAt || 0) < COLOR_FILTER_TTL) {
            colorFilter = normalizeColors(uiState.colorFilter) || null;
            if (colorFilter) console.log(`Restored colour filter: ${colorFilter}`);
        }

        document.addEventListener('keydown', handleKeyPress);
        createControls();
        observeCards();

        // Seed the baseline so an in-progress draft does not read as a brand new
        // one on the first mutation after a page reload. Loading directly into a
        // P1P1 means the restored filter belongs to *that* draft (you set it, then
        // reloaded), so treat its start as already handled.
        lastDraftPosition = readDraftPosition();
        handledCurrentStart = !!lastDraftPosition &&
            lastDraftPosition.pack === 1 && lastDraftPosition.pick === 1;

        // Wait for page to load
        await new Promise(resolve => setTimeout(resolve, 1000));

        // Detect expansion
        const expansion = manualExpansion || currentSite.expansionDetector();

        if (!expansion) {
            console.warn('No expansion detected. Use the ••• > Set button, or press Ctrl+Shift+S.');
            return;
        }

        // Load Scryfall mapping only if needed (Draftmancer)
        if (currentSite.needsScryfall) {
            await loadScryfallMapping();
        }

        // Try cache first
        const cacheLoaded = loadFromCache();

        // Fetch fresh data
        await loadCardData(expansion);

        // Cache the fresh data
        if (dataLoaded) {
            cacheData();
        }

        updateControls();
    }

    // Wait for page to be ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();