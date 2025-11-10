/**
 * Flight Extracter - Background Service Worker
 * Handles messaging and file downloads
 */

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'downloadJSON') {
    downloadJSON(request.data, request.filename, request.saveAs).then(() => {
      sendResponse({ success: true });
    }).catch((error) => {
      console.error('Download error:', error);
      sendResponse({ success: false, error: error.message });
    });
    return true; // Keep channel open for async response
  } else if (request.action === 'saveJSON') {
    // Auto-save without dialog
    downloadJSON(request.data, request.filename, false).then(() => {
      sendResponse({ success: true });
    }).catch((error) => {
      console.error('Save error:', error);
      sendResponse({ success: false, error: error.message });
    });
    return true; // Keep channel open for async response
  } else if (request.action === 'progressUpdate') {
    // Forward progress update to popup if it's open
    // This is handled by popup.js directly via chrome.runtime.onMessage
    sendResponse({ success: true });
    return true;
  }
  return true;
});

/**
 * Download JSON data as a file
 * Uses data URL instead of blob URL (works in service workers)
 * @param {Object} data - The data to save
 * @param {string} filename - The filename (default: 'flight-data.json')
 * @param {boolean} saveAs - Show save dialog (default: true)
 */
async function downloadJSON(data, filename = 'flight-data.json', saveAs = true) {
  try {
    // Convert JSON to string
    const jsonString = JSON.stringify(data, null, 2);
    
    // Create data URL (base64 encoded)
    // Service workers don't support URL.createObjectURL, so we use data URLs
    const dataUrl = 'data:application/json;charset=utf-8,' + encodeURIComponent(jsonString);
    
    // Download using chrome.downloads API
    return new Promise((resolve, reject) => {
      chrome.downloads.download({
        url: dataUrl,
        filename: filename,
        saveAs: saveAs // Show dialog if true, auto-save if false
      }, (downloadId) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else {
          console.log('Download started:', downloadId);
          resolve(downloadId);
        }
      });
    });
  } catch (error) {
    console.error('Error creating download:', error);
    throw error;
  }
}

// Log that background service worker is loaded
console.log('Flight Extracter background service worker loaded');

