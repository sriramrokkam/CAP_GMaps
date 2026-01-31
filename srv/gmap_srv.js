const cds = require('@sap/cds');
const { v4: uuidv4 } = require('uuid');

module.exports = class GmapsService extends cds.ApplicationService {
    
    async init() {
        const { Routes, RouteDirections, RouteSteps } = this.entities;

        // Connect to the GoogleAPI-SR service defined in package.json
        const googleMapsService = await cds.connect.to('GoogleAPI-SR');
        console.log('Connected to GoogleAPI-SR service');

        // Before event handlers for Routes entity
        this.before(['CREATE', 'UPDATE'], Routes, async (req) => {
            console.log('Before CREATE/UPDATE Routes', req.data);
        });

        // After event handler for Routes entity
        this.after('READ', Routes, async (routes, req) => {
            console.log('After READ Routes', routes);
        });

        // Get Directions action - uses BTP Destination Service
        this.on('getDirections', async (req) => {
            const { from, to } = req.data;

            // Validate input
            if (!from || !to) {
                return req.error(400, 'Both "from" and "to" parameters are required');
            }

            try {
                console.log(`Fetching directions from "${from}" to "${to}"...`);

                // In production: API key comes from Destination service (automatic)
                // In development: API key from .env file
                const apiKey = process.env.GOOGLE_MAPS_API_KEY;
                
                if (!apiKey) {
                    console.error('GOOGLE_MAPS_API_KEY not found in environment');
                    return req.error(500, 'API key configuration missing');
                }

                console.log('Calling Google Maps API via destination service');

                // Build query string for Google Maps API
                const queryParams = new URLSearchParams({
                    origin: from,
                    destination: to,
                    key: apiKey
                });

                // Call Google Maps Directions API via destination
                // In production: destination injects credentials automatically
                // In development: uses direct URL from package.json
                const response = await googleMapsService.send({
                    method: 'GET',
                    path: `/maps/api/directions/json?${queryParams.toString()}`
                });
                // Check API response status
                if (response.status !== 'OK') {
                    console.error('Google Maps API error:', response.status);
                    const errorMsg = response.error_message || response.status;
                    return req.error(400, `Google Maps API error: ${errorMsg}`);
                }

                // Validate routes exist
                if (!response.routes || response.routes.length === 0) {
                    return req.error(404, 'No routes found between the specified locations');
                }

                const apiRoute = response.routes[0];
                const leg = apiRoute.legs[0];

                // Generate UUID for the route
                const routeId = uuidv4();

                // Create Routes entry
                const routeEntry = {
                    ID: routeId,
                    origin: leg.start_address,
                    destination: leg.end_address,
                    distance: leg.distance.text,
                    duration: leg.duration.text,
                    routeData: JSON.stringify(apiRoute)
                };

                await INSERT.into(Routes).entries(routeEntry);
                console.log('Created route with ID:', routeId);

                // Create RouteDirections entry with composition and flattened bounds
                const directionEntry = {
                    route_ID: routeId,
                    origin: leg.start_address,
                    destination: leg.end_address,
                    distance: leg.distance.text,
                    duration: leg.duration.text,
                    copyrights: response.copyrights || 'Google Maps',
                    // Flatten bounds structure for database storage
                    bounds_northeast_lat: apiRoute.bounds.northeast.lat,
                    bounds_northeast_lng: apiRoute.bounds.northeast.lng,
                    bounds_southwest_lat: apiRoute.bounds.southwest.lat,
                    bounds_southwest_lng: apiRoute.bounds.southwest.lng,
                    rawData: JSON.stringify(response),
                    steps: leg.steps.map((step, index) => ({
                        stepNumber: index + 1,
                        instruction: step.html_instructions.replace(/<[^>]*>/g, ''), // Strip HTML tags
                        distance: step.distance.text,
                        duration: step.duration.text,
                        startLat: step.start_location.lat,
                        startLng: step.start_location.lng,
                        endLat: step.end_location.lat,
                        endLng: step.end_location.lng,
                        travelMode: step.travel_mode,
                        maneuver: step.maneuver || 'straight'
                    }))
                };

                // Insert RouteDirections with deep composition (steps are inserted automatically)
                await INSERT.into(RouteDirections).entries(directionEntry);

                console.log(`Successfully saved directions: ${directionEntry.distance}, ${directionEntry.duration}`);
                console.log(`Total steps: ${directionEntry.steps.length}`);

                // Return the created entity with all data including steps
                return await SELECT.one.from(RouteDirections)
                    .where({ route_ID: routeId })
                    .columns(r => {
                        r`.*`, 
                        r.steps(s => s`.*`)
                    });

            } catch (error) {
                console.error('=== ERROR DETAILS ===');
                
                if (error.response) {
                    // HTTP error from destination/API
                    console.error('API error:', error.response.status, error.response.statusText);
                    console.error('Response data:', JSON.stringify(error.response.data, null, 2));
                    req.error(error.response.status, error.response.data?.error_message || 'External API error');
                } else if (error.request) {
                    // Request made but no response received
                    console.error('No response received:', error.message);
                    console.error('Request config:', error.config);
                    req.error(503, 'Google Maps API is unreachable');
                } else if (error.code) {
                    // Database or CDS error
                    console.error('Database/CDS error:', error.message);
                    console.error('Error code:', error.code);
                    console.error('Stack:', error.stack);
                    req.error(500, `Database error: ${error.message}`);
                } else {
                    // Other errors (setup, configuration, etc.)
                    console.error('Request setup error:', error.message);
                    console.error('Stack:', error.stack);
                    req.error(500, `Failed to fetch directions: ${error.message}`);
                }
                
                console.error('=== END ERROR DETAILS ===');
            }
        });

        return super.init();
    }
};

