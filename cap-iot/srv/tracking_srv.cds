using { iot_schema } from '../db/iot_schema';

@requires: 'authenticated-user'
service TrackingService {

    @readonly
    entity DriverAssignment as projection on iot_schema.DriverAssignment;

    @readonly
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
    function latestGps(
        assignmentId : UUID
    ) returns {
        Latitude  : Double;
        Longitude : Double;
        Speed     : Double;
        LastGpsAt : DateTime;
    };
}
