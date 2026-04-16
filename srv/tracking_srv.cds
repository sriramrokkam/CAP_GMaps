// srv/tracking_srv.cds
using { iot_schema } from '../db/iot_schema';

@requires: 'authenticated-user'
service TrackingService {

    @readonly
    entity DriverAssignment as projection on iot_schema.DriverAssignment;

    @readonly
    entity GpsCoordinates as projection on iot_schema.GpsCoordinates;

    // Dispatcher actions — require authenticated user
    @restrict: [{ grant: 'EXECUTE', to: 'gmaps_user' }]
    action assignDriver(
        deliveryDoc       : String,
        mobileNumber      : String,
        truckRegistration : String    // optional
    ) returns DriverAssignment;

    @restrict: [{ grant: 'EXECUTE', to: 'gmaps_user' }]
    action getQRCode(
        deliveryDoc : String
    ) returns DriverAssignment;

    // Driver actions — no SAP login, called from mobile browser
    // assignmentId UUID acts as shared secret (128-bit, unguessable)
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
    ) returns GpsCoordinates;
}
