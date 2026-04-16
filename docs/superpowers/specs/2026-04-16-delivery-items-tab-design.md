# Delivery Items Tab — Design Spec

**Date:** 2026-04-16
**Branch:** feature_add_ewmodo_v2

---

## Goal

Add a "Delivery Items" tab to the Outbound Delivery Object Page that lists all line items for the selected delivery, fetched live from the EWM sandbox (`A_OutbDeliveryItem`).

---

## Object Page Tab Order

```
[Delivery Details]  →  [Delivery Items]  →  [Route & Map]
```

`Delivery Items` sits between the existing `Delivery Details` facet and the existing `Route & Map` custom section.

---

## Backend

### New entity in `srv/ewm_srv.cds`

A virtual (non-persisted) entity used only as an action return type:

```cds
entity DeliveryItems {
    key DeliveryDocumentItem : String(6);
        Material             : String(40);
        MaterialName         : String(100);
        DeliveryQuantity     : Decimal(13,3);
        DeliveryQuantityUnit : String(3);
        Plant                : String(4);
        StorageLocation      : String(4);
        TransportationGroup  : String(4);
}
```

### New action in `srv/ewm_srv.cds`

```cds
action getDeliveryItems(deliveryDoc: String) returns array of DeliveryItems;
```

### Handler in `srv/ewm_srv.js`

`this.on('getDeliveryItems', async (req) => { ... })`

- Reads `deliveryDoc` from `req.data`
- Calls EWM API: `GET /s4hanacloud/sap/opu/odata/sap/API_OUTBOUND_DELIVERY_SRV;v=0002/A_OutbDeliveryItem?$filter=DeliveryDocument eq '{deliveryDoc}'&$select=DeliveryDocumentItem,Material,MaterialName,DeliveryQuantity,DeliveryQuantityUnit,Plant,StorageLocation,TransportationGroup`
- Maps OData V2 response (`d.results`) to `DeliveryItems` array
- Returns array (empty array on no results, error on failure)

### Future persistence hook

The action is intentionally pure (fetch + return). A future cron job can call `getDeliveryItems` and upsert results into a CAP-persisted `DeliveryItems` entity in `db/gmaps_schema.cds` without changing the action signature.

---

## Frontend

### New files

| File | Purpose |
|------|---------|
| `app/deliveries/webapp/ext/fragment/DeliveryItems.fragment.xml` | `sap.m.Table` with item columns |
| `app/deliveries/webapp/ext/fragment/DeliveryItems.js` | Controller: calls action, populates JSONModel |

### Fragment (`DeliveryItems.fragment.xml`)

`sap.m.Table` with columns:

| Column | Field |
|--------|-------|
| Item | `DeliveryDocumentItem` |
| Material | `Material` |
| Description | `MaterialName` |
| Quantity | `DeliveryQuantity` + `DeliveryQuantityUnit` |
| Plant | `Plant` |
| Storage Loc. | `StorageLocation` |
| Transport Grp | `TransportationGroup` |

Includes a loading state (busy on the table) and an error `MessageStrip` for failures.

### Controller (`DeliveryItems.js`)

Pattern mirrors `DeliveryMap.js`:

1. On `afterRendering` of the container, read `DeliveryDocument` from binding context (poll up to 10× / 300 ms)
2. Call `oModel.bindContext("/getDeliveryItems(...)")`, set parameter, execute
3. On success: bind result array to a `JSONModel`, set on table
4. On error: show `MessageStrip` with error text
5. Uses same `_find()` DOM-query pattern for control lookup

### `manifest.json` change

Add `DeliveryItems` custom section **before** `DeliveryMap`:

```json
"sections": {
  "DeliveryItems": {
    "template": "ewm.deliveries.ext.fragment.DeliveryItems",
    "position": { "placement": "After", "anchor": "fe::FacetSection::GeneralInfo" },
    "title": "Delivery Items"
  },
  "DeliveryMap": {
    "template": "ewm.deliveries.ext.fragment.DeliveryMap",
    "position": { "placement": "After", "anchor": "fe::CustomSubSection::DeliveryItems" },
    "title": "Route & Map"
  }
}
```

---

## Error Handling

- Missing `deliveryDoc`: return `req.error(400, ...)`
- EWM API failure: log + return `req.error(500, ...)`
- Empty result (no items): return `[]`, frontend shows "No items found" text in table
- Frontend action failure: show `MessageStrip` (same as DeliveryMap pattern)

---

## Out of Scope

- Persisting items to SQLite (future cron job work)
- Item-level navigation / detail page
- Editing item quantities
