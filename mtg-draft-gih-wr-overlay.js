// ==UserScript==
// @name         MTG Draft GIH WR Overlay
// @namespace    http://tampermonkey.net/
// @version      2.1
// @description  Toggle overlay showing Game In Hand win rates for MTG cards on Draftmancer and 17Lands
// @author       You
// @match        https://draftmancer.com/*
// @match        https://www.17lands.com/*
// @license      MIT
// @grant        GM_xmlhttpRequest
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
    let setReleaseDatesCache = {}; // Cache for set release dates

    // Helper function to wrap GM_xmlhttpRequest as a Promise
    function gmFetch(url, options = {}) {
        return new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
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
                    reject(new Error(`GM_xmlhttpRequest failed: ${error}`));
                }
            });
        });
    }

    // Fetch set release date from Scryfall
    async function fetchSetReleaseDate(expansion) {
        // Check cache first
        if (setReleaseDatesCache[expansion]) {
            console.log(`Using cached release date for ${expansion}: ${setReleaseDatesCache[expansion]}`);
            return setReleaseDatesCache[expansion];
        }

        try {
            const url = `https://api.scryfall.com/sets/${expansion.toLowerCase()}`;
            console.log(`Fetching set data from Scryfall: ${url}`);

            const response = await gmFetch(url);

            if (!response.ok) {
                throw new Error(`Scryfall API error: ${response.status}`);
            }

            const setData = await response.json();
            const releaseDate = setData.released_at;

            if (releaseDate) {
                // Cache the release date
                setReleaseDatesCache[expansion] = releaseDate;

                // Save cache to localStorage
                try {
                    localStorage.setItem('setReleaseDatesCache', JSON.stringify(setReleaseDatesCache));
                } catch (e) {
                    console.warn('Failed to cache release dates:', e);
                }

                console.log(`Fetched release date for ${expansion}: ${releaseDate}`);
                return releaseDate;
            }

            return null;

        } catch (error) {
            console.error(`Error fetching set release date for ${expansion}:`, error);
            return null;
        }
    }

    // Load release dates cache from localStorage
    function loadReleaseDatesCache() {
        try {
            const cached = localStorage.getItem('setReleaseDatesCache');
            if (cached) {
                setReleaseDatesCache = JSON.parse(cached);
                console.log(`Loaded ${Object.keys(setReleaseDatesCache).length} cached release dates`);
            }
        } catch (e) {
            console.warn('Failed to load release dates cache:', e);
        }
    }

    // Get date range for API call
    async function getDateRange(expansion) {
        const releaseDate = await fetchSetReleaseDate(expansion);

        if (!releaseDate) {
            console.warn(`No release date found for ${expansion}, using default date range`);
            return null;
        }

        const today = new Date();
        const startDate = releaseDate; // Use release date as start
        const endDate = today.toISOString().split('T')[0]; // Today's date in YYYY-MM-DD format

        console.log(`Date range for ${expansion}: ${startDate} to ${endDate}`);

        return { startDate, endDate };
    }

    // Site detection and configuration
    const SITES = {
        DRAFTMANCER: {
            name: 'Draftmancer',
            detect: () => window.location.hostname.includes('draftmancer.com'),
            cardSelector: '.card[data-arena-id]',
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
            const scryfallIds = Array.from(cardElements).map(card =>
                card.getAttribute('data-arena-id')
            ).filter(id => id && !scryfallToName[id]);

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
        const scryfallId = cardElement.getAttribute('data-arena-id');
        return scryfallToName[scryfallId];
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
            console.log(`Fetching card data for ${expansion}...`);

            // Build URL with date parameters
            let url = `https://www.17lands.com/card_ratings/data?expansion=${expansion}&format=PremierDraft`;

            const dateRange = await getDateRange(expansion);
            if (dateRange) {
                url += `&start_date=${dateRange.startDate}&end_date=${dateRange.endDate}`;
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

            const data = await response.json();

            data.forEach(card => {
                if (card.name && card.ever_drawn_win_rate !== null) {
                    const id = card.mtga_id || card.arena_id || card.name;

                    cardData[id] = {
                        gihWR: card.ever_drawn_win_rate,
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

                if (age < 24 * 60 * 60 * 1000) {
                    cardData = cache.data;
                    currentExpansion = cache.expansion;
                    dataLoaded = true;
                    console.log(`Loaded ${Object.keys(cardData).length} cards from cache (${currentExpansion})`);
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
            return null;
        }

        if (data.gihWR === null || data.gihWR === undefined) {
            return null;
        }

        const overlay = document.createElement('div');
        overlay.className = 'gih-wr-overlay';

        const sampleWarning = data.gamesPlayed < 500 ? '⚠️ ' : '';

        // Different sizes for different sites
        const fontSize = currentSite === SITES.DRAFTMANCER ? '16px' : '12px';
        const padding = currentSite === SITES.DRAFTMANCER ? '5px 10px' : '3px 6px';

        overlay.style.cssText = `
            position: absolute;
            top: 32px;
            right: 8px;
            background: rgba(0, 0, 0, 0.85);
            color: ${getWinrateColor(data.gihWR)};
            padding: ${padding};
            border-radius: 4px;
            font-weight: bold;
            font-size: ${fontSize};
            z-index: 1000;
            pointer-events: none;
            box-shadow: 0 2px 4px rgba(0,0,0,0.3);
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        `;
        overlay.textContent = `${sampleWarning}GIH: ${(data.gihWR * 100).toFixed(1)}%`;

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

    // Toggle overlays on/off
    async function toggleOverlays() {
        overlayEnabled = !overlayEnabled;

        if (overlayEnabled) {
            // Reload Scryfall mapping for current cards before showing overlays
            if (currentSite && currentSite.needsScryfall) {
                await loadScryfallMapping();
            }
            showOverlays();
        } else {
            hideOverlays();
        }

        console.log(`GIH WR Overlay: ${overlayEnabled ? 'ON' : 'OFF'}`);
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
                        overlayEnabled = false;
                        hideOverlays();
                        console.log('Card selected - GIH WR Overlay turned OFF');
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

        observer.observe(document.body, {
            childList: true,
            subtree: true
        });
    }

    // Keyboard shortcut handler
    function handleKeyPress(e) {
        // Toggle with Ctrl+Shift+A (or Cmd+Shift+A on Mac)
        if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'A') {
            e.preventDefault();
            toggleOverlays();
        }

        // Reload data with Ctrl+Shift+R
        if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'R') {
            e.preventDefault();
            console.log('Reloading card data...');
            cardData = {};
            scryfallToName = {};
            dataLoaded = false;

            const expansion = manualExpansion || currentSite.expansionDetector();
            if (expansion) {
                if (currentSite.needsScryfall) {
                    loadScryfallMapping().then(() => {
                        loadCardData(expansion);
                    });
                } else {
                    loadCardData(expansion);
                }
            }
        }

        // Manual set override with Ctrl+Shift+S
        if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'S') {
            e.preventDefault();
            const expansion = prompt('Enter expansion code (e.g., FIN, MH3, BLB):');
            if (expansion) {
                manualExpansion = expansion.toUpperCase();
                console.log(`Manual expansion override set to: ${manualExpansion}`);
                cardData = {};
                scryfallToName = {};
                dataLoaded = false;

                if (currentSite.needsScryfall) {
                    loadScryfallMapping().then(() => {
                        loadCardData(manualExpansion);
                    });
                } else {
                    loadCardData(manualExpansion);
                }
            }
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
        console.log('Hotkeys:');
        console.log('  Ctrl+Shift+A - Toggle overlay');
        console.log('  Ctrl+Shift+R - Reload data');
        console.log('  Ctrl+Shift+S - Manually set expansion code');

        document.addEventListener('keydown', handleKeyPress);
        observeCards();

        // Load cached release dates
        loadReleaseDatesCache();

        // Wait for page to load
        await new Promise(resolve => setTimeout(resolve, 1000));

        // Detect expansion
        const expansion = manualExpansion || currentSite.expansionDetector();

        if (!expansion) {
            console.warn('No expansion detected. Press Ctrl+Shift+S to manually set it.');
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
    }

    // Wait for page to be ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();