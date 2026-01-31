sap.ui.define([
    "sap/m/MessageToast"
], function(MessageToast) {
    'use strict';

    // Global variable to track if Google Maps script is already loaded
    let googleMapsScriptLoaded = false;
    let googleMapsScriptLoading = false;
    const loadCallbacks = [];
    let autoLoadTriggered = false; // Prevent multiple auto-loads

    // Handler object
    const handler = {
        /**
         * Load Google Maps script dynamically
         * @param {string} apiKey - Your Google Maps API key
         * @returns {Promise} - Resolves when Google Maps is loaded
         */
        loadGoogleMapsScript: function(apiKey) {
            return new Promise((resolve, reject) => {
                // If already loaded, resolve immediately
                if (googleMapsScriptLoaded && window.google && window.google.maps) {
                    console.log("Google Maps already loaded");
                    resolve();
                    return;
                }

                // If currently loading, queue this callback
                if (googleMapsScriptLoading) {
                    console.log("Google Maps is loading, queueing callback");
                    loadCallbacks.push(resolve);
                    return;
                }

                // Start loading
                googleMapsScriptLoading = true;
                console.log("Starting to load Google Maps script...");

                const script = document.createElement("script");
                script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&loading=async`;
                script.async = true;
                script.defer = true;
                
                script.onload = () => {
                    console.log("Google Maps script loaded successfully");
                    googleMapsScriptLoaded = true;
                    googleMapsScriptLoading = false;
                    resolve();
                    // Resolve all queued callbacks
                    loadCallbacks.forEach(cb => cb());
                    loadCallbacks.length = 0;
                };
                
                script.onerror = (error) => {
                    console.error("Failed to load Google Maps script:", error);
                    googleMapsScriptLoading = false;
                    reject(new Error("Failed to load Google Maps script"));
                };
                
                document.head.appendChild(script);
                console.log("Google Maps script tag added to document");
            });
        },

        /**
         * Event handler called when the map container is rendered
         * Uses a polling mechanism to ensure reliable auto-loading
         * @param {sap.ui.base.Event} oEvent - The event object
         */
        onMapContainerRendered: function(oEvent) {
            console.log("=== onMapContainerRendered called ===");
            
            // Prevent multiple auto-loads
            if (autoLoadTriggered) {
                console.log("Auto-load already triggered, skipping");
                return;
            }
            autoLoadTriggered = true;

            const oSource = oEvent.getSource();
            
            // Poll for binding context with retry mechanism
            let retryCount = 0;
            const maxRetries = 10;
            
            const attemptAutoLoad = () => {
                console.log(`Auto-load attempt ${retryCount + 1}/${maxRetries}`);
                
                const oBindingContext = oSource.getBindingContext();
                
                if (!oBindingContext) {
                    retryCount++;
                    if (retryCount < maxRetries) {
                        console.log("No binding context yet, retrying in 300ms...");
                        setTimeout(attemptAutoLoad, 300);
                    } else {
                        console.error("Failed to get binding context after max retries");
                        const placeholder = document.getElementById("mapPlaceholder");
                        if (placeholder) {
                            placeholder.innerHTML = '<p style="color: orange;">Data not available yet. Click Refresh Map to try again.</p>';
                        }
                    }
                    return;
                }

                // Get the RouteStep data
                const oStepData = oBindingContext.getObject();
                console.log("Step data retrieved:", oStepData);

                if (!oStepData) {
                    console.error("Binding context exists but no data");
                    return;
                }

                // Validate coordinates
                const startLat = parseFloat(oStepData.startLat);
                const startLng = parseFloat(oStepData.startLng);
                const endLat = parseFloat(oStepData.endLat);
                const endLng = parseFloat(oStepData.endLng);

                console.log("Coordinates:", { startLat, startLng, endLat, endLng });

                if (isNaN(startLat) || isNaN(startLng) || isNaN(endLat) || isNaN(endLng)) {
                    console.error("Invalid coordinates");
                    const placeholder = document.getElementById("mapPlaceholder");
                    if (placeholder) {
                        placeholder.innerHTML = '<p style="color: red;">Invalid coordinates</p>';
                    }
                    return;
                }

                const apiKey = "AIzaSyBnJ6XNmu3vQE6Uay9BX7q1HV-Qz_N5eP4";

                console.log("Loading Google Maps...");
                
                handler.loadGoogleMapsScript(apiKey)
                    .then(() => {
                        console.log("Google Maps ready, rendering map...");
                        setTimeout(() => {
                            handler.renderMap(startLat, startLng, endLat, endLng, oStepData);
                        }, 200);
                    })
                    .catch((error) => {
                        console.error("Error loading Google Maps:", error);
                        const placeholder = document.getElementById("mapPlaceholder");
                        if (placeholder) {
                            placeholder.innerHTML = '<p style="color: red;">Failed to load map. Click Refresh to retry.</p>';
                        }
                    });
            };

            // Start the auto-load attempt
            setTimeout(attemptAutoLoad, 100);
        },

        /**
         * Refresh map handler - Reloads the map with current data
         * @param {sap.ui.base.Event} oEvent - The event object
         */
        onRefreshMap: function(oEvent) {
            console.log("=== Refresh Map pressed ===");
            MessageToast.show("Refreshing map...");
            
            // Reset auto-load flag to allow manual refresh
            autoLoadTriggered = false;
            
            const oBindingContext = oEvent.getSource().getBindingContext();
            if (!oBindingContext) {
                MessageToast.show("No data available");
                return;
            }

            const oStepData = oBindingContext.getObject();
            
            if (!oStepData) {
                MessageToast.show("No step data available");
                return;
            }
            
            const startLat = parseFloat(oStepData.startLat);
            const startLng = parseFloat(oStepData.startLng);
            const endLat = parseFloat(oStepData.endLat);
            const endLng = parseFloat(oStepData.endLng);

            if (isNaN(startLat) || isNaN(startLng) || isNaN(endLat) || isNaN(endLng)) {
                MessageToast.show("Invalid coordinates");
                const placeholder = document.getElementById("mapPlaceholder");
                if (placeholder) {
                    placeholder.innerHTML = '<p style="color: red;">Invalid coordinates</p>';
                }
                return;
            }

            // Clear the container first
            const mapContainer = document.getElementById("googleMap");
            if (mapContainer) {
                mapContainer.innerHTML = '<div id="mapPlaceholder" style="position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);text-align:center;color:#666;"><p>Refreshing map...</p></div>';
            }
            
            const apiKey = "AIzaSyBnJ6XNmu3vQE6Uay9BX7q1HV-Qz_N5eP4";
            
            // Load Google Maps and render
            handler.loadGoogleMapsScript(apiKey)
                .then(() => {
                    setTimeout(() => {
                        handler.renderMap(startLat, startLng, endLat, endLng, oStepData);
                    }, 100);
                })
                .catch((error) => {
                    console.error("Error loading Google Maps:", error);
                    MessageToast.show("Failed to load map: " + error.message);
                });
        },

        /**
         * Render the Google Map with start and end markers - SIMPLIFIED VERSION
         * @param {number} startLat - Start latitude
         * @param {number} startLng - Start longitude
         * @param {number} endLat - End latitude
         * @param {number} endLng - End longitude
         * @param {object} oStepData - Full step data
         */
        renderMap: function(startLat, startLng, endLat, endLng, oStepData) {
            console.log("=== renderMap called ===");
            console.log("Coordinates:", { startLat, startLng, endLat, endLng });
            
            const mapContainer = document.getElementById("googleMap");
            
            if (!mapContainer) {
                console.error("Map container #googleMap not found in DOM");
                console.log("Available elements:", document.querySelectorAll('[id*="googleMap"]'));
                MessageToast.show("Map container not found");
                return;
            }

            console.log("Map container found:", mapContainer);
            console.log("Container dimensions:", mapContainer.offsetWidth, "x", mapContainer.offsetHeight);
            console.log("Container parent:", mapContainer.parentElement);
            console.log("Container visibility:", window.getComputedStyle(mapContainer).display);

            // Check if Google Maps API is loaded
            if (!window.google) {
                console.error("window.google not available");
                MessageToast.show("Google Maps API not loaded (window.google missing)");
                return;
            }

            if (!window.google.maps) {
                console.error("window.google.maps not available");
                MessageToast.show("Google Maps API not loaded (google.maps missing)");
                return;
            }

            console.log("Google Maps API is available");
            console.log("google.maps.Map exists?", typeof google.maps.Map);
            console.log("google.maps.Marker exists?", typeof google.maps.Marker);

            try {
                // Calculate center point between start and end
                const centerLat = (startLat + endLat) / 2;
                const centerLng = (startLng + endLng) / 2;

                console.log("Center point:", { centerLat, centerLng });

                // SIMPLIFIED Map configuration - OLD API (most compatible)
                const mapOptions = {
                    center: { lat: centerLat, lng: centerLng },
                    zoom: 14,
                    mapTypeId: "roadmap"
                };

                console.log("Creating map with SIMPLIFIED options:", mapOptions);

                // Clear the placeholder/loading message
                const placeholder = document.getElementById("mapPlaceholder");
                if (placeholder) {
                    placeholder.remove();
                }

                // Create the map using STANDARD API (not importLibrary)
                const map = new google.maps.Map(mapContainer, mapOptions);
                console.log("Map created successfully:", map);
                console.log("Map div:", map.getDiv());

                // Force the map container to be visible and sized correctly
                mapContainer.style.display = "block";
                mapContainer.style.position = "relative";
                mapContainer.style.overflow = "hidden";
                
                // Trigger resize event to force map to render
                setTimeout(() => {
                    google.maps.event.trigger(map, 'resize');
                    map.setCenter({ lat: centerLat, lng: centerLng });
                    console.log("Map resize triggered");
                }, 100);

                // Add start marker (green) - Using standard Marker for compatibility
                const startMarker = new google.maps.Marker({
                    position: { lat: startLat, lng: startLng },
                    map: map,
                    title: "Start",
                    label: "A",
                    icon: {
                        url: "http://maps.google.com/mapfiles/ms/icons/green-dot.png"
                    }
                });
                console.log("Start marker added");

                // Add end marker (red)
                const endMarker = new google.maps.Marker({
                    position: { lat: endLat, lng: endLng },
                    map: map,
                    title: "End",
                    label: "B",
                    icon: {
                        url: "http://maps.google.com/mapfiles/ms/icons/red-dot.png"
                    }
                });
                console.log("End marker added");

                // Draw a line between start and end
                const pathLine = new google.maps.Polyline({
                    path: [
                        { lat: startLat, lng: startLng },
                        { lat: endLat, lng: endLng }
                    ],
                    geodesic: true,
                    strokeColor: "#4285F4",
                    strokeOpacity: 0.8,
                    strokeWeight: 4
                });
                pathLine.setMap(map);
                console.log("Polyline added");

                // Info window for start marker
                const startInfoWindow = new google.maps.InfoWindow({
                    content: `<div style="padding:5px;">
                        <strong>Start Point</strong><br/>
                        Step ${oStepData.stepNumber || 'N/A'}<br/>
                        Lat: ${startLat.toFixed(6)}<br/>
                        Lng: ${startLng.toFixed(6)}
                    </div>`
                });

                startMarker.addListener("click", function() {
                    startInfoWindow.open(map, startMarker);
                });

                // Info window for end marker
                const endInfoWindow = new google.maps.InfoWindow({
                    content: `<div style="padding:5px;">
                        <strong>End Point</strong><br/>
                        ${oStepData.instruction || 'No instruction'}<br/>
                        Distance: ${oStepData.distance || 'N/A'}<br/>
                        Duration: ${oStepData.duration || 'N/A'}<br/>
                        Lat: ${endLat.toFixed(6)}<br/>
                        Lng: ${endLng.toFixed(6)}
                    </div>`
                });

                endMarker.addListener("click", function() {
                    endInfoWindow.open(map, endMarker);
                });

                // Auto-fit bounds to show both markers
                const bounds = new google.maps.LatLngBounds();
                bounds.extend({ lat: startLat, lng: startLng });
                bounds.extend({ lat: endLat, lng: endLng });
                map.fitBounds(bounds);

                console.log("Google Map rendered successfully");
            } catch (error) {
                console.error("Error creating map:", error);
                MessageToast.show("Error creating map: " + error.message);
            }
        }
    };
    
    // Return the handler object
    return handler;
});
