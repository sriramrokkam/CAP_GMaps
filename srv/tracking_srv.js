const cds = require('@sap/cds');
const kafkaProducer = require('./kafka_producer');
const kafkaConsumer = require('./kafka_consumer');
const teamsNotify   = require('./teams_notify');
const QRCode        = require('qrcode');

module.exports = class TrackingService extends cds.ApplicationService {
    async init() {
        const { DriverAssignment, GpsCoordinates } = this.entities;
        const db = await cds.connect.to('db');

        // Start Kafka consumer (subscribes to gps-* topics)
        kafkaConsumer.start(db).catch(err => {
            console.error('Kafka consumer failed to start:', err.message);
        });

        // ----------------------------------------------------------------
        // assignDriver — dispatcher creates a new assignment
        // ----------------------------------------------------------------
        this.on('assignDriver', async (req) => {
            try {
                const { deliveryDoc, mobileNumber, truckRegistration } = req.data;

                // 1. Validate mobileNumber
                if (!mobileNumber || mobileNumber.trim() === '') {
                    return req.error(400, 'mobileNumber is required');
                }

                // 2. Check for existing active assignment
                const existing = await SELECT.one.from(DriverAssignment)
                    .where({ DeliveryDocument: deliveryDoc, Status: { in: ['ASSIGNED', 'IN_TRANSIT'] } });
                if (existing) {
                    return req.error(409, `Active assignment already exists for delivery ${deliveryDoc}`);
                }

                // 3. Generate UUID and topic/URL
                const id    = cds.utils.uuid();
                const topic  = `gps-${deliveryDoc}`;
                const qrUrl  = `/tracking/index.html#${id}`;

                // 4. Generate QR code base64 PNG
                const baseUrl  = process.env.APP_BASE_URL || 'http://localhost:4004';
                const qrImage  = await QRCode.toDataURL(`${baseUrl}${qrUrl}`);

                // 5. Fetch estimated distance/duration from stored route (best-effort)
                // Uses the most recent RouteDirections row — best proxy since routes are per delivery
                let estDistance = null, estDuration = null;
                try {
                    const route = await db.run(
                        SELECT.one.from('gmaps_schema_RouteDirections').columns('distance','duration').orderBy({ createdAt: 'desc' })
                    );
                    if (route) { estDistance = route.distance; estDuration = route.duration; }
                } catch (_) { /* no route stored yet — leave null */ }

                // 6. Build assignment object
                const assignment = {
                    ID: id,
                    DeliveryDocument:  deliveryDoc,
                    MobileNumber:      mobileNumber,
                    TruckRegistration: truckRegistration || null,
                    AssignedAt:        new Date().toISOString(),
                    Status:            'ASSIGNED',
                    KafkaTopic:        topic,
                    QRCodeUrl:         qrUrl,
                    QRCodeImage:       qrImage,
                    EstimatedDistance: estDistance,
                    EstimatedDuration: estDuration
                };

                // 7. Persist, then fire-and-forget Kafka + Teams (don't block response)
                await INSERT.into(DriverAssignment).entries(assignment);
                kafkaProducer.createTopic(topic).catch(err => console.error('Kafka createTopic (non-fatal):', err.message));
                teamsNotify.post('ASSIGNED', assignment).catch(err => console.error('Teams notify (non-fatal):', err.message));

                return assignment;
            } catch (err) {
                console.error('assignDriver error:', err.message);
                return req.error(500, err.message);
            }
        });

        // ----------------------------------------------------------------
        // getQRCode — retrieve the latest active assignment QR for a delivery
        // ----------------------------------------------------------------
        this.on('getQRCode', async (req) => {
            try {
                const { deliveryDoc } = req.data;

                // 1. Find the most recent non-delivered assignment
                const assignment = await SELECT.one.from(DriverAssignment)
                    .where({ DeliveryDocument: deliveryDoc, Status: { '!=': 'DELIVERED' } })
                    .orderBy({ AssignedAt: 'desc' });

                // 2. Not found
                if (!assignment) {
                    return req.error(404, `No active assignment for delivery ${deliveryDoc}`);
                }

                // 3. Return (QRCodeImage included)
                return assignment;
            } catch (err) {
                console.error('getQRCode error:', err.message);
                return req.error(500, err.message);
            }
        });

        // ----------------------------------------------------------------
        // updateLocation — driver pushes a GPS ping
        // ----------------------------------------------------------------
        this.on('updateLocation', async (req) => {
            try {
                const { assignmentId, latitude, longitude, speed, accuracy } = req.data;

                // 1. Fetch assignment
                const assignment = await SELECT.one.from(DriverAssignment)
                    .where({ ID: assignmentId });
                if (!assignment) {
                    return req.error(404, 'Assignment not found');
                }
                if (assignment.Status === 'DELIVERED') {
                    return req.error(409, 'Delivery already completed');
                }

                // 2. Build GPS row
                const gpsRow = {
                    ID:            cds.utils.uuid(),
                    assignment_ID: assignmentId,
                    Latitude:      latitude,
                    Longitude:     longitude,
                    Speed:         speed    || null,
                    Accuracy:      accuracy || null,
                    RecordedAt:    new Date().toISOString()
                };

                // 3. Persist GPS coordinate
                await INSERT.into(GpsCoordinates).entries(gpsRow);

                // 4. Transition ASSIGNED → IN_TRANSIT on first ping
                if (assignment.Status === 'ASSIGNED') {
                    await UPDATE(DriverAssignment)
                        .set({ Status: 'IN_TRANSIT' })
                        .where({ ID: assignmentId });
                }

                // 5. Publish to Kafka
                await kafkaProducer.publish(assignment.KafkaTopic, {
                    assignmentId,
                    lat:         latitude,
                    lng:         longitude,
                    speed:       speed    || null,
                    accuracy:    accuracy || null,
                    truck:       assignment.TruckRegistration || null,
                    mobile:      assignment.MobileNumber,
                    deliveryDoc: assignment.DeliveryDocument,
                    recordedAt:  gpsRow.RecordedAt
                });

                return true;
            } catch (err) {
                console.error('updateLocation error:', err.message);
                return req.error(500, err.message);
            }
        });

        // ----------------------------------------------------------------
        // confirmDelivery — driver marks delivery as done
        // ----------------------------------------------------------------
        this.on('confirmDelivery', async (req) => {
            try {
                const { assignmentId } = req.data;

                // 1. Fetch assignment
                const assignment = await SELECT.one.from(DriverAssignment)
                    .where({ ID: assignmentId });
                if (!assignment) {
                    return req.error(404, 'Assignment not found');
                }
                // Idempotent: already delivered
                if (assignment.Status === 'DELIVERED') {
                    return true;
                }

                // 2. Stamp delivery time
                const deliveredAt = new Date().toISOString();

                // 3. Update status
                await UPDATE(DriverAssignment)
                    .set({ Status: 'DELIVERED', DeliveredAt: deliveredAt })
                    .where({ ID: assignmentId });

                // 4. Stop consumer timer for this topic
                kafkaConsumer.clearTopicTimer(assignment.KafkaTopic);

                // 5. Delete Kafka topic (fire-and-forget — don't block response)
                kafkaProducer.deleteTopic(assignment.KafkaTopic).catch(err => console.error('Kafka deleteTopic (non-fatal):', err.message));

                // 6. Notify Teams (fire-and-forget)
                teamsNotify.post('DELIVERED', { ...assignment, DeliveredAt: deliveredAt }).catch(err => console.error('Teams notify (non-fatal):', err.message));

                return true;
            } catch (err) {
                console.error('confirmDelivery error:', err.message);
                return req.error(500, err.message);
            }
        });

        // ----------------------------------------------------------------
        // latestGps — return the most recent GPS ping for an assignment
        // ----------------------------------------------------------------
        this.on('latestGps', async (req) => {
            try {
                const { assignmentId } = req.data;

                // 1. Fetch latest row (order by RecordedAt desc, limit 1)
                const gpsRow = await SELECT.one.from(GpsCoordinates)
                    .where({ assignment_ID: assignmentId })
                    .orderBy({ RecordedAt: 'desc' });

                // 2. Not found → null (no error; caller checks)
                if (!gpsRow) {
                    return null;
                }

                return gpsRow;
            } catch (err) {
                console.error('latestGps error:', err.message);
                return req.error(500, err.message);
            }
        });

        return super.init();
    }
};
