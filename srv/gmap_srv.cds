using { gmaps_schema } from '../db/gmaps_schema';

@requires: 'authenticated-user'
service GmapsService {

    @odata.draft.enabled
    @restrict: [
        { grant: ['READ', 'WRITE'], to: 'gmaps_user' }
    ]
    entity Routes as projection on gmaps_schema.Routes;
    
    @readonly
    @restrict: [
        { grant: 'READ', to: 'gmaps_user' }
    ]
    entity RouteDirections as projection on gmaps_schema.RouteDirections;
    
    @readonly
    @restrict: [
        { grant: 'READ', to: 'gmaps_user' }
    ]
    entity RouteSteps as projection on gmaps_schema.RouteSteps;
    
    /**
     * Get directions from origin to destination and save details
     * @param from - Starting location (address or coordinates)
     * @param to - Destination location (address or coordinates)
     */
    @restrict: [
        { grant: 'EXECUTE', to: 'gmaps_user' }
    ]
    action getDirections(from: String, to: String) returns RouteDirections;
}
