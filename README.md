# Flight Extracter - Chrome Extension

A Chrome extension that extracts structured flight data from travel sites like MakeMyTrip.com and returns it as JSON.

## Features

- ✈️ Extracts flight information including:
  - Airline name
  - Departure and arrival times
  - Dates
  - Layovers and stops
  - Flight duration
  - Price
  - Available offers/promotions
  - Raw text and HTML snippets for debugging

- 🎯 Robust extraction with multiple selector strategies and fallbacks
- 📊 Clean JSON output with metadata
- 💾 Copy to clipboard or download as JSON file
- 🎨 Modern, user-friendly popup interface

## Installation

### Load as Unpacked Extension (Developer Mode)

1. **Open Chrome Extensions Page**
   - Navigate to `chrome://extensions/`
   - Or go to Menu (⋮) → More Tools → Extensions

2. **Enable Developer Mode**
   - Toggle the "Developer mode" switch in the top-right corner

3. **Load the Extension**
   - Click "Load unpacked"
   - Select the `extracter` folder (the folder containing `manifest.json`)
   - The extension should now appear in your extensions list

4. **Pin the Extension (Optional)**
   - Click the puzzle icon (🧩) in Chrome's toolbar
   - Find "Flight Extracter" and click the pin icon to keep it visible

## Usage

1. **Navigate to a Flight Listing Page**
   - Go to [makemytrip.com](https://www.makemytrip.com)
   - Search for flights (e.g., enter origin, destination, dates)
   - Wait for flight results to load

2. **Extract Flight Data**
   - Click the Flight Extracter icon in your Chrome toolbar
   - Click the "Extract Flights" button
   - Wait for the extraction to complete

3. **View and Use Results**
   - View the extracted JSON in the popup
   - Click "Copy JSON" to copy to clipboard
   - Click "Download JSON" to save as a file

## Output Format

The extension returns a JSON object with the following structure:

```json
{
  "metadata": {
    "scraped_at": "2024-01-15T10:30:00.000Z",
    "source_url": "https://www.makemytrip.com/flights/...",
    "flights_count": 25,
    "user_agent": "..."
  },
  "flights": [
    {
      "index": 0,
      "airline": "IndiGo",
      "departure_time": "08:30",
      "arrival_time": "10:45",
      "date": "15 Jan 2024",
      "layovers": ["DEL"],
      "stops": 1,
      "duration": "2h 15m",
      "price": "₹5,234",
      "offers": ["Save ₹500"],
      "raw_text": "...",
      "html_snippet": "..."
    }
  ]
}
```

## Technical Details

### Architecture

- **Manifest V3**: Uses the latest Chrome extension manifest version
- **Content Script**: Runs on MakeMyTrip pages to extract flight data
- **Background Service Worker**: Handles messaging and file downloads
- **Popup UI**: Provides user interface for triggering extraction and viewing results

### Extraction Strategy

The extension uses multiple selector strategies with fallbacks:

1. **Primary Selectors**: Targets common class names and data attributes
   - `[class*="flightCard"]`, `[data-testid*="flight"]`, etc.

2. **Fallback Strategies**:
   - Pattern matching (time patterns, price patterns)
   - ARIA labels and alt text
   - Regex heuristics for airline names, dates, etc.

3. **Performance Optimizations**:
   - Limits to visible elements only
   - Maximum 200 flights per extraction
   - Efficient DOM traversal

### Selector Tuning

If the extension doesn't extract data correctly, you may need to tune selectors:

1. **Inspect the Page**
   - Right-click on a flight card → Inspect
   - Note the class names, IDs, and data attributes

2. **Update Selectors**
   - Edit `content.js`
   - Add new selectors to the `findFlightCards()` function
   - Update extraction functions with site-specific selectors

3. **Common Patterns to Look For**:
   - Flight card containers: `div[class*="flight"]`
   - Time elements: `span[class*="time"]`
   - Price elements: `div[class*="price"]`
   - Airline logos: `img[alt*="airline"]`

## Limitations

- **Site-Specific**: Optimized for MakeMyTrip.com. Other sites may require selector adjustments
- **Visible Elements Only**: Only extracts flights currently visible on the page
- **Dynamic Content**: May need to wait for page to fully load before extracting
- **Rate Limiting**: Respect website rate limits and terms of service

## Legal and Ethical Considerations

⚠️ **Important**: 

- This extension is for **educational and personal use** only
- **Respect website Terms of Service**: Many travel sites prohibit automated scraping
- **Do not abuse**: Avoid excessive requests that could impact website performance
- **Privacy**: The extension only extracts publicly visible flight information
- **Commercial Use**: If using for commercial purposes, obtain proper authorization

The developers are not responsible for misuse of this extension. Use at your own risk and in compliance with applicable laws and website terms.

## Troubleshooting

### No flights extracted

- Ensure you're on a flight listing page (not homepage)
- Wait for flight results to fully load
- Check browser console (F12) for errors
- Try refreshing the page and extracting again

### Extension not working

- Verify the extension is enabled in `chrome://extensions/`
- Check if the page URL matches the allowed domains
- Reload the extension if you made code changes

### Selectors not matching

- Website structure may have changed
- Update selectors in `content.js` based on current page structure
- Use browser DevTools to inspect elements

## Development

### Project Structure

```
extracter/
├── manifest.json       # Extension manifest
├── content.js          # Content script for extraction
├── background.js       # Background service worker
├── popup.html          # Popup UI
├── popup.css           # Popup styles
├── popup.js            # Popup logic
├── icon16.png          # Extension icon (16x16)
├── icon48.png          # Extension icon (48x48)
├── icon128.png         # Extension icon (128x128)
└── README.md           # This file
```

### Making Changes

1. Edit the relevant files
2. Go to `chrome://extensions/`
3. Click the reload icon (🔄) on the Flight Extracter card
4. Test your changes

## License

This project is provided as-is for educational purposes.

## Support

For issues or questions:
1. Check the Troubleshooting section
2. Review browser console for errors
3. Verify you're on a supported page

---

**Happy Flight Extracting! ✈️**

