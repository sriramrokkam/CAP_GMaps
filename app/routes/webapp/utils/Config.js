sap.ui.define([], function () {
    "use strict";

    /**
     * Configuration module for Google Maps API
     * Loads API key from environment or falls back to configuration
     */
    return {
        /**
         * Get Google Maps API Key
         * In development: Uses local configuration
         * In production: Should be configured via destination/environment
         * @returns {string} API key
         */
        getApiKey: function() {
            // For local development, read from window config or environment
            // Note: This can be set via UI5 bootstrap or configuration
            return window.GOOGLE_MAPS_API_KEY || 
                   "AIzaSyBnJ6XNmu3vQE6Uay9BX7q1HV-Qz_N5eP4"; // Fallback for local dev
        }
    };
});
