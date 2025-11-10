/**
 * Flight Extracter - Content Script
 * Extracts flight data from MakeMyTrip and similar travel sites
 */

(function() {
  'use strict';

  // Flag to track if we're in auto-extraction mode
  let autoExtractMode = false;
  let pendingExtraction = null;

  // Store original console methods BEFORE creating Logger (to avoid recursion)
  const originalConsoleLog = console.log.bind(console);
  const originalConsoleWarn = console.warn.bind(console);
  const originalConsoleError = console.error.bind(console);

  /**
   * Logging system - stores logs in chrome.storage and allows download
   */
  const Logger = {
    logs: [],
    maxLogs: 10000, // Maximum number of logs to keep in memory
    
    /**
     * Add a log entry
     * @param {string} level - Log level: 'info', 'warn', 'error', 'success'
     * @param {string} message - Log message
     * @param {Object} data - Optional additional data
     */
    log(level, message, data = null) {
      const timestamp = new Date().toISOString();
      const logEntry = {
        timestamp,
        level,
        message,
        data: data ? JSON.stringify(data) : null,
        url: window.location.href
      };
      
      this.logs.push(logEntry);
      
      // Keep only last maxLogs entries
      if (this.logs.length > this.maxLogs) {
        this.logs.shift();
      }
      
      // Also log to console using ORIGINAL console methods (to avoid recursion)
      const prefix = `[${timestamp}] [${level.toUpperCase()}]`;
      try {
        if (data) {
          originalConsoleLog(prefix, message, data);
        } else {
          originalConsoleLog(prefix, message);
        }
      } catch (e) {
        // Ignore console errors
      }
      
      // Save to chrome.storage periodically (every 10 logs)
      if (this.logs.length % 10 === 0) {
        this.saveToStorage();
      }
    },
    
    /**
     * Save logs to chrome.storage
     */
    async saveToStorage() {
      try {
        await chrome.storage.local.set({ 
          flightExtractorLogs: this.logs,
          flightExtractorLogsTimestamp: new Date().toISOString()
        });
      } catch (error) {
        console.error('Failed to save logs to storage:', error);
      }
    },
    
    /**
     * Load logs from chrome.storage
     */
    async loadFromStorage() {
      try {
        const result = await chrome.storage.local.get(['flightExtractorLogs']);
        if (result.flightExtractorLogs && Array.isArray(result.flightExtractorLogs)) {
          this.logs = result.flightExtractorLogs;
        }
      } catch (error) {
        console.error('Failed to load logs from storage:', error);
      }
    },
    
    /**
     * Get all logs as text
     */
    getLogsAsText() {
      return this.logs.map(log => {
        let line = `[${log.timestamp}] [${log.level.toUpperCase()}] ${log.message}`;
        if (log.data) {
          line += ` | Data: ${log.data}`;
        }
        if (log.url) {
          line += ` | URL: ${log.url}`;
        }
        return line;
      }).join('\n');
    },
    
    /**
     * Clear all logs
     */
    clear() {
      this.logs = [];
      chrome.storage.local.remove(['flightExtractorLogs', 'flightExtractorLogsTimestamp']);
    }
  };

  // Initialize logger - load existing logs
  Logger.loadFromStorage();
  
  // Flag to prevent infinite recursion
  let isLogging = false;
  
  // Override console methods to also log to our system
  console.log = function(...args) {
    originalConsoleLog.apply(console, args);
    if (!isLogging) {
      isLogging = true;
      try {
        Logger.log('info', args.join(' '));
      } catch (e) {
        // Ignore logging errors to prevent recursion
      } finally {
        isLogging = false;
      }
    }
  };
  
  console.warn = function(...args) {
    originalConsoleWarn.apply(console, args);
    if (!isLogging) {
      isLogging = true;
      try {
        Logger.log('warn', args.join(' '));
      } catch (e) {
        // Ignore logging errors to prevent recursion
      } finally {
        isLogging = false;
      }
    }
  };
  
  console.error = function(...args) {
    originalConsoleError.apply(console, args);
    if (!isLogging) {
      isLogging = true;
      try {
        Logger.log('error', args.join(' '));
      } catch (e) {
        // Ignore logging errors to prevent recursion
      } finally {
        isLogging = false;
      }
    }
  };

  /**
   * Check if current page is a search results page and trigger extraction if needed
   * ONLY FOR DOMESTIC TRIPS (not international)
   */
  function checkAndAutoExtract() {
    const url = window.location.href;
    // console.log('=== checkAndAutoExtract() called ==='); // COMMENTED FOR PERFORMANCE
    // console.log('Current URL:', url); // COMMENTED FOR PERFORMANCE
    
    // Check if we're on a search results page
    if (url.includes('/flight/search') || url.includes('/listing')) {
      // console.log('=== Auto-extraction check: Search results page detected ==='); // COMMENTED FOR PERFORMANCE
      // console.log(`URL: ${url}`); // COMMENTED FOR PERFORMANCE
      
      // Prevent multiple extractions
      if (autoExtractMode) {
        // console.log('⚠ Auto-extraction already in progress, skipping...'); // COMMENTED FOR PERFORMANCE
        return;
      }
      
      // FIRST: Check URL parameter for intl flag (most reliable)
      const urlParams = new URLSearchParams(window.location.search);
      const intlParam = urlParams.get('intl');
      
      if (intlParam === 'true') {
        // console.log('⚠ Auto-extraction skipped: URL indicates international trip (intl=true)'); // COMMENTED FOR PERFORMANCE
        // console.log('⚠ Please use "Extract International Flights" button for international trips'); // COMMENTED FOR PERFORMANCE
        return; // Exit early - don't auto-extract international trips
      }
      
      // If intl=false or not set, treat as domestic (even if clusterContent exists)
      // clusterContent can appear in both domestic and international, so we rely on URL param
      // console.log('✓ Confirmed: This is a DOMESTIC trip (intl=false or not set) - proceeding with auto-extraction'); // COMMENTED FOR PERFORMANCE
      
      // Check if we have pending extraction data in sessionStorage
      try {
        const pendingData = sessionStorage.getItem('pendingExtraction');
        if (pendingData) {
          console.log('Found pending extraction data, parsing...');
          const extractionParams = JSON.parse(pendingData);
          sessionStorage.removeItem('pendingExtraction'); // Clear after reading
          
          // Mark as in progress
          autoExtractMode = true;
          
          // Wait for page to fully load
          setTimeout(async () => {
            console.log('=== Starting auto-extraction after page load ===');
            console.log('Extraction params:', extractionParams);
            try {
              await waitForPageReady();
              await performAutoExtraction(extractionParams);
            } catch (error) {
              console.error('Error in auto-extraction:', error);
              autoExtractMode = false; // Reset on error
            }
          }, 3000);
        } else {
          // Check if URL has search parameters (direct navigation)
          // intlParam already checked above, so if we reach here, it's domestic
          const itinerary = urlParams.get('itinerary');
          
          if (itinerary) {
            console.log('=== Direct URL navigation detected (domestic), starting extraction ===');
            console.log(`Itinerary: ${itinerary}`);
            
            // Parse itinerary: SOURCE-DEST-DD/MM/YYYY
            const parts = itinerary.split('-');
            if (parts.length >= 3) {
              const sourceCode = parts[0];
              const destCode = parts[1];
              const dateStr = parts.slice(2).join('-'); // Handle dates with slashes
              
              // Mark as in progress
              autoExtractMode = true;
              
              setTimeout(async () => {
                try {
                  await waitForPageReady();
                  await performAutoExtraction({
                    sourceCode: sourceCode,
                    destCode: destCode,
                    dateStr: dateStr,
                    daysOffset: null // Will be calculated if needed
                  });
                } catch (error) {
                  console.error('Error in auto-extraction:', error);
                  autoExtractMode = false; // Reset on error
                }
              }, 3000);
            }
          }
        }
      } catch (error) {
        console.error('Error in auto-extraction check:', error);
      }
    }
  }

  /**
   * Wait for page to be ready (flight cards loaded)
   */
  async function waitForPageReady() {
    console.log('=== waitForPageReady() started ===');
    console.log('Current URL:', window.location.href);
    let attempts = 0;
    const maxAttempts = 40; // Increased attempts
    
    while (attempts < maxAttempts) {
      // Try multiple selectors
      const cards1 = document.querySelectorAll('div.listingCard');
      const cards2 = document.querySelectorAll('div[class*="listingCard"]');
      const cards3 = document.querySelectorAll('div.clusterContent div.listingCard');
      const cards4 = document.querySelectorAll('div.splitVw');
      const cards5 = document.querySelectorAll('div[class*="flightCard"], div[class*="FlightCard"]');
      
      const totalCards = cards1.length + cards2.length + cards3.length + cards4.length + cards5.length;
      
      console.log(`Attempt ${attempts + 1}/${maxAttempts}: Checking for flight cards...`);
      console.log(`  - listingCard: ${cards1.length}`);
      console.log(`  - [class*="listingCard"]: ${cards2.length}`);
      console.log(`  - clusterContent listingCard: ${cards3.length}`);
      console.log(`  - splitVw: ${cards4.length}`);
      console.log(`  - flightCard: ${cards5.length}`);
      console.log(`  - Total: ${totalCards}`);
      
      if (totalCards > 0) {
        console.log(`✓ Page ready! Found ${totalCards} flight cards`);
        await sleep(200); // Reduced wait for stability
        return true;
      }
      
      await sleep(200); // Reduced polling interval
      attempts++;
    }
    
    console.warn('⚠ Page may not be fully ready after all attempts, but continuing...');
    console.warn('⚠ This might indicate the page structure is different or still loading');
    return false;
  }

  /**
   * Perform auto-extraction after page load
   * ONLY FOR DOMESTIC TRIPS
   */
  async function performAutoExtraction(params) {
    try {
      console.log('=== Performing Auto-Extraction (Domestic Only) ===');
      console.log('Params:', params);
      Logger.log('info', 'Starting auto-extraction', params);
      
      // Validate using URL parameter (most reliable) instead of DOM structure
      // DOM structure (clusterContent) can appear in both domestic and international
      const urlParams = new URLSearchParams(window.location.search);
      const intlParam = urlParams.get('intl');
      
      if (intlParam === 'true') {
        console.error('✗ Validation failed: URL indicates international trip (intl=true)');
        console.error('✗ Auto-extraction only works for DOMESTIC trips');
        console.error('✗ Please use "Extract International Flights" button for international trips');
        autoExtractMode = false; // Reset flag
        processNextRoute(); // Try next route
        return; // Exit early - don't extract international trips
      }
      
      console.log('✓ Validation passed: This is a DOMESTIC trip (intl=false or not set)');
      
      // Check if flight cards exist before extraction
      const cardsBeforeExtraction = document.querySelectorAll('div.listingCard, div[class*="listingCard"], div.clusterContent div.listingCard, div.splitVw');
      console.log(`Flight cards found before extraction: ${cardsBeforeExtraction.length}`);
      
      if (cardsBeforeExtraction.length === 0) {
        console.warn('⚠ No flight cards found! Waiting a bit more...');
        await sleep(800 * sleepMultiplier);
        const cardsAfterWait = document.querySelectorAll('div.listingCard, div[class*="listingCard"], div.clusterContent div.listingCard, div.splitVw');
        console.log(`Flight cards found after additional wait: ${cardsAfterWait.length}`);
        
        if (cardsAfterWait.length === 0) {
          console.error('✗ Still no flight cards found. Cannot proceed with extraction.');
          console.error('✗ Please check if the page has loaded correctly.');
          autoExtractMode = false; // Reset flag
          processNextRoute(); // Try next route
          return;
        }
      }
      
      const tripType = detectTripTypeFromUI();
      console.log(`Detected trip type: ${tripType}`);
      console.log(`\n>>> Calling extractFlightsSequentially(${tripType})...`);
      
      // Ensure we use the domestic extraction function
      const flightData = await extractFlightsSequentially(tripType);
      
      console.log(`<<< extractFlightsSequentially() returned`);
      console.log(`Flight data received:`, flightData ? 'Yes' : 'No');
      if (flightData && flightData.flights) {
        console.log(`Number of flights: ${flightData.flights.length}`);
      }
      
      if (flightData && flightData.flights && Array.isArray(flightData.flights) && flightData.flights.length > 0) {
        console.log(`✓ Auto-extraction successful! Found ${flightData.flights.length} flights`);
        Logger.log('success', `Auto-extraction successful`, { 
          flightsCount: flightData.flights.length,
          route: `${params.sourceCode}-${params.destCode}`,
          date: params.dateStr
        });
        
        // Add route info if available
        if (params.sourceCode && params.destCode) {
          flightData.flights.forEach(flight => {
            flight.route_source = params.sourceCode;
            flight.route_destination = params.destCode;
            flight.route_source_city = params.sourceCode;
            flight.route_destination_city = params.destCode;
            if (params.dateStr) {
              flight.departure_date_formatted = params.dateStr;
            }
          });
        }
        
        // Auto-download the JSON file
        const dateStr = params.dateStr || new Date().toISOString().split('T')[0];
        const filename = `flight-${params.sourceCode}-${params.destCode}-${dateStr}.json`;
        
        console.log(`Auto-downloading: ${filename}`);
        Logger.log('info', `Auto-downloading JSON file: ${filename}`, { 
          sourceCode: params.sourceCode, 
          destCode: params.destCode, 
          dateStr: dateStr,
          flightsCount: flightData.flights.length 
        });
        
        chrome.runtime.sendMessage({
          action: 'saveJSON',
          data: flightData,
          filename: filename
        }, (response) => {
          if (response && response.success) {
            console.log(`✓ Successfully saved: ${filename}`);
            Logger.log('success', `Successfully saved: ${filename}`, { flightsCount: flightData.flights.length });
          } else {
            console.warn(`⚠ Failed to save: ${filename}`, response?.error);
            Logger.log('error', `Failed to save: ${filename}`, { error: response?.error });
          }
        });
        
        // Wait a bit after download
        await sleep(300 * sleepMultiplier);
      } else {
        console.warn('⚠ Auto-extraction completed but no flights found');
        Logger.log('warn', 'Auto-extraction completed but no flights found', params);
      }
      
      // Reset flag and process next route
      autoExtractMode = false;
      Logger.saveToStorage(); // Save logs before processing next route
      processNextRoute();
      
    } catch (error) {
      console.error('✗ Auto-extraction error:', error);
      autoExtractMode = false; // Reset flag on error
      processNextRoute(); // Try next route even on error
    }
  }

  /**
   * Send progress update to popup
   */
  function sendProgressUpdate(completed, total, route, dateOffset) {
    try {
      chrome.runtime.sendMessage({
        action: 'progressUpdate',
        completed: completed,
        total: total,
        route: route,
        dateOffset: dateOffset,
        timestamp: new Date().toISOString()
      }, (response) => {
        if (chrome.runtime.lastError) {
          // Popup might be closed, ignore error
        }
      });
    } catch (error) {
      // Ignore errors - popup might not be open
    }
  }

  /**
   * Process the next route in the queue
   */
  function processNextRoute() {
    try {
      // Get remaining routes from sessionStorage
      const remainingRoutesData = sessionStorage.getItem('remainingRoutes');
      if (!remainingRoutesData) {
        console.log('=== No more routes to process ===');
        Logger.log('success', 'All routes and dates processed successfully');
        Logger.saveToStorage();
        return;
      }
      
      const data = JSON.parse(remainingRoutesData);
      const { routes, dateOffsets, currentRouteIndex, currentDateIndex } = data;
      
      // Calculate progress
      const totalCombinations = routes.length * dateOffsets.length;
      const completed = (currentRouteIndex * dateOffsets.length) + currentDateIndex + 1;
      
      console.log(`\n=== Processing Next Route ===`);
      console.log(`Progress: ${completed}/${totalCombinations} completed`);
      console.log(`Current route index: ${currentRouteIndex}/${routes.length}`);
      console.log(`Current date index: ${currentDateIndex}/${dateOffsets.length}`);
      
      Logger.log('info', `Processing route ${currentRouteIndex + 1}/${routes.length}, date ${currentDateIndex + 1}/${dateOffsets.length}`, {
        completed,
        total: totalCombinations,
        progress: `${completed}/${totalCombinations}`
      });
      
      // Send progress update to popup
      const currentRoute = routes[currentRouteIndex];
      sendProgressUpdate(completed, totalCombinations, `${currentRoute.source}-${currentRoute.dest}`, dateOffsets[currentDateIndex]);
      
      // Check if we have more dates for current route
      if (currentDateIndex < dateOffsets.length - 1) {
        // Process next date for current route
        const nextDateIndex = currentDateIndex + 1;
        const route = routes[currentRouteIndex];
        const daysOffset = dateOffsets[nextDateIndex];
        
        console.log(`Processing next date: Route ${route.source}-${route.dest}, Date offset: +${daysOffset} days`);
        
        // Calculate departure date
        const departureDate = new Date();
        departureDate.setDate(departureDate.getDate() + daysOffset);
        
        // Construct search URL
        const searchUrl = constructFlightSearchUrl(
          route.source,
          route.dest,
          departureDate,
          'O', // One Way
          false, // Domestic
          1, 0, 0, 'E' // 1 Adult, Economy
        );
        
        // Update sessionStorage with next date index
        sessionStorage.setItem('remainingRoutes', JSON.stringify({
          routes: routes,
          dateOffsets: dateOffsets,
          currentRouteIndex: currentRouteIndex,
          currentDateIndex: nextDateIndex
        }));
        
        // Store extraction parameters
        const extractionParams = {
          sourceCode: route.source,
          destCode: route.dest,
          daysOffset: daysOffset,
          dateStr: departureDate.toISOString().split('T')[0],
          dateFormatted: departureDate.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }).replace(/ /g, '-')
        };
        sessionStorage.setItem('pendingExtraction', JSON.stringify(extractionParams));
        
        // Navigate to next URL
        console.log(`Navigating to next URL: ${searchUrl}`);
        window.location.href = searchUrl;
        
      } else if (currentRouteIndex < routes.length - 1) {
        // Move to next route, first date
        const nextRouteIndex = currentRouteIndex + 1;
        const route = routes[nextRouteIndex];
        const daysOffset = dateOffsets[0];
        
        console.log(`Moving to next route: ${route.source}-${route.dest}, Date offset: +${daysOffset} days`);
        
        // Calculate departure date
        const departureDate = new Date();
        departureDate.setDate(departureDate.getDate() + daysOffset);
        
        // Construct search URL
        const searchUrl = constructFlightSearchUrl(
          route.source,
          route.dest,
          departureDate,
          'O', // One Way
          false, // Domestic
          1, 0, 0, 'E' // 1 Adult, Economy
        );
        
        // Update sessionStorage with next route
        sessionStorage.setItem('remainingRoutes', JSON.stringify({
          routes: routes,
          dateOffsets: dateOffsets,
          currentRouteIndex: nextRouteIndex,
          currentDateIndex: 0
        }));
        
        // Store extraction parameters
        const extractionParams = {
          sourceCode: route.source,
          destCode: route.dest,
          daysOffset: daysOffset,
          dateStr: departureDate.toISOString().split('T')[0],
          dateFormatted: departureDate.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }).replace(/ /g, '-')
        };
        sessionStorage.setItem('pendingExtraction', JSON.stringify(extractionParams));
        
        // Navigate to next URL
        console.log(`Navigating to next URL: ${searchUrl}`);
        window.location.href = searchUrl;
        
      } else {
        // All routes and dates processed
        const totalCombinations = routes.length * dateOffsets.length;
        console.log('=== All Routes and Dates Processed Successfully ===');
        Logger.log('success', `All ${totalCombinations} route-date combinations processed successfully`);
        Logger.saveToStorage();
        
        // Send final progress update
        sendProgressUpdate(totalCombinations, totalCombinations, 'All', null);
        
        sessionStorage.removeItem('remainingRoutes');
        sessionStorage.removeItem('pendingExtraction');
      }
    } catch (error) {
      console.error('Error processing next route:', error);
    }
  }

  /**
   * Detect if trip is international or domestic
   * Returns 'international' or 'domestic'
   */
  function detectInternationalOrDomestic() {
    // Method 1: Check for clusterContent structure (international trips use this)
    const clusterContent = document.querySelector('div.clusterContent, div[class*="clusterContent"]');
    if (clusterContent) {
      console.log('✓ Detected: International trip (clusterContent structure found)');
      return 'international';
    }
    
    // Method 2: Check URL for international indicators
    const url = window.location.href.toLowerCase();
    if (url.includes('/international') || url.includes('/intl') || url.includes('international-flights')) {
      console.log('✓ Detected: International trip (URL indicator)');
      return 'international';
    }
    
    // Method 3: Check page content for international indicators
    const pageText = document.body.textContent?.toLowerCase() || '';
    if (pageText.includes('international flights') || pageText.includes('international travel')) {
      console.log('✓ Detected: International trip (page content indicator)');
      return 'international';
    }
    
    // Method 4: Check for splitVw structure (domestic round trips use this)
    const splitView = document.querySelector('div.splitVw, div[class*="splitVw"]');
    if (splitView) {
      console.log('✓ Detected: Domestic trip (splitVw structure found)');
      return 'domestic';
    }
    
    // Default: assume domestic if no international indicators found
    console.log('✓ Detected: Domestic trip (default - no international indicators found)');
    return 'domestic';
  }

  // Performance optimization flags
  const ENABLE_VERBOSE_LOGS = false; // Disable verbose logging for performance
  const SLEEP_REDUCTION_FACTOR = 0.3; // Reduce sleep times by 70% (0.3 = 30% of original time)
  let sleepMultiplier = 1.0; // Sleep multiplier (can be set via UI)
  
  // Optimized logging functions (only log if verbose mode enabled)
  const optLog = ENABLE_VERBOSE_LOGS ? originalConsoleLog : () => {};
  const optWarn = ENABLE_VERBOSE_LOGS ? originalConsoleWarn : () => {};
  
  // Listen for messages from popup
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    // Set sleep multiplier if provided
    if (request.sleepMultiplier !== undefined) {
      sleepMultiplier = Math.max(0.1, Math.min(2.0, parseFloat(request.sleepMultiplier) || 1.0));
    }
    
    if (request.action === 'extractFlights') {
      // ISOLATED: Extract Flights - Only handles DOMESTIC trips (one-way OR round trip)
      // console.log('=== Extract Flights Button Clicked (DOMESTIC Only - One-way & Round Trip) ==='); // COMMENTED FOR PERFORMANCE
      
      // Check if multiple routes are provided
      if (request.routes && Array.isArray(request.routes) && request.routes.length > 0) {
        // console.log('=== Multiple Routes Mode: Processing all routes and dates ==='); // COMMENTED FOR PERFORMANCE
        
        const routes = request.routes;
        const dateOffsets = request.dateOffsets || [1, 7, 14, 30];
        
        // Send immediate response that processing has started
        // Then continue processing in background (files will be auto-downloaded)
        sendResponse({ 
          success: true, 
          message: 'Processing started. Files will be auto-downloaded as each route-date combination completes.',
          total_combinations: routes.length * dateOffsets.length
        });
        
        // Log start of processing
        const totalCombos = routes.length * dateOffsets.length;
        Logger.log('info', `Starting multiple routes processing`, {
          routes: routes.length,
          dates: dateOffsets.length,
          totalCombinations: totalCombos
        });
        
        // Process in background (don't wait for response channel)
        processMultipleRoutesAndDates(routes, dateOffsets).then((flightData) => {
          console.log('=== Multiple Routes Extraction Completed ===');
          Logger.log('success', 'Multiple routes extraction completed', {
            totalFlights: flightData?.flights?.length || 0
          });
          Logger.saveToStorage();
          
          if (flightData && flightData.flights && Array.isArray(flightData.flights)) {
            console.log(`Total flights extracted: ${flightData.flights.length}`);
          } else {
            console.log('No flight data returned or invalid format');
          }
          // Note: sendResponse already called above, so we just log completion
        }).catch((error) => {
          console.error('Multiple routes extraction error:', error);
          Logger.log('error', 'Multiple routes extraction error', { error: error.message });
          Logger.saveToStorage();
          // Note: sendResponse already called above, so we just log error
        });
        
        return false; // Response already sent
      }
      
      // Step 1: Check if this is international or domestic
      const tripCategory = detectInternationalOrDomestic();
      if (tripCategory === 'international') {
        const errorMsg = 'This is an INTERNATIONAL trip. Please use "Extract International Round Trip" button instead.';
        console.error(`✗ ${errorMsg}`);
        sendResponse({ success: false, error: errorMsg });
        return true;
      }
      
      console.log(`✓ Confirmed: This is a DOMESTIC trip`);
      
      // Step 2: Check if we need to fill search form first
      const hasFlightCards = document.querySelectorAll('div.listingCard, div[class*="listingCard"], div.clusterContent, div.splitVw').length > 0;
      const isSearchPage = window.location.href.includes('/flights/') && !window.location.href.includes('/listing');
      
      if (!hasFlightCards && (isSearchPage || request.fillForm)) {
        // Need to fill search form first
        console.log('=== Flight search form detected, filling form first ===');
        
        const searchParams = request.searchParams || {
          sourceCity: 'Delhi',
          destinationCity: 'Bangalore',
          daysOffset: 1
        };
        
        const requestedTripType = request.tripType || 'one_way';
        
        if (requestedTripType === 'one_way') {
          fillFlightSearchFormOneWay(searchParams).then((formFilled) => {
            if (!formFilled) {
              console.error('✗ Failed to fill search form');
              try {
                sendResponse({ success: false, error: 'Failed to fill search form' });
              } catch (e) {
                console.error('Error sending response:', e);
              }
              return;
            }
            
            console.log('✓ Search form filled, proceeding with extraction...');
            sleep(2000).then(() => {
      const tripType = detectTripTypeFromUI();
              extractFlightsSequentially(tripType).then((flightData) => {
                console.log('=== Extract Flights Button Completed ===');
                try {
                  sendResponse({ success: true, data: flightData });
                } catch (e) {
                  console.error('Error sending response:', e);
                }
              }).catch((error) => {
                console.error('Extraction error:', error);
                try {
                  sendResponse({ success: false, error: error.message });
                } catch (e) {
                  console.error('Error sending error response:', e);
                }
              });
            });
          }).catch((error) => {
            console.error('Error filling form:', error);
            try {
              sendResponse({ success: false, error: error.message });
            } catch (e) {
              console.error('Error sending error response:', e);
            }
          });
          
          return true; // Keep channel open for async response
        }
      }
      
      // Step 3: Check trip type (one-way or round trip)
      const tripType = detectTripTypeFromUI();
      console.log(`Detected trip type: ${tripType} (DOMESTIC)`);
      
      // Step 4: Uncheck "Non Stop" filter (for both one-way and round trip)
      uncheckNonStopFilter().then(() => {
        // Wait for the page to update after unchecking filter
        return sleep(1500);
      }).then(() => {
        // Step 3: Click all "X options available" links to expand group cards
        return clickAllOptionsAvailableLinks();
      }).then(() => {
        // Wait for expanded options to fully load and render
        return sleep(2500);
      }).then(() => {
        // Step 4: Click "more flights available" link to load all flights
        return clickMoreFlightsLink();
      }).then(() => {
        // Wait for more flights to load and render
        return sleep(2500);
      }).then(() => {
        // Step 5: Process cards sequentially based on trip type
        // This will handle one-way OR domestic round trip (splitVw structure)
        return extractFlightsSequentially(tripType);
      }).then((flightData) => {
        console.log('=== Extract Flights Button Completed ===');
        try {
        sendResponse({ success: true, data: flightData });
        } catch (e) {
          console.error('Error sending response (channel may be closed):', e);
        }
      }).catch((error) => {
        console.error('Extraction error:', error);
        try {
        sendResponse({ success: false, error: error.message });
        } catch (e) {
          console.error('Error sending error response (channel may be closed):', e);
        }
      });
      return true; // Keep channel open for async response
    } else if (request.action === 'extractInternationalRoundTrip') {
      // ISOLATED: Extract International Round Trip - Only handles INTERNATIONAL trips (one-way OR round trip)
      console.log('=== Extract International Round Trip Button Clicked (INTERNATIONAL Only - One-way & Round Trip) ===');
      
      // Step 1: Check if this is international or domestic
      const tripCategory = detectInternationalOrDomestic();
      if (tripCategory === 'domestic') {
        const errorMsg = 'This is a DOMESTIC trip. Please use "Extract Flights" button instead.';
        console.error(`✗ ${errorMsg}`);
        sendResponse({ success: false, error: errorMsg });
        return true;
      }
      
      console.log(`✓ Confirmed: This is an INTERNATIONAL trip`);
      
      // Step 2: Check trip type (one-way or round trip)
      const tripType = detectTripTypeFromUI();
      console.log(`Detected trip type: ${tripType} (INTERNATIONAL)`);
      
      const startTime = Date.now();
      extractInternationalFlights(startTime, tripType).then((flightData) => {
        console.log('=== Extract International Round Trip Button Completed ===');
        try {
          sendResponse({ success: true, data: flightData });
        } catch (e) {
          console.error('Error sending response (channel may be closed):', e);
        }
      }).catch((error) => {
        console.error('International extraction error:', error);
        try {
          sendResponse({ success: false, error: error.message });
        } catch (e) {
          console.error('Error sending error response (channel may be closed):', e);
        }
      });
      return true; // Keep channel open for async response
    }
  });

  /**
   * Construct flight search URL with parameters
   * @param {string} sourceCode - Source city code (e.g., "BLR")
   * @param {string} destCode - Destination city code (e.g., "PAT")
   * @param {Date} departureDate - Departure date object
   * @param {string} tripType - "O" for One Way, "R" for Round Trip
   * @param {boolean} isInternational - true for international, false for domestic
   * @param {number} adults - Number of adults (default: 1)
   * @param {number} children - Number of children (default: 0)
   * @param {number} infants - Number of infants (default: 0)
   * @param {string} cabinClass - Cabin class (default: "E" for Economy)
   * @returns {string} - Complete search URL
   */
  function constructFlightSearchUrl(sourceCode, destCode, departureDate, tripType = 'O', isInternational = false, adults = 1, children = 0, infants = 0, cabinClass = 'E') {
    // Format date as DD/MM/YYYY
    const day = String(departureDate.getDate()).padStart(2, '0');
    const month = String(departureDate.getMonth() + 1).padStart(2, '0');
    const year = departureDate.getFullYear();
    const dateStr = `${day}/${month}/${year}`;
    
    // Construct itinerary: SOURCE-DEST-DATE
    const itinerary = `${sourceCode.toUpperCase()}-${destCode.toUpperCase()}-${dateStr}`;
    
    // Construct paxType: A-{adults}_C-{children}_I-{infants}
    const paxType = `A-${adults}_C-${children}_I-${infants}`;
    
    // Build URL
    const baseUrl = 'https://www.makemytrip.com/flight/search';
    const params = new URLSearchParams({
      itinerary: itinerary,
      tripType: tripType,
      paxType: paxType,
      intl: String(isInternational),
      cabinClass: cabinClass,
      lang: 'eng'
    });
    
    return `${baseUrl}?${params.toString()}`;
  }

  /**
   * Process multiple routes and dates for one-way trips
   * @param {Array} routes - Array of route objects [{source: "BLR", dest: "PAT"}, ...]
   * @param {Array} dateOffsets - Array of day offsets [1, 7, 14, 30]
   * @param {boolean} useDirectUrl - If true, navigate directly to search URL instead of filling form
   * @returns {Promise<Object>} - Aggregated flight data from all routes and dates
   */
  async function processMultipleRoutesAndDates(routes, dateOffsets, useDirectUrl = true) {
    const allFlights = [];
    const allMetadata = [];
    const startTime = Date.now();
    
    // console.log('=== Processing Multiple Routes and Dates ==='); // COMMENTED FOR PERFORMANCE
    // console.log(`Routes: ${routes.length}, Date offsets: ${dateOffsets.length}`); // COMMENTED FOR PERFORMANCE
    // console.log(`Total combinations: ${routes.length * dateOffsets.length}`); // COMMENTED FOR PERFORMANCE
    
    // Use city codes directly (BLR, PAT, etc.) - the form accepts these codes
    let combinationCount = 0;
    const totalCombinations = routes.length * dateOffsets.length;
    
    // Process routes sequentially - start with first route and first date
    // Remaining routes will be processed by processNextRoute() after each extraction
    const routeIndex = 0;
    const dateIndex = 0;
    
    const firstRoute = routes[routeIndex];
    const sourceCode = firstRoute.source || firstRoute.from;
    const destCode = firstRoute.dest || firstRoute.to || firstRoute.destination;
    const sourceCity = sourceCode.toUpperCase();
    const destCity = destCode.toUpperCase();
    const firstDateOffset = dateOffsets[dateIndex];
    
    // console.log(`\n--- Starting Sequential Processing ---`); // COMMENTED FOR PERFORMANCE
    // console.log(`Total routes: ${routes.length}, Total dates per route: ${dateOffsets.length}`); // COMMENTED FOR PERFORMANCE
    // console.log(`Total combinations: ${totalCombinations}`); // COMMENTED FOR PERFORMANCE
    // console.log(`First route: ${sourceCode} → ${destCode}, First date: +${firstDateOffset} days`); // COMMENTED FOR PERFORMANCE
    
    try {
      // Calculate departure date
      const departureDate = new Date();
      departureDate.setDate(departureDate.getDate() + firstDateOffset);
      
      if (useDirectUrl) {
        // METHOD 1: Direct URL navigation (faster and more reliable)
        console.log(`Using direct URL navigation for ${sourceCode}-${destCode} (+${firstDateOffset} days)...`);
        
        // Construct search URL
        const searchUrl = constructFlightSearchUrl(
          sourceCode,
          destCode,
          departureDate,
          'O', // One Way
          false, // Domestic
          1, 0, 0, 'E' // 1 Adult, Economy
        );
        
        console.log(`Navigating to: ${searchUrl}`);
        
        // Store remaining routes in sessionStorage for sequential processing
        const remainingRoutes = {
          routes: routes,
          dateOffsets: dateOffsets,
          currentRouteIndex: routeIndex,
          currentDateIndex: dateIndex
        };
            
            try {
              sessionStorage.setItem('remainingRoutes', JSON.stringify(remainingRoutes));
              console.log('✓ Stored remaining routes in sessionStorage');
            } catch (e) {
              console.warn('⚠ Could not store remaining routes:', e);
            }
            
        // Store extraction parameters in sessionStorage before navigation
        const extractionParams = {
          sourceCode: sourceCode,
          destCode: destCode,
          daysOffset: firstDateOffset,
          dateStr: departureDate.toISOString().split('T')[0],
          dateFormatted: departureDate.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }).replace(/ /g, '-')
        };
        
        try {
          sessionStorage.setItem('pendingExtraction', JSON.stringify(extractionParams));
          console.log('✓ Stored extraction parameters in sessionStorage');
        } catch (e) {
          console.warn('⚠ Could not store in sessionStorage:', e);
        }
        
        // Navigate directly to search results URL
        console.log(`Navigating to search URL (page will reload)...`);
        console.log(`Route: ${sourceCode}-${destCode}, Date: +${firstDateOffset} days`);
        console.log(`Progress: Route ${routeIndex + 1}/${routes.length}, Date ${dateIndex + 1}/${dateOffsets.length}`);
        console.log(`Note: Extraction will automatically start when the new page loads`);
        console.log(`Note: After extraction, it will automatically continue with next route/date`);
        window.location.href = searchUrl;
            
            // Note: Execution stops here because page reloads
            // Auto-extraction will be triggered by checkAndAutoExtract() when page loads
            // After extraction completes, processNextRoute() will continue with next route/date
            return; // Exit early - extraction will happen on page load via checkAndAutoExtract()
            
          } else {
            // METHOD 2: Form filling (fallback method)
            console.log(`Using form filling method for ${sourceCode}-${destCode} (+${daysOffset} days)...`);
            
            // Navigate to search page if not already there
            const currentUrl = window.location.href;
            const isOnSearchPage = currentUrl.includes('/flights/') && !currentUrl.includes('/listing');
            
            if (!isOnSearchPage) {
              console.log('Navigating to flight search page...');
              window.location.href = 'https://www.makemytrip.com/flights/';
              await waitForNavigation('/flights/', 10000);
            } else {
              // If on results page, navigate back to search
              if (currentUrl.includes('/listing')) {
                console.log('On results page, navigating back to search...');
                window.location.href = 'https://www.makemytrip.com/flights/';
                await waitForNavigation('/flights/', 10000);
              }
            }
            
            // Wait for page to be ready - use event-driven wait
            console.log('Waiting for page to be ready...');
            
            // Wait for search form to appear
            const hasSearchForm = await waitForElement('form[data-test="component-form-FC"], input#departure, div.multiDropDownVal', 5000);
            if (!hasSearchForm) {
              console.warn('⚠ Search form not found after waiting');
            }
            
            // Fill the search form
            const formFilled = await fillFlightSearchFormOneWay({
              sourceCity: sourceCity,
              destinationCity: destCity,
              daysOffset: firstDateOffset
            });
            
            if (!formFilled) {
              console.error(`✗ Failed to fill form for ${sourceCode}-${destCode} (+${firstDateOffset} days)`);
              return; // Exit - processNextRoute will handle continuation
            }
            
            // Wait for results to fully load - use event-driven wait
            console.log('Waiting for search results to load...');
            await waitForLoadingToComplete(8000);
          }
          
          // Note: For direct URL method, extraction happens via auto-extraction after page load
          // This code path is for form filling method (fallback)
          // Since we're using direct URL by default, this section is less likely to execute
          console.log('Form filling method - extraction should happen automatically after results load');
          return;
          
        } catch (error) {
          console.error(`✗ Error processing ${sourceCode}-${destCode} (+${firstDateOffset} days):`, error);
          return; // Exit - processNextRoute will handle continuation
        }
    
    const executionTimeMs = Date.now() - startTime;
    const executionTimeSeconds = (executionTimeMs / 1000).toFixed(2);
    
    console.log(`\n=== Completed Processing All Routes and Dates ===`);
    console.log(`Total flights extracted: ${allFlights.length}`);
    console.log(`Total execution time: ${executionTimeSeconds}s`);
    
    return {
      metadata: {
        scraped_at: new Date().toISOString(),
        source_url: window.location.href,
        flights_count: allFlights.length,
        user_agent: navigator.userAgent,
        trip_type: 'one_way',
        routes_processed: routes.length,
        date_offsets_processed: dateOffsets.length,
        total_combinations: totalCombinations,
        execution_time_ms: executionTimeMs,
        execution_time_seconds: parseFloat(executionTimeSeconds),
        execution_time_formatted: `${executionTimeSeconds}s`,
        route_metadata: allMetadata
      },
      flights: allFlights
    };
  }

  /**
   * Fill flight search form for one-way trip
   * @param {Object} params - Search parameters
   * @param {string} params.sourceCity - Source city name (e.g., "Delhi" or "BLR")
   * @param {string} params.destinationCity - Destination city name (e.g., "Bangalore" or "PAT")
   * @param {number} params.daysOffset - Days from today (1, 7, 14, or 30)
   * @returns {Promise<boolean>} - Returns true if form filled successfully
   */
  async function fillFlightSearchFormOneWay(params) {
    const { sourceCity, destinationCity, daysOffset } = params;
    
    console.log('=== Filling Flight Search Form (One Way) ===');
    console.log(`Parameters: ${sourceCity} → ${destinationCity}, Departure: +${daysOffset} days`);
    
    let stepFailed = false;
    let failureReason = '';
    
    try {
      // STEP 1: Select Trip Type - "One Way"
      console.log('Step 1: Selecting trip type "One Way"...');
      
      // Find the trip type dropdown wrapper - use event-driven wait
      const tripTypeWrapper = await waitForElement('div[data-test="component-tripType-wrapper"], div.tripTypeWrapper', 3000);
      
      if (!tripTypeWrapper) {
        failureReason = 'Trip type wrapper not found';
        console.error(`✗ ${failureReason}`);
        stepFailed = true;
        return false;
      }
      
      console.log('✓ Found trip type wrapper');
      
      // Find the dropdown value element
      let dropdownVal = tripTypeWrapper.querySelector('div.multiDropDownVal');
      if (!dropdownVal) {
        failureReason = 'Trip type dropdown not found';
        console.error(`✗ ${failureReason}`);
        stepFailed = true;
        return false;
      }
      
      console.log('✓ Found trip type dropdown');
      const currentValue = dropdownVal.textContent?.trim() || '';
      console.log(`Current trip type: "${currentValue}"`);
      
      // Check if already "One Way"
      if (currentValue.toLowerCase().includes('one') && currentValue.toLowerCase().includes('way')) {
        console.log('✓ Trip type already set to "One Way"');
      } else {
        // Click to open dropdown
        console.log('Clicking trip type dropdown to open...');
        dropdownVal.scrollIntoView({ behavior: 'smooth', block: 'center' });
        await waitForClickable(dropdownVal, 2000);
        dropdownVal.click();
        
        // Wait for dropdown to open and find "One Way" option
        console.log('Looking for "One Way" option in dropdown...');
        await sleep(200); // Small wait for dropdown to render
        
        // Wait for dropdown options to appear, then search for "One Way"
        const dropdownOptions = await waitForElement('li[role="option"], div[role="option"], ul li, .dropdown-menu li', 2000);
        if (dropdownOptions) {
          // Find "One Way" option by searching all options
          const allOptions = document.querySelectorAll('li[role="option"], div[role="option"], ul li, .dropdown-menu li, [class*="option"]');
          let foundOption = null;
          
          for (const option of allOptions) {
            const optionText = option.textContent?.trim().toLowerCase() || '';
            if (optionText.includes('one') && (optionText.includes('way') || optionText.includes('one-way'))) {
              foundOption = option;
              break;
            }
          }
          
          if (foundOption) {
            console.log('Found "One Way" option, clicking...');
            foundOption.scrollIntoView({ behavior: 'smooth', block: 'center' });
            await waitForClickable(foundOption, 1000);
            foundOption.click();
            await sleep(200); // Small wait for selection to apply
            console.log('✓ Trip type set to "One Way"');
          } else {
            console.warn('⚠ "One Way" option not found in dropdown');
          }
        } else {
          console.warn('⚠ Dropdown options not found');
        }
      }
      
      // STEP 2: Enter Source City
      // Use city code (e.g., "BLR") instead of full name
      const sourceCityCode = sourceCity.toUpperCase(); // BLR, PAT, etc.
      console.log(`Step 2: Entering source city code "${sourceCityCode}"...`);
      
      // Find source input by data-test attribute (readonly input) - use event-driven wait
      let sourceInput = await waitForElement('input[data-test="component-fromcity-inputBox"], input#fromCity, input[data-cy="fromCity"]', 3000);
      
      if (!sourceInput) {
        // Try finding by wrapper
        const sourceWrapper = await waitForElement('div[data-test="component-fromCityDropdown"]', 2000);
        if (sourceWrapper) {
          sourceInput = sourceWrapper.querySelector('input#fromCity, input[data-test*="fromcity"]');
        }
      }
      
      if (!sourceInput) {
        failureReason = 'Source city input not found';
        console.error(`✗ ${failureReason}`);
        stepFailed = true;
        return false;
      }
      
      console.log('✓ Found source city input');
      
      // Click on the readonly input to open city selector modal
      console.log('Clicking source city input to open selector...');
      sourceInput.scrollIntoView({ behavior: 'smooth', block: 'center' });
      await waitForClickable(sourceInput, 2000);
      sourceInput.click();
      
      // Wait for city selector modal/popup to open - use event-driven wait
      await waitForElement('input.react-autosuggest__input[placeholder*="City" i], input.react-autosuggest__input', 3000);
      
      // Now find the search input in the city selector modal
      console.log('Looking for city search input in modal...');
      let sourceCitySearchInput = document.querySelector('input.react-autosuggest__input[placeholder="Enter City"], input.react-autosuggest__input[placeholder*="City" i]');
      
      if (!sourceCitySearchInput) {
        // Try finding any autosuggest input in the modal
        const modalInputs = document.querySelectorAll('input.react-autosuggest__input');
        if (modalInputs.length > 0) {
          sourceCitySearchInput = modalInputs[0];
          console.log('Using first autosuggest input in modal');
        }
      }
      
      if (!sourceCitySearchInput) {
        console.warn('⚠ City search input not found in modal, trying alternative...');
        await sleep(300 * sleepMultiplier);
        sourceCitySearchInput = document.querySelector('input[type="text"]:not([readonly])');
      }
      
      if (sourceCitySearchInput) {
        console.log('✓ Found city search input in modal');
        console.log(`Typing source city code: "${sourceCityCode}"...`);
        
        // Focus and clear
        sourceCitySearchInput.focus();
        sourceCitySearchInput.value = '';
        sourceCitySearchInput.dispatchEvent(new Event('input', { bubbles: true }));
        
        // Type city code character by character (e.g., "BLR") - reduced sleep
        for (let i = 0; i < sourceCityCode.length; i++) {
          const char = sourceCityCode[i];
          sourceCitySearchInput.value += char;
          sourceCitySearchInput.dispatchEvent(new KeyboardEvent('keydown', { key: char, bubbles: true }));
          sourceCitySearchInput.dispatchEvent(new KeyboardEvent('keypress', { key: char, bubbles: true }));
          sourceCitySearchInput.dispatchEvent(new Event('input', { bubbles: true }));
          sourceCitySearchInput.dispatchEvent(new KeyboardEvent('keyup', { key: char, bubbles: true }));
          await sleep(100); // Reduced from 200
        }
        
        console.log(`✓ Typed source city code: "${sourceCityCode}"`);
        console.log('Waiting for autocomplete suggestions...');
        
        // Wait for suggestions to appear - use event-driven wait
        await waitForElement('ul.react-autosuggest__suggestions-list li[role="option"], li.react-autosuggest__suggestion[role="option"]', 4000);
        const allSuggestions = document.querySelectorAll('ul.react-autosuggest__suggestions-list li[role="option"], li.react-autosuggest__suggestion[role="option"]');
        console.log(`Found ${allSuggestions.length} suggestions`);
        
        if (allSuggestions.length > 0) {
          console.log(`Found ${allSuggestions.length} suggestions, selecting first one...`);
          allSuggestions[0].scrollIntoView({ behavior: 'smooth', block: 'center' });
          await waitForClickable(allSuggestions[0], 1000);
          allSuggestions[0].click();
          await sleep(2000); // Reduced from 3000
          console.log('✓ Source city selected from suggestions');
        } else {
          console.warn('⚠ No suggestions found for source city');
          await sleep(300 * sleepMultiplier);
        }
      } else {
        console.warn('⚠ City search input not found in modal - modal may have different structure');
        await sleep(300 * sleepMultiplier);
      }
      
      // Additional wait after source city selection
      await sleep(1500);
      
      // STEP 3: Enter Destination City
      // Use city code (e.g., "PAT") instead of full name
      const destCityCode = destinationCity.toUpperCase(); // BLR, PAT, etc.
      console.log(`Step 3: Entering destination city code "${destCityCode}"...`);
      
      // Wait a bit after source city selection
      await sleep(1500);
      
      // Find destination input by data-test or data-cy attribute (readonly input)
      let destInput = document.querySelector('input[data-test*="toCity"], input#toCity, input[data-cy="toCity"]');
      
      if (!destInput) {
        // Try finding by wrapper or span label
        const destWrapper = document.querySelector('div[data-test*="toCity"], span[data-test="component-To"]');
        if (destWrapper) {
          destInput = destWrapper.closest('div').querySelector('input#toCity, input[data-test*="toCity"]');
        }
      }
      
      if (!destInput) {
        // Try finding by label
        const destLabel = document.querySelector('span[data-test="component-To"]');
        if (destLabel) {
          const parentDiv = destLabel.closest('div');
          if (parentDiv) {
            destInput = parentDiv.querySelector('input#toCity, input[type="text"]');
          }
        }
      }
      
      if (!destInput) {
        failureReason = 'Destination city input not found';
        console.error(`✗ ${failureReason}`);
        stepFailed = true;
        return false;
      }
      
      console.log('✓ Found destination city input');
      
      // Click on the readonly input to open city selector modal
      console.log('Clicking destination city input to open selector...');
      destInput.scrollIntoView({ behavior: 'smooth', block: 'center' });
      await sleep(500);
      destInput.click();
      await sleep(3000); // Wait for city selector modal/popup to open
      
      // Now find the search input in the city selector modal
      console.log('Looking for city search input in modal...');
      let destCitySearchInput = document.querySelector('input.react-autosuggest__input[placeholder="Enter City"], input.react-autosuggest__input[placeholder*="City" i]');
      
      if (!destCitySearchInput) {
        // Try finding any autosuggest input in the modal
        const modalInputs = document.querySelectorAll('input.react-autosuggest__input');
        if (modalInputs.length > 0) {
          destCitySearchInput = modalInputs[0];
          console.log('Using first autosuggest input in modal');
        }
      }
      
      if (!destCitySearchInput) {
        console.warn('⚠ City search input not found in modal, trying alternative...');
        await sleep(300 * sleepMultiplier);
        destCitySearchInput = document.querySelector('input[type="text"]:not([readonly])');
      }
      
      if (destCitySearchInput) {
        console.log('✓ Found city search input in modal');
        console.log(`Typing destination city code: "${destCityCode}"...`);
        
        // Focus and clear
        destCitySearchInput.focus();
        await sleep(100 * sleepMultiplier);
        destCitySearchInput.value = '';
        destCitySearchInput.dispatchEvent(new Event('input', { bubbles: true }));
        await sleep(300);
        
        // Type city code character by character (e.g., "PAT")
        for (let i = 0; i < destCityCode.length; i++) {
          const char = destCityCode[i];
          destCitySearchInput.value += char;
          destCitySearchInput.dispatchEvent(new KeyboardEvent('keydown', { key: char, bubbles: true }));
          destCitySearchInput.dispatchEvent(new KeyboardEvent('keypress', { key: char, bubbles: true }));
          destCitySearchInput.dispatchEvent(new Event('input', { bubbles: true }));
          destCitySearchInput.dispatchEvent(new KeyboardEvent('keyup', { key: char, bubbles: true }));
          await sleep(200);
        }
        
        console.log(`✓ Typed destination city code: "${destCityCode}"`);
        console.log('Waiting for autocomplete suggestions...');
        await sleep(4000);
        
        // Select first suggestion
        let destSuggestions = document.querySelectorAll('ul.react-autosuggest__suggestions-list li[role="option"], li.react-autosuggest__suggestion[role="option"]');
        console.log(`Found ${destSuggestions.length} suggestions on first try`);
        
        if (destSuggestions.length === 0) {
          await sleep(3000);
          destSuggestions = document.querySelectorAll('ul.react-autosuggest__suggestions-list li[role="option"], li.react-autosuggest__suggestion[role="option"]');
          console.log(`Found ${destSuggestions.length} suggestions on second try`);
        }
        
        if (destSuggestions.length > 0) {
          console.log(`Found ${destSuggestions.length} suggestions, selecting first one...`);
          destSuggestions[0].scrollIntoView({ behavior: 'smooth', block: 'center' });
          await sleep(200 * sleepMultiplier);
          destSuggestions[0].click();
          await sleep(3000);
          console.log('✓ Destination city selected from suggestions');
        } else {
          console.warn('⚠ No suggestions found for destination city');
          await sleep(300 * sleepMultiplier);
        }
      } else {
        console.warn('⚠ City search input not found in modal - modal may have different structure');
        await sleep(300 * sleepMultiplier);
      }
      
      // Additional wait after destination city selection
      await sleep(1500);
      
      // STEP 4: Select Departure Date
      console.log(`Step 4: Selecting departure date (+${daysOffset} days)...`);
      const departureDate = new Date();
      departureDate.setDate(departureDate.getDate() + daysOffset);
      
      const dateStr = departureDate.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
      const targetDay = departureDate.getDate();
      const targetMonth = departureDate.toLocaleDateString('en-US', { month: 'long' });
      const targetMonthShort = departureDate.toLocaleDateString('en-US', { month: 'short' });
      const targetYear = departureDate.getFullYear();
      
      console.log(`Target date: ${dateStr}`);
      console.log(`Looking for date: Day ${targetDay}, Month ${targetMonth} (${targetMonthShort}), Year ${targetYear}`);
      
      // Find departure date input by data-test attribute
      let depInput = document.querySelector('input[data-test="component-Departure-inputBox"], input#departure[data-cy="departure"], input#departure');
      
      if (!depInput) {
        // Try finding by label
        console.warn('⚠ Departure input not found with primary selector, trying alternatives...');
        const depLabel = document.querySelector('label[for="departure"]');
        if (depLabel) {
          depInput = depLabel.querySelector('input#departure');
          if (!depInput) {
            depInput = depLabel; // Use label itself if input not found inside
          }
        }
      }
      
      if (!depInput) {
        failureReason = 'Departure date input not found';
        console.error(`✗ ${failureReason}`);
        stepFailed = true;
        await sleep(300 * sleepMultiplier);
        return false;
      }
      
      console.log('✓ Found departure date input');
      
      // Click to open date picker (input is readonly)
      console.log('Clicking to open date picker...');
      depInput.scrollIntoView({ behavior: 'smooth', block: 'center' });
      await sleep(500);
      depInput.click();
      await sleep(3000); // Wait for date picker to open
      
      console.log(`Searching for day ${targetDay} in calendar...`);
      
      // Use DayPicker structure - find day by aria-label or text content
      let dateSelected = false;
      
      // First, try finding by aria-label (DayPicker format: "Sunday, 9 November 2025")
      const dayPickerDays = document.querySelectorAll('div.DayPicker-Day[role="gridcell"]');
      console.log(`Found ${dayPickerDays.length} DayPicker day elements`);
      
      for (const dayEl of dayPickerDays) {
        const ariaLabel = dayEl.getAttribute('aria-label') || '';
        const text = dayEl.textContent?.trim() || '';
        const isDisabled = dayEl.classList.contains('DayPicker-Day--disabled') ||
                          dayEl.getAttribute('aria-disabled') === 'true';
        
        // Check if aria-label contains the target day
        if (ariaLabel.includes(String(targetDay)) && !isDisabled) {
          console.log(`Found target date by aria-label: "${ariaLabel}"`);
          dayEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
          await sleep(200 * sleepMultiplier);
          dayEl.click();
          await sleep(300 * sleepMultiplier);
          dateSelected = true;
          console.log(`✓ Departure date selected: Day ${targetDay}`);
          break;
        }
        
        // Also check text content for day number (inside dateContainer > p)
        const dateContainer = dayEl.querySelector('div.dateContainer');
        if (dateContainer && !isDisabled) {
          const dayText = dateContainer.querySelector('p');
          if (dayText && dayText.textContent?.trim() === String(targetDay)) {
            console.log(`Found target date by text content: Day ${targetDay}`);
            dayEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
            await sleep(200 * sleepMultiplier);
            dayEl.click();
            await sleep(300 * sleepMultiplier);
            dateSelected = true;
            console.log(`✓ Departure date selected: Day ${targetDay}`);
            break;
          }
        }
      }
      
      if (!dateSelected) {
        console.warn('⚠ Could not find target date in DayPicker, trying alternative methods...');
        
        // Fallback: try finding by text content in all date elements
        const allDateElements = document.querySelectorAll('div[class*="Day"], div[class*="day"], td, [role="gridcell"]');
        for (const dateEl of allDateElements) {
          const text = dateEl.textContent?.trim() || '';
          const ariaLabel = dateEl.getAttribute('aria-label') || '';
          
          // Check if text or aria-label contains the day number
          if ((text === String(targetDay) || ariaLabel.includes(String(targetDay))) && 
              !dateEl.classList.contains('disabled') && 
              dateEl.getAttribute('aria-disabled') !== 'true') {
            console.log(`Found date element with text "${text}", clicking...`);
            dateEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
            await sleep(200 * sleepMultiplier);
            dateEl.click();
            await sleep(300 * sleepMultiplier);
            dateSelected = true;
            console.log(`✓ Departure date selected (fallback method)`);
            break;
          }
        }
      }
      
      if (!dateSelected) {
        console.warn(`⚠ Could not select date (Day ${targetDay}). Date picker may need manual selection.`);
        console.warn('⚠ Continuing anyway - you may need to select the date manually');
      }
      
      await sleep(1500);
      
      // STEP 5: Click Search Button
      console.log('Step 5: Clicking Search button...');
      await sleep(1000); // Wait before clicking search
      
      // Find search button - it's an anchor tag with class "widgetSearchBtn"
      let searchButton = document.querySelector('a.widgetSearchBtn, a.primaryBtn.widgetSearchBtn, a[class*="widgetSearchBtn"]');
      
      if (!searchButton) {
        // Try finding by data-cy attribute
        searchButton = document.querySelector('a[data-cy="submit"], p[data-cy="submit"] a');
      }
      
      if (!searchButton) {
        // Try finding by text content
        const allLinks = document.querySelectorAll('a.primaryBtn, a[class*="primaryBtn"]');
        for (const link of allLinks) {
          const linkText = link.textContent?.trim().toUpperCase() || '';
          if (linkText.includes('SEARCH')) {
            searchButton = link;
            break;
          }
        }
      }
      
      if (!searchButton) {
        // Fallback: try button elements
        const allButtons = document.querySelectorAll('button');
        for (const btn of allButtons) {
          const btnText = btn.textContent?.trim().toUpperCase() || '';
          if (btnText.includes('SEARCH') || btnText.includes('SEARCH FLIGHTS')) {
            searchButton = btn;
            break;
          }
        }
      }
      
      if (!searchButton) {
        console.error('✗ Search button not found');
        await sleep(300 * sleepMultiplier);
        return false;
      }
      
      console.log('✓ Found search button');
      
      // Validate form before submitting
      console.log('Validating form before submission...');
      const sourceInputCheck = document.querySelector('input[data-test="component-fromcity-inputBox"], input#fromCity');
      const destInputCheck = document.querySelector('input[data-test*="toCity"], input#toCity');
      const dateInputCheck = document.querySelector('input[data-test="component-Departure-inputBox"], input#departure');
      
      if (sourceInputCheck && destInputCheck) {
        const sourceValue = sourceInputCheck.value || '';
        const destValue = destInputCheck.value || '';
        
        if (sourceValue === destValue && sourceValue) {
          console.error('✗ Source and destination are the same - this will cause validation error');
          console.error('✗ Form cannot be submitted with same cities');
          return false;
        }
        
        if (!sourceValue || !destValue) {
          console.error('✗ Source or destination is empty - form not ready');
          return false;
        }
      }
      
      if (!dateInputCheck || !dateInputCheck.value) {
        console.error('✗ Departure date is empty - form not ready');
        return false;
      }
      
      console.log('✓ Form validation passed');
      
      // Check if it's an anchor tag - if so, we need to handle it carefully
      if (searchButton.tagName === 'A') {
        const href = searchButton.getAttribute('href');
        console.log(`Search button is anchor tag, href: "${href || 'none'}"`);
        
        // If href exists and points somewhere, we might need to prevent default
        if (href && href !== '#' && href !== 'javascript:void(0)') {
          console.warn('⚠ Anchor has href that might cause navigation');
        }
      }
      
      // Scroll button into view
      searchButton.scrollIntoView({ behavior: 'smooth', block: 'center' });
      await sleep(1000);
      
      // Click the search button
      // For anchor tags without href or with #, clicking should trigger JavaScript handler
      console.log('Clicking search button...');
      searchButton.click();
      console.log('✓ Search button clicked');
      
      // Wait a moment for any immediate navigation
      await sleep(1000);
      
      await sleep(300 * sleepMultiplier); // Wait after clicking
      
      // STEP 6: Wait for navigation to results page
      console.log('Step 6: Waiting for navigation to results page...');
      
      // Monitor URL changes to detect navigation
      const initialUrl = window.location.href;
      let navigationDetected = false;
      let resultsPageLoaded = false;
      
      // Wait for URL to change (navigation to results page)
      for (let i = 0; i < 15; i++) {
        await sleep(200 * sleepMultiplier);
        const currentUrl = window.location.href;
        
        // Check if we're on results page
        if (currentUrl.includes('/listing') || currentUrl.includes('/flights/listing')) {
          console.log(`✓ Navigated to results page: ${currentUrl}`);
          navigationDetected = true;
          resultsPageLoaded = true;
          break;
        }
        
        // Check if we navigated to home page (error case)
        if (currentUrl !== initialUrl && (currentUrl.endsWith('/') || currentUrl.includes('/flights') && !currentUrl.includes('/listing'))) {
          console.warn(`⚠ Navigation detected but not to results page: ${currentUrl}`);
          if (i < 5) {
            // Might still be redirecting, wait more
            continue;
          } else {
            console.error('✗ Navigation went to wrong page (possibly home page)');
            console.error('✗ This might indicate a form validation error or search failure');
            // Try to navigate back or continue anyway
            break;
          }
        }
      }
      
      if (!resultsPageLoaded) {
        console.warn('⚠ Results page navigation not detected, checking for flight cards anyway...');
      }
      
      // Wait for flight cards to appear
      console.log('Waiting for flight results to load...');
      await sleep(5000); // Initial wait
      
      let attempts = 0;
      const maxAttempts = 30; // Increased max attempts
      while (attempts < maxAttempts) {
        const cards = document.querySelectorAll('div.listingCard, div[class*="listingCard"], div.clusterContent div.listingCard, div.splitVw');
        if (cards.length > 0) {
          console.log(`✓ Flight results loaded! Found ${cards.length} cards`);
          resultsPageLoaded = true;
          break;
        }
        await sleep(300 * sleepMultiplier); // Wait time between attempts
        attempts++;
      }
      
      if (!resultsPageLoaded) {
        console.error('✗ Flight results page did not load');
        console.error('✗ Possible reasons:');
        console.error('  - Form validation failed (e.g., same source and destination)');
        console.error('  - Search button navigation issue');
        console.error('  - Page took too long to load');
        return false;
      }
      
      // Additional wait for page to stabilize
      await sleep(3000); // Increased wait time
      await waitForLoadingToComplete(8000); // Increased wait time
      await sleep(300 * sleepMultiplier); // Final buffer
      
      console.log('=== Flight Search Form Filled Successfully ===');
      return true;
      
    } catch (error) {
      console.error('✗ Error filling flight search form:', error);
      console.error('Error details:', error.message, error.stack);
      if (stepFailed && failureReason) {
        console.error(`Failed at step with reason: ${failureReason}`);
      }
      return false;
    }
  }

  /**
   * Click all "X options available" links to expand group booking cards
   */
  async function clickAllOptionsAvailableLinks() {
    console.log('Looking for "X options available" links...');
    
    // Find all flight count links that contain "options available" or similar text
    const selectors = [
      'span.flight-count.fontSize14.pointer[data-test="component-flight-count"]',
      'span[data-test="component-flight-count"]',
      'span.flight-count.fontSize14.pointer',
      'span.flight-count'
    ];
    
    const allLinks = [];
    
    // Try each selector
    for (const selector of selectors) {
      try {
        const elements = document.querySelectorAll(selector);
        for (const el of elements) {
          const text = el.textContent?.trim().toLowerCase() || '';
          // Match patterns like "13 options available", "2 options available", etc.
          if (text.includes('options available') || text.includes('option available') || 
              (text.includes('available') && /\d+/.test(text))) {
            // Check if it's inside a group booking card
            const groupCard = el.closest('div.groupBookingCard');
            if (groupCard) {
              allLinks.push({ element: el, text: el.textContent?.trim(), groupCard });
            }
          }
        }
      } catch (e) {
        // Invalid selector, continue
      }
    }
    
    if (allLinks.length === 0) {
      console.log('⚠ No "X options available" links found');
      return;
    }
    
    console.log(`Found ${allLinks.length} "X options available" links to click`);
    
    // Click each link
    for (let i = 0; i < allLinks.length; i++) {
      const { element, text, groupCard } = allLinks[i];
      
      try {
        console.log(`Clicking link ${i + 1}/${allLinks.length}: "${text}"`);
        
        // Check if the group card is collapsed
        if (groupCard && groupCard.classList.contains('collapsed')) {
          console.log(`  Group card is collapsed, will expand it`);
        }
        
        // Scroll into view
        element.scrollIntoView({ behavior: 'smooth', block: 'center' });
        await sleep(300);
        
        // Check if visible
        if (!isElementVisible(element)) {
          console.log(`  ⚠ Link ${i + 1} is not visible, skipping...`);
          continue;
        }
        
        // Method 1: Direct click
        try {
          element.click();
          console.log(`  ✓ Clicked link ${i + 1}`);
          await sleep(100 * sleepMultiplier); // Wait for expansion
        } catch (clickError) {
          console.error(`  ✗ Error clicking link ${i + 1}:`, clickError);
          
          // Method 2: MouseEvent
          try {
            const mouseEvent = new MouseEvent('click', {
              bubbles: true,
              cancelable: true,
              view: window,
              detail: 1,
              buttons: 1
            });
            element.dispatchEvent(mouseEvent);
            console.log(`  ✓ Dispatched click event on link ${i + 1}`);
            await sleep(100 * sleepMultiplier);
          } catch (e) {
            console.error(`  ✗ Failed to dispatch click event:`, e);
          }
        }
        
        // Wait a bit between clicks
        await sleep(300);
        
      } catch (error) {
        console.error(`Error processing link ${i + 1}:`, error);
        // Continue with next link
      }
    }
    
    console.log(`✓ Finished clicking ${allLinks.length} "X options available" links`);
  }

  /**
   * Click "more flights available" link to load all flights
   */
  async function clickMoreFlightsLink() {
    console.log('Looking for "more flights available" link...');
    
    // Primary selector: exact match based on provided HTML
    const exactSelector = 'span.flight-count.fontSize14.pointer[data-test="component-flight-count"]';
    let moreFlightsLink = null;
    
    // Try exact selector first
    try {
      const elements = document.querySelectorAll(exactSelector);
      for (const el of elements) {
        const text = el.textContent?.trim().toLowerCase() || '';
        if (text.includes('more flights') || text.includes('more flight')) {
          moreFlightsLink = el;
          console.log('Found link with exact selector:', text);
          break;
        }
      }
    } catch (e) {
      console.error('Error with exact selector:', e);
    }
    
    // Fallback selectors if exact match not found
    if (!moreFlightsLink) {
      const fallbackSelectors = [
        'span[data-test="component-flight-count"]',
        'span.flight-count.fontSize14.pointer',
        'span.flight-count.fontSize14',
        'span.flight-count',
        'span[class*="flight-count"]'
      ];
      
      for (const selector of fallbackSelectors) {
        try {
          const elements = document.querySelectorAll(selector);
          for (const el of elements) {
            const text = el.textContent?.trim().toLowerCase() || '';
            if (text.includes('more flights') || text.includes('more flight') || 
                text.includes('load more') || text.includes('show more')) {
              moreFlightsLink = el;
              console.log('Found link with fallback selector:', selector, text);
              break;
            }
          }
          if (moreFlightsLink) break;
        } catch (e) {
          // Invalid selector, continue
        }
      }
    }
    
    // Last resort: Search all elements with "flight-count" in class
    if (!moreFlightsLink) {
      const allElements = document.querySelectorAll('[class*="flight-count"]');
      for (const el of allElements) {
        const text = el.textContent?.trim().toLowerCase() || '';
        if (text.includes('more flights') || text.includes('more flight') || 
            text.includes('load more') || text.includes('show more')) {
          moreFlightsLink = el;
          console.log('Found link by searching all flight-count elements:', text);
          break;
        }
      }
    }
    
    if (moreFlightsLink) {
      const linkText = moreFlightsLink.textContent?.trim();
      console.log('Found "more flights available" link:', linkText);
      
      // Check if it's clickable (visible and not disabled)
        if (!isElementVisible(moreFlightsLink)) {
        console.log('⚠ Link is not visible, trying to scroll to it...');
        moreFlightsLink.scrollIntoView({ behavior: 'smooth', block: 'center' });
        await sleep(1500);
        
        // Check again after scrolling
        if (!isElementVisible(moreFlightsLink)) {
          console.log('⚠ Link is still not visible after scrolling, skipping...');
          return;
        }
      }
      
      // Scroll into view to ensure it's clickable
      moreFlightsLink.scrollIntoView({ behavior: 'smooth', block: 'center' });
      await sleep(600);
      
      // Method 1: Direct click
      try {
        console.log('Attempting to click link...');
        moreFlightsLink.click();
        console.log('✓ Clicked "more flights available" link');
        await sleep(300 * sleepMultiplier); // Wait for flights to fully load
        return; // Success, exit early
      } catch (clickError) {
        console.error('Error clicking link directly:', clickError);
      }
      
      // Method 2: MouseEvent click
      try {
        const mouseEvent = new MouseEvent('click', {
          bubbles: true,
          cancelable: true,
          view: window,
          detail: 1,
          buttons: 1
        });
        moreFlightsLink.dispatchEvent(mouseEvent);
        console.log('✓ Dispatched MouseEvent click on link');
        await sleep(300 * sleepMultiplier);
        return;
      } catch (e) {
        console.error('Error dispatching MouseEvent:', e);
      }
      
      // Method 3: Try mousedown and mouseup events
      try {
        const mouseDown = new MouseEvent('mousedown', {
          bubbles: true,
          cancelable: true,
          view: window
        });
        const mouseUp = new MouseEvent('mouseup', {
          bubbles: true,
          cancelable: true,
          view: window
        });
        moreFlightsLink.dispatchEvent(mouseDown);
        await sleep(200);
        moreFlightsLink.dispatchEvent(mouseUp);
        await sleep(200);
        moreFlightsLink.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
        console.log('✓ Dispatched mousedown/mouseup/click events');
        await sleep(300 * sleepMultiplier);
      } catch (e) {
        console.error('Error with mousedown/mouseup:', e);
      }
      
      // Method 4: If it's inside a parent that's clickable, try that
      const parent = moreFlightsLink.parentElement;
      if (parent && (parent.classList.contains('pointer') || parent.onclick)) {
        try {
          parent.click();
          console.log('✓ Clicked parent element');
          await sleep(300 * sleepMultiplier);
        } catch (e) {
          console.error('Error clicking parent:', e);
        }
      }
      
    } else {
      console.log('⚠ "more flights available" link not found, continuing with extraction...');
    }
  }

  /**
   * Uncheck "Non Stop" filter checkbox to show all flights
   */
  async function uncheckNonStopFilter() {
    console.log('Looking for "Non Stop" filter checkbox...');
    
    // Find the checkbox title element with "Non Stop" text
    const nonStopTitle = Array.from(document.querySelectorAll('p.checkboxTitle'))
      .find(el => {
        const text = el.textContent?.trim().toLowerCase();
        return text.includes('non stop') || text === 'non stop';
      });
    
    if (!nonStopTitle) {
      console.log('⚠ "Non Stop" filter not found, continuing...');
      return;
    }
    
    console.log('Found "Non Stop" filter element');
    
    // Find the checkbox - based on the HTML structure:
    // label.checkboxContainer > span.commonCheckbox > input[type="checkbox"]
    // The p.checkboxTitle is inside div.checkboxContent which is inside label.checkboxContainer
    let checkbox = null;
    
    // Strategy 1: Find the label.checkboxContainer that contains the "Non Stop" text
    const labelContainer = nonStopTitle.closest('label.checkboxContainer');
    if (labelContainer) {
      // Find checkbox inside the label
      checkbox = labelContainer.querySelector('input[type="checkbox"][id="listingFilterCheckbox"]');
      if (!checkbox) {
        // Fallback: any checkbox in the label
        checkbox = labelContainer.querySelector('input[type="checkbox"]');
      }
    }
    
    // Strategy 2: Look for checkbox in parent div.checkboxContent
    if (!checkbox) {
      const checkboxContent = nonStopTitle.closest('div.checkboxContent');
      if (checkboxContent) {
        const parentLabel = checkboxContent.closest('label');
        if (parentLabel) {
          checkbox = parentLabel.querySelector('input[type="checkbox"]');
        }
      }
    }
    
    // Strategy 3: Find by looking for the specific structure
    // Find all labels with checkboxContainer class
    if (!checkbox) {
      const allLabels = document.querySelectorAll('label.checkboxContainer');
      for (const label of allLabels) {
        const checkboxTitle = label.querySelector('p.checkboxTitle');
        if (checkboxTitle) {
          const text = checkboxTitle.textContent?.trim().toLowerCase();
          if (text.includes('non stop') || text === 'non stop') {
            checkbox = label.querySelector('input[type="checkbox"]');
            if (checkbox) break;
          }
        }
      }
    }
    
    // Strategy 4: Find all checkboxes with id="listingFilterCheckbox" and check their labels
    if (!checkbox) {
      const allCheckboxes = document.querySelectorAll('input[type="checkbox"][id="listingFilterCheckbox"]');
      for (const cb of allCheckboxes) {
        const label = cb.closest('label.checkboxContainer');
        if (label) {
          const checkboxTitle = label.querySelector('p.checkboxTitle');
          if (checkboxTitle) {
            const text = checkboxTitle.textContent?.trim().toLowerCase();
            if (text.includes('non stop') || text === 'non stop') {
              checkbox = cb;
              break;
            }
          }
        }
      }
    }
    
    if (checkbox) {
      // Check if it's already unchecked
      const isChecked = checkbox.checked || checkbox.hasAttribute('checked') || checkbox.getAttribute('checked') === '';
      if (!isChecked) {
        console.log('✓ "Non Stop" filter is already unchecked');
        return;
      }
      
      console.log('Unchecking "Non Stop" filter...');
      console.log('Checkbox state before:', {
        checked: checkbox.checked,
        hasCheckedAttr: checkbox.hasAttribute('checked'),
        checkedAttr: checkbox.getAttribute('checked')
      });
      
      // Find the label container
      const label = checkbox.closest('label.checkboxContainer');
      
      // Method 1: Click the label (this is the most reliable way for custom checkboxes)
      if (label) {
        console.log('Attempting to click label to uncheck...');
        try {
          // Scroll label into view
          label.scrollIntoView({ behavior: 'smooth', block: 'center' });
          await sleep(300);
          
          // Click the label
          label.click();
          await sleep(100 * sleepMultiplier);
          
          // Check if it worked
          if (!checkbox.checked && !checkbox.hasAttribute('checked')) {
            console.log('✓ Successfully unchecked via label click');
            await sleep(200 * sleepMultiplier);
            return;
          }
        } catch (e) {
          console.error('Error clicking label:', e);
        }
      }
      
      // Method 2: Direct checkbox manipulation
      console.log('Attempting direct checkbox manipulation...');
      checkbox.checked = false;
      checkbox.removeAttribute('checked');
      checkbox.setAttribute('checked', 'false');
      
      // Method 3: Trigger all possible events
      const events = ['change', 'input', 'click', 'focus', 'blur'];
      for (const eventType of events) {
        try {
          const event = new Event(eventType, { bubbles: true, cancelable: true });
          checkbox.dispatchEvent(event);
        } catch (e) {
          // Ignore errors
        }
      }
      
      // Method 4: MouseEvent click
      try {
        const mouseClick = new MouseEvent('click', {
          bubbles: true,
          cancelable: true,
          view: window,
          detail: 1,
          buttons: 1
        });
        checkbox.dispatchEvent(mouseClick);
      } catch (e) {
        console.error('Error dispatching mouse click:', e);
      }
      
      // Method 5: Try clicking the span wrapper
      const spanWrapper = checkbox.closest('span.commonCheckbox');
      if (spanWrapper) {
        try {
          spanWrapper.click();
          await sleep(300);
        } catch (e) {
          console.error('Error clicking span wrapper:', e);
        }
      }
      
      // Method 6: Try clicking the checkbox directly
      try {
        checkbox.click();
        await sleep(300);
      } catch (e) {
        console.error('Error clicking checkbox directly:', e);
      }
      
      // Verify the final state
      const finalChecked = checkbox.checked || checkbox.hasAttribute('checked') || checkbox.getAttribute('checked') === '';
      console.log('Checkbox state after:', {
        checked: checkbox.checked,
        hasCheckedAttr: checkbox.hasAttribute('checked'),
        checkedAttr: checkbox.getAttribute('checked'),
        finalChecked: finalChecked
      });
      
      if (!finalChecked) {
        console.log('✓ Successfully unchecked "Non Stop" filter');
      } else {
        console.log('⚠ Warning: Checkbox may still be checked. Trying one more time...');
        // One more attempt - click label if available
        if (label) {
          label.click();
          await sleep(100 * sleepMultiplier);
        }
      }
      
      // Wait for page to update
      await sleep(1500);
    } else {
      console.log('⚠ Could not find checkbox associated with "Non Stop" filter');
    }
  }

  /**
   * Detect trip type from the UI element
   * Returns 'round_trip' or 'one_way'
   */
  function detectTripTypeFromUI() {
    console.log('Detecting trip type from UI...');
    
    // Find the trip type wrapper
    const tripTypeWrapper = document.querySelector('div[data-test="component-tripType-wrapper"], div.tripTypeWrapper');
    
    if (!tripTypeWrapper) {
      console.log('⚠ Trip type wrapper not found, falling back to DOM structure check');
      return checkIfRoundTrip() ? 'round_trip' : 'one_way';
    }
    
    // Find the dropdown value element
    const dropdownVal = tripTypeWrapper.querySelector('div.multiDropDownVal');
    
    if (!dropdownVal) {
      console.log('⚠ Trip type dropdown value not found, falling back to DOM structure check');
      return checkIfRoundTrip() ? 'round_trip' : 'one_way';
    }
    
    const tripTypeText = dropdownVal.textContent?.trim().toLowerCase() || '';
    console.log(`Trip type text found: "${tripTypeText}"`);
    
    // Check for round trip indicators
    if (tripTypeText.includes('round') || tripTypeText.includes('return')) {
      console.log('✓ Detected: Round Trip');
      return 'round_trip';
    }
    
    // Check for one-way indicators
    if (tripTypeText.includes('one') || tripTypeText.includes('one-way') || tripTypeText.includes('one way')) {
      console.log('✓ Detected: One Way');
      return 'one_way';
    }
    
    // Fallback: check DOM structure
    console.log('⚠ Could not determine from text, falling back to DOM structure check');
    return checkIfRoundTrip() ? 'round_trip' : 'one_way';
  }

  /**
   * Generate a unique key for a flight to identify duplicates
   * Uses flight code, airline, times, and route information
   */
  function generateFlightKey(flight) {
    // Use flight code if available (most unique)
    if (flight.flight_code) {
      const key = `${flight.flight_code}_${flight.departure_time || ''}_${flight.arrival_time || ''}`;
      if (flight.direction) {
        return `${flight.direction}_${key}`;
      }
      return key;
    }
    
    // Fallback: use airline code + times
    if (flight.airline_code) {
      const key = `${flight.airline_code}_${flight.departure_time || ''}_${flight.arrival_time || ''}_${flight.departure_city || ''}_${flight.arrival_city || ''}`;
      if (flight.direction) {
        return `${flight.direction}_${key}`;
      }
      return key;
    }
    
    // Last resort: use airline name + times + cities
    const airline = (flight.airline || '').substring(0, 20).replace(/\s+/g, '_');
    const key = `${airline}_${flight.departure_time || ''}_${flight.arrival_time || ''}_${flight.departure_city || ''}_${flight.arrival_city || ''}_${flight.date || ''}`;
    if (flight.direction) {
      return `${flight.direction}_${key}`;
    }
    return key;
  }

  /**
   * Check if a flight is a duplicate based on its unique key
   */
  function isDuplicateFlight(flight, seenFlights) {
    if (!flight) return true;
    const key = generateFlightKey(flight);
    if (seenFlights.has(key)) {
      console.log(`⚠ Duplicate flight detected: ${key}`);
      return true;
    }
    seenFlights.add(key);
    return false;
  }

  /**
   * Validate DOMESTIC trip page structure before extraction
   * Returns {valid: boolean, error: string|null, elements: object}
   */
  function validateDomesticTripStructure(tripType) {
    const isRoundTrip = tripType === 'round_trip';
    
    if (isRoundTrip) {
      // For round trip: must have splitVw structure
      const splitView = document.querySelector('div.splitVw, div[class*="splitVw"]');
      if (!splitView) {
        return {
          valid: false,
          error: 'DOMESTIC round trip structure not found. Required element: div.splitVw',
          elements: { splitView: null }
        };
      }
      
      // Check for panes within splitView
      const panes = splitView.querySelectorAll('div.paneView, div[class*="paneView"]');
      if (panes.length === 0) {
        return {
          valid: false,
          error: 'No panes found in splitVw. Required: div.paneView elements',
          elements: { splitView: splitView, panes: [] }
        };
      }
      
      // Check for at least some cards in panes
      let totalCards = 0;
      for (const pane of panes) {
        const cards = pane.querySelectorAll('div.listingCard, label.splitViewListing, div[class*="listingCard"]');
        totalCards += cards.length;
      }
      
      if (totalCards === 0) {
        return {
          valid: false,
          error: 'No flight cards found in panes. Please wait for page to load completely.',
          elements: { splitView: splitView, panes: panes, cards: 0 }
        };
      }
      
      return {
        valid: true,
        error: null,
        elements: { splitView: splitView, panes: panes, cards: totalCards }
      };
    } else {
      // For one-way: Check URL parameter first (most reliable)
      // clusterContent can appear in both domestic and international, so we check URL param
      const urlParams = new URLSearchParams(window.location.search);
      const intlParam = urlParams.get('intl');
      
      // If URL says it's international, reject it
      if (intlParam === 'true') {
        return {
          valid: false,
          error: 'URL indicates international trip (intl=true). Use "Extract International Flights" button.',
          elements: {}
        };
      }
      
      // If intl=false or not set, treat as domestic even if clusterContent exists
      // clusterContent alone is not a reliable indicator for international trips
      const clusterContent = document.querySelector('div.clusterContent, div[class*="clusterContent"]');
      if (clusterContent && intlParam !== 'false') {
        // Only warn, don't reject - we'll rely on URL param
        console.log('⚠ clusterContent found, but URL indicates domestic (intl=false or not set) - proceeding');
      }
      
      // Check for regular flight cards
      const cards = document.querySelectorAll('div.listingCard, div[class*="listingCard"]');
      if (cards.length === 0) {
        return {
          valid: false,
          error: 'No flight cards found. Required: div.listingCard elements. Please wait for page to load completely.',
          elements: { cards: [] }
        };
      }
      
      return {
        valid: true,
        error: null,
        elements: { cards: cards }
      };
    }
  }

  /**
   * Validate INTERNATIONAL trip page structure before extraction
   * Returns {valid: boolean, error: string|null, elements: object}
   */
  function validateInternationalTripStructure() {
    // Must have clusterContent structure
    const clusterContent = document.querySelector('div.clusterContent, div[class*="clusterContent"]');
    if (!clusterContent) {
      return {
        valid: false,
        error: 'INTERNATIONAL trip structure not found. Required element: div.clusterContent',
        elements: { clusterContent: null }
      };
    }
    
    // Check for cards within clusterContent
    const cards = clusterContent.querySelectorAll('div.listingCard.appendBottom5, div.listingCard, div[class*="listingCard"]');
    if (cards.length === 0) {
      return {
        valid: false,
        error: 'No flight cards found in clusterContent. Required: div.listingCard elements. Please wait for page to load completely.',
        elements: { clusterContent: clusterContent, cards: [] }
      };
    }
    
    return {
      valid: true,
      error: null,
      elements: { clusterContent: clusterContent, cards: cards }
    };
  }

  /**
   * Extract flights sequentially: card details → click VIEW PRICES → wait → extract popup → next
   */
  async function extractFlightsSequentially(tripType = null) {
    const startTime = Date.now(); // Track start time
    const flights = [];
    const seenFlights = new Set(); // Track unique flights to avoid duplicates
    const maxFlights = 200; // Performance limit
    
    try {
      // Determine trip type if not provided
      if (!tripType) {
        tripType = detectTripTypeFromUI();
      }
      
      console.log(`Starting extraction for: ${tripType} (DOMESTIC - One-way or Round Trip only)`);
      
      // VALIDATION: Check if required elements exist before proceeding
      console.log('Validating DOMESTIC trip page structure...');
      const validation = validateDomesticTripStructure(tripType);
      
      if (!validation.valid) {
        const errorMsg = `Validation failed: ${validation.error}`;
        console.error(`✗ ${errorMsg}`);
        const executionTimeMs = Date.now() - startTime;
        const executionTimeSeconds = (executionTimeMs / 1000).toFixed(2);
        return {
          metadata: {
            scraped_at: new Date().toISOString(),
            source_url: window.location.href,
            flights_count: 0,
            user_agent: navigator.userAgent,
            trip_type: tripType || 'domestic',
            execution_time_ms: executionTimeMs,
            execution_time_seconds: parseFloat(executionTimeSeconds),
            execution_time_formatted: `${executionTimeSeconds}s`
          },
          flights: [],
          error: errorMsg
        };
      }
      
      console.log(`✓ Validation passed. Found required elements.`);
      if (validation.elements.splitView) {
        console.log(`  - splitView: ✓ (${validation.elements.panes?.length || 0} panes, ${validation.elements.cards || 0} cards)`);
      } else if (validation.elements.cards) {
        console.log(`  - Flight cards: ✓ (${validation.elements.cards.length} cards found)`);
      }
      
      // Check if this is a round trip (domestic only - uses splitVw structure)
      const isRoundTrip = tripType === 'round_trip';
      
      if (isRoundTrip) {
        // Handle DOMESTIC round trip only: extract from both panes (splitVw structure)
        return await extractRoundTripFlights(startTime, maxFlights);
      }
      
      // ONE-WAY TRIP PROCESSING
      console.log('Processing DOMESTIC one-way trip...');
      
      // STEP 1: Uncheck "Non Stop" filter (already done globally, but ensure it's done)
      console.log('Ensuring "Non Stop" filter is unchecked...');
      await uncheckNonStopFilter();
      await sleep(1500);
      
      // STEP 2: Click all "options available" links to expand group cards
      console.log('Clicking all "options available" links...');
      await clickAllOptionsAvailableLinks();
      await sleep(2500);
      
      // STEP 3: Click "more flights available" link
      console.log('Clicking "more flights available" link...');
      await clickMoreFlightsLink();
      await sleep(2500);
      
      // VALIDATION: Check if flight cards exist
      console.log('Validating flight cards exist...');
      let flightCards = findFlightCards();
      
      if (flightCards.length === 0) {
        console.warn('No flight cards found with primary selectors, trying fallback...');
        flightCards = findFlightCardsFallback();
      }

      if (flightCards.length === 0) {
        const errorMsg = 'No flight cards found. Please wait for page to load completely or check if you are on a flight listing page.';
        console.error(`✗ ${errorMsg}`);
        const executionTimeMs = Date.now() - startTime;
        const executionTimeSeconds = (executionTimeMs / 1000).toFixed(2);
        return {
          metadata: {
            scraped_at: new Date().toISOString(),
            source_url: window.location.href,
            flights_count: 0,
            user_agent: navigator.userAgent,
            trip_type: 'one_way',
            execution_time_ms: executionTimeMs,
            execution_time_seconds: parseFloat(executionTimeSeconds),
            execution_time_formatted: `${executionTimeSeconds}s`
          },
          flights: [],
          error: errorMsg
        };
      }

      console.log(`✓ Validation passed. Found ${flightCards.length} flight cards`);

      // Limit to visible elements and max count
      // Filter out empty or invalid cards first
      const validCards = Array.from(flightCards).filter(card => {
        if (!isElementVisible(card)) return false;
        // Check if card has meaningful content
        const text = card.textContent || '';
        // Should have at least time pattern or price
        const hasTime = /\b([0-1]?[0-9]|2[0-3]):[0-5][0-9]\b/.test(text);
        const hasPrice = /₹|Rs|INR/.test(text);
        return hasTime || hasPrice;
      });
      
      const visibleCards = validCards.slice(0, maxFlights);

      console.log(`Processing ${visibleCards.length} cards sequentially...`);

      // Process each card one by one
      for (let index = 0; index < visibleCards.length; index++) {
        const card = visibleCards[index];
        console.log(`\n=== Processing card ${index + 1}/${visibleCards.length} ===`);

        try {
          // STEP 1: Extract basic card details FIRST (before clicking anything)
          console.log(`Step 1: Extracting basic card details for card ${index + 1}...`);
          console.log(`Card element:`, card);
          console.log(`Card classes:`, card.className);
          console.log(`Card HTML snippet:`, card.outerHTML.substring(0, 500));
          
          const flight = extractFlightFromCard(card, index);
          
          // Ensure index is set correctly
          flight.index = index;
          
          // Log what was extracted for debugging
          console.log(`Extracted data for card ${index + 1}:`, {
            airline: flight.airline,
            departure_time: flight.departure_time,
            arrival_time: flight.arrival_time,
            price: flight.price
          });
          
          if (!flight || !isValidFlight(flight)) {
            console.log(`⚠ Skipping card ${index + 1} - invalid flight data`);
            continue;
          }
          
          // Check for duplicates before processing
          if (isDuplicateFlight(flight, seenFlights)) {
            console.log(`⚠ Skipping card ${index + 1} - duplicate flight detected`);
            continue;
          }
          
          // console.log(`✓ Extracted basic details: ${flight.airline || 'N/A'} - ${flight.departure_time || 'N/A'} to ${flight.arrival_time || 'N/A'}`); // COMMENTED FOR PERFORMANCE
          
          // Minimal wait after extracting card details
          await sleep(200 * sleepMultiplier);
          
          // STEP 2: Find VIEW PRICES button for this specific card
          // console.log(`Step 2: Looking for VIEW PRICES button for card ${index + 1}...`); // COMMENTED FOR PERFORMANCE
          const viewPricesButton = findViewPricesButtonForCard(card);
          
          if (viewPricesButton && isElementVisible(viewPricesButton) && !viewPricesButton.disabled) {
            // Scroll card into view before clicking
            // console.log(`Step 3: Scrolling card ${index + 1} into view...`); // COMMENTED FOR PERFORMANCE
            card.scrollIntoView({ behavior: 'smooth', block: 'center' });
            
            // Wait for scroll to complete (reduced)
            await sleep(300 * sleepMultiplier);
            
            // STEP 4: Click VIEW PRICES button
            // console.log(`Step 4: Clicking VIEW PRICES button for card ${index + 1}...`); // COMMENTED FOR PERFORMANCE
            try {
              viewPricesButton.click();
              // console.log(`✓ Clicked VIEW PRICES button for card ${index + 1}`); // COMMENTED FOR PERFORMANCE
              
              // Minimal wait for click to register
              await sleep(200 * sleepMultiplier);
            } catch (clickError) {
              // console.error(`✗ Error clicking button for card ${index + 1}:`, clickError); // COMMENTED FOR PERFORMANCE
              // Continue anyway, might still work
              await sleep(200 * sleepMultiplier);
            }
            
            // STEP 5: Wait for popup to appear and fully load (RESPONSIVE - waits for actual UI)
            // console.log(`Step 5: Waiting for popup to load for card ${index + 1}...`); // COMMENTED FOR PERFORMANCE
            
            // Wait for popup element to appear (responsive - waits for actual DOM element)
            const popupElement = await waitForElement('div#ffWrapper, div.ffWrapper, div.wdth100, div.journeyContent', 5000 * sleepMultiplier);
            
            if (popupElement && isElementVisible(popupElement)) {
              // console.log(`✓ Popup is visible for card ${index + 1}`); // COMMENTED FOR PERFORMANCE
              
              // Wait for popup content to fully load (responsive - waits for loading to complete)
              // console.log(`Step 5b: Waiting for popup content to fully load...`); // COMMENTED FOR PERFORMANCE
              await waitForLoadingToComplete(4000 * sleepMultiplier);
              
              // Wait for popup to be fully interactive (responsive - check for interactive elements)
              const hasContent = await waitForElement('div.fareFamilyCardWrapper, div.keen-slider, button, a', 2000, popupElement);
              if (!hasContent) {
                // Small wait if no content found yet
                await sleep(200);
              }
            } else {
              // console.log(`⚠ Popup may not be fully loaded for card ${index + 1}, continuing anyway...`); // COMMENTED FOR PERFORMANCE
              // Small wait
              await sleep(300);
            }
            
            // STEP 6: Extract detailed fare information from popup
            // console.log(`Step 6: Extracting detailed fare information from popup for card ${index + 1}...`); // COMMENTED FOR PERFORMANCE
            const fareDetails = await extractFareDetailsFromPopup(card);
            if (fareDetails) {
              flight.fare_options = fareDetails;
              const totalFares = fareDetails.fare_classes?.reduce((sum, fc) => sum + (fc.fares?.length || 0), 0) || 0;
              // console.log(`✓ Extracted fare details for card ${index + 1} (${fareDetails.fare_classes?.length || 0} fare classes, ${totalFares} total fare options)`); // COMMENTED FOR PERFORMANCE
            } else {
              // console.log(`⚠ No fare details found for card ${index + 1}`); // COMMENTED FOR PERFORMANCE
            }
            
            // STEP 7: Close popup after extraction is complete
            // console.log(`Step 7: Closing popup for card ${index + 1}...`); // COMMENTED FOR PERFORMANCE
            const popupClosed = await closePopupIfOpen();
            // if (popupClosed) {
            //   console.log(`✓ Popup closed for card ${index + 1}`); // COMMENTED FOR PERFORMANCE
            // } else {
            //   console.log(`⚠ Popup may not have closed for card ${index + 1}`); // COMMENTED FOR PERFORMANCE
            // }
            
            // Wait for popup to fully close - use event-driven wait
            // Wait for popup to disappear
            let popupStillVisible = true;
            const startTime = Date.now();
            while (popupStillVisible && (Date.now() - startTime < 2000)) {
              popupStillVisible = checkIfPopupVisible();
              if (!popupStillVisible) break;
              await sleep(100);
            }
            
            if (popupStillVisible) {
              // console.log(`⚠ Popup still visible, waiting longer...`); // COMMENTED FOR PERFORMANCE
              await sleep(500 * sleepMultiplier);
              // Try closing again
              await closePopupIfOpen();
              await sleep(300 * sleepMultiplier);
            }
            
            // Wait for DOM to stabilize after popup closes (reduced)
            // console.log(`Step 7a: Waiting for DOM to stabilize after popup close for card ${index + 1}...`); // COMMENTED FOR PERFORMANCE
            await sleep(300 * sleepMultiplier);
            
            // Additional minimal wait
            await sleep(200 * sleepMultiplier);
            
            // console.log(`✓ View Prices operation completed for card ${index + 1}, ready for Flight Details`); // COMMENTED FOR PERFORMANCE
          } else {
            // console.log(`⚠ No VIEW PRICES button found for card ${index + 1}, skipping popup extraction`); // COMMENTED FOR PERFORMANCE
            // Minimal wait to ensure card is ready for Flight Details
            await sleep(200 * sleepMultiplier);
          }

          // STEP 8: Extract Flight Details (View Flight Details → Extract → Hide)
          // Minimal wait before starting Flight Details
          // console.log(`\n--- Starting Flight Details extraction for card ${index + 1} ---`); // COMMENTED FOR PERFORMANCE
          await sleep(200 * sleepMultiplier);
          
          // Ensure card is visible and ready (minimal wait)
          await sleep(100 * sleepMultiplier);
          // console.log(`Step 8: Extracting flight details for card ${index + 1}...`); // COMMENTED FOR PERFORMANCE
          const viewFlightDetailsLink = findViewFlightDetailsLinkForCard(card);
          
          if (viewFlightDetailsLink && isElementVisible(viewFlightDetailsLink)) {
            try {
              // Scroll card into view if needed
              // console.log(`Step 8a: Scrolling card ${index + 1} into view...`); // COMMENTED FOR PERFORMANCE
              card.scrollIntoView({ behavior: 'smooth', block: 'center' });
              await sleep(300 * sleepMultiplier);
              
              // Minimal wait before clicking
              await sleep(100 * sleepMultiplier);
              
              // Click "View Flight Details"
              // console.log(`Step 8b: Clicking "View Flight Details" for card ${index + 1}...`); // COMMENTED FOR PERFORMANCE
              viewFlightDetailsLink.click();
              // console.log(`✓ Clicked "View Flight Details" for card ${index + 1}`); // COMMENTED FOR PERFORMANCE
              
              // Minimal wait for click to register
              await sleep(200 * sleepMultiplier);
              
              // Wait for flightDetailsOuter to appear (responsive - waits for actual element)
              // console.log(`Step 8c: Waiting for flight details panel to appear for card ${index + 1}...`); // COMMENTED FOR PERFORMANCE
              const flightDetailsOuter = await waitForFlightDetailsOuter(8000);
              
              if (flightDetailsOuter) {
                // console.log(`✓ Flight details panel is visible for card ${index + 1}`); // COMMENTED FOR PERFORMANCE
                
                // Wait for loading to complete (responsive)
                // console.log(`Step 8d: Waiting for loading to complete for card ${index + 1}...`); // COMMENTED FOR PERFORMANCE
                await waitForLoadingToComplete(5000 * sleepMultiplier);
                
                // Minimal wait for content to render
                await sleep(500 * sleepMultiplier);
                
                // Extract all details from all tabs
                // console.log(`Step 8e: Extracting all flight details from tabs for card ${index + 1}...`); // COMMENTED FOR PERFORMANCE
                const detailedFlightInfo = await extractDetailedFlightInfoFromAllTabs();
                
                if (detailedFlightInfo) {
                  flight.flight_details = detailedFlightInfo;
                  // console.log(`✓ Extracted flight details for card ${index + 1}:`, { // COMMENTED FOR PERFORMANCE
                  //   segments: detailedFlightInfo.detailed_flights?.length || 0,
                  //   has_fare_summary: !!detailedFlightInfo.fare_summary,
                  //   has_cancellation: !!detailedFlightInfo.cancellation_policy,
                  //   has_date_change: !!detailedFlightInfo.date_change_policy
                  // });
                } else {
                  // console.log(`⚠ No flight details extracted for card ${index + 1}`); // COMMENTED FOR PERFORMANCE
                }
                
                // Click "Hide Flight Details" to close
                // console.log(`Step 8f: Closing flight details for card ${index + 1}...`); // COMMENTED FOR PERFORMANCE
                await sleep(200 * sleepMultiplier);
                
                const hideFlightDetailsLink = findHideFlightDetailsLink();
                if (hideFlightDetailsLink && isElementVisible(hideFlightDetailsLink)) {
                  hideFlightDetailsLink.click();
                  // console.log(`✓ Clicked "Hide Flight Details" for card ${index + 1}`); // COMMENTED FOR PERFORMANCE
                  
                  // Minimal wait for click to register
                  await sleep(200 * sleepMultiplier);
                  
                  // Wait for panel to close (reduced)
                  await sleep(300 * sleepMultiplier);
                  
                  // Verify panel is closed
                  const stillOpen = document.querySelector('div.flightDetailsOuter');
                  if (stillOpen && isElementVisible(stillOpen)) {
                    // console.log(`⚠ Panel still open, waiting longer...`); // COMMENTED FOR PERFORMANCE
                    await sleep(300 * sleepMultiplier);
                  }
                } else {
                  // console.log(`⚠ "Hide Flight Details" link not found for card ${index + 1}, trying alternative close method...`); // COMMENTED FOR PERFORMANCE
                  // Try to find and click any close button or escape key
                  const closeButton = flightDetailsOuter.querySelector('button[aria-label*="close"], button[aria-label*="Close"], .close, [class*="close"]');
                  if (closeButton) {
                    closeButton.click();
                    await sleep(200 * sleepMultiplier);
                    await sleep(300 * sleepMultiplier); // Wait for panel to close
                  }
                }
              } else {
                console.log(`⚠ Flight details panel did not appear for card ${index + 1}`);
              }
            } catch (error) {
              console.error(`✗ Error extracting flight details for card ${index + 1}:`, error);
              // Try to close if still open
              try {
                await sleep(100 * sleepMultiplier);
                const hideLink = findHideFlightDetailsLink();
                if (hideLink) {
                  hideLink.click();
                  await sleep(200 * sleepMultiplier);
                }
              } catch (e) {
                // Ignore close errors
              }
            }
          } else {
            console.log(`⚠ No "View Flight Details" link found for card ${index + 1}, skipping flight details extraction`);
          }

          // Add flight to results (already checked for duplicates above)
          flights.push(flight);
          console.log(`✓ Completed processing card ${index + 1}/${visibleCards.length}`);
          
          // Wait before moving to next card to ensure DOM is stable and all operations are complete
          await sleep(200 * sleepMultiplier);
          
        } catch (error) {
          console.error(`✗ Error processing card ${index + 1}:`, error);
          // Continue with next card even if this one fails
        }
      }

      console.log(`Completed extraction of ${flights.length} flights`);

    } catch (error) {
      console.error('Error in extractFlightsSequentially:', error);
    }

    // Calculate execution time
    const endTime = Date.now();
    const executionTimeMs = endTime - startTime;
    const executionTimeSeconds = (executionTimeMs / 1000).toFixed(2);
    const executionTimeMinutes = Math.floor(executionTimeMs / 60000);
    const executionTimeSecondsRemainder = ((executionTimeMs % 60000) / 1000).toFixed(2);
    
    // Format execution time string
    let executionTimeFormatted;
    if (executionTimeMinutes > 0) {
      executionTimeFormatted = `${executionTimeMinutes}m ${executionTimeSecondsRemainder}s`;
    } else {
      executionTimeFormatted = `${executionTimeSeconds}s`;
    }
    
        console.log(`Total execution time: ${executionTimeFormatted} (${executionTimeMs}ms)`);

        return {
          metadata: {
            scraped_at: new Date().toISOString(),
            source_url: window.location.href,
            flights_count: flights.length,
            user_agent: navigator.userAgent,
            trip_type: 'one_way',
            execution_time_ms: executionTimeMs,
            execution_time_seconds: parseFloat(executionTimeSeconds),
            execution_time_formatted: executionTimeFormatted
          },
          flights: flights
        };
  }

  /**
   * Find VIEW PRICES button for a specific card
   */
  function findViewPricesButtonForCard(card) {
    // Look for button within the card
    const button = card.querySelector('button.ViewFareBtn');
    if (button) {
      const hasViewPrices = button.querySelector('span[data-test="component-buttonText"]');
      if (hasViewPrices) {
        return button;
      }
    }
    
    // Fallback: look for button near the card (might be in a sibling element)
    const cardParent = card.parentElement;
    if (cardParent) {
      const nearbyButton = cardParent.querySelector('button.ViewFareBtn');
      if (nearbyButton) {
        const hasViewPrices = nearbyButton.querySelector('span[data-test="component-buttonText"]');
        if (hasViewPrices) {
          return nearbyButton;
        }
      }
    }
    
    return null;
  }

  /**
   * Find "View Flight Details" link for a specific card
   */
  function findViewFlightDetailsLinkForCard(card) {
    // Look for span with class "linkText ctaLink viewFltDtlsCta" containing "View Flight Details"
    const link = card.querySelector('span.linkText.ctaLink.viewFltDtlsCta');
    if (link) {
      const text = link.textContent?.trim() || '';
      if (text.includes('View Flight Details')) {
        return link;
      }
    }
    
    // Fallback: look for any span with "View Flight Details" text within the card
    const allSpans = card.querySelectorAll('span');
    for (const span of allSpans) {
      const text = span.textContent?.trim() || '';
      if (text === 'View Flight Details' || text.includes('View Flight Details')) {
        // Check if it has the expected classes
        if (span.classList.contains('linkText') && span.classList.contains('ctaLink')) {
          return span;
        }
      }
    }
    
    // Fallback: look near the card (might be in a sibling element)
    const cardParent = card.parentElement;
    if (cardParent) {
      const nearbyLink = cardParent.querySelector('span.linkText.ctaLink.viewFltDtlsCta');
      if (nearbyLink) {
        const text = nearbyLink.textContent?.trim() || '';
        if (text.includes('View Flight Details')) {
          return nearbyLink;
        }
      }
    }
    
    return null;
  }

  /**
   * Find "Hide Flight Details" link
   */
  function findHideFlightDetailsLink() {
    // Look for span with class "linkText ctaLink viewFltDtlsCta" containing "Hide Flight Details"
    const link = document.querySelector('span.linkText.ctaLink.viewFltDtlsCta');
    if (link) {
      const text = link.textContent?.trim() || '';
      if (text.includes('Hide Flight Details')) {
        return link;
      }
    }
    
    // Fallback: look for any span with "Hide Flight Details" text
    const allSpans = document.querySelectorAll('span.linkText.ctaLink.viewFltDtlsCta');
    for (const span of allSpans) {
      const text = span.textContent?.trim() || '';
      if (text === 'Hide Flight Details' || text.includes('Hide Flight Details')) {
        return span;
      }
    }
    
    return null;
  }

  /**
   * Wait for flightDetailsOuter to appear and be visible
   */
  async function waitForFlightDetailsOuter(maxWaitMs = 8000) {
    const startTime = Date.now();
    while (Date.now() - startTime < maxWaitMs) {
      const flightDetailsOuter = document.querySelector('div.flightDetailsOuter');
      if (flightDetailsOuter && isElementVisible(flightDetailsOuter)) {
        // Wait a bit more to ensure content is loaded
        await sleep(100 * sleepMultiplier);
        return flightDetailsOuter;
      }
      await sleep(200);
    }
    return null;
  }

  /**
   * Wait for loading indicators to disappear (optimized with MutationObserver)
   */
  async function waitForLoadingToComplete(maxWaitMs = 5000) {
    const loadingSelectors = '.loading, .spinner, [class*="loading"], [class*="spinner"], [class*="Loader"], .Loader';
    
    // Quick check first
    const loadingIndicators = document.querySelectorAll(loadingSelectors);
    let isLoading = false;
    for (const indicator of loadingIndicators) {
      if (isElementVisible(indicator)) {
        isLoading = true;
        break;
      }
    }
    
    if (!isLoading) {
      // Small delay to ensure content is fully rendered
      await sleep(100);
      return true;
    }

    // Use MutationObserver for faster detection
    return new Promise((resolve) => {
      const startTime = Date.now();
      let timeoutId = null;
      let observer = null;
      let checkInterval = null;

      const cleanup = () => {
        if (observer) observer.disconnect();
        if (timeoutId) clearTimeout(timeoutId);
        if (checkInterval) clearInterval(checkInterval);
      };

      const checkLoading = () => {
        const indicators = document.querySelectorAll(loadingSelectors);
        let hasLoading = false;
        
        for (const indicator of indicators) {
          if (isElementVisible(indicator)) {
            hasLoading = true;
            break;
          }
        }
        
        if (!hasLoading) {
          cleanup();
          // Small delay to ensure content is fully rendered
          setTimeout(() => resolve(true), 100);
          return true;
        }
        return false;
      };

      timeoutId = setTimeout(() => {
        cleanup();
        resolve(false);
      }, maxWaitMs);

      // Use MutationObserver to watch for DOM changes
      observer = new MutationObserver(() => {
        checkLoading();
      });

      observer.observe(document.body, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['class', 'style']
      });

      // Also poll occasionally as fallback (less frequent)
      checkInterval = setInterval(() => {
        if (checkLoading()) return;
        if (Date.now() - startTime > maxWaitMs) {
          cleanup();
          resolve(false);
        }
      }, 200);
    });
  }

  /**
   * Wait for tab content to be ready
   */
  async function waitForTabContentReady(tabPane, maxWaitMs = 3000) {
    const startTime = Date.now();
    while (Date.now() - startTime < maxWaitMs) {
      // Check if tab pane is active and visible
      if (tabPane && tabPane.classList.contains('active') && tabPane.classList.contains('show')) {
        // Check if content exists
        const content = tabPane.querySelector('div.flightDetails, div.flightDetailsInfo, div[id*="tabpane"]');
        if (content && content.children.length > 0) {
          await sleep(200); // Small additional wait
          return true;
        }
      }
      await sleep(200);
    }
    return false;
  }

  /**
   * Extract fare details from popup associated with a card
   */
  async function extractFareDetailsFromPopup(card) {
    // Find visible popup that matches this card's route
    const cardRoute = extractRouteFromCard(card);
    
    // For one-way trips, look for ffWrapper popup first
    const ffWrapper = document.querySelector('div#ffWrapper, div.ffWrapper');
    if (ffWrapper && isElementVisible(ffWrapper)) {
      console.log('Found ffWrapper popup (one-way trip)');
      return await extractFareOptionsFromFfWrapper(ffWrapper);
    }
    
    // For round trips or other popups, use existing logic
    const allPopups = document.querySelectorAll('div.wdth100, div.journeyContent');
    
    // Try to find popup that matches the card's route
    for (const popup of allPopups) {
      if (!isElementVisible(popup)) continue;
      
      const popupRoute = extractRouteFromPopup(popup);
      if (cardRoute && popupRoute && 
          (cardRoute.departure === popupRoute.departure || 
           cardRoute.arrival === popupRoute.arrival)) {
        return extractFareOptionsFromPopup(popup);
      }
    }
    
    // Fallback: if only one popup is visible, use it
    const visiblePopups = Array.from(allPopups).filter(p => isElementVisible(p));
    if (visiblePopups.length === 1) {
      return extractFareOptionsFromPopup(visiblePopups[0]);
    }
    
    // If multiple popups, find the one closest to this card
    if (visiblePopups.length > 0) {
      const cardRect = card.getBoundingClientRect();
      let closestPopup = null;
      let minDistance = Infinity;
      
      visiblePopups.forEach(popup => {
        const popupRect = popup.getBoundingClientRect();
        const distance = Math.abs(cardRect.top - popupRect.top);
        if (distance < minDistance) {
          minDistance = distance;
          closestPopup = popup;
        }
      });
      
      if (closestPopup) {
        return extractFareOptionsFromPopup(closestPopup);
      }
    }
    
    return null;
  }

  /**
   * Extract fare options from ffWrapper popup (one-way trips)
   * Handles keen-slider with multiple fare cards
   */
  async function extractFareOptionsFromFfWrapper(ffWrapper) {
    const result = {
      route: null,
      airline_info: null,
      date_time: null,
      fare_classes: []
    };
    
    // Extract route information from header
    const routeEl = ffWrapper.querySelector('span.boldFont.fontSize16');
    if (routeEl) {
      result.route = routeEl.textContent?.trim();
    }
    
    // Extract airline and date/time info
    const airlineInfoEl = ffWrapper.querySelector('span.mediumBoldFont');
    if (airlineInfoEl) {
      result.airline_info = airlineInfoEl.textContent?.trim();
    }
    
    // Extract all fare cards from keen-slider
    // First, try to click "More fares available" button if present to load all cards
    const moreFaresBtn = ffWrapper.querySelector('button.keen-next-button, button[class*="keen-next"]');
    if (moreFaresBtn && !moreFaresBtn.disabled && isElementVisible(moreFaresBtn)) {
      console.log('Found "More fares available" button, clicking to load all fare cards...');
      try {
        moreFaresBtn.scrollIntoView({ behavior: 'smooth', block: 'center' });
        await sleep(400);
        moreFaresBtn.click();
        await sleep(1500); // Wait for more cards to fully load
      } catch (e) {
        console.error('Error clicking more fares button:', e);
      }
    }
    
    const keenSlider = ffWrapper.querySelector('div.keen-slider');
    const fareCards = keenSlider ? 
      keenSlider.querySelectorAll('div.fareFamilyCardWrapper, div.keen-slider__slide.fareFamilyCardWrapper') :
      ffWrapper.querySelectorAll('div.fareFamilyCardWrapper, div.keen-slider__slide.fareFamilyCardWrapper');
    
    const fares = [];
    const seenFares = new Set();
    
    console.log(`Found ${fareCards.length} fare cards in popup`);
    
    for (const fareCard of fareCards) {
      if (isElementVisible(fareCard)) {
        const fare = extractFareCardDetails(fareCard);
        if (fare) {
          // Generate unique key for fare
          const fareKey = `${fare.fare_name || 'unknown'}_${fare.price || ''}_${fare.original_price || ''}`;
          if (!seenFares.has(fareKey)) {
            seenFares.add(fareKey);
            fares.push(fare);
          } else {
            console.log(`⚠ Duplicate fare card detected: ${fareKey}`);
          }
        }
      }
    }
    
    if (fares.length > 0) {
      result.fare_classes.push({
        class: 'Economy',
        fares: fares
      });
    }
    
    return result.fare_classes.length > 0 ? result : null;
  }

  /**
   * Check if popup is currently visible
   */
  function checkIfPopupVisible() {
    // Check for ffWrapper (one-way trips)
    const ffWrapper = document.querySelector('div#ffWrapper, div.ffWrapper');
    if (ffWrapper && isElementVisible(ffWrapper)) {
      return true;
    }
    
    // Check for other popups
    const popups = document.querySelectorAll('div.wdth100, div.journeyContent');
    for (const popup of popups) {
      if (isElementVisible(popup)) {
        return true;
      }
    }
    return false;
  }

  /**
   * Close popup if it's open (to avoid confusion with next card)
   * Returns true if popup was closed, false otherwise
   */
  async function closePopupIfOpen() {
    // First, check for ffWrapper (one-way trips)
    const ffWrapper = document.querySelector('div#ffWrapper, div.ffWrapper');
    if (ffWrapper && isElementVisible(ffWrapper)) {
      // Look for multifareCross close button
      const multifareCross = ffWrapper.querySelector('span.multifareCross, [class*="multifareCross"]');
      if (multifareCross && isElementVisible(multifareCross)) {
        try {
          multifareCross.click();
          await sleep(100 * sleepMultiplier);
          console.log('Closed ffWrapper popup using multifareCross');
          return true;
        } catch (e) {
          console.error('Error clicking multifareCross:', e);
        }
      }
    }
    
    // Check for other popups
    const popups = document.querySelectorAll('div.wdth100, div.journeyContent, [class*="modal"], [class*="popup"]');
    let popupFound = false;
    
    for (const popup of popups) {
      if (isElementVisible(popup)) {
        popupFound = true;
        break;
      }
    }
    
    if (!popupFound && (!ffWrapper || !isElementVisible(ffWrapper))) {
      return false; // No popup found
    }
    
    // Strategy 1: Look for close buttons (X buttons, close icons)
    const closeButtonSelectors = [
      'span.multifareCross',
      '[class*="multifareCross"]',
      'button[aria-label*="close" i]',
      'button[class*="close" i]',
      'button[class*="Close" i]',
      '.modal-close',
      '[data-test*="close" i]',
      '[class*="close-icon"]',
      '[class*="closeIcon"]',
      'span[class*="close"]',
      'div[class*="close"]',
      // MakeMyTrip specific close buttons
      'button[class*="closeBtn"]',
      '[class*="closeButton"]'
    ];
    
    for (const selector of closeButtonSelectors) {
      try {
        const closeButtons = document.querySelectorAll(selector);
        for (const btn of closeButtons) {
          if (isElementVisible(btn)) {
            try {
              btn.click();
              await sleep(300); // Wait a bit after clicking
              console.log('Closed popup using close button');
              return true;
            } catch (e) {
              // Continue to next button
            }
          }
        }
      } catch (e) {
        // Invalid selector, continue
      }
    }
    
    // Strategy 2: Click outside/overlay to close (common modal pattern)
    try {
      const overlays = document.querySelectorAll('[class*="overlay"], [class*="backdrop"], [class*="modal-backdrop"]');
      for (const overlay of overlays) {
        if (isElementVisible(overlay)) {
          overlay.click();
          await sleep(300);
          console.log('Closed popup by clicking overlay');
          return true;
        }
      }
    } catch (e) {
      // Ignore errors
    }
    
    // Strategy 3: Press Escape key to close modal
    try {
      const escapeEvent = new KeyboardEvent('keydown', {
        key: 'Escape',
        code: 'Escape',
        keyCode: 27,
        which: 27,
        bubbles: true,
        cancelable: true
      });
      document.dispatchEvent(escapeEvent);
      await sleep(300);
      console.log('Sent Escape key to close popup');
      return true;
    } catch (e) {
      // Ignore if Escape key simulation fails
    }
    
    // Strategy 4: Try to hide the popup directly by setting display:none
    try {
      for (const popup of popups) {
        if (isElementVisible(popup)) {
          popup.style.display = 'none';
          popup.style.visibility = 'hidden';
          popup.setAttribute('aria-hidden', 'true');
          console.log('Hidden popup by setting display:none');
          return true;
        }
      }
    } catch (e) {
      // Ignore errors
    }
    
    return false;
  }

  /**
   * Sleep utility function (equivalent to time.sleep in Python)
   * Optimized: Reduced sleep times for faster extraction
   * Use sparingly - prefer event-driven waits when possible
   */
  function sleep(ms) {
    // Apply multiplier and reduction factor for optimization
    // SLEEP_REDUCTION_FACTOR reduces all sleep times by 70% for faster extraction
    const adjustedMs = Math.max(10, ms * sleepMultiplier * SLEEP_REDUCTION_FACTOR);
    return new Promise(resolve => setTimeout(resolve, adjustedMs));
  }

  /**
   * Wait for element to appear in DOM using MutationObserver (faster than polling)
   * @param {string} selector - CSS selector
   * @param {number} maxWaitMs - Maximum wait time in milliseconds
   * @param {Element} rootElement - Root element to observe (default: document)
   * @returns {Promise<Element|null>} - Found element or null
   */
  async function waitForElement(selector, maxWaitMs = 5000, rootElement = document) {
    // First, try immediate check (common case)
    const immediate = rootElement.querySelector(selector);
    if (immediate && isElementVisible(immediate)) {
      return immediate;
    }

    return new Promise((resolve) => {
      const startTime = Date.now();
      let timeoutId = null;
      let observer = null;

      const cleanup = () => {
        if (observer) observer.disconnect();
        if (timeoutId) clearTimeout(timeoutId);
      };

      const checkElement = () => {
        const element = rootElement.querySelector(selector);
        if (element && isElementVisible(element)) {
          cleanup();
          resolve(element);
          return true;
        }
        return false;
      };

      // Set timeout
      timeoutId = setTimeout(() => {
        cleanup();
        resolve(null);
      }, maxWaitMs);

      // Use MutationObserver for faster detection
      observer = new MutationObserver(() => {
        if (checkElement()) return;
        
        // Also check periodically in case MutationObserver misses something
        if (Date.now() - startTime > maxWaitMs) {
          cleanup();
          resolve(null);
        }
      });

      // Start observing
      observer.observe(rootElement, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['class', 'style']
      });

      // Also poll occasionally as fallback (less frequent than before)
      const pollInterval = Math.min(200, maxWaitMs / 10);
      const pollId = setInterval(() => {
        if (checkElement()) {
          clearInterval(pollId);
          return;
        }
        if (Date.now() - startTime > maxWaitMs) {
          clearInterval(pollId);
          cleanup();
          resolve(null);
        }
      }, pollInterval);
    });
  }

  /**
   * Wait for element to become visible (checks visibility, not just existence)
   * @param {string|Element} selectorOrElement - CSS selector or element
   * @param {number} maxWaitMs - Maximum wait time
   * @returns {Promise<Element|null>}
   */
  async function waitForVisible(selectorOrElement, maxWaitMs = 3000) {
    const element = typeof selectorOrElement === 'string' 
      ? document.querySelector(selectorOrElement)
      : selectorOrElement;
    
    if (element && isElementVisible(element)) {
      return element;
    }

    if (typeof selectorOrElement === 'string') {
      return await waitForElement(selectorOrElement, maxWaitMs);
    }

    // For element, wait for it to become visible
    return new Promise((resolve) => {
      const startTime = Date.now();
      let timeoutId = null;
      let observer = null;

      const cleanup = () => {
        if (observer) observer.disconnect();
        if (timeoutId) clearTimeout(timeoutId);
      };

      const checkVisible = () => {
        if (element && isElementVisible(element)) {
          cleanup();
          resolve(element);
          return true;
        }
        return false;
      };

      timeoutId = setTimeout(() => {
        cleanup();
        resolve(null);
      }, maxWaitMs);

      observer = new MutationObserver(() => {
        if (checkVisible()) return;
      });

      observer.observe(element, {
        attributes: true,
        attributeFilter: ['class', 'style'],
        childList: true,
        subtree: true
      });

      // Also check style changes via requestAnimationFrame
      const checkFrame = () => {
        if (checkVisible()) return;
        if (Date.now() - startTime < maxWaitMs) {
          requestAnimationFrame(checkFrame);
        } else {
          cleanup();
          resolve(null);
        }
      };
      requestAnimationFrame(checkFrame);
    });
  }

  /**
   * Wait for element to become clickable (visible and not disabled)
   * @param {string|Element} selectorOrElement - CSS selector or element
   * @param {number} maxWaitMs - Maximum wait time
   * @returns {Promise<Element|null>}
   */
  async function waitForClickable(selectorOrElement, maxWaitMs = 3000) {
    const element = typeof selectorOrElement === 'string'
      ? await waitForElement(selectorOrElement, maxWaitMs)
      : selectorOrElement;

    if (!element) return null;

    if (isElementVisible(element) && !element.disabled) {
      return element;
    }

    return new Promise((resolve) => {
      const startTime = Date.now();
      let timeoutId = null;
      let observer = null;

      const cleanup = () => {
        if (observer) observer.disconnect();
        if (timeoutId) clearTimeout(timeoutId);
      };

      const checkClickable = () => {
        if (element && isElementVisible(element) && !element.disabled) {
          cleanup();
          resolve(element);
          return true;
        }
        return false;
      };

      timeoutId = setTimeout(() => {
        cleanup();
        resolve(null);
      }, maxWaitMs);

      observer = new MutationObserver(() => {
        if (checkClickable()) return;
      });

      observer.observe(element, {
        attributes: true,
        attributeFilter: ['class', 'style', 'disabled'],
        childList: true
      });
    });
  }

  /**
   * Wait for navigation to complete (URL change)
   * @param {string} expectedUrl - Expected URL pattern (optional)
   * @param {number} maxWaitMs - Maximum wait time
   * @returns {Promise<boolean>}
   */
  async function waitForNavigation(expectedUrl = null, maxWaitMs = 10000) {
    return new Promise((resolve) => {
      const startUrl = window.location.href;
      const startTime = Date.now();
      let timeoutId = null;
      let checkInterval = null;

      const cleanup = () => {
        if (timeoutId) clearTimeout(timeoutId);
        if (checkInterval) clearInterval(checkInterval);
      };

      const checkNavigation = () => {
        const currentUrl = window.location.href;
        const urlChanged = currentUrl !== startUrl;
        
        if (urlChanged) {
          if (expectedUrl) {
            if (currentUrl.includes(expectedUrl)) {
              cleanup();
              // Wait for page to be interactive
              setTimeout(() => resolve(true), 100);
              return;
            }
          } else {
            cleanup();
            setTimeout(() => resolve(true), 100);
            return;
          }
        }

        if (Date.now() - startTime > maxWaitMs) {
          cleanup();
          resolve(false);
        }
      };

      timeoutId = setTimeout(() => {
        cleanup();
        resolve(false);
      }, maxWaitMs);

      // Check more frequently for navigation
      checkInterval = setInterval(checkNavigation, 100);
    });
  }

  /**
   * Main extraction function
   * Uses multiple selector strategies with fallbacks
   */
  function extractFlightData() {
    const flights = [];
    const maxFlights = 200; // Performance limit
    
    try {
      // Strategy 1: Look for common flight card containers
      let flightCards = findFlightCards();
      
      if (flightCards.length === 0) {
        console.warn('No flight cards found with primary selectors');
        // Fallback: Try alternative selectors
        flightCards = findFlightCardsFallback();
      }

      console.log(`Found ${flightCards.length} flight cards`);

      // Limit to visible elements and max count
      const visibleCards = Array.from(flightCards)
        .filter(card => isElementVisible(card))
        .slice(0, maxFlights);

      visibleCards.forEach((card, index) => {
        try {
          const flight = extractFlightFromCard(card, index);
          if (flight && isValidFlight(flight)) {
            flights.push(flight);
          }
        } catch (error) {
          console.error(`Error extracting flight ${index}:`, error);
        }
      });

    } catch (error) {
      console.error('Error in extractFlightData:', error);
    }

    return {
      metadata: {
        scraped_at: new Date().toISOString(),
        source_url: window.location.href,
        flights_count: flights.length,
        user_agent: navigator.userAgent
      },
      flights: flights
    };
  }

  /**
   * Check if this is a round trip page
   */
  function checkIfRoundTrip() {
    // Check for split view structure
    const splitView = document.querySelector('div.splitVw, div[class*="splitView"]');
    if (!splitView) return false;
    
    // Check for multiple panes
    const panes = document.querySelectorAll('div.paneView, div[class*="paneView"]');
    if (panes.length >= 2) return true;
    
    // Check for journey title indicating round trip
    const journeyTitle = document.querySelector('p.journey-title, span[class*="journey-title"]');
    if (journeyTitle) {
      const text = journeyTitle.textContent?.toLowerCase() || '';
      if (text.includes('and back') || text.includes('return')) {
        return true;
      }
    }
    
    return false;
  }

  /**
   * Find the "Flight Details" link in the sticky footer
   */
  function findFlightDetailsLink() {
    // Look for the Flight Details link in splitviewStickyOuter
    const stickyOuter = document.querySelector('div.splitviewStickyOuter, div[class*="splitviewSticky"]');
    if (!stickyOuter) {
      return null;
    }
    
    // First, try to find in stickyFlightDtl sections
    const stickyFlightDtls = stickyOuter.querySelectorAll('div.stickyFlightDtl');
    for (const stickyDtl of stickyFlightDtls) {
      const link = stickyDtl.querySelector('p.skyBlueText.fontSize12.pointer, p[class*="skyBlueText"]');
      if (link) {
        const text = link.textContent?.trim().toLowerCase() || '';
        if (text.includes('flight details') || text.includes('flight detail')) {
          return link;
        }
      }
    }
    
    // Fallback: Find the link with "Flight Details" text anywhere in sticky footer
    const links = stickyOuter.querySelectorAll('p.skyBlueText.fontSize12.pointer, p[class*="skyBlueText"]');
    for (const link of links) {
      const text = link.textContent?.trim().toLowerCase() || '';
      if (text.includes('flight details') || text.includes('flight detail')) {
        return link;
      }
    }
    
    // Last resort: look for any pointer element with "Flight Details" text
    const allPointers = stickyOuter.querySelectorAll('.pointer, [class*="pointer"]');
    for (const pointer of allPointers) {
      const text = pointer.textContent?.trim().toLowerCase() || '';
      if (text.includes('flight details') || text.includes('flight detail')) {
        return pointer;
      }
    }
    
    return null;
  }

  /**
   * Extract detailed flight information from all tabs in flightDetailsOuter
   * Clicks through all tabs to ensure complete data extraction
   */
  async function extractDetailedFlightInfoFromAllTabs() {
    try {
    const flightDetailsOuter = document.querySelector('div.flightDetailsOuter');
    if (!flightDetailsOuter) {
        console.log('flightDetailsOuter not found');
        return null;
      }
      
      // Verify element is still connected to DOM
      if (!flightDetailsOuter.isConnected) {
        console.error('flightDetailsOuter is not connected to DOM');
      return null;
    }
    
    const details = {
      detailed_flights: [],
      fare_summary: null,
      cancellation_policy: null,
      date_change_policy: null
    };
    
      // Get all tab links with error handling
      let tabLinks = null;
      try {
        tabLinks = flightDetailsOuter.querySelectorAll('a.nav-item.nav-link, a[role="tab"]');
      } catch (queryError) {
        console.error('Error querying tab links:', queryError);
        return null;
      }
      
      if (!tabLinks || tabLinks.length === 0) {
        console.log('No tab links found in flightDetailsOuter');
        return null;
      }
      
    // For one-way trips: Only extract FLIGHT DETAILS, skip FARE SUMMARY, CANCELLATION, and DATE CHANGE
    const tabNames = ['FLIGHT DETAILS']; // Commented out: 'FARE SUMMARY', 'CANCELLATION', 'DATE CHANGE'
    
    // Click through each tab and extract data
    for (let tabIndex = 0; tabIndex < tabLinks.length; tabIndex++) {
      const tabLink = tabLinks[tabIndex];
      const tabText = tabLink.textContent?.trim().toUpperCase() || '';
      
      // Check if this is one of the tabs we want
      const isTargetTab = tabNames.some(name => tabText.includes(name));
      if (!isTargetTab) continue;
      
      try {
        // Verify flightDetailsOuter is still valid
        if (!flightDetailsOuter || !flightDetailsOuter.isConnected) {
          console.error(`flightDetailsOuter is not valid for tab ${tabText}, skipping...`);
          continue;
        }
        
        // Verify tabLink is still valid
        if (!tabLink || !tabLink.isConnected) {
          console.error(`Tab link is not valid for ${tabText}, skipping...`);
          continue;
        }
        
        // Click the tab to activate it
        if (!tabLink.classList.contains('active')) {
          console.log(`Clicking tab: ${tabText}`);
          try {
          tabLink.scrollIntoView({ behavior: 'smooth', block: 'center' });
            await sleep(100 * sleepMultiplier); // Wait for scroll
            
            // Wait for element to be ready
          await sleep(300);
            
            // Verify tabLink is still connected before clicking
            if (!tabLink.isConnected) {
              console.error(`Tab link disconnected before click for ${tabText}, skipping...`);
              continue;
            }
            
          tabLink.click();
            console.log(`✓ Clicked tab: ${tabText}`);
            
            // Wait for click to register
            await sleep(600);
            
            // Wait for tab content to load
            await sleep(300 * sleepMultiplier);
            
            // Wait for loading to complete
            await waitForLoadingToComplete(3000);
            
            // Verify flightDetailsOuter is still valid
            if (!flightDetailsOuter.isConnected) {
              console.error(`flightDetailsOuter disconnected after tab click for ${tabText}, skipping extraction...`);
              continue;
            }
            
            // Get the corresponding tab pane
            let tabId = null;
            try {
              tabId = tabLink.getAttribute('aria-controls') || tabLink.getAttribute('id')?.replace('-tab-', '-tabpane-');
            } catch (idError) {
              console.warn(`Error getting tab ID for ${tabText}:`, idError);
            }
            
            let tabPane = null;
            if (tabId) {
              try {
                // Escape special characters in ID for querySelector
                const escapedId = tabId.replace(/[!"#$%&'()*+,.\/:;<=>?@[\\\]^`{|}~]/g, '\\$&');
                tabPane = flightDetailsOuter.querySelector(`#${escapedId}`);
                if (!tabPane) {
                  // Try without escaping
                  tabPane = flightDetailsOuter.querySelector(`div[id*="${tabId}"]`);
                }
                if (!tabPane) {
                  // Try finding by role and index
                  const allPanes = flightDetailsOuter.querySelectorAll('div[role="tabpanel"]');
                  const tabIndex = Array.from(tabLinks).indexOf(tabLink);
                  if (tabIndex >= 0 && tabIndex < allPanes.length) {
                    tabPane = allPanes[tabIndex];
                  }
                }
              } catch (queryError) {
                console.warn(`Error querying tab pane for ${tabText}:`, queryError);
              }
            }
            
            // Wait for tab content to be ready
            if (tabPane && tabPane.isConnected) {
              await waitForTabContentReady(tabPane, 3000);
            }
            
            // Additional wait to ensure content is fully rendered
            await sleep(200 * sleepMultiplier);
          } catch (clickError) {
            console.error(`Error clicking tab ${tabText}:`, clickError);
            // Continue to extraction anyway, tab might already be active
          }
        } else {
          // Tab is already active, but wait a bit to ensure content is ready
          await sleep(100 * sleepMultiplier);
        }
        
        // Verify flightDetailsOuter is still valid before extraction
        if (!flightDetailsOuter || !flightDetailsOuter.isConnected) {
          console.error(`flightDetailsOuter is not valid before extraction for ${tabText}, skipping...`);
          continue;
        }
        
        // Extract data based on tab type
        if (tabText.includes('FLIGHT DETAILS')) {
          console.log(`Extracting FLIGHT DETAILS...`);
          try {
          const flightDetails = extractFlightDetailsFromTab(flightDetailsOuter);
          if (flightDetails && flightDetails.length > 0) {
            details.detailed_flights = flightDetails;
              console.log(`✓ Extracted ${flightDetails.length} flight detail sections`);
          }
          } catch (extractError) {
            console.error(`Error extracting FLIGHT DETAILS:`, extractError);
          }
          await sleep(300); // Small delay after extraction
        }
        // COMMENTED OUT: For one-way trips, skip FARE SUMMARY, CANCELLATION, and DATE CHANGE extraction
        // Only extract FLIGHT DETAILS to reduce processing time
        /*
        else if (tabText.includes('FARE SUMMARY')) {
          console.log(`Extracting FARE SUMMARY...`);
          try {
          const fareSummary = extractFareSummaryFromTab(flightDetailsOuter);
          if (fareSummary) {
            details.fare_summary = fareSummary;
              console.log(`✓ Extracted fare summary`);
          }
          } catch (extractError) {
            console.error(`Error extracting FARE SUMMARY:`, extractError);
          }
          await sleep(300);
        } else if (tabText.includes('CANCELLATION')) {
          console.log(`Extracting CANCELLATION policy...`);
          try {
          const cancellationPolicy = await extractCancellationPolicyFromTab(flightDetailsOuter);
          if (cancellationPolicy) {
            details.cancellation_policy = cancellationPolicy;
              console.log(`✓ Extracted cancellation policy`);
          }
          } catch (extractError) {
            console.error(`Error extracting CANCELLATION:`, extractError);
          }
          await sleep(300);
        } else if (tabText.includes('DATE CHANGE')) {
          console.log(`Extracting DATE CHANGE policy...`);
          try {
            // Double-check flightDetailsOuter is still valid
            if (!flightDetailsOuter || !flightDetailsOuter.isConnected) {
              console.error(`flightDetailsOuter is not valid for DATE CHANGE extraction, skipping...`);
              continue;
            }
          const dateChangePolicy = await extractDateChangePolicyFromTab(flightDetailsOuter);
          if (dateChangePolicy) {
            details.date_change_policy = dateChangePolicy;
              console.log(`✓ Extracted date change policy`);
            }
          } catch (extractError) {
            console.error(`Error extracting DATE CHANGE:`, extractError);
            console.error(`Error details:`, {
              message: extractError.message,
              name: extractError.name,
              stack: extractError.stack
            });
          }
          await sleep(300);
        }
        */
      } catch (error) {
        console.error(`Error extracting data from tab ${tabText}:`, error);
        await sleep(100 * sleepMultiplier); // Wait before continuing to next tab
      }
    }
    
    return Object.keys(details).length > 0 ? details : null;
    } catch (error) {
      console.error('Error in extractDetailedFlightInfoFromAllTabs:', error);
      console.error('Error details:', {
        message: error.message,
        name: error.name,
        stack: error.stack
      });
      return null;
    }
  }

  /**
   * Extract flight details from FLIGHT DETAILS tab
   */
  function extractFlightDetailsFromTab(flightDetailsOuter) {
    const flightDetails = [];
    // Try multiple selectors to find the flight details tab
    const flightDetailsTab = flightDetailsOuter.querySelector('div.splitViewFlightDtl, div[class*="splitViewFlightDtl"], div[id*="tabpane-1"], div[data-test="component-firstTab"]');
    if (!flightDetailsTab) {
      return flightDetails;
    }
    
    const flightDetailsSections = flightDetailsTab.querySelectorAll('div.flightDetails');
    
    flightDetailsSections.forEach((section, index) => {
      const flightDetail = {};
      
      // Extract route header (e.g., "Mumbai to Varanasi , 8 Nov")
      const header = section.querySelector('p.flightDetailsHead');
      if (header) {
        flightDetail.route_header = header.textContent?.trim();
      }
      
      // Extract all flight rows (for multi-segment flights)
      const flightRows = section.querySelectorAll('div.flightDetailsRow');
      const segments = [];
      
      flightRows.forEach((row, rowIndex) => {
        const segment = {};
        
        // Extract airline information
        const airlineHeading = row.querySelector('span.airlineHeadng');
        if (airlineHeading) {
          const airlineText = airlineHeading.textContent?.trim();
          // Extract airline name and flight code (e.g., "Air India AI  | 2677" or "Air India AI | 9989  | Operated By Air India Express")
          const airlineMatch = airlineText.match(/([A-Za-z\s]+)\s+([A-Z0-9]{2})\s*\|\s*(\d+)/);
          if (airlineMatch) {
            segment.airline_name = airlineMatch[1].trim();
            segment.airline_code = airlineMatch[2].trim();
            segment.flight_number = airlineMatch[3].trim();
            segment.full_flight_code = `${airlineMatch[2]} ${airlineMatch[3]}`;
            
            // Check for "Operated By" text
            const operatedByMatch = airlineText.match(/Operated By\s+(.+)/i);
            if (operatedByMatch) {
              segment.operated_by = operatedByMatch[1].trim();
            }
          }
        }
        
        // Extract aircraft type
        const aircraftType = row.querySelector('span.aircraftType');
        if (aircraftType) {
          segment.aircraft_type = aircraftType.textContent?.trim();
        }
        
        // Extract departure information
        const flightDtlInfo = row.querySelector('div.flightDtlInfo');
        if (flightDtlInfo) {
          const departureInfo = flightDtlInfo.querySelector('div.airlineDTInfoCol:first-of-type');
          if (departureInfo) {
            const depTime = departureInfo.querySelector('p.fontSize18.blackText.blackFont');
            if (depTime) {
              segment.departure_time = depTime.textContent?.trim();
            }
            
            const depDate = departureInfo.querySelector('p.fontSize12.blackText.boldFont');
            if (depDate) {
              segment.departure_date = depDate.textContent?.trim();
            }
            
            const depTerminal = departureInfo.querySelector('font[color="#4a4a4a"]');
            if (depTerminal) {
              segment.departure_terminal = depTerminal.textContent?.trim();
            }
            
            const depCity = departureInfo.querySelector('p.fontSize12:last-of-type');
            if (depCity) {
              segment.departure_city = depCity.textContent?.trim();
            }
          }
          
          // Extract arrival information
          const arrivalInfo = flightDtlInfo.querySelector('div.airlineDTInfoCol:last-of-type');
          if (arrivalInfo) {
            const arrTime = arrivalInfo.querySelector('p.fontSize18.blackText.blackFont');
            if (arrTime) {
              segment.arrival_time = arrTime.textContent?.trim();
            }
            
            const arrDate = arrivalInfo.querySelector('p.fontSize12.blackText.boldFont');
            if (arrDate) {
              segment.arrival_date = arrDate.textContent?.trim();
            }
            
            const arrTerminal = arrivalInfo.querySelector('font[color="#4a4a4a"]');
            if (arrTerminal) {
              segment.arrival_terminal = arrTerminal.textContent?.trim();
            }
            
            const arrCity = arrivalInfo.querySelector('p.fontSize12:last-of-type');
            if (arrCity) {
              segment.arrival_city = arrCity.textContent?.trim();
            }
          }
          
          // Extract duration
          const durationEl = flightDtlInfo.querySelector('div.airlineDtlDuration');
          if (durationEl) {
            segment.duration = durationEl.textContent?.trim();
          }
          
          // Extract baggage information
          const baggageInfo = flightDtlInfo.querySelector('div.baggageInfo');
          if (baggageInfo) {
            const baggageRows = baggageInfo.querySelectorAll('p.makeFlex.spaceBetween');
            const baggageData = [];
            
            baggageRows.forEach(bagRow => {
              const cells = bagRow.querySelectorAll('span.baggageInfoText');
              if (cells.length >= 3) {
                baggageData.push({
                  category: cells[0].textContent?.trim(),
                  check_in: cells[1].textContent?.trim(),
                  cabin: cells[2].textContent?.trim()
                });
              }
            });
            
            if (baggageData.length > 0) {
              segment.baggage_info = baggageData;
            } else {
              // Check if it says "Information not available"
              const notAvailable = baggageInfo.querySelector('p.redText, font[color="#e53442"]');
              if (notAvailable) {
                segment.baggage_info = notAvailable.textContent?.trim();
              }
            }
          }
          
          // Extract amenities (Complimentary Meals, Layout, Beverages, etc.)
          const amenitiesContainer = row.querySelector('div.makeFlex.hrtlCenter.flexWrap.appendTop18');
          if (amenitiesContainer) {
            const amenities = [];
            const amenityItems = amenitiesContainer.querySelectorAll('div.makeFlex.gap8.lowEmphasis.hrtlCenter');
            
            amenityItems.forEach(amenityItem => {
              const amenityText = amenityItem.querySelector('div.fontSize12');
              if (amenityText) {
                const text = amenityText.textContent?.trim();
                if (text) {
                  amenities.push(text);
                }
              }
            });
            
            if (amenities.length > 0) {
              segment.amenities = amenities;
            }
          }
        }
        
        if (Object.keys(segment).length > 0) {
          segments.push(segment);
        }
      });
      
      // Extract layover information if present (there can be multiple layovers)
      const layoverOuters = section.querySelectorAll('div.flightLayoverOuter');
      if (layoverOuters.length > 0) {
        const layovers = [];
        layoverOuters.forEach(layoverOuter => {
        const layoverInfo = layoverOuter.querySelector('div.flightLayover, div.mmtConnectLayover');
        if (layoverInfo) {
            const layoverText = layoverInfo.textContent?.trim();
            if (layoverText) {
              layovers.push(layoverText);
            }
          }
        });
        if (layovers.length > 0) {
          flightDetail.layover_info = layovers.length === 1 ? layovers[0] : layovers;
        }
      }
      
      if (segments.length > 0) {
        flightDetail.segments = segments;
        flightDetails.push(flightDetail);
      }
    });
    
    return flightDetails;
  }

  /**
   * Extract fare summary from FARE SUMMARY tab
   */
  function extractFareSummaryFromTab(flightDetailsOuter) {
    try {
      if (!flightDetailsOuter) {
        console.error('extractFareSummaryFromTab: flightDetailsOuter is null');
        return null;
      }
      
      // Verify element is still connected
      if (!flightDetailsOuter.isConnected) {
        console.error('extractFareSummaryFromTab: flightDetailsOuter is not connected to DOM');
        return null;
      }
      
      // Try multiple selectors to find the fare summary tab
      let fareSummaryTab = null;
      try {
        fareSummaryTab = flightDetailsOuter.querySelector('div[id*="tabpane-2"]');
    if (!fareSummaryTab) {
          fareSummaryTab = flightDetailsOuter.querySelector('div[aria-labelledby*="tab-2"]');
        }
        if (!fareSummaryTab) {
          // Try to find by role
          const allTabPanes = flightDetailsOuter.querySelectorAll('div[role="tabpanel"]');
          for (const pane of allTabPanes) {
            if (!pane.isConnected) continue;
            try {
              const id = pane.getAttribute('id') || '';
              if (id.includes('tabpane-2') || id.includes('tab-2')) {
                fareSummaryTab = pane;
                break;
              }
            } catch (attrError) {
              continue;
            }
          }
        }
      } catch (queryError) {
        console.error('Error querying fare summary tab:', queryError);
      return null;
    }
      
      if (!fareSummaryTab) {
        console.log('FARE SUMMARY tab not found');
        return null;
      }
      
      // Verify tab is still connected
      if (!fareSummaryTab.isConnected) {
        console.error('FARE SUMMARY tab is not connected to DOM');
        return null;
      }
      
      // Check if tab is visible/active
      try {
        if (fareSummaryTab.classList.contains('fade') && !fareSummaryTab.classList.contains('show')) {
          console.log('FARE SUMMARY tab is not active/visible yet');
          // Still try to extract, might work
        }
      } catch (classError) {
        // Continue anyway
    }
    
    const fareBreakup = {};
      
      // Try multiple selectors for fare rows
      let fareRows = [];
      try {
        if (fareSummaryTab.isConnected) {
          fareRows = Array.from(fareSummaryTab.querySelectorAll('p.appendBottom8.fontSize12'));
          if (fareRows.length === 0) {
            fareRows = Array.from(fareSummaryTab.querySelectorAll('p[class*="appendBottom8"]'));
          }
          if (fareRows.length === 0) {
            fareRows = Array.from(fareSummaryTab.querySelectorAll('div.flightDetailsInfo p'));
          }
          if (fareRows.length === 0) {
            // Try to find any paragraph with fare information
            fareRows = Array.from(fareSummaryTab.querySelectorAll('p'));
          }
        }
      } catch (queryError) {
        console.warn('Error querying fare rows:', queryError);
      }
      
      fareRows.forEach((row, index) => {
        try {
          // Check if row is still in DOM
          if (!row || !row.isConnected) {
            return; // Skip detached elements
          }
          
          let spans = [];
          try {
            spans = Array.from(row.querySelectorAll('span.fareBreakupText, span'));
          } catch (spanError) {
            // Skip this row if query fails
            return;
          }
          
      if (spans.length >= 2) {
            try {
              // Verify spans are still connected before accessing textContent
              if (!spans[0].isConnected || !spans[1].isConnected) {
                return;
              }
        const label = spans[0].textContent?.trim();
        const value = spans[1].textContent?.trim();
        if (label && value) {
                const key = label.toLowerCase().replace(/\s+/g, '_');
                fareBreakup[key] = value;
              }
            } catch (textError) {
              console.warn(`Error extracting text from fare row ${index}:`, textError);
            }
          } else if (spans.length === 1) {
            // Sometimes the structure is different, try to get text directly
            try {
              if (!row.isConnected) return;
              const text = row.textContent?.trim();
              if (text) {
                // Try to parse "Label: Value" format
                const match = text.match(/^([^:]+):\s*(.+)$/);
                if (match) {
                  const key = match[1].trim().toLowerCase().replace(/\s+/g, '_');
                  const value = match[2].trim();
                  fareBreakup[key] = value;
                }
              }
            } catch (textError) {
              console.warn(`Error extracting text from fare row ${index}:`, textError);
            }
          }
        } catch (rowError) {
          console.warn(`Error processing fare row ${index}:`, rowError);
          // Continue with next row
        }
      });
      
      // Also try to extract from font elements (as seen in the HTML structure)
      if (Object.keys(fareBreakup).length === 0) {
        try {
          if (fareSummaryTab.isConnected) {
            const fareInfoElements = Array.from(fareSummaryTab.querySelectorAll('div.flightDetailsInfo p, div.flightDetails p'));
            fareInfoElements.forEach(element => {
              try {
                if (!element.isConnected) return;
                const text = element.textContent?.trim();
                if (text) {
                  // Look for patterns like "TOTAL ₹ 18,271" or "Base Fare ₹ 15,797"
                  const totalMatch = text.match(/(?:total|TOTAL)\s*[₹]?\s*([\d,]+)/i);
                  if (totalMatch) {
                    fareBreakup['total'] = `₹ ${totalMatch[1]}`;
                  }
                  const baseMatch = text.match(/(?:base\s*fare|Base Fare)\s*[₹]?\s*([\d,]+)/i);
                  if (baseMatch) {
                    fareBreakup['base_fare'] = `₹ ${baseMatch[1]}`;
                  }
                  const surchargeMatch = text.match(/(?:surcharges|Surcharges)\s*[₹]?\s*([\d,]+)/i);
                  if (surchargeMatch) {
                    fareBreakup['surcharges'] = `₹ ${surchargeMatch[1]}`;
                  }
                }
              } catch (e) {
                // Skip this element
              }
            });
          }
        } catch (e) {
          console.warn('Error in alternative fare extraction:', e);
        }
      }
    
    return Object.keys(fareBreakup).length > 0 ? fareBreakup : null;
    } catch (error) {
      console.error('Error in extractFareSummaryFromTab:', error);
      console.error('Error details:', {
        message: error.message,
        name: error.name,
        stack: error.stack
      });
      return null;
    }
  }

  /**
   * Extract cancellation policy from CANCELLATION tab
   */
  async function extractCancellationPolicyFromTab(flightDetailsOuter) {
    try {
      if (!flightDetailsOuter) {
        console.error('extractCancellationPolicyFromTab: flightDetailsOuter is null');
        return null;
      }
      
      // Verify element is still connected
      if (!flightDetailsOuter.isConnected) {
        console.error('extractCancellationPolicyFromTab: flightDetailsOuter is not connected to DOM');
        return null;
      }
      
      // Try multiple selectors to find the cancellation tab
      let cancellationTab = null;
      try {
        cancellationTab = flightDetailsOuter.querySelector('div[id*="tabpane-3"]');
    if (!cancellationTab) {
          cancellationTab = flightDetailsOuter.querySelector('div[aria-labelledby*="tab-3"]');
        }
        if (!cancellationTab) {
          // Try to find by role
          const allTabPanes = flightDetailsOuter.querySelectorAll('div[role="tabpanel"]');
          for (const pane of allTabPanes) {
            if (!pane.isConnected) continue;
            try {
              const id = pane.getAttribute('id') || '';
              if (id.includes('tabpane-3') || id.includes('tab-3')) {
                cancellationTab = pane;
                break;
              }
            } catch (attrError) {
              continue;
            }
          }
        }
      } catch (queryError) {
        console.error('Error querying cancellation tab:', queryError);
      return null;
    }
      
      if (!cancellationTab) {
        console.log('CANCELLATION tab not found');
        return null;
      }
      
      // Verify tab is still connected
      if (!cancellationTab.isConnected) {
        console.error('CANCELLATION tab is not connected to DOM');
        return null;
      }
      
      // Wait for tab content to be ready
      await sleep(500);
    
    const cancellationPolicies = [];
      
      // Try multiple selectors for accordion cards
      let accordionCards = [];
      try {
        if (cancellationTab.isConnected) {
          accordionCards = Array.from(cancellationTab.querySelectorAll('div.card'));
          if (accordionCards.length === 0) {
            accordionCards = Array.from(cancellationTab.querySelectorAll('div[class*="card"]'));
          }
          if (accordionCards.length === 0) {
            // Try to find any collapsible sections
            accordionCards = Array.from(cancellationTab.querySelectorAll('div[class*="collapse"], div[class*="accordion"]'));
          }
        }
      } catch (queryError) {
        console.warn('Error querying accordion cards:', queryError);
      }
      
      for (let i = 0; i < accordionCards.length; i++) {
        try {
          const card = accordionCards[i];
          
          // Check if element is still in DOM
          if (!card || !card.isConnected) {
            console.warn(`Cancellation card ${i + 1} is not connected to DOM, skipping`);
            continue;
          }
          
          let cardHeader = null;
          let route = null;
          
          try {
            cardHeader = card.querySelector('div.card-header');
            if (cardHeader && cardHeader.isConnected) {
              route = cardHeader.textContent?.trim() || null;
            }
          } catch (headerError) {
            console.warn(`Error extracting header from cancellation card ${i + 1}:`, headerError);
          }
      
      // Check if card is collapsed - if so, click to expand
          let collapseDiv = null;
          let isCollapsed = false;
          try {
            if (card.isConnected) {
              collapseDiv = card.querySelector('div.collapse');
              if (collapseDiv && collapseDiv.isConnected) {
                isCollapsed = !collapseDiv.classList.contains('show');
              }
            }
          } catch (collapseError) {
            // Assume not collapsed if we can't check
            isCollapsed = false;
          }
      
      if (isCollapsed) {
            try {
              if (cardHeader && cardHeader.isConnected) {
                const showButton = cardHeader.querySelector('button');
                if (showButton && showButton.isConnected) {
                  // Scroll button into view
                  showButton.scrollIntoView({ behavior: 'smooth', block: 'center' });
                  await sleep(400);
                  
                  // Wait before clicking
                  await sleep(300);
                  
                  // Verify button is still connected before clicking
                  if (showButton.isConnected) {
          showButton.click();
                    console.log(`Expanding cancellation accordion ${i + 1}...`);
                    
                    // Wait for click to register
                    await sleep(100 * sleepMultiplier);
                    
                    // Wait for accordion to fully expand
                    await sleep(1200);
                    
                    // Wait for content to load
                    await waitForLoadingToComplete(2000);
                  }
                }
              }
            } catch (expandError) {
              console.warn(`Error expanding cancellation accordion ${i + 1}:`, expandError);
              // Continue anyway, might already be expanded
            }
          } else {
            // Already expanded, wait a bit for content to be ready
            await sleep(300);
          }
          
          // Try multiple selectors for policy rows
          let policyRows = [];
          try {
            if (card.isConnected) {
              policyRows = Array.from(card.querySelectorAll('div.DateChangeInfo'));
              if (policyRows.length === 0) {
                policyRows = Array.from(card.querySelectorAll('div[class*="DateChangeInfo"]'));
              }
              if (policyRows.length === 0) {
                policyRows = Array.from(card.querySelectorAll('div[class*="Info"]'));
              }
            }
          } catch (queryError) {
            console.warn(`Error querying policy rows for card ${i + 1}:`, queryError);
          }
          
      const policies = [];
      
          for (let j = 0; j < policyRows.length; j++) {
            try {
              const row = policyRows[j];
              
              // Check if element is still in DOM
              if (!row || !row.isConnected) {
                continue;
              }
              
              let timeFrame = null;
              let feeInfo = null;
              
              try {
                if (row.isConnected) {
                  const timeFrameEl = row.querySelector('div.flightDetailsInfoLeft p');
                  if (timeFrameEl && timeFrameEl.isConnected) {
                    timeFrame = timeFrameEl.textContent?.trim();
                  }
                }
              } catch (timeError) {
                console.warn(`Error extracting time frame from row ${j + 1}:`, timeError);
              }
              
              try {
                if (row.isConnected) {
                  const feeInfoEl = row.querySelector('div.flightDetailsInfoRight p');
                  if (feeInfoEl && feeInfoEl.isConnected) {
                    feeInfo = feeInfoEl.textContent?.trim();
                  }
                }
              } catch (feeError) {
                console.warn(`Error extracting fee info from row ${j + 1}:`, feeError);
              }
              
              // Also try alternative selectors if primary ones failed
              if (!timeFrame || !feeInfo) {
                try {
                  if (row.isConnected) {
                    const allPs = Array.from(row.querySelectorAll('p'));
                    if (allPs.length >= 2) {
                      if (!timeFrame && allPs[0].isConnected) {
                        timeFrame = allPs[0].textContent?.trim();
                      }
                      if (!feeInfo && allPs[1].isConnected) {
                        feeInfo = allPs[1].textContent?.trim();
                      }
                    }
                  }
                } catch (altError) {
                  // Skip this row
                }
              }
        
        if (timeFrame && feeInfo) {
          policies.push({
                  time_frame: timeFrame,
                  fee: feeInfo
          });
              }
            } catch (rowError) {
              console.warn(`Error processing cancellation policy row ${j + 1} in card ${i + 1}:`, rowError);
              // Continue with next row
        }
      }
      
      if (route && policies.length > 0) {
        cancellationPolicies.push({
          route: route,
          policies: policies
        });
          } else if (policies.length > 0) {
            // Add policies even without route
            cancellationPolicies.push({
              route: 'Unknown',
          policies: policies
        });
          }
          
          // Small delay between cards
          await sleep(200);
        } catch (cardError) {
          console.warn(`Error processing cancellation card ${i + 1}:`, cardError);
          // Continue with next card
      }
    }
    
    return cancellationPolicies.length > 0 ? cancellationPolicies : null;
    } catch (error) {
      console.error('Error in extractCancellationPolicyFromTab:', error);
      console.error('Error details:', {
        message: error.message,
        name: error.name,
        stack: error.stack
      });
      return null;
    }
  }

  /**
   * Extract date change policy from DATE CHANGE tab
   */
  async function extractDateChangePolicyFromTab(flightDetailsOuter) {
    try {
      if (!flightDetailsOuter) {
        console.error('extractDateChangePolicyFromTab: flightDetailsOuter is null');
        return null;
      }
      
      // Verify element is still connected
      if (!flightDetailsOuter.isConnected) {
        console.error('extractDateChangePolicyFromTab: flightDetailsOuter is not connected to DOM');
        return null;
      }
      
      // Try multiple selectors to find the date change tab
      let dateChangeTab = null;
      try {
        dateChangeTab = flightDetailsOuter.querySelector('div[id*="tabpane-4"]');
    if (!dateChangeTab) {
          dateChangeTab = flightDetailsOuter.querySelector('div[aria-labelledby*="tab-4"]');
        }
        if (!dateChangeTab) {
          // Try to find by role
          const allTabPanes = flightDetailsOuter.querySelectorAll('div[role="tabpanel"]');
          for (const pane of allTabPanes) {
            if (!pane.isConnected) continue;
            try {
              const id = pane.getAttribute('id') || '';
              if (id.includes('tabpane-4') || id.includes('tab-4')) {
                dateChangeTab = pane;
                break;
              }
            } catch (attrError) {
              continue;
            }
          }
        }
      } catch (queryError) {
        console.error('Error querying date change tab:', queryError);
      return null;
    }
      
      if (!dateChangeTab) {
        console.log('DATE CHANGE tab not found');
        return null;
      }
      
      // Verify tab is still connected
      if (!dateChangeTab.isConnected) {
        console.error('DATE CHANGE tab is not connected to DOM');
        return null;
      }
      
      // Wait for tab content to be ready
      await sleep(500);
    
    const dateChangePolicies = [];
      
      // Try multiple selectors for accordion cards
      let accordionCards = [];
      try {
        if (dateChangeTab.isConnected) {
          accordionCards = Array.from(dateChangeTab.querySelectorAll('div.card'));
          if (accordionCards.length === 0) {
            accordionCards = Array.from(dateChangeTab.querySelectorAll('div[class*="card"]'));
          }
          if (accordionCards.length === 0) {
            // Try to find any collapsible sections
            accordionCards = Array.from(dateChangeTab.querySelectorAll('div[class*="collapse"], div[class*="accordion"]'));
          }
        }
      } catch (queryError) {
        console.warn('Error querying accordion cards:', queryError);
      }
      
      for (let i = 0; i < accordionCards.length; i++) {
        try {
          const card = accordionCards[i];
          
          // Check if element is still in DOM
          if (!card || !card.isConnected) {
            console.warn(`Date change card ${i + 1} is not connected to DOM, skipping`);
            continue;
          }
          
          let cardHeader = null;
          let route = null;
          
          try {
            cardHeader = card.querySelector('div.card-header');
            if (cardHeader && cardHeader.isConnected) {
              route = cardHeader.textContent?.trim() || null;
            }
          } catch (headerError) {
            console.warn(`Error extracting header from date change card ${i + 1}:`, headerError);
          }
      
      // Check if card is collapsed - if so, click to expand
          let collapseDiv = null;
          let isCollapsed = false;
          try {
            if (card.isConnected) {
              collapseDiv = card.querySelector('div.collapse');
              if (collapseDiv && collapseDiv.isConnected) {
                isCollapsed = !collapseDiv.classList.contains('show');
              }
            }
          } catch (collapseError) {
            // Assume not collapsed if we can't check
            isCollapsed = false;
          }
      
      if (isCollapsed) {
            try {
              if (cardHeader && cardHeader.isConnected) {
                const showButton = cardHeader.querySelector('button');
                if (showButton && showButton.isConnected) {
                  // Scroll button into view
                  showButton.scrollIntoView({ behavior: 'smooth', block: 'center' });
                  await sleep(400);
                  
                  // Wait before clicking
                  await sleep(300);
                  
                  // Verify button is still connected before clicking
                  if (showButton.isConnected) {
          showButton.click();
                    console.log(`Expanding date change accordion ${i + 1}...`);
                    
                    // Wait for click to register
                    await sleep(100 * sleepMultiplier);
                    
                    // Wait for accordion to fully expand
                    await sleep(1200);
                    
                    // Wait for content to load
                    await waitForLoadingToComplete(2000);
                  }
                }
              }
            } catch (expandError) {
              console.warn(`Error expanding date change accordion ${i + 1}:`, expandError);
              // Continue anyway, might already be expanded
            }
          } else {
            // Already expanded, wait a bit for content to be ready
            await sleep(300);
          }
          
          // Try multiple selectors for policy rows
          let policyRows = [];
          try {
            if (card.isConnected) {
              policyRows = Array.from(card.querySelectorAll('div.DateChangeInfo'));
              if (policyRows.length === 0) {
                policyRows = Array.from(card.querySelectorAll('div[class*="DateChangeInfo"]'));
              }
              if (policyRows.length === 0) {
                policyRows = Array.from(card.querySelectorAll('div[class*="Info"]'));
              }
            }
          } catch (queryError) {
            console.warn(`Error querying policy rows for card ${i + 1}:`, queryError);
          }
          
      const policies = [];
      
          for (let j = 0; j < policyRows.length; j++) {
            try {
              const row = policyRows[j];
              
              // Check if element is still in DOM
              if (!row || !row.isConnected) {
                continue;
              }
              
              let timeFrame = null;
              let feeInfo = null;
              
              try {
                if (row.isConnected) {
                  const timeFrameEl = row.querySelector('div.flightDetailsInfoLeft p');
                  if (timeFrameEl && timeFrameEl.isConnected) {
                    timeFrame = timeFrameEl.textContent?.trim();
                  }
                }
              } catch (timeError) {
                console.warn(`Error extracting time frame from row ${j + 1}:`, timeError);
              }
              
              try {
                if (row.isConnected) {
                  const feeInfoEl = row.querySelector('div.flightDetailsInfoRight p');
                  if (feeInfoEl && feeInfoEl.isConnected) {
                    feeInfo = feeInfoEl.textContent?.trim();
                  }
                }
              } catch (feeError) {
                console.warn(`Error extracting fee info from row ${j + 1}:`, feeError);
              }
              
              // Also try alternative selectors if primary ones failed
              if (!timeFrame || !feeInfo) {
                try {
                  if (row.isConnected) {
                    const allPs = Array.from(row.querySelectorAll('p'));
                    if (allPs.length >= 2) {
                      if (!timeFrame && allPs[0].isConnected) {
                        timeFrame = allPs[0].textContent?.trim();
                      }
                      if (!feeInfo && allPs[1].isConnected) {
                        feeInfo = allPs[1].textContent?.trim();
                      }
                    }
                  }
                } catch (altError) {
                  // Skip this row
                }
              }
        
        if (timeFrame && feeInfo) {
          policies.push({
                  time_frame: timeFrame,
                  fee: feeInfo
          });
              }
            } catch (rowError) {
              console.warn(`Error processing date change policy row ${j + 1} in card ${i + 1}:`, rowError);
              // Continue with next row
        }
      }
      
      if (route && policies.length > 0) {
        dateChangePolicies.push({
          route: route,
          policies: policies
        });
          } else if (policies.length > 0) {
            // Add policies even without route
            dateChangePolicies.push({
              route: 'Unknown',
          policies: policies
        });
          }
          
          // Small delay between cards
          await sleep(200);
        } catch (cardError) {
          console.warn(`Error processing date change card ${i + 1}:`, cardError);
          // Continue with next card
      }
    }
    
    return dateChangePolicies.length > 0 ? dateChangePolicies : null;
    } catch (error) {
      console.error('Error in extractDateChangePolicyFromTab:', error);
      console.error('Error details:', {
        message: error.message,
        name: error.name,
        stack: error.stack
      });
      return null;
    }
  }

  /**
   * Extract detailed flight information from flightDetailsOuter (legacy function for backward compatibility)
   */
  function extractDetailedFlightInfo() {
    const details = {
      detailed_flights: [],
      fare_summary: null,
      cancellation_policy: null,
      date_change_policy: null
    };
    
    const flightDetailsOuter = document.querySelector('div.flightDetailsOuter');
    if (!flightDetailsOuter) {
      return null;
    }
    
    // Extract flight details from FLIGHT DETAILS tab
    const flightDetailsTab = flightDetailsOuter.querySelector('div.splitViewFlightDtl, div[class*="splitViewFlightDtl"]');
    if (flightDetailsTab) {
      const flightDetailsSections = flightDetailsTab.querySelectorAll('div.flightDetails');
      
      flightDetailsSections.forEach((section, index) => {
        const flightDetail = {};
        
        // Extract route header (e.g., "Mumbai to Varanasi , 8 Nov")
        const header = section.querySelector('p.flightDetailsHead');
        if (header) {
          flightDetail.route_header = header.textContent?.trim();
        }
        
        // Extract airline information
        const airlineInfo = section.querySelector('div.flightDetailsRow');
        if (airlineInfo) {
          const airlineHeading = airlineInfo.querySelector('span.airlineHeadng');
          if (airlineHeading) {
            const airlineText = airlineHeading.textContent?.trim();
            // Extract airline name and flight code (e.g., "SpiceJet SG  | 329")
            const airlineMatch = airlineText.match(/([A-Za-z\s]+)\s+([A-Z0-9]{2})\s*\|\s*(\d+)/);
            if (airlineMatch) {
              flightDetail.airline_name = airlineMatch[1].trim();
              flightDetail.airline_code = airlineMatch[2].trim();
              flightDetail.flight_number = airlineMatch[3].trim();
              flightDetail.full_flight_code = `${airlineMatch[2]} ${airlineMatch[3]}`;
            }
          }
          
          // Extract aircraft type
          const aircraftType = airlineInfo.querySelector('span.aircraftType');
          if (aircraftType) {
            flightDetail.aircraft_type = aircraftType.textContent?.trim();
          }
        }
        
        // Extract departure information
        const departureInfo = section.querySelector('div.airlineDTInfoCol:first-of-type');
        if (departureInfo) {
          const depTime = departureInfo.querySelector('p.fontSize18.blackText.blackFont');
          if (depTime) {
            flightDetail.departure_time_detailed = depTime.textContent?.trim();
          }
          
          const depDate = departureInfo.querySelector('p.fontSize12.blackText.boldFont');
          if (depDate) {
            flightDetail.departure_date_detailed = depDate.textContent?.trim();
          }
          
          const depTerminal = departureInfo.querySelector('font[color="#4a4a4a"]');
          if (depTerminal) {
            flightDetail.departure_terminal = depTerminal.textContent?.trim();
          }
          
          const depCity = departureInfo.querySelector('p.fontSize12:last-of-type');
          if (depCity) {
            flightDetail.departure_city_detailed = depCity.textContent?.trim();
          }
        }
        
        // Extract arrival information
        const arrivalInfo = section.querySelector('div.airlineDTInfoCol:last-of-type');
        if (arrivalInfo) {
          const arrTime = arrivalInfo.querySelector('p.fontSize18.blackText.blackFont');
          if (arrTime) {
            flightDetail.arrival_time_detailed = arrTime.textContent?.trim();
          }
          
          const arrDate = arrivalInfo.querySelector('p.fontSize12.blackText.boldFont');
          if (arrDate) {
            flightDetail.arrival_date_detailed = arrDate.textContent?.trim();
          }
          
          const arrTerminal = arrivalInfo.querySelector('font[color="#4a4a4a"]');
          if (arrTerminal) {
            flightDetail.arrival_terminal = arrTerminal.textContent?.trim();
          }
          
          const arrCity = arrivalInfo.querySelector('p.fontSize12:last-of-type');
          if (arrCity) {
            flightDetail.arrival_city_detailed = arrCity.textContent?.trim();
          }
        }
        
        // Extract duration
        const durationEl = section.querySelector('div.airlineDtlDuration');
        if (durationEl) {
          flightDetail.duration_detailed = durationEl.textContent?.trim();
        }
        
        // Extract baggage information
        const baggageInfo = section.querySelector('div.baggageInfo');
        if (baggageInfo) {
          const baggageRows = baggageInfo.querySelectorAll('p.makeFlex.spaceBetween');
          const baggageData = [];
          
          baggageRows.forEach(row => {
            const cells = row.querySelectorAll('span.baggageInfoText');
            if (cells.length >= 3) {
              baggageData.push({
                category: cells[0].textContent?.trim(),
                check_in: cells[1].textContent?.trim(),
                cabin: cells[2].textContent?.trim()
              });
            }
          });
          
          if (baggageData.length > 0) {
            flightDetail.baggage_info = baggageData;
          } else {
            // Check if it says "Information not available"
            const notAvailable = baggageInfo.querySelector('p.redText');
            if (notAvailable) {
              flightDetail.baggage_info = notAvailable.textContent?.trim();
            }
          }
        }
        
        if (Object.keys(flightDetail).length > 0) {
          details.detailed_flights.push(flightDetail);
        }
      });
    }
    
    // COMMENTED OUT: For one-way trips, skip FARE SUMMARY, CANCELLATION, and DATE CHANGE extraction
    // Only extract FLIGHT DETAILS to reduce processing time
    /*
    // Extract fare summary from FARE SUMMARY tab
    const fareSummaryTab = flightDetailsOuter.querySelector('div[id*="tabpane-2"]');
    if (fareSummaryTab) {
      const fareBreakup = {};
      const fareRows = fareSummaryTab.querySelectorAll('p.appendBottom8.fontSize12');
      
      fareRows.forEach(row => {
        const spans = row.querySelectorAll('span.fareBreakupText, span');
        if (spans.length >= 2) {
          const label = spans[0].textContent?.trim();
          const value = spans[1].textContent?.trim();
          if (label && value) {
            fareBreakup[label.toLowerCase().replace(/\s+/g, '_')] = value;
          }
        }
      });
      
      if (Object.keys(fareBreakup).length > 0) {
        details.fare_summary = fareBreakup;
      }
    }
    
    // Extract cancellation policy from CANCELLATION tab
    const cancellationTab = flightDetailsOuter.querySelector('div[id*="tabpane-3"]');
    if (cancellationTab) {
      const cancellationPolicies = [];
      const accordionCards = cancellationTab.querySelectorAll('div.card');
      
      accordionCards.forEach(card => {
        const cardHeader = card.querySelector('div.card-header');
        const route = cardHeader ? cardHeader.textContent?.trim() : null;
        
        const policyRows = card.querySelectorAll('div.DateChangeInfo');
        const policies = [];
        
        policyRows.forEach(row => {
          const timeFrame = row.querySelector('div.flightDetailsInfoLeft p');
          const feeInfo = row.querySelector('div.flightDetailsInfoRight p');
          
          if (timeFrame && feeInfo) {
            policies.push({
              time_frame: timeFrame.textContent?.trim(),
              fee: feeInfo.textContent?.trim()
            });
          }
        });
        
        if (route && policies.length > 0) {
          cancellationPolicies.push({
            route: route,
            policies: policies
          });
        }
      });
      
      if (cancellationPolicies.length > 0) {
        details.cancellation_policy = cancellationPolicies;
      }
    }
    
    // Extract date change policy from DATE CHANGE tab
    const dateChangeTab = flightDetailsOuter.querySelector('div[id*="tabpane-4"]');
    if (dateChangeTab) {
      const dateChangePolicies = [];
      const accordionCards = dateChangeTab.querySelectorAll('div.card');
      
      accordionCards.forEach(card => {
        const cardHeader = card.querySelector('div.card-header');
        const route = cardHeader ? cardHeader.textContent?.trim() : null;
        
        const policyRows = card.querySelectorAll('div.DateChangeInfo');
        const policies = [];
        
        policyRows.forEach(row => {
          const timeFrame = row.querySelector('div.flightDetailsInfoLeft p');
          const feeInfo = row.querySelector('div.flightDetailsInfoRight p');
          
          if (timeFrame && feeInfo) {
            policies.push({
              time_frame: timeFrame.textContent?.trim(),
              fee: feeInfo.textContent?.trim()
            });
          }
        });
        
        if (route && policies.length > 0) {
          dateChangePolicies.push({
            route: route,
            policies: policies
          });
        }
      });
      
      if (dateChangePolicies.length > 0) {
        details.date_change_policy = dateChangePolicies;
      }
    }
    */
    
    return Object.keys(details).length > 0 ? details : null;
  }

  /**
   * Click all "options available" links within a specific pane
   */
  async function clickOptionsAvailableLinksInPane(pane) {
    // Find all flight count links in this pane that contain "options available"
    const selectors = [
      'span.flight-count.fontSize14.pointer[data-test="component-flight-count"]',
      'span[data-test="component-flight-count"]',
      'span.flight-count.fontSize14.pointer',
      'span.flight-count'
    ];
    
    const allLinks = [];
    
    // Try each selector within the pane
    for (const selector of selectors) {
      try {
        const elements = pane.querySelectorAll(selector);
        for (const el of elements) {
          const text = el.textContent?.trim().toLowerCase() || '';
          // Match patterns like "13 options available", "2 options available", etc.
          if (text.includes('options available') || text.includes('option available') || 
              (text.includes('available') && /\d+/.test(text))) {
            // Check if it's inside a group booking card
            const groupCard = el.closest('div.groupBookingCard');
            if (groupCard) {
              allLinks.push({ element: el, text: el.textContent?.trim(), groupCard });
            }
          }
        }
      } catch (e) {
        // Invalid selector, continue
      }
    }
    
    if (allLinks.length === 0) {
      console.log(`⚠ No "X options available" links found in this pane`);
      return;
    }
    
    console.log(`Found ${allLinks.length} "X options available" links in this pane to click`);
    
    // Click each link
    for (let i = 0; i < allLinks.length; i++) {
      const { element, text, groupCard } = allLinks[i];
      
      try {
        console.log(`Clicking link ${i + 1}/${allLinks.length} in pane: "${text}"`);
        
        // Check if the group card is collapsed
        if (groupCard && groupCard.classList.contains('collapsed')) {
          console.log(`  Group card is collapsed, will expand it`);
        }
        
        // Scroll into view
        element.scrollIntoView({ behavior: 'smooth', block: 'center' });
        await sleep(100 * sleepMultiplier);
        
        // Check if visible
        if (!isElementVisible(element)) {
          console.log(`  ⚠ Link ${i + 1} is not visible, skipping...`);
          continue;
        }
        
        // Method 1: Direct click
        try {
          element.click();
          console.log(`  ✓ Clicked link ${i + 1}`);
          await sleep(200 * sleepMultiplier); // Wait for expansion to complete
        } catch (clickError) {
          console.error(`  ✗ Error clicking link ${i + 1}:`, clickError);
          
          // Method 2: MouseEvent
          try {
            const mouseEvent = new MouseEvent('click', {
              bubbles: true,
              cancelable: true,
              view: window,
              detail: 1,
              buttons: 1
            });
            element.dispatchEvent(mouseEvent);
            console.log(`  ✓ Dispatched click event on link ${i + 1}`);
            await sleep(200 * sleepMultiplier);
          } catch (e) {
            console.error(`  ✗ Failed to dispatch click event:`, e);
          }
        }
        
        // Wait between clicks to allow DOM updates
        await sleep(100 * sleepMultiplier);
        
      } catch (error) {
        console.error(`Error processing link ${i + 1}:`, error);
        // Continue with next link
      }
    }
    
    console.log(`✓ Finished clicking ${allLinks.length} "X options available" links in this pane`);
  }

  /**
   * Close the flight details section by clicking the arrow down
   */
  async function closeFlightDetailsSection() {
    // Look for the arrow down button in splitviewStickyOuter
    const stickyOuter = document.querySelector('div.splitviewStickyOuter, div[class*="splitviewSticky"]');
    if (!stickyOuter) {
      return false;
    }
    
    // Find the arrow down element
    const arrowDown = stickyOuter.querySelector('span.customArrow.arrowDown, span[class*="arrowDown"], span.customArrow[class*="arrowDown"]');
    if (arrowDown) {
      try {
        arrowDown.scrollIntoView({ behavior: 'smooth', block: 'center' });
        await sleep(300);
        arrowDown.click();
        console.log('✓ Closed flight details section');
        return true;
      } catch (e) {
        console.error('Error clicking arrow down:', e);
      }
    }
    
    // Fallback: look for collapse button or any close button
    const collapseBtn = stickyOuter.querySelector('button[class*="collapse"], [class*="close"]');
    if (collapseBtn) {
      try {
        collapseBtn.click();
        return true;
      } catch (e) {
        console.error('Error clicking collapse button:', e);
      }
    }
    
    return false;
  }

  /**
   * Extract round trip flights (both outbound and return)
   * ISOLATED: This function ONLY handles DOMESTIC round trips (splitVw structure)
   * DO NOT use this for international round trips (clusterContent structure)
   */
  async function extractRoundTripFlights(startTime, maxFlights) {
    const allFlights = [];
    const seenFlights = new Set(); // Track unique flights to avoid duplicates
    // Note: maxFlights is ignored for round trips - we process ALL cards from both panes
    
    console.log('=== Extract Round Trip Flights (DOMESTIC ONLY - splitVw structure) ===');
    
    // VALIDATION: Check if required elements exist before proceeding
    console.log('Validating DOMESTIC round trip page structure...');
    const validation = validateDomesticTripStructure('round_trip');
    
    if (!validation.valid) {
      const errorMsg = `Validation failed: ${validation.error}`;
      console.error(`✗ ${errorMsg}`);
      const executionTimeMs = Date.now() - startTime;
      const executionTimeSeconds = (executionTimeMs / 1000).toFixed(2);
      return {
        metadata: {
          scraped_at: new Date().toISOString(),
          source_url: window.location.href,
          flights_count: 0,
          user_agent: navigator.userAgent,
          trip_type: 'round_trip',
          execution_time_ms: executionTimeMs,
          execution_time_seconds: parseFloat(executionTimeSeconds),
          execution_time_formatted: `${executionTimeSeconds}s`
        },
        flights: [],
        error: errorMsg
      };
    }
    
    console.log(`✓ Validation passed. Found splitVw with ${validation.elements.panes?.length || 0} panes and ${validation.elements.cards || 0} cards.`);
    
    // Wait a bit for page to fully load
    console.log('Waiting for DOMESTIC round trip page to load...');
    await sleep(2000);
    
    // Use the validated splitView from validation
    const splitView = validation.elements.splitView;
    console.log('Using validated split view container (splitVw - DOMESTIC round trip structure)...');
    // Use validated panes from validation
    let panes = validation.elements.panes;
    
    // If validation didn't provide panes, try to find them
    if (!panes || panes.length === 0) {
      panes = splitView.querySelectorAll('div.paneView');
      if (panes.length === 0) {
        panes = splitView.querySelectorAll('div[class*="paneView"]');
      }
      if (panes.length === 0) {
        panes = splitView.querySelectorAll('div[class*="pane"]');
      }
    }
    
    console.log(`Found ${panes.length} panes for round trip`);
    
    if (panes.length === 0) {
      const errorMsg = 'No panes found in split view after validation';
      console.error(`✗ ${errorMsg}`);
      const executionTimeMs = Date.now() - startTime;
      const executionTimeSeconds = (executionTimeMs / 1000).toFixed(2);
      return {
        metadata: {
          scraped_at: new Date().toISOString(),
          source_url: window.location.href,
          flights_count: 0,
          user_agent: navigator.userAgent,
          trip_type: 'round_trip',
          execution_time_ms: executionTimeMs,
          execution_time_seconds: parseFloat(executionTimeSeconds),
          execution_time_formatted: `${executionTimeSeconds}s`
        },
        flights: [],
        error: errorMsg
      };
    }
    
    // Process each pane
    for (let paneIndex = 0; paneIndex < panes.length; paneIndex++) {
      const pane = panes[paneIndex];
      
      // Extract pane information (route, date)
      const paneTitle = pane.querySelector('p.fontSize16.blackText b, p.fontSize16.blackText.appendLR20.appendBottom20.paddingTop20 b');
      const routeText = paneTitle ? paneTitle.textContent?.trim() : null;
      const paneDate = pane.querySelector('p.fontSize16.blackText.appendLR20.appendBottom20.paddingTop20');
      const dateText = paneDate ? paneDate.textContent?.trim() : null;
      
      console.log(`\n=== Processing Pane ${paneIndex + 1}/${panes.length}: ${routeText} ===`);
      
      // Determine if this is outbound or return
      const isOutbound = paneIndex === 0;
      const direction = isOutbound ? 'outbound' : 'return';
      
      // STEP: Find and click all "options available" links in this pane BEFORE extracting
      console.log(`Looking for "options available" links in ${direction} pane...`);
      await clickOptionsAvailableLinksInPane(pane);
      await sleep(2500); // Wait for expanded options to fully load and render
      
      // STEP 1: Initial card count - scroll through pane to load all cards first
      console.log(`\n=== STEP 1: Counting total cards in ${direction} pane ===`);
      console.log(`Scrolling through ${direction} pane to load all cards...`);
      
      const paneElement = pane;
      if (paneElement) {
        // Scroll to top first
        paneElement.scrollIntoView({ behavior: 'smooth', block: 'start' });
        await sleep(200 * sleepMultiplier);
        paneElement.scrollTop = 0;
        await sleep(200 * sleepMultiplier);
        
        // Scroll to bottom in increments to trigger lazy loading
        const scrollHeight = paneElement.scrollHeight;
        const clientHeight = paneElement.clientHeight;
        const scrollStep = clientHeight * 0.8; // Scroll 80% of viewport at a time
        
        console.log(`Pane scroll height: ${scrollHeight}, client height: ${clientHeight}`);
        
        for (let scrollPos = 0; scrollPos < scrollHeight; scrollPos += scrollStep) {
          paneElement.scrollTop = scrollPos;
          await sleep(800); // Wait for lazy loading
        }
        
        // Final scroll to bottom
        paneElement.scrollTop = scrollHeight;
        await sleep(1500);
        
        // Scroll back to top
        paneElement.scrollTop = 0;
        await sleep(200 * sleepMultiplier);
      }
      
      // STEP 2: Find all flight cards after scrolling
      console.log(`\n=== STEP 2: Finding all cards in ${direction} pane ===`);
      // Cards are structured as: listingCardWrap > div > div > label.splitViewListing > div.listingCard
      let paneCards = null;
      
      // First try: Look for listingCardWrap and search inside (most reliable)
      const listingCardWrap = pane.querySelector('div.listingCardWrap');
      if (listingCardWrap) {
        console.log(`Found listingCardWrap, searching inside...`);
        paneCards = listingCardWrap.querySelectorAll('label.splitViewListing');
        if (paneCards.length === 0) {
          paneCards = listingCardWrap.querySelectorAll('div.listingCard');
        }
      }
      
      // Second try: Direct search in pane for label.splitViewListing
      if (!paneCards || paneCards.length === 0) {
        console.log(`Searching directly in pane for label.splitViewListing...`);
        paneCards = pane.querySelectorAll('label.splitViewListing');
      }
      
      // Third try: Find listingCard directly
      if (!paneCards || paneCards.length === 0) {
        console.log(`No label.splitViewListing found, trying div.listingCard...`);
        paneCards = pane.querySelectorAll('div.listingCard');
      }
      
      // Fourth try: Alternative selectors
      if (!paneCards || paneCards.length === 0) {
        console.log(`No cards found with primary selectors, trying alternatives...`);
        paneCards = pane.querySelectorAll('label[class*="splitView"], label[class*="Listing"], div[class*="listingCard"], div[class*="flightCard"], [id*="flightCard"]');
      }
      
      if (!paneCards || paneCards.length === 0) {
        console.error(`⚠ No cards found in ${direction} pane with any selector!`);
        paneCards = []; // Set to empty array to avoid errors
      }
      
      console.log(`Found ${paneCards.length} potential cards in ${direction} pane`);
      
      // Filter to only actual flight cards (not group placeholders)
      const allActualCards = Array.from(paneCards).filter(card => {
        // Skip group placeholder cards
        if (card.classList.contains('group-placeholder')) {
          return false;
        }
        // Skip if it's inside a collapsed group
        const groupCard = card.closest('div.groupBookingCard');
        if (groupCard && groupCard.classList.contains('collapsed')) {
          return false;
        }
        // Check if card has meaningful content (time or price)
        const text = card.textContent || '';
        const hasTime = /\b([0-1]?[0-9]|2[0-3]):[0-5][0-9]\b/.test(text);
        const hasPrice = /₹|Rs|INR/.test(text);
        if (!hasTime && !hasPrice) {
          return false; // Skip cards without meaningful content
        }
        return true;
      });
      
      // Filter to visible cards
      const visiblePaneCards = allActualCards.filter(card => {
        // Check if element is visible (not hidden by CSS)
        if (!isElementVisible(card)) return false;
        return true;
      });
      
      const totalCardsInPane = visiblePaneCards.length;
      console.log(`\n=== TOTAL CARDS COUNT IN ${direction.toUpperCase()} PANE: ${totalCardsInPane} ===`);
      console.log(`(From ${allActualCards.length} total cards, ${visiblePaneCards.length} are visible)`);
      
      // Store total count for verification later
      const paneTotalCount = totalCardsInPane;
      
      // STEP 3: Process each card and verify all are processed
      console.log(`\n=== STEP 3: Processing all ${paneTotalCount} cards in ${direction} pane ===`);
      const processedCards = new Set(); // Track processed cards to avoid duplicates
      
      for (let cardIndex = 0; cardIndex < visiblePaneCards.length; cardIndex++) {
        const card = visiblePaneCards[cardIndex];
        const globalIndex = allFlights.length;
        
        // Scroll card into view to ensure it's loaded
        try {
          card.scrollIntoView({ behavior: 'smooth', block: 'center' });
          await sleep(300);
        } catch (e) {
          // Continue if scroll fails
        }
        
        // Create unique identifier for this card to track if processed
        const cardId = card.getAttribute('data-test') || 
                      card.getAttribute('id') || 
                      `${cardIndex}-${card.textContent?.substring(0, 50) || 'unknown'}`;
        
        if (processedCards.has(cardId)) {
          console.log(`⚠ Skipping ${direction} card ${cardIndex + 1} - already processed (duplicate)`);
          continue;
        }
        
        processedCards.add(cardId);
        
        console.log(`\n--- Processing ${direction} card ${cardIndex + 1}/${visiblePaneCards.length} (Global: ${globalIndex + 1}) ---`);
        console.log(`Progress: ${cardIndex + 1}/${paneTotalCount} cards processed in ${direction} pane`);
        
        try {
          // Get the actual card element (might be label or div)
          const cardElement = card.classList.contains('splitViewListing') 
            ? card.querySelector('div.listingCard') || card 
            : card;
          
          // Extract basic card details
          const flight = extractFlightFromCard(cardElement, globalIndex);
          
          // Add round trip specific information
          flight.direction = direction;
          flight.is_return_flight = direction === 'return'; // Key to identify return flights
          flight.pane_index = paneIndex;
          flight.route = routeText;
          flight.date = dateText || flight.date; // Use pane date if available, otherwise use extracted date
          
          if (!flight || !isValidFlight(flight)) {
            console.log(`⚠ Skipping ${direction} card ${cardIndex + 1} - invalid flight data`);
            continue;
          }
          
          // Check for duplicates before processing
          if (isDuplicateFlight(flight, seenFlights)) {
            console.log(`⚠ Skipping ${direction} card ${cardIndex + 1} - duplicate flight detected`);
            continue;
          }
          
          console.log(`✓ Extracted ${direction} details: ${flight.airline || 'N/A'} - ${flight.departure_time || 'N/A'} to ${flight.arrival_time || 'N/A'}`);
          
          // Wait a moment after extracting card details
          await sleep(300);
          
          // STEP: Click the card to select it
          console.log(`Clicking ${direction} card ${cardIndex + 1} to select...`);
          try {
            // Scroll card into view
            card.scrollIntoView({ behavior: 'smooth', block: 'center' });
            await sleep(600);
            
            // Click the label/card to select it
            const label = card.classList.contains('splitViewListing') ? card : card.closest('label.splitViewListing');
            if (label) {
              label.click();
              console.log(`✓ Clicked ${direction} card ${cardIndex + 1}`);
            } else {
              card.click();
              console.log(`✓ Clicked ${direction} card ${cardIndex + 1} (direct)`);
            }
            
            // Wait for sticky footer to appear and stabilize
            await sleep(300 * sleepMultiplier);
            
            // STEP: Click "Flight Details" link in sticky footer
            console.log(`Looking for Flight Details link for ${direction} card ${cardIndex + 1}...`);
            const flightDetailsLink = findFlightDetailsLink();
            
            if (flightDetailsLink) {
              try {
                flightDetailsLink.scrollIntoView({ behavior: 'smooth', block: 'center' });
                await sleep(400);
                flightDetailsLink.click();
                console.log(`✓ Clicked Flight Details link for ${direction} card ${cardIndex + 1}`);
                
                // Wait for flight details section to fully load
                await sleep(2500);
                
                // STEP: Extract detailed flight information from ALL tabs
                console.log(`Extracting detailed flight information for ${direction} card ${cardIndex + 1}...`);
                const detailedFlightInfo = await extractDetailedFlightInfoFromAllTabs();
                if (detailedFlightInfo) {
                  // Merge detailed info into flight object
                  Object.assign(flight, detailedFlightInfo);
                  
                  // Ensure flight name and code are extracted from detailed info if missing
                  if (detailedFlightInfo.detailed_flights && detailedFlightInfo.detailed_flights.length > 0) {
                    const firstFlight = detailedFlightInfo.detailed_flights[0];
                    if (firstFlight.segments && firstFlight.segments.length > 0) {
                      const firstSegment = firstFlight.segments[0];
                      // Update flight name and code from detailed info if not already present
                      if (!flight.airline && firstSegment.airline_name) {
                        flight.airline = firstSegment.airline_name;
                      }
                      if (!flight.flight_code && firstSegment.full_flight_code) {
                        flight.flight_code = firstSegment.full_flight_code;
                      }
                      if (!flight.airline_code && firstSegment.airline_code) {
                        flight.airline_code = firstSegment.airline_code;
                      }
                      // Update layover info from detailed info
                      if (firstFlight.layover_info && !flight.layovers) {
                        flight.layovers = firstFlight.layover_info;
                      }
                    }
                  }
                  
                  console.log(`✓ Extracted detailed flight info for ${direction} card ${cardIndex + 1}`);
                } else {
                  console.log(`⚠ No detailed flight info found for ${direction} card ${cardIndex + 1}`);
                }
                
                // STEP: Close the flight details section
                console.log(`Closing flight details for ${direction} card ${cardIndex + 1}...`);
                await closeFlightDetailsSection();
                await sleep(800); // Wait for section to fully close
                
              } catch (linkError) {
                console.error(`✗ Error clicking Flight Details link:`, linkError);
              }
            } else {
              console.log(`⚠ Flight Details link not found for ${direction} card ${cardIndex + 1}`);
            }
          } catch (cardError) {
            console.error(`✗ Error processing ${direction} card ${cardIndex + 1}:`, cardError);
          }
          
          // Add flight to results only if it was successfully extracted and is valid
          // (flight should already be added if it passed validation earlier)
          if (flight && isValidFlight(flight) && !isDuplicateFlight(flight, seenFlights)) {
            // Check if already added (shouldn't happen, but double-check)
            const alreadyAdded = allFlights.some(f => 
              f.departure_time === flight.departure_time && 
              f.arrival_time === flight.arrival_time &&
              f.airline === flight.airline &&
              f.direction === flight.direction
            );
            if (!alreadyAdded) {
          allFlights.push(flight);
              seenFlights.add(`${flight.direction}-${flight.airline}-${flight.departure_time}-${flight.arrival_time}`);
              console.log(`✓ Completed processing ${direction} card ${cardIndex + 1}/${paneTotalCount}`);
            } else {
              console.log(`⚠ Skipping ${direction} card ${cardIndex + 1} - already in results`);
            }
          } else {
            console.log(`⚠ Skipping ${direction} card ${cardIndex + 1} - invalid or duplicate`);
          }
          
          await sleep(100 * sleepMultiplier);
          
        } catch (error) {
          console.error(`✗ Error processing ${direction} card ${cardIndex + 1}:`, error);
          // Continue with next card even if this one fails
        }
      }
      
      // STEP 4: Verify all cards were processed
      console.log(`\n=== STEP 4: Verification for ${direction} pane ===`);
      const processedCount = processedCards.size;
      const expectedCount = paneTotalCount;
      
      if (processedCount === expectedCount) {
        console.log(`✓ SUCCESS: All ${processedCount} cards processed in ${direction} pane`);
      } else {
        console.log(`⚠ WARNING: Expected ${expectedCount} cards but processed ${processedCount} cards in ${direction} pane`);
        console.log(`  Missing ${expectedCount - processedCount} cards`);
        
        // Try to find and process any missed cards
        if (processedCount < expectedCount) {
          console.log(`Attempting to find and process missed cards...`);
          let allCardsNow = Array.from(pane.querySelectorAll('label.splitViewListing'));
          if (allCardsNow.length === 0) {
            allCardsNow = Array.from(pane.querySelectorAll('div.listingCard'));
          }
          if (allCardsNow.length === 0) {
            const listingCardWrap = pane.querySelector('div.listingCardWrap');
            if (listingCardWrap) {
              allCardsNow = Array.from(listingCardWrap.querySelectorAll('label.splitViewListing, div.listingCard'));
            }
          }
          
          allCardsNow = allCardsNow.filter(card => {
              if (card.classList.contains('group-placeholder')) return false;
              const groupCard = card.closest('div.groupBookingCard');
              if (groupCard && groupCard.classList.contains('collapsed')) return false;
              const text = card.textContent || '';
              const hasTime = /\b([0-1]?[0-9]|2[0-3]):[0-5][0-9]\b/.test(text);
              const hasPrice = /₹|Rs|INR/.test(text);
              return (hasTime || hasPrice) && isElementVisible(card);
            });
          
          const missedCards = allCardsNow.filter((card, idx) => {
            const cardId = card.getAttribute('data-test') || 
                          card.getAttribute('id') || 
                          `${idx}-${card.textContent?.substring(0, 50) || 'unknown'}`;
            return !processedCards.has(cardId);
          });
          
          if (missedCards.length > 0) {
            console.log(`Found ${missedCards.length} missed cards, processing them...`);
            // Process missed cards (similar logic as above, but simplified)
            for (let i = 0; i < missedCards.length; i++) {
              const missedCard = missedCards[i];
              try {
                missedCard.scrollIntoView({ behavior: 'smooth', block: 'center' });
                await sleep(300);
                const cardElement = missedCard.classList.contains('splitViewListing') 
                  ? missedCard.querySelector('div.listingCard') || missedCard 
                  : missedCard;
                const flight = extractFlightFromCard(cardElement, allFlights.length);
                flight.direction = direction;
                flight.is_return_flight = direction === 'return';
                flight.pane_index = paneIndex;
                flight.route = routeText;
                flight.date = dateText || flight.date;
                if (flight && isValidFlight(flight) && !isDuplicateFlight(flight, seenFlights)) {
                  allFlights.push(flight);
                  console.log(`✓ Processed missed card ${i + 1}/${missedCards.length}`);
                }
                await sleep(300);
              } catch (e) {
                console.error(`Error processing missed card ${i + 1}:`, e);
              }
            }
          }
        }
      }
      
      console.log(`\n=== Completed ${direction} pane: ${allFlights.filter(f => f.direction === direction).length} flights extracted ===`);
    }
    
    // Calculate execution time
    const endTime = Date.now();
    const executionTimeMs = endTime - startTime;
    const executionTimeSeconds = (executionTimeMs / 1000).toFixed(2);
    const executionTimeMinutes = Math.floor(executionTimeMs / 60000);
    const executionTimeSecondsRemainder = ((executionTimeMs % 60000) / 1000).toFixed(2);
    
    let executionTimeFormatted;
    if (executionTimeMinutes > 0) {
      executionTimeFormatted = `${executionTimeMinutes}m ${executionTimeSecondsRemainder}s`;
    } else {
      executionTimeFormatted = `${executionTimeSeconds}s`;
    }
    
    // Final verification: Count flights by direction
    const outboundFlights = allFlights.filter(f => f.direction === 'outbound');
    const returnFlights = allFlights.filter(f => f.direction === 'return');
    
    console.log(`\n=== FINAL VERIFICATION ===`);
    console.log(`Total flights extracted: ${allFlights.length}`);
    console.log(`Outbound flights: ${outboundFlights.length}`);
    console.log(`Return flights: ${returnFlights.length}`);
    console.log(`Completed extraction of ${allFlights.length} round trip flights in ${executionTimeFormatted}`);
    
    return {
      metadata: {
        scraped_at: new Date().toISOString(),
        source_url: window.location.href,
        flights_count: allFlights.length,
        user_agent: navigator.userAgent,
        trip_type: 'round_trip',
        execution_time_ms: executionTimeMs,
        execution_time_seconds: parseFloat(executionTimeSeconds),
        execution_time_formatted: executionTimeFormatted
      },
      flights: allFlights
    };
  }

  /**
   * Extract international flights (one-way OR round trip) from clusterContent
   * Cards are in <div class="clusterContent"> and each card is <div class="listingCard appendBottom5">
   * ISOLATED: This function ONLY handles INTERNATIONAL trips (clusterContent structure)
   * DO NOT use this for domestic trips (splitVw structure)
   */
  async function extractInternationalFlights(startTime, tripType = null) {
    // Determine trip type if not provided
    if (!tripType) {
      tripType = detectTripTypeFromUI();
    }
    
    // VALIDATION: Check if required elements exist before proceeding
    console.log('Validating INTERNATIONAL trip page structure...');
    const validation = validateInternationalTripStructure();
    
    if (!validation.valid) {
      const errorMsg = `Validation failed: ${validation.error}`;
      console.error(`✗ ${errorMsg}`);
      const executionTimeMs = Date.now() - startTime;
      const executionTimeSeconds = (executionTimeMs / 1000).toFixed(2);
      return {
        metadata: {
          scraped_at: new Date().toISOString(),
          source_url: window.location.href,
          flights_count: 0,
          user_agent: navigator.userAgent,
          trip_type: tripType || 'international',
          execution_time_ms: executionTimeMs,
          execution_time_seconds: parseFloat(executionTimeSeconds),
          execution_time_formatted: `${executionTimeSeconds}s`
        },
        flights: [],
        error: errorMsg
      };
    }
    
    console.log(`✓ Validation passed. Found clusterContent with ${validation.elements.cards?.length || 0} cards.`);
    
    const isRoundTrip = tripType === 'round_trip';
    
    if (isRoundTrip) {
      // Handle international round trip
      return await extractInternationalRoundTripFlights(startTime, validation.elements);
    } else {
      // Handle international one-way trip
      return await extractInternationalOneWayFlights(startTime, validation.elements);
    }
  }

  /**
   * Extract international round trip flights from clusterContent
   * Cards are in <div class="clusterContent"> and each card is <div class="listingCard appendBottom5">
   * ISOLATED: This function ONLY handles INTERNATIONAL round trips (clusterContent structure)
   * DO NOT use this for domestic round trips (splitVw structure) or one-way trips
   */
  async function extractInternationalRoundTripFlights(startTime, validatedElements = null) {
    const allFlights = [];
    const seenFlights = new Set(); // Track unique flights to avoid duplicates
    
    console.log('=== Extract International Round Trip Flights (INTERNATIONAL ONLY - clusterContent structure) ===');
    
    // Wait a bit for page to fully load
    console.log('Waiting for INTERNATIONAL round trip page to load...');
    await sleep(2000);
    
    // Use validated clusterContent if provided, otherwise find it
    let clusterContent = validatedElements?.clusterContent;
    
    if (!clusterContent) {
      console.log('Looking for clusterContent container (INTERNATIONAL round trip structure)...');
      clusterContent = document.querySelector('div.clusterContent');
      if (!clusterContent) {
        console.log('Trying div[class*="clusterContent"]...');
        clusterContent = document.querySelector('div[class*="clusterContent"]');
      }
    } else {
      console.log('Using validated clusterContent container...');
    }
    
    if (!clusterContent) {
      const errorMsg = 'clusterContent not found, cannot extract international round trip flights';
      console.error(`✗ ${errorMsg}`);
      console.error('Tried selectors: div.clusterContent, div[class*="clusterContent"]');
      const executionTimeMs = Date.now() - startTime;
      const executionTimeSeconds = (executionTimeMs / 1000).toFixed(2);
      const executionTimeFormatted = `${executionTimeSeconds}s`;
      return {
        metadata: {
          scraped_at: new Date().toISOString(),
          source_url: window.location.href,
          flights_count: 0,
          user_agent: navigator.userAgent,
          trip_type: 'international_round_trip',
          execution_time_ms: executionTimeMs,
          execution_time_seconds: parseFloat(executionTimeSeconds),
          execution_time_formatted: executionTimeFormatted
        },
        flights: [],
        error: errorMsg
      };
    }
    
    // VALIDATION: Verify cards exist in clusterContent
    console.log('Validating cards exist in clusterContent...');
    let initialCards = clusterContent.querySelectorAll('div.listingCard.appendBottom5, div.listingCard, div[class*="listingCard"]');
    if (initialCards.length === 0) {
      const errorMsg = 'No flight cards found in clusterContent. Please wait for page to load completely.';
      console.error(`✗ ${errorMsg}`);
      const executionTimeMs = Date.now() - startTime;
      const executionTimeSeconds = (executionTimeMs / 1000).toFixed(2);
      return {
        metadata: {
          scraped_at: new Date().toISOString(),
          source_url: window.location.href,
          flights_count: 0,
          user_agent: navigator.userAgent,
          trip_type: 'international_round_trip',
          execution_time_ms: executionTimeMs,
          execution_time_seconds: parseFloat(executionTimeSeconds),
          execution_time_formatted: `${executionTimeSeconds}s`
        },
        flights: [],
        error: errorMsg
      };
    }
    
    console.log(`✓ Found ${initialCards.length} cards in clusterContent. Proceeding with extraction...`);
    
    // STEP 1: Uncheck "Non Stop" filter
    console.log('Ensuring "Non Stop" filter is unchecked...');
    await uncheckNonStopFilter();
    await sleep(1500);
    
    // STEP 2: Click all "options available" links to expand group cards
    console.log('Clicking all "options available" links...');
    await clickAllOptionsAvailableLinks();
    await sleep(2500);
    
    // STEP 3: Click "more flights available" link
    console.log('Clicking "more flights available" link...');
    await clickMoreFlightsLink();
    await sleep(2500);
    
    // STEP 4: Scroll method to load all cards - minimum 50 flights required
    console.log('Starting scroll method to load all flight cards (minimum 50 required)...');
    const minFlightsRequired = 50;
    let scrollAttempts = 0;
    const maxScrollAttempts = 20; // Prevent infinite scrolling
    let previousCardCount = 0;
    let stableCountIterations = 0;
    const requiredStableIterations = 3; // Card count must be stable for 3 iterations
    
    // Helper function to count valid cards
    const countValidCards = () => {
      let cards = clusterContent.querySelectorAll('div.listingCard.appendBottom5');
      if (cards.length === 0) {
        cards = clusterContent.querySelectorAll('div.listingCard');
      }
      if (cards.length === 0) {
        cards = clusterContent.querySelectorAll('div[class*="listingCard"]');
      }
      
      return Array.from(cards).filter(card => {
        if (!isElementVisible(card)) return false;
        const text = card.textContent || '';
        const hasTime = /\b([0-1]?[0-9]|2[0-3]):[0-5][0-9]\b/.test(text);
        const hasPrice = /₹|Rs|INR/.test(text);
        return hasTime || hasPrice;
      }).length;
    };
    
    // Scroll through clusterContent container if it's scrollable
    if (clusterContent && clusterContent.scrollHeight > clusterContent.clientHeight) {
      console.log('ClusterContent is scrollable, scrolling within container...');
      clusterContent.scrollIntoView({ behavior: 'smooth', block: 'start' });
      await sleep(1000);
      
      while (scrollAttempts < maxScrollAttempts) {
        scrollAttempts++;
        const currentCardCount = countValidCards();
        console.log(`Scroll attempt ${scrollAttempts}: Found ${currentCardCount} cards (target: ${minFlightsRequired})`);
        
        // Check if we have enough cards
        if (currentCardCount >= minFlightsRequired) {
          // Check if count is stable (no new cards loading)
          if (currentCardCount === previousCardCount) {
            stableCountIterations++;
            if (stableCountIterations >= requiredStableIterations) {
              console.log(`✓ Card count stable at ${currentCardCount} for ${stableCountIterations} iterations. Enough cards loaded.`);
              break;
            }
          } else {
            stableCountIterations = 0; // Reset if count changed
          }
        }
        
        previousCardCount = currentCardCount;
        
        // Scroll within container
        const scrollHeight = clusterContent.scrollHeight;
        const clientHeight = clusterContent.clientHeight;
        const scrollStep = clientHeight * 0.7; // Scroll 70% of viewport
        
        // Scroll down
        for (let scrollPos = clusterContent.scrollTop; scrollPos < scrollHeight; scrollPos += scrollStep) {
          clusterContent.scrollTop = scrollPos;
          await sleep(600);
          
          // Check card count during scroll
          const countDuringScroll = countValidCards();
          if (countDuringScroll >= minFlightsRequired && countDuringScroll === previousCardCount) {
            stableCountIterations++;
            if (stableCountIterations >= requiredStableIterations) {
              break;
            }
          } else if (countDuringScroll !== previousCardCount) {
            stableCountIterations = 0;
            previousCardCount = countDuringScroll;
          }
        }
        
        // Scroll to bottom
        clusterContent.scrollTop = scrollHeight;
        await sleep(1200);
        
        // Scroll back to top for next iteration
        clusterContent.scrollTop = 0;
        await sleep(200 * sleepMultiplier);
      }
    } else {
      // Container not scrollable, scroll the window instead
      console.log('ClusterContent not scrollable, scrolling window to load cards...');
      clusterContent.scrollIntoView({ behavior: 'smooth', block: 'start' });
      await sleep(1000);
      
      while (scrollAttempts < maxScrollAttempts) {
        scrollAttempts++;
        const currentCardCount = countValidCards();
        console.log(`Scroll attempt ${scrollAttempts}: Found ${currentCardCount} cards (target: ${minFlightsRequired})`);
        
        // Check if we have enough cards
        if (currentCardCount >= minFlightsRequired) {
          if (currentCardCount === previousCardCount) {
            stableCountIterations++;
            if (stableCountIterations >= requiredStableIterations) {
              console.log(`✓ Card count stable at ${currentCardCount} for ${stableCountIterations} iterations. Enough cards loaded.`);
              break;
            }
          } else {
            stableCountIterations = 0;
          }
        }
        
        previousCardCount = currentCardCount;
        
        // Scroll window down
        const windowHeight = window.innerHeight;
        const documentHeight = document.documentElement.scrollHeight;
        const scrollStep = windowHeight * 0.7;
        
        for (let scrollPos = window.pageYOffset; scrollPos < documentHeight; scrollPos += scrollStep) {
          window.scrollTo(0, scrollPos);
          await sleep(600);
          
          // Check card count during scroll
          const countDuringScroll = countValidCards();
          if (countDuringScroll >= minFlightsRequired && countDuringScroll === previousCardCount) {
            stableCountIterations++;
            if (stableCountIterations >= requiredStableIterations) {
              break;
            }
          } else if (countDuringScroll !== previousCardCount) {
            stableCountIterations = 0;
            previousCardCount = countDuringScroll;
          }
        }
        
        // Scroll to bottom
        window.scrollTo(0, documentHeight);
        await sleep(1200);
        
        // Scroll back to top for next iteration
        window.scrollTo(0, 0);
        await sleep(200 * sleepMultiplier);
      }
    }
    
    // Final wait for any remaining lazy loading
    console.log('Final wait for lazy loading to complete...');
    await sleep(2000);
    
    // STEP 5: Find all flight cards in clusterContent
    console.log('Finding all cards in clusterContent after scrolling...');
    let cards = clusterContent.querySelectorAll('div.listingCard.appendBottom5');
    if (cards.length === 0) {
      cards = clusterContent.querySelectorAll('div.listingCard');
    }
    if (cards.length === 0) {
      cards = clusterContent.querySelectorAll('div[class*="listingCard"]');
    }
    
    // Filter to valid, visible cards
    const validCards = Array.from(cards).filter(card => {
      if (!isElementVisible(card)) return false;
      // Check if card has meaningful content
      const text = card.textContent || '';
      const hasTime = /\b([0-1]?[0-9]|2[0-3]):[0-5][0-9]\b/.test(text);
      const hasPrice = /₹|Rs|INR/.test(text);
      return hasTime || hasPrice;
    });
    
    console.log(`✓ Found ${validCards.length} valid cards after scrolling (target was ${minFlightsRequired})`);
    if (validCards.length < minFlightsRequired) {
      console.warn(`⚠ Warning: Only found ${validCards.length} cards, less than target of ${minFlightsRequired}`);
    }
    console.log(`Processing ${validCards.length} cards sequentially...`);
    
    // Process each card one by one (same flow as one-way trips)
    for (let index = 0; index < validCards.length; index++) {
      const card = validCards[index];
      console.log(`\n=== Processing card ${index + 1}/${validCards.length} ===`);
      
      try {
        // STEP 1: Extract basic card details FIRST
        console.log(`Step 1: Extracting basic card details for card ${index + 1}...`);
        const flight = extractFlightFromCard(card, index);
        flight.index = index;
        flight.is_international_round_trip = true;
        
        if (!flight || !isValidFlight(flight)) {
          console.log(`⚠ Skipping card ${index + 1} - invalid flight data`);
          continue;
        }
        
        // Check for duplicates
        if (isDuplicateFlight(flight, seenFlights)) {
          console.log(`⚠ Skipping card ${index + 1} - duplicate flight detected`);
          continue;
        }
        
        console.log(`✓ Extracted basic details: ${flight.airline || 'N/A'} - ${flight.departure_time || 'N/A'} to ${flight.arrival_time || 'N/A'}`);
        await sleep(400);
        
        // STEP 2: Find and click VIEW PRICES button
        console.log(`Step 2: Looking for VIEW PRICES button for card ${index + 1}...`);
        const viewPricesButton = findViewPricesButtonForCard(card);
        
        if (viewPricesButton && isElementVisible(viewPricesButton) && !viewPricesButton.disabled) {
          try {
            // Scroll button into view
            viewPricesButton.scrollIntoView({ behavior: 'smooth', block: 'center' });
            await sleep(100 * sleepMultiplier);
            
            // Click VIEW PRICES button
            viewPricesButton.click();
            console.log(`✓ Clicked VIEW PRICES button for card ${index + 1}`);
            await sleep(1500);
            
            // Wait for popup to appear and fully load
            await sleep(300 * sleepMultiplier);
            let popupVisible = checkIfPopupVisible();
            if (!popupVisible) {
              await sleep(300 * sleepMultiplier);
              popupVisible = checkIfPopupVisible();
            }
            
            if (popupVisible) {
              console.log(`✓ Popup is visible for card ${index + 1}`);
              await waitForLoadingToComplete(4000);
              await sleep(1500);
            } else {
              console.log(`⚠ Popup may not be fully loaded for card ${index + 1}, continuing anyway...`);
              await sleep(300 * sleepMultiplier);
            }
            
            // STEP 3: Extract fare options from popup
            console.log(`Step 3: Extracting fare options from popup for card ${index + 1}...`);
            const fareDetails = await extractFareDetailsFromPopup(card);
            if (fareDetails) {
              flight.fare_options = fareDetails;
              const totalFares = fareDetails.fare_classes?.reduce((sum, fc) => sum + (fc.fares?.length || 0), 0) || 0;
              console.log(`✓ Extracted fare details for card ${index + 1} (${fareDetails.fare_classes?.length || 0} fare classes, ${totalFares} total fare options)`);
            } else {
              console.log(`⚠ No fare details found for card ${index + 1}`);
            }
            
            await sleep(100 * sleepMultiplier);
            
            // STEP 4: Close the popup
            console.log(`Step 4: Closing popup for card ${index + 1}...`);
            const popupClosed = await closePopupIfOpen();
            if (popupClosed) {
              console.log(`✓ Popup closed for card ${index + 1}`);
            } else {
              console.log(`⚠ Popup may not have closed for card ${index + 1}`);
            }
            
            await sleep(200 * sleepMultiplier);
            
            // Verify popup is actually closed
            const popupStillVisible = checkIfPopupVisible();
            if (popupStillVisible) {
              console.log(`⚠ Popup still visible, waiting longer...`);
              await sleep(1500);
              await closePopupIfOpen();
              await sleep(200 * sleepMultiplier);
            }
            
            await sleep(1500);
          } catch (popupError) {
            console.error(`✗ Error processing popup for card ${index + 1}:`, popupError);
            // Try to close popup if it's still open
            try {
              await closePopupIfOpen();
              await sleep(100 * sleepMultiplier);
            } catch (closeError) {
              // Ignore close errors
            }
          }
        } else {
          console.log(`⚠ No VIEW PRICES button found for card ${index + 1}, skipping popup extraction`);
        }
        
        // STEP 5: Find and click View Flight Details link
        console.log(`Step 5: Looking for View Flight Details link for card ${index + 1}...`);
        const viewFlightDetailsLink = findViewFlightDetailsLinkForCard(card);
        
        if (viewFlightDetailsLink && isElementVisible(viewFlightDetailsLink)) {
          try {
            // Scroll link into view
            viewFlightDetailsLink.scrollIntoView({ behavior: 'smooth', block: 'center' });
            await sleep(100 * sleepMultiplier);
            
            // Click View Flight Details link
            viewFlightDetailsLink.click();
            console.log(`✓ Clicked View Flight Details link for card ${index + 1}`);
            await sleep(1500);
            
            // Wait for flight details panel to appear
            await waitForFlightDetailsOuter(5000);
            await sleep(200 * sleepMultiplier);
            
            // STEP 6: Extract detailed flight info from all tabs
            console.log(`Step 6: Extracting detailed flight info for card ${index + 1}...`);
            const detailedFlightInfo = await extractDetailedFlightInfoFromAllTabs();
            if (detailedFlightInfo) {
              // Merge detailed info into flight object
              if (detailedFlightInfo.detailed_flights && detailedFlightInfo.detailed_flights.length > 0) {
                flight.detailed_flights = detailedFlightInfo.detailed_flights;
              }
              if (detailedFlightInfo.fare_summary) {
                flight.fare_summary = detailedFlightInfo.fare_summary;
              }
              if (detailedFlightInfo.cancellation_policy) {
                flight.cancellation_policy = detailedFlightInfo.cancellation_policy;
              }
              if (detailedFlightInfo.date_change_policy) {
                flight.date_change_policy = detailedFlightInfo.date_change_policy;
              }
              console.log(`✓ Extracted detailed flight info for card ${index + 1}`);
            }
            
            // STEP 7: Close flight details panel
            console.log(`Step 7: Closing flight details panel for card ${index + 1}...`);
            const hideFlightDetailsLink = findHideFlightDetailsLink();
            if (hideFlightDetailsLink) {
              hideFlightDetailsLink.click();
              await sleep(200 * sleepMultiplier);
              console.log(`✓ Closed flight details panel for card ${index + 1}`);
            }
          } catch (detailsError) {
            console.error(`✗ Error processing flight details for card ${index + 1}:`, detailsError);
            // Try to close panel if it's still open
            try {
              const hideFlightDetailsLink = findHideFlightDetailsLink();
              if (hideFlightDetailsLink) {
                hideFlightDetailsLink.click();
                await sleep(100 * sleepMultiplier);
              }
            } catch (closeError) {
              // Ignore close errors
            }
          }
        } else {
          console.log(`⚠ No View Flight Details link found for card ${index + 1}, skipping details extraction`);
        }
        
        // Add flight to results
        allFlights.push(flight);
        seenFlights.add(`${flight.airline}_${flight.departure_time}_${flight.arrival_time}_${flight.price}`);
        
        console.log(`✓ Completed processing card ${index + 1}/${validCards.length}`);
        
        // Small delay between cards
        await sleep(100 * sleepMultiplier);
      } catch (cardError) {
        console.error(`✗ Error processing card ${index + 1}:`, cardError);
        // Continue with next card
        await sleep(100 * sleepMultiplier);
      }
    }
    
    // Calculate execution time
    const executionTimeMs = Date.now() - startTime;
    const executionTimeSeconds = (executionTimeMs / 1000).toFixed(2);
    const executionTimeFormatted = `${executionTimeSeconds}s`;
    
    console.log(`\n=== Extraction Complete ===`);
    console.log(`Total flights extracted: ${allFlights.length}`);
    console.log(`Execution time: ${executionTimeFormatted}`);
    
    return {
      metadata: {
        scraped_at: new Date().toISOString(),
        source_url: window.location.href,
        flights_count: allFlights.length,
        user_agent: navigator.userAgent,
        trip_type: 'international_round_trip',
        execution_time_ms: executionTimeMs,
        execution_time_seconds: parseFloat(executionTimeSeconds),
        execution_time_formatted: executionTimeFormatted
      },
      flights: allFlights
    };
  }

  /**
   * Extract international one-way flights from clusterContent
   * Cards are in <div class="clusterContent"> and each card is <div class="listingCard appendBottom5">
   * ISOLATED: This function ONLY handles INTERNATIONAL one-way trips (clusterContent structure)
   * DO NOT use this for domestic one-way trips
   */
  async function extractInternationalOneWayFlights(startTime, validatedElements = null) {
    const allFlights = [];
    const seenFlights = new Set(); // Track unique flights to avoid duplicates
    
    console.log('=== Extract International One-Way Flights (INTERNATIONAL ONLY - clusterContent structure) ===');
    
    // Wait a bit for page to fully load
    console.log('Waiting for international one-way trip page to load...');
    await sleep(2000);
    
    // Use validated clusterContent if provided, otherwise find it
    let clusterContent = validatedElements?.clusterContent;
    
    if (!clusterContent) {
      console.log('Looking for clusterContent container (INTERNATIONAL one-way trip structure)...');
      clusterContent = document.querySelector('div.clusterContent');
      if (!clusterContent) {
        console.log('Trying div[class*="clusterContent"]...');
        clusterContent = document.querySelector('div[class*="clusterContent"]');
      }
    } else {
      console.log('Using validated clusterContent container...');
    }
    
    if (!clusterContent) {
      const errorMsg = 'clusterContent not found, cannot extract international one-way flights';
      console.error(`✗ ${errorMsg}`);
      console.error('Tried selectors: div.clusterContent, div[class*="clusterContent"]');
      const executionTimeMs = Date.now() - startTime;
      const executionTimeSeconds = (executionTimeMs / 1000).toFixed(2);
      const executionTimeFormatted = `${executionTimeSeconds}s`;
      return {
        metadata: {
          scraped_at: new Date().toISOString(),
          source_url: window.location.href,
          flights_count: 0,
          user_agent: navigator.userAgent,
          trip_type: 'international_one_way',
          execution_time_ms: executionTimeMs,
          execution_time_seconds: parseFloat(executionTimeSeconds),
          execution_time_formatted: executionTimeFormatted
        },
        flights: [],
        error: errorMsg
      };
    }
    
    // VALIDATION: Verify cards exist in clusterContent
    console.log('Validating cards exist in clusterContent...');
    let initialCards = clusterContent.querySelectorAll('div.listingCard.appendBottom5, div.listingCard, div[class*="listingCard"]');
    if (initialCards.length === 0) {
      const errorMsg = 'No flight cards found in clusterContent. Please wait for page to load completely.';
      console.error(`✗ ${errorMsg}`);
      const executionTimeMs = Date.now() - startTime;
      const executionTimeSeconds = (executionTimeMs / 1000).toFixed(2);
      return {
        metadata: {
          scraped_at: new Date().toISOString(),
          source_url: window.location.href,
          flights_count: 0,
          user_agent: navigator.userAgent,
          trip_type: 'international_one_way',
          execution_time_ms: executionTimeMs,
          execution_time_seconds: parseFloat(executionTimeSeconds),
          execution_time_formatted: `${executionTimeSeconds}s`
        },
        flights: [],
        error: errorMsg
      };
    }
    
    console.log(`✓ Found ${initialCards.length} cards in clusterContent. Proceeding with extraction...`);
    
    // STEP 1: Uncheck "Non Stop" filter
    console.log('Ensuring "Non Stop" filter is unchecked...');
    await uncheckNonStopFilter();
    await sleep(1500);
    
    // STEP 2: Click all "options available" links to expand group cards
    console.log('Clicking all "options available" links...');
    await clickAllOptionsAvailableLinks();
    await sleep(2500);
    
    // STEP 3: Click "more flights available" link
    console.log('Clicking "more flights available" link...');
    await clickMoreFlightsLink();
    await sleep(2500);
    
    // STEP 4: Scroll method to load all cards - minimum 50 flights required
    console.log('Starting scroll method to load all flight cards (minimum 50 required)...');
    const minFlightsRequired = 50;
    let scrollAttempts = 0;
    const maxScrollAttempts = 20;
    let previousCardCount = 0;
    let stableCountIterations = 0;
    const requiredStableIterations = 3;
    
    // Helper function to count valid cards
    const countValidCards = () => {
      let cards = clusterContent.querySelectorAll('div.listingCard.appendBottom5');
      if (cards.length === 0) {
        cards = clusterContent.querySelectorAll('div.listingCard');
      }
      if (cards.length === 0) {
        cards = clusterContent.querySelectorAll('div[class*="listingCard"]');
      }
      
      return Array.from(cards).filter(card => {
        if (!isElementVisible(card)) return false;
        const text = card.textContent || '';
        const hasTime = /\b([0-1]?[0-9]|2[0-3]):[0-5][0-9]\b/.test(text);
        const hasPrice = /₹|Rs|INR/.test(text);
        return hasTime || hasPrice;
      }).length;
    };
    
    // Scroll through clusterContent container if it's scrollable
    if (clusterContent && clusterContent.scrollHeight > clusterContent.clientHeight) {
      console.log('ClusterContent is scrollable, scrolling within container...');
      clusterContent.scrollIntoView({ behavior: 'smooth', block: 'start' });
      await sleep(1000);
      
      while (scrollAttempts < maxScrollAttempts) {
        scrollAttempts++;
        const currentCardCount = countValidCards();
        console.log(`Scroll attempt ${scrollAttempts}: Found ${currentCardCount} cards (target: ${minFlightsRequired})`);
        
        if (currentCardCount >= minFlightsRequired) {
          if (currentCardCount === previousCardCount) {
            stableCountIterations++;
            if (stableCountIterations >= requiredStableIterations) {
              console.log(`✓ Card count stable at ${currentCardCount} for ${stableCountIterations} iterations. Enough cards loaded.`);
              break;
            }
          } else {
            stableCountIterations = 0;
          }
        }
        
        previousCardCount = currentCardCount;
        
        const scrollHeight = clusterContent.scrollHeight;
        const clientHeight = clusterContent.clientHeight;
        const scrollStep = clientHeight * 0.7;
        
        for (let scrollPos = clusterContent.scrollTop; scrollPos < scrollHeight; scrollPos += scrollStep) {
          clusterContent.scrollTop = scrollPos;
          await sleep(600);
          
          const countDuringScroll = countValidCards();
          if (countDuringScroll >= minFlightsRequired && countDuringScroll === previousCardCount) {
            stableCountIterations++;
            if (stableCountIterations >= requiredStableIterations) {
              break;
            }
          } else if (countDuringScroll !== previousCardCount) {
            stableCountIterations = 0;
            previousCardCount = countDuringScroll;
          }
        }
        
        clusterContent.scrollTop = scrollHeight;
        await sleep(1200);
        clusterContent.scrollTop = 0;
        await sleep(200 * sleepMultiplier);
      }
    } else {
      // Container not scrollable, scroll the window instead
      console.log('ClusterContent not scrollable, scrolling window to load cards...');
      clusterContent.scrollIntoView({ behavior: 'smooth', block: 'start' });
      await sleep(1000);
      
      while (scrollAttempts < maxScrollAttempts) {
        scrollAttempts++;
        const currentCardCount = countValidCards();
        console.log(`Scroll attempt ${scrollAttempts}: Found ${currentCardCount} cards (target: ${minFlightsRequired})`);
        
        if (currentCardCount >= minFlightsRequired) {
          if (currentCardCount === previousCardCount) {
            stableCountIterations++;
            if (stableCountIterations >= requiredStableIterations) {
              console.log(`✓ Card count stable at ${currentCardCount} for ${stableCountIterations} iterations. Enough cards loaded.`);
              break;
            }
          } else {
            stableCountIterations = 0;
          }
        }
        
        previousCardCount = currentCardCount;
        
        const windowHeight = window.innerHeight;
        const documentHeight = document.documentElement.scrollHeight;
        const scrollStep = windowHeight * 0.7;
        
        for (let scrollPos = window.pageYOffset; scrollPos < documentHeight; scrollPos += scrollStep) {
          window.scrollTo(0, scrollPos);
          await sleep(600);
          
          const countDuringScroll = countValidCards();
          if (countDuringScroll >= minFlightsRequired && countDuringScroll === previousCardCount) {
            stableCountIterations++;
            if (stableCountIterations >= requiredStableIterations) {
              break;
            }
          } else if (countDuringScroll !== previousCardCount) {
            stableCountIterations = 0;
            previousCardCount = countDuringScroll;
          }
        }
        
        window.scrollTo(0, documentHeight);
        await sleep(1200);
        window.scrollTo(0, 0);
        await sleep(200 * sleepMultiplier);
      }
    }
    
    // Final wait for any remaining lazy loading
    console.log('Final wait for lazy loading to complete...');
    await sleep(2000);
    
    // STEP 5: Find all flight cards in clusterContent
    console.log('Finding all cards in clusterContent after scrolling...');
    let cards = clusterContent.querySelectorAll('div.listingCard.appendBottom5');
    if (cards.length === 0) {
      cards = clusterContent.querySelectorAll('div.listingCard');
    }
    if (cards.length === 0) {
      cards = clusterContent.querySelectorAll('div[class*="listingCard"]');
    }
    
    // Filter to valid, visible cards
    const validCards = Array.from(cards).filter(card => {
      if (!isElementVisible(card)) return false;
      const text = card.textContent || '';
      const hasTime = /\b([0-1]?[0-9]|2[0-3]):[0-5][0-9]\b/.test(text);
      const hasPrice = /₹|Rs|INR/.test(text);
      return hasTime || hasPrice;
    });
    
    console.log(`✓ Found ${validCards.length} valid cards after scrolling (target was ${minFlightsRequired})`);
    if (validCards.length < minFlightsRequired) {
      console.warn(`⚠ Warning: Only found ${validCards.length} cards, less than target of ${minFlightsRequired}`);
    }
    console.log(`Processing ${validCards.length} cards sequentially...`);
    
    // Process each card one by one (same flow as international round trip)
    for (let index = 0; index < validCards.length; index++) {
      const card = validCards[index];
      console.log(`\n=== Processing card ${index + 1}/${validCards.length} ===`);
      
      try {
        // STEP 1: Extract basic card details FIRST
        console.log(`Step 1: Extracting basic card details for card ${index + 1}...`);
        const flight = extractFlightFromCard(card, index);
        flight.index = index;
        flight.is_international = true;
        flight.is_international_one_way = true;
        
        if (!flight || !isValidFlight(flight)) {
          console.log(`⚠ Skipping card ${index + 1} - invalid flight data`);
          continue;
        }
        
        // Check for duplicates
        if (isDuplicateFlight(flight, seenFlights)) {
          console.log(`⚠ Skipping card ${index + 1} - duplicate flight detected`);
          continue;
        }
        
        console.log(`✓ Extracted basic details: ${flight.airline || 'N/A'} - ${flight.departure_time || 'N/A'} to ${flight.arrival_time || 'N/A'}`);
        await sleep(400);
        
        // STEP 2: Find and click VIEW PRICES button
        console.log(`Step 2: Looking for VIEW PRICES button for card ${index + 1}...`);
        const viewPricesButton = findViewPricesButtonForCard(card);
        
        if (viewPricesButton && isElementVisible(viewPricesButton) && !viewPricesButton.disabled) {
          try {
            viewPricesButton.scrollIntoView({ behavior: 'smooth', block: 'center' });
            await sleep(100 * sleepMultiplier);
            viewPricesButton.click();
            console.log(`✓ Clicked VIEW PRICES button for card ${index + 1}`);
            await sleep(1500);
            
            await sleep(300 * sleepMultiplier);
            let popupVisible = checkIfPopupVisible();
            if (!popupVisible) {
              await sleep(300 * sleepMultiplier);
              popupVisible = checkIfPopupVisible();
            }
            
            if (popupVisible) {
              console.log(`✓ Popup is visible for card ${index + 1}`);
              await waitForLoadingToComplete(4000);
              await sleep(1500);
            } else {
              console.log(`⚠ Popup may not be fully loaded for card ${index + 1}, continuing anyway...`);
              await sleep(300 * sleepMultiplier);
            }
            
            // STEP 3: Extract fare options from popup
            console.log(`Step 3: Extracting fare options from popup for card ${index + 1}...`);
            const fareDetails = await extractFareDetailsFromPopup(card);
            if (fareDetails) {
              flight.fare_options = fareDetails;
              const totalFares = fareDetails.fare_classes?.reduce((sum, fc) => sum + (fc.fares?.length || 0), 0) || 0;
              console.log(`✓ Extracted fare details for card ${index + 1} (${fareDetails.fare_classes?.length || 0} fare classes, ${totalFares} total fare options)`);
            } else {
              console.log(`⚠ No fare details found for card ${index + 1}`);
            }
            
            await sleep(100 * sleepMultiplier);
            
            // STEP 4: Close the popup
            console.log(`Step 4: Closing popup for card ${index + 1}...`);
            const popupClosed = await closePopupIfOpen();
            if (popupClosed) {
              console.log(`✓ Popup closed for card ${index + 1}`);
            } else {
              console.log(`⚠ Popup may not have closed for card ${index + 1}`);
            }
            
            await sleep(200 * sleepMultiplier);
            
            const popupStillVisible = checkIfPopupVisible();
            if (popupStillVisible) {
              console.log(`⚠ Popup still visible, waiting longer...`);
              await sleep(1500);
              await closePopupIfOpen();
              await sleep(200 * sleepMultiplier);
            }
            
            await sleep(1500);
          } catch (popupError) {
            console.error(`✗ Error processing popup for card ${index + 1}:`, popupError);
            try {
              await closePopupIfOpen();
              await sleep(100 * sleepMultiplier);
            } catch (closeError) {
              // Ignore close errors
            }
          }
        } else {
          console.log(`⚠ No VIEW PRICES button found for card ${index + 1}, skipping popup extraction`);
        }
        
        // STEP 5: Find and click View Flight Details link
        console.log(`Step 5: Looking for View Flight Details link for card ${index + 1}...`);
        const viewFlightDetailsLink = findViewFlightDetailsLinkForCard(card);
        
        if (viewFlightDetailsLink && isElementVisible(viewFlightDetailsLink)) {
          try {
            viewFlightDetailsLink.scrollIntoView({ behavior: 'smooth', block: 'center' });
            await sleep(100 * sleepMultiplier);
            viewFlightDetailsLink.click();
            console.log(`✓ Clicked View Flight Details link for card ${index + 1}`);
            await sleep(1500);
            
            await waitForFlightDetailsOuter(5000);
            await sleep(200 * sleepMultiplier);
            
            // STEP 6: Extract detailed flight info from all tabs
            console.log(`Step 6: Extracting detailed flight info for card ${index + 1}...`);
            const detailedFlightInfo = await extractDetailedFlightInfoFromAllTabs();
            if (detailedFlightInfo) {
              if (detailedFlightInfo.detailed_flights && detailedFlightInfo.detailed_flights.length > 0) {
                flight.detailed_flights = detailedFlightInfo.detailed_flights;
              }
              if (detailedFlightInfo.fare_summary) {
                flight.fare_summary = detailedFlightInfo.fare_summary;
              }
              if (detailedFlightInfo.cancellation_policy) {
                flight.cancellation_policy = detailedFlightInfo.cancellation_policy;
              }
              if (detailedFlightInfo.date_change_policy) {
                flight.date_change_policy = detailedFlightInfo.date_change_policy;
              }
              console.log(`✓ Extracted detailed flight info for card ${index + 1}`);
            }
            
            // STEP 7: Close flight details panel
            console.log(`Step 7: Closing flight details panel for card ${index + 1}...`);
            const hideFlightDetailsLink = findHideFlightDetailsLink();
            if (hideFlightDetailsLink) {
              hideFlightDetailsLink.click();
              await sleep(200 * sleepMultiplier);
              console.log(`✓ Closed flight details panel for card ${index + 1}`);
            }
          } catch (detailsError) {
            console.error(`✗ Error processing flight details for card ${index + 1}:`, detailsError);
            try {
              const hideFlightDetailsLink = findHideFlightDetailsLink();
              if (hideFlightDetailsLink) {
                hideFlightDetailsLink.click();
                await sleep(100 * sleepMultiplier);
              }
            } catch (closeError) {
              // Ignore close errors
            }
          }
        } else {
          console.log(`⚠ No View Flight Details link found for card ${index + 1}, skipping details extraction`);
        }
        
        allFlights.push(flight);
        seenFlights.add(`${flight.airline}_${flight.departure_time}_${flight.arrival_time}_${flight.price}`);
        
        console.log(`✓ Completed processing card ${index + 1}/${validCards.length}`);
        await sleep(100 * sleepMultiplier);
      } catch (cardError) {
        console.error(`✗ Error processing card ${index + 1}:`, cardError);
        await sleep(100 * sleepMultiplier);
      }
    }
    
    // Calculate execution time
    const executionTimeMs = Date.now() - startTime;
    const executionTimeSeconds = (executionTimeMs / 1000).toFixed(2);
    const executionTimeFormatted = `${executionTimeSeconds}s`;
    
    console.log(`\n=== Extraction Complete ===`);
    console.log(`Total flights extracted: ${allFlights.length}`);
    console.log(`Execution time: ${executionTimeFormatted}`);
    
    return {
      metadata: {
        scraped_at: new Date().toISOString(),
        source_url: window.location.href,
        flights_count: allFlights.length,
        user_agent: navigator.userAgent,
        trip_type: 'international_one_way',
        execution_time_ms: executionTimeMs,
        execution_time_seconds: parseFloat(executionTimeSeconds),
        execution_time_formatted: executionTimeFormatted
      },
      flights: allFlights
    };
  }

  /**
   * Find flight cards using primary selectors
   * MakeMyTrip specific selectors with common patterns
   */
  function findFlightCards() {
    const selectors = [
      // MakeMyTrip specific - primary selector
      'div.listingCard',
      'div[class*="listingCard"]',
      // MakeMyTrip alternative
      '[data-test="component-clusterBody-OW"]',
      '[data-test="component-clusterBody-RT"]',
      // Generic patterns
      '[class*="flightCard"]',
      '[class*="FlightCard"]',
      '[class*="flight-card"]',
      '[data-testid*="flight"]',
      '[data-cy*="flight"]',
      // Common container patterns
      'div[class*="flight"]:not([class*="icon"]):not([class*="logo"])',
      'section[class*="flight"]',
      'article[class*="flight"]'
    ];

    for (const selector of selectors) {
      try {
        const elements = document.querySelectorAll(selector);
        if (elements.length > 0) {
          console.log(`Found ${elements.length} elements with selector: ${selector}`);
          return elements;
        }
      } catch (e) {
        // Invalid selector, continue
      }
    }

    return [];
  }

  /**
   * Fallback strategy for finding flight cards
   */
  function findFlightCardsFallback() {
    // Look for elements containing time patterns (HH:MM)
    const timePattern = /\b([0-1]?[0-9]|2[0-3]):[0-5][0-9]\b/;
    const allDivs = document.querySelectorAll('div');
    const candidates = [];

    allDivs.forEach(div => {
      const text = div.textContent || '';
      if (timePattern.test(text) && text.includes('₹') || text.includes('Rs')) {
        // Likely a flight card
        candidates.push(div);
      }
    });

    return candidates;
  }

  /**
   * Extract flight data from a single card element
   */
  function extractFlightFromCard(card, index) {
    const flight = {
      index: index,
      airline: extractAirline(card),
      airline_code: extractAirlineCode(card),
      flight_code: extractFlightCode(card),
      departure_time: extractDepartureTime(card),
      departure_date: extractDepartureDate(card),
      departure_city: extractDepartureCity(card),
      arrival_time: extractArrivalTime(card),
      arrival_date: extractArrivalDate(card),
      arrival_city: extractArrivalCity(card),
      date: extractDate(card),
      layovers: extractLayovers(card),
      layover_cities: extractLayoverCities(card),
      stopover_count: extractStops(card),
      stopover_time: extractStopoverTime(card),
      stops: extractStops(card), // Keep for backward compatibility
      duration: extractDuration(card),
      price: extractPrice(card),
      offers: extractOffers(card),
      coupon_details: extractCouponDetails(card),
      fare_options: extractFareOptions(card),
      raw_text: extractRawText(card),
      html_snippet: extractHtmlSnippet(card)
    };

    return flight;
  }

  /**
   * Extract airline code (2-letter IATA code like "AI", "6E", "IX")
   */
  function extractAirlineCode(card) {
    // Look for airline code in flight code (e.g., "AI 2838" -> "AI")
    const flightCode = extractFlightCode(card);
    if (flightCode) {
      const codeMatch = flightCode.match(/^([A-Z0-9]{2})\s/);
      if (codeMatch) {
        return codeMatch[1];
      }
    }
    
    // Try to find in airline logo data attributes or alt text
    const airlineLogo = card.querySelector('span[data-test="component-airlineIcon"], span.arln-logo, span[class*="airlineIcon"]');
    if (airlineLogo) {
      const style = airlineLogo.getAttribute('style') || '';
      const urlMatch = style.match(/icons\/([A-Z0-9]{2})\./i);
      if (urlMatch) {
        return urlMatch[1].toUpperCase();
      }
    }
    
    // Try to extract from airline name (common patterns)
    const airlineName = extractAirline(card);
    if (airlineName) {
      const codeMap = {
        'air india': 'AI',
        'air india express': 'IX',
        'indigo': '6E',
        'spicejet': 'SG',
        'vistara': 'UK',
        'goair': 'G8',
        'airasia': 'I5'
      };
      const lowerName = airlineName.toLowerCase();
      for (const [name, code] of Object.entries(codeMap)) {
        if (lowerName.includes(name)) {
          return code;
        }
      }
    }
    
    return null;
  }

  /**
   * Extract flight code (e.g., "AI 2838", "IX 1621")
   */
  function extractFlightCode(card) {
    // MakeMyTrip specific: flight code in p.fliCode
    const flightCodeEl = card.querySelector('p.fliCode');
    if (flightCodeEl) {
      const code = flightCodeEl.textContent?.trim();
      if (code && code.length > 0) {
        return code;
      }
    }
    
    // Try in airline-info-wrapper
    const airlineWrapper = card.querySelector('.airline-info-wrapper, [class*="airline-info"]');
    if (airlineWrapper) {
      const codeEl = airlineWrapper.querySelector('p.fliCode');
      if (codeEl) {
        const code = codeEl.textContent?.trim();
        if (code && code.length > 0) {
          return code;
        }
      }
    }
    
    // Try to find in span elements with flight code patterns
    const allSpans = card.querySelectorAll('span');
    for (const span of allSpans) {
      const text = span.textContent?.trim() || '';
      const codePattern = /\b([A-Z0-9]{2})\s+(\d{3,4})\b/;
      const match = text.match(codePattern);
      if (match) {
        return `${match[1]} ${match[2]}`;
      }
    }
    
    // Try to extract from airline name element (sometimes contains flight code)
    const airlineNameEl = card.querySelector('p.airlineName, p[data-test="component-airlineHeading"]');
    if (airlineNameEl) {
      const text = airlineNameEl.textContent || '';
      const codePattern = /\b([A-Z0-9]{2})\s+(\d{3,4})\b/;
      const match = text.match(codePattern);
      if (match) {
        return `${match[1]} ${match[2]}`;
      }
    }
    
    // Pattern match: Look for "XX 1234" pattern in entire card text
    const text = card.textContent || '';
    const codePattern = /\b([A-Z0-9]{2})\s+(\d{3,4})\b/;
    const match = text.match(codePattern);
    if (match) {
      return `${match[1]} ${match[2]}`;
    }
    
    // Try alternative pattern: "XX1234" (no space)
    const codePatternNoSpace = /\b([A-Z0-9]{2})(\d{3,4})\b/;
    const matchNoSpace = text.match(codePatternNoSpace);
    if (matchNoSpace) {
      return `${matchNoSpace[1]} ${matchNoSpace[2]}`;
    }
    
    return null;
  }

  /**
   * Extract airline name
   */
  function extractAirline(card) {
    // MakeMyTrip specific selectors - try multiple variations
    const selectors = [
      'p.airlineName',
      'p[data-test="component-airlineHeading"]',
      'p.boldFont.blackText.airlineName',
      '.airlineName',
      '[data-test="component-airlineHeading"]'
    ];
    
    for (const selector of selectors) {
      const airlineNameEl = card.querySelector(selector);
      if (airlineNameEl) {
        const airlineName = airlineNameEl.textContent?.trim();
        if (airlineName && airlineName.length > 0) {
          // Also try to get flight code
          const flightCodeEl = card.querySelector('p.fliCode');
          const flightCode = flightCodeEl?.textContent?.trim();
          if (flightCode) {
            return `${airlineName} (${flightCode})`;
          }
          return airlineName;
        }
      }
    }

    // Try searching within airline-info-wrapper
    const airlineWrapper = card.querySelector('.airline-info-wrapper, [class*="airline-info"]');
    if (airlineWrapper) {
      const airlineNameEl = airlineWrapper.querySelector('p.boldFont.blackText, p.airlineName');
      if (airlineNameEl) {
        const airlineName = airlineNameEl.textContent?.trim();
        if (airlineName) {
          const flightCodeEl = airlineWrapper.querySelector('p.fliCode');
          const flightCode = flightCodeEl?.textContent?.trim();
          return flightCode ? `${airlineName} (${flightCode})` : airlineName;
        }
      }
    }

    // Fallback selectors
    const fallbackSelectors = [
      '[class*="airline"]',
      '[class*="Airline"]',
      '[data-testid*="airline"]',
      'img[alt*="airline"]',
      'img[alt*="Airline"]',
      '[aria-label*="airline"]',
      '[title*="airline"]'
    ];

    for (const selector of fallbackSelectors) {
      const element = card.querySelector(selector);
      if (element) {
        const text = element.textContent?.trim() || 
                    element.getAttribute('alt') || 
                    element.getAttribute('title') || 
                    element.getAttribute('aria-label');
        if (text && text.length < 100 && text.length > 0) {
          return text;
        }
      }
    }

    // Regex fallback: Look for common airline patterns in card text
    const text = card.textContent || '';
    const airlinePatterns = [
      /(IndiGo|Air India|SpiceJet|Vistara|GoAir|AirAsia|Jet Airways|Kingfisher|Air India Express)/i,
      /([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)\s+(?:Airlines|Airways|Air|Express)/i
    ];

    for (const pattern of airlinePatterns) {
      const match = text.match(pattern);
      if (match && match[1]) {
        return match[1];
      }
    }

    return null;
  }

  /**
   * Extract departure time
   */
  function extractDepartureTime(card) {
    // MakeMyTrip specific: timeInfoLeft contains departure
    const timeInfoLeft = card.querySelector('div.timeInfoLeft');
    if (timeInfoLeft) {
      const timeEl = timeInfoLeft.querySelector('p.flightTimeInfo span, p.appendBottom2.flightTimeInfo span');
      if (timeEl) {
        const time = timeEl.textContent?.trim();
        if (time && /^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/.test(time)) {
          return time;
        }
      }
    }

    // Fallback selectors
    const timePattern = /\b([0-1]?[0-9]|2[0-3]):[0-5][0-9]\b/;
    const selectors = [
      '[class*="departure"]',
      '[class*="Departure"]',
      '[data-testid*="departure"]',
      '[class*="depTime"]',
      '[class*="dep-time"]'
    ];

    for (const selector of selectors) {
      const element = card.querySelector(selector);
      if (element) {
        const text = element.textContent || '';
        const match = text.match(timePattern);
        if (match) return match[0];
      }
    }

    // Fallback: Find first time pattern in card
    const text = card.textContent || '';
    const matches = text.match(timePattern);
    if (matches) {
      return matches[0];
    }

    return null;
  }

  /**
   * Extract arrival time
   */
  function extractArrivalTime(card) {
    // MakeMyTrip specific: timeInfoRight contains arrival
    const timeInfoRight = card.querySelector('div.timeInfoRight');
    if (timeInfoRight) {
      const timeEl = timeInfoRight.querySelector('p.flightTimeInfo span, p.appendBottom2.flightTimeInfo span');
      if (timeEl) {
        const time = timeEl.textContent?.trim();
        if (time && /^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/.test(time)) {
          return time;
        }
      }
    }

    // Fallback selectors
    const timePattern = /\b([0-1]?[0-9]|2[0-3]):[0-5][0-9]\b/;
    const selectors = [
      '[class*="arrival"]',
      '[class*="Arrival"]',
      '[data-testid*="arrival"]',
      '[class*="arrTime"]',
      '[class*="arr-time"]'
    ];

    for (const selector of selectors) {
      const element = card.querySelector(selector);
      if (element) {
        const text = element.textContent || '';
        const match = text.match(timePattern);
        if (match) return match[0];
      }
    }

    // Fallback: Find second time pattern (usually arrival)
    const text = card.textContent || '';
    const matches = text.match(new RegExp(timePattern.source, 'g'));
    if (matches && matches.length > 1) {
      return matches[1];
    }

    return null;
  }

  /**
   * Extract departure city
   */
  function extractDepartureCity(card) {
    // MakeMyTrip specific: city in timeInfoLeft
    const timeInfoLeft = card.querySelector('div.timeInfoLeft');
    if (timeInfoLeft) {
      const cityEl = timeInfoLeft.querySelector('p.blackText font[color="#000000"], p.blackText');
      if (cityEl) {
        const city = cityEl.textContent?.trim();
        if (city && city.length < 50) {
          return city;
        }
      }
    }

    return null;
  }

  /**
   * Extract arrival city
   */
  function extractArrivalCity(card) {
    // MakeMyTrip specific: city in timeInfoRight
    const timeInfoRight = card.querySelector('div.timeInfoRight');
    if (timeInfoRight) {
      const cityEl = timeInfoRight.querySelector('p.blackText font[color="#000000"], p.blackText b font[color="#000000"], p.blackText b');
      if (cityEl) {
        const city = cityEl.textContent?.trim();
        if (city && city.length < 50) {
          return city;
        }
      }
    }

    return null;
  }

  /**
   * Extract departure date
   */
  function extractDepartureDate(card) {
    // MakeMyTrip specific: date near departure time
    const timeInfoLeft = card.querySelector('div.timeInfoLeft');
    if (timeInfoLeft) {
      // Look for date in fontSize12 elements near departure time
      const dateEl = timeInfoLeft.querySelector('p.fontSize12, span.fontSize12');
      if (dateEl) {
        const text = dateEl.textContent?.trim();
        const datePatterns = [
          /\b(\d{1,2}[-\/]\d{1,2}[-\/]\d{2,4})\b/,
          /\b(\d{1,2}\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{2,4})\b/i,
          /\b((Mon|Tue|Wed|Thu|Fri|Sat|Sun)[a-z]*\s+\d{1,2}\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*)\b/i,
          /\b(\d{1,2}\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*)\b/i
        ];
        for (const pattern of datePatterns) {
          const match = text.match(pattern);
          if (match && match[0]) {
            return match[0].trim();
          }
        }
      }
    }
    
    // Fallback: use general date extraction but prioritize departure area
    return extractDate(card);
  }

  /**
   * Extract arrival date
   */
  function extractArrivalDate(card) {
    // MakeMyTrip specific: date near arrival time
    const timeInfoRight = card.querySelector('div.timeInfoRight');
    if (timeInfoRight) {
      // Look for date in fontSize12 elements near arrival time
      const dateEl = timeInfoRight.querySelector('p.fontSize12, span.fontSize12');
      if (dateEl) {
        const text = dateEl.textContent?.trim();
        const datePatterns = [
          /\b(\d{1,2}[-\/]\d{1,2}[-\/]\d{2,4})\b/,
          /\b(\d{1,2}\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{2,4})\b/i,
          /\b((Mon|Tue|Wed|Thu|Fri|Sat|Sun)[a-z]*\s+\d{1,2}\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*)\b/i,
          /\b(\d{1,2}\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*)\b/i
        ];
        for (const pattern of datePatterns) {
          const match = text.match(pattern);
          if (match && match[0]) {
            return match[0].trim();
          }
        }
      }
    }
    
    // Fallback: use general date extraction
    return extractDate(card);
  }

  /**
   * Extract date
   */
  function extractDate(card) {
    const datePatterns = [
      /\b(\d{1,2}[-\/]\d{1,2}[-\/]\d{2,4})\b/,
      /\b(\d{1,2}\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{2,4})\b/i,
      /\b((Mon|Tue|Wed|Thu|Fri|Sat|Sun)[a-z]*\s+\d{1,2}\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*)\b/i,
      /\b(\d{1,2}\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*)\b/i, // Just day and month
      /\b((Mon|Tue|Wed|Thu|Fri|Sat|Sun)[a-z]*\s+\d{1,2})\b/i // Day of week and day
    ];

    const selectors = [
      'p[class*="date"]',
      'span[class*="date"]',
      'div[class*="date"]',
      '[class*="Date"]',
      '[data-testid*="date"]',
      'p.fontSize12', // Common date container
      'span.fontSize12' // Common date container
    ];

    // Try selectors first
    for (const selector of selectors) {
      const elements = card.querySelectorAll(selector);
      for (const element of elements) {
        const text = element.textContent || '';
        for (const pattern of datePatterns) {
          const match = text.match(pattern);
          if (match && match[0]) {
            return match[0].trim();
          }
        }
      }
    }

    // Try to find date in time elements (often near departure/arrival times)
    const timeElements = card.querySelectorAll('p.fontSize18, p.fontSize16, span.fontSize18, span.fontSize16');
    for (const timeEl of timeElements) {
      const parent = timeEl.parentElement;
      if (parent) {
        const parentText = parent.textContent || '';
        for (const pattern of datePatterns) {
          const match = parentText.match(pattern);
          if (match && match[0]) {
            return match[0].trim();
          }
        }
      }
    }

    // Fallback: Search entire card
    const text = card.textContent || '';
    for (const pattern of datePatterns) {
      const match = text.match(pattern);
      if (match && match[0]) {
        return match[0].trim();
      }
    }

    return null;
  }

  /**
   * Extract layover information
   */
  function extractLayovers(card) {
    const layoverPatterns = [
      /(\d+)\s*(?:hr|hour|h)\s*(\d+)?\s*(?:min|m)?\s*(?:layover|stop|stops)/i,
      /(?:layover|stop).*?(\d+)\s*(?:hr|hour|h)/i,
      /(?:via|through)\s+([A-Z]{3})/i
    ];

    const text = card.textContent || '';
    const layovers = [];

    for (const pattern of layoverPatterns) {
      const match = text.match(pattern);
      if (match) {
        layovers.push(match[0]);
      }
    }

    // Also check for airport codes (3-letter codes)
    const airportCodePattern = /\b([A-Z]{3})\b/g;
    const codes = text.match(airportCodePattern);
    if (codes && codes.length > 2) {
      // Middle codes are likely layover airports
      layovers.push(...codes.slice(1, -1));
    }

    return layovers.length > 0 ? layovers : null;
  }

  /**
   * Extract layover cities (e.g., ["Bengaluru", "Mumbai"])
   */
  function extractLayoverCities(card) {
    const cities = [];
    
    // MakeMyTrip specific: layover info in flightsLayoverInfo
    const layoverInfo = card.querySelector('p.flightsLayoverInfo');
    if (layoverInfo) {
      const text = layoverInfo.textContent || '';
      // Pattern: "1 stop via Bengaluru" or "1 stop via Mumbai, Delhi"
      const viaMatch = text.match(/via\s+([A-Za-z\s,]+)/i);
      if (viaMatch) {
        const viaText = viaMatch[1].trim();
        // Split by comma if multiple cities
        const cityList = viaText.split(',').map(c => c.trim()).filter(c => c.length > 0);
        cities.push(...cityList);
      }
    }
    
    // Also check in stop-info div
    const stopInfo = card.querySelector('div.stop-info');
    if (stopInfo) {
      const text = stopInfo.textContent || '';
      const viaMatch = text.match(/via\s+([A-Za-z\s,]+)/i);
      if (viaMatch) {
        const viaText = viaMatch[1].trim();
        const cityList = viaText.split(',').map(c => c.trim()).filter(c => c.length > 0);
        cities.push(...cityList);
      }
    }
    
    // Pattern match in full text
    const cardText = card.textContent || '';
    const viaPattern = /via\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*(?:\s*,\s*[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)*)/g;
    let match;
    while ((match = viaPattern.exec(cardText)) !== null) {
      const cityText = match[1].trim();
      const cityList = cityText.split(',').map(c => c.trim()).filter(c => c.length > 0);
      cities.push(...cityList);
    }
    
    return cities.length > 0 ? cities : null;
  }

  /**
   * Extract stopover time/duration (time spent at layover airports, NOT total flight duration)
   */
  function extractStopoverTime(card) {
    // First, check if there are any stops - if no stops, stopover time is null
    const stops = extractStops(card);
    if (!stops || stops === 0) {
      return null; // No stops means no stopover time
    }
    
    // Get total duration first to ensure we never return the same value
    const totalDuration = extractDuration(card);
    const totalDurationStr = totalDuration || '';
    
    // Look for layover duration in specific layover elements
    // MakeMyTrip shows layover time in flightLayoverOuter or similar elements
    const layoverOuters = card.querySelectorAll('div.flightLayoverOuter, div.mmtConnectLayover, div[class*="layover"], div[class*="Layover"]');
    if (layoverOuters.length > 0) {
      let totalStopoverMinutes = 0;
      let foundLayoverTime = false;
      
      layoverOuters.forEach(layoverOuter => {
        const layoverText = layoverOuter.textContent || '';
        // Look for patterns like "2h 30m layover" or "2 hr 30 min" or just time in layover context
        const layoverMatch = layoverText.match(/(\d+)\s*(?:h|hr|hour)\s*(\d+)?\s*(?:m|min|minute)?/i);
        if (layoverMatch) {
          const hours = parseInt(layoverMatch[1], 10);
          const minutes = layoverMatch[2] ? parseInt(layoverMatch[2], 10) : 0;
          const layoverTimeStr = `${hours}h ${minutes}m`;
          
          // CRITICAL: Make sure this is NOT the same as total duration
          if (layoverTimeStr !== totalDurationStr) {
            totalStopoverMinutes += (hours * 60) + minutes;
            foundLayoverTime = true;
          }
        }
      });
      
      if (foundLayoverTime && totalStopoverMinutes > 0) {
        const totalHours = Math.floor(totalStopoverMinutes / 60);
        const totalMins = totalStopoverMinutes % 60;
        const result = `${totalHours}h ${totalMins}m`;
        
        // Double-check: never return the same as duration
        if (result !== totalDurationStr) {
          return result;
        }
      }
    }
    
    // Look for stopover time in layover info text
    const layoverInfo = card.querySelector('p.flightsLayoverInfo, div[class*="layoverInfo"], div[class*="LayoverInfo"]');
    if (layoverInfo) {
      const text = layoverInfo.textContent || '';
      // Look for explicit layover/stopover time mentions
      // Pattern: "2h 30m layover" or "layover: 2h 30m" or "stop: 2h" or "via DEL 2h 30m"
      const layoverTimePatterns = [
        /(?:layover|stop|stopover|via).*?(\d+)\s*(?:h|hr|hour)\s*(\d+)?\s*(?:m|min|minute)/i,
        /(\d+)\s*(?:h|hr|hour)\s*(\d+)?\s*(?:m|min|minute).*?(?:layover|stop|stopover|via)/i,
        /via\s+\w+\s+(\d+)\s*(?:h|hr|hour)\s*(\d+)?\s*(?:m|min|minute)/i
      ];
      
      for (const pattern of layoverTimePatterns) {
        const match = text.match(pattern);
        if (match) {
          const hours = parseInt(match[1], 10);
          const minutes = match[2] ? parseInt(match[2], 10) : 0;
          // Only return if it's a reasonable stopover time (less than 12 hours and not same as duration)
          if (hours < 12) {
            const result = `${hours}h ${minutes}m`;
            // CRITICAL: Never return the same as duration
            if (result !== totalDurationStr) {
              return result;
            }
          }
        }
      }
    }
    
    // Calculate stopover time using departure and arrival times if available
    const departureTime = extractDepartureTime(card);
    const arrivalTime = extractArrivalTime(card);
    
    if (departureTime && arrivalTime && totalDuration) {
      // Parse times (format: "HH:MM")
      const depMatch = departureTime.match(/(\d{1,2}):(\d{2})/);
      const arrMatch = arrivalTime.match(/(\d{1,2}):(\d{2})/);
      
      if (depMatch && arrMatch) {
        const depHours = parseInt(depMatch[1], 10);
        const depMins = parseInt(depMatch[2], 10);
        const arrHours = parseInt(arrMatch[1], 10);
        const arrMins = parseInt(arrMatch[2], 10);
        
        // Calculate time difference (handling day rollover)
        let totalMins = (arrHours * 60 + arrMins) - (depHours * 60 + depMins);
        if (totalMins < 0) {
          totalMins += 24 * 60; // Next day
        }
        
        // Parse total duration (format: "9h 25m" or "9h25m" or "9 h 25 m")
        const durMatch = totalDuration.match(/(\d+)\s*(?:h|hr|hour)\s*(\d+)?\s*(?:m|min|minute)?/i);
        if (durMatch) {
          const durHours = parseInt(durMatch[1], 10);
          const durMins = durMatch[2] ? parseInt(durMatch[2], 10) : 0;
          const totalDurationMins = (durHours * 60) + durMins;
          
          // If time difference is significantly more than flight duration, 
          // the difference is likely stopover time
          if (totalMins > totalDurationMins) {
            const stopoverMins = totalMins - totalDurationMins;
            const stopoverHours = Math.floor(stopoverMins / 60);
            const stopoverMinsRem = stopoverMins % 60;
            
            // Only return if reasonable (less than 12 hours)
            if (stopoverHours < 12) {
              const result = `${stopoverHours}h ${stopoverMinsRem}m`;
              // CRITICAL: Never return the same as duration
              if (result !== totalDurationStr) {
                return result;
              }
            }
          }
        }
      }
    }
    
    // If we can't determine stopover time, return null (NEVER return duration)
    // This ensures duration and stopover_time are always different
    return null;
  }

  /**
   * Extract number of stops
   */
  function extractStops(card) {
    // MakeMyTrip specific: stops info in flightsLayoverInfo
    const layoverInfo = card.querySelector('p.flightsLayoverInfo');
    if (layoverInfo) {
      const text = layoverInfo.textContent?.trim().toLowerCase();
      if (text) {
        if (text.includes('non stop') || text.includes('nonstop') || text.includes('direct')) {
          return 0;
        }
        // Check for number of stops
        const stopMatch = text.match(/(\d+)\s*(?:stop|stops)/i);
        if (stopMatch) {
          return parseInt(stopMatch[1], 10);
        }
        // If it says "via" but no number, it's likely 1 stop
        if (text.includes('via')) {
          return 1;
        }
      }
    }

    // Fallback patterns
    const stopPatterns = [
      /(non-stop|direct|nonstop)/i,
      /(\d+)\s*(?:stop|stops)/i,
      /(?:stop|stops):\s*(\d+)/i
    ];

    const text = card.textContent || '';
    
    // Check for non-stop first
    if (/non-stop|direct|nonstop/i.test(text)) {
      return 0;
    }

    for (const pattern of stopPatterns) {
      const match = text.match(pattern);
      if (match && match[1]) {
        return parseInt(match[1], 10);
      }
    }

    // Infer from layover cities count
    const layoverCities = extractLayoverCities(card);
    if (layoverCities && layoverCities.length > 0) {
      return layoverCities.length;
    }

    // Infer from layover count
    const layovers = extractLayovers(card);
    if (layovers && layovers.length > 0) {
      return layovers.length;
    }

    return null;
  }

  /**
   * Extract flight duration
   */
  function extractDuration(card) {
    // MakeMyTrip specific: duration is in stop-info div
    const stopInfo = card.querySelector('div.stop-info');
    if (stopInfo) {
      const durationText = stopInfo.querySelector('p')?.textContent?.trim();
      if (durationText) {
        // Format: "02 h 40 m" or "2h 40m"
        const match = durationText.match(/(\d+)\s*(?:h|hr|hour)\s*(\d+)?\s*(?:m|min|minute)?/i);
        if (match) {
          const hours = parseInt(match[1], 10);
          const minutes = match[2] ? parseInt(match[2], 10) : 0;
          return `${hours}h ${minutes}m`;
        }
        // If it's already formatted, return as is
        if (durationText.includes('h') || durationText.includes('hr')) {
          return durationText;
        }
      }
    }

    // Fallback selectors
    const durationPatterns = [
      /(\d+)\s*(?:hr|hour|h)\s*(?:(\d+)\s*(?:min|m))?/i,
      /(\d+):(\d+)\s*(?:hr|hour|h)/i,
      /(?:duration|time):\s*(\d+)\s*(?:hr|hour|h)/i
    ];

    const selectors = [
      '[class*="duration"]',
      '[class*="Duration"]',
      '[data-testid*="duration"]'
    ];

    for (const selector of selectors) {
      const element = card.querySelector(selector);
      if (element) {
        const text = element.textContent || '';
        for (const pattern of durationPatterns) {
          const match = text.match(pattern);
          if (match) {
            const hours = parseInt(match[1], 10);
            const minutes = match[2] ? parseInt(match[2], 10) : 0;
            return `${hours}h ${minutes}m`;
          }
        }
      }
    }

    return null;
  }

  /**
   * Extract price
   */
  function extractPrice(card) {
    // MakeMyTrip specific: price in clusterViewPrice - try multiple selectors
    const priceSelectors = [
      'div.clusterViewPrice span.fontSize18.blackFont',
      'span[data-test="component-fare"]',
      'div.clusterViewPrice span.fontSize18',
      'div.priceSection span.fontSize18',
      '[data-test="component-fare"]',
      'div.clusterViewPrice'
    ];
    
    for (const selector of priceSelectors) {
      const priceEl = card.querySelector(selector);
      if (priceEl) {
        const priceText = priceEl.textContent?.trim();
        if (priceText) {
          // Extract price with ₹ symbol - look for full price pattern
          const priceMatch = priceText.match(/[₹Rs]?\s*(\d{1,3}(?:[,\s]\d{2,3})*)/);
          if (priceMatch && priceMatch[0].length > 1) { // Make sure it's not just a single digit
            const extractedPrice = priceMatch[0].trim();
            // Validate it's a reasonable price (at least 3 digits)
            if (extractedPrice.replace(/[₹Rs,\s]/g, '').length >= 3) {
              return extractedPrice;
            }
          }
        }
      }
    }
    
    // Try to find price in priceSection
    const priceSection = card.querySelector('div.priceSection, [class*="priceSection"]');
    if (priceSection) {
      const priceText = priceSection.textContent || '';
      const priceMatch = priceText.match(/[₹Rs]?\s*(\d{1,3}(?:[,\s]\d{2,3})*)/);
      if (priceMatch && priceMatch[0].length > 1) {
        const extractedPrice = priceMatch[0].trim();
        if (extractedPrice.replace(/[₹Rs,\s]/g, '').length >= 3) {
          return extractedPrice;
        }
      }
    }

    // Fallback selectors
    const pricePatterns = [
      /[₹Rs]?\s*(\d{1,3}(?:[,\s]\d{2,3})*)/,
      /(\d{1,3}(?:[,\s]\d{2,3})*)\s*(?:INR|₹|Rs)/i
    ];

    const selectors = [
      '[class*="price"]',
      '[class*="Price"]',
      '[data-testid*="price"]',
      '[class*="fare"]',
      '[class*="amount"]',
      '[data-test="component-fare"]'
    ];

    for (const selector of selectors) {
      const element = card.querySelector(selector);
      if (element) {
        const text = element.textContent || '';
        for (const pattern of pricePatterns) {
          const match = text.match(pattern);
          if (match) {
            return match[0].trim();
          }
        }
      }
    }

    // Fallback: Find all price patterns and take the largest (usually the main price)
    const text = card.textContent || '';
    const prices = [];
    for (const pattern of pricePatterns) {
      const matches = text.match(new RegExp(pattern.source, 'g'));
      if (matches) {
        prices.push(...matches);
      }
    }

    if (prices.length > 0) {
      // Return the largest number (main price)
      const numericPrices = prices.map(p => {
        const num = p.replace(/[₹Rs,\s]/g, '');
        return parseInt(num, 10);
      }).filter(n => !isNaN(n));
      
      if (numericPrices.length > 0) {
        const maxPrice = Math.max(...numericPrices);
        return `₹${maxPrice.toLocaleString('en-IN')}`;
      }
    }

    return null;
  }

  /**
   * Extract coupon details (promotional codes, discount offers)
   */
  function extractCouponDetails(card) {
    const coupons = [];
    
    // MakeMyTrip specific: coupon codes in alert messages
    const alertMsg = card.querySelector('p.alertMsg, div.alertMsg, [class*="alertMsg"]');
    if (alertMsg) {
      const text = alertMsg.textContent || '';
      // Pattern: "FLAT ₹ 310 OFF using MMTSUPER" or "Code: MMTHDFCCC"
      const codePatterns = [
        /(?:code|using|use)\s*:?\s*([A-Z0-9]{6,})/gi,
        /([A-Z]{2,}\d{2,}[A-Z]{2,})/g, // Pattern like MMTSUPER, MMTHDFCCC
        /([A-Z]{3,}\d{2,})/g // Pattern like MMT310
      ];
      
      for (const pattern of codePatterns) {
        let match;
        while ((match = pattern.exec(text)) !== null) {
          const code = match[1] || match[0];
          if (code && code.length >= 4) {
            coupons.push({
              code: code,
              description: text.trim()
            });
          }
        }
      }
    }
    
    // Check in specialFarePersuasionWrapper
    const persuasionWrapper = card.querySelector('div.specialFarePersuasionWrapper, [class*="specialFarePersuasion"]');
    if (persuasionWrapper) {
      const text = persuasionWrapper.textContent || '';
      const codeMatch = text.match(/(?:code|using|use)\s*:?\s*([A-Z0-9]{6,})/i);
      if (codeMatch) {
        coupons.push({
          code: codeMatch[1],
          description: text.trim()
        });
      }
    }
    
    // Check in bottomPersuasions (from popup)
    const bottomPersuasions = card.querySelector('div.bottomPersuasions, [class*="bottomPersuasions"]');
    if (bottomPersuasions) {
      const text = bottomPersuasions.textContent || '';
      const codeMatch = text.match(/(?:code|using|use)\s*:?\s*([A-Z0-9]{6,})/i);
      if (codeMatch) {
        coupons.push({
          code: codeMatch[1],
          description: text.trim()
        });
      }
    }
    
    // Remove duplicates
    const uniqueCoupons = [];
    const seenCodes = new Set();
    for (const coupon of coupons) {
      if (!seenCodes.has(coupon.code)) {
        seenCodes.add(coupon.code);
        uniqueCoupons.push(coupon);
      }
    }
    
    return uniqueCoupons.length > 0 ? uniqueCoupons : null;
  }

  /**
   * Extract offers/promotions
   */
  function extractOffers(card) {
    const offers = [];

    // MakeMyTrip specific: multiple offer locations
    // 1. Special fare persuasion at top
    const specialFareEls = card.querySelectorAll('span.specialFarePersuasion, span[data-testid]');
    specialFareEls.forEach(el => {
      const text = el.textContent?.trim();
      if (text && (text.includes('%') || text.includes('off') || text.includes('OFF'))) {
        offers.push(text);
      }
    });

    // 2. Alert messages (promotional offers)
    const alertMsg = card.querySelector('p.alertMsg');
    if (alertMsg) {
      const alertText = alertMsg.textContent?.trim();
      if (alertText) {
        // Split by | to get individual offers
        const individualOffers = alertText.split('|').map(o => o.trim()).filter(o => o);
        offers.push(...individualOffers);
      }
    }

    // 3. Lock price persuasion
    const lockPriceEl = card.querySelector('span[data-test="component-lockPricePersuasionText"]');
    if (lockPriceEl) {
      const lockText = lockPriceEl.textContent?.trim();
      if (lockText) {
        offers.push(lockText);
      }
    }

    // Fallback: generic offer selectors
    const offerKeywords = ['offer', 'discount', 'promo', 'cashback', 'coupon', 'deal', 'save', 'off'];
    const selectors = [
      '[class*="offer"]',
      '[class*="Offer"]',
      '[class*="promo"]',
      '[class*="discount"]',
      '[class*="deal"]',
      '[class*="badge"]'
    ];

    for (const selector of selectors) {
      const elements = card.querySelectorAll(selector);
      elements.forEach(el => {
        const text = el.textContent?.trim() || '';
        if (text && offerKeywords.some(keyword => text.toLowerCase().includes(keyword))) {
          if (!offers.includes(text)) {
            offers.push(text);
          }
        }
      });
    }

    return offers.length > 0 ? offers : null;
  }

  /**
   * Extract fare options from the popup modal
   */
  function extractFareOptions(card) {
    // Find all visible popups that contain fare data
    const allPopups = document.querySelectorAll('div.wdth100, div.journeyContent');
    
    // Try to find popup associated with this specific card
    // Look for popup that contains the same route information
    const cardRoute = extractRouteFromCard(card);
    
    for (const popup of allPopups) {
      if (!isElementVisible(popup)) continue;
      
      // Check if popup contains route info matching the card
      const popupRoute = extractRouteFromPopup(popup);
      if (cardRoute && popupRoute && 
          (cardRoute.departure === popupRoute.departure || 
           cardRoute.arrival === popupRoute.arrival)) {
        return extractFareOptionsFromPopup(popup);
      }
    }
    
    // Fallback: if only one popup is visible, use it
    const visiblePopups = Array.from(allPopups).filter(p => isElementVisible(p));
    if (visiblePopups.length === 1) {
      return extractFareOptionsFromPopup(visiblePopups[0]);
    }
    
    // If multiple popups, try to find the one closest to this card
    if (visiblePopups.length > 0) {
      // Get card position
      const cardRect = card.getBoundingClientRect();
      let closestPopup = null;
      let minDistance = Infinity;
      
      visiblePopups.forEach(popup => {
        const popupRect = popup.getBoundingClientRect();
        const distance = Math.abs(cardRect.top - popupRect.top);
        if (distance < minDistance) {
          minDistance = distance;
          closestPopup = popup;
        }
      });
      
      if (closestPopup) {
        return extractFareOptionsFromPopup(closestPopup);
      }
    }
    
    return null;
  }

  /**
   * Extract route info from card for matching
   */
  function extractRouteFromCard(card) {
    const depCity = extractDepartureCity(card);
    const arrCity = extractArrivalCity(card);
    return depCity && arrCity ? { departure: depCity, arrival: arrCity } : null;
  }

  /**
   * Extract route info from popup for matching
   */
  function extractRouteFromPopup(popup) {
    const routeText = popup.querySelector('span.boldFont.fontSize16')?.textContent;
    if (routeText && routeText.includes('→')) {
      const parts = routeText.split('→').map(s => s.trim());
      if (parts.length === 2) {
        return { departure: parts[0], arrival: parts[1] };
      }
    }
    return null;
  }

  /**
   * Extract fare options from popup element
   */
  function extractFareOptionsFromPopup(popup) {
    const result = {
      route: null,
      airline_info: null,
      date_time: null,
      fare_classes: []
    };

    // Extract route information from popup header
    const routeEl = popup.querySelector('span.boldFont.fontSize16');
    if (routeEl) {
      result.route = routeEl.textContent?.trim();
    }

    // Extract airline and date/time info
    const airlineInfoEl = popup.querySelector('span.mediumBoldFont');
    if (airlineInfoEl) {
      result.airline_info = airlineInfoEl.textContent?.trim();
    }

    // Extract class tabs (Economy, Business Class)
    const classTabs = popup.querySelectorAll('div.legListTab');
    
    if (classTabs.length > 0) {
      // Extract fare cards for each class tab
      classTabs.forEach((tab, tabIndex) => {
        const className = tab.querySelector('span.legListTabTitle')?.textContent?.trim() || `Class ${tabIndex + 1}`;
        const startingPrice = tab.querySelector('span.legListSubtitle')?.textContent?.trim() || null;
        const classDescription = tab.querySelector('span.fontSize12.boldFont.darkText')?.textContent?.trim() || null;

        // Find all fare cards - they're in the journeyContent section
        // For active tab, get all visible fare cards
        const journeyContent = popup.querySelector('div.journeyContent');
        const fareCards = journeyContent ? 
          journeyContent.querySelectorAll('div.fareFamilyCardWrapper, div.keen-slider__slide.fareFamilyCardWrapper') : 
          popup.querySelectorAll('div.fareFamilyCardWrapper, div.keen-slider__slide');
        
        const fares = [];
        const seenFares = new Set(); // Track unique fares to avoid duplicates
        fareCards.forEach((fareCard) => {
          // Only extract visible fare cards
          if (isElementVisible(fareCard)) {
            const fare = extractFareCardDetails(fareCard);
            if (fare) {
              // Generate unique key for fare (fare name + price)
              const fareKey = `${fare.fare_name || 'unknown'}_${fare.price || ''}_${fare.original_price || ''}`;
              if (!seenFares.has(fareKey)) {
                seenFares.add(fareKey);
                fares.push(fare);
              } else {
                console.log(`⚠ Duplicate fare card detected: ${fareKey}`);
              }
            }
          }
        });

        if (fares.length > 0 || startingPrice) {
          result.fare_classes.push({
            class: className,
            starting_price: startingPrice,
            description: classDescription,
            fares: fares
          });
        }
      });
    } else {
      // If no tabs found, extract all fare cards directly
      const journeyContent = popup.querySelector('div.journeyContent');
      const fareCards = journeyContent ? 
        journeyContent.querySelectorAll('div.fareFamilyCardWrapper, div.keen-slider__slide.fareFamilyCardWrapper') : 
        popup.querySelectorAll('div.fareFamilyCardWrapper, div.keen-slider__slide');
      
      const fares = [];
      const seenFares = new Set(); // Track unique fares to avoid duplicates
      fareCards.forEach((fareCard) => {
        if (isElementVisible(fareCard)) {
          const fare = extractFareCardDetails(fareCard);
          if (fare) {
            // Generate unique key for fare (fare name + price)
            const fareKey = `${fare.fare_name || 'unknown'}_${fare.price || ''}_${fare.original_price || ''}`;
            if (!seenFares.has(fareKey)) {
              seenFares.add(fareKey);
              fares.push(fare);
            } else {
              console.log(`⚠ Duplicate fare card detected: ${fareKey}`);
            }
          }
        }
      });

      if (fares.length > 0) {
        result.fare_classes.push({
          class: 'Economy',
          fares: fares
        });
      }
    }

    return result.fare_classes.length > 0 ? result : null;
  }

  /**
   * Extract details from a single fare card
   */
  function extractFareCardDetails(fareCard) {
    const fare = {};

    // Extract price - look in ffCardHeading first
    const heading = fareCard.querySelector('div.ffCardHeading');
    if (heading) {
      // Check for slashed price (original price) first
      const slashedPrice = heading.querySelector('span.lighterGreyText strike');
      if (slashedPrice) {
        fare.original_price = slashedPrice.textContent?.trim();
      }
      
      // Extract current price
      const priceEl = heading.querySelector('span.fontSize18.blackFont');
      if (priceEl) {
        const priceText = priceEl.textContent?.trim();
        const priceMatch = priceText?.match(/[₹Rs]?\s*(\d{1,3}(?:[,\s]\d{2,3})*)/);
        fare.price = priceMatch ? priceMatch[0].trim() : priceText;
      }
      
      // Extract "per adult" text if available
      const perAdult = heading.querySelector('span.fontSize12');
      if (perAdult && perAdult.textContent?.includes('per adult')) {
        fare.price_unit = perAdult.textContent?.trim();
      }
    }

    // Extract fare name
    const fareNameEl = fareCard.querySelector('p.fontSize12.capText');
    if (fareNameEl) {
      fare.fare_name = fareNameEl.textContent?.trim();
    }

    // Extract baggage information
    const baggageSection = Array.from(fareCard.querySelectorAll('p.fontSize12.boldFont.appendBottom8'))
      .find(section => section.textContent?.includes('Baggage'));
    
    if (baggageSection) {
      const baggageItems = [];
      // Check for special tag on baggage section
      const benefitTag = baggageSection.querySelector('span.benefitTag');
      if (benefitTag) {
        fare.baggage_tag = benefitTag.textContent?.trim();
      }
      
      // Get the UL list that follows
      let nextSibling = baggageSection.nextElementSibling;
      while (nextSibling && nextSibling.tagName !== 'UL' && !nextSibling.classList.contains('ffCardList')) {
        nextSibling = nextSibling.nextElementSibling;
      }
      if (nextSibling && (nextSibling.tagName === 'UL' || nextSibling.classList.contains('ffCardList'))) {
        nextSibling.querySelectorAll('li').forEach(li => {
          const baggageText = li.textContent?.trim();
          if (baggageText) {
            baggageItems.push(baggageText);
          }
        });
      }
      fare.baggage = baggageItems.length > 0 ? baggageItems : null;
    }

    // Extract flexibility information
    const flexibilitySection = Array.from(fareCard.querySelectorAll('p.fontSize12.boldFont.appendBottom8'))
      .find(section => section.textContent?.includes('Flexibility'));
    
    if (flexibilitySection) {
      const flexibilityItems = [];
      let nextSibling = flexibilitySection.nextElementSibling;
      while (nextSibling && nextSibling.tagName !== 'UL' && !nextSibling.classList.contains('ffCardList')) {
        nextSibling = nextSibling.nextElementSibling;
      }
      if (nextSibling && (nextSibling.tagName === 'UL' || nextSibling.classList.contains('ffCardList'))) {
        nextSibling.querySelectorAll('li').forEach(li => {
          const flexText = li.textContent?.trim();
          if (flexText) {
            flexibilityItems.push(flexText);
          }
        });
      }
      fare.flexibility = flexibilityItems.length > 0 ? flexibilityItems : null;
    }

    // Extract seats, meals & more
    const seatsMealsSection = Array.from(fareCard.querySelectorAll('p.fontSize12.boldFont.appendBottom8'))
      .find(section => section.textContent?.includes('Seats') || section.textContent?.includes('Meals'));
    
    if (seatsMealsSection) {
      const seatsMealsItems = [];
      let nextSibling = seatsMealsSection.nextElementSibling;
      while (nextSibling && nextSibling.tagName !== 'UL' && !nextSibling.classList.contains('ffCardList')) {
        nextSibling = nextSibling.nextElementSibling;
      }
      if (nextSibling && (nextSibling.tagName === 'UL' || nextSibling.classList.contains('ffCardList'))) {
        nextSibling.querySelectorAll('li').forEach(li => {
          const itemText = li.textContent?.trim();
          if (itemText) {
            seatsMealsItems.push(itemText);
          }
        });
      }
      fare.seats_meals = seatsMealsItems.length > 0 ? seatsMealsItems : null;
    }

    // Extract special tags/benefits
    const benefitTag = fareCard.querySelector('span.benefitTag');
    if (benefitTag && !fare.baggage_tag) {
      fare.special_tag = benefitTag.textContent?.trim();
    }

    const mostPopularTag = fareCard.querySelector('div.mostPopularTag');
    if (mostPopularTag) {
      fare.popular_tag = mostPopularTag.textContent?.trim();
    }

    // Extract bottom persuasions/offers
    const bottomPersuasions = fareCard.querySelector('div.bottomPersuasions');
    if (bottomPersuasions) {
      const persuasions = [];
      bottomPersuasions.querySelectorAll('div.ffSuccess, div.fontSize12').forEach(el => {
        const text = el.textContent?.trim();
        if (text) {
          // Split by | to get individual offers
          const individualOffers = text.split('|').map(o => o.trim()).filter(o => o);
          persuasions.push(...individualOffers);
        }
      });
      
      // Also check for benefits worth text
      const benefitsWorth = bottomPersuasions.querySelector('div.boldFont');
      if (benefitsWorth) {
        const benefitsText = benefitsWorth.textContent?.trim();
        if (benefitsText) {
          persuasions.push(benefitsText);
        }
      }
      
      fare.persuasions = persuasions.length > 0 ? persuasions : null;
    }

    // Extract lock price button text if available
    const lockPriceBtn = fareCard.querySelector('button.ffSpinBtnWrapper');
    if (!lockPriceBtn) {
      // Fallback: find button with LOCK PRICE text
      const allButtons = fareCard.querySelectorAll('button');
      for (const btn of allButtons) {
        if (btn.textContent?.includes('LOCK PRICE') || btn.querySelector('font[color="#008CFF"]')) {
          const lockPriceText = btn.textContent?.trim();
          if (lockPriceText) {
            fare.has_lock_price = true;
            fare.lock_price_text = lockPriceText;
          }
          break;
        }
      }
    } else {
      fare.has_lock_price = true;
      const lockPriceText = lockPriceBtn.textContent?.trim();
      if (lockPriceText) {
        fare.lock_price_text = lockPriceText;
      }
    }

    // Only return fare if it has at least a price
    return fare.price ? fare : null;
  }

  /**
   * Extract raw text excerpt
   */
  function extractRawText(card) {
    const text = card.textContent || '';
    // Return first 500 characters for debugging
    return text.substring(0, 500).trim();
  }

  /**
   * Extract HTML snippet
   */
  function extractHtmlSnippet(card) {
    const html = card.outerHTML || '';
    // Return first 1000 characters for debugging
    return html.substring(0, 1000);
  }

  /**
   * Check if element is visible
   */
  function isElementVisible(element) {
    if (!element) return false;
    
    const style = window.getComputedStyle(element);
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
      return false;
    }

    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  /**
   * Validate if extracted flight data is valid
   */
  function isValidFlight(flight) {
    // At minimum, should have price or time information
    return !!(flight.price || flight.departure_time || flight.arrival_time);
  }

  // Log that content script is loaded
  console.log('Flight Extracter content script loaded');
  console.log('Current URL:', window.location.href);
  console.log('Document ready state:', document.readyState);
  
  // Function to trigger auto-extraction check with retries
  function triggerAutoExtractionCheck() {
    console.log('=== Triggering auto-extraction check ===');
    console.log('URL:', window.location.href);
    console.log('Has sessionStorage:', typeof sessionStorage !== 'undefined');
    
    if (typeof sessionStorage !== 'undefined') {
      const pendingData = sessionStorage.getItem('pendingExtraction');
      console.log('Pending extraction data:', pendingData ? 'Found' : 'Not found');
    }
    
    checkAndAutoExtract();
  }
  
  // Check for auto-extraction when page loads
  // This handles cases where we navigate directly to a search URL
  if (document.readyState === 'loading') {
    console.log('Document is loading - will check after DOMContentLoaded');
    document.addEventListener('DOMContentLoaded', () => {
      console.log('DOMContentLoaded event fired - checking for auto-extraction...');
      setTimeout(() => triggerAutoExtractionCheck(), 2000);
    });
  } else {
    // DOM already loaded, check immediately
    console.log('DOM already loaded - checking for auto-extraction immediately...');
    setTimeout(() => triggerAutoExtractionCheck(), 2000);
  }
  
  // Also check when page becomes visible (handles tab switching)
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
      console.log('Page became visible - checking for auto-extraction...');
      setTimeout(() => triggerAutoExtractionCheck(), 1000);
    }
  });
  
  // Additional check after a longer delay (in case page loads slowly)
  setTimeout(() => {
    console.log('Delayed check (5s) - verifying auto-extraction status...');
    const url = window.location.href;
    if ((url.includes('/flight/search') || url.includes('/listing')) && !autoExtractMode) {
      console.log('Search results page detected but auto-extraction not started - triggering now...');
      triggerAutoExtractionCheck();
    }
  }, 5000);
})();

