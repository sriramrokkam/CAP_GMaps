namespace gmaps_schema;

using { managed, cuid } from '@sap/cds/common';

/**
 * Persisted outbound delivery headers — upserted from EWM on every READ,
 * enabling cron jobs, bots, and IoT/Kafka consumers to query local data.
 */
entity OutboundDeliveries : managed {
    key DeliveryDocument                  : String(10)   @title: 'Delivery Document';
        ActualDeliveryRoute               : String(6)    @title: 'Route';
        ShippingPoint                     : String(4)    @title: 'Shipping Point';
        ShipToParty                       : String(10)   @title: 'Ship-To Party';
        SalesOrganization                 : String(4)    @title: 'Sales Organization';
        ShippingCondition                 : String(2)    @title: 'Shipping Condition';
        HeaderGrossWeight                 : Decimal(13,3)@title: 'Gross Weight';
        HeaderNetWeight                   : Decimal(13,3)@title: 'Net Weight';
        // Status fields
        HdrGoodsMvtIncompletionStatus     : String(1)    @title: 'Goods Mvt Status';
        HeaderBillgIncompletionStatus     : String(1)    @title: 'Billing Status';
        // Delivery date — stored as ISO string (EWM returns OData V2 /Date(ms)/ format)
        DeliveryDate                      : DateTime     @title: 'Delivery Date';
        // Driver assignment fields — populated by JOIN in READ handler
        DriverStatus                      : String(20)   @title: 'Driver Status';
        DriverMobile                      : String(20)   @title: 'Driver Mobile';
        DriverTruck                       : String(20)   @title: 'Truck';
        EstimatedDistance                 : String(100)  @title: 'Est. Distance';
        EstimatedDuration                 : String(100)  @title: 'Est. Duration';
}

/**
 * Persisted delivery line items — upserted from EWM on every getDeliveryItems call.
 */
entity DeliveryItems : managed {
    key DeliveryDocument      : String(10)    @title: 'Delivery Document';
    key DeliveryDocumentItem  : String(6)     @title: 'Item';
        Material              : String(40)    @title: 'Material';
        DeliveryQuantity      : Decimal(13,3) @title: 'Quantity';
        DeliveryQuantityUnit  : String(3)     @title: 'Unit';
        Plant                 : String(4)     @title: 'Plant';
        StorageLocation       : String(4)     @title: 'Storage Location';
        TransportationGroup   : String(4)     @title: 'Transport Group';
        // Association to header
        delivery              : Association to OutboundDeliveries on delivery.DeliveryDocument = DeliveryDocument;
}

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