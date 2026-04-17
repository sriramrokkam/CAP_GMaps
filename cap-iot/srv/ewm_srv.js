// srv/ewm_srv.js
const cds = require('@sap/cds');

// Parse OData V2 /Date(milliseconds)/ format to ISO string
function _parseODataDate(val) {
    if (!val) return null;
    const m = String(val).match(/\/Date\((-?\d+)\)\//);
    if (m) return new Date(parseInt(m[1], 10)).toISOString();
    return null;
}

module.exports = class EwmService extends cds.ApplicationService {

    async init() {
        const ewmApi = await cds.connect.to('EWM-API');
        const bpApi  = await cds.connect.to('BP-API');
        const gmaps  = await cds.connect.to('GmapsService');
        const SANDBOX_KEY = process.env.SAP_SANDBOX_API_KEY || '';

        const { OutboundDeliveries, DeliveryItems } = this.entities;

        // ── LIST + SINGLE READ: proxy to EWM OData, upsert to local DB ──
        this.on('READ', 'OutboundDeliveries', async (req) => {
            const { query } = req;

            // Detect single-entity read by key (Object Page)
            // CDS WHERE AST for key access: [{ref:['DeliveryDocument']}, '=', {val:'80000002'}]
            // Detect single-entity read by key (Object Page)
            // For key access like OutboundDeliveries('80000002'), CDS puts key in req.data, not WHERE
            const where = query.SELECT?.where;
            const pairs = where ? _extractFilters(where) : [];
            const reqKey = req.data?.DeliveryDocument;
            const keyOnly = reqKey ? true : (pairs.length === 1 && pairs[0].field === 'DeliveryDocument');
            const singleDeliveryDoc = reqKey || (keyOnly ? pairs[0]?.value : null);
            console.log('[READ OutboundDeliveries] reqKey:', reqKey, 'keyOnly:', keyOnly);

            // For single-entity reads, serve from local DB (already upserted by list reads)
            // This avoids the key-predicate mismatch error and returns driver/distance fields
            if (keyOnly || reqKey) {
                const deliveryDoc = singleDeliveryDoc;
                const row = await cds.run(
                    SELECT.one.from(OutboundDeliveries).where({ DeliveryDocument: deliveryDoc })
                );
                if (row) {
                    // Enrich with driver assignment data
                    const { DriverAssignment } = cds.entities('iot_schema');
                    if (DriverAssignment) {
                        const a = await cds.run(
                            SELECT.one.from(DriverAssignment)
                                .where({ DeliveryDocument: deliveryDoc, Status: { '!=': 'DELIVERED' } })
                                .columns('MobileNumber','TruckRegistration','Status','EstimatedDistance','EstimatedDuration')
                        ).catch(() => null);
                        if (a) {
                            row.DriverStatus      = a.Status;
                            row.DriverMobile      = a.MobileNumber;
                            row.DriverTruck       = a.TruckRegistration || null;
                            row.EstimatedDistance  = a.EstimatedDistance || row.EstimatedDistance || null;
                            row.EstimatedDuration  = a.EstimatedDuration || row.EstimatedDuration || null;
                        }
                    }
                    return row;
                }
                // Not in local DB yet — fetch this specific delivery from EWM API
                const singleUrl = `/s4hanacloud/sap/opu/odata/sap/API_OUTBOUND_DELIVERY_SRV;v=0002/A_OutbDeliveryHeader('${deliveryDoc}')` +
                    `?$select=DeliveryDocument,ActualDeliveryRoute,ShippingPoint,ShipToParty,` +
                    `SalesOrganization,ShippingCondition,HeaderGrossWeight,HeaderNetWeight,` +
                    `HdrGoodsMvtIncompletionStatus,HeaderBillgIncompletionStatus,DeliveryDate`;
                try {
                    const singleRes = await ewmApi.send({ method: 'GET', path: singleUrl, headers: { 'APIKey': SANDBOX_KEY } });
                    const d = singleRes?.d || singleRes;
                    if (d && d.DeliveryDocument === deliveryDoc) {
                        const now = new Date().toISOString();
                        const singleRow = {
                            DeliveryDocument: d.DeliveryDocument, ActualDeliveryRoute: d.ActualDeliveryRoute,
                            ShippingPoint: d.ShippingPoint, ShipToParty: d.ShipToParty,
                            SalesOrganization: d.SalesOrganization, ShippingCondition: d.ShippingCondition,
                            HeaderGrossWeight: parseFloat(d.HeaderGrossWeight) || 0, HeaderNetWeight: parseFloat(d.HeaderNetWeight) || 0,
                            HdrGoodsMvtIncompletionStatus: d.HdrGoodsMvtIncompletionStatus || null,
                            HeaderBillgIncompletionStatus: d.HeaderBillgIncompletionStatus || null,
                            DeliveryDate: _parseODataDate(d.DeliveryDate), createdAt: now, modifiedAt: now
                        };
                        cds.run(UPSERT.into(OutboundDeliveries).entries(singleRow)).catch(() => {});
                        return singleRow;
                    }
                } catch (e) {
                    console.error(`Single delivery fetch failed for ${deliveryDoc}:`, e.message);
                }
                return req.error(404, `Delivery ${deliveryDoc} not found`);
            }

            // Build OData $filter from CDS WHERE clause
            const filters = [];
            if (where) {
                pairs.forEach(({ field, value }) => {
                    const map = {
                        DeliveryDocument:                 'DeliveryDocument',
                        ActualDeliveryRoute:              'ActualDeliveryRoute',
                        SalesOrganization:                'SalesOrganization',
                        ShipToParty:                      'ShipToParty',
                        ShippingPoint:                    'ShippingPoint',
                        HdrGoodsMvtIncompletionStatus:    'HdrGoodsMvtIncompletionStatus',
                        HeaderBillgIncompletionStatus:    'HeaderBillgIncompletionStatus'
                    };
                    if (map[field]) filters.push(`${map[field]} eq '${value}'`);
                });
            }

            const top  = query.SELECT?.limit?.rows?.val || 50;
            const skip = query.SELECT?.limit?.offset?.val || 0;

            let url = `/s4hanacloud/sap/opu/odata/sap/API_OUTBOUND_DELIVERY_SRV;v=0002/A_OutbDeliveryHeader` +
                `?$top=${top}&$skip=${skip}`;
            if (filters.length) url += `&$filter=${filters.join(' and ')}`;
            url += `&$select=DeliveryDocument,ActualDeliveryRoute,ShippingPoint,ShipToParty,` +
                   `SalesOrganization,ShippingCondition,HeaderGrossWeight,HeaderNetWeight,` +
                   `HdrGoodsMvtIncompletionStatus,HeaderBillgIncompletionStatus,DeliveryDate`;

            const res = await ewmApi.send({
                method: 'GET',
                path: url,
                headers: { 'APIKey': SANDBOX_KEY }
            });

            // OData V2 collection: { d: { results: [...] } }
            const now = new Date().toISOString();
            const rows = (res?.d?.results || res?.value || []).map(d => ({
                DeliveryDocument:              d.DeliveryDocument,
                ActualDeliveryRoute:           d.ActualDeliveryRoute,
                ShippingPoint:                 d.ShippingPoint,
                ShipToParty:                   d.ShipToParty,
                SalesOrganization:             d.SalesOrganization,
                ShippingCondition:             d.ShippingCondition,
                HeaderGrossWeight:             parseFloat(d.HeaderGrossWeight) || 0,
                HeaderNetWeight:               parseFloat(d.HeaderNetWeight) || 0,
                HdrGoodsMvtIncompletionStatus: d.HdrGoodsMvtIncompletionStatus || null,
                HeaderBillgIncompletionStatus: d.HeaderBillgIncompletionStatus || null,
                DeliveryDate:                  _parseODataDate(d.DeliveryDate),
                createdAt:                     now,
                modifiedAt:                    now
            }));

            // Upsert into local DB (fire-and-forget — don't block the response)
            if (rows.length > 0) {
                cds.run(UPSERT.into(OutboundDeliveries).entries(rows)).catch(err => {
                    console.error('OutboundDeliveries upsert error:', err.message);
                });
            }

            // Enrich rows with latest active driver assignment data
            const { DriverAssignment } = cds.entities('iot_schema');
            if (rows.length > 0 && DriverAssignment) {
                const docIds = rows.map(r => r.DeliveryDocument);
                const assignments = await cds.run(
                    SELECT.from(DriverAssignment)
                        .where({ DeliveryDocument: { in: docIds }, Status: { '!=': 'DELIVERED' } })
                        .columns('DeliveryDocument','MobileNumber','TruckRegistration','Status','EstimatedDistance','EstimatedDuration')
                ).catch(() => []);
                const assignMap = {};
                for (const a of assignments) assignMap[a.DeliveryDocument] = a;
                for (const row of rows) {
                    const a = assignMap[row.DeliveryDocument];
                    if (a) {
                        row.DriverStatus      = a.Status;
                        row.DriverMobile      = a.MobileNumber;
                        row.DriverTruck       = a.TruckRegistration || null;
                        row.EstimatedDistance = a.EstimatedDistance || null;
                        row.EstimatedDuration = a.EstimatedDuration || null;
                    }
                }
            }

            return rows;
        });

        // ── ACTION: resolve addresses → call getDirections ────────────────
        this.on('getDeliveryRoute', async (req) => {
            const { deliveryDoc } = req.data;
            if (!deliveryDoc) return req.error(400, 'deliveryDoc is required');

            try {
                // 1. Fetch delivery header to get ShippingPoint + ShipToParty
                const headerUrl = `/s4hanacloud/sap/opu/odata/sap/API_OUTBOUND_DELIVERY_SRV;v=0002/A_OutbDeliveryHeader('${deliveryDoc}')?$select=ShippingPoint,ShipToParty`;
                const headerRaw = await ewmApi.send({
                    method: 'GET', path: headerUrl,
                    headers: { 'APIKey': SANDBOX_KEY }
                });
                const header = headerRaw?.d || headerRaw;
                if (!header || !header.ShippingPoint || !header.ShipToParty) {
                    return req.error(404, `Delivery ${deliveryDoc} not found or missing ShippingPoint/ShipToParty`);
                }
                console.log(`[getDeliveryRoute] ShippingPoint=${header.ShippingPoint} ShipToParty=${header.ShipToParty}`);

                // 2. Resolve ShippingPoint address via BP API
                const fromAddress = await _resolveAddress(bpApi, header.ShippingPoint, SANDBOX_KEY);
                console.log(`[getDeliveryRoute] fromAddress="${fromAddress}"`);
                if (!fromAddress) return req.error(404, `Could not resolve address for ShippingPoint ${header.ShippingPoint}`);

                // 3. Resolve ShipToParty address via BP API
                const toAddress = await _resolveAddress(bpApi, header.ShipToParty, SANDBOX_KEY);
                console.log(`[getDeliveryRoute] toAddress="${toAddress}"`);
                if (!toAddress) return req.error(404, `Could not resolve address for ShipToParty ${header.ShipToParty}`);

                // 4. Validate addresses have enough content to geocode
                const MIN_ADDR_LEN = 6; // anything shorter is likely just a code (e.g. "DEHAM")
                if (fromAddress.replace(/[,\s]/g, '').length < MIN_ADDR_LEN) {
                    return req.error(400, `ShippingPoint address "${fromAddress}" is too short to geocode — BP address data may be incomplete`);
                }
                if (toAddress.replace(/[,\s]/g, '').length < MIN_ADDR_LEN) {
                    return req.error(400, `ShipToParty address "${toAddress}" is too short to geocode — BP address data may be incomplete`);
                }

                // 5. Delegate to GmapsService.getDirections (persists route automatically)
                let result;
                try {
                    result = await gmaps.send('getDirections', { from: fromAddress, to: toAddress });
                } catch (gmapsError) {
                    // Surface inner error details (CAP wraps remote errors as 502)
                    const innerBody = gmapsError.response?.body || gmapsError.cause?.message || '';
                    const innerMsg  = typeof innerBody === 'string' ? innerBody : JSON.stringify(innerBody);
                    console.error('getDeliveryRoute gmaps error:', JSON.stringify(gmapsError, null, 2));
                    return req.error(502, `GmapsService.getDirections failed for "${fromAddress}" → "${toAddress}": ${gmapsError.message}${innerMsg ? ' | ' + innerMsg : ''}`);
                }

                // 6. Write distance/duration back to OutboundDeliveries row (fire-and-forget)
                if (result && result.distance) {
                    cds.run(
                        UPDATE(OutboundDeliveries)
                            .set({ EstimatedDistance: result.distance, EstimatedDuration: result.duration || null })
                            .where({ DeliveryDocument: deliveryDoc })
                    ).catch(err => console.error('Route distance update error:', err.message));

                    // Also update any active DriverAssignment for this delivery
                    const { DriverAssignment } = cds.entities('iot_schema');
                    if (DriverAssignment) {
                        cds.run(
                            UPDATE(DriverAssignment)
                                .set({ EstimatedDistance: result.distance, EstimatedDuration: result.duration || null })
                                .where({ DeliveryDocument: deliveryDoc, Status: { '!=': 'DELIVERED' } })
                        ).catch(err => console.error('DriverAssignment distance update error:', err.message));
                    }
                }

                return result;
            } catch (error) {
                console.error('getDeliveryRoute error:', JSON.stringify(error, null, 2));
                return req.error(500, `Failed to get delivery route: ${error.message}`);
            }
        });

        // ── ACTION: fetch delivery line items from EWM, upsert to DB ─────
        this.on('getDeliveryItems', async (req) => {
            const { deliveryDoc } = req.data;
            if (!deliveryDoc) return req.error(400, 'deliveryDoc is required');

            try {
                const url = `/s4hanacloud/sap/opu/odata/sap/API_OUTBOUND_DELIVERY_SRV;v=0002/A_OutbDeliveryItem` +
                    `?$filter=DeliveryDocument eq '${deliveryDoc}'` +
                    `&$select=DeliveryDocument,DeliveryDocumentItem,Material,ActualDeliveryQuantity,` +
                    `DeliveryQuantityUnit,Plant,StorageLocation,TransportationGroup`;

                const res = await ewmApi.send({
                    method: 'GET',
                    path: url,
                    headers: { 'APIKey': SANDBOX_KEY }
                });

                // OData V2 collection: { d: { results: [...] } }
                const now = new Date().toISOString();
                const rows = (res?.d?.results || res?.value || []).map(d => ({
                    DeliveryDocument:     d.DeliveryDocument,
                    DeliveryDocumentItem: d.DeliveryDocumentItem,
                    Material:             d.Material,
                    DeliveryQuantity:     parseFloat(d.ActualDeliveryQuantity) || 0,
                    DeliveryQuantityUnit: d.DeliveryQuantityUnit,
                    Plant:                d.Plant,
                    StorageLocation:      d.StorageLocation,
                    TransportationGroup:  d.TransportationGroup,
                    createdAt:            now,
                    modifiedAt:           now
                }));

                // Upsert into local DB (fire-and-forget)
                if (rows.length > 0) {
                    cds.run(UPSERT.into(DeliveryItems).entries(rows)).catch(err => {
                        console.error('DeliveryItems upsert error:', err.message);
                    });
                }

                return rows;
            } catch (error) {
                console.error('getDeliveryItems error:', error.message);
                return req.error(500, `Failed to get delivery items: ${error.message}`);
            }
        });

        return super.init();
    }
};

// ── Helpers ────────────────────────────────────────────────────────────────

async function _resolveAddress(bpApi, businessPartner, sandboxKey) {
    try {
        const url = `/s4hanacloud/sap/opu/odata/sap/API_BUSINESS_PARTNER/A_BusinessPartner('${businessPartner}')/to_BusinessPartnerAddress?$top=1&$select=StreetName,HouseNumber,CityName,PostalCode,Region,Country`;
        const res = await bpApi.send({
            method: 'GET', path: url,
            headers: { 'APIKey': sandboxKey }
        });
        const addr = (res?.d?.results || res?.value || [])[0];
        if (!addr) return null;
        const parts = [
            addr.HouseNumber && addr.StreetName ? `${addr.HouseNumber} ${addr.StreetName}` : addr.StreetName,
            addr.CityName,
            addr.Region,
            addr.PostalCode,
            addr.Country
        ];
        const resolved = parts.filter(Boolean).join(', ');
        console.log(`[_resolveAddress] BP=${businessPartner} raw=${JSON.stringify(addr)} resolved="${resolved}"`);
        return resolved || null;
    } catch (e) {
        console.error(`BP address lookup failed for ${businessPartner}:`, e.message);
        return null;
    }
}

function _extractFilters(whereClause) {
    const pairs = [];
    if (!whereClause) return pairs;

    // CDS WHERE AST: [{ref:[field]}, '=', {val:value}, 'and', ...]
    for (let i = 0; i < whereClause.length - 2; i++) {
        const left  = whereClause[i];
        const op    = whereClause[i + 1];
        const right = whereClause[i + 2];
        if (left?.ref && (op === '=' || op === 'eq') && right?.val !== undefined) {
            pairs.push({ field: left.ref[left.ref.length - 1], value: String(right.val) });
            i += 2;
        }
    }
    return pairs;
}
