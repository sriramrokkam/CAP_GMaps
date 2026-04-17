using EwmService as service from '../../srv/ewm_srv';

// Filter bar labels — Fiori Elements reads @Common.Label for SelectionFields
annotate service.OutboundDeliveries with {
    HdrGoodsMvtIncompletionStatus  @Common.Label: 'Goods Mvt Status';
    HeaderBillgIncompletionStatus  @Common.Label: 'Billing Status';
    DeliveryDate                   @Common.Label: 'Delivery Date';
};

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
        ShippingPoint,
        HdrGoodsMvtIncompletionStatus,
        HeaderBillgIncompletionStatus,
        DeliveryDate
    ],
    UI.LineItem: [
        { $Type: 'UI.DataField', Value: DeliveryDocument,                Label: 'Delivery' },
        { $Type: 'UI.DataField', Value: ActualDeliveryRoute,             Label: 'Route' },
        { $Type: 'UI.DataField', Value: ShippingPoint,                   Label: 'Shipping Point' },
        { $Type: 'UI.DataField', Value: ShipToParty,                     Label: 'Ship-To Party' },
        { $Type: 'UI.DataField', Value: SalesOrganization,               Label: 'Sales Org' },
        { $Type: 'UI.DataField', Value: ShippingCondition,               Label: 'Shipping Cond.' },
        { $Type: 'UI.DataField', Value: HdrGoodsMvtIncompletionStatus,   Label: 'Goods Mvt Status' },
        { $Type: 'UI.DataField', Value: HeaderBillgIncompletionStatus,   Label: 'Billing Status' },
        { $Type: 'UI.DataField', Value: DeliveryDate,                    Label: 'Delivery Date' },
        { $Type: 'UI.DataField', Value: HeaderGrossWeight,               Label: 'Gross Weight' },
        { $Type: 'UI.DataField', Value: HeaderNetWeight,                 Label: 'Net Weight' },
        { $Type: 'UI.DataField', Value: DriverStatus,                    Label: 'Driver Status' },
        { $Type: 'UI.DataField', Value: DriverTruck,                     Label: 'Truck' },
        { $Type: 'UI.DataField', Value: DriverMobile,                    Label: 'Driver Mobile' },
        { $Type: 'UI.DataField', Value: EstimatedDistance,               Label: 'Est. Distance' },
        { $Type: 'UI.DataField', Value: EstimatedDuration,               Label: 'Est. Duration' }
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
            { $Type: 'UI.DataField', Value: DeliveryDocument,                Label: 'Delivery Document' },
            { $Type: 'UI.DataField', Value: ActualDeliveryRoute,             Label: 'Delivery Route' },
            { $Type: 'UI.DataField', Value: ShippingPoint,                   Label: 'Shipping Point' },
            { $Type: 'UI.DataField', Value: ShipToParty,                     Label: 'Ship-To Party' },
            { $Type: 'UI.DataField', Value: SalesOrganization,               Label: 'Sales Organization' },
            { $Type: 'UI.DataField', Value: ShippingCondition,               Label: 'Shipping Condition' },
            { $Type: 'UI.DataField', Value: HdrGoodsMvtIncompletionStatus,   Label: 'Goods Movement Status' },
            { $Type: 'UI.DataField', Value: HeaderBillgIncompletionStatus,   Label: 'Billing Status' },
            { $Type: 'UI.DataField', Value: DeliveryDate,                    Label: 'Delivery Date' },
            { $Type: 'UI.DataField', Value: HeaderGrossWeight,               Label: 'Gross Weight' },
            { $Type: 'UI.DataField', Value: HeaderNetWeight,                 Label: 'Net Weight' },
            { $Type: 'UI.DataField', Value: EstimatedDistance,               Label: 'Est. Distance' },
            { $Type: 'UI.DataField', Value: EstimatedDuration,               Label: 'Est. Duration' },
            { $Type: 'UI.DataField', Value: DriverStatus,                    Label: 'Driver Status' },
            { $Type: 'UI.DataField', Value: DriverTruck,                     Label: 'Truck' },
            { $Type: 'UI.DataField', Value: DriverMobile,                    Label: 'Driver Mobile' }
        ]
    }
);
