using EwmService as service from '../../srv/ewm_srv';

annotate service.OutboundDeliveries with @(
    UI.HeaderInfo: {
        TypeName:       'Outbound Delivery',
        TypeNamePlural: 'Outbound Deliveries',
        Title: {
            $Type: 'UI.DataField',
            Value: DeliveryDocument
        },
        Description: {
            $Type: 'UI.DataField',
            Value: ActualDeliveryRoute
        }
    },
    UI.SelectionFields: [
        DeliveryDocument,
        ActualDeliveryRoute,
        SalesOrganization,
        ShipToParty,
        ShippingPoint
    ],
    UI.LineItem: [
        { $Type: 'UI.DataField', Value: DeliveryDocument,        Label: 'Delivery' },
        { $Type: 'UI.DataField', Value: ActualDeliveryRoute,     Label: 'Route' },
        { $Type: 'UI.DataField', Value: ShippingPoint,           Label: 'Shipping Point' },
        { $Type: 'UI.DataField', Value: ShipToParty,             Label: 'Ship-To Party' },
        { $Type: 'UI.DataField', Value: SalesOrganization,       Label: 'Sales Org' },
        { $Type: 'UI.DataField', Value: ShippingCondition,       Label: 'Shipping Cond.' },
        { $Type: 'UI.DataField', Value: HeaderGrossWeight,       Label: 'Gross Weight' },
        { $Type: 'UI.DataField', Value: HeaderNetWeight,         Label: 'Net Weight' }
    ],
    UI.Facets: [
        {
            $Type:  'UI.ReferenceFacet',
            ID:     'GeneralInfo',
            Label:  'Delivery Details',
            Target: '@UI.FieldGroup#DeliveryDetails'
        }
    ],
    UI.FieldGroup #DeliveryDetails: {
        $Type: 'UI.FieldGroupType',
        Data: [
            { $Type: 'UI.DataField', Value: DeliveryDocument,        Label: 'Delivery Document' },
            { $Type: 'UI.DataField', Value: ActualDeliveryRoute,     Label: 'Delivery Route' },
            { $Type: 'UI.DataField', Value: ShippingPoint,           Label: 'Shipping Point' },
            { $Type: 'UI.DataField', Value: ShipToParty,             Label: 'Ship-To Party' },
            { $Type: 'UI.DataField', Value: SalesOrganization,       Label: 'Sales Organization' },
            { $Type: 'UI.DataField', Value: ShippingCondition,       Label: 'Shipping Condition' },
            { $Type: 'UI.DataField', Value: HeaderGrossWeight,       Label: 'Gross Weight' },
            { $Type: 'UI.DataField', Value: HeaderNetWeight,         Label: 'Net Weight' }
        ]
    }
);
