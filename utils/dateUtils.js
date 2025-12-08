/**
 * Date utility functions for handling timezone conversions
 */

/**
 * Converts a UTC timestamp to a date string in the specified timezone
 * @param {string|Date} timestamp - The UTC timestamp to convert
 * @param {string} timezone - The IANA timezone (e.g., 'Asia/Kolkata')
 * @returns {string} Date in YYYY-MM-DD format for the specified timezone
 */
function getDateInTimezone(timestamp, timezone = "Asia/Kolkata") {
  try {
    const date = new Date(timestamp);

    // Use formatToParts for deterministic formatting regardless of locale
    const options = {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    };

    const formatter = new Intl.DateTimeFormat('en-US', options);
    const parts = formatter.formatToParts(date);

    // Manually assemble YYYY-MM-DD
    const year = parts.find(p => p.type === 'year').value;
    const month = parts.find(p => p.type === 'month').value;
    const day = parts.find(p => p.type === 'day').value;

    return `${year}-${month}-${day}`;
  } catch (error) {
    console.error(`Error converting date to timezone ${timezone}:`, error);
    // Fallback to UTC date
    return new Date(timestamp).toISOString().split("T")[0];
  }
}

/**
 * Gets the current date in the specified timezone
 * @param {string} timezone - The IANA timezone (e.g., 'Asia/Kolkata')
 * @returns {string} Current date in YYYY-MM-DD format for the specified timezone
 */
function getCurrentDateInTimezone(timezone = "Asia/Kolkata") {
  return getDateInTimezone(new Date(), timezone);
}

module.exports = {
  getDateInTimezone,
  getCurrentDateInTimezone
};
