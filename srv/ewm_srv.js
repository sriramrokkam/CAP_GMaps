// srv/ewm_srv.js
const cds = require('@sap/cds');

module.exports = class EwmService extends cds.ApplicationService {

    async init() {
        const ewmApi = await cds.connect.to('EWM-API');
        const bpApi  = await cds.connect.to('BP-API');
        const gmaps  = await cds.connect.to('GmapsService');
        const SANDBOX_KEY = process.env.SAP_SANDBOX_API_KEY || '';

        // ── LIST: proxy to EWM OData ──────────────────────────────────────
        this.on('READ', 'OutboundDeliveries', async (req) => {
            const { query } = req;

            // Build OData $filter from CDS WHERE clause
            const filters = [];
            const where = query.SELECT?.where;
            if (where) {
                const pairs = _extractFilters(where);
                pairs.forEach(({ field, value }) => {
                    const map = {
                        DeliveryDocument:     'DeliveryDocument',
                        ActualDeliveryRoute:  'ActualDeliveryRoute',
                        SalesOrganization:    'SalesOrganization',
                        ShipToParty:          'ShipToParty',
                        ShippingPoint:        'ShippingPoint'
                    };
                    if (map[field]) filters.push(`${map[field]} eq '${value}'`);
                });
            }

            const top   = query.SELECT?.limit?.rows?.val || 50;
            const skip  = query.SELECT?.limit?.offset?.val || 0;

            let url = `/s4hanacloud/sap/opu/odata/sap/API_OUTBOUND_DELIVERY_SRV;v=0002/A_OutbDeliveryHeader?$top=${top}&$skip=${skip}`;
            if (filters.length) url += `&$filter=${filters.join(' and ')}`;
            url += `&$select=DeliveryDocument,ActualDeliveryRoute,ShippingPoint,ShipToParty,SalesOrganization,ShippingCondition,HeaderGrossWeight,HeaderNetWeight`;

            const res = await ewmApi.send({
                method: 'GET',
                path: url,
                headers: { 'APIKey': SANDBOX_KEY }
            });

            // API_OUTBOUND_DELIVERY_SRV is OData V2 — response is { d: { results: [...] } }
            const rows = (res?.d?.results || res.value || []).map(d => ({
                DeliveryDocument:        d.DeliveryDocument,
                ActualDeliveryRoute:     d.ActualDeliveryRoute,
                ShippingPoint:           d.ShippingPoint,
                ShipToParty:             d.ShipToParty,
                SalesOrganization:       d.SalesOrganization,
                ShippingCondition:       d.ShippingCondition,
                HeaderGrossWeight:       parseFloat(d.HeaderGrossWeight) || 0,
                HeaderNetWeight:         parseFloat(d.HeaderNetWeight) || 0,
            }));

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
                // OData V2 single-record response: { d: { field: value, ... } }
                const header = headerRaw?.d || headerRaw;
                if (!header || !header.ShippingPoint || !header.ShipToParty) {
                    return req.error(404, `Delivery ${deliveryDoc} not found or missing ShippingPoint/ShipToParty`);
                }

                // 2. Resolve ShippingPoint address via BP API
                const fromAddress = await _resolveAddress(bpApi, header.ShippingPoint, SANDBOX_KEY);
                if (!fromAddress) return req.error(404, `Could not resolve address for ShippingPoint ${header.ShippingPoint}`);

                // 3. Resolve ShipToParty address via BP API
                const toAddress = await _resolveAddress(bpApi, header.ShipToParty, SANDBOX_KEY);
                if (!toAddress) return req.error(404, `Could not resolve address for ShipToParty ${header.ShipToParty}`);

                // 4. Delegate to GmapsService.getDirections
                const result = await gmaps.send('getDirections', { from: fromAddress, to: toAddress });
                return result;
            } catch (error) {
                console.error('getDeliveryRoute error:', error.message);
                return req.error(500, `Failed to get delivery route: ${error.message}`);
            }
        });

        return super.init();
    }
};

// ── Helpers ────────────────────────────────────────────────────────────────

async function _resolveAddress(bpApi, businessPartner, sandboxKey) {
    try {
        const url = `/s4hanacloud/sap/opu/odata/sap/API_BUSINESS_PARTNER/A_BusinessPartner('${businessPartner}')/to_BusinessPartnerAddress?$top=1&$select=StreetName,CityName,PostalCode,Country`;
        const res = await bpApi.send({
            method: 'GET', path: url,
            headers: { 'APIKey': sandboxKey }
        });
        // OData V2 collection response: { d: { results: [...] } }
        const addr = (res?.d?.results || res?.value || [])[0];
        if (!addr) return null;
        return [addr.StreetName, addr.CityName, addr.PostalCode, addr.Country]
            .filter(Boolean).join(', ');
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
