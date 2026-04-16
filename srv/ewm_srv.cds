// srv/ewm_srv.cds
using { gmaps_schema } from '../db/gmaps_schema';

@requires: 'authenticated-user'
service EwmService {

    // Persisted delivery headers — backed by DB table, proxied from EWM on READ
    @restrict: [{ grant: ['READ'], to: 'gmaps_user' }]
    entity OutboundDeliveries as projection on gmaps_schema.OutboundDeliveries;

    // Persisted delivery line items — backed by DB table, upserted from EWM on getDeliveryItems
    @restrict: [{ grant: ['READ'], to: 'gmaps_user' }]
    entity DeliveryItems as projection on gmaps_schema.DeliveryItems;

    // Expose RouteDirections so the action return type is valid within this service
    @readonly
    entity RouteDirections as projection on gmaps_schema.RouteDirections;

    @restrict: [{ grant: 'EXECUTE', to: 'gmaps_user' }]
    action getDeliveryRoute(deliveryDoc: String) returns RouteDirections;

    @restrict: [{ grant: 'EXECUTE', to: 'gmaps_user' }]
    action getDeliveryItems(deliveryDoc: String) returns array of DeliveryItems;
}
