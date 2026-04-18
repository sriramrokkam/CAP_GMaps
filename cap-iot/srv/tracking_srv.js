const cds = require('@sap/cds');
const teamsNotify = require('./teams_notify');
const QRCode      = require('qrcode');

module.exports = class TrackingService extends cds.ApplicationService {
    async init() {
        const { DriverAssignment, Driver } = this.entities;
        const db = await cds.connect.to('db');

        this.on('assignDriver', async (req) => {
            try {
                const { deliveryDoc, mobileNumber, truckRegistration, driverName } = req.data;

                if (!mobileNumber || mobileNumber.trim() === '')
                    return req.error(400, 'mobileNumber is required');

                const existing = await SELECT.one.from(DriverAssignment)
                    .where({ DeliveryDocument: deliveryDoc, Status: { in: ['ASSIGNED', 'IN_TRANSIT'] } });
                if (existing)
                    return req.error(409, `Active assignment already exists for delivery ${deliveryDoc}`);

                let driver = await SELECT.one.from(Driver).where({ MobileNumber: mobileNumber });
                if (!driver) {
                    driver = {
                        ID:                cds.utils.uuid(),
                        MobileNumber:      mobileNumber,
                        DriverName:        driverName || mobileNumber,
                        TruckRegistration: truckRegistration || null,
                        LicenseNumber:     null,
                        IsActive:          true
                    };
                    await INSERT.into(Driver).entries(driver);
                } else if (truckRegistration && truckRegistration !== driver.TruckRegistration) {
                    await UPDATE(Driver).set({ TruckRegistration: truckRegistration }).where({ ID: driver.ID });
                }

                const id       = cds.utils.uuid();
                const topic    = `default/gmaps-app/1/delivery/${deliveryDoc}`;
                const qrUrl    = `/tracking/index.html#${id}`;
                const baseUrl  = process.env.APP_BASE_URL || 'http://localhost:4004';
                const qrImage  = await QRCode.toDataURL(`${baseUrl}${qrUrl}`);
                const trackUrl = `${baseUrl}${qrUrl}`;

                let estDistance = null, estDuration = null;
                try {
                    const route = await db.run(
                        SELECT.one.from('gmaps_schema_RouteDirections').columns('distance', 'duration').orderBy({ createdAt: 'desc' })
                    );
                    if (route) { estDistance = route.distance; estDuration = route.duration; }
                } catch (_) {}

                const assignment = {
                    ID:                id,
                    driver_ID:         driver.ID,
                    DeliveryDocument:  deliveryDoc,
                    MobileNumber:      mobileNumber,
                    DriverName:        driverName || driver.DriverName || mobileNumber,
                    TruckRegistration: truckRegistration || driver.TruckRegistration || null,
                    AssignedAt:        new Date().toISOString(),
                    Status:            'ASSIGNED',
                    EventTopic:        topic,
                    QRCodeUrl:         qrUrl,
                    QRCodeImage:       qrImage,
                    EstimatedDistance: estDistance,
                    EstimatedDuration: estDuration
                };

                await INSERT.into(DriverAssignment).entries(assignment);

                this._emit(topic, {
                    eventType:   'ASSIGNED',
                    deliveryDoc: deliveryDoc,
                    truck:       assignment.TruckRegistration,
                    driver:      assignment.DriverName,
                    mobile:      mobileNumber,
                    trackUrl:    trackUrl,
                    timestamp:   assignment.AssignedAt
                });
                teamsNotify.post('ASSIGNED', { ...assignment, TrackingUrl: trackUrl })
                    .catch(err => console.error('Teams notify (non-fatal):', err.message));

                return assignment;
            } catch (err) {
                console.error('assignDriver error:', err.message);
                return req.error(500, err.message);
            }
        });

        this.on('getQRCode', async (req) => {
            try {
                const { deliveryDoc } = req.data;
                const assignment = await SELECT.one.from(DriverAssignment)
                    .where({ DeliveryDocument: deliveryDoc, Status: { '!=': 'DELIVERED' } })
                    .orderBy({ AssignedAt: 'desc' });
                if (!assignment)
                    return req.error(404, `No active assignment for delivery ${deliveryDoc}`);
                return assignment;
            } catch (err) {
                console.error('getQRCode error:', err.message);
                return req.error(500, err.message);
            }
        });

        this.on('updateLocation', async (req) => {
            try {
                const { assignmentId, latitude, longitude, speed, accuracy } = req.data;

                const assignment = await SELECT.one.from(DriverAssignment).where({ ID: assignmentId });
                if (!assignment)       return req.error(404, 'Assignment not found');
                if (assignment.Status === 'DELIVERED') return req.error(409, 'Delivery already completed');

                const now = new Date().toISOString();
                const isFirstPing = assignment.Status === 'ASSIGNED';

                const update = {
                    CurrentLat:   latitude,
                    CurrentLng:   longitude,
                    CurrentSpeed: speed || null,
                    LastGpsAt:    now
                };
                if (isFirstPing) {
                    update.StartLat   = latitude;
                    update.StartLng   = longitude;
                    update.StartedAt  = now;
                    update.Status     = 'IN_TRANSIT';
                }

                await UPDATE(DriverAssignment).set(update).where({ ID: assignmentId });

                this._emit(assignment.EventTopic, {
                    eventType:   'GPS',
                    deliveryDoc: assignment.DeliveryDocument,
                    lat:         latitude,
                    lng:         longitude,
                    speed:       speed || null,
                    truck:       assignment.TruckRegistration || null,
                    timestamp:   now
                });

                if (assignment.Status === 'IN_TRANSIT' || isFirstPing) {
                    teamsNotify.post('LOCATION', {
                        TruckRegistration: assignment.TruckRegistration || null,
                        MobileNumber:      assignment.MobileNumber,
                        DeliveryDocument:  assignment.DeliveryDocument,
                        Latitude:          latitude,
                        Longitude:         longitude,
                        Speed:             speed || null,
                        RecordedAt:        now
                    }).catch(err => console.error('Teams location notify (non-fatal):', err.message));
                }

                return true;
            } catch (err) {
                console.error('updateLocation error:', err.message);
                return req.error(500, err.message);
            }
        });

        this.on('confirmDelivery', async (req) => {
            try {
                const { assignmentId } = req.data;

                const assignment = await SELECT.one.from(DriverAssignment).where({ ID: assignmentId });
                if (!assignment) return req.error(404, 'Assignment not found');
                if (assignment.Status === 'DELIVERED') return true;

                const deliveredAt = new Date().toISOString();

                await UPDATE(DriverAssignment)
                    .set({
                        Status:      'DELIVERED',
                        DeliveredAt: deliveredAt,
                        EndLat:      assignment.CurrentLat,
                        EndLng:      assignment.CurrentLng
                    })
                    .where({ ID: assignmentId });

                this._emit(assignment.EventTopic, {
                    eventType:   'DELIVERED',
                    deliveryDoc: assignment.DeliveryDocument,
                    lat:         assignment.CurrentLat,
                    lng:         assignment.CurrentLng,
                    truck:       assignment.TruckRegistration || null,
                    timestamp:   deliveredAt
                });

                (async () => {
                    try {
                        let shipToParty = null;
                        try {
                            const del = await db.run(
                                SELECT.one.from('gmaps_schema_OutboundDeliveries')
                                    .columns('ShipToParty')
                                    .where({ DeliveryDocument: assignment.DeliveryDocument })
                            );
                            if (del) shipToParty = del.ShipToParty;
                        } catch (_) {}

                        await teamsNotify.post('DELIVERED', {
                            ...assignment,
                            DeliveredAt: deliveredAt,
                            ShipToParty: shipToParty,
                            LastLat:     assignment.CurrentLat,
                            LastLng:     assignment.CurrentLng
                        });
                    } catch (e) { console.error('Teams DELIVERED notify error:', e.message); }
                })();

                return true;
            } catch (err) {
                console.error('confirmDelivery error:', err.message);
                return req.error(500, err.message);
            }
        });

        this.on('latestGps', async (req) => {
            try {
                const { assignmentId } = req.data;
                const row = await SELECT.one.from(DriverAssignment)
                    .columns('CurrentLat', 'CurrentLng', 'CurrentSpeed', 'LastGpsAt')
                    .where({ ID: assignmentId });
                if (!row || !row.CurrentLat) return null;
                return {
                    Latitude:  row.CurrentLat,
                    Longitude: row.CurrentLng,
                    Speed:     row.CurrentSpeed,
                    LastGpsAt: row.LastGpsAt
                };
            } catch (err) {
                console.error('latestGps error:', err.message);
                return req.error(500, err.message);
            }
        });

        cds.app.get('/tracking/config.js', (req, res) => {
            const intervalMs = parseInt(process.env.GPS_POLL_INTERVAL_MS, 10) || 60000;
            res.setHeader('Content-Type', 'application/javascript');
            res.send(`window.GPS_POLL_INTERVAL_MS = ${intervalMs};`);
        });

        return super.init();
    }

    _emit(topic, payload) {
        cds.emit(topic, payload).catch(err =>
            console.error(`Event Mesh emit failed (non-fatal): ${err.message}`)
        );
    }
};
