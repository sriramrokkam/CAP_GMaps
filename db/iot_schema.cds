namespace iot_schema;
using { managed } from '@sap/cds/common';

/**
 * Driver assignment — created when dispatcher assigns a driver to a delivery.
 * MobileNumber is mandatory. TruckRegistration is optional (null for walking deliveries).
 */
entity DriverAssignment : managed {
    key ID                : UUID;
        DeliveryDocument  : String(10)    @title: 'Delivery Document';
        MobileNumber      : String(20)    @title: 'Mobile Number';      // mandatory
        TruckRegistration : String(20)    @title: 'Truck Registration'; // nullable
        AssignedAt        : DateTime      @title: 'Assigned At';
        DeliveredAt       : DateTime      @title: 'Delivered At';       // set on confirmation
        Status            : String(20)    @title: 'Status';             // ASSIGNED | IN_TRANSIT | DELIVERED
        KafkaTopic        : String(100)   @title: 'Kafka Topic';        // 'gps-{DeliveryDocument}'
        QRCodeUrl         : String(500)   @title: 'QR Code URL';        // '/tracking/index.html#<ID>'
        QRCodeImage       : LargeString   @title: 'QR Code Image';      // base64 PNG data URL
}

/**
 * GPS coordinate pings — one row per 30-second emission from driver mobile.
 * Latest row per assignment = current truck position.
 */
entity GpsCoordinates : managed {
    key ID            : UUID;
        assignment_ID : UUID          @title: 'Assignment ID';   // FK to DriverAssignment
        Latitude      : Double        @title: 'Latitude';
        Longitude     : Double        @title: 'Longitude';
        Speed         : Double        @title: 'Speed (m/s)';     // nullable
        Accuracy      : Double        @title: 'Accuracy (m)';    // nullable
        RecordedAt    : DateTime      @title: 'Recorded At';
}
