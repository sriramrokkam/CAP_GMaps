// srv/ewm_srv.cds
using { gmaps_schema } from '../db/gmaps_schema';

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
    }

    // Virtual entity — used only as action return type, not persisted
    entity DeliveryItems {
        key DeliveryDocumentItem : String(6);
            Material             : String(40);
            DeliveryQuantity     : Decimal(13,3);
            DeliveryQuantityUnit : String(3);
            Plant                : String(4);
            StorageLocation      : String(4);
            TransportationGroup  : String(4);
    }

    // Expose RouteDirections so the action return type is valid within this service
    @readonly
    entity RouteDirections as projection on gmaps_schema.RouteDirections;

    @restrict: [{ grant: 'EXECUTE', to: 'gmaps_user' }]
    action getDeliveryRoute(deliveryDoc: String) returns RouteDirections;

    @restrict: [{ grant: 'EXECUTE', to: 'gmaps_user' }]
    action getDeliveryItems(deliveryDoc: String) returns array of DeliveryItems;
}
