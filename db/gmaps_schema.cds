namespace gmaps_schema;

using { managed, cuid } from '@sap/cds/common';

// /**
//  * Stored route information
//  */
entity Routes : managed, cuid {
    origin      : String(500) @title: 'Origin';
    destination : String(500) @title: 'Destination';
    distance    : String(100) @title: 'Distance';
    duration    : String(100) @title: 'Duration';
    routeData   : LargeString @title: 'Route Data (JSON)';
}

/**
 * Detailed route directions with steps
 */
entity RouteDirections : managed {
    key route       : Association to Routes @title: 'Route';
    origin      : String(500) @title: 'Origin Address';
    destination : String(500) @title: 'Destination Address';
    distance    : String(100) @title: 'Total Distance';
    duration    : String(100) @title: 'Total Duration'; 
    // Bounds for map display
    bounds      : {
        northeast : { lat: Double; lng: Double; };
        southwest : { lat: Double; lng: Double; };
    };
    
    // Navigation steps
    steps       : Composition of many RouteSteps on steps.direction = $self;
    
    // Raw JSON for reference
    rawData     : LargeString @title: 'Raw API Response';
}

/**
 * Individual navigation steps/instructions
 */
entity RouteSteps : cuid {
    direction       : Association to RouteDirections;
    stepNumber      : Integer @title: 'Step #';
    instruction     : String(1000) @title: 'Instruction';
    distance        : String(50) @title: 'Distance';
    duration        : String(50) @title: 'Duration';
    startLat        : Double @title: 'Start Latitude';
    startLng        : Double @title: 'Start Longitude';
    endLat          : Double @title: 'End Latitude';
    endLng          : Double @title: 'End Longitude';
    travelMode      : String(50) @title: 'Travel Mode';
    maneuver        : String(100) @title: 'Maneuver';
}