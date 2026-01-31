using GmapsService as service from '../../srv/gmap_srv';
annotate service.RouteDirections with @(
    UI.FieldGroup #GeneratedGroup : {
        $Type : 'UI.FieldGroupType',
        Data : [
            {
                $Type : 'UI.DataField',
                Value : origin,
            },
            {
                $Type : 'UI.DataField',
                Value : destination,
            },
            {
                $Type : 'UI.DataField',
                Value : distance,
            },
            {
                $Type : 'UI.DataField',
                Value : duration,
            },
            {
                $Type : 'UI.DataField',
                Label : 'bounds_northeast_lat',
                Value : bounds_northeast_lat,
            },
            {
                $Type : 'UI.DataField',
                Label : 'bounds_northeast_lng',
                Value : bounds_northeast_lng,
            },
            {
                $Type : 'UI.DataField',
                Label : 'bounds_southwest_lat',
                Value : bounds_southwest_lat,
            },
            {
                $Type : 'UI.DataField',
                Label : 'bounds_southwest_lng',
                Value : bounds_southwest_lng,
            },
        ],
    },
    UI.Facets : [
        {
            $Type : 'UI.ReferenceFacet',
            ID : 'GeneratedFacet1',
            Label : 'General Information',
            Target : '@UI.FieldGroup#GeneratedGroup',
        },
        {
            $Type : 'UI.CollectionFacet',
            Label : 'Directions',
            ID : 'GroupSteps',
            Facets : [
                {
                    $Type : 'UI.ReferenceFacet',
                    Label : 'Steps',
                    ID : 'Steps',
                    Target : 'steps/@UI.PresentationVariant#SortedSteps',
                },
            ],
        },
    ],
    UI.LineItem : [
        {
            $Type : 'UI.DataField',
            Value : origin,
        },
        {
            $Type : 'UI.DataField',
            Value : destination,
        },
        {
            $Type : 'UI.DataField',
            Value : distance,
        },
        {
            $Type : 'UI.DataField',
            Value : duration,
        },
        {
            $Type : 'UI.DataFieldForAction',
            Action : 'GmapsService.EntityContainer/getDirections',
            Label : 'getDirections',
        },
    ],
    UI.SelectionFields : [
        origin,
        destination,
    ],
    UI.HeaderInfo : {
        Title : {
            $Type : 'UI.DataField',
            Value : destination,
        },
        TypeName : 'Display Route',
        TypeNamePlural : 'Routes',
    },
);

annotate service.RouteDirections with {
    route @Common.ValueList : {
        $Type : 'Common.ValueListType',
        CollectionPath : 'Routes',
        Parameters : [
            {
                $Type : 'Common.ValueListParameterInOut',
                LocalDataProperty : route_ID,
                ValueListProperty : 'ID',
            },
            {
                $Type : 'Common.ValueListParameterDisplayOnly',
                ValueListProperty : 'origin',
            },
            {
                $Type : 'Common.ValueListParameterDisplayOnly',
                ValueListProperty : 'destination',
            },
            {
                $Type : 'Common.ValueListParameterDisplayOnly',
                ValueListProperty : 'distance',
            },
            {
                $Type : 'Common.ValueListParameterDisplayOnly',
                ValueListProperty : 'duration',
            },
        ],
    }
};

annotate service.RouteSteps with @(
    UI.Facets : [
        {
            $Type : 'UI.ReferenceFacet',
            Label : 'Detailed Steps',
            ID : 'Steps',
            Target : '@UI.FieldGroup#Steps',
        },
    ],
    UI.FieldGroup #Steps : {
        $Type : 'UI.FieldGroupType',
        Data : [
            {
                $Type : 'UI.DataField',
                Value : direction.steps.distance,
            },
            {
                $Type : 'UI.DataField',
                Value : direction.steps.duration,
            },
            {
                $Type : 'UI.DataField',
                Value : direction.steps.endLat,
            },
            {
                $Type : 'UI.DataField',
                Value : direction.steps.endLng,
            },
            {
                $Type : 'UI.DataField',
                Value : direction.steps.instruction,
            },
            {
                $Type : 'UI.DataField',
                Value : direction.steps.maneuver,
            },
            {
                $Type : 'UI.DataField',
                Value : direction.steps.startLat,
            },
            {
                $Type : 'UI.DataField',
                Value : direction.steps.startLng,
            },
            {
                $Type : 'UI.DataField',
                Value : direction.steps.stepNumber,
            },
            {
                $Type : 'UI.DataField',
                Value : direction.steps.travelMode,
            },
        ],
    },
    UI.LineItem #RouteSteps : [
        {
            $Type : 'UI.DataField',
            Value : direction.steps.stepNumber,
            @UI.Importance : #High,
        },
        {
            $Type : 'UI.DataField',
            Value : direction.steps.instruction,
        },
        {
            $Type : 'UI.DataField',
            Value : direction.steps.distance,
        },
        {
            $Type : 'UI.DataField',
            Value : direction.steps.duration,
        },
        {
            $Type : 'UI.DataField',
            Value : direction.steps.startLat,
        },
        {
            $Type : 'UI.DataField',
            Value : direction.steps.startLng,
        },
        {
            $Type : 'UI.DataField',
            Value : direction.steps.endLat,
        },
        {
            $Type : 'UI.DataField',
            Value : direction.steps.endLng,
        },
        {
            $Type : 'UI.DataField',
            Value : direction.steps.maneuver,
        },
        {
            $Type : 'UI.DataField',
            Value : direction.steps.travelMode,
        },
        {
            $Type : 'UI.DataField',
            Value : direction.steps.direction_route_ID,
            Label : 'direction_route_ID',
        },
    ],
    UI.LineItem #Steps : [
        {
            $Type : 'UI.DataField',
            Value : stepNumber,
            @UI.Importance : #High,
        },
        {
            $Type : 'UI.DataField',
            Value : instruction,
        },
        {
            $Type : 'UI.DataField',
            Value : distance,
        },
        {
            $Type : 'UI.DataField',
            Value : duration,
        },
        {
            $Type : 'UI.DataField',
            Value : maneuver,
        },
        {
            $Type : 'UI.DataField',
            Value : travelMode,
        },
        {
            $Type : 'UI.DataField',
            Value : startLat,
        },
        {
            $Type : 'UI.DataField',
            Value : startLng,
        },
        {
            $Type : 'UI.DataField',
            Value : endLat,
        },
        {
            $Type : 'UI.DataField',
            Value : endLng,
        },
    ],
    UI.PresentationVariant #SortedSteps : {
        $Type : 'UI.PresentationVariantType',
        Visualizations : [
            '@UI.LineItem#Steps',
        ],
        SortOrder : [
            {
                $Type : 'Common.SortOrderType',
                Property : stepNumber,
                Descending : false,
            },
        ],
    },
    UI.FieldGroup #MapView : {
        $Type : 'UI.FieldGroupType',
        Data : [
        ],
    },
    UI.HeaderInfo : {
        Title : {
            $Type : 'UI.DataField',
            Value : stepNumber,
        },
        TypeName : '',
        TypeNamePlural : '',
        ImageUrl : maneuver,
        Description : {
            $Type : 'UI.DataField',
            Value : maneuver,
        },
    },
);

annotate service.RouteDirections with {
    origin @Common.Label : 'Source Address'
};