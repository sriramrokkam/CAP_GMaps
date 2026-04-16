// srv/ewm_srv.cds
using { GmapsService } from './gmap_srv';

@requires: 'authenticated-user'
service EwmService {

    @readonly
    @restrict: [{ grant: 'READ', to: 'gmaps_user' }]
    entity OutboundDeliveries {
        key DeliveryDocument        : String(10);
            ActualDeliveryRoute     : String(6);
            ShippingPoint           : String(4);
            ShipToParty             : String(10);
            SalesOrganization       : String(4);
            ShippingCondition       : String(2);
            HeaderGrossWeight       : Decimal(13,3);
            HeaderNetWeight         : Decimal(13,3);
            ShippingLocationTimezone: String(10);
    }

    @restrict: [{ grant: 'EXECUTE', to: 'gmaps_user' }]
    action getDeliveryRoute(deliveryDoc: String) returns GmapsService.RouteDirections;
}
