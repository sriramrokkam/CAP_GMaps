namespace iot_schema;
using { managed } from '@sap/cds/common';

/**
 * Driver master data — auto-registered on first assignDriver call.
 */
entity Driver : managed {
    key ID                : UUID;
        MobileNumber      : String(20)  @title: 'Mobile Number';
        DriverName        : String(100) @title: 'Driver Name';
        TruckRegistration : String(20)  @title: 'Default Truck';
        LicenseNumber     : String(50)  @title: 'License Number';
        IsActive          : Boolean default true @title: 'Active';
}

/**
 * Driver assignment — one per delivery trip.
 * GPS stored as start/current/end only — no history table.
 */
entity DriverAssignment : managed {
    key ID                : UUID;
        driver            : Association to Driver;
        DeliveryDocument  : String(10)    @title: 'Delivery Document';
        MobileNumber      : String(20)    @title: 'Mobile Number';
        DriverName        : String(100)   @title: 'Driver Name';
        TruckRegistration : String(20)    @title: 'Truck Registration';
        AssignedAt        : DateTime      @title: 'Assigned At';
        DeliveredAt       : DateTime      @title: 'Delivered At';
        Status            : String(20) default 'ASSIGNED' @title: 'Status';
        EventTopic        : String(200)   @title: 'Event Mesh Topic';
        QRCodeUrl         : String(500)   @title: 'QR Code URL';
        QRCodeImage       : LargeString   @title: 'QR Code Image';
        EstimatedDistance : String(100)   @title: 'Est. Distance';
        EstimatedDuration : String(100)   @title: 'Est. Duration';
        StartLat          : Double        @title: 'Start Latitude';
        StartLng          : Double        @title: 'Start Longitude';
        StartedAt         : DateTime      @title: 'Trip Started At';
        CurrentLat        : Double        @title: 'Current Latitude';
        CurrentLng        : Double        @title: 'Current Longitude';
        CurrentSpeed      : Double        @title: 'Current Speed (m/s)';
        LastGpsAt         : DateTime      @title: 'Last GPS At';
        EndLat            : Double        @title: 'End Latitude';
        EndLng            : Double        @title: 'End Longitude';
}
