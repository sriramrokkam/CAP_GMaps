using { iot_schema } from '../db/iot_schema';

@requires: 'any'
service TrackingService {

    @restrict: [{ grant: 'READ', to: 'authenticated-user' }]
    entity DriverAssignment as projection on iot_schema.DriverAssignment;

    @restrict: [{ grant: 'READ', to: 'authenticated-user' }]
    entity Driver as projection on iot_schema.Driver;

    @restrict: [{ grant: 'EXECUTE', to: 'gmaps_user' }]
    action assignDriver(
        deliveryDoc       : String,
        mobileNumber      : String,
        truckRegistration : String,
        driverName        : String
    ) returns DriverAssignment;

    @restrict: [{ grant: 'EXECUTE', to: 'gmaps_user' }]
    action getQRCode(
        deliveryDoc : String
    ) returns DriverAssignment;

    @requires: 'any'
    action updateLocation(
        assignmentId : UUID,
        latitude     : Double,
        longitude    : Double,
        speed        : Double,
        accuracy     : Double
    ) returns Boolean;

    @requires: 'any'
    action confirmDelivery(
        assignmentId : UUID
    ) returns Boolean;

    @requires: 'any'
    function getAssignment(
        assignmentId : UUID
    ) returns {
        ID                : UUID;
        DeliveryDocument  : String;
        MobileNumber      : String;
        DriverName        : String;
        TruckRegistration : String;
        Status            : String;
        AssignedAt        : DateTime;
        DeliveredAt       : DateTime;
        CurrentLat        : Double;
        CurrentLng        : Double;
        EventTopic        : String;
    };

    @requires: 'any'
    function latestGps(
        assignmentId : UUID
    ) returns {
        Latitude  : Double;
        Longitude : Double;
        Speed     : Double;
        LastGpsAt : DateTime;
    };
}
