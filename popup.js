/**
 * Flight Extracter - Popup Script
 * Handles UI interactions and communication with content script
 */

document.addEventListener('DOMContentLoaded', () => {
  const extractBtn = document.getElementById('extractBtn');
  const extractIntlRoundTripBtn = document.getElementById('extractIntlRoundTripBtn');
  const copyBtn = document.getElementById('copyBtn');
  const downloadBtn = document.getElementById('downloadBtn');
  const status = document.getElementById('status');
  const statusText = document.getElementById('statusText');
  const info = document.getElementById('info');
  const results = document.getElementById('results');
  const jsonOutput = document.getElementById('jsonOutput');
  const flightCount = document.getElementById('flightCount');
  const progress = document.getElementById('progress');
  const progressText = document.getElementById('progressText');
  const progressCounter = document.getElementById('progressCounter');
  const progressFill = document.getElementById('progressFill');
  const progressDetails = document.getElementById('progressDetails');
  const downloadLogsBtn = document.getElementById('downloadLogsBtn');

  let currentData = null;
  let totalCombinations = 0;
  let completedCombinations = 0;

  // Check if we're on a supported page
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const currentTab = tabs[0];
    if (!currentTab.url.includes('makemytrip.com') && !currentTab.url.includes('mmtcdn.net')) {
      updateStatus('Please navigate to a MakeMyTrip flight listing page', 'error');
      extractBtn.disabled = true;
      extractIntlRoundTripBtn.disabled = true;
    }
  });

  // Extract button handler - ISOLATED: Only for DOMESTIC trips (one-way OR round trip)
  extractBtn.addEventListener('click', async () => {
    try {
      updateStatus('Processing DOMESTIC flights (one-way & round trip) - this may take a while...', 'loading');
      extractBtn.disabled = true;
      extractIntlRoundTripBtn.disabled = true; // Disable other button during extraction
      copyBtn.disabled = true;
      downloadBtn.disabled = true;

      // Get current tab
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

      // Define routes to process
      const routes = [
        { source: 'BLR', dest: 'PAT' },
        { source: 'IXL', dest: 'DEL' },
        { source: 'BOM', dest: 'IXE' },
        { source: 'PNQ', dest: 'BLR' },
        { source: 'BOM', dest: 'AMD' }
      ];
      
      const dateOffsets = [1, 7, 14, 30]; // Days from today

      // Inject content script if needed and send message with routes
      chrome.tabs.sendMessage(tab.id, { 
        action: 'extractFlights',
        routes: routes,
        dateOffsets: dateOffsets
      }, (response) => {
        if (chrome.runtime.lastError) {
          updateStatus('Error: ' + chrome.runtime.lastError.message, 'error');
          extractBtn.disabled = false;
          return;
        }

        if (response && response.success) {
          // Check if this is multiple routes mode (no data.flights, just a message)
          if (response.message && response.total_combinations) {
            // Multiple routes mode - processing started in background
            totalCombinations = response.total_combinations;
            completedCombinations = 0;
            showProgress();
            updateProgress(0, totalCombinations, 'Starting...');
            updateStatus(`Processing ${response.total_combinations} route-date combinations. Files will auto-download as each completes.`, 'loading');
            extractBtn.disabled = false;
            extractIntlRoundTripBtn.disabled = false;
            return;
          }
          
          // Single extraction mode - has flight data
          if (response.data) {
            currentData = response.data;
            displayResults(response.data);
            
            // Show execution time in status
            const execTime = response.data.metadata?.execution_time_formatted || 'N/A';
            const flightsCount = (response.data.flights && Array.isArray(response.data.flights)) 
              ? response.data.flights.length 
              : 0;
            
            if (flightsCount > 0) {
              updateStatus(`Successfully extracted ${flightsCount} flights in ${execTime}`, 'success');
              
              // Auto-save JSON file to local system
              const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
              const tripType = response.data.metadata?.trip_type || 'unknown';
              const filename = `flight-data-${tripType}-${timestamp}.json`;
              
              chrome.runtime.sendMessage({
                action: 'saveJSON',
                data: response.data,
                filename: filename
              }, (saveResponse) => {
                if (saveResponse && saveResponse.success) {
                  console.log('JSON file saved automatically:', filename);
                  updateStatus(`Saved ${flightsCount} flights to ${filename}`, 'success');
                  setTimeout(() => {
                    updateStatus(`Ready (${flightsCount} flights extracted)`, 'success');
                  }, 2000);
                } else {
                  console.warn('Auto-save failed, but data is available for manual download');
                }
              });
            } else {
              updateStatus(`No flights found. Execution time: ${execTime}`, 'success');
            }
            
            copyBtn.disabled = false;
            downloadBtn.disabled = false;
          } else {
            updateStatus('Extraction completed but no data returned', 'error');
          }
        } else {
          const errorMsg = response?.error || 'Failed to extract flight data';
          updateStatus(`Error: ${errorMsg}`, 'error');
        }

        extractBtn.disabled = false;
      });

    } catch (error) {
      console.error('Error:', error);
      updateStatus('Error: ' + error.message, 'error');
      extractBtn.disabled = false;
      extractIntlRoundTripBtn.disabled = false; // Re-enable other button
    }
  });

  // Extract International Flights button handler - ISOLATED: Only for INTERNATIONAL trips (one-way OR round trip)
  extractIntlRoundTripBtn.addEventListener('click', async () => {
    try {
      updateStatus('Processing INTERNATIONAL flights (one-way & round trip) - this may take a while...', 'loading');
      extractBtn.disabled = true; // Disable other button during extraction
      extractIntlRoundTripBtn.disabled = true;
      copyBtn.disabled = true;
      downloadBtn.disabled = true;

      // Get current tab
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

      // Inject content script if needed and send message
      chrome.tabs.sendMessage(tab.id, { action: 'extractInternationalRoundTrip' }, (response) => {
        if (chrome.runtime.lastError) {
          updateStatus('Error: ' + chrome.runtime.lastError.message, 'error');
          extractIntlRoundTripBtn.disabled = false;
          return;
        }

        if (response && response.success) {
          // Single extraction mode - has flight data
          if (response.data) {
            currentData = response.data;
            displayResults(response.data);
            
            // Show execution time in status
            const execTime = response.data.metadata?.execution_time_formatted || 'N/A';
            const flightsCount = (response.data.flights && Array.isArray(response.data.flights)) 
              ? response.data.flights.length 
              : 0;
            
            if (flightsCount > 0) {
              updateStatus(`Successfully extracted ${flightsCount} flights in ${execTime}`, 'success');
              
              // Auto-save JSON file to local system
              const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
              const tripType = response.data.metadata?.trip_type || 'international_round_trip';
              const filename = `flight-data-${tripType}-${timestamp}.json`;
              
              chrome.runtime.sendMessage({
                action: 'saveJSON',
                data: response.data,
                filename: filename
              }, (saveResponse) => {
                if (saveResponse && saveResponse.success) {
                  console.log('JSON file saved automatically:', filename);
                  updateStatus(`Saved ${flightsCount} flights to ${filename}`, 'success');
                  setTimeout(() => {
                    updateStatus(`Ready (${flightsCount} flights extracted)`, 'success');
                  }, 2000);
                } else {
                  console.warn('Auto-save failed, but data is available for manual download');
                }
              });
            } else {
              updateStatus(`No flights found. Execution time: ${execTime}`, 'success');
            }
            
            copyBtn.disabled = false;
            downloadBtn.disabled = false;
          } else {
            updateStatus('Extraction completed but no data returned', 'error');
          }
        } else {
          const errorMsg = response?.error || 'Failed to extract flight data';
          updateStatus(`Error: ${errorMsg}`, 'error');
        }

        extractIntlRoundTripBtn.disabled = false;
        extractBtn.disabled = false; // Re-enable other button
      });

    } catch (error) {
      console.error('Error:', error);
      updateStatus('Error: ' + error.message, 'error');
      extractIntlRoundTripBtn.disabled = false;
      extractBtn.disabled = false; // Re-enable other button
    }
  });

  // Copy button handler
  copyBtn.addEventListener('click', async () => {
    if (!currentData) return;

    try {
      const jsonString = JSON.stringify(currentData, null, 2);
      await navigator.clipboard.writeText(jsonString);
      updateStatus('JSON copied to clipboard!', 'success');
      setTimeout(() => {
        updateStatus(`Ready (${currentData.flights.length} flights extracted)`, 'success');
      }, 2000);
    } catch (error) {
      console.error('Copy error:', error);
      updateStatus('Failed to copy to clipboard', 'error');
    }
  });

  // Download button handler
  downloadBtn.addEventListener('click', () => {
    if (!currentData) return;

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `flight-data-${timestamp}.json`;

    chrome.runtime.sendMessage({
      action: 'downloadJSON',
      data: currentData,
      filename: filename
    }, (response) => {
      if (response && response.success) {
        updateStatus('Download started!', 'success');
      } else {
        updateStatus('Download failed', 'error');
      }
    });
  });

  /**
   * Update status message
   */
  function updateStatus(message, type = '') {
    statusText.textContent = message;
    status.className = 'status';
    if (type) {
      status.classList.add(type);
    }
  }

  /**
   * Display extracted results
   */
  function displayResults(data) {
    if (!data) {
      console.error('displayResults: No data provided');
      return;
    }
    
    info.style.display = 'none';
    results.style.display = 'flex';
    
    const jsonString = JSON.stringify(data, null, 2);
    jsonOutput.textContent = jsonString;
    
    // Update flight count with proper null checking
    const flightsCount = (data.flights && Array.isArray(data.flights)) 
      ? data.flights.length 
      : 0;
    flightCount.textContent = `${flightsCount} flights`;
    
    // Update execution time
    const execTime = document.getElementById('executionTime');
    if (data.metadata?.execution_time_formatted) {
      execTime.textContent = `⏱ ${data.metadata.execution_time_formatted}`;
      execTime.style.display = 'inline-block';
    } else {
      execTime.style.display = 'none';
    }
    
    // Scroll to top
    results.scrollTop = 0;
  }

  /**
   * Show progress bar
   */
  function showProgress() {
    progress.style.display = 'block';
  }

  /**
   * Hide progress bar
   */
  function hideProgress() {
    progress.style.display = 'none';
  }

  /**
   * Update progress counter
   */
  function updateProgress(completed, total, details = '') {
    completedCombinations = completed;
    totalCombinations = total;
    
    const percentage = total > 0 ? Math.round((completed / total) * 100) : 0;
    
    progressCounter.textContent = `${completed}/${total}`;
    progressFill.style.width = `${percentage}%`;
    
    if (details) {
      progressDetails.textContent = details;
    }
    
    if (completed >= total && total > 0) {
      progressText.textContent = 'Completed!';
      progressDetails.textContent = `All ${total} combinations processed successfully`;
      updateStatus(`All ${total} route-date combinations completed!`, 'success');
    } else {
      progressText.textContent = 'Processing...';
    }
  }

  /**
   * Download logs button handler
   */
  downloadLogsBtn.addEventListener('click', async () => {
    try {
      // Get logs from storage
      const result = await chrome.storage.local.get(['flightExtractorLogs', 'flightExtractorLogsTimestamp']);
      const logs = result.flightExtractorLogs || [];
      
      if (logs.length === 0) {
        updateStatus('No logs found', 'error');
        return;
      }
      
      // Format logs as text
      const logText = logs.map(log => {
        let line = `[${log.timestamp}] [${log.level.toUpperCase()}] ${log.message}`;
        if (log.data) {
          line += ` | Data: ${log.data}`;
        }
        if (log.url) {
          line += ` | URL: ${log.url}`;
        }
        return line;
      }).join('\n');
      
      // Create blob and download
      const blob = new Blob([logText], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const filename = `flight-extractor-logs-${timestamp}.txt`;
      
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      
      updateStatus(`Logs downloaded: ${logs.length} entries`, 'success');
    } catch (error) {
      console.error('Error downloading logs:', error);
      updateStatus('Error downloading logs: ' + error.message, 'error');
    }
  });

  /**
   * Listen for progress updates from content script
   */
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'progressUpdate') {
      updateProgress(
        request.completed || 0,
        request.total || 0,
        request.route ? `Route: ${request.route}, Date: +${request.dateOffset} days` : ''
      );
      sendResponse({ success: true });
    }
    return true;
  });
});

