// app/deliveries/webapp/ext/fragment/DeliveryHeader.js
sap.ui.define([
    "sap/m/MessageToast"
], function (MessageToast) {
    "use strict";

    const handler = {

        // Called by "Assign Driver" header action
        onAssignDriver: function (oEvent) {
            const oSource = oEvent.getSource();
            const oCtx    = oSource.getBindingContext();
            if (!oCtx) { MessageToast.show("No delivery selected"); return; }
            const deliveryDoc = oCtx.getObject().DeliveryDocument;
            if (!deliveryDoc) { MessageToast.show("No delivery document found"); return; }

            sap.ui.require(["ewm/deliveries/ext/fragment/DriverAssign"], function (DriverAssign) {
                DriverAssign.openDialog(deliveryDoc, null);
            });
        },

        // Called by "Show QR" header action
        onShowQR: function (oEvent) {
            const oSource = oEvent.getSource();
            const oCtx    = oSource.getBindingContext();
            if (!oCtx) { MessageToast.show("No delivery selected"); return; }
            const deliveryDoc = oCtx.getObject().DeliveryDocument;
            if (!deliveryDoc) return;

            fetch("/odata/v4/tracking/getQRCode", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": "Basic " + btoa("alice:alice")
                },
                body: JSON.stringify({ deliveryDoc })
            }).then(r => r.json()).then(data => {
                if (!data || !data.QRCodeImage) {
                    MessageToast.show("No active assignment found for this delivery.");
                    return;
                }
                sap.ui.require(["ewm/deliveries/ext/fragment/DriverAssign"], function (DriverAssign) {
                    DriverAssign.openDialog(deliveryDoc, data.QRCodeImage, data.QRCodeUrl);
                });
            }).catch(() => {
                MessageToast.show("Failed to retrieve QR code.");
            });
        }
    };

    return handler;
});
