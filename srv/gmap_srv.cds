using { gmaps_schema } from '../db/gmaps_schema';

service GmapsService {

    @odata.draft.enabled
    entity Routes as projection on gmaps_schema.Routes;
    entity RouteDirections as projection on gmaps_schema.RouteDirections;
    entity RouteSteps as projection on gmaps_schema.RouteSteps;
    
    /**
     * Get directions from origin to destination and save details
     * @param from - Starting location (address or coordinates)
     * @param to - Destination location (address or coordinates)
     */
    action getDirections(from: String, to: String) returns RouteDirections;
}
